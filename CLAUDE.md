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

```bash
npm test                            # tous les tests du démon (compilés dans server/dist)
node scripts/mesure-jetons.mjs      # ce qui part au moteur, avant / après
node scripts/verif-memoire-agent.mjs # un vrai agent va-t-il chercher un fait détaillé ?
node scripts/verify-ui.mjs          # l'interface dans un vrai navigateur
node scripts/verif-tableau-de-bord.mjs # la page « Tableau de bord » (serveur de développement ; la commande `stats.dashboard` est simulée côté navigateur, le démon en service ne la connaissant pas encore)
node scripts/verif-prevision-quota.mjs # la prévision d'épuisement, dans le volet des quotas
node scripts/verif-defilement-tableau.mjs # les axes de défilement du tableau, sur écran de téléphone
node scripts/verif-volet-taches.mjs # le volet des tâches, fixe en bas de la conversation
node scripts/verif-heure-permanente.mjs # l'heure sous les messages, sombre / clair / téléphone
node scripts/verif-signal-attention.mjs # la secousse, le triangle et le badge bleu — et leur report sur carte / conversation
node scripts/verif-onglets-tableau.mjs # le repère sur les onglets du tableau (téléphone) : triangle décision / point bleu non lu (serveur de développement, HAIKO_ONGLETS_URL)
node scripts/verif-carte-sans-suite.mjs # « tour terminé sans suite » sur une carte figée en « En cours » (serveur de développement, HAIKO_SANS_SUITE_URL)
node scripts/verif-progression-taches.mjs # l'avancement « n/N faites » dans le décroché des cartes « En cours » (serveur de développement, HAIKO_PROGRESSION_URL)
node scripts/verif-ligne-projet.mjs # la ligne d'un projet sur écran de téléphone : robot, repère unique
node scripts/verif-glissement-projets.mjs # ranger la colonne de gauche sans qu'une ligne saute
node scripts/verif-tiroir-quotas.mjs # le volet des quotas : défilement et poignée qui referme
node scripts/verif-interrupteur-compte.mjs # l'interrupteur d'un compte au doigt puis à la souris (serveur de développement, HAIKO_INTERRUPTEUR_URL ; aucun vrai compte touché)
node scripts/verif-tiroir-carte-telephone.mjs # le tiroir d'une carte épuré sur téléphone : tags repliés derrière un chevron, barre d'onglets cachée au défilement (serveur de développement, HAIKO_TIROIR_URL)
node scripts/verif-bloc-publication.mjs # le bloc de publication repart à zéro après une mise en ligne
node scripts/verif-envoi-surveille.mjs # un projet « se déploie sur envoi » fait attendre avant tout envoi (démon et dépôt d'essai à soi, HAIKODEV_VERIF_PORT)
node scripts/verif-environnements-publication.mjs # plusieurs environnements par projet : ajout dans les réglages, apparition dans le bloc de publication (serveur de développement, HAIKO_ENVS_URL ; `project.update` et `deploy.check` interceptés, aucun projet réel touché)
node scripts/verif-decoupe-hors-tache.mjs # une fonctionnalité sans carte = une branche (dépôt d'essai)
node scripts/verif-fondu-defilement.mjs # le fondu flouté en haut et en bas des zones qui défilent
node scripts/verif-vide-carte-validee.mjs # un échange court finit sous le dernier bloc, pas au-dessus d'un grand vide (démon d'essai à soi)
node scripts/verif-cerveau-reglages.mjs # l'état de la liaison au cerveau, dans l'onglet Système
node scripts/verif-erreurs-interface.mjs # une erreur de la page remonte-t-elle au serveur, puis dans les réglages ? (démon d'essai à soi, HAIKO_ERREURS_PORT ; pannes VOLONTAIRES, aucune donnée réelle)
node scripts/verif-outils-codex.mjs # le moteur Codex reçoit bien les outils du projet (vrai tour ; un compte refusé est dit comme tel, pas comme un outil absent)
node scripts/verif-deroule-uniforme.mjs # même demande, deux moteurs : l'instruction envoyée est-elle la même ?
node scripts/verif-reprise-modele.mjs # changer de modèle en cours de conversation ne casse plus la reprise Codex (vrais tours)
node scripts/verif-bridage-chef.mjs # le chef d'orchestre est-il bridé pareil sous les deux moteurs ? (vrai tour Codex)
node scripts/verif-description-carte.mjs # la carte proposée porte-t-elle une vraie description ? (vrai tour, deux moteurs)
node scripts/verif-glissement-lancement.mjs # glisser dans « En cours » lance, en sortir suspend (démon d'essai à soi)
node scripts/verif-mise-en-ligne.mjs # publier met-il vraiment en ligne ? (refus honnête / publication complète)
node scripts/verif-reparation-construction.mjs # une construction cassée est-elle réparée puis rejouée, et le refus final nomme-t-il la cause ? (agent de secours simulé, aucun quota dépensé)
node scripts/verif-reglages-proposition.mjs # la carte proposée hérite-t-elle du moteur et du modèle de la conversation ?
node scripts/verif-reglages-carte.mjs # le détail d'une carte montre-t-il ses réglages ? (modifiables avant, figés après)
node scripts/verif-image-reponse-question.mjs # joindre une image à la réponse d'une question (démon d'essai à soi)
node scripts/verif-notifications.mjs # une seule notification par événement, groupe qui nomme ses éléments
node scripts/icones-notifications.mjs # refabrique les six images des notifications (web/public/notif/)
node scripts/verif-icones-notifications.mjs # les six images, dans un vrai navigateur (serveur de développement, HAIKO_ICONES_URL)
node scripts/verif-lot-a-faire.mjs  # « Tout valider » au pied de « À faire » (démon d'essai à soi)
node scripts/verif-lot-termine.mjs  # « Tout déployer » au pied de « Terminé » (démon d'essai à soi)
node scripts/verif-lot-planifie.mjs # « Tout lancer » au pied de « Planifié » (démon d'essai à soi)
node scripts/verif-lot-production.mjs # la colonne « En production » : place, pieds de lot des deux colonnes, onglet téléphone (démon d'essai à soi)
node scripts/verif-sortie-archive.mjs # sortir une carte d'« Archivé » / « À déployer » à la main (démon d'essai à soi)
node scripts/verif-arret-carte.mjs  # le bouton d'arrêt d'une carte n'arrête que SA tâche (démon d'essai à soi)
node scripts/verif-branche-de-carte.mjs # une carte lancée obtient SA branche « tache/… » ET son dossier ; deux cartes démarrent ensemble (dépôt d'essai)
node scripts/verif-menu-bas-telephone.mjs # le menu flottant du bas, sur écran de téléphone (serveur de développement, HAIKO_MENU_URL)
node scripts/verif-pile-messages.mjs # la pile des messages courts : commandes en bas, profondeur, ouverture au survol, heure et date
node scripts/verif-pile-messages-appui.mjs # la pile des messages s'ouvre à l'appui au doigt, au survol à la souris (serveur de développement, HAIKO_PILE_URL)
node scripts/verif-module-voix.mjs  # le module de voix se métamorphose : rond au repos, panneau au survol/appui, bloc d'ondes en parlant (serveur de développement, HAIKO_VOIX_URL)
node scripts/verif-position-voix.mjs # le module de voix se tire à la souris et au doigt, sa place revient au rechargement et dans une autre fenêtre (serveur de développement, HAIKO_VOIX_URL)
node scripts/verif-reveil-vocal.mjs # l'écoute permanente : interrupteur, réveil « Dis Haiko », ondes rouges, relecture puis envoi, « Annule » et clic (serveur de développement, HAIKO_REVEIL_URL ; micro FACTICE muet, phrases injectées par le point d'essai — ni micro réel ni Whisper jugés)
node scripts/verif-ecoute-mobile.mjs # l'écoute permanente sur écran de téléphone : micro fermé au repos, format d'enregistrement choisi avec repli, panne dite au lieu d'une page vide (serveur de développement, HAIKO_ECOUTE_URL ; micro FACTICE, transcription interceptée — ni Whisper ni quota touchés)
node scripts/verif-assistant-vocal.mjs # une phrase dictée part chez le bon projet, une phrase vague pose la question (démon d'essai à soi, dossier personnel vide : aucun compte, aucun quota dépensé)
HAIKODEV_DATA=/root/haikodev/data node scripts/verif-voix-kokoro.mjs # les deux moteurs de voix (Piper, Kokoro) : même liste, résolution, cache séparé, son réel
node scripts/installer-voix.mjs     # pose les quatre voix Piper (rejouable)
HAIKODEV_DATA=/root/haikodev/data node scripts/installer-kokoro.mjs # pose le moteur Kokoro : venv-kokoro + data/models/kokoro (rejouable)
HAIKODEV_DATA=/root/haikodev/data node scripts/verif-catalogue-codex.mjs # combien de modèles l'API Codex rend, combien en restent après dédoublonnage
node scripts/verif-liste-modeles.mjs # le menu du modèle montre tous les modèles du serveur, et annonce une liste de secours (démon d'essai à soi)
node scripts/verif-connexion-compte.mjs # connecter un compte depuis les réglages : adresse et code affichés, échec dit (démon et HOME d'essai à soi)
node scripts/verif-competences.mjs  # les compétences partagées arrivent-elles aux agents ? (deux vrais tours ; `--sans-tour` pour s'en passer)
node scripts/nettoyer-essais.mjs    # À LANCER APRÈS : retire les cartes d'essai
HAIKODEV_DATA=/root/haikodev/data node scripts/retirer-projets-perimes.mjs # met de côté les projets hérités de l'ancien Paseo
HAIKODEV_DATA=/root/haikodev/data node scripts/remettre-projet-root.mjs # remet « Root » en service sur /root/root-storage-dashboard
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
provoquer un message court (`message`), une annonce vocale (`annonce`, qui rejoue un événement
`notify` par `client.handleEssai`) ou une PAROLE ENTENDUE (`parole`, posée par
`useEcoutePermanente` : elle entre par le même point que le retour de `/api/transcribe`) depuis un
script. Il est gardé par `import.meta.env.MODE !==
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
  peut être servi : la CONSIGNE de déploiement de l'environnement visé, sinon sa commande de
  publication, sinon HaikoDev lui-même, sinon le service système qui
  tourne sur son dossier (sous-dossier compris), sinon un serveur web qui sert ce dossier tel quel
  (`root * …` dans Caddy, `root …;` dans nginx). Aucun des cinq : la publication est REFUSÉE, le
  bouton s'éteint et dit ce qui manque — jamais un lot annoncé « publié » sans que rien ne parte.
  Une adresse publique qui ne répond pas, ou sept étapes toutes « ignorées », font échouer le run
  (`miseEnLigneReelle`). Chaque étape nomme ce qu'elle a fait ou pourquoi elle ne l'a pas fait.
- **Un ENVOI qui met la production à jour ne part JAMAIS sans un clic**
  (`shared/src/envoi-surveille.ts`, branché dans `server/src/deploy.ts`). Un projet peut DÉCLARER que
  sa branche principale déclenche un déploiement chez le client (`Project.deployeSurEnvoi`, coché
  dans les réglages du projet, bloc « Publication ») : envoyer, c'est alors mettre en ligne. Quand
  c'est déclaré, `startDeploy` s'arrête AVANT la première commande git — pas entre
  « Enregistrement » et « Envoi » : l'étape de fusion pousse déjà la branche courante
  (`git push -u origin <branche>`), et un refus doit laisser le lot ENTIER, pas à moitié fusionné.
  Les sept étapes et leur ordre ne bougent pas ; elles ne commencent simplement pas. La publication
  prend l'état `awaiting` et porte son `attente` (branche, enregistrements, texte) : le texte NOMME
  le projet, la branche, ce qui partirait (cinq enregistrements au plus, le reste compté), les cartes
  du lot, l'adresse remplacée, et dit que rien n'est parti. La décision passe par le TRIANGLE ORANGE
  déjà en place — quatrième source de `decisionsEnAttente` (`server/src/store.ts`), genre `envoi`,
  SANS `agentId` : elle ne tient ni à une carte ni à une conversation, elle se tranche dans le bloc
  de publication du projet — et par le motif `decision-attendue` du guichet `notify`. Chaque carte du
  lot porte une `waitingReason` qui dit pourquoi elle ne part pas, jamais un triangle par carte (le
  compte annoncé doit valoir le nombre de repères). `deploy.envoi { runId, accord }` tranche :
  l'accord fait repartir LA MÊME publication depuis la première étape (`options.reprendre` garde son
  identifiant — sinon la ligne « en attente » resterait en base et le triangle ne s'éteindrait
  jamais), le refus la passe en `stopped`, laisse les cartes où elles sont et l'écrit dessus. Rien
  n'est lu chez le client : c'est une déclaration faite ici. Un projet non déclaré ne change EN RIEN.
  L'attente RETIENT son environnement de publication (`environmentId` / `environmentName`) :
  l'accord relance la même publication vers le même endroit, jamais vers le premier de la liste.
  Verrouillé par `server/src/test/envoi-surveille.test.ts` et `scripts/verif-envoi-surveille.mjs`.
