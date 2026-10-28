/**
 * kie.ai — LE SERVICE QUI REMPLACE HIGGSFIELD ET fal.ai (décision de
 * l'utilisateur du 25/10/2026). Règles PURES : le catalogue choisi et noté,
 * la commande, la lecture des réponses, le prix lu en direct et le catalogue
 * lu dans la documentation publique. `server/src/realisation.ts` et
 * `server/src/studio-services.ts` font les appels ; `server/src/test/kie.test.ts`
 * verrouille ces règles.
 *
 * Vérifié le 25/10/2026 dans la documentation officielle (docs.kie.ai) et par
 * des appels réels avec la clé de l'utilisateur :
 *  - `Authorization: Bearer <clé>` partout ;
 *  - solde : `GET https://api.kie.ai/api/v1/chat/credit` → `{code:200, data:<crédits>}` ;
 *  - commande : `POST https://api.kie.ai/api/v1/jobs/createTask` `{model, input:{…}}`
 *    → `data.taskId` — Suno compris (`model: ai-music-api/generate`) ;
 *  - suivi : `GET …/api/v1/jobs/recordInfo?taskId=…` → `data.state`
 *    waiting|queuing|generating|success|fail, `data.resultJson` (chaîne JSON,
 *    `resultUrls[]` ; Suno : `data.response.data[].audio_url`), `failMsg`,
 *    `creditsConsumed` (le coût RÉEL, en crédits) ; un travail inconnu → `code: 422` ;
 *  - LES ERREURS ARRIVENT EN HTTP 200 : seul le champ `code` fait foi
 *    (401 clé refusée, 402 crédit épuisé, 422/500 commande refusée) ;
 *  - dépôt de fichier (gratuit, gardé 24 h) : `POST https://kieai.redpandaai.co/api/file-stream-upload`
 *    (multipart `file`, `uploadPath`, `fileName`) → `data.downloadUrl` ;
 *  - les résultats sont gardés 14 jours : ils se téléchargent aussitôt ;
 *  - prix publics, sans clé : `POST https://api.kie.ai/client/v1/model-pricing/page`
 *    `{pageNum, pageSize ≤ 100, modelDescription, interfaceType}` → lignes
 *    `{modelDescription, creditPrice, creditUnit, anchor}` ; 1 crédit = 0,005 $
 *    (`creditPrice` 14 ↔ `usdPrice` 0,07).
 *
 * Les schémas d'entrée ci-dessous sont RECOPIÉS des pages de chaque modèle
 * (`docs.kie.ai/market/<famille>/<modele>.md`, OpenAPI embarqué) ; un modèle
 * hors de cette liste se commande d'après sa page, lue en direct
 * (`entreesDeLaPageKie`), avec la même vérification avant dépense.
 */

import type { EntreeDeModele } from './catalogue-en-direct.js';
import type { CapaciteDeGeneration, EtatDeGeneration } from './services-de-generation.js';
import type { RatioClip, RequeteHttp } from './studio-services.js';
import type { DirectionsDuModele } from './retouches-de-media.js';

export const KIE_API = 'https://api.kie.ai';
export const KIE_ENVOI = 'https://kieai.redpandaai.co/api/file-stream-upload';
/** La valeur d'un crédit kie.ai, lue sur la page des prix le 25/10/2026. */
export const DOLLARS_PAR_CREDIT = 0.005;
/** Un fichier déposé chez kie.ai : 100 Mo conseillés au plus. */
export const TAILLE_MAX_ENVOI_KIE = 100 * 1024 * 1024;

export interface ModeleKie {
  /** L'identifiant `model` de la commande chez kie.ai. */
  id: string;
  nom: string;
  capacite: CapaciteDeGeneration;
  /** 1 à 5, noté le 25/10/2026. */
  qualite: number;
  usage: string;
  /** La page de la documentation (sous `docs.kie.ai/market/`), d'où le schéma est recopié. */
  page: string;
  entrees: EntreeDeModele[];
  /** Les réglages posés d'office quand ni la demande ni l'agent ne les donnent (résolution, mode…). */
  defauts: Record<string, unknown>;
  /** LA LIGNE DE PRIX : les mots que porte sa description sur la page des prix (toutes, sans casse). */
  tarif: string[];
  durees?: number[];
  ratios?: RatioClip[];
  son?: boolean;
  fin?: boolean;
  retouche?: { lumiere?: DirectionsDuModele; sources?: number; parMots?: boolean };
}

/* ------------------------------------------------------------------ */
/* Les entrées, recopiées de la documentation (25/10/2026)             */
/* ------------------------------------------------------------------ */

const texte = (nom: string, requis = false, description?: string): EntreeDeModele => ({ nom, type: 'string', requis, ...(description ? { description } : {}) });
const choix = (nom: string, valeurs: (string | number)[], requis = false, defaut?: unknown): EntreeDeModele => ({
  nom,
  type: typeof valeurs[0] === 'number' ? 'integer' : 'string',
  valeurs,
  requis,
  ...(defaut !== undefined ? { defaut } : {}),
});
const entier = (nom: string, min: number, max: number, requis = false, defaut?: number): EntreeDeModele => ({ nom, type: 'integer', min, max, requis, ...(defaut !== undefined ? { defaut } : {}) });
const oui = (nom: string, requis = false, defaut?: boolean): EntreeDeModele => ({ nom, type: 'boolean', requis, ...(defaut !== undefined ? { defaut } : {}) });
const liste = (nom: string, requis = false, description?: string): EntreeDeModele => ({ nom, type: 'array', requis, ...(description ? { description } : {}) });

const plage = (min: number, max: number) => Array.from({ length: max - min + 1 }, (_, i) => min + i);
const SECONDES_3_15 = plage(3, 15).map(String);
const RATIOS_VIDEO = ['16:9', '9:16', '1:1'];

