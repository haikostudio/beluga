/**
 * LES COMMANDES « / » DU MOTEUR SÉLECTIONNÉ, DANS LA BARRE D'ÉCRITURE.
 *
 * Chaque moteur en ligne de commande a ses propres commandes « slash » :
 * celles qu'il porte lui-même, celles que le compte a posées dans son dossier
 * de configuration, celles que le projet a écrites dans le sien. Taper « / »
 * dans le champ de saisie ouvre la liste de CELLES DU MOTEUR CHOISI, au-dessus
 * du champ, exactement là où se pose le repère des tâches en cours.
 *
 * CE QUI EST ÉCRIT EN DUR ICI EST RÉDUIT AU MINIMUM, et pour la même raison que
 * pour le catalogue des modèles (`server/src/engines/catalog.ts`) : une liste
 * figée devient fausse à la première mise à jour du moteur. Les commandes
 * RÉELLES sont donc relevées sur le disque par le démon
 * (`server/src/commandes-slash.ts`) ; ne restent en dur que celles dont ce
 * dépôt se sert déjà lui-même, donc qu'on a vues fonctionner.
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
 * LES SEULES COMMANDES ÉCRITES EN DUR : celles que ce dépôt envoie DÉJÀ à un
 * moteur, sous forme de simple message (`server/src/engines/claude.ts`). On ne
 * devine donc rien — tout le reste est relevé sur le disque.
 */
export const COMMANDES_INTEGREES: Readonly<Record<EngineId, readonly CommandeSlash[]>> = {
  claude: [
    { nom: 'compact', description: 'Résume la conversation pour libérer du contexte', origine: 'moteur' },
    { nom: 'context', description: 'Détaille ce que le contexte contient aujourd\'hui', origine: 'moteur' },
  ],
  codex: [],
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
