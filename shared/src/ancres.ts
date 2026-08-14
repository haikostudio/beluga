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
 * Retirer UNE occurrence de l'ancre (la dernière), en ramassant l'espace
 * devenu inutile. Les autres ancres du même nom restent : un même fichier
 * peut être cité deux fois.
 */
export function retireAncre(texte: string, nom: string): string {
  const marque = ancre(nom);
  const trouve = texte.lastIndexOf(marque);
  if (trouve === -1) return texte;
  const avant = texte.slice(0, trouve);
  const apres = texte.slice(trouve + marque.length);
  // Un seul espace subsiste entre les deux morceaux recollés.
  if (/\s$/.test(avant) && /^[^\S\n]/.test(apres)) return avant + apres.replace(/^[^\S\n]+/, '');
  return avant + apres;
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
