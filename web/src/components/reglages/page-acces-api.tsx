import * as React from 'react';
import {
  Copy,
  KeyRound,
  Loader2,
  Plus,
  ShieldOff,
  Trash2,
} from 'lucide-react';
import {
  CleApiPublique,
  NOM_CLE_MAX,
  PREFIXE_CLE_API,
  ROUTE_CARTE_EXTERNE,
  ROUTE_DOC_API,
  jugerNomDeCle,
} from '@beluga/shared';
import {
  BulleInfo,
  Badge,
  Button,
  ConfirmDialog,
  Input,
} from '@/components/ui';
import { client } from '@/lib/client';
import { relativeTime } from '@/lib/utils';
import { t } from '@/lib/langue';


export function SectionClesApi({ open }: { open: boolean }) {
  const [cles, setCles] = React.useState<CleApiPublique[]>([]);
  const [nom, setNom] = React.useState('');
  const [enCours, setEnCours] = React.useState(false);
  const [secret, setSecret] = React.useState<{ nom: string; valeur: string } | null>(null);
  const [aRevoquer, setARevoquer] = React.useState<CleApiPublique | null>(null);

  React.useEffect(() => {
    if (!open) return;
    client.call<{ cles: CleApiPublique[] }>({ type: 'cleApi.lister' }).then((data) => setCles(data.cles ?? []));
  }, [open]);

  const creer = async () => {
    const juge = jugerNomDeCle(nom);
    if (!juge.ok) {
      client.pushToast('error', juge.raison);
      return;
    }
    setEnCours(true);
    try {
      const data = await client.call<{ secret: string; cles: CleApiPublique[] }>({
        type: 'cleApi.creer',
        nom: juge.nom,
      });
      setCles(data.cles ?? []);
      setSecret({ nom: juge.nom, valeur: data.secret });
      setNom('');
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('clé non créée'));
    } finally {
      setEnCours(false);
    }
  };

  const revoquer = async (cle: CleApiPublique) => {
    const data = await client.call<{ cles: CleApiPublique[] }>({ type: 'cleApi.revoquer', id: cle.id });
    setCles(data.cles ?? []);
    client.pushToast('success', t('Clé « {v0} » révoquée : les appels suivants sont refusés.', { v0: cle.nom }));
  };

  const oublier = async (cle: CleApiPublique) => {
    try {
      const data = await client.call<{ cles: CleApiPublique[] }>({ type: 'cleApi.oublier', id: cle.id });
      setCles(data.cles ?? []);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('clé non retirée'));
    }
  };

  const vivantes = cles.filter((c) => !c.revoqueeLe);

  return (
    <section>
      <h3 className="flex items-center gap-1.5 text-[13.5px] font-medium text-text mb-3">
        <KeyRound className="h-3.5 w-3.5 text-faint" />  {t('Clés des services extérieurs')}
  <BulleInfo cote="start">{t('Une clé permet à un service du dehors — une boîte mail, un formulaire, un automate — de poser une carte dans un projet, sans ouvrir cette application. La carte arrive dans « À planifier » et attend son lancement, comme n\'importe quelle autre.')}</BulleInfo>
</h3>


      {/* Fabriquer une clé */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void creer();
          }}
          placeholder={t('Nom du service (« boîte mail »…)')}
          className="h-7 w-56 text-[12.5px]"
          maxLength={NOM_CLE_MAX}
          autoComplete="off"
        />
        <Button variant="subtle" size="sm" onClick={creer} disabled={enCours || !nom.trim()}>
          {enCours ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          
{t('Générer une clé')}
</Button>
      </div>

      {/* La clé en clair : une seule fois, ici et jamais plus */}
      {secret ? (
        <div className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2">
          <p className="text-[12.5px] font-medium text-warning">
            {t('Clé de « {v0} » — copiez-la maintenant, elle ne sera plus jamais affichée.', { v0: secret.nom })}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <code className="min-w-0 flex-1 break-all rounded bg-raised px-2 py-1 text-[12px] text-text">
              {secret.valeur}
            </code>
            <Button
              variant="subtle"
              size="sm"
              onClick={() => {
                void navigator.clipboard?.writeText(secret.valeur);
                client.pushToast('success', t('Clé copiée'));
              }}
            >
              <Copy className="h-3 w-3" />  {t('Copier')}
</Button>
            <Button variant="ghost" size="sm" onClick={() => setSecret(null)}>
              {t('J\'ai noté')}</Button>
          </div>
        </div>
      ) : null}

      {/* La liste */}
      <div className="mt-3 space-y-1">
        {cles.length === 0 ? (
          <p className="text-[12.5px] text-faint">{t('Aucune clé pour l\'instant.')}</p>
        ) : (
          cles.map((cle) => (
            <div
              key={cle.id}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border bg-bloc px-2.5 py-2"
            >
              <span className="text-[13px] text-text">{cle.nom}</span>
              <code className="rounded bg-raised px-1.5 py-0.5 text-[11.5px] text-faint">{cle.apercu}…</code>
              {cle.revoqueeLe ? (
                <Badge tone="danger">{t('révoquée {v0}', { v0: relativeTime(cle.revoqueeLe) })}</Badge>
              ) : (
                <Badge tone="success">{t('active')}</Badge>
              )}
              <span className="text-[12px] text-faint">{t('créée {v0}', { v0: relativeTime(cle.creeeLe) })}</span>
              <span className="text-[12px] text-faint">
                {cle.cartesCreees
                  ? t('{v0} carte(s) · dernier appel {v1}', { v0: cle.cartesCreees, v1: relativeTime(cle.dernierUsageLe ?? cle.creeeLe) })
                  : t('jamais utilisée')}
              </span>
              <div className="ml-auto flex items-center gap-1">
                {cle.revoqueeLe ? (
                  <Button variant="ghost" size="sm" onClick={() => oublier(cle)}>
                    <Trash2 className="h-3 w-3" />  {t('Retirer')}
</Button>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setARevoquer(cle)}>
                    <ShieldOff className="h-3 w-3" />  {t('Révoquer')}
</Button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Le mode d'emploi, avec l'adresse réelle de cette application */}
      <div className="mt-4 rounded-md border border-border bg-bloc px-2.5 py-2">
        <p className="flex items-center gap-1 text-[12.5px] font-medium text-text">{t('Comment s\'en servir')}<BulleInfo cote="start">{t('Le service envoie un POST à l\'adresse ci-dessous, avec sa clé dans l\'en-tête et, dans le corps, le projet visé (son nom suffit), un titre et une description.')}</BulleInfo></p>
        <pre className="mt-1.5 overflow-x-auto rounded bg-raised px-2 py-1.5 text-[11.5px] leading-relaxed text-muted">
          {exempleDAppel()}
        </pre>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-faint">
          {vivantes.length
            ? t('{v0} clé(s) active(s). Une clé révoquée fait refuser l\'appel aussitôt.', { v0: vivantes.length })
            : t('Aucune clé active : tout appel extérieur est refusé.')}
        </p>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-faint">
          
{t('Le mode d\'emploi complet — champs acceptés, réponses, refus — est publié à l\'adresse')}{' '}
          <a
            href={ROUTE_DOC_API}
            target="_blank"
            rel="noreferrer"
            className="text-text underline decoration-border underline-offset-2 hover:decoration-muted"
          >
            {ROUTE_DOC_API}
          </a>
          
{t(', lisible sans compte : c\'est la page à donner au service qu\'on branche.')}
</p>
      </div>

      <ConfirmDialog
        open={!!aRevoquer}
        title={t('Révoquer « {v0} » ?', { v0: aRevoquer?.nom })}
        description={t('Le service qui s’en sert ne pourra plus créer de carte. Les cartes déjà créées restent en place.')}
        confirmLabel={t('Révoquer')}
        danger
        onConfirm={async () => {
          if (aRevoquer) await revoquer(aRevoquer);
        }}
        onClose={() => setARevoquer(null)}
      />
    </section>
  );
}

/**
 * LE GÉNÉRATEUR DE CLÉS.
 *
 * Une clé par service extérieur : la boîte mail qui pose une carte à l'arrivée
 * d'un message de client, un formulaire, un automate. Chaque clé porte son nom,
 * sa date de création et se révoque d'un clic.
 *
 * Le SECRET n'est montré qu'UNE FOIS, à sa fabrication : le serveur n'en garde
 * qu'une empreinte. Perdue, une clé ne se retrouve pas — on en fabrique une
 * autre et on révoque l'ancienne.
 */
/** L'appel à recopier, avec l'adresse RÉELLE de cette application — jamais un exemple abstrait. */
export function exempleDAppel(): string {
  const racine = typeof window === 'undefined' ? '' : window.location.origin;
  const corps = JSON.stringify({
    projet: t('Nom du projet'),
    titre: t('Mail de M. Dupont'),
    description: t('Ce qu’il demande, tel quel.'),
  });
  return [
    `curl -X POST ${racine}${ROUTE_CARTE_EXTERNE} \\`,
    `  -H "x-beluga-cle: ${PREFIXE_CLE_API}…" \\`,
    '  -H "content-type: application/json" \\',
    `  -d '${corps}'`,
  ].join('\n');
}
