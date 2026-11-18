/**
 * COMMUNICATION 2 — LE CHEF DE LA MARQUE, EN COULISSES (carte « Communication V2, simple et limpide », 08/11/2026).
 *
 * L'espace « Communication 2 » n'a pas de conversation : chaque page a son champ (régler un canal, décrire une
 * campagne, changer son programme, retoucher une publication) et la demande part ICI. Elle va au chef de la marque —
 * le même agent que la conversation de l'espace actuel —, en tour SILENCIEUX (jamais une bulle de l'utilisateur), avec
 * une consigne qui lui donne tout d'un coup (`consigneDeCoulisses`).
 *
 * PERSONNE NE RÉPONDRA À UNE QUESTION : un drapeau posé sur le chef le temps du tour fait REFUSER l'outil « ask_user »
 * (`questionRefuseeEnCoulisses`, appelé par `tools.ts`) — la règle est tenue par le refus, pas seulement écrite dans
 * la consigne (une question bloquerait le tour sans personne pour répondre, DEC-026). Le drapeau tombe à la fin du
 * tour, et de lui-même après `DUREE_DES_COULISSES`. Le même drapeau fait refuser l'outil Marketing (actions « analyse »
 * et « preparer_analyse », `etudeRefuseeEnCoulisses`) : il est sorti du parcours de Communication 2 le 08/11/2026.
 *
 * L'écran suit l'état par `etatDesCoulisses` (ce qui se prépare, et le dernier mot du chef), relu à chaque diffusion.
 */
import { consigneDeCoulisses, coulissesValables, estGenreDeCoulisses, REFUS_DE_QUESTION_EN_COULISSES, REFUS_D_ETUDE_EN_COULISSES, type CoulissesEnCours, type CompteUtilisateur, type GenreDeCoulisses } from '@beluga/shared';
import { getMeta, setMeta } from './db.js';
import { log } from './logger.js';
import * as store from './store.js';

type Compte = Pick<CompteUtilisateur, 'id' | 'role' | 'projets'>;

const cleDuChef = (agentId: string) => `communication.coulisses.chef.${agentId}`;
const cleDeLaMarque = (compteId: string, marqueId: string) => `communication.coulisses.marque.${compteId}.${marqueId}`;
const cleDuDernier = (compteId: string, marqueId: string) => `communication.coulisses.dernier.${compteId}.${marqueId}`;

export interface DernierMotDesCoulisses {
  genre: GenreDeCoulisses;
  campagneId?: string;
  contenuId?: string;
  messageId?: string;
  texte: string;
  ok: boolean;
  at: number;
}

/** Le refus de l'outil « ask_user » quand l'agent travaille en coulisses ; `null` sinon. */
export function questionRefuseeEnCoulisses(agentId: string, maintenant = Date.now()): string | null {
  return coulissesValables(getMeta(cleDuChef(agentId)), maintenant) ? REFUS_DE_QUESTION_EN_COULISSES : null;
}

/** Le refus des actions de l'outil Marketing (« analyse », « preparer_analyse ») quand l'agent travaille en coulisses. */
export function etudeRefuseeEnCoulisses(agentId: string, maintenant = Date.now()): string | null {
  return coulissesValables(getMeta(cleDuChef(agentId)), maintenant) ? REFUS_D_ETUDE_EN_COULISSES : null;
}

function lireDernier(brut: string | null): DernierMotDesCoulisses | null {
  if (!brut) return null;
  try {
    const d = JSON.parse(brut) as DernierMotDesCoulisses;
    return estGenreDeCoulisses(d.genre) && typeof d.at === 'number' ? d : null;
  } catch {
    return null;
  }
}

/** Ce que l'écran montre : ce qui se prépare (en violet), et le dernier mot du chef. */
export async function etatDesCoulisses(compte: Compte, marqueId: string, maintenant = Date.now()): Promise<{ enCours: CoulissesEnCours | null; dernier: DernierMotDesCoulisses | null; chefAuTravail: boolean; agentId?: string }> {
  const { marqueEnTravail } = await import('./communication.js');
  try {
    marqueEnTravail(marqueId, compte);
  } catch {
    return { enCours: null, dernier: null, chefAuTravail: false };
  }
  const enCours = coulissesValables(getMeta(cleDeLaMarque(compte.id, marqueId)), maintenant);
  const { cleChefDeMarqueDuCompte } = await import('./directeur-marketing.js');
  const agentId = getMeta(cleChefDeMarqueDuCompte(compte.id, marqueId));
  const agent = agentId ? store.getAgent(agentId) : null;
  const chefAuTravail = !!agent && (agent.status === 'running' || agent.status === 'starting');
  /* UN DRAPEAU DONT LE CHEF NE TRAVAILLE PLUS (démon redémarré en plein tour) ne fait pas tourner l'écran pour rien. */
  const vivant = enCours && (chefAuTravail || maintenant - enCours.depuis < 20_000) ? enCours : null;
  /* L'IDENTIFIANT DU CHEF : l'écran lit ses étapes pour écrire, au-dessus du champ, ce qu'il fait (journal en fondu). */
  return { enCours: vivant, dernier: lireDernier(getMeta(cleDuDernier(compte.id, marqueId))), chefAuTravail, ...(agent ? { agentId: agent.id } : {}) };
}

