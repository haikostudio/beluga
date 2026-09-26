/**
 * LE LANCEMENT D'UNE CARTE SE RACONTE PENDANT QU'IL SE FAIT.
 *
 * Entre le clic sur « Lancer la tâche » et le premier mot du moteur, il se
 * passe plusieurs choses, et certaines sont LONGUES : les portes dures (place
 * sur la machine, quota d'un compte), l'ouverture de la copie de travail
 * (`git worktree add`, qui sur un gros dépôt peut tenir plusieurs minutes),
 * l'agent à poser, le tour à confier au moteur. L'écran n'en disait rien : la
 * carte restait où elle était, et au bout de dix secondes un message
 * d'avertissement — le même que pour un bouton en panne — annonçait que « ça
 * prend plus de temps que prévu ». Un travail qui avance normalement était donc
 * signalé comme un incident.
 *
 * Ce module ne connaît ni git, ni React, ni le réseau. Il ne dit que trois
 * choses : QUELLES étapes compose un lancement, DANS QUEL ORDRE, et QUELLE PART
 * du chemin chacune représente. L'écran en tire une barre d'avancement et une
 * phrase NEUTRE ; le démon se contente de nommer l'étape où il est.
 *
 * Aucune de ces étapes ne survit à un redémarrage : elles ne sont donc jamais
 * enregistrées en base, seulement diffusées (`card.lancement`).
 */

/** Les étapes d'un lancement, dans l'ordre où elles se franchissent. */
export type EtapeDeLancement = 'portes' | 'dossier' | 'agent' | 'moteur';

/**
 * L'ordre est la SEULE source de l'avancement : on ne pose pas de pourcentages
 * à la main, on compte le chemin parcouru.
 */
export const ETAPES_DE_LANCEMENT: EtapeDeLancement[] = ['portes', 'dossier', 'agent', 'moteur'];

/**
 * Ce que chaque étape DIT, en français simple. Aucune n'annonce un problème :
 * ce sont des travaux normaux, longs pour certains.
 */
const LIBELLES: Record<EtapeDeLancement, string> = {
  portes: 'Vérification des accès et de la place',
  dossier: 'Création du dossier de travail',
  agent: 'Ouverture de la branche',
  moteur: 'Attente du moteur',
};

/** Le nom lisible d'une étape de lancement. */
export function libelleEtapeDeLancement(etape: EtapeDeLancement): string {
  return LIBELLES[etape];
}

/**
 * LA PART DU CHEMIN DÉJÀ FAITE, entre 0 et 1.
 *
 * Une étape qui COMMENCE ne vaut pas zéro : le lancement est bel et bien parti,
 * et une barre restée vide se lit comme un geste tombé à côté. On compte donc
 * l'étape en cours pour la moitié de sa part, et la dernière ne va jamais
 * jusqu'à 1 — c'est le premier mot du moteur qui termine, pas nous.
 */
export function avancementDuLancement(etape: EtapeDeLancement): number {
  const rang = ETAPES_DE_LANCEMENT.indexOf(etape);
  if (rang < 0) return 0;
  return (rang + 0.5) / ETAPES_DE_LANCEMENT.length;
}

/**
 * LA PHRASE NEUTRE qui remplace l'ancien avertissement. Elle ne conclut rien,
 * n'alerte de rien : elle DIT où en est la préparation.
 */
export function mentionDeLancement(etape: EtapeDeLancement): string {
  return `Préparation en cours — ${libelleEtapeDeLancement(etape).toLowerCase()}…`;
}

/**
 * UNE PRÉPARATION N'EST PAS ÉTERNELLE. Un démon coupé en plein `git worktree
 * add` ne diffusera jamais la fin de son étape : sans ce garde-fou, la carte
 * garderait sa barre d'avancement à vie. Au-delà du délai, l'écran l'oublie et
 * retombe sur ce que dit la carte elle-même.
 */
export const PEREMPTION_LANCEMENT_MS = 30 * 60 * 1000;

/** Cette préparation est-elle encore crédible à cet instant ? */
export function lancementEncoreCredible(depuis: number, maintenant: number): boolean {
  return maintenant - depuis < PEREMPTION_LANCEMENT_MS;
}

/**
 * LA SEULE COLONNE OÙ UNE PRÉPARATION VEUT DIRE QUELQUE CHOSE.
 *
 * Une préparation est la fenêtre entre le clic et le premier mot du moteur, et
 * pendant toute cette fenêtre la carte est en « Travail » — le clic l'y pose
 * tout de suite. Une carte posée ailleurs ne prépare donc RIEN : ni une carte
 * revenue en « Demande », ni surtout une carte déjà rangée en « Rapport ».
 */
export const COLONNE_DE_LA_PREPARATION = 'running';

/** Ce qu'il faut savoir pour dire si une préparation doit encore s'afficher. */
export interface PreparationVue {
  /** L'étape diffusée par le démon, si un signal est arrivé. */
  etape?: EtapeDeLancement;
  /** L'instant du signal. */
  depuis: number;
  /** La colonne où la carte se trouve MAINTENANT. */
  colonne: string;
  /** Un agent tient son tour sur cette carte : c'est lui qui parle, plus la barre. */
  agentAuTravail: boolean;
  /** L'instant du démarrage du démon en cours, quand l'écran le connaît. */
  demonDemarreA?: number;
  maintenant: number;
}

/**
 * UNE PRÉPARATION QUI MENT NE S'AFFICHE PAS.
 *
 * Le signal `card.lancement` est diffusé, jamais enregistré : quand le tour
 * meurt sans passer par sa fin — démon coupé, moteur qui ne rend jamais la
 * main, carte rangée par le balayage —, personne ne le referme, et l'écran
 * gardait sa barre jaune « Préparation en cours — attente du moteur… » pendant
 * une demi-heure. Elle se posait alors sur des cartes DÉJÀ TERMINÉES, ou
 * revenues en « Demande » : le tableau annonçait un lancement en route là où
 * plus rien ne tournait.
 *
 * Trois faits éteignent la barre, tous vérifiables sans rien deviner :
 *
 *  - la carte n'est plus en « Travail » : la fenêtre de préparation est
 *    forcément finie, quoi qu'ait dit le dernier signal reçu ;
 *  - un agent tient son tour : c'est lui qui raconte, pas la préparation ;
 *  - le signal est antérieur au DÉMARRAGE du démon en cours, ou trop vieux :
 *    aucune préparation ne survit à un redémarrage.
 */
export function preparationAAfficher(vue: PreparationVue): EtapeDeLancement | null {
  if (!vue.etape) return null;
  if (vue.agentAuTravail) return null;
  if (vue.colonne !== COLONNE_DE_LA_PREPARATION) return null;
  if (vue.demonDemarreA && vue.depuis < vue.demonDemarreA) return null;
  if (!lancementEncoreCredible(vue.depuis, vue.maintenant)) return null;
  return vue.etape;
}
