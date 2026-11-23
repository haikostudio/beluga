---
name: page-tuee-au-demarrage-sur-iphone
description: À utiliser dès qu'une application web ou installée affiche sur iPhone « Un problème récurrent est survenu sur … » (ou « A problem repeatedly occurred ») à l'ouverture ou à la réouverture, sans aucune erreur JavaScript remontée : la page est tuée par le téléphone pendant son démarrage. Dit quoi mesurer, ce qui pèse vraiment, et comment faire repartir la page allégée après une coupure.
etat: active
themes: mobile, ios, performance
symptomes: un problème récurrent est survenu, a problem repeatedly occurred, page qui se recharge seule sur iPhone, application qui ne rouvre pas, aucune erreur remontée
---

# page-tuee-au-demarrage-sur-iphone

## Symptôme

Safari, une app installée ou le navigateur intégré d'une autre app (WhatsApp, Instagram) montre « Un problème récurrent est survenu » : le processus de la page a été coupé deux fois de suite. Le journal d'erreurs de la page reste vide.

## Cause

Le système coupe la page sur sa mémoire TOTALE, pas seulement le tas JavaScript : images décodées (largeur × hauteur × 4 octets — une icône de 2048 px affichée à 15 px coûte 16 Mo), couches de flou, gros textes relus d'un bloc (copie dans localStorage), rafales de gros messages temps réel. Le navigateur intégré d'une autre application a moins de marge que Safari.

## Procédure

1. Mesurer ce qui ARRIVE : un petit client temps réel (session d'essai) qui additionne la taille de chaque type de message pendant 10 s après l'ouverture ; repérer les champs répétés à l'identique.
2. Mesurer ce qui est AFFICHÉ, dans Chrome émulé iPhone par CDP (`Performance.getMetrics` : tas, nœuds) ET la liste des images avec `naturalWidth/naturalHeight` comparés à leur taille affichée, plus les éléments à `backdrop-filter`.
3. Servir chaque image à sa taille (miniature côté serveur, `?w=` ≈ 3 × la taille affichée).
4. Ne pas renvoyer un gros champ inchangé à chaque mise à jour : le serveur garde, par connexion, le dernier envoyé et dit « inchangé » ; l'écran garde le sien.
5. Filet : poser un marqueur « démarrage en cours » (localStorage, date) au début, l'effacer quelques secondes APRÈS le premier état reçu ; s'il est encore là au chargement suivant (moins de 10 min), démarrer allégé (sans cache lourd, qu'on jette).

## Vérification

Contrôle navigateur WebKit iPhone : marqueur posé puis effacé après le premier état ; marqueur laissé + canal coupé → le cache est jeté et rien n'est dessiné depuis lui ; les requêtes d'icônes portent toutes une largeur et l'image reçue a une largeur ≤ 3 × l'affichage. Preuve d'origine : Beluga, carte « Page d'erreur à la réouverture », commit 2bc7f1e7, scripts/verif-demarrage-allege.mjs (9/9).

## Pièges

- Le tas JavaScript mesuré peut être petit (13 Mo) alors que la page meurt : regarder les images décodées.
- Une coupure ne se reproduit pas en émulation : on prouve par la mesure avant/après, pas par le plantage.
- Le marqueur doit se reposer à chaque démarrage (sinon le mode allégé ne s'applique jamais qu'une fois) et s'effacer seulement après un état stable.
- Un contrôle qui liste les clés du stockage du navigateur doit connaître ce marqueur.
