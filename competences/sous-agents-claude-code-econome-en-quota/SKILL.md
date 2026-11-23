---
name: sous-agents-claude-code-econome-en-quota
description: À utiliser dès qu'un agent Claude Code lancé en ligne de commande (claude -p) délègue à des sous-agents (outil Agent / Task), ou qu'on veut qu'il le fasse pour aller plus vite ou consommer moins : « les sous-agents font-ils gagner du quota ? », « faire chercher par un modèle léger », « la consommation des sous-agents n'apparaît nulle part », « le tour rend deux résultats », « les jetons du tour sont sous-comptés quand un agent délègue ». Dit comment les encadrer et comment mesurer leur part.
etat: active
themes: agents, moteur, quotas, methode
symptomes: sous-agents sur le modèle le plus cher, aides en parallèle qui font monter le quota, le tour rend deux événements result, consommation des sous-agents invisible, jetons du tour sous-comptés, l'agent répond « j'attends le résultat de l'aide »
---

# sous-agents-claude-code-econome-en-quota

## Symptôme

Un agent Claude Code délègue à des sous-agents : ils prennent par défaut le même modèle que lui (le plus cher), repartent de zéro, tournent en arrière-plan, et leur consommation ne se voit dans aucun total du tour.

## Cause

Une aide relit le dépôt de zéro : plusieurs aides en parallèle accélèrent mais coûtent plus. Le seul gain vient d'une aide sur modèle léger qui lit et rend court, car la conversation du principal, relue à chaque appel, reste petite. Côté mesure (Claude Code 2.1.296) : `usage` d'un événement `result` ne compte QUE le principal et SON morceau de tour ; `modelUsage` cumule le processus entier, aides comprises, par modèle. Une aide en arrière-plan coupe le tour en plusieurs `result` (« j'attends son retour », puis la suite), et garder le dernier `usage` perd les morceaux précédents.

## Procédure

1. Vérifier la version : `claude --version`, `claude --help | grep -A4 -- --agents`.
2. Redéfinir l'aide de recherche intégrée par `--agents '{"Explore":{"description":"…","prompt":"…","model":"haiku","tools":["Read","Grep","Glob","Bash"]}}'` : une définition passée en ligne de commande remplace celle du même nom. Le prompt de l'aide exige un retour court (15 lignes), chaque fait avec `chemin:ligne`, « introuvable » plutôt que deviné.
3. Fermer les aides qui écrivent ou héritent du modèle cher : `--disallowedTools 'Agent(general-purpose),Agent(Plan)'` (la règle `Agent(<type>)` est refusée par l'outil, quel que soit le mode de permission).
4. Demander le premier plan dans la DESCRIPTION de l'aide (« lance-la avec run_in_background: false ») : le champ `background: false` de la définition ne suffit pas. Au premier plan, le principal n'a pas d'aller-retour « j'attends ».
5. Garder la définition identique d'un tour à l'autre, et la règle de délégation dans la consigne système STABLE, pour ne pas casser le préfixe du cache.
6. Mesurer : additionner les `usage` de TOUS les `result` du processus (principal), puis part des aides = somme de `modelUsage` − ce cumul, poste par poste (entrée, cache lu, cache écrit, sortie), bornée à 0. La taille du contexte reste celle du dernier `result`.
7. Juger sur la part de quota consommée par tâche, avant / après, pas sur les jetons : un jeton du modèle léger coûte bien moins.

## Vérification

Lancer un vrai tour `claude -p --output-format stream-json --verbose` avec la définition, sur une recherche large : l'appel `Agent` porte `subagent_type: "Explore"` et `run_in_background: false`, un seul `result` est émis, `modelUsage` montre une ligne du modèle léger, et la part calculée ne contient que ce modèle. Une demande `general-purpose` est refusée. Preuves : carte « Sous-agents économes en quota » (Beluga), commit 99f3badc ; mesuré le 13/10/2026 : principal 84 k jetons au premier plan contre 126 k en arrière-plan sur une question semblable.

## Pièges

Un résumé faux de l'aide légère égare le principal : exiger chemins et lignes, et vérifier ce qui fonde une décision. Les aides de premier plan tournent dans le processus du moteur : l'arrêt du processus les coupe. Le flux `stream-json` émet un `result` par morceau : un démon qui traite chaque `result` comme la fin du tour se trompe.

## Ce qui ne marche pas

`background: false` dans la définition d'agent : l'aide part quand même en arrière-plan. Repérer le principal dans `modelUsage` par « le modèle le plus proche du total de usage » : rate une aide sur le même modèle (elle se fond dans sa ligne) et compte comme aide le morceau précédent du principal. `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` coupe AUSSI les commandes longues en arrière-plan : trop large.
