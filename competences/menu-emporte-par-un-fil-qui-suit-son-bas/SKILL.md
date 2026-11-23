---
name: menu-emporte-par-un-fil-qui-suit-son-bas
description: À utiliser quand un contrôle navigateur (Playwright) clique dans une conversation ou un fil qui « suit son bas » (chat, journal en direct) : « element is outside of the viewport » sur une entrée de menu pourtant visible, menu ouvert qui s'envole hors de l'écran pendant le test, clic qui échoue seulement quand un agent écrit encore. Dit pourquoi un défilement programmé ne vaut pas un geste, et comment remonter le fil comme une personne.
etat: active
themes: tests, navigateur, defilement
symptomes: element is outside of the viewport sur un élément visible, menu Radix emporté hors de l'écran, fil qui redescend tout seul pendant un test, clic qui échoue seulement pendant qu'un agent écrit
---

# menu-emporte-par-un-fil-qui-suit-son-bas

## Symptôme

Un menu (Radix DropdownMenu/Popover) ouvert depuis un bouton DANS un fil de conversation s'affiche correctement, ses entrées sont « visible, enabled and stable », puis Playwright réessaie le clic des dizaines de fois avec « element is outside of the viewport ». Juste avant le clic, la boîte de l'élément et `elementFromPoint` à son centre sont bons ; juste après, tout le menu est à plusieurs centaines de pixels au-dessus de l'écran.

## Cause

Le fil « suit son bas » tant que le lecteur n'a pas remonté d'un GESTE : la plupart des implémentations ne coupent ce suivi que sur `wheel`, `touchmove` ou une touche (PageUp, flèche haut), et ignorent les événements `scroll` pendant leurs propres recollages. `locator.scrollIntoViewIfNeeded()` — et le défilement automatique que fait `click()` avant de cliquer — est un défilement PROGRAMMÉ : aucun de ces gestes. Le fil se croit toujours « en bas » ; dès que son contenu change (un agent qui écrit, une image qui arrive), un `ResizeObserver` le recolle en bas. Le menu, positionné par rapport à son bouton (popper), suit le bouton et sort de l'écran.

## Procédure

1. Confirmer : relever `scrollTop` de chaque zone qui défile avant le clic, puis 1,5 s plus tard sans rien faire. Si le fil saute à son bas tout seul, c'est ce cas.
2. Dans le contrôle, amener l'élément à la vue COMME UNE PERSONNE : trouver l'ancêtre qui défile (`overflow-y: auto|scroll` et `scrollHeight > clientHeight`), calculer l'écart entre l'élément et le haut (ou le bas) de cette zone, `page.mouse.move(x, y)` au-dessus de la zone, puis `page.mouse.wheel(0, écart)` ; recommencer tant que l'écart n'est pas nul (quelques tours au plus).
3. Ouvrir ensuite le menu par un clic normal : le bouton est déjà à la vue, Playwright ne défile plus, et le suivi est coupé par la molette.
4. Vérifier qu'un vrai utilisateur n'a pas le même défaut (sa molette coupe le suivi) avant de toucher à l'écran.

## Vérification

Le contrôle relève la position du bouton du menu juste après l'ouverture puis toutes les 500 ms pendant 2 s : elle ne bouge plus, et le clic sur l'entrée passe du premier coup. Exemple éprouvé : `scripts/verif-media-vers-piste.mjs` de Beluga (fonction `remonterJusqua`), 79/79 après correction, carte c4403701, commit 52502fe9.

## Pièges

- `force: true` ou un `dispatchEvent('click')` masquent le symptôme et testent un geste qu'aucun humain ne fait : à proscrire.
- La molette doit tomber SUR le fil : un panneau posé par-dessus (décisions en attente, tiroir) prend l'événement à sa place — viser le haut de la zone, vérifier `elementFromPoint`.
- Un repère du type `[data-fil="conversation"]` peut être posé sur l'enveloppe et non sur l'élément qui défile : chercher l'ancêtre qui défile réellement.
- Le défaut n'apparaît que pendant qu'un agent (même factice) écrit encore : un contrôle qui passe au calme peut tomber au prochain tour.

## Ce qui ne marche pas

- `scrollIntoViewIfNeeded()` avant le clic : c'est lui qui déclenche le problème.
- Attendre plus longtemps : le fil continue de se recoller tant que le contenu bouge.
