/**
 * UN LIEN DU TEXTE D'UN AGENT QUI MÈNE À UN MÉDIA S'OUVRE DANS L'APERÇU, JAMAIS DANS UN ONGLET (03/11/2026).
 *
 * Constat : dans la conversation d'un chef de marque, ses visuels (`![…](piece:…)`) et les liens vers ses fichiers
 * ouvraient un nouvel onglet du navigateur. La règle : une pièce jointe, une image d'étape, un fichier cité, ou toute
 * adresse qui finit par une extension d'image, de vidéo, de son ou de PDF est un MÉDIA — il s'ouvre dans la
 * visionneuse de l'application. Un lien vers un SITE (page, dépôt, documentation) garde l'onglet.
 */

export type GenreDuMediaDuLien = 'image' | 'video' | 'son' | 'pdf' | 'inconnu';

export interface MediaDuLien {
  /** L'adresse à montrer, telle que le texte la donne. */
  adresse: string;
  /** La pièce jointe désignée, quand l'adresse en nomme une. */
  piece: string | null;
  /** Le genre deviné par l'extension ; `inconnu` pour une pièce sans extension lisible. */
  genre: GenreDuMediaDuLien;
  /** Le nom à afficher : le dernier morceau du chemin. */
  nom: string;
}

const EXTENSIONS: Readonly<Record<string, Exclude<GenreDuMediaDuLien, 'inconnu'>>> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', avif: 'image', svg: 'image',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video',
  mp3: 'son', wav: 'son', ogg: 'son', m4a: 'son', aac: 'son', flac: 'son', opus: 'son',
  pdf: 'pdf',
};

/** Les routes de l'application qui servent un fichier à montrer. */
const ROUTES_DE_MEDIA = ['/api/attachment', '/api/capture', '/api/fichier-cite'];

function genreDeLExtension(chemin: string): GenreDuMediaDuLien {
  const point = chemin.lastIndexOf('.');
  if (point < 0 || point < chemin.lastIndexOf('/')) return 'inconnu';
  return EXTENSIONS[chemin.slice(point + 1).toLowerCase()] ?? 'inconnu';
}

/**
 * Le média que désigne un lien, ou `null` quand c'est un lien ordinaire (un site, une ancre, un courriel).
 * Une adresse d'un autre site n'est un média que pour une image, une vidéo ou un son : un PDF lointain garde
 * l'onglet (beaucoup de sites interdisent qu'on les montre dans un cadre).
 */
export function mediaDuLien(href: string | null | undefined, origine = 'http://localhost'): MediaDuLien | null {
  const brut = (href ?? '').trim();
  if (!brut || brut.startsWith('#') || /^(mailto|tel|javascript):/i.test(brut)) return null;
  if (brut.startsWith('piece:')) {
    const piece = brut.slice('piece:'.length).trim();
    return piece ? { adresse: `/api/attachment?id=${encodeURIComponent(piece)}`, piece, genre: 'inconnu', nom: piece } : null;
  }
  let url: URL;
  try {
    url = new URL(brut, origine);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const ici = url.origin === new URL(origine).origin;
  const nomDuChemin = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '');
  if (ici && ROUTES_DE_MEDIA.includes(url.pathname)) {
    const piece = url.pathname === '/api/attachment' ? url.searchParams.get('id') : null;
    const chemin = url.searchParams.get('path') ?? '';
    const nom = chemin ? (chemin.split('/').filter(Boolean).pop() ?? chemin) : (url.searchParams.get('name') ?? piece ?? nomDuChemin);
    return { adresse: ici ? `${url.pathname}${url.search}` : url.href, piece, genre: chemin ? genreDeLExtension(chemin) : 'inconnu', nom };
  }
  const genre = genreDeLExtension(url.pathname);
  if (genre === 'inconnu') return null;
  if (!ici && genre === 'pdf') return null;
  return { adresse: ici ? `${url.pathname}${url.search}` : url.href, piece: null, genre, nom: nomDuChemin };
}

/** Le type de contenu à supposer pour un genre deviné, quand le serveur n'a pas encore été interrogé. */
export function mimeDuGenre(genre: GenreDuMediaDuLien, nom = ''): string {
  const ext = nom.slice(nom.lastIndexOf('.') + 1).toLowerCase();
  if (genre === 'image') return ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext || 'png'}`;
  if (genre === 'video') return ext === 'webm' ? 'video/webm' : ext === 'mov' ? 'video/quicktime' : 'video/mp4';
  if (genre === 'son') return ext === 'wav' ? 'audio/wav' : ext === 'ogg' || ext === 'opus' ? 'audio/ogg' : 'audio/mpeg';
  if (genre === 'pdf') return 'application/pdf';
  return 'application/octet-stream';
}
