import * as React from 'react';
import {
  Activity,
} from 'lucide-react';
import { type CreditCursor } from '@beluga/shared';
import { UsageCursor } from '@/components/quota-badge';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { t, formatRegional } from '@/lib/langue';
import { BulleInfo } from '@/components/ui';


/**
 * Cumuls de consommation (PLAN §24) et synthèse de facturation (PLAN §7).
 * Ces chiffres éclairent ; ils ne modifient jamais tout seuls une facture.
 */
export function UsageSection({ open }: { open: boolean }) {
  const state = useApp();
  const [usage, setUsage] = React.useState<{
    byProject: { projectId?: string | null; name?: string; tokens: number; seconds: number; tasks: number }[];
    byMonth: { month: string; tokens: number; seconds: number }[];
    cache?: {
      jours: number;
      total: { frais: number; relu: number; entree: number; part?: number; tours: number };
      parMoteur: { engine?: string; frais: number; relu: number; tours: number }[];
    };
  } | null>(null);
  const [summary, setSummary] = React.useState<any>(null);
  const [cursor, setCursor] = React.useState<
    { id: string; label: string; credit: CreditCursor }[] | null
  >(null);

  React.useEffect(() => {
    if (!open) return;
    client.call({ type: 'stats.usage' }).then(setUsage).catch(() => setUsage(null));
    client
      .call({ type: 'billing.summary' }, 120000)
      .then((data) => setSummary(data?.summary))
      .catch(() => setSummary(null));
    // L'usage Cursor du cycle, lu sur son tableau de bord pour chaque compte.
    client
      .call({ type: 'cursor.credit' }, 60000)
      .then((data) => setCursor(Array.isArray(data?.comptes) ? data.comptes : null))
      .catch(() => setCursor(null));
  }, [open]);

  /*
   * Le nom vient d'abord du projet vivant, sinon de celui figé au moment de la
   * dépense. Faute des deux (dépense antérieure à cette mémoire), on montre au
   * moins le début de l'identifiant : sept lignes « projet retiré » identiques
   * ne distinguaient plus rien. Un tour dépensé HORS PROJET, lui, n'a aucun
   * identifiant à montrer — et l'écran entier tombait en essayant d'en couper un.
   */
  const nomDuProjet = (row: { projectId?: string | null; name?: string }) =>
    (row.projectId ? state.projects.find((p) => p.id === row.projectId)?.name : undefined) ??
    row.name ??
    (row.projectId ? t('Projet supprimé · {v0}', { v0: row.projectId.slice(0, 8) }) : 'Hors projet');

  return (
    <section>
      <h3 className="flex items-center gap-1.5 text-[13.5px] font-medium text-text mb-2">
        <Activity className="h-3.5 w-3.5 text-faint" />  {t('Ce qui a été consommé')}
  <BulleInfo cote="start">{t('Le total de ce que les agents ont dépensé depuis le début, projet par projet : nombre de tâches et temps de travail des agents. C\'est une mesure d\'usage, pas une facture — rien ici n\'est facturé à personne.')}</BulleInfo>
</h3>

      {usage?.byProject?.length ? (
        <div className="space-y-0.5">
          {usage.byProject.map((row) => (
            <div key={row.projectId ?? 'hors-projet'} className="rounded-md border border-border bg-bloc px-2 py-1.5">
              <p className="truncate text-[13.5px] text-text">{nomDuProjet(row)}</p>
              <p className="mt-0.5 text-[11.5px] text-faint">
                {t('{v0} tâche{v1} · {v2} min', { v0: row.tasks, v1: row.tasks > 1 ? 's' : '', v2: Math.round(row.seconds / 60) })}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[13px] text-faint">{t('Aucune consommation relevée pour l\'instant.')}</p>
      )}

      {usage?.byMonth?.length ? (
        <div className="mt-3">
          <p className="mb-1 text-[12px] uppercase tracking-wide text-faint">{t('Par mois')}</p>
          <div className="flex flex-wrap gap-1">
            {usage.byMonth.map((row) => (
              <span key={row.month} className="rounded border border-border px-1.5 py-0.5 text-[12px] text-muted">
                {t('{v0} · {v1} min', { v0: moisEnClair(row.month), v1: Math.round(row.seconds / 60) })}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {cursor?.length ? (
        <div className="mt-4" data-essai="credit-cursor">
          <p className="flex items-center gap-1 text-[12px] uppercase tracking-wide text-faint mb-1.5">{t('Usage chez Cursor')}<BulleInfo cote="start">{t('Le forfait, la part consommée et la dépense à la demande du cycle en cours, lus chez Cursor. Les mêmes chiffres se lisent sur la carte du compte, dans le volet des quotas.')}</BulleInfo></p>
          <div className="space-y-0.5">
            {cursor.map((compte) => (
              <div key={compte.id} className="rounded-md border border-border bg-bloc px-2 py-1.5">
                <p className="mb-1 truncate text-[13.5px] text-text">{compte.label}</p>
                <UsageCursor credit={compte.credit} />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {summary && !summary.error ? (
        <div className="mt-4">
          <p className="flex items-center gap-1 text-[12px] uppercase tracking-wide text-faint mb-1.5">{t('Facturation du mois')}<BulleInfo cote="start">{t('Ce que l\'application de facturation a enregistré ce mois-ci. Lecture seule : Beluga Build n\'y écrit rien tout seul.')}</BulleInfo></p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              [t('Facturé'), summary.invoiced ?? summary.total_invoiced],
              [t('Encaissé'), summary.paid ?? summary.total_paid],
              [t('En attente'), summary.outstanding ?? summary.total_outstanding],
              [t('En retard'), summary.overdue ?? summary.total_overdue],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-md border border-border bg-bloc px-2 py-1.5">
                <p className="text-[11.5px] uppercase tracking-wide text-faint">{label}</p>
                <p className="mt-0.5 text-[14.5px] font-medium text-text">
                  {typeof value === 'number' ? t('{v0} CHF', { v0: value.toLocaleString(formatRegional()) }) : '—'}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** Courbe fine sur 24 heures, pour comprendre pourquoi une tâche a patienté. */
/** « 2026-08 » ne se lit pas non plus : on dit le mois. */
export function moisEnClair(mois: string): string {
  const [annee, numero] = mois.split('-').map(Number);
  if (!annee || !numero) return mois;
  return new Date(annee, numero - 1, 1).toLocaleDateString(formatRegional(), { month: 'long', year: 'numeric' });
}
