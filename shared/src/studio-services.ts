/**
 * LES SERVICES DE CRÉATION QUE L'UTILISATEUR BRANCHE LUI-MÊME (demande du
 * 14/10/2026) — sept services de génération vidéo, plus son propre compte
 * OpenRouter. Règles PURES : le catalogue, la demande à envoyer, la lecture de
 * la réponse. `server/src/studio-services.ts` fait les appels ;
 * `server/src/test/studio-services.test.ts` verrouille ces règles.
 *
 * Chaque service a été vérifié dans sa documentation officielle (14/10/2026) :
 * en-tête d'authentification, création d'un travail, suivi, adresse du
 * fichier rendu. Adobe Firefly n'y est PAS : il exige un contrat Adobe
 * entreprise (décision de l'utilisateur, à ajouter plus tard).
 *
 * LA LISTE DES MODÈLES EST COURTE ET TENUE À LA MAIN : fal.ai et Replicate en
 * portent des milliers, on n'en montre que les principaux modèles vidéo. Un
 * prix n'est JAMAIS écrit ici : il se lit en direct quand le service le publie
 * (fal.ai), sinon le devis dit « prix non publié ».
 */

import { type Composition, type OperationStudio, type Piste, type ResultatOperation, appliquerOperation } from './studio.js';

export const IDS_SERVICES_CREATION = ['higgsfield', 'byteplus', 'magnific', 'krea', 'runway', 'fal', 'replicate', 'openrouter'] as const;
export type IdServiceCreation = (typeof IDS_SERVICES_CREATION)[number];

export type RatioClip = '16:9' | '9:16' | '1:1';

export interface ModeleVideoDeService {
  /** L'identifiant du modèle CHEZ LE SERVICE (chemin, nom d'API). */
  id: string;
  /** Son nom lisible. */
  nom: string;
  /** Les durées acceptées, en secondes (la demande est ramenée à la plus proche). */
  durees: number[];
  /** Les cadrages acceptés ; vide = le modèle décide seul (aucun réglage envoyé). */
  ratios: RatioClip[];
  /** Le modèle sait-il fabriquer le son avec l'image ? */
  son: boolean;
}

export interface ServiceDeCreation {
  id: IdServiceCreation;
  nom: string;
  /** Ce que le service apporte, en une phrase lisible. */
  description: string;
  /** Où l'utilisateur crée sa clé. */
  adresseCle: string;
  /** Les champs à remplir : une clé, ou un identifiant ET un secret (Higgsfield). */
  champs: { id: 'cle' | 'secret'; libelle: string }[];
  /** Les modèles vidéo proposés à l'agent (vide pour OpenRouter : voix et musique). */
  modeles: ModeleVideoDeService[];
}

const plage = (min: number, max: number) => Array.from({ length: max - min + 1 }, (_, i) => min + i);
const CLE = [{ id: 'cle' as const, libelle: 'Clé d’API' }];

