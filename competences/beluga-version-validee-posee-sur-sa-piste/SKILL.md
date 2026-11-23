---
name: beluga-version-validee-posee-sur-sa-piste
description: À utiliser dès qu'on touche à ce qui suit une génération de média dans Beluga (mode Réalisation, création du Studio liée à une carte) : la question « Quelle version gardez-vous ? », l'image de préparation (Utiliser, Poser, Aucune), la validation d'un média qui le pose sur sa piste (une piste à lui, une piste par voix), la place annoncée par l'agent, le détourage, « Ajouter à la piste » et le glisser vers une piste, la question « Remplacer / Ajouter », ou le retrait de la validation. Symptômes : « aucune question après la génération », « validé mais invisible dans le film », « posé après la fin du film », « fond vert resté », « deux segments pour un même média », « l'agent pose deux fois la question », « version remplacée encore marquée Validé », « deux sons sur la même piste, impossible de les fondre », « deux voix mélangées sur une piste ».
etat: active
themes: studio, realisation, montage, questions
symptomes: aucune question de choix après la génération, média validé absent de la ligne de temps, média posé après la fin du film, fond vert resté sur une vidéo choisie, second segment après une pose à la main, réveil de l'agent en double, version remplacée encore marquée Validé, deux sons sur la même piste sans fondu possible, deux voix sur une même piste
projets: Beluga
---

# beluga-version-validee-posee-sur-sa-piste

## Symptôme

Une génération rend ses versions dans le fil, mais personne ne demande laquelle garder ; ou la version choisie n'apparaît pas à l'image (posée après la fin du film, ou avec son fond vert) ; ou un média déjà validé ne peut plus être ajouté à une piste ; ou deux éléments partagent une piste et ne peuvent ni se chevaucher ni se fondre.

## Cause

Les lots à bouton sont suivis par le démon seul (DEC-437) : l'agent n'est plus dans le tour quand la génération finit. La pose se faisait « à la suite des visuels », sans regarder la durée du film (cas réel : 22,81 s dans un film de 22,8 s), et aucun détourage n'existait. Deux chemins fabriquent des médias du Studio différents pour une même pièce : la validation (fichier séparé, marque `plan:`) et la pose à la main (import direct). Jusqu'au 03/11/2026, la pose réutilisait une piste libre du type, sinon la première : sons et voix s'empilaient sur la même piste.

## Procédure

