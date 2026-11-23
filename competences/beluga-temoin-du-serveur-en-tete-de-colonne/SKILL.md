---
name: beluga-temoin-du-serveur-en-tete-de-colonne
description: À utiliser dès qu'on touche à la tête de la colonne de gauche de Beluga (icône de l'application à la place du nom, point d'état du serveur gris-vert / orange / rouge, bouton « Déplier le menu » de la colonne repliée) ou aux points d'alerte posés sur les icônes de la bande repliée.
etat: active
themes: interface, serveur, colonne
symptomes: le point du serveur ne change pas de couleur, rouge sur une simple reconnexion, icône décentrée dans la colonne repliée, point d'alerte qui décale une icône, le nom Beluga est revenu en tête, point de liaison au pied de la colonne
projets: Beluga
---

# beluga-temoin-du-serveur-en-tete-de-colonne

## Procédure

1. LE TÉMOIN : web/src/components/temoin-du-serveur.tsx (`TemoinDuServeur`, repère `data-temoin-serveur=stable|redemarrage|eteint`, point `data-point-du-serveur`). Icône /icon.svg 28 px (26 en bande), coins 8 px, point 9 px en absolute -right/-top 3 px avec liseré `ring-2 ring-[hsl(var(--fond-zone))]`.
2. LA RÈGLE PURE : `teinteDuTemoinServeur(state.canal, state.canalCoupeDepuis, maintenant)` dans shared/src/panne-serveur.ts. en-ligne → stable ; reconnexion → orange, puis rouge passé `DELAI_CANAL_COUPE` (15 s, le seuil de l'alerte « le serveur ne répond pas ») ; redemarrage → orange, rouge après `DELAI_REDEMARRAGE_TROP_LONG` (3 min) ; resynchronisation et muet → orange. Le hook relit l'heure chaque seconde pendant une coupure seulement. Ne jamais lire `state.connected` seul.
3. LES COULEURS : jetons `--temoin-stable` et `--temoin-redemarrage` déclarés à côté de `--etat-termine` (trois blocs de styles.css : sombre, clair, repli), rouge = `bg-danger`. Ils sont dans la liste des jetons colorés admis de scripts/verif-themes.mjs, et `[data-temoin-serveur]` est exempté du contrôle « une couleur à l'écran ». Jamais `bg-[hsl(28 …)]` en dur : refusé.
4. LA TÊTE (sidebar.tsx) : dépliée, `<span data-nom-application>` porte le témoin dans un `Tooltip` (texte `useTexteDuTemoinServeur` : « Connecté au serveur », « Redémarrage du serveur… », « Serveur injoignable »). Repliée (`bandeSeule`), le bouton `data-deplier-colonne data-replier-colonne="reduite"` contient le témoin, remplacé par PanelLeft en `group-hover/deplier` et `group-focus-visible/deplier`. Le survol de la bande ouvre déjà le panneau (`ouvrirAuSurvol`) : la bascule se voit surtout au clavier. Sur téléphone la même tête porte le témoin.
5. LE PIED : `QuotaBadge` n'a plus de prop `liaison` ni de point `data-point-etat` ; « LLM en ligne » ne dit plus « Reconnexion… ». `useEtatDeLiaison` a été retiré.
6. POINTS D'ALERTE EN BANDE (services-de-la-colonne.tsx) : en bande, le point se pose DANS un `span.relative` qui enveloppe l'icône (`CLASSE_POINT_SUR_L_ICONE`), jamais en enfant flex après l'icône : sinon l'icône sort de l'axe. Déplié, le point reste en bout de ligne.

## Vérification

npm run build puis node --test server/dist/test/panne-serveur.test.js (règle des teintes) ; env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-temoin-du-serveur.mjs : démon jetable, 16 contrôles (témoin stable en tête, plus de point au pied, point au coin, préparation de déploiement → menu Publier sans tiroir, icônes de la bande sur le même axe à 0 px près, point de Services sur le coin de son icône, téléphone 390 sans débordement, démon tué → orange à 4 s puis rouge après 15 s), captures clair/sombre dans /tmp/verif-temoin-du-serveur. Puis HAIKO_THEMES_URL=… node scripts/verif-themes.mjs. Preuve : carte « Colonne repliée et témoin du serveur », commits 80918d16 et 748b240f, 18/11/2026.

## Pièges

Ne pas lancer scripts/nettoyer-essais.mjs avec un ancien motif large : « %témoin% » a effacé la vraie carte de ce travail (corrigé en « Carte témoin% »). Un fichier neuf non ajouté à git est invisible du détecteur d'exports morts (scripts/exports-morts.test.mjs) : `git add` avant de le lancer. L'icône est noire : en thème sombre elle se lit par son liseré, pas de cadre à ajouter (aucune bordure).
