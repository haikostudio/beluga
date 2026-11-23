---
name: code-ecrit-par-un-modele-joue-en-surete
description: À utiliser dès qu'une application doit AFFICHER ou RENDRE du HTML, du SVG, du CSS ou du JavaScript écrit par un modèle d'IA (visuel animé, widget généré, page de démonstration, gabarit de rendu vidéo) : « l'agent écrit le dessin et on l'affiche », « aperçu en direct d'un code généré », « le rendu doit être identique à l'aperçu », « des poignées pour retoucher le dessin à la main », ou devant « l'aperçu ne charge pas ses images », « les polices ne s'affichent pas dans le cadre », « deux rendus ne sont pas identiques », « les poignées sont minuscules », « le geste se perd au-dessus de l'aperçu », « Échap ne ferme plus la fenêtre ». Donne les trois verrous et les pièges d'un cadre isolé, y compris les gestes posés par-dessus.
etat: active
themes: securite, interface, navigateur, animation
symptomes: code généré qui pourrait lire la session, aperçu sans images dans un iframe sandbox, polices absentes dans un cadre isolé, export différent de l'aperçu, rendu différent d'une fois à l'autre, poignées de retouche invisibles dans un aperçu réduit, geste perdu au-dessus d'un iframe, Échap avalé par un iframe
---

# code-ecrit-par-un-modele-joue-en-surete

## Symptôme

Un modèle écrit du code visuel que l'application joue en direct puis exporte : sans précaution il peut lire la session, appeler le serveur ou sortir sur le réseau, deux rendus du même code ne se ressemblent pas, et les gestes de retouche posés sur l'aperçu se perdent.

## Cause

Le code d'un modèle n'est pas fiable par nature (erreur, consigne détournée, contenu injecté) et rarement déterministe (hasard, horloge, minuteurs) ; un iframe ordinaire partage l'origine et les témoins de l'application ; un iframe isolé, lui, garde pour lui les événements de pointeur et de clavier qui passent au-dessus de lui.

## Procédure

