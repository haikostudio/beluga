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
 * CE QUI PART AU MOTEUR N'EST PAS TRANSFORMÉ : une commande du moteur s'écrit
 * « /nom » en toutes lettres, en TÊTE du message — c'est la seule forme que les
 * moteurs reconnaissent —, et SEULE (`refusDeCommande`). Les commandes DE
 * BELUGA, elles, se cumulent n'importe où dans le texte, et le démon les
 * remplace toutes par leur consigne (`shared/src/commandes-de-beluga.ts`). Le
 * champ et la bulle les montrent en pastilles (`commandesReconnues`).
 */

import type { EngineId } from './models.js';
import { COMMANDES_DE_BELUGA } from './commandes-de-beluga.js';

/** D'où vient une commande : du moteur, du compte, ou du projet. */
export type OrigineCommande = 'moteur' | 'compte' | 'projet' | 'beluga';

export interface CommandeSlash {
  /** Le nom SANS la barre oblique : « compact », « code-review »… */
  nom: string;
  /** Une ligne d'explication, quand la source en donne une. */
  description?: string;
  origine: OrigineCommande;
  /**
   * La commande prend un ARGUMENT collé par deux-points (« /ordinateur:mac-mini ») : le menu ouvre un second niveau
   * pour le choisir, et « /nom:argument » se lit comme UNE pastille, effacée d'un bloc.
   */
  argument?: boolean;
}

