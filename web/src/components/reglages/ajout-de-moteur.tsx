import * as React from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Cpu, ExternalLink, KeyRound, LogIn, Loader2, Plus, RotateCw, Sparkles, Trash2 } from 'lucide-react';
import {
  compatibiliteAgents,
  connexionTerminee,
  decisionsQuiAlertent,
  descriptionMoteur,
  moteursParCle,
  moteursParPage,
  type Agent,
  type EngineId,
  type FicheMoteur,
  type MotifDeCompatibilite,
} from '@beluga/shared';
import { Badge, BulleInfo, Button, DialogTitle, Drawer, ZoneDefilement } from '@/components/ui';
import { AjouterCle, BlocConnexion } from '@/components/connexion-compte';
import { IconeMoteur } from '@/components/icone-moteur';
import { Chat } from '@/components/chat';
import { RepereAttention } from '@/components/repere-attention';
import { SilhouetteConversation } from '@/components/silhouettes';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { estTelephone } from '@/lib/telephone';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * AJOUTER UN LLM, depuis Réglages › Comptes.
 *
 * UN SEUL bouton, qui ouvre un tiroir : la liste des moteurs CONNUS du registre
 * (`shared/src/registre-moteurs.ts`), chacun avec son geste — la commande de
 * connexion du moteur pour ceux qui se connectent par une page (Claude, Codex),
 * le champ de clé pour ceux qui n'ont qu'une clé (Cursor, MiMo, moteurs
 * ajoutés). En pied de liste, « Ajouter un autre LLM » bascule sur la
 * conversation avec l'agent d'ajout. Les anciens boutons épars (« Connecter un
 * compte X », « Ajouter une clé X ») n'existent plus.
 *
 * L'agent d'ajout lit la documentation du fournisseur nommé, cherche la clé au
 * coffre (ou la demande), puis ÉPROUVE le moteur par un vrai tour avant de
 * l'activer. Un fournisseur qui n'imite ni Claude ni GPT, ou dont l'épreuve
 * échoue, repart en carte de développement dans « Planifié ». Ses questions
 * (`ask_user`) s'affichent et se répondent dans son tiroir, comme celles de
 * l'agent de mise en production (`tiroir-procedure-production.tsx`).
 */
export function AjouterUnMoteur() {
  const state = useApp();
  const [vue, setVue] = React.useState<'liste' | 'agent' | null>(null);
  const fiches = state.moteursAjoutes.filter((f) => f.statut !== 'retire');
  return (
    <div className="mt-3" data-ajout-de-moteur>
      {fiches.length ? (
        <div className="mb-1.5 space-y-1" data-moteurs-ajoutes>
          {fiches.map((fiche) => (
            <LigneMoteurAjoute key={fiche.id} fiche={fiche} />
          ))}
        </div>
      ) : null}
      <Button variant="outline" size="sm" onClick={() => setVue('liste')} data-ouvrir-ajout-de-moteur>
        <Plus className="h-3 w-3" />
        {t('Ajouter un LLM')}
      </Button>
      {vue === 'liste' ? <TiroirAjouterUnLLM onClose={() => setVue(null)} onAutre={() => setVue('agent')} /> : null}
      {vue === 'agent' ? <TiroirAjoutDeMoteur onClose={() => setVue(null)} onRetour={() => setVue('liste')} /> : null}
    </div>
  );
}

/**
 * LA LISTE DES MOTEURS CONNUS. Un compte n'entre dans les réglages qu'une fois
 * la connexion réussie (MEM-2561) : une tentative ratée ne laisse pas de ligne
 * morte. La connexion en cours, puis son résultat, se lisent sous le moteur
 * qui l'a lancée.
 */
