---
name: element-flottant-recouvert-malgre-son-z-index
description: À utiliser dès qu'un élément flottant d'une application web React (bouton rond, module vocal, bulle d'aide, lecteur, widget en position fixed, panneau de colonne déplié au survol, volet d'assistant) disparaît sous une page, un tiroir, une fiche ou une discussion alors que son z-index est plus haut, ou qu'on ne peut plus y écrire quand une fenêtre modale est ouverte : « je l'active mais je ne le vois pas dans cette page », « il est caché sous la zone d'écriture », « un fond masque le chat », « le menu passe derrière le container principal », « monter le z-index ne change rien », « le champ perd le focus dès qu'une fenêtre est ouverte ».
etat: active
themes: css, interface
symptomes: élément fixed caché sous une page malgré un z-index élevé, monter le z-index ne change rien, widget visible sur l'accueil mais pas dans une discussion, panneau de colonne réduite survolé coupé au bord de sa bande, page ouverte après le widget passe devant lui, champ du widget qui perd le focus fenêtre modale ouverte, molette bloquée dans le widget
---

# element-flottant-recouvert-malgre-son-z-index

## Symptôme

Un élément en `position: fixed` ou `absolute` (module flottant, rond d'assistant, volet de conversation, panneau d'une colonne réduite qui s'ouvre au survol) se voit sur certains écrans mais pas quand une page, une fiche ou un tiroir est ouvert, même avec un z-index supérieur ou égal à celui de la page. Pour un panneau, seule la partie qui déborde de sa place réservée disparaît. Variante : l'élément est bien devant, mais une fenêtre modale ouverte dessous lui reprend le focus à chaque clic et bloque sa molette.

## Cause

Trois causes distinctes.
1. CONTEXTE D'EMPILEMENT : le z-index ne se compare qu'entre frères d'un même contexte. Un ancêtre avec `position` + `z-index`, `transform`, `filter`, `opacity < 1`, `isolation: isolate` ou `will-change` enferme tout ce qu'il contient, fixed compris, à son rang. Les pages et tiroirs rendus en portail dans `body` passent alors devant. Cas fréquent : la racine de l'application reçoit `z-index: 1`.
2. ÉTAGE ÉGAL OU INFÉRIEUR : à z-index égal, l'élément rendu le PLUS TARD dans le DOM passe devant ; une page ouverte après le widget, au même étage, le couvre. Une page « posée dans une autre » avec un étage plus haut (z-60) le couvre même s'il est monté.
3. FENÊTRE MODALE (Radix Dialog modal) : son piège à focus (`FocusScope trapped`, écouteurs focusin/focusout sur `document`) ramène le focus chez elle dès qu'il part ailleurs, et son verrou de défilement (`react-remove-scroll`, wheel/touchmove sur `document`) annule la molette hors d'elle ; `body` passe aussi en `pointer-events: none`.

## Procédure

1. Prouver l'empilement au lieu de deviner : `document.elementFromPoint(x, y)` sur un point de l'élément (centre, entête, champ) ; s'il rend un nœud de la page, il est recouvert. Relever aussi `getComputedStyle(el).zIndex` et celui de ce qui le couvre.
2. Remonter ses ancêtres et lister ceux dont `zIndex !== 'auto'` ou qui ont transform/filter/opacity/isolation/contain/will-change : c'est le contexte qui l'enferme.
3. Remède au contexte : a. si le rang de l'ancêtre n'est utile que dans UN état, ne le poser que dans cet état (`html:has([data-volet]:not([data-reduit])) [data-racine] { z-index: 1 }`) ; b. sinon, rendre l'élément en portail (`createPortal(…, document.body)`).
4. Remède à l'étage : écrire l'échelle de l'application (pages, pages empilées, pages posées dans un cadre, fenêtres, widget, menus, infobulles) et placer le widget EN PERMANENCE juste sous les menus — pas seulement dans un état (voix, action en cours). Si une famille de pages est au-dessus de lui, la redescendre juste sous lui plutôt que de monter le widget au-dessus des menus (ses propres menus passeraient dessous).
5. Remède à la fenêtre modale : marquer le widget (`data-au-dessus-de-tout`), le faire ignorer par les `onInteractOutside` / `onEscapeKeyDown` des fenêtres et pages, lui donner `pointer-events: auto`, et poser AU CHARGEMENT DU MODULE (donc avant toute fenêtre) des écouteurs sur `document` pour focusin, focusout (cible = `relatedTarget`), wheel, touchmove, touchstart qui font `stopImmediatePropagation()` quand l'événement naît dans le widget hors de tout `[role="dialog"]`. React (racine et `body`) a déjà reçu l'événement ; seuls les écouteurs de `document` posés plus tard (Radix) sont court-circuités.
6. Vérifier qu'il ne chevauche pas les autres éléments flottants du même coin.

## Vérification

Contrôle navigateur (Playwright) qui ouvre CHAQUE écran (pages, fiches, fenêtres, page posée dans un cadre) APRÈS le widget et affirme `widget.contains(document.elementFromPoint(point))` au centre, à l'entête et sur le champ ; qu'un clic dans le champ y garde le focus et que la frappe s'y écrit (fenêtre modale comprise) ; que la page dessous reste ouverte ; qu'un menu ouvert depuis le widget passe devant lui. Rejouer le contrôle SANS le garde-fou focus pour voir l'écran modal échouer. Preuves Beluga : scripts/verif-reglages-au-bout-de-la-rangee.mjs (abf60a), scripts/verif-colonne-survolee-devant-les-pages.mjs (846350, commit 2a428d43), scripts/verif-jarvis-devant-les-services.mjs (243b39, commit 1bdbcb85 : 52/52, 51/52 sans le garde-fou).

## Pièges

- Monter le z-index à 9999 sans toucher au contexte ne change rien.
- Un élément au-dessus de TOUT recouvre aussi les menus et infobulles : rester sous leur rang, y compris pour les menus qu'il ouvre lui-même.
- Retirer le rang d'une racine qui passait devant un élément posé derrière elle : garder ce rang tant que cet élément est visible.
- Un `transform` posé sur la racine recrée le contexte.
- Changer l'origine d'un élément déplaçable dont la place est retenue en décalage : remettre ce décalage à zéro une fois.
- Un widget monté « seulement en mode X » finit masqué hors de ce mode : l'étage se décide une fois, en permanence.
- Couper focusin sur un élément ANCÊTRE du champ (et pas sur `document`) casse les `onFocus` de React portés par `body`.
- Ne pas couper les événements d'un widget qui est lui-même une fenêtre Radix (feuille du bas) : la pile des pièges de Radix gère déjà l'imbrication.

## Ce qui ne marche pas

- Augmenter le z-index de l'élément seul sans toucher au contexte : toujours recouvert par une page rendue en portail.
- Passer l'élément de derrière en z-index négatif pour libérer la racine : le fond de `body` se peint par-dessus.
- Monter le widget au-dessus de la page la plus haute (z-61 face à z-60) quand les menus sont aussi à z-60 : ses menus passent dessous.
