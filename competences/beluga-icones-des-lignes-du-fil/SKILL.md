---
name: beluga-icones-des-lignes-du-fil
description: À utiliser dès qu'on ajoute, change ou contrôle l'icône d'une ligne du fil d'une carte de Beluga (le second niveau sous « Travail », « Dépôt », « Réflexions », mémoire, compétence), ou qu'un genre de bloc raconté est ajouté : « une ligne du fil n'a pas d'icône », « le trait vertical traverse l'icône », « un contrôle ne trouve plus le point du fil », « l'icône est colorée en clair ou sur les palettes plates ».
etat: active
themes: interface, cartes, journal, tests
symptomes: ligne du fil sans icône, trait vertical qui traverse une icône, genre de bloc sans icône, contrôle navigateur qui ne trouve plus le point du fil, violet refusé par verif-themes
projets: Beluga
---

# beluga-icones-des-lignes-du-fil

## Symptôme

Le fil d'une carte montrait une colonne de points gris identiques : on ne distinguait ni une commande, ni la mémoire, ni une compétence (demande du 13/10/2026). Après la refonte, d'autres symptômes possibles : une ligne qui reste un point gris alors que sa sorte est connue, un trait qui mord sur l'icône ou laisse un trou, un contrôle navigateur rouge parce qu'il cherchait le point de 5 px.

## Cause

Le second niveau passait par `SousPointDuFlux` (`web/src/components/flux-en-points.tsx`), qui dessinait toujours `PointDuFil` (5 px, `bg-muted`). Chaque ligne porte désormais, si l'appelant la passe par la prop `icone`, l'icône de sa sorte (`RondDeLaLigne`, `web/src/components/icone-du-point.tsx`) ; sans elle, le point reste. L'emplacement `[data-sous-point-rond]` ne change pas (24 px sur l'axe, 20 px imbriqué) : seul son contenu change, donc le texte ne bouge pas d'un pixel. Hors de la carte d'un passage, la discussion masque le rond du premier niveau (`rondDuSousPoint: 'hidden'`) : l'icône y est montée mais sans largeur.

## Procédure

1. Une sorte de ligne propre au fil : ajouter son nom à `SorteDeLigneDuFil` et son icône à `ICONE_DE_LA_LIGNE`, puis passer `icone={ICONE_DE_LA_LIGNE.<sorte>}` à son `SousPointDuFlux`.
2. Un genre de bloc raconté : l'ajouter à `GENRES_DE_BLOC` (`shared/src/recit-du-tour.ts`) ; `ICONE_DU_GENRE` est un `Record<GenreDeBloc, LucideIcon>`, la compilation refuse tant qu'il n'a pas son icône. Reprendre, si elle existe, celle de son encadré (`contenu-journal.tsx`).
3. Couleur : jamais en dur — `text-muted` (gris), `text-danger` (échec), `text-teinte` + `animate-pulse-soft` (travail en cours). Un nouveau fichier qui porte `teinte` doit être ajouté à la liste des porteurs admis de `scripts/verif-themes.mjs`.
4. Géométrie du trait : sur l'axe, `top-[23px]` sous une icône (`top-[18.5px]` sous un point) et `-bottom-[13px]` ; imbriqué, `top-[25px]` (`top-[20.5px]`) et `-bottom-[3px]`. Le point de tête 7 px (`[data-point-de-la-carte]`) et la ligne de repli « voir les N précédentes » partagent le même bas (`-bottom-[13px]`).
5. Ne pas passer d'icône aux lignes internes d'un encadré (les sept lignes du dépôt), aux sections du compte rendu (`rapport-flux.tsx`) ni aux points de la compréhension : elles gardent `PointDuFil`.

## Vérification

`npm run build:server` ; serveur de développement `npm run dev --workspace web -- --port 7099` (localhost) ; puis, avec `env -u BELUGA_TOKEN BELUGA_VERIF_URL=http://localhost:7099` : `node scripts/verif-comprehension-en-points.mjs` (`BELUGA_VERIF_CARTE=<id>` pour imposer une carte visible au tableau : la plus récente peut dormir hors des vingt premières), `node scripts/verif-parcours-travail.mjs` (ligne « chaque genre de ligne du récit porte sa propre icône »), `HAIKO_THEMES_URL=http://localhost:7099 node scripts/verif-themes.mjs`, puis `node scripts/nettoyer-essais.mjs`. Contrôle du trait : sur chaque `li` avec `[data-sous-point-trait]` et `[data-sous-point-icone]`, `trait.top - icone.bottom` vaut 4 px (22 lignes mesurées, ordinateur et téléphone).

## Pièges

- `data-point-du-fil` est posé sur le point ET sur l'icône : pour ne juger que les points de 5 px, exclure `[data-sous-point-icone]` et le point de tête (`[data-point-de-la-carte] *`, 7 px par conception).
- Une icône hors de la carte d'un passage a une largeur de 0 (rond masqué) : ne mesurer que celles qui occupent de la place.
- `verif-parcours-travail.mjs` avait deux lignes déjà rouges avant cette carte (rond de 24 px sur l'axe du grand rond : 0 sous-point lu ; « Dépôt » : pied à −1 px) : la refonte en discussion avait retiré le grand rond, leurs sélecteurs sont périmés — ne pas les confondre avec une régression des icônes.
- `verif-themes.mjs` refuse aussi `text-white` dans `web/src/components/ui/index.tsx:72`, sans lien avec les icônes.
- Une carte déjà rangée (archive) n'est pas posée au tableau : un script qui l'ouvre par son titre attend en vain.
