---
name: cartes-de-galerie-a-hauteur-egale
description: À utiliser dès qu'une galerie ou une grille de cartes montre des aperçus de proportions différentes (vidéo verticale, carré, 16:9, image animée) avec un texte dessous : « les cartes n'ont pas la même hauteur », « les textes ne sont pas alignés en bas », « un aperçu vertical étire toute la ligne », « la grille saute quand les images arrivent ». Dit comment fixer la boîte d'aperçu, réserver la hauteur du texte et le prouver dans un vrai navigateur.
etat: active
themes: interface, design
symptomes: cartes de hauteurs inégales, aperçu vertical qui étire la ligne, textes pas alignés en bas, grille qui saute à l'arrivée des images
---

# cartes-de-galerie-a-hauteur-egale

## Symptôme

Dans une grille de cartes (aperçu en haut, titre, phrase, bouton), une carte dont l'image est verticale est beaucoup plus haute que ses voisines, les textes ne tombent pas à la même hauteur et la grille saute quand les images se chargent.

## Cause

L'image a une classe du genre `h-full w-full` dans un conteneur qui n'a qu'un `aspect-ratio` posé sur un élément de flux (souvent un bouton) : dans une case de grille étirée, c'est la hauteur NATURELLE de l'image qui gagne. Et une phrase repliée sur 3 lignes ne prend que 1 ou 2 lignes quand elle est courte : le bloc texte varie lui aussi.

## Procédure

1. La carte est une colonne flex `h-full` (la grille étire déjà les cases d'une même ligne).
2. L'aperçu vit dans une BOÎTE à proportion fixe (`relative aspect-video w-full shrink-0 overflow-hidden`) ; ce qui est cliquable dedans est en `absolute inset-0`, et l'image (ou la vidéo) en `h-full w-full object-contain` : centrée dans les deux sens, jamais rognée, jamais plus haute que la boîte. Fond neutre (`bg-raised`) pour les bandes vides.
3. Chaque ligne de texte a une HAUTEUR RÉSERVÉE en pixels avec la même interligne : titre `h-[18px] leading-[18px] truncate`, phrase `h-[48px] leading-[16px] line-clamp-3`, auteur `h-[16px] truncate` ; le bouton en `mt-auto`.
4. Le texte replié ne va JAMAIS dans un `<button>` (le repli y casse) : seul l'aperçu est un bouton.
5. La silhouette de chargement réutilise les MÊMES constantes de classes (boîte, hauteurs de lignes, bouton invisible) : la grille ne saute pas à l'arrivée des données.
6. Un clic sur l'aperçu peut ouvrir une fenêtre agrandie (même `object-contain` dans une boîte 16:9 plus grande) ; ce qui n'est utile qu'en grand (texte long, liens) se charge à l'ouverture, pas avec la liste.

## Vérification

Dans un vrai navigateur (Playwright), lire `getBoundingClientRect().height` des 20 à 40 premières cartes : un seul nombre attendu ; lire le rapport largeur/hauteur de la boîte d'aperçu (16/9 à 0,05 près) ; recommencer à 390 px de large. Preuve : Beluga, carte « Bibliothèque : grille, filtres et sources » (commit 10490230), `scripts/verif-studio.mjs` — 235 px partout sur bureau, 232 px partout sur téléphone, avec des aperçus 9:16, carrés et 16:9 dans les mêmes lignes.

## Pièges

- `object-cover` résout la hauteur mais rogne les aperçus verticaux : on ne voit plus le sujet.
- Une classe `line-clamp-3` sans hauteur fixe laisse une phrase courte raccourcir la carte.
- Mesurer la hauteur d'UNE carte ne prouve rien : comparer toutes les cartes de plusieurs lignes, sur ordinateur ET sur téléphone (le nombre de colonnes change).

## Ce qui ne marche pas

Poser `aspect-video` sur le bouton qui contient l'image `h-full` : la case de grille le laisse grandir. Égaliser par `grid-auto-rows` sans fixer l'aperçu : toutes les cartes prennent la hauteur de la plus haute, avec des trous.
