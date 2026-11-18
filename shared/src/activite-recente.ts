/**
 * L'ACTIVITÉ RÉCENTE DATÉE, lue d'un coup par l'assistant (outil `assistant_resume`).
 *
 * Pourquoi (carte « Assistant vocal rapide et apps Beluga », 16/11/2026) : à la
 * question « les cinq tâches terminées hier », l'assistant vocal fouillait la
 * liste des outils, appelait le résumé projet par projet puis lançait `rg` dans
 * les données — plus d'une minute, et jamais l'ordre exact. Le résumé ne
 * rendait que des comptes par colonne, sans aucune date, et laissait de côté
 * les cartes rangées en « Archivé » — là où finit justement une tâche livrée.
 *
 * La règle vit ici, sans base : le jour demandé (« hier » se lit en heure de
 * Zurich/Paris, jamais en UTC), les bornes, le tri, la limite et la mise en
 * forme d'une ligne. La requête bornée est dans `server/src/store.ts`
 * (`cartesTermineesRecemment`).
 */
import { debutDuJour, jourLocal, dateLocale } from './fuseau.js';

/** Combien de lignes par défaut, et au plus : la réponse se dit à voix haute. */
export const LIMITE_ACTIVITE_PAR_DEFAUT = 10;
export const LIMITE_ACTIVITE_MAX = 30;

export function limiteDActivite(voulue: unknown): number {
  const n = typeof voulue === 'number' ? voulue : Number.parseInt(String(voulue ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return LIMITE_ACTIVITE_PAR_DEFAUT;
  return Math.min(LIMITE_ACTIVITE_MAX, Math.floor(n));
}

const JOUR_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const JOUR_FR = /^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?$/;

function sansAccents(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * Le jour visé, « AAAA-MM-JJ » dans le fuseau de référence, ou `null` si le
 * texte ne se comprend pas. Accepte « aujourd'hui », « hier », « avant-hier »,
 * « 2026-11-15 », « 15/11 » et « 15/11/2026 ».
 */
export function resoudreLeJour(texte: unknown, maintenant: number): string | null {
  if (typeof texte !== 'string' || !texte.trim()) return null;
  const brut = sansAccents(texte).replace(/[’']/g, '');
  const ilYA = (jours: number) => jourLocal(debutDuJour(jourLocal(maintenant)) - jours * 86_400_000 + 12 * 3_600_000);
  if (brut === 'aujourdhui' || brut === 'today') return jourLocal(maintenant);
  if (brut === 'hier' || brut === 'yesterday') return ilYA(1);
  if (brut === 'avant-hier' || brut === 'avant hier' || brut === 'avanthier') return ilYA(2);
  const iso = JOUR_ISO.exec(brut);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const fr = JOUR_FR.exec(brut);
  if (fr) {
    const jour = Number(fr[1]);
    const mois = Number(fr[2]);
    if (jour < 1 || jour > 31 || mois < 1 || mois > 12) return null;
    let annee = fr[3] ? Number(fr[3]) : Number(jourLocal(maintenant).slice(0, 4));
    if (annee < 100) annee += 2000;
    const deux = (v: number) => String(v).padStart(2, '0');
    return `${annee}-${deux(mois)}-${deux(jour)}`;
  }
  return null;
}

/** Les bornes [début, fin[ du jour « AAAA-MM-JJ », en heure de référence (23 ou 25 h aux changements d'heure). */
export function bornesDuJour(jour: string): { debut: number; fin: number } {
  const debut = debutDuJour(jour);
  const lendemain = jourLocal(debut + 36 * 3_600_000);
  return { debut, fin: debutDuJour(lendemain) };
}

/** « 15/11 23:21 », en heure de référence. */
export function dateEtHeureDActivite(at: number): string {
  const d = dateLocale(at);
  const deux = (v: number) => String(v).padStart(2, '0');
  return `${deux(d.getUTCDate())}/${deux(d.getUTCMonth() + 1)} ${deux(d.getUTCHours())}:${deux(d.getUTCMinutes())}`;
}

export interface CarteTerminee {
  id: string;
  titre: string;
  projet: string;
  colonne: string;
  doneAt: number;
}

/**
 * Trie (la plus récente d'abord), filtre au jour demandé et borne. Le démon
 * fait déjà ce travail en SQL ; la règle reste écrite ici pour être testée et
 * pour garantir l'ordre même si la source en rend davantage.
 */
export function activiteRecente(
  cartes: CarteTerminee[],
  options: { jour?: string | null; limite?: number } = {},
): CarteTerminee[] {
  const bornes = options.jour ? bornesDuJour(options.jour) : null;
  return cartes
    .filter((c) => Number.isFinite(c.doneAt) && (!bornes || (c.doneAt >= bornes.debut && c.doneAt < bornes.fin)))
    .sort((a, b) => b.doneAt - a.doneAt || a.id.localeCompare(b.id))
    .slice(0, limiteDActivite(options.limite));
}

/** Une ligne lisible à voix haute : « 15/11 23:21 — Beluga — « Titre » (Archivé) [id] ». */
export function ligneDActivite(carte: CarteTerminee, libelleColonne: string): string {
  return `- ${dateEtHeureDActivite(carte.doneAt)} — ${carte.projet} — « ${carte.titre} » (${libelleColonne}) [${carte.id}]`;
}

/* ------------------------------------------------------------------ */
/* Les mises en ligne et en production                                  */
/* ------------------------------------------------------------------ */

/** Ce que le résumé lit d'une publication (`DeployRun`). */
export interface PublicationDuResume {
  projet: string;
  /** dev = mise en ligne sur ce serveur ; production = mise en production, ailleurs. */
  cible?: 'dev' | 'production';
  state: 'running' | 'success' | 'failed' | 'stopped';
  startedAt: number;
  endedAt?: number;
}

/** L'état d'une publication, dit tel quel : jamais « en pause » ni « en attente » pour une publication qui tourne. */
export function etatDeLaPublication(state: PublicationDuResume['state']): string {
  switch (state) {
    case 'running':
      return 'en train de tourner';
    case 'success':
      return 'réussie';
    case 'failed':
      return 'en échec';
    default:
      return 'arrêtée';
  }
}

/**
 * LES PUBLICATIONS DU RÉSUMÉ (carte « Jarvis plus fiable et vérifié », 18/11/2026) : à 10 h 34, des mises en
 * production tournaient pendant que Jarvis disait « aucune tâche en cours » — le résumé ne les portait pas. « En
 * cours » SEULEMENT si elles tournent ; les finies depuis peu vont sous « récemment », la plus récente d'abord.
 */
export function publicationsDuResume(runs: readonly PublicationDuResume[]): { enCours: string[]; recentes: string[] } {
  const quoi = (r: PublicationDuResume) => (r.cible === 'production' ? 'mise en production' : 'mise en ligne sur ce serveur');
  const enCours = runs
    .filter((r) => r.state === 'running')
    .sort((a, b) => b.startedAt - a.startedAt)
    .map((r) => `- ${r.projet} — ${quoi(r)} — ${etatDeLaPublication(r.state)}, depuis ${dateEtHeureDActivite(r.startedAt)}`);
  const recentes = runs
    .filter((r) => r.state !== 'running')
    .sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt))
    .map((r) => `- ${r.projet} — ${quoi(r)} — ${etatDeLaPublication(r.state)}, finie le ${dateEtHeureDActivite(r.endedAt ?? r.startedAt)}`);
  return { enCours, recentes };
}