export const SERVICES_CREATION: readonly ServiceDeCreation[] = [
  {
    id: 'higgsfield',
    nom: 'Higgsfield',
    description: 'Vidéos Kling et Hailuo, payées sur votre solde Higgsfield.',
    adresseCle: 'https://console.higgsfield.ai',
    champs: [
      { id: 'cle', libelle: 'Identifiant de la clé' },
      { id: 'secret', libelle: 'Secret de la clé' },
    ],
    modeles: [
      { id: 'kling-video/v2.5-turbo/pro/text-to-video', nom: 'Kling 2.5 Turbo Pro', durees: [5, 10], ratios: [], son: false },
      { id: 'minimax/hailuo-2.3/standard/text-to-video', nom: 'Hailuo 2.3', durees: [6, 10], ratios: [], son: false },
    ],
  },
  {
    id: 'byteplus',
    nom: 'BytePlus ModelArk',
    description: 'Les vidéos Seedance de ByteDance, avec le son.',
    adresseCle: 'https://console.byteplus.com/ark/region:ark+ap-southeast-1/apiKey',
    champs: CLE,
    modeles: [
      { id: 'dreamina-seedance-2-0-fast-260128', nom: 'Seedance 2.0 Fast', durees: plage(4, 15), ratios: ['16:9', '9:16', '1:1'], son: true },
      { id: 'dreamina-seedance-2-0-260128', nom: 'Seedance 2.0', durees: plage(4, 15), ratios: ['16:9', '9:16', '1:1'], son: true },
      { id: 'seedance-1-0-pro-fast-251015', nom: 'Seedance 1.0 Pro Fast', durees: plage(2, 12), ratios: ['16:9', '9:16', '1:1'], son: false },
    ],
  },
  {
    id: 'magnific',
    nom: 'Freepik / Magnific',
    description: 'Veo, Kling et Wan, payés sur votre crédit Freepik (Magnific).',
    adresseCle: 'https://www.magnific.com/developers/dashboard/api-key',
    champs: CLE,
    modeles: [
      { id: 'veo-3-1-fast', nom: 'Veo 3.1 Fast', durees: [4, 6, 8], ratios: ['16:9', '9:16'], son: true },
      { id: 'kling-v3-turbo-720p', nom: 'Kling 3.0 Turbo', durees: plage(3, 15), ratios: ['16:9', '9:16', '1:1'], son: false },
      { id: 'wan-2-5-t2v-720p', nom: 'Wan 2.5', durees: [5, 10], ratios: [], son: false },
    ],
  },
  {
    id: 'krea',
    nom: 'Krea AI',
    description: 'Veo, Kling et Seedance depuis votre espace Krea.',
    adresseCle: 'https://www.krea.ai/settings/api-tokens',
    champs: CLE,
    modeles: [
      { id: 'google/veo-3.1-fast', nom: 'Veo 3.1 Fast', durees: [4, 6, 8], ratios: ['16:9', '9:16'], son: true },
      { id: 'kling/kling-2.5', nom: 'Kling 2.5', durees: [5, 10], ratios: ['16:9', '9:16', '1:1'], son: false },
      { id: 'bytedance/seedance-2-fast', nom: 'Seedance 2 Fast', durees: plage(4, 12), ratios: ['16:9', '9:16', '1:1'], son: true },
    ],
  },
  {
    id: 'runway',
    nom: 'Runway',
    description: 'Gen-4.5 et Veo 3.1, payés en crédits Runway.',
    adresseCle: 'https://dev.runwayml.com',
    champs: CLE,
    modeles: [
      { id: 'gen4.5', nom: 'Gen-4.5', durees: plage(2, 10), ratios: ['16:9', '9:16'], son: false },
      { id: 'veo3.1_fast', nom: 'Veo 3.1 Fast', durees: [4, 6, 8], ratios: ['16:9', '9:16'], son: true },
    ],
  },
  {
    id: 'fal',
    nom: 'fal.ai',
    description: 'Veo, Kling et Seedance au prix publié par fal.ai.',
    adresseCle: 'https://fal.ai/dashboard/keys',
    champs: CLE,
    modeles: [
      { id: 'fal-ai/veo3/fast', nom: 'Veo 3 Fast', durees: [4, 6, 8], ratios: ['16:9', '9:16'], son: true },
      { id: 'fal-ai/kling-video/v2.1/master/text-to-video', nom: 'Kling 2.1 Master', durees: [5, 10], ratios: ['16:9', '9:16', '1:1'], son: false },
      { id: 'fal-ai/bytedance/seedance/v1/pro/text-to-video', nom: 'Seedance 1 Pro', durees: plage(2, 12), ratios: ['16:9', '9:16', '1:1'], son: false },
    ],
  },
  {
    id: 'replicate',
    nom: 'Replicate',
    description: 'Veo, Kling et Seedance hébergés par Replicate.',
    adresseCle: 'https://replicate.com/account/api-tokens',
    champs: CLE,
    modeles: [
      { id: 'google/veo-3-fast', nom: 'Veo 3 Fast', durees: [4, 6, 8], ratios: ['16:9', '9:16'], son: true },
      { id: 'kwaivgi/kling-v2.1-master', nom: 'Kling 2.1 Master', durees: [5, 10], ratios: ['16:9', '9:16', '1:1'], son: false },
      { id: 'bytedance/seedance-1-pro-fast', nom: 'Seedance 1 Pro Fast', durees: plage(2, 12), ratios: ['16:9', '9:16', '1:1'], son: false },
    ],
  },
  {
    id: 'openrouter',
    nom: 'OpenRouter',
    description: 'Votre propre compte pour la voix finale et la musique, à la place de celui de Beluga Build.',
    adresseCle: 'https://openrouter.ai/settings/keys',
    champs: CLE,
    modeles: [],
  },
];

