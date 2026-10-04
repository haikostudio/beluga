/**
 * LES COMMANDES DE L'ESPACE CLIENT, ET LEUR CLOISONNEMENT.
 *
 * Elles sont traitées ICI, avant le grand `switch` du protocole, pour une
 * raison simple : chacune doit vérifier la PORTÉE du compte avant d'écrire, et
 * les mêler aux cent cinquante commandes d'administration reviendrait à parier
 * qu'on n'en oubliera aucune.
 *
 * Deux règles tiennent tout le fichier :
 *  - l'AUTEUR est réécrit depuis la session, jamais reçu du navigateur ;
 *  - un client ne touche QUE ses propres demandes, dans les projets de sa portée.
 */
import fs from 'node:fs';
import {
  REFUS_HORS_PORTEE,
  TITRES_COLONNES_DEMANDE,
  VERSION_TEXTE_ACCES,
  archiveTelechargeable,
  backupsDuProjet,
  contenuDAccesVisible,
  etatDeLAcces,
  lireTexteDAcces,
  nomDeLArchive,
  patchAutorise,
  peutVoirProjet,
  nomDuCompte,
  refusDeDeverrouiller,
  refusDePortee,
  type ClientEnvelope,
  type CompteUtilisateur,
  type ServerEvent,
  jugerCourriel,
  adresseDeNotification,
  clocheDuClientVueParHaiko,
  compteursDeLaMessagerie,
  fichesRangees,
  joursDInteractions,
  bornesDeLaPeriode,
  repartitionParColonne,
  construireFragment,
  etapeDeLaCarteLiee,
  type CibleNotification,
  type CompteursMessagerie,
  type Demande,
  type EtapeCarteLiee,
  type EvenementEspace,
  type MotifNotification,
} from '@beluga/shared';
import * as cloche from './espace-notifications.js';
import { mintDownload } from './auth.js';
import { envoyerLesIdentifiants } from './courriels-clients.js';
import { listerPoints, listerSites, lirePoint, lireSite } from './backups.js';
import * as acces from './espace-acces.js';
import { bus } from './bus.js';
import {
  changerLApparence,
  changerLIdentifiant,
  changerLaPortee,
  changerLeCourriel,
  compteParId,
  creerCompte,
  fermerLesSessions,
  listerComptes,
  motDePasseJuste,
  reinitialiserLeMotDePasse,
  renommerCompte,
  retirerLAcces,
  suspendreCompte,
} from './comptes.js';
import * as espace from './espace-client.js';
import * as store from './store.js';
import { notify } from './notify.js';
import { createCard } from './tools.js';
import { fichiersDeLaDemande, redigerLaTache } from './redaction-de-demande.js';
import { sendPrompt } from './runtime.js';
import { log } from './logger.js';

/**
 * LES COMMANDES DE CE FICHIER, TELLES QUE LE TYPAGE LES RECONNAÎT. Le grand
 * `switch` du protocole garde son contrôle d'exhaustivité : ce qui est traité
 * ici en est RETIRÉ, plutôt qu'ignoré au passage.
 */
export type CommandeDeLEspace = Extract<
  ClientEnvelope['cmd'],
  { type: `espace.${string}` } | { type: `comptes.${string}` }
>;

export function estCommandeDeLEspace(cmd: ClientEnvelope['cmd']): cmd is CommandeDeLEspace {
  return cmd.type.startsWith('espace.') || cmd.type.startsWith('comptes.');
}

/**
 * MA PROPRE FICHE : ce que je vois de MOI. Plus que `compteVisible`, qui sert à
 * présenter quelqu'un aux autres — mon adresse de courriel et mon apparence
 * m'appartiennent, et ne partent qu'à moi.
 */
export function monProfil(compte: CompteUtilisateur) {
  return {
    ...compteVisible(compte),
    courriel: compte.courriel ?? '',
    apparence: compte.apparence ?? '',
  };
}

/** Ce qu'on montre d'un compte : jamais son sel, jamais son empreinte. */
export function compteVisible(compte: CompteUtilisateur) {
  return {
    id: compte.id,
    identifiant: compte.identifiant,
    nomAffiche: nomDuCompte(compte),
    role: compte.role,
    projets: compte.projets.map((id) => ({ id, nom: store.getProject(id)?.name ?? id })),
  };
}

/**
 * CET ÉVÉNEMENT CONCERNE-T-IL CE CLIENT ? Le filtre par TYPE ne suffit pas : un
 * client ne reçoit que ce qui touche aux projets de SA PORTÉE.
 *
 * LA PORTÉE EST LE PROJET, PLUS L'AUTEUR. Sans ce changement, la correction de
 * visibilité ne vaudrait qu'au chargement de la page : une demande déposée par
 * Haiko n'apparaîtrait sur l'écran du client qu'après un rechargement à la
 * main, ce qui revient à ne pas corriger le problème.
 */
export function evenementPourCeClient(event: ServerEvent, compte: CompteUtilisateur): boolean {
  switch (event.type) {
    case 'espace.demande':
    case 'espace.demande.retiree':
    case 'espace.activite':
    case 'espace.acces':
      return peutVoirProjet(compte, (event as { projectId: string }).projectId);
    case 'espace.message': {
      // Le commentaire suit sa DEMANDE : visible pour qui voit la demande.
      const demande = espace.laDemande((event as { demandeId: string }).demandeId);
      return demande ? peutVoirProjet(compte, demande.projectId) : false;
    }
    case 'espace.nonLus':
    case 'espace.notification':
      return (event as { pour: string }).pour === compte.id;
    case 'espace.fil':
    case 'toast.client':
      return (event as { filId: string }).filId === compte.id;
    default:
      return true;
  }
}

/** Le projet visé par un client quand il n'en nomme pas : le premier de sa portée. */
function projetDuClient(compte: CompteUtilisateur, demande?: string): string {
  if (demande) {
    if (refusDePortee(compte.role, compte.projets, demande)) throw new Error(REFUS_HORS_PORTEE);
    return demande;
  }
  const premier = compte.role === 'admin' ? store.listProjects()[0]?.id : compte.projets[0];
  if (!premier) throw new Error("Aucun projet ne vous est ouvert pour l'instant.");
  return premier;
}

/**
 * LA DEMANDE VISÉE, VÉRIFIÉE. Un client atteint toutes les demandes des projets
 * de sa PORTÉE, quel qu'en soit l'auteur — c'est tout l'objet du correctif : un
 * espace où le travail de Haiko reste invisible ne sert à rien. Un projet hors
 * portée reste refusé du même refus que s'il n'existait pas.
 *
 * VOIR N'EST PAS RÉÉCRIRE : ce qu'un client a le droit de MODIFIER se décide
 * ailleurs, par `champsModifiables`.
 */
function demandeVisible(id: string, compte: CompteUtilisateur) {
  const demande = espace.laDemande(id);
  if (!demande) throw new Error(REFUS_HORS_PORTEE);
  if (compte.role === 'admin') return demande;
  if (!peutVoirProjet(compte, demande.projectId)) throw new Error(REFUS_HORS_PORTEE);
  return demande;
}

