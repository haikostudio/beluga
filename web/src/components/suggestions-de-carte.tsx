import * as React from 'react';
import { ChevronDown, LayoutGrid, X } from 'lucide-react';
import type { GroupeDeSuggestions, Message } from '@beluga/shared';
import { ZoneDefilement } from '@/components/ui';
import { EnTeteDePanneau, Panneau } from '@/components/panneau';
import { BarreDeFusion, BoutonFusionner, VignetteProposition, useFusionDePropositions } from '@/components/propositions';
import { ProposalChip } from '@/components/message-view';
import { t } from '@/lib/langue';
import {
  consommerLaDemande,
  fermerLesSuggestions,
  propositionsEnAttenteDuFil,
  useNouvelleSuggestion,
  useSuggestionsDeCarte,
  voirLesSuggestions,
} from '@/lib/suggestions-de-carte';
import { cn } from '@/lib/utils';

type Proposition = Message['proposals'][number];

interface Suggestion {
  message: Message;
  proposal: Proposition;
}

/**
 * LES CARTES QUE L'AGENT DE CETTE CARTE PROPOSE : celles qui attendent un clic
 * et celles déjà acceptées. Les refusées et les réunies n'ont plus rien à
 * montrer, pas plus que celles intégrées à la carte (envoyées en message à son
 * agent). Une même proposition portée par deux messages (le tour en direct,
 * puis son enregistrement) ne compte qu'une fois.
 */
export function suggestionsDeLaCarte(messages: Message[]): Suggestion[] {
  const vues = new Set<string>();
  const entrees: Suggestion[] = [];
  for (const message of messages) {
    for (const proposal of message.proposals ?? []) {
      if (proposal.decision === 'refused' || proposal.decision === 'merged' || proposal.decision === 'integrated' || vues.has(proposal.id)) continue;
      vues.add(proposal.id);
      entrees.push({ message, proposal });
    }
  }
  return entrees;
}

/**
 * LES SUGGESTIONS GROUPÉES PAR MESSAGE, pour le repère « N cartes suggérées
 * ici » du fil (`rangerLesSuggestions`, `shared`).
 */
export function groupesDeSuggestions(messages: Message[]): GroupeDeSuggestions[] {
  const groupes = new Map<string, GroupeDeSuggestions>();
  for (const { message, proposal } of suggestionsDeLaCarte(messages)) {
    const groupe = groupes.get(message.id) ?? { messageId: message.id, at: message.createdAt, ids: [] };
    groupe.ids.push(proposal.id);
    groupes.set(message.id, groupe);
  }
  return [...groupes.values()];
}

/**
 * LE BLOC EST-IL FERMÉ PAR SA CROIX ? Lu par la page de la carte pour le
 * retirer du pied. Une proposition NOUVELLE le rouvre : rien de ce qui attend
 * une décision ne reste caché.
 */
export function useSuggestionsFermees(cardId: string | undefined, messages: Message[]): boolean {
  const { fermee } = useSuggestionsDeCarte(cardId);
  useNouvelleSuggestion(propositionsEnAttenteDuFil(messages), () => {
    if (cardId) voirLesSuggestions(cardId);
  });
  return fermee;
}

/** La largeur d'une carte de la rangée : fixe, pour que la rangée défile au lieu de se plier en lignes. */
const LARGEUR_D_UNE_CARTE = 'w-[min(320px,80vw)]';

/**
 * « SUGGESTION DE CARTE » (demande du 23/10/2026) : le bloc du pied où les
 * cartes proposées dans la conversation d'une carte se rangent EN RANGÉE
 * HORIZONTALE, au même niveau et dans le même style que « Ce que l'agent a vu »
 * (`BandeDesCaptures`) — un en-tête (icône, titre, chevron de repli) puis un
 * panneau au fond contrasté. Plus aucune vignette verticale dans le fil.
 *
 * Une carte en attente garde « Créer la carte » ; une carte acceptée garde sa
 * pastille et son bouton, qui suit l'étape réelle de la carte une fois lancée
 * (`ProposalChip`). Toutes les cartes ont la hauteur de la plus haute, le
 * bouton en bas. Une suggestion NOUVELLE déplie le bloc : rien de ce qui
 * attend une décision ne reste caché derrière un pli.
 *
 * LA CROIX FERME LE BLOC EN ENTIER (`fermerLesSuggestions`) ; il revient seul
 * à la prochaine suggestion, ou par le bouton « Voir » du repère posé dans le
 * fil, qui fait aussi défiler la rangée jusqu'aux cartes visées.
 */
