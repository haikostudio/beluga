/**
 * LE VECTORISEUR, DANS SON PROPRE PROCESSUS.
 *
 * Le modèle chargé tient environ 500 Mo de mémoire vive : il vit donc à côté du
 * démon, jamais dedans, et s'arrête tout seul après un temps de repos
 * (`server/src/vectoriseur.ts`). Une ligne JSON par demande sur l'entrée, une
 * ligne par réponse sur la sortie :
 *  - `{ id, textes }` → `{ id, vecteurs }` (chaque vecteur en Float32 encodé base64) ;
 *  - `{ id, tri: { requete, documents } }` → `{ id, notes }` : le MODÈLE DE TRI
 *    (cross-encoder, `MODELE_DE_TRI`) note chaque paire (requête, document) entre
 *    0 et 1. Il n'est chargé qu'à la PREMIÈRE demande de tri (~1,1 Go de plus) ;
 * ou `{ id, erreur }`. `{ annuler: id }` (lu à l'arrivée, hors de la file) arrête un tri au lot suivant ; il
 * répond alors `{ id, annule: true, lots }`.
 *
 * Le même script tourne en DEUX processus (`server/src/vectoriseur.ts`) : le
 * vectoriseur (modèle de vecteurs seul) et le trieur (modèle de vecteurs « - » :
 * le modèle de tri seul).
 *
 * Le moteur (`@huggingface/transformers`) et les modèles sont installés HORS du
 * dépôt, dans `<données>/vectoriseur` : aucun réseau n'est appelé ici.
 */
import path from 'node:path';
import readline from 'node:readline';

const dossier = process.argv[2];
const modeleId = process.argv[3];
const modeleDeTri = process.argv[4];
const jetonsDuTri = Number(process.argv[5]) || 192;
const lotDuTri = Number(process.argv[6]) || 8;
/* Les fils de calcul du trieur (`FILS_DU_TRI`) : sans réglage, l'ONNX prend tous les cœurs. */
const filsDuTri = Number(process.argv[7]) || 2;

/* Le moteur vit hors du dépôt (aucun type installé) : on n'en décrit que ce qui sert ici. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Moteur = any;

let moteurCharge: Promise<Moteur> | null = null;
function moteur(): Promise<Moteur> {
  moteurCharge ??= (async () => {
    const m: Moteur = await import(path.join(dossier, 'node_modules/@huggingface/transformers/src/transformers.js'));
    m.env.cacheDir = path.join(dossier, 'modeles');
    m.env.allowRemoteModels = false;
    return m;
  })();
  return moteurCharge;
}

async function charger() {
  const m = await moteur();
  return m.pipeline('feature-extraction', modeleId, { dtype: 'q8' });
}

const modele = modeleId && modeleId !== '-' ? charger() : Promise.reject(new Error('ce processus ne vectorise pas'));
if (!modeleId || modeleId === '-') modele.catch(() => {});
else modele.catch((err: Error) => {
  process.stdout.write(`${JSON.stringify({ id: 0, erreur: `modèle introuvable : ${err.message}` })}\n`);
  process.exit(1);
});

/* LE MODÈLE DE TRI, PARESSEUX : chargé à la première demande de tri, jamais au démarrage. Un échec de
   chargement est retenu (chaque demande suivante répond la même erreur, sans recharger en boucle). */
let tri: Promise<{ tokenizer: (...a: unknown[]) => unknown; modele: (entrees: unknown) => Promise<{ logits: { data: ArrayLike<number> } }> }> | null = null;
/* LE MODÈLE D'ESSAI (« @essai ») : aucun moteur chargé, chaque lot prend 150 ms et note 0,5. Il sert aux tests du
   démon (une seule demande en vol, annulation au délai) sans le gigaoctet du vrai modèle. */
