# HaikoDev

Pilotage de projets par agents IA : un tableau kanban où **chaque carte validée ouvre son propre
agent**, un **chef d'orchestre** par projet qui trie les demandes et propose des cartes sans jamais
toucher au code, et un **démon** qui exécute réellement le travail sur le serveur.

Le plan complet, chapitre par chapitre, est dans [PLAN.md](PLAN.md).

## Ce qui fait tourner le tout

| Dossier | Rôle |
| --- | --- |
| `server/` | Le démon : base, protocole, ordonnanceur, agents, outils, publication |
| `web/` | L'interface : tableau, conversations, réglages, application installable |
| `shared/` | Les règles pures, sans base ni disque — donc testables seules |
| `scripts/` | Service système, identifiants, scripts de vérification |
| `docs/` | Règles par sujet (`regles/`), faits par sujet (`memoire/`), plans du chef (`plans/`), contrôles (`verifications.md`) |
| `outils/` | Les outils tiers dont le démon dépend, versionnés ici |
| `data/live` | Ce qui est réellement servi — écrit uniquement par la publication |
| `data/competences` | Les compétences partagées, un dossier par compétence |

Les moteurs sont des outils en ligne de commande — Claude Code, Codex, Cursor — pilotés par le
démon, chacun avec son propre coffre d'identifiants (un dossier par compte).

## Ce que fait HaikoDev

- **Un tableau** (Notes → Planifié → En cours → Terminé → À déployer → En production → Archivé) où
  chaque carte suit le travail réel d'un agent, avec sa ligne de temps, ses jetons consommés et ses
  décisions en attente.
- **Un chef d'orchestre par projet**, qui répond aux questions dans la conversation et propose des
  cartes courtes (titre, description, niveau) pour toute demande de programmation ou d'exécution —
  rien ne part au moteur avant votre clic de validation.
- **Une mémoire de projet par sujet** (`docs/memoire/`) : au lancement d'une carte, sa demande sert
  de question et seuls les passages réellement utiles sont envoyés à l'agent, jamais tout le sujet.
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
- Le chef d'orchestre **ne modifie jamais le code** — il répond aux questions et propose des cartes ;
  seuls les documents texte (`.md`, `.txt`…) s'écrivent directement.
- Les heures facturées sont celles d'un **développeur senior**, jamais la durée machine de l'agent.
- **Aucune publication ni aucun redémarrage du serveur ne se déclenche sans un geste explicite** de
  l'utilisateur (bouton « Publier maintenant » ou instruction claire).

## Installation sur un VPS

Prérequis : un serveur Linux (Debian/Ubuntu), Node.js ≥ 22, `git`, un reverse-proxy (Caddy) si le
service doit être exposé sur un sous-domaine public, et les moteurs en ligne de commande que vous
comptez utiliser (Claude Code, Codex — installés séparément, pas fournis par ce dépôt).

```bash
git clone <adresse-du-depot> haikodev
cd haikodev
npm install
npm run build                              # shared, puis server, puis web
node scripts/set-credentials.mjs           # identifiant + mot de passe de l'application, une fois
sudo cp scripts/haikodev.service /etc/systemd/system/
sudo cp scripts/haikodev-watchdog.service /etc/systemd/system/   # relance après une panne
sudo systemctl daemon-reload
sudo systemctl enable --now haikodev
sudo systemctl enable --now haikodev-watchdog
```

L'application écoute en local (`127.0.0.1:7070` par défaut) ; un reverse-proxy (Caddy) l'expose sur
son adresse publique et gère le certificat TLS. Le mur d'accès (identifiant, mot de passe long,
tentatives limitées) est géré par le démon lui-même — aucune configuration externe requise pour ça.

Chaque projet ajouté depuis l'interface (ou via le script `ajouter-projet-github`) obtient son propre
sous-domaine, son propre service systemd et sa propre entrée Caddy, sur le même serveur.

### Configuration des moteurs LLM

Les moteurs (Claude Code, Codex) doivent être **installés sur le serveur** en tant qu'exécutables en
ligne de commande, déjà authentifiés — HaikoDev ne facture aucune clé API à l'appel, il pilote des
comptes déjà connectés.

La connexion d'un compte se fait **depuis l'interface**, jamais en ligne de commande directement sur
le serveur : ouvrez les réglages, onglet « Comptes », ajoutez un compte du moteur voulu, et suivez la
commande de connexion proposée (`claude auth login` pour Claude, qui affiche une adresse et un code à
recopier ; `codex login --device-auth` pour Codex, pour la même raison). Chaque compte possède son
propre coffre d'identifiants sur le disque (un dossier dédié par compte), ce qui permet de faire
tourner plusieurs comptes du même moteur en parallèle, avec un suivi de quota par compte et une
répartition automatique du travail vers le compte le moins chargé.

## Vérifier

```bash
npm test                                    # tous les tests du démon (server/dist)
node scripts/mesure-jetons.mjs              # ce qui part au moteur, avant / après
node scripts/verify-ui.mjs                  # l'interface, dans un vrai navigateur
node scripts/nettoyer-essais.mjs            # à lancer après : retire les cartes d'essai
```

> Les scripts de vérification créent de vraies cartes ou de vrais réglages dans l'application.
> `nettoyer-essais.mjs` retire les cartes d'essai : à lancer systématiquement après, pour que le
> tableau reste celui de votre travail.

Les dizaines de contrôles ciblés (par sujet : cartes, publication, quotas, interface, mémoire…) sont
listés dans `docs/verifications.md` et se demandent depuis le projet avec l'outil de mémoire.
