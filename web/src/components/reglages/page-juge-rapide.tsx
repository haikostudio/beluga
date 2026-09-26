import * as React from 'react';
import { CheckCircle2, Cpu, Loader2 } from 'lucide-react';
import { type CompteRenduDeNuit, type TraceDeJugement } from '@beluga/shared';
import { BulleInfo, Badge, Switch } from '@/components/ui';
import { Groupe } from '@/components/reglages/communs';
import { client } from '@/lib/client';
import { relativeTime } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * LE JUGE RAPIDE DES DÉCISIONS INTERNES.
 *
 * Laya, un modèle de décision posé sur ce serveur : il ne tient pas de
 * conversation et n'écrit pas de code, elle tranche des questions fermées en
 * moins d'une seconde — sans compte, sans clé et sans facture. Elle n'apparaît
 * donc PAS dans le menu des moteurs : c'est un chemin séparé, et cet écran est
 * le seul endroit où il se règle.
 *
 * L'INTERRUPTEUR GÉNÉRAL EST SA PRÉSENCE : tant que Laya n'est pas installé,
 * aucun jugement n'est rendu et l'application se comporte exactement comme
 * avant. Chaque usage a ensuite son propre interrupteur, pour garder ceux qui
 * rendent service et couper ceux qui gênent.
 */

interface UsageAffiche {
  cle: string;
  titre: string;
  explication: string;
  allume: boolean;
}

interface EtatDuJuge {
  /** Laya est-il installé et prêt à juger sur ce serveur ? */
  allume: boolean;
  usages: UsageAffiche[];
  traces: TraceDeJugement[];
  bilan: { rendus: number; echecs: number; latenceMedianeMs: number };
  /** L'entraînement de nuit (`server/src/laya-nuit.ts`) : absent d'un démon plus ancien. */
  nuit?: { enCours: boolean; version: string; derniere?: CompteRenduDeNuit };
}

/** La phrase de l'issue d'une nuit : composée ici, traduisible, jamais recopiée du script. */
function phraseDeLaNuit(issue: CompteRenduDeNuit['issue']): string {
  switch (issue) {
    case 'rien':
      return t('Rien à apprendre cette nuit.');
    case 'tranche':
      return t('Une partie de l’entraînement est faite ; il reprendra la nuit prochaine.');
    case 'passe-complete':
      return t('Entraînement complet terminé.');
    case 'interrompu':
      return t('Entraînement interrompu (heure ou mémoire) ; il reprendra la nuit prochaine.');
    default:
      return t('La nuit a échoué ; la version en service n’a pas changé.');
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
        titre={t('Le modèle local')}
        aide={t(
          'Laya : un modèle de décision local, sur ce serveur, sans compte ni facture. Il tranche des questions fermées en quelques dixièmes de seconde, puis s’endort après vingt minutes sans travail pour rendre la mémoire. Tant qu’il n’est pas installé, aucun jugement n’est rendu et tout se comporte comme avant.',
        )}
      >
        <div className="flex items-center gap-2">
          {etat.allume ? (
            <Badge tone="success" className="gap-1">
              <CheckCircle2 className="h-3 w-3" />
              {t('Installé — prêt à juger')}
            </Badge>
          ) : (
            <Badge className="gap-1">
              <Cpu className="h-3 w-3" />
              {t('Non installé — aucun jugement rendu')}
            </Badge>
          )}
        </div>
      </Groupe>

      {etat.nuit ? (
        <Groupe
          titre={t('Entraînement de nuit')}
          aide={t(
            'Chaque nuit entre 3 h et 7 h, Laya s’entraîne sur ce serveur à partir de vos propres décisions. La nouvelle version ne remplace l’actuelle que si elle fait mieux à l’examen, sans reculer nulle part ; aucun avis ne s’allume pour autant.',
          )}
        >
          <div className="space-y-1 text-[12.5px] text-faint">
            <p>
              {t('Version en service : {v0}', {
                v0: etat.nuit.version === 'origine' ? t('le modèle d’origine') : etat.nuit.version,
              })}
            </p>
            {etat.nuit.enCours ? (
              <Badge tone="warning">{t('Entraînement en cours')}</Badge>
            ) : etat.nuit.derniere ? (
              <>
                <p>
                  {t('Dernière nuit : {v0}', { v0: relativeTime(etat.nuit.derniere.fin || etat.nuit.derniere.debut) })} —{' '}
                  {phraseDeLaNuit(etat.nuit.derniere.issue)}
                </p>
                {etat.nuit.derniere.progression != null && etat.nuit.derniere.issue !== 'passe-complete' ? (
                  <p>{t('Avancement de l’entraînement : {v0} %', { v0: String(Math.round(etat.nuit.derniere.progression * 100)) })}</p>
                ) : null}
                {etat.nuit.derniere.bascule ? (
                  <p>
                    {etat.nuit.derniere.bascule.remplace
                      ? t('La version entraînée a fait mieux : elle est en service.')
                      : t('La version entraînée n’a pas fait mieux : l’actuelle reste en service.')}
                  </p>
                ) : null}
              </>
            ) : (
              <p>{t('Aucune nuit d’entraînement pour l’instant.')}</p>
            )}
          </div>
        </Groupe>
      ) : null}

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
            {t('Ces interrupteurs restent sans effet tant que Laya n’est pas installé.')}
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
