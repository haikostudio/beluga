import * as React from 'react';
import { AlertCircle, Check, Info, TriangleAlert, X } from 'lucide-react';
import { DUREE_MESSAGE_MS, heureEtDate } from '@haikodev/shared';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';

/**
 * Les messages d'information passagers : en HAUT AU CENTRE, empilés les uns
 * sous les autres (une liste, pas une pile en profondeur — chacun reste
 * entièrement lisible). Chacun se ferme seul au bout de `DUREE_MESSAGE_MS`,
 * une barre sous son texte montrant le temps qui lui reste.
 *
 * Posés sous l'en-tête (`QuotaBar`, 44px + l'encoche du haut) : sur
 * téléphone comme sur ordinateur, le même en-tête est en flux normal en
 * haut de l'écran, jamais recouvert.
 */
export function Toasts() {
  const state = useApp();
  const messages = state.toasts;

  if (!messages.length) return null;

  return (
    <div
      data-bloc="toasts"
      className="pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-1.5 px-2"
      style={{ top: 'calc(44px + env(safe-area-inset-top) + 0.5rem)' }}
    >
      {messages.map((toast) => (
        <div
          key={toast.id}
          data-toast
          className={cn(
            'pointer-events-auto w-full max-w-[420px] overflow-hidden rounded-md border bg-surface shadow-lg animate-fade-in',
            toast.level === 'error'
              ? 'border-danger/40 text-danger'
              : toast.level === 'warning'
                ? 'border-warning/40 text-warning'
                : toast.level === 'success'
                  ? 'border-success/40 text-success'
                  : 'border-border text-muted',
          )}
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
              key={toast.id}
              className="h-full origin-left animate-barre-message bg-current opacity-60 motion-reduce:hidden"
            />
          </div>
        </div>
      ))}
    </div>
  );
}
