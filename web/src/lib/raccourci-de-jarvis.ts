import type { PlateformeClavier } from '@beluga/shared';

/**
 * Le clavier de l'appareil, pour écrire le raccourci de Jarvis comme on le voit sur ses touches (⌘ ⇧ sur Mac,
 * « Ctrl + Maj » ailleurs). Voir `shared/src/raccourci-clavier.ts`.
 */
export function plateformeDuClavier(): PlateformeClavier {
  if (typeof navigator === 'undefined') return 'autre';
  const donnees = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform;
  const plateforme = donnees || navigator.platform || navigator.userAgent || '';
  return /mac|iphone|ipad/i.test(plateforme) ? 'mac' : 'autre';
}
