/**
 * LES DEUX COURRIELS DE L'ESPACE CLIENT, PAR RESEND.
 *
 *  - LE POINT QUOTIDIEN DE HAIKO, chaque matin à 7 h, à `salut@haiko.studio` :
 *    tous les clients, ce qu'il n'a pas lu chez chacun, et ce qui a bougé
 *    depuis la veille ;
 *  - LE COURRIEL DU LUNDI MATIN, à 8 h, à CHAQUE client : ce qu'il n'a pas lu,
 *    avec la date de livraison annoncée.
 *
 * LES DEUX SE LISENT DANS LA BASE DES LECTURES, plus dans un drapeau. Le champ
 * « réponse attendue » a disparu : ce qui attend quelqu'un, c'est ce qu'il n'a
 * pas ouvert — un fait, pas une déclaration que personne ne mettait à jour.
 *
 * Jamais un courriel à chaque changement, et jamais un courriel vide : quand il
 * n'y a rien à dire, RIEN ne part — pas même un message qui le dirait.
 *
 * Trois choses ne bougent pas :
 *
 *  - LA CLÉ EST LUE AU COFFRE-FORT, jamais écrite dans le dépôt (fiche
 *    « Resend — envoi d'e-mails Haiko Studio », à ne pas confondre avec celle
 *    du projet projetc) ;
 *  - L'EXPÉDITEUR EST SUR `haiko.studio`, seul domaine vérifié chez Resend :
 *    un envoi depuis un autre est refusé net ;
 *  - AUCUNE DÉPENDANCE NEUVE : un `fetch` sur `https://api.resend.com/emails`
 *    suffit. Le démon n'avait aucun code d'envoi de courriel, on n'en importe
 *    pas une bibliothèque entière pour trois champs.
 *
 * La garantie de non-répétition tient aux CLÉS écrites en base — la semaine
 * pour les clients, le jour pour Haiko : un démon redémarré le lundi à 8 h 30
 * repasse ici, et c'est elle qui l'arrête, pas la chance.
 */
import {
  ADRESSE_DE_HAIKO,
  EXPEDITEUR_RECAPITULATIF,
  cleDeSemaine,
  cleDuJour,
  courrielDIdentifiants,
  courrielDeHaiko,
  courrielDuClient,
  refusDEnvoiDesIdentifiants,
  debutDeLaJournee,
  debutDeLaSemaine,
  demandeADireQuelqueChose,
  estArchivee,
  estLHeureDuCourrielDuClient,
  estLHeureDuPointQuotidien,
  changementsParDemande,
  lienDeHaiko,
  lienDuClient,
  nomDuCompte,
  pointDeHaiko,
  pointDuClient,
  type ChangementAuCourriel,
  type CompteUtilisateur,
  type DemandeAffichee,
  type DemandeAuCourriel,
  type DiscussionAuCourriel,
  type LigneDeClient,
  type MessageAuCourriel,
} from '@beluga/shared';
import { listerAcces } from './coffre-fort.js';
import { listerComptes } from './comptes.js';
import { getMeta, setMeta } from './db.js';
import * as espace from './espace-client.js';
import { log } from './logger.js';
import * as store from './store.js';

const CLE_DERNIERE_SEMAINE = 'recapitulatif-hebdo.derniere-semaine';
const CLE_DERNIER_JOUR = 'point-quotidien.dernier-jour';
/** Le rythme auquel on REGARDE si l'heure est venue. Dix minutes suffisent. */
export const PERIODE_DE_VEILLE_MS = 10 * 60 * 1000;

let enCours = false;

export function derniereSemaineEnvoyee(): string | undefined {
  return getMeta(CLE_DERNIERE_SEMAINE) || undefined;
}

export function dernierJourEnvoye(): string | undefined {
  return getMeta(CLE_DERNIER_JOUR) || undefined;
}

/**
 * LA CLÉ RESEND, LUE AU COFFRE. On la reconnaît à son SERVICE, pas à son nom :
 * un nom de fiche se retouche, un service non. La fiche du projet projetc porte le
 * même service — on écarte donc celle qui nomme un autre projet.
 */
export function cleResend(): string | null {
  const fiches = listerAcces().filter(
    (fiche) => fiche.type === 'cle-api' && /resend/i.test(String(fiche.champs.service ?? fiche.nom)),
  );
  const pourBeluga = fiches.find((fiche) => !/projetc/i.test(fiche.nom)) ?? fiches[0];
  const cle = String(pourBeluga?.champs.cle ?? '').trim();
  return cle || null;
}

/**
 * L'ENVOI LUI-MÊME. Rend `null` quand tout va bien, la raison de l'échec sinon
 * — un refus de Resend doit SE VOIR, pas se perdre : c'est tout l'intérêt de
 * rendre la raison plutôt que de lever.
 */
