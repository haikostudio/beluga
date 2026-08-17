# HaikoDev — instructions du moteur

Fichier COURT et factuel : comment lancer, comment vérifier, où vivent les choses, ce qu'on
n'enfreint pas. **Il est chargé par le MOTEUR à chaque session et relu à chaque aller-retour** : un
signe de plus ici se paie des dizaines de fois par tour. Il ne garde donc que le NOM des invariants —
leur TEXTE ENTIER vit par sujet dans `docs/regles/`, les faits dans `docs/memoire/`, les contrôles
dans `docs/verifications.md`, tout se demandant à la carte avec l'outil `project_memory`. Aucun
journal ici : les livraisons vont dans `HISTORIQUE.md`.

> [!IMPORTANT]
> **NE MODIFIE PAS CE FICHIER.** Une règle durable apprise s'écrit à la fin de
> `docs/instructions-en-attente.md`, et le démon la range cette nuit dans le fichier de son sujet
> (`shared/src/instructions-en-attente.ts`). Ce fichier-ci ne bouge donc plus qu'une fois par nuit :
> le modifier en pleine journée fait repayer son contenu ENTIER, au plein tarif, à tous les agents
> qui démarrent ensuite.

## Où vivent les choses

| Dossier | Rôle |
| --- | --- |
| `server/` | Le démon : base, protocole, ordonnanceur, agents, outils, publication |
| `web/` | L'interface : tableau, conversations, réglages, application installable |
| `shared/` | Les règles pures, sans base ni disque — donc testables seules |
| `scripts/` | Service système, identifiants, scripts de vérification |
| `docs/` | Règles PAR SUJET (`regles/`), faits PAR SUJET (`memoire/`), MÉCANIQUES (`mecaniques/`), PLANS du chef (`plans/`), contrôles (`verifications.md`), audits |
| `outils/` | Les outils tiers dont le démon dépend, versionnés ici |
| `data/live` | **Ce qui est réellement servi** : écrit uniquement par la publication |
| `data/competences` | Les **compétences partagées**, un dossier par compétence avec son `SKILL.md` |

Une règle qui peut vivre sans base ni disque va dans `shared/` avec son test.

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
développement (`tsc: not found`). Avant de construire : `NODE_ENV=development npm install
--include=dev`. La publication le fait toute seule.

Le navigateur d'essai (`playwright`) est une dépendance DÉCLARÉE, en `dependencies` et jamais en
`devDependencies`, importée normalement (`import { chromium } from 'playwright'`) — jamais par un
chemin absolu. Aucun navigateur à télécharger : les scripts lancent le Chrome du système
(`channel: 'chrome'`).

Un script de vérification ne reprend **jamais** `HAIKODEV_URL` : cette variable désigne
l'application DÉJÀ PUBLIÉE. Viser le serveur de développement, par une variable à soi.

## Vérifier

Les contrôles de TOUS LES JOURS :

```bash
npm test                            # tous les tests du démon (compilés dans server/dist)
node scripts/mesure-jetons.mjs      # ce qui part au moteur, avant / après
node scripts/verif-taille-instructions.mjs # le fichier d'instructions tient-il sous son plafond ?
node scripts/verif-memoire-agent.mjs # un vrai agent va-t-il chercher un fait détaillé ?
node scripts/verif-memoire-sujets.mjs # la mémoire part-elle par sujet, une seule fois par session ?
node scripts/verif-recherche-passages.mjs # la recherche remonte-t-elle les bons passages ?
node scripts/verif-memoire-des-vecteurs.mjs # un fichier réécrit garde-t-il ses vecteurs ?
HAIKO_THEMES_URL=http://localhost:7099 node scripts/verif-themes.mjs   # les thèmes
HAIKO_LANGUES_URL=http://localhost:7099 node scripts/verif-langues.mjs # les cinq langues
node scripts/verify-ui.mjs          # l'interface dans un vrai navigateur
node scripts/nettoyer-essais.mjs    # À LANCER APRÈS : retire les cartes d'essai
```

