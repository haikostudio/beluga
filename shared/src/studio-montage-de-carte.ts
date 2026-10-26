/**
 * LE MONTAGE D'UNE CARTE (chantier « Beluga Creative Studio », carte 3 du
 * 24/10/2026) : les plans qu'une carte a fabriqués (vidéos, images, sons livrés
 * dans son fil) se montent dans une création du Studio LIÉE À LA CARTE, ouverte
 * dans le grand volet de montage à côté de sa conversation.
 *
 * Règles pures : quels plans verser, et comment chacun se pose. Le montage
 * reste une composition modifiée SEULEMENT par opérations (`appliquerOperation`,
 * `poserLExtrait`) — une version par plan versé, annulable comme tout geste.
 */
import { appliquerOperation, compositionVide, type Composition, type FormatStudio, type OperationStudio, type ResultatOperation } from './studio.js';
import { poserLExtrait } from './studio-services.js';
import type { MediaLivre } from './medias-livres.js';

/** Les trois formats d'export du montage : vertical, carré, horizontal. */
export const FORMATS_DU_MONTAGE: readonly FormatStudio[] = ['9:16', '1:1', '16:9'];

/**
 * LA MARQUE D'UN PLAN VERSÉ, portée par le média de la bibliothèque qu'il a
 * donné (colonne `categorie`, jamais affichée) : un plan déjà versé ne se
 * reverse pas, même après un redémarrage.
 */
export function marqueDePlanVerse(attachmentId: string): string {
  return `plan:${attachmentId}`;
}

/** Le titre de la création de montage d'une carte. */
export function titreDuMontage(titreDeLaCarte: string): string {
  return `Montage — ${String(titreDeLaCarte ?? '').trim() || 'carte'}`.slice(0, 120);
}

/**
 * LA COMPOSITION DE DÉPART : vide, et SANS durée voulue — un montage de plans
 * dure ce que durent ses plans (l'export coupe au marqueur bleu, qui serait
 * sinon posé à 15 s).
 */
export function compositionDuMontage(format: FormatStudio = '9:16'): Composition {
  const c = compositionVide(format);
  delete c.dureeVoulue;
  return c;
}

/**
 * LES PLANS À VERSER : la DERNIÈRE version de chaque plan (groupe) — les
 * versions précédentes restent dans le fil, l'utilisateur les a remplacées —,
 * dans l'ordre de première livraison, sans ceux déjà versés.
 */
export function plansAVerser<T extends Pick<MediaLivre, 'attachmentId' | 'groupe' | 'version' | 'livreLe' | 'genre'>>(
  medias: readonly T[],
  dejaVerses: ReadonlySet<string>,
): T[] {
  const derniere = new Map<string, T>();
  const premiere = new Map<string, number>();
  for (const m of medias) {
    premiere.set(m.groupe, Math.min(premiere.get(m.groupe) ?? Infinity, m.livreLe));
    const avant = derniere.get(m.groupe);
    if (!avant || m.version > avant.version || (m.version === avant.version && m.livreLe > avant.livreLe)) derniere.set(m.groupe, m);
  }
  return [...derniere.values()]
    .filter((m) => !dejaVerses.has(m.attachmentId))
    .sort((a, b) => premiere.get(a.groupe)! - premiere.get(b.groupe)! || a.groupe.localeCompare(b.groupe));
}

/** La fin des visuels : un plan se pose à la suite du précédent. */
export function finDesVisuels(c: Composition): number {
  return c.pistes.filter((p) => p.genre === 'visuel').reduce((fin, p) => p.segments.reduce((f, s) => Math.max(f, s.debut + s.duree), fin), 0);
}

export type PlanAPoser =
  | { genre: 'video'; videoMediaId: string; audioMediaId?: string; duree: number; nom: string }
  | { genre: 'image'; mediaId: string; duree?: number; nom: string }
  | { genre: 'son'; mediaId: string; duree: number; nom: string };

/**
 * POSER UN PLAN : une vidéo se SÉPARE (image muette sur une piste de visuels,
 * son sur sa piste, au même instant — `poserLExtrait`) et se pose À LA SUITE des
 * visuels ; une image dure 4 s à la suite ; un son part de 0 sur une piste de
 * son libre (jamais la voix), une piste neuve s'il n'y en a pas.
 */
