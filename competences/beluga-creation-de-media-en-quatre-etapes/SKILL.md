---
name: beluga-creation-de-media-en-quatre-etapes
description: À utiliser dès qu'on touche au parcours d'une carte caméra DU TABLEAU de Beluga (photo, vidéo, musique, voix, son) : les quatre étapes Brief → Esquisses → Montage → Téléchargement, le bouton du bas qui change d'étape, les validations « Générer · prix » posées une par plan, le menu des modèles avec leur prix dans cet encart, la validation d'un clic sur le média et son retrait depuis le volet, l'aperçu animé d'un plan en fabrication, les panneaux du menu « … » (visage, lumière, angles, animer, gestes, consigne), le studio photo, le studio son, le montage vidéo nourri des validés, la page Téléchargement et son archive à trois dossiers, ou la garde « kie.ai seul ». Une création du service Studio n'a PLUS ces étapes : voir « beluga-studio-service-et-directeur ». Ce que le directeur FABRIQUE (styles, rendu sur le serveur) est dans « beluga-directeur-artistique-en-trois-arrets ».
etat: active
themes: realisation, cartes, depense, interface, studio
symptomes: une génération part sans clic, le bouton du bas reste éteint sans dire pourquoi, une retouche de photo propose de créer la vidéo, une option du menu relance un message au lieu d'ouvrir un panneau, Codex fabrique une image dans une carte caméra, l'agent valide un média à la place de l'utilisateur, le montage s'ouvre vide, l'archive du téléchargement n'a pas ses trois dossiers, la liste de tâches du directeur disparaît, un double clic saute une étape, une question de modèle et de prix au brief, une seule validation à la fois alors qu'il y a plusieurs plans, l'encart de validation est trop chargé, la case du plan reste vide pendant la fabrication, un seul modèle proposé sans comparer les prix, le bouton ne suit pas le modèle choisi, l'agent change de modèle d'une génération à l'autre
projets: Beluga
---

# beluga-creation-de-media-en-quatre-etapes

## Symptôme

Le parcours d'avant (six étapes, trois arrêts d'accord du directeur, budget de carte, bouton « Lancer ») mêlait création et accords : une retouche de visage sur une photo proposait de « créer la vidéo », les options du menu relançaient un message, Codex fabriquait des images, et l'utilisateur ne voyait pas ses brouillons au même endroit. Carte « Création de médias étape par étape » (26/10/2026, commits 7b8b657d et 6c10eb7a) : quatre étapes fixes pour tous les médias. Carte « Atelier média : esquisses et attentes » (27/10/2026, commit c46948ce) : au brief l'agent posait une question de modèle et de prix puis rien ne se fabriquait ; une seule validation à la fois (question bloquante) ; l'encart « Devis » empilait tableau, total, champ et quatre boutons. Carte « Studio : chat centré et choix du modèle » (01/11/2026, commit a1679e6e) : l'encart n'offrait qu'un modèle à un prix (« il m'estime 3 balles pour Kling, il y a sûrement d'autres modèles »). Depuis la carte « Création de média tout en conversation » (01/11/2026, commit cb4ca0e4, DEC-466), ces étapes ne valent plus que pour les cartes de média du tableau : une création du service Studio se mène en une seule conversation (`studioSansEtapes`).

## Cause

