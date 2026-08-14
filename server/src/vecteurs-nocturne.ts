import {
  PERIODE_VECTORISATION_MS,
  TRANCHES_MAX_PAR_NUIT,
  decisionDeVectorisation,
  raisonSansVectorisationDite,
} from '@haikodev/shared';
import { getMeta, setMeta } from './db.js';
import { log } from './logger.js';
import * as store from './store.js';
import { couvertureDesVecteurs, indexerDocumentation, vectoriserLIndex } from './passages.js';
import { cleDesVecteurs } from './vecteurs.js';

/**
 * LA VECTORISATION DE LA NUIT — l'index de TOUS les projets, d'un coup.
 *
 * Vectoriser ne se paie plus au lancement d'une carte : une fois par nuit vers
 * 1 h, le démon relit chaque projet non archivé, met son index à jour et
 * vectorise tout ce qui ne l'est pas encore. Au matin, la recherche par le sens
 * est en place partout ; entre-temps, un projet pas encore traité retombe
 * proprement sur l'empreinte de mots.
 *
 * Les règles (heure, fenêtre, périodicité, refus) vivent dans
 * `shared/src/vecteurs-doc.ts` et se testent seules. Ici, la boucle et le
 * journal.
 */

const CLE_DERNIER_PASSAGE = 'vecteurs:dernier-passage';

/** Une passe est BORNÉE : ce qui déborde attend la nuit suivante. */
export interface BilanDeVectorisation {
  lance: boolean;
  raison?: string;
  projets: number;
  passages: number;
  vectorises: number;
}

/** Un seul rendez-vous à la fois : la boucle de veille ne se marche pas dessus. */
let enCours = false;

/**
 * LA VECTORISATION D'UN PROJET, jusqu'au bout ou jusqu'à la borne de la nuit.
 * Rend le nombre de passages réellement vectorisés, et le nombre de tranches
 * consommées — c'est la borne partagée entre tous les projets.
 */
export async function vectoriserUnProjet(
  projectId: string,
  projectPath: string,
  tranchesRestantes: number,
): Promise<{ vectorises: number; tranches: number; total: number }> {
  indexerDocumentation(projectId, projectPath);
  let vectorises = 0;
  let tranches = 0;
  while (tranches < tranchesRestantes) {
    const { faits } = await vectoriserLIndex(projectId);
    if (!faits) break;
    vectorises += faits;
    tranches += 1;
  }
  return { vectorises, tranches, total: couvertureDesVecteurs(projectId).total };
}

/**
 * LE RENDEZ-VOUS. Il ne refuse jamais parce qu'un agent travaille : vectoriser
 * n'appelle aucun moteur et ne prend la place de personne.
 */
export async function rendezVousDeVectorisation(force = false): Promise<BilanDeVectorisation> {
  if (enCours) return { lance: false, raison: 'une vectorisation tourne déjà', projets: 0, passages: 0, vectorises: 0 };

  const maintenant = Date.now();
  if (!force) {
    const brut = getMeta(CLE_DERNIER_PASSAGE);
    const decision = decisionDeVectorisation({
      clePosee: !!cleDesVecteurs(),
      dernierPassage: brut ? Number(brut) : undefined,
      maintenant,
      heureCourante: new Date(maintenant).getHours(),
    });
    if (!decision.lancer) {
      return { lance: false, raison: raisonSansVectorisationDite(decision.raison), projets: 0, passages: 0, vectorises: 0 };
    }
  }

  enCours = true;
  let projets = 0;
  let passages = 0;
  let vectorises = 0;
  let tranches = 0;
  try {
    for (const projet of store.listProjects()) {
      if (projet.archived) continue;
      if (tranches >= TRANCHES_MAX_PAR_NUIT) {
        log.info(`vectorisation : borne de la nuit atteinte, ${projet.name} et la suite attendront demain`);
        break;
      }
      try {
        const bilan = await vectoriserUnProjet(projet.id, projet.path, TRANCHES_MAX_PAR_NUIT - tranches);
        projets += 1;
        passages += bilan.total;
        vectorises += bilan.vectorises;
        tranches += bilan.tranches;
        if (bilan.vectorises) {
          log.info(`vectorisation : ${projet.name} — ${bilan.vectorises} passages vectorisés sur ${bilan.total}`);
        }
      } catch (err) {
        // Un projet dont le dossier a disparu ne doit pas emporter la nuit.
        log.warn(`vectorisation : ${projet.name} sauté — ${(err as Error).message}`);
      }
    }
    setMeta(CLE_DERNIER_PASSAGE, String(maintenant));
  } finally {
    enCours = false;
  }

  log.info(`vectorisation : ${projets} projet(s), ${vectorises} passages vectorisés sur ${passages} au total`);
  return { lance: true, projets, passages, vectorises };
}

/**
 * La veille. Elle ne réveille personne : elle regarde l'heure, et la décision
 * partagée fait le reste. Même cadence que le rendez-vous d'auto-amélioration.
 */
export const PERIODE_DE_VEILLE_MS = 10 * 60 * 1000;

export function planifierVectorisation(): NodeJS.Timeout {
  return setInterval(() => {
    void rendezVousDeVectorisation().then((bilan) => {
      // « Ce n'est pas l'heure » reviendrait des dizaines de fois par jour :
      // seul un refus DURABLE — aucune clé posée — mérite le journal, et une
      // seule fois par jour.
      if (!bilan.lance && bilan.raison?.startsWith('aucune clé')) {
        const dit = getMeta('vecteurs:sans-cle-dit');
        if (!dit || Date.now() - Number(dit) > PERIODE_VECTORISATION_MS) {
          log.info(`vectorisation : ${bilan.raison}`);
          setMeta('vecteurs:sans-cle-dit', String(Date.now()));
        }
      }
    });
  }, PERIODE_DE_VEILLE_MS);
}
