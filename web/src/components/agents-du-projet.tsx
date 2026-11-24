/*
 * L'ONGLET « AGENTS » DE L'ACCUEIL D'UN PROJET (carte « Agents personnalisés dans les projets », 24/11/2026,
 * maquette #1df7) : le POINT DU MATIN en tête — ce que les agents ont fait depuis la veille au soir, avec des boutons
 * vers ce qui attend —, puis le TABLEAU des agents à une seule ligne d'en-tête (le tableau commun : tri par colonne,
 * filtre d'état, recherche, interrupteur par ligne). « Nouvel agent » ajoute une ligne « Nouvel agent » et ouvre sa
 * page aussitôt : aucun formulaire, la fiche se remplit en lui parlant (`page-de-l-agent.tsx`).
 *
 * Le bleu (`text-important`) ne dit qu'une chose : ce qui attend un geste. Tout le reste est monochrome.
 * Tout se lit au démon (`agentsPerso.lister`) et se relit à chaque événement `agentsPerso` du projet.
 *
 * LA MÊME VUE POUR TOUS LES PROJETS (onglet « Agents » des Tableaux de bord, 24/11/2026, maquette #d9190) : sans projet,
 * elle lit `agentsPerso.listerTout` (les projets que la session voit), se relit sur l'événement de N'IMPORTE QUEL projet,
 * remplace la colonne « Ce qu'il fait » par « Projet » (filtrable), nomme le projet dans le point du matin, et
 * « Nouvel agent » demande d'abord le projet (décision de l'utilisateur du 24/11/2026).
 */
