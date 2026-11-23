---
name: beluga-navigation-telephone
description: À utiliser dès qu'un écran de Beluga change sur téléphone : le haut commun d'un projet (« Tâches », nom centré, ⋮, Publier, rangée d'onglets et son « + »), l'air sous les boutons de la barre du haut, la page d'une tâche ouverte sous ce haut, le menu du bas d'un service, le geste principal d'une page, le projet affiché en haut — ou devant « il faut toucher deux fois un onglet », « le haut change quand j'ouvre une tâche », « deux rangées d'onglets », « on ne sait plus où on est », « le bouton du bas a disparu », « le projet ne s'affiche pas en haut », « pas d'espace sous les boutons du haut ».
etat: active
themes: navigation, telephone, interface
symptomes: il faut toucher deux fois un onglet, le haut change en ouvrant une tâche, deux rangées d'onglets à l'écran, on ne sait plus où on est sur téléphone, le geste principal n'apparaît pas dans le tiroir, le projet manque dans le haut de l'écran, un bouton du bas mène à la mauvaise marque, le titre n'est pas centré, pas d'espace sous les boutons de la barre du haut
projets: Beluga
---

# beluga-navigation-telephone

## Procédure

LE HAUT HORS D'UN PROJET (13/11/2026) : PLUS DE ☰. À gauche, la flèche de retour quand on est descendu d'un niveau (`SuiteDuFil retour`, `[data-retour-du-fil]`), sinon rien. Le NOM CENTRÉ en calque (`EnteteDeZone`, branche `nomCentre`, `etagesTelephone` = `EtagesDuTelephone` de `haut-du-telephone.tsx`) est `BoutonDuNomQuiOuvreLeMenu` (`[data-menu-principal][data-haut-titre][data-haut-liste="menu"]`) : il ouvre le MENU PRINCIPAL partout. Un bouton à gauche, deux au plus à droite (le robot `BoutonAssistantEntete`, puis ⋮ `MenuDuHautTelephone`). Barre du nom : 44 px de rangée (2.75rem + zone sûre), compacte sous l'heure, PLUS l'air du bas. AUCUN point d'état dans le haut.

LE HAUT D'UN PROJET (décision de l'utilisateur du 13/11/2026, carte « Haut d'un projet fixe sur téléphone ») — LE MÊME sur l'accueil, une tâche et un outil du projet :
- app.tsx enveloppe `EnteteDeZone` + `RangeeDOngletsTelephone` dans `[data-haut-du-telephone]` (`hautDuProjetTelephone = telephone && projetDesOnglets`) et mesure son bas dans `--bas-du-haut-telephone` (ResizeObserver, sur `html`).
- Gauche : `BoutonTachesDuHaut` (`insigneAGauche`, `[data-taches-du-haut]`, ListTodo, violet `[data-actif-du-haut]` sur l'accueil, `activerLOnglet(null)`). Ni flèche (onRetour coupé dans un projet), ni logo du projet.
- Droite : ⋮ puis `BoutonPublierDuHaut` (menu-publier.tsx, `[data-publier-du-haut][data-bouton-publier]`, icône Rocket violet plein, pastille du nombre en attente, ouvre la feuille `FeuillePublier` par `EVENEMENT_OUVRIR_PUBLIER`, garde `GestesDePublicationDeCarte enMenu` monté caché). Le robot devient une ligne des trois points (`EntreeAssistantDuMenu`, `[data-assistant-entete]` : prop `assistant` de `MenuDuHautTelephone`, et dans l'en-tête de `MenuCarte`).
- Rangée : `RangeeDOngletsTelephone onNouvelleTache` pose un « + » fixe en tête (`[data-nouvelle-tache-onglets]`, `nouvelleTacheDuProjet` → `creerCarteAgent`, garde `nouvelAgentEnCours`, roue pendant la création). `OngletsDuProjet sansIcone` (téléphone) ne rend PAS l'onglet « Tâches ».
- Bas : rien (`menuDuBas('projet')` = `aucun`). `BoutonPublierDuBas` n'existe plus.

LA PAGE D'UNE TÂCHE SUR TÉLÉPHONE : `CardPanel` et `PageDeFacturation` passent `sousLeHaut` au `Drawer` (`FeuilleDeTiroir` : `top: var(--bas-du-haut-telephone)`, paddingTop 0, `[data-sous-le-haut]`) et ne rendent AUCUNE `EnteteDeZone` (silhouette comprise). Le ⋮ de la tâche (`menuDeLaCarte` = `MenuCarte` : branche en 1re ligne `data-voir-la-branche`, volet `data-ouvrir-le-volet`, « Outils du projet », Assistant) part par `createPortal` dans `[data-menu-de-tache-ici]` (contexte `FournirLaCibleDuMenuDeTache`), seulement si la page est visible (`useVueVisible`) ; le `MenuDuHautTelephone` de l'accueil est alors caché (`hidden`, toujours monté pour la cloche). Sur tablette et ordinateur, la tâche garde sa propre barre.

ÉCRAN TACTILE : rien dans un onglet ne paraît au survol — la croix d'un onglet inactif est `[@media(hover:none)]:hidden` (iOS garde sinon le premier appui pour le survol : « toucher deux fois »).

AJOUTER UNE DESTINATION AU MENU DU BAS : la classer (fréquence × urgence) dans `GESTES_DU_MENU_DU_BAS` et le classement de son service (`shared/src/menu-du-bas.ts`) ; libellé, icône, geste, `actif`, `compte` dans `useGestesDeLApplication` (menu-du-bas.tsx) ou déclarés par la page (`useDeclarerLesGestesDuBas`, gestes mémorisés) ; libellés à `shared/src/traductions.ts` ; mettre à jour `docs/mecaniques/menu-du-bas.md` et `server/src/test/menu-du-bas.test.ts` (et `marketing.test.ts`, qui teste aussi le bas d'un projet).

LE GESTE PRINCIPAL D'UNE PAGE : `<GestePrincipal><BoutonPrincipal …/></GestePrincipal>` (entete-de-zone.tsx). LE PROJET DU HAUT : fourni par l'application (`useEtageDuProjetActif`) ou déclaré par la page (`useDeclarerLeProjetDuHaut(etage mémorisé)`).

L'AIR SOUS LES BOUTONS DU HAUT (18/11/2026, carte d24674, capture #b688, maquette #d2f0) : sur téléphone, 12 px entre le bas des boutons et le bas de la barre, comme la marge latérale — les deux variantes propres au téléphone (`nomCentre` 44 px, `titreCentre` 48 px) ajoutent `paddingBottom: complementSous(rangée)` = 12 − (rangée − 40)/2 (`AIR_SOUS_LES_BOUTONS_DU_TELEPHONE`, `BOUTON_DU_HAUT` = 40 : ☰ et ⋮ font 40 px au téléphone, pas 38). Le haut ne bouge pas (2 px sous la zone sûre). Le calque du nom de `nomCentre` est posé à `bottom: complementSous(44)` pour rester centré sur les boutons. Ordinateur inchangé (barre du projet 52 px, 10 px dessous).

## Vérification

`npm run build` puis `npm test` (menu-du-bas.test.ts, marketing.test.ts, verif-reperes-des-controles.test.mjs). Serveur d'essai `env -u BELUGA_TOKEN -u BELUGA_URL npm run dev --workspace web -- --port 7099`, puis `env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-onglets-instantanes.mjs` (52 contrôles : haut identique accueil/tâche mesuré au pixel, une seule rangée, page sous le haut, un seul appui AU DOIGT sur un onglet — `touchscreen.tap` après sonde `elementFromPoint` —, « Tâches » ramène à l'accueil, le « + » ne demande qu'UNE création même touché deux fois, `card.create` retenu) et `node scripts/verif-menu-bas-telephone.mjs` (74 : dans un projet « Tâches » à gauche, ⋮ puis Publier, rien en bas). `HAIKO_LANGUES_URL=http://localhost:7099 node scripts/verif-langues.mjs`. Captures 390 et 1440, clair et sombre. `node scripts/nettoyer-essais.mjs` après. Carte « Haut d'un projet fixe sur téléphone » (e359717b).

Air sous le haut : `env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-air-sous-le-haut.mjs` (démon et serveur d'essai à soi, ports 7243/7143 ; 390 px clair et sombre avec zone sûre simulée de 47 px — carte, projet, tableaux, assistant : 12 px ± 1 dessous, haut à 2 px, nom centré ; 1440 relevé) : 56/56 le 18/11/2026. `VERIF_RELEVE_SEUL=1` pour relever sans juger, `VERIF_CAPTURES=<dossier>` pour les captures.

## Pièges

- L'émulation tactile de Chrome NE reproduit PAS le double appui d'iOS dû au survol : seul un iPhone juge ; supprimer tout contenu qui paraît au survol sur `hover:none`.
- Un onglet hors de l'écran (rangée défilée) a une boîte hors champ : `scrollIntoView({ inline: 'center' })` avant de toucher.
- Ne jamais remettre une `EnteteDeZone` ni une rangée d'onglets dans une page posée par-dessus sur téléphone : deux hauts = le « changement de page » refusé, et deux rangées défilées différemment.
- Le portail du ⋮ d'une tâche ne doit partir QUE de la page visible : une tâche gardée cachée (onglet instantané) qui y écrirait aussi doublerait le bouton.
- `aria-label` reste un texte FIXE : `verif-langues.mjs` refuse `aria-label={t(…)}` ; seul `title` passe par `t()`.
- Un repère retiré de l'interface (`data-bas-de-tache`, `data-insigne-du-haut`) casse `verif-reperes-des-controles.test.mjs` s'il reste dans un script verif : le retirer des scripts.
- Dans un outil du projet (création du Studio, marque), plus de flèche : on revient à l'accueil de l'outil par « Outils du projet » dans les ⋮.
- Un objet `gestes` ou `etage` non mémorisé relance la déclaration à chaque rendu : boucle.
- Le fil d'Ariane reste monté mais caché sur téléphone : ses portails (`SuiteDuFil`, titre de page) en dépendent.
- Ne jamais supposer la taille des boutons du haut : la mesurer (☰ et ⋮ = 40 px au téléphone, Publier 34, nom 38). Un calcul sur 38 laissait 11 px au lieu de 12.
- Un calque `absolute inset-0` sur une barre qui gagne un padding-bottom se recentre sur la nouvelle hauteur : le caler sur la rangée des boutons.
