---
name: voile-de-connexion-des-apps-temps-reel
description: À utiliser dès qu'une application temps réel (WebSocket, SSE, canal permanent) affiche mal son écran de connexion : « le message Connexion au serveur revient sans arrêt », « la roue de chargement s'affiche à chaque changement de réseau ou au réveil de veille », « l'application reste visible mais ne répond plus, sans rien dire », « écran noir avec un spinner bloqué ». À utiliser AUSSI avant d'écrire la condition d'affichage d'un écran de chargement piloté par un canal permanent. Dit comment séparer l'état du transport de l'état des données.
etat: active
themes: interface, navigateur, temps-reel, tests
symptomes: le message Connexion au serveur revient sans raison, la roue de chargement réapparaît à chaque changement de réseau, spinner bloqué sur écran noir, l'application reste affichée mais ne réagit plus, l'écran clignote au réveil de veille
---

# voile-de-connexion-des-apps-temps-reel

## Symptôme

L'écran de chargement d'une application temps réel se comporte au hasard. Deux dégâts opposés, tous deux venus de la même condition d'affichage. (1) Le voile « Connexion au serveur… » avec sa roue revient en pleine utilisation — au changement de réseau (Wi-Fi vers mobile), au réveil de veille, quand l'onglet repasse au premier plan — et cache une application qui allait très bien. (2) L'inverse : le canal est coupé, l'application reste affichée avec ses anciennes données, l'utilisateur clique et rien ne se passe, sans qu'aucun message ne dise qu'on est déconnecté.

## Cause

La condition qui décide d'afficher le voile mélange deux choses de nature différente : l'état du TRANSPORT (le canal est-il ouvert ?) et l'état des DONNÉES (le premier chargement est-il arrivé ?). La forme fautive typique est « pas connecté ET aucune donnée » (`!connected && !donnees.length`).

Elle se retourne dans les deux sens. Après la toute première connexion réussie, les données restent en mémoire du client : la seconde moitié de la condition devient fausse pour toujours, donc plus AUCUNE déconnexion ne peut lever le voile — c'est le cas (2). Et avant cette première réponse, chaque fermeture du canal fait passer la condition à vraie puis à fausse en une fraction de seconde : le voile clignote — c'est le cas (1).

Deuxième cause, souvent superposée : le voile est levé sur l'ouverture du canal (`onopen`) au lieu du premier message d'état complet envoyé par le serveur. Le canal s'ouvre bien avant que le serveur ait envoyé quoi que ce soit d'utile ; on découvre alors une application vide qui se dit prête.

## Procédure

1. Recenser les drapeaux réellement tenus par le client de connexion. Il en faut trois, distincts : `connecting` (une tentative est en cours), `connected` (le canal est ouvert), et un drapeau de PREMIÈRE DONNÉE — appelons-le `pret` — mis à vrai à la réception du premier message d'état complet du serveur, jamais sur `onopen`. S'il n'existe pas, le créer : c'est lui qui manque presque toujours.

2. Poser le voile de démarrage sur la seule condition `connecting && !pret`. Traduction : « j'essaie de me connecter et je n'ai encore jamais rien reçu ». Il s'affiche au premier lancement, disparaît à la première charge, et ne peut plus revenir tant que les données sont là.

3. Ne JAMAIS vider les données reçues quand le canal se ferme. C'est ce vidage qui fait disparaître tout l'écran sur une coupure d'une seconde.

4. Traiter la reconnexion en cours de vie autrement : un indicateur DISCRET et non bloquant (pastille dans le bandeau, bandeau fin en haut), pas un voile plein écran. L'application reste lisible pendant que le canal se rétablit.

5. Supprimer les messages devenus impossibles. Une fois le voile piloté par `connecting`, un texte « serveur injoignable » affiché pendant qu'on est en train d'essayer ne peut plus être vrai : la branche qui l'affichait se retire, sinon elle mentira un jour.

6. Vérifier que la fermeture du canal est réellement détectée. `onclose` ne se déclenche pas sur un canal zombie (socket qui ne répond plus sans se fermer) : prévoir un battement de cœur côté client — un message périodique dont l'absence de réponse vaut déconnexion.

## Vérification

Deux passages dans un vrai navigateur, tous deux obligatoires — ce sont les deux cas que la condition doit départager.

- **Coupure en cours de vie** : ouvrir l'application, attendre qu'elle soit chargée, puis couper le serveur (ou passer les outils de développement en « Offline »). Attendu : l'écran RESTE visible, seul l'indicateur discret change. Aucun voile plein écran. Rétablir : l'écran se remet à jour sans voile intermédiaire.
- **Démarrage sans serveur** : serveur arrêté, recharger la page. Attendu : le voile s'affiche et RESTE affiché tant que rien n'arrive. Démarrer le serveur : le voile disparaît quand la première charge arrive, pas avant.

En contrôle automatisé, vérifier l'ÉTAT (le nœud du voile est présent ou absent) et non un délai d'attente : le temps de connexion varie d'une machine à l'autre.

Preuve par le code : `grep -n "connecting" <fichier de l'écran principal>` doit rendre la condition du voile, et la recherche de `projects.length`, `donnees.length` ou équivalent dans cette même condition ne doit plus rien rendre. Sur le cas d'origine, la condition retenue (`state.connecting && !state.pret`) était toujours en place et inchangée sept jours plus tard, la reconnexion ne masquant plus l'application.

## Pièges

- `onopen` pris pour « prêt » : le canal est ouvert bien avant le premier message utile. On lève le voile sur une application vide.
- Une condition qui ne peut plus jamais devenir vraie ne provoque aucune erreur, aucun avertissement, aucun test rouge. Elle se voit seulement à l'usage, et ressemble à un problème de réseau.
- Le canal zombie : le socket n'est pas fermé, il ne répond simplement plus. `onclose` ne part pas, `connected` reste vrai, et l'application se croit en ligne.
- Un voile plein écran pour une coupure d'une seconde est plus gênant pour l'utilisateur que pas de voile du tout : sur une bonne connexion, la reconnexion dure moins que le temps de lecture du message.
- Le problème se signale presque toujours par une capture d'écran (« pourquoi j'ai souvent cette erreur ? ») : lire la capture avant de chercher, elle donne le texte exact à retrouver dans le code.

## Ce qui ne marche pas

- Ajouter un délai avant d'afficher le voile (« ne l'affiche qu'après 2 secondes ») : cela masque le clignotement sans corriger la condition, et le cas de l'application muette reste entier.
- Vider les données reçues à la déconnexion pour « forcer » le voile à revenir : on obtient un écran qui se vide entièrement à chaque micro-coupure, et on perd la position de défilement et les saisies en cours.
- Se fier à `navigator.onLine` : il dit « en ligne » avec un serveur mort, un proxy en panne ou un portail Wi-Fi captif.
- Augmenter le délai de reconnexion pour « réduire le clignotement » : l'application met simplement plus longtemps à revenir.
- Conclure sur le seul code sans rejouer les deux passages du navigateur : les deux cas se ressemblent dans le fichier et se distinguent seulement à l'écran.
