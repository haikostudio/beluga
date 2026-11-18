/**
 * LE MODÈLE CHOISI PAR TYPE DE FABRICATION, POUR UNE CRÉATION DU STUDIO
 * (décision de l'utilisateur du 30/10/2026) : voix, musique, image, vidéo.
 * Le choix se fait à l'écran ou par l'agent sur demande, se garde sur la création
 * et s'impose au devis : l'agent ne le contourne pas (`refusDuModeleChoisi`).
 */
import type { CapaciteDeGeneration } from './services-de-generation.js';

export const TYPES_DE_MODELE_DU_STUDIO = ['voix', 'musique', 'image', 'video'] as const;
export type TypeDeModeleDuStudio = (typeof TYPES_DE_MODELE_DU_STUDIO)[number];
export type ModelesChoisis = Partial<Record<TypeDeModeleDuStudio, string>>;

/** Les capacités du catalogue qu'un type couvre : une vidéo se fabrique du texte ou s'anime depuis une image. */
export const CAPACITES_DU_TYPE: Readonly<Record<TypeDeModeleDuStudio, readonly CapaciteDeGeneration[]>> = {
  voix: ['voix'],
  musique: ['musique', 'son'],
  image: ['image'],
  video: ['animation', 'video'],
};

export const LIBELLES_DES_TYPES_DE_MODELE: Readonly<Record<TypeDeModeleDuStudio, string>> = {
  voix: 'Voix',
  musique: 'Musique',
  image: 'Image',
  video: 'Vidéo',
};

export function typeDeLaCapacite(capacite: unknown): TypeDeModeleDuStudio | null {
  return TYPES_DE_MODELE_DU_STUDIO.find((t) => (CAPACITES_DU_TYPE[t] as readonly unknown[]).includes(capacite)) ?? null;
}

export function cleDesModelesChoisis(creationId: string): string {
  return `studio.modeles.${creationId}`;
}

/** Une valeur gardée, lue avec tolérance : ce qui n'est pas un choix valable est oublié. */
export function lireModelesChoisis(brut: string | null | undefined): ModelesChoisis {
  if (!brut) return {};
  try {
    const lu = JSON.parse(brut) as Record<string, unknown>;
    const sortie: ModelesChoisis = {};
    for (const t of TYPES_DE_MODELE_DU_STUDIO) if (typeof lu[t] === 'string' && lu[t]) sortie[t] = lu[t] as string;
    return sortie;
  } catch {
    return {};
  }
}

/** Le refus d'un devis qui passe outre le choix de l'utilisateur, ou `null`. Une retouche d'image ou une synchro n'est jamais visée. */
export function refusDuModeleChoisi(choisis: ModelesChoisis, capacite: unknown, modele: string): string | null {
  const type = typeDeLaCapacite(capacite);
  if (!type) return null;
  const voulu = choisis[type];
  if (!voulu || voulu === modele) return null;
  return `Refusé : l’utilisateur a retenu le modèle « ${voulu} » pour ${LIBELLES_DES_TYPES_DE_MODELE[type].toLowerCase()} dans cette création. Fais le devis avec lui, ou demande-lui s’il veut en changer.`;
}

/** La ligne que l'agent lit à chaque tour. */
export function ligneDesModelesChoisis(choisis: ModelesChoisis): string {
  const lignes = TYPES_DE_MODELE_DU_STUDIO.filter((t) => choisis[t]).map((t) => `${LIBELLES_DES_TYPES_DE_MODELE[t]} : « ${choisis[t]} »`);
  return lignes.length ? `MODÈLES RETENUS PAR L’UTILISATEUR (impose-les aux devis de « realiser ») — ${lignes.join(' ; ')}.` : 'Aucun modèle n’est encore imposé : recommande, l’utilisateur peut en retenir un dans le Studio.';
}
