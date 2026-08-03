/**
 * Lire un champ de texte à la loupe.
 *
 * Un navigateur ne dit pas « à quel caractère correspond ce point de
 * l'écran » pour un champ de texte : les fonctions existantes ne marchent pas
 * partout. On fabrique donc un MIROIR — un bloc invisible posé exactement sur
 * le champ, avec la même police, la même largeur et les mêmes marges — et on
 * y mesure ce qu'on ne peut pas mesurer directement.
 *
 * Deux usages : savoir où un fichier vient d'être lâché, et savoir jusqu'où
 * faire défiler pour montrer une ancre.
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

function avecMiroir<T>(zone: HTMLTextAreaElement, travail: (texte: Text, miroir: HTMLDivElement) => T): T | null {
  if (zone.value.length > TROP_LONG) return null;
  const cadre = zone.getBoundingClientRect();
  const style = window.getComputedStyle(zone);
  const miroir = document.createElement('div');
  const copie = miroir.style as unknown as Record<string, string>;
  for (const nom of REGLAGES) copie[nom] = style[nom];
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
export function indexAuPoint(zone: HTMLTextAreaElement, x: number, y: number): number | null {
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
     */
    let distanceLigne = Infinity;
    let resultat = total;
    let arrete = false;

    for (let i = 0; i < total; i += 1) {
      mesure.setStart(texte, i);
      mesure.setEnd(texte, i + 1);
      const boite = mesure.getBoundingClientRect();
      const ecart = vy < boite.top ? boite.top - vy : vy > boite.bottom ? vy - boite.bottom : 0;
      if (ecart > distanceLigne) continue;
      if (ecart < distanceLigne) {
        // Une ligne plus proche : on recommence à la lire de gauche à droite.
        distanceLigne = ecart;
        resultat = i;
        arrete = false;
      }
      if (arrete) continue;
      if (vx < boite.left + boite.width / 2) {
        resultat = i;
        arrete = true;
      } else {
        resultat = i + 1;
      }
    }
    return resultat;
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
