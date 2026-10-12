<p align="center">
  <img src="docs/images/beluga-build.png" alt="Le béluga blanc de Beluga Build" width="160" />
</p>

# Beluga Build

Pilotage de projets par agents IA : un tableau kanban où **chaque carte s'ouvre sur sa propre
conversation de cadrage**, à moindre coût, avant qu'un clic ne confie le travail à un **agent
complet** qui analyse et exécute lui-même, et un **démon** qui fait réellement tourner tout ça sur le
serveur.

> **Une base à faire vôtre, pas un logiciel libre.** Beluga Build n'est pas un outil open source :
> c'est un outil mis à la disposition de tous, pour que chacun parte d'une base déjà aboutie et
> conçoive **son propre outil de développement**. Il part vide et **grandit avec vos projets** — sa
> mémoire et ses compétences s'enrichissent à chaque tâche menée à bien — et il se modifie comme
> n'importe lequel de vos projets : l'assistant de démarrage crée **votre copie privée** sur votre
> GitHub et pose le projet « Beluga Build » sur votre tableau.

## Ce qui fait tourner le tout

| Dossier | Rôle |
| --- | --- |
| `server/` | Le démon : base, protocole, ordonnanceur, agents, outils, publication |
| `web/` | L'interface : tableau, conversations, réglages, application installable |
| `shared/` | Les règles pures, sans base ni disque — donc testables seules |
| `scripts/` | Installation, service système, commandes de secours |
| `data/` | Vos données : base, coffre-fort, journaux, compétences — jamais dans le dépôt |

Les moteurs sont des outils en ligne de commande — Claude Code, Codex, Cursor — pilotés par le
démon, chacun avec son propre coffre d'identifiants (un dossier par compte).

## Ce que fait Beluga Build

- **Un tableau** (Demande → Plan → Travail → Rapport → À déployer → Archivé) où
  chaque carte suit le travail réel d'un agent, avec sa ligne de temps, ses jetons consommés et ses
  décisions en attente.
- **Une carte qui se cadre avant de partir** : le « + » de la colonne « Demande » ouvre directement
  une carte et sa conversation, tenue par un agent léger qui discute le besoin et écrit au fur et à
  mesure le titre, la description et le niveau — sans toucher au code. Le bouton « Lancer la tâche »
  confie alors toute la discussion, comme contexte de départ, à un agent complet qui analyse ET
  exécute ; rien ne part au moteur d'exécution avant ce clic.
- **Une mémoire de projet** : au lancement d'une carte, sa demande sert de question et seuls les
  passages réellement utiles sont envoyés à l'agent, jamais toute la mémoire. Elle part VIDE sur une
  installation neuve et se remplit au fil de votre travail.
