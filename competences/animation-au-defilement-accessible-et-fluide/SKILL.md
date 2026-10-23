---
name: animation-au-defilement-accessible-et-fluide
description: À utiliser AVANT de livrer toute animation liée au défilement (CSS pur, GSAP, Lenis, apparitions, parallaxe, épinglage) : « respecte les gens qui veulent moins d'animations », « prefers-reduced-motion », « ça rame sur téléphone », « 60 images par seconde », « le contenu reste invisible si le script plante », « nettoyage à la fermeture d'un écran ». Règles transversales d'accessibilité et de performance, valables quel que soit l'outil.
etat: active
themes: animation, interface, performance, accessibilite
symptomes: animation qui rend malade ou gêne un utilisateur sensible au mouvement, contenu caché pour toujours, saccades sur téléphone, écouteurs de défilement jamais retirés, animation qui consomme la batterie, lecteur d'écran qui épelle le texte animé
---

# animation-au-defilement-accessible-et-fluide

## Symptôme

Un site animé au défilement est beau sur l'ordinateur du créateur, mais saccade sur un téléphone moyen, gêne les utilisateurs sensibles au mouvement, et laisse du contenu invisible quand le script ne tourne pas.

## Cause

Les animations sont écrites pour l'effet, sans les trois garde-fous : préférence système de mouvement réduit, état par défaut visible, propriétés bon marché. Et les écouteurs créés par un écran ne sont jamais retirés à sa fermeture.

## Procédure

1. MOUVEMENT RÉDUIT, toujours. CSS : tout effet d'entrée dans `@media (prefers-reduced-motion: no-preference) { … }`, jamais l'inverse (sans la préférence, c'est la version calme qui s'applique). JavaScript : `const calme = matchMedia('(prefers-reduced-motion: reduce)').matches` ; avec GSAP, `gsap.matchMedia().add('(prefers-reduced-motion: no-preference)', () => { … })` : tout ce qui est créé dedans est annulé tout seul quand la condition change. En mouvement réduit : ni défilement doux, ni épinglage, ni parallaxe ; contenu affiché d'emblée, au plus un fondu très court. Garder un effet n'est permis que s'il est sans déplacement.
2. ÉTAT PAR DÉFAUT = VISIBLE. Le caché n'est posé que par le mécanisme qui sait le lever (voir « apparition-au-defilement-sans-cacher-le-ssr » et le `@supports` de « animation-au-defilement-en-css-pur-avec-repli »). Sans JavaScript, sans la feuille de style, ou si le script plante : tout se lit.
3. PROPRIÉTÉS BON MARCHÉ. Animer seulement `transform` et `opacity` (plus `filter` et `clip-path` avec parcimonie) : le navigateur les traite sans recalculer la mise en page. Jamais `top`, `left`, `width`, `height`, `margin`, `box-shadow` dans une animation continue. `will-change: transform` seulement sur l'élément qui bouge, et retiré quand l'animation est finie ; jamais sur la page entière.
4. BUDGET : moins de 16 ms par image (60 images/s). Mesurer dans DevTools (Performance, avec ralentissement CPU ×4 pour imiter un téléphone moyen). Limiter le nombre d'éléments animés en même temps (une dizaine), regrouper les mesures de mise en page (lire d'abord, écrire ensuite).
5. ÉCOUTEURS. Aucun `addEventListener('scroll')` sans `{ passive: true }` ; préférer `IntersectionObserver` pour « est-il visible ? » et l'animation CSS liée au défilement pour « où en est-il ? ». Un seul observateur pour la page, pas un par élément.
6. NETTOYAGE À LA FERMETURE D'UN ÉCRAN. Tout ce qu'un écran crée (déclencheurs GSAP, observateurs, Lenis, fonctions ajoutées au ticker, minuteurs) est retiré à son démontage : `ctx.revert()`, `observer.disconnect()`, `lenis.destroy()`. Revenir sur l'écran ne doit jamais doubler les effets.
7. LECTEUR D'ÉCRAN ET COPIE. Un texte découpé en lettres porte un `aria-label` complet et ses fragments `aria-hidden` ; le texte copié reste intact. Un effet ne doit jamais retarder l'accès à un bouton ou à un formulaire, ni déplacer un élément sous le doigt au moment de l'appui.
8. TÉLÉPHONE. Tester sur un vrai téléphone ou en émulation : barre d'adresse qui se replie, rebond de iOS, appui prolongé. Réduire ou retirer parallaxe et épinglage sous ~768 px si la mesure dépasse le budget.

## Vérification

Activer « réduire les animations » dans le système (ou l'émulation de DevTools) : la page est entièrement lisible, sans déplacement ni défilement doux. Désactiver JavaScript : tout le contenu est visible. Enregistrement Performance de 5 s de défilement, CPU ×4 : aucune image au-dessus de 16 ms, aucune « Layout » en rafale. Aller et revenir sur un écran dix fois : le nombre de déclencheurs et d'observateurs ne grandit pas. Un lecteur d'écran lit les titres animés en phrases entières.

## Pièges

- Traiter « réduire les animations » comme « aucune animation » : on garde les changements d'état utiles (focus, ouverture d'un menu), on retire les mouvements de grande amplitude.
- `will-change` partout : la mémoire du téléphone sature, c'est pire que sans.
- Mesurer sur la machine du développeur seulement.
- `scroll-behavior: smooth` ignore la préférence si on ne l'enveloppe pas aussi dans `no-preference`.
- Une animation infinie hors écran continue de consommer : la suspendre hors écran (`IntersectionObserver`).

## Ce qui ne marche pas

Ajouter une règle « prefers-reduced-motion » à la fin qui désactive tout avec `!important` : fragile et incomplète. Mesurer l'image par image sur ordinateur et déclarer que c'est fluide.
