import { useTiroirAdresse } from '@/lib/tiroirs-adresse';
import * as React from 'react';
import {
  BarChart3,
  BookOpen,
  EllipsisVertical,
  FolderOpen,
  Loader2,
  MessageCircleQuestion,
  Paperclip,
  Play,
  Rocket,
  Settings2,
  Square,
  Volume2,
} from 'lucide-react';
import {
  Button,
  CLASSE_POINT_DE_BOUTON,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Pastille,
} from '@/components/ui';
import {
  CLASSE_LIBELLE_EN_BANDE,
  CLASSE_LIGNE_DE_SERVICE,
  CLASSE_LIGNE_EN_BANDE,
  ColonneDeService,
} from '@/components/colonne-de-service';
import { MemoryView } from '@/components/memory-view';
import { BoutonNouvelleTache } from '@/components/nouvelle-tache';
import { client } from '@/lib/client';
import { CLE_VOIX_VISIBLE } from '@/lib/cles-de-voix';
import { usePref } from '@/lib/prefs';
import { ouvrirConfigProjet } from '@/lib/ouvrir-config-projet';
import { useSignalDePublication, type SignalLu } from '@/lib/signal-publication';
import { useApp } from '@/lib/use-app';
import { useTelephone } from '@/lib/telephone';
import { cn } from '@/lib/utils';
import { t, formatRegional } from '@/lib/langue';

/**
 * LE RÉGLAGE « COLONNE REPLIÉE EN ICÔNES ». La clé a changé avec la refonte :
 * l'ancienne (`sidebar.reduite`) repliait une colonne qui n'existe plus sous
 * cette forme, et la reprendre aurait ouvert la nouvelle colonne — recherche,
 * onglets, groupes — déjà repliée. Elle se présente donc DÉPLIÉE, et se replie
 * depuis le menu général.
 */
export const CLE_COLONNE_REDUITE = 'colonne.reduite';

/**
 * OÙ EN EST LA LIAISON AVEC LE SERVEUR, ET QUI ATTEND AILLEURS.
 *
 * Un seul calcul, lu par le bouton des projets du téléphone et par le pied de
 * la colonne sur ordinateur : la liaison rompue passe devant, puis « un autre
 * projet attend une réponse », puis le calme. `enLigne` dit le premier seul —
 * c'est lui que montre le point du moteur, au pied de la colonne.
 */
export function useEtatDeLiaison(): {
  classe: string;
  texte: string;
  enLigne: boolean;
  ailleurs: boolean;
  agentsEnCours: number;
} {
  const state = useApp();
  // « starting » compte aussi : un tour resté coincé dans sa préparation est
  // justement celui qu'on veut pouvoir arrêter.
  const agentsEnCours = Object.values(state.agents).filter(
    (agent) => agent.status === 'running' || agent.status === 'starting',
  ).length;
  // Un autre projet que celui affiché attend une réponse.
  const ailleurs = Object.entries(state.attention).some(
    ([projectId, compte]) => compte > 0 && projectId !== state.activeProjectId,
  );
  if (!state.connected) {
    return { classe: 'animate-pulse-soft bg-warning', texte: 'Reconnexion…', enLigne: false, ailleurs, agentsEnCours };
  }
  if (ailleurs) {
    return { classe: 'bg-warning', texte: t('Un autre projet attend une réponse'), enLigne: true, ailleurs, agentsEnCours };
  }
  return {
    classe: 'bg-success',
    texte:
      agentsEnCours > 1
        ? t('Connecté au serveur · {v0} agents travaillent', { v0: agentsEnCours })
        : t('Connecté au serveur'),
    enLigne: true,
    ailleurs,
    agentsEnCours,
  };
}

/** Le moteur « en cours » : celui d'un agent qui travaille, sinon celui du projet ouvert. */
export function useMoteurActif() {
  const state = useApp();
  const projetOuvert = state.projects.find((p) => p.id === state.activeProjectId);
  return (
    Object.values(state.agents).find((agent) => agent.status === 'running')?.run.engine ??
    projetOuvert?.defaultEngine ??
    'claude'
  );
}

