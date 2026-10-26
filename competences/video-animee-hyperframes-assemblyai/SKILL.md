---
name: video-animee-hyperframes-assemblyai
description: À utiliser dès qu'on veut transformer un texte ou un enregistrement en courte vidéo animée avec sous-titres calés sur la voix (réel, vidéo verticale 9:16, séquence de présentation) : « fais une vidéo à partir de ce script », « anime ce que je dis », « sous-titres mot à mot », « exporte en MP4 ». Décrit la chaîne HyperFrames (page web → MP4) + transcription horodatée au mot (AssemblyAI, ou Whisper sur le serveur), le premier essai de 10 secondes et le contrôle de lecture. Dans Beluga Build, le directeur artistique d'une carte caméra fait déjà toute cette chaîne sur le serveur (le Studio a été retiré le 26/10/2026).
etat: active
themes: video, animation, medias
symptomes: vidéo à produire à partir d'un script, sous-titres décalés de la voix, chiffres dits mais jamais affichés, vidéo qui ne se lit pas après export, animation à exporter en MP4, hyperframes snapshot qui appelle Gemini, rendu HyperFrames trop lent
---

# video-animee-hyperframes-assemblyai

## Symptôme

Il faut fabriquer une courte vidéo à partir d'un texte ou d'un enregistrement, et l'agent la produit au hasard : sous-titres qui arrivent à côté du mot, scènes qui traînent, MP4 jamais relu, aucun fichier source pour retoucher ensuite.

## Cause

Sans chaîne écrite, l'agent invente le déroulé à chaque fois ; sans horodatage par mot, les sous-titres se calent sur la phrase entière ; sans contrôle final, un fichier vide ou coupé passe pour un livrable.

## Procédure

