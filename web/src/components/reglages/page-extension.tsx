import * as React from 'react';
import { Download, EllipsisVertical, Loader2, Monitor, Plus } from '@/components/ui/icones';
import {
  LIBELLE_DU_NAVIGATEUR,
  VERSION_EXTENSION_CHROME,
  autorisationsDonnees,
  ordinateurEnLigne,
  programmeEnLigne,
  ordinateurVuLe,
  type EtatDeLExtension,
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
  DropdownMenuTrigger,
  Input,
  Label,
} from '@/components/ui';
import { LigneDeReglage, RubriqueDeReglages } from '@/components/modeles';
import { client } from '@/lib/client';
import { relativeTime } from '@/lib/utils';
import { t } from '@/lib/langue';
import { AssistantDInstallation, type OuvertureDeLAssistant } from './assistant-installation';

/**
 * LA RUBRIQUE « EXTENSION » DES RÉGLAGES (carte « Pilotage de Chrome par Beluga », 09/11/2026 ; ORDINATEURS NOMMÉS,
 * carte « Choisir l'ordinateur visé depuis le téléphone », 15/11/2026).
 *
 * Télécharger l'extension (Chrome, réglée pour cette installation ; Safari, application signée fabriquée sur GitHub),
 * l'installer (ASSISTANT pas à pas, `assistant-installation.tsx`, carte « Installation guidée sur le Mac »), puis tenir la liste de VOS ORDINATEURS : chacun nommé (renommable), allumé ou non, avec ses navigateurs
 * reliés et son programme du Mac ; son menu relie un navigateur (code à usage unique) ou installe le programme du Mac
 * (commande à coller dans le Terminal), et le délie. Puis les sites et leur mode, et les gestes répétés.
 */
