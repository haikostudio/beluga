/**
 * LE RACCOURCI CLAVIER QUI OUVRE JARVIS (Réglages › Voix).
 *
 * Carte « Raccourcis libres et Jarvis vocal » (décisions de l'utilisateur, 17/11/2026) : le raccourci est LIBRE, en
 * TROIS formes au choix, et MAJ MAJ (double appui sur Maj) par défaut :
 *
 * - une COMBINAISON classique, modificateurs puis une touche : « Ctrl+Shift+KeyK », « Meta+Alt+KeyJ », « Alt+F2 » ;
 * - des MODIFICATEURS SEULS, au moins deux, déclenchés quand on les RELÂCHE sans avoir tapé autre chose entre-temps :
 *   « Mods:Ctrl+Shift » ;
 * - un DOUBLE APPUI sur un modificateur, deux appuis brefs sans autre touche entre les deux : « Double:Shift ».
 *
 * Seuls les raccourcis NATIFS sont refusés (Cmd/Ctrl + C, V, X, Z…, outils du navigateur, Spotlight). La touche Fn
 * n'est JAMAIS transmise aux pages web : elle ne peut pas servir. Il marche aussi dans un champ d'écriture.
 *
 * Ces règles sont PURES (aucun navigateur) : le RECONNAISSEUR ci-dessous reçoit les appuis et les relâchements, et
 * sert aussi bien à CAPTURER la forme dans les réglages qu'à la RECONNAÎTRE n'importe où — un même calcul des deux
 * côtés, donc jamais deux avis qui divergent.
 *
 * Les modificateurs sont rangés dans un ordre fixe (Ctrl, Alt, Shift, Meta) ; la touche est son CODE PHYSIQUE
 * (`KeyE`, `Digit1`, `F2`) pour tenir quelle que soit la disposition du clavier.
 *
 * LA VALEUR RANGÉE (`Settings.voixRaccourci`) : vide = jamais réglée → le défaut (Maj Maj) ; `AUCUN_RACCOURCI` =
 * retiré exprès ; sinon une des trois formes. Le vide ne peut pas dire « aucun » : les réglages déjà enregistrés
 * portent tous une valeur vide.
 */

/** Le raccourci de départ : deux appuis rapides sur Maj. */
export const RACCOURCI_PAR_DEFAUT = 'Double:Shift';
/** La valeur rangée quand l'utilisateur a retiré tout raccourci. */
export const AUCUN_RACCOURCI = 'Aucun';
/** Deux appuis d'un double appui : chacun bref, et le second suit le premier de près. */
export const DOUBLE_APPUI_MS = 350;
/** Des modificateurs seuls tenus plus longtemps ne déclenchent rien (on les tenait pour autre chose). */
export const MODIFICATEURS_SEULS_MS = 1500;

export type Modificateur = 'Ctrl' | 'Alt' | 'Shift' | 'Meta';
const ORDRE: Modificateur[] = ['Ctrl', 'Alt', 'Shift', 'Meta'];

/** Le modificateur d'une touche, ou `null` pour une touche ordinaire. */
export function modificateurDuCode(code: string): Modificateur | null {
  if (code === 'ControlLeft' || code === 'ControlRight') return 'Ctrl';
  if (code === 'AltLeft' || code === 'AltRight') return 'Alt';
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Shift';
  if (code === 'MetaLeft' || code === 'MetaRight' || code === 'OSLeft' || code === 'OSRight') return 'Meta';
  return null;
}

