# HaikoDev — instructions du moteur

Fichier court et factuel, tenu à jour AU FIL des tâches : comment lancer, comment vérifier, où
vivent les choses, ce qu'on n'enfreint pas. Aucun journal ici — les livraisons vont dans
`HISTORIQUE.md`, les règles apprises dans `docs/memoire/`. Le fichier est chargé À CHAQUE session : il
ne garde donc que le CONTRAT essentiel. Le TEXTE ENTIER des règles vit PAR SUJET dans `docs/regles/`,
la liste des contrôles dans `docs/verifications.md`, le texte des faits PAR SUJET dans `docs/memoire/`
— tout se demande à la carte avec l'outil `project_memory`, qui ne rend que le sujet touché par la
tâche, et une seule fois par session.

## Où vivent les choses

| Dossier | Rôle |
| --- | --- |
| `server/` | Le démon : base, protocole, ordonnanceur, agents, outils, publication |
| `web/` | L'interface : tableau, conversations, réglages, application installable |
| `shared/` | Les règles pures, sans base ni disque — donc testables seules |
| `scripts/` | Service système, identifiants, scripts de vérification |
| `docs/` | La documentation : les règles PAR SUJET (`regles/`), les faits PAR SUJET (`memoire/`), la liste des contrôles (`verifications.md`), les audits |
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
- **Ne JAMAIS redémarrer le serveur pendant une publication** (`shared/src/demon.ts`) : le démon
  porte toutes les publications, le couper en tranche une en plein vol. Un redémarrage demandé est
  retenu et rejoué tout seul dès la dernière publication finie.
- **Un agent appelé pour DÉPANNER une publication reçoit un accueil MINIMAL** (`niveauDAccueil`,
  `shared/src/accueil-agent.ts` — le chef d'orchestre, lui, reçoit le palier `tri`) : conflit de fusion, contrôles tombés, construction cassée n'emportent
  ni index de mémoire, ni compétences, ni fichiers d'instructions — seulement le projet, son dossier et
  une consigne ciblée. La mise en production confiée, elle, garde l'accueil complet.
- **Déployer, c'est fusionner le lot « À déployer » dans la principale, enregistrer, pousser, puis
  rafraîchir l'instance de dev** (`planDeMiseEnLigne`, `shared/src/mise-en-ligne.ts`) — toujours
  disponible, sans réglage. La MISE EN PRODUCTION, elle, ne suit QUE le prompt réglé du projet :
  sans prompt, elle est refusée, jamais menée à vide. La mise en ligne compte donc DEUX étapes, que
  la colonne « En production » sépare.

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
  modèle de la carte, PAS celui du chef — sinon un chef économe ferait exécuter tout le tableau au
  rabais. Retenu sur `RunConfig.niveau`, modifiable à la main avant lancement.
- **La description exigée dépend de QUI propose** (`jugerDescription`, `shared/src/description-carte.ts`) :
  quatre parties et un repère concret (320-2400 signes) pour un agent qui a étudié ; la demande
  simplement REFORMULÉE (80-2400 signes) pour le chef, qui n'a rien ouvert et n'a donc rien à citer.
- **L'analyse d'un agent qui a VRAIMENT étudié voyage avec sa proposition** : chiffrage futur, mesure
  réelle ajoutée par le démon et relais factuel sont recopiés sur la carte ; sa validation va
  directement en « Planifié », sans second chiffrage, mais l'exécution attend toujours un geste humain.
  Une carte du chef, elle, n'emporte aucun chiffrage : sa validation lance l'analyse sur place.
- **La carte suit les ÉTAPES RÉELLES du travail** (`shared/src/suivi-colonne.ts`) : seul un agent de
  rôle « task » la déplace ; « analysis », « orchestrator » et « deploy » ne la déplacent jamais.
- **Une carte NAÎT dans « Planifié »** (`createCard`, `server/src/tools.ts`) : ni « Validé » ni « À
  faire » n'existent, le tableau compte SEPT colonnes (`COLUMN_KEYS`, `shared/src/columns.ts`).
  Valider une carte lance son chiffrage SUR PLACE (drapeau `card.analyseDemandee`) sans la déplacer,
  et le lancement reste un geste humain — garanti par la règle de pause, pas par une colonne
  d'attente.
- **Une carte peut porter une DATE de départ** (`scheduling.departPrevu`, `shared/src/depart-programme.ts`) :
  elle attend dans « Planifié », dit quand elle partira, et part à l'heure dite par le même
  `startCard` que le bouton. Troisième autorisation explicite à côté de « Dès que possible » ; une
  heure manquée est rattrapée, la suspension à la main l'emporte, et le départ CONSOMME la date.
- **Pas de code modifié dans le dépôt, pas de « Terminé ».** C'est le CONSTAT du dépôt qui clôt une
  carte, jamais le fait que le moteur ait répondu.
- **« Archivé », « En production » et « À déployer » ne se rouvrent que sur GESTE HUMAIN.** Un projet
  qu'on retire est MIS DE CÔTÉ (`project.archive`, `archived = 1`), jamais supprimé.
- **Les champs d'une carte sont de VRAIES colonnes** (`shared/src/carte-sql.ts`, migration 17 de
  `server/src/db.ts`) : description, origine, agent, drapeaux, dates et réglages d'exécution ont leur
  colonne SQL ; les étiquettes et les pièces jointes ont leur table fille (`card_labels`,
  `card_attachments`). Le bloc `data` ne garde que le vraiment libre. Une carte se lit et s'écrit par
  `carteDepuisLigne` / `colonnesDeLaCarte`, jamais par `JSON.parse(data)` — les scripts passent par
  `scripts/carte-en-base.mjs`.

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
- **Un agent de tâche travaille en accès complet. Le chef d'orchestre a TOUS LES DROITS SAUF modifier
  le code du projet** (sauf sur HaikoDev lui-même) : il lance des commandes (`Bash`), cherche sur le
  web, écrit ses brouillons dans un DOSSIER DE TRAVAIL à part (son `cwd`, le seul écrivable) ; le
  PROJET est monté en LECTURE SEULE par le bac à sable — une écriture y échoue, une modification du
  code s'ouvre en carte. Frontière identique sous les deux moteurs (`shared/src/bridage-chef.ts`),
  posée au niveau système (`bwrap`) — elle EXIGE les espaces de noms utilisateur non privilégiés
  (`kernel.apparmor_restrict_unprivileged_userns=0`, `/etc/sysctl.d/99-haikodev-userns.conf`) : sans
  eux, toute commande d'un chef bridé échoue avec « bwrap: … Permission denied ». Les outils d'ÉDITION
  (`Edit`, `Write`, `NotebookEdit`) lui restent interdits. Verrouillé par
  `server/src/test/bridage-chef.test.ts` et `scripts/verif-bridage-chef.mjs`.

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
  Codex, pour tous les rôles QUI TRAVAILLENT : lire avant de répondre (instructions, mémoire, fichiers
  repérés par recherche), constater par écrit, ne rien affirmer sans l'avoir vu, rejouer les contrôles
  du projet et en dire le résultat. Le chef d'orchestre en est dispensé : il trie, il n'étudie pas.
