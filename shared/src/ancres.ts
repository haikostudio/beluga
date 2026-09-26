/**
 * Les ancres de fichiers dans le texte du composeur.
 *
 * Quand on joint un fichier alors que le curseur est posé quelque part dans
 * le texte, une ancre « [fichier: capture.png] » s'écrit À CET ENDROIT. Elle
 * part telle quelle dans le message : l'agent sait ainsi à quel paragraphe se
 * rapporte quel fichier.
 *
 * Le texte et la liste des pièces jointes ne doivent JAMAIS se contredire :
 * retirer un fichier retire son ancre, effacer une ancre retire le fichier.
 * Toutes ces décisions vivent ici, sans React ni réseau : elles se testent
 * seules.
 */

/**
 * UNE ANCRE NE SE COUPE JAMAIS EN FIN DE LIGNE : SES ESPACES SONT INSÉCABLES.
 *
 * Le champ de saisie est un vrai `textarea` : c'est LUI qui décide où le texte
 * revient à la ligne, et il coupait volontiers à l'espace de « [fichier: nom] ».
 * Le tag occupait alors deux morceaux de lignes, la pastille dessinée par-dessus
 * ne pouvait plus s'y poser, et l'étiquette retombait en texte brut — sans sa
 * croix, incohérente à côté de ses voisines restées en pastille.
 *
 * Un espace INSÉCABLE (U+00A0) se lit comme un espace, s'écrit comme un espace,
 * mais interdit la coupure : le tag reste d'un bloc. Les espaces du NOM du
 * fichier le deviennent aussi, sinon « ma photo.png » se couperait au milieu.
 * Rien d'autre ne bouge : un espace insécable a la largeur d'un espace, donc ni
 * la mise en page du champ ni la place du curseur ne changent.
 *
 * On ne dépend JAMAIS de cette forme pour RELIRE un tag : un brouillon écrit
 * avant cette règle, un texte collé depuis le fil ou tapé à la main portent des
 * espaces ordinaires et doivent se lire pareil. Tout passe donc par
 * `tagsDuTexte`, jamais par une recherche du texte exact de l'ancre.
 */
import {
  designationDePiece,
  etiquetteDuTag,
  tagDesignePiece,
  type PieceJointeIdentifiee,
} from './alias-piece-jointe.js';

export const ESPACE_INSECABLE = '\u00A0';

/** Le nom tel qu'il s'écrit DANS le tag : ses espaces ne coupent plus la ligne. */
function insecable(nom: string): string {
  return nom.replace(/[ \t]/g, ESPACE_INSECABLE);
}

/** Le nom d'un fichier lu dans un tag, rendu à sa forme ordinaire. */
export function nomDuTag(brut: string): string {
  return brut.replace(/\u00A0/g, ' ').trim();
}

/**
 * UN NOM QUI RE-COLLE DEUX IMAGES NE SE DISTINGUE PLUS DANS LE TAG.
 *
 * Un navigateur nomme presque toujours une image coll\u00E9e \u00AB image.png \u00BB, quel
 * que soit son contenu : coller deux captures d'\u00E9cran de suite pose donc deux
 * tags \u00AB [fichier: image.png] \u00BB identiques, et le texte ne peut plus dire
 * laquelle des deux il vise. Le nom garde son extension et gagne un num\u00E9ro \u2014
 * \u00AB image (2).png \u00BB \u2014 d\u00E8s qu'un homonyme est d\u00E9j\u00E0 pr\u00E9sent dans la m\u00EAme
 * conversation.
 */
export function nomSansCollision(nom: string, dejaUtilises: Iterable<string>): string {
  const pris = new Set(dejaUtilises);
  if (!pris.has(nom)) return nom;
  const point = nom.lastIndexOf('.');
  const base = point > 0 ? nom.slice(0, point) : nom;
  const extension = point > 0 ? nom.slice(point) : '';
  let n = 2;
  let candidat = `${base} (${n})${extension}`;
  while (pris.has(candidat)) {
    n += 1;
    candidat = `${base} (${n})${extension}`;
  }
  return candidat;
}

