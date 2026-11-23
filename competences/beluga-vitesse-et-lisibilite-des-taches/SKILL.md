---
name: beluga-vitesse-et-lisibilite-des-taches
description: À utiliser pour toucher à ce qui rend une tâche d'agent lente ou lisible dans Beluga : garde des attentes inutiles (boucles, sleep, serveur d'essai, tail -f), répartition du temps sous une réponse, témoin « ce qui occupe l'agent », aides en violet, interrupteurs « Cahier des charges » / « Création » / « Auto », volet d'aperçu du site de dev.
etat: active
themes: agents, interface, cartes
symptomes: une tâche reste bloquée dix minutes sur une commande, npm run dev refusé à un agent, la répartition du temps ne s'affiche pas, une aide n'est pas violette, le cahier des charges s'allume tout seul, le lancement automatique ne part pas, l'aperçu reste blanc
projets: Beluga
---

# beluga-vitesse-et-lisibilite-des-taches

## Symptôme

Les tâches prenaient du temps sans qu'on sache pourquoi : attentes en boucle et serveurs d'essai au premier plan bloquaient le tour jusqu'à sa limite, et rien ne disait où le temps passait.

## Cause

Mesure du 14/10/2026 (511 tours) : 9 % en boucles d'attente, 4 % en commandes bloquées à 10 min. Le fil ne montrait ni la part des commandes / aides / réflexion, ni l'étape en cours avec sa durée.

## Procédure

CE QUE LE SYSTÈME SAIT FAIRE (commits 4b4e0275 → 2431d47d) :
1. Garde des attentes — `commandeAttendEnVain` (shared/src/garde-attentes.ts), appelée par server/garde-demon.mjs (PreToolUse Bash, Claude) avec `run_in_background` ; Codex/Cursor reçoivent `CONSIGNE_DES_ATTENTES` (runtime.ts, consigne système, moteur ≠ claude). Refusés : while/until…sleep…done non bornés (borne `timeout` ≤ 120 s ou `&` final = passe), sleep > 20 s, serveurs (npm/pnpm/yarn run dev|start|serve|preview, vite, next dev, http.server, php -S, node server/dist/main.js, docker compose up sans -d), tail -f / journalctl -f. Heredocs et guillemets ignorés.
2. Répartition du temps — `repartitionDuTemps(steps, durationMs)` (shared/src/repartition-du-temps.ts) : union d'intervalles par genre (commandes, lecture, écriture, aides, outils, reponse=ask_user), réflexion = durée − temps couvert ; `plusLongue` si ≥ 30 s et ≥ 20 %. Affichée par `RepartitionDuTour` (message-view.tsx) sous une réponse non streaming ≥ 20 s avec au moins deux parts.
3. Direct — `ceQuiOccupe` (chat.tsx, TravailEnCours) : « tâche — étape · durée » dès 10 s, « n aides au travail ».
4. Aides en violet — `estUneAide` ; steps.tsx : icône Bot + text-teinte.
5. Barre d'écriture — `BoutonInterrupteur` icône seule (h-7 w-7, aria-label) ; « Cahier des charges » = ClipboardList (`planSouhaite`), « Création » = Sparkles ; première activation de Création → `FenetreDuModeCreation`, préférence `creation.expliquee`.
6. Allumage auto — `jugerLaComplexite` (shared/src/demande-complexe.ts) ; ws.ts `allumerSurDemandeComplexe` pose planSouhaite+planAutomatique seulement si planSouhaite === undefined, et joint `consigneDeDemandeComplexe`. card.plan.souhaite efface planAutomatique.
7. Aperçu — web/src/components/volet-apercu.tsx sur `Project.devUrl` ; bouton AppWindow dans l'en-tête de card-panel (ordinateur, hors cahier) ; ouvert : Tabs en w-[400px], aperçu flex-1.
8. Auto — `parcours.lancementAutomatique`, commande card.lancement.automatique, `InterrupteurLancementAutomatique` (parcours-carte.tsx) collé au bouton scindé ; `raisonDAttendreLeLancement` ; runtime `brancherFinDeTourDeCadrage` → ws.ts `lancerSiAutomatique` attend !isRunning (120 s max), valide puis startCard ; refus = jalon rouge « Lancement automatique refusé ».

## Vérification

npm run build puis node --test server/dist/test/garde-attentes.test.js server/dist/test/repartition-du-temps.test.js server/dist/test/demande-complexe.test.js server/dist/test/lancement-automatique.test.js ; à blanc : echo '{"tool_input":{"command":"npm run dev"}}' | node server/garde-demon.mjs → code 2 et texte de refus.

## Pièges

- Ne JAMAIS brancher un post-traitement de cadrage par `onComplete` : `parLaFile` exige `!onComplete`, la demande ne serait plus mise en file faute de quota.
- `genreDeLEtape` existe déjà dans shared (journal) : la règle du temps s'appelle `genreDeTempsDeLEtape`.
- La clé de traduction « Réflexion » vaut « Denktiefe » (réglage) : la part s'appelle « Réflexion du modèle ».
- Un site qui pose X-Frame-Options reste blanc dans l'aperçu ; après 10 s le volet propose l'onglet.
