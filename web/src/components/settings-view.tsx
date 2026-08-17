import * as React from 'react';
import {
  Activity,
  Brain,
  Bug,
  Copy,
  Database,
  KeyRound,
  Loader2,
  LogIn,
  Pencil,
  Play,
  Plus,
  Power,
  RefreshCw,
  Save,
  Send,
  Server,
  ShieldCheck,
  ShieldOff,
  Wifi,
  Trash2,
  Volume2,
  GraduationCap,
  Archive,
  ArrowDownCircle,
  Image as ImageIcon,
} from 'lucide-react';
import {
  AccountQuota,
  COLUMN_KEYS,
  COLUMN_LABELS,
  type ColumnKey,
  imageDuPersonnage,
  CRANS_DE_VITESSE,
  CleApiPublique,
  NOM_CLE_MAX,
  PREFIXE_CLE_API,
  ROUTE_CARTE_EXTERNE,
  ROUTE_DOC_API,
  ConnexionCompte,
  jugerNomDeCle,
  formeDepuisEvenement,
  libelleDeRaccourci,
  raisonRaccourciRefuse,
  ERREURS_MONTREES_REGLAGES,
  EngineId,
  EtatDuPool,
  ErreurInterface,
  EtatCerveau,
  EtatCompteCursor,
  moteurSansQuota,
  SystemProcess,
  appareilEnClair,
  connexionTerminee,
  montantCursorEnClair,
  periodeDuCreditCursor,
  usageCursorEnClair,
  type CreditCursor,
  erreursUtiles,
  ligneEtatCerveau,
  origineEnClair,
  validerCleCerveau,
  detailDesAgents,
  partMemoire,
  phraseCapacite,
  tauxOccupation,
  tempsRestant,
  tonCapacite,
} from '@haikodev/shared';
import {
  Badge,
  Button,
  ConfirmDialog,
  DialogTitle,
  Drawer,
  Gauge,
  Input,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  ZoneDefilement,
} from '@/components/ui';
import { Champ } from '@/components/card-panel';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { bytes, cn, elapsed, relativeTime } from '@/lib/utils';

/**
 * Les réglages s'ouvrent en TIROIR, comme les cartes : même geste pour
 * refermer, même place à l'écran. Leur contenu est réparti en onglets — tout
 * empilé, la page faisait deux mètres de long et plus personne ne trouvait
 * rien.
 */
export function SettingsView({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Drawer open={open} onClose={onClose}>
      <SettingsBody open={open} />
    </Drawer>
  );
}

const ONGLETS = [
  { cle: 'systeme', titre: 'Système' },
  { cle: 'fonctionnement', titre: 'Fonctionnement' },
  { cle: 'comptes', titre: 'Comptes' },
  { cle: 'voix', titre: 'Voix' },
  { cle: 'consommation', titre: 'Consommation' },
  { cle: 'sauvegardes', titre: 'Sauvegardes' },
  { cle: 'acces-api', titre: 'Accès API' },
  { cle: 'competences', titre: 'Compétences' },
  { cle: 'personnages', titre: 'Personnages' },
] as const;

