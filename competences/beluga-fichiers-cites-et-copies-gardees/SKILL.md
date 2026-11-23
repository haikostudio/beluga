---
name: beluga-fichiers-cites-et-copies-gardees
description: À utiliser dès qu'on touche à l'ouverture des fichiers cités par un agent ou à ce qui les garde : « fichier introuvable » dans la visionneuse, lien du fil mort après la fermeture d'une carte, copies de plus de 3 mois, nouveau motif d'absence à afficher.
etat: active
themes: fichiers, interface, stockage
symptomes: fichier introuvable, lien de fichier mort, copie de travail refermée, fichier disparu de /tmp
projets: Beluga
---

# beluga-fichiers-cites-et-copies-gardees

## Symptôme

Un chemin cité dans le fil ne s'ouvre plus, souvent parce que sa copie de travail est refermée ou que le dossier temporaire a été vidé.

## Cause

Le chemin écrit par l'agent décrit un endroit provisoire. Sur 747 chemins mesurés sur 3 jours, la moitié n'existaient plus tels quels (carte 0e351b8a).

## Procédure

1. Toute lecture passe par `resoudreFichierCite` : vivant, copie gardée (carte de l'agent puis projet), git, sinon motif.
2. Un motif nouveau s'ajoute à `MotifDeFichierAbsent`, à `raisonDeLAbsence` de l'écran et à ses cinq traductions.
3. Une source d'écriture nouvelle s'ajoute à `cheminEcritParUnOutil`.
4. La fiche `info=1` d'une copie garde le chemin DEMANDÉ dans `chemin`, pour que l'adresse suivante se résolve de la même façon.

## Vérification

`node --test server/dist/test/fichiers-cites.test.js server/dist/test/fichiers-conserves.test.js server/dist/test/fichiers-conserves-sans-disque.test.js`, puis `node scripts/verif-apercu-pdf.mjs` (16 vérifications, carte ouverte par son adresse directe).

## Pièges

Le fichier se LIT tout de suite, avant la fermeture de la copie de travail (`attendreLesLectures`) ; seule l'écriture sur le disque réseau passe derrière. Pas de copie sur le disque du serveur quand le stockage manque. Le filtre des secrets lit le nom ET le chemin réel. Le détecteur d'exports ne voit que les fichiers suivis par git : ajouter un nouveau module à l'index avant de le croire.
