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
node scripts/verif-signal-attention.mjs # la secousse, le triangle et le badge bleu — et leur report sur carte / conversation
node scripts/verif-ligne-projet.mjs # la ligne d'un projet sur écran de téléphone : robot, repère unique
node scripts/verif-glissement-projets.mjs # ranger la colonne de gauche sans qu'une ligne saute
node scripts/verif-tiroir-quotas.mjs # le volet des quotas : défilement et poignée qui referme
node scripts/verif-bloc-publication.mjs # le bloc de publication repart à zéro après une mise en ligne
node scripts/verif-decoupe-hors-tache.mjs # une fonctionnalité sans carte = une branche (dépôt d'essai)
node scripts/verif-fondu-defilement.mjs # le fondu flouté en haut et en bas des zones qui défilent
node scripts/verif-vide-carte-validee.mjs # un échange court finit sous le dernier bloc, pas au-dessus d'un grand vide (démon d'essai à soi)
node scripts/verif-cerveau-reglages.mjs # l'état de la liaison au cerveau, dans l'onglet Système
node scripts/verif-outils-codex.mjs # le moteur Codex reçoit bien les outils du projet (vrai tour ; un compte refusé est dit comme tel, pas comme un outil absent)
node scripts/verif-deroule-uniforme.mjs # même demande, deux moteurs : l'instruction envoyée est-elle la même ?
node scripts/verif-reprise-modele.mjs # changer de modèle en cours de conversation ne casse plus la reprise Codex (vrais tours)
node scripts/verif-bridage-chef.mjs # le chef d'orchestre est-il bridé pareil sous les deux moteurs ? (vrai tour Codex)
node scripts/verif-description-carte.mjs # la carte proposée porte-t-elle une vraie description ? (vrai tour, deux moteurs)
node scripts/verif-glissement-lancement.mjs # glisser dans « En cours » lance, en sortir suspend (démon d'essai à soi)
node scripts/verif-mise-en-ligne.mjs # publier met-il vraiment en ligne ? (refus honnête / publication complète)
node scripts/verif-reglages-proposition.mjs # la carte proposée hérite-t-elle du moteur et du modèle de la conversation ?
node scripts/verif-reglages-carte.mjs # le détail d'une carte montre-t-il ses réglages ? (modifiables avant, figés après)
node scripts/verif-image-reponse-question.mjs # joindre une image à la réponse d'une question (démon d'essai à soi)
node scripts/verif-notifications.mjs # une seule notification par événement, groupe qui nomme ses éléments
node scripts/verif-lot-a-faire.mjs  # « Tout valider » au pied de « À faire » (démon d'essai à soi)
node scripts/verif-lot-termine.mjs  # « Tout déployer » au pied de « Terminé » (démon d'essai à soi)
node scripts/verif-lot-planifie.mjs # « Tout lancer » au pied de « Planifié » (démon d'essai à soi)
node scripts/verif-sortie-archive.mjs # sortir une carte d'« Archivé » / « À déployer » à la main (démon d'essai à soi)
node scripts/verif-arret-carte.mjs  # le bouton d'arrêt d'une carte n'arrête que SA tâche (démon d'essai à soi)
node scripts/verif-branche-de-carte.mjs # une carte lancée obtient SA branche « tache/… » ET son dossier ; deux cartes démarrent ensemble (dépôt d'essai)
node scripts/verif-pile-messages.mjs # la pile des messages courts : commandes en bas, profondeur, ouverture au survol, heure et date
node scripts/verif-pile-messages-appui.mjs # la pile des messages s'ouvre à l'appui au doigt, au survol à la souris (serveur de développement, HAIKO_PILE_URL)
HAIKODEV_DATA=/root/haikodev/data node scripts/verif-catalogue-codex.mjs # combien de modèles l'API Codex rend, combien en restent après dédoublonnage
node scripts/verif-liste-modeles.mjs # le menu du modèle montre tous les modèles du serveur, et annonce une liste de secours (démon d'essai à soi)
node scripts/nettoyer-essais.mjs    # À LANCER APRÈS : retire les cartes d'essai
node scripts/remise-en-etat-cartes-root.mjs # remet les cartes du projet Root d'accord avec son dépôt
node scripts/recaler-projet-root.mjs # le projet Root pointe sur son dépôt de travail, avec sa commande de publication
```

Un script qui corrige le tableau écrit dans `data/haikodev.db` : il montre d'abord ce qu'il ferait,
et n'écrit qu'avec `--ecrire`. Il doit être rejouable sans doubler ses annotations, et ne rien
supprimer — on déplace et on explique, on n'efface pas.

`npm test` lit `server/dist` : construire avant de tester.

Les scripts qui passent par le navigateur ont besoin d'une session : ils s'en fabriquent une
d'une heure dans la base et la retirent en partant. Les jetons de session sont stockés HACHÉS :
on n'en réutilise jamais un existant. **Ne jamais reprendre `HAIKODEV_TOKEN`** : c'est le jeton
d'un agent, PÉRIMÉ de surcroît — le neutraliser (`env -u HAIKODEV_TOKEN …`), sinon la page reste
bloquée sur « Connexion au serveur… ». De même, `HAIKODEV_URL` vaut par défaut l'application
PUBLIÉE : pour juger d'un code non publié, viser le serveur de développement.

Un point d'essai posé sur la page (`window.haikodevEssai`, `web/src/lib/client.ts`) permet de
provoquer un message court depuis un script. Il est gardé par `import.meta.env.MODE !==
'production'`, **jamais par `import.meta.env.DEV`** : cet indicateur suit `NODE_ENV`, qui vaut
« production » dans l'environnement des agents — le serveur de développement se retrouvait alors
sans son point d'essai.

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
- **Publier, c'est METTRE EN LIGNE — pas seulement fusionner** (`planDeMiseEnLigne`,
  `shared/src/mise-en-ligne.ts`). Avant de toucher au dépôt, la publication demande COMMENT le projet
  peut être servi : sa commande de publication, sinon HaikoDev lui-même, sinon le service système qui
  tourne sur son dossier (sous-dossier compris), sinon un serveur web qui sert ce dossier tel quel
  (`root * …` dans Caddy, `root …;` dans nginx). Aucun des quatre : la publication est REFUSÉE, le
  bouton s'éteint et dit ce qui manque — jamais un lot annoncé « publié » sans que rien ne parte.
  Une adresse publique qui ne répond pas, ou sept étapes toutes « ignorées », font échouer le run
  (`miseEnLigneReelle`). Chaque étape nomme ce qu'elle a fait ou pourquoi elle ne l'a pas fait.
- **Un projet se déclare sur son DÉPÔT DE TRAVAIL, jamais sur son dossier publié.** Un dossier servi
  n'est pas un dépôt git : l'agent n'y trouve aucune mémoire, n'y enregistre rien et ne peut RIEN
  prouver — la carte se clôt sur du vide. Quand le code de travail vit ailleurs que le dossier servi,
  le projet pointe sur le dépôt et porte une **commande de publication** qui installe la copie servie
  (sans elle, `planDeMiseEnLigne` refuse la mise en ligne, à raison).
- **Créer un projet, c'est le MONTER en entier**, toujours de la même façon : dossier sur le serveur,
  dépôt git sur `main`, dépôt GitHub privé créé et poussé, puis les sept fichiers de départ
  (`README.md`, `CLAUDE.md`, `AGENTS.md` qui renvoie au premier, `DOCUMENTATION.md`, `MEMOIRE.md`,
  `HISTORIQUE.md`, `.gitignore`), et enfin l'inscription dans la colonne de gauche. Rien n'est
  écrasé, une étape ratée n'arrête pas les autres et se dit dans le formulaire.
- **La carte suit les ÉTAPES RÉELLES du travail, et seul l'agent d'EXÉCUTION la déplace**
  (`shared/src/suivi-colonne.ts`). Parcours : « À faire » → (clic de validation) → « Validé » →
  (analyse rendue) → « En cours » → (exécution rendue) → « Terminé ». Un tour d'agent de rôle
  « task » qui démarre la met en « En cours » ; le même tour réussi **ET ayant réellement modifié
  le dépôt** la pose en « Terminé » ; un tour en échec ne la déplace pas. Les rôles « analysis », « orchestrator » et « deploy » portent
  aussi le numéro de carte mais ne la déplacent JAMAIS, ni au départ ni à l'arrivée — ni démarrer
  une étude ni la rendre n'est faire le travail. Le passage « Validé » → « Planifié » → « En cours »
  au lancement de l'exécution reste le geste de l'ordonnanceur ; les règles pures ne le doublent
  pas. Vrai pour TOUTE carte, d'où qu'elle vienne.
- **« Archivé » et « À déployer » ne se rouvrent que sur GESTE HUMAIN** (`repriseAutorisee`,
  `shared/src/suivi-colonne.ts`). La règle par défaut ne bouge pas : aucun chemin AUTOMATIQUE n'en
  ressort une carte — ni un tour d'agent (`colonneAuDemarrage`), ni `board_move_card`, ni une
  question posée dans la conversation, qui ne doit jamais retirer une carte du lot à publier. Un
  clic ou un glissement de l'utilisateur, lui, le peut : bouton dédié dans le tiroir
  (`gesteCarte('reprendre', …)`), même ligne dans le menu des gestes rares, et glisser-déposer.
  D'un geste, la carte retombe à l'étape juste avant (`colonneDeReprise` : « Archivé » → « À faire »,
  « À déployer » → « Terminé ») ; toute autre colonne reste atteignable à la main. La carte GARDE sa
  trace : `card.archivedAt` est posée à l'archivage, survit à la sortie, et s'affiche en clair
  (`mentionArchivage`) sur la carte du tableau et dans son tiroir. Verrouillé par
  `server/src/test/suivi-colonne.test.ts` et `scripts/verif-sortie-archive.mjs`.
- **Le dépôt d'une carte à la main VAUT un geste** (`effetDuDepot`, `shared/src/suivi-colonne.ts`).
  Déposer dans « En cours » = cliquer sur « Lancer maintenant » : le serveur appelle `startCard`, le
  MÊME point d'entrée — mêmes portes dures, même branche, même agent, même trace. Aucun chemin
  parallèle. Un refus REMONTE : la carte revient à sa colonne et la raison s'affiche, jamais un
  déplacement silencieux qui ne lance rien. Sortir de « En cours » vers « Planifié » = SUSPENDRE :
  le tour est arrêté, la carte reste en file avec `scheduling.suspendu`, et l'ordonnanceur ne la
  reprend plus tout seul — seul un geste (bouton, ou nouveau dépôt en « En cours ») efface la
  marque. C'est la SEULE sortie permise pendant que l'agent écrit ; toutes les autres restent
  refusées (`sortieAutorisee`).
- **Le bouton d'arrêt d'une carte n'arrête que SA tâche** (`arretDeCarteAutorise`,
  `shared/src/arret-carte.ts`). Le tiroir choisit son agent par replis successifs et peut retomber
  sur celui d'une AUTRE carte : la bande « en cours » n'affiche donc son bouton que si l'agent visé
  porte le numéro de la carte ouverte — pas de bouton plutôt qu'un faux. `agent.stop` emporte le
  `cardId` d'où part le geste et le démon rejoue la MÊME règle : un agent étranger à la carte est
  REFUSÉ, et le refus s'affiche au lieu de passer en silence. Un arrêt accepté coupe aussi ce qui
  attendait derrière — la file de l'agent est vidée (`clearQueue`) et la carte prend
  `scheduling.suspendu` avec `RAISON_ARRETE_A_LA_MAIN`, donc l'ordonnanceur ne la reprend plus tout
  seul (seul un lancement efface la marque). Sans carte annoncée (conversation du chef, arrêt groupé
  de la barre de quota), rien ne change. Verrouillé par `server/src/test/arret-carte.test.ts` et
  `scripts/verif-arret-carte.mjs`.
- **L'arrêt s'atteint AUSSI depuis la barre d'écriture** (`boutonsBarreEcriture`,
  `shared/src/arret-carte.ts`). Dans un fil long, la bande « en cours » sort de l'écran : tant qu'un
  agent travaille, la flèche d'envoi devient un carré d'ARRÊT, au même endroit et à la même taille,
  et redevient la flèche en fin de tour. Du texte en cours de saisie garde son envoi — l'arrêt se
  pose à CÔTÉ, jamais par-dessus une phrase écrite ; la modification d'un message en attente garde
  le bouton pour elle. Le geste est écrit UNE seule fois (`useArretAgent`,
  `web/src/components/arret-agent.tsx`), et la bande du haut comme la barre du bas y passent : même
  `arretDeCarteAutorise`, même `agent.stop` avec le `cardId`, même confirmation au-delà de cinq
  minutes — durée relue AU CLIC, la barre ne se redessinant pas chaque seconde. Arrêt non permis =
  aucun bouton, aux deux endroits.
- **Les portes DURES valent pour tous les chemins de lancement** (`portesDures`,
  `server/src/scheduler.ts`) : plus de place sur la machine, plus un seul compte disponible, projet
  qui n'est pas un dépôt git, dossier de travail déjà occupé par une autre carte. `startCard` les
  contrôle, donc l'ordonnanceur comme le bouton comme le glissement, et un refus s'ÉCRIT sur la
  carte (`waitingReason`) au lieu de disparaître. L'heure creuse, elle, n'est PAS une porte dure :
  c'est une politique d'économie que l'ordonnanceur seul applique (`checkGates`), et qu'un geste
  humain passe.
- **Une carte lancée a TOUJOURS sa branche « tache/… », et le dossier pour elle seule**
  (`shared/src/branche-de-carte.ts`). `nomDeBranche` fabrique le nom ; `porteDuDepot` refuse un
  projet qui n'est pas un dépôt git — c'est le silence « pas un dépôt, l'agent travaille sur place »
  qui laissait partir des agents sur `main`, sans branche et sans rien à prouver ; `porteDuDossier`
  refuse une seconde carte visant le MÊME dossier — deux basculements de branche dans la même copie
  de travail se volent les fichiers. La carte refusée n'échoue pas : elle attend en disant pourquoi.
  `prepareBranch` ne rend donc plus que « prête » ou « échec » — plus de troisième cas muet — et le
  prompt de la carte nomme toujours sa branche ET son dossier. Verrouillé par
  `server/src/test/branche-de-carte.test.ts` et `scripts/verif-branche-de-carte.mjs`.
- **Chaque carte travaille dans SA copie du dépôt, ouverte par `git worktree`**
  (`shared/src/dossier-de-carte.ts` pour les règles, `server/src/dossier-de-carte.ts` pour git). Au
  lancement, `ouvrirDossierDeCarte` pose la carte dans `<projet>/.worktrees/<nom de branche>` sur sa
  branche « tache/… » ; le chemin est retenu sur l'agent (`Agent.workdir`) et sert de dossier au
  moteur, au repère d'avant tour et au constat de fin. Plusieurs cartes d'un même projet démarrent
  donc en parallèle, dans la limite des places et des quotas, et le dossier principal ne change plus
  jamais de branche. En fin de tour, `refermerDossierDeCarte` fusionne la branche dans la principale
  (jamais poussée : la mise en ligne reste un geste de l'utilisateur) puis retire la copie ; un tour
  suivant la ROUVRE sur la même branche. Trois refus, tous dits : travail non enregistré dans la
  copie (elle est gardée telle quelle), dossier principal qui n'est pas sur sa branche principale,
  conflit de fusion — ce dernier revient à la publication. Le rangement `.worktrees/` est écarté par
  le fichier d'exclusion LOCAL du dépôt, jamais par son `.gitignore`, et les copies laissées
  ouvertes par un démon tué sont refermées au démarrage (`menageDesDossiers`, branches « tache/… »
  seulement). Verrouillé par `server/src/test/dossier-de-carte.test.ts` et
  `scripts/verif-branche-de-carte.mjs`.
- **Une carte qui retravaille ne reste pas en « Terminé ».** La règle est unique
  (`colonneAuDemarrage`) et vit dans UNE fonction du démon, `replacerCarteAuDemarrage`
  (`server/src/runtime.ts`), appelée aux deux seuls points par lesquels un tour peut naître :
  l'écriture de la demande (`sendPrompt`, qui doit annoncer la bonne colonne à l'agent) et le
  départ réel du moteur (`startTurn`, par lequel passe TOUT tour). Un chemin de relance — bouton,
  dépôt dans « En cours », message écrit, message en file, réponse à une question, reprise après
  pause — ne peut donc pas laisser une carte affichée « Terminé » pendant que le moteur écrit ;
  la date de clôture et la phrase « rien n'a changé » sont effacées au départ. Symétriquement, un
  tour ne clôt une carte que s'il est ENCORE le sien (`tourDeLaCarte`,
  `shared/src/suivi-colonne.ts`) : un tour arrêté rend la main à son rythme et ne doit rien écrire
  sur une carte reprise depuis par un autre agent. Verrouillé par
  `server/src/test/relance-carte.test.ts`.
- **Pas de code modifié, pas de « Terminé ».** C'est le CONSTAT du dépôt qui clôt une carte, jamais
  le fait que le moteur ait répondu. Le démon prend UN SEUL repère avant le tour (`repereAvant`,
  `server/src/hors-tache.ts`) et le relit après (`depotModifieDepuis` : un enregistrement de plus,
  ou des fichiers modifiés) ; le constat est passé à `colonneEnFinDeTour(colonne, réussi, rôle,
  depotModifie)`. Sans modification, la carte reste où elle est et porte la raison en toutes lettres
  (`raisonSansModification` → champ `sansModification`, affiché sur la carte du tableau). Le lot à
  publier se remplissant depuis « Terminé », rien à publier = rien dans le lot. Sans repère (projet
  hors git), le constat vaut `true` : on ne retient pas une carte sur une observation impossible.
- **TOUTE demande de PROGRAMMATION passe par une carte** — nouvelle fonctionnalité, correction,
  suppression, changement de comportement, retouche d'interface, script, réglage : aucune exception,
  quelle que soit la taille. Le chef PROPOSE la carte et s'arrête là ; c'est l'agent de cette carte
  qui fait le travail, pour que l'avancement se voie du début à la fin sur le tableau. **Vrai aussi
  sur HaikoDev** : les outils d'écriture du chef ne dispensent pas de la carte. Une simple question
  se répond dans la conversation, sans carte. Verrouillé par `server/src/test/tri-du-chef.test.ts`.
- **Une demande d'EXÉCUTION devient une carte, exactement comme une demande de programmation**
  (cas 3 du tri, `rolePrompt` dans `server/src/runtime.ts`). Lancer une commande, tester une
  connexion, ouvrir un terminal, faire tourner un contrôle ou un script, redémarrer un service,
  lire un journal en direct : le chef PROPOSE aussitôt la carte avec `board_create_card`, dont la
  description dit quoi lancer et quel résultat on attend. Il ne demande aucune confirmation avant de
  proposer et n'écrit pas un paragraphe sur ses propres limites — une phrase suffit pour dire qu'un
  agent de tâche exécutera. Le bridage du chef (liste blanche `orchestratorAllowList`,
  `server/src/tools.ts`) ne bouge PAS : il n'est simplement plus une fin de non-recevoir. Règle
  portée par le texte unique de la consigne, donc valable pour Claude comme pour Codex. Verrouillé
  par `server/src/test/tri-du-chef.test.ts`.
- Une carte naît toujours dans « À faire », et **jamais sans un clic de l'utilisateur**.
  `board_create_card` n'écrit RIEN : comme `propose_task`, il affiche une proposition en attente dans
  la conversation, avec ses boutons valider / refuser ; la validation seule fait naître la carte, qui
  suit ensuite le parcours habituel. Seule exception : le code enregistré par un agent SANS carte
  fabrique tout seul sa fiche dans « À déployer » — le travail est déjà fait. Verrouillé par
  `server/src/test/carte-du-chef-attend-la-validation.test.ts`.
- **Une carte proposée porte une VRAIE description, ou elle n'est pas affichée**
  (`shared/src/description-carte.ts`). Quatre parties annoncées — Constat (avec au moins un repère
  concret vu dans le projet : fichier, commande, libellé, règle existante), Attendu, Limites,
  Vérification — et entre 320 et 2400 signes. `board_create_card` et `propose_task` passent tous
  deux par `jugerDescription` : une description vide, bâclée, sans constat, sans repère ou en pavé
  est REFUSÉE, rendue au moteur avec le gabarit, et le chef recommence. Les quatre champs séparés
  (`constat`, `attendu`, `limites`, `verification`) sont mis en forme par HaikoDev. La consigne
  (`CONSIGNE_DESCRIPTION_CARTE`) est unique et ne nomme aucun outil propre à un moteur. Verrouillé
  par `server/src/test/description-carte.test.ts`.
- **Une carte proposée hérite du moteur, du modèle et du niveau de réflexion de la CONVERSATION**
  (`reglagesDeLaProposition`, `shared/src/reglages-proposition.ts`). Le démon passe les réglages de
  l'agent en cours à l'outil (`ToolContext.run`), et le modèle retenu vient TOUJOURS du catalogue du
  moteur retenu (`catalogueMoteurs`, `server/src/catalogue-moteurs.ts`) : un identifiant emprunté à
  l'autre moteur est jeté, jamais traîné. Un obstacle se DIT sur la proposition (champ
  `avertissement`) au lieu de se contourner : moteur non installé, ou aucun compte disponible — dans
  ce dernier cas le moteur ne change PAS. Les trois réglages restent modifiables avant validation, et
  la validation les repasse par la même règle. Verrouillé par
  `server/src/test/reglages-proposition.test.ts`.
- **Le détail d'une carte montre avec quoi elle tourne** (`reglagesDeLaCarte`,
  `shared/src/reglages-carte.ts`). En tête de l'onglet « Détails », une ligne d'étiquettes courtes :
  moteur, modèle, niveau de réflexion, compte. Tant que rien n'a démarré (colonnes autres que
  « En cours », « Terminé », « À déployer », « Archivé », ET aucun agent de rôle « task » passé), les
  trois premiers sont des menus qui écrivent dans `card.run` ; le compte, lui, n'est pas encore
  choisi et le dit. Dès que le travail est parti, tout est FIGÉ et affiche ce qui a RÉELLEMENT servi :
  les réglages de l'agent d'exécution — jamais ceux de l'analyse, qui tourne souvent ailleurs — et le
  compte qui a porté le quota. Verrouillé par `server/src/test/reglages-carte.test.ts`.
- **On répond en IMAGES à la question d'un agent** (`shared/src/images-reponse.ts`). Le champ de
  réponse d'une question accepte des images — bouton, collage, glisser-déposer sur le bloc — et
  RIEN d'autre : `triImages` écarte le reste et le refus se dit. Les images s'affichent en vignettes
  retirables sous le champ ; `texteDeReponse` les AJOUTE au choix coché et à la précision libre, sans
  jamais les remplacer, et une image seule suffit à répondre. À la validation, elles partent avec la
  commande `question.answer`, sont retenues sur la question (`answerAttachments`, affichées à côté de
  la réponse) et l'agent reçoit leurs chemins par le même bloc « PIÈCES JOINTES » que le fil.
  Verrouillé par `server/src/test/images-reponse.test.ts`.
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
- **Le travail d'une carte finit sur la branche principale : une branche poussée n'est PAS livrée.**
  Sinon le code existe sur GitHub sans jamais rejoindre le tronc : la publication, qui installe la
  principale, ne l'emporte pas, et la carte affiche « Terminé » sur du vide. Pour une carte lancée,
  c'est le démon qui s'en charge en fin de tour (`refermerDossierDeCarte`) : l'agent enregistre et
  pousse SA branche, il ne fusionne ni ne referme rien lui-même. Un agent qui s'ouvre un dossier
  séparé DE SA PROPRE INITIATIVE, lui, reste responsable de fusionner puis de refermer
  (`git worktree remove`) avant de rendre. Piège du dossier partagé, toujours valable partout où on
  n'a pas de copie à soi : `git add -A` / `git commit -a` emporte le travail d'un autre agent dans
  son propre enregistrement — on nomme ses fichiers un par un.
- Rien de ce qui se fait ne reste invisible : chaque ligne du lot à publier a sa carte, et un projet
  dont un agent a rendu son travail porte une pastille tant que la conversation n'a pas été ouverte.
  **Deux choses secouent la ligne d'un projet** (`shared/src/signal-projet.ts`) : une décision
  attendue — triangle orange — et un travail rendu pas encore consulté — point bleu clignotant. Les
  deux comptes se comparent SÉPARÉMENT, la secousse ne joue qu'une passe, et la ligne qu'on regarde
  déjà ne bouge jamais.
- **La ligne d'un projet ne porte JAMAIS plus de deux repères**, en plus du bouton de réglages : un
  ROBOT devant le nom quand des agents travaillent (le nombre seulement à partir de deux, jamais
  d'anneau qui tourne), et UN SEUL repère d'attente à droite — `repereVisible`
  (`shared/src/signal-projet.ts`) tranche, la décision attendue (triangle orange) l'emportant sur le
  travail rendu non lu (point bleu, cliquable pour marquer comme lu). C'est l'AFFICHAGE qu'on
  réduit : les deux comptes continuent d'être calculés et de secouer la ligne séparément. Chaque
  repère dit ce qu'il veut dire en français simple (`aria-label` + infobulle).
- **Une notification n'interrompt que si elle appelle une décision ou annonce une fin**
  (`shared/src/notification-tri.ts`). Le MOTIF décide, pas la famille : sortent de l'application une
  tâche réellement terminée, un travail enregistré sans carte, un échec, une décision attendue, une
  publication finie, et le quota de la semaine (paliers 70 % puis 90 %, surconsommation annoncée).
  Tout le reste — charge machine, amorçage d'une fenêtre, fenêtre de 5 h qui s'achève, liste de
  tâches cochée, point du jour — reste DANS l'application (bannière). `notify` est le guichet unique
  (`server/src/notify.ts`) : il refuse un motif qui n'interrompt pas, applique les réglages de
  famille et les heures de silence, puis DÉDOUBLONNE sur l'identité de l'événement
  (`cleEvenement` : sujet + objet, dix minutes de mémoire) — deux endroits du code qui racontent la
  même chose ne font qu'une alerte. Un groupe de quatre secondes NOMME ses éléments
  (`resumeGroupe`), jamais un compte muet. Une carte ne se signale terminée que si elle a
  RÉELLEMENT atteint « Terminé » ou « À déployer ». Verrouillé par
  `server/src/test/notification-tri.test.ts` et `scripts/verif-notifications.mjs`.
- **Une décision attendue se voit LÀ OÙ elle se prend, pas seulement sur le projet**
  (`shared/src/decision-attendue.ts`). Chaque décision emporte son endroit — la conversation qui la
  porte, la carte quand elle est née dans son travail — et le serveur les diffuse AVEC le compte
  (`signalAttention`, événement `attention`). Le même triangle orange, jamais un nouveau genre
  d'alerte (`RepereAttention`), se pose alors sur la carte du tableau, sur l'onglet « Conversation »
  de son tiroir, et sur l'entrée « Chef » quand aucune carte n'est en jeu. Une décision est marquée à
  UN seul endroit : c'est ce qui garantit que le compte annoncé vaut le nombre de repères visibles —
  jamais quatre annoncés et rien de visible. Le triangle du projet EMMÈNE à la plus ancienne décision
  en attente. Verrouillé par `server/src/test/decision-attendue.test.ts` et
  `scripts/verif-signal-attention.mjs`.
- **Un pied de colonne agit en LOT, toujours en deux temps et toujours par le même mécanisme**
  (`ACTIONS_DE_LOT`, `web/src/components/board.tsx`). Premier clic : une case à cocher sort du coin
  haut-gauche de chaque carte, TOUTES cochées, et le pied devient « Annuler » / « <verbe> (n) ».
  Annuler ne touche à rien ; confirmer déplace les cartes restées cochées vers la colonne `cible`,
  une par une, par `client.moveCard` — le MÊME appel que le bouton du tiroir. Une seule colonne en
  sélection à la fois, et pas de pied sur une colonne vide. Quatre entrées aujourd'hui : « À faire » →
  « Tout valider » vers « Validé », « Planifié » → « Tout lancer » vers « En cours », « Terminé » →
  « Tout déployer » vers « À déployer » (déplacement seul, RIEN n'est mis en ligne), « À déployer » →
  « Tout archiver » vers « Archivé ». Un pied suit le parcours de la carte : on n'archive jamais
  par-dessus l'étape de publication. « Tout lancer » n'a AUCUN chemin à lui : le dépôt en « En cours »
  valant déjà le clic sur « Lancer maintenant », le serveur passe par `startCard` — portes dures
  comprises — et une carte refusée revient à « Planifié » avec sa raison pendant que le lot continue.
  Ajouter une colonne, c'est ajouter une ligne à cette liste — jamais un second mécanisme. Vérifié par
  `scripts/verif-lot-a-faire.mjs`, `scripts/verif-lot-termine.mjs` et `scripts/verif-lot-planifie.mjs`.
- **Un lot va jusqu'à la DERNIÈRE carte et rend des comptes** (`bilanDeLot`,
  `shared/src/lot-colonne.ts`). Chaque carte est tentée dans son propre `try` : un refus — le plus
  courant, `porteDuDossier` quand un agent travaille déjà dans le dossier — n'arrête pas les
  suivantes, qui doivent toutes recevoir leur `waitingReason`. Le lot appelle `client.moveCard` en
  mode `silencieux` (pas une bulle par carte) et publie UN compte rendu : combien de cartes
  déplacées, combien en attente, et chaque refusée NOMMÉE avec sa raison (trois au plus, le reste
  annoncé). Rien passé = message rouge, lot partiel = orange. Le pied se referme dans tous les cas.
  Corollaire côté client : **la retombée optimiste ne remet JAMAIS la vieille copie de la carte** —
  le serveur vient d'y écrire la raison de l'attente, on ne rend que la COLONNE sur la version la
  plus fraîche, sinon la carte revient sans un mot. Verrouillé par
  `server/src/test/lot-colonne.test.ts` et `scripts/verif-lot-planifie.mjs`.
- Une carte lancée a sa copie de travail à elle ; le dossier du projet, lui, reste **partagé** (chef
  d'orchestre, analyse, publication) : vérifier la branche avant de modifier, puis committer ses
  fichiers **nommés un par un** — jamais `git add -A`.
- Un agent de tâche travaille en accès complet ; le chef d'orchestre ne modifie aucun fichier
  existant (sauf sur HaikoDev lui-même).
- Le tableau ne glisse que de gauche à droite, une colonne que de haut en bas. Un axe en `auto`
  entraîne l'autre : le rail doit dire `overflow-y-hidden` en toutes lettres.
- **Toute zone qui défile passe par `ZoneDefilement`** (`web/src/components/ui`) : elle bloque le
  second axe et pose le fondu flouté aux deux bords. Pas de `overflow-y-auto` posé à la main, et pas
  de filet (`border-t` / `border-b`) au bord d'une zone à fondu — le fondu EST la limite.
- **Un fil de conversation est COLLÉ EN BAS quand il ne remplit pas l'écran**
  (`web/src/components/chat.tsx`). Les messages vivent dans un bloc unique, `shrink-0`, posé
  `mt-auto` dans la zone qui défile : un échange court — une phrase du chef et sa carte proposée —
  se termine juste au-dessus du volet des tâches au lieu de laisser un demi-écran noir. Le
  `shrink-0` n'est pas décoratif : sans lui, un fil trop long serait comprimé au lieu de défiler.
  On n'emploie PAS `justify-end` sur la zone elle-même — il rend le haut du fil inatteignable. Le
  fil porte `data-fil="conversation"`, seul repère des scripts de vérification. Verrouillé par
  `scripts/verif-vide-carte-validee.mjs`.
- **Les messages courts s'EMPILENT, et les commandes ferment le bloc**
  (`shared/src/pile-messages.ts`, `web/src/components/agent-dock.tsx`). Dans le bloc en bas à
  droite, l'ordre est : messages, puis vignettes d'agents, puis la rangée de commandes (poignée de
  déplacement, « Annuler », « Replier », « Tout effacer ») — ce qu'on lit passe devant ce qui sert à
  ranger. Les messages ne se posent plus les uns sous les autres : `placeDansLaPile` les empile, le
  plus récent devant, les autres alignés par le BAS puis poussés de `PILE_DECALAGE` pixels, un peu
  plus petits et plus pâles ; trois se voient (`PILE_VISIBLES`), le reste est compté
  (`resteDeLaPile`). La pile fermée n'occupe donc que la place d'un message, quel qu'en soit le
  nombre. Au survol — ou à l'appui, au doigt — elle s'ouvre en liste complète en `PILE_DUREE`
  millisecondes, et se referme pareillement. Chaque message porte son heure et sa date sous son
  texte (`heureEtDate`, depuis `Toast.at`). La géométrie a besoin des hauteurs RÉELLES : elles se
  mesurent au rendu, jamais en dur. Verrouillé par `server/src/test/pile-messages.test.ts` et
  `scripts/verif-pile-messages.mjs`.
- **La pile s'ouvre au SURVOL à la souris, à l'APPUI au doigt**
  (`shared/src/ouverture-pile.ts`). Le choix se fait sur la CAPACITÉ DU POINTEUR
  (`REQUETE_SURVOL`, `(hover: hover) and (pointer: fine)`), jamais sur la largeur de l'écran : une
  tablette large n'a pas plus de survol qu'un téléphone. Au doigt, le premier appui SERT à déployer
  et n'emporte pas l'action du message de devant (`appuiDeclencheLAction`, retenu en phase de
  CAPTURE) ; un second appui, ou un appui ailleurs sur l'écran, referme. À la souris, un clic
  n'ouvre ni ne referme rien — sinon la pile battrait sous un curseur immobile. Les cibles au doigt
  font 32 px de côté, la marge négative rendant au message sa taille. Combien de messages se voient
  pile fermée reste l'affaire de l'empilement (`PILE_VISIBLES`, règle ci-dessus) : `messagesMontres`
  et `resteAVoir` ne servent plus l'affichage. Verrouillé par
  `server/src/test/ouverture-pile.test.ts` et `scripts/verif-pile-messages-appui.mjs`.
- **Le fondu est réservé au défilement VERTICAL**, le seul où le texte glisse derrière un en-tête ou
  une barre. En `axe="horizontal"` (rail du tableau, barres d'onglets), `ZoneDefilement` ne pose
  AUCUN voile : il masquerait le bord des colonnes sans rien apprendre. L'option reste, car c'est
  elle qui écrit `overflow-y-hidden` en toutes lettres et empêche le tableau de flotter.
- **Un fichier d'instructions qui ne fait que RENVOYER à un autre est suivi, jamais nommé**
  (`instructionsQuiFontFoi`, `shared/src/instructions-projet.ts`). Chaque moteur a son fichier natif
  (Codex : `AGENTS.md`, Claude : `CLAUDE.md`), mais à la création d'un projet `AGENTS.md` ne fait que
  pointer vers `CLAUDE.md` : un agent Codex recevait deux lignes vides de sens. Le briefing résout
  donc le renvoi — un corps de trois lignes au plus, sous 600 signes, qui cite un seul autre fichier
  d'instructions —, nomme le fichier POINTÉ, dit en clair que l'autre n'est qu'un renvoi, et c'est ce
  fichier-là que la consigne de fin de tâche demande de tenir à jour. Chaîne suivie sans boucler ;
  renvoi vers un fichier absent non suivi ; rien n'est écrit ni supprimé, la règle des sept fichiers
  de départ ne bouge pas. Verrouillé par `server/src/test/instructions-projet.test.ts`.
- **Les outils du projet se branchent différemment selon le moteur.** Claude Code reçoit un FICHIER
  de configuration (`--mcp-config`) ; Codex reçoit la COMMANDE à lancer, donc le chemin du pont
  lui-même (`server/mcp-bridge.mjs`), jamais le fichier de configuration — `node fichier.json` sort
  aussitôt sans rien dire et la liste d'outils reste vide. Codex exige en plus
  `mcp_servers.haikodev.default_tools_approval_mode="approve"` : sans ce mode, chaque appel demande
  une approbation que personne ne donne et le moteur rend « user cancelled MCP tool call ».
  Verrouillé par `server/src/test/outils-codex.test.ts`.
- **Un modèle est unique par son IDENTIFIANT, et une liste de secours se DIT**
  (`shared/src/catalogue-modeles.ts`). Le catalogue d'un moteur était dédoublonné sur le NOM AFFICHÉ :
  deux modèles réellement différents portant le même `display_name` se mangeaient l'un l'autre, et
  l'utilisateur ne voyait qu'une partie de ce que son compte lui offre. `dedoublonnerModeles` garde
  donc un modèle par identifiant, dans l'ordre du tri (`byRecency` ne bouge pas), et distingue les
  homonymes survivants par leur identifiant, posé en repère (`ModelInfo.note`). Symétriquement, quand
  le catalogue n'a pas pu être lu, `codexCatalog` / `claudeCatalog` remontent la cause
  (`EngineInfo.catalogError`, en FRANÇAIS : « compte refusé, il faut le reconnecter ») et le menu de
  choix du modèle l'affiche en tête (`messageDeRepli`) — jamais une liste de deux entrées écrites en
  dur qui passe pour la liste complète. Verrouillé par `server/src/test/catalogue-modeles.test.ts`,
  `scripts/verif-catalogue-codex.mjs` et `scripts/verif-liste-modeles.mjs`.
- **Un script de vérification vise le dépôt d'où il PART**, jamais `/root/haikodev` écrit en dur :
  lancé depuis une copie de travail (`.worktrees/…`), il jugerait sinon le code du dossier principal
  et déclarerait bon un changement jamais exécuté. La racine se déduit de `import.meta.url`.
- **Le fil retenu appartient au moteur, et sous Codex au MODÈLE qui l'a ouvert**
  (`cleDeSession`, `shared/src/reprise-moteur.ts`). `codex exec resume` refuse un fil enregistré
  avec un autre modèle (« This session was recorded with model `X` but is resuming with `Y` ») ; le
  démon rangeait pourtant le fil par moteur seulement, donc tout changement légitime — réglage,
  compte, modèle rendu par le catalogue — sortait une erreur. La clé vaut désormais `codex@<modèle>`
  (`codex@defaut` sans modèle imposé) et reste `claude` pour Claude, dont la reprise ne proteste
  jamais. Un modèle différent ouvre simplement un fil NEUF ; l'ancienne clé `codex` n'est plus lue,
  donc les fils Codex en cours repartent une fois de zéro. `store.getSessionId` /
  `setSessionId` prennent cette clé, calculée au même endroit pour la lecture et l'écriture.
  Verrouillé par `server/src/test/reprise-moteur.test.ts` et `scripts/verif-reprise-modele.mjs`.
- **Le chef d'orchestre est bridé DE LA MÊME FAÇON sous les deux moteurs**
  (`shared/src/bridage-chef.ts`). Les deux listes (`orchestratorAllowList` /
  `orchestratorDenyList`) sont calculées pour tout moteur, hors du projet HaikoDev lui-même ; encore
  faut-il qu'elles ARRIVENT. Claude Code les prend telles quelles (`--allowedTools` /
  `--disallowedTools`, `buildClaudeArgs`) ; Codex n'a pas de liste d'outils en ligne de commande et
  les IGNORAIT — le même chef y écrivait des fichiers. `surchargesCodexDuChef` les traduit donc en
  surcharges de configuration : outils du projet énumérés
  (`mcp_servers.haikodev.enabled_tools` / `disabled_tools`), bac à sable en `read-only` (ce qui
  remplace l'interdiction nominative de `Write`, `Edit` et `Bash`), `approval_policy="never"` pour
  qu'une écriture refusée ÉCHOUE au lieu d'attendre une approbation que personne ne donne, et
  travaux de fond éteints (`features.multi_agent…`). Un chef bridé n'ouvre JAMAIS le bac à sable,
  même en reprise ; un agent de tâche, lui, garde son accès complet dans les deux moteurs.
  Verrouillé par `server/src/test/bridage-chef.test.ts` et `scripts/verif-bridage-chef.mjs`.
- **Les outils du projet sont les SEULS dans la pièce, et leur absence se DIT**
  (`shared/src/pont-outils.ts`). Un autre serveur d'outils branché dans la configuration de Codex
  propose souvent sa propre mémoire : le modèle l'appelait à la place de `project_memory`, annonçait
  « mémoire consultée » et énonçait des faits jamais lus. `buildCodexArgs` éteint donc, LE TEMPS D'UN
  TOUR, chaque serveur étranger trouvé dans la `config.toml` du compte (`serveursTiers` +
  `serveursTiersDuCompte`, `-c mcp_servers.<nom>.enabled=false`) ainsi que la mémoire propre du
  moteur (`-c features.memories=false`) — la configuration de l'utilisateur n'est pas touchée.
  Symétriquement, le pont s'ANNONCE : il appelle `/internal/pont` à la poignée de main et le démon
  compte les outils servis par `/internal/tools` (registre `server/src/pont.ts`). En fin de tour,
  `etatDuPont` tranche — pont jamais démarré, liste jamais demandée, liste vide — et la panne
  s'affiche en étape ROUGE dans la conversation au lieu de se taire. Un moteur qui n'a rien fait du
  tout (compte refusé) n'écope pas de ce motif : sa panne est déjà dite. Verrouillé par
  `server/src/test/pont-outils.test.ts` et `scripts/verif-outils-codex.mjs`.
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
- **Aucun agent ne commente le stockage des identifiants** (point 5 de `METHODE`). Mots de passe,
  clés, jetons et fichiers d'identifiants gardés dans le projet sont un choix ASSUMÉ de
  l'utilisateur : aucun agent — chef, analyse, exécution, publication — ne le signale, ne le
  commente ni ne recommande quoi que ce soit à ce sujet, ni en réponse, ni dans une carte proposée,
  ni en alerte. Consigne de SILENCE, pas de sécurité : rien ne change à la façon dont ces fichiers
  sont stockés, lus ou protégés, et une PANNE se dit toujours (identifiant absent, expiré ou refusé
  qui bloque un travail). Le rappel de méthode la reprend. Verrouillé par
  `server/src/test/silence-identifiants.test.ts`.
- **Un moteur qui ne recolle pas sa consigne système la reçoit en rappel.** Claude Code repasse
  `--append-system-prompt` à chaque tour ; Codex n'a la sienne qu'au premier message du fil, donc
  toute reprise part avec `systemPromptRappel` (`rappelDeMethode`) devant la demande — le pavé
  entier, lui, ne repart jamais. Sans ce rappel, le déroulé s'effaçait d'un moteur et pas de l'autre.
- La liste de tâches (`TodoWrite`, `TaskCreate`/`TaskUpdate`, `TaskList`, `TaskGet`) est
  AUTORISÉE même au chef d'orchestre bridé : elle n'écrit rien, elle affiche le déroulé. Lancer un
  travail en arrière-plan (`Task`, `Agent`, `Workflow`, `TaskStop`, `TaskOutput`) reste interdit.
- **Un rythme qui s'écarte brusquement de l'habitude se dit tout de suite**
  (`emballementConsommation` et `doitAlerterEmballement`, `shared/src/quota.ts`). Le rythme des
  derniers relevés est comparé à l'ATTENDU de ces mêmes tranches selon le profil mesuré ; au-delà de
  trois fois l'attendu sur au moins deux relevés d'affilée, et au moins 1 % consommé, une
  notification `quota-emballement` part par le guichet unique `notify`. Une seule alerte par
  emballement : c'est le DÉPART de la série qui sert de marque (retenue dans
  `quota.alerte.emballement`, donc un redémarrage n'en refait pas une), et seul un retour à la
  normale redonne droit à la suivante. Sans profil (`profilHoraire` rend `null`), sur la fenêtre de
  cinq heures, ou sur des relevés vieux de plus d'une heure : rien. On prévient, on ne décide pas —
  aucun agent arrêté, aucune bascule de compte. Verrouillé par
  `server/src/test/quota-emballement.test.ts`.
- **La prévision d'épuisement du quota hebdomadaire suit un profil MESURÉ, de SEMAINE**
  (`profilSemaine` / `profilHoraire` / `profilRetenu`, `shared/src/quota.ts`) : le rythme de chaque
  tranche se déduit de l'historique des relevés, jamais d'heures écrites dans le code. Le profil de
  semaine tient 48 tranches — 24 heures pour les jours ouvrés, 24 pour le week-end — pour qu'un
  samedi 15 h ne soit plus versé dans la même case qu'un mardi 15 h ; la projection lit la tranche
  du régime du jour qu'elle TRAVERSE. La moyenne est ramenée à 1 en pesant une tranche de jour
  ouvré 5 fois et une de week-end 2 fois : sur une semaine entière le profil ne change donc rien au
  total, il ne fait que déplacer l'heure d'épuisement. `profilRetenu` prend la semaine si elle tient
  debout, sinon la journée type (24 tranches). Il ne s'applique QU'À la semaine : une fenêtre de
  cinq heures ne traverse pas de nuit. Sans 24 h d'observation, sans 3 points de % consommés, ou
  avec une tranche jamais observée — donc sans un week-end ET un jour ouvré complets pour les 48 —
  il rend `null` et l'on retombe sur le profil de journée, puis sur le simple prolongement de la
  pente.
- **L'historique des quotas est RÉSUMÉ, jamais effacé** (`shared/src/quota-resume.ts`,
  `compacterQuotaSamples` dans `server/src/store.ts`). Le détail des relevés (un par quart d'heure)
  tient quatorze jours — c'est ce que la courbe du volet affiche ; au-delà, il est remplacé par une
  ligne par jour et par heure (temps observé, % consommé) qui, elle, tient deux mois. Le compactage
  garde le dernier relevé passé sous le seuil comme ANCRE, ce qui le rend rejouable sans rien doubler
  ni perdre l'intervalle à cheval. Le profil se calcule sur `historiquePourProfil` (résumé remis en
  relevés, puis détail récent) ; la pente du moment, elle, ne se mesure que sur le détail.
- **Le profil mesuré se MONTRE, en une ligne sous la courbe du compte**
  (`trancheLaPlusChargee`, `shared/src/quota.ts`) : la plage la plus chargée de la journée et son
  écart à la moyenne, « le plus chargé entre 8 h et 12 h, environ 35 % de plus que la moyenne ». La
  plage part de l'heure la plus forte et grandit tant que la voisine tient au-dessus de
  `SEUIL_TRANCHE_CHARGEE`, sans dépasser `TRANCHE_LARGEUR_MAX` — une pointe de seize heures
  n'apprendrait rien. Elle se TAIT sans profil et quand aucune tranche ne dépasse le seuil.
  Verrouillé par `server/src/test/quota-prevision.test.ts` et `scripts/verif-prevision-quota.mjs`.
- Les heures facturées sont celles d'un développeur senior, jamais la durée machine de l'agent.
- Les moteurs sont les outils en ligne de commande déjà authentifiés sur le serveur : aucune clé
  facturée à l'appel.
