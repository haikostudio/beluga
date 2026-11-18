/**
 * LES DATES DU PANNEAU (1.0.6) : sous les aperçus, les cases de « Ce que l'agent a vu », les réponses de l'agent et
 * les messages envoyés. « à l'instant », « il y a N min / h / j » jusqu'à sept jours, puis la date et l'heure
 * (« 2 nov. à 14h35 », l'année en plus si ce n'est pas l'année en cours). Module pur, sans `chrome` ni page : le
 * test du démon l'importe tel quel.
 */
import { langueDuPanneau, t } from './langues.js';

const MINUTE = 60_000;
const HEURE = 60 * MINUTE;
const JOUR = 24 * HEURE;
/** Au-delà, le temps écoulé ne se lit plus : on donne la date et l'heure. */
export const JOURS_EN_RELATIF = 7;

/** « 14h35 » en français ; l'heure de la langue ailleurs (« 2:35 PM », « 14:35 »). */
export function heureCourte(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  if (langueDuPanneau() === 'fr') return `${d.getHours()}h${String(d.getMinutes()).padStart(2, '0')}`;
  return new Intl.DateTimeFormat(langueDuPanneau(), { hour: 'numeric', minute: '2-digit' }).format(d);
}

/** La date et l'heure en entier : l'infobulle de chaque date. */
export function dateComplete(ms) {
  return new Intl.DateTimeFormat(langueDuPanneau(), { dateStyle: 'full', timeStyle: 'short' }).format(new Date(ms));
}

/** Le texte d'une date, ou '' si elle manque (ancien message, ancienne capture) : jamais « il y a NaN ». */
export function quandLisible(ms, maintenant = Date.now()) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const ecart = Math.max(0, maintenant - ms);
  if (ecart < MINUTE) return t('à l’instant');
  if (ecart < HEURE) return t('il y a {n} min', { n: Math.floor(ecart / MINUTE) });
  if (ecart < JOUR) return t('il y a {n} h', { n: Math.floor(ecart / HEURE) });
  if (ecart < JOURS_EN_RELATIF * JOUR) return t('il y a {n} j', { n: Math.floor(ecart / JOUR) });
  const d = new Date(ms);
  const options = { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date(maintenant).getFullYear() ? { year: 'numeric' } : {}) };
  return t('{date} à {heure}', { date: new Intl.DateTimeFormat(langueDuPanneau(), options).format(d), heure: heureCourte(ms) });
}
