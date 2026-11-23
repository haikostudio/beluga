---
name: travaux-lourds-retenus-quand-la-memoire-manque
description: À utiliser dès qu'un service Node (ou tout démon) sur un petit serveur Linux partagé se FIGE des dizaines de secondes sans être tué (aucun « Killed process »), pendant qu'il lance lui-même des travaux lourds — constructions (nuxt/next build, npm ci), exports vidéo (ffmpeg, Chrome), serveurs d'essai, navigateurs, modèles locaux (ONNX, transformers) — ou avant d'ajouter un tel travail : comment mesurer la vraie pression mémoire, retenir ces travaux par une attente bornée et dite, et arrêter un calcul de modèle abandonné.
etat: active
themes: serveur, memoire, performance, linux
symptomes: serveur figé sans OOM, sonde de santé muette 25 à 60 s, fichier d'échange plein, swap à 100 %, démon qui gèle pendant une construction, modèle local toujours trop lent, calcul qui continue après le délai
---

# travaux-lourds-retenus-quand-la-memoire-manque

## Symptôme

La sonde de santé reste muette 25 à 60 s, puis le service repart tout seul ; le noyau n'a tué personne. À ce moment, la mémoire vive est à 95–98 % et le fichier d'échange plein, et un travail lourd venait de partir (construction, export vidéo, serveur d'essai, modèle local).

## Cause

Ce n'est pas une panne du code : le service, relégué en partie dans le fichier d'échange, attend le disque à chaque page touchée. Une porte qui ne regarde que le remplissage instantané (ou que le lancement des tâches principales) laisse passer les travaux secondaires, qui font la pression. Un modèle local appelé avec un délai côté appelant continue de calculer après l'abandon si on ne l'arrête pas dans son processus : sous pression, il dépasse toujours et brûle le processeur pour rien.

## Procédure

1. Mesurer ce qui compte : `/proc/meminfo` (part prise sur `MemAvailable`, part du fichier d'échange), `/proc/pressure/memory` (ligne `some`, `avg10` : la part du temps où une tâche a attendu la mémoire ; ~2 au calme, 50–99 pendant un gel). Le débit d'échange (`pswpin`+`pswpout` de `/proc/vmstat`) demande deux mesures espacées d'au moins 5 s.
2. Une RÈGLE PURE (testable sans machine) : suspendre si mémoire > ~94 %, ou échange > ~85 % avec mémoire > ~80 %, ou pression `some avg10` ≥ ~20.
3. Tout travail lourd passe par UN point commun (file des travaux lourds, étape de construction, garde des commandes d'un agent) qui appelle une attente : machine libre → part sans un mot ; sous pression → dit UNE phrase stable (sans chiffre ni compte à rebours), relit toutes les ~10 s, part dès que la place revient, et au bout d'une attente BORNÉE (quelques minutes) part QUAND MÊME en le notant au journal. Jamais de blocage sans fin : une publication ou une vérification ne doit pas mourir d'une machine pleine.
4. Pour un agent qui lance des commandes : le crochet d'avant-commande refuse le serveur d'essai sous pression avec la phrase qui dit quoi faire en attendant, et garde l'instant du PREMIER refus (fichier dans /tmp par dossier de travail) pour laisser passer après l'attente bornée.
5. Modèle local dans un processus fils : une seule demande en vol (une concurrente rend « pas de résultat » tout de suite), refus avant chargement si la mémoire disponible est sous le poids du modèle, et au délai un message `{ annuler: id }` lu HORS de la file du fils, vérifié entre deux lots. Ne pas tuer le fils : le recharger coûte plus cher.
6. Faire écrire au surveillant, à chaque silence, les comptes de ce qui se multiplie (essais, navigateurs, constructions) et la mémoire + l'échange par groupe systemd (`memory.current`, `memory.swap.current`) : le coupable se lit d'un coup d'œil.

## Vérification

Tests de la règle pure (libre → partir, pleine → attendre, au-delà du plafond → forcer ; phrase sans chiffre) ; test de l'attente avec une lecture imposée et des délais courts (dite une fois, bornée, coupée par un signal d'arrêt) ; test du modèle avec un faux modèle lent (« @essai ») : un tri sous pression ne charge rien, un second en vol rend vide, un tri au délai confirme son arrêt avant la fin. En vrai : passer une commande de serveur d'essai au crochet sur la machine (code 2 et la phrase si elle est pleine, 0 sinon). Après mise en ligne : compter les silences et les gels sur 24 h contre la référence d'avant.

## Pièges

- Charger un modèle pour le MESURER sur une machine pleine provoque le gel qu'on enquête : regarder `MemAvailable` d'abord.
- Une section de relevé qui cherche un processus par sa ligne de commande se trouve elle-même (le `bash -c` contient le texte) : filtrer sur le nom court du processus.
- Le fichier d'échange plein SEUL ne dit rien (pages froides rangées) : il ne compte qu'avec une mémoire vive déjà tendue.
- Un plafond de mise en attente sans départ forcé finit par bloquer une mise en ligne pour de bon.
- Une phrase d'attente avec un compte à rebours change à chaque relecture et se répète dans le fil : la dire une fois, stable.
