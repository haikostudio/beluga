---
name: beluga-suspension-et-reprise-d-une-tache
description: À utiliser dès qu'on touche au bouton « Suspendre » / « Reprendre » d'une carte de Beluga, à ce que la fin d'un tour coupé écrit au journal, ou aux alertes d'une tâche arrêtée : « une suspension affiche Agent en échec », « l'étape Rapport s'allume après une suspension », « le bouton du bas dit Actions de la tâche sur une tâche suspendue », « Je passe à tour arrêté en rouge », « Reprendre renvoie toute la demande », ou avant de « corriger » une carte suspendue restée en « En cours » (c'est voulu).
etat: active
themes: cartes, interface, alertes
symptomes: toast Agent en échec après Suspendre, toast Agent suspendu, étape Rapport avec triangle sur une tâche suspendue, encadré Des étapes n’ont pas été faites après une suspension, bouton Actions de la tâche sur une carte en pause, ligne rouge Je passe à « tour arrêté », code 143 dans le journal
projets: Beluga
---

# beluga-suspension-et-reprise-d-une-tache

## Symptôme

Après « Suspendre », la tâche s'affiche comme une panne : alertes rouge et grise, ligne rouge dans le fil, étape « Rapport » marquée, bouton de fin de tâche. Ou bien « Reprendre » relance la carte comme un premier départ.

## Cause

Une suspension (DEC-372) laisse la carte en « En cours » avec `scheduling.suspendu` + `scheduling.enPause` (`carteEnPause`, shared/src/arret-carte.ts). Tout ce qui ne lit pas ces marques la prend pour un tour tombé : la coupe (SIGTERM, code 143) rend `failed`, le jalon de fin tombait sous la phase `rapport`, le chapitre d'une carte « En cours » sans tour vivant valait `rapport`, et l'agent `stopped` rendait `tourNonAbouti` vrai.

## Procédure

1. Fin de tour (server/src/runtime.ts) : `suspendu = runState.stopping && carteEnPause(carte.scheduling)` est passé à `jalonDeFinDeTour` (shared/src/issue-de-tour.ts), qui rend JALON_TOUR_SUSPENDU, phase `execution`, `reussie: null`, résultat TEXTE_TOUR_SUSPENDU. Le jalon s'écrit sous `issue.phase`.
2. Alertes : `onComplete(text, ok, mesure, fin)` reçoit `fin.arretDemande` ; le scheduler ne dit « Agent en échec » que hors arrêt demandé et hors pause ; runtime ne notifie `tache-echec` que si `!runState.stopping` ; `agent.suspend` (ws.ts) ne toaste que si rien n'a été suspendu.
3. Fil : genre de bloc `suspension` (recit-du-tour.ts, icône Pause dans icone-du-point.tsx), phrase `Tâche suspendue à la main à {v0}.` (phraseDuBloc, heure locale), traduite dans traductions.ts.
4. Parcours : `chapitreDuParcours` rend `travail` pour running + enPause sans tour vivant ; `gesteCalcule` rend `reprendre` (+ `terminer` en second) ; `tourNonAbouti` rend faux ; `pointsDuParcours` reçoit `enPause` (chat.tsx) et pose le point Travail en `avenir` avec PHRASE_TRAVAIL_SUSPENDU.
5. Bouton : dans parcours-carte.tsx, « Reprendre » sur une carte en pause envoie `agent.prompt` + MESSAGE_DE_REPRISE à l'agent de la carte ; `replacerCarteAuDemarrage` lève les marques au tour suivant.
6. Deux gestes distincts, à ne jamais confondre : « Suspendre » (bouton de la carte) = pause, la carte RESTE en « En cours » ; `agent.stop`, « tout arrêter » et la sortie de la carte à la souris = arrêt, la carte revient en « Planifié ». DEC-372 remplace DEC-041 et rend MEM-0501 caduque (carte « Règles d'arrêt remises d'accord avec « Suspendre » »).

## Vérification

Depuis la copie de travail de la carte, après `npm run build` : `npm test` (issue-de-tour, parcours-carte, parcours-en-points, suspendre-carte, phrases-du-recit) puis `env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-arret-carte.mjs` : « aucune alerte après la suspension », « le bouton du bas devient « Reprendre » », « pas de bouton de fin de tâche ». Preuves : carte e815f8e9, commits 90fe66a8 et 8eb5cd59 (branche tache/defilement-du-fil-et-suspension-discrete-e815f8).

## Pièges

- La suspension passe AVANT « rapport déjà écrit » dans jalonDeFinDeTour : le texte partiel d'un tour coupé dépasse souvent 400 signes et passerait pour un compte rendu.
- `carteEnPause` exige les deux marques : `enPause` restée seule (vue sur d'anciennes cartes) ne vaut rien, le bouton ne repasse donc pas à « Reprendre » pendant un tour repris.
- Les agents factices de verif-arret-carte n'ont pas de vrai moteur : la coupe passe par le chemin de secours (`refermerLeTour`), pas par la fin de tour normale — le jalon neutre se prouve par les tests unitaires.
- Le point « Rapport » à venir (gris) reste affiché pendant tout travail : c'est l'échafaudage normal, pas un rapport allumé.
- Un motif de phrase de récit doit parler à la première personne (test phrases-du-recit) : les formes génériques du genre `suspension` disent « Je m’arrête : vous avez suspendu la tâche. ».
- Une carte suspendue affichée en « En cours » n'est PAS un bug : la règle « une carte suspendue ne reste jamais affichée En cours » ne vise que `suspendu` SANS `enPause`.

## Ce qui ne marche pas

- Relancer par `client.demanderLeLancement` : `lancerLaCarte` ne reconnaît pas une reprise en « En cours » (carteSeReprend exige une colonne d'avant travail) et renverrait toute la demande de la carte.
- Garder le jalon « Tour arrêté » sous la phase `rapport` : l'étape Rapport s'allume sur une carte encore au travail.
