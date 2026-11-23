---
name: beluga-messages-courts-et-plan-compact
description: À utiliser pour toucher à la FORME de ce que les agents de Beluga écrivent dans le fil : longueur des messages (compréhension, réponse, compte rendu de fin, assistant — à la longueur de la demande, SANS plafond depuis le 25/10/2026), compréhension et compte rendu RANGÉS EN POINTS « ### » avec sommaire posé par l'écran et rien au-dessus (06/11/2026), suites proposées décrites sous la réponse avec « D'autres idées », plan compact façon Conductor, cahier des charges vivant affiché en encadré ouvert SOUS LE PLAN SEULEMENT — ou devant « l'agent écrit des pavés », « texte ou image au-dessus des points du rapport », « pas de sommaire », « titres pas alignés », « la réponse tait le résultat demandé », « la compréhension est refusée pour sa longueur », « les évolutions possibles ont disparu », « le plan est refusé faute de cahier », « le cahier se colle sous chaque réponse ».
etat: active
themes: agents, cadrage, plan, interface
symptomes: l'agent écrit un pavé dans le fil, texte ou image posés au-dessus des points du compte rendu, compréhension en un seul bloc sans titres, sommaire absent ou titres décalés à droite, réponse trop courte qui tait le résultat demandé, suites absentes sous la réponse, plan refusé faute de cahier des charges, cahier des charges absent sous le plan, cahier collé sous chaque compréhension
projets: Beluga
---

# beluga-messages-courts-et-plan-compact

## Procédure

