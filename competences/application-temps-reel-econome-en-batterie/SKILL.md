---
name: application-temps-reel-econome-en-batterie
description: À utiliser dès qu'une application web temps réel (WebSocket, SSE, canal permanent, PWA installée) vide la batterie ou fait chauffer le téléphone : « l'app chauffe même quand je ne la regarde pas », « la batterie fond avec l'onglet ouvert », « l'écran rame quand beaucoup d'événements arrivent ». À utiliser AUSSI avant d'ajouter un `setInterval`, un sondage régulier ou une diffusion à tous les clients. Dit quoi couper hors écran, comment se réveiller sans fausse alerte, comment trier ce que le serveur envoie et comment mesurer avant/après.
etat: active
themes: mobile, navigateur, temps-reel, interface, tests
symptomes: le téléphone chauffe avec l'application ouverte, la batterie fond avec l'onglet en arrière-plan, l'application travaille encore écran verrouillé, l'écran rame quand les événements arrivent en rafale, une alerte de connexion s'affiche au retour sur l'onglet
---

# application-temps-reel-econome-en-batterie

## Symptôme

Une application à canal permanent consomme même quand personne ne la regarde : onglet caché, fenêtre recouverte ou téléphone verrouillé, elle continue de recevoir, de ranger et de redessiner. À l'écran, elle se redessine à chaque événement reçu, y compris pour des données qu'elle n'affiche pas.

## Cause

Quatre sources s'additionnent. Le canal reste ouvert hors écran, avec son battement de cœur et sa reconnexion automatique. Des minuteries à la seconde et des sondages réguliers tournent sans regarder si la page est visible. Le serveur diffuse tout à tous les clients, sans savoir ce que chacun affiche. Le magasin d'état prévient tous ses abonnés à chaque message, donc un flux de vingt messages par seconde fait vingt redessins complets par seconde.

Le navigateur ne règle rien seul : page cachée, il ralentit les minuteries à une par seconde mais laisse le canal recevoir et le code s'exécuter.

## Procédure

1. MESURER D'ABORD, dans un vrai navigateur, sur un serveur d'essai. Compter par CDP `Performance.getMetrics` (TaskDuration, ScriptDuration, RecalcStyleCount, LayoutCount), envelopper `setInterval` / `setTimeout` dans un script d'initialisation pour compter les battements, et poser un faux `__REACT_DEVTOOLS_GLOBAL_HOOK__` dont `onCommitFiberRoot` compte les redessins (il marche aussi en version de production). Injecter une rafale d'événements par `page.routeWebSocket`. Trois temps : au repos, en rafale, page cachée.

