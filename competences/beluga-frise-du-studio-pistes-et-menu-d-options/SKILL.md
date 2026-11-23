---
name: beluga-frise-du-studio-pistes-et-menu-d-options
description: À utiliser dès qu'on touche à la ligne de temps du Studio de Beluga : liste des pistes (œil, renommage, appui long), blocs (œil, masque, opacité, losange de trajet), menu d'options (double-clic, appui long, fermeture au glisser, « Régler l'arrivée »), TRAJET d'un bloc (« tu pars d'ici et tu arrives là », mode arrivée dans l'aperçu, coupe qui partage le trajet), haut de frise collant, retrait et remise du fond, aperçu en grand et menu du bas au téléphone, sens des transitions. Symptômes : « le menu s'ouvre au simple clic », « la règle part au défilement », « la règle et les pistes ne défilent plus ensemble », « le menu reste ouvert pendant un glisser », « l'opacité est ignorée pendant une transition », « la sortie part à l'opposé », « le fond reste », « sujet troué », « je veux animer la fin d'une vidéo d'un point à un autre », « le trajet de l'aperçu n'est pas celui du film ».
etat: active
themes: studio, montage, interface, tactile
symptomes: menu d'options au simple clic, règle qui part au défilement, règle désynchronisée des pistes, opacité ignorée pendant une transition, sortie à l'opposé du nom choisi, sujet troué par le retrait du fond, second détourage, déplacer un élément d'un point à un autre, trajet figé dans le film après la fin du fichier
projets: Beluga
---

# beluga-frise-du-studio-pistes-et-menu-d-options

## Symptôme

Un geste de la frise se contredit : menu qui gêne un glisser, règle qui disparaît, élément masqué encore exporté, opacité qui remonte à 1, fond retiré deux fois, trajet qui ne bouge pas comme prévu.

## Cause

La frise empile deux zones qui défilent (largeur dans `LigneDeTemps`, hauteur autour d'elle) et un seul mécanisme de glisser. La chronologie GSAP anime `opacity` sur la cible même des transitions. La retouche d'une pièce pose les propriétés CSS `translate`, `rotate` et `scale`, que le `transform` animé d'un trajet suit dans cet ordre.

## Procédure

1. La liste : `OeilDeLaPiste` vise toute la piste (haut-parleur pour un son). Double-clic sur le nom : champ en place, Entrée valide, Échap annule ; `piste-proprietes` {nom}, vide = automatique (`nomChoisi`). Téléphone : l'œil remplace la corbeille, l'appui long sur le nom ouvre Renommer, Devant, Derrière, Retirer.
2. Le bloc : simple clic = choisir et situer ; double-clic ou appui long = `BulleDeReglages`. `appuiLongPermis` de `usePointerDrag` écarte la souris et les poignées, sinon tenir sans bouger annulerait le glisser. Un bloc masqué reste estompé avec son œil visible ; un bloc en trajet porte un losange (`data-studio-losange-trajet`).
3. Le menu : corps sur `--surface`, en-tête et champs sur `--raised`, titre entier ; il se ferme à `onDeplacement` et à `onGlisser` du `FournisseurDePose`. `MenuActions` a `fermerSi` pour un menu de média.
4. Le haut collé : `data-studio-haut-de-frise` en sticky avec le fond `--fond-zone-defilement`, règle dans sa rangée (`defilRegle`) synchronisée dans les deux sens ; `sansVoileDebut` sur la zone verticale ; `dataset.margeDeBord` déplace la bande sensible du défilement au bord sous le haut collé.
5. Le rendu : `segment.masque` n'entre pas dans la page ; `segment.opacite` est en style et `visible()` l'impose aux recettes ; `versLaSortie()` inverse le décalage.
6. Le fond : `lancerLeGesteDuFond` répond aussitôt, l'issue arrive par l'événement `studio` (`fond`), lue dans `FournisseurDePose`. Le lien est dans `studio_fonds_retires` ; `tousLesMediasDeLaPiece` compte original et version sans fond pour une même pièce.
7. Téléphone : `apercuPlein` passe les deux rangées en `flex-1` sans démonter la frise ; les onglets vont dans la bande du bas par `GestePrincipal`, cachés quand `--clavier` > 0.
8. LE TRAJET (`trajet` {depart?, arrivee} sur vidéo, image et texte, `GENRES_A_TRAJET`, shared/src/studio.ts) : des décalages en pixels de l'ÉCRAN depuis la position posée. La chronologie (`CHRONOLOGIE`, studio-page.ts) l'anime en `x`/`y` sur `seg-<id>`, `power1.inOut`, sur toute la durée du bloc, ramené dans le repère de la pièce (rotation défaite, divisé par l'échelle de sa retouche). `recalerAncres` mesure un bloc en trajet sans son `transform`. `scinder` partage le trajet (`pointDuTrajet`).
9. Le mode arrivée : « Régler l'arrivée » du menu (`data-bulle-regler-arrivee`) appelle `reglerLArrivee` (studio.tsx), qui met la tête de lecture à la fin du bloc et envoie `{type:'arrivee'}` au cadre (renvoyé à chaque `pret`). Dans le cadre, `finir()` change le glisser de ce bloc en `arrivee-posee` {dx, dy} et remet la pièce à sa place ; la page ajoute le décalage à `trajet.arrivee` par « proprietes ». Bandeau `BandeauDArrivee` : « Retirer le trajet », « Terminé » ou Échap. Carte : montage-studio-pistes-et-menus.

## Vérification

`npm run build && env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-media-vers-piste.mjs` (77 contrôles, dont les sections 13 et 14 et l'opacité mesurée dans le film exporté) ; `env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-studio-voix-par-phrase.mjs` (sections 5 et 6 : mode arrivée tiré à la souris, trajet mesuré dans l'aperçu et dans le film exporté) ; `node --test server/dist/test/studio-fond-et-pistes.test.js server/dist/test/studio-decoupe-et-voix.test.js` ; `node scripts/verif-zone-en-cours-et-bulle.mjs`.

## Pièges

Un contrôle qui tire un média traverse le haut de la frise : sans la marge de bord, la zone défilait sous la main et la piste visée changeait. Un `aria-label` reste en français brut : le passer par le dictionnaire est refusé par le contrôle des langues. Dans `lire`, `fichier` d'un média reste l'original après le retrait du fond, seul `attachmentId` bascule. Le simple appui long au doigt se teste par des `PointerEvent` émis à la main : Playwright n'a pas de geste tenu. Un `transform` animé s'applique APRÈS les propriétés `rotate` et `scale` de la retouche : non compensé, un trajet sur une vidéo réduite à 0,74 n'avançait que des trois quarts. À L'EXPORT, une vidéo dont le bloc dépasse la fin de son fichier est figée ENTIÈREMENT par HyperFrames, position comprise : son trajet s'arrête là, alors que l'aperçu le poursuit. Pour un trajet sur une fin de vidéo, garder le bloc dans la durée du fichier.

## Ce qui ne marche pas

Un `sticky` à l'intérieur de la zone qui défile en largeur : il n'y colle à rien. Une opacité sur un enveloppant : une vidéo n'en a pas, et il fallait toucher export et aperçu ; laisser les recettes monter à 1 écrasait l'opacité pendant chaque transition. `chromakey` sur un fond blanc : tous les neutres du sujet partaient. Animer le trajet par la propriété `translate` : la retouche la pose en `!important`, l'animation ne passe pas.
