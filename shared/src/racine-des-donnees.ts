/**
 * OÙ VIT LE DOSSIER DE DONNÉES QUAND LE CODE TOURNE DANS UNE COPIE DE CARTE.
 *
 * Les données réelles du produit — la base, les pièces jointes, les journaux —
 * vivent dans `<dépôt>/data`, et ce dépôt est le PRINCIPAL : `/root/beluga`.
 * Mais chaque carte lancée travaille dans sa propre copie du dépôt (un
 * « worktree » de git), et le dossier de données y est déduit de l'endroit d'où
 * le code a été chargé. Un script du projet, un test ou un outil lancé depuis
 * cette copie visait donc `<copie>/data/attachments` : un dossier VIDE, créé au
 * passage, où aucune image n'a jamais été écrite. C'est ce que voyait l'agent
 * quand une pièce jointe restait « introuvable » depuis une carte, alors que le
 * fichier était bien posé sur le serveur.
 *
 * Une copie de travail se reconnaît sans lancer git : son `.git` n'est pas un
 * dossier mais un FICHIER d'une seule ligne, `gitdir: <principal>/.git/worktrees/<nom>`.
 * Le dépôt principal se lit directement dedans — trois dossiers au-dessus du
 * chemin annoncé.
 *
 * La règle est PURE : elle prend le TEXTE du marqueur, elle ne touche pas au
 * disque. Le choix d'ouvrir ce fichier, lui, revient à l'appelant
 * (`server/src/config.ts`).
 */

/** Le début de la seule ligne utile d'un marqueur de copie de travail. */
const PREFIXE = 'gitdir:';

/**
 * Le dépôt PRINCIPAL décrit par le contenu d'un fichier `.git` de copie de
 * travail, ou `null` si ce texte n'est pas un marqueur de copie exploitable.
 *
 * `contenu` est le texte brut du fichier ; le résultat est un chemin absolu,
 * toujours écrit avec des barres obliques simples.
 */
export function depotPrincipalDepuisMarqueur(contenu: string): string | null {
  const ligne = contenu
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.startsWith(PREFIXE));
  if (!ligne) return null;

  const gitdir = ligne.slice(PREFIXE.length).trim().replace(/\\/g, '/').replace(/\/+$/, '');
  // Attendu : <principal>/.git/worktrees/<nom> — rien d'autre ne se traduit.
  const morceaux = gitdir.split('/');
  if (morceaux.length < 4) return null;
  const [nom, worktrees, dotgit] = [
    morceaux[morceaux.length - 1],
    morceaux[morceaux.length - 2],
    morceaux[morceaux.length - 3],
  ];
  if (!nom || worktrees !== 'worktrees' || dotgit !== '.git') return null;

  const principal = morceaux.slice(0, morceaux.length - 3).join('/');
  if (!principal.startsWith('/')) return null;
  return principal;
}
