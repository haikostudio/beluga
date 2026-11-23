---
name: beluga-badge-de-statut-colore-des-cartes
description: À utiliser dès qu'on touche au badge de statut en haut à droite d'une carte (tableau d'un projet ou Tableaux de bord), à sa couleur par étape (jaune Compréhension, violet Travail), à ses libellés (Au travail, Attend votre réponse, En attente de quota, Rendue…) ou qu'on ajoute un jeton de couleur à la charte monochrome : « le badge n'a pas la bonne couleur », « verif-themes refuse mon jeton », « le contrôle des pastilles compte le badge », « la carte sans crédit dit encore Au travail ».
etat: active
themes: interface, cartes, quotas
symptomes: le badge de statut d'une carte reste gris, le contrôle des thèmes refuse un nouveau jeton de couleur, le contrôle du pied des cartes compte le badge comme une pastille, la tête d'une carte grandit avec le badge, une carte bloquée faute de quota ne le dit pas
projets: Beluga
---

# beluga-badge-de-statut-colore-des-cartes

## Symptôme

Les cartes doivent montrer d'un coup d'œil laquelle est en compréhension (jaune) et laquelle travaille (violet), sans colorer la carte entière ni changer sa hauteur — et dire quand elles attendent une réponse ou un quota.

## Cause

La charte est monochrome + violet : le violet était réservé au texte du bandeau d'écriture et à l'élément choisi, aucun jaune n'existait, et le contrôle des thèmes refuse tout jeton coloré non déclaré. Demande du 18/10/2026 (carte couleurs-des-statuts-de-cartes-bf35e9). Le 23/10/2026, ajout du libellé « En attente de quota » (carte badge-en-attente-de-quota-399da1).

## Procédure

1. Règle pure : tonDuBadgeDEtape(etape) dans shared/src/frise-de-suivi.ts rend 'comprehension', 'travail' ou null ; test dans server/src/test/secousse-et-frise.test.ts. L'étape vient de etapeCouranteDeSuivi(carteDeSuivi(card, { agentActif, deploys, colonne: colonneAffichee(…) })). 2. Jetons dans les DEUX palettes de web/src/styles.css (:root sombre, html:not(.dark) clair) : --comprehension, --comprehension-fond, --comprehension-trait (jaune) et --teinte-fond, --teinte-trait (violet) ; l'alpha vit DANS le jeton (« 48 92% 62% / 0.14 »), jamais bg-x/50 ; noms Tailwind dans web/tailwind.config.js (comprehension.DEFAULT/fond/trait, teinte-fond, teinte-trait). 3. Pièce web/src/components/badge-etape.tsx (BadgeDEtape, 18 px de haut, data-badge-etape, prop enCours = point qui bat). 4. Tableaux de bord : en-route.tsx, bloc droite de CarteEnRoute, cascade du texte : Attend votre réponse (agent.attendReponse) > En attente de quota (useAttendUnQuota) > Cadrage en cours / Au travail > en ligne > Rendue… > nom de l'étape au repos ; data-temoin-en-route vaut question / quota / travail / repos, data-etape-libelle gardé. 5. Tableau d'un projet : board.tsx, CardTile, le badge prend la place du voyant à droite du titre (hors enRoute), même cascade ; sans ton d'étape, « En attente de quota » s'écrit en texte text-warning (data-attente-quota). 6. Le quota : règle shared/src/attente-de-quota.ts (cartesEnAttenteDeQuota) — file portant un QueuedPrompt.messageId OU décision ouverte de source « reprise-de-compte » ; hook web/src/lib/attente-de-quota.ts. Le premier envoi (ws.ts) pousse un queue.etat par file sans quota (store.filesSansQuota) : sans lui, state.queues n'est rempli qu'à l'ouverture d'un fil et le badge n'apparaît jamais au chargement. Jamais de point qui bat sur l'attente de quota. 7. scripts/verif-themes.mjs : les jetons --comprehension* et --teinte-fond/trait sont admis en couleur (jaune teinte 35-60), badge-etape.tsx est ajouté à la liste fermée des porteurs du violet. Tout nouveau libellé s'ajoute dans shared/src/traductions.ts (5 langues).

## Vérification

npm run build puis npm test (au 23/10/2026, seul « le minuteur publie un contenu programmé… » de publication-sociale tombe, étranger au badge). env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-en-route.mjs : 148/148 au 23/10/2026, dont « le badge de statut prend la couleur de l'étape » et « une carte coupée par la limite d'un compte dit En attente de quota » (carte c-lot-03 en Demande avec un message repriseCompte ouvert) ; quelques échecs aléatoires d'un passage à l'autre, rejouer. HAIKO_THEMES_URL=http://localhost:7099 node scripts/verif-themes.mjs et HAIKO_LANGUES_URL=… node scripts/verif-langues.mjs (serveur de développement en arrière-plan, --strictPort). Puis node scripts/nettoyer-essais.mjs. Preuves : carte couleurs-des-statuts-de-cartes-bf35e9, commit af805d6e ; carte badge-en-attente-de-quota-399da1, commit 728147f6.

## Pièges

Le contrôle verif-en-route.mjs comptait « .rounded-md.border » comme pastille de pied : il exclut maintenant [data-badge-etape]. Les cartes de Tableaux de bord ont une tête de 18 px : le badge fait 18 px pile. Les cartes Système (cadre violet, VignetteAgent) ne portent PAS ce badge. Sans agent ni rendu, une carte à l'étape colorée montre quand même un badge avec le nom de l'étape (doublon voulu avec l'étiquette de gauche). Un message de décor avec repriseCompte doit porter at (nombre) : sans lui il est écarté au parse, en silence côté écran. Une reprise ouverte sur une carte « En cours » est relancée par la relève dès qu'un compte a du quota : un décor d'essai la pose en « Demande ». Une carte au repos d'un moteur à 100 % n'affiche PAS « En attente de quota » (décision utilisateur : seules les cartes réellement bloquées). verif-themes.mjs et verif-langues.mjs échouent déjà pour d'autres raisons sur ce dépôt (violet repris ailleurs, aria-label traduits, textes de deploy-panel et mesures-ecran) : aucune ne vient du badge.

## Ce qui ne marche pas

Colorer la carte entière : l'utilisateur veut seulement le badge. Colorer seulement quand un agent tourne : le repère disparaît au repos, la couleur suit l'étape. Lire la file d'attente seulement depuis le fil ouvert : le badge de quota n'apparaît jamais sur les Tableaux de bord au chargement.
