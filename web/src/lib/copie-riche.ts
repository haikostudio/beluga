/*
 * COPIER UN BLOC AVEC SES IMAGES.
 *
 * Le presse-papiers ne connaissait ici que du texte (`navigator.clipboard.
 * writeText`). Pour emporter une demande AVEC ses captures, il faut y écrire
 * DEUX représentations à la fois — `text/plain` et `text/html` — dans un seul
 * `ClipboardItem` : l'éditeur de code prend la première, le courriel ou la page
 * de notes prend la seconde, et chacun croit avoir reçu ce qu'il attendait.
 *
 * Les images sont EMBARQUÉES en `data:` : un lien vers ce serveur ne
 * s'afficherait nulle part ailleurs (il faudrait la session). Une image trop
 * lourde est réduite avant d'être encodée — un presse-papiers n'est pas fait
 * pour transporter dix mégaoctets.
 *
 * Rien ici n'est une règle : les deux textes sont fabriqués par des fonctions
 * pures de `shared` (`demandeCopiable`).
 */
import { PieceCopiable, demandeCopiable } from '@beluga/shared';

/** Au-delà de cette taille, l'image est réduite avant d'être embarquée. */
const POIDS_MAXIMAL = 1_500_000;
/** La largeur retenue pour une image réduite. */
const LARGEUR_REDUITE = 1400;

/** Le résultat d'une copie : ce que l'écran doit dire. */
export type IssueDeCopie = 'riche' | 'texte' | 'echec';

/** Une pièce jointe à emporter, telle que l'écran la connaît. */
export interface PieceAEmporter {
  id: string;
  nom?: string;
  mime?: string;
}

function lireEnDataUrl(blob: Blob): Promise<string> {
  return new Promise((resoudre, rejeter) => {
    const lecteur = new FileReader();
    lecteur.onload = () => resoudre(String(lecteur.result));
    lecteur.onerror = () => rejeter(lecteur.error);
    lecteur.readAsDataURL(blob);
  });
}

/**
 * UNE IMAGE TROP LOURDE EST RÉDUITE, JAMAIS ABANDONNÉE. On la redessine à une
 * largeur raisonnable et on la ré-encode en JPEG : mieux vaut une capture un
 * peu moins fine qu'une copie qui échoue.
 */
async function reduire(blob: Blob): Promise<string> {
  const image = await createImageBitmap(blob);
  const echelle = Math.min(1, LARGEUR_REDUITE / image.width);
  const toile = document.createElement('canvas');
  toile.width = Math.max(1, Math.round(image.width * echelle));
  toile.height = Math.max(1, Math.round(image.height * echelle));
  const pinceau = toile.getContext('2d');
  if (!pinceau) throw new Error('canvas indisponible');
  pinceau.drawImage(image, 0, 0, toile.width, toile.height);
  image.close?.();
  return toile.toDataURL('image/jpeg', 0.85);
}

/**
 * UNE PIÈCE JOINTE, RELUE PUIS ENCODÉE. Une pièce qu'on ne peut pas relire —
 * effacée, session perdue, format inconnu — revient SANS source : elle sera
 * citée par son nom, et la copie a quand même lieu.
 */
export async function pieceEmbarquee(piece: PieceAEmporter): Promise<PieceCopiable> {
  const base: PieceCopiable = { nom: piece.nom, type: piece.mime };
  if (piece.mime && !piece.mime.startsWith('image/')) return base;
  try {
    const reponse = await fetch(`/api/attachment?id=${encodeURIComponent(piece.id)}`);
    if (!reponse.ok) return base;
    const blob = await reponse.blob();
    if (!blob.type.startsWith('image/')) return base;
    const source = blob.size > POIDS_MAXIMAL ? await reduire(blob) : await lireEnDataUrl(blob);
    return { ...base, source };
  } catch {
    return base;
  }
}

/**
 * LE GESTE COMPLET : relire les pièces, fabriquer les deux textes, les écrire
 * ensemble. Le repli est prévu à chaque étage — un navigateur qui refuse le
 * format riche reçoit le texte seul, et l'échec complet se dit à l'appelant.
 */
export async function copierLaDemande(texte: string, pieces: PieceAEmporter[]): Promise<IssueDeCopie> {
  const embarquees = await Promise.all(pieces.map((piece) => pieceEmbarquee(piece)));
  const { texte: brut, html } = demandeCopiable(texte, embarquees);

  const riche = typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write;
  if (riche) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([brut], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ]);
      return 'riche';
    } catch {
      /* Le format riche est refusé (navigateur strict, page non focalisée) :
         on ne renonce pas à la copie, on retombe sur le texte. */
    }
  }

  try {
    await navigator.clipboard.writeText(brut);
    return 'texte';
  } catch {
    return 'echec';
  }
}
