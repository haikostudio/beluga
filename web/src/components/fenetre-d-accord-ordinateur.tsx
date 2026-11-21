import * as React from 'react';
import { Loader2, SquareTerminal, Trash2 } from '@/components/ui/icones';
import { REPONSE_ACCEPTER, REPONSE_ACCEPTER_POUR_LA_CARTE, REPONSE_REFUSER, choixDeLAccord, decisionsOuvertes, type DecisionAttendue } from '@beluga/shared';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';

/**
 * LA FENÊTRE D'ACCORD D'UN ORDINATEUR (carte « Piloter le Mac depuis Beluga », 21/11/2026, maquette #d8ba).
 *
 * Quand un agent veut lancer une commande dans le terminal d'un ordinateur relié, ou supprimer quelque chose, il est
 * ARRÊTÉ sur une question qui porte `accordOrdinateur` (`server/src/outil-ordinateur.ts`). Cette fenêtre s'ouvre alors
 * par-dessus n'importe quel écran de Beluga, chez le SEUL propriétaire de l'ordinateur, une demande à la fois (les
 * suivantes attendent leur tour). Elle dit l'ordinateur et la carte, la phrase de l'agent, la commande exacte, si elle
 * supprime ; trois boutons : « Refuser », « Accepter pour toute la carte » (le terminal seulement, jamais une
 * suppression) et « Accepter ». La réponse part comme celle de toute question (`question.answer`) : la fenêtre se ferme
 * aussi sur les autres appareils, puisque la décision quitte la liste. Fermée sans répondre, elle reste dans la cloche.
 */
export function FenetreDAccordOrdinateur() {
  /* Lue par morceaux : posée à la racine, la fenêtre ne se redessine que quand les décisions ou le compte changent. */
  const decisions = React.useSyncExternalStore(client.subscribe, () => client.lireEtat().decisions);
  const monCompte = React.useSyncExternalStore(client.subscribe, () => client.lireEtat().monCompte?.id);
  const monRole = React.useSyncExternalStore(client.subscribe, () => client.lireEtat().monRole);
  /* Ce qui a été répondu ou mis de côté ICI : la fenêtre passe à la suivante sans attendre l'écho du démon. */
  const [ecartees, setEcartees] = React.useState<ReadonlySet<string>>(() => new Set());
  const [envoi, setEnvoi] = React.useState<string | null>(null);

  const demande: DecisionAttendue | undefined = React.useMemo(
    () =>
      decisionsOuvertes(decisions).find(
        (d) => d.accordOrdinateur && d.questionId && d.messageId && !ecartees.has(d.questionId) && (monCompte ? d.accordOrdinateur.compteId === monCompte : monRole === 'admin'),
      ),
    [decisions, ecartees, monCompte, monRole],
  );
  const accord = demande?.accordOrdinateur;

  const ecarter = (questionId: string) => setEcartees((avant) => new Set([...avant, questionId]));

  const repondre = async (reponse: string) => {
    if (!demande?.questionId || !demande.messageId || envoi) return;
    setEnvoi(reponse);
    try {
      await client.call({ type: 'question.answer', messageId: demande.messageId, questionId: demande.questionId, answer: reponse, attachments: [] });
      ecarter(demande.questionId);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('réponse impossible'));
    } finally {
      setEnvoi(null);
    }
  };

  if (!demande || !accord) return null;
  const choix = choixDeLAccord(accord);
  const terminal = accord.genre === 'terminal';
  const Icone = terminal ? SquareTerminal : Trash2;

  return (
    <Dialog open onOpenChange={(ouverte) => !ouverte && ecarter(demande.questionId!)}>
      {/* AUCUN BOUTON N'A LE FOCUS À L'OUVERTURE : une touche Entrée tapée ailleurs n'accepte jamais une commande. */}
      <DialogContent className="sm:w-[min(460px,100%)]" onOpenAutoFocus={(e) => e.preventDefault()} data-fenetre-accord-ordinateur={accord.genre} data-question={demande.questionId}>
        <DialogHeader>
          <DialogTitle>{terminal ? t('Une commande attend votre accord') : t('Une suppression attend votre accord')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-1">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-important-fond text-important">
              <Icone className="h-4 w-4" />
            </span>
            <p className="min-w-0 text-[12.5px] text-muted">
              {demande.lieuTitre
                ? t('Sur « {ordinateur} » · carte « {carte} »', { ordinateur: accord.ordinateurNom, carte: demande.lieuTitre })
                : t('Sur « {ordinateur} »', { ordinateur: accord.ordinateurNom })}
            </p>
          </div>
          <p className="text-[14px] leading-relaxed text-text" data-phrase-accord>
            {accord.phrase}{' '}
            {accord.supprime ? null : <span className="text-muted">{t('Rien n’est supprimé.')}</span>}
          </p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-raised px-3 py-2.5 font-mono text-[12.5px] text-text" data-commande-accord>
            {accord.commande}
          </pre>
          {accord.supprime ? (
            <p className="text-[12.5px] font-medium text-important" data-supprime>
              {terminal ? t('Cette commande supprime ou écrase quelque chose : elle vous sera redemandée à chaque fois.') : t('Supprime : mis à la corbeille du Mac, récupérable tant qu’elle n’est pas vidée.')}
            </p>
          ) : null}
          <p className="text-[12.5px] text-muted">{t('L’agent est en pause jusqu’à votre réponse.')}</p>
        </div>
        <DialogFooter>
          <Button variant="subtle" size="md" onClick={() => void repondre(REPONSE_REFUSER)} disabled={!!envoi} data-accord-reponse="refuser">
            {envoi === REPONSE_REFUSER ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {t('Refuser')}
          </Button>
          {choix.includes(REPONSE_ACCEPTER_POUR_LA_CARTE) ? (
            <Button variant="subtle" size="md" onClick={() => void repondre(REPONSE_ACCEPTER_POUR_LA_CARTE)} disabled={!!envoi} data-accord-reponse="pour-la-carte">
              {envoi === REPONSE_ACCEPTER_POUR_LA_CARTE ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {t('Accepter pour toute la carte')}
            </Button>
          ) : null}
          <Button variant="default" size="md" onClick={() => void repondre(REPONSE_ACCEPTER)} disabled={!!envoi} data-accord-reponse="accepter">
            {envoi === REPONSE_ACCEPTER ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {t('Accepter')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
