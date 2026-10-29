import * as React from 'react';
import { AlertCircle, Check, ChevronDown, CornerDownLeft, GitMerge, LayoutGrid, Loader2 } from 'lucide-react';
import {
  Message,
  descriptionRepliable,
  projetAfficheDeLaProposition,
  propositionsEnAttente,
  trierParInteret,
  type PropositionEnAttente,
} from '@beluga/shared';
import { Badge, Button, Textarea, ZoneDefilement } from '@/components/ui';
import { IconeDeProjet } from '@/components/pastille-projet';
import { RunChoix, RunSelectors, resoudreRun } from '@/components/run-selectors';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

type Proposition = Message['proposals'][number];

/**
 * L'ICÔNE DU PROJET OÙ LA CARTE VA NAÎTRE, posée devant le titre d'une carte
 * proposée — vignette « Suggestion de carte », bandeau hors carte et pastille
 * de la carte acceptée. Le nom du projet se lit en infobulle. Projet
 * introuvable : rien, plutôt qu'une icône fausse (`projetAfficheDeLaProposition`).
 */
export function IconeDuProjetDAccueil({
  proposal,
  agentId,
  fond,
  className,
}: {
  proposal: Pick<Proposition, 'projectId' | 'cardId'>;
  agentId?: string;
  /** Le support de la pile d'un projet réuni : le fond de la vignette. */
  fond?: string;
  className?: string;
}) {
  const state = useApp();
  const projet = projetAfficheDeLaProposition({
    cardProjectId: proposal.cardId ? state.cards[proposal.cardId]?.projectId : undefined,
    proposalProjectId: proposal.projectId,
    agentProjectId: agentId ? state.agents[agentId]?.projectId : undefined,
    projets: state.projects,
  });
  if (!projet) return null;
  return (
    <span
      data-projet-de-proposition={projet.id}
      title={t('Projet de la carte : {v0}', { v0: projet.name })}
      aria-label={t('Projet de la carte : {v0}', { v0: projet.name })}
      role="img"
      className={cn('flex shrink-0', className)}
    >
      <IconeDeProjet projet={projet} projets={state.projects} fond={fond} />
    </span>
  );
}

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
const CLE_BANDEAU = 'beluga.bandeau-propositions.ouvert';

function pliInitial(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(CLE_BANDEAU) !== '0';
  } catch {
    return true;
  }
}

