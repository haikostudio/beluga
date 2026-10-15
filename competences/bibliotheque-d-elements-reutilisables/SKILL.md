---
name: bibliotheque-d-elements-reutilisables
description: À utiliser dès qu'on produit des pièces qu'on réutilisera d'un projet ou d'une vidéo à l'autre (icônes, fonds animés, infographies, objets 3D, textes vedettes, mouvements d'entrée, mises en page, musique, effets sonores, prises de vue d'ambiance) : « je refais toujours la même chose », « où est passé ce composant ? », « construis-moi une bibliothèque d'éléments ». Donne les catégories, la méthode par petites séries et surtout le catalogue qui rend chaque pièce retrouvable.
etat: active
themes: medias, design, animation, methode
symptomes: on refait les mêmes pièces à chaque projet, un composant qu'on ne retrouve plus, pièces incohérentes entre elles, trente pièces toutes ratées de la même façon, licence d'un son inconnue
---

# bibliotheque-d-elements-reutilisables

## Symptôme

Chaque vidéo ou écran réinvente ses icônes, ses fonds, ses entrées animées. Les bonnes pièces existent quelque part dans un dossier, personne ne sait laquelle prendre.

## Cause

Des fichiers sans catalogue ne forment pas une bibliothèque, seulement un dossier : rien ne dit ce qu'est chaque pièce ni quand l'utiliser. Fabriquées en une fois, les pièces ont toutes le même défaut.

## Procédure

Source : guide « Build your own /animate » (septembre 2026, auteur tiers), pp. 6-7 ; chaque invite est un point de départ à adapter, entre crochets ce qu'on remplace.
1. Une catégorie à la fois, trois ou quatre pièces d'abord, mises côte à côte ; dire à l'agent quoi changer AVANT d'en faire trente (une bibliothèque faite d'un coup est fausse de la même façon trente fois).
2. Catégories et consigne clé de chacune :
   - Graphismes : image PNG à fond transparent d'un sujet, canevas carré, sujet centré, rien de coupé, vrai canal alpha, sans ombre portée ni texte ; trois variantes, dire laquelle tient le mieux en petit sur fond sombre.
   - Icônes : six icônes SVG en traits seulement (pas de couleur de remplissage), cadre 48 sur 48, même épaisseur de trait, lisibles à 24 pixels, une page d'index sur fond clair ET sombre (voir « icones-et-svg-coherents »).
   - Infographies : SVG simple, éléments révélés un par un dans l'ordre du script, chacun avec son identifiant pour le recaler, valeurs modifiables en tête de fichier.
   - Objets 3D : vraie géométrie (Three.js), matériau nommé (ex. aluminium brossé), livrer la source, un modèle GLB, un tour de 10 secondes en MP4 et un WebM transparent.
   - Fonds animés : discrets, pilotés par une valeur de la chronologie et JAMAIS par un tirage aléatoire (deux exports doivent être identiques), couleur et espacement en variables.
   - Texte vedette : chiffre en décompte d'une demi-seconde puis fixe, ou icône + titre entrant séparément ; portrait et paysage, durées en variables.
   - Mouvements d'entrée : six recettes nommées de 0,4 s (gauche, droite, montée, chute, échelle, fondu), nettes au départ et à l'arrivée, avec une page pour les rejouer.
   - Mises en page : maquette de navigateur, écran partagé présentateur + animation, grille de vidéos portrait ; espacement et arrondis en variables.
   - Musique : deux invites prêtes à coller dans un générateur (genre, instruments, tempo, ambiance, « instrumental sans voix »), intro courte, ce qu'il faut écouter au choix.
   - Effets sonores : seulement des sources à licence commerciale claire ; noter licence et lien pour chaque fichier, mesurer sa durée, page d'écoute avec « garder, peut-être, écarter ».
   - Prises de vue d'ambiance : clip sans texte, sans logo, sans visage, mouvement lent, si possible en boucle, aux couleurs de la marque ; deux prises, invite et réglages sauvegardés à côté du fichier. Les vrais médias se produisent d'abord avec « generer-medias-gemini ».
3. ENREGISTRER, l'étape qui fait la bibliothèque : chaque pièce gardée reçoit UNE entrée dans un catalogue (nom, catégorie, chemin du fichier, une ligne sur quand l'utiliser). Créer le catalogue s'il n'existe pas, y ajouter toute pièce nouvelle à l'avenir, puis construire une page d'index qui lit le catalogue et prévisualise chaque élément.
4. Faire adopter par l'agent : la compétence de production (vidéo, site) dit de chercher d'abord dans le catalogue avant de fabriquer. Composants d'interface tout faits : « composants-ui-prets-a-l-emploi » ; boucle d'amélioration : « affiner-une-competence-par-retours-en-regles » ; chaîne vidéo : « video-animee-hyperframes-assemblyai ».

## Vérification

Le catalogue existe et chaque pièce y a nom, catégorie, chemin, ligne « quand l'utiliser » ; chaque chemin ouvre un fichier réel ; la page d'index affiche toutes les pièces du catalogue, et une pièce ajoutée au catalogue y apparaît sans autre retouche. Pour un son : licence et lien notés. Pour un fond animé : deux exports du même instant sont identiques.

## Pièges

- Fabriquer trente pièces d'un coup : la même erreur trente fois.
- Un fond qui utilise un tirage aléatoire ne se rend pas deux fois pareil.
- Un effet sonore sans licence notée est inutilisable en projet client.
- Les invites viennent d'un guide tiers : les adapter au système de design du projet plutôt que de laisser l'agent choisir seul.

## Ce qui ne marche pas

Un dossier de pièces sans catalogue : l'agent en refait de nouvelles à chaque fois. Un catalogue tenu à la main sans page d'index se périme sans qu'on le voie.
