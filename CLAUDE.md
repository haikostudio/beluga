# HaikoDev — instructions du moteur

Fichier court et factuel, tenu à jour AU FIL des tâches : comment lancer, comment vérifier, où
vivent les choses, ce qu'on n'enfreint pas. Aucun journal ici — les livraisons vont dans
`HISTORIQUE.md`, les règles apprises dans `MEMOIRE.md`. Le fichier est chargé À CHAQUE session : il
ne garde donc que le CONTRAT essentiel. Le TEXTE ENTIER des règles (invariants, fichiers, tests) vit
dans `docs/regles-du-moteur.md`, et le résumé d'un sujet se demande avec l'outil `project_memory`.

## Où vivent les choses

| Dossier | Rôle |
| --- | --- |
| `server/` | Le démon : base, protocole, ordonnanceur, agents, outils, publication |
| `web/` | L'interface : tableau, conversations, réglages, application installable |
| `shared/` | Les règles pures, sans base ni disque — donc testables seules |
| `scripts/` | Service système, identifiants, scripts de vérification |
| `docs/` | La documentation : le détail des règles (`regles-du-moteur.md`), les audits |
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
node scripts/verif-bandeau-propositions.mjs # les cartes proposées en bandeau fixe au-dessus de la barre d'écriture (démon d'essai à soi)
node scripts/verif-heure-permanente.mjs # l'heure sous les messages, sombre / clair / téléphone
node scripts/verif-signal-attention.mjs # la secousse, le triangle et le badge bleu — et leur report sur carte / conversation
node scripts/verif-onglets-tableau.mjs # le repère sur les onglets du tableau (téléphone) : triangle décision / point bleu non lu (serveur de développement, HAIKO_ONGLETS_URL)
node scripts/verif-carte-sans-suite.mjs # « tour terminé sans suite » sur une carte figée en « En cours » (serveur de développement, HAIKO_SANS_SUITE_URL)
node scripts/verif-progression-taches.mjs # l'avancement « n/N faites » dans le décroché des cartes « En cours » (serveur de développement, HAIKO_PROGRESSION_URL)
node scripts/verif-ligne-projet.mjs # la ligne d'un projet sur écran de téléphone : robot, repère unique
node scripts/verif-glissement-projets.mjs # ranger la colonne de gauche sans qu'une ligne saute
node scripts/verif-espace-dev.mjs   # l'espace de développement en bouton à part, hors de la liste des projets (serveur de développement, HAIKO_ESPACE_DEV_URL)
node scripts/verif-tiroir-quotas.mjs # le volet des quotas : défilement et poignée qui referme
node scripts/verif-interrupteur-compte.mjs # l'interrupteur d'un compte au doigt puis à la souris (serveur de développement, HAIKO_INTERRUPTEUR_URL ; aucun vrai compte touché)
node scripts/verif-tiroir-carte-telephone.mjs # le tiroir d'une carte épuré sur téléphone : tags repliés derrière un chevron, barre d'onglets cachée au défilement (serveur de développement, HAIKO_TIROIR_URL)
node scripts/verif-bloc-publication.mjs # le bloc de publication repart à zéro après une mise en ligne
node scripts/verif-mise-en-production.mjs # le bloc « Mise en production » des réglages du projet : concept écrit, prompt généré, enregistré, retrouvé au rechargement (serveur de développement, HAIKO_PRODUCTION_URL ; `project.update` et `production.generer` interceptés, persistance imitée par le stockage local, aucun projet réel touché)
node scripts/verif-adresse-nouveau-projet.mjs # l'adresse publique demandée au montage : champs de l'onglet « Nouveau projet », étape dans le déroulé, réglages sans créateur manuel (serveur de développement, HAIKO_ADRESSE_URL ; `project.new` intercepté, aucun dossier ni nom réellement créé)
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
node scripts/verif-mise-en-ligne.mjs # déployer fusionne, construit et pose la carte en « En production » ; publier clôt (dépôts d'essai à soi)
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
node scripts/verif-lot-production.mjs # la colonne « En production » : place, pieds de lot des deux colonnes, bloc de publication en tête de colonne, onglet téléphone (démon d'essai à soi)
node scripts/verif-sortie-archive.mjs # sortir une carte d'« Archivé » / « À déployer » à la main (démon d'essai à soi)
node scripts/verif-arret-carte.mjs  # le bouton d'arrêt d'une carte n'arrête que SA tâche (démon d'essai à soi)
node scripts/verif-branche-de-carte.mjs # une carte lancée obtient SA branche « tache/… » ET son dossier ; deux cartes démarrent ensemble (dépôt d'essai)
node scripts/verif-menu-bas-telephone.mjs # le menu flottant du bas, sur écran de téléphone (serveur de développement, HAIKO_MENU_URL)
node scripts/verif-pile-messages.mjs # la pile des messages courts : commandes en bas, profondeur, ouverture au survol, heure et date
node scripts/verif-pile-messages-appui.mjs # la pile des messages s'ouvre à l'appui au doigt, au survol à la souris (serveur de développement, HAIKO_PILE_URL)
node scripts/verif-module-voix.mjs  # le module de voix se métamorphose : rond au repos, panneau au survol/appui, bloc d'ondes en parlant (serveur de développement, HAIKO_VOIX_URL)
node scripts/verif-position-voix.mjs # le module de voix se tire à la souris et au doigt, sa place revient au rechargement et dans une autre fenêtre (serveur de développement, HAIKO_VOIX_URL)
node scripts/verif-reveil-vocal.mjs # l'écoute permanente : interrupteur, réveil « Dis Haiko », ondes rouges, relecture puis envoi, « Annule » et clic (serveur de développement, HAIKO_REVEIL_URL ; micro FACTICE muet, phrases injectées par le point d'essai — ni micro réel ni Whisper jugés)
node scripts/verif-ecoute-mobile.mjs # l'écoute permanente sur écran de téléphone : module ANCRÉ au menu du bas, cinq barres FIGÉES au repos (pas de flux animé), réveil « Dis Haiko » qui passe en écoute (ondes rouges, bandeau de dictée sans déborder), format d'enregistrement choisi avec repli, panne dite au lieu d'une page vide (serveur de développement, HAIKO_ECOUTE_URL ; micro FACTICE, transcription interceptée — ni Whisper ni quota touchés)
node scripts/verif-transcription-reveil.mjs # le réveil sur de la VRAIE parole : les voix Piper disent « Dis Haiko », le moteur de transcription du dépôt les relit, les règles pures tranchent (aucun navigateur, aucun serveur ; Piper et Whisper absents = contrôle qui le DIT et s'arrête, HAIKODEV_DATA)
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

