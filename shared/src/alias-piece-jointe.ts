/**
 * L'IDENTIFIANT COURT ET PERMANENT D'UNE PIÈCE JOINTE.
 *
 * Une image déposée reçoit déjà un identifiant unique (un UUID). Mais cet
 * identifiant fait trente-six caractères : écrit dans le prompt, en tête du
 * chemin du fichier, il noie le texte et l'agent n'arrive plus à relier le tag
 * « [fichier: image.png] » de la phrase au fichier posé sur le disque.
 *
 * Chaque pièce jointe porte donc, EN PLUS de son UUID, un ALIAS COURT : les
 * quatre premiers signes de cet UUID. Il est calculé UNE FOIS, au dépôt, puis
 * ENREGISTRÉ avec la pièce jointe — il ne se recalcule jamais, donc il ne
 * change ni d'une session à l'autre, ni quand d'autres images arrivent.
 *
 * Quatre signes, c'est court, et deux UUID peuvent commencer pareil : l'alias
 * s'ALLONGE d'un signe à la fois tant qu'un autre le porte déjà, exactement
 * comme les empreintes courtes de git. L'unicité est vérifiée sur TOUT le
 * dépôt, pas seulement sur le projet : c'est aussi le nom du fichier sur le
 * disque, et deux projets partagent le même dossier.
 */

/** La longueur de départ d'un alias. */
export const LONGUEUR_ALIAS = 4;

/** Les signes retenus d'un identifiant : les tirets d'un UUID ne comptent pas. */
function signes(id: string): string {
  return id.replace(/-/g, '');
}

/**
 * L'alias d'une pièce jointe qui arrive. `dejaPris` est l'ensemble des alias
 * DÉJÀ attribués : le nouvel alias s'allonge tant qu'il en heurte un.
 */
export function aliasDePieceJointe(id: string, dejaPris: Iterable<string> = []): string {
  const pris = new Set(dejaPris);
  const base = signes(id);
  if (!base) return id;
  for (let n = LONGUEUR_ALIAS; n <= base.length; n += 1) {
    const candidat = base.slice(0, n);
    if (!pris.has(candidat)) return candidat;
  }
  // Deux identifiants entiers identiques : impossible avec des UUID, mais on
  // ne rend jamais un alias déjà pris en silence.
  return base;
}

/** Ce qui identifie une pièce jointe pour tout ce qui suit. */
export interface PieceJointeIdentifiee {
  id: string;
  name: string;
  alias?: string;
}

/**
 * L'alias d'une pièce jointe DÉJÀ enregistrée. Les pièces déposées avant cette
 * mécanique n'en ont pas : leur identifiant entier fait alors office d'alias,
 * puisque c'est lui qui nomme leur fichier sur le disque.
 */
export function aliasDe(piece: PieceJointeIdentifiee): string {
  return piece.alias ?? piece.id;
}

/**
 * Le nom du fichier sur le disque. Il commence par l'alias : le chemin écrit
 * dans le prompt reste donc lisible, et l'agent y retrouve du premier coup
 * l'identifiant cité dans la phrase.
 */
export function nomSurDisque(piece: PieceJointeIdentifiee): string {
  return `${aliasDe(piece)}-${piece.name}`;
}

/**
 * LE TAG DÉSIGNE SA PIÈCE PAR SON ALIAS, PAS PAR SON NOM.
 *
 * Un navigateur nomme presque toute image collée « image.png » : deux
 * captures collées d'affilée — envoyées ensemble, ou l'une reprise d'une autre
 * conversation par le dédoublonnage — portaient deux tags
 * « [fichier: image.png] » identiques, et la recherche PAR NOM rendait la
 * première pour les deux : même pastille « #247c » à l'écran, même fichier
 * annoncé à l'agent. Le renommage « image (2).png » au dépôt ne couvrait ni
 * les envois simultanés ni une pièce déjà connue du projet.
 *
 * Le composeur écrit donc la DÉSIGNATION de la pièce : « image.png #f0da ».
 * L'alias est unique sur tout le dépôt : le tag ne peut plus viser une autre
 * pièce. Un tag d'avant (« [fichier: image.png] », messages anciens, texte
 * tapé à la main) se résout encore par son nom.
 */
export function designationDePiece(piece: PieceJointeIdentifiee): string {
  return piece.alias ? `${piece.name} #${piece.alias}` : piece.name;
}

/** L'alias qu'un contenu de tag porte en queue (« image.png #f0da » → « f0da »). */
const ALIAS_EN_QUEUE = /\s#([0-9a-z]{4,})$/i;

export function aliasDuTag(contenu: string): string | null {
  return ALIAS_EN_QUEUE.exec(contenu)?.[1] ?? null;
}

/** Ce tag (son contenu, espaces ordinaires) désigne-t-il cette pièce ? */
export function tagDesignePiece(contenu: string, piece: PieceJointeIdentifiee): boolean {
  if (contenu === designationDePiece(piece)) return true;
  // Un tag d'avant ne porte que le nom.
  return contenu === piece.name;
}

