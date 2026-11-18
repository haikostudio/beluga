---
name: heroui
description: À utiliser dès qu'une application React 19 avec Tailwind CSS 4 veut des composants soignés et accessibles livrés en paquet (boutons, fenêtres, formulaires, calendriers, tableaux, notifications) : « installe HeroUI », « je veux une interface belle par défaut sans tout dessiner », « passe de NextUI ou HeroUI v2 à la v3 ». Dit comment installer la version 3, gérer le thème sombre, écrire ses composants composés et éviter les réflexes de la v2.
etat: active
themes: interface, composants, design, design-system
symptomes: application React sans bibliothèque de composants, interface belle par défaut voulue, migration de NextUI ou HeroUI v2, onClick qui ne réagit pas sur un bouton HeroUI, styles HeroUI absents
---

# heroui

## Symptôme

On démarre une application React et on veut une interface propre tout de suite, avec des composants qui gèrent déjà clavier, focus et lecteurs d'écran ; ou un projet est encore sur NextUI / HeroUI v2 et les exemples récents ne marchent plus.

## Cause

HeroUI (anciennement NextUI) est une bibliothèque de composants React libre (licence Apache 2.0), réécrite en version 3 : Tailwind CSS 4 pour le style, React Aria (Adobe) pour le comportement accessible, et des composants COMPOSÉS par pièces (`Modal.Header`, `Modal.Body`…). Elle s'installe en paquet : on ne possède pas le code, on le met à jour. Elle existe aussi pour React Native.

Quand la choisir : application React 19 qui veut un rendu soigné d'office et des composants riches (calendriers, sélecteurs de date, listes à recherche, notifications) sans les écrire. Quand ne pas la choisir : projet en React 18 ou plus ancien (la v3 demande React 19) ; besoin de posséder et retoucher le code de chaque composant (préférer coss ui) ; site sans React (préférer daisyUI).

## Procédure

1. Prérequis : React 19 et Tailwind CSS 4 déjà en place (sinon installer Tailwind 4 d'abord avec son guide pour le framework du projet). Lire le fichier des dépendances et n'ajouter que ce qui manque.
2. Installer : `npm i @heroui/styles @heroui/react`.
3. Styles : dans le fichier CSS principal, dans CET ordre :
   ```css
   @import "tailwindcss";
   @import "@heroui/styles";
   ```
   Vérifier que ce fichier CSS est bien chargé par l'entrée de l'application. La v3 n'a PAS de fournisseur à poser autour de l'application.
4. Premier essai : `import { Button } from "@heroui/react";` puis `<Button onPress={…}>Envoyer</Button>`.
5. Événements : les composants suivent React Aria. Un bouton réagit à `onPress` (toucher, souris et clavier unifiés), les états s'écrivent `isDisabled`, `isPending`, `isRequired`, `isInvalid`.
6. Composer par pièces : une fenêtre s'écrit `Modal` > bouton déclencheur + `Modal.Backdrop` > `Modal.Container` > `Modal.Dialog` > `Modal.CloseTrigger`, `Modal.Header` (`Modal.Heading`), `Modal.Body`, `Modal.Footer` ; un bouton `slot="close"` ferme la fenêtre. Un champ s'écrit `TextField` > `Label` + `Input` + `Description` + `FieldError` : le libellé, l'aide et l'erreur sont reliés au champ d'office.
7. Thème clair/sombre : classe `dark` (ou `data-theme="dark"`) sur `<html>`, et `bg-background text-foreground` sur le corps pour que la page suive. Avec Next.js, `next-themes` (`attribute="class"`, `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`) dans un fournisseur client, et `suppressHydrationWarning` sur `<html>` pour éviter l'éclair au chargement.
8. Couleurs de marque : régler les variables du thème (outil « Theme Builder » du site officiel) plutôt que des classes de couleur dans chaque composant. Le thème par défaut est décrit dans https://heroui.com/react/DESIGN.md.
9. Documentation lisible par un agent : https://heroui.com/react/llms.txt ; chaque page s'obtient en texte brut en ajoutant `.mdx` à son adresse (ex. https://heroui.com/docs/react/components/modal.mdx). Un serveur MCP officiel (`@heroui/react-mcp`) donne l'API exacte à jour : le préférer à la mémoire pour les noms de pièces.
10. Migration depuis la v2 : suivre le guide « Migration (for AI assistants) » de la documentation, composant par composant.

## Vérification

Le projet compile ; la page d'essai affiche un `Button` et un `TextField` stylés (sinon : ordre des imports CSS ou fichier CSS non chargé). Le bouton réagit à la souris, au toucher et à Entrée/Espace. La fenêtre s'ouvre, piège le focus, se ferme par Échap et rend le focus au déclencheur. En basculant `dark` sur `<html>`, le fond et le texte changent sans éclair au rechargement. Aucune erreur dans la console.

## Pièges

- Réflexes de la v2 : plus de `HeroUIProvider` obligatoire, plus de plugin dans `tailwind.config.js`, plus de propriété `asChild` ; les composants plats (`ModalContent`, `ModalHeader`) deviennent des pièces composées (`Modal.Dialog`, `Modal.Header`). Un vieux tutoriel « NextUI » ne s'applique pas.
- `onClick` sur un bouton HeroUI : utiliser `onPress`, qui couvre aussi le toucher et le clavier.
- Ordre des imports CSS : `@heroui/styles` AVANT `tailwindcss` casse les styles.
- La v3 évolue vite (versions 3.x régulières, parfois avec des renommages, ex. `Text` devenu `Typography`) : lire les notes de version avant une mise à jour.
- Les dates passent par `@internationalized/date`, à installer à part pour le calendrier et les sélecteurs de date.
- Le rendu par défaut est reconnaissable : poser la palette et les rayons de la marque dès le départ.

## Ce qui ne marche pas

Mélanger HeroUI v2 et v3 dans le même projet, ou poser un composant d'une autre bibliothèque pour le même rôle (deux fenêtres, deux menus) : deux comportements de focus et deux styles se battent.
