/**
 * OÙ SE POSE LE MODULE DE VOIX.
 *
 * Le module était CLOUÉ en bas au centre de l'écran : il recouvrait parfois ce
 * qu'on lit, sans qu'on puisse le pousser ailleurs. Il se déplace désormais, à
 * la souris comme au doigt, et sa place est retenue dans le compte — par le
 * MÊME mécanisme que le bloc en bas à droite (une préférence serveur), donc
 * commune à tous les appareils.
 *
 * Ce qui est retenu n'est PAS une position absolue mais un DÉCALAGE, en pixels,
 * par rapport à la place d'origine (bas au centre) : un décalage nul rend
 * exactement l'affichage d'avant, et un petit écran ne reçoit pas la position
 * calculée pour un grand.
 *
 * Tout se calcule ici, sans navigateur : les règles sont rejouables seules.
 */

/** Où le décalage du module de voix est retenu (préférence serveur). */
export const CLE_VOIX_POSITION = 'voix';

/** Le décalage par défaut : aucun. Le module reste en bas au centre. */
export const DECALAGE_VOIX_DEFAUT: DecalageVoix = { x: 0, y: 0 };

/** Ce qu'on garde du bord de l'écran, en pixels, pour rester attrapable. */
export const MARGE_VOIX = 8;

/**
 * À partir de combien de pixels un appui devient un GLISSEMENT. En dessous, le
 * geste reste un clic : sinon un doigt qui tremble déplacerait le module au
 * lieu de le déplier.
 */
export const SEUIL_GLISSEMENT_VOIX = 4;

/**
 * À quelle distance d'un bord, au relâchement, le module s'y ACCROCHE. Assez
 * grand pour attraper un module lâché tout contre le bord (la règle de
 * visibilité le maintient déjà à `MARGE_VOIX` du bord, donc à 8 px), assez
 * petit pour ne pas happer la place d'origine (le module au repos vit à au
 * moins 24 px du bas). Voir `bordDaccroche`.
 */
export const SEUIL_ACCROCHE_VOIX = 20;

/** Un décalage en pixels, par rapport à la place d'origine. */
export interface DecalageVoix {
  x: number;
  y: number;
}

/**
 * Les trois bords auxquels le module peut s'accrocher. JAMAIS le haut : la
 * barre du haut de l'application y vit déjà.
 */
export type BordVoix = 'gauche' | 'droite' | 'bas';

/**
 * La PLACE retenue du module. C'est toujours un décalage `{x, y}` par rapport
 * à la place d'origine ; s'y ajoute, quand le module est ACCROCHÉ, le bord où
 * il l'est. Le décalage est alors le point où on l'a lâché — il donne la
 * position LE LONG du bord (hauteur pour gauche/droite, largeur pour bas), donc
 * conservée au rechargement. Sans `bord`, la place est libre, exactement comme
 * avant. Le format d'avant (`{x, y}` seul) reste lu tel quel : une place libre.
 */
export interface PlaceVoix extends DecalageVoix {
  bord?: BordVoix;
}

/** Une boîte à l'écran, telle que le navigateur la mesure. */
export interface BoiteVoix {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** La place disponible : la fenêtre du navigateur. */
export interface FenetreVoix {
  width: number;
  height: number;
}

/**
 * Ce qui a été retenu est-il un vrai décalage ? Une préférence absente, d'un
 * ancien format ou abîmée ne doit pas envoyer le module hors de l'écran : on
 * retombe alors sur la place d'origine.
 */
export function estDecalageVoix(valeur: unknown): valeur is DecalageVoix {
  if (!valeur || typeof valeur !== 'object') return false;
  const { x, y } = valeur as Partial<DecalageVoix>;
  return typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y);
}

/** Le décalage retenu, ramené à quelque chose d'utilisable. */
export function decalageRetenu(valeur: unknown): DecalageVoix {
  return estDecalageVoix(valeur) ? valeur : DECALAGE_VOIX_DEFAUT;
}

/** Un bord d'accroche valide ? (jamais le haut) */
export function estBordVoix(valeur: unknown): valeur is BordVoix {
  return valeur === 'gauche' || valeur === 'droite' || valeur === 'bas';
}

