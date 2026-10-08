import * as React from 'react';
import { Check, Loader2, Sparkles, X } from 'lucide-react';
import { REPONSE_PAS_UTILE, REPONSE_UTILISER, type Message } from '@beluga/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { Markdown } from '@/lib/markdown';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';

/**
 * LA LIGNE D'UNE COMPÉTENCE RETENUE AU CADRAGE — une par compétence.
 *
 * Ce n'est pas une question de l'agent : c'est Beluga Build qui a trouvé, dans
 * le pool, une compétence qui parle de la demande
 * (`shared/src/proposition-competence.ts`), et l'a RETENUE d'office : elle
 * naît « Compétence utilisée », sans arrêter le cadrage. Deux gestes :
 *
 * - UN CLIC SUR SON NOM ouvre une fenêtre par-dessus la conversation, avec son
 *   titre, à quoi elle sert et son mode d'emploi entier ;
 * - UNE PETITE CROIX l'écarte, tant que la carte n'est pas lancée (le démon le
 *   refuse ensuite, `ecarterLaCompetence`).
 *
 * SON VIOLET EST LE SIEN (`--competence`), distinct de `--publie` qui dit
 * « publication en cours ». Le cadre suit ce jeton, jamais `--border` : onze
 * palettes sur douze n'ont pas de bordure, et ce cadre-là porte une information.
 *
 * Un encadré posé AVANT la retenue d'office et resté ouvert garde ses deux
 * boutons « Utiliser » / « Pas utile ».
 */
