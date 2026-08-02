import * as React from 'react';
import {
  Check,
  CircleDollarSign,
  ExternalLink,
  FileText,
  GitBranch,
  GitMerge,
  Loader2,
  Play,
  RefreshCw,
  Rocket,
  Trash2,
  Zap,
} from 'lucide-react';
import { COLUMN_LABELS, Card } from '@haikodev/shared';
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogTitle,
  Drawer,
  Input,
  Label,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
} from '@/components/ui';
import { Chat } from '@/components/chat';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn, duration, money, relativeTime } from '@/lib/utils';

export function CardPanel({ cardId, onClose }: { cardId: string | null; onClose: () => void }) {
  const state = useApp();
  const card = cardId ? state.cards[cardId] : null;

  if (!card) return null;

  return (
    <Drawer open={!!cardId} onClose={onClose}>
      <CardPanelBody card={card} onClose={onClose} />
    </Drawer>
  );
}

function CardPanelBody({ card, onClose }: { card: Card; onClose: () => void }) {
  const [confirmSuppression, setConfirmSuppression] = React.useState(false);
  const state = useApp();
  const agent = card.agentId ? state.agents[card.agentId] : null;
  const project = state.projects.find((p) => p.id === card.projectId);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-border px-4 pb-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <DialogTitle className="pr-6 leading-snug">{card.title}</DialogTitle>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-faint">
              <Badge>{COLUMN_LABELS[card.column]}</Badge>
              {card.deployedAt ? (
                <Badge tone="success">
                  <Rocket className="h-2.5 w-2.5" /> en ligne
                </Badge>
              ) : null}
              {card.labels.map((label) => (
                <Badge key={label}>{label}</Badge>
              ))}
              <span>modifiée {relativeTime(card.updatedAt)}</span>
            </div>
          </div>
        </div>

        <ConfirmDialog
          open={confirmSuppression}
          title={`Supprimer « ${card.title} » ?`}
          description="La carte et sa conversation partent définitivement. Le travail déjà fait dans le projet, lui, reste."
          confirmLabel="Supprimer la carte"
          danger
          onConfirm={async () => {
            await client.call({ type: 'card.delete', id: card.id });
            onClose();
          }}
          onClose={() => setConfirmSuppression(false)}
        />
      </header>

      <Tabs defaultValue="details" className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-border px-4 py-2">
          <TabsList>
            <TabsTrigger value="details">Détails</TabsTrigger>
            <TabsTrigger value="billing">Facturation</TabsTrigger>
            <TabsTrigger value="github">GitHub</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="details" className="min-h-0 flex-1 data-[state=inactive]:hidden">
          <div className="flex h-full min-h-0 flex-col">
            <CardSummary card={card} />
            {agent ? (
              <div className="min-h-0 flex-1 border-t border-border">
                <Chat agent={agent} projectId={card.projectId} />
              </div>
            ) : (
              <div className="border-t border-border px-4 py-4 text-[14px] text-faint">
                Aucun agent n'a encore travaillé sur cette carte.
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="billing" className="min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden">
          <BillingTab card={card} rate={project?.billing?.hourlyRate ?? 130} project={project} />
        </TabsContent>

        <TabsContent value="github" className="min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden">
          <GithubTab card={card} />
        </TabsContent>
      </Tabs>

      {/* Les gestes de décision restent en bas, toujours à portée de pouce. */}
      <footer className="shrink-0 border-t border-border bg-bg px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {card.column === 'todo' ? (
            <Button size="sm" variant="default" onClick={() => client.moveCard(card, 'validated')}>
              <Check className="h-3 w-3" /> Valider (autorise la dépense)
            </Button>
          ) : null}
          {card.column === 'planned' ? (
            <>
              <Button size="sm" variant="default" onClick={() => client.call({ type: 'card.start', id: card.id })}>
                <Play className="h-3 w-3" /> Lancer maintenant
              </Button>
              <Button
                size="sm"
                variant={card.scheduling?.asap ? 'subtle' : 'outline'}
                onClick={() => client.call({ type: 'card.asap', id: card.id, value: !card.scheduling?.asap })}
              >
                <Zap className="h-3 w-3" /> Dès que possible
              </Button>
            </>
          ) : null}
          {card.column === 'running' ? (
            <Button size="sm" variant="default" onClick={() => client.call({ type: 'card.finish', id: card.id })}>
              <Check className="h-3 w-3" /> Terminer la tâche
            </Button>
          ) : null}
          {card.column === 'done' ? (
            <Button size="sm" variant="default" onClick={() => client.moveCard(card, 'to_deploy')}>
              <Rocket className="h-3 w-3" /> Mettre en file de publication
            </Button>
          ) : null}
          {card.estimate?.failed ? (
            <Button size="sm" variant="outline" onClick={() => client.call({ type: 'card.reanalyze', id: card.id })}>
              <RefreshCw className="h-3 w-3" /> Relancer l'analyse
            </Button>
          ) : null}
          {card.closureDoc ? (
            <Button size="sm" variant="outline" asChild>
              <a href={`/api/document?card=${card.id}&download=1`}>
                <FileText className="h-3 w-3" /> Document de clôture
              </a>
            </Button>
          ) : null}

          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-danger hover:text-danger"
            onClick={() => setConfirmSuppression(true)}
          >
            <Trash2 className="h-3 w-3" /> Supprimer
          </Button>
        </div>
      </footer>
    </div>
  );
}