/**
 * LE BOUTON À TROIS POINTS DU PROJET, sur téléphone.
 *
 * IL PORTE CE QUE LES DEUX BARRES DU BAS DISAIENT SANS QU'ON LES OUVRE (demande
 * du 11/10/2026 : plus de bande de production ni de pied « Tout déployer ») :
 * la pastille des versions qui attendent la production, l'avancement d'une
 * publication en cours (la roue et son pourcentage), et un point rouge quand
 * elle est tombée. Une publication se suit donc toujours d'un coup d'œil, menu
 * fermé. L'état vient des composants de publication eux-mêmes
 * (`signal-publication.ts`) : rien n'est recalculé ici.
 */
export const BoutonOptionsDuProjet = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof Button>
>(({ className, ...props }, ref) => {
  const state = useApp();
  const deploiement = useSignalDePublication(state.activeProjectId, 'deploiement');
  const production = useSignalDePublication(state.activeProjectId, 'production');
  const gestes = [production, deploiement].filter((geste): geste is SignalLu => !!geste);
  const enRoute = gestes.find((geste) => geste.enRoute) ?? null;
  const tombe = gestes.find((geste) => geste.tombee) ?? null;
  /* Ce que le bouton chiffre : la publication en route d'abord, sinon celle
     qui vient de finir ou de tomber. */
  const suivi = enRoute ?? tombe ?? gestes.find((geste) => geste.pourcent !== null) ?? null;
  const enAttente = production && production.pourcent === null ? production.compte : 0;
  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      className={cn(
        'relative h-[38px] sm:h-8 shrink-0 text-muted',
        /* Un chiffre à dire — un avancement, des versions en attente — : le
           bouton s'élargit et l'écrit À CÔTÉ des trois points. Posée dans son
           coin, la pastille les recouvrait. */
        (suivi && suivi.pourcent !== null) || (!suivi && enAttente > 0) ? 'w-auto gap-1 px-1.5' : 'w-[38px] sm:w-8',
        className,
      )}
      aria-label="Options du projet"
      title={t('Options')}
      data-menu-general
      data-publication={enRoute ? 'en-route' : tombe ? 'tombee' : enAttente > 0 ? 'en-attente' : undefined}
      {...props}
    >
      {!suivi && enAttente > 0 ? (
        <Pastille nombre={enAttente} ton="repondre" title={production?.resume} data-mises-a-jour-en-attente={enAttente} />
      ) : null}
      {enRoute ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <EllipsisVertical className="h-4 w-4 shrink-0" />}
      {suivi && suivi.pourcent !== null ? (
        <span
          className={cn('shrink-0 text-[12px] font-semibold tabular-nums', suivi.tombee ? 'text-danger' : 'text-text')}
          data-pourcent-menu={suivi.pourcent}
        >
          {suivi.pourcent} %
        </span>
      ) : null}
      {tombe ? (
        <span className={cn(CLASSE_POINT_DE_BOUTON, 'bg-danger')} data-publication-tombee aria-hidden />
      ) : !suivi && enAttente <= 0 && production?.enRetard ? (
        <span className={cn(CLASSE_POINT_DE_BOUTON, 'bg-warning')} data-mises-a-jour-en-attente={0} data-en-retard="" aria-hidden />
      ) : null}
    </Button>
  );
});
BoutonOptionsDuProjet.displayName = 'BoutonOptionsDuProjet';

/** Ce qu'une ligne de publication dit à droite : l'avancement, sinon ce qui attend. */
function EtatDeLaLigneDePublication({ geste, pastille }: { geste: SignalLu; pastille?: boolean }) {
  /* L'agent de configuration au travail ou en attente : la ligne mène à lui, et le dit. */
  if (geste.pourcent === null && (geste.agent === 'travail' || geste.agent === 'question')) {
    return geste.agent === 'travail' ? (
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-en-cours" data-etat-ligne-agent="travail" aria-label={t('Agent au travail…')} />
    ) : (
      <MessageCircleQuestion className="h-3.5 w-3.5 shrink-0 text-warning" data-etat-ligne-agent="question" aria-label={t('Répondre à l’agent')} />
    );
  }
  if (geste.pourcent !== null) {
    return (
      <span className={cn('shrink-0 text-[12.5px] font-semibold tabular-nums', geste.tombee ? 'text-danger' : 'text-text')}>
        {geste.pourcent} %
      </span>
    );
  }
  if (geste.compte <= 0) return null;
  return pastille ? (
    <Pastille nombre={geste.compte} ton="repondre" title={geste.resume} />
  ) : (
    <span className="shrink-0 text-[12.5px] tabular-nums text-faint">{geste.compte}</span>
  );
}