/** Le texte exact d'une ancre, telle qu'elle s'écrit dans le champ de saisie. */
export function ancre(nom: string): string {
  return `[fichier:${ESPACE_INSECABLE}${insecable(nom)}]`;
}

/**
 * CE QUI PART AU MOTEUR GARDE DES ESPACES ORDINAIRES. L'insécable est un
 * artifice d'AFFICHAGE : le message enregistré, relu et recopié ne doit pas
 * porter un caractère invisible que personne n'a tapé.
 */
export function tagsEnEspacesOrdinaires(texte: string): string {
  TAG_FICHIER.lastIndex = 0;
  return texte.replace(TAG_FICHIER, (brut) => brut.replace(/\u00A0/g, ' '));
}

/** Combien de fois cette ancre apparaît dans le texte. */
export function compteAncres(texte: string, nom: string): number {
  return tagsDuTexte(texte).filter((tag) => tag.nom === nom).length;
}

/**
 * Poser une ancre. Sans curseur connu (dépôt sur la zone, collage), elle
 * s'ajoute à la fin, comme avant. Avec un curseur, elle se glisse à sa place,
 * entourée des espaces qui manquent pour ne pas coller au mot d'à côté.
 */
export function insereAncre(
  texte: string,
  nom: string,
  curseur: number | null,
): { texte: string; curseur: number } {
  const marque = ancre(nom);

  if (curseur === null || curseur < 0 || curseur > texte.length) {
    const separateur = !texte ? '' : /\s$/.test(texte) ? '' : ' ';
    const suite = `${texte}${separateur}${marque}`;
    return { texte: suite, curseur: suite.length };
  }

  const avant = texte.slice(0, curseur);
  const apres = texte.slice(curseur);
  const espaceAvant = !avant || /\s$/.test(avant) ? '' : ' ';
  const espaceApres = !apres || /^\s/.test(apres) ? '' : ' ';
  const morceau = `${espaceAvant}${marque}${espaceApres}`;
  return { texte: `${avant}${morceau}${apres}`, curseur: curseur + morceau.length };
}

/**
 * La N-ième ancre de ce nom (0 = la première), avec ses bornes réelles dans le
 * texte. `null` si elle n'y est pas : on ne suppose jamais qu'elle est encore
 * là. La recherche se fait sur le MOTIF d'un tag, pas sur son texte exact —
 * l'ancre écrite aujourd'hui porte des espaces insécables, celle d'un vieux
 * brouillon des espaces ordinaires, et les deux désignent le même fichier.
 */
export function ancreDuTexte(texte: string, nom: string, occurrence: number): TagDuTexte | null {
  if (occurrence < 0) return null;
  return tagsDuTexte(texte).filter((tag) => tag.nom === nom)[occurrence] ?? null;
}

/**
 * Où commence la N-ième ancre de ce nom (0 = la première). -1 si elle
 * n'existe pas : on ne suppose jamais qu'elle est encore dans le texte.
 */
export function indexDeLAncre(texte: string, nom: string, occurrence: number): number {
  return ancreDuTexte(texte, nom, occurrence)?.debut ?? -1;
}

/**
 * Le contenu du tag qui désigne cette pièce dans le texte : sa désignation
 * (« image.png #f0da »), ou son seul nom pour un tag d'avant. Sans tag, la
 * désignation qu'il porterait.
 */
export function contenuDuTagDe(texte: string, piece: PieceJointeIdentifiee): string {
  return tagsDuTexte(texte).find((tag) => tagDesignePiece(tag.nom, piece))?.nom ?? designationDePiece(piece);
}

/** Retirer l'ancre à cet index, en ramassant l'espace devenu inutile. */
function retireAncreA(texte: string, debut: number, longueur: number): { texte: string; coupe: number } {
  const avant = texte.slice(0, debut);
  const apres = texte.slice(debut + longueur);
  if (/\s$/.test(avant) && /^[^\S\n]/.test(apres)) {
    const espaces = (apres.match(/^[^\S\n]+/) ?? [''])[0].length;
    return { texte: avant + apres.slice(espaces), coupe: longueur + espaces };
  }
  return { texte: avant + apres, coupe: longueur };
}

