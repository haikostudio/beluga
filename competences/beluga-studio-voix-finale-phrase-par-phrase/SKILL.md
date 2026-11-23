---
name: beluga-studio-voix-finale-phrase-par-phrase
description: À utiliser dès qu'on touche à la voix finale du Studio de Beluga Build : l'étape « Voix finale » de « Construction » (qui n'existe que si la vidéo a une voix), le devis et la fabrication des voix, la voix d'une phrase, l'outil « voix » de l'agent. Symptômes : « ça m'a tout relancé alors que les sons existants allaient très bien », « je veux une voix différente par segment », phrase marquée « Autre voix », « la Construction me propose une voix alors que la vidéo n'en a pas ». Remplace la règle de la prise unique (DEC-338) : DEC-471.
etat: active
themes: studio, voix, interface
symptomes: toute la voix repart pour une seule phrase, une seule voix pour tout le film, phrase en autre voix, étape Voix finale sur une vidéo sans voix, étape 1 sur 3 sans voix
projets: Beluga
---

# beluga-studio-voix-finale-phrase-par-phrase

## Procédure

0. L'étape existe-t-elle ? `etapesDeConstruction(composition)` (shared/src/studio-production.ts, carte du 12/11/2026, capture #3e3a) : `['voix','formats','fichiers']` seulement si `compositionAUneVoix` — au moins un segment `genre: 'voix'` non masqué sur une piste non masquée (un son `audio` posé sur la piste des voix ne compte pas) ; sinon `['formats','fichiers']`. `FenetreMiseEnProduction` (production.tsx) s'ouvre sur `etapeDeDepartDeConstruction` et écrit « Construction · étape {n} sur {total} » (`data-studio-etapes-production`). Ne jamais remettre une liste d'étapes en dur.
1. Le modèle (shared/src/studio.ts) : `SegmentVoix.voixChoisie` est la voix VOULUE (une voix finale du Studio, vide = voix du projet) ; `voixFinale` est la voix réellement PRODUITE, posée par la fabrication. Lire la voix d'une phrase par `voixDeLaPhrase(s, voixDuProjet)`, jamais directement.
2. Les phrases à refaire : `phrasesARefaire(c, voixDuProjet)`, soit celles qui ne sont pas finales ou qui sont finales dans une autre voix que la leur (`phraseDansUneAutreVoix`). Ce sont les cases cochées d'office.
3. L'écran (`PanneauVoix`, web/src/components/studio/panneaux.tsx) : une case par phrase (`data-studio-voix-case`), « Tout cocher / Tout décocher » (`data-studio-voix-tout-cocher`), un sélecteur de voix sous chaque phrase (`data-studio-voix-de-phrase`, option vide = voix du projet), et le bouton « Générer N phrase(s) — jusqu'à prix » (`data-studio-valider-voix`, `data-studio-voix-a-generer`). Le choix de l'utilisateur survit quand la liste des phrases à refaire change : celles devenues faites se décochent, les nouvelles se cochent.
4. Le serveur (server/src/studio-generation.ts) : `devisDesVoix(id, segmentIds?, {refaire})` (les `segmentIds` cochés priment ; sans eux, les phrases à refaire ; `refaire` = toutes, pour l'outil de l'agent), puis `validerVoixFinales` avec les mêmes `segmentIds`. `produireVoixFinales` range les phrases par voix (`groupesParVoix`), fait UN appel par voix, et `poserLaPrise` pose tout en UNE version, dans l'ordre de la ligne de temps.
5. Le fournisseur se lit par voix (`fournisseurDeLaVoix`) : le modèle kie.ai retenu sur la création ne vaut que pour les phrases SANS `voixChoisie` ; ElevenLabs et Gemini passent par OpenRouter. Le devis additionne un plafond par voix.

## Vérification

`npm run build && node --test server/dist/test/studio-production.test.js` (sans voix → deux étapes ; piste des voix vide, son sur la piste des voix, voix masquée → pas de voix ; avec voix → trois étapes ; export en fabrication → fichiers) et `node --test server/dist/test/studio-serveur.test.js` (« LES PHRASES COCHÉES SEULES, CHACUNE DANS SA VOIX ») ; puis, depuis la copie de la carte, `env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-studio-voix-par-phrase.mjs` (cases cochées d'office, Tout cocher, voix d'une phrase, téléphone) et `env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-campagne-studio-et-mode.mjs` (téléphone : vidéo sans voix → « Formats », « étape 1 sur 2 » ; avec voix → « Voix finale », « étape 1 sur 3 »).

## Pièges

- Ne jamais réintroduire « une phrase à refaire = toute la prise » : c'était la règle d'avant le 02/11/2026, et l'utilisateur l'a refusée.
- Ne jamais réintroduire une étape « Voix finale » pour une vidéo muette : l'utilisateur veut une mise en production « logique par rapport au média » (12/11/2026). Un contrôle navigateur qui clique « Continuer vers l'export » (`data-studio-ouvrir-export`) sur une composition sans voix attend un bouton qui n'existe plus : attendre `data-studio-fenetre-production`, puis cliquer seulement s'il est là (cas de `verif-media-vers-piste.mjs`).
- Une phrase redite seule peut avoir un timbre un peu différent de ses voisines : c'est pourquoi les phrases cochées d'une même voix partent ensemble. Ne pas les découper en un appel par phrase.
- Un `aria-label` ne passe pas par le dictionnaire (contrôle des langues) : il reste en français fixe, et le `title` est traduit.
- Une fonction de shared qui n'est plus appelée que par les tests fait échouer `scripts/exports-morts.test.mjs` (cas de `priseARefaire`, retirée).
