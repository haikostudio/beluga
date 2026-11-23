---
name: liste-qui-ne-defile-pas-dans-une-fenetre
description: À utiliser dès qu'une liste déroulante, un menu ou un panneau flottant (Radix Popover, Select maison, combobox) ouvert DANS une fenêtre modale Radix (Dialog, tiroir vaul) ne défile pas à la molette ou au doigt, alors que la même liste défile hors de la fenêtre : « la liste ne scrolle pas dans la modale », « la molette ne fait rien dans le menu », « le menu se ferme mais ne se rouvre pas au clic suivant ».
etat: active
themes: interface, navigateur
symptomes: liste déroulante qui ne défile pas dans une fenêtre, molette sans effet dans un menu flottant, défilement bloqué dans un popover, panneau qui défile hors fenêtre mais pas dedans
---

# liste-qui-ne-defile-pas-dans-une-fenetre

## Symptôme

Un panneau flottant porté au bout de la page (`Portal`) et ouvert depuis une fenêtre modale ne défile plus : la barre est là, la molette ne fait rien. Hors de la fenêtre, le même composant défile.

## Cause

La fenêtre modale Radix pose un verrou de défilement (`react-remove-scroll`) qui annule molette et glisser partout SAUF dans son propre contenu. Le panneau, porté hors de ce contenu par son `Portal`, est donc « dehors ». `react-remove-scroll` n'écoute que le DERNIER verrou posé : un panneau qui pose le sien par-dessus redevient défilable.

## Procédure

1. Reproduire dans un vrai navigateur : ouvrir la liste dans la fenêtre, `mouse.wheel` au-dessus de sa zone qui défile, comparer `scrollTop` avant/après (0 → 0 = le verrou).
2. Vérifier qu'une seule copie de `react-remove-scroll` est installée (`find node_modules -path '*react-remove-scroll/package.json'`) : deux copies = deux piles de verrous, la correction ne prendrait pas.
3. Rendre le panneau MODAL quand il s'ouvre dans une fenêtre : à l'ouverture, `declencheur.closest('[role="dialog"], [role="alertdialog"]')`, et passer le résultat à `Popover.Root modal={…}`. Hors fenêtre, rester non modal (la page continue de défiler).
4. Corriger dans LE composant de liste commun, jamais liste par liste.
5. Un mécanisme qui « marque le geste qui ferme » pour que son `click` ne rouvre pas la liste doit aussi lever la marque au `pointerdown` du geste SUIVANT (`e.timeStamp` postérieur) : un `click` qui ne vient jamais bloquait sinon la réouverture.

## Vérification

Contrôle navigateur : liste ouverte dans la fenêtre, `page.mouse.wheel(0, 400)` au-dessus de sa zone, `scrollTop` qui passe de 0 à une valeur positive ; Échap ferme la liste sans fermer la fenêtre ; une liste hors fenêtre se ferme au clic extérieur et se rouvre aussitôt. Prouvé sur Beluga Build (carte « Progression et voix des audios », commit 209b29f0, `scripts/verif-studio-voix-production.mjs` 22/22).

## Pièges

- Panneau modal : la page dessous est inerte (`pointer-events: none` sur le corps). Un clic extérieur ferme la liste SANS agir sur ce qu'il touche — c'est le comportement des menus Radix par défaut.
- Dans un contrôle Playwright, un clic hors d'une liste modale ouverte échoue (« html intercepts pointer events ») : passer `{ force: true }`.
- Une application dont l'écran entier est un Dialog (éditeur plein écran) rend TOUTES ses listes modales.

## Ce qui ne marche pas

Porter le panneau DANS le contenu de la fenêtre (`Portal container`) : il y est rogné par `overflow: hidden` et mal placé sous un parent transformé. Passer toutes les listes en modal, même hors fenêtre : la page ne défile plus pendant qu'une liste est ouverte. Faire défiler à la main dans un gestionnaire `wheel` : le doigt sur écran tactile reste bloqué.