/**
 * Retirer UNE occurrence de l'ancre (la dernière), en ramassant l'espace
 * devenu inutile. Les autres ancres du même nom restent : un même fichier
 * peut être cité deux fois.
 */
export function retireAncre(texte: string, nom: string): string {
  const siennes = tagsDuTexte(texte).filter((tag) => tag.nom === nom);
  const dernier = siennes[siennes.length - 1];
  if (!dernier) return texte;
  return retireAncreA(texte, dernier.debut, dernier.fin - dernier.debut).texte;
}

/**
 * Retirer l'occurrence PRÉCISE d'une ancre (celle du drapeau cliqué), sans
 * toucher aux autres mots ni aux autres citations du même fichier.
 */
export function retireOccurrence(texte: string, nom: string, occurrence: number): string {
  const tag = ancreDuTexte(texte, nom, occurrence);
  if (!tag) return texte;
  return retireAncreA(texte, tag.debut, tag.fin - tag.debut).texte;
}

/**
 * Lâché sur un mot, le drapeau se colle au bord le plus proche — on n'a pas
 * à viser l'espace entre deux lettres. Un `[fichier: …]` compte comme un
 * seul mot. Entre deux mots, l'endroit visé reste tel quel.
 */
const MOT_OU_ANCRE = /\[fichier:\s*[^\n\]]+\]|[^\s]+/g;

export function accrocheAuMot(texte: string, index: number): number {
  const vise = Math.max(0, Math.min(index, texte.length));
  MOT_OU_ANCRE.lastIndex = 0;
  let trouve: RegExpExecArray | null;
  while ((trouve = MOT_OU_ANCRE.exec(texte))) {
    const debut = trouve.index;
    const fin = debut + trouve[0].length;
    if (vise > debut && vise < fin) {
      return vise - debut < fin - vise ? debut : fin;
    }
  }
  return vise;
}

/**
 * Glisser une ancre ailleurs dans la phrase. Lâchée sur elle-même, elle ne
 * bouge pas. Le compte des ancres ne change pas : les pièces jointes restent.
 */
export function deplacerAncre(
  texte: string,
  nom: string,
  occurrence: number,
  vers: number,
): { texte: string; curseur: number } {
  const tag = ancreDuTexte(texte, nom, occurrence);
  if (!tag) return { texte, curseur: Math.max(0, Math.min(vers, texte.length)) };
  const { debut, fin } = tag;
  const vise = Math.max(0, Math.min(vers, texte.length));
  if (vise >= debut && vise <= fin) return { texte, curseur: fin };

  const { texte: sans, coupe } = retireAncreA(texte, debut, fin - debut);
  const viseAjuste = vise > debut ? Math.max(0, Math.min(vise - coupe, sans.length)) : vise;
  return insereAncre(sans, nom, viseAjuste);
}

/**
 * Ce qui reste des pièces jointes après une frappe. Une ancre effacée à la
 * main retire son fichier ; un fichier sans ancre du tout (joint avant cette
 * mécanique, ou ancre jamais posée) n'est jamais emporté par erreur.
 */
export function jointesApresFrappe<T extends PieceJointeIdentifiee>(
  jointes: readonly T[],
  avant: string,
  apres: string,
): T[] {
  const compte = (texte: string) => {
    const parContenu = new Map<string, number>();
    for (const tag of tagsDuTexte(texte)) parContenu.set(tag.nom, (parContenu.get(tag.nom) ?? 0) + 1);
    return parContenu;
  };
  const restants = compte(apres);
  const aRetirer = new Map<string, number>();
  for (const [contenu, n] of compte(avant)) {
    const perdu = n - (restants.get(contenu) ?? 0);
    if (perdu > 0) aRetirer.set(contenu, perdu);
  }
  if (!aRetirer.size) return [...jointes];

  // On enlève les derniers joints d'abord : le plus récent est le plus
  // probablement celui dont on vient d'effacer l'ancre. Un tag qui porte la
  // désignation (« image.png #f0da ») ne vise que SA pièce ; un tag d'avant,
  // le seul nom.
  const garde: T[] = [];
  for (let i = jointes.length - 1; i >= 0; i -= 1) {
    const item = jointes[i]!;
    const cle = [designationDePiece(item), item.name].find((c) => (aRetirer.get(c) ?? 0) > 0);
    if (cle) {
      aRetirer.set(cle, aRetirer.get(cle)! - 1);
      continue;
    }
    garde.unshift(item);
  }
  return garde;
}

