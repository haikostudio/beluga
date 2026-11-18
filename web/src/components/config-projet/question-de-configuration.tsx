import * as React from 'react';
import { AgentQuestion, type EtatProcedure } from '@beluga/shared';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui';
import { QuestionCard } from '@/components/message-view';
import { ouvrirAgentDeConfiguration } from '@/lib/ouvrir-config-projet';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';

/**
 * LA QUESTION DE L'AGENT DE CONFIGURATION, DANS UNE FENÊTRE AU CENTRE (décision de l'utilisateur du 15/11/2026,
 * carte « Retouches colonne, fil et questions »).
 *
 * Le clic « Initialiser » lance l'agent EN SILENCE, sans tiroir : sa question n'avait donc aucun endroit visible où
 * se poser, sinon la cloche. Dès qu'il en pose une (`state.procedures[...].question`), cette fenêtre s'ouvre D'ELLE-
 * MÊME, quel que soit l'écran affiché : la question, ses choix et la réponse libre (le MÊME rendu que dans un fil,
 * `QuestionCard`, qui répond par `question.answer`), et « Voir la conversation » qui ouvre le tiroir de l'agent.
 *
 * Elle NE s'ouvre PAS : quand le tiroir de cet agent est déjà ouvert (la question y est déjà) ; quand une autre
 * fenêtre est ouverte (elle attend qu'elle se ferme) ; une seconde fois pour la même question, après une fermeture.
 * Elle se referme seule dès la réponse : la question quitte l'état du dialogue.
 */
type QuestionOuverte = { etat: EtatProcedure; question: NonNullable<EtatProcedure['question']> };

/** Les questions déjà montrées : fermées ou répondues, elles ne reviennent pas (le temps de la page). */
const dejaMontrees = new Set<string>();

function tiroirDeLAgentOuvert(etat: EtatProcedure): boolean {
  return !!document.querySelector(`[data-tiroir-agent-configuration="${etat.cible}"]`);
}

/**
 * Une AUTRE fenêtre (centrée ou feuille) est ouverte et VISIBLE : la question attend. Ne comptent pas : un menu
 * flottant, une page de la zone (une tâche ouverte, gardée cachée ou non — c'est un écran, pas une fenêtre).
 */
function uneAutreFenetreOuverte(): boolean {
  return [...document.querySelectorAll('[role="dialog"]:not([data-question-de-configuration])')].some(
    (el) => el.getClientRects().length > 0 && !el.closest('[data-radix-popper-content-wrapper], [data-page-de-zone]'),
  );
}

export function QuestionDeConfiguration() {
  const state = useApp();
  const [ouverte, setOuverte] = React.useState<QuestionOuverte | null>(null);
  const enAttente = React.useMemo(
    () =>
      Object.values(state.procedures ?? {}).flatMap((etat) =>
        etat?.question && !dejaMontrees.has(etat.question.questionId) ? [{ etat, question: etat.question }] : [],
      ),
    [state.procedures],
  );
  /* LA RÉPONSE ARRIVÉE (ici, dans le tiroir ou ailleurs) REFERME LA FENÊTRE : la question a quitté l'état. */
  const toujoursPosee =
    !!ouverte &&
    Object.values(state.procedures ?? {}).some((etat) => etat?.question?.questionId === ouverte.question.questionId);
  React.useEffect(() => {
    if (ouverte && !toujoursPosee) setOuverte(null);
  }, [ouverte, toujoursPosee]);

  React.useEffect(() => {
    if (ouverte || !enAttente.length) return;
    const essayer = () => {
      const suivante = enAttente.find((q) => !dejaMontrees.has(q.question.questionId));
      if (!suivante) return true;
      /* La question est déjà sous les yeux dans le tiroir : elle n'a pas besoin d'une fenêtre. */
      if (tiroirDeLAgentOuvert(suivante.etat)) {
        dejaMontrees.add(suivante.question.questionId);
        return true;
      }
      if (uneAutreFenetreOuverte()) return false;
      dejaMontrees.add(suivante.question.questionId);
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
  const { etat, question } = ouverte;
  /* LA QUESTION RÉELLE, telle que le fil l'a reçue (description, choix illustrés) ; à défaut, celle de l'état. */
  const message = etat.agentId ? state.messages[etat.agentId]?.find((m) => m.id === question.messageId) : undefined;
  const complete =
    message?.questions.find((q) => q.id === question.questionId) ??
    AgentQuestion.parse({ id: question.questionId, question: question.texte, options: question.options });
  const projet = state.projects.find((p) => p.id === etat.projectId);
  const voirLaConversation = () => {
    setOuverte(null);
    ouvrirAgentDeConfiguration(etat.projectId, etat.cible);
  };
  return (
    <Dialog open onOpenChange={(ouvert) => (!ouvert ? setOuverte(null) : undefined)}>
      <DialogContent data-question-de-configuration={etat.cible} className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>
            {etat.cible === 'dev' ? t('L’agent du déploiement vous pose une question') : t('L’agent de la mise en production vous pose une question')}
          </DialogTitle>
        </DialogHeader>
        {projet ? <p className="mb-2 text-center text-[13px] text-muted">{projet.name}</p> : null}
        <QuestionCard messageId={question.messageId} agentId={etat.agentId} projectId={etat.projectId} question={complete} sansEntete />
        <DialogFooter>
          <Button variant="subtle" size="sm" onClick={voirLaConversation} data-voir-la-conversation-configuration>
            {t('Voir la conversation')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