function auteurDe(compte: CompteUtilisateur) {
  return { id: compte.id, nom: nomDuCompte(compte), role: compte.role };
}

/**
 * Le fil visé. Un client n'a que le sien — l'argument est ignoré, ce qui rend
 * l'usurpation impossible plutôt que refusée. Haiko, lui, nomme le fil du
 * client à qui il parle.
 */
function filVise(compte: CompteUtilisateur, demande?: string): string {
  if (compte.role === 'client') return compte.id;
  if (!demande) throw new Error('Quel client ?');
  return demande;
}

/**
 * LES DEUX CHIFFRES DE LA PASTILLE : les messages de la discussion, et les
 * commentaires de demandes. Comptés PAR COMPTE — le même chiffre ne peut pas
 * servir à Haiko et au client.
 */
export function comptesDeNonLus(
  compte: CompteUtilisateur,
  /**
   * LE FIL REGARDÉ, quand il y en a un. La pastille du bouton « Discussion »
   * ne compte QUE ce fil : sans ce cadrage, Haiko voyait sur l'onglet d'UN
   * client la somme des messages de TOUS ses clients. Un client, lui, n'a
   * qu'un fil — le sien —, et le compte ne change pas.
   */
  filId?: string,
): { messages: number; commentaires: number } {
  const projets = compte.role === 'admin' ? store.listProjects(true).map((p) => p.id) : compte.projets;
  /*
   * CHACUN COMPTE LES MESSAGES DE L'AUTRE. Le compte en base figeait le rôle
   * « admin » : Haiko voyait donc sa propre pastille grossir à chaque message
   * qu'il envoyait. Le rôle du DEMANDEUR part maintenant avec la requête
   * (`nonLusDuFilPour`), des deux côtés.
   */
  const messages =
    compte.role !== 'admin'
      ? espace.nonLusDuFilPour(compte.id, compte.role)
      : filId
        ? espace.nonLusDuFilPour(filId, 'admin')
        : espace.filsDesClients().reduce((total, f) => total + f.nonLus, 0);
  return { messages, commentaires: espace.nonLusDesDemandes(projets, compte.id) };
}

/**
 * LES DEUX COMPTEURS DE LA MESSAGERIE D'UN COMPTE : le non-lu (demandes jamais
 * ouvertes, commentaires, messages) et les demandes à traiter. La règle est
 * pure (`compteursDeLaMessagerie`) ; ici, on ne fait que lui donner la base.
 */
export function compteursDeLaMessagerieDe(compte: CompteUtilisateur): CompteursMessagerie {
  const { messages, commentaires } = comptesDeNonLus(compte);
  const demandes = espace.demandesPourLesCompteurs(compte.role === 'admin' ? null : compte.projets, compte.id);
  return compteursDeLaMessagerie(compte.id, demandes, commentaires, messages);
}

/**
 * CHAQUE GESTE QUI PEUT CHANGER LES COMPTEURS LES REDIT, À CHAQUE
 * ADMINISTRATEUR : création, déplacement, lecture, commentaire, message,
 * prise en charge, archivage. Le tri par `pour` se fait à l'envoi (`ws.ts`).
 */
export function rafraichirLesCompteursDeHaiko(): void {
  for (const admin of listerComptes()) {
    if (admin.role !== 'admin' || !admin.actif) continue;
    bus.emit({ type: 'espace.compteurs', pour: admin.id, ...compteursDeLaMessagerieDe(admin) });
  }
}

/**
 * UN MESSAGE DE CLIENT ALLUME AUSSI LA PASTILLE DE HAIKO. Seuls
 * `espace.compteurs` partaient : la ligne « Messagerie » de la colonne de
 * gauche montait, et le bouton « Discussion » de l'espace du client restait nu
 * tant qu'on n'ouvrait pas le volet — le seul endroit qui écoutait `espace.fil`.
 *
 * LE COMPTE PART AVEC SON FIL. Sans lui, un compte vu comme Haiko vaut la somme
 * de TOUS ses clients, et l'écran l'écarte plutôt que d'afficher un total sur
 * l'onglet d'un seul client.
 */
function annoncerLesNonLusDuFilAuxAdmins(filId: string): void {
  for (const admin of listerComptes()) {
    if (admin.role !== 'admin' || !admin.actif) continue;
    bus.emit({ type: 'espace.nonLus', pour: admin.id, filId, ...comptesDeNonLus(admin, filId) });
  }
}

/** Ce qu'un événement de l'espace dit, à qui le reçoit. */
interface EvenementAAnnoncer {
  motif: MotifNotification;
  evenement: EvenementEspace;
  projectId: string;
  demande?: Pick<Demande, 'id' | 'titre'>;
  cible: CibleNotification;
  /** Le titre de l'alerte poussée, en français — le téléphone ne connaît pas la langue du lecteur. */
  titre: string;
  /** Le corps de l'alerte poussée et du repli des toasts, en français. */
  corps: string;
  /** L'objet de l'événement : deux alertes de même motif et même référence n'en font qu'une. */
  reference: string;
  /** Un complément que l'écran traduit : la colonne d'arrivée, la partie modifiée, l'étape… */
  detail?: string;
}

/** L'adresse de l'administration qui ouvre la fiche, ou le fil, du client qui a écrit. */
function adresseChezHaiko(auteur: CompteUtilisateur | null, e: EvenementAAnnoncer): string | undefined {
  if (!auteur || auteur.role !== 'client') return undefined;
  /* L'adresse se CONSTRUIT avec les règles partagées, elle ne se recopie pas :
     un format écrit à la main ici divergerait du reste au premier changement. */
  return `/#${construireFragment({
    vue: 'espace',
    clientId: auteur.id,
    ...(e.demande && e.cible === 'demande' ? { demandeId: e.demande.id } : {}),
  })}`;
}

/**
 * PRÉVENIR CEUX QUE ÇA REGARDE, ET PERSONNE D'AUTRE.
 *
 * AUCUN ÉCHO À SOI-MÊME : on n'alerte jamais l'auteur de son propre geste. Côté
 * client, l'alerte VISE le compte (`notify({ pour })`), sans quoi elle partirait
 * aussi sur le téléphone de Haiko ; côté Haiko, elle suit le chemin habituel du
 * démon — et arrive donc dans sa cloche du bandeau, sans deuxième cloche. Le
 * juge des trois genres, le dédoublonnage et les heures de silence s'appliquent
 * aux deux : c'est le guichet unique qui les tient.
 *
 * CHAQUE CLIENT PRÉVENU GARDE UNE LIGNE DANS SA CLOCHE, côté serveur. Une rafale
 * (cinq cases cochées) prolonge la ligne au lieu d'en ajouter, et ne refait pas
 * de toast. `auteur` vaut `null` quand personne n'a fait le geste — la carte
 * liée qui avance : on ne prévient alors que les clients (`seulementClients`).
 */
