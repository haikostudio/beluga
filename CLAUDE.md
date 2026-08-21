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
node scripts/verif-arbre-memoire.mjs # l'arbre de mémoire : trois étages, et aucun fait dans la carte
HAIKO_THEMES_URL=http://localhost:7099 node scripts/verif-themes.mjs # les thèmes : 6 ambiances × clair/sombre, aucun jeton oublié, réglage général/projet, automatique et menu
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

La mémoire est un ARBRE à trois étages, navigué par les NOMS — il n'y a plus aucune recherche.
`MEMOIRE.md` est la RACINE : les sujets, le mot de chaque branche, son chemin, aucun fait.
`docs/memoire/<sujet>.md` est le RAPPEL de ce qui existe sous ce sujet ;
`docs/memoire/<sujet>/<sujet>-<branche>.md` le DÉTAIL. Ce qui part au moteur est la CARTE de
l'arbre, UNE SEULE FOIS par session et sans aucun fait ; la descente se fait à la demande avec
`project_memory` — rien rend la carte, un SUJET ses faits ou ses branches, une BRANCHE ses faits en
entier, un mot inconnu un SILENCE dit en clair. Le même outil sert les FAITS, les RÈGLES
(`docs/regles/`) et les CONTRÔLES (`docs/verifications.md`) — un sujet demandé rend les trois, jamais
le reste. `HISTORIQUE.md` n'est **jamais** envoyé au moteur.

Les invariants de cette mécanique — texte entier dans `docs/regles/methode.md` :