- **Un projet a PLUSIEURS environnements de publication, et une publication en vise UN**
  (`shared/src/environnements-publication.ts`). Un projet portait un seul jeu de réglages
  (`deployCommand` / `deployUrl`) : décrire un dev chez le client ET une production était
  impossible. Il porte désormais une LISTE ORDONNÉE (`Project.environments`), chaque
  environnement ayant son nom, son rôle (`interne` / `dev-client` / `production`), sa commande, son
  adresse à contrôler, sa branche installée et sa consigne de déploiement. `environnementsDuProjet` est le SEUL point de
  lecture : une liste vide rend UN environnement « Interne » portant les anciens champs, si bien
  qu'un projet déjà réglé se comporte exactement comme avant, sans migration de base. Les deux
  anciens champs ne sont plus jamais écrits — le volet de réglages n'écrit que `environments`, deux
  endroits d'écriture faisant deux vérités. `environnementVise(projet, id?)` tranche : sans
  identifiant, le PREMIER de la liste ; un identifiant inconnu y retombe aussi, jamais un refus
  muet. `planDeMiseEnLigne` reçoit le nom de l'environnement (`MoyensDeMiseEnLigne.environnement`)
  et son refus le NOMME — la commande vient de l'environnement, le service système et le dossier
  servi restent des propriétés du dossier, donc communes.
  `startDeploy(projectId, environmentId?, options?)`
  décide l'environnement UNE fois pour tout le run : commande, adresse contrôlée à la fin, branche
  installée (vide = la branche principale ; une branche nommée mais absente ARRÊTE la publication au
  lieu de se rabattre en silence). Le run le retient (`DeployRun.environmentId` / `environmentName`),
  la relance et la file d'attente le rejouent, et les notifications comme la référence de
  dédoublonnage le portent — le même lot mis en dev puis en production fait bien deux alertes.
  `derniersResultats` rend le dernier résultat de CHAQUE environnement (une publication d'avant
  cette règle compte pour le premier), affiché dans le bloc de publication à côté du menu de choix.
  Verrouillé par `server/src/test/environnements-publication.test.ts` et
  `scripts/verif-environnements-publication.mjs`.
- **Une CONSIGNE de déploiement confie la mise en ligne à un agent**
  (`shared/src/publication-confiee.ts`, branché dans `server/src/deploy.ts`). Un environnement de
  publication porte, en plus de sa commande et de son adresse, une `consigne` en français
  (`EnvironnementPublication.consigne`, `DeployEnvironment.consigne`). Vide — le cas de tous les
  projets d'aujourd'hui — RIEN ne change : mêmes sept étapes, même ordre, mêmes refus. Écrite, elle
  devient le PREMIER des cinq moyens de `planDeMiseEnLigne` (`construction`/`installation`/
  `redemarrage` valent alors `agent`) et passe DEVANT la commande, HaikoDev, le service et le dossier
  servi : c'est la seule façon de décrire un déploiement que les quatre autres ne savent pas dire.
  La plomberie git ne bouge pas — fusion, enregistrement, envoi restent à HaikoDev, avec l'attente
  d'accord d'un projet « se déploie sur envoi » et la fermeture des branches. Seules les QUATRE
  étapes de mise en ligne changent de main : `verify`, `build` et `restart` disent que la consigne
  les couvre (`mentionEtapeConfiee`, jamais une étape muette), et `publish` porte le compte rendu de
  l'agent. Un agent de rôle « deploy » est appelé une fois (`confierLaMiseEnLigne`) avec
  `consigneDeLAgentDePublication` : la consigne réglée TELLE QUELLE entre deux repères, le projet, le
  dossier, l'environnement (nom, rôle, adresse, branche), l'enregistrement, si l'étape clôt les
  cartes, et le lot embarqué (`CARTES_NOMMEES_MAX` cartes nommées, le reste compté). Il lui est
  interdit de changer de branche, de faire `git add -A`, de désactiver un test et de toucher au
  tableau. Un tour en échec fait ÉCHOUER la publication en nommant l'environnement
  (`phraseDEchecConfie`) ; un compte rendu vide est dit comme tel (`recitDeLAgent`) ; l'adresse
  publique et `miseEnLigneReelle` gardent le dernier mot. Verrouillé par
  `server/src/test/publication-confiee.test.ts`.
- **Un refus de publication NOMME ce qui tombe** (`shared/src/echec-verification.ts`). L'étape
  « verify » lance les contrôles du projet et s'arrête au moindre échec — ce refus ne bouge pas.
  Mais la sortie ne se coupe plus aux derniers signes : `runCommand` la garde ENTIÈRE pour cette
  étape (dernier argument `signesGardes`), `controlesTombes` y relève les lignes « not ok N - … »
  de premier niveau avec leur `location:`, `phraseDEchec` les met dans le message d'erreur et
  `detailDEchec` les pose EN TÊTE du détail, avant la fin de la sortie brute. Cinq contrôles nommés
  au plus, le reste compté. Verrouillé par `server/src/test/echec-verification.test.ts`.
- **Les contrôles de la publication portent sur du code RECOMPILÉ, et un échec est réparé sur place**
  (`controlerLeProjet` et `reparerLesControles`, `server/src/deploy.ts`). `npm test` lit `server/dist`,
  que l'étape « build » ne reconstruisait qu'APRÈS : l'étape « verify » jugeait le dist du dernier
  lancement du démon et non le lot fusionné — un correctif déjà écrit échouait indéfiniment. Elle
  lance donc `npm run build:server` d'abord, et une compilation qui tombe arrête là au lieu de
  contrôler à vide. Un contrôle en échec ne rend plus la main : un agent de rôle « deploy » est
  appelé sur-le-champ, comme pour un conflit de fusion, avec les contrôles tombés NOMMÉS ; il répare
  la cause (jamais en désactivant un test), puis tout est rejoué. Au bout de `REPARATIONS_MAX`
  passes, le refus reste entier et nomme ce qui tombe encore. Verrouillé par
  `server/src/test/controles-publication.test.ts`.
- **Une CONSTRUCTION qui échoue est réparée sur place, comme un conflit ou un contrôle tombé**
  (`construireAvecReparation` et `reparerLaConstruction`, `server/src/deploy.ts`). L'étape
  « Construction » était le dernier endroit sans secours : un `npm run build` en échec jetait « La
  construction a échoué » et tout s'arrêtait, même quand la cause n'avait rien à voir avec le code
  (fichier temporaire illisible : `EACCES … node_modules/.tmp/tsconfig.node…`, vu sur haiko-compta).
  Un agent de rôle « deploy » est donc appelé sur-le-champ, avec la cause NOMMÉE, puis la
  construction est rejouée — même `REPARATIONS_MAX` que les contrôles, jamais une passe de plus. Les
  DEUX endroits qui construisent (HaikoDev lui-même, projet ordinaire en `plan.construction ===
  'npm'`) y passent : plus aucun `npm run build` sans secours. Le refus ne s'assouplit pas — au bout
  des passes, rien n'est mis en ligne et le message NOMME ce qui bloque encore
  (`phraseDEchecConstruction`), le détail de l'étape posant les causes EN TÊTE
  (`detailDEchecConstruction`) puis la fin de la sortie brute. Les règles de lecture sont pures
  (`shared/src/echec-construction.ts`) : `causesDeConstruction` relève les codes système
  (EACCES, ENOENT, EPERM…), les outils absents (`tsc: not found`) et les erreurs TypeScript, du
  motif le plus parlant au plus vague, sans jamais redire deux fois la même ligne ; la consigne
  envoyée à l'agent vit là aussi (`consigneDeReparationConstruction`), donc un contrôle la lit sans
  lancer un tour payant. La sortie est gardée ENTIÈRE pendant le travail (les causes sont écrites au
  milieu, pas à la fin). L'ordre des étapes et la pose automatique des outils de construction ne
  bougent pas. Verrouillé par `server/src/test/construction-publication.test.ts` et
  `scripts/verif-reparation-construction.mjs`.
- **La publication POSE les outils de construction avant de construire**
  (`poserLesOutilsDeConstruction`, `server/src/deploy.ts`). Le démon tourne avec
  `NODE_ENV=production`, où `npm install` saute les dépendances de développement — donc `tsc` et
  `vite`, que `npm run build` appelle. Si l'un des deux manque dans `node_modules/.bin`, l'étape de
  construction lance d'abord `NODE_ENV=development npm install --include=dev` et le DIT dans son
  détail. Aucune étape ajoutée ni déplacée : c'est la préparation de l'étape existante.
- **Ce qui plante DANS LA PAGE remonte au serveur** (`shared/src/erreur-interface.ts` pour les règles,
  `server/src/erreurs-interface.ts` pour le fichier). Sur un téléphone, `console.error` écrit dans une
  console qu'on ne peut pas ouvrir : une application qui blanchit ne laissait AUCUNE trace. Trois
  chemins remontent, et pas un de plus (`SOURCES_ERREUR`) : le filet de sécurité
  (`web/src/components/filet.tsx`, `affichage`, qui emporte la zone et la pile des composants),
  l'erreur globale de la fenêtre (`fenetre`) et la promesse rejetée sans traitement (`promesse`) —
  ces deux-là branchées par `brancherRemonteeErreurs` (`web/src/lib/erreurs.ts`), appelée AVANT le
  premier rendu dans `main.tsx`. L'envoi passe par `POST /api/erreur` (authentifié, 64 Ko au plus,
  `keepalive`), ne bloque rien et n'est JAMAIS réessayé : le `catch` est muet, il n'y a pas de file
  d'attente. Une erreur ne part qu'une fois (`empreinteErreur`) et une page en envoie au plus
  `ERREURS_MAX_PAR_PAGE` (12) — une panne qui revient à chaque affichage en produirait des milliers.
  `jugerRapportErreur` est le portier : origine inconnue ou message vide = REFUS 400 qui dit pourquoi,
  ce qui dépasse est coupé plutôt que rejeté, et c'est le SERVEUR qui date (l'horloge d'un téléphone
  peut être fausse de plusieurs heures). Rien du projet ne part : ni message de conversation, ni pièce
  jointe — l'erreur, l'adresse de la page, l'appareil déclaré. Le journal est un fichier à part,
  `data/logs/interface-erreurs.log`, une erreur par ligne en JSON, plafonné à `ERREURS_JOURNAL_MAX`
  (200) lignes. Il se lit dans les réglages, onglet Système, bloc « Dernières erreurs de l'interface »
  (`erreurs.liste` / `erreurs.effacer`), où l'appareil est dit en français (`appareilEnClair`).
  Verrouillé par `server/src/test/erreur-interface.test.ts` et `scripts/verif-erreurs-interface.mjs`.
- **Un projet se déclare sur son DÉPÔT DE TRAVAIL, jamais sur son dossier publié.** Un dossier servi
  n'est pas un dépôt git : l'agent n'y trouve aucune mémoire, n'y enregistre rien et ne peut RIEN
  prouver — la carte se clôt sur du vide. Quand le code de travail vit ailleurs que le dossier servi,
  le projet pointe sur le dépôt et porte une **commande de publication** qui installe la copie servie
  (sans elle, `planDeMiseEnLigne` refuse la mise en ligne, à raison).
