import { z } from 'zod';

/**
 * LES NOTES — un pense-bête qui n'est plus une carte du tableau.
 *
 * Jusqu'ici une note était une CARTE rangée dans une colonne « Notes » : elle
 * portait donc tout l'attirail d'une tâche (agent, moteur, chiffrage, branche,
 * position) pour ne jamais s'en servir, et elle n'existait que dans SON projet.
 * On ne pouvait ni lui donner une échéance, ni la classer par importance, ni la
 * chercher, ni la voir à travers tous les projets.
 *
 * Une note est désormais un OBJET À ELLE : sa table, ses commandes, sa page.
 * Le tableau perd sa colonne « Notes » et retombe à quatre colonnes.
 *
 * CE FICHIER NE TOUCHE NI BASE NI DISQUE : il ne dit que les règles — la forme
 * d'une note, les degrés d'importance, ce que la recherche regarde, et les
 * tris proposés. Le travail réel vit dans `server/src/notes.ts`, l'écran dans
 * `web/src/components/notes-page.tsx`.
 */

/**
 * Les quatre degrés d'importance, du plus fort au plus faible. « Aucune » est
 * le défaut : c'est ce que reçoivent les notes reprises de l'ancienne colonne,
 * qui n'en portaient pas.
 */
export const IMPORTANCES_NOTE = ['haute', 'moyenne', 'basse', 'aucune'] as const;

export const ImportanceNote = z.enum(IMPORTANCES_NOTE);
export type ImportanceNote = z.infer<typeof ImportanceNote>;

/** L'étiquette française d'un degré ; l'interface la traduit comme les autres. */
export const LIBELLES_IMPORTANCE: Record<ImportanceNote, string> = {
  haute: 'Haute',
  moyenne: 'Moyenne',
  basse: 'Basse',
  aucune: 'Aucune',
};

/**
 * Le RANG d'un degré, pour le tri : plus le nombre est petit, plus la note
 * remonte. « Aucune » ferme la marche — on ne mélange pas « pas urgent » et
 * « pas renseigné » avec ce qui presse.
 */
export const RANG_IMPORTANCE: Record<ImportanceNote, number> = {
  haute: 0,
  moyenne: 1,
  basse: 2,
  aucune: 3,
};

/** Une note, telle qu'elle voyage entre le démon et l'écran. */
export const Note = z.object({
  id: z.string(),
  /** Le projet auquel la note se rattache. Une note appartient TOUJOURS à un projet. */
  projectId: z.string(),
  titre: z.string(),
  description: z.string().default(''),
  /** L'échéance, en millisecondes. Facultative : une note n'est pas une tâche. */
  echeance: z.number().nullable().default(null),
  importance: ImportanceNote.default('aucune'),
  /** Les identifiants des pièces jointes déposées par `/api/upload`. */
  piecesJointes: z.array(z.string()).default([]),
  creeLe: z.number(),
  modifieLe: z.number(),
});
export type Note = z.infer<typeof Note>;

/** Ce qu'on envoie pour créer ou modifier une note. Sans `id`, c'est une création. */
export const NoteAEnregistrer = z.object({
  id: z.string().optional(),
  projectId: z.string(),
  titre: z.string(),
  description: z.string().optional(),
  echeance: z.number().nullable().optional(),
  importance: ImportanceNote.optional(),
  piecesJointes: z.array(z.string()).optional(),
});
export type NoteAEnregistrer = z.infer<typeof NoteAEnregistrer>;

/** La longueur maximale d'un titre : au-delà, c'est une description. */
export const LONGUEUR_MAX_TITRE = 200;

/**
 * Juger une note avant de l'écrire. UN TITRE VIDE EST LE SEUL REFUS : tout le
 * reste a un défaut raisonnable, et une note qu'on refuse d'enregistrer pour un
 * champ facultatif est une note perdue.
 */
export function jugerNote(
  brouillon: Partial<NoteAEnregistrer>,
): { ok: true } | { ok: false; raison: string } {
  const titre = (brouillon.titre ?? '').trim();
  if (!titre) return { ok: false, raison: 'une note a besoin d’un titre' };
  if (titre.length > LONGUEUR_MAX_TITRE) {
    return { ok: false, raison: `titre trop long (${LONGUEUR_MAX_TITRE} signes au plus)` };
  }
  if (!(brouillon.projectId ?? '').trim()) {
    return { ok: false, raison: 'une note se range dans un projet' };
  }
  if (brouillon.importance && !IMPORTANCES_NOTE.includes(brouillon.importance)) {
    return { ok: false, raison: 'importance inconnue' };
  }
  if (
    brouillon.echeance !== undefined &&
    brouillon.echeance !== null &&
    !Number.isFinite(brouillon.echeance)
  ) {
    return { ok: false, raison: 'échéance illisible' };
  }
  return { ok: true };
}