Le parcours vit dans l'état de la carte (`realisation.esquissesA`, `sequencesA`, `montageA`, `telechargementA`), jamais dans les messages, et seul l'utilisateur l'avance :
- RÈGLES PURES (`shared/src/etapes-du-media.ts`) : `etapesDuMedia`, `etapeCouranteDuMedia`, `passageDuMedia` (le passage à venir et CE QUI MANQUE, `RAISONS_DU_BOUTON_DU_MEDIA`), `passageAEcrire`, `etapeDuMediaLue`, `decoupageDuMedia`, `etatDesPlans`, `enFabricationDuPlan`, `animationPermise`, `voletDuMedia`, `sectionsDuTelechargement`. Studios : `shared/src/studios-du-media.ts`. Validations : `questionDUneGeneration`, `descriptionDUneGeneration`, `validationNonBloquante` (`shared/src/production.ts`). Choix du modèle : `shared/src/choix-du-modele-d-un-lot.ts` (`CAPACITES_AU_MENU_DES_MODELES`, `incompatibiliteAvecLaDemande`, `totalDuMenu`, `trierLeMenuDesModeles`, `refusDuPrixVu`, `derniersModelesUtilises`, `ligneDesDerniersModeles`, `noteDuModeleConseille`).
- DÉMON : `server/src/parcours-du-media.ts` — `passerALEtape` (commande `realisation.passer`), studio photo rendu par ffmpeg, studio son, `archiveDuTelechargement`. L'argent : `server/src/realisation.ts` — `proposerUnLot` (pose `devis.conseil`), `trancherLeLotDuClic`, `modelesDuLot` (`realisation.lot.modeles`), `changerLeModeleDuLot` (`realisation.lot.modele`), `REFUS_AU_BRIEF`, `reessaiDOfficePermis`.
- LE DIRECTEUR est le CADRAGE de la carte (colonne « Planifié ») et reçoit l'outil « realiser » ; `modeles`/`devis`/`lot`/`generer`/`lumiere` lui sont refusés tant que la carte est au brief, `monter` tant que l'utilisateur n'a pas cliqué « Passer au montage ».
- UNE VALIDATION À BOUTON N'EST PAS BLOQUANTE (DEC-437) : `http.ts` l'attache sans `poserLAttente`, `ws.ts` la tranche au clic sans relancer l'agent, `chat.tsx` garde la barre d'écriture, le panneau des décisions (`parcours-carte.tsx`) les montre toutes hors carrousel.
- INTERFACE : bouton du bas `RangeeDuMedia` (`parcours-carte.tsx`), encart `ValidationDuLot` (`web/src/components/validation-du-lot.tsx`, menu des modèles) sur `ValidationAvecCout` (`validation-avec-cout.tsx`, props `ligne`, `note`, `bloque`), monté par `BulleQuestion` quand `devis.bouton` ; le menu n'existe que si `messageId` et `questionId` sont passés (`QuestionCard`, message-view.tsx). « Valider » sur chaque média du fil (`menu-du-media.tsx`), `BoutonRetirerLaValidation`, panneaux `creation/panneau-du-media.tsx`, studios `creation/studio-son.tsx` et `creation/studio-photo.tsx`, `creation/page-telechargement.tsx`, volet `volet-de-suivi.tsx`.

## Procédure

1. Brief : le directeur pose les questions PROPRES au type (`QUESTIONS_DU_BRIEF_PAR_TYPE`) ; vidéo : découpage avec « Durée » et « Capacité » par plan, voix off et musique prévues au brief. Rien ne se fabrique ni ne se chiffre (`REFUS_AU_BRIEF`).
2. « Passer aux esquisses » : écrit `esquissesA`, vaut accord sur l'écrit du brief et réveille le directeur (`CONSIGNE_DU_PASSAGE`) pour poser D'UN COUP une validation par plan. « Passer aux séquences vidéo » le réveille aussi.
3. Esquisses : chaque validation = `devis` (2 à 4 brouillons) puis `lot` → encart « Générer · prix » / « Refuser ». Le clic accepte ET lance (`question.answer` → `trancherLeLotDuClic`) ; « Refuser » ne dépense rien. L'utilisateur valide d'un clic sur le média (`production.retenir`).
4. MENU DES MODÈLES de l'encart (image, video, animation, musique, son) : à l'ouverture, `realisation.lot.modeles` lit sans frais les modèles de même capacité des services branchés, filtrés sur la demande (durée dans `durees`, image de fin → `fin`, schéma kie vérifié par `corpsEnDirect` avec adresses factices) et chiffrés par `prixPublie` × brouillon ; le modèle actuel en tête, coché. Choisir un autre : `realisation.lot.modele {messageId, questionId, service, modele, prixVu}` réécrit d'un bloc médias, `production_operations` et question, sous `avecLeVerrouDeLaCarte` ; refus si le lot n'est plus proposé ou si le prix a monté (`refusDuPrixVu`, prix à jour rendu). Rien n'est lancé ; « Générer » retenu pendant le changement.
5. Génération suivante : la consigne rappelle le dernier modèle par capacité (`derniersModelesUtilises`) ; un autre modèle proposé pose « Conseillé à la place de … : raison » dans l'encart. Priorité : modèle retenu dans le menu du Studio (`refusDuDevisDeLaCarte`) > dernier utilisé > recommandation. Le choix de l'encart n'écrit jamais `modelesChoisis`.
6. Panneaux du menu « … » : feuille du bas ; `realisation.panneau.chiffrer` lit le prix sans dépenser, `realisation.panneau.lancer` vaut accord.
7. « Passer au montage » ouvre le studio du type ; « Passer au téléchargement » : page Médias finaux / Validés / Esquisses et archive zip ; « Terminer » range la carte.

