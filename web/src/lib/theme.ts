import * as React from 'react';
import {
  APPARENCE_PAR_DEFAUT,
  couleurDeBandeau,
  estThemeSombre,
  themeAAppliquer,
  themeChoisiValide,
  type ThemeApplique,
  type ThemeChoisi,
  type ThemeId,
} from '@haikodev/shared';
import { usePref } from './prefs';
import { useApp } from './use-app';

/**
 * LE THÈME S'APPLIQUE EN UN SEUL ENDROIT.
 *
 * Il était posé dans un effet du bandeau des quotas, à côté de son interrupteur.
 * Avec cinq choix et TROIS sources qui peuvent décider — le projet ouvert, le
 * réglage général, le réglage clair / sombre de l'ordinateur —, deux copies de ce
 * geste finiraient par se contredire.
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
export function appliquerLeTheme(theme: ThemeId): ThemeId {
  const sombre = estThemeSombre(theme);
  const racine = document.documentElement;
  racine.dataset.theme = theme;
  racine.classList.toggle('dark', sombre);
  racine.style.colorScheme = sombre ? 'dark' : 'light';
  const bandeau = document.querySelector('meta[name="theme-color"]');
  if (bandeau) bandeau.setAttribute('content', couleurDeBandeau(theme));
  return theme;
}

/**
 * LE RÉGLAGE CLAIR / SOMBRE DE L'ORDINATEUR, ET SES CHANGEMENTS EN DIRECT.
 *
 * Le lire une fois ne suffit pas : sur macOS et Windows, ce réglage bascule tout
 * seul à la tombée du jour. Sans écoute, l'application resterait claire jusqu'au
 * prochain rechargement de la page — et le choix « Système » ne tiendrait pas sa
 * promesse. Un navigateur qui ne connaît pas cette question répond « clair », ce
 * qui est le comportement le plus sûr.
 */
export function useSystemeSombre(): boolean {
  const [sombre, setSombre] = React.useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true,
  );

  React.useEffect(() => {
    const question = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!question) return;
    const suivre = (evenement: MediaQueryListEvent) => setSombre(evenement.matches);
    question.addEventListener('change', suivre);
    setSombre(question.matches);
    return () => question.removeEventListener('change', suivre);
  }, []);

  return sombre;
}

/**
 * Le réglage GÉNÉRAL de l'application, et de quoi le changer. Il vit EN BASE
 * comme les autres (`usePref`) : on retrouve son thème sur le téléphone comme sur
 * l'ordinateur, et vider un cache ne le perd pas. Une valeur ancienne
 * (« dark », « light ») est reprise par `themeChoisiValide`.
 *
 * Il ne POSE rien : un projet peut le recouvrir. Seul `useThemeApplique` pose.
 */
export function useThemeGeneral(): [ThemeChoisi, (theme: ThemeChoisi) => void] {
  const [brut, ecrire] = usePref<string>('theme', APPARENCE_PAR_DEFAUT);
  return [themeChoisiValide(brut) ?? APPARENCE_PAR_DEFAUT, ecrire];
}

/**
 * LE THÈME RÉELLEMENT EN VIGUEUR — et c'est lui qui le POSE sur la page.
 *
 * À appeler UNE SEULE FOIS, depuis la racine de l'application : le projet ouvert
 * décide avant le réglage général, donc changer de projet change l'apparence de
 * TOUTE l'interface — colonne de gauche, tableau, conversation, réglages,
 * fenêtres — et non d'un morceau d'écran.
 *
 * Rendu aussi aux écrans qui expliquent le choix (l'onglet « Apparence » doit
 * pouvoir dire « ce projet impose son thème, c'est lui que vous voyez »), mais
 * l'effet, lui, ne tourne que là où le crochet est appelé.
 */
export function useThemeApplique(): ThemeApplique {
  const state = useApp();
  const [general] = useThemeGeneral();
  const systemeSombre = useSystemeSombre();
  const projetOuvert = state.projects.find((projet) => projet.id === state.activeProjectId);

  const applique = themeAAppliquer({ duProjet: projetOuvert?.theme, general, systemeSombre });

  React.useEffect(() => {
    appliquerLeTheme(applique.theme);
  }, [applique.theme]);

  return applique;
}

/**
 * Le thème en vigueur, SANS le poser : pour un écran qui veut seulement en
 * parler. Poser deux fois n'aurait pas d'effet visible, mais un seul endroit
 * responsable de l'écriture reste la règle.
 */
export function useThemeEnVigueur(): ThemeApplique {
  const state = useApp();
  const [general] = useThemeGeneral();
  const systemeSombre = useSystemeSombre();
  const projetOuvert = state.projects.find((projet) => projet.id === state.activeProjectId);
  return themeAAppliquer({ duProjet: projetOuvert?.theme, general, systemeSombre });
}
