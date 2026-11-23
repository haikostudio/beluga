---
name: beluga-discussion-du-cadrage-dans-le-fil
description: À utiliser dès qu'on touche à ce que le fil d'une carte montre des échanges du cadrage (questions posées et réponses, notes de l'agent) ou au repli « Réflexions », ou quand on modifie la façon dont l'agent pose ses questions (nombre de pistes) : « tout est rangé dans Réflexions », « je ne vois pas les questions et mes réponses », « le compteur N actions compte les questions », « l'agent ne propose que deux choix », « une question apparaît deux fois (fil et panneau de décision) ». Complète beluga-fil-en-points-et-journal.
etat: active
themes: interface, cartes, journal, questions
symptomes: questions et réponses du cadrage cachées dans Réflexions, notes de l'agent invisibles dans le fil, compteur d'actions faux, question affichée deux fois, l'agent propose seulement deux choix, barre de réalisation pleine sans cahier, 1 questions sur 1
projets: Beluga
---

# beluga-discussion-du-cadrage-dans-le-fil

## Symptôme

Sur une carte cadrée par questions (vue vécue : la vidéo promo, six questions, des réponses écrites à la main, des notes comme « Plus que deux points, puis je cadre »), tout était replié derrière « Réflexions 33 actions » dès qu'une compréhension était rendue : l'utilisateur ne voyait plus la discussion. Les questions n'offraient parfois que deux choix, et l'utilisateur devait écrire lui-même la troisième voie.

## Cause

`BlocsRacontes` (web/src/components/flux-en-points.tsx) repliait TOUTES les entrées du passage (actions et questions) quand `reflexionRepliee(point)` était vrai, et `RecitDuPassage` les plafonnait à 15 sinon. Côté consigne, rien n'imposait un nombre de pistes par question.

## Procédure

1. La règle pure vit dans shared/src/recit-du-tour.ts : `segmenterLeRecit(entrees)` coupe un passage en suites « discussion » / « actions » ; `entreesDeLaSorte(entrees, sorte)` rend un côté. Sont « discussion » : une question RÉPONDUE (réponse, écrite à la main comprise) et la note d'agent (jalon « Note de l'agent ») dont la voisine non-note la plus proche, avant ou après, est une question. Les phrases de passage entre deux lectures restent des actions (elles repousseraient la réponse hors de l'écran, capture #47ac). Une question SANS réponse n'en est pas : elle attend dans le panneau de décision.
2. L'écran : `BlocsRacontes` replie seules les actions derrière « Réflexions » (compteur = blocs des actions seulement) et pose la discussion avec `MotsDeLaDiscussion` (un `SousPointDuFlux` par bloc, `data-discussion-bloc="question|note"`), après le repli et avant la compréhension. Pendant le travail, suites alternées dans l'ordre du journal, le « Total » n'étant rappelé qu'une fois sous la dernière suite d'actions (`RecitDuPassage … dureeSur`). Le point « Travail » garde `TravailEnSousPoints`.
3. Les pistes : `REGLE_DES_PISTES` (shared/src/pistes-de-question.ts), un seul texte repris par `consigneDuQuestionnaire` (point 2 bis), `consigneDuCahier`, `consigneDePlanDansLeMemeTour` et la description d'`ask_user` (server/src/tools.ts). Pour la changer : ce fichier seul.
4. Filet du mode audiovisuel : `rendre_comprehension` refuse (`cahierDeRealisationManquant`) tant que le mode est allumé, le document absent et le cahier pas terminé ; `pourcentageDeLaRealisation` plafonne à 95 avant `termineA`.
5. Pour revoir une vraie carte : un script de lecture qui fabrique une session d'une heure (jeton haché dans `sessions`), ouvre `#tableau-de-bord/projet/<projet>/tache/<carte>` sur un serveur de développement du workspace web (port 7099, `localhost`) dont le proxy vise le démon servi, puis retire la session.

## Vérification

`npm run build && npm test` : server/src/test/recit-du-tour.test.ts (segments, note qui touche une question, trente actions et six questions), pistes-de-question.test.ts, realisation-questionnaire.test.ts (95 %, refus sans cahier). À l'écran : `[data-discussion-bloc]` visibles sans ouvrir `[data-reflexion-bascule]`, `data-reflexion-actions` plus petit que l'ancien total. Avant/après : scripts/verif-bloc-reponse-cadrage.mjs a 4 échecs déjà présents (lancement du moteur sur question répondue en texte ; phrases en tête de réponse), verif-journal-carte.mjs 7 échecs déjà présents ; exports-morts.test.mjs échoue sur clonage.ts, reparation-publication.ts, reseaux/index.ts.

## Pièges

Ne pas ranger les notes « Je vérifie… » dans la discussion : seule la note qui touche une question y entre. Ne pas replier une question répondue au plafond de 15 cartons. Une question sans réponse ne se double pas dans le fil. Les tests qui construisent une note d'agent utilisent un jalon `JALON_NOTE_DE_L_AGENT` (nature « jalon »), pas une nature « texte ».

## Ce qui ne marche pas

Poser TOUTES les notes d'agent dans le fil : le contrôle verif-bloc-reponse-cadrage montrait alors des phrases de passage en tête de la réponse. Garder le seul repli « Réflexions » : l'utilisateur ne voyait plus ses propres réponses.
