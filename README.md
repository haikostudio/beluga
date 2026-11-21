<p align="center">
  <img src="docs/images/beluga-build.png" alt="Le béluga blanc de Beluga Build" width="160" />
</p>

# Beluga Build

Pilotage de projets par agents IA : un tableau kanban où **chaque carte s'ouvre sur sa propre
conversation de cadrage**, à moindre coût, avant qu'un clic ne confie le travail à un **agent
complet** qui analyse et exécute lui-même, et un **démon** qui fait réellement tourner tout ça sur le
serveur.

> **Un service hébergé, payant.** Beluga Build se loue sur [belugabuild.com](https://belugabuild.com) :
> chaque client reçoit son propre serveur, préparé et tenu à jour par l'équipe Beluga. Il part vide
> et **grandit avec vos projets** — sa mémoire et ses compétences s'enrichissent à chaque tâche menée
> à bien. Ce dépôt est privé ; son code n'est ni distribué ni installable hors de l'offre hébergée.

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

## Un serveur par client

Chaque serveur de l'offre hébergée est monté par l'agent d'hôte du site central (dépôt belugabuild) :
il y installe ce dépôt à partir d'une archive de version (`scripts/installer.sh --archive`), pose
`BELUGA_HEBERGE=1` dans `/etc/beluga.env`, puis le tient à jour. Le client arrive ensuite sur un
**assistant de démarrage**, page par page.

| Page | Ce qu'elle règle | Obligatoire |
| --- | --- | --- |
| Bienvenue | Ce qu'est Beluga Build, et l'état de sa mémoire | — |
| Les moteurs | Installer d'un bouton, puis connecter, au moins un assistant (Claude Code, Codex, Cursor…) | oui |
| Le nom de domaine | L'adresse définitive, le nom sous lequel les projets recevront la leur | non |
| GitHub et premier projet | Relier GitHub, ajouter un dépôt existant ou créer un projet | non |
| Les courriels | Par où ils partent, l'expéditeur, un essai réel | non |
| L'espace client | Le nom et l'adresse de l'espace où les clients déposent leurs demandes | non |
| Les compétences | Les bibliothèques publiques de modes d'emploi à importer | non |
| Les fonctions en plus | Dictée et voix, installées d'un bouton | non |

Chaque page facultative se passe (« Plus tard ») et se retrouve à l'identique dans **Réglages → page
« Installation »**.

**Les anciennes installations gratuites.** Celles posées avant le 21/11/2026 continuent de tourner
mais ne reçoivent plus de nouveautés : la page « Mise à jour » de leurs réglages devient « Passer à
l'offre hébergée » et leur propose de transférer tout leur espace vers un serveur hébergé.

### Commandes de secours

À lancer sur le serveur, sous le compte du service (`sudo -u beluga …`), depuis le dossier de
l'installation :

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
`data/`, un dossier **jamais suivi par git** (`.gitignore`) : le code ne transporte
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

C'est le moyen recommandé pour garder une sauvegarde indépendante du disque. Un client qui quitte
l'offre hébergée récupère ses données et ses projets — pas le logiciel.

## Ce qui ne voyage pas avec le code

Ce dépôt ne contient que le programme. Il ne porte ni identifiant, ni clé, ni adresse d'une
installation existante, ni compétence, ni mémoire de projet : tout cela se crée chez vous, dans
`data/`, au fil de l'assistant de démarrage puis de votre travail.

## Licence

Copyright © 2026 Haiko Studio. Tous droits réservés — voir [LICENSE.md](LICENSE.md).