export function serviceDeCreation(id: unknown): ServiceDeCreation | undefined {
  return SERVICES_CREATION.find((s) => s.id === id);
}

export function modeleVideoDeService(service: unknown, modele: unknown): ModeleVideoDeService | undefined {
  return serviceDeCreation(service)?.modeles.find((m) => m.id === modele);
}

/**
 * LE NOM DE LA FICHE DU COFFRE-FORT d'un service : une fiche par service, à
 * ce nom exact. C'est lui qui retrouve la clé ; on ne le renomme donc jamais.
 */
export function nomDeFicheDuService(service: Pick<ServiceDeCreation, 'nom'>): string {
  return `Studio — ${service.nom}`;
}

/**
 * La clé telle que le service l'attend, depuis les champs saisis : Higgsfield
 * colle l'identifiant et le secret (`ID:SECRET`), les autres prennent la clé
 * seule. `null` quand un champ manque.
 */
export function cleAssemblee(service: ServiceDeCreation, champs: Record<string, unknown>): string | null {
  const valeurs = service.champs.map((c) => String(champs[c.id] ?? '').trim());
  if (valeurs.some((v) => !v)) return null;
  return valeurs.join(':');
}

/** La durée acceptée la plus proche de celle voulue (à égalité, la plus courte : moins cher). */
export function dureeAjustee(modele: ModeleVideoDeService, voulue: number): number {
  const v = Number.isFinite(voulue) && voulue > 0 ? voulue : modele.durees[0]!;
  return modele.durees.reduce((meilleure, d) => (Math.abs(d - v) < Math.abs(meilleure - v) ? d : meilleure), modele.durees[0]!);
}

/** Le cadrage accepté le plus proche du format de la création : `null` quand le modèle décide seul. */
export function ratioAjuste(modele: ModeleVideoDeService, voulu: RatioClip): RatioClip | null {
  if (!modele.ratios.length) return null;
  if (modele.ratios.includes(voulu)) return voulu;
  // Un carré sans carré : le vertical, pensé pour le téléphone.
  return modele.ratios.includes('9:16') ? '9:16' : modele.ratios[0]!;
}

/** Le cadrage d'un format du Studio (largeur × hauteur). */
export function ratioDuFormat(largeur: number, hauteur: number): RatioClip {
  if (largeur === hauteur) return '1:1';
  return largeur > hauteur ? '16:9' : '9:16';
}

/* ------------------------------------------------------------------ */
/* Les appels : ce qu'on envoie, et comment on lit la réponse            */
/* ------------------------------------------------------------------ */

export interface DemandeDeClip {
  consigne: string;
  duree: number;
  ratio: RatioClip | null;
  son: boolean;
}

export interface RequeteHttp {
  methode: 'GET' | 'POST';
  adresse: string;
  entetes: Record<string, string>;
  corps?: unknown;
}

const RUNWAY = 'https://api.dev.runwayml.com';
const VERSION_RUNWAY = '2024-11-06';
const BYTEPLUS = 'https://ark.ap-southeast.bytepluses.com/api/v3';
const MAGNIFIC = 'https://api.magnific.com';