- **Une publication maîtrisée** : enregistrer (commit), sauvegarder (push) et mettre en ligne restent
  des étapes séparées et suivies (timeline verticale, reprise automatique d'une étape tombée) ; rien
  ne se publie sans un geste explicite, sauf si un interrupteur de déploiement automatique est activé
  pour le projet.
- **Un coffre-fort central** pour les identifiants (clés d'API, mots de passe, accès SSH, bases de
  données), accessible depuis la colonne de gauche, commun à tous les projets.
- **Une interface installable**, en cinq langues, avec thèmes clair/sombre par ambiance, pensée
  téléphone et ordinateur.

## Les règles qui ne bougent pas

- Une carte **naît toujours dans « Planifié »** ; c'est vous qui lancez son exécution, et ce geste
  seul autorise la dépense.
- Un agent de tâche travaille en **accès complet**, sur sa **propre branche et copie de travail**,
  mais **ne publie jamais** de lui-même.
- L'agent de cadrage, dans la conversation d'une carte pas encore lancée, **ne modifie jamais le
  code** — il discute le besoin et prépare la carte ; seuls les documents texte (`.md`, `.txt`…)
  s'écrivent directement, et uniquement en mode plan.
- Les heures facturées sont celles d'un **développeur senior**, jamais la durée machine de l'agent.
- **Aucune publication ni aucun redémarrage du serveur ne se déclenche sans un geste explicite** de
  l'utilisateur (bouton « Publier maintenant » ou instruction claire).

## Installation sur un serveur neuf

Il vous faut un serveur **Debian ou Ubuntu** que vous administrez (un VPS de 4 Go de mémoire suffit
pour commencer), et c'est tout : la commande ci-dessous installe le reste.

```bash
curl -fsSL https://raw.githubusercontent.com/haikostudio/beluga/main/scripts/installer.sh | sudo bash
```

Elle pose question une seule fois — **votre nom de domaine**, si vous en avez un — puis :

1. installe ce dont Beluga Build dépend (Node 22, git, le serveur web Caddy, l'outil GitHub, le
   terminal partagé) ;
2. crée un compte système dédié, `beluga`, et télécharge le code dans `/opt/beluga` ;
3. construit l'application et installe sa **mémoire « par le sens »** — le modèle qui lui permet de
   retrouver ce qu'il a appris (environ 800 Mo sur le disque) ;
4. lui donne une **adresse sécurisée** : votre nom de domaine s'il mène déjà au serveur, sinon une
   adresse provisoire tirée de son adresse IP ;
5. pose de quoi envoyer des courriels depuis le serveur lui-même (écoute locale seulement) ;
6. démarre l'application comme un service, relancé seul au redémarrage du serveur ;
7. affiche un **lien d'installation**.

Ouvrez ce lien : il mène droit à la création de **votre compte**, sans rien à recopier. Il ne sert
qu'une fois ; tant que le compte n'existe pas, personne ne peut le créer sans lui. C'est la dernière
fois que vous avez besoin du terminal : un **assistant de démarrage** prend le relais, page par page —
à gauche ce que vous réglez, à droite un terminal où vous voyez le serveur travailler.

| Page | Ce qu'elle règle | Obligatoire |
| --- | --- | --- |
| Bienvenue | Ce qu'est Beluga Build, et l'état de sa mémoire | — |
| Les moteurs | Installer d'un bouton, puis connecter, au moins un assistant (Claude Code, Codex, Cursor…) | oui |
| Le nom de domaine | L'adresse définitive, le nom sous lequel vos projets recevront la leur, et qui gère ce nom | non |
| GitHub et premier projet | Relier GitHub, ajouter un dépôt existant ou créer un projet | non |
| Votre propre Beluga | Créer votre copie privée sur votre GitHub, et poser le projet « Beluga Build » sur votre tableau | non |
| Les courriels | Par où ils partent (ce serveur, un service de courriel, Resend), l'expéditeur, un essai réel | non |
| L'espace client | Le nom et l'adresse de l'espace où vos clients déposent leurs demandes | non |
| Les compétences | Les bibliothèques publiques de modes d'emploi à importer | non |
| Les fonctions en plus | Dictée et voix, installées d'un bouton | non |

Chaque page facultative se passe (« Plus tard ») et se retrouve à l'identique dans **Réglages → page
« Installation »**. Une installation neuve part **vide** : aucun projet, aucune compétence, aucune
mémoire, aucune adresse réglée — et une fonction dont le réglage manque reste éteinte.

**Les adresses de vos projets.** Chez Hetzner, Cloudflare, Infomaniak, OVH et Gandi, Beluga Build crée
lui-même l'adresse de chaque projet, avec un jeton que vous rangez dans son coffre-fort. Chez tout
autre fournisseur, une règle « tous les noms » (`*.exemple.com` vers votre serveur), posée une fois,
suffit — sans rien lui confier.

**Les courriels.** L'assistant propose d'abord l'envoi par le serveur lui-même et le met à l'épreuve
par un vrai courriel. Beaucoup d'hébergeurs bloquent cet envoi : l'essai le dit, et n'importe quel
service de courriel (le vôtre, Brevo, Mailgun, Gmail, Resend…) prend alors le relais.

**Les nouveautés.** Quand la version d'origine avance, un bandeau « Mettre à jour » le signale ; rien
ne s'applique sans vous. Sur votre copie personnelle, une tâche est posée dans le projet « Beluga
Build » : un agent rapproche les nouveautés de vos modifications, et vous décidez de la mise en ligne.

### Ce que l'installation change sur votre serveur

- des paquets système (Node, Caddy, l'outil GitHub, de quoi compiler, tmux, dnsutils, et postfix
  réglé pour n'écouter que la machine elle-même) ;
- le compte `beluga`, avec les **droits d'administration sans mot de passe**
  (`/etc/sudoers.d/90-beluga-beluga`). Beluga Build administre le serveur pour vous — il crée les
  dossiers et les services de vos projets, écrit leurs adresses dans le serveur web — et ses agents
  travaillent sous ce compte : installez-le sur une machine que vous lui réservez ;
- `/opt/beluga` (le code et, sous `data/`, vos données) et `/home/beluga/projets` (vos projets) ;
- `/etc/caddy/Caddyfile` et `/etc/caddy/beluga.d/` (l'adresse), `/etc/beluga.env` (deux réglages),
  et les unités `beluga.service`, `beluga-watchdog.*`, `beluga-releve-projets.*`.

Pour voir tout ce qu'elle ferait sans rien changer, téléchargez-la puis lancez-la à blanc :

```bash
curl -fsSL https://raw.githubusercontent.com/haikostudio/beluga/main/scripts/installer.sh -o installer.sh
sudo bash installer.sh --a-blanc
```

Autres options : `--domaine beluga.exemple.com` (ne pas poser la question), `--sans-question`,
`--dossier`, `--compte`, `--branche`. La même commande, relancée plus tard, **met Beluga Build à
jour** : elle retélécharge le code, le reconstruit et redémarre le service, sans toucher à vos données
ni à votre adresse. Dès que l'installation est devenue **votre copie** (ou que vous y avez modifié
quoi que ce soit), elle ne touche plus au code : vos modifications ne sont jamais écrasées, et les
nouveautés se récupèrent depuis l'application.

### Installation à la main

Sur une machine déjà équipée (Node ≥ 22, git, un reverse-proxy), sous un compte ordinaire — jamais
`root`, les moteurs le refusent :

```bash
git clone https://github.com/haikostudio/beluga.git
cd beluga
npm install
npm run build                              # shared, puis server, puis web
sudo scripts/installer-services.sh         # pose le service sous le compte propriétaire du dossier
node scripts/code-installation.mjs         # affiche le code d'installation (--lien : le lien prêt à cliquer)
```

L'application écoute en local (`127.0.0.1:7070`) : à vous de placer un reverse-proxy devant elle.
`sudo scripts/installer-services.sh --a-blanc` dit ce que le script ferait, sans rien changer.

### Commandes de secours

À lancer sur le serveur, sous le compte du service (`sudo -u beluga …` après l'installation
automatique), depuis le dossier de l'installation :

```bash
node scripts/code-installation.mjs --lien  # un nouveau lien d'installation, tant qu'aucun compte n'existe
node scripts/set-credentials.mjs           # un nouveau mot de passe pour le compte principal
sudo systemctl status beluga.service       # le service tourne-t-il ?
tail -50 data/logs/service.log             # ce qu'il a écrit en dernier
```

### Les moteurs

Les moteurs sont des assistants **installés sur le serveur** en ligne de commande. Beluga Build ne
facture aucune clé à l'appel : il pilote des comptes que vous connectez vous-même.

L'assistant de démarrage **installe lui-même** chaque moteur : un bouton « Installer », et la
commande de l'éditeur tourne sous le compte `beluga` — celui du service, qui cherchera l'outil
ensuite — pendant que sa sortie s'affiche à l'écran. La **connexion** d'un compte se fait ensuite
depuis l'interface (assistant de démarrage, ou Réglages → « Comptes et quotas »), qui affiche
l'adresse à ouvrir et le code à recopier. Chaque compte a son propre coffre d'identifiants sur le
disque : plusieurs comptes du même moteur travaillent en parallèle, avec un suivi de quota par compte.

## Vos données restent chez vous

Tout ce qui vous appartient (base de données, coffre-fort, projets, cartes, historiques) vit sous
`data/`, un dossier **jamais suivi par git** (`.gitignore`) : cloner ou publier ce dépôt ne partage
jamais vos données. Les identifiants de moteurs LLM (`~/.claude`, `~/.codex`…) et les secrets
applicatifs restent eux aussi hors du dépôt, lus depuis le disque du serveur ou des variables
d'environnement (`/etc/beluga.env`).

### Sauvegarder et reprendre l'intégralité de vos données

Un export/import complet est intégré à l'application (réglages → onglet « Système ») : il produit
une archive ZIP lisible (un fichier JSON par table, plus un manifeste avec empreintes) couvrant les
neuf catégories de données (projets, cartes, coffre-fort, backups, surveillance, etc.), avec l'état
git de chaque projet.

- **Exporter** : cochez les catégories voulues, l'archive se télécharge directement depuis le
  navigateur.
- **Importer** : déposez une archive dans la même fenêtre ; trois politiques de conflit sont
  proposées, la valeur par défaut ne pouvant jamais rien détruire. Rejouer le même import ne crée
  aucun doublon — les lignes déjà présentes sont simplement laissées de côté.

C'est le moyen recommandé pour déménager une installation d'un serveur à un autre, ou pour garder une
sauvegarde indépendante du disque.

## Ce qui ne voyage pas avec le code

Ce dépôt ne contient que le programme. Il ne porte ni identifiant, ni clé, ni adresse d'une
installation existante, ni compétence, ni mémoire de projet : tout cela se crée chez vous, dans
`data/`, au fil de l'assistant de démarrage puis de votre travail.
