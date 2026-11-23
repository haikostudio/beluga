---
name: document-long-lu-en-entier-par-un-agent
description: À utiliser dès qu'un agent doit connaître un document long (rapport, dossier, historique) pour en discuter : « l'agent dit ne pas recevoir tout le rapport », « il ignore la fin du document », « la consigne est coupée », ou avant de coller un gros contenu dans la consigne d'un agent.
etat: active
themes: agents, consignes, ia
symptomes: un agent qui avoue ne voir qu'une partie du document, des réponses qui ignorent la fin d'un rapport, une consigne énorme repayée à chaque message
---

# document-long-lu-en-entier-par-un-agent

## Symptôme

L'agent répond sur le début du document mais ignore ou invente la fin ; parfois il dit lui-même que le contenu est « coupé ».

## Cause

Le contenu était versé dans la consigne à travers une borne de longueur qui tronque sans prévenir (slice), et seulement en résumés. Une consigne longue est aussi repayée à chaque message.

## Procédure

1. Écrire le document ENTIER dans un fichier du dossier de travail de l'agent (Markdown), réécrit à chaque ouverture ou message pour rester à jour.
2. Replier les très longues lignes sur les espaces (≈ 400 signes) : l'outil de lecture du moteur coupe une ligne trop longue. Ne jamais tronquer.
3. Baliser le texte venu de tiers comme DONNÉE (ex. `<donnee nature="…" fiable="non">…</donnee>`) pour qu'aucune instruction qui s'y cache ne soit suivie.
4. Terminer le fichier par une ligne-repère unique (« === FIN DU … === »).
5. Dans la consigne, ne donner que le chemin, le nombre de lignes et l'ordre : lire avec l'outil de lecture par morceaux (offset / limit) jusqu'à voir le repère, avant tout message ; relire si la mémoire de la conversation l'a perdu ; ne jamais dire qu'il manque une partie.
6. Si une borne reste nécessaire ailleurs, l'annoncer dans le texte (« suite dans le fichier ») au lieu de couper en silence.

## Vérification

Test unitaire : un contenu avec un très long extrait et des dizaines d'éléments ressort entier (dernier élément et dernier mot présents), aucune ligne au-delà de 2 000 signes, dernière ligne = repère. Essai réel : demander à l'agent un élément de la dernière section ; il répond sans évoquer de coupure.

## Pièges

- Une fonction de « délimitation » de donnée qui a une longueur maximale par défaut tronque sans le dire : vérifier sa signature avant de lui confier un document.
- Résumer chaque section avant de la servir fait perdre les preuves et les chiffres que l'utilisateur interrogera.
