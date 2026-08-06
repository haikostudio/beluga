/**
 * LE RÉVEIL VOCAL — « Dis Haiko », puis on dicte.
 *
 * Le micro n'écoute que si l'utilisateur a allumé l'interrupteur ; ce qu'il
 * entend est transcrit par le chemin déjà en place (`/api/transcribe`) et
 * atterrit ICI, en texte. Ce fichier ne connaît ni micro, ni son, ni réseau :
 * il ne fait que LIRE des phrases et dire ce qu'elles veulent — c'est ce qui
 * le rend rejouable seul, sans navigateur.
 *
 * Deux gestes de parole seulement :
 *   — le MOT DE RÉVEIL (« Dis Haiko »), qui fait passer le module en écoute ;
 *   — l'ANNULATION (« Annule »), qui jette la phrase en cours.
 *
 * La transcription n'écrit jamais deux fois pareil : « Dis Haïko », « Dis,
 * Haiko », « Dit aïko », « Dishaiko » sont le même geste. On ne compare donc
 * pas des chaînes exactes mais des formes NORMALISÉES (sans accent, sans
 * ponctuation, sans majuscule), à une petite distance près.
 *
 * Et cela ne suffit pas. « Haiko » n'est pas un mot de la langue : le moteur de
 * transcription ne l'écrit JAMAIS ainsi. Mesuré sur le serveur, avec les trois
 * voix du projet dites au micro puis relues par Whisper : « D'y éco »,
 * « Dièco », « D'yko », « Ticot », « Dis et co », « 10 écho ». Aucune de ces
 * formes n'approche « dishaiko » à deux lettres près — le réveil ne partait
 * donc jamais. Passer à un modèle plus gros n'y change rien (« Dieko »).
 *
 * On compare donc AUSSI ce que ça SONNE : chaque mot est réduit à une forme
 * sonore grossière (`formeSonore`), à la française — h muet, consonne finale
 * muette, « ai » qui se dit « é », « c/qu/ch » qui se disent « k ». « Dis
 * Haiko » et « Dièco » y deviennent le même « dieko ». Les deux voies valent :
 * les lettres reconnaissent un mot bien écrit, le son rattrape le reste.
 */

/**
 * Le mot de réveil AFFICHÉ par défaut, tel qu'on l'écrit dans les réglages.
 * C'est la valeur de repli quand le champ des réglages est laissé vide.
 */
export const REVEIL_DEFAUT = 'Dis Haiko';

/**
 * Le mot de réveil par défaut, sous sa forme normalisée (accents, ponctuation
 * et espaces retirés). C'est cette forme-là que l'on compare, jamais le texte
 * affiché. Réglable : `formeDeReveil` en produit une à partir du mot choisi.
 */
export const REVEIL_NORMALISE = 'dishaiko';

/**
 * La forme normalisée du mot de réveil CHOISI : sans accent, sans ponctuation,
 * mots recollés (« Dis Haïko ! » → « dishaiko »). Un champ vide, ou fait de
 * seuls espaces, revient au mot par défaut plutôt que de couper le réveil.
 */
export function formeDeReveil(mot?: string | null): string {
  const forme = normaliserParole(mot ?? '').replace(/ /g, '');
  return forme || REVEIL_NORMALISE;
}

/**
 * Combien de lettres peuvent différer sans que le réveil soit manqué. La marge
 * n'est plus figée : elle suit la LONGUEUR du mot réglé — un quart de ses
 * lettres, au moins une. Le mot par défaut « dishaiko » (8 lettres) tolère
 * donc 2 écarts, un mot long en tolère davantage (« assistantvocal », 14
 * lettres → 4), un mot court une seule. Deux écarts sur huit, combinés à la
 * fenêtre de trois mots, rattrapent un nom découpé (« dis a ico ») sans laisser
 * passer une phrase ordinaire : « dis à Rico » (« disarico ») en est à trois.
 */