/**
 * UN TAG EST UN BLOC, PAS UNE SUITE DE LETTRES.
 *
 * Dans le champ de saisie, « [fichier: capture.png] » se lit comme une
 * pastille : effacer une lettre à l'intérieur doit retirer le tag ENTIER, pas
 * le grignoter caractère par caractère — un tag amputé ne désigne plus rien et
 * sa pièce jointe reste accrochée à un texte devenu faux.
 */
const TAG_FICHIER = /\[fichier:\s*([^\]\n]+)\]/g;

export interface TagDuTexte {
  nom: string;
  debut: number;
  /** Le premier caractère APRÈS le tag. */
  fin: number;
}

/** Tous les tags du texte, dans l'ordre où ils apparaissent. */
export function tagsDuTexte(texte: string): TagDuTexte[] {
  TAG_FICHIER.lastIndex = 0;
  const tags: TagDuTexte[] = [];
  let trouve: RegExpExecArray | null;
  while ((trouve = TAG_FICHIER.exec(texte))) {
    tags.push({ nom: nomDuTag(trouve[1]!), debut: trouve.index, fin: trouve.index + trouve[0].length });
  }
  return tags;
}

/** Le sens de la touche d'effacement : retour arrière ou suppression avant. */
export type SensDEffacement = 'arriere' | 'avant';

/**
 * Ce que devient le texte quand on efface, une fois les tags traités comme des
 * blocs. Rend `null` quand aucun tag n'est touché : la frappe suit alors son
 * chemin normal, et le champ garde son historique d'annulation.
 *
 * Le curseur seul (rien de sélectionné) efface un caractère ; ce caractère
 * appartient-il à un tag, c'est TOUT le tag qui part. Une sélection, elle,
 * s'ÉTEND aux tags qu'elle n'entame qu'à moitié : on n'en laisse jamais un
 * morceau derrière.
 */
export function effacementDeTag(
  texte: string,
  debutSelection: number,
  finSelection: number,
  sens: SensDEffacement,
): { texte: string; curseur: number } | null {
  const tags = tagsDuTexte(texte);
  if (!tags.length) return null;

  let debut = Math.max(0, Math.min(debutSelection, texte.length));
  let fin = Math.max(0, Math.min(finSelection, texte.length));
  if (debut > fin) [debut, fin] = [fin, debut];

  if (debut === fin) {
    // Le caractère que la touche allait retirer.
    if (sens === 'arriere') {
      if (debut === 0) return null;
      debut -= 1;
    } else {
      if (fin === texte.length) return null;
      fin += 1;
    }
  }

  // Les tags que cette coupe entame, même d'une seule lettre.
  const touches = tags.filter((tag) => tag.debut < fin && debut < tag.fin);
  if (!touches.length) return null;

  const coupeDebut = Math.min(debut, ...touches.map((t) => t.debut));
  const coupeFin = Math.max(fin, ...touches.map((t) => t.fin));
  const { texte: suite } = retireAncreA(texte, coupeDebut, coupeFin - coupeDebut);
  return { texte: suite, curseur: coupeDebut };
}

/**
 * Réordonner la liste des pièces jointes après un glissement : l'ordre choisi
 * dans la barre d'écriture est celui envoyé avec le message. Les ancres dans
 * le texte ne bougent pas — seul l'ordre d'ENVOI change.
 */
