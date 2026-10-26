/**
 * LE CATALOGUE OUVERT DES SERVICES DE GÉNÉRATION (mode « Réalisation », carte
 * du 18/10/2026). Règles PURES : quels services, ce que chacun sait faire
 * (image, vidéo, voix, son, musique, avatar), ses modèles avec une note de
 * qualité DATÉE, la demande à envoyer et la lecture de la réponse.
 * `server/src/realisation.ts` fait les appels ; `server/src/test/realisation.test.ts`
 * verrouille ces règles.
 *
 * LE STUDIO N'EST PAS TOUCHÉ : ses huit services (`SERVICES_CREATION`,
 * `shared/src/studio-services.ts`) sont REPRIS tels quels pour la vidéo, et ce
 * module n'y ajoute que ce qui manque — HeyGen (présentateur, vidéo), ElevenLabs
 * (voix, bruitages, musique), les modèles d'IMAGE de fal.ai, Replicate et
 * OpenRouter. Un nouveau service s'ajoute ICI, sans rien changer au Studio.
 *
 * PRIX : jamais écrit à la main. fal.ai PUBLIE ses prix (lus en direct par
 * l'API), OpenRouter rend le coût RÉEL après coup ; les autres ne publient pas
 * de prix par leur API — le devis dit alors « prix non publié », et l'accord
 * de l'utilisateur est toujours demandé (`shared/src/mode-realisation.ts`).
 *
 * Vérifié dans la documentation officielle le 18/10/2026 :
 *  - HeyGen v3 (les v1/v2 sont dépréciées) : `x-api-key`, `GET /v3/users/me`,
 *    `POST /v3/videos` (type « avatar » : avatar_id, script, voice_id),
 *    `POST /v3/models/videos` (heygen-video-1, 5 à 15 s), suivi
 *    `GET /v3/videos/{id}` → `data.status` completed/failed, `data.video_url` ;
 *    `GET /v3/avatars/looks`, `GET /v3/voices`.
 *  - ElevenLabs : `xi-api-key`, `POST /v1/text-to-speech/{voice_id}` (text,
 *    model_id), `POST /v1/sound-generation` (text, duration_seconds 0,5 à 30),
 *    `POST /v1/music` (prompt, music_length_ms 3 000 à 600 000) — réponses en
 *    fichier audio ; `GET /v1/voices`.
 *  - OpenRouter : `GET /api/v1/models?output_modalities=image` (public), image
 *    par `POST /api/v1/chat/completions` avec `modalities: ['image','text']`,
 *    l'image revient en adresse `data:` dans `choices[0].message.images`.
 */

import { corpsEnDirect } from './catalogue-en-direct.js';
import { MODELES_KIE, lireCommandeKie, lireSuiviKie, modeleKie, requeteDeCommandeKie } from './kie.js';
import { DIRECTIONS_FIBO, DIRECTIONS_ICLIGHT, type AngleDeVue, type DirectionDeLumiere, type DirectionsDuModele } from './retouches-de-media.js';
import {
  SERVICES_CREATION,
  type IdServiceCreation,
  type RatioClip,
  type RequeteHttp,
  type ServiceDeCreation,
} from './studio-services.js';

/**
 * « synchro » : la synchronisation labiale — une vidéo d'un visage qui parle reçoit une autre voix, ses lèvres recalées.
 * « animation » : une IMAGE retenue devient le plan vidéo (image vers vidéo) — la fabrication d'une vidéo
 * passe par là depuis le 24/10/2026. « angles », « lumiere », « visage » : les retouches d'une image
 * (`shared/src/retouches-de-media.ts`).
 */
export const CAPACITES_DE_GENERATION = ['image', 'video', 'voix', 'son', 'musique', 'avatar', 'synchro', 'animation', 'mouvement', 'angles', 'lumiere', 'visage', 'retouche'] as const;
export type CapaciteDeGeneration = (typeof CAPACITES_DE_GENERATION)[number];

/** Les services EN PLUS de ceux du Studio : ils n'apparaissent jamais dans le Studio. */
export const IDS_SERVICES_EN_PLUS = ['heygen', 'elevenlabs'] as const;
export type IdServiceEnPlus = (typeof IDS_SERVICES_EN_PLUS)[number];

export type IdServiceGeneration = IdServiceCreation | IdServiceEnPlus;

/** Le format voulu d'un média : les quatre cadrages des réseaux et de l'écran. */
export type FormatDeMedia = '16:9' | '9:16' | '1:1' | '4:5';

/** D'où vient le prix d'un modèle. */
export type SourceDuPrix = 'api-fal' | 'cout-reel-openrouter' | 'credits-kie' | 'non-publie';

export interface ModeleDeGeneration {
  service: IdServiceGeneration;
  /** L'identifiant du modèle CHEZ LE SERVICE. */
  id: string;
  nom: string;
  capacite: CapaciteDeGeneration;
  /** 1 à 5 : la qualité de rendu relative, notée le 18/10/2026. */
  qualite: number;
  /** À quoi il sert le mieux, en une phrase. */
  usage: string;
  prix: SourceDuPrix;
  /** Vidéo seulement : durées acceptées (s), cadrages, son intégré. */
  durees?: number[];
  ratios?: RatioClip[];
  son?: boolean;
  /** Animation : le modèle reçoit aussi une IMAGE DE FIN (le plan va de l'image de départ à celle-ci). */
  fin?: boolean;
  /**
   * LES RETOUCHES (angles, lumière, visage) : ce que le modèle accepte.
   * `lumiere` : « libre » (direction décrite en mots) ou ses directions fixes ;
   * `sources` : combien d'images de référence il prend en plus de l'image
   * retouchée ; `parMots` : il ne reçoit qu'une description (moins précis).
   */
  retouche?: { lumiere?: DirectionsDuModele; sources?: number; parMots?: boolean; verticalMin?: number; verticalMax?: number };
}

/** La date des notes de qualité : un avis daté se relit, il ne se croit pas éternel. */
export const DATE_DES_NOTES = '18/10/2026';

/** Les services EN PLUS, au même gabarit que ceux du Studio (rangés dans le même coffre). */
export const SERVICES_EN_PLUS: readonly (Omit<ServiceDeCreation, 'id'> & { id: IdServiceEnPlus })[] = [
  {
    id: 'heygen',
    nom: 'HeyGen',
    description: 'Présentateurs humains réalistes qui disent votre texte, et courtes vidéos générées.',
    adresseCle: 'https://app.heygen.com/settings/api',
    champs: [{ id: 'cle', libelle: 'Clé d’API' }],
    modeles: [],
  },
  {
    id: 'elevenlabs',
    nom: 'ElevenLabs',
    description: 'Voix off dans toutes les langues, bruitages et musique.',
    adresseCle: 'https://elevenlabs.io/app/settings/api-keys',
    champs: [{ id: 'cle', libelle: 'Clé d’API' }],
    modeles: [],
  },
];

