---
name: infobulles-rapides-pour-tous-les-title
description: À utiliser dès qu'une application web veut des infobulles maison partout (plus rapides que la bulle native, avec un fondu, au dessin du thème) sans réécrire des centaines d'attributs `title` un par un : « remplace toutes les tooltips », « la bulle d'aide met une seconde à venir », « les infobulles ne suivent pas le thème ». Dit comment reprendre tous les `title` par une seule couche déléguée, sans casser l'accessibilité ni les contrôles automatiques qui lisent `title`.
etat: active
themes: interface, navigateur, design
symptomes: bulle d'aide native trop lente, infobulles hors thème, centaines d'attributs title à remplacer, double bulle native et maison, contrôle automatique qui ne retrouve plus un title
---

# infobulles-rapides-pour-tous-les-title

## Symptôme

L'application porte des centaines d'attributs `title` ; la bulle native met près d'une seconde à venir, ignore le thème et ne s'anime pas. Les remplacer un par un par un composant d'infobulle est long, oublie des cas, et casse les contrôles qui lisent `title`.

## Cause

Rien ne permet de régler le délai ni l'aspect de la bulle native ; tant que l'attribut `title` reste sur l'élément survolé, le navigateur la montre en plus de toute bulle maison.

## Procédure

1. Monter UNE couche, une seule fois à la racine (pour chaque point d'entrée de l'application), qui écoute en délégation `pointerover`, `pointerout`, `pointerdown`, `keydown`, `scroll` (capture) et `blur`.
2. À l'entrée d'une souris (`pointerType === 'mouse'` : jamais au doigt) sur `closest('[title]')` : mettre l'attribut de côté (`data-…-titre`) et le retirer — la bulle native ne paraîtra jamais — puis, après ~120 ms (0 si une bulle vient de se fermer, pour lire une rangée d'icônes d'un geste), poser la bulle dans un portail `position: fixed`, `pointer-events: none`, `role="tooltip"`, au-dessus de l'élément (en dessous faute de place), centrée et tenue dans l'écran (mesure de la bulle dans un effet de mise en page).
3. À la sortie (sauf vers un descendant), à l'appui, au clavier ou au défilement : rendre l'attribut — sauf si le framework en a reposé un nouveau entre-temps, qui gagne — et faire sortir la bulle en fondu (opacité en transition, retrait après la transition).
4. Sous un navigateur PILOTÉ (`navigator.webdriver === true`), laisser l'attribut en place : la bulle native n'y est jamais dessinée, et les contrôles automatiques qui lisent `title` (ou le cherchent par sélecteur après un survol) le trouvent toujours. La bulle maison s'affiche quand même.
5. Le composant d'infobulle riche existant (Radix ou autre) prend le même délai, les mêmes classes et le même fondu de sortie : un seul dessin.
6. Garder `aria-label` sur les boutons-icônes : la bulle n'est qu'une aide visuelle.

## Vérification

Dans un vrai navigateur : survoler un bouton qui porte `title` → un élément `role="tooltip"` portant ce texte paraît en moins de 300 ms ; quitter le bouton → il s'efface en fondu et l'attribut `title` est de retour sur l'élément ; au doigt, rien ne paraît. Relancer les contrôles qui lisent `title` : ils passent sans modification.

## Pièges

- Retirer `title` pendant le survol casse un contrôle automatique qui le relit pendant que la souris est dessus : d'où l'exception du navigateur piloté.
- Charger la couche par un import statique dans le point d'entrée alourdit le premier envoi : la charger avec la boîte à outils d'interface que l'écran charge de toute façon.
- Un `title` posé sur un élément `svg` enfant (`<title>`) n'est pas un attribut : la couche ne le voit pas, c'est voulu.
- Une couche « menu » (popover, tooltip Radix) ouverte ou en train de se fermer devient la couche du dessus pour Échap : préférer pour la bulle un portail simple, sans gestion d'Échap.

## Ce qui ne marche pas

Remplacer les `title` à la main un par un : interminable, et chaque nouvel écran l'oublie. Masquer la bulle native par CSS : impossible, elle n'est pas dans la page. Vider `title` (chaîne vide) au lieu de le mettre de côté : la bulle disparaît mais le texte aussi, pour les contrôles comme pour les lecteurs d'écran.
