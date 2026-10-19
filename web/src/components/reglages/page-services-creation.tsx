import * as React from 'react';
import { Check, ExternalLink, Loader2, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import { Button, ChampMotDePasse, ConfirmDialog } from '@/components/ui';
import { client } from '@/lib/client';
import { relativeTime } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * LES SERVICES DE CRÉATION — les comptes de l'utilisateur que le Studio peut
 * utiliser (demande du 14/10/2026) : sept services de génération vidéo, plus
 * son propre compte OpenRouter pour la voix finale et la musique. Depuis le
 * 18/10/2026, HeyGen et ElevenLabs s'y ajoutent pour le mode « Réalisation »
 * des cartes (`shared/src/services-de-generation.ts`), qui sert aussi des
 * autres.
 *
 * Une ligne par service : son état (branché, non branché, clé refusée et
 * pourquoi), le lien où créer la clé, le champ (deux pour Higgsfield), « Tester »
 * et « Retirer ». La clé est TESTÉE avant d'être rangée au coffre-fort (une
 * fiche par service) et ne revient JAMAIS en clair : on n'en montre que les
 * quatre derniers signes.
 */

export interface ServiceAffiche {
  id: string;
  nom: string;
  description: string;
  adresseCle: string;
  champs: { id: string; libelle: string }[];
  modeles: { id: string; nom: string }[];
  branche: boolean;
  fin: string | null;
  test: { ok: boolean; raison?: string; le: number } | null;
}

/** Les services, relus du démon. `actif` faux : on ne les lit pas. */
export function useServicesDeCreation(actif = true) {
  const [services, setServices] = React.useState<ServiceAffiche[] | null>(null);
  const relire = React.useCallback(async () => {
    const data = await client.call<{ services: ServiceAffiche[] }>({ type: 'studio.services.lister' });
    setServices(data.services ?? []);
  }, []);
  React.useEffect(() => {
    if (actif) void relire().catch(() => undefined);
  }, [actif, relire]);
  return { services, setServices, relire };
}

/* Ce que dit chaque service, traduit ici (le catalogue partagé garde le français). */
const DESCRIPTIONS: Record<string, () => string> = {
  higgsfield: () => t('Vidéos Kling et Hailuo, payées sur votre solde Higgsfield.'),
  byteplus: () => t('Les vidéos Seedance de ByteDance, avec le son.'),
  magnific: () => t('Veo, Kling et Wan, payés sur votre crédit Freepik (Magnific).'),
  krea: () => t('Veo, Kling et Seedance depuis votre espace Krea.'),
  runway: () => t('Gen-4.5 et Veo 3.1, payés en crédits Runway.'),
  fal: () => t('Veo, Kling et Seedance au prix publié par fal.ai.'),
  replicate: () => t('Veo, Kling et Seedance hébergés par Replicate.'),
  openrouter: () => t('Votre propre compte pour la voix finale et la musique, à la place de celui de Beluga Build.'),
  heygen: () => t('Présentateurs humains réalistes qui disent votre texte, et courtes vidéos générées.'),
  elevenlabs: () => t('Voix off dans toutes les langues, bruitages et musique.'),
};

/* Le libellé d'un champ vient du catalogue partagé : on le traduit ici. */
const LIBELLES_CHAMPS: Record<string, () => string> = {
  'Clé d’API': () => t('Clé d’API'),
  'Identifiant de la clé': () => t('Identifiant de la clé'),
  'Secret de la clé': () => t('Secret de la clé'),
};

