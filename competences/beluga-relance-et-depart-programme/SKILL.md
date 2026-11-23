---
name: beluga-relance-et-depart-programme
description: À utiliser pour toucher ou essayer dans un vrai navigateur la relance d'une publication bloquée (« Relancer » du menu Publier et du dépanneur), les veilles de dépannage, la ligne « Départ » d'une carte et sa feuille calendrier, la page « Tâches planifiées », la roue de chargement d'un projet de la colonne, ou une image citée par le chemin de sa capture.
etat: active
themes: publication, cartes, interface, verification
symptomes: publication rouge qui ne reprend jamais après le dépannage, pas de bouton pour relancer une publication bloquée, image cassée dans un compte rendu, aucune façon de programmer l'heure de départ d'une carte, rien n'indique qu'un projet se charge
projets: Beluga
---

# beluga-relance-et-depart-programme

## Symptôme

Une publication tombée restait rouge sous « elle reprendra d'elle-même » ; une image citée par un agent s'affichait cassée ; aucune date de départ ne se choisissait à l'écran ; toucher un projet sur téléphone refermait la liste sur un tableau vide.

## Cause

La veille du dépanneur vivait en mémoire et mourait au redémarrage du démon (une mise en ligne de Beluga). Les agents citent `piece:/tmp/…png` (le chemin de la capture) au lieu de l'identifiant ; la pièce, rangée d'office, garde ce chemin dans `chemins`. `card.schedule` existait sans écran.

## Procédure

1. Relance : `deploy.relancer` → `relancerLaPublicationBloquee` (server/src/depannage-publication.ts) : `veillesCoupees` (une seule reprise), `viderLaFileEnRendant` puis `arreterLAgent`, attente que `agentRetientLaPublication` soit faux, puis `reprendreLaPublication`. Bouton commun `BoutonRelancerLaPublication` (mises-en-ligne.tsx).
2. Veilles au démarrage : `reprendreLesVeillesDeDepannage` appelé depuis main.ts après `recoverAfterRestart`.
3. Images : `store.pieceDuChemin` branché dans la route `/api/attachment` ; repli `ImageIndisponible` (cadre-de-media.tsx).
4. Départ : depart-de-la-carte.tsx (`EntreeDuDepart` dans `MenuDesReglagesDeLaCarte` de chat.tsx, `FeuilleDuDepart`, calendrier `GrilleDuMois` d'elements-maison.tsx). Page : `DepartsProgrammes` dans taches-recurrentes.tsx, commande `cartes.programmees`.
5. Roue : `useChoixDeProjetAvecAttente` (web/src/lib/choix-de-projet.ts), lit `cartesChargees`, garde 8 s, utilisé par `ProjectRow` (sidebar.tsx).
6. Essai : `env -u BELUGA_TOKEN node scripts/verif-chargements-et-depart.mjs` (démon jetable + serveur de développement branché), `VERIF_CAPTURES=<dossier>` pour les captures.

## Vérification

`npm run build && npm test` (server/src/test/relance-publication-bloquee.test.ts, 5 cas) puis `VERIF_CAPTURES=/tmp/x env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-chargements-et-depart.mjs` : 64/64 au 19/11/2026 (1440 et 390, clair et sombre). Preuve : carte « Chargements, déploiements bloqués et planification ».

## Pièges

- Le bouton « Configuration de l'agent » d'une carte est `[data-reglages-du-lancement]:visible` ; le bloc `[data-reglages-agent]` reste caché sur la page d'une carte.
- Sur la page d'une carte, le point « Demande » affiche la DESCRIPTION de la carte, pas les messages : un décor qui doit montrer une image l'y met.
- L'encadré de blocage n'apparaît que si l'étape tombée porte `blocage` (`publicationBloquee`, shared/src/menu-publier.ts) : un décor sans lui n'a pas d'encadré.
- Mesurer les boutons d'une feuille du téléphone après ~900 ms : mesurés pendant la montée, deux boutons d'une même rangée paraissent décalés.
- Pour voir la roue, retarder sur le canal l'événement `project.etat` du projet touché (`page.routeWebSocket`).
- Un `aria-label` ne passe jamais par `t()` : verif-langues le refuse.

## Ce qui ne marche pas

Réécrire en base chaque texte d'agent pour remplacer le chemin par l'identifiant : inutile, la résolution par `chemins` couvre l'existant et le futur sans migration.