import * as React from 'react';
import {
  NOM_D_UN_NOUVEL_AGENT,
  completionDeLaFiche,
  etatAffiche,
  type AgentPerso,
  type Declencheur,
  type GesteJamaisPermis,
  type RubriqueDeFiche,
  type SourceDEvenement,
  type EtatAffiche,
  type PointDuMatin,
} from '@beluga/shared';
import { ListeDeroulante, Switch } from '@/components/ui';
import { CelluleProjet } from '@/components/ui/colonne-projet';
import { PastilleProjet } from '@/components/pastille-projet';
import { IconeDuMembre, etatDuMembre } from '@/components/sous-agents';
import { TITRE_DE_SECTION } from '@/lib/echelle-de-texte';
import type { Agent } from '@beluga/shared';
import { Tableau, type ColonneDuTableauCommun } from '@/components/ui/tableau';
import { Bot, Loader2, Plus } from '@/components/ui/icones';
import { BoutonPrincipal, GestePrincipal } from '@/components/entete-de-zone';
import { Silhouette } from '@/components/silhouettes';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { useTelephone } from '@/lib/telephone';
import { formatRegional, t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * La liste des agents d'un projet et son point du matin, relus à l'ouverture et à chaque changement annoncé. `null` :
 * tous les projets que la session voit, relus au changement de n'importe lequel.
 */
export function useAgentsDuProjet(projectId: string | null): {
  agents: AgentPerso[] | null;
  point: PointDuMatin | null;
  erreur: string | null;
  recharger: () => void;
} {
  const versions = useApp().agentsPersoVersions;
  const version = projectId ? versions[projectId] ?? 0 : Object.values(versions).reduce((somme, v) => somme + v, 0);
  const [etat, setEtat] = React.useState<{ agents: AgentPerso[] | null; point: PointDuMatin | null; erreur: string | null }>({ agents: null, point: null, erreur: null });
  const [tour, setTour] = React.useState(0);
  React.useEffect(() => {
    let vivant = true;
    client
      .call<{ agents: AgentPerso[]; point: PointDuMatin }>(projectId ? { type: 'agentsPerso.lister', projectId } : { type: 'agentsPerso.listerTout' })
      .then((r) => vivant && setEtat({ agents: r.agents ?? [], point: r.point ?? null, erreur: null }))
      .catch((err: any) => vivant && setEtat((e) => ({ ...e, agents: e.agents ?? [], erreur: err?.message ?? t('La liste des agents n’a pas pu se lire') })));
    return () => {
      vivant = false;
    };
  }, [projectId, version, tour]);
  return { ...etat, recharger: () => setTour((n) => n + 1) };
}

/** Le nom affiché : « Nouvel agent » se traduit, un nom donné reste tel quel. */
export function nomDeLAgent(agent: Pick<AgentPerso, 'fiche'> | null): string {
  if (!agent) return '';
  return agent.fiche.nom === NOM_D_UN_NOUVEL_AGENT ? t('Nouvel agent') : agent.fiche.nom;
}

/** L'heure ou la date courte d'une action. */
export function quandLisible(at: number | null | undefined): string {
  if (!at) return '';
  const d = new Date(at);
  const memeJour = new Date().toDateString() === d.toDateString();
  return memeJour
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/* LES LIBELLÉS TRADUITS, chacun écrit en toutes lettres : le dictionnaire les retrouve dans la source. */
export function libelleDEtat(e: EtatAffiche): string {
  switch (e) {
    case 'au_travail':
      return t('Au travail');
    case 'a_valider':
      return t('À valider');
    case 'pause_limite':
      return t('En pause (limite)');
    case 'en_veille':
      return t('En veille');
    case 'eteint':
      return t('Éteint');
    default:
      return t('Brouillon');
  }
}

export function libelleDeSource(source: SourceDEvenement): string {
  switch (source) {
    case 'messagerie.demande':
      return t('À chaque nouvelle demande client');
    case 'surveillance.panne':
      return t('Quand le site tombe');
    case 'publication.terminee':
      return t('Après chaque mise en ligne');
    case 'referencement.audit':
      return t('Après chaque audit de référencement');
    case 'backup.echec':
      return t('Quand une sauvegarde échoue');
    default:
      return t('Quand la sécurité signale un point grave');
  }
}

export function titreDeRubrique(r: RubriqueDeFiche): string {
  switch (r) {
    case 'nom':
      return t('Nom');
    case 'mission':
      return t('Mission');
    case 'quand':
      return t('Quand il agit');
    case 'seul':
      return t('Ce qu’il fait seul');
    case 'demande':
      return t('Ce qu’il vous demande');
    case 'jamais':
      return t('Ce qu’il ne fait jamais');
    case 'emporte':
      return t('Ce qu’il emporte');
    default:
      return t('Sa limite');
  }
}

export function libelleDuGeste(g: GesteJamaisPermis): string {
  switch (g) {
    case 'publier':
      return t('publier quoi que ce soit');
    case 'deployer':
      return t('mettre en ligne');
    case 'mettre_en_production':
      return t('mettre en production');
    case 'envoyer_au_client':
      return t('envoyer un message à un client');
    case 'payer':
      return t('payer ou acheter');
    case 'lancer_carte':
      return t('lancer une tâche');
    case 'modifier_code':
      return t('modifier le code');
    default:
      return t('supprimer des données');
  }
}

/** Le nom court d'un jour (dimanche = 0), dans la langue de l'écran. */
function jourCourt(jour: number): string {
  // Le 1er novembre 2026 est un dimanche : on avance de `jour` jours.
  return new Date(Date.UTC(2026, 10, 1 + jour, 12)).toLocaleDateString(formatRegional(), { weekday: 'short', timeZone: 'UTC' });
}

/** « 8:00 », dans la langue de l'écran. */
function heureCourte(heure: string): string {
  const [h, m] = heure.split(':').map(Number);
  return new Date(Date.UTC(2026, 0, 1, h ?? 0, m ?? 0)).toLocaleTimeString(formatRegional(), { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
}

/** Un déclencheur en mots, phrase entière traduite (jamais des morceaux collés). */
export function declencheurLisible(d: Declencheur): string {
  if (d.genre === 'manuel') return t('À la demande');
  if (d.genre === 'evenement') return libelleDeSource(d.source);
  if (d.genre === 'veille') return t('Surveillance : {v0}', { v0: d.description });
  const heure = heureCourte(d.heure);
  let phrase =
    d.rythme === 'jour'
      ? t('Chaque jour à {v0}', { v0: heure })
      : d.rythme === 'mois'
        ? t('Le {v0} du mois à {v1}', { v0: d.jourDuMois ?? 1, v1: heure })
        : t('{v0} à {v1}', { v0: (d.jours?.length ? d.jours : [1]).map(jourCourt).join(' '), v1: heure });
  if (d.joursExclus?.length) {
    const jours = d.joursExclus.map(jourCourt).join(' ');
    phrase = d.report ? t('{v0}, sauf {v1} (reporté)', { v0: phrase, v1: jours }) : t('{v0}, sauf {v1}', { v0: phrase, v1: jours });
  }
  return phrase;
}

/** « Chaque jour à 08:00 · À chaque nouvelle demande client ». */
export function quandIlAgit(agent: Pick<AgentPerso, 'fiche'>): string {
  if (!agent.fiche.declencheurs.length) return t('À définir');
  return agent.fiche.declencheurs.map(declencheurLisible).join(' · ');
}

/** Le badge d'état : une forme et un mot, le bleu pour ce qui attend un geste seulement. */
export function BadgeDEtat({ etat }: { etat: EtatAffiche }) {
  const attend = etat === 'a_valider';
  return (
    <span
      className={cn('inline-flex min-w-0 items-center gap-1.5 text-[13px]', attend ? 'font-medium text-important' : etat === 'au_travail' ? 'text-text' : 'text-muted')}
      data-etat-agent-perso={etat}
    >
      {etat === 'au_travail' ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
      ) : (
        <span
          aria-hidden
          className={cn(
            'block h-2 w-2 shrink-0',
            attend ? 'rounded-full bg-important' : etat === 'en_veille' ? 'rounded-full bg-text/60' : etat === 'pause_limite' ? 'rounded-sm bg-muted/60' : 'rounded-full ring-1 ring-inset ring-faint',
          )}
        />
      )}
      <span className="truncate">{libelleDEtat(etat)}</span>
    </span>
  );
}

/** L'interrupteur « Actif » d'une ligne : éteint et grisé tant que la fiche n'est pas complète. */
function InterrupteurDeLAgent({ agent }: { agent: AgentPerso }) {
  const [attente, setAttente] = React.useState(false);
  const complete = completionDeLaFiche(agent.fiche).remplies === completionDeLaFiche(agent.fiche).total;
  const basculer = async (allume: boolean) => {
    setAttente(true);
    try {
      await client.call({ type: allume ? 'agentsPerso.allumer' : 'agentsPerso.eteindre', projectId: agent.projectId, id: agent.id });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('L’agent n’a pas pu changer d’état'));
    } finally {
      setAttente(false);
    }
  };
  return (
    <span className="flex justify-end" onClick={(e) => e.stopPropagation()}>
      <Switch
        checked={agent.actif}
        attente={attente}
        disabled={!complete && !agent.actif}
        onCheckedChange={(v) => void basculer(v)}
        aria-label={agent.actif ? 'Mettre en pause' : 'Allumer l’agent'}
        title={complete || agent.actif ? (agent.actif ? t('Mettre en pause') : t('Allumer l’agent')) : t('Terminez sa fiche dans la conversation pour l’allumer')}
        data-interrupteur-agent-perso={agent.id}
      />
    </span>
  );
}

type Ligne = AgentPerso & { etat: EtatAffiche };

/**
 * LE POINT DU MATIN, pleine largeur au-dessus du tableau : une phrase qui résume la nuit, puis — s'il y en a — ce qui
 * attend un geste (en bleu, un bouton par agent), ce qui est fait, ce qui est tombé, qui est en pause. Chaque phrase
 * vient du journal des agents.
 */
function PointDuMatinDuProjet({
  point,
  onOuvrir,
  projetDe,
}: {
  point: PointDuMatin;
  onOuvrir: (id: string) => void;
  /** Sur la vue de tous les projets : le nom du projet de chaque agent cité. */
  projetDe?: (agentPersoId: string) => string | null;
}) {
  const projet = (id: string) => {
    const nom = projetDe?.(id);
    return nom ? (
      <span className="shrink-0 text-faint" data-projet-du-point={id}>
        {nom}
      </span>
    ) : null;
  };
  const resume =
    point.passages === 0
      ? t('Rien depuis hier soir. {v0} agent(s) allumé(s).', { v0: point.agentsActifs })
      : t('Depuis hier soir : {v0} passage(s), {v1} agent(s) allumé(s).', { v0: point.passages, v1: point.agentsActifs });
  return (
    <section className="rounded-2xl bg-surface px-4 py-3.5" data-point-du-matin="">
      <h2 className="text-[15px] font-semibold text-text">{t('Le point du matin')}</h2>
      <p className="mt-0.5 text-[13.5px] text-muted">{resume}</p>
      {point.aValider.length ? (
        <div className="mt-3 flex flex-wrap gap-2" data-point-a-valider="">
          {point.aValider.map((a) => (
            <button
              key={a.agentPersoId}
              type="button"
              onClick={() => onOuvrir(a.agentPersoId)}
              /* Le nom du projet allonge le libellé (vue de tous les projets) : sur téléphone il passe à la ligne, aligné à gauche. */
              className="inline-flex min-h-8 max-w-full items-center gap-2 rounded-lg bg-important-fond px-3 py-1 text-left text-[13px] font-medium text-important transition-colors hover:bg-important-fond/70"
              data-point-ouvrir={a.agentPersoId}
            >
              <span aria-hidden className="block h-1.5 w-1.5 shrink-0 rounded-full bg-important" />
              {t('{v0} : {v1} à valider', { v0: projetDe?.(a.agentPersoId) ? `${a.nom} · ${projetDe(a.agentPersoId)}` : a.nom, v1: a.attentes })}
            </button>
          ))}
        </div>
      ) : null}
      {point.faits.length || point.pannes.length || point.enPause.length ? (
        <ul className="mt-3 flex flex-col gap-1.5 text-[13.5px]">
          {point.faits.map((f, i) => (
            <li key={`f${i}`} className="flex min-w-0 gap-2 text-text">
              <span className="shrink-0 tabular-nums text-faint">{quandLisible(f.date)}</span>
              <span className="shrink-0 font-medium">{f.nom}</span>
              {projet(f.agentPersoId)}
              <span className="min-w-0 truncate text-muted" title={f.resume}>
                {f.resume}
              </span>
            </li>
          ))}
          {point.pannes.map((f, i) => (
            <li key={`p${i}`} className="flex min-w-0 gap-2">
              <span className="shrink-0 tabular-nums text-faint">{quandLisible(f.date)}</span>
              <span className="shrink-0 font-medium text-text">{f.nom}</span>
              {projet(f.agentPersoId)}
              <span className="min-w-0 truncate text-danger" title={f.resume}>
                {f.resume}
              </span>
            </li>
          ))}
          {point.enPause.map((p) => (
            <li key={`z${p.agentPersoId}`} className="flex min-w-0 gap-2 text-muted">
              <span className="shrink-0 font-medium text-text">{p.nom}</span>
              {projet(p.agentPersoId)}
              <span className="min-w-0 truncate">{t('en pause : sa limite est atteinte pour cette période.')}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * L'ONGLET « AGENTS » : le point du matin, le tableau, et « Nouvel agent » en geste principal de la page. Sans projet
 * (`null`), les agents de TOUS les projets : colonne « Projet », et « Nouvel agent » demande d'abord le projet.
 */
export function AgentsDuProjet({
  projectId,
  onOuvrir,
  onOuvrirUnChef,
}: {
  projectId: string | null;
  onOuvrir: (agentPersoId: string, projectId: string) => void;
  /** Ouvre la conversation d'un chef de Communication porté par ce projet (24/11/2026). */
  onOuvrirUnChef?: (agentId: string) => void;
}) {
  const { agents, point, erreur } = useAgentsDuProjet(projectId);
  const projets = useApp().projects;
  const projet = projectId ? projets.find((p) => p.id === projectId) : undefined;
  const tous = !projectId;
  const telephone = useTelephone();
  const [creation, setCreation] = React.useState(false);
  /* L'ouverture de la liste des projets, gardée pour le bouton du téléphone (voir plus bas). */
  const ouvrirLaListe = React.useRef<(() => void) | null>(null);
  const lignes = React.useMemo<Ligne[]>(() => (agents ?? []).map((a) => ({ ...a, etat: etatAffiche(a) })), [agents]);
  const nomsDesProjets = React.useMemo(() => new Map(projets.map((p) => [p.id, p.name])), [projets]);
  const projetDeLAgent = React.useMemo(() => new Map((agents ?? []).map((a) => [a.id, a.projectId])), [agents]);
  const ouvrirParId = (id: string) => {
    const duProjet = projectId ?? projetDeLAgent.get(id);
    if (duProjet) onOuvrir(id, duProjet);
  };
  /* LES PROJETS QUI PEUVENT RECEVOIR UN AGENT, dans l'ordre de la colonne de gauche (rang, puis nom). */
  const projetsOuverts = React.useMemo(
    () =>
      projets
        .filter((p) => !p.archived && !p.marqueSansDepot)
        .sort((a, b) => (a.rank ?? 1000) - (b.rank ?? 1000) || a.name.localeCompare(b.name)),
    [projets],
  );

  const nouvelAgent = async (dansLeProjet: string) => {
    setCreation(true);
    try {
      const r = await client.call<{ agent: AgentPerso }>({ type: 'agentsPerso.creer', projectId: dansLeProjet }, 30000);
      onOuvrir(r.agent.id, dansLeProjet);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('L’agent n’a pas pu être créé'));
    } finally {
      setCreation(false);
    }
  };

  const colonnes = React.useMemo<ColonneDuTableauCommun<Ligne>[]>(
    () => [
      {
        cle: 'nom',
        libelle: t('Agent'),
        valeur: (l) => l.fiche.nom,
        rendu: (l) => (
          <span className="flex min-w-0 items-center gap-2.5">
            <Bot className="h-4 w-4 shrink-0 text-muted" />
            <span className="line-clamp-2 min-w-0 max-w-[12rem] font-medium text-text" title={l.fiche.nom}>
              {nomDeLAgent(l)}
            </span>
          </span>
        ),
      },
      ...(tous
        ? [
            {
              cle: 'projet',
              libelle: t('Projet'),
              largeur: 170,
              filtre: 'choix' as const,
              lireFiltre: (l: Ligne) => l.projectId,
              libelleDuChoix: (v: string) => nomsDesProjets.get(v) ?? v,
              valeur: (l: Ligne) => nomsDesProjets.get(l.projectId) ?? '',
              rendu: (l: Ligne) => (
                <span className="block min-w-0 max-w-[11rem]">
                  <CelluleProjet id={l.projectId} />
                </span>
              ),
            },
          ]
        : []),
      {
        cle: 'quand',
        libelle: t('Quand il agit'),
        valeur: (l) => quandIlAgit(l),
        masqueSurTelephone: true,
        /* UN CADRE ÉTROIT (1024 px, colonne de gauche ouverte) garde Agent, Projet, État et Actif : la vue de tous les
           projets retire « Quand il agit » ; celle d'un projet le garde, elle n'a pas de colonne « Projet ». */
        secondaire: tous,
        rendu: (l) => (
          /* Trois colonnes de texte BORNÉES (deux lignes au plus) : les six colonnes tiennent sur un écran d'ordinateur. */
          <span className="line-clamp-2 block min-w-0 max-w-[12rem] text-muted" title={quandIlAgit(l)}>
            {quandIlAgit(l)}
          </span>
        ),
      },
      ...(tous
        ? []
        : [
          {
            cle: 'mission',
            libelle: t('Ce qu’il fait'),
            valeur: (l: Ligne) => l.fiche.mission,
            masqueSurTelephone: true,
            secondaire: true,
            rendu: (l: Ligne) => (
              <span className={cn('line-clamp-2 block min-w-0 max-w-[12rem]', l.fiche.mission ? 'text-muted' : 'text-faint')} title={l.fiche.mission}>
                {l.fiche.mission || t('À définir dans la conversation')}
              </span>
            ),
          },
          ]),
      {
        cle: 'etat',
        libelle: t('État'),
        largeur: 120,
        filtre: 'choix',
        lireFiltre: (l) => l.etat,
        libelleDuChoix: (v) => libelleDEtat(v as EtatAffiche),
        valeur: (l) => l.etat,
        rendu: (l) => <BadgeDEtat etat={l.etat} />,
      },
      {
        cle: 'derniere',
        libelle: t('Dernière action'),
        largeur: 180,
        sensNaturel: 'desc',
        valeur: (l) => l.derniereAction?.date ?? 0,
        masqueSurTelephone: true,
        secondaire: true,
        rendu: (l) =>
          l.derniereAction ? (
            <span className="flex min-w-0 max-w-[13rem] items-baseline gap-2" title={l.derniereAction.resume}>
              <span className="shrink-0 tabular-nums text-[12.5px] text-faint">{quandLisible(l.derniereAction.date)}</span>
              <span className="line-clamp-2 min-w-0 text-muted">{l.derniereAction.resume}</span>
            </span>
          ) : (
            <span className="text-faint">—</span>
          ),
      },
      {
        cle: 'actif',
        libelle: t('Actif'),
        largeur: 70,
        droite: true,
        valeur: (l) => (l.actif ? 1 : 0),
        rendu: (l) => <InterrupteurDeLAgent agent={l} />,
      },
    ],
    [tous, nomsDesProjets],
  );

  const contenuDuBouton = (
    <>
      {creation ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
      {t('Nouvel agent')}
    </>
  );

  return (
    <section className="flex min-w-0 flex-col gap-4" data-agents-du-projet={projectId ?? 'tous'}>
      {agents === null ? (
        <div className="flex flex-col gap-3" data-silhouette-des-agents="">
          <Silhouette className="h-20 w-full rounded-2xl" />
          {Array.from({ length: 4 }, (_, i) => (
            <Silhouette key={i} className="h-11 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          {point && agents.length ? (
            <PointDuMatinDuProjet
              point={point}
              onOuvrir={ouvrirParId}
              projetDe={tous ? (id) => nomsDesProjets.get(projetDeLAgent.get(id) ?? '') ?? null : undefined}
            />
          ) : null}
          {agents.length ? (
            <Tableau
              repere={tous ? 'agents-de-tous-les-projets' : 'agents-du-projet'}
              lignes={lignes}
              colonnes={colonnes}
              cle={(l) => l.id}
              onLigne={(l) => onOuvrir(l.id, l.projectId)}
              triInitial={{ colonne: 'nom', sens: 'asc' }}
              recherche={t('Chercher un agent…')}
              aere
              attributsLigne={(l) => ({ 'data-ligne-agent-perso': l.id, 'data-etat': l.etat })}
              pile={(l) => (
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate font-medium text-text">{nomDeLAgent(l)}</span>
                    {tous ? (
                      <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted" data-projet-de-l-agent={l.projectId}>
                        {(() => {
                          const p = projets.find((x) => x.id === l.projectId);
                          return p ? <PastilleProjet project={p} /> : null;
                        })()}
                        <span className="truncate">{nomsDesProjets.get(l.projectId) ?? ''}</span>
                      </span>
                    ) : null}
                    <span className="truncate text-[13px] text-muted">{quandIlAgit(l)}</span>
                    <BadgeDEtat etat={l.etat} />
                  </span>
                  <InterrupteurDeLAgent agent={l} />
                </span>
              )}
            />
          ) : (
            <div className="rounded-2xl bg-surface px-5 py-6" data-agents-vide="">
              <p className="text-[15px] font-medium text-text">
                {tous ? t('Aucun agent dans vos projets pour l’instant.') : t('Aucun agent dans {v0} pour l’instant.', { v0: projet?.name ?? '' })}
              </p>
              <p className="mt-1 max-w-[560px] text-[13.5px] text-muted">
                {tous
                  ? t('Un agent travaille seul dans un projet, au moment et dans les limites que vous fixez. « Nouvel agent » vous demande d’abord le projet, puis vous le créez en lui parlant.')
                  : t('Un agent travaille seul dans ce projet, au moment et dans les limites que vous fixez. Créez-le en lui parlant : il vous pose quelques questions et remplit sa configuration.')}
              </p>
            </div>
          )}
          {erreur ? <p className="text-[13px] text-faint">{erreur}</p> : null}
        </>
      )}
      {tous && telephone ? (
        /* SUR TÉLÉPHONE, LE GESTE PRINCIPAL VIT DANS LES TROIS POINTS DU HAUT, qui ne se referment pas d'eux-mêmes : une
           liste montée dans ce menu disparaissait avec lui. Elle est donc montée ici, sans déclencheur, et le bouton du
           menu le referme (Échap, que Radix écoute) avant de l'ouvrir. */
        <ListeDeroulante
          valeur=""
          titre={t('Dans quel projet ?')}
          options={projetsOuverts.map((p) => ({
            valeur: p.id,
            libelle: p.name,
            icone: <PastilleProjet project={p} />,
            attributs: { 'data-projet-du-nouvel-agent': p.id },
          }))}
          onChoisir={(id) => void nouvelAgent(id)}
          repere="choix-projet-nouvel-agent"
          declencheur={(ouvrir) => {
            ouvrirLaListe.current = () => ouvrir(null);
            return null;
          }}
        />
      ) : null}
      {onOuvrirUnChef && projectId ? <ChefsDuProjet projectId={projectId} onOuvrir={onOuvrirUnChef} /> : null}
      <GestePrincipal>
        {tous && telephone ? (
          <BoutonPrincipal
            onClick={() => {
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              window.setTimeout(() => ouvrirLaListe.current?.(), 0);
            }}
            disabled={creation || !projetsOuverts.length}
            data-nouvel-agent-perso="tous"
          >
            {contenuDuBouton}
          </BoutonPrincipal>
        ) : tous ? (
          /* LE PROJET D'ABORD (décision du 24/11/2026) : la liste déroulante commune, ancrée au bouton sur ordinateur,
             montée du bas sur téléphone — jamais une liste native. */
          <ListeDeroulante
            valeur=""
            titre={t('Dans quel projet ?')}
            options={projetsOuverts.map((p) => ({
              valeur: p.id,
              libelle: p.name,
              icone: <PastilleProjet project={p} />,
              attributs: { 'data-projet-du-nouvel-agent': p.id },
            }))}
            onChoisir={(id) => void nouvelAgent(id)}
            repere="choix-projet-nouvel-agent"
            data-choix-projet-nouvel-agent=""
            declencheur={(ouvrir) => (
              <BoutonPrincipal onClick={(e: React.MouseEvent) => ouvrir(e)} disabled={creation || !projetsOuverts.length} data-nouvel-agent-perso="tous">
                {contenuDuBouton}
              </BoutonPrincipal>
            )}
          />
        ) : (
          <BoutonPrincipal onClick={() => void nouvelAgent(projectId)} disabled={creation || !!projet?.archived} data-nouvel-agent-perso="">
            {contenuDuBouton}
          </BoutonPrincipal>
        )}
      </GestePrincipal>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Les chefs de Communication du projet (24/11/2026)                    */
/* ------------------------------------------------------------------ */

/** Les chefs que ce projet porte, et ceux que la personne a coupés ; relus à l'ouverture et quand un chef change. */
function useChefsDuProjet(projectId: string): { chefs: Agent[] | null; coupes: Set<string>; relire: () => void } {
  const [lus, setLus] = React.useState<{ ids: string[]; coupes: string[] } | null>(null);
  const [version, setVersion] = React.useState(0);
  React.useEffect(() => {
    let vivant = true;
    client
      .call<{ agents: Agent[]; coupes: string[] }>({ type: 'agents.chefsDuProjet', projectId })
      .then((r) => {
        if (!vivant) return;
        client.recevoirDesAgents(r.agents ?? []);
        setLus({ ids: (r.agents ?? []).map((a) => a.id), coupes: r.coupes ?? [] });
      })
      .catch(() => vivant && setLus({ ids: [], coupes: [] }));
    return () => {
      vivant = false;
    };
  }, [projectId, version]);
  /* L'état vivant de chaque chef (au travail, à vous) suit le canal : on relit le magasin, pas le démon. */
  const magasin = useApp().agents;
  const chefs = React.useMemo(() => (lus ? lus.ids.map((id) => magasin[id]).filter((a): a is Agent => !!a) : null), [lus, magasin]);
  const coupes = React.useMemo(() => new Set(lus?.coupes ?? []), [lus]);
  const relire = React.useCallback(() => setVersion((v) => v + 1), []);
  return { chefs, coupes, relire };
}

type LigneDeChef = Agent & { coupe: boolean };

/** L'interrupteur « Actif » d'un chef : coupé, il n'est plus relancé chaque matin et ne reçoit plus de travail. */
function InterrupteurDuChef({ chef, onChange }: { chef: LigneDeChef; onChange: () => void }) {
  const [attente, setAttente] = React.useState(false);
  const basculer = async (actif: boolean) => {
    setAttente(true);
    try {
      await client.call({ type: 'agents.couperLeChef', agentId: chef.id, coupe: !actif });
      onChange();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('L’agent n’a pas pu changer d’état'));
    } finally {
      setAttente(false);
    }
  };
  return (
    <span className="flex justify-end" onClick={(e) => e.stopPropagation()}>
      <Switch
        checked={!chef.coupe}
        attente={attente}
        onCheckedChange={(v) => void basculer(v)}
        aria-label={chef.coupe ? 'Rallumer le chef' : 'Couper le chef'}
        title={chef.coupe ? t('Rallumer le chef') : t('Couper le chef : il n’est plus relancé chaque matin')}
        data-interrupteur-chef={chef.id}
      />
    </span>
  );
}

function libelleDuMembre(chef: LigneDeChef): string {
  if (chef.coupe) return t('Coupé');
  const etat = etatDuMembre(chef);
  return etat === 'a-vous' ? t('Attend votre réponse') : etat === 'travail' ? t('Au travail') : t('Au repos');
}

/**
 * LES CHEFS DE COMMUNICATION DU PROJET, sous ses agents personnalisés (décision de l'utilisateur, 24/11/2026 : « les
 * garder, en agents visibles du projet »). Une ligne par chef : son état, sa dernière activité, son interrupteur ; un
 * clic ouvre sa conversation (avec les onglets de sa famille). Rien ne s'affiche quand le projet n'en porte aucun.
 */
function ChefsDuProjet({ projectId, onOuvrir }: { projectId: string; onOuvrir: (agentId: string) => void }) {
  const { chefs, coupes, relire } = useChefsDuProjet(projectId);
  const lignes = React.useMemo<LigneDeChef[]>(() => (chefs ?? []).map((c) => ({ ...c, coupe: coupes.has(c.id) })), [chefs, coupes]);
  const colonnes = React.useMemo<ColonneDuTableauCommun<LigneDeChef>[]>(
    () => [
      {
        cle: 'nom',
        libelle: t('Agent'),
        valeur: (l) => l.title ?? '',
        rendu: (l) => (
          <span className="flex min-w-0 items-center gap-2.5">
            <IconeDuMembre agent={l} />
            <span className="truncate font-medium text-text" title={l.title}>
              {l.title || t('Agent')}
            </span>
          </span>
        ),
      },
      {
        cle: 'etat',
        libelle: t('État'),
        largeur: 160,
        valeur: (l) => libelleDuMembre(l),
        rendu: (l) => <span className="truncate text-muted">{libelleDuMembre(l)}</span>,
      },
      {
        cle: 'derniere',
        libelle: t('Dernière activité'),
        largeur: 150,
        sensNaturel: 'desc',
        masqueSurTelephone: true,
        valeur: (l) => l.endedAt ?? l.startedAt ?? l.updatedAt ?? 0,
        rendu: (l) => <span className="tabular-nums text-[12.5px] text-faint">{quandLisible(l.endedAt ?? l.startedAt ?? l.updatedAt)}</span>,
      },
      {
        cle: 'actif',
        libelle: t('Actif'),
        largeur: 70,
        droite: true,
        valeur: (l) => (l.coupe ? 0 : 1),
        rendu: (l) => <InterrupteurDuChef chef={l} onChange={relire} />,
      },
    ],
    [relire],
  );
  if (!lignes.length) return null;
  return (
    <section className="flex min-w-0 flex-col gap-2" data-chefs-du-projet={projectId}>
      <h2 className={cn(TITRE_DE_SECTION, 'text-text')}>{t('Chefs de communication')}</h2>
      <Tableau
        repere="chefs-du-projet"
        lignes={lignes}
        colonnes={colonnes}
        cle={(l) => l.id}
        onLigne={(l) => onOuvrir(l.id)}
        triInitial={{ colonne: 'nom', sens: 'asc' }}
        aere
        attributsLigne={(l) => ({ 'data-ligne-chef': l.id, 'data-etat': l.coupe ? 'coupe' : etatDuMembre(l) })}
        pile={(l) => (
          <span className="flex min-w-0 flex-1 items-center gap-3">
            <IconeDuMembre agent={l} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate font-medium text-text">{l.title || t('Agent')}</span>
              <span className="truncate text-[13px] text-muted">{libelleDuMembre(l)}</span>
            </span>
            <InterrupteurDuChef chef={l} onChange={relire} />
          </span>
        )}
      />
    </section>
  );
}
