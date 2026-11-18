---
name: menu-radix-relaye-ou-pose-par-dessus-son-bouton
description: À utiliser dès qu'un menu déroulant Radix (DropdownMenu) doit être ouvert par un AUTRE bouton que son déclencheur (bouton relais, raccourci, bouton recopié ailleurs), ou s'ouvrir PAR-DESSUS son bouton à sa largeur : « le bouton du bas ne fait rien », « clic relayé sans effet sur le menu », « le menu doit avoir la largeur du bouton », « le menu doit recouvrir le bouton au lieu de s'ouvrir dessous ».
etat: active
themes: interface, menus, radix
symptomes: bouton relais qui ne déclenche rien, menu Radix qui ne s'ouvre pas sur un click() synthétique, menu ancré à un bouton caché, menu plus étroit ou plus large que son bouton, menu qui s'ouvre sous le bouton au lieu de le recouvrir
---

# menu-radix-relaye-ou-pose-par-dessus-son-bouton

## Symptôme

Un bouton visible relaie le clic vers un déclencheur de menu caché (`element.click()`) : rien ne s'ouvre, aucune erreur. Ou bien on veut qu'un menu ait exactement la largeur de son bouton et s'ouvre par-dessus lui.

## Cause

`DropdownMenuTrigger` de Radix ouvre le menu sur `pointerdown` (bouton gauche) et au clavier, jamais sur un événement `click` — un `click()` synthétique est ignoré. Même ouvert par un faux `pointerdown`, le menu s'ancre sur son déclencheur (un bouton caché à 0×0) : DropdownMenu n'expose aucune ancre séparée.

## Procédure

1. Ne pas relayer : quand le geste d'origine est un menu (`aria-haspopup="menu"`), poser au lieu du relais un VRAI `DropdownMenu` dont le déclencheur est le bouton visible, avec les mêmes entrées (le relais doit disparaître quand ce bouton existe).
2. Menu au-dessus d'un bouton du bas : `side="top"`, `align="start"`.
3. Largeur du bouton : `w-[var(--radix-dropdown-menu-trigger-width)]` (Radix pose aussi `--radix-dropdown-menu-trigger-height`). Garder un `min-w` plus petit que le bouton.
4. Par-dessus le bouton : `sideOffset={0}` puis décaler le contenu selon son côté RÉEL : `relative data-[side=bottom]:top-[calc(-1*var(--radix-dropdown-menu-trigger-height))] data-[side=top]:top-[var(--radix-dropdown-menu-trigger-height)]`. Un menu retourné faute de place recouvre encore son bouton ; `avoidCollisions` reste actif.
5. Sur téléphone, si les menus deviennent des feuilles du bas, préfixer ces classes de la largeur ordinateur (`sm:`) ; pour une version réduite du bouton (icône seule), garder une largeur fixe lisible sans recouvrement.
6. Si le menu ouvre une fiche ou une page empilée, retenir `onCloseAutoFocus` (`preventDefault`) pour que le focus ne retourne pas à un bouton hors de la page.
Référence : Beluga, `CLASSE_MENU_PAR_DESSUS_DU_BOUTON` (web/src/components/ui/index.tsx) et le bouton du bas du coffre-fort (`data-coffre-creer-en-bas`, coffre-fort.tsx), commit 16629c0a.

## Vérification

Dans Chrome piloté (Playwright, channel chrome), cliquer le bouton visible puis mesurer `getBoundingClientRect()` du bouton et du contenu du menu : même `left` et même `width` (± 1 px) ; côté `data-side="bottom"`, `top` du menu = `top` du bouton ; côté `top`, `bottom` du menu = `bottom` du bouton (ou, pour un menu posé au-dessus, `bottom` du menu ≤ `top` du bouton). Choisir une entrée et vérifier que l'écran attendu s'ouvre réellement (un sélecteur propre à cet écran, pas un texte que le bouton porte aussi). Exemple : Beluga, carte 5459ad84 (menus de la colonne et coffre-fort, 1440 px clair et sombre, 390 px inchangé).

## Pièges

Un contrôle qui cherche le texte « Nouvel accès » pour prouver que la fiche s'est ouverte se trompe : le bouton porte le même texte. Un `sideOffset` négatif fixe casse dès que la hauteur du bouton change (téléphone/ordinateur) : passer par la variable de Radix. Un `transform` sur le contenu entre en conflit avec les animations d'ouverture : décaler par `top` relatif.

## Ce qui ne marche pas

Relayer par `noeud.click()` vers un `DropdownMenuTrigger` : rien ne s'ouvre. Envoyer un `pointerdown` synthétique au déclencheur caché : le menu s'ouvre, mais ancré au bouton caché, à l'autre bout de l'écran.
