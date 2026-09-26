/**
 * LA PILE DES MESSAGES PASSAGERS — UN SEUL COMPOSANT POUR LES DEUX VISAGES.
 *
 * Elle vivait tout entière dans `toasts.tsx`, soudée au MAGASIN GÉNÉRAL de
 * l'administration (`client`, `useApp`). L'espace client, qui ne monte rien de
 * ce magasin, s'était donc écrit SA propre pile : en bas à droite, avec sa
 * durée à lui et sans le geste de balayage. Deux places, deux durées, deux
 * comportements pour la même chose.
 *
 * LE DESSIN VIT DONC ICI, SANS MAGASIN. Il reçoit une liste et des gestes ;
 * `toasts.tsx` la lui donne depuis le magasin, la porte client depuis son
 * propre état (`usePileDeMessages`, plus bas). Les deux tiennent la même
 * place — EN HAUT AU CENTRE —, la même durée (`DUREE_MESSAGE_MS`), le même
 * empilement, et les mêmes repères de contrôle (`data-bloc="toasts"`,
 * `data-toast`, `data-toast-fermer`).
 *
 * `z-[100]`, au-dessus de TOUT le reste (`z-50` au plus ailleurs) : un tiroir
 * est posé par un portail Radix, ajouté en fin de `<body>` à son ouverture — à
 * z-index égal, il finirait donc APRÈS les messages dans le document et les
 * recouvrirait, quel que soit l'ordre du JSX.
 */
import * as React from 'react';
import { AlertCircle, Check, Copy, Info, PlugZap, RefreshCw, TriangleAlert, X } from 'lucide-react';
import { DUREE_MESSAGE_MS, heureEtDate, pileAvecMessage } from '@beluga/shared';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/** À partir de combien de pixels glissés vers la gauche, on relâche pour masquer. */
const SEUIL_GLISSEMENT_PX = 80;

/** Ce que la pile a besoin de savoir d'un message — ni plus, ni magasin. */
export interface MessagePassager {
  id: string;
  level: 'info' | 'success' | 'warning' | 'error';
  text: string;
  at: number;
  /**
   * LA CLÉ D'UN MESSAGE PERSISTANT — un ÉTAT qui dure, pas une nouvelle. Il
   * reste affiché tant que sa cause dure, ne se ferme pas tout seul et ne se
   * ferme pas à la main.
   */
  cle?: string;
  /** Depuis quand l'état dure : le message affiche le temps écoulé. */
  depuis?: number;
  /** Le geste offert par le message, quand il y en a un. */
  action?: 'reconnecter';
}

export function PileDeMessages({
  messages,
  onFermer,
  onPause,
  onReprendre,
  onReconnecter,
  onOuvrir,
  attributs,
}: {
  messages: readonly MessagePassager[];
  onFermer: (id: string) => void;
  /** Le survol gèle le compte à rebours de TOUS les messages affichés. */
  onPause?: () => void;
  onReprendre?: () => void;
  /** Le geste du message persistant « lien coupé » — l'administration seule. */
  onReconnecter?: () => void;
  /** Un message cliquable : la porte client y mène à la fiche ou à la discussion. */
  onOuvrir?: (message: MessagePassager) => void;
  /** Des repères de contrôle propres à l'appelant, posés sur chaque message. */
  attributs?: (message: MessagePassager) => Record<string, unknown>;
}) {
  const [enPause, setEnPause] = React.useState(false);

  const surLaPile = React.useCallback(() => {
    setEnPause(true);
    onPause?.();
  }, [onPause]);
  const horsDeLaPile = React.useCallback(() => {
    setEnPause(false);
    onReprendre?.();
  }, [onReprendre]);

  if (!messages.length) return null;

  return (
    <div
      data-bloc="toasts"
      className="pointer-events-none fixed inset-x-0 z-[100] flex flex-col items-center gap-1.5 px-2"
      style={{ top: 'calc(44px + env(safe-area-inset-top) + 0.5rem)' }}
      onMouseEnter={surLaPile}
      onMouseLeave={horsDeLaPile}
      onTouchStart={surLaPile}
      onTouchEnd={horsDeLaPile}
      onTouchCancel={horsDeLaPile}
    >
      {messages.map((message) => (
        <UnMessage
          key={message.id}
          message={message}
          enPause={enPause}
          onFermer={onFermer}
          onReconnecter={onReconnecter}
          onOuvrir={onOuvrir}
          attributs={attributs}
        />
      ))}
    </div>
  );
}

