---
name: champ-de-saisie-dans-un-menu-radix
description: À utiliser dès qu'on pose une recherche ou un champ de saisie DANS un menu déroulant Radix (DropdownMenu, ses sous-menus), ou un bouton interne qui ne doit pas refermer le menu : « la recherche du menu ne prend pas les lettres », « taper dans le menu saute vers une ligne », « le menu se ferme quand je clique "Afficher plus" », « Échap ne ferme plus le menu », « Safari zoome quand je touche la recherche ». Pour une liste déroulante maison qui remplace un <select>, voir plutôt liste-deroulante-avec-recherche.
etat: active
themes: interface, formulaires, navigateur
symptomes: lettres tapées qui sautent vers une ligne du menu, champ qui perd la frappe, menu refermé par un bouton interne, Échap qui ne ferme plus le menu, zoom au focus sur iPhone
---

# champ-de-saisie-dans-un-menu-radix

## Symptôme

On tape dans la recherche posée en tête d'un menu Radix : les lettres n'arrivent pas dans le champ, le focus saute vers une ligne qui commence par cette lettre ; ou bien un bouton « Afficher plus » referme le menu au lieu de déplier la liste ; sur iPhone, toucher le champ fait zoomer la page.

## Cause

Un menu Radix écoute le clavier sur tout son contenu : chaque lettre déclenche sa recherche par frappe (typeahead) et déplace le focus vers une ligne, et une ligne (`DropdownMenuItem`) choisie referme le menu par défaut. Safari zoome au focus de tout champ dont la police fait moins de 16 px.

## Procédure

1. Sur l'`input`, `onKeyDown` : `e.stopPropagation()` pour toutes les touches SAUF Échap (fermer), flèches haut/bas et Tab (rejoindre les lignes). Entrée valide la saisie si besoin (`preventDefault`).
2. Un bouton interne qui ne choisit rien (« Afficher plus », « Annuler », un mode d'édition) est un `DropdownMenuItem` dont `onSelect` appelle `event.preventDefault()` : le menu reste ouvert et le clavier y accède.
3. Police de 16 px sur téléphone (`text-[16px] sm:text-[13px]`), sinon Safari zoome au focus.
4. La liste filtrée se calcule par une règle pure (recherche sans accents ni casse, sur toute la liste, l'élément retenu toujours visible même au-delà des N premiers) testée à part ; afficher « aucun résultat » quand la recherche ne rend rien.
5. N'afficher le champ que si la liste dépasse le nombre de lignes montrées d'abord.

Référence : Beluga, `ListeDesModeles` dans web/src/components/run-selectors.tsx (recherche `data-recherche-modeles`, bouton `data-afficher-plus-modeles`, message `data-aucun-modele`) et la règle pure `modelesAffiches` / `MODELES_AFFICHES_D_ABORD = 10` de shared/src/catalogue-modeles.ts (test catalogue-modeles).

## Vérification

Test unitaire de la règle de filtre (accents, casse, élément retenu visible au-delà des N premiers). Puis dans un vrai navigateur (Playwright, Chrome du système) : ouvrir le menu, `fill` puis taper au clavier dans la recherche → la liste filtre et le focus reste dans le champ ; cliquer « Afficher plus » → le menu reste ouvert et compte plus de lignes ; Échap ferme. Au gabarit téléphone, la police calculée du champ vaut 16px. Exemple : Beluga, scripts/verif-branche-et-modeles.mjs (menu des modèles).

## Pièges

- `stopPropagation` sur TOUTES les touches coupe Échap : le menu ne se ferme plus au clavier.
- Survoler les lignes à la souris leur donne le focus : la frappe suivante repart dans le typeahead tant qu'on n'a pas recliqué le champ — comportement admis.
- Filtrer seulement les N lignes affichées au lieu de toute la liste : un élément caché ne se trouve jamais.

## Ce qui ne marche pas

Champ de recherche sans `stopPropagation` : chaque lettre saute vers une ligne (constat de la carte « Branches et choix des modèles »). « Afficher plus » choisi sans `preventDefault()` dans `onSelect` : le menu se referme avant de déplier la liste.
