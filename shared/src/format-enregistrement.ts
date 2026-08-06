/**
 * LE FORMAT D'ENREGISTREMENT DU MICRO — choisi, jamais imposé.
 *
 * Tous les navigateurs n'enregistrent pas dans le même format : Chrome et
 * Firefox savent produire du `audio/webm`, Safari (iPhone compris) ne le sait
 * PAS et refuse net l'enregistreur qu'on lui impose — l'erreur sort alors de
 * l'écoute et vide la page. On demande donc au navigateur ce qu'il ACCEPTE, et
 * l'on prend le premier format de la liste qu'il reconnaît ; s'il n'en
 * reconnaît aucun, ou s'il ne sait pas répondre à la question, on ne lui impose
 * RIEN et on le laisse choisir lui-même.
 *
 * Ce fichier ne connaît ni micro, ni navigateur : on lui passe la fonction qui
 * répond « ce format, oui ou non », donc il se rejoue seul, sans écran.
 *
 * Le format retenu emporte son EXTENSION : c'est elle qui part au serveur
 * (en-tête `x-audio-ext`) et qui nomme le fichier temporaire confié à la
 * transcription. Un son Safari nommé « .webm » se ferait mal lire.
 */

/** Un format d'enregistrement retenu : quoi imposer, et sous quel nom l'envoyer. */
export interface FormatEnregistrement {
  /**
   * Le type à imposer à l'enregistreur. `undefined` veut dire « laisse le
   * navigateur choisir » — le repli, jamais un échec.
   */
  mimeType?: string;
  /** L'extension du fichier envoyé au serveur : « webm », « mp4 », « ogg »… */
  extension: string;
}

/**
 * Les formats tentés, du plus répandu au plus rare. L'ordre compte : le premier
 * que le navigateur accepte est retenu. Opus d'abord (léger et bien transcrit),
 * puis les formats de la famille MP4, que Safari est seul à savoir produire.
 */
export const FORMATS_ENREGISTREMENT: readonly string[] = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/aac',
  'audio/mpeg',
];

/** L'extension employée quand le format n'est pas reconnu : la plus courante. */
export const EXTENSION_PAR_DEFAUT = 'webm';

/** Ce que vaut chaque famille de type, en extension de fichier. */
const EXTENSIONS: ReadonlyArray<[RegExp, string]> = [
  [/^webm/, 'webm'],
  [/^ogg|^x-ogg/, 'ogg'],
  [/^mp4$|^mp4;|^x-m4a|^m4a/, 'mp4'],
  [/^aac|^mp4a-latm/, 'aac'],
  [/^mpeg|^mp3|^x-mp3/, 'mp3'],
  [/^wav|^x-wav|^wave|^vnd\.wave/, 'wav'],
  [/^flac|^x-flac/, 'flac'],
  [/^3gpp/, '3gp'],
];

/**
 * L'extension qui va avec un type de son. Un type inconnu, vide ou absent rend
 * l'extension par défaut : on n'échoue pas sur un nom de fichier.
 */
export function extensionDuType(type?: string | null): string {
  const brut = String(type ?? '')
    .trim()
    .toLowerCase();
  if (!brut) return EXTENSION_PAR_DEFAUT;
  const sansPrefixe = brut.startsWith('audio/') ? brut.slice('audio/'.length) : brut;
  for (const [motif, extension] of EXTENSIONS) {
    if (motif.test(sansPrefixe)) return extension;
  }
  return EXTENSION_PAR_DEFAUT;
}

/**
 * Le format à employer pour enregistrer. `estAccepte` est la question posée au
 * navigateur (`MediaRecorder.isTypeSupported`) ; absente — vieux navigateur qui
 * ne sait pas répondre — on ne tente rien et l'on rend le repli.
 *
 * Le repli ne porte AUCUN `mimeType` : l'enregistreur est alors construit sans
 * option, ce qu'aucun navigateur ne refuse. L'extension réelle se relit ensuite
 * sur l'enregistreur lui-même (`extensionDuType(rec.mimeType)`).
 */
export function formatDEnregistrement(
  estAccepte?: ((type: string) => boolean) | null,
): FormatEnregistrement {
  if (typeof estAccepte !== 'function') return { extension: EXTENSION_PAR_DEFAUT };
  for (const type of FORMATS_ENREGISTREMENT) {
    let accepte = false;
    try {
      accepte = estAccepte(type) === true;
    } catch {
      // Un navigateur qui se fâche sur la question : on passe au suivant.
      accepte = false;
    }
    if (accepte) return { mimeType: type, extension: extensionDuType(type) };
  }
  return { extension: EXTENSION_PAR_DEFAUT };
}
