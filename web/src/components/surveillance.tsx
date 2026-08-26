import * as React from 'react';
import { Activity, CheckCircle2, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  LIBELLE_RAISON,
  NOM_SITE_MAX,
  type SiteSurveille,
  URL_SITE_MAX,
  apaisement,
} from '@haikodev/shared';
import {
  Badge,
  Button,
  ConfirmDialog,
  DialogTitle,
  Drawer,
  Input,
  ZoneDefilement,
} from '@/components/ui';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { formatRegional, t } from '@/lib/langue';

/**
 * LA SURVEILLANCE DES SITES — un tiroir, une liste d'adresses, leur état.
 *
 * Ce que la fenêtre montre vient du MAGASIN, jamais d'une copie locale : la
 * pastille du menu et cette liste lisent la même chose, donc elles ne peuvent
 * pas se contredire. Une tournée du serveur les met à jour toutes les deux,
 * fenêtre ouverte ou fermée.
 *
 * EN HAUT, DEUX BANDEAUX QUI NE COEXISTENT JAMAIS : ce qui est tombé (rouge,
 * nommé), ou l'apaisement (vert) quand tout est revenu après une panne récente.
 * Sans le second, la pastille s'éteindrait sans rien dire, et on se demanderait
 * si le problème est réglé ou si la surveillance a lâché.
 */

function quand(instant: number): string {
  if (!instant) return t('jamais');
  return new Date(instant).toLocaleTimeString(formatRegional(), { hour: '2-digit', minute: '2-digit' });
}

export function Surveillance({ open, onClose }: { open: boolean; onClose: () => void }) {
  const state = useApp();
  const sites = state.surveillance;
  const [url, setUrl] = React.useState('');
  const [nom, setNom] = React.useState('');
  const [ajoutEnCours, setAjoutEnCours] = React.useState(false);
  const [verifEnCours, setVerifEnCours] = React.useState(false);
  const [aSupprimer, setASupprimer] = React.useState<SiteSurveille | null>(null);

  // La liste vit dans le magasin, mais le serveur ne la rediffuse qu'aux
  // changements : à l'ouverture, on la redemande une fois — un onglet resté
  // ouvert toute la nuit doit montrer l'état d'aujourd'hui.
  React.useEffect(() => {
    if (!open) return;
    client.send({ type: 'surveillance.lister' });
  }, [open]);

  const enPanne = sites.filter((site) => site.etat === 'panne');
  const apaise = apaisement(sites, Date.now());

  const ajouter = async () => {
    const adresse = url.trim();
    if (!adresse) return;
    setAjoutEnCours(true);
    try {
      await client.call({ type: 'surveillance.ajouter', url: adresse, nom: nom.trim() || undefined });
      setUrl('');
      setNom('');
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Adresse non ajoutée'));
    } finally {
      setAjoutEnCours(false);
    }
  };

  const verifier = async () => {
    setVerifEnCours(true);
    try {
      await client.call({ type: 'surveillance.verifier' }, 90_000);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Vérification impossible'));
    } finally {
      setVerifEnCours(false);
    }
  };

  const supprimer = async (site: SiteSurveille) => {
    try {
      await client.call({ type: 'surveillance.supprimer', id: site.id });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Adresse non retirée'));
    }
  };

  return (
    <>
      <Drawer open={open} onClose={onClose}>
        <header className="flex shrink-0 flex-wrap items-center gap-2 px-3 pb-2">
          <Activity className="h-3.5 w-3.5 shrink-0 text-accent" />
          <DialogTitle className="min-w-0 flex-1 truncate">{t('Surveillance')}</DialogTitle>
          <Button
            variant="secondary"
            size="sm"
            data-surveillance-verifier
            disabled={verifEnCours || !sites.length}
            onClick={() => void verifier()}
          >
            {verifEnCours ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            {t('Vérifier maintenant')}
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

        {/* L'ajout : l'adresse suffit, le nom se devine du domaine. */}
        <div className="shrink-0 px-3 pb-2">
          <form
            className="flex flex-wrap items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void ajouter();
            }}
          >
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              maxLength={URL_SITE_MAX}
              placeholder={t('exemple.ch')}
              className="h-8 min-w-0 flex-[2] text-[13px]"
              autoComplete="off"
              spellCheck={false}
              data-surveillance-url
            />
            <Input
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              maxLength={NOM_SITE_MAX}
              placeholder={t('Nom (facultatif)')}
              className="h-8 min-w-0 flex-1 text-[13px]"
              autoComplete="off"
              data-surveillance-nom
            />
            <Button type="submit" variant="secondary" size="sm" disabled={ajoutEnCours} data-surveillance-ajouter>
              {ajoutEnCours ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              {t('Ajouter')}
            </Button>
          </form>
        </div>

        <ZoneDefilement fond="hsl(var(--surface))" className="px-2 pb-3">
          {!sites.length ? (
            <p className="px-1 py-3 text-[12.5px] text-faint">
              {t('Aucune adresse surveillée. Ajoutez-en une ci-dessus.')}
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {sites.map((site) => (
                <LigneSite key={site.id} site={site} onSupprimer={() => setASupprimer(site)} />
              ))}
            </div>
          )}
        </ZoneDefilement>
      </Drawer>

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

/** Une adresse : son nom, son état, et ce qui cloche quand ça cloche. */
function LigneSite({ site, onSupprimer }: { site: SiteSurveille; onSupprimer: () => void }) {
  const panne = site.etat === 'panne';
  const raison = site.raison ? t(LIBELLE_RAISON[site.raison]) : '';
  return (
    <div
      data-surveillance-site={site.id}
      data-etat={site.etat}
      className="flex w-full items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-2"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">{site.nom}</span>
          {panne ? (
            <Badge tone="danger" data-surveillance-etat="panne">
              {raison || t('En panne')}
              {site.code ? ` ${site.code}` : ''}
            </Badge>
          ) : site.etat === 'ok' ? (
            <Badge tone="success" data-surveillance-etat="ok">
              {t('En ligne')}
            </Badge>
          ) : (
            <Badge tone="neutral" data-surveillance-etat="inconnu">
              {t('Pas encore vérifié')}
            </Badge>
          )}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-faint">
          <span className="truncate">{site.url}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0">{t('vu à {heure}', { heure: quand(site.verifieLe) })}</span>
        </span>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Retirer"
        data-surveillance-supprimer={site.id}
        onClick={onSupprimer}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
