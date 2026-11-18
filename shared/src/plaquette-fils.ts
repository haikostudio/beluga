/**
 * LES FILS DE COMMENTAIRES D'UN DOCUMENT — règles pures (carte « Refonte du service Charte graphique », 05/11/2026).
 *
 * Un FIL est posé par le client à un endroit du document (page, hauteur, section : `AncreDeCommentaire`) ; l'équipe y
 * répond depuis Beluga, le client depuis son lien. Un fil se RÉSOUT (il disparaît de la page du client) et se rouvre.
 *
 * PRÉVENIR (décision de l'utilisateur) : chaque message du client sonne la cloche, la carte du document compte ses
 * fils ouverts, et UN courriel récapitulatif part chaque jour — seulement s'il y a du nouveau depuis le précédent.
 */

import { blocAIcone, bouton, courrielEnBlocs, echapper, texteEnHtml } from './gabarit-courriel.js';
import { jourDOuverture } from './plaquette.js';

export type RoleDansUnFil = 'client' | 'equipe';

export interface MessageDeFil {
  id: string;
  auteur: string;
  role: RoleDansUnFil;
  texte: string;
  creeLe: number;
  lu: boolean;
  /**
   * SUPPRIMÉ PAR SON AUTEUR (carte « Aperçu, chat, Agentik et vraie charte », décision de l'utilisateur : « chacun ses
   * propres messages, avec une mention message supprimé ») : le texte est effacé, la bulle reste avec sa mention.
   */
  supprime?: boolean;
  /** L'empreinte du navigateur du client qui l'a écrit (jamais montrée) : elle seule lui permet de le supprimer. */
  visiteur?: string;
  /**
   * LE COMPTE BELUGA qui l'a écrit (carte « Lecteur de charte : commentaires et barre », migration 166) — jamais montré.
   * Il décide « à moi » côté équipe : deux comptes de l'équipe ne voient pas leurs messages du même côté. Les messages
   * d'avant n'en ont pas : ils sont reconnus par le nom affiché.
   */
  compte?: string;
}

export interface FilDeCommentaires {
  id: string;
  page: number;
  y: number;
  bloc?: string;
  resolu: boolean;
  creeLe: number;
  modifieLe: number;
  messages: MessageDeFil[];
}

/** Un message tel que le lecteur le reçoit : sans rien d'interne, avec `moi` quand c'est celui de la personne qui lit. */
export type MessageVu = Omit<MessageDeFil, 'lu' | 'visiteur' | 'compte'> & { moi?: boolean };

/** Qui lit un fil : un client (l'empreinte de SON navigateur) ou un compte de l'équipe (son identifiant et son nom). */
export interface LecteurDUnFil {
  visiteur?: string | null;
  equipe?: boolean;
  /** Le compte de l'équipe qui lit. Sans lui, tout message de l'équipe est « à moi » (lecture anonyme de l'équipe). */
  compte?: string;
  /** Son nom affiché : reconnaît ses messages écrits avant que le compte ne soit retenu. */
  nomAffiche?: string;
}

/**
 * UN MESSAGE EST-IL « À MOI » ? Côté client : écrit depuis le même navigateur. Côté équipe : écrit par le même compte
 * (ou, pour un message d'avant sans compte, sous le même nom affiché) — comme dans une messagerie, chacun voit SES
 * messages à droite et ceux des autres, collègues compris, à gauche.
 */
export function messageAMoi(m: Pick<MessageDeFil, 'role' | 'visiteur' | 'compte' | 'auteur'>, qui: LecteurDUnFil): boolean {
  if (qui.equipe) {
    if (m.role !== 'equipe') return false;
    if (!qui.compte) return true;
    if (m.compte) return m.compte === qui.compte;
    return !!qui.nomAffiche && m.auteur === qui.nomAffiche;
  }
  return !!qui.visiteur && m.role === 'client' && m.visiteur === qui.visiteur;
}

/**
 * Ce que voit le client de chaque fil : ni l'état « lu », ni l'empreinte des visiteurs. `qui` dit qui lit : un client
 * (l'empreinte de SON navigateur, ses messages sont « à moi ») ou l'équipe (ses messages à elle sont « à moi »).
 */
