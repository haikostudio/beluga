import { LogoReseau } from '@/components/logos-reseaux';
import * as React from 'react';
import { CheckCircle2, ChevronRight, Circle, Loader2, MessageCircleQuestion, Copy, KeyRound, Link2, Plus, Trash2 } from '@/components/ui/icones';
import {
  type Agent,
  type ApplicationDeveloppeur,
  type Card,
  type CompteSocial,
  type ReseauSocial,
  FICHES_RESEAUX,
  RESEAUX_SOCIAUX,
  agentTientSonTour,
  raisonReliureImpossible,
} from '@beluga/shared';
import { Badge, Button, ChampMotDePasse, ConfirmDialog, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, } from '@/components/ui';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import { copier } from '@/components/graphiques-statistiques';
import { PastillePertinence, PointInfo, etatDeCarte } from './canaux-avances';
import { useApp } from '@/lib/use-app';

/**
 * LA PUBLICATION OFFICIELLE DANS L'ATELIER — les comptes (en tête de la
 * rubrique « Canaux »), l'onglet « Messages », et le bloc « Où publier » de la fiche d'un contenu
 * (`shared/src/reseaux-sociaux.ts`, `server/src/publication-sociale.ts`).
 *
 *  - COMPTES : un réseau par ligne. « Relier » ouvre le réseau dans un nouvel
 *    onglet (l'accord se donne chez lui, puis l'onglet se referme) ; « Créer »
 *    lance un agent qui ouvre le compte et fait valider l'accès officiel.
 *  - MESSAGES : commentaires et messages privés de tous les comptes, non lus
 *    d'abord. Une réponse ne part que par « Envoyer » ; l'agent peut seulement
 *    en proposer le texte.
 *  - OÙ PUBLIER : les comptes cochés d'un contenu, chacun avec son état. Un
 *    compte déjà publié ne se décoche plus et ne repart jamais.
 */

export interface VueDesReseaux {
  comptes: CompteSocial[];
  applications: ApplicationDeveloppeur[];
  adresseRetour: string;
  messagesNonLus: number;
}

/** Le nom affiché d'un réseau : un nom propre, sauf la fiche Google qui se traduit. */
function libelleReseau(reseau: ReseauSocial): string {
  return reseau === 'google-business' ? t(FICHES_RESEAUX[reseau].libelle) : FICHES_RESEAUX[reseau].libelle;
}

function libelleEtatApplication(app: ApplicationDeveloppeur | undefined): string {
  switch (app?.etat) {
    case 'en_creation':
      return t('Un agent ouvre l’accès officiel');
    case 'en_validation':
      return t('En validation chez le réseau');
    case 'validee':
      return t('Accès officiel validé');
    default:
      return t('Pas encore d’accès officiel');
  }
}

function libelleEtatCompte(c: CompteSocial): string {
  return c.etat === 'relie' ? t('Relié') : c.etat === 'a_relier' ? t('À relier') : t('En erreur');
}

function capacites(reseau: ReseauSocial): string {
  const f = FICHES_RESEAUX[reseau];
  return [t('Publication'), f.commentaires ? (reseau === 'google-business' ? t('Avis') : t('Commentaires')) : null, f.messages ? t('Messages privés') : null].filter(Boolean).join(' · ');
}

/* ------------------------------------------------------------------ */
/* L'onglet « Comptes »                                                 */
/* ------------------------------------------------------------------ */

/** Ce que la rubrique Canaux dit d'un réseau : choisi ou non, et l'avis de l'agent. */
interface CanalDuReseau {
  choisi: boolean;
  pertinence?: string;
}

/**
 * LES COMPTES, EN TÊTE DE LA RUBRIQUE « CANAUX » (demande du 20/10/2026 :
 * l'onglet Comptes a fusionné dans Canaux, sous ce nom). Un réseau par ligne,
 * ceux qui ont un compte RELIÉ d'abord ; le nom du réseau ouvre la fiche de
 * son canal (avis de l'agent, parcours), qui n'est donc plus redite plus bas.
 */