- **Un projet qu'on retire du tableau est MIS DE CÔTÉ, jamais supprimé** (`project.archive`,
  `archived = 1`). La colonne de gauche n'affiche que les projets non archivés
  (`store.listProjects`) ; le projet, ses cartes et ses conversations restent en base et
  « Remettre en service » les rend. Avant de retirer, on NOMME ses cartes hors archive : rien ne
  disparaît de la vue sans avoir été dit.
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
- **La mise en ligne compte DEUX étapes, et la colonne « En production » les sépare**
  (`shared/src/etapes-publication.ts`). La clé `in_production` s'insère entre `to_deploy` et
  `archived` dans `COLUMN_KEYS` — aucune clé existante n'est renommée ni supprimée, la règle gravée
  ne bouge pas. `etapesDePublication` décide, pour un projet donné, quelles mises en ligne existent :
  sans environnement de dev déclaré, UNE seule étape (« À déployer » → publication → « Archivé »,
  exactement le parcours d'avant) ; avec, DEUX — dev (« À déployer » → « En production », la carte
  n'est PAS close) puis production (« En production » → « Archivé », la carte est close : document,
  branche refermée, historique). `deployableCards(projectId, source)` prend le lot dans la colonne de
  l'étape, et le garde-fou `!deployedAt` ne vaut QUE pour la première (une carte « En production »
  porte forcément une date de mise en ligne). `startDeploy(projectId, { cible })` et la commande
  `deploy.start` portent la cible ; une étape réclamée qui n'existe pas est REFUSÉE en le disant
  (`raisonEtapeInconnue`), jamais remplacée en silence. `moyensDePublication` (`server/src/deploy.ts`)
  est le SEUL endroit qui dit si un environnement de dev existe — il rend `false` tant que le réglage
  n'est pas écrit (carte séparée). Publier reste un geste de l'utilisateur, aux deux étapes.
  Verrouillé par `server/src/test/colonne-en-production.test.ts` et
  `scripts/verif-lot-production.mjs`.