/** Les en-têtes d'authentification de chaque service (vérifiés dans leur documentation). */
export function entetesDuService(service: IdServiceCreation, cle: string): Record<string, string> {
  switch (service) {
    case 'higgsfield':
    case 'fal':
      return { Authorization: `Key ${cle}` };
    case 'magnific':
      return { 'x-magnific-api-key': cle };
    case 'runway':
      return { Authorization: `Bearer ${cle}`, 'X-Runway-Version': VERSION_RUNWAY };
    default:
      return { Authorization: `Bearer ${cle}` };
  }
}

/**
 * UNE LECTURE GRATUITE QUI PROUVE LA CLÉ : un mauvais secret y répond 401 ou
 * 403. Rien n'est fabriqué, rien n'est débité.
 */
export function requeteDeTest(service: IdServiceCreation, cle: string): RequeteHttp {
  const entetes = entetesDuService(service, cle);
  const adresse: Record<IdServiceCreation, string> = {
    // Un travail qui n'existe pas : 404 avec une bonne clé, 401 sinon.
    higgsfield: 'https://api.higgsfield.ai/requests/00000000-0000-0000-0000-000000000000/status',
    byteplus: `${BYTEPLUS}/contents/generations/tasks?page_size=1`,
    magnific: `${MAGNIFIC}/v1/ai/text-to-video/veo-3-1-fast`,
    krea: 'https://api.krea.ai/jobs?limit=1',
    runway: `${RUNWAY}/v1/organization`,
    fal: 'https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai/veo3/fast',
    replicate: 'https://api.replicate.com/v1/account',
    openrouter: 'https://openrouter.ai/api/v1/key',
  };
  return { methode: 'GET', adresse: adresse[service], entetes };
}

/** Le verdict d'un test de clé, depuis le code HTTP reçu. */
export function verdictDuTest(service: IdServiceCreation, statut: number): { ok: boolean; raison?: string } {
  if (statut === 401 || statut === 403) return { ok: false, raison: 'le service refuse cette clé (elle est fausse, expirée ou retirée)' };
  if (statut === 429) return { ok: true };
  if (statut >= 200 && statut < 300) return { ok: true };
  // Higgsfield : le travail sondé n'existe pas — la clé, elle, est acceptée.
  if (service === 'higgsfield' && statut === 404) return { ok: true };
  if (statut >= 500) return { ok: false, raison: `le service ne répond pas en ce moment (${statut}) : réessayez plus tard` };
  return { ok: false, raison: `réponse inattendue du service (${statut})` };
}