`npm test` lit `server/dist` : **construire avant de tester**.

Les DIZAINES de contrôles ciblés vivent PAR SUJET dans `docs/verifications.md` et se demandent avec
`project_memory`. Rappels valables partout, détaillés en tête de ce fichier : session d'une heure
fabriquée puis retirée (jetons HACHÉS), **ne jamais reprendre `HAIKODEV_TOKEN`**
(`env -u HAIKODEV_TOKEN …`), `HAIKODEV_URL` vaut l'application PUBLIÉE, point d'essai
`window.haikodevEssai` gardé par `import.meta.env.MODE !== 'production'`.

## Mémoire du projet

Les faits durables vivent PAR SUJET dans `docs/memoire/<sujet>.md` ; `MEMOIRE.md` n'en garde que le
sommaire. Au lancement d'une carte, la demande sert de QUESTION et le démon envoie les PASSAGES qui
y répondent, à la place de l'index. Le même outil `project_memory` sert les FAITS, les RÈGLES
(`docs/regles/`) et les CONTRÔLES (`docs/verifications.md`) — un sujet demandé rend les trois, jamais
le reste. `HISTORIQUE.md` n'est **jamais** envoyé au moteur.

Les invariants de cette mécanique — texte entier dans `docs/regles/methode.md` :

- Au LANCEMENT d'une carte, la demande sert de QUESTION
- …ET LA RECHERCHE EST RELANCÉE À CHAQUE DEMANDE, plus seulement au premier tour
- Le SENS vient d'un VRAI modèle de vectorisation, façon RAG, et il tourne EN LOCAL
- VECTORISER EST UN TRAVAIL DE FOND, jamais un péage au lancement d'une carte — ET IL REVIENT TOUTES LES SIX HEURES
- …ET UN PASSAGE INCHANGÉ GARDE SON VECTEUR, sinon la nuit travaille pour rien
- L'INDEX RESTE EN MÉMOIRE VIVE ENTRE DEUX DEMANDES, il ne se relit plus en entier à chaque fois
- LE SOMMAIRE DES SUJETS VOYAGE AVEC LES PASSAGES
- LE CODE NE MANGE PLUS LE BUDGET DE LA DOCUMENTATION
- LE CLASSEMENT FAIT UN SECOND PAS : LA RÈGLE NOMME SON FICHIER, ET IL REMONTE AVEC ELLE
- PAR LE SENS OU PAR LES MOTS, C'EST ÉCRIT DANS LA BULLE
- UNE AMPLEUR IMPOSÉE NE SE FAIT PLUS RABAISSER PAR LE CRAN DE SUIVI
- CE QUE LA RECHERCHE RAPPORTE EST MESURÉ, PAS SUPPOSÉ
- …D'OÙ DEUX TERRAINS ET DEUX RÉGLAGES : les MOTS EXACTS au LANCEMENT d'une carte, le SENS en CONVERSATION
- LE SEUIL DU MODE SENS EST RÉGLÉ SUR CE BALAYAGE, PAS À L'ESTIME
- Les MÉCANIQUES récurrentes vivent dans `docs/mecaniques/`
- Un sujet servi une fois ne l'est pas deux dans la même session
- Envoi quotidien au cerveau

## Règles à ne pas enfreindre

Seul le NOM de chaque invariant vit ici. Le TEXTE ENTIER — pourquoi la règle existe, les fichiers
qui la portent, les contrôles qui la verrouillent — est rangé PAR SUJET dans `docs/regles/` (carte
des sujets : `docs/regles-du-moteur.md`) et se demande avec `project_memory`. Déplacer une règle,
c'est la porter dans le fichier de son sujet, jamais l'effacer.

### Publication

Texte entier : `docs/regles/publication.md` (`project_memory`, sujet « publication »).

