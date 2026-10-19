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

import {
  SERVICES_CREATION,
  type IdServiceCreation,
  type RatioClip,
  type RequeteHttp,
  type ServiceDeCreation,
} from './studio-services.js';

export const CAPACITES_DE_GENERATION = ['image', 'video', 'voix', 'son', 'musique', 'avatar'] as const;
export type CapaciteDeGeneration = (typeof CAPACITES_DE_GENERATION)[number];

/** Les services EN PLUS de ceux du Studio : ils n'apparaissent jamais dans le Studio. */
export const IDS_SERVICES_EN_PLUS = ['heygen', 'elevenlabs'] as const;
export type IdServiceEnPlus = (typeof IDS_SERVICES_EN_PLUS)[number];

export type IdServiceGeneration = IdServiceCreation | IdServiceEnPlus;

/** Le format voulu d'un média : les quatre cadrages des réseaux et de l'écran. */
export type FormatDeMedia = '16:9' | '9:16' | '1:1' | '4:5';

/** D'où vient le prix d'un modèle. */
export type SourceDuPrix = 'api-fal' | 'cout-reel-openrouter' | 'non-publie';

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
};

/** Les modèles d'image, de son et d'avatar AJOUTÉS (ceux de la vidéo viennent du Studio). */
const MODELES_EN_PLUS: readonly ModeleDeGeneration[] = [
  { service: 'fal', id: 'fal-ai/flux-pro/v1.1-ultra', nom: 'FLUX 1.1 Pro Ultra', capacite: 'image', qualite: 5, usage: 'photo réaliste haute définition', prix: 'api-fal' },
  { service: 'fal', id: 'fal-ai/imagen4/preview', nom: 'Imagen 4', capacite: 'image', qualite: 5, usage: 'détails fins et texte lisible dans l’image', prix: 'api-fal' },
  { service: 'fal', id: 'fal-ai/nano-banana', nom: 'Nano Banana', capacite: 'image', qualite: 4, usage: 'cohérence d’un personnage d’une image à l’autre', prix: 'api-fal' },
  { service: 'fal', id: 'fal-ai/flux/schnell', nom: 'FLUX Schnell', capacite: 'image', qualite: 3, usage: 'brouillons et planches de tendance, très bon marché', prix: 'api-fal' },
  { service: 'replicate', id: 'black-forest-labs/flux-1.1-pro', nom: 'FLUX 1.1 Pro', capacite: 'image', qualite: 4, usage: 'photo réaliste', prix: 'non-publie' },
  { service: 'heygen', id: 'avatar_iv', nom: 'Présentateur HeyGen (Avatar IV)', capacite: 'avatar', qualite: 5, usage: 'un présentateur humain réaliste dit votre texte, dans la langue voulue', prix: 'non-publie' },
  { service: 'heygen', id: 'heygen-video-1', nom: 'HeyGen Video', capacite: 'video', qualite: 4, usage: 'plans de 5 à 15 s avec leur son', prix: 'non-publie', durees: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], ratios: ['16:9', '9:16', '1:1'], son: true },
  { service: 'elevenlabs', id: 'eleven_multilingual_v2', nom: 'Voix multilingue', capacite: 'voix', qualite: 5, usage: 'voix off naturelle, toutes langues', prix: 'non-publie' },
  { service: 'elevenlabs', id: 'eleven_flash_v2_5', nom: 'Voix rapide', capacite: 'voix', qualite: 4, usage: 'voix off rapide et économique', prix: 'non-publie' },
  { service: 'elevenlabs', id: 'sound-generation', nom: 'Bruitages', capacite: 'son', qualite: 4, usage: 'bruitages et ambiances de 0,5 à 30 s', prix: 'non-publie' },
  { service: 'elevenlabs', id: 'music_v1', nom: 'Musique', capacite: 'musique', qualite: 4, usage: 'musique originale de 3 s à 10 min', prix: 'non-publie' },
];

/** Le modèle d'image OpenRouter retenu quand l'agent n'en nomme pas (lu dans /models). */
export const MODELE_IMAGE_OPENROUTER_PAR_DEFAUT = 'google/gemini-nano-banana-2.1';

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
      prix: s.id === 'fal' ? ('api-fal' as const) : ('non-publie' as const),
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
): ModeleDeGeneration | undefined {
  return [...catalogueDeGeneration(), ...openrouter].find((m) => m.service === service && m.id === modele);
}

/** Le catalogue filtré : les services branchés seulement, la meilleure qualité d'abord. */
export function modelesProposes(
  branches: readonly IdServiceGeneration[],
  capacite?: CapaciteDeGeneration,
  openrouter: readonly ModeleDeGeneration[] = [],
): ModeleDeGeneration[] {
  return [...catalogueDeGeneration(), ...openrouter]
    .filter((m) => branches.includes(m.service) && (!capacite || m.capacite === capacite))
    .sort((a, b) => b.qualite - a.qualite);
}

/** Le libellé de la source du prix, tel que l'agent et l'utilisateur le lisent. */
export function libelleDuPrix(prix: number | null, source: SourceDuPrix): string {
  if (prix !== null) return `${prix.toFixed(prix < 1 ? 3 : 2)} $ (tarif publié par le service)`;
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
}

/** Comment la réponse arrive : un fichier tout de suite, une image en `data:`, ou un travail à suivre. */
export type FormeDeReponse = 'fichier' | 'image-data' | 'travail';

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
    case 'fal': {
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
    case 'openrouter': {
      if (modele.capacite !== 'image') return null;
      return {
        requete: {
          methode: 'POST',
          adresse: 'https://openrouter.ai/api/v1/chat/completions',
          entetes: { Authorization: `Bearer ${cle}`, ...json },
          corps: {
            model: modele.id,
            messages: [{ role: 'user', content: d.consigne }],
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

/** fal.ai : le résultat d'un travail d'image fini porte l'image dans `images[0].url`. */
export function lireResultatImageFal(corps: any): EtatDeGeneration {
  const url = corps?.images?.[0]?.url ?? corps?.image?.url;
  return url ? { etat: 'fini', url: String(url) } : { etat: 'echec', raison: 'fal.ai a fini sans image' };
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
  if (capacite === 'image') return 'png';
  if (capacite === 'video' || capacite === 'avatar') return 'mp4';
  return 'mp3';
}

/** Le genre affiché d'un média : ce que la page « Médias » filtre. */
export type GenreDeMedia = 'image' | 'video' | 'son';

export function genreDuMedia(capacite: CapaciteDeGeneration): GenreDeMedia {
  if (capacite === 'image') return 'image';
  if (capacite === 'video' || capacite === 'avatar') return 'video';
  return 'son';
}
