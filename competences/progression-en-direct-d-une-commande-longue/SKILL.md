---
name: progression-en-direct-d-une-commande-longue
description: À utiliser dès qu'un bouton d'une application temps réel lance une commande serveur qui dure (création, import, clonage, attente DNS) et que l'écran ne montre qu'une roue : « on a l'impression que ça bug », « ça prend plus de temps que prévu », « je ne sais pas ce qui se fait ». Dit comment afficher une liste d'étapes prévues cochée en direct sans jamais mentir.
etat: active
themes: temps-reel, interface, chargement
symptomes: roue muette pendant une longue commande, message de lenteur qui inquiète, utilisateur qui reclique, étape affichée qui ne se coche jamais
---

# progression-en-direct-d-une-commande-longue

## Procédure

1. Une règle PURE, partagée client et serveur, donne la liste des étapes PRÉVUES (clés stables + titres) à partir des options de la commande — la même source pour les titres des deux côtés.
2. Au clic, l'écran tire un identifiant de suivi, l'envoie avec la commande, et pose aussitôt la liste prévue, la première étape « en cours ».
3. Le serveur tient un carnet : « commencer(clé) » avant une étape longue, « noter(clé, issue, détail) » après ; chaque appel pousse l'état ENTIER (étapes notées + étape en cours) par le canal temps réel, adressé au seul demandeur.
4. L'écran n'accepte que les événements de SON suivi, tant que la commande n'est pas finie ; la réponse finale remplace tout.
5. Couper l'avertissement générique de lenteur pour ce bouton (la liste le remplace), mais garder le message d'échec réel (délai dépassé, refus).
6. Placer la liste juste au-dessus du bouton et faire défiler la fenêtre pour la garder visible.

## Vérification

Un contrôle navigateur qui intercepte la commande dans le canal, injecte des événements de progression à la main (dont un d'un autre suivi), attend au-delà du seuil de lenteur, puis injecte la réponse finale avec un échec : la liste paraît au clic, se coche dans l'ordre, ignore l'autre suivi, n'affiche aucun avertissement, et finit sur l'échec avec sa cause.

## Pièges

- Pousser des deltas : un événement perdu (reconnexion, autre onglet) laisse une ligne fausse. Pousser l'état entier.
- Titres écrits deux fois (écran et serveur) : ils divergent et une ligne ne se coche jamais.
- Une condition de prévision différente de celle du serveur (ex. champ facultatif à moitié rempli) : ligne « à venir » éternelle.
- Un rappel de progression qui lève une erreur ne doit jamais casser la commande elle-même.
- Une réussite totale qui ferme la fenêtre instantanément cache la dernière coche : une demi-seconde suffit.
