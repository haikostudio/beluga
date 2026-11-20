---
name: menu-en-portail-avale-par-sa-ligne
description: À utiliser dès qu'une ligne de liste React ouvre un menu (Radix, shadcn, tout menu posé dans un portail) par clic droit ou appui long, et que les entrées de ce menu ne répondent pas au doigt, ou que toucher le menu le rouvre : « l'appui long ouvre le menu mais rien ne se passe quand je touche une entrée », « le menu se rouvre tout seul », « le clic sur l'entrée ouvre la ligne derrière ».
etat: active
themes: interface, react, menus, mobile
symptomes: entrée de menu sans effet au doigt après un appui long, menu qui se rouvre quand on le touche, clic dans le menu qui ouvre la ligne derrière
---

# menu-en-portail-avale-par-sa-ligne

## Symptôme

Sur téléphone, l'appui long sur une ligne ouvre bien le menu, mais toucher une de ses entrées ne fait rien (ou relance l'appui long) ; à la souris tout marche.

## Cause

Un menu posé dans un PORTAIL (`createPortal`, Radix `Portal`) est ailleurs dans le DOM, mais ses événements React REMONTENT l'arbre des composants jusqu'à la ligne qui l'a monté. Le `onClickCapture` qui avale le relâché de l'appui long (drapeau encore levé, car un appui long au doigt ne produit pas de clic) attrape alors le clic de l'entrée ; le `onPointerDown` de la ligne relance un appui long sur un toucher dans le menu.

## Procédure

1. Sur la ligne, ne traiter que ce qui la touche VRAIMENT dans le DOM : `const dansLaLigne = (e) => e.currentTarget.contains(e.target as Node)` ; sortir tôt de `onContextMenu`, `onPointerDown` (appui long) et `onClickCapture` si c'est faux.
2. Baisser le drapeau « appui long abouti » à la FERMETURE du menu (`onOpenChange(false)`), pas seulement au clic suivant.
3. Garder la garde du relâchement d'ouverture sur les entrées (`onPointerUp` : `preventDefault` dans les 500 ms) — voir la compétence clic-droit-radix-qui-choisit-une-ligne.

## Vérification

Playwright, contexte `isMobile` + `hasTouch` : appui long par CDP (`Input.dispatchTouchEvent` touchStart, 700 ms, touchEnd), puis `click()` sur une entrée : l'action part (fenêtre ouverte, repère attendu présent). Contre-épreuve sans le test `dansLaLigne` : l'entrée ne répond pas. Preuve : Beluga, carte « Archiver un projet sur le disque externe » (scripts/verif-archivage-projet.mjs, contrôle « Désarchiver ouvre la fenêtre » au téléphone).

## Pièges

À la souris le défaut ne se voit pas : le drapeau d'appui long n'est levé qu'au doigt. Une capture prise juste après le toucher montre la feuille du menu qui redescend par-dessus la fenêtre qui monte : attendre la fin des deux animations avant de conclure.
