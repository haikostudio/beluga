import { formatDuCanal, realisationDeLaCarte, type Card, type TypeDeMediaDeRealisation } from '@beluga/shared';
import { getDb } from './db.js';
import * as store from './store.js';
import { bus } from './bus.js';
import { log } from './logger.js';

/**
 * LES VISUELS D'UN CONTENU MARKETING (26/10/2026, Studio retiré) :
 *  - « Créer le visuel » ouvre UNE carte du directeur artistique par contenu
 *    (`realisation.contenuMarketingId`), rouverte ensuite ;
 *  - le film VALIDÉ de cette carte (arrêt 3, `filmValideA`) revient au contenu,
 *    prêt à publier sur les réseaux (`publication-sociale.ts`) ;
 *  - les visuels exportés par l'ancien Studio restent rattachés à leur contenu :
 *    ses tables sont LUES telles quelles, jamais réécrites.
 */

export interface VisuelDuContenu {
  /** L'identifiant de la ligne (export du Studio, ou média du directeur). */
  id: string;
  attachmentId: string;
  afficheId?: string;
  format: string;
  genre: 'video' | 'image';
  titre: string;
  /** La carte du directeur qui l'a livré (absente pour un visuel de l'ancien Studio). */
  cardId?: string;
  creeLe: number;
}

/** Les exports prêts de l'ancien Studio pour ce contenu (lecture seule ; aucune table : aucun visuel). */
function visuelsDeLAncienStudio(contenuId: string): VisuelDuContenu[] {
  try {
    const lignes = getDb()
      .prepare(
        `SELECT e.id, e.attachment_id, e.affiche_id, e.format, e.genre, e.cree_le, c.titre
           FROM studio_exports e JOIN studio_creations c ON c.id = e.creation_id
          WHERE c.contenu_marketing_id = ? AND e.etat = 'pret' AND e.attachment_id IS NOT NULL`,
      )
      .all(contenuId) as { id: string; attachment_id: string; affiche_id: string | null; format: string; genre: string; cree_le: number; titre: string }[];
    return lignes.map((l) => ({
      id: l.id,
      attachmentId: l.attachment_id,
      ...(l.affiche_id ? { afficheId: l.affiche_id } : {}),
      format: l.format,
      genre: l.genre === 'image' ? 'image' : 'video',
      titre: l.titre,
      creeLe: l.cree_le,
    }));
  } catch {
    return [];
  }
}

/** La carte du directeur liée à ce contenu, s'il y en a une. */
export function carteDuContenu(projectId: string, contenuId: string): Card | null {
  return store.listCards(projectId).find((c) => c.parcours?.realisationSouhaitee && c.realisation?.contenuMarketingId === contenuId) ?? null;
}

interface MediaFini {
  id: string;
  plan: string;
  genre: string;
  service: string;
  attachmentId: string;
  format: string;
  retenuLe: number | null;
  creeLe: number;
}

/**
 * Les images et vidéos FINIES d'une carte, lues directement en base : ce module
 * est chargé par `marketing.ts`, lui-même chargé par `tools.ts` — passer par
 * `realisation.ts` refermerait la boucle tools → marketing → realisation →
 * runtime → tools et casserait le chargement.
 */
function mediasFinisDeLaCarte(cardId: string): MediaFini[] {
  const lignes = getDb()
    .prepare(
      `SELECT id, plan, genre, service, attachment_id, demande, retenu_le, cree_le FROM medias_realisation
        WHERE card_id = ? AND etat = 'fini' AND attachment_id IS NOT NULL AND genre IN ('video', 'image') ORDER BY cree_le`,
    )
    .all(cardId) as { id: string; plan: string; genre: string; service: string; attachment_id: string; demande: string; retenu_le: number | null; cree_le: number }[];
  return lignes.map((l) => {
    let format = '16:9';
    try {
      format = String(JSON.parse(l.demande)?.format ?? format);
    } catch {
      /* une demande illisible garde le format par défaut */
    }
    return { id: l.id, plan: l.plan, genre: l.genre, service: l.service, attachmentId: l.attachment_id, format, retenuLe: l.retenu_le ?? null, creeLe: l.cree_le };
  });
}

/**
 * LE MÉDIA LIVRÉ d'une carte du directeur, une fois le film VALIDÉ : les films
 * montés d'abord ; sans montage, les images retenues au suivi, sinon les
 * images finies.
 */