export function ecartDeReveil(forme: string): number {
  return Math.max(1, Math.round(forme.length / 4));
}

/**
 * La marge de la comparaison SONORE. Plus SERRÉE que celle des lettres (un
 * cinquième au lieu d'un quart) : la réduction a déjà absorbé les écarts
 * d'orthographe, une marge large ferait passer n'importe quel mot voisin —
 * « Rico », « Nico », « disque » sont à deux sons de « dieko ».
 */
export function ecartSonore(forme: string): number {
  return Math.max(1, Math.round(forme.length / 5));
}

/**
 * Les deux façons de reconnaître le mot de réveil : par ses LETTRES et par son
 * SON. Elles se calculent ensemble à partir du mot réglé, car la forme sonore a
 * besoin de la coupure des MOTS (le « s » de « dis » est muet parce qu'il est
 * en fin de mot ; recollé en « dishaiko », il ne le serait plus).
 */
export interface FormesDeReveil {
  /** Le mot réglé, normalisé et recollé : « dishaiko ». */
  ecrite: string;
  /** Ce que le mot réglé sonne, mot à mot puis recollé : « dieko ». */
  sonore: string;
}

/** Les deux formes du mot de réveil choisi. Un champ vide revient au défaut. */
export function formesDeReveil(mot?: string | null): FormesDeReveil {
  const brut = (mot ?? '').trim();
  const ecrite = formeDeReveil(brut);
  return { ecrite, sonore: formeSonore(brut) || formeSonore(REVEIL_DEFAUT) };
}

/**
 * Ce qu'un appelant a donné, ramené aux deux formes. Une simple chaîne est
 * comprise comme la forme ÉCRITE (elle est déjà recollée : sa forme sonore
 * garde donc les consonnes du milieu, faute de savoir où les mots s'arrêtent).
 */
function resoudreFormes(forme?: string | FormesDeReveil): FormesDeReveil {
  if (!forme) return formesDeReveil(REVEIL_DEFAUT);
  if (typeof forme !== 'string') return forme;
  return { ecrite: forme || REVEIL_NORMALISE, sonore: formeSonore(forme) };
}

/**
 * Les nombres que la transcription écrit en CHIFFRES alors qu'ils s'entendent
 * comme des mots. « Dis » s'entend « dix » : le moteur écrit alors « 10 écho »
 * pour « Dis Haiko ». Sans cette table, ce réveil-là passerait à travers.
 */
const NOMBRES_DITS: Record<string, string> = {
  '0': 'zero', '1': 'un', '2': 'deux', '3': 'trois', '4': 'quatre', '5': 'cinq',
  '6': 'six', '7': 'sept', '8': 'huit', '9': 'neuf', '10': 'dix', '11': 'onze',
  '12': 'douze', '13': 'treize', '14': 'quatorze', '15': 'quinze', '16': 'seize',
  '20': 'vingt', '100': 'cent',
};

/**
 * UN mot ramené à ce qu'il sonne, à la française. Rien d'une vraie phonétique :
 * juste assez de règles pour que deux orthographes du même son se rejoignent.
 * Un mot qui s'effacerait entièrement garde sa première lettre.
 */
