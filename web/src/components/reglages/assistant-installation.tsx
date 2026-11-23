import * as React from 'react';
import { ArrowRight, Check, ChevronDown, ChevronUp, Copy, Download, Folder, Loader2, LoaderCircle, RefreshCw, Wrench, X } from '@/components/ui/icones';
import {
  VERSION_EXTENSION_CHROME,
  autorisationsDonnees,
  codeDeLiaisonLisible,
  codeDeSecoursAMontrer,
  etapesDeLaPreparation,
  etapesDeSafari,
  preparationVue,
  PREPARATION_FIGEE_APRES_MS,
  SECOURS_APRES_MS,
  ordinateurReconnu,
  programmeEnLigne,
  systemeDeLAppareil,
  travailEnCoursSurUnOrdinateur,
  versionAuMoins,
  type EtatDeLExtension,
  type NavigateurDOrdinateur,
  type Ordinateur,
  type PreparationDeSafari,
  type SystemeDOrdinateur,
  MARQUES,
  choixEffectif,
  navigateurDeLaMarque,
  navigateurPret,
  navigateursNommes,
  type MarqueDeNavigateur,
} from '@beluga/shared';
import { EtapeNavigateurs, marqueDeCetAppareil } from './choix-des-navigateurs';
import { Button, Input } from '@/components/ui';
import { client } from '@/lib/client';
import { useRelectureDesOrdinateurs } from '@/lib/relecture-des-ordinateurs';
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

/** Les volets : installation, ce Mac, le choix des navigateurs, puis un par navigateur choisi. */
type Cle = 'installation' | 'mac' | 'navigateurs' | MarqueDeNavigateur;
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

/**
 * L'ordinateur a-t-il tout ce qu'il faut ? Règle commune (`shared/src/navigateurs-de-l-ordinateur.ts`, carte
 * « Navigateurs facultatifs à la liaison ») : Beluga Connect en marche, autorisations (Mac), un choix de navigateurs
 * fait, et chaque navigateur CHOISI prêt — aucun n'est obligatoire.
 */