export function BandeauPropositions({ messages }: { messages: Message[] }) {
  /*
   * LES PLUS RENTABLES D'ABORD, QUAND ELLES SONT NOTÉES. Le juge rapide note
   * les propositions de la nuit (gain × 2 − ampleur) ; celles qui portent un
   * rang remontent, les autres gardent leur ordre d'écriture à la suite. Juge
   * éteint = aucune note = l'ordre d'avant, à l'identique
   * (`shared/src/jugement-rapide.ts`).
   */
  const attente = trierParInteret(propositionsEnAttente(messages), (entree) => entree.proposal.interet?.rang);
  const fusion = useFusionDePropositions(attente, { toutCocher: true });
  const [ouvert, setOuvert] = React.useState(pliInitial);
  const idsEnAttente = attente.map((entree) => entree.proposal.id);
  const cleAttente = idsEnAttente.join('|');
  const dejaVues = React.useRef<Set<string>>(new Set(idsEnAttente));

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

  return (
    <div
      data-bandeau="propositions"
      className="shrink-0 border-t border-accent/30 bg-gradient-to-b from-surface to-surface/0"
    >
      <div className="flex items-center gap-1.5 px-4 pt-1.5 text-[12px] text-muted">
        {/* TOUT L'ENTÊTE REPLIE ET DÉPLIE : un clic n'importe où sur la ligne
            du titre suffit, sans viser le chevron posé à son extrémité. */}
        <button
          type="button"
          data-bandeau-pli=""
          aria-expanded={ouvert}
          onClick={basculerPli}
          title={ouvert ? t('Replier les cartes à valider') : t('Déplier les cartes à valider')}
          className="-mx-1 flex min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 sm:px-1 py-1 sm:py-0.5 text-left transition-colors hover:bg-raised"
        >
          <LayoutGrid className="h-3 w-3 shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate">
            {attente.length > 1 ? t('{v0} cartes à valider', { v0: attente.length }) : t('Carte à valider')}
            {!ouvert && attente.length === 1 ? ` — ${attente[0].proposal.title}` : ''}
          </span>
          <ChevronDown className={cn('h-3 w-3 shrink-0 text-faint transition-transform', ouvert && 'rotate-180')} />
        </button>
        {ouvert ? <BoutonFusionner fusion={fusion} /> : null}
      </div>

      {ouvert ? (
        <ZoneDefilement
          data-bandeau-zone=""
          axe="horizontal"
          classeEnveloppe="flex-none"
          className="flex gap-2 px-4 py-2"
        >
          {attente.map((entree: PropositionEnAttente<Proposition>) => (
            <VignetteProposition
              key={entree.proposal.id}
              messageId={entree.messageId}
              agentId={entree.agentId}
              proposal={entree.proposal}
              selectionActive={fusion.selectionActive}
              selectionnee={fusion.selection.includes(entree.proposal.id)}
              onSelection={() => fusion.basculer(entree.proposal.id)}
            />
          ))}
        </ZoneDefilement>
      ) : (
        <div className="h-1.5" aria-hidden="true" />
      )}

      {ouvert ? <BarreDeFusion fusion={fusion} className="px-4" /> : null}
    </div>
  );
}

/** Ce qu'il faut d'une proposition en attente pour la réunir : son message et son id. */
interface EntreeFusionnable {
  messageId: string;
  proposal: { id: string };
}

export type FusionDePropositions = ReturnType<typeof useFusionDePropositions>;

/**
 * LA SÉLECTION ET LA FUSION DES PROPOSITIONS EN ATTENTE, partagées par le
 * bandeau des conversations sans carte et par le bloc « Suggestion de carte »
 * d'une carte (demande du 24/10/2026 : « fusionner la 3 et la 4 »). Seules
 * les propositions en attente se réunissent (`proposal.merge`) ; la réunie
 * s'ouvre en édition, ses sources quittent la rangée.
 *
 * `toutCocher` : le bandeau coche d'office toutes ses propositions (il en porte
 * rarement plus de deux) ; le bloc d'une carte part d'une sélection VIDE, pour
 * qu'on y choisisse « la 3 et la 4 » parmi bien d'autres.
 */
export function useFusionDePropositions(attente: EntreeFusionnable[], { toutCocher = false }: { toutCocher?: boolean } = {}) {
  const [selectionActive, setSelectionActive] = React.useState(false);
  const [selection, setSelection] = React.useState<string[]>([]);
  const [enCours, setEnCours] = React.useState(false);
  const ids = attente.map((entree) => entree.proposal.id);
  const cle = ids.join('|');

  React.useEffect(() => {
    setSelection((courante) => courante.filter((id) => ids.includes(id)));
    if (ids.length < 2) setSelectionActive(false);
  }, [cle]);

  const ouvrir = () => {
    setSelection(toutCocher ? ids : []);
    setSelectionActive(true);
  };
  const fermer = () => {
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
    setEnCours(true);
    try {
      const resultat = await client.call<{ already?: boolean }>({ type: 'proposal.merge', items });
      client.pushToast(
        'success',
        resultat.already ? t('Ces propositions étaient déjà réunies') : t('Propositions réunies, à relire avant validation'),
      );
      fermer();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'fusion impossible');
    } finally {
      setEnCours(false);
    }
  };

  return { possible: ids.length > 1, selectionActive, selection, enCours, ouvrir, fermer, basculer, fusionner };
}

