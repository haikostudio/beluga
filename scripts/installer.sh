#!/usr/bin/env bash
#
# INSTALLER BELUGA BUILD SUR UN SERVEUR NEUF — UNE SEULE COMMANDE.
#
#   curl -fsSL https://raw.githubusercontent.com/haikostudio/beluga/main/scripts/installer.sh | sudo bash
#
# Sur un serveur Debian ou Ubuntu tout juste livré, ce script fait tout ce qui
# séparait « le dépôt est public » de « l'application répond » :
#
#   1. les outils dont Beluga Build dépend (Node 22, git, de quoi compiler,
#      le serveur web Caddy, l'outil GitHub, le terminal partagé) ;
#   2. un compte système à lui, « beluga », et son dossier ;
#   3. le code, téléchargé puis construit, et la MÉMOIRE « par le sens » :
#      le modèle qui permet à Beluga Build de retrouver ce qu'il a appris ;
#   4. une ADRESSE SÉCURISÉE : votre nom de domaine s'il mène déjà à ce
#      serveur, sinon une adresse provisoire tirée de l'adresse IP ;
#   5. l'envoi de courriels par le serveur lui-même (écoute locale seulement) ;
#   6. le service, démarré et relancé tout seul au redémarrage de la machine ;
#   7. le LIEN D'INSTALLATION, affiché à la fin : il ouvre la création du
#      compte principal, et ne sert qu'une fois.
#
# Il se REJOUE sans rien casser : chaque étape déjà faite est reconnue et
# passée, et le relancer plus tard met Beluga Build à jour — sauf si vous avez
# fait de cette installation VOTRE copie (page « Votre propre Beluga ») : vos
# modifications ne sont alors jamais écrasées, les nouveautés se récupèrent
# depuis l'application.
#
# Options (toutes facultatives) :
#   --domaine <nom>     le nom de domaine de Beluga Build (ex. beluga.exemple.com) ;
#                       sans cette option, la question est posée, et une réponse
#                       vide donne l'adresse provisoire
#   --sans-question     ne rien demander (adresse provisoire si --domaine manque)
#   --dossier <chemin>  où installer (défaut : /opt/beluga)
#   --compte <nom>      le compte système du service (défaut : beluga)
#   --depot <adresse>   le dépôt à télécharger (défaut : le dépôt public)
#   --branche <nom>     la branche (défaut : main)
#   --archive <fichier> installer depuis une archive .tar.gz au lieu du dépôt
#   --a-blanc           dire tout ce qui serait fait, sans rien changer
#
set -euo pipefail

DOSSIER=/opt/beluga
COMPTE=beluga
DEPOT=https://github.com/haikostudio/beluga.git
BRANCHE=main
DOMAINE="${BELUGA_DOMAINE:-}"
ARCHIVE=""
QUESTION=1
A_BLANC=0
PORT=7070
SERVICE_DE_NOMS=sslip.io
NODE_MAJEUR=22

while [ $# -gt 0 ]; do
  case "$1" in
    --domaine) DOMAINE="${2:-}"; shift 2 ;;
    --sans-question) QUESTION=0; shift ;;
    --dossier) DOSSIER="${2:-}"; shift 2 ;;
    --compte) COMPTE="${2:-}"; shift 2 ;;
    --depot) DEPOT="${2:-}"; shift 2 ;;
    --branche) BRANCHE="${2:-}"; shift 2 ;;
    --archive) ARCHIVE="${2:-}"; shift 2 ;;
    --a-blanc) A_BLANC=1; shift ;;
    -h|--help|--aide) sed -n '2,38p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Option inconnue : $1 (--aide pour la liste)" >&2; exit 2 ;;
  esac
done

