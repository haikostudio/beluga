---
name: fichier-supprime-repris-de-l-historique-git
description: À utiliser quand un programme doit retrouver le dernier contenu d'un fichier disparu d'un dépôt git à partir d'un chemin non fiable : « git show échoue sur le dernier commit du fichier », « le fichier a été supprimé, comment le relire sans le restaurer ».
etat: active
themes: git, securite
symptomes: git show path does not exist, dernier commit vide pour un fichier supprimé
---

# fichier-supprime-repris-de-l-historique-git

## Symptôme

`git log -1 -- fichier` rend un commit où `git show <commit>:fichier` échoue.

## Cause

Le dernier commit qui touche un fichier supprimé est celui de sa suppression : le fichier n'y existe plus.

## Procédure

`git --literal-pathspecs -C <depot> log --all -1 --diff-filter=AM --format=%H -- <relatif>`, puis `git -C <depot> show <sha>:<relatif>`. Passer par un appel à arguments séparés, sans shell, avec un délai et un plafond de sortie.

## Vérification

Dans un dépôt d'essai : ajouter un fichier, le retirer par un second commit, et vérifier que la commande rend bien le contenu d'origine (test « revient par l'historique » de server/src/test/fichiers-conserves.test.ts dans Beluga).

## Pièges

Sans `--literal-pathspecs`, un `*` dans le chemin est un motif. Refuser `..` et les chemins absolus avant l'appel. Garder le résultat en copie : `--all` coûte cher à chaque clic sur un gros dépôt.