2. SÉPARER DEUX SIGNAUX. « Page cachée » (immédiat) arrête horloges et sondages. « En veille » (après un délai de quelques secondes, pour ne pas couper sur une bascule d'une seconde) ferme le canal. Écrire la décision en règle pure testable : cachée depuis quand, combien de gardes actifs, page gelée ou non.

3. ÉCOUTER TOUS LES ÉVÉNEMENTS DE CYCLE DE VIE : `visibilitychange`, `pagehide` / `pageshow`, `freeze` / `resume`, `focus`. Un téléphone gèle une page sans toujours émettre `visibilitychange`.

4. FERMER LE CANAL SOI-MÊME, SANS QUE CE SOIT UNE COUPURE. Remettre `onopen`, `onclose`, `onmessage`, `onerror` à `null` AVANT `close()`, sinon la reconnexion automatique repart. N'incrémenter aucun compteur de panne, ne poser aucune heure de coupure, annuler le minuteur de reconnexion, et faire refuser toute ouverture de canal tant que la veille dure.

5. SE RÉVEILLER PAR LE CHEMIN DE RECONNEXION EXISTANT. Poser l'heure de coupure à l'instant du réveil : si le serveur ne répond vraiment pas, le message paraît après son délai ordinaire, pas avant. Une page gelée qui aurait dû dormir (ses minuteries ne tournaient plus) passe par la veille au retour, pour remplacer tout de suite un canal probablement mort.

6. DÉCLARER LES EXCEPTIONS PAR DES GARDES. Ce qui doit continuer écran éteint (appel vocal, enregistrement, lecture audio) enregistre une fonction « suis-je actif ? ». La veille ne connaît pas ces fonctions par leur nom ; elle compte les gardes actifs et repose la question à intervalle lent.

7. UNE HORLOGE PARTAGÉE. Un seul intervalle par rythme pour toute la page, alimenté par abonnement, retiré quand personne n'écoute ou que la page est cachée, avec un battement immédiat au retour. Interdire `setInterval` dans les composants.

8. TRIER À L'ENVOI, CÔTÉ SERVEUR. Garder la diffusion à tous pour les événements légers (listes, compteurs, alertes). Pour les événements volumineux et fréquents, tenir par connexion ce que l'écran regarde, déduit de ses propres demandes d'ouverture, et n'envoyer que cela. Le serveur oublie tout à chaque connexion : le client garde la même liste et la redit après chaque reconnexion. Dans le doute, envoyer.

9. REGROUPER LES AVIS, PAS L'ÉTAT. Le magasin pose l'état immédiatement ; seul l'avis aux abonnés est limité (un toutes les 100 ms environ) pour ce qui vient du canal. Un événement isolé part sans attendre, un geste de l'utilisateur prévient tout de suite.

10. FIGER LES ANIMATIONS SANS FIN en veille : une classe sur `<html>` et `animation-play-state: paused !important` sur tous les éléments.

## Vérification

Rejouer la mesure de l'étape 1 sur les deux versions, plusieurs passages alternés, sur le même serveur d'essai. Attendus page cachée après le délai : canal fermé, 0 message reçu, 0 battement de minuterie, 0 animation en cours (`document.getAnimations()` filtré sur `playState === 'running'`). Attendus au retour : canal rouvert en quelques dizaines de millisecondes, aucune phrase d'alerte de connexion à l'écran, aucune erreur JavaScript. En rafale : le nombre de redessins par seconde doit tomber vers le plafond choisi.

Un navigateur sans fenêtre ne cache jamais sa page : redéfinir `document.visibilityState` et `document.hidden` dans un script d'initialisation, puis émettre `visibilitychange` à la main.

Cas d'origine (Beluga, 04.10.2026, 30 événements par seconde) : 47 redessins par seconde avant, 15 à 20 après ; 129 à 144 ms de script par seconde avant, 49 à 80 après ; page cachée, de 7 intervalles vivants à 0.

## Pièges

- Fermer le canal sans détacher `onclose` : la reconnexion automatique le rouvre aussitôt, et la veille ne tient pas.
- Poser l'heure de coupure à l'endormissement : au retour, l'alerte « serveur injoignable » s'affiche immédiatement.
- `requestAnimationFrame` pour regrouper : il ne tourne pas page cachée, donc plus rien n'est annoncé pendant le délai d'avant veille ni pendant un appel vocal écran éteint.
- Injecter des événements côté page contourne le tri du serveur : la mesure ne prouve que le regroupement, le tri se prouve par des tests de sa règle.
- Une requête en attente au moment de la veille expire : ne pas la compter comme un échec réseau.
- Après un tri côté serveur, tout composant qui lit des données « de détail » sans les avoir demandées cesse d'être mis à jour : recenser ces lecteurs avant de trier.
- Les chiffres varient fortement d'un passage à l'autre sur un serveur sans carte graphique : comparer des versions, pas des valeurs.

## Ce qui ne marche pas

- Compter sur le bridage des onglets cachés par le navigateur : il ne ferme pas le canal et n'empêche pas le code de traiter chaque message.
- Baisser seulement la fréquence des minuteries : le coût dominant vient des redessins déclenchés par les événements, pas des minuteries.
- Mesurer un seul passage : l'écart entre deux passages de la même version peut dépasser le gain cherché.
