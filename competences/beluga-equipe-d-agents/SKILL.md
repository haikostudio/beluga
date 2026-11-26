---
name: beluga-equipe-d-agents
description: À utiliser dès qu'on touche à l'équipe d'agents d'un projet ou d'un groupe dans Beluga : la page d'un projet (discussion de l'équipe + volet « Équipe | Tâches », la table aux liaisons colorées, le « + » au survol, « Nouvel agent »), la page d'un agent (ses outils en onglets, sa fiche, son visage et son état dans le fil d'Ariane), les portraits et couleurs, les échanges entre agents (outil equipe, garde anti-boucle, tâches lancées seules), le bouton « Déployer » qui ouvre l'agent de déploiement, le menu à trois points unique, ou la colonne (« Au travail », agents sous un projet, services dans le menu à trois points).
etat: active
themes: interface, agents, equipe, navigation
symptomes: la table de l'équipe est vide ou ses libellés se chevauchent, un agent semé en double, un second agent de communication à côté d'Eliot, deux visages identiques dans une équipe, la page boucle (erreur React #185) après l'ajout d'une option de page, deux boutons à trois points en haut à droite, « Déployer » ouvre l'ancien menu « Publier », une tâche demandée par un collègue reste dans Planifié, deux agents tournent en rond
projets: Beluga
---

# beluga-equipe-d-agents

## Cause

Carte « Beluga piloté par des agents » (26/11/2026, commits b423061aa, f760c5f76, eeff24b06) : Beluga se pense en équipes. Un membre d'équipe EST un agent personnalisé (agents_perso + migration 194 : role, portrait, couleur, outils, autonome) ; un agent de groupe a pour projet le projet-regroupement. Décisions de l'utilisateur : la table (maquette #1ff2), la barre d'onglets standard en tête du volet, visage + prénom + métier + état dans le fil d'Ariane, un seul menu à trois points, « Déployer » nommé, rien de supprimé (ancien accueil dans « Chiffres et coûts », ancien onglet Agents dans « Tableau des agents »), agents libres entre eux réglables un par un.

## Procédure

1. LES RÈGLES PURES : shared/src/equipe-d-agents.ts (ROLES_D_EQUIPIER, OUTILS_DU_ROLE, EQUIPE_DU_PROJET Max/Eliot/Zoé/Karim/Victor, EQUIPE_DU_GROUPE Claire/Hugo, membresASemer idempotent avec rôles retirés, roleDevine, portraitLibre, etatDuMembre, destinataireDuMessage, refusDEchange, liaisonsDeLEquipe, placesAutourDeLaTable, repartirLaTable, groupeDeLaTache, CONSIGNE_DU_ROLE). Test : server/src/test/equipe-d-agents.test.ts.
2. LES PORTRAITS : shared/src/portraits.ts + web/public/portraits/<id>.webp (60, 256 px), réécrits par NODE_PATH=<node_modules avec sharp> node scripts/portraits/decouper-portraits.mjs <dossier des planches Codex> ; ajouter un visage = une planche 4×4 Codex, puis relire à l'œil et compléter ECARTES pour les ressemblances.
3. LE DÉMON : server/src/equipe-d-agents.ts — semerLEquipe (au démarrage 20 s après, et à chaque equipe.lire ; membres ÉTEINTS et SANS conversation, ouverte par agentsPerso.conversation à la première visite), journal agents_echanges (ajout seul), ecrireALEquipe (au dev : carte en cadrage via card.create + agent.prompt dans ws.ts), outil equipe (lister, demander, tache — servi aux seuls agents personnalisés), poserUneTacheDeDev (startCard si autonome), apercuDeLOutil (commande equipe.outil). Commandes equipe.* dans shared/src/protocol.ts et droits-commandes.ts.
4. LA FORME COMMUNE : web/src/components/equipe/gabarit-discussion-volet.tsx (discussion, ResizeHandle, aside CLASSE_VOLET_DU_PLAN, BarreDOnglets variante « accueil », pied CLASSE_BOUTON_DU_PIED ; téléphone : « Discussion » rejoint les onglets, tous montés).
5. LA PAGE D'UN PROJET : equipe/page-de-l-equipe.tsx (table-de-l-equipe.tsx, taches-de-l-equipe.tsx, discussion-de-l-equipe.tsx), montée par page-du-projet.tsx ; onglet retenu par pref equipe.onglet.<projet>.
6. LA PAGE D'UN AGENT : page-de-l-agent.tsx (CranDeLAgent, ReglagesDuMembre, onglets = outils + « Fiche »), outils dans equipe/outils-de-l-agent.tsx (« Mise en ligne » monte ContenuPublier de menu-publier.tsx).
7. LA BARRE DU HAUT : BoutonDeployer (menu-publier.tsx) via equipe/bouton-deployer-du-projet.tsx ; options de la page lues par MenuGeneralAvecLesOptions (app.tsx, registreDuProjet, coinDeLaPage).
8. LA COLONNE : taches-en-cours.tsx (« Au travail », porteur), equipe/agents-dans-la-colonne.tsx (bloc gardé [data-taches-du-projet] pour la géométrie du rangement), ServicesDuMenuDeLaColonne (services-de-la-colonne.tsx).

## Vérification

npm run build puis npm test (equipe-d-agents.test, agents-personnalises.test). Depuis la copie de la carte, démon jetable : env -u BELUGA_TOKEN -u BELUGA_URL VERIF_CAPTURES=/tmp/x node scripts/verif-equipe-d-agents.mjs — 72/72 le 26/11/2026 (semis idempotent, page du projet, table à 10 et 20 agents sans libellé tronqué ni superposé, « + » au survol, page de chaque métier, « Déployer » nommé et un seul ⋮, colonne, message à l'équipe, 1440/1024/390 px, clair et sombre).

## Pièges

- Un registre de menu (useContenuDuMenuDuHaut) lu par App redessine la page qui s'y déclare → boucle (React #185) : le lire dans un composant ENFANT.
- page.goto vers la même adresse ne recharge rien (seul le fragment change) : recharger pour relire la base dans un contrôle.
- Le démon d'essai crée sa base au démarrage : poser le décor APRÈS attendrePort ; le semis de rattrapage part 20 s plus tard (equipe.lire sème tout de suite).
- La table : la hauteur se calcule sur le PAS entre deux places (portrait + libellé de deux lignes), sinon les libellés se chevauchent dès 14 agents.
- Un agent qui attend se fabrique en essai par une question ouverte dans messages (colonnes id, agent_id, role, data, created_at, a_questions).
- aria-label jamais par t() ; chaque nouveau texte va dans shared/src/traductions.ts, et un texte retiré de l'écran en sort aussi (verif-langues).
- Retirer une ligne ou un composant rend des exports morts (scripts/exports-morts.test.mjs) : retirer aussi le code et les clés du dictionnaire devenus orphelins.

## Ce qui ne marche pas

- Grisser les agents au repos ASSIS à la table : l'équipe par défaut paraissait éteinte ; seul le banc est gris.
- Lire l'activité « vous attend » dans la dernière ligne du journal : elle disait « Max rejoint l'équipe » ; on lit la question ouverte (premiereAttenteDeLAgent).
- Créer la conversation de chaque membre au semis : trente projets poseraient cent cinquante cartes rangées.
