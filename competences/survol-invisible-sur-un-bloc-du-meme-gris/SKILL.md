---
name: survol-invisible-sur-un-bloc-du-meme-gris
description: À utiliser dès qu'un élément survolé « disparaît » ou fonce au lieu de ressortir dans une interface à fonds gris étagés par jetons (Tailwind + variables CSS) : « au survol l'arrière-plan s'en va », « le bouton ne réagit pas au survol en clair », « hover:bg-border ne se voit pas », ou avant d'écrire le survol d'un élément posé dans un bloc déjà en relief.
etat: active
themes: design, css, theme
symptomes: survol invisible, ligne qui disparaît au survol, survol qui fonce en sombre, survol invisible en thème clair, règle CSS maison ignorée au survol
---

# survol-invisible-sur-un-bloc-du-meme-gris

## Symptôme

Une ligne ou un bouton posé dans un bloc gris prend au survol exactement la couleur du bloc (survol au gris « relief » sur un support au gris « relief »), ou un survol au gris des traits fonce en sombre et ne se voit plus en clair.

## Cause

Les jetons de fond sont étagés (page, surface, relief) et le survol réutilise le gris du cran supérieur — qui est déjà celui du support quand l'élément vit dans un bloc en relief. Le gris des traits est réglé pour se confondre avec les fonds : il ne peut pas porter un survol.

## Procédure

1. Ajouter un jeton gris de survol au-delà du plus haut fond (≥ 4 points de luminosité, à l'opposé de la page : plus clair en sombre, plus foncé en clair), déclaré dans CHAQUE palette (y compris un bloc qui redonne ses propres jetons), exposé à Tailwind sous un nom qui ne heurte pas une variante existante.
2. Remplacer tout survol au gris des traits par ce jeton.
3. Pour le survol générique (bouton « ghost ») : garder sa classe et la faire monter d'une marche selon son support, par une variable héritée posée sur les ENFANTS de chaque fond peint — `[class~='bg-raised'] > * { --survol-sur-support: var(--fond-survol) }`, `[class~='bg-surface'] > *, [class~='bg-bg'] > * { --survol-sur-support: var(--raised) }` — lue par `html [class~='hover:bg-raised']:hover { background-color: hsl(var(--survol-sur-support, var(--raised))) }`. Posée sur les enfants et non sur l'élément, elle suit le fond peint le plus proche, même pour un élément « en creux » dans un bloc en relief.
4. Un déclencheur de menu (Radix `data-state=open`) garde le fond de survol tant que son menu est ouvert.

## Vérification

Au navigateur (Playwright), en clair puis en sombre : survoler réellement l'élément et comparer `getComputedStyle(e).backgroundColor` à celui de son premier ancêtre peint — ils doivent différer, et différer aussi d'un élément frère au repos. Balayer l'écran : pour chaque élément à classe de survol, calculer la couleur de survol (via la variable héritée) et la comparer à son support ; la liste doit être vide. Un contrôle de source refuse tout `hover:bg-border` et vérifie la marche du jeton de survol. Preuve : carte Beluga 0cebea5f, commit 80243a27.

## Pièges

- Tailwind 3 sans `@tailwind variants` pose les variantes `hover:` à la FIN de la feuille : une règle maison de même poids, même écrite en fin de fichier, perd. Ajouter `html` en tête du sélecteur.
- Une variable CSS qui vaut `var(--autre)` se résout sur l'élément qui la déclare : la déclarer sur l'enfant garde la palette locale (un bloc qui redonne ses jetons garde les siens).
- Seule la classe EXACTE déclenche la marche : un support translucide (`bg-raised/95`) ou peint par une classe maison ne compte pas.
- Ne pas modifier les trois fonds existants pour gagner du contraste : tout l'étagement bouge.

## Ce qui ne marche pas

Rendre le survol plus visible en touchant aux fonds existants (casse l'étagement contrôlé) ; prendre le gris des traits comme survol ; corriger bouton par bouton (il en reste toujours ailleurs).
