---
name: oompolicy-systemd-enfant-tue-par-le-noyau
description: À utiliser dès qu'un service systemd qui lance des enfants lourds (navigateurs headless, constructions, agents) tombe en entier avec « Failed with result 'oom-kill' » alors que le processus principal était petit, ou avant de protéger un démon contre le tueur de mémoire du noyau (OOMScoreAdjust, oom_score_adj).
etat: active
themes: systemd, memoire, linux, serveur
symptomes: Failed with result oom-kill, service arrêté après la mort d'un seul enfant, démon tué alors qu'il était petit, enfants aussi protégés que le démon
---

# oompolicy-systemd-enfant-tue-par-le-noyau

## Symptôme

Le noyau tue un seul processus enfant faute de mémoire (souvent un chrome), et systemd arrête l'unité entière : le service principal disparaît, toutes ses connexions tombent.

## Cause

`OOMPolicy=stop` est le défaut de systemd : un OOM-kill DANS le cgroup de l'unité arrête toute l'unité. Et `OOMScoreAdjust=` posé sur l'unité est hérité par chaque enfant : un démon protégé à -500 protège autant ses navigateurs, et le noyau n'a aucune préférence.

## Procédure

1. Dans l'unité : `OOMPolicy=continue` (seul le processus tué disparaît) ; garder `Restart=always` pour le cas où c'est le processus principal qui meurt.
2. Sur une machine déjà installée : un fichier d'appoint `<unité>.d/xxx.conf` avec `[Service]\nOOMPolicy=continue`, puis `systemctl daemon-reload` (aucun redémarrage).
3. Relever la note des enfants pour qu'ils partent avant le démon : un processus peut MONTER sans privilège le `oom_score_adj` d'un processus du même compte (`/proc/<pid>/oom_score_adj`) ; baisser sous la valeur minimale demande CAP_SYS_RESOURCE. Parcourir `/sys/fs/cgroup<chemin de /proc/self/cgroup>/cgroup.procs` régulièrement, ne jamais toucher le principal (par pid ET par nom), ne jamais abaisser une note.

## Vérification

Unité jetable : `sudo systemd-run --unit=essai-oom -p MemoryMax=60M -p MemorySwapMax=0 -p OOMPolicy=continue /bin/sh -c 'python3 -c "b=bytearray(300*1024*1024)"; sleep 20'` puis `systemctl show essai-oom -p ActiveState -p Result` → `active success` (avec `OOMPolicy=stop` : `failed oom-kill`) ; arrêter puis `reset-failed` l'unité. `systemd-analyze verify <unité>` ne signale rien. `systemctl show <unité> -p OOMPolicy` après daemon-reload.

## Pièges

- Sans `MemorySwapMax=0`, l'unité d'essai déborde dans l'échange au lieu d'être tuée.
- Un second processus de même code (démon d'essai) dans le même cgroup ferait le balayage contre le principal : refuser par nom de processus, pas seulement par pid.
- La modification n'agit qu'après daemon-reload.
