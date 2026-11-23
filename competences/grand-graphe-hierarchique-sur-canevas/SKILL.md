---
name: grand-graphe-hierarchique-sur-canevas
description: À utiliser dès qu'une application web doit montrer des milliers d'éléments rangés en arbre (mémoire, catalogue, arborescence, organigramme) comme un graphe en branches qu'on déplace et zoome : « montre toute la base en graphe », « un graphe comme les mémoires d'agents », « ça rame avec 5 000 nœuds », « les noms se chevauchent », « le graphe saute à chaque ouverture », « la recherche doit allumer des nœuds », « remonter le temps dans le graphe ».
etat: active
themes: interface, performance, donnees
symptomes: graphe illisible avec des milliers de nœuds, graphe qui rame au déplacement, noms qui se chevauchent, mise en place qui change à chaque ouverture, grand vide au centre du graphe, graphe invisible pour les contrôles automatiques, graphe qui se réarrange quand on change de date
---

# grand-graphe-hierarchique-sur-canevas

## Procédure

1. Séparer la RÈGLE du DESSIN : une fonction pure construit l'arbre (racine → groupes → sous-groupes → feuilles), une autre calcule les positions ; testables sans navigateur.
2. Mise en place en BALLONS, sans bibliothèque ni simulation de forces : passe 1 des feuilles vers la racine, chaque sous-branche reçoit un disque (feuilles en tournesol autour de leur parent : rayon = pas × √rang, angle = rang × angle d'or) ; passe 2 de la racine vers les feuilles, les enfants se posent autour du parent. Pour des enfants de tailles semblables, éventail à la distance `d0 + rayon` (`d0` trouvé par dichotomie pour que la somme des angles 2·asin((r+écart)/(d0+r)) tienne dans l'ouverture). Pour des tailles très inégales (un groupe de 2 000, d'autres de 5), empiler en SPIRALE : les plus gros d'abord, chacun à la première place libre en s'éloignant ; sinon un grand vide se forme au centre. Garder une ouverture libre vers le parent pour le trait qui arrive.
3. Déterministe et linéaire : mêmes données → mêmes positions (rien ne saute d'une ouverture à l'autre), ~150 ms pour 6 000 nœuds ; pas de Worker ni de cache à gérer. Garder données et positions en mémoire de module, et demander au serveur une signature (nombre + dernière modification) pour ne rien renvoyer si rien n'a bougé.
4. Dessiner sur UN canevas 2D (devicePixelRatio), à la demande seulement (requestAnimationFrame quand quelque chose change, aucune boucle au repos). Grouper traits et points par style (couleur + alpha) dans un seul chemin par paquet ; feuilles en petits carrés sous 1,3 px ; ignorer ce qui sort de l'écran.
5. Rayons À L'ÉCRAN bornés par genre (min/max en pixels) : une feuille reste un point visible de loin, sans grossir sans fin de près.
6. Noms par priorité (racine, groupes, puis sous-groupes selon le zoom, feuilles au-delà d'un seuil), chaque boîte de texte posée seulement si elle ne chevauche aucune autre ; liseré de la couleur du fond derrière le texte ; un nom qui sortirait à droite se pose à gauche.
7. Déplacement, pincement et molette par événements de pointeur (setPointerCapture, deux pointeurs = pincement autour du milieu, molette en écouteur NON passif autour du curseur) ; clic = pointeur relâché sans avoir bougé de 5 px ; atteinte par le nœud le plus proche dans un rayon confortable.
8. Couleurs lues dans les variables CSS du thème (convertir `H S% L%` en `hsl(H, S%, L%)`), relues par un MutationObserver sur la classe de `<html>`.
9. Focus et recherche par OPACITÉ : hors focus 15 %, non trouvé 8 %, le chemin des ancêtres d'un nœud trouvé allumé ; caméra animée (zoom interpolé en logarithme) vers le cadre précalculé de la sous-branche, en retranchant ce qui couvre la toile (barre de recherche, fiche latérale).
10. REMONTER LE TEMPS sans réarranger : charger aussi les éléments retirés avec leur date de retrait, poser l'arbre UNE fois sur toutes les dates (places fixes), puis donner à chaque nœud un NIVEAU à la période regardée par une règle pure (caché : pas né ou déjà retiré à la fin de la période ; estompé : né avant son début ; plein) — un parent prend le niveau du plus vivant de ses enfants, la racine reste. Le dessin multiplie alpha et rayon par une PRÉSENCE animée quelques centaines de millisecondes sur les seuls nœuds qui changent, puis s'arrête ; « animations réduites » = immédiat. Atteinte, recherche et sélection ignorent ce qui est caché ; les jours se calculent dans l'heure locale de l'appareil.
11. Exposer l'état sur le cadre (`data-…` : prêt, nombre de nœuds, visibles, focus, allumés, sélection, zoom, passage en cours) et doubler les résultats de recherche d'une vraie liste de boutons : le canevas est muet pour les contrôles et les lecteurs d'écran.

## Vérification

Test pur de la mise en place : déterministe, tous les nœuds placés, deux sous-branches sœurs ne se chevauchent jamais (distance ≥ somme des rayons), chaque feuille dans le disque de son parent, moins de 400 ms pour 6 000 feuilles ; test pur des niveaux à une date (retiré visible avant son retrait, caché après, estompé avant le début, branche vide effacée). Au navigateur : le cadre passe à `data-…="pret"`, le nombre de feuilles dessinées égale celui de la base, la toile a des pixels peints (getImageData), un focus change le zoom, une recherche allume les attendus, une date passée réduit le nombre de visibles et le passage se termine ; captures en clair et en sombre, ordinateur et téléphone.

## Pièges

- Un simple anneau d'enfants autour d'une racine aux enfants très inégaux laisse un vide au centre de 60 % du diamètre : empiler en spirale.
- Une simulation de forces sur 5 000 nœuds coûte des secondes à chaque ouverture et fait bouger le graphe d'une fois à l'autre.
- Une page centrée à largeur de lecture (`max-w-…`) enferme le graphe : lui donner toute la zone.
- Des fils de sens dessinés en permanence noient l'arbre : ne les tracer qu'à la sélection.
- Un attribut `data-…` partagé par le cadre et le champ de recherche fait viser le mauvais élément aux contrôles.
- Un cadrage lancé dans le même geste qu'un changement d'état React lit l'état d'avant : le différer d'une image.
- Une partie commune construite à part (paquet `shared/dist`) qui n'est pas reconstruite garde les anciens noms de jetons : couleurs vides, tout gris.
- Recalculer la mise en place à chaque date fait sauter tout le graphe : la date ne change que la visibilité.
- Un élément retiré sans date de retrait sûre doit être tenu pour retiré dès sa naissance, sinon il reparaît « aujourd'hui ».
- Animer la présence garde un paquet de dessin par valeur d'alpha : tant que tous les nœuds qui changent avancent au même pas, les paquets restent peu nombreux (~60 images/s sur 5 800 nœuds).