- **« Archivé », « En production » et « À déployer » ne se rouvrent que sur GESTE HUMAIN** (`repriseAutorisee`,
  `shared/src/suivi-colonne.ts`). La règle par défaut ne bouge pas : aucun chemin AUTOMATIQUE n'en
  ressort une carte — ni un tour d'agent (`colonneAuDemarrage`), ni `board_move_card`, ni une
  question posée dans la conversation, qui ne doit jamais retirer une carte du lot à publier. Un
  clic ou un glissement de l'utilisateur, lui, le peut : bouton dédié dans le tiroir
  (`gesteCarte('reprendre', …)`), même ligne dans le menu des gestes rares, et glisser-déposer.
  D'un geste, la carte retombe à l'étape juste avant (`colonneDeReprise` : « Archivé » → « À faire »,
  « En production » → « À déployer », « À déployer » → « Terminé »), et le bouton DIT lequel des trois
  gestes il fait (`libelleDeReprise`) ; toute autre colonne reste atteignable à la main. La carte GARDE sa
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
- **L'adresse du navigateur porte un fragment « # » qui décrit l'écran** (`shared/src/adresse-navigateur.ts`,
  branché dans `web/src/app.tsx`). `construireFragment` écrit `#projet/<id>`, `#projet/<id>/tache/<id>-<slug>`,
  `#reglages` ou `#tableau-de-bord` ; `lireFragment` fait l'inverse (« # » de tête toléré, fragment abîmé =
  accueil). L'IDENTIFIANT est la seule clé — le slug du titre est décor, jeté à la lecture ; `memeEcran`
  compare vue + identifiants sans le slug. Deux effets se font face dans `app.tsx` : un lit l'adresse au
  chargement et à chaque `popstate` (`appliquerEcran`), l'autre la réécrit à chaque changement d'écran —
  `pushState` pour un écran différent, `replaceState` pour un même écran (rafraîchit juste le slug, pas
  d'entrée d'historique). Le premier rendu n'écrit PAS (il vient de LIRE), sinon un fragment collé serait
  effacé avant d'être appliqué. La persistance serveur (`project.active`, `card.open`) n'est pas touchée :
  le fragment s'ajoute par-dessus. Verrouillé par `server/src/test/adresse-navigateur.test.ts`.
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
  **La note ne vaut que pour une carte qui n'a JAMAIS rien produit.** Une carte qui a déjà enregistré
  du code au cours de sa vie porte le drapeau `card.codeDejaEnregistre` (posé en fin de tour dès que
  le dépôt bouge, et au relancement d'une carte quittant « Terminé »/« À déployer » — il SURVIT au
  relancement, contrairement à `doneAt`) ; `raisonSansModification` reçoit ce drapeau en dernier
  argument et se TAIT quand il est vrai. Un tour de simple suite ou de discussion sur un travail déjà
  atterri ne rallume donc plus « aucun fichier n'a changé ».
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
- **Le tableau de bord ne mélange JAMAIS une part de quota MESURÉE et une ESTIMÉE**
  (`usageByCard`, `server/src/store.ts` ; bloc « Part de quota par carte »,
  `web/src/components/dashboard.tsx`). Le mesuré vient des colonnes `quota_5h` / `quota_semaine` de
  la table `usage` — la même source que `usageQuotaByCard` pour l'onglet « Détails », donc une seule
  vérité — et il est en POINTS DE POURCENTAGE ; l'estimation faite à la validation
  (`card.estimate.quotaShare`) est une FRACTION et ne sert plus qu'aux tâches sans aucun relevé, où
  elle est nommée comme telle. D'où deux mises en forme séparées côté page (`pourcentEnClair` pour
  le mesuré, `partEnClair` pour l'estimation) : convertir le mesuré ferait lire 50 % pour un
  demi-pourcent. `stats.dashboard` fait suivre les deux parts par carte, `usageByCard` CLASSE sur la
  part de SEMAINE décroissante (les jetons ne départagent qu'à égalité) et la barre mesure la même
  grandeur que le classement. Une tâche sans relevé est LISTÉE à part et le dit, jamais chiffrée à
  zéro. Le total de la période est rappelé au-dessus de la liste. Verrouillé par
  `server/src/test/usage-part-quota.test.ts` et `scripts/verif-tableau-de-bord.mjs`.
- **Une barre du tableau de bord porte la COULEUR de son intensité** (`couleurIntensite`,
  `shared/src/couleur-intensite.ts`). Les trois blocs à barres — consommation au fil des jours,
  projets les plus travaillés, part de quota par carte — passent tous par la même règle : la couleur
  mélange en `oklab` deux JETONS de thème, `--intensite-calme` (= `--success`) et
  `--intensite-chargee` (= `--warning`), proportionnellement à la valeur rapportée au maximum
  observé. Le haut du dégradé est l'ORANGE d'attention, jamais le rouge de `--danger` : une forte
  consommation est un fait à voir, pas une panne. Aucune teinte n'est écrite en dur, donc les deux
  thèmes suivent d'eux-mêmes ; la barre choisie de la courbe n'est plus distinguée par sa couleur
  (elle en porte une qui parle) mais par un liseré d'accent (`ring-accent`). Verrouillé par
  `server/src/test/couleur-intensite.test.ts` et `scripts/verif-tableau-de-bord.mjs`, qui lit les
  couleurs calculées dans les deux thèmes.
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
- **La ligne d'un projet ne porte JAMAIS plus de deux repères D'ATTENTE**, en plus du bouton de
  réglages : un ROBOT devant le nom quand des agents travaillent (le nombre seulement à partir de
  deux, jamais d'anneau qui tourne), et UN SEUL repère d'attente à droite — `repereVisible`
  (`shared/src/signal-projet.ts`) tranche, la décision attendue (triangle orange) l'emportant sur le
  travail rendu non lu (point bleu, cliquable pour marquer comme lu). C'est l'AFFICHAGE qu'on
  réduit : les deux comptes continuent d'être calculés et de secouer la ligne séparément. Chaque
  repère dit ce qu'il veut dire en français simple (`aria-label` + infobulle). À part, du côté du
  ROBOT (un ÉTAT du projet, pas une décision), un point JAUNE qui respire quand une PUBLICATION est
  en cours (`RepereePublication`, `web/src/components/sidebar.tsx`, alimenté par
  `state.deploys[id]?.state === 'running'`) : il ne porte aucun geste, ne compte pas parmi les deux
  repères d'attente, s'éteint dès la fin de la publication (réussite, échec, arrêt) et remonte à
  l'en-tête d'un groupe replié dont un membre publie. Couleur `publie` (jeton `--publie`,
  `web/src/styles.css`), distincte de l'orange `warning`.
- **SEPT motifs interrompent, pas un de plus, et chacun porte SON image**
  (`shared/src/notification-tri.ts`). Le MOTIF décide, pas la famille : sortent de l'application une
  tâche réellement terminée (avec ou sans carte), une décision attendue, un échec de tâche, une
  publication terminée, une publication EN ÉCHEC, le quota de la semaine aux paliers 70 % puis 90 %,
  et le redémarrage du serveur. Tout le reste reste DANS l'application (bannière) — charge machine,
  amorçage d'une fenêtre, fenêtre de 5 h qui s'achève, liste de tâches cochée, point du jour, et
  désormais la surconsommation comme l'emballement de quota, qui redisaient les paliers sans palier
  franchi. Les deux motifs neufs sont émis là où le fait se constate : `server/src/deploy.ts` quand
  le run tombe (jamais sur un arrêt demandé à la main), `server/src/demon.ts` avant
  `process.exit(0)` — d'où `viderLesGroupes` (`server/src/notify.ts`), qui vide le groupe de quatre
  secondes tout de suite, sinon le processus s'arrête avant que l'alerte ne parte.
  L'IMAGE suit le genre, pas la famille (`iconeDuMotif` : terminé, attention, erreur, publication,
  quota, redémarrage — une publication tombée porte l'image d'erreur) : le motif voyage dans
  l'événement `notify` et dans le message poussé, `web/src/app.tsx` et `web/public/sw.js` en tirent
  le fichier, avec repli sur l'icône de l'application. Le TITRE nomme l'action, pas le genre : le
  titre réel de la carte (`carte.title`) quand il y en a une, sinon l'objet précis passé par
  l'appelant — précédé d'un EMOJI de genre (`emojiDuMotif`, même six genres que l'image : ✅ ⚠️ ⛔
  🚀 📊 🔄). L'emoji est le seul repère visuel qui survit sur un téléphone, où le système impose
  l'icône de l'application. Le corps (`corpsNotification`) reçoit alors l'action déjà mise au titre
  et ne la répète pas : la description prend toute la place. Le texte vit dans
  `shared/src/notification.ts`, l'emoji dans `shared/src/notification-tri.ts`. Le service worker ne partageant rien avec
  l'application, sa table est RECOPIÉE — un test compare les deux. Les six images sont fabriquées
  par `scripts/icones-notifications.mjs` (PNG, aucune bibliothèque) : on ne dépose pas un binaire
  illisible dans le dépôt, on le regénère. `notify` reste le guichet unique
  (`server/src/notify.ts`) : il refuse un motif qui n'interrompt pas, applique les réglages de
  famille et les heures de silence, puis DÉDOUBLONNE sur l'identité de l'événement
  (`cleEvenement` : sujet + objet, dix minutes de mémoire) — deux endroits du code qui racontent la
  même chose ne font qu'une alerte. Un groupe de quatre secondes NOMME ses éléments
  (`resumeGroupe`), jamais un compte muet. Une carte ne se signale terminée que si elle a
  RÉELLEMENT atteint « Terminé » ou « À déployer ». Verrouillé par
  `server/src/test/notification-tri.test.ts`, `server/src/test/notification-texte.test.ts`,
  `scripts/verif-notifications.mjs` et `scripts/verif-icones-notifications.mjs`.
- **L'assistant PARLE de lui-même aux moments clés, et le bouton « Muet » coupe cette voix**
  (`web/src/components/voix-assistant.tsx`, phrases dans `shared/src/voix-annonce.ts`). Deux instants
  déjà signalés ailleurs : une tâche terminée et une PUBLICATION terminée ou en ÉCHEC (l'événement
  `notify`, `phraseVocaleDeNotification` fabrique une phrase pour les motifs `tache-terminee`,
  `publication-terminee` et `publication-echec`, dont le titre porte le nom réel de la carte ou du
  projet), et une décision qui se met à attendre (le TOTAL de
  `state.attention`, rangé PAR PROJET, dont le TOTAL MONTE — jamais le déjà-là du chargement, jamais
  la baisse). La décision passe par le compte d'attention, PAS par sa notification, sinon on
  l'entendrait deux fois. La phrase NOMME de quoi il s'agit (`phraseDecisionAttendue`) : le titre de
  la TÂCHE si la décision tient à une carte, sinon le nom du PROJET dont le compte a monté, sinon un
  repli générique — le tout sous `VOIX_LONGUEUR_MAX` (un titre à rallonge retombe sur le projet). La
  voix a une PERSONNALITÉ, posée à un SEUL endroit (`shared/src/voix-annonce.ts`) : une développeuse
  fullstack qui pilote les tâches DANS HaikoDev, tutoie l'utilisateur et l'appelle par son PRÉNOM,
  d'un ton humain jamais robotique. Le prénom est RÉGLABLE (`Settings.voixNom`, défaut « Chris »,
  `NOM_UTILISATEUR`), édité dans l'onglet Système et passé à chaque phrase par `VoixOptions.nom` — le
  module de voix lit `state.settings.voixNom`, le serveur `store.getSettings().voixNom`. TOUTES les
  annonces (fin de tâche, publication, décision) VARIENT leur tournure (`variante`, choix STABLE pour
  une même entrée — une réécoute ne surprend pas) au lieu d'un modèle figé, et RACCOURCISSENT le soir
  (`VoixOptions.heure`, `estSoir` = 20 h → 7 h). Quand HaikoDev a le VRAI texte de la réponse de
  l'agent (l'`onComplete` de l'ordonnanceur, `server/src/scheduler.ts`), `phraseDepuisReponse` en tire
  un résumé humain (première idée de « Ce qui est fait », nettoyée) SANS aucune génération payante ;
  ce résumé voyage par le champ `voix` de la notification (`notify` → événement `notify`, effacé dès
  qu'un groupe se forme) et la voix le PRÉFÈRE au repli par titre. Le soir, `phraseDepuisReponse` rend
  `null` (le ton bref préfère la courte phrase par titre). La
  phrase est courte, écrite pour l'oreille (mémoire n°35) ; on réutilise Piper par une adresse audio ordinaire
  `GET /api/speak?text=…` (bornée par `normaliserTexteVoix`, `server/src/http.ts`), avec repli sur la voix
  du navigateur. La VITESSE est réglable par crans (`Settings.voixVitesse`, défaut « normale » = échelle
  1 ; `CRANS_DE_VITESSE`/`echelleDeVitesse`, `shared/src/voix-vitesse.ts`) : `speak(text, voix, vitesse)`
  ajoute `--length_scale` à Piper (> 1 ralentit, < 1 accélère) et, sans vitesse imposée, la LIT dans les
  réglages — donc TOUTES les paroles (point du jour, annonces auto, réécoutes par `/api/speak`) la
  suivent. Seul l'essai l'impose : `/api/voice-sample?voice=…&vitesse=…` fait ENTENDRE un cran avant de
  l'adopter. Réglé dans l'onglet Système sous le choix de voix. Verrouillé par
  `server/src/test/voix-vitesse.test.ts`. **Le son fabriqué est GARDÉ, et préparé d'avance** (`server/src/voice.ts`) : `speak`
  range chaque son dans `<data>/audio/cache/<empreinte>.wav`, l'empreinte découlant de la VOIX résolue,
  du texte ET de la VITESSE — même phrase, même voix, même vitesse, même fichier, donc une réécoute repart
  du fichier sans relancer Piper ; un changement de vitesse, lui, refait le son (sinon l'ancien cran
  resterait servi). Une synthèse déjà EN COURS pour une empreinte n'est pas relancée (map `enCours`), et le cache
  ne grossit pas sans fin : au-delà de `CACHE_SONS_MAX` (200) fichiers, les plus vieux tombent
  (`rangerLeCache`, sur la date de dernier accès). L'AVANCE : dès qu'un événement porte une phrase
  parlée (`input.voix` — fin de tâche, publication terminée ou en échec), `notify` (`server/src/notify.ts`)
  appelle `precharger` en arrière-plan, si bien que le fichier est déjà là quand le navigateur le
  demande. `/api/speak` reste en `cache-control: no-store` (l'URL ne porte pas la voix : un cache
  navigateur servirait un ancien son après un changement de voix). **Le module est UN SEUL objet qui se MÉTAMORPHOSE** : il n'y a plus un bouton d'un
  côté et un panneau de l'autre. `formeDuModule(ouvert, parle, nb)` rend sa largeur, sa hauteur et son
  rayon en NOMBRES — rond de 44 px au repos (rayon = moitié, donc un cercle), bloc de parole assez
  LARGE pour contenir ses ondes quand ça parle (`VOIX_LARGEUR_PARLE` se DÉDUIT du nombre de barres
  `ONDES_LARGES`, de leur largeur, de leur écart et de la marge `px-3` — élargir la ligne d'ondes
  sans élargir le bloc faisait déborder les dernières barres), panneau de 256 px (borné à `80vw`)
  quand il est déplié, la hauteur suivant le nombre de
  messages (`hauteurDepliee`) — et le navigateur les INTERPOLE en `VOIX_MORPHISME_MS` (300 ms) : des
  classes utilitaires de largeur sauteraient d'un cran à l'autre. Le déplié l'emporte sur la parole :
  on ne rétrécit pas un panneau qu'on lit. Deux visages se croisent en fondu DANS cette boîte, en
  `absolute inset-0` : le bouton d'interaction (`data-icone-voix`, qui saisit survol, appui et
  glissement, VIDE de dessin) et l'historique (`data-liste-voix`), dont l'opacité attend que la place
  soit faite (`transitionDelay`) — le contenu se dévoile après la boîte, jamais avant. Mais LA LIGNE
  D'ONDES est un TROISIÈME objet, UNIQUE et CONTINU, hors de ces deux visages : elle ne se dédouble
  plus (un exemplaire dans le bouton, un au pied, qui se croisaient en fondu et faisaient CLIGNOTER
  l'icône). Toujours visible (`pointer-events-none`, jamais d'opacité 0), elle GLISSE du centre du
  rond fermé jusqu'au creux du pied déplié — position mesurée depuis le BAS de la boîte (elle-même
  ancrée par le bas), de `VOIX_BAS_ONDES_REPOS` à `VOIX_BAS_ONDES_OUVERT`, animée en
  `VOIX_MORPHISME_MS` comme la boîte. Elle porte `data-pied-ondes` ; le pied de la liste n'est plus
  qu'un creux vide (`h-9 border-t`) où elle vient se poser. Cette ligne s'ÉLARGIT à toute la largeur
  du conteneur (`data-pied-ondes` en `inset-x-0`, ondes en `w-full justify-between`, `ONDES_LARGES`
  barres) et ne s'anime QUE lorsque la voix PARLE — un module seulement OUVERT au survol (voix muette)
  garde les cinq barres figées au repos, jamais un flux animé sans son. `LigneOndes` ne prend donc plus
  que `parle` : `plein` a disparu. L'icône FIGÉE à cinq barres (`data-icone-repos`) s'affiche dès que la
  voix ne parle pas — module fermé OU seulement ouvert au survol : elle montre cinq barres
  figées en vibration sonore SYMÉTRIQUE. Pendant la parole (`data-parle`, posé sur la RACINE) les
  barres larges deviennent un flux d'ondes VERTES (`data-onde-vocale`, `bg-success`, jeton
  `--success`, jamais une couleur en dur) qui SUIVENT LE VOLUME réellement entendu : une analyse Web
  Audio est branchée sur l'élément audio du lecteur partagé (`brancherAnalyse`/`lireNiveaux`,
  `web/src/lib/voix.ts`), chaque barre lit une tranche de fréquences basses-médiums (`getByteFrequencyData`),
  et `LigneOndes` pilote leur `scaleY` par une boucle `requestAnimationFrame` LISSÉE — hautes quand la voix
  porte, presque plates dans les silences. On ne route l'élément par le graphe QUE si le contexte audio
  tourne déjà (`state === 'running'`) : router un son en veille le rendrait muet. Le contexte est donc
  RÉVEILLÉ au premier geste de l'utilisateur (`obtenirContexte` + écouteurs `pointerdown`/`keydown`/
  `touchstart` posés une fois, `web/src/lib/voix.ts`) : `resume()` étant asynchrone, le tester juste
  après l'appel le trouvait toujours suspendu au premier son et l'analyse ne prenait JAMAIS — d'où des
  ondes qui retombaient sur l'animation régulière au lieu de suivre le volume. Sans analyse possible
  (contexte encore en veille, voix de secours du navigateur — où `detacherAnalyse` est appelé —,
  navigateur qui la refuse) on retombe sur l'animation régulière `animate-onde`, jamais sur des barres
  figées — mais SEULEMENT pendant la parole. Cette analyse-là n'ouvre AUCUN micro : elle ne mesure que
  ce que l'application joue (le micro, lui, est une affaire d'écoute permanente, réglée ci-dessous et
  éteinte par défaut). L'ouverture se déclenche au survol
  (souris) ou à l'appui (doigt) — même choix que la pile des messages (`gesteDOuverture`/`pileApres`,
  `(hover: hover) and (pointer: fine)`), attribut `data-ouvert` — et montre l'HISTORIQUE au-dessus (les
  `VOIX_MESSAGES_MAX` (10) derniers messages prononcés, le plus récent en haut), la ligne d'ondes
  restant EN DESSOUS. Un clic sur un message le REJOUE par le même `dire()` / `/api/speak`, avec `force` qui passe
  outre le Muet. Le message EN COURS de lecture est marqué dans la liste (`data-en-lecture`,
  `aria-current`, fond `bg-raised`, icône `text-success`) et porte SOUS lui une fine barre
  (`data-barre-lecture`, couleur `bg-success` des ondes) qui avance avec le son : `dire(texte,
  force, id)` retient l'identifiant lu (`enLecture`) et l'avancement (`avancement`, fraction 0→1
  tirée de l'élément audio par `loadedmetadata`/`timeupdate`). Un JETON par lecture (`jetonRef`,
  incrémenté par `taire`) empêche une parole finie de clôturer celle qui l'a remplacée. Quand la voix
  de secours du navigateur prend le relais (avancement inconnu), le message reste marqué sans barre
  trompeuse : `avancement` vaut `'indetermine'` et la barre PULSE (`animate-pulse-soft`) au lieu de
  mentir sur une position. La barre disparaît à la fin, au remplacement ou à l'arrêt. L'historique est DURABLE : il vit en mémoire du navigateur (`localStorage`,
  `CLE_VOIX_HISTORIQUE`, jamais côté serveur), SURVIT au rechargement, garde jusqu'à
  `VOIX_HISTORIQUE_MAX` (100) messages (les plus anciens tombent) et n'en affiche que dix. Il se
  remplit à chaque annonce AUTOMATIQUE (fin de tâche, fin/échec de publication, hausse d'attention)
  même en Muet — la parole se tait, la trace reste. Le point du jour ne change pas. Le bouton « Muet »
  vit DANS le panneau déplié du module (`data-muet-voix`, `web/src/components/voix-assistant.tsx`), à
  côté de la voix qu'il commande — plus dans le menu trois points du haut : il bascule la
  préférence `voix.muet` (`CLE_VOIX_MUETTE`), retenue au rechargement, coupe la parole
  automatique et rien d'autre — ni l'icône, ni la réécoute manuelle, ni notifications visuelles, ni
  badge. Les DEUX boutons de l'en-tête déplié (écoute, muet) ne portent que leur ICÔNE, sans libellé
  (oreille barrée/non pour l'écoute, haut-parleur barré/non pour la voix) : l'état se lit à l'infobulle
  et à l'`aria-label`. La couleur d'ALERTE (`text-danger`) est réservée à ce qui alerte vraiment — un
  micro refusé —, jamais à un réglage simplement allumé (écoute active = `text-success`).
  Verrouillé par `server/src/test/voix-annonce.test.ts` et `scripts/verif-module-voix.mjs`.
- **Le module de voix SE DÉPLACE, et sa place est retenue dans le COMPTE**
  (`shared/src/position-voix.ts`, branché dans `web/src/components/voix-assistant.tsx`). Il était
  cloué en bas au centre et recouvrait parfois ce qu'on lit. Le glissement part d'où on peut
  l'attraper, et cela DÉPEND DU POINTEUR (`useSurvol`, jamais la largeur d'écran). AU DOIGT, on le
  tire par son ICÔNE (`data-icone-voix`) : le MÊME appui déplie (immobile) et déplace (qui glisse),
  `estUnGlissement` tranchant au-delà de `SEUIL_GLISSEMENT_VOIX`. À LA SOURIS, l'icône ne suffit
  pas — l'ouverture se fait au SURVOL et rend aussitôt l'icône `pointer-events-none` : approcher pour
  tirer déplierait le panneau et effacerait la prise. Une POIGNÉE dédiée (`data-poignee-voix`,
  visible seulement si `survolPossible` ET module FERMÉ, `!ouvert`) est donc posée HORS du module,
  juste à l'extérieur du coin bas-droit du rond, à `VOIX_ECART_POIGNEE` px du bord : elle est un FRÈRE
  de la boîte (pas un descendant), si bien que la survoler ne déclenche plus le `onMouseEnter` de la
  boîte et ne déplie plus le panneau. Elle DISPARAÎT dès que le panneau est ouvert (ancrée au coin
  bas-droit du rond, elle chevaucherait sinon le déplié) et revient une fois refermé — on tire donc
  toujours le module FERMÉ. Elle est ancrée au ROND fermé (transform `fixed` avec `VOIX_ROND/2 +
  decalage.x + écart`, `decalage.y` — jamais la correction d'ouverture), donc elle ne bouge pas d'un
  déplacement à l'autre et suit le module quand on le déplace (le décalage retenu). Aucune poignée au
  doigt. Le geste d'amorçage est écrit UNE fois (`commencerGlissement`), partagé par l'icône (doigt)
  et la poignée (souris) ; `touchAction: 'none'` sur les deux, sinon le doigt ferait défiler la page. Ce qui est retenu n'est pas une position absolue mais un
  DÉCALAGE en pixels par rapport à la place d'origine — décalage nul = l'affichage d'avant. Il passe
  par le MÊME mécanisme que le bloc du dock, une préférence SERVEUR (`usePref`, clé
  `CLE_VOIX_POSITION` = `voix`, jamais `dock`), donc la même place sur tous les appareils ; jamais un
  second mécanisme, et jamais le `localStorage` de l'historique. `ramenerDansLEcran` garde le module
  entièrement visible au chargement comme au redimensionnement — une place prise sur grand écran est
  ramenée dans les bords d'un téléphone, et le corrigé est RANGÉ, sinon il reviendrait hors écran au
  démarrage suivant. Un glissement au doigt ne produit AUCUN clic : le repère « on vient de glisser »
  est donc remis à zéro au `pointerdown` suivant, sinon il mangerait l'appui d'après et le module ne
  se déplierait plus jamais. Le transform porte à la fois le centrage d'origine et le décalage
  (`translate(calc(-50% + Xpx), Ypx)`) — il remplace la classe `-translate-x-1/2`. Verrouillé par
  `server/src/test/position-voix.test.ts` et `scripts/verif-position-voix.mjs`.
- **DEUX moteurs de synthèse cohabitent, et c'est la VOIX CHOISIE qui décide lequel parle**
  (`server/src/voice.ts`). Piper reste le moteur d'origine et la voix par défaut ne bouge pas
  (`fr_FR-siwis-medium`, « Claire ») ; Kokoro s'ajoute À CÔTÉ, jamais à la place. Une voix Kokoro se
  nomme `kokoro:<voix>` — le préfixe est la SEULE marque du moteur, d'où le deux-points ajouté aux
  signes permis par `voiceChoisie`. `resoudre` rend une `VoixResolue` qui porte son `moteur`, et
  `lancerLaSynthese` est le seul endroit qui diffère : au-dessus (empreinte, cache, file d'attente)
  et en dessous (`/api/speak`, `/api/voice-sample`, module de voix) tout est commun. L'empreinte du
  cache (`cleDuSon`) prend le MOTEUR en premier : la même phrase dite par les deux ne partage jamais
  son fichier. Kokoro est UN modèle unique multilingue (`data/models/kokoro/kokoro-v1.0.onnx` +
  `voices-v1.0.bin`), dans son PROPRE environnement Python (`data/venv-kokoro`) pour ne rien changer
  à celui de Piper, appelé par `scripts/kokoro-voix.py` qui prend le texte sur l'entrée standard et
  rend un WAV — comme Piper. Deux différences absorbées là : la vitesse (Piper compte en LONGUEUR,
  `--length_scale` > 1 ralentit ; Kokoro en VITESSE, donc l'échelle est inversée) et la langue,
  déduite de la première lettre du nom de la voix. Sa gamme FRANÇAISE est mince : sur 54 voix, une
  seule est française (`ff_siwis`, affichée « Camille ») — les autres ne sont pas listées, elles ne
  serviraient pas un assistant qui parle français. Une voix Kokoro inconnue, ou le moteur absent,
  retombent sur Piper : jamais de silence. Posé par `scripts/installer-kokoro.mjs` (rejouable).
  **Le REPLI se juge SANS la voix réglée sur la machine** : `voiceChoisie(demandee, reglee?)` prend
  un second argument — laissé de côté, il lit les réglages (c'est le cas de TOUS les appels réels) ;
  à `null`, il ignore le choix de l'utilisateur et ne rend que le repli. Un contrôle qui ne le passe
  pas dépend de la voix retenue sur le serveur où il tourne : réglé sur Kokoro, il déclare le repli
  cassé alors que rien ne l'est.
  Verrouillé par `server/src/test/point-vocal.test.ts` et `scripts/verif-voix-kokoro.mjs`.
- **Le PANNEAU s'ouvre du côté où il y a de la place, le bouton ne bouge pas**
  (`sensDouverture` / `correctionOuverture`, `shared/src/position-voix.ts`). Le module fermé est un
  rond de 44 px ; déplié, un panneau de 256 px de large. `sensDouverture` regarde la boîte du rond à
  l'écran et choisit le côté : centre par défaut, vers la GAUCHE si collé au bord droit, vers la
  DROITE si collé au bord gauche, vers le BAS (au lieu du haut) si posé en haut, et de même pour les
  coins. `correctionOuverture` en tire une correction (nulle module fermé) AJOUTÉE au transform, si
  bien que le côté ancré — là où est le bouton — reste fixe pendant la métamorphose : la correction
  s'anime AVEC la largeur/hauteur (d'où `transform` ajouté à `transitionProperty`, sauf pendant un
  glissement où il doit suivre le doigt sans retard). Le recadrage (`ramenerDansLEcran`) borne
  toujours le ROND de 44 px, jamais le panneau ouvert : `ancre()` calcule la place du rond depuis le
  centre de la fenêtre et la ligne du bas mesurée quand le module est fermé (`baseBasRef`), rafraîchie
  au redimensionnement. Le choix se recalcule à l'ouverture et au `resize`. Verrouillé par les cas
  « le panneau s'ouvre du côté où il y a de la place » de `server/src/test/position-voix.test.ts`.
- **Lâché tout près d'un bord, le module de voix S'Y ACCROCHE et se RÉDUIT**
  (`bordDaccroche` / `decalageAccroche`, `shared/src/position-voix.ts`). La place retenue reste un
  décalage `{x, y}`, mais elle porte EN PLUS un `bord` (`gauche`, `droite` ou `bas`, JAMAIS le haut)
  quand le module est accroché — `placeRetenue` lit l'ancien format `{x, y}` seul comme une place
  libre. Au relâchement, `bordDaccroche` regarde la boîte du rond lâché : si un bord est à moins de
  `SEUIL_ACCROCHE_VOIX` (20 px ; la règle de visibilité tient déjà le module à 8 px du bord, donc
  bien en deçà), le module s'y range. Fermé, il se montre en PASTILLE réduite (`VOIX_PASTILLE`,
  30 px, `voix-assistant.tsx`) À MOITIÉ engagée hors de l'écran (`demiDehors`), même en parlant —
  l'accroche ne coupe ni la voix ni les ondes. Survolé (souris) ou touché (doigt), il revient à sa
  taille et OUVRE son panneau, calé AU RAS du bord (`demiDehors` faux, bord extérieur sur le bord de
  l'écran, jamais à une marge : sinon le panneau, en s'ouvrant vers l'intérieur, découvrirait le
  point de survol et re-fermerait aussitôt) ; `sensDouverture` fait le reste. Tiré vers le centre, le
  module se DÉCROCHE de lui-même : plus aucun bord proche au relâchement, la place rangée redevient
  libre. La place accrochée se RECALCULE à chaque rendu depuis le bord et la fenêtre (jamais rangée
  au redimensionnement) : `ramenerDansLEcran` ne vaut donc QUE pour les places libres. Le module
  porte `data-accrochee` et `data-bord`. Verrouillé par `server/src/test/position-voix.test.ts` et
  `scripts/verif-position-voix.mjs` (cas d'accroche, souris et doigt).
- **L'ÉCOUTE PERMANENTE ne s'ouvre JAMAIS toute seule, et le mot de réveil est « Dis Haiko »**
  (règles pures dans `shared/src/reveil-vocal.ts`, micro et découpe dans `web/src/lib/ecoute.ts`,
  affichage dans `web/src/components/voix-assistant.tsx`). Un interrupteur vit dans le panneau
  déplié du module de voix, à côté du Muet (`data-interrupteur-ecoute`, préférence SERVEUR
  `CLE_VOIX_ECOUTE` = `voix.ecoute`, **éteinte par défaut**) : tant qu'il est éteint, aucun micro,
  aucun flux, aucun envoi. Allumé, `useEcoutePermanente` ouvre le micro, mesure le volume et
  découpe ce qui est dit en TRANCHES séparées par `SILENCE_FIN_MS` (2 s) ; une tranche
  SILENCIEUSE ne part jamais, et celles qui partent passent par le chemin DÉJÀ en place
  (`/api/transcribe`, le même que le bouton micro de la barre d'écriture, qui ne bouge pas). Aucun
  son n'est gardé : la tranche est envoyée puis jetée, et le serveur efface son fichier temporaire.
  Le texte revenu entre par UN SEUL point (`recevoirParole`) — celui-là même que le point d'essai de
  la page (`window.haikodevEssai.parole`) emprunte, si bien qu'un script vérifie ce qui tourne
  vraiment. Les RÈGLES de lecture sont pures et sans navigateur : `finDuReveil` reconnaît « Dis
  Haiko » à `REVEIL_ECART_MAX` (2) lettres près sur la forme normalisée `dishaiko` — accents,
  majuscules et ponctuation effacés, mots recollés — donc « Dis Haïko », « Dis, Haiko »,
  « Dishaiko », « Dit aïko » comptent, et le réveil vaut AU MILIEU d'une phrase (ce qui suit devient
  la dictée). L'index rendu compte des mots du texte BRUT — la normalisation sert à reconnaître,
  jamais à remplacer ce qui a été dit. `lireParole(texte, ecouteEnCours)` tranche : en guet, seule
  une phrase portant le réveil compte ; en écoute, tout s'ajoute (`assemblerDictee`). Les états
  (`EtatEcoute`, portés par `data-etat-ecoute`) sont `eteinte`, `guette`, `ecoute`, `relit`,
  `refusee`. Le module se MÉTAMORPHOSE pour la dictée comme pour la parole (`formeDuModule` prend un
  quatrième argument) : bandeau `data-dictee` au-dessus du creux d'ondes, et les ondes passent au
  ROUGE (`bg-danger`, `data-onde-ecoute`) en suivant le volume du MICRO (`lireNiveauxMicro`), le vert
  restant celui de la parole. Un point rouge (`data-temoin-micro`) dit qu'un micro est ouvert en
  guet : jamais d'écoute muette. Une dictée VIDE (« Dis Haiko » seul) n'est jamais close — on attend
  la suite ; une phrase complète s'affiche `RELECTURE_MS` (2 s) puis est PUBLIÉE sur un canal unique
  (`EVENEMENT_DICTEE` = `haikodev:dictee`, `surDictee`) — À QUI elle est adressée ne se décide pas
  là. « Annule » est entendu À TOUT MOMENT, la relecture comprise (c'est justement le temps qu'on a
  pour se raviser), et un clic sur le bandeau fait la même chose. Un micro refusé se DIT
  (`REFUS_MICRO`, message court + ligne `data-erreur-micro` dans le panneau). Verrouillé par
  `server/src/test/reveil-vocal.test.ts` et `scripts/verif-reveil-vocal.mjs`.
- **Le FORMAT d'enregistrement se DEMANDE au navigateur, il ne s'impose pas**
  (`shared/src/format-enregistrement.ts`). `new MediaRecorder(flux, { mimeType: 'audio/webm' })`
  lève une erreur sur Safari (iPhone compris), qui ne connaît pas ce format — et cette erreur,
  lancée hors de toute protection, remontait jusqu'à la page. `formatDEnregistrement(estAccepte)`
  reçoit la question du navigateur (`MediaRecorder.isTypeSupported`) et rend le PREMIER format de
  `FORMATS_ENREGISTREMENT` qu'il accepte ; aucun format commun — ou un navigateur qui ne sait pas
  répondre — n'impose RIEN (`mimeType` absent), et l'enregistreur est construit sans option, ce
  qu'aucun navigateur ne refuse. Le format retenu emporte son EXTENSION (`extensionDuType`), relue
  sur l'enregistreur réel (`rec.mimeType`) : c'est elle qui part en `x-audio-ext` et qui nomme le
  fichier confié à la transcription — un son Safari nommé « .webm » se lirait mal. Les trois
  ouvertures de `web/src/lib/ecoute.ts` (micro, contexte audio, enregistreur) sont sous protection
  et `renoncer()` referme TOUT en le disant (`ENREGISTREMENT_IMPOSSIBLE`, `SON_INDISPONIBLE`) :
  jamais un micro laissé ouvert qui n'envoie rien. L'effet du micro ne dépend plus que de
  l'INTERRUPTEUR (`[actif]` seul, tout le reste par références) : il ne se ferme et ne se rouvre
  plus au gré des reconstructions de fonctions. Verrouillé par
  `server/src/test/format-enregistrement.test.ts` et `scripts/verif-ecoute-mobile.mjs`.
- **Ce qui FLOTTE au-dessus de l'écran a son filet, et ce filet est MUET** (`Filet`,
  `web/src/components/filet.tsx`). Le module de voix n'était enveloppé par aucun filet, alors que
  le tableau, la conversation et les réglages le sont : une erreur de son affichage remontait au
  filet de dernier recours et remplaçait TOUTE l'application par un message. Il porte désormais le
  sien (`<Filet zone="Module de voix" muet>`), avec la propriété `muet` : la panne est retenue et
  écrite en console, mais RIEN ne s'affiche — l'encadré d'erreur, haut de 240 px, se poserait en
  travers de l'écran pour un accessoire. Tout ce qui flotte par-dessus l'application suit cette
  règle : filet muet, application intacte.
- **Une place retenue du module de voix au-delà de toute échelle d'écran est JETÉE**
  (`DECALAGE_VOIX_MAX`, `shared/src/position-voix.ts`). `estDecalageVoix` ne se contentait plus d'un
  nombre fini : le recadrage (`ramenerDansLEcran`) se calcule DEPUIS le décalage, si bien qu'une
  valeur partie à la dérive borne son propre correctif et ne se répare jamais — le module se
  retrouvait à des milliards de pixels, introuvable et figeant la page. Au-delà de 20 000 px, la
  place retenue retombe donc sur l'origine, le bord d'accroche étant conservé.
- **La voix est PARTAGÉE — un seul son à la fois — et TOUT message de la conversation s'écoute**
  (`web/src/lib/voix.ts`, `texteAEcouter` dans `shared/src/lecture-message.ts`). Les annonces
  automatiques (module de voix) et l'écoute d'un message passent par le MÊME lecteur : `direVoix`
  arrête d'abord toute parole en cours, `taireVoix` coupe, `useVoix` publie `{parle, cle}` — une
  parole chasse l'autre, d'où qu'elle vienne, et l'onde s'anime pour les deux. `voix-assistant.tsx`
  n'a plus son propre audio : `parle` vient de `useVoix`, l'annonce automatique appelle `direVoix`
  seulement hors Muet (la trace reste en historique même en Muet), la réécoute manuelle passe outre.
  Sous chaque message, à côté de « Copier », `BoutonEcoute` (`web/src/components/message-view.tsx`)
  lit avec `cle = message.id` : c'est LUI qui parle → il bascule en « Arrêter ». `texteAEcouter`
  nettoie le Markdown pour l'oreille et RAMÈNE un texte trop long à ses premières phrases complètes
  sous `VOIX_LONGUEUR_MAX`, jamais coupé au milieu d'un mot (sinon coupe au dernier mot + « … »). Les
  messages lus à la main N'ENTRENT PAS dans l'historique des annonces : deux choses distinctes.
  Verrouillé par `server/src/test/lecture-message.test.ts` ; l'écoute réelle se voit au navigateur
  (serveur de développement).
- **Une phrase DICTÉE est routée vers un projet par une règle PURE, jamais par un moteur payant**
  (`shared/src/routage-vocal.ts`, branché par `server/src/routage-vocal.ts`). Le chef d'orchestre est
  attaché à UN projet ; une phrase dictée n'avait donc aucun destinataire. La commande
  `voix.demande` (un seul champ, `texte`) confie la phrase à l'assistant GLOBAL : il lit
  `store.listProjects()` (archivés écartés d'office) et `routerLaDemande` tranche — nom CITÉ (le nom
  du projet apparaît tel quel, accents et ponctuation ignorés, les mots recollés pour rattraper
  « aïko dev »), nom APPROCHANT (distance de Levenshtein au-dessus de `SEUIL_APPROCHANT`, et
  seulement s'il devance le suivant d'`ECART_APPROCHANT` — sinon on demande), ou projet UNIQUE. Le
  doute se paie d'une QUESTION, jamais d'un pari : deux noms cités, aucun nom, ou un projet clair
  mais une action de moins de `MOTS_MIN_ACTION` mots (« HaikoDev » tout seul) posent la question.
  Une question s'affiche forcément DANS une conversation, donc dans un projet : `lieuDeLaQuestion`
  choisit le projet déjà retenu, sinon le premier candidat, sinon le projet actif, sinon le premier
  du tableau. C'est une vraie question d'agent (même `AgentQuestion`, même triangle orange, même
  montée du compte d'attention, donc même annonce vocale) — l'assistant ne code pas, ne crée aucune
  carte et ne touche à aucun projet archivé : il DÉPOSE la phrase telle quelle dans le chef
  d'orchestre du projet et lance le tour, le chef gardant son tri. La dictée en attente est rangée
  EN BASE (table `dictees`, migration 12) : un redémarrage entre la question et la réponse ne perd
  rien. `question.answer` REGARDE cette table AVANT de rendre la main à l'agent qui a posé la
  question — une question de routage ne vient pas d'un moteur en train de réfléchir, sa réponse doit
  faire partir la demande AILLEURS. `suiteDuRoutage` distingue les deux cas : quand le PROJET
  manquait, la réponse nomme le projet et c'est la phrase d'origine qui part ; quand l'ACTION
  manquait, le projet est déjà connu et c'est la réponse qui EST la demande. La réponse se donne
  aussi à la VOIX : une phrase dictée moins de `DELAI_REPONSE_DICTEE_MS` (10 min) après la question
  est lue comme sa réponse, et inscrite dans la question pour éteindre le triangle. Une réponse
  incomprise ne dépose RIEN et le dit dans la conversation. Verrouillé par
  `server/src/test/routage-vocal.test.ts` et `scripts/verif-assistant-vocal.mjs`.
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
- **Une question POSÉE EN TEXTE compte comme décision attendue** (`shared/src/question-en-texte.ts`).
  Un agent doit passer par l'outil `ask_user` — la consigne le dit désormais en toutes lettres
  (point 6 de `METHODE`, repris dans `rappelDeMethode`, verrouillé par
  `server/src/test/question-par-outil.test.ts`). Mais rien n'oblige un moteur à s'en servir : écrite
  à la fin de sa réponse, la question termine le tour normalement (`exitCode` 0), n'enregistre rien,
  et la carte reste en « En cours » sans que personne ne sache qu'on l'attend. `decisionEnTexteLibre`
  reconnaît donc le cas — agent qui ne travaille plus, dernière phrase finissant par « ? », entre 20
  et 400 signes, ni question d'outil ni proposition déjà comptée — et `decisionsEnAttente`
  (`server/src/store.ts`) en fait une décision de plus, qui allume le MÊME triangle orange. Le
  message jugé est le dernier de la CARTE, tous agents confondus, jamais le dernier de chaque fil :
  une carte passe de main en main, et le fil d'un ancien agent se fige sur sa dernière phrase — la
  question y resterait la plus récente à jamais alors qu'un agent suivant y a répondu et fini le
  travail. Une carte RANGÉE ne réclame plus rien (`carteRangee` : « Terminé », « À déployer »,
  « Archivé ») ; sans colonne connue, on ne présume rien, donc le rappel de fin de tour
  (`runTurn`) ne change pas. Seuls les agents portant une CARTE sont jugés : le chef d'orchestre finit
  une réponse sur deux par « voulez-vous que… », et son fil est déjà sous les yeux de qui l'a écrit.
  Elle PRÉVIENT aussi : en fin de tour réussi, `runTurn` (`server/src/runtime.ts`) passe par le même
  guichet `notify` avec le motif `decision-attendue` déjà prévu — la référence est la CARTE, donc
  deux tours qui reposent la question ne font qu'une alerte, et un agent qui a AUSSI appelé l'outil
  n'en fait qu'une (dédoublonnage par sujet). Verrouillé par
  `server/src/test/relance-carte.test.ts` et `server/src/test/question-deja-reglee.test.ts`.
- **Le triangle DIT, le bouton « Répondre » EMMÈNE** (`web/src/components/board.tsx`). La carte du
  tableau qui attend une décision porte, sous son titre, un bouton `data-repondre-carte` — jamais
  ailleurs, comme tout bouton de décision. Il ouvre le tiroir de la carte, qui s'ouvre alors sur
  l'onglet « Conversation » et non sur « Détails » (`card-panel.tsx` : `decisions > 0` l'emporte sur
  la règle habituelle), là où la question et son champ de réponse attendent. Vérifié par
  `scripts/verif-carte-sans-suite.mjs`.
- **Un onglet du tableau (téléphone) PORTE le repère de sa colonne** (`signalOnglet`,
  `web/src/components/board.tsx`). La rangée d'onglets n'existe que sur téléphone ; chaque onglet
  reprend la MÊME grammaire que la ligne d'un projet — triangle orange `RepereAttention` si une carte
  de la colonne attend une décision, sinon point bleu `bg-info animate-pulse-soft` si un travail y est
  rendu pas encore lu. Un seul repère D'ATTENTE par onglet : `repereVisible` tranche, la décision
  d'abord. À CÔTÉ, un indicateur d'ACTIVITÉ — un robot `Bot text-success` dans l'esprit de
  `RepereRobot` (le nombre seulement à partir de deux, rien qui tourne) — quand au moins une carte de
  la colonne est en état `travaille` ; il COEXISTE avec le repère d'attente et ne passe pas par
  `repereVisible`. Chaque onglet porte AUSSI le NOMBRE de cartes de sa colonne, juste après le
  libellé, dans la tenue de la tête de colonne (11,5 px, `text-faint`, `data-onglet-compte`) : il est
  toujours écrit, ZÉRO compris — un chiffre qui disparaît saute d'un onglet à l'autre. Le compte vient
  du même passage sur `byColumn` que les trois autres (`signalOnglet.total`), donc l'onglet et la tête
  de colonne ne peuvent pas se contredire. Les trois comptes se calculent sur place, colonne par colonne, en croisant
  `byColumn` avec `decisionsParCarte(state.decisions)` et `etatVisuelCarte(...)` (`'termine-non-lu'`
  pour le point bleu, `'travaille'` pour le robot) — aucune couleur ni composant neufs. Vérifié par
  `scripts/verif-onglets-tableau.mjs`.
- **Le menu du bas (téléphone) FLOTTE, et ne pose aucun filet** (`nav[data-menu-bas]`,
  `web/src/app.tsx`). Le conteneur reste dans le FLUX (`shrink-0`, marges `px-3`, bas =
  `env(safe-area-inset-bottom) + 0.5rem`) : il réserve exactement la place du menu, donc le contenu
  ne passe jamais derrière — mais il est nu, sans fond ni bordure. C'est le bloc INTÉRIEUR qui se
  voit : arrondi (`rounded-2xl`), fond `bg-surface`, ombre douce, une bordure sur ses quatre côtés —
  jamais un `border-t` sur toute la largeur, qui coupait l'écran. Trois destinations, trois icônes
  DISTINCTES (`Columns3` tableau, `BarChart3` bord, `MessageSquare` chef) et trois libellés d'un
  mot — « Tableau », « Bord », « Chef » — qui tiennent sur une ligne à 360 px. Le triangle de
  décision reste sur « Chef ». Rien au-dessus du seuil (`sm:hidden`). Le bloc en bas à droite part
  de `bottom-14` sur téléphone (`sm:bottom-3` ailleurs) pour ne pas se poser sur ce menu. Vérifié
  par `scripts/verif-menu-bas-telephone.mjs`.
- **Le tiroir d'une carte s'ÉPURE sur téléphone, jamais sur ordinateur** (`card-panel.tsx`). Le choix
  se fait sur la largeur du pointeur (`useTelephone`, `(max-width: 639px)`), relue au redimensionnement.
  Sous ce seuil, les tags (état, étiquettes, « modifiée », archivage) — le bloc `data-tags-carte` — sont
  MASQUÉS par défaut et se déplient d'un chevron posé à droite du titre, avant le menu trois points ;
  et la barre d'onglets (`data-barre-onglets`) se replie en hauteur quand on descend dans le contenu,
  revient quand on remonte, l'onglet actif restant choisi. Le défilement est capté par
  `onScrollCapture` sur la racine des `Tabs` — scroll ne remonte pas en bulle mais descend en capture,
  donc un même handler couvre tous les onglets (chat compris). Au-dessus du seuil, tags toujours
  visibles, aucun chevron, barre fixe. Vérifié par `scripts/verif-tiroir-carte-telephone.mjs`.
- **Un départ de tour efface la SUSPENSION, quel que soit le chemin**
  (`replacerCarteAuDemarrage`, `server/src/runtime.ts`). Répondre à une question relançait bien la
  carte — `question.answer` appelle `sendPrompt` —, mais `scheduling.suspendu` restait posée : la
  carte repartait pour ce tour-là puis retombait en file sans que l'ordonnanceur ne la reprenne
  jamais. La marque et sa `waitingReason` sont donc effacées au départ, exactement comme le fait
  déjà `startCard` : les deux seuls départs possibles traitent la suspension pareil.
- **Une carte figée en « En cours » le DIT** (`mentionSansSuite`, `shared/src/carte-sans-suite.ts`).
  Entre la roue qui tourne et la carte close, il existait un troisième état muet : le tour s'est
  achevé, aucun agent ne travaille, personne n'a repris. Passé une heure (`DELAI_SANS_SUITE`), la
  carte du tableau porte « Tour terminé sans suite depuis N h » en gris pâle — pas une alerte, rien
  n'est cassé. Quatre silences : hors de « En cours », agent au travail, tour trop récent, et
  décision déjà en attente (le triangle dit mieux ce qui bloque, deux repères feraient du bruit).
  L'heure avance par une horloge UNIQUE partagée (`useMinute`, `web/src/lib/horloge.ts`) : vingt
  cartes ne font pas vingt minuteries, et la mention apparaît sans attendre un événement du serveur.
  Verrouillé par `server/src/test/carte-sans-suite.test.ts` et `scripts/verif-carte-sans-suite.mjs`.
- **L'avancement « n/N faites » d'une carte en cours VOYAGE avec l'agent**
  (`mentionProgressionTaches`, `shared/src/progression-taches.ts`). Les étapes cochées de la liste de
  tâches vivent sur les MESSAGES, souvent chargés seulement à l'ouverture d'une carte : le tableau ne
  les voyait donc pas. Le démon pose désormais le décompte sur l'agent lui-même (`Agent.todos` =
  `{done, total}`, `shared/src/models.ts`) — remis à zéro au départ d'un tour, mis à jour à chaque
  événement `todo` en relisant l'agent frais pour ne pas écraser un statut posé ailleurs
  (`server/src/runtime.ts`). La carte du tableau lit l'agent de rôle « task » encore au travail et
  affiche « n/N faites » dans le décroché du bas (`CardTile`, `web/src/components/board.tsx`), avec le
  pluriel du volet des tâches. Trois silences : hors « En cours », aucun agent de tâche au travail, ou
  pas encore de liste. Ce décroché garde ses états prioritaires (chiffrage, attente, échec) : la
  mention ne parle que lorsqu'aucun d'eux ne parle. Verrouillé par
  `server/src/test/progression-taches.test.ts` et `scripts/verif-progression-taches.mjs`.
- **Un pied de colonne agit en LOT, toujours en deux temps et toujours par le même mécanisme**
  (`ACTIONS_DE_LOT`, `web/src/components/board.tsx`). Premier clic : une case à cocher sort du coin
  haut-gauche de chaque carte, TOUTES cochées, et le pied devient « Annuler » / « <verbe> (n) ».
  Annuler ne touche à rien ; confirmer déplace les cartes restées cochées vers la colonne `cible`,
  par `client.moveCard` — le MÊME appel que le bouton du tiroir. Une carte après l'autre par défaut
  (l'archivage écrit un document, la validation chiffre), SAUF « Tout lancer » (`parallele: true`) :
  ses cartes partent ENSEMBLE (`Promise.all` sur la sélection), chacune ayant sa copie de travail et
  sa branche, donc les robots s'allument en même temps. Le compte rendu (`bilanDeLot`) ne bouge pas.
  Une seule colonne en
  sélection à la fois, et pas de pied sur une colonne vide. Cinq entrées aujourd'hui : « À faire » →
  « Tout valider » vers « Validé », « Planifié » → « Tout lancer » vers « En cours », « Terminé » →
  « Tout déployer » vers « À déployer » (déplacement seul, RIEN n'est mis en ligne), « À déployer » →
  « Tout mettre en production » vers « En production », « En production » → « Tout archiver » vers
  « Archivé ». Un pied suit le parcours de la carte : on n'archive jamais
  par-dessus une étape de mise en ligne. « Tout lancer » n'a AUCUN chemin à lui : le dépôt en « En cours »
  valant déjà le clic sur « Lancer maintenant », le serveur passe par `startCard` — portes dures
  comprises — et une carte refusée revient à « Planifié » avec sa raison pendant que le lot continue.
  Ajouter une colonne, c'est ajouter une ligne à cette liste — jamais un second mécanisme. Vérifié par
  `scripts/verif-lot-a-faire.mjs`, `scripts/verif-lot-termine.mjs`, `scripts/verif-lot-planifie.mjs`
  et `scripts/verif-lot-production.mjs`.
- **Un lot va jusqu'à la DERNIÈRE carte et rend des comptes** (`bilanDeLot`,
  `shared/src/lot-colonne.ts`). Chaque carte est tentée dans son propre `try` : un refus — le plus
  courant, `porteDuDossier` quand un agent travaille déjà dans le dossier — n'arrête pas les
  suivantes, qui doivent toutes recevoir leur `waitingReason`. Le lot appelle `client.moveCard` en
  mode `silencieux` (pas une bulle par carte) et publie UN compte rendu : combien de cartes
  déplacées, combien en attente, et chaque refusée NOMMÉE avec sa raison (trois au plus, le reste
  annoncé). Rien passé = message rouge, lot partiel = orange. Le pied se referme dans tous les cas.
  Corollaire côté client : **la retombée optimiste ne remet JAMAIS la vieille copie de la carte** —
  le serveur vient d'y écrire la raison de l'attente, on ne rend que la COLONNE sur la version la
  plus fraîche, sinon la carte revient sans un mot. Le bilan NOMME le projet (préfixe
  « Projet « … » — » quand le nom est connu, passé par `board.tsx`) et TRADUIT les raisons techniques
  du navigateur (`traduireRaison`, `shared/src/lot-colonne.ts`) : « le serveur ne répond pas » devient
  « le serveur n'a pas répondu à temps ; la carte n'a peut-être pas démarré — vérifiez la colonne ».
  Les raisons déjà métier (dossier occupé, plus de place, aucun compte) passent telles quelles.
  Verrouillé par `server/src/test/lot-colonne.test.ts` et `scripts/verif-lot-planifie.mjs`.
- **Un message court d'échec de publication NOMME le projet, l'étape tombée et où lire le détail**
  (`messageEchecPublication`, `shared/src/mise-en-ligne.ts`). Le `bus.toast('error', …)` de
  `server/src/deploy.ts` ne recopie plus l'exception brute : l'étape en échec est celle marquée
  `failed` (sinon `current.currentStep`), son libellé vient de `STEP_LABELS`, et la phrase renvoie
  vers le bloc de publication du projet. Les notifications qui SORTENT de l'application ne changent
  pas. Règle pure, ignorante des clés d'étape (l'appelant passe le libellé déjà résolu).
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
  (`web/src/components/chat.tsx`). Les messages vivent dans un bloc unique, `shrink-0`, qui fait au
  moins toute la hauteur du fil et range son contenu par le bas (`flex min-h-full flex-col
  justify-end`) : un échange court — une phrase du chef et sa carte proposée — se termine juste
  au-dessus du volet des tâches au lieu de laisser un demi-écran noir, et un échange qui déborde
  fait grandir le bloc, donc défile normalement, haut compris. On ne s'en remet PLUS à une marge
  automatique (`mt-auto`) : dans un conteneur qui défile, sa résolution dépend du navigateur, et le
  vide revenait sur téléphone. `justify-end` va sur le BLOC, jamais sur la zone de défilement — là,
  il rendrait le haut du fil inatteignable. Le `shrink-0` n'est pas décoratif : sans lui, un fil
  trop long serait comprimé au lieu de défiler. Le fil porte `data-fil="conversation"`, seul repère
  des scripts de vérification. Verrouillé par `scripts/verif-vide-carte-validee.mjs`, qui couvre le
  fil court, le fil dont les échanges précédents sont repliés, et l'accès au haut du fil.
- **Le bloc en bas à droite porte DEUX piles, jamais une seule** (`web/src/components/pile.tsx`).
  Les messages courts et les vignettes d'agents s'empilent par le MÊME composant `Pile`, qui écrit
  une fois pour toutes la géométrie (`placeDansLaPile`), le survol et l'appui — mais chacun dans SA
  pile, avec son état d'ouverture : un message et un agent ne se lisent pas de la même façon.
  L'ordre du bloc ne bouge pas (messages, vignettes, commandes) et la sélection des agents affichés
  non plus (les six plus récents). Ce qu'on empile ne change que le NOM dit à l'écran, d'où le
  dernier argument de `resteDeLaPile` et d'`annonceDeLaPile` (« message » par défaut, « agent » pour
  les vignettes) : la règle reste unique. Pile ouverte, la croix d'une vignette et le bouton qui
  ouvre l'agent répondent de nouveau pour eux-mêmes, cibles de 32 px comprises. Vérifié par
  `scripts/verif-pile-messages.mjs` et `scripts/verif-pile-messages-appui.mjs`.
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
- **Une compétence partagée vit dans `data/competences/`, et elle est ANNONCÉE autant qu'installée**
  (`shared/src/competences.ts` pour les règles, `server/src/competences.ts` pour le disque). Une
  compétence est un dossier portant un `SKILL.md` — écrit là, ou simplement LIÉ depuis l'endroit où
  l'utilisateur le tient à jour ; en ajouter une, c'est poser un dossier de plus, rien d'autre. Deux
  chemins, tous deux nécessaires. Le COFFRE : au démarrage et à chaque compte connecté,
  `relierCompetencesAuxCoffres` pose chaque compétence dans `<coffre>/skills/<nom>` de chaque compte
  Claude — c'est le seul endroit où ce moteur va les chercher, et une place déjà prise est LAISSÉE
  telle quelle, jamais écrasée. Le BRIEFING : `texteDesCompetences` les nomme à tout agent, avec le
  chemin du mode d'emploi à ouvrir. Sans ce second chemin, Codex (qui n'a pas la notion) et le chef
  d'orchestre (à qui l'outil `Skill` est interdit, et qui le reste) répondraient « je ne sais pas
  faire » devant un mode d'emploi qui existe. Le dossier se déplace par `HAIKODEV_COMPETENCES`.
  Verrouillé par `server/src/test/competences.test.ts` et `scripts/verif-competences.mjs`.
