# HaikoDev — instructions du moteur

Fichier court et factuel, tenu à jour AU FIL des tâches : comment lancer, comment vérifier, où
vivent les choses, ce qu'on n'enfreint pas. Aucun journal ici — les livraisons vont dans
`HISTORIQUE.md`, les règles apprises dans `docs/memoire/`. Le fichier est chargé À CHAQUE session : il
ne garde donc que le CONTRAT essentiel. Le TEXTE ENTIER des règles vit PAR SUJET dans `docs/regles/`,
la liste des contrôles dans `docs/verifications.md`, le texte des faits PAR SUJET dans `docs/memoire/`
— tout se demande à la carte avec l'outil `project_memory`, qui ne rend que le sujet touché par la
tâche, et une seule fois par session. Un sujet NOMMÉ (« publication ») rend son fichier entier ; des
MOTS-CLÉS ne rendent qu'un EXTRAIT — les règles qui parlent de ces mots, plafonnées, le reste étant
nommé (`shared/src/extrait-regles.ts`).

## Où vivent les choses

| Dossier | Rôle |
| --- | --- |
| `server/` | Le démon : base, protocole, ordonnanceur, agents, outils, publication |
| `web/` | L'interface : tableau, conversations, réglages, application installable |
| `shared/` | Les règles pures, sans base ni disque — donc testables seules |
| `scripts/` | Service système, identifiants, scripts de vérification |
| `docs/` | La documentation : les règles PAR SUJET (`regles/`), les faits PAR SUJET (`memoire/`), les MÉCANIQUES réutilisables (`mecaniques/`), les PLANS du chef (`plans/`), la liste des contrôles (`verifications.md`), les audits |
| `outils/` | Les outils tiers dont le démon dépend, versionnés ici (`outils/compta/` : facturation) |
| `data/live` | **Ce qui est réellement servi** : écrit uniquement par la publication |
| `data/competences` | Les **compétences partagées** : un dossier par compétence, chacun avec son `SKILL.md` |

Une règle qui peut vivre sans base ni disque va dans `shared/` avec son test : c'est ce qui la rend
lisible et rejouable.

## Lancer

```bash
npm install
npm run build                       # shared, puis server, puis web
npm run build:server                # shared + server seulement
npm run dev --workspace web -- --port 7099   # interface de développement (viser localhost)
```

`npx vite web` casse la résolution de Tailwind : passer par le workspace. Le serveur de
développement n'écoute qu'en IPv6, donc `localhost`, pas `127.0.0.1`.

L'environnement des agents porte `NODE_ENV=production`, où `npm install` SAUTE les dépendances de
développement : `tsc` et `vite` sont alors absents et `npm run build` répond « tsc: not found ».
Avant de construire — dans une copie de travail comme dans le dossier principal —
`NODE_ENV=development npm install --include=dev`. La publication le fait désormais toute seule.

Le navigateur d'essai (`playwright`) est une dépendance DÉCLARÉE du projet, importée normalement
(`import { chromium } from 'playwright'`) — jamais par un chemin absolu vers le dossier personnel
d'un utilisateur. Elle est en `dependencies`, PAS en `devDependencies` : l'environnement des agents
porte `NODE_ENV=production`, où `npm install` saute les dépendances de développement — un
`devDependencies` y serait donc absent sans un mot. Aucun navigateur n'est à télécharger : tous les
scripts lancent le Chrome du système (`channel: 'chrome'`).

Un script de vérification ne doit **jamais** reprendre `HAIKODEV_URL` : cette variable, posée dans
l'environnement des agents, désigne l'application DÉJÀ PUBLIÉE — on y verrait l'ancienne version.
Viser le serveur de développement, et n'accepter d'autre adresse que par une variable à soi.

## Vérifier

Les contrôles de TOUS LES JOURS :

```bash
npm test                            # tous les tests du démon (compilés dans server/dist)
node scripts/mesure-jetons.mjs      # ce qui part au moteur, avant / après
node scripts/verif-memoire-agent.mjs # un vrai agent va-t-il chercher un fait détaillé ?
node scripts/verif-memoire-sujets.mjs # la mémoire part-elle par sujet, une seule fois par session ?
node scripts/verif-recherche-passages.mjs # la recherche remonte-t-elle les bons passages, sous plafond ?
node scripts/verif-memoire-des-vecteurs.mjs # un fichier réécrit garde-t-il ses vecteurs, et les sujets sont-ils nommés ?
HAIKO_THEMES_URL=http://localhost:7099 node scripts/verif-themes.mjs # les thèmes : aucun jeton oublié, aucune couleur en dur, puis le NAVIGATEUR — thème d'un projet, entrée « Thème » du menu (survol ET clic), choix « Système »
node scripts/verify-ui.mjs          # l'interface dans un vrai navigateur
node scripts/nettoyer-essais.mjs    # À LANCER APRÈS : retire les cartes d'essai
```

`npm test` lit `server/dist` : **construire avant de tester**.

Les DIZAINES de contrôles ciblés (un par écran, un par règle) ne vivent plus ici : ils sont rangés
PAR SUJET dans `docs/verifications.md` et se demandent avec l'outil `project_memory` (argument
`sujet` : « publication », « cartes », « voix », « quotas »…). On n'ouvre que les contrôles qui
touchent la tâche. Rappels valables partout — session d'une heure fabriquée puis retirée (jetons
HACHÉS, jamais réutilisés), **ne jamais reprendre `HAIKODEV_TOKEN`** (jeton d'agent périmé :
`env -u HAIKODEV_TOKEN …`), `HAIKODEV_URL` vaut l'application PUBLIÉE (viser le dev pour du code non
publié), point d'essai `window.haikodevEssai` gardé par `import.meta.env.MODE !== 'production'` (jamais
`DEV`) — sont détaillés en tête de `docs/verifications.md`.

## Mémoire du projet

- `docs/memoire/<sujet>.md` — les faits durables et les pièges, **un fichier par sujet**, comme
  `docs/regles/`. `MEMOIRE.md` n'en garde que le **sommaire** (aucun fait). Seul l'**index** (une
  ligne brève par fait, groupée par sujet) part au moteur au lancement d'un agent ; le fichier d'un
  sujet se demande avec l'outil `project_memory`. **Le même outil sert aussi les RÈGLES
  (`docs/regles/`) et les CONTRÔLES (`docs/verifications.md`)** : un sujet demandé rend les faits, les
  règles ET les contrôles qui le concernent, jamais le reste.
- **Au LANCEMENT d'une carte, la demande sert de QUESTION** (`shared/src/passages-doc.ts`,
  `server/src/passages.ts`) : le démon cherche dans TOUS les Markdown du projet — où qu'ils soient,
  `docs/` compris, sauf `HISTORIQUE.md`, `MEMOIRE.avant-synthese.md` et les dépendances installées —,
  dans les fichiers de CONFIGURATION (`package.json`, services, Docker) et dans le CODE
  (`shared/src/passages-code.ts`), puis envoie les quelques PASSAGES qui répondent, à la place de
  l'index. Découpage par section ou par règle, index de recherche INCRÉMENTAL (migration 19).
  L'INDEX reste le REPLI : ce qui part tient sous plafond et ne doit JAMAIS peser plus que l'index
  remplacé, sinon la recherche est refusée. Les passages retrouvés sont visibles dans la BULLE
  « Mémoire retrouvée pour cette demande », posée sous la demande dans la conversation, et dans
  l'onglet « Détails ».
- **…ET LA RECHERCHE EST RELANCÉE À CHAQUE DEMANDE, plus seulement au premier tour**
  (`shared/src/passages-de-suite.ts` ; `rechercherPourLaSuite`, `server/src/passages.ts` ;
  `marquerPassagesServis`, `server/src/store.ts`) : une conversation change de sujet, la deuxième
  question porte souvent sur une règle que la première n'avait aucune raison de remonter. On cherche
  donc sur le TEXTE QUE L'UTILISATEUR VIENT D'ÉCRIRE, et la bulle montre ce qui a été trouvé pour CE
  message — au lieu du rappel générique « reprise de session, la mémoire a déjà été transmise », qui
  ne disait rien de la question posée. Trois garde-fous : un passage déjà servi DANS LA SESSION ne
  repart jamais (clés `source#titre`, oubliées par `oublierMemoireServie`), le plafond est le tiers
  de celui du lancement et le seuil de pertinence monte d'un cran (`seuilDeSuite`) — un tour de
  suite AJOUTE, il ne remplace aucun index. Sans rien de neuf, la raison le DIT (« la recherche a
  bien tourné sur cette demande ») ; au LANCEMENT, le repli reste l'index complet et se dit ainsi.
  Verrouillé par `server/src/test/passages-de-suite.test.ts` et
  `scripts/verif-memoire-a-chaque-demande.mjs`.
- **Le SENS vient d'un VRAI modèle de vectorisation, façon RAG, et il tourne EN LOCAL**
  (`shared/src/vecteurs-doc.ts`, `server/src/vecteurs-local.ts`, `server/src/vecteurs.ts`,
  migration 27) : `BAAI/bge-m3` en 1024 dimensions, exécuté SUR CE SERVEUR — aucun octet de
  documentation ne sort de la machine, aucun centime par appel. Il vit HORS DÉPÔT dans
  `data/vectoriseur` (bibliothèque + modèle > 1 Go ; chaque carte refait `npm install` dans sa copie,
  les y mettre ralentirait tous les lancements), posé par `node scripts/installer-vectoriseur.mjs` —
  même choix que Kokoro pour la voix. Un moteur EXTERNE (OpenRouter, `openai/text-embedding-3-small`
  en 512 dimensions, facturé) reste écrit mais ne sert que sur demande explicite
  (`HAIKODEV_EMBED_MOTEUR=openrouter`). La TAILLE du vecteur dépend donc du moteur : rien ne la
  suppose, c'est le NOM du modèle rangé à côté de chaque vecteur qui empêche de comparer deux
  échelles. L'ancienne empreinte par hachage de MOTS reste le REPLI, entier et sans panne, tant que
  le moteur manque ou que l'index n'est vectorisé qu'à moins de 75 % — part comptée sur les seuls
  DOCUMENTS, le CODE venant après et ne devant pas retenir la bascule. Le score reste MIXTE (sens +
  mots exacts), le sens pesant plus lourd quand il est vrai. Le CODE passe derrière la documentation
  (priorité négative) et n'occupe jamais plus de 2 passages. On ne VECTORISE que les 1 000 premiers
  signes d'un passage (le texte envoyé à l'agent reste entier) : le temps du modèle croît vite avec
  la longueur, 1 800 signes → 0,8 passage/s, 1 000 → 1,6, 600 → 2,3.
- **VECTORISER EST UN TRAVAIL DE FOND, jamais un péage au lancement d'une carte — ET IL REVIENT
  TOUTES LES SIX HEURES** (`server/src/vecteurs-nocturne.ts`, règles dans
  `shared/src/vecteurs-doc.ts`) : le démon réindexe et vectorise TOUS les projets non archivés, par
  tranches de 480 passages. DEUX AMPLEURS (`BORNES_DE_VECTORISATION`) — la passe de NUIT (fenêtre
  1 h – 3 h, avant l'auto-amélioration) est le grand rattrapage, 120 tranches et TROIS HEURES au
  plus ; les trois passes de JOUR ne reprennent que ce que les cartes viennent de modifier, 15
  tranches et DIX MINUTES au plus — sur un projet ordinaire elles n'ont rien à faire. Une seule
  passe par nuit laissait la journée défaire ce que la nuit venait de faire. « Ce n'est pas l'heure »
  n'est donc plus un refus : le rendez-vous dépend d'un DÉLAI (`PERIODE_VECTORISATION_MS`, 6 h),
  l'heure ne décide que de l'ampleur. Un travail en cours ne le REPORTE PAS : vectoriser n'appelle
  aucun moteur de langage et ne prend la place d'aucun agent. Au lancement d'une carte, seule la
  QUESTION est vectorisée. `HAIKODEV_DATA=/root/haikodev/data node scripts/vectoriser-index.mjs`
  le fait tout de suite à la main (`--etat` pour ne rien vectoriser et voir où en est chaque projet) ;
  forcée à la main, la passe garde l'ampleur de son HEURE — on ne bloque pas la machine trois heures
  en plein après-midi.
- **…ET UN PASSAGE INCHANGÉ GARDE SON VECTEUR, sinon la nuit travaille pour rien** (`vecteursRepris`,
  `cleDeVecteur`, `shared/src/vecteurs-doc.ts` ; `indexerDocumentation`, `server/src/passages.ts`) :
  l'indexation est incrémentale par FICHIER, si bien qu'un fichier réécrit d'UNE LIGNE voyait TOUS
  ses passages effacés puis réécrits sans vecteur. Sur HaikoDev — le seul projet dont la
  documentation est réécrite par presque chaque carte —, 390 passages sur 824 étaient donc sans
  vecteur le 16/08/2026 : `CLAUDE.md` en entier (122), `docs/regles/cartes.md` (75),
  `docs/regles/interface.md` (60), `docs/verifications.md` et tout `docs/memoire/` — exactement les
  fichiers qui comptent. L'index retombait sous `COUVERTURE_VECTEURS_MIN` (53 %) et TOUTE la
  recherche repassait par les MOTS, toute la journée, pendant que les autres projets (98 à 100 %)
  cherchaient par le sens. La nuit rattrapait, la journée redéfaisait. Un passage est désormais
  reconnu à son TITRE et à son TEXTE — jamais à son rang, qui glisse dès qu'une section est insérée —
  et garde son vecteur ; seul ce qui a VRAIMENT changé repart à vectoriser. Verrouillé par
  `server/src/test/memoire-des-vecteurs.test.ts` et `scripts/verif-memoire-des-vecteurs.mjs`.
- **L'INDEX RESTE EN MÉMOIRE VIVE ENTRE DEUX DEMANDES, il ne se relit plus en entier à chaque
  fois** (`indexEnMemoire`, `indexDuProjet`, `server/src/passages.ts`) : mesuré le 16/08/2026 sur
  120 demandes réelles, chaque recherche payait ~880 ms pour relire les 5 143 lignes de
  `doc_passages` et faire un `JSON.parse` de leur empreinte de repli — à CHAQUE tour, alors que
  presque rien n'avait changé depuis le précédent. Le démon garde désormais, PAR PROJET et pour
  toute la vie du processus, une carte `source → passages` tenue à jour par `indexerDocumentation`
  lui-même (un fichier modifié remplace SA seule entrée, un fichier disparu la retire) et par
  `vectoriserLIndex` (un vecteur calculé met à jour SON seul passage) — jamais par une relecture.
  Seul le tout premier accès à un projet, après un redémarrage, paie encore la lecture complète.
  Les « anciens » vecteurs à reprendre (`vecteursRepris`) restent lus en base, PAS depuis ce cache :
  lui seul est garanti à jour avec ce que `passages.ts` a écrit, un écrivain extérieur (un contrôle
  qui pose un vecteur en SQL direct, par exemple) le laisserait périmé. Une transaction qui échoue
  ne touche jamais au cache. Verrouillé par `server/src/test/recherche-passages.test.ts` et
  `scripts/verif-memoire-des-vecteurs.mjs` ; mesuré par `scripts/audit-memoire-rag.mjs`.
- **LE SOMMAIRE DES SUJETS VOYAGE AVEC LES PASSAGES** (`sommaireDesSujets`, `texteDuSommaire`,
  `shared/src/memoire.ts` ; `texteDesPassages`, `shared/src/passages-doc.ts`) : la recherche remplace
  l'INDEX de la mémoire, donc elle emportait avec lui la LISTE des sujets — alors que la MÉTHODE dit
  à l'agent de demander « le SUJET de ta tâche » à `project_memory`. Il devinait un nom, se trompait,
  et concluait sur les quelques passages reçus. Le bloc porte maintenant une ligne par sujet (son
  nom, son libellé, son nombre de faits) là où l'index en portait une par fait : ~150 jetons, contre
  4 310 pour l'index — l'économie passe de 74 % à 68 %, et le garde-fou de rentabilité reste
  appliqué sommaire compris. La MÉTHODE dit en outre que les passages reçus sont un EXTRAIT et non
  la mémoire.
- **LE CODE NE MANGE PLUS LE BUDGET DE LA DOCUMENTATION** (`PART_MAX_DU_CODE`, `plafondCode` de
  `choisirPassages`, `shared/src/passages-doc.ts`) : il était borné en NOMBRE (2 passages sur 7) mais
  pas en POIDS — or un passage de code fait 1 592 signes contre 578 pour une page de documentation,
  et deux morceaux bien placés prenaient les deux tiers du plafond. L'agent recevait alors DEUX
  fichiers source et UNE règle. Le code tient désormais dans 35 % du plafond, avec une exception
  voulue : le PREMIER passage de code passe toujours, sinon une demande qui NOMME un fichier ne le
  remonterait plus. Mesuré sur « est-ce que le programme peut décider tout seul d'envoyer le site
  chez le client ? » : 1 page de documentation avant, 3 après.
- **LE CLASSEMENT FAIT UN SECOND PAS : LA RÈGLE NOMME SON FICHIER, ET IL REMONTE AVEC ELLE**
  (`rebondSurLesFichiersCites`, `cheminsCites`, `GRAINES_DU_REBOND` = 8, `BONUS_FICHIER_CITE` = 0,15,
  `shared/src/passages-doc.ts` ; appliqué par `classerPassages`, coupable par `rebond: false` pour le
  mesurer). La bonne page — celle d'un fichier que la carte allait vraiment modifier — n'arrivait
  dans les sept servis que 67 fois sur 100, alors qu'elle est dans les cent premiers 95 fois sur
  100 : ce n'était donc PAS le plafond qui coupait trop tôt, c'était le classement qui ne voyait pas
  le rapport. Or ce rapport est ÉCRIT, et il l'est dans la documentation elle-même — ici, toute règle
  NOMME les fichiers qui la portent (« `shared/src/demon.ts` », « Verrouillé par
  `server/src/test/…` »). Une demande retrouvait donc très bien la RÈGLE ; c'est le FICHIER derrière
  elle qu'elle ratait, faute de partager un seul mot avec la question. On lit donc les chemins cités
  par les HUIT meilleurs passages de DOCUMENTATION (et par la question), et on relève d'un cran tout
  passage venu de l'un de ces fichiers : rien n'est ajouté au corpus, rien n'est écarté, seul l'ORDRE
  change — donc **pas un jeton de plus**. Mesuré sur 120 cartes réelles (`audit-memoire-rag.mjs`,
  section 3 bis) : **67 % → 78 %** en vérité large, **63 % → 77 %** en stricte, la bonne page dans
  les sept premiers rangs 73 % → 88 % ; en CONVERSATION, 27 % → 39 %. Les graines viennent de la
  DOCUMENTATION seule — un fichier de code cite surtout ses propres `import`. Essayé et REFUSÉ sur
  les mêmes cartes : peser le bonus au nombre de citations (74 %), l'étendre aux fichiers de même
  famille de nom (79 %, sans gain), à ceux dont le nom paraît dans la question (75 %), les cumuler
  (70 %), refaire un second rebond (74 %). La forme la plus simple gagne.
- **PAR LE SENS OU PAR LES MOTS, C'EST ÉCRIT DANS LA BULLE** (`SentContextSnapshot.passagesMode`,
  `shared/src/models.ts` ; `mentionDuModeDeRecherche`, `shared/src/prompt-envoye.ts`) : le repli sur
  les mots n'était visible NULLE PART — la bulle « Mémoire retrouvée » montrait des passages
  médiocres sans dire qu'ils avaient été choisis à l'ancienne, et la panne a duré des jours sans que
  personne ne puisse s'en apercevoir. La mention porte désormais le MODE et la COUVERTURE (« 4
  passages retrouvés · par les MOTS · 53 % de la documentation préparée ») — le seul chiffre qui
  explique le mode. Un contexte écrit avant cette règle ne raconte rien : le champ est absent, la
  mention reste celle d'avant.