- Ne jamais publier de sa propre initiative
- Ne JAMAIS redémarrer le serveur tant qu'une publication OU une tâche tourne
- Un SIGNAL d'arrêt venu du dehors suit la MÊME règle que le bouton
- Un SERVEUR D'ESSAI ne porte plus le nom du démon, et une commande qui pourrait le couper est REFUSÉE AVANT DE PARTIR
- Avant de construire, la publication RECOMPILE un module natif venu d'un autre Node
- TOUTE ÉTAPE DE PUBLICATION QUI TOMBE EST RÉPARÉE PUIS REJOUÉE
- …ET UNE ÉTAPE QUI NE REND PAS LA MAIN EST UNE PANNE, PAS UN TRAVAIL LENT
- RANGER LES CARTES NE PEUT PLUS FAIRE ÉCHOUER UNE MISE EN LIGNE RÉUSSIE
- Un agent appelé pour DÉPANNER une publication reçoit un accueil MINIMAL
- Déployer, c'est fusionner le lot « À déployer », enregistrer, pousser, puis mettre en ligne selon la PROCÉDURE définie
- Un projet neuf n'a de procédure pour AUCUNE des deux étapes, et la colonne propose de l'INITIER
- Le tour de ce tiroir ne se livre PAS par la réponse de sa commande
- Une procédure DÉJÀ écrite ne se redemande jamais toute seule
- La question posée par l'outil de cet agent s'affiche DANS le tiroir, et s'y répond
- Une carte qui ENTRE dans « À déployer » perd sa date de mise en ligne, et un bouton éteint DIT pourquoi
- LE COMPTEUR D'UNE COLONNE COMPTE CE QUE SA LISTE MONTRE, ET CE QUI N'A PAS DE CARTE SE DIT EN CLAIR
- …ET L'ENCART PROPOSE DE LUI DONNER SA FICHE, D'UN CLIC
- …ET CE QUI EST PORTÉ PAR LA BRANCHE D'UNE CARTE N'EST PAS « SANS CARTE »
- La BRANCHE de chaque étape se choisit dans les réglages du projet

### Cartes

Texte entier : `docs/regles/cartes.md` (`project_memory`, sujet « cartes »).

- Toute demande de PROGRAMMATION ou d'EXÉCUTION passe par une carte
- Les étapes complémentaires d'un même objectif forment UNE proposition
- Le CHEF D'ORCHESTRE NE FAIT QUE DEUX CHOSES : une carte COURTE et le NIVEAU de son agent
- Trois NIVEAUX, jamais un modèle nommé
- La description exigée dépend de QUI propose
- L'analyse d'un agent qui a VRAIMENT étudié voyage avec sa proposition
- Le MODE PLAN s'affine par ITÉRATIONS
- UN PLAN NE S'AFFICHE QU'UNE FOIS LE TOUR RENDU
- …ET IL S'AFFICHE À L'INSTANT OÙ IL EST RENDU, PLUS UNE MINUTE APRÈS
- Le FOND du plan est vérifié aussi : quatre titres ne font pas un plan réfléchi
- Le cadre du plan pose son PROPRE FOND GRIS
- « Refuser » ÉCRIT dans la barre d'écriture, sans rien envoyer
- La carte suit les ÉTAPES RÉELLES du travail
- Une carte NAÎT dans « Planifié »
- RIEN NE PART AU MOTEUR AVANT LE LANCEMENT
- UN LANCEMENT RÉPOND DÈS QUE LE TOUR EST PARTI, ET UN PIED DE COLONNE NE FIGE JAMAIS L'ÉCRAN
- LA LISTE DE TÂCHES SE REFERME AVEC LE TOUR
- UNE QUESTION ARRÊTE L'AGENT JUSQU'À LA RÉPONSE
- UN ARRÊT AGIT TOUJOURS, ET DIT CE QU'IL A FAIT
- …ET IL MORD SUR UN MOTEUR QUI FAIT LA SOURDE OREILLE
- TOUT ARRÊT EST UN GESTE EN FORCE, ET LE REDÉMARRAGE AUSSI
- Une carte peut porter une DATE de départ
- …et une carte SANS date DIT quand il serait opportun de la lancer, sans coûter un jeton
- Une carte dont un agent TRAVAILLE ne s'affiche jamais ailleurs qu'en « En cours »
- L'alerte « le serveur ne répond pas » ne paraît que sur une indisponibilité RÉELLE et DURABLE
- UN RAPPORT RENDU FERME LA CARTE, avec ou sans code modifié
- UNE CARTE RESTÉE EN « EN COURS » DIT CE QUI TOURNE ENCORE
- LE CONSTAT REGARDE LES DEUX DOSSIERS : la copie de la carte ET le dossier PARTAGÉ du projet
- Mais RIEN NE RESTE COINCÉ DANS « EN COURS » : chaque fin de tour a une ISSUE
- …et les cartes DÉJÀ coincées sont rattrapées par un BALAYAGE
- Une PHRASE de carte ne dit JAMAIS le contraire de ce qui s'est passé
- Une carte INTERROMPUE se « REPRENDRE », elle ne repart pas de zéro
- Une tâche COUPÉE PAR UNE PANNE ne passe jamais pour terminée
- « Archivé », « En production » et « À déployer » ne se rouvrent que sur GESTE HUMAIN
- Les champs d'une carte sont de VRAIES colonnes
- UN SERVICE EXTÉRIEUR PEUT POSER UNE CARTE, par une porte gardée par des CLÉS NOMMÉES
- Chaque NUIT VERS 3 H, un agent d'analyse cherche ce qui peut être amélioré, et il ne fait que PROPOSER