export async function envoyerParResend(
  cle: string,
  a: string,
  sujet: string,
  texte: string,
  html: string,
): Promise<string | null> {
  try {
    const reponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${cle}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: EXPEDITEUR_RECAPITULATIF, to: [a], subject: sujet, text: texte, html }),
    });
    if (reponse.ok) return null;
    return `${reponse.status} ${(await reponse.text()).slice(0, 300)}`;
  } catch (err: any) {
    return err?.message ?? 'envoi impossible';
  }
}

/**
 * LE TROISIÈME COURRIEL : LES IDENTIFIANTS D'UN COMPTE NEUF, SUR CASE COCHÉE.
 *
 * Il ne part que si Haiko l'a demandé en créant le compte, vers l'adresse
 * saisie (`refusDEnvoiDesIdentifiants`). Il ne lève JAMAIS : le compte est déjà
 * créé, un envoi raté ne doit pas le défaire — il rend la cause, que l'écran
 * dit en clair à côté du mot de passe montré une fois.
 */
export async function envoyerLesIdentifiants(input: {
  envoyer?: boolean;
  courriel?: string;
  nom: string;
  identifiant: string;
  motDePasse: string;
}): Promise<{ envoye: boolean; raison?: string }> {
  const refus = refusDEnvoiDesIdentifiants(input.envoyer, input.courriel);
  if (refus) return { envoye: false, raison: refus };
  const cle = cleResend();
  if (!cle) return { envoye: false, raison: 'Aucune clé Resend au coffre-fort.' };
  const { sujet, texte, html } = courrielDIdentifiants(input);
  const echec = await envoyerParResend(cle, String(input.courriel).trim(), sujet, texte, html);
  if (echec) {
    log.warn(`courriel d'identifiants refusé pour ${input.identifiant}`, echec);
    return { envoye: false, raison: `Resend a refusé l’envoi : ${echec}` };
  }
  log.info(`courriel d'identifiants envoyé à ${input.identifiant}`);
  return { envoye: true };
}

/* ------------------------------------------------------------------ */
/* La matière : ce qu'un compte a devant lui                            */
/* ------------------------------------------------------------------ */

/**
 * LES DEMANDES VIVANTES D'UN COMPTE, mises en forme pour un courriel. Les
 * non-lus sont comptés POUR `compteId` : le même projet ne dit pas la même
 * chose à Haiko et à son client. Les demandes ARCHIVÉES sont écartées — une
 * demande rangée ne relance plus personne.
 */
export function demandesPourLeCourriel(
  projectIds: readonly string[],
  compteId: string,
  depuis?: number,
): DemandeAuCourriel[] {
  /*
   * UNE SEULE REQUÊTE POUR TOUT CE QUI A BOUGÉ, sur tous les projets du compte
   * — jamais une par demande. Les phrases sont déjà écrites en français par le
   * journal ; on ne fait que les ranger sous leur demande.
   */
  const changements = depuis
    ? changementsParDemande(
        // On ne se raconte pas ses propres gestes : un récapitulatif dit ce que
        // les AUTRES ont fait.
        espace.activiteDepuis(projectIds, depuis).filter((activite) => activite.auteurId !== compteId),
      )
    : new Map<string, ChangementAuCourriel[]>();

  const sortie: DemandeAuCourriel[] = [];
  for (const projectId of projectIds) {
    const nomDuProjet = nomDeProjet(projectId);
    for (const demande of espace.demandesAffichees(projectId, compteId) as DemandeAffichee[]) {
      if (estArchivee(demande)) continue;
      /*
       * UN CHANGEMENT DÉJÀ VU N'EN EST PLUS UN. Le repère est celui de la
       * lecture, exactement comme pour les messages : sans ce filtre, une
       * demande entièrement lue mais touchée dans la semaine referait une carte
       * chaque lundi — et un destinataire à jour recevrait un courriel pour
       * rien.
       */
      const bougee = (changements.get(demande.id) ?? []).filter(
        (c) => c.date > espace.luJusquA(demande.id, compteId),
      );
      const ligne: DemandeAuCourriel = {
        id: demande.id,
        projectId: demande.projectId,
        titre: demande.titre,
        projet: nomDuProjet,
        nonLus: demande.resume.nonLus,
        livraisonAnnoncee: demande.livraisonAnnoncee,
        ...(bougee.length ? { changements: bougee } : {}),
      };
      /*
       * LES MESSAGES NE SE LISENT QUE POUR LES FICHES QUI ONT QUELQUE CHOSE À
       * DIRE. Une fiche entièrement lue et immobile ne fait pas de carte : il
       * serait absurde d'aller chercher ses commentaires à 7 h du matin.
       */
      if (demande.resume.nonLus > 0) ligne.messages = messagesNonLus(demande.id, compteId);
      sortie.push(ligne);
    }
  }
  return sortie;
}

