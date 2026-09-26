/**
 * LES COMPTES CLIENTS, EN MORCEAUX RÉUTILISABLES.
 *
 * Ils vivaient d'un seul bloc dans la page « Accès clients » des réglages : pour
 * ouvrir un accès à un client, il fallait quitter la Messagerie, trouver la
 * page, puis revenir. Le formulaire de création, la ligne d'un compte et le mot
 * de passe montré une fois sortent donc ici, et servent TROIS endroits sans
 * changer d'aspect : la page des réglages, le tiroir « Ajouter un client » du
 * sélecteur de clients, et le tiroir « Comptes du client » de l'espace d'un
 * client — filtré sur son projet.
 *
 * Les droits ne se décident pas ici : toutes les commandes `comptes.*` sont
 * réservées à Haiko par le serveur (`shared/src/droits-commandes.ts`).
 */
import * as React from 'react';
import { Copy, KeyRound, Loader2, Mail, Plus, ShieldOff, UserPlus } from 'lucide-react';
import {
  etatDuCompteEnClair,
  jugerIdentifiant,
  nomDuCompte,
  type CompteUtilisateur,
} from '@beluga/shared';
import { Badge, Button, ConfirmDialog, Input, Switch } from '@/components/ui';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn, relativeTime } from '@/lib/utils';
import { t } from '@/lib/langue';

/** Ce que rend le serveur quand un courriel d'identifiants a été demandé. */
export interface IssueDuCourriel {
  envoye: boolean;
  raison?: string;
}

/** Un mot de passe à montrer UNE fois, et ce qu'est devenu son courriel. */
export interface SecretMontre {
  nom: string;
  valeur: string;
  courriel?: IssueDuCourriel & { adresse?: string };
}

/**
 * LES COMPTES CLIENTS, filtrés sur un projet quand on en donne un. `actif`
 * retient le chargement tant que l'écran n'est pas ouvert : un tiroir fermé ne
 * questionne pas le serveur.
 */
export function useComptesClients(projectId?: string, actif = true) {
  const [comptes, setComptes] = React.useState<CompteUtilisateur[] | null>(null);
  const recharger = React.useCallback(() => {
    void client
      .call<{ comptes: CompteUtilisateur[] }>({ type: 'comptes.lister' })
      .then((data) =>
        setComptes(
          (data.comptes ?? []).filter((c) => c.role === 'client' && (!projectId || c.projets.includes(projectId))),
        ),
      )
      .catch(() => setComptes((avant) => avant ?? []));
  }, [projectId]);
  React.useEffect(() => {
    if (actif) recharger();
  }, [actif, recharger]);
  return { comptes, recharger };
}

/**
 * LE FORMULAIRE D'UN COMPTE NEUF. Vu depuis l'espace d'un client, le projet est
 * IMPOSÉ et le choix des projets disparaît. La case d'envoi reste éteinte tant
 * qu'aucune adresse n'est saisie : un courriel sans destinataire ne part pas.
 */
