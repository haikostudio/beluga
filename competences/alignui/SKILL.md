---
name: alignui
description: À utiliser dès qu'une application React (souvent Next.js) avec Tailwind CSS veut un système de design complet et sobre, copié dans son propre code, avec ses jetons de couleur et de typographie (boutons, champs, fenêtres, étapes, notifications) : « installe AlignUI », « je veux le système de design AlignUI », « pars du modèle de départ AlignUI ». Dit ce qui est gratuit ou payant, comment poser les jetons, écrire les composants composés et éviter les pièges de version de Tailwind.
etat: active
themes: interface, composants, design, design-system
symptomes: système de design complet voulu en React, composants à copier dans le projet avec Radix et Tailwind, jetons de couleur et typographie à poser, maquette Figma AlignUI à reproduire, classes bg-bg ou text-text qui ne marchent pas
---

# alignui

## Symptôme

On veut une interface d'application sobre et cohérente (style produit SaaS) avec un vrai système de design — couleurs, typographie, ombres, rayons déjà réglés — et pas seulement des composants isolés ; ou l'on reçoit une maquette Figma faite avec AlignUI et il faut la reproduire fidèlement.

## Cause

AlignUI est un système de design dont le code se COPIE dans le projet (comme shadcn) : comportements par Radix UI, style par Tailwind CSS, variantes par tailwind-variants, en TypeScript. Les composants de base sont gratuits (dépôt de départ Next.js et outil en ligne de commande sous licence MIT) ; les blocs, les modèles par secteur et le fichier Figma complet sont PAYANTS (offre « Pro »). Les jetons sont nommés par rôle : `bg-white-0`, `bg-weak-50`, `bg-strong-950`, `text-strong-950`, `text-sub-600`, `stroke-soft-200`, `primary-base`… d'où des classes comme `bg-bg-weak-50` ou `text-text-strong-950`.

Quand la choisir : application React où l'on veut un système de design entier et cohérent, à posséder, ou une maquette AlignUI à suivre. Quand ne pas la choisir : besoin d'une documentation lisible par un agent et d'une installation composant par composant (préférer coss ui, mieux outillée) ; site sans React (préférer daisyUI) ; back-office très dense en tableaux (préférer Ant Design).

## Procédure

1. Deux départs possibles, à choisir selon le projet :
   a. Projet NEUF : partir du dépôt de départ officiel `alignui/alignui-nextjs-typescript-starter` sur GitHub (Next.js, tous les composants de base dans `components/ui`, utilitaires dans `utils`, police Inter, bascule sombre par next-themes). Attention : ce dépôt est en Tailwind CSS 3 (`tailwind.config.ts`).
   b. Projet EXISTANT en Tailwind 4 : `npx @alignui/cli tailwind`. L'outil demande la couleur principale (bleu, violet, orange, ciel), le neutre (gris, ardoise), le format de couleur (OKLCH conseillé) et un préfixe éventuel, puis écrit tous les jetons dans le CSS avec `@theme`. IL ÉCRASE le fichier CSS et la configuration Tailwind existants : enregistrer le projet (commit) avant, et relire le résultat.
2. Copier ensuite chaque composant voulu depuis sa page (https://www.alignui.com/docs/v1.2/ui/<nom>, ex. `button`, `input`, `modal`) ou depuis `components/ui` du dépôt de départ, avec les utilitaires dont il dépend (`utils/tv`, `utils/cn`, `utils/polymorphic`, `utils/recursive-clone-children`) et les paquets Radix listés (`@radix-ui/react-dialog`, `@radix-ui/react-slot`…), plus `@remixicon/react` pour les icônes.
3. Composer par pièces : chaque composant s'importe en entier (`import * as Button from '@/components/ui/button';`) et exporte une pièce RACINE et ses parties sous des noms courts (`Button.Icon`, `Modal.Trigger`, `Modal.Content`, `Modal.Header`, `Modal.Title`, `Modal.Body`, `Modal.Footer`) ; lire le bloc `export { … }` à la fin du fichier du composant pour leurs noms exacts, la racine comprise. La racine du bouton reçoit les variantes et contient `<Button.Icon as={RiAddLine} />` puis le libellé ; une fenêtre : racine > `Modal.Trigger` + `Modal.Content` > `Modal.Header` (`Modal.Title`), `Modal.Body`, `Modal.Footer`.
4. Variantes : `variant` (primary, neutral, error), `mode` (filled, stroke, lighter, ghost) et `size` (medium, small, xsmall, xxsmall) se combinent ; s'en tenir à ces valeurs plutôt que d'ajouter des classes de couleur.
5. Thème : les jetons vivent en variables CSS (le sélecteur racine du document pour le clair, `.dark` pour le sombre, ex. `--bg-white-0`, `--primary-base`) ; le sombre est activé par la classe `dark` (next-themes avec `attribute="class"`). Changer la marque = changer `--primary-*`, pas les composants.
6. Typographie : utiliser les classes de rôle (`text-title-h1`… `text-label-sm`, `text-paragraph-md`, `text-subheading-xs`) plutôt que des tailles libres ; elles portent taille, interlignage et graisse ensemble.
7. Pages de fondation à lire avant de styler : https://www.alignui.com/docs/v1.2/foundation/color et …/foundation/typography.

## Vérification

Le projet compile ; la page d'essai affiche un bouton principal et un champ AlignUI avec les couleurs des jetons (inspecter : `--primary-base` est défini). En ajoutant la classe `dark` sur `<html>`, le fond passe de `bg-white-0` clair à sombre et le texte reste lisible. Au clavier, le bouton et le champ montrent un anneau de focus visible ; la fenêtre se ferme par Échap et rend le focus au déclencheur. Aucune erreur d'import ni dans la console.

## Pièges

- Pas de fichier `llms.txt` ni de version texte des pages : la documentation est un site rendu par script. Lire le code du composant dans le dépôt de départ (`gh api repos/alignui/alignui-nextjs-typescript-starter/contents/components/ui/<nom>.tsx`) plutôt que de deviner son API.
- Tailwind 3 contre Tailwind 4 : le dépôt de départ est en v3 (`tailwind.config.ts`), l'outil en ligne de commande produit du v4 (`@theme`). Ne pas mélanger les deux configurations dans un même projet.
- Les classes à double préfixe (`bg-bg-weak-50`, `text-text-sub-600`, `ring-stroke-soft-200`) ne marchent que si les jetons sont déclarés : sans eux, rien ne s'affiche et aucune erreur ne prévient.
- Copier un composant sans ses utilitaires (`tv`, `polymorphic`, `recursive-clone-children`) : erreur d'import immédiate.
- Ce qui est marqué « PRO » (blocs, modèles, Figma complet) est payant : ne pas le reproduire depuis des captures, et vérifier la licence avant de réutiliser un bloc.
- Le focus est retiré sur certains composants (`focus:outline-none`) au profit d'un anneau propre : vérifier qu'il reste visible au clavier après retouche.

## Ce qui ne marche pas

Lancer l'outil en ligne de commande sur un projet non enregistré : la feuille de style et la configuration Tailwind sont écrasées sans retour possible.
