---
name: beluga-travaux-des-services-dans-la-colonne
description: À utiliser dès qu'un travail de fond d'un service Beluga (étude marketing, export du Studio, audit SEO + GEO, sauvegarde, ou tout nouveau travail long) doit paraître dans « En cours » et sous son projet dans la colonne de gauche, ou quand une de ces lignes reste coincée, disparaît trop tôt, se double avec l'agent du service, ne s'efface pas à l'ouverture du service, ou concerne un travail récurrent (tournée automatique) qui ne doit pas s'y voir.
etat: active
themes: interface, colonne de gauche, services
symptomes: un agent de service disparaît de En cours alors que son étude tourne encore, une vidéo du Studio qui rend sans rien dans la colonne, deux lignes pour l'agent marketing et son étude, une ligne finie qui ne s'efface pas en ouvrant le service, un travail tombé affiché comme fini, le compteur En cours faux, les sauvegardes de la nuit encombrent la colonne
projets: Beluga
---

# beluga-travaux-des-services-dans-la-colonne

## Cause

Un agent de service sans carte ne paraît dans « En cours » que pendant son tour (`agentsDeLaBande`), alors que son travail de fond continue. Carte « Agents des services dans la colonne » (25/11/2026, commit 8c2cb9e50, maquette #cdea) : une ligne par travail de fond, l'agent qui répond fondu dedans ; fini, la ligne reste en gras jusqu'à l'ouverture du service (décision de l'utilisateur) ; contrôles éclair de la surveillance exclus. Carte « Masquer les sauvegardes de la colonne » (25/11/2026, commits eed57bdd5 + 6e69b0604) : la colonne ne montre QUE LE PONCTUEL, jamais le récurrent (décision de l'utilisateur) — la tournée automatique des sauvegardes en sort.

## Procédure

1. RÈGLES PURES : shared/src/travaux-des-services.ts — `TravailDeService` (id `<service>:<source>`, projectId, nature, objet, adresse d'écran sans « # », faits/total ou pourcent, etat en-cours|termine, debut, fin, source opaque) ; `suivreLesTravaux` (un absent du relevé est jugé à sa source : termine reste, tombe sort ; finis gardés 7 jours ; le début du premier relevé est gardé), `travauxDuCompte`, `marquerLesTravauxVus`, `ecranDuTravail` (égal, page dessous, ou objet ouvert dans un projet `…/studio/<c>`), `lignesDesServices` (fusion agent + travail du même écran), `sansLesTravauxRecurrents` (retire le récurrent, `null` si rien ne sort). Test : server/src/test/travaux-des-services.test.ts.
2. DÉMON : server/src/travaux-des-services.ts relève toutes les 4 s chaque source inscrite (`inscrireUneSourceDeTravaux({ service, enCours(), issue(t) })`). Sources publiques : Studio (`studio_exports` en-file/en-cours ; fini = `pret`) et sauvegardes (`backupsEnCoursVisibles` de backups.ts = verrou `enCours` moins `enCoursAutomatique`, rempli par `prendreUnBackup(id, 'automatique')` ; manuelles et restaurations + filet restent ; fini = point non `echec`). `backupsEnCours()` reste le verrou complet, lu par ws.ts : ne jamais le filtrer. Au démarrage, `retirerLesSauvegardesAutomatiques` retire les lignes `backups:*` gardées dont le point (même site, début ≥ début − 60 s, le plus récent) a `json_extract(data,'$.origine')` ≠ 'manuel' ; sans point, la ligne reste au jugement de `issue`. Sources PRIVÉES (`@prive-fichier`) dans server/src/travaux-marketing.ts : missions `strategie_missions` actives (fini = completed/partially_completed, adresse `marketing/<dossier>`) et `auditsEnCours`/`auditAbouti` de referencement.ts (adresse `marketing/<dossier>/referencement`). Une source qui lève garde ses travaux tels quels. Liste + vus par compte en meta `travaux-des-services` ; événement `travaux.services` seulement si `signatureDesTravaux` change ; ws.ts le réduit à chaque compte (`travauxDuCompte`).
3. COMMANDES `travaux.services.lire` / `travaux.services.vus` : administrateur seul (refus par défaut des autres rôles, rien à ajouter dans droits-commandes).
4. ÉCRAN : web/src/components/travaux-des-services.tsx — `useLignesDesServices(projectId?)` (charge une fois, puis suit l'événement), `LignesDesTravauxDeService` dans `TachesEnCours` (ajouté au compteur) et `TachesDuProjet` ; ligne = `LienInterne` avec `IconeDeLAgent petite` (rond travail / a-vous / coche `a-deployer` quand fini), libellé « Nature · objet » tronqué, avancement à droite ; fini = `font-semibold`. Les agents AVEC `service` (hors chefs) ont quitté `LignesDesAgentsSansCarte`. `useTravauxVusALOuverture` (dans `App`) marque vus les finis de l'écran ouvert.
5. NOUVEAU TRAVAIL DE FOND : inscrire une source (et sa nature + libellé `t()` dans `natureLisible` + traductions.ts), jamais une ligne à part dans la colonne. S'il est RÉCURRENT (tournée planifiée), sa source ne le relève pas : suivre son origine à côté du verrou, comme `enCoursAutomatique`.

## Vérification

`npm run build` puis `node --test server/dist/test/travaux-des-services.test.js server/dist/test/travaux-sauvegardes-automatiques.test.js` (9/9 le 25/11/2026 : sauvegarde automatique tenue par le verrou mais invisible, manuelle visible, purge des lignes automatiques héritées, manuelle et sans point gardées, idempotente). Puis, depuis la copie de la carte : `env -u BELUGA_TOKEN -u BELUGA_URL VERIF_CAPTURES=/tmp/x node scripts/verif-travaux-des-services.mjs` (32/32 : fusion agent + étude, icône du projet, « 42 % », compteur, ligne sous le projet déplié, avancement en direct, fini en gras, clic vers le Studio, vu gardé au rechargement, export tombé retiré, dossier marketing ouvert qui retire l'étude, menu du téléphone 390 px, clair et sombre). Régression : `node scripts/verif-sous-agents.mjs` (56/56). Purge sur données réelles sans risque : copier la base servie par l'API `backup()` de better-sqlite3 dans un dossier temporaire, puis `BELUGA_DATA=<tmp> node` en important `server/dist/travaux-des-services.js` (`travauxSuivis`, `retirerLesSauvegardesAutomatiques`).

## Pièges

- Un décor d'essai pose missions, exports et agents APRÈS le démarrage : le démon met en pause les missions actives et efface les états « au travail » en démarrant. La purge des sauvegardes automatiques ne tourne qu'AU DÉMARRAGE : un décor posé après ne la voit pas, l'essayer par l'appel direct.
- Le projet `isSelf` (espace de développement) n'a pas la flèche `[data-deplier-taches]` comme les autres : tester « sous le projet » sur un projet ordinaire.
- Une création du Studio inventée en base ramène `#studio/c1` à `#studio` : vérifier le `href` de la ligne, pas l'adresse finale.
- `exports-morts` ne voit ni un appel par `import()` dynamique ni un fichier non suivi par git : importer statiquement, `git add -N` avant le test.
- `pkill -f`/`xargs kill` sont refusés par la garde du démon : tuer le serveur de développement par son pid lu avec `ss -ltnp`.
- L'origine d'un point de sauvegarde vit dans le JSON `data` de `backup_points`, pas dans une colonne ; absente = automatique (comme `pointDepuisLigne`).

## Ce qui ne marche pas

- Instrumenter chaque sous-système avec ses propres événements : écarté, un travail coupé par un redémarrage restait « en cours » sans personne pour le fermer.
- Montrer l'agent de service ET son étude en deux lignes : refusé (doublon), fusion par l'écran.
- Remplacer le verrou `enCours` des sauvegardes par une table d'origines : écarté, il sert aussi à la restauration et à refuser un second backup du même site ; l'origine se range À CÔTÉ.
