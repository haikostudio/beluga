import * as React from 'react';
import {
  Archive,
  Check,
  CircleDollarSign,
  Globe,
  Loader2,
  Rocket,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  PROMPT_PRODUCTION_MAX,
  Project,
  TITRE_MISE_EN_PRODUCTION,
  baseDeMiseEnProduction,
  ecrireMiseEnProduction,
  mentionMiseEnProduction,
  promptDeMiseEnProduction,
  rappelDeMiseEnProduction,
} from '@haikodev/shared';
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from '@/components/ui';
import { Filet } from '@/components/filet';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { money } from '@/lib/utils';

interface ClientEntry {
  id: string;
  name: string;
  companyId?: string;
  companyName?: string;
  companySlug?: string;
}

/**
 * Réglages d'un projet, dont le LIEN VERS SON CLIENT (PLAN §7) : une fois posé,
 * les lignes de facture partent en un clic depuis chaque carte.
 */
export function ProjectSettings({
  project,
  open,
  onClose,
}: {
  project: Project | null;
  open: boolean;
  onClose: () => void;
}) {
  const state = useApp();
  const [clients, setClients] = React.useState<ClientEntry[]>([]);
  const [documents, setDocuments] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [available, setAvailable] = React.useState(true);

  const [name, setName] = React.useState('');
  /* La SEULE chose que le déploiement demande de régler : l'adresse de
     l'instance de dev, contrôlée à la fin de chaque déploiement. */
  const [devUrl, setDevUrl] = React.useState('');
  /*
   * LA MISE EN PRODUCTION, en deux textes conservés côte à côte : le concept
   * écrit à la main (`baseProduction`) et le PROMPT que l'agent de mise en
   * production recevra. Un bouton fabrique le second à partir du premier ; il
   * reste modifiable et n'est retenu qu'à l'enregistrement.
   */
  const [baseProduction, setBaseProduction] = React.useState('');
  const [promptProduction, setPromptProduction] = React.useState('');
  const [generation, setGeneration] = React.useState(false);
  const [engine, setEngine] = React.useState<string>('claude');
  const [clientId, setClientId] = React.useState('');
  const [rate, setRate] = React.useState('130');
  const [documentId, setDocumentId] = React.useState('');
  const [documentType, setDocumentType] = React.useState<'offer' | 'invoice'>('invoice');
  const [confirmSuppression, setConfirmSuppression] = React.useState(false);

  React.useEffect(() => {
    if (!project) return;
    setName(project.name);
    setDevUrl(project.devUrl ?? '');
    setBaseProduction(baseDeMiseEnProduction(project));
    setPromptProduction(promptDeMiseEnProduction(project));
    setEngine(project.defaultEngine ?? 'claude');
    setClientId(project.billing?.clientId ?? '');
    setRate(String(project.billing?.hourlyRate ?? 130));
    setDocumentId(project.billing?.defaultDocumentId ?? '');
    setDocumentType(project.billing?.defaultDocumentType ?? 'invoice');
  }, [project?.id, open]);

  React.useEffect(() => {
    if (!open) return;
    setLoading(true);
    client
      .call<{ clients: ClientEntry[]; available: boolean }>({ type: 'billing.clients' }, 120000)
      .then((data) => {
        setClients(data.clients ?? []);
        setAvailable(data.available !== false && (data.clients ?? []).length > 0);
      })
      .catch(() => setAvailable(false))
      .finally(() => setLoading(false));
    client
      .call<{ documents: any[] }>({ type: 'billing.documents' }, 120000)
      .then((data) => setDocuments(data.documents ?? []))
      .catch(() => setDocuments([]));
  }, [open]);

  /*
   * TOUS les réglages internes sont posés PLUS HAUT, avant cette sortie : ils
   * doivent être déclarés dans le même ordre à chaque passage. Quand la fenêtre
   * était fermée (aucun projet) puis ouverte, les déclarer plus bas en ajoutait
   * quatre d'un coup — React arrêtait tout et l'écran devenait noir.
   */
  if (!project) return null;

  const chosen = clients.find((c) => c.id === clientId);

  const save = async () => {
    setSaving(true);
    try {
      await client.call({
        type: 'project.update',
        id: project.id,
        patch: {
          name: name.trim() || project.name,
          defaultEngine: engine,
          devUrl: devUrl.trim() || undefined,
          /* Base et prompt partent ENSEMBLE, par le même `project.update` :
             c'est ici seulement qu'un prompt généré devient le prompt retenu. */
          miseEnProduction: ecrireMiseEnProduction(project.miseEnProduction, {
            base: baseProduction,
            prompt: promptProduction,
          }),
          billing: clientId
            ? {
                clientId,
                clientName: chosen?.name,
                companyId: chosen?.companyId,
                companyName: chosen?.companySlug ?? chosen?.companyName,
                hourlyRate: Number(rate) || 130,
                currency: 'CHF',
                defaultDocumentId: documentId || undefined,
                defaultDocumentType: documentId ? documentType : undefined,
              }
            : undefined,
        },
      });
      client.pushToast('success', 'Réglages du projet enregistrés');
      onClose();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'enregistrement impossible');
    } finally {
      setSaving(false);
    }
  };

  /*
   * Fabriquer le prompt à partir du concept écrit à la main : un tour d'agent
   * PAYANT, qui ne persiste RIEN et ne déploie RIEN. Le texte revient dans le
   * champ modifiable ; seul « Enregistrer » le retient.
   */
  const genererPrompt = async () => {
    if (!baseProduction.trim()) {
      client.pushToast('error', 'Écrivez d’abord ce que vous attendez de la mise en production.');
      return;
    }
    setGeneration(true);
    try {
      // Un tour d'agent peut être long : on laisse dix minutes.
      const res = await client.call<{ ok: boolean; prompt?: string; raison?: string }>(
        { type: 'production.generer', projectId: project.id, base: baseProduction },
        600000,
      );
      if (res.ok && res.prompt) {
        setPromptProduction(res.prompt);
        client.pushToast('success', 'Prompt rédigé. Relisez-le, puis enregistrez.');
      } else {
        client.pushToast('error', res.raison ?? 'la génération n’a rien rendu');
      }
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'génération impossible');
    } finally {
      setGeneration(false);
    }
  };

  const archive = async () => {
    await client.call({ type: 'project.archive', id: project.id, archived: !project.archived });
    onClose();
  };

  const remove = async () => {
    await client.call({ type: 'project.delete', id: project.id });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="sm:w-[min(560px,100%)]">
        <DialogTitle>Réglages du projet</DialogTitle>
        <Filet zone="Réglages du projet" onReprendre={onClose}>

        <div className="mt-4 space-y-3">
          <div>
            <Label>Nom</Label>
            <Input value={name} onChange={(event) => setName(event.target.value)} className="mt-1" />
          </div>

          <div>
            <Label>Moteur par défaut de ce projet</Label>
            <select
              value={engine}
              onChange={(event) => setEngine(event.target.value)}
              className="mt-1 h-8 w-full rounded-md border border-border bg-raised px-2 text-[14.5px] text-text"
            >
              {state.engines
                .filter((e) => e.installed)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
            </select>
            <p className="mt-1 text-[12.5px] text-faint">
              Les nouvelles cartes et le chef de ce projet partiront sur ce moteur.
            </p>
          </div>

          <div className="rounded-md border border-border bg-surface px-2.5 py-2 text-[13px] text-faint">
            Dossier sur le serveur : <span className="text-muted">{project.path}</span>
            {project.gitRemote ? (
              <>
                <br />
                Dépôt : <span className="text-muted">{project.gitRemote}</span>
              </>
            ) : null}
          </div>

          {/* ---------- Publication ---------- */}
          <div data-deploiement>
            <h3 className="mb-1.5 flex items-center gap-1.5 text-[13.5px] font-medium text-text">
              <Rocket className="h-3.5 w-3.5 text-faint" /> Déploiement
            </h3>
            <p className="mb-2 text-[12.5px] leading-snug text-faint">
              Déployer fusionne les branches des cartes, enregistre, envoie sur le dépôt, puis rafraîchit l'instance de
              dev de ce projet sur le serveur. Rien d'autre à régler : HaikoDev reconnaît tout seul la construction et
              le service à relancer.
            </p>

            <div>
              <Label>Adresse à contrôler</Label>
              <Input
                value={devUrl}
                onChange={(event) => setDevUrl(event.target.value)}
                className="mt-1"
                data-url-dev
                placeholder="https://mon-projet.haikostudio.cloud"
              />
              <p className="mt-1 text-[11.5px] text-faint">
                Elle est remplie toute seule à la création du projet, et se corrige ici à la main. Elle est ouverte à la
                fin de chaque déploiement : si elle ne répond pas, le déploiement est déclaré en échec. Laissée vide,
                aucune adresse n'est contrôlée.
              </p>
            </div>

          </div>

          {/* ---------- Mise en production ---------- */}
          {/*
            UN SEUL endroit, UN SEUL texte. Le concept écrit dans vos mots, un
            bouton qui en fabrique le prompt par un agent, et le prompt obtenu
            modifiable puis enregistré. C'est ce prompt que le bouton de mise en
            production suit, la fusion et l'envoi restant à HaikoDev.
          */}
          <div data-mise-en-production>
            <h3 className="mb-1.5 flex items-center gap-1.5 text-[13.5px] font-medium text-text">
              <Rocket className="h-3.5 w-3.5 text-faint" /> {TITRE_MISE_EN_PRODUCTION}
            </h3>
            <p className="mb-2 text-[12.5px] leading-snug text-faint">
              Expliquez comment ce projet se met en production : quel serveur, par quel chemin le code y
              arrive, ce qu'il faut contrôler. Le bouton de mise en production confiera ce texte à un
              agent, qui le suivra.
            </p>

            <p
              data-rappel-production
              className="flex items-start gap-1.5 rounded-md border border-border bg-surface px-2.5 py-2 text-[12.5px] leading-snug text-faint"
            >
              <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{rappelDeMiseEnProduction({ ...project, devUrl: devUrl.trim() || undefined })}</span>
            </p>

            <div className="mt-2">
              <Label>Ce que vous attendez, dans vos mots</Label>
              <Textarea
                data-base-production
                value={baseProduction}
                maxLength={PROMPT_PRODUCTION_MAX}
                disabled={generation || saving}
                onChange={(event) => setBaseProduction(event.target.value)}
                placeholder={
                  'Sans soigner la formulation : où le site tourne, comment le code y arrive, ce qu’il faut relancer, à quoi on voit que c’est en ligne.\n' +
                  'Dites aussi ce qu’il ne faut PAS faire.'
                }
                className="mt-1 min-h-[120px]"
              />
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <p className="text-[12.5px] leading-snug text-faint">
                  Générer confie ce texte à un agent qui rédige le prompt final. C’est un tour d’agent :
                  cela consomme du quota, mais ne déploie rien.
                </p>
                <Button
                  data-generer-production
                  variant="subtle"
                  onClick={genererPrompt}
                  disabled={generation || saving || !baseProduction.trim()}
                  className="shrink-0 gap-1.5"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {generation ? 'Génération…' : 'Générer'}
                </Button>
              </div>
            </div>

            <div className="mt-2">
              <Label>Prompt donné à l’agent de mise en production</Label>
              <Textarea
                data-prompt-production
                value={promptProduction}
                maxLength={PROMPT_PRODUCTION_MAX}
                disabled={generation || saving}
                onChange={(event) => setPromptProduction(event.target.value)}
                placeholder={
                  generation
                    ? 'Rédaction en cours…'
                    : 'Le prompt rédigé apparaîtra ici. Vous pouvez aussi l’écrire ou le corriger à la main.'
                }
                className="mt-1 min-h-[150px]"
              />
              <p className="mt-1 text-[12.5px] leading-snug text-faint" data-mention-production>
                {mentionMiseEnProduction(promptProduction)} Laissé vide, HaikoDev retombe sur ce qu’il sait
                du projet — et sans rien à quoi se raccrocher, le bouton de mise en production s’éteint en
                le disant.
              </p>
            </div>
          </div>

          {/* ---------- Client ---------- */}
          <div>
            <h3 className="mb-1.5 flex items-center gap-1.5 text-[13.5px] font-medium text-text">
              <CircleDollarSign className="h-3.5 w-3.5 text-faint" /> Client et tarif
            </h3>

            {loading ? (
              <p className="flex items-center gap-1.5 text-[13.5px] text-faint">
                <Loader2 className="h-3 w-3 animate-spin" /> Lecture des clients…
              </p>
            ) : available ? (
              <>
                <Label>Client facturé</Label>
                <select
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                  className="mt-1 h-8 w-full rounded-md border border-border bg-raised px-2 text-[14.5px] text-text"
                >
                  <option value="">Aucun client relié</option>
                  {clients.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name} {entry.companyName ? `— ${entry.companyName}` : ''}
                    </option>
                  ))}
                </select>

                <div className="mt-2">
                  <Label className="block">Tarif horaire</Label>
                  <Input
                    value={rate}
                    onChange={(event) => setRate(event.target.value.replace(',', '.'))}
                    className="mt-1.5"
                    inputMode="decimal"
                  />
                  <p className="mt-1 text-[12.5px] text-faint">
                    Trois heures de travail seraient facturées {money((Number(rate) || 0) * 3)}.
                  </p>
                </div>

                {clientId ? (
                  <div className="mt-3 space-y-3">
                    <div>
                      <Label className="block">Document par défaut</Label>
                      <select
                        value={documentType}
                        onChange={(event) => setDocumentType(event.target.value as 'offer' | 'invoice')}
                        className="mt-1.5 h-9 w-full rounded-md border border-border bg-raised px-2 text-[14.5px] text-text"
                      >
                        <option value="invoice">Facture</option>
                        <option value="offer">Offre</option>
                      </select>
                    </div>
                    <div>
                      <Label className="block">Lequel</Label>
                      <select
                        value={documentId}
                        onChange={(event) => setDocumentId(event.target.value)}
                        className="mt-1.5 h-9 w-full rounded-md border border-border bg-raised px-2 text-[14.5px] text-text"
                      >
                        <option value="">Nouveau à chaque fois</option>
                        {documents
                          .filter((doc) => doc.type === documentType)
                          .map((doc) => (
                            <option key={doc.id} value={doc.id}>
                              {doc.number ?? doc.id} — {doc.title ?? 'sans titre'}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>
                ) : null}

                <p className="mt-1.5 text-[12.5px] leading-snug text-faint">
                  Une fois le client relié, chaque carte propose d'ajouter sa ligne au document en un clic. Les montants
                  restent calculés par l'outil de facturation, jamais ici.
                </p>
              </>
            ) : (
              <p className="text-[13.5px] text-faint">L'outil de facturation n'est pas joignable depuis ce serveur.</p>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={archive}>
            <Archive className="h-3 w-3" />
            {project.archived ? 'Remettre en service' : 'Mettre de côté'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirmSuppression(true)} className="text-danger hover:text-danger">
            <Trash2 className="h-3 w-3" /> Effacer
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="default" size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            Enregistrer
          </Button>
        </div>
        </Filet>
      </DialogContent>

      <ConfirmDialog
        open={confirmSuppression}
        title={`Effacer « ${project.name} » de HaikoDev ?`}
        description="Son tableau et ses conversations partent avec. Le dossier sur le serveur, lui, n'est pas touché. Pour simplement le ranger de côté, utilisez « Mettre de côté »."
        confirmLabel="Effacer"
        danger
        onConfirm={remove}
        onClose={() => setConfirmSuppression(false)}
      />
    </Dialog>
  );
}
