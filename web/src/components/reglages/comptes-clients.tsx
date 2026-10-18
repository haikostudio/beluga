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
import { Copy, KeyRound, Loader2, Mail, MessageSquareText, Plus, ShieldOff, UserPlus, X } from 'lucide-react';
import {
  etatDuCompteEnClair,
  jugerIdentifiant,
  libelleDansUnMenu,
  messageDInvitation,
  nomDuCompte,
  projetsEnArbre,
  type CompteUtilisateur,
  type Project,
} from '@beluga/shared';
import {
  Badge,
  Button,
  ConfirmDialog,
  DialogTitle,
  Drawer,
  Input,
  ListeDeroulante,
  Switch,
  ZoneDefilement,
  type OptionSelecteur,
} from '@/components/ui';
import { SilhouetteAccesClients } from '@/components/silhouettes';
import { useTiroirAdresse } from '@/lib/tiroirs-adresse';
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
  /** L'identifiant de connexion : le message d'invitation le reprend. */
  identifiant: string;
  valeur: string;
  courriel?: IssueDuCourriel & { adresse?: string };
}

/**
 * COPIER UN TEXTE, MÊME QUAND IL ARRIVE DU SERVEUR. Safari refuse une copie
 * faite APRÈS une requête (le geste de l'utilisateur est « consommé ») : le
 * texte part donc comme une promesse dans un `ClipboardItem`, posé pendant le
 * clic. Ailleurs, ou si cette voie échoue, `writeText` une fois le texte reçu.
 * Hors contexte sécurisé, le presse-papiers n'existe pas : on le DIT.
 */
export async function copierAuPressePapiers(texte: string | Promise<string>): Promise<void> {
  const presse = navigator.clipboard;
  if (!presse) throw new Error(t('Le presse-papiers n’est pas accessible sur cette page.'));
  const promesse = Promise.resolve(texte);
  if (typeof ClipboardItem !== 'undefined' && presse.write) {
    try {
      await presse.write([new ClipboardItem({ 'text/plain': promesse.then((v) => new Blob([v], { type: 'text/plain' })) })]);
      return;
    } catch {
      /* Le texte lui-même a pu échouer : `await promesse` le redira. */
    }
  }
  await presse.writeText(await promesse);
}

/** Les projets connus en options de liste, rangés par nom, les sous-projets sous leur projet réuni. */
export function optionsDesProjets(projets: Project[]): OptionSelecteur[] {
  const parNom = [...projets].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return projetsEnArbre(parNom).map((ligne) => ({
    valeur: ligne.projet.id,
    libelle: libelleDansUnMenu(ligne.projet.name, ligne),
    attributs: { 'data-membre-de': ligne.parentId },
  }));
}

/**
 * LES PROJETS RETENUS, EN PASTILLES. Seuls ceux qui sont ouverts au client
 * s'affichent ; une croix retire le projet. Un projet disparu depuis est tu.
 */
