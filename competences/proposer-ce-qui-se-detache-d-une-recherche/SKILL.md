---
name: proposer-ce-qui-se-detache-d-une-recherche
description: À utiliser dès qu'une recherche par le sens (vecteurs, RAG, recherche hybride mots et sens) doit décider S'IL Y A quelque chose à proposer, et pas seulement classer : suggestion automatique, encadré « ceci pourrait vous servir », déclenchement d'une action sur le meilleur résultat. Symptômes : « il propose toujours quelque chose, même hors sujet », « le meilleur score est le même pour une bonne et une mauvaise réponse », « aucun seuil de similarité ne marche ». Donne la mesure qui sépare et la façon de la régler sur des cas réels.
etat: active
themes: agents, methode, donnees
symptomes: la suggestion automatique propose toujours quelque chose même hors sujet, le meilleur score de recherche est le même pour une bonne et une mauvaise réponse, aucun seuil de similarité cosinus ne sépare le pertinent du bruit, trop de propositions inutiles
---

# proposer-ce-qui-se-detache-d-une-recherche

## Symptôme

Une fonction s'appuie sur une recherche par le sens pour proposer d'elle-même un document. Elle propose à chaque fois, y compris quand rien ne correspond, et l'on cherche en vain un seuil de score qui la fasse taire.

## Cause

Deux raisons se cumulent.
1. Un score de classement n'est pas une mesure. Une recherche hybride normalise souvent par le rang : le premier résultat vaut toujours à peu près la même chose, qu'il réponde ou non.
2. Les modèles de vecteurs de la famille e5 compressent leurs cosinus dans une bande étroite (0,80 à 0,90). Mesuré sur un pool d'environ 150 documents : 0,85 à 0,895 pour un document qui tombe pile, 0,85 à 0,87 pour le moins mauvais d'une demande sans réponse. Les deux bandes se recouvrent.
Ce qui diffère, c'est la FORME de la tête de liste : un document qui correspond se détache des suivants (0,014 à 0,025 d'écart), alors que sur une demande sans réponse les premiers se suivent de près (0,001 à 0,009).

## Procédure

1. Calculer le cosinus brut entre la demande et TOUS les documents candidats (la foule), pas seulement les premiers.
2. Trier, puis chercher la dernière « marche » parmi les N premières places (N = le nombre maximal de propositions) : un écart d'au moins un seuil entre deux voisins. Ce qui précède la marche est saillant ; sans marche, ne rien proposer.
3. Exiger l'accord d'un second signal indépendant : le document saillant doit aussi figurer en tête de la recherche par les mots (ou de la recherche hybride).
4. Refuser de conclure sous un nombre minimal de documents comparés : « se détacher de la foule » ne veut rien dire à trois.
5. Régler le seuil sur des demandes RÉELLES, moitié avec une bonne réponse connue, moitié sans aucune : relever pour chacune les cinq premiers cosinus et choisir l'écart qui sépare les deux groupes. Refaire la mesure quand le modèle de vecteurs ou la taille du pool change.
6. Sans mesure par le sens (modèle absent, délai dépassé), ne rien proposer plutôt que retomber sur le classement.
7. Garder la règle pure (une fonction qui reçoit des nombres) et la tester avec des listes écrites à la main.

## Vérification

Sur l'échantillon de réglage : compter les propositions justes, les discutables, et les propositions faites sur les demandes sans réponse — ce dernier chiffre doit être nul. Cas d'origine (Beluga, 2026-10-05, seuil d'écart 0,012, accord exigé dans les cinq premiers de la recherche hybride, seize demandes) : neuf justes, une discutable, zéro sur sept demandes sans réponse.
Tests de la règle pure : une tête détachée est proposée seule ; deux têtes au-dessus de la marche partent ensemble ; quatre premiers serrés ne proposent rien ; une tête saillante absente du second signal est écartée.

## Pièges

— Les longues demandes (titre, description, mots-clés) compressent encore plus les cosinus : mesurer aussi sur des demandes longues.
— La foule doit être la même à chaque mesure : retirer les documents qu'on ne proposerait de toute façon pas (ceux d'un autre projet) change les écarts.
— Un document déjà proposé reste dans la foule pour le calcul, et n'est retiré qu'après.
— Un juge par modèle de langage en renfort n'est utile que s'il est réellement allumé : vérifier son état avant de compter dessus.

## Ce qui ne marche pas

— Un seuil sur le score pondéré de la recherche hybride : il laissait tout passer.
— Un seuil sur le cosinus absolu : une demande sans rapport atteignait la même valeur qu'une bonne réponse.
— Proposer « les trois premiers » : trois propositions à chaque demande, dont la plupart hors sujet.