Seul le CONTRAT essentiel vit ici. Le TEXTE ENTIER de chaque règle — invariants, fichiers, tests qui
la verrouillent — est dans `docs/regles-du-moteur.md` ; le résumé d'un sujet se demande aussi avec
l'outil `project_memory`. Déplacer une règle, c'est la porter dans `docs/regles-du-moteur.md`, jamais
l'effacer — et une règle durable qui change se met à jour AUX DEUX endroits.

### Publication

- **Ne jamais publier de sa propre initiative.** Enregistrer et pousser, oui ; mettre en ligne est un
  geste de l'utilisateur — aux deux étapes (déploiement, puis mise en production).
- **Ne JAMAIS redémarrer le serveur pendant une publication** (`shared/src/demon.ts`) : le démon
  porte toutes les publications, le couper en tranche une en plein vol. Un redémarrage demandé est
  retenu et rejoué tout seul dès la dernière publication finie.
- **Déployer, c'est fusionner le lot « À déployer » dans la principale, enregistrer, pousser, puis
  rafraîchir l'instance de dev** (`planDeMiseEnLigne`, `shared/src/mise-en-ligne.ts`) — toujours
  disponible, sans réglage. La MISE EN PRODUCTION, elle, ne suit QUE le prompt réglé du projet :
  sans prompt, elle est refusée, jamais menée à vide. La mise en ligne compte donc DEUX étapes, que
  la colonne « En production » sépare.

### Cartes

- **Toute demande de PROGRAMMATION ou d'EXÉCUTION passe par une carte**, quelle que soit sa taille :
  le chef PROPOSE (`board_create_card` / `propose_task`, description en quatre parties), la validation
  de l'utilisateur seule crée la carte. Une simple question se répond sans carte. Verrouillé par
  `server/src/test/tri-du-chef.test.ts`.
- **La carte suit les ÉTAPES RÉELLES du travail** (`shared/src/suivi-colonne.ts`) : seul un agent de
  rôle « task » la déplace ; « analysis », « orchestrator » et « deploy » ne la déplacent jamais.