export function filPourLeClient(f: FilDeCommentaires, qui: LecteurDUnFil = {}): Omit<FilDeCommentaires, 'messages'> & { messages: MessageVu[] } {
  return {
    ...f,
    messages: f.messages.map(({ lu: _lu, visiteur, compte, ...m }) => {
      const moi = messageAMoi({ ...m, visiteur, compte }, qui);
      return moi ? { ...m, moi: true } : m;
    }),
  };
}

/** L'heure du récapitulatif quotidien, à Paris : pas avant. */
export const HEURE_DU_RECAP_DES_COMMENTAIRES = 8;

function heureAParis(instant: number): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }).format(new Date(instant)));
}

/**
 * LE RÉCAPITULATIF PART-IL ? Oui s'il y a au moins un message du client plus récent que le dernier envoi, si aucun
 * n'est déjà parti aujourd'hui (heure de Paris) et s'il est au moins 8 h. Jamais vide, jamais deux fois le même jour.
 */
export function recapDesCommentairesAEnvoyer(entree: { maintenant: number; dernierEnvoi: number | null; nouveaux: number }): boolean {
  if (entree.nouveaux <= 0) return false;
  if (heureAParis(entree.maintenant) < HEURE_DU_RECAP_DES_COMMENTAIRES) return false;
  if (entree.dernierEnvoi && jourDOuverture(entree.dernierEnvoi) === jourDOuverture(entree.maintenant)) return false;
  return true;
}

export interface DocumentDuRecap {
  titre: string;
  /** L'adresse du document dans Beluga. */
  lien: string;
  messages: { auteur: string; texte: string; creeLe: number }[];
}

const extrait = (texte: string, max = 220) => (texte.length > max ? `${texte.slice(0, max - 1)}…` : texte);

/** LE COURRIEL DU JOUR : un bloc par document, ses nouveaux commentaires, et le bouton qui l'ouvre dans Beluga. */
export function courrielDuRecapDesCommentaires(entree: { documents: readonly DocumentDuRecap[]; lienDuService: string }): { sujet: string; texte: string; html: string } {
  const total = entree.documents.reduce((n, d) => n + d.messages.length, 0);
  const sujet = total === 1 ? `Un nouveau commentaire sur « ${entree.documents[0]!.titre} »` : `${total} nouveaux commentaires sur vos documents`;
  const lignes: string[] = [sujet, ''];
  for (const d of entree.documents) {
    lignes.push(`${d.titre} — ${d.messages.length} commentaire${d.messages.length > 1 ? 's' : ''}`);
    for (const m of d.messages) lignes.push(`  ${m.auteur || 'Votre client'} : « ${extrait(m.texte)} »`);
    lignes.push(`  Ouvrir : ${d.lien}`, '');
  }
  const html = courrielEnBlocs({
    titre: 'Charte graphique',
    apercu: sujet,
    bandeau: {
      teinte: 'marque',
      surtitre: 'Commentaires du jour',
      titre: sujet,
      texteHtml: texteEnHtml('Vos clients ont laissé des commentaires sur les documents que vous leur avez envoyés.'),
    },
    blocs: entree.documents.map((d) =>
      blocAIcone({
        icone: 'bulle',
        teinte: 'gris',
        titre: d.titre,
        sousTitre: `${d.messages.length} nouveau${d.messages.length > 1 ? 'x' : ''} commentaire${d.messages.length > 1 ? 's' : ''}`,
        contenu:
          d.messages
            .map((m) => `<div style="padding:6px 0 0 0;font-size:14px;line-height:1.5;"><strong>${echapper(m.auteur || 'Votre client')}</strong> — ${texteEnHtml(extrait(m.texte))}</div>`)
            .join('') + bouton('Ouvrir le document', d.lien),
      }),
    ),
    pied: 'Ce récapitulatif part une fois par jour, seulement quand un client a commenté.',
    lienEnTete: { libelle: 'Charte graphique', lien: entree.lienDuService },
  });
  return { sujet, texte: lignes.join('\n'), html };
}
