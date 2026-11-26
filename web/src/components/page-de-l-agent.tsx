/*
 * LA PAGE D'UN AGENT DE L'ÉQUIPE (carte « Beluga piloté par des agents », 26/11/2026, maquettes #383ee et #b7167 ;
 * d'abord page d'un agent personnalisé, 24/11/2026).
 *
 * La forme commune (`equipe/gabarit-discussion-volet.tsx`) : la CONVERSATION de l'agent à gauche — avec « Nouvelle
 * tâche » au-dessus du champ —, puis le VOLET à droite dont les onglets sont SES OUTILS (développement : Tâches,
 * Aperçu ; communication : Calendrier, Réseaux, Studio ; marketing : Dossier, Référencement, Statistiques ;
 * déploiement : Mise en ligne ; production : État du site, Sauvegardes, Sécurité ; agent libre : ceux qu'on lui
 * choisit) et, en dernier, sa FICHE : visage, prénom, métier, « libre avec ses collègues », puis ses huit rubriques et
 * son journal, avec « Allumer l'agent » / « Mettre en pause » en pied. Dans le fil d'Ariane : son visage, son prénom,
 * son métier et son état (`CranDeLAgent`). « Lancer maintenant » et « Retirer l'agent » vivent dans le menu à trois
 * points.
 *
 * La fiche se remplit pendant la conversation : l'agent écrit chaque point accepté (outil `agent_fiche`), le démon
 * annonce `agentsPerso`, le volet relit. Rien ne part au moteur à l'ouverture : l'agent répond quand on lui écrit.
 */
import * as React from 'react';
import {
  GESTES_A_VALIDER,
  GESTES_AU_CLIC,
  GESTES_PAR_L_EQUIPE,
  OUTILS_D_AGENT,
  PORTRAITS,
  ROLES_D_EQUIPIER,
  RUBRIQUES_DE_LA_FICHE,
  type Card,
  type EtatDuMembre,
  type OutilDAgent,
  type RoleDEquipier,
  completionDeLaFiche,
  etatAffiche,
  ficheComplete,
  rubriquesRemplies,
  type Agent,
  type AgentPerso,
  type LigneDeJournal,
  type RubriqueDeFiche,
} from '@beluga/shared';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, ListeDeroulante, Switch } from '@/components/ui';
import { Loader2, Pause, Play, Plus, Power, Trash2 } from '@/components/ui/icones';
import { CranDuFil, OptionDePage, OptionsDePage, SeparateurDuFil, SuiteDuFil } from '@/components/entete-de-zone';
import { SilhouetteConversation, SilhouetteRubrique } from '@/components/silhouettes';
import { Chat } from '@/components/chat';
import { GabaritDiscussionEtVolet, CLASSE_BOUTON_DU_PIED } from '@/components/equipe/gabarit-discussion-volet';
import { ContenuDeLOutil, PiedDeLOutil, libelleDeLOutil } from '@/components/equipe/outils-de-l-agent';
import { EtatEnForme, PortraitDAgent } from '@/components/equipe/portrait-d-agent';
import { useEquipe } from '@/components/equipe/use-equipe';
import { creerCarteAgent } from '@/components/tiroir-nouvel-agent';
import { usePref } from '@/lib/prefs';
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
                    {t('Toujours à votre clic : {v0}.', { v0: GESTES_AU_CLIC.map(libelleDuGeste).join(', ') })}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-faint" data-gestes-par-l-equipe="">
                    {t('Par l’agent de développement de l’équipe : {v0}.', { v0: GESTES_PAR_L_EQUIPE.map(libelleDuGeste).join(', ') })}
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
    <div className="flex flex-col gap-2" data-pied-agent-perso="">
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

/* ------------------------------------------------------------------ */
/* La page d'un agent de l'équipe                                      */
/* ------------------------------------------------------------------ */

/** Le métier d'un agent, en clair. */
export function libelleDuRole(role: RoleDEquipier): string {
  switch (role) {
    case 'dev':
      return t('Développement');
    case 'com':
      return t('Communication');
    case 'marketing':
      return t('Marketing');
    case 'deploiement':
      return t('Déploiement');
    case 'production':
      return t('Production');
    default:
      return t('Agent');
  }
}