- **UNE AMPLEUR IMPOSÉE NE SE FAIT PLUS RABAISSER PAR LE CRAN DE SUIVI** (`ampleurDuTour`,
  `shared/src/templates.ts`, branché dans `preparerLeTour`) : un tour de SUITE part d'un cran plus
  bas — vraie économie, elle reste. Mais elle écrasait `ampleur: 'complete'`, que `startCard` exige
  en toutes lettres : toute REPRISE de carte interrompue, tout relancement après panne, tout second
  tour d'un même agent se retrouvait à trois titres et 250 mots. Le cran ne joue donc que sur une
  ampleur DÉDUITE de la demande.
- **CE QUE LA RECHERCHE RAPPORTE EST MESURÉ, PAS SUPPOSÉ** (`scripts/audit-memoire-rag.mjs`,
  relevé complet dans `docs/audit-memoire-rag.md`) : il rejoue de VRAIES cartes déjà exécutées et
  prend pour vérité de terrain les fichiers que chacune a réellement modifiés, lus dans git. Sur 120
  cartes, le 16/08/2026 : **72 % d'économie** contre l'index (1 329 jetons contre 4 717, écart de
  cinq points seulement d'une carte à l'autre), **66 % des demandes** reçoivent au moins une page du
  bon fichier, le code ne prend plus que 6 % du poids envoyé. DEUX promesses ne tiennent pas. Le
  SENS n'apporte **aucun gain mesurable** au lancement d'une carte (66 % contre 66 % pour les mots,
  cinq victoires chacun) alors qu'il change la moitié des passages remontés : une demande de carte
  est déjà écrite avec le vocabulaire du projet. Et le SEUIL de pertinence ne filtrait rien (88 % du
  corpus le franchissait ; une question sur la tarte aux pommes recevait six passages de règles), si
  bien que le repli sur l'index ne pouvait plus se déclencher en mode sens — c'est ce que règle la
  ligne du SEUIL, plus bas. La recherche coûte enfin ~2,1 s
  par demande, dont 0,9 s à noter les 5 143 passages et ~1 s à les relire. Le relevé travaille sur
  une COPIE de la base du démon et ne pose aucun seuil : il mesure, il ne fait échouer personne.
  **ET IL NE SE MESURE PLUS LUI-MÊME** : ses deux questions « hors sujet » sont écrites en toutes
  lettres dans le script ET rappelées dans son rapport, tous deux indexés — la recherche
  retrouvait sa PROPRE COPIE (mots exacts 0,67) et le relevé concluait que le seuil ne filtrait
  plus rien. Tout passage venu de `audit-memoire-rag`, script comme rapport, est retiré du corpus.
- **…D'OÙ DEUX TERRAINS ET DEUX RÉGLAGES : les MOTS EXACTS au LANCEMENT d'une carte, le SENS en
  CONVERSATION** (`TerrainDeRecherche`, `SENS_PAR_TERRAIN`, `sensUtileSur`, `RAISON_TERRAIN_SANS_SENS`,
  `shared/src/vecteurs-doc.ts` ; quatrième argument de `classerPourLaQuestion`,
  `server/src/passages.ts`). Ce ne sont pas deux moments du même travail, ce sont deux populations de
  QUESTIONS. La demande d'une carte est un titre et une description RÉDIGÉS, déjà pleins du
  vocabulaire du projet, qui nomment souvent le fichier à toucher : mesuré sur 120 cartes réelles,
  DEUX relevés indépendants donnent la même égalité (**66 % contre 66 %**, puis **67 % contre 67 %**)
  — cinq cartes gagnées de chaque côté à chaque fois — alors que le sens change la MOITIÉ des
  passages remontés. Un message de conversation, lui, est TAPÉ comme on parle et ne partage plus ce
  vocabulaire : sur 55 vrais messages, le sens passe devant sur les deux vérités (**27 % contre
  25 %**, et **25 % contre 20 %** en vérité stricte) — un écart mince, que `verif-recherche-par-le-
  sens.mjs` appuie sur la vraie base en montrant qu'une question REFORMULÉE retrouve sa règle. Le
  mode se décide donc au TERRAIN, avant la couverture — et la question n'est même plus vectorisée au
  lancement (130 à 190 ms de moins par carte). **RIEN N'EST DÉMONTÉ** : le moteur local, la vectorisation de fond et la
  conservation des vecteurs restent en place, ils servent la conversation. DEUX effets à connaître :
  le REPLI SUR L'INDEX redevient possible au lancement (par les mots, une demande sans rapport ne
  passe plus le seuil — il était mort en mode sens tant que le seuil restait à 0,24, où 88 % du
  corpus le franchissait), et la bulle
  ne doit PAS lire ce choix comme la panne d'hier — d'où le drapeau `choisi`
  (`SentContextSnapshot.passagesMode.choisi`, `mentionDuModeDeRecherche`), qui écrit « par les mots
  exacts · le réglage de ce terrain » au lieu de « par les MOTS · 96 % de la documentation
  préparée ». Verrouillé par `server/src/test/vecteurs-doc.test.ts`,
  `scripts/verif-recherche-passages.mjs` (corpus fabriqué) et `scripts/verif-recherche-par-le-sens.mjs`
  (vraie base).
  **MAIS CETTE ÉGALITÉ A ÉTÉ MESURÉE AVANT LE REBOND, ET ELLE NE TIENT PLUS** (relevé du
  17/08/2026, section 12 de `docs/audit-memoire-rag.md`) : sur 327 cartes, rebond en place, le
  sens passe à **82 % contre 76 %** en vérité large et **81 % contre 74 %** en stricte, avec
  **36 victoires exclusives contre 16** — l'écart n'est plus du bruit. La raison est mécanique :
  le rebond transforme « avoir trouvé la bonne règle » en « avoir trouvé le bon fichier », et
  c'est le sens qui trouve la bonne règle. Le réglage n'a PAS été changé par la carte qui a posé
  le rebond — revenir au sens au lancement coûte 64 ms par carte et remet en jeu le repli sur
  l'index, donc le seuil : c'est une décision à part, avec sa mesure déjà faite.
- **LE SEUIL DU MODE SENS EST RÉGLÉ SUR CE BALAYAGE, PAS À L'ESTIME** (`SCORE_MINIMUM_VECTEUR`,
  `shared/src/vecteurs-doc.ts` ; section 5 bis de `scripts/audit-memoire-rag.mjs`) : à 0,24 il ne
  filtrait RIEN — 87 % du corpus le franchissait, une question sur la tarte aux pommes recevait six
  passages de règles, et le repli sur l'index ne pouvait plus se déclencher. Le relevé juge chaque
  valeur candidate sur les MÊMES 120 cartes et les MÊMES classements : de 0,24 à **0,38** la
  pertinence ne bouge pas d'une carte (80 sur 120), à 0,40 la première tombe. On prend donc la plus
  HAUTE de cette plage à coût nul — 0,05 de marge au-dessus du meilleur score qu'atteint une
  question étrangère au projet (0,33), quand 0,34 y collerait. Le corpus au-dessus du seuil passe de
  87 % à 10 %, ce qui part de 1 330 à 1 312 jetons, et une question hors sujet repart les mains
  vides : le repli sur l'index redevient ce qu'il devait être. Un tour de SUITE ajoutant sa marge
  (`seuilDeSuite`, +0,06) cherche donc à 0,44 — valeur que le même balayage donne encore à
  79 cartes sur 120. Refaire la mesure avant de retoucher ce nombre. Verrouillé par
  `server/src/test/vecteurs-doc.test.ts`.
  **REJOUÉ AVEC LE REBOND, le balayage recommande 0,48** (327 cartes, 17/08/2026) : aucune carte
  perdue jusque-là, la première tombe à 0,50, et le hors sujet repart les mains vides dès 0,44.
  Non appliqué : ce nombre est réglé sur les 5 184 passages de HaikoDev, or le corpus MINUSCULE
  de `verif-recherche-passages.mjs` fait sortir la bonne règle vers 0,39 — le monter demande de
  revoir ce contrôle avec lui.
- **Les MÉCANIQUES récurrentes vivent dans `docs/mecaniques/`** : un mode d'emploi court par geste
  qui se rejoue (ajouter un outil, une colonne, un écran, un contrôle, une règle durable), indexé en
  priorité haute par la recherche.
- **Un sujet servi une fois ne l'est pas deux dans la même session** : redemandé, il rend une ligne
  de rappel — sauf s'il a CHANGÉ depuis. Et une **reprise après compression** ne recharge que les
  sujets utiles à la carte (trois au plus), les autres étant seulement nommés. Même règle pour le
  chef d'orchestre et pour les agents de tâche.
- `HISTORIQUE.md` — les livraisons datées, écrites à la clôture d'une carte. **Jamais** envoyé au
  moteur.
- Au-delà d'un seuil, un petit modèle relit la mémoire et la resserre ; la version d'avant reste
  dans `MEMOIRE.avant-synthese.md`.
- **Envoi quotidien au cerveau** (`server/src/cerveau.ts`, règles dans `shared/src/cerveau.ts`) :
  une fois par jour, à heure creuse, chaque projet NON archivé envoie TOUTES ses pages Markdown
  (mémoire, instructions des moteurs, documentation, sous-dossiers compris) à
  `https://memoire.haiko-s1.com` (`POST /v1/memories`). Jamais `HISTORIQUE.md` ni
  `MEMOIRE.avant-synthese.md`, jamais un fichier écarté par `.gitignore`, jamais un dossier de
  machine (`node_modules`, `dist`, `data`…) ; 5 niveaux de profondeur, 150 pages et 300 000 signes
  au plus, les porteuses d'abord — le sommaire, les instructions, puis `docs/memoire/`. Un
  `discussion_id` stable par projet
  et par fichier fait REMPLACER au lieu d'empiler ; une empreinte SHA-256 par fichier évite de
  renvoyer l'inchangé, sauf rattrapage hebdomadaire. La clé vient de `CERVEAU_API_KEY`
  (`/etc/haikodev.env`, hors dépôt) : sans elle, l'envoi se tait et le dit dans les réglages.

## Règles à ne pas enfreindre

Seul le CONTRAT essentiel — les invariants NOMMÉS — vit ici. Le TEXTE ENTIER de chaque règle
(invariants, fichiers, tests qui la verrouillent) est rangé PAR SUJET dans `docs/regles/` (un fichier
par sujet, la carte est dans `docs/regles-du-moteur.md`) et se demande avec l'outil `project_memory`
(argument `sujet` : « publication », « cartes »…). Déplacer une règle, c'est la porter dans le fichier
de son sujet, jamais l'effacer — et une règle durable qui change se met à jour AUX DEUX endroits (ici
le nom, là-bas le texte).

### Publication

- **Ne jamais publier de sa propre initiative.** Enregistrer et pousser, oui ; mettre en ligne est un
  geste de l'utilisateur — aux deux étapes (déploiement, puis mise en production).
- **Ne JAMAIS redémarrer le serveur tant qu'une publication OU une tâche tourne**
  (`shared/src/demon.ts`) : le démon porte toutes les publications et tous les agents, le couper en
  tranche un en plein vol. Un redémarrage demandé est retenu — le bouton affiche « Redémarrage
  requis » — et rejoué tout seul dès le dernier travail fini ; même le clic ne passe jamais outre.
  **EXCEPTION : le chef d'orchestre peut arrêter TOUS les agents, puis redémarrer le serveur**
  (`chefArreteTousEtRedémarre`, `shared/src/demon.ts`) : le chef envoie `agents.stop-all` pour
  liquider immédiatement tout ce qui tourne, puis demande le redémarrage. Le verrou lâche prise. La
  situation est nommée dans les avertissements du redémarrage.
  **Ce qui retient le redémarrage est NOMMÉ, jamais un simple compte** (`agentsActifsDetail`,
  `server/src/runtime.ts` ; `EtatDemon.agentsDetail`, `raisonAgents`, `avertissementRedemarrage`,
  `shared/src/demon.ts`) : `agentsActifs()` compte TOUT agent vivant, y compris le chef d'orchestre,
  une analyse ou une mise en production — des rôles que le TABLEAU n'affiche jamais (il ne montre
  que les cartes, rôle `task`). Un « Un agent travaille en ce moment » sans le dire nommément
  laissait l'utilisateur sans moyen de vérifier ni de savoir où chercher. Le message nomme désormais
  le projet et la nature du travail (carte, chef d'orchestre, analyse, mise en production) quand on
  la connaît. **La PILE D'AGENTS de la colonne de gauche (bouton « Agents », en bas) montre la MÊME
  vérité** (`PileAgentsColonne`, `web/src/components/sidebar.tsx`) : elle ne filtre AUCUN rôle — une
  icône dédiée distingue chef d'orchestre (boussole), analyse (microscope) et mise en production
  (nuage), la carte gardant l'icône robot. Le statut `starting` compte comme actif, au même titre
  que `running` (déjà le cas dans le tableau) : sans lui, un tour PARTI (dès `demarrant.add`) restait
  invisible ici tant que la préparation durait (lecture du projet, recherche de mémoire…), avant même
  que le moteur n'écrive quoi que ce soit — c'est exactement la fenêtre où un agent pouvait retenir
  un redémarrage sans apparaître nulle part. `sendPrompt` (`server/src/runtime.ts`) pose désormais ce
  statut ET le diffuse (`agent.upsert`) AVANT `demarrant.add`, pas après.
- **Un SIGNAL d'arrêt venu du dehors suit la MÊME règle que le bouton** (`decisionSurSignalDArret`,
  `shared/src/demon.ts` ; `arretParSignal`, appelé en tête de `shutdown` dans `server/src/main.ts`) :
  un `SIGTERM`/`SIGINT` reçu pendant qu'un travail tourne est RETENU, dit, et rejoué seul à la fin —
  un signal répété compris. Un `systemctl stop` garde le dernier mot (`SIGKILL` après 20 s) et un
  `kill -9` ne se retient pas : d'où le second verrou, `process.title = 'haikodev-serveur'`, la ligne
  de commande du démon ne portant plus « server/dist/main.js ». **Ne JAMAIS lancer un `pkill -f` dont
  le motif peut désigner le démon** (`main.js`, `node`, un chemin du projet) : c'est ce qui a coupé
  quatre tâches le 14/08/2026. On vise le nom de SON propre script d'essai, jamais un chemin partagé.
- **Un SERVEUR D'ESSAI ne porte plus le nom du démon, et une commande qui pourrait le couper est
  REFUSÉE AVANT DE PARTIR** (`titreDuProcessus`, `shared/src/demon.ts` ; `commandeMenaceLeDemon`,
  `shared/src/garde-demon.ts` ; hook `PreToolUse` posé pour TOUS les agents Claude par
  `server/garde-demon.mjs`). Le nom unique s'était retourné contre lui-même : les scripts de contrôle
  lancent le vrai `server/dist/main.js`, donc leurs serveurs s'appelaient « haikodev-serveu » eux
  aussi, et un `pkill -9` visant ce nom a tué le démon (`status=9/KILL`) après onze étapes. Seul le
  serveur qui sert la base du dépôt s'appelle « haikodev-serveur » ; les autres, « haikodev-essai-
  <port> ». Le garde refuse `pkill`/`killall` au motif trop large (démon, `node`, `npm`, un moteur,
  la racine du dépôt), `kill` sur le numéro du démon (`HAIKODEV_DEMON_PID`) ou sur un groupe, et
  `systemctl restart/stop haikodev` même différé ; il laisse passer au moindre doute. Codex et Cursor
  n'ont pas ce crochet : la règle ne les couvre pas.
  Le surveillant système, lui, ne relance qu'après TROIS silences d'affilée
  (`scripts/haikodev-watchdog.sh`, posé en `/usr/local/bin/`).
- **Avant de construire, la publication RECOMPILE un module natif venu d'un autre Node**
  (`shared/src/module-natif.ts` ; `reparerLeModuleNatif`, `server/src/deploy.ts`) : `better-sqlite3`
  est une bibliothèque COMPILÉE, un binaire fabriqué pour une autre version de Node fait tomber d'un
  coup TOUT ce qui ouvre la base — 87 contrôles le 14/08/2026, dont cinq seulement sont nommés, dans
  du code sans faute. Reconnu au message, réparé par `npm rebuild --build-from-source` (jamais un
  binaire tout fait), essayé à chaque publication mais recompilé seulement sur un vrai refus.
- **TOUTE ÉTAPE DE PUBLICATION QUI TOMBE EST RÉPARÉE PUIS REJOUÉE**
  (`shared/src/reparation-publication.ts` ; `rejouerAvecDepannage`, `controlerLAdresse`,
  `server/src/deploy.ts`) : la fusion, les contrôles et la construction savaient déjà se relever ;
  l'ENVOI, la MISE EN LIGNE, le REDÉMARRAGE du service du projet et l'ADRESSE muette le savent
  désormais aussi. La panne est RECONNUE à son message, un agent de dépannage reçoit son nom et ses
  GESTES, l'étape est rejouée — `REPRISES_ETAPE_MAX` (2) fois au plus, `REPARATIONS_MAX` n'en étant
  plus qu'un alias. DEUX REFUS : une panne INCONNUE n'est jamais bricolée (elle est rendue telle
  quelle, avec ce qui a été tenté), une panne qui se règle AILLEURS (identifiant refusé, droit
  d'administration) est nommée sans qu'on envoie personne. DEUX LIMITES, écrites dans les gestes :
  rien n'est mis en ligne que l'utilisateur n'ait demandé — on rejoue SON étape, rien d'autre —, et
  le service du démon HaikoDev n'est JAMAIS touché. Les reprises se lisent dans le DÉROULÉ de la
  colonne (`steps[].reprises` et `.reparations`, « fait · 4 s · réparée · 1 reprise »), pas dans un
  journal. Verrouillé par `server/src/test/reparation-publication.test.ts` et
  `scripts/verif-reparation-publication.mjs`.
- **RANGER LES CARTES NE PEUT PLUS FAIRE ÉCHOUER UNE MISE EN LIGNE RÉUSSIE**
  (`DeployRun.avertissement`, `avertissementCartesNonRangees` ; fin de `startDeploy`) : le
  17/08/2026, un déploiement a tout mené à bien puis s'est déclaré en ÉCHEC sur une carte de la base
  devenue illisible (`sansModification` à `null`), avec pour message un dump de validation brut. Le
  rangement des cartes est de la COMPTABILITÉ : il vient APRÈS et ne peut plus démentir ce qui est en
  ligne. Chaque carte est rangée sous son propre filet, l'incident s'écrit en avertissement ORANGE
  sous le compte rendu, et le `catch` général passe par `raisonEchecAgent` — plus jamais un dump.
- **Un agent appelé pour DÉPANNER une publication reçoit un accueil MINIMAL** (`niveauDAccueil`,
  `shared/src/accueil-agent.ts` — le chef d'orchestre, lui, reçoit le palier `tri`) : conflit de fusion, contrôles tombés, construction cassée n'emportent
  ni index de mémoire, ni compétences, ni fichiers d'instructions — seulement le projet, son dossier et
  une consigne ciblée. La mise en production confiée, elle, garde l'accueil complet.
- **Déployer, c'est fusionner le lot « À déployer », enregistrer, pousser, puis mettre en ligne
  selon la PROCÉDURE définie** (`planDeMiseEnLigne`, `shared/src/mise-en-ligne.ts`). La MISE EN
  PRODUCTION suit, elle, le prompt réglé du projet. La mise en ligne compte donc DEUX étapes, que la
  colonne « En production » sépare, et sans procédure, aucune des deux ne part.
- **Un projet neuf n'a de procédure pour AUCUNE des deux étapes, et la colonne propose de
  l'INITIER** (`shared/src/procedure-publication.ts` ; `Project.deploiement` ; `procedure.tour`,
  `server/src/procedure-publication.ts` ; migration 22). Tant que la procédure est vide, la tête de
  la colonne porte « Initier le déploiement » / « Initier la mise en production » à la place du
  bouton d'action, et `startDeploy` refuse en renvoyant à ce bouton. Le clic ouvre un TIROIR où un
  agent lit le projet, DEMANDE comment l'étape doit se passer, puis écrit la procédure — enregistrée
  sur la cible de la colonne d'où il vient, JAMAIS sur l'autre. Une fois en place, une icône de
  réglages, en haut à DROITE de la colonne, rouvre le même tiroir. Les projets d'AVANT portent le
  marqueur `constate` : leur déploiement garde exactement le déroulé constaté.
- **Le tour de ce tiroir ne se livre PAS par la réponse de sa commande** (`EtatDeProcedure`,
  `repriseDuDialogue`, `issueDuTour`, `shared/src/procedure-publication.ts` ; événement `procedure`,
  commande `procedure.etat`) : il dure des MINUTES, la commande rend l'état tout de suite, le tour
  continue en fond et chaque changement est DIFFUSÉ. Le témoin suit le seul champ `enCours`, toute
  issue est dite (échec compris), rouvrir se raccroche au tour qui tourne au lieu d'en repayer un, et
  un dialogue perdu se dit au lieu de tourner sans fin.
- **Une procédure DÉJÀ écrite ne se redemande jamais toute seule** (`repriseDuDialogue`, issue
  `proposer` ; `promptModificationProcedure`, `mentionProcedureEnPlace`,
  `shared/src/procedure-publication.ts`) : l'icône de réglages relançait un agent complet à CHAQUE
  clic, qui relisait tout le projet pour reposer depuis le début une question déjà tranchée. Le
  tiroir montre la procédure en place et ATTEND — on écrit ce qu'on veut y changer (un seul tour,
  avec le contexte du projet et la procédure actuelle), ou on clique « Reposer la question ». Un tour
  ne part de lui-même que sur une étape encore VIERGE. L'instant du dernier tour n'est plus effacé à
  sa fin : c'est lui qui dit si la question rendue est encore fraîche.
