---
name: coss-ui
description: À utiliser dès qu'une application React avec Tailwind CSS 4 a besoin de composants d'interface accessibles qu'on possède dans son propre code (boutons, fenêtres, menus, formulaires, tableaux, fil de discussion) : « installe coss ui », « je veux des composants façon shadcn mais sur Base UI », « je pars de zéro, donne-moi une base de composants propre ». Dit comment l'installer, poser ses couleurs et ses polices, composer ses pièces et éviter les pièges de migration depuis Radix.
etat: active
themes: interface, composants, design, design-system
symptomes: projet React sans bibliothèque de composants, besoin de composants accessibles à copier dans le projet, migration de shadcn ou Radix vers Base UI, polices cassées après installation, couleurs succès avertissement info manquantes
---

# coss-ui

## Symptôme

On démarre une application React (Next.js, Vite) avec Tailwind CSS 4 et on n'a encore aucun composant : chaque bouton, chaque fenêtre et chaque formulaire est réinventé, avec une accessibilité au petit bonheur. Ou bien on utilise shadcn/ui et on veut passer sur Base UI, sa fondation plus récente.

## Cause

coss ui est une collection de composants libres (licence MIT) construite sur Base UI (comportements accessibles : clavier, focus, lecteurs d'écran) et habillée en Tailwind CSS 4. Elle suit le modèle « copier, coller, posséder » : le code de chaque composant entre dans le projet, il n'y a pas de paquet fermé à mettre à jour. Elle s'installe avec l'outil en ligne de commande de shadcn, ses jetons de couleur reprennent les mêmes noms que shadcn, plus quatre de plus (succès, avertissement, info, texte destructeur).

Quand la choisir : application React où l'on veut posséder et retoucher chaque composant, avec une base accessible moderne. Quand ne pas la choisir : site sans React (préférer daisyUI, qui n'est que du CSS) ; tableau de bord d'entreprise très dense où l'on veut tout prêt sans rien posséder (préférer Ant Design) ; projet déjà bâti sur une autre bibliothèque (une seule bibliothèque par projet).

## Procédure

1. Prérequis : un projet React avec Tailwind CSS 4 qui fonctionne déjà. Vérifier le fichier des dépendances avant tout ajout.
2. Projet neuf (recommandé) : `npx shadcn@latest init @coss/style`. Cela installe tous les composants, la palette neutre, les variables de la barre latérale, les styles de base et deux polices (Inter pour le texte et les titres, Geist Mono pour le code), branchées dans la mise en page principale.
3. Projet existant : `npx shadcn@latest add @coss/ui` ajoute tous les composants de base ; `npx shadcn@latest add @coss/style` ajoute en plus le thème complet ; `npx shadcn@latest add @coss/ui @coss/colors-neutral` n'ajoute que les jetons de couleur. Un seul composant : `npx shadcn@latest add @coss/button` (le nom du composant après `@coss/`).
4. Ajout à la main (sans l'outil) : installer `@base-ui/react`, copier le code du composant depuis l'onglet « Code » de sa page dans `components/ui/<nom>.tsx`, corriger les chemins d'import, et COPIER AUSSI les variables CSS que la page indique (par exemple `--destructive-foreground` en clair et en sombre). L'outil le fait seul ; à la main, on l'oublie souvent.
5. Thème : les couleurs vivent en variables CSS dans la feuille globale (le sélecteur racine du document pour le clair, `.dark` pour le sombre), mêmes noms que shadcn (`--background`, `--foreground`, `--primary`, `--border`…) plus `--destructive-foreground`, `--info`/`--info-foreground`, `--success`/`--success-foreground`, `--warning`/`--warning-foreground`. Changer la marque = changer ces variables, jamais les classes dans chaque composant.
6. Polices : les composants lisent `--font-sans` (texte, boutons, libellés), `--font-mono` (code, touches) et `--font-heading` (titres de fenêtres, qui retombe sur `--font-sans` par défaut). Avec next/font, donner `variable: "--font-sans"` à la police choisie.
7. Composer par pièces : une fenêtre s'écrit `Dialog` > `DialogTrigger` + `DialogPopup` > `DialogHeader` (`DialogTitle`, `DialogDescription`) + `DialogPanel` + `DialogFooter` (`DialogClose`). Chaque composant ré-exporte aussi la primitive Base UI qu'il enveloppe, pour une composition différente.
8. Documentation lisible par un agent : la liste complète est à https://coss.com/ui/llms.txt et chaque page de composant existe en texte brut en ajoutant `.md` à son adresse (ex. https://coss.com/ui/docs/components/dialog.md). La lire avant d'écrire un composant plutôt que de deviner son API.
9. Pour l'interface de discussion (bulles, saisie, états), la page « Chat UI » donne l'exemple complet et le partage des responsabilités entre composants et application.

## Vérification

Le projet compile sans erreur et la page d'essai affiche un bouton et une fenêtre coss ui avec les polices et couleurs du projet. Au clavier : Tab atteint le bouton, Entrée ouvre la fenêtre, le focus y entre, Échap la ferme et rend le focus au bouton. En thème sombre, les variables `.dark` s'appliquent (pas de texte noir sur fond sombre). Aucune erreur dans la console du navigateur.

## Pièges

- Polices cassées après installation : les modèles Next.js nomment leurs variables `--font-geist-sans`, alors que coss ui attend `--font-sans`. Aligner les noms.
- Base UI n'est pas Radix : la composition passe par une propriété `render` (et non `asChild`) et certains noms changent (`DialogPopup`, `DialogPanel` au lieu de `DialogContent`). Une migration depuis shadcn se fait avec le guide officiel de migration Radix/shadcn, composant par composant, jamais en renommant à l'aveugle.
- Ne pas mélanger dans un même projet des composants shadcn (Radix) et coss ui (Base UI) pour le même rôle : deux fenêtres, deux menus, deux comportements de focus.
- Le style livré est celui de son auteur : poser la palette et les polices du projet dès le départ, sinon toutes les applications se ressemblent.
- Ajout manuel : les jetons supplémentaires (succès, avertissement, info) manquent et les badges ou alertes sortent sans couleur.

## Ce qui ne marche pas

Écrire les composants « de mémoire » à la manière de shadcn : les noms de pièces et la propriété de composition diffèrent, le code ne compile pas ou perd l'accessibilité. Lire la page `.md` du composant avant.
