---
name: icones-et-svg-coherents
description: À utiliser dès qu'un écran a besoin d'icônes, de logos, de schémas ou d'illustrations plates : « les icônes sont moches ou incohérentes », « dessine-moi un schéma », « ajoute une icône animée », ou qu'on doit RECOLORER une icône SVG depuis du CSS : « je change la couleur mais l'icône reste blanche », « l'icône au trait se remplit quand je la colore », « l'anneau pâle devient plein ». Fournit à l'agent un jeu d'icônes unique plutôt que de le laisser dessiner, demande du SVG propre, cadre l'usage des icônes animées (Lottie) et de leurs licences, et dit comment recolorer une icône au trait sans la remplir ni perdre ses nuances.
etat: active
themes: interface, design, icones
symptomes: icônes incohérentes, icônes dessinées par l'agent, image floue à l'agrandissement, besoin d'icône animée, schéma à éditer ou animer, couleur d'une icône SVG qui ne change pas, icône au trait remplie après recoloration, tracé pâle devenu opaque après recoloration
---

# icones-et-svg-coherents

## Symptôme

Les icônes générées par l'agent sont de styles mélangés ou maladroites ; une icône en image devient floue quand on l'agrandit ; on ne peut ni la recolorer ni l'animer. Ou bien l'icône est en SVG mais une couleur posée sur elle ne change rien, ou la remplit d'un bloc, ou rend opaque un tracé qui était volontairement pâle.

## Cause

Un agent dessine rarement de bonnes icônes de mémoire, et sans jeu de référence unique il change de style à chaque demande. Une image en pixels ne se recolore ni ne s'anime. Une icône SVG « au trait » porte sa couleur en ATTRIBUTS sur ses tracés (`stroke="#fff"`, `fill="none"`) : un attribut de présentation l'emporte sur ce que l'élément hérite de son parent, donc `color` ou `fill` posés sur le `<svg>` ne l'atteignent pas ; et un `fill` imposé à tout le dessin remplit les tracés ouverts qui comptaient sur `fill="none"`. Une nuance écrite dans la couleur (`rgba(255,255,255,.25)`) disparaît dès qu'une autre couleur la remplace.

## Procédure

1. Choisir UN jeu d'icônes dans UN style (trait fin, plein, duotone…) sur iconify.design (jeux gratuits) ou flaticon.com (télécharger un jeu entier demande en général un abonnement payant). Télécharger le jeu complet, le mettre dans un dossier du projet, puis : « Utilise ces icônes dans tout le design. N'en génère aucune toi-même. »
2. Pour tout ce qui doit être dessiné (icône manquante, schéma, illustration plate, logo simple) : exiger du SVG. « Fais les icônes et le schéma en SVG, pas en image. Garde des tracés propres pour que je puisse modifier les couleurs et les animer plus tard. » Le SVG s'agrandit sans flou, se recolore à la main et s'anime. Référence : developer.mozilla.org/en-US/docs/Web/SVG.
3. Ne PAS mettre du SVG partout : photos et illustrations détaillées restent en PNG, JPG ou WebP.
4. Icône animée : lordicon.com (plus de 9 700 icônes gratuites au moment du guide). Filtrer sur « Free », télécharger au format Lottie (JSON), la joindre à l'invite : « Place cette animation au-dessus du titre de la section et joue-la une fois au chargement. » Le format Lottie contient déjà l'animation.
5. Lire lordicon.com/licenses avant de livrer : la licence gratuite est fondée sur CC BY-ND 4.0 avec modifications, elle demande un compte gratuit et une ligne de crédit sur le site.
6. Pour des images produites par génération (visuels, illustrations riches) : voir « generer-medias-gemini » ; pour un annuaire d'icônes SVG gratuites, l'annuaire d'outils de « composants-ui-prets-a-l-emploi » en liste.
7. RECOLORER UNE ICÔNE SVG DEPUIS DU CSS (réglage d'interface, thème, éditeur) : viser ses FORMES, pas le `<svg>`.
   - Trait : `ICONE :is(path,circle,rect,line,polyline,polygon,ellipse) { stroke: C !important; stroke-width: E !important }` (l'icône comprise si elle est elle-même une forme) — `!important` l'emporte sur les attributs `stroke="…"`.
   - Remplissage : seulement les formes REMPLIES — `ICONE :is(…):not([fill="none"]):not([fill="none"] *)`, et sur l'icône elle-même `ICONE:not([fill="none"])` ; jamais un `fill` sur un `<svg fill="none">`, dont les tracés héritent.
   - Nuances : avant d'appliquer la couleur, ramener une couleur transparente de forme (`rgba(…, a)`) en couleur pleine + `stroke-opacity`/`fill-opacity` = a (multipliée par l'opacité déjà là), et poser `fill="none"` sur une forme que le CSS laisse sans remplissage. Rien ne change à l'œil ; une couleur posée ensuite garde l'opacité.
   - Montrer la vraie couleur : lire `getComputedStyle` du PREMIER TRACÉ visible (et de la première forme remplie), pas du `<svg>`, qui ne dessine rien.
   - Si l'aperçu et l'export (ou deux écrans) doivent rendre la même chose, ces déclarations sortent d'UNE seule fonction autonome, utilisée par les deux.

## Vérification

Ouvrir le dossier du projet : toutes les icônes viennent du jeu choisi (même épaisseur de trait, même grille) et aucune n'est un dessin improvisé de l'agent. Ouvrir un fichier SVG dans un éditeur de texte : chemins lisibles, couleur modifiable (attribut de remplissage ou couleur courante). Agrandir la page à 300 % : aucune icône floue. Si Lottie est utilisé : la ligne de crédit Lordicon est présente sur le site. Recoloration : dans un vrai navigateur, sur une icône au trait à deux tons (anneau `rgba(255,255,255,.25)` + arc `#fff`, `fill="none"`), poser une couleur et lire `getComputedStyle` de chaque tracé — `stroke` = la couleur posée, `stroke-opacity` de l'anneau = 0,25, `fill` = `none` partout (Beluga : `scripts/verif-studio-exports-et-reglages.mjs`, 18/18 au 08/10/2026).

## Pièges

- Un jeu Flaticon payant téléchargé sans abonnement ou hors licence est un risque juridique.
- Mélanger deux jeux d'icônes de styles différents casse la cohérence même si chacun est beau.
- SVG ne remplace pas une photo.
- Les chiffres (9 700 icônes, gratuit/payant) datent de septembre 2026 : revérifier sur la page officielle.
- La licence Lordicon gratuite impose un crédit visible ; l'oublier est un manquement.
- `color` ne recolore que les tracés écrits en `currentColor` : une icône aux couleurs en dur l'ignore.
- `:not([fill="none"] *)` vise aussi un parent marqué hors de l'icône : c'est voulu (le tracé en hérite), mais un `<g fill="none">` englobant toute la page masquerait tout remplissage.
- Une animation qui fait varier `stroke` en `rgba` après la normalisation se multiplie avec l'opacité posée : normaliser AVANT que l'animation ne tourne, et éviter d'animer la transparence par la couleur.

## Ce qui ne marche pas

Demander « ajoute des icônes modernes » laisse l'agent inventer les siennes. Demander une animation en GIF ou en vidéo alourdit la page sans permettre de recolorer. Poser `color` ou `fill` sur le `<svg>` d'une icône au trait : rien ne change (attributs des tracés), ou ses tracés ouverts se remplissent. Remplacer `stroke` partout sans normaliser les nuances : l'anneau pâle d'un chargeur devient aussi opaque que l'arc.
