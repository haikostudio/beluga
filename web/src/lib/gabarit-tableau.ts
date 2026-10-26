/**
 * LE GABARIT DU TABLEAU, ÉCRIT UNE FOIS POUR LE TABLEAU ET POUR SA SILHOUETTE.
 *
 * La silhouette de chargement (`SilhouetteTableau`, `silhouettes.tsx`) doit
 * occuper au pixel près la place du vrai tableau (`board.tsx`) : sinon tout
 * saute à l'arrivée des cartes. Elle recopiait ces classes à la main, et la
 * copie avait dérivé — des cartes de 70 px contre 172, pas de pied sous « À
 * déployer » : plus de 1 000 px de saut sur téléphone.
 * Les DEUX côtés importent désormais ces constantes : une retouche ici déplace
 * le tableau ET sa silhouette ensemble (`scripts/verif-silhouettes-chargement.mjs`).
 *
 * Tailwind ne lit pas un nom de classe fabriqué à la volée : chaque classe
 * s'écrit ici en toutes lettres.
 */

/** La largeur de l'aperçu d'une carte qu'on fait glisser. */
export const LARGEUR_CARTE_PX = 268;

/**
 * « TABLEAUX DE BORD » : LA HAUTEUR D'UNE CARTE. Au tableau d'un projet, une
 * carte a la hauteur de son contenu ; ici elle est fixe, pour que la frise des
 * étapes tombe au même endroit sur toutes. Une bande de travail en pied
 * (« Réflexion en cours »…, 30 px) raccourcit la tuile d'autant : la hauteur
 * garde donc, sous la frise, de quoi loger cette bande et un peu d'air (7 px
 * mesurés). Demande du 12/10/2026 (« gagner un peu en hauteur ») : plus
 * d'ancienneté en pied, et un titre sur UNE ligne — la carte passe de 178 à
 * 156 px. Le 25/10/2026 (« aérer les cartes ») : plus de demande sous le
 * titre, un titre sur deux lignes, plus d'espace intérieur et une frise plus
 * fine — la carte passe à 150 px : son contenu (120 px) plus la bande de
 * travail (30 px) y tiennent sans rien écraser. Elle reste FIXE : la silhouette de chargement a la même
 * hauteur, et rien ne saute à l'arrivée des cartes.
 */
export const CLASSE_HAUTEUR_CARTE_EN_ROUTE = 'h-[150px]';

/**
 * « TABLEAUX DE BORD » : LA HAUTEUR DU CORPS D'UNE CARTE (titre, début de la
 * demande), sous sa tête. Fixe, pour que la frise des étapes posée juste
 * dessous tombe au MÊME endroit sur toutes les cartes — qu'elles portent une
 * bande de travail en pied (qui raccourcit la tuile) ou non, et quelle que
 * soit la longueur du titre. Depuis le 25/10/2026 (« aérer les cartes »), la
 * demande ne s'y écrit plus (elle se lit dans la pastille « i ») : le corps
 * loge DEUX lignes de titre à 16 px (`leading-snug`, 2 × 22 px) ; au-delà, le
 * titre se coupe par « … ».
 */
export const CLASSE_HAUTEUR_CORPS_EN_ROUTE = 'h-[44px]';

/**
 * LA TENUE DES CARTES SYSTÈME (agents sans carte, dépannages, agents de
 * configuration) : la même que toute carte — un fond pâle, aucun cadre. Ce qui
 * les distingue se lit dans leur tête (« Dépannage », « Mise en ligne »).
 */
export const CLASSE_CADRE_SYSTEME =
  'relative z-10 flex min-h-0 flex-1 cursor-pointer flex-col overflow-hidden rounded-xl bg-surface px-4 py-3.5 transition-colors hover:bg-raised';

/**
 * LES CARTES DE SERVICE (agents de volet : Studio, Marketing, Surveillance,
 * Sauvegardes, bibliothèque de styles) ne portent plus de liseré : leur BADGE
 * (`BadgeDuService`) dit d'où elles viennent. La constante reste, vide, pour
 * les écrans qui la posent.
 */
export const CLASSE_LISERE_SERVICE = '';

/*
 * LE TABLEAU SE LIT EN COLONNES, ET SEULEMENT EN COLONNES : ses quatre états se
 * posent côte à côte. Les noms « rangée » qui restent ci-dessous désignent une
 * colonne — ils datent de l'affichage en rangées, retiré le 11/10/2026.
 */

