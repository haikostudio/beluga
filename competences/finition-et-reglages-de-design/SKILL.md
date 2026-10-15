---
name: finition-et-reglages-de-design
description: À utiliser quand un écran est correct mais pas fini, ou quand on veut tester des réglages : « c'est propre mais amateur », « corrige la hiérarchie, les espacements, les états vides et l'accessibilité », « rends ça plus discret ou plus affirmé », « donne-moi des curseurs pour régler la taille, les couleurs, les arrondis », « respecte les règles d'Apple pour ce mobile ».
etat: active
themes: interface, design, finition
symptomes: écran correct mais amateur, hiérarchie floue, espacements irréguliers, états vides oubliés, cibles de toucher trop petites, réglages à essayer en direct
---

# finition-et-reglages-de-design

## Symptôme

Le brouillon fonctionne mais ne fait pas professionnel : hiérarchie visuelle molle, espacements irréguliers, états vides sans message, contrastes ou cibles tactiles limites ; ou on tâtonne à la main pour régler taille et couleurs.

## Cause

Une première version ne traite ni l'audit de finition ni les règles des plateformes ; et réécrire du CSS à chaque essai est lent quand un panneau de curseurs suffirait.

## Procédure

1. Audit de finition avec impeccable (github.com/pbakaus/impeccable, compétence gratuite : 1 compétence, 24 commandes au moment du guide ; installer d'après le fichier README du dépôt). Invite : « Lance impeccable sur cette page. Audite la hiérarchie, les espacements, la typographie, l'accessibilité et les états vides, corrige ce que tu trouves, et montre-moi l'avant et l'après. » Version courte : « Rends ceci plus affirmé. » / « Rends ceci plus discret. » Commandes utiles : /audit (accessibilité, performance, adaptation aux écrans) et /critique (hiérarchie).
2. Règles d'Apple pour écran mobile : transformer les Human Interface Guidelines (developer.apple.com/design/human-interface-guidelines) en compétence : « Transforme les Human Interface Guidelines d'Apple en compétence /hig. Garde chaque chiffre : cibles de toucher, échelle typographique, marges, contraste. Applique-la dès que je dessine un écran d'application ou de mobile. » Les chiffres de base (taille des cibles, échelle, contraste) servent tout écran mobile, pas seulement Apple.
3. Panneau de réglages en direct : créer une compétence /tweak : « Fais-moi une compétence /tweak. Quand je la lance sur un fichier HTML, injecte un panneau de curseurs pour la taille de police, les espacements, les couleurs et le rayon d'arrondi, plus un interrupteur pour masquer n'importe quelle section. Laisse-moi régler en direct dans le navigateur. Quand je clique sur Figer, écris les valeurs choisies dans le CSS et retire le panneau. » Le panneau intégré à Claude Design est un outil de cet éditeur, la compétence fonctionne sur n'importe quelle page HTML.
4. Autres commandes de l'éditeur : /design dans Claude Code (aperçu de recherche en septembre 2026) ouvre un canevas de planches modifiables ; l'invite « Implémente celle-ci dans l'application » applique la planche choisie.
5. Renvoyer vers les fiches design déjà présentes plutôt que répéter : « redesign-existing-projects » (audit d'un site existant), « minimalist-ui », « design-taste-frontend ».

## Vérification

Après l'audit : la liste des corrections est produite avec avant/après, aucune régression fonctionnelle (le parcours principal marche encore). Mesurer : contraste texte/fond suffisant, cibles tactiles au moins de la taille demandée par les règles utilisées, chaque liste vide a un message. Pour /tweak : ouvrir la page, le panneau apparaît, un curseur change bien la valeur en direct ; après « Figer » le CSS contient les valeurs et le panneau a disparu.

## Pièges

- Le nombre de commandes d'impeccable et les noms de boutons de Claude Design changent : relire le dépôt et la page officielle.
- Appliquer les règles Apple à un site desktop sans nuance donne des cibles trop grandes : utiliser les chiffres comme socle pour le mobile.
- Un panneau /tweak laissé en production expose des curseurs au public : toujours « Figer » puis retirer.
- Le panneau intégré à Claude Design ne s'affiche pas sur tous les designs.
- /design est en aperçu de recherche : la présentation peut différer.
- Guide daté de septembre 2026 : revérifier.

## Ce qui ne marche pas

Demander « améliore le design » sans critère donne des changements aléatoires. Régler à l'œil par retouches successives de CSS coûte bien plus de tours qu'un panneau de curseurs.
