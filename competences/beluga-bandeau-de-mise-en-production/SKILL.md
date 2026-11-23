---
name: beluga-bandeau-de-mise-en-production
description: À utiliser dès qu'on touche, dans Beluga Build, au bandeau « Mise en production » du bas du tableau ou à son tiroir : ajouter une ligne, un bouton ou un état, changer ce que dit le bandeau fermé, ou devant « le bandeau d'un groupe propose d'initier une procédure », « la ligne d'un projet du groupe reste vide », « un lancement refusé fait échouer les autres », « le bandeau reste en cours alors qu'un projet a fini ». Dit ce que l'écran sait faire pour un projet seul et pour un regroupement, quelles pièces réutiliser et comment le contrôler sans rien publier.
etat: active
themes: publication, interface, tests
symptomes: le bandeau d'un groupe propose d'initier une procédure, la ligne d'un membre n'affiche aucune publication, un refus de lancement fait échouer les autres projets, le bandeau reste en cours après la fin d'un membre, la raison d'un bouton éteint renvoie à un interrupteur absent
projets: Beluga
---

# beluga-bandeau-de-mise-en-production

## Symptôme

Le bandeau du bas du tableau doit lancer et suivre une mise en production. Sur un regroupement il agissait sur le regroupement lui-même, qui n'a ni dépôt ni processus : il n'offrait qu'un bouton « Initier » sans objet, alors que chaque projet membre a sa propre procédure.

## Cause

Le tableau montait le même panneau pour tout projet, avec l'identifiant du projet affiché. Deux faits rendent le cas du groupe particulier : (1) l'état de l'écran `state.deploys[projet]` ne porte que la DERNIÈRE publication d'un projet, toutes étapes confondues, et seulement pour un projet déjà ouvert sur cet écran ou dont une publication vient de bouger — pour un membre jamais ouvert, il est vide ; (2) le serveur verrouille une publication PAR PROJET (`startDeploy`), donc plusieurs membres peuvent tourner ensemble sans rien changer côté serveur.

## Procédure

CE QUE L'ÉCRAN SAIT FAIRE (carte mise-en-production-d-un-groupe-de-projet-00b7fd, commit 33f1c520) :
- Projet seul : `DeployPanel` en présentation `bandeau` (`web/src/components/deploy-panel.tsx`). Barre fine (pastille des versions en attente, pourcentage, flèche), tiroir avec interrupteur et réglages en entête, explication du processus, état de la version et bouton en pied ; pendant une mise en production ou après un échec, le tiroir montre le déroulé (`CorpsDuVolet`) avec Arrêter / Relancer.
- Regroupement : `BandeauProductionGroupe` (`web/src/components/bandeau-production-groupe.tsx`), monté par `board.tsx` dès que `membresActifsDuRegroupement` rend un membre. Une ligne par membre (pastille du projet, nom, état de la version ou avancement, échec, raison d'un bouton éteint), un bouton « Mettre en production » par ligne, un bouton vers les réglages du projet, un clic sur la ligne pour le déroulé du membre avec retour, et en pied « Tout mettre en production (n) ».

POUR AJOUTER OU CHANGER QUELQUE CHOSE :
1. Réutiliser `BandeauProduction` (exporté de `deploy-panel.tsx`) et `TiroirProcedureProduction` : props `groupe` (ni interrupteur, ni réglages d'entête) et `avant` (remplace la fusée de l'entête, ex. bouton retour). Ne pas écrire un second tiroir ni un second suivi : le déroulé est toujours `CorpsDuVolet`.
2. Mettre toute règle dans `shared/src/production-de-groupe.ts` avec son test (`server/src/test/production-de-groupe.test.ts`) : `runDeProductionDuMembre`, `raisonMembrePasPret`, `membrePret`, `resumeDeLaProductionDuGroupe`.
3. Pour la publication d'un membre, croiser `state.deploys[membre.id]` avec `deploy.historique` (lecture en base, sans coût) et ne garder que la cible `production`.
4. Lancer par un `deploy.start` par membre (cible `production`), ensemble, avec `Promise.allSettled` ; écrire chaque refus sur la ligne de son projet.
5. Tout texte neuf passe par `t()` et entre dans `shared/src/traductions.ts` (quatre traductions). Une phrase venue d'une constante de `shared` s'y ajoute aussi.
6. Construire (`npm run build`), puis lancer les contrôles depuis la copie de travail de la carte.

## Vérification

Depuis la copie de travail de la carte, après `npm run build` :
- `node scripts/verif-production-groupe.mjs` — 27 contrôles : quatre membres d'essai (deux prêts, un sans processus, un à l'interrupteur éteint), bouton général = deux lancements ensemble après une seule confirmation, refus écrit sur sa ligne, bouton d'une ligne = un seul lancement, moyenne des pourcentages sur le bandeau fermé, réussite et échec simultanés, détail d'un membre et retour, téléphone sans débordement. Démon et base d'essai, aucune publication réelle.
- `node scripts/verif-bandeau-production.mjs` — 57 contrôles : le bandeau d'un projet seul n'a pas bougé.
- `node --test server/dist/test/production-de-groupe.test.js` — les règles pures.
- `HAIKO_LANGUES_URL=http://localhost:<port à soi> node scripts/verif-langues.mjs` avec un serveur de développement lancé sur ce port.

