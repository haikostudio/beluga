import * as React from 'react';
import { Check, CircleDollarSign, Loader2, Rocket, Trash2 } from 'lucide-react';
import { Project } from '@haikodev/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Input,
  Label,
} from '@/components/ui';
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
  const [deployCommand, setDeployCommand] = React.useState('');
  const [deployUrl, setDeployUrl] = React.useState('');
  const [clientId, setClientId] = React.useState('');
  const [rate, setRate] = React.useState('130');
  const [documentId, setDocumentId] = React.useState('');
  const [documentType, setDocumentType] = React.useState<'offer' | 'invoice'>('invoice');

  React.useEffect(() => {
    if (!project) return;
    setName(project.name);
    setDeployCommand(project.deployCommand ?? '');
    setDeployUrl(project.deployUrl ?? '');
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
          deployCommand: deployCommand.trim() || undefined,
          deployUrl: deployUrl.trim() || undefined,
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

  const remove = async () => {
    if (!confirm(`Retirer « ${project.name} » de HaikoDev ? Le dossier sur le serveur n'est pas touché.`)) return;
    await client.call({ type: 'project.delete', id: project.id });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="w-[min(560px,calc(100vw-16px))]">
        <DialogTitle>Réglages du projet</DialogTitle>

        <div className="mt-4 space-y-3">
          <div>
            <Label>Nom</Label>
            <Input value={name} onChange={(event) => setName(event.target.value)} className="mt-1" />
          </div>

          <div className="rounded-md border border-border bg-surface px-2.5 py-2 text-[11.5px] text-faint">
            Dossier sur le serveur : <span className="text-muted">{project.path}</span>
            {project.gitRemote ? (
              <>
                <br />
                Dépôt : <span className="text-muted">{project.gitRemote}</span>
              </>
            ) : null}
          </div>

          {/* ---------- Publication ---------- */}
          <div>
            <h3 className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-text">
              <Rocket className="h-3.5 w-3.5 text-faint" /> Publication
            </h3>
            <Label>Commande de publication</Label>
            <Input
              value={deployCommand}
              onChange={(event) => setDeployCommand(event.target.value)}
              className="mt-1"
              placeholder="npm run build && sudo systemctl restart mon-projet"
            />
            <Label className="mt-2 block">Adresse en ligne</Label>
            <Input
              value={deployUrl}
              onChange={(event) => setDeployUrl(event.target.value)}
              className="mt-1"
              placeholder="https://mon-projet.haikostudio.cloud"
            />
          </div>

          {/* ---------- Client ---------- */}
          <div>
            <h3 className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-text">
              <CircleDollarSign className="h-3.5 w-3.5 text-faint" /> Client et tarif
            </h3>

            {loading ? (
              <p className="flex items-center gap-1.5 text-[12px] text-faint">
                <Loader2 className="h-3 w-3 animate-spin" /> Lecture des clients…
              </p>
            ) : available ? (
              <>
                <Label>Client facturé</Label>
                <select
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                  className="mt-1 h-8 w-full rounded-md border border-border bg-raised px-2 text-[13px] text-text"
                >
                  <option value="">Aucun client relié</option>
                  {clients.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name} {entry.companyName ? `— ${entry.companyName}` : ''}
                    </option>
                  ))}
                </select>

                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div>
                    <Label>Tarif horaire</Label>
                    <Input
                      value={rate}
                      onChange={(event) => setRate(event.target.value.replace(',', '.'))}
                      className="mt-1"
                      inputMode="decimal"
                    />
                  </div>
                  <div>
                    <Label>Exemple : 3 heures</Label>
                    <Input value={money((Number(rate) || 0) * 3)} readOnly className="mt-1 opacity-60" />
                  </div>
                </div>

                {clientId ? (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div>
                      <Label>Document par défaut</Label>
                      <select
                        value={documentType}
                        onChange={(event) => setDocumentType(event.target.value as 'offer' | 'invoice')}
                        className="mt-1 h-8 w-full rounded-md border border-border bg-raised px-2 text-[13px] text-text"
                      >
                        <option value="invoice">Facture</option>
                        <option value="offer">Offre</option>
                      </select>
                    </div>
                    <div>
                      <Label>Lequel</Label>
                      <select
                        value={documentId}
                        onChange={(event) => setDocumentId(event.target.value)}
                        className="mt-1 h-8 w-full rounded-md border border-border bg-raised px-2 text-[13px] text-text"
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

                <p className="mt-1.5 text-[11px] leading-snug text-faint">
                  Une fois le client relié, chaque carte propose d'ajouter sa ligne au document en un clic. Les montants
                  restent calculés par l'outil de facturation, jamais ici.
                </p>
              </>
            ) : (
              <p className="text-[12px] text-faint">L'outil de facturation n'est pas joignable depuis ce serveur.</p>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={remove} className="text-danger hover:text-danger">
            <Trash2 className="h-3 w-3" /> Retirer le projet
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
      </DialogContent>
    </Dialog>
  );
}
