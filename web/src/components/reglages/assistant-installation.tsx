import * as React from 'react';
import { ArrowRight, Check, ChevronDown, ChevronUp, Copy, Download, Folder, Loader2, LoaderCircle, RefreshCw, Wrench, X } from '@/components/ui/icones';
import {
  LIBELLE_DU_NAVIGATEUR,
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
  versionAuMoins,
  type EtatDeLExtension,
  type GenreDeNavigateur,
  type NavigateurDOrdinateur,
  type Ordinateur,
  type PreparationDeSafari,
  type SystemeDOrdinateur,
} from '@beluga/shared';
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, Input } from '@/components/ui';
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

type Cle = 'installer' | 'relier' | 'autorisations' | 'navigateur' | 'safari';
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
    (!mac || nav.incognito === true) &&
    /* Sur un Mac, Safari aussi (posé d'office après Chrome, carte « Beluga Connect : liaison sans fenêtre »). */
    (!mac || o.navigateurs.some((n) => n.genre === 'safari' && n.enLigne))
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
  const etapes: Cle[] = mac ? ['installer', 'relier', 'autorisations', 'navigateur', 'safari'] : ['installer', 'relier', 'navigateur'];
  const chromeFait = !!nav?.enLigne && versionAuMoins(nav.version, VERSION_EXTENSION_CHROME) && (!mac || nav.incognito === true);
  const faite: Record<Cle, boolean> = {
    installer: installe,
    relier: relie,
    autorisations: relie && autorisationsDonnees(programme),
    navigateur: chromeFait,
    safari: !!safariNav?.enLigne,
  };
  const toutFait = etapes.every((e) => faite[e]);
  const courante = etapes.find((e) => !faite[e]) ?? null;
  React.useEffect(() => {
    surFini?.(toutFait);
  }, [toutFait, surFini]);
  /* LE BLOC EN COURS RESTE SOUS LES YEUX : à chaque étape qui s'ouvre, la zone défile jusqu'à lui (puis jusqu'à
     « … est prêt » à la fin) — sans quoi Chrome et Safari avançaient sous le bas de la fenêtre. */
  const racine = React.useRef<HTMLDivElement>(null);
  const premierRendu = React.useRef(true);
  React.useEffect(() => {
    if (premierRendu.current) {
      premierRendu.current = false;
      return;
    }
    /* Après la pose du contenu du bloc (sa hauteur finale), pas avant. */
    const minuteur = window.setTimeout(() => {
      const cible = racine.current?.querySelector<HTMLElement>(toutFait ? '[data-assistant-tout-pret]' : '[data-etape-connexion][data-ouverte]');
      cible?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 200);
    return () => window.clearTimeout(minuteur);
  }, [courante, toutFait]);

  const ce = systeme === 'mac' ? t('ce Mac') : systeme === 'windows' ? t('ce PC') : t('cet ordinateur');
  const nomVise = cible?.nom ?? (systeme === 'mac' ? 'Mac' : systeme === 'windows' ? 'PC' : t('Cet ordinateur'));
  const titreDe = (e: Cle): string => {
    switch (e) {
      case 'installer':
        return t('Installer {v0}', { v0: CONNECT });
      case 'relier':
        return systeme === 'mac' ? t('Relier ce Mac') : systeme === 'windows' ? t('Relier ce PC') : t('Relier cet ordinateur');
      case 'autorisations':
        return t('Autorisations du Mac');
      case 'navigateur':
        return 'Chrome';
      case 'safari':
        return 'Safari';
    }
  };

  /* La préparation de Chrome a échoué : le bloc le dit en rouge (« À réparer »), « Réessayer » la relance. */
  const chromeEnEchec = !faite.navigateur && preparationVue(programme?.preparation ?? null)?.etat === 'echec';
  const prepSafari = programme?.safari ?? null;
  const safariEnEchec = !faite.safari && prepSafari?.etat === 'echec';

  /* LES POINTS DE CHAQUE BLOC, L'UN SOUS L'AUTRE (maquettes #b22e, #8de5f, #ce64, #b0d01, #9cb2, #1b3e3, #e435). */
  type Point = { cle: string; texte: string; etat: 'fait' | 'en-cours' | 'a-venir' | 'echec' };
  const pointsDe = (e: Cle): Point[] => {
    switch (e) {
      case 'installer': {
        const telecharge = !!telechargeLe || !!code || installe;
        if (systemeAppareil === 'linux' || systeme === 'linux') {
          return [
            { cle: 'telecharge', texte: t('Commande copiée'), etat: telecharge ? 'fait' : 'en-cours' },
            { cle: 'lance', texte: t('{v0} lancé', { v0: CONNECT }), etat: installe ? 'fait' : telecharge ? 'en-cours' : 'a-venir' },
          ];
        }
        if (systeme === 'windows') {
          return [
            { cle: 'telecharge', texte: t('Téléchargé'), etat: telecharge ? 'fait' : 'en-cours' },
            { cle: 'lance', texte: installe ? t('{v0} lancé', { v0: CONNECT }) : t('Lancer {v0}', { v0: CONNECT }), etat: installe ? 'fait' : telecharge ? 'en-cours' : 'a-venir' },
          ];
        }
        return [
          { cle: 'telecharge', texte: t('Téléchargé'), etat: telecharge ? 'fait' : 'en-cours' },
          { cle: 'glisse', texte: installe ? t('Glissé dans Applications') : t('Glisser dans Applications'), etat: installe ? 'fait' : telecharge ? 'en-cours' : 'a-venir' },
          { cle: 'lance', texte: installe ? t('{v0} lancé', { v0: CONNECT }) : t('Lancer {v0}', { v0: CONNECT }), etat: installe ? 'fait' : 'a-venir' },
        ];
      }
      case 'relier':
        if (secoursOuvert) {
          return [
            { cle: 'code', texte: t('Code de {v0}', { v0: CONNECT }), etat: 'en-cours' },
            { cle: 'relie', texte: t('Relié à votre compte'), etat: 'a-venir' },
          ];
        }
        return [
          { cle: 'reconnu', texte: systeme === 'mac' ? t('Ce Mac reconnu') : systeme === 'windows' ? t('Ce PC reconnu') : t('Cet ordinateur reconnu'), etat: programme ? 'fait' : installe ? 'en-cours' : 'a-venir' },
          { cle: 'relie', texte: t('Relié à votre compte'), etat: relie ? 'fait' : programme ? 'en-cours' : 'a-venir' },
        ];
      case 'autorisations': {
        const a = programme?.autorisations ?? null;
        const ouvert = courante === 'autorisations';
        return [
          { cle: 'accessibilite', texte: t('Souris et clavier'), etat: a?.accessibilite ? 'fait' : ouvert ? 'en-cours' : 'a-venir' },
          { cle: 'ecran', texte: t('Voir l’écran'), etat: a?.ecran ? 'fait' : ouvert && a?.accessibilite ? 'en-cours' : 'a-venir' },
        ];
      }
      case 'navigateur': {
        const brute = etapesDeLaPreparation(preparationVue(programme?.preparation ?? null), nav, mac);
        const etat = (cle: string): Point['etat'] => {
          if (faite.navigateur) return 'fait';
          if (courante !== 'navigateur') return 'a-venir';
          return (brute.find((x) => x.cle === cle)?.etat ?? 'a-venir') as Point['etat'];
        };
        /* Le mode développeur se range sous « Extension ajoutée » : trois points, comme sur la maquette. */
        const ajoutee: Point['etat'] = etat('developpeur') === 'echec' ? 'echec' : etat('developpeur') === 'fait' ? etat('ajoutee') : etat('developpeur');
        const points: Point[] = [
          { cle: 'ajoutee', texte: t('Extension ajoutée'), etat: ajoutee },
          { cle: 'reliee', texte: t('Reliée à Beluga'), etat: etat('reliee') },
        ];
        if (mac) points.push({ cle: 'prive', texte: t('Navigation privée vérifiée'), etat: etat('prive') });
        return points;
      }
      case 'safari': {
        const lignes = etapesDeSafari(prepSafari, !!safariNav?.enLigne, !faite.navigateur);
        const textes: Record<string, string> = { installee: t('Extension installée'), activee: t('Activée dans Safari'), reliee: t('Reliée à Beluga') };
        return lignes.map((l) => ({ cle: l.cle, texte: textes[l.cle]!, etat: l.etat }));
      }
    }
  };

  /* Le statut à droite de l'entête : orange quand on attend la personne, gris quand tout se fait seul. */
  const statutDe = (e: Cle): { texte: string; attend: boolean; echec?: boolean } => {
    if (faite[e]) return { texte: t('Fait'), attend: false };
    if (e === 'navigateur' && chromeEnEchec) return { texte: t('À réparer'), attend: false, echec: true };
    if (e === 'safari' && safariEnEchec) return { texte: t('À réparer'), attend: false, echec: true };
    if (e !== courante) return { texte: e === 'safari' && !faite.navigateur ? t('Après Chrome') : t('À venir'), attend: false };
    if (e === 'installer') return { texte: t('À vous'), attend: true };
    if (e === 'relier') return secoursOuvert ? { texte: t('À vous'), attend: true } : { texte: t('En cours…'), attend: false };
    if (e === 'autorisations') return { texte: t('À vous'), attend: true };
    return { texte: t('En cours…'), attend: false };
  };

  /* L'explication du bloc EN COURS, sous ses points. */
  const explicationDe = (e: Cle): React.ReactNode => {
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
        return secoursOuvert ? (
          <ChampDuCodeDeSecours ordinateurVise={cible?.id ?? null} onRelie={() => setCodeAttendu(null)} />
        ) : (
          <p className="text-[13.5px] leading-relaxed text-text" data-aucune-page>
            {t('« {nom} » est reconnu : la liaison se fait toute seule. Rien à cliquer.', { nom: nomVise })}
          </p>
        );
      case 'autorisations':
        return <EtapeAutorisations ordinateur={cible} />;
      case 'navigateur':
        return (
          <div className="flex flex-col gap-3">
            <p className="text-[13.5px] leading-relaxed text-text">
              {mac
                ? t('Rien à faire de votre côté. Beluga vérifie la navigation privée avec une fenêtre privée invisible, aussitôt refermée.')
                : t('Rien à faire de votre côté : {v0} prépare Chrome.', { v0: CONNECT })}
            </p>
            <EtapesDeChrome ordinateur={cible} nav={nav} mac={mac} fond="surface" sansLignes />
          </div>
        );
      case 'safari':
        return <EtapeSafari ordinateur={cible} preparation={prepSafari} />;
    }
  };

  /*
   * CINQ BLOCS PLEINE LARGEUR, L'UN SOUS L'AUTRE (carte « Beluga Connect : liaison sans fenêtre », 22/11/2026 —
   * décision répétée de l'utilisateur : JAMAIS de colonnes, ni blocs côte à côte, ni points alignés sur une ligne, ni
   * étapes regroupées). Chaque bloc : rond + titre + statut à droite, puis ses points l'un sous l'autre. Le bloc en
   * cours est plus clair et porte l'explication ; les blocs faits restent dépliés avec leurs coches ; les blocs à venir
   * sont atténués. Plus aucun bouton « Relier » : la liaison se fait toute seule.
   */
  return (
    <div ref={racine} className="flex flex-col gap-2" data-parcours-installation data-parcours-connexion={toutFait ? 'fini' : courante ?? ''} data-systeme={systeme ?? 'aucun'} data-ordinateur-vise={cible?.id ?? ''}>
      {etapes.map((e, i) => {
        const fait = faite[e];
        const enCours = e === courante && !toutFait;
        const statut = fait ? 'faite' : enCours ? 'en-cours' : 'a-venir';
        const { texte, attend, echec } = statutDe(e);
        return (
          <section
            key={e}
            className={cn('flex flex-col rounded-xl px-4 pb-4 pt-3.5', enCours ? 'bg-fond-survol' : 'bg-raised', statut === 'a-venir' && 'opacity-55')}
            data-etape-connexion={e}
            data-etat={statut}
            data-ouverte={enCours ? '' : undefined}
          >
            <div className="flex min-h-7 items-center gap-3" data-entete-etape>
              <RondDeLEtape statut={fait ? 'faite' : echec ? 'echec' : enCours ? 'ouverte' : 'a-venir'} numero={i + 1} />
              <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold text-text">{titreDe(e)}</span>
              <span className={cn('shrink-0 text-right text-[12.5px]', echec ? 'text-danger' : !attend && 'text-muted')} style={attend ? { color: ORANGE } : undefined} data-statut-etape>
                {texte}
              </span>
            </div>
            <div className="flex flex-col gap-0.5 pl-9 pt-1.5" data-points-etape>
              {pointsDe(e).map((pt) => (
                <LigneDEtat key={pt.cle} repere={pt.cle} etat={pt.etat}>
                  {pt.texte}
                </LigneDEtat>
              ))}
            </div>
            {enCours ? (
              <div className="flex min-w-0 flex-col gap-3 pl-9 pt-3" data-panneau-etape>
                {explicationDe(e)}
              </div>
            ) : null}
            {!enCours && echec ? (
              <div className="flex min-w-0 flex-col gap-3 pl-9 pt-3" data-panneau-etape>
                {explicationDe(e)}
              </div>
            ) : null}
          </section>
        );
      })}
      {toutFait ? (
        <div className="flex flex-col gap-3 rounded-xl bg-fond-survol px-4 py-4 sm:flex-row sm:items-center" data-assistant-tout-pret>
          <div className="min-w-0 flex-1">
            <p className="text-[14.5px] font-semibold text-text">{t('{nom} est prêt', { nom: nomVise })}</p>
            <p className="text-[13.5px] leading-relaxed text-muted">
              {mac ? t('Les agents peuvent travailler dans Chrome et Safari sur ce Mac.') : t('Les agents peuvent maintenant travailler dans Chrome sur cet ordinateur.')}
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

function RondDeLEtape({ statut, numero }: { statut: 'faite' | 'ouverte' | 'a-venir' | 'echec'; numero: number }) {
  if (statut === 'faite') {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-coche text-sur-couleur" data-rond="fait">
        <Check className="size-3.5" strokeWidth={3} />
      </span>
    );
  }
  if (statut === 'echec') {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-danger text-sur-couleur" data-rond="echec">
        <X className="size-3.5" strokeWidth={3} />
      </span>
    );
  }
  /* En cours : un anneau orange numéroté ; à venir : un anneau discret. */
  return (
    <span
      className={cn('flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ring-inset', statut === 'ouverte' ? 'ring-2' : 'text-muted ring-[1.5px] ring-faint')}
      style={statut === 'ouverte' ? { color: ORANGE, ['--tw-ring-color' as string]: ORANGE } : undefined}
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
/* Safari : l'application signée et son code (seul geste encore à la main) */
/* ------------------------------------------------------------------ */

const heure = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * BELUGA POUR SAFARI (page d'un Mac). CARTE « BELUGA CONNECT : LIAISON SANS FENÊTRE » (22/11/2026) : quand Beluga
 * Connect répond sur ce Mac, « Installer dans Safari » lui demande de poser l'application, de cocher l'extension dans
 * les réglages de Safari et de la relier — plus aucun fichier à télécharger, plus aucun code à taper. Les trois lignes
 * se cochent ici en direct. Sans Beluga Connect joignable seulement : l'ancien chemin (télécharger, puis le code).
 */
export function FenetreSafari({ ordinateur, ouverte, onClose }: { ordinateur: Ordinateur; ouverte: boolean; onClose: () => void }) {
  const connect = programmeEnLigne(ordinateur.programme) && !!ordinateur.programme?.connect && (ordinateur.programme?.systeme ?? 'mac') === 'mac';
  return (
    <Dialog open={ouverte} onOpenChange={(o) => !o && onClose()}>
      <DialogContent adresse="installation-safari" className="sm:w-[min(620px,100%)]" data-fenetre-safari>
        <DialogHeader>
          <DialogTitle>{t('Beluga pour Safari')}</DialogTitle>
        </DialogHeader>
        {ouverte ? connect ? <SafariParConnect ordinateur={ordinateur} /> : <SafariALaMain ordinateur={ordinateur} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function SafariParConnect({ ordinateur }: { ordinateur: Ordinateur }) {
  const [envoi, setEnvoi] = React.useState(false);
  const p = ordinateur.programme?.safari ?? null;
  const safari = ordinateur.navigateurs.find((n) => n.genre === 'safari' && n.enLigne) ?? null;
  const lignes = etapesDeSafari(p, !!safari, false);
  const textes: Record<string, string> = { installee: t('Extension installée'), activee: t('Activée dans Safari'), reliee: t('Reliée à Beluga') };
  const enCours = p?.etat === 'en-cours';
  const installer = async () => {
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
    <div className="flex flex-col gap-4 pb-1" data-safari-par-connect>
      <p className="text-[13.5px] leading-relaxed text-text">
        {t('{v0} installe l’extension sur « {nom} », l’active dans les réglages de Safari et la relie : rien à télécharger, aucun code à taper.', { v0: CONNECT, nom: ordinateur.nom })}
      </p>
      <Encadre repere="lignes-safari" className="flex flex-col gap-0.5">
        {lignes.map((l) => (
          <LigneDEtat key={l.cle} repere={l.cle} etat={!p && !safari ? 'a-venir' : l.etat}>
            {textes[l.cle]}
          </LigneDEtat>
        ))}
      </Encadre>
      {p?.etat === 'echec' && p.message ? <p className="text-[12.5px] leading-relaxed text-muted [overflow-wrap:anywhere]">{p.message}</p> : null}
      {safari ? null : (
        <Button variant="creation" size="md" className="self-start max-sm:w-full" onClick={() => void installer()} disabled={envoi || enCours} data-assistant-installer="safari">
          {envoi || enCours ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          {enCours ? t('Installation en cours…') : p?.etat === 'echec' ? t('Réessayer') : t('Installer dans Safari')}
        </Button>
      )}
    </div>
  );
}

/** Sans Beluga Connect joignable sur ce Mac : l'application signée à télécharger, puis le code (ancien chemin). */
function SafariALaMain({ ordinateur }: { ordinateur: Ordinateur }) {
  return (
    <div className="flex flex-col gap-5 pb-1">
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-muted">{t('{v0} ne répond pas sur ce Mac : l’extension s’installe alors à la main.', { v0: CONNECT })}</p>
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
  const [choix, setChoix] = React.useState<Record<string, boolean>>({});
  if (!p) return null;
  const relie = programmeEnLigne(p) && !!p.connect;
  const enPreparation = preparation?.etat === 'en-cours';
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
  sections.push({
    cle: 'chrome',
    titre: t('Extension Chrome'),
    etat: enPreparation ? 'en-cours' : koChrome ? 'echec' : 'fait',
    resume: enPreparation ? t('Réparation…') : koChrome ? t('À réparer') : t('{n} sur {total}', { n: lignesChrome.filter((l) => l.etat === 'fait').length, total: lignesChrome.length }),
    lignes: lignesChrome,
    reparer: relie ? () => client.call({ type: 'relaisMac.preparer', ordinateurId: ordinateur.id }) : undefined,
  });
  /* SAFARI (carte « Beluga Connect : liaison sans fenêtre ») : posé par Beluga Connect après Chrome. */
  if (mac) {
    const safari = ordinateur.navigateurs.find((n) => n.genre === 'safari' && n.enLigne) ?? null;
    const lignesSafari = etapesDeSafari(p.safari ?? null, !!safari, !nav?.enLigne);
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
  const aJour = !nav || versionAuMoins(nav.version, VERSION_EXTENSION_CHROME);
  sections.push({
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
  const grille = 'grid grid-cols-[24px_minmax(0,1fr)_auto_16px] items-center gap-x-3 px-4';
  return (
    <div className="flex flex-col gap-1.5" data-etat-des-services={entete.etat}>
      <div className="flex flex-col gap-1 rounded-xl bg-fond-survol px-4 py-3" data-entete-des-services>
        <p className="text-[14px] font-semibold text-text">{p.connect ? `${CONNECT} ${p.connect}` : CONNECT}</p>
        <p className={cn('flex items-center gap-2 text-[12.5px]', entete.etat === 'echec' ? 'text-danger' : 'text-muted')}>
          <span className={cn('size-2 shrink-0 rounded-full', entete.etat === 'fait' ? 'bg-coche' : entete.etat === 'echec' ? 'bg-danger' : '')} style={entete.etat === 'en-cours' ? { backgroundColor: ORANGE } : undefined} aria-hidden />
          {entete.texte}
        </p>
      </div>
      {sections.map((s) => {
        const ouverte = choix[s.cle] ?? (s.etat === 'echec' || s.etat === 'en-cours');
        return (
          <section key={s.cle} className="flex flex-col gap-0.5" data-section-de-service={s.cle} data-etat={s.etat} data-ouverte={ouverte ? '' : undefined}>
            <button
              type="button"
              className={cn(grille, 'relative min-h-12 overflow-hidden py-2 text-left', ouverte ? 'rounded-t-xl bg-fond-survol' : 'rounded-xl bg-raised hover:bg-fond-survol')}
              onClick={() => setChoix((c) => ({ ...c, [s.cle]: !ouverte }))}
              aria-expanded={ouverte}
            >
              {s.etat === 'echec' ? <span className="absolute inset-y-0 left-0 w-[3px] bg-danger" aria-hidden /> : null}
              <RondDeService etat={s.etat} />
              <span className="min-w-0 truncate text-[14px] font-semibold text-text">{s.titre}</span>
              <span className={cn('shrink-0 text-right text-[12.5px]', s.etat === 'echec' ? 'text-danger' : 'text-muted')} style={s.etat === 'en-cours' ? { color: ORANGE } : undefined}>
                {s.resume}
              </span>
              {ouverte ? <ChevronUp className="size-4 text-muted" aria-hidden /> : <ChevronDown className="size-4 text-muted" aria-hidden />}
            </button>
            {ouverte ? (
              <div className="flex flex-col gap-1 rounded-b-xl bg-raised py-3 pl-4 pr-[44px] sm:pl-[52px]" data-panneau-de-service>
                {/* Pendant une réparation, le détail des étapes se lit plus bas, sous « Navigateurs » (une seule fois). */}
                {s.cle === 'chrome' && enPreparation ? (
                  <p className="text-[13px] leading-relaxed text-muted">{t('Beluga Connect répare Chrome : les étapes se cochent sous « Navigateurs ».')}</p>
                ) : (
                  s.lignes.map((l) => (
                    <div key={l.cle} className="flex min-h-7 items-center gap-2.5" data-ligne-de-service={l.cle} data-etat={l.etat}>
                      <RondDeService etat={l.etat} petit />
                      <span className={cn('min-w-0 flex-1 truncate text-[13.5px]', l.etat === 'neutre' ? 'text-muted' : 'text-text')}>{l.libelle}</span>
                      <span className={cn('shrink-0 text-[12.5px]', l.etat === 'echec' ? 'text-danger' : 'text-muted')}>{l.valeur}</span>
                    </div>
                  ))
                )}
                {s.etat === 'echec' && preparation?.etat === 'echec' && s.cle === 'chrome' && preparation.message ? (
                  <p className="text-[12.5px] leading-relaxed text-muted [overflow-wrap:anywhere]">{preparation.message}</p>
                ) : null}
                {s.etat === 'echec' && s.conseil ? <p className="text-[12.5px] leading-relaxed text-muted">{s.conseil}</p> : null}
                {s.etat === 'echec' && s.reparer ? (
                  <div className="flex flex-wrap items-center gap-3 pt-2">
                    <Button variant="creation" size="md" className="max-sm:w-full" onClick={() => void reparer(s)} disabled={!!envoi} data-reparer-service={s.cle}>
                      {envoi === s.cle ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
                      {t('Réparer')}
                    </Button>
                    <span className="text-[12.5px] text-muted">{t('Se suit ici et sur l’ordinateur.')}</span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
