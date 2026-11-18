import { minusculesSansAccents } from './mots.js';
/*
 * LE CALENDRIER GÉNÉRAL (décision de l'utilisateur, 14/11/2026) : toutes les publications datées de toutes les
 * campagnes, tous projets réunis, sur la grille d'un mois — du lundi au dimanche. Règles pures : la grille, le
 * rangement par jour, la légende des projets. La page qui les montre : `web/src/components/calendrier-general.tsx`.
 */

/** Une publication datée, telle que le calendrier la place. `jour` : « AAAA-MM-JJ ». */
export interface PublicationDuCalendrier {
  id: string;
  jour: string;
  heure?: string | null;
  titre: string;
  projectId: string;
  marqueId: string;
  campagneId?: string | null;
}

/** « AAAA-MM-JJ » d'une date locale. */
export function jourIso(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const j = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${j}`;
}

/**
 * LES SEMAINES D'UN MOIS (`mois` de 0 à 11), du lundi au dimanche : chaque semaine porte sept jours « AAAA-MM-JJ »,
 * débordements des mois voisins compris pour remplir la première et la dernière semaine.
 */
export function semainesDuMois(annee: number, mois: number): string[][] {
  const premier = new Date(annee, mois, 1);
  const decalage = (premier.getDay() + 6) % 7; // lundi = 0
  const debut = new Date(annee, mois, 1 - decalage);
  const dernier = new Date(annee, mois + 1, 0);
  const semaines: string[][] = [];
  const curseur = new Date(debut);
  while (curseur <= dernier || semaines.length === 0 || semaines[semaines.length - 1].length < 7) {
    if (!semaines.length || semaines[semaines.length - 1].length === 7) {
      if (curseur > dernier) break;
      semaines.push([]);
    }
    semaines[semaines.length - 1].push(jourIso(curseur));
    curseur.setDate(curseur.getDate() + 1);
  }
  return semaines;
}

/** Le mois d'à côté : `pas` = -1 (précédent) ou +1 (suivant). */
export function moisVoisin(annee: number, mois: number, pas: number): { annee: number; mois: number } {
  const d = new Date(annee, mois + pas, 1);
  return { annee: d.getFullYear(), mois: d.getMonth() };
}

/** Les publications rangées par jour, triées par heure (sans heure en dernier), limitées aux jours donnés. */
export function publicationsParJour(
  publications: readonly PublicationDuCalendrier[],
  jours: readonly string[],
  projet?: string | null,
): Map<string, PublicationDuCalendrier[]> {
  const voulus = new Set(jours);
  const parJour = new Map<string, PublicationDuCalendrier[]>();
  for (const p of publications) {
    if (!voulus.has(p.jour) || (projet && p.projectId !== projet)) continue;
    const liste = parJour.get(p.jour) ?? [];
    liste.push(p);
    parJour.set(p.jour, liste);
  }
  for (const liste of parJour.values()) liste.sort((a, b) => (a.heure ?? '99:99').localeCompare(b.heure ?? '99:99') || a.titre.localeCompare(b.titre));
  return parJour;
}

/**
 * LA VUE « LISTE » DU CALENDRIER (14/11/2026, carte « Onglets, services et listes repensés ») : toutes les publications
 * programmées À PARTIR D'AUJOURD'HUI, rangées jour par jour dans l'ordre, chaque jour trié par heure. `projet` filtre.
 */
export function publicationsAVenirParJour<P extends PublicationDuCalendrier>(
  publications: readonly P[],
  aujourdhui: string,
  projet?: string | null,
): { jour: string; publications: P[] }[] {
  const parJour = new Map<string, P[]>();
  for (const p of publications) {
    if (p.jour < aujourdhui || (projet && p.projectId !== projet)) continue;
    const liste = parJour.get(p.jour) ?? [];
    liste.push(p);
    parJour.set(p.jour, liste);
  }
  return [...parJour.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([jour, liste]) => ({
      jour,
      publications: liste.sort((a, b) => (a.heure ?? '99:99').localeCompare(b.heure ?? '99:99') || a.titre.localeCompare(b.titre)),
    }));
}

/** Le nombre de publications de chaque projet sur les jours donnés (le filtre du calendrier porte ces nombres). */
export function nombresParProjet(publications: readonly PublicationDuCalendrier[], jours: readonly string[]): Map<string, number> {
  const voulus = new Set(jours);
  const compte = new Map<string, number>();
  for (const p of publications) if (voulus.has(p.jour)) compte.set(p.projectId, (compte.get(p.projectId) ?? 0) + 1);
  return compte;
}

/**
 * LA RECHERCHE DANS « POUR QUEL PROJET ? » (14/11/2026) : les projets dont le nom contient la saisie, sans tenir compte
 * de la casse ni des accents, dans leur ordre d'origine. Une saisie vide les rend tous.
 */
export function projetsQuiCorrespondent<P extends { name: string }>(projets: readonly P[], saisie: string): P[] {
  const replier = (texte: string) => minusculesSansAccents(texte).trim();
  const voulu = replier(saisie);
  if (!voulu) return [...projets];
  return projets.filter((p) => replier(p.name).includes(voulu));
}

/**
 * L'ORDRE DE LECTURE DES PUBLICATIONS (15/11/2026) : par jour, puis par heure (une publication sans heure en fin de
 * journée), puis par titre. C'est l'ordre de « Précédente / Suivante » et des flèches du clavier dans le tiroir
 * d'aperçu du calendrier : la suite du jour, puis les jours suivants, d'un mois à l'autre.
 */
export function ordreDesPublications<T extends { jour: string; heure?: string | null; titre: string }>(liste: readonly T[]): T[] {
  return [...liste].sort(
    (a, b) => a.jour.localeCompare(b.jour) || (a.heure ?? '99:99').localeCompare(b.heure ?? '99:99') || a.titre.localeCompare(b.titre),
  );
}