/** La demande qui LANCE un extrait — n'est appelée qu'après une dépense validée. */
export function requeteDeCreation(service: IdServiceCreation, modele: string, cle: string, d: DemandeDeClip): RequeteHttp {
  const entetes = { ...entetesDuService(service, cle), 'Content-Type': 'application/json' };
  const ratio = d.ratio ?? undefined;
  switch (service) {
    case 'higgsfield':
      return { methode: 'POST', adresse: `https://api.higgsfield.ai/${modele}`, entetes, corps: { prompt: d.consigne, duration: d.duree } };
    case 'byteplus':
      return {
        methode: 'POST',
        adresse: `${BYTEPLUS}/contents/generations/tasks`,
        entetes,
        corps: { model: modele, content: [{ type: 'text', text: d.consigne }], duration: d.duree, ...(ratio ? { ratio } : {}), ...(d.son ? { generate_audio: true } : {}) },
      };
    case 'magnific':
      return {
        methode: 'POST',
        adresse: `${MAGNIFIC}/v1/ai/text-to-video/${modele}`,
        entetes,
        corps: { prompt: d.consigne, duration: modele.startsWith('kling') || modele.startsWith('wan') ? String(d.duree) : d.duree, ...(ratio ? { aspect_ratio: ratio } : {}), ...(modele.startsWith('veo') ? { generate_audio: d.son } : {}) },
      };
    case 'krea':
      return {
        methode: 'POST',
        adresse: `https://api.krea.ai/generate/video/${modele}`,
        entetes,
        corps: { prompt: d.consigne, duration: d.duree, ...(ratio ? { aspect_ratio: ratio } : {}), ...(d.son ? { generate_audio: true } : {}) },
      };
    case 'runway':
      return {
        methode: 'POST',
        adresse: `${RUNWAY}/v1/text_to_video`,
        entetes,
        corps: { model: modele, promptText: d.consigne.slice(0, 1000), duration: d.duree, ratio: ratio === '16:9' ? '1280:720' : '720:1280', ...(modele.startsWith('veo') ? { audio: d.son } : {}) },
      };
    case 'fal':
      return {
        methode: 'POST',
        adresse: `https://queue.fal.run/${modele}`,
        entetes,
        corps: {
          prompt: d.consigne,
          duration: modele.includes('veo') ? `${d.duree}s` : String(d.duree),
          ...(ratio ? { aspect_ratio: ratio } : {}),
          ...(modele.includes('veo') ? { generate_audio: d.son, resolution: '720p' } : {}),
          ...(modele.includes('seedance') ? { resolution: '720p' } : {}),
        },
      };
    case 'replicate':
      return {
        methode: 'POST',
        adresse: `https://api.replicate.com/v1/models/${modele}/predictions`,
        entetes,
        corps: { input: { prompt: d.consigne, duration: d.duree, ...(ratio ? { aspect_ratio: ratio } : {}), ...(modele.includes('veo') ? { generate_audio: d.son } : {}), ...(modele.includes('seedance') ? { resolution: '720p' } : {}) } },
      };
    case 'openrouter':
      throw new Error('OpenRouter ne fabrique pas d’extrait par cette voie');
  }
}

export type EtatDuTravail = { etat: 'attente'; suivi: string } | { etat: 'fini'; url: string } | { etat: 'echec'; raison: string };

/** Le message d'erreur d'une réponse, quel qu'en soit le service. */
function raisonDe(corps: any, defaut: string): string {
  const brut = corps?.error?.message ?? corps?.error ?? corps?.detail ?? corps?.failure ?? corps?.message ?? defaut;
  return String(typeof brut === 'string' ? brut : JSON.stringify(brut)).slice(0, 240);
}

/**
 * La réponse à la CRÉATION : l'adresse où suivre le travail (ou, si le service
 * a déjà fini, l'extrait lui-même).
 */
export function lireCreationDeClip(service: IdServiceCreation, modele: string, statut: number, corps: any): EtatDuTravail {
  if (statut === 401 || statut === 403) return { etat: 'echec', raison: 'le service refuse la clé enregistrée : retestez-la dans « Services de création »' };
  if (statut === 402) return { etat: 'echec', raison: 'le crédit de votre compte chez ce service est épuisé' };
  if (statut < 200 || statut >= 300) return { etat: 'echec', raison: `le service a refusé l’extrait (${statut}) : ${raisonDe(corps, 'sans détail')}` };
  switch (service) {
    case 'higgsfield':
      return corps?.status_url ? { etat: 'attente', suivi: String(corps.status_url) } : { etat: 'echec', raison: 'Higgsfield n’a rendu aucun suivi' };
    case 'byteplus':
      return corps?.id ? { etat: 'attente', suivi: `${BYTEPLUS}/contents/generations/tasks/${encodeURIComponent(corps.id)}` } : { etat: 'echec', raison: 'BytePlus n’a rendu aucun travail' };
    case 'magnific': {
      // Kling 3.0 Turbo se crée par résolution mais se suit à un seul chemin ; les autres, au chemin de création.
      const id = corps?.data?.task_id ?? corps?.task_id;
      return id ? { etat: 'attente', suivi: `${MAGNIFIC}/v1/ai/text-to-video/${modele.startsWith('kling-v3-turbo') ? 'kling-v3-turbo' : modele}/${encodeURIComponent(id)}` } : { etat: 'echec', raison: 'Freepik n’a rendu aucun travail' };
    }
    case 'krea':
      return corps?.job_id ? { etat: 'attente', suivi: `https://api.krea.ai/jobs/${encodeURIComponent(corps.job_id)}` } : { etat: 'echec', raison: 'Krea n’a rendu aucun travail' };
    case 'runway':
      return corps?.id ? { etat: 'attente', suivi: `${RUNWAY}/v1/tasks/${encodeURIComponent(corps.id)}` } : { etat: 'echec', raison: 'Runway n’a rendu aucun travail' };
    case 'fal':
      return corps?.status_url && corps?.response_url ? { etat: 'attente', suivi: `${corps.status_url}\n${corps.response_url}` } : { etat: 'echec', raison: 'fal.ai n’a rendu aucun suivi' };
    case 'replicate':
      return lireSuiviDeClip('replicate', 200, corps);
    default:
      return { etat: 'echec', raison: 'service inconnu' };
  }
}

