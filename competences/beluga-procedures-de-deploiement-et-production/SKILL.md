---
name: beluga-procedures-de-deploiement-et-production
description: À utiliser dès qu'on touche à ce qui décide si une étape de publication de Beluga (déploiement « dev » ou mise en production) peut partir, au bouton « Initialiser / Reconfigurer » de ses agents de configuration, à l'option « mise en production » d'un projet, ou devant un déploiement qui se dit réussi sans avoir reconstruit ni relancé le site.
etat: active
themes: publication, cartes, interface
symptomes: déploiement réussi sans reconstruction ni redémarrage, bouton Initialiser absent sur À déployer, projet neuf qui déploie sans configuration, projet ancien bloqué en Initialiser, mise en production grise après l'initialisation, message qui renvoie vers un interrupteur introuvable
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

## Vérification

`npm run build && npm test` (publication-simple.test : règle pure ; deploiement-simple-bout-en-bout.test : refus sans publication créée, option éteinte par défaut ; production-allumee-par-l-initialisation.test : allumée par l'initialisation de production, pas par celle du déploiement, rattrapage unique). Les contrôles navigateur `verif-initialisation-production.mjs` et `verif-publication-d-un-clic.mjs` visent encore le bandeau d'avant le menu « Publier » (`[data-bandeau-production]` caché en menu) : au 19/11/2026 ils échouent pour cette raison, pas pour la règle. Preuves : carte « Déploiement à initialiser par projet » (commit 662abbed), carte « Mémoire, bulles, publication et marketing » (19/11/2026).

## Pièges

- Ne JAMAIS juger « initialisé » sur `deploiement.commande` ou `deploiement.service` : le montage pré-remplit le service constaté (`reglageDeDeploiementConstate`), un projet neuf passerait pour prêt. D'où la marque posée par migration.
- `aUnProcessus` (publication-simple.ts) ne regarde QUE la mise en production ; pour le déploiement c'est `aUnProcessusDeDeploiement`.
- Les tests serveur qui déploient un projet d'essai doivent lui donner `deploiement.herite: true` (ou un processus), sinon `startDeploy` refuse. Une étape de processus d'essai exige `delaiS` (schéma du projet).
- Beluga (`isSelf`) garde son déroulé propre : il ne doit jamais tomber en « Initialiser ».
- « Enregistrer » des réglages fusionne `deploiement` (`fusionDesProcedures`) : `processus`, `agentId` et `herite` survivent.
- Un rattrapage au démarrage passe par un marqueur meta, pas par une migration numérotée : deux branches parallèles prendraient le même numéro.
