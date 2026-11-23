---
name: beluga-parcours-guide-du-mode-realisation
description: À utiliser dès qu'on touche au parcours guidé du mode Réalisation (caméra) de Beluga : le chemin de sept étapes rendu comme une LISTE DE TÂCHES verticale (même case à cocher que la liste de tâches, étape en cours dépliée avec le membre de l'équipe puis les tâches du tour), logé en tête du repère des tâches collé au champ (flèches des procédures passées) ou au-dessus de la rangée d'action sans barre d'écriture, l'équipe de tournage qui se passe le relais, l'étape Montage annoncée par l'agent, la rangée des plans fabriqués, l'enveloppe d'aperçus, l'outil apercu_de_realisation, les choix en images d'ask_user ou le tableau d'ambiance. Dit où vit chaque pièce, ce qu'elle sait faire, et comment la contrôler.
etat: active
themes: realisation, interface, questions, depense, mobile
symptomes: le chemin du tournage ne s'allume pas, l'étape Montage ne s'allume jamais, les plans fabriqués n'apparaissent pas sous le chemin, le chemin mange l'écran sur téléphone, une frise horizontale réapparaît, les tâches s'affichent hors de l'étape en cours, le bloc des étapes bat au défilement, le mauvais membre de l'équipe parle, une question en images s'affiche en texte, le choix en images n'entre pas au tableau d'ambiance, un aperçu est refusé, un aperçu compte dans le budget principal, le chemin et la liste de tâches font doublon, les flèches des procédures passées n'apparaissent pas
projets: Beluga
---

# beluga-parcours-guide-du-mode-realisation

## Symptôme

Le mode Réalisation se vivait comme « un brief, un cahier, un bouton ». Depuis la carte du 22/10/2026 (commit e4066bc7), il est guidé : un chemin d'étapes qui s'allument, un membre de l'équipe qui parle, des choix en images payés par une petite enveloppe, un tableau d'ambiance. « Progression des médias sur mobile » (commit dc821750) a allumé l'étape Montage et ajouté la rangée des plans fabriqués. « Liste de tâches et étapes réunies en un seul bloc paginé » (commit e6c8386c, 23/10/2026) a logé le chemin en tête du repère des tâches, avec des flèches vers les procédures passées. « Progression dans les étapes en cours » (commit 41953ab5, branche tache/progression-dans-les-b63bb3, 23/10/2026) a supprimé la frise horizontale puis le rail de ronds : les étapes sont une liste de tâches verticale, les tâches du tour sous l'étape en cours. Quand l'un d'eux se tait, la cause est presque toujours dans l'état de la carte, pas dans l'écran.

## Cause