ETAPE=0
titre() { ETAPE=$((ETAPE + 1)); printf '\n%s. %s\n' "$ETAPE" "$*"; }
dire() { printf '   %s\n' "$*"; }
faire() {
  if [ "$A_BLANC" = 1 ]; then printf '   [à blanc] %s\n' "$*"; else "$@"; fi
}
arret() { printf '\nARRÊT : %s\n' "$*" >&2; exit 1; }
# Une commande lancée sous le compte du service, dans son dossier personnel.
sous_compte() { sudo -H -u "$COMPTE" env PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" "$@"; }

echo "Installation de Beluga Build"
[ "$A_BLANC" = 1 ] && echo "(essai à blanc : rien ne sera modifié)"

# ------------------------------------------------------------------
# 0. Ce que le script exige de la machine
# ------------------------------------------------------------------
if [ "$A_BLANC" = 0 ] && [ "$(id -u)" != 0 ]; then
  arret "ce script installe des paquets et un service : relancez-le avec sudo."
fi
command -v apt-get >/dev/null 2>&1 || arret "ce script s'adresse à Debian et Ubuntu (apt-get introuvable)."
command -v systemctl >/dev/null 2>&1 || arret "systemd est introuvable : le service ne pourrait pas être posé."
case "$COMPTE" in
  root) arret "le service ne tourne pas sous root : les moteurs le refusent. Choisissez un autre compte." ;;
  *[!a-z0-9_-]*|'') arret "nom de compte invalide : « $COMPTE »." ;;
esac
case "$DOSSIER" in /*) ;; *) arret "le dossier d'installation doit être un chemin absolu." ;; esac
if [ -n "$ARCHIVE" ] && [ ! -f "$ARCHIVE" ]; then arret "archive introuvable : $ARCHIVE"; fi
export DEBIAN_FRONTEND=noninteractive

# ------------------------------------------------------------------
# 1. Les outils
# ------------------------------------------------------------------
titre "Les outils du système"
paquet_absent() { ! dpkg -s "$1" >/dev/null 2>&1; }
A_POSER=()
# tmux et python3 portent le terminal du serveur, que l'application affiche ;
# dnsutils donne « dig », par lequel elle vérifie qu'une adresse de projet est
# visible avant de lui demander un certificat.
for paquet in ca-certificates curl git gnupg build-essential python3 sudo tar tmux dnsutils; do
  paquet_absent "$paquet" && A_POSER+=("$paquet")
done
if [ ${#A_POSER[@]} -gt 0 ]; then
  dire "paquets à poser : ${A_POSER[*]}"
  faire apt-get update -qq
  faire apt-get install -y -qq "${A_POSER[@]}"
else
  dire "paquets de base déjà en place."
fi

# Node : la version du système est presque toujours trop ancienne.
node_majeur() { node -v 2>/dev/null | sed -n 's/^v\([0-9]*\).*/\1/p'; }
if [ "$(node_majeur || true)" != "" ] && [ "$(node_majeur)" -ge "$NODE_MAJEUR" ]; then
  dire "Node $(node -v) déjà en place."
else
  dire "pose de Node $NODE_MAJEUR (dépôt NodeSource)."
  if [ "$A_BLANC" = 1 ]; then
    printf '   [à blanc] curl https://deb.nodesource.com/setup_%s.x | bash ; apt-get install nodejs\n' "$NODE_MAJEUR"
  else
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJEUR}.x" | bash - >/dev/null
    apt-get install -y -qq nodejs
  fi
fi

# Caddy : le serveur web qui porte l'adresse et obtient le certificat tout seul.
if command -v caddy >/dev/null 2>&1; then
  dire "Caddy déjà en place."
else
  dire "pose de Caddy (dépôt officiel)."
  if [ "$A_BLANC" = 1 ]; then
    printf '   [à blanc] ajout du dépôt Caddy ; apt-get install caddy\n'
  else
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null 2>&1 || true
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' >/etc/apt/sources.list.d/caddy-stable.list
    chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
    apt-get install -y -qq caddy
  fi
fi

# L'outil GitHub : c'est par lui que les projets se clonent et se sauvegardent.
if command -v gh >/dev/null 2>&1; then
  dire "outil GitHub déjà en place."