/**
 * La place retenue, ramenée à quelque chose d'utilisable. Un décalage seul
 * (l'ancien format) donne une place libre ; un bord valide en plus donne une
 * place accrochée. Une valeur abîmée retombe sur la place d'origine, libre.
 */
export function placeRetenue(valeur: unknown): PlaceVoix {
  // On ne garde QUE x et y : la valeur retenue peut porter d'autres champs (un
  // `bord` invalide, un reliquat), qu'on ne laisse pas fuir dans la place.
  const { x, y } = decalageRetenu(valeur);
  const bord =
    valeur && typeof valeur === 'object' && estBordVoix((valeur as { bord?: unknown }).bord)
      ? (valeur as { bord: BordVoix }).bord
      : undefined;
  return bord ? { x, y, bord } : { x, y };
}

/** Ramène une valeur entre deux bornes, la plus petite l'emportant si elles se croisent. */
function borner(valeur: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, valeur));
}

/**
 * Le décalage corrigé pour que le module reste ENTIÈREMENT visible.
 *
 * `ancre` est la boîte du module SANS décalage — sa place d'origine. On en
 * déduit de combien on peut le pousser sans qu'un bord sorte de la fenêtre. Un
 * module plus grand que la fenêtre (téléphone tourné, panneau déplié) est collé
 * en haut à gauche plutôt que rogné n'importe où.
 *
 * Sert au chargement (une position venue d'un grand écran) comme au
 * redimensionnement, et pendant le glissement lui-même.
 */
export function ramenerDansLEcran(
  decalage: DecalageVoix,
  ancre: BoiteVoix,
  fenetre: FenetreVoix,
  marge: number = MARGE_VOIX,
): DecalageVoix {
  const x = borner(
    decalage.x,
    marge - ancre.left,
    fenetre.width - marge - ancre.width - ancre.left,
  );
  const y = borner(
    decalage.y,
    marge - ancre.top,
    fenetre.height - marge - ancre.height - ancre.top,
  );
  return { x, y };
}

/** Deux décalages sont-ils les mêmes ? (au pixel près, pour ne rien réécrire pour rien) */
export function memeDecalage(a: DecalageVoix, b: DecalageVoix): boolean {
  return Math.round(a.x) === Math.round(b.x) && Math.round(a.y) === Math.round(b.y);
}

/**
 * Le pointeur a-t-il assez bougé pour que ce soit un déplacement, et non un
 * clic ? C'est ce qui permet au même geste d'ouvrir le module (appui immobile)
 * ou de le déplacer (appui qui glisse).
 */
export function estUnGlissement(dx: number, dy: number, seuil: number = SEUIL_GLISSEMENT_VOIX): boolean {
  return Math.abs(dx) >= seuil || Math.abs(dy) >= seuil;
}

/* ------------------------------------------------------------------ */
/* Accrocher le module à un bord                                       */
/* ------------------------------------------------------------------ */

/**
 * ACCROCHER LE MODULE À UN BORD.
 *
 * Lâché tout près d'un bord (gauche, droite ou bas), le module s'y accroche :
 * il s'aligne franchement sur ce bord et se RÉDUIT en une petite pastille, à
 * moitié engagée hors de l'écran, qui ne masque plus le contenu. Le survol (ou
 * l'appui) le fait revenir à sa taille normale et ouvrir son panneau vers
 * l'intérieur. Le tirer vers le centre le décroche.
 *
 * `bordDaccroche` décide, au relâchement, si le module est assez près d'un bord
 * pour s'y accrocher, et duquel. `decalageAccroche` en tire la place à donner
 * au module — pastille à moitié dehors quand il est fermé, rond entier collé au
 * bord quand il est ouvert. Tout se calcule sans navigateur.
 */

/**
 * Le bord auquel accrocher le module d'après la boîte du rond lâché, ou `null`
 * s'il n'est près d'aucun. On regarde les trois bords (jamais le haut) et l'on
 * prend le plus proche, à condition qu'il soit sous le seuil. Une égalité
 * penche vers le côté (gauche/droite) plutôt que le bas.
 */
