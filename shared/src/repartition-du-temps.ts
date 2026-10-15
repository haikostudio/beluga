/*
 * OÙ EST PASSÉ LE TEMPS D'UN TOUR ? Une règle pure, lue sous chaque réponse
 * (`web/src/components/message-view.tsx`) et par le témoin en direct.
 *
 * Les étapes portent leur début et leur fin (`RunStep.startedAt/endedAt`) ; le
 * texte et la réflexion du modèle, eux, n'ont pas d'horodatage. La réflexion se
 * déduit donc : c'est la durée du tour MOINS le temps couvert par au moins une
 * étape. Chaque genre se compte en UNION d'intervalles — trois lectures lancées
 * ensemble pendant 4 s comptent 4 s, pas 12 —, si bien que la somme des parts
 * ne dépasse jamais la durée du tour.
 */
import type { RunStep } from './models.js';
import { nomSansPont } from './noms-outils.js';

export type GenreDeTemps = 'reflexion' | 'commandes' | 'lecture' | 'ecriture' | 'aides' | 'outils' | 'reponse';

/** L'ordre d'affichage, et le libellé de chaque part. */
export const GENRES_DE_TEMPS: { genre: GenreDeTemps; libelle: string }[] = [
  { genre: 'reflexion', libelle: 'Réflexion du modèle' },
  { genre: 'commandes', libelle: 'Commandes' },
  { genre: 'lecture', libelle: 'Lecture' },
  { genre: 'ecriture', libelle: 'Écriture' },
  { genre: 'aides', libelle: 'Aides' },
  { genre: 'outils', libelle: 'Outils' },
  { genre: 'reponse', libelle: 'Votre réponse' },
];

const PAR_OUTIL: Record<string, GenreDeTemps> = {
  agent: 'aides',
  task: 'aides',
  bash: 'commandes',
  bashoutput: 'commandes',
  killshell: 'commandes',
  monitor: 'commandes',
  shell: 'commandes',
  exec_command: 'commandes',
  local_shell: 'commandes',
  read: 'lecture',
  grep: 'lecture',
  glob: 'lecture',
  ls: 'lecture',
  websearch: 'lecture',
  webfetch: 'lecture',
  web_search: 'lecture',
  write: 'ecriture',
  edit: 'ecriture',
  multiedit: 'ecriture',
  notebookedit: 'ecriture',
  apply_patch: 'ecriture',
  ask_user: 'reponse',
};

/** Le genre de temps d'une étape, d'après son outil (ou son libellé, à défaut). */
export function genreDeTempsDeLEtape(step: Pick<RunStep, 'outil' | 'label'>): GenreDeTemps {
  const outil = nomSansPont(step.outil ?? '').toLowerCase();
  if (outil && PAR_OUTIL[outil]) return PAR_OUTIL[outil];
  if (outil) return 'outils';
  const libelle = (step.label ?? '').toLowerCase();
  if (/sous-agent|aide/.test(libelle)) return 'aides';
  if (/commande/.test(libelle)) return 'commandes';
  if (/lecture|recherche|consultation/.test(libelle)) return 'lecture';
  if (/écriture|modification/.test(libelle)) return 'ecriture';
  return 'outils';
}

/** Une étape est-elle une AIDE (sous-agent) ? Elle se peint alors en violet. */
export function estUneAide(step: Pick<RunStep, 'outil' | 'label'>): boolean {
  return genreDeTempsDeLEtape(step) === 'aides';
}

/** La longueur de l'union d'intervalles [début, fin]. */
function longueurDeLUnion(intervalles: [number, number][]): number {
  const tries = intervalles.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0;
  let debut = Number.NaN;
  let fin = Number.NaN;
  for (const [a, b] of tries) {
    if (Number.isNaN(debut) || a > fin) {
      if (!Number.isNaN(debut)) total += fin - debut;
      debut = a;
      fin = b;
    } else if (b > fin) fin = b;
  }
  if (!Number.isNaN(debut)) total += fin - debut;
  return total;
}

export interface PartDeTemps {
  genre: GenreDeTemps;
  libelle: string;
  ms: number;
  /** Part entière en pour cent de la durée du tour. */
  pourcent: number;
}

export interface RepartitionDuTemps {
  totalMs: number;
  /** Les parts non nulles, de la plus grande à la plus petite. */
  parts: PartDeTemps[];
  /** L'étape la plus longue, quand elle pèse : c'est souvent la réponse au « pourquoi ». */
  plusLongue?: { libelle: string; ms: number; genre: GenreDeTemps };
}

/** Sous ce seuil, une répartition n'apprend rien : elle ne s'affiche pas. */
export const REPARTITION_DUREE_MINIMALE_MS = 20_000;

/**
 * LA RÉPARTITION D'UN TOUR. `dureeMs` est la durée mesurée du tour quand on
 * l'a ; sinon, l'étendue de ses étapes. `maintenant` ferme les étapes encore
 * en cours (lecture en direct).
 */
export function repartitionDuTemps(
  steps: RunStep[],
  dureeMs?: number,
  maintenant = Date.now(),
): RepartitionDuTemps | null {
  const horodatees = steps.filter((s) => typeof s.startedAt === 'number' && s.state !== 'skipped');
  const intervalle = (s: RunStep): [number, number] => [s.startedAt!, s.endedAt ?? maintenant];
  const debuts = horodatees.map((s) => s.startedAt!);
  const fins = horodatees.map((s) => s.endedAt ?? maintenant);
  const etendue = horodatees.length ? Math.max(...fins) - Math.min(...debuts) : 0;
  const totalMs = Math.max(dureeMs ?? 0, etendue);
  if (totalMs <= 0) return null;

  const parGenre = new Map<GenreDeTemps, [number, number][]>();
  for (const s of horodatees) {
    const genre = genreDeTempsDeLEtape(s);
    parGenre.set(genre, [...(parGenre.get(genre) ?? []), intervalle(s)]);
  }
  const occupe = longueurDeLUnion(horodatees.map(intervalle));
  const ms = new Map<GenreDeTemps, number>([['reflexion', Math.max(0, totalMs - occupe)]]);
  for (const [genre, liste] of parGenre) ms.set(genre, longueurDeLUnion(liste));

  const parts = GENRES_DE_TEMPS.map(({ genre, libelle }) => ({
    genre,
    libelle,
    ms: ms.get(genre) ?? 0,
    pourcent: Math.round(((ms.get(genre) ?? 0) / totalMs) * 100),
  }))
    .filter((p) => p.ms >= 1000 && p.pourcent >= 1)
    .sort((a, b) => b.ms - a.ms);

  let plusLongue: RepartitionDuTemps['plusLongue'];
  for (const s of horodatees) {
    const duree = (s.endedAt ?? maintenant) - s.startedAt!;
    if (!plusLongue || duree > plusLongue.ms) plusLongue = { libelle: s.label, ms: duree, genre: genreDeTempsDeLEtape(s) };
  }
  // Une étape ne « explique » le temps que si elle en prend une vraie part.
  if (plusLongue && (plusLongue.ms < 30_000 || plusLongue.ms < totalMs * 0.2)) plusLongue = undefined;

  return { totalMs, parts, ...(plusLongue ? { plusLongue } : {}) };
}