const MODELE_D_ESSAI = '@essai';
function modeleDeTriCharge() {
  tri ??= (async () => {
    if (!modeleDeTri) throw new Error('aucun modèle de tri demandé');
    if (modeleDeTri === MODELE_D_ESSAI) {
      return {
        tokenizer: (_r: unknown, o: unknown) => (o as { text_pair: unknown[] }).text_pair,
        modele: async (lot: unknown) => {
          await new Promise((r) => setTimeout(r, 150));
          return { logits: { data: (lot as unknown[]).map(() => 0) } };
        },
      };
    }
    const m = await moteur();
    const [tokenizer, modeleTri] = await Promise.all([
      m.AutoTokenizer.from_pretrained(modeleDeTri),
      // Sans « arène » de mémoire : l'ONNX ne garde pas le pic du plus gros lot (~100 Mo de moins).
      m.AutoModelForSequenceClassification.from_pretrained(modeleDeTri, { dtype: 'q8', session_options: { enableCpuMemArena: false, intraOpNumThreads: filsDuTri, interOpNumThreads: 1 } }),
    ]);
    return {
      tokenizer: tokenizer as unknown as (...a: unknown[]) => unknown,
      modele: modeleTri as unknown as (entrees: unknown) => Promise<{ logits: { data: ArrayLike<number> } }>,
    };
  })();
  return tri;
}

/* L'ANNULATION (carte « Enquête sur les décrochages du serveur », 18/11/2026). Une demande abandonnée par le démon
   (délai dépassé) continuait de calculer jusqu'au bout : le 18/11, 60 tris sur 60 abandonnés ont tous tourné à
   157 % de processeur sur une machine pleine. Le démon envoie donc `{ annuler: id }` — lu HORS de la file, à
   l'arrivée — et le tri s'arrête au lot suivant ; une demande annulée avant son tour ne commence jamais. */
const annulees = new Set<number>();
let file = Promise.resolve();
readline.createInterface({ input: process.stdin }).on('line', (ligne) => {
  try {
    const a = JSON.parse(ligne) as { annuler?: number };
    if (typeof a.annuler === 'number') {
      annulees.add(a.annuler);
      return;
    }
  } catch {
    // la ligne illisible est rendue en erreur par la file, plus bas
  }
  file = file.then(async () => {
    let id = 0;
    try {
      const demande = JSON.parse(ligne) as { id: number; textes?: string[]; tri?: { requete: string; documents: string[] } };
      id = demande.id;
      if (demande.tri) {
        const annule = (lots: number) => {
          annulees.delete(id);
          process.stdout.write(`${JSON.stringify({ id, annule: true, lots })}\n`);
        };
        if (annulees.has(id)) return annule(0);
        const { tokenizer, modele: modeleTri } = await modeleDeTriCharge();
        const { requete, documents } = demande.tri;
        if (!documents.length) {
          process.stdout.write(`${JSON.stringify({ id, notes: [] })}\n`);
          return;
        }
        const notes: number[] = [];
        for (let i = 0; i < documents.length; i += lotDuTri) {
          if (annulees.has(id)) return annule(i / lotDuTri);
          const lot = documents.slice(i, i + lotDuTri);
          const entrees = tokenizer(new Array(lot.length).fill(requete), {
            text_pair: lot,
            padding: true,
            truncation: true,
            max_length: jetonsDuTri,
          });
          const { logits } = await modeleTri(entrees);
          notes.push(...Array.from(logits.data, (x) => 1 / (1 + Math.exp(-x))));
        }
        process.stdout.write(`${JSON.stringify({ id, notes })}\n`);
        return;
      }
      const extracteur = await modele;
      const sortie = await extracteur(demande.textes ?? [], { pooling: 'mean', normalize: true });
      const [n, d] = sortie.dims as [number, number];
      const donnees = sortie.data as Float32Array;
      const vecteurs = Array.from({ length: n }, (_, i) => Buffer.from(donnees.slice(i * d, (i + 1) * d).buffer).toString('base64'));
      process.stdout.write(`${JSON.stringify({ id, vecteurs })}\n`);
    } catch (err) {
      process.stdout.write(`${JSON.stringify({ id, erreur: (err as Error).message })}\n`);
    }
  });
});
process.stdin.on('end', () => process.exit(0));
