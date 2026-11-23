---
name: beluga-reparation-silencieuse-d-une-publication
description: À utiliser dès qu'on touche une étape du déroulé de publication de Beluga (déploiement ou mise en production) — ajouter une étape, un échec, un contrôle — ou devant « l'étape tombe sans être réparée », « une croix rouge pour une panne réglée », « l'encadré d'abandon est vide », « une tâche en conflit est écartée au lieu d'être réparée ».
etat: active
themes: publication, agents, deploiement
symptomes: étape en échec sans réparation, croix rouge pendant la réparation, encadré d'abandon vide, tâche en conflit écartée d'emblée, agent de réparation visible en vignette
projets: Beluga
---

# beluga-reparation-silencieuse-d-une-publication

## Procédure

1. Toute étape du déroulé (server/src/deploy.ts, `deployer` et `mettreEnProduction`) est une fonction REJOUABLE passée à `avecReparation(cle, async () => {...})` / `jouerAvecReparation(acces, project, cle, signal, jouer)` : elle se repose `running` et refait tout (réinitialiser les récits locaux en tête : `recitFusion.length = 0`…).
2. Une panne s'exprime par `arreter(cle, texte)` ou `throw new EchecDEtape(cle, texte)` — JAMAIS `setStep(..., 'failed')` direct ni `ArretDeLaPublication` (réservée à l'arrêt demandé et à l'abandon final).
3. La boucle : `decisionDeReparation` (shared/src/reparation-publication.ts) → `tourDeReparation` (server/src/reparation-publication.ts : choisit le moteur, crée l'agent `role: 'deploy'` marqué `reparationPublication`, envoie `demandeDeReparation` en motif `depannage`, attend, lit le verdict de l'outil `rendre_reparation`) → rejeu. Trois essais (`MAX_REPARATIONS_PAR_ETAPE`), puis `demandeDEncadre` et `tomber()` avec `step.blocage`.
4. Un heurt de fusion : `reglerLeHeurtSurPlace` (dans `deployer`), recollage documentaire d'abord, dossier laissé en pleine fusion, vérification `heurtRegle` (plus de MERGE_HEAD, `merge-base --is-ancestor`, pas de marqueurs), `remettreAvantLaFusion` puis écartement après trois essais.
5. Un nouvel agent sans carte qui ne doit pas se voir : filtrer sa marque dans `agentsDeLaBande` (shared/src/en-route.ts) et dans `voletDeLAgentDePublication` (shared/src/depannage-publication.ts). L'ancienne `agentsTerminesDeLaBande` a été retirée comme export mort (commit a6baa2b0) : ne pas la recréer.
6. Un texte affiché nouveau dans l'encadré (web/src/components/volet-publication.tsx, `DetailDeLEtape`) : ses cinq langues dans shared/src/traductions.ts. Les contrôles de publication cherchent les fonctions par leur NOM (scripts/verif-tiroir-deploiement.mjs…) : renommer `progresser`, `noter`, `noterLaReparation` impose de recâbler ces contrôles dans le même travail.

## Vérification

`npm run build` puis `node --test server/dist/test/reparation-silencieuse-bout-en-bout.test.js` (conflit réglé et parti avec le lot ; étape réparée rejouée sans nouvelle publication ; abandon après 3 essais avec encadré rédigé ; sans compte, encadré immédiat) et `server/dist/test/depannage-publication.test.js`. Le faux agent s'impose par `imposerLesOutilsDeReparation`. Après un renommage dans deploy.ts : `node scripts/verif-tiroir-deploiement.mjs` ne doit signaler aucune pièce introuvable. Preuve : carte 84375e59, commit d33edf00.

## Pièges

- `premiereLigne` du détail d'une fusion est le RÉCIT (« dev : travaux en cours enregistrés »), pas la cause : la raison se lit avec `raisonCourteDeLEchec` (dernier paragraphe).
- Ne jamais rappeler `startDeploy` pour rejouer : le contrôle de ses appelants le refuse, et `agentsOccupes` refuserait tant que l'agent tourne.
- `sendPrompt` sans quota RANGE la demande en file : la vider (`store.clearQueue`) sinon l'agent repart plus tard sur une publication finie.
- `natureDePublication` sans `etapeTombee` prend un texte qui contient « redémarrage » pour une coupure : passer la clé de l'étape (seule la saturation est hors champ).
- Le motif `depannage` garde sa consigne d'un tour à l'autre grâce à `sendPrompt` (`agent.reparationPublication`) ; l'effort `medium` vient de `effortParDefaut`.

- DEPUIS LE 17/11/2026, l'abandon ne pose plus de carte de réparation : la chute ouvre un dépanneur automatique (`ouvrirLeDepanneurAutomatique`, `deploy.ts`) qui, dans un essai, reçoit les MÊMES outils imposés (`outilsDeReparationImposes`) — jamais un vrai moteur. Sa veille (`veillerSurLeDepanneur`) détache ses minuteurs (`unref`) : sinon `node --test` ne rend plus la main.
