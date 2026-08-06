import * as React from 'react';
import { Archive, Check, CircleDollarSign, Globe, Loader2, Rocket, Trash2 } from 'lucide-react';
import { Project } from '@haikodev/shared';
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogTitle,
  Input,
  Label,
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
  const [engine, setEngine] = React.useState<string>('claude');
  const [clientId, setClientId] = React.useState('');
  const [rate, setRate] = React.useState('130');
  const [documentId, setDocumentId] = React.useState('');
  const [documentType, setDocumentType] = React.useState<'offer' | 'invoice'>('invoice');
  const [confirmSuppression, setConfirmSuppression] = React.useState(false);
  const [sousDomaine, setSousDomaine] = React.useState('');
  const [portLocal, setPortLocal] = React.useState('');
  const [publication, setPublication] = React.useState(false);

  React.useEffect(() => {
    if (!project) return;
    setName(project.name);
    setDevUrl(project.devUrl ?? '');
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
                Elle est ouverte à la fin de chaque déploiement : si elle ne répond pas, le déploiement est déclaré en
                échec. Laissée vide, aucune adresse n'est contrôlée.
              </p>
            </div>

            <div className="mt-2 rounded-md border border-border bg-surface px-2.5 py-2">
              <p className="text-[12.5px] text-muted">
                Pas encore d'adresse ? HaikoDev peut la créer : nom, certificat et redirection en une fois.
              </p>
              <div className="mt-1.5 flex items-center gap-1.5">
                <Input
                  value={sousDomaine}
                  onChange={(event) => setSousDomaine(event.target.value)}
                  placeholder="nom-du-site"
                  className="h-8 flex-1"
                />
                <span className="shrink-0 text-[12.5px] text-faint">.haikostudio.cloud</span>
                <Input
                  value={portLocal}
                  onChange={(event) => setPortLocal(event.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="port"
                  className="h-8 w-[74px]"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!sousDomaine.trim() || !portLocal || publication}
                  onClick={async () => {
                    setPublication(true);
                    try {
                      const res = await client.call<{ url?: string }>(
                        {
                          type: 'project.publishDomain',
                          id: project.id,
                          subdomain: sousDomaine.trim(),
                          port: Number(portLocal),
                        },
                        180000,
                      );
                      if (res?.url) setDevUrl(res.url);
                    } catch (err: any) {
                      client.pushToast('error', err?.message ?? 'création impossible');
                    } finally {
                      setPublication(false);
                    }
                  }}
                >
                  {publication ? <Loader2 className="h-3 w-3 animate-spin" /> : <Globe className="h-3 w-3" />}
                  Créer
                </Button>
              </div>
              <p className="mt-1 text-[11.5px] text-faint">
                Le port est celui sur lequel votre projet écoute sur le serveur.
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
