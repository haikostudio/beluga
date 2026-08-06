import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  COLONNES_HORS_REPRISE,
  COLUMN_LABELS,
  Card,
  ClientEnvelope,
  ColumnKey,
  PROTOCOL_VERSION,
  Project,
  RunConfig,
  ServerEvent,
  canMove,
  derniersResultats,
  effetDuDepot,
  environnementVise,
  environnementsDuProjet,
  modifierEnvironnement,
  etatVisuelCarte,
  sortieAutorisee,
  RAISON_SUSPENDU,
  RAISON_ARRETE_A_LA_MAIN,
  arretDeCarteAutorise,
  comptePrecedents,
  messagesDepuis,
  peutRepartir,
  reglagesDeLaProposition,
} from '@haikodev/shared';
import { catalogueMoteurs } from './catalogue-moteurs.js';
import * as store from './store.js';
import { bus } from './bus.js';
import { CONFIG } from './config.js';
import { isAuthenticated } from './http.js';
import { listEngines } from './engines/index.js';
import { normaliseThinking } from './engines/catalog.js';
import { cachedQuotas, refreshQuotas, renameAccount, setAccountDisabled } from './accounts.js';
import { annulerConnexion, connexionsEnCours, demarrerConnexion, envoyerCode } from './connexion-compte.js';
import { snapshot, listProcesses, controlProcess } from './capacity.js';
import { createAgent, sendPrompt, stopAgent, isRunning } from './runtime.js';
import { getOrCreateOrchestrator } from './orchestrator.js';
import { analyseCard, startCard, tick } from './scheduler.js';
import { createCard } from './tools.js';
import {
  deployableCards,
  startDeploy,
  stopDeploy,
  retryDeploy,
  conflitsPrevus,
  agentsOccupes,
  commitsEnAttente,
  environnementsDePublication,
  moyenDeMiseEnLigne,
} from './deploy.js';
import { archiveCard } from './archive.js';
import { etatDemon, redemarrerDemon } from './demon.js';
import { envoyerAuCerveau, etatCerveau } from './cerveau.js';
import { enregistrerCleCerveau } from './cle-cerveau.js';
import { listDir, makeZip, readFilePreview } from './files.js';
import { mintDownload } from './auth.js';
import { readMemory } from './memory.js';
import { scanProjects, registerProject, reorderProjects, createProjectFolder } from './projects.js';
import { publishSubdomain } from './dns.js';
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

    void (async () => {
      send({ type: 'attention', ...store.signalAttention() });
      send({ type: 'rendus', byProject: store.projectsWithFinishedWork() });
      send({
        type: 'ready',
        protocol: PROTOCOL_VERSION,
        version: CONFIG.version,
        settings: store.getSettings(),
        prefs: store.readPreferences(),
        projects: store.listProjects(),
        groups: store.listGroups(),
        engines: await listEngines(),
        quotas: cachedQuotas().length ? cachedQuotas() : await refreshQuotas(),
        capacity: snapshot(),
        agents: store.listAgents(),
      });
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
        deployCommand: cmd.deployCommand,
        deployUrl: cmd.deployUrl,
      });
      bus.emit({ type: 'project.upsert', project });
      return { project };
    }

    case 'project.update': {
      const current = store.getProject(cmd.id);
      if (!current) throw new Error('projet introuvable');
      const updated = store.saveProject(Project.parse({ ...current, ...cmd.patch, id: current.id }));
      bus.emit({ type: 'project.upsert', project: updated });
      return { project: updated };
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

    case 'project.publishDomain': {
      const project = store.getProject(cmd.id);
      if (!project) throw new Error('projet introuvable');
      const result = await publishSubdomain(cmd.subdomain, cmd.port);
      if (!result.ok) throw new Error(result.error ?? 'publication du nom impossible');
      /*
       * L'adresse va sur l'environnement VISÉ, pas sur le projet : un projet
       * qui a une production et un dev client ne peut pas n'avoir qu'une seule
       * adresse. Un projet à l'ancien format est matérialisé au passage — sa
       * liste d'environnements est écrite pour de bon, avec ses anciennes
       * valeurs, si bien que rien n'est perdu ni changé de comportement.
       */
      const liste = environnementsDuProjet(project);
      const vise = environnementVise(project, cmd.environmentId);
      const updated = store.saveProject({
        ...project,
        environments: modifierEnvironnement(liste, vise.id, { url: result.url }),
      });
      bus.emit({ type: 'project.upsert', project: updated });
      bus.toast('success', `Adresse en ligne (${vise.nom}) : ${result.url}`);
      return result;
    }

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

    /* -------- Cartes -------- */

    case 'card.create': {
      const card = createCard(cmd.projectId, {
        title: cmd.title,
        description: cmd.description,
        labels: cmd.labels,
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
      const updated = store.saveCard(Card.parse({ ...card, ...patch, id: card.id }));
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
        const suspendue = store.saveCard({
          ...card,
          column: 'planned',
          position: store.nextPosition(card.projectId, 'planned'),
          scheduling: {
            ...(card.scheduling ?? { asap: false, attempts: 0, restarts: 0 }),
            suspendu: true,
            waitingReason: RAISON_SUSPENDU,
          },
        });
        bus.emit({ type: 'card.upsert', card: suspendue });
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

      const updated = store.saveCard({
        ...card,
        column: target,
        position: cmd.position ?? store.nextPosition(card.projectId, target),
        doneAt: target === 'done' ? Date.now() : card.doneAt,
      });
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

      // C'est ce geste qui autorise la dépense : l'analyse part maintenant.
      if (target === 'validated') {
        void analyseCard(updated.id);
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

    case 'card.reanalyze': {
      const card = store.getCard(cmd.id);
      if (!card) throw new Error('carte introuvable');
      store.saveCard({ ...card, estimate: undefined });
      void analyseCard(cmd.id);
      return { ok: true };
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
     */
    case 'agent.reset': {
      const agent = store.getAgent(cmd.agentId);
      if (!agent) throw new Error('agent introuvable');
      const visibles = messagesDepuis(store.listMessages(agent.id), store.nouveauDepart(agent.id));
      const verdict = peutRepartir({ status: isRunning(agent.id) ? 'running' : agent.status }, visibles);
      if (!verdict.ok) {
        bus.toast('warning', verdict.raison);
        return { ok: false };
      }

      store.setNouveauDepart(agent.id, store.now());
      store.clearSessions(agent.id);
      store.setMemorySeen(agent.id, 0);
      store.setCarteVue(agent.id, '');
      envoyerConversation(agent.id);
      bus.toast('success', 'Nouvelle conversation. Les échanges précédents restent consultables.');
      return { ok: true };
    }

    case 'agent.prompt': {
      // L'agent existe-t-il ? Ce contrôle-là doit répondre tout de suite.
      if (!store.getAgent(cmd.agentId)) throw new Error('agent introuvable');
      /*
       * ON N'ATTEND PAS LA FIN DU TOUR. Un tour dure des minutes ; attendre
       * ici faisait expirer la commande côté navigateur au bout de deux
       * minutes, et le message semblait n'être jamais parti (il revenait
       * même dans la barre d'écriture). La suite arrive par abonnement.
       */
      void sendPrompt(cmd.agentId, cmd.text, { attachments: cmd.attachments }).catch((err) =>
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

      const stopped = stopAgent(cmd.agentId);

      /*
       * L'arrêt coupe aussi ce qui attendait DERRIÈRE : les demandes en file
       * repartaient toutes seules quelques secondes plus tard, et la carte
       * pouvait être reprise par l'ordonnanceur après un redémarrage. La marque
       * `suspendu` est celle de la suspension à la main : seul un geste
       * (« Lancer maintenant », dépôt en « En cours ») l'efface.
       */
      const vides = store.clearQueue(cmd.agentId);
      if (vides) bus.emit({ type: 'queue.snapshot', agentId: cmd.agentId, queue: [] });

      const carte = cmd.cardId ? store.getCard(cmd.cardId) : null;
      if (carte) {
        const arretee = store.saveCard({
          ...carte,
          scheduling: {
            ...(carte.scheduling ?? { asap: false, attempts: 0, restarts: 0 }),
            suspendu: true,
            waitingReason: RAISON_ARRETE_A_LA_MAIN,
          },
        });
        bus.emit({ type: 'card.upsert', card: arretee });
        bus.toast('warning', RAISON_ARRETE_A_LA_MAIN, arretee.id);
      }

      return { stopped };
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

      const run = {
        engine: engine?.id ?? agent.run.engine,
        model,
        thinking,
        mode: cmd.run.mode ?? agent.run.mode,
      };
      const updated = store.saveAgent({ ...agent, run: run as any });
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

      // L'agent reprend aussitôt, avec la réponse en main — sans faire
      // patienter le navigateur jusqu'à la fin de son tour. La question n'est
      // rappelée qu'en tête : c'est lui qui l'a posée, il l'a déjà en contexte.
      // Les images jointes à la réponse suivent le MÊME chemin que celles du
      // fil : leurs chemins de fichiers sont annoncés dans la demande.
      const rappel = question.question.length > 80 ? `${question.question.slice(0, 80)}…` : question.question;
      void sendPrompt(message.agentId, `Réponse à ta question « ${rappel} » : ${cmd.answer}`, {
        attachments: cmd.attachments ?? [],
      }).catch((err) =>
        log.error('reprise après réponse impossible', err),
      );
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
      // Ce qui est validé est ce qui partira : le réglage est repassé par la
      // règle du catalogue, pour qu'aucune carte ne naisse avec un modèle
      // emprunté à un autre moteur — même envoyé par une page restée ouverte.
      const souhait = cmd.run ? { ...(proposal.run ?? {}), ...cmd.run } : proposal.run;
      const accorde = souhait ? reglagesDeLaProposition(souhait, await catalogueMoteurs()) : undefined;
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

      let cardId: string | undefined;
      if (cmd.accept) {
        const card = createCard(agent.projectId, { ...retenu, origin: 'agent' });
        cardId = card.id;
        bus.emit({ type: 'card.upsert', card });
      }

      const decided = {
        ...(store.decideProposal(cmd.proposalId, cmd.accept ? 'accepted' : 'refused', cardId) ?? {
          ...proposal,
          decision: cmd.accept ? ('accepted' as const) : ('refused' as const),
          cardId,
          decidedAt: Date.now(),
        }),
        ...retenu,
      };

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

    /* -------- Publication -------- */

    case 'deploy.start': {
      const result = await startDeploy(cmd.projectId, cmd.environmentId);
      if (!result.ok) throw new Error(result.error ?? 'publication impossible');
      return result;
    }

    case 'deploy.stop':
      return { stopped: stopDeploy(cmd.runId) };

    case 'deploy.retry':
      return retryDeploy(cmd.runId);

    case 'deploy.check': {
      // Les environnements du projet et ce que chacun a donné la dernière fois :
      // le bloc de publication montre l'environnement visé sans avoir à deviner.
      const environnements = environnementsDePublication(cmd.projectId);
      const derniers = derniersResultats(environnements, store.recentDeploys(cmd.projectId));
      return {
        conflicts: await conflitsPrevus(cmd.projectId),
        busy: agentsOccupes(cmd.projectId),
        // Le travail enregistré sur la principale sans passer par une carte :
        // sans lui, la fenêtre de publication disparaissait et rien ne partait.
        enAttente: await commitsEnAttente(cmd.projectId),
        // Ce projet peut-il seulement être mis en ligne ? Le dire AVANT le clic
        // vaut mieux que de le découvrir sur une publication refusée.
        miseEnLigne: moyenDeMiseEnLigne(cmd.projectId, cmd.environmentId),
        environnements,
        derniers: Object.fromEntries(derniers),
      };
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
        hours: cmd.hours,
      });
      if (!result.ok) throw new Error(result.error ?? 'ajout impossible');
      bus.toast('success', `Ligne ajoutée au document ${result.documentNumber ?? ''}`.trim());
      return result;
    }

    case 'billing.summary':
      return { summary: await billing.summary() };

    /* -------- GitHub -------- */

    case 'github.refresh':
      return { tracking: await github.refreshCard(cmd.cardId) };

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

    case 'daemon.status':
      return { etat: etatDemon() };

    case 'daemon.restart': {
      // On répond AVANT de couper : sinon le navigateur ne voit qu'une
      // déconnexion, sans savoir si sa demande est passée.
      redemarrerDemon();
      return { ok: true };
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

    case 'stats.usage':
      return {
        byProject: store.usageByProject(),
        byMonth: store.usageByMonth(),
        deployable: cmd.projectId ? deployableCards(cmd.projectId).length : undefined,
      };

    case 'card.quota':
      return store.usageQuotaByCard(cmd.cardId);

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
      return {
        byProject: store.usageByProject(),
        byDay: store.usageByDay(30),
        byCard,
      };
    }

    case 'memory.get': {
      const project = store.getProject(cmd.projectId);
      if (!project) throw new Error('projet introuvable');
      const content = readMemory(project.path);
      bus.emit({ type: 'memory', projectId: cmd.projectId, content });
      return { content };
    }

    default: {
      const exhaustive: never = cmd;
      throw new Error(`commande inconnue : ${JSON.stringify(exhaustive)}`);
    }
  }
}
