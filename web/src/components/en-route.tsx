/*
 * LA PAGE « EN ROUTE » — tout ce qui est entre la demande et le déploiement,
 * tous projets confondus (`shared/src/en-route.ts`).
 *
 * Ouverte par le bouton des agents, sous la navigation de la colonne de
 * gauche, et montrée d'office quand aucun projet n'est ouvert. Elle remplace
 * la pile flottante qui listait les agents au pied de la colonne : ce qui
 * travaille sur une carte se lit SUR la carte (témoin orange, barre de
 * travail), ce qui travaille sans carte — mises en ligne, analyse, chef — dans
 * la bande en tête, avec son bouton d'arrêt.
 *
 * UNE LISTE UNIQUE, TOUS PROJETS (demande du 30/10/2026, « projets sans
 * kanban ») : les trois colonnes « Actifs », « Terminer », « Archiver » ont
 * laissé la place à la liste des agents (`liste-des-agents.tsx`), la même que
 * dans la colonne d'un projet, avec le projet sur chaque ligne et un filtre par
 * projet. Les cartes rangées se replient sous « Voir les archivés ». Les
 * réserves du démon (`OngletEnRoute`) et leurs paquets de vingt restent : la
 * liste les réunit.
 *
 * Un morceau à part, chargé au premier affichage (DEC-050) : un écran qu'on
 * n'a pas ouvert ne se télécharge pas.
 */
import * as React from 'react';
import { Bot, Loader2, Microscope, Power, Square, UploadCloud, Wrench } from '@/components/ui/icones';
import {
  agentTientSonTour,
  agentsDeLaBande,
  depannagesDeLaBande,
  etatDeLaVignetteDInitialisation,
  depanneurVivant,
  etapeDeLAgentDeConfiguration,
  procedureEnPlace,
  type Agent,
  type Card,
  type Project,
  type OngletEnRoute,
  estUnRegroupement,
  membresActifsDuRegroupement,
  SERVICE_DU_DIRECTEUR,
  ongletDesTableauxDeBord,
  PREF_ONGLET_DES_TABLEAUX_DE_BORD,
  type OngletDesTableauxDeBord,
} from '@beluga/shared';
import { client } from '@/lib/client';
import { allerALEcranDeLAgentDeService } from '@/lib/ouvrir-un-agent';
import { useRedemarrage } from '@/components/redemarrage';
import { OptionDePage, OptionsDePage } from '@/components/entete-de-zone';
import { useApp } from '@/lib/use-app';
import { usePref } from '@/lib/prefs';
import { useMinute } from '@/lib/horloge';
import { useTelephone } from '@/lib/telephone';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import { Dot, ZoneDefilement } from '@/components/ui';
import { TableauDesTaches } from '@/components/tableau-des-taches';
import { CLASSE_COLONNE_DE_SERVICE, PageAGrandTitre, RubriquesDePage } from '@/components/fenetre-de-service';
import { AgentsDuProjet } from '@/components/agents-du-projet';
import { naviguerVers } from '@/components/ui/lien-interne';
import {
  PublicationsEnAttenteDesProjets,
  TableauADeployer,
  TableauAProduire,
  usePublicationsEnAttenteVisibles,
} from '@/components/publications-en-attente';
import { BarreDOnglets } from '@/components/ui/barre-d-onglets';
import { Silhouette } from '@/components/silhouettes';
import { BulleTexteCoupe, useTexteCoupe } from '@/components/texte-coupe';
import { ListeDesAgents, useCartesParDate, useLignesDAgents } from '@/components/liste-des-agents';
import { BandeauTravail } from '@/components/bandeau-travail';
import { VignetteInitialisationProduction } from '@/components/vignette-initialisation-production';
import { PastilleProjet, PastillesEmpilees } from '@/components/pastille-projet';
import { GRILLE_EN_ROUTE } from '@/components/silhouettes';
import { CLASSE_CADRE_SYSTEME } from '@/lib/gabarit-tableau';

/** Sous le petit titre d'une bande (productions, dépannages, agents) : un peu d'air. */
const GRILLE_DE_BANDE = `${GRILLE_EN_ROUTE} pt-3`;

