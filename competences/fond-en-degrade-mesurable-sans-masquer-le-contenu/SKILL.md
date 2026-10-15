---
name: fond-en-degrade-mesurable-sans-masquer-le-contenu
description: À utiliser dès qu'on veut qu'un fond de bloc s'estompe sur un bord (fondu vers la transparence) sans estomper ce que le bloc contient, ou dès qu'un contrôle de contraste automatique tombe après qu'un fond plein est devenu un dégradé : « le test lit un fond transparent », « rgba(0, 0, 0, 0) à la place de la couleur », « le texte du bloc s'efface avec le fond », « le contraste échoue alors que l'écran est juste ».
etat: active
themes: interface, tests, navigateur
symptomes: le contrôle de contraste lit rgba(0 0 0 0) sur un bloc pourtant coloré, le contenu d'un bloc s'estompe avec son fond, une propriété personnalisée rend color-mix en texte au lieu d'une couleur
---

# fond-en-degrade-mesurable-sans-masquer-le-contenu

## Symptôme

Un bloc doit perdre son fond progressivement sur un bord. Après le changement, un contrôle qui mesurait sa couleur échoue, ou le contenu du bloc s'estompe lui aussi.

## Cause

Un dégradé est une IMAGE de fond : la couleur de fond calculée du bloc devient transparente, même si le dégradé est presque partout plein. Et un masque (`mask-image`) s'applique à tout le bloc, enfants compris, alors qu'un fond ne touche que le fond.

## Procédure

1. Sortir la couleur dans une propriété personnalisée portée par le bloc (`--fond-du-bloc: …`), une déclaration par thème si elle en dépend.
2. Poser le fond en image : `background-image: linear-gradient(to top, var(--fond-du-bloc) 90%, transparent)` — plein jusqu'à l'arrêt, transparent au bord. Retirer le `background-color`.
3. Ne PAS utiliser `mask-image` si le contenu doit rester net.
4. Dans le contrôle, mesurer la couleur pleine sur une SONDE : un `div` en `position:absolute;width:0;height:0;background-color:var(--fond-du-bloc)` ajouté dans le bloc, dont on lit le `backgroundColor` calculé, puis qu'on retire.
5. Ajouter une assertion sur la forme du dégradé calculé : direction, arrêt, fin transparente (Chrome sérialise `transparent` en `rgba(0, 0, 0, 0)`), et `mask-image: none`.
6. Prendre une capture en clair ET en sombre : un fondu se juge à l'œil, aucune mesure ne dit s'il fait une bande.

## Vérification

Le contrôle rend la même couleur pleine qu'avant le changement (mêmes rapports de contraste, au millième), l'assertion sur le dégradé passe, et les captures en clair et en sombre montrent un contenu net sur un fond qui s'efface sur le seul bord voulu. Prouvé sur Beluga, page « Tableaux de bord » : 121 vérifications sur 121, pire contraste inchangé à 1,108.

## Pièges

- `getComputedStyle(el).getPropertyValue('--x')` ne résout pas un `color-mix(…)` : il rend le texte de la formule (variables remplacées, mélange non calculé). D'où la sonde.
- Un arrêt en pourcentage suit la hauteur du bloc : la bande estompée grandit avec le contenu. Pour une bande de hauteur fixe, donner l'arrêt en `calc(100% - 24px)`.
- Les coins arrondis du bord estompé disparaissent : c'est voulu, ne pas chercher à les garder.
- Une mesure prise juste après un changement de thème lit une couleur à mi-transition : couper les transitions ou attendre.

## Ce qui ne marche pas

Lire `backgroundColor` sur le bloc lui-même (transparent). Lire la propriété brute et la donner à un canevas sans vérifier qu'elle est comprise (un canevas qui refuse une couleur garde la précédente, sans erreur). Masquer le bloc avec `mask-image` (le contenu part avec).
