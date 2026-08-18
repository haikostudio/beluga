#!/bin/bash
# Lance la bascule « paseo » → « haiko » DÈS QUE PLUS AUCUNE CARTE NE TOURNE.
#
# Pourquoi un différé : le compte à renommer est celui qui fait tourner le
# démon ET l'agent qui déclenche la bascule. Lancé au premier plan, il se
# coupe lui-même avant d'avoir fini, et la carte reste bloquée « En cours ».
# Ce lanceur, lui, tourne sous root dans une unité systemd à part : il survit
# à l'extinction du compte.
#
# Il ne force RIEN : il rejoue `renommer-compte-en-haiko.mjs --pour-de-vrai`,
# dont les contrôles d'avant-vol refusent tant qu'une tâche travaille. La
# bascule part donc à la première fenêtre calme, et jamais pendant un travail.
#
#   systemd-run --unit=bascule-haiko /root/bascule-haiko/bascule-haiko-differee.sh
#
# Tout est journalisé dans /root/bascule-haiko.log.
set -u

SCRIPT="${1:-/root/bascule-haiko/renommer-compte-en-haiko.mjs}"
JOURNAL="${BASCULE_JOURNAL:-/root/bascule-haiko.log}"
ATTENTE_INITIALE="${BASCULE_ATTENTE_INITIALE:-90}"   # laisser le démon refermer la carte
PAS="${BASCULE_PAS:-30}"                              # entre deux tentatives
MAX="${BASCULE_MAX:-2700}"                            # 45 min, puis on renonce

note() { echo "[$(date -Is)] $*" >>"$JOURNAL"; }

note "fenêtre ouverte — attente initiale de ${ATTENTE_INITIALE}s"
sleep "$ATTENTE_INITIALE"

debut=$SECONDS
while :; do
  note "tentative"
  if node "$SCRIPT" --pour-de-vrai >>"$JOURNAL" 2>&1; then
    note "BASCULE TERMINÉE"
    exit 0
  fi
  if (( SECONDS - debut > MAX )); then
    note "ABANDON : toujours pas de fenêtre calme après ${MAX}s — rien n'a été basculé"
    exit 1
  fi
  sleep "$PAS"
done
