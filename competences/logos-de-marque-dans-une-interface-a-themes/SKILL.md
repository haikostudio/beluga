---
name: logos-de-marque-dans-une-interface-a-themes
description: À utiliser dès qu'une interface à plusieurs thèmes (clair, sombre, palettes) doit afficher le logo officiel d'une marque ou d'un service tiers à petite taille, dans du texte ou une liste : « mets le vrai logo, pas une icône inventée », « le logo noir disparaît en thème sombre », « le dégradé du logo s'efface quand il y en a plusieurs sur la page », « le logo devient gris comme le texte », « le contrôle de contraste dit 1.0 alors que l'écran est lisible ».
etat: active
themes: interface, design, icones, tests
symptomes: logo de marque remplacé par un symbole dessiné, logo noir invisible en thème sombre, dégradé ou masque de logo qui disparaît quand plusieurs logos sont affichés, logo en couleurs terni par la couleur du texte, contraste mesuré à 1.0 sur un écran pourtant lisible
---

# logos-de-marque-dans-une-interface-a-themes

## Symptôme

Les moteurs ou services tiers sont montrés par des symboles dessinés à la main : personne ne reconnaît les marques. Une fois les vrais logos posés, les logos noirs disparaissent dans les thèmes sombres, les logos en couleurs sont ternis par la couleur du texte, ou un logo à dégradé s'éteint dès qu'il apparaît plusieurs fois.

## Cause

Un logo de marque n'est pas une icône de jeu : il a ses couleurs, parfois aucune (noir sur blanc), parfois un dégradé fait de filtres et de masques qui portent un identifiant. Traité comme une icône — tout en `currentColor`, ou tout en couleur fixe — il casse dans une des deux familles de thèmes.

## Procédure

1. Prendre les TRACÉS OFFICIELS, ne rien dessiner. L'API d'Iconify rend un SVG par adresse, sans compte : `https://api.iconify.design/<jeu>/<nom>.svg`. Jeux utiles : `logos` (couleurs de marque), `simple-icons` (une teinte, `currentColor`), `vscode-icons`. Comparer avec le favicon du site de la marque (`<link rel="icon">`).
2. Faire une PLANCHE avant de choisir : une page HTML avec tous les candidats à 64 px et à 14 px, sur fond clair puis sombre, capturée au navigateur. On y voit tout de suite un mot-symbole illisible à 14 px ou un logo noir invisible en sombre.
3. Recopier les tracés DANS LE CODE (un composant par logo, `viewBox` d'origine) : aucune dépendance et aucun appel réseau à l'affichage.
4. Ranger chaque logo dans une des DEUX familles. En couleurs : `fill` FIXE à la teinte de marque, pour qu'une classe de couleur de texte de l'appelant ne le reteinte pas. D'une seule teinte (logo noir) : `fill="currentColor"` sur la couleur du texte principal du thème — noir en clair, clair en sombre.
5. Un logo dont le tracé ÉVIDE des lettres (carré plein avec lettres en creux) laisse voir le fond du thème à travers : poser dessous un rectangle de la couleur officielle des lettres.
6. Un logo à dégradé, filtre ou masque : identifiants UNIQUES par exemplaire (`React.useId`, en retirant les « : » qui ne passent pas dans `url(#…)`). Partagés, ils pointent tous vers le premier logo de la page et s'éteignent quand celui-ci est caché.
7. Une marque qui n'a QU'UN mot-symbole (son nom écrit) n'a pas de logo lisible à la taille d'une lettre : prendre le symbole de la maison mère, et l'écrire en commentaire.
8. Garder un repli NEUTRE pour tout ce qui n'a pas de logo connu, et lui seul en teinte discrète.
9. Dans une rangée : le logo ne rétrécit pas (`shrink-0`), c'est le nom qui se tronque (`min-w-0 truncate` sur son propre bloc).

## Vérification

Poser un repère sur chaque logo (attribut `data-…` qui dit lequel est affiché) et contrôler au navigateur, sur des données réelles : (a) le logo est à gauche du nom et sur la même rangée (bord droit du logo ≤ bord gauche du nom, centres verticaux à 3 px près) ; (b) c'est le logo attendu pour ce service ; (c) pour chaque thème, le contraste entre la teinte calculée d'un logo d'une seule teinte et le premier fond opaque sous lui est ≥ 4,5. Capturer la page en clair et en sombre et REGARDER les captures. Exemple complet : `scripts/verif-logos-moteurs.mjs` du projet Beluga (commits 53a3905b et 89513dd7), 29 points sur 29.

## Pièges

- Une couleur calculée n'est pas toujours écrite « rgb(…) » : un fond mélangé sort en `color(srgb …)` ou `oklab(…)`. Une expression régulière la lit comme du noir et le contraste tombe à 1.0 sur un écran parfaitement lisible. La faire PEINDRE sur un canevas d'un pixel puis lire le point (`fillStyle`, `getImageData`).
- Couper les transitions (`* { transition: none !important }`) avant de changer de thème dans un contrôle : lue en plein fondu, la teinte a changé et pas encore le fond.
- Un défaut de couleur discrète posé sur le composant (texte pâle) ternit les logos d'une seule teinte : le réserver au repli neutre.
- Le jeu `logos` donne parfois le mot-symbole entier sous le nom de la marque (`logos:cursor`, `logos:google-gemini`) : chercher la variante `-icon`, ou le symbole seul dans un autre jeu.
- Les logos restent des marques déposées, même tirés d'un jeu libre : les montrer pour DÉSIGNER le service, sans les modifier ni les recolorer au-delà du clair/sombre.

## Ce qui ne marche pas

Tout passer en `currentColor` : les logos en couleurs deviennent gris. Tout figer en couleur : les logos noirs disparaissent dans les thèmes sombres. Reprendre le favicon en image : flou à l'agrandissement, fond carré opaque qui jure avec le thème. Dessiner un symbole « qui ressemble » : personne ne reconnaît la marque.