/**
 * LES MESSAGES QUE CE COMPTE N'A PAS LUS, en entier. Le repère est le MÊME que
 * celui du compteur (`luJusquA`), et les siens sont écartés : on ne se relit
 * pas soi-même dans un récapitulatif.
 */
function messagesNonLus(demandeId: string, compteId: string): MessageAuCourriel[] {
  const depuis = espace.luJusquA(demandeId, compteId);
  return espace
    .messagesDeLaDemande(demandeId)
    .filter((message) => message.creeLe > depuis && message.auteurId !== compteId)
    .map((message) => ({
      auteur: message.auteurNom,
      role: message.auteurRole,
      texte: message.texte,
      date: message.creeLe,
    }));
}

/**
 * LA DISCUSSION DIRECTE D'UN CLIENT — le fil hors demandes, absent des deux
 * courriels jusqu'ici. On ne garde que ce que le DESTINATAIRE n'a pas lu :
 * `luLe` est posé à l'ouverture, et l'auteur d'un message ne se le raconte pas.
 */
export function discussionPourLeCourriel(
  filId: string,
  pour: 'admin' | 'client',
): DiscussionAuCourriel | undefined {
  const messages = espace
    .messagesDuFil(filId)
    .filter((message) => message.auteurRole !== pour && !message.luLe)
    .map((message) => ({
      auteur: message.auteurNom,
      role: message.auteurRole,
      texte: message.texte,
      date: message.creeLe,
    }));
  return messages.length ? { messages, nonLus: messages.length } : undefined;
}

/**
 * LE NOM D'UN PROJET, ou rien. Un projet illisible en base ne doit pas faire
 * TOMBER le courriel : le nom est un confort d'affichage, pas la matière.
 */
