---
name: polices-de-marque
description: À utiliser dès qu'il faut choisir ou changer les polices d'un site ou d'une application : « le design fait fabriqué par une IA », « choisis une police », « associe une police de titres et une de texte », « quelle licence pour cette police ». Donne où trouver une police, comment vérifier sa licence commerciale et comment l'imposer à l'agent.
etat: active
themes: interface, design, typographie
symptomes: police par défaut de l'agent, design qui trahit un projet généré, association titres et texte hésitante, licence de police incertaine
---

# polices-de-marque

## Symptôme

Le site est propre mais « sent » la génération automatique : la police est celle que l'agent choisit toujours faute de consigne. Ou une police a été prise sans savoir si son usage commercial est permis.

## Cause

Une police est le signe le plus visible d'un design non pensé. Sans consigne, l'agent retombe sur le même choix par défaut, et n'a pas de moyen de vérifier une licence.

## Procédure

1. Choisir une police qui colle à la marque : fontshare.com (polices gratuites, dont Switzer) ou fontesk.com. Besoin d'une paire titre + texte : la générer sur fontjoy.com.
2. VÉRIFIER LA LICENCE avant de livrer : les polices Fontshare sont gratuites en usage commercial sous la licence ITF Free Font License ; Fontesk fixe une licence par police, donc toutes ne sont pas libres pour un usage professionnel. Lire la licence sur la page de la police.
3. L'imposer à l'agent, en nommant la police : « Utilise Switzer pour tous les titres et tout le texte. » (Switzer est l'exemple du guide.) Ou téléverser le fichier de police dans le système de design du projet.
4. Charger la police proprement dans le projet (fichier ou service de polices, avec une police de secours dans la pile) et l'inscrire dans le système de design (voir « design-systeme-de-depart »).
5. Pour la direction typographique globale (contraste d'échelle, éditorial), voir « design-taste-frontend » et « high-end-visual-design » plutôt que de la répéter ici.

## Vérification

Ouvrir la page dans un navigateur, inspecter un titre et un paragraphe : la police calculée est bien celle demandée (et non la police de secours). Rechercher dans le code le nom de la police par défaut de l'agent : il ne doit plus apparaître dans les styles. La licence retenue est notée à côté de la police dans le dépôt (lien de la page de licence).

## Pièges

- « Gratuit » ne veut pas dire « gratuit pour un usage commercial » : Fontesk se juge police par police.
- Nommer une police que la page ne charge pas ne change rien : le navigateur retombe sur une police de secours sans rien dire.
- Le guide date de septembre 2026 : revérifier la licence sur la page officielle au moment de livrer.

## Ce qui ne marche pas

Écrire « une police élégante » sans la nommer ramène le choix par défaut. Mélanger trois familles sur une page casse l'unité plutôt que de l'enrichir.
