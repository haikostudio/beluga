import * as React from 'react';
import {
  Loader2,
  LogIn,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import {
  AccountQuota,
  ConnexionCompte,
  EngineId,
  EtatCompteCursor,
  moteurSansQuota,
  compteEpuise,
  DUREE_RESULTAT_CONNEXION_MS,
  phaseDeLigneCompte,
  usageCursorEnClair,
  tempsRestant,
  descriptionMoteur,
} from '@beluga/shared';
import {
  BulleInfo,
  Badge,
  Button,
  Input,
  Switch,
  Tooltip,
} from '@/components/ui';
import { BlocConnexion, RemplacerCle } from '@/components/connexion-compte';
import { UsageCursor } from '@/components/quota-badge';
import { AjouterUnMoteur } from '@/components/reglages/ajout-de-moteur';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';


export function SectionComptes() {
  const state = useApp();
  const settings = state.settings;
  const update = (patch: Record<string, unknown>) =>
    void client.geste({ type: 'settings.update', patch }, t('Enregistrement du réglage'));

  // Les connexions déjà en cours quand on ouvre les réglages : sans cette
  // demande, une connexion lancée depuis un autre écran serait invisible ici.
  React.useEffect(() => {
    client
      .call<{ connexions: ConnexionCompte[] }>({ type: 'account.connections' })
      .then((data) => client.reprendreConnexions(data.connexions ?? []))
      .catch(() => undefined);
  }, []);

  // La DERNIÈRE tentative du compte, finie comprise : son résultat doit rester
  // lisible sur la ligne quelques secondes (`phaseDeLigneCompte` en décide).
  const derniere = (accountId?: string) =>
    [...state.connexions].reverse().find((c) => c.accountId === accountId);

  return (
    <section>
      <div className="mb-2 flex items-center gap-1.5">
        <h3 className="flex items-center gap-1 flex-1 text-[13.5px] font-medium text-text">{t('Comptes et quotas')}<BulleInfo cote="start">{t('L\'ordre de priorité suit la valeur déclarée pour chaque compte : le compte prioritaire passe toujours en premier, la relève ne sert qu\'en cas d\'épuisement.')}</BulleInfo></h3>
        <Button variant="ghost" size="icon-sm" data-relire-quotas onClick={() => void client.geste({ type: 'quota.refresh' }, t('Relecture des quotas'))}>
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      <div className="space-y-1">
        {state.quotas.map((quota) => (
          <LigneCompte key={quota.id} quota={quota} connexion={derniere(quota.id)} />
        ))}
      </div>

      <AjouterUnMoteur />


      {/* Les réglages n'arrivent qu'avec la réponse du serveur : avant, il
          n'y a rien à cocher — et les lire trop tôt vidait la page. */}
      <label className={cn('mt-4 flex items-center gap-2 text-[14px] text-muted', !settings && 'hidden')}>
        <Switch
          checked={settings?.primeClaudeWindow ?? false}
          onCheckedChange={(checked) => update({ primeClaudeWindow: checked })}
        />
        
{t('Lancer la fenêtre de 5 h dès qu\'elle repart à zéro')}
  <BulleInfo cote="start">{t('Sur Claude, la fenêtre de cinq heures ne démarre qu\'au premier message. Beluga Build en envoie un minuscule dès qu\'un compte revient à zéro, pour que le décompte tourne déjà quand le travail arrive.')}</BulleInfo>
</label>
    </section>
  );
}

/**
 * Une ligne de compte dans l'onglet « Comptes » : son nom, ses quotas, ses
 * badges d'état, et le crayon qui ouvre un champ pour le RENOMMER. On ne touche
 * qu'au nom affiché ; un nom vide est refusé par le serveur et la ligne garde
 * son ancien nom.
 */
export function LigneCompte({ quota, connexion }: { quota: AccountQuota; connexion?: ConnexionCompte }) {
  const [edite, setEdite] = React.useState(false);
  const [nom, setNom] = React.useState(quota.label);
  const [envoi, setEnvoi] = React.useState(false);
  /*
   * DEUX GESTES QUI NE SE RATTRAPENT PAS SE CONFIRMENT SUR PLACE. Reconnecter
   * remplace la session du coffre, retirer fait disparaître le compte : la
   * confirmation s'ouvre DANS la fiche, sous les yeux, et elle NOMME le compte
   * visé — un compte de trop vite cliqué se corrigeait au terminal.
   */
  const [confirmation, setConfirmation] = React.useState<'reconnecter' | 'cle' | 'retirer' | null>(null);
  /* Un moteur À CLÉ se reconnecte en recevant une nouvelle clé, jamais par une page. */
  const parCle = descriptionMoteur(quota.engine)?.connexion === 'cle';
  const [retrait, setRetrait] = React.useState(false);
  /** La demande de reconnexion voyage : le bouton le dit, et rien ne se referme. */
  const [reconnexion, setReconnexion] = React.useState(false);
  /*
   * LA RECONNEXION SE LIT EN TROIS TEMPS : chargement dès que le code est parti,
   * résultat seul quelques secondes, puis la ligne habituelle — pastilles déjà
   * relues par le serveur. Pendant les deux premiers temps, ni pastille ni
   * bouton : rien à cliquer sur un coffre en pleine réécriture.
   */
  const [, reafficher] = React.useReducer((n: number) => n + 1, 0);
  const phase = phaseDeLigneCompte(connexion);
  const lignePleine = phase === 'aucune' || phase === 'saisie';
  React.useEffect(() => {
    if (phase !== 'resultat' || !connexion?.finieA) return;
    const reste = DUREE_RESULTAT_CONNEXION_MS - (Date.now() - connexion.finieA);
    const minuteur = window.setTimeout(reafficher, Math.max(0, reste) + 50);
    return () => window.clearTimeout(minuteur);
  }, [phase, connexion?.finieA]);

  // Le nom peut changer sous nos pieds (renommage validé, relevé de quota) :
  // tant qu'on n'édite pas, la ligne suit toujours la valeur du serveur.
  React.useEffect(() => {
    if (!edite) setNom(quota.label);
  }, [quota.label, edite]);

  const valider = async () => {
    const propre = nom.trim();
    if (!propre || propre === quota.label) {
      setEdite(false);
      setNom(quota.label);
      return;
    }
    setEnvoi(true);
    try {
      const rendu = await client.call<{ ok: boolean }>({ type: 'account.rename', id: quota.id, label: propre });
      if (!rendu.ok) client.pushToast('error', t('nom refusé'));
      setEdite(false);
    } catch {
      client.pushToast('error', 'renommage impossible');
    } finally {
      setEnvoi(false);
    }
  };

  /*
   * LE BOUTON ATTEND L'ACCUSÉ DU SERVEUR AVANT DE REFERMER SON ENCART. Il
   * refermait d'abord, envoyait ensuite — et l'envoi sans retour jetait la
   * demande en silence dès que le canal n'était pas ouvert : l'encart se
   * fermait, rien ne partait, personne ne pouvait le savoir. Désormais
   * l'attente se voit sur le bouton, l'encart ne se referme QUE sur un accusé,
   * et un échec laisse l'encart ouvert avec un message qui dit pourquoi.
   */
  const reconnecter = async () => {
    setReconnexion(true);
    try {
      const parti = await client.geste({ type: 'account.connect', engine: quota.engine, accountId: quota.id }, t('Reconnexion du compte'));
      if (parti) setConfirmation(null);
    } finally {
      setReconnexion(false);
    }
  };

  const retirer = async () => {
    setRetrait(true);
    try {
      const rendu = await client.call<{ ok: boolean; erreur?: string }>({ type: 'account.remove', id: quota.id });
      // Un refus PORTE SA RAISON : compte au travail, dernier compte du moteur.
      if (!rendu.ok) client.pushToast('error', rendu.erreur ?? t('retrait impossible'));
      else setConfirmation(null);
    } catch {
      client.pushToast('error', t('retrait impossible'));
    } finally {
      setRetrait(false);
    }
  };

  // L'ADRESSE DU COMPTE CHEZ LE FOURNISSEUR, lue sur son profil. Deux fiches
  // qui portent la même adresse rendent le badge « même abonnement » évident au
  // lieu d'énigmatique. Non lue, elle se DIT — elle ne laisse pas un vide.
  const identite = quota.identite?.adresse ?? quota.identite?.compteFournisseur;

  return (
    <div className="rounded-md border border-border bg-bloc px-2 py-1.5" data-ligne-compte={quota.id} data-phase-connexion={phase}>
      {/* SOUS 400 px, LES BADGES ET LES BOUTONS PASSENT SOUS LE NOM au lieu de
          l'écraser en une colonne d'un caractère de large : la rangée se replie
          (`flex-wrap`), et le bloc du nom garde une base assez large pour ne
          jamais être comprimé. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <div className="min-w-0 flex-1 basis-[11rem]">
          {edite ? (
            <div className="flex items-center gap-1.5">
              <Input
                autoFocus
                value={nom}
                disabled={envoi}
                onChange={(event) => setNom(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') valider();
                  if (event.key === 'Escape') {
                    setEdite(false);
                    setNom(quota.label);
                  }
                }}
                className="h-7 min-w-0 flex-1 text-[13.5px]"
              />
              <Button size="sm" disabled={envoi} onClick={valider}>
                {envoi ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                
{t('Valider')}
</Button>
            </div>
          ) : (
            <p className="truncate text-[13.5px] text-text">
              {quota.label} {quota.plan ? <span className="text-faint">· {quota.plan}</span> : null}
            </p>
          )}
          {/* À QUEL COMPTE CETTE FICHE EST BRANCHÉE. Seul Claude publie un
              profil : ailleurs, la ligne n'aurait rien à dire et ne s'affiche
              pas. */}
          {!edite && quota.engine === 'claude' ? (
            <p className="truncate text-[11.5px] text-faint" data-identite-compte={quota.id}>
              {identite ?? t('identité non lue')}
            </p>
          ) : null}
          {/* Un moteur sans fenêtre de pourcentage n'affiche pas de jauge
              5 h / semaine. À la place : état de la clé, montant dépensé. */}
          {!edite && moteurSansQuota(quota.engine) ? (
            <>
              {quota.engine === 'cursor' ? <EtatCursor accountId={quota.id} /> : null}
              <CreditCursorLigne quota={quota} />
            </>
          ) : null}
          {!edite && !moteurSansQuota(quota.engine) ? (
            <p className="text-[11.5px] text-faint">
              {quota.session ? `${libelleFenetreCompte(quota.session, 'session')} ${Math.round(quota.session.usedPct ?? 0)} %` : null}
              {quota.session && quota.weekly ? ' · ' : null}
              {quota.weekly ? `${libelleFenetreCompte(quota.weekly, 'weekly')} ${Math.round(quota.weekly.usedPct ?? 0)} %` : null}
              {!quota.session && !quota.weekly ? t('Aucune fenêtre de quota publiée') : null}
              {quota.weekly && tempsRestant(quota.weekly.resetsAt) ? t(' · remise à zéro : {v0}', { v0: tempsRestant(quota.weekly.resetsAt) }) : ''}
            </p>
          ) : null}
        </div>
        {!edite && lignePleine ? (
          <div className="flex min-w-0 flex-wrap items-center gap-1" data-actions-compte={quota.id}>
            {quota.active ? <Badge tone="success">{t('actif')}</Badge> : null}
            {compteEpuise(quota) ? <Badge tone="danger">{t('épuisé')}</Badge> : null}
            {quota.jumeaux?.length ? <Badge tone="warning">{t('même abonnement')}</Badge> : null}
            {/* L'état de la connexion ne se dit QUE lorsqu'il pose problème :
                un compte qui marche n'a pas besoin d'un badge de plus. */}
            {quota.connexion?.doitReconnecter ? <Badge tone="warning">{quota.connexion.libelle}</Badge> : null}
            {/* RECONNECTER EST OUVERT SUR TOUS LES COMPTES, pas seulement sur
                ceux qui sont en panne : c'est le seul geste qui sépare deux
                coffres branchés au même abonnement. Mis en avant sur un compte
                à reconnecter, discret et confirmé sur un compte qui répond. */}
            {phase === 'aucune' ? (
              <Button
                data-reconnecter-compte={quota.id}
                variant={quota.connexion?.doitReconnecter ? 'outline' : 'ghost'}
                size="sm"
                disabled={reconnexion}
                onClick={() =>
                  parCle
                    ? setConfirmation((v) => (v === 'cle' ? null : 'cle'))
                    : quota.connexion?.doitReconnecter
                      ? void reconnecter()
                      : setConfirmation((v) => (v === 'reconnecter' ? null : 'reconnecter'))
                }
              >
                {/* L'ATTENTE SE VOIT SUR LE BOUTON QUI A ÉTÉ CLIQUÉ. Un compte
                    dont la session est tombée se reconnecte SANS confirmation :
                    sans ce témoin, le seul signe du voyage de la demande serait
                    l'absence de signe. */}
                {reconnexion ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogIn className="h-3 w-3" />}
                
{t('Reconnecter')}
</Button>
            ) : null}
            <Tooltip label={t('Renommer ce compte')}>
              <Button variant="ghost" size="icon-sm" onClick={() => setEdite(true)}>
                <Pencil className="h-3 w-3" />
              </Button>
            </Tooltip>
            {/* RETIRER UN COMPTE : il quitte l'application pour de bon, y
                compris après un redémarrage. Ses identifiants, eux, restent sur
                le serveur — la confirmation le dit. */}
            <Tooltip label={t('Retirer ce compte')}>
              <Button
                data-retirer-compte={quota.id}
                variant="ghost"
                size="icon-sm"
                onClick={() => setConfirmation((v) => (v === 'retirer' ? null : 'retirer'))}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </Tooltip>
          </div>
        ) : null}
      </div>
      {confirmation === 'reconnecter' && lignePleine ? (
        <div className="mt-1.5 rounded-md border border-border bg-raised px-2 py-1.5" data-confirmation-reconnexion={quota.id}>
          <p className="text-[11.5px] leading-relaxed text-faint">
            {t('Reconnecter « {v0} » ouvre une session sur son coffre : la session en cours sera remplacée par le compte que vous choisirez.', {
              v0: quota.label,
            })}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Button size="sm" data-confirmer-reconnexion disabled={reconnexion} onClick={reconnecter}>
              {reconnexion ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              {t('Reconnecter')}
            </Button>
            <Button size="sm" variant="ghost" disabled={reconnexion} onClick={() => setConfirmation(null)}>{t('Annuler')}</Button>
          </div>
        </div>
      ) : null}
      {confirmation === 'cle' && lignePleine ? (
        <RemplacerCle accountId={quota.id} engine={quota.engine} label={quota.label} onFini={() => setConfirmation(null)} />
      ) : null}
      {confirmation === 'retirer' && lignePleine ? (
        <div className="mt-1.5 rounded-md border border-danger bg-raised px-2 py-1.5" data-confirmation-retrait={quota.id}>
          <p className="text-[11.5px] leading-relaxed text-faint">
            {t('Retirer « {v0} » le fait disparaître de l\'application, même après un redémarrage. Ses identifiants restent sur le serveur.', {
              v0: quota.label,
            })}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Button size="sm" variant="danger" disabled={retrait} onClick={retirer}>
              {retrait ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              {t('Retirer')}
            </Button>
            <Button size="sm" variant="ghost" disabled={retrait} onClick={() => setConfirmation(null)}>{t('Annuler')}</Button>
          </div>
        </div>
      ) : null}
      {/* DEUX COFFRES BRANCHÉS AU MÊME COMPTE CHEZ LE FOURNISSEUR ne font qu'un
          abonnement. Quand les deux profils l'ont DIT, la phrase l'affirme ;
          quand seule la coïncidence des chiffres le laisse croire, elle le dit
          comme une présomption. Le seul geste qui les sépare est une
          reconnexion, juste au-dessus. */}
      {quota.jumeaux?.length ? (
        <p className="mt-1 text-[11.5px] leading-relaxed text-warning" data-comptes-jumeaux>
          {quota.jumeauxCertains
            ? t('Même compte que {v0} : ces coffres sont branchés sur un seul abonnement. Pour les séparer, reconnectez-en un avec un autre compte.', {
                v0: quota.jumeaux.map((autre) => autre.label).join(', '),
              })
            : t('Relevé identique à {v0} : ces comptes pointent le même abonnement. Pour les séparer, reconnectez-en un avec un autre compte.', {
                v0: quota.jumeaux.map((autre) => autre.label).join(', '),
              })}
        </p>
      ) : null}
      {connexion && phase !== 'aucune' ? <BlocConnexion connexion={connexion} /> : null}
    </div>
  );
}

export function libelleFenetreCompte(
  win: { durationSeconds?: number },
  type: 'session' | 'weekly',
): string {
  const secondes = win.durationSeconds;
  if (secondes === 5 * 60 * 60) return t('fenêtre 5 h');
  if (secondes === 7 * 24 * 60 * 60) return 'semaine';
  if (secondes && secondes < 24 * 60 * 60) {
    const heures = secondes / 3600;
    return Number.isInteger(heures) ? t('fenêtre {heures} h', { heures }) : t('fenêtre courte');
  }
  if (secondes) {
    const jours = secondes / (24 * 3600);
    return Number.isInteger(jours) ? t('fenêtre {jours} jours', { jours }) : t('fenêtre longue');
  }
  return type === 'weekly' ? t('fenêtre longue') : t('fenêtre courte');
}

/**
 * CE QU'IL FAUT POUR QU'UN TOUR CURSOR PARTE, sous la ligne de son compte : le
 * nom que Cursor donne à la clé, et l'outil « cursor-agent » sur le serveur.
 * Les deux sont nécessaires — sans l'outil, aucun agent ne se lance ; sans
 * clé, il se lance et se fait refuser. Sans cette ligne, rien à l'écran ne
 * disait POURQUOI un moteur pourtant déclaré ne travaille pas.
 *
 * La lecture appelle Cursor : elle se fait à l'ouverture des réglages, une
 * fois, et son échec se DIT au lieu de laisser une ligne vide.
 */
export function EtatCursor({ accountId }: { accountId: string }) {
  const [etat, setEtat] = React.useState<EtatCompteCursor | null>(null);
  const [erreur, setErreur] = React.useState<string | null>(null);

  React.useEffect(() => {
    let vivant = true;
    client
      .call<{ etat: EtatCompteCursor }>({ type: 'cursor.etat', accountId })
      .then((data) => vivant && setEtat(data.etat))
      .catch((err) => vivant && setErreur(err?.message ?? t('état illisible')));
    return () => {
      vivant = false;
    };
  }, [accountId]);

  if (erreur) return <p className="text-[11.5px] text-danger">{erreur}</p>;
  if (!etat) return <p className="text-[11.5px] text-faint">{t('lecture de la clé…')}</p>;

  return (
    <div className="text-[11.5px] text-faint">
      {etat.cleAcceptee ? (
        <p>{t('clé « {v0} » acceptée', { v0: etat.nomDeLaCle ?? 'sans nom' })}</p>
      ) : (
        <p className="text-danger">{t('clé refusée — {v0}', { v0: etat.erreur ?? 'raison inconnue' })}</p>
      )}
      {etat.cliInstalle ? (
        <p>{t('outil « cursor-agent » installé{v0}', { v0: etat.versionDuCli ? ` (version ${etat.versionDuCli})` : '' })}</p>
      ) : (
        <p className="text-warning">
          {t('outil « cursor-agent » absent du serveur — {v0}', { v0: etat.erreurDuCli ?? 'aucun tour ne peut partir' })}</p>
      )}
    </div>
  );
}

/** Le même affichage que la carte du volet des quotas : les deux écrans ne se contredisent pas. */
export function CreditCursorLigne({ quota }: { quota: AccountQuota }) {
  const usage = quota.usageLocal
    ? usageCursorEnClair(quota.usageLocal.seconds, quota.usageLocal.tours)
    : null;
  return (
    <div className="mt-1 max-w-[320px]">
      <UsageCursor credit={quota.credit} enErreur={Boolean(quota.error)} />
      {usage ? <p className="mt-1 text-[11.5px] text-faint">{usage}</p> : null}
    </div>
  );
}