export function EnRoute({
  onOpenCard,
  onOpenAgent,
  agentsPerso = false,
  onAgentsPerso,
}: {
  onOpenCard: (card: Card) => void;
  onOpenAgent: (agentId: string) => void;
  /** L'ONGLET « AGENTS » (24/11/2026) : les agents personnalisés de tous les projets, « #en-route/agents ». */
  agentsPerso?: boolean;
  onAgentsPerso?: (agents: boolean) => void;
}) {
  const state = useApp();
  // L'heure « rendue il y a… » se refait à chaque minute, pour toute la page —
  // et une carte Système finie depuis 24 heures quitte « Archiver » sans
  // rechargement (`DUREE_SYSTEME_TERMINE_MS`).
  const maintenant = useMinute();
  const telephone = useTelephone();
  const redemarrage = useRedemarrage();
  /* Un projet mis de côté entre-temps sort de la page, comme il sort de la
     colonne de gauche. */
  const enService = React.useMemo(
    () => new Set(state.projects.filter((p) => !p.archived).map((p) => p.id)),
    [state.projects],
  );
  /* LES CARTES SYSTÈME (cadre violet) : au travail ou en attente d'une
     réponse, en tête d'« Actifs » ; finies depuis moins de 24 heures, dans
     « Archiver », rangées par date de fin parmi les cartes (06/10/2026). */
  const agents = Object.values(state.agents);
  /* Les chefs de Communication vont en tête de la liste des agents (`LignesDesChefsAuTravail`), pas dans la bande. */
  const bande = agentsDeLaBande(agents).filter((a) => a.service?.id !== SERVICE_DU_DIRECTEUR);
  /* LES DÉPANNAGES DE PUBLICATION (« Résoudre le problème ») : leur carte
     spéciale, en tête de la colonne « Actifs », tant que l'agent travaille. */
  const depannages = depannagesDeLaBande(agents);
  /* Les déploiements et mises en production ne sont plus un groupe en tête : chacun est une ligne datée de la liste
     unique (`LigneDeMiseEnLigne`, `fluxMele`), décision du 31/10/2026. */
  /* La vignette d'un agent sans carte : celle de l'agent de configuration
     garde sa forme à part, la même qu'en tête de « En cours » du tableau. */
  const vignetteAgent = (agent: Agent) => {
    const projet = state.projects.find((p) => p.id === agent.projectId);
    const etapeConfiguree = etapeDeLAgentDeConfiguration(projet, agent.id) ?? 'production';
    const initialisation = etatDeLaVignetteDInitialisation(projet, agent, maintenant, etapeConfiguree);
    return initialisation ? (
      <VignetteInitialisationProduction
        key={agent.id}
        agent={agent}
        etat={initialisation}
        projet={projet}
        cible={etapeConfiguree}
        reconfiguration={procedureEnPlace(projet, 'production')}
        avecProjet
        formatCarte
      />
    ) : (
      <VignetteAgent key={agent.id} agent={agent} onOpen={() => ouvrirAgent(agent)} />
    );
  };
  const ouvrirAgent = (agent: Agent) => {
    /* L'AGENT D'UN SERVICE (sans projet) s'ouvre sur l'écran de son service, jamais sur un tableau. */
    if (agent.service) {
      allerALEcranDeLAgentDeService({ id: agent.id, projectId: agent.projectId, service: agent.service });
      return;
    }
    const carte = agent.cardId
      ? (state.enRoute?.cartes[agent.cardId] ??
        state.enRouteTerminer?.cartes[agent.cardId] ??
        state.enRouteArchive?.cartes[agent.cardId] ??
        state.cards[agent.cardId])
      : undefined;
    if (carte) onOpenCard(carte);
    else onOpenAgent(agent.id);
  };

  /* LES AGENTS SANS CARTE, EN TÊTE : les mises en production qui tournent, les
     dépannages, puis les agents qui travaillent sans carte (publication,
     analyse, chef, services). Ils ne sont pas des agents de la liste : ils ont
     chacun leur vignette, comme avant. */
  const bandes = (
    <>
      {depannages.length ? (
        <section className="mb-4" data-bande-depannages>
          <h2 className="text-[12px] uppercase tracking-wide text-faint">{t('Dépannages')}</h2>
          <div className={GRILLE_DE_BANDE}>
            {depannages.map((agent) => (
              <VignetteDepannage key={agent.id} agent={agent} onOpen={() => onOpenAgent(agent.id)} />
            ))}
          </div>
        </section>
      ) : null}
      {bande.length ? (
        <section className="mb-4" data-bande-agents>
          <h2 className="text-[12px] uppercase tracking-wide text-faint">{t('Agents sans carte')}</h2>
          <div className={GRILLE_DE_BANDE}>{bande.map(vignetteAgent)}</div>
        </section>
      ) : null}
    </>
  );
  const aDesBandes = depannages.length > 0 || bande.length > 0;

  /*
   * « TÂCHES | AGENTS » (demande du 24/11/2026, maquette #d9190) : le même sélecteur que l'accueil d'un projet, collé
   * au grand titre, en variante « accueil » (plus grand, onglet choisi en aplat contrasté). « Agents » montre les agents
   * personnalisés de TOUS les projets ; un clic ouvre l'agent dans son projet.
   */
  const agentsDeTousLesProjets = (
    <AgentsDuProjet projectId={null} onOuvrir={(id, projet) => naviguerVers(`projet/${encodeURIComponent(projet)}/agents/${encodeURIComponent(id)}`)} />
  );
  const selecteur = onAgentsPerso ? (
    <BarreDOnglets
      repere="tableaux-de-bord-taches-agents"
      variante="accueil"
      valeur={agentsPerso ? 'agents' : 'taches'}
      onChange={(v) => onAgentsPerso(v === 'agents')}
      onglets={[
        { cle: 'taches', libelle: t('Tâches') },
        { cle: 'agents', libelle: t('Agents') },
      ]}
    />
  ) : null;

  /* Le redémarrage du serveur, rangé au chevron des options de la page (voir plus bas). */
  const options = (
    <OptionsDePage enMenu>
      <OptionDePage
        icone={redemarrage.repart ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
        onClick={redemarrage.ouvrir}
        disabled={!!redemarrage.bloque}
        detail={redemarrage.bloque ?? redemarrage.raison}
        data-bouton-redemarrage="tableaux-de-bord"
        data-etat-redemarrage={redemarrage.etat}
        data-redemarrage-bloque={redemarrage.bloque ? 'oui' : 'non'}
      >
        {redemarrage.repart ? redemarrage.libelle : t('Redémarrer le serveur')}
      </OptionDePage>
    </OptionsDePage>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg" data-page-en-route>
      {/* LE REDÉMARRAGE DU SERVEUR, DANS LE MENU « … » DES TABLEAUX DE BORD
          (demande du 20/10/2026), sur ordinateur comme sur téléphone. Il passe
          par la même fenêtre de confirmation que les réglages ; il s'éteint et
          dit pourquoi tant qu'une tâche ou une publication tourne. */}
      {telephone ? options : null}
      {redemarrage.dialogue}
      {/* UNE LISTE UNIQUE, TOUS PROJETS (demande du 30/10/2026, « projets sans
          kanban ») : les trois colonnes « Actifs », « Terminer », « Archiver »,
          leur glisser et « Tout archiver » ont laissé la place à la MÊME liste
          que la colonne d'un projet — le projet sur chaque ligne, un filtre par
          projet en plus. Un agent s'ouvre dans son projet. */}
      {telephone ? (
        <TableauxDeBordTelephone
          bandes={aDesBandes ? bandes : null}
          onOuvrir={onOpenCard}
          agentsPerso={agentsPerso}
          onAgentsPerso={onAgentsPerso}
          agents={agentsDeTousLesProjets}
        />
      ) : (
        /*
         * SUR ORDINATEUR, UNE PAGE COMME CELLES DES SERVICES (16/11/2026, captures #56359 et #4f41) : UNE zone qui défile
         * sur toute la largeur du panneau, et dedans la colonne commune des services — le grand titre « Tableaux de bord »
         * avec, à droite sur la même ligne, la recherche et le filtre des tâches et le chevron des options ; puis les
         * agents sans carte, les publications en attente (« À déployer », puis « Mise en production en attente », l'un
         * sous l'autre) et le tableau de toutes les tâches.
         *
         * COLLÉ EN HAUT ET EN BAS (capture #39779) : le titre part avec la liste, qui remonte jusqu'au bandeau ; rien ne
         * suit le tableau ni la zone, donc la barre de pagination, collée au bas de la zone, touche le bas de l'écran. Elle
         * réserve à droite la place du bouton vocal flottant, posé par défaut dans ce coin.
         */
        <ZoneDefilement classeEnveloppe="min-h-0 flex-1" className="[--retrait-droit-pied-tableau:132px]" hauteur={28}>
          <div className={cn(CLASSE_COLONNE_DE_SERVICE, 'flex min-h-full flex-col')} data-colonne-des-tableaux-de-bord>
            <PageAGrandTitre titre={t('Tableaux de bord')} repere="tableaux-de-bord">
              {selecteur ? <RubriquesDePage>{selecteur}</RubriquesDePage> : null}
              {options}
              {/* EN VUE « AGENTS », LE TABLEAU DES TÂCHES N'EST PAS MONTÉ : sa recherche et son filtre quittent la rangée du
                  titre avec lui, le tableau des agents pose les siens. */}
              {agentsPerso && onAgentsPerso ? (
                agentsDeTousLesProjets
              ) : (
                <>
                  {aDesBandes ? <div className="pb-2">{bandes}</div> : null}
                  <PublicationsEnAttenteDesProjets titreDeLaSuite={t('Toutes les tâches')} />
                  <TableauDesTaches onOuvrir={onOpenCard} titre={null} />
                </>
              )}
            </PageAGrandTitre>
          </div>
        </ZoneDefilement>
      )}
    </div>
  );
}

/**
 * Le projet d'une vignette, en haut à gauche : son avatar (favicon ou initiales,
 * comme dans la colonne de gauche), puis son nom. Un PROJET RÉUNI montre la
 * pile des favicons de ses membres actifs.
 */
function NomDuProjet({ projet }: { projet?: Project }) {
  const state = useApp();
  const membres = projet && estUnRegroupement(projet) ? membresActifsDuRegroupement(state.projects, projet.id) : [];
  return (
    <>
      {projet && (membres.length ? <PastillesEmpilees projects={membres} fond="hsl(var(--raised))" taille={18} /> : <PastilleProjet project={projet} taille={18} />)}
      <span className="min-w-0 truncate text-muted" data-projet-carte>
        {projet?.name ?? t('Projet inconnu')}
      </span>
    </>
  );
}

/** Le rôle d'un agent sans carte, dit en clair dans la tête de sa vignette. */
function libelleDuRole(role: Agent['role']): string {
  if (role === 'deploy') return t('Mise en ligne');
  if (role === 'analysis') return t('Analyse');
  if (role === 'cadrage') return t('Cadrage');
  return t('Agent');
}

/** Ce que fait un agent sans carte, en une phrase : la description de sa vignette. */
function descriptionDuRole(role: Agent['role']): string {
  if (role === 'deploy') return t('Fusionne le lot « À déployer », l’enregistre, l’envoie puis le met en ligne.');
  if (role === 'analysis') return t('Cherche ce qui peut être amélioré dans le projet.');
  if (role === 'cadrage') return t('Cadre une demande avant qu’elle devienne une carte.');
  return t('Agent au travail sans carte.');
}

/** Ce que fait l'agent d'un service, sur sa carte : il ne travaille pour aucun projet. */
function descriptionDeLAgent(agent: Agent): string {
  return agent.service ? t('Travaille pour le service {nom}, hors de tout projet.', { nom: agent.service.nom }) : descriptionDuRole(agent.role);
}

/**
 * UN AGENT DE LA BANDE, EN CARTE SYSTÈME COMPACTE (06/10/2026) : la même tête
 * qu'une carte de la liste (projet · rôle à gauche, état à droite), le titre
 * sur deux lignes au plus, une ligne de description (`descriptionDuRole`),
 * l'ancienneté en pied, et la barre de travail dessous tant qu'il travaille
 * (`BandeauTravail`, la même que sous une carte). Sa HAUTEUR SUIT SON CONTENU —
 * à peu près la moitié d'une carte : pas de frise d'étapes, donc rien à
 * aligner sur la hauteur fixe des cartes. Cadre VIOLET (`--publie`) : c'est ce
 * qui distingue d'un coup d'œil une carte Système. Pas de point bleu : finie,
 * elle passe 24 heures dans « Archiver » sans aucun signal.
 *
 * L'ouverture est portée par le CADRE (`data-ouvrir-agent-en-route`), pas par
 * un `button` : le titre tient sur une ligne (`line-clamp-1`, coupé par « … »,
 * le titre entier au survol), et un texte replié ne se pose jamais dans un
 * bouton. Le seul `button` est l'arrêt, qui
 * ne remonte pas jusqu'à l'ouverture.
 */
function VignetteAgent({ agent, onOpen }: { agent: Agent; onOpen: () => void }) {
  const state = useApp();
  const projet = state.projects.find((p) => p.id === agent.projectId);
  const auTravail = agentTientSonTour(agent);
  const Icone = agent.role === 'deploy' ? UploadCloud : agent.role === 'analysis' ? Microscope : Bot;
  const titreRef = React.useRef<HTMLHeadingElement>(null);
  const titreCoupe = useTexteCoupe([titreRef], [agent.title]);
  const ouvrir = onOpen;
  return (
    <div className="relative flex min-w-0 flex-col" data-vignette-agent-en-route={agent.id}>
      <div
        role="button"
        tabIndex={0}
        data-ouvrir-agent-en-route={agent.id}
        onClick={ouvrir}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          ouvrir();
        }}
        className={cn(
          CLASSE_CADRE_SYSTEME,
          /* L'AGENT D'UN SERVICE porte un CADRE VIOLET (demande du 25/10/2026) : il ne relève d'aucun
             projet, et se distingue ainsi d'un coup d'œil des cartes des projets. */
          agent.service && 'ring-1 ring-inset ring-teinte/70',
          auTravail && 'rounded-b-none',
        )}
        data-cadre-service={agent.service ? agent.service.id : undefined}
      >
        <div className="mb-1.5 flex h-[22px] min-w-0 items-center gap-1.5 text-[13px]" data-tete-carte-en-route>
          <div className="flex min-w-0 flex-1 items-center gap-1.5" data-tete-gauche>
            {/* L'AGENT D'UN SERVICE porte le nom du service à la place du projet : il n'en a aucun. */}
            {agent.service ? (
              <span className="min-w-0 truncate font-medium text-teinte" data-service-agent-en-route={agent.service.id}>
                {agent.service.nom}
              </span>
            ) : (
              <NomDuProjet projet={projet} />
            )}
            <span className="shrink-0 text-faint">·</span>
            <span className="shrink-0 text-muted" data-role-agent-en-route>
              {libelleDuRole(agent.role)}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1" data-tete-droite>
            <span
              className="flex items-center gap-1"
              data-temoin-en-route={agent.attendReponse ? 'question' : auTravail ? 'travail' : 'repos'}
            >
              {/* Arrêté sur sa question, il reste dans « Actifs » : il le dit. */}
              {agent.attendReponse && !auTravail ? (
                <span className="text-warning">{t('attend votre réponse')}</span>
              ) : agent.status === 'starting' ? (
                <>
                  <Dot tone="running" pulse />
                  <span className="text-faint">{t('démarre…')}</span>
                </>
              ) : auTravail ? (
                <>
                  <Dot tone="running" pulse />
                  <span className="text-en-cours">{t('Au travail')}</span>
                </>
              ) : (
                <span className={agent.status === 'failed' ? 'text-danger' : 'text-faint'}>{agent.status === 'failed' ? t('échec') : t('terminé')}</span>
              )}
            </span>
            {/* L'ARRÊT, le seul geste d'arrêt de ces agents : il arrête
                vraiment, y compris un agent bloqué que le démon referme alors
                d'autorité. Son clic ne remonte pas jusqu'à l'ouverture. */}
            {auTravail ? (
              <button
                data-arret-agent-en-route
                onClick={(event) => {
                  event.stopPropagation();
                  client
                    .call({ type: 'agent.stop', agentId: agent.id, cardId: agent.cardId })
                    .catch((err: any) => client.pushToast('error', err?.message ?? t('arrêt refusé')));
                }}
                onKeyDown={(event) => event.stopPropagation()}
                className="-my-[9px] -mr-[9px] ml-0.5 flex shrink-0 items-center justify-center p-[9px] text-faint hover:text-danger"
                title={t('Arrêter cet agent')}
              >
                <Square className="h-2.5 w-2.5 fill-current" />
              </button>
            ) : null}
          </div>
        </div>
        <div className="min-w-0" data-corps-systeme>
          <div className="flex items-start gap-1.5">
            <h3
              ref={titreRef}
              title={titreCoupe ? agent.title : undefined}
              className="line-clamp-1 min-w-0 flex-1 break-words text-[14px] font-medium leading-snug text-text"
            >
              <Icone
                className={cn(
                  'relative -top-px mr-1 inline h-[13px] w-[13px] align-middle',
                  auTravail ? (agent.role === 'deploy' ? 'text-publie' : 'text-en-cours') : 'text-faint',
                )}
              />
              {agent.title}
            </h3>
            {titreCoupe ? <BulleTexteCoupe>{agent.title}</BulleTexteCoupe> : null}
          </div>
          <p data-description-carte className="mt-1 line-clamp-1 break-words text-[12.5px] leading-snug text-muted">
            {descriptionDeLAgent(agent)}
          </p>
        </div>
      </div>
      {auTravail ? <BandeauTravail agent={agent} onClick={ouvrir} data-barre-agent-en-route={agent.id} /> : null}
    </div>
  );
}

