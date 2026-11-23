---
name: beluga-fenetre-des-reglages-a-deux-niveaux
description: À utiliser dès qu'on ajoute, déplace ou retire une page de la fenêtre des Réglages généraux de Beluga (la roue dentée), qu'on touche à sa navigation (six rubriques, colonne de la rubrique, « Avancé », retour « ‹ Réglages »), à ses blocs gris, ou qu'un bouton d'un autre écran doit ouvrir une page précise des réglages.
etat: active
themes: interface, reglages, navigation
symptomes: un bouton ouvre les réglages sur une page vide, une page des réglages introuvable dans le menu, bloc gris invisible dans la fenêtre des réglages, la flèche du téléphone ne remonte pas d'un cran, la liste des pages disparaît sur téléphone dès qu'on ouvre une rubrique, une septième rubrique apparaît
projets: Beluga
---

# beluga-fenetre-des-reglages-a-deux-niveaux

## Procédure

1. L'ARBORESCENCE vit dans `shared/src/reglages-arborescence.ts` : six rubriques (moi, agents-ia, ordinateurs, serveur, donnees, connexions), chacune `titre` + `phrase` + `pages`. Une page nouvelle va dans la rubrique de son USAGE ; une page technique (journal, juge, gestes sur la machine, API) porte `avance: true` et se range sous « Avancé », replié en bas de la colonne. Jamais de septième rubrique sans accord de l'utilisateur.
2. L'ÉCRAN : `web/src/components/settings-view.tsx`. Inscrire la page dans `RENDU_DES_PAGES` (icône + `paresseux(import, 'NomExporté')`, `avecReglages` / `avecOuverture` au besoin). Un accès tiers : ajouter la clé à `PAGES_DU_SERVICE_REGLAGES` ou `PAGES_DU_SERVICE_MOTEURS` si son service doit l'ouvrir ; sinon la page reste à l'administrateur.
3. RENOMMER OU FUSIONNER une page : garder l'ancienne clé dans `ALIAS_DES_PAGES_DE_REGLAGES` (aujourd'hui capacite→serveur, langue→theme, voix→assistant, extension→ordinateurs, installation→adresse). Les liens `beluga:ouvrir-reglages` {page}, `#reglages/<page>` et les gestes de Jarvis passent tous par là.
4. NAVIGATION : niveau 1 = recherche + grille des six rubriques (pleine largeur). Niveau 2 = colonne de la rubrique (phrase, pages, « Avancé ») + page. « ‹ Réglages » est dans la place `gauche` du `DialogHeader` (`data-retour-rubriques-reglages` sur ordinateur ; `data-retour-menu-reglages="rubrique"|"rubriques"` sur téléphone, qui remonte d'un cran). La page posée dans l'adresse par la fenêtre elle-même est mémorisée (`pageEmise`) : sans ce garde, l'adresse revenue rouvrait la page par-dessus la liste sur téléphone. Fermer la fenêtre oublie sa page : la roue dentée rouvre sur les six rubriques.
5. UNE SECTION DE PAGE : `Groupe` de `reglages/communs.tsx` — titre (+ `aide`, `description`) sur le fond, options dans le bloc gris (`CLASSE_BLOC_DE_REGLAGES`) ; `liste` si les enfants sont des lignes, `nu` si l'enfant dessine son propre bloc (liste de langues, choix du thème). `RubriqueDeReglages` + `LigneDeReglage` (modeles) ont la même tenue.
6. TEXTES : chaque titre et phrase de l'arborescence est une clé du dictionnaire (`shared/src/traductions.ts`, cinq langues) ; un texte retiré se retire du dictionnaire.

## Vérification

`npm run build` puis `node --test server/dist/test/recherche-reglages.test.js` (six rubriques, phrase, aucune page en double, pages « Avancé », chaque alias mène à une page). Serveur de développement de la copie (`npm run dev --workspace web -- --port 7311`) puis `HAIKO_REGLAGES_URL=http://localhost:7311 VERIF_CAPTURES=<dossier sous data/fichiers> node scripts/verif-reglages-deux-niveaux.mjs` : 54/54 le 21/11/2026 (six rubriques sans défiler, recherche qui ouvre rubrique et page, retour, « Avancé », terminal dans « Gestes sur le serveur », anciennes adresses, 1440/390 clair et sombre, thème posé sur le canal sans écrire en base). Carte « Refonte des réglages » (branche tache/refonte-des-reglages-65035f).

## Pièges

Une fenêtre centrée (`FenetreCentree`) ramène `--surface` au fond : un `bg-surface` y est INVISIBLE. Le corps des réglages pose `STYLE_DES_BLOCS` (`--surface: var(--bloc-etapes)`, `--raised: var(--border)`) ; une nouvelle zone hors de ce corps doit faire pareil. Modifier un fichier de web/src ou de shared pendant un contrôle navigateur recharge la page à chaud : contrôle faux. Beaucoup d'anciens scripts (verif-reglages-modale, verif-page-serveur, verif-ajout-de-moteur…) cliquent `[data-page-menu=…]` dans l'ancien menu à un niveau : il faut d'abord cliquer `[data-rubrique-reglages="<rubrique>"]`.

## Ce qui ne marche pas

Forcer le thème d'une capture en posant `data-theme` / `dark` sur la page : les palettes se mélangent (fenêtre claire, blocs sombres). Le thème se réécrit dans les messages du canal (`"theme":"sombre"`) en bloquant `prefs.set`.
