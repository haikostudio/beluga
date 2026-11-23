---
name: beluga-suppression-definitive-d-un-projet
description: À utiliser dès qu'on touche à la suppression d'un projet (réglages > « Mettre de côté », commande project.supprimerDefinitivement, dépôt GitHub / dossier serveur / lignes en base) ou qu'on ajoute une table portant `project_id` : « le bouton Effacer a disparu », « supprimer un projet avec son dépôt », « des lignes orphelines restent après suppression ».
etat: active
themes: projets, interface, beluga, tests
symptomes: on ne peut pas supprimer un projet depuis ses réglages, des lignes d'un projet supprimé restent en base, le dossier ou le dépôt GitHub d'un projet supprimé existe encore
projets: Beluga
---

# beluga-suppression-definitive-d-un-projet

## Procédure

1. Le geste par défaut reste « Mettre de côté » (`project.archive`, `store.mettreProjetDeCote`). `project.delete` (anciens écrans) ne fait QUE cela : jamais d'effacement derrière lui, et le magasin n'a aucun `deleteProject`.
2. La suppression définitive est une commande à part : `project.apercuSuppression` (nombres réels, dépôt visé, raison d'un refus ; ne touche à rien) puis `project.supprimerDefinitivement {id, nomConfirme}`. Elle est dans `shared/src/protocol.ts`, branchée dans `server/src/ws.ts`, appliquée par `server/src/suppression-projet.ts`.
3. Règles pures (testables sans base) dans `shared/src/suppression-projet.ts` : lecture du dépôt GitHub depuis `gitRemote`, refus (nom à l'identique, Beluga lui-même, regroupement garni, agent au travail, mise en ligne en cours), dossier effaçable (absolu, sans « .. », dépôt git, ni parent ni égal à un dossier protégé ou au dossier d'un autre projet).
4. Ordre des effets, jamais modifié : refus ET `constatDuDossier` (zone permise, dépôt git, PREUVE d'effaçabilité par `dep.effacementPossible` : propriétaire + parent inscriptible, sinon `sudo -n true`) — tout refus tombe AVANT le moindre geste irréversible et se lit déjà dans l'aperçu → copie de secours DU PROJET SEUL (`dep.sauvegarder(projet)`, jamais `runBackup`) → dépôt GitHub (`gh repo delete --yes`, un dépôt déjà absent n'est pas une panne, un échec ARRÊTE tout) → adresse publique (`retirerSousDomaine` dans `dns.ts` : bloc Caddy + enregistrement DNS, sans bloquer) → dossier du serveur et copies de travail (`fs.promises.rm`, puis `sudo -n rm -rf --` sur EACCES/EPERM après `refusDEffacerEnElevation`) → fichiers des pièces jointes du projet (`dep.effacerPiecesJointes`, sans bloquer) → cartes par `supprimerLaCarte` (chemin unique), agents, puis `effacerLesLignesDuProjet`.
4 bis. La copie de secours (`server/src/copie-de-projet-supprime.ts`) : `PATHS.backups/projets-supprimes/projet-supprime-<nom>-<id8>-<date>.tar` (sans compression), contenant `donnees.json.gz` (`lignesDuProjet` : `{ projet, exporteLe, tables }`), `pieces-jointes/<nom sur le disque>` et `LISEZ-MOI.txt`. Relue (`tar -tf`) avant de rendre la main ; un écart arrête la suppression. Purgée après 15 jours (`purgerCopiesDeProjetsSupprimes`, balayage horaire de `main.ts`) : seuls les `projet-supprime-*.tar` sont touchés. Restaurer = extraire l'archive, réinsérer les lignes de `donnees.json.gz` table par table, recopier les fichiers dans le dossier des pièces jointes — à la main, sur demande, aucun bouton.
4 ter. Les fichiers d'une pièce jointe se trouvent par `fichiersDeLaPieceJointe` (alias puis `<id>-<nom>`, dans les DEUX dossiers de `dossiersDeLecture`) : jamais par motif ni par empreinte — des projets différents portent le même contenu, chacun a son fichier.
5. `effacerLesLignesDuProjet` lit les tables dans la base (`sqlite_master` + `PRAGMA table_info`) : toute table qui porte `project_id` part avec le projet, sans liste à tenir. Exceptions voulues : `secrets`, `backup_sites`, `sites_surveilles` gardent leur ligne, détachée (project_id = NULL).
6. Les effets sur le monde passent par `Dependances` : les tests posent un dépôt GitHub FACTICE. Ne jamais essayer sur un vrai projet.
7. Interface : `web/src/components/config-projet/suppression-projet.tsx`, posée sous « Mettre de côté » dans `page-retrait.tsx`. Dialogue : « Mettre de côté » proposé en premier, nombres réels, nom à recopier, bouton rouge éteint jusqu'au nom exact. Textes dans `shared/src/traductions.ts` (cinq langues).

## Vérification

`npm run build` puis `node --test server/dist/test/suppression-projet.test.js server/dist/test/suppression-projet-regles.test.js server/dist/test/projet-jamais-efface.test.js` ; `node scripts/verif-suppression-projet.mjs` (démon jetable, navigateur, ordinateur et téléphone, 26 contrôles, dont la copie par projet et l'absence de sauvegarde complète) ; `node scripts/verif-langues.mjs` (première moitié) ; `npm test`.

## Pièges

- Un dossier de projet sous `/root` naît par `sudo -n mkdir -p` + `chown` : il appartient au démon, mais `/root` non. `rmSync` efface son contenu puis bute sur EACCES au `rmdir` (Lukyspot, 08/10/2026 : dépôt GitHub et adresse déjà effacés, projet resté à moitié supprimé). D'où le constat préalable et le repli `sudo -n rm -rf`.
- Ne jamais rappeler `runBackup` depuis la suppression : `VACUUM INTO` est synchrone (better-sqlite3) et le tar de toutes les pièces jointes prend ~90 s, démon figé.
- Le bouton rouge porte `sansAttente` et SA propre roue (« Suppression en cours… ») : l'avertissement commun à 10 s faisait recliquer. Le démon refuse aussi un second appel concurrent (`suppressionsEnCours`).

- Le bouton `[data-archiver-projet]` doit rester UNIQUE dans la rubrique ; le dialogue utilise `data-dialogue-mettre-de-cote`.
- Un export seulement importé par `await import()` est vu « sans appelant » par `scripts/exports-morts.test.mjs` : importer statiquement les modules légers.
- Dans un contrôle navigateur sur téléphone, la colonne des projets est cachée : attendre `state: 'attached'`, pas visible ; mesurer le dialogue APRÈS son glissement (≈700 ms).
- Les colonnes valides d'une carte sont planned / running / to_deploy / archived, et l'état d'une mise en ligne running / success / failed / stopped.
- Modifier la base d'un démon d'essai à la main n'émet aucun événement : l'écran ne suit pas. Préparer un projet distinct par scénario.
