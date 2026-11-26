---
name: beluga-liste-des-agents
description: À utiliser dès qu'on touche à la liste unique des agents (page « Tableaux de bord », page plein écran d'un projet au téléphone) ou à la colonne de gauche : état, badge, couleur ou date d'un agent, trait « Archivé » (centré) entre actives et rangées, zone « Au travail » (ex-« En cours ») en tête de la colonne avec le visage de l'agent porteur, AGENTS listés sous un projet déplié (les tâches n'y sont plus), cadre violet d'une mise en ligne qui tourne, point violet de l'élément ouvert, rond de couleur au coin de l'icône, bulle au survol d'une ligne de la colonne, ordre par date, défilement infini, recherche et filtre groupés, clic droit, appui long, « Voir plus », poignée de rangement d'un projet, lignes de déploiement et de mise en production mêlées aux agents, ou un contrôle navigateur qui cherche encore [data-column], article[data-carte], [data-liste-archives], [data-voir-archives], [data-bande-productions] ou [data-mises-en-ligne].
etat: active
themes: interface, cartes, colonne, tableaux de bord, telephone, publication
symptomes: un contrôle cherche [data-column] ou article[data-carte] ou [data-liste-archives] ou [data-voir-archives] et ne trouve rien, le badge d'un agent n'a pas le bon état ou la bonne couleur, une carte active ancienne n'apparaît pas en haut, une carte terminée non ouverte reste sous le trait, un contrôle d'ordre par date échoue depuis le trait « Archivé », un contrôle trouve deux lignes [data-agent-en-liste] pour la même carte dans la colonne, une tâche déployée ne reste pas en gras dans la zone « Au travail », renommer depuis le clic droit n'ouvre aucune fenêtre, une ligne saute ou manque en descendant, un contrôle ne trouve plus de badge dans la colonne, la poignée d'un projet est introuvable ou invisible, un déploiement ne paraît pas sous son projet, un contrôle attend des tâches [data-agent-en-liste] sous un projet de la colonne
projets: Beluga
---

# beluga-liste-des-agents

## Symptôme

Ni un projet ni « Tableaux de bord » ne montrent de colonnes : chaque carte est une ligne d'agent avec sa branche, une icône d'état monochrome animée et, sur les pages, un badge coloré et sa date. Depuis le 30/10/2026 (carte « Barre unique et liste par date ») la liste est UNE seule suite par date de dernière modification. Depuis le 26/11/2026 (carte « Beluga piloté par des agents »), la colonne de gauche montre sous un projet déplié ses AGENTS (équipe), plus ses tâches ; la zone « En cours » s'appelle « Au travail ».

## Cause

L'utilisateur veut penser en agents, sans classement par colonne. Le modèle n'a pas bougé (COLUMN_KEYS planned/running/to_deploy/archived, MEM-3125) : seule la lecture change, par des règles pures. Un déploiement ou une mise en production « est un agent, entre guillemets » : une ligne par lancement. Le 01/11/2026 (capture #ca0c), les actives se confondaient avec les rangées : d'où le trait et les couleurs. Le 26/11/2026, les projets deviennent des équipes : les tâches vivent dans l'onglet « Tâches » de la page du projet, la colonne montre qui travaille.

## Procédure

1. L'état : `etatDeLAgentEnListe(carte, signaux)` dans `shared/src/etat-d-agent-en-liste.ts`, libellés `LIBELLE_ETAT_D_AGENT`, recherche `agentCorrespond`, filtre `passeLeFiltre`.
2. ACTIVE OU RANGÉE : `ligneActive({etat, carte})` = état ∈ {brouillon, lance, travail, en-pause, a-vous, a-deployer} OU `termineeNonOuverte(carte)`. `separerActives(flux, entreeActive)` après `fluxMele`. `SeparationDesActives` porte « Archivé » AU CENTRE (`[data-etiquette-archive]`).
3. COULEURS : `familleDeCouleur(etat, termineeNonOuverte)` → agit (violet), a-vous (jaune), pret (vert `--pret`), repos (gris). `BadgeDEtatDAgent`, `IconeEtRondDeFamille` (rond 6 px `[data-rond-famille]`).
4. L'ordre : `shared/src/liste-par-date.ts`, clé `updatedAt` puis `id` ; côté démon `cartesParDate` (`cards.parDate`). Jamais d'autre clé de tri à l'écran — le regroupement actif/rangé se fait APRÈS.
5. L'écran : `web/src/components/liste-des-agents.tsx`, `useCartesParDate` (reprend TOUTES les cartes de `tachesDeLaColonne`), `useLignesDAgents`, une seule sentinelle. `BarreDeRecherche` d'un seul bloc. `ZoneDefilement sansVoileDebut`. L'onglet « Tâches » de la page d'un projet (`equipe/taches-de-l-equipe.tsx`) réutilise `useCartesParDate(projectId)` + `useLignesDAgents` et range par `groupeDeLaTache`.
6. LA COLONNE (26/11/2026) : sous un projet ou un groupe déplié, `AgentsDuProjetDansLaColonne` (`web/src/components/equipe/agents-dans-la-colonne.tsx`) — lignes `[data-agent-de-la-colonne]` (visage, prénom, métier court, état en formes), actifs d'abord puis « n autres » (`[data-autres-agents]`) ; au-dessus, les lignes sans carte (chefs, agents de configuration, travaux des services, mises en ligne qui tournent). Le bloc garde `[data-taches-du-projet]` (géométrie du rangement, `BranchesDArbre`). La recherche garde ses résultats par projet (`TachesTrouvees`). `TachesDuProjet` a été retiré.
7. Les gestes : clic droit et appui long ouvrent `MenuCarte ancrage="invisible"` (zone « Au travail », Tableaux de bord). Le nom d'un projet ouvre la page de son ÉQUIPE.
8. Projets réunis : une MÈRE (`cartesFilles`) porte `[data-deplier-filles]` (`LigneEtFilles`, `FillesDeLaMere`) ; une fille dont la mère est listée sort du flux (`sansLesFillesRangees`).
9. DATES ET BULLE : sur une PAGE, `[data-etat-et-date]` ; dans la colonne (`compacte`), le rond et la date courte, bulle `Tooltip side="right" desactive={menuOuvert}`.
10. POIGNÉE À GAUCHE : `CLASSE_POIGNEE_A_GAUCHE` (`sidebar.tsx`), `[data-poignee-projet]` / `[data-poignee-groupe]`.
11. MISES EN LIGNE : `deploys.parDate` via `useMisesEnLigneParDate(projectId?)` ; `LigneDeMiseEnLigne` `[data-mise-en-ligne=<id>]`, cadre `[data-cadre-mise-en-ligne]` en cours ou en échec.
12. REPÈRE DE L'ÉLÉMENT OUVERT : `CLASSE_REPERE_OUVERT` (point violet de 6 px) ; l'agent ouvert dans la colonne prend `ligne-ouverte-de-colonne`.
13. ZONE « AU TRAVAIL » : `taches-en-cours.tsx`, sous la tête de colonne (`[data-tete-de-colonne]`), cachée en colonne réduite et pendant une recherche. Règle `shared/src/taches-en-cours.ts` (inchangée) ; ce qui VOUS ATTEND (`a-vous`) passe en tête, puis l'ordre par date ; chaque ligne porte le visage de l'agent de développement du projet (`porteur` de `LigneAgent` : portrait + « Max · Projet », « Max vous attend » en `--important`), à défaut l'icône du projet. Lignes `[data-agent-en-cours]` AU LIEU de `[data-agent-en-liste]`. Repli `sidebar.tachesEnCoursRepliees`.
14. LISTES DE LA COLONNE RETENUES : `sidebar.collapsed`, `sidebar.regroupementsOuverts`, `sidebar.projetsDeplies` ne s'écrivent que par `modifierLaListe` (`lib/prefs.ts`).

## Vérification

npm run build puis npm test (dont etat-d-agent-en-liste.test.ts, liste-par-date.test.ts, agents-actifs-dans-les-listes.test.ts, mises-en-ligne-du-flux.test.ts, equipe-d-agents.test.ts) ; depuis la copie de la carte : `env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-equipe-d-agents.mjs` (agents sous le projet déplié, colonne sans « Services » ni « Nouvel artefact ») et `node scripts/verif-zone-en-cours-et-bulle.mjs` (zone « Au travail » sous la tête, visage ou icône sur chaque ligne, le nom d'un projet ouvre son équipe). `scripts/verif-liste-des-agents.mjs` vise encore des tâches sous les projets de la colonne et bloque, le 26/11/2026, dès sa première étape (Tableaux de bord) : à réécrire avant de s'y fier.

## Pièges

Un `getBoundingClientRect` d'icône qui tourne grandit avec l'angle : mesurer l'enveloppe (14 px), jamais le svg. `ligneActive` reçoit un type « faible » : un objet de test sans `renduA` ni `lastReadAt` est refusé par TypeScript. Le menu d'une ligne doit RESTER MONTÉ une fois ouvert. Une carte renommée ou OUVERTE remonte en tête (updatedAt). Sur téléphone la colonne d'ordinateur reste montée cachée : viser le parent visible. Un `aria-label` ne passe jamais par t(). Retirer un écran rend des textes du dictionnaire orphelins (verif-langues) et des exports morts (exports-morts.test). Le visage du porteur n'apparaît qu'une fois les équipes lues (`useEquipesDeLaColonne`, relue au plus toutes les deux secondes) : un contrôle rapide voit d'abord l'icône du projet.

## Ce qui ne marche pas

Radix ContextMenu : non installé. Une pagination par colonne avec tri à l'écran : une archive chargée plus tard se glisse au-dessus. Le groupement par famille de cartes et le retrait des étapes : retirés. Un badge TEXTE dans la colonne de gauche : refusé le 31/10/2026. Un groupe « Mises en ligne » en tête : refusé. Réutiliser `carteNonLue` pour « terminée non ouverte » : elle écarte les rangées. Réutiliser `--en-cours`/`--termine` pour le vert : remappés en gris.
