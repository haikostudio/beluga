import * as React from 'react';
import { BulleInfo } from '@/components/ui';
import { t } from '@/lib/langue';

/* ------------------------------------------------------------------ */
/* Les briques partagées par plusieurs sous-pages des réglages          */
/* ------------------------------------------------------------------ */

/**
 * Un GROUPE de réglages à l'intérieur d'une sous-page : un titre, son « i »
 * d'explication facultatif, puis les champs. Il servait de rubrique dans l'onglet
 * « Fonctionnement » ; il sert maintenant de sous-titre dans les pages qui en
 * ont hérité.
 */
export function Groupe({ titre, aide, children }: { titre: string; aide?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center gap-1">
        <h3 className="text-[13.5px] font-medium text-text">{titre}</h3>
        {aide ? <BulleInfo cote="start">{aide}</BulleInfo> : null}
      </div>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  );
}

export function Mesure({ titre, valeur, detail }: { titre: string; valeur: string; detail: string }) {
  return (
    <div className="rounded-md border border-border bg-bloc px-2 py-1.5">
      <p className="text-[11.5px] uppercase tracking-wide text-faint">{titre}</p>
      <p className="mt-0.5 text-[14.5px] font-medium text-text">{valeur}</p>
      <p className="mt-0.5 text-[11.5px] leading-relaxed text-faint">{detail}</p>
    </div>
  );
}

/** Des mégaoctets par milliers ne se lisent pas : « 5,6 Go » se lit. */
export function gigas(mo: number): string {
  return `${(mo / 1024).toFixed(1).replace('.', ',')} Go`;
}

/** Courbe fine sur 24 heures, pour comprendre pourquoi une tâche a patienté. */
export function Sparkline({ points }: { points: { at: number; loadPct: number }[] }) {
  const width = 640;
  const height = 40;
  const recent = points.slice(-240);
  const min = recent[0]?.at ?? 0;
  const max = recent[recent.length - 1]?.at ?? min + 1;
  const path = recent
    .map((point, index) => {
      const x = ((point.at - min) / Math.max(1, max - min)) * width;
      const y = height - (Math.min(100, point.loadPct) / 100) * height;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <>
      <p className="mt-3 text-[12px] uppercase tracking-wide text-faint">{t('Charge des dernières heures')}</p>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-1 h-10 w-full" preserveAspectRatio="none">
        <path d={path} fill="none" stroke="hsl(var(--muted))" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
      </svg>
    </>
  );
}
