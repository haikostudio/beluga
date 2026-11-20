import * as React from 'react';
import { Check, Copy, Download, Loader2, RefreshCw } from '@/components/ui/icones';
import {
  LIBELLE_DU_NAVIGATEUR,
  VERSION_EXTENSION_CHROME,
  autorisationsDonnees,
  codeDeLiaisonLisible,
  programmeEnLigne,
  versionAuMoins,
  type EtatDeLExtension,
  type GenreDeNavigateur,
  type NavigateurDOrdinateur,
  type Ordinateur,
} from '@beluga/shared';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Label, ListeDeroulante } from '@/components/ui';
import { client } from '@/lib/client';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * L'ASSISTANT D'INSTALLATION D'UN ORDINATEUR — carte « Liaison de l'extension Chrome simplifiée » (20/11/2026),
 * d'après les six écrans validés par l'utilisateur (#2327e, #6231, #5f2d2, #b11e, #7a15d, #c86288).
 *
 * UNE LISTE VERTICALE, de haut en bas : un rail à gauche, une pastille par étape — VERTE cochée quand elle est faite
 * (exception assumée au monochrome, décision de l'utilisateur), anneau pour l'étape en cours, grise numérotée à venir.
 * L'étape en cours est dépliée, les faites se replient sur leur phrase de réussite en vert. Rien à « vérifier » :
 * chaque étape SE COCHE D'ELLE-MÊME d'après l'état poussé par le démon, et le parcours avance seul d'un cran.
 *
 * Sur un Mac avec Chrome, quatre gestes : nommer l'ordinateur, « Installer sur ce Mac » (Beluga Connect), « Relier ce
 * Mac » (lien `beluga-connect://relier`, sans code), deux interrupteurs d'Apple ; Beluga Connect prépare ensuite Chrome
 * tout seul (extension ajoutée, reliée, autorisée en navigation privée). Ailleurs (PC, ou Safari) : l'extension en trois
 * gestes, puis le code de liaison — affiché d'office, renouvelé à son échéance, remplacé par « Relié avec succès ».
 *
 * Le MÊME parcours sert la page « Extension » des réglages (`AssistantDInstallation`, une fenêtre) et l'étape « Votre
 * ordinateur » de la mise en route (`ParcoursDInstallation integre`, sans fenêtre).
 */

type Cle = 'ordinateur' | 'connect' | 'relier' | 'autorisations' | 'chrome' | 'extension' | 'liaison';
const NOUVEL_ORDINATEUR = '__nouveau__';
/** Les noms propres : les mêmes dans toutes les langues. */
const CONNECT = ['Beluga', 'Connect'].join(' ');
const DOSSIER_DE_L_EXTENSION = '~/Library/Application Support/Beluga/extension-chrome';
/** Les étapes qui, faites d'elles-mêmes, font avancer le parcours d'un cran. */
const AVANCENT_SEULES: Cle[] = ['connect', 'relier', 'autorisations', 'chrome', 'liaison'];

export interface OuvertureDeLAssistant {
  /** Absent : le premier ordinateur ; `null` : un nouvel ordinateur, à nommer. */
  ordinateurId?: string | null;
  navigateur?: GenreDeNavigateur;
}

function cetAppareilEstUnMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);
}

/** L'ordinateur visé est-il un Mac ? Safari, un programme déjà là, son nom, ou l'appareil d'où l'on installe. */
function estUnMac(o: Ordinateur | null, navigateur: GenreDeNavigateur, nomNouveau: string): boolean {
  if (navigateur === 'safari' || o?.programme) return true;
  if (o?.navigateurs.some((n) => n.genre === 'safari')) return true;
  if (/mac|imac/i.test(o?.nom ?? nomNouveau)) return true;
  return cetAppareilEstUnMac();
}

/* ------------------------------------------------------------------ */
/* Le parcours                                                          */
/* ------------------------------------------------------------------ */

interface ProprietesDuParcours {
  ouverture: OuvertureDeLAssistant;
  etat: EtatDeLExtension | null;
  relire: () => Promise<void>;
  /** « Terminer » (ou fermer la fenêtre). */
  onTerminer: () => void;
  /** « Plus tard » à la première étape ; absent : « Annuler » ferme. */
  onPlusTard?: () => void;
  /** Le parcours est-il entièrement fait ? (La mise en route en fait sa condition de validation.) */
  surFini?: (fini: boolean) => void;
  /** Monté dans une carte de question (mise en route) : ni « Plus tard » ni « Terminer », ceux de la carte servent. */
  integre?: boolean;
}

