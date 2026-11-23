---
name: beluga-adresse-des-tiroirs
description: À utiliser dès qu'on ajoute ou modifie un tiroir (Drawer) de Beluga Build et qu'il doit avoir sa propre adresse (#…?tiroir=…), ou devant : « rafraîchir ferme le tiroir », « Précédent ne referme pas le tiroir », « le tiroir se rouvre tout seul », « un lien collé n'ouvre pas le tiroir », « l'adresse est effacée au rechargement ».
etat: active
themes: interface, navigateur, tests
symptomes: le tiroir se ferme au rechargement, Précédent ne ferme pas le tiroir, adresse sans tiroir après rechargement, tiroir qui se rouvre après fermeture
projets: Beluga
---

# beluga-adresse-des-tiroirs

## Procédure

1. Dans le composant qui TIENT l'état d'ouverture du tiroir (booléen), ajouter `useTiroirAdresse('nom-court', ouvert, setOuvert, { pret })` — `web/src/lib/tiroirs-adresse.ts`. Le nom est un mot court en minuscules et tirets, UNIQUE dans l'application. `pret` = les données dont le tiroir a besoin sont arrivées (défaut vrai). Le crochet va avant tout `return` anticipé.
2. Tiroir dont l'état est un objet (site surveillé, fiche) : dériver un booléen et un setter (`ouvert => setX(...)`), voir « nouveau-site-surveillance » dans `surveillance.tsx`.
3. Un tiroir posé dans un tiroir (formulaire de création sous une liste) : crochet dans le composant du second tiroir, qui ne se monte que sous le premier ; l'ordre de la pile suit celui de l'adresse lue.
4. Ne PAS brancher un tiroir dont l'ouverture dépend d'un état non rejouable (mot de passe montré une fois, conversation d'un agent, sélection) : il s'ouvre sans adresse.
5. L'adresse est écrite par `app.tsx` seul (effet d'écriture), jamais par un composant ; la forme est dans `shared/src/adresse-navigateur.ts` (`tiroirs?: string[]`, `memeTiroirs`), avec ses tests dans `server/src/test/adresse-navigateur.test.ts`. Les fragments des courriels déjà partis ne bougent pas.
6. Ajouter le tiroir à la liste `AUTRES` de `scripts/verif-tiroirs-adresses.mjs`.

## Vérification

`npm run build && npm test`, puis `npm run dev --workspace web -- --port 7099` et `env -u BELUGA_TOKEN HAIKO_ADRESSES_URL=http://localhost:7099 node scripts/verif-tiroirs-adresses.mjs` : accès clients (silhouettes, bouton Ajouter, second tiroir, rechargement, Précédent en un appui, lien collé) et six autres tiroirs rouverts par leur adresse. Puis `node scripts/nettoyer-essais.mjs`. Preuves : carte 1d9f91, commits f7b88a36 et 6f6f188a.

## Pièges

- La pile doit arriver à `app.tsx` par un état ORDINAIRE (`usePileDeTiroirs`), jamais par `useSyncExternalStore` : celui-ci rend avant les autres états posés par la lecture de l'adresse, et l'écrivain réécrit la pile sous l'ancien écran (adresse perdue au rechargement).
- Un tiroir désigné par l'adresse mais pas encore monté reste « en attente » dans la pile écrite ; sans cela la première réécriture efface le lien collé. L'attente tombe quand le tiroir s'ouvre ou que l'écran change.
- Fermer un tiroir au clic RECULE d'un cran (`history.back()`, marque `belugaTiroir` dans `history.state`) au lieu d'empiler une entrée : sinon Précédent le rouvrirait. Sans la marque (lien collé), c'est un `replaceState`.
- La descente (adresse → tiroir) ne vient que de la lecture de l'adresse (`appliquerTiroirs`), jamais de l'écho de ce que le tiroir a lui-même écrit — même leçon que MEM-3280.
- L'application rouvre d'elle-même la carte retenue du projet : elle recouvre le menu replié. Les contrôles entrent par l'adresse (`page.goto(#…)`), pas par un clic dans le menu.
- Une adresse d'élément (fiche du coffre, site sauvegardé) a déjà son mot : le tiroir de cet élément ne se rebranche pas ici.

## Ce qui ne marche pas

Mettre l'ouverture dans un effet qui dépend de l'état du tiroir : boucle d'ouverture/fermeture. Écrire un fragment à la main dans un composant : deux écrivains, adresses incohérentes.
