#!/usr/bin/env bash
#
# LA RELÈVE DES PROJETS — le contraire de l'ancienne veille.
#
# L'ancien mécanisme ARRÊTAIT les serveurs de projets inactifs pour gagner de la
# mémoire ; il a été retiré le 07/09/2026 parce qu'un serveur de développement
# met jusqu'à DEUX MINUTES à répondre après son démarrage : le visiteur tombait
# sur une page blanche ou un 502 pendant tout ce temps.
#
# Ce script fait l'inverse : il repasse toutes les minutes et RELÈVE tout
# service « autoproject-* » ACTIVÉ qui est tombé. Il existe parce que systemd
# abandonne définitivement un service qui échoue cinq fois en cinq minutes
# (« Start request repeated too quickly ») — c'est ainsi qu'un projet restait
# mort des heures durant après un simple pic de mémoire au démarrage.
#
# Il ne touche JAMAIS un service désactivé : un projet éteint à la main le
# reste. Il n'arrête RIEN, jamais.
#
# Posé hors du dépôt, comme les autres surveillants :
#   sudo install -m 755 scripts/releve-des-projets.sh /usr/local/bin/
set -uo pipefail

PREFIXE='autoproject-'
JOURNAL_TAG='beluga-releve-projets'

dire() { logger -t "$JOURNAL_TAG" -- "$*" 2>/dev/null || echo "$*"; }

# Les unités RÉELLEMENT déclarées sur la machine, activées au démarrage.
mapfile -t unites < <(systemctl list-unit-files "${PREFIXE}*.service" --state=enabled --no-legend --no-pager 2>/dev/null | awk '{print $1}')

for unite in "${unites[@]}"; do
  [ -n "$unite" ] || continue

  # « oneshot » : une pile docker-compose montée une fois. La relever n'a pas de
  # sens, systemd la tient déjà par RemainAfterExit.
  type_service=$(systemctl show "$unite" -p Type --value 2>/dev/null)
  [ "$type_service" = 'oneshot' ] && continue

  etat=$(systemctl is-active "$unite" 2>/dev/null)
  case "$etat" in
    active|activating|reloading) continue ;;
  esac

  # Le compteur d'échecs de systemd bloque tout redémarrage tant qu'il n'est pas
  # remis à zéro : c'est LUI qui laisse un projet mort après un pic de mémoire.
  systemctl reset-failed "$unite" >/dev/null 2>&1
  if systemctl start "$unite" >/dev/null 2>&1; then
    dire "relevé : $unite (était « $etat »)"
  else
    dire "ÉCHEC de la relève : $unite (était « $etat »)"
  fi
done
