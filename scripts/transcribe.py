#!/usr/bin/env python3
"""Transcription locale (famille Whisper). Rien ne part chez un tiers.

Usage : transcribe.py <fichier audio> [modele]
Sortie : le texte transcrit sur la sortie standard.
"""
import os
import sys

MODEL_DIR = os.environ.get("HAIKODEV_WHISPER_DIR", "/root/haikodev/data/models/whisper")


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: transcribe.py <audio>", file=sys.stderr)
        return 2

    audio = sys.argv[1]
    model_name = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("HAIKODEV_WHISPER_MODEL", "base")

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("faster-whisper absent", file=sys.stderr)
        return 3

    # Modèle léger, un seul fil : la dictée ne doit pas manger le serveur.
    model = WhisperModel(
        model_name,
        device="cpu",
        compute_type="int8",
        download_root=MODEL_DIR,
        cpu_threads=1,
    )
    segments, _info = model.transcribe(
        audio,
        language="fr",
        beam_size=1,
        vad_filter=True,
        condition_on_previous_text=False,
    )
    text = " ".join(segment.text.strip() for segment in segments).strip()
    sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