- **La FACTURATION est un outil MCP `compta`, ouvert à TOUT agent — chef d'orchestre compris**
  (`server/src/tools.ts`). La compétence « compta » ne s'atteint qu'en ligne de commande
  (`node …/compta.mjs <commande>`), donc le chef bridé en lecture seule — pas de `Bash`, outil
  `Skill` interdit — ne pouvait pas facturer. L'outil `compta` (entrée de `TOOL_DEFS`, PAS dans
  `TASK_ONLY_TOOLS`) est donc vu par le chef comme par les agents de tâche : `toolsFor('orchestrator')`
  le porte, `orchestratorAllowList` l'énumère et Codex l'active dans `enabled_tools`. `callTool`
  lance le script de la compétence (`cheminScriptCompta`, déduit de `data/competences/compta`, jamais
  un chemin en dur vers un dossier personnel) DANS le processus du démon — hors du bac à sable du chef
  bridé, ce qui ouvre l'accès sans toucher au reste du bridage. Les garde-fous de la compétence ne
  bougent pas : créer en `draft`, `relance send:true` seulement après accord explicite de
  l'utilisateur. Verrouillé par `server/src/test/orchestrator-tools.test.ts` et
  `server/src/test/bridage-chef.test.ts`.
- **Un compte de moteur se connecte DEPUIS LES RÉGLAGES, jamais depuis un terminal**
  (`shared/src/connexion-compte.ts` pour les règles, `server/src/connexion-compte.ts` pour le
  processus). L'onglet « Comptes » ne faisait que lire : un jeton mort ne se voyait nulle part et se
  réparait en ligne de commande. `commandeDeConnexion` donne la commande de chaque moteur, et les
  deux ne se ressemblent PAS : Claude (`claude auth login`) ouvre une page et attend qu'on lui
  RECOPIE un code par son entrée standard ; Codex exige `login --device-auth` — sans ce mode il
  ouvrirait une page qui renvoie vers le serveur lui-même, injoignable depuis le navigateur de
  l'utilisateur. Chaque commande tourne dans le COFFRE du compte (`CLAUDE_CONFIG_DIR` / `CODEX_HOME`,
  un dossier par compte), `lireInvite` en extrait l'adresse et le code à saisir, et `raisonDeSortie`
  dit en français toute fin de course — commande absente, refus, abandon, délai dépassé. Une réussite
  rafraîchit le catalogue des modèles (événement `engines`) et le quota. Un compte NEUF prend sa
  place dans `data/accounts/<id>/` comme un compte de relève déclaré à la main, et n'entre dans la
  liste qu'une fois CONNECTÉ : une tentative ratée ne laisse pas de compte fantôme. L'état réel de
  chaque compte (`etatDeConnexion`, champ `AccountQuota.connexion`) voyage avec son quota — un quota
  intact ne prouve pas qu'un jeton tient encore, et un coffre sans fichier d'identifiants échoue sur
  le FICHIER ABSENT, pas sur un jeton vide. Verrouillé par
  `server/src/test/connexion-compte.test.ts` et `scripts/verif-connexion-compte.mjs`.
