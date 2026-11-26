/**
 * LES TRAVAUX DES SERVICES QUI TOURNENT, RELEVÉS POUR LA COLONNE DE GAUCHE (carte « Agents des services dans la
 * colonne », 25/11/2026). Les règles pures vivent dans `shared/src/travaux-des-services.ts`.
 *
 * Plutôt que d'instrumenter chaque sous-système, le démon RELÈVE toutes les quelques secondes ce qui tourne à la
 * source — les exports du Studio en file ou en cours, les sauvegardes en cours, et (fichier privé
 * `travaux-marketing.ts`) les études marketing actives et l'audit SEO + GEO. Un travail qui n'est plus au relevé est
 * jugé à sa source : fini, il reste en gras jusqu'à ce que le compte ouvre son écran ; tombé (échec, arrêt,
 * redémarrage), il sort. La liste et ses « vu » par compte sont gardés en base (`meta`), pour survivre à un
 * redémarrage. Rien ne part vers les écrans tant que la liste ne change pas (`signatureDesTravaux`).
 *
 * Réservé à l'administrateur : la commande et l'événement sont fermés d'office aux clients et aux collaborateurs
 * (`shared/src/droits-commandes.ts`, refus par défaut).
 */
import {
  marquerLesTravauxVus,
  sansLesTravauxRecurrents,
  signatureDesTravaux,
  suivreLesTravaux,
  type IssueDuTravail,
  type TravailDeService,
  type TravailSuivi,
} from '@beluga/shared';
import { bus } from './bus.js';
import { getDb, getMeta, setMeta } from './db.js';
import { log } from './logger.js';

const META_TRAVAUX = 'travaux-des-services';
const INTERVALLE_DU_RELEVE = 4000;

/** Une source : ce qui tourne en ce moment, et ce qu'est devenu un travail qui n'y est plus. */
export interface SourceDeTravaux {
  service: TravailDeService['service'];
  enCours(): TravailDeService[];
  issue(travail: TravailSuivi): IssueDuTravail;
}

const sources: SourceDeTravaux[] = [];

/** Une source s'inscrit (les privées, au démarrage, depuis leur fichier). */
export function inscrireUneSourceDeTravaux(source: SourceDeTravaux): void {
  if (!sources.some((s) => s.service === source.service)) sources.push(source);
}

let suivis: TravailSuivi[] | null = null;
let signature = '';

function lireLesSuivis(): TravailSuivi[] {
  if (suivis) return suivis;
  try {
    const brut = JSON.parse(getMeta(META_TRAVAUX) ?? '[]') as unknown;
    suivis = Array.isArray(brut) ? (brut as TravailSuivi[]) : [];
  } catch {
    suivis = [];
  }
  signature = signatureDesTravaux(suivis);
  return suivis;
}

function retenir(suite: TravailSuivi[]): void {
  suivis = suite;
  const nouvelle = signatureDesTravaux(suite);
  if (nouvelle === signature) return;
  signature = nouvelle;
  setMeta(META_TRAVAUX, JSON.stringify(suite));
  bus.emit({ type: 'travaux.services', travaux: suite });
}

/** Un relevé : chaque source dit ce qui tourne ; une source en panne ne fait tomber aucun travail des autres. */
export function releverLesTravaux(maintenant = Date.now()): TravailSuivi[] {
  const avant = lireLesSuivis();
  const courants: TravailDeService[] = [];
  const muettes = new Set<string>();
  for (const source of sources) {
    try {
      courants.push(...source.enCours());
    } catch (err) {
      muettes.add(source.service);
      log.warn(`travaux des services : relevé « ${source.service} » impossible`, String((err as Error)?.message ?? err));
    }
  }
  /* Une source muette garde ses travaux tels quels jusqu'au relevé suivant : jamais « tombés » sur une panne de lecture. */
  const gardes = avant.filter((t) => muettes.has(t.service) && t.etat === 'en-cours');
  const issue = (t: TravailSuivi): IssueDuTravail => {
    const source = sources.find((s) => s.service === t.service);
    if (!source) return 'tombe';
    try {
      return source.issue(t);
    } catch {
      return 'tombe';
    }
  };
  const suite = suivreLesTravaux(avant, [...courants, ...gardes], issue, maintenant);
  retenir(suite);
  return suite;
}

/** La liste suivie (vus compris), pour la commande et le relais des événements. */
export function travauxSuivis(): TravailSuivi[] {
  return lireLesSuivis();
}

/** L'écran d'un compte a ouvert le service : ces travaux finis sont vus par lui. */
export function marquerVus(ids: readonly string[], compteId: string): void {
  const suite = marquerLesTravauxVus(lireLesSuivis(), ids, compteId);
  if (suite) retenir(suite);
}

/* ------------------------------------------------------------------ */
/* Les sources publiques : le Studio et les sauvegardes                 */
/* ------------------------------------------------------------------ */