function TiroirAjouterUnLLM({ onClose, onAutre }: { onClose: () => void; onAutre: () => void }) {
  const state = useApp();
  const [cleOuverte, setCleOuverte] = React.useState<EngineId | null>(null);
  const neuves = state.connexions.filter((c) => !c.accountId);
  const enCours = neuves.find((c) => !connexionTerminee(c));
  const derniere = neuves[neuves.length - 1];
  const parPage = moteursParPage();
  const parCle = moteursParCle();

  const nomDuMoteur = (engine: EngineId) => descriptionMoteur(engine)?.label ?? engine;

  return (
    <Drawer open onClose={onClose} plein={estTelephone()}>
      <div className="flex min-h-0 flex-1 flex-col" data-tiroir-ajouter-un-llm>
        <header className="flex shrink-0 items-center gap-2 px-4 pb-[13px]">
          <Cpu className="h-3.5 w-3.5 shrink-0 text-muted" />
          <DialogTitle className="min-w-0 flex-1 truncate">{t('Ajouter un LLM')}</DialogTitle>
          <Button variant="ghost" size="icon" className="shrink-0 text-muted" onClick={onClose} aria-label="Fermer" title={t('Fermer')}>
            <ChevronDown className="h-4 w-4" />
          </Button>
        </header>
        <ZoneDefilement className="min-h-0 flex-1 px-4 pb-4">
          <div className="space-y-1">
            {parPage.map((engine) => {
              const connexion = enCours?.engine === engine ? enCours : derniere?.engine === engine && connexionTerminee(derniere) ? derniere : null;
              return (
                <div key={engine} className="rounded-md bg-bloc" data-llm-connu={engine}>
                  <button
                    type="button"
                    disabled={Boolean(enCours)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left disabled:opacity-60"
                    onClick={() => void client.geste({ type: 'account.connect', engine }, t('Connexion d’un compte'))}
                  >
                    <IconeMoteur engine={engine} className="h-4 w-4 shrink-0 text-text" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] text-text">{nomDuMoteur(engine)}</span>
                      <span className="block text-[12px] text-faint">{t('Connexion par la page du compte')}</span>
                    </span>
                    {enCours?.engine === engine ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" /> : <LogIn className="h-3.5 w-3.5 text-muted" />}
                  </button>
                  {connexion ? (
                    <div className="px-3 pb-2">
                      <BlocConnexion connexion={connexion} />
                    </div>
                  ) : null}
                </div>
              );
            })}
            {parCle.map((engine) => (
              <div key={engine} className="rounded-md bg-bloc" data-llm-connu={engine}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left"
                  aria-expanded={cleOuverte === engine}
                  onClick={() => setCleOuverte((v) => (v === engine ? null : engine))}
                >
                  <IconeMoteur engine={engine} className="h-4 w-4 shrink-0 text-text" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] text-text">{nomDuMoteur(engine)}</span>
                    <span className="block text-[12px] text-faint">{t('Connexion par une clé d’accès')}</span>
                  </span>
                  <KeyRound className="h-3.5 w-3.5 text-muted" />
                </button>
                {cleOuverte === engine ? (
                  <div className="px-3 pb-2">
                    <AjouterCle engine={engine} deplie />
                  </div>
                ) : null}
              </div>
            ))}
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-bloc"
              onClick={onAutre}
              data-ajouter-autre-llm
            >
              <Sparkles className="h-4 w-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] text-text">{t('Ajouter un autre LLM')}</span>
                <span className="block text-[12px] text-faint">
                  {t('Un agent étudie le fournisseur que vous nommez et l’essaie pour de vrai avant de l’ajouter.')}
                </span>
              </span>
              <ChevronRight className="h-3.5 w-3.5 text-muted" />
            </button>
          </div>
        </ZoneDefilement>
      </div>
    </Drawer>
  );
}

