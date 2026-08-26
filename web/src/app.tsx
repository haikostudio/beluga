import * as React from 'react';
import { LayoutGrid, Columns3, MessageSquare, Loader2 } from 'lucide-react';
import { TooltipProvider, Button, EmptyState, SidePanel } from '@/components/ui';
import { QuotaBar } from '@/components/quota-bar';
import { Sidebar } from '@/components/sidebar';
import { Board } from '@/components/board';
import { SilhouetteTableau } from '@/components/silhouettes';
import { Toasts } from '@/components/toasts';
import { PanneauALaDemande, prechargerAuRepos } from '@/lib/panneau-a-la-demande';
import { useResizable, ResizeHandle } from '@/components/resizer';
import { client } from '@/lib/client';
import { usePref, writePref } from '@/lib/prefs';
import { useThemeApplique } from '@/lib/theme';
import { useModeSimplifieApplique } from '@/lib/mode-simplifie';
import { useApp } from '@/lib/use-app';
import { Filet } from '@/components/filet';
import { cn } from '@/lib/utils';
import {
  CLE_ONGLET_MOBILE,
  carteAReprendre,
  cleCarteOuverte,
  construireFragment,
  decisionsHorsCarte,
  avatarDeLAlerte,
  imageDeLAlerte,
  lireFragment,
  memeEcran,
  ongletAReprendre,
  type EcranNavigateur,
} from '@haikodev/shared';
import { RepereAttention } from '@/components/repere-attention';
import { t, useLangueAppliquee } from '@/lib/langue';

/*
 * LES ÉCRANS QU'ON OUVRE PAR UN BOUTON SONT DES MORCEAUX À PART
 * (`web/src/lib/panneau-a-la-demande.tsx`). Aucun d'eux ne sert au premier
 * affichage — colonne de gauche et tableau —, et tous ensemble ils pesaient
 * plus du tiers du fichier téléchargé au démarrage.
 */
const chargerTableauDeBord = () => import('@/components/dashboard');
const chargerTiroirCarte = () => import('@/components/card-panel');
const chargerReglages = () => import('@/components/settings-view');
const chargerVoix = () => import('@/components/voix-assistant');
/*
 * La CONVERSATION est le seul cas limite : sur un grand écran elle s'ouvre
 * d'entrée, sur téléphone elle attend son onglet. Elle emporte avec elle la
 * barre d'écriture et l'affichage des messages — le plus gros morceau après le
 * tableau — et le premier écran d'un téléphone est le TABLEAU. Elle part donc
 * elle aussi à part, et se précharge au repos.
 */
const chargerConversation = () => import('@/components/right-panel');
const chargerFilDeDiscussion = () => import('@/components/chat');

const RightPanel = React.lazy(() => chargerConversation().then((m) => ({ default: m.RightPanel })));
const Chat = React.lazy(() => chargerFilDeDiscussion().then((m) => ({ default: m.Chat })));

const Dashboard = React.lazy(() => chargerTableauDeBord().then((m) => ({ default: m.Dashboard })));
const CardPanel = React.lazy(() => chargerTiroirCarte().then((m) => ({ default: m.CardPanel })));
const SettingsView = React.lazy(() => chargerReglages().then((m) => ({ default: m.SettingsView })));
const VoixAssistant = React.lazy(() => chargerVoix().then((m) => ({ default: m.VoixAssistant })));

/** Les destinations de la barre du bas, sur téléphone. */
const ONGLETS_MOBILES = ['board', 'chat'] as const;
type OngletMobile = (typeof ONGLETS_MOBILES)[number];


/** La clé du serveur arrive en base64 « url » : le navigateur la veut en octets. */
function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buffer;
}

