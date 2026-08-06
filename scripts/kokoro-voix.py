#!/usr/bin/env python3
"""
Fabrique un son avec le moteur Kokoro, à côté de Piper.

Le texte arrive sur l'entrée standard, le son sort dans le fichier demandé, au
format WAV ordinaire — exactement comme Piper, pour que le reste du démon
(cache, adresse `/api/speak`, essai de voix) n'ait rien à savoir du moteur.

Deux différences avec Piper, absorbées ici :
  - la vitesse. Piper prend une LONGUEUR (`--length_scale`, > 1 ralentit),
    Kokoro une VITESSE (> 1 accélère). On reçoit la longueur, on l'inverse.
  - la langue. Kokoro est un modèle unique multilingue : la langue se dit à
    l'appel, elle se déduit ici de la première lettre du nom de la voix
    (« ff_siwis » = français femme).

Aucune bibliothèque de son n'est requise : le WAV est écrit à la main.
"""

import argparse
import sys
import wave

import numpy as np
from kokoro_onnx import Kokoro

# La première lettre du nom d'une voix Kokoro dit sa langue. On ne cite que
# celles qui nous servent ; toute autre est lue en anglais américain.
LANGUES = {
    "f": "fr-fr",
    "a": "en-us",
    "b": "en-gb",
    "e": "es",
    "i": "it",
    "p": "pt-br",
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--voices", required=True)
    parser.add_argument("--voice", required=True)
    parser.add_argument("--length-scale", type=float, default=1.0)
    parser.add_argument("--output-file", required=True)
    args = parser.parse_args()

    texte = sys.stdin.read().strip()
    if not texte:
        print("aucun texte à dire", file=sys.stderr)
        return 1

    kokoro = Kokoro(args.model, args.voices)
    vitesse = 1.0 / args.length_scale if args.length_scale > 0 else 1.0
    echantillons, frequence = kokoro.create(
        texte,
        voice=args.voice,
        speed=vitesse,
        lang=LANGUES.get(args.voice[:1], "en-us"),
    )

    # Kokoro rend des nombres flottants entre -1 et 1 ; un WAV ordinaire attend
    # des entiers sur 16 bits.
    entiers = np.clip(np.asarray(echantillons, dtype=np.float32), -1.0, 1.0)
    entiers = (entiers * 32767).astype("<i2")
    with wave.open(args.output_file, "wb") as sortie:
        sortie.setnchannels(1)
        sortie.setsampwidth(2)
        sortie.setframerate(int(frequence))
        sortie.writeframes(entiers.tobytes())
    return 0


if __name__ == "__main__":
    sys.exit(main())
