import type { EntreeJournal } from './journal-carte.js';
import { blocDeFinDuPassage, resumesDuJalon, type PointDuParcours } from './parcours-en-points.js';

/**
 * LA LISTE DES POINTS DU CADRAGE (décision du 20/10/2026, refaite le 21/10/2026).
 *
 * Depuis le 21/10/2026, c'est un TEXTE et non plus des lignes de boutons : tous
 * les sujets de la carte jusqu'à celui du tour, dans l'ordre chronologique,
 * chacun avec son titre et le résumé de ce qui sera fait ; le sujet du tour
 * ferme la liste, titre en gras, et sa réponse suit directement (elle lui sert
 * de résumé). `sujetsDuCadrage` rend cette liste ; `pointsPrecedents` garde la
 * seule part d'avant.
 *
 * Au-dessus de la réponse de CHAQUE itération du cadrage, une liste rappelle les
 * points traités aux itérations PRÉCÉDENTES : une ligne par itération, titrée
 * par son point (« Copie depuis le terminal », « Mini-carte de la mémoire »…).
 * Un clic remonte à la réponse de cette itération. La réponse, elle, ne traite
 * que le point du tour : elle n'a plus à tout redire.
 *
 * LE TITRE vient du geste 1 du cadrage (`board_update_card`, champ
 * `titreDuPoint`), écrit sur le jalon « Demande » de son tour. Une carte d'avant
 * n'en a pas : on prend alors le début de la synthèse de la demande, sinon le
 * début du message lui-même.
 */

export interface PointPrecedent {
  /** Le titre court du point, en mots courants. */
  titre: string;
  /** L'identifiant du jalon qui porte la RÉPONSE de l'itération : la cible du clic. */
  cle: string;
  /** Le rang de l'itération (1, 2, 3…). */
  rang: number;
  /**
   * Ce qui sera fait pour ce sujet, en mots courants : le résumé de la
   * compréhension du tour, sinon celui de la demande. Ses paragraphes (une
   * ligne vide entre deux idées) sont gardés. Absent pour une carte d'avant.
   */
  resume?: string;
  /** Le sujet du passage affiché : le dernier de la liste, titré en gras, sans résumé. */
  courant?: boolean;
}

/** Un résumé lisible : sans tags de fichier, paragraphes gardés, aucun blanc en trop. */
export function resumeDuPointPropre(texte: unknown): string | undefined {
  if (typeof texte !== 'string') return undefined;
  const propre = texte
    .replace(/\[fichier:[^\]]*\]/gi, ' ')
    .split(/\n\s*\n/)
    .map((paragraphe) => paragraphe.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
  return propre || undefined;
}

/** Au plus, le nombre de mots d'un titre tiré d'une synthèse ou d'un message. */
const MOTS_D_UN_TITRE_DE_REPLI = 7;
export const LONGUEUR_MAX_DU_TITRE_DU_POINT = 60;

