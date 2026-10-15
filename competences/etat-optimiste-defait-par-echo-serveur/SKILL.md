---
name: etat-optimiste-defait-par-echo-serveur
description: À utiliser dès qu'une application temps réel applique un changement tout de suite à l'écran puis reçoit du serveur un ÉTAT COMPLET en réponse (bloc de réglages, document entier, liste entière), ou devant ces symptômes : « le curseur d'un champ de texte saute à la fin tout seul », « une valeur qu'on vient de changer revient en arrière une fraction de seconde », « un interrupteur clignote », « quelques lettres tapées disparaissent puis reviennent », « ça n'arrive que quand deux changements partent presque en même temps ». Dit comment prouver la course et comment la fermer sans perdre le suivi entre appareils.
etat: active
themes: interface, temps-reel, navigateur, tests
symptomes: le curseur d'un champ de texte saute à la fin sans frappe, une valeur changée revient en arrière un instant, un interrupteur clignote après un clic, des lettres tapées disparaissent puis reviennent, le défaut n'apparaît que quand deux changements partent presque ensemble
---

# etat-optimiste-defait-par-echo-serveur

## Symptôme

Un champ de texte contrôlé perd la place de son curseur (il part à la fin) « après un temps aléatoire », ou une valeur fraîchement changée recule un instant. Le défaut semble sans cause : aucun code ne déplace le curseur.

## Cause

Deux mécanismes s'additionnent. (1) L'écran applique un changement tout de suite (état optimiste), puis le serveur répond à chaque écriture par l'état COMPLET. Quand deux écritures A puis B partent coup sur coup, la réponse à A ne contient pas encore B : si l'écran remplace son état par cette réponse, B est défait, puis refait à la réponse suivante. (2) Dans un navigateur, écrire `value` sur un champ de texte — même pour remettre le texte d'avant — renvoie le curseur à la fin. Une bibliothèque d'interface n'écrit `value` que si la chaîne diffère : il suffit que la valeur AFFICHÉE dépende de la donnée qui bascule (une étiquette, un masque, un format) pour que le champ soit réécrit deux fois.

## Procédure

1. Prouver avant de corriger : dans un vrai navigateur, provoquer les deux écritures rapprochées (l'action qui change deux choses d'un coup : joindre un fichier, coller, cocher), poser le curseur au milieu, puis relever `selectionStart` toutes les 100 ms pendant quelques secondes. Une seule valeur relevée = sain.
2. Chercher QUI écrit deux fois : lister ce que le composant envoie au serveur après un même geste, et regarder la forme de la réponse (delta ou état complet).
3. Fermer la course à la source : donner un identifiant à chaque écriture et garder, par clé, la dernière valeur envoyée tant que son accusé n'est pas revenu ; pendant ce temps, l'état reçu est corrigé par ces valeurs. Condition à vérifier dans le serveur : il diffuse l'état AVANT d'accuser réception (sinon, garder la valeur jusqu'au premier état reçu après l'accusé). Après l'accusé, le serveur fait foi : un autre appareil reste suivi.
4. Libérer ces valeurs retenues à la coupure de la connexion et sur un délai de garde : un accusé perdu ne doit jamais figer une clé.
5. Ajouter un filet dans le champ pour les réécritures LÉGITIMES (un autre appareil écrit) : relever la sélection juste avant, la reposer après la peinture, bornée à la nouvelle longueur, seulement si le champ a le curseur ; l'annuler au premier geste de la personne.
6. Écrire la règle « l'état reçu ne défait pas ce qui est en vol » comme une fonction pure, avec son test.

## Vérification

Rejouer le relevé du point 1 après correctif, à la taille ordinateur et à la taille téléphone : la place du curseur ne prend qu'une valeur sur toute la durée. Ajouter trois contrôles de non-régression : la valeur est retrouvée après rechargement (elle est bien partie au serveur), un second écran qui écrit remplit bien le premier resté vierge (le suivi entre appareils tient), et pendant que le second écran continue d'écrire, le curseur posé au milieu sur le premier ne bouge pas.

## Pièges

- Sur un serveur local, le défaut ne se produit que si les deux écritures partent dans le même court instant : un contrôle qui ne change qu'une chose ne reproduit rien.
- Comparer le TEXTE avant/après ne montre rien quand c'est une donnée voisine qui bascule (liste de fichiers, format) et change seulement la valeur affichée.
- Un champ sous un calque ne se prend pas à la souris dans un script : poser la sélection par `setSelectionRange`.
- Reposer le curseur à CHAQUE changement de valeur casse les cas qui le veulent à la fin (dictée, texte déposé par un bouton, reprise d'un message).

## Ce qui ne marche pas

Ignorer toute réponse du serveur pendant un délai fixe après une écriture : le délai est toujours trop court sur un mauvais réseau et trop long pour suivre un autre appareil. Ne plus appliquer le changement tout de suite : l'écran devient lent à chaque geste.
