---
name: rangee-aimantee-qui-deborde-jusqu-au-bord
description: À utiliser dès qu'une rangée qui défile de côté (cases, cartes, chiffres, vignettes) déborde jusqu'au bord de l'écran sur téléphone tout en devant s'aligner au repos sur le contenu du dessus : « la première case colle au bord de l'écran », « au repos ce n'est pas aligné sur le bouton », « le padding de la rangée ne sert à rien », ou avant d'écrire `-mx-4 px-4` avec `scroll-snap`.
etat: active
themes: css, defilement, mobile
symptomes: première case collée au bord de l'écran, rangée pas alignée sur le bouton au repos, padding de la rangée ignoré
---

# rangee-aimantee-qui-deborde-jusqu-au-bord

## Symptôme

La rangée a une marge négative et un padding égal (`-mx-4 px-4`) pour déborder jusqu'au bord en défilant, mais au repos la première case se cale contre le bord de l'écran au lieu du bord du contenu au-dessus.

## Cause

Avec `scroll-snap-type: x mandatory` et `scroll-snap-align: start`, le navigateur aimante le bord gauche de chaque case sur le bord de la ZONE DE DÉFILEMENT, pas sur son padding. Il fait défiler de la largeur du padding dès l'affichage, et le padding disparaît. Seul `scroll-padding` déplace la ligne d'aimantation.

## Procédure

1. Mesurer la vraie marge latérale du parent sur téléphone (ex. 16 px). 2. Garder `-mx-4 px-4` égal à cette marge. 3. Ajouter `scroll-padding-inline` de la même valeur (Tailwind `scroll-px-4`). 4. Quand la rangée ne défile plus sur grand écran (`sm:mx-0 sm:px-0`), remettre aussi `sm:scroll-px-0`.

## Vérification

Dans un vrai navigateur à 390 px : bord gauche de la première case = bord gauche du bouton du dessus (±1 px) au repos ; après `scrollTo({ left: largeur d'une case × 0,75 })` et 700 ms, une case a son bord gauche sur ce même bord. Preuve : carte Beluga « File d'attente et mise au point » (29/10/2026), contrôle ajouté à scripts/verif-marketing-strategique.mjs.

## Pièges

Mesurer au repos, avec `scrollLeft = 0`, ne prouve rien si le test force lui-même le défilement à 0 : il faut aussi faire défiler d'un peu plus d'une demi-case, attendre l'aimant (~700 ms), et vérifier qu'une case revient sur le bord du contenu. Un défilement trop court (moins d'une demi-case) revient à la première case et `scrollLeft` reste à 0.

## Ce qui ne marche pas

Augmenter le padding ou ajouter un premier élément vide décale aussi la fin de rangée et ne corrige pas les cases suivantes. `scroll-margin` sur chaque case marche mais se répète partout : `scroll-padding` sur le conteneur suffit.
