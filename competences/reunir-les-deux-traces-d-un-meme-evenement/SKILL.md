---
name: reunir-les-deux-traces-d-un-meme-evenement
description: À utiliser dès qu'un même événement est journalisé par DEUX chemins qui s'ignorent (un pont d'outils et un moteur, un client et un serveur, un webhook et une relève) et qu'on les réunit à l'affichage ou à l'import : « la réponse s'affiche sous la mauvaise ligne », « une ligne a disparu », « la même ligne paraît deux fois », « le résultat d'un appel est attaché à l'appel suivant ». Dit comment apparier les deux traces par ce qu'elles disent, jamais par leur voisinage.
etat: active
themes: agents, outils, interface, donnees
symptomes: le résultat d'un appel s'affiche sous l'appel suivant, une ligne disparaît quand deux appels se suivent, la dernière ligne d'une série paraît deux fois, la fusion de doublons mélange deux événements voisins, un dédoublonnage par voisinage casse sur des appels en parallèle
---

# reunir-les-deux-traces-d-un-meme-evenement

## Symptôme

Une liste d'événements est écrite en double par deux sources (A écrit au départ, B écrit à l'arrivée avec le résultat). On les réunit « quand deux lignes se suivent, viennent de sources différentes et parlent du même outil ». Tout va bien pour un événement isolé. Dès que deux événements du même genre se suivent sans rien entre eux, le décalage apparaît : l'intitulé du second porte le résultat du premier, un événement manque, le dernier est en double.

## Cause

Trois raccourcis qui tiennent tant que les événements sont espacés.
1. La ligne réunie reste candidate à une nouvelle réunion. Elle hérite des marques de l'une des deux sources (souvent le libellé de B) : relue comme « une trace de B », elle s'apparie avec la trace de A de l'événement SUIVANT. Séquence A1 B1 A2 B2 → [A1+B1+A2], [B2].
2. L'appariement se fait par voisinage, pas par identité : rien ne vérifie que les deux traces disent la même chose. Et « garder le texte le plus long » choisit alors au hasard entre deux événements différents.
3. Les événements lancés ensemble s'écrivent croisés (A1 A2 B1 B2) : le voisin immédiat de B1 est A2.

## Procédure

1. MESURER AVANT DE CORRIGER, sur les données réelles et en lecture seule : compter les paires A→B consécutives, celles dont le contenu est strictement égal, et regarder un échantillon des autres. Les « autres » sont de deux natures qu'il faut séparer : de vrais événements différents (croisés), et le même événement écrit autrement par une source.
2. UNE PAIRE, PAS PLUS : une ligne issue d'une réunion sort du jeu. Tenir la liste des traces ENCORE SEULES dans la boucle de la règle, pas en ajoutant un champ aux données.
3. APPARIER PAR IDENTITÉ : s'il existe un identifiant commun aux deux sources, l'utiliser. Sinon comparer le CONTENU (les paramètres) sous une forme canonique — JSON relu, enveloppe propre à une source retirée, clés triées — jamais le texte brut.
4. CHERCHER PARMI LES SEULES, PAS CHEZ LE VOISIN : chaque trace cherche sa moitié parmi les traces encore seules de la suite en cours, la plus ancienne d'abord. Cela règle d'un coup les séquences croisées et les doublons parfaits.
5. BORNER LA SUITE : même tour ou même session, même genre, rien d'autre entre les traces, et une fenêtre de temps égale à la durée maximale réelle de l'événement (une question peut attendre longtemps).
6. QUAND L'UNE N'A PAS DE CONTENU, réunir quand même (rien ne contredit) ; quand les deux en ont et diffèrent, laisser DEUX lignes. Une ligne en trop se voit ; un mélange ment.
7. Faire la réunion à l'AFFICHAGE, sur une règle pure, sans réécrire le journal : la correction vaut alors aussi pour tout l'historique, sans migration.
8. Rejouer la règle corrigée sur la totalité des données réelles et recompter : zéro paire de même contenu laissée en double, zéro paire de contenu différent réunie.

## Vérification

Tests de la règle pure, avec des entrées fabriquées : (a) trois événements enchaînés A1 B1 A2 B2 A3 B3 → trois lignes, chacune avec son intitulé ET son résultat ; (b) séquence croisée A1 A2 B1 B2 → deux lignes justes ; (c) A et B de contenus différents → deux lignes ; (d) même contenu écrit sous l'enveloppe d'une source et dans un autre ordre de clés → une ligne ; (e) événement isolé dont B arrive longtemps après A → une ligne.
Puis le rejeu sur données réelles (lecture seule) : compter avant/après, et vérifier un cas connu ligne à ligne. Sur Beluga (carte aeb60635, commit 9c243500) : 11 162 paires de texte égal, 48 rattrapées par la forme canonique, 50 différentes qui étaient toutes des appels croisés retrouvant leur moitié.

## Pièges

— Une source peut envelopper le contenu (`{"name":…,"args":{…},"toolCallId":…}`) : reconnaître l'enveloppe par un champ qui lui est propre, sinon un vrai paramètre nommé `args` serait déballé à tort.
— Garder, dans la ligne réunie, le contenu de la source la plus proche de l'origine (sans enveloppe), le résultat de celle qui l'a vraiment reçu.
— Ne pas resserrer la fenêtre de temps pour « éviter les mélanges » : c'est l'identité qui les évite, la fenêtre ne fait que borner.
— Deux événements strictement identiques et simultanés ne se distinguent pas par leur contenu : l'ordre « la plus ancienne d'abord » les apparie proprement.

## Ce qui ne marche pas

— Empêcher la fusion « si le voisin a déjà un résultat » : règle le cas des questions, pas celui des appels croisés ni des traces sans résultat.
— Comparer les textes bruts : sous-fusionne dès qu'une source reformate.
— Corriger les données en base : inutile quand la réunion est une règle d'affichage, et dangereux pour un journal qui fait foi.
