---
name: documents-etrangers-retrouves-par-le-sens
description: À utiliser quand une recherche par le sens (vecteurs multilingues type e5) doit retrouver des documents écrits dans une autre langue, ou trop vaguement, pour les demandes qu'on lui pose — « les fiches importées en anglais ne ressortent jamais », « la bonne réponse est classée 40e », « le seuil qui marchait ne propose plus rien depuis qu'on a ajouté des documents » — ou quand il faut choisir un seuil pour décider s'il y a QUELQUE CHOSE à proposer.
etat: active
themes: recherche, ia, donnees
symptomes: documents en anglais jamais retrouvés, bonne réponse classée loin, seuil qui ne propose plus rien, trop de propositions hors sujet, résumer une collection en français
---

# documents-etrangers-retrouves-par-le-sens

## Symptôme

Une recherche par le sens classe loin des documents pourtant pile sur le sujet, parce qu'ils sont décrits en anglais (ou de façon générique) alors que les demandes sont en français et dites autrement. Ou bien une règle « proposer si le premier se détache des autres » qui marchait cesse de proposer quoi que ce soit après l'ajout de nombreux documents.

## Cause

Un vecteur multilingue rapproche les langues, mais mal : la tête du texte vectorisé pèse le plus, et un mode d'emploi long dilue le reste. Les cosinus sont compressés (0,83 à 0,89 que le document corresponde ou non) : aucun seuil ABSOLU ne sépare, seul l'écart entre le premier et le suivant le fait — et cet écart rétrécit quand la foule comparée grossit (0,014-0,025 avec 150 documents, 0,010-0,012 avec 1 200).

## Procédure

1. Mesurer AVANT : une dizaine de demandes réelles avec le document attendu (et deux ou trois sans document attendu), le rang du document par le sens, et l'écart premier-second. Garder le script et le jeu de cas pour rejouer.
2. Faire rédiger par un petit modèle bon marché, EN UN LOT, un résumé « À utiliser quand… » (une à trois phrases) et quatre à huit demandes courtes, dans la langue des demandes ; sortie JSON stricte, vérifiée à l'arrivée (début imposé, bornes de longueur, pas de virgule dans une demande), coût réel relevé appel par appel. Ordre de prix mesuré : ~0,0004 $ par document avec un modèle « flash-lite ».
3. Ranger ce résumé dans un champ À PART, jamais à la place du texte d'origine (qui peut revenir d'une source), et le mettre EN TÊTE du texte vectorisé ; garder le texte d'origine, borné, plus loin (ses mots restent cherchables).
4. Revectoriser, remesurer, puis régler le seuil d'écart AU MILIEU entre la plus petite marche d'une demande juste et la plus grande d'une demande sans réponse.
5. Rendre le nouveau champ idempotent : un document résumé n'est jamais renvoyé au modèle, et une relecture qui ne change rien n'écrit pas de nouvelle version.

## Vérification

Rejouer le script de mesure : le document attendu remonte (sur la carte Beluga dd481232 : en tête 3/11 → 5/11, dans les cinq premiers 6/11 → 8/11 ; une fiche anglaise de 39e à 1re) et les demandes sans réponse ne reçoivent toujours aucune proposition. Deux synchronisations de suite n'écrivent aucune version de plus.

## Pièges

- Un document DÉJÀ bien décrit dans la langue des demandes peut perdre un peu de proximité avec son résumé : le gain vient des documents étrangers ou vagues.
- Allonger la liste de symptômes peut faire reculer un document (dilution) : mesurer, ne pas empiler.
- L'écart au z-score (premier contre moyenne de la foule) ne sépare pas mieux que la marche premier-second.
- Un seuil d'écart réglé sur une petite foule ne propose plus rien quand la foule décuple : remesurer après chaque ajout massif.
- Une liste de « sujets » coupée par la base mais pas par la comparaison « déjà à jour ? » fait écrire une version à chaque passage.