/** L'état des quatre modificateurs, tel qu'un événement clavier le porte. */
export interface ModificateursRaccourci {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

/** Ce dont on a besoin d'un événement clavier — sans dépendre du DOM. */
export interface EvenementRaccourci extends ModificateursRaccourci {
  /** Le code physique de la touche (`event.code`) : « KeyE », « Digit1 », « F2 ». */
  code: string;
}

/** Un appui ou un relâchement, horodaté, pour le reconnaisseur. */
export interface ToucheVue extends EvenementRaccourci {
  type: 'down' | 'up';
  /** L'instant, en millisecondes (`event.timeStamp` ou `Date.now()`). */
  t: number;
  /** L'auto-répétition d'une touche tenue : ignorée. */
  repeat?: boolean;
}

export type GenreDeRaccourci = 'combinaison' | 'modificateurs' | 'double';

interface RaccourciAnalyse extends ModificateursRaccourci {
  genre: GenreDeRaccourci;
  /** La touche principale (combinaison), ou le modificateur doublé (« Shift »). */
  code: string;
}

function modsVers(mods: ModificateursRaccourci): Modificateur[] {
  const liste: Modificateur[] = [];
  if (mods.ctrl) liste.push('Ctrl');
  if (mods.alt) liste.push('Alt');
  if (mods.shift) liste.push('Shift');
  if (mods.meta) liste.push('Meta');
  return liste;
}

function construireForme(mods: ModificateursRaccourci, code: string): string {
  return [...modsVers(mods), code].join('+');
}

function analyser(forme: string): RaccourciAnalyse {
  const sans = { ctrl: false, alt: false, shift: false, meta: false };
  if (forme.startsWith('Double:')) return { ...sans, genre: 'double', code: forme.slice(7) };
  if (forme.startsWith('Mods:')) {
    const mods = new Set(forme.slice(5).split('+'));
    return { genre: 'modificateurs', code: '', ctrl: mods.has('Ctrl'), alt: mods.has('Alt'), shift: mods.has('Shift'), meta: mods.has('Meta') };
  }
  const parties = forme.split('+');
  const code = parties[parties.length - 1] ?? '';
  const mods = new Set(parties.slice(0, -1));
  return { genre: 'combinaison', code, ctrl: mods.has('Ctrl'), alt: mods.has('Alt'), shift: mods.has('Shift'), meta: mods.has('Meta') };
}

/** Le genre d'une forme rangée (`null` : aucune). */
export function genreDuRaccourci(forme: string | null | undefined): GenreDeRaccourci | null {
  if (!forme) return null;
  return analyser(forme).genre;
}

/** Le raccourci réellement actif pour une valeur rangée : vide → Maj Maj, « Aucun » → aucun. */
export function raccourciEffectif(valeur: string | null | undefined): string | null {
  const v = (valeur ?? '').trim();
  if (!v) return RACCOURCI_PAR_DEFAUT;
  if (v === AUCUN_RACCOURCI) return null;
  return v;
}

/** Une touche principale acceptable : lettre, chiffre, touche F, Espace ou flèche. */
function toucheValide(code: string): boolean {
  return (
    /^Key[A-Z]$/.test(code) ||
    /^Digit[0-9]$/.test(code) ||
    /^F([1-9]|1[0-9]|2[0-4])$/.test(code) ||
    code === 'Space' ||
    /^Arrow(Up|Down|Left|Right)$/.test(code)
  );
}

/**
 * LES RACCOURCIS NATIFS, refusés au réglage : ceux du système et du navigateur, avec Ctrl (Windows, Linux) comme avec
 * Cmd (Mac). Les capter les volerait partout, champs compris.
 */
const LETTRES_NATIVES = 'C V X Z Y A S P F W Q T N R L O H M'.split(' ');
const LETTRES_NATIVES_AVEC_MAJ = 'Z T N W I J C R Q P B'.split(' ');
const NATIFS = new Set<string>([
  ...['Ctrl', 'Meta'].flatMap((m) => LETTRES_NATIVES.map((l) => `${m}+Key${l}`)),
  ...['Ctrl', 'Meta'].flatMap((m) => LETTRES_NATIVES_AVEC_MAJ.map((l) => `${m}+Shift+Key${l}`)),
  ...['KeyI', 'KeyJ', 'KeyC'].map((c) => `Alt+Meta+${c}`), // outils du développeur (Mac)
  'Meta+Space', // Spotlight
  'Ctrl+Space', // changement de clavier (Mac)
  'Alt+Space', // menu de la fenêtre (Windows)
  'Alt+Meta+Space', // recherche du Finder
  'Alt+F4', // fermer la fenêtre (Windows)
  'Ctrl+F4',
  'F5', // recharger
  'Ctrl+F5',
  'Shift+F5',
  'F11', // plein écran
  'F12', // outils du développeur
  'Meta+ArrowLeft', // précédent / début de ligne
  'Meta+ArrowRight',
  'Alt+ArrowLeft',
  'Alt+ArrowRight',
]);

/**
 * Pourquoi une forme ne peut PAS être retenue, en français simple — ou `null` si elle convient.
 */
export function raisonRaccourciRefuse(forme: string): string | null {
  const a = analyser(forme);
  if (a.genre === 'double') {
    return ORDRE.includes(a.code as Modificateur) ? null : 'Le double appui se fait sur Maj, Ctrl, Alt ou Cmd.';
  }
  if (a.genre === 'modificateurs') {
    return modsVers(a).length >= 2 ? null : 'Gardez au moins deux touches (Ctrl + Maj, par exemple) : une seule partirait toute seule.';
  }
  if (!toucheValide(a.code)) {
    return 'Choisissez une lettre, un chiffre, une touche F, Espace ou une flèche.';
  }
  const fonction = /^F\d+$/.test(a.code);
  if (!a.ctrl && !a.alt && !a.meta && !fonction) {
    return 'Ajoutez Ctrl, Alt ou Cmd : cette touche s’activerait en tapant.';
  }
  if (NATIFS.has(forme)) {
    return 'Ce raccourci appartient déjà au système ou au navigateur (copier, coller, onglets…).';
  }
  return null;
}

const NOMS: Record<Modificateur, { mac: string; autre: string }> = {
  Ctrl: { mac: '⌃', autre: 'Ctrl' },
  Alt: { mac: '⌥', autre: 'Alt' },
  Shift: { mac: '⇧', autre: 'Maj' },
  Meta: { mac: '⌘', autre: 'Cmd' },
};

function libelleTouche(code: string): string {
  const lettre = /^Key([A-Z])$/.exec(code);
  if (lettre) return lettre[1];
  const chiffre = /^Digit([0-9])$/.exec(code);
  if (chiffre) return chiffre[1];
  if (code === 'Space') return 'Espace';
  const fleche = /^Arrow(Up|Down|Left|Right)$/.exec(code);
  if (fleche) return { Up: '↑', Down: '↓', Left: '←', Right: '→' }[fleche[1] as 'Up' | 'Down' | 'Left' | 'Right'];
  return code; // F1…F24 se lisent déjà bien
}

/** La plateforme de l'appareil, pour écrire les touches comme on les voit sur le clavier. */
export type PlateformeClavier = 'mac' | 'autre';

/**
 * La forme écrite pour l'œil : « Ctrl + Maj + E », « Ctrl + Maj », « Maj Maj » ; sur Mac « ⌘ ⇧ E », « ⇧ ⇧ ».
 * Vide quand aucun raccourci n'est réglé.
 */
export function libelleDeRaccourci(forme: string | undefined | null, plateforme: PlateformeClavier = 'autre'): string {
  if (!forme || forme === AUCUN_RACCOURCI) return '';
  const a = analyser(forme);
  const nom = (m: Modificateur) => NOMS[m][plateforme];
  const sep = plateforme === 'mac' ? ' ' : ' + ';
  if (a.genre === 'double') {
    const m = a.code as Modificateur;
    return NOMS[m] ? `${nom(m)} ${nom(m)}` : a.code;
  }
  const parties = modsVers(a).map(nom);
  if (a.genre === 'combinaison') parties.push(libelleTouche(a.code));
  return parties.join(sep);
}

/**
 * LE RECONNAISSEUR : une petite machine à états qui reçoit chaque appui et chaque relâchement, et rend la forme
 * ACCOMPLIE par cet événement (ou `null`) :
 * - une combinaison, à l'appui de sa touche principale ;
 * - des modificateurs seuls (au moins deux), au relâchement du dernier, si aucune autre touche n'est passée entre-temps
 *   et si l'appui a duré moins de `MODIFICATEURS_SEULS_MS` ;
 * - un double appui, au relâchement du second appui bref sur le même modificateur, sans autre touche entre les deux.
 * L'auto-répétition est ignorée. `oublier()` repart de zéro (fenêtre quittée, touches perdues).
 */
export interface Reconnaisseur {
  recevoir(touche: ToucheVue): string | null;
  oublier(): void;
}

export function creerReconnaisseur(): Reconnaisseur {
  // Les modificateurs tenus en ce moment, et tous ceux de l'accord en cours.
  let tenus = new Set<Modificateur>();
  let accord = new Set<Modificateur>();
  let debutAccord = 0;
  let accordPollue = false;
  // L'appui solo en cours (un modificateur seul) et le dernier appui solo bref, pour le double appui.
  let solo: { m: Modificateur; t: number; pur: boolean } | null = null;
  let dernierSolo: { m: Modificateur; fin: number } | null = null;

  const oublier = () => {
    tenus = new Set();
    accord = new Set();
    debutAccord = 0;
    accordPollue = false;
    solo = null;
    dernierSolo = null;
  };

  const recevoir = (touche: ToucheVue): string | null => {
    if (touche.repeat) return null;
    const m = modificateurDuCode(touche.code);
    if (touche.type === 'down') {
      if (!m) {
        // Une vraie touche : elle annule l'accord et le double appui, et forme peut-être une combinaison.
        accordPollue = true;
        if (solo) solo.pur = false;
        dernierSolo = null;
        return construireForme(touche, touche.code);
      }
      if (!tenus.size) {
        accord = new Set();
        debutAccord = touche.t;
        accordPollue = false;
        solo = { m, t: touche.t, pur: true };
        // Un autre modificateur que celui du premier appui : pas de double appui.
        if (dernierSolo && (dernierSolo.m !== m || touche.t - dernierSolo.fin > DOUBLE_APPUI_MS)) dernierSolo = null;
      } else {
        if (solo) solo.pur = false;
        dernierSolo = null;
      }
      tenus.add(m);
      accord.add(m);
      return null;
    }
    // Relâchement.
    if (!m) return null;
    tenus.delete(m);
    if (tenus.size) return null;
    let accomplie: string | null = null;
    if (accord.size >= 2 && !accordPollue && touche.t - debutAccord <= MODIFICATEURS_SEULS_MS) {
      accomplie = `Mods:${ORDRE.filter((x) => accord.has(x)).join('+')}`;
    } else if (solo && solo.pur && solo.m === m && touche.t - solo.t <= DOUBLE_APPUI_MS) {
      if (dernierSolo && dernierSolo.m === m) {
        accomplie = `Double:${m}`;
        dernierSolo = null;
      } else {
        dernierSolo = { m, fin: touche.t };
      }
    } else {
      dernierSolo = null;
    }
    accord = new Set();
    solo = null;
    return accomplie;
  };

  return { recevoir, oublier };
}
