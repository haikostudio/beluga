import * as React from 'react';
import { AlertCircle, Check, ChevronDown, LayoutGrid } from 'lucide-react';
import {
  Message,
  descriptionRepliable,
  propositionsEnAttente,
  type PropositionEnAttente,
} from '@haikodev/shared';
import { Badge, Button, Textarea, ZoneDefilement } from '@/components/ui';
import { RunChoix, RunSelectors, resoudreRun } from '@/components/run-selectors';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';

type Proposition = Message['proposals'][number];

/**
 * Le bandeau des cartes proposées : une bande FIXE entre la conversation et la
 * barre d'écriture, exactement comme le volet des tâches juste en dessous.
 *
 * Une proposition rendue dans le fil remontait avec les messages : dès qu'un
 * échange arrivait, ou qu'une description dépassait un écran de téléphone, les
 * boutons « Créer la carte » / « Refuser » sortaient du champ. Ici, elles
 * restent sous les yeux quel que soit le défilement.
 *
 * Elles se rangent en LIGNE : une vignette chacune, largeur bornée, et le
 * bandeau glisse horizontalement — l'axe vertical est bloqué en toutes lettres
 * par `ZoneDefilement axe="horizontal"`. Aucune proposition en attente : le
 * bandeau ne rend RIEN et ne prend aucune place.
 */
export function BandeauPropositions({ messages }: { messages: Message[] }) {
  const attente = propositionsEnAttente(messages);
  if (!attente.length) return null;

  return (
    <div data-bandeau="propositions" className="shrink-0 border-t border-accent/30 bg-surface">
      <div className="flex items-center gap-1.5 px-3 pt-1.5 text-[12px] text-muted">
        <LayoutGrid className="h-3 w-3 shrink-0 text-accent" />
        <span className="min-w-0 truncate">
          {attente.length > 1 ? `${attente.length} cartes à valider` : 'Carte à valider'}
        </span>
      </div>

      <ZoneDefilement
        data-bandeau-zone=""
        axe="horizontal"
        classeEnveloppe="flex-none"
        className="flex gap-2 px-3 py-2"
      >
        {attente.map((entree: PropositionEnAttente<Proposition>) => (
          <VignetteProposition
            key={entree.proposal.id}
            messageId={entree.messageId}
            agentId={entree.agentId}
            proposal={entree.proposal}
          />
        ))}
      </ZoneDefilement>
    </div>
  );
}

/**
 * Une carte proposée, telle qu'elle attend votre clic : titre, réglages de
 * l'agent qui l'exécutera, et les deux boutons. RIEN n'entre dans une colonne
 * tant que vous n'avez pas validé — le clic reste seul maître.
 *
 * La description longue est REPLIÉE (le bandeau doit rester une bande) et
 * s'ouvre au clic, dans une zone de hauteur bornée qui défile sur elle-même.
 */
