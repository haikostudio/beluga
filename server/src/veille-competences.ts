/**
 * LA VEILLE DES SOURCES DE COMPÉTENCES, côté démon (règles pures dans
 * `shared/src/veille-competences.ts`).
 *
 * Une fois par semaine, de nuit, un agent d'ANALYSE cherche sur GitHub et le
 * web des collections de compétences, les lit et PROPOSE celles qui valent
 * l'import. Il ne modifie rien et n'importe rien : chaque source retenue
 * devient une carte « À planifier » étiquetée « veille compétences », qui
 * reçoit son cadrage. L'import — qui sert ensuite tous les projets — reste le
 * geste de la carte acceptée (`competences`, action « importer »).
 *
 * Même mécanique que le rendez-vous d'auto-amélioration, dont elle réutilise la
 * pose des cartes et le cadrage (`auto-amelioration.ts`) : la date du passage
 * est notée AVANT le tour, un seul passage à la fois, jamais en même temps que
 * le rendez-vous de nuit, et le moindre échec est journalisé sans se propager.
 */

import {
  ATTENTE_PLACE_MAX_MS,
  LABEL_RENDEZ_VOUS_DE_NUIT,
  LABEL_VEILLE_COMPETENCES,
  consigneDeVeilleDeCompetences,
  decisionDeLaVeille,
  demandeDeCadrageDeLaVeille,
  descriptionDeLaVeille,
  fusionnerSourcesVues,
  rapportDeLaVeille,
  raisonDeLaVeilleDite,
  sourcesCitees,
  titreDeLaVeille,
} from '@beluga/shared';
import type { Project } from '@beluga/shared';
import { getMeta, setMeta } from './db.js';
import { log } from './logger.js';
import { sendPrompt } from './runtime.js';
import { direLaPanneSurLaCarte, ouvrirCarteDAgent, rangerCarteDAgent } from './carte-d-agent-demon.js';
import { catalogueMoteurs } from './catalogue-moteurs.js';
import { canStartAgent } from './capacity.js';
import { lireLeRegistre, lirePool } from './competences.js';
import {
  PERIODE_DE_VEILLE_MS,
  accepterPropositionsDeLaNuit,
  noterLesPropositionsDeLaNuit,
  ouvrirLesCadragesDeLaNuit,
  panneDuTour,
  projetDuRendezVous,
  rendezVousDeNuitEnCours,
} from './auto-amelioration.js';
import * as store from './store.js';

const CLE_DERNIER_PASSAGE = 'veille-competences.dernier-passage';
const CLE_ATTENTE_DEPUIS = 'veille-competences.attente-depuis';
const CLE_SOURCES_VUES = 'veille-competences.sources-vues';

let enCours = false;

function nombreMeta(cle: string): number | undefined {
  const brut = getMeta(cle);
  const valeur = brut ? Number(brut) : NaN;
  return Number.isFinite(valeur) ? valeur : undefined;
}

export function dernierPassageDeLaVeille(): number | undefined {
  return nombreMeta(CLE_DERNIER_PASSAGE);
}

