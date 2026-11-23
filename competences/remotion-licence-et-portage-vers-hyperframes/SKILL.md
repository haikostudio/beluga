---
name: remotion-licence-et-portage-vers-hyperframes
description: À utiliser dès qu'on envisage Remotion (vidéos écrites en React) pour un produit, un client ou une fabrication sur serveur, ou qu'on reçoit un projet Remotion à reprendre : « fais la vidéo avec Remotion », « on a un projet Remotion », « Remotion est-il gratuit ? », « porter une composition Remotion ».
etat: active
themes: video, licences, motion
symptomes: remotion gratuit, licence remotion, porter un projet remotion, moteur vidéo pour un produit
---

# remotion-licence-et-portage-vers-hyperframes

## Symptôme

Un agent propose Remotion comme moteur de vidéo d'un produit ou d'une société, sans vérifier sa licence.

## Cause

Remotion n'est pas sous licence libre classique : sa licence propre est gratuite pour les particuliers et les sociétés de 3 personnes au plus, payante au-delà, et interdit de revendre un dérivé (un éditeur ou un service de fabrication vidéo bâti dessus). Vérifié sur github.com/remotion-dev/remotion (fichier LICENSE.md) le 26/10/2026.

## Procédure

1. Avant tout, lire LICENSE.md du dépôt remotion-dev/remotion et la page remotion.dev/license : taille de la structure, usage (vidéo pour soi, ou produit vendu).
2. Pour un PRODUIT qui fabrique des vidéos pour ses clients : ne pas prendre Remotion comme moteur. Prendre HyperFrames (Apache-2.0 : page HTML + chronologie GSAP en pause → MP4).
3. Projet Remotion existant à reprendre : suivre la fiche importée « remotion-to-hyperframes » (correspondances : `useCurrentFrame()` → temps de la chronologie × fps, `<Sequence from durationInFrames>` → clip `data-start`/`data-duration`, `interpolate` → tween GSAP, `<Audio>` → `<audio class="clip">`).
4. Usage personnel ou petite équipe qui garde Remotion : `npx create-video@latest`, rendu `npx remotion render`, en se tenant à la licence.
5. Le dépôt remotion-dev/skills ne déclare aucune licence : ne pas en recopier les fiches.

## Vérification

La décision écrite cite la licence lue (date, lien) ; un projet porté se rend avec `hyperframes render` et sa durée `ffprobe` égale celle de l'original à 0,5 s près.

## Pièges

- « Open source » sur la page d'accueil ne veut pas dire libre pour un usage commercial.
- La licence peut changer : relire avant chaque nouveau produit.

## Ce qui ne marche pas

Bâtir un éditeur vidéo revendu sur Remotion : interdit par sa licence, même avec une licence d'entreprise payée pour soi.
