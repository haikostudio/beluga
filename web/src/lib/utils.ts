import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function relativeTime(timestamp?: number): string {
  if (!timestamp) return '—';
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "à l'instant";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `il y a ${days} j`;
  return new Date(timestamp).toLocaleDateString('fr-CH');
}

export function duration(seconds?: number): string {
  if (!seconds || seconds < 1) return '—';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60 ? `${minutes % 60} min` : ''}`.trim();
}

export function elapsed(since?: number): string {
  if (!since) return '—';
  return duration((Date.now() - since) / 1000);
}

export function bytes(size?: number): string {
  if (!size) return '—';
  if (size < 1024) return `${size} o`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} ko`;
  return `${(size / 1024 / 1024).toFixed(1)} Mo`;
}

export function money(amount?: number, currency = 'CHF'): string {
  if (amount === undefined) return '—';
  return `${amount.toLocaleString('fr-CH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${currency}`;
}