/** Tous les services branchables, Studio compris, dans l'ordre d'affichage des réglages. */
export const SERVICES_DE_GENERATION: readonly (Omit<ServiceDeCreation, 'id'> & { id: IdServiceGeneration })[] = [
  ...SERVICES_CREATION,
  ...SERVICES_EN_PLUS,
];

export function serviceDeGeneration(id: unknown) {
  return SERVICES_DE_GENERATION.find((s) => s.id === id);
}

/**
 * LES NOTES DES MODÈLES VIDÉO DU STUDIO, par identifiant de modèle : la
 * qualité relative et l'usage. Un modèle absent de cette table reçoit 3 et un
 * usage générique — jamais une note inventée plus haute.
 */
const NOTES_VIDEO: Record<string, { qualite: number; usage: string }> = {
  'veo-3-1-fast': { qualite: 5, usage: 'réalisme photo, son et dialogues intégrés' },
  'google/veo-3.1-fast': { qualite: 5, usage: 'réalisme photo, son et dialogues intégrés' },
  'veo3.1_fast': { qualite: 5, usage: 'réalisme photo, son et dialogues intégrés' },
  'fal-ai/veo3/fast': { qualite: 5, usage: 'réalisme photo, son intégré, prix publié' },
  'google/veo-3-fast': { qualite: 5, usage: 'réalisme photo, son intégré' },
  'dreamina-seedance-2-0-260128': { qualite: 5, usage: 'plans multiples cohérents, mouvements de caméra, son' },
  'dreamina-seedance-2-0-fast-260128': { qualite: 4, usage: 'plans multiples, rapide, son' },
  'bytedance/seedance-2-fast': { qualite: 4, usage: 'plans multiples, rapide, son' },
  'gen4.5': { qualite: 5, usage: 'direction artistique et cohérence de personnage' },
  'kling-v3-turbo-720p': { qualite: 4, usage: 'mouvements physiques, action' },
  'kling-video/v2.5-turbo/pro/text-to-video': { qualite: 4, usage: 'mouvements physiques, action' },
  'fal-ai/kling-video/v2.1/master/text-to-video': { qualite: 4, usage: 'mouvements physiques, action' },
  'kwaivgi/kling-v2.1-master': { qualite: 4, usage: 'mouvements physiques, action' },
  'kling/kling-2.5': { qualite: 4, usage: 'mouvements physiques, action' },
  'minimax/hailuo-2.3/standard/text-to-video': { qualite: 3, usage: 'essais rapides, expressions' },
  'wan-2-5-t2v-720p': { qualite: 3, usage: 'essais économiques' },
  'seedance-1-0-pro-fast-251015': { qualite: 3, usage: 'essais rapides' },
  'fal-ai/bytedance/seedance/v1/pro/text-to-video': { qualite: 3, usage: 'essais, prix publié' },
  'bytedance/seedance-1-pro-fast': { qualite: 3, usage: 'essais rapides' },
  ...Object.fromEntries(MODELES_KIE.filter((m) => m.capacite === 'video').map((m) => [m.id, { qualite: m.qualite, usage: m.usage }])),
};

/** Le modèle d'image OpenRouter retenu quand l'agent n'en nomme pas (lu dans /models). */
export const MODELE_IMAGE_OPENROUTER_PAR_DEFAUT = 'google/gemini-nano-banana-2.1';

/** Le modèle d'OpenRouter des retouches décrites en mots (lumière, visage) : celui des images, qui lit les images jointes. */
export const MODELE_IMAGE_OPENROUTER_DE_RETOUCHE = MODELE_IMAGE_OPENROUTER_PAR_DEFAUT;

