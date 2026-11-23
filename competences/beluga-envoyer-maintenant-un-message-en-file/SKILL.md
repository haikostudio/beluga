---
name: beluga-envoyer-maintenant-un-message-en-file
description: À utiliser dès qu'il faut faire partir un message resté en file d'attente (« Votre message part dès que l'agent a fini ») sans attendre la fin du travail de l'agent, ajouter un geste sur les messages en attente, toucher à la file des demandes d'un agent (dépilage, redémarrage du serveur qui la croise, reprise au démarrage), ou donner le curseur au champ d'écriture à l'ouverture d'un agent. Dit pourquoi on ne peut pas injecter en plein tour, comment couper en gardant la file, comment le redémarrage attend une demande qui part, et comment l'autofocus évite de voler le focus.
etat: active
themes: agents, interface, temps-reel
symptomes: un message capital reste en file pendant que l'agent réfléchit depuis longtemps, impossible d'envoyer un message pendant que l'agent travaille, le champ d'écriture n'a pas le curseur à l'ouverture d'un nouvel agent, un message en attente ne part jamais à la fin du travail et doit être recopié à la main, une bulle de demande reste sans réponse après un redémarrage du serveur
projets: Beluga
---

# beluga-envoyer-maintenant-un-message-en-file

## Symptôme

L'utilisateur écrit pendant que l'agent travaille : le message attend dans la file jusqu'à la fin du tour, parfois 17 minutes. À l'ouverture d'un nouvel agent, il faut cliquer dans le champ avant d'écrire. Et le 04/11/2026, un message en file n'est jamais parti à la fin du tour : sa bulle est restée sans réponse et l'utilisateur a dû le recopier.

## Cause

Les moteurs (`claude -p`, `cursor -p`) sont des processus à UN tour : aucun message ne s'injecte en plein tour. La file (`server/src/store.ts`, table `queue`, 10 demandes) ne se dépile qu'à la fin d'un tour (`enchainerLaFile`, `server/src/runtime.ts`). Le champ (`web/src/components/composer.tsx`) ne posait aucun focus à l'ouverture.

Pour le message perdu : `enchainerLaFile` EFFACE la demande (`dequeuePrompt` = DELETE), puis attend 400 ms avant `sendPrompt`. Pendant ce battement, l'agent n'était ni dans `live` ni dans `demarrant`. Le redémarrage retenu par une mise en ligne, rejoué par la même fin de tour (`appliquerRedemarrageEnAttente`), est parti à cet instant. La bulle s'est écrite, puis le processus est mort avant le moteur.

## Procédure

1. Commande `queue.send-now` (`shared/src/protocol.ts`, droit `file:id` dans `shared/src/droits-commandes.ts`, cas dans `server/src/ws.ts` à côté de `queue.remove`).
2. Elle refuse sous une carte en publication (`carteEnPublication`) et sur un agent arrêté sur sa question (`agentEnAttente`, DEC-086 : la couper ferait disparaître la question).
3. `store.remonterEnTete(id)` met la demande en tête (position = plus petite − 1) et lève `enEditionDepuis`, sinon `dequeuePrompt` la retient.
4. Agent au travail : pause de la carte si elle est en « running » (`mettreLaCarteEnPause`), puis `arreterLAgent`. C'est comme `agent.suspend`, mais SANS `clearQueue` : l'arrêt et la suspension vident la file AVANT la coupe ; ici, c'est la fin du tour coupé (et la fermeture d'autorité du chemin « secours ») qui dépile la file. La demande remontée part donc la première, sur la même session.
5. Agent libre : seulement `reprendreLaFile`.
6. Idempotent : une demande partie ne se remonte plus, rien n'est coupé. Aucun toast sur un succès.
7. Bouton dans `QueuedItem` : flèche entre le crayon et la corbeille, roue (`animate-spin`) dès le clic, `client.geste`.
8. Autofocus : effet sur `agent?.id`, délai de 60 ms (après le focus que rend le tiroir), grand écran seulement (`min-width: 640px`). Jamais si un champ de saisie est déjà actif, ni si l'écriture est gelée. Le texte et la sélection ne sont pas touchés.
9. Textes dans les cinq langues (`shared/src/traductions.ts`).
10. Du dépilage à l'appel de `sendPrompt`, l'agent est compté dans `enchainementEnVol` (lu par `agentsActifs()`). Le bouton de redémarrage, l'arrêt par signal et l'étape de redémarrage d'une publication attendent donc la demande qui part. Le `finally` du minuteur retire l'agent dans tous les cas. Si aucun tour n'est né (refus, agent disparu), il rejoue lui-même `appliquerRedemarrageEnAttente`.
11. Au démarrage, `recoverAfterRestart` remet en TÊTE de file (`enqueuePrompt` avec `messageId`, puis `remonterEnTete`) la dernière bulle humaine d'un agent trouvé `running`/`starting` qui n'a jamais atteint le moteur. C'est la règle `demandeCoupeeAvantLeMoteur` (`shared/src/demande-coupee.ts`) : aucune réponse après elle, pas de `sentContext`, moins de 30 min, pas déjà en file. Le filet des files en attente la renvoie sans seconde bulle (DEC-486).

