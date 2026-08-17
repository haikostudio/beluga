import * as React from 'react';
import {
  Archive,
  Check,
  CircleDollarSign,
  Globe,
  Loader2,
  RefreshCw,
  Rocket,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  PROMPT_PRODUCTION_MAX,
  Project,
  TITRE_MISE_EN_PRODUCTION,
  baseDeMiseEnProduction,
  ecrireMiseEnProduction,
  mentionBrancheParDefaut,
  mentionMiseEnProduction,
  mentionCibleMiseEnProduction,
  promptDeMiseEnProduction,
  rappelDeMiseEnProduction,
  typeCibleReglee,
  type TypeCibleMiseEnProduction,
  type AccesSSH,
  type AccesFTP,
} from '@haikodev/shared';
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from '@/components/ui';
import { Filet } from '@/components/filet';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { money } from '@/lib/utils';

interface ClientEntry {
  id: string;
  name: string;
  companyId?: string;
  companyName?: string;
  companySlug?: string;
}

/**
 * LE CHOIX D'UNE BRANCHE DE MISE EN LIGNE, une par étape.
 *
 * La liste vient du dépôt GitHub du projet : on ne tape pas un nom de branche,
 * on prend celui qui existe. Rien de choisi reste la première option, et la
 * phrase en dessous dit ce qui s'appliquera alors. Une branche déjà réglée mais
 * absente de la liste (branche effacée, dépôt injoignable) reste proposée : on
 * ne fait jamais disparaître un réglage en silence.
 */
function ChoixDeBranche({
  repere,
  titre,
  valeur,
  onChange,
  branches,
  enCours,
  raison,
  mention,
}: {
  repere: string;
  titre: string;
  valeur: string;
  onChange: (valeur: string) => void;
  branches: string[];
  enCours: boolean;
  raison: string;
  mention: string;
}) {
  const proposees = valeur && !branches.includes(valeur) ? [valeur, ...branches] : branches;
  return (
    <div {...{ [repere]: '' }}>
      <Label>{titre}</Label>
      <select
        value={valeur}
        onChange={(event) => onChange(event.target.value)}
        disabled={enCours}
        className="mt-1 h-8 w-full rounded-md border border-border bg-raised px-2 text-[14.5px] text-text"
      >
        <option value="">{enCours ? 'Lecture des branches du dépôt…' : 'Branche par défaut'}</option>
        {proposees.map((branche) => (
          <option key={branche} value={branche}>
            {branche}
          </option>
        ))}
      </select>
      <p className="mt-1 text-[11.5px] leading-snug text-faint">
        {valeur ? `Le lot sera fusionné, enregistré et poussé sur « ${valeur} ».` : mention}
        {raison ? ` ${raison}` : ''}
      </p>
    </div>
  );
}

