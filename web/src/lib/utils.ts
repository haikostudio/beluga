import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatRegional, t } from './langue';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/*
 * CES QUATRE MISES EN FORME SONT DU TEXTE D'INTERFACE, pas des données. Elles
 * étaient écrites en français dans le code — « il y a 3 min », « 12 ko » — et
 * seraient restées telles quelles au milieu d'une page anglaise. Elles passent
 * donc par le dictionnaire comme le reste, et leurs chiffres par le format
 * régional de la langue en vigueur.
 */

export function relativeTime(timestamp?: number): string {
  if (!timestamp) return '—';
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return t('à l’instant');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('{n}min', { n: minutes });
  const hours = Math.floor(minutes / 60);
  const resteMinutes = minutes % 60;
  if (hours < 24) return resteMinutes ? t('{h}h{m}min', { h: hours, m: resteMinutes }) : t('{n}h', { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t('{n}j', { n: days });
  return new Date(timestamp).toLocaleDateString(formatRegional());
}

export function duration(seconds?: number): string {
  if (!seconds || seconds < 1) return '—';
  if (seconds < 60) return t('{n} s', { n: Math.round(seconds) });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('{n} min', { n: minutes });
  const hours = Math.floor(minutes / 60);
  const reste = minutes % 60;
  return reste ? t('{h} h {m} min', { h: hours, m: reste }) : t('{n} h', { n: hours });
}

export function elapsed(since?: number): string {
  if (!since) return '—';
  return duration((Date.now() - since) / 1000);
}

export function bytes(size?: number): string {
  if (!size) return '—';
  if (size < 1024) return t('{n} o', { n: size });
  if (size < 1024 * 1024) return t('{n} ko', { n: Math.round(size / 1024) });
  return t('{n} Mo', { n: (size / 1024 / 1024).toFixed(1) });
}

export function money(amount?: number, currency = 'CHF'): string {
  if (amount === undefined) return '—';
  return `${amount.toLocaleString(formatRegional(), { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${currency}`;
}