/**
 * LES OPTIONS DE LA PAGE — celles du PROJET ouvert.
 *
 * ELLES NE PORTENT QUE CE QUI CONCERNE LA PAGE AFFICHÉE (demande du
 * 11/10/2026) : ses fichiers, ses pièces jointes, sa mémoire, son point du
 * jour, ses réglages, l'arrêt de SES agents. Le thème, la langue, le terminal,
 * le redémarrage et l'arrêt de tous les agents sont des réglages GÉNÉRAUX : ils
 * vivent dans la fenêtre des réglages, qu'on ouvre depuis n'importe quel écran.
 * L'appelant ne le monte donc que sur le tableau d'un projet.
 *
 * DEUX FORMES, UNE SEULE LISTE D'ENTRÉES :
 *  - `colonne` (ordinateur) : dans un projet, la colonne de gauche laisse la
 *    place à ses options (`ColonneDeService`) — plus de bouton à trois points
 *    sur le tableau ;
 *  - `menu` (téléphone, où la colonne vit dans un panneau fermé) : le bouton à
 *    trois points de la barre d'en-tête. Il y gagne, en tête, les deux gestes
 *    de publication — « Déployer » et « Mise en production » —, qui n'ont plus
 *    ni pied de colonne ni bande en bas de l'écran. Une ligne OUVRE la page du
 *    geste ; rien ne part d'un toucher dans un menu.
 *
 * UN SEUL À L'ÉCRAN. Il porte ses fenêtres (mémoire du projet, confirmation
 * d'arrêt) et leurs adresses : deux exemplaires montés ensemble se
 * disputeraient ces adresses.
 */