- **La question posée par l'outil de cet agent s'affiche DANS le tiroir, et s'y répond**
  (`QuestionDeProcedure`, champ `question` de `EtatDeProcedure` ; `questionDeLAgent` et l'abonnement
  à `message.upsert`, `server/src/procedure-publication.ts`) : `ask_user` ARRÊTE le tour jusqu'à la
  réponse, et cette question ne paraissait que dans la cloche du bandeau — le tiroir ouvert dessous
  restait sur « L'agent travaille… », sans rien à répondre. La réponse part par `question.answer`,
  donc dans l'appel d'outil arrêté : aucun tour de plus n'est payé, et l'échange laisse sa trace dans
  le fil du tiroir.
- **Une carte qui ENTRE dans « À déployer » perd sa date de mise en ligne, et un bouton éteint DIT
  pourquoi** (`dateDeMiseEnLignePerimee` / `raisonLotBloque`, `shared/src/lot-a-deployer.ts` ;
  `rangerLaCarte`, `server/src/deplacement-carte.ts` ; migration 20). Sans cela, une carte revenue
  dans le lot en était écartée à jamais et « Tout déployer (0) » ne partait nulle part, sans un mot.
  Tant que le bouton refuse de partir, la cause s'écrit sous lui.
- **La BRANCHE de chaque étape se choisit dans les réglages du projet**
  (`brancheDePublication`, `shared/src/branche-de-publication.ts` ; `Project.branchesDePublication`) :
  une pour le déploiement, une pour la mise en production, prises dans la liste des branches du
  dépôt GITHUB (`project.branches`, `branchesDuDepot`). Rien de réglé : le déploiement va sur
  « dev » quand le dépôt en a une, sinon sur la branche principale constatée ; la mise en production
  reste sur la principale — le comportement d'avant, intact.

### Cartes

- **Toute demande de PROGRAMMATION ou d'EXÉCUTION passe par une carte**, quelle que soit sa taille :
  le chef PROPOSE (`board_create_card` / `propose_task`), la validation de l'utilisateur seule crée la
  carte. Une simple question se répond sans carte. Verrouillé par `server/src/test/tri-du-chef.test.ts`.
- **Les étapes complémentaires d'un même objectif forment UNE proposition** : le chef regroupe par
  résultat, chantier et ordre logique ; le bandeau permet aussi de fusionner plusieurs propositions
  encore en attente, sans créer de carte. Les sources restent marquées « fusionnées » et la
  proposition réunie reste éditable avant son unique validation.
- **Le CHEF D'ORCHESTRE NE FAIT QUE DEUX CHOSES : une carte COURTE et le NIVEAU de son agent.** Il
  n'ouvre plus le projet, ne chiffre plus, ne prépare plus de relais — l'étude appartient à la carte,
  après validation. Accueil ramené au palier `tri` (`niveauDAccueil`, `shared/src/accueil-agent.ts` :
  ni index de mémoire, ni fichiers d'instructions ; les compétences restent), consigne sans déroulé ni
  MÉTHODE en six points (`COMMUN_DU_CHEF`, `server/src/runtime.ts`), modèle par défaut économe. Le TRI
  lui-même ne bouge pas.
- **Trois NIVEAUX, jamais un modèle nommé** (`shared/src/niveau-agent.ts`) : « leger », « standard »,
  « approfondi », traduits en modèle et réflexion réels par l'appétit du catalogue. Le niveau décide du
  modèle au moment de PROPOSER, PAS celui du chef — sinon un chef économe ferait exécuter tout le
  tableau au rabais. Un choix fait ensuite à l'écran (moteur, modèle, réflexion) est enregistré
  (`proposal.config`) et c'est LUI qui part (`accorderRunDeProposition`) : ce qui s'affiche est ce
  qui s'exécute. Retenu sur `RunConfig.niveau`, modifiable à la main avant lancement.
- **La description exigée dépend de QUI propose** (`jugerDescription`, `shared/src/description-carte.ts`) :
  quatre parties et un repère concret (320-2400 signes) pour un agent qui a étudié ; la demande
  simplement REFORMULÉE (80-2400 signes) pour le chef, qui n'a rien ouvert et n'a donc rien à citer.
- **L'analyse d'un agent qui a VRAIMENT étudié voyage avec sa proposition** : chiffrage futur, mesure
  réelle ajoutée par le démon et relais factuel sont recopiés sur la carte ; l'agent lancé ne rechiffre
  alors pas par-dessus, mais l'exécution attend toujours un geste humain. Une carte du chef, elle,
  n'emporte aucun chiffrage : c'est son agent d'exécution qui chiffrera, au lancement.
- **Le MODE PLAN s'affine par ITÉRATIONS** (`TRI_MODE_PLAN`, `server/src/runtime.ts` ;
  `indexDuPlanCourant`, `shared/src/plan-conversation.ts`) : chaque réponse — relance, ajustement,
  refus — rend de nouveau les QUATRE parties EN ENTIER, enrichies des versions précédentes ; un seul
  plan vit dans la conversation, le DERNIER. Lui seul porte « Valider » / « Refuser » ; les
  précédents se replient et se relisent sans rien à décider. **Tout nouveau message REFUSE le plan
  précédent** : le démon le recopie dans le contexte du tour avec sa consigne de reprise
  (`planEnAttente` / `consigneDeRepriseDuPlan`). **Un texte qui n'annonce pas ses quatre parties
  n'est PAS un plan, et le démon le VÉRIFIE** (`jugerLePlan`, `shared/src/plan-complet.ts`, jugé en
  fin de `startTurn`) : incomplet avec une version précédente au fil, le chef est RELANCÉ une fois,
  sans outil ; sinon le message perd son cadre et ses boutons. Une QUESTION se répond DANS le plan,
  un choix à soumettre se pose APRÈS les quatre parties. **Le mode plan ne retire PAS ses outils au chef**
  (`modePlanFermeLEcriture`, `shared/src/droits-mode-plan.ts`) : il garde `write_document` et
  `ask_user`, et une décision qui ne lui appartient pas se demande AVANT le plan, jamais tranchée
  « par défaut ». L'entête du cadre tient sur UNE ligne ; son PIED s'empile sous 640 px.
- **UN PLAN NE S'AFFICHE QU'UNE FOIS LE TOUR RENDU** (`plan: planRendu` en fin de `startTurn`,
  `server/src/runtime.ts` ; `cadreDePlanVisible`, `shared/src/plan-conversation.ts`) : le drapeau
  `plan` était posé au LANCEMENT du tour, donc le cadre s'ouvrait sur la première bribe de texte —
  une phrase d'intention portait déjà son sélecteur de niveau et ses boutons pendant que l'agent
  continuait de chercher, et l'on pouvait valider un plan VIDE. Il ne se pose plus qu'à la FIN, une
  fois le texte jugé entier ; l'affichage refuse en plus le cadre sur tout message encore en
  écriture. Vérifié par `scripts/verif-plan-en-cours.mjs`.
- **…ET IL S'AFFICHE À L'INSTANT OÙ IL EST RENDU, PLUS UNE MINUTE APRÈS** (`etapes` et
  `estUneEtapeNumerotee`, `shared/src/plan-complet.ts` ; ordre de fin de `startTurn` et cadre posé
  AVANT `rendreLePlanEntier`, `server/src/runtime.ts`) : le plan restait du TEXTE BRUT — sans cadre,
  sans niveau, sans « Valider » — une à deux minutes après avoir fini de s'écrire, et se
  transformait tout seul plus tard. TROIS causes, toutes réparées. (1) Le compteur d'ÉTAPES
  n'acceptait qu'un numéro NU en tête de ligne (« 1. »), alors que le chef titre ses étapes et écrit
  donc « **Étape 1 — …** » ou « ### 2. … » : le reproche `chemin-sans-etapes` partait sur les DOUZE
  derniers plans du projet, et la relance de fond — un tour de moteur ENTIER, 60 à 120 s mesurées —
  ne pouvait rien y changer puisqu'elle redemandait ce qui était déjà là. On enlève désormais
  l'habillage (titre, puce, gras) avant de chercher le numéro, borné à DEUX chiffres pour qu'une
  date ne passe pas pour une étape. (2) La COMPTABILITÉ du tour — relire le quota chez le
  fournisseur, en file derrière les autres tours du même compte — se faisait AVANT le dernier
  `pushMessage` : le message restait « en écriture » pendant un appel réseau qui ne regarde que des
  chiffres. Elle passe APRÈS, dans la même frontière sûre. (3) Quand la reprise de fond est
  VRAIMENT justifiée, le cadre est posé AVANT elle (`content` + `plan: true` + `streaming: false`) :
  la forme est acquise, le plan est décidable, et cette exigence-là ne retire jamais le drapeau — si
  la reprise améliore le texte, il se remplace DANS le cadre. La règle qui l'encadre ne bouge pas :
  aucun cadre sur un message encore en écriture, aucun sur un texte qui n'a pas ses quatre parties.
  Corollaire d'affichage : une étape « en cours » prime sur le bilan du déroulé (`enCours`,
  `web/src/components/steps.tsx`), mais seulement sur le DERNIER message d'un agent AU TRAVAIL
  (`agentAuTravail`) — ailleurs, c'est le reliquat d'un tour coupé. Verrouillé par
  `server/src/test/mode-plan.test.ts` et `scripts/verif-plan-en-cours.mjs`.
- **Le FOND du plan est vérifié aussi : quatre titres ne font pas un plan réfléchi** (`jugerLeFond`,
  `EXIGENCES_DE_FOND`, `consigneDePlanPlusFouille`, `shared/src/plan-complet.ts`) : une analyse
  CONSTATÉE sous FAISABILITÉ, des étapes numérotées, des sous-titres, des améliorations en liste — et
  jamais un pavé. Le chef est relancé UNE FOIS de plus, sans exiger de plan précédent. **Cette
  exigence ne retire JAMAIS le drapeau `plan`** : un plan mince mais entier reste décidable.
- **Le cadre du plan pose son PROPRE FOND GRIS** (`--fond-plan`, `web/src/styles.css` ; couleur
  `fond-plan` de Tailwind) : un jeton neutre décliné pour les deux thèmes, jamais une couleur d'état
  ni une opacité posée sur `surface`.
- **« Refuser » ÉCRIT dans la barre d'écriture, sans rien envoyer**, et les SUGGESTIONS d'un plan
  viennent du plan lui-même (`estTitreDesSuggestions`, `shared/src/suggestions-de-plan.ts` ;
  `autreTitreCliquable` de `Markdown`) : sa partie « Améliorations apportées » est une LISTE d'idées
  à AJOUTER, cliquable comme les « Évolutions possibles » d'un agent — un clic la retient dans la
  barre, un second la retire. Les pastilles d'axes de réflexion sous le cadre sont RETIRÉES. Aucun
  tour ne part sans un geste de l'utilisateur ; seul « Valider » enchaîne tout seul.
- **La carte suit les ÉTAPES RÉELLES du travail** (`shared/src/suivi-colonne.ts`) : seul un agent de
  rôle « task » la déplace ; « analysis », « orchestrator » et « deploy » ne la déplacent jamais.
- **Une carte NAÎT dans « Planifié »** (`createCard`, `server/src/tools.ts`) : ni « Validé » ni « À
  faire » n'existent, le tableau compte SEPT colonnes (`COLUMN_KEYS`, `shared/src/columns.ts`).
  Valider une carte AUTORISE la dépense sans la déplacer et sans rien envoyer au moteur (drapeau
  `card.analyseDemandee`), et le lancement reste un geste humain — garanti par la règle de pause, pas
  par une colonne d'attente.
- **RIEN NE PART AU MOTEUR AVANT LE LANCEMENT** (`startCard`, `server/src/scheduler.ts`) : une carte
  en « Planifié » ne coûte rien. Le lancement crée UN SEUL agent, qui étudie le projet, chiffre la
  tâche et l'exécute dans le MÊME tour ; les chiffres rendus (bloc json, `CONSIGNE_CHIFFRAGE`) sont
  écrits sur la carte avec la mesure réelle du moteur.
- **UN LANCEMENT RÉPOND DÈS QUE LE TOUR EST PARTI, ET UN PIED DE COLONNE NE FIGE JAMAIS L'ÉCRAN**
  (`void sendPrompt(…)` dans `startCard` ; `PLAFOND_ATTENTE_LOT_MS`, `gesteResteEnRoute`,
  `bilanEnRoute`, `shared/src/lot-colonne.ts` ; `appliquerLot`, `web/src/components/board.tsx`) :
  `sendPrompt` ne rendant la main qu'à la FIN du tour, `card.start` / `card.move` restaient sans
  réponse jusqu'au délai du navigateur — boutons éteints et « Aucune carte lancée » sur des agents
  qui démarraient. Le pied rend la main au bout de 6 s en disant « en route », son témoin
  d'occupation est PAR COLONNE (`colonneQuiTravaille`), et un délai dépassé n'est plus compté comme
  un refus. Verrouillé par `server/src/test/geste-de-lot.test.ts`.
- **LA LISTE DE TÂCHES SE REFERME AVEC LE TOUR** (`cloturerLesTaches`,
  `shared/src/taches-fin-de-tour.ts`) : aucune ligne ne reste « en cours » une fois la réponse rendue.
  Un tour RENDU coche la ligne qui tournait (marquée `closedByTurnEnd` : c'est le démon qui coche,
  pas l'agent) ; un tour INTERROMPU — panne, quota, arrêt à la main, redémarrage — ne coche rien. Ce
  qui n'a pas été mené à bout passe à `unfinished` et le DIT (« non faite »), au lieu d'attendre pour
  toujours. Branchée sur TOUS les chemins de fermeture (`server/src/runtime.ts`), sans effet sur une
  liste déjà refermée ; les listes déjà figées en base sont reprises par la migration 23.
  **Le décompte porté par l'AGENT se referme avec elle** (`progressionDesTaches`,
  `poserLaProgression`) : le décroché du tableau ne lit pas les étapes mais ce résumé
  (`agent.todos`), qui restait figé sur l'avant-dernière liste reçue — la conversation disait
  « 5/5 faites » et la carte « 4/5 », à vie. Un reste non fait s'y DIT désormais
  (« 3/5 faites · 2 non faites », `mentionProgressionTaches`), et les décomptes déjà figés sont
  repris par la migration 24 — qui, comme toute migration de RÉPARATION, nomme la table qu'elle
  attend (`siTable`) et se reporte au lieu d'échouer sur une base d'essai partielle.

- **UNE QUESTION ARRÊTE L'AGENT JUSQU'À LA RÉPONSE** (`shared/src/attente-question.ts`,
  `server/src/attente-question.ts` ; route `/internal/attente`, boucle du pont dans
  `server/mcp-bridge.mjs`) : l'appel d'outil `ask_user` ne rend la main qu'une fois l'utilisateur
  ayant répondu — le moteur est donc arrêté par la mécanique même du protocole d'outils, au lieu
  d'enchaîner les étapes suivantes de sa liste pendant que la réponse dormait dans la FILE de
  l'agent, lue seulement à la fin du travail. Le pont redemande par tranches de 20 s, `question.answer`
  RÉVEILLE l'attente au lieu d'appeler `sendPrompt` (reprise dans le MÊME tour, rien en file), et
  quatre issues sont dites au moteur : réponse, question annulée, plafond de 30 minutes (l'agent
  s'arrête sans deviner ; la réponse tardive relance un tour par le chemin d'avant), attente perdue.
  Les moteurs reçoivent le délai d'appel qu'il faut (`MCP_TOOL_TIMEOUT`, `tool_timeout_sec`), sans
  quoi Claude abandonnerait à 5 minutes et Codex à 1. L'agent porte `attendReponse` pendant ce temps :
  la barre d'écriture dit « l'agent attend votre réponse », jamais « votre message attendra son tour ».
  Verrouillé par `server/src/test/attente-question.test.ts` et `scripts/verif-attente-question.mjs`.
