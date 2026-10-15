---
name: voix-et-textes-de-marque
description: À utiliser dès qu'on écrit ou réécrit les textes d'un site, d'une application ou d'un mail commercial : « le texte sonne comme une IA », « réécris les titres et les boutons », « garde ma façon d'écrire », « fais un guide de ton ». Étudie les concurrents, pose des règles de rédaction et fabrique une compétence de voix qui s'améliore à chaque correction.
etat: active
themes: redaction, interface, marque
symptomes: texte qui sonne comme une IA, titres et boutons génériques, ton qui change d'une page à l'autre, mots interdits qui reviennent
---

# voix-et-textes-de-marque

## Symptôme

Les visuels sont soignés mais les mots trahissent l'IA : « Commencer », « La façon amusante d'apprendre… », formules creuses, ton variable d'un écran à l'autre.

## Cause

Sans exemples réels ni règles de ton, l'agent écrit en moyenne de tout ce qu'il a lu : phrases longues, mots à la mode, promesses vagues.

## Procédure

1. Étudier le marché d'abord : « Passe en revue les cinq principales entreprises de mon secteur ([secteur précis]). Dis-moi ce qu'elles font toutes dans leurs titres, leurs boutons et leur premier écran que les plus faibles ne font pas. Ajoute ces motifs à mon système de design comme règles de rédaction, puis réécris les textes de ma page pour les suivre : une idée par écran, aucun mot qui sonne IA. » Plus le secteur est précis (« logiciel de comptabilité pour petits cafés »), meilleures sont les cinq entreprises retenues.
2. Exemple avant/après du guide : « Get started » devient « Start free » ; « The fun way to learn AI » devient « Everyone uses AI. Almost nobody is good at it. » — un bouton concret, un titre qui affirme un fait.
3. Fabriquer une compétence de voix : réunir cinq vrais textes de la personne (scripts, messages, articles), la liste de ses mots interdits, et demander : « Transforme ceci en compétence /ma-voix. Voici cinq de mes textes : [coller]. Capte comment j'ouvre, la longueur de mes phrases, mes mots et cette liste de mots interdits : [liste]. Ajoute par-dessous ces jeux de règles : ASD-STE100 (anglais technique simplifié : phrases courtes, une idée chacune, mots simples), le guide de ton de Google pour les développeurs, le guide de style d'Apple. À partir de maintenant, chaque fois que je corrige un mot, mets la compétence à jour. »
4. Ranger la compétence de voix dans le projet (ou le pool si elle vaut pour tous) et l'appeler dès qu'un texte est écrit.
5. Pour le français : appliquer les mêmes idées avec des références françaises du domaine ; les guides Google et Apple cités existent en anglais, à ne pas traduire à la lettre.

## Vérification

Relire les titres et boutons réécrits : aucun mot de la liste interdite, une seule idée par écran, boutons qui disent l'action réelle. Contrôle de la compétence : donner un texte neuf à l'agent avec la compétence active, comparer avec un texte témoin sans elle — le ton doit être reconnaissable et les corrections passées appliquées. Vérifier que la dernière phrase de l'invite (mise à jour à chaque correction) est bien dans la compétence.

## Pièges

- Cinq VRAIS échantillons valent mieux qu'une longue description du style.
- Nommer le secteur précisément, sinon les « cinq entreprises » sont trop génériques.
- Les liens des guides de ton (asd-ste100.org, developers.google.com/style/tone, support.apple.com applestyleguide) et leur contenu sont à revérifier sur les pages officielles.
- Copier les formules des concurrents mot pour mot est un plagiat ; on relève des motifs, pas des phrases.

## Ce qui ne marche pas

Décrire son style en trois adjectifs (« chaleureux, moderne, pro ») ne change rien au texte produit. Réécrire tous les textes d'un coup sans règles écrites donne une voix différente à chaque page.
