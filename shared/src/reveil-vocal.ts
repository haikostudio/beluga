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
 */

/**
 * Le mot de réveil, sous sa forme normalisée (accents et espaces retirés).
 * C'est cette forme-là que l'on compare, jamais le texte affiché.
 */
export const REVEIL_NORMALISE = 'dishaiko';

/**
 * Combien de lettres peuvent différer sans que le réveil soit manqué. Deux sur
 * huit : « dizaiko », « disaiko », « dishaikos » passent ; un mot ordinaire de
 * la conversation, non.
 */
export const REVEIL_ECART_MAX = 2;

/** Combien de mots consécutifs au plus forment le mot de réveil (« dis » + « haiko »). */
const REVEIL_MOTS_MAX = 2;

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
export function finDuReveil(texte: string): number {
  // On découpe le texte D'ORIGINE, puis on normalise chaque mot séparément :
  // l'index rendu compte donc des mots du texte brut, et ce qui suit le réveil
  // se retrouve sans décalage (« Dis Haiko, ouvre-le » ferait sinon quatre mots
  // normalisés pour trois mots dits).
  const mots = texte.trim().split(/\s+/).map((mot) => normaliserParole(mot).replace(/ /g, ''));
  if (mots.every((mot) => !mot)) return -1;
  for (let debut = 0; debut < mots.length; debut += 1) {
    let fenetre = '';
    for (let n = 0; n < REVEIL_MOTS_MAX && debut + n < mots.length; n += 1) {
      fenetre += mots[debut + n];
      if (!fenetre) continue;
      if (ecartDeMots(fenetre, REVEIL_NORMALISE, REVEIL_ECART_MAX) <= REVEIL_ECART_MAX) {
        return debut + n;
      }
    }
  }
  return -1;
}

/** Le mot de réveil est-il quelque part dans cette phrase ? */
export function contientLeReveil(texte: string): boolean {
  return finDuReveil(texte) >= 0;
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
export function lireParole(texte: string, ecouteEnCours: boolean): LectureDeParole {
  const brut = texte.trim();
  if (!brut) return { reveil: false, annulation: false, suite: '' };

  if (contientUneAnnulation(brut)) {
    return { reveil: false, annulation: true, suite: '' };
  }

  const fin = finDuReveil(brut);
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