else
  dire "pose de l'outil GitHub (dépôt officiel)."
  if [ "$A_BLANC" = 1 ]; then
    printf '   [à blanc] ajout du dépôt GitHub CLI ; apt-get install gh\n'
  else
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg
    chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      >/etc/apt/sources.list.d/github-cli.list
    apt-get update -qq
    apt-get install -y -qq gh || dire "l'outil GitHub n'a pas pu être posé : il se posera plus tard, l'installation continue."
  fi
fi

# LE NAVIGATEUR DES AGENTS (`data/competences/dev-browser`) : un vrai Chrome
# piloté en ligne de commande, avec une session gardée par compte. Version
# ÉPINGLÉE : la « latest » de npm est encore l'ancienne génération (0.2.x).
DEV_BROWSER_VERSION="1.0.0-rc.4"
if command -v dev-browser >/dev/null 2>&1 && dev-browser --version 2>/dev/null | grep -q "$DEV_BROWSER_VERSION"; then
  dire "navigateur des agents (dev-browser $DEV_BROWSER_VERSION) déjà en place."
else
  dire "pose du navigateur des agents (dev-browser $DEV_BROWSER_VERSION)."
  faire npm install -g --no-audit --no-fund --loglevel=error "dev-browser@$DEV_BROWSER_VERSION" \
    || dire "le navigateur des agents n'a pas pu être posé : il se posera plus tard, l'installation continue."
fi

# ------------------------------------------------------------------
# 2. Le compte du service
# ------------------------------------------------------------------
titre "Le compte « $COMPTE »"
if id "$COMPTE" >/dev/null 2>&1; then
  dire "le compte existe déjà."
else
  dire "création du compte et de son dossier personnel."
  faire useradd --create-home --shell /bin/bash "$COMPTE"
fi
# Beluga Build ADMINISTRE ce serveur pour vous : il crée les dossiers et les
# services de vos projets, écrit leurs adresses dans le serveur web. Son compte
# doit donc pouvoir agir en administrateur sans qu'on lui redemande un mot de
# passe à chaque geste. Le fichier est validé AVANT d'être posé : un fichier
# sudoers mal formé verrouillerait la machine.
SUDOERS="/etc/sudoers.d/90-beluga-$COMPTE"
if [ -f "$SUDOERS" ]; then
  dire "droits d'administration déjà accordés ($SUDOERS)."
else
  dire "droits d'administration sans mot de passe pour « $COMPTE » ($SUDOERS)."
  if [ "$A_BLANC" = 0 ]; then
    PROVISOIRE="$(mktemp)"
    printf '%s ALL=(ALL) NOPASSWD:ALL\n' "$COMPTE" >"$PROVISOIRE"
    visudo -cf "$PROVISOIRE" >/dev/null || arret "le fichier de droits n'est pas valide, rien n'a été posé."
    install -m 440 -o root -g root "$PROVISOIRE" "$SUDOERS"
    rm -f "$PROVISOIRE"
  fi
fi
DOMICILE="$(getent passwd "$COMPTE" 2>/dev/null | cut -d: -f6)"
DOMICILE="${DOMICILE:-/home/$COMPTE}"
PROJETS="$DOMICILE/projets"

# ------------------------------------------------------------------
# 3. Le code
# ------------------------------------------------------------------
titre "Le code, dans $DOSSIER"
# Le dossier CIBLE, et lui seul, est créé puis donné au compte : jamais son parent.
if [ ! -d "$DOSSIER" ]; then
  faire mkdir -p "$DOSSIER"
  faire chown "$COMPTE:$COMPTE" "$DOSSIER"
fi
if [ "$A_BLANC" = 1 ]; then
  printf '   [à blanc] téléchargement du code (%s), puis construction\n' "${ARCHIVE:-$DEPOT, branche $BRANCHE}"
elif [ -n "$ARCHIVE" ]; then
  dire "depuis l'archive $ARCHIVE."
  tar -xzf "$ARCHIVE" -C "$DOSSIER"
  chown -R "$COMPTE:$COMPTE" "$DOSSIER"
