import * as React from 'react';
import { Activity, Brain, Database, Loader2, Play, Power, RefreshCw, Save, Send, ShieldCheck, Volume2 } from 'lucide-react';
import {
  SystemProcess,
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
                {capacity.runningAgents} en cours · plafond {capacity.maxAgents} · mémoire moyenne mesurée{' '}
                {capacity.avgAgentMemMb} Mo
              </span>
            </div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-faint">
              La barre montre les places d'agents occupées, rien d'autre : elle ne devient rouge que lorsqu'aucun agent
              ne peut plus démarrer.
            </p>

            {ton === 'tendu' ? (
              <p className="mt-1.5 rounded-md border border-warning/30 bg-warning/5 px-2 py-1 text-[13px] text-warning">
                Il ne reste presque plus de place : les prochaines tâches attendront leur tour.
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
                detail={`${capacity.cpuCount} cœurs — au-delà de 120 % la machine freine les départs`}
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
                  process.running ? (process.kind === 'agent' ? 'bg-success' : 'bg-muted') : 'bg-faint',
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

      <SectionCerveau />

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
/* La liaison au cerveau : ce que les projets lui envoient chaque jour  */
/* ------------------------------------------------------------------ */

interface EtatCerveau {
  clePosee: boolean;
  adresse: string;
  dernierSucces?: number;
  projetsEnvoyes: number;
  fichiersEnvoyes: number;
  derniereTentative?: number;
  erreurs: { at: number; projet?: string; message: string }[];
}

/**
 * Chaque jour, la mémoire et les instructions de chaque projet partent au
 * cerveau. C'est un mécanisme silencieux : sans un endroit où le lire, on ne
 * saurait jamais s'il tourne encore.
 */
function SectionCerveau() {
  const [etat, setEtat] = React.useState<EtatCerveau | null>(null);
  const [enCours, setEnCours] = React.useState(false);

  React.useEffect(() => {
    client.call<{ etat: EtatCerveau }>({ type: 'cerveau.etat' }).then((data) => setEtat(data.etat ?? null));
  }, []);

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

  return (
    <section className="mt-4">
      <h3 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-medium text-text">
        <Brain className="h-3.5 w-3.5 text-faint" /> Mémoire envoyée au cerveau
      </h3>

      <p className="mb-2 text-[12.5px] leading-relaxed text-faint">
        Une fois par jour, chaque projet vivant envoie sa mémoire, les instructions de ses moteurs et toute sa
        documentation écrite, pour que l'apprentissage se fasse sur l'ensemble des projets. L'historique des
        livraisons ne part jamais, ni aucun fichier écarté du dépôt.
      </p>

      <div className="rounded-md border border-border bg-surface px-2.5 py-2">
        <div className="flex flex-wrap items-center gap-2">
          {etat?.clePosee ? (
            <Badge tone="success">clé posée</Badge>
          ) : (
            <Badge tone="danger">aucune clé</Badge>
          )}
          <span className="text-[12.5px] text-faint">{etat?.adresse}</span>
        </div>

        {!etat?.clePosee ? (
          <p className="mt-1.5 rounded-md border border-warning/30 bg-warning/5 px-2 py-1 text-[13px] text-warning">
            Rien ne part tant que la clé du cerveau n'est pas posée dans l'environnement du serveur.
          </p>
        ) : null}

        <p className="mt-1.5 text-[13px] text-text">
          {etat?.dernierSucces
            ? `Dernier envoi réussi ${relativeTime(etat.dernierSucces)} — ${etat.fichiersEnvoyes} fichier(s) pour ${etat.projetsEnvoyes} projet(s).`
            : 'Aucun envoi réussi pour le moment.'}
        </p>
        {etat?.derniereTentative && etat.derniereTentative !== etat.dernierSucces ? (
          <p className="mt-0.5 text-[12.5px] text-faint">Dernière tentative {relativeTime(etat.derniereTentative)}.</p>
        ) : null}

        {etat?.erreurs?.length ? (
          <div className="mt-2 space-y-0.5">
            <p className="text-[11.5px] uppercase tracking-wide text-faint">Dernières erreurs</p>
            {etat.erreurs.map((erreur, index) => (
              <p key={`${erreur.at}-${index}`} className="text-[12.5px] text-danger">
                {relativeTime(erreur.at)}
                {erreur.projet ? ` · ${erreur.projet}` : ''} — {erreur.message}
              </p>
            ))}
          </div>
        ) : null}

        <Button variant="secondary" size="sm" className="mt-2" onClick={envoyer} disabled={enCours}>
          {enCours ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          Envoyer maintenant
        </Button>
      </div>
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
          <div key={quota.id} className="flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] text-text">
                {quota.label} {quota.plan ? <span className="text-faint">· {quota.plan}</span> : null}
              </p>
              <p className="text-[11.5px] text-faint">
                fenêtre {Math.round(quota.session?.usedPct ?? 0)} % · semaine {Math.round(quota.weekly?.usedPct ?? 0)} %
                {tempsRestant(quota.weekly?.resetsAt) ? ` · semaine : ${tempsRestant(quota.weekly?.resetsAt)}` : ''}
              </p>
            </div>
            {quota.active ? <Badge tone="success">actif</Badge> : null}
            {!quota.available ? <Badge tone="danger">épuisé</Badge> : null}
          </div>
        ))}
      </div>

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

  const ecouter = (id: string) => {
    audioRef.current?.pause();
    const audio = new Audio(`/api/voice-sample?voice=${encodeURIComponent(id)}`);
    audioRef.current = audio;
    setPlaying(id);
    const fini = () => setPlaying((courant) => (courant === id ? null : courant));
    audio.addEventListener('ended', fini);
    audio.addEventListener('error', () => {
      fini();
      client.pushToast('error', 'Extrait impossible à jouer.');
    });
    void audio.play().catch(fini);
  };

  const choisie = state.settings?.ttsVoice;

  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-medium text-text">
        <Volume2 className="h-3.5 w-3.5 text-faint" /> La voix du point du jour
      </h3>

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
                  disabled={playing === voice.id}
                  onClick={() => ecouter(voice.id)}
                >
                  {playing === voice.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
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
    byProject: { projectId: string; name?: string; tokens: number; seconds: number; tasks: number }[];
    byMonth: { month: string; tokens: number; seconds: number }[];
  } | null>(null);
  const [summary, setSummary] = React.useState<any>(null);

  React.useEffect(() => {
    if (!open) return;
    client.call({ type: 'stats.usage' }).then(setUsage).catch(() => setUsage(null));
    client
      .call({ type: 'billing.summary' }, 120000)
      .then((data) => setSummary(data?.summary))
      .catch(() => setSummary(null));
  }, [open]);

  /*
   * Le nom vient d'abord du projet vivant, sinon de celui figé au moment de la
   * dépense. Faute des deux (dépense antérieure à cette mémoire), on montre au
   * moins le début de l'identifiant : sept lignes « projet retiré » identiques
   * ne distinguaient plus rien.
   */
  const nomDuProjet = (row: { projectId: string; name?: string }) =>
    state.projects.find((p) => p.id === row.projectId)?.name ??
    row.name ??
    `Projet supprimé · ${row.projectId.slice(0, 8)}`;

  return (
    <section>
      <h3 className="flex items-center gap-1.5 text-[13.5px] font-medium text-text">
        <Activity className="h-3.5 w-3.5 text-faint" /> Ce qui a été consommé
      </h3>
      <p className="mb-2 mt-0.5 text-[12.5px] leading-relaxed text-faint">
        Le total de ce que les agents ont dépensé depuis le début, projet par projet : nombre de tâches, temps de travail
        des agents et jetons consommés chez les moteurs. C'est une mesure d'usage, pas une facture — rien ici n'est
        facturé à personne.
      </p>

      {usage?.byProject?.length ? (
        <div className="space-y-0.5">
          {usage.byProject.map((row) => (
            <div key={row.projectId} className="rounded-md border border-border bg-surface px-2 py-1.5">
              <p className="truncate text-[13.5px] text-text">{nomDuProjet(row)}</p>
              <p className="mt-0.5 text-[11.5px] text-faint">
                {row.tasks} tâche{row.tasks > 1 ? 's' : ''} · {Math.round(row.seconds / 60)} min ·{' '}
                {(row.tokens ?? 0).toLocaleString('fr-CH')} jetons
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
