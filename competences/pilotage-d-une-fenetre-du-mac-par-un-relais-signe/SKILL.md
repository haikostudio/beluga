---
name: pilotage-d-une-fenetre-du-mac-par-un-relais-signe
description: À utiliser quand un serveur doit faire agir un agent sur UNE fenêtre d'un Mac (la recopie de l'iPhone, une app de bureau) : un petit relais sans dépendance (JavaScript pour Automation + launchd), relié par code à usage unique, qui reçoit les gestes en longue attente signée et refuse tout point hors de la fenêtre. Écarte les simulateurs et l'outil de test d'Apple.
etat: active
themes: automatisation, macos, iphone, securite
symptomes: un agent doit utiliser une application iPhone, un site exige son application mobile, piloter la recopie de l'iPhone depuis un serveur, clic hors de la fenêtre visée, relais du Mac sans dépendance
---

# pilotage-d-une-fenetre-du-mac-par-un-relais-signe

## Procédure

1. Le relais : un script `osascript -l JavaScript` (ObjC.import Foundation, CoreGraphics, AppKit) lancé par un LaunchAgent (`RunAtLoad`, `KeepAlive`, `ThrottleInterval`). Rien à installer : curl, openssl, shasum, screencapture, base64 et plutil sont livrés avec macOS.
2. Trouver la fenêtre : `CGWindowListCopyWindowInfo(1, 0)` (deepUnwrap), filtrer `kCGWindowLayer === 0` et l'app par son IDENTIFIANT de paquet (`NSRunningApplication.runningApplicationWithProcessIdentifier(pid).bundleIdentifier` ; recopie de l'iPhone = `com.apple.ScreenContinuity`) — jamais par son nom, traduit selon la langue.
3. Capturer la fenêtre seule : `screencapture -x -o -l <kCGWindowNumber> fichier.png`.
4. L'agent vise en FRACTIONS de la capture ; le relais convertit avec les limites RELUES à chaque geste (la fenêtre bouge), refuse hors cadre et dans la barre de titre (~28 points), active l'app par son pid, puis poste `CGEventCreateMouseEvent(null, 1|2|6, CGPointMake(x,y), 0)` + `CGEventPost(0, ev)`. Frappe : `Application('System Events').keystroke(texte)` / `keyCode(n, {using: 'command down'})`.
5. La voie : liaison par code à six chiffres (usage unique, dix minutes, essais plafonnés par adresse) échangé contre une clé d'appareil ; ensuite chaque requête porte `id`, `ts` (secondes) et `sig = HMAC-SHA256(secret, "ts.id.sha256(corps)")` en base64url (`openssl dgst -sha256 -hmac … -binary | base64 | tr '+/' '-_' | tr -d '='`). Le serveur refuse une signature périmée ou déjà vue. Longue attente : GET qui rend un geste ou rien au bout de ~25 s ; le résultat repart en POST.
6. Les secrets (mot de passe d'un compte) vont du coffre au relais par le serveur, jamais par le texte du modèle. Relais absent, Mac verrouillé (`CGSessionCopyCurrentDictionary().CGSSessionScreenIsLocked`) ou fenêtre fermée : l'agent bascule sur des gestes envoyés à la personne, sans boucle.

## Vérification

Un FAUX RELAIS en test : émettre un code, relier, signer une attente, confier un geste, rendre le résultat, vérifier qu'une signature rejouée, un mauvais secret et un appareil délié sont refusés, et que le bornage refuse un point hors cadre et dans la barre de titre. Puis un essai inoffensif sur le vrai Mac (« etat », « capturer »). Exemple : Beluga, server/src/test/relais-mac.test.ts (carte « Déploiement simplifié et menus de carte », commit 7ad09809).

## Pièges

- macOS attribue les autorisations « Enregistrement de l'écran » et « Accessibilité » au processus qui joue le script. Lancé par launchd en `/usr/bin/osascript`, le relais est un processus d'arrière-plan SANS NOM : macOS n'affiche souvent aucune demande et rien n'apparaît dans Confidentialité et sécurité (vécu sur Beluga, 15/11/2026). Le compiler sur le Mac en APPLICATION NOMMÉE (`osacompile -l JavaScript -o "~/Applications/<Nom>.app"`, `CFBundleIdentifier`/`CFBundleName` réécrits par `plutil`, `LSUIElement`, puis `codesign --force --deep --sign -`) et faire lancer `Contents/MacOS/applet` par launchd : la boucle de `run()` le garde vivant. Au premier démarrage, `AXIsProcessTrustedWithOptions({AXTrustedCheckOptionPrompt: true})` et `CGRequestScreenCaptureAccess()` (repli : un `screencapture -x`) l'INSCRIVENT dans les deux listes ; `AXIsProcessTrusted()` et `CGPreflightScreenCaptureAccess()` (repli : titres des fenêtres des autres apps visibles ou non) disent l'état, à rapporter au serveur. Ne recompiler que si le script change : la signature ad hoc change et macOS oublie les autorisations.
- La recopie de l'iPhone exige macOS 15+, iOS 18+, le même compte Apple, l'iPhone verrouillé et proche ; pas de caméra ni de Face ID à travers elle.
- `doShellScript` coupe sur une sortie énorme : écrire le corps d'une réponse (capture en base64) dans un fichier et l'envoyer par `--data-binary @fichier`.
- Un horodatage « strictement croissant » en secondes casse quand la longue attente et une réponse partent la même seconde : garder plutôt les signatures vues le temps de leur fraîcheur.
- Simulateur iOS (pas d'applis de l'App Store) et émulateur Android (pas de KVM sur un VPS, comptes signalés) : écartés.