export function FormulaireCompteClient({
  projetImpose,
  onCree,
  nu,
}: {
  projetImpose?: string;
  onCree: (resultat: { compte: CompteUtilisateur; secret: SecretMontre }) => void;
  /** Posé dans un tiroir qui porte déjà son titre : ni cadre, ni intitulé. */
  nu?: boolean;
}) {
  const state = useApp();
  const [identifiant, setIdentifiant] = React.useState('');
  const [nomAffiche, setNomAffiche] = React.useState('');
  const [projets, setProjets] = React.useState<string[]>(projetImpose ? [projetImpose] : []);
  const [courriel, setCourriel] = React.useState('');
  const [envoyer, setEnvoyer] = React.useState(false);
  const [enCours, setEnCours] = React.useState(false);
  const avecAdresse = courriel.trim().length > 0;

  const creer = async () => {
    const juge = jugerIdentifiant(identifiant);
    if (!juge.ok) {
      client.pushToast('error', juge.raison!);
      return;
    }
    setEnCours(true);
    try {
      const data = await client.call<{
        compte: CompteUtilisateur;
        motDePasse: string;
        courriel?: IssueDuCourriel;
      }>({
        type: 'comptes.creer',
        identifiant,
        nomAffiche,
        projets: projetImpose ? [projetImpose] : projets,
        courriel: courriel.trim() || undefined,
        envoyerIdentifiants: envoyer && avecAdresse,
      });
      onCree({
        compte: data.compte,
        secret: {
          nom: nomDuCompte(data.compte),
          valeur: data.motDePasse,
          courriel: data.courriel ? { ...data.courriel, adresse: courriel.trim() } : undefined,
        },
      });
      setIdentifiant('');
      setNomAffiche('');
      setProjets(projetImpose ? [projetImpose] : []);
      setCourriel('');
      setEnvoyer(false);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('accès non créé'));
    } finally {
      setEnCours(false);
    }
  };

  const basculerProjet = (id: string) =>
    setProjets((liste) => (liste.includes(id) ? liste.filter((p) => p !== id) : [...liste, id]));

  return (
    <div
      className={cn('flex flex-col gap-2', nu ? null : 'rounded-md border border-faint/60 bg-surface p-3')}
      data-formulaire-compte
    >
      {nu ? null : (
        <div className="flex items-center gap-2 text-[13px] font-medium text-text">
          <UserPlus className="h-4 w-4" />
          {t('Ouvrir un accès')}
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          value={identifiant}
          onChange={(e) => setIdentifiant(e.target.value)}
          placeholder={t('Identifiant')}
          data-champ-identifiant
        />
        <Input
          value={nomAffiche}
          onChange={(e) => setNomAffiche(e.target.value)}
          placeholder={t('Nom affiché')}
          data-champ-nom
        />
      </div>
      <Input
        type="email"
        value={courriel}
        onChange={(e) => {
          setCourriel(e.target.value);
          if (!e.target.value.trim()) setEnvoyer(false);
        }}
        placeholder={t('Adresse de courriel (facultative)')}
        data-champ-courriel-neuf
      />
      <label
        className={cn('flex items-center gap-2 text-[12.5px]', avecAdresse ? 'text-text' : 'text-faint')}
        data-envoyer-identifiants={envoyer && avecAdresse ? 'oui' : 'non'}
      >
        <Switch checked={envoyer && avecAdresse} disabled={!avecAdresse} onCheckedChange={setEnvoyer} />
        <Mail className="h-3.5 w-3.5 shrink-0" />
        {t('Envoyer les identifiants par courriel')}
      </label>
      {projetImpose ? null : (
        <div className="flex flex-wrap gap-1.5" data-choix-projets>
          {state.projects.map((projet) => (
            <Button
              key={projet.id}
              size="sm"
              variant={projets.includes(projet.id) ? 'default' : 'outline'}
              onClick={() => basculerProjet(projet.id)}
              data-projet={projet.id}
            >
              {projet.name}
            </Button>
          ))}
        </div>
      )}
      <div className="flex justify-end">
        <Button onClick={creer} disabled={enCours || !identifiant.trim()} data-creer-acces>
          {enCours ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {t('Créer l’accès')}
        </Button>
      </div>
    </div>
  );
}

/**
 * LE MOT DE PASSE D'UN COMPTE NEUF, MONTRÉ UNE SEULE FOIS — et, quand un
 * courriel a été demandé, ce qu'il est devenu : parti, ou pas parti avec sa
 * cause. Un échec d'envoi ne se tait jamais.
 */
export function MotDePasseMontre({ secret, onFermer }: { secret: SecretMontre; onFermer: () => void }) {
  return (
    <div className="rounded-md border border-warning/50 bg-warning/10 p-3" data-mot-de-passe-montre>
      <div className="text-[13px] font-medium text-text">
        {t('Mot de passe de')} {secret.nom}
      </div>
      <p className="mt-1 text-xs text-muted">
        {t('Il n’est montré qu’une fois : copiez-le et transmettez-le maintenant.')}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="flex-1 truncate rounded bg-bg px-2 py-1.5 text-[13px] text-text">{secret.valeur}</code>
        <Button
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(secret.valeur);
            client.pushToast('success', t('Mot de passe copié'));
          }}
        >
          <Copy className="h-3.5 w-3.5" />
          {t('Copier')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onFermer}>
          {t('J’ai noté')}
        </Button>
      </div>
      {secret.courriel?.envoye ? (
        <p className="mt-2 text-xs text-success" data-courriel-identifiants="envoye">
          {t('Identifiants envoyés par courriel à {adresse}.', { adresse: secret.courriel.adresse ?? '' })}
        </p>
      ) : secret.courriel ? (
        <p className="mt-2 text-xs text-danger" data-courriel-identifiants="echec">
          {t('Le courriel n’est pas parti')} : {secret.courriel.raison}
        </p>
      ) : null}
    </div>
  );
}

