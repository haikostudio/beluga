import * as React from 'react';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  FolderTree,
  HardDriveDownload,
  History,
  Loader2,
  MessagesSquare,
  Play,
  RotateCcw,
  Search,
  Sparkles,
  KanbanSquare,
  Wrench,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import {
  Agent,
  CONSERVATION_MAX,
  CONSERVATION_MIN,
  FREQUENCE_MINUTES_MAX,
  FREQUENCE_MINUTES_MIN,
  cadenceValide,
  LIBELLE_GENRE_D_ETAPE,
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
  estUnRegroupement,
  libelleDansUnMenu,
  projetsEnArbre,
  raisonDemandeRefusee,
  recetteEffective,
  volumeDuPoint,
} from '@beluga/shared';
import {
  BulleInfo,
  Badge,
  Button,
  ConfirmDialog,
  DialogFooter,
  DialogTitle,
  Drawer,
  Input,
  Label,
  Switch,
  Textarea,
  ZoneDefilement,
  ListeDeroulante,
  FormulaireEnColonnes,
  LigneFormulaire,
} from '@/components/ui';
import { SilhouetteBackups } from '@/components/silhouettes';
import { Chat } from '@/components/chat';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';
import { useTelephone } from '@/lib/telephone';
import { cn } from '@/lib/utils';
import { useElementAdresse } from '@/lib/adresse-element';
import { lancerIntervalleVisible } from '@/lib/veille';

/**
 * LES BACKUPS DES SITES EN PRODUCTION — un tiroir, deux fenêtres.
 *
 * Le premier tiroir montre les SITES à sauvegarder : les projets de ce serveur
 * et les sites extérieurs, côte à côte, chacun avec sa dernière sauvegarde et ce
 * qu'il occupe. On y ajoute un site, on y règle ses accès, on y lance une
 * sauvegarde à la main. Le second tiroir, empilé par-dessus, est
 * l'HISTORIQUE : par site, chaque point de sauvegarde avec sa date, son issue,
 * son poids, et le volume total du site.
 *
 * Les règles (ce qui tient debout, les volumes, le ménage) vivent dans
 * `shared/src/backups.ts` ; le travail réel dans `server/src/backups.ts`.
 *
 * UNE SAUVEGARDE LANCÉE NE RETIENT PAS L'ÉCRAN : le serveur rend la main tout
 * de suite et l'état se relit toutes les cinq secondes tant qu'un site tourne.
 */

interface EtatBackups {
  sites: SiteASauvegarder[];
  points: PointDeSauvegarde[];
  projets: { id: string; nom: string; chemin: string }[];
  enCours: string[];
  restaurations: string[];
  dossier: string;
}

const ETAT_VIDE: EtatBackups = { sites: [], points: [], projets: [], enCours: [], restaurations: [], dossier: '' };

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

/**
 * LA CADENCE TELLE QU'ON LA LIT dans le tableau : « toutes les 15 min »,
 * « toutes les 2 h », « tous les 3 j ». Chaque tournure a sa clé de dictionnaire
 * — une phrase fabriquée côté serveur ne se traduirait pas.
 */
function cadenceLisible(frequenceMinutes: number): string {
  const minutes = cadenceValide(frequenceMinutes);
  if (minutes % (24 * 60) === 0) return t('tous les {n} j', { n: minutes / (24 * 60) });
  if (minutes % 60 === 0) return t('toutes les {n} h', { n: minutes / 60 });
  return t('toutes les {n} min', { n: minutes });
}

/** Les colonnes sur lesquelles le tableau des sites peut se trier. */
type ColonneTri = 'nom' | 'dernier' | 'volume' | 'statut';
const RANG_STATUT: Readonly<Record<string, number>> = { echec: 0, jamais: 1, partiel: 2, reussi: 3 };

/**
 * LE MÊME TRI, DEUX COMMANDES. Sur ordinateur il se choisit en cliquant
 * l'entête d'une colonne ; sur téléphone il n'y a plus d'entête à cliquer (les
 * sites y sont des FICHES empilées), donc un petit menu porte les mêmes clés.
 * Les libellés vivent ici, une seule fois : le tableau et le menu les
 * partagent, et le dictionnaire n'a qu'une entrée par clé.
 */
const CLES_LIBELLE_TRI: Readonly<Record<ColonneTri, string>> = {
  nom: 'Site',
  dernier: 'Dernière prise',
  volume: 'Volume',
  statut: 'Statut',
};
const CLES_TRI: readonly ColonneTri[] = ['nom', 'dernier', 'volume', 'statut'];

