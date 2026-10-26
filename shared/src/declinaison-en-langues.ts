/**
 * DÉCLINER UNE PRODUCTION DANS UNE AUTRE LANGUE (chantier « Beluga Creative
 * Studio », carte 4, 24/10/2026). Règles PURES : à partir des médias finis
 * d'une production, dire ce qui se RÉUTILISE tel quel (images, plans sans
 * parole, bruitages, musique), ce qui se REFAIT dans la langue visée (la
 * voix : un audio propre par langue), ce qui se RESYNCHRONISE (un
 * présentateur filmé reçoit la nouvelle voix, ses lèvres recalées par un
 * modèle de synchronisation labiale chez fal.ai) et ce qui se REMONTE (le
 * montage, aux durées adaptées). Aucune image n'est refaite.
 * `server/src/realisation.ts` (action « decliner ») s'en sert ;
 * `server/src/test/methodes-creatives.test.ts` le verrouille.
 */

export const LANGUES_DE_DECLINAISON = ['fr', 'en', 'de', 'es', 'it', 'pt', 'nl'] as const;
export type LangueDeDeclinaison = (typeof LANGUES_DE_DECLINAISON)[number];

export const NOMS_DES_LANGUES: Record<LangueDeDeclinaison, string> = {
  fr: 'français',
  en: 'anglais',
  de: 'allemand',
  es: 'espagnol',
  it: 'italien',
  pt: 'portugais',
  nl: 'néerlandais',
};

/**
 * LA LONGUEUR PARLÉE RELATIVE d'un même texte, l'anglais valant 1 (ordres de
 * grandeur usuels du doublage et du sous-titrage). C'est une ESTIMATION pour
 * préparer le montage : la durée qui fait foi est celle de la voix rendue.
 */
const LONGUEUR_PARLEE: Record<LangueDeDeclinaison, number> = { en: 1, fr: 1.15, de: 1.2, es: 1.15, it: 1.15, pt: 1.15, nl: 1.15 };

export function langueDeDeclinaison(valeur: unknown): LangueDeDeclinaison | undefined {
  const v = String(valeur ?? '').trim().toLowerCase().slice(0, 2);
  return (LANGUES_DE_DECLINAISON as readonly string[]).includes(v) ? (v as LangueDeDeclinaison) : undefined;
}

/** La durée d'un plan parlé une fois dit dans la langue visée, arrondie au dixième de seconde. */
export function dureeAdaptee(duree: number, source: LangueDeDeclinaison, cible: LangueDeDeclinaison): number {
  return Math.round(duree * (LONGUEUR_PARLEE[cible] / LONGUEUR_PARLEE[source]) * 10) / 10;
}

/** Le nom du plan décliné : le plan d'origine suivi du code de langue (« Voix off — EN »). */
export function planDecline(plan: string, langue: LangueDeDeclinaison): string {
  const base = plan.replace(/\s+—\s+[A-Z]{2}$/, '');
  return `${base.slice(0, 74)} — ${langue.toUpperCase()}`;
}

export type GesteDeDeclinaison = 'reutiliser' | 'refaire' | 'resynchroniser' | 'remonter' | 'en-attente';

export interface MediaADecliner {
  id: string;
  plan: string;
  version: number;
  capacite: string;
  service: string;
  etat: string;
  creeLe: number;
  demande: { duree?: number; son?: boolean; langue?: string; consigne?: string };
}

export interface EtapeDeDeclinaison {
  geste: GesteDeDeclinaison;
  /** Le média d'origine (la dernière version finie du plan). */
  media: string;
  plan: string;
  /** Le nom du plan à fabriquer ou monter dans la langue visée (absent quand on réutilise). */
  planCible?: string;
  capacite: string;
  dureeSource?: number;
  dureeCible?: number;
  raison: string;
}

export interface PlanDeDeclinaison {
  source: LangueDeDeclinaison;
  cible: LangueDeDeclinaison;
  etapes: EtapeDeDeclinaison[];
  /** Combien de devis il faudra : chaque « refaire » et « resynchroniser ». */
  devisAPrevoir: number;
}

/**
 * LE PLAN DE DÉCLINAISON. On garde, par plan, la dernière version FINIE dans
 * la langue d'origine (un plan déjà décliné ou un aperçu du cadrage n'est pas
 * repris). `synchroDisponible` dit si un modèle de synchronisation labiale est
 * branché : sans lui, le présentateur reste « en attente ».
 */
