import * as React from 'react';
import { BAS_CHAT_TELEPHONE, DROITE_DE_JARVIS, dernieresBulles } from '@beluga/shared';
import { BAS_DES_RONDS } from '@/components/rangee-des-ronds';
import { Markdown } from '@/lib/markdown';
import { Check, ChevronDown, ChevronUp, Loader2, MicOff, PanelRight, Square, Volume2, X } from '@/components/ui/icones';
import { IconeTroisBarres, OndesDuDirect } from '@/components/ondes-de-voix';
import { EncadreDAction } from '@/components/jarvis-a-l-ecran';
import { Tooltip, ZoneDefilement, buttonVariants } from '@/components/ui';
import type { TourDuDirect } from '@/lib/direct-codex';
import { useAgentDeLAssistant } from '@/lib/assistant-global';
import { activerLeSonDuDirect, arreterJarvis, basculerLaSourdine, basculerLesBulles, parlerAJarvis, useBullesRepliees, useDirectVu } from '@/lib/etat-vocal';
import { cn } from '@/lib/utils';
import { useMorphingDuBord, useSurfaceDeJarvis } from '@/lib/morphing-du-bord';
import { t } from '@/lib/langue';

/*
 * LA VOIX DANS LE CHAMP D'ÉCRITURE (carte « Mode voix Jarvis dans le champ d'écriture », 17/11/2026).
 *
 * - Le BOUTON VOIX remplace le micro de dictée dans TOUS les champs d'écriture, à sa place exacte (juste avant
 *   l'envoi). Son icône est celle des trois barres petite-grande-petite (`IconeTroisBarres`), jamais les six barres
 *   « vibration » (`AudioLines`, rejetée). Il ouvre la conversation vocale avec l'agent de CE champ.
 * - Pendant la conversation, le `Chat` de cet agent remplace son champ par la ZONE VOCALE : au-dessus, une pile de
 *   BULLES FLOTTANTES (toute la session, une courte phrase par prise de parole, vous à droite, Jarvis à gauche, posées
 *   sur un voile par-dessus le fil sans le décaler, les plus hautes en fondu) ; dessous, les ondes avec Muet et
 *   Arrêter. Les phrases n'entrent pas dans le fil ; ce que Jarvis PRODUIT (carte, image, document) y entre.
 * - À l'arrêt, Jarvis rédige la synthèse : il l'annonce dans une DERNIÈRE bulle de la pile (les boutons restent en
 *   place) ; elle s'ajoute au brouillon du champ.
 */

/** Le bouton voix d'un champ d'écriture : il ouvre la conversation vocale avec l'agent de ce champ. */
export function BoutonVoixDuChamp({ agentId, disabled }: { agentId: string | undefined; disabled?: boolean }) {
  const assistant = useAgentDeLAssistant();
  const direct = useDirectVu();
  const occupe = !!agentId && direct.redaction === agentId;
  return (
    <button
      type="button"
      data-parler-a-l-agent
      /* Le repère historique de l'assistant, lu par les contrôles de la voix : seul SON champ le porte. */
      data-parler-a-jarvis={agentId && agentId === assistant ? '' : undefined}
      aria-label="Parler à Jarvis"
      title={t('Parler à Jarvis')}
      disabled={!agentId || disabled || occupe}
      onClick={() => agentId && parlerAJarvis(agentId === assistant ? null : agentId)}
      className={cn(buttonVariants({ variant: 'doux', size: 'pastille-champ' }), 'shrink-0 sm:bg-controle sm:hover:bg-fond-survol')}
    >
      <IconeTroisBarres className="scale-[0.8]" />
    </button>
  );
}

/** La conversation vocale (ou sa synthèse en cours) porte-t-elle sur cet agent ? Alors son champ cède la place. */
export function useZoneVocale(agentId: string | undefined): React.ReactNode | undefined {
  const direct = useDirectVu();
  if (!agentId) return undefined;
  const enVoix = direct.etat !== 'eteint' && direct.agentId === agentId;
  if (!enVoix && direct.redaction !== agentId) return undefined;
  return <ZoneVocale />;
}

