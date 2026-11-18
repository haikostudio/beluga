/**
 * LE BOUTON DU BORD (décisions de l'utilisateur du 16/11/2026, carte « Jarvis : volet, voix et rapidité ») : l'entrée
 * de l'assistant, fondue dans un bord de l'écran, qu'on glisse sur n'importe lequel des quatre bords.
 *
 * La règle vit ici, sans DOM : le bord le plus proche, la place gardée en fraction du bord, la boîte à l'écran. Le
 * geste lui-même est dans `web/src/components/jarvis-natif.tsx` (le seul glisser de l'application, `usePointerDrag`).
 * L'ancien tirage horizontal qui sortait la barre d'appel a disparu avec elle.
 */

/** Au premier usage, le bouton se pose un peu au-dessus du milieu : loin du pouce qui fait défiler. */
export const FRACTION_PAR_DEFAUT = 0.4;

/* ------------------------------------------------------------------ */
/* Le bouton du bord, posé sur l’un des QUATRE bords                   */
/* ------------------------------------------------------------------ */

/**
 * LE BOUTON DU BORD SE POSE OÙ L'ON VEUT (carte « Jarvis : volet, voix et rapidité », 16/11/2026) : on le glisse
 * librement, et au lâcher il se colle au bord le PLUS PROCHE du pointeur — gauche, droite, haut ou bas —, à la place
 * du pointeur le long de ce bord. Sa place se garde en FRACTION du bord (elle tient au redimensionnement et à la
 * rotation), séparément pour l'ordinateur et le téléphone. Il ouvre le volet de l'assistant, du côté où il se trouve.
 */
export type BordDeLEcran = 'gauche' | 'droite' | 'haut' | 'bas';

export interface PlaceAuBord {
  bord: BordDeLEcran;
  /** De 0 (début du bord : haut ou gauche) à 1 (fin du bord : bas ou droite). */
  fraction: number;
}

export const PLACE_AU_BORD_PAR_DEFAUT: PlaceAuBord = { bord: 'gauche', fraction: FRACTION_PAR_DEFAUT };

/**
 * Le bouton du bord : sa LONGUEUR le long du bord et son ÉPAISSEUR, partie visible (sans les congés). Presque
 * ROND (« D » collé au bord) : l'icône à trois barres (18 × 13 px) y garde 6 px d'air de chaque côté — demandé
 * par l'utilisateur le 16/11/2026, maquette #6950 ; un bouton de 22 px laissait l'icône collée à ses côtés.
 */
export const LONGUEUR_DU_BOUTON_DE_BORD = 30;
export const EPAISSEUR_DU_BOUTON_DE_BORD = 30;
/** Les congés rentrants qui le fondent dans le bord, à chaque bout. */
export const CONGE_DU_BOUTON_DE_BORD = 8;

/** La zone où le bouton peut se poser : sous la barre d'en-tête, au-dessus du menu du bas, entre les deux côtés. */
export interface ZoneDuBord {
  haut: number;
  bas: number;
  gauche: number;
  droite: number;
}

/**
 * SUR TÉLÉPHONE, JAMAIS EN BAS (décision de l'utilisateur, 17/11/2026 : « sur mobile le bouton n'a pas le droit d'être
 * en bas, uniquement dans les bords ou en haut »). Le bas y est le domaine du champ d'écriture, du menu et de la bulle
 * vocale. `sansBas` retire ce bord des choix : un lâcher près du bas va au côté le plus proche.
 */
export interface OptionsDuBord {
  sansBas?: boolean;
}

/** Le bord le plus proche d'un point de la fenêtre. À égalité, les côtés passent avant le haut et le bas. */
export function bordLePlusProche(x: number, y: number, largeur: number, hauteur: number, options: OptionsDuBord = {}): BordDeLEcran {
  const distances: [BordDeLEcran, number][] = [
    ['gauche', x],
    ['droite', largeur - x],
    ['haut', y],
  ];
  if (!options.sansBas) distances.push(['bas', hauteur - y]);
  let meilleur = distances[0]!;
  for (const d of distances) if (d[1] < meilleur[1]) meilleur = d;
  return meilleur[0];
}

/** Le bord est-il vertical (gauche, droite) : le bouton y glisse de haut en bas. */
export function bordVertical(bord: BordDeLEcran): boolean {
  return bord === 'gauche' || bord === 'droite';
}

