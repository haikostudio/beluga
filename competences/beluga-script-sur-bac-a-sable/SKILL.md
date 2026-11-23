---
name: beluga-script-sur-bac-a-sable
description: À utiliser avant d'écrire ou de lancer un script de contrôle qui doit travailler sur un bac à sable de Beluga tout en lisant le vrai coffre, ou dès qu'un test laisse des traces (cartes d'essai, lignes) dans la base réellement servie : « mon script a écrit en production », « le contrôle a créé des cartes chez l'utilisateur », « BELUGA_DATA ignoré ». Explique le gel du dossier de données au premier import.
etat: active
themes: beluga, bac à sable, base de données, tests, coffre
symptomes: script de contrôle qui écrit dans la base de production, cartes d'essai visibles sur le tableau, coffre lu d'un autre dossier de données sans effet, BELUGA_DATA posé mais ignoré, état de production modifié par un essai
projets: Beluga
---

# beluga-script-sur-bac-a-sable

## Cause

server/src/config.ts fige le dossier de données au PREMIER import : poser BELUGA_DATA puis importer coffre-fort.js fige ce dossier pour tout le processus, donc un script qui lit ensuite un bac à sable écrit en réalité dans la base de production (MEM-0996, constaté le 30/08/2026 en écrivant scripts/verif-relais-llm.mjs).

## Procédure

1. Un script qui doit lire le coffre RÉEL et travailler sur un bac à sable lance la lecture du coffre dans un PROCESSUS SÉPARÉ (execFileSync('node', ['--input-type=module', '-e', …]) avec son propre BELUGA_DATA), puis fixe son propre dossier de données pour le reste.
2. Poser BELUGA_DATA AVANT tout import du serveur, jamais après.
3. Ne jamais lancer un contrôle à démon jetable depuis le dépôt principal : le faire depuis la copie de travail de la carte.
4. Ne jamais reprendre BELUGA_TOKEN ni BELUGA_URL (elle désigne l'application déjà publiée) : viser le serveur d'essai par une variable à soi ; utiliser env -u BELUGA_TOKEN.
5. Après un essai : node scripts/nettoyer-essais.mjs retire les cartes d'essai.
6. Pour une base SQLite lue depuis une copie de travail, voir la fiche trouver-la-base-reellement-servie ; pour lancer des scripts depuis une copie de travail, voir scripts-de-projet-lances-depuis-un-worktree.
7. Vérifier avant et après par un comptage (cartes, projets) dans la vraie base : les nombres doivent être identiques.

## Vérification

Compter les cartes et les projets de la vraie base avant et après le script : identiques ; node scripts/nettoyer-essais.mjs ne trouve plus de carte d'essai ; le script affiche le dossier de données réellement utilisé.

## Pièges

- Croire qu'assigner process.env.BELUGA_DATA après l'import change le dossier.
- Lancer le contrôle depuis le dépôt principal.
- Réutiliser le jeton de session de l'agent pour un serveur d'essai.

## Ce qui ne marche pas

30/08/2026 : verif-relais-llm.mjs écrivait dans la base réelle au lieu du bac à sable visé, sans message.
