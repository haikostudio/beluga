import * as React from 'react';
import { CheckCircle2, KeyRound, Loader2 } from 'lucide-react';
import { type TraceDeJugement } from '@beluga/shared';
import { BulleInfo, Badge, Button, Switch } from '@/components/ui';
import { Groupe } from '@/components/reglages/communs';
import { client } from '@/lib/client';
import { relativeTime } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * LE JUGE RAPIDE DES DÉCISIONS INTERNES.
 *
 * Jev, le modèle de décision de TypeSafe, appelé à distance : il ne tient pas
 * de conversation et n'écrit pas de code, il tranche des questions fermées en
 * moins d'une seconde. Il n'apparaît donc PAS dans le menu des moteurs : c'est
 * un chemin séparé, et cet écran est le seul endroit où il se règle.
 *
 * L'INTERRUPTEUR GÉNÉRAL EST LA CLÉ RANGÉE AU COFFRE-FORT : sans elle, aucun
 * appel ne part et l'application se comporte exactement comme avant (la jauge
 * de compréhension se calcule alors par des règles). Chaque usage a ensuite son
 * propre interrupteur. Aucun compteur de jetons ici : la consommation reste
 * dans les traces.
 */

interface UsageAffiche {
  cle: string;
  titre: string;
  explication: string;
  allume: boolean;
}

interface EtatDuJuge {
  /** Une clé TypeSafe est-elle rangée au coffre-fort ? */
  allume: boolean;
  /** La fiche du coffre qui porte la clé. */
  fiche?: { id: string; nom: string };
  usages: UsageAffiche[];
  traces: TraceDeJugement[];
  bilan: { rendus: number; echecs: number; latenceMedianeMs: number };
}

type EtatDeLaCle = 'acceptee' | 'refusee' | 'injoignable' | 'absente';

/** La phrase de chaque issue du test : composée ici, traduisible. */
function phraseDeLEtat(etat: EtatDeLaCle): string {
  switch (etat) {
    case 'acceptee':
      return t('Clé acceptée : le service a répondu.');
    case 'refusee':
      return t('Clé refusée par le service : elle est fausse, expirée ou sans crédit.');
    case 'injoignable':
      return t('Service injoignable : aucune réponse dans le délai. Rien n’est bloqué pour autant.');
    default:
      return t('Aucune clé rangée : le juge est éteint et n’émet aucun appel.');
  }
}

const VIDE: EtatDuJuge = {
  allume: false,
  usages: [],
  traces: [],
  bilan: { rendus: 0, echecs: 0, latenceMedianeMs: 0 },
};

