---
name: zoom-et-carrousel-d-images-au-pointeur
description: À utiliser dès qu'une visionneuse d'images web doit zoomer (clic, double toucher, molette, pincement) et faire défiler les images en carrousel, sans bibliothèque : « le pincement zoome toute la page », « glisser l'image agrandie change d'image », « les images voisines débordent sur la courante », « le carrousel saute en revenant à la première », ou pour tester ces gestes dans Chrome sans écran.
etat: active
themes: interface, mobile, images, navigateur, tests
symptomes: le pincement zoome toute la page, les images voisines débordent sur l'image affichée, un déplacement déclenche un zoom, le carrousel clignote au passage, le glissement au doigt est impossible à simuler dans un test
---

# zoom-et-carrousel-d-images-au-pointeur

## Procédure

1. Sépare les RÈGLES PURES (testables sans écran) : bornes du zoom (1 à 5), point fixe `t' = p − (s'/s)(p − t)` avec `translate(t) scale(s)` et origine au centre, bornes du déplacement `max(0, (contenu·s − scène)/2)` par axe, taille contenue `min(L/l, H/h)`, rang voisin en boucle `((r + d) % n + n) % n`, seuil de glissement (un quart de la largeur, ou geste vif > 0,45 px/ms sur 24 px, jamais plus vertical qu'horizontal).
2. La scène porte `touch-action: none` et lit tout aux événements de pointeur (`setPointerCapture`, une Map des pointeurs) : un pointeur = déplacer (si zoomé) ou glisser le carrousel ; deux = pincer autour du milieu, plus le déplacement du milieu. Un geste qui a bougé de plus de ~6 px n'est jamais un clic. Souris : le clic bascule 1× ↔ 2,5× autour du point. Toucher : double toucher < 300 ms et < 40 px.
3. Molette : écouteur NON passif posé à la main (`addEventListener('wheel', f, { passive: false })`), facteur `exp(−deltaY·k)`, k plus fort quand `ctrlKey` (pincement du pavé sur Mac).
4. Carrousel : trois vues (précédente, courante, suivante) dans une piste ; chaque voisine placée par `transform: translateX(±100%)`. Pour passer : animer la piste à ∓largeur, puis dans le MÊME rendu (après l'animation) remettre la piste à 0 sans transition et changer d'index — avec des clés par identifiant, la vue voisine devient la courante sans recharger l'image. Deux images : précédente et suivante sont la même, donne-leur une clé par place.
5. Remets le zoom à 1 à chaque changement d'image ; précharge les deux voisines en bouclant (`new Image().src`).

## Vérification

Dans Chrome (playwright, `channel: 'chrome'`), deux gabarits : 1440×900 souris et 390×844 `hasTouch` + `isMobile`. Mesurer la hauteur de la fenêtre sur une image large puis une image haute (identiques), la hauteur visible de l'image haute = hauteur de la scène, un attribut `data-zoom` qui passe à 2.50 au clic puis revient à 1.00, la boucle dernière → première aux flèches et au clavier. Le glissement au doigt se simule par CDP : `context.newCDPSession(page)` puis `Input.dispatchTouchEvent` (touchStart, plusieurs touchMove, touchEnd) ; le double toucher par deux `page.touchscreen.tap` à 80 ms d'écart. Preuve : scripts/verif-visionneuse.mjs de Beluga (38 contrôles), carte « Visionneuse d'images repensée », commit 784d90ad.

## Pièges

- Sans `touch-action: none`, iOS/Android zoome la PAGE entière au pincement ; ne le pose QUE sur la scène image (un PDF ou un texte dans la même fenêtre doit encore défiler).
- Une vue posée en `absolute inset-0` puis décalée par `left: -100%` garde `right: 0` : elle s'ÉTIRE sur deux largeurs et recouvre l'image courante. Décaler par `transform`, jamais par `left`.
- Les flèches posées sur la scène doivent arrêter `pointerdown`/`pointerup` (stopPropagation), sinon leur clic compte aussi comme un clic de zoom.
- Une couleur de flèche écrite en dur (`bg-black/45 text-white`) échoue aux contrôles de thèmes : prendre les jetons (`bg-surface/75 text-text`).
