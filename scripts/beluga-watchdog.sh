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

# LES QUINZE PLUS GROS, AVEC LEUR COMMANDE ET LEUR SERVICE. Le seul nom (`node`,
# `chrome`) ne disait pas QUI pesait 1,5 Go le 15/11/2026 : la commande
# (tronquée à 200 signes) et le groupe systemd du processus le disent. Rien de
# secret ne doit y passer : toute valeur qui suit un mot de passe, un jeton ou
# une clé est masquée, comme l'identifiant d'une adresse et les clés connues.
masquer_secrets() {
  sed -E \
    -e 's#(://)[^/@ ]+@#\1***@#g' \
    -e 's/(bearer[ ]+)[^ ]+/\1***/Ig' \
    -e 's/((token|key|secret|password|passwd|pass|pwd|bearer|auth|cle|motdepasse)[A-Za-z0-9_-]*[=: ]+)[^ ]+/\1***/Ig' \
    -e 's/(sk-|ghp_|gho_|github_pat_|xox[bp]-)[A-Za-z0-9_-]{8,}/\1***/g'
}

# Pour chaque gros processus : la CARTE qui l'a lancé (copie de travail
# `.worktrees/<dossier>`, lue dans son dossier courant, sa commande ou celui de
# ses parents), sa part rangée dans l'échange et son dossier courant. Un « node »
# anonyme de 1 Go se rattache ainsi à sa carte (16/11/2026).
carte_du_processus() {
  local p="$1" n=0 cwd args
  while [ -n "$p" ] && [ "$p" -gt 1 ] 2>/dev/null && [ "$n" -lt 6 ]; do
    cwd=$(readlink "/proc/$p/cwd" 2>/dev/null)
    args=$(tr '\0' ' ' <"/proc/$p/cmdline" 2>/dev/null)
    for texte in "$cwd" "$args"; do
      case "$texte" in
        *.worktrees/*) printf '%s' "$texte" | sed -n 's#.*\.worktrees/\([^/ ]*\).*#\1#p' | head -1; return ;;
      esac
    done
    p=$(awk '/^PPid:/ {print $2}' "/proc/$p/status" 2>/dev/null)
    n=$((n + 1))
  done
  printf '%s' '-'
}

# LA LIGNE « TRAVAUX LOURDS » (19/11/2026) : chaque travail qui a déjà fait
# déborder la mémoire, NOMMÉ avec son poids et sa carte — construction, installation,
# serveur d'essai, navigateur, export vidéo, trieur. Le 17/11 à 21:58, il fallait
# recouper trois sections pour voir la construction de la vitrine + un npm ci.
travaux_lourds() {
  local pid rss comm args quoi liste=""
  while read -r pid rss comm args; do
    case "$comm" in
      # Un moteur d'agent porte sa consigne dans sa commande (« npm install »…) : jamais un travail lourd.
      claude|codex|cursor-agent|bash|sh|sudo|timeout) continue ;;
      chrome|chromium|headless_shell) quoi="chrome" ;;
      beluga-essai-*) quoi="$comm" ;;
      ffmpeg) quoi="ffmpeg" ;;
      *)
        case "$args" in
          *"nuxt build"*|*"nuxi build"*) quoi="nuxt build" ;;
          *"next build"*) quoi="next build" ;;
          *"vite build"*) quoi="vite build" ;;
          *"npm ci"*) quoi="npm ci" ;;
          *"npm install"*|*"npm i "*) quoi="npm install" ;;
          *node_modules/.bin/vite*|*"npx vite"*|*/vite\ *) quoi="vite" ;;
          *playwright*) quoi="playwright" ;;
          *vectoriseur-processus.js*" - "*) quoi="trieur (bge-reranker)" ;;
          *bge-reranker*) quoi="trieur (bge-reranker)" ;;
          *) continue ;;
        esac ;;
    esac
    # Un chrome compte une fois par arbre : seuls ceux de plus de 50 Mo sont nommés.
    [ "$quoi" = "chrome" ] && [ "$rss" -lt 51200 ] && continue
    liste="$liste${liste:+ ; }$quoi pid $pid $((rss / 1024)) Mo ($(carte_du_processus "$pid"))"
  done < <(ps -eo pid=,rss=,comm=,args= --sort=-rss 2>/dev/null)
  printf 'travaux lourds\t%s\n' "${liste:-aucun}"
}

processus_detailles() {
  travaux_lourds
  printf 'pid\tmémoire\téchange\tgroupe\tcarte\tdossier courant\tcommande\n'
  ps -eo pid=,rss=,args= --sort=-rss 2>/dev/null | head -15 | while read -r pid rss args; do
    groupe=$(sed -n 's/^0:://p' "/proc/$pid/cgroup" 2>/dev/null | head -1)
    echange=$(awk '/^VmSwap:/ {print int($2 / 1024)}' "/proc/$pid/status" 2>/dev/null)
    dossier=$(readlink "/proc/$pid/cwd" 2>/dev/null | cut -c1-120)
    printf '%s\t%s Mo\t%s Mo\t%s\t%s\t%s\t%s\n' "$pid" "$((rss / 1024))" "${echange:-0}" "${groupe:--}" \
      "$(carte_du_processus "$pid")" "${dossier:--}" "$(printf '%s' "$args" | cut -c1-200)"
  done | masquer_secrets
}

