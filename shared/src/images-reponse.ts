/**
 * Répondre à la question d'un agent AVEC DES PIÈCES JOINTES.
 *
 * Le champ de réponse accepte des images ET, depuis le cahier des charges
 * (09.10.2026), tout autre fichier — bouton, collage, glisser-déposer : une
 * maquette en PDF, une charte, un logo vectoriel répondent mieux qu'un
 * paragraphe. Le fichier part à l'agent par son chemin, comme une image.
 * `estImage` reste utile à l'affichage (vignette ou simple nom). Les règles
 * ci-dessous sont pures : ni base ni disque, et se rejouent seules.
 */

/** Ce qu'on sait d'un fichier avant de l'envoyer : son nom et son type. */
export interface FichierChoisi {
  name: string;
  mime?: string;
}

const EXTENSIONS_IMAGE = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.bmp',
  '.svg',
  '.heic',
  '.heif',
];

/**
 * Une image se reconnaît d'abord à son type déclaré ; le navigateur laisse
 * parfois ce type vide (fichier glissé depuis certaines applications), et
 * l'extension du nom prend alors le relais.
 */
export function estImage(fichier: FichierChoisi): boolean {
  const mime = (fichier.mime ?? '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  if (mime && mime !== 'application/octet-stream') return false;
  const nom = (fichier.name ?? '').toLowerCase();
  return EXTENSIONS_IMAGE.some((ext) => nom.endsWith(ext));
}

/**
 * Sépare ce qu'on garde de ce qu'on refuse. Le refus se DIT à l'utilisateur :
 * un fichier lâché sur le champ et silencieusement ignoré passerait pour un
 * envoi réussi.
 */
export function triImages<T extends FichierChoisi>(fichiers: T[]): { gardees: T[]; refusees: T[] } {
  const gardees: T[] = [];
  const refusees: T[] = [];
  for (const fichier of fichiers) (estImage(fichier) ? gardees : refusees).push(fichier);
  return { gardees, refusees };
}

/**
 * Le texte de la réponse. Les choix cochés et la précision libre gardent leur
 * forme d'avant ; les images s'y AJOUTENT, elles ne remplacent jamais un choix.
 * Une image seule suffit à répondre : sans cette mention, la réponse serait
 * vide et la question resterait ouverte.
 */
export function texteDeReponse(libelles: string[], complement: string, nbPieces: number): string {
  const morceaux = [libelles.join(', '), complement.trim()].filter(Boolean);
  if (nbPieces === 1) morceaux.push('1 pièce jointe');
  else if (nbPieces > 1) morceaux.push(`${nbPieces} pièces jointes`);
  return morceaux.join(' — ');
}

/** La question peut-elle partir ? Un choix, un mot ou une image suffit. */
export function reponsePrete(libelles: string[], complement: string, nbImages: number): boolean {
  return texteDeReponse(libelles, complement, nbImages).length > 0;
}