elif [ -d "$DOSSIER/.git" ]; then
  # UNE COPIE PERSONNALISÉE N'EST JAMAIS ÉCRASÉE. Dès que cette installation
  # est devenue la vôtre — un dépôt à vous (le distant public s'appelle alors
  # « amont »), une modification en cours, un enregistrement que le dépôt
  # public n'a pas —, le script n'y touche plus : il construit ce qui est là.
  if sous_compte git -C "$DOSSIER" remote | grep -qx amont; then
    dire "cette installation est votre copie personnelle : son code n'est pas modifié."
    dire "Les nouveautés se récupèrent dans l'application (Réglages, page « Installation »)."
  elif [ -n "$(sous_compte git -C "$DOSSIER" status --porcelain --untracked-files=no 2>/dev/null)" ]; then
    dire "des fichiers ont été modifiés ici : le code n'est pas mis à jour, rien n'est écrasé."
  else
    sous_compte git -C "$DOSSIER" fetch --quiet origin "$BRANCHE" || dire "le dépôt ne répond pas : le code en place est gardé."
    if [ -n "$(sous_compte git -C "$DOSSIER" rev-list -1 "origin/$BRANCHE..HEAD" 2>/dev/null)" ]; then
      dire "cette installation porte des enregistrements à elle : le code n'est pas mis à jour."
    else
      dire "déjà téléchargé : mise à jour."
      sous_compte git -C "$DOSSIER" merge --ff-only --quiet "origin/$BRANCHE" || dire "mise à jour impossible : le code en place est gardé."
    fi
  fi
elif [ -z "$(ls -A "$DOSSIER" 2>/dev/null)" ]; then
  dire "téléchargement depuis $DEPOT."
  sous_compte git clone --quiet --branch "$BRANCHE" "$DEPOT" "$DOSSIER"
else
  arret "$DOSSIER existe, n'est pas vide et n'est pas une installation de Beluga Build."
fi
# LE DÉPÔT PUBLIC SE LIT, IL NE REÇOIT JAMAIS RIEN D'ICI : tout distant qui le
# désigne garde sa lecture (les nouveautés) mais perd son adresse d'envoi. Le
# démon repose ce verrou à chaque démarrage (`server/src/depot-public.ts`).
if [ "$A_BLANC" = 0 ] && [ -d "$DOSSIER/.git" ]; then
  for distant in $(sous_compte git -C "$DOSSIER" remote); do
    if sous_compte git -C "$DOSSIER" remote get-url "$distant" | grep -qiE 'github\.com[:/]+haikostudio/beluga(\.git)?/?$'; then
      sous_compte git -C "$DOSSIER" remote set-url --push "$distant" envoi-interdit://depot-public-de-beluga
    fi
  done
fi