## Pièges

- La phrase « interrupteur éteint » du projet seul renvoie « en haut du tiroir » : le tiroir du groupe n'a pas d'interrupteur, il a sa propre phrase (`MEMBRE_DESACTIVE`).
- Un `aria-label` reste en français fixe : `verif-langues` refuse un `aria-label` traduit. Le `title`, lui, passe par `t()`.
- La barre d'avancée expose `data-erreur="oui"` quand elle est en erreur et RIEN sinon — jamais « true » / « false ».
- Une étape de publication de test doit porter une vraie clé (`merge`, `commit`, `push`, `build`, `publish`, `restart`, `verify`) et un processus de test un `delaiS` par étape, sinon la construction refuse le test.
- Le contrôle d'avant-clic des membres (`deploy.check`) ne tourne que tiroir ouvert, toutes les vingt secondes : tiroir fermé, un agent occupé n'est pas encore connu, et c'est le refus du serveur qui s'écrit sur la ligne.
- Proposer à la mémoire une unité au titre proche de « Bandeau de mise en production » REMPLACE le texte de l'unité existante (MEM-2605) : la relire et la redonner entière en mise à jour.

## Ce qui ne marche pas

- Lire seulement `state.deploys[membre.id]` : vide pour un membre jamais ouvert sur cet écran, et faux dès qu'un déploiement sur ce serveur a eu lieu après la dernière mise en production.
- Laisser le panneau d'un projet seul recevoir l'identifiant du regroupement : il n'a pas de processus, donc seul « Initier » s'affiche.
- Retenir `deploy.start` dans un contrôle sans y répondre : la demande ne revient jamais et les boutons restent en attente ; il faut acquitter soi-même (`{type:'ack', id, ok, error}`).

## Mise en page d'une carte de projet et carte violette (05/10/2026)

- Dans le tiroir d'un groupe, chaque carte de projet (`<li data-membre-production>`) porte ses réglages dans le COIN HAUT DROIT (`data-reglages-membre-production`) et son bouton « Mettre en production » DESSOUS, sur toute la largeur (`Button size="pied"`). Le contrôle mesure les deux (`reglagesEnHautADroite`, `boutonPleineLargeur`).
- Une mise en production pose une carte Système violette (`VignetteMiseEnProduction`) en tête de « En cours » et des « Tableaux de bord » ; terminée, elle attend d'être lue (voir la compétence `beluga-cartes-systeme-des-tableaux-de-bord`). Regarder le tiroir d'un projet, ou le détail d'un membre, vaut lecture (`deploy.read`).
- `client.demanderProduction({ projectId })` fait changer de tableau (`app.tsx`). Pour ouvrir le tiroir du GROUPE affiché sur l'un de ses projets, passer `surPlace: true` : `BandeauProductionGroupe` y répond, l'application ne bouge pas.
- `verif-production-groupe.mjs` compte désormais 47 contrôles ; il note les `deploy.read` partis (`window.__lectures`) et finit par « Tableaux de bord » relu en base.