export function EncadreCompetence({
  messageId,
  agentId,
  question,
}: {
  messageId: string;
  agentId?: string;
  question: Message['questions'][number];
}) {
  const state = useApp();
  /* Le geste parti : le bouton le dit dès le clic, sans attendre le serveur. */
  const [parti, setParti] = React.useState<'utiliser' | 'ecarter' | null>(null);
  const [detail, setDetail] = React.useState(false);
  const titre = question.competence?.titre ?? question.question;
  const cardId = agentId ? state.agents[agentId]?.cardId : undefined;
  const carte = cardId ? state.cards[cardId] : undefined;
  // La croix ne vit que tant que la carte est en cadrage : le démon tranche de toute façon.
  const ecartable = carte?.column === 'planned';

  const trancher = async (geste: 'utiliser' | 'ecarter') => {
    if (parti) return;
    setParti(geste);
    try {
      await client.call({
        type: 'question.answer',
        messageId,
        questionId: question.id,
        // La réponse voyage dans sa forme d'origine : c'est elle que le démon compare.
        answer: geste === 'utiliser' ? REPONSE_UTILISER : REPONSE_PAS_UTILE,
        attachments: [],
      });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('réponse impossible'));
      setParti(null);
    }
  };

  const ecarter = async () => {
    if (parti) return;
    setParti('ecarter');
    try {
      await client.call({ type: 'competence.ecarter', messageId, questionId: question.id });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('réponse impossible'));
    } finally {
      setParti(null);
    }
  };

  const tranchee = Boolean(question.answer) || question.cancelled;
  if (tranchee) {
    const utilisee = question.answer === REPONSE_UTILISER;
    return (
      <div
        className={cn(
          'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[13.5px]',
          utilisee ? 'border-competence/50 text-text' : 'border-faint/30 text-faint',
        )}
        data-competence-proposee={question.competence?.nom}
        data-competence-etat={utilisee ? 'utilisee' : 'ecartee'}
      >
        {utilisee ? (
          <Check className="h-3.5 w-3.5 shrink-0 text-competence" />
        ) : (
          <X className="h-3.5 w-3.5 shrink-0" />
        )}
        <button
          type="button"
          onClick={() => setDetail(true)}
          className="min-w-0 flex-1 truncate text-left underline-offset-2 hover:underline"
          title={question.description || undefined}
          data-competence-titre
        >
          {titre}
        </button>
        <span className={cn('shrink-0 text-[12.5px]', utilisee ? 'text-competence' : 'text-faint')}>
          {utilisee ? t('Compétence utilisée') : t('Compétence écartée')}
        </span>
        {utilisee && ecartable ? (
          <button
            type="button"
            onClick={() => void ecarter()}
            disabled={parti !== null}
            title={t('Écarter')}
            className="-mr-1 shrink-0 rounded p-0.5 text-faint transition-colors hover:bg-raised hover:text-text disabled:opacity-60"
            data-competence-ecarter
          >
            {parti === 'ecarter' ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
          </button>
        ) : null}
        {detail && question.competence ? (
          <FenetreCompetence nom={question.competence.nom} titre={titre} onClose={() => setDetail(false)} />
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border border-competence bg-competence/[0.07] px-3 py-2.5"
      data-competence-proposee={question.competence?.nom}
      data-competence-etat="proposee"
    >
      <p className="flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wide text-competence">
        <Sparkles className="h-3 w-3 shrink-0" />
        {t('Compétence proposée')}
      </p>
      <p className="mt-1 text-[14.5px] font-medium leading-snug text-text" data-competence-titre>
        {titre}
      </p>
      {question.description ? (
        <p className="mt-1 select-text text-[13.5px] leading-relaxed text-muted" data-competence-correspondance>
          {question.description}
        </p>
      ) : null}
      <div className="mt-2.5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void trancher('utiliser')}
          disabled={parti !== null}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-competence px-3 text-[13.5px] font-medium text-competence-fg transition-opacity hover:opacity-90 disabled:opacity-60"
          data-competence-utiliser
        >
          {parti === 'utiliser' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          {t('Utiliser')}
        </button>
        <button
          type="button"
          onClick={() => void trancher('ecarter')}
          disabled={parti !== null}
          className="inline-flex items-center gap-1 text-[13px] text-faint underline-offset-2 transition-colors hover:text-text hover:underline disabled:opacity-60"
          data-competence-ecarter
        >
          {parti === 'ecarter' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {t('Pas utile')}
        </button>
      </div>
    </div>
  );
}

/**
 * LA SÉRIE D'ENCADRÉS D'UN MESSAGE, empilée. Rend rien quand le message ne
 * porte aucune compétence proposée.
 */
export function EncadresDeCompetences({
  messageId,
  agentId,
  questions,
}: {
  messageId: string;
  /** L'agent du message : sa carte dit si la croix est encore offerte. */
  agentId?: string;
  questions: Message['questions'];
}) {
  const proposees = questions.filter((question) => question.competence);
  if (!proposees.length) return null;
  return (
    <div className="mt-2 flex flex-col gap-1.5" data-competences-proposees={proposees.length}>
      {proposees.map((question) => (
        <EncadreCompetence key={question.id} messageId={messageId} agentId={agentId} question={question} />
      ))}
    </div>
  );
}

/**
 * LE MODE D'EMPLOI D'UNE COMPÉTENCE, dans une fenêtre posée par-dessus la
 * conversation : son titre, à quoi elle sert, puis la fiche entière. On la
 * referme et on retrouve sa carte là où on l'avait laissée.
 */
function FenetreCompetence({ nom, titre, onClose }: { nom: string; titre: string; onClose: () => void }) {
  const [fiche, setFiche] = React.useState<{ description: string; corps: string } | null>(null);
  const [erreur, setErreur] = React.useState<string | null>(null);

  React.useEffect(() => {
    let vivant = true;
    client
      .call<{ description: string; corps: string }>({ type: 'competence.lire', nom })
      .then((r) => vivant && setFiche(r))
      .catch((err: any) => vivant && setErreur(err?.message ?? t('Lecture impossible')));
    return () => {
      vivant = false;
    };
  }, [nom]);

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:w-[min(760px,100%)]" data-fenetre-competence={nom}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-competence" />
            <span className="min-w-0 truncate">{titre}</span>
          </DialogTitle>
        </DialogHeader>
        {erreur ? (
          <p className="text-[13px] text-danger">{erreur}</p>
        ) : !fiche ? (
          <div className="flex justify-center py-6 text-faint">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : (
          <div className="flex select-text flex-col gap-3 pb-2">
            {fiche.description ? <p className="text-[13.5px] leading-relaxed text-muted" data-competence-description>{fiche.description}</p> : null}
            <div className="text-[13.5px]" data-competence-mode-d-emploi>
              <Markdown content={fiche.corps} />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
