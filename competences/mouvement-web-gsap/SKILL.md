---
name: mouvement-web-gsap
description: À utiliser dès qu'un site doit BOUGER de façon soignée : « animations au défilement », « un bloc d'accueil épinglé », « texte qui se révèle en scrollant », « défilement fluide », ou pour créer de courtes animations synchronisées sur la voix d'une vidéo enregistrée. Impose GSAP côté site et décrit la chaîne transcription → animations HTML → MP4.
etat: active
themes: interface, animation, mouvement
symptomes: animations saccadées ou amateurs, effets de défilement à faire, section épinglée, animations à caler sur une vidéo, transcription mot à mot
---

# mouvement-web-gsap

## Symptôme

Les animations du site sont saccadées, écrites à la main en fragments de CSS, ou l'on veut des animations calées sur les paroles d'une vidéo sans savoir comment les produire.

## Cause

Sans bibliothèque d'animation dédiée, l'agent bricole des transitions CSS ; pour la vidéo, il manque un horodatage mot à mot.

## Procédure

1. Pour le mouvement d'un site : nommer GSAP (GreenSock Animation Platform, gsap.com), bibliothèque JavaScript rapide et fiable utilisée par de grandes agences ; galerie de niveau attendu : gsap.com/showcase. Invite : « Utilise GSAP pour tout le mouvement de ce site : sections pilotées par le défilement, textes qui se révèlent au défilement, bloc d'accueil épinglé, défilement fluide. Le niveau à atteindre est gsap.com/showcase. » GSAP est entièrement gratuit depuis 2025, extensions de défilement comprises (ScrollTrigger, ScrollSmoother), à revérifier sur la page officielle.
2. Respecter l'accessibilité : prévoir une version réduite du mouvement quand l'utilisateur a demandé moins d'animations (préférence système « réduire les animations »), et ne jamais cacher un contenu tant que l'animation n'a pas tourné.
3. Pour des animations de vidéo : (a) obtenir une transcription au niveau du MOT, gratuite, avec Whisper (github.com/openai/whisper, libre, tourne sur l'ordinateur) — demander des horodatages par mot, pas seulement par phrase ; (b) invite : « Voici la transcription mot à mot de ma vidéo. Trouve les cinq moments où une animation aiderait le spectateur, recherche les vrais chiffres pour chacun, puis construis une courte animation HTML par moment dans mon système de design, calée sur les horodatages, et exporte chacune en MP4 avec HyperFrames. Enregistre-les dans /animations. » (c) HyperFrames (github.com/heygen-com/hyperframes) transforme les animations HTML en MP4 prêtes à monter. Pour la chaîne complète d'une vidéo (script ou enregistrement → scènes → sous-titres → MP4, avec AssemblyAI ou Whisper) et ses règles de style, voir « video-animee-hyperframes-assemblyai ».
4. Utiliser le système de design du projet pour ne pas donner un air de design généré (voir « design-systeme-de-depart »). Pour les effets tout faits : « composants-ui-prets-a-l-emploi ». Pour la direction du mouvement dans un design haut de gamme : « gpt-taste » (règles GSAP strictes) et « high-end-visual-design ». Pour réutiliser des entrées animées et des fonds d'une vidéo à l'autre : « bibliotheque-d-elements-reutilisables ».

## Vérification

Ouvrir la page dans un navigateur, faire défiler : pas d'à-coup, le bloc épinglé se libère à la fin, les textes se révèlent au bon moment. Vérifier l'option système « réduire les animations » : le contenu reste lisible sans mouvement. Contrôle du code : GSAP est bien la seule source d'animation au défilement (pas de doublons CSS concurrents). Pour la vidéo : chaque fichier MP4 se lit, dure la bonne durée, et son apparition tombe sur le mot visé (comparer à l'horodatage).

## Pièges

- Empiler défilement fluide, épinglage et animations lourdes peut faire chuter la fluidité sur téléphone : mesurer.
- Des horodatages par phrase seulement font tomber l'animation à côté du mot.
- GSAP libre depuis 2025 : ne pas s'en servir de justification pour ignorer les termes de sa licence, à relire.
- HyperFrames et Whisper évoluent : revérifier l'installation dans leurs dépôts.
- Le guide date de septembre 2026.

## Ce qui ne marche pas

Écrire « ajoute de belles animations » sans nommer la bibliothèque ni la référence donne des transitions CSS banales. Animer chaque élément de la page en même temps fatigue le visiteur.
