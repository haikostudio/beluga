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
#
# CHAQUE SILENCE LAISSE UN RELEVÉ. Dès le premier, le surveillant photographie
# la machine (mémoire, pression, processus, fin des journaux du démon, du
# noyau et du proxy) dans `data/logs/decrochages/`, et ajoute une ligne au
# `journal.tsv` du même dossier. C'est LUI qui l'écrit, pas le démon : un démon
# figé ou mort ne relève rien. Le démon lit ce journal et ouvre UNE carte
# d'enquête quand les décrochages se répètent (`server/src/decrochages.ts`).
#
# UN SILENCE PENDANT UNE RELANCE VOULUE (mise en ligne, bouton « Redémarrer »)
# n'est pas une panne : le démon note lui-même ses arrêts voulus dans le
# journal, et un silence qui tombe moins de deux minutes après l'un d'eux est
# consigné « silence-relance-voulue », que la règle d'enquête ne compte pas.
#
# BORNÉ DE PARTOUT : chaque commande du relevé a son délai (une machine qui
# swappe rend tout lent), le relevé est plafonné en taille, et seuls les
# derniers relevés sont gardés. Le script est POSÉ hors du dépôt
# (`/usr/local/bin`) ; le démon l'y réinstalle à son démarrage quand la copie
# du dépôt a changé, donc à la mise en ligne, en écrivant SA racine à la place
# de `/root/beluga` dans la ligne `RACINE=` ci-dessous.
set -u

URL="${BELUGA_SANTE_URL:-http://127.0.0.1:7070/health}"
SERVICE="${BELUGA_SERVICE:-beluga.service}"
COMPTEUR="${BELUGA_WATCHDOG_ETAT:-/run/beluga-watchdog.echecs}"
SEUIL="${BELUGA_WATCHDOG_SEUIL:-3}"
ATTENTE="${BELUGA_WATCHDOG_ATTENTE:-25}"
RACINE="${BELUGA_RACINE:-/root/beluga}"
DOSSIER="${BELUGA_DECROCHAGES:-$RACINE/data/logs/decrochages}"
GARDER="${BELUGA_DECROCHAGES_GARDER:-100}"
# `BELUGA_WATCHDOG_ESSAI=1` : relevé et journal, mais JAMAIS de relance — pour
# rejouer le surveillant sur une adresse muette sans toucher au vrai service.
ESSAI="${BELUGA_WATCHDOG_ESSAI:-0}"
PLAFOND_RELEVE=400000

if curl -sf --max-time "$ATTENTE" "$URL" >/dev/null 2>&1; then
  rm -f "$COMPTEUR"
  exit 0
fi

echecs=$(( $(cat "$COMPTEUR" 2>/dev/null || echo 0) + 1 ))
printf '%s' "$echecs" >"$COMPTEUR"

maintenant_ms() { date +%s%3N; }

# Le silence suit-il de près un arrêt VOULU noté par le démon ?
genre="silence"
journal="$DOSSIER/journal.tsv"
if [ -f "$journal" ]; then
  dernier_voulu=$(tail -n 50 "$journal" 2>/dev/null | awk -F'\t' '$2=="relance-voulue"{t=$1} END{print t+0}')
  if [ "${dernier_voulu:-0}" -gt 0 ] && [ $(( $(maintenant_ms) - dernier_voulu )) -lt 120000 ]; then
    genre="silence-relance-voulue"
  fi
fi

# Une section du relevé : un titre, puis la commande, bornée dans le temps.
section() {
  local titre="$1"; shift
  printf '\n===== %s =====\n' "$titre"
  timeout 8 "$@" 2>&1 | head -c 120000
}