- **Le CONTEXTE du modèle se compresse à 50 % entre deux tours**, pour tous les rôles
  (`shared/src/contexte-agent.ts`, `server/src/runtime.ts`) : fonction native de Claude, sinon résumé
  contrôlé et session neuve ; messages visibles, carte, décisions, tâches, modèle et compte restent.
- **Aucun agent ne commente le stockage des identifiants** : mots de passe, clés, jetons gardés dans
  le projet sont un choix ASSUMÉ de l'utilisateur. On n'en parle pas — mais une PANNE (identifiant
  absent, expiré, refusé qui bloque le travail) se dit toujours.
- **Un fichier d'instructions qui ne fait que RENVOYER à un autre est suivi, jamais nommé** : sur un
  projet monté comme HaikoDev, `AGENTS.md` renvoie à `CLAUDE.md`, et c'est `CLAUDE.md` qui fait foi.

### Interface et code

- **Le composeur montre le contexte de CHAQUE agent, jamais son quota** (`Agent.contextUsage`,
  `shared/src/contexte-agent.ts`) : mesure absente = tiret, vrai zéro = `0 %`, mise à jour à chaque
  usage du moteur et après compression. Vérifié par `server/src/test/contexte-agent.test.ts` et
  `scripts/verif-contexte-composeur.mjs`.
- **Toute zone qui défile passe par `ZoneDefilement`** (`web/src/components/ui`) : elle bloque le
  second axe et pose le fondu. Le tableau ne glisse que de gauche à droite, une colonne de haut en bas.
- **Une demande réellement partie garde son contexte envoyé et sa mesure moteur** ; en reprise,
  l'historique opaque est seulement nommé, jamais recopié ni inventé.
- **Le tiroir « Contexte envoyé » liste les TOURS de l'agent** (`store.usageByAgent`, commande
  `agent.usage`) : une ligne par tour mesuré, dans l'ordre du temps, coût en francs seulement si le
  tarif du modèle est connu (`shared/src/cout-tour.ts`), sinon « indisponible ».
- **Le même tiroir se lit dans UN SEUL ordre : l'ESTIMÉ, puis le RÉEL couche par couche**
  (`shared/src/couches-tokens.ts`) — réflexion du chef d'orchestre, puis exécution ; composition,
  consigne système et prompt entier sont repliés derrière « Voir le détail ».
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
- **Une compétence partagée vit dans `data/competences/`** (un dossier avec son `SKILL.md`) : le démon
  la pose dans le coffre de chaque compte Claude et le briefing l'annonce à tout agent.

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
  session, sa branche et ses étapes restantes. Aucun compte libre : le choix reste ouvert et
  s'actualise tout seul avec les quotas.
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