export function deplacerJointe<T>(jointes: readonly T[], depuis: number, vers: number): T[] {
  if (
    depuis === vers ||
    depuis < 0 ||
    vers < 0 ||
    depuis >= jointes.length ||
    vers >= jointes.length
  ) {
    return [...jointes];
  }
  const copie = [...jointes];
  const [item] = copie.splice(depuis, 1);
  copie.splice(vers, 0, item as T);
  return copie;
}

/**
 * UN TAG OCCUPE DANS LE CHAMP LA LARGEUR DE SA PASTILLE, PAS CELLE DE SA
 * SYNTAXE.
 *
 * Le champ de saisie est un vrai `textarea` : il ne sait pas rétrécir une
 * partie de son texte. « [fichier: IMG_6458.jpeg] » y prenait donc la place de
 * ses vingt-cinq caractères — la moitié d'une ligne de téléphone — alors que
 * la pastille dessinée par-dessus n'en couvrait que les deux tiers. D'où les
 * deux défauts vus à l'écran : chaque tag tombait seul sur sa ligne, et la
 * sélection (double-clic, glissement du doigt) surlignait une bande plus large
 * que l'étiquette affichée.
 *
 * Le champ affiche donc les tags MASQUÉS : l'enrobage « [fichier: » et « ] »
 * est remplacé, CARACTÈRE POUR CARACTÈRE, par des caractères invisibles —
 * quelques cadratins (` `, un em de large) pour réserver la place du
 * trombone et de la croix, le reste en liants de largeur nulle (U+2060) qui
 * interdisent aussi la coupure en fin de ligne. Le NOM du fichier, lui, reste
 * écrit tel quel : c'est lui qui donne au tag la largeur du mot.
 *
 * LE NOMBRE DE CARACTÈRES NE CHANGE PAS, jamais : le masque compte autant de
 * signes que le tag qu'il remplace. Curseur, sélection, retours à la ligne et
 * index des ancres restent donc valables des deux côtés — le champ, le calque
 * et l'état du composeur parlent des mêmes positions.
 *
 * Tout ce qui SORT du champ (frappe, copie, envoi) repasse par
 * `tagsDemasques`, qui rend le tag à sa syntaxe exacte, à la longueur près.
 */
const CADRATIN = '\u2003';
/** Liant de largeur nulle : il ne se voit pas et interdit la coupure. */
const LIANT = '\u2060';
/** Les deux bornes invisibles d'un tag masqué, jamais tapées par personne. */
export const MASQUE_DEBUT = '\u2062';
export const MASQUE_FIN = '\u2063';
/** La place réservée au dessin de la pastille (trombone, croix, marges). */
const CADRATINS_DU_DESSIN = 3;

const TAG_MASQUE = /\u2062([\u2060\u2003]*)([^\u2062\u2063\n]*)\u2063/g;
/** Ce qui n'a rien à faire dans un texte rendu au dehors. */
const SIGNES_DE_MASQUE = /[\u2060\u2062\u2063]/g;

/**
 * LA PLACE RÉSERVÉE EST CELLE DE CE QUI EST RÉELLEMENT AFFICHÉ.
 *
 * Le masque gardait le NOM DU FICHIER en clair : le tag occupait donc la
 * largeur de « IMG_6458.jpeg » alors que la pastille dessinée par-dessus
 * n'affiche que « #1a0c ». La pastille était alors étirée de force pour
 * couvrir cette largeur, d'où la zone vide entre l'étiquette et la croix.
 *
 * Quand la pièce jointe est connue, le masque écrit donc l'ÉTIQUETTE COURTE
 * (`etiquetteDuTag`) et comble le reste avec des liants de largeur nulle. LE
 * NOMBRE DE CARACTÈRES NE BOUGE PAS D'UN SIGNE — c'est l'invariant de tout ce
 * fichier —, seule la LARGEUR à l'écran se réduit à ce qu'on voit. Une pièce
 * inconnue (brouillon d'avant, fichier retiré) garde son nom : le masque est
 * alors celui d'avant, mot pour mot.
 */
