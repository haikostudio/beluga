/**
 * Lire un champ de texte à la loupe.
 *
 * Un navigateur ne dit pas « à quel caractère correspond ce point de
 * l'écran » pour un champ de texte : les fonctions existantes ne marchent pas
 * partout. On fabrique donc un MIROIR — un bloc invisible posé exactement sur
 * le champ, avec la même police, la même largeur et les mêmes marges — et on
 * y mesure ce qu'on ne peut pas mesurer directement.
 *
 * Quatre usages : savoir où un fichier vient d'être lâché, dessiner le trait
 * d'insertion pendant qu'on glisse un drapeau, savoir jusqu'où faire défiler
 * pour montrer une ancre, et CALER le calque des drapeaux exactement sur le
 * texte du champ (`reglagesDuChamp`).
 */

/** Les réglages qui décident du placement du texte, ni plus ni moins. */
const REGLAGES = [
  'boxSizing',
  'width',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontVariant',
  'letterSpacing',
  'lineHeight',
  'textIndent',
  'textTransform',
  'wordSpacing',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
] as const;

/** Au-delà, la mesure caractère par caractère coûterait plus qu'elle ne sert. */
const TROP_LONG = 8000;

/**
 * LA MARGE CACHÉE DU CHAMP, MESURÉE — JAMAIS DEVINÉE.
 *
 * Sur iPhone et iPad, un `textarea` écrit son texte quelques pixels (≈ 3 px)
 * plus loin du bord que sa marge intérieure déclarée, des DEUX côtés, et
 * aucune propriété calculée ne le dit. Un calque ou un miroir qui recopie les
 * réglages du champ a donc des lignes PLUS LARGES que les vraies : elles se
 * coupent ailleurs, et l'écart s'accumule de ligne en ligne — le curseur réel
 * clignotait au milieu d'un mot du texte affiché (« poin|ts »), et un tag
 * glissé se posait à côté de l'endroit visé.
 *
 * Aucun navigateur n'est nommé ici : on MESURE. La même phrase est posée dans
 * un bloc ordinaire et dans un champ, et on cherche la largeur à partir de
 * laquelle chacun la tient sur une seule ligne. L'écart entre les deux est la
 * marge cachée, partagée entre gauche et droite. Zéro partout ailleurs
 * qu'iOS ; la mesure n'est faite qu'une fois par police.
 */
const retraitsMesures = new Map<string, number>();

export function retraitCacheDuChamp(zone: HTMLTextAreaElement): number {
  const calcule = window.getComputedStyle(zone);
  const police = `${calcule.fontStyle} ${calcule.fontWeight} ${calcule.fontSize} ${calcule.fontFamily}`;
  const connu = retraitsMesures.get(police);
  if (connu !== undefined) return connu;
  const phrase = 'mmmm mmmm mmmm';
  const commun = (element: HTMLElement) => {
    const s = element.style;
    s.position = 'fixed';
    s.left = '-10000px';
    s.top = '0';
    s.visibility = 'hidden';
    s.font = police;
    s.lineHeight = '20px';
    s.letterSpacing = calcule.letterSpacing;
    s.padding = '0';
    s.border = '0';
    s.margin = '0';
    s.boxSizing = 'content-box';
    s.whiteSpace = 'pre-wrap';
    s.overflowWrap = 'break-word';
    s.overflow = 'hidden';
  };
  const bloc = document.createElement('div');
  commun(bloc);
  bloc.textContent = phrase;
  const champ = document.createElement('textarea');
  commun(champ);
  champ.rows = 1;
  champ.style.height = '20px';
  champ.style.resize = 'none';
  champ.value = phrase;
  document.body.append(bloc, champ);
  let retrait = 0;
  try {
    bloc.style.width = 'max-content';
    const naturel = Math.ceil(bloc.getBoundingClientRect().width);
    /** La plus petite largeur (en plus de la largeur naturelle) qui tient la phrase sur une ligne. */
    const seuil = (element: HTMLElement, hauteur: () => number) => {
      for (let ecart = 0; ecart <= 24; ecart += 1) {
        element.style.width = `${naturel + ecart}px`;
        if (hauteur() <= 30) return ecart;
      }
      return 24;
    };
    const seuilBloc = seuil(bloc, () => bloc.getBoundingClientRect().height);
    const seuilChamp = seuil(champ, () => champ.scrollHeight);
    retrait = Math.max(0, seuilChamp - seuilBloc) / 2;
  } finally {
    bloc.remove();
    champ.remove();
  }
  retraitsMesures.set(police, retrait);
  return retrait;
}

