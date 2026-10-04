/**
 * L'APPLICATION EST-ELLE INSTALLÉE SUR L'ÉCRAN D'ACCUEIL ?
 *
 * Installée, elle tourne sans barre d'adresse ni bouton « retour » : ce qui
 * navigue hors de l'écran ne se quitte plus. iOS le dit par
 * `navigator.standalone`, les autres par le mode d'affichage.
 */
export function estInstallee(): boolean {
  return (
    (window.navigator as { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  );
}