export function bordDaccroche(
  rond: BoiteVoix,
  fenetre: FenetreVoix,
  seuil: number = SEUIL_ACCROCHE_VOIX,
): BordVoix | null {
  const gauche = rond.left;
  const droite = fenetre.width - (rond.left + rond.width);
  const bas = fenetre.height - (rond.top + rond.height);
  const plusProche = Math.min(gauche, droite, bas);
  if (plusProche > seuil) return null;
  if (plusProche === gauche) return 'gauche';
  if (plusProche === droite) return 'droite';
  return 'bas';
}

/** Ramène le BAS de la boîte (le long d'un bord vertical) dans l'écran. */
function basVisible(basVoulu: number, hauteur: number, fenetre: FenetreVoix, marge: number): number {
  const min = marge + hauteur;
  const max = fenetre.height - marge;
  return borner(basVoulu, min, max);
}

/** Ramène le CENTRE horizontal de la boîte (le long du bord bas) dans l'écran. */
function centreVisible(centreVoulu: number, largeur: number, fenetre: FenetreVoix, marge: number): number {
  const min = marge + largeur / 2;
  const max = fenetre.width - marge - largeur / 2;
  return borner(centreVoulu, min, max);
}

/**
 * La place à donner au module accroché, sous forme de décalage par rapport à
 * l'origine (bas au centre). La boîte est centrée en X et ancrée par le BAS,
 * donc son centre horizontal vaut `fenetre.width / 2 + décalage.x` et son bas
 * `originBas + décalage.y`, quelle que soit sa taille.
 *
 * — `taille` est le côté du carré affiché : la pastille quand le module est
 *   fermé, le rond de repos quand il est ouvert (le panneau se déploie ensuite
 *   à partir de ce rond, par `sensDouverture`).
 * — `demiDehors` vrai pousse la pastille à moitié hors de l'écran (module
 *   accroché fermé) ; faux colle la boîte au RAS du bord, entièrement dans
 *   l'écran (module ouvert). Au ras et non à une marge : ainsi le panneau
 *   ouvert recouvre toujours la bande où vivait la pastille, et le survol ne
 *   « décroche » pas du panneau qui vient de s'ouvrir vers l'intérieur.
 * — `place` donne, par son décalage, la position LE LONG du bord : la hauteur
 *   pour gauche/droite, la largeur pour bas ; elle est ramenée dans l'écran.
 */
export function decalageAccroche(
  bord: BordVoix,
  place: DecalageVoix,
  originBas: number,
  fenetre: FenetreVoix,
  taille: number,
  demiDehors: boolean,
  marge: number = MARGE_VOIX,
): DecalageVoix {
  const demiLargeurFenetre = fenetre.width / 2;
  if (bord === 'gauche' || bord === 'droite') {
    // Le bord extérieur de la boîte se pose sur le bord de l'écran : centre AU
    // bord quand la pastille est à moitié dehors, bord extérieur AU RAS quand
    // elle est entièrement rentrée.
    const centre =
      bord === 'gauche'
        ? demiDehors
          ? 0
          : taille / 2
        : demiDehors
          ? fenetre.width
          : fenetre.width - taille / 2;
    const bas = basVisible(originBas + place.y, taille, fenetre, marge);
    return { x: centre - demiLargeurFenetre, y: bas - originBas };
  }
  // Bord du bas : le bas de la boîte descend au ras du bord (au milieu quand la
  // pastille est à moitié dehors, au ras quand elle est entièrement rentrée).
  const bas = demiDehors ? fenetre.height + taille / 2 : fenetre.height;
  const centre = centreVisible(demiLargeurFenetre + place.x, taille, fenetre, marge);
  return { x: centre - demiLargeurFenetre, y: bas - originBas };
}

/* ------------------------------------------------------------------ */
/* De quel côté le panneau s'ouvre                                     */
/* ------------------------------------------------------------------ */

