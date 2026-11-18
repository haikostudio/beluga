/*
 * « LA VOIX DE CODEX EN DIRECT » (Réglages › Voix, carte « En-tête du projet et assistant vocal Codex »,
 * 15/11/2026) : les voix qu'OpenAI propose pour la conversation en direct (protocole V3), lues chez Codex par le
 * démon. Toucher le nom retient la voix (la seule de Beluga depuis le 17/11/2026), « Écouter » fait entendre
 * la voix de la ligne sans rien changer au choix (une courte session sans outils, `ecouterUneVoixDuDirect`).
 */
import * as React from 'react';
import {
  MODELE_DU_DIRECT,
  REFLEXIONS_DU_DIRECT,
  VOIX_DU_DIRECT,
  libelleDuModeleDuDirect,
  limiterAuxPlusRecents,
  modeleEtEffortDuDirect,
  nomDeLaVoix,
  voixDuDirectRetenue,
} from '@beluga/shared';
import { Brain, Loader2, Play, Volume2 } from '@/components/ui/icones';
import { BulleInfo, Button, ListeDeroulante } from '@/components/ui';
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


/**
 * « LE CERVEAU DE L'ASSISTANT VOCAL » (Réglages › Voix, carte « Jarvis plus fiable et vérifié », 18/11/2026 — décision
 * de l'utilisateur : « un bouton pour paramétrer la version de GPT pour l'agent vocal »). Deux menus côte à côte : le
 * modèle (la version la plus récente de chaque famille du catalogue Codex du compte) et la réflexion. Sol en
 * réflexion poussée par défaut ; un changement vaut pour la conversation suivante. La voix qui parle, elle, ne se
 * règle pas : c'est le modèle temps réel de l'abonnement.
 */
export function CerveauDeLaVoix() {
  const state = useApp();
  const reglage = modeleEtEffortDuDirect(state.settings);
  const codex = state.engines?.find((e) => e.id === 'codex');
  // Le catalogue lent ou absent ne bloque rien : le modèle retenu et Sol restent toujours proposés.
  const modeles = limiterAuxPlusRecents(codex?.models ?? []).map((m) => ({ valeur: m.id, libelle: m.label || libelleDuModeleDuDirect(m.id) }));
  for (const id of [reglage.modele, MODELE_DU_DIRECT]) {
    if (!modeles.some((m) => m.valeur === id)) modeles.push({ valeur: id, libelle: libelleDuModeleDuDirect(id) });
  }
  const options = modeles.map((m) => ({ ...m, ...(m.valeur === MODELE_DU_DIRECT ? { detail: t('Par défaut : le plus puissant') } : {}) }));
  const libellesReflexion: Record<string, string> = { low: t('Basse'), medium: t('Moyenne'), high: t('Poussée') };
  const enregistrer = (patch: Record<string, string>) => void client.geste({ type: 'settings.update', patch }, t('Enregistrement du réglage'));

  return (
    <div className="mb-6" data-cerveau-de-la-voix>
      <h3 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-medium text-text">
        <Brain className="h-3.5 w-3.5 text-faint" /> {t('Le cerveau de l’assistant vocal')}
        <BulleInfo cote="start">
          {t('C’est le modèle qui réfléchit, vérifie et agit pendant que vous parlez à l’assistant. Une réflexion plus poussée donne des réponses plus sûres, un peu plus lentes.')}
          {'\n\n'}
          {t('La voix qui parle reste celle de votre abonnement : elle ne se règle pas ici.')}
        </BulleInfo>
      </h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="min-w-0">
          <p className="mb-1 text-[11.5px] text-faint">{t('Modèle')}</p>
          <ListeDeroulante
            titre={t('Modèle de l’assistant vocal')}
            valeur={reglage.modele}
            options={options}
            repere="cerveau-modele"
            onChoisir={(valeur) => enregistrer({ voixCodexModele: valeur === MODELE_DU_DIRECT ? '' : valeur })}
          />
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-[11.5px] text-faint">{t('Réflexion')}</p>
          <ListeDeroulante
            titre={t('Réflexion de l’assistant vocal')}
            valeur={reglage.effort}
            options={REFLEXIONS_DU_DIRECT.map((r) => ({ valeur: r, libelle: libellesReflexion[r] ?? r }))}
            repere="cerveau-reflexion"
            onChoisir={(valeur) => enregistrer({ voixCodexReflexion: valeur === 'high' ? '' : valeur })}
          />
        </div>
      </div>
      <p className="mt-2 text-[11.5px] text-faint">{t('Un changement s’applique à la prochaine conversation.')}</p>
    </div>
  );
}