1. Fin de génération : `quandUnMediaSArrete(mediaId)` (server/src/realisation.ts). Avec lot : garde `lot.termine`, réveil de l'agent par `sendPrompt`, filet de trois minutes dans le Studio (`filetDuChoix`). Sans lot, dans le Studio seulement : `quandUnMediaSansLotSArrete`, garde `plan.termine`, le démon pose la question. `ajouter` rend la question avec son résultat, sauf `role: livraison` et le plan « montage ». `questionDeChoixEnAttente` empêche tout doublon.
2. `questionDeChoixDeVersion` construit la question ; `demande.montage.role === 'preparation'` donne Utiliser / Poser / Aucune (`geste: 'utiliser'` dans `choixDeVersion.versions`).
3. La proposition annonce sa place : arguments `place` { pisteId, debut, duree, cadre } et `fond` de « realiser » « devis » et « ajouter », gardés dans `demande.montage` (`annonceDuMontage`).
4. La réponse : `await trancherLeChoixDeVersion` (ws.ts) → `retenirUnMedia(…, { surIssue })`, attend l'issue réelle 30 s au plus et rend à l'agent « RÉSULTAT VÉRIFIÉ PAR BELUGA » ; au-delà, `annoncerLaPose` l'écrit dans le fil. « Utiliser » ne valide rien.
5. La pose : `poserUnMediaValideDeLaCarte` (server/src/studio-montage-de-carte.ts) sort en `deja` si un média de la même pièce est déjà sur la ligne de temps (`tousLesMediasDeLaPiece`), puis `preparerLePlan` (séparation, détourage `fond`, planche Safari), puis la règle pure `poserUnMediaValide` (shared/src/studio-montage-de-carte.ts) avec `voix: demande.voix`. L'INSTANT : place d'une autre version du plan, place annoncée, tête de lecture (`lireSelection().curseur`), début du film ; jamais après `dureeVoulue`. Musique sans place : au début, sous tout le film. Sans durée voulue (montage de carte) : les plans se suivent sur la piste des visuels (`poserUnPlanDeLaCarte`).
6. LA PISTE (décision du 03/11/2026) : la piste d'une autre version du plan, sinon la piste annoncée (`place.pisteId`), sinon UNE PISTE À LUI (`pisteALui` : une piste du type encore vide et sans nom choisi, sinon une piste neuve — juste sous les sons, devant les visuels). Une VOIX retrouve sa piste par son nom « Voix · <voix> » (`nomDePisteDeVoix`, `pisteDeLaVoix`) ; sans place annoncée, sa phrase suivante part où finit la précédente ; une autre voix ouvre sa piste. Rien de déjà monté n'est réorganisé. La consigne du directeur artistique (`shared/src/studio-agent.ts`) porte la même règle pour ses propres poses.
7. `occupe` (une autre version du plan, ou une place annoncée prise) → `poserLaQuestionDeLaPlace` (question non bloquante du fil) ; le clic → `trancherLaPlaceDuMedia`.
8. POSE À LA MAIN (menu « Ajouter à la piste », glisser, boutons de l'atelier) : `FournisseurDePose` (web/src/components/pose-sur-piste.tsx) → `studio.poser` → `poserALaMain` → règle pure `poseManuelle`, une seule opération. `occupe` : question locale à l'écran, puis rappel avec `mode`. Marque Validé par `marquerUnePoseValidee`, jamais `retenirUnMedia`.
9. Retirer la validation → `retirerUnMediaDuMontage` : tous les segments de la pièce, quel que soit le chemin de pose.
10. Rattrapage : `rattraperLesValidesDuMontage`, 60 s après le démarrage ; il ne pose jamais une image seulement « utilisée ».

## Vérification

`npm run build:server && node --test server/dist/test/medias-valides-vers-les-pistes.test.js` : place annoncée, jamais après la fin, une seconde musique sur sa propre piste sans question, une autre version de la même musique demande Remplacer / Ajouter, une piste par voix avec ses phrases à la suite, une image posée à un instant sur une piste neuve devant le fond, pose à la main sans second segment, préparation, média sans lot, une seule question. `node --test server/dist/test/studio-montage-de-carte.test.js`. Dans un navigateur : `npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-media-vers-piste.mjs` (faux moteur fourni ; `BELUGA_VERIF_EXPORT=0` saute l'export réel). Preuves : cartes ade0df86, a52d605e, « Refonte de l'espace Communication » (commit 71bd87ab).

## Pièges

Deux fichiers au contenu identique donnent la MÊME pièce jointe : dans un essai, varier le contenu. Le TYPE de piste d'un son se choisit par la CAPACITÉ : Voix pour une voix, Son pour le reste ; la piste précise, par la règle « une piste à lui » / « une piste par voix ». Une piste dont l'utilisateur a choisi le nom (`nomChoisi`) n'est jamais prise comme « piste vide » : seule une piste « Voix · <voix> » est reprise, par son nom. Une version d'essai se lit par `studio_creations.version` : « Annuler » recule ce pointeur sans écrire de version. Une réponse à une question réveille un vrai moteur dans un démon d'essai : poser `BELUGA_CLAUDE_BIN` sur un faux. Une position annoncée sur une piste occupée rend `occupe` : c'est voulu. Un fichier du démon qui écrit un message hors tour peut rester replié dans le fil : le fait doit d'abord partir dans la consigne de l'agent. « Remplacer » retire la validation par `oublierLaValidationPosee`, sans repasser par `retenirUnMedia(false)`.

## Ce qui ne marche pas

Poser la question par ask_user depuis l'agent : les lettres et les médias jouables dépendaient du modèle. Réveiller l'agent à chaque génération d'un lot : plusieurs questions. Valider une pose à la main par `retenirUnMedia` : second segment au début de la piste. Dire à l'agent « elle se pose d'elle-même » : il l'a répété alors que rien n'était visible. Réutiliser « une piste libre du type, sinon la première » : les sons s'empilaient sur une piste et ne pouvaient ni se chevaucher ni se fondre.
