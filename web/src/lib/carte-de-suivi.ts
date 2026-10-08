import { carteEnPublication, estCarteDuRendezVousDeNuit, type Card, type CarteDeSuivi, type DeployRun } from '@beluga/shared';

/**
 * CE QUE LA FRISE ET LA BARRE D'ÉTAPES LISENT D'UNE CARTE, écrit une seule fois
 * pour les deux (`friseDeSuivi`, `barreDeSuivi`, `shared`).
 *
 * Une carte « À déployer » est « en cours de mise en ligne » exactement quand
 * sa barre d'écriture se verrouille (`carteEnPublication`) : la dernière
 * publication de son projet tourne ET la porte (`run.cardIds`). Le signal
 * s'éteint avec elle, en échec comme en succès. Une mise en production
 * (`cible: 'production'`) ne compte pas : elle se passe ailleurs, sur des
 * cartes déjà en ligne ici.
 */
export function carteDeSuivi(
  card: Card,
  options: {
    agentActif?: boolean;
    decisionEnAttente?: boolean;
    deploys: Record<string, DeployRun>;
    /** La colonne AFFICHÉE (`colonneAffichee`) quand elle diffère de la vraie. */
    colonne?: string;
  },
): CarteDeSuivi {
  const dernier = card.column === 'to_deploy' ? options.deploys[card.projectId] : undefined;
  const run = dernier && dernier.cible !== 'production' ? dernier : undefined;
  return {
    colonne: options.colonne ?? card.column,
    parcours: card.parcours,
    agentActif: options.agentActif,
    decisionEnAttente: options.decisionEnAttente,
    deployeeA: card.deployedAt,
    enPublication: carteEnPublication(run, card.id),
    publicationEchouee: run?.state === 'failed' && run.cardIds.includes(card.id),
    /* LA CARTE DE NUIT a ses trois ronds à elle : Demande, Examen, Propositions. */
    rendezVousDeNuit: estCarteDuRendezVousDeNuit(card) || undefined,
  };
}