/** Les modèles d'image, de son et d'avatar AJOUTÉS (ceux de la vidéo viennent du Studio). */
const MODELES_EN_PLUS: readonly ModeleDeGeneration[] = [
  { service: 'fal', id: 'fal-ai/flux-pro/v1.1-ultra', nom: 'FLUX 1.1 Pro Ultra', capacite: 'image', qualite: 5, usage: 'photo réaliste haute définition', prix: 'api-fal' },
  { service: 'fal', id: 'fal-ai/imagen4/preview', nom: 'Imagen 4', capacite: 'image', qualite: 5, usage: 'détails fins et texte lisible dans l’image', prix: 'api-fal' },
  { service: 'fal', id: 'fal-ai/nano-banana', nom: 'Nano Banana', capacite: 'image', qualite: 4, usage: 'cohérence d’un personnage d’une image à l’autre', prix: 'api-fal' },
  { service: 'fal', id: 'fal-ai/flux/schnell', nom: 'FLUX Schnell', capacite: 'image', qualite: 3, usage: 'brouillons et planches de tendance, très bon marché', prix: 'api-fal' },
  /*
   * LES RETOUCHES D'UNE IMAGE ET L'ANIMATION D'UN PLAN (24/10/2026) — schémas
   * lus le 24/10/2026 dans `GET https://api.fal.ai/v1/models?endpoint_id=…&expand=openapi-3.0`
   * (statut « active ») et dans la documentation de Higgsfield
   * (docs.higgsfield.ai, `alibaba/qwen-image-3/edit`, `kling-video/v3.0/pro/image-to-video`).
   * Aucun Magnific (décision de l'utilisateur). Les prix fal se relisent au devis.
   */
  { service: 'fal', id: 'fal-ai/kling-video/v3/pro/image-to-video', nom: 'Kling 3.0 Pro (image vers vidéo)', capacite: 'animation', qualite: 5, usage: 'anime l’image de départ d’un plan jusqu’à son image de fin, avec son, 3 à 15 s', prix: 'api-fal', durees: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], son: true, fin: true },
  { service: 'fal', id: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video', nom: 'Kling 2.5 Turbo Pro (image vers vidéo)', capacite: 'animation', qualite: 4, usage: 'anime l’image retenue d’un plan, image de fin possible, 5 ou 10 s, meilleur prix', prix: 'api-fal', durees: [5, 10], fin: true },
  { service: 'higgsfield', id: 'kling-video/v3.0/pro/image-to-video', nom: 'Kling 3.0 Pro (image vers vidéo, par Higgsfield)', capacite: 'animation', qualite: 5, usage: 'anime l’image de départ d’un plan jusqu’à son image de fin, avec son, 3 à 15 s', prix: 'non-publie', durees: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], son: true, fin: true },
  /*
   * LE CONTRÔLE DU MOUVEMENT (« motion control », 24/10/2026) : le personnage
   * de l'image reprend les gestes d'une VIDÉO DE RÉFÉRENCE (3 à 30 s), la durée
   * suit la vidéo. Schémas lus le 24/10/2026 : fal `fal-ai/kling-video/v3/…/motion-control`
   * (image_url, video_url, character_orientation image|video, keep_original_sound)
   * et Higgsfield `kling-video/v3/motion-control/…` (mêmes champs, son en « yes »/« no »).
   */
  { service: 'fal', id: 'fal-ai/kling-video/v3/pro/motion-control', nom: 'Kling 3.0 Pro Motion Control', capacite: 'mouvement', qualite: 5, usage: 'le personnage de l’image reprend les gestes d’une vidéo de référence (3 à 30 s)', prix: 'api-fal' },
  { service: 'fal', id: 'fal-ai/kling-video/v3/standard/motion-control', nom: 'Kling 3.0 Standard Motion Control', capacite: 'mouvement', qualite: 4, usage: 'même transfert de mouvement, moins cher', prix: 'api-fal' },
  { service: 'higgsfield', id: 'kling-video/v3/motion-control/pro', nom: 'Kling 3.0 Pro Motion Control (par Higgsfield)', capacite: 'mouvement', qualite: 5, usage: 'le personnage de l’image reprend les gestes d’une vidéo de référence (3 à 30 s)', prix: 'non-publie' },
  { service: 'higgsfield', id: 'kling-video/v3/motion-control/std', nom: 'Kling 3.0 Standard Motion Control (par Higgsfield)', capacite: 'mouvement', qualite: 4, usage: 'même transfert de mouvement, moins cher', prix: 'non-publie' },
  { service: 'fal', id: 'fal-ai/qwen-image-edit-2511-multiple-angles', nom: 'Qwen Image Edit Multiple Angles', capacite: 'angles', qualite: 5, usage: 'le même sujet sous un autre angle, réglé en degrés (rotation, hauteur, cadrage)', prix: 'api-fal', retouche: { verticalMin: -30, verticalMax: 90 } },
  { service: 'fal', id: 'fal-ai/flux-2-lora-gallery/multiple-angles', nom: 'FLUX 2 Multiple Angles', capacite: 'angles', qualite: 4, usage: 'autre angle réglé en degrés, caméra jamais sous le sujet', prix: 'api-fal', retouche: { verticalMin: 0, verticalMax: 60 } },
  { service: 'higgsfield', id: 'alibaba/qwen-image-3/edit', nom: 'Qwen Image 3 Edit (par Higgsfield)', capacite: 'angles', qualite: 3, usage: 'angle DÉCRIT en mots : moins précis (l’outil « Angles » de Higgsfield n’est pas dans son API)', prix: 'non-publie', retouche: { parMots: true } },
  { service: 'fal', id: 'fal-ai/iclight-v2', nom: 'IC-Light v2', capacite: 'lumiere', qualite: 4, usage: 'rééclaire l’image, lumière venant de la gauche, la droite, le haut ou le bas', prix: 'api-fal', retouche: { lumiere: DIRECTIONS_ICLIGHT } },
  { service: 'fal', id: 'bria/fibo-edit/relight', nom: 'Fibo Edit Relight', capacite: 'lumiere', qualite: 4, usage: 'rééclaire l’image : face, côté, haut ou bas, avec un type de lumière (soleil bas, studio…)', prix: 'api-fal', retouche: { lumiere: DIRECTIONS_FIBO } },
  { service: 'higgsfield', id: 'alibaba/qwen-image-3/edit', nom: 'Qwen Image 3 Edit (par Higgsfield)', capacite: 'lumiere', qualite: 3, usage: 'direction LIBRE, décrite au modèle en mots', prix: 'non-publie', retouche: { lumiere: 'libre', parMots: true } },
  { service: 'openrouter', id: MODELE_IMAGE_OPENROUTER_DE_RETOUCHE, nom: 'Gemini Nano Banana (par OpenRouter)', capacite: 'lumiere', qualite: 4, usage: 'direction LIBRE, décrite au modèle en mots ; coût réel relevé après', prix: 'cout-reel-openrouter', retouche: { lumiere: 'libre', parMots: true } },
  { service: 'fal', id: 'fal-ai/nano-banana/edit', nom: 'Nano Banana Edit', capacite: 'visage', qualite: 4, usage: 'pose le visage des photos fournies sur la personne choisie, plusieurs photos acceptées', prix: 'api-fal', retouche: { sources: 3 } },
  { service: 'higgsfield', id: 'alibaba/qwen-image-3/edit', nom: 'Qwen Image 3 Edit (par Higgsfield)', capacite: 'visage', qualite: 3, usage: 'visage remplacé d’après deux photos au plus, décrit en mots', prix: 'non-publie', retouche: { sources: 2, parMots: true } },
  { service: 'openrouter', id: MODELE_IMAGE_OPENROUTER_DE_RETOUCHE, nom: 'Gemini Nano Banana (par OpenRouter)', capacite: 'visage', qualite: 4, usage: 'visage remplacé d’après plusieurs photos ; coût réel relevé après', prix: 'cout-reel-openrouter', retouche: { sources: 3, parMots: true } },
  /* REFAIRE UNE IMAGE D'APRÈS ELLE-MÊME (« Redemander avec une consigne ») : l'image jointe part avec la nouvelle consigne.
     Mêmes modèles que le visage, placés APRÈS : sans « capacite », un devis garde le sens d'avant (visage). */
  { service: 'fal', id: 'fal-ai/nano-banana/edit', nom: 'Nano Banana Edit', capacite: 'retouche', qualite: 5, usage: 'refait l’image jointe selon la consigne, en gardant sujet et cohérence', prix: 'api-fal', retouche: { sources: 3 } },
  { service: 'higgsfield', id: 'alibaba/qwen-image-3/edit', nom: 'Qwen Image 3 Edit (par Higgsfield)', capacite: 'retouche', qualite: 4, usage: 'refait l’image jointe selon la consigne', prix: 'non-publie', retouche: { sources: 2 } },
  { service: 'openrouter', id: MODELE_IMAGE_OPENROUTER_DE_RETOUCHE, nom: 'Gemini Nano Banana (par OpenRouter)', capacite: 'retouche', qualite: 4, usage: 'refait l’image jointe selon la consigne ; coût réel relevé après', prix: 'cout-reel-openrouter', retouche: { sources: 3 } },
  /*
   * SYNCHRONISATION LABIALE ET VOIX CHEZ fal.ai (service retenu par
   * l'utilisateur le 24/10/2026). Relevés le 24/10/2026 dans l'API publique
   * `GET https://api.fal.ai/v1/models?endpoint_id=…` (statut « active ») et leur
   * schéma d'entrée (`video_url` + `audio_url` ; `text` ou `prompt` pour la
   * voix). Tarifs vus alors sur leurs pages, POUR MÉMOIRE SEULEMENT — le devis
   * relit toujours `https://api.fal.ai/v1/models/pricing` : sync-3 8 $/min,
   * Lipsync 2.0 3 $/min, LatentSync 0,20 $ jusqu'à 40 s puis 0,005 $/s,
   * Eleven v4 0,08 $ et MiniMax Speech 2.8 HD 0,10 $ les 1 000 caractères.
   */
  { service: 'fal', id: 'fal-ai/sync-lipsync/v3', nom: 'sync-3 (synchronisation labiale)', capacite: 'synchro', qualite: 5, usage: 'recale les lèvres d’une vidéo sur une nouvelle voix, rendu professionnel', prix: 'api-fal' },
  { service: 'fal', id: 'fal-ai/sync-lipsync/v2', nom: 'Lipsync 2.0 (synchronisation labiale)', capacite: 'synchro', qualite: 4, usage: 'recale les lèvres d’une vidéo sur une nouvelle voix, bon rapport qualité-prix', prix: 'api-fal' },
  { service: 'fal', id: 'veed/lipsync/v2', nom: 'VEED Lipsync 2', capacite: 'synchro', qualite: 4, usage: 'synchronisation labiale d’un présentateur face caméra', prix: 'api-fal' },
  { service: 'fal', id: 'fal-ai/latentsync', nom: 'LatentSync', capacite: 'synchro', qualite: 3, usage: 'synchronisation labiale économique, pour les essais', prix: 'api-fal' },
  { service: 'fal', id: 'elevenlabs/tts/eleven-v4', nom: 'Eleven v4 (par fal.ai)', capacite: 'voix', qualite: 5, usage: 'voix off naturelle multilingue, langue imposée ; voix par nom (« Rachel »…)', prix: 'api-fal' },
  { service: 'fal', id: 'fal-ai/minimax/speech-2.8-hd', nom: 'MiniMax Speech 2.8 HD (par fal.ai)', capacite: 'voix', qualite: 4, usage: 'voix off multilingue ; voix par identifiant (« Wise_Woman »…)', prix: 'api-fal' },
  { service: 'replicate', id: 'black-forest-labs/flux-1.1-pro', nom: 'FLUX 1.1 Pro', capacite: 'image', qualite: 4, usage: 'photo réaliste', prix: 'non-publie' },
  { service: 'heygen', id: 'avatar_iv', nom: 'Présentateur HeyGen (Avatar IV)', capacite: 'avatar', qualite: 5, usage: 'un présentateur humain réaliste dit votre texte, dans la langue voulue', prix: 'non-publie' },
  { service: 'heygen', id: 'heygen-video-1', nom: 'HeyGen Video', capacite: 'video', qualite: 4, usage: 'plans de 5 à 15 s avec leur son', prix: 'non-publie', durees: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], ratios: ['16:9', '9:16', '1:1'], son: true },
  { service: 'elevenlabs', id: 'eleven_multilingual_v2', nom: 'Voix multilingue', capacite: 'voix', qualite: 5, usage: 'voix off naturelle, toutes langues', prix: 'non-publie' },
  { service: 'elevenlabs', id: 'eleven_flash_v2_5', nom: 'Voix rapide', capacite: 'voix', qualite: 4, usage: 'voix off rapide et économique', prix: 'non-publie' },
  { service: 'elevenlabs', id: 'sound-generation', nom: 'Bruitages', capacite: 'son', qualite: 4, usage: 'bruitages et ambiances de 0,5 à 30 s', prix: 'non-publie' },
  { service: 'elevenlabs', id: 'music_v1', nom: 'Musique', capacite: 'musique', qualite: 4, usage: 'musique originale de 3 s à 10 min', prix: 'non-publie' },
  /* kie.ai (25/10/2026) : tout sauf la vidéo à partir d'un texte, déjà reprise du Studio. */
  ...MODELES_KIE.filter((m) => m.capacite !== 'video').map(
    (m): ModeleDeGeneration => ({
      service: 'kie',
      id: m.id,
      nom: m.nom,
      capacite: m.capacite,
      qualite: m.qualite,
      usage: m.usage,
      prix: 'credits-kie',
      ...(m.durees ? { durees: m.durees } : {}),
      ...(m.ratios ? { ratios: m.ratios } : {}),
      ...(m.son !== undefined ? { son: m.son } : {}),
      ...(m.fin ? { fin: true } : {}),
      ...(m.retouche ? { retouche: m.retouche } : {}),
    }),
  ),
];