export function poserUnPlanDeLaCarte(composition: Composition, plan: PlanAPoser, idNeuf: (prefixe: string) => string): ResultatOperation {
  const nom = String(plan.nom ?? '').slice(0, 80) || 'Plan';
  const debut = Math.round(finDesVisuels(composition) * 100) / 100;
  if (plan.genre === 'video') {
    return poserLExtrait(
      composition,
      { videoMediaId: plan.videoMediaId, ...(plan.audioMediaId ? { audioMediaId: plan.audioMediaId } : {}), debut, duree: Math.max(0.5, plan.duree), nom, pisteVisuelleId: 'visuels' },
      idNeuf,
    );
  }
  if (plan.genre === 'image') {
    const piste = composition.pistes.find((p) => p.id === 'visuels' && p.genre === 'visuel') ?? composition.pistes.find((p) => p.genre === 'visuel');
    if (!piste) return { ok: false, raison: 'aucune piste de visuels' };
    const r = appliquerOperation(
      composition,
      { op: 'inserer', pisteId: piste.id, segment: { genre: 'image', debut, duree: plan.duree && plan.duree > 0 ? plan.duree : 4, mediaId: plan.mediaId, ajustement: 'couvrir', nom } },
      idNeuf,
    );
    return r.ok ? { ...r, resume: `plan « ${nom} » posé (image)` } : r;
  }
  const duree = Math.max(0.5, plan.duree);
  let c = composition;
  const libre = c.pistes.find((p) => p.genre === 'son' && p.id !== 'voix' && p.segments.every((s) => s.debut >= duree - 1e-3));
  let pisteId = libre?.id;
  if (!pisteId) {
    const avant = new Set(c.pistes.map((p) => p.id));
    const derniere = c.pistes.reduce((i, p, k) => (p.genre === 'son' ? k : i), -1);
    const ajout = appliquerOperation(c, { op: 'piste-ajouter', genre: 'son', nom: 'Sons de la carte', position: derniere + 1 } as OperationStudio, idNeuf);
    if (!ajout.ok) return ajout;
    c = ajout.composition;
    pisteId = c.pistes.find((p) => !avant.has(p.id))!.id;
  }
  const r = appliquerOperation(c, { op: 'inserer', pisteId, segment: { genre: 'audio', debut: 0, duree, mediaId: plan.mediaId, debutMedia: 0, volume: 1, nom } }, idNeuf);
  return r.ok ? { ...r, resume: `son « ${nom} » posé` } : r;
}

/**
 * LES PLANS DU MONTAGE, NUMÉROTÉS COMME L'UTILISATEUR LES VOIT : les visuels
 * dans l'ordre du temps (« le plan 2 » est le deuxième), chacun avec le son
 * séparé posé au même instant pour la même durée — c'est lui qu'on coupe ou
 * décale avec l'image.
 */
export function plansDuMontage(c: Composition): { numero: number; segmentId: string; nom: string; debut: number; fin: number; sonId?: string }[] {
  const visuels = c.pistes
    .filter((p) => p.genre === 'visuel')
    .flatMap((p) => p.segments.filter((s) => s.genre === 'video' || s.genre === 'image'))
    .sort((a, b) => a.debut - b.debut);
  const sons = c.pistes.filter((p) => p.genre === 'son' && p.id !== 'voix').flatMap((p) => p.segments.filter((s) => s.genre === 'audio'));
  return visuels.map((v, i) => {
    const son = v.genre === 'video' ? sons.find((s) => Math.abs(s.debut - v.debut) < 0.01 && Math.abs(s.duree - v.duree) < 0.01) : undefined;
    return {
      numero: i + 1,
      segmentId: v.id,
      nom: String((v as { nom?: string }).nom ?? ''),
      debut: Math.round(v.debut * 100) / 100,
      fin: Math.round((v.debut + v.duree) * 100) / 100,
      ...(son ? { sonId: son.id } : {}),
    };
  });
}

/** Ce que l'outil « studio » dit en tête de « lire » quand la création est le montage d'une carte. */
export function consigneDuMontageDeCarte(c: Composition): string {
  const plans = plansDuMontage(c);
  return [
    'MONTAGE DE TA CARTE (grand volet de montage, ouvert à côté de cette conversation) : l’utilisateur demande ses retouches en mots ici. Chaque retouche passe par « operation » — UNE version par geste, qu’il défait d’un clic sur « Annuler » ; ne recompose jamais tout (« composer » est refusé à un montage qui a déjà ses plans). Une coupe ou un décalage d’un plan vidéo touche AUSSI son son séparé : un seul « lot » (rogner/retirer-passage/deplacer sur l’image ET le son), sauf si l’utilisateur veut décaler le son seul.',
    plans.length
      ? `PLANS (numérotés dans l’ordre du temps) : ${plans.map((p) => `${p.numero}. ${p.segmentId}${p.nom ? ` « ${p.nom} »` : ''} ${p.debut}–${p.fin} s${p.sonId ? ` + son ${p.sonId}` : ''}`).join(' ; ')}`
      : 'PLANS : aucun pour l’instant.',
  ].join('\n');
}
