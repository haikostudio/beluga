/*
 * LA PAGE D'UN AGENT PERSONNALISÉ (carte « Agents personnalisés dans les projets », 24/11/2026, maquette #4c46).
 *
 * Construite comme la page d'un projet du service Sécurité (`securite.tsx`) : la CONVERSATION de l'agent à gauche
 * (largeur bornée à 820 px), la poignée, puis à droite le VOLET COMMUN du plan (`volet-comme-un-plan.tsx` : même fond,
 * même fenêtre, même largeur retenue) qui porte « Configuration de l'agent » — ses huit rubriques, « À définir dans la
 * conversation » en gris tant qu'elles ne le sont pas, le compteur « n sur 8 », puis son journal. Le pied du volet,
 * collé en bas : « Allumer l'agent » (éteint tant que la fiche est incomplète), « Mettre en pause », « Lancer
 * maintenant ». Sur téléphone, deux onglets : Conversation et Configuration, tous deux montés.
 *
 * La fiche se remplit pendant la conversation : l'agent écrit chaque point accepté (outil `agent_fiche`), le démon
 * annonce `agentsPerso`, le volet relit. Rien ne part au moteur à l'ouverture : l'agent répond quand on lui écrit.
 */
import * as React from 'react';
import {
  GESTES_A_VALIDER,
  GESTES_PAR_CARTE,
  RUBRIQUES_DE_LA_FICHE,
  completionDeLaFiche,
  etatAffiche,
  ficheComplete,
  rubriquesRemplies,
  type Agent,
  type AgentPerso,
  type LigneDeJournal,
  type RubriqueDeFiche,
} from '@beluga/shared';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, ZoneDefilement } from '@/components/ui';
import { BarreDOnglets } from '@/components/ui/barre-d-onglets';
import { Loader2, Pause, Play, Power, Trash2 } from '@/components/ui/icones';
import { CranDuFil, OptionDePage, OptionsDePage, SuiteDuFil } from '@/components/entete-de-zone';
import { SilhouetteConversation, SilhouetteRubrique } from '@/components/silhouettes';
import { Chat } from '@/components/chat';
import { ResizeHandle, useResizable } from '@/components/resizer';
import { CLASSE_FENETRE_DU_VOLET, CLASSE_VOLET_DU_PLAN, CLE_DE_LARGEUR_DU_PLAN, PanneauDuVolet, bornesDuVoletDuPlan, usePlaceDeLaRangee } from '@/components/volet-comme-un-plan';
import { BadgeDEtat, libelleDuGeste, nomDeLAgent, quandIlAgit, quandLisible, titreDeRubrique } from '@/components/agents-du-projet';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { useTelephone } from '@/lib/telephone';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/** Un agent et son journal, relus à l'ouverture et à chaque changement annoncé dans le projet. */
function useAgentPerso(projectId: string, id: string): { agent: AgentPerso | null; journal: LigneDeJournal[]; panne: string | null } {
  const version = useApp().agentsPersoVersions[projectId] ?? 0;
  const [etat, setEtat] = React.useState<{ agent: AgentPerso | null; journal: LigneDeJournal[]; panne: string | null }>({ agent: null, journal: [], panne: null });
  React.useEffect(() => {
    let vivant = true;
    client
      .call<{ agent: AgentPerso; journal: LigneDeJournal[] }>({ type: 'agentsPerso.lire', projectId, id })
      .then((r) => {
        if (!vivant) return;
        setEtat({ agent: r.agent, journal: r.journal ?? [], panne: null });
        if (r.agent.agentId && !client.lireEtat().agents[r.agent.agentId]) void client.chargerAgent(r.agent.agentId);
      })
      .catch((err: any) => vivant && setEtat((e) => ({ ...e, panne: err?.message ?? t('Cet agent n’a pas pu se lire') })));
    return () => {
      vivant = false;
    };
  }, [projectId, id, version]);
  return etat;
}

