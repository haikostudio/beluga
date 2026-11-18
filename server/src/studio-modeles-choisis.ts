import {
  CAPACITES_DU_TYPE,
  TYPES_DE_MODELE_DU_STUDIO,
  cleDesModelesChoisis,
  ligneDesModelesChoisis,
  lireModelesChoisis,
  modelesProposes,
  refusDuModeleChoisi,
  type ModelesChoisis,
  type TypeDeModeleDuStudio,
} from '@beluga/shared';
import { getMeta, setMeta } from './db.js';
import { creationDeLaCarte, diffuserStudio, lireCreation } from './studio.js';

/**
 * LE MODÈLE CHOISI PAR TYPE POUR UNE CRÉATION DU STUDIO (décision du 30/10/2026) :
 * le menu de kie.ai (la liste notée, puis le catalogue lu en direct), le choix
 * gardé sur la création, et le refus au devis d'un autre modèle.
 */

export function modelesChoisisDeLaCreation(creationId: string): ModelesChoisis {
  return lireModelesChoisis(getMeta(cleDesModelesChoisis(creationId)));
}

export function modelesChoisisDeLaCarte(cardId: string): ModelesChoisis {
  const creation = creationDeLaCarte(cardId);
  return creation ? modelesChoisisDeLaCreation(creation.id) : {};
}

/** Le refus d'un devis de carte qui passe outre le choix de sa création, ou `null`. */
export function refusDuDevisDeLaCarte(cardId: string, capacite: unknown, modele: string): string | null {
  return refusDuModeleChoisi(modelesChoisisDeLaCarte(cardId), capacite, modele);
}

export function ligneDesModelesDeLaCarte(cardId: string): string {
  return creationDeLaCarte(cardId) ? ligneDesModelesChoisis(modelesChoisisDeLaCarte(cardId)) : '';
}

export function choisirUnModele(creationId: string, type: TypeDeModeleDuStudio, modele: string | null): ModelesChoisis {
  const creation = lireCreation(creationId);
  if (!creation) throw new Error('création introuvable');
  if (!TYPES_DE_MODELE_DU_STUDIO.includes(type)) throw new Error('type de fabrication inconnu');
  const choisis = { ...modelesChoisisDeLaCreation(creationId) };
  if (modele) choisis[type] = modele.slice(0, 160);
  else delete choisis[type];
  setMeta(cleDesModelesChoisis(creationId), JSON.stringify(choisis));
  diffuserStudio(creation.projectId, creation.id);
  return choisis;
}

export interface LigneDuMenuDeModeles {
  id: string;
  nom: string;
  qualite: number;
  usage: string;
  /** En dollars : le prix publié pour une unité de référence (une image, cinq secondes, mille signes) ; `null` : lu au devis. */
  prix: number | null;
  unite: string;
  /** Hors de la liste notée : lu dans la documentation de kie.ai. */
  enDirect?: boolean;
  /** Le service qui fabrique : kie.ai, OpenRouter (31/10/2026), Higgsfield ou fal.ai (rallumés le 11/11/2026) quand leur clé est au coffre. */
  service: 'kie' | 'openrouter' | 'higgsfield' | 'fal';
}

/** Les services du Studio qui ont leur clé : sans aucune, le directeur propose de la poser dans le fil. */
export async function clesDesServicesDuStudio(): Promise<{ kie: boolean; openrouter: boolean; higgsfield: boolean; fal: boolean }> {
  const { cleDuService } = await import('./studio-services.js');
  const { cleOpenRouter } = await import('./voix-de-realisation.js');
  return { kie: !!cleDuService('kie'), openrouter: !!cleOpenRouter(), higgsfield: !!cleDuService('higgsfield'), fal: !!cleDuService('fal') };
}

