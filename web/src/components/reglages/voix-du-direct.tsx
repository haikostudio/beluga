/*
 * « LA VOIX DE CODEX EN DIRECT » (Réglages › Voix, carte « En-tête du projet et assistant vocal Codex »,
 * 15/11/2026) : les voix qu'OpenAI propose pour la conversation en direct (protocole V3), lues chez Codex par le
 * démon. Toucher le nom retient la voix (la seule de Beluga depuis le 17/11/2026), « Écouter » fait entendre
 * la voix de la ligne sans rien changer au choix (une courte session sans outils, `ecouterUneVoixDuDirect`).
 */
import * as React from 'react';
import { VOIX_DU_DIRECT, nomDeLaVoix, voixDuDirectRetenue } from '@beluga/shared';
import { Loader2, Play, Volume2 } from '@/components/ui/icones';
import { BulleInfo, Button } from '@/components/ui';
import { client } from '@/lib/client';
import { ecouterUneVoixDuDirect } from '@/lib/direct-codex';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

export function VoixDuDirect() {
  const state = useApp();
  const [voix, setVoix] = React.useState<string[] | null>(null);
  const [enEcoute, setEnEcoute] = React.useState<string | null>(null);
  const arretRef = React.useRef<(() => void) | null>(null);

  React.useEffect(() => {
    let vivant = true;
    client
      .call<{ voix: string[] }>({ type: 'voix.direct.voix' }, 60_000)
      .then((r) => vivant && setVoix(r.voix?.length ? r.voix : [...VOIX_DU_DIRECT]))
      .catch(() => vivant && setVoix([...VOIX_DU_DIRECT]));
    return () => {
      vivant = false;
      arretRef.current?.();
    };
  }, []);

  const liste = voix ?? [...VOIX_DU_DIRECT];
  const choisie = voixDuDirectRetenue(state.settings?.voixCodexDirect, liste);

  const ecouter = async (id: string) => {
    if (enEcoute === id) {
      arretRef.current?.();
      return;
    }
    setEnEcoute(id);
    try {
      arretRef.current = await ecouterUneVoixDuDirect(id, () => setEnEcoute((v) => (v === id ? null : v)));
    } catch (err) {
      setEnEcoute(null);
      client.pushToast('error', err instanceof Error && err.message ? err.message : t('Extrait impossible à jouer.'));
    }
  };

  return (
    <div className="mb-6" data-voix-du-direct>
      <h3 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-medium text-text">
        <Volume2 className="h-3.5 w-3.5 text-faint" />  {t('La voix de Codex en direct')}
        <BulleInfo cote="start">
          {t('C’est la voix qui vous répond quand vous parlez à Codex en direct, depuis le module de voix. Elle passe par votre abonnement Codex, sans frais en plus.')}
          {'\n\n'}
          {t('« Écouter » fait entendre la voix de la ligne sans changer votre choix ; il faut quelques secondes pour la joindre.')}
        </BulleInfo>
      </h3>
      <p className="mb-2 text-[11.5px] text-faint">
        {t('Touchez le nom pour l’adopter : c’est la seule voix de Beluga.')}
      </p>
      <div className="space-y-1">
        {liste.map((id) => {
          const active = choisie === id;
          const joue = enEcoute === id;
          return (
            <div
              key={id}
              data-voix-directe={id}
              aria-current={active ? 'true' : undefined}
              className={cn('flex items-center gap-2 rounded-md border px-2 py-1.5', active ? 'border-text/40 bg-raised' : 'border-border bg-surface')}
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => void client.geste({ type: 'settings.update', patch: { voixCodexDirect: id } }, t('Enregistrement du réglage'))}
              >
                <p className="truncate text-[13.5px] text-text">
                  {nomDeLaVoix(id)}
                  {active ? <span className="ml-1.5 text-[12px] text-faint">{t('· choisie')}</span> : null}
                </p>
                <p className="truncate text-[11.5px] text-faint">
                  {active ? t('C’est elle qui vous répond en direct.') : t('Une voix d’OpenAI pour le direct.')}
                </p>
              </button>
              <Button variant="outline" size="sm" aria-label={`Écouter ${nomDeLaVoix(id)}`} onClick={() => void ecouter(id)}>
                {joue ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                {joue ? t('Arrêter') : t('Écouter')}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
