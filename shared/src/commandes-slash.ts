/**
 * LES COMMANDES « / » DU MOTEUR SÉLECTIONNÉ, DANS LA BARRE D'ÉCRITURE.
 *
 * Chaque moteur en ligne de commande a ses propres commandes « slash » :
 * celles qu'il porte lui-même, celles que le compte a posées dans son dossier
 * de configuration, celles que le projet a écrites dans le sien. Taper « / »
 * dans le champ de saisie ouvre la liste de CELLES DU MOTEUR CHOISI, au-dessus
 * du champ, exactement là où se pose le repère des tâches en cours.
 *
 * DEUX SOURCES, ET UNE SEULE PRIORITÉ. Ce que le PROJET et le COMPTE ont écrit
 * sur le disque est relevé par le démon (`server/src/commandes-slash.ts`) : ces
 * commandes-là sont toujours vraies. Ce que le MOTEUR porte dans son propre
 * exécutable ne se relève pas au vol — un programme pèse trois cents
 * mégaoctets — et vit donc recopié ci-dessous, sous le contrôle de
 * `scripts/verif-commandes-slash.mjs`. En cas de même nom, le disque l'emporte.
 *
 * CE QUI PART AU MOTEUR N'EST PAS TRANSFORMÉ : la commande choisie s'écrit
 * « /nom » en toutes lettres, en TÊTE du message — c'est la seule forme que les
 * moteurs reconnaissent. L'interface n'ouvre que l'accès et l'insertion, elle ne
 * touche pas au fonctionnement des commandes elles-mêmes.
 */

import type { EngineId } from './models.js';

/** D'où vient une commande : du moteur, du compte, ou du projet. */
export type OrigineCommande = 'moteur' | 'compte' | 'projet';

export interface CommandeSlash {
  /** Le nom SANS la barre oblique : « compact », « code-review »… */
  nom: string;
  /** Une ligne d'explication, quand la source en donne une. */
  description?: string;
  origine: OrigineCommande;
}

/**
 * LES COMMANDES QUE LE MOTEUR PORTE LUI-MÊME.
 *
 * Elles ne sont écrites nulle part sur le disque : chaque programme les porte
 * dans son propre exécutable. On ne peut donc pas les relever au vol — un
 * programme pèse trois cents mégaoctets, et le menu doit s'ouvrir tout de
 * suite. Elles sont donc RECOPIÉES ICI, mais jamais devinées : chaque nom a été
 * LU dans le programme installé (Claude Code 2.1.233, codex-cli 0.146.0), et
 * `scripts/verif-commandes-slash.mjs` relit les programmes pour dire ceux qui
 * auraient disparu d'une mise à jour.
 *
 * Les explications sont celles du programme lui-même, dans sa langue : ce sont
 * des DONNÉES venues du dehors, pas des textes d'écran — elles ne passent donc
 * pas par le dictionnaire, comme celles relevées dans les fichiers de
 * compétences. Un nom sans explication est un nom dont le programme n'en donne
 * aucune à cet endroit : on préfère le silence à une phrase inventée.
 *
 * Ce qui est écrit sur le disque l'emporte toujours sur cette liste
 * (`commandesDuMoteur`) : une commande du projet ou du compte est plus vraie
 * qu'une copie.
 */
