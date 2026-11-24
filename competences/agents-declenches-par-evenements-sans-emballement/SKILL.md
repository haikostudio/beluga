---
name: agents-declenches-par-evenements-sans-emballement
description: À utiliser dès qu'une application laisse des agents IA travailler SEULS sur déclencheur — à heure fixe, sur un événement d'un service (nouvelle demande, panne, mise en ligne), ou sur une surveillance — et qu'il faut borner leur dépense et leurs gestes : « l'agent tourne en boucle », « une rafale d'événements a lancé dix tours », « après un redémarrage il est passé deux fois », « il a envoyé au client sans accord », « la limite de dépense n'arrête rien ».
etat: active
themes: agents, consignes, finances
symptomes: l'agent tourne en boucle, une rafale d'événements lance plusieurs tours, un passage doublé après redémarrage, un passage perdu pendant un arrêt, l'agent a publié ou envoyé sans accord, la limite de dépense n'arrête rien, l'agent oublie son cadre au fil de la conversation
---

# agents-declenches-par-evenements-sans-emballement

## Procédure

1. LA FICHE FAIT FOI, HORS DE LA CONVERSATION : mission, déclencheurs, ce qu'il fait seul, ce qu'il demande, ce qu'il ne fait jamais, ce qu'il emporte (des NOMS d'accès, jamais une valeur), sa limite. Chaque tour reçoit un relais complet (consigne + fiche + dernières lignes du journal + détail de l'événement) au lieu de dépendre de l'historique.
2. DES GESTES VERROUILLÉS côté serveur, pas seulement dans la consigne : l'outil qui écrit la fiche REFUSE d'inscrire « publier, envoyer au client, payer, modifier le code, supprimer » dans ce qu'il fait seul, même si l'utilisateur le demande. Découper la phrase par action (« puis », « et », virgule) : « vérifier puis publier » cache une publication ; « préparer une réponse » reste permis.
3. L'ALLUMAGE EST LE GESTE HUMAIN : aucun passage automatique avant un clic explicite sur une fiche complète ; « lancer maintenant » est lui-même un clic.
4. UN PASSAGE À LA FOIS : poser la marque « en cours » AVANT toute attente asynchrone (choix du compte, lecture), sinon deux événements simultanés passent tous les deux. Les événements arrivés pendant un passage se FUSIONNENT en une seule suite ; ceux qui arrivent pendant la suite sont écartés — c'est ce qui casse les boucles (un agent dont le travail produit un nouvel événement ne se relance qu'une fois). Ignorer aussi l'événement dont l'agent est lui-même l'auteur.
5. LE RYTHME SE RECALCULE : à chaque tournée courte (une minute), « le dernier créneau prévu ≤ maintenant est-il postérieur au dernier passage (ou à l'allumage) ? ». Jamais un minuteur long : un redémarrage ne double pas (le passage est déjà inscrit) et ne perd pas (le créneau manqué est rattrapé une fois).
6. LA LIMITE se compte sur le journal de la période (jour, semaine, mois dans le fuseau du produit) ; atteinte : pause, UNE ligne au journal par période, signalée dans le résumé du matin.
7. LE JOURNAL ne fait que s'allonger : chaque passage, sa source, son issue (fait, à valider, panne, ignoré), ses jetons ; seule la ligne « en cours » reçoit son issue. Le résumé du matin cite ce journal, jamais une mémoire de l'agent.
8. SANS COMPTE OU SANS QUOTA, le passage attend dans une file rejouée par la tournée au lieu d'être perdu ou d'écrire une erreur dans la conversation à chaque essai.
9. LES SERVICES SIGNALENT HORS DE LEUR CHEMIN : appel sans attente et sous `catch` — une panne de l'agent ne fait jamais échouer une mise en ligne, une sauvegarde ou une demande client.

## Vérification

Tests sur base jetable avec un envoi factice : dix événements d'affilée = deux passages (le premier, une suite fusionnée) et aucun troisième ; un passage horaire dû part une fois, la tournée rejouée une minute plus tard ne le refait pas ; un agent allumé après le créneau ne le rattrape pas ; la limite atteinte refuse et n'écrit qu'une ligne ; sans compte, le passage attend puis part quand le compte revient ; un geste verrouillé est refusé par l'outil. Preuve : carte « Agents personnalisés dans les projets » de Beluga (24/11/2026), tests `agents-personnalises*.test.ts`.

## Pièges

- Une consigne seule ne verrouille rien : l'agent finit par faire ce qu'on lui demande. Le refus doit vivre dans l'outil qui écrit la fiche ou qui agit.
- Une demande d'accord (réponse préparée) posée pendant un passage peut être FERMÉE par le rangement automatique de fin de tour : vérifier qu'elle reste ouverte et visible là où l'utilisateur regarde (cloche, tableau).
- Un serveur d'essai peut trouver de VRAIS comptes de moteur sur la machine : un contrôle qui clique « Lancer » doit couper l'envoi par un garde d'environnement.
- Un minuteur de « 24 h » ou « chaque lundi » saute au moindre redémarrage : recalculer depuis le dernier passage.
