---
name: beluga-competences-dans-le-flux-de-reflexion
description: À utiliser dès qu'on touche à l'affichage des compétences retenues d'une carte de Beluga (lignes violettes « Compétence utilisée », croix pour écarter) ou au trait vertical du flux dans la carte ouverte d'un passage : « les compétences sont en panneau collé au champ d'écriture », « une compétence n'apparaît dans aucun passage », « le trait de gauche se coupe devant voir les N précédentes ».
etat: active
themes: interface, cartes, journal, tests
symptomes: panneau de compétences collé au-dessus du champ d'écriture, compétence absente du flux, trait vertical coupé devant « voir les précédentes », compétence rangée deux fois, passage ne portant que des compétences qui ne s'ouvre pas
projets: Beluga
---

# beluga-competences-dans-le-flux-de-reflexion

## Symptôme

Les compétences retenues s'affichaient dans un panneau fixe au-dessus du champ d'écriture, hors du flux, et le trait vertical de la carte ouverte s'interrompait devant la ligne « voir les N précédentes ».

## Cause

Le panneau `data-panneau-competences` de parcours-carte.tsx était indépendant du flux. Le trait vit dans chaque ligne à point (`SousPointDuFlux`) ; la ligne de repli n'a pas de point, donc rien ne portait le trait vers le point suivant.

## Procédure

1. Source : `carte.parcours.competencesProposees` (démon, DEC-322, rien à changer côté serveur). 2. `rangerLesCompetences` (shared/src/parcours-en-points.ts) pose chaque compétence sur `PointDuParcours.competences` : dernier passage réellement ouvert (`debut`, jamais `annonce`) avant `proposeeLe`, à défaut le premier ; appelée après le passage du tour vivant, elle repart de zéro (aucune compétence deux fois). Le prédicat « point vide » et `aDuContenu` / `aDansLaCarte` (flux-en-points.tsx) la comptent, sinon un passage qui ne porte que des compétences ne s'ouvre pas. 3. `CompetencesDuPoint` (flux-en-points.tsx) rend une `SousPointDuFlux` `data-sous-point-flux="competence"` par compétence ; `CompetenceDuFlux` (encadre-competence.tsx) retrouve la question dans `cardMessages` et réutilise `EncadreCompetence` avec `ligne` (sans cadre) ; question absente : lecture seule, sans croix. Les repères `data-competence-etat`, `-titre`, `-ecarter` sont gardés. 4. Trait : la ligne « voir les N précédentes » (`data-blocs-repli-ligne`) porte son propre trait `-bottom-[17.5px] left-[11.5px] top-[5.5px]` (top-0 si première) pour relier le point précédent au suivant.

## Vérification

`npm run build && npm test` (parcours-en-points.test.ts : « une compétence retenue est rangée au passage ouvert avant elle, une seule fois ») ; à l'écran, avec le serveur de développement sur localhost, une carte en cadrage : lignes `[data-competence-etat="utilisee"]` dans la carte ouverte, aucun `[data-panneau-competences]`, trait continu devant `[data-blocs-repli]`.

## Pièges

`EncadresDeCompetences` reste utilisé par message-view.tsx (bulle du chat) : ne pas le retirer sans vérifier qu'une compétence n'y apparaît pas en double. Un trait à `bg-faint/40` qui se recouvre devient plus sombre : démarrer le trait de la ligne de repli là où le précédent s'arrête (5,5 px).

## Ce qui ne marche pas

Garder le panneau en le déplaçant : il resterait collé à l'écran. Ranger les compétences par étape seule : une seconde compréhension les afficherait deux fois.