if [ "$A_BLANC" = 0 ]; then
  [ -f "$DOSSIER/package.json" ] || arret "le code attendu n'est pas dans $DOSSIER (package.json introuvable)."
  dire "installation des dépendances (quelques minutes)."
  # Les dépendances de développement sont nécessaires : c'est avec elles que
  # l'application se construit.
  ( cd "$DOSSIER" && sous_compte env NODE_ENV=development npm install --include=dev --no-audit --no-fund --loglevel=error )
  dire "construction de l'application."
  ( cd "$DOSSIER" && sous_compte env NODE_ENV=development npm run build --silent ) >/tmp/beluga-construction.log 2>&1 \
    || { tail -30 /tmp/beluga-construction.log >&2; arret "la construction a échoué (journal : /tmp/beluga-construction.log)."; }
  [ -f "$DOSSIER/server/dist/main.js" ] || arret "la construction n'a pas produit le programme attendu."
  install -d -o "$COMPTE" -g "$COMPTE" "$PROJETS"

  # LA MÉMOIRE « PAR LE SENS » FAIT PARTIE DE L'INSTALLATION. C'est elle qui
  # permet à Beluga Build de retrouver ce qu'il a appris d'un projet à l'autre,
  # et donc d'écrire de meilleures consignes à ses agents : elle n'est pas une
  # option. Son modèle se télécharge (environ 800 Mo sur le disque). Un échec —
  # réseau coupé, disque trop juste — n'arrête PAS l'installation : il est dit
  # ici, et l'assistant de démarrage propose de la réparer d'un bouton.
  if [ -d "$DOSSIER/data/vectoriseur/modeles" ] && [ -f "$DOSSIER/data/vectoriseur/node_modules/@huggingface/transformers/package.json" ]; then
    dire "mémoire « par le sens » déjà en place."
  else
    dire "installation de la mémoire « par le sens » (un téléchargement, quelques minutes)."
    if ( cd "$DOSSIER" && sous_compte node scripts/installer-modele-vecteurs.mjs ) >/tmp/beluga-memoire.log 2>&1; then
      dire "mémoire « par le sens » en place."
    else
      dire "la mémoire « par le sens » n'a pas pu être installée (journal : /tmp/beluga-memoire.log)."
      dire "L'installation continue : l'assistant de démarrage proposera de la réparer."
    fi
  fi
elif [ "$A_BLANC" = 1 ]; then
  printf '   [à blanc] installation de la mémoire « par le sens » (scripts/installer-modele-vecteurs.mjs)\n'
fi

# ------------------------------------------------------------------
# 4. L'adresse
# ------------------------------------------------------------------
titre "L'adresse"
IP="$(curl -4 -fsS --max-time 10 https://api.ipify.org 2>/dev/null || true)"
case "$IP" in
  *[!0-9.]*|'') IP="$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -1)" ;;
esac
[ -n "$IP" ] || arret "l'adresse publique de ce serveur n'a pas pu être lue."
dire "adresse publique de ce serveur : $IP"
PROVISOIRE_HOTE="$(printf '%s' "$IP" | tr . -).$SERVICE_DE_NOMS"

# La question n'est posée que si quelqu'un peut y répondre : un script lancé
# par « curl … | bash » n'a plus le clavier sur son entrée, on le reprend au terminal.
if [ -z "$DOMAINE" ] && [ "$QUESTION" = 1 ] && [ "$A_BLANC" = 0 ] && [ -r /dev/tty ]; then
  printf '\n   Avez-vous un nom de domaine pour Beluga Build (ex. beluga.exemple.com) ?\n'
  printf '   Il doit déjà mener à %s. Laissez vide pour une adresse provisoire.\n   > ' "$IP"
  read -r DOMAINE </dev/tty || DOMAINE=""
fi
DOMAINE="$(printf '%s' "$DOMAINE" | tr 'A-Z' 'a-z' | sed -e 's#^[a-z]*://##' -e 's#/.*$##' -e 's/[[:space:]]//g')"

mene_ici() {
  local trouve
  trouve="$(getent ahostsv4 "$1" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ')"
  case " $trouve " in *" $IP "*) return 0 ;; *) return 1 ;; esac
}

HOTE="$PROVISOIRE_HOTE"
if [ -n "$DOMAINE" ]; then
  if mene_ici "$DOMAINE"; then
    HOTE="$DOMAINE"
    dire "$DOMAINE mène bien à ce serveur."
  else
    dire "$DOMAINE ne mène pas (encore) à ce serveur : l'adresse provisoire est utilisée."
    dire "Créez chez votre fournisseur de noms un enregistrement « A » de $DOMAINE vers $IP,"
    dire "puis réglez le nom de domaine dans l'assistant de démarrage : rien n'est perdu."
  fi
fi
ADRESSE="https://$HOTE"
dire "Beluga Build répondra sur $ADRESSE"

