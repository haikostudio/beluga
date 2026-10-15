---
name: branches-d-arborescence-dans-une-liste
description: À utiliser dès qu'une liste web à lignes fixes (menu, tiroir, sélecteur) doit montrer des enfants sous leur parent avec des branches d'arborescence dessinées en CSS : « relie les sous-éléments à leur groupe par des traits », « la branche décale l'icône », « il y a un trou dans le trait entre deux lignes », « le trait dépasse sous le dernier ». Donne la règle de rangement, la géométrie des traits et la façon de la mesurer.
etat: active
themes: interface, design, tests
symptomes: une branche d'arborescence décale le contenu de la ligne, un trou apparaît dans le trait vertical entre deux lignes, le trait dépasse sous le dernier enfant, la recherche casse le rangement parent-enfant
---

# branches-d-arborescence-dans-une-liste

## Symptôme

Une liste à plat mélange des parents et leurs enfants ; on veut les enfants juste sous leur parent, en retrait, reliés par un trait vertical et un petit trait horizontal, avec un coude chez le dernier.

## Cause

Le rangement et le dessin sont deux problèmes distincts, souvent mêlés : le rangement dépend de l'ordre et du filtre de la liste, le dessin de mesures fixes (hauteur de ligne, écart entre lignes, position des icônes).

## Procédure

1. RANGER par une fonction pure, posée par-dessus l'ordre existant et APRÈS le filtre : elle rend, pour chaque ligne, `parentId`, `premier`, `dernier`. Le bloc parent + enfants prend la place de sa première ligne rencontrée ; un enfant dont le parent n'est pas dans la liste reste une ligne ordinaire. Elle n'ajoute ni ne retire de ligne.
2. DESSINER dans la ligne de l'enfant, rendue `position: relative` et de hauteur FIXE H : une enveloppe `position: absolute; inset: 0; pointer-events: none`, et dedans des traits absolus.
   - axe X = bord gauche de l'icône du parent + moitié de sa largeur ;
   - largeur du trait horizontal = bord gauche de l'icône de l'enfant − 2 px − axe ;
   - enfant du milieu : trait vertical de `top` à `bottom: 0` (bordure gauche), trait horizontal à `top: H/2 − 1` (bordure haute) ;
   - dernier enfant : un seul bloc, bordures gauche + basse, `border-bottom-left-radius: 5px`, de `top` à hauteur `H/2 − top` ;
   - `top` du premier = −(écart entre lignes + H/2 − demi-hauteur de l'icône) + 1,5 px (il s'arrête juste sous l'icône du parent) ; `top` des suivants = −écart (il couvre l'intervalle entre deux lignes).
3. MESURER dans un vrai navigateur plutôt qu'à l'œil : retrait exact entre l'icône du parent et celle de l'enfant, bord gauche du trait = milieu de l'icône du parent, bord droit à 2 px de l'icône de l'enfant, haut du trait de l'enfant suivant ≤ bas du trait du précédent (aucun trou), bas du trait du dernier = milieu de son icône.
4. Dans un `<select>` natif, pas de dessin : préfixer le libellé d'espaces INSÉCABLES (U+00A0) et de « └ » — les espaces ordinaires en tête d'un `<option>` sont avalés.

## Vérification

Un contrôle navigateur lit `getBoundingClientRect()` des icônes et des traits et vérifie : retrait attendu au pixel près, bord gauche du trait à moins de 0,6 px du milieu de l'icône du parent, bord droit à 2 px de l'icône de l'enfant, aucun trou vertical entre deux enfants, bas du trait du dernier au milieu de son icône, hauteur de toutes les lignes inchangée. La règle de rangement a son test pur : bloc à la place de sa première ligne, enfant sans parent affiché, aucune ligne perdue ni doublée.

## Pièges

- Dans une ligne en `display: flex` avec `gap`, une enveloppe de branche restée dans le flux compte comme un enfant de plus, même vide : elle ajoute un écart et décale l'icône. Mettre l'enveloppe elle-même en `absolute`.
- Une hauteur de ligne laissée à l'interligne du texte rend la géométrie fausse d'un navigateur ou d'une police à l'autre : la fixer.
- Si la largeur de l'icône du parent varie (pile de plusieurs icônes), l'axe varie : la passer en paramètre.
- Ranger AVANT le filtre donne des « premier / dernier » faux, donc un coude au mauvais endroit.
- Rappeler d'office le parent d'un enfant trouvé par la recherche change le nombre de lignes, et casse un raccourci du type « Entrée choisit la seule ligne ».