/**
 * LES SERVICES CACHÉS (décision de l'utilisateur du 25/10/2026) : Higgsfield et
 * fal.ai cèdent la place à kie.ai. Ils disparaissent des réglages, des listes
 * de l'agent, des conseils de branchement et du choix automatique ; leur code
 * d'appel, leur catalogue et leurs tests restent EN PLACE — les rallumer,
 * c'est les retirer d'ici. Une clé déjà rangée au coffre n'est pas touchée.
 */
export const SERVICES_CACHES: readonly IdServiceGeneration[] = ['higgsfield', 'fal'];

let cachesEnVigueur: readonly IdServiceGeneration[] = SERVICES_CACHES;

/** Rallume (liste vide) ou recache des services : le seul geste pour revenir en arrière, aussi utilisé par les tests de la chaîne fal.ai. */
export function fixerLesServicesCaches(ids: readonly IdServiceGeneration[] = SERVICES_CACHES): void {
  cachesEnVigueur = [...ids];
}

export function estServiceCache(id: unknown): boolean {
  return (cachesEnVigueur as readonly unknown[]).includes(id);
}



/**
 * LE CATALOGUE COMPLET, statique : les vidéos du Studio (reprises telles
 * quelles, notées), puis les modèles ajoutés. Les modèles d'image OpenRouter
 * s'y ajoutent en direct (`modelesOpenRouterLus`).
 */
export function catalogueDeGeneration(): ModeleDeGeneration[] {
  const videos: ModeleDeGeneration[] = SERVICES_CREATION.flatMap((s) =>
    s.modeles.map((m) => ({
      service: s.id,
      id: m.id,
      nom: m.nom,
      capacite: 'video' as const,
      qualite: NOTES_VIDEO[m.id]?.qualite ?? 3,
      usage: NOTES_VIDEO[m.id]?.usage ?? 'vidéo générée à partir d’un texte',
      prix: s.id === 'fal' ? ('api-fal' as const) : s.id === 'kie' ? ('credits-kie' as const) : ('non-publie' as const),
      durees: m.durees,
      ratios: m.ratios,
      son: m.son,
    })),
  );
  return [...videos, ...MODELES_EN_PLUS];
}

/** Les modèles d'image rendus par `GET /api/v1/models?output_modalities=image` d'OpenRouter. */
export function modelesOpenRouterLus(corps: any): ModeleDeGeneration[] {
  const donnees: any[] = Array.isArray(corps?.data) ? corps.data : [];
  return donnees
    .filter((m) => typeof m?.id === 'string' && (m?.architecture?.output_modalities ?? []).includes('image'))
    .slice(0, 40)
    .map((m) => ({
      service: 'openrouter' as const,
      id: String(m.id),
      nom: String(m.name ?? m.id).slice(0, 80),
      capacite: 'image' as const,
      qualite: m.id === MODELE_IMAGE_OPENROUTER_PAR_DEFAUT ? 5 : 3,
      usage: m.id === MODELE_IMAGE_OPENROUTER_PAR_DEFAUT ? 'retouche et cohérence d’image, compréhension fine de la consigne' : 'image générée, facturée aux jetons',
      prix: 'cout-reel-openrouter' as const,
    }));
}

/** Un modèle du catalogue (OpenRouter compris quand sa liste est donnée). */
export function modeleDeGeneration(
  service: unknown,
  modele: unknown,
  openrouter: readonly ModeleDeGeneration[] = [],
  /** Un même modèle sert parfois plusieurs capacités (la retouche de Higgsfield) : la capacité voulue tranche. */
  capacite?: unknown,
): ModeleDeGeneration | undefined {
  const tous = [...catalogueDeGeneration(), ...openrouter].filter((m) => m.service === service && m.id === modele);
  return (capacite ? tous.find((m) => m.capacite === capacite) : undefined) ?? tous[0];
}