/** Le nom de base d'une commande à argument (« ordinateur » pour « ordinateur:mac-mini »), et son argument. */
export function nomEtArgument(nom: string): { base: string; argument: string | null } {
  const i = nom.indexOf(':');
  return i > 0 ? { base: nom.slice(0, i), argument: nom.slice(i + 1) || null } : { base: nom, argument: null };
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
 * Les explications sont RÉÉCRITES EN FRANÇAIS par nous (le sens de celle du
 * programme, en mots courants) : ce sont donc des textes d'écran, passés à
 * `t()` par le menu et traduits dans les cinq langues — contrairement à celles
 * relevées sur le disque, données venues du dehors, affichées telles quelles.
 * Un nom sans explication est un nom dont le programme n'en donne aucune à cet
 * endroit : on préfère le silence à une phrase inventée.
 *
 * Ce qui est écrit sur le disque l'emporte toujours sur cette liste
 * (`commandesDuMoteur`) : une commande du projet ou du compte est plus vraie
 * qu'une copie.
 */
export const COMMANDES_INTEGREES: Readonly<Record<EngineId, readonly CommandeSlash[]>> = {
  claude: [
    { nom: 'add-dir', description: 'Ajouter un dossier de travail', origine: 'moteur' },
    { nom: 'bug', description: 'Signaler un défaut ou partager la conversation', origine: 'moteur' },
    { nom: 'clear', description: 'Repartir sur une session au contexte vide', origine: 'moteur' },
    { nom: 'compact', description: 'Libérer du contexte en résumant la conversation', origine: 'moteur' },
    { nom: 'config', description: 'Ouvrir les réglages du moteur', origine: 'moteur' },
    { nom: 'context', description: 'Voir l’occupation du contexte', origine: 'moteur' },
    { nom: 'export', description: 'Exporter la conversation', origine: 'moteur' },
    { nom: 'feedback', description: 'Envoyer un avis à Anthropic', origine: 'moteur' },
    { nom: 'help', description: 'L’aide du moteur et ses commandes', origine: 'moteur' },
    { nom: 'hooks', description: 'Voir les crochets du moteur', origine: 'moteur' },
    { nom: 'mcp', description: 'Gérer les serveurs d’outils', origine: 'moteur' },
    { nom: 'memory', description: 'Modifier les instructions et la mémoire du moteur', origine: 'moteur' },
    { nom: 'model', description: 'Choisir le modèle', origine: 'moteur' },
    { nom: 'plan', description: 'Passer en mode plan du moteur', origine: 'moteur' },
    { nom: 'resume', description: 'Reprendre une conversation précédente', origine: 'moteur' },
    {
      nom: 'security-review',
      description: 'Relecture de sécurité des changements de la branche',
      origine: 'moteur',
    },
    { nom: 'skills', description: 'Lister les compétences du moteur', origine: 'moteur' },
    { nom: 'status', description: 'État du moteur : version, modèle, compte', origine: 'moteur' },
  ],
  codex: [
    { nom: 'clear', origine: 'moteur' },
    { nom: 'compact', origine: 'moteur' },
    { nom: 'diff', origine: 'moteur' },
    { nom: 'experimental', origine: 'moteur' },
    { nom: 'feedback', origine: 'moteur' },
    { nom: 'goal', origine: 'moteur' },
    { nom: 'hooks', origine: 'moteur' },
    { nom: 'init', description: 'Créer le fichier d’instructions du moteur', origine: 'moteur' },
    { nom: 'mcp', origine: 'moteur' },
    { nom: 'memory', origine: 'moteur' },
    { nom: 'model', description: 'Choisir le modèle et l’effort de réflexion', origine: 'moteur' },
    { nom: 'new', origine: 'moteur' },
    { nom: 'permissions', description: 'Choisir ce que le moteur a le droit de faire', origine: 'moteur' },
    { nom: 'plan', origine: 'moteur' },
    { nom: 'quit', origine: 'moteur' },
    { nom: 'resume', origine: 'moteur' },
    { nom: 'review', description: 'Relire les changements et trouver les défauts', origine: 'moteur' },
    { nom: 'skills', origine: 'moteur' },
    { nom: 'status', description: 'Voir la configuration de la session', origine: 'moteur' },
    { nom: 'usage', origine: 'moteur' },
  ],
  cursor: [],
  get mimo() {
    // MiMo tourne dans l'outil de Claude : ses commandes sont les siennes.
    return COMMANDES_INTEGREES.claude;
  },
};

/* LES COMMANDES DE BELUGA BUILD, communes à tous les moteurs, et leurs consignes : `shared/src/commandes-de-beluga.ts`. */

/** Un nom de commande valable : lettres, chiffres, tirets, deux-points. */
const NOM_VALABLE = /^[a-zA-Z0-9][a-zA-Z0-9:_-]*$/;

export function nomDeCommandeValable(nom: string): boolean {
  return NOM_VALABLE.test(nom);
}

/**
 * La liste complète pour un moteur : ce qui est écrit en dur, puis ce que le
 * démon a relevé. Un même nom ne paraît qu'UNE fois — la version relevée sur le
 * disque l'emporte, c'est elle qui est vraie aujourd'hui ; une commande de
 * Beluga l'emporte sur une commande intégrée au moteur. Le classement met la
 * SECTION Beluga en tête, puis celle du moteur : le projet (c'est là qu'on écrit
 * ses propres commandes), le compte, le moteur ; l'alphabet départage.
 */
export function commandesDuMoteur(
  moteur: EngineId | undefined,
  relevees: readonly CommandeSlash[] | undefined,
): CommandeSlash[] {
  const parNom = new Map<string, CommandeSlash>();
  // Beluga passe DEVANT ce que le moteur porte en dur (« /plan »), DERRIÈRE ce qui est écrit sur le disque.
  for (const commande of moteur ? COMMANDES_INTEGREES[moteur] ?? [] : []) parNom.set(commande.nom, commande);
  for (const commande of COMMANDES_DE_BELUGA) parNom.set(commande.nom, commande);
  for (const commande of relevees ?? []) {
    if (!nomDeCommandeValable(commande.nom)) continue;
    parNom.set(commande.nom, commande);
  }
  const rang: Record<OrigineCommande, number> = { beluga: 0, projet: 1, compte: 2, moteur: 3 };
  return [...parNom.values()].sort(
    (a, b) => rang[a.origine] - rang[b.origine] || a.nom.localeCompare(b.nom),
  );
}

/** Les deux sections du menu, dans l'ordre affiché : Beluga, puis le moteur (projet, compte, moteur). */
export type SectionDuMenu = 'beluga' | 'moteur';

export function sectionDeLaCommande(commande: CommandeSlash): SectionDuMenu {
  return commande.origine === 'beluga' ? 'beluga' : 'moteur';
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
 * Il faut une barre oblique posée en DÉBUT DE MESSAGE, en début de ligne ou
 * APRÈS UN ESPACE (on ajoute une commande à un texte déjà écrit), le curseur
 * juste derrière le mot qu'elle ouvre, et aucun espace entre les deux. Une
 * adresse (« web/src »), une date (« 12/08 ») ou « et/ou » ne déclenchent donc
 * rien : la barre y est collée à une lettre ou un chiffre.
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
  // Rien, un espace ou une fin de ligne doit précéder la barre : sinon ce n'est
  // pas une commande mais un chemin, une date ou une fraction.
  if (debut > 0 && !/\s/.test(texte[debut - 1]!)) return null;
  const mot = texte.slice(i, curseur);
  if (mot && !nomDeCommandeValable(mot)) return null;
  return { debut, fin: curseur, mot };
}

/**
 * Les commandes qui répondent à ce qui est tapé. Celles qui COMMENCENT par le
 * mot passent devant celles qui le contiennent seulement : on cherche presque
 * toujours par le début — à l'intérieur de chaque section.
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
  // Les sections restent dans leur ordre (Beluga d'abord) : le tri est stable,
  // les débuts de mot restent devant DANS chaque section.
  const ordre: Record<SectionDuMenu, number> = { beluga: 0, moteur: 1 };
  return [...debuts, ...dedans].sort((a, b) => ordre[sectionDeLaCommande(a)] - ordre[sectionDeLaCommande(b)]);
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
 * LA COMMANDE QUE PORTE UN MESSAGE EN TÊTE, telle qu'elle partira au moteur : le
 * premier mot, s'il commence par une barre oblique. C'est la seule place où une
 * commande DU MOTEUR est comprise par lui.
 */
export function commandeDuMessage(texte: string): string | null {
  const trouve = /^\/([a-zA-Z0-9][a-zA-Z0-9:_-]*)(?=\s|$)/.exec(texte);
  return trouve ? trouve[1]! : null;
}

/** Un « /nom » écrit dans un texte, et sa place (la barre comprise). */
export interface CommandeDuTexte {
  nom: string;
  debut: number;
  fin: number;
}

/**
 * TOUS LES « /nom » D'UN TEXTE, dans l'ordre : une barre précédée d'un début de
 * texte ou d'un espace (saut de ligne et espace insécable compris), un nom
 * valable, puis un espace ou la fin. « web/src », « 12/08 » ou « /12/08 » n'en
 * sont pas. Les noms ne sont PAS vérifiés ici : `commandesReconnues` le fait.
 */
export function commandesDuTexte(texte: string): CommandeDuTexte[] {
  const trouvees: CommandeDuTexte[] = [];
  const motif = /(?<=^|\s)\/([a-zA-Z0-9][a-zA-Z0-9:_-]*)(?=\s|$)/g;
  for (const m of texte.matchAll(motif)) {
    trouvees.push({ nom: m[1]!, debut: m.index!, fin: m.index! + m[0].length });
  }
  return trouvees;
}

/** Une commande du texte que la liste du moteur connaît, avec son origine. */
export interface CommandeReconnue extends CommandeDuTexte {
  origine: OrigineCommande;
}

/**
 * LES COMMANDES QUI SERONT VRAIMENT COMPRISES — celles que le champ montre en
 * pastilles et que la bulle envoyée habille de même. Une commande de BELUGA
 * l'est n'importe où (le démon les change toutes en consigne) ; une commande du
 * MOTEUR (intégrée, projet, compte) seulement en TÊTE du message, la seule place
 * que le moteur lit.
 */
export function commandesReconnues(texte: string, commandes: readonly CommandeSlash[]): CommandeReconnue[] {
  const parNom = new Map(commandes.map((c) => [c.nom, c] as const));
  const reconnues: CommandeReconnue[] = [];
  for (const trouvee of commandesDuTexte(texte)) {
    /* « /ordinateur:mac-mini » : une commande à argument, reconnue par son nom de base. */
    const { base, argument } = nomEtArgument(trouvee.nom);
    const commande = parNom.get(trouvee.nom) ?? (argument && parNom.get(base)?.argument ? parNom.get(base) : undefined);
    if (!commande) continue;
    if (commande.origine !== 'beluga' && trouvee.debut !== 0) continue;
    reconnues.push({ ...trouvee, origine: commande.origine });
  }
  return reconnues;
}

/** Pourquoi une commande choisie au menu ne peut pas s'écrire dans ce message. */
export type RefusDeCommande = 'moteur-seule' | 'moteur-deja-la';

/**
 * UNE COMMANDE DU MOTEUR PART SEULE (décision de l'utilisateur, carte « Commandes
 * « / » en pastilles ») : une par message, en tête, sans commande de Beluga à
 * côté — le moteur ne lit que le premier mot, et une consigne de Beluga
 * recouvrirait tout le message. Les commandes de Beluga, elles, se cumulent.
 *
 * `zone` est le « /mot » en train d'être tapé : il sera remplacé, il ne compte
 * donc pas parmi les commandes déjà là. Rend `null` quand le choix est permis.
 */
export function refusDeCommande(
  texte: string,
  zone: SlashEnCours | null,
  choisie: CommandeSlash,
  commandes: readonly CommandeSlash[],
): RefusDeCommande | null {
  const deja = commandesReconnues(texte, commandes).filter(
    (c) => !zone || c.fin <= zone.debut || c.debut >= zone.fin,
  );
  if (choisie.origine !== 'beluga') return deja.length ? 'moteur-seule' : null;
  return deja.some((c) => c.origine !== 'beluga') ? 'moteur-deja-la' : null;
}

/**
 * Une commande du moteur choisie au milieu d'un texte se pose EN TÊTE : le
 * « /mot » tapé est retiré de sa place, « /nom » ouvre le message, et le curseur
 * revient là où il était.
 */
export function insereCommandeEnTete(
  texte: string,
  zone: SlashEnCours,
  nom: string,
): { texte: string; curseur: number } {
  if (zone.debut === 0) return insereCommande(texte, zone, nom);
  // Le « /mot » part avec l'espace qui le précédait.
  const avant = texte.slice(0, zone.debut).replace(/[ \t]$/, '');
  const reste = `${avant}${texte.slice(zone.fin)}`;
  const tete = `/${nom}${reste.startsWith(' ') || reste.startsWith('\n') || !reste ? '' : ' '}`;
  return { texte: `${tete}${reste}`, curseur: tete.length + avant.length };
}

/**
 * UNE PASTILLE DE COMMANDE S'EFFACE D'UN BLOC, comme un tag « [fichier: …] » : le retour arrière posé juste derrière
 * (ou dedans), ou la touche Suppr posée juste devant, retire « /nom » entier et l'espace qui le suivait. Rend `null`
 * quand aucune commande n'est touchée ou qu'une sélection est en cours : la touche suit alors son chemin normal.
 */
export function effacementDeCommande(
  texte: string,
  debut: number,
  fin: number,
  sens: 'arriere' | 'avant',
  reconnues: readonly CommandeDuTexte[],
): { texte: string; curseur: number } | null {
  if (debut !== fin) return null;
  const touchee = reconnues.find((c) =>
    sens === 'arriere' ? debut > c.debut && debut <= c.fin : debut >= c.debut && debut < c.fin,
  );
  if (!touchee) return null;
  const finCoupe = texte[touchee.fin] === ' ' ? touchee.fin + 1 : touchee.fin;
  return { texte: texte.slice(0, touchee.debut) + texte.slice(finCoupe), curseur: touchee.debut };
}

/**
 * Le déplacement dans la liste au clavier : la flèche du bas descend, celle du
 * haut monte, et les deux bouts se rejoignent. Une liste vide reste à zéro.
 */
export function deplacerDansLaListe(index: number, total: number, pas: 1 | -1): number {
  if (total <= 0) return 0;
  return (index + pas + total) % total;
}
