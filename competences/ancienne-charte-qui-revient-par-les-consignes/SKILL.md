---
name: ancienne-charte-qui-revient-par-les-consignes
description: À utiliser après la refonte visuelle d'un site ou d'une marque, ou dès qu'un document, un rapport ou un visuel fabriqué par un agent reprend l'ANCIEN style alors que le site a changé : dit où l'ancienne charte survit (consignes, mémoire, commentaires, documentation, fichiers de marque) et comment la purger pour qu'une seule fiche, calquée sur le site en ligne, fasse foi.
etat: active
themes: marque, design, methode, memoire
symptomes: le rapport reprend l'ancien style, l'agent dessine des formes que le site n'a plus, l'ancienne police revient, deux consignes se contredisent sur le style, on a déjà corrigé la couverture et ça revient, la charte décrite ne ressemble pas au site
---

# ancienne-charte-qui-revient-par-les-consignes

## Symptôme

Après une refonte, les documents ou visuels produits par les agents reviennent à l'ancien style, même après une correction ponctuelle du document.

## Cause

Les agents tirent la charte de ce qu'ils lisent : fichier d'instructions, mémoire, commentaires en tête des feuilles de style, documentation. Une refonte qui ajoute « l'ancienne règle ne s'applique plus » sans retirer l'ancienne laisse les deux textes coexister, et l'ancienne description — souvent plus détaillée — l'emporte.

## Procédure

1. Relever le site en ligne : capture pleine page après un défilement complet, plus les valeurs calculées (fond du corps, fond et arrondi de chaque section, familles de polices réellement chargées par document.fonts).
2. Inventorier l'ancien style partout où un agent lit : fichier d'instructions, fichiers d'attente des règles, toutes les unités actives de la mémoire du projet (pas seulement la recherche : lister et filtrer leur texte entier), documentation, commentaires d'en-tête des feuilles de style, configuration (préchargements de polices), scripts de contrôle, fiches de compétences du projet.
3. Une unité devenue fausse se déprécie ; une unité en partie juste se réécrit sans la partie fausse ; ne garder aucune phrase « avant, c'était… » qui redécrit l'ancien style.
4. Écrire UNE fiche de référence du style actuel, calquée sur le relevé : couleurs en hexadécimal, surfaces, police, rôle exact des accents, et une liste explicite de ce qui N'EN FAIT PAS partie. Elle remplace l'ancienne fiche de style.
5. Ne pas supprimer les fichiers de marque que d'autres outils lisent (logo, polices) : les nommer dans la fiche comme ressources ou comme fichiers à ignorer.

## Vérification

La recherche par mots entiers des marqueurs de l'ancien style (noms d'anciennes polices, formes, couleurs de fond) dans le dépôt hors dépendances et dans le texte entier des unités actives ne rend que la fiche de référence et les phrases qui interdisent ; la fiche de référence, posée à côté d'une capture du site en ligne, décrit les mêmes fonds, la même police et les mêmes accents.

## Pièges

- Une recherche par sous-chaîne remonte des faux positifs (« anneau » dans « panneau ») : chercher par mots entiers.
- Une ligne du fichier d'instructions peut porter plusieurs règles collées ; un retrait automatique par ligne les emporterait toutes : séparer d'abord une règle par ligne.
- Un préchargement de police qui vise un fichier plus déclaré télécharge pour rien et fait croire que la police sert encore.

## Ce qui ne marche pas

Corriger seulement le document fautif (retirer les formes d'une couverture) : l'ancien style revient au document suivant tant qu'une consigne le décrit. Ajouter une règle « l'ancienne ne s'applique plus » à côté de l'ancienne : les deux coexistent.