/** La course du bouton le long de son bord (début et fin, en px), dans la zone. */
function course(bord: BordDeLEcran, zone: ZoneDuBord): { debut: number; fin: number } {
  const long = LONGUEUR_DU_BOUTON_DE_BORD + 2 * CONGE_DU_BOUTON_DE_BORD;
  return bordVertical(bord)
    ? { debut: zone.haut, fin: Math.max(zone.haut, zone.bas - long) }
    : { debut: zone.gauche, fin: Math.max(zone.gauche, zone.droite - long) };
}

/** La place gardée au lâcher du pointeur en (x, y) : le bord le plus proche, et la place du pointeur le long de lui. */
export function placeAuLacher(x: number, y: number, largeur: number, hauteur: number, zone: ZoneDuBord, options: OptionsDuBord = {}): PlaceAuBord {
  const bord = bordLePlusProche(x, y, largeur, hauteur, options);
  const c = course(bord, zone);
  const milieu = (LONGUEUR_DU_BOUTON_DE_BORD + 2 * CONGE_DU_BOUTON_DE_BORD) / 2;
  const le = (bordVertical(bord) ? y : x) - milieu;
  const etendue = c.fin - c.debut;
  const fraction = etendue <= 0 ? FRACTION_PAR_DEFAUT : Math.max(0, Math.min(1, (le - c.debut) / etendue));
  return { bord, fraction: Math.round(fraction * 1000) / 1000 };
}

/**
 * LA BOÎTE DU BOUTON À L'ÉCRAN (congés compris) : `debut` est sa place le long du bord, et la boîte entière, posée
 * contre le bord, en px de la fenêtre. Le bouton visible occupe le milieu ; les congés, les deux bouts. Le bord du
 * haut est celui de la fenêtre (l'écran y ajoute la zone sûre de l'iPhone) ; celui du bas, le `sol` : le haut du
 * menu du bas sur téléphone, le bas de la fenêtre (au-dessus du terminal ouvert) ailleurs.
 */
export function boiteDuBoutonDeBord(place: PlaceAuBord, zone: ZoneDuBord, largeur: number, sol: number): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const c = course(place.bord, zone);
  const f = Number.isFinite(place.fraction) ? Math.max(0, Math.min(1, place.fraction)) : FRACTION_PAR_DEFAUT;
  const debut = Math.round(c.debut + f * (c.fin - c.debut));
  const long = LONGUEUR_DU_BOUTON_DE_BORD + 2 * CONGE_DU_BOUTON_DE_BORD;
  const epais = EPAISSEUR_DU_BOUTON_DE_BORD;
  switch (place.bord) {
    case 'gauche':
      return { left: 0, top: debut, width: epais, height: long };
    case 'droite':
      return { left: largeur - epais, top: debut, width: epais, height: long };
    case 'haut':
      return { left: debut, top: 0, width: long, height: epais };
    case 'bas':
    default:
      return { left: debut, top: Math.max(0, sol - epais), width: long, height: epais };
  }
}

/**
 * Une place relue de la préférence du compte ; abîmée ou absente, la place par défaut. Avec `sansBas` (téléphone), une
 * place retenue AU BAS avant la règle est ramenée sur le côté le plus proche (gauche pour la moitié gauche du bas,
 * droite sinon), tout en bas de sa course : là où elle était, au plus près.
 */
export function placeAuBordLue(brute: unknown, options: OptionsDuBord = {}): PlaceAuBord {
  if (!brute || typeof brute !== 'object') return PLACE_AU_BORD_PAR_DEFAUT;
  const v = brute as Partial<PlaceAuBord>;
  const bords: BordDeLEcran[] = ['gauche', 'droite', 'haut', 'bas'];
  if (!v.bord || !bords.includes(v.bord)) return PLACE_AU_BORD_PAR_DEFAUT;
  const f = typeof v.fraction === 'number' && Number.isFinite(v.fraction) && v.fraction >= 0 && v.fraction <= 1 ? v.fraction : FRACTION_PAR_DEFAUT;
  if (options.sansBas && v.bord === 'bas') return { bord: f < 0.5 ? 'gauche' : 'droite', fraction: 1 };
  return { bord: v.bord, fraction: f };
}

/** Les préférences du compte qui gardent la place : une pour l'ordinateur, une pour le téléphone. */
export const CLE_BORD_ORDINATEUR = 'jarvis-bord-ordinateur';
export const CLE_BORD_TELEPHONE = 'jarvis-bord-telephone';