/**
 * DE QUEL CÔTÉ LE PANNEAU S'OUVRE.
 *
 * Le module fermé est un petit rond ; déplié, c'est un panneau bien plus large
 * et plus haut. Le BOUTON (le rond) ne bouge pas quand on ouvre : c'est le
 * panneau qui se place autour de lui, du côté où il reste de la place. Collé au
 * bord droit, il s'ouvre vers la gauche ; collé au bord gauche, vers la droite ;
 * posé en haut, il se déplie vers le bas au lieu du haut ; et de même pour les
 * coins. Ces règles sont pures, rejouables sans navigateur.
 */

/** Le sens horizontal : vers où le panneau S'ÉTEND depuis le bouton. */
export type SensHorizontal = 'centre' | 'gauche' | 'droite';
/** Le sens vertical : vers le haut (défaut, ancré en bas) ou vers le bas. */
export type SensVertical = 'haut' | 'bas';

/** Le côté choisi pour l'ouverture, en X et en Y. */
export interface SensOuverture {
  horizontal: SensHorizontal;
  vertical: SensVertical;
}

/** Une taille en pixels — celle du panneau, celle du rond. */
export interface TailleVoix {
  width: number;
  height: number;
}

/**
 * Le côté vers lequel déplier le panneau pour qu'il reste ENTIÈREMENT visible,
 * le bouton restant à sa place. On préfère toujours le centre (X) et le haut (Y)
 * — l'affichage d'avant — et l'on ne s'en écarte que si un bord sortirait.
 *
 * `rond` est la boîte du bouton fermé, telle qu'elle est à l'écran (décalage
 * compris). `panneau` est la taille du module DÉPLIÉ.
 */
export function sensDouverture(
  rond: BoiteVoix,
  panneau: TailleVoix,
  fenetre: FenetreVoix,
  marge: number = MARGE_VOIX,
): SensOuverture {
  const centreX = rond.left + rond.width / 2;
  const demi = panneau.width / 2;
  let horizontal: SensHorizontal;
  if (centreX - demi >= marge && centreX + demi <= fenetre.width - marge) {
    // La place est là des deux côtés : on reste centré, comme avant.
    horizontal = 'centre';
  } else if (rond.left + panneau.width <= fenetre.width - marge) {
    // Le bouton est vers la gauche : on s'étend vers la droite.
    horizontal = 'droite';
  } else if (rond.left + rond.width - panneau.width >= marge) {
    // Le bouton est vers la droite : on s'étend vers la gauche.
    horizontal = 'gauche';
  } else {
    // Plus large que l'écran : on va du côté où il reste le plus de place.
    horizontal = centreX <= fenetre.width / 2 ? 'droite' : 'gauche';
  }

  // Par défaut le panneau grandit vers le HAUT (le module vit en bas de l'écran).
  // S'il n'y a pas la place au-dessus, il se déplie vers le bas.
  let vertical: SensVertical = 'haut';
  if (rond.top + rond.height - panneau.height < marge) {
    vertical = rond.top + panneau.height <= fenetre.height - marge ? 'bas' : 'haut';
  }
  return { horizontal, vertical };
}

/**
 * La correction à AJOUTER au décalage du bouton pour poser le panneau du bon
 * côté sans que le bouton bouge. Elle est NULLE quand le panneau a la taille du
 * rond (module fermé). La boîte étant centrée en X et ancrée en bas :
 *   — une correction en X déplace le côté d'ancrage (à droite = on ancre le bord
 *     gauche du panneau sur le bouton, donc on grandit vers la droite) ;
 *   — une correction en Y positive (vers le bas) fait grandir le panneau vers le
 *     bas au lieu du haut.
 * Comme la largeur/hauteur et cette correction s'animent ensemble, en même temps
 * et de la même façon, le côté ancré (là où est le bouton) reste fixe pendant la
 * métamorphose.
 */
export function correctionOuverture(
  sens: SensOuverture,
  panneau: TailleVoix,
  rond: TailleVoix,
): DecalageVoix {
  let x = 0;
  if (sens.horizontal === 'droite') x = panneau.width / 2 - rond.width / 2;
  else if (sens.horizontal === 'gauche') x = rond.width / 2 - panneau.width / 2;
  const y = sens.vertical === 'bas' ? panneau.height - rond.height : 0;
  return { x, y };
}
