---
name: obs-studio-capture-et-son-equivalent-sur-serveur
description: À utiliser quand on veut filmer un écran ou une application pour une vidéo (démonstration, tutoriel) et qu'on pense à OBS Studio (GPL-2.0), en particulier sur un serveur sans écran : « enregistre l'écran », « filme l'application », « capture OBS », « démonstration d'écran pour la vidéo ».
etat: active
themes: video, capture, demonstration
symptomes: enregistrer l'écran pour une vidéo, filmer une application web sur serveur, obs sur serveur, démonstration d'écran
---

# obs-studio-capture-et-son-equivalent-sur-serveur

## Symptôme

Un agent veut installer OBS sur un serveur pour filmer une application web, ou demande à l'utilisateur de filmer son écran.

## Cause

OBS Studio est une application de bureau : elle a besoin d'un écran, d'une carte graphique et d'un opérateur. Sur un serveur sans écran, elle ne sert à rien.

## Procédure

1. Sur un POSTE (l'utilisateur) : OBS reste le bon outil pour filmer une application native ou un jeu ; sortie MP4, 30 i/s, puis livraison par ffmpeg.
2. Sur un SERVEUR, pour une application WEB : Playwright avec le Chrome du système (`chromium.launch({ channel: 'chrome' })`), `browser.newContext({ viewport: { width: 1080, height: 1920 }, recordVideo: { dir, size } })`, jouer le parcours, fermer le contexte → fichier WebM ; ou des captures d'écran nettes (`page.screenshot`) animées ensuite dans une composition (zoom, curseur, surbrillance).
3. Les captures RÉELLES s'incrustent au montage : on ne fait jamais générer un faux écran par un modèle d'images.
4. Voir aussi « app-filmee-dans-un-telephone » (application posée dans un téléphone) et la fiche importée « oversized-cursor » (curseur agrandi).

## Vérification

Le fichier filmé s'ouvre (`ffprobe`), a la taille demandée et montre le vrai produit ; aucune installation d'OBS sur le serveur.

## Pièges

- `recordVideo` de Playwright filme à débit modeste : pour une image nette, préférer des captures d'écran animées.
- OBS est sous GPL : l'embarquer dans un produit distribué impose la GPL au tout.

## Ce qui ne marche pas

Installer OBS sur un serveur Linux sans écran : il ne démarre pas sans serveur graphique, et rien ne le pilote.
