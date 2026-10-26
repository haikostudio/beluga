import type { CapaciteDeGeneration, DemandeDeGeneration, ModeleDeGeneration } from './services-de-generation.js';
import type { RequeteHttp } from './studio-services.js';

/*
 * LE CATALOGUE LU EN DIRECT CHEZ fal.ai ET HIGGSFIELD (agent créatif,
 * 24/10/2026, demande de l'utilisateur : « récupérer des services les modèles
 * qu'ils proposent, pour les utiliser directement depuis l'agent »).
 *
 * Deux sources publiques et GRATUITES, lues sans clé :
 *  - fal.ai : `GET https://api.fal.ai/v1/models?category=…&status=active`
 *    (liste paginée par `cursor`), puis le schéma d'entrée d'un modèle par
 *    `GET …/v1/models?endpoint_id=…&expand=openapi-3.0` ;
 *  - Higgsfield : sa liste `GET /models` exige la clé, mais sa documentation
 *    publique `https://docs.higgsfield.ai/llms-full.txt` donne, pour CHAQUE
 *    modèle (84 au 24/10/2026), son « Endpoint ID » et son « Complete JSON
 *    schema » — de quoi le commander sans rien deviner.
 *
 * Un modèle lu porte ses ENTRÉES (nom, type, valeurs permises, défaut,
 * obligatoire) : la requête se construit depuis elles (`corpsEnDirect`), les
 * entrées connues (consigne, image de départ, image de fin, vidéo de
 * mouvement, durée, format) étant posées d'office et les autres réglées par
 * l'agent (`parametres`), vérifiées contre le schéma. Le catalogue choisi et
 * noté (`MODELES_EN_PLUS`) reste la recommandation ; le direct l'élargit.
 */

export interface EntreeDeModele {
  nom: string;
  type?: string;
  valeurs?: (string | number)[];
  defaut?: unknown;
  requis: boolean;
  description?: string;
  min?: number;
  max?: number;
}

export interface ModeleLuEnDirect extends ModeleDeGeneration {
  service: 'fal' | 'higgsfield' | 'kie';
  /** kie.ai : la page de la documentation qui porte le schéma (sous `docs.kie.ai/market/`). */
  page?: string;
  /** kie.ai : les réglages posés d'office quand rien ne les donne (modèles choisis seulement). */
  defauts?: Record<string, unknown>;
  /** La catégorie du service (« image-to-video », « video-to-video »…), ou celle déduite de l'identifiant. */
  categorie: string;
  /** Vide tant que le schéma n'est pas lu (fal le donne modèle par modèle). */
  entrees: EntreeDeModele[];
  description?: string;
}

/** Les catégories fal.ai lues, et la capacité que chacune sert. */
export const CATEGORIES_FAL_LUES = ['text-to-image', 'image-to-video', 'text-to-video', 'video-to-video', 'text-to-speech', 'text-to-audio', 'image-to-image'] as const;

const MOTS_DU_MOUVEMENT = /motion[-_ ]?control|motion[-_ ]?transfer|pose[-_ ]?transfer|\/animate\/move|dreamactor|wan-motion|one-to-all-animation/i;

/**
 * LA CAPACITÉ D'UN MODÈLE LU : ce que l'agent peut en faire. `null` : un
 * modèle que la réalisation ne sait pas encore servir (entraînement, retouche
 * de vidéo…) — il n'est pas proposé.
 */
export function capaciteDuModeleLu(m: { id: string; categorie: string; nom?: string; entrees?: readonly EntreeDeModele[] }): CapaciteDeGeneration | null {
  const texte = `${m.id} ${m.nom ?? ''}`;
  if (MOTS_DU_MOUVEMENT.test(texte)) return 'mouvement';
  const c = m.categorie.toLowerCase();
  if (c === 'image-to-video' || /image-to-video|first-last-frame/i.test(m.id)) return 'animation';
  if (c === 'text-to-video' || /text-to-video/i.test(m.id)) return 'video';
  if (c === 'text-to-speech') return 'voix';
  if (c === 'text-to-audio') return /music|song|lyria|stable-audio/i.test(texte) ? 'musique' : 'son';
  if (c === 'image-to-image' || /\/edit\b|\/edit$/i.test(m.id)) return 'retouche';
  if (c === 'text-to-image' || /text-to-image/i.test(m.id)) return 'image';
  return null;
}

/* ------------------------------------------------------------------ */
/* Les schémas                                                          */
/* ------------------------------------------------------------------ */