- LA MÉMOIRE EST UN ARBRE, ET IL SE NAVIGUE PAR LES NOMS — plus aucune recherche
- La mémoire est EN ARBRE : un projet hérite de ce que sait HaikoDev
- Un sujet nommé sur une carte est servi au POIDS DE SA DEMANDE, pas au poids du fichier
- Un sujet servi une fois ne l'est pas deux dans la même session
- Les MÉCANIQUES récurrentes vivent dans `docs/mecaniques/`
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
- CHAQUE ÉTAPE D'UNE PUBLICATION PORTE SON FIL HISTORIQUE, ET IL SE LIT DANS UN VRAI TIROIR
- …ET LES CARTES MISES EN LIGNE ENSEMBLE RESTENT ENSEMBLE, AVEC UN BOUTON VERS LEUR HISTORIQUE
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
- **Initier une procédure de mise en ligne n'interroge plus : l'agent analyse et tranche** — INITIER UNE PROCÉDURE, C'EST UNE ANALYSE, PAS UN QUESTIONNAIRE
- **Déployer, c'est sur ce serveur ; mettre en production, c'est ailleurs**
- **Un interrupteur « déploiement automatique » en tête de « Terminé », éteint par défaut**
- **LA PUBLICATION CHOISIT UN MOTEUR QUI A ENCORE DU QUOTA, ET LE DIT QUAND IL N'Y EN A AUCUN** — LA PUBLICATION CHOISIT ELLE-MÊME UN MOTEUR AU QUOTA SUFFISANT, ET UN MANQUE DE QUOTA SE DIT AU LIEU DE BLOQUER EN SILENCE
- **LA FUSION DU LOT NE PAIE PLUS LE PRIX FORT, ET SON DÉTAIL SE LIT**
- **La fusion du lot : un tour d'agent borné, et les heurts de documentation recollés seuls** — LE VOLET DIT OÙ EN EST CHAQUE TÂCHE DU LOT

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
- **Une carte en « En cours » que rien ne rangera le DIT, au lieu de promettre un rangement** — UNE CARTE QUE LE BALAYAGE NE RAMASSERA PAS DIT QU'ELLE ATTEND VOTRE RELANCE
- **Sans quota, la demande attend en file — elle n'est plus perdue, et la carte ne bouge pas** — UNE DEMANDE QUI NE PEUT PAS PARTIR ATTEND EN FILE, SANS DÉPLACER SA CARTE
- **Une liste de tâches annoncée est une parole : le moteur n'est plus dit « muet »** — UN MOTEUR QUI A ANNONCÉ SA LISTE DE TÂCHES N'EST PAS UN MOTEUR JAMAIS JOINT
- **Le cycle de vie complet d'une carte a son contrôle bout-en-bout** — `node scripts/verif-cycle-de-vie-carte.mjs` rejoue le cycle entier, plusieurs fois de suite
- **Le bouton d'arrêt range la carte, exactement comme la sortie à la souris** — UN ARRÊT À LA MAIN RAMÈNE LA CARTE EN « PLANIFIÉ », QUEL QUE SOIT LE BOUTON
- **L'arrêt vide la file AVANT de couper, jamais après** — UN ARRÊT COUPE D'ABORD CE QUI ATTEND DERRIÈRE, ENSUITE LE MOTEUR
- **Un lancement refusé par une porte qui se rouvre seule est rejoué, sans second clic** — UN LANCEMENT REFUSÉ FAUTE DE QUOTA REPART TOUT SEUL DÈS QUE LE QUOTA REVIENT
- **Le moteur DIT qu'il n'a jamais démarré, on ne le déduit plus d'un faisceau d'absences** — « MOTEUR JAMAIS JOINT » EST UN SIGNAL DE L'ADAPTATEUR, PAS UNE DÉDUCTION DU DÉMON
- **Une carte annoncée en texte : le démon appelle l'outil À LA PLACE du modèle** — UNE CARTE ÉCRITE EN TEXTE EST RELUE PAR LE DÉMON, QUI APPELLE L'OUTIL LUI-MÊME
- **Une carte à valider allume le triangle de son projet, d'où qu'elle vienne**
- **Un agent arrêté sur sa question n'est en travail pour PERSONNE** — UN AGENT QUI ATTEND UNE RÉPONSE N'EST PLUS « EN TRAVAIL » NULLE PART, ET SON CHRONOMÈTRE S'ARRÊTE
- **Chaque carte d'auto-amélioration s'ouvre sur une phrase d'intro ludique, avant le Constat technique**
- **Le créneau conseillé devient le vrai départ programmé de la carte** — LE CRÉNEAU CONSEILLÉ D'UNE CARTE EST DÉJÀ SON DÉPART PROGRAMMÉ, PAS UNE SIMPLE SUGGESTION
- **Un nouvel essai après panne emporte TOUJOURS la demande de son tour**
- **Deux demandes trop rapprochées se SUIVENT, elles ne se doublent pas**
- **Une carte annoncée en texte, sans appel d'outil, fait relancer le chef** — Une carte RACONTÉE n'est pas une carte : le chef est relancé pour l'appel d'outil manquant
- **Le chef d'orchestre remonte le fil, et propose les deux chemins quand il hésite** — LE CHEF REMONTE LE FIL AVANT D'ÉCRIRE UNE CARTE, ET UN CAS AMBIGU LUI FAIT PROPOSER LES DEUX CHEMINS

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
- **Une élévation sudo (mkdir + chown) cible toujours le dossier CIBLE, jamais son parent** — LE MKDIR+CHOWN SUDO D'UN PROJET PORTE SUR SON PROPRE DOSSIER, JAMAIS SUR SON PARENT
- **Cinq points que le renommage du compte système laisse derrière lui** — UN RENOMMAGE DU COMPTE COUVRE AUSSI CE QUI POINTE L'ANCIEN DOSSIER PERSONNEL
- **Le dossier SSH de l'administrateur doit rester à l'administrateur** — UN `chown -R` TROP LARGE COUPE LES ACCÈS SSH DE L'ADMINISTRATEUR

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
- **Le coffre d'un compte moteur se remet d'aplomb tout seul** — LE COFFRE D'UN COMPTE MOTEUR (CLAUDE ET CODEX) SE RÉPARE AU DÉMARRAGE ET À CHAQUE LANCEMENT
- **Le rangement de nuit des instructions s'ENREGISTRE, sinon il est défait chaque jour** — LE RANGEMENT DE NUIT DES INSTRUCTIONS ENREGISTRE LUI-MÊME CE QU'IL RANGE
- **Le contrôle du coffre des comptes rejoint les vérifications de tous les jours** — `node scripts/verif-coffre-des-comptes.mjs` fait partie des contrôles de TOUS LES JOURS — les coffres Claude et Codex tiennent-ils debout ?
- **Chaque ligne de contrat rejoint la section de son sujet dans CLAUDE.md, pas la fin du fichier** — le rangement de nuit insère chaque ligne de contrat sous la section « ### … » de son sujet, repérée par « sujet « <sujet> » », jamais collée à la fin du fichier
- **Le filet de fermeture ne regarde plus le seul statut : un rangement d'après-réponse est jugé aussi** — UN TOUR ENCORE SUIVI DONT LA RÉPONSE EST FIGÉE SE REFERME, MÊME SI SON STATUT EST DÉJÀ RETOMBÉ
- **Le rangement de nuit vise les sujets réels du projet traité, pas les huit d'HaikoDev** — le rangement de nuit range dans les fichiers de `docs/regles/` qui existent VRAIMENT sur le projet traité, jamais dans les huit sujets fixes d'HaikoDev appliqués à un autre projet
- **Un décor d'agents FACTICES doit être reposé juste avant la mesure**
- **Les outils de liste de tâches se rouvrent par l'environnement**
- **Un fichier inchangé se reconnaît par sa taille et sa date, pas en le relisant**

