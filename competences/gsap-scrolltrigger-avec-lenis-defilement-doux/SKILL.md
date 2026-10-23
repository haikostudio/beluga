---
name: gsap-scrolltrigger-avec-lenis-defilement-doux
description: À utiliser dès qu'un site doit avoir un défilement doux (Lenis) ET des animations GSAP ScrollTrigger (section épinglée, scrub, parallaxe, narration au défilement) : « défilement fluide comme les sites primés », « Lenis », « l'épinglage saute ou se décale avec le défilement doux », « ScrollTrigger ne suit plus », « ça saccade sur téléphone », « l'animation reste après avoir changé d'écran ». À lire avec « gsap-scrolltrigger » (importée, référence de l'API) : celle-ci ne dit que le branchement avec Lenis, le cycle de vie et les règles de sobriété.
etat: active
themes: animation, interface, mouvement, performance
symptomes: épinglage qui saute avec Lenis, ScrollTrigger en retard sur le défilement doux, deux boucles d'animation concurrentes, saccades sur téléphone, animation dupliquée après navigation, écouteurs jamais retirés, positions fausses après chargement d'images
---

# gsap-scrolltrigger-avec-lenis-defilement-doux

## Symptôme

Le défilement doux est installé à côté de GSAP sans être branché dessus : les positions de ScrollTrigger sont lues en retard, les sections épinglées tremblent, et les animations s'empilent à chaque changement d'écran.

## Cause

Lenis déplace la page avec sa propre boucle ; ScrollTrigger ne sait pas que la position a changé tant qu'on ne le lui dit pas. Et GSAP a sa propre horloge (`gsap.ticker`) qui lisse les à-coups, ce qui désynchronise Lenis. Enfin, rien ne détruit les déclencheurs quand l'écran se ferme.

## Procédure

1. INSTALLER : `npm i gsap lenis` (GSAP et ses extensions de défilement sont gratuits depuis 2025 — revérifier sur gsap.com). Enregistrer : `gsap.registerPlugin(ScrollTrigger)`.
2. BRANCHER LENIS SUR GSAP, une seule boucle, c'est LE point qui compte :
```js
const lenis = new Lenis({ autoRaf: false });
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add((temps) => lenis.raf(temps * 1000));
gsap.ticker.lagSmoothing(0);
```
Pas de `requestAnimationFrame` à soi à côté. `lagSmoothing(0)` empêche GSAP de « rattraper » un à-coup, ce qui fait sauter Lenis.
3. Poser ensuite les `ScrollTrigger` : `trigger`, `start`, `end`, `scrub: true` ou un nombre (secondes de rattrapage) pour une animation liée au défilement ; `pin: true` pour épingler ; `toggleActions` pour une animation jouée une fois. Détail de l'API : « gsap-scrolltrigger ». Pour les séquences : « gsap-timeline ».
4. REACT / NUXT / FRAMEWORK : créer dans `useGSAP` (React) ou `onMounted` (Vue/Nuxt, jamais au rendu serveur), et DÉTRUIRE à la fermeture : `ctx = gsap.context(() => { … }, racine)` puis `ctx.revert()` au démontage ; `lenis.destroy()` ; retirer la fonction du `gsap.ticker` (`gsap.ticker.remove(f)`). Voir « gsap-react ».
5. LIENS D'ANCRE ET HAUT DE PAGE : `lenis.scrollTo('#section')` au lieu de `scrollIntoView` ; `lenis.stop()` / `lenis.start()` quand un tiroir ou une fenêtre modale s'ouvre (sinon la page défile derrière) ; `data-lenis-prevent` sur une zone qui défile toute seule (liste, carte).
6. CALCUL DES POSITIONS : appeler `ScrollTrigger.refresh()` quand la hauteur de la page change après coup (images, polices, contenu chargé). Images avec dimensions fixées pour limiter ces recalculs.
7. SOBRIÉTÉ : pas de défilement doux sur les écrans de TRAVAIL (tableaux, formulaires, administration) — réservé aux vitrines et pages narratives ; pas d'épinglage empilé sur téléphone sans mesure ; `ScrollTrigger.matchMedia` / `gsap.matchMedia()` pour décliner ordinateur et téléphone, et pour la préférence « réduire les animations » (voir « animation-au-defilement-accessible-et-fluide »).
8. Quand le CSS suffit (apparition simple, barre de progression), ne pas charger GSAP : voir « animation-au-defilement-en-css-pur-avec-repli ».

## Vérification

Faire défiler à la molette et au doigt : le défilement est doux, une section épinglée ne tremble pas et se libère à la fin. Console : aucune erreur, un seul `requestAnimationFrame` actif (Performance de DevTools : pas de seconde boucle). Aller sur un autre écran puis revenir : les animations ne sont pas doublées (`ScrollTrigger.getAll().length` revient au même nombre). Avec « réduire les animations » activé : plus de défilement doux ni d'épinglage, contenu lisible. Redimensionner la fenêtre : les positions se recalculent.

## Pièges

- Oublier `lagSmoothing(0)` : saccades subtiles qui n'apparaissent que sous charge.
- Lancer GSAP au rendu serveur : `window is not defined` — tout dans le montage côté navigateur.
- Épingler dans un conteneur qui a `transform` ou `overflow: hidden` : l'épinglage casse ; poser l'épinglage sur un élément de premier niveau ou utiliser `pinType: 'transform'`.
- Les déclencheurs créés dans une boucle de rendu s'accumulent : un par rendu.
- `scroll-behavior: smooth` en CSS EN PLUS de Lenis : double adoucissement, défilement mou. Le retirer.
- Lenis sur iPhone avec la barre d'adresse qui se replie : prévoir `ScrollTrigger.config({ ignoreMobileResize: true })` pour éviter les recalculs en cascade.
- Le guide date d'octobre 2026 : revérifier les versions de lenis et gsap.

## Ce qui ne marche pas

Brancher Lenis avec sa propre boucle `requestAnimationFrame` et laisser GSAP tourner à côté. Mettre du défilement doux partout « pour faire premium » : les écrans de travail y perdent en précision. Animer chaque élément de la page : le visiteur se fatigue.
