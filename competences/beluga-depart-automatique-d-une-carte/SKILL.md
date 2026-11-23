---
name: beluga-depart-automatique-d-une-carte
description: À utiliser dès qu'une carte de Beluga devrait partir TOUTE SEULE et ne part pas, ou part alors qu'elle ne devrait pas : « la carte programmée n'est pas partie à l'heure », « Dès que possible ne lance rien », « la carte relancée repart sans clic », « un lancement refusé faute de quota n'est jamais rejoué ». À utiliser aussi avant d'ajouter une condition à la boucle qui lance les cartes (`tick`).
etat: active
themes: cartes, ordonnancement, tests
symptomes: carte datée restée dans « Demande » après son heure, mention « Heure de départ atteinte » sans départ, « Dès que possible » sans effet sur une carte cadrée, carte partie sans validation, carte relancée qui repart seule
projets: Beluga
---

# beluga-depart-automatique-d-une-carte

## Symptôme

Une carte porte une heure de départ passée (ou la marque « Dès que possible ») et reste dans « Demande » : aucun message d'attente ne l'explique, et seul un clic « Lancer » la fait partir. Ou l'inverse : une carte part sans que personne ne l'ait autorisée.

## Cause

La boucle de l'ordonnanceur (`tick`, `server/src/scheduler.ts`, toutes les quinze secondes, rappelée par `card.schedule` et `card.asap`) ne lance une carte des colonnes d'avant le travail que si UNE règle pure le permet : `carteLibreDePartirSeule(card, !!agentDeCadrage(card.id))` (`shared/src/parcours-carte.ts`). Elle enchaîne quatre refus, dans cet ordre :

1. la suspension à la main (`scheduling.suspendu`) ;
2. l'autorisation (`demarrageAutomatiqueAutorise`, `shared/src/suivi-colonne.ts`) : reprise armée, heure dite venue, « dès que possible », ou carte déjà lancée (`attempts`/`restarts`) — une date À VENIR retient même une carte « dès que possible » ;
3. la relance (`relanceRetenueAvantLancement`, `shared/src/relance-apres-rapport.ts`) : une carte dont le cadrage a été rouvert après son rapport attend son clic, sauf reprise armée ou `departDeRelanceAccorde` (heure venue ET validation postérieure à `cadrageRouvertA`) ;
4. le cadrage encore ouvert (`cartePrisonniereDuCadrage`) : dernier agent de la carte en rôle `cadrage`, zéro plan, aucune `parcours.comprehensionValidee`, aucune reprise armée.

Ce n'est qu'APRÈS que viennent les portes (`checkGates` : place sur la machine, dossier, dépôt, quota, heures creuses), qui écrivent leur raison dans `scheduling.waitingReason`. Une carte retenue par la règle, elle, ne dit RIEN : c'est ce qui rend le défaut invisible.

Défaut du 04.10.2026 : le quatrième refus ne lisait que les plans, alors que le plan est facultatif. Toute carte cadrée sans plan, même validée et datée, était sautée à chaque passage.

## Procédure

1. Lire la carte en base (colonne, `scheduling`, `parcours`) et le rôle de son DERNIER agent (`agentDeCadrage` ne rend que le dernier agent de la carte, s'il est en rôle `cadrage`). Appliquer les quatre refus à la main : le premier qui rend « non » est la cause.
2. Si la règle rend « libre », regarder `scheduling.waitingReason` : c'est une porte de `checkGates`, pas la règle.
3. Toute nouvelle condition de départ s'écrit dans `shared/` (dans `carteLibreDePartirSeule` ou dans l'un de ses quatre prédicats), jamais en ligne dans `tick` : la boucle n'est pas testable seule, la règle l'est.
4. Ajouter son cas dans `server/src/test/depart-de-carte-validee.test.ts` (règle seule, puis vraie carte en base avec `validerLaComprehension`, `programmerLeDepart`, `agentDeCadrage`).
5. Pour prouver un départ RÉEL, ajouter une scène à `scripts/verif-cycle-de-vie-carte.mjs` : il monte son propre démon avec un faux moteur, et la vraie boucle y tourne. Les commandes `card.schedule` et `card.comprehension.validate` s'y envoient par `commande(...)`.
6. La validation vaut pour la CARTE : une compréhension affinée après la validation ne retient pas une carte datée, elle part avec `card.parcours.comprehension` (la dernière). Ne pas brancher `comprehensionValideePourLaVersionCourante` dans la règle de départ : ce prédicat sert au bouton de l'écran et au figement des réglages.

## Vérification

Depuis la copie de travail de la carte, jamais depuis le dépôt principal, après `NODE_ENV=development npm install --include=dev` et `npm run build:server` :
- `npm test` — en particulier `depart-de-carte-validee.test.ts`, `depart-programme.test.ts`, `relance-apres-rapport.test.ts`, `pause-apres-analyse.test.ts`.
- `env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-cycle-de-vie-carte.mjs` — section 13 : la carte datée sans validation reste en « Demande » ; validée, elle part seule, sans plan et sans clic ; la date est consommée. Compter six minutes.
Preuves : carte « Départ programmé non déclenché », commit 0c5d72df (branche tache/depart-programme-non-declenche-c32fcb) : 4242/4242 tests, 47/47 au contrôle de cycle de vie.

## Pièges

- `asap` n'est PAS effacé au départ, `departPrevu` l'est (`lancerLaCarte`). Sur une carte relancée, seule la date prouve donc un geste récent : c'est pourquoi `departDeRelanceAccorde` ignore `asap`.
- `parcours.comprehensionValidee` reste écrit après le travail livré : sur une carte relancée, comparer sa date (`at`) à `cadrageRouvertA`, jamais sa seule présence.
- Au lancement, l'agent de cadrage passe en rôle `task` : une carte interrompue puis revenue en « Demande » n'est donc plus « en cadrage », elle reprend par ses essais passés. À la relance après rapport, le même agent REDEVIENT `cadrage`.
- Trois tests lisent le TEXTE de la boucle (`relance-apres-rapport.test.ts`, `pause-apres-analyse.test.ts`, `depart-de-carte-validee.test.ts`) : changer la ligne d'appel dans `tick` les fait tomber, les mettre à jour dans le même enregistrement.
- La proposition d'une décision à la mémoire peut être FUSIONNÉE dans une unité voisine et en remplacer le texte (« doublon fusionné ») : relire l'unité rendue, et la rétablir depuis `connaissance_versions` si son contenu d'origine a disparu.

## Ce qui ne marche pas

- Exiger une validation de la version COURANTE de la compréhension pour laisser partir une carte datée : écarté par l'utilisateur, la carte doit partir à l'heure avec la dernière version.
- Libérer une carte sur sa seule date : une carte jamais validée, portant une date posée avant la règle, partirait sans accord.
- Tester en appelant `tick()` depuis un test du démon : la boucle enchaîne les portes, l'ouverture d'une copie de travail git et un vrai moteur. Le départ réel se prouve dans le contrôle à démon jetable.
