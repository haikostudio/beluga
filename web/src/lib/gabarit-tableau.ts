/**
 * LE GABARIT DU TABLEAU, ÉCRIT UNE FOIS POUR LE TABLEAU ET POUR SA SILHOUETTE.
 *
 * La silhouette de chargement (`SilhouetteTableau`, `silhouettes.tsx`) doit
 * occuper au pixel près la place du vrai tableau (`board.tsx`) : sinon tout
 * saute à l'arrivée des cartes. Elle recopiait ces classes à la main, et la
 * copie avait dérivé — des cartes de 70 px contre 172, pas de pied sous « À
 * déployer », des rangées sur téléphone quand le tableau s'y pose en colonnes :
 * 160 px de saut par rangée sur ordinateur, plus de 1 000 px sur téléphone.
 * Les DEUX côtés importent désormais ces constantes : une retouche ici déplace
 * le tableau ET sa silhouette ensemble (`scripts/verif-silhouettes-chargement.mjs`).
 *
 * Tailwind ne lit pas un nom de classe fabriqué à la volée : chaque classe
 * s'écrit ici en toutes lettres.
 */

/** La largeur d'une carte dans sa rangée ; l'aperçu du glisser reprend ce nombre. */
export const LARGEUR_CARTE_PX = 268;
export const CLASSE_LARGEUR_CARTE = 'w-[268px]';

/**
 * LA HAUTEUR D'UNE CARTE EN RANGÉE. Une carte peut porter un titre d'une ou
 * deux lignes, un badge, une mention (reprise, sans suite, archivage…) et un
 * bandeau de pied (statut, travail en cours) — sans plafond, deux cartes
 * voisines n'avaient jamais la même hauteur et la rangée entière ondulait. Le
 * titre est donc borné à deux lignes (`line-clamp-2`, jamais posé dans un
 * bouton) et l'ensemble tient dans cette hauteur fixe. En colonnes, la hauteur
 * reste libre.
 */
export const CLASSE_HAUTEUR_CARTE = 'h-[172px]';

/**
 * « TABLEAUX DE BORD » : LA HAUTEUR D'UNE CARTE, six pixels de plus qu'au
 * tableau. Une bande de travail en pied (« Réflexion en cours »…) raccourcit la
 * tuile, et la frise tombe au même endroit sur toutes : à 172 px, l'ancienneté
 * s'y collait contre la bande. Ces six pixels vont sous l'ancienneté ; sans
 * bande, le pied les garde en retrait bas (`pb-1.5`), et l'air autour de la
 * frise ne bouge pas.
 */
export const CLASSE_HAUTEUR_CARTE_EN_ROUTE = 'h-[178px]';

/**
 * « TABLEAUX DE BORD » : LA HAUTEUR DU CORPS D'UNE CARTE (titre, début de la
 * demande), sous sa tête. Fixe, pour que la frise des étapes posée juste
 * dessous tombe au MÊME endroit sur toutes les cartes — qu'elles portent une
 * bande de travail en pied (qui raccourcit la tuile) ou non, et quelle que
 * soit la longueur de la demande. Deux lignes de titre et deux de demande y
 * tiennent ; au-delà, le corps se coupe.
 */
export const CLASSE_HAUTEUR_CORPS_EN_ROUTE = 'h-[72px]';

/** Le rail qui porte les rangées (vertical) ou les colonnes (horizontal). */
export const classesRail = (enColonnes: boolean): string =>
  enColonnes ? 'flex gap-2.5 scroll-px-3 px-3 py-3' : 'flex flex-col gap-2.5 px-3 py-3';

/**
 * L'EMPILEMENT, DANS LE RAIL. En rangées, une grille à pistes égales
 * (`auto-rows-fr`) cale chaque rangée sur la plus haute — « À déployer » et son
 * pied compris.
 */
