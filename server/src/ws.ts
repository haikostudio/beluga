import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  Agent,
  JALON_PLAN_DEMANDE,
  agentTientSonTour,
  basculerSupposition,
  consigneDAffinageDuPlan,
  consigneDuConducteur,
  publicationTerminee,
  consigneDeRenduDuPlan,
  consigneDePlanDansLeMemeTour,
  comprehensionPourLePlan,
  reglagesDeLaCarte,
  demandeDuGeste,
  comprehensionValideePourLaVersionCourante,
  RAISON_REGLAGES_VALIDES,
  comprehensionARattraper,
  LABEL_AUTO_AMELIORATION,
  REFUS_PLAN_SANS_COMPREHENSION,
  CONSIGNE_COMPREHENSION_REDEMANDEE,
  numeroDuProchainPlan,
  noteDeQualite,
  tendancesParJour,
  resumeDeTendance,
  JOURS_DE_TENDANCE,
  JETONS_DE_REFERENCE,
  COLONNE_DE_FIN_DE_TOUR,
  SECONDES_DE_REFERENCE,
  COLONNES_HORS_REPRISE,
  COLUMN_LABELS,
  ERREURS_MONTREES_REGLAGES,
  JOURS_DE_CACHE,
  partRelueAuCache,
  Card,
  ClientEnvelope,
  ColumnKey,
  PROTOCOL_VERSION,
  Project,
  RunConfig,
  ServerEvent,
  TaskProposal,
  canMove,
  COLONNES_AVANT_LE_TRAVAIL,
  cadrageRouvertApresRapport,
  carteEnCadrage,
  messageDeLaCarteVaAuCadrage,
  messageOuvreUneNouvelleCarte,
  gesteDuDepot,
  etapeDeLaColonne,
  etatVisuelCarte,
  heritageAnalyseDeProposition,
  sortieAutorisee,
  RAISON_SUSPENDU,
  RAISON_ARRETE_A_LA_MAIN,
  arretDeCarteAutorise,
  bilanDesArrets,
  agentApresNouveauDepart,
  comptePrecedents,
  messagesDepuis,
  peutRepartir,
  accorderRunDeProposition,
  CLE_PROJET_ACTIF,
  agentsDuPremierEnvoi,
  agentPourLEcran,
  agentsUtilesAuTableau,
  FRAICHEUR_AGENT_MS,
  choisirProjetAOuvrir,
  lireLienGithub,
  REFUS_LIEN_MAL_FORME,
  filAvecLaSynthese,
  reponseParLaBarre,
  texteRepondALaQuestion,
  motDeContexteDeCommande,
  programmerLeDepart,
  ROUTE_TERMINAL,
  REFUS_HORS_PORTEE,
  commandeAutorisee,
  evenementAutorise,
  type CompteUtilisateur,
  fusionDesProcedures,
} from '@beluga/shared';
import { catalogueMoteurs } from './catalogue-moteurs.js';
import * as store from './store.js';
import { bus } from './bus.js';
import { deplacerLaCarteVersProjet } from './deplacement-vers-projet.js';
import { ajouterAuJournal, journalDeLaCarte, phaseDeLaCarte } from './journal-carte.js';
import { copiesMortesDuProjet, nettoyerLesCopies } from './dossier-de-carte.js';
import { CONFIG } from './config.js';
import { identiteDeLaRequete } from './http.js';
import {
  commandeDeLEspaceClient,
  compteVisible,
  monProfil,
  compteursDeLaMessagerieDe,
  estCommandeDeLEspace,
  evenementPourCeClient,
  type CommandeDeLEspace,
} from './espace-commandes.js';
import { cachedEngines, enginesFrais, listEngines } from './engines/index.js';
import { normaliseThinking } from './engines/catalog.js';
import {
  cachedQuotas,
  cleDuCompteCursor,
  declarerCleCursor,
  remplacerCleDuCompte,
  declarerCleDeMoteur,
  listAccountRecords,
  refreshQuotas,
  renameAccount,
  reglerForfaitMensuel,
  retirerCompte,
  setAccountDisabled,
} from './accounts.js';
import { creditCursor, etatDuCompteCursor } from './engines/cursor.js';
import { annulerConnexion, connexionsEnCours, demarrerConnexion, envoyerCode } from './connexion-compte.js';
import { reprendreSurCompte } from './reprise-compte.js';
import { repondreErreurDeTour } from './erreur-de-tour.js';
import { supprimerLaCarte } from './suppression-carte.js';
import { etatCapacite, listProcesses, controlProcess } from './capacity.js';
import {
  createAgent,
  sendPrompt,
  stopAgent,
  arreterLAgent,
  stopAllAgents,
  comptesOccupes,
  isRunning,
  agentsActifs,
} from './runtime.js';
import {
  agentDeCadrage,
  cadrageDeLaCarte,
  lancerLeCadrageDeLaProposition,
  ouvrirLeCadrage,
  ouvrirUneNouvelleCarteDepuis,
  rouvrirLeCadrage,
} from './cadrage.js';
import { relancerLaRedaction } from './redaction-de-demande.js';
import { rattraperLeCadrageDeLaNuit } from './auto-amelioration.js';
import { rattraperLaCarteSansCadrage, relancerLeCadrageJamaisParti } from './naissance-de-carte.js';
import { getMeta, setMeta } from './db.js';
import { deposerDemandeDictee, repondreALaDictee } from './routage-vocal.js';
import { contexteDeConfiguration, etatDeProcedure, tourDeProcedure } from './procedure-publication.js';
import {
  agentAssistantGlobal,
  estAssistantGlobal,
  poserLeModeleDeDepart,
  reglageDuNiveau,
  reglerLeNiveau,
  reglerValidationAutomatique,
  validationAutomatique,
} from './assistant-global.js';
import {
  agentAjoutDeMoteur,
  carteDeLAjout,
  eprouverDepuisLesReglages,
  estAgentAjoutDeMoteur,
  listerFiches,
  retirerMoteur,
  suivreLaCarteDeLAgent,
} from './moteurs-ajoutes.js';
import {
  ajouterAuRegroupement,
  creerRegroupement,
  renommerRegroupement,
  retirerDuRegroupement,
  separerLeRegroupement,
} from './regroupements.js';
import { appliquerChiffrageDiscute, ecartChiffrage, startCard, tick, validerCarte, validerLaComprehension } from './scheduler.js';
import { createCard } from './tools.js';
import { iconeManquante, recupererFaviconEnTache } from './favicon.js';
import {
  deployableCards,
  startDeploy,
  stopDeploy,
  retryDeploy,
  conflitsPrevus,
  agentsOccupes,
  commitsEnAttente,
  ficherLeTravailSansCarte,
  moyenDeMiseEnLigne,
  blocageMiseEnProduction,
  avertissementsDeLaSelection,
  etatDeLaProduction,
  depotsTouchesParLesCartes,
} from './deploy.js';
import { reconcilierLaCarte } from './rattrapage-ecartee.js';
import { rangerLaCarte, suspendreLaCarte } from './deplacement-carte.js';

import { fermerLesQuestionsDeLaCarte } from './fermeture-questions.js';
import { annulerLAttente, questionEnAttenteDeLAgent, repondreALAttente } from './attente-question.js';
import { archiveCard } from './archive.js';
import { etatDemon, demanderRedemarrage } from './demon.js';
import { creerCleApi, listerClesApi, oublierCleApi, revoquerCleApi } from './cles-api.js';
import { enregistrerAcces, listerAcces, listerArchives, restaurerAcces, supprimerAcces } from './coffre-fort.js';
import { phrasePourLEcran } from './explication-d-erreur.js';
import { enregistrerNote, listerNotes, piecesDesNotes, supprimerNote } from './notes.js';
import { etatDuJuge, listerLesTraces } from './jugement-rapide.js';
import {
  ajouterSite,
  listerControles,
  listerSites,
  lireSurveillance,
  rattacherLeProjetDuSite,
  supprimerSite,
  verifierSites,
} from './surveillance.js';
import { lancerAssistantDeSurveillance } from './assistant-surveillance.js';
import { lancerAgentMarketing } from './assistant-marketing.js';
import {
  changerEtape as changerEtapeMarketing,
  creerContenu as creerContenuMarketing,
  ecrireConfiguration as ecrireConfigurationMarketing,
  ecrireAction as ecrireActionMarketing,
  ecrireFiche as ecrireFicheMarketing,
  ecrireActif as ecrireActifMarketing,
  espaceComplet as espaceMarketingComplet,
  marquerActionFaite as marquerActionFaiteMarketing,
  modifierContenu as modifierContenuMarketing,
  supprimerContenu as supprimerContenuMarketing,
  vueDEnsemble as vueDEnsembleMarketing,
  joursDeTendance as joursDeTendanceMarketing,
  estAgentMarketing,
} from './marketing.js';
import { depannerLaPublication } from './depannage-publication.js';
import {
  enregistrerSite,
  listerPoints,
  listerSites as listerSitesBackups,
  dossierDeStockage as dossierDeStockageBackups,
  passageDesBackups,
  prendreUnBackup,
  projetsSansFiche,
  restaurationsEnCours,
  restaurerUnBackup,
  backupsEnCours,
  supprimerSite as supprimerSiteBackup,
} from './backups.js';
import { lancerAssistantDeBackup, lancerRelectureDeBackup } from './assistant-backup.js';
import {
  compterErreursInterface,
  dernieresErreursInterface,
  effacerErreursInterface,
} from './erreurs-interface.js';
import { listDir, makeZip } from './files.js';
import { mintDownload } from './auth.js';
import {
  chercherUnitesMelees,
  confirmerUnite,
  dernierRapportDeGeneration,
  corrigerEntreeDuChangelog,
  entreesDuChangelog,
  lierLesCartes,
  importerLesLots,
  lireUnite,
  listerLesPortees,
  markdownDeLaPortee,
  nomDeLaPortee,
  oublierLesLectures,
  proposerUnite,
  refusRecents,
  unitesDeLaFiche,
  unitesDeLaPortee,
  versionsDeLUnite,
} from './connaissances.js';
import { generationEnCours, lancerLaGeneration } from './generation-connaissances.js';
import { carteEnPublication, TEXTE_CARTE_EN_PUBLICATION } from '@beluga/shared';
import { PORTEE_GLOBALE, ficheDeLUnite, fichesDeLaPortee } from '@beluga/shared';
import { detailPourCetEcran, elargirLePerimetre } from './perimetre-ecran.js';
import { consigneAjoutDeMoteur, rappelAjoutDeMoteur } from '@beluga/shared';
import {
  FICHES_DES_USAGES,
  USAGES_JUGE,
  type UsageDuJuge,
  basculerUsage,
  basculerUsageAllume,
  bilanDesTraces,
  usageAllume,
} from '@beluga/shared';
import { dossierDesCompetences } from './competences.js';
import { relevesDesCommandes } from './commandes-slash.js';
import { scanProjects, registerProject, createProjectFolder } from './projects.js';
import { depotsDuCompte, monterDepuisGithub } from './depots-github.js';
import * as billing from './billing.js';
import * as github from './github.js';
import { runBackup, listBackups, verifyBackup } from './backup.js';
import { etatDesCategories, exporterDonnees, importerDonnees, lireDepot } from './export-donnees.js';
import { digestText, listVoices } from './voice.js';
import { notify } from './notify.js';
import { attacherLaVoieDuTerminal } from './ws-terminal.js';
import { log } from './logger.js';

/**
 * LE CANAL TEMPS RÉEL PART COMPRESSÉ. Tout ce que l'écran reçoit passe par
 * ici en JSON — le premier envoi, les cartes, les fils de conversation — et
 * du JSON se compresse cinq à dix fois. L'extension `permessage-deflate` est
 * proposée par le navigateur lui-même à l'ouverture ; un client qui ne la
 * demande pas (un vieux script) reçoit du texte brut, comme avant.
 *
 * Sans conservation de contexte entre les messages : chaque message se
 * compresse seul, ce qui borne la mémoire par connexion à quelques dizaines
 * de kilo-octets au lieu d'une fenêtre de compression par client. En dessous
 * du seuil, un message (un accusé, un battement) part tel quel.
 */
export const COMPRESSION_DU_CANAL = {
  threshold: 1024,
  serverNoContextTakeover: true,
  clientNoContextTakeover: true,
  zlibDeflateOptions: { level: 6, memLevel: 8 },
  concurrencyLimit: 4,
} as const;

export function attachWebSocket(server: http.Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: COMPRESSION_DU_CANAL });
  // La voie du TERMINAL est une seconde salle, sur le même palier : même mur
  // d'accès, mais un flot d'octets qui n'a rien à faire dans le protocole de
  // l'application (`server/src/ws-terminal.ts`).
  const wssTerminal = attacherLaVoieDuTerminal();

  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/ws')) {
      socket.destroy();
      return;
    }
    const compte = identiteDeLaRequete(req);
    if (!compte) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    const chemin = req.url.split('?')[0];
    if (chemin === ROUTE_TERMINAL) {
      /*
       * LE TERMINAL EST UNE PORTE D'ADMINISTRATION, ET RIEN D'AUTRE. Un compte
       * client n'y entre jamais : c'est un shell sur le serveur.
       */
      if (compte.role !== 'admin') {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      wssTerminal.handleUpgrade(req, socket, head, (ws) => wssTerminal.emit('connection', ws, req));
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, compte));
  });

  wss.on('connection', (ws: WebSocket, _req: http.IncomingMessage, compte: CompteUtilisateur) => {
    /*
     * LE CANAL APPLIQUE LA MÊME GRILLE QUE LES COMMANDES, À L'ENVOI.
     *
     * Le bus diffuse à tout le monde : c'est ici que le tri se fait. Un compte
     * client ne reçoit AUCUN événement d'agent, de carte, de quota ou de
     * publication — et un événement de l'espace client ne part que vers celui
     * qu'il concerne, jamais vers le voisin qui partage son projet.
     */
    /*
     * CE QUE CET ÉCRAN REGARDE (`shared/src/perimetre-ecran.ts`). Le détail du
     * travail d'un agent — son fil qui s'écrit, sa file, le journal et le
     * carnet de sa carte — ne part que vers l'écran qui affiche son projet ou
     * qui a demandé cette conversation. Tout le reste part comme avant.
     */
    const perimetre = { projet: null as string | null, agents: new Set<string>(), cartes: new Set<string>() };
    const send = (event: ServerEvent) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (!evenementAutorise(compte.role, event.type)) return;
      if (compte.role === 'client' && !evenementPourCeClient(event, compte)) return;
      if (compte.role !== 'client' && !detailPourCetEcran(event, perimetre)) return;
      /*
       * UN ÉVÉNEMENT QUI NOMME SON DESTINATAIRE NE VA QU'À LUI — administrateur
       * compris. L'écran de Haiko recevait les chiffres des pastilles de TOUS
       * les clients, et le dernier arrivé écrasait le sien.
       */
      const pour = (event as { pour?: unknown }).pour;
      if (typeof pour === 'string' && pour && pour !== compte.id) return;
      ws.send(JSON.stringify(evenementPourLEcran(event)));
    };
    const unsubscribe = bus.subscribe(send);

    /*
     * UN CLIENT NE REÇOIT PAS LE PREMIER ENVOI DE L'ADMINISTRATION. Ni projets,
     * ni moteurs, ni quotas, ni capacité : son écran n'en montre rien, et le
     * lui envoyer serait le lui livrer. Il reçoit son propre état, et lui seul.
     */
    if (compte.role === 'client') {
      /*
       * SA PROPRE FICHE, PAS CELLE QU'ON MONTRE AUX AUTRES : son apparence part
       * avec son identité, dès le premier envoi. C'est ce qui évite un aller-
       * retour de plus — donc un flash de thème — avant le premier affichage.
       */
      send({ type: 'ready.client', protocol: PROTOCOL_VERSION, version: CONFIG.version, moi: monProfil(compte) } as unknown as ServerEvent);
      ws.on('message', async (raw) => {
        let envelope: ClientEnvelope;
        try {
          envelope = ClientEnvelope.parse(JSON.parse(raw.toString()));
        } catch (err) {
          log.warn('message client illisible', err);
          return;
        }
        try {
          if (!commandeAutorisee(compte.role, envelope.cmd.type)) throw new Error(REFUS_HORS_PORTEE);
          const data = await handleCommand(envelope.cmd, compte);
          if (envelope.id) send({ type: 'ack', id: envelope.id, ok: true, data });
        } catch (err: any) {
          const brut = err?.message ?? String(err);
          log.warn(`commande client ${envelope.cmd.type} refusée :`, brut);
          if (envelope.id) send({ type: 'ack', id: envelope.id, ok: false, error: await phrasePourLEcran(brut, envelope.cmd.type) });
        }
      });
      ws.on('close', unsubscribe);
      ws.on('error', () => unsubscribe());
      return;
    }

    /*
     * LE PREMIER ENVOI NE FAIT PLUS ATTENDRE L'ÉCRAN.
     *
     * Rien ne s'affiche tant que `ready` n'est pas arrivé : la colonne de
     * gauche et le tableau restent sur leurs silhouettes. Ce message attendait
     * pourtant le CATALOGUE DES MOTEURS (trois exécutables lancés et des appels
     * réseau, mesurés à 7,5 secondes) et, cache vide, une tournée de quotas —
     * deux choses dont le tableau n'a nul besoin pour se dessiner. On envoie
     * donc ce qu'on sait déjà, tout de suite, et le reste suit par ses propres
     * événements (`engines`, `quotas`), que l'interface reçoit déjà.
     *
     * Le premier envoi est aussi ALLÉGÉ (`shared/src/premier-envoi.ts`) : les
     * agents utiles et les décisions encore ouvertes, au lieu de l'historique
     * entier du serveur — près d'un mégaoctet à télécharger avant la première
     * carte, sur un téléphone.
     */
    const decisions = store.decisionsEnAttente();
    send({ type: 'attention', ...store.signalAttention(decisions) });
    send({ type: 'rendus', byProject: store.projectsWithFinishedWork() });
    // L'état des sites surveillés : quelques lignes de base, et c'est lui qui
    // allume la pastille du menu avant même qu'on ouvre la fenêtre.
    send({ type: 'surveillance', sites: listerSites() });
    // Les deux compteurs de la Messagerie : deux lectures de base, et la ligne
    // de la colonne de gauche est juste avant même qu'on ouvre l'espace client.
    try {
      send({ type: 'espace.compteurs', pour: compte.id, ...compteursDeLaMessagerieDe(compte) });
    } catch (err) {
      log.warn('compteurs de la Messagerie illisibles', err);
    }
    const projets = store.listProjects();
    const prefs = store.readPreferences();
    // Le même choix que fera le navigateur : ses cartes partent donc SANS
    // attendre qu'il les demande — un aller-retour de moins avant le tableau.
    const choix = choisirProjetAOuvrir(projets, prefs[CLE_PROJET_ACTIF]);
    const projetOuvert = choix.id && store.getProject(choix.id) ? choix.id : null;
    perimetre.projet = projetOuvert;

    send({
      type: 'ready',
      protocol: PROTOCOL_VERSION,
      version: CONFIG.version,
      settings: store.getSettings(),
      prefs,
      projects: projets,
      groups: store.listGroups(),
      engines: cachedEngines(),
      moteursAjoutes: listerFiches(),
      quotas: cachedQuotas(),
      capacity: etatCapacite(),
      // Les agents au travail et ceux qui viennent de finir, tous projets
      // confondus ; ceux du projet ouvert arrivent avec ses cartes, juste après.
      agents: agentsDuPremierEnvoi(store.agentsActifsOuRecents(Date.now() - FRAICHEUR_AGENT_MS), null, Date.now()),
      openedProjectId: projetOuvert ?? undefined,
    });

    if (projetOuvert) send(instantaneDuProjet(projetOuvert));

    // Ce qui manquait au premier envoi arrive dès qu'il est prêt, par les
    // événements que l'interface écoute déjà. Une panne ici n'a jamais empêché
    // le tableau de s'afficher : elle se journalise, elle ne remonte pas.
    void (async () => {
      try {
        if (!enginesFrais()) send({ type: 'engines', engines: await listEngines() });
        if (!cachedQuotas().length) send({ type: 'quotas', quotas: await refreshQuotas() });
      } catch (err) {
        log.warn('premier envoi : moteurs ou quotas indisponibles', err);
      }
    })();

    ws.on('message', async (raw) => {
      let envelope: ClientEnvelope;
      try {
        envelope = ClientEnvelope.parse(JSON.parse(raw.toString()));
      } catch (err) {
        log.warn('message client illisible', err);
        return;
      }
      try {
        if (!commandeAutorisee(compte.role, envelope.cmd.type)) throw new Error(REFUS_HORS_PORTEE);
        // AVANT la commande : sa réponse passe déjà par le périmètre mis à jour.
        elargirLePerimetre(perimetre, envelope.cmd);
        const data = await handleCommand(envelope.cmd, compte);
        if (envelope.id) send({ type: 'ack', id: envelope.id, ok: true, data });
      } catch (err: any) {
        log.warn(`commande ${envelope.cmd.type}${contexteDeCommande(envelope.cmd)} refusée :`, err?.message ?? err);
        /* LE REFUS PART EN PHRASE SIMPLE : un message écrit par la machine
           (code système, sortie de git, trace) est traduit par sa famille,
           ou par Laya s'il est inconnu (`explication-d-erreur.ts`). Le
           texte brut reste au journal, juste au-dessus. */
        if (envelope.id)
          send({ type: 'ack', id: envelope.id, ok: false, error: await phrasePourLEcran(err?.message ?? String(err), envelope.cmd.type) });
      }
    });

    ws.on('close', unsubscribe);
    ws.on('error', () => unsubscribe());
  });

  return wss;
}