/** Les sources déjà examinées lors des passages précédents, dans l'ordre où on les a vues. */
export function sourcesDejaVues(): string[] {
  try {
    const brut = JSON.parse(getMeta(CLE_SOURCES_VUES) || '[]') as unknown;
    return Array.isArray(brut) ? brut.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * Ce que le tour a examiné : les dépôts nommés dans sa réponse FINALE et dans
 * ses propositions. Mémorisés, ils ne sont pas rouverts la semaine suivante.
 */
function retenirLesSourcesDuTour(agentId: string): number {
  const messages = store.listMessages(agentId);
  const textes = messages.flatMap((m) => [
    ...(m.role === 'assistant' ? [m.content] : []),
    ...m.proposals.flatMap((p) => [p.title, p.description ?? '', p.briefing ?? '']),
  ]);
  const citees = sourcesCitees(textes.join('\n'));
  if (!citees.length) return 0;
  setMeta(CLE_SOURCES_VUES, JSON.stringify(fusionnerSourcesVues(sourcesDejaVues(), citees)));
  return citees.length;
}

/** Ce que l'agent doit savoir du pool avant de chercher : les fiches et les bibliothèques déjà là. */
function entreesDeLaConsigne() {
  const fiches = lirePool().fiches.map((f) => f.nom);
  const registre = lireLeRegistre();
  const importees = Object.values(registre)
    .map((e) => e.source)
    .filter(Boolean);
  return {
    fichesDuPool: fiches.sort(),
    bibliothequesImportees: importees,
    // Les bibliothèques importées comptent aussi comme déjà vues.
    sourcesVues: [...new Set([...sourcesDejaVues(), ...sourcesCitees(importees.join('\n'))])],
  };
}

/**
 * Le passage de la semaine. Appelé souvent, il ne fait presque toujours rien :
 * la décision partagée tranche, et dit pourquoi.
 */
export async function passageDeLaVeille(): Promise<{ lance: boolean; raison?: string; propositions?: number }> {
  if (enCours) return { lance: false, raison: 'veille déjà en cours' };

  const maintenant = Date.now();
  const date = new Date(maintenant);
  const projet: Project | undefined = projetDuRendezVous();

  const brute = nombreMeta(CLE_ATTENTE_DEPUIS);
  const attente = brute !== undefined && maintenant - brute >= ATTENTE_PLACE_MAX_MS ? undefined : brute;
  if (brute !== undefined && attente === undefined) setMeta(CLE_ATTENTE_DEPUIS, '');

  const decision = decisionDeLaVeille({
    projetPresent: !!projet,
    dernierPassage: dernierPassageDeLaVeille(),
    maintenant,
    jourCourant: date.getDay(),
    heureCourante: date.getHours(),
    placeLibre: canStartAgent().ok,
    autreRendezVousEnCours: rendezVousDeNuitEnCours(),
    enAttenteDepuis: attente,
    attenteMaxMs: ATTENTE_PLACE_MAX_MS,
  });
  if (!decision.lancer) {
    // Seul le premier « travail-en-cours » marque le début de l'attente et se journalise.
    if (decision.raison === 'travail-en-cours' && attente === undefined) {
      setMeta(CLE_ATTENTE_DEPUIS, String(maintenant));
      log.info(`veille des compétences : ${raisonDeLaVeilleDite(decision.raison)}`);
    }
    return { lance: false, raison: raisonDeLaVeilleDite(decision.raison) };
  }
  const cible = projet!;
  setMeta(CLE_ATTENTE_DEPUIS, '');

  // La date est notée AVANT le tour : un tour lent ne doit pas être relancé dix minutes plus tard.
  setMeta(CLE_DERNIER_PASSAGE, String(maintenant));
  enCours = true;

  // L'étiquette du rendez-vous de nuit donne à cette carte le même parcours à trois étapes.
  const { card: carteDeLaVeille, agentId } = ouvrirCarteDAgent({
    projectId: cible.id,
    titre: titreDeLaVeille(date),
    description: descriptionDeLaVeille(),
    labels: [LABEL_RENDEZ_VOUS_DE_NUIT],
    role: 'analysis',
  });

  let panne: string | null = null;
  try {
    await sendPrompt(agentId, consigneDeVeilleDeCompetences(entreesDeLaConsigne()), {
      template: 'none',
      silent: true,
    });
  } catch (err: any) {
    log.error('veille des compétences : le passage a échoué', err);
    panne = err?.message ?? 'raison inconnue';
  } finally {
    enCours = false;
  }

  panne ??= panneDuTour(agentId);
  if (panne) {
    direLaPanneSurLaCarte(carteDeLaVeille.id, agentId, panne);
    return { lance: true, raison: panne, propositions: 0 };
  }

  try {
    const retenues = retenirLesSourcesDuTour(agentId);
    if (retenues) log.info(`veille des compétences : ${retenues} source(s) examinée(s) mémorisée(s)`);
  } catch (err) {
    log.warn('veille des compétences : les sources examinées n’ont pas pu être mémorisées', err);
  }

  await noterLesPropositionsDeLaNuit(agentId);
  const cartes = accepterPropositionsDeLaNuit(agentId, await catalogueMoteurs().catch(() => []), LABEL_VEILLE_COMPETENCES);
  rangerCarteDAgent(carteDeLaVeille.id, agentId, 'archived', rapportDeLaVeille(cartes.map((carte) => carte.title)));
  log.info(`veille des compétences : passage tenu, ${cartes.length} carte(s) posée(s) dans « Planifié »`);

  const cadrages = await ouvrirLesCadragesDeLaNuit(cartes, cible.name, demandeDeCadrageDeLaVeille);
  if (cadrages) log.info(`veille des compétences : ${cadrages} cadrage(s) ouvert(s)`);
  return { lance: true, propositions: cartes.length };
}

/** La veille du passage : elle regarde l'heure, la décision partagée fait le reste. */
export function planifierLaVeilleDesCompetences(): NodeJS.Timeout {
  return setInterval(() => {
    void passageDeLaVeille().catch((err) => log.error('veille des compétences', err));
  }, PERIODE_DE_VEILLE_MS);
}
