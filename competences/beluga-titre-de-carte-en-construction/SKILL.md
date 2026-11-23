---
name: beluga-titre-de-carte-en-construction
description: À utiliser dès qu'on touche à ce que Beluga affiche comme TITRE d'une carte (carte du tableau, en-tête de la carte ouverte) tant que l'agent de cadrage n'a pas posé le sien : « la carte montre le début de ma phrase », « Nouvelle tâche reste affiché », « afficher un texte d'attente à la place du titre », ou avant de lire card.title pour l'afficher.
etat: active
themes: interface, cartes
symptomes: la carte montre le début de la demande à la place du titre, « Nouvelle tâche » reste affiché, titre provisoire pris pour le vrai
projets: Beluga
---

# beluga-titre-de-carte-en-construction

## Procédure

1. Le titre d'une carte a trois états : vide / « Nouvelle tâche » (rien posé), titre ÉCLAIR recopié de la demande par runtime.ts avec le drapeau `titreProvisoire`, et titre posé par l'agent (`board_update_card` avec `title`, qui efface le drapeau). 2. Pour l'AFFICHAGE, un seul prédicat : `titreEnConstruction(carte)` dans shared/src/cadrage.ts (= titreEncoreVide(title) || titreProvisoire === true). Ne pas le confondre avec `titreDeCarteADonner` (le VERROU côté serveur, qui ne bouge pas). 3. Rendu : un <span data-titre-en-construction> `animate-pulse font-normal italic text-muted` avec t('Titre en cours de création…') à la place de card.title, dans board.tsx (le <h3> de la carte, icône moteur gardée) et dans card-panel.tsx (DialogTitle). 4. Sur le tableau, ne pas passer le titre à `useTexteCoupe` ni à la bulle `BulleTexteCoupe` quand il est en construction : sinon une bulle s'ouvre sur un texte qui n'est pas affiché. 5. Le libellé vit dans shared/src/traductions.ts (cinq langues). 6. Le titre reste stocké tel quel sur la carte : toasts, étiquette de glisser et recherche le lisent encore.

## Vérification

npm run build ; npm test (test « le titre en construction se lit à l'écran » dans server/src/test/carte-fil-cadrage.test.ts) ; HAIKO_LANGUES_URL=http://localhost:7099 node scripts/verif-langues.mjs (les contrôles du dictionnaire passent ; l'étape navigateur « choix anglais » a expiré dans cette carte, sans lien avec le titre). Contrôle visuel à faire : carte d'essai avec titreProvisoire vrai, puis board_update_card avec title.

## Pièges

L'ampoule de l'en-tête (titreGenere) suit titreEncoreVide seul : elle s'allume déjà sur un titre éclair — comportement conservé volontairement, ne pas l'aligner sur titreEnConstruction sans demande. Ne jamais vider card.title côté serveur pour obtenir le placeholder. Pas de bordure ajoutée (flat design).