/**
 * LE VOLET DE L'ASSISTANT ↔ LA BULLE VOCALE (carte « Raccourcis libres et Jarvis vocal », 17/11/2026, maquette #d1f57) :
 * le TROISIÈME bouton rond du pied vocal, icône fenêtre. Dans la bulle, il DÉPLIE la conversation (le volet s'ouvre) ;
 * dans le volet de l'assistant, il la REPLIE (le volet se ferme, la bulle revient). Posé par le module de voix
 * (`voix-assistant.tsx`), qui seul sait ouvrir le volet : ici, une simple porte.
 */
let basculeDuVolet: ((ouvrir: boolean) => void) | null = null;
export function poserLaBasculeDuVolet(bascule: ((ouvrir: boolean) => void) | null): void {
  basculeDuVolet = bascule;
}

/** Le temps où l'encadré d'une action FINIE reste lu au-dessus du champ, hors conversation vocale. */
const ACTION_LUE_APRES_LA_FIN_MS = 8000;

/**
 * JARVIS AGIT À L'ÉCRAN SANS CONVERSATION VOCALE (18/11/2026) : l'assistant écrit aussi peut jouer un plan à l'écran
 * (`assistant_ecran`). Son encadré « Jarvis agit sur l'écran » — gestes cochés un à un, « Reprendre » et « Annuler »
 * après un arrêt — n'avait alors AUCUNE place : la pile des bulles ne vivait que dans la zone vocale. Il flotte
 * désormais au-dessus du champ de l'assistant, comme une bulle, tant que l'action vit et 8 s après sa fin.
 */
export function useActionAuDessusDuChamp(agentId: string | undefined): React.ReactNode {
  const direct = useDirectVu();
  const assistant = useAgentDeLAssistant();
  const derniere = React.useMemo(() => [...direct.fil].reverse().find((tour) => tour.action), [direct.fil]);
  const vivante = !!derniere?.action && (derniere.action.statut === 'en-cours' || derniere.action.statut === 'arretee');
  const cle = derniere?.action ? `${derniere.action.id}:${derniere.action.statut}` : null;
  const [lueJusquA, setLueJusquA] = React.useState<{ cle: string; jusqua: number } | null>(null);
  React.useEffect(() => {
    if (!cle || vivante) return;
    const jusqua = Date.now() + ACTION_LUE_APRES_LA_FIN_MS;
    setLueJusquA({ cle, jusqua });
    const minuterie = window.setTimeout(() => setLueJusquA((avant) => (avant?.cle === cle ? null : avant)), ACTION_LUE_APRES_LA_FIN_MS);
    return () => window.clearTimeout(minuterie);
  }, [cle, vivante]);
  if (!agentId || agentId !== assistant || !derniere) return null;
  // En voix (ou pendant la synthèse), la zone vocale porte déjà toute la pile.
  if (direct.etat !== 'eteint' || direct.redaction) return null;
  if (!vivante && lueJusquA?.cle !== cle) return null;
  return (
    <div data-action-au-dessus-du-champ className="relative h-0">
      <BullesDuDirect fil={[derniere]} />
    </div>
  );
}

function ZoneVocale() {
  const direct = useDirectVu();
  const assistant = useAgentDeLAssistant();
  const redaction = direct.etat === 'eteint' && !!direct.redaction;
  // Dans le volet de l'assistant seulement : le bouton fenêtre y replie la conversation en bulle.
  const deLAssistant = !!assistant && (direct.agentId ?? direct.redaction) === assistant;
  return (
    <div data-zone-vocale className="relative flex flex-col">
      <BullesDuDirect fil={direct.fil} recapitulatif={redaction} repliable />
      <PiedVocal fenetre={deLAssistant ? 'replier' : undefined} enRedaction={redaction} />
    </div>
  );
}

