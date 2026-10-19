import * as React from 'react';
import { AtSign, CheckCircle2, Circle, Copy, ExternalLink, KeyRound, Link2, Plus, RotateCw, Send, Sparkles, Trash2 } from 'lucide-react';
import {
  type ApplicationDeveloppeur,
  type Card,
  type CibleSociale,
  type CompteSocial,
  type ContenuMarketing,
  type EtatCible,
  type MessageSocial,
  type ReseauSocial,
  FICHES_RESEAUX,
  RESEAUX_SOCIAUX,
  ciblesAEnvoyer,
  demandeDePropositionDeReponse,
  raisonMediaManquant,
  raisonReliureImpossible,
} from '@beluga/shared';
import { Badge, Button, ChampMotDePasse, ConfirmDialog, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Textarea } from '@/components/ui';
import { client } from '@/lib/client';
import { formatRegional, t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import { copier } from '@/components/graphiques-statistiques';
import { CorpsOnglet, PointInfo } from '@/components/marketing';

/**
 * LA PUBLICATION OFFICIELLE DANS L'ATELIER — les onglets « Comptes » et
 * « Messages », et le bloc « Où publier » de la fiche d'un contenu
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
export function libelleReseau(reseau: ReseauSocial): string {
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

export function OngletComptes({ projectId, reseaux, cartes = [], onOuvrirCarte }: { projectId: string; reseaux: VueDesReseaux | undefined; cartes?: Card[]; onOuvrirCarte?: (card: Card) => void }) {
  const [aRetirer, setARetirer] = React.useState<CompteSocial | null>(null);
  const [identifiants, setIdentifiants] = React.useState<ReseauSocial | null>(null);
  if (!reseaux) return null;

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
    try {
      const r = await client.call<{ cardId: string }>({ type: 'marketing.compte.creer', projectId, reseau });
      client.pushToast('success', t('L’agent est lancé : il vous posera ses questions ici.'));
      const carte = cartes.find((c) => c.id === r.cardId);
      if (carte) onOuvrirCarte?.(carte);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('L’agent n’a pas pu partir'));
      throw err;
    }
  };

  return (
    <CorpsOnglet>
      <div className="flex flex-col gap-4" data-marketing-comptes={reseaux.comptes.length}>
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
          {RESEAUX_SOCIAUX.map((reseau) => {
            const fiche = FICHES_RESEAUX[reseau];
            const app = reseaux.applications.find((a) => a.application === fiche.application);
            const comptes = reseaux.comptes.filter((c) => c.reseau === reseau);
            const peutRelier = !raisonReliureImpossible(app);
            const carteAgent = app?.cardId ? cartes.find((c) => c.id === app.cardId) : undefined;
            return (
              <li key={reseau} className="flex flex-col gap-2 rounded-md bg-bloc px-3 py-2.5" data-marketing-reseau={reseau} data-application={app?.etat ?? 'absente'} data-comptes={comptes.length}>
                <div className="flex items-start gap-2.5">
                  <AtSign className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[13.5px] font-medium text-text">{libelleReseau(reseau)}</span>
                    <span className="text-[12px] text-faint">{capacites(reseau)}</span>
                  </div>
                  <Button size="icon" variant="ghost" aria-label="Identifiants de l’application" title={t('Identifiants de l’application')} onClick={() => setIdentifiants(reseau)} data-marketing-identifiants={reseau}>
                    <KeyRound className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                  {carteAgent && onOuvrirCarte ? (
                    <button type="button" className="underline-offset-2 hover:underline" onClick={() => onOuvrirCarte(carteAgent)} data-marketing-agent-creation={reseau}>
                      {libelleEtatApplication(app)}
                    </button>
                  ) : (
                    <span>{libelleEtatApplication(app)}</span>
                  )}
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
                  {!comptes.length ? (
                    <Button size="sm" variant="ghost" onClick={() => creer(reseau)} data-marketing-creer-compte={reseau}>
                      <Plus className="h-3.5 w-3.5" />
                      {t('Créer')}
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
    </CorpsOnglet>
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

export function OngletMessages({ projectId, version, comptes }: { projectId: string; version: number; comptes: CompteSocial[] }) {
  const [messages, setMessages] = React.useState<MessageSocial[] | null>(null);
  const [tous, setTous] = React.useState(false);
  const [ouvert, setOuvert] = React.useState<string | null>(null);

  React.useEffect(() => {
    let vivant = true;
    client
      .call<{ messages: MessageSocial[] }>({ type: 'marketing.messages', projectId })
      .then((r) => vivant && setMessages(r.messages))
      .catch(() => vivant && setMessages([]));
    return () => {
      vivant = false;
    };
  }, [projectId, version]);

  const relever = async () => {
    try {
      const r = await client.call<{ nouveaux: number }>({ type: 'marketing.messages.relever', projectId });
      client.pushToast('success', r.nouveaux ? t('{n} nouveau(x) message(s)', { n: r.nouveaux }) : t('Rien de nouveau'));
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Relève impossible'));
      throw err;
    }
  };

  const ouvrir = (m: MessageSocial) => {
    setOuvert((o) => (o === m.id ? null : m.id));
    if (!m.lu && !m.sortant) void client.call({ type: 'marketing.messages.lus', projectId, ids: [m.id] }).catch(() => {});
  };

  const liste = (messages ?? []).filter((m) => tous || (!m.lu && !m.sortant) || m.id === ouvert);
  const nomDuCompte = (id: string) => comptes.find((c) => c.id === id)?.nom ?? '';
  const ouvrables = comptes.some((c) => FICHES_RESEAUX[c.reseau].commentaires || FICHES_RESEAUX[c.reseau].messages);

  return (
    <CorpsOnglet>
      <div className="flex flex-col gap-3" data-marketing-messages={messages?.length ?? -1}>
        <div className="flex items-center gap-1.5">
          <div className="flex flex-1 items-center gap-1">
            <Button size="sm" variant={!tous ? 'default' : 'ghost'} onClick={() => setTous(false)} data-marketing-filtre-messages="non-lus">
              {t('Non lus')}
            </Button>
            <Button size="sm" variant={tous ? 'default' : 'ghost'} onClick={() => setTous(true)} data-marketing-filtre-messages="tous">
              {t('Tous')}
            </Button>
          </div>
          <Button size="icon" variant="ghost" aria-label="Relever maintenant" title={t('Relever maintenant')} disabled={!ouvrables} onClick={relever} data-marketing-relever>
            <RotateCw className="h-3.5 w-3.5" />
          </Button>
          <PointInfo titre={t('Les messages')}>
            <p>{t('Les commentaires de vos publications et les messages privés de vos comptes reliés arrivent ici, relevés toutes les dix minutes.')}</p>
            <p>{t('Vous répondez d’ici : la réponse part sur le réseau quand vous touchez « Envoyer ». L’agent peut vous proposer un texte, il ne l’envoie jamais.')}</p>
            <p>{t('Sur Facebook et Instagram, un message privé ne peut plus recevoir de réponse 24 heures après le dernier message reçu.')}</p>
          </PointInfo>
        </div>
        {messages === null ? null : !comptes.length ? (
          <p className="rounded-md bg-bloc px-3 py-2.5 text-[12.5px] text-muted">{t('Reliez d’abord un compte dans l’onglet Comptes.')}</p>
        ) : !liste.length ? (
          <p className="rounded-md bg-bloc px-3 py-2.5 text-[12.5px] text-muted" data-marketing-messages-vide>
            {tous ? t('Aucun commentaire ni message pour l’instant.') : t('Tout est lu.')}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {liste.map((m) => (
              <LigneMessage key={m.id} message={m} nomDuCompte={nomDuCompte(m.compteId)} ouvert={ouvert === m.id} onOuvrir={() => ouvrir(m)} projectId={projectId} />
            ))}
          </ul>
        )}
      </div>
    </CorpsOnglet>
  );
}

function LigneMessage({ message: m, nomDuCompte, ouvert, onOuvrir, projectId }: { message: MessageSocial; nomDuCompte: string; ouvert: boolean; onOuvrir: () => void; projectId: string }) {
  const [texte, setTexte] = React.useState(m.brouillon ?? '');
  React.useEffect(() => setTexte(m.brouillon ?? ''), [m.id, m.brouillon]);
  const nonLu = !m.lu && !m.sortant;
  const envoyer = async () => {
    try {
      await client.call({ type: 'marketing.message.repondre', id: m.id, texte });
      setTexte('');
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Réponse refusée'));
      throw err;
    }
  };
  const proposer = async () => {
    try {
      await client.call({
        type: 'marketing.assistant',
        projectId,
        demande: demandeDePropositionDeReponse(m),
      });
      client.pushToast('success', t('L’agent prépare une proposition : elle paraîtra sous le message.'));
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('L’agent n’a pas pu partir'));
      throw err;
    }
  };
  return (
    <li className={cn('flex flex-col rounded-md', m.sortant ? 'bg-surface' : 'bg-bloc')} data-marketing-message={m.id} data-genre={m.genre} data-lu={m.lu ? 'oui' : 'non'}>
      <button type="button" onClick={onOuvrir} className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-raised">
        <span className="flex items-center gap-1.5 text-[12px] text-faint">
          {nonLu ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden /> : null}
          <span className="min-w-0 truncate">
            {libelleReseau(m.reseau)} · {m.genre === 'commentaire' ? (m.reseau === 'google-business' ? t('Avis') : t('Commentaire')) : t('Message privé')}
            {nomDuCompte ? ` · ${nomDuCompte}` : ''}
          </span>
          <span className="ml-auto shrink-0">{new Date(m.instant).toLocaleString(formatRegional(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
        </span>
        <span className={cn('text-[13px] text-text', !ouvert && 'line-clamp-2')}>
          <span className="font-medium">{m.sortant ? t('Vous') : m.auteur || t('Anonyme')}</span> {m.texte}
        </span>
      </button>
      {ouvert ? (
        <div className="flex flex-col gap-1.5 px-3 pb-2.5">
          {m.url ? (
            <a href={m.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 self-start text-[12px] text-muted hover:text-text">
              <ExternalLink className="h-3 w-3" />
              {t('Voir sur le réseau')}
            </a>
          ) : null}
          {!m.sortant ? (
            <>
              <Textarea rows={3} value={texte} onChange={(e) => setTexte(e.target.value)} placeholder={t('Votre réponse…')} className="text-[13px]" data-marketing-reponse={m.id} />
              <div className="flex flex-wrap items-center gap-1.5">
                <Button size="sm" disabled={!texte.trim()} onClick={envoyer} data-marketing-envoyer={m.id}>
                  <Send className="h-3.5 w-3.5" />
                  {t('Envoyer')}
                </Button>
                <Button size="sm" variant="ghost" onClick={proposer} data-marketing-proposer={m.id}>
                  <Sparkles className="h-3.5 w-3.5" />
                  {t('Demander une proposition à l’agent')}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* « Où publier » dans la fiche d'un contenu                            */
/* ------------------------------------------------------------------ */

function libelleEtatCible(etat: EtatCible): string {
  return etat === 'publie' ? t('Publié') : etat === 'echec' ? t('En échec') : etat === 'en_cours' ? t('En cours d’envoi') : t('En attente');
}

export function OuPublier({ contenu, comptes, media }: { contenu: ContenuMarketing; comptes: CompteSocial[]; media: { image: boolean; video: boolean } }) {
  const cibles: CibleSociale[] = contenu.cibles ?? [];
  const publie = contenu.etape === 'publie';
  const coches = new Set(cibles.map((c) => c.compteId));

  const basculer = async (compteId: string) => {
    const suivants = coches.has(compteId) ? [...coches].filter((id) => id !== compteId) : [...coches, compteId];
    try {
      await client.call({ type: 'marketing.contenu.cibles', id: contenu.id, comptes: suivants });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Compte non modifié'));
      throw err;
    }
  };

  const publier = async () => {
    try {
      const r = await client.call<{ bilan: string }>({ type: 'marketing.contenu.publier', id: contenu.id });
      client.pushToast(r.bilan === 'publie' ? 'success' : 'error', r.bilan === 'publie' ? t('Publié sur tous les comptes') : t('Une partie n’est pas partie : voyez la raison sous chaque compte.'));
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Publication impossible'));
      throw err;
    }
  };

  const reste = ciblesAEnvoyer(cibles).length;
  const peutPublier = !publie && reste > 0 && ['pret', 'programme', 'echec'].includes(contenu.etape);
  const manques = [...new Set(cibles.filter((c) => c.etat !== 'publie').map((c) => raisonMediaManquant(c.reseau, media)).filter((r): r is string => !!r))];

  return (
    <div className="flex flex-col gap-1.5" data-marketing-ou-publier={cibles.length}>
      <span className="text-[12px] text-muted">{t('Où publier')}</span>
      {!comptes.length && !cibles.length ? (
        <p className="rounded-md bg-bloc px-3 py-2 text-[12.5px] text-muted">{t('Reliez un compte dans l’onglet Comptes pour publier d’ici.')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {comptes.map((compte) => {
            const cible = cibles.find((c) => c.compteId === compte.id);
            const verrou = publie || cible?.etat === 'publie' || cible?.etat === 'en_cours';
            return (
              <li key={compte.id} className="flex flex-col rounded-md bg-bloc" data-marketing-cible={compte.id} data-etat={cible?.etat ?? 'non'}>
                <button type="button" disabled={verrou} onClick={() => basculer(compte.id)} className="flex min-h-[40px] w-full items-center gap-2 px-3 py-1.5 text-left enabled:hover:bg-raised disabled:cursor-default">
                  {cible ? <CheckCircle2 className="h-4 w-4 shrink-0 text-termine" /> : <Circle className="h-4 w-4 shrink-0 text-faint" />}
                  <span className="min-w-0 flex-1 truncate text-[13px] text-text">
                    {libelleReseau(compte.reseau)} · {compte.nom}
                  </span>
                  {cible ? <Badge tone={cible.etat === 'publie' ? 'success' : cible.etat === 'echec' ? 'danger' : 'neutral'}>{libelleEtatCible(cible.etat)}</Badge> : null}
                </button>
                {cible?.etat === 'publie' && cible.url ? (
                  <a href={cible.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 px-3 pb-1.5 text-[12px] text-muted hover:text-text">
                    <ExternalLink className="h-3 w-3" />
                    {t('Voir la publication')}
                  </a>
                ) : cible?.etat === 'echec' && cible.raison ? (
                  <p className="px-3 pb-1.5 text-[12px] text-danger">{cible.raison}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {manques.length ? <p className="text-[12px] text-muted">{manques.map((m) => t(m)).join(' ')}</p> : null}
      {cibles.length && !publie ? (
        <p className="text-[12px] text-faint">
          {contenu.etape === 'programme' && contenu.datePrevue
            ? t('Il partira tout seul le {v0} à {v1}.', { v0: contenu.datePrevue, v1: contenu.heurePrevue || '09:00' })
            : t('Programmez-le pour qu’il parte tout seul, ou publiez-le maintenant.')}
        </p>
      ) : null}
      {peutPublier ? (
        <Button size="sm" className="self-start" onClick={publier} data-marketing-publier-maintenant>
          <Send className="h-3.5 w-3.5" />
          {contenu.etape === 'echec' ? t('Relancer les échecs') : t('Publier maintenant')}
        </Button>
      ) : null}
    </div>
  );
}