/** Une ligne de compte : état, mot de passe, retrait, adresse, portée. */
export function LigneCompteClient({
  compte,
  onChangement,
  onSecret,
  onRetirer,
}: {
  compte: CompteUtilisateur;
  onChangement: () => void;
  onSecret: (secret: SecretMontre) => void;
  onRetirer: (compte: CompteUtilisateur) => void;
}) {
  const state = useApp();

  const changerPortee = (projectId: string) => {
    const suite = compte.projets.includes(projectId)
      ? compte.projets.filter((p) => p !== projectId)
      : [...compte.projets, projectId];
    void client
      .call({ type: 'comptes.portee', id: compte.id, projets: suite })
      .then(onChangement)
      .catch((err) => client.pushToast('error', err?.message ?? t('portée non changée')));
  };

  const reinitialiser = () => {
    void client
      .call<{ motDePasse: string }>({ type: 'comptes.motDePasse', id: compte.id })
      .then((data) => {
        onSecret({ nom: nomDuCompte(compte), valeur: data.motDePasse });
        onChangement();
      })
      .catch((err) => client.pushToast('error', err?.message ?? t('mot de passe non changé')));
  };

  const suspendre = (suspendu: boolean) => {
    void client
      .call({ type: 'comptes.suspendre', id: compte.id, suspendu })
      .then(onChangement)
      .catch((err) => client.pushToast('error', err?.message ?? t('état non changé')));
  };

  return (
    <div className="rounded-md border border-faint/60 bg-surface p-3" data-acces={compte.id} data-acces-actif={compte.actif ? 'oui' : 'non'}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-medium text-text">{nomDuCompte(compte)}</div>
          <div className="text-xs text-muted">
            {compte.identifiant} · {t(etatDuCompteEnClair(compte))}
            {compte.derniereEntree ? ` · ${relativeTime(compte.derniereEntree)}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={compte.actif} onCheckedChange={(actif) => suspendre(!actif)} data-suspendre={compte.id} />
          <Button size="sm" variant="ghost" onClick={reinitialiser} data-reinitialiser={compte.id}>
            <KeyRound className="h-3.5 w-3.5" />
            {t('Nouveau mot de passe')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onRetirer(compte)} data-retirer={compte.id}>
            <ShieldOff className="h-3.5 w-3.5" />
            {t('Retirer')}
          </Button>
        </div>
      </div>
      {/*
       * L'ADRESSE OÙ LUI ÉCRIRE — c'est elle que vise le courriel du lundi
       * matin. Un compte sans adresse est simplement sauté à l'envoi : laisser
       * le champ vide veut dire « ne m'écrivez pas ».
       */}
      <label className="mt-2 flex items-center gap-2 text-[11px] text-faint">
        <Mail className="h-3.5 w-3.5 shrink-0" />
        <input
          defaultValue={compte.courriel ?? ''}
          onBlur={(event) =>
            void client
              .call({ type: 'comptes.courriel', id: compte.id, courriel: event.target.value })
              .then(onChangement)
              .catch((err) => client.pushToast('error', err?.message ?? t('état non changé')))
          }
          placeholder={t('Adresse de courriel (facultative)')}
          className="h-7 min-w-0 flex-1 rounded-md border border-border bg-controle px-2 text-[12px] text-text"
          data-courriel={compte.id}
        />
      </label>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {state.projects.map((projet) => (
          <Badge
            key={projet.id}
            tone={compte.projets.includes(projet.id) ? 'strong' : 'neutral'}
            className="cursor-pointer"
            onClick={() => changerPortee(projet.id)}
            data-portee={projet.id}
            data-coche={compte.projets.includes(projet.id) ? '1' : '0'}
          >
            {projet.name}
          </Badge>
        ))}
      </div>
    </div>
  );
}

/**
 * LA GESTION ENTIÈRE : créer, montrer le mot de passe, lister, retirer. Donnée
 * avec un projet, elle ne montre que ses comptes et crée pour lui seul.
 */
export function GestionComptesClients({
  projectId,
  actif = true,
  avecCreation = true,
  nu,
}: {
  projectId?: string;
  actif?: boolean;
  avecCreation?: boolean;
  nu?: boolean;
}) {
  const { comptes, recharger } = useComptesClients(projectId, actif);
  const [secret, setSecret] = React.useState<SecretMontre | null>(null);
  const [aRetirer, setARetirer] = React.useState<CompteUtilisateur | null>(null);
  const liste = comptes ?? [];

  return (
    <div className="flex flex-col gap-5" data-gestion-comptes={projectId ?? 'tous'}>
      {avecCreation ? (
        <FormulaireCompteClient
          projetImpose={projectId}
          nu={nu}
          onCree={({ secret: neuf }) => {
            setSecret(neuf);
            recharger();
          }}
        />
      ) : null}

      {secret ? <MotDePasseMontre secret={secret} onFermer={() => setSecret(null)} /> : null}

      <div className="flex flex-col gap-2" data-liste-acces={liste.length}>
        {liste.map((compte) => (
          <LigneCompteClient
            key={compte.id}
            compte={compte}
            onChangement={recharger}
            onSecret={setSecret}
            onRetirer={setARetirer}
          />
        ))}
        {comptes && !liste.length ? (
          <p className="text-xs text-muted">{t('Aucun accès client pour l’instant.')}</p>
        ) : null}
      </div>

      {aRetirer ? (
        <ConfirmDialog
          open
          title={t('Retirer cet accès ?')}
          description={t('Le compte est mis de côté. Ses demandes et ses messages restent lisibles.')}
          confirmLabel={t('Retirer')}
          danger
          onClose={() => setARetirer(null)}
          onConfirm={() => {
            void client.call({ type: 'comptes.retirer', id: aRetirer.id }).then(recharger);
            setARetirer(null);
          }}
        />
      ) : null}
    </div>
  );
}
