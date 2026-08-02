# HaikoDev

Pilotage de projets par agents IA : un tableau kanban où **chaque carte validée ouvre son propre
agent**, un **chef d'orchestre** par projet qui trie et documente sans jamais toucher au code, et un
**démon** qui exécute réellement le travail sur le serveur.

Le plan complet, chapitre par chapitre, est dans [PLAN.md](PLAN.md).

## Ce qui fait tourner le tout

| Brique | Rôle |
| --- | --- |
| `server/` | Le démon : source de vérité, protocole typé, ordonnanceur, agents, publication |
| `web/` | L'interface : tableau, conversations, réglages, application installable |
| `shared/` | Le contrat commun (colonnes, messages, gabarits de réponse) |
| `scripts/` | Service système, identifiants, scripts de vérification |

Les moteurs sont les outils en ligne de commande **déjà authentifiés sur le serveur** (Claude Code,
Codex) : aucune clé facturée à l'appel.

## Les règles qui ne bougent pas

- Une carte **naît toujours dans « À faire »** ; c'est vous qui la faites passer en « Validé », et
  ce geste seul autorise la dépense.
- Les agents ne peuvent déplacer une carte que vers **Notes** ou **À faire** — l'outil refuse le
  reste, ce n'est pas une consigne polie.
- Un agent de tâche travaille en **accès complet**, mais **ne publie jamais** de lui-même.
- Le chef d'orchestre **ne modifie aucun fichier existant** (sauf sur le dépôt HaikoDev lui-même).
- Les heures facturées sont celles d'un **développeur senior**, jamais la durée machine de l'agent.

## Mise en route

```bash
npm install
npm run build
node scripts/set-credentials.mjs        # rend l'identifiant et le mot de passe, une seule fois
sudo cp scripts/haikodev.service /etc/systemd/system/
sudo systemctl enable --now haikodev
```

L'application écoute en local sur `127.0.0.1:7070` ; un reverse-proxy l'expose sur son adresse
publique. Le mur d'accès (identifiant, mot de passe long, tentatives limitées) est dans le démon.

## Vérifier

```bash
npm test                                    # règles, gabarits, facturation, comptes, outils
node scripts/verify-ui.mjs                  # l'interface, dans un vrai navigateur
node scripts/verify-agents.mjs              # le cycle complet d'une tâche, avec de vrais agents
node scripts/verify-agents2.mjs             # chef d'orchestre, dictée, file, reprise
```

Les trois scripts de vérification demandent `HAIKODEV_USER` et `HAIKODEV_PASSWORD`.

<!-- essai de suivi GitHub -->

<!-- essai de suivi GitHub -->

<!-- essai de suivi GitHub -->

<!-- essai de suivi GitHub -->

<!-- essai de suivi GitHub -->