function lireTitreDuPoint(entree: EntreeJournal | undefined): string | undefined {
  if (!entree?.donnees) return undefined;
  try {
    const lu = JSON.parse(entree.donnees) as Record<string, unknown>;
    return typeof lu.titreDuPoint === 'string' && lu.titreDuPoint.trim() ? lu.titreDuPoint.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Un titre court tiré d'un texte plus long : sa première phrase, ramenée à quelques mots. */
export function titreDeRepli(texte: string | undefined): string | undefined {
  const propre = String(texte ?? '')
    .replace(/\[fichier:[^\]]*\]/gi, ' ')
    .replace(/[`*_#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!propre) return undefined;
  const phrase = propre.split(/(?<=[.!?…])\s/)[0] ?? propre;
  const mots = phrase.split(' ');
  const court = mots.slice(0, MOTS_D_UN_TITRE_DE_REPLI).join(' ').replace(/[.,;:!?…]+$/, '');
  return mots.length > MOTS_D_UN_TITRE_DE_REPLI ? `${court}…` : court;
}

/** Un titre de point propre : une ligne, sans ponctuation finale, borné. */
export function titreDuPointPropre(titre: unknown): string | undefined {
  if (typeof titre !== 'string') return undefined;
  const ligne = titre.replace(/\s+/g, ' ').trim().replace(/[.;:]+$/, '');
  if (!ligne) return undefined;
  return ligne.length > LONGUEUR_MAX_DU_TITRE_DU_POINT ? `${ligne.slice(0, LONGUEUR_MAX_DU_TITRE_DU_POINT - 1).trimEnd()}…` : ligne;
}

/**
 * LES ITÉRATIONS DU CADRAGE, dans l'ordre : chaque passage « Compréhension » qui
 * a rendu quelque chose (une réponse ou une compréhension), avec le titre du
 * point de la demande qui l'a ouvert. Un tour mort ou refusé n'a rien rendu :
 * il n'a pas de ligne.
 */
export function iterationsDuCadrage(passages: readonly PointDuParcours[]): (PointPrecedent & { ancre: string })[] {
  const iterations: (PointPrecedent & { ancre: string })[] = [];
  let demande: PointDuParcours | undefined;
  for (const passage of passages) {
    if (passage.etape === 'demande') {
      demande = passage;
      continue;
    }
    if (passage.etape !== 'comprehension') continue;
    const bloc = blocDeFinDuPassage(passage);
    if (!bloc) continue;
    const jalonDeDemande = demande?.moments.filter((m) => m.sorte === 'demande').pop()?.entree;
    const comprise = passage.moments.filter((m) => m.sorte === 'comprehension').pop()?.entree;
    const titre =
      titreDuPointPropre(lireTitreDuPoint(jalonDeDemande)) ??
      titreDeRepli(resumesDuJalon(jalonDeDemande).resumeDemande) ??
      titreDeRepli(resumesDuJalon(comprise).resumeDemande) ??
      titreDeRepli(jalonDeDemande?.resultat || jalonDeDemande?.libelle) ??
      `Point ${iterations.length + 1}`;
    const resume =
      resumeDuPointPropre(resumesDuJalon(comprise).resumeComprehension) ??
      resumeDuPointPropre(resumesDuJalon(jalonDeDemande).resumeDemande) ??
      resumeDuPointPropre(resumesDuJalon(comprise).resumeDemande);
    iterations.push({ titre, cle: bloc.cle, rang: iterations.length + 1, ancre: passage.ancre, ...(resume ? { resume } : {}) });
  }
  return iterations;
}

/**
 * Les points des itérations PRÉCÉDENT ce passage : la liste posée au-dessus de
 * sa réponse. Le premier n'en a pas ; un passage qui n'a rien rendu non plus.
 */
export function pointsPrecedents(passages: readonly PointDuParcours[], passage: Pick<PointDuParcours, 'ancre'>): PointPrecedent[] {
  return sujetsDuCadrage(passages, passage)
    .filter((p) => !p.courant)
    .map(({ titre, cle, rang }) => ({ titre, cle, rang }));
}

/**
 * LES SUJETS POSÉS AU-DESSUS DE LA RÉPONSE DE CE PASSAGE (21/10/2026) : tous
 * ceux des itérations précédentes, dans l'ordre, avec leur résumé, puis celui
 * du passage lui-même, marqué `courant` et sans résumé (sa réponse suit). Le
 * premier tour a donc une liste d'un seul sujet. Sur une ancienne réponse, la
 * liste s'arrête à SON sujet. Un passage qui n'a encore rien rendu n'en a pas.
 */
export function sujetsDuCadrage(passages: readonly PointDuParcours[], passage: Pick<PointDuParcours, 'ancre'>): PointPrecedent[] {
  const iterations = iterationsDuCadrage(passages);
  const ici = iterations.findIndex((i) => i.ancre === passage.ancre);
  if (ici < 0) return [];
  return iterations.slice(0, ici + 1).map(({ titre, cle, rang, resume }, rangDansLaListe) =>
    rangDansLaListe === ici ? { titre, cle, rang, courant: true } : { titre, cle, rang, ...(resume ? { resume } : {}) },
  );
}