/** Le catalogue que l'agent et l'écran voient : sans les services cachés. */
export function catalogueVisible(): ModeleDeGeneration[] {
  return catalogueDeGeneration().filter((m) => !estServiceCache(m.service));
}

/** Le catalogue filtré : les services branchés seulement (jamais un service caché), la meilleure qualité d'abord. */
export function modelesProposes(
  branches: readonly IdServiceGeneration[],
  capacite?: CapaciteDeGeneration,
  openrouter: readonly ModeleDeGeneration[] = [],
): ModeleDeGeneration[] {
  return [...catalogueDeGeneration(), ...openrouter]
    .filter((m) => branches.includes(m.service) && !estServiceCache(m.service) && (!capacite || m.capacite === capacite))
    .sort((a, b) => b.qualite - a.qualite);
}

/** Le libellé de la source du prix, tel que l'agent et l'utilisateur le lisent. */
export function libelleDuPrix(prix: number | null, source: SourceDuPrix): string {
  if (prix !== null) return `${prix.toFixed(prix < 1 ? 3 : 2)} $ (tarif publié par le service)`;
  if (source === 'credits-kie') return 'prix non trouvé dans la liste de kie.ai : les crédits réellement consommés seront relevés après la génération';
  if (source === 'cout-reel-openrouter') return 'prix non publié à l’unité (facturé aux jetons) : le coût réel sera relevé après la génération';
  return 'prix non publié par le service';
}

/* ------------------------------------------------------------------ */
/* Les en-têtes et le test de clé des services EN PLUS                  */
/* ------------------------------------------------------------------ */

const HEYGEN = 'https://api.heygen.com';
const ELEVENLABS = 'https://api.elevenlabs.io';

export function entetesEnPlus(service: IdServiceEnPlus, cle: string): Record<string, string> {
  return service === 'heygen' ? { 'x-api-key': cle } : { 'xi-api-key': cle };
}

/** Une lecture GRATUITE qui prouve la clé : 401/403 si elle est fausse. */
export function requeteDeTestEnPlus(service: IdServiceEnPlus, cle: string): RequeteHttp {
  return {
    methode: 'GET',
    adresse: service === 'heygen' ? `${HEYGEN}/v3/users/me` : `${ELEVENLABS}/v1/models`,
    entetes: entetesEnPlus(service, cle),
  };
}

/* ------------------------------------------------------------------ */
/* La demande de génération — envoyée APRÈS une dépense validée         */
/* ------------------------------------------------------------------ */

export interface DemandeDeGeneration {
  consigne: string;
  format: FormatDeMedia;
  /** Vidéo, son, musique : la durée voulue en secondes. */
  duree?: number;
  /** Voix et avatar : la voix choisie chez le service. */
  voix?: string;
  /** Avatar : le présentateur choisi chez HeyGen. */
  avatar?: string;
  /** Voix et synchro : la langue parlée (code à deux lettres). */
  langue?: string;
  /** Vidéo : le son fabriqué avec l'image (kie.ai : `generate_audio`, `sound`). */
  son?: boolean;
  /** Synchro : les adresses, chez le service, de la vidéo d'origine et de la nouvelle voix (posées à la fabrication). */
  videoUrl?: string;
  audioUrl?: string;
  /**
   * Animation et retouches : les adresses des images d'entrée (posées à la
   * fabrication) — l'image retouchée ou animée d'abord, puis les références
   * (photos du visage). Chez OpenRouter, des adresses `data:`.
   */
  imageUrls?: string[];
  /** Autres angles : l'angle voulu. */
  angle?: AngleDeVue;
  /** Lumière : la direction choisie sur la sphère, et la valeur fixe envoyée quand le modèle n'en a que quelques-unes. */
  lumiere?: DirectionDeLumiere & { valeur?: string };
  /** Fibo Relight : le type de lumière (soleil bas, studio…), dans la liste du modèle. */
  typeDeLumiere?: string;
  /** Animation : l'adresse, chez le service, de l'IMAGE DE FIN du plan. */
  imageDeFinUrl?: string;
  /** Contrôle du mouvement : l'adresse de la VIDÉO DE RÉFÉRENCE dont le personnage reprend les gestes. */
  videoDeMouvementUrl?: string;
  /** Contrôle du mouvement : l'orientation du personnage suit l'image ou la vidéo. */
  orientation?: 'image' | 'video';
  /** Modèle lu en direct : les réglages de l'agent, vérifiés contre son schéma (`corpsEnDirect`). */
  parametres?: Record<string, unknown>;
}

/** Les types de lumière acceptés par Fibo Edit Relight (schéma lu le 24/10/2026). */
export const TYPES_DE_LUMIERE_FIBO = [
  'midday',
  'blue hour light',
  'low-angle sunlight',
  'sunrise light',
  'spotlight on subject',
  'overcast light',
  'soft overcast daylight lighting',
  'cloud-filtered lighting',
  'fog-diffused lighting',
  'moonlight lighting',
  'starlight nighttime',
  'soft bokeh lighting',
  'harsh studio lighting',
] as const;

/** Le cadrage demandé à la retouche de Higgsfield (sa liste fermée). */
const RATIO_HIGGSFIELD: Record<FormatDeMedia, string> = { '16:9': '16:9', '9:16': '9:16', '1:1': '1:1', '4:5': '3:4' };

/** Comment la réponse arrive : un fichier tout de suite, une image en `data:`, ou un travail à suivre. */
export type FormeDeReponse = 'fichier' | 'image-data' | 'travail';

/** MiniMax attend le NOM anglais de la langue dans `language_boost`. */
const LANGUES_MINIMAX: Record<string, string> = { fr: 'French', en: 'English', de: 'German', es: 'Spanish', it: 'Italian', pt: 'Portuguese', nl: 'Dutch' };

const FAL_TAILLE: Record<FormatDeMedia, string> = { '16:9': 'landscape_16_9', '9:16': 'portrait_16_9', '1:1': 'square_hd', '4:5': 'portrait_4_3' };

/**
 * LA DEMANDE D'UNE IMAGE, D'UN SON OU D'UN PRÉSENTATEUR (la vidéo des services
 * du Studio passe par `requeteDeCreation`, inchangée). `null` quand ce couple
 * service / capacité n'existe pas.
 */
