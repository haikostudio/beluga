---
name: beluga-medias-en-fabrication-dans-le-fil
description: À utiliser dès qu'on touche au bloc d'attente d'un média en fabrication dans le fil de Beluga (image, vidéo, son fabriqués par le mode réalisation, le Studio, une esquisse de campagne, un personnage 3D ou un agent), qu'on branche une nouvelle source de fabrication, ou qu'un média n'apparaît qu'à la fin sans signe pendant l'attente.
etat: active
themes: interface, medias, realisation, studio
symptomes: le média n'apparaît qu'à la fin, aucun signe pendant la génération, un bloc reste en cours pour toujours, le même média deux fois dans le fil, le bloc ne scintille pas
projets: Beluga
---

# beluga-medias-en-fabrication-dans-le-fil

## Procédure

1. Règles pures dans shared/src/media-en-fabrication.ts : schéma MediaEnFabrication (sujet, outil, prix null = non publié, format → ratioDuMedia, genre image/video/son, debut/fin, etat en-cours/fini/echec, attachmentId, suivi agent/service), mediasDeLaConversation (carte, ou agent sans carte ; terminés depuis la dernière demande + en cours), rangerLesMedias (en cours > 45 min → échec, terminés > 24 h sortis, plafond 60), fermerLesBlocsDuTour.
2. Démon : server/src/medias-en-fabrication.ts tient la liste EN MÉMOIRE et l'émet entière (événement medias.fabrication, aussi au premier envoi d'un écran dans ws.ts). retirerLeTourVivant (runtime.ts) appelle fermerLesBlocsDeLAgent.
3. Brancher une source suivie par le démon : annoncerUnMedia({ id?, projectId, cardId?, agentId, sujet, outil, prix, format, genre, suivi: 'service' }) au départ, terminerUnMedia(id, { attachmentId }) ou ({ echec }) à la fin, après joindreUnFichier. Appelants actuels (à relire avant d'en écrire un nouveau, `grep -rn "annoncerUnMedia(" server/src`) : realisation.ts (lancer, id = id du média), studio-3d.ts (personnage 3D Meshy, prix = plafond de la dépense), esquisses-de-campagne.ts (esquisse d'une campagne, prix 0), exemples-de-choix.ts, et l'outil media_en_cours de tools.ts. studio-generation.ts n'annonce plus rien (son ancien lancerGenerationValidee a été retiré).
4. Un agent ordinaire : outil media_en_cours (tools.ts) — « debut » avant de lancer, « fin » avec le chemin (joint au fil par joindreUnFichier, rend attachment), « echec » avec la raison.
5. Écran : web/src/components/medias-en-fabrication.tsx, monté au bas des deux fils de chat.tsx (parcours de carte, conversation d'agent) avec depuis = date de la dernière demande ; ContextePiecesDesBlocs retire de CapturesDuFlux (message-view.tsx) les pièces déjà montrées. Balayage : .media-en-fabrication::after (styles.css), dégradé --teinte qui descend en 3,6 s, figé en veille et en mouvement réduit ; temps par useSeconde(enCours).

## Vérification

node --test server/dist/test/media-en-fabrication.test.js (forme, temps, prix, conversation, ménage, fermeture de fin de tour) après npm run build ; npm test 5242/5242 le 19/10/2026 (carte 70f51dd7, commit 2db8c5e0) ; verif-themes : medias-en-fabrication.tsx est un porteur admis du violet (travail de l'agent). Une source nouvelle : lancer la fabrication depuis l'interface, le bloc paraît aussitôt dans le fil avec son balayage, puis laisse place à la pièce jointe sans doublon.

## Pièges

Un nouvel outil servi à l'assistant global doit avoir son genre dans genreDeLAppel (shared/src/assistant-global.ts), sinon assistant-outils.test échoue (« accord » au lieu de « direct »). Un bloc d'une fabrication qui dure au-delà du tour doit être suivi: 'service', sinon la fin du tour le passe en échec. La liste vit en mémoire : un redémarrage la vide, le média fini reste une pièce jointe. Le texte « prix non publié » se compare par la valeur (prix === null), jamais par la chaîne française (verif-langues). Les exemples d'appelants changent au fil des refontes du Studio : toujours les relire par grep, jamais sur la foi de cette fiche.

## Ce qui ne marche pas

Attendre la fin de la génération pour joindre la pièce : l'utilisateur ne voit rien pendant des minutes. Un effet de verre ou de flou pour l'attente : refusé, la lumière doit être douce, comme un scanner lent.
