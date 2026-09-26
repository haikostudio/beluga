import * as React from 'react';
import {
  Bug,
  Loader2,
  Trash2,
} from 'lucide-react';
import {
  ERREURS_MONTREES_REGLAGES,
  ErreurInterface,
  appareilEnClair,
  origineEnClair,
} from '@beluga/shared';
import {
  BulleInfo,
  Button,
} from '@/components/ui';
import { client } from '@/lib/client';
import { relativeTime } from '@/lib/utils';
import { t } from '@/lib/langue';


/**
 * Quand l'application blanchit sur un téléphone, la console du navigateur ne
 * s'ouvre pas : sans cet endroit, la panne ne laissait aucune trace. La page
 * remonte désormais ses erreurs au serveur (`POST /api/erreur`), qui les range
 * dans son journal ; ce bloc les relit, les plus récentes d'abord.
 */
export function SectionErreursInterface() {
  const [erreurs, setErreurs] = React.useState<ErreurInterface[]>([]);
  const [total, setTotal] = React.useState(0);
  const [enCours, setEnCours] = React.useState(false);

  const relire = React.useCallback(async () => {
    const data = await client.call<{ erreurs: ErreurInterface[]; total: number }>({
      type: 'erreurs.liste',
      limite: ERREURS_MONTREES_REGLAGES,
    });
    setErreurs(data.erreurs ?? []);
    setTotal(data.total ?? 0);
  }, []);

  React.useEffect(() => {
    void relire().catch(() => undefined);
  }, [relire]);

  const effacer = async () => {
    setEnCours(true);
    try {
      const data = await client.call<{ ok: boolean }>({ type: 'erreurs.effacer' });
      if (data.ok) {
        setErreurs([]);
        setTotal(0);
        client.pushToast('success', t('Journal des erreurs vidé.'));
      } else {
        client.pushToast('error', t('Le journal n\'a pas pu être vidé.'));
      }
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('effacement refusé'));
    } finally {
      setEnCours(false);
    }
  };

  return (
    <section className="mt-4" data-bloc-erreurs>
      <h3 className="flex items-center gap-1.5 text-[13.5px] font-medium text-text mb-2">
        <Bug className="h-3.5 w-3.5 text-faint" />  {t('Dernières erreurs de l\'interface')}
  <BulleInfo cote="start">{t('Ce qui a planté dans la page, sur cet ordinateur comme sur un téléphone. Rien du contenu des projets n\'est remonté : seulement l\'erreur, l\'adresse de la page et l\'appareil.')}</BulleInfo>
</h3>


      {erreurs.length ? (
        <>
          <div className="space-y-1">
            {erreurs.map((erreur, index) => (
              <div
                key={`${erreur.at}-${index}`}
                data-ligne-erreur
                className="rounded-md border border-border bg-bloc px-2.5 py-1.5"
              >
                <p className="flex flex-wrap items-baseline gap-x-1.5 text-[11.5px] text-faint">
                  <span>{relativeTime(erreur.at)}</span>
                  <span>· {origineEnClair(erreur.source)}</span>
                  {erreur.zone ? <span>· {erreur.zone}</span> : null}
                  <span>· {appareilEnClair(erreur.appareil)}</span>
                </p>
                <p className="mt-0.5 break-words text-[13px] text-danger">{erreur.message}</p>
                {erreur.pile || erreur.url ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[11.5px] text-faint">{t('Détail technique')}</summary>
                    {erreur.url ? <p className="mt-1 break-all text-[11.5px] text-muted">{erreur.url}</p> : null}
                    {erreur.pile ? (
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11.5px] text-muted">
                        {erreur.pile}
                      </pre>
                    ) : null}
                  </details>
                ) : null}
              </div>
            ))}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button variant="subtle" size="sm" onClick={effacer} disabled={enCours} data-effacer-erreurs>
              {enCours ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              
{t('Tout effacer')}
</Button>
            {total > erreurs.length ? (
              <span className="text-[12px] text-faint">{t('{total} erreurs au journal, {v0} affichées.', { total, v0: erreurs.length })}</span>
            ) : null}
          </div>
        </>
      ) : (
        <p className="rounded-md border border-border bg-bloc px-2.5 py-2 text-[13px] text-muted">
          {t('Aucune erreur remontée : l\'interface n\'a rien cassé depuis le dernier effacement.')}</p>
      )}
    </section>
  );
}