- **Pas de code modifié dans le dépôt, pas de « Terminé ».** C'est le CONSTAT du dépôt qui clôt une
  carte, jamais le fait que le moteur ait répondu.
- **« Archivé », « En production » et « À déployer » ne se rouvrent que sur GESTE HUMAIN.** Un projet
  qu'on retire est MIS DE CÔTÉ (`project.archive`, `archived = 1`), jamais supprimé.

### Branches et dossiers

- **Une carte lancée a TOUJOURS sa branche « tache/… » et sa copie de travail à elle**
  (`git worktree`, `shared/src/dossier-de-carte.ts`) ; le démon fusionne cette branche dans la
  principale puis referme la copie en fin de tour. Refus dit si le projet n'est pas un dépôt git, ou
  si le dossier est déjà pris par une autre carte.
- **Une branche poussée n'est PAS livrée** : le travail d'une carte finit sur la branche principale.
  Un agent SANS carte enregistre et pousse SA branche `hors-tache/…`, jamais la principale — une
  fonctionnalité = une branche = un enregistrement, nommé.
- **Dossier partagé (chef, analyse, publication) : `git add` NOMMÉ un par un, jamais `git add -A`**
  — sinon on emporte le travail d'un autre agent dans son propre enregistrement.
- **Un agent de tâche travaille en accès complet ; le chef d'orchestre ne modifie aucun fichier
  existant** (sauf sur HaikoDev lui-même).

### Projets

- **Créer un projet, c'est le MONTER en entier** : dossier sur le serveur, dépôt git sur `main`,
  dépôt GitHub privé poussé, les sept fichiers de départ, l'adresse publique quand elle est demandée,
  puis l'inscription dans la colonne de gauche.
- **L'ADRESSE PUBLIQUE se demande AU MONTAGE** (nom court + port), avec l'outil `ask_user`, AVANT le
  premier dossier — jamais après coup. Elle devient `Project.devUrl`, l'adresse contrôlée à la fin de
  chaque déploiement.
- **Un projet se déclare sur son DÉPÔT DE TRAVAIL, jamais sur son dossier publié** : un dossier servi
  n'est pas un dépôt git, l'agent n'y prouve rien.

### Méthode et silence

- **La MÉTHODE de travail est imposée** (`METHODE`, `server/src/runtime.ts`), la même sous Claude et
  Codex : lire avant de répondre (instructions, mémoire, fichiers repérés par recherche), constater
  par écrit, ne rien affirmer sans l'avoir vu, rejouer les contrôles du projet et en dire le résultat.
- **Aucun agent ne commente le stockage des identifiants** : mots de passe, clés, jetons gardés dans
  le projet sont un choix ASSUMÉ de l'utilisateur. On n'en parle pas — mais une PANNE (identifiant
  absent, expiré, refusé qui bloque le travail) se dit toujours.
- **Un fichier d'instructions qui ne fait que RENVOYER à un autre est suivi, jamais nommé** : sur un
  projet monté comme HaikoDev, `AGENTS.md` renvoie à `CLAUDE.md`, et c'est `CLAUDE.md` qui fait foi.

### Interface et code

- **Toute zone qui défile passe par `ZoneDefilement`** (`web/src/components/ui`) : elle bloque le
  second axe et pose le fondu. Le tableau ne glisse que de gauche à droite, une colonne de haut en bas.
- **Rien ne pointe vers le dossier personnel d'un utilisateur** (`/home/<quelqu'un>/…` écrit en dur) :
  une bibliothèque se déclare dans `package.json`, un outil dont le démon dépend se copie dans
  `outils/`. Le dossier de travail d'un projet vit sous `/root/<projet>`.
- **Un script de vérification vise le dépôt d'où il PART** (déduit de `import.meta.url`), jamais
  `/root/haikodev` en dur — sinon, lancé depuis une copie de travail, il jugerait le dossier principal.
- **Une compétence partagée vit dans `data/competences/`** (un dossier avec son `SKILL.md`) : le démon
  la pose dans le coffre de chaque compte Claude et le briefing l'annonce à tout agent.

### Coûts

- Les heures facturées sont celles d'un développeur senior, jamais la durée machine de l'agent.
- Les moteurs sont les outils en ligne de commande déjà authentifiés sur le serveur : aucune clé
  facturée à l'appel.
