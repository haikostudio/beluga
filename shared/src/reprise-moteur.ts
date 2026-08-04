/**
 * REPRENDRE LE FIL D'UN MOTEUR, SANS SE TROMPER DE MODÈLE.
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
 * La règle : sous Codex, le fil retenu appartient au COUPLE moteur + modèle.
 * Un modèle différent ouvre simplement un fil neuf, comme un nouveau départ.
 * Claude reprend par `--resume` sans jamais protester : sa clé ne bouge pas,
 * et les fils déjà retenus restent retrouvables.
 *
 * Règle pure : ni base, ni disque, ni réseau.
 */

/** Ce que la clé retient quand aucun modèle n'est imposé (le moteur prend le sien). */
export const MODELE_PAR_DEFAUT = 'defaut';

/** Les moteurs dont le fil est lié au modèle qui l'a ouvert. */
const MOTEURS_LIES_AU_MODELE = new Set(['codex']);

/**
 * La clé sous laquelle le fil d'un agent est rangé et relu.
 *
 * Elle DOIT être calculée au même endroit pour l'écriture et pour la lecture :
 * une clé qui diverge, et l'agent repart d'un fil vide à chaque tour.
 */
export function cleDeSession(engine: string | null | undefined, model?: string | null): string {
  const moteur = (engine ?? 'claude').trim() || 'claude';
  if (!MOTEURS_LIES_AU_MODELE.has(moteur)) return moteur;
  const modele = (model ?? '').trim() || MODELE_PAR_DEFAUT;
  return `${moteur}@${modele}`;
}

/**
 * Le fil retenu vaut-il encore pour ces réglages ? Sert à expliquer, dans les
 * traces, pourquoi un tour repart d'une conversation neuve.
 */
export function memeFil(
  ouvertAvec: { engine?: string | null; model?: string | null },
  maintenant: { engine?: string | null; model?: string | null },
): boolean {
  return (
    cleDeSession(ouvertAvec.engine, ouvertAvec.model) === cleDeSession(maintenant.engine, maintenant.model)
  );
}