export interface DemandeEnCoulisses {
  marqueId: string;
  genre: string;
  texte?: string;
  campagneId?: string;
  contenuId?: string;
  messageId?: string;
}

/** ENVOIE UNE DEMANDE AU CHEF DE LA MARQUE, EN COULISSES. Refusée si le chef travaille déjà : rien ne se double. */
export async function demanderEnCoulisses(compte: Compte, d: DemandeEnCoulisses, maintenant = Date.now()): Promise<{ ok: true; agentId: string }> {
  if (!estGenreDeCoulisses(d.genre)) throw new Error('Demande inconnue.');
  const genre = d.genre;
  const c = await import('./communication.js');
  const { marque, projets } = c.marqueEnTravail(d.marqueId, compte);
  const campagne = d.campagneId ? c.lireCampagne(d.marqueId, d.campagneId, compte).campagne : null;
  const contenu = d.contenuId ? (await import('./marketing.js')).lireContenu(d.contenuId) : null;
  if (d.contenuId && (!contenu || !projets.includes(contenu.projectId))) throw new Error('publication introuvable');
  if ((genre === 'programme' || genre === 'programme-changer' || genre === 'visuels' || genre === 'campagne') && !campagne) throw new Error('campagne introuvable');
  const fil = d.messageId ? c.lireFilDeMessage(d.marqueId, d.messageId, compte) : null;
  if (genre === 'reponse' && !fil) throw new Error('message introuvable');
  const message = fil ? { id: fil.message.id, auteur: fil.message.auteur, texte: fil.message.texte, reseau: fil.message.reseau, projet: fil.message.projectId } : null;
  const { chefDeMarque, contexteDuDirecteur, noterLesProjetsDuChef } = await import('./directeur-marketing.js');
  const chef = await chefDeMarque(compte, marque.id);
  if (chef.status === 'running' || chef.status === 'starting' || chef.attendReponse) throw new Error('Le chef de la marque travaille déjà : réessayez dans un instant.');
  noterLesProjetsDuChef(chef.id, projets);
  const projetPrincipal = projets[0] ?? null;
  const texte = consigneDeCoulisses({
    genre,
    marque: marque.nom,
    ...(d.texte ? { texte: d.texte } : {}),
    ...(campagne
      ? {
          campagne: {
            id: campagne.id,
            titre: campagne.titre,
            debut: campagne.debut,
            fin: campagne.fin,
            reseaux: campagne.reseaux,
            quantite: campagne.quantiteMedias,
            objectif: campagne.objectif,
            projet: projetPrincipal,
          },
        }
      : {}),
    ...(contenu ? { contenu: { id: contenu.id, titre: contenu.titre } } : {}),
    ...(message ? { message } : {}),
  });
  const drapeau: CoulissesEnCours = { genre, marqueId: marque.id, depuis: maintenant, ...(campagne ? { campagneId: campagne.id } : {}), ...(contenu ? { contenuId: contenu.id } : {}), ...(message ? { messageId: message.id } : {}) };
  setMeta(cleDuChef(chef.id), JSON.stringify(drapeau));
  setMeta(cleDeLaMarque(compte.id, marque.id), JSON.stringify(drapeau));
  const finir = (mot: string, ok: boolean) => {
    setMeta(cleDuChef(chef.id), '');
    setMeta(cleDeLaMarque(compte.id, marque.id), '');
    const dernier: DernierMotDesCoulisses = { genre, ...(campagne ? { campagneId: campagne.id } : {}), ...(contenu ? { contenuId: contenu.id } : {}), ...(message ? { messageId: message.id } : {}), texte: mot.trim().slice(0, 500), ok, at: Date.now() };
    setMeta(cleDuDernier(compte.id, marque.id), JSON.stringify(dernier));
    void c.diffuserLesMarques();
  };
  /* LE CONTRÔLE DE BOUT EN BOUT NE JOINT AUCUN MOTEUR (`scripts/verif-communication-v2.mjs`) : `BELUGA_COULISSES_ESSAI`
     garde la consigne en base au lieu de l'envoyer — le drapeau reste posé, le contrôle joue lui-même la fin du tour.
     Une demande silencieuse ne passe pas par la file de l'ordonnanceur : sans ce garde, un démon d'essai lançait un vrai
     tour de moteur, et dépensait du quota. Jamais posé en production. */
  if (process.env.BELUGA_COULISSES_ESSAI === '1') {
    setMeta('communication.coulisses.essai.derniere', JSON.stringify({ agentId: chef.id, genre, texte }));
    void c.diffuserLesMarques();
    return { ok: true, agentId: chef.id };
  }
  const { sendPrompt } = await import('./runtime.js');
  void sendPrompt(chef.id, texte, {
    template: 'none',
    silent: true,
    ...(contexteDuDirecteur(chef) ? { context: contexteDuDirecteur(chef)! } : {}),
    onComplete: (mot, ok) => finir(mot, ok),
  }).catch((err) => {
    log.warn('communication 2 : demande en coulisses non partie', err);
    finir('La demande n’est pas partie : réessayez.', false);
  });
  void c.diffuserLesMarques();
  return { ok: true, agentId: chef.id };
}
