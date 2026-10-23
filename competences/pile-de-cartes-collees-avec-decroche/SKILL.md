---
name: pile-de-cartes-collees-avec-decroche
description: À utiliser dès qu'une série de cartes doit se coller en haut de l'écran et s'empiler au défilement en laissant dépasser le bord de la précédente (« stacked cards », « cartes qui se superposent avec un petit décroché ») en CSS pur, ou devant : « les premières cartes partent avant que la dernière arrive », « la pile ne se forme jamais entière », « l'écart entre cartes casse l'empilement ».
etat: active
themes: css, animation, interface
symptomes: les cartes du haut quittent la pile avant que la dernière se pose, la pile ne montre jamais les trois cartes ensemble, le padding du bas ne change rien
---

# pile-de-cartes-collees-avec-decroche

## Symptôme

Les cartes collées s'empilent, mais au moment où la dernière arrive, les précédentes remontent déjà : la pile complète n'est jamais visible.

## Cause

Une carte collée ne sort jamais de la BOÎTE DE CONTENU de son parent, et c'est sa boîte de MARGE qui compte. `space-y-*` (Tailwind 4 : marge basse sur chaque enfant sauf le dernier) ajoute la marge à la carte collée : elle part dès que sa marge touche le bas du contenu, soit un écart trop tôt. Un `padding-bottom` sur le parent n'y change rien (hors boîte de contenu).

## Procédure

1. Un parent commun pour toutes les cartes (jamais une enveloppe par carte : la carte resterait collée dans sa seule enveloppe). Aucun ancêtre en `overflow: hidden/auto` (`overflow-x: clip` est sans danger).
2. Chaque carte : `position: sticky; top: calc(<zone réservée> + var(--i) * <décroché>)`, `--i` = rang, `z-index: i + 1`, fond opaque, ombre vers le haut (`0 -14px 40px -24px`) pour lire la superposition. Le `top` de départ passe sous tout en-tête fixe qui peut réapparaître.
3. Écart entre cartes en `display:flex; flex-direction:column; gap:<n>vh` (le gap n'est pas une marge), JAMAIS `space-y` ni `margin`.
4. Après la dernière carte, une CALE vide (`<div aria-hidden style="height:8vh">`) DANS le parent : elle prolonge la boîte de contenu, la dernière carte se pose à son décroché et les trois restent ensemble un moment avant de partir.
5. Hauteur de carte identique et bornée à l'écran (`min(520px, 100dvh - 160px)`) ; sur téléphone, réduire les illustrations pour que carte + `top` tiennent dans 640 px de haut, sinon le bas de chaque carte n'est jamais vu.
6. Si un observateur d'apparitions anime la page, il doit ignorer les éléments collés et leurs enfants (opacité/translation sur une carte collée = saut).

## Vérification

Au vrai navigateur, `scrollTo({behavior:'instant'})` par pas de 200 px depuis le haut de la pile, relever `getBoundingClientRect().top` de chaque carte : on doit voir un pas où TOUTES valent leur `top` attendu (ex. 88, 108, 124-128) avant qu'elles ne remontent ensemble. Vérifier aussi `scrollWidth == innerWidth` à 360 px. Vérifier `html { scroll-behavior }` : en `smooth`, lire après la fin du défilement.

## Pièges

- `space-y` / `margin` entre cartes : pile incomplète (cartes du haut parties un écart trop tôt).
- `padding-bottom` du parent pour prolonger : sans effet, il faut un élément de contenu.
- Mesurer pendant un défilement doux donne des positions intermédiaires fausses.