export function PastillesDeProjets({
  ids,
  onRetirer,
  attributs,
}: {
  ids: string[];
  onRetirer: (id: string) => void;
  attributs: (id: string) => Record<`data-${string}`, string>;
}) {
  const state = useApp();
  const projets = ids.map((id) => state.projects.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p);
  if (!projets.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {projets.map((projet) => (
        <Badge key={projet.id} className="max-w-full gap-0.5 py-0 pr-0.5 text-text" {...attributs(projet.id)}>
          <span className="truncate py-0.5">{projet.name}</span>
          <button
            type="button"
            title={t('Retirer {nom}', { nom: projet.name })}
            onClick={() => onRetirer(projet.id)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-faint transition-colors hover:bg-bloc hover:text-text"
            data-retirer-projet={projet.id}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
    </div>
  );
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
        role: 'client',
        projets: projetImpose ? [projetImpose] : projets,
        courriel: courriel.trim() || undefined,
        envoyerIdentifiants: envoyer && avecAdresse,
      });
      onCree({
        compte: data.compte,
        secret: {
          nom: nomDuCompte(data.compte),
          identifiant: data.compte.identifiant,
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
      className={cn('flex flex-col gap-2', nu ? null : 'rounded-md border border-transparent bg-surface p-3')}
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
        /* UNE LISTE À CASES, FILTRABLE : la grappe d'un bouton par projet
           devenait illisible passé une dizaine de projets. */
        <div className="flex flex-col gap-1.5" data-choix-projets={projets.join(',')}>
          <ListeDeroulante
            valeur=""
            valeurs={projets}
            options={optionsDesProjets(state.projects)}
            onChoisir={basculerProjet}
            titre={t('Projets du client')}
            placeholder={t('Choisir les projets')}
            repere="projets-acces"
            empile
          />
          <PastillesDeProjets ids={projets} onRetirer={basculerProjet} attributs={(id) => ({ 'data-projet': id })} />
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
export function MotDePasseMontre({
  secret,
  onFermer,
  sansInvitation,
}: {
  secret: SecretMontre;
  onFermer: () => void;
  /** Le message d'invitation vise l'espace client : un membre ou un lecteur n'en a pas. */
  sansInvitation?: boolean;
}) {
  return (
    <div className="rounded-md border border-transparent bg-warning/10 p-3" data-mot-de-passe-montre>
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
          onClick={() =>
            void copierAuPressePapiers(secret.valeur)
              .then(() => client.pushToast('success', t('Mot de passe copié')))
              .catch((err) => client.pushToast('error', err?.message ?? t('copie impossible')))
          }
        >
          <Copy className="h-3.5 w-3.5" />
          {t('Copier')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onFermer}>
          {t('J’ai noté')}
        </Button>
      </div>
      {/* LE MESSAGE TOUT PRÊT pour un SMS ou une messagerie, avec CE mot de
          passe : aucun nouveau n'est tiré. */}
      {sansInvitation ? null : (
      <Button
        size="sm"
        variant="outline"
        className="mt-2"
        onClick={() =>
          void copierAuPressePapiers(messageDInvitation({ nom: secret.nom, identifiant: secret.identifiant, motDePasse: secret.valeur }))
            .then(() => client.pushToast('success', t('Invitation copiée')))
            .catch((err) => client.pushToast('error', err?.message ?? t('copie impossible')))
        }
        data-copier-invitation-montre
      >
        <MessageSquareText className="h-3.5 w-3.5" />
        {t('Copier l’invitation')}
      </Button>
      )}
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
  /* LA PORTÉE SE TIENT ICI, PAS SEULEMENT DANS `compte` : deux coches
     rapprochées partiraient sinon toutes deux de l'ancienne liste, et la
     seconde effacerait la première. Elle se recale sur le serveur à chaque
     rechargement. */
  const [portee, setPortee] = React.useState(compte.projets);
  const porteeServeur = compte.projets.join(',');
  React.useEffect(() => setPortee(compte.projets), [porteeServeur]);
  const [invitation, setInvitation] = React.useState<'confirmer' | 'en-cours' | null>(null);

  const changerPortee = (projectId: string) => {
    const suite = portee.includes(projectId) ? portee.filter((p) => p !== projectId) : [...portee, projectId];
    setPortee(suite);
    void client
      .call({ type: 'comptes.portee', id: compte.id, projets: suite })
      .then(onChangement)
      .catch((err) => {
        client.pushToast('error', err?.message ?? t('portée non changée'));
        onChangement();
      });
  };

  const nouveauMotDePasse = () =>
    client.call<{ motDePasse: string }>({ type: 'comptes.motDePasse', id: compte.id }).then((data) => {
      onSecret({ nom: nomDuCompte(compte), identifiant: compte.identifiant, valeur: data.motDePasse });
      onChangement();
      return data.motDePasse;
    });

  const reinitialiser = () => {
    void nouveauMotDePasse().catch((err) => client.pushToast('error', err?.message ?? t('mot de passe non changé')));
  };

  /* L'INVITATION D'UN ACCÈS EXISTANT TIRE UN NOUVEAU MOT DE PASSE : l'ancien
     n'est gardé qu'en empreinte, il ne peut pas être relu. La copie part
     pendant le clic de confirmation (§ `copierAuPressePapiers`). */
  const copierInvitation = () => {
    setInvitation('en-cours');
    const motDePasse = nouveauMotDePasse();
    void copierAuPressePapiers(
      motDePasse.then((valeur) => messageDInvitation({ nom: nomDuCompte(compte), identifiant: compte.identifiant, motDePasse: valeur })),
    )
      .then(() => client.pushToast('success', t('Invitation copiée, avec un nouveau mot de passe')))
      .catch((err) =>
        motDePasse.then(
          // Le mot de passe a changé mais la copie a échoué : il reste montré au-dessus.
          () => client.pushToast('error', t('Copie impossible : le nouveau mot de passe est affiché au-dessus.')),
          () => client.pushToast('error', err?.message ?? t('mot de passe non changé')),
        ),
      )
      .finally(() => setInvitation(null));
  };

  const suspendre = (suspendu: boolean) => {
    void client
      .call({ type: 'comptes.suspendre', id: compte.id, suspendu })
      .then(onChangement)
      .catch((err) => client.pushToast('error', err?.message ?? t('état non changé')));
  };

  return (
    <div className="rounded-md border border-transparent bg-surface p-3" data-acces={compte.id} data-acces-actif={compte.actif ? 'oui' : 'non'}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-medium text-text">{nomDuCompte(compte)}</div>
          <div className="text-xs text-muted">
            {compte.identifiant} · {t(etatDuCompteEnClair(compte))}
            {compte.derniereEntree ? ` · ${relativeTime(compte.derniereEntree)}` : ''}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Switch checked={compte.actif} onCheckedChange={(actif) => suspendre(!actif)} data-suspendre={compte.id} />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setInvitation('confirmer')}
            disabled={invitation === 'en-cours'}
            data-copier-invitation={compte.id}
          >
            {invitation === 'en-cours' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquareText className="h-3.5 w-3.5" />}
            {t('Copier l’invitation')}
          </Button>
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
      {/* SEULS LES PROJETS OUVERTS AU CLIENT s'affichent ; les autres
          s'ajoutent par la liste à cases. */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5" data-portee-acces={portee.join(',')}>
        <PastillesDeProjets ids={portee} onRetirer={changerPortee} attributs={(id) => ({ 'data-portee': id, 'data-coche': '1' })} />
        <ListeDeroulante
          valeur=""
          valeurs={portee}
          options={optionsDesProjets(state.projects)}
          onChoisir={changerPortee}
          titre={t('Projets du client')}
          repere={`portee-${compte.id}`}
          empile
          declencheur={(ouvrir) => (
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[12px] text-muted" onClick={ouvrir} data-modifier-portee={compte.id}>
              <Plus className="h-3 w-3" />
              {t('Projets')}
            </Button>
          )}
        />
      </div>
      {invitation === 'confirmer' ? (
        <ConfirmDialog
          open
          title={t('Copier l’invitation ?')}
          description={t(
            'Un nouveau mot de passe va être créé et glissé dans le message à envoyer au client. L’ancien mot de passe ne fonctionnera plus.',
          )}
          confirmLabel={t('Nouveau mot de passe et copier')}
          // La fenêtre se referme APRÈS la confirmation : la roue tourne encore.
          onClose={() => setInvitation((avant) => (avant === 'confirmer' ? null : avant))}
          onConfirm={copierInvitation}
        />
      ) : null}
    </div>
  );
}

/**
 * LA GESTION ENTIÈRE : lister, montrer le mot de passe, retirer — et créer, mais
 * dans un SECOND TIROIR posé par-dessus, ouvert par le bouton « Ajouter » du
 * pied. Donnée avec un projet, elle ne montre que ses comptes et crée pour lui
 * seul.
 *
 * LA LISTE S'OUVRE D'ABORD : tant que les comptes ne sont pas arrivés, des
 * silhouettes tiennent leur place — une liste vide n'est annoncée qu'une fois
 * la réponse reçue, jamais pendant l'attente. Le tiroir de création a son
 * adresse (« nouvel-acces ») : recharger la page le rouvre.
 *
 * `enTiroir` : la gestion occupe un tiroir de hauteur fixe — la liste défile,
 * le bouton reste collé au pied.
 */
export function GestionComptesClients({
  projectId,
  actif = true,
  avecCreation = true,
  nu,
  enTiroir,
}: {
  projectId?: string;
  actif?: boolean;
  avecCreation?: boolean;
  nu?: boolean;
  enTiroir?: boolean;
}) {
  const { comptes, recharger } = useComptesClients(projectId, actif);
  const [secret, setSecret] = React.useState<SecretMontre | null>(null);
  const [aRetirer, setARetirer] = React.useState<CompteUtilisateur | null>(null);
  const [creation, setCreation] = React.useState(false);
  const liste = comptes ?? [];
  /* Le tiroir de création n'a de sens que sous le tiroir de la liste : une
     adresse collée attend que la liste soit là, comme pour tout tiroir. */
  useTiroirAdresse('nouvel-acces', creation && avecCreation, setCreation, { pret: actif && avecCreation });

  const contenu = (
    <div className="flex flex-col gap-3" data-gestion-comptes={projectId ?? 'tous'}>
      {secret ? <MotDePasseMontre secret={secret} onFermer={() => setSecret(null)} /> : null}

      {comptes ? (
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
          {!liste.length ? <p className="text-xs text-muted">{t('Aucun accès client pour l’instant.')}</p> : null}
        </div>
      ) : (
        <SilhouetteAccesClients />
      )}
    </div>
  );

  const pied = avecCreation ? (
    <div className={cn('shrink-0', enTiroir ? 'pt-2' : 'mt-3')}>
      <Button className="w-full" onClick={() => setCreation(true)} data-ajouter-acces>
        <UserPlus className="h-4 w-4" />
        {t('Ajouter')}
      </Button>
    </div>
  ) : null;

  return (
    <>
      {enTiroir ? (
        <div className="flex min-h-0 flex-1 flex-col" data-gestion-en-tiroir>
          <ZoneDefilement fond="hsl(var(--surface))" className="min-h-0 flex-1 px-3 pb-2">
            {contenu}
          </ZoneDefilement>
          <div className="shrink-0 px-3 pb-3">{pied}</div>
        </div>
      ) : (
        <>
          {contenu}
          {pied}
        </>
      )}

      {avecCreation ? (
        <Drawer open={creation} onClose={() => setCreation(false)} empile>
          <div className="flex min-h-0 flex-1 flex-col" data-tiroir-nouvel-acces>
            <header className="flex shrink-0 items-center gap-1.5 px-3 pb-2">
              <DialogTitle className="min-w-0 flex-1 truncate">{t('Ouvrir un accès')}</DialogTitle>
              <Button size="icon-sm" variant="ghost" onClick={() => setCreation(false)} title={t('Fermer')}>
                <X className="h-4 w-4" />
              </Button>
            </header>
            <ZoneDefilement fond="hsl(var(--surface))" className="min-h-0 flex-1 px-3 pb-3">
              <FormulaireCompteClient
                projetImpose={projectId}
                nu
                onCree={({ secret: neuf }) => {
                  setSecret(neuf);
                  setCreation(false);
                  recharger();
                }}
              />
            </ZoneDefilement>
          </div>
        </Drawer>
      ) : null}

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
    </>
  );
}
