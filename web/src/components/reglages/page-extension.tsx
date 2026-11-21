import * as React from 'react';
import { ChevronLeft, ChevronRight, EllipsisVertical, Eye, Link2Off, Loader2, Monitor, Pause, PencilLine, Play, Plus, Repeat, ShieldCheck, ShieldOff, Trash2 } from '@/components/ui/icones';
import {
  LIBELLE_DU_NAVIGATEUR,
  autorisationsDonnees,
  droitsDeLOrdinateur,
  ordinateurEnLigne,
  ordinateurReconnu,
  programmeEnLigne,
  ordinateurVuLe,
  type EtatDeLExtension,
  type DroitDOrdinateur,
  type ModeDeSite,
  type NavigateurDOrdinateur,
  type Ordinateur,
  type RoutineChrome,
  type SiteDuChrome,
} from '@beluga/shared';
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Label,
  Switch,
} from '@/components/ui';
import { LigneDeReglage, RubriqueDeReglages } from '@/components/modeles';
import { client } from '@/lib/client';
import { relativeTime } from '@/lib/utils';
import { t } from '@/lib/langue';
import { FenetreSafari, ParcoursDeConnexion, useNavigateurCourant, type DepartDuParcours } from './assistant-installation';

/** Le nom propre de l'application : le même dans toutes les langues. */
const CONNECT = ['Beluga', 'Connect'].join(' ');

/**
 * LA PAGE « ORDINATEURS » DES RÉGLAGES — UNE SEULE PAGE (carte « Beluga Connect : installation simplifiée »,
 * 21/11/2026, décision de l'utilisateur) : les anciennes pages « Beluga Connect » et « Extension du navigateur » y
 * sont fondues (leurs clés y mènent, `ALIAS_DES_PAGES_DE_REGLAGES`).
 *  - en tête, UN bouton : « Connecter cet ordinateur ». Il déplie le parcours en direct (`ParcoursDeConnexion`,
 *    assistant-installation.tsx) : téléchargement, puis tout se coche seul ;
 *  - la liste des ordinateurs ; celui sur lequel on est porte « Cet ordinateur » (reconnu par l'extension) ;
 *  - la page de chaque ordinateur : ses droits, Beluga Connect, ses navigateurs, les autorisations de macOS ;
 *  - les sites et les gestes répétés, qui valent pour tout le compte.
 * `?connecter=1` (ouvert par Beluga Connect quand sa liaison a échoué) relance le parcours par le lien seul.
 */
function useEtatDeLExtension() {
  const [etat, setEtat] = React.useState<EtatDeLExtension | null>(null);
  const [enCours, setEnCours] = React.useState<string | null>(null);
  const lire = React.useCallback(async () => {
    try {
      setEtat(await client.call<EtatDeLExtension>({ type: 'extension.etat' }));
    } catch {
      /* le démon ne répond pas : la page garde ce qu'elle savait */
    }
  }, []);
  React.useEffect(() => {
    void lire();
    return client.onExtension(() => void lire());
  }, [lire]);
  const agir = async (cle: string, cmd: Record<string, unknown>) => {
    setEnCours(cle);
    try {
      await client.call(cmd as any);
      await lire();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Le geste n’a pas abouti.'));
    } finally {
      setEnCours(null);
    }
  };
  return { etat, lire, enCours, agir };
}

