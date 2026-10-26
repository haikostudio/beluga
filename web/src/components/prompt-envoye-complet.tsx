import * as React from 'react';
import { Check, ChevronRight, Copy } from 'lucide-react';
import {
  EntreeJournal,
  PartieDuPromptEnvoye,
  SentContextEtat,
  TourDuParcours,
  messageDeLaDemande,
  partiesDuPromptEnvoye,
} from '@beluga/shared';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';
import { ZoneDefilement } from '@/components/ui';

/**
 * LE TEXTE ENTIER DU PROMPT, DÉPLIÉ SUR PLACE.
 *
 * Un lien discret sous la demande — jamais un tiroir, jamais une page — qui
 * montre exactement ce qui est parti au moteur : les consignes générales, puis
 * le message. La partie relue au cache par le moteur est surlignée d'un fond
 * gris plus marqué et porte la mention « relu au cache » : ni chiffre de
 * jetons, ni couleur nouvelle.
 *
 * Il ne dépend NI du fil des recherches (masqué sur une carte), NI de la
 * mémoire consultée : il vaut pour tout message qui porte un `sentContext`.
 * Replié par défaut, le texte n'est monté qu'à l'ouverture.
 */
export function LienPromptEnvoye({ contexte, className }: { contexte: SentContextEtat; className?: string }) {
  const [ouvert, setOuvert] = React.useState(false);
  return (
    <div data-prompt-complet className={cn('min-w-0 max-w-full py-1', className ?? 'w-[min(92%,860px)]')}>
      <button
        type="button"
        data-prompt-complet-lien
        aria-expanded={ouvert}
        onClick={() => setOuvert((v) => !v)}
        className="inline-flex items-center gap-1 rounded px-1.5 sm:px-1 py-1 sm:py-0.5 text-[12px] text-faint transition-colors hover:text-text"
      >
        <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform', ouvert && 'rotate-90')} aria-hidden="true" />
        <span>{ouvert ? t('Masquer le prompt envoyé') : t('Voir le prompt envoyé')}</span>
      </button>
      {ouvert ? <PromptEnvoyeDeplie contexte={contexte} /> : null}
    </div>
  );
}

function PromptEnvoyeDeplie({ contexte }: { contexte: SentContextEtat }) {
  const parties = React.useMemo(() => partiesDuPromptEnvoye(contexte), [contexte]);
  return (
    <div data-prompt-complet-corps className="mt-1 min-w-0 space-y-3 pl-5">
      {parties.map((partie) => (
        <PartieDuPrompt key={partie.cle} partie={partie} />
      ))}
    </div>
  );
}

function PartieDuPrompt({ partie }: { partie: PartieDuPromptEnvoye }) {
  const relu = partie.etat === 'relu';
  const mention =
    partie.etat === 'relu'
      ? t('relu au cache')
      : partie.etat === 'ecrit'
        ? t('mise en cache pour les tours suivants')
        : null;
  return (
    <section data-partie-prompt={partie.cle} data-cache={partie.etat} className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <h4 className="shrink-0 text-[12px] font-medium text-muted">{t(partie.titre)}</h4>
        {mention ? <span className="min-w-0 truncate text-[11.5px] text-faint">{mention}</span> : null}
        <span className="flex-1" />
        {partie.conserve ? <BoutonCopierLaPartie texte={partie.texte} /> : null}
      </div>
      {partie.note ? <p className="mt-0.5 text-[11.5px] leading-snug text-faint">{t(partie.note)}</p> : null}
      {partie.conserve ? (
        <ZoneDefilement
          fond={relu ? 'hsl(var(--raised))' : undefined}
          hauteur={24}
          classeEnveloppe="mt-1 max-h-80"
          data-surligne={relu ? 'oui' : 'non'}
          className={cn('rounded-lg px-3 py-2', relu && 'bg-raised')}
        >
          <pre
            data-texte-du-prompt
            className="m-0 select-text whitespace-pre-wrap break-words font-sans text-[12.5px] leading-relaxed text-muted [overflow-wrap:anywhere]"
          >
            {partie.texte}
          </pre>
        </ZoneDefilement>
      ) : (
        <p className="mt-1 text-[12px] text-faint">
          {t('Texte non conservé : il a été retiré pour borner le disque.')}
        </p>
      )}
    </section>
  );
}