/** Les entrées d'un schéma JSON d'objet (`required` + `properties`). */
export function entreesDuSchemaJson(schema: any, definitions: Record<string, any> = {}): EntreeDeModele[] {
  const requis = new Set<string>(Array.isArray(schema?.required) ? schema.required.map(String) : []);
  const proprietes = schema?.properties && typeof schema.properties === 'object' ? schema.properties : {};
  return Object.entries<any>(proprietes).map(([nom, brut]) => {
    /* fal écrit souvent « anyOf: [{type: string}, {type: null}] » ou un $ref vers une énumération. */
    let p = brut ?? {};
    if (p.$ref) p = { ...definitions[String(p.$ref).split('/').pop()!], ...p };
    const variante = Array.isArray(p.anyOf) ? p.anyOf.find((x: any) => x && x.type !== 'null') ?? {} : {};
    const type = p.type ?? variante.type;
    const valeurs = p.enum ?? variante.enum;
    return {
      nom,
      ...(type ? { type: String(type) } : {}),
      ...(Array.isArray(valeurs) ? { valeurs: valeurs.filter((v: unknown) => typeof v === 'string' || typeof v === 'number') } : {}),
      ...(p.default !== undefined ? { defaut: p.default } : {}),
      requis: requis.has(nom),
      ...(typeof p.description === 'string' && p.description.trim() ? { description: p.description.trim().replace(/\s+/g, ' ').slice(0, 200) } : {}),
      ...(typeof (p.minimum ?? variante.minimum) === 'number' ? { min: p.minimum ?? variante.minimum } : {}),
      ...(typeof (p.maximum ?? variante.maximum) === 'number' ? { max: p.maximum ?? variante.maximum } : {}),
    };
  });
}

/** Les modèles d'une page de `GET https://api.fal.ai/v1/models` (sans leur schéma). */
export function modelesFalLus(corps: any): ModeleLuEnDirect[] {
  const liste: any[] = Array.isArray(corps?.models) ? corps.models : [];
  const sortie: ModeleLuEnDirect[] = [];
  for (const brut of liste) {
    const id = typeof brut?.endpoint_id === 'string' ? brut.endpoint_id : '';
    const meta = brut?.metadata ?? {};
    if (!id || (meta.status && meta.status !== 'active') || (meta.kind && meta.kind !== 'inference')) continue;
    const categorie = String(meta.category ?? '');
    const nom = String(meta.display_name ?? id).slice(0, 90);
    const capacite = capaciteDuModeleLu({ id, categorie, nom });
    if (!capacite) continue;
    sortie.push({
      service: 'fal',
      id,
      nom,
      capacite,
      categorie,
      qualite: 3,
      usage: String(meta.description ?? '').replace(/\s+/g, ' ').slice(0, 160) || nom,
      prix: 'api-fal',
      entrees: [],
    });
  }
  return sortie;
}

/** Le schéma d'entrée d'un modèle fal, depuis `?endpoint_id=…&expand=openapi-3.0`. */
export function entreesDuModeleFal(corps: any, id: string): EntreeDeModele[] {
  const modele = (Array.isArray(corps?.models) ? corps.models : []).find((m: any) => m?.endpoint_id === id) ?? corps?.models?.[0];
  const api = modele?.openapi;
  const schemas: Record<string, any> = api?.components?.schemas ?? {};
  const ref: string | undefined = api?.paths?.[`/${id}`]?.post?.requestBody?.content?.['application/json']?.schema?.$ref;
  const nom = ref ? ref.split('/').pop()! : Object.keys(schemas).find((k) => k.endsWith('Input'));
  return nom && schemas[nom] ? entreesDuSchemaJson(schemas[nom], schemas) : [];
}

/**
 * LES MODÈLES DE HIGGSFIELD, LUS DANS SA DOCUMENTATION PUBLIQUE : chaque
 * section « # … API » qui porte un « **Endpoint ID:** » et un « Complete JSON
 * schema » (lignes citées « > ») donne un modèle commandable.
 */
