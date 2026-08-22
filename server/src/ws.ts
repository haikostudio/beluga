import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  economieMemoire,
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
  construireParcours,
  effetDuDepot,
  etapeDeLaColonne,
  niveauDAccueil,
  partsDAccueil,
  totalDuParcours,
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
  raisonDattente,
  accorderRunDeProposition,
  CLE_PROJET_ACTIF,
  agentsDuPremierEnvoi,
  choisirProjetAOuvrir,
  lireLienGithub,
  REFUS_LIEN_MAL_FORME,
} from '@haikodev/shared';
import { catalogueMoteurs } from './catalogue-moteurs.js';
import * as store from './store.js';
import { bus } from './bus.js';
import { CONFIG } from './config.js';
import { isAuthenticated } from './http.js';
import { cachedEngines, enginesFrais, listEngines } from './engines/index.js';
import { normaliseThinking } from './engines/catalog.js';
import {
  cachedQuotas,
  cleDuCompteCursor,
  declarerCleCursor,
  listAccountRecords,
  refreshQuotas,
  renameAccount,
  setAccountDisabled,
} from './accounts.js';
import { creditCursor, etatDuCompteCursor } from './engines/cursor.js';
import { changerLEtat, etatDuPoolPourLEcran, relierCompetencesAuxCoffres } from './competences.js';
import { capitaliserMaintenant, jugementDeLaCarte } from './capitalisation.js';
import { annulerConnexion, connexionsEnCours, demarrerConnexion, envoyerCode } from './connexion-compte.js';
import { reprendreSurCompte } from './reprise-compte.js';
import { snapshot, listProcesses, controlProcess } from './capacity.js';
import { createAgent, sendPrompt, stopAgent, arreterLAgent, stopAllAgents, isRunning } from './runtime.js';
import { getOrCreateOrchestrator } from './orchestrator.js';
import { deposerDemandeDictee, repondreALaDictee } from './routage-vocal.js';
import { genererPromptDeProduction } from './mise-en-production.js';
import { etatDeProcedure, tourDeProcedure } from './procedure-publication.js';
import { appliquerChiffrageDiscute, ecartChiffrage, startCard, tick, validerCarte } from './scheduler.js';
import { createCard } from './tools.js';
import { iconeManquante, recupererFaviconEnTache } from './favicon.js';
import { personnagesRemplaces } from './personnages.js';
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
} from './deploy.js';
import { rangerLaCarte, suspendreLaCarte } from './deplacement-carte.js';
import { annulerLAttente, repondreALAttente } from './attente-question.js';
import { archiveCard } from './archive.js';
import { etatDemon, demanderRedemarrage } from './demon.js';
import { envoyerAuCerveau, etatCerveau } from './cerveau.js';
import { enregistrerCleCerveau } from './cle-cerveau.js';
import { creerCleApi, listerClesApi, oublierCleApi, revoquerCleApi } from './cles-api.js';
import { enregistrerAcces, listerAcces, supprimerAcces } from './coffre-fort.js';
import {
  compterErreursInterface,
  dernieresErreursInterface,
  effacerErreursInterface,
} from './erreurs-interface.js';
import { listDir, makeZip, readFilePreview } from './files.js';
import { mintDownload } from './auth.js';
import { readMemory } from './memory.js';
import { relevesDesCommandes } from './commandes-slash.js';
import { scanProjects, registerProject, reorderProjects, createProjectFolder } from './projects.js';
import { depotsDuCompte, monterDepuisGithub } from './depots-github.js';
import { testerConnexionVps } from './acces-vps.js';
import * as billing from './billing.js';
import * as github from './github.js';
import { runBackup, listBackups, verifyBackup } from './backup.js';
import { digestText, listVoices } from './voice.js';
import { notify } from './notify.js';
import { log } from './logger.js';