# QUI TIENT LA MÉMOIRE, EN UN COUP D'ŒIL (18/11/2026). Les trois décrochages
# des 17 et 18/11 ont demandé une heure de recoupements pour nommer le coupable
# (cinq cadrages à la fois, le trieur à 1 Go, une construction de la vitrine,
# des serveurs d'essai et leurs navigateurs, les autres sites de la machine).
# Le relevé le dit désormais en tête : les COMPTES de ce qui se multiplie, le
# poids des deux modèles de recherche, et la mémoire + l'échange de CHAQUE
# service systemd (Beluga et les autres sites hébergés).
compter_les_lourds() {
  local cadrages=0 essais=0 chromes=0 vites=0 constructions=0 pid comm args cwd
  while read -r pid comm args; do
    case "$comm" in
      chrome|chromium|chrome_crashpad*|headless_shell) chromes=$((chromes + 1)); continue ;;
      beluga-essai-*) essais=$((essais + 1)); continue ;;
    esac
    case "$args" in
      "claude -p "*|*/claude\ -p\ *)
        cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null)
        case "$cwd" in *cadrage-scratch*) cadrages=$((cadrages + 1)) ;; esac ;;
      *node_modules/.bin/vite*|*"npx vite"*|*/vite\ *) vites=$((vites + 1)) ;;
      *"nuxt build"*|*"next build"*|*"vite build"*|*"npm ci"*|*"npm install"*) constructions=$((constructions + 1)) ;;
    esac
  done < <(ps -eo pid=,comm=,args= 2>/dev/null)
  printf 'cadrages (claude -p dans cadrage-scratch)\t%s\n' "$cadrages"
  printf "serveurs d'essai (beluga-essai-*)\t%s\n" "$essais"
  printf 'serveurs vite\t%s\n' "$vites"
  printf 'processus chrome\t%s\n' "$chromes"
  printf 'constructions et installations (nuxt/next/vite build, npm ci/install)\t%s\n' "$constructions"
}

modeles_de_recherche() {
  local pid comm args quoi rss echange vus=0
  while read -r pid comm args; do
    # Seuls les processus node du modèle : le relevé lui-même porte ce nom dans sa commande.
    [ "$comm" = "node" ] || continue
    case "$args" in *vectoriseur-processus.js*) ;; *) continue ;; esac
    # Le trieur reçoit « - » comme modèle de vecteurs (il ne vectorise pas).
    case "$args" in *vectoriseur-processus.js*" - "*) quoi="trieur" ;; *) quoi="vectoriseur" ;; esac
    rss=$(awk '/^VmRSS:/ {print int($2 / 1024)}' "/proc/$pid/status" 2>/dev/null)
    echange=$(awk '/^VmSwap:/ {print int($2 / 1024)}' "/proc/$pid/status" 2>/dev/null)
    printf '%s\tpid %s\t%s Mo\t%s Mo dans l’échange\n' "$quoi" "$pid" "${rss:-0}" "${echange:-0}"
    vus=$((vus + 1))
  done < <(ps -eo pid=,comm=,args= 2>/dev/null)
  [ "$vus" -gt 0 ] || printf 'aucun modèle de recherche chargé\n'
}

memoire_par_service() {
  local f dossier mem echange
  printf 'mémoire\téchange\tgroupe\n'
  for f in /sys/fs/cgroup/*.slice/*/memory.current /sys/fs/cgroup/*.slice/memory.current; do
    [ -r "$f" ] || continue
    dossier=$(dirname "$f")
    mem=$(( $(cat "$f" 2>/dev/null || echo 0) / 1048576 ))
    echange=$(( $(cat "$dossier/memory.swap.current" 2>/dev/null || echo 0) / 1048576 ))
    [ $((mem + echange)) -ge 20 ] || continue
    printf '%s Mo\t%s Mo\t%s\n' "$mem" "$echange" "${dossier#/sys/fs/cgroup/}"
  done | sort -t$'\t' -k1,1 -rn | head -25
}

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
    section "qui se multiplie" bash -c "$(declare -f compter_les_lourds); compter_les_lourds"
    section "modèles de recherche (trieur, vectoriseur)" bash -c "$(declare -f modeles_de_recherche); modeles_de_recherche"
    section "mémoire et échange par service" bash -c "$(declare -f memoire_par_service); memoire_par_service"
    section "uptime" uptime
    section "mémoire (Mo)" free -m
    section "pression mémoire" cat /proc/pressure/memory
    section "pression disque" cat /proc/pressure/io
    section "pression processeur" cat /proc/pressure/cpu
    section "processus les plus gros" sh -c 'ps -eo pid,user,rss,pcpu,etime,comm --sort=-rss | head -15'
    # `timeout` ne lance pas une fonction : on la lui passe écrite en entier.
    section "processus les plus gros : commande et service" \
      bash -c "$(declare -f masquer_secrets carte_du_processus travaux_lourds processus_detailles); processus_detailles"
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