/** L'adresse de suivi d'un travail (fal.ai en garde deux : l'état, puis le résultat). */
export function adresseDeSuivi(service: IdServiceCreation, suivi: string): string {
  return service === 'fal' ? suivi.split('\n')[0]! : suivi;
}

/**
 * LA RÉPONSE AU SUIVI : encore en cours, fini (avec l'adresse de l'extrait),
 * ou en échec (avec sa raison, telle que le service la donne).
 */
export function lireSuiviDeClip(service: IdServiceCreation, statut: number, corps: any, suivi = ''): EtatDuTravail {
  if (statut === 401 || statut === 403) return { etat: 'echec', raison: 'le service refuse la clé enregistrée pendant le suivi' };
  if (statut === 404) return { etat: 'echec', raison: 'le service ne retrouve plus ce travail' };
  if (statut >= 500 || statut === 429) return { etat: 'attente', suivi };
  if (statut < 200 || statut >= 300) return { etat: 'echec', raison: `suivi refusé (${statut}) : ${raisonDe(corps, 'sans détail')}` };
  switch (service) {
    case 'higgsfield': {
      const s = String(corps?.status ?? '');
      if (s === 'completed') return corps?.video?.url ? { etat: 'fini', url: String(corps.video.url) } : { etat: 'echec', raison: 'Higgsfield a fini sans vidéo' };
      if (s === 'failed' || s === 'nsfw' || s === 'canceled') return { etat: 'echec', raison: s === 'nsfw' ? 'refusé par la modération de Higgsfield' : raisonDe(corps, `Higgsfield : ${s}`) };
      return { etat: 'attente', suivi };
    }
    case 'byteplus': {
      const s = String(corps?.status ?? '');
      if (s === 'succeeded') return corps?.content?.video_url ? { etat: 'fini', url: String(corps.content.video_url) } : { etat: 'echec', raison: 'BytePlus a fini sans vidéo' };
      if (s === 'failed' || s === 'expired' || s === 'cancelled') return { etat: 'echec', raison: raisonDe(corps, `BytePlus : ${s}`) };
      return { etat: 'attente', suivi };
    }
    case 'magnific': {
      const d = corps?.data ?? corps;
      const s = String(d?.status ?? '');
      if (s === 'COMPLETED') return d?.generated?.[0] ? { etat: 'fini', url: String(d.generated[0]) } : { etat: 'echec', raison: 'Freepik a fini sans vidéo' };
      if (s === 'FAILED') return { etat: 'echec', raison: raisonDe(d, 'Freepik : échec de la génération') };
      return { etat: 'attente', suivi };
    }
    case 'krea': {
      const s = String(corps?.status ?? '');
      if (s === 'completed') return corps?.result?.urls?.[0] ? { etat: 'fini', url: String(corps.result.urls[0]) } : { etat: 'echec', raison: 'Krea a fini sans vidéo' };
      if (s === 'failed' || s === 'cancelled') return { etat: 'echec', raison: raisonDe(corps?.result ?? corps, `Krea : ${s}`) };
      return { etat: 'attente', suivi };
    }
    case 'runway': {
      const s = String(corps?.status ?? '');
      if (s === 'SUCCEEDED') return corps?.output?.[0] ? { etat: 'fini', url: String(corps.output[0]) } : { etat: 'echec', raison: 'Runway a fini sans vidéo' };
      if (s === 'FAILED' || s === 'CANCELLED') return { etat: 'echec', raison: raisonDe(corps, `Runway : ${s}`) };
      return { etat: 'attente', suivi };
    }
    case 'fal': {
      // L'état d'abord ; « COMPLETED » renvoie au résultat, lu à part (`lireResultatFal`).
      const s = String(corps?.status ?? '');
      if (s === 'COMPLETED') return corps?.error ? { etat: 'echec', raison: raisonDe(corps, 'fal.ai : échec') } : { etat: 'fini', url: '' };
      return { etat: 'attente', suivi };
    }
    case 'replicate': {
      const s = String(corps?.status ?? '');
      const sortie = Array.isArray(corps?.output) ? corps.output[0] : corps?.output;
      if (s === 'succeeded') return sortie ? { etat: 'fini', url: String(sortie) } : { etat: 'echec', raison: 'Replicate a fini sans vidéo' };
      if (s === 'failed' || s === 'canceled') return { etat: 'echec', raison: raisonDe(corps, `Replicate : ${s}`) };
      return { etat: 'attente', suivi: suivi || (corps?.urls?.get ? String(corps.urls.get) : corps?.id ? `https://api.replicate.com/v1/predictions/${encodeURIComponent(corps.id)}` : '') };
    }
    default:
      return { etat: 'echec', raison: 'service inconnu' };
  }
}

