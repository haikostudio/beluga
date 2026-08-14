import * as React from 'react';
import { AlertCircle, Check, Info, TriangleAlert, X } from 'lucide-react';
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

function ToastItem({ toast, enPause }: { toast: Toast; enPause: boolean }) {
  const [decalage, setDecalage] = React.useState(0);
  const [enGlissement, setEnGlissement] = React.useState(false);
  const depart = React.useRef<number | null>(null);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
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
          <span className="block whitespace-pre-line leading-snug">{toast.text}</span>
          <span className="mt-0.5 block text-[11.5px] text-faint" data-heure-message>
            {heureEtDate(toast.at)}
          </span>
        </span>
        <button
          onClick={(event) => {
            event.stopPropagation();
            client.dismissToast(toast.id);
          }}
          title="Retirer ce message"
          className="-m-[11px] flex shrink-0 items-center justify-center p-[11px] opacity-60 hover:opacity-100"
        >
          <X className="h-2.5 w-2.5" />
        </button>
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
