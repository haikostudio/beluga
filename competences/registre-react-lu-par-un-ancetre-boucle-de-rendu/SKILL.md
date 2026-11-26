---
name: registre-react-lu-par-un-ancetre-boucle-de-rendu
description: À utiliser dès qu'un composant React déclare quelque chose dans un registre externe (menu du haut, options de page, portail de boutons) lu par useSyncExternalStore, et que la page plante en « Maximum update depth exceeded » (erreur React #185 en production) ou se fige après avoir déplacé la lecture de ce registre : où lire le registre pour ne jamais boucler.
etat: active
themes: interface, react, rendu
symptomes: Minified React error #185, Maximum update depth exceeded, la page ne s'affiche plus après l'ajout d'une option de menu, un composant redéclare son entrée à chaque rendu
---

# registre-react-lu-par-un-ancetre-boucle-de-rendu

## Cause

Le composant déclarant écrit son entrée dans le registre à chaque rendu (useLayoutEffect sans dépendances, un nouvel objet `noeud: children` à chaque fois). Si le composant qui LIT le registre (useSyncExternalStore) est un ANCÊTRE du déclarant — l'application entière —, chaque écriture redessine l'ancêtre, donc le déclarant, qui réécrit : boucle sans fin. Lu par un composant FRÈRE ou un enfant isolé, le même registre ne redessine que ce lecteur.

## Procédure

1. Repérer qui lit le registre (useSyncExternalStore / useContenuDuMenu…) et qui y écrit.
2. Si le lecteur est un ancêtre de l'écrivain, déplacer la lecture dans un petit composant dédié (ex. `MenuAvecLesOptions({ registre })`) rendu à la place voulue : l'ancêtre ne fait que passer le registre (référence stable, useMemo).
3. Garder l'écriture telle quelle ; ne pas « corriger » en comparant les nœuds React (ils changent à chaque rendu).

## Vérification

Charger la page dans un vrai navigateur (Playwright) avec `page.on('console')` : aucune erreur #185 ; l'entrée déclarée apparaît dans le menu lecteur ; React DevTools « Highlight updates » ne montre plus l'application entière clignoter. Preuve : Beluga, carte « Beluga piloté par des agents », 26/11/2026 (menu à trois points unique de la barre d'un projet).

## Pièges

- Un useMemo sur la liste lue ne suffit pas : c'est l'abonnement de l'ancêtre qui déclenche le rendu.
- Le registre « vide » passé quand la fonction est désactivée doit lui aussi être stable (useMemo), sinon l'abonnement change à chaque rendu.

## Ce qui ne marche pas

- Lire le registre dans le composant racine et passer la liste en props au menu : boucle immédiate dès qu'une page déclare une option.