function BoutonCopierLaPartie({ texte }: { texte: string }) {
  const [copie, setCopie] = React.useState(false);
  const copier = async () => {
    try {
      await navigator.clipboard.writeText(texte);
    } catch {
      // Presse-papiers refusé (page non sécurisée) : un champ caché, le temps d'une copie.
      const zone = document.createElement('textarea');
      zone.value = texte;
      zone.style.position = 'fixed';
      zone.style.opacity = '0';
      document.body.appendChild(zone);
      zone.select();
      document.execCommand('copy');
      zone.remove();
    }
    setCopie(true);
    window.setTimeout(() => setCopie(false), 1800);
  };
  return (
    <button
      type="button"
      onClick={() => void copier()}
      className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 sm:px-1 py-1 sm:py-0.5 text-[11.5px] text-faint transition-colors hover:text-text"
    >
      {copie ? <Check className="h-3 w-3" aria-hidden="true" /> : <Copy className="h-3 w-3" aria-hidden="true" />}
      {copie ? t('Copié') : t('Copier')}
    </button>
  );
}

/**
 * LE MESSAGE D'UN TOUR D'UNE CARTE. La conversation d'une carte réunit les
 * messages de tous ses agents (`state.cardMessages`) ; le repli sur les
 * messages de l'agent couvre un écran qui n'a pas encore reçu la conversation.
 */
function useMessageDeLaCarte(cardId: string, agentId: string | undefined, messageId: string | undefined) {
  const state = useApp();
  if (!messageId) return undefined;
  const dansLaCarte = state.cardMessages[cardId]?.messages.find((m) => m.id === messageId);
  if (dansLaCarte) return dansLaCarte;
  return agentId ? state.messages[agentId]?.find((m) => m.id === messageId) : undefined;
}

/**
 * LE LIEN D'UNE CARTE, SOUS LA BULLE DE LA DEMANDE. Sur une carte, la
 * conversation est son parcours : on retrouve le message d'origine par
 * l'identifiant que l'entrée « Demande » du journal a gardé.
 */
export function LienPromptDeLaDemande({ entree, className }: { entree: EntreeJournal; className?: string }) {
  const message = useMessageDeLaCarte(entree.cardId, entree.agentId, messageDeLaDemande(entree.donnees));
  if (!message?.sentContext) return null;
  return <LienPromptEnvoye contexte={message.sentContext} className={className} />;
}

/**
 * LE LIEN D'UN TOUR LANCÉ PAR UN BOUTON : son texte envoyé est porté par la
 * réponse de l'agent, jamais par une bulle de demande.
 */
function LienDuTour({ cardId, tour, className }: { cardId: string; tour: TourDuParcours; className?: string }) {
  const message = useMessageDeLaCarte(cardId, tour.agentId, tour.tourId);
  if (!message?.sentContext) return null;
  return <LienPromptEnvoye contexte={message.sentContext} className={className} />;
}

/**
 * LES LIENS DES TOURS LANCÉS PAR UN BOUTON, posés dans le point où le tour
 * laisse sa première trace.
 */
export function LiensDesPromptsDuPoint({
  cardId,
  tours,
  className,
}: {
  cardId: string;
  tours: TourDuParcours[];
  className?: string;
}) {
  return (
    <div className="flex flex-col" data-prompts-du-point>
      {tours.map((tour) => (
        <LienDuTour key={tour.tourId} cardId={cardId} tour={tour} className={className} />
      ))}
    </div>
  );
}
