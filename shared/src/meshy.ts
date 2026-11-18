/**
 * MESHY — LE SERVICE 3D DU STUDIO (demande du 01/11/2026) : un personnage 3D
 * animé, fabriqué d'après UNE image, puis filmé par le serveur image par image
 * en vidéo sans fond. Payé à l'usage en crédits prépayés Meshy ; il ne sert QU'À
 * la 3D (kie.ai reste le seul service des images, vidéos et sons — DEC-414).
 *
 * Règles PURES : les demandes à envoyer, la lecture des réponses, le prix d'un
 * devis. `server/src/studio-3d.ts` fait les appels ; `server/src/test/
 * meshy.test.ts` verrouille ces règles.
 *
 * Vérifié dans la documentation officielle (https://docs.meshy.ai/llms.txt,
 * 01/11/2026) :
 *  - authentification `Authorization: Bearer msy_…` ;
 *  - tâches ASYNCHRONES : le POST rend `{ result: <id> }`, le GET de la tâche
 *    rend `status` (PENDING, IN_PROGRESS, SUCCEEDED, FAILED, CANCELED),
 *    `consumed_credits` et `task_error.message` ; une tâche FAILED est remboursée ;
 *  - Image to 3D `POST /openapi/v1/image-to-3d` (`image_url` en adresse publique
 *    OU en data URI ; 30 crédits avec textures 2K ; `should_remesh` +
 *    `target_polycount` allègent le maillage à la source) ;
 *  - Rigging `POST /openapi/v1/rigging` (`input_task_id`, 5 crédits, humanoïde
 *    seulement : 422 quand la pose n'est pas reconnue) — il rend aussi, sans
 *    frais, la marche et la course (`basic_animations`) ;
 *  - Animation `POST /openapi/v1/animations` (`rig_task_id`, `action_ids` 1 à 10,
 *    3 crédits par action, un seul GLB avec un clip par action, dans l'ordre) ;
 *  - solde `GET /openapi/v1/balance` (gratuit : sert au test de la clé) ;
 *  - catalogue public des mouvements, sans clé :
 *    `GET https://api.meshy.ai/web/public/animations/resources`.
 *  - les fichiers rendus ne restent que 3 jours chez Meshy : on les rapatrie.
 */

export const MESHY_API = 'https://api.meshy.ai';
export const CATALOGUE_PUBLIC_MESHY = `${MESHY_API}/web/public/animations/resources`;

/** Les crédits de chaque geste (grille officielle du 01/11/2026). */
export const CREDITS_MESHY = { modele: 30, squelette: 5, mouvement: 3 } as const;

/**
 * LE PRIX D'UN CRÉDIT, EN DOLLARS : Meshy ne le publie pas par l'API (il dépend
 * du forfait ou du pack acheté). Base retenue : l'offre Pro, 1 000 crédits pour
 * 20 $ (0,02 $ le crédit) ; le démon le lit dans la méta `studio.meshy.dollarsParCredit`
 * quand l'utilisateur en a un autre. Le devis le dit en crédits ET en dollars.
 */
export const DOLLARS_PAR_CREDIT_MESHY = 0.02;

/** Les deux mouvements que le squelette rend SANS FRAIS (`basic_animations`). */
export const MOUVEMENTS_OFFERTS_MESHY = [
  { id: -2, nom: 'Marche', cle: 'walking' },
  { id: -1, nom: 'Course', cle: 'running' },
] as const;

/** Durée d'un mouvement filmé, en secondes : bornée (le rendu se fait sans carte graphique). */
export const DUREE_MOUVEMENT_3D = { defaut: 4, min: 1, max: 10 } as const;
/** Le nombre de mouvements d'un même devis. */
export const MOUVEMENTS_3D_MAX = 3;
/** Le cadre filmé : un portrait, le personnage en pied (posé « contenir » sur la piste). */
export const CADRE_RENDU_3D = { largeur: 720, hauteur: 960, fps: 30 } as const;

export interface MouvementMeshy {
  id: number;
  nom: string;
  categorie: string;
  sousCategorie: string;
}

export interface RequeteMeshy {
  methode: 'GET' | 'POST';
  adresse: string;
  entetes: Record<string, string>;
  corps?: unknown;
}