/**
 * LE CRAN DE L'AGENT DANS LE FIL D'ARIANE (décision de l'utilisateur du 26/11/2026) : son visage, son prénom, son
 * métier, puis son ÉTAT — « Vous attend · … » en couleur d'accent avec son point, « Au travail · … » avec l'anneau, ou
 * « Au repos ». Jamais un titre de page de plus.
 */
export function CranDeLAgent({ membre }: { membre: { portrait: string | null; couleur: string; fiche: { nom: string }; role: RoleDEquipier; etat: EtatDuMembre; activite: string | null } }) {
  return (
    <>
      <SeparateurDuFil />
      <span className="flex min-w-0 items-center gap-2" data-cran-de-l-agent={membre.etat}>
        <PortraitDAgent portrait={membre.portrait} couleur={membre.couleur} nom={membre.fiche.nom} taille={22} />
        <span className="shrink-0 font-medium text-text" data-nom-du-cran-agent="">
          {membre.fiche.nom}
        </span>
        <span className="hidden shrink-0 text-muted md:inline">· {libelleDuRole(membre.role)}</span>
        {membre.etat === 'vous-attend' ? (
          <span className="ml-2 flex min-w-0 items-center gap-1.5 text-important" data-etat-du-cran="vous-attend">
            <span aria-hidden className="block h-2 w-2 shrink-0 rounded-full bg-important" />
            <span className="min-w-0 truncate">{membre.activite ? t('Vous attend · {v0}', { v0: membre.activite }) : t('Vous attend')}</span>
          </span>
        ) : membre.etat === 'au-travail' ? (
          <span className="ml-2 flex min-w-0 items-center gap-1.5 text-muted" data-etat-du-cran="au-travail">
            <EtatEnForme etat="au-travail" />
            <span className="min-w-0 truncate">{membre.activite ? t('Au travail · {v0}', { v0: membre.activite }) : t('Au travail')}</span>
          </span>
        ) : (
          <span className="ml-2 shrink-0 text-faint" data-etat-du-cran="repos">
            {t('Au repos')}
          </span>
        )}
      </span>
    </>
  );
}