export const classesEmpilement = (enColonnes: boolean): string =>
  enColonnes ? 'flex h-full min-w-full gap-2.5' : 'grid auto-rows-fr gap-2.5';

/** Une rangée (ou une colonne), sans ses couleurs d'état. */
export const classesRangee = (enColonnes: boolean, telephone: boolean): string =>
  [
    'relative shrink-0 overflow-hidden rounded-lg bg-surface/70',
    enColonnes
      ? `h-full snap-start ${telephone ? 'w-[calc(100vw-2.5rem)]' : 'min-w-[280px] flex-1 basis-0'}`
      : 'w-full',
  ].join(' ');

/** Le bandeau de titre d'une rangée. */
export const CLASSES_TETE_RANGEE = 'flex shrink-0 items-center gap-1.5 px-2 py-1.5';

/**
 * L'emplacement du message « travail sans carte », posé au-dessus des cartes
 * de « À déployer » et « Archivé » — présent même vide : son `pt-1.5` compte
 * dans la hauteur de la rangée.
 */
export const CLASSES_ALERTE_RANGEE = 'shrink-0 px-1.5 pt-1.5';

/**
 * La bande de cartes : ce qui défile, de côté en rangées, de haut en bas en
 * colonnes.
 *
 * EN RANGÉES, UNE BANDE VIDE GARDE LA HAUTEUR D'UNE CARTE (`min-h-[190px]` :
 * la carte de 172 px, plus `p-1.5` en haut et `pb-3` en bas). Sans ce
 * plancher, la hauteur commune des rangées dépendait des DONNÉES : « À
 * déployer » vide, tout le tableau raccourcissait de 50 px, puis rallongeait
 * à l'arrivée d'une carte — et la silhouette, qui ne peut pas savoir quelles
 * rangées seront vides, sautait de 150 px au chargement.
 */
export const classesBande = (enColonnes: boolean): string =>
  enColonnes ? 'flex flex-col gap-1.5 p-1.5' : 'flex min-h-[190px] items-start gap-1.5 p-1.5 pb-3';

/** Le pied de « À déployer » : le bouton de mise en ligne, en bas de la rangée. */
export const CLASSES_PIED_RANGEE = 'mt-auto flex shrink-0 items-center gap-2 px-2 pb-3 pt-1.5';

/*
 * « TABLEAUX DE BORD » : DEUX COLONNES, « ACTIFS » ET « TERMINÉS », côte à côte
 * comme celles du tableau. Sur ordinateur elles se partagent la largeur ; sur
 * téléphone chacune tient l'écran et le rail défile de côté, colonne par
 * colonne (aimantation au bord gauche), comme le tableau en colonnes. Chaque
 * colonne défile seule à la verticale. La page et sa silhouette lisent ces
 * mêmes classes : rien ne se déplace à l'arrivée des cartes.
 */
export const classesRailEnRoute = (telephone: boolean): string =>
  telephone
    ? 'flex gap-2.5 scroll-px-3 px-3 py-3 snap-x snap-mandatory'
    : 'mx-auto flex h-full w-full max-w-[1600px] gap-3 px-4 pb-4 pt-3';

/** Une colonne de la page : son fond, sa largeur, son aimantation. */
export const classesColonneEnRoute = (telephone: boolean): string =>
  [
    'flex min-h-0 flex-col overflow-hidden rounded-lg bg-surface/70',
    telephone ? 'w-[calc(100vw-2.5rem)] shrink-0 snap-start' : 'h-full min-w-0 flex-1 basis-0',
  ].join(' ');

/** Le bandeau de titre d'une colonne de la page. */
export const CLASSES_TETE_COLONNE_EN_ROUTE = 'flex h-9 shrink-0 items-center gap-1.5 px-3';

/** Ce qui défile dans une colonne : le pied laisse la place au bouton flottant (ordinateur). */
export const CLASSES_LISTE_COLONNE_EN_ROUTE = 'px-2 pb-6 sm:pb-20';