## Vérification

`npm run build:server` puis `npm test`.
- `server/src/test/envoyer-maintenant.test.ts` (9 tests) : ordre de la file, idempotence, demande en édition, identité gardée, forme de la commande, pause avant coupe, file jamais vidée, bouton avec roue.
- `server/src/test/demande-coupee-au-redemarrage.test.ts` : la règle pure ; la bulle coupée remise en tête une seule fois, sans seconde bulle ; une demande dépilée qui retient le redémarrage, puis le laisse partir seule ; un second dépilage pendant le battement qui ne prend pas la suivante.

Navigateur :
1. Lancer un démon d'essai jetable depuis la copie de travail (voir `scripts/verify-ui.mjs`).
2. Cliquer `[data-ligne-nouvel-agent]` puis `[data-projet-nouvel-agent]` : `document.activeElement` doit être le champ « Expliquez ou précisez votre besoin… ».
3. Insérer deux demandes en base, puis cliquer sur `button[title="Envoyer maintenant"]` : la demande choisie part, l'autre (en édition) reste.
4. Puis lancer `node scripts/nettoyer-essais.mjs`.

## Pièges

- Ne PAS vider la file avant la coupe ici : c'est le contraire de DEC-042.
- Oublier de lever `enEditionDepuis` laisse la demande retenue, et rien ne part — POUR TOUJOURS depuis le 04/11/2026 (DEC-484). La modification n'a plus ni péremption ni maintien par canal : seuls Enregistrer / Annuler (`terminerEdition`) et « Envoyer maintenant » lèvent le repère. `remonterEnTete` efface aussi `brouillonEdition`.
- Une file non vide garde la carte en « En cours » (`FinDeTour.fileEnAttente`) et retient le déploiement. Elle NE retient PAS le redémarrage : la table survit, et `reprendreLesFilesEnAttente` la reprend. La compter bloquerait le redémarrage pour toujours sous une modification, une question ou un quota épuisé.
- Ne jamais ranger l'état « demande en partance » dans `demarrant` : `enchainerLaFile` comme `sendPrompt` sortent sur `demarrant.has`, et la demande ne partirait plus. Il faut un ensemble à part.
- `listMessages` rend l'ordre CHRONOLOGIQUE : il faut le retourner avant toute règle qui lit « le dernier message ».
- Le filet du démarrage ne joue pas quand la carte vient d'être rendue interrompue (`rendreLaCarteInterrompue` rend `true`) : elle repart déjà avec la demande de son tour (DEC-036), et le message serait doublé.
- Un message humain que le démon retire ou refuse revient au champ (`queue.rendue`, `viderLaFileEnRendant`). Ne jamais appeler `store.clearQueue` seul sur du texte de l'utilisateur.
- Un agent de cadrage a une carte en « Planifié » : la pause ne s'applique qu'à une carte en « running ».
- Ne pas utiliser un `pkill -f` portant le motif du démon d'essai (garde du démon). L'essai tourne sous le nom `beluga-essai-…` et peut ne pas obéir au premier signal.
- Le détecteur d'exports morts (`npm test`) échoue déjà sur d'autres symboles : ne pas l'attribuer à cette fonctionnalité.

## Ce qui ne marche pas

- Envoi direct par Entrée ou par raccourci clavier : écarté par l'utilisateur. Par défaut, un message écrit pendant le travail reste en file.
- Injecter dans le tour en cours : impossible avec ces moteurs.
- Ne plus effacer la demande au dépilage, et la marquer « partie » à la place : écarté, car cela ouvre des courses avec la modification et la suppression d'un message en file. L'ensemble `enchainementEnVol` et le filet du démarrage suffisent.
