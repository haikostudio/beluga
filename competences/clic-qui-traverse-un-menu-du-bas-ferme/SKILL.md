---
name: clic-qui-traverse-un-menu-du-bas-ferme
description: À utiliser dès qu'un menu Radix (DropdownMenu, ou tout menu qui se ferme à l'APPUI dehors) monté en panneau du bas sur téléphone se ferme et que le même toucher ouvre ou active ce qui se trouve dessous : « quand je ferme le volet, ça m'ouvre autre chose », « fermer le menu clique sur le bouton d'en dessous », « le contrôle passe avec un tap rapide mais pas au doigt ». Dit pourquoi le clic traverse, où le corriger une fois pour tous les menus, et comment le prouver avec un vrai toucher long.
etat: active
themes: interface, mobile, tests
symptomes: fermer un menu du bas ouvre un autre élément, clic qui traverse un menu à sa fermeture, bouton du dessous activé à la fermeture, contrôle qui passe au tap rapide et échoue au toucher long
---

# clic-qui-traverse-un-menu-du-bas-ferme

## Symptôme

Sur téléphone, toucher le voile pour fermer un menu du bas le referme bien, puis active ce qui était sous le doigt (un bouton, une ligne, un lien) : un second écran s'ouvre sans qu'on l'ait demandé. Un toucher bref passe souvent, un toucher plus long déclenche le défaut.

## Cause

Les menus Radix (DropdownMenu) se ferment à l'APPUI (`pointerdown`) — contrairement à la fenêtre et au popover, ils n'exposent pas `deferPointerDownOutside`. Pendant la sortie animée (souvent ~200 ms), la couche du menu tient `pointer-events: none` sur la page, puis disparaît. Le doigt est encore posé : le `click` du même geste est distribué, au relâché, à l'élément alors SOUS le doigt. Un toucher plus long que l'animation de sortie suffit à le provoquer.

## Procédure

1. Corriger à UN endroit : le composant enveloppe de tous les menus (le `DropdownMenuContent` du projet), jamais menu par menu.
2. Y passer `onPointerDownOutside`, composé avec celui de l'appelant (avant `{...props}`), SANS `preventDefault()` : la fermeture immédiate reste. S'il n'a pas été retenu par l'appelant (`event.defaultPrevented`), appeler une fonction « avaler le toucher de fermeture ».
3. Cette fonction ne vit que sous la largeur du téléphone (640 px par exemple) : un écouteur `click` en capture sur `window`, une seule fois, qui fait `stopPropagation()` + `preventDefault()`.
4. Le retirer sans faute : sur `pointercancel`, 400 ms après `pointerup`, à l'appui suivant une fois le doigt relevé, et par garde-fou après 10 s. Un clic sans rapport ne doit jamais être mangé.
5. Prouver avec un VRAI toucher long (au moins 350 ms) sur l'élément situé sous le voile.
Référence : Beluga, `avalerLaTapeDeFermeture()` dans web/src/components/ui/index.tsx et `scripts/verif-fermeture-sans-traversee.mjs` (fiche beluga-menu-du-bas-tape-de-fermeture).

## Vérification

Dans Chrome piloté au gabarit téléphone, ouvrir le menu du bas, puis envoyer un toucher LONG par CDP (`Input.dispatchTouchEvent` : touchStart, attente 450 ms, touchEnd) sur l'élément visible sous le voile : le menu est fermé, l'élément du dessous n'a rien ouvert ; ensuite un toucher ordinaire sur ce même élément fonctionne. Sans le correctif, le même contrôle doit échouer (c'est ce qui prouve qu'il mesure le défaut). Non prouvé par un navigateur piloté : un vrai iPhone.

## Pièges

- `page.touchscreen.tap` (Playwright) touche trop vite : le contrôle passe sans le correctif. Toujours un toucher d'au moins 350 ms.
- Un élément présent deux fois (page derrière + panneau) : viser le visible (`:visible`).
- Des déclencheurs qui s'ouvrent au clic : avec le correctif, toucher un autre déclencheur pendant qu'un menu est ouvert ne fait plus que fermer le menu — c'est voulu.

## Ce qui ne marche pas

Passer `deferPointerDownOutside` : le menu Radix ne l'expose pas. `preventDefault()` sur l'événement de Radix : le menu ne se ferme plus à l'appui. Compter sur la couche qui bloque les pointeurs : elle disparaît à la fin de l'animation de sortie, avant le relâché d'un toucher long.
