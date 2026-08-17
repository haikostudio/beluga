import * as React from 'react';
import { APPARENCE_PAR_DEFAUT, couleurDeBandeau, estThemeSombre, themeValide, type ThemeId } from '@haikodev/shared';
import { usePref } from './prefs';

/**
 * LE THÈME S'APPLIQUE EN UN SEUL ENDROIT.
 *
 * Il était posé dans un effet du bandeau des quotas, à côté de son interrupteur.
 * Avec QUATRE thèmes et deux endroits pour en changer — le menu du bandeau et les
 * réglages —, deux copies de ce geste finiraient par se contredire.
 *
 * Trois marques sont posées ensemble, et jamais séparément :
 *  - `data-theme` : le nom du thème, qui choisit son bloc de jetons ;
 *  - la classe `dark` : elle dit seulement que le thème est SOMBRE. Plusieurs
 *    contrôles du projet basculent en clair en la retirant, et le thème clair y
 *    est accroché (`html:not(.dark)`, `web/src/styles.css`) — on la garde ;
 *  - `color-scheme` : ce qui décide de l'aspect des ascenseurs et des champs du
 *    système.
 * Et la couleur du bandeau du téléphone suit, sinon la barre d'état reste noire
 * au-dessus d'une application beige.
 */
export function appliquerLeTheme(valeur: unknown): ThemeId {
  const id = themeValide(valeur);
  const sombre = estThemeSombre(id);
  const racine = document.documentElement;
  racine.dataset.theme = id;
  racine.classList.toggle('dark', sombre);
  racine.style.colorScheme = sombre ? 'dark' : 'light';
  const bandeau = document.querySelector('meta[name="theme-color"]');
  if (bandeau) bandeau.setAttribute('content', couleurDeBandeau(id));
  return id;
}

/**
 * Le thème choisi, et de quoi le changer. Le réglage vit EN BASE comme les
 * autres (`usePref`) : on retrouve son thème sur le téléphone comme sur
 * l'ordinateur, et vider un cache ne le perd pas. Une valeur ancienne
 * (« dark », « light ») est reprise par `themeValide`.
 */
export function useTheme(): [ThemeId, (theme: ThemeId) => void] {
  const [brut, ecrire] = usePref<string>('theme', APPARENCE_PAR_DEFAUT);
  const theme = themeValide(brut);

  React.useEffect(() => {
    appliquerLeTheme(theme);
  }, [theme]);

  return [theme, ecrire];
}