export function Backups({
  open,
  onClose,
  enPage,
  vise,
  onVise,
}: {
  open: boolean;
  onClose: () => void;
  /** Écran plein du volet central, au lieu d'un tiroir posé par-dessus. */
  enPage?: boolean;
  /** LE SITE DÉSIGNÉ PAR L'ADRESSE : « #backups/<id> ». */
  vise?: string | null;
  /** …et le site ouvert, remonté pour que l'adresse le décrive. */
  onVise?: (siteId: string | null) => void;
}) {
  const state = useApp();
  /* SOUS LE SEUIL « sm », LES SITES NE SONT PLUS UN TABLEAU MAIS DES FICHES.
     Le choix se fait en JavaScript, pas par une classe `hidden sm:table` : les
     deux rendus porteraient alors les MÊMES repères (`data-backups-site`,
     `data-backups-lancer`) en double dans la page, ce qui casse autant les
     contrôles au navigateur que la lecture d'écran. */
  const telephone = useTelephone();
  const [etat, setEtat] = React.useState<EtatBackups>(ETAT_VIDE);
  /* VRAI DÈS LE PREMIER RENDU, comme le coffre : sans cela l'écran affichait
     « aucun site à sauvegarder » avant même d'avoir demandé l'état. */
  const [chargement, setChargement] = React.useState(true);
  const [fiche, setFiche] = React.useState<SiteASauvegarder | null>(null);
  const [assistant, setAssistant] = React.useState(false);
  const [projetLance, setProjetLance] = React.useState('');
  /* LE CLIC, EN ATTENDANT L'AGENT : le site visé, puis l'agent rendu par le
     démon. Le loader ne suit plus cette valeur seule — elle retombait dès la
     réponse de la commande, alors que l'agent travaillait encore des minutes.
     Il suit l'AGENT lui-même (`state.agents`), et tient donc après un
     rechargement ou sur un autre appareil. */
  const [relu, setRelu] = React.useState<{ siteId: string; agentId?: string } | null>(null);
  const [pointARestaurer, setPointARestaurer] = React.useState<PointDeSauvegarde | null>(null);
  const [recherche, setRecherche] = React.useState('');
  const [tri, setTri] = React.useState<{ colonne: ColonneTri; sens: 1 | -1 }>({ colonne: 'nom', sens: 1 });
  /** La conversation de l'assistant, ouverte dans SON PROPRE tiroir latéral —
   *  plus en plein écran, à la place de cette fenêtre. */
  const [conversation, setConversation] = React.useState<{ agentId: string; projectId: string } | null>(null);

  const relire = React.useCallback(async () => {
    try {
      const data = await client.call<EtatBackups>({ type: 'backups.etat' });
      setEtat({ ...ETAT_VIDE, ...data });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Backups illisibles'));
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
    const arreter = lancerIntervalleVisible(() => {
      if (vivant) void relire();
    }, 5000);
    return () => {
      vivant = false;
      arreter();
    };
  }, [open, relire]);

  const refusDestination = raisonDestinationRefusee(etat.dossier);
  /* La fiche d'un site est une DESTINATION : son adresse se partage, et un
     retour en arrière la referme. */
  useElementAdresse({
    vise,
    onVise,
    ouvertId: fiche?.id || null,
    pret: !chargement,
    absent: t('Ce site n’est plus dans les sauvegardes.'),
    ouvrir: (id) => {
      const site = etat.sites.find((s) => s.id === id);
      if (!site) return false;
      setFiche(site);
      return true;
    },
  });

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

  /* CE QU'UN SITE AFFICHE ET CE QU'IL SAIT FAIRE, ÉCRIT UNE SEULE FOIS : la
     ligne de tableau (ordinateur) et la fiche (téléphone) reçoivent exactement
     les mêmes propriétés. Rien à tenir en double le jour où une action change. */
  /**
   * UN AGENT TRAVAILLE-T-IL SUR CE SITE ? Le clic couvre les secondes où
   * l'agent n'existe pas encore ; ensuite, seul son STATUT répond. Un agent
   * tout juste né (« idle ») compte encore : sa préparation précède le tour.
   */
  const agentAuTravail = (site: SiteASauvegarder): boolean => {
    const clic = relu?.siteId === site.id ? relu : null;
    if (clic && !clic.agentId) return true;
    const agentId = clic?.agentId ?? site.assistantId;
    const statut = agentId ? state.agents[agentId]?.status : undefined;
    if (statut === 'running' || statut === 'starting') return true;
    return Boolean(clic?.agentId) && (statut === undefined || statut === 'idle');
  };

  const propsDeSite = (resume: ResumeDeSite): PropsDeSite => ({
    resume,
    onCarte: resume.site.assistantCardId
      ? () =>
          ouvrirLaCarte(
            resume.site.assistantCardId as string,
            (resume.site.assistantProjectId || resume.site.projectId) as string,
          )
      : undefined,
    travaille: etat.enCours.includes(resume.site.id),
    bloque: !!refusDestination,
    onOuvrir: () => setFiche(resume.site),
    onLancer: () => void lancer(resume.site.id),
    onConversation: resume.site.assistantId
      ? () =>
          ouvrirLaConversation({
            agentId: resume.site.assistantId as string,
            projectId: (resume.site.assistantProjectId || resume.site.projectId) as string,
          })
      : undefined,
    onRelire: () => void faireRelire(resume.site),
    relu: agentAuTravail(resume.site),
  });

  /** LA CARTE DE L'AGENT, ouverte sur le tableau de son projet : la fenêtre se referme pour la montrer. */
  const ouvrirLaCarte = (cardId: string, projectId: string) => {
    onClose();
    client.allerVersDecision({ projectId, cardId });
  };

  const lancer = async (id?: string) => {
    try {
      await client.call({ type: 'backups.lancer', ...(id ? { id } : {}) });
      client.pushToast('info', id ? t('Sauvegarde lancée.') : t('Sauvegarde de tous les sites dus lancée.'));
      void relire();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Sauvegarde impossible'));
    }
  };

  /**
   * OUVRIR LA CONVERSATION DE L'ASSISTANT, D'UN CLIC — DANS SON PROPRE TIROIR
   * LATÉRAL, empilé sur celui des backups, jamais en plein écran : la liste
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
        type: 'backups.configurer',
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

  // Restaurer un point : le disque de stockage écrase ce que le site porte
  // aujourd'hui. Confirmé avant de partir (voir le dialogue plus bas), lancé
  // comme une sauvegarde — on ne retient pas l'écran, on relit l'état ensuite.
  const restaurer = async (point: PointDeSauvegarde) => {
    setPointARestaurer(null);
    try {
      await client.call({ type: 'backups.restaurer', id: point.id });
      client.pushToast('info', t('Restauration lancée.'));
      void relire();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Restauration impossible'));
    }
  };

  // Une fiche qui échoue : l'assistant la relit sans attendre la nuit suivante.
  const faireRelire = async (site: SiteASauvegarder) => {
    setRelu({ siteId: site.id });
    try {
      const depart = await client.call<{ agentId: string; projectId: string; cardId?: string }>({
        type: 'backups.relire',
        id: site.id,
      });
      // Le clic cède la place à l'agent : c'est son statut qui tient le loader.
      setRelu({ siteId: site.id, agentId: depart.agentId });
      client.pushToast('success', t('L’assistant relit cette fiche et corrige ce qui bloque.'));
      void relire();
      ouvrirLaConversation(depart);
    } catch (err: any) {
      setRelu(null);
      client.pushToast('error', err?.message ?? t('L’assistant n’a pas pu démarrer'));
    }
  };

  return (
    <>
      <Drawer open={open} onClose={onClose} enPage={enPage}>
        <header className="flex shrink-0 flex-wrap items-center gap-2 px-3 pb-2">
          <HardDriveDownload className="h-3.5 w-3.5 shrink-0 text-accent" />
          <DialogTitle className="min-w-0 flex-1 truncate">{t('Backups')}</DialogTitle>
          <Button variant="subtle" size="sm" onClick={() => setAssistant(true)} data-backups-creer>
            <Sparkles className="h-3 w-3" />
            {t('Nouveau site')}
          </Button>
        </header>

        {refusDestination ? (
          <div
            className="mx-3 mb-2 flex shrink-0 items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2"
            data-backups-sans-destination
          >
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <p className="text-[12.5px] leading-relaxed text-text">{t(refusDestination)}</p>
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-2 px-3 pb-2">
            <p className="min-w-0 flex-1 truncate text-[12px] text-faint">
              {t('Disque de stockage : {dossier}', { dossier: etat.dossier })}
            </p>
            <Button variant="ghost" size="sm" onClick={() => void lancer()} data-backups-tout>
              <Play className="h-3 w-3" />
              {t('Tout sauvegarder')}
            </Button>
          </div>
        )}

        {resumes.length ? (
          <div className="shrink-0 px-3 pb-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
              <Input
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                placeholder={t('Rechercher un site…')}
                className="h-8 pl-7 text-[13px]"
                autoComplete="off"
                data-backups-recherche
              />
            </div>
          </div>
        ) : null}

        {/* LE TRI, QUAND IL N'Y A PLUS D'ENTÊTES À CLIQUER. Sur téléphone les
            sites sont des fiches : le menu ci-dessous porte les mêmes clés que
            les entêtes du tableau et le même second appui qui inverse le sens.
            Il partage l'état `tri` — aucune règle de tri n'est réécrite. */}
        {telephone && resumesAffiches.length ? (
          <div className="flex shrink-0 items-center gap-1 overflow-x-auto px-3 pb-2" data-backups-tri-mobile>
            <span className="shrink-0 text-[11.5px] uppercase tracking-wide text-faint">{t('Trier')}</span>
            {CLES_TRI.map((colonne) => {
              const actif = tri.colonne === colonne;
              return (
                <Button
                  key={colonne}
                  variant={actif ? 'outline' : 'ghost'}
                  size="sm"
                  className="shrink-0"
                  aria-pressed={actif}
                  onClick={() => trierPar(colonne)}
                  data-backups-tri-choix={colonne}
                >
                  {t(CLES_LIBELLE_TRI[colonne])}
                  {actif ? (
                    tri.sens === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                  ) : null}
                </Button>
              );
            })}
          </div>
        ) : null}

        <ZoneDefilement fond="hsl(var(--surface))" className="px-2 pb-3">
          {chargement && !etat.sites.length ? (
            /* Le tableau à venir en silhouette : entêtes puis lignes, à leur
               place finale — plus de phrase grise ni d'état vide prématuré. */
            <SilhouetteBackups fiches={telephone} />
          ) : !resumes.length ? (
            <p className="px-1 py-3 text-[12.5px] text-faint">
              {t('Aucun site à sauvegarder pour l’instant.')}
            </p>
          ) : !resumesAffiches.length ? (
            <p className="px-1 py-3 text-[12.5px] text-faint">{t('Aucun site ne correspond à cette recherche.')}</p>
          ) : telephone ? (
            /* SUR TÉLÉPHONE, UNE FICHE PAR SITE. Le tableau tenait six colonnes
               dans 390 px : le statut se rognait et les boutons sortaient de
               l'écran. Les fiches consomment la MÊME liste déjà filtrée et
               triée, et les mêmes gestes. */
            <div className="space-y-1.5 pt-1" data-backups-fiches>
              {resumesAffiches.map((resume) => (
                <FicheSiteMobile key={resume.site.id} {...propsDeSite(resume)} />
              ))}
            </div>
          ) : (
            <table className="w-full border-collapse text-left" data-backups-tableau>
              <thead>
                <tr className="border-b border-border text-[11.5px] uppercase tracking-wide text-faint">
                  <EnteteTriable colonne="nom" tri={tri} onTrier={trierPar} className="pl-1">
                    {t('Site')}
                  </EnteteTriable>
                  <th className="hidden px-2 py-1.5 font-normal sm:table-cell">{t('Fréquence')}</th>
                  <EnteteTriable colonne="dernier" tri={tri} onTrier={trierPar}>
                    {t('Dernière prise')}
                  </EnteteTriable>
                  <EnteteTriable colonne="volume" tri={tri} onTrier={trierPar} className="hidden sm:table-cell">
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
                  <LigneSite key={resume.site.id} {...propsDeSite(resume)} />
                ))}
              </tbody>
            </table>
          )}
          {etat.projets.length ? (
            <TableauProjetsSansSauvegarde projets={etat.projets} projetLance={projetLance} onConfigurer={configurerProjet} />
          ) : null}
        </ZoneDefilement>
      </Drawer>

      {/* Le détail d'un site : empilé, la liste reste ouverte derrière — son
          historique (les points déjà pris, la restauration) y vit désormais,
          plus besoin d'une fenêtre séparée. */}
      <FicheSite
        fiche={fiche}
        onClose={() => setFiche(null)}
        onChange={() => void relire()}
        points={fiche ? (resumes.find((r) => r.site.id === fiche.id)?.points ?? []) : []}
        restaurations={etat.restaurations}
        onRestaurer={(point) => setPointARestaurer(point)}
      />

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

      <ConfirmDialog
        open={!!pointARestaurer}
        onClose={() => setPointARestaurer(null)}
        title={t('Restaurer ce point ?')}
        description={
          t(
            'Le site est d’abord sauvegardé tel qu’il est — ce filet reste dans l’historique —, puis ses données sont remplacées par celles de cette sauvegarde, du {date}.',
            { date: pointARestaurer ? dateLisible(pointARestaurer.debut) : '' },
          ) +
          (pointARestaurer?.inventaire?.etapes.some((etape) => etape.ok)
            ? ` ${t('Remis : {etapes}.', {
                etapes: pointARestaurer.inventaire.etapes
                  .filter((etape) => etape.ok)
                  .map((etape) => etape.libelle)
                  .join(', '),
              })}`
            : '')
        }
        confirmLabel={t('Restaurer')}
        danger
        onConfirm={() => pointARestaurer && void restaurer(pointARestaurer)}
      />
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
        data-backups-tri={colonne}
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
 * jamais quitter la fenêtre des backups.
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
      <div className="flex min-h-0 flex-1 flex-col" data-backups-conversation-tiroir>
        {depart ? <Chat agent={agent} projectId={depart.projectId} /> : null}
      </div>
    </Drawer>
  );
}