/** Les voix ElevenLabs proposées par kie.ai (la liste fermée de sa page, 25/10/2026) — la première est son défaut. */
export const VOIX_ELEVENLABS_KIE = [
  'EkK5I93UQWFDigLMpZcX', 'Z3R5wn05IrDiVCyEkUrK', 'NNl6r8mD7vthiJatiJt1', 'YOq2y2Up4RgXP2HyXjE5', 'B8gJV1IhpuegLxdpXFOE', '2zRM7PkgwBPiau2jvVXc',
  '1SM7GgM6IMuvQlz2BwM3', '5l5f8iK3YPeGga21rQIX', 'scOwDtmlUjD3prqpp97I', 'NOpBlnGInO9m6vDvFkFC', 'BZgkqPqms7Kj9ulSkVzn', 'wo6udizrrtpIxWGp2qJk',
  'gU0LNdkMOQCOrPrwtbee', 'DGzg6RaUqxGRTHSBjfgF', 'x70vRnQBMBu4FAYhjJbO', 'Sm1seazb4gs7RSlUVw7c', 'P1bg08DkjqiVEzOn76yG', 'qDuRKMlYmrm8trt5QyBn',
  'qXpMhyvQqiRxWQs4qSSB', 'TX3LPaxmHKxFdv7VOQHJ', 'N2lVS1w4EtoT3dr4eOWO', 'FGY2WhTYpPnrIDTdsKH5', 'kPzsL2i3teMYv0FxEYQ6', 'UgBBYS2sOqTuMpoF3BR0',
  'hpp4J3VqNfWAUOO0d1Us', 'nPczCjzI2devNBz1zQrb', 'uYXf8XasLslADfZ2MB4u', 'gs0tAILXbY5DNrJrsM6F', 'DTKMou8ccj1ZaWGBiotd', 'vBKc2FfBKJfcZNyEt1n6',
  'DYkrAHD8iwork3YSUBbs', '56AoDkrOh6qfVPDXZ7Pt', 'eR40ATw9ArzDf9h3v7t7', 'g6xIsTj2HwM6VR4iXFCw', 'lcMyyd2HUfFzxdCaC4Ta', '6aDn1KB0hjpdcocrUkmq',
  'Sq93GQT4X1lKDXsQcixO', 'flHkNRp1BlvT73UL6gyz', '9yzdeviXkFddZ4Oz8Mok', 'pPdl9cQBQq4p6mRkZy2Z', 'zYcjlYFOd3taleS0gkk3', 'nzeAacJi50IvxcyDnMXa',
  'ruirxsoakN0GWmGNIo04', 'TC0Zp7WVFzhA8zpTlRqV', 'ljo9gAlSqKOvF6D8sOsX', 'PPzYpIqttlTYA83688JI', '8JVbfL6oEdmuxKn5DK2C', 'iCrDUkL56s3C8sCRl7wb',
  'wJqPPQ618aTW29mptyoc', 'EiNlNiXeDU1pqqOPrYMO', '4YYIPFl9wE5c4L2eu2Gb', '6F5Zhi321D3Oq7v1oNT4', 'YXpFCvM1S3JbWEJhoskW', 'LG95yZDEHg6fCZdQjLqj',
  'CeNX9CMwmxDxUF5Q2Inm', 'aD6riP1btT197c6dACmy', 'mtrellq69YZsNwzUSyXh', 'dHd5gvgSOzSfduK4CvEg', 'eVItLK1UvXctxuaRV2Oq', 'esy0r39YPLQjOczyOib8',
  'Tsns2HvNFKfGiNjllgqo', '1U02n4nD6AdIZ9CjF053', 'AeRdCCKzvd23BpJoofzx', 'LruHrtVF6PSyGItzMNHS', '1wGbFxmAM3Fgw63G1zZJ', 'hqfrgApggtO1785R4Fsn',
  'MJ0RnG71ty4LH3dvNfSd',
];

const VOIX_ELEVENLABS = [texte('text', true), choix('voice', VOIX_ELEVENLABS_KIE, false, VOIX_ELEVENLABS_KIE[0]), texte('language_code')];
const IMAGES_EDIT = (requis: boolean) => liste('image_urls', requis, 'input images (up to 10)');
const NANO_EDIT = [texte('prompt', true), IMAGES_EDIT(true), choix('aspect_ratio', ['1:1', '9:16', '16:9', '3:4', '4:3', '3:2', '2:3', '5:4', '4:5', '21:9', 'auto']), choix('output_format', ['png', 'jpeg'], false, 'png')];

/**
 * LE CATALOGUE kie.ai CHOISI ET NOTÉ (25/10/2026) : la recommandation. La
 * vidéo y est en 720p (le choix de prix déjà fait pour fal.ai), l'image en 1K.
 * Un même modèle sert parfois plusieurs capacités (Kling 3.0 : texte vers
 * vidéo ET animation d'une image) : la capacité tranche.
 */