- **Une INFOBULLE ne se pose que là où l'on survole, et une petite cible s'AGRANDIT sans grossir**
  (`Tooltip` et `Switch`, `web/src/components/ui/index.tsx`). L'infobulle est masquée sous `sm` : son
  déclencheur n'y servait qu'à s'interposer entre le doigt et ce qu'il vise. `Tooltip` interroge donc
  la CAPACITÉ du pointeur (`useSurvol`, `web/src/lib/pointeur.ts`, même `REQUETE_SURVOL` que la pile
  des messages) et, sans survol, ne monte AUCUN déclencheur — il rend son enfant tel quel. À la
  souris, rien ne change. L'interrupteur, lui, ne fait que 18 px de haut : un calque invisible
  (`after:`) de 36 × 32 px centré dessus reçoit l'appui, sans changer l'aspect ni la place occupée.
  Piège de vérification : quand l'infobulle est là, son `data-state` recouvre celui de l'interrupteur
  — l'état coché se lit sur `aria-checked`. Vérifié par `scripts/verif-interrupteur-compte.mjs`.
- **Un interrupteur qui attend une réponse le DIT dans son rond** (propriété `attente` du `Switch`,
  `web/src/components/ui/index.tsx`). Une bascule qui part au serveur et attend son accusé de
  réception ne changeait rien à l'écran : sur une liaison lente, on ré-appuyait. `attente` pose donc
  DANS le pouce de 13 px un anneau minuscule qui tourne (`data-voyant-attente`, `animate-spin`), pose
  `aria-busy` et BLOQUE l'interrupteur — pas de second appui qui partirait en double. La couleur de
  l'anneau est celle du rond d'en face (`border-t-accent-fg`, et `border-t-accent` quand c'est coché,
  lu sur le `data-state` du POUCE, pas de la racine) : le rond change de teinte d'un état à l'autre,
  un anneau de couleur fixe disparaîtrait dans l'un des deux. L'aspect au repos, la taille et le
  calque tactile de 36 × 32 px ne bougent pas. Premier usage : l'interrupteur d'un compte du volet
  des quotas (`quota-badge.tsx`), où le voyant s'éteint dans un `finally` — donc aussi sur un refus
  du serveur ou une panne de liaison. Vérifié par `scripts/verif-interrupteur-compte.mjs`, dont le
  banc d'essai sait retarder la réponse (`window.__essaiInterrupteur.retard`).
