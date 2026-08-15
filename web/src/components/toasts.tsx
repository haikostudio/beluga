import * as React from 'react';
import { AlertCircle, Check, Copy, Info, TriangleAlert, X } from 'lucide-react';
import { DUREE_MESSAGE_MS, heureEtDate } from '@haikodev/shared';
import { client, Toast } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';

/** À partir de combien de pixels glissés vers la gauche, on relâche pour masquer. */
const SEUIL_GLISSEMENT_PX = 80;

/**
 * Les messages d'information passagers : en HAUT AU CENTRE, empilés les uns
 * sous les autres (une liste, pas une pile en profondeur — chacun reste
 * entièrement lisible). Chacun se ferme seul au bout de `DUREE_MESSAGE_MS`,
 * une barre sous son texte montrant le temps qui lui reste.
 *
 * Posés sous l'en-tête (`QuotaBar`, 44px + l'encoche du haut) : sur
 * téléphone comme sur ordinateur, le même en-tête est en flux normal en
 * haut de l'écran, jamais recouvert.
 *
 * Tant qu'un doigt ou une souris reste posé sur la pile, le compte à rebours
 * de TOUS les messages affichés est gelé (`pauseToasts` / `resumeToasts`,
 * gérés côté client pour reprendre exactement là où ils en étaient — pas
 * repartir de zéro). Chaque message peut en plus être écarté seul, en le
 * faisant glisser vers la gauche.
 */
export function Toasts() {
  const state = useApp();
  const messages = state.toasts;
  const [enPause, setEnPause] = React.useState(false);

  const surLaPile = React.useCallback(() => {
    setEnPause(true);
    client.pauseToasts();
  }, []);
  const horsDeLaPile = React.useCallback(() => {
    setEnPause(false);
    client.resumeToasts();
  }, []);

  if (!messages.length) return null;

  return (
    <div
      data-bloc="toasts"
      className="pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-1.5 px-2"
      style={{ top: 'calc(44px + env(safe-area-inset-top) + 0.5rem)' }}
      onMouseEnter={surLaPile}
      onMouseLeave={horsDeLaPile}
      onTouchStart={surLaPile}
      onTouchEnd={horsDeLaPile}
      onTouchCancel={horsDeLaPile}
    >
      {messages.map((toast) => (
        <ToastItem key={toast.id} toast={toast} enPause={enPause} />
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
      title={copie ? 'Message copié' : 'Copier ce message'}
      className="flex items-center justify-center p-[11px] opacity-60 transition-opacity hover:opacity-100"
    >
      {copie ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
    </button>
  );
}

function ToastItem({ toast, enPause }: { toast: Toast; enPause: boolean }) {
  const [decalage, setDecalage] = React.useState(0);
  const [enGlissement, setEnGlissement] = React.useState(false);
  const depart = React.useRef<number | null>(null);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
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
      client.dismissToast(toast.id);
    } else {
      setDecalage(0);
    }
  };

  return (
    <div
      key={toast.id}
      data-toast
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={terminerLeGeste}
      onPointerCancel={terminerLeGeste}
      className={cn(
        'pointer-events-auto w-full max-w-[420px] touch-pan-y select-none overflow-hidden rounded-md border bg-surface shadow-lg animate-fade-in',
        toast.level === 'error'
          ? 'border-danger/40 text-danger'
          : toast.level === 'warning'
            ? 'border-warning/40 text-warning'
            : toast.level === 'success'
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
          {toast.level === 'error' ? (
            <AlertCircle className="h-3 w-3" />
          ) : toast.level === 'warning' ? (
            <TriangleAlert className="h-3 w-3" />
          ) : toast.level === 'success' ? (
            <Check className="h-3 w-3" />
          ) : (
            <Info className="h-3 w-3" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          {/* Le texte du message : il revient à la ligne même sur un mot sans
              coupure (chemin, adresse, identifiant), au lieu d'être rogné par
              le bord du cadre, et se surligne à la souris pour être copié. */}
          <span
            data-toast-texte
            className="texte-copiable block whitespace-pre-line break-words leading-snug"
          >
            {toast.text}
          </span>
          <span className="mt-0.5 block text-[11.5px] text-faint" data-heure-message>
            {heureEtDate(toast.at)}
          </span>
        </span>
        <span className="-my-[11px] -mr-[11px] flex shrink-0 items-start">
          {/* LA COPIE D'UN COUP, SUR UN MESSAGE D'ERREUR. C'est le message
              qu'on veut emporter ailleurs — un rapport, une recherche —, et le
              surligner à la souris marche mais reste un geste de patience sur
              un texte de plusieurs lignes. Réservé à l'erreur : partout
              ailleurs, ce bouton n'ajouterait qu'un repère de plus dans une
              pile qui se veut discrète. */}
          {toast.level === 'error' ? <BoutonCopier texte={toast.text} /> : null}
          <button
            onClick={(event) => {
              event.stopPropagation();
              client.dismissToast(toast.id);
            }}
            title="Retirer ce message"
            className="flex items-center justify-center p-[11px] opacity-60 hover:opacity-100"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      </div>
      <div className="h-[2px] w-full bg-current/15">
        <div
          data-barre-message
          className="h-full origin-left animate-barre-message bg-current opacity-60 motion-reduce:hidden"
          style={{ animationDuration: `${DUREE_MESSAGE_MS}ms`, animationPlayState: enPause ? 'paused' : 'running' }}
        />
      </div>
    </div>
  );
}
