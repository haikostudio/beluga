---
name: beluga-service-securite-des-projets
description: À utiliser dès qu'on touche au service « Sécurité » de Beluga (vue securite) : la liste des projets suivis et leur NOTE sur 100, les cases de sélection et le menu « Actions sur la sélection (N) » (relancer l'analyse, lancer la correction), l'ajout d'un projet, l'audit de chaque semaine ou à la demande, les études rédigées, la page d'un projet (conversation de l'agent avec son historique et ses repères à gauche, rapport à droite en disposition A : note, barres par gravité, avancement, évolution, catégories repliables), la feuille du téléphone, les cases qui écrivent un point dans le champ, la carte de correction qui va au bout et son bilan à cocher, les gestes du site en ligne appliqués à la mise en production, la preuve après mise en ligne.
etat: active
themes: interface, securite, services
symptomes: un point marqué Nouveau chaque semaine, un point resté En correction après la mise en ligne, la case d'un point ne coche pas, un projet actif absent de la liste Sécurité, corriger ou réanalyser plusieurs projets d'un coup, une carte de correction en double, cocher une ligne ouvre le projet, dates en anglais dans la liste, une note de 100 pour un projet jamais audité, le compte rendu d'une correction illisible, une correction rendue « fait en grande partie », un geste de production joué deux fois ou par un agent, la conversation d'un service vide alors qu'il s'est passé des choses, la conversation saute au début en remontant
projets: Beluga
---

# beluga-service-securite-des-projets

## Procédure

CE QUE L'ÉCRAN SAIT FAIRE (web/src/components/securite.tsx, vue `securite`, adresse `#securite` / `#securite/<projet>`) :
1. LISTE (modèle commun des services) : `Tableau` avec colonne Projet, NOTE (`NoteEnLigne`, anneau 22 px, `--important` sous 40, « — » sans audit réussi), État, À traiter, Dernier audit, Prochain audit — dates par `formatRegional()` (« 22 nov. 2026 »), jamais la locale du navigateur. Vue cartes : chiffre « Note ». SÉLECTION par `CaseACocher` (`data-securite-choisir`, en-tête `data-securite-tout-choisir` = lignes visibles). Avec une sélection, le pied devient « Actions sur la sélection (N) » (`data-securite-actions`, `DropdownMenu` ancré en haut) : « Relancer l'analyse » (`securite.auditerSelection` → `auditerLaSelection`, un audit 'manuel' par projet, jamais deux fois un projet en file) et « Lancer la correction » (`securite.corriger`). « Annuler la sélection » dans les options de page. Les projets actifs sont suivis sans geste (`synchroniserLesProjets`, `suivreLeProjetCree`).
2. PAGE D'UN PROJET (une page, sans ligne de titre au-dessus) : ordinateur = `Chat` de l'agent (820 px centrée) + poignée + volet commun ; téléphone = feuille, onglets Rapport / Conversation, « Lancer un audit » dans l'en-tête de la feuille, une seule marge de 16 px.
3. RAPPORT EN DISPOSITION A (carte « Sécurité : bilan, écran et historique », 25/11/2026, maquette #2312) : tête (liste des audits + « Lancer un audit »), phrase « Audit du … », puis `CarteDeLaNote` (anneau 92 px + phrase + une `BarreDeGravite` par gravité, ligne repliable « Avancement des corrections » avec les cartes liées, « Évolution » + `CourbeDeNote`), puis `CarteDesCategories` : une `LigneRepliable` par famille (injection-sql et -shell réunies en « Requêtes et commandes »), signe par la pire gravité (triangle `--important`, cercle !, info, coche, cercle barré non vérifié), chevron dernier, repliée ; ouverte : les contrôles rattachés (`MOTS_DES_FAMILLES`), « Tout ajouter », les `PointDuRapport` (fond `bg-bg`). Les contrôles sans point gardent leur ligne. Puis Accès des robots et Visiteurs bloqués.
4. CASES : `- Corriger : <titre>` part dans le champ par `depot` ; seuls les points « à traiter » du dernier audit se cochent ; rien ne s'envoie.
5. NOTE : `noteDeSecurite` (shared/src/bilan-securite.ts) = 100 − 25·critique − 12·élevée − 6·moyenne − 2·faible, plancher 0, sur les points présents non corrigés ; `ProjetSuiviSecurite.note/restants`, `ResumeDAudit.note`, `VueDAudit.avancement/evolution`.
6. CORRECTION QUI VA AU BOUT : `carteDeCorrectionGroupee` et chaque tour de tâche d'une carte liée à des points (`consigneDeCorrectionDeLaCarte` dans scheduler.ts) portent `consigneDeCorrectionSecurite`. L'agent rend son bilan par l'outil `bilan_securite` (renvoyé UNE fois s'il oublie des points, puis complété en « pas fait — non traité ») et recopie le bloc ```bilan-securite``` ; `web/src/components/bilan-securite.tsx` le dessine (compteur, Pas fait → À finir → Fait, catégorie, But/Fait), complété par `securite.bilanDeLaCarte`. Ce qui ne se règle qu'en production : `geste_de_production` ENREGISTRE (table `securite_gestes`), `mettreEnProduction` le joue après le processus, une fois.
7. AGENT ET HISTORIQUE : né à la première ouverture (`securite.agent`) ; son contexte part à chaque message ; il propose UNE carte par `board_create_card` + `points_securite`. Sa conversation porte les repères du projet (`agent.historique` : audits, corrections) et charge ses échanges anciens en remontant ; il relit son passé par `historique_du_service`.
8. ÉTUDES RÉDIGÉES (`rapportDepuisEtude`, `importerLesEtudes`) : inchangé — catégorie `etude`, empreinte `etude:<titre sans chiffres>`, une fois à vie.
9. Côté démon : MEM-7506, MEM-7513, MEM-7582, MEM-8165.

## Vérification

`node --test server/dist/test/service-securite.test.js server/dist/test/service-securite-demon.test.js server/dist/test/etudes-de-securite.test.js server/dist/test/bilan-securite.test.js server/dist/test/securite-correction-demon.test.js` (note, analyse groupée sans doublon, bilan renvoyé une fois, geste enregistré sans être joué puis appliqué une fois, repères de tous les services) ; `env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-service-securite.mjs` depuis la copie de la carte après `npm run build` : 78/78 le 25/11/2026 (note et barres, catégories repliées qui s'ouvrent, colonne Note, dates en français, menu de la sélection qui lance un audit, bilan rangé et compteur, repères, chargement en remontant sans saut, plein cadre clair et sombre, téléphone).

## Pièges

- Une empreinte se tire de `categorie:id`, jamais du titre : sinon faux « Nouveau » chaque semaine.
- Aucun audit ne réveille l'agent de sécurité ; le premier audit et celui qui suit une étude n'alertent jamais.
- « Ajouter un projet » disparaît quand aucun projet ne reste à ajouter : un contrôle juge le bouton des actions, pas son retour.
- « Relancer l'analyse » : la réponse peut suivre l'audit en base de quelques secondes ; attendre l'état, pas un délai fixe.
- `envoyerConversation` lit `400 + paquets` messages : un plafond fixe interdisait de remonter. Le suivi du bas de chat.tsx doit ignorer un paquet ancien (`paquetAncienArrive`), sinon il redescend.
- Le bloc du bilan se rend dans `markdown.tsx` (langage `bilan-securite`, jamais pendant l'écriture) ; un JSON illisible retombe en code, jamais un cadre vide. Ses éléments sont des `div` : les `p`/`li` héritent des marges et tirets du texte du fil.
- Un geste de production ne s'exécute QUE dans `mettreEnProduction` (MEM-4501) ; l'écran ne reçoit jamais sa commande.
- Un `aria-label` ne passe jamais par `t()` ; un texte affiché, toujours (ajouter ses quatre traductions dans shared/src/traductions.ts, retirer une clé devenue orpheline).
- Le contrôle navigateur ne clique pas « Lancer la correction » (il lancerait un vrai agent).
- L'étiquette de l'agent est `agent-securite`, jamais `securite`.
