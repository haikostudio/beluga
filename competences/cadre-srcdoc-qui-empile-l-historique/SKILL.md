---
name: cadre-srcdoc-qui-empile-l-historique
description: À utiliser dès qu'une application web affiche du contenu dans une iframe (corps de mail, aperçu HTML, document) dont le `srcdoc` ou le `src` change après l'affichage, et devant ces symptômes : « une fenêtre about:srcdoc s'ouvre au retour arrière », « le bouton retour ne ferme pas la vue du premier coup », « il faut appuyer deux fois sur retour », « l'app installée sur iPhone ouvre une page vide au retour ». À utiliser AUSSI avant de faire changer le contenu d'une iframe dans une app qui ferme ses vues par history.back().
etat: active
themes: iframe, navigation, pwa, ios
symptomes: fenêtre about:srcdoc au retour arrière, retour arrière qui ne ferme pas la vue, deux appuis sur retour nécessaires, page vide ouverte par l'app installée au retour
---

# cadre-srcdoc-qui-empile-l-historique

## Symptôme

Dans une app qui ferme ses vues par `history.back()` (routeur par hash, tiroir lié à l'historique), le retour reste sur la vue au premier appui, ou — app installée sur iPhone — une fenêtre « about:srcdoc » s'ouvre par-dessus l'app.

## Cause

Modifier l'attribut `srcdoc` (ou `src`) d'une iframe DÉJÀ chargée la fait naviguer : le navigateur ajoute une entrée à l'historique conjoint de la page. `history.back()` dépile alors l'entrée de l'iframe au lieu de celle de la page. Le premier chargement d'une iframe neuve n'ajoute rien. Causes typiques d'un second srcdoc : une option calculée dans un `useEffect` après montage (détection d'app installée), une traduction, l'affichage des images, un changement de thème. Mesuré en Chromium et WebKit : `history.length` +1 à chaque changement.

## Procédure

1. Repérer les iframes dont `src`/`srcDoc` dépend d'un état qui change après le montage.
2. En React : poser `key={srcDoc}` (ou une clé dérivée du contenu) sur l'iframe : un contenu nouveau REMONTE l'élément au lieu de le faire naviguer.
3. Calculer dès le premier rendu (initialiseur paresseux de `useState`) ce qui ne dépend que de l'environnement, pour éviter un second contenu inutile — seulement si le composant est rendu côté client (sinon décalage d'hydratation).
4. Le remontage refait la mesure de hauteur : garder une silhouette de chargement pour éviter un saut.

## Vérification

- Script Playwright (Chromium ET WebKit) : page avec hash `#/liste`, puis `#/vue`, iframe en srcdoc ; changer le contenu ; `history.length` ne doit pas augmenter, et `history.back()` doit ramener à `#/liste`. Avant correctif : +1 et le retour reste sur `#/vue`.
- Dans l'app : compter `history.length` avant et après l'ouverture d'un élément, puis fermer la vue : l'adresse revient à la liste.

## Pièges

- Invisible en onglet classique si le second contenu ne se produit qu'en app installée (option calculée après montage) : forcer le cas, ou tester le mécanisme seul.
- `history.replaceState` dans la page ne retire pas l'entrée de l'iframe.
- Une iframe sandboxée sans `allow-same-origin` ne peut pas être réécrite de l'intérieur : le remontage est la voie simple.

## Ce qui ne marche pas

- Changer `srcdoc` en place puis espérer que le retour « saute » l'iframe : il la dépile.
