---
name: jarvis-ouvrir-depuis
description: À utiliser quand l'utilisateur demande à Jarvis, à la voix, d'ouvrir ou d'afficher dans Beluga une proposition ou une décision qui attend sa validation : « Ouvrir depuis l’interface la proposition de test de sécurité hebdomadaire », « Afficher clairement la proposition de test de sécurité hebdomadaire », « montre-moi ce qui attend ma réponse ». Chemin déjà réussi 2 fois à l'écran, à rejouer par « assistant_ecran » « jouer » au lieu d'explorer.
etat: active
themes: jarvis, voix, interface
symptomes: Ouvrir depuis l'interface la proposition, Afficher clairement la proposition, montre-moi ce qui attend ma réponse, ouvre la décision en attente
projets: Beluga
---

# jarvis-ouvrir-depuis

## Symptôme

Demandes d'origine : « Ouvrir depuis l’interface la proposition de test de sécurité hebdomadaire » et « Afficher clairement la proposition de test de sécurité hebdomadaire ». Les deux phrasés visent la même chose : amener à l'écran la décision (carte proposée, plan) qui attend l'utilisateur.

## Procédure

Rejouer ce plan avec « assistant_ecran » « jouer » (adapter le texte et le projet à la demande) :

1. J’ouvre les décisions en attente — `cliquer` sur le repère dont le libellé commence par le nombre de décisions : `N décisions attendues de votre part` (ou `Une décision attendue de votre part` quand il n'y en a qu'une). Sur la ligne d'un projet de la colonne de gauche, le libellé se termine par « — cliquez pour y aller » ; la cloche du bandeau du haut porte le même texte sans cette fin.
2. Si plusieurs décisions sont listées, ouvrir celle dont le titre correspond à la demande (ici la proposition de test de sécurité hebdomadaire).

## Vérification

Chaque geste revient « fait » dans l'encadré « Jarvis agit sur l'écran » du module de voix, et la décision demandée est affichée à l'écran. Réussites : 2 (nuit du 2026-11-17, deux phrasés différents, chemins réunis au ménage des compétences ; l'ancienne fiche jarvis-afficher-clairement est archivée).

## Pièges

- Le nombre en tête du libellé change avec le nombre de décisions attendues (« 2 décisions… », « 3 décisions… », « Une décision… ») : un libellé recopié tel quel rate dès que le compte bouge. « lire » l'écran d'abord et viser le libellé du moment.
- Une cible qui a changé à l'écran se retrouve par « lire » avant de rejouer.
- Aucune décision attendue : le repère n'existe pas ; le dire à l'utilisateur plutôt que d'explorer.
