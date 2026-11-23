---
name: sons-d-une-ligne-de-temps-muets-sur-iphone
description: À utiliser dès qu'une page joue des sons posés sur une ligne de temps (montage vidéo, diaporama, voix découpée en phrases, aperçu dans un cadre isolé) avec des balises audio/vidéo lancées par une boucle d'animation, et que sur iPhone ou iPad seuls le premier son (ou quelques-uns) s'entendent : « seule la première phrase passe », « les sons du milieu restent muets sur iPhone », « tout marche sur ordinateur ». Dit comment regrouper les passages d'un même fichier sur un seul élément, le débloquer dans le geste, et le prouver sans iPhone.
etat: active
themes: audio, mobile, navigateur, video
symptomes: seule la première phrase s'entend sur iPhone, sons du milieu muets dans un aperçu de montage, play() refusé NotAllowedError avalé, tout joue sur ordinateur et rien sur iPad, son du début entendu au milieu après un défilement sur iPhone
---

# sons-d-une-ligne-de-temps-muets-sur-iphone

## Symptôme

Une ligne de temps lit plusieurs sons (souvent des passages d'un même fichier : une voix dite en une prise puis découpée) avec un élément audio par passage, lancés par requestAnimationFrame. Sur ordinateur tout sonne ; sur iPhone/iPad seul le son lancé juste après l'appui s'entend, les autres restent muets sans erreur visible (le refus de play() est avalé par un .catch).

## Cause

Safari iOS n'autorise un élément audio/vidéo à sonner que s'il a reçu un play() pendant un geste de l'utilisateur ; une fois autorisé, il le reste. Un play() appelé par la boucle d'images, plus tard, sur un élément jamais lancé dans le geste, est refusé (NotAllowedError). iOS ignore aussi preload. Avec un élément par passage, seuls ceux lancés dans le geste passent.

## Procédure

1. Regrouper : un élément par FICHIER, pas par passage. Trier les passages par début, et ranger chaque passage sur le premier élément dont le dernier passage finit avant lui ; sinon en créer un (deux passages qui se chevauchent gardent deux éléments). Retirer la source des balises devenues inutiles.
2. Piloter : à chaque image, chercher le passage actif de chaque élément ; s'il y en a un, régler vitesse/volume, sauter si l'écart dépasse ~0,25 s (temps du fichier = (t − début) × vitesse + départ) et play() s'il est en pause ; sinon pause, et caler l'élément sur le départ du passage suivant pour que le saut soit fait avant qu'il doive sonner.
2 bis. UN SAUT N'EST CRU QUE CONFIRMÉ : ne jamais poser currentTime avant les métadonnées (readyState < 1) ni pendant un saut en cours (el.seeking) — garder la cible voulue et la poser au loadedmetadata/canplay ou au seeked suivant ; marquer l'élément « pas sûr » à chaque saut et ne le faire jouer (muted en attendant) qu'au seeked dont currentTime égale la cible ; au clic « Lire », redemander le saut de chaque élément ; pendant la lecture, viser plus loin de la durée mesurée du saut précédent (plafonnée à ~1 s) pour ne pas courir après le temps. Compter les sauts qui retombent ailleurs.
3. Débloquer DANS le geste : au clic « Lire » (et à tout appui), faire play() puis pause() synchrones sur chaque élément qui peut sonner (sans bruit), puis démarrer la lecture dans ce même traitement, pas à la première image. Si la page est dans un cadre, le parent poste le message « lire » de façon synchrone dans son gestionnaire de clic (pas dans un effet React).
4. Garder la page de rendu (export) telle quelle si elle a son propre moteur : le regroupement ne vit que dans le moteur de l'aperçu.
5. Compter les refus de play() (hors AbortError) dans une variable de la page, pour les tests et le diagnostic.

## Vérification

Script Playwright (Chrome) qui reproduit la règle dans le cadre par un script injecté (addInitScript) : HTMLMediaElement.prototype.play refuse un élément qui n'a jamais reçu play() pendant le traitement d'un événement « message » (window.addEventListener enveloppé). Jouer une ligne de temps de six passages d'un fichier, relever au milieu de chaque passage que l'élément joue et que currentTime ≈ (t − début) + départ (écart < 0,3 s), et zéro refus. Rejouer le même script sur l'ancien moteur : il doit échouer (sinon le script ne prouve rien). Pour le saut perdu : un second temps où le serveur de test retient le fichier (non chargé), où un script injecté redéfinit HTMLMediaElement.prototype.currentTime pour PERDRE un saut posé avant les métadonnées tout en relisant la valeur demandée (vraie position lisible à part), puis 30 sauts de défilement, « Lire » au milieu, et la VRAIE position comparée à l'attendue (< 0,3 s) ; l'ancien moteur doit y échouer. Puis un essai sur un VRAI iPhone. Éprouvé sur Beluga (Studio, scripts/verif-studio-voix-une-prise.mjs, carte « Studio : voix muette au montage », 07/10/2026).

## Pièges

- Le WebKit de Playwright et le simulateur de Chrome jouent tout : ils ne montrent pas la panne.
- Lancer la lecture au premier requestAnimationFrame au lieu du gestionnaire du message : on sort du geste.
- Envoyer le message « lire » depuis un useEffect plutôt que depuis le clic.
- Un seul élément pour deux passages qui se chevauchent : l'un coupe l'autre.
- iOS PERD un saut demandé avant que le fichier ne soit chargé (rien ne charge avant un premier play()) mais currentTime relu rend la valeur demandée : la comparaison « écart > 0,25 s » ne voit rien et le son repart du début. Symptôme : au téléphone, après un défilement de la ligne de temps, le son du milieu de la vidéo correspond au début.
- Sur iOS, volume est en lecture seule sur un élément média : les fondus de l'aperçu ne s'y entendent pas.

## Ce qui ne marche pas

Compter sur preload="auto" pour que les éléments soient prêts : iOS l'ignore. Ne faire que play() dans la boucle avec un .catch silencieux : la panne devient invisible. Juger un saut réussi parce que currentTime relu vaut la cible. Reposer currentTime à chaque image pendant qu'un saut est en cours.