/** Le formulaire d'accès pour une cible SSH : serveur, identifiant, clé ou mot de passe, dossier. */
function FormulaireAccesSSH({
  acces,
  onChange,
  disabled,
}: {
  acces: AccesSSH;
  onChange: (acces: AccesSSH) => void;
  disabled: boolean;
}) {
  const champ = (cle: keyof AccesSSH) => (valeur: string) =>
    onChange({ ...acces, [cle]: cle === 'port' ? Number(valeur) || undefined : valeur || undefined });
  return (
    <div className="mt-2 space-y-2" data-acces-ssh>
      <div className="grid grid-cols-[1fr,90px] gap-2">
        <div>
          <Label>Adresse du serveur</Label>
          <Input value={acces.hote ?? ''} onChange={(e) => champ('hote')(e.target.value)} disabled={disabled} className="mt-1" data-hote-ssh placeholder="serveur.exemple.com" />
        </div>
        <div>
          <Label>Port</Label>
          <Input value={acces.port ?? ''} onChange={(e) => champ('port')(e.target.value)} disabled={disabled} className="mt-1" data-port-ssh placeholder="22" />
        </div>
      </div>
      <div>
        <Label>Identifiant</Label>
        <Input value={acces.utilisateur ?? ''} onChange={(e) => champ('utilisateur')(e.target.value)} disabled={disabled} className="mt-1" data-utilisateur-ssh />
      </div>
      <div>
        <Label>Mot de passe</Label>
        <Input type="password" value={acces.motDePasse ?? ''} onChange={(e) => champ('motDePasse')(e.target.value)} disabled={disabled} className="mt-1" data-motdepasse-ssh />
      </div>
      <div>
        <Label>Ou clé privée (laisser le mot de passe vide)</Label>
        <Textarea value={acces.cle ?? ''} onChange={(e) => champ('cle')(e.target.value)} disabled={disabled} className="mt-1 min-h-[70px] font-mono text-[12px]" data-cle-ssh />
      </div>
      <div>
        <Label>Dossier de destination</Label>
        <Input value={acces.dossierDistant ?? ''} onChange={(e) => champ('dossierDistant')(e.target.value)} disabled={disabled} className="mt-1" data-dossier-distant-ssh placeholder="/var/www/mon-projet" />
      </div>
      <div>
        <Label>Dossier construit à transférer (facultatif)</Label>
        <Input value={acces.dossierConstruit ?? ''} onChange={(e) => champ('dossierConstruit')(e.target.value)} disabled={disabled} className="mt-1" data-dossier-construit-ssh placeholder="dist (deviné si laissé vide)" />
      </div>
      <div>
        <Label>Commande de fin, sur le serveur (facultatif)</Label>
        <Input value={acces.commandeFin ?? ''} onChange={(e) => champ('commandeFin')(e.target.value)} disabled={disabled} className="mt-1" data-commande-fin-ssh placeholder="systemctl restart mon-service" />
      </div>
    </div>
  );
}

/** Le formulaire d'accès pour une cible FTP : serveur, identifiant, mot de passe, dossier, FTPS. */
function FormulaireAccesFTP({
  acces,
  onChange,
  disabled,
}: {
  acces: AccesFTP;
  onChange: (acces: AccesFTP) => void;
  disabled: boolean;
}) {
  const champ = (cle: keyof AccesFTP) => (valeur: string) =>
    onChange({ ...acces, [cle]: cle === 'port' ? Number(valeur) || undefined : valeur || undefined });
  return (
    <div className="mt-2 space-y-2" data-acces-ftp>
      <div className="grid grid-cols-[1fr,90px] gap-2">
        <div>
          <Label>Adresse du serveur</Label>
          <Input value={acces.hote ?? ''} onChange={(e) => champ('hote')(e.target.value)} disabled={disabled} className="mt-1" data-hote-ftp placeholder="ftp.exemple.com" />
        </div>
        <div>
          <Label>Port</Label>
          <Input value={acces.port ?? ''} onChange={(e) => champ('port')(e.target.value)} disabled={disabled} className="mt-1" data-port-ftp placeholder="21" />
        </div>
      </div>
      <div>
        <Label>Identifiant</Label>
        <Input value={acces.utilisateur ?? ''} onChange={(e) => champ('utilisateur')(e.target.value)} disabled={disabled} className="mt-1" data-utilisateur-ftp />
      </div>
      <div>
        <Label>Mot de passe</Label>
        <Input type="password" value={acces.motDePasse ?? ''} onChange={(e) => champ('motDePasse')(e.target.value)} disabled={disabled} className="mt-1" data-motdepasse-ftp />
      </div>
      <div>
        <Label>Dossier de destination</Label>
        <Input value={acces.dossierDistant ?? ''} onChange={(e) => champ('dossierDistant')(e.target.value)} disabled={disabled} className="mt-1" data-dossier-distant-ftp placeholder="/www/mon-projet" />
      </div>
      <div>
        <Label>Dossier construit à transférer (facultatif)</Label>
        <Input value={acces.dossierConstruit ?? ''} onChange={(e) => champ('dossierConstruit')(e.target.value)} disabled={disabled} className="mt-1" data-dossier-construit-ftp placeholder="dist (deviné si laissé vide)" />
      </div>
      <label className="flex items-start gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-[13px] text-muted">
        <input
          type="checkbox"
          checked={!!acces.securise}
          onChange={(e) => onChange({ ...acces, securise: e.target.checked })}
          disabled={disabled}
          className="mt-0.5 h-3.5 w-3.5 shrink-0"
          data-securise-ftp
        />
        <span>FTPS (chiffré) plutôt que le FTP en clair — à cocher quand le serveur l'accepte.</span>
      </label>
    </div>
  );
}

