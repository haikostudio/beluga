---
name: fusion-d-un-lot-de-branches-prouvee
description: À utiliser dès qu'un script ou un serveur fusionne automatiquement plusieurs branches de travail (une par tâche, ticket ou carte) dans une branche d'accueil puis marque ces tâches comme livrées : « une tâche est marquée livrée mais son travail n'est pas en ligne », « la branche n'existe que sur GitHub et a été sautée », « la fusion dit OK mais le code manque ».
etat: active
themes: git, deploiement
symptomes: tâche marquée livrée sans son code, branche sautée en silence, branche présente seulement sur le distant, archivage à tort après un déploiement
---

# fusion-d-un-lot-de-branches-prouvee

## Symptôme

Après une fusion automatique de lot, une tâche est archivée comme livrée alors que son travail n'est pas dans la branche d'accueil.

## Cause

Le script cherche la branche avec `git rev-parse --verify <branche>` dans le seul dossier local : une branche poussée depuis une autre machine (ou un autre clone) n'y existe pas, est sautée par un `continue`, et la suite du script « livre » tout le lot sans distinguer les tâches réellement fusionnées.

## Procédure

1. Pour chaque branche : `git fetch origin <b>` (borné dans le temps, erreur tolérée), puis lire `refs/heads/<b>` ET `refs/remotes/origin/<b>` en n'acceptant qu'un sha (`/^[0-9a-f]{7,40}$/` — un dépôt sans distant rend du texte d'erreur).
2. Seule sur le distant : `git branch <b> origin/<b>` (jamais de checkout, on est posé sur l'accueil). Locale ancêtre stricte du distant (`git merge-base --is-ancestor local distant`) : `git branch -f <b> origin/<b>` ; si refusé (branche tenue par un worktree), fusionner `origin/<b>` directement. Locale en avance ou divergente : la locale fait foi.
3. Relever le sha à fusionner AVANT la fusion.
4. Après la fusion (et toute résolution de conflit), prouver : `git merge-base --is-ancestor <sha relevé> HEAD`.
5. Ne marquer livrée / archiver QUE les tâches prouvées. Introuvable partout (tous les dépôts d'un projet multi-dépôts) ou non prouvée : laisser la tâche en attente, avec sa raison écrite.

## Vérification

Monter un distant nu (`git init --bare`) et un clone de travail dans un dossier temporaire ; pousser une branche depuis un SECOND clone uniquement ; lancer la fusion du lot et vérifier (a) que le fichier de cette branche est dans `git ls-tree -r dev`, (b) qu'une tâche à branche inexistante reste en attente sans date de livraison, (c) qu'une branche présente dans un seul dépôt d'un projet à deux dépôts passe. Exemple réel : scripts/verif-carte-prouvee-au-lot.mjs de Beluga (commit 220c3f78).

## Pièges

- Projet à plusieurs dépôts : une branche absente d'UN dépôt est normale ; juger l'absence après le tour de tous les dépôts.
- Une branche partagée par plusieurs tâches : les sœurs suivent le sort de la première.
- `git fetch origin a b c` échoue en bloc si une seule branche manque : une branche par appel.
- Ne jamais pousser ni créer de branche sur un dépôt public en lecture seule pendant ce rapatriement.
- Un lot où PLUS AUCUNE tâche ne passe doit faire échouer l'étape, pas réussir à vide.

## Ce qui ne marche pas

Se contenter du code de sortie de `git merge` : un recollage, une résolution automatique ou un retour arrière peuvent annoncer un succès sans que le travail soit dans la tête.