# Le serveur web : un dossier d'adresses pour Beluga Build, un autre pour les
# projets, lus tous les deux par le fichier principal.
CADDYFILE=/etc/caddy/Caddyfile
BLOC="$HOTE {
	encode zstd gzip
	reverse_proxy 127.0.0.1:$PORT
}"
if [ "$A_BLANC" = 1 ]; then
  printf '   [à blanc] écriture de /etc/caddy/beluga.d/administration.caddy pour %s\n' "$HOTE"
else
  install -d -m 755 /etc/caddy/beluga.d /etc/caddy/project-autostart.d
  # L'adresse posée par une installation précédente n'est pas écrasée par
  # l'adresse provisoire : seul un nom de domaine demandé la remplace.
  if [ -f /etc/caddy/beluga.d/administration.caddy ] && [ "$HOTE" = "$PROVISOIRE_HOTE" ]; then
    dire "une adresse est déjà en place, elle est gardée."
    DEJA="$(sed -n '1s/[ ,{].*$//p' /etc/caddy/beluga.d/administration.caddy)"
    [ -n "$DEJA" ] && ADRESSE="https://$DEJA"
  else
    printf '%s\n' "$BLOC" >/etc/caddy/beluga.d/administration.caddy
  fi
  if [ ! -f "$CADDYFILE" ] || grep -q '/usr/share/caddy' "$CADDYFILE"; then
    # Le fichier livré avec Caddy ne sert qu'une page d'accueil : on le garde de côté.
    [ -f "$CADDYFILE" ] && cp -n "$CADDYFILE" "$CADDYFILE.avant-beluga"
    printf '# Écrit par l'"'"'installateur de Beluga Build.\nimport /etc/caddy/beluga.d/*.caddy\nimport /etc/caddy/project-autostart.d/*.caddy\n' >"$CADDYFILE"
  else
    grep -q 'beluga.d' "$CADDYFILE" || printf '\nimport /etc/caddy/beluga.d/*.caddy\n' >>"$CADDYFILE"
    grep -q 'project-autostart.d' "$CADDYFILE" || printf 'import /etc/caddy/project-autostart.d/*.caddy\n' >>"$CADDYFILE"
  fi
  caddy validate --config "$CADDYFILE" >/tmp/beluga-caddy.log 2>&1 \
    || { tail -15 /tmp/beluga-caddy.log >&2; arret "la configuration du serveur web est refusée (journal : /tmp/beluga-caddy.log)."; }
  systemctl enable --now caddy >/dev/null 2>&1 || true
  systemctl reload caddy >/dev/null 2>&1 || systemctl restart caddy
  # Un pare-feu actif doit laisser passer le web, sinon l'adresse ne répond pas
  # et aucun certificat ne peut être délivré.
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
    ufw allow 80/tcp >/dev/null 2>&1 || true
    ufw allow 443/tcp >/dev/null 2>&1 || true
    dire "pare-feu : ports 80 et 443 ouverts."
  fi
fi

# ------------------------------------------------------------------
# 5. L'envoi de courriels par le serveur
# ------------------------------------------------------------------
titre "L'envoi de courriels"
# Un petit agent d'envoi LOCAL : il n'écoute que la machine elle-même, il ne
# reçoit donc rien du dehors et ne sert de relais à personne. C'est le premier
# choix proposé par l'assistant ; beaucoup d'hébergeurs bloquent pourtant
# l'envoi direct (port 25), et l'assistant le constate alors par un vrai essai
# avant de proposer un service de courriel. Un échec ici n'arrête rien.
if command -v sendmail >/dev/null 2>&1 || [ -x /usr/sbin/sendmail ]; then
  dire "un agent d'envoi est déjà en place, il est gardé tel quel."
elif [ "$A_BLANC" = 1 ]; then
  printf '   [à blanc] apt-get install postfix (écoute locale seulement, nom %s)\n' "$HOTE"