export const MODELES_KIE: readonly ModeleKie[] = [
  /* ---- vidéo à partir d'un texte (aussi proposés au Studio) ---- */
  {
    id: 'kling-3.0/video', nom: 'Kling 3.0', capacite: 'video', qualite: 5, usage: 'mouvements physiques et action, son intégré, 3 à 15 s',
    page: 'kling/kling-3-0', durees: plage(3, 15), ratios: ['16:9', '9:16', '1:1'], son: true,
    entrees: [texte('prompt'), liste('image_urls', false, 'First and last frame image URLs'), oui('sound', true), choix('duration', SECONDES_3_15, true), choix('aspect_ratio', RATIOS_VIDEO), choix('mode', ['std', 'pro', '4K'], true), oui('multi_shots', true)],
    defauts: { mode: 'std', multi_shots: false, sound: true }, tarif: ['kling 3.0, video', 'audio-720p'],
  },
  {
    id: 'bytedance/seedance-2-fast', nom: 'Seedance 2.0 Fast', capacite: 'video', qualite: 4, usage: 'plans multiples cohérents, mouvements de caméra, son, rapide',
    page: 'bytedance/seedance-2-fast', durees: plage(4, 15), ratios: ['16:9', '9:16', '1:1'], son: true,
    entrees: [texte('prompt', true), texte('first_frame_url'), texte('last_frame_url'), oui('generate_audio', false, true), choix('resolution', ['480p', '720p'], false, '720p'), choix('aspect_ratio', ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9', 'adaptive'], true, '16:9'), entier('duration', 4, 15, false, 5)],
    defauts: { resolution: '720p' }, tarif: ['seedance-2 fast', '720p no video input'],
  },
  {
    id: 'kling/v3-turbo-text-to-video', nom: 'Kling 3.0 Turbo', capacite: 'video', qualite: 4, usage: 'mouvements physiques, rapide, sans son',
    page: 'kling/v3-turbo-text-to-video', durees: plage(3, 15), ratios: ['16:9', '9:16', '1:1'], son: false,
    entrees: [texte('prompt', true), choix('duration', SECONDES_3_15, true), choix('aspect_ratio', ['1:1', '9:16', '16:9'], true), choix('resolution', ['720p', '1080p'], true)],
    defauts: { resolution: '720p' }, tarif: ['kling 3.0 turbo, text-to-video', '720p'],
  },
  {
    id: 'grok-imagine/text-to-video', nom: 'Grok Imagine', capacite: 'video', qualite: 3, usage: 'essais économiques, son intégré (dialogues de la consigne dits), 6 à 15 s',
    page: 'grok-imagine/text-to-video', durees: plage(6, 15), ratios: ['16:9', '9:16', '1:1'], son: true,
    entrees: [texte('prompt', true), choix('aspect_ratio', ['2:3', '3:2', '1:1', '16:9', '9:16'], false, '2:3'), entier('duration', 6, 30), choix('resolution', ['480p', '720p', '1080p'], false, '480p')],
    defauts: { resolution: '720p' }, tarif: ['grok-imagine, text-to-video', '720p'],
  },

  /* ---- animation d'une image (le chemin de la vidéo d'une production) ---- */
  {
    id: 'kling-3.0/video', nom: 'Kling 3.0 (image vers vidéo)', capacite: 'animation', qualite: 5, usage: 'anime l’image de départ d’un plan jusqu’à son image de fin, avec son, 3 à 15 s',
    page: 'kling/kling-3-0', durees: plage(3, 15), son: true, fin: true,
    entrees: [texte('prompt'), liste('image_urls', false, 'First and last frame image URLs'), oui('sound', true), choix('duration', SECONDES_3_15, true), choix('aspect_ratio', RATIOS_VIDEO), choix('mode', ['std', 'pro', '4K'], true), oui('multi_shots', true)],
    defauts: { mode: 'std', multi_shots: false, sound: true }, tarif: ['kling 3.0, video', 'audio-720p'],
  },
  {
    id: 'bytedance/seedance-2-fast', nom: 'Seedance 2.0 Fast (image vers vidéo)', capacite: 'animation', qualite: 4, usage: 'anime l’image de départ jusqu’à son image de fin, son intégré, 4 à 15 s',
    page: 'bytedance/seedance-2-fast', durees: plage(4, 15), son: true, fin: true,
    entrees: [texte('prompt', true), texte('first_frame_url'), texte('last_frame_url'), oui('generate_audio', false, true), choix('resolution', ['480p', '720p'], false, '720p'), choix('aspect_ratio', ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9', 'adaptive'], true, '16:9'), entier('duration', 4, 15, false, 5)],
    defauts: { resolution: '720p', aspect_ratio: 'adaptive' }, tarif: ['seedance-2 fast', '720p no video input'],
  },
  {
    id: 'wan/2-7-image-to-video', nom: 'Wan 2.7 (image vers vidéo)', capacite: 'animation', qualite: 4, usage: 'anime l’image de départ, image de fin possible, 2 à 15 s, sans son',
    page: 'wan/2-7-image-to-video', durees: plage(2, 15), fin: true,
    entrees: [texte('prompt', true), texte('first_frame_url'), texte('last_frame_url'), choix('resolution', ['720p', '1080p'], false, '1080p'), entier('duration', 2, 15, false, 5)],
    defauts: { resolution: '720p' }, tarif: ['wan 2.7 video, image-to-video', '720p'],
  },
  /* Kling 3.0 Turbo et Grok Imagine (image vers vidéo) ne prennent pas d'image de fin : hors de la liste
     choisie (chaque animation choisie en prend une, décision du 24/10/2026), ils restent au catalogue lu en direct. */

  /* ---- contrôle du mouvement ---- */
  {
    id: 'kling-3.0/motion-control', nom: 'Kling 3.0 Motion Control', capacite: 'mouvement', qualite: 5, usage: 'le personnage de l’image reprend les gestes d’une vidéo de référence (3 à 30 s)',
    page: 'kling/motion-control-v3',
    entrees: [texte('prompt'), liste('input_urls', true), liste('video_urls', true), choix('mode', ['720p', '1080p'], false, '720p'), texte('character_orientation')],
    defauts: {}, tarif: ['kling 3.0 motion control', '720p'],
  },

  /* ---- image ---- */
  {
    id: 'nano-banana-2', nom: 'Nano Banana 2', capacite: 'image', qualite: 5, usage: 'cohérence d’un personnage d’une image à l’autre, texte lisible, tous formats',
    page: 'google/nanobanana2',
    entrees: [texte('prompt', true), liste('image_input'), choix('aspect_ratio', ['1:1', '2:3', '3:2', '1:4', '4:1', '3:4', '4:3', '4:5', '5:4', '1:8', '8:1', '9:16', '16:9', '21:9', 'auto'], false, 'auto'), choix('resolution', ['1K', '2K', '4K'], false, '1K'), choix('output_format', ['png', 'jpg'], false, 'jpg')],
    defauts: { resolution: '1K', output_format: 'png' }, tarif: ['nano banana 2', '1k'],
  },
  {
    id: 'seedream/5-pro-text-to-image', nom: 'Seedream 5.0 Pro', capacite: 'image', qualite: 5, usage: 'photo réaliste haute définition',
    page: 'seedream/5-pro-text-to-image',
    entrees: [texte('prompt', true), choix('aspect_ratio', ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'], true), choix('quality', ['basic', 'high'], true), choix('output_format', ['png', 'jpeg'], false, 'png')],
    defauts: { quality: 'basic' }, tarif: ['seedream 5 pro, text-to-image', '1k'],
  },
  {
    id: 'gpt-image-2-text-to-image', nom: 'GPT Image 2', capacite: 'image', qualite: 5, usage: 'compréhension fine de la consigne, texte dans l’image',
    page: 'gpt/gpt-image-2-text-to-image',
    entrees: [texte('prompt', true), choix('aspect_ratio', ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21']), choix('resolution', ['1K', '2K', '4K'])],
    defauts: { resolution: '1K' }, tarif: ['gpt image 2, text-to-image', '1k'],
  },
  {
    id: 'google/imagen4', nom: 'Imagen 4', capacite: 'image', qualite: 4, usage: 'détails fins et texte lisible dans l’image',
    page: 'google/imagen4',
    entrees: [texte('prompt', true), texte('negative_prompt'), choix('aspect_ratio', ['1:1', '16:9', '9:16', '3:4', '4:3', 'auto'], true)],
    defauts: {}, tarif: ['google imagen4, text-to-image, default'],
  },
  {
    id: 'flux-2/pro-text-to-image', nom: 'FLUX 2 Pro', capacite: 'image', qualite: 4, usage: 'photo réaliste',
    page: 'flux2/pro-text-to-image',
    entrees: [texte('prompt', true), choix('aspect_ratio', ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'], true), choix('resolution', ['1K', '2K'], true)],
    defauts: { resolution: '1K' }, tarif: ['flux-2 pro, text-to-image', '1k'],
  },
  {
    id: 'z-image', nom: 'Z-Image', capacite: 'image', qualite: 3, usage: 'brouillons et planches de tendance, très bon marché',
    page: 'z-image/z-image',
    entrees: [texte('prompt', true), choix('aspect_ratio', ['1:1', '4:3', '3:4', '16:9', '9:16'], true)],
    defauts: {}, tarif: ['z-image, text-to-image'],
  },

  /* ---- retouches d'une image (décrites au modèle en mots) ---- */
  { id: 'google/nano-banana-edit', nom: 'Nano Banana Edit', capacite: 'retouche', qualite: 5, usage: 'refait l’image jointe selon la consigne, en gardant sujet et cohérence', page: 'google/nano-banana-edit', entrees: NANO_EDIT, defauts: { output_format: 'png' }, tarif: ['nano banana edit'], retouche: { sources: 3 } },
  { id: 'google/nano-banana-edit', nom: 'Nano Banana Edit', capacite: 'visage', qualite: 4, usage: 'pose le visage des photos fournies sur la personne choisie, plusieurs photos acceptées', page: 'google/nano-banana-edit', entrees: NANO_EDIT, defauts: { output_format: 'png' }, tarif: ['nano banana edit'], retouche: { sources: 3 } },
  { id: 'google/nano-banana-edit', nom: 'Nano Banana Edit', capacite: 'lumiere', qualite: 4, usage: 'direction LIBRE, décrite au modèle en mots', page: 'google/nano-banana-edit', entrees: NANO_EDIT, defauts: { output_format: 'png' }, tarif: ['nano banana edit'], retouche: { lumiere: 'libre', parMots: true } },
  { id: 'google/nano-banana-edit', nom: 'Nano Banana Edit', capacite: 'angles', qualite: 3, usage: 'angle DÉCRIT en mots : moins précis qu’un réglage en degrés', page: 'google/nano-banana-edit', entrees: NANO_EDIT, defauts: { output_format: 'png' }, tarif: ['nano banana edit'], retouche: { parMots: true } },
  {
    id: 'seedream/5-pro-image-to-image', nom: 'Seedream 5.0 Pro Edit', capacite: 'retouche', qualite: 4, usage: 'refait l’image jointe selon la consigne, rendu photo', page: 'seedream/5-pro-image-to-image',
    entrees: [texte('prompt', true), IMAGES_EDIT(true), choix('aspect_ratio', ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'], true), choix('quality', ['basic', 'high'], true), choix('output_format', ['png', 'jpeg'], false, 'png')],
    defauts: { quality: 'basic' }, tarif: ['seedream 5 pro'], retouche: { sources: 3 },
  },

  /*
   * ---- les autres retouches de visage, de lumière et d'angle (26/10/2026) ----
   * « Le modèle, je ne peux pas le sélectionner » : chaque retouche propose
   * maintenant TOUS les modèles qui la savent faire. Schémas recopiés le
   * 26/10/2026 des pages `docs.kie.ai/market/google/pro-image-to-image`,
   * `gpt/gpt-image-2-image-to-image`, `flux2/pro-image-to-image` et
   * `seedream/5-pro-image-to-image` ; prix lus sur la page publique des prix
   * (1K : 18, 6, 5 et 7 crédits l'image). Tous reçoivent l'angle, la lumière
   * ou le visage DÉCRITS en mots (`parMots`).
   */
  ...(['visage', 'lumiere', 'angles'] as const).flatMap((capacite): ModeleKie[] => {
    const usage = { visage: 'pose le visage des photos fournies sur la personne choisie', lumiere: 'direction LIBRE, décrite au modèle en mots', angles: 'angle DÉCRIT en mots : moins précis qu’un réglage en degrés' }[capacite];
    const retouche = capacite === 'lumiere' ? { lumiere: 'libre' as const, parMots: true, sources: 3 } : { parMots: true, sources: 3 };
    const note = (q: Record<typeof capacite, number>) => q[capacite];
    return [
      {
        id: 'nano-banana-pro', nom: 'Nano Banana Pro', capacite, qualite: note({ visage: 5, lumiere: 5, angles: 4 }), usage: `${usage} — le plus fidèle au sujet`, page: 'google/pro-image-to-image',
        entrees: [texte('prompt', true), liste('image_input', true), choix('aspect_ratio', ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9', 'auto'], true, 'auto'), choix('resolution', ['1K', '2K', '4K'], true, '1K'), choix('output_format', ['png', 'jpg'], true, 'png')],
        defauts: { aspect_ratio: 'auto', resolution: '1K', output_format: 'png' }, tarif: ['nano banana pro', '1/2k'], retouche,
      },
      {
        id: 'gpt-image-2-image-to-image', nom: 'GPT Image 2', capacite, qualite: note({ visage: 4, lumiere: 4, angles: 4 }), usage: `${usage} — suit bien une consigne précise`, page: 'gpt/gpt-image-2-image-to-image',
        entrees: [texte('prompt', true), liste('input_urls', true), choix('aspect_ratio', ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '21:9'], true, 'auto'), choix('resolution', ['1K', '2K', '4K'], true, '1K')],
        defauts: { aspect_ratio: 'auto', resolution: '1K' }, tarif: ['gpt image 2', 'image-to-image', '1k'], retouche,
      },
      {
        id: 'seedream/5-pro-image-to-image', nom: 'Seedream 5.0 Pro Edit', capacite, qualite: note({ visage: 4, lumiere: 4, angles: 3 }), usage: `${usage} — rendu photo`, page: 'seedream/5-pro-image-to-image',
        entrees: [texte('prompt', true), IMAGES_EDIT(true), choix('aspect_ratio', ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'], true), choix('quality', ['basic', 'high'], true), choix('output_format', ['png', 'jpeg'], false, 'png')],
        defauts: { quality: 'basic' }, tarif: ['seedream 5 pro', 'image-to-image', '1k'], retouche,
      },
      {
        id: 'flux-2/pro-image-to-image', nom: 'FLUX 2 Pro Edit', capacite, qualite: 3, usage: `${usage} — le moins cher`, page: 'flux2/pro-image-to-image',
        entrees: [liste('input_urls', true), texte('prompt', true), choix('aspect_ratio', ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', 'auto'], true, 'auto'), choix('resolution', ['1K', '2K'], true, '1K')],
        defauts: { aspect_ratio: 'auto', resolution: '1K' }, tarif: ['flux-2 pro', 'image to image', '1k'], retouche,
      },
    ];
  }),

  /* ---- voix ---- */
  { id: 'elevenlabs/text-to-speech-multilingual-v2', nom: 'ElevenLabs multilingue v2 (par kie.ai)', capacite: 'voix', qualite: 5, usage: 'voix off naturelle multilingue ; voix par identifiant (action « voix »)', page: 'elevenlabs/text-to-speech-multilingual-v2', entrees: VOIX_ELEVENLABS, defauts: {}, tarif: ['text to speech, multilingual v2'] },
  { id: 'elevenlabs/text-to-speech-turbo-2-5', nom: 'ElevenLabs Turbo 2.5 (par kie.ai)', capacite: 'voix', qualite: 4, usage: 'voix off rapide et économique, langue imposée possible', page: 'elevenlabs/text-to-speech-turbo-2-5', entrees: VOIX_ELEVENLABS, defauts: {}, tarif: ['text to speech, turbo 2.5'] },

  /* ---- musique ---- */
  {
    id: 'ai-music-api/generate', nom: 'Suno V6 (par kie.ai)', capacite: 'musique', qualite: 5, usage: 'musique originale de 10 s à 6 min, instrumentale par défaut',
    page: '../suno-api/generate-music',
    entrees: [texte('prompt'), oui('custom_mode', true), oui('instrumental', true), choix('model', ['V6', 'V6_MINI', 'V6_WILD'], true), { nom: 'duration', type: 'number', min: 10, max: 360, requis: false }],
    defauts: { custom_mode: false, instrumental: true, model: 'V6' }, tarif: ['suno, generate music'],
  },

  /* ---- synchronisation labiale ---- */
  {
    id: 'volcengine/video-to-video-lip-sync', nom: 'Volcengine Lip Sync', capacite: 'synchro', qualite: 4, usage: 'recale les lèvres d’une vidéo face caméra sur une nouvelle voix',
    page: 'volcengine/video-to-video-lip-sync',
    entrees: [choix('mode', ['lite', 'basic'], true), texte('video_url', true), texte('audio_url', true), oui('separate_vocal', false, false)],
    defauts: { mode: 'lite' }, tarif: ['volcengine, lip sync'],
  },
];

/** Un modèle du catalogue kie.ai (la capacité tranche quand il en sert plusieurs). */
export function modeleKie(id: unknown, capacite?: unknown): ModeleKie | undefined {
  const tous = MODELES_KIE.filter((m) => m.id === id);
  return (capacite ? tous.find((m) => m.capacite === capacite) : undefined) ?? tous[0];
}

/* ------------------------------------------------------------------ */
/* Les appels                                                          */
/* ------------------------------------------------------------------ */

export function entetesKie(cle: string): Record<string, string> {
  return { Authorization: `Bearer ${cle}` };
}

/** La lecture GRATUITE du solde : elle prouve aussi la clé. */
export function requeteDuSoldeKie(cle: string): RequeteHttp {
  return { methode: 'GET', adresse: `${KIE_API}/api/v1/chat/credit`, entetes: entetesKie(cle) };
}

/** Le solde lu, en crédits ; `null` si la réponse ne le porte pas. */
export function lireSoldeKie(corps: any): number | null {
  if (Number(corps?.code) !== 200) return null;
  const n = Number(corps?.data);
  return Number.isFinite(n) ? n : null;
}

/** Le verdict d'un test de clé : kie.ai répond en 200 et dit son verdict dans `code`. */
export function verdictDuSoldeKie(statut: number, corps: any): { ok: boolean; raison?: string } {
  const code = Number(corps?.code ?? statut);
  if (statut === 401 || statut === 403 || code === 401 || code === 403) return { ok: false, raison: 'le service refuse cette clé (elle est fausse, expirée ou retirée)' };
  if (statut >= 500) return { ok: false, raison: `le service ne répond pas en ce moment (${statut}) : réessayez plus tard` };
  if (code === 200 || code === 429) return { ok: true };
  return { ok: false, raison: `réponse inattendue du service (${code})` };
}

/** La commande d'un travail : une seule adresse pour tous les modèles. */
export function requeteDeCommandeKie(modele: string, cle: string, input: Record<string, unknown>): RequeteHttp {
  return { methode: 'POST', adresse: `${KIE_API}/api/v1/jobs/createTask`, entetes: { ...entetesKie(cle), 'Content-Type': 'application/json' }, corps: { model: modele, input } };
}

export function adresseDeSuiviKie(taskId: string): string {
  return `${KIE_API}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`;
}

function raisonKie(corps: any, defaut: string): string {
  const brut = corps?.data?.failMsg || corps?.msg || corps?.message || defaut;
  return String(brut).slice(0, 240);
}

/** Un `code` d'erreur de kie.ai, dit en clair. */
function refusKie(code: number, corps: any): EtatDeGeneration {
  if (code === 401 || code === 403) return { etat: 'echec', raison: 'kie.ai refuse la clé enregistrée : retestez-la dans « Services de création »' };
  if (code === 402) return { etat: 'echec', raison: 'le crédit de votre compte kie.ai est épuisé : rechargez-le sur kie.ai' };
  if (code === 429) return { etat: 'echec', raison: 'kie.ai limite les demandes en ce moment : réessayez dans une minute' };
  return { etat: 'echec', raison: `kie.ai a refusé la commande (${code}) : ${raisonKie(corps, 'sans détail')}` };
}

/** La réponse à la COMMANDE : le travail à suivre, ou le refus avec sa raison. */
export function lireCommandeKie(statut: number, corps: any): EtatDeGeneration {
  if (statut >= 500) return { etat: 'echec', raison: `kie.ai ne répond pas en ce moment (${statut})` };
  const code = Number(corps?.code ?? statut);
  if (code !== 200) return refusKie(code, corps);
  const id = corps?.data?.taskId;
  return id ? { etat: 'attente', suivi: adresseDeSuiviKie(String(id)) } : { etat: 'echec', raison: 'kie.ai n’a rendu aucun travail à suivre' };
}

function analyser(brut: unknown): any {
  if (typeof brut !== 'string') return brut ?? null;
  try {
    return JSON.parse(brut);
  } catch {
    return null;
  }
}

/** L'adresse du fichier rendu : `resultUrls[0]`, ou la première piste de Suno. */
export function fichierDuResultatKie(data: any): string | null {
  for (const r of [data?.response, analyser(data?.resultJson)]) {
    const url = r?.resultUrls?.[0] ?? r?.data?.[0]?.audio_url ?? r?.data?.[0]?.audioUrl ?? r?.sunoData?.[0]?.audioUrl;
    if (typeof url === 'string' && url) return url;
  }
  return null;
}

/**
 * LA RÉPONSE AU SUIVI : encore en cours, fini (avec le fichier et le COÛT RÉEL
 * en dollars, depuis `creditsConsumed`), ou en échec avec la raison de kie.ai.
 */
export function lireSuiviKie(statut: number, corps: any, suivi = ''): EtatDeGeneration {
  if (statut >= 500 || statut === 429) return { etat: 'attente', suivi };
  const code = Number(corps?.code ?? statut);
  if (code === 422) return { etat: 'echec', raison: 'kie.ai ne retrouve plus ce travail' };
  if (code === 429 || code >= 500) return { etat: 'attente', suivi };
  if (code !== 200) return refusKie(code, corps);
  const d = corps?.data ?? {};
  const etat = String(d.state ?? '');
  if (etat === 'fail') return { etat: 'echec', raison: `kie.ai : ${raisonKie(corps, 'échec de la génération')}` };
  if (etat !== 'success') return { etat: 'attente', suivi };
  const url = fichierDuResultatKie(d);
  if (!url) return { etat: 'echec', raison: 'kie.ai a fini sans fichier' };
  const credits = Number(d.creditsConsumed);
  return { etat: 'fini', url, ...(Number.isFinite(credits) && credits >= 0 ? { coutReel: Math.round(credits * DOLLARS_PAR_CREDIT * 1e4) / 1e4 } : {}) };
}

/** L'adresse publique d'un fichier déposé (`file-stream-upload`), ou la raison du refus. */
export function lireEnvoiKie(statut: number, corps: any): { ok: true; url: string } | { ok: false; raison: string } {
  const url = corps?.data?.downloadUrl ?? corps?.data?.fileUrl;
  if (statut === 200 && Number(corps?.code ?? 200) === 200 && typeof url === 'string' && url) return { ok: true, url };
  return { ok: false, raison: `kie.ai refuse le dépôt du fichier (${corps?.code ?? statut}${corps?.msg ? ` : ${String(corps.msg).slice(0, 120)}` : ''})` };
}

/* ------------------------------------------------------------------ */
/* Le prix, lu sur la page publique des prix                            */
/* ------------------------------------------------------------------ */

export interface LigneDePrixKie {
  modelDescription?: string;
  creditPrice?: string | number;
  creditUnit?: string;
  anchor?: string;
}

/** La demande d'une page de la liste publique des prix (100 lignes au plus par page). */
export function requeteDesPrixKie(page: number): RequeteHttp {
  return {
    methode: 'POST',
    adresse: `${KIE_API}/client/v1/model-pricing/page`,
    entetes: { 'Content-Type': 'application/json' },
    corps: { pageNum: page, pageSize: 100, modelDescription: '', interfaceType: '' },
  };
}

/** Le modèle visé par une ligne de prix, quand son lien le nomme (`?model=…`). */
function modeleDeLaLigne(l: LigneDePrixKie): string | null {
  const m = /[?&]model=([^&#]+)/.exec(String(l.anchor ?? ''));
  return m ? decodeURIComponent(m[1]!) : null;
}

/**
 * LE PRIX D'UNE COMMANDE, en dollars, depuis la liste publique : les lignes
 * dont la description porte TOUS les mots du tarif (ou, pour un modèle lu en
 * direct, dont le lien nomme le modèle). Plusieurs lignes : la plus chère — un
 * plafond n'est jamais sous-estimé. `null` quand rien ne correspond ou que
 * l'unité est inconnue : l'accord est alors demandé sans prix.
 */
export function prixKie(
  lignes: readonly LigneDePrixKie[],
  cible: { tarif?: readonly string[]; id?: string },
  quantite: { secondes?: number; caracteres?: number },
): number | null {
  const mots = (cible.tarif ?? []).map((m) => m.toLowerCase());
  const retenues = lignes.filter((l) =>
    mots.length ? mots.every((m) => String(l.modelDescription ?? '').toLowerCase().includes(m)) : !!cible.id && modeleDeLaLigne(l) === cible.id,
  );
  let plus: number | null = null;
  for (const l of retenues) {
    const credits = Number(l.creditPrice);
    if (!Number.isFinite(credits) || credits < 0) return null;
    const unite = String(l.creditUnit ?? '').toLowerCase().trim();
    let total: number;
    if (/^per (video|image|request|generation|upscale)$/.test(unite)) total = credits;
    else if (unite === 'per second' && quantite.secondes) total = credits * quantite.secondes;
    else if (unite === 'per 1000 characters' && quantite.caracteres) total = (credits * quantite.caracteres) / 1000;
    else return null;
    plus = Math.max(plus ?? 0, total);
  }
  return plus === null ? null : Math.round(plus * DOLLARS_PAR_CREDIT * 1e4) / 1e4;
}

/* ------------------------------------------------------------------ */
/* Le catalogue lu dans la documentation publique                       */
/* ------------------------------------------------------------------ */

export interface ModeleKieLu {
  /** La page sous `docs.kie.ai/market/` (sans « .md ») : l'identifiant donné à l'agent tant que la page n'est pas lue. */
  page: string;
  nom: string;
  famille: string;
  capacite: CapaciteDeGeneration;
  categorie: string;
}

/**
 * LES MODÈLES DE kie.ai, LUS DANS `https://docs.kie.ai/llms.txt` : chaque
 * ligne « - <Genre> Models > <Famille> [<Nom>](https://docs.kie.ai/market/….md) »
 * donne un modèle et sa page. Écartés : la version chinoise (`/cn/`), les
 * modèles de conversation, les pages de rappel et ce que la réalisation ne
 * sait pas servir.
 */
export function modelesKieDeLaDoc(texteDeLaDoc: string): ModeleKieLu[] {
  const sortie: ModeleKieLu[] = [];
  const vues = new Set<string>();
  for (const ligne of String(texteDeLaDoc ?? '').split('\n')) {
    const m = /^- (Image|Video|Music)\s+Models > ([^[]+?) \[([^\]]+)\]\(https:\/\/docs\.kie\.ai\/market\/([^)]+)\.md\)/.exec(ligne.trim());
    if (!m || m[4]!.startsWith('cn/') || /callback/i.test(m[3]!)) continue;
    const [, genre, famille, nom, page] = m as unknown as [string, string, string, string, string];
    if (vues.has(page)) continue;
    const t = `${page} ${nom}`.toLowerCase();
    let categorie: string;
    if (/motion[- ]?control|animate-move/.test(t)) categorie = 'video-to-video';
    else if (genre === 'Video') categorie = /lip[- ]?sync/.test(t) ? 'lip-sync' : /image[- ]to[- ]video|keyframe|i2v/.test(t) ? 'image-to-video' : /text[- ]to[- ]video|t2v|\bvideo$/.test(t) ? 'text-to-video' : 'autre';
    else if (genre === 'Image') categorie = /edit|image[- ]to[- ]image|remix/.test(t) ? 'image-to-image' : /upscale|remove|segment|layer/.test(t) ? 'autre' : 'text-to-image';
    else categorie = /text[- ]to[- ]speech|tts/.test(t) ? 'text-to-speech' : /generate-music|music generation|generate music/.test(t) ? 'text-to-audio' : 'autre';
    const capacite: CapaciteDeGeneration | null =
      categorie === 'video-to-video' ? 'mouvement'
      : categorie === 'image-to-video' ? 'animation'
      : categorie === 'text-to-video' ? 'video'
      : categorie === 'lip-sync' ? 'synchro'
      : categorie === 'image-to-image' ? 'retouche'
      : categorie === 'text-to-image' ? 'image'
      : categorie === 'text-to-speech' ? 'voix'
      : null;
    if (!capacite) continue;
    vues.add(page);
    sortie.push({ page, nom: nom.trim().slice(0, 90), famille: famille.trim(), capacite, categorie });
  }
  return sortie;
}

/* Une lecture YAML minimale, juste ce que portent les pages de kie.ai : des
   tables par retrait, des listes « - », des textes sur plusieurs lignes (> |). */
type NoeudYaml = unknown;

function scalaire(brut: string): unknown {
  const s = brut.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) return s.slice(1, -1).replace(/''/g, "'");
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s.startsWith('[') && s.endsWith(']')) return s.slice(1, -1).split(',').map((x) => scalaire(x)).filter((x) => x !== null);
  return s;
}

function lireBloc(lignes: string[], i: number, retrait: number): [NoeudYaml, number] {
  const prochaine = (k: number) => {
    while (k < lignes.length && !lignes[k]!.trim()) k++;
    return k;
  };
  i = prochaine(i);
  if (i >= lignes.length) return [null, i];
  const estListe = lignes[i]!.slice(retrait).startsWith('- ') || lignes[i]!.slice(retrait) === '-';
  const table: Record<string, unknown> = {};
  const suite: unknown[] = [];
  while (i < lignes.length) {
    i = prochaine(i);
    if (i >= lignes.length) break;
    const ligne = lignes[i]!;
    const r = ligne.length - ligne.trimStart().length;
    if (r < retrait) break;
    if (r > retrait) {
      i++;
      continue;
    }
    let contenu = ligne.trim();
    if (estListe) {
      if (!contenu.startsWith('-')) break;
      contenu = contenu.slice(1).trim();
      if (!contenu) {
        const [v, j] = lireBloc(lignes, i + 1, retrait + 2);
        suite.push(v);
        i = j;
        continue;
      }
      if (/^[\w$.-]+:(\s|$)/.test(contenu) && !contenu.startsWith('http')) {
        /* Un élément de liste qui ouvre une table : on la relit au retrait de son contenu. */
        const copie = [...lignes];
        copie[i] = ' '.repeat(retrait + 2) + contenu;
        const [v, j] = lireBloc(copie, i, retrait + 2);
        suite.push(v);
        i = j;
        continue;
      }
      suite.push(scalaire(contenu.replace(/^&\S+\s*/, '')));
      i++;
      continue;
    }
    const m = /^("[^"]*"|'[^']*'|[^:]+?):(?:\s+(.*))?$/.exec(contenu);
    if (!m) {
      i++;
      continue;
    }
    const cle = String(scalaire(m[1]!));
    const valeur = (m[2] ?? '').replace(/^&\S+\s*/, '').trim();
    if (/^[>|][-+]?$/.test(valeur)) {
      const morceaux: string[] = [];
      let j = i + 1;
      while (j < lignes.length && (!lignes[j]!.trim() || lignes[j]!.length - lignes[j]!.trimStart().length > retrait)) morceaux.push(lignes[j++]!.trim());
      table[cle] = morceaux.join(valeur.startsWith('|') ? '\n' : ' ').trim();
      i = j;
    } else if (valeur && !valeur.startsWith('#')) {
      table[cle] = scalaire(valeur);
      i++;
    } else {
      const j0 = prochaine(i + 1);
      const r2 = j0 < lignes.length ? lignes[j0]!.length - lignes[j0]!.trimStart().length : -1;
      const liste2 = j0 < lignes.length && lignes[j0]!.trimStart().startsWith('- ');
      if (r2 > retrait || (liste2 && r2 === retrait)) {
        const [v, j] = lireBloc(lignes, j0, r2);
        table[cle] = v;
        i = j;
      } else {
        table[cle] = null;
        i++;
      }
    }
  }
  return [estListe ? suite : table, i];
}

/** Le YAML d'un bloc « ```yaml … ``` », en objet (sous-ensemble suffisant pour les pages de kie.ai). */
export function lireYamlSimple(texteYaml: string): any {
  return lireBloc(String(texteYaml ?? '').replace(/\t/g, '  ').split('\n'), 0, 0)[0];
}

/**
 * LE SCHÉMA D'UN MODÈLE, LU SUR SA PAGE : l'OpenAPI embarqué de la commande
 * (`POST /api/v1/jobs/createTask`) donne l'identifiant (`model`) et les
 * entrées (`input`). `null` quand la page n'en porte pas.
 */
export function entreesDeLaPageKie(page: string, nommer: (schema: any) => EntreeDeModele[]): { id: string; entrees: EntreeDeModele[] } | null {
  const bloc = /```yaml\n(openapi:[\s\S]*?)\n```/.exec(String(page ?? ''))?.[1];
  if (!bloc) return null;
  let api: any;
  try {
    api = lireYamlSimple(bloc);
  } catch {
    return null;
  }
  const schema = api?.paths?.['/api/v1/jobs/createTask']?.post?.requestBody?.content?.['application/json']?.schema;
  const modele = schema?.properties?.model;
  const id = (Array.isArray(modele?.enum) ? modele.enum[0] : undefined) ?? modele?.default ?? (Array.isArray(modele?.examples) ? modele.examples[0] : undefined);
  const input = schema?.properties?.input;
  if (typeof id !== 'string' || !id || !input?.properties) return null;
  const entrees = nommer(input);
  return entrees.length ? { id, entrees } : null;
}
