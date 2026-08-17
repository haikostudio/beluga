import * as React from 'react';
import { Loader2, MessageCircleQuestion, RotateCw, Settings2, Sparkles, Check, X } from 'lucide-react';
import {
  CiblePublication,
  LIBELLE_REPOSER_LA_QUESTION,
  RAISON_TOUR_PERDU,
  libelleInitier,
  libelleReglages,
  mentionProcedureEnPlace,
  phraseDeTravail,
  procedureDeLEtape,
  repriseDuDialogue,
  titreDeLaProcedure,
} from '@haikodev/shared';
import { Button, Drawer, Textarea, Tooltip, ZoneDefilement } from '@/components/ui';
import { Markdown } from '@/lib/markdown';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';

/**
 * LE TIROIR QUI DÉFINIT UNE PROCÉDURE DE MISE EN LIGNE.
 *
 * Il s'ouvre de deux endroits, et c'est le MÊME tiroir : le bouton « Initier
 * le… » posé en tête de la colonne tant qu'aucune procédure n'existe, et
 * l'icône de réglages du haut de la colonne une fois qu'il y en a une.
 *
 * Dedans, un agent : il ouvre en DEMANDANT comment cette étape doit se passer
 * pour ce projet, on lui répond en une phrase, il écrit la procédure et le
 * serveur l'enregistre — sur la cible de la colonne d'où l'on vient, jamais sur
 * l'autre. Chaque tour est un tour d'agent payant : rien ne part tout seul, ni
 * à l'ouverture d'un projet, ni en fond.
 *
 * LE DIALOGUE VIT SUR LE SERVEUR, ce tiroir ne fait que le SUIVRE. Un tour dure
 * une à deux minutes (l'agent lit tout le projet) : attendre la réponse d'une
 * requête pendant tout ce temps faisait tourner le témoin sans rien dire, et la
 * question, déjà payée, était perdue dès qu'on refermait le tiroir, qu'on
 * rechargeait la page ou que le lien clignait. Ici, l'état arrive par
 * l'événement `procedure` ; le témoin suit le SEUL champ `enCours`, et un tour
 * qui ne tourne plus le DIT au lieu de tourner à vide.
 */