export const COMMANDES_INTEGREES: Readonly<Record<EngineId, readonly CommandeSlash[]>> = {
  claude: [
    { nom: 'add-dir', description: 'Add a new working directory', origine: 'moteur' },
    { nom: 'bug', description: 'Report a bug or share your conversation', origine: 'moteur' },
    { nom: 'clear', description: 'Start a new session with empty context', origine: 'moteur' },
    { nom: 'compact', description: 'Free up context by summarizing the conversation so far', origine: 'moteur' },
    { nom: 'config', description: 'Open settings', origine: 'moteur' },
    { nom: 'context', description: 'Visualize current context usage as a colored grid', origine: 'moteur' },
    { nom: 'export', description: 'Export the current conversation to a file or clipboard', origine: 'moteur' },
    { nom: 'feedback', description: 'Send feedback to Anthropic or report a bug', origine: 'moteur' },
    { nom: 'help', description: 'Show help and available commands', origine: 'moteur' },
    { nom: 'hooks', description: 'View hook configurations for tool events', origine: 'moteur' },
    { nom: 'mcp', description: 'Manage MCP servers', origine: 'moteur' },
    { nom: 'memory', description: 'Edit CLAUDE.md files and memory settings', origine: 'moteur' },
    { nom: 'model', description: 'Set the AI model for Claude Code', origine: 'moteur' },
    { nom: 'plan', description: 'Enable plan mode or view the current session plan', origine: 'moteur' },
    { nom: 'resume', description: 'Resume a previous conversation', origine: 'moteur' },
    {
      nom: 'security-review',
      description: 'Complete a security review of the pending changes on the current branch',
      origine: 'moteur',
    },
    { nom: 'skills', description: 'List available skills', origine: 'moteur' },
    { nom: 'status', description: 'Show Claude Code status: version, model, account, connectivity', origine: 'moteur' },
  ],
  codex: [
    { nom: 'clear', origine: 'moteur' },
    { nom: 'compact', origine: 'moteur' },
    { nom: 'diff', origine: 'moteur' },
    { nom: 'experimental', origine: 'moteur' },
    { nom: 'feedback', origine: 'moteur' },
    { nom: 'goal', origine: 'moteur' },
    { nom: 'hooks', origine: 'moteur' },
    { nom: 'init', description: 'create an AGENTS.md file with instructions for Codex', origine: 'moteur' },
    { nom: 'mcp', origine: 'moteur' },
    { nom: 'memory', origine: 'moteur' },
    { nom: 'model', description: 'choose what model and reasoning effort to use', origine: 'moteur' },
    { nom: 'new', origine: 'moteur' },
    { nom: 'permissions', description: 'choose what Codex is allowed to do', origine: 'moteur' },
    { nom: 'plan', origine: 'moteur' },
    { nom: 'quit', origine: 'moteur' },
    { nom: 'resume', origine: 'moteur' },
    { nom: 'review', description: 'review any changes and find issues', origine: 'moteur' },
    { nom: 'skills', origine: 'moteur' },
    { nom: 'status', description: 'show current session configuration', origine: 'moteur' },
    { nom: 'usage', origine: 'moteur' },
  ],
  cursor: [],
};

/** Un nom de commande valable : lettres, chiffres, tirets, deux-points. */
const NOM_VALABLE = /^[a-zA-Z0-9][a-zA-Z0-9:_-]*$/;

export function nomDeCommandeValable(nom: string): boolean {
  return NOM_VALABLE.test(nom);
}

/**
 * La liste complète pour un moteur : ce qui est écrit en dur, puis ce que le
 * démon a relevé. Un même nom ne paraît qu'UNE fois — la version relevée sur le
 * disque l'emporte, c'est elle qui est vraie aujourd'hui. Le classement met le
 * projet devant (c'est là qu'on écrit ses propres commandes), puis le compte,
 * puis le moteur, et l'alphabet départage.
 */
export function commandesDuMoteur(
  moteur: EngineId | undefined,
  relevees: readonly CommandeSlash[] | undefined,
): CommandeSlash[] {
  const parNom = new Map<string, CommandeSlash>();
  for (const commande of moteur ? COMMANDES_INTEGREES[moteur] ?? [] : []) parNom.set(commande.nom, commande);
  for (const commande of relevees ?? []) {
    if (!nomDeCommandeValable(commande.nom)) continue;
    parNom.set(commande.nom, commande);
  }
  const rang: Record<OrigineCommande, number> = { projet: 0, compte: 1, moteur: 2 };
  return [...parNom.values()].sort(
    (a, b) => rang[a.origine] - rang[b.origine] || a.nom.localeCompare(b.nom),
  );
}

/** Le « /mot » que la personne est en train de taper, et où il se trouve. */
export interface SlashEnCours {
  debut: number;
  fin: number;
  /** Ce qui suit la barre oblique, éventuellement vide juste après « / ». */
  mot: string;
}

