---
name: beluga-methodes-et-langues-du-mode-realisation
description: À utiliser dès qu'on touche à la bibliothèque de méthodes du mode Réalisation (versions, activation après accord, note par les avis sur les vraies productions, sources extérieures non fiables) ou à la déclinaison d'une production dans une autre langue (voix refaite, présentateur resynchronisé par fal.ai, images réutilisées, durées adaptées). Dit où vit chaque pièce, ce que sait faire l'outil « realiser » et comment le contrôler.
etat: active
themes: realisation, methodes, multilingue, fal, depense
symptomes: une méthode entre en service sans accord, la note d'une méthode ne bouge pas, le contenu d'une méthode apparaît dans la consigne, une source sans licence est recopiée, une déclinaison refait les images, la synchronisation labiale ne trouve pas la vidéo, fal refuse l'envoi d'un fichier, le prix d'une voix fal est non publié
projets: Beluga
---

# beluga-methodes-et-langues-du-mode-realisation

## Symptôme

Le chantier « Beluga Creative Studio » (carte 4, branche tache/studio-creatif-4-75f325, 24/10/2026) a ajouté à l'outil « realiser » une bibliothèque de méthodes notée par les vraies productions et la déclinaison d'une production dans une autre langue sans refaire ses images.

## Cause

- RÈGLES PURES : `shared/src/methodes-creatives.ts` (note `noteDeMethode` = (acceptées+1)/(évaluées+2)×5, `statutsApresDecision`, questions d'activation et d'avis, `contenuEncadre`, `ligneDeMethodePourConsigne`, `SOURCES_DE_METHODES`) et `shared/src/declinaison-en-langues.ts` (`planDeDeclinaison`, `dureeAdaptee`, `planDecline`).
- BASE : migration 139 « methodes-creatives » — `methodes_creatives`, `methodes_versions` (statut proposee/active/remplacee/refusee, question_id), `methodes_usages` (média ↔ version), `medias_avis` (question et verdict par média), `methodes_evaluations` (une ligne par version et par média). Porte d'écriture : `server/src/methodes-creatives.ts`.
- OUTIL « realiser » (`server/src/realisation.ts`) : actions « methodes », « proposer_methode » (pose la question, rappel avec « version »), « avis » (pose « Je garde / À refaire » sur un média fini, rappel avec le même « id »), « decliner » ; « devis » accepte « methodes », « langue », et pour la capacité « synchro » « video » + « audio » (deux médias finis du projet).
- CATALOGUE (`shared/src/services-de-generation.ts`) : capacité « synchro » (sync-lipsync v3/v2, veed/lipsync/v2, latentsync) et voix fal (eleven-v4, minimax speech-2.8-hd), prix 'api-fal' calculé par `prixALUniteFal`.

## Procédure

1. Nouvelle règle de note ou d'activation : dans `shared/src/methodes-creatives.ts`, avec son test.
2. Un état ne change que sur une RÉPONSE relue par `reponseALaQuestion` (comme « fixer_budget » et « generer ») : jamais un argument de l'agent qui vaudrait accord.
3. La consigne de fabrication (`consigneDeFabrication`, param `methodes`) ne reçoit que des lignes `ligneDeMethodePourConsigne` ; le contenu ne sort que par l'action « methodes » + « methode ».
4. Une nouvelle source : l'ajouter à `SOURCES_DE_METHODES` après avoir lu sa licence (`gh api repos/<dépôt>`), son activité et son NOTICE ; sans licence = « inspiration-seule ».
5. Un nouveau modèle fal : vérifier qu'il est « active » (`curl https://api.fal.ai/v1/models?endpoint_id=…`, sans clé) et lire son schéma (`https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=…`), puis l'ajouter à `MODELES_EN_PLUS` et à `requeteDeGeneration`.
6. Une langue : `LANGUES_DE_DECLINAISON`, `NOMS_DES_LANGUES`, `LONGUEUR_PARLEE`, et `LANGUES_MINIMAX` pour MiniMax.

## Vérification

`npm run build:server && node --test server/dist/test/methodes-creatives.test.js` (9 tests : note, activation, consigne sans contenu, sources, plan de déclinaison, catalogue fal et prix, schéma de l'outil, parcours complet proposition → « Activer » → devis → avis → note, déclinaison avec voix anglaise puis synchro déposée chez fal après « Lancer »), puis `npm test` et `node scripts/verif-mode-realisation.mjs`.

## Pièges

- `VerdictDeProduction` existe déjà dans `garde-production.ts` : le type des avis s'appelle `VerdictSurProduction`.
- La synchro dépose les fichiers chez fal (gratuit) DANS `fabriquer`, donc après l'accord : ne jamais déplacer cet envoi au devis.
- Un plan décliné porte le suffixe « — EN » : `planDeDeclinaison` l'écarte, et `nomDuFichierDeMedia` le range en `voix-off-en-v1.mp3`.
- Sans durée, le prix d'une synchro à la minute est `null` : l'accord est demandé (voulu, jamais un chiffre deviné).
- Les durées par langue sont des ESTIMATIONS ; la voix rendue fait foi pour recaler le montage.

## Ce qui ne marche pas

- Noter les méthodes sur une enveloppe d'essai : refusé par l'utilisateur le 24/10/2026, la note ne vient que des vraies productions.
- Écrire le contenu d'une méthode dans la consigne du tour : porte d'injection pour un texte tiers non fiable.