/**
 * LA CARTE SPÉCIALE D'UN DÉPANNAGE DE PUBLICATION : l'agent ouvert par
 * « Résoudre le problème » sur un déploiement ou une mise en production tombé.
 * Bord VIOLET des cartes Système (comme les autres vignettes de la bande), clé
 * à molette et libellé ORANGE d'avertissement, le projet, l'étape dépannée, et son état :
 * au travail, attend votre réponse, ou terminé. Le clic rouvre sa conversation,
 * d'où qu'on vienne. Même règle que `VignetteAgent` : l'ouverture est portée
 * par le cadre, jamais par un `button` qui contiendrait un texte replié. Même
 * format compact, hauteur au contenu ; finie, elle passe dans « Archiver ».
 */
function VignetteDepannage({ agent, onOpen }: { agent: Agent; onOpen: () => void }) {
  const state = useApp();
  const projet = state.projects.find((p) => p.id === agent.projectId);
  const vivant = depanneurVivant(agent);
  const auTravail = agentTientSonTour(agent);
  const cible = agent.depannagePublication?.cible;
  const ouvrir = onOpen;
  const titre = cible === 'production' ? t('Dépannage de la mise en production') : t('Dépannage du déploiement');
  const titreRef = React.useRef<HTMLHeadingElement>(null);
  const titreCoupe = useTexteCoupe([titreRef], [titre]);
  return (
    <div className="relative flex min-w-0 flex-col" data-vignette-depannage={agent.id}>
      <div
        role="button"
        tabIndex={0}
        data-ouvrir-depannage={agent.id}
        onClick={ouvrir}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          ouvrir();
        }}
        className={cn(
          CLASSE_CADRE_SYSTEME,
          auTravail && 'rounded-b-none',
        )}
      >
        <div className="mb-1.5 flex h-[22px] min-w-0 items-center gap-1.5 text-[13px]" data-tete-carte-en-route>
          <div className="flex min-w-0 flex-1 items-center gap-1.5" data-tete-gauche>
            <NomDuProjet projet={projet} />
            <span className="shrink-0 text-faint">·</span>
            <span className="shrink-0 text-warning">{t('Dépannage')}</span>
          </div>
          <span className="flex shrink-0 items-center gap-1" data-etat-depannage={agent.attendReponse ? 'question' : vivant ? 'travail' : 'fini'}>
            {agent.attendReponse ? (
              <span className="text-warning">{t('attend votre réponse')}</span>
            ) : vivant ? (
              <>
                <Dot tone="running" pulse />
                <span className="text-en-cours">{t('Au travail')}</span>
              </>
            ) : (
              <span className={agent.status === 'failed' ? 'text-danger' : 'text-faint'}>{agent.status === 'failed' ? t('échec') : t('terminé')}</span>
            )}
          </span>
        </div>
        <div className="min-w-0" data-corps-systeme>
          <div className="flex items-start gap-1.5">
            <h3
              ref={titreRef}
              title={titreCoupe ? titre : undefined}
              className="line-clamp-1 min-w-0 flex-1 break-words text-[14px] font-medium leading-snug text-text"
            >
              <Wrench className="relative -top-px mr-1 inline h-[13px] w-[13px] align-middle text-warning" />
              {titre}
            </h3>
            {titreCoupe ? <BulleTexteCoupe>{titre}</BulleTexteCoupe> : null}
          </div>
          <p data-description-carte className="mt-1 line-clamp-1 break-words text-[12.5px] leading-snug text-muted">
            {t('Répare, puis relance l’étape tombée.')}
          </p>
        </div>
      </div>
      {auTravail ? <BandeauTravail agent={agent} onClick={ouvrir} data-barre-depannage={agent.id} /> : null}
    </div>
  );
}