function LigneDeService({ service, onChange }: { service: ServiceAffiche; onChange: (liste: ServiceAffiche[]) => void }) {
  const [champs, setChamps] = React.useState<Record<string, string>>({});
  const [enCours, setEnCours] = React.useState<'enregistrer' | 'tester' | null>(null);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [aRetirer, setARetirer] = React.useState(false);
  const [modifier, setModifier] = React.useState(false);
  const saisieOuverte = !service.branche || modifier;
  const complet = service.champs.every((c) => (champs[c.id] ?? '').trim());

  const enregistrer = async () => {
    setEnCours('enregistrer');
    setErreur(null);
    try {
      const data = await client.call<{ services: ServiceAffiche[]; test: ServiceAffiche['test'] }>({ type: 'studio.services.enregistrer', service: service.id, champs });
      onChange(data.services ?? []);
      setChamps({});
      setModifier(false);
    } catch (err: any) {
      setErreur(err?.message ?? t('clé non enregistrée'));
    } finally {
      setEnCours(null);
    }
  };
  const tester = async () => {
    setEnCours('tester');
    try {
      const data = await client.call<{ services: ServiceAffiche[] }>({ type: 'studio.services.tester', service: service.id });
      onChange(data.services ?? []);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('test impossible'));
    } finally {
      setEnCours(null);
    }
  };
  const retirer = async () => {
    try {
      const data = await client.call<{ services: ServiceAffiche[] }>({ type: 'studio.services.retirer', service: service.id });
      onChange(data.services ?? []);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('retrait impossible'));
    }
  };

  const refusee = service.branche && service.test && !service.test.ok;
  return (
    <li className="flex flex-col gap-2 rounded-lg bg-bloc px-3 py-2.5" data-service-creation={service.id} data-branche={service.branche ? 'oui' : 'non'}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-[14px] font-medium text-text">{service.nom}</span>
            {service.branche ? (
              refusee ? (
                <span className="inline-flex items-center gap-1 text-[12px] text-danger" data-service-etat="refusee">
                  <TriangleAlert className="h-3.5 w-3.5" />
                  {t('Clé à revoir')}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[12px] text-termine" data-service-etat="branche">
                  <Check className="h-3.5 w-3.5" />
                  {t('Branché')}
                </span>
              )
            ) : (
              <span className="text-[12px] text-faint" data-service-etat="non-branche">
                {t('Non branché')}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{DESCRIPTIONS[service.id]?.() ?? service.description}</p>
          {service.branche ? (
            <p className="mt-0.5 text-[12px] text-faint">
              {t('Clé se terminant par « {fin} »', { fin: service.fin ?? '' })}
              {service.test ? ` · ${t('testée {quand}', { quand: relativeTime(service.test.le) })}` : ''}
            </p>
          ) : null}
          {refusee ? <p className="mt-0.5 text-[12px] text-danger">{service.test?.raison}</p> : null}
        </div>
        <a
          href={service.adresseCle}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-muted hover:bg-raised hover:text-text"
          title={t('Créer une clé chez {service}', { service: service.nom })}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t('Créer une clé')}
        </a>
      </div>

      {saisieOuverte ? (
        <div className="flex flex-col gap-1.5">
          {service.champs.map((c) => (
            <ChampMotDePasse
              key={c.id}
              autoComplete="off"
              placeholder={LIBELLES_CHAMPS[c.libelle]?.() ?? c.libelle}
              aria-label={c.libelle}
              value={champs[c.id] ?? ''}
              onChange={(e) => setChamps((avant) => ({ ...avant, [c.id]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && complet && !enCours) void enregistrer();
              }}
              data-service-champ={c.id}
            />
          ))}
          {erreur ? (
            <p className="text-[12px] text-danger" data-service-erreur>
              {erreur}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-1.5">
            {modifier ? (
              <Button size="sm" variant="ghost" onClick={() => setModifier(false)}>
                {t('Annuler')}
              </Button>
            ) : null}
            <Button size="sm" disabled={!complet || !!enCours} onClick={() => void enregistrer()} data-service-enregistrer>
              {enCours === 'enregistrer' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {enCours === 'enregistrer' ? t('Test de la clé…') : t('Brancher')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => setModifier(true)}>
            {t('Changer la clé')}
          </Button>
          <Button size="sm" variant="ghost" disabled={!!enCours} onClick={() => void tester()} data-service-tester>
            {enCours === 'tester' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {t('Tester')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setARetirer(true)} data-service-retirer>
            <Trash2 className="h-3.5 w-3.5" />
            {t('Retirer')}
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={aRetirer}
        onClose={() => setARetirer(false)}
        title={t('Retirer {service} ?', { service: service.nom })}
        description={t('Plus aucun agent ne s’en servira. La clé est archivée six mois dans le coffre-fort, puis effacée.')}
        confirmLabel={t('Retirer')}
        danger
        onConfirm={() => {
          setARetirer(false);
          void retirer();
        }}
      />
    </li>
  );
}

export function PageServicesCreation() {
  const { services, setServices } = useServicesDeCreation(true);
  return (
    <div className="flex flex-col gap-3" data-page-services-creation>
      <p className="text-[13px] leading-relaxed text-muted">
        {t('Branchez vos propres comptes : l’agent du Studio s’en sert pour fabriquer les extraits d’une vidéo, et votre compte OpenRouter remplace celui de Beluga Build pour la voix et la musique. Chaque extrait passe d’abord par un devis que vous validez d’un clic.')}{' '}
        {t('Les cartes en mode Réalisation s’en servent aussi pour fabriquer images, vidéos, voix et sons, en annonçant modèle et prix avant chaque génération.')}
      </p>
      {services === null ? (
        <p className="flex items-center gap-2 text-[13px] text-faint">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('Chargement…')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {services.map((s) => (
            <LigneDeService key={s.id} service={s} onChange={setServices} />
          ))}
        </ul>
      )}
    </div>
  );
}
