---
name: site-montre-en-formats-dans-un-cadre-reduit
description: À utiliser dès qu'une interface web doit montrer un site dans un cadre (iframe) au format téléphone, tablette ou ordinateur — aperçu responsive, navigateur intégré, bac à sable de démo —, y compris quand l'écran est plus étroit que le format : « montre le site comme sur un iPad », « le format ordinateur sur mon téléphone », « le cadre réduit laisse une bande vide en bas », « la page est coupée », « le format téléphone est rétréci sur un téléphone ».
etat: active
themes: iframe, interface, mobile
symptomes: bande vide sous un cadre réduit, page coupée en bas après scale, cadre décalé à gauche quand il déborde, format téléphone rétréci sur un téléphone
---

# site-montre-en-formats-dans-un-cadre-reduit

## Symptôme

On veut voir la VRAIE mise en page d'un format (1280 px pour un ordinateur, 820 pour une tablette) alors que la place disponible est plus étroite. Un cadre simplement posé en `width: 100%` recompose le site à la largeur de l'écran, et on ne voit plus le format demandé.

## Cause

La réduction par `transform: scale()` ne change pas la boîte de mise en page. Sans compensation, le cadre garde sa hauteur d'origine : réduit, il laisse une bande vide en bas. Avec un `flex-shrink` actif, il se fait aussi écraser en largeur, ou il déborde d'un seul côté.

## Procédure

1. Garder une table des largeurs nominales : téléphone 390, tablette 820, ordinateur 1280. Le format ordinateur prend toute la largeur au-delà de 1280.
2. Mesurer la zone d'accueil avec un ResizeObserver (clientWidth et clientHeight), pas avec window.innerWidth.
3. Échelle k = min(1, largeurDisponible / largeurDuFormat). Avec une zone pas encore mesurée (0), k vaut 1.
4. Poser le cadre en `position: absolute; left: 50%; top: marge`, avec `width` = la largeur nominale et `height` = hauteurDisponible / k, puis `transform: translateX(-50%) scale(k)` et `transform-origin: top center`. Une fois réduit, il remplit exactement la place, centré.
5. Mettre la zone d'accueil en `position: relative; overflow: hidden`.
6. N'ajouter le rendu « appareil » (marge, coins arrondis divisés par k, ombre) que si la largeur du format plus deux fois la marge tient dans la zone. Sinon, l'afficher bord à bord : un téléphone vu sur un téléphone reste à l'échelle 1.
7. Poser des repères d'état sur le cadre (data-format, data-echelle) pour les contrôles.
8. Un site qui refuse d'être encadré ne prévient pas : passé un délai sans `load`, proposer un lien qui ouvre la page dans un onglet.

## Vérification

Dans un vrai navigateur (playwright, Chrome système), à 390 × 844 et à 1400 × 900, pour chaque format :
- relever getBoundingClientRect() du cadre et de sa zone ;
- la largeur affichée doit valoir la largeur nominale × k (à 2 px près) ;
- le cadre doit rester dans la zone (gauche, droite et bas) ;
- en format ordinateur à 390 px de large, k ≈ 0,305 et la largeur affichée ≈ 390 ;
- le format téléphone sur un téléphone donne k = 1.
Exemple : scripts/verif-apercu-formats.mjs de Beluga (carte 243e6ca0, commit 67d66b8a).

## Pièges

- Réserver une marge décorative même quand le format remplit déjà l'écran : le téléphone vu sur un téléphone se retrouvait réduit à 0,94.
- Utiliser la largeur de la fenêtre au lieu de celle de la zone : c'est faux dès qu'une colonne ou un volet partage l'écran.
- Centrer avec un flex qui déborde : il faut `flex-shrink: 0`, et le centrage change selon `safe`. La position absolue avec translateX(-50%) évite ces deux problèmes.
- Ne diviser par k que la hauteur et oublier le rayon des coins : réduits, ils deviennent minuscules.

## Ce qui ne marche pas

Un cadre en width: 100% plus un viewport simulé : un iframe ne prend pas de viewport à part, le site se recompose à la largeur réelle. Le zoom CSS (`zoom`) se comporte différemment selon les navigateurs, et les mesures internes du site deviennent fausses.
