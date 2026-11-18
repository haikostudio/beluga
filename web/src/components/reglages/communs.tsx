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