/**
 * La pièce que vise un tag : par son alias d'abord, par son nom ensuite (tag
 * d'avant). Le nom seul reste ambigu entre homonymes — c'est le cas que la
 * désignation fait disparaître.
 */
export function pieceDuTag<T extends PieceJointeIdentifiee>(contenu: string, jointes: readonly T[]): T | undefined {
  const alias = aliasDuTag(contenu);
  if (alias) {
    const parAlias = jointes.find((piece) => piece.alias === alias && tagDesignePiece(contenu, piece));
    if (parAlias) return parAlias;
  }
  return jointes.find((piece) => piece.name === contenu);
}

/**
 * LE TAG DU TEXTE PORTE L'ALIAS QUAND IL PART AU MOTEUR.
 *
 * Un tag d'avant (« [fichier: image.png] ») part en « [fichier: image.png
 * #1a0c] », et la liste des pièces jointes reprend le même « 1a0c ». Un tag
 * qui porte déjà sa désignation part tel quel, sans alias doublé. Le message
 * ENREGISTRÉ, lui, ne bouge pas.
 */
export function tagsAvecAlias(
  texte: string,
  jointes: readonly PieceJointeIdentifiee[],
  tags: readonly { nom: string; debut: number; fin: number }[],
): string {
  let suite = texte;
  // De la fin vers le début : les positions des tags restent valables.
  for (let i = tags.length - 1; i >= 0; i -= 1) {
    const tag = tags[i]!;
    const piece = pieceDuTag(tag.nom, jointes);
    if (!piece) continue;
    suite = `${suite.slice(0, tag.debut)}[fichier: ${piece.name} #${aliasDe(piece)}]${suite.slice(tag.fin)}`;
  }
  return suite;
}

/**
 * L'ÉTIQUETTE QU'UN TAG MONTRE À L'ÉCRAN : l'identifiant court, pas le nom.
 *
 * Le plan d'un agent cite « #4193 », la barre d'écriture montrait
 * « IMG_8170.jpeg » : rien ne reliait les deux. Seul l'AFFICHAGE prend
 * l'alias. Une pièce ancienne, déposée avant les alias, garde son nom : jamais
 * un UUID de trente-six signes.
 */
export function etiquetteDuTag(nom: string, jointes: readonly PieceJointeIdentifiee[]): string {
  const piece = pieceDuTag(nom, jointes);
  return piece?.alias ? `#${piece.alias}` : nom;
}

/**
 * LE SEUL NOM QU'UNE PIÈCE JOINTE MONTRE À L'ÉCRAN.
 *
 * Le nom d'origine vivait encore partout — la barre au-dessus du champ, les
 * infobulles, le texte de remplacement des vignettes, le titre de l'aperçu —
 * pendant que le tag du prompt, lui, citait « #1a0c ». Rien ne reliait la
 * vignette à son tag. Tout ce qui S'AFFICHE passe donc par ici ; le fichier,
 * lui, ne bouge pas : il reste stocké et se télécharge sous son nom d'origine.
 *
 * Une pièce déposée AVANT les identifiants courts n'en a pas : elle garde son
 * nom, jamais un identifiant de trente-six signes.
 */
export function etiquetteDePiece(piece: PieceJointeIdentifiee): string {
  return piece.alias ? `#${piece.alias}` : piece.name;
}

/**
 * LE TEXTE D'UNE DEMANDE ENVOYÉE, TEL QU'IL SE LIT DANS LE FIL : chaque tag
 * montre la même étiquette que dans la barre d'écriture
 * (« [fichier: #1a0c] »). Le texte enregistré ne change pas ; une pièce sans
 * alias garde son nom.
 */
export function texteAvecEtiquettes(
  texte: string,
  jointes: readonly PieceJointeIdentifiee[],
  tags: readonly { nom: string; debut: number; fin: number }[],
): string {
  let suite = texte;
  // De la fin vers le début : les positions des tags restent valables.
  for (let i = tags.length - 1; i >= 0; i -= 1) {
    const tag = tags[i]!;
    const etiquette = etiquetteDuTag(tag.nom, jointes);
    if (etiquette === tag.nom) continue;
    suite = `${suite.slice(0, tag.debut)}[fichier: ${etiquette}]${suite.slice(tag.fin)}`;
  }
  return suite;
}

/**
 * LE BLOC « PIÈCES JOINTES » DU PROMPT. Une ligne par fichier : son alias, son
 * nom, son chemin entier. L'alias est annoncé comme PERMANENT, pour que l'agent
 * s'y réfère au lieu de recopier un chemin de quatre-vingts signes.
 */
export function blocPiecesJointes(
  fichiers: readonly { alias: string; nom: string; chemin: string }[],
): string {
  const lignes = fichiers.map((f) => `- #${f.alias} — ${f.nom} → ${f.chemin}`);
  return [
    "PIÈCES JOINTES fournies par l'utilisateur (lis-les) :",
    ...lignes,
    '',
    "Le « #… » est l'identifiant PERMANENT de chaque fichier : il ne changera plus,",
    "d'un message à l'autre comme d'une session à l'autre. Cite-le pour désigner une",
    'image, au lieu de recopier son chemin entier.',
  ].join('\n');
}
