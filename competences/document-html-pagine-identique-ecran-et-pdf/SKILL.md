---
name: document-html-pagine-identique-ecran-et-pdf
description: À utiliser dès qu'un document HTML doit se lire à l'écran « comme un PDF » (feuilles au format, miniatures, commentaires par page) ET s'imprimer en PDF avec exactement les mêmes pages : « les pages ne sont pas les mêmes à l'écran et dans le PDF », « le commentaire page 3 n'est pas page 3 du PDF », « afficher un document façon lecteur PDF sans pdf.js ».
etat: active
themes: pdf, impression, documents, interface
symptomes: pagination différente entre l'écran et le PDF, commentaire décalé d'une page, texte coupé en bas de feuille, image rognée pour tenir dans une page
---

# document-html-pagine-identique-ecran-et-pdf

## Symptôme

Le PDF imprimé par Chrome (pagination automatique, @page) ne coupe pas aux mêmes endroits que l'aperçu à l'écran : un repère posé « page 3 » à l'écran tombe ailleurs dans le PDF.

## Cause

La pagination d'impression de Chrome n'existe pas à l'écran : deux moteurs de mise en pages, deux résultats.

## Procédure

1. Rendre une SOURCE : des feuilles déjà à leur taille (couverture, diapositive : `.fixe`) et des sections qui coulent ; tout le CSS rangé sous un conteneur (`.pages`, `.feuille`) pour pouvoir le poser dans n'importe quelle page (ou une ombre DOM).
2. Paginer dans le navigateur, une seule fonction : créer des feuilles de taille fixe (mm) avec une zone utile ; y ajouter chaque section ; si la dernière déborde (comparer `getBoundingClientRect().bottom` à celui de la zone), couper entre ses enfants (récursif), un paragraphe au mot (recherche dichotomique sur les blancs, garder le blanc retiré pour recoller), une image très haute en tranches (`overflow:hidden` + `margin-top` négatif) ; une section dont rien d'utile ne tient (au plus son titre) passe entière à la feuille suivante ; une section insécable aussi.
3. Attendre le chargement des images avant de paginer.
4. Écran : appliquer le zoom APRÈS la pagination. PDF : jouer la même fonction par `page.evaluate(String(fn))`, puis `page.pdf` avec `@page { margin: 0 }` et `break-after: page` sur chaque feuille.
5. La fonction doit être AUTONOME (aucun import, aucune variable de module) pour être recopiée par `String(fn)` dans une page légère ou dans `evaluate`.

## Vérification

Ouvrir le document à l'écran et le PDF : même nombre de pages (compter les feuilles et les `/Type /Page` du PDF), aucune zone dont le dernier enfant dépasse le bas, aucune image en `object-fit: cover` hors zoom voulu. Exemple de contrôle : `scripts/verif-plaquette.mjs` de Beluga.

## Pièges

- Une fonction recopiée en texte qui appelle un utilitaire voisin marche dans l'application (import) et casse dans la page légère et le PDF.
- Mesurer avant le chargement des images : tout tient sur une feuille.
- Une regex contenant U+2028/2029 littéraux casse TypeScript : les écrire échappés.

## Ce qui ne marche pas

- Laisser Chrome paginer le PDF et imiter à l'écran avec une seule longue feuille : les coupes ne correspondent jamais.
- Afficher des images du PDF : texte non sélectionnable et retouches visibles seulement après la fabrication du PDF.
