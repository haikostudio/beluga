/**
 * CE QUI PART VERS L'ÉCRAN PART COMPRESSÉ.
 *
 * Le démon servait ses réponses telles quelles : le paquet de l'application
 * (près de deux mégaoctets de scripts), les réponses JSON et chaque message du
 * canal temps réel descendaient octet pour octet. Sur un téléphone, le poids
 * est du temps : un tableau de quelques centaines de cartes mettait une
 * trentaine de secondes à se dessiner (`scripts/mesure-premier-affichage.mjs`).
 *
 * Cette règle dit QUAND compresser et AVEC QUOI : elle lit l'en-tête
 * `accept-encoding` du navigateur, le type du contenu et sa taille, et ne
 * choisit un encodage que s'il vaut la peine. Elle ne touche ni au réseau ni
 * au disque : elle se teste seule.
 *
 * Le canal WebSocket suit la même idée avec l'extension `permessage-deflate`,
 * négociée par le navigateur lui-même (`server/src/ws.ts`).
 */

export type Encodage = 'br' | 'gzip';

/**
 * En dessous, compresser coûte plus qu'il ne rapporte : l'en-tête ajouté et le
 * travail du processeur pèsent autant que les octets gagnés.
 */
export const SEUIL_COMPRESSION_OCTETS = 1024;

/**
 * Les contenus qui se compressent bien : du texte, sous toutes ses formes. Une
 * image ou une police déjà comprimée (`png`, `woff2`, `webp`) ne gagnerait
 * rien, et un flux audio non plus.
 */
const TYPES_COMPRESSIBLES = [
  /^text\//,
  /^application\/json/,
  /^application\/javascript/,
  /^text\/javascript/,
  /^application\/manifest\+json/,
  /^image\/svg\+xml/,
  /^application\/xml/,
];

export function typeCompressible(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const type = contentType.toLowerCase();
  return TYPES_COMPRESSIBLES.some((motif) => motif.test(type));
}

/**
 * L'encodage que le navigateur accepte, le meilleur d'abord : Brotli quand il
 * le sait lire (tous les navigateurs courants), gzip sinon. Un `q=0` est un
 * refus explicite et se respecte.
 */
export function encodageAccepte(acceptEncoding: string | undefined): Encodage | null {
  if (!acceptEncoding) return null;
  const acceptes = new Map<string, number>();
  for (const morceau of acceptEncoding.split(',')) {
    const [nomBrut, ...params] = morceau.trim().split(';');
    const nom = nomBrut.trim().toLowerCase();
    if (!nom) continue;
    let q = 1;
    for (const param of params) {
      const [cle, valeur] = param.trim().split('=');
      if (cle?.trim().toLowerCase() === 'q' && valeur !== undefined) {
        const lu = Number(valeur);
        if (Number.isFinite(lu)) q = lu;
      }
    }
    acceptes.set(nom, q);
  }
  const joker = acceptes.get('*') ?? 0;
  const accepte = (nom: Encodage) => (acceptes.has(nom) ? acceptes.get(nom)! > 0 : joker > 0);
  if (accepte('br')) return 'br';
  if (accepte('gzip')) return 'gzip';
  return null;
}

/**
 * Faut-il compresser cette réponse, et avec quoi ? `taille` est facultative :
 * un flux dont on ne connaît pas la longueur (un fichier servi au fil de l'eau)
 * se compresse dès que son type s'y prête.
 */
export function choisirEncodage(demande: {
  acceptEncoding: string | undefined;
  contentType: string | undefined;
  taille?: number;
}): Encodage | null {
  if (!typeCompressible(demande.contentType)) return null;
  if (demande.taille !== undefined && demande.taille < SEUIL_COMPRESSION_OCTETS) return null;
  return encodageAccepte(demande.acceptEncoding);
}
