import * as React from 'react';
import { Check, Copy, Download, Loader2, RefreshCw } from '@/components/ui/icones';
import {
  LIBELLE_DU_NAVIGATEUR,
  VERSION_EXTENSION_CHROME,
  autorisationsDonnees,
  codeDeLiaisonLisible,
  programmeEnLigne,
  type EtatDeLExtension,
  type GenreDeNavigateur,
  type Ordinateur,
} from '@beluga/shared';
import { BoutonsRadio, Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Label, ListeDeroulante } from '@/components/ui';
import { client } from '@/lib/client';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * L'ASSISTANT D'INSTALLATION DE LA PAGE « EXTENSION » (carte « Installation guidée sur le Mac », 15/11/2026).
 *
 * Ouvert par « Télécharger » (Chrome ou Safari) ou par « Relier un navigateur ou le programme du Mac » d'un ordinateur,
 * il avance UNE étape à la fois : l'ordinateur et le navigateur, l'extension (téléchargement et gestes propres au
 * navigateur), la liaison (code affiché dans l'étape), puis — sur un Mac, facultatif — le programme « Beluga Relais »
 * (commande à coller dans le Terminal) et ses deux autorisations de macOS. CHAQUE ÉTAPE SE COCHE D'ELLE-MÊME : l'état
 * de la page (poussé par le démon à chaque changement) dit quand le navigateur est relié, quand le programme répond et
 * quand ses autorisations sont données. Le programme et ses autorisations se passent toujours (« Passer ») : une
 * détection prise en défaut ne bloque jamais personne.
 */

type Etape = 'navigateur' | 'extension' | 'liaison' | 'programme' | 'autorisations';
const NOUVEL_ORDINATEUR = '__nouveau__';
/** Le nom de l'application installée sur le Mac : un nom propre, le même dans toutes les langues. */
const NOM_DU_PROGRAMME = ['Beluga', 'Relais'].join(' ');

export interface OuvertureDeLAssistant {
  /** Absent : le premier ordinateur ; `null` : un nouvel ordinateur, à nommer. */
  ordinateurId?: string | null;
  navigateur?: GenreDeNavigateur;
}

function libelleDeLEtape(e: Etape): string {
  switch (e) {
    case 'navigateur':
      return t('Navigateur');
    case 'extension':
      return t('Extension');
    case 'liaison':
      return t('Liaison');
    case 'programme':
      return t('Programme du Mac');
    default:
      return t('Autorisations');
  }
}

/** L'ordinateur visé est-il un Mac ? Safari, un programme déjà là, son nom, ou l'appareil d'où l'on installe. */
function estUnMac(o: Ordinateur | null, navigateur: GenreDeNavigateur, nomNouveau: string): boolean {
  if (navigateur === 'safari' || o?.programme) return true;
  if (o?.navigateurs.some((n) => n.genre === 'safari')) return true;
  if (/mac|imac/i.test(o?.nom ?? nomNouveau)) return true;
  return typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);
}

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
  const ouvert = !!ouverture;
  const [etape, setEtape] = React.useState<Etape>('navigateur');
  const [choix, setChoix] = React.useState<string>(NOUVEL_ORDINATEUR);
  const [nomNouveau, setNomNouveau] = React.useState('');
  const [navigateur, setNavigateur] = React.useState<GenreDeNavigateur>('chrome');
  const [envoi, setEnvoi] = React.useState(false);

  const ordinateurs = etat?.ordinateurs ?? [];
  const ordinateur = ordinateurs.find((o) => o.id === choix) ?? null;
  const safariDisponible = !!etat?.safari.disponible;

  /* À chaque ouverture : l'ordinateur et le navigateur demandés, sinon le premier ordinateur et Chrome. */
  React.useEffect(() => {
    if (!ouverture) return;
    setEtape('navigateur');
    setChoix(ouverture.ordinateurId === null ? NOUVEL_ORDINATEUR : (ouverture.ordinateurId ?? ordinateurs[0]?.id ?? NOUVEL_ORDINATEUR));
    setNomNouveau('');
    setNavigateur(ouverture.navigateur === 'safari' && safariDisponible ? 'safari' : 'chrome');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouverture]);

  const mac = estUnMac(ordinateur, navigateur, nomNouveau);
  const etapes: Etape[] = mac ? ['navigateur', 'extension', 'liaison', 'programme', 'autorisations'] : ['navigateur', 'extension', 'liaison'];
  const rang = etapes.indexOf(etape);

  /* Les étapes faites, d'après l'état de la page : de quoi cocher la rangée du haut. */
  const navigateurRelie = !!ordinateur?.navigateurs.some((n) => n.genre === navigateur && n.enLigne);
  const programmeNeuf = !!ordinateur?.programme && programmeEnLigne(ordinateur.programme) && ordinateur.programme.autorisations !== null;
  const autorisationsOk = autorisationsDonnees(ordinateur?.programme);
  const faite: Record<Etape, boolean> = {
    navigateur: rang > 0,
    extension: rang > 1 || navigateurRelie,
    liaison: navigateurRelie,
    programme: programmeNeuf,
    autorisations: autorisationsOk,
  };

  const suivante = () => {
    const prochaine = etapes[rang + 1];
    if (prochaine) setEtape(prochaine);
    else onClose();
  };
  const precedente = () => setEtape(etapes[Math.max(0, rang - 1)]!);

  const continuerDepuisLeNavigateur = async () => {
    if (choix !== NOUVEL_ORDINATEUR) return suivante();
    if (!nomNouveau.trim()) return;
    setEnvoi(true);
    try {
      const r = await client.call<{ id: string }>({ type: 'ordinateur.creer', nom: nomNouveau.trim() });
      await relire();
      setChoix(r.id);
      setEtape('extension');
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Le geste n’a pas abouti.'));
    } finally {
      setEnvoi(false);
    }
  };

  const nomVise = ordinateur?.nom ?? (nomNouveau.trim() || t('Nouvel ordinateur'));

  return (
    <Dialog open={ouvert} onOpenChange={(o) => !o && onClose()}>
      <DialogContent adresse="installation" className="sm:w-[min(780px,100%)]" data-assistant-installation={etape}>
        <DialogHeader sous={<RangeeDesEtapes etapes={etapes} courante={etape} faite={faite} />}>
          <DialogTitle>{t('Installer Beluga sur un ordinateur')}</DialogTitle>
        </DialogHeader>

        {etape === 'navigateur' ? (
          <EtapeNavigateur
            ordinateurs={ordinateurs}
            choix={choix}
            setChoix={setChoix}
            nomNouveau={nomNouveau}
            setNomNouveau={setNomNouveau}
            navigateur={navigateur}
            setNavigateur={setNavigateur}
            safariDisponible={safariDisponible}
            safariVersion={etat?.safari.version ?? null}
          />
        ) : etape === 'extension' ? (
          <EtapeExtension navigateur={navigateur} />
        ) : etape === 'liaison' ? (
          <EtapeLiaison ordinateur={ordinateur} navigateur={navigateur} relie={navigateurRelie} />
        ) : etape === 'programme' ? (
          <EtapeProgramme ordinateur={ordinateur} navigateurRelie={navigateurRelie} navigateur={navigateur} fait={programmeNeuf} />
        ) : (
          <EtapeAutorisations ordinateur={ordinateur} />
        )}

        <DialogFooter className="justify-between">
          {etape === 'navigateur' ? (
            <Button variant="subtle" onClick={onClose} data-assistant-annuler>
              {t('Annuler')}
            </Button>
          ) : (
            <Button variant="subtle" onClick={precedente} data-assistant-retour>
              {t('Retour')}
            </Button>
          )}
          <span className="flex-1" />
          {etape === 'programme' || etape === 'autorisations' ? (
            <Button variant="ghost" onClick={onClose} data-assistant-passer>
              {etape === 'programme' ? t('Passer cette étape') : t('Passer')}
            </Button>
          ) : null}
          {etape === 'navigateur' ? (
            <Button onClick={() => void continuerDepuisLeNavigateur()} disabled={envoi || (choix === NOUVEL_ORDINATEUR && !nomNouveau.trim())} data-assistant-continuer>
              {envoi ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t('Continuer')}
            </Button>
          ) : etape === 'extension' ? (
            <Button onClick={suivante} data-assistant-continuer>
              {t('L’extension est installée')}
            </Button>
          ) : (
            <Button
              onClick={suivante}
              disabled={!faite[etape]}
              title={!faite[etape] ? t('Beluga attend que cette étape soit faite sur « {nom} ».', { nom: nomVise }) : undefined}
              data-assistant-continuer
            >
              {rang === etapes.length - 1 ? t('Terminer') : t('Continuer')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* La rangée des étapes                                                 */
/* ------------------------------------------------------------------ */

function RangeeDesEtapes({ etapes, courante, faite }: { etapes: Etape[]; courante: Etape; faite: Record<Etape, boolean> }) {
  return (
    <ol className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 sm:flex-nowrap" data-rangee-etapes>
      {etapes.map((e, i) => {
        const ici = e === courante;
        const ok = faite[e] && !ici;
        return (
          <li key={e} className="flex items-center gap-2" data-etape-assistant={e} data-faite={faite[e] ? 'oui' : 'non'}>
            {i > 0 ? <span className="hidden h-px w-3 bg-faint/50 sm:block" aria-hidden /> : null}
            <span
              className={cn(
                'flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11.5px] font-semibold',
                ok || (ici && faite[e]) ? 'bg-text text-bg' : ici ? 'bg-raised text-text ring-[1.5px] ring-inset ring-text' : 'bg-raised text-faint',
              )}
            >
              {faite[e] ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}
            </span>
            <span className={cn('whitespace-nowrap text-[12.5px]', ici ? 'font-semibold text-text' : 'hidden text-muted sm:inline')}>
              {libelleDeLEtape(e)}
              {e === 'programme' && ici ? <span className="font-normal text-faint"> · {t('facultatif')}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* Les étapes                                                           */
/* ------------------------------------------------------------------ */

function Intro({ titre, children }: { titre: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-[15px] font-semibold text-text">{titre}</h3>
      {children ? <p className="text-[13.5px] leading-relaxed text-muted">{children}</p> : null}
    </div>
  );
}

function LigneFaite({ children, repere }: { children: React.ReactNode; repere?: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-raised px-3.5 py-3 text-[13.5px] text-text" data-etape-cochee={repere ?? ''}>
      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-text text-bg">
        <Check className="h-3 w-3" strokeWidth={3} />
      </span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

function EnAttente({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2.5 text-[13px] text-muted" data-en-attente>
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-en-cours opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-en-cours" />
      </span>
      {children}
    </p>
  );
}

function EtapesNumerotees({ etapes, repere }: { etapes: React.ReactNode[]; repere: string }) {
  return (
    <ol className="flex flex-col gap-3" data-etapes-installation={repere}>
      {etapes.map((texte, i) => (
        <li key={i} className="flex gap-3 text-[13.5px] leading-relaxed text-text">
          <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-raised text-[11.5px] font-semibold text-muted">{i + 1}</span>
          <span className="min-w-0">{texte}</span>
        </li>
      ))}
    </ol>
  );
}

function EtapeNavigateur(p: {
  ordinateurs: Ordinateur[];
  choix: string;
  setChoix: (v: string) => void;
  nomNouveau: string;
  setNomNouveau: (v: string) => void;
  navigateur: GenreDeNavigateur;
  setNavigateur: (v: GenreDeNavigateur) => void;
  safariDisponible: boolean;
  safariVersion: string | null;
}) {
  return (
    <div className="flex flex-col gap-5 pb-1 pt-3">
      <div className="flex flex-col gap-1.5">
        <Label>{t('Ordinateur à équiper')}</Label>
        <ListeDeroulante
          titre={t('Ordinateur à équiper')}
          valeur={p.choix}
          onChoisir={p.setChoix}
          repere="assistant-ordinateur"
          options={[
            ...p.ordinateurs.map((o) => ({ valeur: o.id, libelle: o.nom })),
            { valeur: NOUVEL_ORDINATEUR, libelle: t('Un nouvel ordinateur'), detail: t('Vous lui donnez un nom') },
          ]}
        />
        {p.choix === NOUVEL_ORDINATEUR ? (
          <div className="mt-2 flex flex-col gap-1.5">
            <Label htmlFor="assistant-nom-ordinateur">{t('Son nom')}</Label>
            <Input
              id="assistant-nom-ordinateur"
              value={p.nomNouveau}
              maxLength={60}
              placeholder={t('Mac mini du bureau')}
              onChange={(e) => p.setNomNouveau(e.target.value)}
              data-assistant-nom-ordinateur
            />
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <Intro titre={t('Quel navigateur utilisez-vous sur cet ordinateur ?')}>
          {t('Les agents travailleront dans ce navigateur, avec les comptes où vous êtes déjà connecté.')}
        </Intro>
        <BoutonsRadio
          libelle={t('Navigateur')}
          valeur={p.navigateur}
          onChoisir={(v) => p.setNavigateur(v as GenreDeNavigateur)}
          className="mt-1 -mx-2.5"
          data-assistant-navigateur
          options={[
            { valeur: 'chrome', libelle: 'Chrome', detail: t('Extension à installer à la main, en trois gestes. Version {v}.', { v: VERSION_EXTENSION_CHROME }) },
            {
              valeur: 'safari',
              libelle: 'Safari',
              desactivee: !p.safariDisponible,
              detail: p.safariDisponible
                ? t('Sur Mac seulement. Application signée par Apple{v}.', { v: p.safariVersion ? ` · ${t('version {v}', { v: p.safariVersion })}` : '' })
                : t('Pas encore fabriquée : elle le sera à la prochaine version de l’extension.'),
            },
          ]}
        />
      </div>
    </div>
  );
}

function EtapeExtension({ navigateur }: { navigateur: GenreDeNavigateur }) {
  const chrome = navigateur === 'chrome';
  return (
    <div className="flex flex-col gap-5 pb-1 pt-3">
      <Intro titre={chrome ? t('Installer l’extension dans Chrome') : t('Installer l’extension dans Safari')}>
        {chrome
          ? t('L’extension s’installe sans passer par la boutique de Chrome. Suivez ces gestes dans l’ordre.')
          : t('L’application est signée : elle s’ouvre sans avertissement. Suivez ces gestes dans l’ordre.')}
      </Intro>
      <Button asChild variant="default" size="md" className="self-start" data-assistant-telecharger={navigateur}>
        <a href={chrome ? '/api/extension-chrome.zip' : '/api/extension-safari.zip'} download={chrome ? 'beluga-chrome.zip' : 'Beluga-Safari.zip'}>
          <Download className="h-3.5 w-3.5" />
          {chrome ? t('Télécharger Beluga pour Chrome') : t('Télécharger Beluga pour Safari')}
        </a>
      </Button>
      <EtapesNumerotees
        repere={navigateur}
        etapes={
          chrome
            ? [
                t('Décompressez le fichier téléchargé, puis ouvrez la page des extensions de Chrome : tapez chrome://extensions dans la barre d’adresse.'),
                t('En haut à droite, activez le « Mode développeur ».'),
                t('Cliquez sur « Charger l’extension non empaquetée » et choisissez le dossier « beluga-chrome » décompressé.'),
                t('Épinglez l’icône Beluga près de la barre d’adresse : vous en aurez besoin à l’étape suivante.'),
              ]
            : [
                t('Décompressez le fichier téléchargé, glissez « Beluga » dans le dossier Applications, puis ouvrez-la une fois.'),
                t('Dans Safari, ouvrez Réglages → Extensions et cochez « Beluga ». Autorisez-la sur tous les sites.'),
                t('Gardez l’icône Beluga dans la barre de Safari : vous en aurez besoin à l’étape suivante.'),
              ]
        }
      />
    </div>
  );
}

/** Un code ou une commande demandés au démon dès l'arrivée sur l'étape, et redemandables. */
function useCodeEmis(genre: 'extension' | 'relaisMac', ordinateurId: string | null, actif: boolean) {
  const [code, setCode] = React.useState<{ code: string; expireLe: number } | null>(null);
  const [enCours, setEnCours] = React.useState(false);
  const demander = React.useCallback(async () => {
    if (!ordinateurId) return;
    setEnCours(true);
    try {
      setCode(await client.call<{ code: string; expireLe: number }>({ type: genre === 'extension' ? 'extension.code' : 'relaisMac.code', ordinateurId }));
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Le geste n’a pas abouti.'));
    } finally {
      setEnCours(false);
    }
  }, [genre, ordinateurId]);
  React.useEffect(() => {
    setCode(null);
    if (actif) void demander();
  }, [actif, demander]);
  return { code, enCours, demander };
}

const heure = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function copier(texte: string, message: string) {
  void navigator.clipboard?.writeText(texte).then(() => client.pushToast('success', message));
}

function EtapeLiaison({ ordinateur, navigateur, relie }: { ordinateur: Ordinateur | null; navigateur: GenreDeNavigateur; relie: boolean }) {
  /* Déjà relié en arrivant : pas de code d'office, mais on peut en redemander un (réinstallation). */
  const dejaRelie = React.useRef(relie).current;
  const { code, enCours, demander } = useCodeEmis('extension', ordinateur?.id ?? null, !dejaRelie);
  const nomNav = LIBELLE_DU_NAVIGATEUR[navigateur];
  const nom = ordinateur?.nom ?? '';
  return (
    <div className="flex flex-col gap-5 pb-1 pt-3">
      <Intro titre={t('Relier {navigateur} à Beluga', { navigateur: nomNav })}>
        {t('Cliquez sur l’icône Beluga dans {navigateur}, puis saisissez ce code. Il ne sert qu’une fois.', { navigateur: nomNav })}
      </Intro>
      {relie ? (
        <LigneFaite repere="liaison">{t('{navigateur} est relié à Beluga sur « {nom} ».', { navigateur: nomNav, nom })}</LigneFaite>
      ) : null}
      {code ? (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-raised px-4 py-5">
          <p className="font-mono text-[34px] font-semibold tracking-[0.25em] text-text sm:text-[40px]" data-code-de-liaison={code.code}>
            {codeDeLiaisonLisible(code.code)}
          </p>
          <p className="text-[12.5px] text-muted">{t('Valable jusqu’à {h}.', { h: heure(code.expireLe) })}</p>
        </div>
      ) : enCours ? (
        <div className="h-[104px] animate-pulse rounded-xl bg-raised" data-silhouette />
      ) : null}
      {!relie && code ? <EnAttente>{t('En attente de {navigateur} sur « {nom} »… l’étape se cochera d’elle-même.', { navigateur: nomNav, nom })}</EnAttente> : null}
      <div className="flex flex-wrap gap-2">
        {code ? (
          <Button variant="subtle" size="md" onClick={() => copier(code.code, t('Code copié.'))} data-copier-code>
            <Copy className="h-3.5 w-3.5" />
            {t('Copier le code')}
          </Button>
        ) : null}
        <Button variant="subtle" size="md" onClick={() => void demander()} disabled={enCours} data-code-navigateur>
          {enCours ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {code ? t('Nouveau code') : t('Afficher un code')}
        </Button>
      </div>
    </div>
  );
}

function EtapeProgramme({
  ordinateur,
  navigateurRelie,
  navigateur,
  fait,
}: {
  ordinateur: Ordinateur | null;
  navigateurRelie: boolean;
  navigateur: GenreDeNavigateur;
  fait: boolean;
}) {
  const dejaFait = React.useRef(fait).current;
  const { code, enCours, demander } = useCodeEmis('relaisMac', ordinateur?.id ?? null, !dejaFait);
  const ancien = !!ordinateur?.programme && programmeEnLigne(ordinateur.programme) && ordinateur.programme.autorisations === null;
  const ligne = code ? `curl -fsSL ${window.location.origin}/api/relais-mac/installer.sh | sh -s ${code.code}` : '';
  const nom = ordinateur?.nom ?? '';
  return (
    <div className="flex flex-col gap-5 pb-1 pt-3">
      {navigateurRelie ? (
        <LigneFaite>{t('{navigateur} est relié à Beluga sur « {nom} ».', { navigateur: LIBELLE_DU_NAVIGATEUR[navigateur], nom })}</LigneFaite>
      ) : null}
      <Intro titre={t('Le programme du Mac — pour piloter votre iPhone')}>
        {t('Seulement utile si les agents doivent agir sur l’iPhone affiché par « Recopie de l’iPhone », relancer le navigateur ou ouvrir une application. Sur le Mac, ouvrez l’application Terminal, collez cette commande et appuyez sur Entrée.')}
      </Intro>
      {fait ? <LigneFaite repere="programme">{t('« Beluga Relais » est installé et répond sur « {nom} ».', { nom })}</LigneFaite> : null}
      {ancien ? (
        <p className="rounded-xl bg-raised px-3.5 py-3 text-[13px] leading-relaxed text-text" data-ancien-programme>
          {t('Une ancienne version du programme tourne sur ce Mac, sans nom à elle : elle n’apparaît pas dans les réglages de macOS. Collez la commande ci-dessous pour la remplacer par « Beluga Relais ».')}
        </p>
      ) : null}
      {code ? (
        <div className="flex items-start gap-3 rounded-xl bg-text px-4 py-3.5 dark:bg-raised">
          <code className="min-w-0 flex-1 select-all break-all font-mono text-[12.5px] leading-relaxed text-bg dark:text-text" data-commande-relais={code.code}>
            {ligne}
          </code>
          <Button variant="subtle" size="sm" onClick={() => copier(ligne, t('Commande copiée.'))} data-copier-commande-relais>
            <Copy className="h-3.5 w-3.5" />
            {t('Copier')}
          </Button>
        </div>
      ) : enCours ? (
        <div className="h-[64px] animate-pulse rounded-xl bg-raised" data-silhouette />
      ) : null}
      <p className="text-[13px] leading-relaxed text-muted">
        {t('Elle installe une petite application, « Beluga Relais », dans le dossier Applications de votre session, et la lance. Rien d’autre n’est modifié.')}
      </p>
      {!fait && code ? <EnAttente>{t('En attente du programme sur « {nom} »…', { nom })}</EnAttente> : null}
      <Button variant="subtle" size="md" className="self-start" onClick={() => void demander()} disabled={enCours} data-code-relais>
        {enCours ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        {code ? t('Nouvelle commande') : fait ? t('Réinstaller le programme') : t('Afficher la commande')}
      </Button>
    </div>
  );
}

/** Les deux autorisations, avec ce qu'on lit quand elles sont accordées ou non, et où elles se trouvent. */
function autorisationsAffichees(): { cle: 'accessibilite' | 'ecran'; titre: string; accordee: string; manque: string; reglage: string }[] {
  return [
    {
      cle: 'accessibilite',
      titre: t('Accessibilité'),
      accordee: t('Accordée — le programme peut cliquer et écrire.'),
      manque: t('Pas encore accordée — le programme ne peut ni cliquer ni écrire.'),
      reglage: t('Confidentialité et sécurité → Accessibilité'),
    },
    {
      cle: 'ecran',
      titre: t('Enregistrement de l’écran'),
      accordee: t('Accordée — le programme voit la fenêtre de l’iPhone.'),
      manque: t('Pas encore accordée — le programme ne voit pas la fenêtre de l’iPhone.'),
      reglage: t('Confidentialité et sécurité → Enregistrement de l’écran et de l’audio système'),
    },
  ];
}

function EtapeAutorisations({ ordinateur }: { ordinateur: Ordinateur | null }) {
  const [ouverture, setOuverture] = React.useState<string | null>(null);
  const a = ordinateur?.programme?.autorisations ?? null;
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
    <div className="flex flex-col gap-5 pb-1 pt-3">
      <Intro titre={t('Deux autorisations à accorder sur le Mac')}>
        {t('macOS demande votre accord pour que « Beluga Relais » voie et touche la fenêtre de l’iPhone. Dans Réglages Système → Confidentialité et sécurité, activez l’interrupteur en face de « Beluga Relais ».')}
      </Intro>
      <div className="flex flex-col rounded-xl bg-raised" data-autorisations>
        {autorisationsAffichees().map((x) => {
          const valeur = a?.[x.cle] ?? null;
          return (
            <div key={x.cle} className="flex flex-wrap items-center gap-3 px-3.5 py-3" data-autorisation={x.cle} data-accordee={valeur === true ? 'oui' : valeur === false ? 'non' : 'inconnue'}>
              {valeur === true ? (
                <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-text text-bg">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
              ) : (
                <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center">
                  <span className="h-2 w-2 rounded-full bg-en-cours" />
                </span>
              )}
              <div className="flex min-w-[11rem] flex-1 flex-col">
                <span className="text-[13.5px] font-semibold text-text">{x.titre}</span>
                <span className="text-[12.5px] text-muted">
                  {valeur === true ? x.accordee : valeur === false ? x.manque : t('Le Mac ne l’a pas encore dit : vérifiez dans {reglage}.', { reglage: x.reglage })}
                </span>
              </div>
              {valeur !== true ? (
                <Button variant="default" size="md" className="basis-full sm:basis-auto" onClick={() => void rouvrir(x.cle)} disabled={!!ouverture} data-rouvrir-reglage={x.cle}>
                  {ouverture === x.cle ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {t('Rouvrir ce réglage sur le Mac')}
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
      <ApercuDesReglages />
      <p className="text-[13px] leading-relaxed text-muted">
        {t('Si macOS propose « Quitter et rouvrir », acceptez : le programme repart tout seul. Pour piloter l’iPhone, ouvrez ensuite une fois « Recopie de l’iPhone » sur le Mac — c’est l’application d’Apple qui affiche l’iPhone, pas notre programme.')}
      </p>
    </div>
  );
}

/** Un petit dessin des réglages de macOS : où se trouve l'interrupteur à activer. */
function ApercuDesReglages() {
  return (
    <div className="flex gap-3 rounded-xl bg-raised p-3" aria-hidden data-apercu-reglages>
      <div className="hidden w-[150px] shrink-0 flex-col gap-1.5 pt-1 text-[11.5px] text-muted sm:flex">
        <span>{t('Réglages Système')}</span>
        <span>{t('Général')}</span>
        <span className="self-start rounded-md bg-text px-1.5 text-bg">{t('Confidentialité et sécurité')}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col rounded-lg bg-surface px-3 py-2 text-[12px] text-text">
        <span className="pb-1.5 font-semibold">{t('Enregistrement de l’écran et de l’audio système')}</span>
        <span className="flex items-center justify-between py-1.5 text-muted">
          <span>{t('Autre application')}</span>
          <Interrupteur actif />
        </span>
        <span className="flex items-center justify-between py-1.5">
          <span className="rounded-md px-1 ring-2 ring-en-cours">{NOM_DU_PROGRAMME}</span>
          <Interrupteur actif={false} />
        </span>
      </div>
    </div>
  );
}

function Interrupteur({ actif }: { actif: boolean }) {
  return (
    <span className={cn('relative inline-flex h-[16px] w-[28px] shrink-0 rounded-full', actif ? 'bg-text' : 'bg-faint/50')}>
      <span className={cn('absolute top-[2px] h-3 w-3 rounded-full bg-bg', actif ? 'left-[14px]' : 'left-[2px]')} />
    </span>
  );
}
