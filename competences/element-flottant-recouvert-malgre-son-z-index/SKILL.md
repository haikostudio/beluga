---
name: element-flottant-recouvert-malgre-son-z-index
description: À utiliser dès qu'un élément flottant d'une application web React (bouton rond, module vocal, bulle d'aide, lecteur, widget en position fixed, panneau de colonne déplié au survol) disparaît sous une page, un tiroir ou une discussion alors que son z-index est plus haut : « je l'active mais je ne le vois pas dans cette page », « il est caché sous la zone d'écriture », « le menu passe derrière le container principal », « monter le z-index ne change rien ».
etat: active
themes: css, interface
symptomes: élément fixed caché sous une page malgré un z-index élevé, monter le z-index ne change rien, widget visible sur l'accueil mais pas dans une discussion, panneau de colonne réduite survolé coupé au bord de sa bande
---

# element-flottant-recouvert-malgre-son-z-index

## Symptôme

Un élément en `position: fixed` ou `absolute` (module flottant, rond d'assistant, panneau d'une colonne réduite qui s'ouvre au survol) se voit sur certains écrans mais pas quand une page ou un tiroir est ouvert, même avec un z-index supérieur à celui de la page. Pour un panneau, seule la partie qui déborde de sa place réservée disparaît.

## Cause

Le z-index ne se compare qu'entre frères d'un même CONTEXTE D'EMPILEMENT. Un ancêtre avec `position: relative` + `z-index` (même 1), un `transform`, un `filter`, `opacity < 1`, `isolation: isolate` ou `will-change` crée un contexte : tout ce qu'il contient, fixed compris, est rangé au rang de cet ancêtre. Les pages et tiroirs, eux, sont souvent rendus en portail dans `body`, donc AU-DESSUS de ce contexte. Cas fréquent : la RACINE de l'application reçoit un `z-index: 1` pour passer devant un élément posé derrière elle (terminal, décor) — tout l'intérieur de l'app devient alors inférieur à n'importe quel portail.

## Procédure

1. Prouver l'empilement au lieu de deviner : dans le navigateur, `document.elementFromPoint(x, y)` sur un point de l'élément ; s'il rend un nœud de la page et pas de l'élément, il est recouvert.
2. Remonter ses ancêtres et lister ceux dont `getComputedStyle(e).zIndex !== 'auto'` ou qui ont transform/filter/opacity/isolation/contain/will-change : c'est le contexte qui l'enferme.
3. Choisir le remède selon l'élément :
   a. Si le rang de l'ancêtre n'est utile que dans UN état (ex. un volet visible derrière l'application), ne le poser que dans cet état : `html:has([data-volet]:not([data-reduit])) [data-racine] { z-index: 1 }`. Hors de cet état, plus de contexte, l'élément retrouve son rang réel. C'est le bon remède quand l'élément ne peut pas sortir de son parent (panneau qui doit rester sous le pointeur de son conteneur de survol).
   b. Sinon, rendre l'élément en portail : `createPortal(<…/>, document.body)` (React garde ses contextes à travers le portail).
4. Lui donner un rang dans l'échelle de l'application : au-dessus des pages et tiroirs, sous les menus et infobulles, et sous les fenêtres modales (le faire redescendre quand un voile modal est ouvert, ex. `[body:has([data-voile][data-state=open])_&]:z-40`).
5. Vérifier qu'il ne chevauche pas les autres éléments flottants du même coin : comparer les boîtes.

## Vérification

Contrôle navigateur (Playwright) qui ouvre l'écran où l'élément disparaissait et affirme : `element.contains(document.elementFromPoint(point))` vrai, aussi sur la barre d'en-tête si l'élément doit la couvrir ; puis, un faux voile modal ajouté au `body`, le voile est devant. Preuves Beluga : module de voix, scripts/verif-reglages-au-bout-de-la-rangee.mjs (branche tache/reglages-de-l-agent-a-abf60a) ; panneau de la colonne réduite survolée, scripts/verif-colonne-survolee-devant-les-pages.mjs (branche tache/menu-cache-derriere-la-846350, commit 2a428d43 : z-index de la racine posé seulement tant que le terminal est visible).

## Pièges

- Monter le z-index à 9999 sans toucher au contexte ne change rien : la valeur est comparée DANS le contexte de l'ancêtre.
- Un élément au-dessus de TOUT recouvre aussi menus, infobulles et fenêtres modales : rester sous leur rang.
- Retirer le rang d'une racine qui passait devant un élément posé derrière elle : garder ce rang tant que cet élément est visible (animation de fermeture comprise), sinon il remonte devant l'application.
- Un `transform` posé sur la racine (volet qui soulève l'app) recrée le contexte : dans cet état, le défaut revient ; c'est acceptable seulement si cet état est rare.
- Changer l'origine d'un élément déplaçable dont la place est retenue en décalage : remettre ce décalage à zéro une fois.

## Ce qui ne marche pas

- Augmenter le z-index de l'élément seul (z-30 → z-56, ou z-[55] pour un panneau) sans toucher au contexte : toujours recouvert par une page de rang 40 rendue en portail.
- Passer l'élément de derrière en z-index négatif pour libérer la racine : si `html` a son propre fond, celui de `body` n'est plus reporté sur le canevas et se peint PAR-DESSUS les éléments négatifs.
