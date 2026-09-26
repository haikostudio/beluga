/**
 * UNE DÉPENDANCE DÉCLARÉE MAIS JAMAIS INSTALLÉE.
 *
 * La publication ne lançait `npm install` que si `tsc` ou `vite` manquaient.
 * Une carte qui AJOUTE une bibliothèque (`yazl`, `yauzl` et leurs types, le
 * 10/09/2026) la déclare dans son `package.json` et dans le verrou : fusionnée,
 * elle arrive dans le dossier du projet où `node_modules` ne la connaît pas.
 * Les outils étant là, rien n'installait — et la compilation tombait sur
 * « Cannot find module 'yazl' », une panne qui n'a rien à voir avec le code.
 *
 * On relève donc les noms que les manifestes DÉCLARENT, puis ceux qui n'ont
 * aucun dossier dans `node_modules`. Ces règles sont pures : on leur passe les
 * manifestes déjà lus et la façon de savoir si un nom est présent.
 */

interface Manifeste {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** Les noms déclarés par un ensemble de manifestes, sans doublon, triés. */
export function dependancesDeclarees(manifestes: unknown[]): string[] {
  const noms = new Set<string>();
  for (const brut of manifestes) {
    if (!brut || typeof brut !== 'object') continue;
    const manifeste = brut as Manifeste;
    for (const bloc of [manifeste.dependencies, manifeste.devDependencies]) {
      if (!bloc || typeof bloc !== 'object') continue;
      for (const nom of Object.keys(bloc)) noms.add(nom);
    }
  }
  return [...noms].sort();
}

/** Les noms déclarés qu'aucun `node_modules` ne porte : il faut installer. */
export function dependancesAbsentes(manifestes: unknown[], estPresente: (nom: string) => boolean): string[] {
  return dependancesDeclarees(manifestes).filter((nom) => !estPresente(nom));
}

/** Ce que la publication écrit dans son détail avant de construire. */
export function recitDePoseDesDependances(manquants: string[], reussie: boolean): string {
  const liste = manquants.join(', ');
  return reussie
    ? `Dépendances absentes (${liste}) : installées avant de construire.\n\n`
    : `Dépendances absentes (${liste}) et leur installation a échoué :\n`;
}
