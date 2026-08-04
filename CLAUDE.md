# HaikoDev — instructions du moteur

Fichier court et factuel, tenu à jour AU FIL des tâches : comment lancer, comment vérifier, où
vivent les choses, ce qu'on n'enfreint pas. Aucun journal ici — les livraisons vont dans
`HISTORIQUE.md`, les règles apprises dans `MEMOIRE.md`.

## Où vivent les choses

| Dossier | Rôle |
| --- | --- |
| `server/` | Le démon : base, protocole, ordonnanceur, agents, outils, publication |
| `web/` | L'interface : tableau, conversations, réglages, application installable |
| `shared/` | Les règles pures, sans base ni disque — donc testables seules |
| `scripts/` | Service système, identifiants, scripts de vérification |
| `data/live` | **Ce qui est réellement servi** : écrit uniquement par la publication |

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

Un script de vérification ne doit **jamais** reprendre `HAIKODEV_URL` : cette variable, posée dans
l'environnement des agents, désigne l'application DÉJÀ PUBLIÉE — on y verrait l'ancienne version.
Viser le serveur de développement, et n'accepter d'autre adresse que par une variable à soi.

## Vérifier

```bash
npm test                            # tous les tests du démon (compilés dans server/dist)
node scripts/mesure-jetons.mjs      # ce qui part au moteur, avant / après
node scripts/verif-memoire-agent.mjs # un vrai agent va-t-il chercher un fait détaillé ?
node scripts/verify-ui.mjs          # l'interface dans un vrai navigateur
node scripts/verif-prevision-quota.mjs # la prévision d'épuisement, dans le volet des quotas
node scripts/verif-reprise-paseo.mjs # les cartes reprises de Paseo, dans un vrai navigateur
node scripts/verif-defilement-tableau.mjs # les axes de défilement du tableau, sur écran de téléphone
node scripts/verif-volet-taches.mjs # le volet des tâches, fixe en bas de la conversation
node scripts/verif-heure-permanente.mjs # l'heure sous les messages, sombre / clair / téléphone
node scripts/verif-signal-attention.mjs # la secousse, le triangle et le badge bleu de la colonne
node scripts/verif-glissement-projets.mjs # ranger la colonne de gauche sans qu'une ligne saute
node scripts/verif-tiroir-quotas.mjs # le volet des quotas : défilement et poignée qui referme
node scripts/verif-bloc-publication.mjs # le bloc de publication repart à zéro après une mise en ligne
node scripts/verif-decoupe-hors-tache.mjs # une fonctionnalité sans carte = une branche (dépôt d'essai)
node scripts/verif-fondu-defilement.mjs # le fondu flouté en haut et en bas des zones qui défilent
node scripts/verif-cerveau-reglages.mjs # l'état de la liaison au cerveau, dans l'onglet Système
node scripts/verif-outils-codex.mjs # le moteur Codex reçoit bien les outils du projet (vrai tour)
node scripts/verif-deroule-uniforme.mjs # même demande, deux moteurs : l'instruction envoyée est-elle la même ?
node scripts/nettoyer-essais.mjs    # À LANCER APRÈS : retire les cartes d'essai
```

`npm test` lit `server/dist` : construire avant de tester.

Les scripts qui passent par le navigateur ont besoin d'une session : ils s'en fabriquent une
d'une heure dans la base et la retirent en partant. Les jetons de session sont stockés HACHÉS :
on n'en réutilise jamais un existant. **Ne jamais reprendre `HAIKODEV_TOKEN`** : c'est le jeton
d'un agent, PÉRIMÉ de surcroît — le neutraliser (`env -u HAIKODEV_TOKEN …`), sinon la page reste
bloquée sur « Connexion au serveur… ». De même, `HAIKODEV_URL` vaut par défaut l'application
PUBLIÉE : pour juger d'un code non publié, viser le serveur de développement.

## Mémoire du projet

- `MEMOIRE.md` — faits durables et pièges. Seul son **index** (une ligne brève par fait, groupée par
  sujet) part au moteur au lancement d'un agent ; le texte entier se demande avec l'outil
  `project_memory`.
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
  au plus, les porteuses d'abord. Un `discussion_id` stable par projet
  et par fichier fait REMPLACER au lieu d'empiler ; une empreinte SHA-256 par fichier évite de
  renvoyer l'inchangé, sauf rattrapage hebdomadaire. La clé vient de `CERVEAU_API_KEY`
  (`/etc/haikodev.env`, hors dépôt) : sans elle, l'envoi se tait et le dit dans les réglages.

