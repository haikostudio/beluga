---
name: bordure-en-degrade-sur-coins-arrondis
description: À utiliser dès qu'un bloc aux coins arrondis doit porter une bordure en dégradé (couleur pleine en haut qui s'éteint vers le bas, contour arc-en-ciel, liseré qui s'estompe), avec ou sans fond en dégradé assorti : « bordure dégradée », « le contour disparaît progressivement », « border-image casse les coins arrondis », « les coins deviennent carrés ».
etat: active
themes: css, design
symptomes: coins carrés avec border-image, bordure absente dans les arrondis, dégradé de bordure qui se répète en haut, fond qui laisse voir la bordure dedans
---

# bordure-en-degrade-sur-coins-arrondis

## Procédure

1. Ne pas utiliser `border-image` : il ignore `border-radius`.
2. Poser un filet TRANSPARENT (`border: 1px solid transparent`, `border-bottom-width: 0` si le bas passe sous autre chose) et DEUX fonds :
```css
background:
  linear-gradient(to bottom, <haut-du-fond>, <bas-du-fond> var(--h)) padding-box,
  linear-gradient(to bottom, <couleur>, transparent var(--h)) border-box;
```
Le mot `padding-box` / `border-box` dans le raccourci règle À LA FOIS l'origine et la découpe de chaque couche.
3. Le fond intérieur doit être OPAQUE : sinon le dégradé de bordure transparaît au milieu. Pour un fond « teinté », MÉLANGER la couleur au gris (`color-mix(in srgb, <couleur> 20%, <gris>)`) au lieu de la poser en transparence.
4. Borner le dégradé en pixels (`var(--h)` = hauteur visible) quand une partie du bloc est recouverte ou s'allonge (liste dépliée) ; le reste garde la couleur du bas.
5. Survol : changer une variable (la part de couleur du `color-mix`) plutôt qu'un `background-color`, qui serait masqué par l'image.
6. Garder la couleur littérale dans la feuille de style (une classe), pas dans l'écran, si un contrôle refuse les couleurs en dur.

## Vérification

Dans un vrai navigateur : `getComputedStyle(el).backgroundClip === 'padding-box, border-box'`, la seconde couche de `backgroundImage` commence par la couleur voulue, `borderTopWidth` vaut 1px ; capture zoomée des coins hauts en clair ET en sombre : le liseré suit l'arrondi et s'éteint vers le bas. Prouvé sur Beluga, carte e160a174 (commit 1dca8065), contrôle verif-bas-du-fil.

## Pièges

- Une seule valeur de boîte oubliée : la couche de bordure prend l'origine `padding-box` par défaut, se répète, et le filet du haut affiche la FIN du dégradé (souvent transparent).
- Un contrôle qui lisait `borderTopColor` lit désormais `transparent` : vérifier `backgroundImage` (la couche de bordure) et `backgroundClip` (« padding-box, border-box »).
- `backgroundColor` calculé vaut `transparent` : un contrôle de contraste qui ne lit que lui ne juge plus rien.
