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

## Vérifier

```bash
npm test                            # tous les tests du démon (compilés dans server/dist)
node scripts/mesure-jetons.mjs      # ce qui part au moteur, avant / après
node scripts/verif-memoire-agent.mjs # un vrai agent va-t-il chercher un fait détaillé ?
node scripts/verify-ui.mjs          # l'interface dans un vrai navigateur
node scripts/verif-prevision-quota.mjs # la prévision d'épuisement, dans le volet des quotas
node scripts/verif-reprise-paseo.mjs # les cartes reprises de Paseo, dans un vrai navigateur
node scripts/nettoyer-essais.mjs    # À LANCER APRÈS : retire les cartes d'essai
```

`npm test` lit `server/dist` : construire avant de tester.

Les scripts qui passent par le navigateur ont besoin d'une session : ils s'en fabriquent une
d'une heure dans la base et la retirent en partant, ou reprennent `HAIKODEV_TOKEN` si elle est
donnée. Les jetons de session sont stockés HACHÉS : on n'en réutilise jamais un existant.

## Mémoire du projet

- `MEMOIRE.md` — faits durables et pièges. Seul son **index** (une ligne brève par fait, groupée par
  sujet) part au moteur au lancement d'un agent ; le texte entier se demande avec l'outil
  `project_memory`.
- `HISTORIQUE.md` — les livraisons datées, écrites à la clôture d'une carte. **Jamais** envoyé au
  moteur.
- Au-delà d'un seuil, un petit modèle relit la mémoire et la resserre ; la version d'avant reste
  dans `MEMOIRE.avant-synthese.md`.

## Règles à ne pas enfreindre

- **Ne jamais publier de sa propre initiative.** Enregistrer et pousser, oui ; mettre en ligne est un
  geste de l'utilisateur.
- Une carte naît toujours dans « À faire » ; seul l'utilisateur la valide, et ce geste seul autorise
  la dépense. **Une seule exception** : le code enregistré par un agent SANS carte fabrique tout seul
  sa fiche dans « À déployer » — le travail est déjà fait, il n'y a plus rien à valider.
- **Toute fonctionnalité vit sur sa propre branche, carte ou pas.** À la fin d'un tour sans carte, le
  démon déplace les enregistrements sur une branche `hors-tache/…`, rend la principale à son état
  d'avant, pousse la branche, et c'est ELLE que porte la fiche. Supprimer la carte suffit alors à
  écarter la fonctionnalité. Conséquence pour un agent sans carte : **enregistrer, oui ; pousser sur
  la branche principale, non** — une histoire déjà publiée ne se réécrit pas, et le travail resterait
  collé à la principale.
- Rien de ce qui se fait ne reste invisible : chaque ligne du lot à publier a sa carte, et un projet
  dont un agent a rendu son travail porte une pastille tant que la conversation n'a pas été ouverte.
- Le dossier de travail est **partagé** entre agents : vérifier la branche avant de modifier, puis
  committer ses fichiers **nommés un par un** — jamais `git add -A`.
- Un agent de tâche travaille en accès complet ; le chef d'orchestre ne modifie aucun fichier
  existant (sauf sur HaikoDev lui-même).
- Les heures facturées sont celles d'un développeur senior, jamais la durée machine de l'agent.
- Les moteurs sont les outils en ligne de commande déjà authentifiés sur le serveur : aucune clé
  facturée à l'appel.
