#!/bin/bash
# POSE LES SERVICES DE BELUGA BUILD.
#
# Le service et son surveillant s'appellent `beluga.service` et
# `beluga-watchdog.*`. Ces unités vivent dans `/etc/systemd/system`, HORS du
# dépôt : aucune publication ne les pose. Ce script est le seul geste qui le
# fait, et il redémarre le démon — il se lance donc à la main, quand aucune
# tâche ni aucune publication n'est en cours.
#
#   sudo scripts/installer-services.sh              # pose, active, redémarre
#   sudo scripts/installer-services.sh --a-blanc    # dit tout, ne change rien
#
# Le chemin d'installation est repris du dossier RÉEL du dépôt.
set -euo pipefail

DEPOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNITES=/etc/systemd/system
ENV_FICHIER=/etc/beluga.env
A_BLANC=0
[ "${1:-}" = "--a-blanc" ] && A_BLANC=1

dire() { printf '  %s\n' "$*"; }
faire() {
  if [ "$A_BLANC" = 1 ]; then printf '  [à blanc] %s\n' "$*"; else eval "$@"; fi
}

if [ "$A_BLANC" = 0 ] && [ "$(id -u)" != 0 ]; then
  echo "Ce script pose des unités systemd : relancez-le avec sudo." >&2
  exit 2
fi

# JAMAIS DEPUIS UN DOSSIER DE CARTE. Un dossier de travail séparé (« worktree »)
# est refermé dès la carte rendue : y faire pointer l'unité systemd laisserait le
# service sans son code au premier rangement. On vise toujours le dépôt principal.
COMMUN="$(git -C "$DEPOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
PROPRE="$(git -C "$DEPOT" rev-parse --path-format=absolute --git-dir 2>/dev/null || true)"
if [ -n "$COMMUN" ] && [ "$COMMUN" != "$PROPRE" ]; then
  PRINCIPAL="$(dirname "$COMMUN")"
  echo "REFUS : ce dossier est une copie de travail temporaire (dossier de carte)." >&2
  echo "        Une unité systemd qui y pointerait perdrait son code au rangement." >&2
  echo "        Relancez depuis le dépôt principal : sudo $PRINCIPAL/scripts/installer-services.sh" >&2
  exit 2
fi

echo "Dépôt      : $DEPOT"
echo "Unités     : $UNITES"
[ "$A_BLANC" = 1 ] && echo "Mode       : essai à blanc, rien ne sera modifié"
echo

# 1. Le fichier d'environnement (secrets hors dépôt) est facultatif.
echo "1. Fichier d'environnement"
if [ -f "$ENV_FICHIER" ]; then
  dire "$ENV_FICHIER est en place."
else
  dire "aucun $ENV_FICHIER : il est facultatif, l'unité s'en passe."
fi

# 2. Les unités, avec le chemin d'installation réel substitué.
echo
echo "2. Unités systemd"
dire "beluga.service (chemin d'installation : $DEPOT)"
if [ "$A_BLANC" = 1 ]; then
  printf '  [à blanc] écriture de %s/beluga.service\n' "$UNITES"
else
  sed "s#/root/beluga#${DEPOT}#g" "$DEPOT/scripts/beluga.service" >"$UNITES/beluga.service"
  chmod 644 "$UNITES/beluga.service"
fi
dire "beluga-watchdog.service et beluga-watchdog.timer"
faire "install -m 644 '$DEPOT/scripts/beluga-watchdog.service' '$UNITES/beluga-watchdog.service'"
faire "install -m 644 '$DEPOT/scripts/beluga-watchdog.timer' '$UNITES/beluga-watchdog.timer'"
dire "beluga-watchdog.sh, posé HORS du dépôt pour veiller pendant une fusion"
faire "install -m 755 '$DEPOT/scripts/beluga-watchdog.sh' /usr/local/bin/beluga-watchdog.sh"

# 3. UN FICHIER VIDE N'EST PAS UNE BASE. Le démon refuse de démarrer sur un
# `beluga.db` absent ou vide quand une autre base pleine dort à côté
# (`cheminDeLaBase`, server/src/config.ts) : on le dit ici, avant de démarrer.
echo
echo "3. Fichier de base"
BASE="$DEPOT/data/beluga.db"
if [ -s "$BASE" ]; then
  dire "$BASE est en place ($(du -h "$BASE" | cut -f1))."
else
  dire "$BASE est absente ou vide : installation neuve, le démon la crée."
fi

# 4. Activation et démarrage.
echo
echo "4. Activation"
faire "systemctl daemon-reload"
faire "systemctl enable --now beluga.service"
faire "systemctl enable --now beluga-watchdog.timer"

# 5. LE PLAFOND DE TÂCHES ATTEINT L'UNITÉ ACTIVE, à chaud, sans redémarrage.
echo
echo "5. Plafond de tâches"
if [ "$A_BLANC" = 1 ]; then
  "$DEPOT/scripts/appliquer-plafond-taches.sh" --a-blanc || true
else
  "$DEPOT/scripts/appliquer-plafond-taches.sh" || true
fi

echo
if [ "$A_BLANC" = 1 ]; then
  echo "Essai à blanc terminé : rien n'a été modifié."
else
  systemctl --no-pager --plain status beluga.service | head -5 || true
  echo
  echo "Terminé : beluga.service est posé et actif."
fi
