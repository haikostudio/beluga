---
name: cartes-collees-qui-se-poussent-face-a-un-panneau
description: À utiliser dès qu'une liste de textes défile à côté d'un panneau collé (démo, image, application) et qu'on veut UNE carte à la fois, de la hauteur du panneau, poussée par la suivante : « chaque fonctionnalité doit avoir la hauteur de la démo », « trois cartes visibles en même temps », « la suivante doit pousser la précédente », « le titre de groupe laisse un trou entre deux cartes », « les cartes ne s'alignent pas sur le panneau ». En CSS pur (sticky), sans calcul au défilement.
etat: active
themes: interface, animation, navigateur, css
symptomes: plusieurs cartes visibles à la fois face au panneau collé, carte plus courte que le panneau d'en face, cartes collées à un autre décalage que le panneau, trou entre deux cartes au changement de groupe, titre de groupe qui reste collé après sa dernière carte
---

# cartes-collees-qui-se-poussent-face-a-un-panneau

## Procédure

1. Chaque élément de liste (`li`) est une PISTE ; sa carte, à l'intérieur, est `position: sticky`. Un élément collé ne sort jamais de son parent : au bout de la piste, la carte part avec elle, et la carte de la piste suivante, qui arrive juste dessous, semble la pousser.
2. Hauteur : la carte reçoit `min-height: var(--h-panneau)` et la piste `min-height: calc(var(--h-panneau) * 1.4)` (le surplus = le temps de défilement où la carte est seule et immobile). `--h-panneau` est MESURÉE en JavaScript (`offsetHeight` du panneau collé) dans un ResizeObserver du panneau — jamais au défilement.
3. Décalage : la carte se colle au MÊME `top` que le panneau. Si ce `top` est calculé (centrage dans la fenêtre), la variable se pose sur un ANCÊTRE COMMUN des deux colonnes, pas sur le panneau lui-même — sinon les cartes ne la voient pas et prennent la valeur de secours.
4. Alignement de départ et de fin : liste et groupes sans marge haute ni basse, pour que la première carte parte du même haut que le panneau et que la dernière parte avec lui (la colonne du panneau s'étire à la hauteur de la rangée de grille).
5. Carte OPAQUE (fond légèrement plus clair que le panneau, carte active en blanc) : celle qui part ne se voit pas à travers celle qui arrive.
6. Titres de groupe : le groupe devient une grille d'UNE case (`display: grid` ; enfants en `grid-area: 1 / 1`) ; le titre y est collé au même `top`, `height: var(--h-panneau)`, `z-index` au-dessus des cartes, `pointer-events: none`. Il ne prend aucune place entre les cartes, s'affiche sur chaque carte de son groupe et part avec la dernière.
7. L'élément « lu » se trouve avec un IntersectionObserver sur les PISTES, bande au milieu de la fenêtre (`rootMargin: '-45% 0px -45% 0px'`) : la piste qui traverse le milieu est celle dont la carte est collée en face.
8. Un clic sur une carte fait défiler jusqu'au DÉBUT de sa piste moins le `top` de collage (lu par `getComputedStyle(carte).top`), pas au centre de la piste.
9. Sur écran étroit (une colonne), tout se remet à plat : `position: static`, hauteurs à 0, titre au-dessus de ses cartes.

## Vérification

Dans un vrai navigateur (Playwright), placer chaque piste au centre de la fenêtre puis mesurer : une seule carte recouvre la bande du panneau de plus de 8 px, et l'écart haut/bas entre la carte lue et le panneau est ≤ 2 px ; répéter à 700, 900 et 1100 px de haut et après la bascule qui change la taille du panneau. Sur écran étroit : aucune carte en `position: sticky`.

## Pièges

- Un titre de groupe collé de hauteur NULLE reste collé tant que son groupe n'est pas sorti : il flotte sur la carte qui part, puis sur celle qui arrive. Il lui faut la hauteur des cartes.
- Une marge négative pour « ne pas prendre de place » ne marche pas : la contrainte du collage se calcule sur la boîte de marge.
- `overflow: hidden` sur un ancêtre casse tout collage ; pour couper un débord horizontal de page, `overflow-x: clip`.
- La page devient longue (nombre de cartes × 1,4 × hauteur du panneau) : garder le surplus de piste juste suffisant.
