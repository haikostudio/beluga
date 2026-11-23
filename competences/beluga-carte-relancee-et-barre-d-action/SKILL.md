---
name: beluga-carte-relancee-et-barre-d-action
description: À utiliser dès qu'on touche à ce qui arrive quand on ÉCRIT à une carte de Beluga dont le travail est fini OU en cours (carte « À déployer » relancée par un message, carte « Archivé » déjà en ligne qui ouvre une nouvelle carte, message écrit pendant le travail qui repasse par la compréhension, simple question à laquelle l'agent répond), ou à la rangée de boutons au-dessus du champ d'écriture du tiroir d'une carte (« Déployer », « Terminer la tâche », « Valider et lancer », « Lancer », les réglages de l'agent COLLÉS en moitié droite du bouton principal, le résumé « Traité par … » sous « Déploiement ») : « un message écrit pendant le travail part directement au travail sans compréhension », « le bouton de fin de tâche s'affiche pendant la réflexion », « la carte reste dans À déployer alors que l'agent réfléchit », « la carte ne revient pas dans À déployer après une simple question », « l'étape Travail reste ouverte en haut après une question », « le lot à publier se vide quand je pose une question », « le bouton Déployer n'ouvre pas la fenêtre de mise en ligne », « Lancer ne dit pas le modèle », « les réglages de l'agent sont détachés du bouton », « écrire sous une carte archivée demande encore un accord », « la nouvelle carte se lance toute seule ».
etat: active
themes: cartes, interface, tests
symptomes: message écrit pendant le travail exécuté sans compréhension ni mémoire, bouton « Déployer » affiché pendant « Réflexion en cours », carte restée dans « À déployer » sous un agent qui réfléchit, carte relancée qui ne revient pas au lot après une simple réponse, étape « Travail » restée ouverte en haut d'une carte « À déployer » après une question, points Travail et Rapport vides annoncés sous la dernière demande d'une carte rangée, « La carte attend la prochaine mise en ligne » affiché pendant une nouvelle compréhension, espace client qui annonce « travail terminé » sans travail, ancien bouton « Actions de la tâche » attendu par un contrôle, icône des réglages dans la barre d'écriture d'une carte, icône des réglages détachée au bout de la rangée, carte en ligne sans dire quel agent l'a traitée, barre « Ouvrir une nouvelle carte / Annuler » au-dessus du champ, nouvelle carte née d'une carte archivée qui démarre seule, message perdu après création de la nouvelle carte
projets: Beluga
---

# beluga-carte-relancee-et-barre-d-action

## Symptôme

Une carte finie reçoit un message. On attend qu'elle se comporte comme une carte en cours de compréhension : colonne « Demande », geste « Valider et lancer » éteint, aucun bouton de fin de tâche ni « Déployer ». Si l'un de ces trois points manque, ou si une simple question laisse la carte hors du lot à publier, c'est cette mécanique qui est en cause. Depuis le 06/11/2026, un message écrit PENDANT le travail suit le même chemin à la fin du tour de tâche : il ne part plus à l'agent de tâche. Quand le cadrage n'a fait que RÉPONDRE, la carte revient dans « À déployer » avec « Terminer la tâche » à la place de « Déployer » et l'étape Travail du haut ouverte ; un clic referme l'étape et « Déployer » revient. Une carte « À déployer » au repos (sans question) porte UN seul bouton « Déployer » (sans liste) et un rapport rendu « Terminer la tâche » en bouton direct. Sur toute carte, les réglages de l'agent sont la MOITIÉ DROITE COLLÉE au bouton principal de la rangée (décision du 21.10.2026) ; une carte en ligne n'a plus de rangée et dit sous « Déploiement » quel agent l'a traitée. Depuis le 23/11/2026, une carte « Archivé » DÉJÀ EN LIGNE ne se rouvre pas : l'envoi d'un message y crée d'office une nouvelle carte, dont le champ reçoit le message et ses pièces, sans aucun envoi ni barre d'accord.

## Cause

Deux repères sur le parcours, jamais la colonne seule :
- `parcours.cadrageRouvertA`, la date de réouverture du cadrage. `cadrageRouvertApresRapport(carte)` (colonne d'avant travail ou `to_deploy`, ET repère posé) dit « carte relancée ». Il pilote l'agent affiché (card-panel), le chapitre (`chapitreDuParcours` rend `cadrage`/`plan`), le geste (`valider-et-lancer`), la retenue de l'ordonnanceur et du déploiement automatique, et la rangée de boutons.
- `parcours.iterationOuverteA` (20.10.2026), posé quand une relance n'a fait que répondre et revient au lot. `iterationAFermer(carte)` (`to_deploy`, pas relancée, repère posé) dit « l'étape Travail attend son Terminer la tâche ». Absent = fermé : c'est le cas de toutes les cartes d'avant.
Un écran ou une règle qui ne regarde que la colonne se trompe sur l'une ou l'autre.
Pour un message écrit PENDANT le travail : la colonne est `running`, `messageDeLaCarteVaAuCadrage` est faux, le message s'empile dans la file de l'agent de tâche — c'est la fin du tour de tâche qui le renvoie au cadrage (`demandesARemettreAuCadrage`).
Pour une carte EN LIGNE (`messageOuvreUneNouvelleCarte` : `archived` + `deployedAt`) : rien ne se rouvre, une carte neuve naît (DEC-279 v3).

## Procédure

1. Lire `shared/src/relance-apres-rapport.ts` en entier : toutes les règles pures de la relance y sont (dont `iterationAFermer`, `demandesARemettreAuCadrage`, `messageOuvreUneNouvelleCarte`, `TEXTE_ACCORD_NOUVELLE_CARTE`), avec l'historique en tête.
2. Le chemin d'un message : `server/src/ws.ts` (`agent.prompt`) refuse d'abord une carte en publication, puis `messageOuvreUneNouvelleCarte` (étape 2 bis), puis `messageDeLaCarteVaAuCadrage` → `rouvrirLeCadrage` (`server/src/cadrage.ts`). Celui-ci rend l'agent unique de la carte au cadrage (`agentDeLaCarteRenduAuCadrage` : même id, rôle `cadrage`) et, dans UNE écriture, pose la carte en `planned`, date `cadrageRouvertA` (date gardée si elle existe) et efface `iterationOuverteA`.
2 bis. CARTE DÉJÀ EN LIGNE (23/11/2026, DEC-279 v3, carte « Relance d'archive, arbre et panneau droit ») : le champ (`composer.tsx`, `ouvreUneNouvelleCarte`, hors `estAgentDeVolet`) envoie directement avec `ouvrirNouvelleCarte: true` — plus de barre d'accord. ws.ts refuse encore un envoi sans le drapeau (`TEXTE_ACCORD_NOUVELLE_CARTE`, « rechargez la page »), agents attitrés exemptés. `ouvrirUneNouvelleCarteDepuis` (cadrage.ts) : createCard (`planned`, cadrage) + `ouvrirLeCadrage` + note à proposition acceptée sur l'ancienne carte + anti-doublon 60 s, puis `poserLeBrouillonDeLaNouvelleCarte` écrit `draft.<agent de cadrage>` et `draftAttachments.<agent>` (objets pièce complets, lus par `store.getAttachment`) et émet `prefs` partiel. AUCUN `sendPrompt` : rien ne démarre. Le client vide son champ, reçoit `nouvelleCarteId` et ouvre la carte, dont le champ lit déjà le brouillon (l'événement `prefs` part avant la réponse).
3. MESSAGE ÉCRIT PENDANT LE TRAVAIL (06/11/2026, DEC-245 v5, commit cf50f512) : à la fin d'un tour de TÂCHE abouti (ni reprise, échec, panne définitive, arrêt, fermeture d'autorité, ni question ouverte), `server/src/runtime.ts` retire de la file les messages HUMAINS (`demandesARemettreAuCadrage` : ni silencieuse, ni poursuite, ni repriseDe, ni messageId ; aucune si une demande est en modification ; jamais pour un agent de volet) AVANT la porte de la charte et la fermeture de la carte. Si la porte renvoie l'agent corriger, ils sont ré-empilés derrière ce renvoi. Sinon `remettreAuCadrage(cardId, demandes)` (délai 500 ms, import tardif de `cadrage.js`), appelé JUSTE AVANT `enchainerLaFile(agent.id)` qui doit rester la dernière ligne (test `envoyer-maintenant`), rouvre le cadrage et lui envoie chaque message dans l'ordre. Le champ d'un agent de tâche sur carte affiche « L'agent travaille — votre message repassera par la compréhension à la fin… » (cinq langues).
4. La fin du tour de cadrage (`server/src/runtime.ts`, bloc « UNE RELANCE QUI N'ÉTAIT QU'UNE QUESTION RENVOIE LA CARTE AU LOT ») applique `colonneApresReponseSansCadrage` seulement si : tour abouti, aucune question `ask_user` ouverte, AUCUNE demande en file pour l'agent. Elle remet alors `to_deploy`, efface `cadrageRouvertA`, POSE `iterationOuverteA: Date.now()`, et écrit avec `saveCard(carte, { retourSansTravail: true })`.
5. Une compréhension, un plan rendu ou demandé, ou un incident postérieurs au repère RETIENNENT la carte en « Demande » : elle attend son clic (`relanceRetenueAvantLancement`). Deux sorties seulement la laissent partir seule : une reprise armée (`scheduling.reprendreDesQuePossible`), ou un départ daté ACCORDÉ (`departDeRelanceAccorde`). L'ordre complet des refus de la boucle de départ est dans beluga-depart-automatique-d-une-carte. Le lancement efface les deux repères (`server/src/scheduler.ts`).
6. La rangée du tiroir (`BarreDAction`, `web/src/components/parcours-carte.tsx`) lit `barreEnFinDeTache({ carte, chapitre })` et `lotDeployableDepuisLaCarte(carte) && !iterationAFermer(carte)`. EN FIN DE TÂCHE : carte « À déployer » = UN bouton « Déployer » (`BoutonDeployerLeLot`, `data-geste="deployer-lot"`), éteint avec sa raison ; rapport rendu = « Terminer la tâche » direct. Jamais de « Déployer » sur une carte relancée.
7. LES RÉGLAGES DE L'AGENT (MEM-5438) : `IconeDesReglages` (repères `data-reglages-du-lancement`, `data-raccourci-reglages`, `data-reglages-colles`) est la MOITIÉ DROITE du PREMIER bouton de la rangée, prop `colle` = ton du bouton, jour d'un pixel, groupe `[data-groupe-reglages]` posé AVANT « Auto » + horloge ; jamais détaché en bout de rangée. Le menu vient de chat.tsx (`menuReglagesCarte`). Le résumé « Traité par … » (`ResumeDeLAgent`, `data-resume-agent`) se pose dans `PointDeDeploiement` et lit l'agent d'exécution réel.
8. ITÉRATION D'UNE SIMPLE QUESTION : `gesteCalcule` rend `terminer` quand `iterationAFermer` ; `card.finish` (branche `iterationAFermer`) efface seulement le repère, sans déplacement ni `doneAt`/`deployedAt`. Tout déplacement à la main efface aussi le repère.
9. Barre du haut et frise (MEM-3471) : `etapeCouranteDeSuivi` rend `travail` tant que `iterationAFermer` ; `pointsDuParcours` n'appelle `avecLaSuiteDeLIteration` que si l'itération n'est pas refermée.
10. Libellés de lancement : « Valider et lancer · modèle · niveau » et « Lancer… · modèle · niveau ».
11. Toute nouvelle règle de ce genre va dans `shared/` avec son cas dans `server/src/test/relance-apres-rapport.test.ts`.

## Vérification

Depuis la copie de travail de la carte, après `NODE_ENV=development npm install --include=dev` et `npm run build` :
- `npm test` — en particulier `relance-apres-rapport.test.ts`, `envoyer-maintenant.test.ts` (la fin de tour finit par `enchainerLaFile`), `parcours-en-points.test.ts`, `reglages-carte.test.ts`, `depart-de-carte-validee.test.ts`, `espace-notifications.test.ts`, et pour la carte en ligne `nouvelle-carte-depuis-carte-en-ligne.test.ts` (aucun message au cadrage, texte et pièces dans `draft.*`/`draftAttachments.*`, anti-doublon) et `agents-de-volet.test.ts` (plus de `data-accord-nouvelle-carte`). Prouvé le 23/11/2026 : 6755/6756 (seul échec : un export mort du module de voix, hors sujet).
- `env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-cycle-de-vie-carte.mjs` — 56/56 le 23/11/2026. Le renvoi d'un message écrit pendant le travail et la création depuis une carte en ligne n'y sont PAS rejoués de bout en bout.
- `env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-pied-du-tiroir.mjs`, `verif-reglages-colles-au-bouton.mjs`, `verif-plan-replie-et-programmation.mjs`.
- `HAIKO_LANGUES_URL=… node scripts/verif-langues.mjs` pour les textes du champ.
Preuves : carte 9b8b6224 (175cd07f) ; 0c5d72df ; ba51a59d ; 6302fe73 ; 6d55407f ; cf50f512 (06/11/2026) ; a18f6498 (23/11/2026, carte relance d'archive).

## Pièges

- Un second message écrit pendant un tour de CADRAGE ne repasse pas par `rouvrirLeCadrage` : il attend en file et part à la fin du tour. Sans la garde « demande en file », la carte retournait au lot entre les deux.
- Pendant un tour de TÂCHE, c'est l'inverse : le message humain en file ne doit PAS lui être remis — il repart au cadrage.
- La porte de la charte (`porteDeFinDeTour`) exige une file VIDE : l'extraction des messages humains doit la précéder, et ils se ré-empilent si elle renvoie l'agent corriger.
- `rouvrirLeCadrage` ne doit partir qu'une fois le tour de tâche éteint (`isRunning` faux), sinon `agentDeLaCarteRenduAuCadrage` crée un second agent : d'où le délai de 500 ms.
- `saveCard` prévient l'espace client à chaque changement de colonne : un retour `planned` → `to_deploy` sans travail doit porter `retourSansTravail`.
- `card.finish` générique DÉPLACE la carte : sur une carte à itération ouverte, c'est la branche `iterationAFermer` qui répond.
- `relance-apres-rapport.test.ts`, `envoyer-maintenant.test.ts`, `agents-de-volet.test.ts` et `nouvelle-carte-depuis-carte-en-ligne.test.ts` relisent le source par expression régulière : renommer une variable (`ouvreUneNouvelleCarte`, `carteDuChamp`) ou ajouter une ligne après `enchainerLaFile(agent.id);` casse le test.
- Le brouillon des pièces jointes (`draftAttachments.<agent>`) contient des OBJETS pièce, pas des identifiants : la commande `agent.prompt` n'envoie que les ids, le démon doit relire chaque pièce.
- La carte neuve née d'une carte en ligne a son agent de cadrage mais aucun message : ne jamais y rajouter un `sendPrompt` « pour démarrer » — c'est précisément ce que l'utilisateur a refusé.
- `CarteRelancable` a des champs tous optionnels : y déclarer tout repère nouveau du parcours.
- Une carte FILLE d'un projet réuni entraîne sa carte MÈRE.
- `parcours.comprehensionValidee` reste écrit après le travail livré : comparer sa date à `cadrageRouvertA`.
- Une copie témoin dans `/tmp` avec `node_modules` en lien symbolique lit le `shared/` construit de l'origine.
- Des contrôles sans lien échouent déjà (`verif-langues.mjs`, `verif-themes.mjs` sur d'autres écrans) : comparer avant de parler de régression.

## Ce qui ne marche pas

- Remettre au travail un message écrit pendant le tour de tâche (avant le 06/11/2026).
- Attendre le rendu de la compréhension pour déplacer la carte (21.09.2026).
- Déplacer la carte dès le message sans jamais la ramener (16.09.2026).
- Décider l'affichage sur la seule colonne dans le composant.
- Retenir TOUTE carte relancée jusqu'au clic, même datée et validée après sa réouverture.
- Le tiroir « Actions de la tâche » : retiré le 15.10.2026.
- Les réglages dans la barre d'écriture, puis l'icône détachée au bout de la rangée : remplacées le 21.10.2026.
- Sous une carte en ligne : la barre d'accord « Ouvrir une nouvelle carte / Annuler » puis l'ENVOI du message au cadrage de la nouvelle carte (jusqu'au 23/11/2026) — un clic de trop, et un tour lancé sans que l'utilisateur ait relu.
