---
name: beluga-appel-de-moteur-a-part-depuis-un-bouton
description: À utiliser dès qu'un bouton de l'interface Beluga doit faire travailler un modèle EN ARRIÈRE-PLAN sans relancer l'agent ni toucher sa conversation (suggestions, reformulation, résumé à la demande) : « ça doit faire une recherche en background », « sans relancer l'agent », « le bouton reste sur Recherche… », « client is not defined » dans le journal du démon.
etat: active
themes: agents, interface
symptomes: bouton bloqué sur Recherche…, client is not defined, la conversation de l'agent reçoit un tour de trop, la carte change de colonne après un clic
projets: Beluga
---

# beluga-appel-de-moteur-a-part-depuis-un-bouton

## Procédure

1. Règle pure dans shared/src/ (la demande au moteur, la lecture TOLÉRANTE de sa sortie — JSON cherché entre le premier « [ » et le dernier « ] », trop long coupé au mot — et la fusion), testée dans server/src/test/.
2. Module démon calqué sur server/src/autres-idees.ts (lui-même calqué sur mode-creation.ts) : `pickAccount(agent.run.engine)` → `adapterFor(engine).run({ cwd: mkdtemp, prompt, model: agent.run.model, fullAccess:false, role:'task', disallowedTools: écriture fermée, env: applyAccountEnv(compte), plafondMs })` SANS sessionId ; texte relevé sur les événements 'text' ; dossier supprimé en finally. Verrou en mémoire par cible. Point d'injection d'un faux moteur + garde `NODE_TEST_CONTEXT`.
3. Commande dans `ClientCommand` (shared/src/protocol.ts) et un `case` dans `handleCommand` (server/src/ws.ts) : les commandes sont traitées en parallèle, on peut donc ATTENDRE le résultat et rendre `{ok, raison}` en données (pas en exception : `phrasePourLEcran` réécrirait le texte).
4. Écriture aux deux endroits qui portent la donnée (message + jalon `completerDonneesDuJournal`), puis `bus.emit` `message.upsert` et `journal.entree` : tous les appareils suivent.
5. Interface : état local `repos | recherche | echec`, `client.call(cmd, 120000)`, libellé « en cours » dès le clic (règle « un bouton qui part en requête le dit dès le clic »), textes dans shared/src/traductions.ts.

## Vérification

`npm run build && npm test` (autres-idees.test.ts, suites-proposees.test.ts), puis `env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-autres-idees.mjs` : démon jetable sur 7198, vrai Chrome, un appel réel au modèle léger ; tout doit finir sur « Tout est bon. » (suites ajoutées, nouvel onglet, aucun message de plus, session et colonne intactes, jalon aligné).

## Pièges

- `npm run build` de l'interface (vite) NE VÉRIFIE PAS LES TYPES : un `import { client }` oublié construit sans erreur et casse seulement à l'exécution (« interface fenetre — client is not defined » dans le journal du démon, bouton figé sur « Recherche… »). Lancer `npx tsc --noEmit -p web/tsconfig.json` sur les fichiers touchés.
- Le détecteur d'exports morts (npm test) ne voit que les fichiers suivis par git : un nouveau module encore non ajouté rend ses appelés « sans appelant » — `git add -N` avant de juger.
- Dans un démon jetable, une carte posée en base dont la vue est rechargée par `page.reload` peut afficher « Cette tâche n'existe plus » ; ouvrir un NOUVEL onglet sur l'adresse de la carte juge mieux la persistance.
- Le fil d'une carte ne montre la réponse avec ses suites que si le jalon s'appelle « Réponse rendue » (phase 'rapport', `tour_id` = id du message).