function motSonore(mot: string): string {
  if (!mot) return '';
  const reduit = (NOMBRES_DITS[mot] ?? mot)
    // Le son « f » : « ph » comme « f ». Avant que le « h » ne disparaisse.
    .replace(/ph/g, 'f')
    // Le son « k » : « ch » (écho, chorale), « qu », « q », « c » dur.
    .replace(/ch/g, 'k')
    .replace(/qu/g, 'k')
    .replace(/q/g, 'k')
    .replace(/c([eiy])/g, 's$1')
    .replace(/c/g, 'k')
    .replace(/g([eiy])/g, 'j$1')
    // Le « h » ne s'entend pas ; « y » se dit « i ».
    .replace(/h/g, '')
    .replace(/y/g, 'i')
    // Les voyelles composées, de la plus longue à la plus courte.
    .replace(/eau/g, 'o')
    .replace(/au/g, 'o')
    .replace(/ai|ei/g, 'e')
    .replace(/ou/g, 'u')
    .replace(/oi/g, 'wa')
    .replace(/eu|oe/g, 'e')
    // « s » et « z » se confondent à l'oreille ; une lettre doublée s'entend une fois.
    .replace(/z/g, 's')
    .replace(/(.)\1+/g, '$1')
    // Le « e » final ne se dit pas, ni la consonne finale qui le suivait.
    .replace(/e$/, '')
    .replace(/[stdxpgz]$/, '');
  return reduit || mot[0];
}

/**
 * Ce qu'un texte SONNE : chaque mot réduit, puis recollé sans espace. C'est
 * cette forme-là que l'on compare quand les lettres ne suffisent plus.
 */
export function formeSonore(texte: string): string {
  return normaliserParole(texte).split(' ').map(motSonore).join('');
}

/**
 * Combien de mots consécutifs au plus forment le mot de réveil. Trois : « dis »
 * + « haiko » arrive parfois découpé en trois morceaux par la transcription
 * (« dis a ico »), et l'on veut le rattraper.
 */
const REVEIL_MOTS_MAX = 3;

/** Les mots qui jettent la phrase en cours, sous forme normalisée. */
export const MOTS_ANNULATION = ['annule', 'annuler', 'annulation', 'laissetomber', 'oublie'];

/**
 * Le silence, en millisecondes, qui clôt une dictée. Deux secondes : le temps
 * de reprendre son souffle sans que la phrase parte trop tôt.
 */
export const SILENCE_FIN_MS = 2000;

/**
 * Combien de temps la phrase reconnue reste AFFICHÉE avant de partir. Deux
 * secondes de relecture : de quoi la lire, et de quoi l'annuler d'un clic.
 */
export const RELECTURE_MS = 2000;

/**
 * Ce que le module fait à l'instant :
 *   — `eteinte` : l'interrupteur est éteint, aucun micro ouvert ;
 *   — `guette`  : le micro est ouvert, on n'attend QUE le mot de réveil ;
 *   — `ecoute`  : le mot de réveil est passé, on recueille la phrase ;
 *   — `relit`   : la phrase est complète et s'affiche avant de partir ;
 *   — `refusee` : le navigateur a refusé le micro, on le dit à l'écran.
 */
export type EtatEcoute = 'eteinte' | 'guette' | 'ecoute' | 'relit' | 'refusee';

/** Ce qu'une phrase entendue veut dire, une fois lue par les règles d'ici. */
export interface LectureDeParole {
  /** Le mot de réveil a-t-il été reconnu dans cette phrase ? */
  reveil: boolean;
  /** Une annulation a-t-elle été prononcée ? */
  annulation: boolean;
  /**
   * Ce qui reste à dicter : la suite du mot de réveil quand il est reconnu au
   * milieu d'une phrase (« Dis Haiko ouvre le tableau » → « ouvre le tableau »),
   * la phrase entière quand on écoutait déjà, vide quand rien n'est dit.
   */
  suite: string;
}

/**
 * Le texte débarrassé de ce qui ne s'entend pas : majuscules, accents,
 * ponctuation. « Dis, Haïko ! » et « dis haiko » deviennent la même chose.
 */