- **UN ARRÊT AGIT TOUJOURS, ET DIT CE QU'IL A FAIT** (`decisionDArret`,
  `shared/src/arret-de-secours.ts` ; `arreterLAgent`, `server/src/runtime.ts`) : sans tour vivant à
  couper — préparation pendue, fermeture avalée par une panne —, le bouton rendait « faux » en
  silence et l'agent restait « au travail » pour toujours. Trois gestes nommés : « coupe »,
  « secours » (tour refermé d'autorité, agent en `stopped`, jamais en « échec ») et « inactif ». Le
  passage à « starting » rafraîchit `startedAt` (d'où les durées de milliers d'heures), et l'arrêt
  s'atteint aussi depuis la PILE d'agents de la colonne de gauche. Verrouillé par
  `server/src/test/arret-de-secours.test.ts` et `scripts/verif-arret-agent-bloque.mjs`.
- **…ET IL MORD SUR UN MOTEUR QUI FAIT LA SOURDE OREILLE** (`tourACouper`, `arretAAchever`,
  `DELAI_CONFIRMATION_ARRET_MS`, `MESSAGE_ARRET_SERVICE`, `shared/src/arret-de-secours.ts` ;
  `moteurRepondEncore`, `acheverLArretSiBesoin`, `suivreLeService`, `server/src/runtime.ts` ;
  `arreterProcessus`, `server/src/engines/fin-de-processus.ts`) : répondre quand il n'y a RIEN à
  couper ne suffisait pas — le clic restait muet quand il y avait quelque chose à couper qui ne se
  laissait pas faire. QUATRE trous. Un tour vivant SANS moteur (le tour reste inscrit tout le temps
  du service d'après-réponse) se REFERME au lieu de se « couper » : on constate le processus
  (`processusVivant` sur `handle.pid`, jamais `child.killed`) et la réponse figée, un numéro inconnu
  valant « supposé vivant ». Les moteurs de SERVICE — compression, relance de plan — s'inscrivent
  par `EngineRunOptions.surLancement` (les TROIS adaptateurs) et tombent avec le reste. Le SIGNAL
  n'étant qu'une demande, on revient constater 6 s plus tard et on referme d'autorité si le MÊME
  tour est encore là. Et le coup de grâce emporte la DESCENDANCE, lue dans
  `/proc/<pid>/task/*/children` à partir du seul numéro du moteur — **jamais un groupe de
  processus** (les moteurs n'étant pas `detached`, ils portent le groupe du DÉMON). Tous les gestes
  se disent à l'écran, « coupe » compris (`ws.ts`). Verrouillé par
  `server/src/test/arret-de-secours.test.ts` et `scripts/verif-arret-moteur-recalcitrant.mjs`.
- **Une carte peut porter une DATE de départ** (`scheduling.departPrevu`, `shared/src/depart-programme.ts`) :
  elle attend dans « Planifié », dit quand elle partira, et part à l'heure dite par le même
  `startCard` que le bouton. Troisième autorisation explicite à côté de « Dès que possible » ; une
  heure manquée est rattrapée, la suspension à la main l'emporte, et le départ CONSOMME la date.
- **…et une carte SANS date DIT quand il serait opportun de la lancer, sans coûter un jeton**
  (`shared/src/heure-de-lancement.ts`, `server/src/heure-de-lancement.ts` ;
  `scheduling.creneauConseille`, posé par `createCard`) : heures creuses réglées, CREUX MESURÉ sur
  les relevés (`profilHoraire`) et état des comptes du moteur, recoupés par le démon — **aucun
  moteur n'est appelé**, ni à la proposition ni ensuite. Ce qui est GARDÉ ne dépend jamais de
  l'heure du calcul : une PLAGE, sa source, le drapeau `lourde`, la reprise du quota — jamais une
  date ni une phrase, sinon une carte créée à 2 h répéterait « c'est le bon moment » tout
  l'après-midi. Le moment réel et la phrase se recalculent à CHAQUE affichage
  (`momentDuCreneau`, `phraseDuCreneau`). Le conseil ne décide de rien : un bouton « Retenir cette
  heure » le recopie dans `departPrevu`, et il se TAIT dès qu'une date existe. Verrouillé par
  `server/src/test/heure-de-lancement.test.ts` et `scripts/verif-creneau-conseille.mjs`.
- **Une carte dont un agent TRAVAILLE ne s'affiche jamais ailleurs qu'en « En cours »**
  (`colonneAffichee`, `shared/src/colonne-affichee.ts`, branché sur `byColumn` dans `board.tsx`) :
  quand un agent tourne, l'agent fait foi, pas la colonne enregistrée — qu'on ne touche pas. Correction
  d'AFFICHAGE seulement, DITE sur la carte, et uniquement depuis « Notes » / « Planifié » : une carte
  rendue dont on relance l'agent ne bouge pas.
- **L'alerte « le serveur ne répond pas » ne paraît que sur une indisponibilité RÉELLE et DURABLE**
  (`alerteServeurInjoignable`, `shared/src/panne-serveur.ts` ; `Client.signalerRefus`) : canal coupé
  depuis plus de 15 s, ou deux requêtes d'affilée sans réponse. Une requête isolée qui expire est
  rendue à l'appelant, jamais affichée en bulle rouge — un lancement ne répond qu'à la FIN du tour.
- **UN RAPPORT RENDU FERME LA CARTE, avec ou sans code modifié** (`colonneEnFinDeTour`,
  `shared/src/suivi-colonne.ts`) : la clôture attendait un CONSTAT de fichiers modifiés, et plantait
  en « En cours » les cartes de vérification, celles dont l'agent conclut qu'il n'y avait rien à
  faire, celles dont tout le travail tenait dans le rapport — le tableau démentait la conversation.
  Le constat du dépôt rend toujours QUATRE réponses (`TraceDuTravail`,
  `shared/src/carte-interrompue.ts` : oui, non, « je n'ai pas pu regarder », « ça a bougé AILLEURS »)
  mais il ne décide plus de la COLONNE, seulement de la PHRASE portée par la carte close. Deux
  garde-fous inchangés : un tour en ÉCHEC ou INTERROMPU n'est pas un rapport rendu, un rôle qui
  n'exécute pas ne déplace rien. CONSÉQUENCE ASSUMÉE, dite en clair sur la carte
  (`RAISON_RENDU_SANS_CODE`) : « Terminé » sans qu'aucun code n'ait changé — rien n'est promis à la
  livraison. Rien ne change après « Terminé » : déployer reste un geste de l'utilisateur.
- **UNE CARTE RESTÉE EN « EN COURS » DIT CE QUI TOURNE ENCORE** (`travailRestant`,
  `phraseDuTravailRestant`, `dureeDite`, `shared/src/travail-restant.ts` ; `data-travail-restant`,
  `web/src/components/board.tsx`) : pendant obligé de la règle ci-dessus — une carte qui RESTE là a
  forcément une raison, et elle se lit sans ouvrir la carte. Une ligne, trois choses : l'ÉTAPE que
  l'agent vient de nommer, DEPUIS QUAND, et CE QU'ON ATTEND. Quatre situations, dans cet ordre : une
  QUESTION attend (seul cas où l'on attend l'utilisateur, elle passe devant), un AGENT travaille
  (avec ce qui reste de sa liste), un TOUR se range (`tourEnVolDepuis`), PLUS PERSONNE — anomalie que
  le balayage corrige en quinze secondes, écrite quand même. Règle PURE, `null` hors de « En cours ».
  Verrouillé par `server/src/test/travail-restant.test.ts` et
  `scripts/verif-carte-rangee-sans-changement.mjs`.
- **LE CONSTAT REGARDE LES DEUX DOSSIERS : la copie de la carte ET le dossier PARTAGÉ du projet**
  (`traceDuTravailDuTour` / `fichiersRemues`, `server/src/hors-tache.ts` ; `RAISON_TRAVAIL_HORS_COPIE`,
  `shared/src/carte-interrompue.ts`). Un agent est censé rester dans sa copie, rien ne l'y oblige : un
  `cd` vers la racine du projet ou un chemin relatif écrit depuis cette racine, et son travail atterrit
  à côté. La copie restait alors vierge, le dossier du projet portait pourtant ses fichiers modifiés,
  et la carte s'entendait dire « aucun fichier n'a changé » — phrase que l'utilisateur démentait d'un
  `git status`. On note donc ce qui remue DÉJÀ dans le dossier partagé AVANT le tour, et ce qui s'y
  ajoute pendant vaut trace `ailleurs` : la carte se ferme comme les autres, mais sa phrase dit ce
  qui a été vu et où le chercher, et reste une ATTENTE (rien n'est récoltable sur sa branche). Le dossier partagé
  étant aussi celui du chef, de l'analyse et de la publication, on ne compare JAMAIS son état absolu —
  seulement le delta du tour ; et une carte qui travaille à même le dossier du projet n'a qu'un
  dossier, donc rien de plus à demander. Verrouillé par `server/src/test/travail-hors-copie.test.ts`
  et `scripts/verif-travail-hors-copie.mjs`.
- **Mais RIEN NE RESTE COINCÉ DANS « EN COURS » : chaque fin de tour a une ISSUE**
  (`issueDeFinDeTour`, `shared/src/suivi-colonne.ts` ; `carteApresFinDeTour`,
  `server/src/deplacement-carte.ts`). Dépôt qui a bougé → « Terminé ». Rien changé mais code DÉJÀ
  livré (`card.codeDejaEnregistre`) → « Terminé » avec sa raison : il n'y avait rien à refaire, le
  travail est constaté sur un tour antérieur. Rien changé et rien jamais enregistré, ou dépôt non
  consultable → « Terminé » aussi, avec la raison écrite dessus (`RAISON_RENDU_SANS_CODE`,
  `RAISON_TRACE_INCONNUE`). PLUS AUCUNE issue ne RETIENT la carte : `retenue` a disparu de la règle,
  et une carte close ne garde ni `suspendu` ni `waitingReason` d'un tour précédent. Un tour en ÉCHEC
  ne bouge rien : l'incident est déjà dit en rouge, là où on relance. Verrouillé par
  `server/src/test/suivi-colonne.test.ts` et `scripts/verif-carte-rangee-sans-changement.mjs`.
- **…et les cartes DÉJÀ coincées sont rattrapées par un BALAYAGE** (`issueDeCarteOubliee`,
  `shared/src/suivi-colonne.ts` ; `rangerLesCartesOubliees`, `server/src/deplacement-carte.ts`, appelé
  par `tick`) : une fin de tour ne range que SA carte, et celles bloquées avant cette règle n'attendent
  plus aucune fin de tour. Toutes les quinze secondes — donc aussi au démarrage —, le démon relit
  « En cours » (`store.cartesEnCours`) et applique la MÊME issue : code déjà livré → « Terminé »,
  sinon → « Terminé » aussi avec `RAISON_TOUR_SANS_ISSUE` (leur tour avait rendu la main, c'est le
  rangement qui a manqué). Trois refus rendent le balayage sûr : un
  tour qui TIENT encore la carte (marque `tourEnVolDepuis`), un agent au travail, un dernier tour en
  ÉCHEC ou arrêté à la main.
- **Une PHRASE de carte ne dit JAMAIS le contraire de ce qui s'est passé**
  (`RAISON_DEJA_LIVRE`, `RAISON_TRAVAIL_SAUVE`, `natureDeLaMention`, `shared/src/suivi-colonne.ts` ;
  migration 25) : une carte dont le code était enregistré ET fusionné affichait « Rien à changer »
  dans un encadré JAUNE, à côté de la coche du travail rendu. La phrase commence désormais par le
  FAIT (« Travail déjà enregistré : le code de cette carte est bien sur sa branche… »), un troisième
  ton existe (« information », gris : carte close, rien livré, personne n'attend), les phrases
  déjà en base sont réécrites, et le TON suit la règle : une phrase de TRAVAIL acquis s'affiche en
  BLEU avec une coche, une phrase d'ATTENTE garde son jaune. Le travail sauvé d'office par le ménage
  du démarrage le DIT tout de suite sur la carte, et la carte derrière une branche se reconnaît à son
  NUMÉRO (`estLaBrancheDeLaCarte`), plus au nom entier — un titre modifié entre l'interruption et le
  redémarrage lui faisait perdre son drapeau `codeDejaEnregistre`. Enfin le MÉNAGE DES DOSSIERS PASSE
  DEVANT TOUTE RELANCE (`menageEnCours`, `server/src/scheduler.ts` ; `ouvrirDossierDeCarte` mis dans
  la même file que `refermerDossierDeCarte`) : sinon l'ordonnanceur rendait à un agent une copie de
  travail que le ménage était en train de retirer, avec le travail écrit dedans.
- **Une carte INTERROMPUE se « REPRENDRE », elle ne repart pas de zéro**
  (`shared/src/reprise-carte.ts`) : une carte de « Planifié » qui a déjà travaillé (`attempts`,
  `restarts`, `codeDejaEnregistre`) est une REPRISE — `carteSeReprend`, cause reconnue par
  `origineDeReprise` sur la phrase déjà écrite. Le bouton dit « Reprendre » (`libelleDeLancement`),
  le pied de colonne « Tout reprendre » quand TOUTES se reprennent (`libelleDuLotDeLancement`), la
  carte et son tiroir portent le repère. Le départ garde le MÊME agent — donc le fil du moteur, le
  dossier et la branche — et pose devant la demande une CONSIGNE (`consigneDeReprise`) qui sépare
  les étapes DÉJÀ FAITES de celles qui RESTENT. Et le travail déjà écrit ne se perd plus :
  `enregistrerLeTravailEnCours` (`server/src/dossier-de-carte.ts`) le commite d'office sur la
  branche de la carte avant toute fermeture — un dossier « sale » ne reste plus ouvert, ce travail
  part au déploiement —, le ménage du démarrage pose `codeDejaEnregistre` sur la carte derrière
  chaque branche rattrapée, et `travailDejaSurLaBranche` refait le constat au lancement : sans cela,
  une reprise qui n'avait plus rien à changer s'entendait dire « aucun fichier n'a changé ».
  Verrouillé par `server/src/test/reprise-carte.test.ts` et `scripts/verif-reprise-carte.mjs`.
- **Une tâche COUPÉE PAR UNE PANNE ne passe jamais pour terminée** (`shared/src/carte-interrompue.ts`)
  : tant qu'un tour d'exécution tient une carte, elle porte une MARQUE (`scheduling.tourEnVolDepuis`),
  retirée seulement une fois la carte rangée. Aucun moteur ne survivant à un arrêt du serveur, toute
  marque encore là au démarrage désigne un tour coupé : le démon les balaie TOUTES
  (`store.cartesEnVol`, `rendreLaCarteInterrompue`) sans se fier au statut de l'agent — retour en
  « Planifié », date de clôture effacée, raison écrite dessus, reprise toute seule, et le compteur
  d'essais intact. Verrouillé par `server/src/test/carte-interrompue.test.ts` et
  `scripts/verif-carte-interrompue.mjs`.
- **« Archivé », « En production » et « À déployer » ne se rouvrent que sur GESTE HUMAIN.** Un projet
  qu'on retire est MIS DE CÔTÉ (`project.archive`, `archived = 1`), jamais supprimé.
- **Les champs d'une carte sont de VRAIES colonnes** (`shared/src/carte-sql.ts`, migration 17 de
  `server/src/db.ts`) : description, origine, agent, drapeaux, dates et réglages d'exécution ont leur
  colonne SQL ; les étiquettes et les pièces jointes ont leur table fille (`card_labels`,
  `card_attachments`). Le bloc `data` ne garde que le vraiment libre. Une carte se lit et s'écrit par
  `carteDepuisLigne` / `colonnesDeLaCarte`, jamais par `JSON.parse(data)` — les scripts passent par
  `scripts/carte-en-base.mjs`.

- **UN SERVICE EXTÉRIEUR PEUT POSER UNE CARTE, par une porte gardée par des CLÉS NOMMÉES**
  (`shared/src/cles-api.ts`, `server/src/cles-api.ts` ; `POST /api/externe/carte`,
  `ROUTE_CARTE_EXTERNE` ; migration 21). La porte s'ouvre AVANT le mur d'accès et n'ouvre QUE cela :
  créer une carte. Elle passe par `createCard`, donc la carte naît en « Planifié », sans agent —
  **rien ne part au moteur**, le lancement reste un geste humain. Une clé par service, nommée, datée
  et révocable dans l'onglet « Accès API » des réglages ; le SECRET n'est gardé nulle part (empreinte
  SHA-256 + aperçu), montré une seule fois. Révoquer DATE la clé sans effacer son histoire. Le projet
  se désigne par son NOM ou son identifiant (`trouverLeProjetVise`), et tout refus se dit en clair.
  **Le MODE D'EMPLOI est PUBLIC à l'adresse `/api`** (`ROUTE_DOC_API`, `shared/src/doc-api.ts`) :
  ouvert avant le mur d'accès, en HTML pour un humain et en JSON pour un outil, en lecture seule et
  sans toucher la base — il naît des constantes de `cles-api.ts`, donc il ne peut pas mentir sur ce
  que la porte accepte. Verrouillé par `server/src/test/cles-api.test.ts`,
  `server/src/test/doc-api.test.ts` et `scripts/verif-cles-api.mjs`.
  **La MÊME clé ouvre aussi une LECTURE : `GET /api/externe/clients`** (`ROUTE_CLIENTS_EXTERNE`,
  `rechercherClientsParNom`) retrouve un projet à partir du NOM d'un client déjà rapproché
  (`Project.billing`), pas seulement de son identifiant — recherche partielle, sans accents ni casse,
  sur `?client=`, comparée au nom du client ET à celui de son entreprise. Texte entier dans
  `docs/regles/cartes.md`.

- **Chaque NUIT VERS 3 H, un agent d'analyse cherche ce qui peut être amélioré, et il ne fait que
  PROPOSER** (`shared/src/auto-amelioration.ts`, `server/src/auto-amelioration.ts`, veille lancée par
  `planifierAutoAmelioration` dans `main.ts`) : performance, code jamais appelé, doublons, fichiers et
  documentation que rien ne lit, mémoire qui gonfle, contrôles en double (`AXES_D_EXAMEN`). Rôle
  `analysis` — il ne modifie RIEN —, sortie unique `propose_task`, TROIS propositions au plus
  (`PROPOSITIONS_MAX`), et le projet examiné est HaikoDev lui-même (`project.isSelf`). Démarre dans la
  fenêtre 3 h – 5 h ; **sans place libre pour l'agent, il ATTEND au lieu de sauter la nuit**
  (`canStartAgent`, `server/src/capacity.ts`) — l'attente engagée dans la fenêtre continue au-delà de
  5 h, jusqu'à dix-huit heures (`ATTENTE_PLACE_MAX_MS`), pour trouver sa place dès qu'elle se libère ;
  aucun rattrapage au démarrage, la réserve du jour ne se dépense pas en pleine journée.
  **CE RENDEZ-VOUS SE CONCLUT SEUL**
  (`accepterPropositionsDeLaNuit`) : chaque proposition encore en attente à la fin du tour devient,
  SANS clic, une carte réelle posée dans « Planifié » et étiquetée « auto amélioration »
  (`LABEL_AUTO_AMELIORATION`) — seul le LANCEMENT de ces cartes reste un geste de l'utilisateur.
  Verrouillé par `server/src/test/auto-amelioration.test.ts` et `scripts/verif-auto-amelioration.mjs`.

### Branches et dossiers

- **Une carte lancée a TOUJOURS sa branche « tache/… » et sa copie de travail à elle**
  (`git worktree`, `shared/src/dossier-de-carte.ts`) ; le démon fusionne cette branche dans la
  principale puis referme la copie en fin de tour. Refus dit si le projet n'est pas un dépôt git, ou
  si le dossier est déjà pris par une autre carte.
- **UN DOSSIER DE TRAVAIL CASSÉ SE RÉPARE TOUT SEUL AU LANCEMENT** (`shared/src/reparation-worktree.ts`,
  boucle de `ouvrirVraiment` et `appliquerLeGeste`, `server/src/dossier-de-carte.ts`) : une carte ne
  s'arrête plus sur le message brut de git. Les pannes connues se reconnaissent au MESSAGE
  (`reconnaitrePanneDeDossier` : verrou oublié, copie verrouillée, branche prise ailleurs, branche
  déjà là, objets vides ou abîmés, dossier encombré, fichiers de service abîmés) et chacune porte ses
  GESTES, retentés jusqu'à trois fois. **Aucun geste ne détruit du travail** — un dossier retiré est
  d'abord enregistré d'office sur sa branche, aucune branche n'est jamais effacée, seul un objet VIDE
  et NOMMÉ par git est effacé puis redemandé au distant (`fetch --refetch`). **Une panne non reconnue
  n'est pas bricolée** : elle est rendue telle quelle, et le refus DIT la panne et les réparations
  tentées. Le démon parle à git en langue NEUTRE (`LC_ALL=C`), sans quoi aucun message ne serait
  reconnu. Verrouillé par `server/src/test/reparation-worktree.test.ts` et
  `scripts/verif-reparation-dossier-de-carte.mjs`.
- **Une branche poussée n'est PAS livrée** : le travail d'une carte finit sur la branche principale.
  Un agent SANS carte enregistre et pousse SA branche `hors-tache/…`, jamais la principale — une
  fonctionnalité = une branche = un enregistrement, nommé.
- **Dossier partagé (chef, analyse, publication) : `git add` NOMMÉ un par un, jamais `git add -A`**
  — sinon on emporte le travail d'un autre agent dans son propre enregistrement.
- **Un agent de tâche travaille en accès complet. Le chef d'orchestre AUSSI, SAUF qu'il ne modifie
  pas lui-même le code** (`shared/src/bridage-chef.ts`) : il lance ce qu'il veut — commandes,
  construction, installation, script de déploiement, redémarrage de service, administration de la
  machine — et écrit où il veut, le projet compris. Le DEHORS lui est ouvert de même, DANS LE TOUR et
  sans carte : requêtes réseau, gestes GitHub (`gh`, jeton du serveur posé dans son environnement),
  connexion SSH sortante, création et modification de cartes. AUCUN bac à sable (`sandbox_mode=
  "danger-full-access"` sous Codex, `sandbox.enabled:false` sous Claude) : il enfermait justement les
  gestes qu'on veut ouvrir, puisque construire ÉCRIT dans le projet et qu'administrer exige
  l'élévation de privilèges qu'aucun bac à sable ne laisse passer. La frontière du CODE tient sur les
  OUTILS : `Edit`, `Write`, `NotebookEdit` ne lui sont pas servis, `write_document` refuse les
  extensions de code, et modifier un programme s'ouvre en carte. Elle n'est donc plus un mur système —
  une commande shell PEUT écrire un fichier de code, c'est le prix assumé de l'ouverture. Verrouillé
  par `server/src/test/bridage-chef.test.ts` et `scripts/verif-bridage-chef.mjs`.
- **Aucun refus ne se dit « je n'ai pas les droits »** (`shared/src/refus-de-droits.ts`) : la consigne
  d'espace du chef ANNONCE l'accès complet, nomme les gestes ouverts (un chef qui s'en croit privé
  s'arrête avant d'essayer), dit que PUBLIER est une décision de l'utilisateur et non un droit
  manquant, et lui interdit ce vocabulaire. Elle part à CHAQUE TOUR, jamais au seul premier — sinon
  une conversation ouverte depuis des jours garde les croyances de son premier tour ; en aval, le détail des étapes terminées
  est traduit en cause réelle + réparation, POSÉE AU-DESSUS de la sortie d'origine. Trois natures :
  bac à sable RÉSIDUEL (un réglage resté allumé, à éteindre), fichier d'un AUTRE compte, et
  administration à configurer (`sudoers`). Verrouillé par `server/src/test/refus-de-droits.test.ts`
  et `scripts/verif-refus-de-droits.mjs`.
- **Le chef écrit les DOCUMENTS partout dans le projet, et le CODE nulle part**
  (`shared/src/documents-du-chef.ts`) : `write_document` crée, remplace et SUPPRIME tout fichier de
  texte (`.md`, `.txt`, `.doc`…) où qu'il soit ; le code est refusé par la liste des extensions, et
  se modifie par une carte. Refusés aussi : sortir du projet, le caché, les dossiers de machine. Un
  nom NU est rangé dans `docs/plans/`, sauf s'il désigne un fichier EXISTANT de la racine
  (« CLAUDE.md »). Le bac à sable ne bouge pas : le projet reste en lecture seule pour ses commandes.
  `docs/plans/` est INDEXÉ par la recherche de passages, en priorité haute : le plan écrit avant la
  carte remonte tout seul au lancement de l'agent qui l'exécute. Verrouillé par
  `server/src/test/documents-du-chef.test.ts` et `scripts/verif-plans-du-chef.mjs`.

### Projets

- **Créer un projet, c'est le MONTER en entier** : dossier sur le serveur, dépôt git sur `main`,
  dépôt GitHub privé poussé, les sept fichiers de départ, l'adresse publique quand elle est demandée,
  puis l'inscription dans la colonne de gauche.
- **L'ADRESSE PUBLIQUE se demande AU MONTAGE** (nom court + port), avec l'outil `ask_user`, AVANT le
  premier dossier — jamais après coup. Elle devient `Project.devUrl`, l'adresse contrôlée à la fin de
  chaque déploiement.
- **UN DÉPÔT QUI EXISTE DÉJÀ SUR GITHUB ENTRE EN QUELQUES CLICS** (`shared/src/depot-github.ts` ;
  `server/src/depots-github.ts` ; commandes `github.depots` et `project.fromGithub` ; onglet
  « Depuis GitHub » de la fenêtre « Projets du serveur ») : deux chemins, un seul montage — les
  dépôts du compte GitHub connecté au serveur, listés et cherchables, ou un LIEN collé (page,
  branche, adresse de clone https ou ssh, forme courte « compte/depot »). L'ADRESSE PUBLIQUE se
  demande AVANT le montage, ici comme pour un projet neuf, et le clone passe par le jeton du
  serveur posé dans l'ENVIRONNEMENT, jamais écrit dans l'adresse. Tout refus se dit en clair et
  s'arrête AVANT de toucher au disque : lien mal formé, autre hébergeur, dépôt introuvable, accès
  refusé, dépôt vide, projet déjà inscrit, dossier occupé. Rien n'est publié au passage.
  Verrouillé par `server/src/test/depot-github.test.ts` et `scripts/verif-projet-depuis-github.mjs`.
- **Un projet se déclare sur son DÉPÔT DE TRAVAIL, jamais sur son dossier publié** : un dossier servi
  n'est pas un dépôt git, l'agent n'y prouve rien.
- **La COLONNE DE GAUCHE se pilote par outil** (`project_manage`, `group_manage`,
  `shared/src/gestion-projets.ts`) : lister, monter, renommer, ranger, remonter, mettre de côté un
  projet ; créer, renommer, régler un groupe. On désigne par le NOM, chaque geste est réémis à
  l'interface, et trois refus sont posés DANS l'outil — pas de suppression de projet (« retirer » le
  met de côté, ses cartes vivantes nommées), pas de montage sans adresse, pas de retrait de groupe
  par un agent.

### Méthode et silence

- **La MÉTHODE de travail est imposée** (`METHODE`, `server/src/runtime.ts`), la même sous Claude et
  Codex, pour tous les rôles QUI TRAVAILLENT : lire avant de répondre (instructions, mémoire, fichiers
  repérés par recherche), constater par écrit, ne rien affirmer sans l'avoir vu, rejouer les contrôles
  du projet et en dire le résultat. Le chef d'orchestre en est dispensé : il trie, il n'étudie pas.
- **Le CONTEXTE du modèle se compresse à 50 % entre deux tours**, pour tous les rôles
  (`shared/src/contexte-agent.ts`, `server/src/runtime.ts`) : fonction native de Claude, sinon résumé
  contrôlé et session neuve ; messages visibles, carte, décisions, tâches, modèle et compte restent.
- **Un TOUR dont la réponse est rendue se referme TOUJOURS** (`shared/src/fin-de-tour.ts`,
  `server/src/engines/fin-de-processus.ts`, `refermerLeTour` / `veilleDesToursBloques` dans
  `server/src/runtime.ts`) : on rend la main sur `exit` du moteur, plus seulement sur `close` (qu'un
  petit-fils gardant la sortie ouverte pouvait retenir pour toujours) ; tout appel de SERVICE passé
  APRÈS la réponse — compression, mesure, relance de plan — porte un `plafondMs`, le tour lui-même
  jamais ; `sendPrompt` referme en `finally` ; et l'ordonnanceur referme d'autorité un agent que plus
  rien n'attend. Une réponse rendue se referme en « terminé », jamais en échec. Deux culs-de-sac de
  plus sont bornés : la PRÉPARATION d'avant le moteur (`PLAFOND_PREPARATION_MS`, 5 min — agent suivi,
  aucun processus, aucune réponse : aucun autre constat ne pouvait le voir) et un moteur LANCÉ qui se
  tait pour toujours (`PLAFOND_SILENCE_MOTEUR_MS`, 1 h ; un tour arrêté sur une question de
  l'utilisateur en est exclu). Chaque préparation porte son INSTANT et un JETON à usage unique
  (`demarrant`, `server/src/runtime.ts`) : une préparation abandonnée qui se réveille constate que le
  jeton n'est plus le sien et se retire sans rien toucher, sinon elle poserait son moteur sur un
  agent déjà reparti de sa file ou refermerait le tour de son remplaçant. Et la veille DIT la raison
  dans la conversation (`direLeBlocage`) : un tour bloqué avant le moteur n'a écrit aucun message,
  son silence était précisément le symptôme. Verrouillé par `server/src/test/fin-de-tour.test.ts` et
  `server/src/test/tour-bloque-referme.test.ts`.
- **…ET CE FILET NE DÉPEND PLUS DE CE QU'IL SURVEILLE** (`shared/src/veille-du-demon.ts` ;
  `passageDeVeille`, `startVeille`, verrou de `tick`, `server/src/scheduler.ts` ; minuteur posé dans
  `main.ts`) : la veille vivait EN TÊTE de la boucle d'ordonnancement, donc derrière son verrou « un
  tour à la fois » — un verrou pris au départ et rendu à l'arrivée. Or cette boucle attend des choses
  longues (lecture de quota chez le fournisseur, ouverture d'une copie de travail, commandes git). Un
  seul `await` qui ne revient jamais et le verrou n'est PLUS JAMAIS rendu : les tours suivants
  repartent aussitôt sans rien faire, la veille avec eux, et seul un redémarrage libère les
  conversations. Constaté le 17/08/2026 — rien de refermé entre 03 h 10 et 07 h 36, une
  auto-amélioration figée 220 minutes sans une ligne de journal, pendant que sauvegarde,
  vectorisation et envoi au cerveau tournaient normalement. La veille a donc SON PROPRE MINUTEUR
  (`PERIODE_VEILLE_MS`, 15 s), entièrement SYNCHRONE — rien ne peut la retenir —, et emporte avec
  elle `rangerLesCartesOubliees`, chacun sous son `try` (une panne d'un seul agent emporterait sinon
  le minuteur). Un tour de boucle passé `PLAFOND_TOUR_DE_BOUCLE_MS` (5 min) est DÉCLARÉ PERDU
  (`decisionDeBoucle`) : le verrou est rendu, la boucle repart, le journal le dit ; l'instant de
  départ sert de JETON pour qu'un tour perdu ne rende pas le verrou de son remplaçant. Et un
  lancement de carte ne part plus deux fois (`lancementsEnRoute`, marque DATÉE) : `isRunning` ne voit
  rien tant que l'agent n'est pas au travail. Verrouillé par `server/src/test/veille-du-demon.test.ts`
  et `server/src/test/veille-hors-boucle.test.ts`.
- **Une PANNE PASSAGÈRE du fournisseur se retente, elle ne tue pas la tâche**
  (`shared/src/panne-passagere.ts`, `server/src/relance-moteur.ts`, branchée dans `startTurn`) :
  erreur 500 (« Internal server error », « Server error mid-response »), moteur surchargé, lien
  coupé — le tour relance le moteur jusqu'à `ESSAIS_MAX` (3) fois, après une attente CROISSANTE, sur
  le MÊME fil et avec une consigne qui dit de CONTINUER là où il s'était arrêté. Jamais sur un tour
  réussi, un arrêt à la main, un arrêt de QUOTA (qui garde sa route) ni une demande refusée (4xx).
  Les essais s'additionnent dans la mesure du tour. Tous échoués, la tâche est INTERROMPUE et non
  ratée : agent en « stopped », alerte « Tâche interrompue par une panne du moteur », et le bandeau
  rouge — seulement là — porte la cause réelle en clair, jamais un « code 1 ». Vérifié par
  `server/src/test/panne-passagere.test.ts` et `scripts/verif-panne-moteur.mjs`.
- **TROIS MOTEURS, TOUS EN LIGNE DE COMMANDE** (`shared/src/moteur-cursor.ts`,
  `server/src/engines/cursor.ts`) : Claude, Codex et désormais CURSOR (`cursor-agent`) sont des
  exécutables lancés DANS la copie de travail de la carte, qui lisent et modifient les fichiers sur
  la machine. Les agents cloud de Cursor (`https://api.cursor.com`, dépôt GitHub, branche
  « cursor/… » à rapatrier) sont RETIRÉS ; de l'API il ne reste qu'une porte, éprouver une clé
  (`GET /v1/me`), le CLI ne sachant pas juger celle qu'on lui passe. Même contrat d'adaptateur,
  quatre différences : le MODÈLE PORTE SON NIVEAU DANS SON NOM — liste fermée lue dans
  `cursor-agent --list-models`, regroupée par modèle, le niveau redevenant un suffixe au lancement
  (`idCursorPourNiveau`), un nom paramétré étant refusé ; les outils du projet se posent en
  `.cursor/mcp.json` dans le dossier du tour, écarté du dépôt — **dossier ISOLÉ d'abord quand il est
  enterré dans le dépôt d'un autre** (`shared/src/racine-cursor.ts`, voir plus bas) —, **avec
  `--force` qui part TOUJOURS**
  (`buildCursorArgs`) — sans lui le CLI reste en « allowlist » et refuse EN SILENCE tout appel
  d'outil, faute d'une approbation que nul ne peut donner dans un tour `-p` : le pont n'est jamais
  contacté et le moteur invente « la proposition a été refusée », ce qui bloquait TOUTE création de
  carte depuis le chef d'un projet autre qu'HaikoDev (`fullAccess` faux, 14/08/2026). `fullAccess` ne
  décide plus que du bac à sable, et le mode plan garde `--force`, `--mode plan` suffisant à fermer
  l'écriture (`scripts/verif-outils-cursor.mjs`) ; la clé `CURSOR_API_KEY` vit HORS du
  dépôt et, sans elle, le moteur n'apparaît nulle part ; Cursor ne publiant AUCUN quota, sa ligne de
  compte n'affiche PAS de jauge de pourcentage (`moteurSansQuota`) : à la place, le CRÉDIT DÉPENSÉ
  et l'usage déjà mesuré ici (volet des quotas, commande `cursor.etat` pour la clé et l'outil).
  La clé de l'environnement n'appartient qu'au compte principal — un
  compte de relève porte la sienne dans son dossier et **s'ajoute depuis les réglages**
  (`cursor.ajouterCle`, clé éprouvée avant d'entrer dans la liste), le moteur regardant TOUTES les
  clés déclarées (`clesCursor`). Un lancement impossible NOMME la pièce qui manque
  (`manqueDuMoteurCursor`) et referme le tour. **Le montant est DEMANDÉ à Cursor**
  (`shared/src/credit-cursor.ts`, lu à chaque relevé de quota et par `cursor.credit`) :
  `POST /teams/spend`, jamais reconstitué depuis des jetons et un tarif deviné. Cette route n'accepte qu'une clé
  d'ADMINISTRATION D'ÉQUIPE ; sinon c'est la RAISON qui s'affiche, jamais un zéro. **Et son PLAN
  n'est pas un message : c'est un appel d'outil** (`texteDuPlanCursor`) — en `--mode plan`, Cursor
  pose le plan entier dans un `createPlanToolCall` et ne laisse au fil qu'une narration ; on le
  remet dans la conversation, sans quoi `jugerLePlan` n'y voit aucune des quatre parties et le cadre
  perd ses boutons. Verrouillé par `server/src/test/moteur-cursor.test.ts`,
  `scripts/verif-moteur-cursor.mjs` et `scripts/verif-mode-plan-cursor.mjs`.
- **DEUX TOURS DE CURSOR SUR LE MÊME DOSSIER S'ATTENDENT, jamais un `.cursor/mcp.json` écrasé en plein
  vol** (`avecVerrouCwd`, `server/src/engines/cursor.ts`) : le chef bridé garde le MÊME dossier
  (`chefScratch/<projet>`) d'un tour à l'autre, donc deux tours concurrents du même projet (une
  conversation et l'auto-amélioration de nuit, par exemple) pouvaient y écrire la configuration
  d'outils en même temps — le second écrasait celle du premier avant que SON `cursor-agent` ne l'ait
  lue, le pont annonçant alors le mauvais agent : le vrai restait sans outil, sans qu'aucune erreur ne
  se voie (« le pont d'outils ne démarre pas toujours », 14/08/2026). La pose des outils et le
  lancement du CLI sont désormais tenus sous ce verrou jusqu'à la fin du tour ; un dossier de carte,
  propre à une seule carte, n'a jamais ce voisin et n'attend donc jamais rien. **Et quand le pont
  manque quand même, la RÉPONSE elle-même le dit** (`noteDePontEnEchec`, `shared/src/pont-outils.ts`,
  branché dans `server/src/runtime.ts`, engine-agnostique) : l'étape rouge repliée ne suffisait pas —
  un moteur privé d'outils pouvait écrire « la proposition a été refusée » de son propre chef, et
  cette phrase inventée restait la seule chose lue. Un encadré `[!WARNING]` porte maintenant la vraie
  raison (« le pont d'outils n'a pas démarré… ») directement dans le texte. Verrouillé par
  `server/src/test/moteur-cursor.test.ts` et `server/src/test/pont-outils.test.ts`.
- **UNE CARTE PROPOSÉE S'AFFICHE DANS LE FIL QUI L'A DEMANDÉE, quel que soit le moteur**
  (`shared/src/racine-cursor.ts` ; `appelDuPontRecevable`, `shared/src/pont-outils.ts` ;
  `poserLaConfigurationMcp`, `server/src/engines/cursor.ts` ; garde posée en tête des routes
  `/internal/` de `server/src/http.ts`). Cursor ne lit PAS `.cursor/mcp.json` dans le dossier du
  tour : il remonte à la RACINE DU DÉPÔT qui le contient et ne lit QUE celle-là — ni `--workspace`
  ni `--add-dir` n'y changent rien. Le bac du chef bridé (`chefScratch/<projet>`) étant un
  sous-dossier du dépôt d'HaikoDev, le CLI y prenait la configuration laissée par le dernier tour
  lancé à la racine : le pont partait avec l'identifiant d'un AUTRE agent, la carte proposée
  s'écrivait dans le fil d'un agent d'un autre projet terminé deux heures plus tôt, et le chef
  s'entendait dire que son pont n'avait pas démarré (15/08/2026). Le dossier du tour est donc ISOLÉ
  (`git init`) quand il est enterré dans le dépôt d'un autre — on n'écrit JAMAIS chez le voisin — et
  chaque tour porte un IDENTIFIANT (`LiveRun.tourId`, `HAIKODEV_TOUR`) que le pont renvoie : un
  appel qui n'est pas celui du tour en cours est REFUSÉ en clair, jamais écrit ailleurs. La
  proposition est enfin rangée sous le message RÉELLEMENT touché (`attachToCurrentMessage` le rend),
  au lieu d'un « dernier message » relu à part. Verrouillé par
  `server/src/test/carte-proposee-dans-le-bon-fil.test.ts` et
  `scripts/verif-carte-proposee-dans-le-fil.mjs`.
- **Le menu des modèles garde la version la plus récente de chaque FAMILLE, jamais les trois plus
  récents tout court** (`familleDeModele`, `limiterAuxPlusRecents`, `shared/src/catalogue-modeles.ts` ;
  tri par `versionOf`) : couper la liste entière à trois entrées ne retirait pas des vieilleries mais
  des modèles ENTIERS — sous Cursor, le menu ne proposait plus que les trois variantes de GPT-5.6, ni
  Composer ni Grok. La famille est l'identifiant sans ses segments purement numériques.
- **Un moteur lancé est SUIVI avant tout autre travail** (`startTurn`, `server/src/runtime.ts`) :
  `live.set` passe devant l'enregistrement du contexte envoyé, sinon une panne survenue dans cette
  fenêtre faisait refermer par `sendPrompt` un tour BIEN VIVANT — bulle rouge « panne interne du
  serveur » sur un travail qui continuait. Ce qui suit le lancement (instantané, purge) est enfermé
  dans un `try/catch` journalisé : le contexte envoyé ne vaut jamais un tour. Corollaire : **une ligne
  de base se relit défensivement** (`purgerContexteEnvoyeAncien`, `server/src/store.ts`) — écrite par
  une version plus ancienne du modèle, elle peut manquer un champ que le schéma remplirait. Vérifié
  par `server/src/test/purge-contexte-envoye.test.ts`.
- **Le témoin « réflexion en cours » suit l'AGENT, pas le message, et d'abord son TOUR VIVANT**
  (`temoinDeTravail` / `ecritureOrpheline`, `shared/src/travail-en-cours.ts` ;
  `Agent.tourVivantDepuis`, posé et retiré par `marquerLeTourVivant` / `retirerLeTourVivant`,
  `server/src/runtime.ts`) : un agent travaille aussi quand il enchaîne des COMMANDES sans écrire un
  mot, et le démon range encore son tour après la réponse rendue — statut et marque d'écriture ont
  chacun leur fenêtre aveugle. Tant que le tour vit, le témoin est allumé et la flèche d'envoi reste
  un carré d'ARRÊT ; le tour refermé l'éteint, par quelque chemin que ce soit, et le redémarrage
  efface la marque comme `attendReponse`. Le TABLEAU lit la même règle
  (`agentTientSonTour`) : le personnage de « En cours » pioche jusqu'à la fin RÉELLE du tour, et le
  temps du rangement d'après-réponse — constat du dépôt, dossier refermé, branche fusionnée — se lit
  sous la réponse dans le tiroir de la carte (`Message.rangementMs`, écrit par `noterLeRangement`,
  jamais sous une seconde). Verrouillé par
  `server/src/test/travail-en-cours.test.ts` et `scripts/verif-temoin-pendant-commandes.mjs`.
  Un message resté marqué « en écriture »
  après la fin de son tour est ORPHELIN et n'allume plus rien. `pushMessage` refuse de reposer la
  marque une fois le tour retiré des tours vivants, `recoverAfterRestart` l'éteint sur TOUS les agents
  au redémarrage, et `veilleDesToursBloques` l'éteint au fil de l'eau — le bandeau s'éteint donc sans
  recharger la page. Nuance gardée : le message du tour QUI DÉMARRE naît avant le passage « au
  travail », un message né après la dernière fin de tour compte donc comme vivant.
- **La CONSIGNE SYSTÈME ne change pas d'un tour à l'autre dans une même session**
  (`enteteDuTour`, `shared/src/prefixe-cache.ts`) : sous Claude elle est le PRÉFIXE de la conversation
  (`--append-system-prompt`, reposé devant à chaque tour), et un préfixe qui bouge fait RÉÉCRIRE tout
  ce qui suit — mesuré à 32 667 jetons réécrits contre 771 (`scripts/mesure-cache-prefixe.mjs`). La
  consigne entière repart donc à chaque tour. Codex, qui colle la sienne derrière l'historique, garde
  le rappel court. Ce qui est relu au cache se voit désormais dans le LECTEUR DE PROMPTS (repère
  visuel « relu au cache » sur le bloc système d'un tour, `SentContextBlock.cached`,
  `web/src/components/lecteur-prompt.tsx`) — jamais un pourcentage.
- **Aucun agent ne commente le stockage des identifiants** : mots de passe, clés, jetons gardés dans
  le projet sont un choix ASSUMÉ de l'utilisateur. On n'en parle pas — mais une PANNE (identifiant
  absent, expiré, refusé qui bloque le travail) se dit toujours.
- **Un fichier d'instructions qui ne fait que RENVOYER à un autre est suivi, jamais nommé** : sur un
  projet monté comme HaikoDev, `AGENTS.md` renvoie à `CLAUDE.md`, et c'est `CLAUDE.md` qui fait foi.

### Interface et code

- **LE COIN HAUT GAUCHE DU BANDEAU RÉPOND AU COIN HAUT DROIT** (`pointEtat`,
  `web/src/components/quota-bar.tsx`) : le bouton des projets porte l'icône HAMBURGER et l'habillage
  commun des boutons de droite (`variant="outline"`, `size="icon"`), sans changer ce qu'il ouvre ni
  son `aria-label="Projets"` — six scripts le désignent par là. L'icône « réseau » est RETIRÉE ; son
  information tient dans un POINT (`data-point-etat`) posé DANS le coin haut droit du bouton, avec
  une priorité écrite (liaison rompue > un autre projet attend > liaison qui tient), le nombre
  d'agents gardant sa propre pastille. Sur ORDINATEUR, où ce bouton n'existe pas, le même point seul
  tient la place de l'ancienne icône. Vérifié par `scripts/verif-panneau-projets.mjs`.
- **CHAQUE COLONNE A SON PERSONNAGE, DÉTOURÉ** (`shared/src/personnages-colonnes.ts` ; images dans
  `web/public/personnages/`, refaites par `scripts/personnages-colonnes.py`) : sept personnages en
  pâte à modeler sur fond TRANSPARENT, en DEUX découpes — la SILHOUETTE entière en tête de colonne
  (boîte de proportion fixe, elle dépasse d'un cheveu en haut et à gauche, le libellé se décalant
  d'autant), le PORTRAIT rond dans les notifications, où l'alerte porte le visage de SA colonne
  (`avatarDeLAlerte` ; un motif sans colonne — quota, redémarrage — garde l'image de son genre). La
  colonne compte donc DEUX enveloppes : `data-column`, le cadre et le fond restent sur l'extérieure
  (`offsetLeft`, couleur de colonne), seule la découpe descend d'un cran, et l'image ne prend AUCUN
  clic (le dépôt d'une carte vise `closest('[data-column]')`). **Le détourage va chercher les POCHES
  ENCLAVÉES** (`poches_de_fond`, `OMBRE_CLAIR_MIN`, `scripts/personnages-colonnes.py`) : le
  remplissage part du coin et n'entre jamais dans un trou ceinturé par le personnage — entre les
  jambes, dans la boucle d'un bras —, et le seuil de l'ombre laissait un coin pâle entre les
  chaussures. Une poche est reprise si 60 % de ses pixels sont vraiment la couleur du fond (un blanc
  d'œil plafonne à 47 %) et qu'elle pèse plus de 0,003 % de l'image. Le contrôle juge SUR FOND
  SOMBRE, seul endroit où le défaut se voit. Verrouillé par
  `server/src/test/personnages-colonnes.test.ts` et `scripts/verif-personnages-colonnes.mjs`.
  **CELUI DE « EN COURS » PIOCHE QUAND UN AGENT TRAVAILLE, ET LUI SEUL** (`COLONNE_VIVANTE`,
  `gesteDuPersonnage`, `COLONNES_ANIMEES`, `animeDuPersonnage` ; fabrique
  `scripts/personnages-colonnes.py --anime`) : ce n'est plus un balancement mais une BOUCLE ANIMÉE du
  même mineur donnant de vrais coups de pioche — un geste de TRAVAIL, qui se reconnaît d'un coup
  d'œil. Elle vit dans la MÊME boîte que les images fixes (126×168, proportion 3:4, appui au sol),
  donc rien ne saute à la bascule et l'image n'attrape toujours aucun clic. Trois gestes et pas un de
  plus : « immobile », « pioche », « balancement ». Au repos on redemande l'image FIXE :
  l'immobilité est TOTALE, et c'est ce contraste qui porte l'information. On compte les AGENTS de la
  colonne, jamais l'avancement (un agent sans liste de tâches y pèse zéro et figerait un tableau
  pourtant occupé). DEUX REPLIS sur le balancement d'avant (classe
  `animate-personnage-au-travail`), aucun n'étant un échec : un personnage REMPLACÉ depuis les
  réglages (l'image déposée est fixe, servir la boucle livrée montrerait le mineur d'origine) et une
  colonne sans boucle — l'information « ça travaille » n'est jamais perdue, seule sa forme change.
  Un WEBP animé et non un GIF : le GIF ne connaît qu'une transparence tout-ou-rien, qui redonnerait
  au personnage détouré le contour en escalier que l'alpha progressif lui évite, et il pèse plusieurs
  fois plus lourd pour une image que le tableau redemande à chaque affichage (138 Ko sans perte,
  57 Ko à `quality=82`, le canal alpha restant intact). Chaque image de la boucle passe par le MÊME
  détourage que les images fixes, mais dans une boîte COMMUNE (`boite_commune`) : recadrer chacune au
  plus juste ferait sautiller le personnage. Le filigrane d'un site de montage n'est pas traité à
  part — il ne touche pas le personnage, donc `sans_les_ilots` l'emporte. Enfin « réduire les
  animations » ne coupe une IMAGE animée par AUCUNE règle de style : c'est le seul motif pour lequel
  cette préférence remonte jusqu'au code (`REQUETE_ANIMATIONS_REDUITES`,
  `web/src/lib/animations-reduites.ts`), et elle rend alors le personnage parfaitement immobile.
  **ET N'IMPORTE LEQUEL SE REMPLACE DEPUIS LES RÉGLAGES, sans carte ni agent**
  (`server/src/personnages.ts` ; onglet « Personnages » des réglages ; `POST` et
  `DELETE /api/personnage`) : l'image déposée passe par la MÊME fabrique que les sept d'origine
  (`personnages-colonnes.py --une`), vit dans les DONNÉES (`data/personnages/`, jamais dans le dépôt)
  et se sert à la MÊME adresse que l'originale, qui reste intacte — revenir en arrière efface deux
  fichiers, rien de plus. Tout ou rien (les deux découpes ou aucune), et TOUT refus est dit avec sa
  raison. Verrouillé par `server/src/test/personnages-colonnes.test.ts` et
  `scripts/verif-personnages-colonnes.mjs`.
- **SEPT THÈMES AU CHOIX DANS LES RÉGLAGES, DONT SIX SANS UNE BORDURE**
  (`shared/src/themes.ts` pour le catalogue ; `web/src/lib/theme.ts` pour la pose ;
  `web/src/styles.css` pour les sept blocs de jetons ; onglet « Apparence » de `settings-view.tsx`).
  « sombre » et « clair » sont les thèmes d'ORIGINE ; « sable » (beiges chauds), « ardoise » (gris
  bleutés froids), « givre » (blancs bleutés froids, ce qui manquait au clair), « sapin » (verts
  profonds chauds, ce qui manquait au sombre) et « contraste » (clair, très marqué — texte quasi noir
  sur fond quasi blanc, états saturés, pour lire en plein soleil ou les yeux fatigués) sont cinq
  thèmes FLAT DESIGN. Le SOMBRE les a rejoints le 17.08.2026 (`plat: true`, `--border: 0 0% 9%` — un
  point du fond d'un bloc, `--controle: 0 0% 100% / 0.06`) : il gardait seul un trait gris franc à
  24 %, et seules ces DEUX valeurs ont bougé, aucune autre de ses teintes. **Le CLAIR est donc le
  seul thème à bordures**, et c'est voulu — `verif-themes.mjs` juge la bordure et le fond d'un bouton
  sur `plat`, plus sur `origine`, les deux qualités étant distinctes. SIX invariants. Le catalogue ne
  connaît AUCUNE teinte de l'interface — seulement un APERÇU de quatre pastilles, qui doit s'afficher
  pendant qu'un AUTRE thème est actif, d'où les seules couleurs posées en style direct de toute
  l'application. Le thème s'applique en UN endroit, depuis la RACINE (`useTheme` dans `app.tsx`) et
  jamais depuis un panneau chargé à la demande : `data-theme`, la classe `dark` et `color-scheme`
  partent ensemble, avec la couleur du bandeau du téléphone. Le thème « sombre » n'a PAS de sélecteur
  à lui — c'est `:root`, donc le défaut avant le premier affichage — et le clair reste accroché à
  `html:not(.dark)`, que plusieurs contrôles retirent pour basculer ; les cinq thèmes posés par
  `data-theme` passent APRÈS et déclarent CHAQUE jeton, un oubli y retombant en silence sur une
  valeur du thème clair. Un thème PLAT n'a pas ses bordures retirées du code (ce serait redessiner
  tous les écrans) : `--border` est amené à moins de deux points d'un fond, le trait existe et ne se
  voit plus, la mise en page ne bouge pas. D'où deux conséquences NOMMÉES : l'ascenseur ne prend plus
  sa couleur dans `--border` (il y disparaîtrait) et un bouton « contour » reçoit un fond translucide
  (`--controle`, la transparence dans le seul thème CLAIR). Chaque nouveau thème garde par ailleurs
  des paliers de fond (bg / surface / raised) réguliers (3 à 8 points d'écart) et AUCUNE valeur
  exacte recopiée d'un autre thème, y compris entre les thèmes plats eux-mêmes — piège rencontré en
  ajoutant « givre » : un blanc de bouton (`--record-fg`, `--actif-fg`) recopié tel quel du thème
  sombre/clair (`0 0% 100%`) se fait refuser par le contrôle. Enfin les anciens réglages « dark » /
  « light » sont REPRIS (`themeValide`), et `CHOIX_DE_THEME` porte la CLARTÉ de chaque thème
  (`item.clarte`) pour qu'un écran choisisse son icône (soleil/lune) sans lister les identifiants un
  par un. Verrouillé par `server/src/test/themes.test.ts` et `scripts/verif-themes.mjs`.
- **…ET LES HUIT CHOIX TIENNENT DERRIÈRE UNE SEULE ENTRÉE « THÈME » DU MENU**
  (`DropdownMenuSub` / `DropdownMenuSubTrigger` / `DropdownMenuSubContent`, `web/src/components/ui/index.tsx` ;
  entrée `data-theme-menu` de `web/src/components/quota-bar.tsx`) : alignés les uns sous les autres,
  ils occupaient la moitié du menu à trois points pour un réglage qu'on change une fois par mois.
  L'entrée rappelle le choix en cours (`choixParId(theme).libelle`) et déplie la liste AU SURVOL
  comme AU CLIC — les deux gestes comptent, le téléphone et le clavier n'ayant pas de survol ; la
  coche du thème actif ne bouge pas. Le sous-menu reste un panneau FLOTTANT même sur téléphone, où le
  tiroir du bas appartient au menu de premier niveau — d'où son `z-index` plus haut que ce tiroir.
  Conséquence pour les CONTRÔLES : `[data-theme-choix]` n'existe plus au premier niveau, il faut
  survoler ou cliquer `[data-theme-menu]` d'abord (`scripts/verif-themes.mjs`,
  `scripts/verify-ui.mjs`).
- **…ET CHAQUE PROJET PEUT IMPOSER LE SIEN, plus un choix qui suit l'ORDINATEUR**
  (`themeAAppliquer`, `CHOIX_DE_THEME`, `THEME_SYSTEME`, `themeChoisiValide`, `shared/src/themes.ts` ;
  `Project.theme` ; `useThemeApplique` / `useSystemeSombre`, `web/src/lib/theme.ts` ; ligne « Thème de
  ce projet » de `project-settings.tsx`). CE QU'ON CHOISIT N'EST PLUS TOUJOURS UN THÈME : « systeme »
  est une CONSIGNE — suivre le réglage clair / sombre de la machine — et désigne l'un des deux thèmes
  d'ORIGINE (`themeDuSysteme`) ; il n'a donc AUCUN bloc de jetons, et le contrôle refuse qu'on lui en
  écrive un. D'où deux types séparés, `ThemeId` (les 7 palettes) et `ThemeChoisi` (8 choix). UNE SEULE
  règle décide : thème du PROJET OUVERT > réglage GÉNÉRAL > réglage de la machine, et changer de projet
  rhabille l'application ENTIÈRE — d'où le crochet appelé à la RACINE, seul endroit qui voit les trois
  sources. `themeChoisiValide` rend `null` et non le défaut : c'est ce qui distingue « ce projet
  n'impose rien » de « il impose le sombre », et `Project.theme` est `nullish` pour que `null` puisse
  RETIRER un thème (un `undefined` disparaîtrait du bloc envoyé). Le réglage de la machine est ÉCOUTÉ
  (`prefers-color-scheme` change tout seul à la tombée du jour) et ne se lit que dans
  `web/src/lib/theme.ts` — le contrôle refuse un second lecteur comme un second poseur. Enfin l'onglet
  « Apparence » DIT quand un projet recouvre le choix général (`data-theme-recouvert`), sinon ce choix
  paraissait cassé. Verrouillé par `server/src/test/themes.test.ts` et `scripts/verif-themes.mjs`
  (qui pose le projet par `window.haikodevEssai.projet`, le démon en service pouvant précéder le champ
  et le retirer — Zod écarte les clés qu'il ne connaît pas).
- **LE FLAT DESIGN NE RETIRE PAS UN CONTRASTE QUI PORTAIT UNE INFORMATION** — deux jetons DÉDIÉS,
  déclarés dans les QUATRE thèmes (`--ligne-active`, `--bandeau-etape`, `web/src/styles.css` ; noms
  Tailwind `bg-ligne-active` / `bg-bandeau-etape`, `web/tailwind.config.js`) : la ligne du projet
  OUVERT (colonne de gauche, `LigneEspaceDev` et `ProjectRow` de `web/src/components/sidebar.tsx`)
  et le bandeau d'étape sous une carte (`web/src/components/board.tsx`) empruntaient `--raised` ou
  `bg-border/30` — des jetons qui, dans certains thèmes, valent quasiment `--bg` ou `--surface` (le
  thème « clair » d'origine a `--raised` STRICTEMENT ÉGAL à `--bg`, 0 0% 100% des deux côtés) ou sont
  volontairement proches des fonds (les thèmes plats effacent `--border`). Le repère devenait donc
  invisible, pas seulement discret. Aucune bordure n'est réintroduite : chaque jeton porte une
  valeur SOLIDE, propre à chaque thème, choisie pour rester à distance visible du fond de page, du
  survol ET du corps de la carte — jamais recopiée d'un autre jeton ni d'un autre thème.
- **ORANGE pour ce qui est EN COURS, BLEU pour ce qui est TERMINÉ**, partout dans l'application
  (jetons `--en-cours` / `--termine`, `web/src/styles.css`, nommés `en-cours` et `termine` dans
  `web/tailwind.config.js`). Colonnes du tableau, cartes, colonne de gauche, conversations, listes de
  tâches, étapes, points d'état : aucun de ces repères ne recopie une couleur, tous passent par ces
  deux jetons. Les AUTRES états ne bougent pas — erreur (`danger`), avertissement et attente
  (`warning`), publication en cours (`publie`), réussite acquise (`success`). Vérifié par
  `scripts/verif-couleurs-avancement.mjs`.
- **UN BOUTON QUI PART EN REQUÊTE LE DIT DÈS LE CLIC** (`shared/src/bouton-en-attente.ts` ;
  `Button`, `web/src/components/ui/index.tsx`) : « Terminer la tâche » restait figé entre le clic et
  la réponse, on croyait que rien ne partait et on recliquait. Un `onClick` qui rend une requête
  (`estUneRequete` : tout retour muni d'un `then`) fait passer le bouton en « en cours » AVANT toute
  réponse — enfants effacés SUR PLACE, roue à leur place, largeur inchangée, `aria-busy`, plus aucun
  clic accepté. La RÉUSSITE montre une coche 1,4 s puis s'efface ; l'ÉCHEC ramène le bouton à son
  état INITIAL, le refus étant déjà dit en rouge. Deux pièges : un `{ ok: false }` rendu SANS erreur
  (`moveCard`, `validerCarte`) est un ÉCHEC (`issueDeLaReponse`), et un `onClick` qui avale son
  erreur pour dire le refus doit la RELANCER, sinon le bouton croit avoir réussi. Passé DIX SECONDES
  (`SEUIL_LONGUE_ATTENTE_MS`), l'attente se DIT : le bouton l'annonce à la PAGE
  (`EVENEMENT_ATTENTE_LONGUE`) et `client.ts` la met en mots, sans conclure à la panne — le socle
  visuel n'appelle jamais les messages passagers. Même principe pour un ONGLET qui va chercher ses
  données (« Détails », « GitHub ») : l'enfant annonce, l'onglet montre une roue
  (`web/src/lib/chargement-onglet.tsx`, `data-onglet-charge`). Un geste n'a plus qu'UN mécanisme
  d'attente : les `busy` maison sont rendus au bouton, sauf le choix d'un compte de reprise, une
  LISTE dont un clic doit éteindre tous les autres. Verrouillé par
  `server/src/test/bouton-en-attente.test.ts` et `scripts/verif-bouton-en-attente.mjs`.
- **TROIS GENRES ALERTENT, PAS UN DE PLUS, ET LES DEUX CANAUX SUIVENT LA MÊME RÈGLE**
  (`GenreDAlerte`, `MOTIFS[].genre`, `genreDeLAlerte`, `genreDuMessage`, `messageAlerte`,
  `shared/src/notification-tri.ts`) : une ATTENTE (décision attendue), une TÂCHE FINIE (publication
  comprise — longue et menée par un agent), une ERREUR (échec, publication tombée, et tout BLOCAGE :
  compte à sa limite, amorçage refusé, agent coupé, geste sans réponse depuis dix secondes). Un motif
  hors des trois porte `genre: null` et ne dit plus RIEN — ni notification poussée, ni message dans
  l'application : redémarrage du serveur, paliers 70 % / 90 % du quota, surconsommation, emballement,
  liste de tâches cochée, charge machine, point du jour. L'information reste là où on la cherche déjà
  (bouton « Redémarrage requis », volet des quotas, jauge de capacité, repère des tâches, déroulé de
  la colonne de publication, cloche du bandeau) : **on coupe l'alerte, pas la trace**. Le SECOND
  CANAL passe par le même juge (`pushToast`, `web/src/lib/client.ts` ; `bus.toast` et le champ
  `motif` de l'événement `toast`) — un message qui NOMME son motif est jugé sur lui, sinon son NIVEAU
  tranche : « error » / « warning » disent un refus ou un blocage et s'affichent, « info » /
  « success » confirment un geste et se taisent (le bouton en attente puis en coche le dit déjà).
  Trois messages sont donc nommés à la main : « Agent terminé » (`tache-terminee`), l'arrêt de
  secours (`agent-interrompu`) et l'attente de plus de dix secondes (`geste-lent`) ; les deux
  derniers ne naissent que dans le navigateur (`dansLApplication`) et ne partent jamais en push.
  `pushToast` juge, `afficherMessage` dessine. Ni le texte ni la couleur d'un message ne changent.
  Verrouillé par `server/src/test/notification-tri.test.ts` et `scripts/verif-notifications.mjs`.
- **Le triangle orange n'est pas le seul chemin vers une décision attendue : une CLOCHE dans le
  bandeau du haut les liste TOUTES**, tous projets confondus (`QuestionsEnAttente`,
  `web/src/components/questions-en-attente.tsx`) — projet, endroit (carte ou conversation) et texte
  de chaque question, un clic y emmène. `decisionsEnAttente` (`server/src/store.ts`) enrichit
  chaque décision de champs d'AFFICHAGE seulement (`texte`, `projectName`, `lieuTitre`) ; le compte
  qui décide où la trancher ne bouge pas. Vérifié par `scripts/verif-questions-en-attente.mjs`.
- **Un plan proposé qui attend une décision pose son ICÔNE sur la ligne de son projet — et RIEN
  d'autre : la ligne reste NUE** (`plans`, `shared/src/protocol.ts` ; `store.signalPlans`,
  `server/src/store.ts` ; `RepereDePlan`, `web/src/components/sidebar.tsx`). La bordure blanche
  additive des débuts a été RETIRÉE avec le passage aux lignes de projet sans cadre ni fond : plus
  aucune ligne ne porte de bordure, l'état ne vit que sur l'icône de gauche et le repère de droite.
  L'icône du plan prend
  l'emplacement de GAUCHE (celui du dossier ou de l'outil), comme le fait déjà le loader « au
  travail » ou l'icône « en publication » (`RepereRobot`) — un seul signe à la fois, rien à droite
  du nom ; priorité publication > travail en cours > plan. Seul le badge de l'en-tête d'un groupe
  replié reste à droite de son nom, faute d'emplacement de gauche à lui. Éteint dès que le plan est
  validé, refusé ou dépassé par une version plus récente
  (`planEnAttente`, `shared/src/plan-conversation.ts`). Vérifié par
  `server/src/test/plan-en-attente-projet.test.ts` et `scripts/verif-repere-plan.mjs`.
- **La ligne d'un projet où un agent travaille porte, à DROITE, le même pourcentage que la tête de
  la colonne « En cours » du tableau** (`avancementDeLaColonne`, `shared/src/avancement-colonne.ts` ;
  `RepereAvancementProjet`, `web/src/components/sidebar.tsx`) : additionné sur les cartes de CE
  projet, à partir des agents de rôle « task » encore au travail dans `state.agents` (connu pour
  tous les projets, contrairement aux cartes, chargées seulement pour le projet ouvert). Il vit à la
  MÊME place que le triangle de décision (`RepereLigne`) — une décision qui attend prime toujours —
  et disparaît dès qu'aucune carte de ce projet n'a plus d'agent actif. **Il ne bouge JAMAIS d'un
  pixel** : contrairement au triangle, qui EMPRUNTE au repos la place de l'icône réglages (encore
  invisible) puis s'en écarte au survol par un glissement, le pourcentage emprunte la même place en
  PERMANENCE (décalage fixe, jamais retiré) et cède la place à l'icône par une simple bascule
  d'OPACITÉ — jamais par un déplacement. Vérifié par `scripts/verif-avancement-colonne-gauche.mjs`.
- **PLUS AUCUN COMPTEUR DE JETONS VISIBLE NULLE PART** (`docs/plans/refonte-visualisation-prompts.md`,
  plan validé) : à la place, VOIR le texte réellement envoyé au moteur. L'onglet « Détails » d'une
  carte lit le LECTEUR DE PROMPTS (`LecteurPrompt`, `web/src/components/lecteur-prompt.tsx`) — une
  liste de tours, chacun dépliable en blocs nommés (`SentContextBlock.text`), avec recherche et copie,
  et un repère VISUEL (`cached`) pour ce qui est relu au cache plutôt qu'un chiffre ; la CONVERSATION,
  elle, a ses BULLES de message, un seul tour par bulle et rien à ouvrir (`BullesDuPromptEnvoye`). Le
  texte de chaque tour est conservé dans
  `Message.sentContext` (`server/src/store.ts`, `purgerContexteEnvoyeAncien` — les
  `TOURS_CONTEXTE_CONSERVES` derniers tours d'un agent gardent leur texte, les plus vieux ne gardent
  que les compteurs). Le composeur ne montre plus le pourcentage de contexte de l'agent, l'onglet
  « Consommation » des réglages ne montre plus de tokens ni de part relue au cache, le tableau de bord
  montre le TEMPS de travail plutôt que des tokens, et le chiffrage d'une carte reste en heures et en
  francs — jamais en jetons. Les mesures continuent d'exister côté serveur, elles ne s'affichent
  simplement plus. Vérifié par `scripts/verif-contexte-envoye.mjs` (le repère du chat, en navigateur —
  son tiroir rend le texte réellement envoyé), `scripts/verif-parcours-tache.mjs` (le volet
  Détails), `scripts/verif-detail-analyse.mjs` et `scripts/verif-aucun-compteur-jetons.mjs` (repère
  statique : aucun texte « X tokens »/« X jetons » dans l'interface).
- **« Repartir de zéro » vide le CONTEXTE de l'agent, pas seulement le fil**
  (`agentApresNouveauDepart`, `shared/src/nouveau-depart.ts`) : mesure, état de remplissage et
  RÉSUMÉ DE CONTINUITÉ effacés ensemble, agent diffusé aussitôt — sinon le composeur garde un
  pourcentage sur une conversation vide et le tour suivant renvoie un résumé du fil coupé. Rien
  n'est supprimé : les anciens messages restent derrière leur lien. Vérifié par
  `scripts/verif-depart-a-zero.mjs`.
- **LA LISTE DES TÂCHES N'A QU'UN SEUL ENDROIT : LE REPÈRE COMPACT COLLÉ AU CHAMP DE SAISIE**
  (`TravailEnCours`, `web/src/components/chat.tsx` ; `CorpsListeTaches`, `resumeDesTaches`,
  `usePliDesTaches`, `web/src/components/todos.tsx`). Il reste en place que l'agent travaille ou
  non : pendant le tour il dit l'étape en cours, son compte et son temps ; une fois le tour refermé
  il dit « Liste des tâches — n/N faites » (plus ce qui reste non fait), avec une COCHE bleue si
  tout est fait, un point sinon — et un clic ouvre la liste complète, à la même place. L'ancien
  volet pleine largeur `VoletTaches`, posé à part entre le fil et le champ de saisie, est SUPPRIMÉ :
  la liste changeait de forme et de place selon que l'agent travaillait ou non. Deux corollaires :
  le CHRONOMÈTRE, le compte « n/N » et le BOUTON D'ARRÊT ne paraissent que pendant le travail
  (`arretDeCarteAutorise` ne juge que l'appartenance de l'agent à la carte, jamais son activité), et
  le pli « replié / déplié » est retenu par `usePliDesTaches` (téléphone replié, ordinateur déplié).
  Le repère porte les DEUX repères d'écran, `data-temoin-reflexion` et `data-volet="taches"`.
  Vérifié par `scripts/verif-volet-taches.mjs`.
- **UN TEXTE AFFICHÉ RESTE DANS SON CADRE, ET SE COPIE À LA SOURIS** (`.texte-copiable`,
  `web/src/styles.css` ; `data-carte-texte` de `board.tsx`, `data-toast-texte` de `toasts.tsx`) : un
  conteneur `select-none` — une carte qu'on TIRE, un message qu'on BALAIE — ne prive plus son texte de
  sélection. La classe pose `overflow-wrap: anywhere` partout (un titre au mot insécable revient à la
  ligne au lieu de sortir du cadre) et n'ouvre la sélection qu'au POINTEUR FIN ; au doigt, rien ne
  change. Un glissement de souris parti d'un texte marqué ne déplace ni ne balaie, et le clic qui
  termine une sélection faite DANS la carte n'ouvre pas son tiroir — un clic simple, si. Parti du
  titre, le geste ne devient un DÉPLACEMENT qu'en SORTANT de la carte (refuser le glissement depuis
  le texte rendait la carte intirable par son titre, `verif-glissement-lancement.mjs`). Un message
  d'ERREUR porte en plus un bouton « copier » (`data-toast-copier`) qui emporte tout son texte d'un
  clic, sans l'écarter. Vérifié par `scripts/verif-texte-copiable.mjs`.
- **UN TEXTE REPLIÉ (`line-clamp`) NE SE POSE JAMAIS DANS UN `button`** (`ProposalChip`,
  `data-carte-proposee="validee"`, `web/src/components/message-view.tsx`) : sous WebKit — Safari,
  donc tous les navigateurs de l'iPhone —, le bloc qui porte un tel bouton réserve la hauteur du
  texte ENTIER. La pastille d'une carte validée se dessinait sur 114 px, son bloc en gardait 410, et
  un grand vide s'ouvrait sous la carte acceptée. Rien ne se voit sous Chrome, ni sur une page
  ouverte alors que la carte est DÉJÀ validée : il faut Safari ET le remplacement en direct de la
  vignette par la pastille. On emploie donc un bloc ordinaire avec `role="button"`, `tabIndex` et la
  touche Entrée/Espace. Verrouillé par `scripts/verif-vide-carte-validee.mjs`, qui rejoue la
  validation dans un vrai Safari (`npx playwright install webkit` ; moteur absent, le cas est DIT).
- **LA JAUGE « CAPACITÉ DU SYSTÈME » NE DIT « SATURÉ » QUE SUR UNE VRAIE SATURATION**
  (`freinDeCharge`, `chargeRetenue`, `detailDesAgents`, `shared/src/capacite.ts` ; `snapshot`,
  `server/src/capacity.ts`) : l'écran annonçait « Plus aucun agent ne peut démarrer · 3 en cours ·
  plafond 15 », une phrase qui se contredit elle-même. La CHARGE PROCESSEUR freine, elle ne remplit
  jamais la barre — `slotsFree` ne compte que la MÉMOIRE et le plafond, le frein vit à part
  (`startableNow`, `loadHoldReason`) et se dit avec sa cause ; seules la mémoire (> 94 %) et la pause
  manuelle SUSPENDENT. Et la charge retenue est celle qui DURE : le plus petit de la minute et du
  quart d'heure, car une pointe passe 200 % sur ce serveur mutualisé sans rien saturer (paliers
  170 / 240 / 320 %). Le COMPTE affiché sépare enfin les TÂCHES (`runningTasks`, rôle `task`, les
  seules visibles sur le tableau) des agents de service. Verrouillé par
  `server/src/test/capacite.test.ts` et `scripts/verif-capacite-saturation.mjs`.
- **UNE ZONE QUI N'A PAS ENCORE SES DONNÉES MONTRE UNE SILHOUETTE, JAMAIS UN ÉTAT VIDE**
  (`web/src/components/silhouettes.tsx` ; drapeaux `pret` et `cartesChargees` de
  `web/src/lib/client.ts`) : colonne de gauche, tableau et conversation dessinent la FORME de leur
  contenu à venir tant que `ready` / `project.snapshot` / le fil de l'agent manquent. « Aucun projet
  inscrit », « Aucun projet sélectionné », « Aucun échange » ne s'écrivent qu'après réception. Les
  drapeaux jugent l'ABSENCE de la donnée, jamais une liste vide ; l'animation se coupe sous
  `prefers-reduced-motion`. Vérifié par `scripts/verif-silhouettes-chargement.mjs`.
- **UNE FENÊTRE POSÉE DANS L'ENTÊTE D'UNE COLONNE RELÈVE L'ENTÊTE, PAS ELLE-MÊME**
  (`composerOuvert` / `onOuvert` de `ComposerInline`, `web/src/components/board.tsx`) : la fenêtre de
  création d'une note ou d'une tâche est en `absolute` DANS l'entête, qui porte `isolate` — son
  `z-index` reste donc enfermé dans ce plan d'empilement et ne se compare jamais à celui de la zone
  qui défile, posée APRÈS dans le DOM et elle aussi positionnée. Elle se peignait par-dessus tout ce
  qui dépasse sous l'entête : seul le TITRE recevait les clics, la description et les boutons
  « Ajouter la note » / « Joindre » / « Annuler » étaient recouverts par les cartes, et la fenêtre
  restait bloquée sans même pouvoir être fermée. La fenêtre REMONTE donc son ouverture au tableau,
  qui relève l'entête entier (`z-30`) — uniquement tant qu'elle est ouverte, le démontage le
  rabaissant. Règle générale : monter le `z-index` d'un enfant ne sert à rien quand un ancêtre forme
  un plan d'empilement, c'est cet ancêtre qu'il faut relever. Vérifié par
  `scripts/verif-fenetre-note.mjs` (mesure au `elementFromPoint`, ordinateur et téléphone).
- **LE PREMIER ENVOI N'ATTEND RIEN ET NE PORTE QUE L'UTILE** (`shared/src/premier-envoi.ts` ; bloc
  de connexion de `server/src/ws.ts` ; `cachedEngines`, `server/src/engines/index.ts`) : rien ne
  s'affiche tant que `ready` n'est pas arrivé. Il n'attend donc plus le catalogue des moteurs
  (7 476 ms mesurés : trois exécutables et des appels réseau) ni une tournée de quotas — le dernier
  catalogue connu part tel quel, MÊME PÉRIMÉ, et la vraie liste suit par les événements `engines` et
  `quotas` ; les trois moteurs sont interrogés EN MÊME TEMPS (2 595 ms) et une seule tournée sert
  toutes les connexions. Il ne porte que les agents utiles (vivants, finis depuis moins d'une heure,
  ou du projet ouvert) et les décisions ENCORE OUVERTES — 1 043 Ko → 3 Ko —, le COMPTE par projet
  restant calculé sur la liste entière. Et les cartes du projet retenu partent AVEC lui
  (`openedProjectId`), sans aller-retour : première carte à l'écran 13 814 → 5 419 ms sur un
  téléphone au réseau bridé. Verrouillé par `server/src/test/premier-envoi.test.ts`, mesuré par
  `scripts/mesure-premier-affichage.mjs`.
- **UN ÉCRAN QU'ON N'A PAS OUVERT NE SE TÉLÉCHARGE PAS** (`PanneauALaDemande`,
  `prechargerAuRepos`, `web/src/lib/panneau-a-la-demande.tsx` ; `React.lazy` en tête de
  `web/src/app.tsx`) : tableau de bord, réglages, tiroir de carte, module de voix et CONVERSATION
  partent en MORCEAUX à part — 841 → 596 Ko (249 → 180 Ko compressés), la seule attente qui restait
  sur téléphone une fois le premier envoi allégé. Deux règles : un panneau fermé n'est PAS monté
  (monter un composant paresseux qui rend `null` téléchargerait quand même son morceau), et rien ne
  s'affiche pendant le chargement — ces panneaux s'ouvrent par-dessus l'écran. Tous les morceaux
  sont réclamés une fois l'application AU REPOS (`requestIdleCallback`) : le premier clic n'attend
  pas le réseau non plus.
- **Toute zone qui défile passe par `ZoneDefilement`** (`web/src/components/ui`) : elle bloque le
  second axe et pose le fondu. Le tableau ne glisse que de gauche à droite, une colonne de haut en bas.
  Elle ne refait son `ResizeObserver` que si les éléments à surveiller ont VRAIMENT changé — sinon
  chaque rendu en reposait un sur chacun de ses enfants.
- **LE TABLEAU POSE LES CARTES PAR PAQUETS DE VINGT** (`CARTES_PAR_PAQUET`, `cartesDuPaquet`,
  `paquetSuivant`, `shared/src/paquets-de-cartes.ts` ; `PalierDeChargement`, `board.tsx`) : chaque
  colonne pose son premier paquet, un PALIER sous la dernière carte demande le suivant quand il
  approche de l'écran. Le COMPTEUR de la tête de colonne (et l'onglet du téléphone) dit toujours le
  TOTAL réel, jamais ce qui est posé, et une sélection en lot pose d'abord toute la colonne.
  Verrouillé par `server/src/test/paquets-de-cartes.test.ts` et `scripts/verif-cartes-par-paquets.mjs`.
- **LE CALQUE DES TAGS « [fichier: …] » SE CALE SUR LE CHAMP, IL NE LE REDIT PAS**
  (`reglagesDuChamp`, `web/src/lib/miroir-texte.ts` ; calque `data-prompt-calque` de
  `composer.tsx`) : le `textarea` décide seul des retours à la ligne et de l'endroit du curseur, le
  calque ne fait que colorer. Ses réglages sont RECOPIÉS de ceux du champ (même liste que le miroir
  de mesure), sa largeur retire l'ascenseur, et un tag est dessiné avec les MÊMES CARACTÈRES que le
  texte réel — habillage sur marges négatives. Une pastille « trombone + nom » n'a pas la largeur du
  tag qu'elle recouvre : texte décalé, ligne vide en trop, curseur ailleurs qu'où il paraît. Vérifié
  par `scripts/verif-tags-mise-en-page.mjs`.
- **CE CALQUE NE COUVRE QUE LA PART VISIBLE DU CHAMP, ET LA SÉLECTION Y RESTE VISIBLE**
  (`fenetre` de `reglagesDuChamp` ; `data-prompt-calque` / `data-prompt-calque-texte`,
  `composer.tsx` ; `.texte-sous-calque`, `web/src/styles.css`) : un SEUL bloc posé en `inset-0` et
  déplacé par `translateY(-scrollTop)` emportait sa propre découpe en glissant et couvrait la rangée
  de boutons — dès qu'un fichier était joint et le texte assez long pour défiler, les lignes de trop
  s'écrivaient par-dessus le trombone, le sélecteur de moteur et le micro. Ce sont désormais DEUX
  blocs : une FENÊTRE calée sur les `clientWidth` / `clientHeight` du champ, qui coupe et ne bouge
  jamais, et DEDANS le texte, qui seul glisse. Et le champ, rendu transparent sous le calque, DOIT
  redire un fond de `::selection` : poser une règle `::selection` ôte à Chrome son fond par défaut,
  et sélectionner à la souris ne montrait alors plus rien. Vérifié par
  `scripts/verif-composeur-jointe-debordement.mjs`.
- **UN TAG « [fichier: …] » S'EFFACE D'UN BLOC, jamais caractère par caractère** (`effacementDeTag`,
  `tagsDuTexte`, `shared/src/ancres.ts` ; touche branchée dans `onKeyDown` de `composer.tsx`) : le
  retour arrière ou la suppression avant qui entame un tag — d'une seule lettre, ou par une sélection
  qui ne le couvre qu'à moitié — emporte le tag ENTIER et son espace devenu inutile ; la pièce jointe
  suit par `jointesApresFrappe`. Sans cela le tag restait à l'écran, amputé, accroché à un fichier
  que le texte ne désignait plus. La règle rend `null` quand aucun tag n'est touché : la touche suit
  alors son chemin normal et le champ garde son historique d'annulation. Chaque tag porte en plus une
  CROIX (`data-prompt-file-close`). Verrouillé par `server/src/test/ancres-fichiers.test.ts` et
  `scripts/verif-tag-suppression-bloc.mjs`.
- **UN TAG « [fichier: …] » NE SE COUPE PLUS EN FIN DE LIGNE : SES ESPACES SONT INSÉCABLES**
  (`ESPACE_INSECABLE`, `ancre`, `tagsInsecables`, `tagsEnEspacesOrdinaires`, `nomDuTag`,
  `shared/src/ancres.ts` ; `texteDuChamp`, `composer.tsx`) : le champ coupait à l'espace de
  « [fichier: nom] », le tag occupait deux lignes et retombait en texte brut SANS CROIX — deux
  étiquettes voisines, l'une en pastille et l'autre en syntaxe nue. Le tag s'écrit donc avec des
  espaces U+00A0, gabarit ET nom du fichier. La transformation est un AFFICHAGE à longueur
  CONSTANTE, posée sur le `value` du champ et sur le CALQUE (même chaîne des deux côtés, sinon les
  tags dessinés tombent à côté) : aucune position de curseur ne bouge, et tout ce qui entre dans le
  champ (collage, brouillon, dictée) y passe. Rien d'insécable n'en SORT (envoi, copie,
  modification d'un message en attente : `tagsEnEspacesOrdinaires`), et plus rien ne se RELIT par le
  texte exact de l'ancre — `tagsDuTexte` / `ancreDuTexte` cherchent le MOTIF, sinon un texte d'avant
  cette règle perdrait sa croix. Le repli « texte brut » reste pour un nom à TIRETS : aucun réglage
  CSS n'empêche la coupure après un trait d'union. Un contrôle qui LIT le champ ramène les espaces à
  leur forme ordinaire avant de comparer. La PASTILLE, elle, écrit en 0,82 em, toutes ses autres
  mesures suivant en em d'elle-même : c'est ce qui dégage sa marge intérieure sans jamais l'élargir
  au-delà des caractères recouverts.
- **UN TAG « [fichier: …] » SE LIT COMME UNE PASTILLE, JAMAIS COMME DU TEXTE BRUT**
  (`data-prompt-file-pastille`, `composer.tsx`) : les caractères réels gardent leur place mais sont
  rendus INVISIBLES, et une pastille « trombone + nom + croix » est dessinée par-dessus, HORS FLUX,
  centrée dans leur largeur — inchangée, donc ni le texte, ni la ligne, ni le curseur ne bougent. La
  syntaxe ne se voit plus, et la croix garde de la marge avant le mot qui suit. Deux gardes : la
  pastille ne dépasse jamais la HAUTEUR des caractères recouverts (sinon elle mord sur la ligne
  voisine et vole le clic qui vise le champ), et un tag COUPÉ en fin de ligne (`getClientRects`,
  `data-tag="coupe"`) revient au texte brut. Vérifié par `scripts/verif-tag-pastille.mjs`.
- **LA FRAPPE AU CLAVIER NE TRAVERSE PLUS LE MAGASIN GÉNÉRAL** (`composer.tsx`) : le brouillon était
  posé dans l'état PARTAGÉ à chaque touche, ce qui refaisait l'affichage de toute l'application —
  98 ms par touche sur 400 cartes, contre 0,7 ms depuis (`scripts/mesure-fluidite.mjs`, qui MESURE
  sans juger). La copie locale part dans la même temporisation de 600 ms que l'envoi au serveur, et
  le tableau range ses cartes par colonne UNE fois par rendu.
- **LES CARTES D'UN PROJET QU'ON NE CONSULTE PLUS SE DÉCHARGENT — APRÈS QUINZE MINUTES, PAS AVANT**
  (`DELAI_DECHARGEMENT_MS`, `projetsADecharger`, `shared/src/decharge-projets.ts` ;
  `dechargerLesProjetsOublies`, `web/src/lib/client.ts`) : le projet AFFICHÉ n'est jamais déchargé, et
  un projet rouvert redemande ses cartes par le `project.open` déjà envoyé. Verrouillé par
  `server/src/test/decharge-projets.test.ts`.
- **Une demande réellement partie garde son contexte envoyé et sa mesure moteur** ; en reprise,
  l'historique opaque est seulement nommé, jamais recopié ni inventé.
- **LE PROMPT ENVOYÉ SE LIT EN BULLES DE MESSAGE, PLUS AUCUN TIROIR** (`BullesDuPromptEnvoye`,
  `web/src/components/prompt-envoye.tsx` ; règles pures `bullesDuPromptEnvoye`,
  `texteDesPassagesRetrouves`, `apercuDeBulle`, `LIGNES_VISIBLES_BULLE`, `texteDuPromptEnvoye`,
  `shared/src/prompt-envoye.ts`). La pastille « Prompt envoyé » et son tiroir plein écran sont
  RETIRÉS : il fallait repérer un bouton et cliquer pour lire le prompt qu'on avait sous les yeux. Ce
  qui part au moteur s'affiche DANS le fil, comme des messages de l'utilisateur — alignés à DROITE,
  même encadré gris et même largeur que ses demandes —, dès que `message.sentContext` existe. TROIS
  bulles, toujours dans cet ordre (`data-bulle-prompt`) : sa DEMANDE, la MÉMOIRE retrouvée par la
  recherche (chaque passage nommé par sa source, ou la RAISON de leur absence ; ni l'un ni l'autre, pas
  de bulle), puis le PROMPT COMPLET (en-tête, morceaux nommés avec leur texte, repère écrit sur ce qui
  est relu au cache). Une demande TAPÉE n'est pas redite — sa bulle est juste au-dessus
  (`demandeDejaAffichee`) ; un tour lancé par un BOUTON, lui, porte les trois. Aucun chiffre nulle
  part, et un nom de morceau n'est jamais mis en MAJUSCULES (il porte souvent un chemin de fichier).
  La CHRONOLOGIE (`chronologieContexteEnvoye`, `recapitulatifEnvoi`, `shared/src/couches-tokens.ts`)
  reste, mais ne sert plus que le lecteur de l'onglet « Détails ».
  **Une bulle trop longue ne montre que ses CINQ premières lignes, avec « voir plus » en bas**
  (`apercuDeBulle`, `data-texte-bulle`, `data-voir-plus`) : la règle pure compte les vraies lignes,
  l'écran borne EN PLUS la hauteur à cinq lignes et mesure son débordement — seul moyen de voir qu'une
  ligne unique mais très longue se replie d'elle-même. Cette mesure n'est pas refaite une fois la
  bulle déroulée, sinon « voir moins » disparaîtrait sous le doigt. Vérifié par
  `server/src/test/prompt-envoye.test.ts` et `scripts/verif-contexte-envoye.mjs`.
  **La bulle de MÉMOIRE, elle, est ISOLÉE et repliée sur TROIS lignes** (`isole`, `lignesVisibles`,
  `LIGNES_VISIBLES_MEMOIRE`, `shared/src/prompt-envoye.ts` ; `data-bulle-isolee`,
  `data-bulle-entete`) : même encadré gris que le prompt complet posé dessous, elle se lisait comme
  sa première moitié et poussait la réponse hors de l'écran. Fond propre (`bg-surface`), liseré à
  gauche, écart au-dessus et au-dessous, pas de queue de bulle — et un ENTÊTE cliquable qui la déplie
  et la referme (repliée, l'aperçu s'ouvre aussi d'un clic ; déroulée, non, sinon sélectionner une
  citation la refermerait).
- **UN TOUR SANS BULLE DE DEMANDE PORTE SES BULLES SUR SA RÉPONSE** (`demandeDuPromptEnvoye`,
  `shared/src/prompt-envoye.ts` ; `messageDuContexte`, `server/src/runtime.ts`) : un tour lancé par un
  BOUTON n'écrit aucun message d'utilisateur (`options.silent` — carte démarrée, reprise, dépannage,
  mise en production, auto-amélioration), et le prompt envoyé n'était gardé que sur ce message-là. Le
  texte parti au moteur et les PASSAGES retrouvés dans la mémoire n'existaient donc nulle part, et le
  tiroir d'une carte s'ouvrait droit sur « Exécution de la tâche ». Le contexte se pose maintenant sur
  la bulle de la demande quand elle existe, sinon sur le message de RÉPONSE
  (`contexteUtilisateur?.messageId ?? assistantMessage.id`) ; cette réponse ouvre alors par les trois
  bulles, la PREMIÈRE portant la demande elle-même, AVANT la mémoire relue et AVANT le déroulé. Une
  demande écrite à la main ne bouge pas. La bulle du prompt complet dit aussi CE QUI EST PARTI EN MÊME
  TEMPS, sans rien dérouler (`donneesParallelesDuPrompt`, `data-donnees-paralleles`) : les NOMS des
  morceaux de contexte — briefing, mémoire, carte, pièces jointes —, jamais leur poids en jetons.
  Vérifié par `server/src/test/prompt-envoye.test.ts`, `scripts/verif-contexte-envoye.mjs` (l'écran,
  sur un instantané posé à la main) et `scripts/verif-prompt-envoye-tour-lance.mjs` (le CHEMIN entier :
  carte lancée par le bouton, démon et faux moteur d'essai).
- **L'onglet « Détails » d'une carte est une LIGNE DE TEMPS** (`shared/src/parcours-carte.ts`,
  commande `card.parcours`) : une étape par moment réel — tri du chef, autorisation, travail,
  déploiement, mise en production —, chacune avec ce qu'elle est allée CHERCHER et ce qu'elle a
  RÉELLEMENT consommé. Jamais d'estimation dans le parcours : une étape sans mesure porte la RAISON
  de son absence, et une étape qui n'appelle jamais le moteur (`attendMesure` faux) n'est pas comptée
  comme un trou. Jamais un jeton deux fois : une étape = des agents, un tour appartient à un seul.
  Le PRÉVU vit dans un bloc séparé, sous le parcours, nommé prévision. Vérifié par
  `scripts/verif-detail-analyse.mjs` et `scripts/verif-parcours-tache.mjs`.
- **Le détail d'une carte issue du chef montre ce qui était préparé avant l'exécution** : réglages
  repris, contenu transmis, chiffrage disponible et continuité du fil. Vérifié par
  `scripts/verif-reglages-carte.mjs`.
- **Un chef sans choix manuel part sur Haiku 4.5 sous Claude ou GPT-5.4 sous Codex, en réflexion
  moyenne**, toujours ramené vers un modèle réellement présent dans le catalogue du moteur : il ne
  fait qu'un tri, un modèle de raisonnement n'y sert à rien.
- **Rien ne pointe vers le dossier personnel d'un utilisateur** (`/home/<quelqu'un>/…` écrit en dur) :
  une bibliothèque se déclare dans `package.json`, un outil dont le démon dépend se copie dans
  `outils/`. Le dossier de travail d'un projet vit sous `/root/<projet>`.
- **Un script de vérification vise le dépôt d'où il PART** (déduit de `import.meta.url`), jamais
  `/root/haikodev` en dur — sinon, lancé depuis une copie de travail, il jugerait le dossier principal.
- **Les compétences partagées sont un POOL, alimenté par les tâches PROUVÉES**
  (`shared/src/competences.ts`, `shared/src/fiche-competence.ts`, `server/src/competences.ts`,
  `server/src/capitalisation.ts`, migration 30). Une compétence est un DOSSIER de
  `data/competences/` portant un `SKILL.md` : le démon la pose dans le coffre de chaque compte Claude
  et le briefing l'annonce à tout agent — désormais par un SOMMAIRE par thème (229 jetons pour quinze
  fiches, contre 1 716 en énumérant). SEPT invariants : le coffre personnel est ADOPTÉ dans le pool
  (quinze fiches y dormaient, une seule était raccordée) ; tout refus est DIT avec sa cause, jamais
  muet ; une fiche est un ARBRE (tête + détails) indexé UNE SEULE FOIS sous `@competences`, jamais
  recopié par projet, et sa part du contexte est plafonnée (`PART_MAX_DES_COMPETENCES`) — la
  couverture des vecteurs se juge sur le PROJET seul, sinon un pool neuf renverrait toute la
  recherche aux mots ; une fiche porte un ÉTAT (active, dépréciée, archivée — **rien ne se
  supprime**), une PROVENANCE et une CONFIANCE mesurée sur quatre compteurs ; on n'écrit dans le pool
  que par l'outil `competences`, à travers un contrôle de qualité (section « Vérification » exigée) ;
  une carte ne se capitalise qu'après TROIS volets (contrôles rejoués et réussis, passage en
  production, sept jours sans contradiction — cinq signaux, deux exigés) ; le pool est son propre
  dépôt git, le pousser restant un geste de l'utilisateur. Verrouillé par
  `server/src/test/competences.test.ts`, `server/src/test/capitalisation.test.ts` et
  `scripts/verif-pool-competences.mjs`.
- **GITHUB est ouvert à TOUT agent, sur TOUS les projets, sans carte ni réglage**
  (`shared/src/acces-github.ts`, `server/src/github.ts`) : le jeton du serveur (`gh auth token`) part
  dans l'environnement de chaque agent, donc `gh` marche en copie de travail comme dans le bac à sable
  du chef ; l'accueil ANNONCE les gestes, sauf au palier minimal d'un dépannage. Publier et mettre en
  ligne restent des gestes de l'utilisateur, GitHub compris. Vérifié par `scripts/verif-acces-github.mjs`.
- **L'ONGLET « GITHUB » D'UNE CARTE NE PARLE QUE DE LA BRANCHE DE SON AGENT**
  (`shared/src/suivi-branche-carte.ts` ; `baseDeLaBranche` et `refreshCard`, `server/src/github.ts` ;
  `GithubTracking.baseSha`) : il montrait « les 10 derniers commits » de la branche, c'est-à-dire
  l'HISTORIQUE GÉNÉRAL du dépôt — le travail d'autres cartes. Tout se compte désormais depuis le
  POINT DE DÉPART de la branche, retenu à sa création (`ouvrirDossierDeCarte` rend `base`, le
  scheduler le pose et ne le réécrit jamais) : sa naissance, ses seuls enregistrements, les fichiers
  ajoutés/modifiés/supprimés avec leur liste, puis le DÉROULÉ de son déploiement étape par étape
  jusqu'à la fusion (`github.deploiements`, lecture en base seule). Sans base retenue — cartes
  d'avant —, elle est retrouvée : ancêtre commun tant que la branche est ouverte, sinon le commit de
  FUSION dont le second parent est le sommet de la branche, la principale la contenant déjà. Rien
  n'est deviné : une branche introuvable rend « je ne sais pas » au lieu d'un périmètre inventé.
  Verrouillé par `server/src/test/suivi-branche-carte.test.ts` et
  `scripts/verif-onglet-github-branche.mjs`.
- **…ET IL SE LIT COMME UNE LIGNE DE TEMPS VERTICALE, CHARGÉE À L'OUVERTURE** (`GithubTab`,
  `NoeudDeTemps`, `web/src/components/card-panel.tsx` ; `lignesDepuisNumstat`, `avecLesLignes`,
  `totalDesLignes`, `shared/src/suivi-branche-carte.ts`) : il portait tout ce que GitHub sait dire —
  enregistrements, demande de fusion, contrôles d'intégration, commentaires de revue — et
  l'essentiel s'y perdait. Il ne garde plus que DEUX nœuds, dans l'ordre où ils arrivent : les
  fichiers touchés avec leurs LIGNES ajoutées et supprimées (`git diff --numstat`, relevé à côté du
  `--name-status` ; un binaire n'a pas de compte et n'en affiche aucun, un renommage garde le
  chemin nouveau), puis le déroulé du déploiement étape par étape. Le bouton « Actualiser » est
  RETIRÉ : le relevé part tout seul à l'ouverture, une fois par carte (marque `releve`, sinon
  `fetchedAt` relancerait l'effet sans fin), et le déroulé se recharge quand ce relevé rend. Le
  trait vertical est porté par CHAQUE nœud, jamais par la colonne : il s'arrête donc de lui-même
  sur le dernier.

### Quotas

- **Chaque hausse mesurée sur un compte n'est attribuée qu'une fois** (`cumulerPartsQuota`,
  `shared/src/quota.ts`) : les tours simultanés cumulent leur part depuis un repère commun, mis à
  jour après chaque fin de tour. Deux fins décalées ne repartent jamais du même ancien relevé.
- **Un tour COUPÉ PAR LA LIMITE D'UN COMPTE n'est pas un échec** (`motifDArretQuota`,
  `shared/src/reprise-compte.ts`) : la conversation propose « Avec quel compte poursuivre ? » avec
  les autres comptes du MÊME moteur, jamais le compte tombé ni un compte coupé. Reconnu sur
  l'événement structuré du moteur ou sa bannière de texte, jamais sur un à-peu-près — arrêt manuel,
  tour réussi et citation d'un agent sont écartés. Le clic revérifie le compte sur un relevé frais,
  retient le choix AVANT de lancer (double clic sans effet) et relance le MÊME agent avec sa
  branche et ses étapes restantes. Aucun compte libre : le choix reste ouvert et
  s'actualise tout seul avec les quotas.
- **Le fil du moteur appartient au COMPTE qui l'a ouvert** (`cleDeSession`,
  `shared/src/reprise-moteur.ts`) : la conversation vit dans le COFFRE du compte
  (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`), donc changer de compte ouvre un fil NEUF — jamais un
  `--resume` que l'autre coffre refuserait. Le compte se choisit donc AVANT le contexte
  (`preparerLeTour`, `server/src/runtime.ts`), et le fil neuf repart AVEC un résumé de continuité
  (`resumeContinuite`, motif `changement-de-compte`) et la liste de tâches recopiée entière
  (`tachesAPoursuivre`) : on poursuit, on ne redécouvre pas.
- **Chaque échéance de quota connue déclenche une lecture ciblée après 15 s**
  (`server/src/quota-echeances.ts`) : échéances proches groupées, lecture en cours partagée,
  temporisation du fournisseur respectée, nouvel essai jusqu'à un relevé frais puis réveil immédiat
  de l'ordonnanceur. La boucle de dix minutes reste le filet de sécurité.

### Coûts

- Le chiffrage d'une carte sépare l'analyse MESURÉE (événement d'usage du moteur et delta de quota)
  de l'exécution PROJETÉE (formule et hypothèses visibles) ; une part non mesurable se dit indisponible.
- Les heures facturées sont celles d'un développeur senior, jamais la durée machine de l'agent.
- Les moteurs sont les outils en ligne de commande déjà authentifiés sur le serveur : aucune clé
  facturée à l'appel.
