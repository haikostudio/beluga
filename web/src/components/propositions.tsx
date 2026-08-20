import * as React from 'react';
import { AlertCircle, Check, ChevronDown, GitMerge, LayoutGrid, Loader2 } from 'lucide-react';
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
import { t } from '@/lib/langue';

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
 *
 * IL SE REPLIE D'UN CLIC SUR SON ENTÊTE. Sur un téléphone, une vignette
 * dépliée mangeait la moitié de l'écran et poussait la conversation hors de
 * vue, sans aucun moyen de la ranger : la carte restait là tant qu'on ne
 * l'avait pas validée ou refusée. Replié, le bandeau ne garde qu'UNE ligne —
 * son compte et le titre de la carte — et la conversation retrouve sa place ;
 * le choix est retenu d'une fois sur l'autre (`CLE_BANDEAU`). Une proposition
 * NOUVELLE rouvre le bandeau d'office : rien de ce qui attend une décision ne
 * doit rester caché derrière un pli.
 */

/** Où l'on retient le choix « replié / déplié » du bandeau. */
const CLE_BANDEAU = 'haikodev.bandeau-propositions.ouvert';

function pliInitial(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(CLE_BANDEAU) !== '0';
  } catch {
    return true;
  }
}

export function BandeauPropositions({ messages }: { messages: Message[] }) {
  const attente = propositionsEnAttente(messages);
  const [selectionActive, setSelectionActive] = React.useState(false);
  const [selection, setSelection] = React.useState<string[]>([]);
  const [fusionEnCours, setFusionEnCours] = React.useState(false);
  const [ouvert, setOuvert] = React.useState(pliInitial);
  const idsEnAttente = attente.map((entree) => entree.proposal.id);
  const cleAttente = idsEnAttente.join('|');
  const dejaVues = React.useRef<Set<string>>(new Set(idsEnAttente));

  React.useEffect(() => {
    setSelection((courante) => courante.filter((id) => idsEnAttente.includes(id)));
    if (idsEnAttente.length < 2) setSelectionActive(false);
  }, [cleAttente]);

  /* Une proposition JAMAIS VUE rouvre le bandeau : un pli est un confort de
     lecture, pas un moyen de rater une décision qui vous attend. */
  React.useEffect(() => {
    const nouvelle = idsEnAttente.some((id) => !dejaVues.current.has(id));
    dejaVues.current = new Set(idsEnAttente);
    if (nouvelle) setOuvert(true);
  }, [cleAttente]);

  const basculerPli = () =>
    setOuvert((valeur) => {
      const suivant = !valeur;
      try {
        window.localStorage.setItem(CLE_BANDEAU, suivant ? '1' : '0');
      } catch {
        /* navigation privée : le choix vaut pour la session, c'est tout. */
      }
      return suivant;
    });

  if (!attente.length) return null;

  const ouvrirSelection = () => {
    setSelection(idsEnAttente);
    setSelectionActive(true);
  };
  const fermerSelection = () => {
    setSelection([]);
    setSelectionActive(false);
  };
  const basculer = (id: string) =>
    setSelection((courante) => (courante.includes(id) ? courante.filter((item) => item !== id) : [...courante, id]));

  const fusionner = async () => {
    const items = attente
      .filter((entree) => selection.includes(entree.proposal.id))
      .map((entree) => ({ messageId: entree.messageId, proposalId: entree.proposal.id }));
    if (items.length < 2) return;
    setFusionEnCours(true);
    try {
      const resultat = await client.call<{ already?: boolean }>({ type: 'proposal.merge', items });
      client.pushToast(
        'success',
        resultat.already ? t('Ces propositions étaient déjà réunies') : t('Propositions réunies, à relire avant validation'),
      );
      fermerSelection();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'fusion impossible');
    } finally {
      setFusionEnCours(false);
    }
  };

  return (
    <div
      data-bandeau="propositions"
      className="shrink-0 border-t border-accent/30 bg-gradient-to-b from-surface to-surface/0"
    >
      <div className="flex items-center gap-1.5 px-3 pt-1.5 text-[12px] text-muted">
        {/* TOUT L'ENTÊTE REPLIE ET DÉPLIE : un clic n'importe où sur la ligne
            du titre suffit, sans viser le chevron posé à son extrémité. */}
        <button
          type="button"
          data-bandeau-pli=""
          aria-expanded={ouvert}
          onClick={basculerPli}
          title={ouvert ? t('Replier les cartes à valider') : t('Déplier les cartes à valider')}
          className="-mx-1 flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-raised"
        >
          <LayoutGrid className="h-3 w-3 shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate">
            {attente.length > 1 ? t('{v0} cartes à valider', { v0: attente.length }) : t('Carte à valider')}
            {!ouvert && attente.length === 1 ? ` — ${attente[0].proposal.title}` : ''}
          </span>
          <ChevronDown className={cn('h-3 w-3 shrink-0 text-faint transition-transform', ouvert && 'rotate-180')} />
        </button>
        {ouvert && !selectionActive && attente.length > 1 ? (
          <button
            type="button"
            onClick={ouvrirSelection}
            className="flex shrink-0 items-center gap-1 text-[12px] text-accent hover:text-text"
          >
            <GitMerge className="h-3 w-3" />  {t('Fusionner')}
</button>
        ) : null}
      </div>

      {ouvert ? (
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
              selectionActive={selectionActive}
              selectionnee={selection.includes(entree.proposal.id)}
              onSelection={() => basculer(entree.proposal.id)}
            />
          ))}
        </ZoneDefilement>
      ) : (
        <div className="h-1.5" aria-hidden="true" />
      )}

      {ouvert && selectionActive ? (
        <div data-fusion-propositions="actions" className="flex items-center gap-1.5 border-t border-border px-3 py-1.5">
          <Button size="sm" variant="ghost" className="flex-1" disabled={fusionEnCours} onClick={fermerSelection}>
            {t('Annuler')}</Button>
          <Button
            size="sm"
            variant="default"
            className="flex-1"
            disabled={selection.length < 2 || fusionEnCours}
            onClick={fusionner}
          >
            {fusionEnCours ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitMerge className="h-3 w-3" />}
            
{t('Fusionner (')}{selection.length})
          </Button>
        </div>
      ) : null}
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
  selectionActive,
  selectionnee,
  onSelection,
}: {
  messageId: string;
  /** L'agent de la conversation : la carte hérite de SES réglages par défaut. */
  agentId?: string;
  proposal: Proposition;
  selectionActive: boolean;
  selectionnee: boolean;
  onSelection: () => void;
}) {
  const state = useApp();
  const [busy, setBusy] = React.useState(false);
  const [editing, setEditing] = React.useState(proposal.sourceProposalIds.length > 0);
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
  const choisir = (patch: RunChoix) => {
    const suivant = patch.engine ? { engine: patch.engine } : { ...(choix ?? {}), ...patch };
    setChoix(suivant);
    const resolu = resoudreRun(state.engines, suivant);
    void client
      .call({
        type: 'proposal.config',
        messageId,
        proposalId: proposal.id,
        run: resolu.engine
          ? { engine: resolu.engine.id, model: resolu.model?.id, thinking: resolu.thinking?.id }
          : suivant,
      })
      .catch(() => {});
  };

  /*
   * Un moteur sans compte disponible se DIT, il ne se contourne pas : sinon la
   * carte partirait en silence sur l'autre moteur. Le constat est refait à
   * chaque changement de moteur, sur les quotas réellement relevés ; le texte
   * posé par le serveur au moment de la proposition sert de repli tant que les
   * quotas ne sont pas encore arrivés.
   */
  const comptesDuMoteur = state.quotas.filter((q) => q.engine === retenu.engine?.id);
  const compteDisponible = comptesDuMoteur.some((q) => q.available);
  // Une disponibilité revenue efface seulement l'ancienne phrase sur les
  // comptes. Les autres avertissements — notamment des réglages différents
  // après une fusion — restent visibles jusqu'au clic final.
  const avertissementInitial = compteDisponible
    ? proposal.avertissement?.replace(/Aucun compte disponible[^.]*\.\s*/gi, '').trim()
    : proposal.avertissement;
  const avertissementCompte =
    comptesDuMoteur.length && !compteDisponible
      ? t('Aucun compte disponible pour {v0} : la carte attendra qu\'un compte se libère.', { v0: retenu.engine?.label ?? 'ce moteur' })
      : undefined;
  const avertissement = Array.from(new Set([avertissementInitial, avertissementCompte].filter(Boolean))).join(' ') || undefined;

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
      client.pushToast(accept ? 'success' : 'info', accept ? t('Carte créée dans « Planifié »') : t('Carte refusée'));
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('décision impossible'));
    } finally {
      setBusy(false);
    }
  };

  const repliable = descriptionRepliable(description);

  return (
    <div
      data-vignette="proposition"
      className="flex w-[min(320px,80vw)] shrink-0 flex-col overflow-hidden rounded-md border border-accent/40 bg-base"
    >
      <div className="flex items-center gap-1.5 border-b border-border bg-raised px-2.5 py-1 text-[12px] text-muted">
        {selectionActive ? (
          <button
            type="button"
            aria-pressed={selectionnee}
            aria-label={selectionnee ? t('Retirer « {v0} » de la fusion', { v0: proposal.title }) : t('Ajouter « {v0} » à la fusion', { v0: proposal.title })}
            onClick={onSelection}
            className={cn(
              'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border transition-colors',
              selectionnee ? 'border-accent bg-accent text-accent-fg' : 'border-faint bg-base text-transparent',
            )}
          >
            <Check className="h-3 w-3" strokeWidth={3} />
          </button>
        ) : null}
        <span className="min-w-0 flex-1 truncate">
          {proposal.sourceProposalIds.length ? t('Proposition réunie') : t('À valider')}
        </span>
        <button
          onClick={() => setEditing((current) => !current)}
          className="shrink-0 text-[12px] text-faint hover:text-text"
        >
          {editing ? t('Terminer') : t('Modifier')}
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
            <p className="text-[14px] font-medium leading-snug text-text">{title}</p>
            {description ? (
              ouverte || !repliable ? (
                /* Dépliée, la description défile DANS la vignette : le bandeau
                   garde sa hauteur, il ne mange jamais la conversation. */
                <ZoneDefilement
                  fond="hsl(var(--base))"
                  classeEnveloppe={cn('mt-1 flex-none', repliable && 'max-h-[min(28vh,160px)]')}
                  className="pr-1"
                >
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-muted">
                    {description}
                  </p>
                </ZoneDefilement>
              ) : (
                <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted">
                  {description}
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
                {ouverte ? t('Replier la description') : t('Lire la description')}
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
        <Button size="sm" variant="default" disabled={busy || selectionActive} onClick={() => decide(true)} className="w-full">
          <Check className="h-3 w-3" />  {t('Créer la carte')}
</Button>
        <Button size="sm" variant="ghost" disabled={busy || selectionActive} onClick={() => decide(false)} className="w-full">
          {t('Refuser')}</Button>
      </div>
    </div>
  );
}