/**
 * LE PIED EN MODE VOIX (carte « Jarvis : volet, voix et rapidité », capture #698f, maquette #115d) : à la place de la
 * zone d'écriture, les ondes qui suivent les voix — JAUNES quand vous parlez, BLEUES quand Jarvis parle — et, centrés
 * dessous, DEUX boutons ronds en icône seule : Muet (le micro se tait, la conversation continue) et Arrêter (la
 * conversation se ferme, la synthèse s'écrit puis la zone d'écriture revient).
 */
export function PiedVocal({
  fenetre,
  retenirLeCercle,
  enRedaction,
}: { fenetre?: 'deplier' | 'replier'; retenirLeCercle?: boolean; enRedaction?: boolean } = {}) {
  const direct = useDirectVu();
  const enConnexion = direct.etat === 'connexion';
  return (
    <div data-pied-vocal data-etat-direct={direct.etat} className="flex shrink-0 flex-col items-center gap-2.5 px-4 pb-4 pt-3">
      {/* Le cercle tourne tant que Jarvis n'écoute pas ; à l'écoute réelle, il se transforme d'un seul trait en onde. */}
      {/* Pendant que le bouton du bord se transforme en bulle, le cercle tourne encore : l'onde naît une fois la bulle là. */}
      <OndesDuDirect lecteur={direct.lecteur} connexion={enConnexion || !!retenirLeCercle} sansMorphing={!!direct.erreur || direct.etat === 'refusee' || direct.etat === 'erreur'} />
      {direct.erreur ? (
        <p className="w-full text-center text-[12.5px] leading-snug text-danger" data-erreur-vocale>
          {direct.erreur}
        </p>
      ) : enConnexion ? (
        <p className="w-full text-center text-[12.5px] text-muted">{t('Jarvis arrive…')}</p>
      ) : direct.sonBloque ? (
        <button
          type="button"
          data-jarvis-activer-son
          onClick={activerLeSonDuDirect}
          className="inline-flex items-center gap-1.5 rounded-full bg-raised px-3 py-1.5 text-[12.5px] text-text transition-colors hover:bg-fond-survol"
        >
          <Volume2 className="h-3.5 w-3.5" />
          {t('Toucher pour entendre Jarvis')}
        </button>
      ) : null}
      <div className="flex items-center justify-center gap-5">
        <Tooltip label={direct.sourdine ? t('Rétablir le micro') : t('Couper le micro')}>
          <button
            type="button"
            data-jarvis-micro
            aria-pressed={direct.sourdine}
            aria-label={direct.sourdine ? 'Rétablir le micro' : 'Couper le micro'}
            disabled={enRedaction}
            onClick={basculerLaSourdine}
            className={cn(
              'grid h-11 w-11 place-items-center rounded-full transition-colors disabled:opacity-40',
              direct.sourdine ? 'bg-text text-bg' : 'bg-raised text-text hover:bg-fond-survol',
            )}
          >
            <MicOff className="h-[18px] w-[18px]" />
          </button>
        </Tooltip>
        <Tooltip label={t('Arrêter et rédiger la synthèse')}>
          <button
            type="button"
            data-jarvis-raccrocher
            aria-label="Arrêter Jarvis"
            disabled={enRedaction}
            onClick={arreterJarvis}
            className="grid h-11 w-11 place-items-center rounded-full bg-raised text-text transition-colors hover:bg-fond-survol disabled:opacity-40"
          >
            <Square className="h-4 w-4 fill-current" />
          </button>
        </Tooltip>
        {fenetre ? (
          <Tooltip label={fenetre === 'deplier' ? t('Ouvrir la conversation') : t('Replier la conversation')}>
            <button
              type="button"
              data-jarvis-deplier={fenetre}
              aria-label={fenetre === 'deplier' ? 'Ouvrir la conversation' : 'Replier la conversation'}
              aria-expanded={fenetre === 'replier'}
              onClick={() => basculeDuVolet?.(fenetre === 'deplier')}
              className="grid h-11 w-11 place-items-center rounded-full bg-raised text-text transition-colors hover:bg-fond-survol"
            >
              <PanelRight className="h-[18px] w-[18px]" />
            </button>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}

/** La largeur de la bulle vocale sur ordinateur. */
const LARGEUR_DE_LA_BULLE = 340;
/** L'air entre la bulle et le menu du bas (téléphone). */
const AIR_DE_LA_BULLE = 12;

/**
 * LA BULLE VOCALE (carte « Raccourcis libres et Jarvis vocal », 17/11/2026, maquette #d1f57) : le toucher du bouton du
 * bord (ou le raccourci clavier) ouvre SEULEMENT elle, pas le volet. Une carte ronde posée en bas à droite (ordinateur) :
 * en tête « Jarvis · je t'écoute », puis le pied vocal — le cercle qui devient onde, Muet, Arrêter et le bouton fenêtre
 * qui déplie la conversation dans le volet. Les bulles de l'échange flottent au-dessus, sans voile. Pendant la synthèse
 * de fin, elle le dit ; la synthèse reçue ouvre le volet sur le champ rempli (`voix-assistant.tsx`).
 */
export function BulleVocale({ nom, telephone }: { nom: string; telephone: boolean }) {
  const direct = useDirectVu();
  const redaction = direct.etat === 'eteint' && !!direct.redaction;
  /* LE BOUTON DU BORD DEVIENT CETTE BULLE, ET ELLE REDEVIENT BOUTON (17/11/2026, illustration #0666) : `lib/morphing-du-bord.ts`. */
  const racine = React.useRef<HTMLDivElement | null>(null);
  useSurfaceDeJarvis('bulle', racine);
  const morphing = useMorphingDuBord();
  /* SUR TÉLÉPHONE, AU-DESSUS DU MENU DU BAS : sa hauteur réelle (zone sûre comprise) se mesure, la constante du volet
     ne suffit pas (capture du 17/11/2026 : la bulle couvrait « Tableaux » et le bouton +). */
  const [basTelephone, setBasTelephone] = React.useState(BAS_CHAT_TELEPHONE);
  React.useLayoutEffect(() => {
    if (!telephone) return;
    const mesurer = () => {
      const menu = document.querySelector('nav[data-menu-bas]')?.getBoundingClientRect();
      setBasTelephone(menu && menu.height > 0 && menu.top > 0 ? Math.round(window.innerHeight - menu.top + AIR_DE_LA_BULLE) : BAS_CHAT_TELEPHONE);
    };
    mesurer();
    window.addEventListener('resize', mesurer);
    return () => window.removeEventListener('resize', mesurer);
  }, [telephone]);
  const place: React.CSSProperties = telephone
    ? { left: 16, right: 16, bottom: basTelephone }
    : /* SUR ORDINATEUR, TOUJOURS EN BAS À DROITE (décision de l'utilisateur, 17/11/2026), où que soit le bouton : collée
         en bas à la hauteur du rond du terminal, juste à sa gauche. Le bouton, lui, s'y transforme et disparaît. */
      { right: DROITE_DE_JARVIS, width: LARGEUR_DE_LA_BULLE, bottom: BAS_DES_RONDS };
  const etat = redaction
    ? t('rédige le récapitulatif…')
    : direct.etat === 'ecoute'
      ? t('je t’écoute')
      : null; // « Jarvis arrive… » se lit déjà sous le cercle de chargement
  return (
    <div
      ref={racine}
      data-bulle-vocale={direct.etat}
      data-au-dessus-de-tout
      className="pointer-events-auto fixed z-[56] flex flex-col rounded-[22px] bg-surface shadow-2xl"
      style={{ ...place, maxWidth: 'calc(100vw - 32px)' }}
    >
      <BullesDuDirect fil={direct.fil} sansVoile recapitulatif={redaction} repliable />
      <div className="flex items-center gap-2 px-4 pt-3 text-[13px]">
        <IconeTroisBarres className="shrink-0 scale-[0.6] text-text" vivante={direct.etat === 'ecoute'} />
        <span className="font-medium text-text">{nom}</span>
        {etat ? <span className="min-w-0 truncate text-muted">· {etat}</span> : null}
      </div>
      <PiedVocal fenetre="deplier" retenirLeCercle={morphing === 'ouverture'} enRedaction={redaction} />
    </div>
  );
}

/** La part de la hauteur de la conversation que la pile peut prendre au plus. */
const PART_DE_LA_HAUTEUR = 0.7;

/**
 * LA PILE DE BULLES FLOTTE AU-DESSUS DU PIED VOCAL (maquette #13c1 validée, 17/11/2026) : hors du flux, elle ne pousse
 * plus le fil ; posée sur un léger voile du fond, elle monte au plus aux 70 % de la conversation, défile seule jusqu'à
 * la dernière bulle (sauf si l'on est remonté à la main), et les plus hautes s'effacent en fondu (masque). Toute la
 * session y reste. Le conteneur et le voile laissent passer le pointeur : le fil derrière défile et se clique.
 */
export function BullesDuDirect({
  fil,
  sansVoile,
  recapitulatif,
  repliable,
}: {
  fil: readonly TourDuDirect[];
  sansVoile?: boolean;
  /** La synthèse de fin se rédige : Jarvis l'annonce dans une DERNIÈRE bulle de la pile (décision du 17/11/2026). */
  recapitulatif?: boolean;
  /** Le chevron centré sous la pile la replie ou la rouvre (18/11/2026) : la conversation vocale seulement. */
  repliable?: boolean;
}) {
  const bulles = dernieresBulles(fil);
  const replieesPartout = useBullesRepliees();
  const repliees = !!repliable && replieesPartout;
  const pileRef = React.useRef<HTMLDivElement | null>(null);
  const enveloppeRef = React.useRef<HTMLDivElement | null>(null);
  const colleEnBas = React.useRef(true);
  const [hauteurMax, setHauteurMax] = React.useState<number | null>(null);

  // 70 % de la conversation : la colonne qui porte le fil et son pied.
  React.useLayoutEffect(() => {
    const enveloppe = enveloppeRef.current;
    // Le pied de la conversation : celui de l'assistant (`data-pied-du-fil`) ou celui de la page d'une carte.
    const conversation = enveloppe?.closest('[data-pied-du-fil], [data-pied-de-conversation]')?.parentElement ?? null;
    const mesurer = () => {
      const h = conversation?.clientHeight || window.innerHeight;
      setHauteurMax(Math.round(h * PART_DE_LA_HAUTEUR) - (enveloppe?.parentElement?.offsetHeight ?? 0));
    };
    mesurer();
    if (!conversation || typeof ResizeObserver === 'undefined') return;
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(conversation);
    return () => observateur.disconnect();
  }, [bulles.length > 0 || !!recapitulatif]);

  // La dernière bulle reste en vue ; le fondu ne s'allume que quand la pile est assez haute pour avoir un « haut ».
  React.useLayoutEffect(() => {
    const pile = pileRef.current;
    if (!pile) return;
    if (colleEnBas.current) pile.scrollTop = pile.scrollHeight;
    const haute = pile.scrollHeight > pile.clientHeight + 4 || pile.clientHeight > 220;
    pile.style.maskImage = haute ? 'linear-gradient(to bottom, transparent 0, #000 42%)' : '';
    pile.style.webkitMaskImage = pile.style.maskImage;
    pile.dataset.fondu = haute ? '' : 'non';
  });

  if (!bulles.length && !recapitulatif) return null;
  /* LE CHEVRON (décision du 18/11/2026, captures #2901f et #0750) : un petit bouton rond, CENTRÉ entre la pile et le
     panneau vocal, qui replie les bulles (vers le bas) ou les rouvre (vers le haut). Sur téléphone, elles se replient
     d'elles-mêmes quand Jarvis agit (`voix-assistant.tsx`). Seul le bouton prend les appuis : la ligne les laisse passer. */
  const chevron = repliable ? (
    <div className="pointer-events-none relative flex justify-center pb-1.5">
      <Tooltip label={repliees ? t('Afficher les bulles') : t('Replier les bulles')}>
        <button
          type="button"
          data-replier-les-bulles={repliees ? 'repliees' : 'ouvertes'}
          aria-label={repliees ? t('Afficher les bulles') : t('Replier les bulles')}
          aria-expanded={!repliees}
          onClick={basculerLesBulles}
          className="pointer-events-auto grid h-8 w-8 place-items-center rounded-full bg-raised text-text shadow-[0_1px_3px_rgb(0_0_0/0.12)] transition-colors hover:bg-fond-survol"
        >
          {repliees ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </Tooltip>
    </div>
  ) : null;
  if (repliees) {
    return (
      <div ref={enveloppeRef} data-pile-flottante data-bulles-repliees className="pointer-events-none absolute inset-x-0 bottom-full z-20">
        {chevron}
      </div>
    );
  }
  return (
    <div
      ref={enveloppeRef}
      data-pile-flottante
      className="pointer-events-none absolute inset-x-0 bottom-full z-20"
    >
      {/* Le voile : le fil s'estompe derrière les bulles, plein juste au-dessus des ondes. La bulle vocale n'en a pas :
          ses bulles flottent sur l'écran (maquette #d1f57). */}
      {sansVoile ? null : <div
        data-voile-des-bulles
        aria-hidden
        className="absolute inset-0"
        style={{ background: 'linear-gradient(to bottom, hsl(var(--bg) / 0) 0%, hsl(var(--bg) / 0.9) 30%, hsl(var(--bg) / 0.96) 60%, hsl(var(--bg)) 100%)' }}
      />}
      <ZoneDefilement
        ref={pileRef}
        data-bulles-du-direct={bulles.length}
        aria-live="polite"
        voile={false}
        classeEnveloppe="relative"
        onScroll={(e) => {
          const el = e.currentTarget;
          colleEnBas.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        /* AUCUN RETRAIT SUR LES CÔTÉS (17/11/2026) : la pile a la largeur du composant qu'elle surmonte ; les bulles de
           Jarvis touchent son bord gauche, les vôtres son bord droit. */
        className="flex flex-col gap-1.5 px-0 pb-1.5 pt-6"
        style={{ maxHeight: hauteurMax ?? undefined }}
      >
        {/* LA LIGNE D'UNE BULLE LAISSE PASSER LES APPUIS (18/11/2026) : elle a la largeur du composant (bulles collées
            aux bords), seule la bulle elle-même les prend — le fil derrière reste cliquable à côté d'elle. */}
        {bulles.map((tour) => (
          <div key={tour.id} className="pointer-events-none animate-slide-up">
            <Bulle tour={tour} />
          </div>
        ))}
        {recapitulatif ? (
          <div className="pointer-events-none animate-slide-up">
            <BulleDuRecapitulatif />
          </div>
        ) : null}
      </ZoneDefilement>
      {chevron}
    </div>
  );
}

/** La classe d'une bulle de Jarvis : le bleu de Jarvis, texte blanc en sombre et noir en clair (jeton par palette). */
const CLASSE_BULLE_DE_JARVIS = 'rounded-bl-sm bg-[hsl(var(--bulle-jarvis))] text-[hsl(var(--bulle-jarvis-texte))]';

/** La dernière bulle pendant la synthèse : ce que fait Jarvis, et où arrivera le récapitulatif. */
function BulleDuRecapitulatif() {
  return (
    <div data-bulle="recapitulatif" className="flex justify-start">
      <div className={cn('pointer-events-auto flex w-fit min-w-0 max-w-[90%] items-start gap-2 rounded-lg px-3 py-1.5 text-[13px] leading-snug shadow-[0_1px_3px_rgb(0_0_0/0.08)]', CLASSE_BULLE_DE_JARVIS)}>
        <Loader2 className="mt-[3px] h-3 w-3 shrink-0 animate-spin opacity-80" />
        <p className="min-w-0 break-words">{t('Je rédige le récapitulatif de notre échange : il sera posé dans ton champ de demande, sans être envoyé.')}</p>
      </div>
    </div>
  );
}

function Bulle({ tour }: { tour: TourDuDirect }) {
  if (tour.activite) {
    const { etat, libelle } = tour.activite;
    return (
      <div data-bulle="activite" data-activite-du-direct={etat} className="pointer-events-auto flex w-fit max-w-full min-w-0 items-center gap-2 py-0.5 text-[12px] text-muted">
        {etat === 'en-cours' ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-teinte" />
        ) : etat === 'echec' ? (
          <X className="h-3 w-3 shrink-0 text-danger" />
        ) : (
          <Check className="h-3 w-3 shrink-0" />
        )}
        <span className="min-w-0 truncate">{libelle}</span>
      </div>
    );
  }
  if (tour.action) {
    return (
      <div data-bulle="action" className="pointer-events-auto text-[12.5px]">
        <EncadreDAction action={tour.action} />
      </div>
    );
  }
  if (tour.tache) {
    const etat = tour.tache.etat === 'lancee' ? t('Lancée') : tour.tache.etat === 'creee' ? t('Dans « Planifié »') : t('Création en cours…');
    return (
      <div data-bulle="tache" data-tache-du-direct={tour.tache.etat} className="pointer-events-auto w-fit max-w-[90%] rounded-lg rounded-bl-sm bg-controle px-3 py-1.5 text-[12.5px] shadow-[0_1px_3px_rgb(0_0_0/0.08)]">
        <p className="truncate font-medium text-text">{tour.tache.titre}</p>
        <p className={cn('truncate text-[11.5px]', tour.tache.etat === 'proposee' ? 'text-muted' : 'text-teinte')}>{etat}</p>
      </div>
    );
  }
  const vous = tour.role === 'user';
  /* LA RÉPONSE ENTIÈRE, ÉCRITE EN DIRECT (17/11/2026 : « je veux le voir s'écrire devant moi, pas juste une ligne ») :
     le tour en cours s'écrit EN ENTIER au fil de la voix ; finalisé, il se lit mis en forme comme dans le fil (gras,
     listes, tableaux). 90 % de la largeur au plus ; Jarvis en bleu, vous dans votre gris. */
  return (
    <div data-bulle={vous ? 'vous' : 'jarvis'} data-tour-fil data-role={tour.role} data-tour-final={tour.final ? '' : undefined} className={cn('flex', vous ? 'justify-end' : 'justify-start')}>
      <div className={cn('pointer-events-auto w-fit max-w-[90%] min-w-0 rounded-lg px-3 py-1.5 shadow-[0_1px_3px_rgb(0_0_0/0.08)]', vous ? 'rounded-br-sm bg-raised text-text' : CLASSE_BULLE_DE_JARVIS)}>
        {tour.final ? (
          <div data-texte-entier className="min-w-0 break-words">
            <Markdown content={tour.texte} enTexte className="texte-de-bulle" />
          </div>
        ) : (
          <p data-texte-en-direct className="whitespace-pre-wrap break-words text-[13px] leading-snug">{tour.texte.trim()}</p>
        )}
      </div>
    </div>
  );
}