Tout se calcule depuis `Card.realisation` et la colonne, jamais depuis les messages :
- ÉTAPES : `JALONS_DE_REALISATION` = idee, style, scenario, budget, fabrication, montage, livre. `JALON_DE_LA_PHASE` range les douze rubriques dans les quatre premières ; la colonne donne la suite (planned + `termineA` → fabrication « pret » ; running → fabrication en cours, ou MONTAGE (monteur) si `realisation.montageA` ; au-delà → livré, toutes les étapes « fait »). Fonction : `cheminDeLaRealisation` (`shared/src/mode-realisation.ts`).
- MONTAGE : `realisation.montageA`, posé une seule fois par `poserLeMontage` (`server/src/realisation.ts`) sur « realiser » action « monter » — ou, en repli, au premier « ajouter ».
- ÉQUIPE : `ROLE_DE_LA_PHASE` — intention, format, direction, personnages → directeur artistique ; scenario, plans, son → réalisateur ; montage, droits, controle → monteur ; devis, budget → producteur. Types choisis mais enveloppe absente et phase intention → producteur.
- ENVELOPPE : `Card.realisation.enveloppe` (absente = pas demandée, 0 = refusée, 5 $ au plus), écrite par l'argument `enveloppe` de `cahier_de_realisation`.
- APERÇUS : outil `apercu_de_realisation` → `fabriquerUnApercu` (`server/src/realisation.ts`), cadrage caméra seulement, fal.ai FLUX Schnell par défaut, prix publié obligatoire, règle `decisionDApercu`. Plan `apercu-<phase>-<n>` (`estUnApercu`) : exclu de `depenseDeLaCarte`, compté par `depenseDesApercus`.
- CHOIX EN IMAGES : option `image` d'`AgentQuestion` (`shared/src/models.ts`), gardée seulement si pièce jointe image connue (`imageDOption`, `server/src/tools.ts`) ; rendue par `ChoixEnImages` (`bulle-question.tsx`).
- TABLEAU D'AMBIANCE : `Card.realisation.ambiance` ; rempli par `retenirLesImagesChoisies` (`question.answer`, `ws.ts`) et par l'argument `ambiance` de `cahier_de_realisation`.
- ÉCRAN : `web/src/components/chemin-de-realisation.tsx` (`CheminDeRealisation`). DEUX PLACES, choisies par `cheminDansLeRepere` dans `chat.tsx` :
  · barre d'écriture affichée → prop `integre`, rendu par la prop `entete` de `TravailEnCours`, qui est une FONCTION `(taches) => ReactNode` : elle reçoit la ligne de travail (`[data-ligne-du-temoin]`) et la liste du tour (`[data-liste-du-temoin]`) et les range SOUS l'étape dépliée (`[data-etape-depliee] [data-taches-de-l-etape]`), dans `[data-volet="taches"] [data-entete-du-repere]` (règle « la liste des tâches n'a qu'un seul endroit »). Le bloc d'entête porte seul le `pb-5` qui compense le recouvrement du champ ;
  · sans barre d'écriture (questionnaire, rangée d'action) → même liste, collée hors du fil au-dessus de la rangée d'action, comme le déroulé du cahier.
  · FLÈCHES DES PROCÉDURES PASSÉES : `[data-procedure-precedente]` / `[data-procedure-suivante]`, compteur `[data-fleches-procedures="n/N"]` ; une « procédure » = les `todos` d'un tour assistant passé ; rang null = la plus récente. Avec une ligne de travail, les flèches vont DANS cette ligne (sous l'étape) ; sans ligne, à gauche de la liste. Procédure passée : liste dépliée, `data-procedure-passee` sur le volet.
  Ce que le chemin sait faire :
  · LISTE VERTICALE, MÊME CASE QUE LA LISTE DE TÂCHES (décision de l'utilisateur du 23/10/2026) : `CaseDeTache` + `classeDuLibelleDeTache` (`todos.tsx`, partagés avec `CorpsListeTaches`) ; `fait`→done (cochée, nom barré), `encours`/`pret`→running (case qui respire et roue seulement carte en `running`), `avenir`→todo (vide). Tous les noms écrits (`data-nom-etape`). Aucun rond, aucun trait de rail ;
  · l'étape DÉPLIÉE est `etape.jalon === chemin.jalon` (donc « Livré » une fois tout fait) : relais (rôle, mission, « Tout est prêt… », « Ensuite : … », enveloppe) puis tâches ;
  · UN SEUL PLI (carte « Repli complet du repère des tâches », 23/10/2026, commit 836109c5) : la ligne du témoin (`[data-statut-du-temoin]` ou `[data-chevron-du-temoin]`, pli `usePliDesTaches`) replie TOUT `[data-entete-du-repere]`, étapes comprises ; un second clic rouvre étapes + tâches. Sans ligne, les étapes restent. Replié d'office sur un navigateur neuf ;
  · la liste nichée n'a plus de `-mr-3` : la durée des tâches reste dans la colonne des étapes ;
  · `reduit` (fil pas en bas) ne replie QUE le relais ; replié par le pied compact du téléphone (`onDeplier`, `data-deplier-bloc`), seule l'étape dépliée reste, un appui rouvre ;
  · AUCUN violet ni pictogramme de membre de l'équipe ;
  · « Plans fabriqués » (`PlansFabriques`) pendant fabrication/montage, carte au travail : finis = `useMediasLivres({cardId})`, silhouettes = `mediasEnFabrication` ; ils défilent dans le fil (`GaleriesDuTournage`), jamais collés ; tableau d'ambiance dessous, même grille.

## Procédure

1. Lire l'état de la carte (`realisation` : medias, phase, enveloppe, ambiance, termineA, montageA, colonne) avant de toucher l'écran.
2. Une règle d'étape ou de rôle se change dans `shared/src/mode-realisation.ts` avec son test `server/src/test/realisation-chemin.test.ts` ; un geste de l'outil dans `server/src/realisation.ts` + « realiser » dans `server/src/tools.ts`, testé dans `server/src/test/realisation.test.ts`.
3. Le dessin d'une étape se change dans `CaseDeTache` / `classeDuLibelleDeTache` (`todos.tsx`) : la liste de tâches et le chemin le partagent, ils doivent rester identiques.
4. `CheminDuCahier` (cahier-des-charges.tsx) garde encore la frise à ronds (`RondDEtape`) : il n'est plus identique au chemin du tournage ; l'aligner est une carte à part.
5. Ne jamais rendre un second chemin au pied quand `cheminDansLeRepere` est vrai (le contrôle exige un seul `[data-chemin-realisation]`).
6. Toute nouvelle dépense du cadrage passe par `decisionDApercu`.
7. Un nouveau libellé affiché va dans `shared/src/traductions.ts` (cinq langues) ; un `aria-label` reste en français littéral.
8. Construire (`npm run build`) puis contrôler.

## Vérification

`npm run build && node --test server/dist/test/realisation-chemin.test.js server/dist/test/realisation.test.js`.
`env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-mode-realisation.mjs` (démon d'essai à soi, port 7233) : 93 contrôles au vert (23/10/2026), dont le pli complet et les durées dans le cadre (getBoundingClientRect, ordinateur et 390 px). À 390 px clair et sombre : si le pied compact a replié le chemin, une seule étape, puis appui → sept étapes verticales, cases alignées, 4 cochées à « Fabrication prête », tous les noms écrits, relais sous l'étape dépliée, hauteur ≤ 45 % de l'écran, aucun `[data-rond-etape]`/`[data-trait-chemin]`, ni violet ni pictogramme. Carte lancée : Montage en case `running`, Fabrication `done`. Section 7 bis : liste verticale de sept lignes dans `[data-volet="taches"] [data-entete-du-repere]`, flèches « 3/3 », gauche → 2/3 avec la ligne de travail dans `[data-etape-depliee] [data-taches-de-l-etape]` et la liste dans `[data-liste-du-temoin]`, puis la plus ancienne, droite ×2 → 3/3. `BELUGA_REALISATION_CAPTURE=/tmp/x.png` garde les captures. Puis `node scripts/nettoyer-essais.mjs`.

## Pièges

— Masquer les six autres étapes au défilement (`reduit`) fait BATTRE le bloc : leur hauteur dépasse l'hystérésis de `auBas` (96 px). Seul le relais se replie au défilement.
— Après le tour, la dernière réponse n'a souvent pas de `todos` : aucune ligne n'est rangée sous l'étape, les flèches restent à gauche ; on ne voit les tâches sous l'étape qu'en procédure passée ou pendant un tour.
— Pendant le travail, le repère suit le pli retenu, replié d'office sur un navigateur neuf : étapes cachées. Un contrôle qui lit `[data-chemin-realisation]` pendant le tour déplie d'abord au chevron, sinon il tombe sur un autre chemin (jalon « livre »).
— Sur téléphone, le pied compact replie souvent le chemin à l'arrivée : un contrôle doit d'abord l'ouvrir (`[data-deplier-bloc]`).
— Le faux moteur du contrôle garde l'identifiant de carte d'un tour à l'autre (`carte.txt`) et attend 15 s après « monter » pour que l'écran montre Montage.
— Les flèches n'apparaissent qu'avec au moins deux tours porteurs de `todos` : le contrôle insère deux messages assistant factices en base.
— La liste `mediasEnFabrication` vit en mémoire : ne jamais en tirer les plans FINIS, seulement les silhouettes.
— Ne pas ressusciter le bandeau fixe (retiré le 21/10/2026) : ni jauge ni pause.

## Ce qui ne marche pas

— Déduire l'étape ou le rôle des messages : l'état de la carte fait foi (MEM-0370).
— Ouvrir « realiser » au cadrage pour les aperçus : il dépense sur le budget principal et sans plafond d'enveloppe.
— Allumer « Montage » à la seule colonne : le montage n'est connu que par l'annonce de l'agent (ou le premier fichier monté).
— Déplacer la liste de tâches hors du champ vers le chemin : c'est le chemin qui rejoint la liste collée au champ.
— Une frise horizontale de ronds dans le bloc collé au champ, puis un rail vertical de ronds reliés par un trait : refusés par l'utilisateur le 23/10/2026 — les étapes se valident comme la liste de tâches.
