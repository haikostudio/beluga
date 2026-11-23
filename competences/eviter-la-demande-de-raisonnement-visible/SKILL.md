---
name: eviter-la-demande-de-raisonnement-visible
description: À utiliser dès qu'une demande à Claude Opus 5.5 est refusée alors qu'elle passait sur un modèle plus ancien, avec « refusal », « reasoning_extraction » ou « safeguards flagged the message », et avant d'écrire une consigne système, un fichier d'instructions ou une compétence qui demande au modèle de « montrer sa réflexion ». Dit comment retrouver les lignes fautives, les réécrire et voir le raisonnement autrement. Fait daté de septembre 2026, à revérifier.
etat: active
themes: agents, moteur, methode, consignes
symptomes: refus reasoning_extraction, stop_reason refusal, safeguards flagged the message, la même consigne passait avant sur un autre modèle, consigne demandant de montrer son raisonnement
---

# eviter-la-demande-de-raisonnement-visible

## Symptôme

Une consigne qui marchait sur d'anciens modèles est refusée sur Opus 5.5 : côté API, la réponse s'arrête avec stop_reason « refusal » et la catégorie reasoning_extraction ; dans Claude Code, une erreur dit que les protections ont signalé le message.

## Cause

Selon le guide de septembre 2026 (qui cite le guide officiel d'Anthropic), Opus 5.5 ajoute un contrôle de sécurité : une demande qui pousse le modèle à reproduire son raisonnement interne dans le texte de la réponse peut être refusée. Ce refus-là n'est pas rejoué sur un autre modèle : le repli serveur le renvoie tel quel. La raison de ce contrôle n'est pas donnée par le guide.

## Procédure

À revérifier sur platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5 (rubriques « Safeguard refusals » et « Prompts written for thinking disabled »).
1. Chercher toute ligne qui demande d'écrire son raisonnement ou de montrer sa réflexion dans la réponse : fichier d'instructions du projet, compétences, consignes d'agents, consignes système d'une application. Invite du guide : « Cherche dans mon CLAUDE.md, mes compétences, mes agents et mes consignes système toute instruction qui te demande d'écrire ton raisonnement ou de montrer ta réflexion dans ta réponse. Liste chacune avec son fichier et sa ligne, propose une réécriture qui ne demande que le résultat. Ne change rien tant que je n'ai pas dit oui. » Commande de repérage : grep -rIn -i -E "raisonnement|reasoning|montre ta réflexion|think out loud|show your (reasoning|thinking)" sur ces dossiers, puis trier à la main (un champ « raisonnement » de formulaire n'est pas une demande de réflexion).
2. Lister les lignes trouvées avec fichier et numéro, sans rien modifier avant accord. Un fichier d'instructions de projet dont la règle dit de ne pas le toucher (comme celui de Beluga) se corrige par le fichier d'attente prévu, pas directement.
3. Réécrire pour demander le RÉSULTAT seul (« donne la conclusion et les preuves », « liste ce qui a changé »), sans « explique étape par étape comment tu as réfléchi ».
4. Pour voir malgré tout comment le modèle a raisonné sur l'API : régler thinking.display sur « summarized » et lire le résumé dans les blocs de réflexion, plutôt que de le demander dans le texte de la réponse.
5. Rejouer la même demande.

## Vérification

La demande qui était refusée repasse, sans « refusal » ni catégorie reasoning_extraction. Le repérage relancé ne montre plus aucune consigne qui demande d'écrire la réflexion dans la réponse. Sur l'API, le résumé de réflexion se lit dans les blocs de réflexion quand thinking.display vaut « summarized ».

## Pièges

- Ce point vient d'un guide tiers de septembre 2026 : nom de la catégorie, texte de l'erreur et option thinking.display sont à relire dans la documentation officielle avant de les citer comme acquis.
- Un mot « raisonnement » dans le code n'est pas forcément fautif (un champ « pourquoi » d'un formulaire de mémoire n'est pas une consigne) : lire la ligne, ne pas tout supprimer en masse.
- Ne pas contourner le refus en reformulant pour obtenir la même chose : demander le résultat, pas la pensée.
- Demander une JUSTIFICATION courte d'un choix (« pourquoi cette option ? ») reste distinct de demander de recopier sa réflexion ; en cas de doute, tester sur une demande isolée.

## Ce qui ne marche pas

Supprimer au hasard des mots comme « raisonne » sans lire les lignes : on retire des consignes utiles et le refus revient par une autre ligne. Attendre un repli automatique sur un autre modèle : ce refus ne s'y prête pas.