/** Le lien « Fusionner » d'un en-tête : il ouvre la sélection, dès deux propositions en attente. */
export function BoutonFusionner({ fusion }: { fusion: FusionDePropositions }) {
  if (!fusion.possible || fusion.selectionActive) return null;
  return (
    <button
      type="button"
      onClick={fusion.ouvrir}
      className="flex shrink-0 items-center gap-1 text-[12px] text-accent hover:text-text"
      data-fusion-propositions="ouvrir"
    >
      <GitMerge className="h-3 w-3" aria-hidden /> {t('Fusionner')}
    </button>
  );
}

/** La barre « Annuler / Fusionner (N) » posée sous la rangée pendant la sélection. */
export function BarreDeFusion({ fusion, className }: { fusion: FusionDePropositions; className?: string }) {
  if (!fusion.selectionActive) return null;
  return (
    <div data-fusion-propositions="actions" className={cn('flex items-center gap-1.5 border-t border-border py-1.5', className)}>
      <Button size="sm" variant="ghost" className="flex-1" disabled={fusion.enCours} onClick={fusion.fermer}>
        {t('Annuler')}
      </Button>
      <Button
        size="sm"
        variant="default"
        className="flex-1"
        disabled={fusion.selection.length < 2 || fusion.enCours}
        onClick={fusion.fusionner}
      >
        {fusion.enCours ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitMerge className="h-3 w-3" />}
        {t('Fusionner (')}{fusion.selection.length})
      </Button>
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
export function VignetteProposition({
  messageId,
  agentId,
  proposal,
  selectionActive,
  selectionnee,
  onSelection,
  integrable = false,
  className,
}: {
  messageId: string;
  /**
   * « Intégrer à cette carte » : seulement dans le bloc des suggestions d'une
   * carte, où il y a une carte actuelle à qui envoyer la suggestion.
   */
  integrable?: boolean;
  /** Ajouté au cadre : la rangée des suggestions l'étire à sa hauteur (`flex-1`). */
  className?: string;
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
  const etapes = proposal.etapes ?? [];

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
          ? { engine: resolu.engine.id, model: resolu.model?.id, thinking: resolu.thinking?.id, account: suivant.account }
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
          ? { engine: retenu.engine.id, model: retenu.model?.id, thinking: retenu.thinking?.id, account: choix?.account }
          : undefined,
      });
      client.pushToast(
        accept ? 'success' : 'info',
        accept
          ? etapes.length
            ? t('Suite créée dans « Planifié » : lancez sa carte globale pour démarrer l’étape 1')
            : t('Carte créée dans « Planifié »')
          : t('Carte refusée'),
      );
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('décision impossible'));
    } finally {
      setBusy(false);
    }
  };

  /* LA SUGGESTION PART EN MESSAGE à l'agent de la carte (en file s'il
     travaille), telle qu'on l'a sous les yeux, retouches comprises. */
  const [integration, setIntegration] = React.useState(false);
  const integrer = async () => {
    setBusy(true);
    setIntegration(true);
    try {
      const resultat = await client.call<{ already?: boolean }>({
        type: 'proposal.integrate',
        messageId,
        proposalId: proposal.id,
        title: title.trim() || proposal.title,
        description,
      });
      if (!resultat?.already) client.pushToast('success', t('Envoyé à l\'agent de la carte'));
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('envoi impossible'));
    } finally {
      setBusy(false);
      setIntegration(false);
    }
  };

  const repliable = descriptionRepliable(description);

  return (
    <div
      data-vignette="proposition"
      className={cn('flex w-[min(320px,80vw)] shrink-0 flex-col overflow-hidden rounded-md border border-accent/40 bg-base', className)}
    >
      <div className="flex items-center gap-1.5 border-b border-border bg-raised px-2.5 py-1 text-[12px] text-muted">
        {selectionActive ? (
          <button
            type="button"
            aria-pressed={selectionnee}
            title={selectionnee ? t('Retirer de la fusion') : t('Ajouter à la fusion')}
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
          {etapes.length
            ? t('Suite de {n} étapes à valider', { n: etapes.length })
            : proposal.sourceProposalIds.length
              ? t('Proposition réunie')
              : t('À valider')}
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
            <div className="flex items-center gap-1.5">
              <IconeDuProjetDAccueil proposal={proposal} agentId={agentId} fond="hsl(var(--bg))" />
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="min-w-0 flex-1 rounded border border-border bg-base px-2 py-1 text-[14px] font-medium text-text outline-none focus:border-accent"
              />
            </div>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
              className="mt-1.5 w-full text-[13px]"
            />
          </>
        ) : (
          <>
            <div className="flex items-start gap-1.5">
              <IconeDuProjetDAccueil proposal={proposal} agentId={agentId} fond="hsl(var(--bg))" className="mt-[2px]" />
              <p className="min-w-0 flex-1 text-[14px] font-medium leading-snug text-text">{title}</p>
            </div>
            {description ? (
              ouverte || !repliable ? (
                /* Dépliée, la description défile DANS la vignette : le bandeau
                   garde sa hauteur, il ne mange jamais la conversation. */
                <ZoneDefilement
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

        {/* UNE SUITE SE LIT D'UN BLOC, DANS L'ORDRE : un seul clic la pose entière,
            et ses étapes partiront une à une (`shared/src/suite-de-cartes.ts`). */}
        {etapes.length ? (
          <ol className="mt-2 space-y-1" data-etapes-proposees={etapes.length}>
            {etapes.map((etape, index) => (
              <li key={index} className="flex gap-2 text-[13px] leading-snug" data-etape-proposee={index + 1}>
                <span className="w-4 shrink-0 text-right tabular-nums text-faint">{index + 1}.</span>
                <span className="min-w-0 break-words text-text">{etape.title}</span>
              </li>
            ))}
          </ol>
        ) : null}

        {proposal.labels.length ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {proposal.labels.map((label) => (
              <Badge key={label}>{label}</Badge>
            ))}
          </div>
        ) : null}
      </div>

      {avertissement ? (
        <div className="mx-2.5 mb-2 flex gap-2 rounded-md border border-transparent bg-warning/5 px-2 py-1.5 text-[12px] leading-relaxed text-warning">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0">{avertissement}</span>
        </div>
      ) : null}

      {/* Les réglages de l'agent qui exécutera la carte, choisis dès maintenant :
          chaque menu prend toute la largeur et affiche son libellé entier. */}
      <div className="mt-auto flex flex-col gap-1 border-t border-border px-2 py-1.5">
        <RunSelectors engines={state.engines} choix={choix} onSelect={choisir} pleineLargeur comptes={state.quotas} />
        <Button size="pied" variant="default" disabled={busy || selectionActive} onClick={() => decide(true)}>
          <Check className="h-3 w-3" />  {etapes.length ? t('Créer la suite') : t('Créer la carte')}
</Button>
        {integrable ? (
          <Button
            size="pied"
            variant="ghost"
            disabled={busy || selectionActive}
            onClick={integrer}
            /* SA PROPRE ROUE, LIBELLÉ GARDÉ (capture #f524) : l'attente générique
               du bouton effaçait le texte et ne laissait qu'une roue muette. */
            sansAttente
            title={t('Envoyer cette suggestion en message à l\'agent de cette carte')}
            data-suggestion-integrer=""
            data-integration-en-cours={integration ? '' : undefined}
          >
            {integration ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <CornerDownLeft className="h-3 w-3" aria-hidden />}
            {t('Intégrer à cette carte')}
          </Button>
        ) : null}
        <Button size="pied" variant="ghost" disabled={busy || selectionActive} onClick={() => decide(false)}>
          {t('Refuser')}</Button>
      </div>
    </div>
  );
}