## Règles à ne pas enfreindre

- **Ne jamais publier de sa propre initiative.** Enregistrer et pousser, oui ; mettre en ligne est un
  geste de l'utilisateur.
- **Créer un projet, c'est le MONTER en entier**, toujours de la même façon : dossier sur le serveur,
  dépôt git sur `main`, dépôt GitHub privé créé et poussé, puis les sept fichiers de départ
  (`README.md`, `CLAUDE.md`, `AGENTS.md` qui renvoie au premier, `DOCUMENTATION.md`, `MEMOIRE.md`,
  `HISTORIQUE.md`, `.gitignore`), et enfin l'inscription dans la colonne de gauche. Rien n'est
  écrasé, une étape ratée n'arrête pas les autres et se dit dans le formulaire.
- **La carte suit les ÉTAPES RÉELLES du travail, et seul l'agent d'EXÉCUTION la déplace**
  (`shared/src/suivi-colonne.ts`). Parcours : « À faire » → (clic de validation) → « Validé » →
  (analyse rendue) → « En cours » → (exécution rendue) → « Terminé ». Un tour d'agent de rôle
  « task » qui démarre la met en « En cours » ; le même tour réussi la pose en « Terminé » ; un
  tour en échec ne la déplace pas. Les rôles « analysis », « orchestrator » et « deploy » portent
  aussi le numéro de carte mais ne la déplacent JAMAIS, ni au départ ni à l'arrivée — ni démarrer
  une étude ni la rendre n'est faire le travail. Le passage « Validé » → « Planifié » → « En cours »
  au lancement de l'exécution reste le geste de l'ordonnanceur ; les règles pures ne le doublent
  pas. Vrai pour TOUTE carte, d'où qu'elle vienne. « À déployer » et « Archivé » ne se laissent pas
  reprendre : une question posée dans la conversation ne sort pas une carte du lot à publier.
- **TOUTE demande de PROGRAMMATION passe par une carte** — nouvelle fonctionnalité, correction,
  suppression, changement de comportement, retouche d'interface, script, réglage : aucune exception,
  quelle que soit la taille. Le chef PROPOSE la carte et s'arrête là ; c'est l'agent de cette carte
  qui fait le travail, pour que l'avancement se voie du début à la fin sur le tableau. **Vrai aussi
  sur HaikoDev** : les outils d'écriture du chef ne dispensent pas de la carte. Une simple question
  se répond dans la conversation, sans carte. Verrouillé par `server/src/test/tri-du-chef.test.ts`.
- Une carte naît toujours dans « À faire », et **jamais sans un clic de l'utilisateur**.
  `board_create_card` n'écrit RIEN : comme `propose_task`, il affiche une proposition en attente dans
  la conversation, avec ses boutons valider / refuser ; la validation seule fait naître la carte, qui
  suit ensuite le parcours habituel. Seule exception : le code enregistré par un agent SANS carte
  fabrique tout seul sa fiche dans « À déployer » — le travail est déjà fait. Verrouillé par
  `server/src/test/carte-du-chef-attend-la-validation.test.ts`.
- **Toute fonctionnalité vit sur sa propre branche, carte ou pas — UNE fonctionnalité = UNE branche =
  UNE carte.** À la fin d'un tour sans carte, le démon découpe les enregistrements (un enregistrement
  = une fonctionnalité, sauf « suite… », « correction… », « fixup! » qui restent collés au
  précédent), repique chacun sur sa branche `hors-tache/…` depuis l'état d'AVANT le tour, rend la
  branche de départ à cet état, pousse les branches, et chacune porte SA fiche dans « À déployer ».
  Supprimer une carte suffit alors à écarter cette fonctionnalité-là, sans toucher aux autres. Deux
  fonctionnalités qui se disputent les mêmes lignes ne peuvent pas être indépendantes : la seconde
  est empilée sur la première et sa fiche le dit. Au moindre doute (dossier sali, travail déjà au
  dépôt), rien ne bouge et une seule carte le signale. Conséquence pour un agent sans carte :
  **enregistrer, oui ; pousser sur la branche principale, non** — une histoire déjà publiée ne se
  réécrit pas, et le travail resterait collé à la principale. Corollaire : **un enregistrement par
  fonctionnalité**, avec un message qui la nomme.
- Rien de ce qui se fait ne reste invisible : chaque ligne du lot à publier a sa carte, et un projet
  dont un agent a rendu son travail porte une pastille tant que la conversation n'a pas été ouverte.
  **Deux choses secouent la ligne d'un projet** (`shared/src/signal-projet.ts`) : une décision
  attendue — triangle orange — et un travail rendu pas encore consulté — point bleu clignotant. Les
  deux comptes se comparent SÉPARÉMENT, la secousse ne joue qu'une passe, et la ligne qu'on regarde
  déjà ne bouge jamais.