/** Arrivée depuis Beluga Connect (`?connecter=1`) : vrai une fois, puis l'adresse est nettoyée. */
function arriveeDepuisConnect(): boolean {
  if (typeof window === 'undefined') return false;
  const q = new URLSearchParams(window.location.search);
  if (!q.has('connecter')) return false;
  q.delete('connecter');
  const reste = q.toString();
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${reste ? `?${reste}` : ''}${window.location.hash}`);
  return true;
}

export function PageOrdinateurs() {
  const { etat, lire, enCours, agir } = useEtatDeLExtension();
  const navigateurId = useNavigateurCourant();
  const [aDelier, setADelier] = React.useState<Ordinateur | null>(null);
  const [aRenommer, setARenommer] = React.useState<Ordinateur | null>(null);
  /* LE PARCOURS « Connecter cet ordinateur » : ouvert par le bouton (un nouveau départ à chaque clic). */
  const [depart, setDepart] = React.useState<DepartDuParcours | null>(() => (arriveeDepuisConnect() ? { n: 1, mode: 'relier' } : null));
  /* LA PAGE D'UN ORDINATEUR (carte « Piloter le Mac depuis Beluga ») : ouverte au clic sur sa ligne, au même endroit. */
  const [ouvert, setOuvert] = React.useState<string | null>(null);

  const ici = etat ? ordinateurReconnu(etat.ordinateurs, { navigateurId }) : null;
  const ordinateurOuvert = ouvert && etat ? etat.ordinateurs.find((o) => o.id === ouvert) ?? null : null;
  if (ordinateurOuvert && etat) {
    return <PageDUnOrdinateur ordinateur={ordinateurOuvert} ordinateurs={etat.ordinateurs} ici={ici?.id ?? null} safari={etat.safari.disponible} onChoisir={setOuvert} onRetour={() => setOuvert(null)} relire={lire} />;
  }
  const connecter = () => setDepart((d) => ({ n: (d?.n ?? 0) + 1, mode: 'telecharger' }));

  return (
    <div className="flex flex-col gap-7" data-page-extension data-page-ordinateurs>
      <RubriqueDeReglages
        titre={t('Vos ordinateurs')}
        description={t('Les agents ouvrent leurs onglets et agissent sur l’ordinateur choisi. Touchez-en un pour régler ce qu’ils ont le droit d’y faire.')}
        action={
          depart ? null : (
            <Button variant="default" size="md" onClick={connecter} disabled={!etat} data-connecter-ordinateur>
              <Plus className="h-3.5 w-3.5" />
              {t('Connecter cet ordinateur')}
            </Button>
          )
        }
        avant={
          depart && etat ? (
            <div className="rounded-2xl bg-surface px-4 py-5 sm:px-5" data-bloc-parcours>
              <ParcoursDeConnexion etat={etat} depart={depart} onFermer={() => setDepart(null)} />
            </div>
          ) : null
        }
      >
        {!etat ? (
          <Silhouette />
        ) : etat.ordinateurs.length ? (
          etat.ordinateurs.map((o) => (
            <LigneDOrdinateur
              key={o.id}
              ordinateur={o}
              version={etat.version}
              ici={ici?.id === o.id}
              occupe={enCours === o.id}
              onOuvrir={() => setOuvert(o.id)}
              onRenommer={() => setARenommer(o)}
              onDelier={() => setADelier(o)}
              onDelierNavigateur={(n) => void agir(o.id, { type: 'extension.delier', id: n.id })}
              onDelierProgramme={() => void agir(o.id, { type: 'relaisMac.delier', ordinateurId: o.id })}
            />
          ))
        ) : (
          <p className="px-3.5 py-3 text-[13.5px] text-muted">{t('Aucun ordinateur n’est relié pour l’instant.')}</p>
        )}
      </RubriqueDeReglages>

      <RubriqueDeReglages
        titre={t('Sites')}
        description={t('Décidés à la première visite d’un agent. Envoyer, payer, publier ou supprimer vous est toujours redemandé, même sur un site autorisé.')}
      >
        {!etat ? (
          <Silhouette />
        ) : etat.sites.length ? (
          etat.sites.map((s) => <LigneDeSite key={s.origine} site={s} occupe={enCours === s.origine} agir={(mode) => void agir(s.origine, { type: 'extension.site', origine: s.origine, mode })} />)
        ) : (
          <p className="px-3.5 py-3 text-[13.5px] text-muted">{t('Aucun site décidé pour l’instant.')}</p>
        )}
      </RubriqueDeReglages>

      <RubriqueDeReglages
        titre={t('Gestes répétés')}
        description={t('Créés depuis « Refaire chaque… » sous le compte rendu d’une carte qui a travaillé dans Chrome. Si Chrome est fermé à l’heure dite, le geste attend son retour.')}
      >
        {!etat ? (
          <Silhouette />
        ) : etat.routines.length ? (
          etat.routines.map((r) => <LigneDeRoutine key={r.id} routine={r} occupe={enCours === r.id} agir={(patch) => void agir(r.id, { type: 'extension.routine', id: r.id, ...patch })} />)
        ) : (
          <p className="px-3.5 py-3 text-[13.5px] text-muted">{t('Aucun geste répété pour l’instant.')}</p>
        )}
      </RubriqueDeReglages>

      <FenetreDeNom
        ordinateur={aRenommer}
        onClose={() => setARenommer(null)}
        onFait={() => {
          setARenommer(null);
          void lire();
        }}
      />
      <ConfirmDialog
        open={!!aDelier}
        title={t('Délier « {nom} » ?', { nom: aDelier?.nom ?? '' })}
        description={t('Ses navigateurs et Beluga Connect ne pourront plus être pilotés. Pour le retrouver, « Connecter cet ordinateur » depuis l’ordinateur lui-même.')}
        confirmLabel={t('Délier')}
        danger
        onClose={() => setADelier(null)}
        onConfirm={() => {
          const o = aDelier;
          setADelier(null);
          if (o) void agir(o.id, { type: 'ordinateur.delier', id: o.id });
        }}
      />
    </div>
  );
}

/** Le système d'un ordinateur, en clair. */
function nomDuSysteme(o: Ordinateur): string | null {
  const s = o.programme?.systeme;
  return !o.programme ? null : s === 'windows' ? 'Windows' : s === 'linux' ? 'Linux' : 'Mac';
}

/** L'état de Beluga Connect sur un ordinateur, en clair. */
function etatDeConnect(o: Ordinateur): string {
  const p = o.programme;
  if (!p) return t('Pas installé : connectez cet ordinateur depuis l’ordinateur lui-même.');
  const marche =
    p.etat === 'mac-verrouille' ? t('Mac verrouillé') : p.etat === 'pret' || p.etat === 'recopie-fermee' ? t('En marche') : t('Éteint');
  const version = p.connect ? t('version {v}', { v: p.connect }) : t('ancienne version : réinstallez Beluga Connect');
  return [nomDuSysteme(o), marche, version].filter(Boolean).join(' · ');
}

function Silhouette() {
  return (
    <div className="flex flex-col gap-2 px-3.5 py-3" data-silhouette>
      {[0, 1].map((i) => (
        <div key={i} className="h-9 animate-pulse rounded-lg bg-raised" />
      ))}
    </div>
  );
}

function versionPlusAncienne(a: string | null, b: string): boolean {
  if (!a) return false;
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  return false;
}

/** Ce qu'on lit sous le nom d'un ordinateur : allumé ou vu quand, ses navigateurs, Beluga Connect. */
function detailDOrdinateur(o: Ordinateur): string {
  const vu = ordinateurVuLe(o);
  const etat = ordinateurEnLigne(o) ? t('Allumé') : vu ? t('Vu {quand}', { quand: relativeTime(vu) }) : t('Jamais vu');
  const navigateurs = o.navigateurs.length
    ? o.navigateurs.map((n) => `${LIBELLE_DU_NAVIGATEUR[n.genre]}${n.enLigne ? '' : ` (${t('fermé')})`}`).join(', ')
    : t('aucun navigateur');
  const programme = !o.programme
    ? t('Beluga Connect à installer')
    : o.programme.etat === 'mac-verrouille'
      ? t('Mac verrouillé')
      : o.programme.etat === 'pret' || o.programme.etat === 'recopie-fermee'
        ? t('Beluga Connect en marche')
        : t('Beluga Connect éteint');
  /* Le programme répond : dit-il ses autorisations ? (Rien : ancienne version, sans nom dans les réglages de macOS.) */
  const autorisations =
    !o.programme || !programmeEnLigne(o.programme)
      ? null
      : o.programme.autorisations === null
        ? t('ancienne version : réinstallez Beluga Connect')
        : autorisationsDonnees(o.programme)
          ? null
          : t('autorisations de macOS à donner');
  const agents = o.navigateurs.reduce((n, x) => n + x.agentsAuTravail, 0);
  return [etat, navigateurs, programme, autorisations, agents ? t('{n} agent(s) au travail', { n: agents }) : null].filter(Boolean).join(' · ');
}

function LigneDOrdinateur({
  ordinateur,
  version,
  ici,
  occupe,
  onOuvrir,
  onRenommer,
  onDelier,
  onDelierNavigateur,
  onDelierProgramme,
}: {
  ordinateur: Ordinateur;
  version: string;
  ici: boolean;
  occupe: boolean;
  onOuvrir: () => void;
  onRenommer: () => void;
  onDelier: () => void;
  onDelierNavigateur: (n: NavigateurDOrdinateur) => void;
  onDelierProgramme: () => void;
}) {
  const allume = ordinateurEnLigne(ordinateur);
  const ancienne = ordinateur.navigateurs.some((n) => n.genre === 'chrome' && versionPlusAncienne(n.version, version));
  return (
    <div className="flex items-center gap-3 rounded-xl px-3.5 py-3" data-ordinateur={ordinateur.id} data-en-ligne={allume ? 'oui' : 'non'}>
      {/* UN CLIC SUR LA LIGNE ouvre la page de l'ordinateur : ses droits, ce qui est toujours demandé, ses autorisations. */}
      <button
        type="button"
        onClick={onOuvrir}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left hover:opacity-90"
        title={t('Ce que Beluga peut faire sur cet ordinateur')}
        data-ouvrir-ordinateur={ordinateur.id}
      >
      <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-raised text-muted">
        <Monitor className="h-4 w-4" />
        <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface ${allume ? 'bg-success' : 'bg-faint'}`} data-pastille-ordinateur />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[14px] text-text" data-nom-ordinateur>
            {ordinateur.nom}
          </span>
          {ici ? (
            <span className="shrink-0 rounded-full bg-raised px-2 py-0.5 text-[11.5px] text-muted" data-cet-ordinateur>
              {t('Cet ordinateur')}
            </span>
          ) : null}
        </span>
        <span className="text-[12.5px] text-muted">{detailDOrdinateur(ordinateur)}</span>
        {/* Un repère par navigateur relié (contrôles) : invisible, la phrase ci-dessus les dit déjà. */}
        {ordinateur.navigateurs.map((n) => (
          <span key={n.id} hidden data-chrome-relie={n.id} data-navigateur={n.genre} data-en-ligne={n.enLigne ? 'oui' : 'non'} />
        ))}
        {ancienne ? (
          <span className="text-[12.5px] text-teinte" data-nouvelle-version>
            {programmeEnLigne(ordinateur.programme)
              ? t('Nouvelle version de l’extension : Beluga Connect l’installe tout seul.')
              : t('Nouvelle version de l’extension : connectez cet ordinateur pour qu’elle s’installe toute seule.')}
          </span>
        ) : null}
      </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" disabled={occupe} title={t('Options')} data-options-ordinateur>
            {occupe ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <EllipsisVertical className="h-4 w-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {/* Le modèle commun des menus : l'élément, puis ce qu'on y relie, puis ce qu'on retire — en rouge, en dernier. */}
          <DropdownMenuItem onSelect={onRenommer} data-renommer-ordinateur>
            <PencilLine className="text-muted" />
            {t('Renommer')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {ordinateur.navigateurs.map((n) => (
            <DropdownMenuItem key={n.id} onSelect={() => onDelierNavigateur(n)} data-delier-navigateur={n.id}>
              <Link2Off className="text-muted" />
              {t('Délier {navigateur}', { navigateur: LIBELLE_DU_NAVIGATEUR[n.genre] })}
            </DropdownMenuItem>
          ))}
          {ordinateur.programme ? (
            <DropdownMenuItem onSelect={onDelierProgramme} data-delier-relais>
              <Link2Off className="text-muted" />
              {t('Délier Beluga Connect')}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem danger onSelect={onDelier} data-delier>
            <Trash2 />
            {t('Délier l’ordinateur')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** LE NOM D'UN ORDINATEUR : en créer un (puis le relier), ou le renommer. */
/** RENOMMER UN ORDINATEUR (la liaison le nomme d'après la machine ; on le change ici). */
function FenetreDeNom({ ordinateur, onClose, onFait }: { ordinateur: Ordinateur | null; onClose: () => void; onFait: () => void }) {
  const [nom, setNom] = React.useState('');
  const [envoi, setEnvoi] = React.useState(false);
  React.useEffect(() => {
    if (ordinateur) setNom(ordinateur.nom);
  }, [ordinateur]);
  const valider = async () => {
    if (!ordinateur || !nom.trim()) return;
    setEnvoi(true);
    try {
      await client.call({ type: 'ordinateur.renommer', id: ordinateur.id, nom: nom.trim() });
      onFait();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Le geste n’a pas abouti.'));
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <Dialog open={!!ordinateur} onOpenChange={(ouvert) => !ouvert && onClose()}>
      <DialogContent adresse="saisie" className="sm:w-[min(440px,100%)]" data-fenetre-nom-ordinateur>
        <DialogHeader>
          <DialogTitle>{t('Renommer l’ordinateur')}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void valider();
          }}
        >
          <Label htmlFor="nom-ordinateur">{t('Nom')}</Label>
          <Input id="nom-ordinateur" value={nom} maxLength={60} autoFocus placeholder={t('Mac mini du bureau')} onChange={(e) => setNom(e.target.value)} data-champ-nom-ordinateur />
        </form>
        <DialogFooter pleineLargeur>
          <Button onClick={() => void valider()} disabled={envoi || !nom.trim()} data-valider-nom-ordinateur>
            {envoi ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t('Renommer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const CLES_DU_MODE: Record<ModeDeSite, string> = {
  autorise: 'Autorisé',
  lecture_seule: 'Lecture seule',
  refuse: 'Refusé',
};

function LigneDeSite({ site, occupe, agir }: { site: SiteDuChrome; occupe: boolean; agir: (mode: ModeDeSite | null) => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl px-3.5 py-3" data-site={site.origine} data-mode={site.mode}>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14px] text-text">{site.origine.replace(/^https?:\/\//, '')}</span>
        <span className="text-[12.5px] text-muted">
          {[t(CLES_DU_MODE[site.mode]), site.chromeNom, relativeTime(site.decideLe)].filter(Boolean).join(' · ')}
        </span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" disabled={occupe} title={t('Options')} data-options-site>
            {occupe ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <EllipsisVertical className="h-4 w-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {(['autorise', 'lecture_seule', 'refuse'] as const)
            .filter((m) => m !== site.mode)
            .map((m) => (
              <DropdownMenuItem key={m} onSelect={() => agir(m)} data-mode-site={m}>
                {m === 'autorise' ? <ShieldCheck className="text-muted" /> : m === 'lecture_seule' ? <Eye className="text-muted" /> : <ShieldOff className="text-muted" />}
                {t(CLES_DU_MODE[m])}
              </DropdownMenuItem>
            ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem danger onSelect={() => agir(null)} data-retirer-site>
            <Trash2 />
            {t('Retirer')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function LigneDeRoutine({ routine, occupe, agir }: { routine: RoutineChrome; occupe: boolean; agir: (patch: Record<string, unknown>) => void }) {
  const prochaine = new Date(routine.prochaineEcheance);
  return (
    <div className="flex items-center gap-3 rounded-xl px-3.5 py-3" data-routine={routine.id} data-actif={routine.actif ? 'oui' : 'non'}>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14px] text-text">{routine.titre}</span>
        <span className="text-[12.5px] text-muted">
          {routine.actif
            ? t('{projet} · {phrase} · prochaine fois le {date}', { projet: routine.projet, phrase: routine.phrase, date: prochaine.toLocaleDateString() })
            : t('{projet} · en pause', { projet: routine.projet })}
        </span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" disabled={occupe} title={t('Options')} data-options-routine>
            {occupe ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <EllipsisVertical className="h-4 w-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => agir({ actif: !routine.actif })}>
            {routine.actif ? <Pause className="text-muted" /> : <Play className="text-muted" />}
            {routine.actif ? t('Mettre en pause') : t('Reprendre')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => agir({ frequence: routine.reglage.frequence === 'semaine' ? 'mois' : 'semaine' })}>
            <Repeat className="text-muted" />
            {routine.reglage.frequence === 'semaine' ? t('Passer à chaque mois') : t('Passer à chaque semaine')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem danger onSelect={() => agir({ supprimer: true })} data-supprimer-routine>
            <Trash2 />
            {t('Supprimer')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* La page d'un ordinateur : ce que Beluga a le droit d'y faire          */
/* ------------------------------------------------------------------ */

/** Les droits, dans l'ordre de la page, avec leur libellé et leur explication (textes d'écran, traduits). */
function lignesDesDroits(): { droit: DroitDOrdinateur; libelle: string; detail: string }[] {
  return [
    { droit: 'applications', libelle: t('Ouvrir et fermer des applications'), detail: t('Lancer Xcode, le Finder, Musique… et les refermer.') },
    { droit: 'reglages', libelle: t('Changer les réglages'), detail: t('Volume, luminosité, mode sombre, Wi‑Fi, mise en veille de l’écran.') },
    { droit: 'pilotage_apps', libelle: t('Piloter vos applications'), detail: t('Créer un rendez‑vous dans Calendrier, préparer un courriel dans Mail. Le Mac demande une fois l’accord par application.') },
    { droit: 'ecran', libelle: t('Voir l’écran et cliquer'), detail: t('Regarder l’écran, cliquer et taper dans n’importe quel logiciel.') },
    { droit: 'terminal', libelle: t('Terminal'), detail: t('Taper des commandes. Chacune vous est demandée avant de partir.') },
  ];
}

/**
 * LA PAGE D'UN ORDINATEUR (carte « Piloter le Mac depuis Beluga », 21/11/2026, maquette #3eb73) : elle remplace la
 * liste, dans la fenêtre des réglages, à droite du menu. « ‹ Vos ordinateurs » ramène à la liste ; un bouton par
 * ordinateur passe de l'un à l'autre. Cinq droits à interrupteur (tout allumé sauf le terminal à la liaison), ce qui
 * est TOUJOURS demandé (suppressions, commandes), puis les deux autorisations que macOS exige sur le Mac lui-même.
 */
function PageDUnOrdinateur({
  ordinateur,
  ordinateurs,
  ici,
  safari,
  onChoisir,
  onRetour,
  relire,
}: {
  ordinateur: Ordinateur;
  ordinateurs: Ordinateur[];
  /** L'ordinateur sur lequel on est (reconnu par l'extension), s'il l'est. */
  ici: string | null;
  /** L'application Safari est-elle fabriquée sur ce Beluga ? */
  safari: boolean;
  onChoisir: (id: string) => void;
  onRetour: () => void;
  relire: () => Promise<void>;
}) {
  const [envoi, setEnvoi] = React.useState<DroitDOrdinateur | null>(null);
  /* L'état affiché tout de suite au clic ; le serveur le confirme (relecture), un refus le rétablit. */
  const [local, setLocal] = React.useState<Partial<Record<DroitDOrdinateur, boolean>>>({});
  React.useEffect(() => {
    setLocal({});
  }, [ordinateur.id]);
  /* La page remplace la liste dans la MÊME zone qui défile : elle s'ouvre par son haut, pas là où la liste en était. */
  const racine = React.useRef<HTMLDivElement>(null);
  /* Entre accolades : Chrome 152 fait rendre une promesse à `scrollIntoView`, que React prendrait pour un nettoyage. */
  React.useLayoutEffect(() => {
    racine.current?.scrollIntoView({ block: 'start' });
  }, [ordinateur.id]);
  const droits = { ...droitsDeLOrdinateur(ordinateur.droits), ...local };
  const allume = ordinateurEnLigne(ordinateur);
  const systeme = ordinateur.programme ? (ordinateur.programme.systeme ?? 'mac') : null;
  const estUnMac = systeme === 'mac';
  const [safariOuvert, setSafariOuvert] = React.useState(false);
  const [delier, setDelier] = React.useState<string | null>(null);
  const delierUnNavigateur = async (n: NavigateurDOrdinateur) => {
    setDelier(n.id);
    try {
      await client.call({ type: 'extension.delier', id: n.id });
      await relire();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Le geste n’a pas abouti.'));
    } finally {
      setDelier(null);
    }
  };

  const changer = async (droit: DroitDOrdinateur, actif: boolean) => {
    setEnvoi(droit);
    setLocal((l) => ({ ...l, [droit]: actif }));
    try {
      await client.call({ type: 'ordinateur.droits', id: ordinateur.id, droit, actif });
      await relire();
    } catch (err: any) {
      setLocal((l) => {
        const { [droit]: _, ...reste } = l;
        return reste;
      });
      client.pushToast('error', err?.message ?? t('Le geste n’a pas abouti.'));
    } finally {
      setEnvoi(null);
    }
  };

  return (
    <div ref={racine} className="flex scroll-mt-4 flex-col gap-7" data-page-ordinateur={ordinateur.id}>
      <div className="flex flex-col gap-3">
        <button type="button" onClick={onRetour} className="flex w-fit items-center gap-0.5 rounded px-1 text-[13px] text-muted hover:text-text" data-retour-ordinateurs>
          <ChevronLeft className="h-4 w-4" />
          {t('Vos ordinateurs')}
        </button>
        <div className="flex flex-col gap-0.5 px-1">
          <div className="flex min-w-0 items-center gap-2.5">
            <h3 className="min-w-0 truncate text-[17px] font-semibold text-text" data-nom-ordinateur-ouvert>
              {ordinateur.nom}
            </h3>
            <EtatDeLOrdinateur allume={allume} />
            {ici === ordinateur.id ? (
              <span className="shrink-0 rounded-full bg-raised px-2 py-0.5 text-[11.5px] text-muted" data-cet-ordinateur>
                {t('Cet ordinateur')}
              </span>
            ) : null}
          </div>
          <p className="text-[12.5px] text-muted">{detailDOrdinateur(ordinateur)}</p>
        </div>
        {ordinateurs.length > 1 ? (
          <div className="flex flex-wrap gap-1.5 px-1" data-choix-ordinateur>
            {ordinateurs.map((o) => (
              <Button key={o.id} variant={o.id === ordinateur.id ? 'default' : 'subtle'} size="md" onClick={() => onChoisir(o.id)} data-aller-ordinateur={o.id} aria-pressed={o.id === ordinateur.id}>
                <FormeDEtat allume={ordinateurEnLigne(o)} />
                <span className="max-w-[180px] truncate">{o.nom}</span>
              </Button>
            ))}
          </div>
        ) : null}
      </div>

      <RubriqueDeReglages
        titre={estUnMac ? t('Ce que Beluga peut faire sur ce Mac') : t('Ce que Beluga peut faire sur cet ordinateur')}
        description={
          estUnMac
            ? t('Un droit éteint est refusé à l’agent, même s’il le demande.')
            : systeme
              ? t('Sur Windows et Linux, Beluga Connect relie Chrome ; ces gestes sur l’ordinateur lui-même n’existent que sur un Mac pour l’instant. Les droits s’appliqueront dès qu’ils arriveront.')
              : t('Beluga Connect n’est pas encore installé sur cet ordinateur : ces droits s’appliqueront dès qu’il le sera.')
        }
      >
        {lignesDesDroits().map((l) => (
          <LigneDeReglage
            key={l.droit}
            libelle={l.libelle}
            detail={l.detail}
            controle={
              <Switch
                checked={droits[l.droit]}
                attente={envoi === l.droit}
                onCheckedChange={(actif) => void changer(l.droit, actif)}
                aria-label={l.libelle}
                data-droit={l.droit}
                data-actif={droits[l.droit] ? 'oui' : 'non'}
              />
            }
          />
        ))}
      </RubriqueDeReglages>

      <RubriqueDeReglages titre={t('Toujours demandé')} description={t('Ces gestes attendent votre accord dans une fenêtre de Beluga, quels que soient les réglages.')}>
        <LigneDeReglage
          libelle={t('Supprimer un fichier, un dossier ou une application')}
          detail={t('Redemandé à chaque fois, même pendant une carte déjà autorisée.')}
          controle={<span className="text-[13px] text-muted">{t('À chaque fois')}</span>}
        />
        <LigneDeReglage
          libelle={t('Commandes du terminal')}
          detail={t('Une par une, ou pour toute une carte jusqu’à la fin de son travail.')}
          controle={<span className="text-[13px] text-muted">{t('À chaque fois')}</span>}
        />
      </RubriqueDeReglages>

      <RubriqueDeReglages titre={CONNECT} description={t('L’application qui relie cet ordinateur à Beluga, installe l’extension de Chrome et la tient à jour.')}>
        <LigneDeReglage libelle={CONNECT} detail={etatDeConnect(ordinateur)} controle={<FormeDEtat allume={programmeEnLigne(ordinateur.programme)} />} />
      </RubriqueDeReglages>

      <RubriqueDeReglages titre={t('Navigateurs')} description={t('Les navigateurs de cet ordinateur où les agents travaillent.')}>
        {ordinateur.navigateurs.length ? (
          ordinateur.navigateurs.map((n) => (
            <LigneDeReglage
              key={n.id}
              libelle={LIBELLE_DU_NAVIGATEUR[n.genre]}
              detail={[
                n.enLigne ? t('Ouvert') : t('Fermé'),
                n.version ? t('version {v}', { v: n.version }) : null,
                n.incognito === true ? t('autorisé en navigation privée') : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              controle={
                <Button variant="subtle" size="md" className="max-sm:w-full" onClick={() => void delierUnNavigateur(n)} disabled={!!delier} data-delier-navigateur={n.id}>
                  {delier === n.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2Off className="h-3.5 w-3.5" />}
                  {t('Délier')}
                </Button>
              }
            />
          ))
        ) : (
          <p className="px-3.5 py-3 text-[13.5px] text-muted">{t('Aucun navigateur relié : Beluga Connect prépare Chrome dès qu’il est en marche.')}</p>
        )}
        {estUnMac && safari && !ordinateur.navigateurs.some((n) => n.genre === 'safari') ? (
          <LigneDeReglage
            libelle={t('Beluga pour Safari')}
            detail={t('Pour travailler aussi dans Safari : une application signée et un code.')}
            controle={
              <Button variant="subtle" size="md" className="max-sm:w-full" onClick={() => setSafariOuvert(true)} data-ajouter-safari>
                <Plus className="h-3.5 w-3.5" />
                {t('Ajouter Safari')}
              </Button>
            }
          />
        ) : null}
      </RubriqueDeReglages>

      {estUnMac ? <AutorisationsDeMacOS ordinateur={ordinateur} /> : null}
      <FenetreSafari ordinateur={ordinateur} ouverte={safariOuvert} onClose={() => setSafariOuvert(false)} />
    </div>
  );
}

/** Allumé : un ROND vert ; éteint : un CARRÉ gris — l'état se lit par la forme, pas seulement par la couleur. */
function FormeDEtat({ allume }: { allume: boolean }) {
  /* Le vert FIXE des coches (`coche`, comme l'assistant d'installation) : `success` est gris dans les palettes monochromes. */
  return allume ? <span className="h-2 w-2 shrink-0 rounded-full bg-coche" aria-hidden /> : <span className="h-2 w-2 shrink-0 bg-faint" aria-hidden />;
}

function EtatDeLOrdinateur({ allume }: { allume: boolean }) {
  return (
    <span className={`flex shrink-0 items-center gap-1.5 text-[12.5px] ${allume ? 'text-coche' : 'text-muted'}`} data-etat-ordinateur={allume ? 'allume' : 'eteint'}>
      <FormeDEtat allume={allume} />
      {allume ? t('Allumé') : t('Éteint')}
    </span>
  );
}

/** Les deux autorisations que macOS exige SUR LE MAC : affichées, et le bon réglage s'ouvre à distance. */
function AutorisationsDeMacOS({ ordinateur, titre }: { ordinateur: Ordinateur; titre?: string }) {
  const [ouverture, setOuverture] = React.useState<'accessibilite' | 'ecran' | null>(null);
  const a = ordinateur.programme?.autorisations ?? null;
  const rouvrir = async (reglage: 'accessibilite' | 'ecran') => {
    setOuverture(reglage);
    try {
      await client.call({ type: 'relaisMac.reglage', ordinateurId: ordinateur.id, reglage });
      client.pushToast('success', t('Le réglage s’est ouvert sur le Mac.'));
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Le geste n’a pas abouti.'));
    } finally {
      setOuverture(null);
    }
  };
  const lignes: { cle: 'accessibilite' | 'ecran'; titre: string; pour: string }[] = [
    { cle: 'accessibilite', titre: t('Contrôler la souris et le clavier'), pour: t('À donner sur le Mac : nécessaire pour cliquer, taper et changer la luminosité.') },
    { cle: 'ecran', titre: t('Voir l’écran'), pour: t('À donner sur le Mac : nécessaire pour « Voir l’écran et cliquer ».') },
  ];
  return (
    <RubriqueDeReglages titre={titre ?? t('Autorisations de macOS')} description={t('Apple exige un clic sur le Mac lui‑même, une seule fois. Beluga ouvre le bon réglage à distance.')}>
      {lignes.map((l) => {
        const donnee = a?.[l.cle] === true;
        return (
          <div key={l.cle} className="flex flex-col gap-2 rounded-xl px-3.5 py-3 sm:flex-row sm:items-center sm:gap-4" data-autorisation-mac={l.cle} data-donnee={donnee ? 'oui' : 'non'}>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-[14px] text-text">{l.titre}</span>
              {donnee ? null : <span className="text-[12.5px] text-important">{l.pour}</span>}
            </div>
            <div className="shrink-0">
              {donnee ? (
                <span className="flex items-center gap-1.5 text-[13px] text-coche">
                  <span className="h-2 w-2 rounded-full bg-coche" aria-hidden />
                  {t('Donnée')}
                </span>
              ) : (
                <Button variant="default" size="md" onClick={() => void rouvrir(l.cle)} disabled={!!ouverture || !programmeEnLigne(ordinateur.programme)} data-ouvrir-sur-le-mac={l.cle}>
                  {ouverture === l.cle ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {t('Ouvrir sur le Mac')}
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </RubriqueDeReglages>
  );
}