function useParcours({ ouverture, etat, relire, onTerminer, onPlusTard, surFini, integre }: ProprietesDuParcours) {
  const [rang, setRang] = React.useState(0);
  const [choix, setChoix] = React.useState<string>(NOUVEL_ORDINATEUR);
  const [nom, setNom] = React.useState('');
  const [navigateur, setNavigateur] = React.useState<GenreDeNavigateur>('chrome');
  const [envoi, setEnvoi] = React.useState(false);
  const [telecharge, setTelecharge] = React.useState(false);

  const ordinateurs = etat?.ordinateurs ?? [];
  const ordinateur = ordinateurs.find((o) => o.id === choix) ?? null;
  const safariDisponible = !!etat?.safari.disponible;

  /* À chaque ouverture : l'ordinateur et le navigateur demandés, sinon le premier ordinateur et Chrome. */
  React.useEffect(() => {
    const id = ouverture.ordinateurId === null ? NOUVEL_ORDINATEUR : (ouverture.ordinateurId ?? ordinateurs[0]?.id ?? NOUVEL_ORDINATEUR);
    setRang(0);
    setChoix(id);
    setNom(ordinateurs.find((o) => o.id === id)?.nom ?? (cetAppareilEstUnMac() ? 'Mac' : ''));
    setNavigateur(ouverture.navigateur === 'safari' && safariDisponible ? 'safari' : 'chrome');
    setTelecharge(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouverture]);

  const mac = estUnMac(ordinateur, navigateur, nom);
  const parConnect = mac && navigateur === 'chrome';
  const etapes: Cle[] = parConnect ? ['ordinateur', 'connect', 'relier', 'autorisations', 'chrome'] : ['ordinateur', 'extension', 'liaison'];

  const programme = ordinateur?.programme ?? null;
  const nav: NavigateurDOrdinateur | null =
    ordinateur?.navigateurs.filter((n) => n.genre === navigateur).sort((a, b) => Number(b.enLigne) - Number(a.enLigne) || (b.vuLe ?? 0) - (a.vuLe ?? 0))[0] ?? null;
  const navigateurRelie = !!nav?.enLigne;
  const preparation = programme?.preparation ?? null;
  const sousEtats = {
    ajoutee: !!nav || preparation?.ajoutee === true,
    reliee: navigateurRelie,
    prive: nav?.incognito === true,
  };

  const faite: Record<Cle, boolean> = {
    ordinateur: rang > 0,
    connect: !!programme?.connect,
    relier: programmeEnLigne(programme),
    autorisations: autorisationsDonnees(programme),
    chrome: navigateurRelie && versionAuMoins(nav?.version, VERSION_EXTENSION_CHROME) && nav?.incognito === true,
    extension: rang > 1 || navigateurRelie,
    liaison: navigateurRelie,
  };
  /* Une étape qu'on peut dépasser sans qu'elle soit cochée : le téléchargement de Beluga Connect est fait, l'extension
     posée à la main (rien ne le dit au démon avant la liaison). */
  const franchissable: Record<Cle, boolean> = { ...faite, connect: faite.connect || telecharge || programmeEnLigne(programme), extension: true };
  const toutFait = rang > 0 && etapes.every((e) => faite[e]);
  const courante = etapes[Math.min(rang, etapes.length - 1)]!;

  React.useEffect(() => surFini?.(toutFait), [toutFait, surFini]);

  /* L'ÉTAPE COCHÉE D'ELLE-MÊME (ou déjà faite en arrivant : Mac déjà relié…) fait avancer le parcours d'un cran, un
     instant après — on voit la coche. Le minuteur ne dépend que de l'étape et de son état : un nouveau rendu
     (redimensionnement, relecture) ne l'annule pas. */
  const faiteCourante = faite[courante];
  React.useEffect(() => {
    if (!faiteCourante || rang === 0 || !AVANCENT_SEULES.includes(courante) || rang >= etapes.length - 1) return;
    const minuteur = window.setTimeout(() => setRang((r) => (r === rang ? Math.min(r + 1, etapes.length - 1) : r)), 1100);
    return () => window.clearTimeout(minuteur);
  }, [faiteCourante, rang, courante, etapes.length]);

  const continuer = async () => {
    if (courante !== 'ordinateur') {
      if (rang < etapes.length - 1) setRang(rang + 1);
      else onTerminer();
      return;
    }
    const voulu = nom.trim();
    if (!voulu) return;
    setEnvoi(true);
    try {
      if (choix === NOUVEL_ORDINATEUR) {
        const r = await client.call<{ id: string }>({ type: 'ordinateur.creer', nom: voulu });
        await relire();
        setChoix(r.id);
      } else if (ordinateur && voulu !== ordinateur.nom) {
        await client.call({ type: 'ordinateur.renommer', id: ordinateur.id, nom: voulu });
        await relire();
      }
      setRang(1);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Le geste n’a pas abouti.'));
    } finally {
      setEnvoi(false);
    }
  };

  const recommencer = () => {
    setRang(0);
    setChoix(NOUVEL_ORDINATEUR);
    setNom('');
    setTelecharge(false);
  };

  const nomVise = ordinateur?.nom ?? (nom.trim() || t('Nouvel ordinateur'));
  const nomNav = LIBELLE_DU_NAVIGATEUR[navigateur];

  const titreDe = (e: Cle, fait: boolean): string => {
    switch (e) {
      case 'ordinateur':
        return t('Ordinateur et navigateur');
      case 'connect':
        return fait ? t('{v0} installé', { v0: CONNECT }) : t('Installer {v0}', { v0: CONNECT });
      case 'relier':
        return t('Relier ce Mac');
      case 'autorisations':
        return t('Autoriser {v0} sur le Mac', { v0: CONNECT });
      case 'chrome':
        return t('Chrome prêt');
      case 'extension':
        return t('Installer l’extension dans {navigateur}', { navigateur: nomNav });
      case 'liaison':
        return t('Relier {navigateur} à Beluga', { navigateur: nomNav });
    }
  };
  /** Ce qu'on lit sous le titre : la phrase de réussite (verte) quand l'étape est faite, sinon ce qui l'attend. */
  const sousTitreDe = (e: Cle, fait: boolean): { texte: string; reussite: boolean } => {
    if (e === 'ordinateur' && rang > 0) return { texte: `« ${nomVise} » · ${nomNav}`, reussite: false };
    if (fait) {
      switch (e) {
        case 'connect':
          return { texte: t('Installé dans vos applications.'), reussite: true };
        case 'relier':
          return { texte: t('Mac relié avec succès.'), reussite: true };
        case 'autorisations':
          return { texte: t('Les deux autorisations sont données.'), reussite: true };
        case 'chrome':
          return { texte: t('Extension installée, reliée et autorisée en navigation privée.'), reussite: true };
        case 'extension':
          return { texte: t('Extension installée.'), reussite: true };
        case 'liaison':
          return { texte: t('Relié avec succès.'), reussite: true };
        default:
          break;
      }
    }
    switch (e) {
      case 'ordinateur':
        return { texte: t('Beluga a reconnu cet ordinateur. Donnez-lui le nom qui vous parle : c’est celui qu’on verra partout dans Beluga.'), reussite: false };
      case 'connect':
        return { texte: t('La petite application qui fait tout le reste.'), reussite: false };
      case 'relier':
        return { texte: t('Un clic, sans code à taper.'), reussite: false };
      case 'autorisations':
        return { texte: t('Deux interrupteurs, une seule fois.'), reussite: false };
      case 'chrome':
        return { texte: t('Fait tout seul par {v0}.', { v0: CONNECT }), reussite: false };
      case 'extension':
        return { texte: t('Trois gestes dans le navigateur.'), reussite: false };
      case 'liaison':
        return { texte: t('Un code à saisir dans l’extension.'), reussite: false };
    }
  };
  /** Le texte d'introduction de l'étape OUVERTE (plus complet que le sous-titre replié). */
  const introDe = (e: Cle): string => {
    switch (e) {
      case 'ordinateur':
        return sousTitreDe('ordinateur', false).texte;
      case 'connect':
        return t('Une petite application qui relie ce Mac à Beluga, puis installe et tient à jour tout le reste, toute seule.');
      case 'relier':
        return t('Un clic, et {v0} se relie à votre Beluga. Aucun code à taper.', { v0: CONNECT });
      case 'autorisations':
        return t('Apple demande votre accord, une seule fois. {v0} vient d’ouvrir le bon réglage : activez l’interrupteur à côté de son nom.', { v0: CONNECT });
      case 'chrome':
        return t('{v0} prépare Chrome tout seul. Laissez Chrome ouvert, il n’y a rien à cliquer.', { v0: CONNECT });
      case 'extension':
        return navigateur === 'chrome'
          ? t('L’extension s’installe sans passer par la boutique de Chrome.')
          : t('L’application est signée : elle s’ouvre sans avertissement.');
      case 'liaison':
        return t('Cliquez sur l’icône Beluga dans {navigateur}, puis saisissez ce code.', { navigateur: nomNav });
    }
  };

  const contenuDe = (e: Cle): React.ReactNode => {
    switch (e) {
      case 'ordinateur':
        return (
          <EtapeOrdinateur
            ordinateurs={ordinateurs}
            choix={choix}
            setChoix={(v) => {
              setChoix(v);
              setNom(ordinateurs.find((o) => o.id === v)?.nom ?? '');
            }}
            nom={nom}
            setNom={setNom}
            mac={mac}
            navigateur={navigateur}
            setNavigateur={setNavigateur}
            safariDisponible={safariDisponible}
          />
        );
      case 'connect':
        return <EtapeConnect programme={programme} telecharge={telecharge} surTelechargement={() => setTelecharge(true)} />;
      case 'relier':
        return <EtapeRelier ordinateur={ordinateur} fait={faite.relier} />;
      case 'autorisations':
        return <EtapeAutorisations ordinateur={ordinateur} />;
      case 'chrome':
        return <EtapeChrome ordinateur={ordinateur} nav={nav} sousEtats={sousEtats} fait={faite.chrome} />;
      case 'extension':
        return <EtapeExtension navigateur={navigateur} />;
      case 'liaison':
        return <EtapeLiaison ordinateur={ordinateur} navigateur={navigateur} />;
    }
  };

  const corps = (
    <div className="flex flex-col gap-6 pb-1 pt-2" data-assistant-installation={toutFait ? 'fini' : courante} data-parcours={parConnect ? 'connect' : 'code'}>
      {toutFait ? (
        <div className="flex items-start gap-4 rounded-2xl bg-coche/15 px-5 py-4" data-assistant-tout-pret>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-coche text-white">
            <Check className="size-5" strokeWidth={3} />
          </span>
          <div className="min-w-0">
            <p className="text-[15.5px] font-semibold text-text">{t('Tout est prêt sur « {nom} »', { nom: nomVise })}</p>
            <p className="mt-0.5 text-[13.5px] leading-relaxed text-muted">
              {parConnect
                ? t('Les agents de Beluga peuvent travailler dans Chrome et sur l’iPhone. Les mises à jour se feront toutes seules.')
                : t('Les agents de Beluga peuvent travailler dans {navigateur}.', { navigateur: nomNav })}
            </p>
          </div>
        </div>
      ) : null}
      <ol className="flex flex-col" data-parcours-installation>
        {etapes.map((e, i) => {
          const fait = faite[e] && (e !== 'ordinateur' || rang > 0);
          const ouverte = !toutFait && i === rang;
          const statut = fait ? 'faite' : ouverte ? 'en-cours' : 'a-venir';
          const sous = sousTitreDe(e, fait);
          return (
            <li key={e} className="flex gap-4" data-etape-assistant={e} data-etat={statut} data-faite={fait ? 'oui' : 'non'}>
              <div className="flex flex-col items-center">
                <RondDeLEtape statut={statut} numero={i + 1} />
                {i < etapes.length - 1 ? <span className={cn('my-1.5 w-[2px] flex-1 rounded-full', fait ? 'bg-coche' : 'bg-faint/35')} aria-hidden /> : null}
              </div>
              <div className={cn('min-w-0 flex-1', i < etapes.length - 1 ? 'pb-5' : 'pb-1')}>
                <h3 className={cn('pt-[3px] text-[15px] font-semibold leading-snug', statut === 'a-venir' ? 'text-muted' : 'text-text')}>{titreDe(e, fait)}</h3>
                {ouverte && !fait ? (
                  <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{introDe(e)}</p>
                ) : (
                  <p className={cn('mt-0.5 text-[13.5px] leading-relaxed', sous.reussite ? 'text-coche' : 'text-muted')}>{sous.texte}</p>
                )}
                {ouverte ? <div className="mt-4">{contenuDe(e)}</div> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );

  const derniere = rang >= etapes.length - 1;
  const pied = toutFait ? (
    <>
      <Button variant="subtle" size="md" onClick={recommencer} data-assistant-autre-ordinateur>
        {t('Installer un autre ordinateur')}
      </Button>
      <span className="flex-1" />
      {integre ? null : (
        <Button variant="default" size="md" onClick={onTerminer} data-assistant-terminer>
          {t('Terminer')}
        </Button>
      )}
    </>
  ) : (
    <>
      {rang === 0 ? (
        integre ? null : (
        <Button variant="subtle" size="md" onClick={onPlusTard ?? onTerminer} data-assistant-plus-tard>
          {onPlusTard ? t('Plus tard') : t('Annuler')}
        </Button>
        )
      ) : (
        <Button variant="subtle" size="md" onClick={() => setRang(rang - 1)} data-assistant-retour>
          {t('Retour')}
        </Button>
      )}
      <span className="flex-1" />
      {integre && derniere ? null : (
      <Button
        variant="default"
        size="md"
        onClick={() => void continuer()}
        disabled={envoi || (courante === 'ordinateur' ? !nom.trim() : !franchissable[courante])}
        title={courante !== 'ordinateur' && !franchissable[courante] ? t('Beluga attend que cette étape soit faite sur « {nom} ».', { nom: nomVise }) : undefined}
        data-assistant-continuer
      >
        {envoi ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {derniere ? t('Terminer') : t('Continuer')}
      </Button>
      )}
    </>
  );

  return { corps, pied };
}

/** LA FENÊTRE de la page « Extension » des réglages. */
export function AssistantDInstallation({
  ouverture,
  etat,
  onClose,
  relire,
}: {
  ouverture: OuvertureDeLAssistant | null;
  etat: EtatDeLExtension | null;
  onClose: () => void;
  relire: () => Promise<void>;
}) {
  return (
    <Dialog open={!!ouverture} onOpenChange={(o) => !o && onClose()}>
      {ouverture ? <FenetreDuParcours ouverture={ouverture} etat={etat} relire={relire} onClose={onClose} /> : null}
    </Dialog>
  );
}

function FenetreDuParcours({ ouverture, etat, relire, onClose }: { ouverture: OuvertureDeLAssistant; etat: EtatDeLExtension | null; relire: () => Promise<void>; onClose: () => void }) {
  const { corps, pied } = useParcours({ ouverture, etat, relire, onTerminer: onClose });
  return (
    <DialogContent adresse="installation" className="sm:w-[min(780px,100%)]">
      <DialogHeader>
        <DialogTitle>{t('Installer Beluga sur un ordinateur')}</DialogTitle>
      </DialogHeader>
      {corps}
      <DialogFooter className="justify-between">{pied}</DialogFooter>
    </DialogContent>
  );
}

/**
 * LE PARCOURS SANS FENÊTRE, pour l'étape « Votre ordinateur » de la mise en route : l'état de l'extension est lu ici
 * (et relu à chaque changement poussé par le démon), les boutons du parcours se posent sous la liste.
 */
export function ParcoursDInstallation({
  onPlusTard,
  onTerminer,
  surFini,
  integre,
}: {
  onPlusTard?: () => void;
  onTerminer: () => void;
  surFini?: (fini: boolean) => void;
  integre?: boolean;
}) {
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
  const ouverture = React.useMemo<OuvertureDeLAssistant>(() => ({}), []);
  const { corps, pied } = useParcours({ ouverture, etat, relire: lire, onTerminer, onPlusTard, surFini, integre });
  if (!etat) return <div className="h-[280px] animate-pulse rounded-xl bg-raised" data-silhouette />;
  return (
    <div className="flex flex-col gap-3" data-parcours-integre>
      {corps}
      <div className="flex flex-wrap items-center gap-2">{pied}</div>
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
        {/* L'orange des réponses attendues : c'est à la personne (ou à son Mac) de faire le geste. */}
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

function copier(texte: string, message: string) {
  void navigator.clipboard?.writeText(texte).then(() => client.pushToast('success', message));
}

/* ------------------------------------------------------------------ */
/* Les étapes                                                           */
/* ------------------------------------------------------------------ */

function EtapeOrdinateur(p: {
  ordinateurs: Ordinateur[];
  choix: string;
  setChoix: (v: string) => void;
  nom: string;
  setNom: (v: string) => void;
  mac: boolean;
  navigateur: GenreDeNavigateur;
  setNavigateur: (v: GenreDeNavigateur) => void;
  safariDisponible: boolean;
}) {
  const nomNav = LIBELLE_DU_NAVIGATEUR[p.navigateur];
  return (
    <Encadre repere="ordinateur" className="flex flex-col gap-4">
      {/* Un seul ordinateur connu : son nom suffit (maquette #2327e) ; la liste ne sert qu'à choisir parmi plusieurs. */}
      {p.ordinateurs.length > 1 ? (
        <div className="flex flex-col gap-1.5">
          <Label>{t('Ordinateur à équiper')}</Label>
          <ListeDeroulante
            titre={t('Ordinateur à équiper')}
            valeur={p.choix}
            onChoisir={p.setChoix}
            repere="assistant-ordinateur"
            options={[...p.ordinateurs.map((o) => ({ valeur: o.id, libelle: o.nom })), { valeur: NOUVEL_ORDINATEUR, libelle: t('Un nouvel ordinateur') }]}
          />
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="assistant-nom-ordinateur">{t('Nom de cet ordinateur')}</Label>
        <Input id="assistant-nom-ordinateur" value={p.nom} maxLength={60} placeholder={t('Mac mini du bureau')} onChange={(e) => p.setNom(e.target.value)} data-assistant-nom-ordinateur />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-coche text-white">
          <Check className="size-3" strokeWidth={3} />
        </span>
        <span className="min-w-0 flex-1 text-[14px] text-text" data-assistant-compatible>
          {p.mac ? t('Un Mac, avec {navigateur} : tout est compatible.', { navigateur: nomNav }) : t('Un ordinateur, avec {navigateur} : tout est compatible.', { navigateur: nomNav })}
        </span>
        {p.mac && (p.safariDisponible || p.navigateur === 'safari') ? (
          <Button variant="ghost" size="sm" onClick={() => p.setNavigateur(p.navigateur === 'chrome' ? 'safari' : 'chrome')} data-assistant-autre-navigateur>
            {p.navigateur === 'chrome' ? t('Plutôt Safari') : t('Plutôt Chrome')}
          </Button>
        ) : null}
      </div>
    </Encadre>
  );
}

function EtapeConnect({ programme, telecharge, surTelechargement }: { programme: Ordinateur['programme']; telecharge: boolean; surTelechargement: () => void }) {
  const ancien = programmeEnLigne(programme) && !programme?.connect;
  return (
    <div className="flex flex-col">
      <Encadre repere="connect" className="flex flex-wrap items-center gap-4">
        <img src="/icon-192.png" alt="" className="size-12 shrink-0 rounded-xl" />
        <div className="min-w-[10rem] flex-1">
          <p className="text-[15px] font-semibold text-text">{CONNECT}</p>
          <p className="text-[13px] text-muted">{t('Pour Mac · vérifiée par Apple')}</p>
        </div>
        <Button asChild variant="default" size="md" className="max-sm:basis-full" data-assistant-installer-connect>
          <a href="/api/connect/Beluga-Connect.zip" download="Beluga-Connect.zip" onClick={surTelechargement}>
            <Download className="h-3.5 w-3.5" />
            {t('Installer sur ce Mac')}
          </a>
        </Button>
      </Encadre>
      <p className="mt-3 text-[13px] leading-relaxed text-muted">{t('Ensuite, ouvrez le fichier téléchargé : l’application se range d’elle-même dans vos applications.')}</p>
      {ancien ? (
        <EnAttente>{t('Ce Mac a l’ancien programme « Beluga Relais » : il passe seul à {v0} dans les minutes qui viennent.', { v0: CONNECT })}</EnAttente>
      ) : telecharge ? (
        <EnAttente>{t('Beluga attend {v0}… l’étape se cochera d’elle-même une fois le Mac relié.', { v0: CONNECT })}</EnAttente>
      ) : null}
    </div>
  );
}

function EtapeRelier({ ordinateur, fait }: { ordinateur: Ordinateur | null; fait: boolean }) {
  const [envoi, setEnvoi] = React.useState(false);
  const [demandeLe, setDemandeLe] = React.useState<number | null>(null);
  const [silence, setSilence] = React.useState(false);
  React.useEffect(() => {
    setSilence(false);
    if (!demandeLe || fait) return;
    const minuteur = window.setTimeout(() => setSilence(true), 25_000);
    return () => window.clearTimeout(minuteur);
  }, [demandeLe, fait]);
  const relier = async () => {
    if (!ordinateur) return;
    setEnvoi(true);
    try {
      const { code } = await client.call<{ code: string; expireLe: number }>({ type: 'relaisMac.code', ordinateurId: ordinateur.id });
      /* Le lien ouvre Beluga Connect sur ce Mac (Chrome le demande une seule fois) ; il porte l'adresse de ce Beluga. */
      window.location.href = `beluga-connect://relier?base=${encodeURIComponent(window.location.origin)}&code=${code}`;
      setDemandeLe(Date.now());
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Le geste n’a pas abouti.'));
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <div className="flex flex-col">
      <Encadre repere="relier" className="flex flex-wrap items-center gap-4">
        <p className="min-w-[12rem] flex-1 text-[13.5px] leading-relaxed text-text">
          {t('Chrome vous demandera une seule fois d’ouvrir l’application : choisissez « Ouvrir {v0} ».', { v0: CONNECT })}
        </p>
        <Button variant="default" size="md" className="max-sm:basis-full" onClick={() => void relier()} disabled={envoi || !ordinateur} data-assistant-relier-mac>
          {envoi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {t('Relier ce Mac')}
        </Button>
      </Encadre>
      {demandeLe && !fait ? <EnAttente>{t('Beluga attend la réponse de {v0}… l’étape se cochera d’elle-même.', { v0: CONNECT })}</EnAttente> : null}
      {silence && !fait ? (
        <p className="mt-2 text-[13px] leading-relaxed text-muted" data-assistant-rien-ouvert>
          {t('Rien ne s’est ouvert ? Vérifiez que {v0} est installé (étape précédente), puis cliquez de nouveau.', { v0: CONNECT })}
        </p>
      ) : null}
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
      <Encadre repere="autorisations" className="flex flex-col gap-1.5" >
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

function EtapeChrome({
  ordinateur,
  nav,
  sousEtats,
  fait,
}: {
  ordinateur: Ordinateur | null;
  nav: NavigateurDOrdinateur | null;
  sousEtats: { ajoutee: boolean; reliee: boolean; prive: boolean };
  fait: boolean;
}) {
  const [envoi, setEnvoi] = React.useState<string | null>(null);
  const preparation = ordinateur?.programme?.preparation ?? null;
  const echec = preparation?.etat === 'echec';
  const ordre: { cle: keyof typeof sousEtats; titre: string; enCours: string }[] = [
    { cle: 'ajoutee', titre: t('Extension ajoutée à Chrome'), enCours: t('Ajout de l’extension à Chrome…') },
    { cle: 'reliee', titre: t('Extension reliée à Beluga'), enCours: t('Liaison de l’extension…') },
    { cle: 'prive', titre: t('Autorisée en navigation privée'), enCours: t('Autorisation en navigation privée…') },
  ];
  const premiereManquante = ordre.find((o) => !sousEtats[o.cle])?.cle ?? null;
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
      {fait ? null : echec ? (
        <div className="mt-4 flex flex-col gap-3" data-assistant-secours>
          <p className="text-[13.5px] leading-relaxed text-text">{t('{v0} n’a pas pu tout faire seul. Trois clics suffisent :', { v0: CONNECT })}</p>
          {!sousEtats.ajoutee ? (
            <EtapesNumerotees
              repere="secours-chrome"
              etapes={[
                t('Dans Chrome, ouvrez la page chrome://extensions et activez le « Mode développeur », en haut à droite.'),
                t('Cliquez sur « Charger l’extension non empaquetée ».'),
                t('Tapez Cmd + Maj + G, collez {chemin}, puis validez deux fois.', { chemin: DOSSIER_DE_L_EXTENSION }),
              ]}
            />
          ) : !sousEtats.prive && nav ? (
            <Button variant="subtle" size="md" className="self-start" onClick={() => void ouvrirLaPage()} disabled={!!envoi} data-assistant-ouvrir-page-extension>
              {envoi === 'page' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {t('Ouvrir la page de l’extension')}
            </Button>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {!sousEtats.ajoutee ? (
              <Button variant="subtle" size="md" onClick={() => copier(DOSSIER_DE_L_EXTENSION, t('Chemin copié.'))} data-assistant-copier-chemin>
                <Copy className="h-3.5 w-3.5" />
                {t('Copier le chemin')}
              </Button>
            ) : null}
            <Button variant="subtle" size="md" onClick={() => void reessayer()} disabled={!!envoi} data-assistant-reessayer>
              {envoi === 'preparer' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {t('Réessayer')}
            </Button>
          </div>
        </div>
      ) : (
        <EnAttente>{t('Quelques secondes… l’étape se cochera d’elle-même.')}</EnAttente>
      )}
    </div>
  );
}

function EtapeExtension({ navigateur }: { navigateur: GenreDeNavigateur }) {
  const chrome = navigateur === 'chrome';
  return (
    <div className="flex flex-col gap-4">
      <Button asChild variant="default" size="md" className="self-start" data-assistant-telecharger={navigateur}>
        <a href={chrome ? '/api/extension-chrome.zip' : '/api/extension-safari.zip'} download={chrome ? 'beluga-chrome.zip' : 'Beluga-Safari.zip'}>
          <Download className="h-3.5 w-3.5" />
          {chrome ? t('Télécharger Beluga pour Chrome') : t('Télécharger Beluga pour Safari')}
        </a>
      </Button>
      <Encadre repere={`gestes-${navigateur}`}>
        <EtapesNumerotees
          repere={navigateur}
          etapes={
            chrome
              ? [
                  t('Décompressez le fichier, puis ouvrez la page chrome://extensions et activez le « Mode développeur », en haut à droite.'),
                  t('Cliquez sur « Charger l’extension non empaquetée » et choisissez le dossier « beluga-chrome ».'),
                  t('Épinglez l’icône Beluga près de la barre d’adresse : elle sert à l’étape suivante.'),
                ]
              : [
                  t('Décompressez le fichier, glissez « Beluga » dans Applications, puis ouvrez-la une fois.'),
                  t('Dans Safari, ouvrez Réglages → Extensions et cochez « Beluga », sur tous les sites.'),
                  t('Gardez l’icône Beluga dans la barre de Safari : elle sert à l’étape suivante.'),
                ]
          }
        />
      </Encadre>
    </div>
  );
}

const heure = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * LE CODE DE LIAISON, VIVANT (20/11/2026) : demandé dès l'arrivée sur l'étape (même si un navigateur est déjà relié),
 * redemandé seul APRÈS son échéance (un code neuf tue le précédent du compte : jamais avant), et remplacé par
 * « Relié avec succès » dès qu'un navigateur de cet ordinateur se relie APRÈS son émission.
 */
function EtapeLiaison({ ordinateur, navigateur }: { ordinateur: Ordinateur | null; navigateur: GenreDeNavigateur }) {
  const [code, setCode] = React.useState<{ code: string; expireLe: number; emisLe: number } | null>(null);
  const [enCours, setEnCours] = React.useState(false);
  const ordinateurId = ordinateur?.id ?? null;
  const demander = React.useCallback(async () => {
    if (!ordinateurId) return;
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
  const reussi =
    !!code &&
    !!ordinateur?.navigateurs.some((n) => n.genre === navigateur && n.enLigne && (n.creeLe ?? 0) >= code.emisLe - 5_000);
  /* Échéance passée sans liaison : un code neuf, tout seul. */
  React.useEffect(() => {
    if (!code || reussi) return;
    const minuteur = window.setTimeout(() => void demander(), Math.max(1_000, code.expireLe - Date.now() + 500));
    return () => window.clearTimeout(minuteur);
  }, [code, reussi, demander]);
  const nomNav = LIBELLE_DU_NAVIGATEUR[navigateur];
  const nom = ordinateur?.nom ?? '';
  if (reussi) {
    return (
      <Encadre repere="liaison-reussie">
        <LigneDEtat repere="liaison" etat="fait">
          <span className="text-coche">{t('Relié avec succès')}</span>
          <span className="text-muted"> · {t('{navigateur} sur « {nom} »', { navigateur: nomNav, nom })}</span>
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
      {code ? <EnAttente>{t('En attente de {navigateur} sur « {nom} »… l’étape se cochera d’elle-même.', { navigateur: nomNav, nom })}</EnAttente> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {code ? (
          <Button variant="subtle" size="md" onClick={() => copier(code.code, t('Code copié.'))} data-copier-code>
            <Copy className="h-3.5 w-3.5" />
            {t('Copier le code')}
          </Button>
        ) : null}
        <Button variant="subtle" size="md" onClick={() => void demander()} disabled={enCours} data-code-navigateur>
          {enCours ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {t('Nouveau code')}
        </Button>
      </div>
    </div>
  );
}
