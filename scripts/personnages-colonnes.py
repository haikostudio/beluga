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
    désaturée, tombe dans le même filet. Les POCHES ENCLAVÉES — l'espace entre
    les jambes, la boucle d'un bras replié — ne touchent aucun bord et sont donc
    reprises à part (`poches_de_fond`). Les bords gardent un alpha progressif :
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
    python3 scripts/personnages-colonnes.py --une <colonne> <image> <dossier-de-sortie>

Sans argument, il lit les pièces jointes du projet (`data/attachments`) et prend,
pour chaque colonne, le fichier le PLUS RÉCENT dont le nom finit par le nom
attendu (« …-notes.PNG »).

La forme `--une` refait UN SEUL personnage, à partir d'une image quelconque, et
l'écrit dans le dossier demandé : c'est par elle que passe le REMPLACEMENT d'un
personnage depuis les réglages (`server/src/personnages.ts`). Le détourage et
les deux découpes sont exactement les mêmes que pour les sept d'origine — il n'y
a qu'une seule fabrique, sinon un personnage déposé à la main aurait un cadrage
et une taille à lui. Elle rend 0 si tout s'est bien passé, et écrit sur la
sortie d'erreur une phrase EN CLAIR sinon (l'appelant la montre telle quelle).
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

# L'OMBRE PORTÉE est un gris sans couleur : on la reconnaît à sa clarté. Le seuil
# était à 205, ce qui laissait sa part la plus SOMBRE — celle qui se creuse entre
# les deux chaussures, où les deux ombres se rejoignent (relevé : 180 à 205). Il
# en restait un coin pâle au bas de chaque personnage, criant sur un thème
# sombre. Descendre à 185 le fait disparaître sans mordre nulle part ailleurs :
# mesuré sur les sept images, tout ce qui part EN PLUS à plus de quatre pixels du
# contour se tient entre les chevilles et le sol — cheveux gris, métal d'une
# pioche, papier d'un porte-bloc et chemise crème sont intacts, protégés par leur
# SATURATION, pas par leur clarté.
OMBRE_CLAIR_MIN = 185

# Une POCHE ENCLAVÉE est du fond qu'aucun bord ne touche : l'espace entre les
# jambes, la boucle formée par un bras et un outil. Le remplissage venu du coin
# ne l'atteint jamais, elle restait donc opaque — une flaque claire au milieu du
# personnage, criante sur un thème sombre. Trois réglages la distinguent de ce
# qui doit RESTER clair dans le personnage (le blanc d'un œil, une chemise
# crème, un papier), tous relevés sur les sept images de l'utilisateur :
#  - la poche est-elle VRAIMENT la couleur du fond ? Mesuré sur les sept
#    personnages, les vraies poches ont 76 à 99 % de leurs pixels à cet écart
#    serré, les blancs d'yeux 0 à 47 % : la séparation est franche.
ECART_FOND_STRICT = 18
PART_FOND_MINIMALE = 0.60
#  - est-elle assez grande pour se voir ? En dessous, la poche ne pèse même pas
#    un pixel une fois l'image réduite à la taille d'une silhouette ; l'écarter
#    protège les reflets d'un œil, blancs et minuscules.
AIRE_MINIMALE_POCHE = 0.00003


def taches(masque: np.ndarray, plafond: int = 250) -> list[np.ndarray]:
    """Les taches d'un seul tenant du masque, de la plus grande à la plus petite."""
    travail = Image.fromarray(np.where(masque, 255, 0).astype(np.uint8), 'L').copy()
    trouvees: list[np.ndarray] = []
    marque = 1
    while marque < plafond:
        restant = np.asarray(travail) == 255
        if not restant.any():
            break
        ligne, colonne = np.argwhere(restant)[0]
        ImageDraw.floodfill(travail, (int(colonne), int(ligne)), marque, thresh=0)
        trouvees.append(np.asarray(travail) == marque)
        marque += 1
    trouvees.sort(key=lambda tache: -int(tache.sum()))
    return trouvees