/* ------------------------------------------------------------------ */
/* Traitement des commandes                                            */
/* ------------------------------------------------------------------ */

/**
 * Le contexte d'une commande refusée, pour le journal : la carte visée et son
 * projet. Sans lui, un refus de lancement ne disait pas sur quel dépôt il
 * portait, et il fallait deviner. Une commande qui ne vise aucune carte connue
 * n'ajoute rien : le nom seul de la commande reste lisible.
 */
function contexteDeCommande(cmd: ClientEnvelope['cmd']): string {
  const id = (cmd as { id?: unknown; cardId?: unknown }).cardId ?? (cmd as { id?: unknown }).id;
  if (typeof id !== 'string') return '';
  try {
    const carte = store.getCard(id);
    if (!carte) return '';
    const projet = store.getProject(carte.projectId);
    return motDeContexteDeCommande({ carte: carte.title, projet: projet?.name });
  } catch {
    return '';
  }
}

/**
 * La conversation d'un agent telle qu'elle doit s'afficher : depuis le dernier
 * nouveau départ, avec le compte de ce qui dort derrière. `tout` rouvre le fil
 * entier — rien n'ayant jamais été supprimé, il est toujours là.
 */
function envoyerConversation(agentId: string, tout = false): void {
  const messages = store.listMessages(agentId);
  const depuis = store.nouveauDepart(agentId);
  bus.emit({
    type: 'agent.etat',
    agentId,
    messages: tout ? messages : messagesDepuis(messages, depuis),
    queue: store.listQueue(agentId),
    precedents: comptePrecedents(messages, depuis),
  });
}

/**
 * Marquer une carte comme lue, et rediffuser le compte des pastilles. Deux
 * chemins y mènent : ouvrir sa conversation, ou le dire explicitement.
 */
function marquerLue(cardId: string): void {
  const carte = store.markCardRead(cardId);
  if (!carte) return;
  bus.emit({ type: 'card.upsert', card: carte });
  bus.emit({ type: 'rendus', byProject: store.projectsWithFinishedWork() });
  /* La lecture éteint AUSSI le repère du geste attendu : il ne tient qu'à la
     date de consultation de la carte (`gesteEnAttente`, `shared`). */
  bus.emit({ type: 'attention', ...store.signalAttention() });
}

/**
 * Le geste inverse : « Marquer comme non lu ». Les MÊMES trois diffusions,
 * pour que la pastille de la carte, le compteur du projet et la cloche
 * (le geste attendu dépend aussi de la lecture) se rallument ensemble.
 */
function marquerNonLue(cardId: string): boolean {
  const carte = store.markCardUnread(cardId);
  if (!carte) return false;
  bus.emit({ type: 'card.upsert', card: carte });
  bus.emit({ type: 'rendus', byProject: store.projectsWithFinishedWork() });
  bus.emit({ type: 'attention', ...store.signalAttention() });
  return true;
}

/**
 * L'INSTANTANÉ D'UN PROJET : la première tranche de chaque colonne, le total
 * réel de chacune, et les seuls agents utiles au tableau
 * (`shared/src/tranches-de-cartes.ts`). Le même envoi à la connexion et à
 * l'ouverture d'un projet.
 */
function instantaneDuProjet(projectId: string): Extract<ServerEvent, { type: 'project.etat' }> {
  const projet = store.getProject(projectId)!;
  const { cards, totaux } = store.premiereTrancheDeCartes(projectId);
  const maintenant = Date.now();
  const envoyees = new Set(cards.map((card) => card.id));
  const agents = agentsUtilesAuTableau(
    store.agentsDuTableau(projectId, [...envoyees], maintenant - FRAICHEUR_AGENT_MS),
    envoyees,
    maintenant,
  );
  return {
    type: 'project.etat',
    projectId,
    cards,
    agents,
    totaux,
    deploy: store.latestDeploy(projectId) ?? undefined,
  };
}

/**
 * CE QUI PART VERS L'ÉCRAN EST ALLÉGÉ AU DERNIER MOMENT : le résumé de
 * continuité des agents (`agentPourLEcran`) ne sert qu'au moteur. Une seule
 * porte de sortie pour tous les événements, quel que soit celui qui les émet.
 */
function evenementPourLEcran(event: ServerEvent): ServerEvent {
  switch (event.type) {
    case 'ready':
      return { ...event, agents: event.agents.map(agentPourLEcran) };
    case 'project.etat':
      return { ...event, agents: event.agents.map(agentPourLEcran) };
    case 'agent.upsert':
      return { ...event, agent: agentPourLEcran(event.agent) };
    case 'card.conversation':
      return event.agents ? { ...event, agents: event.agents.map(agentPourLEcran) } : event;
    default:
      return event;
  }
}

/**
 * « GÉNÉRER LE PLAN » : le geste qui ferme le cadrage, écrit UNE SEULE FOIS.
 *
 * Le démon marque la demande sur la carte (`planDemandeA`), la fait entrer en
 * « Plan », pose le jalon, et envoie à l'agent de cadrage une consigne INTERNE
 * qui lui demande le plan par l'outil `rendre_plan` — jamais un faux message de
 * l'utilisateur dans le fil. Le tour s'écrit ensuite comme les autres, et la
 * fin du tour vérifie que le plan est venu (`planManquant`, `runtime.ts`).
 *
 * POURQUOI UNE FONCTION, ET PLUS UN CORPS DE « CASE » : deux gestes mènent ici
 * — le bouton « Générer le plan » (commande `plan.generer`) et le DÉPÔT d'une
 * carte de « Demande » dans « Plan » (`gesteDuDepot`). Recopier ce corps dans
 * la commande de déplacement, c'est se garantir qu'un jour l'un des deux
 * chemins oubliera le jalon ou la consigne. Ses refus REMONTENT tels quels :
 * un dépôt qui ne peut pas demander le plan ne déplace rien en silence.
 */
export async function demanderLePlan(cardId: string): Promise<{ ok: true; numero?: number; deja?: true }> {
  const card = store.getCard(cardId);
  if (!card) throw new Error('carte introuvable');
  /* « Demande » ou « Plan » — une carte relancée y est aussi, et en sort par
     le même chemin (`shared/src/relance-apres-rapport.ts`). « Rapport » rouvert
     reste accepté pour une carte d'avant le rattrapage, sans la déplacer. */
  if (!carteEnCadrage(card)) {
    throw new Error('le plan ne se demande que sur une carte encore en cadrage');
  }
  const cadrage = cadrageRouvertApresRapport(card) ? cadrageDeLaCarte(card.id) : agentDeCadrage(card.id);
  if (!cadrage) throw new Error('cette carte n’a pas d’agent de cadrage');
  if (isRunning(cadrage.id)) throw new Error('attendez la fin de la réponse en cours');
  if (card.parcours?.planDemandeA) return { ok: true, deja: true };
  /* Pas de plan sans compréhension : le démon le garde lui-même, quel que soit
     le bouton qui l'a demandé (incident, dépôt, vieux client). */
  if (!comprehensionPourLePlan(card)) throw new Error(REFUS_PLAN_SANS_COMPREHENSION);
  const numero = numeroDuProchainPlan(card.parcours?.plans);
  /*
   * LA CARTE NE BOUGE PAS. Elle reste où elle est — « Demande » — pendant que
   * le plan s'écrit : ce qui dit qu'un tour tourne, c'est l'indicateur
   * d'activité de la colonne et l'étape « Plan » du parcours, pas un
   * déplacement de carte. Seule la MARQUE `planDemandeA` est posée.
   */
  const marquee = store.saveCard({
    ...card,
    parcours: { ...(card.parcours ?? { plans: [] }), planDemandeA: Date.now(), incident: undefined },
  });
  bus.emit({ type: 'card.upsert', card: marquee });
  const jalon = ajouterAuJournal({
    cardId: card.id,
    phase: phaseDeLaCarte(card.id, cadrage.role),
    nature: 'jalon',
    libelle: JALON_PLAN_DEMANDE,
    agentId: cadrage.id,
    agentRole: cadrage.role,
    resultat: numero > 1 ? `Version ${numero} demandée.` : 'Première version demandée.',
    reussie: true,
  });
  if (jalon) bus.emit({ type: 'journal.entree', entree: jalon });
  /* UNE VERSION SUIVANTE S'AFFINE, ELLE NE REPART PAS DE ZÉRO : le clic sur
     une carte qui porte déjà un plan demande la version suivante ENTIÈRE. */
  const consigne = numero > 1 ? consigneDAffinageDuPlan(numero) : consigneDeRenduDuPlan(numero);
  void sendPrompt(cadrage.id, consigne, { silent: true }).catch((err) => {
    log.error('demande de plan impossible', err);
    const fraiche = store.getCard(card.id);
    if (fraiche?.parcours?.planDemandeA) {
      /* La demande n'est jamais partie : la marque de plan en cours se retire,
         sinon le flux annoncerait un plan que personne n'écrit. */
      const rangee = store.saveCard({
        ...fraiche,
        parcours: { ...fraiche.parcours, planDemandeA: undefined },
      });
      bus.emit({ type: 'card.upsert', card: rangee });
    }
  });
  return { ok: true, numero };
}

/**
 * L'INTERRUPTEUR « PLAN » EST-IL ALLUMÉ SUR LA CARTE DE CET AGENT ?
 *
 * Si oui, la demande de plan est MARQUÉE sur la carte (même drapeau que le
 * clic d'autrefois : le flux dit « plan en cours », l'outil `rendre_plan` le
 * retire, et un tour qui ne le rend pas est relancé puis porte un incident) et
 * la consigne du plan est rendue pour partir EN CONTEXTE du même tour.
 *
 * Rien n'est marqué quand une demande est déjà en cours, quand la carte n'est
 * plus en cadrage, ou quand aucune compréhension n'existe encore — la règle
 * « pas de plan sans compréhension » ne bouge pas.
 */
function annoncerPlanDuMemeTour(
  agent: { id: string; role: string; cardId?: string },
): { consigne: string; noterLeJalon: () => void } | undefined {
  if (agent.role !== 'cadrage' || !agent.cardId) return undefined;
  const card = store.getCard(agent.cardId);
  if (!card?.parcours?.planSouhaite) return undefined;
  if (card.parcours.planDemandeA) return undefined;
  if (!carteEnCadrage(card)) return undefined;
  const numero = numeroDuProchainPlan(card.parcours?.plans);
  const marquee = store.saveCard({
    ...card,
    parcours: { ...card.parcours, planDemandeA: Date.now(), incident: undefined },
  });
  bus.emit({ type: 'card.upsert', card: marquee });
  /* Le jalon s'écrit DERRIÈRE la ligne « Demande » du même message
     (`apresLaDemande` de `sendPrompt`) : écrit ici, il la précédait de
     quelques millisecondes et le passage du plan s'ouvrait au-dessus d'elle. */
  const noterLeJalon = (): void => {
    const jalon = ajouterAuJournal({
      cardId: card.id,
      phase: phaseDeLaCarte(card.id, agent.role),
      nature: 'jalon',
      libelle: JALON_PLAN_DEMANDE,
      agentId: agent.id,
      agentRole: agent.role,
      resultat: numero > 1 ? `Version ${numero} demandée.` : 'Première version demandée.',
      reussie: true,
    });
    if (jalon) bus.emit({ type: 'journal.entree', entree: jalon });
  };
  return { consigne: consigneDePlanDansLeMemeTour(numero), noterLeJalon };
}

/**
 * « REDEMANDER LA COMPRÉHENSION » : le bouton de l'incident d'une carte dont le
 * cadrage n'a jamais rendu sa compréhension. Un tour INTERNE à l'agent de
 * cadrage, sans bulle d'utilisateur ; le plan existant n'est pas touché. La fin
 * du tour juge la compréhension comme pour tout tour de cadrage.
 */
export async function redemanderLaComprehension(cardId: string): Promise<{ ok: true; deja?: true }> {
  const card = store.getCard(cardId);
  if (!card) throw new Error('carte introuvable');
  if (!carteEnCadrage(card)) {
    throw new Error('la compréhension ne se redemande que sur une carte encore en cadrage');
  }
  const cadrage = cadrageRouvertApresRapport(card) ? cadrageDeLaCarte(card.id) : agentDeCadrage(card.id);
  if (!cadrage) throw new Error('cette carte n’a pas d’agent de cadrage');
  if (isRunning(cadrage.id)) return { ok: true, deja: true };
  if (card.parcours?.incident) {
    const rangee = store.saveCard({ ...card, parcours: { ...card.parcours, incident: undefined } });
    bus.emit({ type: 'card.upsert', card: rangee });
  }
  void sendPrompt(cadrage.id, CONSIGNE_COMPREHENSION_REDEMANDEE, { silent: true, template: 'none' }).catch((err) =>
    log.error('demande de compréhension impossible', err),
  );
  return { ok: true };
}

/** Le patch change-t-il vraiment ce avec quoi la carte tournera ? */
function runChange(avant: Card['run'] | undefined, patch: Partial<Card['run']>): boolean {
  return (['engine', 'model', 'thinking', 'account'] as const).some(
    (cle) => cle in patch && (patch as any)[cle] !== (avant as any)?.[cle],
  );
}

