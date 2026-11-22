import * as React from 'react';
import { ArrowRight, Check, Copy, Download, Folder, Loader2, LoaderCircle, RefreshCw, X } from '@/components/ui/icones';
import {
  LIBELLE_DU_NAVIGATEUR,
  VERSION_EXTENSION_CHROME,
  autorisationsDonnees,
  codeDeLiaisonLisible,
  codeDeSecoursAMontrer,
  etapesDeLaPreparation,
  preparationVue,
  PREPARATION_FIGEE_APRES_MS,
  SECOURS_APRES_MS,
  ordinateurReconnu,
  programmeEnLigne,
  systemeDeLAppareil,
  versionAuMoins,
  type EtatDeLExtension,
  type GenreDeNavigateur,
  type NavigateurDOrdinateur,
  type Ordinateur,
  type SystemeDOrdinateur,
} from '@beluga/shared';
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui';
import { client } from '@/lib/client';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';
import { noterLaConnexionEnCours } from './suivi-de-connect';

/**
 * « AJOUTER CET ORDINATEUR » — carte « Liaison d'ordinateur simplifiée » (22/11/2026), qui refait le parcours de la carte
 * « Beluga Connect : installation simplifiée » (21/11/2026).
 *
 * UN CLIC « LIER » (ligne « Ajouter cet ordinateur » de Réglages › Ordinateurs), PUIS TOUT DANS LE MÊME ONGLET : le
 * clic télécharge Beluga Connect pour le système de CET appareil (Mac : image disque « glisser dans Applications » ;
 * Windows : .exe ; Linux : une commande à coller), puis les étapes empilées s'ouvrent et se cochent d'elles-mêmes
 * d'après l'état poussé par le démon (canal temps réel) — Beluga Connect installé, relié, autorisations de macOS (Mac
 * seulement), Chrome prêt (extension posée et reliée par Beluga Connect).
 *
 * L'ORDINATEUR VISÉ se reconnaît tout seul (`ordinateurReconnu`, shared/src/connecter-un-ordinateur.ts) : celui du
 * navigateur courant (l'extension 1.0.14 pose son identifiant d'appareil sur la page), sinon celui dont Beluga Connect
 * s'est relié après le code émis au clic. Aucun nom à donner : la liaison nomme l'ordinateur d'après la machine.
 *
 * LA LIAISON SANS CODE À TAPER ET SANS NOUVEL ONGLET : le code à six chiffres émis au clic (usage unique, dix minutes,
 * lié au compte) voyage avec le fichier — en remorque sous Windows et Linux, dans l'ADRESSE du téléchargement sur Mac
 * (la quarantaine de macOS la garde ; Beluga Connect 1.3 la relit et se relie par `/api/relais-mac/relier`). Le clic
 * « Lier » vaut l'accord. Sans code lisible (ancien Beluga Connect, code expiré), l'application retombe sur « Relier ce
 * Mac ? » (`FenetreDeLiaison`, page `?liaison=`). La page n'ouvre jamais de lien `beluga-connect://` (Chrome le bloque).
 */

type Cle = 'installer' | 'relier' | 'autorisations' | 'navigateur';
/** Les noms propres : les mêmes dans toutes les langues. */
const CONNECT = ['Beluga', 'Connect'].join(' ');
/** L'orange des réponses attendues : c'est à la personne (ou à son ordinateur) de faire le geste. */
const ORANGE = 'hsl(var(--cadre-question))';

/** Ce que l'appareil courant dit de lui (Mac, Windows, Linux ; `null` : téléphone, tablette). */
export function systemeDeCetAppareil(): SystemeDOrdinateur | null {
  if (typeof navigator === 'undefined') return null;
  const ua = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return systemeDeLAppareil({ userAgent: navigator.userAgent, platform: navigator.platform, plateformeUA: ua?.platform ?? null });
}

/** Le navigateur où l'on est, en clair (ligne « Ajouter cet ordinateur ») : jamais un nom de machine inventé. */
export function navigateurDeCetAppareil(): string | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return null;
}

/**
 * LE NAVIGATEUR COURANT, tel que l'extension Beluga l'annonce sur la page (`data-beluga-navigateur`, 1.0.14) :
 * l'identifiant d'appareil de ce Chrome, ou `null` (pas d'extension, ou pas encore reliée).
 */
export function useNavigateurCourant(): string | null {
  const lire = () => (typeof document === 'undefined' ? null : document.documentElement.dataset.belugaNavigateur || null);
  const [id, setId] = React.useState<string | null>(lire);
  React.useEffect(() => {
    const relire = () => setId(lire());
    const observateur = new MutationObserver(relire);
    observateur.observe(document.documentElement, { attributes: true, attributeFilter: ['data-beluga-navigateur'] });
    window.addEventListener('beluga:extension-presente', relire);
    relire();
    return () => {
      observateur.disconnect();
      window.removeEventListener('beluga:extension-presente', relire);
    };
  }, []);
  return id;
}

/** Le Chrome d'un ordinateur à juger : celui en ligne d'abord, puis le plus récent. */
function chromeDe(o: Ordinateur | null): NavigateurDOrdinateur | null {
  return o?.navigateurs.filter((n) => n.genre === 'chrome').sort((a, b) => Number(b.enLigne) - Number(a.enLigne) || (b.vuLe ?? 0) - (a.vuLe ?? 0))[0] ?? null;
}

/** L'ordinateur a-t-il tout ce qu'il faut ? Beluga Connect en marche, autorisations (Mac), Chrome prêt. */
export function ordinateurPret(o: Ordinateur | null): boolean {
  if (!o) return false;
  const p = o.programme;
  const nav = chromeDe(o);
  const mac = (p?.systeme ?? 'mac') === 'mac';
  return (
    programmeEnLigne(p) &&
    !!p?.connect &&
    autorisationsDonnees(p) &&
    !!nav?.enLigne &&
    versionAuMoins(nav.version, VERSION_EXTENSION_CHROME) &&
    (!mac || nav.incognito === true)
  );
}

/**
 * L'adresse du paquet de Beluga Connect pour un système, personnalisée par le code. Windows / Linux : le code voyage
 * en remorque du fichier. MAC (carte « Liaison d'ordinateur simplifiée », 22/11/2026) : l'image disque « glisser dans
 * Applications » ; le code reste dans l'ADRESSE du téléchargement, que macOS garde dans sa quarantaine et que Beluga
 * Connect relit au premier lancement pour se relier SEUL, sans ouvrir de page.
 */
