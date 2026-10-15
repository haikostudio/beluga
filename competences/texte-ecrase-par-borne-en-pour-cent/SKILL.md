---
name: texte-ecrase-par-borne-en-pour-cent
description: À utiliser dès qu'un texte replié (ellipse) d'une interface web se réduit à une ou deux lettres alors qu'il reste de la place à côté : « le nom est écrasé sur téléphone », « le titre affiche une lettre puis … », « le bouton ne montre que son icône et un bout de lettre », « dans une ligne à deux textes, le plus court disparaît ». À utiliser AUSSI avant d'écrire `max-width` en pour cent (`max-w-[55%]`) sur un élément flexible. Dit pourquoi une borne en pour cent ou deux textes repliables côte à côte écrasent le texte, et quoi écrire à la place.
etat: active
themes: interface, css, mobile
symptomes: un nom réduit à une lettre dans une barre d'en-tête, un texte tronqué alors que la place reste vide à côté, le plus court de deux textes côte à côte réduit à « J… », un bouton dont le libellé disparaît sur téléphone
---

# texte-ecrase-par-borne-en-pour-cent

## Symptôme

Dans une barre ou une ligne en flexbox, un libellé avec ellipse (`truncate`, `text-overflow: ellipsis`) se réduit à une lettre — parfois à un morceau de lettre — alors qu'un espace vide reste visible juste à côté. Le défaut ne paraît que sur écran étroit, ou seulement pour certains textes.

## Cause

Deux causes, souvent prises l'une pour l'autre. (1) UNE BORNE EN POUR CENT SUR UN ENFANT D'UN PARENT AJUSTÉ À SON CONTENU : `max-width: 55%` se calcule sur la largeur du parent ; si ce parent n'a pas de largeur propre (un `span` ou un `div` en `inline-flex`, un élément flexible sans `flex: 1`), sa largeur vaut celle de l'enfant — l'enfant est donc borné à 55 % de SA PROPRE largeur, et son texte s'écrase. (2) DEUX TEXTES REPLIABLES CÔTE À CÔTE dans la même ligne flexible : le manque de place se partage en proportion de leurs largeurs, et le plus court (un nom de projet devant une longue description) descend à presque rien.

## Procédure

1. Dans l'inspecteur, remonter du texte écrasé vers ses parents et noter lequel a `max-width` en pour cent, et si son parent a une largeur définie (`flex: 1`, `width`, ou seulement son contenu).
2. Cas (1) : donner au PARENT la place qui reste (`flex: 1 1 0; min-width: 0` — en Tailwind `flex-1 min-w-0`) et borner l'enfant par `max-width: 100%` ou une valeur fixe (`max-w-full sm:max-w-[280px]`). Retirer le pour cent.
3. Cas (2) : décider lequel des deux textes PEUT se replier. Celui-là reçoit `min-width: 0` et l'ellipse ; l'autre garde sa place (`flex-shrink: 0`) avec une borne pour ne pas tout prendre (`max-width: 45%` est sûr ICI, parce que la ligne, elle, a une largeur définie).
4. Ne pas laisser `flex-shrink: 0` sur un élément qui contient un texte à ellipse sans lui donner de borne : il déborderait au lieu de se replier.
5. Revérifier à la plus petite largeur visée (320 ou 360 px) avec le texte le plus long ET le plus court.

## Vérification

Dans un vrai navigateur à 390 px puis 320 px de large : le texte affiche plusieurs lettres avant son ellipse, et aucun espace vide ne reste à côté d'un texte tronqué. Mesure possible : `el.scrollWidth > el.clientWidth` (il est bien replié) ET `el.clientWidth` supérieur à quelques dizaines de pixels. Preuve d'origine : le sélecteur de client de la messagerie de Beluga (carte « Retouches de la refonte d'interface », commit c7ed2fd4) et la ligne d'une fiche du coffre.

## Pièges

- Le défaut ne se voit pas sur ordinateur quand le texte tient en entier : le tester avec un nom long.
- Un parent en `display: contents` ne compte pas : le pour cent se calcule sur le premier ancêtre qui a une boîte.
- `min-width: 0` manquant sur un ancêtre flexible empêche l'ellipse et fait déborder la ligne : c'est le défaut inverse, à ne pas confondre.

## Ce qui ne marche pas

Augmenter le pour cent (70 %, 90 %) : le texte reste écrasé, toujours calculé sur lui-même. Retirer l'ellipse : la ligne déborde sur les boutons voisins. Mettre `truncate` sur les deux textes d'une ligne : le plus court disparaît.
