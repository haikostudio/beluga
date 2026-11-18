---
name: onde-d-impact-sur-un-titre-html
description: À utiliser dès qu'un titre ou un texte HTML doit onduler comme de l'eau touchée du doigt (cercles concentriques qui s'élargissent et s'amortissent), par filtre SVG dans le navigateur ou dans un shader WebGL : « effet aqua sur le titre », « goutte qui tombe sur le texte », « le texte se déchire au lieu d'onduler », « bords des lettres en escalier pendant l'effet ».
etat: active
themes: animation, svg, webgl, interface
symptomes: texte déchiré par blocs pendant l'onde, lettres en marches d'escalier, onde invisible sur Safari, onde invisible sous une toile WebGL, tout le texte décalé hors du disque de l'onde
---

# onde-d-impact-sur-un-titre-html

## Symptôme

Une onde radiale sur du texte net donne des lettres découpées en morceaux ou crénelées au lieu d'une ondulation d'eau.

## Cause

Deux causes indépendantes. 1) La pente de l'onde (2π × amplitude / longueur d'onde) dépasse ~0,5 : le déplacement se replie et coupe les lettres. 2) feDisplacementMap de Chromium échantillonne au pixel le plus proche : des déplacements sous le pixel deviennent des marches, même en densité 2. Un shader WebGL en filtrage linéaire n'a pas ce second défaut.

## Procédure

1. Une seule formule du champ, f(r) pour r = distance / rayon de 0 à 1 : sin((r − front)·2π·N) × max(train gaussien autour du front, traîne faible derrière) × fondu au bord ; N ≈ 5 ondes par rayon, front 0,78, épaisseur 0,16. Mesures en em de la taille du titre pour garder la même allure sur grand et petit écran.
2. Filtre SVG (Chromium) : une carte de déplacement précalculée une fois dans une toile 2D (R = 0,5 + 0,5·cos θ·f, V = 0,5 + 0,5·sin θ·f), en data URL dans un feImage ; sous elle un feFlood rgb(128,128,128) fusionné (feMerge), sinon tout ce qui est hors du disque est décalé de scale/2 ; color-interpolation-filters="sRGB" et primitiveUnits="userSpaceOnUse". À chaque image : agrandir le feImage (x, y, width, height autour du point d'impact) et régler scale = 2 × amplitude.
3. Amplitude dans le temps : montée sur le premier quart, puis (1 − p)^1,5 ; garder la pente sous 0,5 à tout instant (au début, les cercles sont serrés). Ajouter feGaussianBlur stdDeviation = min(0,45, 0,12 × amplitude px) après le déplacement pour adoucir les marches.
4. Ne poser le filtre (style.filter) que pendant l'impact et le retirer à la fin : à scale 0 sans flou, le rendu filtré est identique au texte net, donc aucun saut à l'allumage.
5. Cadence aléatoire (setTimeout 5–12 s), ignorée onglet caché, titre hors écran, mode édition, et rien sous prefers-reduced-motion.
6. Safari et Firefox : pas de filtre SVG sur du HTML (faux en haute densité, lent) — rien, ou le shader si le texte est déjà dans une toile. Dans une toile WebGL : même formule en GLSL appliquée aux UV de la copie du texte seulement, bornée à la boîte du titre avec un fondu.

## Vérification

Exposer un crochet de test (window.__ondeTitre) qui déclenche un impact. Pour photographier un état précis, remplacer requestAnimationFrame par une version qui renvoie base + N ms et fixer Math.random, puis capturer à 300, 600 et 900 ms en densité 2 : lettres courbées, sans coupure ni marches. Vérifier style.filter vide après la durée, et l'absence du crochet sous prefers-reduced-motion. Comparer une capture sans filtre et avec filtre à scale 0 : différence nulle.

## Pièges

Une capture d'écran Playwright prend plusieurs centaines de millisecondes : des captures « à 450 ms » en temps réel tombent souvent après la fin de l'onde — figer l'horloge. Sans feFlood neutre, le titre entier glisse dès que le filtre est posé. Un filtre url(#…) actif pendant une copie du DOM en image (modern-screenshot) peut casser la copie.

## Ce qui ne marche pas

12 ondes par rayon et 0,09 em d'amplitude : texte déchiré. Flou constant de 0,8 px : titre mou pendant toute l'onde. Régénérer la carte à chaque image : coûteux, inutile — l'agrandir suffit.