function visuelsDuDirecteur(projectId: string, contenuId: string): VisuelDuContenu[] {
  const carte = carteDuContenu(projectId, contenuId);
  if (!carte || !realisationDeLaCarte(carte).filmValideA) return [];
  const finis = mediasFinisDeLaCarte(carte.id);
  const montes = finis.filter((m) => m.service === 'montage' && m.genre === 'video');
  const images = finis.filter((m) => m.genre === 'image' && !m.plan.startsWith('apercu-'));
  const retenues = images.filter((m) => m.retenuLe);
  const livres = montes.length ? montes : retenues.length ? retenues : images;
  return livres.map((m) => ({
    id: m.id,
    attachmentId: m.attachmentId,
    format: m.format,
    genre: m.genre === 'image' ? 'image' : 'video',
    titre: carte.title,
    cardId: carte.id,
    creeLe: m.creeLe,
  }));
}

/** Les visuels prêts d'un contenu, le plus récent d'abord. */
export function visuelsDuContenu(projectId: string, contenuId: string): VisuelDuContenu[] {
  const tous = [...visuelsDuDirecteur(projectId, contenuId), ...visuelsDeLAncienStudio(contenuId)];
  return tous.filter((v) => !!store.getAttachment(v.attachmentId)).sort((a, b) => b.creeLe - a.creeLe);
}

/** Le type de média d'un contenu : une vidéo pour les canaux vidéo, une photo sinon. */
export function typeDuContenu(canal: string | undefined): TypeDeMediaDeRealisation {
  return canal === 'tiktok' || canal === 'youtube' ? 'video' : 'image';
}

/** Le texte qui pré-remplit la demande au directeur : le contenu, son canal et son format. */
export function demandeDuVisuel(contenu: { titre: string; texte: string; canal: string }): string {
  const format = formatDuCanal(contenu.canal);
  return [
    `Crée le visuel de ce contenu (${contenu.canal}, format ${format}) :`,
    contenu.titre ? `« ${contenu.titre} »` : '',
    contenu.texte.trim().slice(0, 1500),
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * « CRÉER LE VISUEL » : la carte du directeur liée au contenu, créée au premier
 * clic (mode réalisation allumé, type déduit du canal) avec son agent de
 * cadrage, rouverte ensuite. Rien ne part au moteur : l'écran pré-remplit la
 * demande, l'utilisateur l'envoie.
 */
export async function creerLeVisuel(contenuId: string): Promise<{ card: Card; agentId: string | null; demande: string; nouvelle: boolean }> {
  const { lireContenu } = await import('./marketing.js');
  const contenu = lireContenu(contenuId);
  if (!contenu) throw new Error('contenu introuvable');
  const demande = demandeDuVisuel(contenu);
  const deja = carteDuContenu(contenu.projectId, contenu.id);
  if (deja) {
    const agent = store.agentsDeLaCarte(deja.id).find((a) => a.role === 'cadrage') ?? null;
    return { card: deja, agentId: agent?.id ?? deja.agentId ?? null, demande, nouvelle: false };
  }
  const { createCard } = await import('./tools.js');
  const { basculerLaRealisation } = await import('./realisation-questionnaire.js');
  const { ouvrirLeCadrage } = await import('./cadrage.js');
  const neuve = createCard(contenu.projectId, {
    title: `Visuel — ${contenu.titre || 'contenu Marketing'}`.slice(0, 120),
    description: `Le visuel du contenu Marketing « ${contenu.titre} », créé par le directeur artistique. Le média validé revient au contenu.`,
    origin: 'user',
    cadrage: true,
  } as Parameters<typeof createCard>[1]);
  bus.emit({ type: 'card.upsert', card: neuve });
  const allumee = basculerLaRealisation(neuve.id, typeDuContenu(contenu.canal));
  const liee = store.saveCard({ ...allumee, realisation: { ...realisationDeLaCarte(allumee), contenuMarketingId: contenu.id } });
  bus.emit({ type: 'card.upsert', card: liee });
  const agent = await ouvrirLeCadrage(liee.id).catch((err) => {
    log.warn('visuel Marketing : agent de cadrage impossible à ouvrir', err);
    return null;
  });
  return { card: store.getCard(liee.id) ?? liee, agentId: agent?.id ?? null, demande, nouvelle: true };
}
