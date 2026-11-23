---
name: extension-chrome-mise-a-jour-sur-mac
description: À utiliser quand une extension Chrome chargée « non empaquetée » (mode développeur) sur des Mac doit être mise à jour sans que la personne la réinstalle : « l'extension est restée en vieille version », « mets à jour l'extension sur le Mac à distance », « la mise à jour a perdu la liaison / la case navigation privée », ou quand le petit programme macOS qui fait ce travail (AppleScript/JXA compilé par osacompile, ou application native signée qui le remplace) doit se mettre à jour sans que macOS oublie ses autorisations.
etat: active
themes: extension, chrome, macos, mise-a-jour
symptomes: extension non empaquetée restée en vieille version, identifiant d'extension changé après mise à jour, case navigation privée décochée, autorisations macOS perdues après recompilation, programme bloqué en lisant Téléchargements, autorisations redemandées au passage à une application signée
---

# extension-chrome-mise-a-jour-sur-mac

## Symptôme

Une extension Chrome non empaquetée ne se met jamais à jour seule : chaque Mac garde la version installée à la main, et une fonction exigée côté serveur (ici une fenêtre privée) ne marche que sur les postes à jour.

## Cause

Chrome relit une extension non empaquetée depuis son DOSSIER à chaque démarrage (ou sur chrome.runtime.reload()), mais personne ne remplace ce dossier. Son identifiant dépend du chemin : un autre dossier = une autre extension (liaison, réglages et autorisation « navigation privée » perdus).

## Procédure

1. Trouver le dossier, jamais le deviner : lire `~/Library/Application Support/Google/Chrome/<profil>/Secure Preferences` (et `Preferences`) de CHAQUE profil (`Default`, `Profile N`), clé `extensions.settings[id].path` avec `location` 4 (non empaquetée) ; reconnaître la sienne par l'identifiant si l'extension l'envoie (`chrome.runtime.id`), sinon par ses fichiers propres et l'adresse de son serveur.
2. Remplacer le CONTENU du même dossier (ditto du paquet décompressé par-dessus), après avoir vérifié l'empreinte SHA-256 du paquet et la version de son manifeste ; garder les fichiers propres à l'installation (config).
3. Faire relire : une extension récente reçoit un message et appelle `chrome.runtime.reload()` ; une ancienne qui ne sait pas le faire → quitter Chrome proprement (`NSRunningApplication.terminate`, attendre, forcer après 20 s) puis le rouvrir.
4. Faire remonter par l'extension, à chaque connexion, sa version, son identifiant et `chrome.extension.isAllowedIncognitoAccess()` : le serveur sait qui est en retard et qui n'a pas la case.
5. Le programme macOS qui fait ce travail, s'il est compilé par osacompile (signé ad hoc), ne doit contenir qu'un LANCEUR fixe qui lit le vrai script sur le disque (`new Function('LANCEUR', texte + ';return run;')(true)`) : se mettre à jour = remplacer le fichier puis s'arrêter (launchd KeepAlive relance). Recompiler l'application change sa signature ad hoc et macOS oublie Accessibilité et Enregistrement de l'écran.
6. VARIANTE application native signée (Developer ID + notarisation, même identifiant de paquet à chaque version) : elle peut se remplacer en entier, l'identité de signature restant la même d'une version à l'autre. Le serveur publie un statut signé avec la dernière version ; l'application compare et se met à jour seule. Le PASSAGE du lanceur ad hoc à cette application, lui, redemande une fois toutes les autorisations : le prévoir dans le parcours d'installation.
7. Première installation du programme sur un poste déjà relié : la faire par un moyen déjà présent sur la machine (runner GitHub auto-hébergé du même utilisateur, ou geste du programme précédent), sans reliaison (config gardée), avec retour automatique à l'ancien si le nouveau ne démarre pas.

## Vérification

Sur la vraie machine : après mise à jour, l'extension se reconnecte avec la nouvelle version, le MÊME identifiant et `incognito` vrai ; le journal du programme dit le dossier remplacé. Pour le lanceur : `launchctl print gui/<uid>/<label>` montre `state = running` et `program = …/MacOS/applet`, le journal du programme note son démarrage, et un geste réel envoyé depuis le serveur est joué (ex. liste des applications). Preuves : carte Beluga « Extension à jour et Jarvis tout en voix » (commits e2eee0d4, 8ff47a35) ; variante application signée : carte Beluga « Liaison de l'extension Chrome simplifiée » (commit 94bae370 et suivants, archive suivie dans connect/paquet).

## Pièges

- Une extension rangée dans Téléchargements, Documents ou Bureau : macOS demande à l'application l'accès au dossier à la première lecture ; un processus d'arrière-plan sans écran (runner) y reste BLOQUÉ sans erreur — borner chaque lecture (`perl -e 'alarm 10; exec @ARGV'`) et prévoir le « Autoriser » sur le Mac.
- Relancer Chrome ferme les onglets et les séances d'agents en cours : jamais pendant qu'un agent pilote ce Chrome.
- Un paquet généré à chaque appel (zip horodaté) n'a pas d'empreinte stable : le préparer une fois, le servir par jeton, et envoyer son empreinte avec l'ordre.
- Un runner GitHub tourne sous un utilisateur précis : vérifier `whoami` avant de toucher au LaunchAgent d'un autre.
- Un runner de fabrication n'a pas l'autorisation d'enregistrer l'écran : aucune preuve visuelle des fenêtres natives depuis la fabrication.
- Le programme servi aux Mac est celui du serveur PUBLIÉ : rien ne se prouve sur un vrai Mac avant la mise en ligne.

## Ce qui ne marche pas

Télécharger un nouveau dossier ailleurs et demander de le recharger : nouvel identifiant, tout est à relier. Recompiler le programme osacompile à chaque mise à jour : autorisations macOS perdues à chaque fois. Capturer les fenêtres natives par screencapture depuis le runner : image vide.
