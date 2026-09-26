/**
 * LE VECTORISEUR, DANS SON PROPRE PROCESSUS.
 *
 * Le modèle chargé tient environ 500 Mo de mémoire vive : il vit donc à côté du
 * démon, jamais dedans, et s'arrête tout seul après un temps de repos
 * (`server/src/vectoriseur.ts`). Une ligne JSON par demande sur l'entrée
 * (`{ id, textes }`), une ligne par réponse sur la sortie (`{ id, vecteurs }`,
 * chaque vecteur en Float32 encodé base64, ou `{ id, erreur }`).
 *
 * Le moteur (`@huggingface/transformers`) et le modèle sont installés HORS du
 * dépôt, dans `<données>/vectoriseur` : aucun réseau n'est appelé ici.
 */
import path from 'node:path';
import readline from 'node:readline';

const dossier = process.argv[2];
const modeleId = process.argv[3];

async function charger() {
  const moteur = await import(path.join(dossier, 'node_modules/@huggingface/transformers/src/transformers.js'));
  moteur.env.cacheDir = path.join(dossier, 'modeles');
  moteur.env.allowRemoteModels = false;
  return moteur.pipeline('feature-extraction', modeleId, { dtype: 'q8' });
}

const modele = charger();
modele.catch((err: Error) => {
  process.stdout.write(`${JSON.stringify({ id: 0, erreur: `modèle introuvable : ${err.message}` })}\n`);
  process.exit(1);
});

let file = Promise.resolve();
readline.createInterface({ input: process.stdin }).on('line', (ligne) => {
  file = file.then(async () => {
    let id = 0;
    try {
      const demande = JSON.parse(ligne) as { id: number; textes: string[] };
      id = demande.id;
      const extracteur = await modele;
      const sortie = await extracteur(demande.textes, { pooling: 'mean', normalize: true });
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
