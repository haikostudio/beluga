import * as React from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Clock,
  Database,
  FolderTree,
  HardDriveDownload,
  History,
  Loader2,
  MessagesSquare,
  Play,
  Search,
  Sparkles,
  Wrench,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import {
  Agent,
  CONSERVATION_MAX,
  CONSERVATION_MIN,
  FREQUENCE_MAX,
  FREQUENCE_MIN,
  LIBELLE_MOTEUR_BASE,
  LIBELLE_MOYEN_FICHIERS,
  MOTEURS_BASE,
  MOYENS_FICHIERS,
  MoteurBase,
  MoyenFichiers,
  NOM_SITE_MAX,
  PointDeSauvegarde,
  ResumeDeSite,
  SiteASauvegarder,
  formaterOctets,
  jugerSite,
  phraseDeStatut,
  raisonDestinationRefusee,
  resumeParSite,
  siteVierge,
  DESCRIPTION_SITE_MAX,
  descriptionDuProjetSansFiche,
  raisonDemandeRefusee,
  volumeDuPoint,
} from '@haikodev/shared';
import {
  Badge,
  Button,
  ConfirmDialog,
  DialogTitle,
  Drawer,
  Input,
  Label,
  Switch,
  Textarea,
  ZoneDefilement,
} from '@/components/ui';
import { Chat } from '@/components/chat';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LES SNAPSHOTS DES SITES EN PRODUCTION — un tiroir, deux fenêtres.
 *
 * Le premier tiroir montre les SITES à sauvegarder : les projets de ce serveur
 * et les sites extérieurs, côte à côte, chacun avec sa dernière sauvegarde et ce
 * qu'il occupe. On y ajoute un site, on y règle ses accès, on y lance une
 * sauvegarde à la main. Le second tiroir, empilé par-dessus, est
 * l'HISTORIQUE : par site, chaque point de sauvegarde avec sa date, son issue,
 * son poids, et le volume total du site.
 *
 * Les règles (ce qui tient debout, les volumes, le ménage) vivent dans
 * `shared/src/snapshots.ts` ; le travail réel dans `server/src/snapshots.ts`.
 *
 * UNE SAUVEGARDE LANCÉE NE RETIENT PAS L'ÉCRAN : le serveur rend la main tout
 * de suite et l'état se relit toutes les cinq secondes tant qu'un site tourne.
 */

interface EtatSnapshots {
  sites: SiteASauvegarder[];
  points: PointDeSauvegarde[];
  projets: { id: string; nom: string; chemin: string }[];
  enCours: string[];
  dossier: string;
}

const ETAT_VIDE: EtatSnapshots = { sites: [], points: [], projets: [], enCours: [], dossier: '' };