/** Une marge intérieure calculée, augmentée de la marge cachée. */
function avecRetrait(valeur: string, retrait: number): string {
  if (!retrait) return valeur;
  return `${(Number.parseFloat(valeur) || 0) + retrait}px`;
}

/**
 * LES MÊMES RÉGLAGES, POUR UN CALQUE POSÉ SUR LE CHAMP.
 *
 * Un calque qui redit les styles du champ en classes finit toujours par en
 * perdre un — une hauteur de ligne, une marge — et le texte affiché ne tombe
 * alors plus sur le texte réel : une ligne de trop, un curseur ailleurs qu'où
 * il paraît. On copie donc les réglages RÉELLEMENT calculés du champ, la même
 * liste que le miroir de mesure, et rien d'autre.
 *
 * `fenetre` est la PART VISIBLE du champ, mesurée dans le repère de son
 * conteneur : c'est elle, et rien d'autre, que le calque doit recouvrir. Un
 * calque étendu à tout le conteneur (`inset-0`) déborde sur ce qui suit le
 * champ — la rangée de boutons de la barre d'écriture —, et le texte trop long
 * s'y écrit par-dessus. La largeur retire l'ascenseur du champ, qui rétrécit
 * ses lignes dès que le texte dépasse ; les bordures sont retirées des deux
 * côtés, puisque la fenêtre commence déjà DANS le champ.
 */
export function reglagesDuChamp(zone: HTMLTextAreaElement): {
  style: Record<string, string>;
  fenetre: { top: number; left: number; width: number; height: number };
} {
  const calcule = window.getComputedStyle(zone);
  const style: Record<string, string> = {};
  for (const nom of REGLAGES) {
    // La largeur du calque vient de son placement, pas du champ ; ses bordures
    // sont déjà retirées par la fenêtre, les redire décalerait tout le texte.
    if (nom === 'width' || nom === 'boxSizing' || nom.startsWith('border')) continue;
    style[nom] = calcule[nom];
  }
  const retrait = retraitCacheDuChamp(zone);
  style.paddingLeft = avecRetrait(calcule.paddingLeft, retrait);
  style.paddingRight = avecRetrait(calcule.paddingRight, retrait);
  const hautBordure = Number.parseFloat(calcule.borderTopWidth) || 0;
  const gaucheBordure = Number.parseFloat(calcule.borderLeftWidth) || 0;
  return {
    style,
    fenetre: {
      top: zone.offsetTop + hautBordure,
      left: zone.offsetLeft + gaucheBordure,
      // `client*` : marges intérieures comprises, bordures et ascenseur exclus.
      width: zone.clientWidth,
      height: zone.clientHeight,
    },
  };
}

function avecMiroir<T>(zone: HTMLTextAreaElement, travail: (texte: Text, miroir: HTMLDivElement) => T): T | null {
  if (zone.value.length > TROP_LONG) return null;
  const cadre = zone.getBoundingClientRect();
  const style = window.getComputedStyle(zone);
  const miroir = document.createElement('div');
  const copie = miroir.style as unknown as Record<string, string>;
  for (const nom of REGLAGES) copie[nom] = style[nom];
  // La marge cachée d'iOS décide, elle aussi, des retours à la ligne.
  const retrait = retraitCacheDuChamp(zone);
  miroir.style.paddingLeft = avecRetrait(style.paddingLeft, retrait);
  miroir.style.paddingRight = avecRetrait(style.paddingRight, retrait);
  // La largeur EXACTE du champ, bordure comprise : c'est elle qui décide des
  // retours à la ligne.
  miroir.style.boxSizing = 'border-box';
  miroir.style.width = `${cadre.width}px`;
  /*
   * Le miroir est posé en haut à gauche, PAS sur le champ : un parent
   * transformé (un tiroir qui glisse) déplacerait un bloc « fixé » sans
   * prévenir. On compare donc des écarts, jamais des positions absolues.
   */
  miroir.style.position = 'fixed';
  miroir.style.left = '0';
  miroir.style.top = '0';
  miroir.style.whiteSpace = 'pre-wrap';
  miroir.style.overflowWrap = 'break-word';
  miroir.style.visibility = 'hidden';
  miroir.style.pointerEvents = 'none';
  miroir.style.height = 'auto';

  // Un caractère de bout de course : sans lui, un texte fini par un saut de
  // ligne perd sa dernière ligne à la mesure.
  const texte = document.createTextNode(`${zone.value}​`);
  miroir.appendChild(texte);
  document.body.appendChild(miroir);
  try {
    return travail(texte, miroir);
  } finally {
    miroir.remove();
  }
}

/**
 * À quel caractère du texte correspond ce point de l'écran ? Rend null quand
 * la mesure n'est pas possible — l'appelant retombe alors sur la fin du
 * texte, ce qui est toujours un choix valable.
 */
