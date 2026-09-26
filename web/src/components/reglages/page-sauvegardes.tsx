import * as React from 'react';
import {
  Database,
  Loader2,
  Save,
} from 'lucide-react';
import {
  Button,
} from '@/components/ui';
import { client } from '@/lib/client';
import { bytes } from '@/lib/utils';
import { t } from '@/lib/langue';
import { ReglagesSauvegardeAuto, type ProprietesReglages } from '@/components/reglages/page-sauvegarde-auto';

/**
 * LA PAGE « SAUVEGARDE AUTOMATIQUE » : d'abord l'heure du passage de nuit,
 * puis ce qu'on fait à la main — sauvegarder maintenant, voir les dernières.
 * Les deux étaient dans deux onglets différents, alors qu'on ne vient ici que
 * pour une seule question : mes données sont-elles à l'abri ?
 */
export function PageSauvegardes({
  settings,
  update,
  open,
}: ProprietesReglages & { open: boolean }) {
  return (
    <div className="space-y-5">
      <ReglagesSauvegardeAuto settings={settings} update={update} />
      <SectionSauvegardes open={open} />
    </div>
  );
}



export function SectionSauvegardes({ open }: { open: boolean }) {
  const [backups, setBackups] = React.useState<{ name: string; size: number; at: number }[]>([]);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    client
      .call<{ backups: typeof backups }>({ type: 'backup.list' })
      .then((data) => setBackups(data.backups ?? []))
      .catch(() => setBackups([]));
  }, [open]);

  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-medium text-text">
        <Database className="h-3.5 w-3.5 text-faint" />  {t('Sauvegardes')}
</h3>
      {/* Le libellé est long : sur un écran étroit, le bouton se met sur deux
          lignes plutôt que de sortir du tiroir par la droite. */}
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        className="h-auto max-w-full whitespace-normal py-1 text-left"
        onClick={async () => {
          setBusy(true);
          try {
            const result = await client.call<{ ok: boolean; verification?: { ok: boolean; detail: string } }>({
              type: 'backup.now',
            });
            if (result.verification) {
              client.pushToast(result.verification.ok ? 'success' : 'error', result.verification.detail);
            }
            const data = await client.call<{ backups: typeof backups }>({ type: 'backup.list' });
            setBackups(data.backups ?? []);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
        
{t('Sauvegarder maintenant (et vérifier la restauration)')}
</Button>

      <div className="mt-2 space-y-0.5">
        {backups.map((backup) => (
          <div key={backup.name} className="flex items-center gap-2 text-[12.5px] text-faint">
            <span className="min-w-0 flex-1 truncate">{backup.name}</span>
            <span>{bytes(backup.size)}</span>
          </div>
        ))}
        {!backups.length ? <p className="text-[12.5px] text-faint">{t('Aucune sauvegarde pour l\'instant.')}</p> : null}
      </div>
    </section>
  );
}
