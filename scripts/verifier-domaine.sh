#!/usr/bin/env bash
# Vérifie si l'adresse définitive de HaikoDev est prête.
#
# Le serveur est déjà configuré pour répondre sur haikodev.haikostudio.cloud :
# il ne manque qu'un enregistrement DNS de type A chez Hostinger, pointant le
# sous-domaine « haikodev » vers l'adresse du serveur. Ce script dit où on en est.

set -uo pipefail

DOMAINE="${1:-haikodev.haikostudio.cloud}"
IP_SERVEUR="$(curl -s -4 --max-time 10 ifconfig.me || echo '203.0.113.10')"

echo "Adresse du serveur : ${IP_SERVEUR}"
echo

RESOLU="$(dig +short "${DOMAINE}" @1.1.1.1 2>/dev/null | tail -1)"

if [[ -z "${RESOLU}" ]]; then
  echo "❌ ${DOMAINE} ne pointe encore nulle part."
  echo
  echo "   À faire une seule fois, chez Hostinger (panneau DNS du domaine haikostudio.cloud) :"
  echo "     • Type       : A"
  echo "     • Nom        : haikodev"
  echo "     • Pointe vers: ${IP_SERVEUR}"
  echo "     • TTL        : laisser la valeur proposée"
  echo
  echo "   Comptez quelques minutes, puis relancez ce script."
  exit 1
fi

if [[ "${RESOLU}" != "${IP_SERVEUR}" ]]; then
  echo "⚠️  ${DOMAINE} pointe vers ${RESOLU}, alors que le serveur est en ${IP_SERVEUR}."
  echo "   Corrigez l'enregistrement A chez Hostinger."
  exit 2
fi

echo "✅ Le nom pointe bien vers ce serveur."

CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 45 "https://${DOMAINE}/" || echo '000')"
if [[ "${CODE}" == "200" ]]; then
  echo "✅ Le certificat est en place et la page de connexion répond."
  echo
  echo "   Adresse définitive : https://${DOMAINE}"
  exit 0
fi

echo "⏳ Le nom est bon mais la page répond « ${CODE} »."
echo "   Le certificat se fabrique à la première visite : réessayez dans une minute."
exit 3
