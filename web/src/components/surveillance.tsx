import * as React from 'react';
import { Activity, CheckCircle2, ExternalLink, Loader2, Plus, RefreshCw, Send, Sparkles, Trash2 } from 'lucide-react';
import {
  type Agent,
  type CaseDeFrise,
  type ControleSurveillance,
  DEMANDE_SURVEILLANCE_MAX,
  LIBELLE_RAISON,
  PERIODE_SURVEILLANCE_MS,
  type SiteSurveille,
  apaisement,
  disponibilite24h,
  frise24h,
  raisonDemandeSurveillanceRefusee,
} from '@beluga/shared';
import {
  BulleInfo,
  Badge,
  Button,
  ConfirmDialog,
  DialogTitle,
  Drawer,
  SelecteurTiroir,
  Textarea,
  Tooltip,
  ZoneDefilement,
} from '@/components/ui';
import { SilhouetteSurveillance } from '@/components/silhouettes';
import { Chat } from '@/components/chat';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { formatRegional, t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import { useElementAdresse } from '@/lib/adresse-element';

/**
 * LA SURVEILLANCE DES SITES — une liste, et un tiroir par surveillance.
 *
 * Ce que la fenêtre montre vient du MAGASIN, jamais d'une copie locale : la
 * pastille du menu et cette liste lisent la même chose. Une tournée du serveur
 * les met à jour toutes les deux, fenêtre ouverte ou fermée.
 *
 * ON NE TAPE PLUS UNE ADRESSE, ON PARLE À UN AGENT. « Nouvelle surveillance »
 * ouvre un tiroir empilé (la liste reste ouverte derrière) où une phrase lance
 * l'agent de surveillance ; sa conversation s'y suit aussitôt. Un clic sur une
 * ligne ouvre le tiroir de CETTE surveillance : son état, la frise de ses
 * contrôles des dernières 24 heures, et la conversation de son agent pour la
 * modifier.
 *
 * EN HAUT, DEUX BANDEAUX QUI NE COEXISTENT JAMAIS : ce qui est tombé (rouge,
 * nommé), ou l'apaisement (vert) quand tout est revenu après une panne récente.
 */

function quand(instant: number): string {
  if (!instant) return t('jamais');
  return new Date(instant).toLocaleTimeString(formatRegional(), { hour: '2-digit', minute: '2-digit' });
}

function rythme(site: SiteSurveille): string {
  return t('toutes les {n} min', { n: Math.round((site.periodeMs ?? PERIODE_SURVEILLANCE_MS) / 60_000) });
}

export function Surveillance({
  open,
  onClose,
  enPage,
  vise,
  onVise,
}: {
  open: boolean;
  onClose: () => void;
  /** Écran plein du volet central, au lieu d'un tiroir posé par-dessus. */
  enPage?: boolean;
  /** LE SITE DÉSIGNÉ PAR L'ADRESSE : « #surveillance/<id> ». */
  vise?: string | null;
  /** …et le site ouvert, remonté pour que l'adresse le décrive. */
  onVise?: (siteId: string | null) => void;
}) {
  const state = useApp();
  const sites = state.surveillance;
  const [verifEnCours, setVerifEnCours] = React.useState(false);
  const [aSupprimer, setASupprimer] = React.useState<SiteSurveille | null>(null);
  /** Le tiroir ouvert : une surveillance, ou « nouvelle ». */
  const [tiroir, setTiroir] = React.useState<{ siteId: string } | { nouvelle: true } | null>(null);

  // La liste vit dans le magasin, mais le serveur ne la rediffuse qu'aux
  // changements : à l'ouverture, on la redemande une fois.
  React.useEffect(() => {
    if (!open) return;
    client.send({ type: 'surveillance.lister' });
  }, [open]);

  /*
   * LE TIROIR D'UN SITE EST UNE DESTINATION, « nouvelle surveillance » NON :
   * un formulaire en cours de saisie n'a pas d'adresse à partager, et ne doit
   * pas se rouvrir tout seul au rechargement.
   */
  useElementAdresse({
    vise,
    onVise,
    ouvertId: tiroir && 'siteId' in tiroir ? tiroir.siteId : null,
    /* La liste vit dans le magasin : tant qu'elle est vide, elle n'est pas
       « sans le site visé », elle n'est pas encore arrivée. */
    pret: sites.length > 0,
    absent: t('Ce site n’est plus surveillé.'),
    ouvrir: (id) => {
      if (!sites.some((site) => site.id === id)) return false;
      setTiroir({ siteId: id });
      return true;
    },
  });

  const enPanne = sites.filter((site) => site.etat === 'panne');
  const apaise = apaisement(sites, Date.now());

  const verifier = async () => {
    setVerifEnCours(true);
    try {
      await client.call({ type: 'surveillance.verifier' }, 120_000);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Vérification impossible'));
    } finally {
      setVerifEnCours(false);
    }
  };

  const supprimer = async (site: SiteSurveille) => {
    try {
      await client.call({ type: 'surveillance.supprimer', id: site.id });
      setTiroir((actuel) => (actuel && 'siteId' in actuel && actuel.siteId === site.id ? null : actuel));
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Adresse non retirée'));
    }
  };

  return (
    <>
      <Drawer open={open} onClose={onClose} enPage={enPage}>
        <header className="flex shrink-0 flex-wrap items-center gap-2 px-3 pb-2">
          <Activity className="h-3.5 w-3.5 shrink-0 text-accent" />
          <DialogTitle className="min-w-0 flex-1 truncate">{t('Surveillance')}</DialogTitle>
          <Button
            variant="subtle"
            size="sm"
            data-surveillance-verifier
            disabled={verifEnCours || !sites.length}
            onClick={() => void verifier()}
          >
            {verifEnCours ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            {t('Vérifier maintenant')}
          </Button>
          <Button variant="subtle" size="sm" data-surveillance-nouvelle onClick={() => setTiroir({ nouvelle: true })}>
            <Plus className="h-3 w-3" />
            {t('Nouvelle surveillance')}
          </Button>
        </header>

        {/* Le bandeau : ce qui est tombé, ou l'apaisement. Jamais les deux. */}
        {enPanne.length ? (
          <div
            data-surveillance-bandeau="panne"
            className="mx-3 mb-2 shrink-0 rounded-md border border-danger/30 bg-danger/10 px-2.5 py-2 text-[12.5px] text-danger"
          >
            {enPanne.length > 1
              ? t('{n} sites ne répondent plus.', { n: enPanne.length })
              : t('{site} ne répond plus.', { site: enPanne[0].nom })}
          </div>
        ) : apaise ? (
          <div
            data-surveillance-bandeau="apaise"
            className="mx-3 mb-2 flex shrink-0 items-center gap-1.5 rounded-md border border-success/30 bg-success/10 px-2.5 py-2 text-[12.5px] text-success"
          >
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            {t('Tout est revenu en ligne.')}
          </div>
        ) : null}

        <ZoneDefilement fond="hsl(var(--surface))" className="px-2 pb-3">
          {!state.surveillanceRecue ? (
            /* RIEN N'EST ENCORE ARRIVÉ : la liste est vide parce qu'on ne la
               connaît pas, pas parce qu'aucune adresse n'est surveillée. */
            <SilhouetteSurveillance />
          ) : !sites.length ? (
            <p className="px-1 py-3 text-[12.5px] text-faint">
              {t('Aucune surveillance pour l’instant. Créez-en une avec l’agent.')}
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {sites.map((site) => (
                <LigneSite
                  key={site.id}
                  site={site}
                  onOuvrir={() => setTiroir({ siteId: site.id })}
                  onSupprimer={() => setASupprimer(site)}
                />
              ))}
            </div>
          )}
        </ZoneDefilement>
      </Drawer>

      <TiroirSurveillance
        cible={tiroir}
        site={tiroir && 'siteId' in tiroir ? (sites.find((s) => s.id === tiroir.siteId) ?? null) : null}
        onClose={() => setTiroir(null)}
        onSupprimer={(site) => setASupprimer(site)}
      />

      <ConfirmDialog
        open={aSupprimer !== null}
        title={t('Ne plus surveiller cette adresse ?')}
        description={aSupprimer?.url}
        confirmLabel={t('Retirer')}
        danger
        onConfirm={() => {
          const site = aSupprimer;
          setASupprimer(null);
          if (site) void supprimer(site);
        }}
        onClose={() => setASupprimer(null)}
      />
    </>
  );
}

/** La pastille d'état d'une surveillance : la même dans la liste et dans le tiroir. */
function BadgeEtat({ site }: { site: SiteSurveille }) {
  if (site.etat === 'panne') {
    const raison = site.raison ? t(LIBELLE_RAISON[site.raison]) : '';
    return (
      <Badge tone="danger" data-surveillance-etat="panne">
        {raison || t('En panne')}
        {site.code ? ` ${site.code}` : ''}
      </Badge>
    );
  }
  if (site.etat === 'ok')
    return (
      <Badge tone="success" data-surveillance-etat="ok">
        {t('En ligne')}
      </Badge>
    );
  return (
    <Badge tone="neutral" data-surveillance-etat="inconnu">
      {t('Pas encore vérifié')}
    </Badge>
  );
}

/** Une surveillance : son nom, son état, son rythme. Un clic ouvre son tiroir. */
function LigneSite({
  site,
  onOuvrir,
  onSupprimer,
}: {
  site: SiteSurveille;
  onOuvrir: () => void;
  onSupprimer: () => void;
}) {
  return (
    <div
      data-surveillance-site={site.id}
      data-etat={site.etat}
      role="button"
      tabIndex={0}
      onClick={onOuvrir}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOuvrir();
        }
      }}
      className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-border bg-bloc px-2.5 py-2 text-left hover:bg-surface"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">{site.nom}</span>
          <BadgeEtat site={site} />
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-faint">
          <span className="truncate">{site.url}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0">{t('vu à {heure}', { heure: quand(site.verifieLe) })}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0">{rythme(site)}</span>
        </span>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Retirer"
        data-surveillance-supprimer={site.id}
        onClick={(e) => {
          e.stopPropagation();
          onSupprimer();
        }}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/**
 * LE TIROIR D'UNE SURVEILLANCE, empilé sur la liste. Pour une surveillance :
 * l'état, la frise des 24 heures, puis la conversation de son agent. Pour une
 * nouvelle : la phrase qui lance l'agent, puis sa conversation.
 */
function TiroirSurveillance({
  cible,
  site,
  onClose,
  onSupprimer,
}: {
  cible: { siteId: string } | { nouvelle: true } | null;
  site: SiteSurveille | null;
  onClose: () => void;
  onSupprimer: (site: SiteSurveille) => void;
}) {
  const state = useApp();
  /** L'agent lancé depuis ce tiroir, avant qu'il n'ait enregistré quoi que ce soit. */
  const [depart, setDepart] = React.useState<{ agentId: string; projectId: string } | null>(null);

  React.useEffect(() => setDepart(null), [cible && 'siteId' in cible ? cible.siteId : cible ? 'nouvelle' : null]);

  const agentId = depart?.agentId ?? site?.agentId;
  const projectId = depart?.projectId ?? site?.projectId;
  const agent: Agent | null = agentId ? (state.agents[agentId] ?? null) : null;

  // La conversation peut n'être jamais passée par ce navigateur : on la réclame.
  React.useEffect(() => {
    if (agentId) void client.chargerAgent(agentId);
  }, [agentId]);

  const ouvert = cible !== null && ('nouvelle' in cible || site !== null);

  return (
    <Drawer open={ouvert} onClose={onClose} empile className="h-[92dvh]">
      <header className="flex shrink-0 items-center gap-2 px-3 pb-2">
        {site ? <Activity className="h-3.5 w-3.5 shrink-0 text-accent" /> : <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" />}
        <DialogTitle className="min-w-0 flex-1 truncate">{site ? site.nom : t('Nouvelle surveillance')}</DialogTitle>
        {site ? <BadgeEtat site={site} /> : null}
      </header>
      <div className="flex min-h-0 flex-1 flex-col" data-surveillance-tiroir={site?.id ?? 'nouvelle'}>
        {site ? <EtatEtHistorique site={site} onSupprimer={() => onSupprimer(site)} /> : null}
        {agent && projectId ? (
          <div className="flex min-h-0 flex-1 flex-col border-t border-border" data-surveillance-conversation={agent.id}>
            <Chat agent={agent} projectId={projectId} />
          </div>
        ) : agentId ? (
          <div className="flex flex-1 items-center justify-center text-faint">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : (
          <DemandeALAgent
            site={site}
            onLance={(d) => {
              client.setActiveProject(d.projectId);
              setDepart(d);
            }}
          />
        )}
      </div>
    </Drawer>
  );
}

/** L'en-tête du tiroir : ce qui est vérifié, les gestes, et la frise des 24 heures. */
function EtatEtHistorique({ site, onSupprimer }: { site: SiteSurveille; onSupprimer: () => void }) {
  const [controles, setControles] = React.useState<ControleSurveillance[] | null>(null);
  const [verifEnCours, setVerifEnCours] = React.useState(false);
  const [choisie, setChoisie] = React.useState<CaseDeFrise | null>(null);

  // L'historique se charge à l'ouverture, et se relit après chaque passage.
  React.useEffect(() => {
    let vivant = true;
    client
      .call<{ controles: ControleSurveillance[] }>({ type: 'surveillance.historique', id: site.id })
      .then((r) => vivant && setControles(r.controles))
      .catch(() => vivant && setControles([]));
    return () => {
      vivant = false;
    };
  }, [site.id, site.verifieLe]);

  const maintenant = Date.now();
  const cases = controles ? frise24h(controles, maintenant) : [];
  const dispo = controles ? disponibilite24h(controles, maintenant) : null;
  const recette = site.recette;

  const verifier = async () => {
    setVerifEnCours(true);
    try {
      await client.call({ type: 'surveillance.verifier', id: site.id }, 120_000);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Vérification impossible'));
    } finally {
      setVerifEnCours(false);
    }
  };

  return (
    <div className="flex shrink-0 flex-col gap-2 px-3 pb-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-faint">
        <span className="min-w-0 truncate">{site.url}</span>
        <span aria-hidden>·</span>
        <span>{rythme(site)}</span>
        <span aria-hidden>·</span>
        <span data-surveillance-recette={recette?.type ?? 'appel'}>
          {recette?.type === 'parcours'
            ? t('Parcours de {n} étapes', { n: recette.etapes.length })
            : recette?.motAttendu
              ? t('« {mot} » doit figurer sur la page', { mot: recette.motAttendu })
              : t('Simple appel de la page')}
        </span>
      </div>
      {site.etat === 'panne' && site.etapeEchouee ? (
        <p className="text-[12px] text-danger" data-surveillance-etape-echouee>
          {t('Étape en échec : {etape}', { etape: site.etapeEchouee })}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="subtle" size="sm" disabled={verifEnCours} onClick={() => void verifier()} data-surveillance-verifier-site>
          {verifEnCours ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          {t('Vérifier maintenant')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onSupprimer} data-surveillance-retirer-site>
          <Trash2 className="h-3 w-3" />
          {t('Retirer')}
        </Button>
      </div>

      <ProjetDuSite site={site} />

      <div className="flex flex-col gap-1" data-surveillance-frise={controles ? controles.length : 'chargement'}>
        <div className="flex items-baseline gap-2 text-[12px]">
          <span className="min-w-0 flex-1 text-text">{t('Contrôles des dernières 24 heures')}</span>
          {dispo !== null ? (
            <span className="text-faint" data-surveillance-disponibilite>
              {t('Disponibilité : {pourcentage}', { pourcentage: `${Math.round(dispo * 1000) / 10} %` })}
            </span>
          ) : null}
        </div>
        {controles === null ? (
          <div className="h-6 animate-pulse rounded-sm bg-faint/15" />
        ) : (
          <div className="flex h-6 items-stretch gap-px" role="list">
            {cases.map((c) => (
              <Tooltip key={c.debut} label={libelleDeCase(c)}>
                <button
                  type="button"
                  role="listitem"
                  aria-label={libelleDeCase(c)}
                  data-surveillance-case={c.etat}
                  onClick={() => setChoisie((actuelle) => (actuelle?.debut === c.debut ? null : c))}
                  className={cn(
                    'min-w-0 flex-1 rounded-[2px]',
                    c.etat === 'ok' ? 'bg-success' : c.etat === 'panne' ? 'bg-danger' : 'bg-faint/20',
                    choisie?.debut === c.debut && 'ring-1 ring-faint',
                  )}
                />
              </Tooltip>
            ))}
          </div>
        )}
        {controles && !controles.length ? (
          <p className="text-[12px] text-faint">{t('Aucun contrôle sur les dernières 24 heures.')}</p>
        ) : null}
        {choisie ? <DetailDeCase tranche={choisie} /> : null}
      </div>
    </div>
  );
}

/**
 * LE PROJET DU SITE — celui où s'ouvrira la carte d'une panne répétée.
 *
 * À ne pas confondre avec le projet où vit la conversation de l'agent qui a
 * écrit la recette : ce menu-là désigne le DÉPÔT QUI SERT LE SITE. Laissé « à
 * deviner d'après l'adresse », il se remplit tout seul en comparant l'adresse
 * du site à celles que les projets connaissent, et la ligne le dit.
 *
 * Quand une panne est ouverte, un bouton mène droit à sa carte.
 */
function ProjetDuSite({ site }: { site: SiteSurveille }) {
  const state = useApp();
  const [enCours, setEnCours] = React.useState(false);
  /** « À deviner d'après l'adresse » : la valeur vide du menu. */
  const options = React.useMemo(
    () => [
      { valeur: '', libelle: t('À deviner d’après l’adresse') },
      ...state.projects
        .filter((p) => !p.archived)
        .map((p) => ({ valeur: p.id, libelle: p.name })),
    ],
    [state.projects],
  );
  const choisir = async (valeur: string) => {
    setEnCours(true);
    try {
      await client.call({ type: 'surveillance.rattacher', id: site.id, projectId: valeur || null });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Projet non rattaché'));
    } finally {
      setEnCours(false);
    }
  };

  return (
    <div className="flex flex-col gap-1" data-surveillance-projet={site.projetRattache ?? ''}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="text-[12px] text-text">{t('Projet de ce site')}</span>
        {enCours ? <Loader2 className="h-3 w-3 animate-spin text-faint" /> : null}
        <SelecteurTiroir
          valeur={site.projetRattache ?? ''}
          options={options}
          onChoisir={(valeur) => void choisir(valeur)}
          titre={t('Projet de ce site')}
          placeholder={t('À deviner d’après l’adresse')}
          repere="surveillance-projet"
          empile
        />
      </div>
      {site.projetDevine && site.projetRattache ? (
        <p className="text-[12px] text-faint" data-surveillance-projet-devine>
          {t('Projet deviné d’après l’adresse du site. Corrigez-le si ce n’est pas le bon.')}
        </p>
      ) : null}
      {site.incidentCardId ? (
        <div className="flex">
          <Button
            variant="subtle"
            size="sm"
            data-surveillance-carte-panne={site.incidentCardId}
            onClick={() => client.allerVersDecision({ cardId: site.incidentCardId })}
          >
            <ExternalLink className="h-3 w-3" />
            {t('Ouvrir la carte de la panne')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function libelleDeCase(c: CaseDeFrise): string {
  const tranche = `${quand(c.debut)} – ${quand(c.fin)}`;
  if (c.etat === 'vide') return `${tranche} · ${t('Aucun contrôle')}`;
  const pannes = c.controles.filter((x) => x.etat === 'panne').length;
  return `${tranche} · ${t('{n} contrôles, {pannes} en panne', { n: c.controles.length, pannes })}`;
}

/** Les passages d'une tranche, touchée ou cliquée : l'heure, le résultat, la raison. */
function DetailDeCase({ tranche }: { tranche: CaseDeFrise }) {
  return (
    // Une liste courte : pas de fondu, qui mangerait la moitié de sa hauteur.
    <ZoneDefilement voile={false} classeEnveloppe="max-h-32">
    <ul className="flex flex-col gap-0.5 text-[12px]" data-surveillance-detail>
      {tranche.controles.length ? (
        tranche.controles.map((c) => (
          <li key={c.instant} className={cn('flex flex-wrap gap-x-1.5', c.etat === 'panne' ? 'text-danger' : 'text-faint')}>
            <span>{quand(c.instant)}</span>
            <span>{c.etat === 'ok' ? t('En ligne') : c.raison ? t(LIBELLE_RAISON[c.raison]) : t('En panne')}</span>
            {c.code ? <span>{c.code}</span> : null}
            <span>{t('{duree} ms', { duree: c.dureeMs })}</span>
            {c.etape ? <span className="min-w-0 truncate">{c.etape}</span> : null}
          </li>
        ))
      ) : (
        <li className="text-faint">{t('Aucun contrôle')}</li>
      )}
    </ul>
    </ZoneDefilement>
  );
}

/** La phrase qui lance l'agent : créer une surveillance, ou modifier celle-ci. */
function DemandeALAgent({
  site,
  onLance,
}: {
  site: SiteSurveille | null;
  onLance: (depart: { agentId: string; projectId: string }) => void;
}) {
  const [demande, setDemande] = React.useState('');
  const [enCours, setEnCours] = React.useState(false);
  const refus = raisonDemandeSurveillanceRefusee(demande);

  const lancer = async () => {
    setEnCours(true);
    try {
      const depart = await client.call<{ agentId: string; projectId: string }>({
        type: 'surveillance.assistant',
        demande,
        ...(site ? { id: site.id } : {}),
      });
      setDemande('');
      onLance(depart);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('L’agent n’a pas pu démarrer'));
    } finally {
      setEnCours(false);
    }
  };

  return (
    <div className={cn('flex flex-col gap-2 px-3 pb-3', site && 'border-t border-border pt-3')}>
      <Textarea
        value={demande}
        onChange={(e) => setDemande(e.target.value)}
        maxLength={DEMANDE_SURVEILLANCE_MAX}
        rows={4}
        placeholder={t('Ex. : l’espace client de la boutique, se connecter et vérifier que le tableau de bord s’affiche, toutes les 5 minutes')}
        className="text-[13px]"
        data-surveillance-demande
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !refus && !enCours) void lancer();
        }}
      />
      <div className="flex items-center justify-end gap-1.5">
        <BulleInfo>
          {site
          ? t('Dites à l’agent ce qu’il faut changer : un nouveau mot de passe, une autre page à vérifier, un autre rythme.')
          : t(
              'Décrivez ce qu’il faut surveiller : l’adresse, les accès s’il faut se connecter, ce qui doit figurer sur la page et le rythme. L’agent pose ses questions, essaie le contrôle pour de vrai, puis l’enregistre.',
            )}
        </BulleInfo>
        <Button size="sm" disabled={!!refus || enCours} onClick={() => void lancer()} data-surveillance-demander>
          {enCours ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          {t('Demander à l’agent')}
        </Button>
      </div>
    </div>
  );
}