function prevenirLesAutres(
  auteur: CompteUtilisateur | null,
  e: EvenementAAnnoncer,
  seulementClients = false,
): void {
  const signature = !auteur || auteur.role === 'admin' ? 'Haiko' : nomDuCompte(auteur);
  for (const cible of listerComptes()) {
    if (cible.id === auteur?.id || !cible.actif) continue;
    if (cible.role === 'client' && !peutVoirProjet(cible, e.projectId)) continue;
    if (cible.role === 'admin' && seulementClients) continue;
    let url = cible.role === 'admin' ? adresseChezHaiko(auteur, e) : undefined;
    if (cible.role === 'client') {
      const { notification, prolongee } = cloche.consignerNotification({
        pour: cible.id,
        projectId: e.projectId,
        demandeId: e.demande?.id,
        cible: e.cible,
        motif: e.motif,
        evenement: e.evenement,
        auteur: signature,
        demandeTitre: e.demande?.titre ?? '',
        detail: e.detail ?? '',
      });
      url = adresseDeNotification(notification);
      bus.emit({ type: 'espace.notification', pour: cible.id, notification, nonLues: cloche.nonLuesDe(cible.id, cible.projets) });
      if (!prolongee) {
        bus.emit({ type: 'toast.client', filId: cible.id, level: 'info', text: `${signature} : ${e.corps}`, notification });
      }
      bus.emit({ type: 'espace.nonLus', pour: cible.id, filId: cible.id, ...comptesDeNonLus(cible) });
    }
    // Plusieurs administrateurs : même motif, même référence, sans `pour` — le
    // guichet n'en laisse partir qu'une, qui sert tous leurs appareils.
    notify({
      motif: e.motif,
      title: e.titre,
      body: `${signature} — ${e.corps}`,
      reference: e.reference,
      projectId: e.projectId,
      pour: cible.role === 'client' ? cible.id : undefined,
      url,
    });
  }
  if (!seulementClients) rafraichirLesCompteursDeHaiko();
}

/** La partie d'une fiche qui a bougé, en un mot que l'écran traduit — et sa phrase française pour le téléphone. */
const PARTIES_MODIFIEES: { cle: string; phrase: string; bouge: (a: Demande, b: Demande) => boolean }[] = [
  { cle: 'taches', phrase: 'a mis à jour les cases à cocher', bouge: (a, b) => JSON.stringify(a.taches) !== JSON.stringify(b.taches) },
  { cle: 'importance', phrase: 'a changé l’importance', bouge: (a, b) => a.importance !== b.importance },
  { cle: 'description', phrase: 'a modifié la description', bouge: (a, b) => a.description !== b.description || a.titre !== b.titre },
  { cle: 'echeance', phrase: 'a changé une date', bouge: (a, b) => a.echeance !== b.echeance || a.livraisonAnnoncee !== b.livraisonAnnoncee },
  { cle: 'options', phrase: 'a modifié les options', bouge: (a, b) => JSON.stringify([a.etiquettes, a.fichiers]) !== JSON.stringify([b.etiquettes, b.fichiers]) },
];

/** La phrase française d'une étape de la carte liée : seule l'étape est nommée, jamais le travail. */
const PHRASES_ETAPE: Record<EtapeCarteLiee, { motif: MotifNotification; phrase: string }> = {
  demarree: { motif: 'espace-avancement', phrase: 'Le travail sur votre demande a commencé' },
  terminee: { motif: 'espace-avancement', phrase: 'Le travail sur votre demande est terminé' },
  'en-ligne': { motif: 'espace-en-ligne', phrase: 'Votre demande est en ligne' },
};

/** L'auteur d'une ligne d'historique que personne n'a signée : la carte liée qui avance. */
const AUTEUR_AVANCEMENT = { id: 'beluga-avancement', nom: 'Haiko', role: 'admin' as const };

/**
 * L'AVANCEMENT DE LA CARTE LIÉE PRÉVIENT SES CLIENTS. Branché sur le passage
 * commun de toutes les cartes (`store.observerLesCartes`) : lancement, fin de
 * tour, glisser, publication — aucun chemin n'est oublié. L'annonce est
 * DIFFÉRÉE : la carte est déjà écrite, et une panne ici ne fait jamais échouer
 * son déplacement ; elle se journalise, en silence pour l'écran.
 */
export function brancherLAvancementDesCartes(): () => void {
  return store.observerLesCartes((avant, carte, details) => {
    const etape = etapeDeLaCarteLiee(avant, carte, details);
    if (!etape) return;
    setImmediate(() => {
      try {
        annoncerLEtape(carte.id, etape);
      } catch (err) {
        log.warn('espace client', `avancement de la carte ${carte.id} non annoncé : ${String(err)}`);
      }
    });
  });
}

export function annoncerLEtape(carteId: string, etape: EtapeCarteLiee): void {
  for (const demande of espace.demandesDeLaCarte(carteId)) {
    if (demande.archiveeLe) continue;
    const activite = espace.noterActivite(AUTEUR_AVANCEMENT, demande, 'avancement', etape);
    bus.emit({ type: 'espace.activite', demandeId: demande.id, projectId: demande.projectId, activite });
    bus.emit({ type: 'espace.demande', projectId: demande.projectId, demande, auteurId: demande.auteurId });
    const { motif, phrase } = PHRASES_ETAPE[etape];
    prevenirLesAutres(
      null,
      {
        motif,
        evenement: etape,
        projectId: demande.projectId,
        demande,
        cible: 'demande',
        titre: demande.titre,
        corps: phrase,
        reference: `${demande.id}:${etape}`,
        detail: etape,
      },
      true,
    );
  }
}

/**
 * LIRE UNE FICHE ÉTEINT TOUT CE QUI EN PARLAIT, POUR CE COMPTE : la pastille de
 * ses non-lus, les lignes de sa cloche sur cette demande, et — pour Haiko — les
 * compteurs de la Messagerie.
 */
function lireLaDemande(compte: CompteUtilisateur, demandeId: string): void {
  espace.marquerDemandeLue(demandeId, compte.id);
  /*
   * LIRE UNE FICHE NE DIT RIEN DU FIL REGARDÉ : on ne le connaît pas ici. Le
   * compte de messages part donc SANS fil — l'écran de Haiko, qui regarde le
   * fil d'UN client, le laissera de côté plutôt que d'afficher le total de
   * tous ses clients. Un client, lui, n'a qu'un fil : le sien est nommé.
   */
  bus.emit({
    type: 'espace.nonLus',
    pour: compte.id,
    filId: compte.role === 'client' ? compte.id : undefined,
    ...comptesDeNonLus(compte),
  });
  if (compte.role === 'admin') {
    rafraichirLesCompteursDeHaiko();
  } else if (cloche.marquerNotificationsLues(compte.id, { demandeId })) {
    bus.emit({ type: 'espace.notification', pour: compte.id, nonLues: cloche.nonLuesDe(compte.id, compte.projets) });
  }
}

