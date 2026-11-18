---
name: style-perdu-sous-une-bulle-radix
description: À utiliser quand un interrupteur, une case ou un bouton à bascule Radix perd son fond ou son état visuel dès qu'il est enveloppé d'un Tooltip (ou de tout déclencheur Radix en asChild) : le rond bouge mais le rail reste invisible, data-state vaut « closed » ou « delayed-open » au lieu de « checked ».
etat: active
themes: radix, interface, css
symptomes: fond d'interrupteur invisible, rail transparent, data-state vaut closed sur un Switch, style data-[state=checked] sans effet sous une infobulle
---

# style-perdu-sous-une-bulle-radix

## Symptôme

Le même interrupteur s'affiche bien dans un formulaire et perd son fond dans un panneau où il est sous une infobulle. Le rond, lui, change encore de place.

## Cause

`Tooltip.Trigger asChild` passe son propre `data-state` à l'enfant, et ce repère écrase celui de l'interrupteur : ses styles `data-[state=checked]` et `data-[state=unchecked]` ne s'appliquent plus. Le rond garde son état, car il le lit dans le contexte du composant et non dans la prop.

## Procédure

1. Mesurer dans le navigateur : `getAttribute('data-state')` et `getComputedStyle(el).backgroundColor` sur l'élément.
2. Si `data-state` n'est pas celui du composant, teindre sur un attribut que la bulle ne touche pas : `aria-[checked=true]:…` et `aria-[checked=false]:…` pour un interrupteur ou une case.
3. Laisser le rond tel quel, il suit son contexte.

## Vérification

Dans le navigateur, sous une infobulle, le fond calculé de l'interrupteur n'est plus transparent, allumé comme éteint, alors que `data-state` vaut toujours « closed ».

## Pièges

Retirer la bulle masque la panne sans la régler : elle revient à la prochaine bulle posée sur le composant.
