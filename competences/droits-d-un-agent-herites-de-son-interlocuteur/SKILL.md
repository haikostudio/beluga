---
name: droits-d-un-agent-herites-de-son-interlocuteur
description: À utiliser dès qu'une application multi-comptes donne des outils à un agent IA (lecture de données, envoi, publication, paiement) et que plusieurs personnes peuvent lui parler : « l'agent montre à un invité ce qu'il ne devrait pas voir », « un collaborateur publie par l'agent », « qui a le droit, l'agent ou la personne ? ».
etat: active
themes: agents, securite, droits
symptomes: un accès limité lit par l'agent ce que son écran lui cache, l'agent publie ou envoie sans validation, droits de l'agent plus larges que ceux de l'utilisateur
---

# droits-d-un-agent-herites-de-son-interlocuteur

## Procédure

1. Retenir l'INTERLOCUTEUR côté serveur, à chaque geste humain qui fait travailler l'agent (message, lancement, réponse à une question) — jamais déduit du texte du modèle.
2. Écrire la règle des droits en fonction PURE (rôle + grille du compte → aucun / lire / agir par service et par projet), testée seule.
3. Passer CHAQUE appel d'outil par cette règle à l'entrée du serveur d'outils, avant l'exécution.
4. Tout geste qui sort (client, réseau, paiement) devient une PROPOSITION à bouton ; le clic s'exécute avec les droits de CELUI QUI CLIQUE, pas de l'agent.
5. Interlocuteur inconnu : droit le plus étroit — mais ne pas couper d'un coup les outils dont des tâches automatiques dépendent déjà ; les restreindre seulement quand un accès limité est connu.
6. Les refus disent ce qui est fermé et pour qui, pour que l'agent le redise tel quel.

## Vérification

Un test sur base neuve : compte administrateur → l'agent écrit ; compte en lecture seule retenu comme interlocuteur → l'agent lit, son écriture est refusée avec une phrase claire, un autre projet est fermé ; geste sortant → aucune écriture avant le clic, effectué après le clic avec le compte qui clique. Exemple vivant : Beluga, carte 13d54420.

## Pièges

- Un agent unique qui « joue l'administrateur » pour ses gestes (compte de service) ré-ouvre tout à un invité : ses outils propres doivent eux aussi exiger un interlocuteur administrateur.
- Un second agent lancé par le premier (sous-tâche, atelier) doit HÉRITER de l'interlocuteur, sinon il retombe sur le droit inconnu.
- Le guide des droits mis dans la consigne doit rester stable d'un tour à l'autre (cache) : ne le faire dépendre que des droits, pas de l'heure ni du message.