def sans_les_ilots(opaque: np.ndarray, part_minimale: float = 0.02) -> np.ndarray:
    """
    Ne garde que le personnage : les ÎLOTS restés à côté de lui — un bout
    d'ombre portée trop sombre pour passer le filtre du fond — sont effacés.
    Est un îlot toute tache dont l'aire tombe sous une part de la plus grande.
    """
    trouvees = taches(opaque)
    if not trouvees:
        return np.ones_like(opaque, dtype=np.float32)
    plus_grande = int(trouvees[0].sum())
    gardees = np.zeros(opaque.shape, dtype=bool)
    for tache in trouvees:
        if int(tache.sum()) >= plus_grande * part_minimale:
            gardees |= tache
    return gardees.astype(np.float32)


def poches_de_fond(candidat: np.ndarray, dehors: np.ndarray, distance: np.ndarray) -> np.ndarray:
    """
    Le fond ENCLAVÉ : les taches couleur de fond que le remplissage venu du bord
    n'a pas atteintes, et qui sont assez franchement du fond pour ne pas être un
    blanc d'œil ou une étoffe claire.
    """
    aire_minimale = max(1, round(candidat.size * AIRE_MINIMALE_POCHE))
    poches = np.zeros(candidat.shape, dtype=bool)
    for tache in taches(candidat & ~dehors):
        if int(tache.sum()) < aire_minimale:
            continue
        if float((distance[tache] < ECART_FOND_STRICT).mean()) < PART_FOND_MINIMALE:
            continue
        poches |= tache
    return poches


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
    candidat = (distance < 26) | ((saturation <= 14) & (clair >= OMBRE_CLAIR_MIN))

    # Seul ce qui TOUCHE le bord est du fond : le blanc des yeux, la chemise
    # crème ou un outil gris restent au personnage.
    # PIÈGE : une image née de `fromarray` partage le tableau numpy en LECTURE
    # SEULE — `floodfill` n'y écrit rien et ne dit rien. Le `.copy()` lui donne
    # un vrai tampon à elle.
    masque = Image.fromarray(np.where(candidat, 255, 0).astype(np.uint8), 'L').copy()
    ImageDraw.floodfill(masque, (0, 0), 128, thresh=0)
    dehors = np.asarray(masque) == 128

    # Le remplissage progresse de proche en proche depuis le coin : il ne peut
    # pas entrer dans un trou entièrement ceinturé par le personnage. Ces poches
    # se reprennent donc une à une, sur leur couleur et sur leur taille.
    dehors = dehors | poches_de_fond(candidat, dehors, distance)

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


def fabriquer(colonne: str, source: Path, sortie: Path) -> None:
    """
    Les deux découpes d'UN personnage, écrites dans `sortie`. Lève une exception
    dont le MESSAGE est destiné à être lu par un humain : c'est lui qui remonte
    jusqu'à l'écran des réglages quand un remplacement est refusé.
    """
    try:
        image = Image.open(source)
        image.load()
    except Exception:
        raise ValueError("Ce fichier n'a pas pu être ouvert comme une image.")

    detoure = detourer(image)
    # Un fond qui n'est pas uni, ou une image entièrement transparente : le
    # détourage n'a rien laissé. On le DIT, au lieu d'écrire une image vide.
    if not (np.asarray(detoure)[:, :, 3] > 24).any():
        raise ValueError(
            "Aucun personnage n'a été trouvé sur cette image : il faut un sujet posé sur un fond clair et uni."
        )

    sortie.mkdir(parents=True, exist_ok=True)
    silhouette(detoure).save(sortie / f'{colonne}.png', optimize=True)
    portrait(detoure, CADRAGES.get(colonne, 0.60)).save(sortie / f'{colonne}-rond.png', optimize=True)


def une_seule(arguments: list[str]) -> int:
    if len(arguments) != 3:
        print('Usage : --une <colonne> <image> <dossier-de-sortie>', file=sys.stderr)
        return 2
    colonne, source, sortie = arguments[0], Path(arguments[1]), Path(arguments[2])
    if colonne not in COLONNES.values():
        print(f"« {colonne} » n'est pas une colonne du tableau.", file=sys.stderr)
        return 2
    try:
        fabriquer(colonne, source, sortie)
    except ValueError as souci:
        print(str(souci), file=sys.stderr)
        return 1
    print(f'{colonne} ← {source.name}')
    return 0


def main() -> int:
    if len(sys.argv) > 1 and sys.argv[1] == '--une':
        return une_seule(sys.argv[2:])

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