/** Une date de sauvegarde telle qu'on la lit : « 26 août, 04:12 ». */
function dateLisible(at: number): string {
  if (!at) return '—';
  return new Date(at).toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Les colonnes sur lesquelles le tableau des sites peut se trier. */
type ColonneTri = 'nom' | 'dernier' | 'volume' | 'statut';
const RANG_STATUT: Readonly<Record<string, number>> = { echec: 0, jamais: 1, partiel: 2, reussi: 3 };

export function Snapshots({ open, onClose }: { open: boolean; onClose: () => void }) {
  const state = useApp();
  const [etat, setEtat] = React.useState<EtatSnapshots>(ETAT_VIDE);
  const [chargement, setChargement] = React.useState(false);
  const [fiche, setFiche] = React.useState<SiteASauvegarder | null>(null);
  const [historique, setHistorique] = React.useState(false);
  const [assistant, setAssistant] = React.useState(false);
  const [projetLance, setProjetLance] = React.useState('');
  const [relu, setRelu] = React.useState('');
  const [recherche, setRecherche] = React.useState('');
  const [tri, setTri] = React.useState<{ colonne: ColonneTri; sens: 1 | -1 }>({ colonne: 'nom', sens: 1 });
  /** La conversation de l'assistant, ouverte dans SON PROPRE tiroir latéral —
   *  plus en plein écran, à la place de cette fenêtre. */
  const [conversation, setConversation] = React.useState<{ agentId: string; projectId: string } | null>(null);

  const relire = React.useCallback(async () => {
    try {
      const data = await client.call<EtatSnapshots>({ type: 'snapshots.etat' });
      setEtat({ ...ETAT_VIDE, ...data });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Snapshots illisibles'));
    }
  }, []);

  // L'état se relit à CHAQUE ouverture — un site posé depuis un autre onglet
  // doit être là — puis toutes les cinq secondes tant qu'une sauvegarde tourne.
  React.useEffect(() => {
    if (!open) return;
    let vivant = true;
    setChargement(true);
    void relire().finally(() => {
      if (vivant) setChargement(false);
    });
    const minuteur = setInterval(() => {
      if (vivant) void relire();
    }, 5000);
    return () => {
      vivant = false;
      clearInterval(minuteur);
    };
  }, [open, relire]);

  const refusDestination = raisonDestinationRefusee(etat.dossier);
  const resumes = resumeParSite(etat.sites, etat.points);

  // LA RECHERCHE FILTRE EN TEMPS RÉEL, sur le nom du site — puis le TRI
  // s'applique, choisi par un clic sur l'entête de colonne.
  const resumesAffiches = React.useMemo(() => {
    const mot = recherche.trim().toLowerCase();
    const filtres = mot ? resumes.filter((r) => r.site.nom.toLowerCase().includes(mot)) : resumes;
    const rang = (r: ResumeDeSite) => RANG_STATUT[r.dernier ? r.dernier.statut : 'jamais'] ?? 0;
    const tries = [...filtres].sort((a, b) => {
      let ecart = 0;
      if (tri.colonne === 'nom') ecart = a.site.nom.localeCompare(b.site.nom, 'fr');
      else if (tri.colonne === 'dernier') ecart = (a.dernier?.debut ?? 0) - (b.dernier?.debut ?? 0);
      else if (tri.colonne === 'volume') ecart = a.octets - b.octets;
      else if (tri.colonne === 'statut') ecart = rang(a) - rang(b);
      return ecart * tri.sens;
    });
    return tries;
  }, [resumes, recherche, tri]);

  const trierPar = (colonne: ColonneTri) =>
    setTri((avant) => (avant.colonne === colonne ? { colonne, sens: avant.sens === 1 ? -1 : 1 } : { colonne, sens: 1 }));

  const lancer = async (id?: string) => {
    try {
      await client.call({ type: 'snapshots.lancer', ...(id ? { id } : {}) });
      client.pushToast('info', id ? t('Sauvegarde lancée.') : t('Sauvegarde de tous les sites dus lancée.'));
      void relire();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Sauvegarde impossible'));
    }
  };

  /**
   * OUVRIR LA CONVERSATION DE L'ASSISTANT, D'UN CLIC — DANS SON PROPRE TIROIR
   * LATÉRAL, empilé sur celui des snapshots, jamais en plein écran : la liste
   * des sites reste accessible derrière, et on n'a plus quitté la fenêtre pour
   * suivre l'agent.
   */
  const ouvrirLaConversation = (depart: { agentId: string; projectId: string }) => {
    client.setActiveProject(depart.projectId);
    setConversation(depart);
  };

  // Un projet du serveur sans sauvegarde : sa phrase de départ est déjà écrite
  // (son nom, son dossier), l'utilisateur n'a rien à saisir.
  const configurerProjet = async (projet: { id: string; nom: string; chemin: string }) => {
    setProjetLance(projet.id);
    try {
      const depart = await client.call<{ agentId: string; projectId: string }>({
        type: 'snapshots.configurer',
        description: descriptionDuProjetSansFiche({ nom: projet.nom, chemin: projet.chemin }),
        projectId: projet.id,
      });
      client.pushToast(
        'success',
        t('L’assistant configure ce site. Ses questions vous attendent dans la conversation.'),
      );
      void relire();
      ouvrirLaConversation(depart);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('L’assistant n’a pas pu démarrer'));
    } finally {
      setProjetLance('');
    }
  };

  // Une fiche qui échoue : l'assistant la relit sans attendre la nuit suivante.
  const faireRelire = async (site: SiteASauvegarder) => {
    setRelu(site.id);
    try {
      const depart = await client.call<{ agentId: string; projectId: string }>({
        type: 'snapshots.relire',
        id: site.id,
      });
      client.pushToast('success', t('L’assistant relit cette fiche et corrige ce qui bloque.'));
      void relire();
      ouvrirLaConversation(depart);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('L’assistant n’a pas pu démarrer'));
    } finally {
      setRelu('');
    }
  };

  return (
    <>
      <Drawer open={open} onClose={onClose}>
        <header className="flex shrink-0 flex-wrap items-center gap-2 px-3 pb-2">
          <HardDriveDownload className="h-3.5 w-3.5 shrink-0 text-accent" />
          <DialogTitle className="min-w-0 flex-1 truncate">{t('Snapshots')}</DialogTitle>
          <Button variant="ghost" size="sm" onClick={() => setHistorique(true)} data-snapshots-historique>
            <History className="h-3 w-3" />
            {t('Historique')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setAssistant(true)} data-snapshots-creer>
            <Sparkles className="h-3 w-3" />
            {t('Nouveau site')}
          </Button>
        </header>

        {refusDestination ? (
          <div
            className="mx-3 mb-2 flex shrink-0 items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2"
            data-snapshots-sans-destination
          >
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <p className="text-[12.5px] leading-relaxed text-text">{t(refusDestination)}</p>
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-2 px-3 pb-2">
            <p className="min-w-0 flex-1 truncate text-[12px] text-faint">
              {t('Disque de stockage : {dossier}', { dossier: etat.dossier })}
            </p>
            <Button variant="ghost" size="sm" onClick={() => void lancer()} data-snapshots-tout>
              <Play className="h-3 w-3" />
              {t('Tout sauvegarder')}
            </Button>
          </div>
        )}

        {etat.projets.length ? (
          <div
            className="mx-3 mb-2 flex shrink-0 flex-col gap-1.5 rounded-md border border-border bg-bg px-2.5 py-2"
            data-snapshots-projets-sans-fiche
          >
            <p className="text-[12.5px] leading-relaxed text-text">
              {etat.projets.length > 1
                ? t('{n} projets de ce serveur n’ont pas encore de sauvegarde. Un clic, et l’assistant leur en écrit une.', {
                    n: etat.projets.length,
                  })
                : t('Un projet de ce serveur n’a pas encore de sauvegarde. Un clic, et l’assistant lui en écrit une.')}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {etat.projets.map((projet) => (
                <Button
                  key={projet.id}
                  variant="outline"
                  size="sm"
                  disabled={!!projetLance}
                  onClick={() => void configurerProjet(projet)}
                  data-snapshots-projet-sans-fiche={projet.id}
                >
                  {projetLance === projet.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                  {projet.nom}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        {resumes.length ? (
          <div className="relative shrink-0 px-3 pb-2">
            <Search className="pointer-events-none absolute left-5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <Input
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder={t('Rechercher un site…')}
              className="h-8 pl-7 text-[13px]"
              autoComplete="off"
              data-snapshots-recherche
            />
          </div>
        ) : null}

        <ZoneDefilement fond="hsl(var(--surface))" className="px-2 pb-3">
          {chargement && !etat.sites.length ? (
            <p className="px-1 py-3 text-[12.5px] text-faint">{t('Lecture des snapshots…')}</p>
          ) : !resumes.length ? (
            <p className="px-1 py-3 text-[12.5px] text-faint">
              {t('Aucun site à sauvegarder pour l’instant.')}
            </p>
          ) : !resumesAffiches.length ? (
            <p className="px-1 py-3 text-[12.5px] text-faint">{t('Aucun site ne correspond à cette recherche.')}</p>
          ) : (
            <table className="w-full border-collapse text-left" data-snapshots-tableau>
              <thead>
                <tr className="border-b border-border text-[11.5px] uppercase tracking-wide text-faint">
                  <EnteteTriable colonne="nom" tri={tri} onTrier={trierPar} className="pl-1">
                    {t('Site')}
                  </EnteteTriable>
                  <th className="px-2 py-1.5 font-normal">{t('Fréquence')}</th>
                  <EnteteTriable colonne="dernier" tri={tri} onTrier={trierPar}>
                    {t('Dernière prise')}
                  </EnteteTriable>
                  <EnteteTriable colonne="volume" tri={tri} onTrier={trierPar}>
                    {t('Volume')}
                  </EnteteTriable>
                  <EnteteTriable colonne="statut" tri={tri} onTrier={trierPar}>
                    {t('Statut')}
                  </EnteteTriable>
                  <th className="px-2 py-1.5 font-normal" aria-hidden />
                </tr>
              </thead>
              <tbody>
                {resumesAffiches.map((resume) => (
                  <LigneSite
                    key={resume.site.id}
                    resume={resume}
                    travaille={etat.enCours.includes(resume.site.id)}
                    bloque={!!refusDestination}
                    onOuvrir={() => setFiche(resume.site)}
                    onLancer={() => void lancer(resume.site.id)}
                    onConversation={
                      resume.site.assistantId
                        ? () =>
                            ouvrirLaConversation({
                              agentId: resume.site.assistantId as string,
                              projectId: (resume.site.assistantProjectId || resume.site.projectId) as string,
                            })
                        : undefined
                    }
                    onRelire={() => void faireRelire(resume.site)}
                    relu={relu === resume.site.id}
                  />
                ))}
              </tbody>
            </table>
          )}
        </ZoneDefilement>
      </Drawer>

      {/* Le détail d'un site : empilé, la liste reste ouverte derrière. */}
      <FicheSite fiche={fiche} onClose={() => setFiche(null)} onChange={() => void relire()} />

      {/* L'assistant : le seul chemin de CRÉATION d'un site, depuis une phrase. */}
      <AssistantDeSite
        open={assistant}
        projets={etat.projets}
        onClose={() => setAssistant(false)}
        onLance={(depart) => {
          void relire();
          ouvrirLaConversation(depart);
        }}
      />

      {/* La conversation de l'assistant : SON PROPRE tiroir, jamais un départ
          en plein écran — la liste des sites reste ouverte derrière. */}
      <TiroirConversationAssistant
        depart={conversation}
        onClose={() => setConversation(null)}
        agent={conversation ? (state.agents[conversation.agentId] ?? null) : null}
      />

      {/* L'historique : la seconde fenêtre demandée, empilée elle aussi. */}
      <HistoriqueSnapshots open={historique} onClose={() => setHistorique(false)} resumes={resumes} />
    </>
  );
}

/** L'entête d'une colonne triable : un clic trie, un second clic inverse. */
function EnteteTriable({
  colonne,
  tri,
  onTrier,
  className,
  children,
}: {
  colonne: ColonneTri;
  tri: { colonne: ColonneTri; sens: 1 | -1 };
  onTrier: (colonne: ColonneTri) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const actif = tri.colonne === colonne;
  return (
    <th className={cn('px-2 py-1.5 font-normal', className)}>
      <button
        type="button"
        onClick={() => onTrier(colonne)}
        className={cn('inline-flex items-center gap-1 hover:text-text', actif && 'text-text')}
        data-snapshots-tri={colonne}
      >
        {children}
        {actif ? (
          tri.sens === 1 ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </th>
  );
}

/**
 * LA CONVERSATION DE L'ASSISTANT, EN TIROIR LATÉRAL. Elle réutilise le même
 * composant `Chat` que le fil plein écran : les questions posées avec
 * `ask_user`, la liste de tâches et le compte rendu s'y lisent pareil, sans
 * jamais quitter la fenêtre des snapshots.
 */
function TiroirConversationAssistant({
  depart,
  agent,
  onClose,
}: {
  depart: { agentId: string; projectId: string } | null;
  agent: Agent | null;
  onClose: () => void;
}) {
  return (
    <Drawer open={depart !== null} onClose={onClose} empile className="h-[92dvh]">
      <header className="flex shrink-0 items-center gap-2 px-3 pb-2">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" />
        <DialogTitle className="min-w-0 flex-1 truncate">
          {agent?.title ?? t('Assistant de configuration')}
        </DialogTitle>
      </header>
      <div className="flex min-h-0 flex-1 flex-col" data-snapshots-conversation-tiroir>
        {depart ? <Chat agent={agent} projectId={depart.projectId} /> : null}
      </div>
    </Drawer>
  );
}

/** Une ligne de la liste : le site, ce qu'il sauvegarde, et sa dernière prise. */
function LigneSite({
  resume,
  travaille,
  bloque,
  relu,
  onOuvrir,
  onLancer,
  onConversation,
  onRelire,
}: {
  resume: ResumeDeSite;
  travaille: boolean;
  bloque: boolean;
  relu: boolean;
  onOuvrir: () => void;
  onLancer: () => void;
  /** Absent tant qu'aucune conversation d'assistant n'a touché cette fiche. */
  onConversation?: () => void;
  onRelire: () => void;
}) {
  const { site, dernier, octets, points } = resume;
  return (
    <tr className="border-b border-border/60 last:border-0" data-snapshots-site={site.id}>
      <td className="py-1.5 pl-1 pr-2 align-top">
        <button type="button" onClick={onOuvrir} className="flex min-w-0 flex-col items-start gap-0.5 text-left">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn('min-w-0 truncate text-[13.5px]', site.actif ? 'text-text' : 'text-faint')}>
              {site.nom}
            </span>
            {!site.actif ? <Badge tone="neutral">{t('Éteint')}</Badge> : null}
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-faint">
            {site.base.moteur !== 'aucune' ? (
              <span className="inline-flex items-center gap-1">
                <Database className="h-3 w-3" />
                {t(LIBELLE_MOTEUR_BASE[site.base.moteur])}
              </span>
            ) : null}
            {site.fichiers.moyen !== 'aucun' ? (
              <span className="inline-flex items-center gap-1">
                <FolderTree className="h-3 w-3" />
                {t(LIBELLE_MOYEN_FICHIERS[site.fichiers.moyen])}
              </span>
            ) : null}
          </span>
        </button>
      </td>
      <td className="px-2 py-1.5 align-top text-[12.5px] text-faint">
        {t('tous les {n} j', { n: site.frequenceJours })}
      </td>
      <td className="px-2 py-1.5 align-top text-[12.5px] text-faint">
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {dernier ? dateLisible(dernier.debut) : t('jamais')}
        </span>
      </td>
      <td className="px-2 py-1.5 align-top text-[12.5px] text-faint">
        {t('{n} point(s) — {volume}', { n: points.length, volume: formaterOctets(octets) })}
      </td>
      <td className="px-2 py-1.5 align-top">
        {dernier ? (
          <Badge tone={dernier.statut === 'reussi' ? 'success' : dernier.statut === 'partiel' ? 'warning' : 'danger'}>
            {t(dernier.statut === 'reussi' ? 'À jour' : dernier.statut === 'partiel' ? 'Partiel' : 'Échec')}
          </Badge>
        ) : (
          <Badge tone="neutral">{t('Jamais pris')}</Badge>
        )}
      </td>
      <td className="py-1.5 pl-2 pr-1 align-top">
        <div className="flex items-center justify-end gap-1">
          {dernier?.statut === 'echec' ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={relu}
              onClick={onRelire}
              title={t('Faire relire cette fiche par l’assistant')}
              data-snapshots-relire={site.id}
            >
              {relu ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
              {t('Réparer')}
            </Button>
          ) : null}
          {onConversation ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={onConversation}
              title={t('Ouvrir la conversation de l’assistant')}
              data-snapshots-conversation={site.id}
            >
              <MessagesSquare className="h-3 w-3" />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            disabled={travaille || bloque}
            onClick={onLancer}
            data-snapshots-lancer={site.id}
          >
            {travaille ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            {travaille ? t('En cours…') : t('Sauvegarder')}
          </Button>
        </div>
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/* L'assistant : une phrase, et la fiche se remplit toute seule          */
/* ------------------------------------------------------------------ */

/**
 * CONFIGURER UN SITE NE SE FAIT PLUS AU FORMULAIRE. On décrit le site en une
 * phrase ; un agent léger lit le serveur, pose les questions qui restent dans la
 * conversation, et enregistre la fiche lui-même. Le formulaire, lui, reste pour
 * CORRIGER un site déjà là — changer un mot de passe ne mérite pas un tour de
 * moteur.
 */
function AssistantDeSite({
  open,
  projets,
  onClose,
  onLance,
}: {
  open: boolean;
  projets: { id: string; nom: string }[];
  onClose: () => void;
  onLance: (depart: { agentId: string; projectId: string }) => void;
}) {
  const [description, setDescription] = React.useState('');
  const [projet, setProjet] = React.useState('');
  const [enCours, setEnCours] = React.useState(false);

  // Le champ repart vierge à chaque ouverture : la demande précédente est partie
  // chez l'assistant, la relire ici ferait croire qu'elle attend encore.
  React.useEffect(() => {
    if (open) {
      setDescription('');
      setProjet('');
    }
  }, [open]);

  const refus = raisonDemandeRefusee(description);

  const lancer = async () => {
    setEnCours(true);
    try {
      const depart = await client.call<{ agentId: string; projectId: string }>({
        type: 'snapshots.configurer',
        description,
        ...(projet ? { projectId: projet } : {}),
      });
      client.pushToast(
        'success',
        t('L’assistant configure ce site. Ses questions vous attendent dans la conversation.'),
      );
      onClose();
      // La conversation s'ouvre TOUT DE SUITE : c'est là que la première
      // question attend, et l'attendre sans le savoir est le pire des cas.
      onLance(depart);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('L’assistant n’a pas pu démarrer'));
    } finally {
      setEnCours(false);
    }
  };

  return (
    <Drawer open={open} onClose={onClose} empile>
      <header className="flex shrink-0 items-center gap-2 px-3 pb-2">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" />
        <DialogTitle className="min-w-0 flex-1 truncate">{t('Nouveau site')}</DialogTitle>
      </header>

      <ZoneDefilement fond="hsl(var(--surface))" className="px-3 pb-3">
        <div className="flex flex-col gap-3">
          <p className="text-[12.5px] leading-relaxed text-faint">
            {t(
              'Décrivez le site en une phrase. L’assistant cherche lui-même la base et les fichiers, vous pose les questions qui restent, puis enregistre la fiche.',
            )}
          </p>

          <Champ libelle={t('Le site à sauvegarder')}>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={DESCRIPTION_SITE_MAX}
              rows={4}
              placeholder={t('Ex. : la boutique du client, un WordPress dans /var/www/boutique, à garder un mois')}
              className="text-[13px]"
              data-snapshots-description
            />
          </Champ>

          {projets.length ? (
            <Champ libelle={t('Un projet de ce serveur ?')}>
              <select
                value={projet}
                onChange={(e) => setProjet(e.target.value)}
                className={CLASSE_SELECT}
                data-snapshots-projet
              >
                <option value="">{t('Site extérieur')}</option>
                {projets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nom}
                  </option>
                ))}
              </select>
            </Champ>
          ) : null}

          {refus ? <p className="text-[12px] text-warning">{t(refus)}</p> : null}

          <div className="flex justify-end">
            <Button
              variant="default"
              size="sm"
              disabled={!!refus || enCours}
              onClick={() => void lancer()}
              data-snapshots-configurer
            >
              {enCours ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {enCours ? t('Démarrage…') : t('Configurer')}
            </Button>
          </div>

          <p className="text-[12px] leading-relaxed text-faint">
            {t(
              'Les identifiants trouvés ou donnés restent sur ce serveur : ils servent à relire la base et les fichiers du site, chaque nuit.',
            )}
          </p>
        </div>
      </ZoneDefilement>
    </Drawer>
  );
}


/* ------------------------------------------------------------------ */
/* La fiche d'un site                                                   */
/* ------------------------------------------------------------------ */

function Champ({ libelle, children }: { libelle: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{libelle}</Label>
      {children}
    </div>
  );
}

const CLASSE_SELECT =
  'h-8 w-full rounded-md border border-border bg-bg px-2 text-[13px] text-text disabled:opacity-60';

function FicheSite({
  fiche,
  onClose,
  onChange,
}: {
  fiche: SiteASauvegarder | null;
  onClose: () => void;
  onChange: () => void;
}) {
  const [site, setSite] = React.useState<SiteASauvegarder>(siteVierge());
  const [enCours, setEnCours] = React.useState(false);
  const [aSupprimer, setASupprimer] = React.useState(false);

  // Le formulaire se remplit à l'OUVERTURE, et seulement là : la relecture de
  // l'état toutes les cinq secondes ne doit pas écraser une frappe en cours.
  React.useEffect(() => {
    if (fiche) setSite(fiche);
  }, [fiche?.id, fiche]);

  const jugement = jugerSite(site);

  const majBase = (bout: Partial<SiteASauvegarder['base']>) =>
    setSite((avant) => ({ ...avant, base: { ...avant.base, ...bout } }));
  const majFichiers = (bout: Partial<SiteASauvegarder['fichiers']>) =>
    setSite((avant) => ({ ...avant, fichiers: { ...avant.fichiers, ...bout } }));

  const enregistrer = async () => {
    setEnCours(true);
    try {
      await client.call({ type: 'snapshots.enregistrerSite', site });
      client.pushToast('success', t('Site enregistré.'));
      onChange();
      onClose();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Site non enregistré'));
    } finally {
      setEnCours(false);
    }
  };

  const supprimer = async () => {
    try {
      await client.call({ type: 'snapshots.supprimerSite', id: site.id });
      client.pushToast('info', t('Site retiré. Les sauvegardes déjà prises restent sur le disque.'));
      onChange();
      onClose();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Site non retiré'));
    }
  };

  const distant = site.fichiers.moyen === 'ssh' || site.fichiers.moyen === 'ftp';

  return (
    <>
      <Drawer open={fiche !== null} onClose={onClose} empile>
        <header className="flex shrink-0 items-center gap-2 px-3 pb-2">
          <DialogTitle className="min-w-0 flex-1 truncate">
            {site.id ? site.nom || t('Site') : t('Nouveau site')}
          </DialogTitle>
          <Switch
            checked={site.actif}
            onCheckedChange={(actif) => setSite((avant) => ({ ...avant, actif }))}
            data-snapshots-actif
          />
        </header>

        <ZoneDefilement fond="hsl(var(--surface))" className="px-3 pb-3">
          <div className="flex flex-col gap-3">
            <Champ libelle={t('Nom du site')}>
              <Input
                value={site.nom}
                onChange={(e) => setSite((avant) => ({ ...avant, nom: e.target.value }))}
                maxLength={NOM_SITE_MAX}
                placeholder={t('Comment reconnaître ce site')}
                className="h-8 text-[13px]"
                autoComplete="off"
                data-snapshots-nom
              />
            </Champ>

            <Champ libelle={t('Base de données')}>
              <select
                value={site.base.moteur}
                onChange={(e) => majBase({ moteur: e.target.value as MoteurBase })}
                className={CLASSE_SELECT}
                data-snapshots-moteur
              >
                {MOTEURS_BASE.map((moteur) => (
                  <option key={moteur} value={moteur}>
                    {t(LIBELLE_MOTEUR_BASE[moteur])}
                  </option>
                ))}
              </select>
            </Champ>

            {site.base.moteur !== 'aucune' ? (
              <div className="flex flex-col gap-2 rounded-md border border-border/60 p-2.5">
                <Champ libelle={site.base.moteur === 'sqlite' ? t('Chemin du fichier') : t('Nom de la base')}>
                  <Input
                    value={site.base.nom}
                    onChange={(e) => majBase({ nom: e.target.value })}
                    className="h-8 text-[13px]"
                    autoComplete="off"
                    data-snapshots-base-nom
                  />
                </Champ>
                {site.base.moteur !== 'sqlite' ? (
                  <>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <Champ libelle={t('Machine')}>
                          <Input
                            value={site.base.hote}
                            onChange={(e) => majBase({ hote: e.target.value })}
                            placeholder="localhost"
                            className="h-8 text-[13px]"
                            autoComplete="off"
                          />
                        </Champ>
                      </div>
                      <div className="w-20">
                        <Champ libelle={t('Port')}>
                          <Input
                            value={site.base.port}
                            onChange={(e) => majBase({ port: e.target.value })}
                            className="h-8 text-[13px]"
                            autoComplete="off"
                          />
                        </Champ>
                      </div>
                    </div>
                    <Champ libelle={t('Utilisateur')}>
                      <Input
                        value={site.base.utilisateur}
                        onChange={(e) => majBase({ utilisateur: e.target.value })}
                        className="h-8 text-[13px]"
                        autoComplete="off"
                        data-snapshots-base-utilisateur
                      />
                    </Champ>
                    <Champ libelle={t('Mot de passe')}>
                      <Input
                        type="password"
                        value={site.base.motDePasse}
                        onChange={(e) => majBase({ motDePasse: e.target.value })}
                        className="h-8 text-[13px]"
                        autoComplete="off"
                      />
                    </Champ>
                  </>
                ) : null}
              </div>
            ) : null}

            <Champ libelle={t('Fichiers du site')}>
              <select
                value={site.fichiers.moyen}
                onChange={(e) => majFichiers({ moyen: e.target.value as MoyenFichiers })}
                className={CLASSE_SELECT}
                data-snapshots-moyen
              >
                {MOYENS_FICHIERS.map((moyen) => (
                  <option key={moyen} value={moyen}>
                    {t(LIBELLE_MOYEN_FICHIERS[moyen])}
                  </option>
                ))}
              </select>
            </Champ>

            {site.fichiers.moyen !== 'aucun' ? (
              <div className="flex flex-col gap-2 rounded-md border border-border/60 p-2.5">
                <Champ libelle={t('Dossier à sauvegarder')}>
                  <Input
                    value={site.fichiers.chemin}
                    onChange={(e) => majFichiers({ chemin: e.target.value })}
                    placeholder="/var/www/site"
                    className="h-8 text-[13px]"
                    autoComplete="off"
                    data-snapshots-chemin
                  />
                </Champ>
                {distant ? (
                  <>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <Champ libelle={t('Machine')}>
                          <Input
                            value={site.fichiers.hote}
                            onChange={(e) => majFichiers({ hote: e.target.value })}
                            className="h-8 text-[13px]"
                            autoComplete="off"
                            data-snapshots-fichiers-hote
                          />
                        </Champ>
                      </div>
                      <div className="w-20">
                        <Champ libelle={t('Port')}>
                          <Input
                            value={site.fichiers.port}
                            onChange={(e) => majFichiers({ port: e.target.value })}
                            className="h-8 text-[13px]"
                            autoComplete="off"
                          />
                        </Champ>
                      </div>
                    </div>
                    <Champ libelle={t('Utilisateur')}>
                      <Input
                        value={site.fichiers.utilisateur}
                        onChange={(e) => majFichiers({ utilisateur: e.target.value })}
                        className="h-8 text-[13px]"
                        autoComplete="off"
                        data-snapshots-fichiers-utilisateur
                      />
                    </Champ>
                    <Champ libelle={site.fichiers.moyen === 'ssh' ? t('Mot de passe (sinon la clé du serveur)') : t('Mot de passe')}>
                      <Input
                        type="password"
                        value={site.fichiers.motDePasse}
                        onChange={(e) => majFichiers({ motDePasse: e.target.value })}
                        className="h-8 text-[13px]"
                        autoComplete="off"
                      />
                    </Champ>
                  </>
                ) : null}
              </div>
            ) : null}

            <div className="flex gap-2">
              <div className="flex-1">
                <Champ libelle={t('Fréquence (jours)')}>
                  <Input
                    type="number"
                    min={FREQUENCE_MIN}
                    max={FREQUENCE_MAX}
                    value={String(site.frequenceJours)}
                    onChange={(e) =>
                      setSite((avant) => ({ ...avant, frequenceJours: Number(e.target.value) || 0 }))
                    }
                    className="h-8 text-[13px]"
                    data-snapshots-frequence
                  />
                </Champ>
              </div>
              <div className="flex-1">
                <Champ libelle={t('Conservation (jours)')}>
                  <Input
                    type="number"
                    min={CONSERVATION_MIN}
                    max={CONSERVATION_MAX}
                    value={String(site.conservationJours)}
                    onChange={(e) =>
                      setSite((avant) => ({ ...avant, conservationJours: Number(e.target.value) || 0 }))
                    }
                    className="h-8 text-[13px]"
                    data-snapshots-conservation
                  />
                </Champ>
              </div>
            </div>

            <Champ libelle={t('Note')}>
              <Textarea
                value={site.note}
                onChange={(e) => setSite((avant) => ({ ...avant, note: e.target.value }))}
                rows={2}
                placeholder={t('Ce que ce site contient, qui l’exploite…')}
                className="text-[13px]"
              />
            </Champ>

            {!jugement.ok ? (
              <p className="text-[12px] leading-relaxed text-warning" data-snapshots-refus>
                {t(jugement.raison ?? '')}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <Button
                variant="secondary"
                size="sm"
                onClick={enregistrer}
                disabled={enCours || !jugement.ok}
                data-snapshots-enregistrer
              >
                {enCours ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                {t('Enregistrer')}
              </Button>
              {site.id ? (
                <Button variant="ghost" size="sm" onClick={() => setASupprimer(true)} data-snapshots-supprimer>
                  <Trash2 className="h-3 w-3" />
                  {t('Retirer')}
                </Button>
              ) : null}
            </div>

            <p className="text-[12px] leading-relaxed text-faint">
              {t(
                'Les identifiants restent sur ce serveur : ils servent à relire la base et les fichiers du site, chaque nuit.',
              )}
            </p>
          </div>
        </ZoneDefilement>
      </Drawer>

      <ConfirmDialog
        open={aSupprimer}
        onClose={() => setASupprimer(false)}
        title={t('Retirer ce site ?')}
        description={t('Son historique disparaît de la liste. Les sauvegardes déjà posées sur le disque restent.')}
        confirmLabel={t('Retirer')}
        danger
        onConfirm={supprimer}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* L'historique                                                         */
/* ------------------------------------------------------------------ */

function HistoriqueSnapshots({
  open,
  onClose,
  resumes,
}: {
  open: boolean;
  onClose: () => void;
  resumes: ResumeDeSite[];
}) {
  const total = resumes.reduce((somme, resume) => somme + resume.octets, 0);

  return (
    <Drawer open={open} onClose={onClose} empile>
      <header className="flex shrink-0 items-center gap-2 px-3 pb-2">
        <History className="h-3.5 w-3.5 shrink-0 text-accent" />
        <DialogTitle className="min-w-0 flex-1 truncate">{t('Historique des snapshots')}</DialogTitle>
        <Badge tone="neutral">{t('Total : {volume}', { volume: formaterOctets(total) })}</Badge>
      </header>

      <ZoneDefilement fond="hsl(var(--surface))" className="px-3 pb-3">
        {!resumes.length ? (
          <p className="py-3 text-[12.5px] text-faint">{t('Aucune sauvegarde prise pour l’instant.')}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {resumes.map((resume) => (
              <section key={resume.site.id} data-snapshots-historique-site={resume.site.id}>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 pb-1">
                  <h3 className="min-w-0 flex-1 truncate text-[13.5px] text-text">{resume.site.nom}</h3>
                  <span className="text-[12px] text-faint">
                    {t('{n} point(s) — {volume}', {
                      n: resume.points.length,
                      volume: formaterOctets(resume.octets),
                    })}
                  </span>
                </div>
                {!resume.points.length ? (
                  <p className="text-[12px] text-faint">{t('Jamais sauvegardé.')}</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {resume.points.map((point) => (
                      <LignePoint key={point.id} point={point} />
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </ZoneDefilement>
    </Drawer>
  );
}

/** Un point de sauvegarde : sa date, son issue, son poids, et ce qui a cloché. */
function LignePoint({ point }: { point: PointDeSauvegarde }) {
  return (
    <div
      className="flex flex-col gap-0.5 rounded-md border border-border bg-surface px-2.5 py-1.5"
      data-snapshots-point={point.id}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-text">{dateLisible(point.debut)}</span>
        <span className="shrink-0 text-[12px] text-faint">{formaterOctets(volumeDuPoint(point))}</span>
        <Badge tone={point.statut === 'reussi' ? 'success' : point.statut === 'partiel' ? 'warning' : 'danger'}>
          {t(point.origine === 'manuel' ? 'À la main' : 'Automatique')}
        </Badge>
      </span>
      <span className="text-[11.5px] leading-relaxed text-faint">{t(phraseDeStatut(point))}</span>
      {point.statut !== 'reussi' && point.detail ? (
        <span className="text-[11.5px] leading-relaxed text-warning">{point.detail}</span>
      ) : null}
    </div>
  );
}
