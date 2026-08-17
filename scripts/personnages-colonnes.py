#!/usr/bin/env python3
"""
FABRIQUE LES PERSONNAGES DES COLONNES, à partir des images brutes de l'utilisateur.

Un geste PONCTUEL, pas une étape de construction : les images produites sont
versionnées dans `web/public/personnages/`, ce script ne sert qu'à les REFAIRE
si l'utilisateur fournit d'autres personnages (ou change un cadrage).

Ce qu'il fait, pour chaque image brute (personnage en pâte à modeler posé sur un
fond blanc uni, avec son ombre douce) :

 1. DÉTOURE — le fond est reconnu par sa couleur (relevée sur les bords) et par
    son absence de couleur (gris très clair) ; seul le fond CONNECTÉ au bord est
    retiré, sinon le blanc des yeux partirait avec lui. L'ombre portée, grise et
    désaturée, tombe dans le même filet. Les bords gardent un alpha progressif :
    sans lui le personnage aurait un liseré en escalier.
 2. SILHOUETTE — le personnage entier, recadré au plus juste puis reposé dans une
    boîte de proportion FIXE (3:4), centré horizontalement et collé en bas. La
    proportion fixe est ce qui permet à l'interface de poser tous les
    personnages avec le MÊME décalage, sans mesurer chaque image.
 3. PORTRAIT — la tête et le haut du corps, dans un disque. Le cadrage part de la
    boîte du personnage et d'une part de tête réglée à la main par personnage
    (`CADRAGES`), car aucun repère automatique ne distingue un chapeau d'une
    chevelure. Le disque porte un fond crème très clair : sans lui, un visage
    détouré posé sur le fond noir d'une notification perd ses contours.

Usage :
    python3 scripts/personnages-colonnes.py [dossier-des-images-brutes]

Sans argument, il lit les pièces jointes du projet (`data/attachments`) et prend,
pour chaque colonne, le fichier le PLUS RÉCENT dont le nom finit par le nom
attendu (« …-notes.PNG »).
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

RACINE = Path(__file__).resolve().parent.parent
SORTIE = RACINE / 'web' / 'public' / 'personnages'

# Le nom donné par l'utilisateur → la clé de colonne du tableau (COLUMN_KEYS).
COLONNES = {
    'notes': 'notes',
    'planife': 'planned',
    'en-cours': 'running',
    'termine': 'done',
    'deploiement': 'to_deploy',
    'production': 'in_production',
    'archives': 'archived',
}

# La part HAUTE du personnage que garde le portrait rond, en fraction de sa
# hauteur totale : la tête, plus un tout petit peu du haut du corps. Réglée à
# l'œil, personnage par personnage — un chapeau, une chevelure haute ou un outil
# tenu en l'air déplacent le sommet sans déplacer le visage.
CADRAGES = {
    'notes': 0.60,
    'planned': 0.62,
    'running': 0.60,
    'done': 0.60,
    'to_deploy': 0.60,
    'in_production': 0.60,
    'archived': 0.60,
}

# La boîte de la silhouette : trois de large pour quatre de haut. Tous les
# personnages y entrent, donc l'interface n'a qu'un seul décalage à connaître.
SILHOUETTE_H = 168
SILHOUETTE_L = 126
# Le portrait rond : la taille attendue d'une icône de notification.
PORTRAIT = 192
# Le fond du disque : un crème très clair, lisible sur un thème sombre comme clair.
FOND_PORTRAIT = (247, 244, 240)


def sans_les_ilots(opaque: np.ndarray, part_minimale: float = 0.02) -> np.ndarray:
    """
    Ne garde que le personnage : les ÎLOTS restés à côté de lui — un bout
    d'ombre portée trop sombre pour passer le filtre du fond — sont effacés.
    Est un îlot toute tache dont l'aire tombe sous une part de la plus grande.
    """
    travail = Image.fromarray(np.where(opaque, 255, 0).astype(np.uint8), 'L').copy()
    aires: list[tuple[int, int]] = []  # (aire, marque)
    marque = 1
    while marque < 60:
        restant = np.asarray(travail) == 255
        if not restant.any():
            break
        ligne, colonne = np.argwhere(restant)[0]
        ImageDraw.floodfill(travail, (int(colonne), int(ligne)), marque, thresh=0)
        aires.append((int((np.asarray(travail) == marque).sum()), marque))
        marque += 1
    if not aires:
        return np.ones_like(opaque, dtype=np.float32)
    plus_grande = max(aire for aire, _ in aires)
    gardees = {m for aire, m in aires if aire >= plus_grande * part_minimale}
    etiquettes = np.asarray(travail)
    return np.isin(etiquettes, list(gardees)).astype(np.float32)


def detourer(image: Image.Image) -> Image.Image:
    """Rend l'image en RGBA, fond (et ombre portée) transparents."""
    rgb = np.asarray(image.convert('RGB')).astype(np.int16)
    h, l = rgb.shape[:2]

    # La couleur du fond : la médiane d'une bande de 8 pixels tout autour. Une
    # médiane, pas une moyenne — un coin sombre ne la déplacerait pas.
    bordure = np.concatenate([
        rgb[:8].reshape(-1, 3), rgb[-8:].reshape(-1, 3),
        rgb[:, :8].reshape(-1, 3), rgb[:, -8:].reshape(-1, 3),
    ])
    fond = np.median(bordure, axis=0)

    distance = np.sqrt(((rgb - fond) ** 2).sum(axis=2))
    clair = rgb.max(axis=2)
    saturation = rgb.max(axis=2) - rgb.min(axis=2)

    # Candidat au fond : soit la couleur du fond, soit un gris clair sans
    # couleur — c'est l'ombre portée, qui n'appartient pas au personnage.
    candidat = (distance < 26) | ((saturation <= 14) & (clair >= 205))

    # Seul ce qui TOUCHE le bord est du fond : le blanc des yeux, la chemise
    # crème ou un outil gris restent au personnage.
    # PIÈGE : une image née de `fromarray` partage le tableau numpy en LECTURE
    # SEULE — `floodfill` n'y écrit rien et ne dit rien. Le `.copy()` lui donne
    # un vrai tampon à elle.
    masque = Image.fromarray(np.where(candidat, 255, 0).astype(np.uint8), 'L').copy()
    ImageDraw.floodfill(masque, (0, 0), 128, thresh=0)
    dehors = np.asarray(masque) == 128

    # DEDANS ou DEHORS, franchement : l'alpha ne se DÉDUIT PAS de la distance à
    # la couleur du fond. Le rendu 3D pose autour du personnage un halo BLANC —
    # plus clair que le fond gris, donc « loin » de lui : un alpha progressif le
    # gardait à demi opaque et laissait une flaque blanche au pied de chaque
    # personnage, bien visible sur un thème sombre.
    alpha = (~dehors).astype(np.float32)
    alpha *= sans_les_ilots(alpha > 0.5)

    # Un demi-pixel de flou sur le seul canal alpha : le liseré en escalier
    # disparaît sans que la couleur ne bave.
    canal = Image.fromarray((alpha * 255).astype(np.uint8), 'L').filter(ImageFilter.GaussianBlur(0.7))

    sortie = image.convert('RGBA')
    sortie.putalpha(canal)
    return sortie