const entetes = (cle: string): Record<string, string> => ({ Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' });

/** Le modèle texturé d'après une image (adresse publique ou data URI), allégé à la source, posé en A pour le squelette. */
export function requeteImageVers3d(cle: string, image: string): RequeteMeshy {
  return {
    methode: 'POST',
    adresse: `${MESHY_API}/openapi/v1/image-to-3d`,
    entetes: entetes(cle),
    corps: { image_url: image, ai_model: 'latest', should_texture: true, texture_resolution: '2k', should_remesh: true, target_polycount: 30000, pose_mode: 'a-pose' },
  };
}

export function requeteDuSquelette(cle: string, tacheModele: string): RequeteMeshy {
  return { methode: 'POST', adresse: `${MESHY_API}/openapi/v1/rigging`, entetes: entetes(cle), corps: { input_task_id: tacheModele, height_meters: 1.7 } };
}

export function requeteDesMouvements(cle: string, tacheSquelette: string, actions: readonly number[]): RequeteMeshy {
  return { methode: 'POST', adresse: `${MESHY_API}/openapi/v1/animations`, entetes: entetes(cle), corps: { rig_task_id: tacheSquelette, action_ids: [...actions] } };
}

export type GenreDeTacheMeshy = 'image-to-3d' | 'rigging' | 'animations';

export function requeteDeSuiviMeshy(cle: string, genre: GenreDeTacheMeshy, id: string): RequeteMeshy {
  return { methode: 'GET', adresse: `${MESHY_API}/openapi/v1/${genre}/${encodeURIComponent(id)}`, entetes: entetes(cle) };
}

function raisonMeshy(corps: any, defaut: string): string {
  const brut = corps?.task_error?.message || corps?.message || corps?.error || defaut;
  return String(typeof brut === 'string' ? brut : JSON.stringify(brut)).slice(0, 240);
}

/** La réponse à une CRÉATION de tâche : son identifiant, ou la raison du refus, dite en clair. */
export function lireCreationMeshy(genre: GenreDeTacheMeshy, statut: number, corps: any): { ok: true; id: string } | { ok: false; raison: string } {
  if (statut === 401 || statut === 403) return { ok: false, raison: 'Meshy refuse la clé enregistrée : retestez-la dans « Services de création »' };
  if (statut === 402) return { ok: false, raison: 'le crédit Meshy est épuisé : rechargez-le sur meshy.ai' };
  if (statut === 422 && genre === 'rigging') return { ok: false, raison: 'Meshy ne reconnaît pas un personnage humanoïde (deux bras, deux jambes) : le squelette est impossible sur cette image' };
  if (statut === 429) return { ok: false, raison: 'Meshy est saturé (trop de demandes) : réessayez dans un instant' };
  if (statut < 200 || statut >= 300) return { ok: false, raison: `Meshy a refusé la demande (${statut}) : ${raisonMeshy(corps, 'sans détail')}` };
  const id = typeof corps?.result === 'string' ? corps.result : '';
  return id ? { ok: true, id } : { ok: false, raison: 'Meshy n’a rendu aucune tâche' };
}

export type EtatTacheMeshy =
  | { etat: 'attente'; progression: number }
  | { etat: 'fini'; credits: number | null; tache: any }
  | { etat: 'echec'; raison: string; rembourse: boolean };

/** La réponse au SUIVI d'une tâche. Une panne passagère (429, 5xx) reste « en attente ». */
export function lireSuiviMeshy(statut: number, corps: any): EtatTacheMeshy {
  if (statut === 429 || statut >= 500) return { etat: 'attente', progression: 0 };
  if (statut === 401 || statut === 403) return { etat: 'echec', raison: 'Meshy refuse la clé enregistrée pendant le suivi', rembourse: false };
  if (statut === 404) return { etat: 'echec', raison: 'Meshy ne retrouve plus cette tâche', rembourse: false };
  if (statut < 200 || statut >= 300) return { etat: 'echec', raison: `suivi refusé (${statut}) : ${raisonMeshy(corps, 'sans détail')}`, rembourse: false };
  const s = String(corps?.status ?? '');
  const credits = Number(corps?.consumed_credits);
  if (s === 'SUCCEEDED') return { etat: 'fini', credits: Number.isFinite(credits) ? credits : null, tache: corps };
  if (s === 'FAILED') return { etat: 'echec', raison: raisonMeshy(corps, 'Meshy : la tâche a échoué'), rembourse: true };
  if (s === 'CANCELED') return { etat: 'echec', raison: 'Meshy : la tâche a été annulée', rembourse: true };
  const p = Number(corps?.progress);
  return { etat: 'attente', progression: Number.isFinite(p) ? p : 0 };
}

/** L'adresse du GLB d'une tâche finie : le modèle, le personnage rigué, un mouvement offert, ou le mouvement payé. */
export function glbDeLaTache(genre: GenreDeTacheMeshy, tache: any, offert?: 'walking' | 'running'): string | null {
  const r = tache?.result ?? {};
  const url =
    genre === 'image-to-3d'
      ? tache?.model_urls?.glb
      : genre === 'rigging'
        ? offert
          ? r?.basic_animations?.[`${offert}_glb_url`]
          : r?.rigged_character_glb_url
        : r?.animation_glb_url;
  return typeof url === 'string' && /^https:\/\//.test(url) ? url : null;
}

/** Le catalogue public lu : les mouvements de personnage, sans les deux offerts (ils ont leur propre entrée). */
export function lireCatalogueMeshy(corps: any): MouvementMeshy[] {
  const liste = Array.isArray(corps?.result?.list) ? corps.result.list : Array.isArray(corps) ? corps : [];
  return liste
    .filter((m: any) => Number.isInteger(m?.id) && m.id >= 0 && typeof m?.name === 'string')
    .map((m: any) => ({ id: m.id, nom: String(m.name), categorie: String(m.category ?? ''), sousCategorie: String(m.subCategory ?? '') }));
}

/** Le DEVIS d'un personnage 3D : crédits et dollars, d'après ce qu'il faut fabriquer. */
export function devisPersonnage3d(e: { modeleNeuf: boolean; mouvements: readonly number[]; dollarsParCredit?: number }): { credits: number; dollars: number; payants: number[] } {
  const payants = [...new Set(e.mouvements.filter((id) => Number.isInteger(id) && id >= 0))];
  const credits = (e.modeleNeuf ? CREDITS_MESHY.modele + CREDITS_MESHY.squelette : 0) + payants.length * CREDITS_MESHY.mouvement;
  const taux = e.dollarsParCredit && e.dollarsParCredit > 0 ? e.dollarsParCredit : DOLLARS_PAR_CREDIT_MESHY;
  return { credits, dollars: Math.round(credits * taux * 1e4) / 1e4, payants };
}

/** Ce qu'un devis demande, vérifié : mouvements connus (1 à 3), durée bornée. */
export function mouvementsDemandes(brut: unknown, catalogue: readonly Pick<MouvementMeshy, 'id'>[]): { ok: true; ids: number[] } | { ok: false; raison: string } {
  const ids = (Array.isArray(brut) ? brut : brut === undefined ? [-2] : [brut]).map((x) => Number(String(x).trim()));
  if (!ids.length) return { ok: false, raison: 'il faut au moins un mouvement' };
  if (ids.length > MOUVEMENTS_3D_MAX) return { ok: false, raison: `${MOUVEMENTS_3D_MAX} mouvements au plus par devis` };
  const connus = new Set<number>([...MOUVEMENTS_OFFERTS_MESHY.map((m) => m.id), ...catalogue.map((m) => m.id)]);
  const inconnu = ids.find((id) => !Number.isInteger(id) || !connus.has(id));
  if (inconnu !== undefined) return { ok: false, raison: `mouvement inconnu : « ${inconnu} » (lis le catalogue avec « catalogue » : true)` };
  return { ok: true, ids: [...new Set(ids)] };
}

export function dureeDuMouvement3d(brut: unknown): number {
  const n = Number(brut);
  if (!Number.isFinite(n) || n <= 0) return DUREE_MOUVEMENT_3D.defaut;
  return Math.min(DUREE_MOUVEMENT_3D.max, Math.max(DUREE_MOUVEMENT_3D.min, Math.round(n * 10) / 10));
}