function SettingsBody({ open }: { open: boolean }) {
  const state = useApp();
  const [onglet, setOnglet] = React.useState<string>('systeme');
  const [history, setHistory] = React.useState<{ at: number; loadPct: number; running: number }[]>([]);

  React.useEffect(() => {
    if (!open) return;
    client.send({ type: 'capacity.processes' });
    client.call<{ history: typeof history }>({ type: 'capacity.history' }).then((data) => setHistory(data.history ?? []));
    const timer = setInterval(() => client.send({ type: 'capacity.processes' }), 5000);
    return () => clearInterval(timer);
  }, [open]);

  const settings = state.settings;
  const update = (patch: Record<string, unknown>) => client.send({ type: 'settings.update', patch });

  return (
    <>
      <header className="shrink-0 border-b border-border px-4 pb-2">
        <DialogTitle>Réglages</DialogTitle>
      </header>

      <Tabs value={onglet} onValueChange={setOnglet} className="flex min-h-0 flex-1 flex-col">
        {/* Six onglets ne tiennent pas sur la largeur d'un téléphone : la barre
            défile horizontalement plutôt que de se replier en deux lignes. */}
        <ZoneDefilement axe="horizontal" classeEnveloppe="flex-none" className="px-4 py-2">
          <TabsList>
            {ONGLETS.map((item) => (
              <TabsTrigger key={item.cle} value={item.cle} className="whitespace-nowrap">
                {item.titre}
              </TabsTrigger>
            ))}
          </TabsList>
        </ZoneDefilement>

        <TabsContent value="systeme" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
        <ZoneDefilement className="p-4">
          <SectionSysteme history={history} />
        </ZoneDefilement>
        </TabsContent>

        <TabsContent value="fonctionnement" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
        <ZoneDefilement className="p-4">
          {settings ? <SectionFonctionnement settings={settings} update={update} /> : null}
        </ZoneDefilement>
        </TabsContent>

        <TabsContent value="comptes" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
        <ZoneDefilement className="p-4">
          <SectionComptes />
        </ZoneDefilement>
        </TabsContent>

        <TabsContent value="voix" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
        <ZoneDefilement className="p-4">
          <VoiceSection open={open && onglet === 'voix'} />
        </ZoneDefilement>
        </TabsContent>

        <TabsContent value="consommation" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
        <ZoneDefilement className="p-4">
          <UsageSection open={open && onglet === 'consommation'} />
        </ZoneDefilement>
        </TabsContent>

        <TabsContent value="sauvegardes" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
        <ZoneDefilement className="p-4">
          <SectionSauvegardes open={open && onglet === 'sauvegardes'} />
        </ZoneDefilement>
        </TabsContent>

        <TabsContent value="acces-api" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
        <ZoneDefilement className="p-4">
          <SectionClesApi open={open && onglet === 'acces-api'} />
        </ZoneDefilement>
        </TabsContent>

        <TabsContent value="competences" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
        <ZoneDefilement className="p-4">
          <SectionCompetences open={open && onglet === 'competences'} />
        </ZoneDefilement>
        </TabsContent>

        <TabsContent value="personnages" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
        <ZoneDefilement className="p-4">
          <SectionPersonnages />
        </ZoneDefilement>
        </TabsContent>
      </Tabs>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Système : la place restante, puis ce qui tourne                     */
/* ------------------------------------------------------------------ */

function SectionSysteme({ history }: { history: { at: number; loadPct: number }[] }) {
  const state = useApp();
  const capacity = state.capacity;
  const [busy, setBusy] = React.useState<string | null>(null);
  const [aConfirmer, setAConfirmer] = React.useState<SystemProcess | null>(null);

  const appliquer = async (cible: SystemProcess) => {
    setBusy(cible.id);
    try {
      const result = await client.call<{ ok: boolean; error?: string }>({
        type: cible.running ? 'process.stop' : 'process.start',
        id: cible.id,
      });
      if (!result.ok) client.pushToast('error', result.error ?? 'opération refusée');
      else client.send({ type: 'capacity.processes' });
    } finally {
      setBusy(null);
    }
  };

  /*
   * La barre ne montre QUE la place restante. Elle suivait la charge
   * processeur, plafonnée à cent : sur ce serveur elle était donc rouge et
   * pleine en permanence, pendant qu'il restait quatorze places libres.
   */
  const occupation = capacity ? tauxOccupation(capacity) : 0;
  const ton = capacity ? tonCapacite(capacity) : 'libre';
  const memoire = capacity ? partMemoire(capacity.memUsedMb, capacity.memTotalMb) : 0;

  return (
    <>
      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-medium text-text">
          <Activity className="h-3.5 w-3.5 text-faint" /> Capacité du système
        </h3>

        {capacity ? (
          <>
            <Gauge value={occupation} height="h-2" />
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-[17px] font-semibold text-text">{phraseCapacite(capacity)}</span>
              <span className="text-[12.5px] text-faint">
                {detailDesAgents(capacity)} · plafond {capacity.maxAgents} · mémoire moyenne mesurée{' '}
                {capacity.avgAgentMemMb} Mo
              </span>
            </div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-faint">
              La barre montre les places d'agents occupées, rien d'autre : elle ne devient rouge que lorsqu'aucun agent
              ne peut plus démarrer, faute de mémoire ou de place sous le plafond.
            </p>

            {/* Le manque de place et le frein processeur sont DEUX choses : on
                ne dit plus « plus aucun agent ne peut démarrer » pour une
                pointe de charge d'une minute. */}
            {ton === 'tendu' && !capacity.loadHoldReason ? (
              <p className="mt-1.5 rounded-md border border-warning/30 bg-warning/5 px-2 py-1 text-[13px] text-warning">
                Il ne reste presque plus de place : les prochaines tâches attendront leur tour.
              </p>
            ) : null}
            {capacity.loadHoldReason ? (
              <p className="mt-1.5 rounded-md border border-warning/30 bg-warning/5 px-2 py-1 text-[13px] text-warning">
                {capacity.loadHoldReason}
              </p>
            ) : null}
            {capacity.paused ? (
              <p className="mt-1.5 rounded-md border border-warning/30 bg-warning/5 px-2 py-1 text-[13px] text-warning">
                {capacity.pauseReason}
              </p>
            ) : null}

            {/* Mémoire et processeur restent lisibles, mais comme des mesures,
                pas comme un remplissage : c'est la mémoire qui décide de la
                place, la charge ne fait que freiner au-delà d'une vraie file. */}
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Mesure
                titre="Mémoire utilisée"
                valeur={`${memoire} %`}
                detail={`${gigas(capacity.memUsedMb)} sur ${gigas(capacity.memTotalMb)}`}
              />
              <Mesure
                titre="Charge processeur"
                valeur={`${Math.round(capacity.cpuLoadPct ?? capacity.loadPct)} %`}
                detail={
                  capacity.cpuLoadSustainedPct === undefined
                    ? `${capacity.cpuCount} cœurs`
                    : `${capacity.cpuCount} cœurs — ${Math.round(
                        capacity.cpuLoadSustainedPct,
                      )} % sur un quart d'heure, et c'est ce chiffre-là qui freine les départs`
                }
              />
            </div>

            {history.length > 3 ? <Sparkline points={history} /> : null}
          </>
        ) : null}
      </section>

      <section className="mt-4">
        <p className="mb-1 text-[12px] uppercase tracking-wide text-faint">Ce qui tourne en ce moment</p>
        <div className="space-y-0.5">
          {state.processes.map((process) => (
            <div
              key={process.id}
              className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5"
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  // Un agent qui tourne suit la convention : ORANGE.
                  process.running ? (process.kind === 'agent' ? 'bg-en-cours' : 'bg-muted') : 'bg-faint',
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] text-text">{process.label}</p>
                <p className="truncate text-[11.5px] text-faint">
                  {process.detail}
                  {process.since ? ` · ${elapsed(process.since)}` : ''}
                </p>
              </div>
              <span className="shrink-0 text-[12.5px] text-muted">{process.memMb} Mo</span>
              {process.canStop ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setAConfirmer(process)}
                  disabled={busy === process.id}
                >
                  {busy === process.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : process.running ? (
                    <Power className="h-3 w-3" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                </Button>
              ) : (
                <Tooltip label="HaikoDev ne peut pas s'éteindre depuis sa propre interface">
                  <span className="px-1.5 text-faint">
                    <ShieldCheck className="h-3 w-3" />
                  </span>
                </Tooltip>
              )}
            </div>
          ))}
        </div>
      </section>

      <SectionAccesVps />

      <SectionCerveau />

      <SectionErreursInterface />

      <ConfirmDialog
        open={!!aConfirmer}
        title={aConfirmer?.running ? `Arrêter « ${aConfirmer.label} » ?` : `Démarrer « ${aConfirmer?.label} » ?`}
        description={
          aConfirmer?.running
            ? 'Le service s’arrête tout de suite. Ce qu’il servait devient injoignable jusqu’au redémarrage.'
            : 'Le service redémarre avec sa commande habituelle.'
        }
        confirmLabel={aConfirmer?.running ? 'Arrêter' : 'Démarrer'}
        danger={aConfirmer?.running}
        onConfirm={async () => {
          if (aConfirmer) await appliquer(aConfirmer);
        }}
        onClose={() => setAConfirmer(null)}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Les accès à la machine (le VPS)                                      */
/* ------------------------------------------------------------------ */

const MOYENS_ACCES_VPS: { id: 'agent' | 'cle' | 'mot-de-passe'; libelle: string }[] = [
  { id: 'agent', libelle: 'Clés SSH déjà en place' },
  { id: 'cle', libelle: 'Fichier de clé privée' },
  { id: 'mot-de-passe', libelle: 'Mot de passe' },
];

/**
 * Ce qui touche à HaikoDev lui-même — la machine où il tourne — se règle ICI,
 * jamais dans les réglages d'un projet. Renseignés, ces accès servent à créer
 * une adresse publique sur la machine distante ; laissés vides, la création
 * d'adresse garde son fonctionnement local d'aujourd'hui.
 */
function SectionAccesVps() {
  const settings = useApp().settings;
  const [hote, setHote] = React.useState('');
  const [port, setPort] = React.useState('22');
  const [utilisateur, setUtilisateur] = React.useState('');
  const [moyen, setMoyen] = React.useState<'agent' | 'cle' | 'mot-de-passe'>('agent');
  const [cle, setCle] = React.useState('');
  const [motDePasse, setMotDePasse] = React.useState('');
  const [enregistre, setEnregistre] = React.useState(false);
  const [testEnCours, setTestEnCours] = React.useState(false);
  const [resultat, setResultat] = React.useState<{ ok: boolean; message: string } | null>(null);

  // Les champs partent des réglages du serveur et les rejoignent au rechargement.
  React.useEffect(() => {
    if (!settings) return;
    setHote(settings.vpsHote ?? '');
    setPort(String(settings.vpsPort ?? 22));
    setUtilisateur(settings.vpsUtilisateur ?? '');
    setMoyen((settings.vpsMoyen as any) ?? 'agent');
    setCle(settings.vpsCle ?? '');
    setMotDePasse(settings.vpsMotDePasse ?? '');
  }, [settings?.vpsHote, settings?.vpsPort, settings?.vpsUtilisateur, settings?.vpsMoyen, settings?.vpsCle, settings?.vpsMotDePasse]);

  const patch = () => ({
    vpsHote: hote.trim(),
    vpsPort: Number.parseInt(port, 10) || 22,
    vpsUtilisateur: utilisateur.trim(),
    vpsMoyen: moyen,
    vpsCle: cle.trim(),
    vpsMotDePasse: motDePasse,
  });

  const enregistrer = () => {
    client.send({ type: 'settings.update', patch: patch() });
    setEnregistre(true);
    window.setTimeout(() => setEnregistre(false), 1600);
  };

  const tester = async () => {
    setResultat(null);
    setTestEnCours(true);
    try {
      // On teste ce qui est à l'écran : on l'enregistre d'abord, puis le serveur
      // éprouve les accès qu'il vient de recevoir (même connexion, dans l'ordre).
      client.send({ type: 'settings.update', patch: patch() });
      const data = await client.call<{ ok: boolean; message: string }>({ type: 'vps.test' });
      setResultat(data);
    } catch (err: any) {
      setResultat({ ok: false, message: err?.message ?? 'test impossible' });
    } finally {
      setTestEnCours(false);
    }
  };

  return (
    <section className="mt-4" data-bloc-vps>
      <h3 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-medium text-text">
        <Server className="h-3.5 w-3.5 text-faint" /> Accès au VPS
      </h3>

      <p className="mb-2 text-[12.5px] leading-relaxed text-faint">
        La machine sur laquelle tourne HaikoDev. Renseignés, ces accès servent à créer une adresse publique ; laissés
        vides, la création d'adresse reste locale, comme aujourd'hui.
      </p>

      <div className="rounded-md border border-border bg-surface px-2.5 py-2.5">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="mb-0.5 block text-[12px] text-faint">Adresse de la machine</span>
            <Input
              value={hote}
              onChange={(e) => setHote(e.target.value)}
              placeholder="ex. 203.0.113.10"
              className="h-7 w-full text-[12.5px]"
              autoComplete="off"
            />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[12px] text-faint">Port</span>
            <Input
              value={port}
              onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="22"
              inputMode="numeric"
              className="h-7 w-full text-[12.5px]"
              autoComplete="off"
            />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[12px] text-faint">Utilisateur</span>
            <Input
              value={utilisateur}
              onChange={(e) => setUtilisateur(e.target.value)}
              placeholder="ex. root"
              className="h-7 w-full text-[12.5px]"
              autoComplete="off"
            />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[12px] text-faint">Moyen de connexion</span>
            <select
              value={moyen}
              onChange={(e) => setMoyen(e.target.value as any)}
              className="h-7 w-full rounded-md border border-border bg-bg px-2 text-[12.5px] text-text"
            >
              {MOYENS_ACCES_VPS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.libelle}
                </option>
              ))}
            </select>
          </label>
        </div>

        {moyen === 'cle' ? (
          <label className="mt-2 block">
            <span className="mb-0.5 block text-[12px] text-faint">Chemin du fichier de clé privée</span>
            <Input
              value={cle}
              onChange={(e) => setCle(e.target.value)}
              placeholder="ex. /root/.ssh/id_ed25519"
              className="h-7 w-full text-[12.5px]"
              autoComplete="off"
            />
          </label>
        ) : null}

        {moyen === 'mot-de-passe' ? (
          <label className="mt-2 block">
            <span className="mb-0.5 block text-[12px] text-faint">Mot de passe</span>
            <Input
              type="password"
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              placeholder="Mot de passe de la machine"
              className="h-7 w-full text-[12.5px]"
              autoComplete="off"
            />
          </label>
        ) : null}

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Button variant="secondary" size="sm" onClick={enregistrer}>
            {enregistre ? <ShieldCheck className="h-3 w-3 text-success" /> : <Save className="h-3 w-3" />}
            {enregistre ? 'Enregistré' : 'Enregistrer'}
          </Button>
          <Button variant="secondary" size="sm" onClick={tester} disabled={testEnCours}>
            {testEnCours ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wifi className="h-3 w-3" />}
            Tester la connexion
          </Button>
        </div>

        {resultat ? (
          <p className={cn('mt-2 text-[13px]', resultat.ok ? 'text-success' : 'text-danger')}>{resultat.message}</p>
        ) : null}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* La liaison au cerveau : ce que les projets lui envoient chaque jour  */
/* ------------------------------------------------------------------ */

/**
 * Chaque jour, la mémoire et les instructions de chaque projet partent au
 * cerveau. C'est un mécanisme silencieux : sans un endroit où le lire, on ne
 * saurait jamais s'il tourne encore.
 *
 * Le bloc dit UNE chose à la fois (`ligneEtatCerveau`) et propose le geste qui
 * débloque : quand la clé manque, elle se pose ICI — il disait trois fois le
 * même problème sans jamais offrir de le régler.
 */
function SectionCerveau() {
  const [etat, setEtat] = React.useState<EtatCerveau | null>(null);
  const [enCours, setEnCours] = React.useState(false);
  const [cle, setCle] = React.useState('');
  const [pose, setPose] = React.useState(false);

  React.useEffect(() => {
    client.call<{ etat: EtatCerveau }>({ type: 'cerveau.etat' }).then((data) => setEtat(data.etat ?? null));
  }, []);

  const poserLaCle = async () => {
    const juge = validerCleCerveau(cle);
    if (!juge.ok) {
      client.pushToast('error', juge.raison);
      return;
    }
    setPose(true);
    try {
      const data = await client.call<{ pose: { ok: boolean; raison?: string }; etat: EtatCerveau }>({
        type: 'cerveau.cle',
        cle: juge.cle,
      });
      setEtat(data.etat ?? null);
      if (data.pose?.ok) {
        setCle('');
        client.pushToast('success', 'Clé posée : les envois peuvent partir.');
      } else {
        client.pushToast('error', data.pose?.raison ?? 'clé non enregistrée');
      }
    } finally {
      setPose(false);
    }
  };

  const envoyer = async () => {
    setEnCours(true);
    try {
      const data = await client.call<{
        etat: EtatCerveau;
        resultat: { envoye: boolean; projets: number; fichiers: number; raison?: string };
      }>({ type: 'cerveau.envoyer' });
      setEtat(data.etat ?? null);
      if (data.resultat?.envoye) {
        client.pushToast(
          'success',
          data.resultat.fichiers
            ? `${data.resultat.fichiers} fichier(s) envoyé(s) pour ${data.resultat.projets} projet(s)`
            : 'Rien de nouveau à envoyer : le cerveau est déjà à jour',
        );
      } else {
        client.pushToast('error', data.resultat?.raison ?? 'envoi impossible');
      }
    } finally {
      setEnCours(false);
    }
  };

  const ligne = ligneEtatCerveau(etat, relativeTime);
  const erreurs = erreursUtiles(etat);

  return (
    <section className="mt-4">
      <h3 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-medium text-text">
        <Brain className="h-3.5 w-3.5 text-faint" /> Mémoire envoyée au cerveau
      </h3>

      <p className="mb-2 text-[12.5px] leading-relaxed text-faint">
        Chaque nuit, chaque projet vivant envoie sa mémoire et ses instructions à {etat?.adresse ?? 'ce service'}.
      </p>

      <div className="rounded-md border border-border bg-surface px-2.5 py-2">
        <p
          className={cn(
            'text-[13px]',
            ligne.ton === 'ok' && 'text-text',
            ligne.ton === 'attente' && 'text-warning',
            ligne.ton === 'probleme' && 'text-danger',
          )}
        >
          {ligne.texte}
        </p>

        {ligne.besoinDeCle ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Input
              type="password"
              value={cle}
              onChange={(e) => setCle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void poserLaCle();
              }}
              placeholder="Clé du cerveau"
              className="h-7 w-56 text-[12.5px]"
              autoComplete="off"
            />
            <Button variant="secondary" size="sm" onClick={poserLaCle} disabled={pose || !cle.trim()}>
              {pose ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Enregistrer
            </Button>
          </div>
        ) : (
          <Button variant="secondary" size="sm" className="mt-2" onClick={envoyer} disabled={enCours}>
            {enCours ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            Envoyer maintenant
          </Button>
        )}

        {erreurs.length ? (
          <div className="mt-2 space-y-0.5">
            {erreurs.map((erreur, index) => (
              <p key={`${erreur.at}-${index}`} className="text-[12.5px] text-danger">
                {relativeTime(erreur.at)}
                {erreur.projet ? ` · ${erreur.projet}` : ''} — {erreur.message}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Ce qui a planté dans la page, y compris sur un téléphone            */
/* ------------------------------------------------------------------ */

/**
 * Quand l'application blanchit sur un téléphone, la console du navigateur ne
 * s'ouvre pas : sans cet endroit, la panne ne laissait aucune trace. La page
 * remonte désormais ses erreurs au serveur (`POST /api/erreur`), qui les range
 * dans son journal ; ce bloc les relit, les plus récentes d'abord.
 */
function SectionErreursInterface() {
  const [erreurs, setErreurs] = React.useState<ErreurInterface[]>([]);
  const [total, setTotal] = React.useState(0);
  const [enCours, setEnCours] = React.useState(false);

  const relire = React.useCallback(async () => {
    const data = await client.call<{ erreurs: ErreurInterface[]; total: number }>({
      type: 'erreurs.liste',
      limite: ERREURS_MONTREES_REGLAGES,
    });
    setErreurs(data.erreurs ?? []);
    setTotal(data.total ?? 0);
  }, []);

  React.useEffect(() => {
    void relire().catch(() => undefined);
  }, [relire]);

  const effacer = async () => {
    setEnCours(true);
    try {
      const data = await client.call<{ ok: boolean }>({ type: 'erreurs.effacer' });
      if (data.ok) {
        setErreurs([]);
        setTotal(0);
        client.pushToast('success', 'Journal des erreurs vidé.');
      } else {
        client.pushToast('error', "Le journal n'a pas pu être vidé.");
      }
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'effacement refusé');
    } finally {
      setEnCours(false);
    }
  };

  return (
    <section className="mt-4" data-bloc-erreurs>
      <h3 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-medium text-text">
        <Bug className="h-3.5 w-3.5 text-faint" /> Dernières erreurs de l'interface
      </h3>

      <p className="mb-2 text-[12.5px] leading-relaxed text-faint">
        Ce qui a planté dans la page, sur cet ordinateur comme sur un téléphone. Rien du contenu des projets n'est
        remonté : seulement l'erreur, l'adresse de la page et l'appareil.
      </p>

      {erreurs.length ? (
        <>
          <div className="space-y-1">
            {erreurs.map((erreur, index) => (
              <div
                key={`${erreur.at}-${index}`}
                data-ligne-erreur
                className="rounded-md border border-border bg-surface px-2.5 py-1.5"
              >
                <p className="flex flex-wrap items-baseline gap-x-1.5 text-[11.5px] text-faint">
                  <span>{relativeTime(erreur.at)}</span>
                  <span>· {origineEnClair(erreur.source)}</span>
                  {erreur.zone ? <span>· {erreur.zone}</span> : null}
                  <span>· {appareilEnClair(erreur.appareil)}</span>
                </p>
                <p className="mt-0.5 break-words text-[13px] text-danger">{erreur.message}</p>
                {erreur.pile || erreur.url ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[11.5px] text-faint">Détail technique</summary>
                    {erreur.url ? <p className="mt-1 break-all text-[11.5px] text-muted">{erreur.url}</p> : null}
                    {erreur.pile ? (
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11.5px] text-muted">
                        {erreur.pile}
                      </pre>
                    ) : null}
                  </details>
                ) : null}
              </div>
            ))}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={effacer} disabled={enCours} data-effacer-erreurs>
              {enCours ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              Tout effacer
            </Button>
            {total > erreurs.length ? (
              <span className="text-[12px] text-faint">{total} erreurs au journal, {erreurs.length} affichées.</span>
            ) : null}
          </div>
        </>
      ) : (
        <p className="rounded-md border border-border bg-surface px-2.5 py-2 text-[13px] text-muted">
          Aucune erreur remontée : l'interface n'a rien cassé depuis le dernier effacement.
        </p>
      )}
    </section>
  );
}

/** Des mégaoctets par milliers ne se lisent pas : « 5,6 Go » se lit. */
function gigas(mo: number): string {
  return `${(mo / 1024).toFixed(1).replace('.', ',')} Go`;
}

/** « 2026-08 » ne se lit pas non plus : on dit le mois. */
function moisEnClair(mois: string): string {
  const [annee, numero] = mois.split('-').map(Number);
  if (!annee || !numero) return mois;
  return new Date(annee, numero - 1, 1).toLocaleDateString('fr-CH', { month: 'long', year: 'numeric' });
}

function Mesure({ titre, valeur, detail }: { titre: string; valeur: string; detail: string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-2 py-1.5">
      <p className="text-[11.5px] uppercase tracking-wide text-faint">{titre}</p>
      <p className="mt-0.5 text-[14.5px] font-medium text-text">{valeur}</p>
      <p className="mt-0.5 text-[11.5px] leading-relaxed text-faint">{detail}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fonctionnement : un réglage par ligne, chacun expliqué               */
/* ------------------------------------------------------------------ */

/**
 * Un réglage se lit à l'étiquette ET à sa phrase d'explication. Trois champs
 * côte à côte, nommés « Pendant (minutes) » ou « Alerte au-delà de (%) », ne
 * disaient plus à quoi ils se rapportaient : chaque réglage occupe maintenant
 * sa ligne, sous le titre du sujet auquel il appartient.
 */
function SectionFonctionnement({
  settings,
  update,
}: {
  settings: Record<string, any>;
  update: (patch: Record<string, unknown>) => void;
}) {
  const nombre = (valeur: string) => (valeur === '' ? undefined : Number(valeur));

  return (
    <div className="space-y-5">
      <Groupe titre="Combien d'agents en même temps">
        <Champ
          label="Plafond d'agents"
          aide="Nombre maximum d'agents qui peuvent travailler en parallèle. La mémoire disponible peut abaisser ce chiffre, jamais l'augmenter."
        >
          <Input
            type="number"
            min={1}
            max={40}
            defaultValue={settings.maxAgents}
            onBlur={(event) => update({ maxAgents: Number(event.target.value) })}
          />
        </Champ>
        <Champ
          label="Une tâche est dite « lourde » au-delà de (minutes)"
          aide="Au-delà de cette durée prévue, une tâche est repoussée aux heures creuses plutôt que lancée tout de suite."
        >
          <Input
            type="number"
            min={1}
            defaultValue={Math.round(settings.heavyTaskSeconds / 60)}
            onBlur={(event) => update({ heavyTaskSeconds: Number(event.target.value) * 60 })}
          />
        </Champ>
      </Groupe>

      <Groupe
        titre="Heures creuses"
        aide="La plage où les tâches lourdes sont lancées. Elle peut passer minuit : 22 puis 7 signifie « de 22 h à 7 h »."
      >
        <Champ label="Début (heure)" aide="De 0 à 23.">
          <Input
            type="number"
            min={0}
            max={23}
            defaultValue={settings.offPeakStart}
            onBlur={(event) => update({ offPeakStart: Number(event.target.value) })}
          />
        </Champ>
        <Champ label="Fin (heure)" aide="De 0 à 23.">
          <Input
            type="number"
            min={0}
            max={23}
            defaultValue={settings.offPeakEnd}
            onBlur={(event) => update({ offPeakEnd: Number(event.target.value) })}
          />
        </Champ>
      </Groupe>

      <Groupe titre="Alerte de surcharge" aide="Prévenir quand la machine reste tendue trop longtemps.">
        <Champ label="Prévenir quand la charge dépasse (%)" aide="Entre 50 et 100.">
          <Input
            type="number"
            min={50}
            max={100}
            defaultValue={settings.alertThresholdPct}
            onBlur={(event) => update({ alertThresholdPct: Number(event.target.value) })}
          />
        </Champ>
        <Champ
          label="…et qu'elle y reste au moins (minutes)"
          aide="Une pointe passagère ne réveille personne : il faut que la charge tienne pendant cette durée."
        >
          <Input
            type="number"
            min={1}
            defaultValue={settings.alertMinutes}
            onBlur={(event) => update({ alertMinutes: Number(event.target.value) })}
          />
        </Champ>
      </Groupe>

      <Groupe
        titre="Heures de silence"
        aide="Aucune notification pendant cette plage, et aucune fenêtre de quota amorcée. Laissez les deux champs vides pour ne jamais faire silence."
      >
        <Champ label="Début (heure)" aide="Vide = pas de silence.">
          <Input
            type="number"
            min={0}
            max={23}
            defaultValue={settings.quietHoursStart ?? ''}
            onBlur={(event) => update({ quietHoursStart: nombre(event.target.value) })}
          />
        </Champ>
        <Champ label="Fin (heure)" aide="Vide = pas de silence.">
          <Input
            type="number"
            min={0}
            max={23}
            defaultValue={settings.quietHoursEnd ?? ''}
            onBlur={(event) => update({ quietHoursEnd: nombre(event.target.value) })}
          />
        </Champ>
      </Groupe>

      <Groupe titre="Sauvegarde automatique">
        <Champ label="Heure de la sauvegarde de nuit" aide="De 0 à 23. La sauvegarde est vérifiée juste après.">
          <Input
            type="number"
            min={0}
            max={23}
            defaultValue={settings.backupHour}
            onBlur={(event) => update({ backupHour: Number(event.target.value) })}
          />
        </Champ>
      </Groupe>

      <Groupe titre="Ce dont on vous prévient">
        <div className="space-y-2">
          {(
            [
              ['notifyOnDone', 'Quand une tâche se termine'],
              ['notifyOnFailed', 'Quand une tâche échoue'],
              ['notifyOnProposal', 'Quand une tâche est proposée par un agent'],
              ['notifyOnDeploy', 'Quand une publication est finie'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-[14px] text-muted">
              <Switch checked={settings[key] as boolean} onCheckedChange={(checked) => update({ [key]: checked })} />
              {label}
            </label>
          ))}
        </div>
      </Groupe>
    </div>
  );
}

function Groupe({ titre, aide, children }: { titre: string; aide?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[13.5px] font-medium text-text">{titre}</h3>
      {aide ? <p className="mt-0.5 text-[12.5px] leading-relaxed text-faint">{aide}</p> : null}
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Comptes et quotas                                                   */
/* ------------------------------------------------------------------ */

function SectionComptes() {
  const state = useApp();
  const settings = state.settings;
  const update = (patch: Record<string, unknown>) => client.send({ type: 'settings.update', patch });

  // Les connexions déjà en cours quand on ouvre les réglages : sans cette
  // demande, une connexion lancée depuis un autre écran serait invisible ici.
  React.useEffect(() => {
    client
      .call<{ connexions: ConnexionCompte[] }>({ type: 'account.connections' })
      .then((data) => client.reprendreConnexions(data.connexions ?? []))
      .catch(() => undefined);
  }, []);

  const enCours = (accountId?: string) =>
    state.connexions.find((c) => !connexionTerminee(c) && c.accountId === accountId);

  return (
    <section>
      <div className="mb-2 flex items-center gap-1.5">
        <h3 className="flex-1 text-[13.5px] font-medium text-text">Comptes et quotas</h3>
        <Button variant="ghost" size="icon-sm" onClick={() => client.send({ type: 'quota.refresh' })}>
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      <div className="space-y-1">
        {state.quotas.map((quota) => (
          <LigneCompte key={quota.id} quota={quota} connexion={enCours(quota.id)} />
        ))}
      </div>

      <ConnecterUnCompte />

      <p className="mt-1.5 text-[12.5px] leading-relaxed text-faint">
        L'ordre de priorité suit la valeur déclarée pour chaque compte : le compte prioritaire passe toujours en premier,
        la relève ne sert qu'en cas d'épuisement.
      </p>

      {/* Les réglages n'arrivent qu'avec la réponse du serveur : avant, il
          n'y a rien à cocher — et les lire trop tôt vidait la page. */}
      <label className={cn('mt-4 flex items-center gap-2 text-[14px] text-muted', !settings && 'hidden')}>
        <Switch
          checked={settings?.primeClaudeWindow ?? false}
          onCheckedChange={(checked) => update({ primeClaudeWindow: checked })}
        />
        Lancer la fenêtre de 5 h dès qu'elle repart à zéro
      </label>
      <p className="mt-1 text-[12.5px] leading-relaxed text-faint">
        Sur Claude, la fenêtre de cinq heures ne démarre qu'au premier message. HaikoDev en envoie un minuscule dès
        qu'un compte revient à zéro, pour que le décompte tourne déjà quand le travail arrive.
      </p>
    </section>
  );
}

/**
 * Une ligne de compte dans l'onglet « Comptes » : son nom, ses quotas, ses
 * badges d'état, et le crayon qui ouvre un champ pour le RENOMMER. On ne touche
 * qu'au nom affiché ; un nom vide est refusé par le serveur et la ligne garde
 * son ancien nom.
 */
function LigneCompte({ quota, connexion }: { quota: AccountQuota; connexion?: ConnexionCompte }) {
  const [edite, setEdite] = React.useState(false);
  const [nom, setNom] = React.useState(quota.label);
  const [envoi, setEnvoi] = React.useState(false);

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
      if (!rendu.ok) client.pushToast('error', 'nom refusé');
      setEdite(false);
    } catch {
      client.pushToast('error', 'renommage impossible');
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <div className="rounded-md border border-border bg-surface px-2 py-1.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
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
                className="h-7 flex-1 text-[13.5px]"
              />
              <Button size="sm" disabled={envoi} onClick={valider}>
                {envoi ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                Valider
              </Button>
            </div>
          ) : (
            <p className="truncate text-[13.5px] text-text">
              {quota.label} {quota.plan ? <span className="text-faint">· {quota.plan}</span> : null}
            </p>
          )}
          {/* Un moteur sans fenêtre de pourcentage n'affiche pas de jauge
              5 h / semaine. À la place : état de la clé, montant dépensé. */}
          {!edite && moteurSansQuota(quota.engine) ? (
            <>
              <EtatCursor accountId={quota.id} />
              <CreditCursorLigne quota={quota} />
            </>
          ) : null}
          {!edite && !moteurSansQuota(quota.engine) ? (
            <p className="text-[11.5px] text-faint">
              {quota.session ? `${libelleFenetreCompte(quota.session, 'session')} ${Math.round(quota.session.usedPct ?? 0)} %` : null}
              {quota.session && quota.weekly ? ' · ' : null}
              {quota.weekly ? `${libelleFenetreCompte(quota.weekly, 'weekly')} ${Math.round(quota.weekly.usedPct ?? 0)} %` : null}
              {!quota.session && !quota.weekly ? 'Aucune fenêtre de quota publiée' : null}
              {quota.weekly && tempsRestant(quota.weekly.resetsAt) ? ` · remise à zéro : ${tempsRestant(quota.weekly.resetsAt)}` : ''}
            </p>
          ) : null}
        </div>
        {!edite ? (
          <>
            {quota.active ? <Badge tone="success">actif</Badge> : null}
            {!quota.available ? <Badge tone="danger">épuisé</Badge> : null}
            {/* L'état de la connexion ne se dit QUE lorsqu'il pose problème :
                un compte qui marche n'a pas besoin d'un badge de plus. */}
            {quota.connexion?.doitReconnecter ? <Badge tone="warning">{quota.connexion.libelle}</Badge> : null}
            {quota.connexion?.doitReconnecter && !connexion ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => client.send({ type: 'account.connect', engine: quota.engine, accountId: quota.id })}
              >
                <LogIn className="h-3 w-3" />
                Reconnecter
              </Button>
            ) : null}
            <Tooltip content="Renommer ce compte">
              <Button variant="ghost" size="icon-sm" onClick={() => setEdite(true)}>
                <Pencil className="h-3 w-3" />
              </Button>
            </Tooltip>
          </>
        ) : null}
      </div>
      {connexion ? <BlocConnexion connexion={connexion} /> : null}
    </div>
  );
}

function libelleFenetreCompte(
  win: { durationSeconds?: number },
  type: 'session' | 'weekly',
): string {
  const secondes = win.durationSeconds;
  if (secondes === 5 * 60 * 60) return 'fenêtre 5 h';
  if (secondes === 7 * 24 * 60 * 60) return 'semaine';
  if (secondes && secondes < 24 * 60 * 60) {
    const heures = secondes / 3600;
    return Number.isInteger(heures) ? `fenêtre ${heures} h` : 'fenêtre courte';
  }
  if (secondes) {
    const jours = secondes / (24 * 3600);
    return Number.isInteger(jours) ? `fenêtre ${jours} jours` : 'fenêtre longue';
  }
  return type === 'weekly' ? 'fenêtre longue' : 'fenêtre courte';
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
function EtatCursor({ accountId }: { accountId: string }) {
  const [etat, setEtat] = React.useState<EtatCompteCursor | null>(null);
  const [erreur, setErreur] = React.useState<string | null>(null);

  React.useEffect(() => {
    let vivant = true;
    client
      .call<{ etat: EtatCompteCursor }>({ type: 'cursor.etat', accountId })
      .then((data) => vivant && setEtat(data.etat))
      .catch((err) => vivant && setErreur(err?.message ?? 'état illisible'));
    return () => {
      vivant = false;
    };
  }, [accountId]);

  if (erreur) return <p className="text-[11.5px] text-danger">{erreur}</p>;
  if (!etat) return <p className="text-[11.5px] text-faint">lecture de la clé…</p>;

  return (
    <div className="text-[11.5px] text-faint">
      {etat.cleAcceptee ? (
        <p>clé « {etat.nomDeLaCle ?? 'sans nom'} » acceptée</p>
      ) : (
        <p className="text-danger">clé refusée — {etat.erreur ?? 'raison inconnue'}</p>
      )}
      {etat.cliInstalle ? (
        <p>outil « cursor-agent » installé{etat.versionDuCli ? ` (version ${etat.versionDuCli})` : ''}</p>
      ) : (
        <p className="text-warning">
          outil « cursor-agent » absent du serveur — {etat.erreurDuCli ?? 'aucun tour ne peut partir'}
        </p>
      )}
    </div>
  );
}

function CreditCursorLigne({ quota }: { quota: AccountQuota }) {
  const credit = quota.credit;
  const usage = quota.usageLocal
    ? usageCursorEnClair(quota.usageLocal.seconds, quota.usageLocal.tours)
    : null;
  if (!credit && !usage) return null;
  return (
    <div className="mt-0.5 text-[11.5px] text-faint">
      {typeof credit?.centimes === 'number' ? (
        <p>
          {montantCursorEnClair(credit.centimes)}
          {' · '}
          {periodeDuCreditCursor(credit.debutDuCycle)}
        </p>
      ) : credit?.indisponible ? (
        <p>{credit.indisponible}</p>
      ) : null}
      {usage ? <p>{usage}</p> : null}
    </div>
  );
}

/**
 * Une connexion en cours, telle qu'elle se suit à l'écran : l'adresse à ouvrir
 * sur SON téléphone ou son ordinateur, le code à saisir sur la page, et — pour
 * Claude — le champ où recopier le code que la page rend en retour.
 *
 * Rien n'est avalé en silence : une connexion refusée, abandonnée ou trop
 * longue affiche sa cause, en français, à la place de l'adresse.
 */
function BlocConnexion({ connexion }: { connexion: ConnexionCompte }) {
  const [code, setCode] = React.useState('');
  const [envoi, setEnvoi] = React.useState(false);
  const fini = connexionTerminee(connexion);

  if (fini) {
    return (
      <p
        className={cn(
          'mt-1.5 rounded-md px-2 py-1 text-[12.5px] leading-relaxed',
          connexion.etape === 'reussie'
            ? 'border border-success/30 bg-success/5 text-success'
            : 'border border-danger/30 bg-danger/5 text-danger',
        )}
      >
        {connexion.message}
      </p>
    );
  }

  return (
    <div className="mt-1.5 space-y-1.5 rounded-md border border-border bg-bg px-2 py-1.5">
      {connexion.lien ? (
        <>
          <p className="text-[12.5px] leading-relaxed text-muted">
            Ouvrez cette adresse sur votre appareil et connectez-vous :
          </p>
          <a
            href={connexion.lien}
            target="_blank"
            rel="noreferrer"
            className="block break-all text-[12.5px] text-accent underline"
          >
            {connexion.lien}
          </a>
        </>
      ) : (
        <p className="flex items-center gap-1.5 text-[12.5px] text-faint">
          <Loader2 className="h-3 w-3 animate-spin" /> Le moteur prépare la connexion…
        </p>
      )}

      {connexion.code ? (
        <p className="text-[12.5px] leading-relaxed text-muted">
          Puis saisissez ce code sur la page : <span className="font-mono text-[14px] text-text">{connexion.code}</span>
        </p>
      ) : null}

      {connexion.attendLeCode ? (
        <div className="flex items-center gap-1.5">
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Collez ici le code rendu par la page"
            className="h-7 flex-1 text-[12.5px]"
          />
          <Button
            size="sm"
            disabled={!code.trim() || envoi}
            onClick={async () => {
              setEnvoi(true);
              try {
                const rendu = await client.call<{ ok: boolean; error?: string }>({
                  type: 'account.code',
                  id: connexion.id,
                  code,
                });
                if (!rendu.ok) client.pushToast('error', rendu.error ?? 'code refusé');
                else setCode('');
              } finally {
                setEnvoi(false);
              }
            }}
          >
            {envoi ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            Valider
          </Button>
        </div>
      ) : null}

      <Button variant="ghost" size="sm" onClick={() => client.send({ type: 'account.cancel', id: connexion.id })}>
        Abandonner
      </Button>
    </div>
  );
}

/**
 * Ajouter un compte qui n'existe pas encore. Le compte n'entre dans la liste
 * qu'une fois la connexion réussie : une tentative ratée ne laisse pas une
 * ligne morte dans les réglages.
 */
function ConnecterUnCompte() {
  const state = useApp();
  const neuves = state.connexions.filter((c) => !c.accountId);
  const enCours = neuves.find((c) => !connexionTerminee(c));
  const derniere = neuves[neuves.length - 1];

  return (
    <div className="mt-2">
      {enCours ? (
        <div className="rounded-md border border-border bg-surface px-2 py-1.5">
          <p className="text-[13.5px] text-text">{enCours.label}</p>
          <BlocConnexion connexion={enCours} />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {/* Les deux moteurs qui se CONNECTENT : un compte s'y ouvre par une
                page de connexion, dans le coffre du compte. Cursor n'est pas de
                ceux-là — il s'authentifie par une CLÉ posée sur le serveur
                (`CURSOR_API_KEY`), donc aucun bouton n'aurait rien à ouvrir. */}
            {(['claude', 'codex'] as EngineId[]).map((engine) => (
              <Button
                key={engine}
                variant="outline"
                size="sm"
                onClick={() => client.send({ type: 'account.connect', engine })}
              >
                <LogIn className="h-3 w-3" />
                Connecter un compte {engine === 'codex' ? 'Codex' : 'Claude'}
              </Button>
            ))}
          </div>
          {derniere && connexionTerminee(derniere) ? <BlocConnexion connexion={derniere} /> : null}
        </>
      )}
      <AjouterCleCursor />
    </div>
  );
}

/**
 * UNE CLÉ CURSOR DE PLUS. Cursor ne se connecte pas par une page de connexion :
 * il n'a qu'une clé. Sans ce champ, ajouter un second compte Cursor demandait
 * de créer des fichiers sur le serveur — une possibilité qui n'existait donc
 * pas pour qui n'ouvre pas de terminal.
 *
 * Le compte n'apparaît qu'une fois la clé ÉPROUVÉE par le serveur : une clé
 * refusée dit pourquoi et ne laisse aucune ligne morte dans la liste.
 */
function AjouterCleCursor() {
  const [ouvert, setOuvert] = React.useState(false);
  const [nom, setNom] = React.useState('');
  const [cle, setCle] = React.useState('');
  const [envoi, setEnvoi] = React.useState(false);
  const [erreur, setErreur] = React.useState<string | null>(null);

  const valider = async () => {
    setEnvoi(true);
    setErreur(null);
    try {
      const rendu = await client.call<{ ok: boolean; erreur?: string }>({
        type: 'cursor.ajouterCle',
        label: nom,
        cle,
      });
      if (!rendu.ok) {
        setErreur(rendu.erreur ?? 'clé refusée');
        return;
      }
      client.pushToast('success', 'compte Cursor ajouté');
      setOuvert(false);
      setNom('');
      setCle('');
    } catch (err: any) {
      setErreur(err?.message ?? 'ajout impossible');
    } finally {
      setEnvoi(false);
    }
  };

  if (!ouvert) {
    return (
      <Button variant="outline" size="sm" className="mt-1.5" onClick={() => setOuvert(true)}>
        <KeyRound className="h-3 w-3" />
        Ajouter une clé Cursor
      </Button>
    );
  }

  return (
    <div className="mt-1.5 rounded-md border border-border bg-surface px-2 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          autoFocus
          value={nom}
          placeholder="Nom du compte"
          disabled={envoi}
          onChange={(event) => setNom(event.target.value)}
          className="h-7 w-40 text-[13.5px]"
        />
        <Input
          value={cle}
          placeholder="Clé d'accès Cursor"
          disabled={envoi}
          onChange={(event) => setCle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') valider();
          }}
          className="h-7 min-w-0 flex-1 text-[13.5px]"
        />
        <Button size="sm" disabled={envoi || !nom.trim() || !cle.trim()} onClick={valider}>
          {envoi ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Ajouter
        </Button>
        <Button variant="ghost" size="sm" disabled={envoi} onClick={() => setOuvert(false)}>
          Annuler
        </Button>
      </div>
      {erreur ? <p className="mt-1 text-[12.5px] text-danger">{erreur}</p> : null}
      <p className="mt-1 text-[12.5px] leading-relaxed text-faint">
        La clé se crée sur cursor.com, dans le tableau de bord. Elle est éprouvée avant d'être retenue : un compte
        n'apparaît que s'il répond vraiment.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sauvegardes                                                          */
/* ------------------------------------------------------------------ */

function SectionSauvegardes({ open }: { open: boolean }) {
  const [backups, setBackups] = React.useState<{ name: string; size: number; at: number }[]>([]);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    client
      .call<{ backups: typeof backups }>({ type: 'backup.list' })
      .then((data) => setBackups(data.backups ?? []))
      .catch(() => setBackups([]));
  }, [open]);

  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-medium text-text">
        <Database className="h-3.5 w-3.5 text-faint" /> Sauvegardes
      </h3>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const result = await client.call<{ ok: boolean; verification?: { ok: boolean; detail: string } }>({
              type: 'backup.now',
            });
            if (result.verification) {
              client.pushToast(result.verification.ok ? 'success' : 'error', result.verification.detail);
            }
            const data = await client.call<{ backups: typeof backups }>({ type: 'backup.list' });
            setBackups(data.backups ?? []);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
        Sauvegarder maintenant (et vérifier la restauration)
      </Button>

      <div className="mt-2 space-y-0.5">
        {backups.map((backup) => (
          <div key={backup.name} className="flex items-center gap-2 text-[12.5px] text-faint">
            <span className="min-w-0 flex-1 truncate">{backup.name}</span>
            <span>{bytes(backup.size)}</span>
          </div>
        ))}
        {!backups.length ? <p className="text-[12.5px] text-faint">Aucune sauvegarde pour l'instant.</p> : null}
      </div>
    </section>
  );
}

/**
 * Le choix de la voix qui lit le point du jour. Une voix ne se juge pas sur son
 * nom : chaque ligne porte donc son propre bouton d'écoute, et l'extrait est
 * fabriqué par le serveur avec CETTE voix-là, avant tout enregistrement.
 */
function VoiceSection({ open }: { open: boolean }) {
  const state = useApp();
  const [voices, setVoices] = React.useState<{ id: string; label: string; description: string }[]>([]);
  const [playing, setPlaying] = React.useState<string | null>(null);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  // La capture du raccourci d'écoute : tant qu'elle est active, le prochain appui
  // devient le raccourci (s'il convient), sinon on dit pourquoi on le refuse.
  const [captureRaccourci, setCaptureRaccourci] = React.useState(false);
  const [refusRaccourci, setRefusRaccourci] = React.useState<string | null>(null);
  const raccourci = state.settings?.voixRaccourci ?? '';

  const surToucheRaccourci = (event: React.KeyboardEvent) => {
    if (!captureRaccourci) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      setCaptureRaccourci(false);
      setRefusRaccourci(null);
      return;
    }
    const forme = formeDepuisEvenement({
      code: event.code,
      ctrl: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
      meta: event.metaKey,
    });
    // Un modificateur seul : on attend encore la vraie touche.
    if (!forme) return;
    const raison = raisonRaccourciRefuse(forme);
    if (raison) {
      setRefusRaccourci(raison);
      return;
    }
    client.send({ type: 'settings.update', patch: { voixRaccourci: forme } });
    setRefusRaccourci(null);
    setCaptureRaccourci(false);
  };

  React.useEffect(() => {
    if (!open) return;
    client
      .call<{ voices: typeof voices }>({ type: 'voice.list' })
      .then((data) => setVoices(data.voices ?? []))
      .catch(() => setVoices([]));
  }, [open]);

  // On ne laisse jamais un extrait continuer après la fermeture des réglages.
  React.useEffect(() => {
    if (open) return;
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(null);
  }, [open]);

  // Un seul lecteur pour tous les extraits : `cle` distingue ce qui joue (une
  // voix « voix:… », une vitesse « vitesse:… »). L'extrait de vitesse est dit
  // avec la voix RETENUE, pour n'entendre que le débit changer.
  const jouer = (cle: string, params: Record<string, string>) => {
    audioRef.current?.pause();
    const query = new URLSearchParams(params).toString();
    const audio = new Audio(`/api/voice-sample?${query}`);
    audioRef.current = audio;
    setPlaying(cle);
    const fini = () => setPlaying((courant) => (courant === cle ? null : courant));
    audio.addEventListener('ended', fini);
    audio.addEventListener('error', () => {
      fini();
      client.pushToast('error', 'Extrait impossible à jouer.');
    });
    void audio.play().catch(fini);
  };

  const ecouter = (id: string) => jouer(`voix:${id}`, { voice: id });

  const choisie = state.settings?.ttsVoice;
  const vitesse = state.settings?.voixVitesse ?? 'normale';

  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-medium text-text">
        <Volume2 className="h-3.5 w-3.5 text-faint" /> La voix du point du jour
      </h3>

      <div className="mb-3">
        <label className="mb-1 block text-[12.5px] text-muted">Le prénom que la voix emploie</label>
        <Input
          defaultValue={state.settings?.voixNom ?? 'Chris'}
          placeholder="Chris"
          maxLength={40}
          // Un prénom vide retomberait sur « Chris » côté voix ; on n'envoie que
          // ce qui a du texte, une fois débarrassé de ses espaces.
          onBlur={(event) => {
            const nom = event.target.value.trim();
            if (nom) client.send({ type: 'settings.update', patch: { voixNom: nom } });
          }}
        />
        <p className="mt-1 text-[11.5px] text-faint">
          La voix s'adresse à vous par ce prénom (« Ça y est, {state.settings?.voixNom || 'Chris'}, c'est fait. »).
        </p>
      </div>

      <div className="mb-3">
        <label className="mb-1 block text-[12.5px] text-muted">Le mot qui réveille l'écoute</label>
        <Input
          defaultValue={state.settings?.voixReveil ?? 'Dis Haiko'}
          placeholder="Dis Haiko"
          maxLength={40}
          // Un mot vide retomberait sur « Dis Haiko » côté écoute ; on n'envoie
          // que ce qui a du texte, une fois débarrassé de ses espaces.
          onBlur={(event) => {
            const mot = event.target.value.trim();
            if (mot) client.send({ type: 'settings.update', patch: { voixReveil: mot } });
          }}
        />
        <p className="mt-1 text-[11.5px] text-faint">
          Quand l'écoute permanente est allumée, dites ce mot pour commencer à dicter (« {state.settings?.voixReveil || 'Dis Haiko'} range les cartes »).
        </p>
      </div>

      <div className="mb-3">
        <label className="mb-1 block text-[12.5px] text-muted">Le raccourci clavier qui allume l'écoute</label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-raccourci-ecoute
            onClick={() => {
              setCaptureRaccourci(true);
              setRefusRaccourci(null);
            }}
            onBlur={() => {
              setCaptureRaccourci(false);
              setRefusRaccourci(null);
            }}
            onKeyDown={surToucheRaccourci}
            className={cn(
              'flex-1 rounded-md border px-2 py-1.5 text-left text-[13.5px] transition-colors',
              captureRaccourci
                ? 'border-text/40 bg-raised text-text'
                : 'border-border bg-surface text-text hover:bg-raised',
            )}
          >
            {captureRaccourci
              ? 'Appuyez sur la combinaison…'
              : raccourci
                ? libelleDeRaccourci(raccourci)
                : 'Aucun — cliquer pour régler'}
          </button>
          {raccourci && !captureRaccourci ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => client.send({ type: 'settings.update', patch: { voixRaccourci: '' } })}
            >
              Retirer
            </Button>
          ) : null}
        </div>
        {refusRaccourci ? (
          <p className="mt-1 text-[11.5px] text-danger">{refusRaccourci}</p>
        ) : (
          <p className="mt-1 text-[11.5px] text-faint">
            Cette combinaison allume et éteint l'écoute permanente, où que vous soyez — jamais pendant que vous tapez dans un champ. Utilisez Alt ou Ctrl + Maj avec une lettre.
          </p>
        )}
      </div>

      {!voices.length ? (
        <p className="text-[13px] text-faint">Aucune voix installée sur le serveur.</p>
      ) : (
        <div className="space-y-1">
          {voices.map((voice) => {
            const active = choisie === voice.id;
            return (
              <div
                key={voice.id}
                className={cn(
                  'flex items-center gap-2 rounded-md border px-2 py-1.5',
                  active ? 'border-text/40 bg-raised' : 'border-border bg-surface',
                )}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => client.send({ type: 'settings.update', patch: { ttsVoice: voice.id } })}
                >
                  <p className="truncate text-[13.5px] text-text">
                    {voice.label}
                    {active ? <span className="ml-1.5 text-[12px] text-faint">· choisie</span> : null}
                  </p>
                  <p className="truncate text-[11.5px] text-faint">{voice.description}</p>
                </button>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Écouter ${voice.label}`}
                  disabled={playing === `voix:${voice.id}`}
                  onClick={() => ecouter(voice.id)}
                >
                  {playing === `voix:${voice.id}` ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                  Écouter
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-1.5 text-[12.5px] leading-relaxed text-faint">
        L'extrait est dit avec la voix de la ligne, sans rien changer à votre choix. Touchez le nom pour l'adopter :
        c'est cette voix qui lira le point du jour et le bouton haut-parleur.
      </p>

      <div className="mt-4">
        <label className="mb-1.5 block text-[12.5px] text-muted">La vitesse de la voix</label>
        <div className="space-y-1">
          {CRANS_DE_VITESSE.map((cran) => {
            const active = vitesse === cran.id;
            return (
              <div
                key={cran.id}
                className={cn(
                  'flex items-center gap-2 rounded-md border px-2 py-1.5',
                  active ? 'border-text/40 bg-raised' : 'border-border bg-surface',
                )}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => client.send({ type: 'settings.update', patch: { voixVitesse: cran.id } })}
                >
                  <p className="truncate text-[13.5px] text-text">
                    {cran.label}
                    {active ? <span className="ml-1.5 text-[12px] text-faint">· choisie</span> : null}
                  </p>
                  <p className="truncate text-[11.5px] text-faint">{cran.description}</p>
                </button>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Écouter la vitesse ${cran.label}`}
                  disabled={playing === `vitesse:${cran.id}`}
                  // L'essai est dit avec la voix retenue et CETTE vitesse : on
                  // l'entend avant de l'adopter en touchant le nom.
                  onClick={() =>
                    jouer(`vitesse:${cran.id}`, {
                      ...(choisie ? { voice: choisie } : {}),
                      vitesse: cran.id,
                    })
                  }
                >
                  {playing === `vitesse:${cran.id}` ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                  Écouter
                </Button>
              </div>
            );
          })}
        </div>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-faint">
          La vitesse s'applique à toutes les paroles — point du jour, annonces, réécoutes.
        </p>
      </div>
    </section>
  );
}

/**
 * Cumuls de consommation (PLAN §24) et synthèse de facturation (PLAN §7).
 * Ces chiffres éclairent ; ils ne modifient jamais tout seuls une facture.
 */
function UsageSection({ open }: { open: boolean }) {
  const state = useApp();
  const [usage, setUsage] = React.useState<{
    byProject: { projectId?: string | null; name?: string; tokens: number; seconds: number; tasks: number }[];
    byMonth: { month: string; tokens: number; seconds: number }[];
    cache?: {
      jours: number;
      total: { frais: number; relu: number; entree: number; part?: number; tours: number };
      parMoteur: { engine?: string; frais: number; relu: number; tours: number }[];
    };
  } | null>(null);
  const [summary, setSummary] = React.useState<any>(null);
  const [cursor, setCursor] = React.useState<
    { id: string; label: string; credit: CreditCursor }[] | null
  >(null);

  React.useEffect(() => {
    if (!open) return;
    client.call({ type: 'stats.usage' }).then(setUsage).catch(() => setUsage(null));
    client
      .call({ type: 'billing.summary' }, 120000)
      .then((data) => setSummary(data?.summary))
      .catch(() => setSummary(null));
    // Cursor facture à la dépense : là où les autres moteurs ont une jauge de
    // quota, c'est ce montant qui se lit.
    client
      .call({ type: 'cursor.credit' }, 60000)
      .then((data) => setCursor(Array.isArray(data?.comptes) ? data.comptes : null))
      .catch(() => setCursor(null));
  }, [open]);

  /*
   * Le nom vient d'abord du projet vivant, sinon de celui figé au moment de la
   * dépense. Faute des deux (dépense antérieure à cette mémoire), on montre au
   * moins le début de l'identifiant : sept lignes « projet retiré » identiques
   * ne distinguaient plus rien. Un tour dépensé HORS PROJET, lui, n'a aucun
   * identifiant à montrer — et l'écran entier tombait en essayant d'en couper un.
   */
  const nomDuProjet = (row: { projectId?: string | null; name?: string }) =>
    (row.projectId ? state.projects.find((p) => p.id === row.projectId)?.name : undefined) ??
    row.name ??
    (row.projectId ? `Projet supprimé · ${row.projectId.slice(0, 8)}` : 'Hors projet');

  return (
    <section>
      <h3 className="flex items-center gap-1.5 text-[13.5px] font-medium text-text">
        <Activity className="h-3.5 w-3.5 text-faint" /> Ce qui a été consommé
      </h3>
      <p className="mb-2 mt-0.5 text-[12.5px] leading-relaxed text-faint">
        Le total de ce que les agents ont dépensé depuis le début, projet par projet : nombre de tâches et temps de
        travail des agents. C'est une mesure d'usage, pas une facture — rien ici n'est facturé à personne.
      </p>

      {usage?.byProject?.length ? (
        <div className="space-y-0.5">
          {usage.byProject.map((row) => (
            <div key={row.projectId ?? 'hors-projet'} className="rounded-md border border-border bg-surface px-2 py-1.5">
              <p className="truncate text-[13.5px] text-text">{nomDuProjet(row)}</p>
              <p className="mt-0.5 text-[11.5px] text-faint">
                {row.tasks} tâche{row.tasks > 1 ? 's' : ''} · {Math.round(row.seconds / 60)} min
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[13px] text-faint">Aucune consommation relevée pour l'instant.</p>
      )}

      {usage?.byMonth?.length ? (
        <div className="mt-3">
          <p className="mb-1 text-[12px] uppercase tracking-wide text-faint">Par mois</p>
          <div className="flex flex-wrap gap-1">
            {usage.byMonth.map((row) => (
              <span key={row.month} className="rounded border border-border px-1.5 py-0.5 text-[12px] text-muted">
                {moisEnClair(row.month)} · {Math.round(row.seconds / 60)} min
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {cursor?.length ? (
        <div className="mt-4" data-essai="credit-cursor">
          <p className="text-[12px] uppercase tracking-wide text-faint">Crédit dépensé chez Cursor</p>
          <p className="mb-1.5 mt-0.5 text-[12.5px] leading-relaxed text-faint">
            Cursor facture à la dépense. Le même montant se lit aussi sur la carte du compte, dans le volet
            des quotas. Ici, le détail du cycle.
          </p>
          <div className="space-y-0.5">
            {cursor.map((compte) => (
              <div key={compte.id} className="rounded-md border border-border bg-surface px-2 py-1.5">
                <p className="truncate text-[13.5px] text-text">{compte.label}</p>
                {typeof compte.credit?.centimes === 'number' ? (
                  <>
                    <p className="mt-0.5 text-[14.5px] font-medium text-text">
                      {montantCursorEnClair(compte.credit.centimes)}
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-faint">
                      {periodeDuCreditCursor(compte.credit.debutDuCycle)}
                      {compte.credit.membres ? ` · ${compte.credit.membres} membres` : ''}
                    </p>
                  </>
                ) : (
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-faint">
                    {compte.credit?.indisponible ?? "Le montant dépensé n'a pas pu être lu."}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {summary && !summary.error ? (
        <div className="mt-4">
          <p className="text-[12px] uppercase tracking-wide text-faint">Facturation du mois</p>
          <p className="mb-1.5 mt-0.5 text-[12.5px] leading-relaxed text-faint">
            Ce que l'application de facturation a enregistré ce mois-ci. Lecture seule : HaikoDev n'y écrit rien tout
            seul.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['Facturé', summary.invoiced ?? summary.total_invoiced],
              ['Encaissé', summary.paid ?? summary.total_paid],
              ['En attente', summary.outstanding ?? summary.total_outstanding],
              ['En retard', summary.overdue ?? summary.total_overdue],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-md border border-border bg-surface px-2 py-1.5">
                <p className="text-[11.5px] uppercase tracking-wide text-faint">{label}</p>
                <p className="mt-0.5 text-[14.5px] font-medium text-text">
                  {typeof value === 'number' ? `${value.toLocaleString('fr-CH')} CHF` : '—'}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** Courbe fine sur 24 heures, pour comprendre pourquoi une tâche a patienté. */
function Sparkline({ points }: { points: { at: number; loadPct: number }[] }) {
  const width = 640;
  const height = 40;
  const recent = points.slice(-240);
  const min = recent[0]?.at ?? 0;
  const max = recent[recent.length - 1]?.at ?? min + 1;
  const path = recent
    .map((point, index) => {
      const x = ((point.at - min) / Math.max(1, max - min)) * width;
      const y = height - (Math.min(100, point.loadPct) / 100) * height;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <>
      <p className="mt-3 text-[12px] uppercase tracking-wide text-faint">Charge des dernières heures</p>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-1 h-10 w-full" preserveAspectRatio="none">
        <path d={path} fill="none" stroke="hsl(var(--muted))" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
      </svg>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Accès API : les clés des services extérieurs                        */
/* ------------------------------------------------------------------ */

/**
 * LE GÉNÉRATEUR DE CLÉS.
 *
 * Une clé par service extérieur : la boîte mail qui pose une carte à l'arrivée
 * d'un message de client, un formulaire, un automate. Chaque clé porte son nom,
 * sa date de création et se révoque d'un clic.
 *
 * Le SECRET n'est montré qu'UNE FOIS, à sa fabrication : le serveur n'en garde
 * qu'une empreinte. Perdue, une clé ne se retrouve pas — on en fabrique une
 * autre et on révoque l'ancienne.
 */
/** L'appel à recopier, avec l'adresse RÉELLE de cette application — jamais un exemple abstrait. */
function exempleDAppel(): string {
  const racine = typeof window === 'undefined' ? '' : window.location.origin;
  const corps = JSON.stringify({
    projet: 'Nom du projet',
    titre: 'Mail de M. Dupont',
    description: 'Ce qu’il demande, tel quel.',
  });
  return [
    `curl -X POST ${racine}${ROUTE_CARTE_EXTERNE} \\`,
    `  -H "x-haikodev-cle: ${PREFIXE_CLE_API}…" \\`,
    '  -H "content-type: application/json" \\',
    `  -d '${corps}'`,
  ].join('\n');
}

function SectionClesApi({ open }: { open: boolean }) {
  const [cles, setCles] = React.useState<CleApiPublique[]>([]);
  const [nom, setNom] = React.useState('');
  const [enCours, setEnCours] = React.useState(false);
  const [secret, setSecret] = React.useState<{ nom: string; valeur: string } | null>(null);
  const [aRevoquer, setARevoquer] = React.useState<CleApiPublique | null>(null);

  React.useEffect(() => {
    if (!open) return;
    client.call<{ cles: CleApiPublique[] }>({ type: 'cleApi.lister' }).then((data) => setCles(data.cles ?? []));
  }, [open]);

  const creer = async () => {
    const juge = jugerNomDeCle(nom);
    if (!juge.ok) {
      client.pushToast('error', juge.raison);
      return;
    }
    setEnCours(true);
    try {
      const data = await client.call<{ secret: string; cles: CleApiPublique[] }>({
        type: 'cleApi.creer',
        nom: juge.nom,
      });
      setCles(data.cles ?? []);
      setSecret({ nom: juge.nom, valeur: data.secret });
      setNom('');
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'clé non créée');
    } finally {
      setEnCours(false);
    }
  };

  const revoquer = async (cle: CleApiPublique) => {
    const data = await client.call<{ cles: CleApiPublique[] }>({ type: 'cleApi.revoquer', id: cle.id });
    setCles(data.cles ?? []);
    client.pushToast('success', `Clé « ${cle.nom} » révoquée : les appels suivants sont refusés.`);
  };

  const oublier = async (cle: CleApiPublique) => {
    try {
      const data = await client.call<{ cles: CleApiPublique[] }>({ type: 'cleApi.oublier', id: cle.id });
      setCles(data.cles ?? []);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'clé non retirée');
    }
  };

  const vivantes = cles.filter((c) => !c.revoqueeLe);

  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-medium text-text">
        <KeyRound className="h-3.5 w-3.5 text-faint" /> Clés des services extérieurs
      </h3>

      <p className="mb-3 text-[12.5px] leading-relaxed text-faint">
        Une clé permet à un service du dehors — une boîte mail, un formulaire, un automate — de poser une carte
        dans un projet, sans ouvrir cette application. La carte arrive dans « Planifié » et attend son lancement,
        comme n'importe quelle autre.
      </p>

      {/* Fabriquer une clé */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void creer();
          }}
          placeholder="Nom du service (« boîte mail »…)"
          className="h-7 w-56 text-[12.5px]"
          maxLength={NOM_CLE_MAX}
          autoComplete="off"
        />
        <Button variant="secondary" size="sm" onClick={creer} disabled={enCours || !nom.trim()}>
          {enCours ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          Générer une clé
        </Button>
      </div>

      {/* La clé en clair : une seule fois, ici et jamais plus */}
      {secret ? (
        <div className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2">
          <p className="text-[12.5px] font-medium text-warning">
            Clé de « {secret.nom} » — copiez-la maintenant, elle ne sera plus jamais affichée.
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <code className="min-w-0 flex-1 break-all rounded bg-raised px-2 py-1 text-[12px] text-text">
              {secret.valeur}
            </code>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void navigator.clipboard?.writeText(secret.valeur);
                client.pushToast('success', 'Clé copiée');
              }}
            >
              <Copy className="h-3 w-3" /> Copier
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSecret(null)}>
              J'ai noté
            </Button>
          </div>
        </div>
      ) : null}

      {/* La liste */}
      <div className="mt-3 space-y-1">
        {cles.length === 0 ? (
          <p className="text-[12.5px] text-faint">Aucune clé pour l'instant.</p>
        ) : (
          cles.map((cle) => (
            <div
              key={cle.id}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border bg-surface px-2.5 py-2"
            >
              <span className="text-[13px] text-text">{cle.nom}</span>
              <code className="rounded bg-raised px-1.5 py-0.5 text-[11.5px] text-faint">{cle.apercu}…</code>
              {cle.revoqueeLe ? (
                <Badge tone="danger">révoquée {relativeTime(cle.revoqueeLe)}</Badge>
              ) : (
                <Badge tone="success">active</Badge>
              )}
              <span className="text-[12px] text-faint">créée {relativeTime(cle.creeeLe)}</span>
              <span className="text-[12px] text-faint">
                {cle.cartesCreees
                  ? `${cle.cartesCreees} carte(s) · dernier appel ${relativeTime(cle.dernierUsageLe ?? cle.creeeLe)}`
                  : 'jamais utilisée'}
              </span>
              <div className="ml-auto flex items-center gap-1">
                {cle.revoqueeLe ? (
                  <Button variant="ghost" size="sm" onClick={() => oublier(cle)}>
                    <Trash2 className="h-3 w-3" /> Retirer
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setARevoquer(cle)}>
                    <ShieldOff className="h-3 w-3" /> Révoquer
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Le mode d'emploi, avec l'adresse réelle de cette application */}
      <div className="mt-4 rounded-md border border-border bg-surface px-2.5 py-2">
        <p className="text-[12.5px] font-medium text-text">Comment s'en servir</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-faint">
          Le service envoie un POST à l'adresse ci-dessous, avec sa clé dans l'en-tête et, dans le corps, le projet
          visé (son nom suffit), un titre et une description.
        </p>
        <pre className="mt-1.5 overflow-x-auto rounded bg-raised px-2 py-1.5 text-[11.5px] leading-relaxed text-muted">
          {exempleDAppel()}
        </pre>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-faint">
          {vivantes.length
            ? `${vivantes.length} clé(s) active(s). Une clé révoquée fait refuser l'appel aussitôt.`
            : 'Aucune clé active : tout appel extérieur est refusé.'}
        </p>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-faint">
          Le mode d'emploi complet — champs acceptés, réponses, refus — est publié à l'adresse{' '}
          <a
            href={ROUTE_DOC_API}
            target="_blank"
            rel="noreferrer"
            className="text-text underline decoration-border underline-offset-2 hover:decoration-muted"
          >
            {ROUTE_DOC_API}
          </a>
          , lisible sans compte : c'est la page à donner au service qu'on branche.
        </p>
      </div>

      <ConfirmDialog
        open={!!aRevoquer}
        title={`Révoquer « ${aRevoquer?.nom} » ?`}
        description="Le service qui s’en sert ne pourra plus créer de carte. Les cartes déjà créées restent en place."
        confirmLabel="Révoquer"
        danger
        onConfirm={async () => {
          if (aRevoquer) await revoquer(aRevoquer);
        }}
        onClose={() => setARevoquer(null)}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Compétences : le pool partagé, ce qu'il sert et ce qu'il refuse     */
/* ------------------------------------------------------------------ */

/**
 * LE POOL, VU DE L'ÉCRAN. Il montre l'arbre (la tête d'une fiche et ses
 * fichiers de détail), l'état, la confiance mesurée et l'usage réel de chaque
 * fiche, et surtout CE QUI A ÉTÉ ÉCARTÉ avec sa raison — c'était le point
 * aveugle : quinze compétences sur seize étaient ignorées en silence.
 *
 * On y déprécie ou on y archive d'un clic. RIEN NE SE SUPPRIME : une fiche
 * dépréciée apprend encore quelque chose, une fiche effacée n'apprend rien.
 * Écrire une fiche, en revanche, ne se fait pas ici : c'est le travail d'un
 * agent, à travers le contrôle de qualité.
 */
function SectionCompetences({ open }: { open: boolean }) {
  const state = useApp();
  const [pool, setPool] = React.useState<EtatDuPool | null>(null);

  React.useEffect(() => {
    if (!open) return;
    client
      .call<{ pool: EtatDuPool }>({ type: 'competences.etat' })
      .then((data) => setPool(data.pool))
      .catch(() => setPool(null));
  }, [open]);

  // Le démon diffuse le pool dès qu'une fiche est écrite ou change d'état :
  // l'écran suit sans qu'on ait à le rouvrir.
  React.useEffect(() => {
    if (state.pool) setPool(state.pool);
  }, [state.pool]);

  const changerEtat = async (nom: string, etat: 'active' | 'depreciee' | 'archivee') => {
    try {
      const data = await client.call<{ pool: EtatDuPool }>({ type: 'competences.etatDeLaFiche', nom, etat });
      setPool(data.pool);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'état non changé');
      throw err;
    }
  };

  const fiches = pool?.fiches ?? [];
  const servies = fiches.filter((f) => f.etat !== 'archivee');

  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-medium text-text">
        <GraduationCap className="h-3.5 w-3.5 text-faint" /> Compétences partagées
      </h3>

      <p className="mb-3 text-[12.5px] leading-relaxed text-faint">
        Des modes d'emploi valables pour TOUS les projets. Une leçon apprise sur un projet sert aux autres, et une
        fiche n'est écrite qu'à partir d'un travail qui a fait ses preuves. La confiance monte quand un agent dit
        qu'elle l'a aidé, et descend quand une carte la contredit.
      </p>

      {pool ? (
        <p className="mb-3 text-[12px] text-faint">
          {servies.length} fiche(s) en service · {pool.dossier}
          {pool.versionne ? ' · sauvegardé (dépôt git)' : ' · pas encore sous git'}
        </p>
      ) : null}

      {/* Ce qui a été ÉCARTÉ, avec sa raison : plus aucun refus muet. */}
      {pool?.refus.length ? (
        <div className="mb-3 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2">
          <p className="text-[12.5px] font-medium text-warning">
            {pool.refus.length} entrée(s) écartée(s) du pool
          </p>
          <ul className="mt-1 space-y-0.5">
            {pool.refus.map((refus) => (
              <li key={refus.nom} className="text-[12px] text-faint">
                {refus.raison}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-1">
        {!pool ? (
          <p className="text-[12.5px] text-faint">Lecture du pool…</p>
        ) : fiches.length === 0 ? (
          <p className="text-[12.5px] text-faint">Aucune compétence dans le pool pour l'instant.</p>
        ) : (
          fiches.map((fiche) => (
            <div
              key={fiche.nom}
              className="rounded-md border border-border bg-surface px-2.5 py-2"
              data-competence={fiche.nom}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[13px] text-text">{fiche.nom}</span>
                {fiche.etat === 'active' ? (
                  <Badge tone="success">active</Badge>
                ) : fiche.etat === 'depreciee' ? (
                  <Badge tone="warning">dépréciée</Badge>
                ) : (
                  <Badge tone="neutral">archivée</Badge>
                )}
                <span className="text-[12px] text-faint">confiance {Math.round(fiche.confiance * 100)} %</span>
                <span className="text-[12px] text-faint">
                  {fiche.servie
                    ? `servie ${fiche.servie}× · ${fiche.aidee} utile(s) · ${fiche.contredite} contradiction(s)`
                    : 'jamais servie'}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  {fiche.etat !== 'depreciee' && fiche.etat !== 'archivee' ? (
                    <Button variant="ghost" size="sm" onClick={() => changerEtat(fiche.nom, 'depreciee')}>
                      <ArrowDownCircle className="h-3 w-3" /> Déprécier
                    </Button>
                  ) : null}
                  {fiche.etat !== 'archivee' ? (
                    <Button variant="ghost" size="sm" onClick={() => changerEtat(fiche.nom, 'archivee')}>
                      <Archive className="h-3 w-3" /> Archiver
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => changerEtat(fiche.nom, 'active')}>
                      <RefreshCw className="h-3 w-3" /> Remettre en service
                    </Button>
                  )}
                </div>
              </div>

              <p className="mt-1 text-[12.5px] leading-relaxed text-faint">{fiche.description}</p>

              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-faint">
                {fiche.themes.length ? <span>thèmes : {fiche.themes.join(', ')}</span> : null}
                {fiche.annexes.length ? <span>{fiche.annexes.length} fichier(s) de détail</span> : null}
                {fiche.provenanceProjet ? <span>venue de {fiche.provenanceProjet}</span> : null}
                {fiche.renforceePar.length ? <span>renforcée {fiche.renforceePar.length}×</span> : null}
              </div>

              {fiche.anomalies.length ? (
                <p className="mt-1 text-[12px] text-warning">À revoir : {fiche.anomalies.join(' ; ')}</p>
              ) : null}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Personnages : remplacer celui d'une colonne, ou revenir à l'origine */
/* ------------------------------------------------------------------ */

/**
 * CHANGER UN PERSONNAGE QUI NE PLAÎT PAS, sans passer par une carte ni par un
 * agent : on choisit la colonne, on dépose une image, et le démon la détoure et
 * la recadre dans les DEUX découpes — la silhouette de tête de colonne et le
 * portrait rond des notifications — avec la même fabrique que les sept
 * d'origine (`scripts/personnages-colonnes.py`). Rien n'est perdu : « Revenir à
 * l'original » efface l'image déposée et l'image livrée reprend sa place.
 *
 * Un refus est TOUJOURS dit avec sa raison, sous la colonne concernée (fichier
 * qui n'est pas une image, image trop lourde, fond non uni où le détourage ne
 * trouve aucun personnage, détourage indisponible sur ce serveur) : sans cela,
 * un dépôt refusé ne se distinguait pas d'un dépôt oublié.
 */
function SectionPersonnages() {
  const state = useApp();
  const [enCours, setEnCours] = React.useState<ColumnKey | null>(null);
  const [refus, setRefus] = React.useState<Partial<Record<ColumnKey, string>>>({});
  const champs = React.useRef<Partial<Record<ColumnKey, HTMLInputElement | null>>>({});

  const deposer = async (colonne: ColumnKey, fichier: File) => {
    setRefus((avant) => ({ ...avant, [colonne]: undefined }));
    setEnCours(colonne);
    try {
      const reponse = await fetch(`/api/personnage?colonne=${encodeURIComponent(colonne)}`, {
        method: 'POST',
        headers: {
          'content-type': fichier.type || 'application/octet-stream',
          'x-file-name': encodeURIComponent(fichier.name),
        },
        body: fichier,
      });
      const data = await reponse.json().catch(() => ({}));
      if (!reponse.ok || !data?.ok) {
        setRefus((avant) => ({ ...avant, [colonne]: data?.error ?? "Le remplacement a échoué." }));
        return;
      }
      client.pushToast('success', `Le personnage de « ${COLUMN_LABELS[colonne]} » a été remplacé.`);
    } catch (err: any) {
      setRefus((avant) => ({ ...avant, [colonne]: err?.message ?? "Le remplacement a échoué." }));
    } finally {
      setEnCours(null);
      // Le champ garde sinon le fichier déposé : redéposer le MÊME ne
      // déclencherait plus rien.
      const champ = champs.current[colonne];
      if (champ) champ.value = '';
    }
  };

  const retablir = async (colonne: ColumnKey) => {
    setRefus((avant) => ({ ...avant, [colonne]: undefined }));
    const reponse = await fetch(`/api/personnage?colonne=${encodeURIComponent(colonne)}`, { method: 'DELETE' });
    const data = await reponse.json().catch(() => ({}));
    if (!reponse.ok || !data?.ok) {
      setRefus((avant) => ({ ...avant, [colonne]: data?.error ?? "Le retour à l'original a échoué." }));
      // Le bouton doit se savoir en échec : sans cela il montrerait sa coche.
      throw new Error(data?.error ?? 'échec');
    }
    client.pushToast('success', `« ${COLUMN_LABELS[colonne]} » a retrouvé son personnage d'origine.`);
  };

  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-medium text-text">
        <ImageIcon className="h-3.5 w-3.5 text-faint" /> Personnages des colonnes
      </h3>

      <p className="mb-3 text-[12.5px] leading-relaxed text-faint">
        Chaque colonne du tableau a son personnage. Déposez une image — un sujet sur un fond clair et uni — et elle
        prend la place de l'ancien : détourée et recadrée pour la tête de colonne comme pour les notifications. Le
        personnage d'origine n'est jamais perdu.
      </p>

      <div className="space-y-2">
        {COLUMN_KEYS.map((colonne) => {
          const remplaceLe = state.personnages[colonne];
          const raison = refus[colonne];
          return (
            <div
              key={colonne}
              className="rounded-md border border-border bg-surface px-2.5 py-2"
              data-personnage-reglage={colonne}
            >
              <div className="flex items-center gap-2.5">
                {/* La même boîte de proportion fixe que sur le tableau : ce
                    qu'on voit ici est exactement ce qui sera posé là-bas. */}
                <img
                  src={imageDuPersonnage(colonne, remplaceLe)}
                  alt=""
                  aria-hidden
                  className="h-12 w-9 shrink-0 select-none object-contain"
                  data-personnage-apercu={colonne}
                />
                <div className="min-w-0">
                  <div className="text-[13px] text-text">{COLUMN_LABELS[colonne]}</div>
                  <div className="text-[12px] text-faint">
                    {remplaceLe ? `remplacé ${relativeTime(remplaceLe)}` : "personnage d'origine"}
                  </div>
                </div>

                <div className="ml-auto flex items-center gap-1">
                  <input
                    ref={(element) => {
                      champs.current[colonne] = element;
                    }}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    data-personnage-fichier={colonne}
                    onChange={(event) => {
                      const fichier = event.target.files?.[0];
                      if (fichier) void deposer(colonne, fichier);
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={enCours === colonne}
                    data-personnage-remplacer={colonne}
                    onClick={() => champs.current[colonne]?.click()}
                  >
                    {enCours === colonne ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <ImageIcon className="h-3 w-3" />
                    )}{' '}
                    {enCours === colonne ? 'Détourage…' : 'Remplacer'}
                  </Button>
                  {remplaceLe ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      data-personnage-retablir={colonne}
                      onClick={() => retablir(colonne)}
                    >
                      <RefreshCw className="h-3 w-3" /> Revenir à l'original
                    </Button>
                  ) : null}
                </div>
              </div>

              {raison ? (
                <p className="mt-1 text-[12px] text-danger" data-personnage-refus={colonne}>
                  {raison}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