export function indexAuPoint(zone: HTMLTextAreaElement, x: number, y: number, marge = 0): number | null {
  const cadre = zone.getBoundingClientRect();
  return avecMiroir(zone, (texte, miroir) => {
    const total = zone.value.length;
    const mesure = document.createRange();
    const repere = miroir.getBoundingClientRect();
    // Le point visé, ramené dans le repère du miroir (le champ peut être
    // défilé : le texte y commence plus haut qu'il n'y paraît).
    const vx = x - cadre.left + repere.left;
    const vy = y - cadre.top + zone.scrollTop + repere.top;
    /*
     * On cherche la ligne la PLUS PROCHE verticalement, pas seulement celle
     * qui contient le point : un fichier lâché un cheveu au-dessus de la
     * première ligne vise évidemment le début du texte, pas la fin.
     * `marge` élargit chaque lettre (doigt sur téléphone) sans changer la
     * visée au pixel près à la souris.
     */
    let distanceLigne = Infinity;
    let resultat = total;
    let arrete = false;

    for (let i = 0; i < total; i += 1) {
      mesure.setStart(texte, i);
      mesure.setEnd(texte, i + 1);
      const boite = mesure.getBoundingClientRect();
      const haut = boite.top - marge;
      const bas = boite.bottom + marge;
      const gauche = boite.left - marge;
      const droite = boite.right + marge;
      const ecart = vy < haut ? haut - vy : vy > bas ? vy - bas : 0;
      if (ecart > distanceLigne) continue;
      if (ecart < distanceLigne) {
        // Une ligne plus proche : on recommence à la lire de gauche à droite.
        distanceLigne = ecart;
        resultat = i;
        arrete = false;
      }
      if (arrete) continue;
      if (vx < gauche + (droite - gauche) / 2) {
        resultat = i;
        arrete = true;
      } else {
        resultat = i + 1;
      }
    }
    return resultat;
  });
}

/** Où dessiner le trait d'insertion pour cet index, dans l'écran. */
export function pointDeLIndex(
  zone: HTMLTextAreaElement,
  index: number,
): { x: number; y: number; hauteur: number } | null {
  const cadre = zone.getBoundingClientRect();
  return avecMiroir(zone, (texte, miroir) => {
    const total = zone.value.length;
    const vise = Math.max(0, Math.min(index, total));
    const mesure = document.createRange();
    const repere = miroir.getBoundingClientRect();
    if (total === 0) {
      const style = window.getComputedStyle(zone);
      const padG = (Number.parseFloat(style.paddingLeft) || 0) + retraitCacheDuChamp(zone);
      const padH = Number.parseFloat(style.paddingTop) || 0;
      const hauteur = Number.parseFloat(style.lineHeight) || 20;
      return { x: cadre.left + padG, y: cadre.top + padH, hauteur };
    }
    if (vise < total) {
      mesure.setStart(texte, vise);
      mesure.setEnd(texte, vise + 1);
    } else {
      mesure.setStart(texte, total - 1);
      mesure.setEnd(texte, total);
    }
    const boite = mesure.getBoundingClientRect();
    const xMiroir = vise < total ? boite.left : boite.right;
    const x = xMiroir - repere.left + cadre.left;
    const y = boite.top - repere.top + cadre.top - zone.scrollTop;
    const hauteur = boite.height || 20;
    if (y + hauteur < cadre.top || y > cadre.bottom) return null;
    return {
      x: Math.max(cadre.left, Math.min(x, cadre.right - 2)),
      y: Math.max(cadre.top, y),
      hauteur: Math.min(hauteur, cadre.bottom - Math.max(cadre.top, y)),
    };
  });
}

/**
 * Faire défiler le champ pour montrer ce morceau de texte, sans y toucher ni
 * lui prendre le curseur. Le morceau se place au milieu quand c'est possible.
 */
export function montreLeMorceau(zone: HTMLTextAreaElement, debut: number, fin: number): void {
  if (zone.scrollHeight <= zone.clientHeight) return;
  avecMiroir(zone, (texte, miroir) => {
    const mesure = document.createRange();
    mesure.setStart(texte, Math.max(0, Math.min(debut, zone.value.length)));
    mesure.setEnd(texte, Math.max(0, Math.min(fin, zone.value.length)));
    const boite = mesure.getBoundingClientRect();
    const haut = boite.top - miroir.getBoundingClientRect().top;
    const vise = haut - (zone.clientHeight - boite.height) / 2;
    zone.scrollTop = Math.max(0, Math.min(vise, zone.scrollHeight - zone.clientHeight));
    return null;
  });
}
