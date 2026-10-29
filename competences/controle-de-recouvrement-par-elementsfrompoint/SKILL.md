---
name: controle-de-recouvrement-par-elementsfrompoint
description: À utiliser dès qu'un contrôle navigateur (Playwright, Puppeteer) doit prouver qu'un bouton ou un texte n'est pas recouvert par une ombre, un fondu, un voile ou un calque décoratif, ou devant « le test passe mais on voit bien l'ombre sur le bouton ».
etat: active
themes: tests, css, navigateur
symptomes: contrôle de recouvrement toujours vert, bouton flouté par un fondu alors que le test passe, z-index qui semble juste dans les classes mais pas à l'écran
---

# controle-de-recouvrement-par-elementsfrompoint

## Symptôme

Un contrôle vérifie par `document.elementsFromPoint` que le centre d'un bouton rend le bouton avant tout calque, et il passe — alors qu'à l'écran une ombre ou un fondu couvre le bouton.

## Cause

`elementsFromPoint` ne rend que les éléments « touchables » : un calque décoratif posé en `pointer-events: none` (cas presque systématique des ombres et fondus) n'apparaît jamais dans la pile, quel que soit son ordre de peinture.

## Procédure

1. Le temps de la mesure, injecter une feuille de style : `<sélecteur du calque>, <sélecteur du calque> * { pointer-events: auto !important; }`, puis la retirer à la fin.
2. Faire défiler la zone par petits pas (4 px), attendre deux images (`requestAnimationFrame` deux fois) à chaque pas.
3. Pour chaque bouton visible dans la vue : prendre la pile au centre ; le bouton (ou un de ses descendants) doit venir AVANT le premier calque VISIBLE (opacité > 0 ou attribut d'état du calque).
4. Faire le contrôle sur les deux thèmes et sur un gabarit téléphone, où la mise en page change souvent (feuille du bas, version compacte).
5. Avant de faire confiance au contrôle : remettre l'ancien code fautif et vérifier qu'il ÉCHOUE.

## Vérification

Le contrôle échoue sur l'ancien empilement et passe sur le corrigé. Exemple : Beluga, scripts/verif-question-choix-et-fondu.mjs (29/10/2026) — 19/27 avec le voile au même z-index que la barre, 27/27 avec la barre un cran au-dessus.

## Pièges

— Un ancêtre qui crée un contexte d'empilement (transform, filter, backdrop-filter, opacity < 1, isolation) peut annuler un z-index : seule la pile rendue fait foi, pas la lecture des classes.
— Compter un calque éteint (opacité 0) donne de faux échecs : filtrer sur son état visible.

## Ce qui ne marche pas

Lire `getComputedStyle().zIndex` des deux éléments : ne dit rien des contextes d'empilement. `elementsFromPoint` sans rendre le calque touchable : toujours vert.
