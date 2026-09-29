import { MOTEURS } from './registre-moteurs.js';
/**
 * REPRENDRE LE FIL D'UN MOTEUR, SANS SE TROMPER DE MODÈLE NI DE COMPTE.
 *
 * Le démon retient l'identifiant de conversation d'un agent pour que le tour
 * suivant reprenne le fil au lieu de tout réexpliquer. Cet identifiant était
 * rangé par MOTEUR seulement — reprendre un fil Claude avec Codex n'aurait
 * aucun sens.
 *
 * Codex, lui, enregistre AUSSI le modèle qui a ouvert le fil, et refuse de le
 * reprendre avec un autre : « This session was recorded with model
 * `gpt-5.6-sol` but is resuming with `gpt-5.6-terra` ». Or le modèle change
 * légitimement d'un tour à l'autre — réglage modifié, autre compte, modèle
 * rendu par le catalogue. L'utilisateur voyait alors une erreur pour un
 * changement parfaitement normal.
 *
 * ET LE FIL APPARTIENT AU COMPTE QUI L'A OUVERT. Chaque compte a son COFFRE
 * (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, un dossier par compte) et c'est LÀ, et
 * nulle part ailleurs, que le moteur enregistre ses conversations. Reprendre
 * sur un autre compte un identifiant ouvert sur le premier, c'est demander au
 * moteur un fil que son coffre n'a jamais vu : il refuse aussitôt, et le tour
 * tombe. C'est exactement ce qui arrivait après une reprise pour cause de
 * limite atteinte — le geste censé sauver le travail le perdait.
 *
 * La règle : le fil retenu appartient au COUPLE moteur + compte, et sous Codex
 * au TRIPLET moteur + modèle + compte. Un compte différent ouvre simplement un
 * fil neuf, comme un nouveau départ — à charge pour l'appelant de lui remettre
 * un résumé de continuité, jamais de le laisser redécouvrir le travail.
 *
 * Règle pure : ni base, ni disque, ni réseau.
 */

/** Ce que la clé retient quand aucun modèle n'est imposé (le moteur prend le sien). */
export const MODELE_PAR_DEFAUT = 'defaut';

/** Ce que la clé retient quand le compte porteur n'est pas connu (fils d'avant). */
export const COMPTE_INCONNU = 'compte-inconnu';

/** Les moteurs dont le fil est lié au modèle qui l'a ouvert. */
const MOTEURS_LIES_AU_MODELE = new Set(MOTEURS.filter((m) => m.filLieAuModele).map((m) => m.id as string));

/**
 * La clé sous laquelle le fil d'un agent est rangé et relu.
 *
 * Elle DOIT être calculée au même endroit pour l'écriture et pour la lecture :
 * une clé qui diverge, et l'agent repart d'un fil vide à chaque tour.
 */
export function cleDeSession(
  engine: string | null | undefined,
  model?: string | null,
  compte?: string | null,
): string {
  const moteur = (engine ?? 'claude').trim() || 'claude';
  const base = MOTEURS_LIES_AU_MODELE.has(moteur)
    ? `${moteur}@${(model ?? '').trim() || MODELE_PAR_DEFAUT}`
    : moteur;
  return `${base}#${(compte ?? '').trim() || COMPTE_INCONNU}`;
}

/**
 * Cette clé désigne-t-elle le fil de ce moteur et de ce modèle, quel que soit
 * le compte ? Sert à retrouver le fil d'AVANT quand on change de compte : il
 * n'est pas reprenable, mais son existence dit qu'il y a un travail à résumer
 * plutôt qu'une conversation à ouvrir de zéro.
 */
export function memeFilAutreCompte(cle: string, moteurEtModele: string): boolean {
  return cle.startsWith(`${moteurEtModele}#`);
}

/** La part « moteur (+ modèle) » d'une clé, sans le compte. */
export function partMoteurDeLaCle(engine: string | null | undefined, model?: string | null): string {
  return cleDeSession(engine, model, COMPTE_INCONNU).slice(0, -(COMPTE_INCONNU.length + 1));
}