const QUANTITE_DE_REFERENCE: Record<TypeDeModeleDuStudio, { quantite: { secondes?: number; caracteres?: number }; unite: string }> = {
  voix: { quantite: { caracteres: 1000 }, unite: 'pour 1 000 signes' },
  musique: { quantite: {}, unite: 'par morceau' },
  image: { quantite: {}, unite: 'par image' },
  video: { quantite: { secondes: 5 }, unite: 'pour 5 s' },
};

/**
 * Le menu d'un type : les modèles notés de kie.ai, puis le reste de son catalogue lu en direct, puis — sa clé au
 * coffre — ceux d'OpenRouter (voix Gemini, images ; coût réel relevé après la fabrication), puis ceux de Higgsfield
 * et de fal.ai (rallumés le 11/11/2026), leur clé au coffre : leurs modèles notés, le prix lu au devis. Le directeur
 * conseille un service et DEMANDE lequel employer (`consigneDuChoixDesModeles`).
 */
export async function menuDesModeles(): Promise<Record<TypeDeModeleDuStudio, LigneDuMenuDeModeles[]>> {
  const { catalogueEnDirect, modelesOpenRouter } = await import('./realisation.js');
  const { tarifsKie } = await import('./studio-services.js');
  const { modeleKie, prixKie } = await import('@beluga/shared');
  const cles = await clesDesServicesDuStudio();
  const [tarifs, direct, openrouter] = await Promise.all([tarifsKie(), catalogueEnDirect('kie'), cles.openrouter ? modelesOpenRouter() : Promise.resolve([])]);
  const sortie = {} as Record<TypeDeModeleDuStudio, LigneDuMenuDeModeles[]>;
  for (const type of TYPES_DE_MODELE_DU_STUDIO) {
    const lignes = new Map<string, LigneDuMenuDeModeles>();
    const reference = QUANTITE_DE_REFERENCE[type];
    for (const capacite of CAPACITES_DU_TYPE[type]) {
      for (const m of modelesProposes(['kie'], capacite)) {
        if (lignes.has(m.id)) continue;
        const k = modeleKie(m.id, capacite);
        lignes.set(m.id, { id: m.id, nom: m.nom, qualite: m.qualite, usage: m.usage, prix: k ? prixKie(tarifs, { tarif: k.tarif }, reference.quantite) : null, unite: reference.unite, service: 'kie' });
      }
    }
    for (const m of direct) {
      if (!(CAPACITES_DU_TYPE[type] as readonly string[]).includes(m.capacite) || lignes.has(m.id)) continue;
      lignes.set(m.id, { id: m.id, nom: m.nom, qualite: m.qualite, usage: m.usage, prix: prixKie(tarifs, { id: m.id }, reference.quantite), unite: reference.unite, enDirect: true, service: 'kie' });
    }
    if (cles.openrouter) {
      for (const capacite of CAPACITES_DU_TYPE[type]) {
        for (const m of modelesProposes(['openrouter'], capacite, openrouter)) {
          if (lignes.has(m.id)) continue;
          lignes.set(m.id, { id: m.id, nom: m.nom.includes('OpenRouter') ? m.nom : `${m.nom} (par OpenRouter)`, qualite: m.qualite, usage: m.usage, prix: null, unite: 'coût réel relevé après', service: 'openrouter' });
        }
      }
    }
    for (const service of ['higgsfield', 'fal'] as const) {
      if (!cles[service]) continue;
      const marque = service === 'fal' ? 'fal.ai' : 'Higgsfield';
      for (const capacite of CAPACITES_DU_TYPE[type]) {
        for (const m of modelesProposes([service], capacite)) {
          if (lignes.has(m.id)) continue;
          lignes.set(m.id, { id: m.id, nom: m.nom.toLowerCase().includes(marque.split('.')[0].toLowerCase()) ? m.nom : `${m.nom} (par ${marque})`, qualite: m.qualite, usage: m.usage, prix: null, unite: 'prix lu au devis', service });
        }
      }
    }
    sortie[type] = [...lignes.values()];
  }
  return sortie;
}
