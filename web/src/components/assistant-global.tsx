import * as React from 'react';
import { createPortal } from 'react-dom';
import { Bot, ChevronDown, Loader2, MessageCircleQuestion, RotateCw, X } from 'lucide-react';
import {
  BAS_ROBOT,
  HAUT_ENTETE,
  MARGE_CHAT,
  ROND_ROBOT,
  chatDeLAssistant,
  droiteDuRobot,
  estTelephoneChat,
  type Agent,
  type ChatAssistant,
  type FenetreChat,
  type ReglageNiveauAssistant,
} from '@beluga/shared';
import { Chat } from '@/components/chat';
import { ReglagesAssistant } from '@/components/reglages-assistant';
import { SilhouetteConversation } from '@/components/silhouettes';
import { BulleInfo, Button, CLASSE_POINT_DE_BOUTON, Switch, Tooltip } from '@/components/ui';
import { client } from '@/lib/client';
import { poserAgentDeLAssistant, useEtatAssistant } from '@/lib/assistant-global';
import { usePointerDrag, type DragItem } from '@/lib/dnd';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

function lireFenetre(): FenetreChat {
  return typeof window === 'undefined' ? { width: 1280, height: 800 } : { width: window.innerWidth, height: window.innerHeight };
}

/** Le glisser n'a aucune cible : le robot et la poignée se suivent au pointeur. */
const SANS_CIBLE = () => null;

/**
 * L'ASSISTANT GLOBAL — le robot en bas à droite de TOUTE l'application
 * (`shared/src/assistant-global.ts`, demande du 02.10.2026).
 *
 * SUR ORDINATEUR, le robot glisse À L'HORIZONTALE le long du bas de l'écran ;
 * le chat s'ouvre juste au-dessus et le SUIT. Le chat s'agrandit en largeur et
 * en hauteur par sa poignée du coin haut gauche. La place du robot, la taille
 * et l'état ouvert se retiennent dans le compte (`CLE_ASSISTANT_GLOBAL`). Robot
 * et poignée passent par le SEUL glisser de l'application (`usePointerDrag`).
 *
 * SUR TÉLÉPHONE, PLUS DE ROBOT FLOTTANT : l'assistant s'ouvre depuis le bouton
 * de l'entête, juste avant le menu (`BoutonAssistantEntete`), et le chat
 * s'ancre SOUS L'ENTÊTE, pleine largeur, au-dessus du menu du bas.
 *
 * Dans les deux cas, la hauteur est bornée par la zone sûre du haut (barre
 * d'état de l'iPhone) et par le clavier, comme les tiroirs (`--zone-sure-haut`,
 * `--clavier`) : la fenêtre ne passe plus jamais sous la barre d'état.
 *
 * Le chat est la conversation ordinaire (`Chat`) : même barre d'écriture que
 * les tâches. Juste dessous, l'interrupteur « Validation automatique », son
 * explication rangée derrière un « i » en bout de ligne : allumé, l'assistant
 * ajoute et modifie seul ; les suppressions, les envois aux clients et les
 * écritures sur un serveur demandent TOUJOURS l'accord — la règle est tenue
 * par le démon, pas par cet écran.
 */
