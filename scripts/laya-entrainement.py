#!/usr/bin/env python3
"""
RÉENTRAÎNER LAYA SUR CE SERVEUR, PAR TRANCHES, SANS JAMAIS DÉBORDER DE LA NUIT.

Lancé par `scripts/laya-nuit.mjs` avec le Python de `outils/laya/venv`. Suit la
boucle officielle de Laya (notebook `laya_finetune_typed_decisions_2xT4_kaggle`) :
récompense de score propre + entropie croisée douce (RLCD), puis calibration des
températures sur une part tenue à l'écart. Trois adaptations à CE serveur (4 cœurs,
7,7 Go, aucune carte graphique), mesurées le 25.09.2026 :

  - SEULES LES DERNIÈRES COUCHES DE L'ENCODEUR APPRENNENT (`--couches`, défaut 4)
    avec la tête de décision : un pas de 8 questions prend ~15 s et ~3 Go, contre
    plus de 5 Go pour le modèle entier (poids, gradients et états d'AdamW) ;
  - LA PASSE SE FAIT PAR TRANCHES : l'état (poids appris, optimiseur, position)
    est sauvé, et la nuit suivante reprend exactement là ;
  - DEUX ARRÊTS PROPRES : l'heure (`--fin`, en ms) et la mémoire libre
    (`--memoire-min`, en Mo). Aucun des deux ne perd le travail fait.

Une ligne JSON finale dit l'issue : {"issue": "tranche"|"passe-complete"|"interrompu"|"rien", ...}.
À chaque fin de nuit où quelque chose a été appris, une version CANDIDATE complète
est écrite dans `<travail>/candidat` (chargeable par `laya.load`) : c'est elle que
l'examen compare à la version en service.
"""

import argparse
import hashlib
import json
import math
import os
import random
import shutil
import sys
import time


def memoire_libre_mo():
    try:
        with open("/proc/meminfo") as f:
            for ligne in f:
                if ligne.startswith("MemAvailable:"):
                    return int(ligne.split()[1]) // 1024
    except OSError:
        pass
    return 1 << 20