async function handleCommand(commande: ClientEnvelope['cmd'], compte: CompteUtilisateur): Promise<unknown> {
  // L'espace client a ses propres commandes, et son propre cloisonnement.
  if (estCommandeDeLEspace(commande)) return commandeDeLEspaceClient(commande, compte);

  const cmd: Exclude<ClientEnvelope['cmd'], CommandeDeLEspace> = commande;
  switch (cmd.type) {
    case 'hello':
    case 'ping':
      return { at: Date.now() };

    // Le périmètre est posé à la réception (`elargirLePerimetre`) : rien d'autre à faire.
    case 'ecran.perimetre':
      return { ok: true };

    /* -------- Projets -------- */

    case 'project.list':
      return { projects: store.listProjects(cmd.includeArchived ?? false) };

    case 'project.archive': {
      const updated = store.mettreProjetDeCote(cmd.id, cmd.archived);
      if (!updated) throw new Error('projet introuvable');
      bus.emit({ type: 'project.upsert', project: updated });
      bus.toast('info', cmd.archived ? `« ${updated.name} » mis de côté` : `« ${updated.name} » remis en service`);
      return { project: updated };
    }

    case 'project.create': {
      const project = registerProject({
        name: cmd.name,
        path: cmd.path,
        gitRemote: cmd.gitRemote,
        defaultEngine: cmd.defaultEngine as any,
        devUrl: cmd.devUrl,
      });
      bus.emit({ type: 'project.upsert', project });
      return { project };
    }

    case 'project.update': {
      const current = store.getProject(cmd.id);
      if (!current) throw new Error('projet introuvable');
      /* Les dépôts annexes ne se règlent plus depuis l'écran (DEC-258) : ce
         patch général ne les touche jamais. */
      const { depots: _depotsIgnores, ...patch } = cmd.patch as Record<string, unknown>;
      /* UNE ADRESSE PUBLIQUE SAISIE OU CHANGÉE n'est plus une adresse
         rattrapée : sa marque tombe, et son suivi part (ci-dessous). */
      const adresseChangee =
        typeof patch.adresseProduction === 'string' && patch.adresseProduction !== (current.adresseProduction ?? '');
      const updated = store.saveProject(
        Project.parse({
          ...current,
          ...patch,
          ...fusionDesProcedures(current, patch),
          ...(adresseChangee ? { adresseProductionRattrapee: undefined } : {}),
          id: current.id,
        }),
      );
      /*
       * L'icône se cherche dès que sa source a bougé — l'adresse OU le dossier
       * du dépôt — et aussi tant qu'aucune n'a été trouvée : un réglage
       * enregistré est le moment où l'utilisateur regarde sa colonne de gauche.
       */
      if (
        updated.devUrl !== current.devUrl ||
        updated.path !== current.path ||
        iconeManquante(updated)
      ) {
        recupererFaviconEnTache(updated);
      }
      bus.emit({ type: 'project.upsert', project: updated });
      /* UNE ADRESSE DE PRODUCTION NOUVELLE OUVRE SON SUIVI tout de suite,
         sans attendre le tour du jour ; la réponse n'attend pas la lecture. */
      if (updated.adresseProduction && updated.adresseProduction !== current.adresseProduction) {
        void import('./suivi-par-defaut.js')
          .then(({ assurerLeSuiviDuProjet }) => assurerLeSuiviDuProjet(updated.id))
          .catch((err) => log.warn('suivi par défaut : relecture du projet impossible', err));
      }
      return { project: updated };
    }

    case 'regroupement.creer': {
      const project = creerRegroupement(cmd.nom, cmd.membres);
      bus.toast('info', `Projets réunis sous « ${project.name} »`);
      return { project };
    }

    case 'regroupement.renommer':
      return { project: renommerRegroupement(cmd.id, cmd.nom) };

    case 'regroupement.ajouter':
      return { projects: ajouterAuRegroupement(cmd.id, cmd.membres) };

    case 'regroupement.retirer':
      return { project: retirerDuRegroupement(cmd.id, cmd.projectId) };

    case 'regroupement.separer': {
      const projects = separerLeRegroupement(cmd.id);
      bus.toast('info', 'Projets séparés : chacun redevient autonome');
      return { projects };
    }

    case 'project.faviconRetry': {
      const project = store.getProject(cmd.id);
      if (!project) throw new Error('projet introuvable');
      // Sans adresse, l'icône se cherche dans le DÉPÔT : ce n'est plus un refus.
      recupererFaviconEnTache(project);
      return { ok: true };
    }

    case 'projet.copiesMortes': {
      /*
       * Les copies de travail que git ne liste plus : lues sur le disque, sous
       * le dossier des copies du projet, jamais effacées ici. C'est l'écran des
       * réglages qui les montre, et un clic explicite qui les nettoie.
       */
      const project = store.getProject(cmd.projectId);
      if (!project) throw new Error('projet introuvable');
      return copiesMortesDuProjet(project.path);
    }

    case 'projet.nettoyerCopies': {
      /*
       * L'effacement ne prend qu'une liste EXPLICITE, et le démon refait le tri
       * (`cheminNettoyable`) : un chemin qui n'est pas posé sous le dossier des
       * copies de CE projet est refusé, quoi qu'ait envoyé le navigateur.
       */
      const project = store.getProject(cmd.projectId);
      if (!project) throw new Error('projet introuvable');
      const bilan = await nettoyerLesCopies(project.path, cmd.chemins);
      if (bilan.effacees.length) log.info(`${bilan.effacees.length} copie(s) morte(s) effacée(s) dans ${project.path}`);
      return bilan;
    }

    case 'project.branches': {
      /*
       * Les branches proposées dans les réglages viennent du DÉPÔT du projet,
       * lues chez GitHub — jamais d'une liste écrite à la main. Un projet sans
       * dépôt joignable rend une liste vide et la raison : le champ reste
       * saisissable, il ne ment pas sur ce qu'il sait.
       */
      const project = store.getProject(cmd.id);
      if (!project) throw new Error('projet introuvable');
      return github.branchesDuDepot(project.path);
    }

    /*
     * UN PROJET NE S'EFFACE PLUS : la commande d'un écran d'avant le 22/09/2026
     * le met de côté, comme « Mettre de côté » (voir `mettreProjetDeCote`).
     */
    case 'project.delete': {
      const updated = store.mettreProjetDeCote(cmd.id);
      if (!updated) throw new Error('projet introuvable');
      bus.emit({ type: 'project.upsert', project: updated });
      bus.toast('info', `« ${updated.name} » mis de côté — rien n'est effacé`);
      return { ok: true, project: updated };
    }

    case 'project.open': {
      if (!store.getProject(cmd.id)) throw new Error('projet introuvable');
      bus.emit(instantaneDuProjet(cmd.id));
      return { ok: true };
    }

    /*
     * LA TRANCHE SUIVANTE D'UNE COLONNE, avec les agents qui portent ces
     * cartes. Réponse directe à qui l'a demandée : aucun autre écran n'a fait
     * défiler cette colonne-là.
     */
    case 'cards.tranche': {
      if (!store.getProject(cmd.projectId)) throw new Error('projet introuvable');
      const tranche = store.trancheDeCartes(cmd.projectId, cmd.column, cmd.avantPosition, cmd.limit);
      const ids = tranche.cards.map((card) => card.id);
      const agents = ids.length ? store.agentsDuTableau(cmd.projectId, ids, Number.MAX_SAFE_INTEGER) : [];
      return {
        cards: tranche.cards,
        agents: agents.filter((agent) => agent.cardId && ids.includes(agent.cardId)).map(agentPourLEcran),
        total: tranche.total,
      };
    }

    /*
     * LA PAGE « EN ROUTE » : tous projets en service confondus, dernière
     * terminée d'abord, par paquet. Réponse directe à qui l'a demandée, avec
     * le début de la demande de chaque carte (`demandes`, par identifiant).
     */
    case 'cards.enRoute': {
      const { cards, restant, curseur } = store.cartesEnRoute(cmd.apres, cmd.limit);
      return {
        cards,
        agents: store.agentsDesCartes(cards).map(agentPourLEcran),
        restant,
        // La clé de la dernière FAMILLE envoyée : la suite se demande sous elle.
        curseur,
        demandes: store.debutsDesDemandesDesCartes(cards),
      };
    }

    /* L'onglet « Terminé » de la même page : ce qui est déjà en ligne. */
    case 'cards.deployees': {
      const { cards, restant, curseur } = store.cartesDeployees(cmd.apres, cmd.limit);
      return {
        cards,
        agents: store.agentsDesCartes(cards).map(agentPourLEcran),
        restant,
        // La clé de la dernière FAMILLE envoyée : la suite se demande sous elle.
        curseur,
        demandes: store.debutsDesDemandesDesCartes(cards),
      };
    }

    case 'project.scan':
      return { found: await scanProjects() };

    case 'group.create': {
      const group = store.saveGroup({
        id: store.newId(),
        name: cmd.name.trim() || 'Nouveau groupe',
        rank: store.nextGroupRank(),
        collapsed: false,
      });
      bus.emit({ type: 'groups', groups: store.listGroups() });
      return { group };
    }

    case 'group.update': {
      const group = store.listGroups().find((g) => g.id === cmd.id);
      if (!group) throw new Error('groupe introuvable');
      const updated = store.saveGroup({
        ...group,
        name: cmd.name?.trim() || group.name,
        collapsed: cmd.collapsed ?? group.collapsed,
        color: cmd.color === '' ? undefined : (cmd.color ?? group.color),
      });
      bus.emit({ type: 'groups', groups: store.listGroups() });
      return { group: updated };
    }

    case 'group.delete': {
      store.deleteGroup(cmd.id);
      bus.emit({ type: 'groups', groups: store.listGroups() });
      for (const project of store.listProjects(true)) bus.emit({ type: 'project.upsert', project });
      return { ok: true };
    }

    case 'sidebar.reorder': {
      // Un seul classement pour les deux familles : le rang dit qui passe
      // devant, qu'il s'agisse d'un projet ou d'un groupe.
      cmd.items.forEach((item, index) => {
        const rank = (index + 1) * 10;
        if (item.kind === 'group') {
          const group = store.listGroups().find((g) => g.id === item.id);
          if (group) store.saveGroup({ ...group, rank });
          return;
        }
        const project = store.getProject(item.id);
        // L'espace de développement reste fixé dans son groupe « Local ».
        if (project?.isSelf) return;
        if (project) {
          store.saveProject({ ...project, rank, groupId: item.groupId || undefined });
        }
      });
      const projects = store.listProjects();
      for (const project of projects) bus.emit({ type: 'project.upsert', project });
      bus.emit({ type: 'groups', groups: store.listGroups() });
      return { projects, groups: store.listGroups() };
    }

    case 'project.new': {
      const { project, etapes } = await createProjectFolder({
        name: cmd.name,
        folder: cmd.folder,
        description: cmd.description,
        git: cmd.git,
        gitRemote: cmd.gitRemote,
        github: cmd.github,
        githubPublic: cmd.githubPublic,
        sousDomaine: cmd.sousDomaine,
        port: cmd.port,
      });
      bus.emit({ type: 'project.upsert', project });
      // Une étape ratée se dit : le projet existe quand même, mais il lui
      // manque quelque chose, et le taire ferait croire que tout est en place.
      const rates = etapes.filter((e) => !e.fait);
      if (rates.length) {
        bus.toast('error', `Projet créé, mais ${rates.length} étape(s) ont échoué`);
      } else {
        bus.toast('success', `Projet « ${project.name} » monté sur le serveur`);
      }
      return { project, etapes };
    }

    case 'github.depots':
      return await depotsDuCompte();

    case 'project.fromGithub': {
      /*
       * Le lien est LU avant toute chose : mal formé, il est refusé ici, sans
       * qu'aucun dossier ne soit touché. Le reste des refus (dépôt introuvable,
       * accès refusé, dépôt vide, projet déjà inscrit) vient du montage.
       */
      const lu = lireLienGithub(cmd.lien);
      if (!lu.ok || !lu.depot) throw new Error(lu.erreur ?? REFUS_LIEN_MAL_FORME);

      const { project, etapes } = await monterDepuisGithub({
        depot: lu.depot,
        nom: cmd.name,
        dossier: cmd.folder,
        sousDomaine: cmd.sousDomaine,
        port: cmd.port,
      });
      bus.emit({ type: 'project.upsert', project });
      const ratees = etapes.filter((e) => !e.fait);
      if (ratees.length) {
        bus.toast('error', `Projet ajouté, mais ${ratees.length} étape(s) ont échoué`);
      } else {
        bus.toast('success', `« ${project.name} » ajouté depuis GitHub`);
      }
      return { project, etapes };
    }

    /* -------- Cartes -------- */

    case 'card.create': {
      const card = createCard(cmd.projectId, {
        title: cmd.title,
        description: cmd.description,
        labels: cmd.labels,
        attachments: cmd.attachments,
        origin: 'user',
        run: cmd.run as any,
        /* Une carte qui ouvre un cadrage n'annonce AUCUN départ : on n'a pas
           encore dit ce qu'elle doit faire (`createCard`). */
        cadrage: cmd.cadrage,
      });
      bus.emit({ type: 'card.upsert', card });
      /*
       * LE « + » DE « PLANIFIÉ » OUVRE UNE CONVERSATION, PAS UN FORMULAIRE. La
       * carte reçoit son agent de CADRAGE — un modèle économe avec qui discuter
       * le besoin dans le fil de la carte. Rien ne part au moteur pour autant :
       * l'agent est créé, il ne parlera qu'au premier message.
       */
      let cadrage: Agent | null = null;
      if (cmd.cadrage) {
        cadrage = await ouvrirLeCadrage(card.id).catch((err) => {
          log.warn('agent de cadrage impossible à ouvrir', err);
          return null;
        });
      }
      return { card, agent: cadrage ?? undefined };
    }

    case 'card.update': {
      const card = store.getCard(cmd.id);
      if (!card) throw new Error('carte introuvable');
      const patch = { ...cmd.patch };
      delete (patch as any).column; // une colonne se change par card.move
      /*
       * LES RÉGLAGES SE FIGENT À LA VALIDATION DE LA COMPRÉHENSION, pas au premier envoi —
       * et le démon le garde lui-même : un réglage changé après « Valider »,
       * ou une fois le travail parti, ferait mentir ce qui a servi.
       */
      if (patch.run && runChange(card.run, patch.run)) {
        const execution = store.agentsDeLaCarte(card.id).some((a) => a.role === 'task');
        const vu = reglagesDeLaCarte({
          colonne: card.column,
          carte: card.run,
          agent: execution ? {} : undefined,
          decisionValidee: comprehensionValideePourLaVersionCourante(card.parcours),
        });
        if (!vu.modifiable) throw new Error(vu.raison ?? RAISON_REGLAGES_VALIDES);
      }
      const title = typeof patch.title === 'string' ? patch.title : card.title;
      const description = typeof patch.description === 'string' ? patch.description : card.description;
      const updated = store.saveCard(Card.parse({
        ...card,
        ...patch,
        ...heritageAnalyseDeProposition(card, title, description),
        id: card.id,
      }));
      bus.emit({ type: 'card.upsert', card: updated });
      /*
       * UN CHOIX MANUEL DE MOTEUR/MODÈLE/RÉFLEXION/COMPTE (`choixDeLaCarte`,
       * `chat.tsx`) VAUT POUR LE PROJET ENTIER : la prochaine carte neuve part
       * sur ce même réglage (`createCard`), sans qu'il faille le reposer à
       * chaque fois. Seul un patch qui touche VRAIMENT `run` déclenche l'écrit
       * — une carte renommée ou déplacée ne doit rien changer aux défauts.
       */
      if (patch.run) {
        const project = store.getProject(card.projectId);
        const run = updated.run;
        if (
          project &&
          (run.engine !== project.defaultEngine ||
            run.model !== project.defaultModel ||
            run.thinking !== project.defaultThinking ||
            run.account !== project.defaultAccount)
        ) {
          const savedProject = store.saveProject({
            ...project,
            defaultEngine: run.engine,
            defaultModel: run.model,
            defaultThinking: run.thinking,
            defaultAccount: run.account,
          });
          bus.emit({ type: 'project.upsert', project: savedProject });
        }

        /*
         * LE FIL DE CADRAGE SUIT SA CARTE. La barre d'écriture d'une carte de
         * cadrage règle `card.run` — le modèle d'EXÉCUTION — pendant que
         * l'agent qui discute gardait le sien : on lisait « Opus » en haut de
         * la discussion alors qu'elle tournait sur Haiku, et le réglage semblait
         * n'avoir aucun effet. Le prochain tour repart désormais sur le modèle
         * affiché, moteur et compte compris.
         */
        const cadrage = agentDeCadrage(card.id);
        if (cadrage) {
          const moteurs = await listEngines();
          const moteur = moteurs.find((e) => e.id === run.engine);
          const agentFrais = store.saveAgent({
            ...cadrage,
            run: {
              ...cadrage.run,
              engine: run.engine,
              model: run.model,
              thinking: normaliseThinking(moteur?.models ?? [], run.model, run.thinking),
              account: run.account,
            } as any,
            // Le fil repart sur un autre modèle : l'ancienne mesure de contexte
            // ne décrit plus celui qui sera utilisé (même règle qu'`agent.config`).
            contextUsage: run.model === cadrage.run.model ? cadrage.contextUsage : undefined,
          });
          bus.emit({ type: 'agent.upsert', agent: agentFrais });
        }
      }
      return { card: updated };
    }

    case 'card.move': {
      const card = store.getCard(cmd.id);
      if (!card) throw new Error('carte introuvable');
      const target = cmd.column as ColumnKey;
      const decision = canMove('user', card.column, target);
      if (!decision.allowed) throw new Error(decision.reason ?? 'déplacement refusé');

      /*
       * Le refus tient AUSSI sans navigateur à jour : une carte ne quitte pas
       * « En cours » pendant que son agent écrit. C'est la même règle que celle
       * du tableau et des boutons du tiroir.
       */
      const agentDeLaCarte = card.agentId ? store.getAgent(card.agentId) : null;
      const sortie = sortieAutorisee(
        {
          colonne: card.column,
          etat: etatVisuelCarte({ agentStatut: agentDeLaCarte?.status }),
          agentLance: !!agentDeLaCarte,
        },
        target,
      );
      if (!sortie.possible) throw new Error(sortie.raison ?? 'déplacement refusé');

      /*
       * Le dépôt VAUT le geste que la colonne d'arrivée désigne. Aucun de ces
       * gestes n'a de chemin à lui : le lancement passe par `startCard` et la
       * demande de plan par `demanderLePlan`, exactement comme les boutons
       * « Lancer maintenant » et « Générer le plan » — mêmes portes dures, même
       * branche, même agent, même trace dans la conversation. Un refus REMONTE,
       * il ne se traduit jamais par un déplacement silencieux qui ne ferait
       * rien.
       */
      const geste = gesteDuDepot(card.column, target);
      const effet = geste.effet;

      /*
       * LE SEUL DÉPÔT REFUSÉ : « Travail » → « Rapport ». Une carte entre en
       * « Rapport » quand son rapport est rendu (`issueDeFinDeTour`), jamais
       * sur un geste. Le refus REMONTE — la carte ne bouge pas d'un pixel — et
       * il vaut pour toutes les mains qui passent par ici : la glisse, le menu
       * de gestes rares, le cran d'avance.
       */
      if (effet === 'refuser') throw new Error(geste.raison ?? 'déplacement refusé');

      if (effet === 'lancer') {
        const result = await startCard(card.id);
        if (!result.ok) throw new Error(result.error ?? 'démarrage impossible');
        return { card: store.getCard(card.id) ?? card };
      }

      /*
       * Sortir une carte de « En cours » vers « Planifié », c'est SUSPENDRE :
       * le tour est arrêté proprement, la carte reste en file avec la raison
       * écrite dessus, et l'ordonnanceur ne la reprend pas de lui-même.
       */
      if (effet === 'suspendre') {
        if (card.agentId && isRunning(card.agentId)) stopAgent(card.agentId);
        // Le rangement lui-même est celui des trois gestes d'arrêt, écrit une
        // seule fois (`suspendreLaCarte`) : c'est ce qui garantit qu'ils
        // laissent tous la carte dans le MÊME état.
        const suspendue = suspendreLaCarte(card, RAISON_SUSPENDU);
        bus.toast('warning', RAISON_SUSPENDU, suspendue.id);
        return { card: suspendue };
      }

      /*
       * Une commande venue du navigateur EST le geste humain : c'est la seule
       * main autorisée à sortir une carte d'une fin de parcours (« Archivé »,
       * « À déployer »). Les chemins automatiques, eux, restent fermés — un
       * tour d'agent par `colonneAuDemarrage`, l'outil du moteur par
       * `repriseAutorisee(…, 'automatique')`. La carte ressortie GARDE sa date
       * d'archivage : on doit pouvoir lire qu'elle était passée par là.
       */
      const sortDuRangement = COLONNES_HORS_REPRISE.includes(card.column);

      /* Le rangement lui-même vit dans `rangerLaCarte` : c'est là que les dates
         qui suivent la colonne (« Terminé », « À déployer ») se posent ou se
         retirent, en un seul endroit rejouable. */
      const updated = rangerLaCarte(card, target, cmd.position);
      bus.emit({ type: 'card.upsert', card: updated });
      // Archiver une carte retire sa pastille : le compte se rediffuse.
      bus.emit({ type: 'rendus', byProject: store.projectsWithFinishedWork() });

      if (sortDuRangement) {
        bus.toast(
          'info',
          `« ${card.title} » sort de « ${COLUMN_LABELS[card.column]} » vers « ${COLUMN_LABELS[target]} ».`,
          updated.id,
        );
      }

      if (target === 'archived') {
        /*
         * UNE CARTE ARCHIVÉE N'EMPORTE PAS SON VIEIL INCIDENT. « Le plan n'est
         * pas venu » ressortait sinon à la réouverture, sur une demande que
         * plus personne n'attend.
         */
        if (updated.parcours?.incident || updated.parcours?.planDemandeA) {
          const propre = store.saveCard({
            ...updated,
            parcours: { ...updated.parcours, planDemandeA: undefined, incident: undefined },
          });
          bus.emit({ type: 'card.upsert', card: propre });
        }
        void archiveCard(updated.id);
      }
      return { card: updated };
    }

    /*
     * CHANGER LA CARTE DE PROJET. Le geste ne touche pas à la colonne : la
     * carte garde son étape à l'arrivée. Tout le travail — règle de permission,
     * transaction tout-ou-rien, diffusion aux deux tableaux — vit dans
     * `deplacerLaCarteVersProjet` : c'est la même porte pour le menu et pour le
     * glissement sur la colonne de gauche.
     */
    case 'card.deplacerVersProjet': {
      const resultat = deplacerLaCarteVersProjet(cmd.id, cmd.projectId);
      if (!resultat.ok) throw new Error(resultat.error ?? 'déplacement refusé');
      return { card: resultat.card, depuis: resultat.depuis, vers: resultat.vers };
    }

    case 'card.delete': {
      const card = store.getCard(cmd.id);
      if (!card) throw new Error('carte introuvable');
      // Le geste ferme aussi ce que la carte laissait en attente : sans quoi son
      // triangle et son chiffre survivaient à la carte elle-même.
      supprimerLaCarte(cmd.id);
      bus.emit({ type: 'rendus', byProject: store.projectsWithFinishedWork() });
      return { ok: true };
    }

    case 'card.validate': {
      const result = validerCarte(cmd.id);
      if (!result.ok) throw new Error(result.error ?? 'validation impossible');
      return { card: store.getCard(cmd.id) };
    }

    /*
     * VALIDER LA COMPRÉHENSION : un état écrit sur la carte, et rien d'autre.
     * Aucun message à l'agent, aucun tour : le lancement qui suit dans le même
     * clic lit cet état (`validerLaComprehension`, `server/src/scheduler.ts`).
     */
    /*
     * VALIDER UNE SUPPOSITION : un état écrit sur la compréhension en cours,
     * et rien d'autre — aucun message, aucun tour. Le cadrage suivant et
     * l'agent d'exécution la reçoivent comme une décision de l'utilisateur.
     */
    case 'card.comprehension.supposition': {
      const card = store.getCard(cmd.cardId);
      const comprise = card?.parcours?.comprehension;
      if (!card || !comprise) throw new Error('cette carte ne porte aucune compréhension.');
      const validees = basculerSupposition(comprise, cmd.hypothese, cmd.validee);
      if (!validees) throw new Error('cette supposition n’appartient plus à la compréhension en cours.');
      const ecrite = store.saveCard({
        ...card,
        parcours: { ...card.parcours!, comprehension: { ...comprise, hypothesesValidees: validees } },
      });
      bus.emit({ type: 'card.upsert', card: ecrite });
      return { card: ecrite };
    }

    case 'card.comprehension.validate': {
      const result = validerLaComprehension(cmd.cardId, cmd.niveau);
      if (!result.ok) throw new Error(result.error ?? 'validation de la compréhension impossible');
      /* Le geste fait, le repère change de nature — « valider » devient
         « lancer » — ou s'éteint. Le recalcul se fait ici, une fois. */
      bus.emit({ type: 'attention', ...store.signalAttention() });
      return { card: result.card ?? store.getCard(cmd.cardId) };
    }

    case 'card.start': {
      const result = await startCard(cmd.id);
      if (!result.ok) throw new Error(result.error ?? 'démarrage impossible');
      /* La carte est partie : elle n'attend plus son lancement. */
      bus.emit({ type: 'attention', ...store.signalAttention() });
      return result;
    }

    case 'card.finish': {
      const card = store.getCard(cmd.id);
      if (!card) throw new Error('carte introuvable');
      if (card.agentId && isRunning(card.agentId)) stopAgent(card.agentId);
      const updated = store.saveCard({
        ...card,
        column: COLONNE_DE_FIN_DE_TOUR,
        position: store.nextPosition(card.projectId, COLONNE_DE_FIN_DE_TOUR),
        doneAt: Date.now(),
        // Une carte déjà mise en ligne, retravaillée puis close à la main,
        // entre à nouveau dans « À déployer » : sa vieille date de mise en
        // ligne ne doit plus l'écarter du lot (`dateDeMiseEnLignePerimee`).
        deployedAt: undefined,
      });
      bus.emit({ type: 'card.upsert', card: updated });
      // Même événement que la clôture automatique par l'ordonnanceur : la
      // référence est la carte, donc une seule alerte quel que soit le chemin.
      notify({
        motif: 'tache-terminee',
        title: 'Tâche terminée',
        body: card.title,
        reference: card.id,
        element: card.title,
        cardId: card.id,
        projectId: card.projectId,
      });
      return { card: updated };
    }

    /* Le CLIC « Générer le plan ». Tout le travail vit dans `demanderLePlan`,
       partagé avec le DÉPÔT d'une carte de « Demande » dans « Plan ». */
    case 'plan.generer': {
      return demanderLePlan(cmd.cardId);
    }

    /* Le bouton de l'incident quand la compréhension manque : jamais un plan. */
    case 'comprehension.redemander': {
      return redemanderLaComprehension(cmd.cardId);
    }

    /*
     * L'INTERRUPTEUR « PLAN » : un état écrit sur la carte, et rien d'autre.
     * Aucun tour ne part de ce clic — c'est le PROCHAIN message qui emportera
     * la consigne du plan (`annoncerPlanDuMemeTour`).
     */
    case 'card.plan.souhaite': {
      const card = store.getCard(cmd.cardId);
      if (!card) throw new Error('carte introuvable');
      const parcours = { ...(card.parcours ?? { plans: [] }), planSouhaite: cmd.actif };
      const ecrite = store.saveCard({ ...card, parcours });
      bus.emit({ type: 'card.upsert', card: ecrite });
      return { card: ecrite };
    }

    /*
     * L'INTERRUPTEUR « CRÉATION » : même geste que « Plan ». Un état écrit sur
     * la carte, et rien d'autre ; c'est le PROCHAIN tour qui emporte la
     * consigne du chef d'orchestre et ses outils de délégation.
     */
    case 'card.creation.souhaitee': {
      const card = store.getCard(cmd.cardId);
      if (!card) throw new Error('carte introuvable');
      const parcours = { ...(card.parcours ?? { plans: [] }), creationSouhaitee: cmd.actif };
      const ecrite = store.saveCard({ ...card, parcours });
      bus.emit({ type: 'card.upsert', card: ecrite });
      return { card: ecrite };
    }

    /* Refermer l'incident du parcours : rien ne se relance, la carte se relit. */
    case 'plan.fermerIncident': {
      const card = store.getCard(cmd.cardId);
      if (!card) throw new Error('carte introuvable');
      if (!card.parcours?.incident) return { ok: true };
      const rangee = store.saveCard({ ...card, parcours: { ...card.parcours, incident: undefined } });
      bus.emit({ type: 'card.upsert', card: rangee });
      return { ok: true };
    }

    /*
     * L'HEURE DE DÉPART, POSÉE OU RETIRÉE À LA MAIN. Rien d'autre ne bouge :
     * `demarrageAutomatiqueAutorise` lit déjà cette date, retient la carte
     * jusqu'à l'heure dite et la CONSOMME au départ. Une date choisie efface
     * `creneauAutomatique` : ce n'est plus le créneau conseillé qui parle.
     */
    case 'card.schedule': {
      const card = store.getCard(cmd.id);
      if (!card) throw new Error('carte introuvable');
      const avant = card.scheduling ?? { attempts: 0, restarts: 0, asap: false };
      const updated = store.saveCard({ ...card, scheduling: programmerLeDepart(avant, cmd.date) });
      bus.emit({ type: 'card.upsert', card: updated });
      void tick();
      return { card: updated };
    }

    case 'card.asap': {
      const card = store.getCard(cmd.id);
      if (!card) throw new Error('carte introuvable');
      const updated = store.saveCard({
        ...card,
        scheduling: { ...(card.scheduling ?? { attempts: 0, restarts: 0, asap: false }), asap: cmd.value },
      });
      bus.emit({ type: 'card.upsert', card: updated });
      void tick();
      return { card: updated };
    }

    /* -------- Agents -------- */

    case 'agent.open': {
      const agent = store.getAgent(cmd.id);
      if (!agent) throw new Error('agent introuvable');
      envoyerConversation(cmd.id, cmd.tout);
      return { agent };
    }

    /*
     * LE JOURNAL COMPLET D'UNE CARTE, en un seul document : toutes les requêtes
     * et tous les points de travail, du cadrage au rapport. L'écran le demande
     * une fois à l'ouverture de l'onglet, puis suit les ajouts par l'événement
     * `journal.entree` (`shared/src/journal-carte.ts`).
     */
    case 'card.journal': {
      const card = store.getCard(cmd.cardId);
      if (!card) throw new Error('carte introuvable');
      /* LE CARNET DE MÉMOIRE VOYAGE AVEC LE JOURNAL : c'est le même écran qui
         lit les deux, point par point (`shared/src/carnet-memoire.ts`). */
      return { journal: journalDeLaCarte(cmd.cardId), carnet: store.carnetDeLaCarte(cmd.cardId) };
    }

    case 'card.conversation': {
      const card = store.getCard(cmd.cardId);
      if (!card) throw new Error('carte introuvable');
      let messages = store.listCardMessages(cmd.cardId);
      // L'agent d'exécution d'abord ; à défaut, le dernier agent de la carte —
      // son analyse, le plus souvent, dont le compte rendu se lit avant même
      // que le travail ne commence.
      let dernier = store.getAgentByCard(cmd.cardId) ?? store.getLastAgentByCard(cmd.cardId);
      /*
       * Une carte de travail hors tâche n'a pas d'agent à elle : elle emprunte
       * la conversation de celui qui a codé, sans se l'approprier.
       */
      if (!dernier && card.conversationAgentId) {
        dernier = store.getAgent(card.conversationAgentId);
        if (dernier) messages = store.listMessages(dernier.id);
      }
      /*
       * LE PREMIER MESSAGE DU FIL EST LA SYNTHÈSE DU BESOIN. Elle vit sur la
       * CARTE, pas en base : le fil s'ouvre donc dessus même quand aucun agent
       * n'existe encore — c'est tout l'intérêt, on la lit avant de lancer.
       */
      bus.emit({
        type: 'card.conversation',
        cardId: cmd.cardId,
        messages: filAvecLaSynthese(card, messages),
        activeAgentId: dernier?.id ?? card.agentId,
        // Tous ses agents : le tableau n'a reçu que ceux de ses cartes visibles.
        agents: store.agentsDeLaCarte(cmd.cardId),
      });

      /*
       * UNE CARTE POSÉE PAR UNE NUIT PASSÉE EST RATTRAPÉE ICI. Elle n'avait
       * aucun agent : on pouvait la commenter, jamais lui parler. À sa
       * première ouverture, elle reçoit son cadrage et son premier tour — le
       * même processus que les cartes posées depuis. Rien n'est attendu : la
       * conversation est déjà partie à l'écran, l'agent et ses messages
       * arrivent par leurs propres signaux.
       */
      if (!dernier) {
        const projet = store.getProject(card.projectId);
        void rattraperLeCadrageDeLaNuit(card, projet?.name ?? 'ce projet').catch((err) =>
          log.warn('cadrage de rattrapage impossible', err),
        );
        /* Toute autre carte posée par un agent sans conversation (l'atelier
           marketing, avant la règle MEM-3555) reçoit ici sa demande, son
           cadrage et son premier tour — une carte à la fois, sous les yeux. */
        void rattraperLaCarteSansCadrage(card).catch((err) =>
          log.warn('cadrage de rattrapage impossible', err),
        );
      } else if (relancerLeCadrageJamaisParti(card, 'ouverture')) {
        /* UN CADRAGE NÉ SANS JAMAIS RECEVOIR SON PREMIER TOUR (l'agent existe,
           donc le rattrapage d'au-dessus ne le voyait pas) part ici, sous les
           yeux, une seule fois. */
      } else if (
        dernier.role === 'cadrage' &&
        comprehensionARattraper({
          automatique: card.labels.includes(LABEL_AUTO_AMELIORATION),
          column: card.column,
          parcours: card.parcours,
          cadrageAuRepos: !isRunning(dernier.id),
          dejaRattrapee: !!getMeta(`comprehension-rattrapee:${card.id}`),
        })
      ) {
        /* Une carte de nuit dont le cadrage est mort avant la compréhension la
           reçoit à sa première ouverture, une seule fois (la marque est posée
           avant l'envoi : un échec ne relance pas en boucle). */
        setMeta(`comprehension-rattrapee:${card.id}`, String(Date.now()));
        void redemanderLaComprehension(card.id).catch((err) =>
          log.warn('compréhension de rattrapage impossible', err),
        );
      }

      // Lire, c'est éteindre la pastille — de cette carte, et d'elle seule.
      // Une conversation REDEMANDÉE par l'écran après une reconnexion
      // (`lire: false`) n'est pas une lecture : l'écran la rejoue pour la
      // dernière carte ouverte, même tiroir refermé depuis longtemps, et elle
      // éteignait le geste attendu et la secousse d'une carte jamais revue.
      if (cmd.lire !== false) marquerLue(cmd.cardId);
      return { messages: messages.length };
    }

    case 'card.read': {
      marquerLue(cmd.cardId);
      return { ok: true };
    }

    case 'card.unread': {
      return { ok: marquerNonLue(cmd.cardId) };
    }

    /*
     * UNE CARTE RÉCLAMÉE PAR SON LIEN DIRECT. Le tiroir n'a que l'identifiant
     * de l'adresse : il demande ici la carte elle-même, hors de tout
     * instantané de projet. Trois réponses possibles, et JAMAIS une attente
     * sans fin — c'est tout l'objet de cette commande :
     *   - `carte` : la voici, le tiroir la pose et s'affiche ;
     *   - `etat: 'introuvable'` : aucune ligne sous cet identifiant ;
     *   - `etat: 'illisible'` : la ligne existe mais ne se relit pas (c'est le
     *     même cas que celui qu'écarte `listCards`, en silence).
     */
    case 'card.get': {
      let carte: Card | null = null;
      try {
        carte = store.getCard(cmd.id);
      } catch (err: any) {
        log.warn(`carte illisible réclamée par lien direct : ${cmd.id}`, err?.message ?? err);
        return { etat: 'illisible' as const };
      }
      if (!carte) return { etat: 'introuvable' as const };
      return { etat: 'ok' as const, carte };
    }

    /*
     * Tout lire d'un geste, depuis la liste des projets. Seules les cartes
     * réellement non lues sont touchées : réécrire tout le tableau pour éteindre
     * une pastille ferait beaucoup de bruit pour rien.
     */
    /*
     * LE BADGE BLEU MÈNE À SA CARTE. Le client peut ne plus avoir les cartes du
     * projet en mémoire (déchargées après quinze minutes) : c'est donc la base
     * qui dit laquelle ouvrir, avec la même règle que le compteur.
     */
    case 'project.unreadCard': {
      return { cardId: store.lastUnreadCard([cmd.projectId, ...(cmd.membres ?? [])]) };
    }

    case 'project.read': {
      const touchees = store.markProjectRead(cmd.projectId);
      for (const carte of touchees) bus.emit({ type: 'card.upsert', card: carte });
      bus.emit({ type: 'rendus', byProject: store.projectsWithFinishedWork() });
      return { lues: touchees.length };
    }

    /*
     * REPARTIR DE ZÉRO. Le fil d'avant n'est pas supprimé : un repère de temps
     * le range derrière un lien. Ce qui repart vraiment de zéro, c'est la
     * session du moteur — plus aucun historique renvoyé — et le compteur de la
     * mémoire du projet, pour qu'elle reparte une fois, comme au premier
     * message. Le brouillon en cours n'est pas touché.
     *
     * L'AGENT LUI-MÊME OUBLIE SON CONTEXTE (`agentApresNouveauDepart`) : sa
     * mesure, son état de remplissage et son résumé de continuité. Sans cela,
     * le composeur gardait un pourcentage au-dessus d'une conversation vide, et
     * le premier tour suivant renvoyait au moteur un résumé du fil coupé. La
     * mesure part `indisponible` (un tiret) plutôt qu'un faux 0 % : seul le
     * moteur en donne une vraie, au premier tour.
     */
    case 'agent.reset': {
      const agent = store.getAgent(cmd.agentId);
      if (!agent) throw new Error('agent introuvable');
      const visibles = messagesDepuis(store.listMessages(agent.id), store.nouveauDepart(agent.id));
      const verdict = peutRepartir(
        { status: isRunning(agent.id) ? 'running' : agent.status, endedAt: agent.endedAt },
        visibles,
      );
      if (!verdict.ok) {
        bus.toast('warning', verdict.raison);
        return { ok: false };
      }

      store.setNouveauDepart(agent.id, store.now());
      store.clearSessions(agent.id);
      oublierLesLectures(agent.id);
      /* « REPARTIR DE ZÉRO » VIDE LE CARNET AVEC LE CONTEXTE : ce que cet agent
         avait ouvert n'est plus sous les yeux de personne. Le relevé des
         lectures n'est pas effacé : `carnetDeLaCarte` masque ce qui précède le
         nouveau départ. Une liste VIDE efface l'écran ; ce qu'un AUTRE agent de
         la carte a ouvert y revient aussitôt. */
      if (agent.cardId) {
        store.viderLeCarnet(agent.cardId);
        bus.emit({ type: 'carnet.lignes', cardId: agent.cardId, lignes: [] });
        const restantes = store.carnetDeLaCarte(agent.cardId);
        if (restantes.length) bus.emit({ type: 'carnet.lignes', cardId: agent.cardId, lignes: restantes });
      }
      store.setCarteVue(agent.id, '');
      const neuf = store.saveAgent(agentApresNouveauDepart(agent));
      bus.emit({ type: 'agent.upsert', agent: neuf });
      envoyerConversation(agent.id);
      bus.toast('success', 'Nouvelle conversation. Les échanges précédents restent consultables.');
      return { ok: true };
    }

    case 'agent.prompt': {
      // L'agent existe-t-il ? Ce contrôle-là doit répondre tout de suite.
      const agent = store.getAgent(cmd.agentId);
      if (!agent) throw new Error('agent introuvable');
      /* UNE CARTE EN COURS DE PUBLICATION NE REÇOIT PLUS DE MESSAGE
         (`shared/src/verrou-publication.ts`) : refusé AVANT tout routage, et
         avant qu'un message humain ne la ressorte de « À déployer ». Le fil du
         conducteur de publication (rôle `deploy`) reste ouvert. */
      if (
        agent.role !== 'deploy' &&
        carteEnPublication(store.latestDeploy(agent.projectId), agent.cardId)
      ) {
        throw new Error(TEXTE_CARTE_EN_PUBLICATION);
      }
      /*
       * UN MESSAGE SOUS UN RAPPORT RENDU EST UNE NOUVELLE DEMANDE, PAS UN
       * TRAVAIL. Il partait chez l'agent de tâche — le dernier de la carte —,
       * qui remettait la carte en « Travail » pour répondre (capture #8bbb,
       * 13.09.2026). Il va désormais à l'agent de CADRAGE, rouvert ou créé :
       * la carte passe dans « Demande », Compréhension, et seul le lancement
       * d'un plan validé la remet au travail
       * (`shared/src/relance-apres-rapport.ts`). Une carte DÉJÀ relancée garde
       * ce routage en « Demande » et en « Plan » : son `agentId` désigne encore
       * l'agent de tâche. Le routage passe AVANT la question ouverte : c'est
       * l'agent qui reçoit qui dit s'il attend.
       */
      const carteDuFil = agent.cardId ? store.getCard(agent.cardId) : null;
      /*
       * UN MESSAGE SOUS UNE CARTE DÉJÀ EN LIGNE OUVRE UNE NOUVELLE CARTE : le
       * verrou de publication, plus haut, est déjà passé. L'identifiant de la
       * carte neuve revient au client, qui l'ouvre. L'ancienne carte n'est ni
       * touchée ni marquée « action » : elle reste où elle est.
       */
      if (carteDuFil && messageOuvreUneNouvelleCarte(carteDuFil) && !estAgentMarketing(agent.id)) {
        const nouvelle = await ouvrirUneNouvelleCarteDepuis(agent.id, cmd.text, cmd.attachments ?? []);
        if (!nouvelle) throw new Error('la nouvelle carte n\'a pas pu être créée');
        return { ok: true, nouvelleCarteId: nouvelle.id };
      }
      if (carteDuFil && messageDeLaCarteVaAuCadrage(carteDuFil)) {
        const cadrage = await rouvrirLeCadrage(carteDuFil.id);
        if (!cadrage) throw new Error('le cadrage de cette carte ne peut pas être rouvert');
        if (cadrage.id !== agent.id) {
          return handleCommand({ ...cmd, agentId: cadrage.id } as ClientEnvelope['cmd'], compte);
        }
      }
      /* Un message envoyé est une ACTION sur la carte : la page « En route »,
         rangée par dernière action, la fait remonter en tête. */
      if (agent.cardId) {
        const touchee = store.marquerUneAction(agent.cardId);
        if (touchee) bus.emit({ type: 'card.upsert', card: touchee });
      }
      /*
       * L'AGENT EST ARRÊTÉ SUR SA QUESTION : CE QU'ON ÉCRIT EST LA RÉPONSE.
       *
       * La bulle de la question portait son propre champ de saisie, doublon de
       * la barre d'écriture — laquelle invite pourtant à répondre là (« l'agent
       * attend votre réponse… »). Ce qu'on y écrivait partait dans la FILE
       * d'attente de l'agent, lue une fois son travail fini, et la question
       * restait ouverte pour toujours : bouton « Annuler » et triangle orange
       * compris. La barre répond donc à la question, par le MÊME chemin que le
       * bouton de la bulle (`texteRepondALaQuestion`).
       */
      const enAttente = questionEnAttenteDeLAgent(cmd.agentId);
      /*
       * ET MÊME UN TOUR DÉJÀ REFERMÉ : plus personne n'attend dans le registre,
       * mais la bulle du DERNIER message garde sa question ouverte, avec ses
       * boutons. Y répondre par la barre la referme et relance l'agent, comme
       * le ferait le bouton « Répondre ».
       */
      const porteur = enAttente ? store.messageDeLaQuestion(cmd.agentId, enAttente) : null;
      const posee = porteur?.questions.find((q) => q.id === enAttente);
      const ouverte = porteur
        ? {
            messageId: porteur.id,
            questionId: enAttente!,
            texteLibre: posee?.allowFreeText ?? true,
            options: (posee?.options ?? []).map((option) => option.label),
          }
        : store.questionOuverteDuDernierMessage(cmd.agentId);
      const questionARepondre = texteRepondALaQuestion({
        questionEnAttente: ouverte?.questionId ?? null,
        texte: cmd.text,
        texteLibreAutorise: ouverte?.texteLibre,
      });
      if (questionARepondre && ouverte) {
        /*
         * …ET ELLE EMPORTE CE QUE LA BULLE TENAIT DÉJÀ. Un choix coché dans la
         * bulle, puis une précision écrite dans la barre : seul le texte
         * partait, et le choix était perdu. La réponse prend la forme de celle
         * du bouton « Répondre » (`reponseParLaBarre`), images de la bulle
         * comprises.
         */
        const saisie = cmd.saisiesDeQuestion?.[questionARepondre];
        const jointes = [...new Set([...(cmd.attachments ?? []), ...(saisie?.images ?? [])])];
        return handleCommand({
          type: 'question.answer',
          messageId: ouverte.messageId,
          questionId: questionARepondre,
          answer: reponseParLaBarre({ texte: cmd.text, options: ouverte.options, saisie }),
          attachments: jointes,
        } as ClientEnvelope['cmd'], compte);
      }

      /*
       * DISCUTER D'UN CHIFFRAGE. Le chiffrage vit désormais dans le tour de
       * l'agent d'exécution : c'est donc à LUI qu'on écrit pour corriger une
       * hypothèse, et son tour rend souvent des chiffres frais. On rebranche
       * leur lecture pour qu'ils remontent sur la carte — jamais marquée en
       * échec, jamais déplacée (voir `appliquerChiffrageDiscute`). Les agents
       * d'analyse d'avant ce changement gardent le même branchement.
       */
      const onComplete =
        (agent.role === 'task' || agent.role === 'analysis') && agent.cardId
          ? (text: string, ok: boolean, measurement: import('@beluga/shared').TurnMeasurement) =>
              appliquerChiffrageDiscute(agent.cardId!, text, ok, measurement)
          : estAgentAjoutDeMoteur(agent)
            ? // Le tour de l'agent d'ajout est fini : sa carte dit l'état réel.
              () => suivreLaCarteDeLAgent(agent.id, false)
            : undefined;
      /*
       * ON N'ATTEND PAS LA FIN DU TOUR. Un tour dure des minutes ; attendre
       * ici faisait expirer la commande côté navigateur au bout de deux
       * minutes, et le message semblait n'être jamais parti (il revenait
       * même dans la barre d'écriture). La suite arrive par abonnement.
       */
      /*
       * ÉCRIRE À UN CONDUCTEUR DE PUBLICATION NE PUBLIE JAMAIS.
       *
       * Le fil d'une mise en ligne porte une barre d'écriture, pendant et
       * après : c'est tout l'intérêt. Mais le volet qui l'affiche est aussi
       * celui qui commande la publication, et « aucun bouton ne permet de
       * rejouer un historique » doit tenir côté SERVEUR, pas seulement à
       * l'écran. Chaque demande écrite à un conducteur emporte donc sa
       * consigne : interdiction de déclencher quoi que ce soit, et posture
       * d'explication dès que la publication est finie.
       */
      const publicationDuFil = agent.role === 'deploy' ? store.deployDuConducteur(agent.id) : null;
      const contexteDuConducteur = publicationDuFil
        ? consigneDuConducteur(publicationTerminee(publicationDuFil))
        : undefined;
      /*
       * L'INTERRUPTEUR « PLAN » DE LA BARRE D'ÉCRITURE. Allumé sur la carte, il
       * ne demande pas un tour de plus : il ajoute sa consigne AU MÊME TOUR, et
       * marque la demande sur la carte pour que le filet de relance
       * (`planManquant`, `server/src/runtime.ts`) s'applique comme au clic.
       */
      const planDuTour = annoncerPlanDuMemeTour(agent);
      const contextePlan = planDuTour?.consigne;
      /*
       * L'AGENT DE CONFIGURATION (déploiement ou mise en production) se parle par cette
       * même barre, depuis la rubrique de son étape dans les réglages du projet :
       * chaque message emporte ce qu'il est et ce qu'il rend (le bloc du
       * processus), son premier message l'accueil entier.
       */
      const contexteConfiguration = await contexteDeConfiguration(agent);
      /* L'AGENT « AJOUTER UN MOTEUR » reçoit sa consigne entière au premier
         message, son rappel court ensuite. */
      const contexteMoteur = estAgentAjoutDeMoteur(agent)
        ? store.listMessages(agent.id, 1).length > 0
          ? rappelAjoutDeMoteur()
          : consigneAjoutDeMoteur(listerFiches())
        : undefined;
      const contexteDuTour = [contexteDuConducteur, contexteConfiguration, contexteMoteur, contextePlan].filter(Boolean).join('\n\n');
      /* CHAQUE AJOUT DE MOTEUR A SA CARTE, posée au premier message et passée
         en « En cours » pendant le tour ; son état est reposé après. */
      if (contexteMoteur) {
        await carteDeLAjout(agent.id, cmd.text).catch((err) => log.warn('carte de l’ajout de moteur non posée', err?.message ?? err));
        suivreLaCarteDeLAgent(agent.id, true);
      }
      void sendPrompt(cmd.agentId, cmd.text, {
        attachments: cmd.attachments,
        onComplete,
        // Sa carte est « En cours », mais l'agent d'ajout ne rend pas de compte rendu de tâche.
        ...(contexteMoteur ? { template: 'none' as const } : {}),
        ...(planDuTour ? { apresLaDemande: planDuTour.noterLeJalon } : {}),
        ...(contexteDuTour ? { context: contexteDuTour } : {}),
      }).catch((err) => log.error('envoi de la demande impossible', err));
      return { ok: true };
    }

    /*
     * ARRÊTER DEPUIS UNE CARTE N'ARRÊTE QUE SA TÂCHE. Le navigateur annonce la
     * carte d'où part le geste ; le démon rejoue la MÊME règle pure que le
     * bouton (`arretDeCarteAutorise`) et REFUSE un agent qui ne lui appartient
     * pas — le refus remonte et s'affiche, il ne passe jamais en silence.
     */
    case 'agent.stop': {
      const agent = store.getAgent(cmd.agentId);
      const verdict = arretDeCarteAutorise({
        carte: cmd.cardId,
        agent: agent ? { id: agent.id, cardId: agent.cardId } : null,
      });
      if (!verdict.possible) throw new Error(verdict.raison ?? 'arrêt refusé');

      /*
       * CE QUI ATTENDAIT DERRIÈRE TOMBE EN PREMIER, AVANT MÊME DE COUPER.
       *
       * L'ordre comptait, et il était faux : la file n'était vidée qu'APRÈS
       * l'arrêt. Or refermer un tour d'autorité relance la file en partant
       * (`refermerLeTour` → `enchainerLaFile`, ce qui est juste quand c'est la
       * VEILLE qui referme un tour bloqué). La demande en attente était donc
       * dépilée avant qu'on ne vide la file, elle repartait quatre dixièmes de
       * seconde plus tard, et ce nouveau tour replaçait la carte en « En
       * cours » par-dessus la suspension qu'on venait d'écrire : le clic
       * « Arrêter » relançait la tâche qu'il devait arrêter. On coupe donc la
       * suite d'abord.
       */
      const vides = store.clearQueue(cmd.agentId);
      if (vides) bus.emit({ type: 'queue.etat', agentId: cmd.agentId, queue: [] });

      /*
       * L'ARRÊT RÉPOND TOUJOURS. Sans moteur en marche — préparation coincée,
       * fermeture avalée par une panne, tour d'un démon d'avant — l'agent est
       * refermé d'autorité au lieu de rester marqué « au travail » ; et dans
       * tous les cas le geste DIT ce qu'il a fait, au lieu de glisser en
       * silence.
       */
      const decision = arreterLAgent(cmd.agentId);
      const stopped = decision.travaillait;
      /*
       * TOUS LES CAS SE DISENT, « coupé » COMPRIS — ET TOUS PASSENT PAR UN
       * MOTIF NOMMÉ. Deux exigences se rejoignent ici. On se taisait sur le
       * chemin ordinaire, en pariant que la disparition du témoin « au
       * travail » se verrait d'elle-même ; or c'est justement là que le clic
       * paraissait glisser, un moteur pendu mettant plusieurs secondes à lâcher
       * prise (et jusqu'à la fermeture d'autorité) sans que l'écran ne bouge
       * d'un cheveu. Le geste s'annonce donc toujours ; si la coupe ne suffit
       * pas, un second message le dira (`MESSAGE_ARRET_ACHEVE`).
       *
       * Mais un message de niveau « info » SANS motif se tait désormais
       * (`genreDuMessage`, `shared/src/notification-tri.ts` : seuls une
       * attente, une tâche finie et une erreur alertent). Le motif
       * `agent-interrompu` est donc posé sur TOUS les gestes, « coupe »
       * compris : sans lui, le tri avalerait précisément le message qu'on veut
       * voir. La couleur ne change pas.
       */
      bus.toast('info', decision.message, cmd.cardId, 'agent-interrompu');

      /*
       * La marque `suspendu` est celle de la suspension à la main : seul un
       * geste (« Lancer maintenant », dépôt en « En cours ») l'efface, et c'est
       * elle qui empêche l'ordonnanceur de reprendre la carte après un
       * redémarrage.
       */

      /*
       * ET LA COLONNE SUIT LE GESTE. La carte ne portait que la phrase : elle
       * restait donc dans « En cours », sans agent au travail, et le balayage
       * de l'ordonnanceur s'interdit d'y toucher après un tour arrêté. Elle
       * retombe maintenant en « Planifié », exactement comme la sortie à la
       * souris — même fonction, même état final.
       */
      const carte = cmd.cardId ? store.getCard(cmd.cardId) : null;
      if (carte) {
        const arretee = suspendreLaCarte(carte, RAISON_ARRETE_A_LA_MAIN);
        bus.toast('warning', RAISON_ARRETE_A_LA_MAIN, arretee.id);
      }

      return { stopped, geste: decision.geste, message: decision.message };
    }

    /*
     * ARRÊTER TOUT LE MONDE, EN FORCE ET EN LE DISANT. Le même geste que le
     * bouton d'un agent seul, appliqué à tout ce qui tourne encore — statut
     * enregistré, tour vivant, préparation coincée, moteur de service — et non
     * plus au seul statut, qui est justement ce qui ment quand rien n'avance.
     * Le compte rendu nomme les gestes faits (`bilanDesArrets`), au lieu d'un
     * nombre qui ne dit pas si le clic a mordu.
     */
    case 'agents.stop-all': {
      /*
       * LES FILES D'ABORD, LA COUPE ENSUITE — même raison qu'au bouton d'un
       * agent seul : refermer un tour d'autorité dépile la file en partant, et
       * la demande repartie replaçait la carte en « En cours » par-dessus la
       * suspension. Un bouton « tout arrêter » qui laisse repartir le travail
       * n'arrête rien.
       */
      for (const agent of store.listAgents()) {
        const vides = store.clearQueue(agent.id);
        if (vides) bus.emit({ type: 'queue.etat', agentId: agent.id, queue: [] });
      }

      const stoppedAgents = stopAllAgents();
      const bilan = bilanDesArrets(stoppedAgents.map((a) => a.geste));

      /*
       * Mettre à jour les cartes : les agents arrêtés reviennent en suspension
       * avec la raison « arrêt à la main ». C'est ce qui les empêche d'être
       * relancées automatiquement.
       */
      for (const { cardId } of stoppedAgents) {
        if (!cardId) continue;
        const carte = store.getCard(cardId);
        if (!carte) continue;

        suspendreLaCarte(carte, RAISON_ARRETE_A_LA_MAIN);
      }

      /*
       * Actualiser la capacité du système (la charge vient de baisser).
       */
      void import('./capacity.js').then((capacity) =>
        bus.emit({ type: 'capacity', capacity: capacity.etatCapacite() }),
      );

      /*
       * Le motif `agent-interrompu` est celui du tri des alertes : sans lui, un
       * message de confirmation se tairait, et ce clic-ci est justement celui
       * dont on veut voir l'effet.
       */
      bus.toast('info', bilan.message, undefined, 'agent-interrompu');

      return { count: stoppedAgents.length, bilan, stoppedAgents };
    }

    case 'agent.config': {
      const agent = store.getAgent(cmd.agentId);
      if (!agent) throw new Error('agent introuvable');

      const engines = await listEngines();
      const engineId = (cmd.run.engine as any) ?? agent.run.engine;
      const engine = engines.find((e) => e.id === engineId) ?? engines[0];

      // Changer un choix réinitialise ceux d'après : une combinaison
      // impossible ne peut jamais être envoyée (PLAN §14).
      const modelChanged = cmd.run.engine !== undefined || cmd.run.model !== undefined;
      const model =
        cmd.run.engine !== undefined
          ? (engine?.defaultModel ?? engine?.models[0]?.id)
          : (cmd.run.model ?? agent.run.model);
      const thinking = normaliseThinking(
        engine?.models ?? [],
        model,
        modelChanged ? undefined : (cmd.run.thinking ?? agent.run.thinking),
      );

      // Un compte imposé n'a de sens que pour SON moteur : changer de moteur
      // oublie le choix précédent plutôt que de forcer un compte qui n'existe
      // pas dessus.
      const engineChanged = engineId !== agent.run.engine;
      const requestedAccount = cmd.run.account !== undefined ? cmd.run.account : agent.run.account;
      const account =
        engineChanged || !requestedAccount
          ? undefined
          : listAccountRecords().some((a) => a.id === requestedAccount && a.engine === engineId)
            ? requestedAccount
            : undefined;

      const run = {
        engine: engine?.id ?? agent.run.engine,
        model,
        thinking,
        account,
      };
      // Un modèle, un moteur ou une réflexion posés à la main sur l'assistant le FIGENT :
      // le tri automatique ne le réécrit plus (DEC-213). Le compte, lui, n'y touche pas.
      if (estAssistantGlobal(agent) && (cmd.run.engine !== undefined || cmd.run.model !== undefined || cmd.run.thinking !== undefined)) {
        reglerLeNiveau({ mode: 'fige' });
      }
      const updated = store.saveAgent({
        ...agent,
        run: run as any,
        // Changer de moteur ou de modèle ouvre un autre fil : l'ancienne
        // mesure ne décrit plus le contexte qui sera utilisé.
        contextUsage: modelChanged ? undefined : agent.contextUsage,
      });
      bus.emit({ type: 'agent.upsert', agent: updated });

      // Le réglage d'un agent de cadrage devient le réglage retenu : les
      // cadrages ouverts ensuite le reprennent au lieu du modèle épinglé.
      if (agent.role === 'cadrage') {
        const settings = store.saveSettings({
          cadrageEngine: run.engine,
          cadrageModel: run.model,
          cadrageThinking: run.thinking,
        });
        bus.emit({ type: 'settings', settings });
      }

      // La carte garde le réglage pour ses prochains lancements.
      if (agent.cardId) {
        const card = store.getCard(agent.cardId);
        if (card) {
          const updatedCard = store.saveCard({ ...card, run: run as any });
          bus.emit({ type: 'card.upsert', card: updatedCard });
        }
      }
      return { run };
    }

    case 'queue.update': {
      const item = store.updateQueued(cmd.id, cmd.text);
      if (item) bus.emit({ type: 'queue.etat', agentId: item.agentId, queue: store.listQueue(item.agentId) });
      return { ok: !!item };
    }

    case 'queue.remove': {
      const agentId = store.removeQueued(cmd.id);
      if (agentId) bus.emit({ type: 'queue.etat', agentId, queue: store.listQueue(agentId) });
      return { ok: !!agentId };
    }

    /* -------- Propositions -------- */

    case 'question.answer': {
      const message = store.getMessage(cmd.messageId);
      if (!message) throw new Error('message introuvable');
      const question = message.questions.find((q) => q.id === cmd.questionId);
      if (!question) throw new Error('question introuvable');
      if (question.answer) return { already: true };

      const updated = store.saveMessage({
        ...message,
        questions: message.questions.map((q) =>
          q.id === cmd.questionId
            ? {
                ...q,
                answer: cmd.answer,
                answerAttachments: cmd.attachments ?? [],
                answeredAt: Date.now(),
              }
            : q,
        ),
      });
      bus.emit({ type: 'message.upsert', message: updated });
      bus.emit({ type: 'attention', ...store.signalAttention() });

      /*
       * UNE QUESTION DE ROUTAGE NE SE REND PAS À CELUI QUI L'A POSÉE. Elle ne
       * vient pas d'un moteur en train de réfléchir : elle vient de l'assistant
       * vocal global, qui attend de savoir OÙ déposer une phrase dictée. La
       * réponse fait donc partir la demande dans le chef d'orchestre du projet
       * choisi — jamais un tour dans la conversation où la question s'affichait.
       */
      if (store.dicteeDeLaQuestion(cmd.questionId)) {
        void repondreALaDictee(cmd.questionId, cmd.answer).catch((err) =>
          log.error('routage de la demande dictée impossible', err),
        );
        return { ok: true };
      }

      /*
       * LE CAS NORMAL : UN TOUR EST ARRÊTÉ SUR CETTE QUESTION. Son appel
       * d'outil `ask_user` n'a pas encore rendu la main — le moteur n'a donc
       * fait aucune des étapes suivantes de sa liste. La réponse lui est
       * rendue DANS CET APPEL, et il reprend aussitôt là où il s'était arrêté :
       * ni nouveau tour, ni message dans la file d'attente.
       */
      if (repondreALAttente(cmd.questionId, cmd.answer, cmd.attachments ?? [])) {
        return { ok: true };
      }

      // Personne n'attendait plus (tour déjà refermé, question posée en texte,
      // serveur redémarré) : l'agent repart pour un tour, avec la réponse en
      // main — sans faire patienter le navigateur jusqu'à la fin de ce tour. La
      // question n'est rappelée qu'en tête : c'est lui qui l'a posée, il l'a
      // déjà en contexte. Les images jointes à la réponse suivent le MÊME
      // chemin que celles du fil : leurs chemins sont annoncés dans la demande.
      const rappel = question.question.length > 80 ? `${question.question.slice(0, 80)}…` : question.question;
      void sendPrompt(message.agentId, `Réponse à ta question « ${rappel} » : ${cmd.answer}`, {
        attachments: cmd.attachments ?? [],
      }).catch((err) =>
        log.error('reprise après réponse impossible', err),
      );
      return { ok: true };
    }

    /*
     * ANNULER UNE QUESTION SANS Y RÉPONDRE. Utile quand elle a été posée par
     * erreur (dictée vocale déclenchée par mégarde) : elle cesse simplement
     * d'attendre, sans relancer l'agent — à la différence de « question.answer ».
     */
    case 'question.cancel': {
      const message = store.getMessage(cmd.messageId);
      if (!message) throw new Error('message introuvable');
      const question = message.questions.find((q) => q.id === cmd.questionId);
      if (!question) throw new Error('question introuvable');
      if (question.answer || question.cancelled) return { already: true };

      const updated = store.saveMessage({
        ...message,
        questions: message.questions.map((q) =>
          q.id === cmd.questionId ? { ...q, cancelled: true, answeredAt: Date.now() } : q,
        ),
      });
      bus.emit({ type: 'message.upsert', message: updated });
      bus.emit({ type: 'attention', ...store.signalAttention() });
      /*
       * Un tour arrêté sur cette question ne doit pas rester suspendu à une
       * réponse qui ne viendra jamais : il repart, en sachant que rien n'a été
       * tranché — donc sans deviner à la place de l'utilisateur.
       */
      annulerLAttente(cmd.questionId);
      return { ok: true };
    }

    /*
     * FERMER UNE QUESTION ÉCRITE EN TEXTE ORDINAIRE. Le tour est déjà terminé
     * (sans quoi le repère ne s'afficherait pas) : rien à reprendre, on éteint
     * juste le repère et le triangle orange sur ce message.
     */
    case 'question.cancelTexte': {
      const message = store.getMessage(cmd.messageId);
      if (!message) throw new Error('message introuvable');
      if (message.texteLibreAnnulee) return { already: true };

      const updated = store.saveMessage({ ...message, texteLibreAnnulee: true });
      bus.emit({ type: 'message.upsert', message: updated });
      bus.emit({ type: 'attention', ...store.signalAttention() });
      return { ok: true };
    }

    /*
     * FERMER TOUTES LES QUESTIONS D'UNE CARTE. Le bouton « Annuler » de la carte
     * du tableau : il n'a pas à savoir où dort la question — dans le fil de
     * l'agent en cours ou dans celui d'un ancien —, il les coupe toutes. Les
     * tours qui attendaient encore repartent en sachant que rien n'a été
     * tranché.
     */
    case 'question.cancelCarte': {
      const card = store.getCard(cmd.cardId);
      if (!card) throw new Error('carte introuvable');
      const fermees = fermerLesQuestionsDeLaCarte(cmd.cardId);
      return { ok: true, fermees };
    }

    /*
     * POURSUIVRE APRÈS ÉPUISEMENT. Tout se joue dans `reprendreSurCompte` :
     * relevé frais du compte visé, décision fermée AVANT le lancement (donc un
     * double clic ne lance rien), puis reprise du même agent. Un refus rend son
     * motif en français, sans rien lancer.
     */
    case 'reprise.compte': {
      const resultat = await reprendreSurCompte(cmd.messageId, cmd.accountId, { model: cmd.model });
      if (!resultat.ok) throw new Error(resultat.error ?? 'reprise impossible');
      return { ok: true };
    }

    /*
     * RENONCER À REPRENDRE. Le pendant d'« Annuler » sur une question : on ne
     * choisit aucun compte, la bulle se referme et le triangle s'éteint. Un
     * choix DÉJÀ fait ne se défait pas — il a relancé un tour.
     */
    case 'reprise.abandon': {
      const message = store.getMessage(cmd.messageId);
      if (!message) throw new Error('message introuvable');
      const reprise = message.repriseCompte;
      if (!reprise) throw new Error('ce message ne porte aucune reprise de compte');
      if (reprise.choisi || reprise.abandonnee) return { already: true };

      const updated = store.saveMessage({
        ...message,
        repriseCompte: { ...reprise, abandonnee: true, abandonneeA: Date.now() },
      });
      bus.emit({ type: 'message.upsert', message: updated });
      bus.emit({ type: 'attention', ...store.signalAttention() });
      return { ok: true };
    }

    /*
     * TRANCHER UNE ERREUR QUI A ARRÊTÉ LE TRAVAIL. Tout se joue dans
     * `repondreErreurDeTour` : relancer le même agent, ranger la carte en
     * « Terminé » (ignorer), ou la remettre en « Planifié » (arrêter).
     */
    case 'erreur.repondre': {
      const resultat = await repondreErreurDeTour(cmd.messageId, cmd.choix);
      if (!resultat.ok) throw new Error(resultat.error ?? 'réponse impossible');
      return { ok: true };
    }

    case 'proposal.decide': {
      const message = store.getMessage(cmd.messageId);
      if (!message) throw new Error('message introuvable');
      const proposal = message.proposals.find((p) => p.id === cmd.proposalId);
      if (!proposal) throw new Error('proposition introuvable');
      if (proposal.decision !== 'pending') return { already: true };

      const agent = store.getAgent(message.agentId);
      if (!agent) throw new Error('agent introuvable');

      // On peut corriger le titre, la description ou les réglages d'exécution
      // au moment de valider : la carte créée est celle qu'on a sous les yeux,
      // pas celle proposée.
      // Réglages complétés par leurs valeurs par défaut : la carte porte un
      // choix entier, jamais un demi-réglage impossible à relancer.
      // Ce qui s'affiche est ce qui part : un modèle choisi à l'écran, s'il
      // appartient au moteur, n'est plus réécrit par le palier du chef.
      // Le catalogue écarte seulement un identifiant emprunté à un autre moteur.
      const souhait = cmd.run ? { ...(proposal.run ?? {}), ...cmd.run } : proposal.run;
      const accorde = accorderRunDeProposition(proposal.run, cmd.run, await catalogueMoteurs());
      const run = accorde
        ? RunConfig.parse({
            ...(souhait ?? {}),
            engine: accorde.engine,
            model: accorde.model,
            thinking: accorde.thinking,
          })
        : souhait
          ? RunConfig.parse(souhait)
          : undefined;
      const retenu = {
        title: cmd.title?.trim() || proposal.title,
        description: cmd.description ?? proposal.description,
        labels: cmd.labels ?? proposal.labels,
        ...(run ? { run } : {}),
      };
      // Modifier le fond au dernier clic invalide l'étude faite juste avant :
      // mieux vaut rechiffrer que transmettre une analyse devenue fausse.
      const heritage = heritageAnalyseDeProposition(
        proposal,
        retenu.title,
        retenu.description,
      );

      let cardId: string | undefined;
      if (cmd.accept) {
        // Les images jointes au message d'origine suivent la carte : elles ne
        // s'éditent pas à la validation, on les reprend telles quelles.
        const card = createCard(agent.projectId, {
          ...retenu,
          origin: 'agent',
          attachments: proposal.attachments,
          /*
           * LA SYNTHÈSE DU BESOIN SUIT LA CARTE, et elle survit à une retouche
           * du titre ou de la description : ce n'est pas une étude du projet
           * (que la moindre édition rendrait caduque, voir `heritage`) mais le
           * compte rendu de l'échange avec l'utilisateur. Elle ouvrira la
           * conversation de la carte, avant même son lancement.
           */
          briefing: proposal.briefing,
          auteur: 'chef',
          // L'heure dite voyage avec la proposition : elle ne s'édite pas au
          // dernier clic, elle se retire ensuite dans l'onglet « Détails ».
          departPrevu: proposal.departPrevu,
          // Le tour du chef qui a produit cette carte : c'est ce lien qui donne
          // au parcours de la tâche sa PREMIÈRE mesure réelle (le tri).
          origineAgentId: agent.id,
          origineAt: message.createdAt,
          ...heritage,
        });
        cardId = card.id;
        bus.emit({ type: 'card.upsert', card });
        /*
         * LA CARTE ACCEPTÉE SUIT LE PARCOURS ENTIER : son point « Demande » porte
         * le texte de l'agent du chat, et son cadrage part jusqu'à la
         * compréhension. Rien n'est attendu ici : l'acceptation rend la main
         * dès la carte posée (`lancerLeCadrageDeLaProposition`).
         */
        void lancerLeCadrageDeLaProposition(card.id).catch((err) =>
          log.warn('cadrage de la proposition acceptée impossible à ouvrir', err),
        );
      }

      const decided = TaskProposal.parse({
        ...(store.decideProposal(cmd.proposalId, cmd.accept ? 'accepted' : 'refused', cardId) ?? {
          ...proposal,
          decision: cmd.accept ? ('accepted' as const) : ('refused' as const),
          cardId,
          decidedAt: Date.now(),
        }),
        ...retenu,
        ...heritage,
      });
      // La table dédiée garde elle aussi la version réellement validée : une
      // édition du sujet ne doit pas y laisser un ancien relais réutilisable.
      store.saveProposal(message.id, agent.projectId, decided);

      // La décision est mémorisée SUR LE TABLEAU : elle survit au rechargement.
      const updatedMessage = store.saveMessage({
        ...message,
        proposals: message.proposals.map((p) => (p.id === cmd.proposalId ? decided : p)),
      });
      bus.emit({ type: 'message.upsert', message: updatedMessage });
      // Tranchée, la proposition ne réclame plus rien : le signal s'éteint.
      bus.emit({ type: 'attention', ...store.signalAttention() });
      return { cardId };
    }

    case 'proposal.config': {
      const message = store.getMessage(cmd.messageId);
      if (!message) throw new Error('message introuvable');
      const proposal = message.proposals.find((p) => p.id === cmd.proposalId);
      if (!proposal) throw new Error('proposition introuvable');
      if (proposal.decision !== 'pending') return { already: true };

      const agent = store.getAgent(message.agentId);
      if (!agent) throw new Error('agent introuvable');

      const souhait = { ...(proposal.run ?? {}), ...cmd.run };
      const accorde = accorderRunDeProposition(proposal.run, cmd.run, await catalogueMoteurs());
      const run = accorde
        ? RunConfig.parse({
            ...(souhait ?? {}),
            engine: accorde.engine,
            model: accorde.model,
            thinking: accorde.thinking,
          })
        : RunConfig.parse(souhait);
      const updated = TaskProposal.parse({
        ...proposal,
        run,
        ...(accorde?.avertissement ? { avertissement: accorde.avertissement } : {}),
      });
      store.saveProposal(message.id, agent.projectId, updated);
      const updatedMessage = store.saveMessage({
        ...message,
        proposals: message.proposals.map((p) => (p.id === cmd.proposalId ? updated : p)),
      });
      bus.emit({ type: 'message.upsert', message: updatedMessage });
      return { ok: true, run };
    }

    case 'proposal.merge': {
      const resultat = store.mergePendingProposals(cmd.items);
      // Les messages qui portaient les sources sont tous rafraîchis. La
      // proposition réunie vit dans le premier : elle apparaît aussitôt dans
      // le bandeau, sans nouveau tour d'IA et sans carte créée.
      for (const message of resultat.messages) bus.emit({ type: 'message.upsert', message });
      bus.emit({ type: 'attention', ...store.signalAttention() });
      return { proposalId: resultat.proposal.id, already: resultat.already ?? false };
    }

    /* -------- Publication -------- */

    case 'deploy.start': {
      // La commande porte l'ÉTAPE du parcours ; il n'y a plus d'endroit à
      // choisir, le déploiement rafraîchit l'instance de dev de ce serveur.
      // `selectedCardIds` porte la sélection de l'écran de sélection : absent,
      // tout le lot connu part, comme avant cet écran.
      const result = await startDeploy(cmd.projectId, {
        cible: cmd.cible,
        selectedCardIds: cmd.selectedCardIds,
        depot: cmd.depot,
      });
      if (!result.ok) throw new Error(result.error ?? 'publication impossible');
      return result;
    }

    case 'deploy.stop':
      return { stopped: stopDeploy(cmd.runId) };

    case 'deploy.retry':
      return retryDeploy(cmd.runId);

    case 'deploy.depanner':
      // « Résoudre le problème » : l'agent qui répare puis relance (idempotent).
      return depannerLaPublication(cmd.runId);

    case 'deploy.reconcilier': {
      // Geste humain : même fonction que le rattrapage automatique.
      const issue = await reconcilierLaCarte(cmd.runId, cmd.cardId, 'humain');
      if (!issue.ok && issue.etat !== 'attente-quota') throw new Error(issue.error ?? 'réconciliation impossible');
      return issue;
    }

    case 'deploy.check': {
      /*
       * L'ÉTAPE dont le lot part de la colonne qui interroge. `null` veut dire
       * « cette colonne ne publie rien » : le bloc ne s'affiche alors pas du
       * tout, plutôt qu'un bouton qui serait refusé au clic.
       */
      const etape = etapeDeLaColonne(cmd.source ?? 'to_deploy');
      return {
        etape,
        // Les branches des cartes se fusionnent à la PREMIÈRE étape ; à la
        // seconde elles sont déjà dans la principale, il n'y a plus rien à
        // prévoir. On interroge donc le dépôt pour le lot de cette étape-là.
        conflicts: etape ? await conflitsPrevus(cmd.projectId, etape.source) : [],
        busy: agentsOccupes(cmd.projectId),
        // Le travail enregistré sur la principale sans passer par une carte :
        // sans lui, la fenêtre de publication disparaissait et rien ne partait.
        // Il entre dans le lot à la PREMIÈRE étape seulement : le compter aussi
        // à la seconde annoncerait deux fois le même travail.
        // On n'envoie que le COMPTE et les titres : les empreintes entières ne
        // servent qu'à ficher ce travail, côté serveur, si on le demande.
        enAttente: await (async () => {
          if (etape?.source !== 'to_deploy') return { nombre: 0, titres: [] };
          const attente = await commitsEnAttente(cmd.projectId);
          return { nombre: attente.nombre, titres: attente.titres };
        })(),
        // COMMENT cette étape se fera. Le dire AVANT le clic vaut mieux que de
        // le découvrir dans le déroulé.
        miseEnLigne: await moyenDeMiseEnLigne(cmd.projectId, etape?.cible),
        // Une MISE EN PRODUCTION sans prompt réglé ne part pas : on le dit ici,
        // pour que le bloc éteigne « Tout publier » et explique pourquoi.
        productionBloquee: blocageMiseEnProduction(cmd.projectId, etape?.cible),
        // LES DÉPÔTS TOUCHÉS PAR CHAQUE CARTE DU LOT, pour les boutons « publier
        // seulement ce dépôt ». Projet à plusieurs dépôts et « À déployer » seulement.
        depotsTouches: await (async () => {
          const project = store.getProject(cmd.projectId);
          if (!project?.depots?.length || etape?.source !== 'to_deploy') return undefined;
          return depotsTouchesParLesCartes(project, deployableCards(cmd.projectId, etape.source));
        })(),
      };
    }

    case 'deploy.ficherSansCarte': {
      /* Un GESTE de l'utilisateur, depuis l'avertissement de la colonne : on
         donne une fiche au travail trouvé. Rien n'est publié ni fusionné. */
      const resultat = await ficherLeTravailSansCarte(cmd.projectId);
      if (!resultat.ok) throw new Error(resultat.error ?? 'carte impossible à créer');
      return { cardId: resultat.card?.id };
    }

    case 'deploy.selection': {
      return { avertissements: await avertissementsDeLaSelection(cmd.projectId, cmd.source ?? 'to_deploy', cmd.selectedCardIds) };
    }

    case 'deploy.historique': {
      /*
       * LES PUBLICATIONS PASSÉES, avec leur fil : c'est ce qui permet à la
       * colonne « En production » de dire quelles cartes sont parties ensemble,
       * et de rouvrir l'historique d'un déploiement des semaines plus tard.
       *
       * Lecture EN BASE, rien d'autre — aucune commande, aucun appel au dépôt :
       * elle ne coûte rien et ne peut rien déclencher. Le plafond est borné
       * ici, jamais dicté par l'écran seul.
       */
      const limite = Math.min(Math.max(cmd.limite ?? 20, 1), 50);
      return { runs: store.recentDeploys(cmd.projectId, limite) };
    }

    case 'deploy.etatProduction': {
      /*
       * QUELLE VERSION TOURNE CHEZ LE CLIENT, et de combien le dépôt l'a
       * dépassée. C'est ce qui a remplacé la colonne « En production » : on ne
       * compte plus des cartes, on lit un enregistrement et un écart.
       *
       * Lecture SEULE : une ligne de journal et deux commandes git qui
       * n'écrivent rien. Elle ne peut donc rien déclencher et ne coûte aucun
       * jeton.
       */
      return { etat: await etatDeLaProduction(cmd.projectId) };
    }

    /* -------- Fichiers -------- */

    case 'files.list': {
      const project = store.getProject(cmd.projectId);
      if (!project) throw new Error('projet introuvable');
      const nodes = listDir(project.path, cmd.path ?? '');
      bus.emit({ type: 'files', projectId: cmd.projectId, path: cmd.path ?? '', nodes });
      return { nodes };
    }

    case 'files.archive': {
      const project = store.getProject(cmd.projectId);
      if (!project) throw new Error('projet introuvable');
      const zip = await makeZip(project.path, cmd.paths, project.name);
      return { token: mintDownload(zip.file, zip.name), name: zip.name, size: zip.size };
    }

    case 'attachments.list': {
      const items = store.listAttachments(cmd.projectId);
      bus.emit({ type: 'attachments', projectId: cmd.projectId, items });
      return { items };
    }

    /*
     * L'INSTANT QUI SERT D'APERÇU À UNE VIDÉO.
     *
     * Deux appelants, un seul chemin : le GESTE d'un membre de l'équipe
     * (`manuel`), et la recherche automatique du lecteur, qui remonte ici ce
     * qu'elle a trouvé pour que la fois suivante personne ne cherche. Le magasin
     * refuse qu'une recherche automatique écrase un choix de la main.
     *
     * La liste entière repart aux écrans : c'est elle qui alimente déjà les
     * vignettes du fil, et tout ce qui affiche cette vidéo se remet d'aplomb
     * sans rechargement.
     */
    /*
     * REFAIRE LA RÉDACTION D'UNE TÂCHE NÉE DE LA MESSAGERIE. Le bouton de la
     * mention d'échec, et lui seul : rien n'est recréé, seul le tour repart. On
     * ne l'ATTEND pas — c'est un tour de moteur, et le bouton doit rendre la
     * main tout de suite.
     */
    case 'card.redaction.relancer': {
      const carte = store.getCard(cmd.cardId);
      if (!carte) throw new Error('carte introuvable');
      void relancerLaRedaction(cmd.cardId).catch((err) =>
        log.error(`relance de la rédaction de « ${carte.title} » impossible`, err),
      );
      return { ok: true };
    }

    case 'attachment.apercu': {
      const piece = store.ecrireApercuDePiece(cmd.id, cmd.seconde, cmd.manuel);
      if (!piece) throw new Error('pièce jointe introuvable');
      bus.emit({ type: 'attachments', projectId: piece.projectId, items: store.listAttachments(piece.projectId) });
      return { piece };
    }

    /* -------- Facturation -------- */

    case 'billing.clients':
      return { clients: await billing.listClients(), available: billing.billingAvailable() };

    case 'billing.documents':
      return { documents: await billing.listDocuments(cmd.clientId) };

    case 'billing.push': {
      const result = await billing.pushLine({
        cardId: cmd.cardId,
        documentType: cmd.documentType,
        documentId: cmd.documentId,
        title: cmd.title,
        description: cmd.description,
        clientExplanation: cmd.clientExplanation,
        hours: cmd.hours,
      });
      if (!result.ok) throw new Error(result.error ?? 'ajout impossible');
      bus.toast('success', `Ligne ajoutée au document ${result.documentNumber ?? ''}`.trim());
      return result;
    }

    case 'billing.regenerate': {
      const result = await billing.regenerateText({ cardId: cmd.cardId, field: cmd.field, hint: cmd.hint });
      if (!result.ok) throw new Error(result.error ?? 'régénération impossible');
      return result;
    }

    case 'billing.summary':
      return { summary: await billing.summary() };

    case 'card.ecartChiffrage':
      return { ecart: ecartChiffrage(cmd.projectId) };

    /* -------- GitHub -------- */

    case 'github.refresh':
      return { tracking: await github.refreshCard(cmd.cardId) };

    case 'github.deploiements':
      return { deploiements: github.deploiementsDeCarte(cmd.cardId) };

    case 'github.merge': {
      const result = await github.mergeCard(cmd.cardId, cmd.method, cmd.auto);
      if (!result.ok) throw new Error(result.error ?? 'fusion impossible');
      return result;
    }

    /* -------- Commentaires de carte -------- */

    /*
     * Le commentaire ne garde que des IDENTIFIANTS de pièces jointes (même
     * table `attachments` que les conversations) : c'est ici, à la lecture,
     * qu'on les résout en objets complets — l'écran n'a ainsi jamais besoin
     * d'une seconde requête pour savoir de quel fichier il s'agit.
     */
    case 'comment.list':
      return {
        comments: store.listCardComments(cmd.cardId).map((comment) => ({
          ...comment,
          attachments: comment.attachmentIds.map((id) => store.getAttachment(id)).filter(Boolean),
        })),
      };

    case 'comment.add': {
      const card = store.getCard(cmd.cardId);
      if (!card) throw new Error('carte introuvable');
      const texte = cmd.text.trim();
      if (!texte) throw new Error('Le commentaire est vide.');
      const comment = store.addCardComment({
        id: store.newId(),
        cardId: cmd.cardId,
        projectId: card.projectId,
        text: texte,
        attachmentIds: cmd.attachmentIds ?? [],
        createdAt: Date.now(),
      });
      return {
        comment: {
          ...comment,
          attachments: comment.attachmentIds.map((id) => store.getAttachment(id)).filter(Boolean),
        },
      };
    }

    case 'comment.delete':
      store.deleteCardComment(cmd.id);
      return { ok: true };

    /* -------- Système -------- */

    case 'settings.get':
      return { settings: store.getSettings() };

    case 'prefs.set': {
      store.writePreference(cmd.key, cmd.value);
      // Tous les écrans ouverts suivent : même mise en page partout.
      bus.emit({ type: 'prefs', prefs: store.readPreferences() });
      return { ok: true };
    }

    case 'settings.update': {
      const settings = store.saveSettings(cmd.patch as any);
      bus.emit({ type: 'settings', settings });
      return { settings };
    }

    case 'capacity.processes': {
      const processes = await listProcesses();
      bus.emit({ type: 'processes', processes });
      return { processes };
    }

    case 'capacity.history':
      return { history: store.capacityHistory() };

    case 'process.stop':
      return controlProcess(cmd.id, 'stop');

    case 'process.start':
      return controlProcess(cmd.id, 'start');

    case 'engines.list': {
      // Une relecture forcée du catalogue intéresse TOUS les écrans ouverts, pas
      // seulement celui qui l'a demandée : l'assistant de démarrage s'en sert
      // pour constater qu'un outil vient d'être installé sur le serveur.
      const engines = await listEngines(true);
      bus.emit({ type: 'engines', engines });
      return { engines };
    }

    /*
     * L'ÉTAT D'UN COMPTE CURSOR. Ce moteur ne publie aucune fenêtre de
     * pourcentage : la ligne de compte montre le crédit et l'usage. Ce que
     * cette commande ajoute — pour savoir si le compte peut travailler —,
     * c'est si la clé répond et si l'outil « cursor-agent » est sur le serveur.
     */
    case 'cursor.etat': {
      const comptes = listAccountRecords().filter((a) => a.engine === 'cursor');
      const compte = cmd.accountId ? comptes.find((a) => a.id === cmd.accountId) : comptes[0];
      if (!compte) throw new Error('aucun compte Cursor déclaré');
      return { etat: await etatDuCompteCursor(cleDuCompteCursor(compte)) };
    }

    /*
     * UNE CLÉ CURSOR DE PLUS. Le compte n'entre dans la liste qu'une fois la
     * clé éprouvée ; les moteurs sont ensuite relus, sinon Cursor resterait
     * « absent » jusqu'au prochain redémarrage sur une installation qui vient
     * de recevoir sa toute première clé.
     */
    /*
     * LE CRÉDIT DÉPENSÉ, compte par compte. Cursor facture à la dépense : le
     * montant voyage aussi avec le relevé de quota. Cette commande reste pour
     * l'onglet « Consommation ». Aucun compte Cursor déclaré : la liste est
     * vide, et l'écran ne montre rien plutôt qu'un bloc vide.
     */
    case 'cursor.credit': {
      const comptes = listAccountRecords().filter((a) => a.engine === 'cursor');
      return {
        comptes: await Promise.all(
          comptes.map(async (compte) => ({
            id: compte.id,
            label: compte.label,
            credit: await creditCursor(cleDuCompteCursor(compte)),
          })),
        ),
      };
    }

    case 'cursor.ajouterCle': {
      const rendu = await declarerCleCursor(cmd.label, cmd.cle);
      if (rendu.ok) {
        const quotas = await refreshQuotas(true);
        bus.emit({ type: 'quotas', quotas });
        bus.emit({ type: 'engines', engines: await listEngines(true) });
      }
      return rendu;
    }

    case 'compte.ajouterCle': {
      const rendu = await declarerCleDeMoteur(cmd.engine, cmd.label, cmd.cle);
      if (rendu.ok) {
        const quotas = await refreshQuotas(true);
        bus.emit({ type: 'quotas', quotas });
        bus.emit({ type: 'engines', engines: await listEngines(true) });
      }
      return { ok: rendu.ok, erreur: rendu.erreur };
    }

    case 'compte.remplacerCle': {
      const rendu = await remplacerCleDuCompte(cmd.accountId, cmd.cle);
      if (rendu.ok) {
        const quotas = await refreshQuotas(true);
        bus.emit({ type: 'quotas', quotas });
        bus.emit({ type: 'engines', engines: await listEngines(true) });
      }
      return { ok: rendu.ok, erreur: rendu.erreur };
    }

    /* -------- Moteurs ajoutés -------- */

    case 'moteurs.agent': {
      const agent = agentAjoutDeMoteur(cmd.neuf === true);
      if (!agent) throw new Error('aucun projet pour porter l’agent : créez d’abord un projet');
      return { agent };
    }

    /* -------- L'assistant global -------- */

    case 'assistant.agent': {
      const ouvert = agentAssistantGlobal(cmd.neuf === true);
      if (!ouvert) throw new Error('aucun projet pour porter l’assistant : créez d’abord un projet');
      const agent = await poserLeModeleDeDepart(ouvert, await catalogueMoteurs());
      return { agent, validationAuto: validationAutomatique(), niveau: reglageDuNiveau() };
    }

    case 'assistant.niveau': {
      const niveau = reglerLeNiveau({ mode: cmd.mode, plafond: cmd.plafond });
      // Revenir en automatique : le modèle se range tout de suite sous le plafond.
      const agent = agentAssistantGlobal();
      if (agent && niveau.mode === 'auto' && (cmd.mode || cmd.plafond)) {
        const { appliquerLeNiveauDeLAssistant } = await import('./assistant-global.js');
        if (!agentTientSonTour(agent)) {
          await appliquerLeNiveauDeLAssistant(agent, '', async () => undefined, await catalogueMoteurs());
        }
      }
      return { niveau };
    }

    case 'assistant.validation':
      return { validationAuto: reglerValidationAutomatique(cmd.auto === true) };

    case 'moteurs.eprouver':
      return eprouverDepuisLesReglages(cmd.id, cmd.cle);

    case 'moteurs.retirer':
      return retirerMoteur(cmd.id, { agentsAuTravail: agentsActifs(), comptesOccupes: comptesOccupes() });

    case 'quota.refresh': {
      const quotas = await refreshQuotas(true);
      bus.emit({ type: 'quotas', quotas });
      return { quotas };
    }

    /* -------- Connexion d'un compte de moteur -------- */

    case 'account.connect':
      // Le lancement rend tout de suite la tentative ; l'adresse, le code et
      // l'issue arrivent ensuite par l'abonnement.
      return { connexion: demarrerConnexion({ engine: cmd.engine, accountId: cmd.accountId, label: cmd.label }) };

    case 'account.code':
      return envoyerCode(cmd.id, cmd.code);

    case 'account.cancel':
      return annulerConnexion(cmd.id);

    case 'account.connections':
      return { connexions: connexionsEnCours() };

    case 'account.disable': {
      // Couper (ou rallumer) un compte, puis relire les quotas : le compte coupé
      // reste dans la liste, éteint, et le compte actif est recalculé.
      const compte = setAccountDisabled(cmd.id, cmd.disabled);
      const quotas = await refreshQuotas(true);
      bus.emit({ type: 'quotas', quotas });
      return { ok: !!compte, quotas };
    }

    case 'account.rename': {
      // Écrire le nouveau nom du compte, puis relire les quotas : le nom retenu
      // remonte aussitôt partout où le compte est nommé (liste, volet, alertes).
      // Un nom vide est refusé et le compte garde son ancien nom (ok: false).
      const compte = renameAccount(cmd.id, cmd.label);
      const quotas = await refreshQuotas(true);
      bus.emit({ type: 'quotas', quotas });
      return { ok: !!compte, quotas };
    }

    case 'account.forfaitMensuel': {
      // Le forfait du mois d'un compte MiMo (plafond, renouvellement, consommé
      // relevé chez Xiaomi) : écrit sur le compte, puis les quotas sont relus
      // pour que la barre du mois se recale aussitôt.
      const compte = reglerForfaitMensuel(cmd.id, {
        plafond: cmd.plafond,
        renouvellement: cmd.renouvellement,
        consomme: cmd.consomme,
      });
      const quotas = await refreshQuotas(true);
      bus.emit({ type: 'quotas', quotas });
      return { ok: !!compte, quotas };
    }

    case 'account.remove': {
      // Le compte quitte l'application ; ses jetons restent sur le disque. Le
      // refus (compte au travail, dernier compte du moteur) porte sa raison.
      const retrait = retirerCompte(cmd.id, { comptesOccupes: comptesOccupes() });
      if (!retrait.ok) return retrait;
      const quotas = await refreshQuotas(true);
      bus.emit({ type: 'quotas', quotas });
      return { ...retrait, quotas };
    }

    case 'quota.history':
      // La courbe ne montre que les derniers jours ; le RÉSUMÉ, lui, part avec
      // elle pour que le profil des heures creuses remonte à deux mois.
      return { history: store.quotaHistory(cmd.days ?? 7), resume: store.quotaResume() };

    case 'amorce.history':
      return { entries: store.amorceHistory(cmd.limit ?? 40) };

    /* -------- Clés d'API des services extérieurs -------- */

    case 'cleApi.lister':
      return { cles: listerClesApi() };

    case 'cleApi.creer': {
      // Le SECRET n'est rendu qu'ICI, et une seule fois : il n'est conservé
      // nulle part, seule son empreinte l'est.
      const resultat = creerCleApi(cmd.nom);
      if (!resultat.ok) throw new Error(resultat.raison);
      return { cle: resultat.cle, secret: resultat.secret, cles: listerClesApi() };
    }

    case 'cleApi.revoquer': {
      const cle = revoquerCleApi(cmd.id);
      if (!cle) throw new Error('clé introuvable');
      return { cle, cles: listerClesApi() };
    }

    case 'cleApi.oublier': {
      const resultat = oublierCleApi(cmd.id);
      if (!resultat.ok) throw new Error(resultat.raison ?? 'clé introuvable');
      return { ok: true, cles: listerClesApi() };
    }

    /* -------- Coffre-fort des identifiants -------- */

    // Retirer une fiche l'ARCHIVE six mois : chaque réponse rend donc aussi les archives.
    case 'coffre.lister':
      return { acces: listerAcces(), archives: listerArchives() };

    case 'coffre.enregistrer': {
      const resultat = enregistrerAcces(cmd.acces);
      if (!resultat.ok) throw new Error(resultat.raison);
      return { acces: resultat.acces, liste: listerAcces(), archives: listerArchives() };
    }

    case 'coffre.supprimer': {
      const resultat = supprimerAcces(String(cmd.id ?? ''));
      if (!resultat.ok) throw new Error(resultat.raison ?? 'accès introuvable');
      return { ok: true, liste: listerAcces(), archives: listerArchives() };
    }

    case 'coffre.restaurer': {
      const resultat = restaurerAcces(String(cmd.id ?? ''));
      if (!resultat.ok) throw new Error(resultat.raison ?? 'archive introuvable');
      return { ok: true, liste: listerAcces(), archives: listerArchives() };
    }

    /* -------- Le juge rapide -------- */

    /*
     * TOUT CE QUE L'ÉCRAN DU JUGE AFFICHE, EN UNE RÉPONSE. L'activation n'est
     * pas un réglage à part : c'est la PRÉSENCE de Laya sur la machine.
     */
    case 'juge.etat':
      return etatDuJuge();

    /* Éteindre UN usage ne touche jamais aux autres. */
    case 'juge.usage': {
      const usage = String(cmd.usage ?? '') as UsageDuJuge;
      if (!(USAGES_JUGE as readonly string[]).includes(usage)) throw new Error('usage inconnu');
      /* Les deux listes bougent ensemble : un geste explicite l'emporte
         toujours sur l'état par défaut de la fiche, dans un sens comme dans
         l'autre. */
      const reglages = store.getSettings();
      store.saveSettings({
        jugeEteints: basculerUsage(usage, Boolean(cmd.allume), reglages.jugeEteints),
        jugeAllumes: basculerUsageAllume(usage, Boolean(cmd.allume), reglages.jugeAllumes),
      });
      return etatDuJuge();
    }

    case 'juge.traces': {
      const traces = listerLesTraces(Number(cmd.limite ?? 100), cmd.usage ? String(cmd.usage) : undefined);
      return { traces, bilan: bilanDesTraces(traces) };
    }

    /* -------- Base de connaissances -------- */

    /*
     * LA BASE DE CONNAISSANCES (`server/src/connaissances.ts`). L'écran lit les
     * portées (Global puis les projets), les fiches numérotées d'une portée et
     * leurs unités, une unité et ses versions, le changelog d'un projet ; il
     * cherche dans une portée ou dans toutes ; il confirme ou déprécie une unité
     * (par la même porte que les agents) ; il exporte une portée en un seul
     * Markdown ; il relance la génération d'une portée et lit son rapport.
     */
    case 'memoire.portees': {
      const projets = store.listProjects().filter((p) => !p.archived);
      return { portees: listerLesPortees(projets) };
    }

    case 'memoire.fiches': {
      const unites = unitesDeLaPortee(cmd.portee, 'toutes');
      return {
        fiches: fichesDeLaPortee(cmd.portee).map((f) => {
          const deLaFiche = unitesDeLaFiche(cmd.portee, f, 'toutes', unites);
          return {
            id: f.id,
            titre: f.titre,
            types: f.types,
            unites: deLaFiche.filter((u) => u.statut === 'active').length,
            depreciees: deLaFiche.filter((u) => u.statut === 'deprecated').length,
          };
        }),
        changelog: cmd.portee === PORTEE_GLOBALE ? null : entreesDuChangelog(cmd.portee).length,
        rapport: dernierRapportDeGeneration(cmd.portee),
        refus: refusRecents(cmd.portee, 10),
        generation: generationEnCours(cmd.portee),
      };
    }

    case 'memoire.fiche': {
      const fiche = fichesDeLaPortee(cmd.portee).find((f) => f.id === cmd.ficheId);
      if (!fiche) throw new Error('fiche introuvable');
      const unites = unitesDeLaFiche(cmd.portee, fiche, cmd.depreciees ? 'deprecated' : 'active');
      // La tête d'une portée réunit « À ne jamais supposer » de TOUTE la portée (et du Global pour un projet), comme son fichier rendu.
      const jamaisSupposer = fiche.id.startsWith('00_')
        ? [...unitesDeLaPortee(cmd.portee), ...(cmd.portee === PORTEE_GLOBALE ? [] : unitesDeLaPortee(PORTEE_GLOBALE))].filter((u) => u.jamaisSupposer)
        : [];
      return { fiche, unites, jamaisSupposer };
    }

    case 'memoire.unite': {
      const unite = lireUnite(cmd.id);
      if (!unite) throw new Error('unité introuvable');
      return { unite, versions: versionsDeLUnite(unite.id), fiche: ficheDeLUnite(unite).id };
    }

    case 'memoire.chercher': {
      const recherche = cmd.recherche.trim();
      if (!recherche) return { trouvees: [] };
      const trouvees = await chercherUnitesMelees(recherche, cmd.portee ? { portees: [cmd.portee], limite: 40 } : { tous: true, limite: 40 });
      return { trouvees };
    }

    case 'memoire.changelog': {
      const entrees = entreesDuChangelog(cmd.projectId);
      return { entrees: lierLesCartes(cmd.projectId, entrees.slice(0, 400)), total: entrees.length };
    }

    case 'memoire.changelog.corriger': {
      const r = corrigerEntreeDuChangelog(cmd.projectId, cmd.id, { titre: cmd.titre, explication: cmd.explication, poids: cmd.poids });
      if (!r.ok) throw new Error(r.raison);
      return { entree: r.entree };
    }

    case 'memoire.confirmer': {
      const unite = confirmerUnite(cmd.id);
      if (!unite) throw new Error('unité introuvable');
      return { unite };
    }

    case 'memoire.deprecier': {
      const avant = lireUnite(cmd.id);
      if (!avant) throw new Error('unité introuvable');
      const r = proposerUnite(avant.portee, { action: 'deprecate', id: avant.id, raisonnement: 'dépréciée à l’écran' }, { auteur: 'écran' });
      if (!r.ok) throw new Error(r.raisons.join(' '));
      return { unite: r.unite };
    }

    case 'memoire.exporter':
      return { nom: nomDeLaPortee(cmd.portee), markdown: markdownDeLaPortee(cmd.portee) };

    case 'memoire.regenerer': {
      const lance = lancerLaGeneration(cmd.portee);
      return { lance, generation: generationEnCours(cmd.portee) };
    }

    case 'memoire.importer':
      return { rapports: importerLesLots({ portee: cmd.portee, force: true }) };

    /* -------- Notes -------- */

    case 'notes.lister': {
      const notes = listerNotes();
      return { notes, pieces: piecesDesNotes(notes) };
    }

    case 'notes.enregistrer': {
      const resultat = enregistrerNote(cmd.note);
      if (!resultat.ok) throw new Error(resultat.raison);
      const notes = listerNotes();
      return { note: resultat.note, notes, pieces: piecesDesNotes(notes) };
    }

    case 'notes.supprimer': {
      const resultat = supprimerNote(String(cmd.id ?? ''));
      if (!resultat.ok) throw new Error('note introuvable');
      const notes = listerNotes();
      return { ok: true, notes, pieces: piecesDesNotes(notes) };
    }

    /* -------- Backups des sites en production -------- */

    case 'backups.etat':
      return {
        sites: listerSitesBackups(),
        points: listerPoints(),
        projets: projetsSansFiche(),
        enCours: backupsEnCours(),
        restaurations: restaurationsEnCours(),
        dossier: dossierDeStockageBackups(),
      };

    case 'backups.enregistrerSite': {
      const resultat = enregistrerSite(cmd.site);
      if (!resultat.ok) throw new Error(resultat.raison);
      return { site: resultat.site, sites: listerSitesBackups() };
    }

    case 'backups.supprimerSite': {
      const resultat = supprimerSiteBackup(String(cmd.id ?? ''));
      if (!resultat.ok) throw new Error(resultat.raison ?? 'site introuvable');
      return { ok: true, sites: listerSitesBackups(), points: listerPoints() };
    }

    case 'backups.lancer': {
      // Le backup d'un site peut durer : on rend la main TOUT DE SUITE et
      // l'écran relit l'état, exactement comme le tiroir de publication. Retenir
      // la réponse pendant un vidage de base ferait tomber le navigateur au bout
      // de deux minutes, sans rien dire du travail en cours.
      const site = String(cmd.id ?? '');
      if (site) {
        void prendreUnBackup(site, 'manuel');
      } else {
        void passageDesBackups('manuel');
      }
      return { lance: true, enCours: backupsEnCours() };
    }

    case 'backups.configurer': {
      // L'assistant ouvre une conversation et part : on ne retient pas l'écran
      // pendant un tour de moteur. L'identifiant rendu est celui du fil où ses
      // questions s'afficheront.
      const depart = await lancerAssistantDeBackup({
        description: String(cmd.description ?? ''),
        projectId: cmd.projectId ? String(cmd.projectId) : null,
      });
      return depart;
    }

    case 'backups.relire': {
      const depart = await lancerRelectureDeBackup(String(cmd.id ?? ''));
      return depart;
    }

    case 'backups.restaurer': {
      // Comme la prise d'un point : la restauration peut durer, on rend la
      // main tout de suite et l'écran relit l'état pour suivre son avancée.
      const point = String(cmd.id ?? '');
      if (!point) throw new Error('point à restaurer manquant');
      void restaurerUnBackup(point);
      return { lance: true, restaurations: restaurationsEnCours() };
    }

    /* -------- Service Statistiques -------- */

    case 'statistiques.lister': {
      const { listerLesSites } = await import('./statistiques.js');
      return listerLesSites();
    }

    case 'statistiques.detail': {
      const { detailDuSite } = await import('./statistiques.js');
      return detailDuSite(String(cmd.id ?? ''), { jours: cmd.jours, debut: cmd.debut, fin: cmd.fin });
    }

    case 'statistiques.visiteur': {
      const { friseDUnVisiteur } = await import('./statistiques.js');
      return friseDUnVisiteur(String(cmd.id ?? ''), cmd.visiteur);
    }

    case 'statistiques.creerSite': {
      const { creerSiteAutonome } = await import('./statistiques.js');
      return { espace: creerSiteAutonome({ nom: cmd.nom, adresse: cmd.adresse, mode: cmd.mode }) };
    }

    case 'statistiques.modifierSite': {
      const { modifierSiteAutonome } = await import('./statistiques.js');
      return { espace: modifierSiteAutonome(String(cmd.id ?? ''), { nom: cmd.nom, adresse: cmd.adresse }) };
    }

    case 'statistiques.supprimerSite': {
      const { supprimerSiteAutonome } = await import('./statistiques.js');
      supprimerSiteAutonome(String(cmd.id ?? ''));
      return { ok: true };
    }

    case 'statistiques.reglerMode': {
      const { reglerLeMode } = await import('./statistiques.js');
      // Depuis l'écran, le passage en suivi complet lance l'analyse des objectifs.
      return { espace: reglerLeMode(String(cmd.id ?? ''), cmd.mode, { analyser: true }) };
    }

    case 'statistiques.analyserObjectifs': {
      const { analyserLesObjectifs } = await import('./statistiques.js');
      const { card, deja } = await analyserLesObjectifs(String(cmd.id ?? ''));
      return { card, deja };
    }

    case 'statistiques.testerSuivi': {
      const { testerLeSuivi } = await import('./suivi-par-defaut.js');
      return await testerLeSuivi(String(cmd.id ?? ''));
    }

    case 'statistiques.etapesInstallation': {
      /* LES ÉTAPES DE L'AGENT, SANS SA CONVERSATION. L'assistant d'installation
         montre la liste qui se coche ; il lit ici la dernière liste écrite par
         l'agent le plus récent de la carte, puis suit les `message.upsert`. */
      const carte = store.getCard(String(cmd.cardId ?? ''));
      if (!carte) return { agentId: null, etapes: [] };
      const agents = store
        .listAgents(carte.projectId)
        .filter((agent) => agent.cardId === carte.id)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      for (const agent of agents) {
        const dernier = [...store.listMessages(agent.id, 60)].reverse().find((message) => message.todos.length);
        if (dernier) return { agentId: agent.id, etapes: dernier.todos };
      }
      return { agentId: agents[0]?.id ?? null, etapes: [] };
    }

    case 'statistiques.etudierSite': {
      // Les accès partent au coffre-fort, jamais dans la carte ni dans le journal.
      const { etudierLeSite } = await import('./statistiques.js');
      const { card, deja, fiche } = await etudierLeSite(String(cmd.id ?? ''), { identifiant: cmd.identifiant, motDePasse: cmd.motDePasse });
      return { card, deja, fiche };
    }

    /* -------- Atelier marketing -------- */

    case 'marketing.lister':
      return { projets: vueDEnsembleMarketing(), jours: joursDeTendanceMarketing() };

    case 'marketing.espace':
      return espaceMarketingComplet(String(cmd.projectId ?? ''), typeof cmd.jours === 'number' ? cmd.jours : 30);

    case 'marketing.assistant':
      // Le tour part sans retenir l'écran : la conversation se suit dans l'écran Marketing.
      return await lancerAgentMarketing({
        projectId: String(cmd.projectId ?? ''),
        demande: cmd.geste === 'initialiser' || cmd.geste === 'reanalyser' ? demandeDuGeste(cmd.geste) : String(cmd.demande ?? ''),
      });

    case 'marketing.configurer': {
      if (!store.getProject(String(cmd.projectId ?? ''))) throw new Error('projet introuvable');
      return { espace: ecrireConfigurationMarketing(String(cmd.projectId), cmd.configuration ?? {}) };
    }

    case 'marketing.activer': {
      if (!store.getProject(String(cmd.projectId ?? ''))) throw new Error('projet introuvable');
      return { espace: ecrireActifMarketing(String(cmd.projectId), cmd.actif !== false) };
    }

    case 'marketing.installerSuivi': {
      // LA carte du suivi du projet : créée au premier clic, rendue telle quelle ensuite.
      const { installerLeSuivi } = await import('./suivi-par-defaut.js');
      const { card, deja } = await installerLeSuivi(String(cmd.projectId ?? ''));
      return { card, deja };
    }

    case 'marketing.fiche': {
      if (!store.getProject(String(cmd.projectId ?? ''))) throw new Error('projet introuvable');
      return { espace: ecrireFicheMarketing(String(cmd.projectId), cmd.fiche ?? {}) };
    }

    case 'marketing.contenu.creer': {
      const r = creerContenuMarketing({
        projectId: String(cmd.projectId ?? ''),
        genre: cmd.genre,
        canal: cmd.canal,
        titre: cmd.titre,
        texte: cmd.texte,
        datePrevue: cmd.datePrevue,
        etape: 'brouillon',
        origine: 'humain',
      });
      if (!r.ok) throw new Error(r.raison);
      return { contenu: r.contenu };
    }

    case 'marketing.contenu.modifier': {
      const r = modifierContenuMarketing(String(cmd.id ?? ''), cmd, 'humain');
      if (!r.ok) throw new Error(r.raison);
      return { contenu: r.contenu };
    }

    case 'marketing.contenu.etape': {
      const r = changerEtapeMarketing(String(cmd.id ?? ''), cmd.etape, 'humain');
      if (!r.ok) throw new Error(r.raison);
      return { contenu: r.contenu };
    }

    case 'marketing.action.faite': {
      const r = marquerActionFaiteMarketing(String(cmd.id ?? ''), cmd.fait === true);
      if (!r.ok) throw new Error(r.raison);
      return { action: r.action };
    }

    case 'marketing.action.modifier': {
      const projet = String(cmd.projectId ?? '');
      const r = ecrireActionMarketing(projet, { id: cmd.id, datePrevue: cmd.datePrevue });
      if (!r.ok) throw new Error(r.raison);
      return { action: r.action };
    }

    case 'marketing.contenu.supprimer': {
      const r = supprimerContenuMarketing(String(cmd.id ?? ''));
      if (!r.ok) throw new Error(r.raison ?? 'contenu introuvable');
      return { ok: true };
    }

    /* -------- Surveillance des sites -------- */

    case 'surveillance.lister':
      return { sites: listerSites() };

    case 'surveillance.ajouter': {
      const resultat = ajouterSite(cmd.url, cmd.nom);
      if (!resultat.ok) throw new Error(resultat.raison);
      return { site: resultat.site, sites: listerSites() };
    }

    case 'surveillance.supprimer': {
      const resultat = supprimerSite(String(cmd.id ?? ''));
      if (!resultat.ok) throw new Error(resultat.raison ?? 'adresse introuvable');
      return { ok: true, sites: listerSites() };
    }

    case 'surveillance.verifier': {
      // Sans identifiant, on relance TOUT : c'est le bouton « Vérifier
      // maintenant » de la fenêtre, qui ne doit pas attendre l'heure suivante.
      const sites = await verifierSites(cmd.id ? [cmd.id] : listerSites().map((site) => site.id));
      return { sites: sites.length ? sites : listerSites() };
    }

    case 'surveillance.historique': {
      const id = String(cmd.id ?? '');
      if (!lireSurveillance(id)) throw new Error('surveillance introuvable');
      return { controles: listerControles(id) };
    }

    case 'surveillance.assistant': {
      // Le tour part sans retenir l'écran : la conversation se suit dans le tiroir.
      return await lancerAssistantDeSurveillance({ demande: String(cmd.demande ?? ''), id: cmd.id ? String(cmd.id) : null });
    }

    /*
     * LE PROJET D'UN SITE, CHOISI À LA MAIN SUR SA FICHE. Sans `projectId`, la
     * fiche revient à « deviner d'après l'adresse » et le rattachement
     * automatique reprend la main (`server/src/depannage-site.ts`).
     */
    case 'surveillance.rattacher': {
      const id = String(cmd.id ?? '');
      if (!lireSurveillance(id)) throw new Error('surveillance introuvable');
      const projectId = cmd.projectId ? String(cmd.projectId) : null;
      if (projectId && !store.getProject(projectId)) throw new Error('projet introuvable');
      rattacherLeProjetDuSite(id, projectId);
      return { sites: listerSites() };
    }


    case 'erreurs.liste':
      return {
        erreurs: dernieresErreursInterface(cmd.limite ?? ERREURS_MONTREES_REGLAGES),
        total: compterErreursInterface(),
      };

    case 'erreurs.effacer':
      return { ok: effacerErreursInterface() };

    case 'daemon.status':
      return { etat: etatDemon() };

    case 'daemon.restart': {
      // On répond AVANT de couper : sinon le navigateur ne voit qu'une
      // déconnexion, sans savoir si sa demande est passée. Un agent au travail
      // ou une publication en cours REFUSENT le redémarrage ordinaire et disent
      // pourquoi — la demande est retenue et partira toute seule dès le
      // dernier travail fini.
      //
      // `force` est l'autre chemin, et le seul qui passe outre : le travail en
      // cours est enregistré, tout est coupé en force, puis le serveur repart.
      // Il ne vient que du second bouton de la fenêtre, après que celle-ci a
      // nommé ce qui allait être interrompu.
      return await demanderRedemarrage({ force: cmd.force === true });
    }

    case 'backup.now': {
      const result = await runBackup('à la demande');
      if (result.ok && result.file) {
        const check = await verifyBackup(result.file);
        return { ...result, verification: check };
      }
      return result;
    }

    case 'backup.list':
      return { backups: listBackups() };

    /* -------- Export et import intégral des données -------- */

    case 'donnees.categories':
      return etatDesCategories();

    case 'donnees.exporter': {
      // L'archive est écrite dans les archives temporaires, comme celle d'un
      // dossier de projet : l'écran ne reçoit qu'un JETON de téléchargement,
      // jamais des mégaoctets par le canal du protocole.
      const resultat = await exporterDonnees(Array.isArray(cmd.categories) ? cmd.categories.map(String) : undefined);
      if (!resultat.ok) throw new Error(resultat.erreur);
      return {
        token: mintDownload(resultat.file, resultat.name),
        name: resultat.name,
        size: resultat.size,
        manifeste: resultat.manifeste,
      };
    }

    case 'donnees.importer': {
      // L'archive a déjà été déposée par `/api/donnees/archive` : on ne la fait
      // pas remonter une seconde fois pour la seule raison qu'on a coché des
      // cases entre-temps.
      const archive = lireDepot(String(cmd.depot ?? ''));
      if (!archive) throw new Error('archive introuvable : elle a expiré, redéposez le fichier');
      const bilan = importerDonnees(
        archive,
        Array.isArray(cmd.categories) ? cmd.categories.map(String) : [],
        cmd.politique === 'remplacer' || cmd.politique === 'remettre-a-zero' ? cmd.politique : 'ignorer',
      );
      if (!bilan.ok) throw new Error(bilan.erreur ?? 'import impossible');
      return { bilan };
    }

    case 'digest.speak':
      return { text: digestText(cmd.projectId) };

    case 'voice.list':
      return { voices: listVoices() };

    /*
     * UNE PHRASE DICTÉE, SANS DESTINATAIRE. L'assistant global la route vers le
     * chef d'orchestre du bon projet, ou pose la question quand il ne sait pas.
     * Il ne crée aucune carte : c'est le chef du projet qui garde son tri.
     */
    case 'voix.demande':
      return deposerDemandeDictee(cmd.texte);

    /*
     * LA MARCHE À SUIVRE D'UNE ÉTAPE DE MISE EN LIGNE, un tour à la fois :
     * l'agent lit le projet, tranche et écrit la procédure. C'est lui qui
     * l'enregistre, sur la CIBLE demandée — celle de la rubrique d'où l'on
     * vient, jamais l'autre. La description encore en cours de saisie voyage
     * avec la demande : sans elle, l'agent lirait l'ancienne.
     */
    case 'procedure.tour':
      return {
        etat: tourDeProcedure({
          projectId: cmd.projectId,
          cible: cmd.cible,
          agentId: cmd.agentId,
          message: cmd.message,
          base: cmd.base,
        }),
      };

    /*
     * L'ÉTAT du dialogue, sans lancer aucun tour : le tiroir le demande à son
     * ouverture (pour se raccrocher à un tour qui tourne déjà, au lieu d'en
     * payer un second) et pendant l'attente (un état disparu = un tour perdu,
     * qui se DIT au lieu de faire tourner le témoin sans fin).
     */
    case 'procedure.etat':
      return { etat: etatDeProcedure(cmd.projectId, cmd.cible) };

    /*
     * Le relevé de consommation, plus la PART DE L'ENTRÉE RELUE AU CACHE sur
     * sept jours : c'est elle qui dit si le début des sessions reste stable.
     * Elle tombe dès qu'un préfixe se met à bouger (`shared/src/prefixe-cache.ts`).
     */
    case 'stats.usage': {
      const parMoteur = store.entreesParMoteur(JOURS_DE_CACHE);
      return {
        byProject: store.usageByProject(),
        byMonth: store.usageByMonth(),
        cache: { jours: JOURS_DE_CACHE, total: partRelueAuCache(parMoteur), parMoteur },
        deployable: cmd.projectId ? deployableCards(cmd.projectId).length : undefined,
      };
    }

    case 'card.quota':
      return store.usageQuotaByCard(cmd.cardId);

    case 'stats.dashboard': {
      // Le titre et le projet d'une carte vivent dans son JSON, pas dans la
      // table `usage` : on raccroche la conso par carte aux cartes de tous les
      // projets (archivés compris — une conso passée garde son nom).
      const cartes = new Map<string, { title: string; projectName?: string }>();
      for (const project of store.listProjects(true)) {
        for (const card of store.listCards(project.id)) {
          cartes.set(card.id, { title: card.title, projectName: project.name });
        }
      }
      /*
       * L'HISTORIQUE DES TÂCHES EXÉCUTÉES, la plus récente d'abord : une ligne
       * par tour réellement parti, avec ses jetons d'entrée et de sortie RÉELS
       * (`store.usageHistorique`, colonnes `input_tokens` / `output_tokens` —
       * jamais une estimation). Le titre et le projet se raccrochent à la même
       * carte `cartes` que ci-dessus ; une carte retirée garde sa ligne.
       */
      const historique = store.usageHistorique(30).map((ligne) => {
        const carte = cartes.get(ligne.cardId);
        return {
          cardId: ligne.cardId,
          title: carte?.title ?? 'Carte retirée',
          projectName: carte?.projectName,
          at: ligne.at,
          inputTokens: ligne.inputTokens,
          outputTokens: ligne.outputTokens,
          tokens: ligne.tokens,
        };
      });

      return {
        byProject: store.usageByProject(),
        byDay: store.usageByDay(30),
        historique,
      };
    }

    /*
     * LA TÉLÉMÉTRIE DES TÂCHES. Le serveur ne fait que RACCROCHER les mesures
     * déjà écrites (`telemetrie_tache`) au titre et au projet de leur carte ;
     * la note de qualité et les courbes de tendance sont des règles PURES
     * (`shared/src/telemetrie-tache.ts`), donc rejouables sans base.
     *
     * Une carte SUPPRIMÉE garde sa ligne : la tâche a bien tourné, et l'effacer
     * de la moyenne réécrirait l'histoire d'une semaine.
     */
    case 'projects.activite': {
      return { activite: store.activiteDesProjets() };
    }

    case 'stats.telemetrie': {
      const jours = Math.max(1, Math.min(90, Math.round(cmd.jours ?? JOURS_DE_TENDANCE)));
      const titres = new Map<string, { titre: string; projet?: string }>();
      for (const project of store.listProjects(true)) {
        for (const card of store.listCards(project.id)) {
          titres.set(card.id, { titre: card.title, projet: project.name });
        }
      }
      const mesures = store.telemetrieDesTaches(jours).map((mesure) => ({
        ...mesure,
        titre: titres.get(mesure.cardId)?.titre,
        projet: titres.get(mesure.cardId)?.projet,
      }));
      return {
        jours,
        taches: mesures.map((mesure) => ({ ...mesure, qualite: noteDeQualite(mesure) })),
        tendances: tendancesParJour(mesures, Date.now(), jours),
        resume: resumeDeTendance(mesures),
        /* Les deux références de la note, pour que l'écran puisse dire d'où elle sort. */
        references: { jetons: JETONS_DE_REFERENCE, secondes: SECONDES_DE_REFERENCE },
      };
    }

    case 'memory.get': {
      const project = store.getProject(cmd.projectId);
      if (!project) throw new Error('projet introuvable');
      // La mémoire du projet se lit dans la base de connaissances : la portée du projet, en un seul document.
      const content = markdownDeLaPortee(project.id);
      bus.emit({ type: 'memory', projectId: cmd.projectId, content });
      return { content };
    }

    case 'slash.list': {
      const project = store.getProject(cmd.projectId);
      if (!project) throw new Error('projet introuvable');
      const commandes = relevesDesCommandes(project.path);
      bus.emit({ type: 'slash', projectId: cmd.projectId, commandes });
      return { commandes };
    }

    default: {
      const exhaustive: never = cmd;
      throw new Error(`commande inconnue : ${JSON.stringify(exhaustive)}`);
    }
  }
}
