import { useVoixDisponible } from '@/lib/voix-disponible';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { RotateCw, X } from '@/components/ui/icones';
import {
  HAUT_ENTETE,
  MARGE_CHAT,
  estTelephoneChat,
  nomDeLAssistant,
  voletDeLAssistant,
  type Agent,
  type ChatAssistant,
  type FenetreChat,
} from '@beluga/shared';
import { Chat } from '@/components/chat';
import { ParlezAVoixHaute } from '@/components/installation/parlez-a-voix-haute';
import { IconeTroisBarres } from '@/components/ondes-de-voix';
import { BoutonReglagesAgent } from '@/components/bouton-reglages-agent';
import { SilhouetteConversation } from '@/components/silhouettes';
import { Button, Drawer, EnteteDeFeuille, Tooltip } from '@/components/ui';
import { client } from '@/lib/client';
import { poserAgentDeLAssistant, useBoutonDuBord, useEtatAssistant } from '@/lib/assistant-global';
import { useDirectVu } from '@/lib/etat-vocal';
import { useSurfaceDeJarvis } from '@/lib/morphing-du-bord';
import { usePointerDrag, type DragItem } from '@/lib/dnd';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

function lireFenetre(): FenetreChat {
  return typeof window === 'undefined' ? { width: 1280, height: 800 } : { width: window.innerWidth, height: window.innerHeight };
}

/** Le glisser n'a aucune cible : la poignée se suit au pointeur. */
const SANS_CIBLE = () => null;

/**
 * L'ASSISTANT GLOBAL — LE VOLET FLOTTANT DU CHEF D'ORCHESTRE, PARTOUT (`shared/src/assistant-global.ts`).
 *
 * LE BOUTON DU BORD EST SA SEULE ENTRÉE (carte « Jarvis : volet, voix et rapidité », 16/11/2026) : le robot du bas à
 * droite et ses doublons (bouton de l'entête et ligne du menu sur téléphone) ont disparu. Le volet s'ouvre DU CÔTÉ
 * du bouton (`voletDeLAssistant`) ; il s'agrandit par sa poignée, au coin opposé à son ancrage. La taille et l'état
 * ouvert se retiennent dans le compte (`CLE_ASSISTANT_GLOBAL`). La poignée passe par le SEUL glisser de
 * l'application (`usePointerDrag`). Sur téléphone, il s'ancre SOUS L'ENTÊTE, pleine largeur, au-dessus du menu du bas.
 *
 * C'EST AUSSI LE LIEU DE LA VOIX : la conversation vocale (« Dis Jarvis », Cmd+Espace, le bouton voix de la zone
 * d'écriture) parle au MÊME agent. Depuis le 17/11/2026, RIEN n'entre dans le fil pendant la voix : la zone d'écriture
 * laisse place aux bulles et aux ondes (`voix-du-champ.tsx`, posées par le `Chat` lui-même), et la synthèse de fin
 * s'ajoute au brouillon. Les RÉGLAGES de l'agent montent dans l'entête, juste à gauche de la croix. Le volet porte `data-volet-de-jarvis` (hors de
 * portée, `lib/gestes-de-jarvis.ts`) : les gestes de Jarvis à l'écran n'y jouent jamais, et un appui dedans ne les
 * arrête pas (MEM-7570). Pas `data-module-voix` : ce repère reste au seul bouton du bord, lu par les contrôles.
 *
 * Dans les deux cas, la hauteur est bornée par la zone sûre du haut (barre d'état de l'iPhone) et par le clavier,
 * comme les tiroirs (`--zone-sure-haut`, `--clavier`) : la fenêtre ne passe plus jamais sous la barre d'état.
 */
