#!/usr/bin/env python3
"""
LAYA, CHARGÉ UNE FOIS, INTERROGÉ PAR LIGNES.

Le démon lance ce script avec le Python de `outils/laya/venv` et lui parle par
son entrée standard : une ligne JSON par question, une ligne JSON par réponse.
Le modèle (laya-multilingual, Apache-2.0, 322 M de paramètres) se charge UNE
fois — une dizaine de secondes, ~1,7 Go de mémoire — puis chaque jugement prend
0,2 à 3 s sur ce serveur selon la longueur de l'état.

    → {"id": 3, "state": ..., "questions": {...}, "max_len": 1024}
    ← {"id": 3, "answers": {...}, "usage": {...}}
    ← {"id": 3, "erreur": "..."}

La première ligne émise est {"id": 0, "pret": true} une fois le modèle chargé
(ou {"id": 0, "erreur": "..."} s'il ne se charge pas). Aucun réseau : le
démon pose HF_HUB_OFFLINE=1, et le modèle a été téléchargé par
`scripts/installer-laya.mjs`.

Les questions sont traitées UNE À UNE, dans l'ordre d'arrivée : sur quatre
cœurs, deux jugements simultanés se volent la machine (MEM-3380).
"""

import json
import os
import sys


def emettre(objet):
    sys.stdout.write(json.dumps(objet, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    try:
        import torch
        import laya

        torch.set_num_threads(int(os.environ.get("LAYA_FILS", "2")))
        # Une version entraînée ici (`outils/laya/versions/…`) est un DOSSIER complet :
        # aucun sous-dossier à choisir. Sinon, le modèle multilingue du cache.
        depot = os.environ.get("LAYA_DEPOT", "convaiinnovations/laya")
        local = os.path.isdir(depot)
        agent = laya.load(
            depot,
            subfolder=None if local else (os.environ.get("LAYA_CHECKPOINT") or "multilingual"),
            device="cpu",
        )
    except Exception as err:  # noqa: BLE001 — tout échec se dit, rien ne lève
        emettre({"id": 0, "erreur": f"chargement impossible : {err}"})
        return
    emettre({"id": 0, "pret": True})

    for ligne in sys.stdin:
        ligne = ligne.strip()
        if not ligne:
            continue
        ident = None
        try:
            demande = json.loads(ligne)
            ident = demande.get("id")
            resultat = agent.predict(
                demande["state"],
                demande["questions"],
                max_len=demande.get("max_len") or None,
            )
            emettre({"id": ident, "answers": resultat.get("answers", {}), "usage": resultat.get("usage", {})})
        except Exception as err:  # noqa: BLE001
            emettre({"id": ident, "erreur": str(err)[:500]})


if __name__ == "__main__":
    main()
