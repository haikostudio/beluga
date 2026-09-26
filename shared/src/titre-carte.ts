/**
 * CE QUE DOIT ÊTRE LE TITRE D'UNE CARTE.
 *
 * Le défaut constaté : un moteur écrivait parfois le titre comme une seconde
 * description — la demande entière recopiée en une phrase — au lieu d'un
 * repère court qu'on reconnaît d'un coup d'œil dans une colonne. La
 * description existe déjà pour le détail ; le titre ne doit porter que le
 * SUJET, en quelques mots.
 *
 * Aucune base, aucun disque, aucun moteur : les tests rejouent tout.
 */

/** Le plafond : au-dessus, ce n'est plus un titre, c'est une description. */
export const MAX_SIGNES_TITRE = 80;

export interface VerdictTitre {
  /** Vrai quand le titre peut être affiché tel quel. */
  ok: boolean;
  /** À rendre au moteur quand le titre est refusé. Vide quand `ok`. */
  message: string;
}

/**
 * Le jugement, seul point d'entrée du démon. Un titre vide, un titre coupé
 * sur plusieurs lignes, ou un titre-pavé sont refusés — le reste passe tel
 * quel, sans reformulation imposée.
 */
export function jugerTitre(titre: string | undefined | null): VerdictTitre {
  const texte = String(titre ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!texte) return { ok: false, message: 'Un titre est obligatoire.' };
  if (texte.length > MAX_SIGNES_TITRE) {
    return {
      ok: false,
      message:
        `Titre REFUSÉ — trop long (${texte.length} signes, ${MAX_SIGNES_TITRE} au plus) : ce n'est pas une description.\n` +
        "Reprends l'outil avec un titre COURT et EXPLICITE — quelques mots qui nomment le sujet, jamais le détail du travail attendu. " +
        'Le détail (ce qui change, comment, pourquoi) va dans la description, pas dans le titre.',
    };
  }
  return { ok: true, message: '' };
}
