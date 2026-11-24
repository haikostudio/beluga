/**
 * LE RÉSUMÉ « CE QUI A CHANGÉ » D'UNE DEMANDE CLIENT — PRÉPARÉ, PUIS ENVOYÉ PAR HAIKO.
 *
 * Décision de l'utilisateur (cadrage du 24/11/2026) : à la fin du travail d'une carte liée à une demande, un résumé
 * en mots simples est PRÉPARÉ ; Haiko le relit, le modifie au besoin, puis l'envoie d'un clic — il s'ajoute alors à
 * la discussion de la demande, comme un commentaire ordinaire. Le client ne voit JAMAIS un brouillon.
 *
 * D'OÙ VIENT LE TEXTE :
 *   1. l'agent de la carte le rédige, à la fin de son travail, dans le champ `resumeClient` du geste « changelog »
 *      (`tools.ts`) — la consigne ne part qu'aux cartes liées à une demande (`consigneDuResumeClient`) ;
 *   2. sinon, quand la carte passe « terminée » (`annoncerLEtape`), l'explication de son entrée au journal des
 *      changements (déjà écrite pour quelqu'un qui ne programme pas) ;
 *   3. sinon, un brouillon vide, que Haiko rédige.
 *
 * CLOISONNEMENT :
 *   - une table à part (`demande_resumes`), jamais le bloc JSON de la demande — `espace.demande` part aux clients ;
 *   - les commandes `espace.demande.resume.*` sont réservées à l'administration (`COMMANDES_FERMEES_AU_CLIENT`) ;
 *   - l'événement `espace.resume` porte `pour` (un administrateur) et n'est pas dans `EVENEMENTS_CLIENT`.
 */
import { RESUME_CLIENT_MAX, ResumeClient, texteDuBrouillonDeResume } from '@beluga/shared';
import { getDb } from './db.js';
import * as store from './store.js';
import * as espace from './espace-client.js';
import { bus } from './bus.js';
import { listerComptes } from './comptes.js';
import { explicationDeLaCarte } from './connaissances.js';

interface LigneResume {
  id: string;
  demande_id: string;
  carte_id: string | null;
  texte: string;
  etat: string;
  cree_le: number;
  modifie_le: number;
  envoye_le: number | null;
  message_id: string | null;
}

function enResume(ligne: LigneResume): ResumeClient {
  return ResumeClient.parse({
    id: ligne.id,
    demandeId: ligne.demande_id,
    carteId: ligne.carte_id ?? undefined,
    texte: ligne.texte,
    etat: ligne.etat,
    creeLe: ligne.cree_le,
    modifieLe: ligne.modifie_le,
    envoyeLe: ligne.envoye_le ?? undefined,
    messageId: ligne.message_id ?? undefined,
  });
}

const borne = (texte: string) => texte.trim().slice(0, RESUME_CLIENT_MAX);

/** Le résumé prêt à envoyer d'une demande, ou `null`. Il n'y en a jamais qu'un. */
export function resumeEnAttente(demandeId: string): ResumeClient | null {
  const ligne = getDb()
    .prepare("SELECT * FROM demande_resumes WHERE demande_id = ? AND etat = 'pret' ORDER BY modifie_le DESC LIMIT 1")
    .get(demandeId) as LigneResume | undefined;
  return ligne ? enResume(ligne) : null;
}

/** Les demandes de ces projets qui ont un résumé prêt à envoyer — la marque de leur vignette, vue par Haiko. */
export function demandesAvecResumeEnAttente(projectIds: readonly string[]): string[] {
  if (!projectIds.length) return [];
  const lignes = getDb()
    .prepare(
      `SELECT DISTINCT r.demande_id AS id FROM demande_resumes r JOIN demandes d ON d.id = r.demande_id
       WHERE r.etat = 'pret' AND d.project_id IN (${projectIds.map(() => '?').join(',')})`,
    )
    .all(...projectIds) as { id: string }[];
  return lignes.map((l) => l.id);
}

/** Chaque administrateur actif apprend ce qu'est devenu le résumé — et lui seul (`pour`). */
function annoncer(demandeId: string, resume: ResumeClient | null): void {
  const demande = espace.laDemande(demandeId);
  if (!demande) return;
  for (const admin of listerComptes()) {
    if (admin.role !== 'admin' || !admin.actif) continue;
    bus.emit({ type: 'espace.resume', pour: admin.id, demandeId, projectId: demande.projectId, resume });
  }
}

/**
 * PRÉPARER LE RÉSUMÉ D'UNE DEMANDE. Un résumé neuf REMPLACE celui qui attendait encore (jamais deux brouillons pour
 * la même demande) ; `seulementSiVide` ne touche qu'à un brouillon resté vide — le repli sur le journal ne réécrit
 * jamais ce que l'agent ou Haiko ont déjà rédigé.
 */