const sourceStudio: SourceDeTravaux = {
  service: 'studio',
  enCours() {
    const lignes = getDb()
      .prepare(
        "SELECT e.id, e.creation_id, e.project_id, e.genre, e.progression, e.cree_le, c.titre FROM studio_exports e LEFT JOIN studio_creations c ON c.id = e.creation_id WHERE e.etat IN ('en-file', 'en-cours')",
      )
      .all() as { id: string; creation_id: string; project_id: string; genre: string; progression: number; cree_le: number; titre: string | null }[];
    return lignes.map((l) => ({
      id: `studio:${l.id}`,
      service: 'studio',
      projectId: l.project_id,
      nature: l.genre === 'image' ? 'image' : 'video',
      ...(l.titre ? { objet: l.titre } : {}),
      adresse: `studio/${l.creation_id}`,
      pourcent: Math.round((l.progression ?? 0) * 100),
      etat: 'en-cours',
      debut: l.cree_le,
    }));
  },
  issue(travail) {
    const ligne = getDb().prepare('SELECT etat FROM studio_exports WHERE id = ?').get(travail.id.slice('studio:'.length)) as { etat: string } | undefined;
    return ligne?.etat === 'pret' ? 'termine' : 'tombe';
  },
};

const sourceBackups: SourceDeTravaux = {
  service: 'backups',
  enCours() {
    /* Import tardif : le module des sauvegardes tire la base et ses recettes, inutile tant que rien ne tourne.
       La tournée AUTOMATIQUE n'y est pas : la colonne ne montre que le ponctuel (décision du 25/11/2026). */
    const ids = backupsEnCoursConnus();
    if (!ids.length) return [];
    const lignes = getDb()
      .prepare(`SELECT id, project_id, nom FROM backup_sites WHERE id IN (${ids.map(() => '?').join(',')})`)
      .all(...ids) as { id: string; project_id: string | null; nom: string }[];
    return lignes
      .filter((l) => !!l.project_id)
      .map((l) => ({
        id: `backups:${l.id}`,
        service: 'backups',
        projectId: l.project_id!,
        nature: 'sauvegarde',
        objet: l.nom,
        adresse: `backups/${encodeURIComponent(l.id)}`,
        etat: 'en-cours',
        debut: Date.now(),
      }));
  },
  issue(travail) {
    const siteId = travail.id.slice('backups:'.length);
    const point = getDb().prepare('SELECT statut FROM backup_points WHERE site_id = ? AND debut >= ? ORDER BY debut DESC LIMIT 1').get(siteId, travail.debut - 60_000) as
      | { statut: string }
      | undefined;
    return point && point.statut !== 'echec' ? 'termine' : 'tombe';
  },
};

let backupsEnCoursConnus: () => string[] = () => [];

/**
 * LES LIGNES DE LA TOURNÉE AUTOMATIQUE DÉJÀ GARDÉES SORTENT. Avant le 25/11/2026, chaque sauvegarde de la tournée
 * de nuit laissait sa ligne (gardée une semaine) ; la source ne les relève plus, celles déjà en base se retirent ici.
 * Seule une ligne dont le point retrouvé (même site, début ≥ début du travail − 60 s, le plus récent) est d'origine
 * automatique sort — un point sans origine écrite est automatique, comme à sa lecture (`pointDepuisLigne`). Sans
 * point retrouvé, la ligne reste au jugement habituel de sa source. Sans effet la seconde fois.
 */
export function retirerLesSauvegardesAutomatiques(): number {
  const avant = lireLesSuivis();
  const pointDuTravail = getDb().prepare(
    "SELECT json_extract(data, '$.origine') AS origine FROM backup_points WHERE site_id = ? AND debut >= ? ORDER BY debut DESC LIMIT 1",
  );
  const suite = sansLesTravauxRecurrents(avant, (t) => {
    if (t.service !== 'backups') return false;
    const point = pointDuTravail.get(t.id.slice('backups:'.length), t.debut - 60_000) as { origine: string | null } | undefined;
    return !!point && point.origine !== 'manuel';
  });
  if (!suite) return 0;
  retenir(suite);
  return avant.length - suite.length;
}

let minuterie: NodeJS.Timeout | null = null;

/** Le relevé périodique, posé au démarrage du démon. Les travaux restés « en cours » d'avant sont jugés au premier relevé. */
export function demarrerLeReleveDesTravaux(): NodeJS.Timeout {
  inscrireUneSourceDeTravaux(sourceStudio);
  inscrireUneSourceDeTravaux(sourceBackups);
  void import('./backups.js')
    .then((m) => {
      backupsEnCoursConnus = m.backupsEnCoursVisibles;
    })
    .catch((err) => log.warn('travaux des services : sauvegardes non suivies', String(err?.message ?? err)));
  try {
    const retirees = retirerLesSauvegardesAutomatiques();
    if (retirees) log.info(`travaux des services : ${retirees} ligne(s) de la tournée automatique des sauvegardes retirée(s)`);
  } catch (err) {
    log.warn('travaux des services : lignes des sauvegardes automatiques non retirées', String((err as Error)?.message ?? err));
  }
  if (minuterie) clearInterval(minuterie);
  minuterie = setInterval(() => {
    try {
      releverLesTravaux();
    } catch (err) {
      log.warn('travaux des services : relevé impossible', String((err as Error)?.message ?? err));
    }
  }, INTERVALLE_DU_RELEVE);
  minuterie.unref?.();
  return minuterie;
}