ecrire_releve() {
  # Pas de dossier des journaux (autre installation, racine fausse) : pas de relevé.
  [ -d "$(dirname "$DOSSIER")" ] || return 1
  mkdir -p "$DOSSIER" 2>/dev/null || return 1
  local nom
  nom="$(date -u +%Y%m%dT%H%M%SZ)-$genre-$echecs.txt"
  {
    printf 'genre: %s\nsilence: %s sur %s\nquand: %s\nsonde: %s (attente %s s)\n' \
      "$genre" "$echecs" "$SEUIL" "$(date -Is)" "$URL" "$ATTENTE"
    section "service" systemctl show "$SERVICE" -p ActiveState,SubState,NRestarts,ActiveEnterTimestamp,ExecMainStartTimestamp,MainPID,MemoryCurrent,MemoryPeak
    section "uptime" uptime
    section "mémoire (Mo)" free -m
    section "pression mémoire" cat /proc/pressure/memory
    section "pression disque" cat /proc/pressure/io
    section "pression processeur" cat /proc/pressure/cpu
    section "processus les plus gros" sh -c 'ps -eo pid,user,rss,pcpu,etime,comm --sort=-rss | head -15'
    section "connexions vers 7070" sh -c "ss -tn state established '( sport = :7070 )' | tail -n +2 | wc -l"
    section "disque" df -h /
    section "fin du journal du démon (300 lignes)" sh -c "tail -c 200000 '$RACINE/data/logs/service.log' | tail -n 300"
    section "derniers blocages du fil principal" sh -c "tail -c 40000 '$RACINE/data/logs/blocages.log' | tail -n 20"
    section "journal système du service" journalctl -u "$SERVICE" -n 60 --no-pager
    section "noyau (mémoire épuisée ?)" sh -c "journalctl -k -n 400 --no-pager | grep -iE 'oom|killed process|out of memory' | tail -n 20"
    section "proxy (10 dernières minutes)" journalctl -u caddy --since "-10 min" -n 40 --no-pager
  } 2>&1 | head -c "$PLAFOND_RELEVE" >"$DOSSIER/$nom"
  printf '%s' "$nom"
}

# Une ligne au journal : instant (ms), genre, relevé, détail.
noter() {
  [ -d "$(dirname "$DOSSIER")" ] || return 0
  mkdir -p "$DOSSIER" 2>/dev/null || return 0
  printf '%s\t%s\t%s\t%s\n' "$(maintenant_ms)" "$1" "${2:--}" "${3:--}" >>"$journal"
}

# Les fichiers écrits ici (root) restent lisibles et modifiables par le démon :
# ils prennent le propriétaire du dossier des journaux.
rendre_au_demon() {
  [ -d "$DOSSIER" ] || return 0
  chown --reference="$(dirname "$DOSSIER")" "$DOSSIER" "$DOSSIER"/* 2>/dev/null || true
}

ranger() {
  # Les relevés les plus anciens partent au-delà de $GARDER ; le journal garde
  # ses 2000 dernières lignes.
  ls -1t "$DOSSIER"/*.txt 2>/dev/null | tail -n +"$((GARDER + 1))" | xargs -r rm -f
  if [ -f "$journal" ] && [ "$(wc -l <"$journal")" -gt 2000 ]; then
    tail -n 2000 "$journal" >"$journal.tmp" && mv "$journal.tmp" "$journal"
  fi
}

releve=$(ecrire_releve || true)
noter "$genre" "$releve" "silence $echecs/$SEUIL"

if [ "$echecs" -lt "$SEUIL" ]; then
  [ "$ESSAI" = "1" ] || logger -t beluga-watchdog "silence n° $echecs sur $SEUIL : on attend avant de relancer $SERVICE (relevé $releve)"
  ranger; rendre_au_demon
  exit 0
fi

rm -f "$COMPTEUR"
if [ "$ESSAI" = "1" ]; then
  noter "relance-surveillant-essai" "$releve" "essai : aucune relance"
  ranger; rendre_au_demon
  exit 0
fi
logger -t beluga-watchdog "$SEUIL silences d'affilée : relance de $SERVICE (relevé $releve)"
noter "relance-surveillant" "$releve" "$SEUIL silences d'affilée"
ranger; rendre_au_demon
systemctl restart "$SERVICE"