export function AssistantGlobal() {
  const state = useApp();
  const { retenu, retenir: setBrut, agent: agentDuMagasin, travaille, questions } = useEtatAssistant();
  const [geste, setGeste] = React.useState<ChatAssistant | null>(null);
  const etat = geste ?? retenu;

  const [fenetre, setFenetre] = React.useState<FenetreChat>(lireFenetre);
  React.useEffect(() => {
    const suivre = () => setFenetre(lireFenetre());
    window.addEventListener('resize', suivre);
    return () => window.removeEventListener('resize', suivre);
  }, []);
  const telephone = estTelephoneChat(fenetre);
  const droiteRobot = droiteDuRobot(etat.droite, fenetre.width);
  const vu = chatDeLAssistant(etat, fenetre);

  /* -------- L'agent : chargé à la première ouverture seulement -------- */
  const [agentId, setAgentId] = React.useState<string | null>(null);
  const [validationAuto, setValidationAuto] = React.useState(false);
  const [niveau, setNiveau] = React.useState<ReglageNiveauAssistant | undefined>(undefined);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [reglage, setReglage] = React.useState(false);
  const charger = React.useCallback((neuf: boolean) => {
    setErreur(null);
    void client
      .call<{ agent: Agent; validationAuto: boolean; niveau?: ReglageNiveauAssistant }>({ type: 'assistant.agent', neuf })
      .then(async (r) => {
        await client.chargerAgent(r.agent.id);
        setAgentId(r.agent.id);
        // Le bouton de l'entête (téléphone) lit l'agent dans le magasin partagé.
        poserAgentDeLAssistant(r.agent.id);
        setValidationAuto(r.validationAuto);
        setNiveau(r.niveau);
      })
      .catch((err: unknown) => setErreur(err instanceof Error ? err.message : String(err)));
  }, []);
  React.useEffect(() => {
    if (etat.ouvert && !agentId) charger(false);
  }, [etat.ouvert, agentId, charger]);

  const agent = agentDuMagasin;
  const vide = agent ? (state.messages[agent.id]?.length ?? 0) === 0 : true;

  const basculerValidation = (auto: boolean) => {
    setReglage(true);
    setValidationAuto(auto);
    void client
      .call<{ validationAuto: boolean }>({ type: 'assistant.validation', auto })
      .then((r) => setValidationAuto(r.validationAuto))
      .catch((err: any) => {
        setValidationAuto(!auto);
        client.pushToast('error', err?.message ?? t('Réglage refusé'));
      })
      .finally(() => setReglage(false));
  };

  /* -------- Le glisser : robot (horizontal) et poignée (taille) -------- */
  const depart = React.useRef<{ x: number; y: number; etat: ChatAssistant } | null>(null);
  const dernier = React.useRef<ChatAssistant | null>(null);
  const vientDeGlisser = React.useRef(false);
  const fenetreRef = React.useRef(fenetre);
  fenetreRef.current = fenetre;
  const lacher = React.useCallback(
    (item: DragItem) => {
      const fin = dernier.current;
      depart.current = null;
      dernier.current = null;
      setGeste(null);
      if (!fin) return;
      setBrut(fin);
      /* Le relâchement d'un glissement DU ROBOT est suivi d'un clic sur lui :
         ce clic-là n'ouvre ni ne ferme. Le drapeau tombe juste après, pour ne
         jamais avaler le clic suivant (celui d'après un redimensionnement). */
      if (item.kind === 'robot') {
        vientDeGlisser.current = true;
        window.setTimeout(() => {
          vientDeGlisser.current = false;
        }, 0);
      }
    },
    [setBrut],
  );
  const { dragging, pointer, start } = usePointerDrag({ resolve: SANS_CIBLE, onDrop: lacher });
  React.useEffect(() => {
    const origine = depart.current;
    if (!dragging || !pointer || !origine) return;
    const dx = pointer.x - origine.x;
    const dy = pointer.y - origine.y;
    const suite =
      dragging.kind === 'robot'
        ? { ...origine.etat, droite: droiteDuRobot(origine.etat.droite - dx, fenetreRef.current.width) }
        : { ...origine.etat, largeur: origine.etat.largeur - dx, hauteur: origine.etat.hauteur - dy };
    dernier.current = suite;
    setGeste(suite);
  }, [dragging, pointer]);
  const commencer = (kind: 'robot' | 'poignee') => (event: React.PointerEvent) => {
    if (telephone) return;
    // La taille part de ce qui est AFFICHÉ (déjà bornée par l'écran).
    depart.current = { x: event.clientX, y: event.clientY, etat: { ...etat, largeur: vu.largeur, hauteur: vu.hauteur } };
    start(event, { id: `assistant-${kind}`, kind, label: 'Assistant' });
  };

  const ouvrirFermer = () => {
    if (vientDeGlisser.current) {
      vientDeGlisser.current = false;
      return;
    }
    setBrut({ ...retenu, ouvert: !retenu.ouvert });
  };


  if (typeof document === 'undefined') return null;

  /*
   * LA HAUTEUR EST BORNÉE COMME CELLE DES TIROIRS : la règle pure ne connaît ni
   * la zone sûre du haut (barre d'état de l'iPhone, `--zone-sure-haut`) ni le
   * clavier (`--clavier`) ; l'écran les retire ici. Sur téléphone, le chat est
   * tenu par son HAUT (sous l'entête, zone sûre comprise) et son BAS (au-dessus
   * du menu du bas, ou du clavier quand il est ouvert) : sa hauteur en découle.
   */
  const place: React.CSSProperties =
    telephone && vu.haut !== undefined
      ? {
          left: vu.droite,
          right: vu.droite,
          top: `calc(${vu.haut}px + var(--zone-sure-haut, 0px))`,
          bottom: `max(calc(${vu.bas}px + env(safe-area-inset-bottom, 0px)), calc(var(--clavier, 0px) + 8px))`,
        }
      : {
          right: vu.droite,
          bottom: vu.bas,
          width: vu.largeur,
          height: vu.hauteur,
          maxHeight: `calc(100dvh - ${vu.bas + HAUT_ENTETE + MARGE_CHAT}px - var(--zone-sure-haut, 0px) - var(--clavier, 0px))`,
        };

  return createPortal(
    <>
      {/* Sur téléphone, le robot ne flotte plus : le bouton de l'entête le remplace. */}
      {!telephone ? (
      <button
        type="button"
        onPointerDown={commencer('robot')}
        onClick={ouvrirFermer}
        data-assistant-robot
        data-ouvert={etat.ouvert ? 'oui' : 'non'}
        data-glisse={dragging?.kind === 'robot' ? 'oui' : undefined}
        aria-expanded={etat.ouvert}
        aria-label={etat.ouvert ? 'Fermer l’assistant' : 'Ouvrir l’assistant'}
        title={etat.ouvert ? t('Fermer l’assistant') : t('Ouvrir l’assistant — glisser pour le déplacer')}
        className="fixed z-40 grid cursor-grab place-items-center rounded-full bg-text text-bg shadow-xl transition-transform hover:scale-105 active:cursor-grabbing"
        style={{
          width: ROND_ROBOT,
          height: ROND_ROBOT,
          right: droiteRobot,
          bottom: `max(${BAS_ROBOT}px, env(safe-area-inset-bottom))`,
          touchAction: 'none',
        }}
      >
        {etat.ouvert ? <ChevronDown className="h-5 w-5" /> : travaille ? <Loader2 className="h-5 w-5 animate-spin" /> : <Bot className="h-5 w-5" />}
        {!etat.ouvert && questions > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 w-4 place-items-center rounded-full bg-warning text-sur-etat" data-assistant-question>
            <MessageCircleQuestion className="h-2.5 w-2.5" />
          </span>
        ) : null}
      </button>
      ) : null}

      {etat.ouvert ? (
        <section
          data-assistant-chat={agentId ?? 'chargement'}
          data-assistant-ancre={telephone ? 'entete' : 'robot'}
          className="fixed z-40 flex flex-col overflow-hidden rounded-xl bg-surface shadow-2xl ring-1 ring-faint/30"
          style={place}
        >
          <header className="flex shrink-0 items-center gap-2 bg-raised px-3 py-2 text-[13px] font-medium text-text">
            <Bot className="h-3.5 w-3.5 shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate">{t('Assistant Beluga')}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted"
              onClick={() => setBrut({ ...retenu, ouvert: false })}
              aria-label="Fermer l’assistant"
              title={t('Fermer l’assistant')}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </header>
          {!telephone ? (
            <span
              data-assistant-poignee
              onPointerDown={commencer('poignee')}
              title={t('Tirer pour redimensionner')}
              className="absolute left-0 top-0 z-10 h-4 w-4 cursor-nwse-resize"
              style={{ touchAction: 'none' }}
            />
          ) : null}

          {agent ? <ReglagesAssistant agent={agent} niveau={niveau} /> : null}

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
                {vide ? (
                  <p className="px-4 pt-3 text-[13px] leading-snug text-muted" data-assistant-accueil>
                    {t('Posez une question sur n’importe quel projet ou service — cartes, mémoire, coffre-fort, messagerie, marketing, surveillance, backups, notes. L’assistant peut aussi ajouter, modifier ou supprimer : chaque changement attend votre accord ici même.')}
                  </p>
                ) : null}
                <Chat agent={agent} projectId={agent.projectId} nouveauDepart creuxReserveAilleurs libelleDuChamp={t('Écrire à l’assistant')} />
              </>
            )}
          </div>

          {/* L'INTERRUPTEUR, JUSTE SOUS LE CHAMP D'ÉCRITURE, sur UNE ligne. Son
              explication vit derrière le « i » en bout de ligne : HORS du
              <label>, pour qu'un appui sur le « i » ne bascule jamais
              l'interrupteur. */}
          <div
            className="flex shrink-0 items-center gap-2 px-3 pb-2.5 pt-1.5 text-[12.5px] leading-snug"
            data-assistant-validation={validationAuto ? 'auto' : 'manuelle'}
          >
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
              <Switch checked={validationAuto} onCheckedChange={basculerValidation} attente={reglage} disabled={!agent} />
              <span className="min-w-0 truncate text-text">{t('Validation automatique')}</span>
            </label>
            <BulleInfo label={t('Validation automatique')}>
              {validationAuto
                ? t('L’assistant ajoute et modifie sans demander. Suppressions, envois aux clients et bases des serveurs attendent toujours votre accord.')
                : t('Chaque changement attend votre accord dans le fil.')}
            </BulleInfo>
          </div>
        </section>
      ) : null}
    </>,
    document.body,
  );
}

