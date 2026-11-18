import { ApercuAuSurvol, BasculeTableauCartes, CorpsDApercu, useVueDeLaListe } from '@/components/ui/apercu-au-survol';
import { BoutonFiltres } from '@/components/ui/boutons-a-menu';
import { CarteDeTableau } from '@/components/ui/carte-de-tableau';
import { Tableau, type ColonneDuTableauCommun } from '@/components/ui/tableau';
import { CelluleProjet } from '@/components/ui/colonne-projet';
import { BasculeDePage, RechercheDuService } from '@/components/fenetre-de-service';
import { useTiroirAdresse } from '@/lib/tiroirs-adresse';
import * as React from 'react';
import { EtatVideDuProjet, useProjetDuService } from '@/components/projet-du-service';
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
  Globe,
  HardDrive,
  History,
  Loader2,
  MessagesSquare,
  Play,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  KanbanSquare,
  ListFilter,
  Wrench,
  Trash2,
  TriangleAlert,
} from '@/components/ui/icones';
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
  EnteteDeFeuille,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DialogTitle,
  TitreDePage,
  Drawer,
  ChampMotDePasse,
  Input,
  Label,
  Switch,
  Textarea,
  ZoneDefilement,
  ListeDeroulante,
  FormulaireEnColonnes,
  LigneFormulaire,
  TELEPHONE_AVANT_SECTION,
  TELEPHONE_ENTRE_BLOCS,
  TELEPHONE_SOUS_UN_BLOC,
} from '@/components/ui';
import { SilhouetteBackups } from '@/components/silhouettes';
import { BoutonPrincipal, CranDuFil, GestePrincipal, GestesDePage, OptionDePage, OptionsDePage, SuiteDuFil } from '@/components/entete-de-zone';
import { CLASSE_SECTION_DE_SERVICE, ColonneDeService, useColonneDeService } from '@/components/colonne-de-service';
import { GesteDeCreationDeColonne, RubriqueDeColonne } from '@/components/rubriques-de-colonne';
import { Chat } from '@/components/chat';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';
import { PasAPas } from '@/components/pas-a-pas';
import { useTelephone } from '@/lib/telephone';
import { CLASSE_BOUTON_PLEINE_LARGEUR } from '@/components/menu-du-bas';
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
  /* LA COLONNE DE GAUCHE EST CELLE DES BACKUPS (demande du 12/10/2026) : le
     geste qui crée, détaché, puis « Tout sauvegarder ». Sur téléphone, ces deux
     gestes restent dans la page. */
  const dansLaColonne = useColonneDeService();
  const [etat, setEtat] = React.useState<EtatBackups>(ETAT_VIDE);
  /* VRAI DÈS LE PREMIER RENDU, comme le coffre : sans cela l'écran affichait
     « aucun site à sauvegarder » avant même d'avoir demandé l'état. */
  const [chargement, setChargement] = React.useState(true);
  const [fiche, setFiche] = React.useState<SiteASauvegarder | null>(null);
  const [assistant, setAssistant] = React.useState(false);
  useTiroirAdresse('nouveau-site-backups', assistant, setAssistant);
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
  /* UN SEUL TABLEAU (carte « Services homogènes et centrés », 14/11/2026) : les sites sauvegardés ET les projets sans
     sauvegarde ; le filtre d'état montre l'un, l'autre ou les deux. Lignes ou cartes, au choix retenu. */
  const [etatRetenu, setEtatRetenu] = React.useState<'tous' | 'sauvegardes' | 'sans'>('tous');
  const [vueDeLaListe, setVueDeLaListe] = useVueDeLaListe('backups.vueDeLaListe');
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

  /* DANS L'ONGLET D'UN PROJET (refonte du 13/11/2026) : ses sites seulement. */
  const projetDuService = useProjetDuService();
  const resumes = resumeParSite(
    projetDuService ? etat.sites.filter((site) => site.projectId === projetDuService.id) : etat.sites,
    etat.points,
  );

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

  const projetsSans = React.useMemo(() => {
    const mot = recherche.trim().toLowerCase();
    const liste = projetDuService ? etat.projets.filter((p) => p.id === projetDuService.id) : etat.projets;
    return mot ? liste.filter((p) => p.nom.toLowerCase().includes(mot) || p.chemin.toLowerCase().includes(mot)) : liste;
  }, [etat.projets, projetDuService?.id, recherche]);
  const sitesVus = etatRetenu === 'sans' ? [] : resumesAffiches;
  const projetsVus = etatRetenu === 'sauvegardes' ? [] : projetsSans;
  const nomDuProjet = (id: string | null) => (id ? (state.projects.find((p) => p.id === id)?.name ?? null) : null);

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

  /* UN PROJET SANS SAUVEGARDE, OUVERT EN ONGLET : il le dit, et propose de commencer (maquette #828a). */
  if (projetDuService && !chargement && !resumes.length && !fiche) {
    return (
      <>
        <Drawer open={open} onClose={onClose} enPage={enPage}>
          <EtatVideDuProjet
            icone={<HardDrive />}
            titre={t('Aucune sauvegarde pour {v0}', { v0: projetDuService.name })}
            texte={t('Ce projet n’est pas encore sauvegardé. Un agent prépare la sauvegarde avec vous — base de données, fichiers, fréquence — puis elle tourne toute seule.')}
            action={t('Créer une sauvegarde')}
            enCours={projetLance === projetDuService.id}
            onAction={() => void configurerProjet({ id: projetDuService.id, nom: projetDuService.name, chemin: projetDuService.path })}
            note={t('Les copies vont sur le disque de stockage, jamais sur le serveur.')}
            data-backups-vide
          />
        </Drawer>
        <TiroirConversationAssistant
          depart={conversation}
          onClose={() => setConversation(null)}
          agent={conversation ? (state.agents[conversation.agentId] ?? null) : null}
        />
      </>
    );
  }

  return (
    <>
      {/* LA LARGEUR EST CELLE DE TOUTES LES PAGES (`Drawer enPage`) : plus de
          surcharge ici, le tableau des sites est taillé pour y tenir. */}
      <Drawer open={open} onClose={onClose} enPage={enPage}>
        <TitreDePage>{t('Backups')}</TitreDePage>
        {dansLaColonne ? null : (
          <>
          {/* SUR TÉLÉPHONE : « Tout sauvegarder » est une ligne du menu à trois
              points, « Nouveau site » le bouton du bas de l'écran. */}
          <OptionsDePage>
            {refusDestination ? null : (
              <OptionDePage variante="ghost" icone={<Play className="h-3.5 w-3.5" />} onClick={() => void lancer()} data-backups-tout>
                {t('Tout sauvegarder')}
              </OptionDePage>
            )}
          </OptionsDePage>
          <GestePrincipal>
            <BoutonPrincipal onClick={() => setAssistant(true)} data-backups-creer>
              <Sparkles className="h-3.5 w-3.5" />
              {t('Nouveau site')}
            </BoutonPrincipal>
          </GestePrincipal>
          </>
        )}
        <ColonneDeService>
          <nav aria-label="Rubriques des backups" data-colonne-backups className="flex min-h-0 flex-1 flex-col gap-0.5 pt-1">
            <GesteDeCreationDeColonne
              libelle={t('Nouveau site')}
              aria-label="Nouveau site"
              data-backups-creer
              onClick={() => setAssistant(true)}
            />
            <RubriqueDeColonne
              icone={<HardDrive />}
              libelle={t('Tous les sites')}
              compte={resumes.length}
              actif={fiche === null}
              onClick={() => {
                setFiche(null);
                setRecherche('');
              }}
              data-backups-rubrique="sites"
            />
            {/* LES SITES ACTIFS, UN PAR LIGNE (demande du 12/10/2026) : un clic ouvre
                sa fiche, la ligne du site ouvert se retient. */}
            {resumes.some((r) => r.site.actif) ? (
              <>
                <p className={CLASSE_SECTION_DE_SERVICE}>{t('Sites actifs')}</p>
                {[...resumes]
                  .filter((r) => r.site.actif)
                  .sort((a, b) => a.site.nom.localeCompare(b.site.nom, 'fr'))
                  .map((r) => (
                    <RubriqueDeColonne
                      key={r.site.id}
                      icone={<Globe />}
                      libelle={r.site.nom}
                      actif={fiche?.id === r.site.id}
                      onClick={() => setFiche(r.site)}
                      data-backups-colonne-site={r.site.id}
                      data-statut={r.dernier?.statut ?? 'jamais'}
                    />
                  ))}
              </>
            ) : null}
            {refusDestination ? null : (
              <>
                <p className={CLASSE_SECTION_DE_SERVICE}>{t('Actions')}</p>
                <RubriqueDeColonne
                  icone={<Play />}
                  libelle={t('Tout sauvegarder')}
                  onClick={() => void lancer()}
                  data-backups-tout
                />
              </>
            )}
          </nav>
        </ColonneDeService>

        {refusDestination ? (
          <div
            className="mb-3 flex shrink-0 items-start gap-2 rounded-xl bg-surface px-4 py-3"
            data-backups-sans-destination
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-text" />
            <p className="text-[13.5px] leading-relaxed text-text">{t(refusDestination)}</p>
          </div>
        ) : null}

        {/* LA RECHERCHE, LE FILTRE D'ÉTAT ET LA BASCULE, DANS LA RANGÉE DU TITRE (carte « Services homogènes et
            centrés ») : plus de loupe à part ni de seconde recherche « Rechercher un projet… ». Sur téléphone, le tri
            des fiches et le disque de stockage sont des lignes du menu d'options. */}
        {resumes.length || etat.projets.length ? (
          <>
            <RechercheDuService valeur={recherche} onChange={setRecherche} placeholder={t('Rechercher un site…')} data-backups-recherche />
            <BasculeDePage>
              <BoutonFiltres
                icone
                repere="backups-etat"
                groupes={[
                  {
                    cle: 'etat',
                    titre: t('État'),
                    valeur: etatRetenu,
                    tout: 'tous',
                    options: [
                      { valeur: 'tous', libelle: t('Tous'), nombre: resumes.length + projetsSans.length },
                      { valeur: 'sauvegardes', libelle: t('Sauvegardés'), nombre: resumes.length },
                      { valeur: 'sans', libelle: t('Sans sauvegarde'), nombre: projetsSans.length },
                    ],
                    onChoisir: (v) => setEtatRetenu(v as 'tous' | 'sauvegardes' | 'sans'),
                  },
                ]}
              />
              <BasculeTableauCartes repere="vue-des-backups" valeur={vueDeLaListe} onChange={setVueDeLaListe} />
            </BasculeDePage>
          </>
        ) : null}
        <OptionsDePage>
          {refusDestination ? null : (
            <OptionDePage icone={<HardDrive className="h-3.5 w-3.5" />} disabled detail={etat.dossier} data-backups-disque-option>
              {t('Disque de stockage')}
            </OptionDePage>
          )}
          {telephone
            ? CLES_TRI.map((colonne) => (
                <OptionDePage
                  key={colonne}
                  icone={tri.colonne === colonne ? tri.sens === 1 ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" /> : <ListFilter className="h-3.5 w-3.5" />}
                  onClick={() => trierPar(colonne)}
                  data-backups-tri-choix={colonne}
                >
                  {t('Trier : {v0}', { v0: t(CLES_LIBELLE_TRI[colonne]) })}
                </OptionDePage>
              ))
            : null}
        </OptionsDePage>

        <ZoneDefilement fond="hsl(var(--bg))" className="pb-6">
          {chargement && !etat.sites.length ? (
            /* Le tableau à venir en silhouette : entêtes puis lignes, à leur
               place finale — plus de phrase grise ni d'état vide prématuré. */
            <SilhouetteBackups fiches={telephone} />
          ) : !resumes.length && !etat.projets.length ? (
            <PasAPas
              repere="backups"
              titre={t('Aucun site à sauvegarder pour l’instant.')}
              explication={t('Les sauvegardes copient régulièrement la base et les fichiers de vos sites, pour pouvoir revenir en arrière.')}
              etapes={[
                t('Ajoutez un site : sa base de données et le dossier de ses fichiers.'),
                t('Choisissez la fréquence des sauvegardes.'),
                t('Faites un essai : la première copie dit si tout est bien relié.'),
              ]}
            />
          ) : !sitesVus.length && !projetsVus.length ? (
            <p className="px-1 py-3 text-[12.5px] text-faint">{t('Aucun site ne correspond à cette recherche.')}</p>
          ) : vueDeLaListe === 'cartes' ? (
            /* LES CARTES : une par site, une par projet sans sauvegarde — toutes de la même forme. */
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" data-tableau="backups" data-backups-cartes data-tableau-cartes>
              {sitesVus.map((resume) => {
                const props = propsDeSite(resume);
                return (
                  <div
                    key={resume.site.id}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('a,button,[role=menu],[role=dialog]')) return;
                      props.onOuvrir();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && e.target === e.currentTarget) props.onOuvrir();
                    }}
                    className="flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-2xl bg-surface transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teinte/40"
                    data-backups-site={resume.site.id}
                    data-ligne-de-tableau={resume.site.id}
                  >
                    <CarteDeTableau
                      projet={{ id: resume.site.projectId, nom: nomDuProjet(resume.site.projectId) }}
                      etat={<BadgeStatut dernier={resume.dernier} />}
                      titre={resume.site.nom}
                      texte={cadenceLisible(resume.site.frequenceMinutes)}
                      chiffres={[
                        { libelle: t('Dernière prise'), valeur: resume.dernier ? dateLisible(resume.dernier.debut) : t('jamais') },
                        { libelle: t('Volume'), valeur: formaterOctets(resume.octets) },
                        { libelle: t('Points'), valeur: resume.points.length },
                      ]}
                      bas={<ActionsDeSite {...props} />}
                    />
                  </div>
                );
              })}
              {projetsVus.map((projet) => (
                <div key={projet.id} className="flex min-w-0 flex-col overflow-hidden rounded-2xl bg-surface" data-backups-projet-ligne={projet.id}>
                  <CarteDeTableau
                    projet={{ id: projet.id, nom: projet.nom }}
                    etat={<Badge tone="neutral">{t('Sans sauvegarde')}</Badge>}
                    titre={projet.nom}
                    texte={projet.chemin}
                    chiffres={[
                      { libelle: t('Dernière prise'), valeur: '—' },
                      { libelle: t('Volume'), valeur: '—' },
                      { libelle: t('Points'), valeur: '—' },
                    ]}
                    bas={<BoutonConfigurer projet={projet} projetLance={projetLance} onConfigurer={configurerProjet} />}
                  />
                </div>
              ))}
            </div>
          ) : telephone ? (
            /* SUR TÉLÉPHONE, UNE FICHE PAR SITE, puis une par projet sans sauvegarde — la MÊME liste filtrée et triée. */
            <div className="space-y-2" data-backups-fiches>
              {sitesVus.map((resume) => (
                <FicheSiteMobile key={resume.site.id} {...propsDeSite(resume)} />
              ))}
              {projetsVus.map((projet) => (
                <div key={projet.id} className="flex items-center gap-3 rounded-xl bg-surface px-3.5 py-3" data-backups-projet-ligne={projet.id}>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[13.5px] text-text">{projet.nom}</span>
                    <span className="truncate text-[12px] text-faint">{t('Aucune sauvegarde réglée')}</span>
                  </span>
                  <BoutonConfigurer projet={projet} projetLance={projetLance} onConfigurer={configurerProjet} />
                </div>
              ))}
            </div>
          ) : (
            /* UN SEUL TABLEAU : les sites (état, dernière prise, volume, gestes), puis les projets sans sauvegarde
               (« Sans sauvegarde », « Configurer »). L'aperçu au survol vaut pour les sites. */
            <ApercuAuSurvol lire={(id) => sitesVus.find((r) => r.site.id === id)} rendu={(r) => <ApercuDuSiteSauvegarde resume={r} />}>
            <table className="w-full border-collapse text-left" data-tableau="backups" data-backups-tableau>
              <thead>
                <tr className="text-[12.5px] bg-tableau-entete text-faint [&>th:first-child]:rounded-l-md [&>th:last-child]:rounded-r-md">
                  <EnteteTriable colonne="nom" tri={tri} onTrier={trierPar} className="pl-1">
                    {t('Site')}
                  </EnteteTriable>
                  <th className="hidden w-[170px] whitespace-nowrap px-2 h-11 py-2 font-medium lg:table-cell">{t('Projet')}</th>
                  <EnteteTriable colonne="dernier" tri={tri} onTrier={trierPar}>
                    {t('Dernière prise')}
                  </EnteteTriable>
                  <EnteteTriable colonne="volume" tri={tri} onTrier={trierPar} className="hidden md:table-cell">
                    {t('Volume')}
                  </EnteteTriable>
                  <EnteteTriable colonne="statut" tri={tri} onTrier={trierPar}>
                    {t('Statut')}
                  </EnteteTriable>
                  <th className="px-2 h-11 py-2 font-medium" aria-hidden />
                </tr>
              </thead>
              <tbody>
                {sitesVus.map((resume) => (
                  <LigneSite key={resume.site.id} {...propsDeSite(resume)} projet={nomDuProjet(resume.site.projectId)} />
                ))}
                {projetsVus.map((projet) => (
                  <tr key={projet.id} className="border-b border-border transition-colors hover:bg-surface" data-backups-projet-ligne={projet.id}>
                    <td className="w-full min-w-[9rem] max-w-[9rem] py-3 pl-1 pr-2 align-middle">
                      <span className="flex w-full min-w-0 flex-col gap-0.5">
                        <span className="truncate text-[13.5px] text-text">{projet.nom}</span>
                        <span className="truncate text-[12px] text-faint">{t('Aucune sauvegarde réglée')}</span>
                      </span>
                    </td>
                    <td className="hidden w-[170px] px-2 py-3 align-middle lg:table-cell">
                      <CelluleProjet id={projet.id} nom={projet.nom} />
                    </td>
                    <td className="whitespace-nowrap px-2 py-3 align-middle text-[12.5px] text-faint">—</td>
                    <td className="hidden whitespace-nowrap px-2 py-3 align-middle text-[12.5px] text-faint md:table-cell">—</td>
                    <td className="whitespace-nowrap px-2 py-3 align-middle">
                      <Badge tone="neutral" data-backups-sans-sauvegarde={projet.id}>
                        {t('Sans sauvegarde')}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap py-3 pl-2 pr-1 align-middle">
                      <div className="flex items-center justify-end">
                        <BoutonConfigurer projet={projet} projetLance={projetLance} onConfigurer={configurerProjet} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </ApercuAuSurvol>
          )}
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
        relu={fiche ? agentAuTravail(fiche) : false}
        onRelire={fiche ? () => void faireRelire(fiche) : undefined}
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
    <th className={cn('whitespace-nowrap px-2 h-11 py-2 font-medium', className)}>
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
    <Drawer adresse="conversation-backups" open={depart !== null} onClose={onClose} empile className="h-[92dvh]">
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
  const recette = recetteEffective(site);
  /* SUR TÉLÉPHONE, LA MENTION « ÉCRITE PAR L'AGENT, ESSAYÉE LE… » ENTRE DANS LA BULLE ⓘ (03/11/2026) : elle prenait
     une ligne entière. */
  const telephone = useTelephone();
  const mention = site.recette
    ? site.recetteValideeLe
      ? t('Écrite par l’agent, essayée le {date}', { date: dateLisible(site.recetteValideeLe) })
      : t('Écrite par l’agent')
    : t('Déduite de la fiche, en attendant l’analyse');
  const bulle = telephone ? (
    <>
      {site.recette?.explication ? <span className="block">{site.recette.explication}</span> : null}
      <span className={cn('block', site.recette?.explication && 'mt-1.5 text-faint')} data-backups-mention-dans-la-bulle>
        {mention}
      </span>
    </>
  ) : site.recette?.explication ?? null;
  return (
    <div className="flex flex-col gap-1.5 pt-2" data-backups-recette-site={site.id}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h3 className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] text-text">
          <Archive className="h-3.5 w-3.5 shrink-0 text-faint" />
          {t('Recette de backup')}
          {bulle ? <BulleInfo cote="start">{bulle}</BulleInfo> : null}
        </h3>
        {telephone ? null : <span className="text-[12px] text-faint">{mention}</span>}
      </div>
      {/* LA RECETTE EN TABLEAU (14/11/2026) : une ligne par élément sauvegardé et son type ; ses commandes (prendre,
          remettre) se déplient sur la ligne. */}
      {recette.etapes.length ? (
        <Tableau
          repere="recette-backups"
          lignes={recette.etapes}
          cle={(etape) => etape.id}
          colonnes={[
            { cle: 'libelle', libelle: t('Élément'), valeur: (etape) => etape.libelle, rendu: (etape) => <span className="text-text">{etape.libelle}</span> },
            { cle: 'genre', libelle: t('Type'), largeur: 170, valeur: (etape) => t(LIBELLE_GENRE_D_ETAPE[etape.genre]), rendu: (etape) => <Badge tone="neutral">{t(LIBELLE_GENRE_D_ETAPE[etape.genre])}</Badge> },
          ]}
          attributsLigne={(etape) => ({ 'data-backups-etape': etape.id })}
          detail={(etape) => (
            <div className="flex min-w-0 flex-col gap-1 py-1" data-backups-commandes-etape={etape.id}>
              <span className="text-[11px] uppercase tracking-wide text-faint">{t('Prendre')}</span>
              <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-text">{etape.prendre}</pre>
              <span className="text-[11px] uppercase tracking-wide text-faint">{t('Remettre')}</span>
              <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-text">{etape.remettre}</pre>
            </div>
          )}
        />
      ) : (
        <p className="text-[12px] text-warning">{t('Aucune étape : ce site ne sauvegarde rien pour l’instant.')}</p>
      )}
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
      {/* UNE PRISE PARTIELLE SE RÉPARE AUSSI (12/10/2026) : une part manquante
          (la base, les pièces jointes) n'est pas une sauvegarde à jour. */}
      {dernier?.statut === 'echec' || dernier?.statut === 'partiel' ? (
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
    <div className="rounded-xl bg-surface px-3.5 py-3" data-backups-site={site.id}>
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

/** L'aperçu d'un site au survol : statut, volume, cadence, et ses trois derniers points. */
function ApercuDuSiteSauvegarde({ resume }: { resume: ResumeDeSite }) {
  const { site, dernier, octets, points } = resume;
  return (
    <CorpsDApercu
      sous={cadenceLisible(site.frequenceMinutes)}
      titre={site.nom}
      chiffres={[
        { libelle: t('Statut'), valeur: <BadgeStatut dernier={dernier} /> },
        { libelle: t('Volume'), valeur: formaterOctets(octets) },
        { libelle: t('Points'), valeur: points.length },
        { libelle: t('Dernière prise'), valeur: dernier ? dateLisible(dernier.debut) : t('jamais') },
      ]}
    >
      {points.length ? (
        <ul className="mt-2 flex flex-col gap-1" data-derniers-points>
          {points.slice(0, 3).map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 text-[12px]">
              <span className="truncate text-muted">{dateLisible(p.debut)}</span>
              <span className="shrink-0 tabular-nums text-faint">{formaterOctets(p.octetsBase + p.octetsFichiers)}</span>
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', p.statut === 'reussi' ? 'bg-faint' : p.statut === 'partiel' ? 'bg-warning' : 'bg-danger')} aria-hidden />
            </li>
          ))}
        </ul>
      ) : null}
    </CorpsDApercu>
  );
}

function LigneSite({ resume, travaille, bloque, relu, onOuvrir, onLancer, onConversation, onCarte, onRelire, projet }: PropsDeSite & { projet?: string | null }) {
  const { site, dernier, octets, points } = resume;
  return (
    <tr className="group/ligne cursor-pointer border-b border-border transition-colors hover:bg-surface" data-backups-site={site.id} data-ligne-de-tableau={site.id} onClick={(e) => {
      // Toute la ligne ouvre la fiche, sauf ses propres gestes (lancer, conversation, carte, relire).
      if ((e.target as HTMLElement).closest('a,button,[role=menu],[role=dialog]')) return;
      onOuvrir();
    }}>
      {/* LA COLONNE DU SITE PREND CE QUI RESTE, ET SE TRONQUE : `w-full` lui
          donne la place libre, la largeur bornée empêche un nom long d'élargir
          le tableau au-delà de la page. */}
      <td className="w-full min-w-[9rem] max-w-[9rem] py-3 pl-1 pr-2 align-middle">
        <button type="button" onClick={onOuvrir} className="flex w-full min-w-0 flex-col items-start gap-0.5 text-left">
          <span className="flex w-full min-w-0 items-center gap-1.5">
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
      <td className="hidden w-[170px] px-2 py-3 align-middle lg:table-cell">
        <CelluleProjet id={site.projectId} nom={projet ?? null} />
      </td>
      <td className="whitespace-nowrap px-2 py-3 align-middle text-[12.5px] text-faint">
        <span className="flex flex-col gap-0.5">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {dernier ? dateLisible(dernier.debut) : t('jamais')}
          </span>
          <span className="text-[12px]">{cadenceLisible(site.frequenceMinutes)}</span>
        </span>
      </td>
      <td className="hidden whitespace-nowrap px-2 py-3 align-middle text-[12.5px] text-faint md:table-cell">
        <span className="flex flex-col gap-0.5">
          <span>{formaterOctets(octets)}</span>
          <span className="text-[12px]">{t('{n} point(s)', { n: points.length })}</span>
        </span>
      </td>
      <td className="whitespace-nowrap px-2 py-3 align-middle">
        <BadgeStatut dernier={dernier} />
      </td>
      <td className="whitespace-nowrap py-3 pl-2 pr-1 align-middle">
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

          {refus ? <p className="text-[12px] text-danger">{t(refus)}</p> : null}
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
/** « Configurer » : l'assistant écrit la sauvegarde d'un projet qui n'en a pas. */
function BoutonConfigurer({
  projet,
  projetLance,
  onConfigurer,
}: {
  projet: { id: string; nom: string; chemin: string };
  projetLance: string;
  onConfigurer: (projet: { id: string; nom: string; chemin: string }) => void;
}) {
  return (
    <Button variant="subtle" size="sm" disabled={!!projetLance} onClick={() => onConfigurer(projet)} data-backups-projet-sans-fiche={projet.id}>
      {projetLance === projet.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
      {t('Configurer')}
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/* La fiche d'un site                                                   */
/* ------------------------------------------------------------------ */

/** Une ligne de formulaire : libellé au-dessus, valeur dessous (`LigneFormulaire`). */
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
  relu = false,
  onRelire,
}: {
  fiche: SiteASauvegarder | null;
  /** L'agent d'analyse travaille déjà sur ce site : le bouton tourne. */
  relu?: boolean;
  /** CONFIGURER AVEC L'AGENT : il relit le site, écrit ou répare sa recette. */
  onRelire?: () => void;
  onClose: () => void;
  onChange: () => void;
  /** L'historique de CE site — l'ancien tiroir séparé vit ici désormais. */
  points: PointDeSauvegarde[];
  restaurations: string[];
  onRestaurer: (point: PointDeSauvegarde) => void;
}) {
  const telephone = useTelephone();
  const [site, setSite] = React.useState<SiteASauvegarder>(siteVierge());
  const [enCours, setEnCours] = React.useState(false);
  const [aSupprimer, setASupprimer] = React.useState(false);
  const [reglagesOuverts, setReglagesOuverts] = React.useState(false);

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
      /* Un site existant reste affiché : seule la feuille des réglages se referme. */
      if (site.id) setReglagesOuverts(false);
      else onClose();
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

  /* LES RÉGLAGES : la page d'un site neuf, la feuille d'un site existant. */
  const champsDuSite = (
    <FormulaireEnColonnes>
            <Champ libelle={t('Nom du site')}>
              <Input
                value={site.nom}
                onChange={(e) => setSite((avant) => ({ ...avant, nom: e.target.value }))}
                maxLength={NOM_SITE_MAX}
                placeholder={t('Comment reconnaître ce site')}
                className="sm:h-8 sm:text-[13px]"
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
                    className="sm:h-8 sm:text-[13px]"
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
                        className="sm:h-8 sm:text-[13px]"
                        autoComplete="off"
                        data-backups-base-utilisateur
                      />
                    </Champ>
                    <Champ libelle={t('Mot de passe')}>
                      <ChampMotDePasse
                        value={site.base.motDePasse}
                        onChange={(e) => majBase({ motDePasse: e.target.value })}
                        className="sm:h-8 sm:text-[13px]"
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
                    className="sm:h-8 sm:text-[13px]"
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
                        className="sm:h-8 sm:text-[13px]"
                        autoComplete="off"
                        data-backups-fichiers-utilisateur
                      />
                    </Champ>
                    <Champ libelle={site.fichiers.moyen === 'ssh' ? t('Mot de passe (sinon la clé du serveur)') : t('Mot de passe')}>
                      <ChampMotDePasse
                        value={site.fichiers.motDePasse}
                        onChange={(e) => majFichiers({ motDePasse: e.target.value })}
                        className="sm:h-8 sm:text-[13px]"
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
                    className="sm:h-8 sm:text-[13px]"
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
                    className="sm:h-8 sm:text-[13px]"
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
              <p className="text-[12px] leading-relaxed text-danger" data-backups-refus>
                {t(jugement.raison ?? '')}
              </p>
            ) : null}

      <div className="flex items-center gap-2 text-[13px] text-text">
        <Switch
          checked={site.actif}
          onCheckedChange={(actif) => setSite((avant) => ({ ...avant, actif }))}
          aria-label="Site actif"
          data-backups-actif
        />
        <span>{t('Site actif')}</span>
        <BulleInfo>{t(
          'Les identifiants restent sur ce serveur : ils servent à relire la base et les fichiers du site, chaque nuit.',
        )}</BulleInfo>
      </div>
    </FormulaireEnColonnes>
  );
  const piedDesReglages = (
    <DialogFooter className="justify-start px-3 pt-2">
      <Button variant="subtle" size="sm" onClick={enregistrer} disabled={enCours || !jugement.ok} data-backups-enregistrer>
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
  );

  return (
    <>
      {/* UN VRAI TIROIR PAR-DESSUS LA PAGE (15/11/2026) : la feuille commune sur ordinateur, la liste des sites reste
          dessous ; la feuille du bas pleine hauteur sur téléphone (DEC-474). */}
      <Drawer open={fiche !== null} onClose={onClose} feuille={!telephone} empile className={telephone ? undefined : 'h-[92dvh]'}>
        {fiche !== null && !telephone ? (
          <SuiteDuFil onRacine={onClose}>
            <CranDuFil data-backups-cran={site.id || 'nouveau'}>{site.id ? site.nom || t('Site') : t('Nouveau site')}</CranDuFil>
          </SuiteDuFil>
        ) : null}
        {/* LE NOM DU SITE EST LE DERNIER CRAN DU FIL D'ARIANE — « Services ›
            Backup › ProjetE » ; son interrupteur et son « i » montent à droite
            de la barre d'en-tête de la page. Plus de rangée de titre sous elle. */}
        <DialogTitle className="min-w-0 truncate px-3 pb-2">
          {site.id ? site.nom || t('Site') : t('Nouveau site')}
        </DialogTitle>
        <GestesDePage className="px-3">
          {/* LE BOUTON DE L'AGENT REVIENT ICI (demande du 12/10/2026) : il ne
              s'affichait que sur la liste, et seulement sur un échec ou un site
              sans recette. Sur la fiche, il est toujours là. */}
          {site.id && onRelire && !telephone ? (
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              disabled={relu}
              onClick={onRelire}
              title={site.recette ? t('Faire relire et réparer la recette de ce site par l’agent') : t('Faire écrire la recette de ce site par l’agent d’analyse')}
              data-backups-fiche-agent={site.id}
              data-agent-au-travail={relu ? '' : undefined}
            >
              {relu ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {relu ? t('L’agent travaille…') : t('Configurer avec l’agent')}
            </Button>
          ) : null}
          {site.id ? (
            telephone ? (
              /* SUR TÉLÉPHONE, RÉGLAGES N'EST QU'UNE ICÔNE (03/11/2026). */
              <Button variant="ghost" size="icon" className="h-[38px] w-[38px] shrink-0 text-muted" aria-label="Réglages" title={t('Réglages')} onClick={() => setReglagesOuverts(true)} data-backups-ouvrir-reglages>
                <Settings className="h-4 w-4" />
              </Button>
            ) : (
              <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setReglagesOuverts(true)} data-backups-ouvrir-reglages>
                <Settings className="h-3.5 w-3.5" />
                {t('Réglages')}
              </Button>
            )
          ) : null}
        </GestesDePage>

        {site.id && telephone && onRelire ? (
          /* SUR TÉLÉPHONE, « CONFIGURER AVEC L'AGENT » EST LE BOUTON PLEINE LARGEUR DU BAS DE LA FICHE (03/11/2026),
             teinté de violet : il lance le travail d'un agent. */
          <div className="order-last shrink-0 pb-[var(--pied-natif,calc(10px+env(safe-area-inset-bottom)))] pt-2" data-backups-pied-fiche>
            <button
              type="button"
              disabled={relu}
              onClick={onRelire}
              className={cn(CLASSE_BOUTON_PLEINE_LARGEUR, 'bg-teinte/15 text-teinte active:bg-teinte/25')}
              data-backups-fiche-agent={site.id}
              data-agent-au-travail={relu ? '' : undefined}
            >
              {relu ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {relu ? t('L’agent travaille…') : t('Configurer avec l’agent')}
            </button>
          </div>
        ) : null}
        {site.id ? (
          /* LA FICHE S'OUVRE SUR CE QUI EST RÉCUPÉRÉ (demande du 31/10/2026) : la recette puis l'historique. */
          <ZoneDefilement fond="hsl(var(--surface))" className="px-3 pb-3">
            <FormulaireEnColonnes>
            <div data-pleine-largeur>
              <RecetteDuSite site={site} />
            </div>

            {/* L'HISTORIQUE DE CE SITE : ce qui vivait dans un tiroir séparé
                se lit maintenant ici, au clic sur le site lui-même. */}
            {(
              <div className="flex min-w-0 flex-col gap-1.5 pt-2" data-backups-historique-site={site.id} data-pleine-largeur>
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
                  /* L'HISTORIQUE EN TABLEAU (14/11/2026, « toutes les données qui sont en liste doivent être dans des
                     tableaux ») : une ligne par sauvegarde, qui se déplie sur ce que l'archive contient. */
                  <TableauDesPoints points={points} restaurations={restaurations} onRestaurer={onRestaurer} />
                )}
              </div>
            )}
            </FormulaireEnColonnes>
          </ZoneDefilement>
        ) : (
          /* Un site neuf n'a rien à montrer : ses réglages sont la page. */
          <>
            <ZoneDefilement fond="hsl(var(--surface))" className="px-3 pb-3">
              {champsDuSite}
            </ZoneDefilement>
            {piedDesReglages}
          </>
        )}
      </Drawer>

      <Drawer
        adresse="reglages-backups"
        open={reglagesOuverts && !!site.id}
        onClose={() => {
          setReglagesOuverts(false);
          /* Fermer sans enregistrer abandonne les modifications. */
          if (fiche) setSite(fiche);
        }}
        empile
        feuille
      >
        <div className="flex min-h-0 flex-1 flex-col" data-backups-reglages>
          <EnteteDeFeuille titre={t('Réglages')} />
          <ZoneDefilement fond="hsl(var(--surface))" className="px-3 pb-3">
            {champsDuSite}
          </ZoneDefilement>
          {piedDesReglages}
        </div>
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

/**
 * CE QUE LE DÉTAIL D'UN POINT DIT EN PLUS DE SON INVENTAIRE. Le verdict d'une
 * archive (`verdictDeLArchive`) écrit dans le détail chaque étape manquée,
 * « libellé : raison » — exactement ce que l'inventaire affiche déjà, étape par
 * étape. Cette redite est retirée ; ce qui la précède (« filet avant la
 * restauration du … ») reste. Un détail qui dit AUTRE CHOSE (archive illisible,
 * manifeste manquant) est rendu tel quel.
 */
function detailHorsInventaire(point: PointDeSauvegarde): string {
  const detail = (point.detail ?? '').trim();
  const ratees = point.inventaire?.etapes.filter((etape) => !etape.ok) ?? [];
  if (!detail || !ratees.length) return detail;
  const dejaDit = ratees.map((etape) => `${etape.libelle} : ${etape.raison}`).join(' ; ');
  if (!detail.endsWith(dejaDit)) return detail;
  return detail.slice(0, detail.length - dejaDit.length).replace(/[\s—–-]+$/, '');
}

/** Le geste « Restaurer » d'un point, dans sa ligne du tableau. */
function BoutonRestaurer({ point, enRestauration, onRestaurer }: { point: PointDeSauvegarde; enRestauration: boolean; onRestaurer: () => void }) {
  const restaurable = point.statut !== 'echec' && !!(point.cheminArchive || point.chemin);
  if (!restaurable) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={enRestauration}
      onClick={(e) => {
        e.stopPropagation();
        onRestaurer();
      }}
      data-backups-restaurer={point.id}
    >
      {enRestauration ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
      {t(enRestauration ? 'Restauration…' : 'Restaurer')}
    </Button>
  );
}

/** L'historique d'un site, en tableau : la date, le volume, l'origine, l'issue et « Restaurer » ; le détail se déplie. */
function TableauDesPoints({
  points,
  restaurations,
  onRestaurer,
}: {
  points: readonly PointDeSauvegarde[];
  restaurations: readonly string[];
  onRestaurer: (point: PointDeSauvegarde) => void;
}) {
  const colonnes: ColonneDuTableauCommun<PointDeSauvegarde>[] = [
    { cle: 'date', libelle: t('Date'), valeur: (p) => p.debut, rendu: (p) => <span className="text-text">{dateLisible(p.debut)}</span>, sensNaturel: 'desc' },
    { cle: 'volume', libelle: t('Volume'), largeur: 110, droite: true, masqueSurTelephone: true, valeur: (p) => volumeDuPoint(p), rendu: (p) => formaterOctets(volumeDuPoint(p)) },
    { cle: 'origine', libelle: t('Origine'), largeur: 130, masqueSurTelephone: true, filtre: 'choix', valeur: (p) => t(p.origine === 'manuel' ? 'À la main' : 'Automatique') },
    {
      cle: 'etat',
      libelle: t('État'),
      largeur: 190,
      masqueSurTelephone: true,
      filtre: 'choix',
      lireFiltre: (p) => p.statut,
      valeur: (p) => p.statut,
      rendu: (p) => (
        <Badge tone={p.statut === 'reussi' ? 'success' : p.statut === 'partiel' ? 'warning' : 'danger'}>{t(phraseDeStatut(p))}</Badge>
      ),
    },
    {
      cle: 'restaurer',
      libelle: '',
      largeur: 140,
      droite: true,
      libre: true,
      rendu: (p) => <BoutonRestaurer point={p} enRestauration={restaurations.includes(p.id)} onRestaurer={() => onRestaurer(p)} />,
    },
  ];
  return (
    <Tableau
      repere="historique-backups"
      recherche={false}
      lignes={points}
      colonnes={colonnes}
      cle={(p) => p.id}
      triInitial={{ colonne: 'date', sens: 'desc' }}
      detail={(p) => <DetailDuPoint point={p} />}
      attributsLigne={(p) => ({ 'data-backups-point': p.id })}
    />
  );
}

/** Ce que l'archive d'un point contient, et ce qui a cloché : le détail déplié d'une ligne de l'historique. */
function DetailDuPoint({ point }: { point: PointDeSauvegarde }) {
  const detail = point.statut !== 'reussi' ? detailHorsInventaire(point) : '';
  return (
    <div className="flex min-w-0 flex-col gap-1 py-1" data-backups-detail-point={point.id}>

      {/* CE QUE L'ARCHIVE CONTIENT, relu dans le zip : c'est cet inventaire qui
          a décidé du statut. Un point d'avant les archives le dit.

          UNE ÉTAPE, UNE LIGNE : son icône d'état, son libellé, et à droite ce
          qu'elle a posé — court, il tient sur la ligne. Une étape MANQUÉE n'a
          rien posé : sa raison (la sortie brute d'une commande, souvent un
          long chemin sans espace) s'écrit SOUS le libellé, sur toute la
          largeur, et se coupe où il faut. Elle ne loge plus dans la colonne
          étroite des volumes, d'où elle débordait de la carte. */}
      {point.inventaire ? (
        <ul className="flex min-w-0 flex-col gap-1" data-backups-inventaire={point.id}>
          {point.inventaire.etapes.map((etape) => (
            <li
              key={etape.id}
              className={cn(
                'grid min-w-0 grid-cols-[0.75rem_minmax(0,1fr)_auto] items-start gap-x-1.5 gap-y-0.5 text-[11.5px] leading-relaxed',
                etape.ok ? 'text-faint' : 'text-text',
              )}
              data-backups-inventaire-etape={etape.ok ? 'prise' : 'manquee'}
            >
              {etape.ok ? (
                <Check className="mt-[3px] h-3 w-3 shrink-0" />
              ) : (
                <TriangleAlert className="mt-[3px] h-3 w-3 shrink-0" />
              )}
              <span className={cn('min-w-0 break-words', !etape.ok && 'col-span-2')}>{etape.libelle}</span>
              {etape.ok ? (
                <span className="whitespace-nowrap text-right tabular-nums">
                  {t('{n} fichier(s) — {volume}', { n: etape.fichiers, volume: formaterOctets(etape.octets) })}
                </span>
              ) : (
                <span className="col-span-2 col-start-2 min-w-0 break-words text-muted" data-backups-inventaire-raison>
                  {etape.raison}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : point.statut !== 'echec' ? (
        <span className="text-[11.5px] text-faint" data-backups-ancien-format={point.id}>
          {t('Ancien format : un dossier, sans archive zip')}
        </span>
      ) : null}
      {/* Le détail ne redit pas l'inventaire (`detailHorsInventaire`). */}
      {detail ? (
        <span
          className={cn('min-w-0 break-words text-[11.5px] leading-relaxed', point.statut === 'echec' ? 'text-danger' : 'text-muted')}
          data-backups-point-detail
        >
          {detail}
        </span>
      ) : null}
    </div>
  );
}