function adresseDuPaquet(systeme: SystemeDOrdinateur, code: string | null): string {
  if (systeme === 'mac') return `/api/connect/Beluga-Connect.dmg${code ? `?code=${code}` : ''}`;
  const q = code ? `?code=${code}&base=${encodeURIComponent(window.location.origin)}` : '';
  if (systeme === 'windows') return `/api/connect/Beluga-Connect-Windows.exe${q}`;
  return `/api/connect/installer-linux.sh${q}`;
}

function commandeLinux(code: string): string {
  return `curl -fsSL '${window.location.origin}${adresseDuPaquet('linux', code)}' | sh`;
}

function telechargerLeFichier(href: string, nom: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = nom;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function copier(texte: string, message: string) {
  void navigator.clipboard?.writeText(texte).then(() => client.pushToast('success', message));
}

/* ------------------------------------------------------------------ */
/* Le parcours                                                          */
/* ------------------------------------------------------------------ */

export interface DepartDuParcours {
  /** Change à chaque clic sur « Lier » : un nouveau départ. */
  n: number;
  /** `telecharger` : le clic de la page ; `relier` : arrivée depuis un ancien Beluga Connect (`?connecter=1`) — le
   *  parcours s'affiche, sans rien ouvrir (la liaison part de l'application) ; `attendre` : rien à lancer. */
  mode: 'telecharger' | 'relier' | 'attendre';
}

/**
 * LE PARCOURS EN ÉTAPES EMPILÉES (carte « Liaison d'ordinateur simplifiée », 22/11/2026, maquettes validées #f1f1,
 * #bd11, #7251, #ba67) : quatre étapes l'une sous l'autre — Installer, Relier, Autorisations (Mac seulement), Chrome —
 * dans un groupe `bg-surface`. Seule l'étape en cours est OUVERTE (bloc `bg-raised`, rond noir numéroté, statut à
 * droite : orange quand on attend la personne, gris quand tout se fait seul) ; les étapes faites se replient sur leur
 * coche verte et « Fait » (un clic les rouvre en lecture) ; l'étape suivante s'ouvre d'elle-même, d'après l'état
 * poussé par le démon. Contenu EMPILÉ, jamais en colonnes : les consignes 1-2-3, puis l'image dessous.
 */
export function ParcoursDeConnexion({
  etat,
  depart,
  onFermer,
  onVoir,
  surFini,
  integre,
  ordinateurVise,
}: {
  etat: EtatDeLExtension;
  /** L'ordinateur déjà connu (fenêtre ouverte seule pendant l'installation, `suivi-de-connect.tsx`). */
  ordinateurVise?: string;
  depart: DepartDuParcours;
  /** « Revenir à la liste » sous le parcours fini ; absent (mise en route, fenêtre seule) : rien. */
  onFermer?: () => void;
  /** « Voir ses autorisations » sous le parcours fini : la page de l'ordinateur. */
  onVoir?: (ordinateurId: string) => void;
  surFini?: (fini: boolean) => void;
  /** Monté dans la mise en route : le téléchargement a son propre bouton dans la première étape. */
  integre?: boolean;
}) {
  const systemeAppareil = React.useMemo(systemeDeCetAppareil, []);
  const navigateurId = useNavigateurCourant();
  const [code, setCode] = React.useState<{ code: string; emisLe: number; expireLe: number } | null>(null);
  const [telechargeLe, setTelechargeLe] = React.useState<number | null>(null);
  const [cibleId, setCibleId] = React.useState<string | null>(ordinateurVise ?? null);
  const [envoi, setEnvoi] = React.useState(false);

  const ordinateurs = etat.ordinateurs;
  /* Reconnu (navigateur courant, ou liaison faite avec le code du parcours), puis retenu tant que le parcours vit. */
  const reconnu = ordinateurReconnu(ordinateurs, { navigateurId, codeEmisLe: code?.emisLe ?? null });
  React.useEffect(() => {
    if (reconnu && reconnu.id !== cibleId) setCibleId(reconnu.id);
  }, [reconnu, cibleId]);
  const cible = ordinateurs.find((o) => o.id === cibleId) ?? reconnu ?? null;
  const programme = cible?.programme ?? null;
  const systeme: SystemeDOrdinateur | null = programme?.systeme ?? systemeAppareil;
  const mac = systeme === 'mac';
  const nav = chromeDe(cible);

  const emettre = React.useCallback(async (ordinateurId: string | null) => {
    const r = await client.call<{ code: string; expireLe: number }>({ type: 'relaisMac.code', ordinateurId: ordinateurId ?? undefined });
    const neuf = { ...r, emisLe: Date.now() };
    setCode(neuf);
    /* CE navigateur est celui de l'ordinateur qu'on installe : la fenêtre de connexion pourra s'y ouvrir seule. */
    noterLaConnexionEnCours(neuf.emisLe);
    return neuf;
  }, []);

  /* LE DÉPART : au clic, un code (pour l'ordinateur reconnu, sinon un nouveau), puis le bon fichier pour CE système.
     Un ordinateur déjà relié dont Beluga Connect répond ne retélécharge rien : le parcours se coche tel quel. */
  const departe = React.useCallback(
    async (mode: DepartDuParcours['mode']) => {
      const deja = ordinateurReconnu(ordinateurs, { navigateurId });
      if (deja && programmeEnLigne(deja.programme)) {
        setCibleId(deja.id);
        setTelechargeLe(Date.now());
        return;
      }
      if (!systemeAppareil || mode === 'attendre' || mode === 'relier') return;
      setEnvoi(true);
      try {
        const c = await emettre(deja?.id ?? null);
        if (systemeAppareil === 'linux') copier(commandeLinux(c.code), t('Commande copiée.'));
        else telechargerLeFichier(adresseDuPaquet(systemeAppareil, c.code), systemeAppareil === 'mac' ? 'Beluga-Connect.dmg' : 'Beluga-Connect.exe');
        setTelechargeLe(Date.now());
      } catch (err: any) {
        client.pushToast('error', err?.message ?? t('Le geste n’a pas abouti.'));
      } finally {
        setEnvoi(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ordinateurs, navigateurId, systemeAppareil, emettre],
  );
  /* Un départ ne se joue qu'UNE fois (le mode strict de React rejoue les effets : sinon deux codes, deux fichiers). */
  const departJoue = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (departJoue.current === depart.n) return;
    departJoue.current = depart.n;
    void departe(depart.mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depart.n]);

  const relie = programmeEnLigne(programme) && !!programme?.connect;
  /* Installé = Beluga Connect s'est présenté à Beluga (la liaison par le code est faite) ; relié = il répond. */
  const installe = !!programme || relie;

  /* Le code expire avant la liaison : sous Linux seulement, la commande change avec lui. Sur Mac et Windows, le code
     est déjà DANS le fichier téléchargé : en émettre un neuf le tuerait (un seul code vivant par compte). */
  React.useEffect(() => {
    if (!code || installe || systemeAppareil !== 'linux') return;
    const minuteur = window.setTimeout(() => void emettre(cibleId).catch(() => undefined), Math.max(1_000, code.expireLe - Date.now() + 500));
    return () => window.clearTimeout(minuteur);
  }, [code, installe, cibleId, emettre, systemeAppareil]);

  const etapes: Cle[] = mac ? ['installer', 'relier', 'autorisations', 'navigateur'] : ['installer', 'relier', 'navigateur'];
  const faite: Record<Cle, boolean> = {
    installer: installe,
    relier: relie,
    autorisations: relie && autorisationsDonnees(programme),
    navigateur: !!nav?.enLigne && versionAuMoins(nav.version, VERSION_EXTENSION_CHROME) && (!mac || nav.incognito === true),
  };
  const toutFait = etapes.every((e) => faite[e]);
  const courante = etapes.find((e) => !faite[e]) ?? null;
  /* Une étape faite rouverte à la main, en lecture ; l'étape suivante qui s'ouvre seule la referme. */
  const [relue, setRelue] = React.useState<Cle | null>(null);
  React.useEffect(() => {
    setRelue(null);
  }, [courante]);
  const ouverte = relue ?? (toutFait ? null : courante);
  React.useEffect(() => {
    surFini?.(toutFait);
  }, [toutFait, surFini]);

  const ce = systeme === 'mac' ? t('ce Mac') : systeme === 'windows' ? t('ce PC') : t('cet ordinateur');
  const nomVise = cible?.nom ?? (systeme === 'mac' ? 'Mac' : systeme === 'windows' ? 'PC' : t('Cet ordinateur'));
  const titreDe = (e: Cle): string => {
    switch (e) {
      case 'installer':
        return t('Installer {v0}', { v0: CONNECT });
      case 'relier':
        return systeme === 'mac' ? t('Relier ce Mac à Beluga') : systeme === 'windows' ? t('Relier ce PC à Beluga') : t('Relier cet ordinateur à Beluga');
      case 'autorisations':
        return t('Donner les autorisations du Mac');
      case 'navigateur':
        return t('Préparer Chrome');
    }
  };
  /* Le statut d'une étape ouverte : orange quand on attend la personne ou sa machine, gris quand tout se fait seul. */
  const statutDe = (e: Cle): { texte: string; attend: boolean } => {
    if (faite[e]) return { texte: t('Fait'), attend: false };
    if (e === 'autorisations') return { texte: t('À vous'), attend: true };
    if (e === 'navigateur') return { texte: t('Tout seul'), attend: false };
    return { texte: t('En cours'), attend: true };
  };
  const reussiteDe = (e: Cle): string => {
    switch (e) {
      case 'installer':
        return t('{v0} est installé sur {ce}.', { v0: CONNECT, ce });
      case 'relier':
        return t('« {nom} » est relié à Beluga.', { nom: nomVise });
      case 'autorisations':
        return t('Les deux autorisations sont données.');
      case 'navigateur':
        return mac ? t('Extension installée, reliée et autorisée en navigation privée.') : t('Extension installée et reliée.');
    }
  };

  const contenuDe = (e: Cle): React.ReactNode => {
    if (faite[e]) return <p className="text-[13.5px] leading-relaxed text-text">{reussiteDe(e)}</p>;
    switch (e) {
      case 'installer':
        return (
          <EtapeInstaller
            systeme={systemeAppareil}
            code={code}
            telecharge={!!telechargeLe}
            envoi={envoi}
            programmeAncien={programmeEnLigne(programme) && !programme?.connect}
            onTelecharger={() => void departe('telecharger')}
          />
        );
      case 'relier':
        return <EnAttente>{t('{v0} se relie tout seul à votre compte, sans code à taper…', { v0: CONNECT })}</EnAttente>;
      case 'autorisations':
        return <EtapeAutorisations ordinateur={cible} />;
      case 'navigateur':
        return (
          <div className="flex flex-col gap-3">
            <p className="text-[13.5px] leading-relaxed text-text">{t('Rien à faire de votre côté. Chrome peut se fermer un instant : il se rouvre seul avec tous vos onglets.')}</p>
            <EtapesDeChrome ordinateur={cible} nav={nav} mac={mac} fond="surface" />
          </div>
        );
    }
  };

  return (
    <div className="flex flex-col rounded-2xl bg-surface p-2" data-parcours-installation data-parcours-connexion={toutFait ? 'fini' : courante ?? ''} data-systeme={systeme ?? 'aucun'} data-ordinateur-vise={cible?.id ?? ''}>
      {etapes.map((e, i) => {
        const fait = faite[e];
        const estOuverte = e === ouverte;
        const statut = fait ? 'faite' : e === courante && !toutFait ? 'en-cours' : 'a-venir';
        const { texte, attend } = statutDe(e);
        if (estOuverte) {
          return (
            <section key={e} className="flex flex-col gap-3.5 rounded-xl bg-raised px-4 py-4 sm:px-[18px]" data-etape-connexion={e} data-etat={statut} data-ouverte>
              <button
                type="button"
                className={cn('flex items-center gap-3 text-left', !fait && 'cursor-default')}
                onClick={() => fait && setRelue(null)}
                aria-expanded
              >
                <RondDeLEtape statut={fait ? 'faite' : 'ouverte'} numero={i + 1} />
                <span className="min-w-0 flex-1 text-[14.5px] font-semibold text-text">{titreDe(e)}</span>
                <span className={cn('shrink-0 text-[12.5px]', !attend && 'text-muted')} style={attend ? { color: ORANGE } : undefined} data-statut-etape>
                  {texte}
                </span>
              </button>
              <div className="flex min-w-0 flex-col gap-3 sm:pl-9">{contenuDe(e)}</div>
            </section>
          );
        }
        const contenu = (
          <>
            <RondDeLEtape statut={fait ? 'faite' : 'a-venir'} numero={i + 1} />
            <span className={cn('min-w-0 flex-1 text-[14px]', fait ? 'text-text' : 'text-muted')}>{titreDe(e)}</span>
            {fait ? <span className="shrink-0 text-[12.5px] text-muted">{t('Fait')}</span> : null}
          </>
        );
        return fait ? (
          <button key={e} type="button" className="flex items-center gap-3 rounded-xl px-4 py-3.5 text-left hover:bg-raised/60 sm:px-[18px]" onClick={() => setRelue(e)} data-etape-connexion={e} data-etat={statut} aria-expanded={false}>
            {contenu}
          </button>
        ) : (
          <div key={e} className="flex items-center gap-3 px-4 py-3.5 sm:px-[18px]" data-etape-connexion={e} data-etat={statut}>
            {contenu}
          </div>
        );
      })}
      {toutFait ? (
        <div className="mt-1 flex flex-col items-center gap-2 rounded-xl bg-raised px-[18px] py-6 text-center" data-assistant-tout-pret>
          <p className="text-[15px] font-semibold text-text">{t('{nom} est prêt', { nom: nomVise })}</p>
          <p className="text-[13.5px] leading-relaxed text-muted">
            {mac ? t('Les agents peuvent maintenant travailler dans Chrome et sur ce Mac.') : t('Les agents peuvent maintenant travailler dans Chrome sur cet ordinateur.')}
          </p>
          {(onFermer || onVoir) && !integre ? (
            <div className="mt-2 flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
              {onFermer ? (
                <Button variant="subtle" size="md" className="max-sm:w-full" onClick={onFermer} data-parcours-fermer>
                  {t('Revenir à la liste')}
                </Button>
              ) : null}
              {onVoir && cible ? (
                <Button variant="default" size="md" className="max-sm:w-full" onClick={() => onVoir(cible.id)} data-parcours-voir>
                  {t('Voir ses autorisations')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * LE PARCOURS DE LA MISE EN ROUTE (étape « Votre ordinateur ») : le même, sans fenêtre ; l'état de l'extension est
 * lu ici et relu à chaque changement poussé par le démon. Rien ne part au montage : le téléchargement attend le
 * bouton de la première étape (sauf un ordinateur déjà reconnu, qui se coche tel quel).
 */
export function ParcoursDInstallation({ surFini }: { onPlusTard?: () => void; onTerminer?: () => void; surFini?: (fini: boolean) => void; integre?: boolean }) {
  const [etat, setEtat] = React.useState<EtatDeLExtension | null>(null);
  const lire = React.useCallback(async () => {
    try {
      setEtat(await client.call<EtatDeLExtension>({ type: 'extension.etat' }));
    } catch {
      /* hors ligne : le parcours garde ce qu'il savait */
    }
  }, []);
  React.useEffect(() => {
    void lire();
    return client.onExtension(() => void lire());
  }, [lire]);
  const depart = React.useMemo<DepartDuParcours>(() => ({ n: 0, mode: 'attendre' }), []);
  if (!etat) return <div className="h-[280px] animate-pulse rounded-xl bg-raised" data-silhouette />;
  return (
    <div className="flex flex-col gap-3" data-parcours-integre>
      <ParcoursDeConnexion etat={etat} depart={depart} surFini={surFini} integre />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Les pièces                                                           */
/* ------------------------------------------------------------------ */

function RondDeLEtape({ statut, numero }: { statut: 'faite' | 'ouverte' | 'a-venir'; numero: number }) {
  if (statut === 'faite') {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-coche text-sur-couleur" data-rond="fait">
        <Check className="size-3.5" strokeWidth={3} />
      </span>
    );
  }
  return (
    <span
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold',
        statut === 'ouverte' ? 'bg-accent text-accent-fg' : 'bg-raised text-muted',
      )}
      data-rond={statut === 'ouverte' ? 'en-cours' : 'a-venir'}
    >
      {numero}
    </span>
  );
}

function Encadre({ children, repere, className }: { children: React.ReactNode; repere?: string; className?: string }) {
  return (
    <div className={cn('rounded-xl bg-raised px-4 py-3.5', className)} data-encadre={repere}>
      {children}
    </div>
  );
}

/** Beluga attend quelque chose qui se passe ailleurs : un rouet orange, et ce qu'on attend. */
function EnAttente({ children, droite }: { children: React.ReactNode; droite?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5" data-en-attente>
      <LoaderCircle className="size-4 shrink-0 animate-spin" style={{ color: ORANGE }} aria-hidden />
      {/* Une largeur plancher : sur téléphone, c'est le geste de droite qui passe à la ligne, sous le texte, jamais le texte qui s'écrase. */}
      <span className="min-w-[12rem] flex-1 text-[13.5px] text-text">{children}</span>
      {droite ? <span className="shrink-0 max-sm:basis-full max-sm:pl-[26px]">{droite}</span> : null}
    </div>
  );
}

/** Une ligne d'état cochable : verte faite, rouet orange en cours, rond vide à venir, croix rouge en échec. */
function LigneDEtat({ etat, children, repere, droite }: { etat: 'fait' | 'en-cours' | 'a-venir' | 'echec'; children: React.ReactNode; repere: string; droite?: React.ReactNode }) {
  return (
    <div className="flex min-h-7 flex-wrap items-center gap-2.5" data-ligne-etat={repere} data-etat={etat}>
      {etat === 'fait' ? (
        <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-coche text-sur-couleur">
          <Check className="size-2.5" strokeWidth={3.5} />
        </span>
      ) : etat === 'en-cours' ? (
        <LoaderCircle className="size-[18px] shrink-0 animate-spin" style={{ color: ORANGE }} />
      ) : etat === 'echec' ? (
        <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-danger text-sur-couleur" aria-hidden>
          <X className="size-2.5" strokeWidth={3.5} />
        </span>
      ) : (
        <span className="size-[18px] shrink-0 rounded-full ring-[1.5px] ring-inset ring-faint" />
      )}
      <span className={cn('min-w-0 flex-1 text-[13.5px]', etat === 'a-venir' ? 'text-muted' : 'text-text')}>{children}</span>
      {droite}
    </div>
  );
}

/** Des consignes numérotées, l'une sous l'autre. */
function EtapesNumerotees({ etapes, repere }: { etapes: React.ReactNode[]; repere: string }) {
  return (
    <ol className="flex flex-col gap-1.5" data-etapes-installation={repere}>
      {etapes.map((texte, i) => (
        <li key={i} className="flex gap-1.5 text-[13.5px] leading-relaxed text-text">
          <span className="shrink-0 font-semibold">{i + 1}.</span>
          <span className="min-w-0">{texte}</span>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* Les étapes                                                           */
/* ------------------------------------------------------------------ */

const LIBELLE_DU_SYSTEME: Record<SystemeDOrdinateur, string> = { mac: 'Mac', windows: 'Windows', linux: 'Linux' };

/** L'IMAGE DE L'INSTALLATION SUR MAC (maquette #f1f1) : l'icône glissée sur le dossier Applications, comme dans la fenêtre. */
function GlisserDansApplications() {
  return (
    <div className="flex items-center justify-center gap-6 rounded-xl bg-surface px-4 py-4 sm:gap-10" data-image-installation aria-hidden>
      <div className="flex flex-col items-center gap-1.5">
        <img src="/icon-192.png" alt="" className="size-14 rounded-2xl" />
        <span className="text-[12px] text-text">{CONNECT}</span>
      </div>
      <ArrowRight className="size-6 text-muted" />
      <div className="flex flex-col items-center gap-1.5">
        {/* Le bleu du dossier de macOS : l'image reproduit ce que la personne voit sur son Mac. */}
        <span className="flex size-14 items-center justify-center rounded-2xl text-sur-couleur" style={{ background: '#5aa9f5' }}>
          <Folder className="size-7" />
        </span>
        <span className="text-[12px] text-text">{t('Applications')}</span>
      </div>
    </div>
  );
}

function EtapeInstaller({
  systeme,
  code,
  telecharge,
  envoi,
  programmeAncien,
  onTelecharger,
}: {
  systeme: SystemeDOrdinateur | null;
  code: { code: string } | null;
  telecharge: boolean;
  envoi: boolean;
  programmeAncien: boolean;
  onTelecharger: () => void;
}) {
  /* RIEN N'ARRIVE AU BOUT D'UNE MINUTE : la page dit quoi faire, au lieu d'attendre en silence (21/11/2026). */
  const [longue, setLongue] = React.useState(false);
  React.useEffect(() => {
    if (!telecharge) return;
    const minuteur = window.setTimeout(() => setLongue(true), 60_000);
    return () => window.clearTimeout(minuteur);
  }, [telecharge]);
  if (programmeAncien) {
    return <EnAttente>{t('Ce Mac a l’ancien programme « Beluga Relais » : il passe seul à {v0} dans les minutes qui viennent.', { v0: CONNECT })}</EnAttente>;
  }
  if (!systeme) {
    return <p className="text-[13.5px] leading-relaxed text-text">{t('Ouvrez Beluga sur l’ordinateur à connecter (Mac, Windows ou Linux), puis touchez « Lier ».')}</p>;
  }
  /* Pas encore de téléchargement (mise en route, fenêtre seule) : le bouton, dans l'étape. */
  if (!telecharge && !code) {
    return (
      <Encadre repere="telecharger" className="flex flex-wrap items-center gap-4 bg-surface">
        <img src="/icon-192.png" alt="" className="size-12 shrink-0 rounded-xl" />
        <div className="min-w-[10rem] flex-1">
          <p className="text-[15px] font-semibold text-text">{CONNECT}</p>
          <p className="text-[13px] text-muted">{t('Pour {systeme}', { systeme: LIBELLE_DU_SYSTEME[systeme] })}</p>
        </div>
        <Button variant="default" size="md" className="max-sm:basis-full" onClick={onTelecharger} disabled={envoi} data-telecharger-connect={systeme}>
          {envoi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          {systeme === 'linux' ? t('Copier la commande') : t('Télécharger')}
        </Button>
      </Encadre>
    );
  }
  const relancer = (
    <button type="button" onClick={onTelecharger} disabled={envoi} className="shrink-0 text-[13px] text-muted underline underline-offset-2 hover:text-text" data-retelecharger>
      {systeme === 'linux' ? t('Recopier la commande') : t('Relancer le téléchargement')}
    </button>
  );
  if (systeme === 'linux') {
    return (
      <>
        <p className="text-[13.5px] leading-relaxed text-text">{t('Collez cette commande dans un terminal : {v0} s’installe et se relie tout seul.', { v0: CONNECT })}</p>
        {code ? (
          <code className="block select-all break-all rounded-lg bg-surface px-3 py-2.5 font-mono text-[12.5px] text-text" data-commande-linux>
            {commandeLinux(code.code)}
          </code>
        ) : (
          <div className="h-10 animate-pulse rounded-lg bg-surface" data-silhouette />
        )}
        <Button variant="subtle" size="md" className="self-start bg-surface max-sm:w-full" onClick={() => code && copier(commandeLinux(code.code), t('Commande copiée.'))} disabled={!code} data-copier-commande>
          <Copy className="h-3.5 w-3.5" />
          {t('Copier la commande')}
        </Button>
        <EnAttente>{t('En attente de {v0} sur cet ordinateur…', { v0: CONNECT })}</EnAttente>
      </>
    );
  }
  return (
    <>
      <LigneDEtat repere="telechargement" etat="fait">
        {t('Le téléchargement a commencé.')}
      </LigneDEtat>
      {systeme === 'windows' ? (
        <EtapesNumerotees
          repere="windows"
          etapes={[
            t('Ouvrez le fichier « Beluga-Connect.exe » que vous venez de télécharger.'),
            t('Windows affiche « Windows a protégé votre ordinateur » : cliquez sur « Informations complémentaires », puis « Exécuter quand même ».'),
            t('{v0} se range de lui-même et se relie à Beluga.', { v0: CONNECT }),
          ]}
        />
      ) : (
        <>
          <EtapesNumerotees
            repere="mac"
            etapes={[
              t('Ouvrez « Beluga-Connect.dmg » dans vos téléchargements.'),
              t('Dans la fenêtre qui s’ouvre, glissez l’icône sur le dossier Applications.'),
              t('Ouvrez {v0} depuis Applications.', { v0: CONNECT }),
            ]}
          />
          <GlisserDansApplications />
        </>
      )}
      <EnAttente droite={relancer}>{systeme === 'windows' ? t('En attente de {v0} sur ce PC…', { v0: CONNECT }) : t('En attente de {v0} sur ce Mac…', { v0: CONNECT })}</EnAttente>
      {longue && systeme === 'mac' ? (
        <p className="text-[13px] leading-relaxed text-muted" data-aide-liaison>
          {t('Rien ne vient ? Ouvrez {v0} depuis le dossier Applications, ou choisissez « Relier à Beluga » dans son menu, en haut de l’écran.', { v0: CONNECT })}
        </p>
      ) : null}
    </>
  );
}

/**
 * LES AUTORISATIONS DU MAC (maquette #bd11) : Beluga Connect a ouvert sa fenêtre « Activer » sur le Mac ; la page suit
 * l'état en direct, ligne par ligne, et sait rouvrir cette fenêtre à distance si elle s'est cachée.
 */
function EtapeAutorisations({ ordinateur }: { ordinateur: Ordinateur | null }) {
  const [ouverture, setOuverture] = React.useState(false);
  const a = ordinateur?.programme?.autorisations ?? null;
  const lignes: { cle: 'accessibilite' | 'ecran'; titre: string; pour: string }[] = [
    { cle: 'accessibilite', titre: t('Contrôler la souris et le clavier'), pour: t('Pour cliquer, taper et changer les réglages à votre place.') },
    { cle: 'ecran', titre: t('Voir l’écran'), pour: t('Pour regarder ce qui s’affiche avant d’agir.') },
  ];
  const rouvrir = async () => {
    if (!ordinateur) return;
    setOuverture(true);
    try {
      await client.call({ type: 'relaisMac.reglage', ordinateurId: ordinateur.id, reglage: 'aide' });
      client.afficherMessage('info', t('La fenêtre de {v0} s’est rouverte sur le Mac.', { v0: CONNECT }));
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Le geste n’a pas abouti.'));
    } finally {
      setOuverture(false);
    }
  };
  return (
    <>
      <p className="text-[13.5px] leading-relaxed text-text">
        {t('La fenêtre de {v0} vient de s’ouvrir sur votre Mac. Cliquez « Activer » sur chaque ligne : macOS vous le demande une seule fois.', { v0: CONNECT })}
      </p>
      <div className="flex flex-col rounded-xl bg-surface px-3.5 py-1" data-encadre="autorisations">
        {lignes.map((l) => {
          const accorde = a?.[l.cle] === true;
          return (
            <div key={l.cle} className="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-center sm:gap-3" data-ligne-etat={l.cle} data-etat={accorde ? 'fait' : 'a-venir'}>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-[14px] text-text">{l.titre}</span>
                <span className="text-[12.5px] text-muted">{l.pour}</span>
              </div>
              {accorde ? (
                <span className="flex shrink-0 items-center gap-1.5 text-[13px] text-coche">
                  <span className="size-2 rounded-full bg-coche" aria-hidden />
                  {t('Accordée')}
                </span>
              ) : (
                <span className="flex shrink-0 items-center gap-1.5 text-[13px]" style={{ color: ORANGE }}>
                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
                  {t('En attente de votre clic')}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[13px] text-muted">
        {t('La fenêtre n’est pas visible ?')}{' '}
        <button type="button" onClick={() => void rouvrir()} disabled={ouverture || !ordinateur} className="inline-flex items-center gap-1 hover:underline" style={{ color: ORANGE }} data-rouvrir-aide>
          {ouverture ? <Loader2 className="size-3 animate-spin" /> : null}
          {t('La rouvrir sur le Mac')}
        </button>
      </p>
    </>
  );
}

/** Le dossier fixe de l'extension, par système (affiché seulement si l'ajout à Chrome a échoué). */
const DOSSIER_PAR_DEFAUT: Record<SystemeDOrdinateur, string> = {
  mac: '~/Library/Application Support/Beluga/extension-chrome',
  windows: '%LOCALAPPDATA%\\Beluga\\extension-chrome',
  linux: '~/.local/share/beluga/extension-chrome',
};

/** Un rendu de plus à l'instant donné (le code de secours paraît 30 s après la pose du code, sans autre événement). */
function useReveilA(instant: number | null): void {
  const [, setTic] = React.useState(0);
  React.useEffect(() => {
    if (!instant || instant <= Date.now()) return;
    const minuteur = window.setTimeout(() => setTic((n) => n + 1), instant - Date.now() + 50);
    return () => window.clearTimeout(minuteur);
  }, [instant]);
}

/**
 * LES ÉTAPES DE CHROME D'UN ORDINATEUR (carte « Liaison Chrome automatique et suivie », 22/11/2026) : cochées d'après
 * l'état réel (`etapesDeLaPreparation`), une étape échouée le dit, et 30 s après la pose du code par Beluga Connect
 * sans liaison, le code de secours paraît en grand (`codeDeSecoursAMontrer`, horodatage du démon). Partagé par l'étape
 * « Chrome prêt » du parcours et par la page de l'ordinateur.
 */
export function EtapesDeChrome({ ordinateur, nav, mac, fond = 'raised' }: { ordinateur: Ordinateur | null; nav: NavigateurDOrdinateur | null; mac: boolean; /** Le fond de l'encadré du code de secours : l'opposé de celui où il est posé. */ fond?: 'raised' | 'surface' }) {
  const [envoi, setEnvoi] = React.useState<string | null>(null);
  /* Posé sur un fond gris clair (étape ouverte du parcours), un bouton discret prend le fond de la page. */
  const classeBouton = fond === 'surface' ? 'bg-surface hover:bg-surface/70' : '';
  const brute = ordinateur?.programme?.preparation ?? null;
  const preparation = preparationVue(brute);
  useReveilA(brute?.etat === 'en-cours' && brute.debutLiaison ? brute.debutLiaison + SECOURS_APRES_MS : null);
  useReveilA(brute?.etat === 'en-cours' ? (brute.majLe ?? brute.depuis) + PREPARATION_FIGEE_APRES_MS : null);
  const systeme = ordinateur?.programme?.systeme ?? (mac ? 'mac' : 'windows');
  const etapes = etapesDeLaPreparation(preparation, nav, mac);
  /* Un échec ancien dont tout s'est rétabli depuis (Chrome relié et autorisé) ne se montre plus. */
  const echec = preparation?.etat === 'echec' && etapes.some((e) => e.etat !== 'fait');
  const fait = (cle: string) => etapes.find((e) => e.cle === cle)?.etat === 'fait';
  const secours = !!ordinateur && codeDeSecoursAMontrer(preparation, !!nav?.enLigne);
  const libelles: Record<string, { titre: string; enCours: string }> = {
    ajoutee: { titre: t('Extension ajoutée à Chrome'), enCours: t('Ajout de l’extension à Chrome…') },
    reliee: { titre: t('Extension reliée à Beluga'), enCours: t('Liaison de l’extension…') },
    prive: { titre: t('Autorisée en navigation privée'), enCours: t('Autorisation en navigation privée…') },
  };
  const dossier = preparation?.dossier || DOSSIER_PAR_DEFAUT[systeme];
  const reessayer = async () => {
    if (!ordinateur) return;
    setEnvoi('preparer');
    try {
      await client.call({ type: 'relaisMac.preparer', ordinateurId: ordinateur.id });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Le geste n’a pas abouti.'));
    } finally {
      setEnvoi(null);
    }
  };
  const ouvrirLaPage = async () => {
    if (!nav) return;
    setEnvoi('page');
    try {
      await client.call({ type: 'extension.ouvrirReglages', chromeId: nav.id });
      client.pushToast('info', t('La page de l’extension est ouverte dans Chrome : cochez « Autoriser en navigation privée ».'));
    } catch (err: any) {
      client.pushToast('warning', err?.message ?? t('Le geste n’a pas abouti.'));
    } finally {
      setEnvoi(null);
    }
  };
  return (
    <div className="flex flex-col gap-3" data-etapes-chrome={preparation?.etat ?? 'aucune'}>
      <div className="flex flex-col gap-1" data-encadre="chrome">
        {etapes.map((e) => (
          <LigneDEtat key={e.cle} repere={e.cle} etat={e.etat === 'echec' ? 'echec' : e.etat}>
            {e.etat === 'en-cours' ? libelles[e.cle]!.enCours : libelles[e.cle]!.titre}
          </LigneDEtat>
        ))}
        {echec && preparation?.message ? (
          <p className="pl-7 text-[12.5px] leading-relaxed text-muted [overflow-wrap:anywhere]" data-raison-echec>
            {preparation.message}
          </p>
        ) : null}
      </div>
      {secours && ordinateur ? <CodeDeSecours ordinateurId={ordinateur.id} fond={fond} /> : null}
      {echec ? (
        <div className="flex flex-col gap-3" data-assistant-secours>
          {!fait('ajoutee') ? (
            <>
              <p className="text-[13.5px] leading-relaxed text-text">{t('{v0} n’a pas pu tout faire seul. Trois clics suffisent :', { v0: CONNECT })}</p>
              <EtapesNumerotees
                repere="secours-chrome"
                etapes={[
                  t('Dans Chrome, ouvrez la page chrome://extensions et activez le « Mode développeur », en haut à droite.'),
                  t('Cliquez sur « Charger l’extension non empaquetée ».'),
                  systeme === 'mac'
                    ? t('Tapez Cmd + Maj + G, collez {chemin}, puis validez deux fois.', { chemin: dossier })
                    : t('Collez {chemin} dans la barre du dossier, puis validez.', { chemin: dossier }),
                ]}
              />
            </>
          ) : fait('reliee') && !fait('prive') && nav && mac ? (
            <Button variant="subtle" size="md" className={cn(classeBouton, 'self-start max-sm:w-full')} onClick={() => void ouvrirLaPage()} disabled={!!envoi} data-assistant-ouvrir-page-extension>
              {envoi === 'page' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {t('Ouvrir la page de l’extension')}
            </Button>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {!fait('ajoutee') ? (
              <Button variant="subtle" size="md" className={cn(classeBouton, 'max-sm:w-full')} onClick={() => copier(dossier, t('Chemin copié.'))} data-assistant-copier-chemin>
                <Copy className="h-3.5 w-3.5" />
                {t('Copier le chemin')}
              </Button>
            ) : null}
            <Button variant="subtle" size="md" className={cn(classeBouton, 'max-sm:w-full')} onClick={() => void reessayer()} disabled={!!envoi} data-assistant-reessayer>
              {envoi === 'preparer' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {t('Réessayer')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * LE CODE DE SECOURS (maquette #ead6) : le même pour tout ce qui l'affiche (`relaisMac.codeDeSecours`, partagé avec
 * Beluga Connect), en grand, groupé 3 + 3, avec « Copier » ; renouvelé avant d'expirer. Il ne remplace jamais le code
 * que Beluga Connect a posé à côté de l'extension.
 */
function CodeDeSecours({ ordinateurId, fond }: { ordinateurId: string; fond: 'raised' | 'surface' }) {
  const [code, setCode] = React.useState<{ code: string; expireLe: number } | null>(null);
  /* « Copié » se lit sur le bouton : le message passager d'un geste réussi se tait (juge des alertes). */
  const [copie, setCopie] = React.useState(false);
  const demander = React.useCallback(async () => {
    try {
      setCode(await client.call<{ code: string; expireLe: number }>({ type: 'relaisMac.codeDeSecours', ordinateurId }));
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Le geste n’a pas abouti.'));
    }
  }, [ordinateurId]);
  React.useEffect(() => {
    void demander();
  }, [demander]);
  /* Renouvelé une minute avant son échéance : le démon en rend un neuf quand il reste moins de deux minutes. */
  React.useEffect(() => {
    if (!code) return;
    const minuteur = window.setTimeout(() => void demander(), Math.max(5_000, code.expireLe - Date.now() - 60_000));
    return () => window.clearTimeout(minuteur);
  }, [code, demander]);
  return (
    <Encadre repere="code-de-secours" className={cn('flex flex-col gap-3 py-4', fond === 'surface' && 'bg-surface')}>
      <p className="flex items-start gap-2.5 text-[13.5px] leading-relaxed text-text">
        <span className="mt-[7px] h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: 'hsl(var(--cadre-question))' }} aria-hidden />
        <span className="min-w-0">{t('L’extension ne s’est pas encore reliée toute seule. Ouvrez le volet Beluga dans Chrome et saisissez ce code :')}</span>
      </p>
      {code ? (
        <div className="flex flex-wrap items-center gap-4">
          <p className="select-all font-mono text-[32px] font-semibold tracking-[0.2em] text-text sm:text-[36px]" data-code-de-secours={code.code}>
            {codeDeLiaisonLisible(code.code)}
          </p>
          <Button variant="subtle" size="md" className={cn('max-sm:w-full', fond === 'raised' && 'bg-surface hover:bg-surface/70')} onClick={() => {
              copier(code.code, t('Code copié.'));
              setCopie(true);
              window.setTimeout(() => setCopie(false), 2_000);
            }}
            data-copier-code-de-secours
          >
            {copie ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copie ? t('Copié') : t('Copier')}
          </Button>
        </div>
      ) : (
        <div className="h-[44px] w-[220px] animate-pulse rounded-lg bg-surface" data-silhouette />
      )}
      <p className="text-[12.5px] leading-relaxed text-muted">{t('Renouvelé tout seul avant d’expirer · l’étape se cochera dès que Chrome sera relié.')}</p>
    </Encadre>
  );
}

/* ------------------------------------------------------------------ */
/* Safari : l'application signée et son code (seul geste encore à la main) */
/* ------------------------------------------------------------------ */

const heure = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * BELUGA POUR SAFARI (page d'un Mac) : Safari n'accepte pas d'extension posée par une autre application ; on garde
 * donc l'application signée à télécharger et le code de liaison — affiché d'office, renouvelé à son échéance,
 * remplacé par « Relié avec succès » dès qu'un Safari de cet ordinateur se relie APRÈS son émission.
 */
export function FenetreSafari({ ordinateur, ouverte, onClose }: { ordinateur: Ordinateur; ouverte: boolean; onClose: () => void }) {
  return (
    <Dialog open={ouverte} onOpenChange={(o) => !o && onClose()}>
      <DialogContent adresse="installation-safari" className="sm:w-[min(620px,100%)]" data-fenetre-safari>
        <DialogHeader>
          <DialogTitle>{t('Beluga pour Safari')}</DialogTitle>
        </DialogHeader>
        {ouverte ? (
          <div className="flex flex-col gap-5 pb-1">
            <div className="flex flex-col gap-4">
              <Button asChild variant="default" size="md" className="self-start max-sm:w-full" data-assistant-telecharger="safari">
                <a href="/api/extension-safari.zip" download="Beluga-Safari.zip">
                  <Download className="h-3.5 w-3.5" />
                  {t('Télécharger Beluga pour Safari')}
                </a>
              </Button>
              <Encadre repere="gestes-safari">
                <EtapesNumerotees
                  repere="safari"
                  etapes={[
                    t('Décompressez le fichier, glissez « Beluga » dans Applications, puis ouvrez-la une fois.'),
                    t('Dans Safari, ouvrez Réglages → Extensions et cochez « Beluga », sur tous les sites.'),
                    t('Cliquez sur l’icône Beluga dans Safari, puis saisissez ce code.'),
                  ]}
                />
              </Encadre>
            </div>
            <CodeDeLiaison ordinateur={ordinateur} navigateur="safari" />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CodeDeLiaison({ ordinateur, navigateur }: { ordinateur: Ordinateur; navigateur: GenreDeNavigateur }) {
  const [code, setCode] = React.useState<{ code: string; expireLe: number; emisLe: number } | null>(null);
  const [enCours, setEnCours] = React.useState(false);
  const ordinateurId = ordinateur.id;
  const demander = React.useCallback(async () => {
    setEnCours(true);
    try {
      const r = await client.call<{ code: string; expireLe: number }>({ type: 'extension.code', ordinateurId });
      setCode({ ...r, emisLe: Date.now() });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Le geste n’a pas abouti.'));
    } finally {
      setEnCours(false);
    }
  }, [ordinateurId]);
  React.useEffect(() => {
    setCode(null);
    void demander();
  }, [demander]);
  const reussi = !!code && ordinateur.navigateurs.some((n) => n.genre === navigateur && n.enLigne && (n.creeLe ?? 0) >= code.emisLe - 5_000);
  React.useEffect(() => {
    if (!code || reussi) return;
    const minuteur = window.setTimeout(() => void demander(), Math.max(1_000, code.expireLe - Date.now() + 500));
    return () => window.clearTimeout(minuteur);
  }, [code, reussi, demander]);
  const nomNav = LIBELLE_DU_NAVIGATEUR[navigateur];
  if (reussi) {
    return (
      <Encadre repere="liaison-reussie">
        <LigneDEtat repere="liaison" etat="fait">
          <span className="text-coche">{t('Relié avec succès')}</span>
          <span className="text-muted"> · {t('{navigateur} sur « {nom} »', { navigateur: nomNav, nom: ordinateur.nom })}</span>
        </LigneDEtat>
      </Encadre>
    );
  }
  return (
    <div className="flex flex-col">
      {code ? (
        <Encadre repere="code" className="flex flex-col items-center gap-2 py-5">
          <p className="font-mono text-[34px] font-semibold tracking-[0.25em] text-text sm:text-[40px]" data-code-de-liaison={code.code}>
            {codeDeLiaisonLisible(code.code)}
          </p>
          <p className="text-[12.5px] text-muted">{t('Valable jusqu’à {h}, puis renouvelé tout seul.', { h: heure(code.expireLe) })}</p>
        </Encadre>
      ) : (
        <div className="h-[112px] animate-pulse rounded-xl bg-raised" data-silhouette />
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {code ? (
          <Button variant="subtle" size="md" className="max-sm:w-full" onClick={() => copier(code.code, t('Code copié.'))} data-copier-code>
            <Copy className="h-3.5 w-3.5" />
            {t('Copier le code')}
          </Button>
        ) : null}
        <Button variant="subtle" size="md" className="max-sm:w-full" onClick={() => void demander()} disabled={enCours} data-code-navigateur>
          {enCours ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {t('Nouveau code')}
        </Button>
      </div>
    </div>
  );
}