/**
 * LE BOUTON DE L'ASSISTANT DANS L'ENTÊTE — SUR TÉLÉPHONE SEULEMENT, juste avant
 * le menu des trois points (demande du 02.10.2026). Il remplace le robot
 * flottant : même état (préférence du compte), mêmes signes — roue quand
 * l'assistant travaille, point orange (celui de tous les boutons de l'entête,
 * `CLASSE_POINT_DE_BOUTON`) quand une question l'attend. Le chat s'ouvre
 * juste en dessous, ancré sous l'entête.
 */
export function BoutonAssistantEntete() {
  const { retenu, travaille, questions, basculer } = useEtatAssistant();
  const libelle = retenu.ouvert ? t('Fermer l’assistant') : t('Ouvrir l’assistant');
  return (
    <Tooltip label={libelle}>
      <Button
        variant="outline"
        size="icon"
        className={cn('relative shrink-0', retenu.ouvert && 'text-text')}
        onClick={basculer}
        data-assistant-entete
        data-ouvert={retenu.ouvert ? 'oui' : 'non'}
        aria-expanded={retenu.ouvert}
        aria-label={libelle}
      >
        {travaille && !retenu.ouvert ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
        {!retenu.ouvert && questions > 0 ? (
          <span aria-hidden className={cn(CLASSE_POINT_DE_BOUTON, 'bg-warning')} data-assistant-question />
        ) : null}
      </Button>
    </Tooltip>
  );
}