def dire(objet):
    sys.stdout.write(json.dumps(objet, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def journal(texte):
    sys.stderr.write(time.strftime("%H:%M:%S ") + texte + "\n")
    sys.stderr.flush()


def empreinte_fichier(chemin):
    h = hashlib.sha1()
    with open(chemin, "rb") as f:
        for bloc in iter(lambda: f.read(1 << 20), b""):
            h.update(bloc)
    return h.hexdigest()[:16]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--base", required=True, help="dossier du modèle de départ (celui en service)")
    p.add_argument("--jeu", required=True, help="exemples.jsonl")
    p.add_argument("--travail", required=True, help="dossier d'état de l'entraînement")
    p.add_argument("--fin", type=float, required=True, help="instant d'arrêt, en ms depuis l'époque")
    p.add_argument("--memoire-min", type=int, default=700)
    p.add_argument("--fils", type=int, default=3)
    p.add_argument("--couches", type=int, default=4)
    p.add_argument("--epoques", type=int, default=3)
    p.add_argument("--lot", type=int, default=4)
    p.add_argument("--accum", type=int, default=4)
    p.add_argument("--max-len", type=int, default=512)
    p.add_argument("--max-pas", type=int, default=0, help="essai : s'arrêter après N micro-lots")
    a = p.parse_args()

    import torch
    from safetensors.torch import save_file
    import laya
    from laya.agent import Agent
    from laya.common import QTYPES, proper_reward, render_options

    torch.set_num_threads(max(1, a.fils))
    os.makedirs(a.travail, exist_ok=True)
    fichier_etat = os.path.join(a.travail, "etat.pt")
    jeu_de_passe = os.path.join(a.travail, "jeu-de-la-passe.jsonl")

    # ---- La passe : reprise, ou nouvelle -------------------------------------------
    etat = None
    if os.path.exists(fichier_etat):
        try:
            etat = torch.load(fichier_etat, weights_only=False)
        except Exception as err:  # noqa: BLE001
            journal(f"état illisible, nouvelle passe : {err}")
            etat = None
    if etat and etat.get("base") != os.path.realpath(a.base):
        journal("la version en service a changé depuis le début de la passe : nouvelle passe")
        etat = None
    if etat is None or not os.path.exists(jeu_de_passe):
        shutil.copyfile(a.jeu, jeu_de_passe)
        etat = None

    exemples = []
    with open(jeu_de_passe) as f:
        for ligne in f:
            ligne = ligne.strip()
            if ligne:
                ex = json.loads(ligne)
                if ex.get("partie") == "entrainement":
                    exemples.append(ex)
    if not exemples:
        dire({"issue": "rien", "raison": "aucun exemple d'entraînement"})
        return

    agent = laya.load(a.base, device="cpu")
    model, tok = agent.model, agent.tok
    journal(f"modèle chargé depuis {a.base}, {memoire_libre_mo()} Mo libres")

    # ---- Les questions, encodées exactement comme à la prédiction ---------------------
    def encoder(ex):
        q = ex["question"]
        interne = Agent._to_internal(q)
        items = agent._encode_state(ex["state"], [ex["cle"]], {ex["cle"]: interne}, max_len=a.max_len)
        it = items[0]
        k = len(render_options(interne))
        if q["type"] == "noul":
            cible = [0.05, 0.95] if ex["cible"] is True else [0.95, 0.05]
        elif q["type"] == "choice":
            cles = list(interne["crit"].keys())
            if ex["cible"] not in cles:
                return None
            cible = [0.9 if c == ex["cible"] else 0.1 / max(1, k - 1) for c in cles]
        else:
            return None
        it["target"] = cible
        return it

    items = []
    for ex in exemples:
        try:
            it = encoder(ex)
        except Exception as err:  # noqa: BLE001
            journal(f"exemple {ex.get('id')} écarté : {err}")
            continue
        if it:
            items.append(it)

    # La part de calibration est tenue à l'écart dès le début de la passe, graine fixe.
    ordre = list(range(len(items)))
    random.Random(20260925).shuffle(ordre)
    n_calib = max(10, len(items) // 10)
    calib = [items[i] for i in sorted(ordre[:n_calib])]
    entr = [items[i] for i in sorted(ordre[n_calib:])]

    # ---- Ce qui apprend : la tête et les dernières couches de l'encodeur ---------------
    noms = [n for n, _ in model.named_parameters()]
    couches = sorted({int(n.split("layers.")[1].split(".")[0]) for n in noms if n.startswith("encoder.") and "layers." in n})
    gardees = set(couches[-a.couches:]) if a.couches > 0 else set()

    def apprend(nom):
        if not nom.startswith("encoder."):
            return True
        if "layers." not in nom:
            return False
        return int(nom.split("layers.")[1].split(".")[0]) in gardees

    for n, prm in model.named_parameters():
        prm.requires_grad = apprend(n)
    appris = {n: prm for n, prm in model.named_parameters() if prm.requires_grad}
    enc = [prm for n, prm in appris.items() if n.startswith("encoder.")]
    tete = [prm for n, prm in appris.items() if not n.startswith("encoder.")]
    opt = torch.optim.AdamW([{"params": enc, "lr": 2.5e-5}, {"params": tete, "lr": 1.0e-4}], weight_decay=0.01)
    micro_par_epoque = math.ceil(len(entr) / a.lot)
    total_maj = max(1, (micro_par_epoque // a.accum) * a.epoques)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=total_maj, eta_min=1e-6)

    if etat:
        with torch.no_grad():
            for n, t in etat["appris"].items():
                if n in appris:
                    appris[n].copy_(t)
        opt.load_state_dict(etat["optimiseur"])
        sched.load_state_dict(etat["planning"])
        epoque, position, pas_total = etat["epoque"], etat["position"], etat["pas"]
        journal(f"reprise : époque {epoque + 1}/{a.epoques}, position {position}/{len(entr)}")
    else:
        epoque, position, pas_total = 0, 0, 0
        journal(f"nouvelle passe : {len(entr)} questions d'entraînement, {len(calib)} de calibration")

    try:
        model.encoder.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    except Exception:  # noqa: BLE001
        pass
    model.head_checkpointing = True
    pad = tok.pad_token_id

    def lot_de(chunk):
        n, L = len(chunk), max(len(it["ids"]) for it in chunk)
        kmax = max(len(it["markers"]) for it in chunk)
        ids = torch.full((n, L), pad, dtype=torch.long)
        att = torch.zeros((n, L), dtype=torch.long)
        mpos = torch.zeros((n, kmax), dtype=torch.long)
        mmask = torch.zeros((n, kmax), dtype=torch.bool)
        cible = torch.zeros((n, kmax))
        for i, it in enumerate(chunk):
            ids[i, : len(it["ids"])] = torch.tensor(it["ids"])
            att[i, : len(it["ids"])] = 1
            k = len(it["markers"])
            mpos[i, :k] = torch.tensor(it["markers"])
            mmask[i, :k] = True
            cible[i, : len(it["target"])] = torch.tensor(it["target"])
        return ids, att, mpos, mmask, torch.tensor([it["qtype"] for it in chunk]), cible

    def sauver_etat():
        torch.save(
            {
                "base": os.path.realpath(a.base),
                "appris": {n: t.detach().clone() for n, t in appris.items()},
                "optimiseur": opt.state_dict(),
                "planning": sched.state_dict(),
                "epoque": epoque,
                "position": position,
                "pas": pas_total,
            },
            fichier_etat + ".tmp",
        )
        os.replace(fichier_etat + ".tmp", fichier_etat)

    # ---- L'entraînement, par micro-lots ------------------------------------------------
    raison = ""
    duree_pas = 20.0
    pas_nuit = 0
    model.train()
    opt.zero_grad(set_to_none=True)
    while epoque < a.epoques:
        melange = list(range(len(entr)))
        random.Random(42 + epoque).shuffle(melange)
        sigma = 0.4 + (0.1 - 0.4) * (epoque / max(1, a.epoques - 1))
        while position < len(entr):
            if time.time() * 1000 + duree_pas * 1500 > a.fin:
                raison = "heure de fin atteinte"
                break
            if memoire_libre_mo() < a.memoire_min:
                raison = f"mémoire libre sous {a.memoire_min} Mo"
                break
            if a.max_pas and pas_nuit >= a.max_pas:
                raison = "essai : nombre de pas atteint"
                break
            debut = time.time()
            chunk = [entr[melange[i]] for i in range(position, min(position + a.lot, len(entr)))]
            ids, att, mpos, mmask, qt, cible = lot_de(chunk)
            logits, act = model(ids, att, mpos, mmask, qt)
            logits = logits.float()
            k = mmask.sum(-1, keepdim=True).float()
            eps = torch.randn((4,) + logits.shape) * sigma * mmask
            eps = (eps - eps.sum(-1, keepdim=True) / k) * mmask
            z = logits.detach().unsqueeze(0) + eps
            q = torch.softmax(z.masked_fill(~mmask, -1e4), -1)
            with torch.no_grad():
                r = proper_reward(q, cible.unsqueeze(0), qt, mmask, w_sph=0.75, w_rps=1.0)
                adv = (r - r.mean(0, keepdim=True)) / ((r - r.mean(0, keepdim=True)).std() + 1e-6)
            logp = -(((z - logits.unsqueeze(0)) ** 2) * mmask).sum(-1) / (2 * sigma**2)
            perte = -(adv * logp).mean() - (cible * torch.log_softmax(logits.masked_fill(~mmask, -1e4), -1)).sum(-1).mean()
            (perte / a.accum + 0.0 * act.sum()).backward()
            position += len(chunk)
            pas_total += 1
            pas_nuit += 1
            if pas_total % a.accum == 0 or position >= len(entr):
                torch.nn.utils.clip_grad_norm_(list(appris.values()), 1.0)
                opt.step()
                sched.step()
                opt.zero_grad(set_to_none=True)
            duree_pas = 0.8 * duree_pas + 0.2 * (time.time() - debut)
            if pas_nuit % 25 == 0:
                journal(f"époque {epoque + 1}, {position}/{len(entr)}, perte {perte.item():.3f}, {duree_pas:.1f} s/pas, {memoire_libre_mo()} Mo libres")
                sauver_etat()
        if raison:
            break
        epoque += 1
        position = 0

    passe_complete = epoque >= a.epoques
    sauver_etat()
    progression = min(1.0, (epoque * len(entr) + position) / max(1, a.epoques * len(entr)))
    if pas_nuit == 0:
        dire({"issue": "interrompu" if raison else "rien", "raison": raison or "rien à apprendre", "progression": progression})
        return
    if memoire_libre_mo() < a.memoire_min:
        dire({"issue": "interrompu", "raison": raison, "progression": progression, "pas": pas_nuit})
        return

    # ---- Calibration des températures, sur la part jamais vue ---------------------------
    model.eval()
    par_type = {0: [], 1: [], 2: []}
    with torch.no_grad():
        for i in range(0, len(calib), 8):
            chunk = calib[i : i + 8]
            ids, att, mpos, mmask, qt, cible = lot_de(chunk)
            logits, _ = model(ids, att, mpos, mmask, qt)
            for j, it in enumerate(chunk):
                kk = len(it["markers"])
                # La calibration se mesure contre la VRAIE réponse (un seul 1), jamais
                # contre la cible adoucie de l'entraînement : celle-ci pousse toutes
                # les températures au plafond et rend chaque réponse « peu sûre ».
                vraie = torch.zeros(kk)
                vraie[int(torch.tensor(it["target"]).argmax())] = 1.0
                par_type[it["qtype"]].append((logits[j, :kk].float(), vraie))

    def une_temperature(sel):
        if len(sel) < 10:
            return 1.0
        kmax = max(len(zz) for zz, _ in sel)
        Z = torch.full((len(sel), kmax), -1e4)
        T = torch.zeros((len(sel), kmax))
        for i, (zz, tt) in enumerate(sel):
            Z[i, : len(zz)] = zz
            T[i, : len(tt)] = tt
        log_t = torch.zeros(1, requires_grad=True)
        o = torch.optim.LBFGS([log_t], lr=0.1, max_iter=100)

        def fermeture():
            o.zero_grad()
            l = -(T * torch.log_softmax(Z / log_t.exp(), -1)).sum(-1).mean()
            l.backward()
            return l

        o.step(fermeture)
        return float(torch.clamp(log_t.exp(), 0.5, 3.0).item())

    temperatures = [une_temperature(par_type[t]) for t in range(3)]

    # ---- La version candidate, complète --------------------------------------------------
    cand = os.path.join(a.travail, "candidat")
    tmp = cand + ".tmp"
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    sd = {n: t.detach().half().contiguous() for n, t in model.state_dict().items()}
    save_file(sd, os.path.join(tmp, "model.safetensors"))
    del sd
    model.encoder.config.save_pretrained(os.path.join(tmp, "encoder"))
    tok.save_pretrained(os.path.join(tmp, "tokenizer"))
    cfg = dict(agent.cfg)
    cfg["fine_tuned"] = True
    cfg["model_name"] = "laya-beluga"
    cfg["temperature"] = temperatures
    cfg.pop("temperature_by_options", None)
    cfg["beluga"] = {
        "base": os.path.realpath(a.base),
        "jeu": empreinte_fichier(jeu_de_passe),
        "epoque": epoque,
        "position": position,
        "passe_complete": passe_complete,
        "couches": a.couches,
        "ecrit_le": int(time.time() * 1000),
    }
    with open(os.path.join(tmp, "rl_agent_config.json"), "w") as f:
        json.dump(cfg, f, indent=2)
    shutil.rmtree(cand, ignore_errors=True)
    os.replace(tmp, cand)

    if passe_complete:
        # La passe suivante repartira de la version en service, sur un jeu rafraîchi.
        for chemin in (fichier_etat, jeu_de_passe):
            try:
                os.remove(chemin)
            except OSError:
                pass
    dire(
        {
            "issue": "passe-complete" if passe_complete else "tranche",
            "raison": raison or "passe terminée",
            "progression": 1.0 if passe_complete else progression,
            "pas": pas_nuit,
            "temperatures": temperatures,
            "candidat": cand,
        }
    )


if __name__ == "__main__":
    main()