export function requeteDeGeneration(
  modele: Pick<ModeleDeGeneration, 'service' | 'id' | 'capacite'>,
  cle: string,
  d: DemandeDeGeneration,
): { requete: RequeteHttp; forme: FormeDeReponse } | null {
  const json = { 'Content-Type': 'application/json' };
  switch (modele.service) {
    case 'kie': {
      /* kie.ai : une seule commande, son corps construit d'après le schéma recopié du modèle (`shared/src/kie.ts`). */
      const k = modeleKie(modele.id, modele.capacite);
      if (!k) return null;
      const c = corpsEnDirect(k.entrees, d, k.defauts);
      return c.ok ? { requete: requeteDeCommandeKie(k.id, cle, c.corps), forme: 'travail' } : null;
    }
    case 'fal': {
      const enFile = (corps: Record<string, unknown>) => ({
        requete: { methode: 'POST' as const, adresse: `https://queue.fal.run/${modele.id}`, entetes: { Authorization: `Key ${cle}`, ...json }, corps },
        forme: 'travail' as const,
      });
      if (modele.capacite === 'synchro') {
        if (!d.videoUrl || !d.audioUrl) return null;
        return enFile({ video_url: d.videoUrl, audio_url: d.audioUrl, ...(modele.id.startsWith('fal-ai/sync-lipsync') ? { sync_mode: 'cut_off' } : {}) });
      }
      if (modele.capacite === 'voix') {
        if (modele.id.startsWith('fal-ai/minimax/')) {
          return enFile({ prompt: d.consigne, output_format: 'url', voice_setting: { voice_id: d.voix || 'Wise_Woman' }, ...(d.langue ? { language_boost: LANGUES_MINIMAX[d.langue] ?? 'auto' } : {}) });
        }
        return enFile({ text: d.consigne, ...(d.voix ? { voice: d.voix } : {}), ...(d.langue ? { language_code: d.langue } : {}) });
      }
      const images = d.imageUrls ?? [];
      if (modele.capacite === 'animation') {
        if (!images[0]) return null;
        /* Kling 3 : start_image_url / end_image_url, 3 à 15 s ; Kling 2.5 : image_url / tail_image_url, 5 ou 10 s. */
        if (modele.id.includes('/v3/')) {
          const duree = String(Math.min(15, Math.max(3, Math.round(d.duree ?? 5))));
          return enFile({ prompt: d.consigne, start_image_url: images[0], ...(d.imageDeFinUrl ? { end_image_url: d.imageDeFinUrl } : {}), duration: duree, generate_audio: true });
        }
        const duree = (d.duree ?? 5) > 7 ? '10' : '5';
        return enFile({ prompt: d.consigne, image_url: images[0], ...(d.imageDeFinUrl ? { tail_image_url: d.imageDeFinUrl } : {}), duration: duree });
      }
      if (modele.capacite === 'mouvement') {
        if (!images[0] || !d.videoDeMouvementUrl) return null;
        return enFile({ image_url: images[0], video_url: d.videoDeMouvementUrl, character_orientation: d.orientation ?? 'video', keep_original_sound: true, ...(d.consigne ? { prompt: d.consigne } : {}) });
      }
      if (modele.capacite === 'retouche') {
        if (!images[0]) return null;
        return enFile({ prompt: d.consigne, image_urls: images, num_images: 1, aspect_ratio: d.format });
      }
      if (modele.capacite === 'angles') {
        if (!images[0] || !d.angle) return null;
        return enFile({
          image_urls: [images[0]],
          horizontal_angle: d.angle.horizontal,
          vertical_angle: d.angle.vertical,
          zoom: d.angle.zoom,
          num_images: 1,
          ...(modele.id.includes('qwen') && d.consigne ? { additional_prompt: d.consigne } : {}),
        });
      }
      if (modele.capacite === 'lumiere') {
        if (!images[0] || !d.lumiere?.valeur) return null;
        if (modele.id === 'bria/fibo-edit/relight') {
          const type = (TYPES_DE_LUMIERE_FIBO as readonly string[]).includes(d.typeDeLumiere ?? '') ? d.typeDeLumiere : 'soft overcast daylight lighting';
          return enFile({ image_url: images[0], light_direction: d.lumiere.valeur, light_type: type });
        }
        return enFile({ prompt: d.consigne, image_url: images[0], initial_latent: d.lumiere.valeur, num_images: 1 });
      }
      if (modele.capacite === 'visage') {
        if (images.length < 2) return null;
        return enFile({ prompt: d.consigne, image_urls: images, num_images: 1 });
      }
      if (modele.capacite !== 'image') return null;
      const taille = modele.id === 'fal-ai/flux/schnell' ? { image_size: FAL_TAILLE[d.format] } : { aspect_ratio: d.format };
      return {
        requete: { methode: 'POST', adresse: `https://queue.fal.run/${modele.id}`, entetes: { Authorization: `Key ${cle}`, ...json }, corps: { prompt: d.consigne, num_images: 1, ...taille } },
        forme: 'travail',
      };
    }
    case 'replicate': {
      if (modele.capacite !== 'image') return null;
      return {
        requete: {
          methode: 'POST',
          adresse: `https://api.replicate.com/v1/models/${modele.id}/predictions`,
          entetes: { Authorization: `Bearer ${cle}`, ...json },
          corps: { input: { prompt: d.consigne, aspect_ratio: d.format } },
        },
        forme: 'travail',
      };
    }
    case 'higgsfield': {
      /* Higgsfield hors vidéo du Studio : l'animation d'une image et la retouche décrite en mots. */
      const images = d.imageUrls ?? [];
      const entetes = { Authorization: `Key ${cle}`, ...json };
      if (modele.capacite === 'animation') {
        if (!images[0]) return null;
        const duree = Math.min(15, Math.max(3, Math.round(d.duree ?? 5)));
        return {
          requete: { methode: 'POST', adresse: `https://api.higgsfield.ai/${modele.id}`, entetes, corps: { prompt: d.consigne, image_url: images[0], ...(d.imageDeFinUrl ? { last_image_url: d.imageDeFinUrl } : {}), duration: duree, sound: 'on' } },
          forme: 'travail',
        };
      }
      if (modele.capacite === 'mouvement') {
        if (!images[0] || !d.videoDeMouvementUrl) return null;
        return {
          requete: {
            methode: 'POST',
            adresse: `https://api.higgsfield.ai/${modele.id}`,
            entetes,
            corps: { image_url: images[0], video_url: d.videoDeMouvementUrl, character_orientation: d.orientation ?? 'video', keep_original_sound: 'yes', ...(d.consigne ? { prompt: d.consigne } : {}) },
          },
          forme: 'travail',
        };
      }
      if (modele.capacite === 'angles' || modele.capacite === 'lumiere' || modele.capacite === 'visage' || modele.capacite === 'retouche') {
        if (!images[0] || (modele.capacite === 'visage' && images.length < 2)) return null;
        return {
          requete: {
            methode: 'POST',
            adresse: `https://api.higgsfield.ai/${modele.id}`,
            entetes,
            corps: { prompt: d.consigne, image_urls: images.slice(0, 3), resolution: '2k', aspect_ratio: RATIO_HIGGSFIELD[d.format] },
          },
          forme: 'travail',
        };
      }
      return null;
    }
    case 'openrouter': {
      const retouche = estUneRetoucheDImage(modele.capacite);
      if (modele.capacite !== 'image' && !retouche) return null;
      if (retouche && !d.imageUrls?.[0]) return null;
      const contenu = retouche
        ? [{ type: 'text', text: d.consigne }, ...(d.imageUrls ?? []).map((url) => ({ type: 'image_url', image_url: { url } }))]
        : d.consigne;
      return {
        requete: {
          methode: 'POST',
          adresse: 'https://openrouter.ai/api/v1/chat/completions',
          entetes: { Authorization: `Bearer ${cle}`, ...json },
          corps: {
            model: modele.id,
            messages: [{ role: 'user', content: contenu }],
            modalities: ['image', 'text'],
            image_config: { aspect_ratio: d.format },
            usage: { include: true },
          },
        },
        forme: 'image-data',
      };
    }
    case 'heygen': {
      const entetes = { ...entetesEnPlus('heygen', cle), ...json };
      if (modele.capacite === 'avatar') {
        return {
          requete: {
            methode: 'POST',
            adresse: `${HEYGEN}/v3/videos`,
            entetes,
            corps: { type: 'avatar', avatar_id: d.avatar ?? '', script: d.consigne, voice_id: d.voix ?? '', resolution: '1080p', aspect_ratio: d.format === '4:5' ? '9:16' : d.format },
          },
          forme: 'travail',
        };
      }
      if (modele.capacite === 'video') {
        const duree = Math.min(15, Math.max(5, Math.round(d.duree ?? 5)));
        return {
          requete: {
            methode: 'POST',
            adresse: `${HEYGEN}/v3/models/videos`,
            entetes,
            corps: { model: 'heygen-video-1', mode: 'text_to_video', prompt: d.consigne, duration: duree, aspect_ratio: d.format === '4:5' ? '3:4' : d.format },
          },
          forme: 'travail',
        };
      }
      return null;
    }
    case 'elevenlabs': {
      const entetes = { ...entetesEnPlus('elevenlabs', cle), ...json, Accept: 'audio/mpeg' };
      if (modele.capacite === 'voix') {
        return {
          requete: { methode: 'POST', adresse: `${ELEVENLABS}/v1/text-to-speech/${encodeURIComponent(d.voix ?? '')}`, entetes, corps: { text: d.consigne, model_id: modele.id } },
          forme: 'fichier',
        };
      }
      if (modele.capacite === 'son') {
        const duree = d.duree ? Math.min(30, Math.max(0.5, d.duree)) : undefined;
        return {
          requete: { methode: 'POST', adresse: `${ELEVENLABS}/v1/sound-generation`, entetes, corps: { text: d.consigne, ...(duree ? { duration_seconds: duree } : {}) } },
          forme: 'fichier',
        };
      }
      if (modele.capacite === 'musique') {
        const ms = d.duree ? Math.min(600_000, Math.max(3_000, Math.round(d.duree * 1000))) : undefined;
        return {
          requete: { methode: 'POST', adresse: `${ELEVENLABS}/v1/music`, entetes, corps: { prompt: d.consigne, model_id: modele.id, ...(ms ? { music_length_ms: ms } : {}) } },
          forme: 'fichier',
        };
      }
      return null;
    }
    default:
      return null;
  }
}