/** Ce que l'écran dit de la compatibilité avec les agents, par motif. */
function phraseDeCompatibilite(motif: MotifDeCompatibilite): string {
  switch (motif) {
    case 'eprouve':
      return t('Compatible avec les agents : il lit et écrit des fichiers.');
    case 'format-inconnu':
      return t('Incompatible avec les agents : ce fournisseur ne parle aucun format que Beluga sait conduire.');
    case 'sans-outil':
      return t('Incompatible avec les agents : ce modèle n’a pas su utiliser un outil pour lire un fichier.');
    case 'cle-refusee':
      return t('Clé refusée : impossible de savoir s’il peut faire tourner des agents.');
    case 'sans-reponse':
      return t('Le fournisseur n’a pas répondu (surcharge ou délai) : relancez l’essai plus tard.');
    case 'inacheve':
      return t('L’essai n’est pas allé au bout : relancez-le.');
    default:
      return t('Pas encore essayé : on ne sait pas encore s’il peut faire tourner des agents.');
  }
}

/**
 * UN MOTEUR AJOUTÉ : son état en clair, sa compatibilité avec les agents, le
 * lien vers la carte de son ajout, et — tant qu'il n'est pas actif — un champ
 * de clé avec « Réessayer l'essai ». Actif, il se reconnecte comme les autres
 * moteurs à clé, par la ligne de son compte ; sans compte, le champ reste là.
 * Le retrait se confirme sur place.
 */
