---
name: beluga-acces-tiers-et-grille-de-droits
description: À utiliser dès qu'il faut ouvrir, restreindre ou contrôler l'accès d'une autre personne à l'environnement de développement de Beluga (droits par projet, coffre, réglages, moteurs, mise en ligne), ou ouvrir une nouvelle commande à un accès tiers.
etat: active
themes: securite, comptes, reglages
symptomes: un tiers ne voit pas un projet, Cette action ne vous est pas ouverte, bouton Déploiement absent pour un collaborateur, onglet Sous-comptes introuvable
projets: Beluga
---

# beluga-acces-tiers-et-grille-de-droits

## Procédure

1. Les accès tiers se gèrent dans Réglages → Mon compte → « Accès à Beluga » (administrateur seul). L'onglet « Sous-comptes » n'existe plus ; les comptes CLIENTS se créent depuis la messagerie.
2. Chaque accès porte une grille (`shared/src/droits-d-acces.ts`, colonne `users.droits`) : projet → voir / travailler / déployer (absent = fermé) ; services `coffre`, `reglages`, `moteurs` → aucun / voir / modifier.
3. Le niveau `membre`/`lecteur` et `user_projects` se déduisent de la grille (`changerLesDroits` dans `server/src/comptes.ts`) : ne jamais les écrire à la main.
4. Ouvrir une commande à un tiers : l'ajouter à `COMMANDES_LECTURE`/`COMMANDES_TRAVAIL` (droits-commandes.ts), `COMMANDES_DEPLOIEMENT` ou `COMMANDES_DES_SERVICES` avec son descripteur de projet ; les événements globaux d'un service vont dans `EVENEMENTS_DES_SERVICES`.
5. Côté écran, garder un geste avec `aLeNiveauSurLeProjet` / `niveauDeMonService` (`web/src/lib/mes-droits.ts`), jamais `monRole` seul.
Preuves : carte « Suivi du déploiement invisible » (branche tache/suivi-du-deploiement-732b1b).

## Vérification

`npm run build:server && node --test server/dist/test/droits-d-acces.test.js` ; puis, dans l'écran, créer un accès avec un projet en « Voir » : le bouton « Nouvelle tâche » et le bouton « Déploiement » n'y paraissent pas.

## Pièges

- Le serveur relit la grille en base à chaque geste (`refusDeLaCommande`) : un test qui garde le compte du canal en mémoire ne voit pas un droit retiré.
- Le coffre d'un tiers est filtré dans la RÉPONSE (`reponsePourLeCollaborateur`) : chaque commande `coffre.*` rend l'état entier du coffre.
- Les dossiers du coffre et `deploy.stop/retry/depanner` (visés par numéro de passage) restent à l'administrateur.
- Un accès d'avant la grille n'a pas de `droits` : `droitsDuCompte` les déduit (membre = travailler, lecteur = voir).
