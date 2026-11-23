---
name: beluga-bouton-de-branche-d-une-tache
description: À utiliser dès qu'on touche à la branche d'une carte de Beluga Build ou à son bouton dans le fil d'Ariane : « renommer la branche d'une tâche », « reprendre la branche d'une autre tâche », « la tâche part sur la mauvaise branche », « le travail a disparu en changeant de branche », « deux tâches sur la même branche », « la branche n'est pas fusionnée / est supprimée trop tôt ». Dit où vit chaque pièce, ce que le menu sait faire et les pièges.
etat: active
themes: interface, cartes, publication, git
symptomes: branche renommée perdue au lancement, branche partagée fusionnée deux fois, branche supprimée à l'archivage alors qu'une autre tâche la porte, tâche lancée sur dev ou main
projets: Beluga
---

# beluga-bouton-de-branche-d-une-tache

## Procédure

CE QUE SAIT FAIRE LE BOUTON (web/src/components/bouton-de-branche.tsx, posé en `suite` d'EnteteDeZone dans card-panel.tsx, pas sur le cahier des charges) :
- montre la branche (`brancheDeLaCarte`), sans « tache/ » ; sur téléphone seul le pictogramme reste, le menu monte en panneau du bas ;
- en tête : nom complet, PARCOURS tâche → branche de déploiement → production, étape courante en violet (`etapeDeLaBranche` : branche / a-deployer / deployee), « Partagée avec … », raison du verrou ;
- gestes : Copier le nom, Ouvrir sur GitHub (si la branche est poussée), Renommer (saisie en ligne, préfixe tache/ affiché), Nouvelle branche… (nom + sous-menu « Départ », toutes branches sauf archives, défaut = branche de déploiement), Reprendre une branche (liste, recherche au-delà de 6, grisée + raison si l'agent d'une autre carte y travaille) ;
- question « laisser / emporter » DANS le menu quand le démon rend `question: 'travail'` (jamais mémorisée : demandée à chaque fois, choix de l'utilisateur).
LE DÉMON (server/src/gestion-de-branche.ts, commandes `card.branches` et `card.branche` de shared/src/protocol.ts) :
1. Toute branche de carte se lit par `brancheDeLaCarte(card)` (shared/src/gestion-de-branche.ts) = `brancheChoisie` (colonne `branche_choisie`, migration 123) sinon `nomDeBranche`. Le dossier de la copie garde son nom tiré du titre.
2. Gestes sous `sousLaFileDuDepot` ; refus si agent actif, publication en cours, projet multi-dépôts, carte hors tâche ou archivée.
3. Avant tout changement, `refermerSansFile` enregistre d'office le travail sur l'ANCIENNE branche. Emporter = `cherry-pick` des enregistrements depuis `github.baseSha` dans la copie posée sur la branche d'arrivée ; heurt → `cherry-pick --abort`, branche neuve supprimée, rien ne bouge. `baseSha` = sommet de la branche d'arrivée.
4. Créer sans emporter n'écrit que le choix : la branche naît au lancement depuis `brancheDeDepart` (`ouvrirVraiment`).
5. Partage : `portesDures` fait attendre (reprise armée) ; `deploy.ts` ne fusionne une branche qu'une fois par lot (`sortDesBranches`) ; `archiveCard` laisse une branche encore portée par une carte non archivée.
Preuves : carte « Branches et choix des modèles », commit bd4949d8.

## Vérification

`npm run build:server && node --test server/dist/test/gestion-de-branche.test.js server/dist/test/deploiement-simple-bout-en-bout.test.js` ; puis `npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-branche-et-modeles.mjs` lancé DEPUIS la copie de travail de la carte (démon d'essai à lui, 15 contrôles : bouton, parcours violet, dev/main absents, question laisser/emporter, renommage, menu des modèles, téléphone).

## Pièges

- Ne JAMAIS recalculer `nomDeBranche(card.title, card.id)` pour une carte : une branche renommée ou reprise serait perdue (DEC-371).
- `git worktree add <dossier> <branche>` pour une branche seulement distante : le démon la croit « neuve » et la recrée depuis le départ ; d'où `git branch --track` au moment de la reprise.
- Le geste de réparation « liberer-la-branche » retire la copie qui tient une branche : c'est pourquoi la porte de lancement refuse une branche occupée par un agent actif.
- `git branch -m` d'une branche tenue par une copie fonctionne (git met à jour la copie) ; renommer sur GitHub = push du nouveau nom puis `push --delete` de l'ancien.
- Le violet du menu est déclaré dans la liste des porteurs admis de scripts/verif-themes.mjs ; tout nouveau fichier qui porte `text-teinte` doit y être ajouté.
- Deux cartes créées au même instant n'ont pas d'ordre fixe dans le lot : un test ne doit pas supposer laquelle fusionne en premier.
