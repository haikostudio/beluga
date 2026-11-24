---
name: visionneuse-de-pdf-en-images-a-la-demande
description: À utiliser dès qu'une application web doit montrer un long PDF (rapport, plaquette, contrat de 50 pages et plus) page par page dans un panneau, à partir d'images rendues par le serveur : « le rapport est déformé / étiré dans l'aperçu », « on ne voit qu'une page », « il faut des miniatures et un zoom », « l'aperçu charge les 70 pages d'un coup », « la page courante n'est pas suivie ».
etat: active
themes: interface, pdf, performance
symptomes: rapport PDF déformé ou étiré dans l'aperçu, une seule page visible, aperçu lent qui charge toutes les pages, pas de miniatures ni de zoom, page courante non suivie
---

# visionneuse-de-pdf-en-images-a-la-demande

## Procédure

1. CÔTÉ SERVEUR : rendre les pages en images avec `pdftoppm` (miniatures ~180 px de large pour toutes les pages, une fois ; grandes pages ~1240 px, une par une, à la demande), en cache par empreinte du fichier. Lire AUSSI le format avec `pdfinfo` (`Pages:` et `Page size: L x H pts`) et le garder dans le cache (un petit JSON) ; l'API d'aperçu rend { pages, largeur, hauteur, miniatures[] } et une seconde route rend l'image d'une page.
2. CHAQUE PAGE DANS UN CADRE AUX DIMENSIONS CALCULÉES : largeur = largeur en points × 96/72 × zoom, hauteur = largeur × (hauteur/largeur du PDF) ; l'image vient en `position:absolute; inset:0; width:100%; height:100%`. Jamais une image `w-full h-auto` enfant d'un conteneur `flex` : elle s'y étire (c'est la cause classique du rapport déformé). Le cadre réserve la place avant l'arrivée de l'image : le défilement ne saute pas.
3. TOUTES LES PAGES À LA SUITE dans une zone qui défile (écart ~48 px, ombre diffuse, fond de l'application) ; une IntersectionObserver (racine = la zone, `rootMargin: '800px 0px'`) demande l'image d'une page quand elle approche, une seule fois (un ensemble des pages demandées ; en cas d'échec, la retirer pour réessayer).
4. LA PAGE LUE = la dernière dont le haut a passé le tiers haut de la zone, recalculée par `requestAnimationFrame` au défilement ; « Page n / N » dans l'en-tête, miniature correspondante entourée et gardée en vue (`scrollIntoView({ block: 'nearest' })`), clic sur une miniature = `scrollTo` vers son cadre, flèches du clavier = page suivante/précédente (hors champ d'écriture).
5. ZOOM flottant en haut au centre (−, %, +, Ajuster) borné (ex. 25 %–150 %) ; « Ajuster » = largeur de la zone moins ses marges, suivie par un ResizeObserver.
6. COLONNE DES MINIATURES : fermée d'office quand le panneau est étroit (ex. < 760 px, ResizeObserver sur la racine), ouverte au-delà ou en plein écran, tant que la personne n'a pas basculé elle-même (état `null` = automatique, puis son choix l'emporte).

## Vérification

Dans un vrai navigateur : le ratio hauteur/largeur du premier cadre égale celui du PDF (A4 : 1,414 ± 0,01) et l'image chargée a exactement la taille de son cadre (±1 px) ; juste après l'ouverture, le nombre de pages chargées est très inférieur au total ; panneau étroit → miniatures fermées, plein écran → ouvertes ; clic sur la miniature 3 → `aria-current="page"` sur elle ; flèche bas → compteur à la page suivante. Exemple : Beluga, scripts/verif-marketing-2.mjs (rapport de 53 pages : 3 chargées à l'ouverture), carte « Dossier marketing piloté par le chat » du 24/11/2026.

## Pièges

- Une page rendue à la volée pour TOUT le document à l'ouverture (70 images de 1240 px) fige le panneau et le serveur : miniatures d'abord, grandes pages à la demande.
- Le format de la PREMIÈRE page sert pour toutes : un PDF aux pages de tailles mixtes demanderait le format par page (`pdfinfo -f 1 -l N`).
- Une zone qui défile avec des voiles de fondu peut masquer le haut de la première page : les éteindre dans la visionneuse ou poser une marge haute suffisante.
- Un test qui attend un état passager (étude, rendu) APRÈS le geste le rate quand l'essai va trop vite : poser un MutationObserver avant le geste et lire ce qu'il a vu.