/** La valeur d'une rubrique, en lignes courtes ; `null` quand elle reste à définir. */
function valeurDeRubrique(agent: AgentPerso, rubrique: RubriqueDeFiche): React.ReactNode | null {
  const f = agent.fiche;
  if (!rubriquesRemplies(f).includes(rubrique)) return null;
  const liste = (l: string[], vide: string) =>
    l.length ? (
      <ul className="flex flex-col gap-0.5">
        {l.map((x, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden className="mt-[7px] block h-1 w-1 shrink-0 rounded-full bg-muted" />
            <span className="min-w-0">{x}</span>
          </li>
        ))}
      </ul>
    ) : (
      <span className="text-muted">{vide}</span>
    );
  switch (rubrique) {
    case 'nom':
      return f.nom;
    case 'mission':
      return f.mission;
    case 'quand':
      return quandIlAgit(agent);
    case 'seul':
      return liste(f.faitSeul ?? [], t('Rien sans vous demander'));
    case 'demande':
      return liste(f.demandeAccord ?? [], t('Rien à vous demander'));
    case 'jamais':
      return liste(f.jamais ?? [], t('Rien de plus que ce qui est toujours proposé en tâche'));
    case 'emporte': {
      const e = f.emporte!;
      return (
        <span className="flex flex-col gap-0.5">
          <span>
            <span className="text-muted">{t('Compétences')} : </span>
            {e.competences.length ? e.competences.join(', ') : t('aucune')}
          </span>
          <span>
            <span className="text-muted">{t('Accès du coffre-fort')} : </span>
            {e.acces.length ? e.acces.join(', ') : t('aucun')}
          </span>
          <span>
            <span className="text-muted">{t('Mémoire du projet')} : </span>
            {e.memoire ? t('oui') : t('non')}
          </span>
        </span>
      );
    }
    case 'limite':
      if (f.limite === 'aucune') return t('Aucune limite');
      return f.limite
        ? f.limite.periode === 'jour'
          ? t('{v0} passage(s) par jour au plus', { v0: f.limite.passages })
          : f.limite.periode === 'semaine'
            ? t('{v0} passage(s) par semaine au plus', { v0: f.limite.passages })
            : t('{v0} passage(s) par mois au plus', { v0: f.limite.passages })
        : null;
  }
}

/** La couleur d'une ligne du journal : le bleu pour ce qui attend un geste, le rouge pour une panne. */
function classeDeLIssue(issue: LigneDeJournal['issue']): string {
  if (issue === 'a_valider') return 'text-important';
  if (issue === 'panne') return 'text-danger';
  if (issue === 'en_cours') return 'text-text';
  return 'text-muted';
}

