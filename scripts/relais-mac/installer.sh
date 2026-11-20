#!/bin/sh
# INSTALLE LE PROGRAMME DU MAC DE BELUGA, « Beluga Relais ». Usage, depuis le Terminal du Mac :
#   curl -fsSL __BASE__/api/relais-mac/installer.sh | sh -s <code à six chiffres>
# Le code s'affiche dans Beluga, Réglages → Extension (assistant « Télécharger », étape « Programme du Mac »).
#
# Le relais (relais.js, JavaScript pour Automation) est compilé ICI en une petite application,
# ~/Applications/Beluga Relais.app (osacompile, sans icône dans le Dock, signée ad hoc), lancée par launchd, y compris
# après un redémarrage du Mac. macOS attribue ainsi les autorisations à « Beluga Relais » : c'est sous ce nom qu'il
# paraît dans Réglages Système → Confidentialité et sécurité (carte « Installation guidée sur le Mac », 15/11/2026 ;
# avant, le relais tournait sous l'outil caché « osascript » et n'apparaissait nulle part).
# L'application ne contient que le LANCEUR fixe (lanceur.js), qui lit relais.js sur le disque (20/11/2026) : elle n'est
# recompilée que si le lanceur a changé — une recompilation change sa signature, et macOS oublierait les autorisations
# déjà données. Le relais lui-même se remplace sans recompiler (geste « se_mettre_a_jour », ou cette commande).
#
# Relancer cette commande remplace l'installation précédente (ancienne version comprise) sans rien laisser derrière.
# Pour le retirer :
#   launchctl unload ~/Library/LaunchAgents/cloud.beluga.relais.plist; rm -rf ~/Applications/"Beluga Relais.app"
set -eu
BASE="__BASE__"
CODE="${1:-}"
DOSSIER="$HOME/Library/Application Support/BelugaRelais"
APPLI="$HOME/Applications/Beluga Relais.app"
PLIST="$HOME/Library/LaunchAgents/cloud.beluga.relais.plist"
[ "$(uname)" = "Darwin" ] || { echo "Ce programme ne s'installe que sur un Mac."; exit 1; }
[ -n "$CODE" ] || { echo "Donnez le code à six chiffres affiché dans Beluga : … | sh -s 123456"; exit 1; }
mkdir -p "$DOSSIER" "$HOME/Library/LaunchAgents" "$HOME/Applications"
chmod 700 "$DOSSIER"

# 1. Le relais, et sa liaison à Beluga.
curl -fsSL "$BASE/api/relais-mac/relais.js" -o "$DOSSIER/relais-neuf.js"
curl -fsSL "$BASE/api/relais-mac/lanceur.js" -o "$DOSSIER/lanceur.js"
NOM="$(scutil --get ComputerName 2>/dev/null || echo Mac)"
REPONSE="$(curl -sS -X POST -H 'content-type: application/json' --data "{\"code\":\"$CODE\",\"nom\":\"$NOM\"}" "$BASE/api/relais-mac/relier")"
ID="$(printf '%s' "$REPONSE" | plutil -extract identifiant raw -o - - 2>/dev/null || true)"
SECRET="$(printf '%s' "$REPONSE" | plutil -extract secret raw -o - - 2>/dev/null || true)"
if [ -z "$ID" ] || [ -z "$SECRET" ]; then
  rm -f "$DOSSIER/relais-neuf.js" "$DOSSIER/lanceur.js"
  echo "Liaison refusée : $REPONSE"
  exit 1
fi
( umask 077; printf '{"base":"%s","identifiant":"%s","secret":"%s"}\n' "$BASE" "$ID" "$SECRET" > "$DOSSIER/config.json" )

# 2. L'ancien relais s'arrête (ancienne version osascript comprise : même étiquette launchd).
launchctl unload "$PLIST" 2>/dev/null || true

# 3. L'application « Beluga Relais » (le lanceur), recompilée seulement si le lanceur a changé.
NEUF="$(shasum -a 256 "$DOSSIER/lanceur.js" | cut -d' ' -f1)"
ANCIEN="$(cat "$DOSSIER/lanceur.empreinte" 2>/dev/null || true)"
if [ "$NEUF" != "$ANCIEN" ] || [ ! -x "$APPLI/Contents/MacOS/applet" ]; then
  rm -rf "$APPLI"
  osacompile -l JavaScript -o "$APPLI" "$DOSSIER/lanceur.js"
  INFO="$APPLI/Contents/Info.plist"
  plutil -replace CFBundleIdentifier -string cloud.beluga.relais "$INFO"
  plutil -replace CFBundleName -string "Beluga Relais" "$INFO"
  plutil -replace CFBundleDisplayName -string "Beluga Relais" "$INFO" 2>/dev/null || plutil -insert CFBundleDisplayName -string "Beluga Relais" "$INFO"
  plutil -replace LSUIElement -bool true "$INFO" 2>/dev/null || plutil -insert LSUIElement -bool true "$INFO"
  codesign --force --deep --sign - "$APPLI" >/dev/null 2>&1
  printf '%s\n' "$NEUF" > "$DOSSIER/lanceur.empreinte"
fi
mv -f "$DOSSIER/relais-neuf.js" "$DOSSIER/relais.js"

# 4. launchd la lance, et la relance si elle s'arrête.
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>cloud.beluga.relais</string>
  <key>ProgramArguments</key><array>
    <string>$APPLI/Contents/MacOS/applet</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>BELUGA_RELAIS_DOSSIER</key><string>$DOSSIER</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>20</integer>
  <key>StandardErrorPath</key><string>$DOSSIER/erreurs.log</string>
</dict></plist>
PLIST

# 5. Au premier démarrage, l'application fait demander ses autorisations par macOS (elle s'inscrit dans les listes).
touch "$DOSSIER/demander"
launchctl load "$PLIST"
sleep 3
open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility" 2>/dev/null || true

echo ""
echo "« Beluga Relais » est installé et relié à Beluga ($NOM)."
echo ""
echo "Dernière étape : deux autorisations, dans Réglages Système → Confidentialité et sécurité."
echo "  1. Accessibilité : activez l'interrupteur en face de « Beluga Relais » (l'écran vient de s'ouvrir)."
echo "  2. Enregistrement de l'écran (et de l'audio système) : activez aussi « Beluga Relais »."
echo "     Si macOS propose « Quitter et rouvrir », acceptez : le programme repart tout seul."
echo "Beluga coche ces étapes d'elle-même dès que les autorisations sont données."
echo ""
echo "Pour piloter l'iPhone, ouvrez ensuite une fois « Recopie de l'iPhone » : c'est l'application d'Apple"
echo "qui affiche l'iPhone sur le Mac (ce n'est pas notre programme)."
