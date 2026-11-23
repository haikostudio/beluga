---
name: vignette-de-premiere-page-d-un-pdf
description: À utiliser dès qu'une application web doit montrer un PDF en vignette (galerie, bande de pièces jointes, liste de documents) sans charger le document entier : « affiche l'aperçu de la première page », « la vignette du PDF est vide », « le serveur se fige sur un gros PDF », « l'image du PDF s'affiche cassée ».
etat: active
themes: pdf, images, serveur
symptomes: vignette de PDF cassée, PDF chargé en entier pour une vignette, serveur figé sur un PDF lourd, miniature refusée car plus lourde que l'original
---

# vignette-de-premiere-page-d-un-pdf

## Procédure

1. Rendre la première page côté serveur avec poppler : `pdftoppm -png -f 1 -l 1 -singlefile -scale-to-x <largeur> -scale-to-y -1 <source.pdf> <préfixe>` — il écrit `<préfixe>.png` (le préfixe est la cible SANS son extension).
2. Lancer l'outil en asynchrone avec un plafond de temps (`execFile(..., { timeout: 15000 })`), jamais `execSync` : un PDF lourd ou corrompu ne doit pas figer le serveur. Limiter le nombre de rendus simultanés (2).
3. Écrire dans un fichier provisoire puis le renommer, dans un cache disque dont la clé = empreinte(chemin | date de modification | taille | largeur) : un fichier modifié refait sa vignette, un fichier inchangé la relit.
4. Servir la vignette sous SON type (`image/png`), jamais sous le type de la pièce (`application/pdf`). Ne pas appliquer la règle « une miniature plus lourde que l'original ne sert à rien » quand le type change : un PDF de 2 Ko peut donner un PNG de 5 Ko, il faut quand même le servir.
5. Toute panne (outil absent, PDF illisible, délai dépassé) rend « pas de miniature » ; côté écran, la vignette qui échoue retombe sur une icône de document au lieu de disparaître.
6. Pour un test sans fichier binaire versionné : écrire un PDF d'une page à la main (catalogue, pages, page, flux de contenu « 0 0 1 rg 50 50 500 700 re f ») avec la table des renvois calculée à partir des positions en octets.

## Vérification

Test unitaire : un PDF écrit à la main → la miniature existe, commence par la signature PNG (octets 1 à 3 = « PNG »), est servie en `image/png`, la seconde demande reprend le cache, et un faux PDF (« pas un pdf ») rend « pas de miniature » sans bloquer. Dans le navigateur : `img.naturalWidth > 0` sur la vignette. Preuve : Beluga, carte « Aperçu des PDF et des liens » (commit 86bc6470, server/src/miniatures.ts).

## Pièges

- `-singlefile` est indispensable : sans lui, pdftoppm suffixe le nom par le numéro de page (`prefixe-1.png`) et la cible attendue n'existe jamais.
- Servir un PDF dans une balise `<img>` (miniature ratée → original servi) donne une image cassée : prévoir le repli d'icône côté écran.
- Dans un navigateur piloté, la touche Échap ne ferme pas une fenêtre qui affiche un PDF en `iframe` : le lecteur PDF garde le clavier ; fermer par le bouton.
- Sur iPhone, un PDF dans un `iframe` n'affiche que sa première page : prévoir une ouverture plein écran si le document doit se lire en entier.
