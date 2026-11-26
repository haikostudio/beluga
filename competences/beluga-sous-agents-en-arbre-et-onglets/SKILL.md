---
name: beluga-sous-agents-en-arbre-et-onglets
description: À utiliser dès qu'on touche à un agent qui en lance d'autres dans Beluga (chefs de Communication : général, marque, projet) : leur rangement en arbre dans « Au travail » (ex-« En cours »), la page de conversation d'un chef ou d'un sous-agent, la rangée d'onglets façon navigateur sous le fil d'Ariane, la section des chefs du « Tableau des agents » d'un projet (menu à trois points), où mène la notification d'un chef, et l'interdiction faite aux chefs — et aux agents d'équipe — de modifier le code.
etat: active
themes: interface, agents, navigation
symptomes: une fausse carte de chef dans Au travail, une notification de chef qui ne mène nulle part, un sous-agent en ligne autonome, des onglets qui se partagent la largeur, un compteur Au travail qui ne correspond pas aux lignes, un chef qui modifie le code hors carte, la section des chefs introuvable depuis la page d'un projet
projets: Beluga
---

# beluga-sous-agents-en-arbre-et-onglets

## Cause

Depuis le retrait de l'ancienne vue Communication (commit 58fe7a23d, 11/11/2026), plus aucun écran n'ouvrait un chef : notifications et ligne « En cours » menaient à communication/<marque>, réécrit vers communication2 sans conversation. Carte « Chefs invisibles et fausse carte » (24/11/2026, commit bbcbde190) : chefs gardés et rendus visibles, piste C validée (arbre dans la colonne + onglets façon Chrome, maquette #d4f0a ; barre segmentée #28ccd refusée). Carte « Beluga piloté par des agents » (26/11/2026) : la page d'un projet devient celle de son équipe ; l'ancien onglet « Agents » (tableau, point du matin, chefs) s'ouvre par « Tableau des agents » dans le menu à trois points du projet.

## Procédure

1. LA RELATION : champ générique `parentAgentId` sur `Agent` (shared/src/models.ts). Les chefs le reçoivent à leur naissance (`naitreUnChef`, server/src/directeur-marketing.ts) et au démarrage (`rattacherLesChefsASonParent`) : chef général → chefs de marque → chefs de projet. Les agents de campagne (`/campagnes/` dans service.adresse) restent HORS de l'arbre (`estChefDeLArbre`).
2. LES RÈGLES PURES : shared/src/sous-agents.ts — racine, famille à plat dans l'ordre des onglets (parent puis ses enfants, récursivement), dépliage (ouvert = membre de la famille), `racinesEnCours`, `adresseDuFilDeLAgent` → `projet/<id>/agents/fil/<agent>`. Test : server/src/test/sous-agents.test.ts.
3. LE DÉMON : server/src/sous-agents.ts — `agents.famille` (famille entière, membres au repos compris, plafonnée), `agents.chefsDuProjet` (chefs portés par le projet, sauf campagne) et `agents.couperLeChef` (coupé = plus relancé le matin). Droits dans shared/src/droits-commandes.ts.
4. « AU TRAVAIL » (web/src/components/taches-en-cours.tsx + `ArbreDesSousAgents` de web/src/components/sous-agents.tsx) : une ligne par RACINE, repliée par défaut, dépliée quand l'agent ouvert est elle ou un descendant ; branches par `BranchesDArbre` (icônes `data-icone-de-branche`, conteneur des enfants `relative`, jamais `data-filles-de-la-mere`). Le compteur compte les familles. Repères : `data-famille-en-cours`, `data-sous-agent`.
5. LA PAGE : `PageDuSousAgent` (adresse `#projet/<id>/agents/fil/<agent>`, montée par page-du-projet.tsx), fil d'Ariane `Projet / Agents / <ancêtres> / <agent>`, puis `OngletsDeNavigateur` (web/src/components/ui/barre-d-onglets.tsx) : largeur FIXE 200 px (160 sur téléphone), alignés à gauche, titre tronqué, onglet actif fondu dans la conversation, rangée qui défile de côté avec fondu droit (`data-fondu-des-onglets`), onglet choisi ramené par `scrollTo` de la rangée, chaque onglet un vrai lien. Icône d'état : `IconeDuMembre` (spinner au travail, bulle question au contour de question, robot au repos).
6. LE TABLEAU DES AGENTS DU PROJET (web/src/components/agents-du-projet.tsx) : ouvert par l'option « Tableau des agents » du menu à trois points de la page du projet (`data-option-tableau-des-agents`, page-du-projet.tsx) ; section « Chefs de communication » sous les agents personnalisés (`data-chefs-du-projet`, lignes `data-ligne-chef`, interrupteur `data-interrupteur-chef`) ; un clic ouvre la conversation.
7. NOTIFICATION : `adresseDeLAgentDeService` / `adresseDuFilDeLAgent` — jamais `communication/<marque>` pour un chef ; les agents de campagne gardent l'adresse de leur campagne.
8. PAS DE CODE : consigne `JAMAIS_DE_CODE_POUR_UN_CHEF` (shared/src/chefs-de-communication.ts) et outils d'édition fermés (`OUTILS_D_EDITION_FERMES_AUX_CHEFS`, server/src/runtime.ts), désormais AUSSI pour tout agent personnalisé (agents d'équipe) ; un changement de code passe par `propose_task` (chefs) ou par l'agent de développement de l'équipe (outil `equipe`).

## Vérification

`npm run build` puis `npm test` (sous-agents.test, chefs-de-communication.test). Puis, depuis la copie de la carte, démon jetable : `env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-sous-agents.mjs` (une ligne par famille, repliée, dépliée à l'ouverture, branches tracées, onglets 200 px avec 2 et 9 onglets, défilement et fondu, onglet lointain visible, clic dans l'arbre, « Tableau des agents » et interrupteur, 160 px et aucun débordement à 390 px, clair et sombre). `VERIF_CAPTURES=/tmp/x` écrit les captures.

## Pièges

- `BarreDOnglets pleineLargeur` partage la largeur entre onglets : refusé pour les sous-agents (« si j'en ai 60… »). Utiliser `OngletsDeNavigateur`.
- Un agent ordinaire sans carte ni service n'entre pas dans la bande « Au travail » (`agentsDeLaBande`) : l'arbre ne vaut aujourd'hui que pour les chefs ; l'étendre suppose d'abord d'y faire entrer ces agents.
- Le `libelle` d'une rangée d'onglets passe par `t()` comme les autres appels (verif-langues le relève sinon) ; les `aria-label` des icônes, eux, jamais.
- Le démon efface au démarrage les états « au travail » et « à vous » : un décor d'essai pose ses agents APRÈS le démarrage.
- `#projet/<id>/agents` n'ouvre plus le tableau : c'est la page de l'équipe ; un contrôle passe par le menu à trois points (`data-menu-general` puis `data-option-tableau-des-agents`).
- Ne jamais déplacer ni retirer les agents de campagne (communication2).

## Ce qui ne marche pas

- Barre d'onglets segmentée qui partage la largeur (maquette #28ccd) : refusée le 24/11/2026.
- Tiret typographique « – » ou jointures dessinées à la main dans l'arbre : refusés, seules les branches de `BranchesDArbre`.
- Mener la notification d'un chef vers communication/<marque> : écran retiré, la notification ne menait nulle part.