function VignetteProposition({
  messageId,
  agentId,
  proposal,
}: {
  messageId: string;
  /** L'agent de la conversation : la carte hérite de SES réglages par défaut. */
  agentId?: string;
  proposal: Proposition;
}) {
  const state = useApp();
  const [busy, setBusy] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [ouverte, setOuverte] = React.useState(false);
  const [title, setTitle] = React.useState(proposal.title);
  const [description, setDescription] = React.useState(proposal.description);

  /*
   * Moteur, modèle et niveau de réflexion sont choisis AVANT que la carte
   * existe : c'est avec eux que l'agent d'exécution sera lancé plus tard. Le
   * point de départ est ce que la proposition demandait, sinon les réglages de
   * la conversation en cours.
   */
  const agent = agentId ? state.agents[agentId] : undefined;
  const [choix, setChoix] = React.useState<RunChoix | undefined>(proposal.run ?? agent?.run);
  const retenu = resoudreRun(state.engines, choix);

  // Changer de moteur remet le modèle et la réflexion à zéro : un modèle
  // n'appartient qu'à son moteur, le garder n'aurait aucun sens.
  const choisir = (patch: RunChoix) =>
    setChoix((courant) => (patch.engine ? { engine: patch.engine } : { ...(courant ?? {}), ...patch }));

  /*
   * Un moteur sans compte disponible se DIT, il ne se contourne pas : sinon la
   * carte partirait en silence sur l'autre moteur. Le constat est refait à
   * chaque changement de moteur, sur les quotas réellement relevés ; le texte
   * posé par le serveur au moment de la proposition sert de repli tant que les
   * quotas ne sont pas encore arrivés.
   */
  const comptesDuMoteur = state.quotas.filter((q) => q.engine === retenu.engine?.id);
  const avertissement = comptesDuMoteur.length
    ? comptesDuMoteur.some((q) => q.available)
      ? undefined
      : `Aucun compte disponible pour ${retenu.engine?.label ?? 'ce moteur'} : la carte attendra qu'un compte se libère.`
    : proposal.avertissement;

  const decide = async (accept: boolean) => {
    setBusy(true);
    try {
      await client.call({
        type: 'proposal.decide',
        messageId,
        proposalId: proposal.id,
        accept,
        title: title.trim() || proposal.title,
        description,
        run: retenu.engine
          ? { engine: retenu.engine.id, model: retenu.model?.id, thinking: retenu.thinking?.id }
          : undefined,
      });
      client.pushToast(accept ? 'success' : 'info', accept ? 'Carte créée dans « À faire »' : 'Carte refusée');
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'décision impossible');
    } finally {
      setBusy(false);
    }
  };

  const repliable = descriptionRepliable(proposal.description);

  return (
    <div
      data-vignette="proposition"
      className="flex w-[min(320px,80vw)] shrink-0 flex-col overflow-hidden rounded-md border border-accent/40 bg-base"
    >
      <div className="flex items-center gap-1.5 border-b border-border bg-raised px-2.5 py-1 text-[12px] text-muted">
        <span className="min-w-0 flex-1 truncate">À valider</span>
        <button
          onClick={() => setEditing((current) => !current)}
          className="shrink-0 text-[12px] text-faint hover:text-text"
        >
          {editing ? 'Terminer' : 'Modifier'}
        </button>
      </div>

      <div className="px-2.5 py-2">
        {editing ? (
          <>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full rounded border border-border bg-base px-2 py-1 text-[14px] font-medium text-text outline-none focus:border-accent"
            />
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
              className="mt-1.5 w-full text-[13px]"
            />
          </>
        ) : (
          <>
            <p className="text-[14px] font-medium leading-snug text-text">{proposal.title}</p>
            {proposal.description ? (
              ouverte || !repliable ? (
                /* Dépliée, la description défile DANS la vignette : le bandeau
                   garde sa hauteur, il ne mange jamais la conversation. */
                <ZoneDefilement
                  fond="hsl(var(--base))"
                  classeEnveloppe={cn('mt-1 flex-none', repliable && 'max-h-[min(28vh,160px)]')}
                  className="pr-1"
                >
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-muted">
                    {proposal.description}
                  </p>
                </ZoneDefilement>
              ) : (
                <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted">
                  {proposal.description}
                </p>
              )
            ) : null}
            {repliable ? (
              <button
                type="button"
                onClick={() => setOuverte((current) => !current)}
                className="mt-1 flex items-center gap-1 text-[12px] text-faint hover:text-text"
              >
                <ChevronDown className={cn('h-3 w-3 transition-transform', ouverte && 'rotate-180')} />
                {ouverte ? 'Replier la description' : 'Lire la description'}
              </button>
            ) : null}
          </>
        )}

        {proposal.labels.length ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {proposal.labels.map((label) => (
              <Badge key={label}>{label}</Badge>
            ))}
          </div>
        ) : null}
      </div>

      {avertissement ? (
        <div className="mx-2.5 mb-2 flex gap-2 rounded-md border border-warning/30 bg-warning/5 px-2 py-1.5 text-[12px] leading-relaxed text-warning">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0">{avertissement}</span>
        </div>
      ) : null}

      {/* Les réglages de l'agent qui exécutera la carte, choisis dès maintenant :
          chaque menu prend toute la largeur et affiche son libellé entier. */}
      <div className="mt-auto flex flex-col gap-1 border-t border-border px-2 py-1.5">
        <RunSelectors engines={state.engines} choix={choix} onSelect={choisir} pleineLargeur />
        <Button size="sm" variant="default" disabled={busy} onClick={() => decide(true)} className="w-full">
          <Check className="h-3 w-3" /> Créer la carte
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide(false)} className="w-full">
          Refuser
        </Button>
      </div>
    </div>
  );
}