export function normaliserParole(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * De combien de lettres deux mots diffèrent (insertion, retrait, échange). On
 * s'arrête net au-delà de la marge autorisée : inutile de mesurer la distance
 * exacte entre « haiko » et une phrase entière.
 */
export function ecartDeMots(a: string, b: string, marge: number): number {
  if (Math.abs(a.length - b.length) > marge) return marge + 1;
  let precedente = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const courante = [i];
    let meilleure = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cout = a[i - 1] === b[j - 1] ? 0 : 1;
      const valeur = Math.min(
        precedente[j] + 1,
        courante[j - 1] + 1,
        precedente[j - 1] + cout,
      );
      courante.push(valeur);
      if (valeur < meilleure) meilleure = valeur;
    }
    // Toute la ligne est déjà au-delà de la marge : la suite ne redescendra pas.
    if (meilleure > marge) return marge + 1;
    precedente = courante;
  }
  return precedente[b.length];
}

/**
 * Où se termine le mot de réveil dans la phrase, ou `-1` s'il n'y est pas. On
 * fait glisser une fenêtre d'un ou deux mots — « dis haiko » peut arriver collé
 * (« dishaiko ») ou séparé — et l'on compare la fenêtre, espaces retirés, au
 * mot de réveil. Le réveil est reconnu où qu'il soit dans la phrase : au début
 * comme au milieu, ce qui suit devient la dictée.
 */
export function finDuReveil(texte: string, forme?: string | FormesDeReveil): number {
  const formes = resoudreFormes(forme);
  const cible = formes.ecrite || REVEIL_NORMALISE;
  const marge = ecartDeReveil(cible);
  const margeSon = ecartSonore(formes.sonore);
  // On découpe le texte D'ORIGINE, puis on normalise chaque mot séparément :
  // l'index rendu compte donc des mots du texte brut, et ce qui suit le réveil
  // se retrouve sans décalage (« Dis Haiko, ouvre-le » ferait sinon quatre mots
  // normalisés pour trois mots dits).
  const mots = texte.trim().split(/\s+/).map((mot) => normaliserParole(mot).replace(/ /g, ''));
  // Ce que chaque mot SONNE, réduit un par un : c'est la coupure des mots qui
  // fait taire le « s » de « dis », donc on ne recolle qu'après.
  const sons = mots.map(motSonore);
  if (mots.every((mot) => !mot)) return -1;
  for (let debut = 0; debut < mots.length; debut += 1) {
    let fenetre = '';
    let son = '';
    for (let n = 0; n < REVEIL_MOTS_MAX && debut + n < mots.length; n += 1) {
      fenetre += mots[debut + n];
      son += sons[debut + n];
      if (!fenetre) continue;
      // Les LETTRES d'abord — un mot bien écrit se reconnaît tel quel —, le SON
      // ensuite, pour tout ce que la transcription a écrit à sa façon.
      if (ecartDeMots(fenetre, cible, marge) <= marge) return debut + n;
      if (son && formes.sonore && ecartDeMots(son, formes.sonore, margeSon) <= margeSon) {
        return debut + n;
      }
    }
  }
  return -1;
}

/** Le mot de réveil est-il quelque part dans cette phrase ? */
export function contientLeReveil(texte: string, forme?: string | FormesDeReveil): boolean {
  return finDuReveil(texte, forme) >= 0;
}

/**
 * Une annulation a-t-elle été prononcée ? On juge sur les mots entiers, à la
 * même petite distance : « annule » compte, « annuellement » non.
 */
export function contientUneAnnulation(texte: string): boolean {
  const normalise = normaliserParole(texte);
  if (!normalise) return false;
  const mots = normalise.split(' ');
  return mots.some((mot, i) => {
    const colle = mot + (mots[i + 1] ?? '');
    return MOTS_ANNULATION.some(
      (attendu) =>
        mot === attendu ||
        colle === attendu ||
        // Une lettre de travers suffit à tolérer une transcription approximative.
        (mot.length >= 5 && ecartDeMots(mot, attendu, 1) <= 1),
    );
  });
}

/**
 * Lire une phrase entendue, selon que l'on GUETTE le mot de réveil ou qu'on
 * ÉCOUTE déjà la dictée.
 *
 *   — en guet, seule une phrase portant le mot de réveil compte ; ce qui suit
 *     ce mot amorce la dictée (« Dis Haiko ouvre le tableau ») ;
 *   — en écoute, tout ce qui est dit s'ajoute à la phrase, sauf une annulation.
 *
 * Une phrase vide ne dit rien, jamais un réveil.
 */