function CardSummary({ card }: { card: Card }) {
  const [description, setDescription] = React.useState(card.description);
  React.useEffect(() => setDescription(card.description), [card.id]);

  return (
    <div className="space-y-3 px-4 py-3">
      <Textarea
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        onBlur={() => {
          if (description !== card.description) {
            client.call({ type: 'card.update', id: card.id, patch: { description } });
          }
        }}
        rows={2}
        placeholder="Description…"
        className="text-[14px]"
      />

      {card.scheduling?.waitingReason ? (
        <p className="rounded-md border border-warning/30 bg-warning/5 px-2.5 py-1.5 text-[13.5px] text-warning">
          {card.scheduling.waitingReason}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric
          label="Durée machine prévue"
          value={duration(card.estimate?.machineSeconds)}
          hint="Sert à l'ordonnanceur, jamais à la facture"
        />
        <Metric
          label="Durée réelle"
          value={duration(card.consumption?.machineSeconds)}
          tone={
            card.estimate?.machineSeconds && card.consumption?.machineSeconds
              ? card.consumption.machineSeconds > card.estimate.machineSeconds * 1.3
                ? 'warning'
                : 'neutral'
              : 'neutral'
          }
        />
        <Metric label="Jetons consommés" value={card.consumption?.tokens?.toLocaleString('fr-CH') ?? '—'} />
        <Metric label="Compte utilisé" value={card.consumption?.account ?? '—'} />
      </div>

      {card.estimate?.summary ? (
        <details className="rounded-md border border-border bg-surface px-2.5 py-2">
          <summary className="cursor-pointer text-[13.5px] text-muted">Résumé de l'analyse</summary>
          <p className="mt-1.5 whitespace-pre-wrap text-[13.5px] leading-relaxed text-muted">{card.estimate.summary}</p>
        </details>
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'warning';
}) {
  return (
    <Tooltip label={hint}>
      <div className="rounded-md border border-border bg-surface px-2 py-1.5">
        <p className="text-[11.5px] uppercase tracking-wide text-faint">{label}</p>
        <p className={cn('mt-0.5 text-[14.5px] font-medium', tone === 'warning' ? 'text-warning' : 'text-text')}>
          {value}
        </p>
      </div>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ */
/* Onglet Facturation                                                  */
/* ------------------------------------------------------------------ */

function BillingTab({ card, rate, project }: { card: Card; rate: number; project?: { billing?: any; name?: string } }) {
  const [title, setTitle] = React.useState(card.billing?.title ?? card.estimate?.billingTitle ?? card.title);
  const [description, setDescription] = React.useState(card.estimate?.billingDescription ?? card.description);
  const [hours, setHours] = React.useState(String(card.billing?.hours ?? card.estimate?.seniorHours ?? ''));
  const [documents, setDocuments] = React.useState<any[]>([]);
  const defaut = project?.billing?.defaultDocumentId as string | undefined;
  const [documentId, setDocumentId] = React.useState<string>(defaut ?? '');
  const [type, setType] = React.useState<'offer' | 'invoice'>(
    (project?.billing?.defaultDocumentType as 'offer' | 'invoice') ?? 'invoice',
  );
  const [busy, setBusy] = React.useState(false);
  const [available, setAvailable] = React.useState(true);
  const [confirmeNouveau, setConfirmeNouveau] = React.useState(false);

  React.useEffect(() => {
    client
      .call({ type: 'billing.documents' })
      .then((data) => setDocuments(data.documents ?? []))
      .catch(() => setAvailable(false));
  }, []);

  const amount = Number(hours) * rate;

  const push = async () => {
    if (!hours || Number.isNaN(Number(hours))) {
      client.pushToast('warning', 'Indiquez un nombre d\'heures');
      return;
    }
    // Sans document par défaut sur le projet, on ne devine pas : il faut dire
    // dans quelle facture ou quelle offre la ligne doit atterrir.
    if (!defaut && !documentId && !confirmeNouveau) {
      client.pushToast('warning', 'Choisissez le document, ou cochez « créer un nouveau document ».');
      return;
    }
    setBusy(true);
    try {
      await client.call({
        type: 'billing.push',
        cardId: card.id,
        documentType: type,
        documentId: documentId || undefined,
        title,
        description,
        hours: Number(hours),
      });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'ajout impossible');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 px-4 py-3">
      {card.billing ? (
        <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/5 px-2.5 py-2 text-[13.5px] text-success">
          <Check className="h-3.5 w-3.5" />
          Déjà facturée — {card.billing.documentType === 'offer' ? 'offre' : 'facture'}{' '}
          {card.billing.documentNumber ?? card.billing.documentId} · {money(card.billing.amount)}
        </div>
      ) : null}

      <div>
        <Label>Titre de la ligne</Label>
        <Input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1" maxLength={80} />
      </div>

      <div>
        <Label>Description</Label>
        <Textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          className="mt-1"
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label>Heures (développeur senior)</Label>
          <Input
            value={hours}
            onChange={(event) => setHours(event.target.value.replace(',', '.'))}
            className="mt-1"
            inputMode="decimal"
          />
        </div>
        <div>
          <Label>Tarif horaire</Label>
          <Input value={`${rate} CHF`} readOnly className="mt-1 opacity-60" />
        </div>
        <div>
          <Label>Montant (calculé côté serveur)</Label>
          <Input value={hours ? money(amount) : '—'} readOnly className="mt-1 opacity-60" />
        </div>
      </div>

      <p className="text-[12.5px] leading-relaxed text-faint">
        Les heures facturées sont celles qu'un développeur senior mettrait à la main — jamais la durée machine de
        l'agent ({duration(card.consumption?.machineSeconds)}).
      </p>

      {available ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Type de document</Label>
              <select
                value={type}
                onChange={(event) => setType(event.target.value as 'offer' | 'invoice')}
                className="mt-1 h-8 w-full rounded-md border border-border bg-raised px-2 text-[14.5px] text-text"
              >
                <option value="invoice">Facture</option>
                <option value="offer">Offre</option>
              </select>
            </div>
            <div>
              <Label>Document</Label>
              <select
                value={documentId}
                onChange={(event) => setDocumentId(event.target.value)}
                className="mt-1 h-8 w-full rounded-md border border-border bg-raised px-2 text-[14.5px] text-text"
              >
                <option value="">Nouveau document</option>
                {documents
                  .filter((doc) => doc.type === type)
                  .map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.number ?? doc.id} — {doc.title ?? 'sans titre'}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {!defaut && !documentId ? (
            <label className="flex items-start gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-[13px] text-muted">
              <input
                type="checkbox"
                checked={confirmeNouveau}
                onChange={(event) => setConfirmeNouveau(event.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
              />
              <span>
                Ce projet n'a pas de document attitré : cochez pour créer une nouvelle{' '}
                {type === 'offer' ? 'offre' : 'facture'} pour {project?.billing?.clientName ?? 'ce client'}, ou
                choisissez un document existant ci-dessus.
              </span>
            </label>
          ) : null}

          <Button variant="default" size="sm" disabled={busy} onClick={push}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CircleDollarSign className="h-3 w-3" />}
            Ajouter la ligne
          </Button>
        </>
      ) : (
        <p className="text-[13.5px] text-faint">L'outil de facturation n'est pas joignable depuis ce serveur.</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Onglet GitHub                                                       */
/* ------------------------------------------------------------------ */

/** Une date de dépôt s'affiche avec son heure : « 02.08 à 09:14 ». */
function dateHeure(valeur?: string): string {
  if (!valeur) return '—';
  const date = new Date(valeur);
  if (Number.isNaN(date.getTime())) return valeur;
  return `${date.toLocaleDateString('fr-CH', { day: '2-digit', month: '2-digit' })} à ${date.toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' })}`;
}

function GithubTab({ card }: { card: Card }) {
  const [busy, setBusy] = React.useState(false);
  const tracking = card.github;

  const refresh = async () => {
    setBusy(true);
    try {
      await client.call({ type: 'github.refresh', cardId: card.id });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'lecture impossible');
    } finally {
      setBusy(false);
    }
  };

  const merge = async (method: 'merge' | 'squash' | 'rebase', auto = false) => {
    setBusy(true);
    try {
      await client.call({ type: 'github.merge', cardId: card.id, method, auto });
      client.pushToast('success', auto ? 'Fusion automatique activée' : 'Fusion demandée');
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'fusion impossible');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 px-4 py-3">
      <div className="flex items-center gap-2">
        <GitBranch className="h-3.5 w-3.5 text-faint" />
        <span className="text-[14px] text-text">{tracking?.branch ?? 'aucune branche'}</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={refresh} disabled={busy}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Actualiser
        </Button>
      </div>

      {tracking?.prNumber ? (
        <div className="rounded-md border border-border bg-surface px-2.5 py-2">
          <div className="flex items-center gap-2">
            <Badge tone={tracking.prState === 'merged' ? 'success' : tracking.prState === 'closed' ? 'neutral' : 'strong'}>
              #{tracking.prNumber} {tracking.prState}
            </Badge>
            <span className="min-w-0 flex-1 truncate text-[14px] text-text">{tracking.prTitle}</span>
            {tracking.prUrl ? (
              <a href={tracking.prUrl} target="_blank" rel="noreferrer" className="text-faint hover:text-text">
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5 text-[12.5px]">
            {tracking.reviewDecision ? <Badge>revue : {tracking.reviewDecision}</Badge> : null}
            {tracking.mergeable ? <Badge>fusion : {tracking.mergeable}</Badge> : null}
          </div>

          {tracking.checks.length ? (
            <ul className="mt-2 space-y-0.5">
              {tracking.checks.slice(0, 8).map((check, index) => (
                <li key={index} className="flex items-center gap-1.5 text-[13px]">
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      check.conclusion === 'SUCCESS'
                        ? 'bg-success'
                        : check.conclusion === 'FAILURE'
                          ? 'bg-danger'
                          : 'bg-warning',
                    )}
                  />
                  <span className="flex-1 truncate text-muted">{check.name}</span>
                  <span className="text-faint">{check.conclusion ?? check.status}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {tracking.prState === 'open' ? (
            <div className="mt-2 flex flex-wrap gap-1">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => merge('squash')}>
                <GitMerge className="h-3 w-3" /> Fusionner (écrasée)
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => merge('merge')}>
                Fusion simple
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => merge('squash', true)}>
                Auto dès que les tests passent
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-[13.5px] text-faint">Aucune demande de fusion liée pour l'instant.</p>
      )}

      {tracking?.commits.length ? (
        <div>
          <p className="mb-1 text-[12.5px] uppercase tracking-wide text-faint">Derniers commits</p>
          <ul className="space-y-0.5">
            {tracking.commits.map((commit) => (
              <li key={commit.sha} className="flex gap-2 text-[13px]">
                <code className="text-faint">{commit.sha.slice(0, 7)}</code>
                <span className="min-w-0 flex-1 truncate text-muted">{commit.message}</span>
                <span className="shrink-0 text-faint">{dateHeure(commit.date)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tracking?.activity.length ? (
        <div>
          <p className="mb-1 text-[12.5px] uppercase tracking-wide text-faint">Activité</p>
          <ul className="space-y-1.5">
            {tracking.activity.slice(0, 10).map((event, index) => (
              <li key={index} className="rounded border border-border bg-surface px-2 py-1.5 text-[13px]">
                <span className="text-text">{event.author}</span>{' '}
                <span className="text-faint">— {event.kind}</span>
                <span className="text-faint"> · {dateHeure(event.date)}</span>
                {event.body ? <p className="mt-0.5 line-clamp-3 text-muted">{event.body}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
