---
name: fail2ban-devant-traefik-en-docker
description: À utiliser dès qu'il faut bannir des adresses (rafales, pages pièges, récidive) sur un serveur où Traefik tourne en conteneur Docker avec ses ports publiés : « fail2ban ne bloque rien », « le bannissement n'agit pas sur les conteneurs », « le garde a banni la passerelle Docker », « renvoyer les robots d'IA avec Traefik ».
etat: active
themes: securite, serveur, docker
symptomes: fail2ban bannit mais le site reste joignable, toutes les visites viennent de 172.17.0.1, filtre fail2ban qui ne trouve rien dans le journal Traefik, renvoyer les robots d'IA avec Traefik
---

# fail2ban-devant-traefik-en-docker

## Procédure

1. Journal d'accès Traefik en JSON dans un fichier monté sur l'hôte (`accessLog.filePath`, `format: json`, `fields.headers.defaultMode: drop`, `names.User-Agent: keep`), rotation `copytruncate` (Traefik garde le fichier ouvert).
2. Filtres fail2ban sur l'ORDRE ALPHABÉTIQUE des clés de Traefik : `^\{.*"ClientHost":"<ADDR>",.*"RequestPath":"…"`, `datepattern = "time":"%%Y-%%m-%%dT%%H:%%M:%%S`.
3. `banaction = iptables-multiport[chain=DOCKER-USER]` : Docker DNAT les ports publiés et le trafic passe par FORWARD, jamais par INPUT.
4. `ignoreip` : les IP propres + 172.16.0.0/12, 10.0.0.0/8, 192.168.0.0/16 (le relais IPv6 de Docker présente l'adresse de la passerelle).
5. Récidive définitive : prison qui lit `/var/log/fail2ban.log` (lignes NOTICE « Ban »), `maxretry = 2`, `bantime = -1`.
6. Renvoyer un User-Agent (robots d'IA) : routeur en provider fichier, `rule: HeaderRegexp(\`User-Agent\`, \`(?i)(GPTBot|…)\`) && !Path(\`/page-libre\`)`, `priority` haute, `service: noop@internal`, middleware `redirectRegex` (`^(https?://[^/]+)/.*$` → `${1}/page-libre`).

## Vérification

Règle Traefik essayée dans un conteneur jetable (`docker run --rm traefik:v3.x --entrypoints.essai.address=:18443 --providers.file.directory=/dyn`, curl avec `--resolve` et `-A`) : le robot est renvoyé, un navigateur non. `fail2ban-regex <lignes fabriquées> filter.d/x.conf` compte les bonnes lignes ; `fail2ban-client -c <copie de /etc/fail2ban> -t` valide la configuration sans toucher au service. Carte Beluga 3560e2a5.

## Pièges

- Une règle posée dans INPUT laisse passer tout le trafic des conteneurs publiés.
- Sans les réseaux de Docker en liste blanche, une rafale en IPv6 bannit la passerelle, donc tout le monde.
- Ajouter un provider fichier ou un montage RECRÉE le conteneur Traefik : quelques secondes de coupure de tous les sites — à faire au moment choisi.
- `redirectRegex` avec `permanent: false` répond 302 (pas 307) en Traefik v3.
