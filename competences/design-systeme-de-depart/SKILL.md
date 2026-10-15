---
name: design-systeme-de-depart
description: À utiliser au DÉMARRAGE d'un nouveau projet web ou d'une nouvelle interface, avant d'écrire le moindre écran : « nouveau projet », « le design fait générique », « donne-lui une identité », « reprends le style de ce site ». Pose un système de design (couleurs, polices, espacements, composants) que tout l'écran suivra, à partir d'une référence, d'une capture ou d'un projet déjà fini.
etat: active
themes: interface, design, demarrage
symptomes: le design fait générique, chaque écran a un style différent, nouveau projet sans identité visuelle, l'agent choisit des couleurs et des polices par défaut, fond crème et mots en italique dans les titres
---

# design-systeme-de-depart

## Symptôme

Un projet neuf qui démarre sans règles de look : chaque écran reçoit d'autres couleurs, d'autres arrondis, d'autres polices, et l'ensemble ressemble à un modèle par défaut. Les agents recommencent à zéro à chaque session.

## Cause

Sans « livre de règles » écrit (couleurs, polices, échelle d'espacement, arrondis, ombres, mouvement, ton), l'agent comble les vides avec ses valeurs par défaut, qui sont les mêmes partout. Selon le guide d'Anthropic sur Opus 5.5 (septembre 2026), ce modèle retombe sur quelques styles précis et « éviter le look générique » ne fait que changer de défaut.

## Procédure

1. Fixer d'abord le système, pas les écrans. Trois façons de partir, de la plus rapide à la plus contrôlée :
   a. À partir d'une référence : donner une capture, un diaporama ou l'adresse d'un site qu'on aime et demander « transforme ceci en système de design » (couleurs, polices, espacements, composants extraits).
   b. À partir d'une galerie : styles.refero.design (galerie gratuite d'environ 2 000 systèmes de design lisibles par un agent, contenu chargé par JavaScript : la lecture par lien est parfois partielle, alors ouvrir la galerie soi-même et coller les liens de 10 à 20 styles). Invite : « Va sur styles.refero.design et trouve les trois systèmes les plus proches de mon activité : [une phrase : ce que je fais, pour qui]. Donne trois liens et une ligne de raison chacun. » Puis, une fois un style choisi et copié : « Utilise ce système de design pour tout ce que tu construis à partir de maintenant, avec ces retouches : [retouches]. [coller le système] ».
   c. À partir d'un projet déjà fini : « Reprends le système de design, les ressources et les décisions de ce projet pour tout ce que nous construisons ici : [dossier ou adresse]. » Pointer le dossier du projet est le moyen le plus fiable ; retrouver une ancienne session par mémoire est moins sûr.
2. Mélanger pour ne pas copier un seul modèle : ouvrir le système retenu, ajouter un second, et dire d'où vient chaque part. Invite : « Prends la typographie du premier système, la palette et le mouvement du second, et fusionne-les en un système pour [marque]. » Si l'outil n'accepte pas de pièce jointe, coller le texte du second système ou l'adresse de son projet.
3. Pour un agent en ligne de commande : écrire le système comme une compétence ou un fichier de règles du projet (ex. « /ma-marque »), avec valeurs EXACTES : codes hexadécimaux, tailles de police, rayons d'arrondi, échelle d'espacement, style d'illustration, mouvement, ton. Invite type : « Fais-moi une compétence /marque-x. Étudie le style visuel de [site] et de ses règles de marque : couleurs, typographie, arrondis, illustration, mouvement, ton. Écris-le en système de design avec codes et tailles exacts. À chaque fois que je lance /marque-x, construis ce que je demande dans ce style. »
4. Ranger le système dans le dépôt du projet (un seul fichier lisible, par exemple DESIGN.md) pour que toute session le retrouve.
5. Renvoyer vers les fiches voisines au lieu de les recopier : « design-taste-frontend » (direction anti-générique, pages d'atterrissage), « redesign-existing-projects » (refonte d'un site existant), « brandkit » (planches d'identité), « polices-de-marque », « voix-et-textes-de-marque », « finition-et-reglages-de-design ».
6. Sans système de design sous la main, NOMMER les styles interdits plutôt que de dire « évite le look générique ». Selon le guide d'Anthropic sur Opus 5.5 (septembre 2026, à revérifier sur platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5, rubrique « Frontend design defaults »), sans direction le modèle retombe sur : fond crème ou blanc cassé, mots d'accent en italique dans les titres, étiquettes de section numérotées « 01 / 02 / 03 », étiquettes en police à chasse fixe, boutons en pilule. Exemple de consigne : « Ne pas utiliser de fond crème ou blanc cassé, de mots en italique dans les titres, d'étiquettes numérotées, d'étiquettes en police à chasse fixe ni de boutons en pilule. » Puis relire le résultat : quels styles a-t-il pris À LA PLACE ? Les ajouter à la liste, et recommencer. Donner le système de design complet (étapes 1 à 4) reste plus fiable qu'une liste d'interdits.

## Vérification

Le système existe si un fichier du dépôt (ou la compétence de marque) donne au moins : une palette avec codes exacts, une police de titres et de texte nommées, une échelle d'espacement, des arrondis, une règle de mouvement. Contrôle : demander à un agent neuf « quelle police et quelle couleur d'accent pour un bouton principal ? » sans lui montrer le code — il doit répondre avec les valeurs du système. Ouvrir deux écrans construits à des jours différents : mêmes polices, mêmes arrondis, même accent. Sans système, relire le premier écran produit : aucun des styles nommés interdits n'y figure, et ceux qui les ont remplacés sont ajoutés à la liste.

## Pièges

- Les noms de boutons des outils changent vite (par exemple « Design systems > Create design system > Continue to generation » dans claude.ai/design au moment du guide, vérifié fin septembre 2026) : suivre l'idée (décrire l'activité, ajouter polices, logos et ressources, laisser générer), pas les libellés.
- Refero n'a pas UN système Apple unique : il a des pages produit Apple (iPhone, AirPods, Watch) utilisables de la même façon.
- Copier une marque à l'identique n'est pas un but : s'inspirer d'une marque qu'on a le droit d'imiter, ou de la sienne.
- Une galerie qui répond « maigre » a mal chargé : coller soi-même les liens.
- L'outil de conception en ligne ne voit pas les fichiers de l'ordinateur tant qu'on ne les y met pas ; l'agent en ligne de commande, si.
- « Évite le look générique » seul ne sert à rien : l'agent change de défaut. Nommer les styles.
- Tous les détails de la fiche viennent de guides datés de septembre 2026 : à revérifier sur les pages officielles avant de s'y fier.

## Ce qui ne marche pas

Demander « fais-moi un beau design » sans système préalable donne un résultat générique. Coller une galerie entière plutôt que 10 à 20 liens choisis noie l'agent. Demander de recopier un site tel quel produit une copie, pas une identité.