- **Couper un compte se fait avec ACCUSÉ DE RÉCEPTION** (`quota-badge.tsx`). `account.disable`
  partait par `client.send`, sans réponse : un refus du serveur ne s'affichait nulle part et le
  compte qu'on croyait coupé continuait d'être consommé. Il passe par `client.call` ; un `ok: false`
  comme une panne de liaison sortent en message court d'erreur.
- **Un compte COUPÉ à la main reste visible, éteint** (`disabled`, `server/src/accounts.ts`).
  L'interrupteur du volet Quotas (`quota-badge.tsx`, commande `account.disable`) pose `disabled` sur
  le compte, écrit sur lui donc survivant au redémarrage. `listAccountRecords()` — la liste
  UTILISABLE (ordonnanceur, amorçage via `etatDesComptes`, catalogue) — l'écarte ; `listAllAccountRecords()`
  le garde pour le volet et pour la commande. `ajouterComptesDesactives` le rejoue dans les quotas
  depuis son dernier relevé (marqué `disabled`, indisponible), et `markActive` ne le choisit jamais
  comme compte actif. Rien n'est supprimé, aucun identifiant touché. Un compte coupé reste coupé
  APRÈS un redémarrage : `bootstrapAccounts` calcule ses comptes déjà connus avec
  `listAllAccountRecords()` (jamais `listAccountRecords()`, qui filtre les désactivés) — sinon un
  compte coupé, n'étant plus « connu », serait reconstruit à neuf sans son drapeau et se rallumerait.
  Verrouillé par `server/src/test/compte-desactive.test.ts`.
