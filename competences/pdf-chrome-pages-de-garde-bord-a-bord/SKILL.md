---
name: pdf-chrome-pages-de-garde-bord-a-bord
description: À utiliser dès qu'un PDF fabriqué par Chrome (Playwright, Puppeteer, page.pdf) doit mêler des pages à marges, avec en-tête et pied numérotés, et des pages pleines sans marge ni pied (page de garde, intercalaire, couverture couleur, pleine page illustrée) : « la page de garde doit toucher les bords », « le pied s'imprime aussi sur la page de garde », « headerTemplate sur toutes les pages », « le sommaire perd ses numéros de page », « bande blanche / liseré blanc au bord d'une pleine page », « le PDF pèse 13 Mo depuis qu'on a mis des illustrations ».
etat: active
themes: pdf, impression, css, documents
symptomes: le pied de page paraît sur une page de garde, une page pleine garde des marges blanches, le logo de l'en-tête manque, un repère de page caché disparaît du texte du PDF, un pixel blanc au bord d'une page pleine dans un rendu basse définition, liseré blanc sur un bord d'une couverture imprimée à part, PDF très lourd avec des images à fond transparent, une image masquée imprimée deux fois
---

# pdf-chrome-pages-de-garde-bord-a-bord

## Procédure

1. ABANDONNER `displayHeaderFooter` / `headerTemplate` / `footerTemplate` : ils s'impriment sur TOUTES les pages, sans exception possible. Les remplacer par les BOÎTES DE MARGE CSS (Chrome ≥ 131) dans `@page` : `@page { size: A4; margin: 20mm 16mm 18mm 16mm; @top-left { content: url("<image>"); } @top-right { content: "Confidentiel"; } @bottom-left { content: "<libellé>"; } @bottom-right { content: counter(page) " / " counter(pages); } }`.
2. Imprimer avec `page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true })` — sans option `margin` : ce sont les marges CSS qui comptent.
3. PAGE PLEINE : une PAGE NOMMÉE. `.garde { page: garde; width: 210mm; height: 297mm; break-before: page; break-after: page; }` et `@page garde { margin: 0; @top-left { content: none; } @top-right { content: none; } @bottom-left { content: none; } @bottom-right { content: none; } }`. Chrome coupe la page tout seul quand la valeur `page` change. Le compteur `counter(page)` compte les pages pleines aussi : sommaire et pied restent d'accord.
4. LOGO DANS UNE BOÎTE DE MARGE : `background` et `mask` n'y marchent pas ; passer l'image en `content: url(...)`. Pour la RECOLORER (logo blanc sur fond blanc), l'envelopper dans un SVG en data URL avec largeur et hauteur fixées et un filtre : `<svg width="57" height="20.6" viewBox="0 0 W H"><filter id="f" x="0" y="0" width="1" height="1"><feFlood flood-color="#7E00FD"/><feComposite in2="SourceAlpha" operator="in"/></filter><image href="data:image/png;base64,…" width="W" height="H" filter="url(#f)"/></svg>`.
5. Un texte libre dans `content:` doit être une chaîne CSS échappée (antislash, guillemets, retours à la ligne).
6. REPÈRES DE PAGINATION (texte minuscule transparent lu par `pdftotext` pour remplir un sommaire en deux passages) : sur une page sans marge, ne pas le poser à l'angle (0,0) de la page — il sort de la page imprimée et disparaît du texte. Le poser DANS le bloc de contenu de la page pleine.
7. COUVERTURE IMPRIMÉE À PART (marge 0, puis `pdfunite`) : poser la couleur de fond sur `html` ET `body` à `width: 210mm; height: 297mm; overflow: hidden`, en plus du bloc de couverture, et imprimer avec `preferCSSPageSize: true` et `@page { size: A4; margin: 0 }`. Sans cela, un arrondi mm → px laisse un liseré blanc sur un bord.
8. ILLUSTRATION PLEINE PAGE : `<img>` en `position: absolute; inset: 0; width: 210mm; height: 297mm; object-fit: cover` derrière le bloc du titre (les éléments non positionnés posés dessus prennent `position: relative`). Donner à Chrome un JPEG déjà COMPOSÉ sur la couleur de la page, pas une image transparente : un fondu voulu (sous un logo, par exemple) se cuit dans l'image, jamais par `mask-image`.

## Vérification

`pdftotext -layout` page par page : les pages pleines n'ont ni l'en-tête ni le pied, les autres « n / total » juste ; chaque repère du sommaire tombe sur la page qui porte son titre. Rendu d'une page pleine avec `pdftoppm -r 144` : les quatre coins ont la couleur de fond ; pour une couverture, aucun pixel blanc (min RVB ≥ 235) sur une bande de 2 % des quatre bords, et `pdfinfo -f 1 -l 1` donne 594,96 × 841,92 pts. `pdffonts` : polices des boîtes de marge embarquées. `pdfimages -list` : chaque illustration paraît UNE fois, sans `smask`, et le poids du PDF reste mesuré avant/après. Prouvé le 29/10/2026 (Beluga, carte 465f43, rapports Marketing) : couverture violette 0 pixel blanc au bord sur 147 200 ; rapport de 72 pages passé de 13,3 Mo (WebP transparents) à 6,9 Mo (JPEG composés) sans différence visible.

## Pièges

- À basse définition (`pdftoppm -r 20`), la dernière colonne de pixels déborde de la page (arrondi de 165,4 à 166 px) et sort BLANCHE : un contrôle de « bord à bord » lit le pixel en retrait d'un, ou rend à 72 dpi et plus.
- Une ombre portée (`box-shadow`) sur une page pleine traverse la coupure et dessine une bande sur la page précédente.
- Une police d'une boîte de marge déclarée par `@font-face` dans la page s'embarque (en Type 3) : un contrôle « police non embarquée » ne doit pas viser le Type 3.
- La couverture rendue à part (marge 0) puis jointe par `pdfunite` n'entre pas dans `counter(pages)` : le sommaire le dit (« pages après la couverture »).
- Une image à canal alpha (PNG, WebP) est ré-encodée par Chrome en « flate » sans perte, couleur + masque (`smask`) : une trame de points 1024×1448 y pèse ≈ 800 ko, même si sa couleur est unie (la prémultiplication la re-trame). Un JPEG est recopié tel quel : ≈ 400 ko.
- `mask-image` sur une image pleine page la fait imprimer DEUX fois dans le PDF.
- Un saut de page forcé par section (`break-before: page`) juste sous le titre d'un chapitre crée une page portant le seul titre : neutraliser le premier (`h1 + .section { break-before: auto }`). Un contrôle de « nombre de pages attendu » doit être relevé en conséquence.

## Ce qui ne marche pas

- `content: ''` avec une image en `background` dans une boîte de marge : la boîte prend une largeur nulle, le logo ne paraît pas.
- `-webkit-mask` dans une boîte de marge : ignoré.
- Alléger une illustration transparente par une compression WebP avec perte : le fichier rétrécit, le PDF non (Chrome décode puis ré-encode sans perte).
