---
name: beluga-pile-depliee-des-tableaux-de-bord
description: À utiliser dès qu'on touche à l'apparence d'un groupe de cartes déplié sur la page « Tableaux de bord » de Beluga (carte mère + sous-cartes, colonne « Actifs » ou « Terminés ») ou au pied de ses cartes : fond du bloc des sous-cartes, fondu sous la mère, écart entre la mère et ses filles, marge, contraste dans les douze palettes, ligne du bas des cartes, ou devant « le contrôle en-route dit que le fond du bloc ne se distingue plus », « le fond des sous-cartes fait un rectangle à part », « les sous-cartes sont estompées avec le fond », « les sous-cartes sont trop loin de la carte principale », « la frise ne respire plus ». Dit où vit chaque pièce, ce qu'elle sait faire et comment la contrôler.
etat: active
themes: interface, cartes, tests
symptomes: le fond du bloc des sous-cartes est lu transparent par le contrôle, le bloc des sous-cartes forme un rectangle détaché de la carte mère, les sous-cartes s'estompent avec leur fond, les sous-cartes sont trop loin de la carte principale, le contrôle « la frise respire » échoue après une retouche du pied de carte
projets: Beluga
---

# beluga-pile-depliee-des-tableaux-de-bord

## Symptôme

Sur « Tableaux de bord », un groupe (une demande commune : mère + filles) se déplie au premier clic. Les filles apparaissent dans un bloc à fond propre, sous la mère. Toute retouche de ce fond, de ses marges ou du pied des cartes peut faire tomber un point de `scripts/verif-en-route.mjs`.

## Cause

Le bloc doit se distinguer À LA FOIS de la zone derrière lui et des cartes posées dessus, dans douze palettes : sa couleur est une marche intermédiaire mesurée, pas un choix d'œil. Et il doit se lire comme la suite de la mère, d'où le fondu en haut et un écart court sous elle. Les cartes de cette page sont à hauteur fixe : chaque pièce (corps, frise, pied) y a sa place mesurée.

## Procédure

1. Les pièces : composant `PileDeCartes` dans `web/src/components/en-route.tsx` (le bloc est le `div.bloc-sous-cartes` porteur de `data-bloc-sous-cartes`, `rounded-lg px-3 pb-3 pt-1`, dans un `pt-1` ; la mère est AU-DESSUS, hors du bloc) ; style dans `web/src/styles.css`, règles `.bloc-sous-cartes`.
2. L'ÉCART SOUS LA MÈRE est de 8 px (4 px au-dessus du bloc + 4 px de marge haute dedans) ; il valait 24 px (deux marges de 12 px). Côtés, bas et écart entre filles restent à 12 px. Le contrôle exige 4 à 10 px.
3. La couleur vit dans la propriété `--fond-bloc-sous-cartes` : en sombre `color-mix` 50 % `--raised` / `--fond-zone` ; en clair voile 12 % (`--voile`) sur `--fond-zone` (en clair `--raised` ne fonce jamais). Ne pas changer ces mélanges sans remesurer.
4. La pose : `background-image: linear-gradient(to top, var(--fond-bloc-sous-cartes) 90%, transparent)` — plein du bas jusqu'à 90 % de la hauteur, transparent au bord haut. Le fondu suit donc la hauteur du bloc ; les coins arrondis du haut disparaissent d'eux-mêmes.
5. Ce que le composant sait faire et qu'on ne touche pas en retouchant le fond : ouverture par `grid-template-rows` 0fr→1fr, filles qui descendent en `translate-y`/`opacity` avec 40 ms de décalage chacune, premier clic qui déplie sans ouvrir de tâche, clic dehors ou Échap qui rempile.
6. LE PIED D'UNE CARTE (`CardTile` en forme `enRoute`, `web/src/components/board.tsx`, repère `data-anciennete-carte`) ne porte QUE l'ancienneté : ni étiquettes ni pastilles de demande commune (`LienDeRegroupement` ne se rend plus qu'au tableau d'un projet). L'heure reste un `span` enfant d'une ligne `flex items-center` : plusieurs mesures du contrôle s'y accrochent.
7. Preuves : carte « Fond contrasté des sous-cartes d'un groupe » (commit 050bd1de), carte « Fond en fondu des sous-cartes » (commit abeaa06f), carte « Curseur, badges et sélecteur de projets » (commit 920a6c61).

## Vérification

`npm run build` puis `env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-en-route.mjs` : 122/122 attendu, dont « le fond du bloc est plein jusqu'à 90 % puis s'estompe vers le haut, sans masque sur les filles », « le fond du bloc se distingue de la zone et d'une carte (≥ 1,10) dans les douze palettes » (pire mesuré : 1,108), « la première fille est à moins de 10 px sous la mère, sans s'y coller » (8 px) et « le pied des cartes ne porte que l'heure », à 1500 px et à 390 px. Regarder ensuite les quatre captures `/tmp/verif-en-route-bloc-{telephone,bureau}-{sombre,clair}.png` : fond visible sous les filles, effacé juste sous la mère, sous-cartes nettes et proches de la mère.

## Pièges

- Le `background-color` du bloc est TRANSPARENT depuis que le fond est un dégradé : un contrôle qui le lit mesure le vide. La couleur pleine se lit sur une sonde (`div` hors flux, `background-color: var(--fond-bloc-sous-cartes)`) posée dans le bloc.
- `getPropertyValue('--fond-bloc-sous-cartes')` rend le texte `color-mix(…)` non résolu : passer par la sonde, pas par la propriété brute.
- Jamais `mask-image` pour le fondu : il estompe aussi les sous-cartes.
- Les cartes ont `transition-colors` : une capture ou une mesure prise juste après un changement de palette lit une couleur à mi-course (attendre ~400 ms ou couper les transitions).
- `verif-en-route.mjs` monte un démon jetable : le lancer depuis la copie de travail de la carte, jamais depuis le dépôt principal.
- Le contrôle mesurait la marge intérieure du bloc sur ses QUATRE côtés (≥ 8 px) : depuis l'écart court, il mesure les côtés et le bas, et l'écart haut à part.
- Retirer le `flex` de la ligne du pied rend le `span` de l'heure « en ligne » : sa boîte mesurée rétrécit de 2 px en haut et en bas, et « la frise respire (±4 px) » tombe alors que l'écran n'a pas bougé. Garder `flex items-center` et le `span`.

## Ce qui ne marche pas

Lire `getComputedStyle(bloc).backgroundColor` après le passage au dégradé : rend `rgba(0, 0, 0, 0)` et fait échouer le contraste à tort. Simplifier le pied en texte nu (sans `span`, sans `flex`) : trois mesures du contrôle perdent leur point d'appui.