export function PageExtension() {
  const [etat, setEtat] = React.useState<EtatDeLExtension | null>(null);
  const [enCours, setEnCours] = React.useState<string | null>(null);
  const [aDelier, setADelier] = React.useState<Ordinateur | null>(null);
  /* La fenêtre de nom : créer un ordinateur (`null`) ou renommer celui donné. */
  const [aNommer, setANommer] = React.useState<{ ordinateur: Ordinateur | null } | null>(null);
  /* L'assistant d'installation : ouvert par « Télécharger », « Ajouter » ou « Relier… » d'un ordinateur. */
  const [assistant, setAssistant] = React.useState<OuvertureDeLAssistant | null>(null);

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

  return (
    <div className="flex flex-col gap-7" data-page-extension>
      <RubriqueDeReglages
        titre={t('L’extension Beluga')}
        description={t('Reliez le navigateur de chaque ordinateur à Beluga : les agents pourront y ouvrir leurs onglets, lire, cliquer et écrire, avec les comptes où vous êtes déjà connecté.')}
      >
        <LigneDeReglage
          libelle={t('Beluga pour Chrome')}
          detail={t('Version {v} · déjà réglée pour cette installation', { v: VERSION_EXTENSION_CHROME })}
          controle={
            <Button variant="default" size="md" onClick={() => setAssistant({ navigateur: 'chrome' })} data-telecharger-extension>
              <Download className="h-3.5 w-3.5" />
              {t('Télécharger')}
            </Button>
          }
        />
        <LigneDeReglage
          libelle={t('Beluga pour Safari')}
          detail={
            etat?.safari.disponible
              ? t('Application pour Mac, signée par Apple{v}', { v: etat.safari.version ? ` · ${t('version {v}', { v: etat.safari.version })}` : '' })
              : t('Pas encore fabriquée : elle le sera à la prochaine version de l’extension.')
          }
          controle={
            etat?.safari.disponible ? (
              <Button variant="subtle" size="md" onClick={() => setAssistant({ navigateur: 'safari' })} data-telecharger-safari>
                <Download className="h-3.5 w-3.5" />
                {t('Télécharger')}
              </Button>
            ) : (
              <Button variant="subtle" size="md" disabled data-telecharger-safari="indisponible">
                <Download className="h-3.5 w-3.5" />
                {t('Télécharger')}
              </Button>
            )
          }
        />
      </RubriqueDeReglages>

      <RubriqueDeReglages
        titre={t('Vos ordinateurs')}
        description={t('Chaque ordinateur porte ses navigateurs reliés et, sur un Mac, son programme. Depuis le téléphone, choisissez celui où les agents travaillent avec le bouton « Ordinateur » de la barre d’écriture.')}
      >
        {!etat ? (
          <Silhouette />
        ) : etat.ordinateurs.length ? (
          etat.ordinateurs.map((o) => (
            <LigneDOrdinateur
              key={o.id}
              ordinateur={o}
              version={etat.version}
              occupe={enCours === o.id}
              onRenommer={() => setANommer({ ordinateur: o })}
              onRelier={() => setAssistant({ ordinateurId: o.id })}
              onDelier={() => setADelier(o)}
              onDelierNavigateur={(n) => void agir(o.id, { type: 'extension.delier', id: n.id })}
              onDelierProgramme={() => void agir(o.id, { type: 'relaisMac.delier', ordinateurId: o.id })}
            />
          ))
        ) : (
          <p className="px-3.5 py-3 text-[13.5px] text-muted">{t('Aucun ordinateur n’est relié pour l’instant.')}</p>
        )}
        <LigneDeReglage
          libelle={t('Ajouter un ordinateur')}
          detail={t('Donnez-lui un nom, puis reliez son navigateur ou son programme du Mac.')}
          controle={
            <Button variant="subtle" size="md" onClick={() => setAssistant({ ordinateurId: null })} data-nouveau-code data-ajouter-ordinateur>
              <Plus className="h-3.5 w-3.5" />
              {t('Ajouter')}
            </Button>
          }
        />
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
        cible={aNommer}
        onClose={() => setANommer(null)}
        onFait={(id, cree) => {
          setANommer(null);
          void lire();
          if (cree) setAssistant({ ordinateurId: id });
        }}
      />
      <AssistantDInstallation ouverture={assistant} etat={etat} onClose={() => setAssistant(null)} relire={lire} />
      <ConfirmDialog
        open={!!aDelier}
        title={t('Délier « {nom} » ?', { nom: aDelier?.nom ?? '' })}
        description={t('Ses navigateurs et son programme du Mac ne pourront plus être pilotés. Il faudra un nouveau code pour le relier.')}
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

/** Ce qu'on lit sous le nom d'un ordinateur : allumé ou vu quand, ses navigateurs, son programme du Mac. */
function detailDOrdinateur(o: Ordinateur): string {
  const vu = ordinateurVuLe(o);
  const etat = ordinateurEnLigne(o) ? t('Allumé') : vu ? t('Vu {quand}', { quand: relativeTime(vu) }) : t('Jamais vu');
  const navigateurs = o.navigateurs.length
    ? o.navigateurs.map((n) => `${LIBELLE_DU_NAVIGATEUR[n.genre]}${n.enLigne ? '' : ` (${t('fermé')})`}`).join(', ')
    : t('aucun navigateur');
  const programme = !o.programme
    ? null
    : o.programme.etat === 'mac-verrouille'
      ? t('Mac verrouillé')
      : o.programme.etat === 'pret' || o.programme.etat === 'recopie-fermee'
        ? t('programme du Mac en marche')
        : t('programme du Mac éteint');
  /* Le programme répond : dit-il ses autorisations ? (Rien : ancienne version, sans nom dans les réglages de macOS.) */
  const autorisations =
    !o.programme || !programmeEnLigne(o.programme)
      ? null
      : o.programme.autorisations === null
        ? t('ancienne version du programme : réinstallez-le')
        : autorisationsDonnees(o.programme)
          ? null
          : t('autorisations de macOS à donner');
  const agents = o.navigateurs.reduce((n, x) => n + x.agentsAuTravail, 0);
  return [etat, navigateurs, programme, autorisations, agents ? t('{n} agent(s) au travail', { n: agents }) : null].filter(Boolean).join(' · ');
}

function LigneDOrdinateur({
  ordinateur,
  version,
  occupe,
  onRenommer,
  onRelier,
  onDelier,
  onDelierNavigateur,
  onDelierProgramme,
}: {
  ordinateur: Ordinateur;
  version: string;
  occupe: boolean;
  onRenommer: () => void;
  onRelier: () => void;
  onDelier: () => void;
  onDelierNavigateur: (n: NavigateurDOrdinateur) => void;
  onDelierProgramme: () => void;
}) {
  const allume = ordinateurEnLigne(ordinateur);
  const ancienne = ordinateur.navigateurs.some((n) => n.genre === 'chrome' && versionPlusAncienne(n.version, version));
  return (
    <div className="flex items-center gap-3 rounded-xl px-3.5 py-3" data-ordinateur={ordinateur.id} data-en-ligne={allume ? 'oui' : 'non'}>
      <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-raised text-muted">
        <Monitor className="h-4 w-4" />
        <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface ${allume ? 'bg-success' : 'bg-faint'}`} data-pastille-ordinateur />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14px] text-text" data-nom-ordinateur>
          {ordinateur.nom}
        </span>
        <span className="text-[12.5px] text-muted">{detailDOrdinateur(ordinateur)}</span>
        {/* Un repère par navigateur relié (contrôles) : invisible, la phrase ci-dessus les dit déjà. */}
        {ordinateur.navigateurs.map((n) => (
          <span key={n.id} hidden data-chrome-relie={n.id} data-navigateur={n.genre} data-en-ligne={n.enLigne ? 'oui' : 'non'} />
        ))}
        {ancienne ? (
          <span className="text-[12.5px] text-teinte" data-nouvelle-version>
            {t('Nouvelle version disponible : retéléchargez l’extension sur ce poste.')}
          </span>
        ) : null}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" disabled={occupe} title={t('Options')} data-options-ordinateur>
            {occupe ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <EllipsisVertical className="h-4 w-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onRenommer} data-renommer-ordinateur>
            {t('Renommer')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onRelier} data-relier-ordinateur>
            {t('Relier un navigateur ou le programme du Mac')}
          </DropdownMenuItem>
          {ordinateur.navigateurs.map((n) => (
            <DropdownMenuItem key={n.id} onSelect={() => onDelierNavigateur(n)} data-delier-navigateur={n.id}>
              {t('Délier {navigateur}', { navigateur: LIBELLE_DU_NAVIGATEUR[n.genre] })}
            </DropdownMenuItem>
          ))}
          {ordinateur.programme ? (
            <DropdownMenuItem onSelect={onDelierProgramme} data-delier-relais>
              {t('Délier le programme du Mac')}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={onDelier} className="text-danger" data-delier>
            {t('Délier l’ordinateur')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** LE NOM D'UN ORDINATEUR : en créer un (puis le relier), ou le renommer. */
function FenetreDeNom({ cible, onClose, onFait }: { cible: { ordinateur: Ordinateur | null } | null; onClose: () => void; onFait: (id: string, cree: boolean) => void }) {
  const [nom, setNom] = React.useState('');
  const [envoi, setEnvoi] = React.useState(false);
  React.useEffect(() => {
    if (cible) setNom(cible.ordinateur?.nom ?? '');
  }, [cible]);
  const valider = async () => {
    if (!cible || !nom.trim()) return;
    setEnvoi(true);
    try {
      if (cible.ordinateur) {
        await client.call({ type: 'ordinateur.renommer', id: cible.ordinateur.id, nom: nom.trim() });
        onFait(cible.ordinateur.id, false);
      } else {
        const r = await client.call<{ id: string }>({ type: 'ordinateur.creer', nom: nom.trim() });
        onFait(r.id, true);
      }
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Le geste n’a pas abouti.'));
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <Dialog open={!!cible} onOpenChange={(ouvert) => !ouvert && onClose()}>
      <DialogContent adresse="saisie" className="sm:w-[min(440px,100%)]" data-fenetre-nom-ordinateur>
        <DialogHeader>
          <DialogTitle>{cible?.ordinateur ? t('Renommer l’ordinateur') : t('Ajouter un ordinateur')}</DialogTitle>
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
            {cible?.ordinateur ? t('Renommer') : t('Ajouter')}
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
                {t(CLES_DU_MODE[m])}
              </DropdownMenuItem>
            ))}
          <DropdownMenuItem onSelect={() => agir(null)} data-retirer-site>
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
          <DropdownMenuItem onSelect={() => agir({ actif: !routine.actif })}>{routine.actif ? t('Mettre en pause') : t('Reprendre')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => agir({ frequence: routine.reglage.frequence === 'semaine' ? 'mois' : 'semaine' })}>
            {routine.reglage.frequence === 'semaine' ? t('Passer à chaque mois') : t('Passer à chaque semaine')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => agir({ supprimer: true })} data-supprimer-routine>
            {t('Supprimer')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