Source : guide « Build your own /animate » (septembre 2026, auteur tiers, liens vérifiés le 24 septembre 2026), complété par la construction du Studio de Beluga Build (05/10/2026) puis par sa reprise chez le directeur artistique (26/10/2026).
0. DANS BELUGA BUILD : le directeur artistique d'une carte caméra fait déjà cette chaîne — type (vidéo, photo, son) puis l'un des dix styles illustrés ; pour les styles codés (motion, 3D, génératif, typographie, infographie, rétro, démonstration d'écran, et l'habillage du mixte), l'agent écrit la page et le serveur la contrôle, en tire les images clés (« production » action « esquisse ») et la rend (« realiser » action « composer » : preparer → controler → apercu → rendre), à 0 $. Voix d'essai gratuite (« voix_essai »), mots horodatés (« realiser » action « mots »), bruitages Tone.js (« sons »), deux vidéos validées en exemples (« production » action « exemples »). Voir « beluga-directeur-artistique-en-trois-arrets ». Ne refaire la chaîne à la main que hors Beluga.
1. Outils. HyperFrames transforme une page web (HTML) en MP4 : racine `data-composition-id` avec `data-width/height`, éléments `class="clip"` à `data-start` / `data-duration` / `data-track-index`, sons en `<audio class="clip" data-media-start data-volume>`, chronologie GSAP EN PAUSE posée sur `window.__timelines[<id>]`, variables par `--variables` (lues par `window.__hyperframes.getVariables()`) (hyperframes.heygen.com/introduction, github.com/heygen-com/hyperframes). Installer une version ÉPINGLÉE (0.8.134 vérifiée), jamais par `npx` à la volée. AssemblyAI transcrit un enregistrement au mot (clé d'API). Sans clé : Whisper sur le serveur (`faster-whisper`, `word_timestamps=True`, modèle `base` : 10 s de voix en ≈ 2 s).
2. Clé AssemblyAI : l'outil « coffre_fort », action « lister » (recherche « assemblyai »), AVANT toute question. Absente ? Le dire en toutes lettres (ce qui a été cherché, ce qui manque), continuer avec le script seul ou Whisper. Une clé reçue ou trouvée s'enregistre au coffre (une fiche par secret).
3. Chaîne, dans cet ordre : entrée (script ou enregistrement) → transcription mot à mot si enregistrement → plan des scènes (une scène par idée du texte) → visuels et sous-titres → aperçu → export MP4 → contrôle de lecture. Avec une voix de synthèse : fabriquer la voix, lire SA durée réelle, recaler les scènes sur elle, puis reconnaître les mots et n'en garder que les TEMPS, alignés sur le texte connu (la reconnaissance se trompe de mot).
4. Premier essai (invite du guide, à adapter) : « crée une compétence /animate qui transforme un script ou un enregistrement en courte vidéo avec HyperFrames et AssemblyAI ; lis les guides officiels des deux outils, dis-moi ce qui manque à installer ; teste-la avec une vidéo de 10 secondes en 9:16 sur ce script : [texte de 2 phrases] ; choisis toi-même visuels, typographie, couleurs, mises en page, transitions ; enregistre la source modifiable, le MP4, une affiche (image de couverture) et une courte note de ce que tu as utilisé. Fais une bonne première version, laisse les choix de style ouverts. » But : une compétence qui marche et une sortie à commenter, pas une belle vidéo.
5. Règles de style à donner ensuite, une phrase chacune avec sa raison : transition de 0,4 s, entrée et sortie nettes, avec flou de mouvement pendant le déplacement, puis arrêt net (les transitions lentes paraissent flottantes) ; deux mots de sous-titre au plus à l'écran, calés sur l'audio, mot courant en couleur d'accent (un spectateur sur téléphone lit d'un coup d'œil) ; chaque chiffre dit est affiché en décompte d'une demi-seconde, les chiffres approximatifs restent honnêtes ; une scène dure ce que sa ligne demande, six secondes au plus, aucun visuel réutilisé dans une même vidéo ; un objet 3D reste trois secondes au plus, puis cède la place à une infographie simple.
6. Commandes utiles : `hyperframes lint <dossier> --json`, `hyperframes validate <dossier> --json --no-contrast` (erreurs JavaScript et fichiers manquants dans un Chrome sans tête), `hyperframes snapshot <dossier> --at 1.2,3 --no-end --describe false -o <sortie>` (images clés + planche), `hyperframes render <dossier> -o out.mp4 --workers 1 -q standard --fps 30` (progression lisible ligne à ligne : « 56%  Streaming frame 50/90 »).
7. Améliorer la compétence en boucle : « affiner-une-competence-par-retours-en-regles ». Pièces réutilisables : « bibliotheque-d-elements-reutilisables ». Mouvement d'un site : « mouvement-web-gsap ». Images, voix, musique réelles : « generer-medias-gemini » en premier. Code d'un modèle joué dans une application : « code-ecrit-par-un-modele-joue-en-surete ». Une scène 3D : Three.js en module (`importmap` vers une copie locale), `preserveDrawingBuffer: true`, dessin dans l'`onUpdate` de la chronologie au temps `tl.time()`.

## Vérification

Le MP4 s'ouvre et se lit en entier (`ffprobe` : durée égale à la durée attendue à une demi-seconde près, image ET son présents). Pour une vidéo avec voix : le sous-titre d'un mot visé apparaît à l'horodatage de ce mot. Les livrables existent : source modifiable, MP4, affiche, note des choix. Mesuré le 05/10/2026 sur un serveur à 4 cœurs sans carte graphique : 3 s de vidéo 1080×1920 avec voix rendues en ≈ 15 s, 10 s en ≈ 35 s. Rejoué le 26/10/2026 par la chaîne du directeur : voix d'essai 4,35 s + mots en 5 s, contrôle 9 s, rendu 9:16 de 5 s en 19 s, livraison −16 LUFS en 2 s (image et son présents) ; scène Three.js 1:1 de 4 s rendue en 16 s.

## Pièges

- Horodatage par phrase seulement : l'animation tombe à côté du mot. Toujours demander le niveau du mot.
- Aucun secret dans la compétence, l'invite ou le dépôt.
- `hyperframes snapshot` envoie les images à Gemini pour les décrire DÈS QUE `GEMINI_API_KEY` est dans l'environnement : passer `--describe false` et retirer la clé de l'environnement du rendu. Couper la télémétrie (`DO_NOT_TRACK=1`). Les commandes `publish`, `cloud`, `lambda`, `cloudrun`, `auth`, `feedback` envoient le contenu au-dehors.
- Les gabarits d'HyperFrames chargent GSAP depuis un CDN : copier `gsap.min.js` dans le dossier du projet. Une politique de contenu `connect-src 'none'` dans la page n'empêche PAS le rendu (vérifié en 0.8.134) et coupe tout appel réseau du code.
- `lint` avertit « nested_structure_needs_subcomposition » dès qu'un clip contient des éléments : avertissement de présentation, sans effet sur le rendu.
- `validate` avertit quand un `<audio>` est plus court que son `data-duration` : le créneau est raccourci au son, sans casser le rendu.
- Sous 8 Go de mémoire, HyperFrames passe seul en mode « basse mémoire » (un seul Chrome, capture d'écran) : ne jamais lancer deux rendus en même temps sur une petite machine.
- GSAP absorbe les propriétés CSS `translate/rotate/scale` d'une pièce qu'il anime : un décalage posé en CSS compte double (voir MEM-4334).
- Un fond animé tiré au hasard change à chaque export : le piloter par une valeur de la chronologie.
- Le guide vient d'un tiers : versions et commandes évoluent, relire les pages officielles avant de s'appuyer sur un détail.

## Ce qui ne marche pas

Écrire « fais-moi une belle vidéo » sans fixer entrée, durée et livrables donne une vidéo unique non modifiable. Poser tout le style dès le premier essai empêche de voir ce que l'agent choisit seul. Animer avec des animations CSS ou des minuteurs : HyperFrames déplace la chronologie GSAP, le reste n'est pas rejoué à l'identique.
