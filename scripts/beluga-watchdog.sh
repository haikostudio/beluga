#!/bin/bash
# LE SURVEILLANT NE RELANCE BELUGA QU'APRÈS PLUSIEURS SILENCES D'AFFILÉE.
#
# Il existe pour repartir quand le démon est vraiment bloqué. Mais il ne
# regardait qu'une chose — une réponse en moins de dix secondes — et relançait
# aussitôt : un démon simplement OCCUPÉ (une lecture longue, une reconstruction
# d'index) passait pour mort, et sa relance coupait toutes les tâches en vol.
#
# Trois silences de suite valent une panne ; un seul ne vaut rien. La relance
# n'arrive donc qu'après trois minutes de vrai silence, et chaque réponse
# remet le compteur à zéro. Le délai d'attente passe aussi de 10 à 25 secondes :
# un démon lent n'est pas un démon mort.
set -u

URL="${BELUGA_SANTE_URL:-http://127.0.0.1:7070/health}"
SERVICE="${BELUGA_SERVICE:-beluga.service}"
COMPTEUR="${BELUGA_WATCHDOG_ETAT:-/run/beluga-watchdog.echecs}"
SEUIL="${BELUGA_WATCHDOG_SEUIL:-3}"
ATTENTE="${BELUGA_WATCHDOG_ATTENTE:-25}"

if curl -sf --max-time "$ATTENTE" "$URL" >/dev/null 2>&1; then
  rm -f "$COMPTEUR"
  exit 0
fi

echecs=$(( $(cat "$COMPTEUR" 2>/dev/null || echo 0) + 1 ))
printf '%s' "$echecs" >"$COMPTEUR"

if [ "$echecs" -lt "$SEUIL" ]; then
  logger -t beluga-watchdog "silence n° $echecs sur $SEUIL : on attend avant de relancer $SERVICE"
  exit 0
fi

rm -f "$COMPTEUR"
logger -t beluga-watchdog "$SEUIL silences d'affilée : relance de $SERVICE"
systemctl restart "$SERVICE"