- Le dossier de travail est **partagé** entre agents : vérifier la branche avant de modifier, puis
  committer ses fichiers **nommés un par un** — jamais `git add -A`.
- Un agent de tâche travaille en accès complet ; le chef d'orchestre ne modifie aucun fichier
  existant (sauf sur HaikoDev lui-même).
- Le tableau ne glisse que de gauche à droite, une colonne que de haut en bas. Un axe en `auto`
  entraîne l'autre : le rail doit dire `overflow-y-hidden` en toutes lettres.
- **Toute zone qui défile passe par `ZoneDefilement`** (`web/src/components/ui`) : elle bloque le
  second axe et pose le fondu flouté aux deux bords. Pas de `overflow-y-auto` posé à la main, et pas
  de filet (`border-t` / `border-b`) au bord d'une zone à fondu — le fondu EST la limite.
- **Le fondu est réservé au défilement VERTICAL**, le seul où le texte glisse derrière un en-tête ou
  une barre. En `axe="horizontal"` (rail du tableau, barres d'onglets), `ZoneDefilement` ne pose
  AUCUN voile : il masquerait le bord des colonnes sans rien apprendre. L'option reste, car c'est
  elle qui écrit `overflow-y-hidden` en toutes lettres et empêche le tableau de flotter.
- **Les outils du projet se branchent différemment selon le moteur.** Claude Code reçoit un FICHIER
  de configuration (`--mcp-config`) ; Codex reçoit la COMMANDE à lancer, donc le chemin du pont
  lui-même (`server/mcp-bridge.mjs`), jamais le fichier de configuration — `node fichier.json` sort
  aussitôt sans rien dire et la liste d'outils reste vide. Codex exige en plus
  `mcp_servers.haikodev.default_tools_approval_mode="approve"` : sans ce mode, chaque appel demande
  une approbation que personne ne donne et le moteur rend « user cancelled MCP tool call ».
  Verrouillé par `server/src/test/outils-codex.test.ts`.
- **Le déroulé de l'agent est décidé par HaikoDev, pas par le moteur, et il est le MÊME pour
  Codex et pour Claude.** Les consignes de rôle (`rolePrompt`, `server/src/runtime.ts`) et le
  gabarit de réponse (`wrapPrompt`, `shared/src/templates.ts`) sont uniques ; seul le NOM de
  l'outil de liste de tâches change d'un moteur à l'autre (Claude : `TaskCreate`/`TaskUpdate` ;
  Codex : `update_plan`), injecté par `rolePrompt` selon `agent.run.engine`. On nomme à chaque
  moteur SON seul outil — jamais le menu des deux, qui laisserait le modèle choisir. Verrouillé
  par `server/src/test/deroule-uniforme.test.ts`.
- **La MÉTHODE de travail est imposée, pas laissée au modèle** (constante `METHODE`,
  `server/src/runtime.ts`) : lire avant de répondre (fichier d'instructions, `project_memory` sur
  chaque ligne d'index touchée, fichiers repérés par recherche), constater par écrit, ne rien
  affirmer sans l'avoir vu, rejouer les contrôles du projet et en dire le résultat. Elle ne nomme
  AUCUN outil propre à un moteur, sinon elle cesserait de valoir partout.
- **Un moteur qui ne recolle pas sa consigne système la reçoit en rappel.** Claude Code repasse
  `--append-system-prompt` à chaque tour ; Codex n'a la sienne qu'au premier message du fil, donc
  toute reprise part avec `systemPromptRappel` (`rappelDeMethode`) devant la demande — le pavé
  entier, lui, ne repart jamais. Sans ce rappel, le déroulé s'effaçait d'un moteur et pas de l'autre.
- La liste de tâches (`TodoWrite`, `TaskCreate`/`TaskUpdate`, `TaskList`, `TaskGet`) est
  AUTORISÉE même au chef d'orchestre bridé : elle n'écrit rien, elle affiche le déroulé. Lancer un
  travail en arrière-plan (`Task`, `Agent`, `Workflow`, `TaskStop`, `TaskOutput`) reste interdit.
- Les heures facturées sont celles d'un développeur senior, jamais la durée machine de l'agent.
- Les moteurs sont les outils en ligne de commande déjà authentifiés sur le serveur : aucune clé
  facturée à l'appel.
