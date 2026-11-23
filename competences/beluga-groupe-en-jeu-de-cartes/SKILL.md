---
name: beluga-groupe-en-jeu-de-cartes
description: À utiliser dès qu'on touche à une carte mère et ses filles dans la liste des agents de Beluga (Tableaux de bord, page d'un projet) : cadre, bords de cartes dessous, chevron, dépliage animé, repli, fond dans les douze palettes, ou devant « le groupe ne s'affiche pas en paquet sur ordinateur », « les filles apparaissent d'un coup au premier clic », « le survol ne se voit pas dans le cadre ».
etat: active
themes: interface, cartes, animation
symptomes: le groupe reste une simple ligne sur ordinateur, les filles apparaissent d'un coup au premier dépliage, une carte rangée se clique encore, le survol d'une ligne est invisible dans le cadre
projets: Beluga
---

# beluga-groupe-en-jeu-de-cartes

## Cause

Une page Tableaux de bord sur ordinateur n'est pas `pleinePage` (seul le téléphone l'est) : la différence utile est `compacte`, la ligne de la colonne de gauche. Et les filles ne sont lues qu'au premier dépliage, donc une transition partirait d'un élément qui n'existe pas encore.

## Procédure

1. `LigneEtFilles` (web/src/components/liste-des-agents.tsx) : hors colonne (`!compacte`), le paquet ; dans la colonne, le chevron simple.
2. Trois pièces : `data-cadre-du-paquet` autour de la mère, `data-tranche-du-paquet` (une par fille, `TRANCHES_DU_PAQUET` = 3 au plus, chacune plus étroite et plus pâle), puis les filles (`data-fille-du-paquet`) dans une grille `grid-rows-[0fr]` vers `[1fr]`.
3. Premier dépliage : `setMontees(true)`, puis `setOuvert(true)` après deux `requestAnimationFrame`, pour que la transition ait un point de départ.
4. Cascade : 40 ms de décalage par fille, en ordre inverse au repli ; `motion-reduce` coupe tout. `invisible` sur la grille fermée retire les filles du clavier et du clic, à la fin de la transition.
5. Le fond : classe `.carte-du-paquet` (styles.css), la même marche mesurée que le bloc des sous-cartes (`--raised`/`--fond-zone` en sombre, voile 12 % en clair). Son survol monte d'une marche, sinon il ne se voit pas.
6. Preuve : carte « Retouches des services et navigation », commit faeec1a9.

## Vérification

`npm run build` puis `env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-retouches-services.mjs`, section 4 : trois bords pour quatre filles, chevron retourné, filles visibles, bords rangés, repli. Regarder `data/verification/services-paquet-ferme.png` et `services-paquet-ouvert.png`. Cette fiche ne remplace pas `beluga-pile-depliee-des-tableaux-de-bord`, qui parle de `PileDeCartes` de l'ancienne page.

## Pièges

- Tester `pleinePage` pour décider du paquet : il disparaît sur ordinateur.
- Jamais `--raised` seul pour le cadre : il ne fonce pas dans les palettes claires.
- Monter les filles d'office : `FillesDeLaMere` charge les cartes absentes, rien ne doit être lu tant que le paquet n'a jamais été ouvert.