export function TiroirProcedure({
  projectId,
  cible,
  open,
  onClose,
}: {
  projectId: string;
  cible: CiblePublication | null;
  open: boolean;
  onClose: () => void;
}) {
  const state = useApp();
  const projet = state.projects.find((p) => p.id === projectId);
  const [saisie, setSaisie] = React.useState('');
  /* L'échec de la COMMANDE elle-même (lien coupé, tour perdu) : celui du tour,
     lui, arrive dans l'état diffusé par le serveur. */
  const [erreurLocale, setErreurLocale] = React.useState<string | null>(null);
  const [maintenant, setMaintenant] = React.useState(() => Date.now());

  const etat = cible ? state.procedures[`${projectId}:${cible}`] : undefined;
  const enCours = !!etat?.enCours;
  const bulles = etat?.echanges ?? [];
  const ecrite = etat?.procedure ?? null;
  const erreur = etat?.raison ?? erreurLocale;
  const actuelle = cible ? procedureDeLEtape(projet, cible) : '';
  /* La question posée par l'outil de l'agent : elle attend ICI, pas seulement
     dans la cloche du bandeau. Tant qu'elle est là, on répond à ELLE. */
  const question = etat?.question ?? null;
  /* Une procédure est déjà écrite et rien ne tourne : le tiroir ne demande
     RIEN à un agent tant qu'on ne le lui dit pas. */
  const enAttenteDeGeste = !!actuelle && !enCours && !question && !bulles.length && !ecrite && !erreur;

  /* La dernière étape de l'agent : elle prouve, seconde après seconde, que le
     tour est bien VIVANT — un témoin muet ne se distingue pas d'un blocage. */
  const etape = React.useMemo(() => {
    if (!enCours || !etat?.agentId) return undefined;
    const messages = state.messages[etat.agentId] ?? [];
    const dernier = messages[messages.length - 1];
    const etapes = dernier?.steps ?? [];
    return etapes[etapes.length - 1]?.label;
  }, [enCours, etat?.agentId, state.messages]);

  const lancer = React.useCallback(
    async (message?: string) => {
      if (!cible) return;
      setErreurLocale(null);
      try {
        const res: any = await client.call({ type: 'procedure.tour', projectId, cible, agentId: etat?.agentId, message });
        client.majProcedure(projectId, cible, res?.etat ?? null);
      } catch (err: any) {
        setErreurLocale(err?.message ?? t('la demande n’est pas partie'));
      }
    },
    [cible, projectId, etat?.agentId],
  );

  /*
   * À L'OUVERTURE, on demande d'abord l'ÉTAT : un tour déjà en train de tourner
   * se rejoint (on n'en paie pas un second), une question posée pendant que le
   * tiroir était fermé se relit, et ce n'est qu'à défaut qu'un tour part.
   *
   * ET SI UNE PROCÉDURE EST DÉJÀ ÉCRITE, RIEN NE PART. L'icône de réglages
   * relançait un agent complet à chaque clic — il relisait tout le projet pour
   * reposer une question déjà tranchée. Le tiroir montre alors ce qui existe et
   * attend : on écrit ce qu'on veut changer, ou on repose la question soi-même.
   */
  React.useEffect(() => {
    if (!open || !cible) return;
    let vivant = true;
    setSaisie('');
    setErreurLocale(null);
    (async () => {
      try {
        const res: any = await client.call({ type: 'procedure.etat', projectId, cible });
        if (!vivant) return;
        const reprise = repriseDuDialogue(res?.etat ?? null, Date.now(), !!actuelle);
        /* « proposer » : le dialogue d'avant a abouti, sa procédure est
           désormais SUR LE PROJET. On repart donc de l'écran propre — la
           procédure en place — au lieu de rejouer un échange déjà clos. */
        client.majProcedure(projectId, cible, reprise === 'proposer' ? null : (res?.etat ?? null));
        if (reprise === 'relancer') await lancer();
      } catch (err: any) {
        if (vivant) setErreurLocale(err?.message ?? t('le serveur n’a pas répondu'));
      }
    })();
    return () => {
      vivant = false;
    };
    // `lancer` change avec l'agent du dialogue : le relire ici relancerait un
    // tour à chaque réponse. L'ouverture ne dépend que du tiroir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cible, projectId]);

  /*
   * PENDANT L'ATTENTE : l'horloge avance (la durée se voit), et l'état est
   * revérifié régulièrement. Un serveur redémarré a perdu le dialogue : il rend
   * alors « rien », et on le DIT — c'est ce qui remplace un témoin sans fin.
   */
  React.useEffect(() => {
    if (!open || !cible || !enCours) return;
    const horloge = window.setInterval(() => setMaintenant(Date.now()), 1000);
    const veille = window.setInterval(async () => {
      try {
        const res: any = await client.call({ type: 'procedure.etat', projectId, cible });
        client.majProcedure(projectId, cible, res?.etat ?? null);
        if (!res?.etat) setErreurLocale(RAISON_TOUR_PERDU);
      } catch {
        /* lien coupé : la reconnexion redemandera */
      }
    }, 15000);
    return () => {
      window.clearInterval(horloge);
      window.clearInterval(veille);
    };
  }, [open, cible, projectId, enCours]);

  if (!cible) return null;

  /*
   * RÉPONDRE À LA QUESTION DE L'AGENT, DEPUIS LE TIROIR. Elle vient de l'outil
   * `ask_user` : son tour est ARRÊTÉ dessus, la réponse lui est rendue dans
   * l'appel même et il reprend aussitôt — aucun tour de plus n'est payé.
   */
  const repondreALaQuestion = async (texte: string) => {
    if (!question || !texte.trim()) return;
    setSaisie('');
    setErreurLocale(null);
    try {
      await client.call({
        type: 'question.answer',
        messageId: question.messageId,
        questionId: question.questionId,
        answer: texte.trim(),
      });
    } catch (err: any) {
      setErreurLocale(err?.message ?? t('la réponse n’est pas partie'));
    }
  };

  const envoyer = async () => {
    const message = saisie.trim();
    if (!message) return;
    // Une question ouverte prime : on lui répond au lieu de payer un tour.
    if (question) return repondreALaQuestion(message);
    if (enCours) return;
    setSaisie('');
    await lancer(message);
  };

  return (
    <Drawer open={open} onClose={onClose}>
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4" data-tiroir-procedure={cible}>
        <h2 className="shrink-0 text-[15px] font-medium text-text">
          {titreDeLaProcedure(cible)} — {actuelle ? t('modifier la procédure') : t('définir la procédure')}
        </h2>
        <p className="mt-1 shrink-0 text-[12.5px] text-faint">
          {t('Un agent lit le projet, demande comment cette étape doit se passer, puis écrit la procédure. Elle ne vaut que pour cette colonne.')}</p>

        <ZoneDefilement classeEnveloppe="mt-3 min-h-0 flex-1" className="space-y-2 pr-1">
          {/* La procédure DÉJÀ en place, quand on rouvre pour la modifier. */}
          {actuelle && !ecrite ? (
            <div className="rounded-md border border-border bg-raised p-2.5" data-procedure-actuelle>
              <p className="mb-1 text-[12px] uppercase tracking-wide text-faint">{t('Procédure en place')}</p>
              <div className="whitespace-pre-wrap text-[13px] text-muted">{actuelle}</div>
            </div>
          ) : null}

          {bulles.map((bulle, i) => (
            <div
              key={i}
              className={
                bulle.qui === 'agent'
                  ? 'rounded-md border border-border bg-raised p-2.5 text-[13px] text-text'
                  : 'ml-8 rounded-md border border-border/60 bg-surface p-2.5 text-[13px] text-muted'
              }
              data-bulle-procedure={bulle.qui}
            >
              {bulle.qui === 'agent' ? <Markdown content={bulle.texte} /> : bulle.texte}
            </div>
          ))}

          {/* LA QUESTION DE L'AGENT, ICI ET PAS SEULEMENT DANS LA CLOCHE. Son
              tour est arrêté dessus : on y répond sur place, d'un choix ou
              d'une phrase, et il reprend sans qu'un tour de plus soit payé. */}
          {question ? (
            <div
              className="rounded-md border border-warning/50 bg-raised p-2.5"
              data-question-procedure={question.questionId}
            >
              <p className="mb-1 flex items-center gap-1.5 text-[12px] uppercase tracking-wide text-warning">
                <MessageCircleQuestion className="h-3 w-3" />  {t('L’agent attend votre réponse')}
</p>
              <div className="text-[13px] text-text">
                <Markdown content={question.texte} />
              </div>
              {question.options.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {question.options.map((option) => (
                    <Button
                      key={option.id}
                      size="sm"
                      variant="outline"
                      data-option-procedure={option.id}
                      onClick={() => void repondreALaQuestion(option.label)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Une procédure est en place et rien ne tourne : on le DIT, au lieu
              d'allumer un agent que personne n'a demandé. */}
          {enAttenteDeGeste ? (
            <div className="space-y-1.5" data-procedure-en-attente>
              <p className="text-[12.5px] text-faint">{mentionProcedureEnPlace(cible)}</p>
              <Button size="sm" variant="outline" onClick={() => void lancer()} data-reposer-question>
                <RotateCw className="h-3 w-3" />
                {LIBELLE_REPOSER_LA_QUESTION}
              </Button>
            </div>
          ) : null}

          {/* Le témoin suit l'AGENT, jamais une requête en attente : il dit ce
              que l'agent fait et depuis combien de temps, et il s'éteint dès
              que plus rien ne tourne — réussite comme échec. */}
          {enCours ? (
            <p className="flex items-center gap-1.5 text-[12.5px] text-faint" data-procedure-en-cours>
              <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
              <span className="truncate">{phraseDeTravail({ depuis: etat?.depuis, etape }, maintenant)}</span>
            </p>
          ) : null}

          {erreur && !enCours ? (
            <div className="space-y-1.5" data-erreur-procedure>
              <p className="flex items-start gap-1.5 text-[12.5px] text-danger">
                <X className="mt-[3px] h-3 w-3 shrink-0" />
                <span>{erreur}</span>
              </p>
              {/* Un échec ne se rejoue jamais tout seul : un tour coûte. */}
              <Button size="sm" variant="outline" onClick={() => void lancer()} data-relancer-procedure>
                <RotateCw className="h-3 w-3" />
                
{t('Relancer la question')}
</Button>
            </div>
          ) : null}

          {ecrite ? (
            <div className="rounded-md border border-success/40 bg-raised p-2.5" data-procedure-ecrite>
              <p className="mb-1 flex items-center gap-1.5 text-[12px] uppercase tracking-wide text-success">
                <Check className="h-3 w-3" />  {t('Enregistrée')}
</p>
              <div className="whitespace-pre-wrap text-[13px] text-muted">{ecrite}</div>
            </div>
          ) : null}
        </ZoneDefilement>

        <div className="mt-3 shrink-0 space-y-2">
          <Textarea
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            rows={3}
            placeholder={
              question
                ? t('Répondez à la question de l’agent…')
                : actuelle
                  ? t('Que voulez-vous changer à cette procédure ?')
                  : t('Répondez à l’agent : comment cette mise en ligne doit-elle se passer ?')
            }
            data-reponse-procedure
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void envoyer();
            }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              {t('Fermer')}</Button>
            {/* Un tour qui tourne bloque l'envoi — SAUF s'il est arrêté sur une
                question : c'est justement de sa réponse qu'il a besoin. */}
            <Button
              size="sm"
              disabled={(enCours && !question) || !saisie.trim()}
              onClick={() => void envoyer()}
              data-envoyer-procedure
            >
              {enCours && !question ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {question ? t('Répondre') : t('Envoyer')}
            </Button>
          </div>
        </div>
      </div>
    </Drawer>
  );
}

/**
 * L'ICÔNE DE RÉGLAGES, en haut à DROITE de la colonne, une fois la procédure en
 * place. Elle rouvre le même tiroir pour la modifier — et ne paraît pas tant
 * qu'il n'y a rien à modifier : c'est le bouton « Initier… » qui tient alors sa
 * place, en tête de la colonne.
 */
export function BoutonReglagesProcedure({
  cible,
  onOuvrir,
}: {
  cible: CiblePublication;
  onOuvrir: () => void;
}) {
  return (
    <Tooltip label={libelleReglages(cible)}>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 shrink-0 px-1.5 text-faint"
        aria-label={libelleReglages(cible)}
        data-reglages-procedure={cible}
        onClick={onOuvrir}
      >
        <Settings2 className="h-4 w-4" />
      </Button>
    </Tooltip>
  );
}

/**
 * LE BOUTON « INITIER… », posé là où vit d'habitude le bouton d'action, tant
 * qu'aucune procédure n'existe pour cette étape. Il tient toute la largeur : à
 * cet endroit, il n'y a rien d'autre à faire dans cette colonne.
 */
export function BoutonInitierProcedure({
  cible,
  onOuvrir,
}: {
  cible: CiblePublication;
  onOuvrir: () => void;
}) {
  return (
    <Button size="sm" className="w-full" data-initier-procedure={cible} onClick={onOuvrir}>
      <Sparkles className="h-3 w-3 shrink-0" />
      <span className="truncate">{libelleInitier(cible)}</span>
    </Button>
  );
}