export function AssistantGlobal() {
  /* LE VOLET N'EXISTE QUE SANS LA VOIX (décision de l'utilisateur, 20/11/2026) : voix éteinte dans les réglages, ou aucun
     compte ChatGPT relié. Avec la voix, tout se passe dans les bulles du mode vocal ; Jarvis et ce volet ont les mêmes
     outils (le pont de Beluga) : ils sont complémentaires, jamais affichés ensemble. */
  const { disponible } = useVoixDisponible();
  if (disponible) return null;
  return <VoletDeLAssistantGlobal />;
}

function VoletDeLAssistantGlobal() {
  const state = useApp();
  const { retenu, retenir: setBrut, agent: agentDuMagasin, agentId: agentDeLaVoix } = useEtatAssistant();
  const [geste, setGeste] = React.useState<ChatAssistant | null>(null);
  const etat = geste ?? retenu;

  const [fenetre, setFenetre] = React.useState<FenetreChat>(lireFenetre);
  React.useEffect(() => {
    const suivre = () => setFenetre(lireFenetre());
    window.addEventListener('resize', suivre);
    return () => window.removeEventListener('resize', suivre);
  }, []);
  const telephone = estTelephoneChat(fenetre);
  const bouton = useBoutonDuBord();
  const vu = voletDeLAssistant(etat, fenetre, bouton);
  const direct = useDirectVu();
  // La voix d'une CARTE ne touche pas au volet : seule celle de l'assistant (ou encore sans agent connu) le met en mode voix.
  const enVoix = direct.etat !== 'eteint' && (direct.agentId === null || direct.agentId === agentDeLaVoix);
  /* LE VOLET PASSE TOUJOURS DEVANT LES PAGES, FICHES, FEUILLES ET FENÊTRES DE SERVICE (`z-[56]`, demande du 18/11/2026,
     capture #5f80c : la fiche d'une demande de la Messagerie, ouverte après lui au même étage `z-40`, le masquait).
     Plus seulement en voix : un appui dedans ne referme jamais la page ou la fenêtre dessous (`data-au-dessus-de-tout`),
     et une fenêtre modale ne lui vole ni le focus ni la molette (`lib/au-dessus-des-fenetres.ts`). Les menus (z-[60]+)
     et les infobulles restent au-dessus de lui. */
  /* SUR ORDINATEUR, LE BOUTON DU BORD SE TRANSFORME EN CE VOLET ET REVIENT À SA PLACE QUAND IL SE FERME (17/11/2026,
     `lib/morphing-du-bord.ts`). Sur téléphone, le volet est une feuille du bas : elle garde son propre mouvement. */
  const sectionRef = React.useRef<HTMLElement | null>(null);
  useSurfaceDeJarvis('volet', sectionRef, !telephone && etat.ouvert);

  /* -------- L'agent : chargé à la première ouverture seulement -------- */
  const [agentId, setAgentId] = React.useState<string | null>(null);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const charger = React.useCallback((neuf: boolean) => {
    setErreur(null);
    void client
      .call<{ agent: Agent }>({ type: 'assistant.agent', neuf })
      .then(async (r) => {
        await client.chargerAgent(r.agent.id);
        setAgentId(r.agent.id);
        poserAgentDeLAssistant(r.agent.id);
      })
      .catch((err: unknown) => setErreur(err instanceof Error ? err.message : String(err)));
  }, []);
  React.useEffect(() => {
    if (etat.ouvert && !agentId) charger(false);
  }, [etat.ouvert, agentId, charger]);

  const agent = agentDuMagasin;
  const vide = agent ? (state.messages[agent.id]?.length ?? 0) === 0 && !enVoix : true;

  /* -------- La poignée (taille), au coin opposé à l'ancrage -------- */
  const depart = React.useRef<{ x: number; y: number; etat: ChatAssistant } | null>(null);
  const dernier = React.useRef<ChatAssistant | null>(null);
  const sensRef = React.useRef(vu.poignee);
  sensRef.current = vu.poignee;
  const lacher = React.useCallback(
    (_item: DragItem) => {
      const fin = dernier.current;
      depart.current = null;
      dernier.current = null;
      setGeste(null);
      if (fin) setBrut(fin);
    },
    [setBrut],
  );
  const { dragging, pointer, start } = usePointerDrag({ resolve: SANS_CIBLE, onDrop: lacher });
  React.useEffect(() => {
    const origine = depart.current;
    if (!dragging || !pointer || !origine) return;
    const dx = pointer.x - origine.x;
    const dy = pointer.y - origine.y;
    const suite = { ...origine.etat, largeur: origine.etat.largeur + sensRef.current.sensX * dx, hauteur: origine.etat.hauteur + sensRef.current.sensY * dy };
    dernier.current = suite;
    setGeste(suite);
  }, [dragging, pointer]);
  const commencer = (event: React.PointerEvent) => {
    if (telephone) return;
    // La taille part de ce qui est AFFICHÉ (déjà bornée par l'écran).
    depart.current = { x: event.clientX, y: event.clientY, etat: { ...etat, largeur: vu.largeur, hauteur: vu.hauteur } };
    start(event, { id: 'assistant-poignee', kind: 'poignee', label: 'Assistant' });
  };

  if (typeof document === 'undefined') return null;

  const titre = t('Assistant {v0}', { v0: nomDeLAssistant(state.settings) });
  const fermer = () => setBrut({ ...retenu, ouvert: false });
  const croix = (
    <>
      {agent ? <BoutonReglagesAgent agent={agent} dansLEntete /> : null}
    <Button
      variant="ghost"
      size="icon"
      className="h-[34px] sm:h-7 w-[34px] sm:w-7 shrink-0 text-muted"
      onClick={fermer}
      aria-label="Fermer l’assistant"
      title={t('Fermer l’assistant')}
    >
      <X className="h-3.5 w-3.5" />
    </Button>
    </>
  );
  const conversation = (
      <div className="flex min-h-0 flex-1 flex-col" data-assistant-conversation={agent ? 'oui' : 'chargement'}>
        {erreur ? (
          <div className="flex flex-col items-start gap-2 px-4 py-3">
            <p className="text-[13px] leading-snug text-danger">{erreur}</p>
            <Button size="sm" variant="subtle" onClick={() => charger(false)}>
              <RotateCw className="h-3.5 w-3.5" />
              {t('Réessayer')}
            </Button>
          </div>
        ) : !agent ? (
          <div className="px-4">
            <SilhouetteConversation bulles={2} />
          </div>
        ) : (
          <>
            {/* LA VOIX SE PROPOSE ICI (20/11/2026) : le volet n'existe que sans voix (DEC-541), l'encadré seulement
                sans compte ChatGPT relié. */}
            <ParlezAVoixHaute className="mx-4 mt-3" />
            {vide ? (
              <p className="px-4 pt-3 text-[13px] leading-snug text-muted" data-assistant-accueil>
                {t('Posez une question sur n’importe quel projet ou service — cartes, mémoire, coffre-fort, messagerie, réseaux sociaux, surveillance, backups, notes. L’assistant agit comme un agent : seules les suppressions et les envois aux clients attendent votre accord ici même.')}
              </p>
            ) : null}
            <Chat
              agent={agent}
              projectId={agent.projectId}
              nouveauDepart
              creuxReserveAilleurs
              libelleDuChamp={t('Écrire à l’assistant')}
              sansReglagesDuChamp
            />
          </>
        )}
      </div>
  );

  /*
   * SUR TÉLÉPHONE, L'ASSISTANT EST UNE FEUILLE DU BAS (décision de l'utilisateur du 17/11/2026, comme tout panneau qui
   * monte du bas sur téléphone : `Drawer feuille`) — poignée, titre « Assistant <nom> » centré, croix ; on la referme
   * d'un glissé, de la croix ou d'un appui sur le voile. Elle remplace l'ancien cadre posé sous l'entête (MEM-3996).
   * Elle passe toujours devant les pages et fenêtres ouvertes (`z-[56]`, MEM-7570, 18/11/2026).
   */
  if (telephone) {
    return (
      <Drawer open={etat.ouvert} onClose={fermer} feuille hauteurFixe className="z-[56]">
        <EnteteDeFeuille
          titre={<span data-titre-de-l-assistant>{titre}</span>}
          gauche={<IconeTroisBarres className="shrink-0 scale-[0.6] text-text" vivante={enVoix} />}
          droite={croix}
          data-entete-de-l-assistant
        />
        <div
          data-assistant-chat={agentId ?? 'chargement'}
          data-assistant-ancre="feuille"
          data-volet-de-jarvis
          data-mode-voix={enVoix ? '' : undefined}
          data-au-dessus-de-tout
          className="flex min-h-0 flex-1 flex-col"
          style={{ ['--marge-de-page' as string]: '8px' }}
        >
          {conversation}
        </div>
      </Drawer>
    );
  }

  if (!etat.ouvert) return null;

  /*
   * LA HAUTEUR EST BORNÉE COMME CELLE DES TIROIRS : la règle pure ne connaît ni la zone sûre du haut (barre d'état de
   * l'iPhone, `--zone-sure-haut`) ni le clavier (`--clavier`) ; l'écran les retire ici.
   */
  const place: React.CSSProperties = {
    ...(vu.gauche !== undefined ? { left: vu.gauche } : {}),
    ...(vu.droite !== undefined ? { right: vu.droite } : {}),
    ...(vu.haut !== undefined ? { top: `calc(${vu.haut}px + var(--zone-sure-haut, 0px))` } : {}),
    // Le terminal ouvert soulève l'application : le volet monte avec lui.
    ...(vu.bas !== undefined ? { bottom: `calc(${vu.bas}px + var(--hauteur-terminal, 0px))` } : {}),
    width: vu.largeur,
    height: vu.hauteur,
    maxHeight: `calc(100dvh - ${(vu.bas ?? 16) + HAUT_ENTETE + MARGE_CHAT}px - var(--zone-sure-haut, 0px) - var(--clavier, 0px) - var(--hauteur-terminal, 0px))`,
  };
  const poignee = vu.poignee;

  return createPortal(
    <section
      ref={sectionRef}
      data-assistant-chat={agentId ?? 'chargement'}
      data-assistant-ancre={bouton.bord}
      data-volet-de-jarvis
      data-mode-voix={enVoix ? '' : undefined}
      data-au-dessus-de-tout
      className="pointer-events-auto fixed z-[56] flex flex-col overflow-hidden rounded-xl bg-surface shadow-2xl ring-1 ring-faint/30"
      /* LE CHAMP D'ÉCRITURE A LA MÊME MARGE SUR SES TROIS BORDS (16/11/2026, capture #b82e) : le pied en tiroir
         garde 8 px en bas (`dansTiroir`, composer.tsx), donc les côtés passent de 16 à 8 px ICI SEULEMENT —
         `--marge-de-page` n'est lue dans le volet que par la barre d'écriture et son repère de tâches. */
      style={{ ...place, ['--marge-de-page' as string]: '8px' }}
    >
      <header className="flex shrink-0 items-center gap-2 bg-raised px-3 py-2 text-[13px] font-medium text-text">
        <IconeTroisBarres className="shrink-0 scale-[0.6] text-text" vivante={enVoix} />
        <span className="min-w-0 flex-1 truncate" data-titre-de-l-assistant>{titre}</span>
        {croix}
      </header>
      <span
        data-assistant-poignee
        onPointerDown={commencer}
        title={t('Tirer pour redimensionner')}
        className={cn(
          'absolute z-10 h-4 w-4',
          poignee.horizontal === 'gauche' ? 'left-0' : 'right-0',
          poignee.vertical === 'haut' ? 'top-0' : 'bottom-0',
          poignee.sensX === poignee.sensY ? 'cursor-nwse-resize' : 'cursor-nesw-resize',
        )}
        style={{ touchAction: 'none' }}
      />
      {conversation}
    </section>,
    document.body,
  );
}
