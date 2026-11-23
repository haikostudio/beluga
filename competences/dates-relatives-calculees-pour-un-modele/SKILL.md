---
name: dates-relatives-calculees-pour-un-modele
description: À utiliser dès qu'un agent ou un modèle situe mal un événement dans le temps (« la semaine dernière » pour ce matin, « récemment » pour un mois), ou avant de servir des dates (journal, historique, fiches) dans le contexte d'un modèle. Dit où calculer l'écart et où ne surtout pas l'écrire.
etat: active
themes: agents, methode, consignes
symptomes: l'agent dit « la semaine dernière » pour un changement du jour, l'agent situe mal une date alors qu'il a la date du jour, mention « hier » fausse dans un fichier enregistré
---

# dates-relatives-calculees-pour-un-modele

## Symptôme

Le modèle a sous les yeux la date du jour ET la date de l'événement, et pourtant il écrit un écart faux (« la semaine dernière » pour ce matin).

## Cause

Un modèle ne compare pas les deux dates de lui-même. Il rapproche au jugé. Les données sont justes, c'est le rapprochement qui est faux.

## Procédure

1. Le programme calcule l'écart : « aujourd'hui », « hier », « il y a N jours », puis « il y a N mois » au-delà de 60 jours, et rien pour une date future. Il l'écrit entre parenthèses à côté de la date (« 2026-10-06 (aujourd'hui) »).
2. Calculer en jours calendaires, dans le MÊME fuseau que celui qui a produit la date imprimée (souvent UTC, avec toISOString().slice(0,10)). Sinon, une entrée de 00 h 30 heure locale se lit « hier ».
3. Passer l'instant du tour (« maintenant ») en paramètre, avec Date.now() par défaut. Les tests restent ainsi déterministes.
4. N'écrire l'écart QUE dans ce qui part au modèle : le premier message du tour, les réponses d'outil.
5. Ajouter une consigne courte et STATIQUE : « un événement passé ne se situe jamais dans le temps sans comparer sa date à la date du jour ; dans le doute, dire "la correction précédente" ».

## Vérification

Test unitaire avec un instant fixé. Vérifier aujourd'hui, hier, 7 jours, 3 mois, date future (rien), les bords de minuit (00:00:01 et 23:59:59) et les changements de mois. Vérifier aussi que le rendu enregistré, appelé sans instant, ne contient ni « aujourd'hui » ni « hier ». Preuve : Beluga, carte « Date « semaine dernière » erronée », commit 739c85dd.

## Pièges

Une session qui dure plusieurs jours garde l'écart calculé au premier message. La date reste imprimée à côté, et c'est elle qui fait foi.

## Ce qui ne marche pas

- Mettre la date du jour ou les écarts dans la consigne système. Elle sert de préfixe au cache : la changer chaque jour, ou à chaque tour, fait tout repayer.
- Écrire l'écart dans un fichier enregistré (rendu Markdown, changelog sur disque). Il est faux dès le lendemain et le fichier change tous les jours.
- Compter l'écart en tranches de 24 h au lieu de jours calendaires : « hier » devient faux près de minuit.