/**
 * Réglages d'un projet, dont le LIEN VERS SON CLIENT (PLAN §7) : une fois posé,
 * les lignes de facture partent en un clic depuis chaque carte.
 */
export function ProjectSettings({
  project,
  open,
  onClose,
}: {
  project: Project | null;
  open: boolean;
  onClose: () => void;
}) {
  const state = useApp();
  const [clients, setClients] = React.useState<ClientEntry[]>([]);
  const [documents, setDocuments] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [available, setAvailable] = React.useState(true);

  const [name, setName] = React.useState('');
  /* La SEULE chose que le déploiement demande de régler : l'adresse de
     l'instance de dev, contrôlée à la fin de chaque déploiement. */
  const [devUrl, setDevUrl] = React.useState('');
  /*
   * LES DEUX BRANCHES DE MISE EN LIGNE : où le déploiement fusionne, où la mise
   * en production fusionne. Vide = rien de choisi, et le comportement d'avant
   * s'applique (`shared/src/branche-de-publication.ts`). La liste proposée est
   * lue sur le DÉPÔT GITHUB du projet, jamais écrite à la main.
   */
  const [brancheDev, setBrancheDev] = React.useState('');
  const [brancheProduction, setBrancheProduction] = React.useState('');
  const [branches, setBranches] = React.useState<string[]>([]);
  const [branchesEnCours, setBranchesEnCours] = React.useState(false);
  const [branchesRaison, setBranchesRaison] = React.useState('');
  /*
   * LA MISE EN PRODUCTION, en deux textes conservés côte à côte : le concept
   * écrit à la main (`baseProduction`) et le PROMPT que l'agent de mise en
   * production recevra. Un bouton fabrique le second à partir du premier ; il
   * reste modifiable et n'est retenu qu'à l'enregistrement.
   */
  const [baseProduction, setBaseProduction] = React.useState('');
  const [promptProduction, setPromptProduction] = React.useState('');
  const [generation, setGeneration] = React.useState(false);
  /*
   * LE TYPE DE CIBLE de la mise en production (`cible-mise-en-production.ts`) :
   * « consigne » garde le fonctionnement d'avant ce réglage (base + prompt,
   * ci-dessus) ; les trois autres ont leur propre formulaire d'accès.
   */
  const [typeCible, setTypeCible] = React.useState<TypeCibleMiseEnProduction>('consigne');
  const [accesSSH, setAccesSSH] = React.useState<AccesSSH>({});
  const [accesFTP, setAccesFTP] = React.useState<AccesFTP>({});
  const [prodUrl, setProdUrl] = React.useState('');
  const [engine, setEngine] = React.useState<string>('claude');
  const [clientId, setClientId] = React.useState('');
  const [rate, setRate] = React.useState('130');
  const [documentId, setDocumentId] = React.useState('');
  const [documentType, setDocumentType] = React.useState<'offer' | 'invoice'>('invoice');
  const [ecartChiffrage, setEcartChiffrage] = React.useState<{ count: number; ratioMoyen: number } | null>(null);
  const [confirmSuppression, setConfirmSuppression] = React.useState(false);
  const [faviconEnCours, setFaviconEnCours] = React.useState(false);

  React.useEffect(() => {
    if (!project) return;
    setName(project.name);
    setDevUrl(project.devUrl ?? '');
    setBrancheDev(project.branchesDePublication?.dev ?? '');
    setBrancheProduction(project.branchesDePublication?.production ?? '');
    setBaseProduction(baseDeMiseEnProduction(project));
    setPromptProduction(promptDeMiseEnProduction(project));
    setTypeCible(typeCibleReglee(project.miseEnProduction));
    setAccesSSH(project.miseEnProduction?.ssh ?? {});
    setAccesFTP(project.miseEnProduction?.ftp ?? {});
    setProdUrl(project.miseEnProduction?.prodUrl ?? '');
    setEngine(project.defaultEngine ?? 'claude');
    setClientId(project.billing?.clientId ?? '');
    setRate(String(project.billing?.hourlyRate ?? 130));
    setDocumentId(project.billing?.defaultDocumentId ?? '');
    setDocumentType(project.billing?.defaultDocumentType ?? 'invoice');
  }, [project?.id, open]);

  React.useEffect(() => {
    if (!open) return;
    setLoading(true);
    client
      .call<{ clients: ClientEntry[]; available: boolean }>({ type: 'billing.clients' }, 120000)
      .then((data) => {
        setClients(data.clients ?? []);
        setAvailable(data.available !== false && (data.clients ?? []).length > 0);
      })
      .catch(() => setAvailable(false))
      .finally(() => setLoading(false));
    client
      .call<{ documents: any[] }>({ type: 'billing.documents' }, 120000)
      .then((data) => setDocuments(data.documents ?? []))
      .catch(() => setDocuments([]));
  }, [open]);

  React.useEffect(() => {
    if (!open || !project) {
      setEcartChiffrage(null);
      return;
    }
    client
      .call<{ ecart: { count: number; ratioMoyen: number } | null }>(
        { type: 'card.ecartChiffrage', projectId: project.id },
        60000,
      )
      .then((data) => setEcartChiffrage(data.ecart ?? null))
      .catch(() => setEcartChiffrage(null));
  }, [open, project?.id]);

  /*
   * LES BRANCHES DU DÉPÔT, à l'ouverture des réglages. Elles viennent de
   * GitHub par le serveur ; injoignable, on retombe sur les branches locales et
   * on le dit. Une liste vide ne bloque pas : le champ reste saisissable.
   */
  React.useEffect(() => {
    if (!open || !project) return;
    setBranchesEnCours(true);
    setBranchesRaison('');
    client
      .call<{ branches: string[]; source: string; raison?: string }>(
        { type: 'project.branches', id: project.id },
        60000,
      )
      .then((data) => {
        setBranches(data.branches ?? []);
        if (data.source === 'local') setBranchesRaison('Branches lues sur le serveur : GitHub n’a rien rendu.');
        if (data.source === 'aucune') setBranchesRaison('Aucune branche lisible : ce projet n’a pas de dépôt joignable.');
      })
      .catch(() => {
        setBranches([]);
        setBranchesRaison('Lecture des branches impossible.');
      })
      .finally(() => setBranchesEnCours(false));
  }, [open, project?.id]);

  /*
   * TOUS les réglages internes sont posés PLUS HAUT, avant cette sortie : ils
   * doivent être déclarés dans le même ordre à chaque passage. Quand la fenêtre
   * était fermée (aucun projet) puis ouverte, les déclarer plus bas en ajoutait
   * quatre d'un coup — React arrêtait tout et l'écran devenait noir.
   */
  if (!project) return null;

  const chosen = clients.find((c) => c.id === clientId);

  const save = async () => {
    setSaving(true);
    try {
      await client.call({
        type: 'project.update',
        id: project.id,
        patch: {
          name: name.trim() || project.name,
          defaultEngine: engine,
          devUrl: devUrl.trim() || undefined,
          /* Les deux branches partent ensemble ; vides, elles ne sont pas
             enregistrées et le comportement par défaut reprend la main. */
          branchesDePublication: {
            dev: brancheDev.trim() || undefined,
            production: brancheProduction.trim() || undefined,
          },
          /* Base et prompt partent ENSEMBLE, par le même `project.update` :
             c'est ici seulement qu'un prompt généré devient le prompt retenu. */
          miseEnProduction: {
            ...ecrireMiseEnProduction(project.miseEnProduction, {
              base: baseProduction,
              prompt: promptProduction,
            }),
            type: typeCible,
            ssh: typeCible === 'ssh' ? accesSSH : undefined,
            ftp: typeCible === 'ftp' ? accesFTP : undefined,
            prodUrl: prodUrl.trim() || undefined,
          },
          billing: clientId
            ? {
                clientId,
                clientName: chosen?.name,
                companyId: chosen?.companyId,
                companyName: chosen?.companySlug ?? chosen?.companyName,
                hourlyRate: Number(rate) || 130,
                currency: 'CHF',
                defaultDocumentId: documentId || undefined,
                defaultDocumentType: documentId ? documentType : undefined,
              }
            : undefined,
        },
      });
      client.pushToast('success', 'Réglages du projet enregistrés');
      onClose();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'enregistrement impossible');
    } finally {
      setSaving(false);
    }
  };

  /*
   * Fabriquer le prompt à partir du concept écrit à la main : un tour d'agent
   * PAYANT, qui ne persiste RIEN et ne déploie RIEN. Le texte revient dans le
   * champ modifiable ; seul « Enregistrer » le retient.
   */
  const genererPrompt = async () => {
    if (!baseProduction.trim()) {
      client.pushToast('error', 'Écrivez d’abord ce que vous attendez de la mise en production.');
      return;
    }
    setGeneration(true);
    try {
      // Un tour d'agent peut être long : on laisse dix minutes.
      const res = await client.call<{ ok: boolean; prompt?: string; raison?: string }>(
        { type: 'production.generer', projectId: project.id, base: baseProduction },
        600000,
      );
      if (res.ok && res.prompt) {
        setPromptProduction(res.prompt);
        client.pushToast('success', 'Prompt rédigé. Relisez-le, puis enregistrez.');
      } else {
        client.pushToast('error', res.raison ?? 'la génération n’a rien rendu');
      }
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'génération impossible');
    } finally {
      setGeneration(false);
    }
  };

  const archive = async () => {
    await client.call({ type: 'project.archive', id: project.id, archived: !project.archived });
    onClose();
  };

  const remove = async () => {
    await client.call({ type: 'project.delete', id: project.id });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="sm:w-[min(560px,100%)]">
        <DialogTitle>Réglages du projet</DialogTitle>
        <Filet zone="Réglages du projet" onReprendre={onClose}>

        <div className="mt-4 space-y-3">
          <div>
            <Label>Nom</Label>
            <Input value={name} onChange={(event) => setName(event.target.value)} className="mt-1" />
          </div>

          <div>
            <Label>Moteur par défaut de ce projet</Label>
            <select
              value={engine}
              onChange={(event) => setEngine(event.target.value)}
              className="mt-1 h-8 w-full rounded-md border border-border bg-raised px-2 text-[14.5px] text-text"
            >
              {state.engines
                .filter((e) => e.installed)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
            </select>
            <p className="mt-1 text-[12.5px] text-faint">
              Les nouvelles cartes et le chef de ce projet partiront sur ce moteur.
            </p>
          </div>

          <div className="rounded-md border border-border bg-surface px-2.5 py-2 text-[13px] text-faint">
            Dossier sur le serveur : <span className="text-muted">{project.path}</span>
            {project.gitRemote ? (
              <>
                <br />
                Dépôt : <span className="text-muted">{project.gitRemote}</span>
              </>
            ) : null}
          </div>

          {/* ---------- Publication ---------- */}
          <div data-deploiement>
            <h3 className="mb-1.5 flex items-center gap-1.5 text-[13.5px] font-medium text-text">
              <Rocket className="h-3.5 w-3.5 text-faint" /> Déploiement
            </h3>
            <p className="mb-2 text-[12.5px] leading-snug text-faint">
              Déployer fusionne les branches des cartes, enregistre, envoie sur le dépôt, puis rafraîchit l'instance de
              dev de ce projet sur le serveur. Rien d'autre à régler : HaikoDev reconnaît tout seul la construction et
              le service à relancer.
            </p>

            <div>
              <Label>Adresse à contrôler</Label>
              <div className="mt-1 flex items-center gap-1.5">
                <Input
                  value={devUrl}
                  onChange={(event) => setDevUrl(event.target.value)}
                  className="flex-1"
                  data-url-dev
                  placeholder="https://mon-projet.haikostudio.cloud"
                />
                {project ? (
                  <button
                    type="button"
                    data-favicon-retry
                    disabled={faviconEnCours}
                    title="Aller rechercher l'icône du site : sur cette adresse, ou dans le dépôt du projet"
                    onClick={() => {
                      setFaviconEnCours(true);
                      client
                        .call({ type: 'project.faviconRetry', id: project.id }, 15000)
                        .catch(() => {})
                        .finally(() => setFaviconEnCours(false));
                    }}
                    className="flex shrink-0 items-center gap-1 rounded-md border border-border bg-surface px-2 py-1.5 text-[12.5px] text-muted hover:text-text disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${faviconEnCours ? 'animate-spin' : ''}`} />
                    Icône
                  </button>
                ) : null}
              </div>
              <p className="mt-1 text-[11.5px] text-faint">
                Elle est remplie toute seule à la création du projet, et se corrige ici à la main. Elle est ouverte à la
                fin de chaque déploiement : si elle ne répond pas, le déploiement est déclaré en échec. Laissée vide,
                aucune adresse n'est contrôlée. Le bouton « Icône » relance la récupération du favicon de la colonne de
                gauche, sans attendre la révision automatique : sur cette adresse quand elle est remplie, et sinon dans
                le dépôt du projet (public/favicon.svg, favicon.ico…).
              </p>
            </div>

            <div className="mt-2">
              <ChoixDeBranche
                repere="data-branche-dev"
                titre="Branche du déploiement"
                valeur={brancheDev}
                onChange={setBrancheDev}
                branches={branches}
                enCours={branchesEnCours}
                raison={branchesRaison}
                mention={mentionBrancheParDefaut('dev', branches)}
              />
            </div>

          </div>

          {/* ---------- Mise en production ---------- */}
          {/*
            UN SEUL endroit, UN SEUL texte. Le concept écrit dans vos mots, un
            bouton qui en fabrique le prompt par un agent, et le prompt obtenu
            modifiable puis enregistré. C'est ce prompt que le bouton de mise en
            production suit, la fusion et l'envoi restant à HaikoDev.
          */}
          <div data-mise-en-production>
            <h3 className="mb-1.5 flex items-center gap-1.5 text-[13.5px] font-medium text-text">
              <Rocket className="h-3.5 w-3.5 text-faint" /> {TITRE_MISE_EN_PRODUCTION}
            </h3>
            <p className="mb-2 text-[12.5px] leading-snug text-faint">
              Choisissez comment le code part chez le client : un projet local n'a nulle part où
              l'envoyer, la plupart des hébergements se déposent par SSH ou par FTP, et « Consigne
              libre » confie le travail à un agent qui suit un texte écrit à la main.
            </p>

            <div className="mb-2 grid grid-cols-2 gap-1.5" data-type-cible-production>
              {(
                [
                  ['aucune', 'Aucune (projet local)'],
                  ['ssh', 'Serveur SSH'],
                  ['ftp', 'Serveur FTP'],
                  ['consigne', 'Consigne libre'],
                ] as [TypeCibleMiseEnProduction, string][]
              ).map(([valeur, libelle]) => (
                <button
                  key={valeur}
                  type="button"
                  data-type-cible={valeur}
                  onClick={() => setTypeCible(valeur)}
                  className={`rounded-md border px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                    typeCible === valeur
                      ? 'border-en-cours bg-en-cours/10 text-text'
                      : 'border-border bg-surface text-muted hover:text-text'
                  }`}
                >
                  {libelle}
                </button>
              ))}
            </div>
            <p className="mb-2 text-[12px] leading-snug text-faint" data-mention-cible-production>
              {mentionCibleMiseEnProduction({ type: typeCible, ssh: accesSSH, ftp: accesFTP })}
            </p>

            <p
              data-rappel-production
              className="flex items-start gap-1.5 rounded-md border border-border bg-surface px-2.5 py-2 text-[12.5px] leading-snug text-faint"
            >
              <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{rappelDeMiseEnProduction({ ...project, devUrl: devUrl.trim() || undefined })}</span>
            </p>

            <div className="mt-2">
              <ChoixDeBranche
                repere="data-branche-production"
                titre="Branche de la mise en production"
                valeur={brancheProduction}
                onChange={setBrancheProduction}
                branches={branches}
                enCours={branchesEnCours}
                raison={branchesRaison}
                mention={mentionBrancheParDefaut('production', branches)}
              />
            </div>

            {typeCible === 'aucune' ? (
              <p className="mt-2 rounded-md border border-border bg-surface px-2.5 py-2 text-[12.5px] leading-snug text-faint" data-cible-aucune>
                Projet local : la mise en production fusionne, enregistre et envoie le lot sur le dépôt,
                mais rien n'est transféré ailleurs. Le bouton « Tout publier » n'est jamais bloqué par ce
                type.
              </p>
            ) : null}

            {typeCible === 'ssh' ? (
              <FormulaireAccesSSH acces={accesSSH} onChange={setAccesSSH} disabled={saving} />
            ) : null}

            {typeCible === 'ftp' ? (
              <FormulaireAccesFTP acces={accesFTP} onChange={setAccesFTP} disabled={saving} />
            ) : null}

            {typeCible === 'ssh' || typeCible === 'ftp' ? (
              <div className="mt-2">
                <Label>Adresse à contrôler après le transfert</Label>
                <Input
                  value={prodUrl}
                  onChange={(event) => setProdUrl(event.target.value)}
                  className="mt-1"
                  data-url-prod
                  placeholder="https://mon-projet.exemple.com"
                />
                <p className="mt-1 text-[11.5px] text-faint">
                  Ouverte à la fin du transfert, comme l'adresse de dev en fin de déploiement. Laissée
                  vide, aucune adresse n'est contrôlée.
                </p>
              </div>
            ) : null}

            {typeCible === 'consigne' ? (
              <>
                <div className="mt-2">
                  <Label>Ce que vous attendez, dans vos mots</Label>
                  <Textarea
                    data-base-production
                    value={baseProduction}
                    maxLength={PROMPT_PRODUCTION_MAX}
                    disabled={generation || saving}
                    onChange={(event) => setBaseProduction(event.target.value)}
                    placeholder={
                      'Sans soigner la formulation : où le site tourne, comment le code y arrive, ce qu’il faut relancer, à quoi on voit que c’est en ligne.\n' +
                      'Dites aussi ce qu’il ne faut PAS faire.'
                    }
                    className="mt-1 min-h-[120px]"
                  />
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <p className="text-[12.5px] leading-snug text-faint">
                      Générer confie ce texte à un agent qui rédige le prompt final. C’est un tour d’agent :
                      cela consomme du quota, mais ne déploie rien.
                    </p>
                    <Button
                      data-generer-production
                      variant="subtle"
                      onClick={genererPrompt}
                      disabled={generation || saving || !baseProduction.trim()}
                      className="shrink-0 gap-1.5"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {generation ? 'Génération…' : 'Générer'}
                    </Button>
                  </div>
                </div>

                <div className="mt-2">
                  <Label>Prompt donné à l’agent de mise en production</Label>
                  <Textarea
                    data-prompt-production
                    value={promptProduction}
                    maxLength={PROMPT_PRODUCTION_MAX}
                    disabled={generation || saving}
                    onChange={(event) => setPromptProduction(event.target.value)}
                    placeholder={
                      generation
                        ? 'Rédaction en cours…'
                        : 'Le prompt rédigé apparaîtra ici. Vous pouvez aussi l’écrire ou le corriger à la main.'
                    }
                    className="mt-1 min-h-[150px]"
                  />
                  <p className="mt-1 text-[12.5px] leading-snug text-faint" data-mention-production>
                    {mentionMiseEnProduction(promptProduction)} Laissé vide, aucune mise en production ne part :
                    le bouton « Tout publier » de la colonne « En production » reste éteint et renvoie ici. Le
                    déploiement sur l’instance de dev, lui, n’a jamais besoin de ce prompt.
                  </p>
                </div>
              </>
            ) : null}
          </div>

          {/* ---------- Client ---------- */}
          <div>
            <h3 className="mb-1.5 flex items-center gap-1.5 text-[13.5px] font-medium text-text">
              <CircleDollarSign className="h-3.5 w-3.5 text-faint" /> Client et tarif
            </h3>

            {ecartChiffrage ? (
              <p className="mb-2 text-[12.5px] leading-snug text-faint">
                Sur les {ecartChiffrage.count} dernières cartes mesurées, le travail réel a pris en moyenne{' '}
                {Math.round(ecartChiffrage.ratioMoyen * 100)} % du temps annoncé au chiffrage.
              </p>
            ) : null}

            {loading ? (
              <p className="flex items-center gap-1.5 text-[13.5px] text-faint">
                <Loader2 className="h-3 w-3 animate-spin" /> Lecture des clients…
              </p>
            ) : available ? (
              <>
                <Label>Client facturé</Label>
                <select
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                  className="mt-1 h-8 w-full rounded-md border border-border bg-raised px-2 text-[14.5px] text-text"
                >
                  <option value="">Aucun client relié</option>
                  {clients.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name} {entry.companyName ? `— ${entry.companyName}` : ''}
                    </option>
                  ))}
                </select>

                <div className="mt-2">
                  <Label className="block">Tarif horaire</Label>
                  <Input
                    value={rate}
                    onChange={(event) => setRate(event.target.value.replace(',', '.'))}
                    className="mt-1.5"
                    inputMode="decimal"
                  />
                  <p className="mt-1 text-[12.5px] text-faint">
                    Trois heures de travail seraient facturées {money((Number(rate) || 0) * 3)}.
                  </p>
                </div>

                {clientId ? (
                  <div className="mt-3 space-y-3">
                    <div>
                      <Label className="block">Document par défaut</Label>
                      <select
                        value={documentType}
                        onChange={(event) => setDocumentType(event.target.value as 'offer' | 'invoice')}
                        className="mt-1.5 h-9 w-full rounded-md border border-border bg-raised px-2 text-[14.5px] text-text"
                      >
                        <option value="invoice">Facture</option>
                        <option value="offer">Offre</option>
                      </select>
                    </div>
                    <div>
                      <Label className="block">Lequel</Label>
                      <select
                        value={documentId}
                        onChange={(event) => setDocumentId(event.target.value)}
                        className="mt-1.5 h-9 w-full rounded-md border border-border bg-raised px-2 text-[14.5px] text-text"
                      >
                        <option value="">Nouveau à chaque fois</option>
                        {documents
                          .filter((doc) => doc.type === documentType)
                          .map((doc) => (
                            <option key={doc.id} value={doc.id}>
                              {doc.number ?? doc.id} — {doc.title ?? 'sans titre'}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>
                ) : null}

                <p className="mt-1.5 text-[12.5px] leading-snug text-faint">
                  Une fois le client relié, chaque carte propose d'ajouter sa ligne au document en un clic. Les montants
                  restent calculés par l'outil de facturation, jamais ici.
                </p>
              </>
            ) : (
              <p className="text-[13.5px] text-faint">L'outil de facturation n'est pas joignable depuis ce serveur.</p>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={archive}>
            <Archive className="h-3 w-3" />
            {project.archived ? 'Remettre en service' : 'Mettre de côté'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirmSuppression(true)} className="text-danger hover:text-danger">
            <Trash2 className="h-3 w-3" /> Effacer
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="default" size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            Enregistrer
          </Button>
        </div>
        </Filet>
      </DialogContent>

      <ConfirmDialog
        open={confirmSuppression}
        title={`Effacer « ${project.name} » de HaikoDev ?`}
        description="Son tableau et ses conversations partent avec. Le dossier sur le serveur, lui, n'est pas touché. Pour simplement le ranger de côté, utilisez « Mettre de côté »."
        confirmLabel="Effacer"
        danger
        onConfirm={remove}
        onClose={() => setConfirmSuppression(false)}
      />
    </Dialog>
  );
}