function nomDeProjet(projectId: string): string | undefined {
  try {
    return store.getProject(projectId)?.name;
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------ */
/* Le point quotidien de Haiko                                          */
/* ------------------------------------------------------------------ */

export interface PassageQuotidien {
  saute?: 'pas-l-heure' | 'pas-de-cle';
  envoye: boolean;
  clients: number;
  echec?: string;
}

/**
 * UN PASSAGE DU MATIN. `maintenant` est passé en argument pour qu'un essai
 * puisse le rejouer à 7 h sans attendre 7 h.
 *
 * Le courriel part à `salut@haiko.studio`, jamais à l'adresse d'un compte : ce
 * point-là n'appartient qu'à Haiko, et le destinataire ne se devine pas d'une
 * fiche qui pourrait changer.
 */
export async function passageDuPointQuotidien(maintenant = Date.now()): Promise<PassageQuotidien> {
  if (!estLHeureDuPointQuotidien(maintenant, dernierJourEnvoye())) {
    return { saute: 'pas-l-heure', envoye: false, clients: 0 };
  }
  const cle = cleResend();
  if (!cle) {
    log.warn('point quotidien : aucune clé Resend au coffre-fort, rien n’est envoyé');
    return { saute: 'pas-de-cle', envoye: false, clients: 0 };
  }

  // Le point se lit avec les yeux de l'ADMINISTRATION : ce qu'ELLE n'a pas lu.
  // On prend le premier compte administrateur actif — c'est lui qui porte les
  // lectures dans `demande_lectures`.
  const comptes = listerComptes();
  const admin = comptes.find((compte) => compte.role === 'admin' && compte.actif);
  const depuis = debutDeLaJournee(maintenant);

  const lignes: LigneDeClient[] = [];
  for (const client of comptes.filter((compte) => compte.role === 'client' && compte.actif)) {
    const projets = client.projets;
    const demandes = demandesPourLeCourriel(projets, admin?.id ?? '', depuis);
    lignes.push({
      id: client.id,
      nom: nomDuCompte(client as CompteUtilisateur),
      /*
       * LES CHANGEMENTS NE FONT PLUS UNE LISTE À PART : ils sont rangés sous la
       * demande qu'ils concernent, et une demande qui n'a QUE bougé garde donc
       * sa carte — ce qu'une liste séparée disait déjà, mais hors contexte.
       */
      aLire: demandes.filter(demandeADireQuelqueChose),
      nonLus: admin ? espace.nonLusDesDemandes(projets, admin.id) : 0,
      discussion: discussionPourLeCourriel(client.id, 'admin'),
    });
  }

  const point = pointDeHaiko(lignes);
  setMeta(CLE_DERNIER_JOUR, cleDuJour(maintenant));
  // UNE JOURNÉE SANS RIEN N'ENVOIE RIEN. Le jour est tout de même marqué : le
  // travail a eu lieu, repasser dans dix minutes ne changerait rien.
  if (point.vide) return { envoye: false, clients: 0 };

  const { sujet, texte, html } = courrielDeHaiko(point, {
    demande: (clientId, demande) => lienDeHaiko(clientId, demande.id),
  });
  const echec = await envoyerParResend(cle, ADRESSE_DE_HAIKO, sujet, texte, html);
  if (echec) {
    log.warn('point quotidien refusé par Resend', echec);
    return { envoye: false, clients: point.clients.length, echec };
  }
  log.info(`point quotidien envoyé à ${ADRESSE_DE_HAIKO} (${point.clients.length} client(s))`);
  return { envoye: true, clients: point.clients.length };
}

/* ------------------------------------------------------------------ */
/* Le courriel du lundi matin, aux clients                              */
/* ------------------------------------------------------------------ */

/** Ce qu'un passage a fait, pour que le journal le dise en une ligne. */
export interface PassageDuRecapitulatif {
  /** Pas l'heure, ou déjà envoyé cette semaine. */
  saute?: 'pas-l-heure' | 'pas-de-cle';
  envoyes: number;
  vides: number;
  sansAdresse: number;
  echecs: string[];
}

/**
 * UN PASSAGE DU LUNDI. `maintenant` est passé en argument pour qu'un essai
 * puisse le rejouer un lundi matin sans attendre lundi matin.
 */
export async function passageDuRecapitulatif(maintenant = Date.now()): Promise<PassageDuRecapitulatif> {
  const bilan: PassageDuRecapitulatif = { envoyes: 0, vides: 0, sansAdresse: 0, echecs: [] };
  if (!estLHeureDuCourrielDuClient(maintenant, derniereSemaineEnvoyee())) {
    return { ...bilan, saute: 'pas-l-heure' };
  }

  const cle = cleResend();
  if (!cle) {
    // On NE marque PAS la semaine : sans clé, rien n'est parti, et le passage
    // suivant doit pouvoir réessayer dès que la fiche est rangée au coffre.
    log.warn('courriel du lundi : aucune clé Resend au coffre-fort, rien n’est envoyé');
    return { ...bilan, saute: 'pas-de-cle' };
  }

  const clients = listerComptes().filter((compte) => compte.role === 'client' && compte.actif);

  const depuis = debutDeLaSemaine(maintenant);
  for (const client of clients) {
    const point = pointDuClient(
      demandesPourLeCourriel(client.projets, client.id, depuis),
      discussionPourLeCourriel(client.id, 'client'),
    );
    // RIEN À DIRE, RIEN À ENVOYER. Pas même un courriel qui le dirait.
    if (point.vide) {
      bilan.vides += 1;
      continue;
    }
    // Un compte SANS adresse est simplement sauté : il ne fait pas tomber les autres.
    if (!client.courriel) {
      bilan.sansAdresse += 1;
      continue;
    }
    const { sujet, texte, html } = courrielDuClient(nomDuCompte(client as CompteUtilisateur), point, {
      demande: (demande) => lienDuClient(demande),
    });
    const echec = await envoyerParResend(cle, client.courriel, sujet, texte, html);
    if (echec) {
      bilan.echecs.push(`${client.identifiant} : ${echec}`);
      log.warn(`courriel du lundi refusé pour ${client.identifiant}`, echec);
    } else {
      bilan.envoyes += 1;
      log.info(`courriel du lundi envoyé à ${client.identifiant}`);
    }
  }

  /*
   * LA SEMAINE EST MARQUÉE MÊME SI RIEN N'EST PARTI (rien à dire nulle part, ou
   * aucune adresse) : le travail a bien été fait, et repasser dans dix minutes
   * ne changerait rien. Seule l'absence de CLÉ ne marque pas — là, le travail
   * n'a pas eu lieu.
   */
  setMeta(CLE_DERNIERE_SEMAINE, cleDeSemaine(maintenant));
  return bilan;
}

/**
 * LE RENDEZ-VOUS, posé au démarrage du démon à côté de celui de la nuit. Un
 * SEUL minuteur pour les deux courriels : chacun décide lui-même si son heure
 * est venue, et le point du matin passe avant celui des clients.
 */
export function planifierLesCourriels(): NodeJS.Timeout {
  return setInterval(() => {
    if (enCours) return;
    enCours = true;
    void passageDuPointQuotidien()
      .catch((err) => log.warn('point quotidien : passage en échec', err))
      .then(() => passageDuRecapitulatif())
      .catch((err) => log.warn('courriel du lundi : passage en échec', err))
      .finally(() => {
        enCours = false;
      });
  }, PERIODE_DE_VEILLE_MS);
}