/**
 * Le rail qui porte les colonnes : il défile de gauche à droite. Rien au-dessus :
 * la barre d'en-tête (`h-14`, boutons centrés) laisse déjà 12 px sous eux, de
 * quoi détacher les colonnes — un `pt-3` de plus faisait 40 px de vide
 * (demande du 12/10/2026).
 */
export const CLASSES_RAIL = 'flex gap-2.5 scroll-px-3 px-3 pb-3 pt-0';

/** Les colonnes côte à côte, pleine hauteur, dans le rail. */
export const CLASSES_EMPILEMENT = 'flex h-full min-w-full gap-2.5';

/**
 * Une colonne, sans ses couleurs d'état : sur téléphone elle tient l'écran, sur
 * ordinateur les quatre se partagent la largeur. Son LÉGER FOND
 * (`.fond-de-colonne-tableau`, styles.css) la détache de la page, sans trait.
 */
export const classesRangee = (telephone: boolean): string =>
  `fond-de-colonne-tableau relative shrink-0 overflow-hidden rounded-xl h-full snap-start ${telephone ? 'w-[calc(100vw-2.5rem)]' : 'min-w-[232px] flex-1 basis-0'}`;

/**
 * Le bandeau de titre d'une colonne : `pt-3` pour que le titre ne colle plus au
 * bord haut de la colonne (demande du 12/10/2026). Son `pb-2` est LE SEUL air
 * entre le titre et la première carte : l'emplacement du message et la bande
 * n'en ajoutent plus, comme sur les tableaux de bord (même distance de
 * l'axe du titre à la première carte, 18 px, mesurée).
 */
export const CLASSES_TETE_RANGEE = 'flex shrink-0 items-center gap-1.5 px-2 pb-2 pt-3';

/**
 * L'emplacement du message « travail sans carte », posé au-dessus des cartes
 * de « À déployer » et « Archivé ». Vide, il ne pèse RIEN : l'air qui sépare le
 * message des cartes est porté par le message lui-même
 * (`AlerteTravailSansCarte`, `mb-1.5`).
 */
export const CLASSES_ALERTE_RANGEE = 'shrink-0 px-1.5';

/**
 * La bande de cartes d'une colonne : ce qui défile, de haut en bas. Rien au
 * -dessus de la première carte (`pt-0`) : le bandeau porte déjà l'air. En mode
 * lot, `board.tsx` repose `pt-[15px]` pour la case à cocher qui déborde.
 */
export const CLASSES_BANDE = 'flex flex-col gap-1.5 px-1.5 pb-1.5 pt-0';

/** Le pied de « À déployer » : le bouton de mise en ligne, en bas de la colonne. */
export const CLASSES_PIED_RANGEE = 'mt-auto flex shrink-0 items-center gap-2 px-2 pb-3 pt-1.5';

/*
 * « TABLEAUX DE BORD » : TROIS COLONNES, « ACTIFS », « TERMINER » ET « ARCHIVER »,
 * côte à côte comme celles du tableau. Sur ordinateur elles se partagent la largeur ; sur
 * téléphone chacune tient l'écran et le rail défile de côté, colonne par
 * colonne (aimantation au bord gauche), comme le tableau en colonnes. Chaque
 * colonne défile seule à la verticale. La page et sa silhouette lisent ces
 * mêmes classes : rien ne se déplace à l'arrivée des cartes.
 */
export const classesRailEnRoute = (telephone: boolean): string =>
  telephone
    ? 'flex gap-2.5 scroll-px-3 px-3 pb-3 pt-0 snap-x snap-mandatory'
    : 'mx-auto flex h-full w-full max-w-[1600px] gap-3 px-4 pb-4 pt-0';

/** Une colonne de la page : son fond, sa largeur, son aimantation. */
export const classesColonneEnRoute = (telephone: boolean): string =>
  [
    'fond-de-colonne-tableau flex min-h-0 flex-col overflow-hidden rounded-xl',
    telephone ? 'w-[calc(100vw-2.5rem)] shrink-0 snap-start' : 'h-full min-w-0 flex-1 basis-0',
  ].join(' ');

/** Le bandeau de titre d'une colonne de la page. */
export const CLASSES_TETE_COLONNE_EN_ROUTE = 'flex h-9 shrink-0 items-center gap-1.5 px-3';

/** Ce qui défile dans une colonne : le pied laisse la place au bouton flottant (ordinateur). */
export const CLASSES_LISTE_COLONNE_EN_ROUTE = 'px-2 pb-6 sm:pb-20';