/** Une ligne de la liste : le site, ce qu'il sauvegarde, et sa dernière prise. */
interface PropsDeSite {
  resume: ResumeDeSite;
  travaille: boolean;
  bloque: boolean;
  /** Un agent d'analyse ou de réparation travaille sur ce site, en ce moment. */
  relu: boolean;
  onOuvrir: () => void;
  onLancer: () => void;
  /** Absent tant qu'aucune conversation d'assistant n'a touché cette fiche. */
  onConversation?: () => void;
  /** Absent pour une fiche dont l'agent est né avant les cartes d'agents. */
  onCarte?: () => void;
  onRelire: () => void;
}

/** La pastille de statut d'un site : la même dans le tableau et dans la fiche. */
function BadgeStatut({ dernier }: { dernier: PointDeSauvegarde | null }) {
  if (!dernier) return <Badge tone="neutral">{t('Jamais pris')}</Badge>;
  return (
    <Badge tone={dernier.statut === 'reussi' ? 'success' : dernier.statut === 'partiel' ? 'warning' : 'danger'}>
      {t(dernier.statut === 'reussi' ? 'À jour' : dernier.statut === 'partiel' ? 'Partiel' : 'Échec')}
    </Badge>
  );
}

/** D'où vient la recette qui tourne : écrite par l'agent, ou déduite de la fiche. */
function BadgeRecette({ site }: { site: SiteASauvegarder }) {
  return (
    <span className="inline-flex items-center gap-1" data-backups-recette={site.recette ? 'agent' : 'fiche'}>
      <Archive className="h-3 w-3" />
      {site.recette ? t('Recette de l’agent') : t('Recette déduite')}
    </span>
  );
}

