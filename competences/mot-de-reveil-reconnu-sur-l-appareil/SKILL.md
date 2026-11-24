---
name: mot-de-reveil-reconnu-sur-l-appareil
description: À utiliser dès qu'une application web doit se réveiller à la voix (« Dis Jarvis », « Hey Assistant ») sans envoyer le son ambiant à un serveur, ou quand un mot de réveil fait de faux réveils / en rate : « l'écoute permanente transcrit tout ce que je dis », « le mot se déclenche tout seul », « un mot voisin réveille l'assistant », « la demande dite juste après le mot est perdue », « revenir dans l'application coupe la musique », « la musique ne reprend pas après la conversation ». Vosk en WebAssembly, grammaire à mots leurres, rejeu du son vers une conversation temps réel, micro rendu tel qu'on l'a trouvé.
etat: active
themes: audio, voix, vie-privee, navigateur
symptomes: faux réveil sur un mot voisin, réveil sur résultat partiel, son ambiant envoyé au serveur, demande perdue après le mot, seconde autorisation micro sur iPhone, la musique se coupe en revenant dans l'application, la musique ne reprend pas après la conversation
---

# mot-de-reveil-reconnu-sur-l-appareil

## Symptôme

Un mot de réveil fait par transcription serveur envoie tout le son ambiant ; une reconnaissance locale à grammaire minimale se déclenche sur des mots voisins. Dans une application iPhone (WebView), une attente du mot ouverte d'office coupe la musique à chaque retour dans l'application.

## Cause

Avec une grammaire réduite au seul mot, le décodeur FORCE tout son proche vers lui ; les résultats partiels sont instables. Mesuré (Vosk small fr 0.22, voix Piper) : « le devis est parti » et « dix janvier, dis à Marvin » → « dis jarvis » ; des partiels « dis jarvis » sur de la parole de bureau. Côté iPhone : ouvrir le micro active la session audio en mode appel (playAndRecord / voiceChat, sans mixWithOthers), qui met en pause toute autre musique tant qu'une prise reste ouverte.

## Procédure

1. Dépendance `vosk-browser` (WASM en Web Worker, ~5,8 Mo, importée à la demande : `import('vosk-browser')`), modèle `vosk-model-small-fr-0.22` (~42 Mo) servi par SON serveur en .tar.gz avec son dossier de tête (le travailleur l'extrait en sautant le premier niveau et le garde en IndexedDB), adresse versionnée, cache long ; le fetch du travailleur envoie le cookie de même origine.
2. Vérifier que les mots sont au vocabulaire : avec python `vosk`, un mot absent produit « Ignoring word missing in vocabulary ».
3. Grammaire = [phrase, chacun de ses mots, MOTS LEURRES (voisins phonétiques + ~150 mots courants), "[unk]"].
4. Ignorer les résultats partiels. Réveiller sur un résultat FINAL (`setWords(true)`) où chaque mot du réveil a `conf` ≥ 0,9 (les vrais réveils valent 1).
5. Micro par une seule prise : AudioContext → ScriptProcessor qui (a) écrit un tampon circulaire en mémoire, (b) nourrit `acceptWaveformFloat`, (c) écrit une piste sortante (MediaStreamDestination) muette au repos. Relier le processeur à la sortie par un gain 0.
6. Au réveil, la conversation temps réel prend CETTE piste ; elle rejoue depuis le DÉBUT du mot (start du résultat × taux + rang du premier échantillon donné au reconnaisseur), puis le micro réel ; le retard se rattrape en sautant les blocs silencieux.
7. Le « Oui ? » d'un réveil sans demande : transmettre le mot lui-même et le dire dans la consigne du modèle vocal (« appelé sans rien demander → réponds Oui ? »).
8. Fermer la conversation entière (RTCPeerConnection close + arrêt côté serveur), vider le tampon, recréer le reconnaisseur.
9. L'ATTENTE NE S'OUVRE QUE SUR UN GESTE, et jamais d'office au retour à l'écran — même dans une application native : sur iPhone, la session audio qu'elle pose coupe la musique. La refermer page cachée.
10. UNE CONVERSATION REND LE MICRO TEL QU'ELLE L'A TROUVÉ : retenir, à son ouverture, si le micro était déjà ouvert à la main ; à sa fin, le refermer s'il ne l'était pas. La dernière prise fermée rend la session audio (iOS : `setActive(false, .notifyOthersOnDeactivation)`), et l'application de musique reprend d'elle-même. Les gestes qui ouvrent une conversation ne doivent pas « allumer le micro à la main » avant elle, sinon il passerait pour voulu.

## Vérification

Python `vosk` sur des wav fabriqués par une voix de synthèse (vrais réveils sur 3 voix, phrases pièges, 40 s de parole ambiante) : tous les réveils à confiance 1, zéro faux réveil. Dans Chrome : `--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=fichier.wav%noloop` (12 s de silence d'abord, le temps de charger le modèle), espionner `/api/transcribe`, `WebSocket.prototype.send` et `RTCPeerConnection` : zéro envoi en attente, conversation ouverte par le vrai mot. Preuve : Beluga, carte « Veille privée et réveil », scripts/verif-veille-jarvis.mjs 35/35. Micro rendu : un faux pont natif qui note les messages (`window.__belugaNatif.envoyer`) prouve qu'aucun `audio: true` ne part à l'arrivée ni au retour, et que le DERNIER message audio d'une conversation ouverte micro coupé est `audio: false` (Beluga, carte « Jarvis : micro coupé, vrai concierge », scripts/verif-app-iphone-natif.mjs 79/79 le 24/11/2026). La reprise de la musique se constate sur iPhone réel.

## Pièges

- Juger sur les partiels : faux réveils garantis.
- Un résultat final couvre souvent toute la phrase (« dis jarvis quelles … ») : le réveil part à la fin de la phrase, pas après le mot.
- Le direct Codex v3 (`codex app-server` realtime webrtc) PARLE sur une consigne glissée : `thread/realtime/appendText` rôle developer (« dis EXACTEMENT : « … » ») fait dire une phrase mot pour mot, `appendSpeech` la reformule (essai réel du 18/11/2026, codex-cli 0.146.0) ; un `response.create` sur le canal oai-events ferme la session. Après un réveil, Beluga fait dire le salut puis rejoue le mot et la demande.
- Un contrôle qui édite le code pendant qu'un serveur Vite tourne voit le module rechargé à chaud en plein essai.
- Un précache de service hors ligne ne doit pas embarquer le gros paquet de reconnaissance.
- Une conversation qui garde le micro ouvert après sa fin (attente du mot reprise d'office) garde la session audio : la musique mise en pause ne reprend jamais.
- Toutes les applications de musique ne reprennent pas sur `notifyOthersOnDeactivation` (Musique et Spotify oui).

## Ce qui ne marche pas

Reconnaissance vocale du navigateur (Chrome envoie le son à Google) ; modèle anglais « hey_jarvis » d'openWakeWord ; Porcupine (clé et licence tierces) ; grammaire réduite au seul mot ; « Oui ? » par response.create (ferme la session) ; un son « Jarvis ? » injecté dans le micro pour faire saluer (aucun salut sur 13 appels, retiré le 18/11/2026) ; une attente du mot rouverte d'office à chaque retour dans l'application iPhone (coupait la musique, retirée le 24/11/2026).
