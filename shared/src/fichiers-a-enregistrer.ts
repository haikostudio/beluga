/**
 * QUELS FICHIERS L'ÉTAPE « ENREGISTREMENT » DOIT AJOUTER, UN PAR UN.
 *
 * Le dossier d'un projet est PARTAGÉ (chef d'orchestre, analyse, publication) :
 * un `git add -A` y emporterait le travail qu'un autre agent est en train d'y
 * déposer. La règle vaut déjà pour la fusion d'un conflit
 * (`recollerLaDocumentation`, `server/src/deploy.ts`) ; elle vaut tout autant
 * pour l'étape qui enregistre le lot avant de le pousser — y compris quand le
 * rangement de nuit de la mémoire (`docs/memoire/`) a renommé, supprimé ou créé
 * des fichiers pendant que la publication tournait.
 *
 * Règle PURE : elle lit la sortie de `git status --porcelain`, jamais le
 * disque ni git lui-même — l'appelant fait la commande et lui passe le texte.
 */

/**
 * La liste des chemins à passer à `git add --`, dans l'ordre où ils
 * apparaissent. Une ligne de renommage (`ancien -> nouveau`) rend les DEUX
 * chemins : l'ancien pour enregistrer sa disparition, le nouveau pour son
 * arrivée — `git status --porcelain` ne détecte un renommage que rarement,
 * et jamais entre l'index et l'arbre de travail sans réglage particulier,
 * mais le cas se traite sans risque quand il se présente.
 */
export function fichiersAAjouter(porcelain: string): string[] {
  const fichiers: string[] = [];
  const vus = new Set<string>();
  const ajouter = (chemin: string) => {
    if (chemin && !vus.has(chemin)) {
      vus.add(chemin);
      fichiers.push(chemin);
    }
  };

  for (const ligneBrute of porcelain.split('\n')) {
    const ligne = ligneBrute.replace(/\r$/, '');
    if (ligne.length <= 3) continue;
    const chemin = ligne.slice(3).trim();
    if (!chemin) continue;
    const fleche = chemin.indexOf(' -> ');
    if (fleche === -1) {
      ajouter(chemin);
    } else {
      ajouter(chemin.slice(0, fleche));
      ajouter(chemin.slice(fleche + 4));
    }
  }

  return fichiers;
}