export { ordinateurPret } from '@beluga/shared';

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

  /* LE CODE DE SECOURS (carte « Beluga Connect : liaison sans fenêtre », 22/11/2026) : Beluga Connect n'a pas été
     reconnu à coup sûr et affiche six chiffres ; le démon prévient l'onglet (`relaisMac.codeAttendu`), qui ouvre le
     champ. Un onglet ouvert après coup le relit au montage. */
  const [codeAttendu, setCodeAttendu] = React.useState<{ nom: string; expireLe: number } | null>(null);
  React.useEffect(() => {
    let vivant = true;
    void client
      .call<{ codeAttendu: { nom: string; expireLe: number } | null }>({ type: 'relaisMac.liaison.enAttente' })
      .then((r) => vivant && setCodeAttendu(r.codeAttendu ?? null))
      .catch(() => undefined);
    const lacher = client.onCodeAttendu((a) => setCodeAttendu({ nom: a.nom, expireLe: a.expireLe }));
    return () => {
      vivant = false;
      lacher();
    };
  }, [depart.n]);
  const secoursOuvert = !!codeAttendu && codeAttendu.expireLe > Date.now() && !relie;

  /* Installé = Beluga Connect s'est présenté à Beluga (relié), ou il affiche son code de secours (il est lancé). */
  const installe = !!programme || relie || secoursOuvert;

  /* Le code expire avant la liaison : sous Linux seulement, la commande change avec lui. Sur Mac et Windows, le code
     est déjà DANS le fichier téléchargé : en émettre un neuf le tuerait (un seul code vivant par compte). */
  React.useEffect(() => {
    if (!code || installe || systemeAppareil !== 'linux') return;
    const minuteur = window.setTimeout(() => void emettre(cibleId).catch(() => undefined), Math.max(1_000, code.expireLe - Date.now() + 500));
    return () => window.clearTimeout(minuteur);
  }, [code, installe, cibleId, emettre, systemeAppareil]);

  const safariNav = cible?.navigateurs.filter((n) => n.genre === 'safari').sort((a, b) => Number(b.enLigne) - Number(a.enLigne))[0] ?? null;
  /* LES VOLETS DE BELUGA CONNECT (carte « Ordinateurs : pannes et volets alignés », 22/11/2026) : les mêmes que la
     fenêtre de l'application, dans le même ordre — Installation, Ce Mac, puis NAVIGATEURS (carte « Navigateurs
     facultatifs à la liaison » : la confirmation, et la liste à cocher), puis un volet par navigateur CHOISI. */
  const choixNav = cible ? choixEffectif(cible.navigateursChoisis, cible.navigateurs) : null;
  const etapes: Cle[] = [...(mac ? (['installation', 'mac', 'navigateurs'] as Cle[]) : (['installation', 'navigateurs'] as Cle[])), ...(choixNav ?? [])];
  const faite: Record<string, boolean> = {
    installation: relie,
    mac: relie && autorisationsDonnees(programme),
    navigateurs: relie && !!choixNav,
    ...Object.fromEntries((choixNav ?? []).map((m) => [m, !!cible && navigateurPret(cible, m)])),
  };
  const toutFait = etapes.every((e) => faite[e]);
  const courante = etapes.find((e) => !faite[e]) ?? null;
  React.useEffect(() => {
    surFini?.(toutFait);
  }, [toutFait, surFini]);

  /* La préparation de Chrome ou de Safari a échoué : le volet le dit en rouge (« À réparer »), « Réessayer » la relance. */
  const chromeEnEchec = !faite.chrome && preparationVue(programme?.preparation ?? null)?.etat === 'echec';
  const prepSafari = programme?.safari ?? null;
  const safariEnEchec = !faite.safari && prepSafari?.etat === 'echec';
  const enEchec: Record<string, boolean> = {
    chrome: chromeEnEchec,
    safari: safariEnEchec,
    ...Object.fromEntries(
      (choixNav ?? []).filter((m) => m !== 'chrome' && m !== 'safari').map((m) => [m, !faite[m] && preparationVue(programme?.autres?.[m] ?? null)?.etat === 'echec']),
    ),
  };

  /* UN SEUL VOLET OUVERT : celui en panne, sinon celui en cours. Un clic en ouvre un autre (et referme le premier) ; le
     choix tient tant que le volet ouvert d'office ne change pas — l'étape suivante s'ouvre alors d'elle-même. */
  const parDefaut: Cle | null = etapes.find((e) => enEchec[e]) ?? (toutFait ? null : courante);
  const [choix, setChoix] = React.useState<{ cle: Cle | null; sous: Cle | null } | null>(null);
  const ouverte: Cle | null = choix && choix.sous === parDefaut ? choix.cle : parDefaut;
  const basculer = (e: Cle) => setChoix({ cle: ouverte === e ? null : e, sous: parDefaut });

  /* LE VOLET OUVERT RESTE SOUS LES YEUX : à chaque volet qui s'ouvre, la zone défile jusqu'à lui (puis jusqu'à
     « … est prêt » à la fin) — sans quoi Chrome et Safari avançaient sous le bas de la fenêtre. */
  const racine = React.useRef<HTMLDivElement>(null);
  const premierRendu = React.useRef(true);
  React.useEffect(() => {
    if (premierRendu.current) {
      premierRendu.current = false;
      return;
    }
    /* Après la pose du contenu du volet (sa hauteur finale), pas avant. */
    const minuteur = window.setTimeout(() => {
      const cible = racine.current?.querySelector<HTMLElement>(toutFait ? '[data-assistant-tout-pret]' : '[data-etape-connexion][data-ouverte]');
      cible?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 200);
    return () => window.clearTimeout(minuteur);
  }, [ouverte, toutFait]);

  const nomVise = cible?.nom ?? (systeme === 'mac' ? 'Mac' : systeme === 'windows' ? 'PC' : t('Cet ordinateur'));
  const titreDe = (e: Cle): string => {
    if (e === 'installation') return t('Installation');
    if (e === 'mac') return t('Ce Mac');
    if (e === 'navigateurs') return t('Navigateurs');
    return MARQUES[e].nom;
  };

  /* LES LIGNES DE CHAQUE VOLET, CELLES DE L'APPLICATION : rond, libellé, état calé à droite. */
  type Point = { cle: string; texte: string; etat: 'fait' | 'en-cours' | 'a-venir' | 'echec'; valeur?: string };
  const pointsDe = (e: Cle): Point[] => {
    switch (e) {
      case 'installation': {
        const telecharge = !!telechargeLe || !!code || installe;
        const lance: Point = { cle: 'lance', texte: installe ? t('{v0} lancé', { v0: CONNECT }) : t('Lancer {v0}', { v0: CONNECT }), etat: installe ? 'fait' : telecharge ? 'en-cours' : 'a-venir' };
        const relieA: Point[] = secoursOuvert
          ? [
              { cle: 'code', texte: t('Code de {v0}', { v0: CONNECT }), etat: 'en-cours', valeur: t('À vous') },
              { cle: 'relie', texte: t('Relié à votre compte'), etat: 'a-venir' },
            ]
          : [{ cle: 'relie', texte: t('Relié à votre compte'), etat: relie ? 'fait' : programme ? 'en-cours' : 'a-venir' }];
        if (systemeAppareil === 'linux' || systeme === 'linux') {
          return [{ cle: 'telecharge', texte: t('Commande copiée'), etat: telecharge ? 'fait' : 'en-cours' }, { ...lance, texte: t('{v0} lancé', { v0: CONNECT }) }, ...relieA];
        }
        if (systeme === 'windows') return [{ cle: 'telecharge', texte: t('Téléchargé'), etat: telecharge ? 'fait' : 'en-cours' }, lance, ...relieA];
        return [
          { cle: 'telecharge', texte: t('Téléchargé'), etat: telecharge ? 'fait' : 'en-cours' },
          { cle: 'glisse', texte: installe ? t('Glissé dans Applications') : t('Glisser dans Applications'), etat: installe ? 'fait' : telecharge ? 'en-cours' : 'a-venir' },
          { ...lance, etat: installe ? 'fait' : 'a-venir' },
          ...relieA,
        ];
      }
      case 'mac': {
        const a = programme?.autorisations ?? null;
        const ouvert = courante === 'mac';
        return [
          { cle: 'connect', texte: CONNECT, etat: relie ? 'fait' : 'a-venir', valeur: relie ? t('Relié') : '—' },
          { cle: 'accessibilite', texte: t('Souris et clavier'), etat: a?.accessibilite ? 'fait' : ouvert ? 'en-cours' : 'a-venir', valeur: a?.accessibilite ? t('Accordée') : ouvert ? t('À vous') : undefined },
          { cle: 'ecran', texte: t('Voir l’écran'), etat: a?.ecran ? 'fait' : ouvert && a?.accessibilite ? 'en-cours' : 'a-venir', valeur: a?.ecran ? t('Accordée') : ouvert && a?.accessibilite ? t('À vous') : undefined },
        ];
      }
      case 'chrome': {
        const brute = etapesDeLaPreparation(preparationVue(programme?.preparation ?? null), nav, mac);
        const etat = (cle: string): Point['etat'] => {
          if (faite.chrome) return 'fait';
          if (courante !== 'chrome' && !chromeEnEchec) return 'a-venir';
          return (brute.find((x) => x.cle === cle)?.etat ?? 'a-venir') as Point['etat'];
        };
        /* Le mode développeur se range sous « Extension ajoutée », comme dans l'application. */
        const ajoutee: Point['etat'] = etat('developpeur') === 'echec' ? 'echec' : etat('developpeur') === 'fait' ? etat('ajoutee') : etat('developpeur');
        const points: Point[] = [
          { cle: 'ajoutee', texte: t('Extension ajoutée'), etat: ajoutee },
          { cle: 'reliee', texte: t('Reliée à Beluga'), etat: etat('reliee') },
        ];
        if (mac) points.push({ cle: 'prive', texte: t('Navigation privée vérifiée'), etat: etat('prive') });
        const aJour = !!nav && versionAuMoins(nav.version, VERSION_EXTENSION_CHROME);
        points.push({
          cle: 'version',
          texte: t('Version'),
          etat: !nav?.version ? 'a-venir' : aJour ? 'fait' : courante === 'chrome' ? 'en-cours' : 'a-venir',
          valeur: nav?.version ? (aJour ? t('{v} · à jour', { v: nav.version }) : t('{v} · à mettre à jour', { v: nav.version })) : undefined,
        });
        return points;
      }
      case 'safari': {
        const lignes = etapesDeSafari(prepSafari, !!safariNav?.enLigne, !!choixNav?.includes('chrome') && !faite.chrome);
        const textes: Record<string, string> = { installee: t('Extension installée'), activee: t('Activée dans Safari'), reliee: t('Reliée à Beluga') };
        return lignes.map((l) => ({ cle: l.cle, texte: textes[l.cle]!, etat: l.etat }));
      }
      case 'navigateurs': {
        const lignes: Point[] = [{ cle: 'connect', texte: t('{v0} est relié.', { v0: CONNECT }), etat: relie ? 'fait' : 'a-venir', valeur: '' }];
        if (choixNav) lignes.push({ cle: 'choix', texte: t('Navigateurs retenus'), etat: 'fait', valeur: choixNav.length ? navigateursNommes(choixNav, t('et')) : t('Aucun') });
        return lignes;
      }
      default: {
        /* UN AUTRE NAVIGATEUR (Edge, Brave, Firefox…) : les mêmes lignes que Chrome hors Mac — ajoutée, reliée. */
        const autre = navigateurDeLaMarque(cible, e);
        const brute = etapesDeLaPreparation(preparationVue(programme?.autres?.[e] ?? null), autre, false);
        const textes: Record<string, string> = { ajoutee: t('Extension ajoutée'), reliee: t('Reliée à Beluga') };
        return brute.map((x) => ({ cle: x.cle, texte: textes[x.cle] ?? x.cle, etat: faite[e] ? 'fait' : courante !== e && !enEchec[e] ? 'a-venir' : x.etat }));
      }
    }
  };

  /* Le résumé à droite de l'entête : « n sur m » ou « Terminée » une fois fait, orange quand le volet est en cours. */
  const statutDe = (e: Cle, points: Point[]): { texte: string; ton: TonDuResume } => {
    if (faite[e]) return { texte: e === 'installation' ? t('Terminée') : t('{n} sur {total}', { n: points.length, total: points.length }), ton: 'doux' };
    if (enEchec[e]) return { texte: t('À réparer'), ton: 'echec' };
    if (e !== courante) return { texte: e === 'safari' && choixNav?.includes('chrome') && !faite.chrome ? t('Après Chrome') : t('À venir'), ton: 'doux' };
    const aVous = (e === 'installation' && (!installe || secoursOuvert)) || e === 'mac' || e === 'navigateurs';
    return { texte: aVous ? t('À vous') : t('En cours'), ton: 'attend' };
  };

  /* L'explication du volet en cours (ou en panne), sous ses lignes. */
  const explicationDe = (e: Cle): React.ReactNode => {
    switch (e) {
      case 'installation':
        if (!installe || (programmeEnLigne(programme) && !programme?.connect)) {
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
        }
        return secoursOuvert ? (
          <ChampDuCodeDeSecours ordinateurVise={cible?.id ?? null} onRelie={() => setCodeAttendu(null)} />
        ) : (
          <p className="text-[13.5px] leading-relaxed text-text" data-aucune-page>
            {t('« {nom} » est reconnu : la liaison se fait toute seule. Rien à cliquer.', { nom: nomVise })}
          </p>
        );
      case 'mac':
        return <EtapeAutorisations ordinateur={cible} />;
      case 'chrome':
        return (
          <div className="flex flex-col gap-3">
            {chromeEnEchec ? null : (
              <p className="text-[13.5px] leading-relaxed text-text">
                {mac
                  ? t('Rien à faire de votre côté. Beluga vérifie la navigation privée avec une fenêtre privée invisible, aussitôt refermée.')
                  : t('Rien à faire de votre côté : {v0} prépare Chrome.', { v0: CONNECT })}
              </p>
            )}
            <EtapesDeChrome ordinateur={cible} nav={nav} mac={mac} fond="surface" sansLignes />
          </div>
        );
      case 'safari':
        return <EtapeSafari ordinateur={cible} preparation={prepSafari} />;
      case 'navigateurs':
        return cible ? <EtapeNavigateurs ordinateur={cible} ici={marqueDeCetAppareil()} /> : null;
      default:
        return <EtapeAutreNavigateur ordinateur={cible} marque={e} />;
    }
  };

  /* LE BANDEAU DE TÊTE, COMME CELUI DE L'APPLICATION : le nom de l'ordinateur, puis le pire état. */
  const tousLesPoints = Object.fromEntries(etapes.map((e) => [e, pointsDe(e)])) as Record<string, Point[]>;
  const aReparer = etapes.flatMap((e) => tousLesPoints[e]).filter((p) => p.etat === 'echec').length || etapes.filter((e) => enEchec[e]).length;
  const travail = preparationVue(programme?.preparation ?? null);
  const enReparation = (travail?.etat === 'en-cours' && !!travail.travail && travail.travail !== 'installation') || (prepSafari?.etat === 'en-cours' && faite.chrome && !!safariNav);
  const entete: { ton: 'fait' | 'echec' | 'en-cours'; texte: string } = aReparer
    ? { ton: 'echec', texte: aReparer === 1 ? t('1 élément à réparer') : t('{n} éléments à réparer', { n: aReparer }) }
    : toutFait
      ? { ton: 'fait', texte: t('Tout va bien') }
      : enReparation
        ? { ton: 'en-cours', texte: t('Réparation en cours…') }
        : { ton: 'en-cours', texte: t('Installation · étape {n} sur {total}', { n: etapes.indexOf(courante ?? etapes[0]!) + 1, total: etapes.length }) };

  /*
   * LES VOLETS PLEINE LARGEUR, L'UN SOUS L'AUTRE (décision répétée de l'utilisateur : JAMAIS de colonnes ni de blocs
   * côte à côte). Chaque entête : rond, titre, résumé à droite, flèche ; un seul volet ouvert, ses lignes sur la MÊME
   * grille que l'entête (rond sous le rond, libellé sous le titre, état sous le résumé). Aucune barre sur le bord gauche.
   */
  return (
    <div ref={racine} className="flex flex-col gap-1.5" data-parcours-installation data-parcours-connexion={toutFait ? 'fini' : courante ?? ''} data-systeme={systeme ?? 'aucun'} data-ordinateur-vise={cible?.id ?? ''}>
      <EnteteDOrdinateur nom={nomVise} ton={entete.ton} texte={entete.texte} />
      {etapes.map((e) => {
        const fait = faite[e];
        const enCours = e === courante && !toutFait;
        const statut = fait ? 'faite' : enCours ? 'en-cours' : 'a-venir';
        const points = tousLesPoints[e];
        const { texte, ton } = statutDe(e, points);
        const montrerExplication = (enCours || enEchec[e]) && !fait;
        return (
          <Volet
            key={e}
            titre={titreDe(e)}
            rond={fait ? 'fait' : enEchec[e] ? 'echec' : enCours ? 'en-cours' : 'neutre'}
            resume={texte}
            ton={ton}
            ouverte={ouverte === e}
            onBasculer={() => basculer(e)}
            attributs={{ 'data-etape-connexion': e, 'data-etat': statut, 'data-en-cours': enCours ? '' : undefined }}
            lignes={points.map((pt) => ({
              cle: pt.cle,
              libelle: pt.texte,
              rond: pt.etat === 'a-venir' ? 'neutre' : pt.etat,
              etat: pt.etat,
              valeur: pt.valeur ?? valeurDUneLigne(pt.etat),
            }))}
            repereLigne="data-ligne-etat"
          >
            {montrerExplication ? explicationDe(e) : null}
          </Volet>
        );
      })}
      {toutFait ? (
        <div className="mt-1.5 flex flex-col gap-3 rounded-xl bg-fond-survol px-4 py-4 sm:flex-row sm:items-center" data-assistant-tout-pret>
          <div className="min-w-0 flex-1">
            <p className="text-[14.5px] font-semibold text-text">{t('{nom} est prêt', { nom: nomVise })}</p>
            <p className="text-[13.5px] leading-relaxed text-muted">
              {choixNav?.length
                ? mac
                  ? t('Les agents peuvent travailler dans {navs} sur ce Mac.', { navs: navigateursNommes(choixNav, t('et')) })
                  : t('Les agents peuvent maintenant travailler dans {navs} sur cet ordinateur.', { navs: navigateursNommes(choixNav, t('et')) })
                : t('Relié sans navigateur : les agents passent par {v0}. Les navigateurs se choisissent à tout moment sur la page de l’ordinateur.', { v0: CONNECT })}
            </p>
          </div>
          {(onFermer || onVoir) && !integre ? (
            <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
              {onFermer ? (
                <Button variant="subtle" size="md" className="max-sm:w-full" onClick={onFermer} data-parcours-fermer>
                  {t('Fermer')}
                </Button>
              ) : null}
              {onVoir && cible ? (
                <Button variant="default" size="md" className="max-sm:w-full" onClick={() => onVoir(cible.id)} data-parcours-voir>
                  {t('Voir l’ordinateur')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Les volets, communs au parcours et à la page de l'ordinateur          */
/* ------------------------------------------------------------------ */

/**
 * LA GRILLE DES VOLETS (carte « Ordinateurs : pannes et volets alignés », 22/11/2026) : la même pour l'entête et pour
 * chaque ligne — rond (24 px), libellé, état calé à droite, flèche (16 px). Les ronds des lignes se centrent donc sous
 * le rond du volet, leurs libellés sous son titre, leurs états sous son résumé, comme dans Beluga Connect.
 */
const GRILLE_DES_VOLETS = 'grid grid-cols-[24px_minmax(0,1fr)_auto_16px] items-center gap-x-3 px-4';
/** Le retrait de ce qui s'écrit sous les libellés (explication, raison, boutons) : marge + rond + écart. */
const RETRAIT_SOUS_LES_LIBELLES = 'pl-[52px] pr-4';

type TonDuResume = 'doux' | 'attend' | 'echec';

/** L'état d'une ligne, en un mot, quand elle n'en dit pas un plus précis. */
function valeurDUneLigne(etat: 'fait' | 'en-cours' | 'a-venir' | 'echec' | 'neutre'): string {
  if (etat === 'fait') return t('Oui');
  if (etat === 'en-cours') return t('En cours');
  if (etat === 'echec') return t('À réparer');
  return '—';
}

/** Le bandeau de tête : le nom de l'ordinateur, puis son pire état (pastille et texte). */
function EnteteDOrdinateur({ nom, ton, texte }: { nom: string; ton: 'fait' | 'echec' | 'en-cours'; texte: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-fond-survol px-4 py-3" data-entete-ordinateur={ton}>
      <p className="truncate text-[14px] font-semibold text-text">{nom}</p>
      <p className={cn('flex items-center gap-2 text-[12.5px]', ton === 'echec' ? 'text-danger' : 'text-muted')}>
        <span className={cn('size-2 shrink-0 rounded-full', ton === 'fait' ? 'bg-coche' : ton === 'echec' ? 'bg-danger' : '')} style={ton === 'en-cours' ? { backgroundColor: ORANGE } : undefined} aria-hidden />
        {texte}
      </p>
    </div>
  );
}

interface LigneDeVolet {
  cle: string;
  libelle: React.ReactNode;
  rond: EtatDeService;
  /** Ce que porte `data-etat` (les contrôles le lisent). */
  etat: string;
  valeur: string;
}

/**
 * UN VOLET : un entête cliquable (rond, titre, résumé, flèche) et, ouvert, ses lignes sur la même grille, puis ce qui
 * s'écrit sous les libellés. L'état se dit par le rond, le texte et le fond — jamais par une barre sur le bord gauche.
 */
function Volet({
  titre,
  rond,
  resume,
  ton,
  ouverte,
  onBasculer,
  lignes,
  repereLigne,
  attributs,
  children,
}: {
  titre: string;
  rond: EtatDeService;
  resume: string;
  ton: TonDuResume;
  ouverte: boolean;
  onBasculer: () => void;
  lignes: LigneDeVolet[];
  repereLigne: string;
  attributs: Record<string, string | undefined>;
  children?: React.ReactNode;
}) {
  /* toArray écarte déjà null, undefined et les booléens : il ne reste que ce qui s'affiche. */
  const aDire = React.Children.toArray(children).length > 0;
  return (
    <section className="flex flex-col" {...attributs} data-ouverte={ouverte ? '' : undefined}>
      <button
        type="button"
        className={cn(GRILLE_DES_VOLETS, 'min-h-12 py-2 text-left', ouverte ? 'rounded-t-xl bg-fond-survol' : 'rounded-xl bg-raised hover:bg-fond-survol')}
        onClick={onBasculer}
        aria-expanded={ouverte}
        data-entete-etape
      >
        <RondDeService etat={rond} />
        <span className="min-w-0 truncate text-[14px] font-semibold text-text">{titre}</span>
        <span className={cn('shrink-0 text-right text-[12.5px]', ton === 'echec' ? 'text-danger' : ton === 'doux' && 'text-muted')} style={ton === 'attend' ? { color: ORANGE } : undefined} data-statut-etape>
          {resume}
        </span>
        {ouverte ? <ChevronUp className="size-4 text-muted" aria-hidden /> : <ChevronDown className="size-4 text-muted" aria-hidden />}
      </button>
      {ouverte ? (
        <div className="flex flex-col rounded-b-xl bg-raised pb-3 pt-1.5" data-panneau-du-volet>
          <div className="flex flex-col" data-points-etape>
            {lignes.map((l) => (
              <div key={l.cle} className={cn(GRILLE_DES_VOLETS, 'min-h-8')} {...{ [repereLigne]: l.cle }} data-etat={l.etat}>
                <span className="flex justify-center">
                  <RondDeService etat={l.rond} petit />
                </span>
                <span className={cn('min-w-0 truncate text-[13.5px]', l.rond === 'neutre' ? 'text-muted' : 'text-text')}>{l.libelle}</span>
                <span className={cn('shrink-0 text-right text-[12.5px]', l.rond === 'echec' ? 'text-danger' : l.rond !== 'en-cours' && 'text-muted')} style={l.rond === 'en-cours' ? { color: ORANGE } : undefined}>
                  {l.valeur}
                </span>
                <span aria-hidden />
              </div>
            ))}
          </div>
          {aDire ? (
            <div className={cn('flex min-w-0 flex-col gap-3 pt-3', RETRAIT_SOUS_LES_LIBELLES)} data-panneau-etape>
              {children}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
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
  const [fini, setFini] = React.useState(false);
  useRelectureDesOrdinateurs(lire, travailEnCoursSurUnOrdinateur(etat?.ordinateurs) || (!!etat && !fini));
  const surFiniEtNote = React.useCallback(
    (f: boolean) => {
      setFini(f);
      surFini?.(f);
    },
    [surFini],
  );
  const depart = React.useMemo<DepartDuParcours>(() => ({ n: 0, mode: 'attendre' }), []);
  if (!etat) return <div className="h-[280px] animate-pulse rounded-xl bg-raised" data-silhouette />;
  return (
    <div className="flex flex-col gap-3" data-parcours-integre>
      <ParcoursDeConnexion etat={etat} depart={depart} surFini={surFiniEtNote} integre />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Les pièces                                                           */
/* ------------------------------------------------------------------ */

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
          <p className="text-[13.5px] leading-relaxed text-text" data-etapes-installation="mac">
            {t('Ouvrez le fichier téléchargé, glissez {v0} dans Applications, puis lancez-le.', { v0: CONNECT })}
            <br />
            <span className="text-muted">{t('Cet onglet reste ouvert : la suite s’affiche ici toute seule.')}</span>
          </p>
          <GlisserDansApplications />
        </>
      )}
      <div className="flex justify-start">{relancer}</div>
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
        {t('Dans la fenêtre du Mac qui vient de s’afficher, activez {v0}.', { v0: CONNECT })}
        <br />
        <span className="text-muted">{t('C’est le Mac lui-même qui la montre, une seule fois.')}</span>
      </p>
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

/**
 * LE CODE DE SECOURS À TAPER (maquette #ce64) : six cases, la liaison part dès le sixième chiffre. Beluga Connect
 * l'affiche en grand dans sa fenêtre quand il n'a pas pu être reconnu à coup sûr (carte « Beluga Connect : liaison sans
 * fenêtre », 22/11/2026). Un seul champ réel sous les six cases : le collage et le clavier du téléphone marchent.
 */
function ChampDuCodeDeSecours({ ordinateurVise, onRelie }: { ordinateurVise: string | null; onRelie: () => void }) {
  const [valeur, setValeur] = React.useState('');
  const [envoi, setEnvoi] = React.useState(false);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const champ = React.useRef<HTMLInputElement>(null);
  const envoyer = React.useCallback(
    async (code: string) => {
      setEnvoi(true);
      setErreur(null);
      try {
        await client.call({ type: 'relaisMac.liaison.parCode', code, ordinateurId: ordinateurVise ?? undefined });
        onRelie();
      } catch (err: any) {
        setErreur(err?.message ?? t('Le geste n’a pas abouti.'));
        setValeur('');
        champ.current?.focus();
      } finally {
        setEnvoi(false);
      }
    },
    [ordinateurVise, onRelie],
  );
  const changer = (brut: string) => {
    const net = brut.replace(/\D/g, '').slice(0, 6);
    setValeur(net);
    if (net.length === 6 && !envoi) void envoyer(net);
  };
  return (
    <div className="flex flex-col gap-3" data-code-de-secours-attendu>
      <p className="text-[13.5px] leading-relaxed text-text">
        {t('Ce Mac n’a pas pu être reconnu à coup sûr. Tapez le code à six chiffres affiché dans la fenêtre de {v0}.', { v0: CONNECT })}
      </p>
      <label className="relative flex w-fit gap-1.5" data-cases-du-code>
        {Array.from({ length: 6 }, (_, i) => (
          <span
            key={i}
            className={cn(
              'flex h-12 w-10 items-center justify-center rounded-lg bg-surface font-mono text-[20px] font-semibold text-text',
              i === 3 && 'ml-2',
              i === Math.min(valeur.length, 5) && !envoi && 'ring-2 ring-inset',
            )}
            style={i === Math.min(valeur.length, 5) && !envoi ? { ['--tw-ring-color' as string]: ORANGE } : undefined}
            aria-hidden
          >
            {valeur[i] ?? ''}
          </span>
        ))}
        <Input
          ref={champ}
          value={valeur}
          onChange={(e) => changer(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          disabled={envoi}
          aria-label="Code de Beluga Connect"
          className="absolute inset-0 h-full w-full cursor-text opacity-0"
          data-champ-code-de-secours
        />
      </label>
      {envoi ? <EnAttente>{t('Liaison en cours…')}</EnAttente> : null}
      {erreur ? (
        <p className="text-[13px] text-danger" data-erreur-code>
          {erreur}
        </p>
      ) : (
        <p className="text-[12.5px] text-muted">{t('La liaison part dès le sixième chiffre.')}</p>
      )}
    </div>
  );
}

/**
 * SAFARI D'OFFICE, APRÈS CHROME (maquette #1b3e3) : Beluga Connect pose l'application, coche l'extension dans les
 * réglages de Safari et la relie lui-même. Ici : l'explication, la raison d'un échec et « Réessayer ».
 */
function EtapeSafari({ ordinateur, preparation }: { ordinateur: Ordinateur | null; preparation: PreparationDeSafari | null }) {
  const [envoi, setEnvoi] = React.useState(false);
  const echec = preparation?.etat === 'echec';
  const reessayer = async () => {
    if (!ordinateur) return;
    setEnvoi(true);
    try {
      await client.call({ type: 'relaisMac.preparerSafari', ordinateurId: ordinateur.id });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Le geste n’a pas abouti.'));
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <div className="flex flex-col gap-3" data-etape-safari={preparation?.etat ?? 'aucune'}>
      <p className="text-[13.5px] leading-relaxed text-text">
        {t('{v0} active l’extension dans les réglages de Safari : rien à télécharger, aucun code à taper.', { v0: CONNECT })}
      </p>
      {echec && preparation?.message ? (
        <p className="text-[12.5px] leading-relaxed text-muted [overflow-wrap:anywhere]" data-raison-echec>
          {preparation.message}
        </p>
      ) : null}
      {echec ? (
        <Button variant="subtle" size="md" className="self-start bg-surface hover:bg-surface/70 max-sm:w-full" onClick={() => void reessayer()} disabled={envoi || !ordinateur} data-safari-reessayer>
          {envoi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {t('Réessayer')}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * UN AUTRE NAVIGATEUR CHOISI (Edge, Brave, Opera, Vivaldi, Arc, Firefox) : Beluga Connect y pose le même module que
 * dans Chrome et le relie ; ici, l'explication, la raison d'un échec et « Réessayer ».
 */
function EtapeAutreNavigateur({ ordinateur, marque }: { ordinateur: Ordinateur | null; marque: MarqueDeNavigateur }) {
  const [envoi, setEnvoi] = React.useState(false);
  const preparation = preparationVue(ordinateur?.programme?.autres?.[marque] ?? null);
  const echec = preparation?.etat === 'echec';
  const reessayer = async () => {
    if (!ordinateur) return;
    setEnvoi(true);
    try {
      await client.call({ type: 'relaisMac.preparer', ordinateurId: ordinateur.id, marque });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Le geste n’a pas abouti.'));
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <div className="flex flex-col gap-3" data-etape-autre-navigateur={marque} data-etat={preparation?.etat ?? 'aucune'}>
      <p className="text-[13.5px] leading-relaxed text-text">{t('Rien à faire de votre côté : {v0} prépare {nav}.', { v0: CONNECT, nav: MARQUES[marque].nom })}</p>
      {echec && preparation?.message ? (
        <p className="text-[12.5px] leading-relaxed text-muted [overflow-wrap:anywhere]" data-raison-echec>
          {preparation.message}
        </p>
      ) : null}
      {echec ? (
        <Button variant="subtle" size="md" className="self-start bg-surface hover:bg-surface/70 max-sm:w-full" onClick={() => void reessayer()} disabled={envoi || !ordinateur} data-autre-reessayer={marque}>
          {envoi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {t('Réessayer')}
        </Button>
      ) : null}
    </div>
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
export function EtapesDeChrome({
  ordinateur,
  nav,
  mac,
  fond = 'raised',
  sansLignes,
}: {
  ordinateur: Ordinateur | null;
  nav: NavigateurDOrdinateur | null;
  mac: boolean;
  /** Le fond de l'encadré du code de secours : l'opposé de celui où il est posé. */
  fond?: 'raised' | 'surface';
  /** Dans le parcours, les points du bloc Chrome sont déjà dessinés : ici, seulement le secours et l'échec. */
  sansLignes?: boolean;
}) {
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
  /* Les cinq lignes du Mac, dans l'ordre et avec les mots de Beluga Connect (fenêtre et volet). */
  const libelles: Record<string, { titre: string; enCours: string }> = {
    developpeur: { titre: t('Mode développeur activé'), enCours: t('Activation du mode développeur…') },
    ajoutee: { titre: t('Extension ajoutée à Chrome'), enCours: t('Ajout de l’extension à Chrome…') },
    reliee: { titre: t('Extension reliée à Beluga'), enCours: t('Liaison de l’extension…') },
    prive: { titre: t('Navigation privée vérifiée'), enCours: t('Vérification de la navigation privée…') },
    rouvert: { titre: t('Chrome rouvert avec vos onglets'), enCours: t('Réouverture de Chrome…') },
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
        {!sansLignes &&
          etapes.map((e) => (
          <LigneDEtat
            key={e.cle}
            repere={e.cle}
            etat={e.etat === 'echec' ? 'echec' : e.etat}
            droite={
              e.cle === 'ajoutee' && e.etat === 'fait' ? (
                <span className="shrink-0 text-[12px] text-muted">{t('vérifiée')}</span>
              ) : e.etat === 'en-cours' && (preparation?.essais ?? 0) > 1 ? (
                <span className="shrink-0 text-[12px] text-muted">{t('essai {n} sur 3', { n: preparation?.essais ?? 1 })}</span>
              ) : null
            }
          >
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
/* L'état par service d'un ordinateur (page de l'ordinateur)            */
/* ------------------------------------------------------------------ */

type EtatDeService = 'fait' | 'en-cours' | 'echec' | 'neutre';
interface LigneDeService {
  cle: string;
  libelle: string;
  etat: EtatDeService;
  valeur: string;
}
interface SectionDeService {
  cle: string;
  titre: string;
  etat: EtatDeService;
  resume: string;
  lignes: LigneDeService[];
  /** Le geste de « Réparer », s'il y en a un pour cette section. */
  reparer?: () => Promise<unknown>;
  /** Ce qu'il faut faire quand aucun geste ne peut partir d'ici. */
  conseil?: string;
}

function RondDeService({ etat, petit }: { etat: EtatDeService; petit?: boolean }) {
  const taille = petit ? 'size-[18px]' : 'size-6';
  if (etat === 'fait')
    return (
      <span className={cn('flex shrink-0 items-center justify-center rounded-full bg-coche text-sur-couleur', taille)} data-rond="fait">
        <Check className={petit ? 'size-2.5' : 'size-3.5'} strokeWidth={3} />
      </span>
    );
  if (etat === 'echec')
    return (
      <span className={cn('flex shrink-0 items-center justify-center rounded-full bg-danger text-sur-couleur', taille)} data-rond="echec">
        <X className={petit ? 'size-2.5' : 'size-3.5'} strokeWidth={3} />
      </span>
    );
  if (etat === 'en-cours') return <LoaderCircle className={cn('shrink-0 animate-spin', taille)} style={{ color: ORANGE }} data-rond="en-cours" />;
  return <span className={cn('shrink-0 rounded-full ring-[1.5px] ring-inset ring-faint', taille)} data-rond="a-venir" />;
}

/**
 * L'ÉTAT PAR SERVICE D'UN ORDINATEUR, EN ACCORDÉON (carte « Beluga Connect : liaison et suivi », 22/11/2026, maquette
 * #e611 col. 6) : les sections de la fenêtre de Beluga Connect — Beluga Connect, Autorisations du Mac, Extension Chrome,
 * Mises à jour — en blocs contrastés. Celles qui vont bien sont repliées sur leur coche et leur résumé ; celle qui a un
 * problème s'ouvre en rouge avec SON bouton « Réparer », suivi ici et sur l'ordinateur. L'en-tête dit le pire état.
 */
export function EtatDesServices({ ordinateur }: { ordinateur: Ordinateur }) {
  const p = ordinateur.programme;
  const mac = (p?.systeme ?? 'mac') === 'mac';
  const nav = chromeDe(ordinateur);
  const preparation = preparationVue(p?.preparation ?? null);
  const [envoi, setEnvoi] = React.useState<string | null>(null);
  const [choix, setChoix] = React.useState<{ cle: string | null; sous: string | null } | null>(null);
  if (!p) return null;
  const relie = programmeEnLigne(p) && !!p.connect;
  const enPreparation = preparation?.etat === 'en-cours';
  /* SEULS LES NAVIGATEURS CHOISIS ont leur section (carte « Navigateurs facultatifs à la liaison »). */
  const choixNav = choixEffectif(ordinateur.navigateursChoisis, ordinateur.navigateurs) ?? [];
  const sections: SectionDeService[] = [];
  sections.push({
    cle: 'connect',
    titre: CONNECT,
    etat: relie ? 'fait' : 'echec',
    resume: relie ? t('Relié') : t('À réparer'),
    lignes: [
      { cle: 'marche', libelle: t('En marche sur l’ordinateur'), etat: relie ? 'fait' : 'echec', valeur: relie ? t('Oui') : t('Non') },
      { cle: 'version', libelle: t('Version'), etat: p.connect ? 'fait' : 'echec', valeur: p.connect ?? t('ancienne') },
    ],
    conseil: relie ? undefined : t('Ouvrez Beluga Connect sur cet ordinateur : il se reliera tout seul.'),
  });
  if (mac) {
    const a = p.autorisations;
    const lignes: LigneDeService[] = [
      { cle: 'accessibilite', libelle: t('Souris et clavier'), etat: a?.accessibilite ? 'fait' : 'echec', valeur: a?.accessibilite ? t('Accordée') : t('À activer') },
      { cle: 'ecran', libelle: t('Voir l’écran'), etat: a?.ecran ? 'fait' : 'echec', valeur: a?.ecran ? t('Accordée') : t('À activer') },
    ];
    const n = lignes.filter((l) => l.etat === 'fait').length;
    sections.push({
      cle: 'autorisations',
      titre: t('Autorisations du Mac'),
      etat: n === 2 ? 'fait' : 'echec',
      resume: n === 2 ? t('{n} sur {total}', { n, total: 2 }) : t('À réparer'),
      lignes,
      reparer: relie ? () => client.call({ type: 'relaisMac.reglage', ordinateurId: ordinateur.id, reglage: 'aide' }) : undefined,
    });
  }
  const lignesChrome: LigneDeService[] = [
    { cle: 'ajoutee', libelle: t('Extension ajoutée'), etat: nav ? 'fait' : 'echec', valeur: nav ? t('Oui') : t('Absente') },
    {
      cle: 'reliee',
      libelle: t('Reliée à Beluga'),
      etat: !nav ? 'neutre' : nav.enLigne ? 'fait' : 'neutre',
      valeur: !nav ? '—' : nav.enLigne ? t('Oui') : t('Chrome fermé'),
    },
    ...(mac
      ? [{ cle: 'prive', libelle: t('Navigation privée'), etat: (!nav ? 'neutre' : nav.incognito === true ? 'fait' : 'echec') as EtatDeService, valeur: !nav ? '—' : nav.incognito === true ? t('Vérifiée') : t('À autoriser') }]
      : []),
  ];
  const koChrome = lignesChrome.filter((l) => l.etat === 'echec').length;
  if (choixNav.includes('chrome')) sections.push({
    cle: 'chrome',
    titre: t('Extension Chrome'),
    etat: enPreparation ? 'en-cours' : koChrome ? 'echec' : 'fait',
    resume: enPreparation ? t('Réparation…') : koChrome ? t('À réparer') : t('{n} sur {total}', { n: lignesChrome.filter((l) => l.etat === 'fait').length, total: lignesChrome.length }),
    lignes: lignesChrome,
    reparer: relie ? () => client.call({ type: 'relaisMac.preparer', ordinateurId: ordinateur.id }) : undefined,
  });
  /* SAFARI (carte « Beluga Connect : liaison sans fenêtre ») : posé par Beluga Connect, après Chrome si Chrome est choisi. */
  if (mac && choixNav.includes('safari')) {
    const safari = ordinateur.navigateurs.find((n) => n.genre === 'safari' && n.enLigne) ?? null;
    const lignesSafari = etapesDeSafari(p.safari ?? null, !!safari, choixNav.includes('chrome') && !nav?.enLigne);
    const textes: Record<string, string> = { installee: t('Extension installée'), activee: t('Activée dans Safari'), reliee: t('Reliée à Beluga') };
    const lignes: LigneDeService[] = lignesSafari.map((l) => ({
      cle: `safari-${l.cle}`,
      libelle: textes[l.cle]!,
      etat: l.etat === 'fait' ? 'fait' : l.etat === 'echec' ? 'echec' : l.etat === 'en-cours' ? 'en-cours' : 'neutre',
      valeur: l.etat === 'fait' ? t('Oui') : l.etat === 'echec' ? t('À réparer') : l.etat === 'en-cours' ? t('En cours') : '—',
    }));
    const enCoursSafari = p.safari?.etat === 'en-cours';
    const koSafari = lignes.some((l) => l.etat === 'echec');
    sections.push({
      cle: 'safari',
      titre: 'Safari',
      etat: enCoursSafari ? 'en-cours' : koSafari ? 'echec' : safari ? 'fait' : 'neutre',
      resume: enCoursSafari ? t('Installation…') : koSafari ? t('À réparer') : safari ? t('Relié') : nav?.enLigne && nav.incognito === true ? t('À venir') : t('Après Chrome'),
      lignes,
      reparer: relie ? () => client.call({ type: 'relaisMac.preparerSafari', ordinateurId: ordinateur.id }) : undefined,
    });
  }
  /* LES AUTRES NAVIGATEURS CHOISIS (Edge, Brave, Firefox…) : extension ajoutée, reliée. */
  for (const m of choixNav.filter((x) => x !== 'chrome' && x !== 'safari')) {
    const autre = navigateurDeLaMarque(ordinateur, m);
    const prep = preparationVue(p.autres?.[m] ?? null);
    const lignes: LigneDeService[] = [
      { cle: `${m}-ajoutee`, libelle: t('Extension ajoutée'), etat: autre ? 'fait' : prep?.etat === 'echec' ? 'echec' : 'neutre', valeur: autre ? t('Oui') : '—' },
      { cle: `${m}-reliee`, libelle: t('Reliée à Beluga'), etat: autre?.enLigne ? 'fait' : 'neutre', valeur: !autre ? '—' : autre.enLigne ? t('Oui') : t('Fermé') },
    ];
    const enCoursAutre = prep?.etat === 'en-cours';
    const ko = lignes.some((l) => l.etat === 'echec');
    sections.push({
      cle: m,
      titre: MARQUES[m].nom,
      etat: enCoursAutre ? 'en-cours' : ko ? 'echec' : autre ? 'fait' : 'neutre',
      resume: enCoursAutre ? t('Installation…') : ko ? t('À réparer') : autre ? t('Relié') : t('À venir'),
      lignes,
      reparer: relie ? () => client.call({ type: 'relaisMac.preparer', ordinateurId: ordinateur.id, marque: m }) : undefined,
    });
  }
  const aJour = !nav || versionAuMoins(nav.version, VERSION_EXTENSION_CHROME);
  if (choixNav.includes('chrome')) sections.push({
    cle: 'mises-a-jour',
    titre: t('Mises à jour'),
    etat: aJour ? 'fait' : 'echec',
    resume: aJour ? t('À jour') : t('À réparer'),
    lignes: [{ cle: 'extension', libelle: t('Extension Chrome'), etat: !nav ? 'neutre' : aJour ? 'fait' : 'echec', valeur: !nav ? '—' : aJour ? t('{v} · à jour', { v: nav.version ?? '' }) : t('{v} · à mettre à jour', { v: nav.version ?? '?' }) }],
    reparer: nav && !aJour ? () => client.call({ type: 'extension.mettreAJour', chromeId: nav.id }) : undefined,
  });

  const ko = sections.flatMap((s) => s.lignes).filter((l) => l.etat === 'echec').length;
  const entete = enPreparation
    ? { etat: 'en-cours' as const, texte: t('Réparation en cours…') }
    : ko
      ? { etat: 'echec' as const, texte: ko === 1 ? t('1 élément à réparer') : t('{n} éléments à réparer', { n: ko }) }
      : { etat: 'fait' as const, texte: t('Tout va bien') };
  const reparer = async (s: SectionDeService) => {
    if (!s.reparer) return;
    setEnvoi(s.cle);
    try {
      await s.reparer();
      client.afficherMessage('info', t('Réparation lancée : elle se suit ici et sur l’ordinateur.'));
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Le geste n’a pas abouti.'));
    } finally {
      setEnvoi(null);
    }
  };
  /* UN SEUL VOLET OUVERT (même règle que la fenêtre de connexion) : le premier en panne ou en cours, sinon aucun. */
  const parDefaut = sections.find((s) => s.etat === 'echec' || s.etat === 'en-cours')?.cle ?? null;
  const ouverte = choix && choix.sous === parDefaut ? choix.cle : parDefaut;
  return (
    <div className="flex flex-col gap-1.5" data-etat-des-services={entete.etat}>
      <EnteteDOrdinateur nom={p.connect ? `${CONNECT} ${p.connect}` : CONNECT} ton={entete.etat} texte={entete.texte} />
      {sections.map((s) => (
        <Volet
          key={s.cle}
          titre={s.titre}
          rond={s.etat}
          resume={s.resume}
          ton={s.etat === 'echec' ? 'echec' : s.etat === 'en-cours' ? 'attend' : 'doux'}
          ouverte={ouverte === s.cle}
          onBasculer={() => setChoix({ cle: ouverte === s.cle ? null : s.cle, sous: parDefaut })}
          attributs={{ 'data-section-de-service': s.cle, 'data-etat': s.etat }}
          lignes={
            /* Pendant une réparation, le détail des étapes se lit plus bas, sous « Navigateurs » (une seule fois). */
            s.cle === 'chrome' && enPreparation ? [] : s.lignes.map((l) => ({ cle: l.cle, libelle: l.libelle, rond: l.etat, etat: l.etat, valeur: l.valeur }))
          }
          repereLigne="data-ligne-de-service"
        >
          {s.cle === 'chrome' && enPreparation ? <p className="text-[13px] leading-relaxed text-muted">{t('Beluga Connect répare Chrome : les étapes se cochent sous « Navigateurs ».')}</p> : null}
          {s.etat === 'echec' && preparation?.etat === 'echec' && s.cle === 'chrome' && preparation.message ? (
            <p className="text-[12.5px] leading-relaxed text-muted [overflow-wrap:anywhere]" data-raison-echec>
              {preparation.message}
            </p>
          ) : null}
          {s.etat === 'echec' && s.cle === 'safari' && p.safari?.etat === 'echec' && p.safari.message ? (
            <p className="text-[12.5px] leading-relaxed text-muted [overflow-wrap:anywhere]" data-raison-echec>
              {p.safari.message}
            </p>
          ) : null}
          {s.etat === 'echec' && s.conseil ? <p className="text-[12.5px] leading-relaxed text-muted">{s.conseil}</p> : null}
          {s.etat === 'echec' && s.reparer ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="creation" size="md" className="max-sm:w-full" onClick={() => void reparer(s)} disabled={!!envoi} data-reparer-service={s.cle}>
                {envoi === s.cle ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
                {t('Réparer')}
              </Button>
              <span className="text-[12.5px] text-muted">{t('Se suit ici et sur l’ordinateur.')}</span>
            </div>
          ) : null}
        </Volet>
      ))}
    </div>
  );
}