export function preparerResume(
  demandeId: string,
  texte: string,
  options: { carteId?: string; seulementSiVide?: boolean; quand?: number } = {},
): ResumeClient {
  const maintenant = options.quand ?? Date.now();
  const existant = resumeEnAttente(demandeId);
  const propre = borne(texte);
  if (existant) {
    if (options.seulementSiVide && existant.texte.trim()) return existant;
    getDb()
      .prepare('UPDATE demande_resumes SET texte = ?, carte_id = COALESCE(?, carte_id), modifie_le = ? WHERE id = ?')
      .run(propre, options.carteId ?? null, maintenant, existant.id);
  } else {
    getDb()
      .prepare(
        "INSERT INTO demande_resumes (id, demande_id, carte_id, texte, etat, cree_le, modifie_le) VALUES (?, ?, ?, ?, 'pret', ?, ?)",
      )
      .run(store.newId(), demandeId, options.carteId ?? null, propre, maintenant, maintenant);
  }
  const suite = resumeEnAttente(demandeId)!;
  annoncer(demandeId, suite);
  return suite;
}

/** Haiko réécrit le brouillon. */
export function modifierResume(demandeId: string, texte: string): ResumeClient {
  const existant = resumeEnAttente(demandeId);
  if (!existant) throw new Error('Aucun résumé n’attend d’être envoyé pour cette demande.');
  return preparerResume(demandeId, texte);
}

/** Haiko écarte le brouillon : rien ne part au client. */
export function ecarterResume(demandeId: string): void {
  const existant = resumeEnAttente(demandeId);
  if (!existant) return;
  getDb().prepare("UPDATE demande_resumes SET etat = 'ecarte', modifie_le = ? WHERE id = ?").run(Date.now(), existant.id);
  annoncer(demandeId, null);
}

/** Le résumé est parti comme commentaire : il garde la trace du message qu'il est devenu. */
export function marquerEnvoye(resumeId: string, demandeId: string, messageId: string, texte: string): void {
  const maintenant = Date.now();
  getDb()
    .prepare("UPDATE demande_resumes SET etat = 'envoye', texte = ?, envoye_le = ?, modifie_le = ?, message_id = ? WHERE id = ?")
    .run(borne(texte), maintenant, maintenant, messageId, resumeId);
  annoncer(demandeId, null);
}

/**
 * LE TEXTE ÉCRIT PAR L'AGENT POUR LE CLIENT, posé sur CHAQUE demande vivante liée à sa carte (un brouillon par
 * demande). Rend le nombre de demandes qui l'ont reçu : 0 dit à l'agent que sa carte n'en porte aucune.
 */
export function preparerPourLaCarte(carteId: string, texte: string): number {
  const propre = borne(texte);
  if (!propre) return 0;
  let n = 0;
  for (const demande of espace.demandesDeLaCarte(carteId)) {
    if (demande.archiveeLe) continue;
    preparerResume(demande.id, propre, { carteId });
    n += 1;
  }
  return n;
}

/**
 * LA CARTE LIÉE A FINI SON TRAVAIL (`annoncerLEtape` → « terminee ») : chaque demande vivante reçoit son brouillon,
 * s'il n'en a pas déjà un — le texte de l'agent l'a souvent devancé. Le repli : l'explication du journal des
 * changements de la carte, sinon un brouillon vide.
 */
export function preparerALaFinDuTravail(carteId: string): void {
  const carte = store.getCard(carteId);
  const explication = carte ? explicationDeLaCarte(carte.projectId, carteId) : null;
  for (const demande of espace.demandesDeLaCarte(carteId)) {
    if (demande.archiveeLe) continue;
    preparerResume(demande.id, texteDuBrouillonDeResume(null, explication), { carteId, seulementSiVide: true });
  }
}

/**
 * L'EXPLICATION DU JOURNAL ARRIVE APRÈS LA FIN DU TRAVAIL (rédaction automatique du changelog) : un brouillon resté
 * vide la reçoit. Un texte déjà écrit n'est jamais remplacé.
 */
export function completerDepuisLeJournal(carteId: string, explication: string): void {
  if (!explication.trim()) return;
  for (const demande of espace.demandesDeLaCarte(carteId)) {
    if (demande.archiveeLe) continue;
    const existant = resumeEnAttente(demande.id);
    if (existant && !existant.texte.trim()) preparerResume(demande.id, explication, { carteId, seulementSiVide: true });
  }
}

/**
 * LA CONSIGNE DU TOUR, POUR UNE CARTE LIÉE À UNE DEMANDE CLIENT — et elle seule : une carte ordinaire n'en reçoit
 * rien. Elle part dans la DEMANDE du tour de lancement, jamais dans la consigne système (qui ne change pas d'un tour
 * à l'autre dans une même session).
 */
export function consigneDuResumeClient(carteId: string): string {
  const demandes = espace.demandesDeLaCarte(carteId).filter((d) => !d.archiveeLe);
  if (!demandes.length) return '';
  const auteurs = [...new Set(demandes.map((d) => d.auteurNom).filter(Boolean))].join(', ');
  return `RÉSUMÉ POUR LE CLIENT : cette carte répond à une demande déposée par un client dans son espace${auteurs ? ` (${auteurs})` : ''}. À la fin, quand tu appelles l'outil « memoire », geste « changelog », ajoute le champ « resumeClient » : deux à quatre phrases pour ce client, en le vouvoyant, dans la langue de sa demande — ce qui a changé pour lui, puis comment le vérifier (sur la version de travail tant que rien n'est mis en ligne). Aucun nom de fichier, de technologie, de branche ni d'outil interne. Ce texte n'est PAS envoyé : Haiko le relit et l'envoie lui-même.`;
}