/**
 * LE MENU NE S'OUVRE QUE SUR UNE COMMANDE EN TRAIN DE S'ÉCRIRE.
 *
 * Il faut une barre oblique posée en DÉBUT DE MESSAGE ou en début de ligne, le
 * curseur juste derrière le mot qu'elle ouvre, et aucun espace entre les deux.
 * Une adresse (« web/src »), une date (« 12/08 ») ou une fraction ne déclenchent
 * donc rien : la barre y est précédée d'autre chose qu'un début de ligne.
 *
 * Rendre `null` ferme le menu — c'est le seul signal, il n'y en a pas d'autre.
 */
export function slashEnCours(texte: string, curseur: number): SlashEnCours | null {
  if (curseur < 1 || curseur > texte.length) return null;
  // On remonte jusqu'à la barre oblique, sans traverser un espace ni une ligne.
  let i = curseur;
  while (i > 0) {
    const signe = texte[i - 1]!;
    if (signe === '/') break;
    if (/[\s]/.test(signe)) return null;
    i -= 1;
  }
  if (i === 0) return null;
  const debut = i - 1;
  // Rien, ou une fin de ligne, doit précéder la barre : sinon ce n'est pas une
  // commande mais un chemin, une date ou une fraction.
  if (debut > 0 && !/[\n]/.test(texte[debut - 1]!)) return null;
  const mot = texte.slice(i, curseur);
  if (mot && !nomDeCommandeValable(mot)) return null;
  return { debut, fin: curseur, mot };
}

/**
 * Les commandes qui répondent à ce qui est tapé. Celles qui COMMENCENT par le
 * mot passent devant celles qui le contiennent seulement : on cherche presque
 * toujours par le début.
 */
export function filtrerCommandes(
  commandes: readonly CommandeSlash[],
  mot: string,
): CommandeSlash[] {
  const cherche = mot.trim().toLowerCase();
  if (!cherche) return [...commandes];
  const debuts: CommandeSlash[] = [];
  const dedans: CommandeSlash[] = [];
  for (const commande of commandes) {
    const nom = commande.nom.toLowerCase();
    if (nom.startsWith(cherche)) debuts.push(commande);
    else if (nom.includes(cherche)) dedans.push(commande);
  }
  return [...debuts, ...dedans];
}

/**
 * CE QUE DEVIENT LE TEXTE UNE FOIS LA COMMANDE CHOISIE : le « /mot » à moitié
 * tapé est remplacé par la commande entière, suivie d'UN espace — le curseur se
 * pose derrière, prêt pour la suite du message. Un espace déjà présent n'est pas
 * doublé.
 */
export function insereCommande(
  texte: string,
  zone: SlashEnCours,
  nom: string,
): { texte: string; curseur: number } {
  const suite = texte.slice(zone.fin);
  const espace = suite.startsWith(' ') || suite.startsWith('\n') ? '' : ' ';
  const ecrit = `/${nom}${espace}`;
  return {
    texte: `${texte.slice(0, zone.debut)}${ecrit}${suite}`,
    curseur: zone.debut + ecrit.length,
  };
}

/**
 * LA COMMANDE QUE PORTE UN MESSAGE, telle qu'elle partira au moteur : le
 * premier mot, s'il commence par une barre oblique. Sert à la pastille posée
 * au-dessus du champ, qui montre ce qui est reconnu — et à rien d'autre : le
 * texte, lui, part inchangé.
 */
export function commandeDuMessage(texte: string): string | null {
  const trouve = /^\/([a-zA-Z0-9][a-zA-Z0-9:_-]*)(?=\s|$)/.exec(texte);
  return trouve ? trouve[1]! : null;
}

/**
 * Le déplacement dans la liste au clavier : la flèche du bas descend, celle du
 * haut monte, et les deux bouts se rejoignent. Une liste vide reste à zéro.
 */
export function deplacerDansLaListe(index: number, total: number, pas: 1 | -1): number {
  if (total <= 0) return 0;
  return (index + pas + total) % total;
}
