---
name: beluga-visuels-de-l-agent-de-campagne
description: À utiliser avant de toucher à ce que l'agent d'une campagne MONTRE pendant la conception (maquettes des questions, esquisses après chaque grande étape, image de la campagne) ou aux vrais visuels qu'il fait fabriquer au Studio sans quitter sa discussion (actions studio « image »/« video », lecteur du bloc de suivi, gestes lire/exporter/retouche/recuperer, bouton « Ouvrir dans le Studio » en nouvelle fenêtre) — ou quand une esquisse, une maquette de choix apparaît à tort dans Médias.
etat: active
themes: communication, campagnes, studio, medias, agents
symptomes: esquisse absente de la discussion, esquisse dans Médias, maquette exemple-A dans Médias, campagne sans image, bouton Studio qui ouvre dans la même fenêtre, suivi Studio qui dit Vidéo pour une image, bouton Studio posé au milieu d'une phrase, agent de campagne qui renvoie au Studio pour relancer un export, vidéo du Studio qu'on ne peut pas regarder dans la discussion
projets: Beluga
---

# beluga-visuels-de-l-agent-de-campagne

## Symptôme

L'agent de campagne doit faire VOIR l'idée tout au long de la conception, puis fabriquer les vrais visuels sans que la personne quitte sa discussion. Symptômes typiques d'une régression : l'esquisse n'arrive jamais, une esquisse ou une maquette paraît dans Médias, la campagne reste sans image, le suivi d'une image dit « Vidéo », le bouton du Studio remplace la page courante ou se pose au milieu d'une phrase, l'agent dit « je ne peux pas relancer l'export depuis cette discussion » (capture #b1ff).

## Cause

Trois chemins se croisent : les exemples de choix (server/src/exemples-de-choix.ts), les médias en fabrication / médias livrés (medias-en-fabrication.ts, medias-livres.ts) et la médiathèque Communication (communication.ts : lignesDeMedia lit medias_livres ; rangerLesMediasDesChefsDansLeStudio importe toute image jointe par un agent de service Communication). Sans marque explicite, toute image de l'agent de campagne devient un « média de marque ». Côté Studio, le bloc de suivi est tenu par le DÉMON (suivi-studio.ts) : ce qu'il montre dépend du champ `suiviStudio` du message, pas du texte.

## Procédure

