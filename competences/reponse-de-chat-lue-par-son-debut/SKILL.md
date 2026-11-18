---
name: reponse-de-chat-lue-par-son-debut
description: À utiliser dès qu'une conversation (chat d'IA, fil de messages) qui suit le bas doit, à l'arrivée d'une longue réponse ou à la réouverture, se poser au DÉBUT de cette réponse : « on doit tout remonter pour lire la réponse », « le fil saute au début puis redescend tout seul », « le défilement vers la réponse est annulé », « à la réouverture on tombe sur la fin du texte ».
etat: active
themes: defilement, chat, interface
symptomes: réponse lue par sa fin, saut au début annulé par le recollage au bas, fil qui redescend tout seul après un scrollIntoView, titre de la réponse flou sous le fondu du haut, message écrit qui ne ramène pas en bas
---

# reponse-de-chat-lue-par-son-debut

## Symptôme

Le fil suit le bas (recollage par ResizeObserver tant que le lecteur « est en bas ») ; on ajoute un scrollIntoView({block:'start', behavior:'smooth'}) sur la réponse qui arrive, et ça marche une fois sur deux : le fil repart au bas pendant que la réponse finit de se poser (images, réflexion qui se replie au-dessus).

## Cause

Le premier événement « scroll » du glissé doux part d'un point encore à quelques pixels du bas : l'écouteur qui recalcule « suit = reste < seuil » rallume le suivi, et le premier changement de taille recolle au bas en interrompant le glissé. Un défilement visé une seule fois ne résiste pas non plus aux changements de hauteur AU-DESSUS du bloc.

## Procédure

1. Repérer le bloc rendu par une CLÉ (identifiant de l'entrée) : une seule visée par clé ; un bloc déjà vu (re-rendu, rechargement) ne redéclenche rien.
2. À l'arrivée : ne viser que si le lecteur suivait le bas. Couper le suivi, poser une ANCRE { cible: () => élément, jusqua: maintenant + 1,5 s }, marquer le glissé comme « le nôtre » (~700 ms : ses événements scroll ne touchent pas au suivi), puis `fil.scrollTo({ top, behavior: 'smooth' })` avec top = scrollTop + (haut du bloc − haut du fil − marge), borné à [0, scrollHeight − clientHeight].
3. Pendant l'ancre, l'écouteur de taille remet le bloc en tête (même calcul, sans glissé) au lieu de recoller au bas ; l'écouteur de scroll ne rallume pas le suivi. Tout geste du lecteur (molette, doigt, clavier) lâche l'ancre.
4. Marge : au moins la hauteur du fondu du haut de la zone + ~20 px, sinon le titre du bloc reste flou.
5. Réouverture : sans position de lecture retenue, et si le dernier élément du fil est une réponse rendue (aucun message écrit après), poser l'ancre sans glissé ; une lecture retenue garde la priorité ; l'effet « ouverture en bas » doit s'abstenir quand l'ancre est posée (les deux effets ne tombent pas toujours dans le même rendu).
6. Un message écrit par l'utilisateur ramène en bas : chercher un message de l'utilisateur parmi TOUS les nouveaux messages du rendu, pas seulement le dernier (une ligne de l'agent arrivée en même temps passe devant).

## Vérification

Dans un vrai navigateur, avec un faux moteur qui rend une réponse longue : 2,5 s après l'arrivée, le haut du bloc est à la marge sous le haut du fil ; lecteur remonté pendant le tour → scrollTop inchangé ; réouverture et rechargement → même écart ; plusieurs passages de suite au vert. Prouvé dans Beluga le 07/11/2026 (scripts/verif-bloc-reponse-cadrage.mjs, 37/37, trois fois de suite ; commit b5b48905).

## Pièges

- Le décalage du bloc par rapport au haut du fil se mesure sur le fil VISIBLE (plusieurs fils peuvent être montés, onglets cachés).
- Un contrôle flaky (une fois sur deux) sur ce sujet cache souvent un vrai cas : tracer scrollTop toutes les 100 ms dans la page pour le voir.

## Ce qui ne marche pas

- scrollIntoView seul, sans ancre ni marquage du glissé : annulé par le recollage au bas une fois sur deux.
- scrollIntoView puis correction à la marge maison : saut visible de quelques pixels en fin de glissé — calculer la même cible pour le glissé et pour la tenue.
- Un contrôle qui vise une réponse COURTE : elle tient entière à l'écran au plus bas du fil, le contrôle passe même sans le code. Faire rendre une réponse plus haute que le fil.