1. La forme : `FORME_D_UN_MESSAGE` dans shared/src/message-court.ts (et `FORME_DE_LA_COMPREHENSION` dans shared/src/cadrage.ts) — un message de DISCUSSION à la longueur que la demande appelle : question simple → quelques phrases, sans titres ; résultat demandé (recherche, liste, analyse, compte rendu) → réponse COMPLÈTE RANGÉE EN POINTS : un titre « ### » par point, son texte dessous, RIEN au-dessus du premier titre (ni phrase de synthèse, ni image) ; listes et tableaux permis dans un point. Décision du 25/10/2026 (commit 6f1b1ab1) pour la longueur, du 06/11/2026 (DEC-496, carte « Retouches de la charte graphique », commit 30e17885) pour la mise en points. Changer la forme ne se fait qu'à ces deux endroits (+ `FORME_DU_COMPTE_RENDU` et sa version `EN_BREF`).
2. Le compte rendu (`FORME_DU_COMPTE_RENDU`) : un titre par point de la demande, dans son ordre, deux à quatre phrases dessous, une image par point au plus (« ![légende](piece:…) »), « ### Aussi » pour ce qui n'était pas demandé, et la synthèse d'autrefois (enregistré, sauvegardé, non publié ; contrôles) devient le DERNIER point « ### Vérifications ».
3. La compréhension (`FORME_DE_LA_COMPREHENSION`) : un titre « ### » par point compris (mots repris de la demande), quelques phrases de synthèse dessous ; une réponse à une question est son PREMIER point. Toujours en mots courants, ni tableau ni liste à puces ; au-delà de la première, seulement ce qui change.
4. L'écran : `Markdown` prop `enPoints` (web/src/lib/markdown.tsx) — dès DEUX titres, un sommaire numéroté sans cadre (`data-sommaire-en-points`, lignes `data-ligne-du-sommaire`, intitulé `data-intitule-du-sommaire`), aligné sur le texte (survol en débord de 8 px), puis des sections NUES : titre gras (`data-titre-du-point`), texte normal, ni cadre ni icône ; un clic sur une ligne amène le point et le teinte un instant. Branché dans `MomentDeComprehension` (quand le texte porte un titre « # »), `MomentDeReponse` (flux-en-points.tsx) et `RapportEnFlux` (rapport-flux.tsx, sauf messagerie du directeur). Sans `enPoints`, l'ancien sommaire (≥ 4 titres, ≥ 1200 signes) et les sections encadrées restent pour les autres écrans.
5. Les gabarits en message : `gabaritEnMessage` (shared/src/templates.ts) liste `in_run` et `free`. Pour eux : aucune section (`sectionsPour` rend []), `checkTemplate` rend toujours ok, enveloppe `enveloppeDuMessage` au premier tour puis rappel court. `pre_run`, `deploy`, `deploy_batch` gardent leurs titres.
6. Relance : `relanceDuRapport` (shared/src/relance-du-rapport.ts) ne relance plus que pour un gabarit structuré non tenu (`plancher`) ou un tour d'exécution qui rend la main avec des tâches de fond vivantes (`consigneDeRelanceDuRapport({ taches })`, qui porte `FORME_DU_COMPTE_RENDU`).
7. Compréhension : `rendre_comprehension` (server/src/tools.ts) n'est plus refusée pour la longueur de son « texte ». La `partieTechnique` n'est pas affichée ; elle se cumule et repart entière au tour suivant (`partieTechniqueEnTexte`, runtime.ts).
8. Suites : outil `proposer_suites` (servi à tous les rôles et à l'assistant via `OUTILS_DE_L_ASSISTANT`), règle `lireLesSuites` (2-3, titre ≤ 60, description ≤ 160). Stockées sur `Message.suites` et recopiées dans `donnees.suites` du jalon de fin de tour. Affichage `SuitesProposees` + `suitesDuJalon` (web/src/lib/markdown.tsx). « D'autres idées » envoie `suites.autres` (server/src/autres-idees.ts) — mécanique dans beluga-appel-de-moteur-a-part-depuis-un-bouton.
9. Plan compact : `lirePlanRendu(args, { cahierVivant })` exige titre, enClair, synthese, taches ≥ 2, decisions ≥ 1, verifications ≥ 1 ; les trois consignes partagent `FORME_DU_PLAN_COMPACT`.
10. Cahier vivant : `ComprehensionDeCarte.cahierDesCharges`, fusion par titre `fusionnerLeCahier` (shared/src/cahier-vivant.ts). Il ne paraît QUE sous le plan (`CahierDesChargesDuPlan`), jamais sous la compréhension.

## Vérification

`npm run build:server` puis `node --test server/dist/test/message-court.test.js server/dist/test/compte-rendu-point-par-point.test.js server/dist/test/parler-simplement.test.js server/dist/test/parcours-carte.test.js server/dist/test/suites-proposees.test.js server/dist/test/autres-idees.test.js server/dist/test/cahier-vivant.test.js server/dist/test/relance-du-rapport.test.js server/dist/test/economie-quota.test.js server/dist/test/rules.test.js` ; `npm run build --workspace web` ; `env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-texte-en-points.mjs` (démon d'essai, 24 contrôles à 1440/390 px en clair et sombre : sommaire en tête de la compréhension et du compte rendu, titres gras alignés sur leur texte, sans cadre ni icône, clic du sommaire qui amène le point ; captures /tmp/verif-texte-en-points-*.png) ; `node scripts/verif-cahier-du-plan.mjs` ; `env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-autres-idees.mjs`. Preuves : cartes « Captures d'écran hors de l'agent » (e3d377de), « Réponses, plan et cahier simplifiés » (e0c347c5), « D'autres idées sans relancer l'agent » (05e63a85), « Fenêtres Claude de nouveau alignées » (6f1b1ab1), « Retouches de la charte graphique » (30e17885, 06/11/2026, npm test 6164/6164).

## Pièges

- Remettre un plafond chiffré, un refus ou une relance « trop long » : défait la décision du 25/10/2026.
- Remettre une phrase de synthèse ou une image AU-DESSUS du premier titre : refusé par l'utilisateur le 06/11/2026 (captures #e9d5, #e42c) — la synthèse est le point « ### Vérifications ».
- Le compte rendu d'une carte ne passe PAS par `RapportEnFlux` mais par `MomentDeReponse` (flux-en-points.tsx) : une retouche de mise en page doit viser les deux.
- La règle `.comprehension-detachee *` force la couleur du texte avec `!important` : l'intitulé et les numéros du sommaire sont ramenés à `--faint` par une règle plus précise (styles.css) ; un `p` dans le sommaire hériterait aussi de `[&_p]:text-text` — l'intitulé est donc un `div`.
- Un contrôle qui veut voir un compte rendu doit poser un jalon « Réponse rendue » en phase `rapport` sur une carte d'une colonne réelle (`to_deploy`…) : en phase `cadrage`, il se range parmi les actions et ne s'affiche pas.
- Un message tient « sa forme » dès trois mots : il ne prouve PAS qu'un compte rendu a été écrit avant une panne — `rapportEntier` du jalon de fin exclut les messages (`!messagerie`, runtime.ts).
- Les suites ne s'écrivent JAMAIS en liste dans le texte.
- Ne remettre NI ligne à déplier NI compteur sous le cahier ; le cahier ne revient pas sous la compréhension.

## Ce qui ne marche pas

Le plafond de 600 signes (17/10 → 25/10/2026) : il coupait les réponses qui avaient besoin de place. La compréhension « sans titre ni liste » (25/10 → 06/11/2026) : un bloc de paragraphes illisible d'un coup d'œil. La synthèse en tête du compte rendu : elle se posait entre le sommaire et les points, avec son image, et redisait ce que les points disaient.