### Interface et code

Texte entier : `docs/regles/interface.md` (`project_memory`, sujet « interface »).

- LE COIN HAUT GAUCHE DU BANDEAU RÉPOND AU COIN HAUT DROIT
- CHAQUE COLONNE A SON PERSONNAGE, DÉTOURÉ
- L'APPARENCE SÉPARE SIX AMBIANCES DE LA CLARTÉ, SOIT DOUZE PALETTES, DONT ONZE SANS BORDURE
- LES TROIS GRANDES ZONES (colonne des projets, tableau, conversation) SONT ÉTAGÉES, DANS LES DOUZE PALETTES
- CHAQUE PALETTE DÉCLARE TOUS SES JETONS ET SES TROIS FONDS DE ZONE
- LE MENU « THÈME » GARDE TROIS COMMANDES SÉPARÉES : AUTOMATIQUE, SOMBRE, PUIS AMBIANCE
- L'INTERFACE EXISTE EN CINQ LANGUES, ET LE CHOIX VIT SOUS CELUI DU THÈME
- CHAQUE PROJET PEUT IMPOSER SON APPARENCE COMPLÈTE, AUTOMATIQUE COMPRIS
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
- **Le timestamp du chat est court, et une carte acceptée porte son bouton « Lancer » dans le fil** — le timestamp sous un message du chat est court (ex. « 4h35min », plus jamais « il y a … »)
- **Le menu du bas du téléphone prolonge le fond de l'écran affiché, il ne pose plus sa propre bande** — LE MENU DU BAS EMPRUNTE LE FOND DE LA ZONE QU'IL PROLONGE
- **L'heure, le séparateur de date et les jetons sous les messages** — L'HEURE SOUS CHAQUE BULLE, UN SÉPARATEUR ENTRE DEUX JOURS, ET LES JETONS DE RETOUR SOUS LES MESSAGES
- **Le compteur de jetons sous un message utilisateur n'écarte plus le tour agentique qui suit** — LE COMPTEUR SOUS UNE BULLE DE DEMANDE MESURE CE MESSAGE, JAMAIS LE TOUR AGENTIQUE QUI A SUIVI
- **UN COFFRE-FORT CENTRAL POUR LES IDENTIFIANTS, ATTEINT DEPUIS LA COLONNE DE GAUCHE** — LES IDENTIFIANTS VIVENT DANS UN COFFRE-FORT CENTRAL, OUVERT DEPUIS LA COLONNE DE GAUCHE
- **Le tiroir de publication est une vraie timeline verticale** — LE TIROIR DE PUBLICATION EST UNE TIMELINE VERTICALE : ROND-ICÔNE PAR ÉVÉNEMENT (ÉTAPE ET MOMENT), LIGNE CENTRALE CONTINUE, DATE SOUS LE ROND D'ÉTAPE, TEMPS À DROITE
- **Un trait qui porte une information suit `--faint`, jamais `--border`** — sur les thèmes plats, un trait porteur d'information se dessine avec `--faint`, pas avec `--border`
- **Un canal WebSocket zombie n'a plus le dernier mot sur le témoin « Réflexion en cours »** — LE CLIENT VÉRIFIE LUI-MÊME QUE SON CANAL RÉPOND ENCORE, IL NE SE FIE PLUS À `onclose`

### Quotas

Texte entier : `docs/regles/quotas.md` (`project_memory`, sujet « quotas »).

- Chaque hausse mesurée sur un compte n'est attribuée qu'une fois
- Un tour COUPÉ PAR LA LIMITE D'UN COMPTE n'est pas un échec
- Le fil du moteur appartient au COMPTE qui l'a ouvert
- Chaque échéance de quota connue déclenche une lecture ciblée après 15 s
- LE TRAVAIL PART OÙ IL Y A LE PLUS DE PLACE, pas au premier compte pas encore à 100 %
- LE CHEF D'ORCHESTRE NE PAIE PAS UN MODÈLE DE RAISONNEMENT POUR TRIER