/** LES RÉGLAGES DE L'AGENT, en tête de sa fiche : visage, prénom, métier, outils d'un agent libre, liberté avec ses collègues. */
function ReglagesDuMembre({ agent, pris }: { agent: AgentPerso; pris: ReadonlySet<string> }) {
  const [envoi, setEnvoi] = React.useState<string | null>(null);
  const [nom, setNom] = React.useState(agent.fiche.nom);
  React.useEffect(() => setNom(agent.fiche.nom), [agent.fiche.nom]);
  const regler = async (cle: string, reglage: Record<string, unknown>) => {
    setEnvoi(cle);
    try {
      await client.call({ type: 'equipe.regler', projectId: agent.projectId, id: agent.id, reglage }, 30000);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Le réglage n’a pas pu s’enregistrer'));
    } finally {
      setEnvoi(null);
    }
  };
  return (
    <div className="flex flex-col gap-4" data-reglages-du-membre={agent.id}>
      <div className="flex flex-col gap-1.5">
        <Label>{t('Prénom')}</Label>
        <Input
          value={nom}
          maxLength={60}
          onChange={(e) => setNom(e.target.value)}
          onBlur={() => nom.trim() && nom.trim() !== agent.fiche.nom && void regler('nom', { nom: nom.trim() })}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          data-prenom-du-membre=""
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>{t('Métier')}</Label>
        <ListeDeroulante
          valeur={agent.role}
          titre={t('Métier')}
          repere="metier-du-membre"
          onChoisir={(role) => void regler('role', { role })}
          options={ROLES_D_EQUIPIER.map((r) => ({ valeur: r, libelle: libelleDuRole(r) }))}
        />
      </div>
      {agent.role === 'libre' ? (
        <div className="flex flex-col gap-1.5">
          <Label>{t('Ses outils')}</Label>
          <ListeDeroulante
            valeur=""
            valeurs={agent.outils}
            titre={t('Ses outils')}
            placeholder={t('Aucun outil')}
            repere="outils-du-membre"
            onChoisir={(o) => void regler('outils', { outils: agent.outils.includes(o as OutilDAgent) ? agent.outils.filter((x) => x !== o) : [...agent.outils, o] })}
            options={OUTILS_D_AGENT.map((o) => ({ valeur: o, libelle: libelleDeLOutil(o) }))}
          />
        </div>
      ) : null}
      <div className="flex items-start gap-3 rounded-xl bg-surface px-3.5 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium text-text">{t('Libre avec ses collègues')}</p>
          <p className="mt-0.5 text-[12.5px] text-muted">
            {agent.role === 'dev'
              ? t('Une tâche demandée par un collègue part seule ; sinon elle attend votre clic dans « Planifié ».')
              : t('Il travaille seul quand un collègue le sollicite ; sinon la demande vous attend.')}
          </p>
        </div>
        <Switch checked={agent.autonome} onCheckedChange={(v) => void regler('autonome', { autonome: v })} disabled={envoi === 'autonome'} data-libre-avec-ses-collegues={agent.autonome ? '1' : '0'} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>{t('Son visage')}</Label>
        <div className="flex flex-wrap gap-1.5" data-choix-du-portrait="">
          {PORTRAITS.map((p) => {
            const choisi = agent.portrait === p.id;
            const occupe = pris.has(p.id) && !choisi;
            return (
              <button
                key={p.id}
                type="button"
                disabled={occupe || envoi === 'portrait'}
                onClick={() => void regler('portrait', { portrait: p.id, couleur: null })}
                className={cn('rounded-full outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-teinte', occupe && 'opacity-25')}
                title={occupe ? t('Déjà le visage d’un autre agent de l’équipe') : undefined}
                aria-pressed={choisi}
                data-portrait-a-choisir={p.id}
              >
                <PortraitDAgent portrait={p.id} couleur={p.couleur} nom={agent.fiche.nom} taille={34} cerne={choisi} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

type OngletDeLAgent = OutilDAgent | 'fiche';

export function PageDeLAgent({
  projectId,
  agentPersoId,
  onRetour,
  onOuvrirCarte,
  onCree,
}: {
  projectId: string;
  agentPersoId: string;
  onRetour: () => void;
  onOuvrirCarte: (card: Card) => void;
  onCree?: (cardId: string) => void;
}) {
  const state = useApp();
  const telephone = useTelephone();
  const { agent: perso, journal, panne } = useAgentPerso(projectId, agentPersoId);
  const { equipe } = useEquipe(projectId);
  const [retrait, setRetrait] = React.useState(false);
  const [creation, setCreation] = React.useState(false);
  const agent: Agent | null = perso?.agentId ? (state.agents[perso.agentId] ?? null) : null;
  const brouillon = !!perso && !ficheComplete(perso.fiche);
  const membres = React.useMemo(() => [...(equipe?.agents ?? []), ...(equipe?.groupe?.agents ?? [])], [equipe]);
  const membre = membres.find((m) => m.id === agentPersoId) ?? null;
  /* LA CONVERSATION D'UN MEMBRE SEMÉ s'ouvre à sa première visite (il n'en avait pas : il ne coûtait rien). */
  const ouverture = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!perso || perso.agentId || ouverture.current === perso.id) return;
    ouverture.current = perso.id;
    client.call({ type: 'agentsPerso.conversation', projectId, id: perso.id }, 30000).catch((err: any) => client.pushToast('error', err?.message ?? t('La conversation n’a pas pu s’ouvrir')));
  }, [perso?.id, perso?.agentId, projectId]);
  const outils: OutilDAgent[] = perso?.outils ?? [];
  const cles: OngletDeLAgent[] = [...outils, 'fiche'];
  const [retenu, setRetenu] = usePref<string>(`agent.onglet.${agentPersoId}`, '');
  const onglet: OngletDeLAgent = (cles as string[]).includes(retenu) ? (retenu as OngletDeLAgent) : (cles[0] ?? 'fiche');
  const pris = React.useMemo(() => new Set(membres.filter((m) => m.projectId === perso?.projectId && m.id !== agentPersoId).map((m) => m.portrait).filter((p): p is string => !!p)), [membres, perso?.projectId, agentPersoId]);

  const nouvelleTache = async () => {
    if (creation) return;
    setCreation(true);
    try {
      await creerCarteAgent(projectId, (id) => onCree?.(id));
    } finally {
      setCreation(false);
    }
  };

  const conversation = agent ? (
    <Chat
      agent={agent}
      projectId={projectId}
      libelleDuChamp={brouillon ? t('Dites à l’agent ce qu’il doit faire…') : t('Écrire à {v0}…', { v0: perso?.fiche.nom ?? '' })}
      enTeteDuFil={brouillon ? <AccueilDuBrouillon /> : undefined}
      auDessusDuChamp={
        <div className="flex px-1 pb-1.5">
          <button
            type="button"
            onClick={() => void nouvelleTache()}
            disabled={creation}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-muted transition-colors hover:bg-raised hover:text-text"
            data-nouvelle-tache-de-l-agent={agentPersoId}
          >
            {creation ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {t('Nouvelle tâche')}
          </button>
        </div>
      }
    />
  ) : (
    <div className="px-4 pt-3">{panne ? <p className="text-[13px] text-danger">{panne}</p> : <SilhouetteConversation bulles={2} />}</div>
  );

  const contenu =
    !perso ? (
      <SilhouetteRubrique />
    ) : onglet === 'fiche' ? (
      <div className="flex flex-col gap-6 pb-4">
        <ReglagesDuMembre agent={perso} pris={pris} />
        <ConfigurationDeLAgent agent={perso} journal={journal} />
      </div>
    ) : (
      <ContenuDeLOutil outil={onglet} projectId={projectId} membres={membres} onOuvrirCarte={onOuvrirCarte} onFermerLApercu={() => setRetenu(outils.find((o) => o !== 'apercu') ?? 'fiche')} />
    );
  const pied = !perso ? null : onglet === 'fiche' ? (
    <PiedDeLAgent agent={perso} telephone={telephone} />
  ) : onglet === 'taches' ? (
    <button type="button" onClick={() => void nouvelleTache()} disabled={creation} className={CLASSE_BOUTON_DU_PIED} data-nouvelle-tache-du-volet={agentPersoId}>
      {creation ? <Loader2 className="animate-spin" /> : <Plus />}
      <span className="min-w-0 truncate">{t('Nouvelle tâche')}</span>
    </button>
  ) : (
    <PiedDeLOutil outil={onglet} projectId={projectId} />
  );

  return (
    <>
      <SuiteDuFil onRacine={onRetour} retour={{ action: onRetour, reperes: { 'data-agent-perso-retour': '' } }}>
        {membre ? (
          <CranDeLAgent membre={membre} />
        ) : (
          <CranDuFil data-cran-agent-perso={agentPersoId}>{nomDeLAgent(perso)}</CranDuFil>
        )}
      </SuiteDuFil>
      {perso ? (
        <OptionsDePage enMenu>
          <OptionDePage
            icone={<Play className="h-4 w-4" />}
            onClick={() => void lancerMaintenant(perso)}
            disabled={lancementImpossible(perso) !== null}
            title={lancementImpossible(perso) ?? undefined}
            data-option-lancer-agent-perso=""
          >
            {t('Lancer maintenant')}
          </OptionDePage>
          <OptionDePage icone={<Trash2 className="h-4 w-4" />} onClick={() => setRetrait(true)} data-option-retirer-agent-perso="">
            {t('Retirer l’agent')}
          </OptionDePage>
        </OptionsDePage>
      ) : null}
      {retrait && perso ? <ConfirmationDuRetrait agent={perso} onFermer={() => setRetrait(false)} onRetire={onRetour} /> : null}
      <div className="flex min-h-0 flex-1 flex-col" data-page-agent-perso={agentPersoId} data-role-de-l-agent={perso?.role ?? ''}>
        <GabaritDiscussionEtVolet<OngletDeLAgent>
          repere="agent"
          libelleDuVolet={perso?.fiche.nom ?? 'Agent'}
          discussion={<div className="flex min-h-0 flex-1 flex-col" data-agent-perso-conversation={agent?.id ?? 'chargement'}>{conversation}</div>}
          onglets={cles.map((c) => ({ cle: c, libelle: libelleDeLOutil(c) }))}
          valeur={onglet}
          onChange={(c) => setRetenu(c)}
          contenu={<div className="flex min-h-0 flex-1 flex-col" data-agent-perso-volet="" data-onglet-de-l-agent={onglet}>{contenu}</div>}
          defile={onglet !== 'apercu'}
          pied={pied}
        />
      </div>
    </>
  );
}