function contenuDuMasque(nomBrut: string, jointes: readonly PieceJointeIdentifiee[]): string {
  const ordinaire = nomBrut.replace(/ /g, ' ');
  const etiquette = etiquetteDuTag(ordinaire, jointes);
  /* Le nom doit se RETROUVER à l'identique au démasquage : on ne raccourcit
     que si la pièce est reconnue par son nom exact, et que l'étiquette tient
     dans la place du nom. */
  if (etiquette === ordinaire || etiquette.length > nomBrut.length) return insecable(nomBrut);
  return `${etiquette}${LIANT.repeat(nomBrut.length - etiquette.length)}`;
}

/**
 * Le nom que porte un contenu de masque : l'étiquette courte est retraduite.
 * Le contenu a la LONGUEUR du nom masqué : c'est elle qui dit si le tag
 * portait la désignation (« image.png #f0da ») ou, tag d'avant, le seul nom.
 */
function nomDuMasque(contenu: string, jointes: readonly PieceJointeIdentifiee[]): string {
  const nu = contenu.replace(/\u2060+$/, '');
  if (!nu.startsWith('#')) return contenu;
  const piece = jointes.find((candidate) => candidate.alias && `#${candidate.alias}` === nu);
  if (!piece) return contenu;
  const designation = designationDePiece(piece);
  return designation.length === contenu.length ? designation : piece.name;
}

/**
 * Le masque d'un tag : autant de caractères que l'enrobage qu'il remplace,
 * dont trois cadratins pour la place du dessin. Deux cadratins ne se touchent
 * jamais — un liant les sépare, sinon la ligne pourrait se couper entre eux.
 */
function masqueDuTag(nom: string, prefixe: number): string {
  const remplissage: string[] = [];
  let cadratins = 0;
  for (let i = 0; i < Math.max(0, prefixe - 2); i += 1) {
    if (cadratins < CADRATINS_DU_DESSIN && i % 2 === 0) {
      remplissage.push(CADRATIN);
      cadratins += 1;
    } else {
      remplissage.push(LIANT);
    }
  }
  return `${MASQUE_DEBUT}${remplissage.join('')}${LIANT}${nom}${MASQUE_FIN}`;
}

/**
 * Le texte tel que le CHAMP l'affiche : ses tags masqués, à longueur égale.
 * Les pièces jointes connues laissent place à leur étiquette courte.
 */
export function tagsMasques(texte: string, jointes: readonly PieceJointeIdentifiee[] = []): string {
  TAG_FICHIER.lastIndex = 0;
  return texte.replace(TAG_FICHIER, (brut, nomBrut: string) => {
    const prefixe = brut.length - nomBrut.length - 1;
    return masqueDuTag(contenuDuMasque(nomBrut, jointes), prefixe);
  });
}

/** L'inverse : ce que le champ affiche redevient un vrai « [fichier: …] ». */
export function tagsDemasques(texte: string, jointes: readonly PieceJointeIdentifiee[] = []): string {
  TAG_MASQUE.lastIndex = 0;
  return texte.replace(TAG_MASQUE, (_brut, bourre: string, contenu: string) => {
    const prefixe = bourre.length + 1;
    const espaces = Math.max(0, prefixe - '[fichier:'.length);
    const nom = insecable(nomDuMasque(contenu, jointes));
    return `[fichier:${ESPACE_INSECABLE.repeat(espaces)}${nom}]`;
  });
}

/**
 * Un texte qui QUITTE le champ (copie, envoi) : ses tags redeviennent lisibles
 * et rien d'invisible ne part avec. Une sélection peut couper un masque en
 * deux — un demi-masque ne se relit pas, il se jette.
 */
export function sansMasque(texte: string, jointes: readonly PieceJointeIdentifiee[] = []): string {
  return tagsDemasques(texte, jointes).replace(SIGNES_DE_MASQUE, '');
}

export interface TagMasqueDuTexte extends TagDuTexte {
  /** Le masque lui-même, à écrire tel quel dans le calque. */
  brut: string;
}