export function planDeDeclinaison(e: {
  medias: readonly MediaADecliner[];
  source: LangueDeDeclinaison;
  cible: LangueDeDeclinaison;
  synchroDisponible: boolean;
}): PlanDeDeclinaison {
  const derniers = new Map<string, MediaADecliner>();
  for (const m of e.medias) {
    if (m.etat !== 'fini') continue;
    if (/^aperçu/i.test(m.plan) || /\s—\s[A-Z]{2}$/.test(m.plan)) continue;
    const langue = langueDeDeclinaison(m.demande.langue);
    if (langue && langue !== e.source) continue;
    const avant = derniers.get(m.plan);
    if (!avant || m.version > avant.version || (m.version === avant.version && m.creeLe > avant.creeLe)) derniers.set(m.plan, m);
  }
  const nomCible = NOMS_DES_LANGUES[e.cible];
  const etapes: EtapeDeDeclinaison[] = [...derniers.values()]
    .sort((a, b) => a.creeLe - b.creeLe)
    .map((m) => {
      const base = { media: m.id, plan: m.plan, capacite: m.capacite };
      const duree = typeof m.demande.duree === 'number' && m.demande.duree > 0 ? m.demande.duree : undefined;
      const durees = duree ? { dureeSource: duree, dureeCible: dureeAdaptee(duree, e.source, e.cible) } : {};
      if (m.service === 'montage') {
        return { ...base, ...durees, geste: 'remonter' as const, planCible: planDecline(m.plan, e.cible), raison: `remonter avec la voix en ${nomCible}, les plans repris tels quels et leurs durées recalées sur la nouvelle voix` };
      }
      switch (m.capacite) {
        case 'voix':
          return { ...base, ...durees, geste: 'refaire' as const, planCible: planDecline(m.plan, e.cible), raison: `un audio propre en ${nomCible} : texte traduit puis adapté pour tenir à peu près la même durée` };
        case 'avatar':
        case 'synchro':
          return e.synchroDisponible
            ? { ...base, ...durees, geste: 'resynchroniser' as const, planCible: planDecline(m.plan, e.cible), raison: `garder l’image du présentateur et recaler ses lèvres sur la voix en ${nomCible} (synchronisation labiale)` }
            : { ...base, ...durees, geste: 'en-attente' as const, raison: 'synchronisation labiale en attente : aucun modèle n’est branché (fal.ai, dans Réglages › Services de création)' };
        case 'video':
          return m.demande.son
            ? { ...base, ...durees, geste: 'reutiliser' as const, raison: `image reprise ; la piste son d’origine se coupe au montage si elle porte des paroles` }
            : { ...base, ...durees, geste: 'reutiliser' as const, raison: 'plan sans parole, repris tel quel' };
        default:
          return { ...base, ...durees, geste: 'reutiliser' as const, raison: m.capacite === 'image' ? 'image reprise telle quelle' : 'sans parole, repris tel quel' };
      }
    });
  return { source: e.source, cible: e.cible, etapes, devisAPrevoir: etapes.filter((x) => x.geste === 'refaire' || x.geste === 'resynchroniser').length };
}

/** Le plan de déclinaison en texte, tel que l'agent le lit. */
export function texteDuPlanDeDeclinaison(p: PlanDeDeclinaison): string {
  const libelle: Record<GesteDeDeclinaison, string> = {
    reutiliser: 'RÉUTILISER',
    refaire: 'REFAIRE',
    resynchroniser: 'RESYNCHRONISER',
    remonter: 'REMONTER',
    'en-attente': 'EN ATTENTE',
  };
  if (!p.etapes.length) return `Aucun média fini en ${NOMS_DES_LANGUES[p.source]} à décliner.`;
  return [
    `Déclinaison ${NOMS_DES_LANGUES[p.source]} → ${NOMS_DES_LANGUES[p.cible]} : ${p.devisAPrevoir} devis à prévoir, aucune image refaite.`,
    ...p.etapes.map(
      (x) =>
        `- ${libelle[x.geste]} « ${x.plan} » (média « ${x.media} », ${x.capacite})${x.planCible ? ` → plan « ${x.planCible} »` : ''}${x.dureeSource ? ` · durée ${x.dureeSource} s → environ ${x.dureeCible} s` : ''} : ${x.raison}`,
    ),
    `Chaque devis de la langue visée porte « langue » = « ${p.cible} ». Une voix rendue fait foi pour sa durée : recale le montage sur elle.`,
  ].join('\n');
}