1. VERROU 1, À LA POSE : relire le fragment avec un petit analyseur et le RÉÉCRIRE depuis une liste FERMÉE de balises et d'attributs (refuser `script`, `iframe`, `object`, `link`, `meta`, `form`, tout `on*`, `javascript:`) ; n'accepter comme adresse que `#ancre`, une image `data:` ou un identifiant interne (`media:<id>`) remplacé au rendu. Le code d'animation va dans un champ à part, contrôlé par motifs : `fetch`, `XMLHttpRequest`, `WebSocket`, `import(`, `parent`/`top`, `eval`, `postMessage`, stockage, `Math.random`, `Date`, `performance.now`, minuteurs. Rendre chaque refus au modèle en une phrase qui dit quoi corriger. Contrôler la syntaxe sans exécuter (`new vm.Script('(function(){…})')`).
2. Appliquer ce nettoyage sur TOUS les chemins d'écriture (écran, agent, import d'une version), pas seulement dans l'outil de l'agent.
3. VERROU 2, L'APERÇU : `iframe sandbox="allow-scripts"` SANS `allow-same-origin`, contenu en `srcdoc`, politique de contenu en balise meta : `default-src 'none'; connect-src 'none'; script-src 'unsafe-inline' <origine>/<chemin public>; img-src/media-src data: blob: <origine>/<chemin signé>`. Parler au cadre par `postMessage` et n'écouter que `event.source === cadre.contentWindow`, avec une liste de types attendus.
4. Les fichiers du cadre : l'origine opaque n'envoie PAS le témoin de session → médias par adresses SIGNÉES (HMAC, expiration courte, limitées à un objet) servies avant le mur d'accès ; bibliothèques et polices publiques, polices avec `Access-Control-Allow-Origin: *` (une `@font-face` est une requête CORS).
5. VERROU 3, LE RENDU : la même page, dans un dossier qui ne contient qu'elle et des COPIES de ses fichiers, avec `connect-src 'none'` ; retirer de l'environnement du rendeur toute clé qu'un outil pourrait utiliser en douce.
6. DÉTERMINISME : une seule chronologie pilotée par le temps (GSAP en pause, `seek`), aucune animation CSS ni transition, polices EMBARQUÉES (fichiers servis aux deux), aucun hasard ; variations tirées d'une formule. Une vitesse ou un fondu d'un média s'écrit en ATTRIBUTS lus par les deux moteurs (aperçu et rendu), jamais posé à part dans l'un d'eux.
7. Retouches de l'utilisateur sur une pièce animée par GSAP : faire lire chaque pièce à GSAP AVANT d'activer les règles `translate/rotate/scale` (sinon il les absorbe et elles comptent double), et poser ces règles en `!important`.
8. LES POIGNÉES DE RETOUCHE SE DESSINENT DANS LA PAGE, PAS DANS LE CADRE : un aperçu en pixels réels réduit par `transform: scale()` réduit aussi ses poignées (34 px → 10). Le cadre envoie la boîte de la pièce choisie (ses pixels, et ce qu'elle est : texte, image) ; la page dessine cadre, coins, rotation et barre de boutons à la taille de l'écran, puis renvoie au cadre l'aperçu du geste en direct et enregistre la retouche au lâcher. Le déplacement peut rester un glisser dans le cadre (ses coordonnées sont déjà celles de la composition).
9. UN GESTE DE LA PAGE AU-DESSUS DU CADRE : couper `pointer-events` de l'iframe DÈS le `pointerdown` de la poignée (et le rendre au `pointerup`/`pointercancel` de la fenêtre) — `setPointerCapture` ne suffit pas, les mouvements qui passent au-dessus d'un cadre isolé y restent. Une fenêtre modale qui contient le cadre ne doit pas lui donner le focus à l'ouverture (`onOpenAutoFocus` empêché avec Radix), et le cadre fait remonter Échap par message.

## Vérification

Dans un vrai navigateur, évaluer DANS le cadre : `window.origin === 'null'`, `fetch('/api/…')` rejeté par la CSP, `window.parent.document` illisible, `document.cookie` refusé ; poser trois dessins piégés (`fetch(`, `<script src=https://…>`, `Math.random`) et constater trois refus sans rien enregistrer ; exporter et lire un pixel de l'image à l'endroit où une pièce a été déplacée à la souris. Pour les poignées : tirer la poignée de rotation EN TRAVERSANT l'aperçu, puis relire la donnée AVANT tout autre clic (un geste perdu ne part qu'au clic suivant). Prouvé sur le Studio de Beluga Build (`scripts/verif-studio.mjs`, 85/85 le 06/10/2026).

## Pièges

- `'self'` ne désigne rien dans la CSP d'un cadre à origine opaque : nommer l'origine et le chemin.
- Un calque plein cadre transparent (sous-titres, segment vide) intercepte les gestes : `pointer-events: none` sur les conteneurs, `auto` sur les pièces nommées.
- Les outils de rendu (HyperFrames `snapshot`) peuvent envoyer les images à un service d'IA si une clé traîne dans l'environnement.
- Un analyseur qui « nettoie » en silence apprend au modèle à recommencer : refuser avec la raison.
- Un `pointer-events: none` posé seulement une fois le glisser démarré arrive trop tard : le seuil de démarrage (quelques pixels) se franchit déjà au-dessus du cadre.
- Une fenêtre modale pose le focus sur le premier élément focalisable : un iframe en tête du corps le prend, et Échap n'atteint plus la fenêtre.

## Ce qui ne marche pas

Filtrer le HTML par expressions régulières sans le réécrire (les entités et les balises mal fermées passent). Compter sur le seul `sandbox` sans CSP (le cadre peut encore charger des images de pistage). Donner `allow-same-origin` « pour que les médias se chargent » : le cadre lit alors toute l'application. Dessiner les poignées dans le cadre réduit : elles deviennent invisibles. Compter sur `setPointerCapture` pour garder un geste au-dessus d'un iframe isolé.
