import * as React from 'react';
import { Check, Clapperboard, Loader2, Settings } from 'lucide-react';
import { REPERE_SERVICES_CREATION } from '@beluga/shared';
import { Button } from '@/components/ui';
import { useServicesDeCreation } from '@/components/reglages/page-services-creation';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import type { DonneesCreation } from './types';

/** Ouvre les paramètres de l'application sur la rubrique « Services de création ». */
export function ouvrirLesServicesDeCreation() {
  window.dispatchEvent(new CustomEvent('beluga:ouvrir-reglages', { detail: { page: 'services-creation' } }));
}

/**
 * L'ENCADRÉ DES SERVICES DE CRÉATION, au bout du fil du Studio (demande du
 * 14/10/2026). Il paraît quand l'agent écrit le repère `[services-de-creation]`
 * — une création « Vidéo » sans modèle retenu :
 *
 *  - AUCUN service vidéo branché : une phrase et le bouton « Ouvrir les
 *    paramètres », qui mène droit à la rubrique. L'encadré se relit tant que
 *    rien n'est branché (au retour sur la fenêtre, et toutes les cinq secondes) ;
 *  - un service branché : ses modèles, un bouton chacun. Le choix est gardé sur
 *    la création puis dit à l'agent, qui reprend.
 */
export function EncadreServices({ texte, donnees }: { texte: string; donnees: DonneesCreation }) {
  const visible = texte.includes(REPERE_SERVICES_CREATION);
  const { services, relire } = useServicesDeCreation(visible);
  const [choix, setChoix] = React.useState<{ service: string; modele: string } | null>(donnees.modeleVideo ?? null);
  const [enCours, setEnCours] = React.useState<string | null>(null);
  const video = (services ?? []).filter((s) => s.branche && s.modeles.length);
  const attendUnService = visible && services !== null && !video.length;

  React.useEffect(() => {
    if (!attendUnService) return;
    const relireDiscretement = () => void relire().catch(() => undefined);
    const minuteur = window.setInterval(relireDiscretement, 5000);
    window.addEventListener('focus', relireDiscretement);
    return () => {
      window.clearInterval(minuteur);
      window.removeEventListener('focus', relireDiscretement);
    };
  }, [attendUnService, relire]);

  if (!visible) return null;
  const choisir = async (service: string, modele: string) => {
    setEnCours(`${service}/${modele}`);
    try {
      await client.call({ type: 'studio.modeleVideo.choisir', creationId: donnees.creation.id, service, modele });
      setChoix({ service, modele });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('choix non retenu'));
    } finally {
      setEnCours(null);
    }
  };
  const nomDuChoix = choix
    ? (() => {
        const s = (services ?? []).find((x) => x.id === choix.service);
        const m = s?.modeles.find((x) => x.id === choix.modele);
        return s && m ? `${m.nom} (${s.nom})` : choix.modele;
      })()
    : null;

  return (
    <section className="mx-3 my-2 flex flex-col gap-2 rounded-lg bg-bloc px-3 py-2.5" data-studio-encadre-services={attendUnService ? 'aucun' : choix ? 'choisi' : 'choix'}>
      <div className="flex items-center gap-2">
        <Clapperboard className="h-4 w-4 shrink-0 text-muted" />
        <h4 className="text-[13px] font-semibold text-text">{t('Vos services de création')}</h4>
      </div>
      {services === null ? (
        <p className="flex items-center gap-2 text-[12.5px] text-faint">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('Chargement…')}
        </p>
      ) : choix ? (
        <p className="flex items-center gap-1.5 text-[12.5px] text-muted" data-studio-modele-retenu>
          <Check className="h-3.5 w-3.5 text-termine" />
          {t('Modèle retenu pour cette vidéo : {modele}.', { modele: nomDuChoix ?? '' })}
        </p>
      ) : attendUnService ? (
        <>
          <p className="text-[12.5px] leading-relaxed text-muted">
            {t('Pour fabriquer des extraits vidéo, branchez un de vos comptes (Runway, Krea, fal.ai, Replicate, Freepik, BytePlus ou Higgsfield) : collez sa clé dans les paramètres. Dès qu’un service est branché, ses modèles apparaissent ici.')}
          </p>
          <div>
            <Button size="sm" onClick={ouvrirLesServicesDeCreation} data-studio-ouvrir-services>
              <Settings className="h-3.5 w-3.5" />
              {t('Ouvrir les paramètres')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-[12.5px] leading-relaxed text-muted">{t('Choisissez le modèle qui fabriquera les extraits de cette vidéo.')}</p>
          <div className="flex flex-col gap-1">
            {video.flatMap((s) =>
              s.modeles.map((m) => (
                <Button
                  key={`${s.id}/${m.id}`}
                  size="sm"
                  variant="subtle"
                  className="justify-start"
                  disabled={!!enCours}
                  onClick={() => void choisir(s.id, m.id)}
                  data-studio-choisir-modele={`${s.id}/${m.id}`}
                >
                  {enCours === `${s.id}/${m.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  <span className="truncate">{m.nom}</span>
                  <span className="truncate text-faint">· {s.nom}</span>
                </Button>
              )),
            )}
          </div>
        </>
      )}
    </section>
  );
}
