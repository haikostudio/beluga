---
name: rangee-horizontale-epinglee-au-defilement
description: À utiliser dès qu'une rangée de cartes à faire défiler sur le côté passe inaperçue ou doit avancer toute seule pendant qu'on descend la page (section épinglée, « scroll horizontal piloté par le scroll vertical », sans bibliothèque) : « on ne voit pas qu'il y a d'autres cartes à droite », « fais défiler la rangée avec le défilement de la page », « ça marche sur ordinateur, active-le sur téléphone », « la carte est coupée en bas quand la section se fige », « le doigt ne fait plus glisser la rangée », « le glissement lent n'avance pas ».
etat: active
themes: interface, animation, mobile, navigateur
symptomes: rangée horizontale que personne ne fait défiler sur téléphone, carte rognée dans une section figée, glissement latéral du doigt sans effet sur une rangée épinglée, rangée qui traîne derrière le doigt, glissement lent qui n'avance pas, clic déclenché à la fin d'un glissement
---

# rangee-horizontale-epinglee-au-defilement

## Symptôme

Une rangée de cartes en défilement horizontal natif n'est pas vue comme telle sur téléphone : rien n'indique qu'elle se fait glisser, on n'en lit que la première carte. Ou bien la rangée épinglée existe sur grand écran et, une fois ouverte au téléphone, rogne ses cartes ou ne répond plus au doigt.

## Cause

Une section épinglée fige une scène d'un écran de haut en `overflow: hidden` : tout ce qui dépasse cette hauteur devient invisible, sans aucun moyen de l'atteindre. Et une piste déplacée par `transform` n'a plus de défilement horizontal natif : le geste latéral du doigt ne fait plus rien si on ne le reprend pas.

## Procédure

1. Structure : une ZONE (hauteur = hauteur de la scène + distance à parcourir, posée en JavaScript), une SCÈNE en `position: sticky; top: 0; height: 100svh; overflow: hidden`, une PISTE en `width: max-content` translatée par `translate3d`. Distance = largeur de la piste − largeur visible. Avancement = `−zone.getBoundingClientRect().top / distance`, borné de 0 à 1, appliqué dans un `requestAnimationFrame` sur l'événement `scroll` passif.
2. Rendu de départ : un défilement horizontal natif aimanté (`overflow-x: auto; scroll-snap-type: x mandatory`). L'épinglage ne s'active qu'après mesure, par un attribut posé sur la zone (`data-epingle="oui"`), et jamais sous `prefers-reduced-motion: reduce`. Sans JavaScript, la rangée reste utilisable.
3. Hauteurs en `svh`, pas en `vh` ni `dvh` : la barre d'adresse du téléphone ne fait alors ni sauter la scène ni changer la hauteur de la zone.
4. Garde « tient dans l'écran », à chaque mesure : (hauteur de la piste + barre de progression) ≤ (hauteur de la scène − ses marges internes), ET aucune carte avec `scrollHeight > clientHeight`. Si la garde échoue (téléphone couché, fenêtre basse), rester en défilement natif plutôt que rogner.
5. Cartes hautes (texte + illustration) : en mode épinglé, hauteur bornée à l'écran (`100svh −` la place de l'en-tête, des marges et de la barre), grille `auto / minmax(0, 1fr)` : le texte garde sa hauteur, l'illustration prend le reste et se rogne par le bas. Hors mode épinglé, la carte garde sa mise en page libre.
6. Doigt : `touch-action: pan-y pinch-zoom` sur la piste épinglée. Le navigateur garde le défilement vertical ; un geste qui part à l'horizontale arrive en `pointermove` (jamais de `pointercancel`). Convertir le déplacement horizontal en défilement vertical de la page, borné au début et à la fin de la zone.
7. Reporter l'arrondi : la page défile au pixel entier, donc garder le reste (cible − `scrollY` obtenu) pour le mouvement suivant, sinon un glissement lent (moins d'un pixel par événement) n'avance pas et un glissement normal dérive.
8. Si la page a `scroll-behavior: smooth`, demander `behavior: 'instant'` pour suivre le doigt, et `'smooth'` seulement pour l'élan au lâcher (vitesse lissée × une durée, borné à une largeur d'écran, ignoré si le doigt était arrêté depuis plus de 100 ms).
9. Annuler le clic qui suit un vrai glissement (écouteur `click` en capture, fenêtre de 350 ms) ; un appui simple doit toujours ouvrir la carte.
10. Montrer l'avancement (barre de progression pilotée par une variable CSS) : c'est elle qui dit qu'il y a une suite.

Voir aussi : « gsap-scrolltrigger-avec-lenis-defilement-doux » (épinglage GSAP avec défilement doux) et « animation-au-defilement-accessible-et-fluide » (en mouvement réduit, la rangée reste une rangée qu'on fait défiler au doigt, sans épinglage).

## Vérification

Dans un vrai navigateur en émulation tactile (Playwright, `hasTouch` et `isMobile`), aux tailles 360×640, 375×550, 393×852, 768×1024 et en paysage 852×393 : l'attribut d'épinglage vaut « oui » partout sauf en paysage et en mouvement réduit ; à mi-parcours la variable d'avancement vaut 0,5 ; à la fin la dernière carte touche la marge droite ; aucune carte n'a `scrollHeight > clientHeight` ; `document.documentElement.scrollWidth − innerWidth` vaut 0. Geste tactile réel par CDP (`Input.dispatchTouchEvent` : touchStart, touchMove répétés, touchEnd) : 150 px vers la gauche font descendre la page de 150 px exactement ; des gestes répétés s'arrêtent pile à la fin puis au début de la zone ; un geste vertical défile normalement ; un appui simple sur une carte-lien ouvre sa page, un glissement qui finit dessus ne l'ouvre pas. Sur ordinateur, hauteurs des sections identiques avant et après.

## Pièges

- Un essai à la souris ne prouve rien : `touch-action` et les événements de pointeur tactiles ne se voient qu'avec de vrais événements tactiles.
- En émulation mobile, `scrollY` est entier : c'est là qu'apparaît la dérive d'arrondi (6 px perdus ou gagnés sur 150).
- Les apparitions au défilement se posent sur chaque carte, jamais sur la piste : sa translation les décrocherait.
- La zone épinglée allonge la page : tout ce qui mesure la page (trait décoratif, ancres) doit se remesurer après la pose de la hauteur.
- Tester le texte le plus long (autres langues) et le plus petit écran réel : sur un petit iPhone, la hauteur visible tombe vers 550 px.

## Ce qui ne marche pas

Activer l'épinglage sur téléphone en retirant seulement la condition de largeur : les cartes plus hautes que l'écran sont rognées et le doigt ne fait plus glisser la rangée. Suivre le doigt avec le défilement doux de la page : la rangée traîne. Appliquer chaque déplacement sans reporter l'arrondi : un glissement lent reste sur place.
