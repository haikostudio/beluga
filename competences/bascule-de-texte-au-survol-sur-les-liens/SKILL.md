---
name: bascule-de-texte-au-survol-sur-les-liens
description: À utiliser dès qu'on pose un effet de survol à texte dupliqué (le texte part vers le haut, sa copie arrive du bas) sur des LIENS de texte, y compris au milieu d'une phrase : « le lien remonte au survol », « le soulignement disparaît », « le lien ne passe plus à la ligne », « la flèche se colle au texte », « texte lu deux fois ».
etat: active
themes: animation, interface, css, accessibilite
symptomes: texte du lien décalé vers le haut, soulignement disparu, lien qui ne passe plus à la ligne, flèche collée au texte, texte lu deux fois par le lecteur d'écran
---

# bascule-de-texte-au-survol-sur-les-liens

## Symptôme

L'effet de bascule des boutons, appliqué tel quel à des liens de texte, décale la ligne de base, efface le soulignement, empêche le retour à la ligne ou casse un lien « texte à gauche, flèche à droite ».

## Cause

La version bouton est un inline-flex avec overflow: hidden : un inline-flex ne se coupe pas sur plusieurs lignes, un inline-block en overflow hidden prend sa ligne de base en bas de sa boîte, une décoration de texte ne traverse pas un inline-block, et l'enveloppe ne remplit pas un parent flex.

## Procédure

1. Variante texte : enveloppe et faces en `display: inline-block; max-width: 100%; text-decoration: inherit; text-underline-offset: inherit`.
2. Couper le débord par `clip-path: inset(0 -0.25em)` sur l'enveloppe, jamais overflow ; padding-block 0.2em / margin-block -0.2em pour les jambages.
3. Face B (copie aria-hidden) en `position: absolute; inset: 0.2em 0; display: block` : même largeur que la face A, donc mêmes coupures de ligne.
4. Ellipse : sous un parent `truncate`, enveloppe et face A en display block + overflow hidden + text-overflow ellipsis.
5. Version bouton/icône dans un parent flex : `flex-grow: 1` sur l'enveloppe et la face A, justify-content: inherit.
6. N'activer l'animation que sous `@media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)` ; ailleurs face B en display: none.
7. Un composant lien commun décide seul : texte seul → variante texte ; texte + icônes → version bouton ; bloc (carte) → poser l'effet dans le premier élément à texte, jamais sur le bloc ; jamais d'enveloppe imbriquée.

## Vérification

Au navigateur (souris simulée) : la boîte du lien a la même taille avant et pendant le survol, la face B finit en transform identité et opacité 1, elle porte aria-hidden="true" ; en émulation pointer: coarse ou reduced-motion, aucune face B affichée ; un lien souligné l'est toujours ; aucun débord horizontal à 390 px.

## Pièges

Ne pas utiliser overflow: hidden pour couper (ligne de base). Ne pas faire basculer un bloc entier (carte, ligne de tableau). Les tests qui cherchent un lien par son texte trouvent deux correspondances : chercher par rôle.