export function App() {
  const state = useApp();
  /*
   * LE THÈME S'APPLIQUE DEPUIS LA RACINE, jamais depuis un panneau. Il était posé
   * par un effet du bandeau des quotas : sur téléphone, ce bandeau n'est pas
   * toujours monté, et les réglages qui portent maintenant le choix arrivent en
   * morceau séparé, à la demande. La racine, elle, est toujours là.
   *
   * C'est aussi le seul endroit qui voit les TROIS sources à la fois — le thème
   * du projet ouvert, le réglage général, celui de l'ordinateur —, donc le seul
   * qui puisse changer l'apparence de l'application ENTIÈRE quand on change de
   * projet.
   */
  useThemeApplique();
  /*
   * LA LANGUE SE POSE ICI AUSSI, ET POUR LA MÊME RAISON. `t` lit une variable de
   * module, tenue à jour par ce crochet PENDANT le rendu de la racine : tout ce
   * qui s'affiche en dessous — colonne de gauche, tableau, conversation,
   * fenêtres, panneaux chargés à la demande — voit donc la bonne langue au
   * PREMIER rendu, sans qu'aucun écran n'ait à s'abonner à quoi que ce soit.
   * Changer de langue rend la racine, donc rend tout l'arbre : aucun mot ne
   * reste en arrière.
   */
  useLangueAppliquee();
  /*
   * LE MODE SIMPLIFIÉ SE POSE ICI, POUR LA MÊME RAISON QUE LES DEUX AUTRES :
   * c'est un réglage de l'application ENTIÈRE. Le crochet écrit le repère
   * `data-mode-simplifie` sur la racine du document — ce qui masque vraiment
   * les chiffres, ce sont les écrans eux-mêmes, chacun lisant la préférence
   * pendant son rendu.
   */
  useModeSimplifieApplique();
  const [openCardId, setOpenCardId] = React.useState<string | null>(null);
  const [openAgentId, setOpenAgentId] = React.useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  // La page « Tableau de bord » s'ouvre par-dessus le tableau, dans le
  // conteneur central : le Kanban et le volet de droite sont alors masqués, la
  // colonne de gauche reste en place.
  const [dashboardOpen, setDashboardOpen] = React.useState(false);
  const [rightOpen, setRightOpen] = React.useState(() => window.innerWidth >= 1100);
  /*
   * L'onglet du bas est retenu en base : on rouvre l'application là où on
   * l'avait laissée, et le même onglet suit d'un appareil à l'autre. Un onglet
   * retiré depuis (la liste des projets, devenue un panneau) est ignoré.
   */
  const [ongletMemorise, setMobileView] = usePref<OngletMobile>(CLE_ONGLET_MOBILE, 'board');
  const mobileView = ongletAReprendre(ongletMemorise, ONGLETS_MOBILES, 'board');
  // Sur téléphone, la liste des projets glisse par-dessus l'écran en cours.
  const [projetsOuverts, setProjetsOuverts] = React.useState(false);
  const [dropTarget, setDropTarget] = React.useState(false);

  // Largeurs des deux panneaux, retenues d'une session à l'autre.
  const gauche = useResizable('sidebar', { initial: 196, min: 150, max: 420 });
  const droite = useResizable('panel', { initial: 360, min: 280, max: 720 });

  React.useEffect(() => {
    client.connect();
  }, []);

  /*
   * Les morceaux des panneaux sont réclamés UNE FOIS L'APPLICATION AU REPOS :
   * le premier affichage ne les attend pas, et le premier clic ne les attend
   * pas non plus. Le tiroir d'une carte passe en tête — c'est le plus ouvert.
   */
  React.useEffect(() => {
    const annuler = [
      chargerConversation,
      chargerTiroirCarte,
      chargerVoix,
      chargerReglages,
      chargerTableauDeBord,
    ].map(
      prechargerAuRepos,
    );
    return () => annuler.forEach((stop) => stop());
  }, []);

  /*
   * LA BANDE VIDE EN BAS (recette éprouvée sur Aikomail et Eloya).
   *
   * Deux mesures, et deux seulement :
   * — la hauteur d'écran, prise sur l'écran physique quand l'application est
   *   installée sur le téléphone : les autres mesures sous-estiment l'écran au
   *   démarrage à froid, et le manque se reporte en bande vide en bas ;
   * — le clavier, réservé UNIQUEMENT s'il est vraiment ouvert (un champ a le
   *   curseur et l'écart dépasse cent points). Sans cette condition, la barre
   *   d'adresse du navigateur passait pour un clavier et creusait une marge
   *   permanente en bas.
   */
  React.useEffect(() => {
    const vue = window.visualViewport;
    const racine = document.documentElement;

    const appliquer = () => {
      const installee =
        (window.navigator as any).standalone === true ||
        window.matchMedia('(display-mode: standalone)').matches;
      const hauteurEcran = installee ? window.screen?.height || 0 : 0;
      if (hauteurEcran) racine.style.setProperty('--hauteur-app', `${hauteurEcran}px`);
      else racine.style.removeProperty('--hauteur-app');

      const actif = document.activeElement;
      const saisieActive =
        !!actif &&
        (actif.tagName === 'INPUT' || actif.tagName === 'TEXTAREA' || (actif as HTMLElement).isContentEditable);
      const ecart = vue ? window.innerHeight - vue.height - vue.offsetTop : 0;
      const clavierOuvert = saisieActive && ecart > 100;
      racine.style.setProperty('--clavier', `${clavierOuvert ? Math.round(ecart) : 0}px`);
    };

    appliquer();
    const retarde = () => {
      window.setTimeout(appliquer, 60);
      window.setTimeout(appliquer, 350);
    };
    vue?.addEventListener('resize', appliquer);
    vue?.addEventListener('scroll', appliquer);
    window.addEventListener('resize', appliquer);
    window.addEventListener('focusin', appliquer);
    window.addEventListener('focusout', retarde);
    window.addEventListener('orientationchange', retarde);
    return () => {
      vue?.removeEventListener('resize', appliquer);
      vue?.removeEventListener('scroll', appliquer);
      window.removeEventListener('resize', appliquer);
      window.removeEventListener('focusin', appliquer);
      window.removeEventListener('focusout', retarde);
      window.removeEventListener('orientationchange', retarde);
    };
  }, []);

  /*
   * Une carte affichée dans la conversation s'ouvre dans le tiroir. Elle
   * ferme au passage le petit panneau d'un AUTRE agent resté ouvert : sinon,
   * en refermant la carte, ce panneau périmé réapparaissait par surprise.
   */
  React.useEffect(
    () =>
      client.onOpenCard((cardId) => {
        setOpenAgentId(null);
        setOpenCardId(cardId);
      }),
    [],
  );

  /*
   * « Emmène-moi à la décision. » Le triangle de la colonne de gauche mène
   * jusqu'ici quand la décision ne tient à aucune carte : on ouvre le projet,
   * on déplie la conversation (elle est cachée derrière un bouton sur
   * téléphone, et repliable sur ordinateur), et si la décision vit dans le fil
   * d'un autre agent que le chef, c'est ce fil-là qui s'ouvre. Le tiroir d'une
   * carte resté ouvert (un autre projet, par exemple) est un plein écran qui
   * cacherait cette conversation par-dessus : on le referme au passage. Le
   * tableau de bord, lui, prend la place du panneau de droite sur ordinateur
   * (il ne s'affiche pas pendant que le tableau de bord est ouvert) : on
   * quitte aussi le tableau de bord, sinon la conversation restait invisible.
   */
  React.useEffect(
    () =>
      client.onOpenConversation(({ projectId, agentId }) => {
        setOpenCardId(null);
        setDashboardOpen(false);
        client.setActiveProject(projectId);
        setRightOpen(true);
        // L'onglet du bas n'existe que sur téléphone, et il est RETENU : un
        // clic fait sur ordinateur n'a pas à changer ce qu'on retrouvera sur
        // son téléphone. Là, le panneau qu'on vient d'ouvrir suffit.
        if (window.innerWidth < 640) setMobileView('chat');
        const agent = client.getSnapshot().agents[agentId];
        if (agent && agent.role !== 'orchestrator') setOpenAgentId(agentId);
      }),
    [],
  );

  /*
   * Sur téléphone, changer de projet ramène au tableau. Le panneau, lui, se
   * referme sur le GESTE (voir onChoose) et non sur ce changement d'état : le
   * projet retenu de la veille arrive quelques instants après l'ouverture, et
   * il refermait le panneau sous le doigt.
   */
  const projetPrecedent = React.useRef<string | null>(null);
  React.useEffect(() => {
    const avant = projetPrecedent.current;
    projetPrecedent.current = state.activeProjectId;
    // L'arrivée du projet retenu à l'ouverture n'est pas un changement de
    // projet : elle ne doit pas écraser l'onglet mémorisé.
    if (!avant || avant === state.activeProjectId) return;
    setMobileView('board');
  }, [state.activeProjectId]);

  /*
   * La carte ouverte est retenue, projet par projet : on retrouve le tiroir
   * exactement comme on l'a laissé. La reprise n'a lieu qu'UNE fois par projet
   * — refermer le tiroir est un geste, il ne doit pas se rouvrir tout seul —
   * et une carte supprimée entre-temps laisse simplement le tiroir fermé.
   */
  const carteReprise = React.useRef(new Set<string>());
  React.useEffect(() => {
    const projectId = state.activeProjectId;
    if (!projectId || openCardId || carteReprise.current.has(projectId)) return;
    const memorisee = carteAReprendre(
      state.prefs[cleCarteOuverte(projectId)],
      Object.values(state.cards),
      projectId,
    );
    // Tant que les cartes du projet ne sont pas arrivées, on laisse sa chance
    // au tour suivant plutôt que d'abandonner la reprise.
    if (!memorisee) return;
    carteReprise.current.add(projectId);
    setOpenCardId(memorisee);
  }, [state.activeProjectId, state.cards, state.prefs, openCardId]);

  // Ouvrir ou fermer le tiroir met à jour le souvenir, tout de suite.
  React.useEffect(() => {
    const projectId = (openCardId ? state.cards[openCardId]?.projectId : null) ?? state.activeProjectId;
    if (!projectId) return;
    carteReprise.current.add(projectId);
    const cle = cleCarteOuverte(projectId);
    if ((state.prefs[cle] ?? '') === (openCardId ?? '')) return;
    writePref(cle, openCardId ?? '');
  }, [openCardId]);

  /*
   * L'ADRESSE DU NAVIGATEUR SUIT L'ÉCRAN. Un fragment après le « # » décrit où
   * l'on est (« #projet/<id> », « #projet/<id>/tache/<id>-<slug> »,
   * « #reglages », « #tableau-de-bord ») : recharger, coller l'adresse dans un
   * onglet neuf ou faire Précédent/Suivant retrouve le même écran. La
   * persistance serveur (projet actif, carte ouverte) n'est pas touchée : le
   * fragment s'ajoute par-dessus. L'identifiant reste la clé ; le slug du titre
   * n'est là que pour l'œil, et se jette à la lecture.
   */
  const appliquerEcran = React.useCallback((ecran: EcranNavigateur) => {
    // « #reglages » est une couche par-dessus l'écran en cours : on l'ouvre
    // sans rien changer sous elle.
    if (ecran.vue === 'reglages') {
      setSettingsOpen(true);
      return;
    }
    setSettingsOpen(false);
    if (ecran.vue === 'tableau-de-bord') {
      setDashboardOpen(true);
      return;
    }
    setDashboardOpen(false);
    if (ecran.vue === 'projet') {
      // Ne re-déclencher l'ouverture serveur que si le projet change vraiment.
      if (client.getSnapshot().activeProjectId !== ecran.projectId) {
        client.setActiveProject(ecran.projectId);
      }
      setOpenCardId(ecran.cardId ?? null);
      return;
    }
    setOpenCardId(null);
  }, []);

  // Au chargement, et à chaque Précédent/Suivant, l'adresse commande l'écran.
  const adresseLue = React.useRef(false);
  React.useEffect(() => {
    const suivreAdresse = () => appliquerEcran(lireFragment(window.location.hash));
    suivreAdresse();
    adresseLue.current = true;
    window.addEventListener('popstate', suivreAdresse);
    return () => window.removeEventListener('popstate', suivreAdresse);
  }, [appliquerEcran]);

  // En sens inverse, chaque changement d'écran réécrit l'adresse. Un même écran
  // ne rajoute rien à l'historique (replaceState, juste pour rafraîchir le
  // slug) ; un écran différent y pousse une entrée, pour que Précédent revienne.
  const titreCarteOuverte = openCardId ? state.cards[openCardId]?.title ?? null : null;
  const premiereEcriture = React.useRef(true);
  React.useEffect(() => {
    if (!adresseLue.current) return;
    // Le tout premier rendu vient de LIRE l'adresse : ne pas la réécrire à
    // partir d'un état pas encore rafraîchi, sous peine d'effacer le fragment
    // collé avant qu'il ne soit appliqué.
    if (premiereEcriture.current) {
      premiereEcriture.current = false;
      return;
    }
    const ecran: EcranNavigateur = settingsOpen
      ? { vue: 'reglages' }
      : dashboardOpen
        ? { vue: 'tableau-de-bord' }
        : state.activeProjectId
          ? {
              vue: 'projet',
              projectId: state.activeProjectId,
              cardId: openCardId ?? undefined,
              titreCarte: titreCarteOuverte ?? undefined,
            }
          : { vue: 'accueil' };

    const cible = construireFragment(ecran);
    const url = cible ? '#' + cible : window.location.pathname + window.location.search;
    if (memeEcran(lireFragment(window.location.hash), ecran)) {
      if (window.location.hash.replace(/^#/, '') !== cible) {
        window.history.replaceState(window.history.state, '', url);
      }
      return;
    }
    window.history.pushState(window.history.state, '', url);
  }, [state.activeProjectId, openCardId, dashboardOpen, settingsOpen, titreCarteOuverte]);

  // Passé sur grand écran (rotation, écran externe), la colonne de gauche est
  // de nouveau posée là : le panneau qui la recouvre n'a plus lieu d'être.
  React.useEffect(() => {
    const large = window.matchMedia('(min-width: 640px)');
    const suivre = () => large.matches && setProjetsOuverts(false);
    suivre();
    large.addEventListener('change', suivre);
    return () => large.removeEventListener('change', suivre);
  }, []);

  /*
   * Notifications système, cliquables : elles ouvrent la carte concernée.
   *
   * Le démon prévient DEUX fois : par la connexion de l'onglet ouvert, et par
   * la voie poussée qui atteint l'appareil même application fermée. Quand cet
   * appareil est abonné à la voie poussée, l'alerte y arrivera de toute façon :
   * la page se tait, sinon la même nouvelle s'affiche deux fois. Sans
   * abonnement (navigateur qui ne le sait pas faire, permission jamais
   * demandée), la page reste le seul chemin et continue d'annoncer.
   */
  React.useEffect(() => {
    let abonne = false;
    const suivreAbonnement = () => {
      if (!('serviceWorker' in navigator)) return;
      void navigator.serviceWorker.ready
        .then((registration) => registration.pushManager.getSubscription())
        .then((subscription) => {
          abonne = !!subscription;
        })
        .catch(() => {
          abonne = false;
        });
    };
    suivreAbonnement();
    // L'abonnement se pose quelques secondes après l'ouverture : on redemande.
    const rappel = window.setInterval(suivreAbonnement, 15_000);

    const arreter = client.onNotify((event) => {
      if (abonne) return;
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      // Même image que dans le service worker, tirée du même motif : une alerte
      // ne change pas de visage selon que l'onglet est ouvert ou fermé. Quand
      // l'alerte parle d'une COLONNE, c'est le portrait rond de son personnage
      // — celui-là même qui est en tête de la colonne où il faudra aller ;
      // sinon (quota, redémarrage) l'image du genre, faute de colonne.
      const notification = new Notification(event.title, {
        body: event.body,
        tag: event.tag,
        icon: avatarDeLAlerte(event.motif) ?? imageDeLAlerte(event.motif),
      });
      notification.onclick = () => {
        window.focus();
        client.allerVersDecision({ projectId: event.projectId, cardId: event.cardId, agentId: event.agentId });
      };
    });
    return () => {
      window.clearInterval(rappel);
      arreter();
    };
  }, []);

  // Abonnement aux notifications poussées : l'application prévient même fermée.
  React.useEffect(() => {
    const setup = async () => {
      if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
      if (Notification.permission === 'default') {
        await new Promise((resolve) => setTimeout(resolve, 8000));
        await Notification.requestPermission().catch(() => undefined);
      }
      if (Notification.permission !== 'granted') return;
      try {
        const me = await fetch('/api/me').then((r) => r.json());
        if (!me?.pushKey) return;
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        const subscription =
          existing ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(me.pushKey),
          }));
        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(subscription),
        });
      } catch {
        /* le navigateur refuse les notifications poussées : on s'en passe */
      }
    };
    void setup();

    // Un appui sur une notification poussée emmène à la décision concernée
    // (carte, ou conversation quand elle n'en a aucune — question du chef
    // d'orchestre).
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OPEN_CARD') {
        client.allerVersDecision({
          projectId: event.data.projectId,
          cardId: event.data.cardId,
          agentId: event.data.agentId,
        });
      }
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
  }, []);

  /*
   * LE COMPTE SUR L'ICÔNE DE L'APPLICATION INSTALLÉE. On voit ainsi, sans même
   * ouvrir HaikoDev, qu'un agent a rendu quelque chose. On additionne les
   * réponses non lues de tous les projets ; à zéro, la pastille est retirée
   * plutôt que laissée à « 0 ». Les navigateurs qui ne connaissent pas cette
   * pastille ne font simplement rien.
   */
  const nonLues = Object.values(state.rendus).reduce((total, n) => total + n, 0);
  React.useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (!nav.setAppBadge) return;
    const geste = nonLues > 0 ? nav.setAppBadge(nonLues) : nav.clearAppBadge?.();
    void geste?.catch(() => undefined);
  }, [nonLues]);

  const activeProject = state.projects.find((project) => project.id === state.activeProjectId);
  const openAgent = openAgentId ? state.agents[openAgentId] : null;

  // Ouvrir le tableau de bord : sur téléphone il vit dans le conteneur central,
  // donc on revient d'abord sur l'onglet « Tableau » pour qu'il soit visible.
  const ouvrirTableauDeBord = () => {
    setDashboardOpen(true);
    setMobileView('board');
  };

  if (!state.connected && !state.projects.length) {
    return (
      <div className="grid h-full place-items-center bg-bg">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-faint" />
          <p className="text-[14px] text-faint">
            {state.connecting ? t('Connexion au serveur…') : t('Serveur injoignable — nouvelle tentative…')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div
        /*
         * L'application prend TOUTE la hauteur de la page, en flux normal.
         * Surtout pas « ancrée aux quatre bords » : sur téléphone, une page
         * dont plus rien n'est dans le flux voit sa hauteur s'effondrer, et
         * le système réserve alors une bande vide en bas (le même piège avait
         * été rencontré sur Aikomail et Eloya). Le creux du bas ne sert qu'au
         * clavier, et seulement quand il est réellement ouvert.
         */
        className="flex h-full flex-col overflow-hidden bg-bg"
        style={{ paddingBottom: 'var(--clavier, 0px)' }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            setDropTarget(true);
          }
        }}
        onDragLeave={() => setDropTarget(false)}
        onDrop={(event) => {
          if (event.dataTransfer.files.length) {
            event.preventDefault();
            setDropTarget(false);
            // Sans conversation ouverte, le dépôt est refusé avec un message clair.
            if (!openAgent && !openCardId && !rightOpen) {
              client.pushToast('warning', t('Ouvrez d\'abord une conversation pour y déposer un fichier.'));
            } else {
              client.pushToast('info', t('Déposez le fichier directement dans la barre d\'écriture de la conversation.'));
            }
          }
        }}
      >
        <QuotaBar
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenProjects={() => setProjetsOuverts(true)}
          onOpenDashboard={ouvrirTableauDeBord}
          rightOpen={rightOpen}
          onToggleRight={() => setRightOpen((value) => !value)}
        />

        <div className="flex min-h-0 flex-1">
          {/* Sur grand écran la liste des projets est une colonne posée là ; sur
              téléphone elle vit dans le panneau latéral, plus bas. */}
          <div className="hidden sm:flex">
            <Filet zone="Liste des projets">
              <Sidebar
                onOpenAgent={setOpenAgentId}
                width={gauche.width}
                onOpenDashboard={ouvrirTableauDeBord}
                dashboardActive={dashboardOpen}
                onCloseDashboard={() => setDashboardOpen(false)}
              />
            </Filet>
          </div>
          <ResizeHandle
            className="hidden sm:block"
            onPointerDown={(event) => gauche.start(event, 'left')}
            onDoubleClick={gauche.reset}
          />

          {/* `data-zone="centre"` : repère pour l'étagement des fonds du thème
              sombre (`styles.css`) — inerte dans les six autres thèmes. */}
          <main
            data-zone="centre"
            className={cn('flex min-h-0 min-w-0 flex-1 flex-col', mobileView !== 'board' && 'hidden sm:flex')}
          >
            {dashboardOpen ? (
              <Filet zone="Tableau de bord">
                <PanneauALaDemande monte>
                  <Dashboard onClose={() => setDashboardOpen(false)} />
                </PanneauALaDemande>
              </Filet>
            ) : activeProject ? (
              <Filet zone="Tableau">
                <Board projectId={activeProject.id} onOpenCard={setOpenCardId} />
              </Filet>
            ) : !state.pret ? (
              /* LE PREMIER ÉTAT DU SERVEUR N'EST PAS ENCORE ARRIVÉ : aucun projet
                 n'est choisi parce qu'on ne connaît pas encore la liste. On
                 dessine donc le tableau à venir en silhouette, au lieu d'annoncer
                 un vide qui n'en est pas un. */
              <SilhouetteTableau />
            ) : (
              <EmptyState
                icon={<LayoutGrid className="h-5 w-5" />}
                title={t('Aucun projet sélectionné')}
                hint={t('Ajoutez un projet depuis la colonne de gauche pour commencer.')}
              />
            )}
          </main>

          {activeProject && rightOpen && !dashboardOpen ? (
            <>
              <ResizeHandle
                className="hidden lg:block"
                onPointerDown={(event) => droite.start(event, 'right')}
                onDoubleClick={droite.reset}
              />
              {/* `data-zone="droite"` : repère pour l'étagement des fonds du
                  thème sombre (`styles.css`) — inerte dans les six autres
                  thèmes. */}
              <aside
                data-zone="droite"
                className="hidden shrink-0 border-l border-border lg:flex lg:flex-col"
                style={{ width: `${droite.width}px` }}
              >
                <Filet zone="Chef d'orchestre">
                  <PanneauALaDemande monte>
                    <RightPanel projectId={activeProject.id} />
                  </PanneauALaDemande>
                </Filet>
              </aside>
            </>
          ) : null}

          {/* Sur téléphone, la conversation prend toute la place */}
          {activeProject && mobileView === 'chat' ? (
            <aside data-zone="droite" className="flex min-w-0 flex-1 flex-col sm:hidden">
              <Filet zone="Chef d'orchestre">
                <PanneauALaDemande monte>
                  <RightPanel projectId={activeProject.id} />
                </PanneauALaDemande>
              </Filet>
            </aside>
          ) : null}
        </div>

        {/* La liste des projets, en panneau qui glisse depuis la gauche : un
            choix qu'on fait au passage, pas une destination. */}
        <SidePanel open={projetsOuverts} onClose={() => setProjetsOuverts(false)} title={t('Projets')}>
          <Filet zone="Liste des projets">
            <Sidebar
              onOpenAgent={setOpenAgentId}
              onChoose={() => setProjetsOuverts(false)}
              onOpenDashboard={ouvrirTableauDeBord}
              dashboardActive={dashboardOpen}
              onCloseDashboard={() => setDashboardOpen(false)}
            />
          </Filet>
        </SidePanel>

        {/* Menu de navigation mobile : un bloc FLOTTANT, arrondi, détaché des
            trois bords — aucun filet sur toute la largeur, qui coupait l'écran
            en deux. Le conteneur reste dans le flux (shrink-0) : il réserve
            donc exactement la place du menu, et le contenu ne passe jamais
            derrière. DEUX destinations — Tableau, Chef —, la colonne du milieu
            étant laissée au module de voix qui vient s'y poser (voir plus bas,
            <VoixAssistant />, ancré au centre sur téléphone). Le tableau de bord
            se rejoint alors par le menu trois points de la barre du haut. */}
        <nav
          data-menu-bas
          // LE MENU DU BAS EMPRUNTE LE FOND DE LA ZONE QU'IL PROLONGE : « centre »
          // sous le tableau, « droite » sous la conversation du chef. Sans ce
          // repère il retombait sur `--bg`, une bande NOIRE en thème sombre
          // collée sous un tableau gris — deux fonds pour une seule page.
          data-zone={mobileView === 'chat' && !dashboardOpen ? 'droite' : 'centre'}
          className="shrink-0 px-3 pb-2 pt-1 sm:hidden"
          // Juste la zone sûre du téléphone en dessous, pas un doigt de plus.
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.5rem)' }}
        >
          {/* La barre reprend le fond de la barre d'onglets du haut (Chef /
              Fichiers / Pièces jointes), qui pose `--surface` — pas le fond
              de la zone du dessous : elle se détache par son filet, sans
              ombre portée. */}
          <div
            className="grid grid-cols-[1fr_44px_1fr] items-center gap-1 rounded-2xl border border-border p-1"
            style={{ backgroundColor: 'hsl(var(--surface))' }}
          >
            {/* L'onglet ACTIF se dit à voix haute (`aria-current`) autant qu'il se
                colore : une couleur écrite en dur ne se vérifie pas, et un
                contrôle qui la cherchait a fini par juger une classe disparue. */}
            <Button
              variant="ghost"
              size="sm"
              aria-current={mobileView === 'board' && !dashboardOpen ? 'page' : undefined}
              className={cn(
                'w-full justify-center gap-1 rounded-xl px-1 text-xs',
                mobileView === 'board' && !dashboardOpen && 'bg-actif text-actif-fg hover:bg-actif hover:text-actif-fg',
              )}
              onClick={() => {
                setDashboardOpen(false);
                setMobileView('board');
              }}
            >
              <Columns3 className="h-3.5 w-3.5 shrink-0" />  {t('Tableau')}
