import {
  BORNES_DE_VECTORISATION,
  PERIODE_VECTORISATION_MS,
  decisionDeVectorisation,
  raisonSansVectorisationDite,
  type AmpleurDeVectorisation,
} from '@haikodev/shared';
import { getMeta, setMeta } from './db.js';
import { log } from './logger.js';
import * as store from './store.js';
import {
  PROJET_DU_POOL,
  couvertureDesVecteurs,
  indexerDocumentation,
  indexerLePool,
  vectoriserLIndex,
} from './passages.js';
import { etatDesVecteurs } from './vecteurs.js';

/**
 * LA VECTORISATION DE FOND — l'index de TOUS les projets, d'un coup.
 *
 * Vectoriser ne se paie pas au lancement d'une carte : le démon relit chaque
 * projet non archivé, met son index à jour et vectorise ce qui ne l'est pas
 * encore. Entre-temps, un projet pas encore traité retombe proprement sur
 * l'empreinte de mots.
 *
 * LE RENDEZ-VOUS REVIENT TOUTES LES SIX HEURES, plus une seule fois par nuit :
 * une passe nocturne unique laissait la journée défaire ce que la nuit venait de
 * faire. La passe de NUIT (1 h – 3 h) reste le grand rattrapage, trois heures ;
 * les trois passes de JOUR ne reprennent que ce que les cartes viennent de
 * modifier, en dix minutes au plus (`BORNES_DE_VECTORISATION`).
 *
 * Les règles (heure, ampleur, périodicité, refus) vivent dans
 * `shared/src/vecteurs-doc.ts` et se testent seules. Ici, la boucle et le
 * journal.
 */

const CLE_DERNIER_PASSAGE = 'vecteurs:dernier-passage';

/** Une passe est BORNÉE : ce qui déborde attend la passe suivante. */
export interface BilanDeVectorisation {
  lance: boolean;
  raison?: string;
  projets: number;
  passages: number;
  vectorises: number;
  /** Grand rattrapage de nuit, ou passe courte de jour. */
  ampleur?: AmpleurDeVectorisation;
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
  finAu = Number.POSITIVE_INFINITY,
  saut = 0,
): Promise<{ vectorises: number; tranches: number; total: number }> {
  indexerDocumentation(projectId, projectPath);
  return vectoriserUnCorpus(projectId, tranchesRestantes, finAu, saut);
}

/**
 * LA VECTORISATION D'UN CORPUS DÉJÀ INDEXÉ — un projet, ou le POOL de
 * compétences, qui n'est pas un projet mais se vectorise exactement pareil.
 */
export async function vectoriserUnCorpus(
  projectId: string,
  tranchesRestantes: number,
  finAu = Number.POSITIVE_INFINITY,
  saut = 0,
): Promise<{ vectorises: number; tranches: number; total: number }> {
  let vectorises = 0;
  let tranches = 0;
  while (tranches < tranchesRestantes && Date.now() < finAu) {
    const { faits } = await vectoriserLIndex(projectId, saut);
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
  /*
   * L'AMPLEUR DÉCIDE DES BORNES. Forcée à la main, la passe est traitée comme
   * celle de son HEURE : lancée à 14 h, elle reste courte — on ne bloque pas la
   * machine trois heures sur un geste manuel — et lancée la nuit, elle rattrape.
   */
  let ampleur: AmpleurDeVectorisation = new Date(maintenant).getHours() < 4 ? 'nuit' : 'jour';
  if (!force) {
    const brut = getMeta(CLE_DERNIER_PASSAGE);
    const decision = decisionDeVectorisation({
      clePosee: etatDesVecteurs().pret,
      dernierPassage: brut ? Number(brut) : undefined,
      maintenant,
      heureCourante: new Date(maintenant).getHours(),
    });
    if (!decision.lancer) {
      return { lance: false, raison: raisonSansVectorisationDite(decision.raison), projets: 0, passages: 0, vectorises: 0 };
    }
    ampleur = decision.ampleur;
  }
  const bornes = BORNES_DE_VECTORISATION[ampleur];

  enCours = true;
  /*
   * LA BORNE DE TEMPS. Le moteur local fait deux passages par seconde : sans
   * elle, la première nuit déborderait de neuf heures sur la journée. On
   * s'arrête à l'heure dite et on reprend demain, là où on en était — l'index
   * se complète en quelques nuits, aucune ne mord sur le travail.
   */
  const finAu = maintenant + bornes.dureeMs;
  let projets = 0;
  let passages = 0;
  let vectorises = 0;
  let tranches = 0;
  try {
    /*
     * LE POOL DE COMPÉTENCES PASSE EN PREMIER. Ce n'est pas un projet — il n'a
     * ni dossier de travail ni tableau — mais c'est un corpus servi à TOUS les
     * projets : préparé une seule fois, il doit être vectorisé une fois aussi,
     * et avant le reste (il est petit, et une fiche non vectorisée pèse sur
     * toutes les recherches, pas sur une seule).
     */
    try {
      indexerLePool();
      const bilanDuPool = await vectoriserUnCorpus(PROJET_DU_POOL, bornes.tranches, finAu);
      passages += bilanDuPool.total;
      vectorises += bilanDuPool.vectorises;
      tranches += bilanDuPool.tranches;
      if (bilanDuPool.vectorises) {
        log.info(
          `vectorisation : pool de compétences — ${bilanDuPool.vectorises} passages vectorisés sur ${bilanDuPool.total}`,
        );
      }
    } catch (err) {
      log.warn(`vectorisation : pool de compétences sauté — ${(err as Error).message}`);
    }

    for (const projet of store.listProjects()) {
      if (projet.archived) continue;
      if (tranches >= bornes.tranches || Date.now() >= finAu) {
        log.info(
          `vectorisation : borne de la passe de ${ampleur} atteinte, ${projet.name} et la suite attendront la prochaine`,
        );
        break;
      }
      try {
        const bilan = await vectoriserUnProjet(projet.id, projet.path, bornes.tranches - tranches, finAu);
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

  log.info(
    `vectorisation (passe de ${ampleur}) : ${projets} projet(s), ${vectorises} passages vectorisés sur ${passages} au total`,
  );
  return { lance: true, projets, passages, vectorises, ampleur };
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
