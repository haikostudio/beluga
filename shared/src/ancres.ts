/**
 * Les ancres de fichiers dans le texte du composeur.
 *
 * Quand on joint un fichier alors que le curseur est posé quelque part dans
 * le texte, une ancre « [fichier: capture.png] » s'écrit À CET ENDROIT. Elle
 * part telle quelle dans le message : l'agent sait ainsi à quel paragraphe se
 * rapporte quel fichier.
 *
 * Le texte et la liste des pièces jointes ne doivent JAMAIS se contredire :
 * retirer un fichier retire son ancre, effacer une ancre retire le fichier.
 * Toutes ces décisions vivent ici, sans React ni réseau : elles se testent
 * seules.
 */

/** Le texte exact d'une ancre, tel qu'il apparaît dans le message. */
export function ancre(nom: string): string {
  return `[fichier: ${nom}]`;
}

/** Combien de fois cette ancre apparaît dans le texte. */
export function compteAncres(texte: string, nom: string): number {
  const marque = ancre(nom);
  if (!marque) return 0;
  let total = 0;
  let depuis = 0;
  for (;;) {
    const trouve = texte.indexOf(marque, depuis);
    if (trouve === -1) return total;
    total += 1;
    depuis = trouve + marque.length;
  }
}

/**
 * Poser une ancre. Sans curseur connu (dépôt sur la zone, collage), elle
 * s'ajoute à la fin, comme avant. Avec un curseur, elle se glisse à sa place,
 * entourée des espaces qui manquent pour ne pas coller au mot d'à côté.
 */
export function insereAncre(
  texte: string,
  nom: string,
  curseur: number | null,
): { texte: string; curseur: number } {
  const marque = ancre(nom);

  if (curseur === null || curseur < 0 || curseur > texte.length) {
    const separateur = !texte ? '' : /\s$/.test(texte) ? '' : ' ';
    const suite = `${texte}${separateur}${marque}`;
    return { texte: suite, curseur: suite.length };
  }

  const avant = texte.slice(0, curseur);
  const apres = texte.slice(curseur);
  const espaceAvant = !avant || /\s$/.test(avant) ? '' : ' ';
  const espaceApres = !apres || /^\s/.test(apres) ? '' : ' ';
  const morceau = `${espaceAvant}${marque}${espaceApres}`;
  return { texte: `${avant}${morceau}${apres}`, curseur: curseur + morceau.length };
}

/**
 * Où commence la N-ième ancre de ce nom (0 = la première). -1 si elle
 * n'existe pas : on ne suppose jamais qu'elle est encore dans le texte.
 */
export function indexDeLAncre(texte: string, nom: string, occurrence: number): number {
  const marque = ancre(nom);
  if (occurrence < 0) return -1;
  let index = -1;
  let depuis = 0;
  for (let i = 0; i <= occurrence; i += 1) {
    index = texte.indexOf(marque, depuis);
    if (index === -1) return -1;
    depuis = index + marque.length;
  }
  return index;
}

/** Retirer l'ancre à cet index, en ramassant l'espace devenu inutile. */
function retireAncreA(texte: string, debut: number, longueur: number): { texte: string; coupe: number } {
  const avant = texte.slice(0, debut);
  const apres = texte.slice(debut + longueur);
  if (/\s$/.test(avant) && /^[^\S\n]/.test(apres)) {
    const espaces = (apres.match(/^[^\S\n]+/) ?? [''])[0].length;
    return { texte: avant + apres.slice(espaces), coupe: longueur + espaces };
  }
  return { texte: avant + apres, coupe: longueur };
}

/**
 * Retirer UNE occurrence de l'ancre (la dernière), en ramassant l'espace
 * devenu inutile. Les autres ancres du même nom restent : un même fichier
 * peut être cité deux fois.
 */
export function retireAncre(texte: string, nom: string): string {
  const marque = ancre(nom);
  const trouve = texte.lastIndexOf(marque);
  if (trouve === -1) return texte;
  return retireAncreA(texte, trouve, marque.length).texte;
}

/**
 * Retirer l'occurrence PRÉCISE d'une ancre (celle du drapeau cliqué), sans
 * toucher aux autres mots ni aux autres citations du même fichier.
 */
export function retireOccurrence(texte: string, nom: string, occurrence: number): string {
  const marque = ancre(nom);
  const debut = indexDeLAncre(texte, nom, occurrence);
  if (debut === -1) return texte;
  return retireAncreA(texte, debut, marque.length).texte;
}

/**
 * Glisser une ancre ailleurs dans la phrase. Lâchée sur elle-même, elle ne
 * bouge pas. Le compte des ancres ne change pas : les pièces jointes restent.
 */
export function deplacerAncre(
  texte: string,
  nom: string,
  occurrence: number,
  vers: number,
): { texte: string; curseur: number } {
  const marque = ancre(nom);
  const debut = indexDeLAncre(texte, nom, occurrence);
  if (debut === -1) return { texte, curseur: Math.max(0, Math.min(vers, texte.length)) };
  const fin = debut + marque.length;
  const vise = Math.max(0, Math.min(vers, texte.length));
  if (vise >= debut && vise <= fin) return { texte, curseur: fin };

  const { texte: sans, coupe } = retireAncreA(texte, debut, marque.length);
  const viseAjuste = vise > debut ? Math.max(0, Math.min(vise - coupe, sans.length)) : vise;
  return insereAncre(sans, nom, viseAjuste);
}

/**
 * Ce qui reste des pièces jointes après une frappe. Une ancre effacée à la
 * main retire son fichier ; un fichier sans ancre du tout (joint avant cette
 * mécanique, ou ancre jamais posée) n'est jamais emporté par erreur.
 */
export function jointesApresFrappe<T extends { name: string }>(
  jointes: readonly T[],
  avant: string,
  apres: string,
): T[] {
  const aRetirer = new Map<string, number>();
  for (const nom of new Set(jointes.map((j) => j.name))) {
    const perdu = compteAncres(avant, nom) - compteAncres(apres, nom);
    if (perdu > 0) aRetirer.set(nom, perdu);
  }
  if (!aRetirer.size) return [...jointes];

  // On enlève les derniers joints d'abord : le plus récent est le plus
  // probablement celui dont on vient d'effacer l'ancre.
  const garde: T[] = [];
  for (let i = jointes.length - 1; i >= 0; i -= 1) {
    const item = jointes[i]!;
    const reste = aRetirer.get(item.name) ?? 0;
    if (reste > 0) {
      aRetirer.set(item.name, reste - 1);
      continue;
    }
    garde.unshift(item);
  }
  return garde;
}

/**
 * Réordonner la liste des pièces jointes après un glissement : l'ordre choisi
 * dans la barre d'écriture est celui envoyé avec le message. Les ancres dans
 * le texte ne bougent pas — seul l'ordre d'ENVOI change.
 */
export function deplacerJointe<T>(jointes: readonly T[], depuis: number, vers: number): T[] {
  if (
    depuis === vers ||
    depuis < 0 ||
    vers < 0 ||
    depuis >= jointes.length ||
    vers >= jointes.length
  ) {
    return [...jointes];
  }
  const copie = [...jointes];
  const [item] = copie.splice(depuis, 1);
  copie.splice(vers, 0, item as T);
  return copie;
}