</Button>
            {/* La colonne du milieu est laissée VIDE, juste assez large pour le
                rond du module de voix (fixe, par-dessus) qui vient s'y poser et
                déborde un peu en haut et en bas, comme un bouton d'action. Les
                deux autres colonnes se partagent tout le reste (`1fr`), pour que
                Tableau et Chef s'étendent chacun jusqu'au rond, sans vide. */}
            <div aria-hidden data-place-voix />
            <Button
              variant="ghost"
              size="sm"
              aria-current={mobileView === 'chat' && !dashboardOpen ? 'page' : undefined}
              className={cn(
                'w-full justify-center gap-1 rounded-xl px-1 text-xs',
                mobileView === 'chat' && !dashboardOpen && 'bg-actif text-actif-fg hover:bg-actif hover:text-actif-fg',
              )}
              onClick={() => {
                setDashboardOpen(false);
                setMobileView('chat');
              }}
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0" />  {t('Chef')}
{/* Sur téléphone, la conversation est derrière ce bouton : sans le
                  triangle ici, une décision en attente resterait invisible. */}
              <RepereAttention
                compte={
                  activeProject
                    ? decisionsHorsCarte(state.decisions, activeProject.id) +
                      (state.plans[activeProject.id] ? 1 : 0)
                    : 0
                }
                data-attention-conversation={activeProject?.id}
              />
            </Button>
          </div>
        </nav>

        {dropTarget ? (
          <div className="pointer-events-none fixed inset-0 z-50 border-2 border-dashed border-muted bg-voile/20" />
        ) : null}

        <Filet zone="Carte" onReprendre={() => setOpenCardId(null)}>
          {/* Fermé, le tiroir d'une carte ne rendait déjà rien : on ne monte
              donc rien, et son morceau n'est même pas demandé. */}
          <PanneauALaDemande monte={!!openCardId}>
            <CardPanel cardId={openCardId} onClose={() => setOpenCardId(null)} />
          </PanneauALaDemande>
        </Filet>
        <Filet zone="Réglages" onReprendre={() => setSettingsOpen(false)}>
          <PanneauALaDemande monte={settingsOpen}>
            <SettingsView open={settingsOpen} onClose={() => setSettingsOpen(false)} />
          </PanneauALaDemande>
        </Filet>
        <Toasts />
        {/* Le module de voix ouvre un micro et du son : ce qu'il fait de plus
            fragile ne doit pas emporter le tableau avec lui. Son filet ne
            REND RIEN quand il tombe — un bloc d'erreur flottant en bas de
            l'écran gênerait plus qu'il n'aiderait ; l'échec est déjà écrit
            dans la console et l'application, elle, continue. */}
        {/* La voix reste TOUJOURS montée — elle écoute et parle sans qu'on
            l'ouvre —, mais son morceau arrive APRÈS le premier affichage au
            lieu de le retarder. */}
        <Filet zone="Module de voix" muet>
          <PanneauALaDemande monte>
            <VoixAssistant />
          </PanneauALaDemande>
        </Filet>

        {openAgent ? (
          <div className="fixed inset-0 z-40 grid place-items-center bg-voile/60 p-3" onClick={() => setOpenAgentId(null)}>
            <div
              className="flex h-[80dvh] w-[min(720px,100%)] flex-col overflow-hidden rounded-lg border border-border bg-surface"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="flex items-center gap-2 border-b border-border px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium text-text">{openAgent.title}</span>
                <Button variant="ghost" size="sm" onClick={() => setOpenAgentId(null)}>
                  {t('Fermer')}</Button>
              </header>
              <div className="min-h-0 flex-1">
                <Filet zone="Conversation">
                  <PanneauALaDemande monte>
                    <Chat agent={openAgent} projectId={openAgent.projectId} />
                  </PanneauALaDemande>
                </Filet>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </TooltipProvider>
  );
}
