---
name: beluga-procedures-de-deploiement-et-production
description: À utiliser dès qu'on touche à ce qui décide si une étape de publication de Beluga (déploiement « dev » ou mise en production) peut partir, au bouton « Initialiser / Reconfigurer » de ses agents de configuration (y compris quand leur conversation est tombée), à l'option « mise en production » d'un projet, ou devant un déploiement qui se dit réussi sans avoir reconstruit ni relancé le site.
etat: active
themes: publication, cartes, interface
symptomes: déploiement réussi sans reconstruction ni redémarrage, bouton Initialiser absent sur À déployer, projet neuf qui déploie sans configuration, projet ancien bloqué en Initialiser, mise en production grise après l'initialisation, message qui renvoie vers un interrupteur introuvable, Initialiser rouvre une conversation morte et rien ne repart, avertissement « workspace has not been trusted » affiché en rouge comme cause
projets: Beluga
---

# beluga-procedures-de-deploiement-et-production

## Procédure

1. La règle unique est `procedureEnPlace(projet, cible)` dans `shared/src/procedure-publication.ts` : production = processus de mise en production écrit ; déploiement = `isSelf` OU processus de déploiement écrit OU `deploiement.herite === true`. Tout lecteur passe par elle : `startDeploy` (server/src/deploy.ts), `blocageMiseEnProduction` / `moyenDeMiseEnLigne` (phrase renvoyée à l'écran par `deploy.contexte` dans ws.ts), le déploiement automatique (server/src/deploiement-automatique.ts), le pied de carte (`raisonDeployerDepuisLaCarte`, parcours-carte.tsx), la colonne (`DeployPanel`, branche `!enPlace`), la rubrique des réglages (`ProcessusEnPlace`) et le tiroir de l'agent (`agent-de-configuration.tsx`).
2. Une étape non prête : `startDeploy` refuse AVANT de créer une publication (phrase `RAISON_SANS_PROCEDURE_DE_DEPLOIEMENT` pour le déploiement). La colonne « À déployer » montre `BoutonInitierProcedure cible="dev"` et la même phrase ; `onInitier` de board.tsx ouvre la rubrique de l'étape de la colonne.
3. L'OPTION DE MISE EN PRODUCTION (`miseEnProductionActive`, éteinte par défaut, distincte de « déploiement automatique ») : `enregistrerProcessus(…, 'production')` (server/src/procedure-publication.ts) l'ALLUME dans le même enregistrement (décision du 19/11/2026). `rallumerLaProductionDesProjetsInitialises`, appelée au démarrage (main.ts), rallume UNE fois les projets déjà initialisés et éteints (meta `migration.productionActiveSiProcessus`). Le message `PRODUCTION_DESACTIVEE` (shared/src/publication-simple.ts) et `MEMBRE_DESACTIVE` (production-de-groupe.ts) renvoient à la rubrique « Mise en production » des réglages du projet (`InterrupteurMiseEnProduction`, config-projet/page-production.tsx).
4. Les textes de la branche `!enPlace` de `deploy-panel.tsx` dépendent de `etape.cible`. Tout nouveau texte passe par `shared/src/traductions.ts` (cinq langues, clé = texte français, ancienne clé retirée).
5. Le prompt de l'agent de déploiement est `promptInitialisationDeploiement` (shared/src/publication-simple.ts) : il demande d'abord la machine, sauf pour Beluga.
6. Un projet qui déployait avant la règle garde son droit par la marque `herite`, posée UNE fois par migration (117), effacée par `enregistrerProcessus` quand un processus de déploiement est écrit.
7. AGENT DE CONFIGURATION TOMBÉ (25/11/2026, DEC-583) : `agentDeConfigurationTombe` (shared) = statut `failed` ou dernier message en erreur, sans tour actif, sans question ouverte, sans procédure écrite. `tourDeProcedure` SANS message passe par `agentDuClicInitialiser` (server/src/procedure-publication.ts) : agent tombé → agent neuf retenu sur `projet[champDeLEtape(cible)].agentId` (reste du champ gardé), ancien détaché mais gardé, tour d'accueil lancé. Avec un message : toujours le même agent. Écran : le tiroir lancé par « Initialiser » appelle toujours `procedure.tour` (le serveur juge) ; `InitialiserLEtape` du menu « Publier » appelle `procedure.tour` et n'ouvre le fil que si le MÊME agent revient sans tour en cours.
8. La raison d'un tour tombé écarte les avertissements anodins CONNUS du CLI Claude (`sortieDErreurUtile`, shared/src/avertissements-du-moteur.ts) : dans `cloturer` de server/src/engines/claude.ts et dans `issueDuTour`. Une question annulée par la coupure se dit « coupé pendant sa question… Cliquez sur « Initialiser » pour repartir d'un agent neuf ».

## Vérification

`npm run build && npm test` (publication-simple.test : règle pure ; deploiement-simple-bout-en-bout.test : refus sans publication créée, option éteinte par défaut ; production-allumee-par-l-initialisation.test : allumée par l'initialisation de production, pas par celle du déploiement, rattrapage unique ; agent-de-configuration-tombe.test : tombé → agent neuf, question ouverte ou procédure écrite → gardé, avertissement écarté, vraie erreur gardée). Navigateur : `env -u BELUGA_TOKEN -u BELUGA_URL VERIF_CAPTURES=/tmp/x node scripts/verif-agent-de-configuration-tombe.mjs` (démon jetable SANS compte moteur, menu « Publier » → « Initialiser la mise en production » sur un agent tombé : 9/9 le 25/11/2026). Les contrôles navigateur `verif-initialisation-production.mjs` et `verif-publication-d-un-clic.mjs` visent encore le bandeau d'avant le menu « Publier » (`[data-bandeau-production]` caché en menu) : au 19/11/2026 ils échouent pour cette raison, pas pour la règle. Preuves : carte « Déploiement à initialiser par projet » (commit 662abbed), carte « Mémoire, bulles, publication et marketing » (19/11/2026), carte « Mise en production bloquée par un avertissement » (25/11/2026).

## Pièges

- Ne JAMAIS juger « initialisé » sur `deploiement.commande` ou `deploiement.service` : le montage pré-remplit le service constaté (`reglageDeDeploiementConstate`), un projet neuf passerait pour prêt. D'où la marque posée par migration.
- `aUnProcessus` (publication-simple.ts) ne regarde QUE la mise en production ; pour le déploiement c'est `aUnProcessusDeDeploiement`.
- Les tests serveur qui déploient un projet d'essai doivent lui donner `deploiement.herite: true` (ou un processus), sinon `startDeploy` refuse. Une étape de processus d'essai exige `delaiS` (schéma du projet).
- Beluga (`isSelf`) garde son déroulé propre : il ne doit jamais tomber en « Initialiser ».
- « Enregistrer » des réglages fusionne `deploiement` (`fusionDesProcedures`) : `processus`, `agentId` et `herite` survivent.
- Un rattrapage au démarrage passe par un marqueur meta, pas par une migration numérotée : deux branches parallèles prendraient le même numéro.
- Ne jamais remplacer un agent qui attend sa réponse ou travaille : conversation perdue et tour payé deux fois. Le remplacement est synchrone avant que l'état passe « en cours » : deux clics simultanés ne créent qu'un agent.
- Le filtre de la sortie d'erreur ne vise que des motifs connus : ajouter un motif, jamais un filtre large.
- ESSAI DU CLIC « Initialiser » : il LANCE un vrai tour. Un démon jetable lit les VRAIS comptes dès son premier démarrage (amorçage depuis HOME, CURSOR_API_KEY, MIMO_API_KEY) : tout vider dès le PREMIER démarrage, vérifier 0 compte dans `accounts`, et masquer `[data-assistant-moteurs]` qui couvre alors l'écran. Le menu « Publier » s'attend par `[data-section-publier]`, pas par `[data-suivi-publier]` (pas visible à 1440).
