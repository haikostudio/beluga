---
name: beluga-fil-des-agents-sans-carte
description: À utiliser dès qu'on touche à la conversation d'un agent SANS carte dans Beluga (agent de configuration du déploiement ou de la mise en production, Studio, Leads, Marketing 2, surveillance, sauvegardes, assistant, publication) ou que son fil ne ressemble pas à celui d'un agent de tâche : « Question posée 9/10 » au lieu des questions dans le fil, ligne de déroulé à part, barre de répartition du temps sous la réponse, conversation plus étroite ou plus large que celle d'une carte, blocs posés dans le fil qui dépassent la zone d'écriture.
etat: active
themes: interface, journal
symptomes: le fil d'un agent hors carte ne ressemble pas à celui d'une tâche, Question posée 9/10 dans le déroulé, barre Votre réponse Réflexion du modèle Commandes sous une réponse, question déjà répondue qui garde sa carte, conversation hors carte d'une autre largeur qu'une carte, zone d'écriture plus étroite que celle d'un agent, bloc posé dans le fil qui dépasse la zone d'écriture ou la bulle de l'agent, bulles décalées de quelques pixels par rapport au champ
projets: Beluga
---

# beluga-fil-des-agents-sans-carte

## Procédure

1. Un agent sans carte n'a pas de journal (`ajouterAuJournal` refuse un cardId vide ; `journaliserDansLeTour` sort sans `run.cardIdJournal`). Ne pas lui en fabriquer un côté serveur : relire ses messages.
2. Règle pure `entreesDuTourSansCarte(message, garder)` (`shared/src/fil-sans-carte.ts`) : étape refermée → entrée `requete` (outil brut, `params` = `step.entree`, `resultat` = `step.detail`, `dureeMs`) ; chaque tâche → entrées `point` (« todo » à l'heure du départ de la première ligne, « running » à son `startedAt`, « done »/« unfinished » à son `endedAt`) avec `donnees` JSON `{ rang, sur, debutLe, finLe }`, comme `runtime.ts` ; tri par heure puis ordre d'écriture, `rang` sans trou, `cardId` vide, `tourId` = id du message.
3. Écran : `TravailDUnTourSansCarte` (`web/src/components/flux-en-points.tsx`) sous `PointsDeLaCarte` — liste de tâches → `TravailEnSousPoints` ; sinon `segmenterLeRecit` → `RecitDuPassage` (total sous le dernier segment d'actions) et `MotsDeLaDiscussion` (questions + réponses, notes).
4. `message-view.tsx` (réponse d'agent) le monte à la place de `Steps` ; `Steps` ne garde que les étapes encore `running` d'un message qui s'écrit ; `questionsDeLAgent` écarte les questions répondues ou annulées (elles se lisent dans le fil).
5. Aucune répartition du temps sous une réponse : `repartition-du-temps.ts` ne garde que `genreDeTempsDeLEtape` / `estUneAide` (aides en violet dans le déroulé en direct).
6. LARGEUR (MEM-5807, puis carte Marketing 2 du 09/11/2026, commit sur tache/refonte-minimaliste-de-l-13b44a) : `Chat` n'a aucune largeur à lui. Toute conversation hors carte s'enveloppe dans `mx-auto flex min-h-0 w-full max-w-[820px] flex-1 flex-col` — la valeur de `CLASSE_COLONNE_DE_CARTE` (card-panel.tsx), RECOPIÉE en littéral quand l'hôte est chargé à la demande (card-panel l'est aussi : l'importer tirerait le module des cartes). Zone d'écriture obtenue : 788 px à 1440 px, comme une carte. Appliqué : Leads (`data-leads-conversation`), Studio (`CLASSE_CONVERSATION_DU_STUDIO`, avec `[--largeur-de-l-agent:100%]`), Marketing 2 (`data-m2-conversation`). Ne plus passer `largeurMax` pour un nouvel écran (seul l'outil Marketing d'origine le garde).
7. CÔTÉ AGENT : la réponse d'agent vit dans `CLASSE_LARGEUR_DE_LA_REPONSE` (message-view.tsx, `w-[min(92%,860px)] min-w-0 max-w-full`, repère `data-reponse-agent`). Les blocs qu'un hôte pose dans le fil par `blocsALHeure` (devis, étude, rapport…) sont enveloppés par `Chat` dans cette MÊME classe (repère `data-bloc-a-l-heure`) : ils finissent au bord des réponses et des bulles de question, jamais au-delà de la zone d'écriture.
8. RETRAIT : le fil de `Chat` a 12 px de marge (`--retrait-du-fil`, défaut 0.75rem), la zone d'écriture 16 px (`px-4` du Composer) : les bulles débordent donc de 4 px à gauche du champ. Un hôte qui veut l'alignement exact pose `[--retrait-du-fil:1rem]` sur son enveloppe (Marketing 2) ; les autres conversations n'ont pas été déplacées.
9. Une page voisine sans fil (nouveau client, documents) se pose dans la même colonne de 820 px avec `px-4` sur un enveloppant EXTÉRIEUR, pour que son cadre s'aligne sur la zone d'écriture.

## Vérification

`server/src/test/fil-sans-carte.test.ts` (actions rangées sous la tâche en cours, réflexion avant la première tâche, étape vivante écartée, question avec sa réponse) ; npm test 5240/5240 et `node scripts/verif-initialisation-production.mjs` 80/80 le 19/10/2026 (carte 70f51dd7, commit 6cb645cd ; `HAIKO_INITPROD_URL` = serveur de développement lancé avec `BELUGA_DEMON_PORT=7219`). Largeur : `env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-marketing-2.mjs` (44/44 le 09/11/2026) mesure à 1440 px les bords VISIBLES — cadre du champ `[data-champ-d-ecriture]`, `[data-reponse-agent]`, `[data-question-chapitres]`, `[data-m2-devis]`, `[data-m2-etude]`, `[data-m2-rapport]` — et compare la largeur du champ à celle d'une carte créée dans le même démon jetable (`card.create` puis `#projet/<id>/tache/<id>`) : 788 px des deux côtés, blocs et réponses 496–1221 dans un champ 496–1284 ; à 390 px, aucun débord.

## Pièges

Le découpage `travailEnSousPoints` lit les points par LOTS consécutifs : poser toutes les annonces « todo » au même instant AVANT les actions, sinon les actions tombent sous la mauvaise ligne. Les composants du fil de carte ne sont pas exportés un par un : passer par `TravailDUnTourSansCarte`, qui pose le contexte `PointsDeLaCarte`. Retirer un affichage laisse des exports morts : le détecteur `scripts/exports-morts.test.mjs` (lancé par npm test) les signale, et le dictionnaire doit perdre les textes qui ne s'affichent plus. Mesurer une largeur sur un conteneur rembourré donne sa boîte, pas ce qu'on voit : `getBoundingClientRect` d'un bloc en `px-4` rendait 480–1300 pour un contenu à 496–1284 — mesurer l'élément qui porte le fond, ou mettre le rembourrage sur un enveloppant extérieur. Un `largeurMax` passé à `Chat` s'applique séparément au fil et au pied : le fil et la zone d'écriture finissaient à deux bords différents (790 px de fil, 758 px de champ).

## Ce qui ne marche pas

Garder `Steps` (« Question posée 9/10 », ligne de bilan) pour les agents sans carte : l'utilisateur veut le même fil partout. Fabriquer un journal serveur par agent : `card_journal` est clé par carte, tout le reste du parcours suppose une carte. Donner à une conversation hors carte une largeur de maquette (790 px) : l'utilisateur veut la largeur et la zone d'écriture des agents (demande du 09/11/2026). Rendre les blocs de `blocsALHeure` pleine largeur : ils dépassaient la bulle de l'agent de 63 px.