/** fal.ai : le résultat d'un travail fini porte la vidéo dans `video.url`. */
export function lireResultatFal(corps: any): EtatDuTravail {
  const url = corps?.video?.url ?? corps?.videos?.[0]?.url;
  return url ? { etat: 'fini', url: String(url) } : { etat: 'echec', raison: 'fal.ai a fini sans vidéo' };
}

/**
 * fal.ai PUBLIE SES PRIX (`/v1/models/pricing`) : le plafond d'un extrait se
 * calcule sur le prix lu, jamais écrit. `null` quand l'unité est inconnue.
 */
export function plafondFal(prix: { unit_price?: unknown; unit?: unknown } | undefined, duree: number): number | null {
  const p = Number(prix?.unit_price);
  if (!Number.isFinite(p) || p < 0) return null;
  const unite = String(prix?.unit ?? '').toLowerCase();
  if (unite.startsWith('second')) return Math.round(p * duree * 1e4) / 1e4;
  if (unite === 'video' || unite === 'videos' || unite === 'request' || unite === 'requests') return Math.round(p * 1e4) / 1e4;
  return null;
}

/** Ce que l'agent lit des services branchés : nom, modèles, durées, son. */
export function resumeDesServicesPourLAgent(branches: IdServiceCreation[]): string {
  const video = SERVICES_CREATION.filter((s) => branches.includes(s.id) && s.modeles.length);
  if (!video.length) return '';
  return video
    .map((s) => `${s.nom} (service « ${s.id} ») : ${s.modeles.map((m) => `« ${m.id} » ${m.nom} — ${m.durees.length > 4 ? `${m.durees[0]} à ${m.durees[m.durees.length - 1]} s` : `${m.durees.join(', ')} s`}${m.son ? ', avec son' : ''}`).join(' ; ')}`)
    .join('\n');
}

/** La clé de méta qui garde le modèle vidéo choisi pour une création. */
export function cleDuModeleVideo(creationId: string): string {
  return `studio.modele-video.${creationId}`;
}

/** Le repère que l'agent écrit dans sa réponse pour faire paraître l'encadré des services. */
export const REPERE_SERVICES_CREATION = '[services-de-creation]';

/* ------------------------------------------------------------------ */
/* La pose d'un extrait : l'image et son son, calés sur deux pistes     */
/* ------------------------------------------------------------------ */

