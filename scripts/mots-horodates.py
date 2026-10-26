#!/usr/bin/env python3
"""Mots horodatés d'un son (famille Whisper, sur le serveur). Rien ne part chez un tiers.

Usage : mots-horodates.py <fichier audio> [modele]
Sortie : une ligne JSON {"mots": [{"texte", "debut", "fin"}], "duree": s}.

Sert au DIRECTEUR ARTISTIQUE (vidéos fabriquées sur le serveur) : les sous-titres d'une voix se calent sur ces temps. Le texte
reconnu n'est jamais affiché — il peut se tromper de mot (« voie » pour
« voix ») ; seuls les TEMPS comptent, alignés ensuite sur le texte connu.
"""
import json
import os
import sys

# Le dossier des modèles se déduit de l'endroit où CE script est posé : aucune
# installation n'est supposée vivre à un chemin précis.
_DONNEES = os.environ.get("BELUGA_DATA") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
MODEL_DIR = os.environ.get("BELUGA_WHISPER_DIR", os.path.normpath(os.path.join(_DONNEES, "models", "whisper")))


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: mots-horodates.py <audio> [modele]", file=sys.stderr)
        return 2
    audio = sys.argv[1]
    model_name = sys.argv[2] if len(sys.argv) > 2 else "base"
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("faster-whisper absent", file=sys.stderr)
        return 3
    # Un seul fil : le studio passe dans la même file que l'export, la machine reste au reste.
    model = WhisperModel(model_name, device="cpu", compute_type="int8", download_root=MODEL_DIR, cpu_threads=1, local_files_only=True)
    segments, info = model.transcribe(audio, language="fr", beam_size=1, word_timestamps=True, vad_filter=False, condition_on_previous_text=False)
    mots = []
    for segment in segments:
        for mot in segment.words or []:
            texte = (mot.word or "").strip()
            if texte:
                mots.append({"texte": texte, "debut": round(float(mot.start), 3), "fin": round(float(mot.end), 3)})
    sys.stdout.write(json.dumps({"mots": mots, "duree": round(float(getattr(info, "duration", 0) or 0), 3)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