- **Un compte se RENOMME depuis l'onglet Comptes, et on ne touche QU'au nom** (`renameAccount`,
  `server/src/accounts.ts`). Chaque ligne porte un crayon qui ouvre un champ (`LigneCompte`,
  `web/src/components/settings-view.tsx`) ; la saisie part par `account.rename` (esprit
  d'`account.disable`), qui écrit le nouveau `label` via `saveAccountRecord` — durable au
  redémarrage — puis relit les quotas, si bien que le nom retenu remonte partout où le compte est
  nommé (onglet Comptes, volet des quotas, notifications). Un nom vide ou fait d'espaces est REFUSÉ
  (`ok: false`) et le compte garde son ancien nom ; le nom est débarrassé de ses espaces de bord.
  Ni priorité, ni moteur, ni coffre, ni identifiants touchés. Le nom affiché vient du RELEVÉ de
  quota : un compte dont la lecture est EN PAUSE (après un refus 429, `nextTry` dans le futur)
  repousse son dernier relevé mémorisé, qui figeait l'ancien nom. Deux garde-fous : `renameAccount`
  met à jour le `label` du relevé en cache, et `refreshQuotas` réapplique TOUJOURS `account.label`
  sur un relevé réutilisé — le nom vient du compte, jamais du relevé. Verrouillé par
  `server/src/test/compte-renomme.test.ts` et `server/src/test/compte-renomme-en-pause.test.ts`.
- **Le bloc du cerveau dit UNE chose et propose le geste qui débloque**
  (`shared/src/bloc-cerveau.ts`). `ligneEtatCerveau` rend UNE seule ligne d'état — clé manquante,
  dernier envoi réussi, ou aucun envoi abouti — là où le bloc empilait un badge, un encadré orange
  et une liste d'erreurs qui redisaient tous « aucune clé ». `erreursUtiles` écarte toute erreur
  qui redit l'absence de clé (l'état la porte déjà, et elle est périmée dès la clé posée),
  dédoublonne le reste et n'en montre que trois. Quand la clé manque, le bloc porte un CHAMP de
  saisie : `cerveau.cle` la range par `enregistrerCleCerveau` (`server/src/cle-cerveau.ts`) dans le
  fichier d'environnement du service — `HAIKODEV_ENV_FILE`, `/etc/haikodev.env` par défaut, sinon
  repli dans le dossier de données — et la pose du même coup dans le processus : elle vaut aussitôt,
  sans redémarrage. `cleCerveau` lit désormais par `lireCleCerveau`, dans l'ordre même de
  l'ÉCRITURE : environnement, puis FICHIER DU SERVICE, puis repli du dossier de données
  (`data/cerveau.cle`). L'inverse — repli d'abord — laissait un vieux repli MASQUER toute clé neuve
  posée dans le fichier du service, et faisait tomber les contrôles dès qu'un repli traînait dans
  `data/`. Le mécanisme d'envoi ne bouge pas. Verrouillé par
  `server/src/test/bloc-cerveau.test.ts`, `server/src/test/cle-cerveau.test.ts` et
  `scripts/verif-cerveau-reglages.mjs` (qui vise un fichier d'environnement TEMPORAIRE).
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
- **Rien du projet ne pointe vers le dossier personnel d'un utilisateur.** Un chemin comme
  `/home/<quelqu'un>/…` écrit en dur fait tenir HaikoDev sur un compte qui peut disparaître, et
  qu'aucune installation neuve n'aura. Une bibliothèque se déclare dans `package.json` et s'importe
  par son nom ; un outil dont le démon dépend est COPIÉ dans `outils/` et s'atteint depuis `ROOT`
  (`server/src/config.ts`) ; à défaut, on passe par le dossier personnel COURANT (`os.homedir()`,
  `os.userInfo().username`), jamais par un nom écrit en dur. Restent hors de cette règle les scripts
  qui parlent d'un AUTRE projet (reprise des anciennes tâches) : ce chemin-là est leur sujet.
  **Vrai aussi du dossier de travail d'un projet du tableau** : il vit sous `/root/<projet>`, comme
  tous les autres, jamais dans le dossier personnel d'un compte système. Déplacer ce dossier, c'est
  écrire le nouveau chemin AUX DEUX endroits de la base — la colonne `path` et le champ `path` du
  JSON —, sans quoi les deux se contredisent.
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
- **L'échéance d'une fenêtre Codex est ÉPINGLÉE tant que la fenêtre ne change pas**
  (`memeFenetre`, `shared/src/notification-tri.ts`). Codex ne donne pas d'horodatage absolu : son
  `resetsAt` est recalculé en relatif à chaque lecture (`Date.now() + resets_in_seconds*1000`,
  `fetchCodexQuota`) et DÉRIVE de quelques secondes — chaque relevé (toutes les 10 min) semblait
  ouvrir une fenêtre neuve, et le palier 70/90 % de la semaine repartait. `refreshQuotas`
  (`server/src/accounts.ts`) réutilise donc l'échéance déjà en cache (session ET semaine) dès qu'elle
  est proche à `TOLERANCE_FENETRE_MS` (10 min) ; une VRAIE nouvelle fenêtre s'écarte de plusieurs
  jours et n'est jamais confondue. En défense, `franchissementSemaine` compare par `memeFenetre` et la
  `reference` du `notify` de palier ne porte PLUS le `resetsAt` (sa mémoire courte sert de second
  filet). Claude, dont `resetsAt` est absolu, ne change pas. Verrouillé par
  `server/src/test/notification-tri.test.ts`.
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