export function lireParole(
  texte: string,
  ecouteEnCours: boolean,
  forme?: string | FormesDeReveil,
): LectureDeParole {
  const brut = texte.trim();
  if (!brut) return { reveil: false, annulation: false, suite: '' };

  if (contientUneAnnulation(brut)) {
    return { reveil: false, annulation: true, suite: '' };
  }

  const fin = finDuReveil(brut, forme);
  if (fin >= 0) {
    // Ce qui suit le mot de réveil, dans le texte D'ORIGINE (ponctuation et
    // accents compris) : c'est lui qu'on affichera et qu'on enverra.
    return { reveil: true, annulation: false, suite: suiteApresMots(brut, fin + 1) };
  }

  if (ecouteEnCours) return { reveil: false, annulation: false, suite: brut };
  return { reveil: false, annulation: false, suite: '' };
}

/**
 * Ce qui reste du texte D'ORIGINE après les `n` premiers mots. On recompte les
 * mots sur le texte brut : la normalisation sert à RECONNAÎTRE, jamais à
 * remplacer ce que l'utilisateur a dit.
 */
function suiteApresMots(texte: string, n: number): string {
  const mots = texte.trim().split(/\s+/);
  return mots
    .slice(n)
    .join(' ')
    // Une phrase qui commence par une virgule ou un point vient d'être coupée
    // juste après le mot de réveil : on nettoie ce reste de ponctuation.
    .replace(/^[\s,.;:!?—-]+/, '')
    .trim();
}

/**
 * Le texte dicté jusqu'ici, augmenté de ce qui vient d'être entendu. Les
 * morceaux se recollent avec une espace, jamais collés bout à bout.
 */
export function assemblerDictee(deja: string, ajout: string): string {
  const a = deja.trim();
  const b = ajout.trim();
  if (!a) return b;
  if (!b) return a;
  return `${a} ${b}`;
}

/**
 * Le message affiché quand le navigateur refuse le micro. Une phrase, en
 * français simple : on ne laisse jamais l'écoute échouer en silence.
 */
export const REFUS_MICRO =
  'Micro refusé par le navigateur : autorisez-le pour l’écoute permanente.';

/**
 * Le message affiché quand le navigateur SAIT ouvrir le micro mais ne sait pas
 * l'enregistrer — aucun format commun, enregistreur absent. L'écoute s'éteint
 * proprement au lieu de laisser un micro ouvert qui n'envoie jamais rien.
 */
export const ENREGISTREMENT_IMPOSSIBLE =
  'Ce navigateur ne sait pas enregistrer le micro : l’écoute permanente n’est pas disponible ici.';

/**
 * Le message affiché quand le son du navigateur ne s'ouvre pas : sans lui, on
 * ne mesure plus le volume, donc on ne sait plus où finissent les phrases.
 */
export const SON_INDISPONIBLE =
  'Le son du navigateur n’a pas pu s’ouvrir : l’écoute permanente n’est pas disponible ici.';

/**
 * Le micro fonctionne, mais le SERVEUR ne rend rien de ce qu'il entend : moteur
 * de transcription absent, en panne, ou injoignable. La phrase le DIT — une
 * écoute qui ne comprendra jamais rien ne doit pas se taire poliment. La raison
 * du serveur est reprise telle quelle quand il en donne une.
 */
export function phraseDEchecTranscription(raison?: string | null): string {
  const detail = (raison ?? '').trim();
  const debut = 'Le micro écoute, mais le serveur ne transcrit pas';
  const fin = ' — rien de ce qui est dit ne sera compris.';
  return detail ? `${debut} (${detail})${fin}` : `${debut}${fin}`;
}