export function SuggestionsDeCarte({
  cardId,
  messages,
  replieeDOffice = false,
  onDeplie,
}: {
  cardId: string;
  messages: Message[];
  /** Replié par le pied compact du téléphone ; un tap le rouvre pour cette fois. */
  replieeDOffice?: boolean;
  /** Un tap vient de déplier le bloc : il devient le dernier ouvert du pied. */
  onDeplie?: () => void;
}) {
  const suggestions = suggestionsDeLaCarte(messages);
  /* « FUSIONNER » (demande du 24/10/2026) : la même sélection que le bandeau
     des conversations sans carte, sur les seules suggestions en attente. */
  const fusion = useFusionDePropositions(
    suggestions.filter(({ proposal }) => proposal.decision === 'pending').map(({ message, proposal }) => ({ messageId: message.id, proposal })),
  );
  const [replieeChoisie, setReplieeChoisie] = React.useState(false);
  const [deplieeMalgre, setDeplieeMalgre] = React.useState(false);
  React.useEffect(() => setDeplieeMalgre(false), [replieeDOffice]);

  /* Une proposition JAMAIS VUE déplie le bloc. */
  useNouvelleSuggestion(propositionsEnAttenteDuFil(messages), () => {
    setReplieeChoisie(false);
    setDeplieeMalgre(true);
  });

  /* LE BOUTON « VOIR » DU FIL : déplier, puis amener la rangée sur les cartes
     du groupe et les surligner un instant. */
  const { demande } = useSuggestionsDeCarte(cardId);
  const rangee = React.useRef<HTMLDivElement>(null);
  const [surlignees, setSurlignees] = React.useState<string[]>([]);
  const deplier = React.useRef(onDeplie);
  deplier.current = onDeplie;
  React.useEffect(() => {
    if (!demande) return;
    consommerLaDemande(cardId);
    setReplieeChoisie(false);
    setDeplieeMalgre(true);
    deplier.current?.();
    setSurlignees(demande.ids);
    const image = requestAnimationFrame(() => {
      const cible = rangee.current?.querySelector<HTMLElement>(`[data-suggestion-id="${CSS.escape(demande.proposalId ?? '')}"]`);
      cible?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
    });
    const fin = window.setTimeout(() => setSurlignees([]), 1600);
    return () => {
      cancelAnimationFrame(image);
      window.clearTimeout(fin);
    };
  }, [demande?.n, cardId]);

  if (!suggestions.length) return null;

  const repliee = replieeChoisie || (replieeDOffice && !deplieeMalgre);
  const basculer = () => {
    if (repliee) {
      onDeplie?.();
      setReplieeChoisie(false);
      setDeplieeMalgre(true);
    } else {
      setReplieeChoisie(true);
    }
  };

  return (
    <div className="min-w-0" data-cartes-du-fil={suggestions.length} data-suggestions-repli={repliee ? 'ferme' : 'ouvert'}>
      <EnTeteDePanneau className={cn('flex items-center gap-x-1.5 font-normal', repliee && 'rounded-b-md')} data-suggestions-en-tete="">
        <button
          type="button"
          onClick={basculer}
          aria-expanded={!repliee}
          title={repliee ? t('Déplier les cartes suggérées') : t('Replier les cartes suggérées')}
          className="flex shrink-0 items-center gap-1.5 text-[12.5px] text-muted hover:text-text"
          data-suggestions-bascule=""
        >
          <LayoutGrid className="h-3 w-3 shrink-0" aria-hidden />
          <span className="whitespace-nowrap">{t('Suggestion de carte')}</span>
          <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', repliee && 'rotate-180')} aria-hidden />
        </button>
        <span className="ml-auto flex items-center gap-2">
          {repliee ? null : <BoutonFusionner fusion={fusion} />}
          <button
            type="button"
            onClick={() => fermerLesSuggestions(cardId)}
            title={t('Fermer les suggestions')}
            aria-label={t('Fermer les suggestions')}
            className="flex h-6 sm:h-5 w-6 sm:w-5 shrink-0 items-center justify-center rounded text-muted hover:text-text"
            data-suggestions-fermer=""
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </span>
      </EnTeteDePanneau>
      <Panneau className={cn('px-2 py-1.5', repliee && 'hidden')} data-suggestions-panneau="">
        {/* LA MÊME HAUTEUR POUR TOUTES : la rangée étire ses cartes
            (`items-stretch`), chacune pousse son bouton en bas. */}
        <ZoneDefilement ref={rangee} axe="horizontal" voile className="flex flex-nowrap items-stretch gap-2 pb-1" data-suggestions-rangee="">
          {suggestions.map(({ message, proposal }) => (
            <div
              key={proposal.id}
              className={cn(
                'flex shrink-0 flex-col rounded-md transition-shadow',
                LARGEUR_D_UNE_CARTE,
                surlignees.includes(proposal.id) && 'ring-2 ring-accent',
              )}
              data-suggestion-id={proposal.id}
              data-carte-nee-du-fil={proposal.decision === 'pending' ? undefined : ''}
            >
              {proposal.decision === 'pending' ? (
                <VignetteProposition
                  messageId={message.id}
                  agentId={message.agentId}
                  proposal={proposal}
                  selectionActive={fusion.selectionActive}
                  selectionnee={fusion.selection.includes(proposal.id)}
                  onSelection={() => fusion.basculer(proposal.id)}
                  integrable
                  className="flex-1"
                />
              ) : (
                <ProposalChip proposal={proposal} agentId={message.agentId} etiree />
              )}
            </div>
          ))}
        </ZoneDefilement>
        <BarreDeFusion fusion={fusion} className="mt-1" />
      </Panneau>
    </div>
  );
}