/**
 * LE BOUTON « COPIER » D'UN MESSAGE D'ERREUR : une icône, rien de plus, qui
 * devient une coche le temps de dire que c'est fait. Le presse-papiers moderne
 * n'est servi qu'en contexte sûr (HTTPS ou localhost) : ailleurs, on retombe
 * sur un champ caché et la vieille commande de copie, qui, elle, marche
 * partout — sans quoi un clic resterait sans effet et sans explication.
 */
function BoutonCopier({ texte }: { texte: string }) {
  const [copie, setCopie] = React.useState(false);
  const minuteur = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(minuteur.current), []);

  const copier = async (event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(texte);
    } catch {
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
    window.clearTimeout(minuteur.current);
    minuteur.current = window.setTimeout(() => setCopie(false), 1800);
  };

  return (
    <button
      type="button"
      data-toast-copier
      onClick={copier}
      title={copie ? t('Message copié') : t('Copier ce message')}
      className="flex items-center justify-center p-[11px] opacity-60 transition-opacity hover:opacity-100"
    >
      {copie ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
    </button>
  );
}

function UnMessage({
  message,
  enPause,
  onFermer,
  onReconnecter,
  onOuvrir,
  attributs,
}: {
  message: MessagePassager;
  enPause: boolean;
  onFermer: (id: string) => void;
  onReconnecter?: () => void;
  onOuvrir?: (message: MessagePassager) => void;
  attributs?: (message: MessagePassager) => Record<string, unknown>;
}) {
  const [decalage, setDecalage] = React.useState(0);
  const [enGlissement, setEnGlissement] = React.useState(false);
  const depart = React.useRef<number | null>(null);
  const persistant = !!message.cle;

  /* LE TEMPS QUE L'ÉTAT DURE, À LA SECONDE. Il vit dans son propre état : le
     message se remet à l'heure tout seul, sans que le porteur ait à diffuser
     une seconde de plus. */
  const [, redessiner] = React.useState(0);
  React.useEffect(() => {
    if (!message.depuis) return;
    const minuteur = window.setInterval(() => redessiner((n) => n + 1), 1000);
    return () => window.clearInterval(minuteur);
  }, [message.depuis]);
  const secondes = message.depuis ? Math.max(0, Math.round((Date.now() - message.depuis) / 1000)) : 0;

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (persistant) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button')) return;
    /*
     * À LA SOURIS, LE TEXTE SE SURLIGNE AVANT DE SE BALAYER. Un message d'erreur
     * est ce qu'on veut le plus souvent copier ; or le glissement capturait le
     * pointeur dès le premier appui, donc aucune sélection ne pouvait naître.
     * Le geste de balayage reste entier ailleurs sur le message, et au doigt il
     * ne change pas du tout.
     */
    if (event.pointerType === 'mouse' && (event.target as HTMLElement).closest('[data-toast-texte]')) return;
    depart.current = event.clientX;
    setEnGlissement(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (depart.current === null) return;
    const delta = event.clientX - depart.current;
    setDecalage(Math.min(0, delta));
  };

  const terminerLeGeste = () => {
    if (depart.current === null) return;
    depart.current = null;
    setEnGlissement(false);
    if (decalage <= -SEUIL_GLISSEMENT_PX) {
      onFermer(message.id);
    } else {
      setDecalage(0);
    }
  };

  const ouvrir = onOuvrir ? () => onOuvrir(message) : undefined;

  return (
    <div
      data-toast
      data-toast-persistant={message.cle ?? undefined}
      {...(attributs?.(message) ?? {})}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={terminerLeGeste}
      onPointerCancel={terminerLeGeste}
      className={cn(
        'pointer-events-auto w-full max-w-[420px] touch-pan-y select-none overflow-hidden rounded-md border bg-surface shadow-lg animate-fade-in',
        message.level === 'error'
          ? 'border-danger/40 text-danger'
          : message.level === 'warning'
            ? 'border-warning/40 text-warning'
            : message.level === 'success'
              ? 'border-success/40 text-success'
              : 'border-border text-muted',
      )}
      style={{
        transform: decalage ? `translateX(${decalage}px)` : undefined,
        opacity: decalage ? Math.max(0.2, 1 + decalage / (SEUIL_GLISSEMENT_PX * 2)) : 1,
        transition: enGlissement ? 'none' : 'transform 160ms ease-out, opacity 160ms ease-out',
      }}
    >
      <div className="flex items-start gap-1.5 px-2.5 py-1.5 text-[13.5px]">
        <span className="mt-0.5 shrink-0">
          {persistant ? (
            <PlugZap className="h-3 w-3" />
          ) : message.level === 'error' ? (
            <AlertCircle className="h-3 w-3" />
          ) : message.level === 'warning' ? (
            <TriangleAlert className="h-3 w-3" />
          ) : message.level === 'success' ? (
            <Check className="h-3 w-3" />
          ) : (
            <Info className="h-3 w-3" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          {/* Le texte du message : il revient à la ligne même sur un mot sans
              coupure (chemin, adresse, identifiant), au lieu d'être rogné par
              le bord du cadre, et se surligne à la souris pour être copié.
              UN TEXTE REPLIÉ NE SE POSE JAMAIS DANS UN `button` : quand le
              message mène quelque part, c'est un `role="button"` qui le porte. */}
          <span
            data-toast-texte
            role={ouvrir ? 'button' : undefined}
            tabIndex={ouvrir ? 0 : undefined}
            onClick={ouvrir}
            onKeyDown={
              ouvrir
                ? (event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    ouvrir();
                  }
                : undefined
            }
            className={cn(
              'texte-copiable block whitespace-pre-line break-words leading-snug',
              ouvrir ? 'cursor-pointer' : null,
            )}
          >
            {message.text}
            {secondes >= 5 ? ` · ${secondes} s` : ''}
          </span>
          <span className="mt-0.5 block text-[11.5px] text-faint" data-heure-message>
            {heureEtDate(message.at)}
          </span>
        </span>
        <span className="-my-[11px] -mr-[11px] flex shrink-0 items-start">
          {/* LA COPIE D'UN COUP, SUR UN MESSAGE D'ERREUR. C'est le message
              qu'on veut emporter ailleurs — un rapport, une recherche —, et le
              surligner à la souris marche mais reste un geste de patience sur
              un texte de plusieurs lignes. Réservé à l'erreur : partout
              ailleurs, ce bouton n'ajouterait qu'un repère de plus dans une
              pile qui se veut discrète. */}
          {message.level === 'error' ? <BoutonCopier texte={message.text} /> : null}
          {/* LE GESTE OFFERT PAR UN ÉTAT : reconnecter tout de suite, sans
              attendre le repli progressif. C'est le bouton que portait
              l'ancien bandeau. */}
          {message.action === 'reconnecter' && onReconnecter ? (
            <button
              type="button"
              data-toast-reconnecter
              onClick={(event) => {
                event.stopPropagation();
                onReconnecter();
              }}
              title={t('Reconnecter maintenant')}
              className="my-1 mr-1 flex shrink-0 items-center gap-1 self-center rounded bg-raised/70 px-1.5 py-1 text-[12px] hover:bg-raised"
            >
              <RefreshCw className="h-3 w-3" />
              <span className="hidden sm:inline">{t('Reconnecter maintenant')}</span>
            </button>
          ) : null}
          {/* UN ÉTAT NE SE FERME PAS À LA MAIN : il reviendrait à la seconde
              suivante, puisque sa cause, elle, est toujours là. */}
          {persistant ? null : (
            <button
              data-toast-fermer
              onClick={(event) => {
                event.stopPropagation();
                onFermer(message.id);
              }}
              title={t('Retirer ce message')}
              className="flex items-center justify-center p-[11px] opacity-60 hover:opacity-100"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </span>
      </div>
      {/* AUCUNE BARRE SUR UN ÉTAT : elle promettrait une fin qui ne viendra
          qu'avec le retour du lien, jamais avec le temps qui passe. */}
      {persistant ? null : (
        <div className="h-[2px] w-full bg-current/15">
          <div
            data-barre-message
            className="h-full origin-left animate-barre-message bg-current opacity-60 motion-reduce:hidden"
            style={{ animationDuration: `${DUREE_MESSAGE_MS}ms`, animationPlayState: enPause ? 'paused' : 'running' }}
          />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* UNE PILE SANS MAGASIN — pour la porte client                         */
/* ------------------------------------------------------------------ */

/**
 * LA MÊME PILE, TENUE LOCALEMENT. L'espace client ne monte pas le magasin
 * général de l'administration : il lui faut donc son propre porteur. Les
 * RÈGLES, elles, sont celles de la maison — plafond de messages passagers
 * (`pileAvecMessage`), durée `DUREE_MESSAGE_MS`, et compte à rebours GELÉ tant
 * qu'un doigt ou une souris reste sur la pile, repris là où il en était.
 */
export function usePileDeMessages<Extra extends object = Record<string, never>>() {
  type Entree = MessagePassager & Extra & { restant: number; depart: number };
  const [messages, setMessages] = React.useState<Entree[]>([]);
  const minuteurs = React.useRef(new Map<string, number>());

  const retirer = React.useCallback((id: string) => {
    const minuteur = minuteurs.current.get(id);
    if (minuteur) window.clearTimeout(minuteur);
    minuteurs.current.delete(id);
    setMessages((liste) => liste.filter((m) => m.id !== id) as Entree[]);
  }, []);

  const armer = React.useCallback(
    (id: string, delai: number) => {
      const minuteur = window.setTimeout(() => retirer(id), delai);
      minuteurs.current.set(id, minuteur);
    },
    [retirer],
  );

  const ajouter = React.useCallback(
    (message: Omit<MessagePassager, 'id' | 'at'> & Partial<Pick<MessagePassager, 'id' | 'at'>> & Extra) => {
      const id = message.id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const entree = {
        ...message,
        id,
        at: message.at ?? Date.now(),
        restant: DUREE_MESSAGE_MS,
        depart: Date.now(),
      } as Entree;
      setMessages((liste) => pileAvecMessage(liste, entree) as Entree[]);
      armer(id, DUREE_MESSAGE_MS);
      return id;
    },
    [armer],
  );

  /** Le survol gèle TOUS les comptes à rebours : chacun garde son reste. */
  const geler = React.useCallback(() => {
    setMessages((liste) =>
      liste.map((m) => {
        const minuteur = minuteurs.current.get(m.id);
        if (minuteur) window.clearTimeout(minuteur);
        minuteurs.current.delete(m.id);
        return { ...m, restant: Math.max(0, m.restant - (Date.now() - m.depart)) };
      }),
    );
  }, []);

  const reprendre = React.useCallback(() => {
    setMessages((liste) =>
      liste.map((m) => {
        if (!minuteurs.current.has(m.id)) armer(m.id, m.restant);
        return { ...m, depart: Date.now() };
      }),
    );
  }, [armer]);

  React.useEffect(
    () => () => {
      for (const minuteur of minuteurs.current.values()) window.clearTimeout(minuteur);
      minuteurs.current.clear();
    },
    [],
  );

  return { messages, ajouter, retirer, geler, reprendre };
}
