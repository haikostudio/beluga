---
name: grille-repliee-sous-flou-progressif
description: À utiliser dès qu'une grille ou une liste longue doit n'en montrer que quelques lignes, la dernière coupée sous un flou de plus en plus fort, avec un bouton « Voir plus » qui la déplie sur place : « montre trois lignes puis un dégradé flou », « le bouton Voir plus est flou lui aussi », « le flou s'arrête sur une bande blanche qui ne colle pas au fond », « pas de flou sur iPhone ».
etat: active
themes: interface, navigateur, mobile, design
symptomes: bouton Voir plus flou, bande de couleur sous le flou, pas de flou sur Safari, hauteur repliée fausse sur grand écran, élément visé introuvable une fois replié
---

# grille-repliee-sous-flou-progressif

## Procédure

1. Mesurer, ne pas deviner : colonnes = getComputedStyle(grille).gridTemplateColumns.split(' ').length, hauteur de ligne = offsetHeight de la 1re vignette, suivi par ResizeObserver. Hauteur repliée = padding + N × (ligne + gap) + fraction (≈0,55) de la ligne suivante.
2. Replier par max-height + overflow:hidden sur un enveloppe ; garder TOUS les éléments dans le DOM (scripts, démos et tests les trouvent ; les images loading="lazy" cachées ne se chargent pas).
3. Effacer la ligne coupée par un mask-image sur l'enveloppe (linear-gradient #000 → transparent sur la hauteur du fondu) : le fondu tombe sur le fond réel, quelle que soit sa couleur — jamais un dégradé vers une couleur supposée.
4. Flou progressif par-dessus : 4 couches absolues, backdrop-filter blur(1, 2, 4, 8 px), chacune limitée par un mask-image à une bande plus basse que la précédente (0–60 %, 20–80 %, 40–100 %, 60 %+). Toujours doubler -webkit-backdrop-filter et -webkit-mask-image.
5. Bouton « Voir plus » dans la zone de fondu, position relative + z-10, fond plein.
6. Si l'élément choisi d'avance tombe sous le pli, le remonter en tête de l'affichage (seulement pour une valeur venue de l'extérieur, pas pour un clic, sinon la grille saute). Toute nouvelle recherche replie à nouveau.

## Vérification

Playwright avec Chrome système, en 390 px et 1280 px : (hauteur visible − padding) / (ligne + gap) ≈ 3,5 ; capture d'écran où le bouton est net et la ligne coupée floue ; clic sur « Voir plus » → bouton disparu et hauteur = toute la grille ; nombre d'éléments dans le DOM identique replié et déplié.

## Pièges

- Sans z-index, le bouton posé sur les couches de flou paraît flou.
- Une hauteur en dur casse dès que le nombre de colonnes change (téléphone / ordinateur).
- Le voile coloré final ne colle jamais à un fond gris clair ou sombre : préférer le masque.
- backdrop-filter coûte sur téléphone : 4 couches sur une bande d'une ligne suffisent, pas sur toute la grille.
