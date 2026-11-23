---
name: beluga-bulle-de-demande-en-texte
description: À utiliser dès qu'on touche à la BULLE DE L'UTILISATEUR de Beluga (sa demande sur une carte, ou son message dans la conversation de l'assistant) ou devant : « un long message collé s'affiche en cadres blancs dans ma bulle », « blanc sur blanc », « un sommaire dans ma bulle », « les dièses s'affichent tels quels chez l'assistant ». Dit quel composant rend la bulle, quelles couleurs elle hérite et comment le contrôler en clair et en sombre.
etat: active
themes: interface, journal
symptomes: cadres blancs à icône # dans la bulle noire, blanc sur blanc dans la bulle de l'utilisateur, sommaire dans la bulle, dièses affichés bruts dans la conversation de l'assistant, titres collés sans taille
projets: Beluga
---

# beluga-bulle-de-demande-en-texte

## Symptôme

Capture #745b (carte « Studio créatif audiovisuel ») : un long prompt à titres #/##/### collé sans pièce jointe sortait dans la bulle noire en rapport — sommaire, puis sections blanches à icône « # », texte blanc sur fond blanc. Dans la conversation de l'assistant, le même message s'affichait en texte brut, dièses visibles.

## Cause

La bulle d'une carte passait par l'aiguillage des étapes (`ContenuDeLEntree` → `vueDeLEntree`) : une demande SANS pièce jointe y devient la sorte « texte » (`VueTexte`, `Markdown` sans `enTexte`), donc rendue en rapport avec `TONE_CLASSES` et des callouts `bg-surface`. La correction précédente (MEM-5338) ne visait que la sorte « demande » (avec pièces). L'assistant (`message-view.tsx`) posait un `<p whitespace-pre-wrap>` brut.

## Procédure

1. Toute bulle de demande se rend par `TexteDeLaDemande` (`web/src/components/contenu-journal.tsx`) : `nettoyerTexteColle`, `texteAvecEtiquettes(…, tagsDuTexte)`, `<Markdown enTexte>`, puis `PiecesJointes` sous `data-contenu-pieces`. Sur une carte : `DemandeDansLaBulle` dans le `Moment` « demande » (`flux-en-points.tsx`), qui lit texte et pièces par `vueDeLEntree`. Dans l'assistant : la bulle `data-bulle="utilisateur-assistant"` de `message-view.tsx`.
2. Ne JAMAIS remettre `ContenuDeLEntree` dans la bulle : il est fait pour les traces d'étapes (onglet Détails, trace dépliée), pas pour du texte.
3. Les couleurs viennent de `.demande-en-texte` (`web/src/styles.css`) : tout en `inherit` / `currentColor`, donc `--encre-fg` sur une carte (bulle noire en clair, grise en sombre) et `--text` chez l'assistant. Titres 18 / 16,5 / 15,5 px, corps 14,5 px (MEM-3218), pas de trait ni de fond. Code : `color-mix(in srgb, currentColor 14%, transparent)`. Encadré `> [!NOTE]` : repère `data-callout` posé par `markdown.tsx`, aplat retiré, filet en `currentColor` 25 %. Tableau : `block overflow-x-auto` pour ne pas élargir la bulle.
4. Le bouton « Copier la demande » et `LigneReperes` copient le texte ENREGISTRÉ, jamais le texte nettoyé.

## Vérification

`npm run build`, puis serveur de dev (`npm run dev --workspace web -- --port 7099`) et `env -u BELUGA_TOKEN HAIKO_BULLE_URL=http://localhost:7099 node scripts/verif-bulle-demande.mjs` — 19/19 le 24.10.2026 sur la carte c6421faa (`HAIKO_BULLE_CARTE=<projet>/<carte>`, captures avec `HAIKO_BULLE_CAPTURES=<dossier>`) : aucune `section`/`nav` dans la bulle, titres plus grands que le corps, contraste ≥ 3 en clair et en sombre, sur la carte et dans l'assistant. Puis `node scripts/verif-copie-demande.mjs` (7/7) et `node scripts/nettoyer-essais.mjs`. Preuve : carte eb090f, commit 710efd73.

## Pièges

- `titreSansEmoji` retire aussi la numérotation en tête d'un titre (« ### 1. Mission » se lit « Mission ») : comportement existant de `enTexte`, non changé.
- Le Markdown du projet garde les retours à la ligne simples (`paragraphBreakAfter`) sauf phrase coupée : un message de lignes courtes reste en lignes.
- Les tags « [fichier: … #id] » restent du texte dans le Markdown (pas de lien sans parenthèses derrière).
- `scripts/verif-journal-carte.mjs` cherche `<ContenuDeLEntree entree={entree} projectId={projectId}` dans `flux-en-points.tsx` : il vise désormais la trace dépliée (avec `dejaDit`).
- Le bouton de l'assistant est `[data-assistant-robot]` (rond en bas à droite) ; `[data-assistant-entete]` n'existe pas sur le tableau.

## Ce qui ne marche pas

Neutraliser les sections colorées par CSS à l'intérieur de `.bulle-utilisateur` (comme pour `[data-encadre]`) : chaque nouvelle forme du Markdown (callout, sommaire, section) réapparaît en blanc. Le rendu doit être du texte dès la source (`enTexte`), pas un rapport maquillé.