export function PageJugeRapide({ open }: { open: boolean }) {
  const [etat, setEtat] = React.useState<EtatDuJuge>(VIDE);
  const [chargement, setChargement] = React.useState(true);
  const [bascule, setBascule] = React.useState<string | null>(null);
  const [essai, setEssai] = React.useState<{ enCours: boolean; etat?: EtatDeLaCle }>({ enCours: false });

  const relire = React.useCallback(async () => {
    const data = await client.call<EtatDuJuge>({ type: 'juge.etat' });
    setEtat(data ?? VIDE);
    setChargement(false);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    relire().catch(() => setChargement(false));
  }, [open, relire]);

  const basculerUsage = async (usage: UsageAffiche, allume: boolean) => {
    setBascule(usage.cle);
    try {
      const data = await client.call<EtatDuJuge>({ type: 'juge.usage', usage: usage.cle, allume });
      setEtat(data ?? VIDE);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('réglage non enregistré'));
    } finally {
      setBascule(null);
    }
  };

  /* UN BOUTON QUI PART EN REQUÊTE LE DIT DÈS LE CLIC : le rond tourne, puis la phrase. */
  const testerLaCle = async () => {
    setEssai({ enCours: true });
    try {
      const data = await client.call<{ etat: EtatDeLaCle }>({ type: 'juge.tester' });
      setEssai({ enCours: false, etat: data?.etat ?? 'injoignable' });
    } catch {
      setEssai({ enCours: false, etat: 'injoignable' });
    }
  };

  if (chargement) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-faint">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t('Lecture des réglages…')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Groupe
        titre={t('Le juge : Jev')}
        aide={t(
          'Jev, le modèle de décision de TypeSafe, appelé à distance : rien ne tourne sur ce serveur. Il tranche des questions fermées en moins d’une seconde, pour quelques jetons par avis. Sa clé se range au coffre-fort, sous le service TypeSafe ; sans clé, aucun appel ne part et la jauge de compréhension se calcule par des règles simples.',
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          {etat.allume ? (
            <Badge tone="success" className="gap-1">
              <CheckCircle2 className="h-3 w-3" />
              {t('Clé rangée — juge allumé')}
            </Badge>
          ) : (
            <Badge className="gap-1">
              <KeyRound className="h-3 w-3" />
              {t('Aucune clé — aucun appel')}
            </Badge>
          )}
          {etat.fiche ? (
            <span className="text-[12px] text-faint">{t('Fiche du coffre : {v0}', { v0: etat.fiche.nom })}</span>
          ) : null}
          <Button size="sm" variant="ghost" onClick={testerLaCle} disabled={essai.enCours} data-juge-tester>
            {essai.enCours ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {t('Tester la clé')}
          </Button>
        </div>
        {essai.etat ? (
          <p className="text-[12.5px] text-faint" data-juge-essai={essai.etat}>
            {phraseDeLEtat(essai.etat)}
          </p>
        ) : null}
      </Groupe>

      <Groupe
        titre={t('Ce que le juge décide')}
        aide={t(
          'Plusieurs endroits de l’application lui demandent son avis. Chacun s’éteint séparément. Aucun de ces avis ne supprime ni ne lance quoi que ce soit, et aucun ne bloque un geste que vous faites vous-même.',
        )}
      >
        <div className="space-y-2">
          {etat.usages.map((usage) => (
            <div
              key={usage.cle}
              className="flex items-start justify-between gap-3 rounded-md bg-bloc px-2.5 py-2"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-1 text-[13px] font-medium text-text">{t(usage.titre)}<BulleInfo cote="start">{t(usage.explication)}</BulleInfo></p>
              </div>
              <Switch
                checked={usage.allume}
                attente={bascule === usage.cle}
                onCheckedChange={(next) => basculerUsage(usage, next)}
                /* UN REPÈRE TECHNIQUE NE SE TRADUIT PAS : l'étiquette lue par
                   les outils d'accessibilité — et par les contrôles — reste la
                   même dans les cinq langues. Le titre traduit se lit juste
                   à côté, à l'écran. */
                aria-label={usage.cle}
              />
            </div>
          ))}
        </div>
        {!etat.allume ? (
          <p className="text-[12px] text-faint">
            {t('Ces interrupteurs restent sans effet tant qu’aucune clé TypeSafe n’est rangée au coffre-fort.')}
          </p>
        ) : null}
      </Groupe>

      <Groupe
        titre={t('Les jugements rendus')}
        aide={t(
          'Chaque avis laisse sa trace : la question posée, la réponse, le temps mis, et ce qui a été décidé ensuite. C’est ce qui permet de voir après coup si un usage juge mal.',
        )}
      >
        <div className="flex flex-wrap gap-4 text-[12.5px] text-faint">
          <span>
            {etat.bilan.rendus} {t('rendus')}
          </span>
          <span>
            {etat.bilan.echecs} {t('sans réponse (repli)')}
          </span>
          <span>{t('médiane {v0} ms', { v0: String(etat.bilan.latenceMedianeMs) })}</span>
        </div>

        {etat.traces.length === 0 ? (
          <p className="text-[12.5px] text-faint">{t('Aucun jugement rendu pour l’instant.')}</p>
        ) : (
          <ul className="space-y-1.5">
            {etat.traces.map((trace) => (
              <li key={trace.id} className="rounded-md bg-bloc px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-2 text-[12px]">
                  <span className="font-medium text-text">{trace.usage}</span>
                  <span className="text-faint">{relativeTime(trace.at)}</span>
                  <span className="text-faint">{t('{v0} ms', { v0: String(trace.latenceMs) })}</span>
                  {trace.issue === 'echec' ? (
                    <Badge tone="warning">{t('sans réponse')}</Badge>
                  ) : trace.confiance != null ? (
                    <span className="text-faint">{Math.round(trace.confiance * 100)} %</span>
                  ) : null}
                </div>
                <p className="mt-1 break-words text-[11.5px] leading-relaxed text-faint">{trace.reponse}</p>
                {trace.suite ? (
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-faint">↳ {trace.suite}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Groupe>
    </div>
  );
}