else
  echo "postfix postfix/main_mailer_type select Internet Site" | debconf-set-selections
  echo "postfix postfix/mailname string $HOTE" | debconf-set-selections
  if apt-get install -y -qq postfix >/tmp/beluga-courriels.log 2>&1; then
    postconf -e 'inet_interfaces = loopback-only' 'mydestination = localhost' >/dev/null 2>&1 || true
    systemctl restart postfix >/dev/null 2>&1 || true
    dire "agent d'envoi posé (écoute locale seulement)."
  else
    dire "l'agent d'envoi n'a pas pu être posé (journal : /tmp/beluga-courriels.log) : l'installation continue."
  fi
fi

# ------------------------------------------------------------------
# 6. Le service
# ------------------------------------------------------------------
titre "Le service"
ENV_FICHIER=/etc/beluga.env
poser_variable() {
  # Une valeur déjà écrite n'est jamais remplacée : c'est peut-être la vôtre.
  grep -q "^$1=" "$ENV_FICHIER" 2>/dev/null || printf '%s=%s\n' "$1" "$2" >>"$ENV_FICHIER"
}
if [ "$A_BLANC" = 1 ]; then
  printf '   [à blanc] écriture de %s (dossier des projets, adresse publique)\n' "$ENV_FICHIER"
  printf '   [à blanc] %s/scripts/installer-services.sh\n' "$DOSSIER"
else
  touch "$ENV_FICHIER"
  chmod 640 "$ENV_FICHIER"
  chown "root:$COMPTE" "$ENV_FICHIER"
  poser_variable BELUGA_PROJECTS_ROOT "$PROJETS"
  poser_variable BELUGA_ADRESSE_PUBLIQUE "$ADRESSE"
  BELUGA_COMPTE="$COMPTE" bash "$DOSSIER/scripts/installer-services.sh" | sed 's/^/   /'
  # Le service a-t-il vraiment démarré ? On lui laisse le temps de créer sa base.
  for _ in $(seq 1 60); do
    curl -fsS --max-time 3 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
    sleep 2
  done
  curl -fsS --max-time 5 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 \
    || { journalctl -u beluga.service --no-pager -n 20 >&2 || true; tail -20 "$DOSSIER/data/logs/service.log" >&2 2>/dev/null || true; arret "le service ne répond pas."; }
  dire "le service répond."
fi

# ------------------------------------------------------------------
# 7. Le lien d'installation
# ------------------------------------------------------------------
titre "Le premier accès"
# LE LIEN PORTE LE CODE : ouvert dans un navigateur, il mène droit à la création
# du compte. Personne n'a de code à recopier, ni à revenir dans ce terminal.
CODE=""
if [ "$A_BLANC" = 0 ]; then
  CODE="$(cd "$DOSSIER" && sous_compte node scripts/code-installation.mjs 2>/dev/null || true)"
fi

echo
echo "════════════════════════════════════════════════════════════"
echo " Beluga Build est installé."
echo
if [ -n "$CODE" ]; then
  echo " Ouvrez ce lien dans votre navigateur pour créer votre compte :"
  echo
  echo "   $ADRESSE/?installation=$CODE"
  echo
  echo " Le lien ne sert qu'une fois. Perdu ? Cette commande en donne un neuf :"
  echo "   sudo -u $COMPTE node $DOSSIER/scripts/code-installation.mjs --lien"
elif [ "$A_BLANC" = 1 ]; then
  echo "   Ouvrez :  $ADRESSE"
  echo "   (essai à blanc : aucun lien n'a été tiré)"
else
  echo "   Ouvrez :  $ADRESSE"
  echo
  echo " Cette installation a déjà son compte principal : connectez-vous"
  echo " avec lui. Mot de passe oublié ?"
  echo "   sudo -u $COMPTE node $DOSSIER/scripts/set-credentials.mjs"
fi
if [ "$HOTE" = "$PROVISOIRE_HOTE" ] && [ "$A_BLANC" = 0 ]; then
  echo
  echo " Cette adresse est provisoire. Le certificat de sécurité"
  echo " peut mettre une minute à arriver à la première ouverture."
fi
echo "════════════════════════════════════════════════════════════"