export type EtatDeGeneration =
  | { etat: 'attente'; suivi: string }
  | { etat: 'fini'; url: string; coutReel?: number }
  | { etat: 'echec'; raison: string };

function raisonDe(corps: any, defaut: string): string {
  const brut = corps?.error?.message ?? corps?.data?.failure_message ?? corps?.failure_message ?? corps?.error ?? corps?.detail ?? corps?.message ?? defaut;
  return String(typeof brut === 'string' ? brut : JSON.stringify(brut)).slice(0, 240);
}

function refusCommun(statut: number, corps: any): EtatDeGeneration | null {
  if (statut === 401 || statut === 403) return { etat: 'echec', raison: 'le service refuse la clé enregistrée : retestez-la dans « Services de création »' };
  if (statut === 402) return { etat: 'echec', raison: 'le crédit de votre compte chez ce service est épuisé' };
  if (statut < 200 || statut >= 300) return { etat: 'echec', raison: `le service a refusé la génération (${statut}) : ${raisonDe(corps, 'sans détail')}` };
  return null;
}

/** La réponse à la CRÉATION d'un travail (forme « travail » ou « image-data »). */
export function lireCreationDeGeneration(modele: Pick<ModeleDeGeneration, 'service' | 'capacite'>, statut: number, corps: any): EtatDeGeneration {
  /* kie.ai répond en 200 même en erreur : son champ `code` fait foi. */
  if (modele.service === 'kie') return lireCommandeKie(statut, corps);
  const refus = refusCommun(statut, corps);
  if (refus) return refus;
  switch (modele.service) {
    case 'fal':
      return corps?.status_url && corps?.response_url ? { etat: 'attente', suivi: `${corps.status_url}\n${corps.response_url}` } : { etat: 'echec', raison: 'fal.ai n’a rendu aucun suivi' };
    case 'replicate':
      return lireSuiviDeGeneration(modele, 200, corps, corps?.urls?.get ? String(corps.urls.get) : corps?.id ? `https://api.replicate.com/v1/predictions/${encodeURIComponent(corps.id)}` : '');
    case 'openrouter': {
      const image = corps?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      const cout = Number(corps?.usage?.cost);
      if (typeof image !== 'string' || !image) return { etat: 'echec', raison: raisonDe(corps, 'OpenRouter a répondu sans image') };
      return { etat: 'fini', url: image, ...(Number.isFinite(cout) && cout >= 0 ? { coutReel: Math.round(cout * 1e4) / 1e4 } : {}) };
    }
    case 'higgsfield':
      return corps?.status_url ? { etat: 'attente', suivi: String(corps.status_url) } : { etat: 'echec', raison: 'Higgsfield n’a rendu aucun suivi' };
    case 'heygen': {
      const id = corps?.data?.video_id;
      if (!id) return { etat: 'echec', raison: 'HeyGen n’a rendu aucune vidéo à suivre' };
      const chemin = modele.capacite === 'avatar' ? 'videos' : 'models/videos';
      return { etat: 'attente', suivi: `${HEYGEN}/v3/${chemin}/${encodeURIComponent(id)}` };
    }
    default:
      return { etat: 'echec', raison: 'service inconnu' };
  }
}

/** L'adresse à lire pour suivre (fal.ai garde deux adresses : l'état, puis le résultat). */
export function adresseDeSuiviDeGeneration(service: IdServiceGeneration, suivi: string): string {
  return service === 'fal' ? suivi.split('\n')[0]! : suivi;
}

