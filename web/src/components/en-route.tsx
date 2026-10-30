/*
 * LA PAGE « EN ROUTE » — tout ce qui est entre la demande et le déploiement,
 * tous projets confondus (`shared/src/en-route.ts`).
 *
 * Ouverte par le bouton des agents, sous la navigation de la colonne de
 * gauche, et montrée d'office quand aucun projet n'est ouvert. Elle remplace
 * la pile flottante qui listait les agents au pied de la colonne : ce qui
 * travaille sur une carte se lit SUR la carte (témoin orange, barre de
 * travail), ce qui travaille sans carte — mise en ligne, analyse, chef — dans
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
import { Bot, Loader2, Microscope, Power, Square, UploadCloud, Wrench } from 'lucide-react';
import {
  agentTientSonTour,
  agentsDeLaBande,
  type DeployRun,
  depannagesDeLaBande,
  etatDeLaVignetteDInitialisation,
  misesEnProductionAAfficher,
  depanneurVivant,
  etapeDeLAgentDeConfiguration,
  procedureEnPlace,
  type Agent,
  type Card,
  type Project,
  type OngletEnRoute,
  estUnRegroupement,
  membresActifsDuRegroupement,
} from '@beluga/shared';
import { client } from '@/lib/client';
import { useRedemarrage } from '@/components/redemarrage';
import { OptionDePage, OptionsDePage } from '@/components/entete-de-zone';
import { useApp } from '@/lib/use-app';
import { useMinute } from '@/lib/horloge';
import { useTelephone } from '@/lib/telephone';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import { Dot } from '@/components/ui';
import { BulleTexteCoupe, useTexteCoupe } from '@/components/texte-coupe';
import { ListeDesAgents } from '@/components/liste-des-agents';
import { BandeauTravail } from '@/components/bandeau-travail';
import { VignetteInitialisationProduction } from '@/components/vignette-initialisation-production';
import { VignetteMiseEnProduction } from '@/components/vignette-mise-en-production';
import { PastilleProjet, PastillesEmpilees } from '@/components/pastille-projet';
import { GRILLE_EN_ROUTE } from '@/components/silhouettes';
import { CLASSE_CADRE_SYSTEME } from '@/lib/gabarit-tableau';

/** Sous le petit titre d'une bande (productions, dépannages, agents) : un peu d'air. */
const GRILLE_DE_BANDE = `${GRILLE_EN_ROUTE} pt-3`;

export function EnRoute({
  onOpenCard,
  onOpenAgent,
}: {
  onOpenCard: (card: Card) => void;
  onOpenAgent: (agentId: string) => void;
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
  const bande = agentsDeLaBande(agents);
  /* LES DÉPANNAGES DE PUBLICATION (« Résoudre le problème ») : leur carte
     spéciale, en tête de la colonne « Actifs », tant que l'agent travaille. */
  const depannages = depannagesDeLaBande(agents);
  /* LES MISES EN PRODUCTION, tout en haut : celle qui tourne dans chaque
     projet en service. */
  const productionsAffichees = misesEnProductionAAfficher(
    Object.values(state.productions).filter((run) => enService.has(run.projectId)),
    maintenant,
  );
  const productions = productionsAffichees.filter((run) => run.state === 'running');
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
  const vignetteProduction = (run: DeployRun) => (
    <VignetteMiseEnProduction
      key={run.id}
      run={run}
      projet={state.projects.find((p) => p.id === run.projectId)}
      onOpen={() => client.ouvrirMiseEnProduction(run.projectId)}
      avecProjet
      formatCarte
    />
  );
  const ouvrirAgent = (agent: Agent) => {
    /* L'AGENT D'UN SERVICE (sans projet) s'ouvre sur l'écran de son service, jamais sur un tableau. */
    if (agent.service) {
      window.history.pushState(null, '', `#${agent.service.adresse}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
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
      {productions.length ? (
        <section className="mb-4" data-bande-productions>
          <h2 className="text-[12px] uppercase tracking-wide text-faint">{t('Mises en production')}</h2>
          <div className={GRILLE_DE_BANDE}>{productions.map(vignetteProduction)}</div>
        </section>
      ) : null}
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
  const aDesBandes = productions.length > 0 || depannages.length > 0 || bande.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg" data-page-en-route>
      {/* LE REDÉMARRAGE DU SERVEUR, DANS LE MENU « … » DES TABLEAUX DE BORD
          (demande du 20/10/2026), sur ordinateur comme sur téléphone. Il passe
          par la même fenêtre de confirmation que les réglages ; il s'éteint et
          dit pourquoi tant qu'une tâche ou une publication tourne. */}
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
      {redemarrage.dialogue}
      {/* UNE LISTE UNIQUE, TOUS PROJETS (demande du 30/10/2026, « projets sans
          kanban ») : les trois colonnes « Actifs », « Terminer », « Archiver »,
          leur glisser et « Tout archiver » ont laissé la place à la MÊME liste
          que la colonne d'un projet — le projet sur chaque ligne, un filtre par
          projet en plus. Un agent s'ouvre dans son projet. */}
      <div className={cn('mx-auto flex min-h-0 w-full flex-1 flex-col', !telephone && 'max-w-[820px] px-6 pt-4')}>
        {aDesBandes ? (
          <div className={cn('max-h-[40%] shrink-0 overflow-y-auto', telephone ? 'px-4 pt-3' : 'pb-2')}>{bandes}</div>
        ) : null}
        <ListeDesAgents avecProjet pleinePage={telephone} onOuvrir={onOpenCard} />
      </div>
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
