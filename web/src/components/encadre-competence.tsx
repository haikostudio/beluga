import * as React from 'react';
import { Check, Loader2, Sparkles, X } from 'lucide-react';
import { REPONSE_PAS_UTILE, REPONSE_UTILISER, type Message } from '@beluga/shared';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * L'ENCADRÉ VIOLET D'UNE COMPÉTENCE PROPOSÉE — un par compétence, tous visibles.
 *
 * Ce n'est pas une question de l'agent : c'est Beluga Build qui a trouvé, dans
 * le pool, une compétence qui parle de la demande
 * (`shared/src/proposition-competence.ts`). L'encadré dit son TITRE, CE QUI
 * CORRESPOND au besoin, et offre deux gestes : le bouton violet « Utiliser »,
 * et le lien discret « Pas utile ». Tant qu'un encadré de la série attend, le
 * cadrage est arrêté ; seules les compétences validées partent, en entier, avec
 * l'agent qui exécute la carte.
 *
 * À LA DIFFÉRENCE DES QUESTIONS, ILS NE SE FEUILLETTENT PAS : trois encadrés au
 * plus, chacun tranché d'un clic — les cacher derrière une pagination ferait
 * perdre plus de temps qu'ils n'en prennent.
 *
 * SON VIOLET EST LE SIEN (`--competence`), distinct de `--publie` qui dit
 * « publication en cours ». Le cadre suit ce jeton, jamais `--border` : onze
 * palettes sur douze n'ont pas de bordure, et ce cadre-là porte une information.
 *
 * Une fois tranché, l'encadré se REPLIE sur une ligne qui garde sa décision.
 */
export function EncadreCompetence({
  messageId,
  question,
}: {
  messageId: string;
  question: Message['questions'][number];
}) {
  /* Le geste parti : le bouton le dit dès le clic, sans attendre le serveur. */
  const [parti, setParti] = React.useState<'utiliser' | 'ecarter' | null>(null);
  const titre = question.competence?.titre ?? question.question;

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
      });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('réponse impossible'));
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
        <span className="min-w-0 flex-1 truncate">{titre}</span>
        <span className={cn('shrink-0 text-[12.5px]', utilisee ? 'text-competence' : 'text-faint')}>
          {utilisee ? t('Compétence utilisée') : t('Compétence écartée')}
        </span>
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
  questions,
}: {
  messageId: string;
  questions: Message['questions'];
}) {
  const proposees = questions.filter((question) => question.competence);
  if (!proposees.length) return null;
  return (
    <div className="mt-2 flex flex-col gap-1.5" data-competences-proposees={proposees.length}>
      {proposees.map((question) => (
        <EncadreCompetence key={question.id} messageId={messageId} question={question} />
      ))}
    </div>
  );
}