/** LA CONFIGURATION DE L'AGENT : ses huit rubriques, puis son journal. */
function ConfigurationDeLAgent({ agent, journal }: { agent: AgentPerso; journal: LigneDeJournal[] }) {
  const { remplies, total } = completionDeLaFiche(agent.fiche);
  return (
    <div className="flex flex-col gap-4 pb-4" data-configuration-agent-perso={agent.id}>
      <div className="flex items-center gap-3">
        <BadgeDEtat etat={etatAffiche(agent)} />
        <span className="ml-auto shrink-0 tabular-nums text-[12.5px] text-muted" data-completion-agent-perso={`${remplies}/${total}`}>
          {t('{v0} sur {v1}', { v0: remplies, v1: total })}
        </span>
      </div>
      <ul className="flex flex-col gap-0.5 rounded-2xl bg-surface p-1.5">
        {RUBRIQUES_DE_LA_FICHE.map((rubrique) => {
          const valeur = valeurDeRubrique(agent, rubrique);
          return (
            <li key={rubrique} className="rounded-xl px-3.5 py-2.5" data-rubrique-agent-perso={rubrique} data-remplie={valeur !== null ? '' : undefined}>
              <p className="text-[12.5px] font-medium text-muted">{titreDeRubrique(rubrique)}</p>
              <div className={cn('mt-0.5 min-w-0 break-words text-[13.5px]', valeur === null ? 'text-faint' : 'text-text')}>
                {valeur === null ? t('À définir dans la conversation') : valeur}
              </div>
              {rubrique === 'jamais' ? (
                <>
                  {/* L'AGENT FAIT CES GESTES LUI-MÊME, APRÈS VOTRE « VALIDER » (26/11/2026) : plus aucun clic à faire à sa place. */}
                  <p className="mt-1 text-[12.5px] text-faint" data-gestes-verrouilles="" data-gestes-a-valider="">
                    {t('Toujours soumis à votre validation, capture à l’appui : {v0}.', { v0: GESTES_A_VALIDER.map(libelleDuGeste).join(', ') })}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-faint" data-gestes-par-carte="">
                    {t('Toujours proposé en tâche : {v0}.', { v0: GESTES_PAR_CARTE.map(libelleDuGeste).join(', ') })}
                  </p>
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div>
        <h3 className="px-1 text-[13px] font-semibold text-text">{t('Journal')}</h3>
        {journal.length ? (
          <ul className="mt-1.5 flex flex-col gap-0.5 rounded-2xl bg-surface p-1.5" data-journal-agent-perso="">
            {journal.slice(0, 12).map((l) => (
              <li key={l.id} className="flex min-w-0 gap-2.5 rounded-xl px-3 py-2 text-[13px]" data-ligne-journal={l.issue}>
                <span className="shrink-0 tabular-nums text-faint">{quandLisible(l.date)}</span>
                <span className={cn('min-w-0 break-words', classeDeLIssue(l.issue))}>{l.resume}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 px-1 text-[13px] text-faint">{t('Rien pour l’instant.')}</p>
        )}
      </div>
    </div>
  );
}

/** « Lancer maintenant » part-il ? Rend la raison d'un bouton éteint, ou `null`. */
function lancementImpossible(agent: AgentPerso): string | null {
  if (!ficheComplete(agent.fiche)) return t('Terminez sa fiche dans la conversation pour le lancer');
  if (agent.enPassage) return t('Au travail…');
  if (agent.attendUnCompte) return t('En attente d’un compte…');
  return null;
}

/** Le geste « Lancer maintenant », partagé par le pied (ordinateur) et le menu à trois points (téléphone). */
async function lancerMaintenant(agent: AgentPerso): Promise<void> {
  try {
    const r = await client.call<{ issue?: string }>({ type: 'agentsPerso.lancer', projectId: agent.projectId, id: agent.id }, 30000);
    if (r.issue === 'limite') client.pushToast('info', t('Sa limite est atteinte pour cette période : il reprendra à la suivante.'));
    if (r.issue === 'attente-quota') client.pushToast('info', t('Aucun compte n’a de quota pour le moment : le passage partira dès qu’un compte revient.'));
  } catch (err: any) {
    client.pushToast('error', err?.message ?? t('Le geste n’a pas pu partir'));
  }
}

/**
 * LE PIED DU VOLET : allumer ou mettre en pause, puis lancer à la main, l'un sous l'autre en pleine largeur. Sur téléphone, UN SEUL bouton
 * en bas de l'écran (charte) : « Lancer maintenant » passe dans le menu à trois points.
 */
function PiedDeLAgent({ agent, telephone = false }: { agent: AgentPerso; telephone?: boolean }) {
  const [geste, setGeste] = React.useState<'allumer' | 'eteindre' | 'lancer' | null>(null);
  const complete = ficheComplete(agent.fiche);
  const jouer = async (quoi: 'allumer' | 'eteindre' | 'lancer') => {
    setGeste(quoi);
    try {
      if (quoi === 'lancer') await lancerMaintenant(agent);
      else await client.call({ type: quoi === 'allumer' ? 'agentsPerso.allumer' : 'agentsPerso.eteindre', projectId: agent.projectId, id: agent.id }, 30000);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Le geste n’a pas pu partir'));
    } finally {
      setGeste(null);
    }
  };
  return (
    /* UN BOUTON PAR LIGNE, CHACUN SUR TOUTE LA LARGEUR (26/11/2026) : « Allumer » ou « Mettre en pause », puis
       « Lancer maintenant » dessous — à toutes les largeurs, jamais côte à côte. */
    <div className="flex flex-col gap-2 px-5 pb-4 pt-2" data-pied-agent-perso="">
      {agent.actif ? (
        <Button variant="subtle" className="w-full" disabled={!!geste} onClick={() => void jouer('eteindre')} data-agent-perso-eteindre="" data-en-route={geste === 'eteindre' ? '' : undefined}>
          {geste === 'eteindre' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />}
          {t('Mettre en pause')}
        </Button>
      ) : (
        <Button
          variant="default"
          className="w-full"
          disabled={!complete || !!geste}
          title={complete ? undefined : t('Terminez sa fiche dans la conversation pour l’allumer')}
          onClick={() => void jouer('allumer')}
          data-agent-perso-allumer=""
          data-en-route={geste === 'allumer' ? '' : undefined}
        >
          {geste === 'allumer' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
          {t('Allumer l’agent')}
        </Button>
      )}
      {telephone ? null : (
      <Button
        variant="subtle"
        className="w-full"
        disabled={!complete || !!geste || agent.enPassage || agent.attendUnCompte}
        title={complete ? undefined : t('Terminez sa fiche dans la conversation pour le lancer')}
        onClick={() => void jouer('lancer')}
        data-agent-perso-lancer=""
        data-en-route={geste === 'lancer' ? '' : undefined}
      >
        {geste === 'lancer' || agent.enPassage ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        {agent.enPassage ? t('Au travail…') : agent.attendUnCompte ? t('En attente d’un compte…') : t('Lancer maintenant')}
      </Button>
      )}
    </div>
  );
}

/** La confirmation du retrait : la conversation reste archivée, la fiche et le journal s'en vont. */
function ConfirmationDuRetrait({ agent, onFermer, onRetire }: { agent: AgentPerso; onFermer: () => void; onRetire: () => void }) {
  const [envoi, setEnvoi] = React.useState(false);
  const retirer = async () => {
    setEnvoi(true);
    try {
      await client.call({ type: 'agentsPerso.supprimer', projectId: agent.projectId, id: agent.id });
      onFermer();
      onRetire();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('L’agent n’a pas pu être retiré'));
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !envoi && onFermer()}>
      <DialogContent className="sm:w-[min(460px,100%)]" data-confirmer-retrait-agent-perso={agent.id}>
        <DialogHeader>
          <DialogTitle>{t('Retirer « {v0} » ?', { v0: nomDeLAgent(agent) })}</DialogTitle>
        </DialogHeader>
        <DialogDescription className="mt-0">{t('Sa configuration et son journal s’effacent ; ce qu’il attendait de vous est refermé. Sa conversation reste dans les archives du projet.')}</DialogDescription>
        <DialogFooter pleineLargeur>
          <Button variant="danger" disabled={envoi} onClick={() => void retirer()} data-agent-perso-retirer="" data-en-route={envoi ? '' : undefined}>
            {envoi ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {t('Retirer l’agent')}
          </Button>
          <Button variant="ghost" disabled={envoi} onClick={onFermer}>
            {t('Annuler')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Le mot d'accueil d'un agent encore en brouillon, en tête de sa conversation (il défile avec le fil). */
function AccueilDuBrouillon() {
  return (
    <div className="mx-4 mb-2 mt-3 rounded-2xl bg-surface px-4 py-3.5 text-[13.5px]" data-accueil-agent-perso="">
      <p className="font-medium text-text">{t('Dites-lui ce qu’il doit faire.')}</p>
      <p className="mt-1 text-muted">
        {t('Il vous pose ensuite quelques questions, une à la fois : quand agir, ce qu’il fait seul, ce qu’il vous demande, ce qu’il emporte et sa limite. Sa configuration se remplit à droite ; il ne travaille seul qu’une fois allumé.')}
      </p>
    </div>
  );
}

export function PageDeLAgent({ projectId, agentPersoId, onRetour }: { projectId: string; agentPersoId: string; onRetour: () => void }) {
  const state = useApp();
  const telephone = useTelephone();
  const { agent: perso, journal, panne } = useAgentPerso(projectId, agentPersoId);
  const [onglet, setOnglet] = React.useState<'conversation' | 'configuration'>('conversation');
  const [retrait, setRetrait] = React.useState(false);
  const [placeDeLaRangee, setRangee] = usePlaceDeLaRangee();
  const { width, start, reset } = useResizable(CLE_DE_LARGEUR_DU_PLAN, bornesDuVoletDuPlan(placeDeLaRangee));
  const agent: Agent | null = perso?.agentId ? (state.agents[perso.agentId] ?? null) : null;
  const brouillon = !!perso && !ficheComplete(perso.fiche);

  const conversation = agent ? (
    <Chat
      agent={agent}
      projectId={projectId}
      libelleDuChamp={brouillon ? t('Dites à l’agent ce qu’il doit faire…') : t('Écrire à l’agent…')}
      enTeteDuFil={brouillon ? <AccueilDuBrouillon /> : undefined}
    />
  ) : (
    <div className="px-4 pt-3">{panne ? <p className="text-[13px] text-danger">{panne}</p> : <SilhouetteConversation bulles={2} />}</div>
  );
  const configuration = perso ? <ConfigurationDeLAgent agent={perso} journal={journal} /> : <SilhouetteRubrique />;

  return (
    <>
      <SuiteDuFil onRacine={onRetour} retour={{ action: onRetour, reperes: { 'data-agent-perso-retour': '' } }}>
        <CranDuFil onClick={onRetour} dernier={false} data-cran-agents="">
          {t('Agents')}
        </CranDuFil>
        <CranDuFil data-cran-agent-perso={agentPersoId}>{nomDeLAgent(perso)}</CranDuFil>
      </SuiteDuFil>
      {perso ? (
        <OptionsDePage enMenu>
          {telephone ? (
            <OptionDePage
              icone={<Play className="h-4 w-4" />}
              onClick={() => void lancerMaintenant(perso)}
              disabled={lancementImpossible(perso) !== null}
              title={lancementImpossible(perso) ?? undefined}
              data-option-lancer-agent-perso=""
            >
              {t('Lancer maintenant')}
            </OptionDePage>
          ) : null}
          <OptionDePage icone={<Trash2 className="h-4 w-4" />} onClick={() => setRetrait(true)} data-option-retirer-agent-perso="">
            {t('Retirer l’agent')}
          </OptionDePage>
        </OptionsDePage>
      ) : null}
      {retrait && perso ? <ConfirmationDuRetrait agent={perso} onFermer={() => setRetrait(false)} onRetire={onRetour} /> : null}
      {telephone ? (
        <div className="flex min-h-0 flex-1 flex-col" data-page-agent-perso={agentPersoId}>
          <div className="shrink-0 px-4 pb-2 pt-1">
            <BarreDOnglets
              repere="agent-perso-onglets"
              pleineLargeur
              valeur={onglet}
              onChange={setOnglet}
              onglets={[
                { cle: 'conversation', libelle: t('Conversation') },
                { cle: 'configuration', libelle: t('Configuration'), nombre: perso ? completionDeLaFiche(perso.fiche).remplies : null },
              ]}
            />
          </div>
          {/* Les deux restent montés : le champ garde ce qu'on y a écrit en passant d'un onglet à l'autre. */}
          <div className={cn('min-h-0 flex-1 flex-col', onglet === 'conversation' ? 'flex' : 'hidden')} data-agent-perso-conversation={agent?.id ?? 'chargement'}>
            {conversation}
          </div>
          <div className={cn('min-h-0 flex-1 flex-col', onglet === 'configuration' ? 'flex' : 'hidden')}>
            <ZoneDefilement className="px-4 pb-2" classeEnveloppe="min-h-0 flex-1" data-agent-perso-volet="">
              {configuration}
            </ZoneDefilement>
            {perso ? <PiedDeLAgent agent={perso} telephone /> : null}
          </div>
        </div>
      ) : (
        <div ref={setRangee} className="flex min-h-0 min-w-0 flex-1" data-page-agent-perso={agentPersoId} data-plein-cadre>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-agent-perso-conversation={agent?.id ?? 'chargement'}>
            <div className="mx-auto flex min-h-0 w-full max-w-[820px] flex-1 flex-col [--fond-du-pied:transparent] [--retrait-du-fil:1rem]">{conversation}</div>
          </div>
          <ResizeHandle onPointerDown={(e) => start(e, 'right')} onDoubleClick={reset} className="z-30" data-document-poignee="agent-perso" />
          <aside className={cn('min-h-0', CLASSE_VOLET_DU_PLAN)} style={{ width }} aria-label="Configuration de l’agent" data-agent-perso-volet="">
            <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', CLASSE_FENETRE_DU_VOLET)}>
              <PanneauDuVolet
                titre={t('Configuration de l’agent')}
                libelleFermer={t('Revenir aux agents')}
                onFermer={onRetour}
                reperesCroix={{ 'data-croix-du-volet': 'agent-perso' }}
                pied={perso ? <PiedDeLAgent agent={perso} /> : null}
              >
                {configuration}
              </PanneauDuVolet>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