/**
 * Combien de temps vit le lien d'une archive. Assez pour qu'un navigateur lent
 * commence le téléchargement ; assez peu pour qu'un lien recopié ailleurs ne
 * serve pas le lendemain.
 */
const DUREE_LIEN_ARCHIVE_MS = 15 * 60 * 1000;

/**
 * CE QUE L'ESPACE « ACCÈS » MONTRE À CE COMPTE. L'état et la version du texte
 * partent toujours ; le CONTENU seulement quand la règle le permet
 * (`contenuDAccesVisible`) — jamais « envoyé puis caché » par l'écran. Le
 * journal n'est rendu qu'à Haiko.
 */
function vueDeLAcces(projectId: string, compte: CompteUtilisateur) {
  const journal = acces.journalDAcces(projectId);
  const etat = etatDeLAcces(journal);
  return {
    projectId,
    etat,
    version: VERSION_TEXTE_ACCES,
    contenu: contenuDAccesVisible(compte.role, etat) ? acces.contenuDAcces(projectId) : null,
    journal: compte.role === 'admin' ? journal : undefined,
  };
}

export async function commandeDeLEspaceClient(
  cmd: CommandeDeLEspace,
  compte: CompteUtilisateur,
): Promise<unknown> {
  switch (cmd.type) {
    /* ---------------- Le kanban ---------------- */

    case 'espace.etat': {
      const projectId = projetDuClient(compte, cmd.projectId);
      return {
        projectId,
        projet: store.getProject(projectId)?.name ?? projectId,
        // LA PORTÉE EST LE PROJET : le client voit tout ce qui s'y passe, quel
        // que soit l'auteur. Le compte ne sert plus qu'à compter SES non-lus.
        demandes: espace.demandesAffichees(projectId, compte.id),
        moi: compteVisible(compte),
        nonLus: comptesDeNonLus(compte, cmd.filId),
        /*
         * UN CLIENT À PLUSIEURS PROJETS voit, dans son sélecteur, lesquels ont du
         * nouveau : le nombre de demandes vivantes à rouvrir, projet par projet.
         */
        nonLusParProjet:
          compte.role === 'client' && compte.projets.length > 1
            ? Object.fromEntries(compte.projets.map((id) => [id, espace.demandesAvecDuNouveau(id, compte.id)]))
            : undefined,
      };
    }

    /* ---------------- La cloche du compte ---------------- */

    case 'espace.notifications.lister':
      // Le destinataire vient de la SESSION : on ne lit jamais la cloche d'un autre.
      return cloche.listerNotifications(compte.id, compte.role === 'admin' ? null : compte.projets, cmd.avant, cmd.limite);

    case 'espace.notifications.lire': {
      const marquees = cloche.marquerNotificationsLues(compte.id, { id: cmd.id });
      const nonLues = cloche.nonLuesDe(compte.id, compte.role === 'admin' ? null : compte.projets);
      bus.emit({ type: 'espace.notification', pour: compte.id, nonLues });
      return { ok: true, marquees, nonLues };
    }

    /*
     * LA CLOCHE D'UN CLIENT, VUE PAR HAIKO. Rien n'est gardé en base pour
     * l'administrateur : la liste se RECONSTRUIT depuis ce que compte déjà la
     * Messagerie, bornée aux projets de CE client et à SON fil — jamais un
     * élément d'un autre (P0 MEM-0540). Le chiffre rendu est celui de sa ligne.
     */
    case 'espace.notifications.client': {
      if (compte.role !== 'admin') throw new Error('Réservé à l’administration.');
      const client = listerComptes().find((c) => c.id === cmd.clientId && c.role === 'client');
      if (!client) throw new Error('Client introuvable.');
      const demandes = client.projets
        .flatMap((projectId) => espace.demandesAffichees(projectId, compte.id))
        .filter((d) => !d.archiveeLe);
      const titres = new Map(demandes.map((d) => [d.id, d.titre]));
      const commentaires = demandes
        .filter((d) => d.resume.nonLus > 0)
        .map((d) => {
          const depuis = espace.luJusquA(d.id, compte.id);
          const dernier = espace
            .messagesDeLaDemande(d.id)
            .filter((m) => m.creeLe > depuis && m.auteurId !== compte.id)
            .at(-1);
          return {
            demandeId: d.id,
            projectId: d.projectId,
            titre: d.titre,
            nombre: d.resume.nonLus,
            auteur: dernier?.auteurNom ?? '',
            texte: dernier?.texte ?? '',
            dernierLe: dernier?.creeLe ?? d.creeeLe,
          };
        });
      const filNonLu = espace.messagesDuFil(client.id).filter((m) => m.auteurRole === 'client' && !m.luLe);
      const dernierDuFil = filNonLu.at(-1);
      const etapes = espace
        .activiteDepuis(client.projets, Date.now() - 30 * 24 * 3600 * 1000)
        .filter((a) => a.genre === 'avancement' && titres.has(a.demandeId))
        .map((a) => ({
          id: a.id,
          demandeId: a.demandeId,
          projectId: a.projectId,
          titre: titres.get(a.demandeId) ?? '',
          etape: a.detail,
          creeLe: a.creeLe,
        }));
      return clocheDuClientVueParHaiko({
        compteId: compte.id,
        demandes: demandes.map((d) => ({ ...d, ouverte: !d.resume.jamaisOuverte })),
        commentaires,
        fil: dernierDuFil
          ? { nombre: filNonLu.length, auteur: dernierDuFil.auteurNom, texte: dernierDuFil.texte, dernierLe: dernierDuFil.creeLe }
          : null,
        etapes,
      });
    }

    case 'espace.demande.creer': {
      const projectId = projetDuClient(compte, cmd.projectId);
      const demande = espace.creerDemande(auteurDe(compte), {
        projectId,
        titre: cmd.titre,
        description: cmd.description,
        importance: cmd.importance,
        fichiers: cmd.fichiers,
        etiquettes: cmd.etiquettes,
        taches: cmd.taches,
        echeance: cmd.echeance,
      });
      bus.emit({ type: 'espace.demande', projectId, demande, auteurId: demande.auteurId });
      prevenirLesAutres(compte, {
        motif: 'espace-demande',
        evenement: 'nouvelle-demande',
        projectId: demande.projectId,
        demande,
        cible: 'demande',
        titre: 'Nouvelle demande',
        corps: demande.titre,
        reference: demande.id,
      });
      return { demande, resume: espace.resumeDeLaDemande(demande, compte.id) };
    }

    case 'espace.demande.modifier': {
      const avant = demandeVisible(cmd.id, compte);
      /*
       * VOIR N'EST PAS RÉÉCRIRE. Le patch est TAMISÉ par une règle pure : un
       * client retouche le titre des siennes, jamais celui d'une demande écrite
       * par Haiko ; et `livraisonAnnoncee` ne lui est jamais ouverte — un
       * engagement que son destinataire peut réécrire n'en est pas un.
       */
      const patch = patchAutorise(
        {
          titre: cmd.titre,
          description: cmd.description,
          importance: cmd.importance,
          fichiers: cmd.fichiers,
            etiquettes: cmd.etiquettes,
          taches: cmd.taches,
          echeance: cmd.echeance,
          livraisonAnnoncee: cmd.livraisonAnnoncee,
        },
        compte.role,
        avant.auteurId === compte.id,
      );
      const demande = espace.modifierDemande(cmd.id, patch, auteurDe(compte));
      bus.emit({ type: 'espace.demande', projectId: avant.projectId, demande, auteurId: demande.auteurId });
      /*
       * UNE FICHE RETOUCHÉE PRÉVIENT L'AUTRE CÔTÉ — une case cochée, une
       * importance, une description. La référence est la DEMANDE : une rafale
       * de cases cochées ne fait qu'une alerte, et une seule ligne de cloche.
       */
      const partie = PARTIES_MODIFIEES.find((p) => p.bouge(avant, demande));
      if (partie) {
        prevenirLesAutres(compte, {
          motif: 'espace-modification',
          evenement: 'modification',
          projectId: demande.projectId,
          demande,
          cible: 'demande',
          titre: demande.titre,
          corps: partie.phrase,
          reference: `modification:${demande.id}`,
          detail: partie.cle,
        });
      }
      return { demande };
    }

    case 'espace.demande.deplacer': {
      const avant = demandeVisible(cmd.id, compte);
      const demande = espace.deplacerDemande(cmd.id, cmd.colonne, cmd.avantId, cmd.apresId, auteurDe(compte));
      bus.emit({ type: 'espace.demande', projectId: avant.projectId, demande, auteurId: demande.auteurId });
      if (avant.colonne !== demande.colonne) {
        prevenirLesAutres(compte, {
          motif: 'espace-demande',
          evenement: 'deplacement',
          projectId: demande.projectId,
          demande,
          cible: 'demande',
          titre: demande.titre,
          corps: `Déplacée en « ${TITRES_COLONNES_DEMANDE[demande.colonne]} »`,
          reference: `${demande.id}:${demande.colonne}`,
          detail: demande.colonne,
        });
      }
      return { demande };
    }

    case 'espace.demande.archiver': {
      const avant = demandeVisible(cmd.id, compte);
      const demande = espace.archiverDemande(cmd.id, cmd.archivee, auteurDe(compte));
      bus.emit({ type: 'espace.demande', projectId: avant.projectId, demande, auteurId: demande.auteurId });
      // Ranger prévient ; ressortir des archives ne fait que remettre au tableau.
      if (cmd.archivee && !avant.archiveeLe) {
        prevenirLesAutres(compte, {
          motif: 'espace-archivage',
          evenement: 'archivage',
          projectId: demande.projectId,
          demande,
          cible: 'demande',
          titre: demande.titre,
          corps: 'Demande rangée',
          reference: `archivage:${demande.id}`,
        });
      } else {
        rafraichirLesCompteursDeHaiko();
      }
      return { demande };
    }

    case 'espace.demande.marquerLu': {
      const demande = demandeVisible(cmd.id, compte);
      lireLaDemande(compte, demande.id);
      return { ok: true, nonLus: comptesDeNonLus(compte) };
    }

    case 'espace.demande.activite': {
      const demande = demandeVisible(cmd.id, compte);
      return { activite: espace.activiteDeLaDemande(demande.id) };
    }

    case 'espace.demande.lire': {
      const demande = demandeVisible(cmd.id, compte);
      const messages = espace.messagesDeLaDemande(cmd.id);
      // OUVRIR, C'EST AVOIR LU : la pastille de CE compte retombe ici, sans
      // second aller-retour depuis le navigateur — sa cloche aussi.
      lireLaDemande(compte, demande.id);
      return {
        demande,
        messages,
        galerie: espace.galerie(demande, messages),
        activite: espace.activiteDeLaDemande(demande.id),
      };
    }

    case 'espace.demande.commenter': {
      const demande = demandeVisible(cmd.id, compte);
      const message = espace.commenterDemande(auteurDe(compte), cmd.id, cmd.texte, cmd.fichiers ?? []);
      // Diffusé à TOUS ceux qui voient la demande — le tri se fait à l'envoi,
      // sur le PROJET (`evenementPourCeClient`), plus sur l'auteur.
      bus.emit({ type: 'espace.message', demandeId: cmd.id, message, auteurId: demande.auteurId });
      prevenirLesAutres(compte, {
        motif: 'espace-message',
        evenement: 'commentaire',
        projectId: demande.projectId,
        demande,
        cible: 'demande',
        titre: demande.titre,
        corps: message.texte || 'Une pièce jointe',
        reference: message.id,
        detail: message.texte.slice(0, 140),
      });
      return { message };
    }

    /* ---------------- Le fil de discussion ---------------- */

    case 'espace.fil.lire': {
      const filId = filVise(compte, cmd.filId);
      const messages = espace.messagesDuFil(filId);
      /* LES PIÈCES PARTENT AVEC LE FIL : sans leur nom et leur poids, l'écran
         n'affiche qu'un lien « Pièce jointe » qui n'apprend rien. */
      return { filId, messages, pieces: espace.piecesDuFil(messages) };
    }

    case 'espace.fil.envoyer': {
      const filId = filVise(compte, cmd.filId);
      const message = espace.envoyerAuFil(auteurDe(compte), filId, cmd.texte, cmd.fichiers ?? []);
      bus.emit({ type: 'espace.fil', filId, message });
      /*
       * LE FIL ALERTE COMME LES DEMANDES. Il existait déjà mais restait muet :
       * un message de Haiko arrivait sans rien allumer nulle part. Le
       * destinataire est celui d'EN FACE — le client quand Haiko écrit, Haiko
       * quand le client écrit.
       */
      const destinataire = compte.role === 'admin' ? compteParId(filId) : null;
      const signature = compte.role === 'admin' ? 'Haiko' : nomDuCompte(compte);
      const corps = message.texte || 'Une pièce jointe';
      let url =
        compte.role === 'client'
          ? `/#${construireFragment({ vue: 'espace', clientId: compte.id })}`
          : undefined;
      if (destinataire) {
        // Le message de Haiko entre dans la cloche du client, qui mène à la discussion.
        const { notification } = cloche.consignerNotification({
          pour: destinataire.id,
          cible: 'discussion',
          motif: 'espace-message',
          evenement: 'message',
          auteur: signature,
          detail: message.texte.slice(0, 140),
        });
        url = adresseDeNotification(notification);
        bus.emit({
          type: 'espace.notification',
          pour: destinataire.id,
          notification,
          nonLues: cloche.nonLuesDe(destinataire.id, destinataire.projets),
        });
        bus.emit({ type: 'toast.client', filId, level: 'info', text: `${signature} : ${corps}`, notification });
        bus.emit({ type: 'espace.nonLus', pour: destinataire.id, filId, ...comptesDeNonLus(destinataire, filId) });
      }
      notify({
        motif: 'espace-message',
        title: 'Discussion',
        body: `${signature} — ${corps}`,
        reference: message.id,
        pour: destinataire?.id,
        url,
      });
      if (compte.role === 'client') {
        annoncerLesNonLusDuFilAuxAdmins(filId);
        rafraichirLesCompteursDeHaiko();
      }
      return { message };
    }

    case 'espace.fil.vu': {
      const filId = filVise(compte, cmd.filId);
      espace.marquerLeFilLu(filId, compte.role);
      /*
       * LE MÊME CADRAGE QU'À `espace.etat` : le fil REGARDÉ. Sans lui, ouvrir
       * la discussion d'UN client rendait à Haiko la somme de TOUS ses fils, et
       * la pastille qu'on venait d'éteindre se rallumait à la réponse.
       */
      const apres = comptesDeNonLus(compte, filId);
      bus.emit({ type: 'espace.nonLus', pour: compte.id, filId, ...apres });
      if (compte.role === 'admin') {
        rafraichirLesCompteursDeHaiko();
      } else if (cloche.marquerNotificationsLues(compte.id, { cible: 'discussion' })) {
        bus.emit({ type: 'espace.notification', pour: compte.id, nonLues: cloche.nonLuesDe(compte.id, compte.projets) });
      }
      return { ok: true, nonLus: apres };
    }

    /* ---------------- Les backups du projet ---------------- */

    case 'espace.backups.lister': {
      const projectId = projetDuClient(compte, cmd.projectId);
      return { projectId, sites: backupsDuProjet(projectId, listerSites(), listerPoints()) };
    }

    case 'espace.backups.telecharger': {
      /*
       * LA PORTÉE SE VÉRIFIE SUR LE SITE DE L'ARCHIVE, pas sur un projet envoyé
       * par le navigateur. Un point absent, un point d'un site extérieur et un
       * point d'un autre projet reçoivent le MÊME refus : rien ne se devine.
       */
      const point = lirePoint(cmd.pointId);
      const site = point ? lireSite(point.siteId) : null;
      if (!point || !site?.projectId || refusDePortee(compte.role, compte.projets, site.projectId)) {
        throw new Error(REFUS_HORS_PORTEE);
      }
      if (!archiveTelechargeable(point) || !fs.existsSync(point.cheminArchive as string)) {
        throw new Error('Cette archive n’est plus disponible sur le serveur.');
      }
      const nom = nomDeLArchive(site.nom, point.debut);
      log.info('espace client', `archive « ${nom} » demandée par ${nomDuCompte(compte)}`);
      return {
        token: mintDownload(point.cheminArchive as string, nom, DUREE_LIEN_ARCHIVE_MS),
        nom,
        taille: point.taille ?? 0,
      };
    }

    /* ---------------- L'espace « Accès » ---------------- */

    case 'espace.acces.lire': {
      const projectId = projetDuClient(compte, cmd.projectId);
      return vueDeLAcces(projectId, compte);
    }

    case 'espace.acces.deverrouiller': {
      const projectId = projetDuClient(compte, cmd.projectId);
      const refus = refusDeDeverrouiller({ confirme: cmd.confirme, version: cmd.version });
      if (refus) throw new Error(refus);
      // Déjà ouvert : rien à rejouer, ni au journal ni aux alertes.
      if (!etatDeLAcces(acces.journalDAcces(projectId)).ouvert) {
        const entree = acces.noterGesteDAcces({
          projectId,
          geste: 'deverrouillage',
          compteId: compte.id,
          nom: nomDuCompte(compte),
          role: compte.role,
        });
        bus.emit({ type: 'espace.acces', projectId, ouvert: true });
        const projet = store.getProject(projectId)?.name ?? projectId;
        log.info('espace client', `espace « Accès » de « ${projet} » ouvert par ${entree.nom}`);
        /*
         * HAIKO EST PRÉVENU, par le guichet habituel et sans canal neuf : la
         * sûreté de ces accès ne dépend plus de lui à partir de cet instant.
         */
        if (compte.role === 'client') {
          notify({
            motif: 'espace-demande',
            title: 'Accès ouvert par un client',
            body: `${entree.nom} a ouvert l’espace « Accès » de « ${projet} » et en a pris la responsabilité.`,
            reference: `acces:${entree.id}`,
            projectId,
          });
        }
      }
      return vueDeLAcces(projectId, compte);
    }

    case 'espace.acces.ecrire': {
      // La liste blanche ferme déjà la porte ; la garde est redite ici, au geste.
      if (compte.role !== 'admin') throw new Error(REFUS_HORS_PORTEE);
      const projectId = projetDuClient(compte, cmd.projectId);
      const lu = lireTexteDAcces(cmd.texte);
      if (!lu.ok) throw new Error(lu.raison);
      acces.ecrireContenuDAcces(projectId, lu.texte, nomDuCompte(compte));
      bus.emit({ type: 'espace.acces', projectId, ouvert: etatDeLAcces(acces.journalDAcces(projectId)).ouvert });
      return vueDeLAcces(projectId, compte);
    }

    case 'espace.acces.reverrouiller': {
      if (compte.role !== 'admin') throw new Error(REFUS_HORS_PORTEE);
      const projectId = projetDuClient(compte, cmd.projectId);
      if (etatDeLAcces(acces.journalDAcces(projectId)).ouvert) {
        acces.noterGesteDAcces({
          projectId,
          geste: 'reverrouillage',
          compteId: compte.id,
          nom: nomDuCompte(compte),
          role: compte.role,
        });
        bus.emit({ type: 'espace.acces', projectId, ouvert: false });
      }
      return vueDeLAcces(projectId, compte);
    }

    /* ---------------- Ce qui n'appartient qu'à Haiko ---------------- */

    case 'espace.clients': {
      const clients = listerComptes().filter((c) => c.role === 'client');
      const fils = new Map(espace.filsDesClients().map((f) => [f.filId, f]));
      return {
        clients: clients.map((client) => {
          const fil = fils.get(client.id) ?? { filId: client.id, nonLus: 0 };
          /*
           * LES DEUX MÊMES COMPTEURS QUE LA COLONNE DE GAUCHE, AU PÉRIMÈTRE DE
           * CE CLIENT : la règle pure est la même (`compteursDeLaMessagerie`),
           * seule la base change — les projets de CE client, ses commentaires
           * non lus, et les messages de SON fil que Haiko n'a pas lus. Les
           * lignes se somment donc vers le total, sauf sur un projet sans
           * client ou partagé par deux clients.
           */
          const compteurs = compteursDeLaMessagerie(
            compte.id,
            espace.demandesPourLesCompteurs(client.projets, compte.id),
            espace.nonLusDesDemandes(client.projets, compte.id),
            fil.nonLus,
          );
          return {
            ...compteVisible(client),
            actif: client.actif,
            derniereEntree: client.derniereEntree,
            fil,
            compteurs,
            // Ce que le client VOIT, à l'identique : toutes les demandes de ses
            // projets. Montrer autre chose ici, c'est se tromper sur son écran.
            demandes: client.projets.flatMap((projectId) => espace.demandesAffichees(projectId, compte.id)),
          };
        }),
      };
    }

    case 'espace.tableauDeBord': {
      /*
       * L'ACCUEIL DE LA MESSAGERIE, CALCULÉ EN UNE FOIS.
       *
       * Un appel par client aurait multiplié les allers-retours par le nombre
       * de clients, pour un écran qu'on ouvre en premier : tout est assemblé
       * ici, et l'écran n'a plus qu'à dessiner. Les deux compteurs sont les
       * MÊMES que ceux de la colonne de gauche (`compteursDeLaMessagerie`) :
       * l'accueil ne peut pas contredire la pastille qui l'a fait ouvrir.
       */
      const maintenant = Date.now();
      /*
       * LA PÉRIODE VIENT DE L'ÉCRAN, ET ELLE EST REMISE D'APLOMB ICI. Un
       * navigateur peut demander n'importe quoi — bornes inversées, dix ans de
       * profondeur : `bornesDeLaPeriode` les ramène sous le plafond plutôt que
       * de refuser l'écran, et c'est la période RENDUE qui fait foi pour le
       * graphique, jamais celle qui a été demandée.
       */
      const periode = bornesDeLaPeriode(cmd.debut, cmd.fin, maintenant);
      const fils = new Map(espace.filsDesClients().map((f) => [f.filId, f]));
      const fiches = listerComptes()
        .filter((c) => c.role === 'client')
        .map((client) => {
          const fil = fils.get(client.id) ?? { filId: client.id, nonLus: 0 };
          const demandes = client.projets.flatMap((projectId) => espace.demandesAffichees(projectId, compte.id));
          const compteurs = compteursDeLaMessagerie(
            compte.id,
            espace.demandesPourLesCompteurs(client.projets, compte.id),
            espace.nonLusDesDemandes(client.projets, compte.id),
            fil.nonLus,
          );
          /*
           * UNE TÂCHE « OUVERTE » EST UNE CARTE LIÉE QUI N'EST NI RANGÉE NI
           * DISPARUE. Une carte supprimée laisse son lien derrière elle : on
           * ne la compte pas, plutôt que d'annoncer un travail qui n'existe
           * plus.
           */
          const tachesOuvertes = demandes.filter((demande) => {
            if (!demande.carteId) return false;
            const carte = store.getCard(demande.carteId);
            return Boolean(carte) && carte!.column !== 'archived';
          }).length;
          /*
           * LES ÉCHANGES DE LA PÉRIODE, COMPTÉS UNE SEULE FOIS : la même liste
           * d'horodatages donne le graphique journalier ET le nombre de
           * messages. Deux relevés séparés finiraient par se contredire.
           */
          const echanges = espace.horodatagesDesEchanges(
            client.projets,
            fil.filId,
            periode.debut,
            periode.fin,
          );
          return {
            clientId: client.id,
            nomAffiche: nomDuCompte(client),
            actif: client.actif,
            /*
             * LE NOM DU PROJET S'AFFICHE SOUS CELUI DU CLIENT. Un client peut
             * en avoir plusieurs : on les nomme TOUS plutôt que d'en élire un
             * au hasard.
             */
            projets: client.projets.map((id) => ({ id, nom: store.getProject(id)?.name ?? id })),
            compteurs,
            demandesOuvertes: demandes.filter((d) => !d.archiveeLe).length,
            parColonne: repartitionParColonne(demandes),
            tachesOuvertes,
            messages: echanges.length,
            derniereActivite: demandes.reduce(
              (dernier, d) => Math.max(dernier, d.derniereActivite ?? 0),
              fil.dernier ?? 0,
            ) || undefined,
            interactions: joursDInteractions(echanges, periode.debut, periode.fin),
          };
        });
      return { fiches: fichesRangees(fiches), debut: periode.debut, fin: periode.fin, jours: periode.jours };
    }

    case 'espace.demande.enCarte': {
      const demande = demandeVisible(cmd.id, compte);
      if (demande.carteId && store.getCard(demande.carteId)) {
        return { carte: store.getCard(demande.carteId), demande };
      }
      /*
       * TOUTES LES PIÈCES DU FIL SUIVENT, PAS SEULEMENT CELLES DE LA DEMANDE.
       * Une capture envoyée trois messages plus loin est souvent la seule
       * chose qui montre le problème : elle doit être sur la carte.
       */
      const fichiers = fichiersDeLaDemande(demande.id, demande.fichiers);
      const carte = createCard(demande.projectId, {
        title: demande.titre,
        description: [demande.description, `\n\n_Demande de ${demande.auteurNom}._`].filter(Boolean).join(''),
        origin: 'user',
        // La carte naît avec la demande du client en tête de sa conversation,
        // avant même que la rédaction ne la réécrive (MEM-3555).
        auteur: 'espace-client',
        // Les pièces jointes de la demande ET de son fil suivent : l'agent les
        // lira au lancement, sans qu'on ait à les redéposer.
        attachments: fichiers,
        /*
         * LES RÉGLAGES CHOISIS À LA CONVERSION PORTENT LA CARTE, et ne sont
         * jamais réécrits ensuite : le cadrage qui suit les reprend
         * (`creerLAgentDeCadrage` lit `card.run`), et le lancement aussi.
         */
        run: cmd.run,
        /*
         * `cadrage` : cette carte ouvre une DISCUSSION, elle n'annonce aucun
         * départ. Sans cela, elle naîtrait avec un créneau conseillé alors que
         * son titre n'est même pas encore écrit.
         */
        cadrage: true,
      });
      const suite = espace.lierACarte(demande.id, carte.id);
      /* LE LIEN SE LIT AUSSI DEPUIS LA CARTE : l'écran doit pouvoir dire, sans
         interroger la base, que cette carte reste attachée à l'espace de son
         client — donc qu'elle ne change pas de projet. */
      const carteLiee = store.saveCard({ ...carte, demandeClientId: demande.id });
      const activite = espace.noterActivite(auteurDe(compte), suite, 'carte', carte.title);
      bus.emit({ type: 'card.upsert', card: carteLiee });
      bus.emit({ type: 'espace.demande', projectId: demande.projectId, demande: suite, auteurId: suite.auteurId });
      bus.emit({ type: 'espace.activite', demandeId: suite.id, projectId: suite.projectId, activite });
      // PRISE EN CHARGE : le client l'apprend, sans le détail de la carte.
      prevenirLesAutres(compte, {
        motif: 'espace-prise-en-charge',
        evenement: 'prise-en-charge',
        projectId: suite.projectId,
        demande: suite,
        cible: 'demande',
        titre: suite.titre,
        corps: 'Votre demande est prise en charge',
        reference: `prise-en-charge:${suite.id}`,
      });
      log.info('espace client', `demande « ${demande.titre} » transformée en carte`);
      /*
       * LA TÂCHE EST RÉDIGÉE PAR L'AGENT QUI LA PRENDRA EN CHARGE.
       *
       * La carte existe DÉJÀ, avec le titre et la description de la demande :
       * c'est ce qui la rend utilisable tout de suite, et ce qui reste si le
       * tour de cadrage n'aboutit pas. L'agent de cadrage reçoit ensuite
       * l'échange entier et REMPLACE ces deux champs par sa propre rédaction ;
       * c'est aussi lui qui pose la synthèse lue sous le point « Demande ».
       *
       * ON N'ATTEND PAS CE TOUR pour répondre : la carte est rendue tout de
       * suite, et son titre définitif arrive quelques secondes plus tard.
       *
       * ET S'IL RATE, ÇA SE SAIT : `redigerLaTache` écrit l'issue sur la carte,
       * rejoue seul un échec passager et laisse sinon une mention relançable
       * (`server/src/redaction-de-demande.ts`). Plus de ligne de journal pour
       * seule trace.
       */
      void redigerLaTache({ carteId: carteLiee.id, demandeId: demande.id });
      return { carte: carteLiee, demande: suite };
    }

    /* ---------------- MON COMPTE, ET LE MIEN SEULEMENT ---------------- */

    /*
     * AUCUNE DE CES BRANCHES NE LIT D'IDENTIFIANT DE COMPTE DANS LA COMMANDE :
     * elles agissent toutes sur `compte.id`, celui du canal. Viser le voisin
     * n'est donc pas « refusé », c'est INÉCRIVABLE — la vérification ne peut
     * pas être oubliée dans six mois par une commande de plus.
     */
    case 'espace.moi':
      return monProfil(compte);

    case 'espace.moi.apparence':
      return monProfil(changerLApparence(compte.id, cmd.apparence));

    case 'espace.moi.profil': {
      let suite = compte;
      if (cmd.nomAffiche !== undefined) {
        const nom = cmd.nomAffiche.trim();
        if (!nom) throw new Error('Votre nom ne peut pas être vide.');
        if (nom.length > 80) throw new Error('Votre nom fait au plus 80 signes.');
        suite = renommerCompte(compte.id, nom);
      }
      if (cmd.courriel !== undefined) suite = changerLeCourriel(compte.id, cmd.courriel);
      return monProfil(suite);
    }

    case 'espace.moi.identifiant': {
      /* CHANGER SON ENTRÉE SE PAIE DE SON MOT DE PASSE : sans cela, un écran
         laissé ouvert suffirait à s'emparer d'un compte. */
      if (!motDePasseJuste(compte.id, cmd.motDePasse)) throw new Error('Ce mot de passe n’est pas le bon.');
      /* LA SESSION NE TOMBE PAS : elle tient au compte, pas à son identifiant.
         On ne met personne dehors pour avoir changé son nom d'entrée. */
      return monProfil(changerLIdentifiant(compte.id, cmd.identifiant));
    }

    case 'espace.moi.motDePasse': {
      if (!motDePasseJuste(compte.id, cmd.actuel)) throw new Error('Ce mot de passe n’est pas le bon.');
      reinitialiserLeMotDePasse(compte.id, cmd.nouveau);
      /*
       * TOUTES LES SESSIONS TOMBENT, LA SIENNE COMPRISE. C'est ce qu'on attend
       * d'un changement de mot de passe : les appareils déjà entrés perdent la
       * porte. L'écran le DIT et renvoie à la connexion — personne n'est mis
       * dehors sans explication.
       */
      fermerLesSessions(compte.id);
      return { ok: true, reconnexion: true };
    }

    /* ---------------- Les accès ---------------- */

    case 'comptes.lister':
      return { comptes: listerComptes() };

    case 'comptes.creer': {
      // Une adresse mal formée se refuse AVANT de créer : sinon le compte
      // naîtrait sans elle, et l'écran dirait « créé » avec une erreur à côté.
      const verdictCourriel = jugerCourriel(cmd.courriel ?? '');
      if (!verdictCourriel.ok) throw new Error(verdictCourriel.raison);
      const projetsConnus = store.listProjects(true).map((p) => p.id);
      const cree = creerCompte(
        { identifiant: cmd.identifiant, role: 'client', nomAffiche: cmd.nomAffiche, projets: cmd.projets },
        projetsConnus,
      );
      const compteCree = cmd.courriel?.trim() ? changerLeCourriel(cree.compte.id, cmd.courriel) : cree.compte;
      bus.emit({ type: 'comptes', comptes: listerComptes() });
      /*
       * LE COURRIEL D'IDENTIFIANTS NE PART QUE SUR CASE COCHÉE. Un envoi raté ne
       * défait pas le compte : l'écran montre le mot de passe comme d'habitude,
       * et dit en clair que le courriel n'est pas parti, avec la cause.
       */
      const courriel = cmd.envoyerIdentifiants
        ? await envoyerLesIdentifiants({
            envoyer: true,
            courriel: compteCree.courriel,
            nom: nomDuCompte(compteCree),
            identifiant: compteCree.identifiant,
            motDePasse: cree.motDePasse,
          })
        : undefined;
      // Le mot de passe est rendu UNE seule fois, à celui qui vient de le créer.
      return { compte: compteCree, motDePasse: cree.motDePasse, courriel };
    }

    case 'comptes.portee': {
      const projetsConnus = store.listProjects(true).map((p) => p.id);
      const compteMaj = changerLaPortee(cmd.id, cmd.projets, projetsConnus);
      bus.emit({ type: 'comptes', comptes: listerComptes() });
      return { compte: compteMaj };
    }

    case 'comptes.courriel': {
      const compteMaj = changerLeCourriel(cmd.id, cmd.courriel);
      bus.emit({ type: 'comptes', comptes: listerComptes() });
      return { compte: compteMaj };
    }

    case 'comptes.renommer': {
      const compteMaj = renommerCompte(cmd.id, cmd.nomAffiche);
      bus.emit({ type: 'comptes', comptes: listerComptes() });
      return { compte: compteMaj };
    }

    case 'comptes.suspendre': {
      const compteMaj = suspendreCompte(cmd.id, cmd.suspendu);
      bus.emit({ type: 'comptes', comptes: listerComptes() });
      bus.toast('info', cmd.suspendu ? 'Accès suspendu — les sessions ouvertes sont coupées.' : 'Accès réactivé.');
      return { compte: compteMaj };
    }

    case 'comptes.motDePasse': {
      const motDePasse = reinitialiserLeMotDePasse(cmd.id);
      bus.emit({ type: 'comptes', comptes: listerComptes() });
      return { motDePasse };
    }

    case 'comptes.retirer': {
      const vise = compteParId(cmd.id);
      if (!vise) throw new Error('Ce compte est introuvable.');
      retirerLAcces(cmd.id);
      bus.emit({ type: 'comptes', comptes: listerComptes() });
      bus.toast('info', `Accès de « ${nomDuCompte(vise)} » retiré. Ses demandes restent lisibles.`);
      return { ok: true };
    }

    default: {
      const exhaustive: never = cmd;
      throw new Error(`commande inconnue : ${JSON.stringify(exhaustive)}`);
    }
  }
}