export function modelesHiggsfieldDeLaDoc(texte: string): ModeleLuEnDirect[] {
  const sortie: ModeleLuEnDirect[] = [];
  const vus = new Set<string>();
  for (const section of String(texte ?? '').split(/\n(?=# )/)) {
    const id = /\*\*Endpoint ID:\*\* `([^`]+)`/.exec(section)?.[1];
    if (!id || vus.has(id)) continue;
    const bloc = /> \*\*Complete JSON schema\*\*\n>\n> ```json[^\n]*\n((?:>(?: .*)?\n)+?)> ```/.exec(section)?.[1];
    if (!bloc) continue;
    let schema: any;
    try {
      schema = JSON.parse(
        bloc
          .split('\n')
          .map((l) => (l.startsWith('> ') ? l.slice(2) : ''))
          .join('\n'),
      );
    } catch {
      continue;
    }
    const titre = (section.split('\n')[0] ?? '').replace(/^# /, '').replace(/ API$/, '').trim();
    const usage = (section.split('\n').find((l, i) => i > 1 && l.trim() && !l.startsWith('Source:') && !l.startsWith('[') && !l.startsWith('**')) ?? '').trim();
    const categorie = /image-to-video|first-last-frame/.test(id)
      ? 'image-to-video'
      : /text-to-video/.test(id)
        ? 'text-to-video'
        : /motion/.test(id)
          ? 'video-to-video'
          : /\/edit$/.test(id)
            ? 'image-to-image'
            : /video|kling|seedance|wan|hailuo|ltx|pixverse|happy-horse|cinema/.test(id)
              ? 'video'
              : 'text-to-image';
    const entrees = entreesDuSchemaJson(schema, schema?.$defs ?? schema?.definitions ?? {});
    const capacite = capaciteDuModeleLu({ id, categorie, nom: titre, entrees });
    if (!capacite) continue;
    vus.add(id);
    sortie.push({
      service: 'higgsfield',
      id,
      nom: `${titre} (Higgsfield)`.slice(0, 90),
      capacite,
      categorie,
      qualite: 3,
      usage: usage.slice(0, 160) || titre,
      prix: 'non-publie',
      entrees,
    });
  }
  return sortie;
}

/* ------------------------------------------------------------------ */
/* La requête d'un modèle lu                                            */
/* ------------------------------------------------------------------ */

/** Les noms qu'un service donne aux entrées connues, du plus courant au plus rare. */
export const NOMS_DES_ENTREES = {
  consigne: ['prompt', 'text'],
  imageDeDepart: ['start_image_url', 'image_url', 'first_frame_url', 'first_frame_image', 'input_image_url', 'image'],
  imageDeFin: ['end_image_url', 'last_image_url', 'tail_image_url', 'last_frame_url', 'end_frame_url', 'last_frame_image'],
  images: ['image_urls', 'reference_image_urls', 'input_image_urls', 'image_input', 'input_urls'],
  video: ['video_url', 'reference_video_url', 'motion_video_url', 'source_video_url', 'driving_video_url', 'video_urls'],
  audio: ['audio_url'],
  duree: ['duration', 'duration_seconds', 'seconds'],
  format: ['aspect_ratio'],
  nombre: ['num_images', 'num_outputs'],
  orientation: ['character_orientation'],
  voix: ['voice', 'voice_id'],
  langue: ['language_code'],
  son: ['generate_audio', 'sound'],
} as const;

/** Ce qu'un modèle lu sait recevoir parmi les entrées connues : ce que l'agent et l'écran en disent. */
export function ceQueRecoitLeModele(entrees: readonly EntreeDeModele[]): { imageDeDepart: boolean; imageDeFin: boolean; images: boolean; video: boolean; audio: boolean } {
  const a = (noms: readonly string[]) => entrees.some((e) => noms.includes(e.nom));
  return {
    imageDeDepart: a(NOMS_DES_ENTREES.imageDeDepart),
    imageDeFin: a(NOMS_DES_ENTREES.imageDeFin),
    images: a(NOMS_DES_ENTREES.images),
    video: a(NOMS_DES_ENTREES.video),
    audio: a(NOMS_DES_ENTREES.audio),
  };
}

const TOUS_LES_NOMS_POSES: ReadonlySet<string> = new Set(Object.values(NOMS_DES_ENTREES).flat());

/** La valeur permise la plus proche d'une durée voulue (la liste du modèle, en texte ou en nombre). */
function dureePermise(e: EntreeDeModele, secondes: number): string | number {
  if (e.valeurs?.length) {
    const proche = [...e.valeurs].sort((a, b) => Math.abs(Number(a) - secondes) - Math.abs(Number(b) - secondes))[0]!;
    return proche;
  }
  let s = Math.round(secondes);
  if (typeof e.min === 'number') s = Math.max(e.min, s);
  if (typeof e.max === 'number') s = Math.min(e.max, s);
  return e.type === 'string' ? String(s) : s;
}

/** Une valeur réglée par l'agent, vérifiée contre l'entrée du schéma ; `undefined` : refusée. */
function valeurPermise(e: EntreeDeModele, v: unknown): unknown {
  if (e.valeurs?.length) {
    const trouvee = e.valeurs.find((x) => String(x) === String(v));
    return trouvee;
  }
  if (e.type === 'integer' || e.type === 'number') {
    const n = Number(v);
    if (!Number.isFinite(n)) return undefined;
    if ((typeof e.min === 'number' && n < e.min) || (typeof e.max === 'number' && n > e.max)) return undefined;
    return e.type === 'integer' ? Math.round(n) : n;
  }
  if (e.type === 'boolean') return typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : undefined;
  if (e.type === 'string') return typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, 4000) : undefined;
  if (e.type === 'array' || e.type === 'object') return typeof v === 'object' && v !== null ? v : undefined;
  return v;
}

export type CorpsEnDirect = { ok: true; corps: Record<string, unknown> } | { ok: false; raison: string };

/**
 * LE CORPS D'UNE COMMANDE À UN MODÈLE LU : les entrées connues posées depuis
 * la demande (seulement celles que le schéma déclare), puis les réglages de
 * l'agent vérifiés un à un. Une entrée OBLIGATOIRE qui manque refuse la
 * commande avec son nom — jamais un appel payant voué à l'échec.
 */
export function corpsEnDirect(
  entrees: readonly EntreeDeModele[],
  d: DemandeDeGeneration & { parametres?: Record<string, unknown> },
  /** Les réglages posés d'office quand ni la demande ni l'agent ne les donnent (kie.ai : résolution, mode…). */
  defauts: Record<string, unknown> = {},
): CorpsEnDirect {
  const corps: Record<string, unknown> = {};
  const premiere = (noms: readonly string[]) => noms.map((n) => entrees.find((e) => e.nom === n)).find(Boolean);
  /* Une entrée déclarée en liste reçoit une liste, même pour un seul fichier (kie.ai : `video_urls`, `input_urls`). */
  const poser = (e: EntreeDeModele, v: unknown) => {
    corps[e.nom] = e.type === 'array' && !Array.isArray(v) ? [v] : v;
  };
  const images = d.imageUrls ?? [];

  const consigne = premiere(NOMS_DES_ENTREES.consigne);
  if (consigne && d.consigne) corps[consigne.nom] = d.consigne;
  const liste = premiere(NOMS_DES_ENTREES.images);
  const depart = premiere(NOMS_DES_ENTREES.imageDeDepart);
  if (images.length) {
    if (depart) {
      poser(depart, images[0]);
      if (liste && images.length > 1) corps[liste.nom] = images.slice(1);
    } else if (liste) corps[liste.nom] = images;
  }
  const fin = premiere(NOMS_DES_ENTREES.imageDeFin);
  if (d.imageDeFinUrl) {
    /* Kling 3.0 chez kie.ai : l'image de départ PUIS celle de fin, dans la même liste (« First and last frame image URLs »). */
    if (!fin && liste && !depart && /last frame/i.test(liste.description ?? '') && Array.isArray(corps[liste.nom])) {
      corps[liste.nom] = [(corps[liste.nom] as unknown[])[0], d.imageDeFinUrl];
    } else {
      if (!fin) return { ok: false, raison: 'ce modèle ne reçoit pas d’image de fin : choisis-en un qui en prend une (le catalogue le dit), ou retire l’image de fin' };
      poser(fin, d.imageDeFinUrl);
    }
  }
  const video = premiere(NOMS_DES_ENTREES.video);
  if (video && (d.videoDeMouvementUrl ?? d.videoUrl)) poser(video, d.videoDeMouvementUrl ?? d.videoUrl);
  const audio = premiere(NOMS_DES_ENTREES.audio);
  if (audio && d.audioUrl) poser(audio, d.audioUrl);
  const voix = premiere(NOMS_DES_ENTREES.voix);
  if (voix && d.voix && (!voix.valeurs?.length || voix.valeurs.includes(d.voix))) corps[voix.nom] = d.voix;
  const langue = premiere(NOMS_DES_ENTREES.langue);
  if (langue && d.langue) corps[langue.nom] = d.langue;
  const son = premiere(NOMS_DES_ENTREES.son);
  if (son && typeof d.son === 'boolean') corps[son.nom] = d.son;
  const duree = premiere(NOMS_DES_ENTREES.duree);
  if (duree && d.duree) corps[duree.nom] = dureePermise(duree, d.duree);
  const format = premiere(NOMS_DES_ENTREES.format);
  if (format && d.format) {
    /* Un format absent de la liste du modèle prend le plus proche (4:5 → 3:4, puis le vertical). */
    const voulus = d.format === '4:5' ? ['4:5', '3:4', '9:16'] : [d.format];
    const v = format.valeurs?.length ? voulus.map((f) => format.valeurs!.find((x) => String(x) === f)).find((x) => x !== undefined) : d.format;
    if (v !== undefined) corps[format.nom] = v;
  }
  const nombre = premiere(NOMS_DES_ENTREES.nombre);
  if (nombre) corps[nombre.nom] = 1;
  const orientation = premiere(NOMS_DES_ENTREES.orientation);
  if (orientation && corps[video?.nom ?? ''] !== undefined) corps[orientation.nom] = d.orientation ?? 'video';

  /* LES RÉGLAGES DE L'AGENT : seulement des entrées du schéma, jamais une adresse de fichier (posées par le démon). */
  for (const [nom, brut] of Object.entries(d.parametres ?? {})) {
    const e = entrees.find((x) => x.nom === nom);
    if (!e) return { ok: false, raison: `réglage inconnu de ce modèle : « ${nom} » (ses entrées : ${entrees.map((x) => x.nom).join(', ')})` };
    if (TOUS_LES_NOMS_POSES.has(nom) && /url|image|video|audio/.test(nom)) return { ok: false, raison: `« ${nom} » est posé par le démon depuis les médias désignés (source, fin, mouvement) : ne le règle pas toi-même` };
    const v = valeurPermise(e, brut);
    if (v === undefined) return { ok: false, raison: `valeur refusée pour « ${nom} »${e.valeurs?.length ? ` : ${e.valeurs.join(', ')}` : e.type ? ` (${e.type}${typeof e.min === 'number' ? `, ${e.min}` : ''}${typeof e.max === 'number' ? ` à ${e.max}` : ''})` : ''}` };
    corps[nom] = v;
  }
  for (const [nom, v] of Object.entries(defauts)) if (corps[nom] === undefined && entrees.some((e) => e.nom === nom)) corps[nom] = v;

  const manquent = entrees.filter((e) => e.requis && corps[e.nom] === undefined && e.defaut === undefined).map((e) => e.nom);
  if (manquent.length) {
    const enMots = manquent.map((n) =>
      (NOMS_DES_ENTREES.imageDeDepart as readonly string[]).includes(n)
        ? `${n} (l’image de départ : « source »)`
        : (NOMS_DES_ENTREES.video as readonly string[]).includes(n)
          ? `${n} (la vidéo de mouvement : « mouvement »)`
          : (NOMS_DES_ENTREES.imageDeFin as readonly string[]).includes(n)
            ? `${n} (l’image de fin : « fin »)`
            : n,
    );
    return { ok: false, raison: `entrées obligatoires manquantes : ${enMots.join(', ')}` };
  }
  return { ok: true, corps };
}

/** La requête d'un modèle lu : la file de fal.ai, l'adresse du modèle chez Higgsfield, ou la commande unique de kie.ai. */
export function requeteEnDirect(service: 'fal' | 'higgsfield' | 'kie', id: string, cle: string, corps: Record<string, unknown>): RequeteHttp {
  const json = { 'Content-Type': 'application/json' };
  if (service === 'kie') return { methode: 'POST', adresse: 'https://api.kie.ai/api/v1/jobs/createTask', entetes: { Authorization: `Bearer ${cle}`, ...json }, corps: { model: id, input: corps } };
  return service === 'fal'
    ? { methode: 'POST', adresse: `https://queue.fal.run/${id}`, entetes: { Authorization: `Key ${cle}`, ...json }, corps }
    : { methode: 'POST', adresse: `https://api.higgsfield.ai/${id}`, entetes: { Authorization: `Key ${cle}`, ...json }, corps };
}

/** Une ligne d'entrées lisible par l'agent : « prompt* (texte) · duration (5|10) · … ». */
export function entreesEnClair(entrees: readonly EntreeDeModele[], max = 14): string {
  const lignes = entrees.slice(0, max).map((e) => `${e.nom}${e.requis ? '*' : ''}${e.valeurs?.length ? ` (${e.valeurs.slice(0, 8).join('|')})` : e.type ? ` (${e.type})` : ''}`);
  return `${lignes.join(' · ')}${entrees.length > max ? ` · +${entrees.length - max}` : ''}`;
}

/** Filtre de recherche simple sur l'identifiant et le nom. */
export function filtrerLesModelesLus(modeles: readonly ModeleLuEnDirect[], recherche: string): ModeleLuEnDirect[] {
  const mots = recherche.toLowerCase().split(/\s+/).filter(Boolean);
  if (!mots.length) return [...modeles];
  return modeles.filter((m) => mots.every((mot) => `${m.id} ${m.nom}`.toLowerCase().includes(mot)));
}

