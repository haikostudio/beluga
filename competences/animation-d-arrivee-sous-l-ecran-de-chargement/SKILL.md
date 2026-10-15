---
name: animation-d-arrivee-sous-l-ecran-de-chargement
description: À utiliser dès qu'une application web à écran de chargement (voile de démarrage, splash, écran de patience d'une SPA) joue une animation d'arrivée sur son premier écran — logo qui s'anime, titre qui apparaît, compteur — ou devant ces symptômes : « l'animation ne se joue pas à l'ouverture », « on ne voit que la dernière image », « ça marche quand je navigue dans l'app mais pas au premier chargement », « le contrôle automatique mesure une position fausse au démarrage ». Dit comment prouver que l'animation se joue cachée, et comment la faire attendre.
etat: active
themes: animation, chargement, interface, navigateur, tests
symptomes: l'animation d'arrivée ne se joue pas à l'ouverture, on ne voit que la dernière image de l'animation, l'animation marche en naviguant mais pas au premier chargement, position mesurée fausse de quelques pixels juste après le chargement, test de mise en page qui échoue une fois sur deux au démarrage
---

# animation-d-arrivee-sous-l-ecran-de-chargement

## Symptôme

Un écran s'ouvre avec une animation d'arrivée (un logo dont le nom se replie, un titre qui se dévoile). En arrivant sur cet écran depuis l'intérieur de l'application, elle se joue. À l'ouverture de l'application, on ne voit que son image finale, ou sa toute fin à travers un voile qui s'efface.

## Cause

L'écran de chargement ne disparaît pas au montage du premier écran : il attend le premier rendu, reste opaque le temps de sa propre sortie (zoom, fondu), puis se retire. Une animation lancée au montage démarre donc SOUS lui et se termine avant qu'il ait fini de partir. Mesuré sur un cas réel : voile opaque 640 ms après le premier rendu, fondu de 280 ms ; une animation de 1,5 s avec 520 ms de pose avait commencé à se replier 140 ms avant le début du fondu.

Le même mécanisme fausse les contrôles : pendant sa sortie, l'écran de chargement anime souvent l'application elle-même (léger agrandissement). Une position lue à ce moment est décalée de quelques pixels.

## Procédure

1. Prouver avant de corriger. Dans un script injecté avant la page (`addInitScript`), noter à chaque image (`requestAnimationFrame`) quatre instants : montage de l'élément animé, début de la sortie du voile, retrait du voile du document, fin de l'animation. Si la fin de l'animation tombe moins d'une demi-seconde après le retrait du voile, elle s'est jouée cachée.
2. Donner trois phases à l'élément animé : en attente (première image tenue, sans aucune animation), en cours, fini. La phase d'attente affiche l'état de départ en CSS statique, pas une animation en pause : une animation en pause tient son image 0 %, qui est souvent invisible (opacité 0).
3. Au montage : si le voile n'est pas dans le document, jouer tout de suite (arrivée depuis l'application). Sinon passer en attente et guetter son départ avec un `MutationObserver` — la classe que le voile reçoit au début de son fondu, et son retrait du document. Ajouter un filet (2 à 3 s) qui lance l'animation quoi qu'il arrive.
4. Quand l'animation suit une attente, retirer son fondu d'entrée : l'élément est déjà affiché, le rejouer ferait clignoter.
5. Garder la boîte de l'élément à sa taille finale pendant les trois phases : ce qui est dessous ne doit pas bouger.
6. « Réduire les animations » : aller droit à l'image finale, sans attente.
7. Écrire dans le fichier du voile que sa classe de fondu est guettée ailleurs : la renommer casserait l'attente en silence (le filet masquerait la panne en jouant en retard).
8. Dans tout contrôle qui mesure une position ou prend une capture au démarrage, attendre que le voile ait quitté le document avant de mesurer.

## Vérification

- Rejouer la mesure de l'étape 1 après correction : la fin de l'animation doit suivre le retrait du voile d'au moins la durée du mouvement visible (dans le cas réel : 1200 ms après, contre 550 ms avant, pour une animation de 1,5 s).
- Série de captures prises à partir du début du fondu (150, 400, 650, 800, 1000 ms) : on doit y voir l'état de départ, puis le mouvement, puis l'image finale.
- Sans voile (le retirer par script avant le montage) : l'animation part au montage et dure son temps normal.
- Avec « réduire les animations » : l'image finale est là dès le montage.
- Le contrôle de position rejoué trois fois de suite donne la même valeur.

## Pièges

- Un contrôle qui vérifie seulement l'état final (« le logo est bien un carré de 72 px ») passe au vert alors que personne ne voit l'animation : il faut un contrôle de TEMPS.
- Attendre le seul retrait du voile fait perdre la durée de son fondu ; partir au début du fondu donne une arrivée plus vive, l'élément apparaissant à mesure que le voile s'efface.
- Mesurer avec un délai fixe (`waitForTimeout`) : la durée du chargement varie d'une page à l'autre, le résultat aussi.
- Une page qui charge moins de données sort plus vite du chargement : c'est elle qui fait échouer le contrôle de position, pas celle qu'on a modifiée.

## Ce qui ne marche pas

- Allonger la pose de l'animation pour « laisser le temps au voile » : la durée du chargement n'est pas fixe, l'animation devient trop longue quand on arrive depuis l'application.
- Lancer l'animation sur un délai fixe après le montage : même défaut, et une attente inutile sans voile.
- Mettre l'animation en pause (`animation-play-state: paused`) pendant l'attente : son image de départ est souvent transparente, l'élément manque pendant le fondu du voile.
