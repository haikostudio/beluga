---
name: jarvis-ouvrir-projet
description: À utiliser quand l'utilisateur demande à Jarvis, à la voix, d'ouvrir un projet ou une tâche dans Beluga : « Ouvrir le projet Beluga depuis les tableaux de bord », « Ouvrir la tâche « Disque de Beluga à 70 % » », « ouvre la tâche du disque à 70 % ». Trouver d'abord (tous les projets), puis un seul geste « ouvrir » à l'adresse rendue — jamais un clic sur un libellé.
etat: active
themes: jarvis, voix, interface
symptomes: Ouvrir le projet Beluga depuis les tableaux de bord, Ouvrir la tâche « Disque de Beluga à 70 % », ouvre la tâche, tâche introuvable à la voix
projets: Beluga
---

# jarvis-ouvrir-projet

## Symptôme

Demandes d'origine : « Ouvrir le projet Beluga depuis les tableaux de bord » et « Ouvrir la tâche « Disque de Beluga à 70 % » ». Le chemin appris par clic (« cliquer » sur « Beluga », ou sur le libellé de carte « Disque de Beluga à 70 % 5 h ») dépend du libellé visible à l'écran : il rate sur téléphone, dès que l'heure collée au titre change (« 5 h » → « 6 h »), ou quand la tâche n'est pas dans le projet ouvert. Le 18/11/2026, « la tâche de Beluga 70% » n'a pas été trouvée d'emblée (cherchée dans le seul projet ouvert, « 70% » ≠ « 70 % »).

## Procédure

1. Une TÂCHE : « assistant_gestes » `{ action: "trouver", texte: "<quelques mots>" }` — elle cherche dans TOUS les projets, avec des mots approchants, et rend le lien `#projet/<id>/tache/<id>`.
2. Un PROJET : l'adresse `#projet/<id>` (identifiant rendu par « project_manage » « lister » ou par le lien d'une de ses tâches).
3. « assistant_ecran » « jouer » avec UN SEUL geste `ouvrir` sur cette adresse (« J'ouvre la tâche … »). Jamais `cliquer` sur un libellé.

## Vérification

Le geste revient « fait » dans l'encadré « Jarvis agit sur l'écran » et l'adresse de la page est celle demandée ; « c'est fait » ne se dit qu'après ce retour. Corrigée le 18/11/2026 (carte « Ménage de la mémoire de la voix ») ; le chemin « Disque de Beluga à 70 % » réussi une fois par clic (rangé la nuit du 19/11/2026 sous jarvis-ouvrir-tache, réuni ici au ménage des compétences du 19/11/2026, l'autre fiche archivée).

## Pièges

- Ne jamais demander le titre exact avant d'avoir cherché.
- Un libellé de carte porte son heure collée (« … 70 % 5 h ») : le recopier fait rater le clic dès que l'heure bouge — d'où l'adresse.
- Un « jouer » rendu en échec se dit avec sa raison, jamais « c'est affiché ».