### Branches et dossiers

Texte entier : `docs/regles/branches.md` (`project_memory`, sujet « branches »).

- Une carte lancée a TOUJOURS sa branche « tache/… » et sa copie de travail à elle
- UN DOSSIER DE TRAVAIL CASSÉ SE RÉPARE TOUT SEUL AU LANCEMENT
- Une branche poussée n'est PAS livrée
- Dossier partagé (chef, analyse, publication) : `git add` NOMMÉ un par un, jamais `git add -A`
- Un agent de tâche travaille en accès complet. Le chef d'orchestre AUSSI, SAUF qu'il ne modifie pas lui-même le code
- Aucun refus ne se dit « je n'ai pas les droits »
- Le chef écrit les DOCUMENTS partout dans le projet, et le CODE nulle part

### Projets

Texte entier : `docs/regles/projets.md` (`project_memory`, sujet « projets »).

- Créer un projet, c'est le MONTER en entier
- L'ADRESSE PUBLIQUE se demande AU MONTAGE
- UN DÉPÔT QUI EXISTE DÉJÀ SUR GITHUB ENTRE EN QUELQUES CLICS
- Un projet se déclare sur son DÉPÔT DE TRAVAIL, jamais sur son dossier publié
- La COLONNE DE GAUCHE se pilote par outil

### Méthode et silence

Texte entier : `docs/regles/methode.md` (`project_memory`, sujet « methode »).

