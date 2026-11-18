import * as React from 'react';
import { ArrowUp, Loader2 } from '@/components/ui/icones';
import { agentTientSonTour, opaciteDuJournal, phrasesDuJournal, questionEnTexteLibre, type Message, type PhraseDuJournal } from '@beluga/shared';
import { Button, Input } from '@/components/ui';
import { QuestionCard, QuestionEnTexteCard } from '@/components/message-view';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';

/**
 * LE JOURNAL D'UN AGENT EN FONDU, AU-DESSUS D'UN CHAMP (carte « Communication 2 : finitions et chats ») : au plus six
 * phrases, la plus récente en bas, pleine ; vers le haut, chacune plus transparente (`opaciteDuJournal`, shared). À
 * chaque nouvelle phrase la pile monte d'une ligne (`styles.css`, rien ne bouge pour qui demande moins d'animations).
 * Les couleurs viennent de l'appelant (`classeTexte`) : Communication 2 y pose son violet, les autres le gris.
 */
export function JournalDeLAgent({ phrases, classeTexte, enTravail = true, className }: { phrases: readonly PhraseDuJournal[]; classeTexte?: string; enTravail?: boolean; className?: string }) {
  if (!phrases.length) return null;
  const derniere = phrases.at(-1)!;
  return (
    <div className={cn('min-w-0 overflow-hidden', className)} aria-live="polite" data-journal-de-l-agent={phrases.length}>
      <ol key={derniere.id} className="flex min-w-0 flex-col gap-0.5" data-journal-pile>
        {phrases.map((p, i) => {
          const rang = phrases.length - 1 - i;
          const recente = rang === 0;
          return (
            <li
              key={p.id}
              className={cn('flex min-w-0 items-center gap-1.5 text-[12.5px] leading-[1.35]', recente ? cn('font-medium', classeTexte ?? 'text-text') : 'text-muted')}
              style={{ opacity: opaciteDuJournal(rang) }}
              data-journal-ligne={rang}
            >
              {recente && enTravail ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <span className="h-3.5 w-3.5 shrink-0" aria-hidden />}
              <span className="min-w-0 truncate">{p.texte}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const SANS_MESSAGES: readonly Message[] = [];

/**
 * CE QU'ON LIT D'UN AGENT POUR LE MONTRER EN LIGNE : ses phrases (depuis `depuis`), s'il travaille, sa question
 * ouverte (outil « ask_user ») ou posée en texte, et son mot de fin. Le fil est réclamé au serveur s'il manque
 * (`client.chargerAgent`), comme le fait le volet de publication.
 */
export function useJournalDeLAgent(agentId: string | null | undefined, depuis = 0) {
  const state = useApp();
  const agent = agentId ? state.agents[agentId] : undefined;
  const messages = (agentId ? state.messages[agentId] : undefined) ?? SANS_MESSAGES;
  React.useEffect(() => {
    if (agentId) void client.chargerAgent(agentId);
  }, [agentId]);
  return React.useMemo(() => {
    const travaille = !!agent && agentTientSonTour(agent);
    const phrases = phrasesDuJournal(messages, depuis);
    let question: { messageId: string; question: Message['questions'][number] } | null = null;
    for (let i = messages.length - 1; i >= 0 && !question; i--) {
      const m = messages[i]!;
      const q = m.questions.find((x) => !x.competence && !x.answer && !x.cancelled);
      if (q) question = { messageId: m.id, question: q };
    }
    const derniere = [...messages].reverse().find((m) => m.role === 'assistant');
    const questionEnTexte = !travaille && !question && derniere ? questionEnTexteLibre(derniere as never) : null;
    const motDeFin = !travaille && derniere && (derniere.createdAt ?? 0) >= depuis ? derniere.content.replace(/```[\s\S]*?```/g, '').replace(/\*\*|__|`/g, '').replace(/^#+\s*/gm, '').trim() : '';
    return { agent, travaille, phrases, question, questionEnTexte: questionEnTexte && derniere ? { messageId: derniere.id, contenu: derniere.content } : null, motDeFin };
  }, [agent, messages, depuis]);
}

/**
 * UN AGENT AFFICHÉ SUR PLACE, SANS SA CONVERSATION (décisions de l'utilisateur, 08/11/2026) : au-dessus d'un champ,
 * ce qu'il fait (le journal en fondu), puis, une fois fini, son seul mot de fin ; sa question ouverte s'y affiche avec
 * ses choix et se répond là (même chemin qu'une conversation : `question.answer`, ou `agent.prompt` pour une question
 * posée en texte) ; le champ lui écrit (`agent.prompt`). Sert à la création d'un compte (Communication 2) et aux
 * agents de Déploiement / Mise en production — jamais un fil complet.
 */
export function AgentEnLigne({
  agentId,
  projectId,
  invite,
  depuis = 0,
  enAttente,
  champ = true,
  classeTexte,
  repere,
  className,
}: {
  agentId: string;
  projectId?: string;
  invite?: string;
  /** Les phrases d'avant ce moment ne se montrent pas (un nouveau tour repart à vide). */
  depuis?: number;
  /** La phrase montrée tant que l'agent travaille sans avoir encore agi. */
  enAttente?: string;
  /** Sans champ : seulement le journal et la question (le champ est ailleurs). */
  champ?: boolean;
  classeTexte?: string;
  repere?: string;
  className?: string;
}) {
  const { travaille, phrases, question, questionEnTexte, motDeFin } = useJournalDeLAgent(agentId, depuis);
  const [texte, setTexte] = React.useState('');
  const [parti, setParti] = React.useState(false);
  const libelle = invite ?? t('Écrire à l’agent…');
  const envoyer = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const propre = texte.trim();
    if (!propre || parti) return;
    setParti(true);
    try {
      await client.call({ type: 'agent.prompt', agentId, text: propre });
      setTexte('');
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('envoi impossible'));
    } finally {
      setParti(false);
    }
  };
  return (
    <div className={cn('flex w-full min-w-0 flex-col gap-2', className)} data-agent-en-ligne={agentId} data-agent-en-ligne-repere={repere} data-agent-travaille={travaille ? 'oui' : 'non'}>
      {travaille ? (
        phrases.length ? (
          <JournalDeLAgent phrases={phrases} {...(classeTexte ? { classeTexte } : {})} />
        ) : (
          <p className={cn('flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium', classeTexte ?? 'text-text')} data-agent-en-ligne-attente>
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            <span className="min-w-0 truncate">{enAttente ?? t('L’agent se met au travail…')}</span>
          </p>
        )
      ) : motDeFin && !question && !questionEnTexte ? (
        <p className="rounded-lg bg-surface px-3 py-2 text-[12.5px] leading-relaxed text-muted" data-agent-mot-de-fin>
          {motDeFin.length > 320 ? `${motDeFin.slice(0, 320)}…` : motDeFin}
        </p>
      ) : null}
      {question ? (
        <div className="min-w-0" data-agent-en-ligne-question={question.question.id}>
          <QuestionCard messageId={question.messageId} agentId={agentId} {...(projectId ? { projectId } : {})} question={question.question} />
        </div>
      ) : questionEnTexte ? (
        <div className="min-w-0" data-agent-en-ligne-question="texte">
          <QuestionEnTexteCard messageId={questionEnTexte.messageId} agentId={agentId} {...(projectId ? { projectId } : {})} contenu={questionEnTexte.contenu} />
        </div>
      ) : null}
      {champ ? (
        <form onSubmit={(e) => void envoyer(e)} className="flex w-full min-w-0 items-center gap-1.5" data-champ-d-ecriture data-agent-en-ligne-champ>
          <Input value={texte} onChange={(e) => setTexte(e.target.value)} placeholder={libelle} aria-label={libelle} className="min-w-0 flex-1 max-sm:text-[16px]" />
          <Button type="submit" size="icon-barre" variant="principal" disabled={!texte.trim() || parti} aria-label="Envoyer" title={t('Envoyer à l’agent')}>
            {parti ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
