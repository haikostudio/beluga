#!/usr/bin/env python3
"""Transcription locale (famille Whisper). Rien ne part chez un tiers.

Usage : transcribe.py <fichier audio> [modele]
Sortie : le texte transcrit sur la sortie standard.
"""
import os
import sys

# Le dossier des modèles se déduit de l'endroit où CE script est posé : aucune
# installation n'est supposée vivre à un chemin précis.
_DONNEES = os.environ.get("BELUGA_DATA") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
MODEL_DIR = os.environ.get("BELUGA_WHISPER_DIR", os.path.normpath(os.path.join(_DONNEES, "models", "whisper")))


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: transcribe.py <audio>", file=sys.stderr)
        return 2

    audio = sys.argv[1]
    model_name = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("BELUGA_WHISPER_MODEL", "small")

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("faster-whisper absent", file=sys.stderr)
        return 3

    # Modèle « small » (≈ 1 Go en int8, déjà téléchargé) : « base » inventait du texte.
    # Deux fils : la dictée est ponctuelle, et le modèle ne reste pas chargé après.
    model = WhisperModel(
        model_name,
        device="cpu",
        compute_type="int8",
        download_root=MODEL_DIR,
        cpu_threads=int(os.environ.get("BELUGA_WHISPER_THREADS", "2")),
    )
    segments, _info = model.transcribe(
        audio,
        language="fr",
        beam_size=int(os.environ.get("BELUGA_WHISPER_BEAM", "5")),
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
        condition_on_previous_text=False,
        # Contre les passages inventés sur du silence ou du bruit.
        no_speech_threshold=0.6,
        compression_ratio_threshold=2.4,
    )
    text = " ".join(segment.text.strip() for segment in segments).strip()
    sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