export function MenuGeneral({
  onOpenDashboard,
  onOuvrirFichiers,
  cote = 'end',
  declencheur,
  forme = 'menu',
}: {
  /** Sur téléphone seulement : le résumé se rejoint par ce menu. */
  onOpenDashboard?: () => void;
  /** Ouvre le tiroir des fichiers ou celui des pièces jointes du projet ouvert. */
  onOuvrirFichiers?: (vue: 'fichiers' | 'pieces') => void;
  cote?: 'start' | 'end';
  /** Le bouton qui ouvre le menu (forme `menu`). */
  declencheur?: React.ReactElement;
  forme?: 'menu' | 'colonne';
}) {
  const state = useApp();
  const telephone = useTelephone();
  const deploiement = useSignalDePublication(state.activeProjectId, 'deploiement');
  const production = useSignalDePublication(state.activeProjectId, 'production');
  const [speaking, setSpeaking] = React.useState(false);
  const [memoireOuverte, setMemoireOuverte] = React.useState(false);
  useTiroirAdresse('memoire-projet', memoireOuverte, setMemoireOuverte);
  const [arretGroupe, setArretGroupe] = React.useState(false);
  /* « ÉCOUTER LE POINT » N'EST PROPOSÉ QUE SI LE MODULE VOCAL FLOTTANT EST
     AFFICHÉ (réglage « Afficher le module vocal flottant », éteint d'origine) :
     sans lui, une entrée de plus qui ne mène à rien d'attendu. */
  const [voixVisible] = usePref<boolean>(CLE_VOIX_VISIBLE, false);

  /*
   * Les agents du projet affiché qui travaillent à cet instant : on n'arrête
   * jamais d'ici le travail d'un autre projet (l'arrêt de TOUS les agents est
   * dans les réglages).
   */
  // « starting » compte aussi : un tour resté coincé dans sa préparation est
  // justement celui qu'on veut pouvoir arrêter.
  const duProjet = Object.values(state.agents).filter(
    (agent) =>
      (agent.status === 'running' || agent.status === 'starting') && agent.projectId === state.activeProjectId && !agent.service,
  );

  const arreterLeProjet = () => {
    /*
     * `send` ne rapportait RIEN : un arrêt refusé ou sans effet passait en
     * silence, et le message « agents arrêtés » s'affichait quand même. On
     * ATTEND désormais chaque réponse, et on annonce ce qui s'est réellement
     * passé — un refus compris.
     */
    const gestes = duProjet.map((agent) =>
      client.call<{ stopped?: boolean }>({ type: 'agent.stop', agentId: agent.id }),
    );
    Promise.allSettled(gestes).then((issues) => {
      const refus = issues.filter((issue) => issue.status === 'rejected').length;
      const arretes = issues.length - refus;
      if (arretes) {
        client.pushToast('info', arretes > 1 ? t('{arretes} agents arrêtés.', { arretes }) : t('Agent arrêté.'));
      }
      if (refus) {
        client.pushToast('error', refus > 1 ? t('{refus} arrêts refusés.', { refus }) : t('Arrêt refusé.'));
      }
    });
  };

  const listen = async () => {
    setSpeaking(true);
    try {
      const audio = new Audio(`/api/digest?audio=1&project=${state.activeProjectId ?? ''}`);

      // Lecture pilotable écran verrouillé, comme un podcast : commandes du
      // téléphone et Bluetooth de la voiture (PLAN §22).
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: t('Le point du jour'),
          artist: 'Beluga Build',
          artwork: [{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' }],
        });
        navigator.mediaSession.setActionHandler('play', () => void audio.play());
        navigator.mediaSession.setActionHandler('pause', () => audio.pause());
        navigator.mediaSession.setActionHandler('stop', () => {
          audio.pause();
          audio.currentTime = 0;
          setSpeaking(false);
        });
      }

      audio.addEventListener('ended', () => setSpeaking(false));
      audio.addEventListener('error', async () => {
        setSpeaking(false);
        // Repli : la voix du navigateur, si le serveur n'a pas de moteur.
        const data = await client.call<{ text: string }>({ type: 'digest.speak', projectId: state.activeProjectId ?? undefined });
        if ('speechSynthesis' in window && data?.text) {
          const utterance = new SpeechSynthesisUtterance(data.text);
          utterance.lang = formatRegional();
          speechSynthesis.speak(utterance);
        }
      });
      await audio.play();
    } catch {
      setSpeaking(false);
    }
  };

  /* LA COLONNE (ordinateur) : les mêmes entrées, en lignes. Réduite à sa bande,
     elle n'en garde que les icônes. */
  const ligne = (
    cle: string,
    icone: React.ReactNode,
    libelle: React.ReactNode,
    geste: () => void,
    options: { eteinte?: boolean; danger?: boolean; reperes?: Record<string, string> } = {},
  ) => (
    <button
      key={cle}
      type="button"
      data-option-du-projet={cle}
      {...options.reperes}
      disabled={options.eteinte}
      title={typeof libelle === 'string' ? libelle : undefined}
      onClick={geste}
      className={cn(
        CLASSE_LIGNE_DE_SERVICE,
        CLASSE_LIGNE_EN_BANDE,
        'hover:bg-raised disabled:opacity-50',
        options.danger && 'text-danger',
      )}
    >
      <span className={cn('shrink-0', options.danger ? 'text-danger' : 'text-muted')}>{icone}</span>
      <span className={cn('min-w-0 flex-1 truncate', CLASSE_LIBELLE_EN_BANDE)}>{libelle}</span>
    </button>
  );
  const sansProjet = !state.activeProjectId;
  const fenetres = (
    <>
      <MemoryView
        open={memoireOuverte}
        projectId={state.activeProjectId ?? undefined}
        onClose={() => setMemoireOuverte(false)}
      />

      <ConfirmDialog
        open={arretGroupe}
        danger
        title={
          duProjet.length > 1
            ? t('Arrêter les {v0} agents de ce projet ?', { v0: duProjet.length })
            : t('Arrêter l’agent de ce projet ?')
        }
        description={t('Le travail en cours sera perdu. Les agents des autres projets continuent.')}
        confirmLabel={t('Tout arrêter')}
        onConfirm={arreterLeProjet}
        onClose={() => setArretGroupe(false)}
      />
    </>
  );

  if (forme === 'colonne') {
    return (
      <>
        <ColonneDeService>
          <nav
            aria-label="Options du projet"
            data-options-du-projet
            className="flex min-h-0 flex-1 flex-col gap-0.5 pt-1"
          >
            {/* « NOUVELLE TÂCHE », TOUT EN HAUT : le seul chemin vers une nouvelle
                carte, au-dessus des fichiers (demande du 12/10/2026). */}
            {state.activeProjectId ? <BoutonNouvelleTache projectId={state.activeProjectId} /> : null}
            {onOuvrirFichiers
              ? [
                  ligne('fichiers', <FolderOpen className="h-4 w-4" />, t('Fichiers'), () => onOuvrirFichiers('fichiers'), {
                    eteinte: sansProjet,
                    reperes: { 'data-menu-fichiers': '' },
                  }),
                  ligne('pieces', <Paperclip className="h-4 w-4" />, t('Pièces jointes'), () => onOuvrirFichiers('pieces'), {
                    eteinte: sansProjet,
                    reperes: { 'data-menu-pieces': '' },
                  }),
                ]
              : null}
            {ligne('memoire', <BookOpen className="h-4 w-4" />, t('Mémoire du projet'), () => setMemoireOuverte(true), {
              eteinte: sansProjet,
            })}
            {voixVisible
              ? ligne(
                  'ecouter',
                  <Volume2 className={cn('h-4 w-4', speaking && 'animate-pulse-soft')} />,
                  t('Écouter le point'),
                  () => void listen(),
                  { eteinte: speaking },
                )
              : null}
            {/* L'ARRÊT, TOUT EN BAS DE LA COLONNE, juste au-dessus de la ligne du
                moteur, et DISCRET : texte rouge, petite icône, sans fond — la
                même allure que « Supprimer définitivement… » des réglages du
                projet. Un geste qui coupe du travail ne se pose jamais au
                milieu des entrées anodines. */}
            {duProjet.length ? (
              <div className="mt-auto pb-1 pt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'w-full justify-start text-danger hover:text-danger group-data-[bande]/colonne:justify-center group-data-[bande]/colonne:px-0',
                  )}
                  data-option-du-projet="arreter"
                  data-arreter-agents
                  title={`${t('Arrêter les agents du projet (')}${duProjet.length})`}
                  onClick={() => setArretGroupe(true)}
                >
                  <Square className="h-3 w-3 shrink-0 fill-current" />
                  <span className={cn('min-w-0 truncate', CLASSE_LIBELLE_EN_BANDE)}>
                    {`${t('Arrêter les agents du projet (')}${duProjet.length})`}
                  </span>
                </Button>
              </div>
            ) : null}
          </nav>
        </ColonneDeService>
        {/* LES RÉGLAGES DU PROJET ONT QUITTÉ LA COLONNE : un menu à trois points
            verticaux, en haut à droite de la page, qui les range. */}
        {declencheur ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-[38px] sm:h-8 w-[38px] sm:w-8 shrink-0 text-muted"
                aria-label="Options du projet"
                title={t('Options')}
                data-menu-general
              >
                <EllipsisVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={cote} className="min-w-[230px]">
              <DropdownMenuItem
                data-option-du-projet="reglages"
                data-reglages-du-projet-ouvert
                disabled={sansProjet}
                onSelect={() => state.activeProjectId && ouvrirConfigProjet(state.activeProjectId)}
              >
                <Settings2 className="h-3.5 w-3.5" />
                {t('Réglages du projet')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {fenetres}
      </>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{declencheur}</DropdownMenuTrigger>
        {/* Les sélecteurs `data-*` des contrôles ont suivi leur entrée. */}
        <DropdownMenuContent align={cote} className="min-w-[230px]">
          {/* LES RÉGLAGES DU PROJET, TOUT EN HAUT : sur téléphone aussi, comme
              dans le menu du grand écran. Éteints tant qu'aucun projet n'est ouvert. */}
          <DropdownMenuItem
            data-option-du-projet="reglages"
            data-reglages-du-projet-ouvert
            disabled={sansProjet}
            onSelect={() => state.activeProjectId && ouvrirConfigProjet(state.activeProjectId)}
          >
            <Settings2 className="h-3.5 w-3.5" />
            {t('Réglages du projet')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* LES DEUX GESTES DE PUBLICATION, EN TÊTE (téléphone) : chacun dit
              ce qui attend ou son avancement, et OUVRE sa page — le déroulé
              du déploiement, la page de mise en production. C'est de là
              qu'on lance, jamais d'un toucher dans ce menu. */}
          {deploiement || production ? (
            <>
              <DropdownMenuLabel data-menu-groupe="publication">{t('Mise en ligne')}</DropdownMenuLabel>
              {deploiement ? (
                <DropdownMenuItem data-menu-deployer={deploiement.compte} onSelect={() => deploiement.ouvrir()}>
                  <Play className="h-3.5 w-3.5" />
                  <span className="min-w-0 flex-1 truncate">{t('Déployer')}</span>
                  <EtatDeLaLigneDePublication geste={deploiement} />
                </DropdownMenuItem>
              ) : null}
              {production ? (
                <DropdownMenuItem data-menu-production={production.compte} onSelect={() => production.ouvrir()}>
                  <Rocket className="h-3.5 w-3.5" />
                  <span className="min-w-0 flex-1 truncate">{t('Mise en production')}</span>
                  <EtatDeLaLigneDePublication geste={production} pastille />
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuLabel data-menu-groupe="projet">{t('Projet')}</DropdownMenuLabel>
          {/* Sur téléphone, le module de voix a pris la colonne centrale du menu
              du bas : le tableau de bord se rejoint donc ICI. Sur grand écran,
              la colonne de gauche y mène déjà, on ne double pas l'entrée. */}
          {telephone && onOpenDashboard ? (
            <DropdownMenuItem onSelect={onOpenDashboard}>
              <BarChart3 className="h-3.5 w-3.5" />
              {t('Résumé')}
            </DropdownMenuItem>
          ) : null}
          {onOuvrirFichiers ? (
            <>
              <DropdownMenuItem
                data-menu-fichiers
                disabled={!state.activeProjectId}
                onSelect={() => onOuvrirFichiers('fichiers')}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                {t('Fichiers')}
              </DropdownMenuItem>
              <DropdownMenuItem
                data-menu-pieces
                disabled={!state.activeProjectId}
                onSelect={() => onOuvrirFichiers('pieces')}
              >
                <Paperclip className="h-3.5 w-3.5" />
                {t('Pièces jointes')}
              </DropdownMenuItem>
            </>
          ) : null}
          <DropdownMenuItem
            disabled={!state.activeProjectId}
            onSelect={() => setMemoireOuverte(true)}
          >
            <BookOpen className="h-3.5 w-3.5" />
            {t('Mémoire du projet')}
          </DropdownMenuItem>
          {voixVisible ? (
            <DropdownMenuItem disabled={speaking} onSelect={() => void listen()}>
              <Volume2 className={cn('h-3.5 w-3.5', speaking && 'animate-pulse-soft')} />
              {t('Écouter le point')}
            </DropdownMenuItem>
          ) : null}
          {/* L'arrêt, en rouge, ferme le menu : un geste qui coupe du travail
              ne se pose jamais au milieu des entrées anodines. */}
          {duProjet.length ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-danger" onSelect={() => setArretGroupe(true)}>
                <Square className="h-3.5 w-3.5 fill-current" />
                {t('Arrêter les agents du projet (')}{duProjet.length})
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {fenetres}
    </>
  );
}