/**
 * LA RECETTE DU SITE, TELLE QU'ELLE TOURNE : les étapes de l'agent, ou celles
 * déduites de la fiche en attendant son analyse. Les commandes se déplient à la
 * demande. Elles se LISENT ici, elles ne s'y modifient pas : c'est l'agent qui
 * les écrit ET les essaie, et une commande retouchée à la main n'aurait été
 * vue marcher par personne.
 */
function RecetteDuSite({ site }: { site: SiteASauvegarder }) {
  const [commandes, setCommandes] = React.useState(false);
  const recette = recetteEffective(site);
  return (
    <div className="flex flex-col gap-1.5 border-t border-border/60 pt-3" data-backups-recette-site={site.id}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h3 className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] text-text">
          <Archive className="h-3.5 w-3.5 shrink-0 text-faint" />
          {t('Recette de backup')}
          {site.recette?.explication ? <BulleInfo cote="start">{site.recette.explication}</BulleInfo> : null}
        </h3>
        <span className="text-[12px] text-faint">
          {site.recette
            ? site.recetteValideeLe
              ? t('Écrite par l’agent, essayée le {date}', { date: dateLisible(site.recetteValideeLe) })
              : t('Écrite par l’agent')
            : t('Déduite de la fiche, en attendant l’analyse')}
        </span>
      </div>
      {recette.etapes.length ? (
        <ol className="flex flex-col gap-1">
          {recette.etapes.map((etape) => (
            <li key={etape.id} className="flex flex-col gap-1 rounded-md bg-bloc px-2.5 py-1.5" data-backups-etape={etape.id}>
              <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_8.5rem] items-center gap-2">
                <span className="min-w-0 text-[12.5px] text-text">{etape.libelle}</span>
                <span className="flex justify-end whitespace-nowrap">
                  <Badge tone="neutral">{t(LIBELLE_GENRE_D_ETAPE[etape.genre])}</Badge>
                </span>
              </span>
              {commandes ? (
                <>
                  <span className="text-[11px] uppercase tracking-wide text-faint">{t('Prendre')}</span>
                  <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-text">
                    {etape.prendre}
                  </pre>
                  <span className="text-[11px] uppercase tracking-wide text-faint">{t('Remettre')}</span>
                  <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-text">
                    {etape.remettre}
                  </pre>
                </>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[12px] text-warning">{t('Aucune étape : ce site ne sauvegarde rien pour l’instant.')}</p>
      )}
      {recette.etapes.length ? (
        <button
          type="button"
          onClick={() => setCommandes((avant) => !avant)}
          aria-expanded={commandes}
          className="inline-flex items-center gap-1 self-start text-[12px] text-faint hover:text-text"
          data-backups-commandes
        >
          {commandes ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {t(commandes ? 'Masquer les commandes' : 'Voir les commandes')}
        </button>
      ) : null}
    </div>
  );
}

/** Les gestes d'un site — réparer ou analyser, ouvrir la conversation, sauvegarder. */
function ActionsDeSite({
  resume,
  travaille,
  bloque,
  relu,
  onLancer,
  onConversation,
  onCarte,
  onRelire,
}: Omit<PropsDeSite, 'onOuvrir'>) {
  const { site, dernier } = resume;
  return (
    <>
      {dernier?.statut === 'echec' ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={relu}
          onClick={onRelire}
          title={t('Faire relire cette fiche par l’assistant')}
          data-backups-relire={site.id}
          data-agent-au-travail={relu ? '' : undefined}
        >
          {relu ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
          {relu ? t('Réparation en cours…') : t('Réparer')}
        </Button>
      ) : !site.recette ? (
        /* UN SITE QUI TOURNE SUR LA RECETTE DÉDUITE DE SA FICHE se fait
           analyser d'un clic : l'agent lui écrit une vraie recette. Rien ne
           la lance tout seul sur un site qui marche. */
        <Button
          variant="ghost"
          size="sm"
          disabled={relu}
          onClick={onRelire}
          title={t('Faire écrire la recette de ce site par l’agent d’analyse')}
          data-backups-analyser={site.id}
          data-agent-au-travail={relu ? '' : undefined}
        >
          {relu ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          {relu ? t('Analyse en cours…') : t('Analyser')}
        </Button>
      ) : null}
      {onCarte ? (
        <Button
          variant="ghost"
          size="icon"
          onClick={onCarte}
          title={t('Ouvrir la carte de l’agent')}
          data-backups-carte={site.id}
        >
          <KanbanSquare className="h-3 w-3" />
        </Button>
      ) : null}
      {onConversation ? (
        <Button
          variant="ghost"
          size="icon"
          onClick={onConversation}
          title={t('Ouvrir la conversation de l’assistant')}
          data-backups-conversation={site.id}
        >
          <MessagesSquare className="h-3 w-3" />
        </Button>
      ) : null}
      <Button variant="ghost" size="sm" disabled={travaille || bloque} onClick={onLancer} data-backups-lancer={site.id}>
        {travaille ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
        {travaille ? t('En cours…') : t('Sauvegarder')}
      </Button>
    </>
  );
}

/**
 * UN SITE EN FICHE, sous le seuil « sm ». Le nom en tête avec sa pastille de
 * statut, les moyens et la cadence dessous, la dernière prise et le volume sur
 * leur ligne, puis les actions alignées à droite — plus rien de rogné ni hors
 * champ. Toucher le haut de la fiche ouvre le détail du site, comme le nom
 * dans le tableau.
 */
function FicheSiteMobile(props: PropsDeSite) {
  const { resume, onOuvrir } = props;
  const { site, dernier, octets, points } = resume;
  return (
    <div className="rounded-md border border-border/60 px-2.5 py-2" data-backups-site={site.id}>
      <button type="button" onClick={onOuvrir} className="flex w-full min-w-0 flex-col items-start gap-1 text-left">
        <span className="flex w-full min-w-0 items-center gap-1.5">
          <span className={cn('min-w-0 flex-1 truncate text-[13.5px]', site.actif ? 'text-text' : 'text-faint')}>
            {site.nom}
          </span>
          {!site.actif ? <Badge tone="neutral">{t('Éteint')}</Badge> : null}
          <BadgeStatut dernier={dernier} />
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
          <BadgeRecette site={site} />
          <span>{cadenceLisible(site.frequenceMinutes)}</span>
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-faint">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {dernier ? dateLisible(dernier.debut) : t('jamais')}
          </span>
          <span>{t('{n} point(s) — {volume}', { n: points.length, volume: formaterOctets(octets) })}</span>
        </span>
      </button>
      <div className="mt-1.5 flex flex-wrap items-center justify-end gap-1">
        <ActionsDeSite {...props} />
      </div>
    </div>
  );
}

function LigneSite({ resume, travaille, bloque, relu, onOuvrir, onLancer, onConversation, onCarte, onRelire }: PropsDeSite) {
  const { site, dernier, octets, points } = resume;
  return (
    <tr className="border-b border-border/60 last:border-0" data-backups-site={site.id}>
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
            <BadgeRecette site={site} />
          </span>
        </button>
      </td>
      <td className="hidden px-2 py-1.5 align-top text-[12.5px] text-faint sm:table-cell">
        {cadenceLisible(site.frequenceMinutes)}
      </td>
      <td className="px-2 py-1.5 align-top text-[12.5px] text-faint">
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {dernier ? dateLisible(dernier.debut) : t('jamais')}
        </span>
      </td>
      <td className="hidden px-2 py-1.5 align-top text-[12.5px] text-faint sm:table-cell">
        {t('{n} point(s) — {volume}', { n: points.length, volume: formaterOctets(octets) })}
      </td>
      <td className="px-2 py-1.5 align-top">
        <BadgeStatut dernier={dernier} />
      </td>
      <td className="py-1.5 pl-2 pr-1 align-top">
        <div className="flex items-center justify-end gap-1">
          <ActionsDeSite
            resume={resume}
            travaille={travaille}
            bloque={bloque}
            relu={relu}
            onLancer={onLancer}
            onConversation={onConversation}
            onCarte={onCarte}
            onRelire={onRelire}
          />
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

  /*
   * LES MEMBRES D'UN PROJET RÉUNI SE RANGENT SOUS LUI, ici aussi. Le serveur
   * n'envoie pas le projet réuni — il n'a ni dossier ni fichier à sauvegarder
   * (`projetsSansFiche`) : on le RAPPELLE donc en titre, non sélectionnable,
   * devant ses membres, d'après les projets que l'application connaît.
   */
  const projetsDeLApp = useApp().projects;
  const lignesDeProjets = React.useMemo(() => {
    const connus = new Map(projetsDeLApp.map((p) => [p.id, p]));
    const titres = new Set<string>();
    const liste: { id: string; name: string; isSelf?: boolean; regroupement?: boolean; regroupementId?: string }[] = [];
    for (const p of projets) {
      const connu = connus.get(p.id);
      const parent = connu?.regroupementId ? connus.get(connu.regroupementId) : undefined;
      if (parent && estUnRegroupement(parent) && !parent.archived && !titres.has(parent.id)) {
        titres.add(parent.id);
        liste.push({ id: parent.id, name: parent.name, regroupement: true });
      }
      liste.push({ id: p.id, name: p.nom, isSelf: connu?.isSelf, regroupementId: connu?.regroupementId });
    }
    return projetsEnArbre(liste).map((ligne) => ({ ...ligne, titre: titres.has(ligne.projet.id) }));
  }, [projets, projetsDeLApp]);

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
        type: 'backups.configurer',
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
        <BulleInfo>
          {t(
              'Décrivez le site en une phrase. L’agent d’analyse lit le site, écrit sa recette de backup (code, fichiers, bases), l’essaie pour de vrai, vous pose les questions qui restent, puis l’enregistre.',
            )}
          {'\n\n'}
          {t(
              'Les identifiants trouvés ou donnés restent sur ce serveur : ils servent à relire la base et les fichiers du site, chaque nuit.',
            )}
        </BulleInfo>
      </header>

      <ZoneDefilement fond="hsl(var(--surface))" className="px-3 pb-3">
        <FormulaireEnColonnes>
          <Champ libelle={t('Le site à sauvegarder')}>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={DESCRIPTION_SITE_MAX}
              rows={4}
              placeholder={t('Ex. : la boutique du client, un WordPress dans /var/www/boutique, à garder un mois')}
              className="text-[13px]"
              data-backups-description
            />
          </Champ>

          {projets.length ? (
            <Champ libelle={t('Un projet de ce serveur ?')}>
              <ListeDeroulante
                valeur={projet}
                titre={t('Un projet de ce serveur ?')}
                repere="backups-projet"
                data-backups-projet
                onChoisir={setProjet}
                options={[
                  { valeur: '', libelle: t('Site extérieur') },
                  ...lignesDeProjets.map((ligne) => ({
                    valeur: ligne.projet.id,
                    libelle: libelleDansUnMenu(ligne.projet.name, ligne),
                    desactivee: !!ligne.titre,
                    attributs: { 'data-membre-de': ligne.parentId },
                  })),
                ]}
              />
            </Champ>
          ) : null}

          {refus ? <p className="text-[12px] text-warning">{t(refus)}</p> : null}
        </FormulaireEnColonnes>
      </ZoneDefilement>

      <DialogFooter className="px-3 pt-2">
        <Button
          variant="default"
          size="sm"
          disabled={!!refus || enCours}
          onClick={() => void lancer()}
          data-backups-configurer
        >
          {enCours ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          {enCours ? t('Démarrage…') : t('Configurer')}
        </Button>
      </DialogFooter>
    </Drawer>
  );
}


/* ------------------------------------------------------------------ */
/* Les projets du serveur sans fiche : un tableau sous les sauvegardes  */
/* ------------------------------------------------------------------ */

/**
 * LES PROJETS DU SERVEUR SANS SAUVEGARDE — un tableau posé sous les sites déjà
 * sauvegardés, avec son propre champ de recherche en tête. Il ne filtre que
 * lui-même : la recherche du dessus ne touche que les sauvegardes. Une ligne
 * = un projet, son dossier, et le geste qui fait écrire sa recette par
 * l'assistant. Sur téléphone la colonne du dossier passe sous le nom.
 */
function TableauProjetsSansSauvegarde({
  projets,
  projetLance,
  onConfigurer,
}: {
  projets: { id: string; nom: string; chemin: string }[];
  projetLance: string;
  onConfigurer: (projet: { id: string; nom: string; chemin: string }) => void;
}) {
  const [recherche, setRecherche] = React.useState('');

  const filtres = React.useMemo(() => {
    const mot = recherche.trim().toLowerCase();
    return mot ? projets.filter((p) => p.nom.toLowerCase().includes(mot) || p.chemin.toLowerCase().includes(mot)) : projets;
  }, [projets, recherche]);

  return (
    <section className="mt-4 flex flex-col gap-2" data-backups-projets-sans-fiche>
      <div className="flex items-center gap-1.5 px-1">
        <h3 className="text-[13px] text-text">{t('Projets sans sauvegarde')}</h3>
        <Badge tone="neutral">{projets.length}</Badge>
        <BulleInfo cote="start">{t('Un clic sur « Configurer », et l’assistant écrit la sauvegarde du projet.')}</BulleInfo>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
        <Input
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder={t('Rechercher un projet…')}
          className="h-8 pl-7 text-[13px]"
          autoComplete="off"
          data-backups-projets-recherche
        />
      </div>
      <div role="table" className="flex flex-col" data-backups-projets-tableau>
        <div
          role="row"
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-b border-border px-1 py-1.5 text-[11.5px] uppercase tracking-wide text-faint sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_7.5rem]"
        >
          <span role="columnheader">{t('Projet')}</span>
          <span role="columnheader" className="hidden sm:block">
            {t('Dossier')}
          </span>
          <span role="columnheader" aria-hidden />
        </div>
        {filtres.length ? (
          filtres.map((projet) => (
            <div
              key={projet.id}
              role="row"
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-b border-border/60 px-1 py-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_7.5rem]"
              data-backups-projet-ligne={projet.id}
            >
              <span role="cell" className="flex min-w-0 flex-col">
                <span className="truncate text-[12.5px] text-text">{projet.nom}</span>
                <span className="truncate font-mono text-[11px] text-faint sm:hidden">{projet.chemin}</span>
              </span>
              <span role="cell" className="hidden truncate font-mono text-[11.5px] text-faint sm:block">
                {projet.chemin}
              </span>
              <span role="cell" className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!!projetLance}
                  onClick={() => onConfigurer(projet)}
                  data-backups-projet-sans-fiche={projet.id}
                >
                  {projetLance === projet.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  {t('Configurer')}
                </Button>
              </span>
            </div>
          ))
        ) : (
          <p className="px-1 py-3 text-[12px] text-faint">{t('Aucun projet ne correspond à cette recherche.')}</p>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* La fiche d'un site                                                   */
/* ------------------------------------------------------------------ */

/** Une ligne de formulaire : libellé à gauche, valeur à droite (`FormulaireEnColonnes`). */
function Champ({ libelle, aide, children }: { libelle: string; aide?: string; children: React.ReactNode }) {
  return (
    <LigneFormulaire libelle={libelle} aide={aide}>
      {children}
    </LigneFormulaire>
  );
}


function FicheSite({
  fiche,
  onClose,
  onChange,
  points,
  restaurations,
  onRestaurer,
}: {
  fiche: SiteASauvegarder | null;
  onClose: () => void;
  onChange: () => void;
  /** L'historique de CE site — l'ancien tiroir séparé vit ici désormais. */
  points: PointDeSauvegarde[];
  restaurations: string[];
  onRestaurer: (point: PointDeSauvegarde) => void;
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
      await client.call({ type: 'backups.enregistrerSite', site });
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
      await client.call({ type: 'backups.supprimerSite', id: site.id });
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
          <BulleInfo>{t(
                'Les identifiants restent sur ce serveur : ils servent à relire la base et les fichiers du site, chaque nuit.',
              )}</BulleInfo>
          <Switch
            checked={site.actif}
            onCheckedChange={(actif) => setSite((avant) => ({ ...avant, actif }))}
            data-backups-actif
          />
        </header>

        <ZoneDefilement fond="hsl(var(--surface))" className="px-3 pb-3">
          <FormulaireEnColonnes>
            <Champ libelle={t('Nom du site')}>
              <Input
                value={site.nom}
                onChange={(e) => setSite((avant) => ({ ...avant, nom: e.target.value }))}
                maxLength={NOM_SITE_MAX}
                placeholder={t('Comment reconnaître ce site')}
                className="h-8 text-[13px]"
                autoComplete="off"
                data-backups-nom
              />
            </Champ>

            <Champ libelle={t('Base de données')}>
              <ListeDeroulante
                valeur={site.base.moteur}
                titre={t('Base de données')}
                repere="backups-moteur"
                data-backups-moteur
                onChoisir={(valeur) => majBase({ moteur: valeur as MoteurBase })}
                options={MOTEURS_BASE.map((moteur) => ({ valeur: moteur, libelle: t(LIBELLE_MOTEUR_BASE[moteur]) }))}
              />
            </Champ>

            {site.base.moteur !== 'aucune' ? (
              <>
                <Champ libelle={site.base.moteur === 'sqlite' ? t('Chemin du fichier') : t('Nom de la base')}>
                  <Input
                    value={site.base.nom}
                    onChange={(e) => majBase({ nom: e.target.value })}
                    className="h-8 text-[13px]"
                    autoComplete="off"
                    data-backups-base-nom
                  />
                </Champ>
                {site.base.moteur !== 'sqlite' ? (
                  <>
                    <Champ libelle={t('Machine et port')}>
                      <div className="flex gap-2">
                        <Input
                          value={site.base.hote}
                          onChange={(e) => majBase({ hote: e.target.value })}
                          placeholder="localhost"
                          aria-label="Machine"
                          className="h-8 min-w-0 flex-1 text-[13px]"
                          autoComplete="off"
                        />
                        <Input
                          value={site.base.port}
                          onChange={(e) => majBase({ port: e.target.value })}
                          aria-label="Port"
                          className="h-8 w-20 text-[13px]"
                          autoComplete="off"
                        />
                      </div>
                    </Champ>
                    <Champ libelle={t('Utilisateur')}>
                      <Input
                        value={site.base.utilisateur}
                        onChange={(e) => majBase({ utilisateur: e.target.value })}
                        className="h-8 text-[13px]"
                        autoComplete="off"
                        data-backups-base-utilisateur
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
              </>
            ) : null}

            <Champ libelle={t('Fichiers du site')}>
              <ListeDeroulante
                valeur={site.fichiers.moyen}
                titre={t('Fichiers du site')}
                repere="backups-moyen"
                data-backups-moyen
                onChoisir={(valeur) => majFichiers({ moyen: valeur as MoyenFichiers })}
                options={MOYENS_FICHIERS.map((moyen) => ({ valeur: moyen, libelle: t(LIBELLE_MOYEN_FICHIERS[moyen]) }))}
              />
            </Champ>

            {site.fichiers.moyen !== 'aucun' ? (
              <>
                <Champ libelle={t('Dossier à sauvegarder')}>
                  <Input
                    value={site.fichiers.chemin}
                    onChange={(e) => majFichiers({ chemin: e.target.value })}
                    placeholder="/var/www/site"
                    className="h-8 text-[13px]"
                    autoComplete="off"
                    data-backups-chemin
                  />
                </Champ>
                {distant ? (
                  <>
                    <Champ libelle={t('Machine et port')}>
                      <div className="flex gap-2">
                        <Input
                          value={site.fichiers.hote}
                          onChange={(e) => majFichiers({ hote: e.target.value })}
                          aria-label="Machine"
                          className="h-8 min-w-0 flex-1 text-[13px]"
                          autoComplete="off"
                          data-backups-fichiers-hote
                        />
                        <Input
                          value={site.fichiers.port}
                          onChange={(e) => majFichiers({ port: e.target.value })}
                          aria-label="Port"
                          className="h-8 w-20 text-[13px]"
                          autoComplete="off"
                        />
                      </div>
                    </Champ>
                    <Champ libelle={t('Utilisateur')}>
                      <Input
                        value={site.fichiers.utilisateur}
                        onChange={(e) => majFichiers({ utilisateur: e.target.value })}
                        className="h-8 text-[13px]"
                        autoComplete="off"
                        data-backups-fichiers-utilisateur
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
              </>
            ) : null}

                <Champ libelle={t('Fréquence (minutes)')} aide={t('15 = un quart d’heure, 60 = une heure, 1440 = une fois par jour.')}>
                  <Input
                    type="number"
                    min={FREQUENCE_MINUTES_MIN}
                    max={FREQUENCE_MINUTES_MAX}
                    value={String(site.frequenceMinutes)}
                    onChange={(e) =>
                      setSite((avant) => ({ ...avant, frequenceMinutes: Number(e.target.value) || 0 }))
                    }
                    className="h-8 text-[13px]"
                    data-backups-frequence
                  />
                </Champ>
                <Champ libelle={t('Rétention (jours)')}>
                  <Input
                    type="number"
                    min={CONSERVATION_MIN}
                    max={CONSERVATION_MAX}
                    value={String(site.conservationJours)}
                    onChange={(e) =>
                      setSite((avant) => ({ ...avant, conservationJours: Number(e.target.value) || 0 }))
                    }
                    className="h-8 text-[13px]"
                    data-backups-conservation
                  />
                </Champ>

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
              <p className="text-[12px] leading-relaxed text-warning" data-backups-refus>
                {t(jugement.raison ?? '')}
              </p>
            ) : null}


            {site.id ? (
              <div data-pleine-largeur>
                <RecetteDuSite site={site} />
              </div>
            ) : null}

            {/* L'HISTORIQUE DE CE SITE : ce qui vivait dans un tiroir séparé
                se lit maintenant ici, au clic sur le site lui-même. */}
            {site.id ? (
              <div className="flex flex-col gap-1.5 border-t border-border/60 pt-3" data-backups-historique-site={site.id} data-pleine-largeur>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <h3 className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] text-text">
                    <History className="h-3.5 w-3.5 shrink-0 text-faint" />
                    {t('Historique')}
                  </h3>
                  <span className="text-[12px] text-faint">
                    {t('{n} point(s) — {volume}', {
                      n: points.length,
                      volume: formaterOctets(points.reduce((somme, point) => somme + volumeDuPoint(point), 0)),
                    })}
                  </span>
                </div>
                {!points.length ? (
                  <p className="text-[12px] text-faint">{t('Jamais sauvegardé.')}</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {points.map((point) => (
                      <LignePoint
                        key={point.id}
                        point={point}
                        enRestauration={restaurations.includes(point.id)}
                        onRestaurer={() => onRestaurer(point)}
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </FormulaireEnColonnes>
        </ZoneDefilement>

        <DialogFooter className="justify-start px-3 pt-2">
          <Button
            variant="subtle"
            size="sm"
            onClick={enregistrer}
            disabled={enCours || !jugement.ok}
            data-backups-enregistrer
          >
            {enCours ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            {t('Enregistrer')}
          </Button>
          {site.id ? (
            <Button variant="ghost" size="sm" onClick={() => setASupprimer(true)} data-backups-supprimer>
              <Trash2 className="h-3 w-3" />
              {t('Retirer')}
            </Button>
          ) : null}
        </DialogFooter>
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
/* Un point de sauvegarde, réutilisé dans l'historique de la fiche      */
/* ------------------------------------------------------------------ */

/** Un point de sauvegarde : sa date, son issue, son poids, et ce qui a cloché. */
function LignePoint({
  point,
  enRestauration,
  onRestaurer,
}: {
  point: PointDeSauvegarde;
  enRestauration: boolean;
  onRestaurer: () => void;
}) {
  const restaurable = point.statut !== 'echec' && !!(point.cheminArchive || point.chemin);
  return (
    <div
      className="flex flex-col gap-0.5 rounded-md border border-border bg-bloc px-2.5 py-1.5"
      data-backups-point={point.id}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-text">{dateLisible(point.debut)}</span>
        <span className="shrink-0 text-[12px] text-faint">{formaterOctets(volumeDuPoint(point))}</span>
        <Badge tone={point.statut === 'reussi' ? 'success' : point.statut === 'partiel' ? 'warning' : 'danger'}>
          {t(point.origine === 'manuel' ? 'À la main' : 'Automatique')}
        </Badge>
        {restaurable ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={enRestauration}
            onClick={onRestaurer}
            data-backups-restaurer={point.id}
          >
            {enRestauration ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RotateCcw className="h-3 w-3" />
            )}
            {t(enRestauration ? 'Restauration…' : 'Restaurer')}
          </Button>
        ) : null}
      </span>
      <span className="text-[11.5px] leading-relaxed text-faint">{t(phraseDeStatut(point))}</span>
      {/* CE QUE L'ARCHIVE CONTIENT, relu dans le zip : c'est cet inventaire qui
          a décidé du statut. Un point d'avant les archives le dit. */}
      {point.inventaire ? (
        <ul className="flex flex-col gap-0.5" data-backups-inventaire={point.id}>
          {point.inventaire.etapes.map((etape) => (
            <li
              key={etape.id}
              className={cn(
                'grid min-w-0 grid-cols-[0.75rem_minmax(0,1fr)_8.5rem] items-center gap-x-1.5 text-[11.5px]',
                etape.ok ? 'text-faint' : 'text-warning',
              )}
            >
              {etape.ok ? <Check className="h-3 w-3 shrink-0" /> : <TriangleAlert className="h-3 w-3 shrink-0" />}
              <span className="min-w-0 truncate">{etape.libelle}</span>
              <span className="text-right tabular-nums">
                {etape.ok
                  ? t('{n} fichier(s) — {volume}', { n: etape.fichiers, volume: formaterOctets(etape.octets) })
                  : etape.raison}
              </span>
            </li>
          ))}
        </ul>
      ) : point.statut !== 'echec' ? (
        <span className="text-[11.5px] text-faint" data-backups-ancien-format={point.id}>
          {t('Ancien format : un dossier, sans archive zip')}
        </span>
      ) : null}
      {point.statut !== 'reussi' && point.detail ? (
        <span className="text-[11.5px] leading-relaxed text-warning">{point.detail}</span>
      ) : null}
    </div>
  );
}
