import * as React from 'react';
import type { Agent, Message } from '@beluga/shared';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui';
import { QuestionCard } from '@/components/message-view';
import { client } from '@/lib/client';
import { EVENEMENT_QUESTION_DU_DEPANNEUR } from '@/lib/evenements-publier';
import { ouvrirUnAgent } from '@/lib/ouvrir-un-agent';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';

/**
 * LA QUESTION DU DÉPANNEUR D'UNE PUBLICATION, DANS UNE FENÊTRE AU CENTRE (décision de l'utilisateur, 21/11/2026,
 * carte « Dépannage de publication discret » : « ça doit être presque invisible pour l'utilisateur »).
 *
 * Le dépannage tourne SANS tiroir : quand l'agent pose une question (`ask_user`, qui l'arrête jusqu'à la réponse),
 * cette fenêtre s'ouvre d'elle-même, quel que soit l'écran — « Mise en production en cours de dépannage », le projet,
 * la question (le MÊME rendu que dans un fil, `QuestionCard`, qui répond par `question.answer` : l'agent repart, puis
 * sa veille reprend la publication). « Voir la conversation » ouvre son tiroir ; « Plus tard » ferme sans répondre.
 *
 * Mêmes règles que `QuestionDeConfiguration` (DEC-256) : jamais deux fois la même question d'elle-même ; jamais quand
 * le tiroir de cet agent est ouvert ; elle attend qu'une autre fenêtre VISIBLE se ferme ; elle se referme quand la
 * question quitte le fil. La cloche (et une notification touchée) la ROUVRE par `EVENEMENT_QUESTION_DU_DEPANNEUR`,
 * même déjà montrée, au lieu d'ouvrir le tiroir.
 */
type QuestionOuverte = { agentId: string; messageId: string; question: Message['questions'][number] };

/** Les questions déjà montrées d'elles-mêmes : fermées ou répondues, elles ne reviennent pas seules (le temps de la page). */
const dejaMontrees = new Set<string>();

function tiroirDuDepanneurOuvert(agentId: string): boolean {
  return [...document.querySelectorAll(`[data-depannage-en-ligne="${CSS.escape(agentId)}"]`)].some((el) => el.getClientRects().length > 0);
}

/** Une AUTRE fenêtre visible (centrée ou feuille) : la question attend. Menus flottants et pages de zone exclus. */
function uneAutreFenetreOuverte(): boolean {
  return [...document.querySelectorAll('[role="dialog"]:not([data-question-du-depanneur])')].some(
    (el) => el.getClientRects().length > 0 && !el.closest('[data-radix-popper-content-wrapper], [data-page-de-zone]'),
  );
}

/** La DERNIÈRE question encore ouverte d'un fil. */
export function questionOuverteDuFil(agentId: string, messages: readonly Message[] | undefined): QuestionOuverte | null {
  for (let i = (messages?.length ?? 0) - 1; i >= 0; i -= 1) {
    const message = messages![i];
    const question = [...(message.questions ?? [])].reverse().find((q) => !q.answer && !q.cancelled);
    if (question) return { agentId, messageId: message.id, question };
  }
  return null;
}

/** Un dépanneur arrêté sur sa question. */
function depanneurQuiAttend(agent: Agent | undefined): agent is Agent {
  return !!agent?.depannagePublication && agent.attendReponse === true;
}

export function QuestionDuDepanneur() {
  const state = useApp();
  const [ouverte, setOuverte] = React.useState<QuestionOuverte | null>(null);
  const qui = React.useMemo(() => Object.values(state.agents).filter(depanneurQuiAttend), [state.agents]);

  /* Le fil d'un dépanneur n'est pas forcément chargé dans l'écran : on le réclame, une fois. */
  const reclames = React.useRef(new Set<string>());
  React.useEffect(() => {
    for (const agent of qui) {
      if (state.messages[agent.id] || reclames.current.has(agent.id)) continue;
      reclames.current.add(agent.id);
      void client.chargerAgent(agent.id);
    }
  }, [qui, state.messages]);

  const enAttente = React.useMemo(
    () =>
      qui.flatMap((agent) => {
        const q = questionOuverteDuFil(agent.id, state.messages[agent.id]);
        return q && !dejaMontrees.has(q.question.id) ? [q] : [];
      }),
    [qui, state.messages],
  );

  /* LA RÉPONSE ARRIVÉE (ici, dans le tiroir ou ailleurs) REFERME LA FENÊTRE. */
  const toujoursPosee = !!ouverte && questionOuverteDuFil(ouverte.agentId, state.messages[ouverte.agentId])?.question.id === ouverte.question.id;
  React.useEffect(() => {
    if (ouverte && !toujoursPosee) setOuverte(null);
  }, [ouverte, toujoursPosee]);

  /* LA CLOCHE ou une notification touchée : la fenêtre se ROUVRE, même déjà montrée. */
  React.useEffect(() => {
    const surDemande = (event: Event) => {
      const agentId = (event as CustomEvent<string>).detail;
      const essayer = () => {
        const q = questionOuverteDuFil(agentId, client.lireEtat().messages[agentId]);
        if (!q) return false;
        dejaMontrees.add(q.question.id);
        setOuverte(q);
        return true;
      };
      if (!essayer()) void client.chargerAgent(agentId).then(() => essayer() || ouvrirUnAgent(agentId));
    };
    window.addEventListener(EVENEMENT_QUESTION_DU_DEPANNEUR, surDemande);
    return () => window.removeEventListener(EVENEMENT_QUESTION_DU_DEPANNEUR, surDemande);
  }, []);

  React.useEffect(() => {
    if (ouverte || !enAttente.length) return;
    const essayer = () => {
      const suivante = enAttente.find((q) => !dejaMontrees.has(q.question.id));
      if (!suivante) return true;
      if (tiroirDuDepanneurOuvert(suivante.agentId)) {
        dejaMontrees.add(suivante.question.id);
        return true;
      }
      if (uneAutreFenetreOuverte()) return false;
      dejaMontrees.add(suivante.question.id);
      setOuverte(suivante);
      return true;
    };
    if (essayer()) return;
    const minuteur = window.setInterval(() => {
      if (essayer()) window.clearInterval(minuteur);
    }, 1500);
    return () => window.clearInterval(minuteur);
  }, [enAttente, ouverte]);

  if (!ouverte) return null;
  const agent = state.agents[ouverte.agentId];
  const projet = state.projects.find((p) => p.id === agent?.projectId);
  const production = agent?.depannagePublication?.cible === 'production';
  const voirLaConversation = () => {
    setOuverte(null);
    ouvrirUnAgent(ouverte.agentId);
  };
  return (
    <Dialog open onOpenChange={(ouvert) => (!ouvert ? setOuverte(null) : undefined)}>
      <DialogContent data-question-du-depanneur={ouverte.agentId} className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{production ? t('Mise en production en cours de dépannage') : t('Déploiement en cours de dépannage')}</DialogTitle>
        </DialogHeader>
        {projet ? <p className="mb-2 text-center text-[13px] text-muted">{projet.name}</p> : null}
        <QuestionCard messageId={ouverte.messageId} agentId={ouverte.agentId} projectId={agent?.projectId} question={ouverte.question} sansEntete />
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOuverte(null)} data-plus-tard-depannage>
            {t('Plus tard')}
          </Button>
          <Button variant="subtle" size="sm" onClick={voirLaConversation} data-voir-la-conversation-depannage>
            {t('Voir la conversation')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
