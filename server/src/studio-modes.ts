import { cleDuModeDuStudio, estModeDuStudio, modesDuStudio, type IdDuModeDuStudio, type ModeDisponible } from '@beluga/shared';
import { getMeta, setMeta } from './db.js';
import { creationDeLaCarte, diffuserStudio, lireCreation } from './studio.js';

/**
 * LE MODE DE RÉALISATION D'UNE CRÉATION (tuiles du début de la conversation, 31/10/2026) :
 * la disponibilité se lit dans ce que le directeur sait fabriquer (`capacitesDuDirecteur`),
 * le choix se garde sur la création et part dans la consigne (`ligneDuModeDeLaCarte`).
 */

export function modeDeLaCreation(creationId: string): IdDuModeDuStudio | null {
  const lu = getMeta(cleDuModeDuStudio(creationId));
  return estModeDuStudio(lu) ? lu : null;
}

export async function modesDeLaCreation(creationId: string): Promise<{ modes: ModeDisponible[]; choisi: IdDuModeDuStudio | null }> {
  if (!lireCreation(creationId)) throw new Error('création introuvable');
  const { capacitesDuDirecteur } = await import('./realisation.js');
  return { modes: modesDuStudio(capacitesDuDirecteur()), choisi: modeDeLaCreation(creationId) };
}

export function choisirLeMode(creationId: string, mode: string | null): IdDuModeDuStudio | null {
  const creation = lireCreation(creationId);
  if (!creation) throw new Error('création introuvable');
  if (mode !== null && !estModeDuStudio(mode)) throw new Error('mode de réalisation inconnu');
  setMeta(cleDuModeDuStudio(creationId), mode ?? '');
  diffuserStudio(creation.projectId, creation.id);
  return mode;
}

export function modeDeLaCarte(cardId: string): IdDuModeDuStudio | null {
  const creation = creationDeLaCarte(cardId);
  return creation ? modeDeLaCreation(creation.id) : null;
}
