---
name: filtre-sqlite-sur-json-par-colonne-generee
description: À utiliser dès qu'une requête SQLite cherche des lignes par un morceau de texte JSON (LIKE '%"champ":{%' sur une colonne data) puis décode chaque ligne trouvée, et qu'elle tourne souvent : « le serveur se fige », « gel de la boucle d'événements », « le calcul ralentit à mesure que la table grossit ».
etat: active
themes: performance, base de données
symptomes: serveur Node qui se fige par moments, gels qui doublent avec le volume, pile dominée par zod parse ou JSON.parse dans une lecture répétée
---

# filtre-sqlite-sur-json-par-colonne-generee

## Symptôme

Une lecture rejouée à chaque passage d'ordonnanceur passe un LIKE sur tout le texte JSON d'une table, puis décode en entier chaque ligne trouvée (souvent lourde) pour n'en garder qu'une poignée encore « ouverte ». Le coût suit le volume, pas le nombre de lignes utiles.

## Cause

Le LIKE ne peut pas utiliser d'index et lit tout le texte ; le décodage complet multiplie le coût par la taille moyenne des lignes. Une mise en cache par « la base a-t-elle bougé » ne protège rien dès que d'autres processus écrivent en continu.

## Procédure

1. Écrire le prédicat EXACT « ligne à voir » en SQL, LIKE d'abord puis json_extract derrière un CASE (l'ordre est garanti) et json_valid pour ne jamais faire échouer une écriture : `ALTER TABLE t ADD COLUMN a_x_ouvert INTEGER GENERATED ALWAYS AS (CASE WHEN data LIKE '%"x":{%' AND json_valid(data) THEN json_extract(data,'$.x.choix') IS NULL ELSE 0 END) VIRTUAL;`
2. Index PARTIEL : `CREATE INDEX idx_t_x_ouvert ON t(a_x_ouvert) WHERE a_x_ouvert = 1;` — SQLite tient la colonne à jour à chaque écriture, d'où qu'elle vienne.
3. La requête part de cette table (`FROM t WHERE t.a_x_ouvert = 1 JOIN …`) et ne sélectionne que le champ utile : `json_extract(t.data,'$.x') AS x`, décodé par le schéma du seul sous-objet.
4. Garder en JavaScript le même filtre qu'avant : la colonne est un tamis, pas la vérité.
5. Comparer ancien et nouveau calcul sur une copie réduite des vraies données (mêmes résultats, temps de chacun).

## Vérification

EXPLAIN QUERY PLAN montre « SEARCH t USING INDEX idx_t_x_ouvert » ; un banc sur copie des données donne les MÊMES lignes avant/après et un temps divisé (Beluga, 23/10/2026 : 183 ms → 0,1 ms, 151 ms → 0,2 ms).

## Pièges

Un json_extract sans json_valid devant lève une erreur sur un texte illisible et fait échouer l'INSERT. Une jointure forcée (CROSS JOIN partant d'une autre table) empêche l'index partiel d'être pris : vérifier avec EXPLAIN QUERY PLAN (« USING INDEX idx_… »). Le LIKE peut correspondre à une occurrence imbriquée : json_extract rend alors NULL, d'où le filtre JS conservé. La création de l'index calcule la colonne sur toute la table une fois (≈1 s pour 200 Mo).

## Ce qui ne marche pas

Mémoriser le résultat tant que total_changes()/data_version n'ont pas bougé : inutile dès qu'un agent écrit en continu. Ajouter une colonne ordinaire remplie par le code : une écriture qui l'oublie (script, migration) fausse le résultat.