/** Tous les tags masqués du texte affiché, dans l'ordre. */
export function masquesDuTexte(
  texte: string,
  jointes: readonly PieceJointeIdentifiee[] = [],
): TagMasqueDuTexte[] {
  TAG_MASQUE.lastIndex = 0;
  const tags: TagMasqueDuTexte[] = [];
  let trouve: RegExpExecArray | null;
  while ((trouve = TAG_MASQUE.exec(texte))) {
    tags.push({
      nom: nomDuTag(nomDuMasque(trouve[2] ?? '', jointes)),
      brut: trouve[0],
      debut: trouve.index,
      fin: trouve.index + trouve[0].length,
    });
  }
  return tags;
}

/**
 * UN TAG « [fichier: …] » EST UN BLOC, PAS DU TEXTE : LE CURSEUR N'ENTRE PAS
 * DEDANS.
 *
 * Cliquer au milieu d'une pastille posait le curseur À L'INTÉRIEUR du texte
 * qu'elle recouvre. La frappe suivante écrivait donc dans « [fichier: … ] » :
 * le nom changeait, le tag ne désignait plus rien, et la pièce jointe
 * disparaissait de l'envoi sans que rien ne le dise.
 *
 * Cette règle repousse le curseur HORS des tags. Un curseur seul tombé dedans
 * va au bord le plus proche ; une sélection qui n'entame un tag qu'à moitié
 * s'ÉTEND jusqu'à le couvrir en entier — on ne laisse jamais un demi-tag
 * sélectionné, sinon la frappe suivante le couperait en deux.
 *
 * Elle rend `null` quand rien ne bouge : l'appelant n'a alors aucune raison de
 * toucher à la sélection du champ.
 */
export function curseurHorsDesTags(
  texte: string,
  debutSelection: number,
  finSelection: number,
): { debut: number; fin: number } | null {
  const tags = tagsDuTexte(texte);
  if (!tags.length) return null;

  let debut = Math.max(0, Math.min(debutSelection, texte.length));
  let fin = Math.max(0, Math.min(finSelection, texte.length));
  if (debut > fin) [debut, fin] = [fin, debut];

  if (debut === fin) {
    const dedans = tags.find((tag) => debut > tag.debut && debut < tag.fin);
    if (!dedans) return null;
    const place = debut - dedans.debut < dedans.fin - debut ? dedans.debut : dedans.fin;
    return { debut: place, fin: place };
  }

  let gauche = debut;
  let droite = fin;
  for (const tag of tags) {
    if (tag.debut >= droite || tag.fin <= gauche) continue;
    gauche = Math.min(gauche, tag.debut);
    droite = Math.max(droite, tag.fin);
  }
  return gauche === debut && droite === fin ? null : { debut: gauche, fin: droite };
}

/**
 * CETTE FRAPPE COUPERAIT-ELLE UN TAG EN DEUX ?
 *
 * Vrai quand ce qui va être remplacé n'entame un tag qu'à MOITIÉ : le curseur
 * posé en son milieu, une sélection qui déborde d'un côté seulement, un texte
 * lâché à l'intérieur. Un tag couvert EN ENTIER, lui, se remplace comme
 * n'importe quel mot — c'est ce que fait la touche d'effacement.
 *
 * C'est le dernier filet, après `curseurHorsDesTags` : ce qui a échappé au
 * placement du curseur (glisser-déposer, saisie d'un clavier virtuel, annuler
 * du navigateur) est refusé ici.
 */
export function coupeUnTag(texte: string, debutSelection: number, finSelection: number): boolean {
  let debut = Math.max(0, Math.min(debutSelection, texte.length));
  let fin = Math.max(0, Math.min(finSelection, texte.length));
  if (debut > fin) [debut, fin] = [fin, debut];
  return tagsDuTexte(texte).some(
    (tag) => tag.debut < fin && debut < tag.fin && !(debut <= tag.debut && tag.fin <= fin),
  );
}
