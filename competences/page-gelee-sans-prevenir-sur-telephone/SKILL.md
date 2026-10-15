---
name: page-gelee-sans-prevenir-sur-telephone
description: À utiliser dès qu'une application web temps réel (WebSocket, SSE, PWA installée) reste figée au retour sur téléphone : « sur iPhone l'app ne se met plus à jour quand je reviens », « il faut fermer l'application pour voir l'état réel », « ça marche après 40 secondes ». À utiliser aussi avant d'écrire un contrôle qui doit rejouer ce gel dans un vrai navigateur. Dit comment reconnaître un gel que le système n'annonce pas, comment refaire le canal, et comment le prouver avec Playwright sur WebKit et Chrome.
etat: active
themes: mobile, temps-reel, navigateur, tests, interface
symptomes: application figée au retour sur iPhone, il faut tuer l'application pour la rafraîchir, mise à jour au bout de 40 secondes, canal WebSocket ouvert mais muet après verrouillage
---

# page-gelee-sans-prevenir-sur-telephone

## Symptôme

L'application est ouverte, puis le téléphone se verrouille ou passe à une autre application. On revient : l'écran montre l'état d'avant et rien n'arrive. Fermer puis rouvrir l'application règle le problème.

## Cause

iOS, et parfois Android, GÈLE la page sans toujours émettre `visibilitychange`, `pagehide` ou `freeze`. La connexion réseau meurt sans que `onclose` arrive : `readyState` reste `OPEN`. Au retour, la logique « page revenue à l'écran » ne se déclenche pas, puisqu'aucun départ n'a été vu. Seul un battement applicatif (un ping) finit par déclarer le canal mort, souvent après plusieurs dizaines de secondes.

## Procédure

1. Poser une horloge TÉMOIN : un `setInterval` léger, par exemple toutes les 2 s, qui retient l'heure de son dernier battement. Il ne bat que page visible : un onglet caché a des minuteries ralenties, qui passeraient pour un gel.
2. Juger le gel par une règle pure : un écart réel ≥ un seuil (par exemple 10 s, au moins quatre fois le pas) entre deux battements. Le seuil laisse de la marge à un fil principal simplement occupé.
3. Vérifier à deux endroits :
   - au battement lui-même : la minuterie en retard se déclenche dès la reprise ;
   - sur `focus`, `pageshow` et `resume`, même quand aucun départ n'a été vu.
4. Sur gel, refaire le canal de la même façon qu'au retour d'une veille annoncée : fermer le vieux socket APRÈS l'avoir détaché de ses écouteurs, ouvrir le neuf, redemander l'état complet. Ne jamais compter l'heure de coupure depuis le gel : pas de message « serveur injoignable » au réveil.
5. Ne pas reconnecter à chaque `focus` : seul un vrai trou dans l'horloge le justifie, pour épargner la batterie et le réseau.

## Vérification

Contrôle Playwright, faisable sur WebKit (iPhone émulé) comme sur Chrome (Android émulé) :
1. Avant le chargement, appeler `page.clock.install()`. L'horloge s'écoule alors normalement.
2. Avec `page.routeWebSocket(/\/ws$/, …)` et `connectToServer()`, relayer les messages, et pouvoir rendre un canal MUET dans les deux sens sans le fermer : c'est la route morte.
3. Afficher l'écran, puis rendre le canal muet et appeler `page.clock.pauseAt(heureDeLaPage + 200)`. C'est le gel : aucun événement de visibilité n'est émis.
4. Pendant le gel, modifier l'état par un autre client.
5. Appeler `page.clock.fastForward(20000)`, puis `page.clock.resume()`. Mesurer le délai avant que l'écran montre le changement.

Faire toujours une contre-épreuve avec l'ancienne version de l'interface : elle doit échouer, sinon le contrôle ne prouve rien. Preuve : Beluga, carte 1daa4d96, commit c41ae4c8, `scripts/verif-retour-apres-gel.mjs` : 0,1 à 0,2 s après correction, 41 s avant, sur les deux moteurs de navigateur.

## Pièges

- Un contrôle qui gèle seulement les minuteries sans couper le canal ne prouve rien : les messages mis en attente arrivent à la reprise, et l'ancienne version passe aussi.
- `Debugger.pause` en CDP ne fonctionne que sous Chrome ; l'horloge factice de Playwright fonctionne aussi sous WebKit.
- Un ordinateur sorti de veille produit le même trou d'horloge, et la reconnexion y est voulue.
- Sur mobile, la page d'accueil n'est pas forcément l'écran à observer : ouvrir directement l'adresse de l'écran voulu.

## Ce qui ne marche pas

- Compter sur `visibilitychange`, `pagehide` ou `freeze` : l'iPhone peut ne rien dire du tout.
- Attendre le battement applicatif : 20 s de période et deux pings manqués donnent environ 40 s d'écran figé.
- Reconnecter à chaque `focus` : coûteux en batterie, et sans effet sur un gel sans retour de focus.
