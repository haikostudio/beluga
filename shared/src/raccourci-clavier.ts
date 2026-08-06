/**
 * LE RACCOURCI CLAVIER QUI BASCULE L'ÉCOUTE VOCALE (même onglet Système que le
 * prénom de la voix, le mot de réveil et la vitesse).
 *
 * L'écoute permanente ne s'allumait qu'à l'interrupteur du panneau déplié
 * (préférence serveur `voix.ecoute`). On ajoute UNE combinaison de touches,
 * réglable, qui l'allume et l'éteint où que l'on soit dans l'application.
 *
 * Ces règles sont PURES (aucun navigateur) : elles servent aussi bien à
 * CAPTURER la combinaison dans les réglages qu'à RECONNAÎTRE l'appui n'importe
 * où — un même calcul des deux côtés, donc jamais deux avis qui divergent.
 *
 * La combinaison est rangée sous une FORME CANONIQUE : les modificateurs dans un
 * ordre fixe (Ctrl, Alt, Shift, Meta) puis le CODE PHYSIQUE de la touche
 * (`KeyE`, `Digit1`, `F2`…), joints par « + » — « Alt+KeyE », « Ctrl+Shift+KeyL ».
 * Le code physique, et non la lettre tapée, pour que le raccourci tienne quelle
 * que soit la disposition du clavier (et qu'Alt sur Mac ne le change pas en
 * caractère spécial). Vide = aucun raccourci réglé.
 */

/** Les codes des touches modificatrices : seules, elles n'arment aucun raccourci. */
const CODES_MODIFICATEURS = new Set([
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'ShiftLeft',
  'ShiftRight',
  'MetaLeft',
  'MetaRight',
]);

/**
 * Des combinaisons que le navigateur se réserve : les capter les écraserait
 * (nouvel onglet, fenêtre privée, outils du développeur…). On refuse au moment
 * du réglage — la LIMITE de la carte.
 */
const RACCOURCIS_RESERVES = new Set([
  'Ctrl+Shift+KeyT', // rouvrir un onglet fermé
  'Ctrl+Shift+KeyN', // fenêtre de navigation privée
  'Ctrl+Shift+KeyW', // fermer la fenêtre
  'Ctrl+Shift+KeyI', // outils du développeur
  'Ctrl+Shift+KeyJ', // console
  'Ctrl+Shift+KeyC', // inspecteur d'élément
  'Ctrl+Shift+KeyR', // recharger sans cache
  'Ctrl+Shift+KeyQ', // quitter
  'Ctrl+Shift+KeyP', // navigation privée (Firefox)
  'Ctrl+Shift+KeyB', // barre des favoris
]);

/** L'état des quatre modificateurs, tel qu'un événement clavier le porte. */
export interface ModificateursRaccourci {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

/** Ce dont on a besoin d'un événement clavier — sans dépendre du DOM. */
export interface EvenementRaccourci extends ModificateursRaccourci {
  /** Le code physique de la touche (`event.code`) : « KeyE », « Digit1», « F2 ». */
  code: string;
}

interface RaccourciAnalyse extends ModificateursRaccourci {
  code: string;
}

function construireForme(mods: ModificateursRaccourci, code: string): string {
  const parties: string[] = [];
  if (mods.ctrl) parties.push('Ctrl');
  if (mods.alt) parties.push('Alt');
  if (mods.shift) parties.push('Shift');
  if (mods.meta) parties.push('Meta');
  parties.push(code);
  return parties.join('+');
}

function analyser(forme: string): RaccourciAnalyse {
  const parties = forme.split('+');
  const code = parties[parties.length - 1] ?? '';
  const mods = new Set(parties.slice(0, -1));
  return {
    code,
    ctrl: mods.has('Ctrl'),
    alt: mods.has('Alt'),
    shift: mods.has('Shift'),
    meta: mods.has('Meta'),
  };
}

/** Une touche principale acceptable : une lettre, un chiffre ou une touche F. */
function toucheValide(code: string): boolean {
  return /^Key[A-Z]$/.test(code) || /^Digit[0-9]$/.test(code) || /^F([1-9]|1[0-2])$/.test(code);
}

/**
 * La forme canonique d'un appui, ou `null` quand la touche pressée n'est encore
 * qu'un modificateur (on attend la vraie touche). Sert autant à capturer qu'à
 * reconnaître.
 */
export function formeDepuisEvenement(event: EvenementRaccourci): string | null {
  if (CODES_MODIFICATEURS.has(event.code)) return null;
  return construireForme(event, event.code);
}

/**
 * Pourquoi une combinaison ne peut PAS être retenue, en français simple — ou
 * `null` si elle convient. Exige une touche principale et au moins Ctrl ou Alt
 * (une touche seule, ou seulement Maj, partirait en tapant), écarte Cmd/⌘
 * (réservé au système) et les raccourcis connus du navigateur.
 */
export function raisonRaccourciRefuse(forme: string): string | null {
  const a = analyser(forme);
  if (!toucheValide(a.code)) {
    return 'Choisissez une lettre, un chiffre ou une touche F.';
  }
  if (a.meta) {
    return 'Cmd (⌘) est réservé au système ; utilisez Ctrl ou Alt.';
  }
  if (!a.ctrl && !a.alt) {
    return 'Ajoutez Ctrl ou Alt : une touche seule s’activerait en tapant.';
  }
  if (a.ctrl && !a.alt && !a.shift) {
    return 'Ctrl seul est souvent pris par le navigateur ; ajoutez Alt ou Maj.';
  }
  if (RACCOURCIS_RESERVES.has(forme)) {
    return 'Cette combinaison est un raccourci du navigateur.';
  }
  return null;
}

/** Vrai quand la combinaison peut être retenue telle quelle. */
export function raccourciAssignable(forme: string): boolean {
  return !!forme && raisonRaccourciRefuse(forme) === null;
}

function libelleTouche(code: string): string {
  const lettre = /^Key([A-Z])$/.exec(code);
  if (lettre) return lettre[1];
  const chiffre = /^Digit([0-9])$/.exec(code);
  if (chiffre) return chiffre[1];
  return code; // F1…F12 se lisent déjà bien
}

/**
 * La combinaison écrite pour l'œil : « Ctrl + Maj + E », « Alt + 1 ». Vide quand
 * aucun raccourci n'est réglé.
 */
export function libelleDeRaccourci(forme: string | undefined | null): string {
  if (!forme) return '';
  const a = analyser(forme);
  const parties: string[] = [];
  if (a.ctrl) parties.push('Ctrl');
  if (a.alt) parties.push('Alt');
  if (a.shift) parties.push('Maj');
  if (a.meta) parties.push('Cmd');
  parties.push(libelleTouche(a.code));
  return parties.join(' + ');
}

/**
 * Vrai quand l'appui correspond au raccourci réglé. Un raccourci vide ne se
 * déclenche jamais.
 */
export function raccourciDeclenche(event: EvenementRaccourci, forme: string | undefined | null): boolean {
  if (!forme) return false;
  return formeDepuisEvenement(event) === forme;
}

/**
 * Vrai quand l'élément qui a le focus est un champ de saisie : on n'y déclenche
 * pas le raccourci, pour ne pas le voler à ce qu'on est en train de taper.
 */
export function estCibleDeSaisie(
  cible: { tagName?: string | null; editable?: boolean } | null | undefined,
): boolean {
  if (!cible) return false;
  if (cible.editable) return true;
  const tag = (cible.tagName ?? '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
