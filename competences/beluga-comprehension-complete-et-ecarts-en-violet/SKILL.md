---
name: beluga-comprehension-complete-et-ecarts-en-violet
description: À utiliser dès qu'on touche à la compréhension de cadrage d'une carte Beluga — sa consigne, son rendu dans le fil, ce qui a changé d'une version à l'autre : « la compréhension ne dit que ce qui change », « le violet ne s'affiche pas », « après une question la compréhension a disparu », « tout le texte passe en violet », « la réponse a un titre de sujet au-dessus ».
etat: active
themes: cadrage, interface, journal
symptomes: la compréhension ne dit que ce qui change, le violet ne s'affiche pas dans la compréhension, tout le texte de la compréhension est en violet, après une simple question la compréhension n'est plus visible, un titre de sujet au-dessus de la réponse
projets: Beluga
---

# beluga-comprehension-complete-et-ecarts-en-violet

## Procédure

1. La CONSIGNE vit à quatre endroits qui doivent dire la même chose (compréhension COMPLÈTE à chaque rendu, réponse à la question en premier point « ### Votre question sur … », jamais un différentiel) : `FORME_DE_LA_COMPREHENSION` et `CONSIGNE_CADRAGE` (shared/src/cadrage.ts), la description de `rendre_comprehension` (server/src/tools.ts), le bloc « Dernière compréhension rendue » injecté avec la carte (server/src/runtime.ts, `carteContexte`). Un seul reste contradictoire suffit à faire rendre des différentiels.
2. L'ÉCART EST CALCULÉ PAR L'ÉCRAN, jamais marqué par l'agent : `marquerLesEcarts(precedente, nouvelle)` (shared/src/ecarts-de-comprehension.ts) découpe en points « ### » puis en phrases, compare normalisé (casse, espaces, ponctuation, habillage Markdown), traite un titre neuf comme un point neuf, ne coupe jamais une phrase dans un `**gras**`, et pose les marques invisibles U+E000 / U+E001 APRÈS le préfixe Markdown de la ligne. Sans précédente : rien n'est marqué.
3. Le rendu : `MomentDeComprehension` (web/src/components/flux-en-points.tsx) lit la compréhension précédente de la carte par le contexte `ContexteComprehensionsDeLaCarte` ; `inline` de web/src/lib/markdown.tsx rend chaque tronçon marqué dans un `span.text-teinte[data-ecart-de-comprehension]`, un titre marqué aussi ; sommaire et texte lisible passent par `sansMarquesDEcart`.
4. Tour qui n'est qu'une question (passage « Compréhension » avec une réponse et sans compréhension à lui) : l'écran repose la dernière compréhension, en entier, sans violet (`data-comprehension-rappelee`).
5. Le fil d'un passage : carte du passage, fil du tour, réponse SANS titre au-dessus, compréhension. Plus de `PointsDuCadrage`, plus de reformulation de la demande sous la bulle (la donnée `resumeDemande` reste en base).

## Vérification

`node --test server/dist/test/ecarts-de-comprehension.test.js` (6 cas : première sans violet, ponctuation ignorée, phrase ajoutée, titre neuf, code jamais marqué, gras jamais coupé) et `node --test server/dist/test/parler-simplement.test.js server/dist/test/analyse-de-cadrage.test.js` (consigne). Dans le navigateur : ouvrir une carte à plusieurs compréhensions et lire `getComputedStyle` d'un `[data-ecart-de-comprehension]` — la couleur doit être celle de `--teinte`, pas `--text`. Carte « Ressources : volet, modales et sources » (c6aef5), 13/11/2026.

## Pièges

- `.comprehension-detachee *` impose la couleur `--text` en `!important` (styles.css) : un `text-teinte` posé dans la compréhension reste NOIR. La règle `.comprehension-unie [data-ecart-de-comprehension]` en `!important` est ce qui laisse passer le violet — à garder si on touche ces règles.
- Sur une carte dont la compréhension précédente suivait l'ancienne règle (un différentiel), la suivante est presque entièrement violette : attendu, pas un défaut.
- Dans une capture, la barre d'écriture d'une carte qui travaille (message en attente, suggestions) peut cacher tout le fil : prendre une fenêtre haute (1440×1700) pour voir le violet.
