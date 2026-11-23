---
name: retour-oauth-localhost-rejoue-par-le-serveur
description: À utiliser dès qu'une application web doit connecter, SANS terminal, un outil en ligne de commande qui tourne sur un serveur et dont la connexion OAuth renvoie vers http://localhost:<port>/callback (Codex, gh, gcloud…) : « la page finit sur une erreur localhost », « le code d'appareil est refusé », « il a fallu rejouer l'adresse avec curl sur le serveur ».
etat: active
themes: authentification, serveur, oauth
symptomes: la page de connexion renvoie vers localhost et affiche une erreur, il faut un terminal pour finir la connexion, le code d'appareil est refusé, la connexion part dans le mauvais dossier
---

# retour-oauth-localhost-rejoue-par-le-serveur

## Symptôme

Le navigateur de l'utilisateur finit sur « impossible de se connecter à localhost:1455 » : le retour OAuth vise la machine de l'utilisateur alors que l'outil attend sur le serveur. Le mode « code d'appareil » contourne le problème mais le fournisseur peut le refuser.

## Cause

L'outil ouvre un petit serveur local (souvent sur un port FIXE) et donne au fournisseur une adresse de retour localhost. Seul le serveur peut joindre ce port ; l'adresse de la page d'erreur, elle, porte déjà le code et le state.

## Procédure

1. Lancer la connexion de l'outil sur le serveur avec BROWSER=true (pas de navigateur), le dossier de configuration du BON compte (ex. CODEX_HOME), NO_COLOR.
2. Lire sa sortie : garder la première adresse NON locale (l'outil imprime souvent d'abord http://localhost:<port>) et en extraire le state.
3. Montrer à l'utilisateur un bouton vers cette adresse, puis un champ « collez l'adresse de la page d'erreur ».
4. Valider l'adresse collée sans exiger sa forme exacte (espaces, sans http://, localhost ou 127.0.0.1) : chemin du callback, code présent, state ÉGAL à celui de la tentative en cours ; un error= du fournisseur se dit en clair.
5. Rejouer seulement le chemin + paramètres sur http://127.0.0.1:<port> depuis le serveur (fetch, redirect manuel, délai court), puis laisser la fin du processus conclure (code 0 = réussi).
6. Port fixe = une seule tentative sur toute la machine : arrêter l'ancienne (SIGTERM puis SIGKILL), attendre que le port se libère, sinon dire qu'il est occupé.
7. Après réussite, faire un vrai petit appel de l'outil pour prouver qu'il marche, au lieu de croire la présence du fichier d'identifiants.

## Vérification

Un contrôle de bout en bout avec un faux binaire qui imprime l'adresse avec un state aléatoire, écoute sur un port d'essai, refuse un mauvais state et écrit ses identifiants sur le bon : une adresse ancienne est refusée, la bonne termine la connexion, l'appel réel répond.

## Pièges

Rejouer un state périmé fait échouer l'outil et l'arrête (« state mismatch ») : valider AVANT de rejouer. Ne jamais journaliser le state ni le code. Ne pas copier un fichier d'identifiants d'un dossier à l'autre : les jetons de renouvellement tournent, deux détenteurs se coupent — déplacer. Pour les essais, rendre le port remplaçable par une variable et utiliser un faux binaire.

## Ce qui ne marche pas

Afficher une aide statique « activez tel réglage chez le fournisseur » : l'utilisateur reste bloqué. Demander de lancer curl sur le serveur : exige un terminal.