- La MÉTHODE de travail est imposée
- Le CONTEXTE du modèle se compresse à 50 % entre deux tours
- Un TOUR dont la réponse est rendue se referme TOUJOURS
- …ET CE FILET NE DÉPEND PLUS DE CE QU'IL SURVEILLE
- Une PANNE PASSAGÈRE du fournisseur se retente, elle ne tue pas la tâche
- TROIS MOTEURS, TOUS EN LIGNE DE COMMANDE
- DEUX TOURS DE CURSOR SUR LE MÊME DOSSIER S'ATTENDENT, jamais un `.cursor/mcp.json` écrasé en plein vol
- UNE CARTE PROPOSÉE S'AFFICHE DANS LE FIL QUI L'A DEMANDÉE, quel que soit le moteur
- Le menu des modèles garde la version la plus récente de chaque FAMILLE, jamais les trois plus récents tout court
- Un moteur lancé est SUIVI avant tout autre travail
- Le témoin « réflexion en cours » suit l'AGENT, pas le message, et d'abord son TOUR VIVANT
- La CONSIGNE SYSTÈME ne change pas d'un tour à l'autre dans une même session
- Aucun agent ne commente le stockage des identifiants
- Un fichier d'instructions qui ne fait que RENVOYER à un autre est suivi, jamais nommé
- LE FICHIER D'INSTRUCTIONS NE BOUGE PLUS EN PLEINE JOURNÉE : on écrit dans `docs/instructions-en-attente.md`, le démon range la nuit
- LE FICHIER D'INSTRUCTIONS TIENT SOUS UN PLAFOND MESURÉ (25 000 signes, vérifié)
- SIGNES PAR JETON : 2,2 sur cette documentation, jamais 4
- LA COMPRESSION DU CONTEXTE SE COMPTE EN JETONS, PAS EN PART DE FENÊTRE

### Interface et code

Texte entier : `docs/regles/interface.md` (`project_memory`, sujet « interface »).

