---
name: ecran-retrouve-au-retour-arriere-react-router
description: À utiliser dès qu'une application React à routes (react-router, BrowserRouter) perd l'état d'un écran quand on en revient par le bouton retour : « le volet se referme quand je reviens », « le tiroir reprend sa hauteur de départ », « la carte se recadre au retour », « l'onglet choisi est oublié », ou avant de ranger un état d'interface dans sessionStorage pour le retrouver. Dit comment garder l'état par entrée d'historique, en mémoire seulement.
etat: active
themes: interface, navigateur, mobile
symptomes: volet refermé au retour arrière, tiroir revenu à sa hauteur de départ, carte recadrée au retour, état d'écran perdu en changeant de route
---

# ecran-retrouve-au-retour-arriere-react-router

## Symptôme

On ouvre un volet, on suit un lien vers un autre écran, on revient : le volet est fermé, la position perdue, tout est comme à la première arrivée.

## Cause

L'écran est démonté dès que sa route n'est plus affichée : tout `useState` meurt avec lui. Le retour arrière remonte un écran neuf.

## Procédure

1. Écrire un crochet de même signature que `useState`, par exemple `useEntryState(nom, initial)` : il lit `useLocation().key`, initialise la valeur depuis un magasin en mémoire de module (`Map` clé d'entrée → `Map` nom → valeur) et, dans un `useEffect([key, nom, valeur])`, y range la valeur.
2. `location.key` est gardée par le navigateur dans l'entrée d'historique : un retour (ou un « suivant ») retrouve la même clé donc la valeur ; un lien ou un onglet crée une entrée neuve donc la valeur de départ ; un rechargement complet garde la clé mais vide la mémoire, donc valeur de départ.
3. Borner le magasin (une trentaine d'entrées, la plus anciennement servie oubliée) : la logique pure se teste sans navigateur.
4. Ranger un objet du serveur par son identifiant et le retrouver dans les données fraîches, pas l'objet lui-même s'il sert à une comparaison d'identité.
5. Relire les effets de l'écran qui « remettent à zéro » au montage (changement de ville, de filtre, recadrage automatique) : ils doivent comparer à la valeur mémorisée, sinon ils effacent ce qu'on vient de restaurer.
6. Un réglage qui doit tenir toute la session quel que soit le chemin (hauteur d'un tiroir) va dans une simple variable de module, pas dans ce crochet.
7. Une carte (MapLibre…) : faire remonter centre et zoom à chaque arrêt, repartir de là au montage, et neutraliser le recadrage automatique de l'arrivée.

## Vérification

Dans Playwright : ouvrir le volet, cliquer le lien, `page.goBack()` → le volet (`[aria-modal=true]`) est présent avec le même titre ; cliquer un lien de navigation vers le même écran → état de départ ; `page.reload()` → état de départ. Pour une carte, comparer les coordonnées à l'écran des repères avant et après (± 3 px), après l'avoir déplacée pour ne pas confondre avec le cadrage par défaut. Test unitaire du magasin : même entrée rend la valeur, autre entrée rien, plafond respecté.

## Pièges

- Une navigation `replace` (filtres écrits dans l'adresse) change `location.key` sans démonter l'écran : c'est pourquoi l'écriture se fait dans un effet dépendant de la clé, pas seulement dans le setter.
- Essayer avec `page.goto` recharge l'application et vide la mémoire : cliquer et utiliser `goBack`.
- La première entrée d'une session porte la clé `default` : rien à faire, elle se comporte comme les autres.
- Le volet restauré rejoue son animation d'entrée ; c'est en général acceptable.

## Ce qui ne marche pas

sessionStorage ou localStorage : l'état survit au rechargement et à la fermeture de l'onglet, et il faut le sérialiser. Remonter l'état dans un contexte global par écran : il revient aussi quand on arrive par un lien neuf, ce que l'on ne veut pas. `ScrollRestoration` de react-router : réservé au routeur à données et au seul défilement.
