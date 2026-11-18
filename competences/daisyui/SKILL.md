---
name: daisyui
description: À utiliser dès qu'un site ou une application en Tailwind CSS 4 a besoin de composants tout faits sans JavaScript ni framework imposé (HTML, React, Vue, Svelte, Laravel, Django…) : « installe daisyUI », « je veux des boutons, cartes et fenêtres jolis en quelques classes », « ajoute des thèmes clair et sombre ». Dit comment l'installer, choisir ou créer un thème, écrire ses composants avec les bonnes classes et éviter les pièges de la version 5.
etat: active
themes: interface, composants, design, design-system
symptomes: site Tailwind sans composants, interface à monter vite sans React, thèmes clair et sombre à ajouter, classes daisyUI qui ne s'appliquent pas, ancienne configuration tailwind.config.js
---

# daisyui

## Symptôme

On a un site ou une application en Tailwind CSS et chaque composant s'écrit en longues listes de classes utilitaires, différentes d'une page à l'autre ; ou on n'utilise pas React et les bibliothèques de composants React ne servent à rien.

## Cause

daisyUI (licence MIT, version 5 pour Tailwind CSS 4) est une extension de Tailwind qui ajoute des NOMS DE CLASSES de composants (`btn`, `card`, `modal`, `input`…), des couleurs sémantiques (`primary`, `base-100`, `error`…) et des thèmes. C'est du CSS seulement : il marche avec n'importe quel langage ou framework, sans JavaScript à charger.

Quand la choisir : débutant, site vitrine, prototype, projet sans React ou multi-framework, besoin de thèmes prêts. Quand ne pas la choisir : composants à comportement riche (listes à recherche, calendriers, tableaux triables) qu'on veut accessibles d'office — daisyUI ne fournit que l'apparence, le comportement reste à écrire ; préférer alors une bibliothèque React (HeroUI, coss ui, Ant Design).

## Procédure

1. Prérequis : Tailwind CSS 4. Le fichier `tailwind.config.js` n'existe plus en v4 : toute la configuration passe par le fichier CSS.
2. Installer : `npm i -D daisyui@latest`, puis dans le fichier CSS principal :
   ```css
   @import "tailwindcss";
   @plugin "daisyui";
   ```
   Sans outil de construction (essai rapide) : charger `https://cdn.jsdelivr.net/npm/daisyui@5` en feuille de style et `https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4` en script. Le site officiel a un guide par framework (Next.js, Vite, Astro, Laravel, Django, Rails…) : suivre celui du projet, chacun a son fichier CSS d'entrée.
3. Thèmes : par défaut `light` et `dark` sont actifs. Choisir : `@plugin "daisyui" { themes: light --default, dark --prefersdark; }` (`all` pour tous, `false` pour aucun). Appliquer par `data-theme="dark"` sur `<html>` ou sur n'importe quel bloc (les thèmes s'imbriquent).
4. Thème de marque : `@plugin "daisyui/theme" { name: "marque"; default: true; color-scheme: light; --color-primary: …; --color-primary-content: …; … }` en déclarant les couleurs de base (`base-100/200/300`, `base-content`), `primary`, `secondary`, `accent`, `neutral`, `info`, `success`, `warning`, `error`, chacune avec sa couleur `-content` lisible dessus, plus les rayons (`--radius-box`, `--radius-field`, `--radius-selector`). Pour retoucher un thème intégré, reprendre son nom et ne donner que ce qui change.
5. Écrire un composant : la classe du composant, puis ses parties, puis ses modificateurs. Ex. `<button class="btn btn-primary btn-sm">`, `<div class="card bg-base-100"><div class="card-body"><h2 class="card-title">…</h2><div class="card-actions">…</div></div></div>`. Sans demande précise, garder la variante par défaut (`btn` seul, pas `btn-primary` partout).
6. Fenêtre : utiliser l'élément `<dialog class="modal">` avec `<div class="modal-box">` et l'ouvrir par `showModal()` ; un `<form method="dialog" class="modal-backdrop">` ferme au clic dehors. Échap et le focus sont alors gérés par le navigateur.
7. Formulaires : `fieldset` + `fieldset-legend` + `label` + `input`/`select`/`textarea` avec leurs classes ; `validator` affiche l'erreur liée au champ.
8. Retouche : d'abord une classe Tailwind à côté (`btn px-10`) ; si la priorité CSS résiste, `!` en fin de classe (`bg-red-500!`), rarement. Retouche globale d'un composant : `@utility btn { @apply rounded-full; }`.
9. Référence lisible par un agent : https://daisyui.com/llms.txt liste tous les composants avec leurs classes ; la consulter plutôt que d'inventer un nom de classe.

## Vérification

La page d'essai affiche un `btn`, une `card` et une `modal` stylés ; en changeant `data-theme` de `light` à `dark` sur `<html>`, toutes les couleurs basculent sans texte illisible. La fenêtre s'ouvre, se ferme par Échap et par clic dehors, et rend le focus au bouton. Aucune classe inconnue (vérifier dans l'inspecteur que le style s'applique).

## Pièges

- Classes de la version 4 : plusieurs noms ont changé en v5 (ex. `form-control` et `label-text` remplacés par `fieldset`/`label`). Ne pas recopier un vieux tutoriel.
- Ajouter `tailwind.config.js` ou `require('daisyui')` : c'est la syntaxe Tailwind 3, ignorée en v4.
- Les couleurs brutes (`bg-blue-500`) ne suivent pas le thème : utiliser les couleurs sémantiques (`bg-primary`, `text-base-content/60`) pour que le sombre marche.
- Le variant `dark:` de Tailwind ne suit pas les thèmes daisyUI tout seul : le déclarer par `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));`.
- daisyUI dessine, il ne gère pas le comportement : menus déroulants, onglets et listes à choix restent à rendre accessibles au clavier.
- Le CDN n'inclut pas certains variants (`is-drawer-open:`) : préférer l'installation par paquet en production.

## Ce qui ne marche pas

Empiler des classes utilitaires pour refaire un composant qui existe déjà (`btn`, `badge`, `alert`) : on perd les thèmes et la cohérence. Utiliser la classe du composant puis retoucher.