/** La réponse au SUIVI d'un travail d'image ou de présentateur. */
export function lireSuiviDeGeneration(modele: Pick<ModeleDeGeneration, 'service'>, statut: number, corps: any, suivi = ''): EtatDeGeneration {
  if (modele.service === 'kie') return lireSuiviKie(statut, corps, suivi);
  if (statut === 404) return { etat: 'echec', raison: 'le service ne retrouve plus ce travail' };
  if (statut >= 500 || statut === 429) return { etat: 'attente', suivi };
  const refus = refusCommun(statut, corps);
  if (refus) return refus;
  switch (modele.service) {
    case 'fal': {
      const s = String(corps?.status ?? '');
      if (s === 'COMPLETED') return corps?.error ? { etat: 'echec', raison: raisonDe(corps, 'fal.ai : échec') } : { etat: 'fini', url: '' };
      return { etat: 'attente', suivi };
    }
    case 'replicate': {
      const s = String(corps?.status ?? '');
      const sortie = Array.isArray(corps?.output) ? corps.output[0] : corps?.output;
      if (s === 'succeeded') return sortie ? { etat: 'fini', url: String(sortie) } : { etat: 'echec', raison: 'Replicate a fini sans fichier' };
      if (s === 'failed' || s === 'canceled') return { etat: 'echec', raison: raisonDe(corps, `Replicate : ${s}`) };
      return { etat: 'attente', suivi };
    }
    case 'higgsfield': {
      const s = String(corps?.status ?? '');
      if (s === 'completed') {
        const url = corps?.images?.[0]?.url ?? corps?.video?.url;
        return url ? { etat: 'fini', url: String(url) } : { etat: 'echec', raison: 'Higgsfield a fini sans fichier' };
      }
      if (s === 'failed' || s === 'nsfw' || s === 'canceled') return { etat: 'echec', raison: s === 'nsfw' ? 'refusé par la modération de Higgsfield' : raisonDe(corps, `Higgsfield : ${s}`) };
      return { etat: 'attente', suivi };
    }
    case 'heygen': {
      const d = corps?.data ?? corps;
      const s = String(d?.status ?? '');
      if (s === 'completed') return d?.video_url ? { etat: 'fini', url: String(d.video_url) } : { etat: 'echec', raison: 'HeyGen a fini sans vidéo' };
      if (s === 'failed') return { etat: 'echec', raison: raisonDe(corps, 'HeyGen : échec de la génération') };
      return { etat: 'attente', suivi };
    }
    default:
      return { etat: 'echec', raison: 'service inconnu' };
  }
}

/** fal.ai : le résultat d'un travail fini porte le fichier dans `images[0].url`, `image.url`, `video.url` ou `audio.url`. */
export function lireResultatImageFal(corps: any): EtatDeGeneration {
  const url = corps?.images?.[0]?.url ?? corps?.image?.url ?? corps?.video?.url ?? corps?.audio?.url;
  return url ? { etat: 'fini', url: String(url) } : { etat: 'echec', raison: 'fal.ai a fini sans fichier' };
}

/**
 * LE PRIX D'UNE VOIX OU D'UNE SYNCHRONISATION CHEZ fal.ai, depuis le tarif
 * publié : à la seconde ou à la minute (sur la durée donnée), au caractère ou
 * aux mille caractères (sur le texte), ou à la demande. `null` quand l'unité
 * est inconnue ou la quantité manquante — l'accord est alors demandé.
 */
export function prixALUniteFal(
  prix: { unit_price?: unknown; unit?: unknown } | undefined,
  quantite: { secondes?: number; caracteres?: number },
): number | null {
  const p = Number(prix?.unit_price);
  if (!Number.isFinite(p) || p < 0) return null;
  const unite = String(prix?.unit ?? '').toLowerCase().trim();
  const arrondi = (x: number) => Math.round(x * 1e4) / 1e4;
  if (['request', 'requests', 'generation', 'generations', 'video', 'videos', 'image', 'images'].includes(unite)) return arrondi(p);
  if (/^(\d+\s*)?seconds?$/.test(unite) && quantite.secondes) return arrondi(p * quantite.secondes);
  if (/^minutes?$/.test(unite) && quantite.secondes) return arrondi((p * quantite.secondes) / 60);
  if (/char/.test(unite) && quantite.caracteres) {
    const mille = /(1000|1k|1 000|thousand|kilo)/.test(unite);
    return arrondi(mille ? (p * quantite.caracteres) / 1000 : p * quantite.caracteres);
  }
  return null;
}

/**
 * L'ENVOI D'UN FICHIER LOCAL chez fal.ai (une synchronisation labiale attend
 * des adresses) : on demande une adresse d'envoi, puis on y dépose le fichier
 * (`PUT`). Relevé dans le client officiel fal-js (`libs/client/src/storage.ts`,
 * 24/10/2026) ; envoi en un seul morceau jusqu'à 90 Mo. Gratuit.
 */
export const TAILLE_MAX_ENVOI_FAL = 90 * 1024 * 1024;
export function requeteDEnvoiFal(cle: string, typeDeContenu: string, nom: string): RequeteHttp {
  return {
    methode: 'POST',
    adresse: 'https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3',
    entetes: { Authorization: `Key ${cle}`, 'Content-Type': 'application/json' },
    corps: { content_type: typeDeContenu, file_name: nom },
  };
}

/**
 * LE PRIX D'UNE IMAGE CHEZ fal.ai, depuis le tarif publié : à l'image, ou au
 * mégapixel (compté pour une image d'un mégapixel, la taille par défaut).
 * `null` quand l'unité est inconnue — jamais un chiffre deviné.
 */
export function prixImageFal(prix: { unit_price?: unknown; unit?: unknown } | undefined): number | null {
  const p = Number(prix?.unit_price);
  if (!Number.isFinite(p) || p < 0) return null;
  const unite = String(prix?.unit ?? '').toLowerCase();
  if (['image', 'images', 'request', 'requests', 'megapixel', 'megapixels'].includes(unite)) return Math.round(p * 1e4) / 1e4;
  return null;
}

/** L'extension du fichier rendu, d'après la capacité et le type annoncé. */
export function extensionDuMedia(capacite: CapaciteDeGeneration, typeMime = ''): string {
  const t = typeMime.toLowerCase();
  if (t.includes('png')) return 'png';
  if (t.includes('jpeg') || t.includes('jpg')) return 'jpg';
  if (t.includes('webp')) return 'webp';
  if (t.includes('webm')) return 'webm';
  if (t.includes('mpeg') || t.includes('mp3')) return 'mp3';
  if (t.includes('wav')) return 'wav';
  if (t.includes('mp4')) return 'mp4';
  if (capacite === 'image' || estUneRetoucheDImage(capacite)) return 'png';
  if (capacite === 'video' || capacite === 'avatar' || capacite === 'synchro' || capacite === 'animation' || capacite === 'mouvement') return 'mp4';
  return 'mp3';
}

/** Les capacités qui RETOUCHENT une image : elles rendent une image. */
export function estUneRetoucheDImage(capacite: CapaciteDeGeneration): capacite is 'angles' | 'lumiere' | 'visage' | 'retouche' {
  return capacite === 'angles' || capacite === 'lumiere' || capacite === 'visage' || capacite === 'retouche';
}

/** Le genre affiché d'un média : ce que la page « Médias » filtre. */
export type GenreDeMedia = 'image' | 'video' | 'son';

export function genreDuMedia(capacite: CapaciteDeGeneration): GenreDeMedia {
  if (capacite === 'image' || estUneRetoucheDImage(capacite)) return 'image';
  if (capacite === 'video' || capacite === 'avatar' || capacite === 'synchro' || capacite === 'animation' || capacite === 'mouvement') return 'video';
  return 'son';
}