## Vérification

- `npm run build:server` puis `node --test server/dist/test/etapes-du-media.test.js server/dist/test/realisation.test.js server/dist/test/studios-du-media.test.js server/dist/test/choix-du-modele-d-un-lot.test.js server/dist/test/kie.test.js` (dont « le menu des modèles d'une génération : prix de chacun, changement sans dépense, hausse refusée »).
- `env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-studio-discussion.mjs` (38/38 au 01/11/2026 ; partie 8 : menu, prix, menu dans l'écran, changement sans lancement ni réveil, clic qui lance le modèle affiché — kie.ai branché par une clé d'essai envoyée par `coffre.enregistrer` sur le canal de la page).
- `env -u BELUGA_TOKEN -u BELUGA_URL BELUGA_REALISATION_PORT=<port libre> node scripts/verif-mode-realisation.mjs`.
- `env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-responsable-creatif.mjs` — dont « aucun appel payant » au brief.
- Depuis une copie de travail seulement, jamais le dépôt principal.

## Pièges

- Le directeur est un agent de CADRAGE : sa liste de tâches reste visible quand le repère porte la barre d'étapes.
- Un passage qui réveille le directeur fait partir UNE demande.
- Une question à `devis.bouton` ne doit JAMAIS repasser par `poserLAttente` (DEC-026).
- Le clic d'une validation ne relance pas l'agent : ne pas remettre un `sendPrompt` par clic.
- `aria-label` ne passe jamais par `t()`.
- kie.ai seul : `shared/src/garde-creation.ts` via `server/garde-demon.mjs`.
- Le verdict `auto` de `decisionDuLot` est encore là : ne pas s'en resservir pour faire partir une génération sans clic.
- Changer de modèle retire `demande.entrees` et `demande.parametres` (propres au modèle lu en direct) ; ne jamais passer d'une capacité à une autre (animation ≠ video : l'une part d'une image).
- Le message de l'agent écrit avant un changement garde l'ancien prix : l'encart fait foi. L'encart relit le menu quand la question relue change (clé sur total + description).
- Un contrôle qui capture le menu attend la fin du fondu d'ouverture (≈ 500 ms), sinon le fond paraît transparent.

## Ce qui ne marche pas

- Laisser l'agent valider un média ou lancer une génération « dans le prix accordé » : refusé le 26/10/2026.
- Une étape « Validés » séparée : retirée.
- Sauter le montage d'une photo : refusé.
- Une seule validation bloquante à la fois, avec tableau de devis, total, champ et Joindre/Annuler : refusé le 27/10/2026.
- Un menu de modèles qui écrirait le choix dans les modèles retenus de la création : refusé, le choix vaut pour CETTE génération.
- Remettre ces étapes dans le service Studio : refusé le 01/11/2026.
