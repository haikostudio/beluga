---
name: opus-5-5-effort-cache-et-consignes
description: À utiliser dès qu'on règle ou qu'on prépare un travail confié à Claude Opus 5.5 : niveau d'effort à choisir, tours lents ou coûteux, cache perdu quand on change d'effort, agent qui s'arrête avec du travail ouvert, besoin d'un budget de temps, conversation longue où le modèle revient sur ses réponses, lecture d'une image très dense (plan, schéma, graphique). Donne les réglages et les phrases de consigne du guide d'Anthropic (septembre 2026), à revérifier.
etat: active
themes: agents, methode, quotas, moteur
symptomes: tours d'agent trop longs ou trop chers, cache perdu en changeant d'effort, l'agent s'arrête sur un message d'avancement avec des éléments ouverts, le modèle revient sans cesse sur ses réponses précédentes, quel niveau d'effort choisir, image dense mal lue
---

# opus-5-5-effort-cache-et-consignes

## Symptôme

Un agent sur Opus 5.5 réfléchit trop longtemps sur de simples suites, coûte plus que prévu après un changement de niveau d'effort, ou termine son tour sur un point d'avancement alors qu'il reste des éléments ouverts.

## Cause

Le niveau d'effort d'un ancien modèle est reporté tel quel alors que le défaut a changé ; changer l'effort global entre deux messages efface le cache ; sans liste de tâches, un message d'étape est pris pour la fin.

## Procédure

Source : guide « Opus 5.5 Prompting Guide » (septembre 2026, auteur tiers) qui cite le guide officiel d'Anthropic ; TOUT est à revérifier sur platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5 et platform.claude.com/docs/en/build-with-claude/effort avant de s'y fier.
1. Effort. Selon le guide : défaut « medium » sur Opus 5.5 (Opus 5 : « high »). Le fixer explicitement, tester plusieurs niveaux sur SON propre travail (même tâche, mêmes fichiers, départ neuf, noter durée et usage, choisir le plus bas niveau où la qualité cesse de progresser) ; ne réserver « xhigh » et « max » qu'aux cas où un gain est mesuré ; à ces niveaux, prévoir un grand plafond de sortie (max_tokens). API : output_config.effort ; Claude Code : option --effort ou réglage effortLevel.
2. Cache. Changer l'effort global entre deux messages efface le cache (le message suivant paie la relecture complète). Selon le guide, Opus 5.5 permet un changement PAR MESSAGE (bêta, en-tête mid-conversation-output-config-2026-07-01) : un message système à contenu vide portant l'effort voulu, appliqué au tour suivant. Bêta : l'essayer avant de s'y fier ; sur d'autres modèles le cache repart.
3. Réponses réglées. Phrase d'Anthropic, mot pour mot : « Once you have answered something, treat that answer as done. On later turns, focus your thinking on what the user is asking now, and don't go back over an earlier answer unless the user asks about it or points out a problem with it. » L'omettre pour les longues analyses ou les tâches où une étape tardive peut révéler une erreur ancienne.
4. Liste de tâches. Demander : « Avant de commencer, écris la liste de toutes les parties de la tâche, coche chacune à mesure. Avant de finir, relis la liste : s'il reste un élément ouvert, continue ou dis ce qui le bloque. » Si le tour finit avec des éléments ouverts, relancer avec la phrase du guide : « Your task list still has open items: [éléments]. Continue with them. If one is blocked, say what is blocking it. » S'arrêter après deux ou trois relances (l'agent est alors vraiment bloqué : relire).
5. Temps. Un budget consultatif (rien n'arrête le modèle à la limite : garder son propre délai) : « Finish this task in 3 minutes. » ; un harnais peut ajouter en fin de message « elapsed 340s / 1200s ». Sans budget : « Time matters here: do not spend time that can be avoided, and the earlier a correct result is obtained, the better. » Le modèle peut vérifier un peu moins sous pression : contrôler la qualité.
6. Fichier d'instructions : selon le guide, Claude Code lit AGENTS.md seulement s'il n'y a pas de CLAUDE.md dans le dossier (version 2.1.277 ou plus, réglable dans /config) ; un CLAUDE.md présent l'emporte.
7. Images très denses (plans techniques, schémas, graphiques serrés, captures d'écran chargées) : envoyer l'image en la plus haute résolution disponible et donner à l'agent de quoi RECADRER, ZOOMER, mesurer et vérifier : les bibliothèques Python Pillow (PIL) et opencv-python installées dans l'environnement du projet. Invite : « Installe Pillow et opencv-python dans l'environnement Python de ce projet. Quand je t'envoie une image dense, utilise-les pour recadrer et zoomer sur les parties utiles, mesurer ce qui compte et vérifier ta lecture avant de répondre. » Selon le guide, l'agent s'en sert mieux à effort élevé ; sans outils, monter l'effort aide sur les plans techniques mais peu sur les graphiques. Une recette d'outil de recadrage existe dans le Claude Cookbook (platform.claude.com/cookbook/multimodal-crop-tool). Pour lire des captures d'écran d'un contrôle navigateur, le même conseil vaut.
8. Voir aussi : « eviter-la-demande-de-raisonnement-visible » (autre piège d'Opus 5.5), « affiner-une-competence-par-retours-en-regles », et pour les styles de design par défaut du modèle « design-systeme-de-depart ».

## Vérification

Après un réglage : lancer la même tâche à deux niveaux et comparer durée, usage et qualité ; un changement d'effort par message laisse une lecture de cache importante au tour suivant (relever les jetons lus du cache et les jetons écrits dans l'usage rendu) ; un tour qui se termine avec la liste de tâches montre chaque élément coché ou un blocage nommé. Pour une image dense : l'agent cite les valeurs lues sur la zone recadrée et une re-lecture de la même zone donne le même chiffre. Aucune de ces valeurs ne s'affirme sans avoir relu la page officielle du jour.

## Pièges

- Reporter le réglage d'Opus 5 : à niveau égal, Opus 5.5 réfléchit plus par tour, surtout à xhigh et max.
- La phrase « réponses réglées » peut rendre le modèle moins enclin à corriger une erreur ancienne : à éviter là où c'est le point.
- Le budget de temps est indicatif, pas un arrêt.
- En-tête bêta, numéro de version et noms de niveaux viennent d'un guide daté de septembre 2026 : ils changent vite.
- Le guide contient aussi des astuces propres à un compte (réinitialisations d'usage) et une promotion de communauté : sans objet ici.

## Ce qui ne marche pas

Passer tout en « max » par prudence : plus lent et plus cher sans gain mesuré. Changer d'effort à chaque message par le réglage global : le cache repart à chaque fois.
