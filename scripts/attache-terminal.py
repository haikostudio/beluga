#!/usr/bin/env python3
"""
ATTACHE UN CLIENT TMUX SUR UN VRAI TERMINAL, À LA TAILLE DE L'ÉCRAN.

`tmux attach` refuse de démarrer sur de simples tuyaux : il lui faut un TERMINAL.
Le démon, lui, n'en a pas — il parle à ce processus par des tuyaux.

`script(1)` sait fabriquer ce terminal, mais TOUJOURS en 80×24 : sa taille vient
de son propre terminal, et il n'en a pas non plus. Le client tmux restait donc
bridé à 80 colonnes, et l'écran ne montrait qu'un MORCEAU de la fenêtre, quelle
que soit la largeur du navigateur.

Ce script fait la seule chose qui manquait : il ouvre le terminal LUI-MÊME et lui
POSE la taille demandée (TIOCSWINSZ), avant de lancer `tmux attach` dedans.
Ensuite il ne fait que recopier, dans les deux sens :

  tuyau d'entrée  (fd 0) → terminal → tmux
  tmux → terminal → tuyau de sortie (fd 1)

et il écoute un QUATRIÈME tuyau (fd 3) où le démon écrit « colonnes×lignes » à
chaque fois que la fenêtre du navigateur change de taille : la taille du terminal
est refaite et un SIGWINCH prévient tmux, exactement comme le ferait un vrai
émulateur qu'on redimensionne à la souris.

C'est ce qui évite d'ajouter un module NATIF (`node-pty`) à recompiler à chaque
changement de version de Node : tout est ici, dans la bibliothèque standard.
"""

import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios

# Les trois premiers tuyaux portent la frappe, la sortie et les erreurs ; le
# canal des tailles est le quatrième que le démon ouvre, soit fd 3.
FD_TAILLES = 3


def poser_la_taille(fd, colonnes, lignes):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", lignes, colonnes, 0, 0))


def main():
    if len(sys.argv) < 4:
        print("usage : attache-terminal.py <session> <colonnes> <lignes>", file=sys.stderr)
        return 2
    session, colonnes, lignes = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])

    maitre, esclave = pty.openpty()
    poser_la_taille(esclave, colonnes, lignes)

    enfant = os.fork()
    if enfant == 0:
        # Dans l'enfant : le terminal devient l'entrée, la sortie et les erreurs,
        # puis tmux prend la place du processus.
        os.close(maitre)
        os.setsid()
        fcntl.ioctl(esclave, termios.TIOCSCTTY, 0)
        os.dup2(esclave, 0)
        os.dup2(esclave, 1)
        os.dup2(esclave, 2)
        if esclave > 2:
            os.close(esclave)
        os.environ["TERM"] = os.environ.get("TERM", "xterm-256color")
        os.execvp("tmux", ["tmux", "attach-session", "-t", session])
        os._exit(127)

    os.close(esclave)
    entree, sortie = 0, 1
    try:
        tailles = os.fdopen(FD_TAILLES, "rb", buffering=0)
    except OSError:
        tailles = None

    surveilles = [maitre, entree] + ([tailles.fileno()] if tailles else [])
    reste = b""
    while True:
        try:
            prets, _, _ = select.select(surveilles, [], [])
        except InterruptedError:
            continue
        for fd in prets:
            if fd == maitre:
                try:
                    morceau = os.read(maitre, 65536)
                except OSError:
                    morceau = b""
                if not morceau:
                    return fin(enfant)
                os.write(sortie, morceau)
            elif fd == entree:
                morceau = os.read(entree, 65536)
                if not morceau:
                    return fin(enfant)
                os.write(maitre, morceau)
            else:
                morceau = tailles.read(4096) if tailles else b""
                if not morceau:
                    surveilles.remove(fd)
                    tailles = None
                    continue
                reste += morceau
                while b"\n" in reste:
                    ligne, reste = reste.split(b"\n", 1)
                    try:
                        c, l = ligne.decode().strip().split("x")
                        poser_la_taille(maitre, int(c), int(l))
                        os.kill(enfant, signal.SIGWINCH)
                    except (ValueError, ProcessLookupError, OSError):
                        pass


def fin(enfant):
    try:
        os.kill(enfant, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        _, statut = os.waitpid(enfant, 0)
        return os.waitstatus_to_exitcode(statut)
    except ChildProcessError:
        return 0


if __name__ == "__main__":
    sys.exit(main())