/** Les tris proposés au-dessus de la liste. */
export const TRIS_NOTE = ['recentes', 'anciennes', 'importance', 'echeance', 'titre'] as const;
export const TriNote = z.enum(TRIS_NOTE);
export type TriNote = z.infer<typeof TriNote>;

export const LIBELLES_TRI: Record<TriNote, string> = {
  recentes: 'Modifiées récemment',
  anciennes: 'Plus anciennes d’abord',
  importance: 'Importance',
  echeance: 'Échéance la plus proche',
  titre: 'Titre (A→Z)',
};

/** Le tri par défaut : ce qu'on vient d'écrire est ce qu'on relit. */
export const TRI_PAR_DEFAUT: TriNote = 'recentes';

/** Sans accents et en minuscules : « Échéance » se trouve en tapant « echeance ». */
function aplatir(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * LA RECHERCHE REGARDE TROIS CHOSES : le titre, la description et le NOM DU
 * PROJET. Ce dernier n'est pas dans la note — l'appelant le fournit —, mais
 * c'est celui qu'on tape le plus souvent : « toutes mes notes sur Beluga ».
 *
 * Chaque mot de la demande doit se retrouver quelque part (un ET, pas un OU) :
 * taper deux mots doit resserrer la liste, jamais l'élargir.
 */
export function noteCorrespond(note: Note, demande: string, nomDuProjet = ''): boolean {
  const mots = aplatir(demande).split(/\s+/).filter(Boolean);
  if (!mots.length) return true;
  const foin = aplatir(`${note.titre} ${note.description} ${nomDuProjet}`);
  return mots.every((mot) => foin.includes(mot));
}

/**
 * Filtrer puis trier une liste de notes. TOUT SE FAIT ICI, SANS ALLER-RETOUR :
 * l'écran a déjà les notes en main, taper une lettre ne doit rien redemander au
 * serveur.
 *
 * `projectId` à `null` veut dire « tous les projets ».
 */
export function filtrerEtTrierNotes(
  notes: readonly Note[],
  options: {
    demande?: string;
    projectId?: string | null;
    tri?: TriNote;
    nomDuProjet?: (projectId: string) => string;
  } = {},
): Note[] {
  const nomDuProjet = options.nomDuProjet ?? (() => '');
  const demande = (options.demande ?? '').trim();
  const retenues = notes.filter((note) => {
    if (options.projectId && note.projectId !== options.projectId) return false;
    return noteCorrespond(note, demande, nomDuProjet(note.projectId));
  });
  return trierNotes(retenues, options.tri ?? TRI_PAR_DEFAUT);
}

/**
 * Le tri demandé. UNE ÉCHÉANCE ABSENTE PASSE TOUJOURS EN DERNIER, quel que soit
 * le sens : une note sans date n'est ni la plus urgente ni la moins urgente,
 * elle n'est pas dans la course.
 */
export function trierNotes(notes: readonly Note[], tri: TriNote): Note[] {
  const liste = [...notes];
  switch (tri) {
    case 'anciennes':
      return liste.sort((a, b) => a.creeLe - b.creeLe);
    case 'importance':
      return liste.sort(
        (a, b) =>
          RANG_IMPORTANCE[a.importance] - RANG_IMPORTANCE[b.importance] ||
          b.modifieLe - a.modifieLe,
      );
    case 'echeance':
      return liste.sort((a, b) => {
        if (a.echeance === null && b.echeance === null) return b.modifieLe - a.modifieLe;
        if (a.echeance === null) return 1;
        if (b.echeance === null) return -1;
        return a.echeance - b.echeance;
      });
    case 'titre':
      return liste.sort((a, b) => a.titre.localeCompare(b.titre, 'fr', { sensitivity: 'base' }));
    case 'recentes':
    default:
      return liste.sort((a, b) => b.modifieLe - a.modifieLe);
  }
}

/**
 * Une échéance est-elle DÉPASSÉE ? On compare des instants, pas des jours : une
 * note due ce matin est en retard cet après-midi.
 */
export function echeanceDepassee(note: Note, maintenant = Date.now()): boolean {
  return note.echeance !== null && note.echeance < maintenant;
}