function LigneMoteurAjoute({ fiche }: { fiche: FicheMoteur }) {
  const state = useApp();
  const { id, label, statut } = fiche;
  const [confirme, setConfirme] = React.useState(false);
  const [envoi, setEnvoi] = React.useState(false);
  const [cleOuverte, setCleOuverte] = React.useState(false);
  const [cle, setCle] = React.useState('');
  const [essai, setEssai] = React.useState(false);
  const [issue, setIssue] = React.useState<{ ok: boolean; texte: string } | null>(null);
  const compat = compatibiliteAgents(fiche);
  const rate = statut === 'essai' && fiche.epreuve && !fiche.epreuve.ok;
  const aUnCompte = state.quotas.some((q) => q.engine === id);
  const cleAttendue = statut === 'essai' || (statut === 'actif' && !aUnCompte);

  const retirer = async () => {
    setEnvoi(true);
    try {
      const rendu = await client.call<{ ok: boolean; erreur?: string; texte?: string }>({ type: 'moteurs.retirer', id });
      if (!rendu.ok) client.pushToast('error', rendu.erreur ?? t('retrait impossible'));
      else {
        client.pushToast('success', rendu.texte ?? t('moteur retiré'));
        setConfirme(false);
      }
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('retrait impossible'));
    } finally {
      setEnvoi(false);
    }
  };

  // Trois temps : chargement (le bouton le dit dès le clic), résultat, ligne à jour (diffusion des fiches).
  const eprouver = async () => {
    setEssai(true);
    setIssue(null);
    try {
      // Un essai dure jusqu'à trois minutes : un vrai tour dans un dossier jetable.
      const rendu = await client.call<{ ok: boolean; resume: string }>({ type: 'moteurs.eprouver', id, ...(cle.trim() ? { cle: cle.trim() } : {}) }, 240_000);
      setIssue({ ok: rendu.ok, texte: rendu.resume });
      if (rendu.ok) {
        setCle('');
        setCleOuverte(false);
      }
    } catch (err: any) {
      setIssue({ ok: false, texte: err?.message ?? t('essai impossible') });
    } finally {
      setEssai(false);
    }
  };

  const ouvrirLaCarte = () => {
    if (!fiche.carteId) return;
    const projectId = state.cards[fiche.carteId]?.projectId ?? state.projects.find((p) => p.isSelf)?.id;
    client.allerVersDecision({ projectId, cardId: fiche.carteId });
  };

  return (
    <div className="rounded-md border border-border bg-bloc px-2 py-1.5" data-moteur-ajoute={id} data-statut={statut} data-compatibilite={compat.etat}>
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Le logo de la marque quand on le connaît (Gemini), l'icône neutre sinon. */}
        <IconeMoteur engine={id as EngineId} className="h-3.5 w-3.5" />
        <p className="min-w-0 flex-1 truncate text-[13.5px] text-text" data-nom-compte={id}>{label}</p>
        {statut === 'actif' ? (
          <Badge tone="success">{t('actif')}</Badge>
        ) : rate ? (
          <Badge tone="danger">{t('essai raté')}</Badge>
        ) : (
          <Badge tone="warning">{t('en essai')}</Badge>
        )}
        {fiche.carteId ? (
          <Button variant="ghost" size="sm" onClick={ouvrirLaCarte} title={t('Voir la carte de cet ajout')} data-carte-du-moteur={fiche.carteId}>
            <ExternalLink className="h-3 w-3" />
            {t('Carte')}
          </Button>
        ) : null}
        {cleAttendue ? (
          <Button variant="ghost" size="sm" onClick={() => setCleOuverte((v) => !v)} aria-expanded={cleOuverte} data-cle-du-moteur={id}>
            <KeyRound className="h-3 w-3" />
            {statut === 'actif' ? t('Ajouter une clé') : t('Clé et essai')}
          </Button>
        ) : null}
        <Button variant="ghost" size="icon-sm" onClick={() => setConfirme((v) => !v)} aria-label="Retirer ce moteur" title={t('Retirer ce moteur')} data-retirer-moteur={id}>
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
      <p
        className={cn('mt-0.5 text-[12px] leading-snug', compat.etat === 'non' ? 'text-danger' : compat.etat === 'oui' ? 'text-muted' : 'text-faint')}
        data-compatibilite-agents={compat.motif}
      >
        {phraseDeCompatibilite(compat.motif)}
      </p>
      {rate && fiche.epreuve ? (
        <p className="mt-0.5 select-text text-[11.5px] leading-relaxed text-faint" data-raison-essai>
          {fiche.epreuve.resume}
        </p>
      ) : null}
      {cleOuverte && cleAttendue ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1" data-essai-du-moteur={id}>
          <input
            type="password"
            autoComplete="off"
            value={cle}
            onChange={(e) => setCle(e.target.value)}
            placeholder={t('Clé d’accès (laisser vide pour reprendre celle déjà connue)')}
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-raised px-2 text-[12.5px] text-text"
            data-champ-cle-moteur
          />
          <Button size="sm" disabled={essai} onClick={eprouver} data-reessayer-essai>
            {essai ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />}
            {essai ? t('Essai en cours…') : statut === 'actif' ? t('Reconnecter') : t('Réessayer l’essai')}
          </Button>
        </div>
      ) : null}
      {issue ? (
        <p className={cn('mt-1 select-text text-[11.5px] leading-relaxed', issue.ok ? 'text-success' : 'text-danger')} data-issue-essai={issue.ok ? 'ok' : 'rate'}>
          {issue.texte}
        </p>
      ) : null}
      {confirme ? (
        <div className="mt-1.5 rounded-md border border-danger bg-raised px-2 py-1.5">
          <p className="text-[11.5px] leading-relaxed text-faint">
            {t('Retirer « {v0} » retire aussi ses comptes. Les cartes qui l’utilisaient passent sur Claude.', { v0: label })}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Button size="sm" variant="danger" disabled={envoi} onClick={retirer} data-confirmer-retrait-moteur>
              {envoi ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              {t('Retirer')}
            </Button>
            <Button size="sm" variant="ghost" disabled={envoi} onClick={() => setConfirme(false)}>
              {t('Annuler')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * LE TIROIR : la conversation avec l'agent « Ajouter un moteur ». L'agent est
 * gardé par le serveur d'une ouverture à l'autre ; « Autre moteur » repart
 * d'un agent vierge. Rien ne part au moteur avant le premier message écrit —
 * c'est lui qui pose la CARTE de l'ajout sur le tableau (projet Beluga Build),
 * qui reprend cette conversation et suit l'état de la demande ; « Autre
 * moteur » en ouvre une neuve, l'ancienne reste.
 */
function TiroirAjoutDeMoteur({ onClose, onRetour }: { onClose: () => void; onRetour: () => void }) {
  const state = useApp();
  const [agentId, setAgentId] = React.useState<string | null>(null);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [chargement, setChargement] = React.useState(false);

  const ouvrir = React.useCallback((neuf: boolean) => {
    setErreur(null);
    setChargement(true);
    void client
      .call<{ agent: Agent }>({ type: 'moteurs.agent', neuf })
      .then(async (res) => {
        if (!state.agents[res.agent.id]) await client.chargerAgent(res.agent.id);
        setAgentId(res.agent.id);
      })
      .catch((err: unknown) => setErreur(err instanceof Error ? err.message : String(err)))
      .finally(() => setChargement(false));
    // `state.agents` n'est lu qu'à la réponse : l'ouverture ne se rejoue pas à chaque message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    ouvrir(false);
  }, [ouvrir]);

  const agent = agentId ? (state.agents[agentId] ?? null) : null;
  const vide = agent ? (state.messages[agent.id]?.length ?? 0) === 0 : true;
  const attente = agentId ? decisionsQuiAlertent(state.decisions).filter((d) => d.agentId === agentId).length : 0;

  return (
    <Drawer open onClose={onClose} plein={estTelephone()} hauteurFixe>
      <div className="flex min-h-0 flex-1 flex-col" data-tiroir-ajout-de-moteur={agentId ?? ''}>
        <header className="flex shrink-0 items-center gap-2 px-4 pb-[13px]">
          <Button variant="ghost" size="icon-sm" className="shrink-0 text-muted" onClick={onRetour} aria-label="Retour" title={t('Retour à la liste')} data-retour-liste-llm>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <DialogTitle className="min-w-0 flex-1 truncate">{t('Ajouter un autre LLM')}</DialogTitle>
          <RepereAttention compte={attente} />
          {agent?.cardId ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => client.allerVersDecision({ projectId: agent.projectId, cardId: agent.cardId })}
              title={t('Voir la carte de cet ajout')}
              data-carte-de-l-ajout={agent.cardId}
            >
              <ExternalLink className="h-3 w-3" />
              {t('Carte')}
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" disabled={chargement || !agent} onClick={() => ouvrir(true)} data-autre-moteur>
            <RotateCw className="h-3 w-3" />
            {t('Autre moteur')}
          </Button>
          <Button variant="ghost" size="icon" className="shrink-0 text-muted" onClick={onClose} aria-label="Fermer" title={t('Fermer')}>
            <ChevronDown className="h-4 w-4" />
          </Button>
        </header>
        {erreur ? (
          <div className="flex flex-col items-start gap-2 px-4 py-3">
            <p className="text-[13px] leading-snug text-danger">{erreur}</p>
            <Button size="sm" variant="outline" onClick={() => ouvrir(false)}>
              <RotateCw className="h-3 w-3" /> {t('Réessayer')}
            </Button>
          </div>
        ) : !agent ? (
          <SilhouetteConversation bulles={2} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col" data-conversation-ajout-de-moteur={agent.id}>
            {vide ? (
              <p className="px-4 pt-1 text-[13px] leading-snug text-muted" data-accueil-ajout-de-moteur>
                {t('Quel moteur voulez-vous ajouter ? Écrivez son nom — par exemple DeepSeek, Mistral ou Kimi. L’agent étudie son fonctionnement, l’essaie pour de vrai, puis l’ajoute à vos comptes.')}
              </p>
            ) : null}
            <Chat agent={agent} projectId={agent.projectId} libelleDuChamp={t('Écrire à l’agent d’ajout de moteur')} />
          </div>
        )}
      </div>
    </Drawer>
  );
}
