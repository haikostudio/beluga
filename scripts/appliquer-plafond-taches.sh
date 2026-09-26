#!/usr/bin/env bash
#
# POSER LE PLAFOND DE TÂCHES SUR L'UNITÉ RÉELLEMENT ACTIVE, SANS RIEN COUPER.
#
# Écrire `TasksMax` dans l'unité ne prend effet qu'au prochain démarrage. On
# applique donc la valeur à l'unité ACTIVE avec `systemctl set-property` — qui
# agit sur le cgroup EN MARCHE et persiste dans un fichier d'appoint, sans
# redémarrage.
#
# Aucun redémarrage : la règle du projet interdit de couper le démon pendant
# qu'une publication ou une tâche tourne, et élever un plafond de tâches n'en
# demande aucun.
#
#   sudo scripts/appliquer-plafond-taches.sh              # applique
#   sudo scripts/appliquer-plafond-taches.sh --a-blanc    # dit tout, ne change rien
set -euo pipefail

ICI=$(cd "$(dirname "$0")" && pwd)
UNITE_MODELE="$ICI/beluga.service"
A_BLANC=0
[ "${1:-}" = "--a-blanc" ] && A_BLANC=1

# LA VALEUR N'EST ÉCRITE QU'À UN SEUL ENDROIT : l'unité du dépôt. La recopier
# ici en ferait deux vérités, dont une fausse au premier changement.
if [ ! -f "$UNITE_MODELE" ]; then
  echo "Unité modèle introuvable : $UNITE_MODELE" >&2
  exit 1
fi
PLAFOND=$(sed -n 's/^TasksMax=\([0-9]\+\)$/\1/p' "$UNITE_MODELE" | tail -1)
if [ -z "$PLAFOND" ]; then
  echo "Aucun TasksMax numérique dans $UNITE_MODELE : rien à appliquer." >&2
  exit 1
fi

# L'unité ACTIVE : si le service ne tourne pas, rien à poser à chaud.
ACTIVE=""
for unite in beluga.service; do
  if systemctl is-active --quiet "$unite" 2>/dev/null; then
    ACTIVE="$unite"
    break
  fi
done

if [ -z "$ACTIVE" ]; then
  echo "Aucune unité Beluga active : le plafond de $PLAFOND tâches sera posé au prochain démarrage."
  exit 0
fi

AVANT=$(systemctl show "$ACTIVE" -p TasksMax --value 2>/dev/null || echo "?")
COURANT=$(systemctl show "$ACTIVE" -p TasksCurrent --value 2>/dev/null || echo "?")
echo "Unité active : $ACTIVE"
echo "Plafond avant : $AVANT (occupé : $COURANT)"
echo "Plafond visé  : $PLAFOND"

if [ "$AVANT" = "$PLAFOND" ]; then
  echo "Déjà à la bonne valeur : rien à faire."
  exit 0
fi

if [ "$A_BLANC" = 1 ]; then
  echo "[à blanc] systemctl set-property $ACTIVE TasksMax=$PLAFOND"
  exit 0
fi

systemctl set-property "$ACTIVE" "TasksMax=$PLAFOND"
APRES=$(systemctl show "$ACTIVE" -p TasksMax --value 2>/dev/null || echo "?")
echo "Plafond après : $APRES"
if [ "$APRES" != "$PLAFOND" ]; then
  echo "Le plafond n'a PAS été relevé : $APRES au lieu de $PLAFOND." >&2
  exit 1
fi
echo "Appliqué à chaud, sans redémarrage."
