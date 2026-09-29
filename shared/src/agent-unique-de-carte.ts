import { MOTEURS } from './registre-moteurs.js';
/**
 * UN SEUL AGENT PAR CARTE, DU CADRAGE À LA LIVRAISON.
 *
 * Une carte naît avec son agent de cadrage : il discute le besoin avec
 * l'utilisateur, lit le projet, rend sa compréhension et son plan. Au
 * lancement, un SECOND agent était créé pour exécuter : il repartait d'un fil
 * vide, relisait tout le contexte et recevait la discussion recopiée en texte —
 * deux agents, deux lectures du projet, deux dépenses.
 *
 * Désormais l'agent de cadrage DEVIENT l'agent d'exécution : même identifiant,
 * même conversation côté moteur, qui reprend son propre fil au lancement. Un
 * nouvel agent ne prend le relais que dans les cas où ce fil ne peut pas être
 * repris tel quel :
 *
 *  - l'utilisateur a changé de MOTEUR ou de MODÈLE entre le cadrage et le
 *    lancement (c'est l'exception qu'il a lui-même posée) ;
 *  - le moteur ne sait pas reprendre un fil depuis un AUTRE dossier (Cursor
 *    range ses conversations par dossier de travail : le cadrage tourne dans
 *    son espace à part, l'exécution dans la copie de travail de la carte).
 *
 * Le changement de COMPTE n'en fait pas partie : le démon sait déjà rouvrir un
 * fil neuf sur un autre compte avec un résumé de continuité
 * (`server/src/runtime.ts`, `filSurUnAutreCompte`). Le réglage de réflexion
 * non plus : il se passe à chaque tour, sans toucher au fil.
 *
 * Règle pure : ni base, ni disque, ni réseau.
 */

/** Ce qui décide du fil : le moteur et le modèle. */
export interface ReglageDuFil {
  engine?: string | null;
  model?: string | null;
}

/**
 * Les moteurs dont le fil ne se reprend PAS depuis un autre dossier de travail.
 * Claude range ses fils par dossier, mais le démon recopie le fichier du fil
 * avant le tour (`dossierDesFilsClaude`) ; Codex les range par date, hors de tout
 * dossier. Cursor n'offre ni l'un ni l'autre : on garde le relais.
 */
const MOTEURS_SANS_REPRISE_HORS_DOSSIER = new Set(
  MOTEURS.filter((m) => !m.repriseHorsDossier).map((m) => m.id as string),
);

export type AgentDeLaCarteAuLancement =
  | { reprendre: true }
  | { reprendre: false; raison: 'moteur-change' | 'modele-change' | 'moteur-sans-reprise' };

const moteur = (valeur?: string | null) => (valeur ?? '').trim() || 'claude';
const modele = (valeur?: string | null) => (valeur ?? '').trim();

/**
 * L'agent de cadrage peut-il devenir l'agent d'exécution de sa carte ?
 *
 * `cadrage` est le réglage sur lequel sa conversation a tourné, `execution`
 * celui que la carte porte au clic (`card.run`, déjà complété par la suite du
 * cadrage). Un modèle absent d'un seul côté est un changement : on ne peut pas
 * prouver que c'est le même.
 */
export function agentDeLaCarteAuLancement(
  cadrage: ReglageDuFil,
  execution: ReglageDuFil,
): AgentDeLaCarteAuLancement {
  if (moteur(cadrage.engine) !== moteur(execution.engine)) return { reprendre: false, raison: 'moteur-change' };
  if (modele(cadrage.model) !== modele(execution.model)) return { reprendre: false, raison: 'modele-change' };
  if (MOTEURS_SANS_REPRISE_HORS_DOSSIER.has(moteur(execution.engine))) {
    return { reprendre: false, raison: 'moteur-sans-reprise' };
  }
  return { reprendre: true };
}

/** La phrase du journal du démon qui dit pourquoi un nouvel agent prend le relais. */
export function raisonDuRelais(raison: 'moteur-change' | 'modele-change' | 'moteur-sans-reprise'): string {
  switch (raison) {
    case 'moteur-change':
      return 'le moteur a changé depuis le cadrage';
    case 'modele-change':
      return 'le modèle a changé depuis le cadrage';
    case 'moteur-sans-reprise':
      return 'ce moteur ne reprend pas un fil depuis un autre dossier';
  }
}

/**
 * LE DOSSIER OÙ CLAUDE RANGE LES FILS D'UN DOSSIER DE TRAVAIL.
 *
 * Claude enregistre chaque conversation dans
 * `<coffre du compte>/projects/<dossier échappé>/<fil>.jsonl`, où le dossier
 * échappé est le chemin de travail dont tout signe hors lettres et chiffres
 * devient un tiret (`/root/beluga` → `-root-beluga`). Un `--resume` lancé depuis
 * un autre dossier ne trouve donc pas le fil : le démon le recopie d'abord sous
 * le nom du nouveau dossier.
 *
 * Au-delà de 200 signes, Claude raccourcit le nom à sa façon : on rend alors
 * `null`, et le filet du fil perdu (rappel de la conversation visible) prend le
 * relais.
 */
export function dossierDesFilsClaude(cwd: string): string | null {
  const echappe = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  return echappe.length > 200 ? null : echappe;
}
