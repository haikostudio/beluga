/**
 * LE SON OU LA VIDÉO QU'UN CHOIX FAIT ÉCOUTER (demande du 23/10/2026).
 *
 * Un agent qui fait comparer des voix joint chaque fichier (« attach_file »),
 * puis pose « ask_user » avec une option par fichier. L'option peut désigner
 * sa pièce par son champ `media` : c'est le lien SÛR, toujours préféré.
 *
 * Les questions posées AVANT ce champ n'ont aucun lien : on rapproche alors par
 * le NOM. Le libellé de l'option et celui de la pièce jointe partagent un
 * repère placé avant les deux-points (« Voix A : Chris promo SDR (recommandé) »
 * ↔ « Voix A : « Chris promo SDR » (clonée…) »). Le repère est comparé sans
 * casse, sans accents ni guillemets.
 *
 * AMBIGU = RIEN. Deux pièces qui répondent au même repère (« Voix A » jointe
 * deux fois), et aucun bouton ne paraît : jouer le mauvais fichier serait pire
 * qu'aucun bouton. Les groupes de pièces sont essayés DANS L'ORDRE (celles du
 * message de la question, puis celles de tout l'agent) ; un groupe ambigu
 * arrête la recherche au lieu de passer au suivant, plus large encore.
 */

/** Le minimum d'une pièce jointe pour ce rapprochement. */
export interface PieceDeMedia {
  id: string;
  name: string;
  mime: string;
}

export function estUnMediaLisible(mime: string | undefined): boolean {
  return !!mime && /^(audio|video)\//.test(mime);
}

function normaliser(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[«»"“”'’`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Le repère distinctif d'un libellé : ce qui précède « : » (ou « — »), court. */
export function repereDuLibelle(libelle: string): string | undefined {
  const m = /^(.{1,40}?)\s*(?::|—|–)\s/.exec(libelle.trim());
  if (!m) return undefined;
  const repere = normaliser(m[1]);
  return repere.length >= 1 ? repere : undefined;
}

export function mediaDeLOption(
  option: { label: string; media?: string },
  groupes: PieceDeMedia[][],
): PieceDeMedia | undefined {
  if (option.media) {
    for (const groupe of groupes) {
      const piece = groupe.find((p) => p.id === option.media);
      if (piece) return estUnMediaLisible(piece.mime) ? piece : undefined;
    }
    return undefined;
  }
  const repere = repereDuLibelle(option.label);
  if (!repere) return undefined;
  for (const groupe of groupes) {
    const vues = new Set<string>();
    const trouvees = groupe.filter((p) => {
      if (!estUnMediaLisible(p.mime) || vues.has(p.id)) return false;
      vues.add(p.id);
      return repereDuLibelle(p.name) === repere;
    });
    if (trouvees.length === 1) return trouvees[0];
    if (trouvees.length > 1) return undefined;
  }
  return undefined;
}
