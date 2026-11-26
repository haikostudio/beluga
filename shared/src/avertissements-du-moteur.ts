/**
 * LES AVERTISSEMENTS ANODINS DE LA LIGNE DE COMMANDE CLAUDE, ÉCARTÉS DE LA RAISON D'UN ÉCHEC (25/11/2026).
 *
 * La raison d'un tour tombé se lit dans les dernières lignes de la sortie d'erreur du moteur. Quand le dossier du
 * projet n'a jamais été « approuvé » dans une session interactive, la ligne de commande y écrit à CHAQUE lancement
 * « Ignoring N permissions.allow entry from .claude/settings.local.json: this workspace has not been trusted… » —
 * un simple avertissement, qui n'arrête rien. Il occupait pourtant seul la sortie d'erreur d'un tour coupé (iMiel,
 * mise en production du 29/09/2026), et l'écran l'affichait en rouge comme LA cause de l'échec.
 *
 * Seuls les avertissements CONNUS sont écartés, jamais une ligne inconnue : une vraie erreur reste toujours affichée.
 */
const AVERTISSEMENTS_ANODINS: RegExp[] = [
  /^Ignoring \d+ permissions\.\w+ entr(?:y|ies) from .*has not been trusted/i,
  /^.*this workspace has not been trusted\. Run Claude Code interactively/i,
];

/** Cette ligne de la sortie d'erreur est-elle un avertissement anodin connu ? */
export function estUnAvertissementAnodin(ligne: string): boolean {
  const texte = ligne.trim();
  return texte.length > 0 && AVERTISSEMENTS_ANODINS.some((motif) => motif.test(texte));
}

/** La sortie d'erreur du moteur, sans ses avertissements anodins ni ses lignes vides. */
export function sortieDErreurUtile(stderr: string): string {
  return stderr
    .split('\n')
    .filter((ligne) => ligne.trim() && !estUnAvertissementAnodin(ligne))
    .join('\n')
    .trim();
}
