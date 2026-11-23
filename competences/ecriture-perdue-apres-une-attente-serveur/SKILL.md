---
name: ecriture-perdue-apres-une-attente-serveur
description: À utiliser dès qu'un serveur Node lit un enregistrement composé (un message qui porte une liste, un document JSON), attend quelque chose (await), puis réécrit l'enregistrement entier : « la seconde validation efface la première », « deux clics rapprochés, un seul compte », « la décision réapparaît en attente alors que la table dit faite ».
etat: active
themes: serveur, base de données, concurrence
symptomes: décision effacée, élément revenu en attente, une carte créée mais proposée de nouveau, deux actions rapprochées dont une disparaît
---

# ecriture-perdue-apres-une-attente-serveur

## Cause

Mise à jour perdue : le traitement A lit l'objet entier, attend (réseau, import, création), le traitement B fait de même sur un AUTRE élément du même objet, puis chacun réécrit l'objet depuis SA copie. Le dernier écrit gagne et efface l'autre. Un verrou par élément ne protège pas : il faut sérialiser l'écriture de l'objet.

## Procédure

1. Repérer le motif : lecture de l'objet → await → save({...objet, liste: objet.liste.map(...)}).
2. Écrire une fonction de stockage qui, dans UN bloc synchrone (transaction better-sqlite3, ou UPDATE ciblé json_set), relit l'objet, remplace le seul élément visé et réenregistre ; elle rend l'objet à jour pour la diffusion.
3. Remplacer tous les « save depuis la copie » par cette fonction, y compris dans les chemins voisins (réglages, retraits automatiques, traitements de nuit).
4. Si une table séparée garde aussi la décision, en faire la garde anti-doublon : décision déjà prise → rendre « déjà fait » et resynchroniser l'objet, sans refaire l'action.
5. Réparer l'existant par un rattrapage idempotent table → objet, qui ne recopie que décision, identifiant lié et heure.

## Vérification

Test : deux traitements lancés par Promise.all sur deux éléments du même objet, chacun avec une attente simulée (setTimeout) entre lecture et écriture ; l'objet relu porte les deux décisions. Rattrapage lancé deux fois sur une copie de la vraie base : un seul objet réécrit, puis zéro. Preuve dans Beluga : carte 7dd54d46 (« Carte créée qui se repropose »), commit 34051ad4.

## Pièges

Placer la relecture AVANT l'await ne sert à rien : relecture et écriture doivent être dans le même bloc synchrone. Le rattrapage ne doit jamais refaire l'action (créer une carte, envoyer un message) ni écraser un titre retouché. Ne pas réécrire à l'aveugle un élément dont la décision diffère des deux côtés.