export function attachWebSocket(server: http.Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/ws')) {
      socket.destroy();
      return;
    }
    if (!isAuthenticated(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket) => {
    const send = (event: ServerEvent) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
    };
    const unsubscribe = bus.subscribe(send);

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
    send({ type: 'plans', ...store.signalPlans() });
    // Les personnages remplacés à la main : le tableau doit les connaître AVANT
    // de poser ses images, sinon il afficherait l'ancien puis le remplacerait
    // sous les yeux. Lecture de deux dossiers, rien de plus.
    send({ type: 'personnages', remplaces: personnagesRemplaces() });

    const projets = store.listProjects();
    const prefs = store.readPreferences();
    // Le même choix que fera le navigateur : ses cartes partent donc SANS
    // attendre qu'il les demande — un aller-retour de moins avant le tableau.
    const choix = choisirProjetAOuvrir(projets, prefs[CLE_PROJET_ACTIF]);
    const projetOuvert = choix.id && store.getProject(choix.id) ? choix.id : null;

    send({
      type: 'ready',
      protocol: PROTOCOL_VERSION,
      version: CONFIG.version,
      settings: store.getSettings(),
      prefs,
      projects: projets,
      groups: store.listGroups(),
      engines: cachedEngines(),
      quotas: cachedQuotas(),
      capacity: snapshot(),
      agents: agentsDuPremierEnvoi(store.listAgents(), projetOuvert, Date.now()),
      openedProjectId: projetOuvert ?? undefined,
    });

    if (projetOuvert) {
      const projet = store.getProject(projetOuvert)!;
      send({
        type: 'project.snapshot',
        projectId: projetOuvert,
        cards: store.listCards(projetOuvert),
        agents: store.listAgents(projetOuvert),
        deploy: store.latestDeploy(projetOuvert) ?? undefined,
        memory: readMemory(projet.path),
      });
    }

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
        const data = await handleCommand(envelope.cmd);
        if (envelope.id) send({ type: 'ack', id: envelope.id, ok: true, data });
      } catch (err: any) {
        log.warn(`commande ${envelope.cmd.type} refusée :`, err?.message ?? err);
        if (envelope.id) send({ type: 'ack', id: envelope.id, ok: false, error: err?.message ?? String(err) });
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
 * La conversation d'un agent telle qu'elle doit s'afficher : depuis le dernier
 * nouveau départ, avec le compte de ce qui dort derrière. `tout` rouvre le fil
 * entier — rien n'ayant jamais été supprimé, il est toujours là.
 */
function envoyerConversation(agentId: string, tout = false): void {
  const messages = store.listMessages(agentId);
  const depuis = store.nouveauDepart(agentId);
  bus.emit({
    type: 'agent.snapshot',
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
}

async function handleCommand(cmd: ClientEnvelope['cmd']): Promise<unknown> {
  switch (cmd.type) {
    case 'hello':
    case 'ping':
      return { at: Date.now() };

    /* -------- Projets -------- */

    case 'project.list':
      return { projects: store.listProjects(cmd.includeArchived ?? false) };

    case 'project.archive': {
      const project = store.getProject(cmd.id);
      if (!project) throw new Error('projet introuvable');
      const updated = store.saveProject({ ...project, archived: cmd.archived });
      bus.emit({ type: 'project.upsert', project: updated });
      bus.toast('info', cmd.archived ? `« ${project.name} » mis de côté` : `« ${project.name} » remis en service`);
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
      const updated = store.saveProject(Project.parse({ ...current, ...cmd.patch, id: current.id }));
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
      return { project: updated };
    }

    case 'project.faviconRetry': {
      const project = store.getProject(cmd.id);
      if (!project) throw new Error('projet introuvable');
      // Sans adresse, l'icône se cherche dans le DÉPÔT : ce n'est plus un refus.
      recupererFaviconEnTache(project);
      return { ok: true };
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

    case 'project.delete': {
      store.deleteProject(cmd.id);
      bus.emit({ type: 'project.delete', id: cmd.id });
      return { ok: true };
    }

    case 'project.open': {
      const project = store.getProject(cmd.id);
      if (!project) throw new Error('projet introuvable');
      bus.emit({
        type: 'project.snapshot',
        projectId: cmd.id,
        cards: store.listCards(cmd.id),
        agents: store.listAgents(cmd.id),
        deploy: store.latestDeploy(cmd.id) ?? undefined,
        memory: readMemory(project.path),
      });
      return { ok: true };
    }

    case 'project.scan':
      return { found: await scanProjects() };

    case 'project.group': {
      const project = store.getProject(cmd.id);
      if (!project) throw new Error('projet introuvable');
      const updated = store.saveProject({ ...project, groupId: cmd.groupId || undefined });
      bus.emit({ type: 'project.upsert', project: updated });
      return { project: updated };
    }

    case 'group.list':
      return { groups: store.listGroups() };

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

    case 'group.reorder': {
      cmd.ids.forEach((id, index) => {
        const group = store.listGroups().find((g) => g.id === id);
        if (group) store.saveGroup({ ...group, rank: (index + 1) * 10 });
      });
      bus.emit({ type: 'groups', groups: store.listGroups() });
      return { groups: store.listGroups() };
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
        if (project) {
          store.saveProject({ ...project, rank, groupId: item.groupId || undefined });
        }
      });
      const projects = store.listProjects();
      for (const project of projects) bus.emit({ type: 'project.upsert', project });
      bus.emit({ type: 'groups', groups: store.listGroups() });
      return { projects, groups: store.listGroups() };
    }

    case 'project.reorder': {
      const projects = reorderProjects(cmd.ids);
      for (const project of projects) bus.emit({ type: 'project.upsert', project });
      return { projects };
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
      });
      bus.emit({ type: 'card.upsert', card });
      return { card };
    }

    case 'card.update': {
      const card = store.getCard(cmd.id);
      if (!card) throw new Error('carte introuvable');
      const patch = { ...cmd.patch };
      delete (patch as any).column; // une colonne se change par card.move
      const title = typeof patch.title === 'string' ? patch.title : card.title;
      const description = typeof patch.description === 'string' ? patch.description : card.description;
      const updated = store.saveCard(Card.parse({
        ...card,
        ...patch,
        ...heritageAnalyseDeProposition(card, title, description),
        id: card.id,
      }));
      bus.emit({ type: 'card.upsert', card: updated });
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
       * Le dépôt VAUT le geste que la colonne d'arrivée désigne. Le lancement
       * n'a pas de chemin à lui : il passe par `startCard`, exactement comme le
       * bouton « Lancer maintenant » — mêmes portes dures, même branche, même
       * agent, même trace dans la conversation. Un refus REMONTE, il ne se
       * traduit jamais par un déplacement silencieux qui ne lancerait rien.
       */
      const effet = effetDuDepot(card.column, target);
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
        void archiveCard(updated.id);
      }
      return { card: updated };
    }

    case 'card.delete': {
      const card = store.getCard(cmd.id);
      if (!card) throw new Error('carte introuvable');
      store.deleteCard(cmd.id);
      bus.emit({ type: 'card.delete', id: cmd.id, projectId: card.projectId });
      bus.emit({ type: 'rendus', byProject: store.projectsWithFinishedWork() });
      return { ok: true };
    }

    case 'card.validate': {
      const result = validerCarte(cmd.id);
      if (!result.ok) throw new Error(result.error ?? 'validation impossible');
      return { card: store.getCard(cmd.id) };
    }

    case 'card.start': {
      const result = await startCard(cmd.id);
      if (!result.ok) throw new Error(result.error ?? 'démarrage impossible');
      return result;
    }

    case 'card.finish': {
      const card = store.getCard(cmd.id);
      if (!card) throw new Error('carte introuvable');
      if (card.agentId && isRunning(card.agentId)) stopAgent(card.agentId);
      const updated = store.saveCard({
        ...card,
        column: 'done',
        position: store.nextPosition(card.projectId, 'done'),
        doneAt: Date.now(),
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

    /*
     * L'HEURE DITE, posée ou retirée à la main. La date ne lance rien elle-même :
     * elle autorise le départ, et c'est la boucle de l'ordonnanceur qui lancera
     * la carte par `startCard` — mêmes portes dures, même branche, même agent que
     * le bouton. On rappelle la boucle tout de suite : une date déjà passée ne
     * doit pas attendre quinze secondes de plus.
     */
    case 'card.schedule': {
      const card = store.getCard(cmd.id);
      if (!card) throw new Error('carte introuvable');
      const scheduling = { ...(card.scheduling ?? { attempts: 0, restarts: 0, asap: false }) };
      scheduling.departPrevu = cmd.at ?? undefined;
      // Le geste de l'utilisateur — poser SA date, ou la retirer — l'emporte
      // sur le créneau conseillé : cette date-là n'a plus besoin d'être
      // expliquée, elle est déjà la réponse de l'utilisateur.
      scheduling.creneauAutomatique = false;
      // La phrase d'attente suit ce qui retient VRAIMENT la carte : sans date,
      // elle attend de nouveau un clic ; avec une date, elle n'attend personne.
      scheduling.waitingReason = raisonDattente(scheduling);
      const updated = store.saveCard({ ...card, scheduling });
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
      bus.emit({
        type: 'card.conversation',
        cardId: cmd.cardId,
        messages,
        activeAgentId: dernier?.id ?? card.agentId,
      });

      // Lire, c'est éteindre la pastille — de cette carte, et d'elle seule.
      marquerLue(cmd.cardId);
      return { messages: messages.length };
    }

    case 'card.read': {
      marquerLue(cmd.cardId);
      return { ok: true };
    }

    /*
     * Tout lire d'un geste, depuis la liste des projets. Seules les cartes
     * réellement non lues sont touchées : réécrire tout le tableau pour éteindre
     * une pastille ferait beaucoup de bruit pour rien.
     */
    case 'project.read': {
      const touchees = store.markProjectRead(cmd.projectId);
      for (const carte of touchees) bus.emit({ type: 'card.upsert', card: carte });
      bus.emit({ type: 'rendus', byProject: store.projectsWithFinishedWork() });
      return { lues: touchees.length };
    }

    /*
     * Ouvrir un projet éteint son point bleu, sans marquer une seule carte
     * comme lue : seule la visite compte, `project.read` reste le geste à
     * part qui, lui, touche les cartes.
     */
    case 'project.visit': {
      const projet = store.markProjectVisited(cmd.projectId);
      if (projet) bus.emit({ type: 'project.upsert', project: projet });
      bus.emit({ type: 'rendus', byProject: store.projectsWithFinishedWork() });
      return { ok: !!projet };
    }

    case 'agent.orchestrator': {
      const agent = await getOrCreateOrchestrator(cmd.projectId);
      envoyerConversation(agent.id, cmd.tout);
      return { agent };
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
      store.oublierMemoireServie(agent.id);
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
          ? (text: string, ok: boolean, measurement: import('@haikodev/shared').TurnMeasurement) =>
              appliquerChiffrageDiscute(agent.cardId!, text, ok, measurement)
          : undefined;
      /*
       * ON N'ATTEND PAS LA FIN DU TOUR. Un tour dure des minutes ; attendre
       * ici faisait expirer la commande côté navigateur au bout de deux
       * minutes, et le message semblait n'être jamais parti (il revenait
       * même dans la barre d'écriture). La suite arrive par abonnement.
       */
      void sendPrompt(cmd.agentId, cmd.text, { attachments: cmd.attachments, onComplete }).catch((err) =>
        log.error('envoi de la demande impossible', err),
      );
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
      if (vides) bus.emit({ type: 'queue.snapshot', agentId: cmd.agentId, queue: [] });

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
        if (vides) bus.emit({ type: 'queue.snapshot', agentId: agent.id, queue: [] });
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
        bus.emit({ type: 'capacity', capacity: capacity.snapshot() }),
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
        mode: cmd.run.mode ?? agent.run.mode,
        account,
      };
      const updated = store.saveAgent({
        ...agent,
        run: run as any,
        // Changer de moteur ou de modèle ouvre un autre fil : l'ancienne
        // mesure ne décrit plus le contexte qui sera utilisé.
        contextUsage: modelChanged ? undefined : agent.contextUsage,
      });
      bus.emit({ type: 'agent.upsert', agent: updated });

      // Le réglage d'un chef d'orchestre devient le réglage retenu : les chefs
      // d'orchestre créés ensuite le reprennent au lieu du modèle épinglé.
      if (agent.role === 'orchestrator') {
        const settings = store.saveSettings({
          orchestratorEngine: run.engine,
          orchestratorModel: run.model,
          orchestratorThinking: run.thinking,
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

    case 'agent.dismiss': {
      const agent = store.getAgent(cmd.agentId);
      if (!agent) return { ok: true };
      // La croix retire la vignette SANS arrêter l'agent (PLAN §28).
      const updated = store.saveAgent({ ...agent, status: agent.status === 'running' ? 'running' : 'idle' });
      bus.emit({ type: 'agent.upsert', agent: updated });
      return { ok: true };
    }

    case 'queue.update': {
      const item = store.updateQueued(cmd.id, cmd.text);
      if (item) bus.emit({ type: 'queue.snapshot', agentId: item.agentId, queue: store.listQueue(item.agentId) });
      return { ok: !!item };
    }

    case 'queue.remove': {
      const agentId = store.removeQueued(cmd.id);
      if (agentId) bus.emit({ type: 'queue.snapshot', agentId, queue: store.listQueue(agentId) });
      return { ok: !!agentId };
    }

    case 'queue.reorder': {
      store.reorderQueue(cmd.agentId, cmd.ids);
      bus.emit({ type: 'queue.snapshot', agentId: cmd.agentId, queue: store.listQueue(cmd.agentId) });
      return { ok: true };
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
     * POURSUIVRE APRÈS ÉPUISEMENT. Tout se joue dans `reprendreSurCompte` :
     * relevé frais du compte visé, décision fermée AVANT le lancement (donc un
     * double clic ne lance rien), puis reprise du même agent. Un refus rend son
     * motif en français, sans rien lancer.
     */
    case 'reprise.compte': {
      const resultat = await reprendreSurCompte(cmd.messageId, cmd.accountId);
      if (!resultat.ok) throw new Error(resultat.error ?? 'reprise impossible');
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
      const result = await startDeploy(cmd.projectId, { cible: cmd.cible, selectedCardIds: cmd.selectedCardIds });
      if (!result.ok) throw new Error(result.error ?? 'publication impossible');
      return result;
    }

    case 'deploy.stop':
      return { stopped: stopDeploy(cmd.runId) };

    case 'deploy.retry':
      return retryDeploy(cmd.runId);

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

    /* -------- Fichiers -------- */

    case 'files.list': {
      const project = store.getProject(cmd.projectId);
      if (!project) throw new Error('projet introuvable');
      const nodes = listDir(project.path, cmd.path ?? '');
      bus.emit({ type: 'files', projectId: cmd.projectId, path: cmd.path ?? '', nodes });
      return { nodes };
    }

    case 'files.read': {
      const project = store.getProject(cmd.projectId);
      if (!project) throw new Error('projet introuvable');
      return readFilePreview(project.path, cmd.path);
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

    case 'vps.test':
      return await testerConnexionVps();

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

    case 'engines.list':
      return { engines: await listEngines(true) };

    /*
     * L'ÉTAT D'UN COMPTE CURSOR. Ce moteur ne publie aucune fenêtre de
     * pourcentage : la ligne de compte montre le crédit et l'usage. Ce que
     * cette commande ajoute — pour savoir si le compte peut travailler —,
     * c'est si la clé répond et si l'outil « cursor-agent » est sur le serveur.
     */
    /*
     * LE POOL DE COMPÉTENCES. Deux commandes seulement, et aucune n'écrit de
     * fiche : l'écran LIT le pool et change l'ÉTAT d'une fiche ; écrire une
     * compétence reste le travail d'un agent, à travers le contrôle de qualité.
     */
    case 'competences.etat':
      return { pool: etatDuPoolPourLEcran() };

    case 'competences.etatDeLaFiche': {
      const resultat = changerLEtat(cmd.nom, cmd.etat);
      if (!resultat.ok) throw new Error((resultat.raisons ?? ['changement impossible']).join(' ; '));
      // Le coffre des comptes Claude suit : une fiche archivée ne doit plus s'y
      // trouver au prochain tour.
      relierCompetencesAuxCoffres();
      const pool = etatDuPoolPourLEcran();
      bus.emit({ type: 'competences', pool });
      return { pool };
    }

    case 'card.capitaliser': {
      const resultat = await capitaliserMaintenant(cmd.cardId);
      if (!resultat.ok) throw new Error(resultat.raison ?? 'capitalisation impossible');
      return { ok: true };
    }

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

    case 'quota.history':
      // La courbe ne montre que les derniers jours ; le RÉSUMÉ, lui, part avec
      // elle pour que le profil des heures creuses remonte à deux mois.
      return { history: store.quotaHistory(cmd.days ?? 7), resume: store.quotaResume() };

    case 'amorce.history':
      return { entries: store.amorceHistory(cmd.limit ?? 40) };

    case 'cerveau.etat':
      return { etat: etatCerveau() };

    case 'cerveau.envoyer': {
      const resultat = await envoyerAuCerveau({ force: true });
      return { resultat, etat: etatCerveau() };
    }

    case 'cerveau.cle': {
      // La clé vaut aussitôt : pas de redémarrage entre la saisie et l'envoi.
      const pose = enregistrerCleCerveau(cmd.cle);
      return { pose, etat: etatCerveau() };
    }

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

    case 'coffre.lister':
      return { acces: listerAcces() };

    case 'coffre.enregistrer': {
      const resultat = enregistrerAcces(cmd.acces);
      if (!resultat.ok) throw new Error(resultat.raison);
      return { acces: resultat.acces, liste: listerAcces() };
    }

    case 'coffre.supprimer': {
      const resultat = supprimerAcces(String(cmd.id ?? ''));
      if (!resultat.ok) throw new Error(resultat.raison ?? 'accès introuvable');
      return { ok: true, liste: listerAcces() };
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
     * RÉDIGER le prompt de mise en production à partir du concept écrit à la
     * main, par un tour d'agent payant. On ne persiste ni ne déploie rien :
     * l'interface reçoit le texte, le montre, et l'enregistre par
     * `project.update`.
     */
    case 'production.generer':
      return genererPromptDeProduction(cmd.projectId, cmd.base);

    /*
     * LE TIROIR DE PROCÉDURE, un tour à la fois : l'agent pose sa question à
     * l'ouverture, puis écrit la procédure quand la réponse arrive. C'est lui
     * qui l'enregistre, sur la cible de la colonne d'où le tiroir a été ouvert.
     */
    case 'procedure.tour':
      return {
        etat: tourDeProcedure({
          projectId: cmd.projectId,
          cible: cmd.cible,
          agentId: cmd.agentId,
          message: cmd.message,
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

    case 'card.tokens':
      return { agents: store.usageTokensByCardAndAgent(cmd.cardId) };

    /*
     * LE PARCOURS D'UNE TÂCHE. Le serveur ne fait que RASSEMBLER des faits déjà
     * écrits — la carte, ses agents, leurs tours mesurés, les sujets de mémoire
     * qu'ils sont allés chercher — ; la mise en ordre est une règle pure
     * (`construireParcours`), donc lisible et testable sans base.
     */
    case 'card.parcours': {
      const card = store.getCard(cmd.cardId);
      if (!card) return { etapes: [] };

      const agents = store.agentsDeLaCarte(card.id).map((agent) => ({
        id: agent.id,
        role: agent.role,
        titre: agent.title,
        createdAt: agent.createdAt,
        tours: store.usageByAgent(agent.id),
        sujetsMemoire: store.sujetsMemoireDemandes(agent.id),
        passages: store.passagesRetrouves(agent.id),
        accueil: partsDAccueil(niveauDAccueil({ role: agent.role })),
      }));

      const ventilation = card.estimate?.analysisMeasurement?.breakdown;
      const lire = (part?: { status: string; characters?: number }) =>
        part?.status === 'measured' ? part.characters : undefined;

      const etapes = construireParcours({
        origin: card.origin,
        createdAt: card.createdAt,
        autorisee: card.analyseDemandee,
        colonne: card.column,
        doneAt: card.doneAt,
        deployedAt: card.deployedAt,
        archivedAt: card.archivedAt,
        tri:
          card.origineAgentId && card.origineAt
            ? {
                tours: store.usageTourCouvrant(card.origineAgentId, card.origineAt),
                sujetsMemoire: store.sujetsMemoireDemandes(card.origineAgentId),
              }
            : undefined,
        agents,
        ventilation: ventilation
          ? {
              consignes: lire(ventilation.haikoDevInstructions),
              description: lire(ventilation.cardDescription),
              memoireEtInstructions: lire(ventilation.memoryAndInstructions),
            }
          : undefined,
      });
      return {
        etapes,
        total: totalDuParcours(etapes),
        // La part de quota RÉELLEMENT consommée par la carte entière — même
        // source que `card.quota` (`usageQuotaByCard`), affichée ici À CÔTÉ du
        // parcours pour remplacer la projection retirée, jamais mêlée aux
        // jetons mesurés étape par étape.
        quota: store.usageQuotaByCard(cmd.cardId),
        /*
         * OÙ EN EST CETTE CARTE DANS LE POOL DE COMPÉTENCES — candidate, mûre,
         * publiée —, et POURQUOI elle en est là. C'est la réponse à « pourquoi
         * cette carte n'a rien donné ? », qu'il fallait deviner jusqu'ici.
         */
        capitalisation: jugementDeLaCarte(card),
      };
    }

    case 'stats.dashboard': {
      // Le titre, le projet et la colonne d'une carte vivent dans son JSON, pas
      // dans la table `usage` : on raccroche la conso par carte aux cartes de
      // tous les projets (archivés compris — une conso passée garde son nom).
      const cartes = new Map<string, { title: string; projectName?: string; column: string; quotaEstime?: number }>();
      for (const project of store.listProjects(true)) {
        for (const card of store.listCards(project.id)) {
          cartes.set(card.id, {
            title: card.title,
            projectName: project.name,
            column: card.column,
            // L'ESTIMATION faite à la validation, et rien d'autre : la part
            // réellement consommée vient des lignes `usage` (quota5h /
            // quotaSemaine ci-dessous), jamais du JSON de la carte. Les deux
            // voyagent séparément pour ne plus être confondues à l'écran.
            quotaEstime: card.estimate?.quotaShare,
          });
        }
      }
      const byCard = store.usageByCard().map((ligne) => {
        const carte = cartes.get(ligne.cardId);
        return {
          cardId: ligne.cardId,
          title: carte?.title ?? 'Carte retirée',
          projectName: carte?.projectName,
          column: carte?.column,
          // Mesuré, en points de pourcentage. 0 = aucun relevé (tâche ancienne).
          quota5h: ligne.quota5h,
          quotaSemaine: ligne.quotaSemaine,
          quotaEstime: carte?.quotaEstime,
          tokens: ligne.tokens,
          seconds: ligne.seconds,
          turns: ligne.turns,
        };
      });
      /*
       * CE QUE LE TRI DE LA MÉMOIRE A ÉCONOMISÉ SUR LE MOIS, CARTE PAR CARTE.
       *
       * Les deux poids sont relevés à chaque ouverture de mémoire
       * (`store.recordMemoryEconomy`) ; le rapport jetons → quota est DÉDUIT de
       * la consommation réelle de la même fenêtre, jamais supposé. Une carte
       * dont le titre a disparu garde sa ligne : l'économie a bien eu lieu.
       */
      const parJeton = store.quotaParJeton();
      const memoireCartes = store
        .memoryEconomyByCard()
        .map((ligne) => {
          const calcul = economieMemoire(ligne.entiers, ligne.servis, parJeton);
          return {
            cardId: ligne.cardId,
            title: cartes.get(ligne.cardId)?.title ?? 'Carte retirée',
            projectName: cartes.get(ligne.cardId)?.projectName,
            ouvertures: ligne.ouvertures,
            signesEvites: calcul.signesEvites,
            jetonsEvites: calcul.jetonsEvites,
            part: calcul.part,
            quotaEvite: calcul.quotaEvite,
          };
        })
        .filter((ligne) => ligne.signesEvites > 0);
      const totaux = store.memoryEconomyTotals();
      const memoireTotal = economieMemoire(totaux.entiers, totaux.servis, parJeton);

      return {
        byProject: store.usageByProject(),
        byDay: store.usageByDay(30),
        byCard,
        memoire: {
          jours: store.JOURS_D_ECONOMIE_MEMOIRE,
          ouvertures: totaux.ouvertures,
          cartes: memoireCartes.length,
          signesEvites: memoireTotal.signesEvites,
          jetonsEvites: memoireTotal.jetonsEvites,
          part: memoireTotal.part,
          quotaEvite: memoireTotal.quotaEvite,
          /** Le rapport RELEVÉ, pour que l'écran puisse dire d'où sort la part de quota. */
          quotaParJeton: parJeton ?? undefined,
          parCarte: memoireCartes,
        },
      };
    }

    case 'memory.get': {
      const project = store.getProject(cmd.projectId);
      if (!project) throw new Error('projet introuvable');
      const content = readMemory(project.path);
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