def boite(image: Image.Image, seuil: int = 24) -> tuple[int, int, int, int]:
    """La boîte du personnage : ce qui est franchement opaque, rien d'autre."""
    a = np.asarray(image)[:, :, 3]
    lignes = np.where((a > seuil).any(axis=1))[0]
    colonnes = np.where((a > seuil).any(axis=0))[0]
    return int(colonnes[0]), int(lignes[0]), int(colonnes[-1]) + 1, int(lignes[-1]) + 1


def silhouette(image: Image.Image) -> Image.Image:
    """Le personnage entier, dans une boîte de proportion fixe, posé au bas."""
    decoupe = image.crop(boite(image))
    # Il tient en entier : on prend l'échelle la plus contraignante des deux.
    echelle = min(SILHOUETTE_L / decoupe.width, SILHOUETTE_H / decoupe.height)
    taille = (max(1, round(decoupe.width * echelle)), max(1, round(decoupe.height * echelle)))
    reduit = decoupe.resize(taille, Image.LANCZOS)
    toile = Image.new('RGBA', (SILHOUETTE_L, SILHOUETTE_H), (0, 0, 0, 0))
    toile.alpha_composite(reduit, ((SILHOUETTE_L - taille[0]) // 2, SILHOUETTE_H - taille[1]))
    return toile


def portrait(image: Image.Image, part: float) -> Image.Image:
    """La tête et le haut du corps, dans un disque au fond crème."""
    gauche, haut, droite, bas = boite(image)
    cote = (bas - haut) * part
    # Le centre horizontal se prend sur la BANDE DE LA TÊTE, jamais sur la boîte
    # entière : une pioche tenue en l'air ou un carnet tenu à bout de bras
    # élargit la boîte d'un côté et décentrerait le visage. Et c'est une MÉDIANE
    # pondérée par l'opacité : la tête, massive, l'emporte sur un manche fin.
    alpha = np.asarray(image)[:, :, 3].astype(np.float32) / 255
    bande = alpha[haut:haut + max(1, round((bas - haut) * 0.30))]
    poids = bande.sum(axis=0)
    cumul = np.cumsum(poids)
    centre_x = float(np.searchsorted(cumul, cumul[-1] / 2)) if cumul[-1] > 0 else (gauche + droite) / 2
    # Un peu d'air au-dessus du crâne, le haut du corps en dessous.
    centre_y = haut + cote * 0.48
    carre = (
        round(centre_x - cote / 2),
        round(centre_y - cote / 2),
        round(centre_x + cote / 2),
        round(centre_y + cote / 2),
    )
    decoupe = image.crop(carre).resize((PORTRAIT, PORTRAIT), Image.LANCZOS)

    # Le disque : un fond plein DERRIÈRE le portrait, et rien en dehors.
    disque = Image.new('L', (PORTRAIT * 4, PORTRAIT * 4), 0)
    ImageDraw.Draw(disque).ellipse((0, 0, PORTRAIT * 4 - 1, PORTRAIT * 4 - 1), fill=255)
    disque = disque.resize((PORTRAIT, PORTRAIT), Image.LANCZOS)

    toile = Image.new('RGBA', (PORTRAIT, PORTRAIT), FOND_PORTRAIT + (255,))
    toile.alpha_composite(decoupe)
    toile.putalpha(Image.fromarray(
        (np.asarray(toile)[:, :, 3].astype(np.float32) * (np.asarray(disque).astype(np.float32) / 255)).astype(np.uint8),
        'L',
    ))
    return toile


def sources(dossier: Path) -> dict[str, Path]:
    """Pour chaque colonne, l'image la plus récente qui porte son nom."""
    trouve: dict[str, Path] = {}
    for nom, colonne in COLONNES.items():
        candidats = sorted(
            (chemin for chemin in dossier.iterdir()
             if chemin.is_file() and chemin.stem.lower().endswith(f'-{nom}')),
            key=lambda chemin: chemin.stat().st_mtime,
        )
        if candidats:
            trouve[colonne] = candidats[-1]
    return trouve


def main() -> int:
    dossier = Path(sys.argv[1]) if len(sys.argv) > 1 else RACINE.parent / 'data' / 'attachments'
    if not dossier.is_dir():
        # Lancé depuis le dépôt principal, les pièces jointes vivent à côté.
        dossier = RACINE / 'data' / 'attachments'
    images = sources(dossier)
    manquantes = [colonne for colonne in COLONNES.values() if colonne not in images]
    if manquantes:
        print(f"Images introuvables dans {dossier} pour : {', '.join(manquantes)}")
        return 1

    SORTIE.mkdir(parents=True, exist_ok=True)
    for colonne, chemin in images.items():
        detoure = detourer(Image.open(chemin))
        silhouette(detoure).save(SORTIE / f'{colonne}.png', optimize=True)
        portrait(detoure, CADRAGES[colonne]).save(SORTIE / f'{colonne}-rond.png', optimize=True)
        print(f'{colonne:<15} ← {chemin.name}')
    print(f'\n{len(images) * 2} images écrites dans {SORTIE}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
