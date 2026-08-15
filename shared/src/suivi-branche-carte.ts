/**
 * L'ONGLET « GITHUB » D'UNE CARTE NE PARLE QUE DE LA BRANCHE DE SON AGENT.
 *
 * Il montrait « les 10 derniers commits » de la branche — c'est-à-dire, une fois
 * la branche née de la principale, l'HISTORIQUE GÉNÉRAL du dépôt : des
 * enregistrements faits par d'autres cartes, parfois des mois plus tôt, sans
 * aucun rapport avec le travail de celle qu'on regarde.
 *
 * Ce qui appartient VRAIMENT à une carte se compte à partir du point de départ
 * de sa branche (`baseSha`, retenu à sa création) :
 *
 *   - quand la branche est née, et ce qu'elle a enregistré DEPUIS ;
 *   - combien de fichiers ajoutés, modifiés, supprimés, et lesquels ;
 *   - le déroulé de son déploiement, étape par étape, jusqu'à la fusion.
 *
 * Tout est ici en règles pures — sans git, sans base, sans écran — pour être
 * lisible et rejouable ; `server/src/github.ts` relève, `card-panel.tsx` affiche.
 */

import type { DeployRun, DeployStepKey } from './models.js';

/* ------------------------------------------------------------------ */
/* Les fichiers touchés par la branche                                  */
/* ------------------------------------------------------------------ */

export type EtatDeFichier = 'ajoute' | 'modifie' | 'supprime' | 'renomme';

export interface FichierTouche {
  chemin: string;
  etat: EtatDeFichier;
}

/**
 * La lettre rendue par `git diff --name-status` traduite en état lisible. Une
 * lettre inconnue (type de fichier changé, copie, désaccord de fusion) compte
 * comme une modification : on préfère un fichier rangé au mieux à un fichier tu.
 */
export function etatDepuisGit(lettre: string): EtatDeFichier {
  const initiale = (lettre ?? '').trim().charAt(0).toUpperCase();
  if (initiale === 'A') return 'ajoute';
  if (initiale === 'D') return 'supprime';
  if (initiale === 'R') return 'renomme';
  return 'modifie';
}

/**
 * La sortie de `git diff --name-status` en liste de fichiers.
 *
 * Un renommage porte DEUX chemins (`R096  ancien  nouveau`) : on garde le
 * nouveau, le seul qui existe encore. Les lignes vides et les doublons sont
 * écartés ; l'ordre d'origine est conservé.
 */
export function fichiersDepuisNameStatus(sortie: string): FichierTouche[] {
  const vus = new Set<string>();
  const fichiers: FichierTouche[] = [];
  for (const ligne of (sortie ?? '').split('\n')) {
    const morceaux = ligne.split('\t').filter(Boolean);
    if (morceaux.length < 2) continue;
    const etat = etatDepuisGit(morceaux[0]);
    const chemin = (morceaux[morceaux.length - 1] ?? '').trim();
    if (!chemin || vus.has(chemin)) continue;
    vus.add(chemin);
    fichiers.push({ chemin, etat });
  }
  return fichiers;
}

export interface ResumeDesFichiers {
  ajoutes: number;
  modifies: number;
  supprimes: number;
  total: number;
}

/** Le compte par état. Un renommage compte comme une modification. */
export function resumeDesFichiers(fichiers: FichierTouche[]): ResumeDesFichiers {
  const resume: ResumeDesFichiers = { ajoutes: 0, modifies: 0, supprimes: 0, total: 0 };
  for (const fichier of fichiers ?? []) {
    resume.total += 1;
    if (fichier.etat === 'ajoute') resume.ajoutes += 1;
    else if (fichier.etat === 'supprime') resume.supprimes += 1;
    else resume.modifies += 1;
  }
  return resume;
}

