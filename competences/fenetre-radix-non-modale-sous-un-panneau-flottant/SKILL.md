---
name: fenetre-radix-non-modale-sous-un-panneau-flottant
description: À utiliser quand un panneau flottant (chat d'assistant, fenêtre d'agent, palette) doit rester utilisable PAR-DESSUS une fenêtre ou un tiroir Radix (Dialog, vaul) ouverts : « je ne peux pas taper dans le chat quand la modale est ouverte », « cliquer dans le chat ferme le tiroir », « Échap dans le chat ferme la fenêtre », « la fenêtre se referme toute seule dès qu'elle s'ouvre », « les flèches du clavier ne marchent plus dans la fenêtre ».
etat: active
themes: interface, radix, tiroirs
symptomes: champ du panneau flottant inerte sous une modale, clic dans le panneau qui ferme le tiroir, Échap qui ferme la fenêtre au lieu du panneau, fenêtre non modale qui se referme aussitôt ouverte, element was detached from the DOM au clic, flèches clavier ignorées dans la fenêtre
---

# fenetre-radix-non-modale-sous-un-panneau-flottant

## Symptôme

Un panneau flottant posé au-dessus d'une fenêtre Radix ne reçoit pas la frappe, ou l'utiliser referme la fenêtre ; ou bien, la fenêtre passée en non modale pour le permettre, elle se referme seule à l'ouverture.

## Cause

Une Dialog Radix MODALE pose un piège à focus (FocusScope trapped), `pointer-events: none` sur body et `aria-hidden` sur le reste : un champ hors d'elle ne garde jamais le focus. Toute couche (modale ou non) referme sur un appui ou un focus « dehors » (DismissableLayer : onPointerDownOutside, onFocusOutside) et sur Échap écouté au niveau du document en capture. En NON modale, Radix n'annule plus onFocusOutside : le moindre focus rendu ailleurs — un menu refermé juste avant qui rend le focus à son bouton déclencheur — referme la fenêtre ; et le focus resté dehors prive la fenêtre de ses raccourcis clavier.

## Procédure

1. Marquer le panneau flottant d'un repère unique (ex. `data-au-dessus-de-tout`), le monter en portail sur body, avec un z-index AU-DESSUS des fenêtres/tiroirs et SOUS leurs menus (ex. fenêtres z-50, panneau z-58, menus z-60).
2. Passer la fenêtre qui doit cohabiter en `modal={false}` ; dessiner soi-même son voile (l'Overlay Radix n'existe qu'en modale) : un appui sur lui est « dehors » et la referme.
3. Sur chaque couche (Content de Dialog, feuille vaul) : `onInteractOutside` → `preventDefault()` si `event.target.closest('[repère]')` ; `onEscapeKeyDown` → `preventDefault()` si `document.activeElement.closest('[repère]')`.
4. Sur la fenêtre non modale : `onFocusOutside` → toujours `preventDefault()` (comme une modale), puis ramener le focus dans le contenu (`ref.focus({ preventScroll: true })`) SAUF si la cible est le panneau, un menu, une liste, un popover ou une autre fenêtre.
5. Garder le contenu du panneau MONTÉ quand il est fermé (caché) si un autre écran doit pouvoir y écrire (événement « joindre au champ »), et l'ouvrir avant d'y écrire.
6. Si la fenêtre combine plusieurs références (geste de glisser + ref locale), les fusionner par une fonction STABLE (useCallback) : une ref en ligne repasse par null à chaque rendu.

## Vérification

Dans un vrai navigateur (Playwright) : ouvrir la fenêtre juste après avoir fermé un menu déroulant, attendre 2 s et vérifier qu'elle est toujours là ; presser → et vérifier qu'elle feuillette ; cliquer dans le champ du panneau, taper un texte, presser Échap, puis vérifier que la valeur contient le texte et que la fenêtre et le tiroir sont toujours ouverts ; `document.elementFromPoint` au centre du champ doit tomber dans le panneau. Pour trouver un dismiss inexpliqué : patcher `history.pushState` et écouter `focusin` en capture dans la page, puis lire la pile.

## Pièges

- Un `stopPropagation` sur Échap dans le panneau ne suffit pas : Radix écoute Échap sur le document en phase de capture ; il faut `preventDefault` dans `onEscapeKeyDown` de la couche.
- Un élément `display: none` ne prend pas le focus : ouvrir le panneau avant de focaliser son champ, ou réessayer après le rendu.
- Le panneau recouvre un coin de l'écran : un test qui glisse un élément vers ce coin le lâche sur le panneau.
- Un `waitForSelector` sur un panneau fermé mais monté doit viser l'état `attached`, pas `visible`.

## Ce qui ne marche pas

Garder la fenêtre modale : le piège à focus rend le champ du panneau inutilisable. Passer en non modale sans garde sur le focus : elle se referme au premier focus rendu ailleurs. Écrire une exception par écran : chaque nouvelle fenêtre recasse le panneau ; le repère commun dans les composants de base règle tout.
