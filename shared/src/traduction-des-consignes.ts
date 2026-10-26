import type { CapaciteDeGeneration } from './services-de-generation.js';

/*
 * LES CONSIGNES PARTENT EN ANGLAIS (décision de l'utilisateur du 24/10/2026).
 *
 * L'agent écrit la consigne d'une image, d'une vidéo, d'une musique ou d'un
 * bruitage en français ; elle est traduite automatiquement AU DEVIS, avant
 * toute dépense, et seule la version anglaise part au service — les modèles
 * de génération la comprennent mieux. Le volet de suivi montre les deux.
 *
 * Ce qu'on fait DIRE (voix, présentateur, synchronisation labiale) ne se
 * traduit JAMAIS : la voix parlerait anglais.
 */

/** Les capacités dont la consigne décrit ce qu'on VOIT ou ENTEND, sans texte à prononcer. */
const CAPACITES_TRADUITES: readonly CapaciteDeGeneration[] = ['image', 'video', 'musique', 'son'];

/** Cette consigne doit-elle partir en anglais ? */
export function consigneSeTraduit(capacite: CapaciteDeGeneration | string): boolean {
  return (CAPACITES_TRADUITES as readonly string[]).includes(capacite);
}

/** La consigne système du traducteur : une seule sortie, le prompt traduit. */
export const CONSIGNE_DU_TRADUCTEUR = [
  'You translate prompts for image, video, music and sound-effect generation models into English.',
  'Translate the user message into natural, precise English suitable for such a model.',
  'Keep proper nouns, brand names, technical camera and lighting terms, numbers and units.',
  'Any text that must appear verbatim in the image or video (quoted text, signs, titles) stays exactly as written.',
  'If the prompt is already in English, return it unchanged.',
  'Output ONLY the translated prompt: no preamble, no quotes, no explanation.',
].join(' ');

/**
 * LA RÉPONSE DU TRADUCTEUR, NETTOYÉE : un petit modèle ajoute parfois des
 * guillemets, une clôture de code ou une phrase d'introduction. Rend `null`
 * quand il ne reste rien d'utilisable — la traduction est alors un échec.
 */
export function traductionNettoyee(reponse: unknown): string | null {
  if (typeof reponse !== 'string') return null;
  let texte = reponse.trim();
  texte = texte.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '').trim();
  texte = texte.replace(/^(?:here is|here's)[^:\n]{0,60}:\s*/i, '').replace(/^(?:translation|english|prompt)\s*:\s*/i, '').trim();
  if (texte.length >= 2 && /^["“«']/.test(texte) && /["”»']$/.test(texte)) texte = texte.slice(1, -1).trim();
  return texte ? texte : null;
}