- LE COIN HAUT GAUCHE DU BANDEAU RÉPOND AU COIN HAUT DROIT
- CHAQUE COLONNE A SON PERSONNAGE, DÉTOURÉ
- SEPT THÈMES AU CHOIX DANS LES RÉGLAGES, DONT SIX SANS UNE BORDURE
- LES TROIS GRANDES ZONES (colonne des projets, tableau, conversation) SONT ÉTAGÉES, DANS LES SEPT THÈMES
- « GIVRE », « SAPIN » ET « CONTRASTE » DÉCLARENT MAINTENANT `--ligne-active` ET `--bandeau-etape`
- …ET LES HUIT CHOIX TIENNENT DERRIÈRE UNE SEULE ENTRÉE « THÈME » DU MENU
- L'INTERFACE EXISTE EN CINQ LANGUES, ET LE CHOIX VIT SOUS CELUI DU THÈME
- …ET CHAQUE PROJET PEUT IMPOSER LE SIEN, plus un choix qui suit l'ORDINATEUR
- LE CHOIX EST DÉJÀ PARTAGÉ ENTRE APPAREILS — LE PROBLÈME ÉTAIT LE FLASH DE PREMIER AFFICHAGE, PRIS POUR UN THÈME QUI « CHANGE TOUT SEUL »
- LE FLAT DESIGN NE RETIRE PAS UN CONTRASTE QUI PORTAIT UNE INFORMATION
- ORANGE pour ce qui est EN COURS, BLEU pour ce qui est TERMINÉ
- UN BOUTON QUI PART EN REQUÊTE LE DIT DÈS LE CLIC
- TROIS GENRES ALERTENT, PAS UN DE PLUS, ET LES DEUX CANAUX SUIVENT LA MÊME RÈGLE
- Le triangle orange n'est pas le seul chemin vers une décision attendue : une CLOCHE dans le bandeau du haut les liste TOUTES
- Un plan proposé qui attend une décision pose son ICÔNE sur la ligne de son projet — et RIEN d'autre : la ligne reste NUE
- La ligne d'un projet où un agent travaille porte, à DROITE, le même pourcentage que la tête de la colonne « En cours » du tableau
- PLUS AUCUN COMPTEUR DE JETONS VISIBLE NULLE PART
- « Repartir de zéro » vide le CONTEXTE de l'agent, pas seulement le fil
- LA LISTE DES TÂCHES N'A QU'UN SEUL ENDROIT : LE REPÈRE COMPACT COLLÉ AU CHAMP DE SAISIE
- UN TEXTE AFFICHÉ RESTE DANS SON CADRE, ET SE COPIE À LA SOURIS
- UN TEXTE REPLIÉ (`line-clamp`) NE SE POSE JAMAIS DANS UN `button`
- LA JAUGE « CAPACITÉ DU SYSTÈME » NE DIT « SATURÉ » QUE SUR UNE VRAIE SATURATION
- UNE ZONE QUI N'A PAS ENCORE SES DONNÉES MONTRE UNE SILHOUETTE, JAMAIS UN ÉTAT VIDE
- UNE FENÊTRE POSÉE DANS L'ENTÊTE D'UNE COLONNE RELÈVE L'ENTÊTE, PAS ELLE-MÊME
- LE PREMIER ENVOI N'ATTEND RIEN ET NE PORTE QUE L'UTILE
- UN ÉCRAN QU'ON N'A PAS OUVERT NE SE TÉLÉCHARGE PAS
- Toute zone qui défile passe par `ZoneDefilement`
- LE TABLEAU POSE LES CARTES PAR PAQUETS DE VINGT
- LE CALQUE DES TAGS « [fichier: …] » SE CALE SUR LE CHAMP, IL NE LE REDIT PAS
- CE CALQUE NE COUVRE QUE LA PART VISIBLE DU CHAMP, ET LA SÉLECTION Y RESTE VISIBLE
- UN TAG « [fichier: …] » S'EFFACE D'UN BLOC, jamais caractère par caractère
- UN TAG « [fichier: …] » NE SE COUPE PLUS EN FIN DE LIGNE : SES ESPACES SONT INSÉCABLES
- UN TAG « [fichier: …] » SE LIT COMME UNE PASTILLE, JAMAIS COMME DU TEXTE BRUT
- LA FRAPPE AU CLAVIER NE TRAVERSE PLUS LE MAGASIN GÉNÉRAL
- LES PIÈCES JOINTES EN ATTENTE SUIVENT L'AGENT, COMME LE BROUILLON — PAS LE COMPOSANT
- LES CARTES D'UN PROJET QU'ON NE CONSULTE PLUS SE DÉCHARGENT — APRÈS QUINZE MINUTES, PAS AVANT
- Une demande réellement partie garde son contexte envoyé et sa mesure moteur
- LE PROMPT ENVOYÉ SE LIT EN BULLES DE MESSAGE, PLUS AUCUN TIROIR
- UN TOUR SANS BULLE DE DEMANDE PORTE SES BULLES SUR SA RÉPONSE
- L'onglet « Détails » d'une carte est une LIGNE DE TEMPS
- Le détail d'une carte issue du chef montre ce qui était préparé avant l'exécution
- Un chef sans choix manuel part sur Haiku 4.5 sous Claude ou GPT-5.4 sous Codex, en réflexion moyenne
- Rien ne pointe vers le dossier personnel d'un utilisateur
- Un script de vérification vise le dépôt d'où il PART
- Les compétences partagées sont un POOL, alimenté par les tâches PROUVÉES
- GITHUB est ouvert à TOUT agent, sur TOUS les projets, sans carte ni réglage
- L'ONGLET « GITHUB » D'UNE CARTE NE PARLE QUE DE LA BRANCHE DE SON AGENT
- …ET IL SE LIT COMME UNE LIGNE DE TEMPS VERTICALE, CHARGÉE À L'OUVERTURE

### Quotas

Texte entier : `docs/regles/quotas.md` (`project_memory`, sujet « quotas »).

- Chaque hausse mesurée sur un compte n'est attribuée qu'une fois
- Un tour COUPÉ PAR LA LIMITE D'UN COMPTE n'est pas un échec
- Le fil du moteur appartient au COMPTE qui l'a ouvert
- Chaque échéance de quota connue déclenche une lecture ciblée après 15 s
- LE TRAVAIL PART OÙ IL Y A LE PLUS DE PLACE, pas au premier compte pas encore à 100 %
- LE CHEF D'ORCHESTRE NE PAIE PAS UN MODÈLE DE RAISONNEMENT POUR TRIER