export function OngletComptes({
  projectId,
  reseaux,
  cartes = [],
  onOuvrirCarte,
  canaux,
  onOuvrirCanal,
}: {
  projectId: string;
  reseaux: VueDesReseaux | undefined;
  cartes?: Card[];
  onOuvrirCarte?: (card: Card) => void;
  /** L'état de chaque canal-réseau, pour la coche et l'avis posés sur sa ligne. */
  canaux?: Partial<Record<ReseauSocial, CanalDuReseau>>;
  onOuvrirCanal?: (reseau: ReseauSocial) => void;
}) {
  const [aRetirer, setARetirer] = React.useState<CompteSocial | null>(null);
  const [identifiants, setIdentifiants] = React.useState<ReseauSocial | null>(null);
  /* « CRÉER » LE DIT DÈS LE CLIC : « Lancement… » pendant l'appel, puis la
     carte rendue par le démon, avant même que l'espace relu ne la porte. */
  const [lancement, setLancement] = React.useState<ReseauSocial | null>(null);
  const [lancees, setLancees] = React.useState<Partial<Record<ReseauSocial, string>>>({});
  const state = useApp();
  /** La carte de création est-elle finie (ni planifiée, ni en cours, ni son agent au travail) ? Inconnue : pas encore. */
  const creationFinie = (cardId: string) => {
    const carte = cartes.find((c) => c.id === cardId) ?? state.cards[cardId];
    if (!carte) return false;
    const agent = agentDeLaCarte(carte, state.agents);
    return !agent?.attendReponse && !(agent && agentTientSonTour(agent)) && carte.column !== 'running' && carte.column !== 'planned';
  };
  if (!reseaux) return null;
  const rang = (reseau: ReseauSocial) => {
    const siens = reseaux.comptes.filter((c) => c.reseau === reseau);
    return siens.some((c) => c.etat === 'relie') ? 0 : siens.length ? 1 : canaux?.[reseau]?.choisi ? 2 : 3;
  };
  const ordre = [...RESEAUX_SOCIAUX].sort((a, b) => rang(a) - rang(b));

  const relier = async (reseau: ReseauSocial) => {
    // L'onglet s'ouvre DANS le clic (sinon le navigateur le bloque), puis reçoit l'adresse du réseau.
    const fenetre = window.open('about:blank', '_blank');
    try {
      const r = await client.call<{ url: string }>({ type: 'marketing.compte.relier', projectId, reseau });
      if (fenetre) fenetre.location.href = r.url;
      else window.location.href = r.url;
    } catch (err: any) {
      fenetre?.close();
      client.pushToast('error', err?.message ?? t('Connexion impossible'));
      throw err;
    }
  };

  const creer = async (reseau: ReseauSocial) => {
    setLancement(reseau);
    try {
      const r = await client.call<{ cardId: string }>({ type: 'marketing.compte.creer', projectId, reseau });
      setLancees((avant) => ({ ...avant, [reseau]: r.cardId }));
      client.pushToast('success', t('L’agent est lancé : il vous posera ses questions ici.'));
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('L’agent n’a pas pu partir'));
    } finally {
      setLancement(null);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-3" data-marketing-comptes={reseaux.comptes.length}>
        <div className="flex items-center gap-2">
          <span className="flex-1 text-[13px] text-muted">{t('Reliez les comptes de ce projet : l’atelier y publie lui-même, à l’heure prévue.')}</span>
          <PointInfo titre={t('Les comptes')}>
            <p>{t('L’atelier publie par l’accès officiel de chaque réseau. Il faut d’abord une application chez le réseau, puis relier chaque compte du projet.')}</p>
            <p>{t('« Créer » lance un agent : il ouvre le compte s’il n’existe pas, crée l’application, remplit les dossiers de validation et vous demande les codes reçus par SMS.')}</p>
            <p>{t('Tant que le réseau n’a pas validé l’application, seuls les comptes dont vous êtes administrateur peuvent être reliés. Les autres réseaux continuent de fonctionner.')}</p>
            <p>{t('Adresse de retour à déclarer dans chaque application :')}</p>
            <button type="button" onClick={() => void copier(reseaux.adresseRetour, t('Adresse de retour'))} className="flex items-center gap-2 rounded-md bg-bloc px-2.5 py-2 text-left text-[12.5px] hover:bg-raised" data-marketing-adresse-retour>
              <Copy className="h-3.5 w-3.5 shrink-0 text-muted" />
              <span className="min-w-0 break-all">{reseaux.adresseRetour}</span>
            </button>
          </PointInfo>
        </div>
        <ul className="flex flex-col gap-2">
          {ordre.map((reseau) => {
            const fiche = FICHES_RESEAUX[reseau];
            const app = reseaux.applications.find((a) => a.application === fiche.application);
            const comptes = reseaux.comptes.filter((c) => c.reseau === reseau);
            const peutRelier = !raisonReliureImpossible(app);
            const carteDeCreation = lancees[reseau] ?? app?.cardId;
            return (
              <li key={reseau} className="flex flex-col gap-2 rounded-md bg-bloc px-3 py-2.5" data-marketing-reseau={reseau} data-application={app?.etat ?? 'absente'} data-comptes={comptes.length}>
                <div className="flex items-start gap-2.5">
                  <LogoReseau reseau={reseau} className="mt-0.5 h-5 w-5" />
                  {onOuvrirCanal ? (
                    <button type="button" onClick={() => onOuvrirCanal(reseau)} className="flex min-w-0 flex-1 flex-col text-left" data-marketing-canal={reseau} data-choisi={canaux?.[reseau]?.choisi ? 'oui' : 'non'}>
                      <span className="flex min-w-0 items-center gap-1.5 text-[13.5px] font-medium text-text">
                        <span className="min-w-0 truncate">{libelleReseau(reseau)}</span>
                        {canaux?.[reseau]?.choisi ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-termine" aria-label="Canal retenu" /> : null}
                        {canaux?.[reseau]?.pertinence ? <PastillePertinence pertinence={canaux[reseau]!.pertinence!} /> : null}
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint" />
                      </span>
                      <span className="text-[12px] text-faint">{capacites(reseau)}</span>
                    </button>
                  ) : (
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="text-[13.5px] font-medium text-text">{libelleReseau(reseau)}</span>
                      <span className="text-[12px] text-faint">{capacites(reseau)}</span>
                    </div>
                  )}
                  <Button size="icon" variant="ghost" aria-label="Identifiants de l’application" title={t('Identifiants de l’application')} onClick={() => setIdentifiants(reseau)} data-marketing-identifiants={reseau}>
                    <KeyRound className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                  <span>{libelleEtatApplication(app)}</span>
                  {app?.note ? <span className="text-faint">· {app.note}</span> : null}
                </div>
                <p className="text-[12px] leading-snug text-faint">{t(fiche.note)}</p>
                {comptes.length ? (
                  <ul className="flex flex-col gap-1">
                    {comptes.map((c) => (
                      <li key={c.id} className="flex items-center gap-2 rounded-md bg-surface px-2.5 py-1.5" data-marketing-compte={c.id} data-etat={c.etat}>
                        {c.avatar ? <img src={c.avatar} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" loading="lazy" /> : <Circle className="h-4 w-4 shrink-0 text-faint" />}
                        <span className="min-w-0 flex-1 truncate text-[13px] text-text" title={c.erreur ?? undefined}>
                          {c.nom}
                        </span>
                        <Badge tone={c.etat === 'relie' ? 'success' : c.etat === 'a_relier' ? 'warning' : 'danger'}>{libelleEtatCompte(c)}</Badge>
                        <Button size="icon" variant="ghost" aria-label="Retirer ce compte" title={t('Retirer ce compte')} onClick={() => setARetirer(c)} data-marketing-retirer-compte={c.id}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {comptes.some((c) => c.erreur) ? <p className="text-[12px] text-danger">{comptes.find((c) => c.erreur)!.erreur}</p> : null}
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button size="sm" variant={peutRelier ? 'default' : 'outline'} disabled={!peutRelier} title={raisonReliureImpossible(app) ? t(raisonReliureImpossible(app)!) : undefined} onClick={() => relier(reseau)} data-marketing-relier={reseau}>
                    <Link2 className="h-3.5 w-3.5" />
                    {comptes.length ? t('Relier un autre compte') : t('Relier')}
                  </Button>
                  {/* LE STATUT DE LA CARTE À LA PLACE DE « CRÉER » (demande du 20/10/2026) :
                      une fois lancée, la création se suit ici, et un clic ouvre sa carte. Finie
                      sans compte, « Créer » revient à côté pour la relancer. */}
                  {!comptes.length && carteDeCreation ? (
                    <StatutDeCreation reseau={reseau} cardId={carteDeCreation} cartes={cartes} onOuvrirCarte={onOuvrirCarte} />
                  ) : null}
                  {!comptes.length && (!carteDeCreation || creationFinie(carteDeCreation)) ? (
                    <Button size="sm" variant="ghost" disabled={lancement === reseau} onClick={() => void creer(reseau)} data-marketing-creer-compte={reseau}>
                      {lancement === reseau ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                      {lancement === reseau ? t('Lancement…') : t('Créer')}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      <ConfirmDialog
        open={!!aRetirer}
        title={t('Retirer ce compte ?')}
        description={aRetirer ? `${libelleReseau(aRetirer.reseau)} · ${aRetirer.nom}` : ''}
        confirmLabel={t('Retirer')}
        danger
        onConfirm={() => {
          const c = aRetirer;
          setARetirer(null);
          if (c) void client.call({ type: 'marketing.compte.retirer', projectId, id: c.id }).catch((err: any) => client.pushToast('error', err?.message ?? t('Compte non retiré')));
        }}
        onClose={() => setARetirer(null)}
      />
      <FenetreIdentifiants reseau={identifiants} application={identifiants ? reseaux.applications.find((a) => a.application === FICHES_RESEAUX[identifiants].application) : undefined} onClose={() => setIdentifiants(null)} />
    </>
  );
}

/** L'agent d'une carte : le sien, sinon celui qui tient son tour pour elle. */
function agentDeLaCarte(carte: Card, agents: Record<string, Agent>): Agent | undefined {
  return (carte.agentId ? agents[carte.agentId] : undefined) ?? Object.values(agents).find((a) => a.cardId === carte.id && agentTientSonTour(a));
}

/**
 * LE STATUT D'UNE CRÉATION DE COMPTE : le même témoin que sur le tableau
 * (`etatDeCarte`) — question en attente, l'agent travaille, en cours,
 * planifié, terminé —, et un clic ouvre la carte. Une carte rangée n'est plus
 * dans les cartes de l'atelier : elle est redemandée au démon, jamais
 * remplacée par un « Créer » trompeur.
 */
/**
 * `compact` : dans une colonne de tableau, l'état d'un agent au travail se dit « En cours » avec son rond qui tourne —
 * jamais une phrase coupée (« L'agent tra… », capture #b4a13 du 04/11/2026) ; la phrase entière reste dans l'infobulle.
 */
function StatutDeCreation({ reseau, cardId, cartes, onOuvrirCarte, compact }: { reseau: ReseauSocial; cardId: string; cartes: Card[]; onOuvrirCarte?: (card: Card) => void; compact?: boolean }) {
  const state = useApp();
  const carte = cartes.find((c) => c.id === cardId) ?? state.cards[cardId];
  const connue = !!carte;
  React.useEffect(() => {
    if (!connue) void client.chargerCarte(cardId);
  }, [cardId, connue]);
  if (!carte) {
    return (
      <span className="flex items-center gap-1.5 px-2 text-[12px] text-faint" data-marketing-statut-creation={reseau} data-etat="lecture">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t('Lancement…')}
      </span>
    );
  }
  const agent = agentDeLaCarte(carte, state.agents);
  const etat = etatDeCarte(carte, agent);
  const question = !!agent?.attendReponse;
  /* SANS `onOuvrirCarte`, UN STATUT QUI NE S'OUVRE PAS (Communication 2) : l'avancement se lit sur place, au-dessus
     du champ de la page ; rien ne mène plus à la conversation complète. */
  if (!onOuvrirCarte) {
    return (
      <span className={cn('inline-flex items-center gap-1.5 px-2 text-[12.5px] font-medium', etat.classe)} title={etat.libelle} data-marketing-statut-creation={reseau} data-etat={question ? 'question' : etat.tourne ? 'travail' : carte.column} data-compact={compact ? 'oui' : undefined}>
        {etat.tourne ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : question ? <MessageCircleQuestion className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
        <span className="whitespace-nowrap">{etat.tourne ? t('En cours') : question ? t('Question') : etat.libelle}</span>
      </span>
    );
  }
  return (
    <Button
      size="sm"
      variant="ghost"
      className={etat.classe}
      onClick={() => onOuvrirCarte?.(carte)}
      title={compact ? `${etat.libelle} — ${t('Ouvrir la tâche')}` : t('Ouvrir la tâche')}
      data-marketing-statut-creation={reseau}
      data-etat={question ? 'question' : etat.tourne ? 'travail' : carte.column}
      data-compact={compact ? 'oui' : undefined}
    >
      {etat.tourne ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : question ? <MessageCircleQuestion className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
      <span className={compact ? 'whitespace-nowrap' : undefined}>{compact && etat.tourne ? t('En cours') : compact && question ? t('Question') : etat.libelle}</span>
    </Button>
  );
}

/** Saisir à la main l'identifiant et le secret d'une application développeur (le secret part au coffre). */
function FenetreIdentifiants({ reseau, application, onClose }: { reseau: ReseauSocial | null; application?: ApplicationDeveloppeur; onClose: () => void }) {
  const [clientId, setClientId] = React.useState('');
  const [secret, setSecret] = React.useState('');
  const [validee, setValidee] = React.useState(false);
  React.useEffect(() => {
    setClientId(application?.clientId ?? '');
    setSecret('');
    setValidee(application?.etat === 'validee');
  }, [reseau, application?.majLe]);
  if (!reseau) return null;
  const enregistrer = async () => {
    try {
      await client.call({ type: 'marketing.application.ecrire', reseau, clientId: clientId.trim() || undefined, secret: secret.trim() || undefined, etat: validee ? 'validee' : clientId.trim() ? 'en_validation' : undefined });
      onClose();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Identifiants refusés'));
      throw err;
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-marketing-fenetre-identifiants={reseau}>
        <DialogHeader>
          <DialogTitle>{t('Application {v0}', { v0: libelleReseau(reseau) })}</DialogTitle>
          <DialogDescription>{t('L’identifiant et le secret donnés par le réseau. Le secret est rangé dans le coffre-fort.')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2.5 text-[12.5px]">
          <label className="flex flex-col gap-1 text-muted">
            {t('Identifiant de l’application')}
            <Input value={clientId} onChange={(e) => setClientId(e.target.value)} className="text-[13px]" data-marketing-client-id />
          </label>
          <label className="flex flex-col gap-1 text-muted">
            {application?.aUnSecret ? t('Nouveau secret (laisser vide pour garder l’actuel)') : t('Secret de l’application')}
            <ChampMotDePasse value={secret} onChange={(e) => setSecret(e.target.value)} className="text-[13px]" autoComplete="off" data-marketing-secret />
          </label>
          <button type="button" onClick={() => setValidee((v) => !v)} className="flex items-center gap-2 text-left text-text" data-marketing-validee={validee ? 'oui' : 'non'}>
            {validee ? <CheckCircle2 className="h-4 w-4 text-termine" /> : <Circle className="h-4 w-4 text-faint" />}
            {t('Le réseau a validé l’application')}
          </button>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('Annuler')}
          </Button>
          <Button onClick={enregistrer} data-marketing-enregistrer-identifiants>
            {t('Enregistrer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* L'onglet « Messages »                                                */
/* ------------------------------------------------------------------ */


/* ------------------------------------------------------------------ */
/* « Où publier » dans la fiche d'un contenu                            */
/* ------------------------------------------------------------------ */