/** « 3 ajoutés · 5 modifiés · 1 supprimé », sans les zéros. */
export function phraseDesFichiers(resume: ResumeDesFichiers): string {
  const bouts: string[] = [];
  if (resume.ajoutes) bouts.push(`${resume.ajoutes} ajouté${resume.ajoutes > 1 ? 's' : ''}`);
  if (resume.modifies) bouts.push(`${resume.modifies} modifié${resume.modifies > 1 ? 's' : ''}`);
  if (resume.supprimes) bouts.push(`${resume.supprimes} supprimé${resume.supprimes > 1 ? 's' : ''}`);
  if (!bouts.length) return 'aucun fichier touché';
  return bouts.join(' · ');
}

/* ------------------------------------------------------------------ */
/* Le déroulé du déploiement                                            */
/* ------------------------------------------------------------------ */

/** Chaque étape d'une publication, dite en français. */
export const LIBELLE_ETAPE_DEPLOIEMENT: Record<DeployStepKey, string> = {
  merge: 'Fusion de la branche',
  commit: 'Enregistrement',
  push: 'Envoi sur GitHub',
  verify: 'Contrôles',
  build: 'Construction',
  publish: 'Mise en ligne',
  restart: 'Redémarrage',
};

export function libelleEtapeDeploiement(cle: DeployStepKey): string {
  return LIBELLE_ETAPE_DEPLOIEMENT[cle] ?? cle;
}

/** L'étape de publication d'où part le déroulé, dite en français. */
export function libelleCibleDeploiement(cible?: 'dev' | 'production'): string {
  return cible === 'production' ? 'Mise en production' : 'Déploiement';
}

/**
 * LES DÉPLOIEMENTS QUI EMPORTENT CETTE CARTE, du plus récent au plus ancien.
 *
 * Une publication ne concerne une carte que si elle la NOMME (`cardIds`) : le
 * lot de « À déployer » est choisi carte par carte, et l'onglet d'une carte ne
 * doit jamais montrer le déploiement d'une autre. Le plafond évite qu'une carte
 * reprise dix fois déroule dix publications identiques.
 */
export const DEPLOIEMENTS_MONTRES_MAX = 3;

export function deploiementsDeLaCarte(runs: DeployRun[], cardId: string): DeployRun[] {
  return (runs ?? [])
    .filter((run) => (run.cardIds ?? []).includes(cardId))
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
    .slice(0, DEPLOIEMENTS_MONTRES_MAX);
}

/**
 * Une étape « à faire » d'une publication ARRÊTÉE ne s'affiche pas : elle
 * n'aura jamais lieu, et une liste de sept lignes grises ferait croire à un
 * travail en attente. Sur une publication qui TOURNE, elle reste : c'est la
 * suite annoncée.
 */
export function etapesAMontrer(run: DeployRun): DeployRun['steps'] {
  const etapes = run.steps ?? [];
  if (run.state === 'running') return etapes;
  return etapes.filter((etape) => etape.state !== 'todo');
}

/* ------------------------------------------------------------------ */
/* L'état de la branche                                                 */
/* ------------------------------------------------------------------ */

export type EtatDeBranche = 'inconnue' | 'ouverte' | 'fusionnee';

export interface ResumeDeBranche {
  etat: EtatDeBranche;
  phrase: string;
}

/**
 * Où en est la branche de la carte : encore ouverte, ou déjà rejointe par la
 * principale. On ne DEVINE jamais : sans relevé, l'état est « inconnue » et le
 * dit, plutôt que d'annoncer une fusion qu'on n'a pas vue.
 */
export function resumeDeBranche(suivi: {
  branch?: string;
  fusionnee?: boolean;
  branchePrincipale?: string;
  fetchedAt?: number;
}): ResumeDeBranche {
  if (!suivi.branch) return { etat: 'inconnue', phrase: "Cette carte n'a pas encore de branche." };
  if (!suivi.fetchedAt) return { etat: 'inconnue', phrase: 'Branche pas encore relevée.' };
  const principale = suivi.branchePrincipale || 'la branche principale';
  return suivi.fusionnee
    ? { etat: 'fusionnee', phrase: `Fusionnée dans « ${principale} »` }
    : { etat: 'ouverte', phrase: `Pas encore fusionnée dans « ${principale} »` };
}