export interface PoseDExtrait {
  videoMediaId: string;
  /** Le son séparé de l'extrait ; absent quand l'extrait n'a pas de son (aucune piste vide). */
  audioMediaId?: string;
  debut: number;
  duree: number;
  nom: string;
  /** La piste visuelle voulue par l'agent, si elle est libre à cet instant. */
  pisteVisuelleId?: string;
}

function pisteLibre(piste: Piste, debut: number, fin: number): boolean {
  return piste.segments.every((s) => s.debut + s.duree <= debut + 1e-3 || s.debut >= fin - 1e-3);
}

/**
 * POSER UN EXTRAIT SÉPARÉ (demande du 14/10/2026) : l'image MUETTE sur une
 * piste de visuels, son SON sur une piste de son, au MÊME instant et pour la
 * même durée. Chaque morceau va sur une piste libre à cet endroit ; s'il n'y en
 * a pas, une piste neuve est ajoutée (« Extraits », « Son des extraits ») —
 * jamais un extrait posé par-dessus un autre. La piste « Voix » n'est jamais
 * prise pour le son d'un extrait. Pure : `idNeuf` donne les identifiants.
 */
export function poserLExtrait(composition: Composition, e: PoseDExtrait, idNeuf: (prefixe: string) => string): ResultatOperation {
  let c = composition;
  const fin = e.debut + e.duree;
  const resumes: string[] = [];
  const appliquer = (op: OperationStudio): string | null => {
    const r = appliquerOperation(c, op, idNeuf);
    if (!r.ok) return r.raison;
    c = r.composition;
    resumes.push(r.resume);
    return null;
  };
  const trouverOuAjouter = (genre: 'visuel' | 'son', voulue: string | undefined, nom: string): string | { erreur: string } => {
    const candidates = c.pistes.filter((p) => p.genre === genre && (genre === 'visuel' || p.id !== 'voix'));
    const choisie = (voulue ? candidates.find((p) => p.id === voulue && pisteLibre(p, e.debut, fin)) : undefined) ?? candidates.find((p) => pisteLibre(p, e.debut, fin));
    if (choisie) return choisie.id;
    const avant = new Set(c.pistes.map((p) => p.id));
    const derniere = c.pistes.reduce((i, p, k) => (p.genre === genre ? k : i), -1);
    const erreur = appliquer({ op: 'piste-ajouter', genre, nom, position: derniere + 1 });
    if (erreur) return { erreur };
    return c.pistes.find((p) => !avant.has(p.id))!.id;
  };
  const visuelle = trouverOuAjouter('visuel', e.pisteVisuelleId, 'Extraits');
  if (typeof visuelle !== 'string') return { ok: false, raison: visuelle.erreur };
  const nom = e.nom.slice(0, 80);
  const erreurImage = appliquer({
    op: 'inserer',
    pisteId: visuelle,
    // L'IMAGE EST MUETTE : son son vit sur sa propre piste, réglable à part.
    segment: { genre: 'video', debut: e.debut, duree: e.duree, mediaId: e.videoMediaId, ajustement: 'couvrir', debutMedia: 0, volume: 0, nom },
  });
  if (erreurImage) return { ok: false, raison: erreurImage };
  if (e.audioMediaId) {
    const sonore = trouverOuAjouter('son', undefined, 'Son des extraits');
    if (typeof sonore !== 'string') return { ok: false, raison: sonore.erreur };
    const erreurSon = appliquer({ op: 'inserer', pisteId: sonore, segment: { genre: 'audio', debut: e.debut, duree: e.duree, mediaId: e.audioMediaId, debutMedia: 0, volume: 1, nom: `Son — ${nom}`.slice(0, 80) } });
    if (erreurSon) return { ok: false, raison: erreurSon };
  }
  return { ok: true, composition: c, resume: e.audioMediaId ? `extrait « ${nom} » posé (image et son)` : `extrait « ${nom} » posé (sans son)` };
}
