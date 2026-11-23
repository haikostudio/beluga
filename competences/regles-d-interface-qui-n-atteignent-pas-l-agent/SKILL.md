---
name: regles-d-interface-qui-n-atteignent-pas-l-agent
description: À utiliser quand des agents de code ignorent des règles pourtant écrites en mémoire (composants maison, structure de page, design system) et livrent des écrans hors charte : dit pourquoi une mémoire volumineuse ne suffit pas, et comment faire appliquer les règles — charte courte servie d'office selon les fichiers touchés, garde-fou statique, porte de fin de tour avec relecture en images, et ménage de la mémoire vérifié par un essai de rappel.
etat: active
themes: agents, memoire, interface, consignes
symptomes: l'agent utilise des select natifs malgré la règle, les règles d'interface sont en mémoire mais jamais lues, résultats d'interface laids d'une carte à l'autre, tout est marqué vital dans la mémoire, l'agent ne cherche que le sujet métier
---

# regles-d-interface-qui-n-atteignent-pas-l-agent

## Cause

Une règle stockée parmi des milliers d'unités « importantes » n'est ni servie (l'accueil est plafonné) ni cherchée (l'agent cherche le sujet de sa tâche, pas la façon de construire un écran). L'inflation des priorités rend « vital » insignifiant. Rien ne vérifie le résultat avant que la tâche soit rendue.

## Procédure

1. MESURER d'abord : lectures de mémoire par tâche et par étape, et part des tâches d'interface qui ont reçu les règles.
2. CONDENSER les règles d'un domaine en une CHARTE courte (≈20 règles, quelques milliers de signes), versionnée dans le dépôt, chaque règle nommant le composant à utiliser ; plusieurs chartes si l'interface a plusieurs domaines.
3. LA SERVIR D'OFFICE dans la demande du tour (pas dans la consigne système, qui doit rester stable pour le cache), seulement quand les fichiers prévus/touchés ou les mots de la demande tombent dans son domaine, sous un plafond mesuré, une fois par session.
4. GARDE-FOU STATIQUE : les interdits (éléments natifs, fenêtres du navigateur) s'analysent dans le code sans commentaires, balise lue jusqu'à sa vraie fin (une flèche `=>` dans un attribut ne la coupe pas), exemptions pour le composant maison ; il tourne sur tout le dépôt dans la suite de tests ET sur les fichiers de la tâche à sa fin.
5. PORTE DE FIN DE TOUR : fichiers d'écran modifiés sans capture, ou interdit violé → renvoyer l'agent corriger par une demande interne ; nombre de renvois borné, puis rendre en le disant (jamais de tâche coincée).
6. MODÈLES DE PAGES : gabarits construits sur les composants existants, avec en tête ce qui ne varie pas / ce qui peut varier.
7. MÉNAGE DE LA MÉMOIRE : indicateur de flou (part des unités vitales, doublons exacts), lot borné de déclassements d'unités anciennes jamais lues, entre deux essais de rappel sur des demandes types à réponse connue ; annuler tout le lot si le rappel baisse.

## Vérification

La mesure avant/après montre que les tâches d'interface reçoivent la charte ; le garde-fou trouve exactement les écarts connus puis zéro après correction ; un test simule une dégradation de l'essai et constate la restauration de chaque unité touchée ; les écrans touchés sont capturés ordinateur/téléphone, clair/sombre.

## Pièges

- Une règle déclarée « interdite » alors que le code existant la viole bloquera toutes les tâches : nettoyer le code avant d'activer l'interdit (le garde-fou sur tout le dépôt le montre).
- Un « interdit » cherché en texte brut fait des faux positifs sur les commentaires et la documentation : ôter les commentaires en gardant positions et lignes.
- Servir la charte dans la consigne système d'une session ouverte casse le cache de préfixe et viole la stabilité de session.
- Une mise à jour ordinaire de la mémoire garde souvent l'importance la plus haute : prévoir un geste dédié pour déclasser, versionné.

## Ce qui ne marche pas

- Compter sur un accueil de mémoire plafonné « P0/P1 » pour porter des règles de style : elles y sont noyées.
- Demander à l'agent de « consulter la mémoire » : il cherche son sujet métier, jamais la façon de construire.
