import * as React from 'react';
import { Check, Copy, Download, Loader2, RefreshCw } from '@/components/ui/icones';
import {
  LIBELLE_DU_NAVIGATEUR,
  VERSION_EXTENSION_CHROME,
  autorisationsDonnees,
  codeDeLiaisonLisible,
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

/**
 * « CONNECTER CET ORDINATEUR » — carte « Beluga Connect : installation simplifiée » (21/11/2026), qui remplace
 * l'assistant en fenêtre de la carte « Liaison de l'extension Chrome simplifiée » (20/11/2026).
 *
 * UN SEUL BOUTON, UN PARCOURS EN DIRECT déplié dans la page, sans fenêtre ni « Continuer » : le clic télécharge
 * Beluga Connect pour le système de CET appareil (Mac, Windows ; sous Linux, une commande à coller), puis chaque étape
 * SE COCHE D'ELLE-MÊME d'après l'état poussé par le démon — Beluga Connect ouvert et relié, autorisations de macOS
 * (Mac seulement), Chrome prêt (extension posée et reliée par Beluga Connect). Plus aucune installation manuelle de
 * l'extension : Beluga Connect la pose ; seul un échec montre les gestes de secours.
 *
 * Le dessin reste celui validé par l'utilisateur (#2327e…#c86288) : liste verticale, rail, pastilles, coche VERTE
 * (`bg-coche`), étape en cours dépliée, étapes faites repliées sur leur phrase verte.
 *
 * L'ORDINATEUR VISÉ se reconnaît tout seul (`ordinateurReconnu`, shared/src/connecter-un-ordinateur.ts) : celui du
 * navigateur courant (l'extension 1.0.14 pose son identifiant d'appareil sur la page), sinon celui dont Beluga Connect
 * s'est relié après le code émis au clic. Aucun nom à donner : la liaison nomme l'ordinateur d'après la machine.
 *
 * LA LIAISON SANS CODE À TAPER : sous Windows et Linux, le fichier téléchargé porte l'adresse et le code (remorque) ;
 * sur Mac (archive signée, intouchable), la page ouvre `beluga-connect://relier?…` quand on revient sur elle après
 * avoir ouvert l'application, ou d'un clic sur « Relier ».
 */

type Cle = 'telecharger' | 'ouvrir' | 'autorisations' | 'navigateur';
/** Les noms propres : les mêmes dans toutes les langues. */
const CONNECT = ['Beluga', 'Connect'].join(' ');

/** Ce que l'appareil courant dit de lui (Mac, Windows, Linux ; `null` : téléphone, tablette). */
export function systemeDeCetAppareil(): SystemeDOrdinateur | null {
  if (typeof navigator === 'undefined') return null;
  const ua = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return systemeDeLAppareil({ userAgent: navigator.userAgent, platform: navigator.platform, plateformeUA: ua?.platform ?? null });
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

/** L'adresse du paquet de Beluga Connect pour un système, personnalisée par le code (remorque, Windows / Linux). */
function adresseDuPaquet(systeme: SystemeDOrdinateur, code: string | null): string {
  if (systeme === 'mac') return '/api/connect/Beluga-Connect.zip';
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

function lienDeLiaison(code: string): string {
  return `beluga-connect://relier?base=${encodeURIComponent(window.location.origin)}&code=${code}`;
}

/** Ouvrir le lien `beluga-connect://` sans quitter la page (un cadre invisible : la page ne se décharge pas). */
function ouvrirLeLien(code: string) {
  const cadre = document.createElement('iframe');
  cadre.style.display = 'none';
  cadre.src = lienDeLiaison(code);
  document.body.appendChild(cadre);
  window.setTimeout(() => cadre.remove(), 3_000);
}

function copier(texte: string, message: string) {
  void navigator.clipboard?.writeText(texte).then(() => client.pushToast('success', message));
}

/* ------------------------------------------------------------------ */
/* Le parcours                                                          */
/* ------------------------------------------------------------------ */

export interface DepartDuParcours {
  /** Change à chaque clic sur « Connecter cet ordinateur » : un nouveau départ. */
  n: number;
  /** `telecharger` : le clic de la page ; `relier` : arrivée depuis Beluga Connect (`?connecter=1`), lien seul. */
  mode: 'telecharger' | 'relier' | 'attendre';
}

export function ParcoursDeConnexion({
  etat,
  depart,
  onFermer,
  surFini,
  integre,
}: {
  etat: EtatDeLExtension;
  depart: DepartDuParcours;
  /** « Fermer » sous le parcours fini ; absent (mise en route) : rien. */
  onFermer?: () => void;
  surFini?: (fini: boolean) => void;
  /** Monté dans la mise en route : le téléchargement a son propre bouton dans la première étape. */
  integre?: boolean;
}) {
  const systemeAppareil = React.useMemo(systemeDeCetAppareil, []);
  const navigateurId = useNavigateurCourant();
  const [code, setCode] = React.useState<{ code: string; emisLe: number; expireLe: number } | null>(null);
  const [telechargeLe, setTelechargeLe] = React.useState<number | null>(null);
  const [cibleId, setCibleId] = React.useState<string | null>(null);
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
      if (!systemeAppareil || mode === 'attendre') return;
      setEnvoi(true);
      try {
        const c = await emettre(deja?.id ?? null);
        if (mode === 'relier') {
          ouvrirLeLien(c.code);
          return;
        }
        if (systemeAppareil === 'linux') copier(commandeLinux(c.code), t('Commande copiée.'));
        else telechargerLeFichier(adresseDuPaquet(systemeAppareil, c.code), systemeAppareil === 'mac' ? 'Beluga-Connect.zip' : 'Beluga-Connect.exe');
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

  /* Le code expire avant la liaison : un code neuf, tout seul (Mac : pour le lien ; Linux : la commande change). */
  React.useEffect(() => {
    if (!code || relie) return;
    const minuteur = window.setTimeout(() => void emettre(cibleId).catch(() => undefined), Math.max(1_000, code.expireLe - Date.now() + 500));
    return () => window.clearTimeout(minuteur);
  }, [code, relie, cibleId, emettre]);

  /* MAC : on revient sur la page après avoir ouvert Beluga Connect → le lien de liaison part tout seul. */
  React.useEffect(() => {
    if (!mac || !code || relie || !telechargeLe) return;
    let dernier = 0;
    const auRetour = () => {
      if (document.visibilityState !== 'visible' || Date.now() - dernier < 8_000) return;
      dernier = Date.now();
      ouvrirLeLien(code.code);
    };
    window.addEventListener('focus', auRetour);
    document.addEventListener('visibilitychange', auRetour);
    return () => {
      window.removeEventListener('focus', auRetour);
      document.removeEventListener('visibilitychange', auRetour);
    };
  }, [mac, code, relie, telechargeLe]);

  const etapes: Cle[] = mac ? ['telecharger', 'ouvrir', 'autorisations', 'navigateur'] : ['telecharger', 'ouvrir', 'navigateur'];
  const faite: Record<Cle, boolean> = {
    telecharger: !!telechargeLe || relie,
    ouvrir: relie,
    autorisations: relie && autorisationsDonnees(programme),
    navigateur: !!nav?.enLigne && versionAuMoins(nav.version, VERSION_EXTENSION_CHROME) && (!mac || nav.incognito === true),
  };
  const toutFait = etapes.every((e) => faite[e]);
  const courante = etapes.find((e) => !faite[e]) ?? null;
  React.useEffect(() => {
    surFini?.(toutFait);
  }, [toutFait, surFini]);

  const nomVise = cible?.nom ?? t('cet ordinateur');
  const titreDe = (e: Cle, fait: boolean): string => {
    switch (e) {
      case 'telecharger':
        return fait ? t('{v0} téléchargé', { v0: CONNECT }) : t('Télécharger {v0}', { v0: CONNECT });
      case 'ouvrir':
        return fait ? t('{v0} relié', { v0: CONNECT }) : t('Ouvrir {v0}', { v0: CONNECT });
      case 'autorisations':
        return t('Autoriser {v0} sur le Mac', { v0: CONNECT });
      case 'navigateur':
        return t('Chrome prêt');
    }
  };
  const reussiteDe = (e: Cle): string => {
    switch (e) {
      case 'telecharger':
        return systeme === 'linux' ? t('Commande copiée.') : t('Le fichier est dans vos téléchargements.');
      case 'ouvrir':
        return t('« {nom} » est relié à Beluga.', { nom: nomVise });
      case 'autorisations':
        return t('Les deux autorisations sont données.');
      case 'navigateur':
        return mac ? t('Extension installée, reliée et autorisée en navigation privée.') : t('Extension installée et reliée.');
    }
  };
  const aVenirDe = (e: Cle): string => {
    switch (e) {
      case 'telecharger':
        return t('La petite application qui fait tout le reste.');
      case 'ouvrir':
        return t('Elle se relie toute seule, sans code à taper.');
      case 'autorisations':
        return t('Deux interrupteurs, une seule fois.');
      case 'navigateur':
        return t('Fait tout seul par {v0}.', { v0: CONNECT });
    }
  };

  const contenuDe = (e: Cle): React.ReactNode => {
    switch (e) {
      case 'telecharger':
        return <EtapeTelecharger systeme={systemeAppareil} envoi={envoi} onTelecharger={() => void departe('telecharger')} />;
      case 'ouvrir':
        return (
          <EtapeOuvrir
            systeme={systeme ?? 'mac'}
            code={code}
            programmeAncien={programmeEnLigne(programme) && !programme?.connect}
            onRelier={() => code && ouvrirLeLien(code.code)}
            onRetelecharger={() => void departe('telecharger')}
          />
        );
      case 'autorisations':
        return <EtapeAutorisations ordinateur={cible} />;
      case 'navigateur':
        return <EtapeChrome ordinateur={cible} nav={nav} mac={mac} />;
    }
  };

  return (
    <div className="flex flex-col gap-5" data-parcours-connexion={toutFait ? 'fini' : courante ?? ''} data-systeme={systeme ?? 'aucun'} data-ordinateur-vise={cible?.id ?? ''}>
      {toutFait ? (
        <div className="flex items-start gap-4 rounded-2xl bg-coche/15 px-5 py-4" data-assistant-tout-pret>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-coche text-white">
            <Check className="size-5" strokeWidth={3} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15.5px] font-semibold text-text">{t('Tout est prêt sur « {nom} »', { nom: nomVise })}</p>
            <p className="mt-0.5 text-[13.5px] leading-relaxed text-muted">
              {t('Les agents de Beluga peuvent travailler dans Chrome sur cet ordinateur. Les mises à jour se feront toutes seules.')}
            </p>
          </div>
        </div>
      ) : null}
      <ol className="flex flex-col" data-parcours-installation>
        {etapes.map((e, i) => {
          const fait = faite[e];
          const ouverte = !toutFait && e === courante;
          const statut = fait ? 'faite' : ouverte ? 'en-cours' : 'a-venir';
          return (
            <li key={e} className="flex gap-4" data-etape-connexion={e} data-etat={statut}>
              <div className="flex flex-col items-center">
                <RondDeLEtape statut={statut} numero={i + 1} />
                {i < etapes.length - 1 ? <span className={cn('my-1.5 w-[2px] flex-1 rounded-full', fait ? 'bg-coche' : 'bg-faint/35')} aria-hidden /> : null}
              </div>
              <div className={cn('min-w-0 flex-1', i < etapes.length - 1 ? 'pb-5' : 'pb-1')}>
                <h4 className={cn('pt-[3px] text-[15px] font-semibold leading-snug', statut === 'a-venir' ? 'text-muted' : 'text-text')}>{titreDe(e, fait)}</h4>
                <p className={cn('mt-0.5 text-[13.5px] leading-relaxed', fait ? 'text-coche' : 'text-muted')}>{fait ? reussiteDe(e) : aVenirDe(e)}</p>
                {ouverte ? <div className="mt-4">{contenuDe(e)}</div> : null}
              </div>
            </li>
          );
        })}
      </ol>
      {toutFait && onFermer && !integre ? (
        <div className="flex justify-end">
          <Button variant="subtle" size="md" className="max-sm:w-full" onClick={onFermer} data-parcours-fermer>
            {t('Fermer')}
          </Button>
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

function RondDeLEtape({ statut, numero }: { statut: 'faite' | 'en-cours' | 'a-venir'; numero: number }) {
  if (statut === 'faite') {
    return (
      <span className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-coche text-white" data-rond="fait">
        <Check className="size-3.5" strokeWidth={3} />
      </span>
    );
  }
  return (
    <span
      className={cn(
        'flex size-[26px] shrink-0 items-center justify-center rounded-full text-[12.5px] font-semibold',
        statut === 'en-cours' ? 'text-text ring-2 ring-inset ring-text' : 'bg-raised text-faint',
      )}
      data-rond={statut}
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

/** Beluga attend quelque chose qui se passe ailleurs : un point orange qui respire, et la promesse de se cocher seul. */
function EnAttente({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 flex items-center gap-2.5 text-[13px] text-muted" data-en-attente>
      <span className="relative flex h-2 w-2 shrink-0">
        {/* L'orange des réponses attendues : c'est à la personne (ou à son ordinateur) de faire le geste. */}
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ backgroundColor: 'hsl(var(--cadre-question))' }} />
        <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: 'hsl(var(--cadre-question))' }} />
      </span>
      {children}
    </p>
  );
}

/** Une ligne d'état cochable : verte faite, rouet en cours, rond vide à venir. */
function LigneDEtat({ etat, children, repere, droite }: { etat: 'fait' | 'en-cours' | 'a-venir'; children: React.ReactNode; repere: string; droite?: React.ReactNode }) {
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-3 py-1" data-ligne-etat={repere} data-etat={etat}>
      {etat === 'fait' ? (
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-coche text-white">
          <Check className="size-3" strokeWidth={3} />
        </span>
      ) : etat === 'en-cours' ? (
        <Loader2 className="size-5 shrink-0 animate-spin text-muted" />
      ) : (
        <span className="size-5 shrink-0 rounded-full ring-[1.5px] ring-inset ring-faint" />
      )}
      <span className={cn('min-w-0 flex-1 text-[14px]', etat === 'a-venir' ? 'text-muted' : 'text-text')}>{children}</span>
      {droite}
    </div>
  );
}

function EtapesNumerotees({ etapes, repere }: { etapes: React.ReactNode[]; repere: string }) {
  return (
    <ol className="flex flex-col gap-2.5" data-etapes-installation={repere}>
      {etapes.map((texte, i) => (
        <li key={i} className="flex gap-3 text-[13.5px] leading-relaxed text-text">
          <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-surface text-[11.5px] font-semibold text-muted">{i + 1}</span>
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

function EtapeTelecharger({ systeme, envoi, onTelecharger }: { systeme: SystemeDOrdinateur | null; envoi: boolean; onTelecharger: () => void }) {
  if (!systeme) {
    return (
      <Encadre repere="telecharger-ailleurs">
        <p className="text-[13.5px] leading-relaxed text-text">{t('Ouvrez Beluga sur l’ordinateur à connecter (Mac, Windows ou Linux), puis touchez « Connecter cet ordinateur ».')}</p>
      </Encadre>
    );
  }
  return (
    <Encadre repere="telecharger" className="flex flex-wrap items-center gap-4">
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

function EtapeOuvrir({
  systeme,
  code,
  programmeAncien,
  onRelier,
  onRetelecharger,
}: {
  systeme: SystemeDOrdinateur;
  code: { code: string } | null;
  programmeAncien: boolean;
  onRelier: () => void;
  onRetelecharger: () => void;
}) {
  if (programmeAncien) {
    return <EnAttente>{t('Ce Mac a l’ancien programme « Beluga Relais » : il passe seul à {v0} dans les minutes qui viennent.', { v0: CONNECT })}</EnAttente>;
  }
  if (systeme === 'linux') {
    return (
      <div className="flex flex-col">
        <Encadre repere="commande-linux" className="flex flex-col gap-3">
          <p className="text-[13.5px] leading-relaxed text-text">{t('Collez cette commande dans un terminal : {v0} s’installe et se relie tout seul.', { v0: CONNECT })}</p>
          {code ? (
            <code className="block select-all break-all rounded-lg bg-surface px-3 py-2.5 font-mono text-[12.5px] text-text" data-commande-linux>
              {commandeLinux(code.code)}
            </code>
          ) : (
            <div className="h-10 animate-pulse rounded-lg bg-surface" data-silhouette />
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="subtle" size="md" className="max-sm:w-full" onClick={() => code && copier(commandeLinux(code.code), t('Commande copiée.'))} disabled={!code} data-copier-commande>
              <Copy className="h-3.5 w-3.5" />
              {t('Copier la commande')}
            </Button>
          </div>
        </Encadre>
        <EnAttente>{t('Beluga attend {v0}… l’étape se cochera d’elle-même.', { v0: CONNECT })}</EnAttente>
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      <Encadre repere={`ouvrir-${systeme}`} className="flex flex-col gap-3">
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
          <EtapesNumerotees
            repere="mac"
            etapes={[
              t('Ouvrez le fichier téléchargé : {v0} se range dans vos applications.', { v0: CONNECT }),
              t('Ouvrez {v0}, puis revenez sur cette page.', { v0: CONNECT }),
              t('Chrome demande une seule fois d’ouvrir l’application : choisissez « Ouvrir {v0} ».', { v0: CONNECT }),
            ]}
          />
        )}
      </Encadre>
      <EnAttente>{t('Beluga attend {v0}… l’étape se cochera d’elle-même.', { v0: CONNECT })}</EnAttente>
      <div className="mt-3 flex flex-wrap gap-2">
        {systeme === 'mac' ? (
          <Button variant="subtle" size="md" className="max-sm:w-full" onClick={onRelier} disabled={!code} data-relier-maintenant>
            {t('Relier maintenant')}
          </Button>
        ) : null}
        <Button variant="ghost" size="md" className="max-sm:w-full" onClick={onRetelecharger} data-retelecharger>
          <Download className="h-3.5 w-3.5" />
          {t('Télécharger de nouveau')}
        </Button>
      </div>
    </div>
  );
}

function EtapeAutorisations({ ordinateur }: { ordinateur: Ordinateur | null }) {
  const [ouverture, setOuverture] = React.useState<string | null>(null);
  const a = ordinateur?.programme?.autorisations ?? null;
  const lignes: { cle: 'accessibilite' | 'ecran'; titre: string }[] = [
    { cle: 'accessibilite', titre: t('Contrôler le Mac') },
    { cle: 'ecran', titre: t('Voir l’écran') },
  ];
  const premiere = lignes.find((l) => a?.[l.cle] !== true)?.cle ?? null;
  const rouvrir = async (reglage: 'accessibilite' | 'ecran') => {
    if (!ordinateur) return;
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
  return (
    <div className="flex flex-col">
      <Encadre repere="autorisations" className="flex flex-col gap-1.5">
        {lignes.map((l) => {
          const accorde = a?.[l.cle] === true;
          return (
            <LigneDEtat
              key={l.cle}
              repere={l.cle}
              etat={accorde ? 'fait' : 'a-venir'}
              droite={
                !accorde && l.cle === premiere ? (
                  <Button variant="default" size="md" className="max-sm:basis-full" onClick={() => void rouvrir(l.cle)} disabled={!!ouverture} data-rouvrir-reglage={l.cle}>
                    {ouverture === l.cle ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    {t('Ouvrir le réglage')}
                  </Button>
                ) : null
              }
            >
              <span className="text-text">{l.titre}</span>
              <span className="text-muted"> — </span>
              <span className={accorde ? 'text-coche' : 'text-muted'}>{accorde ? t('accordé') : t('pas encore')}</span>
            </LigneDEtat>
          );
        })}
      </Encadre>
      <EnAttente>{t('Beluga attend votre accord… l’étape se cochera d’elle-même.')}</EnAttente>
    </div>
  );
}

/** Le dossier fixe de l'extension, par système (affiché seulement si l'ajout à Chrome a échoué). */
const DOSSIER_PAR_DEFAUT: Record<SystemeDOrdinateur, string> = {
  mac: '~/Library/Application Support/Beluga/extension-chrome',
  windows: '%LOCALAPPDATA%\\Beluga\\extension-chrome',
  linux: '~/.local/share/beluga/extension-chrome',
};

function EtapeChrome({ ordinateur, nav, mac }: { ordinateur: Ordinateur | null; nav: NavigateurDOrdinateur | null; mac: boolean }) {
  const [envoi, setEnvoi] = React.useState<string | null>(null);
  const preparation = ordinateur?.programme?.preparation ?? null;
  const systeme = ordinateur?.programme?.systeme ?? (mac ? 'mac' : 'windows');
  const echec = preparation?.etat === 'echec';
  const sousEtats = {
    ajoutee: !!nav || preparation?.ajoutee === true,
    reliee: !!nav?.enLigne,
    prive: nav?.incognito === true,
  };
  const ordre: { cle: keyof typeof sousEtats; titre: string; enCours: string }[] = [
    { cle: 'ajoutee', titre: t('Extension ajoutée à Chrome'), enCours: t('Ajout de l’extension à Chrome…') },
    { cle: 'reliee', titre: t('Extension reliée à Beluga'), enCours: t('Liaison de l’extension…') },
    ...(mac ? [{ cle: 'prive' as const, titre: t('Autorisée en navigation privée'), enCours: t('Autorisation en navigation privée…') }] : []),
  ];
  const premiereManquante = ordre.find((o) => !sousEtats[o.cle])?.cle ?? null;
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
    <div className="flex flex-col">
      <Encadre repere="chrome" className="flex flex-col gap-1.5">
        {ordre.map((o) => (
          <LigneDEtat key={o.cle} repere={o.cle} etat={sousEtats[o.cle] ? 'fait' : o.cle === premiereManquante && !echec ? 'en-cours' : 'a-venir'}>
            {sousEtats[o.cle] || o.cle !== premiereManquante || echec ? o.titre : o.enCours}
          </LigneDEtat>
        ))}
      </Encadre>
      {echec ? (
        <div className="mt-4 flex flex-col gap-3" data-assistant-secours>
          <p className="text-[13.5px] leading-relaxed text-text">{t('{v0} n’a pas pu tout faire seul. Trois clics suffisent :', { v0: CONNECT })}</p>
          {!sousEtats.ajoutee ? (
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
          ) : !sousEtats.prive && nav && mac ? (
            <Button variant="subtle" size="md" className="self-start max-sm:w-full" onClick={() => void ouvrirLaPage()} disabled={!!envoi} data-assistant-ouvrir-page-extension>
              {envoi === 'page' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {t('Ouvrir la page de l’extension')}
            </Button>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {!sousEtats.ajoutee ? (
              <Button variant="subtle" size="md" className="max-sm:w-full" onClick={() => copier(dossier, t('Chemin copié.'))} data-assistant-copier-chemin>
                <Copy className="h-3.5 w-3.5" />
                {t('Copier le chemin')}
              </Button>
            ) : null}
            <Button variant="subtle" size="md" className="max-sm:w-full" onClick={() => void reessayer()} disabled={!!envoi} data-assistant-reessayer>
              {envoi === 'preparer' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {t('Réessayer')}
            </Button>
          </div>
        </div>
      ) : (
        <EnAttente>{t('Laissez Chrome ouvert… l’étape se cochera d’elle-même.')}</EnAttente>
      )}
    </div>
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
