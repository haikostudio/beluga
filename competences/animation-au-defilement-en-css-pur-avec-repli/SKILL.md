---
name: animation-au-defilement-en-css-pur-avec-repli
description: À utiliser dès qu'un site doit animer des éléments au rythme du défilement SANS bibliothèque (apparition d'un bloc quand il entre à l'écran, barre de progression de lecture, parallaxe légère, en-tête qui se réduit) : « animation liée au scroll en CSS », « animation-timeline », « scroll() et view() », « animation-range », « ça ne marche pas sur Firefox / vieux Safari », « le bloc reste invisible sans JavaScript ». À lire AVANT de choisir entre CSS pur et GSAP : le CSS suffit pour les effets simples, GSAP prend le relais pour l'épinglage, les séquences et le défilement doux.
etat: active
themes: animation, interface, navigateur, performance
symptomes: animation qui doit suivre le défilement sans JavaScript, effet absent sur Firefox ou ancien Safari, bloc caché tant que le script n'a pas tourné, barre de progression de lecture à faire, parallaxe qui saccade, doute entre CSS pur et GSAP
---

# animation-au-defilement-en-css-pur-avec-repli

## Symptôme

On veut des animations pilotées par le défilement, légères et fluides, et l'on ne sait pas si le CSS seul suffit, quels navigateurs le comprennent, ni quoi afficher quand il ne le comprend pas.

## Cause

Les animations CSS classiques tournent avec le temps, pas avec la position de défilement ; l'agent écrit alors un écouteur de défilement en JavaScript (lourd, saccadé) ou installe une bibliothèque pour un effet que le navigateur sait faire seul. À l'inverse, les propriétés récentes ne sont pas comprises partout : sans repli, le contenu reste figé ou caché.

## Procédure

1. CHOISIR. CSS pur pour : apparition d'un bloc à l'entrée dans l'écran, barre de progression de lecture, parallaxe douce, léger changement d'un en-tête. GSAP (voir « mouvement-web-gsap », « gsap-scrolltrigger » et « gsap-scrolltrigger-avec-lenis-defilement-doux ») pour : épinglage de section, séquence chronométrée, texte découpé, défilement doux, calage fin sur un élément qui change de taille.
2. DEUX LIGNES DE TEMPS. `animation-timeline: scroll()` suit le défilement d'un conteneur (par défaut le plus proche, `scroll(root)` pour la page) : barre de progression, parallaxe. `animation-timeline: view()` suit le passage de l'élément DANS la fenêtre : apparition, révélation. On pose toujours `animation-duration: auto` ou on laisse la durée à 1ms pour les anciens navigateurs, `animation-fill-mode: both`, `animation-timing-function: linear` pour le défilement lié (l'adoucissement vient de l'image-clé, pas du temps).
3. PLAGE. `animation-range: entry 0% entry 60%` (de l'entrée du bord à 60 % de l'entrée), `cover 0% cover 100%` (tout le passage), `exit 0% exit 100%` (sortie). Pour une apparition qui ne rejoue pas : plage `entry 0% entry 100%` et état final naturel dans les images-clés (`to`).
4. EXEMPLE DE BASE (apparition) : `@keyframes monter { from { opacity: 0; transform: translateY(24px) } to { opacity: 1; transform: none } }` puis `.revele { animation: monter linear both; animation-timeline: view(); animation-range: entry 0% entry 50% }`.
5. REPLI OBLIGATOIRE, dans cet ordre : (a) le contenu est lisible et visible SANS rien — l'état par défaut du CSS est l'état final ; (b) l'effet est enveloppé dans `@supports (animation-timeline: view()) { … }` : seuls les navigateurs capables le voient, les autres n'ont ni effet ni contenu caché ; (c) si l'on veut quand même un effet dans les autres navigateurs : une classe posée par un petit script d'`IntersectionObserver` (voir « apparition-au-defilement-sans-cacher-le-ssr »), activée seulement quand `CSS.supports('animation-timeline: view()')` est faux — jamais les deux mécanismes à la fois sur le même élément.
6. SOUS RÉSERVE DE LA PRÉFÉRENCE SYSTÈME : tout le bloc d'effets se pose dans `@media (prefers-reduced-motion: no-preference) { … }` (voir « animation-au-defilement-accessible-et-fluide »).
7. SUPPORT À REVÉRIFIER avant de promettre (caniuse.com, MDN « animation-timeline ») : Chrome et Edge 115+, Safari 18.4+, Firefox derrière un réglage (non activé par défaut au moment de ce guide). Prévoir que Firefox voie la page sans effet, c'est correct. Les déclencheurs de défilement (animation qui part à un seuil puis joue seule) arrivent dans Chrome 145 : ne pas s'en servir en production sans repli.
8. Une ligne de temps nommée pour animer un AUTRE élément que celui qui défile : `scroll-timeline: --page block` sur le conteneur, `animation-timeline: --page` sur la cible, et `timeline-scope: --page` sur un ancêtre commun.

## Vérification

Ouvrir la page dans Chrome récent : l'effet suit le défilement dans les deux sens, sans à-coup. Désactiver le support (DevTools : « Emulate CSS media feature prefers-reduced-motion: reduce », ou tester dans Firefox) : tout le contenu est visible et lisible, sans effet. Désactiver JavaScript : le contenu est toujours visible. `CSS.supports('animation-timeline: view()')` rend vrai dans Chrome 115+ et la règle est bien dans `@supports`. Aucun écouteur `scroll` en JavaScript pour un effet que le CSS fait seul.

## Pièges

- Un élément `opacity: 0` posé par défaut « parce que l'animation le révélera » reste invisible dans les navigateurs qui ne comprennent pas la propriété. L'état caché ne vit QUE dans `@supports`.
- `animation-timeline` doit venir APRÈS le raccourci `animation` : le raccourci le remet à zéro.
- `view()` sur un élément qui a `overflow: hidden` ou dont l'ancêtre défile mesure le mauvais conteneur : préciser `view(block)` ou nommer la ligne de temps.
- Une plage trop large (`cover`) sur un grand bloc donne un effet qu'on ne voit jamais fini.
- `transform` et `opacity` seulement dans les images-clés (voir la compétence de performance) : animer `height`, `top` ou `box-shadow` déclenche des recalculs de mise en page à chaque image.
- La barre de progression en `scroll(root)` ne se met pas à jour dans un cadre à défilement interne : viser le bon conteneur.
- Le guide date d'octobre 2026 : le support évolue vite.

## Ce qui ne marche pas

Écrire « ajoute des animations au scroll en CSS » sans repli : cela casse sur Firefox et masque du contenu. Mettre un écouteur `scroll` JavaScript pour une simple apparition. Doubler CSS pur et GSAP sur le même élément : les deux se battent.