1. Consigne : CONSIGNE_DU_CHEF_DE_CAMPAGNE (shared/src/chefs-de-communication.ts), paragraphe « TU MONTRES L'IDÉE EN IMAGES » — questions de rendu par exemple_de_choix nature « page » SANS question préalable « voulez-vous des exemples » ; jamais nature « image » pour des options (file Codex unique, trop lente) ; esquisse après idée, message+ton, stratégie complète, et à chaque changement de direction.
2. Esquisse : outil « communication », action « esquisse » (directeur-marketing.ts, refusée hors rôle niveau campagne) → dessinerUneEsquisse (server/src/esquisses-de-campagne.ts). Rend la main AUSSITÔT ; bloc annoncerUnMedia avec suivi « service » (le démon le tient au-delà du tour) ; fabriquerUneImageGratuite (Codex seul, jamais kie.ai : l'agent n'a pas de carte, DEC-447) ; pièce « esquisse-campagne-N.png » (nomDEsquisse), outil OUTIL_D_ESQUISSE ; retenirLEsquisse pose la meta communication.esquisse.<campagneId> et diffuse les marques. Une esquisse à la fois par campagne, les suivantes s'enchaînent.
3. Image de la campagne : lireCampagnes → apercuDeCampagne(image, premier visuel d'une publication, dernière esquisse). Une image posée par ailleurs garde la main.
4. Hors de Médias : pieceDeConception({ nom, outil }) (shared/src/esquisses-de-campagne.ts) dans lignesDeMedia (boucle medias_livres, par outil) et rangerLesMediasDesChefsDansLeStudio (par nom). Tout NOUVEL outil de conception doit y être ajouté.
5. Vrais visuels : services studio action « image » (format 1:1 par défaut) ou « video », « campagne » = id → lancerUneVideoPourUnAgent({ genre, references: [dernière esquisse] }) (suivi-studio.ts). Meta studio.genre.<création> ; la carte du directeur vise realisation.medias ['image'] (assistant-studio.ts). Le message de suivi porte `suiviStudio` (SuiviStudioDuMessage, shared/src/models.ts : création, genre, étape et sa phrase, version, exports prêts, aperçu image) réécrit par `suiviDuBloc` à chaque événement studio ; le texte reste en repli.
6. LE LECTEUR (web/src/components/bloc-du-studio.tsx, branché dans message-view.tsx) : sans export, une affiche « Voir la dernière version » ; au clic seulement, `studio.creation.ouvrir` (adresses de médias fraîches) et `Apercu` en LECTURE SEULE (un voile capte les gestes, clic = lire/pause), relu quand `version` change ; export prêt → `LecteurVideo` (image : <img>), choix du format s'il y en a plusieurs ; puis l'étape, l'échec, les formats et « Ouvrir dans le Studio » SEUL en dernier. Les pièces montrées par le bloc sortent de « Ce que l'agent a vu » (`piecesMontreesParLeBloc`).
7. LES GESTES AUTOUR DU MONTAGE (services-des-agents.ts, `autourDuMontage`) : lire (versions, pistes, fichiers, exports, dépenses), exporter (format, genre : `lancerExport`, gratuit ; un format absent s'ajoute à la création), retouche (demande → nouveau tour du MÊME directeur par `lancerAgentStudio`, refusée tant qu'il travaille), recuperer (export prêt joint à la réponse par `attachToCurrentMessage`). Réservés à l'agent demandeur (meta studio.demandeur.<création>) ou à celui de la campagne servie (`agentDeCampagneDeLaCreation`) ; le montage reste au directeur (décision du 11/11/2026). Toute question ouverte du directeur passe en miroir dans le fil du demandeur (`relayerLesPrix`), pas seulement les boutons à prix.
8. Liens Studio (web/src/lib/markdown.tsx, `inline`) : un « [texte](#studio/<id>) » SEUL dans son paragraphe → BoutonOuvrirLeStudio posé en bloc (data-ouvrir-le-studio) ; cité DANS une phrase → LienDuStudio souligné (data-lien-du-studio). Les deux ouvrent une NOUVELLE fenêtre (ouvrirLeStudioAPart). « suivre » ne rend plus de lien à recopier. Seule exception à la règle des aperçus (MEM-6846) : un média s'ouvre toujours dans la visionneuse.

## Vérification

npm run build puis : node --test server/dist/test/esquisses-de-campagne.test.js server/dist/test/services-des-agents.test.js (esquisse sans blocage, dernière esquisse = image de campagne, hors Médias et hors Studio, suivi image avec aperçu remplacé et `suiviStudio`, gestes du demandeur et refus d'un autre agent). Puis depuis la copie de la carte : env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-campagne-studio-et-mode.mjs (31/31 le 11/11/2026 : lecteur de la vidéo finie, aperçu en direct au clic en lecture seule, bouton seul en dernier, lien simple dans une phrase, à 1440 et 390 px) et env -u BELUGA_TOKEN -u BELUGA_URL HAIKO_COMMUNICATION_V2_CAPTURES=/tmp/x node scripts/verif-communication-v2.mjs (esquisse visible dans la discussion, bouton qui ouvre une NOUVELLE fenêtre sur #studio/<id>). Le contrôle des exports morts (npm test) ne lit que les fichiers suivis par git : « git add » les nouveaux fichiers avant.

## Pièges

- BELUGA_IMAGE_GRATUITE_FACTICE=1 : image unie sans appeler Codex (tests, démon jetable) ; sans elle un test appelle le vrai Codex.
- Ne jamais fermer le bloc d'une esquisse à la fin du tour : suivi « service », sinon fermerLesBlocsDeLAgent la marque en échec pendant que Codex dessine encore.
- joindreUnFichier dédoublonne par empreinte : deux images identiques donnent la même pièce (et l'ancien nom).
- Le détecteur d'exports morts ne voit pas un appel uniquement présent dans un test : pas d'export réservé aux tests.
- Une maquette « page » est déjà filtrée par l'outil « Page photographiée » ; une maquette Codex (nature image) aussi par l'outil « Codex du serveur, sinon service externe ».
- Le lecteur ne monte JAMAIS l'aperçu en direct d'office : un long fil chargerait un cadre lourd par bloc.
- Le cadre d'aperçu est isolé (sandbox sans allow-same-origin) : sous `serviceWorkers: 'block'`, Playwright y lève une SecurityError qui n'existe pas pour l'utilisateur.
- Dans un essai, le fil d'un agent SANS carte ne s'ouvre pas par une adresse ; une carte montre son parcours en points, pas ses bulles : poser les messages sur l'agent de l'assistant (voir tester-beluga-dans-l-application).

## Ce qui ne marche pas

Passer les esquisses par le service externe payant (kie.ai) : refusé sans carte, et contraire à la décision « aucune dépense sans clic ». Poser l'esquisse dans le volet du plan : refusé par l'utilisateur, tout vit dans la discussion. Écraser la colonne image de la campagne avec l'esquisse : elle effacerait une image choisie par la personne. Faire monter la vidéo par l'agent de campagne lui-même : refusé, le directeur artistique garde le montage. Un bouton « Ouvrir dans le Studio » rendu au fil du texte : refusé (capture #b1ff), il ne vit que seul sur sa ligne.