/**
 * LES TABLEAUX DE BORD DU TÉLÉPHONE, EN TROIS ONGLETS (décision de l'utilisateur du 16/11/2026, capture #39c6 :
 * « je dois voir la liste des déploiements et production et les tâches ensuite… avec une tabs bar en haut et la qty à
 * côté du label »). « À déployer » et « Production » reprennent les tableaux de l'ordinateur (un clic ouvre le menu
 * « Publier » du projet, rien ne part) ; « Tâches » garde la liste avec sa recherche et son filtre. Un compte qui ne
 * peut pas publier n'a pas de barre : la page reste la liste des tâches. L'ordinateur n'est pas concerné (MEM-7553).
 *
 * ORDRE ET MÉMOIRE (décision du 17/11/2026, capture #b0b4) : « Tâches » vient en premier, et la page se rouvre sur le
 * DERNIER onglet touché — une préférence du compte (`shared/src/onglets-des-tableaux-de-bord.ts`), « Tâches » sans
 * elle. Le choix automatique du premier onglet non vide est retiré.
 */
function TableauxDeBordTelephone({
  bandes,
  onOuvrir,
  agentsPerso,
  onAgentsPerso,
  agents,
}: {
  bandes: React.ReactNode;
  onOuvrir: (card: Card) => void;
  agentsPerso: boolean;
  onAgentsPerso?: (agents: boolean) => void;
  /** La vue des agents de tous les projets, montée quand l'onglet « Agents » est choisi. */
  agents: React.ReactNode;
}) {
  const { charge, permis, aDeployer, aProduire } = usePublicationsEnAttenteVisibles();
  const lignes = useLignesDAgents(useCartesParDate().cartes);
  const actives = React.useMemo(() => lignes.filter((l) => l.active).length, [lignes]);
  const [retenu, retenir] = usePref<unknown>(PREF_ONGLET_DES_TABLEAUX_DE_BORD, null);
  const liste = (
    <div className="flex min-h-0 flex-1 flex-col">
      {bandes ? <div className="max-h-[40%] shrink-0 overflow-y-auto px-[var(--marge-de-page,1rem)] pt-3">{bandes}</div> : null}
      <ListeDesAgents avecProjet pleinePage onOuvrir={onOuvrir} />
    </div>
  );
  /*
   * « AGENTS » ENTRE DANS LA MÊME RANGÉE (24/11/2026), juste après « Tâches » : une seule rangée d'onglets sur téléphone.
   * Son choix vit dans l'application (adresse « #en-route/agents ») ; les trois autres restent dans la préférence.
   */
  const retenuSansAgents = ongletDesTableauxDeBord(retenu);
  const onglet: OngletDesTableauxDeBord = agentsPerso && onAgentsPerso ? 'agents' : retenuSansAgents === 'agents' ? 'taches' : retenuSansAgents;
  const choisir = (v: OngletDesTableauxDeBord) => {
    if (v === 'agents') {
      onAgentsPerso?.(true);
      return;
    }
    retenir(v);
    if (agentsPerso) onAgentsPerso?.(false);
  };
  const vueDesAgents = (
    <ZoneDefilement classeEnveloppe="min-h-0 flex-1" className="px-[var(--marge-de-page,1rem)] pb-4 pt-2" hauteur={16} data-fil="agents-de-tous-les-projets">
      {agents}
    </ZoneDefilement>
  );
  if (!permis) {
    if (!onAgentsPerso) return <div className="mx-auto flex min-h-0 w-full flex-1 flex-col">{liste}</div>;
    return (
      <div className="mx-auto flex min-h-0 w-full flex-1 flex-col">
        <div className="shrink-0 px-[var(--marge-de-page,1rem)] pb-1 pt-2">
          <BarreDOnglets<OngletDesTableauxDeBord>
            repere="tableaux-de-bord"
            libelle={t('Tableaux de bord')}
            pleineLargeur
            attributs={{ 'data-onglets-tableaux-de-bord': onglet }}
            valeur={onglet}
            onChange={choisir}
            onglets={[
              { cle: 'taches', libelle: t('Tâches'), nombre: actives },
              { cle: 'agents', libelle: t('Agents') },
            ]}
          />
        </div>
        {onglet === 'agents' ? vueDesAgents : liste}
      </div>
    );
  }
  return (
    <div className="mx-auto flex min-h-0 w-full flex-1 flex-col">
      <div className="shrink-0 px-[var(--marge-de-page,1rem)] pb-1 pt-2">
        <BarreDOnglets<OngletDesTableauxDeBord>
          repere="tableaux-de-bord"
          libelle={t('Tableaux de bord')}
          pleineLargeur
          attributs={{ 'data-onglets-tableaux-de-bord': onglet }}
          valeur={onglet}
          onChange={choisir}
          onglets={[
            { cle: 'taches', libelle: t('Tâches'), nombre: actives },
            ...(onAgentsPerso ? [{ cle: 'agents' as const, libelle: t('Agents') }] : []),
            { cle: 'a-deployer', libelle: t('À déployer'), nombre: charge ? aDeployer.length : null },
            { cle: 'production', libelle: t('Production'), nombre: charge ? aProduire.length : null },
          ]}
        />
      </div>
      {onglet === 'taches' ? (
        liste
      ) : onglet === 'agents' ? (
        vueDesAgents
      ) : (
        <ZoneDefilement classeEnveloppe="min-h-0 flex-1" className="px-[var(--marge-de-page,1rem)] pb-4 pt-2" hauteur={16}>
          {!charge ? (
            <div className="flex flex-col gap-2" data-silhouette-publications>
              <Silhouette className="h-14 w-full rounded-xl" />
              <Silhouette className="h-14 w-full rounded-xl" />
            </div>
          ) : onglet === 'a-deployer' ? (
            aDeployer.length ? (
              <div data-projets-a-deployer={aDeployer.length}>
                <TableauADeployer lignes={aDeployer} />
              </div>
            ) : (
              <p className="py-10 text-center text-[14px] text-muted" data-onglet-vide="a-deployer">
                {t('Rien à déployer.')}
              </p>
            )
          ) : aProduire.length ? (
            <div data-projets-production-en-attente={aProduire.length}>
              <TableauAProduire lignes={aProduire} />
            </div>
          ) : (
            <p className="py-10 text-center text-[14px] text-muted" data-onglet-vide="production">
              {t('Aucune mise en production en attente.')}
            </p>
          )}
        </ZoneDefilement>
      )}
    </div>
  );
}
