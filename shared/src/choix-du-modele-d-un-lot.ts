/**
 * LE CHOIX DU MODÈLE DANS L'ENCART « GÉNÉRER » (demande du 01/11/2026, maquette A #81ce).
 *
 * Une génération proposée (un lot de brouillons, état « proposé ») peut changer de modèle AVANT le clic : l'encart
 * liste les modèles de la MÊME capacité qui savent vraiment faire la demande, chacun avec le prix total du lot, et
 * le bouton « Générer · prix » suit la sélection. Changer ne lance rien ; le clic reste la seule porte.
 *
 * Règles pures, sans base ni réseau : quelles capacités ont le menu, ce qui rend un modèle incompatible avec une
 * demande déjà écrite, le total d'un lot, le refus d'un prix qui a monté depuis l'affichage, et le dernier modèle
 * utilisé par capacité (repris par défaut à la génération suivante).
 */
import type { CapaciteDeGeneration } from './services-de-generation.js';

/**
 * Images, vidéos, musiques et sons (décision de l'utilisateur) : la voix finale et le 3D gardent leur encart, et une
 * retouche d'image (angles, lumière, visage) porte des réglages propres à son modèle — elle n'a pas de menu.
 */
export const CAPACITES_AU_MENU_DES_MODELES = ['image', 'video', 'animation', 'musique', 'son'] as const satisfies readonly CapaciteDeGeneration[];

export function capaciteAuMenuDesModeles(capacite: unknown): capacite is (typeof CAPACITES_AU_MENU_DES_MODELES)[number] {
  return (CAPACITES_AU_MENU_DES_MODELES as readonly unknown[]).includes(capacite);
}

/** Une ligne du menu : un modèle, sa courte description et le prix TOTAL du lot avec lui (`null` : prix non publié). */
export interface ModeleDuMenu {
  service: string;
  modele: string;
  nom: string;
  usage: string;
  qualite: number;
  prix: number | null;
  /** Le modèle que porte la génération en ce moment. */
  actuel?: boolean;
}

/**
 * CE QUI REND UN MODÈLE INCOMPATIBLE AVEC UNE DEMANDE DÉJÀ ÉCRITE — sans appel : une durée qu'il ne sait pas
 * faire, une image de fin qu'il ignore. Le schéma des entrées (adresses factices) se vérifie à côté, côté démon.
 */
export function incompatibiliteAvecLaDemande(
  modele: { durees?: readonly number[]; fin?: boolean },
  demande: { duree?: number; fin?: string | null },
): string | null {
  if (demande.fin && !modele.fin) return 'il ne sait pas finir sur une image donnée';
  if (demande.duree && modele.durees?.length && !modele.durees.includes(demande.duree)) return `il ne fait pas de plan de ${demande.duree} s`;
  return null;
}

/** Le total d'un lot : la somme de ses lignes, ou `null` dès qu'une ligne n'a pas de prix publié. */
export function totalDuMenu(prix: readonly (number | null)[]): number | null {
  if (!prix.length || prix.some((p) => p === null || !Number.isFinite(p))) return null;
  return Math.round((prix as number[]).reduce((s, p) => s + p, 0) * 1000) / 1000;
}

/** Le menu trié : le modèle actuel d'abord, puis la meilleure qualité, puis le moins cher. Un doublon est retiré. */
export function trierLeMenuDesModeles(lignes: readonly ModeleDuMenu[]): ModeleDuMenu[] {
  const vus = new Set<string>();
  return [...lignes]
    .sort((a, b) => Number(!!b.actuel) - Number(!!a.actuel) || b.qualite - a.qualite || (a.prix ?? Infinity) - (b.prix ?? Infinity))
    .filter((l) => {
      const cle = `${l.service}:${l.modele}`;
      if (vus.has(cle)) return false;
      vus.add(cle);
      return true;
    });
}

/**
 * LE PRIX VU FAIT FOI : relu au moment du changement, il est refusé s'il a monté depuis l'affichage, ou s'il n'est
 * plus publié alors qu'il l'était. Un prix qui baisse passe. Rend la raison du refus, ou `null`.
 */
export function refusDuPrixVu(prixActuel: number | null, prixVu: number | null): string | null {
  if (prixVu === null) return null;
  if (prixActuel === null) return 'le prix n’est plus publié par le service';
  if (prixActuel > prixVu + 0.0005) return `le prix a monté : ${prixActuel.toFixed(2)} $ au lieu de ${prixVu.toFixed(2)} $`;
  return null;
}

/**
 * LE DERNIER MODÈLE UTILISÉ, PAR CAPACITÉ : celui du média le plus récent qui est vraiment parti (ni devis, ni
 * refusé). La génération suivante du même type repart de lui par défaut.
 */
export function derniersModelesUtilises(
  medias: readonly { capacite: string; service: string; modele: string; modeleNom: string; etat: string; creeLe: number }[],
): Map<string, { service: string; modele: string; nom: string }> {
  const sortie = new Map<string, { service: string; modele: string; nom: string; a: number }>();
  for (const m of medias) {
    if (m.etat === 'devis' || m.etat === 'refuse') continue;
    if (!capaciteAuMenuDesModeles(m.capacite)) continue;
    const deja = sortie.get(m.capacite);
    if (!deja || m.creeLe >= deja.a) sortie.set(m.capacite, { service: m.service, modele: m.modele, nom: m.modeleNom, a: m.creeLe });
  }
  return new Map([...sortie].map(([c, { a: _a, ...reste }]) => [c, reste]));
}

/** La ligne de consigne de l'agent : repartir du modèle déjà utilisé, et dire pourquoi s'il en conseille un autre. */
export function ligneDesDerniersModeles(derniers: ReadonlyMap<string, { service: string; nom: string; modele: string }>): string {
  if (!derniers.size) return '';
  const liste = [...derniers].map(([c, m]) => `${c} : « ${m.modele} » (${m.nom}, ${m.service})`).join(' ; ');
  return `MODÈLES DÉJÀ UTILISÉS SUR CETTE CARTE — ${liste}. Par défaut, refais le devis du même type avec le MÊME modèle (un modèle retenu par l’utilisateur dans le menu du Studio passe avant). Si tu en conseilles un autre, dis pourquoi dans « raison » : l’encart le signale à l’utilisateur, qui peut revenir au précédent d’un clic.`;
}

/** La ligne discrète de l'encart quand le modèle proposé n'est pas celui utilisé juste avant. */
export function noteDuModeleConseille(e: { precedent: { modele: string; nom: string } | undefined; propose: string; raison: string | null | undefined }): string | null {
  if (!e.precedent || e.precedent.modele === e.propose) return null;
  const raison = (e.raison ?? '').trim().replace(/\s+/g, ' ');
  return `Conseillé à la place de ${e.precedent.nom}${raison ? ` : ${raison.length > 160 ? `${raison.slice(0, 159)}…` : raison}` : ''}`;
}
