---
name: element-flottant-recouvert-malgre-son-z-index
description: À utiliser dès qu'un élément flottant d'une application web React (bouton rond, module vocal, bulle d'aide, lecteur, widget en position fixed) disparaît sous une page, un tiroir ou une discussion alors que son z-index est plus haut : « je l'active mais je ne le vois pas dans cette page », « il est caché sous la zone d'écriture », « monter le z-index ne change rien ».
etat: active
themes: css, interface
symptomes: élément fixed caché sous une page malgré un z-index élevé, monter le z-index ne change rien, widget visible sur l'accueil mais pas dans une discussion
---

# element-flottant-recouvert-malgre-son-z-index

## Symptôme

Un élément en `position: fixed` (module flottant, rond d'assistant) se voit sur certains écrans mais pas quand une page ou un tiroir est ouvert, même avec un z-index supérieur à celui de la page.

## Cause

Le z-index ne se compare qu'entre frères d'un même CONTEXTE D'EMPILEMENT. Un ancêtre avec `position: relative` + `z-index` (même 1), un `transform`, un `filter`, `opacity < 1`, `isolation: isolate` ou `will-change` crée un contexte : tout ce qu'il contient, fixed compris, est rangé au rang de cet ancêtre. Les pages et tiroirs, eux, sont souvent rendus en portail dans `body`, donc AU-DESSUS de ce contexte.

## Procédure

1. Prouver l'empilement au lieu de deviner : dans le navigateur, `document.elementFromPoint(centreX, centreY)` au centre de l'élément ; s'il rend un nœud de la page et pas de l'élément, il est recouvert.
2. Remonter ses ancêtres et lister ceux dont `getComputedStyle(e).zIndex !== 'auto'` ou qui ont un transform/filter : c'est le contexte qui l'enferme.
3. Rendre l'élément en portail : `createPortal(<…/>, document.body)` (React garde ses contextes à travers le portail).
4. Lui donner un rang dans l'échelle de l'application : au-dessus des pages et tiroirs, sous les menus et infobulles (qui doivent pouvoir s'ouvrir par-dessus).
5. Vérifier qu'il ne chevauche pas les autres éléments flottants du même coin (robot d'assistant, rangée de ronds) : comparer les boîtes.

## Vérification

Contrôle navigateur (Playwright) qui ouvre l'écran où l'élément disparaissait et affirme : `module.contains(document.elementFromPoint(centre))` vrai, boîte dans l'écran, aucune intersection avec les autres ronds flottants. Preuve : Beluga, module de voix, contrôle scripts/verif-reglages-au-bout-de-la-rangee.mjs (branche tache/reglages-de-l-agent-a-abf60a).

## Pièges

- Monter le z-index à 9999 sans portail ne change rien : la valeur est comparée DANS le contexte de l'ancêtre.
- Un élément au-dessus de TOUT recouvre aussi menus et infobulles : rester sous leur rang.
- Changer l'origine d'un élément déplaçable dont la place est retenue en décalage : remettre ce décalage à zéro une fois, sinon l'ancienne place (relative à l'ancienne origine) l'envoie ailleurs.

## Ce qui ne marche pas

- Augmenter le z-index de l'élément seul (z-30 → z-56 sans portail) : toujours recouvert par une page de rang 40.
