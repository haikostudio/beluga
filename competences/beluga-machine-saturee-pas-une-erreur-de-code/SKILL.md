---
name: beluga-machine-saturee-pas-une-erreur-de-code
description: À utiliser dès qu'une construction, un contrôle ou un lancement d'agent échoue avec « Cannot fork », EAGAIN, ENOMEM, posix_spawn ou un plafond de tâches, ou avant d'appeler un agent de dépannage sur un échec de publication : « la publication échoue sans erreur de code », « le moteur ne démarre pas », « fork impossible », « la carte s'arrête net à l'ouverture de sa copie de travail ». Distingue une machine saturée d'une vraie erreur de code.
etat: active
themes: beluga, saturation, publication, fork, processus
symptomes: Cannot fork (EAGAIN), ENOMEM au lancement, posix_spawn en échec, spawn git EAGAIN à l'ouverture de la copie de travail, plafond de tâches atteint, construction ou contrôle qui échoue sans message de compilation, moteur d'agent « qui ne démarre pas », dépannage automatique qui aggrave la panne
projets: Beluga
---

# beluga-machine-saturee-pas-une-erreur-de-code

## Cause

Le 2026-09-08 une saturation machine (refus de fork) a été confondue avec une erreur de code : l'appel d'un agent de dépannage sur ce chemin a DOUBLÉ la saturation (MEM-1294). EAGAIN au fork vient du plafond du nombre de processus (TasksMax du service, scripts/beluga.service), pas de la mémoire vive (MEM-0928). La table des processus est pleine : rien n'est cassé, la place revient dès qu'un agent voisin finit.

## Procédure

1. Trier d'abord : la règle pure `machinePleine` / `panneDeLaMachine` (paquet shared, raison `RAISON_MACHINE_SATUREE`) sépare un refus de lancement de processus (Cannot fork, EAGAIN, ENOMEM, posix_spawn, plafond de tâches) d'un vrai avis sur le code, la compilation ou la construction.
2. Refus de lancement = machine saturée : les étapes de compilation, de contrôles et de construction ATTENDENT puis REJOUENT au lieu de tomber en échec. Jamais d'agent de réparation de code sur ce chemin : il ajoute de la charge.
3. Même règle à l'OUVERTURE DE LA COPIE DE TRAVAIL d'une carte (`git worktree add` dans server/src/scheduler.ts) : un « spawn git EAGAIN » est une panne passagère qui se retente, pas un dossier cassé — le chemin du moteur et celui de la copie de travail disent la même chose.
4. Le refus final nomme le serveur comme responsable et disculpe le code ; le message dit clairement que la cause est la machine hôte, pas le moteur ni son installation, et le tour se retente comme une panne passagère.
5. Levier pour soulager : suspendre des agents au travail (comme pour la mémoire) ; le plafond de tâches se lit dans scripts/beluga.service.
6. Ne rien redémarrer tant qu'une publication ou une tâche tourne : attendre que la charge redescende.
7. Ne jamais confondre avec un manque de quota d'un compte, qui se traite séparément.

## Vérification

Dans le dépôt de Beluga, après `npm run build` : `node --test server/dist/test/machine-pleine-au-lancement.test.js server/dist/test/depannage-publication.test.js server/dist/test/familles-d-erreur.test.js` (tous inclus dans `npm test`) au vert. Le premier prouve que les erreurs relevées en base (« spawn git EAGAIN »…) sont reconnues comme une machine pleine et que l'ouverture de la copie de travail se retente ; le deuxième (« à la chute : un arrêt manuel, une saturation, ou un plafond atteint n'ouvrent aucun agent ») qu'aucun agent de dépannage ne part sur une saturation ; le troisième que le message range la panne dans la bonne famille.

## Pièges

- Lancer un agent de dépannage face à un EAGAIN : la charge double.
- Accuser la mémoire vive alors que c'est la table des processus.
- Afficher « erreur de code » à l'utilisateur pour une saturation.
- Traiter l'échec de `git worktree add` comme définitif : la carte s'arrêtait net et il fallait recliquer.

## Ce qui ne marche pas

2026-09-08 : saturation prise pour une erreur de code, dépannage lancé, saturation doublée.
