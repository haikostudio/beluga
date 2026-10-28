import * as React from 'react';
import { ArrowUpRight, Loader2, Monitor, RotateCw, Smartphone, Tablet, X } from 'lucide-react';
import {
  CLE_APPAREIL_D_APERCU,
  CLE_FORMAT_D_APERCU,
  cheminRetenu,
  cleCheminDApercu,
  CLE_ORIENTATION_D_APERCU,
  cleAppareilDApercu,
  cleOrientationDApercu,
  FORMATS_D_APERCU,
  appareilAdapte,
  appareilDeDepart,
  appareilsDuFormat,
  dimensionsDeLAppareil,
  echelleDeLAppareil,
  echelleDuFormat,
  appareilParId,
  estOrientationDApercu,
  famillesDuFormat,
  orientationDeLAppareil,
  type AppareilDApercu,
  type FamilleDAppareil,
  type FormatDApercu,
  type OrientationDApercu,
} from '@beluga/shared';
import {
  ActionTiroir,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  GroupeTiroir,
  SousMenuTiroir,
  Tooltip,
} from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';
import { usePref } from '@/lib/prefs';
import { useTelephone } from '@/lib/telephone';

/**
 * LE VOLET D'APERÇU : LE SITE DE DÉVELOPPEMENT DU PROJET, À DROITE DE LA CARTE.
 *
 * Il s'ouvre par le bouton « Aperçu » de l'en-tête d'une carte
 * (`card-panel.tsx`) et prend toute la largeur disponible ; la conversation se
 * réduit à gauche, à une largeur réglable par une poignée (`conversation-apercu`,
 * 400 px au départ). Sur ordinateur, il flotte dans une fenêtre arrondie posée
 * sur le fond du volet, et une pastille « Développement » précède l'hôte. Sur téléphone, il prend
 * l'écran entier à la place de la conversation (masquée, pas démontée) et la
 * flèche de l'en-tête le referme : pas de croix dans sa barre. C'est l'adresse de
 * développement du projet (`Project.devUrl`) qui s'affiche — celle que la
 * tâche modifie en direct —, jamais le site en production.
 *
 * Une fausse fenêtre de navigateur : barre d'adresse (le chemin se modifie,
 * l'hôte reste celui du projet), recharger, ouvrir dans un onglet, et TOUT À
 * DROITE le choix du format (`formats-d-apercu.ts`) : trois icônes côte à côte
 * sur ordinateur, un seul bouton sur téléphone.
 *
 * LES APPAREILS D'ESSAI, EN DEUX TEMPS. Un clic sur l'icône d'un format le
 * montre aussitôt en VERSION DE BASE (sa largeur standard, toute la hauteur :
 * « Adapté à la place »). Un second clic sur l'icône déjà active ouvre un MENU
 * À DEUX NIVEAUX — les familles (iPhone, Android…), puis leurs modèles avec
 * leur résolution —, et Portrait / Paysage à la suite. Rien n'est posé à côté
 * des icônes. Sur téléphone, le bouton unique ouvre un menu : les trois formats
 * (un choix l'affiche en version de base et referme), puis « Appareil » et
 * l'orientation. Le cadre prend la largeur ET la hauteur réelles de l'appareil,
 * garde exactement ce rapport et se réduit en entier s'il ne tient pas
 * (`echelleDeLAppareil`). « Adapté à la place » : la largeur nominale, toute la
 * hauteur.
 *
 * LA DERNIÈRE ADRESSE SAISIE se retient aussi par projet (`apercu.chemin.<projet>`) :
 * le site est dans un cadre d'une autre origine, ses pages internes ne se
 * lisent pas — seule l'adresse saisie dans la barre est connue.
 *
 * Le dernier appareil et la dernière orientation sont retenus PAR PROJET
 * (`apercu.appareil.<projet>`, `apercu.orientation.<projet>`), avec repli sur la
 * préférence de compte d'avant (`apercu.appareil`, `apercu.orientation`) ; un ancien `apercu.format`
 * seul est repris avec un appareil réaliste de sa famille, et sans rien, c'est
 * l'appareil lui-même qui s'adapte à sa place. Le site est dans un cadre
 * d'une autre origine : on ne lit ni son historique ni son adresse courante.
 * S'il refuse d'être encadré, rien ne le dit au navigateur — passé dix
 * secondes sans chargement, une ligne propose de l'ouvrir dans un onglet.
 */

/** L'adresse complète à partir de l'adresse de dev et d'un chemin saisi. */
export function adresseDeLApercu(base: string, chemin: string): string {
  try {
    return new URL(chemin || '/', base).toString();
  } catch {
    return base;
  }
}

const ICONE_DU_FORMAT: Record<FormatDApercu, typeof Monitor> = {
  telephone: Smartphone,
  tablette: Tablet,
  ordinateur: Monitor,
};

function nomDuFormat(format: FormatDApercu): string {
  if (format === 'telephone') return t('Format téléphone');
  if (format === 'tablette') return t('Format tablette');
  return t('Format ordinateur');
}

/** Le nom d'une famille d'appareils. Les marques s'écrivent pareil dans toutes les langues. */
function nomDeLaFamille(famille: FamilleDAppareil): string {
  switch (famille) {
    case 'iphone':
      return 'iPhone';
    case 'ipad':
      return 'iPad';
    case 'android':
    case 'android-tablette':
      return 'Android';
    case 'portable':
      return t('Portables');
    case 'ecran':
      return t('Écrans');
    default:
      return t('Adapté à la place');
  }
}

/** « 393 × 852 » : la résolution réellement montrée, côtés échangés en paysage. */
function resolutionDe(appareil: AppareilDApercu, orientation: OrientationDApercu): string | undefined {
  const { largeur, hauteur } = dimensionsDeLAppareil(appareil, orientation);
  return hauteur === null ? undefined : `${largeur} × ${hauteur}`;
}

/** Ce que dit l'infobulle d'un appareil : son nom, puis sa résolution. */
function libelleDeLAppareil(appareil: AppareilDApercu, orientation: OrientationDApercu): string {
  if (appareil.famille === 'adapte') return t('Adapté à la place');
  return [appareil.nom, resolutionDe(appareil, orientation)].filter(Boolean).join(' · ');
}

/** Téléphone et tablette se montrent comme un appareil : marge, coins ronds, ombre — quand la place le permet. */
const MARGE_D_APPAREIL = 12;

/** Sous cette largeur de page, la pastille d'environnement s'efface : l'adresse garde la place. */
const LARGEUR_MIN_DE_LA_PASTILLE = 480;

export function VoletApercu({
  adresse,
  projectId,
  onFermer,
  inerte,
}: {
  adresse: string;
  /** Le projet dont on essaie le site : l'appareil et l'orientation se retiennent pour lui. */
  projectId: string;
  onFermer: () => void;
  /** Pendant le glisser de la poignée : le site ne capte plus le pointeur, sinon le geste s'arrête au bord du cadre. */
  inerte?: boolean;
}) {
  const telephone = useTelephone();
  const hote = React.useMemo(() => {
    try {
      return new URL(adresse).host;
    } catch {
      return adresse;
    }
  }, [adresse]);
  /* LA DERNIÈRE ADRESSE SAISIE se retient PAR PROJET : c'est la seule page que
     l'on connaisse — le site est dans un cadre d'une autre origine, ses pages
     internes ne se lisent pas (voir plus haut). `cheminRetenu` écarte tout ce
     qui ferait sortir le cadre du site de développement. */
  const [cheminDuProjet, setCheminDuProjet] = usePref<unknown>(cleCheminDApercu(projectId), undefined);
  const cheminDeDepart = cheminRetenu(cheminDuProjet);
  const [chemin, setChemin] = React.useState(cheminDeDepart);
  const [saisie, setSaisie] = React.useState(cheminDeDepart);
  /* Un autre projet (ou la préférence qui n'arrive qu'après le premier rendu)
     remet la barre sur SA dernière page. */
  const projetDuChemin = React.useRef(projectId);
  React.useEffect(() => {
    if (projetDuChemin.current === projectId) return;
    projetDuChemin.current = projectId;
    setChemin(cheminDeDepart);
    setSaisie(cheminDeDepart);
  }, [projectId, cheminDeDepart]);
  const [tour, setTour] = React.useState(0);
  /* L'ancien choix de format n'est plus qu'LU : il donne un appareil de départ
     tant qu'aucun appareil n'a été choisi (`appareilDeDepart`). */
  const [ancienFormat] = usePref<unknown>(CLE_FORMAT_D_APERCU, undefined);
  /* PAR PROJET, AVEC REPLI SUR LE COMPTE : le choix du projet d'abord, sinon
     celui que le compte retenait avant, sinon l'appareil lui-même. */
  const [appareilDuCompte] = usePref<unknown>(CLE_APPAREIL_D_APERCU, undefined);
  const [orientationDuCompte] = usePref<unknown>(CLE_ORIENTATION_D_APERCU, undefined);
  const [appareilDuProjet, setPrefereAppareil] = usePref<unknown>(cleAppareilDApercu(projectId), undefined);
  const [orientationDuProjet, setPrefereOrientation] = usePref<unknown>(cleOrientationDApercu(projectId), undefined);
  const prefereAppareil = appareilParId(appareilDuProjet) ? appareilDuProjet : appareilDuCompte;
  const prefereOrientation = estOrientationDApercu(orientationDuProjet) ? orientationDuProjet : orientationDuCompte;
  const appareilActif = appareilDeDepart(prefereAppareil, ancienFormat, telephone);
  const format = appareilActif.format;
  const orientation = orientationDeLAppareil(appareilActif, prefereOrientation);
  /* L'ORIENTATION RETENUE vaut aussi pour l'appareil qu'on choisira ensuite :
     elle se lit sur la préférence, pas sur l'appareil affiché. */
  const orientationRetenue: OrientationDApercu = estOrientationDApercu(prefereOrientation) ? prefereOrientation : 'portrait';
  const { largeur: largeurNominale, hauteur: hauteurNominale } = dimensionsDeLAppareil(appareilActif, orientation);
  const [zone, setZone] = React.useState<HTMLDivElement | null>(null);
  const [place, setPlace] = React.useState({ largeur: 0, hauteur: 0 });
  const [charge, setCharge] = React.useState(false);
  const [lent, setLent] = React.useState(false);
  const cible = adresseDeLApercu(adresse, chemin);

  React.useEffect(() => {
    setCharge(false);
    setLent(false);
    const minuteur = window.setTimeout(() => setLent(true), 10_000);
    return () => window.clearTimeout(minuteur);
  }, [cible, tour]);

  /* La place de la page, mesurée : c'est elle qui décide de la réduction. */
  React.useEffect(() => {
    if (!zone) return;
    const mesurer = () => setPlace({ largeur: zone.clientWidth, hauteur: zone.clientHeight });
    mesurer();
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(zone);
    return () => observateur.disconnect();
  }, [zone]);

  /* LE CADRE D'UN APPAREIL GARDE SON RAPPORT : largeur et hauteur nominales,
     réduites ensemble (`echelleDeLAppareil`). « Adapté à la place » n'a pas de
     hauteur — comme avant, il prend toute celle de la page.

     Le rendu « appareil » (marge, coins ronds, ombre) seulement s'il reste de
     la place autour : un cadre qui remplit déjà la largeur — le téléphone vu
     sur un téléphone — s'affiche bord à bord, sans réduction pour une marge. */
  const fixe = hauteurNominale !== null;
  const echelleSansMarge = echelleDeLAppareil(place.largeur, place.hauteur, largeurNominale, hauteurNominale);
  const remplitLaLargeur = largeurNominale * echelleSansMarge >= place.largeur - 1;
  const appareil = fixe
    ? place.largeur > 0 && !remplitLaLargeur
    : format !== 'ordinateur' && place.largeur >= largeurNominale + 2 * MARGE_D_APPAREIL;
  const marge = appareil ? MARGE_D_APPAREIL : 0;
  const largeurUtile = Math.max(0, place.largeur - 2 * marge);
  const hauteurUtile = Math.max(0, place.hauteur - 2 * marge);
  // Sans hauteur propre, l'ordinateur prend toute la largeur dès qu'elle dépasse la sienne.
  const largeurDuCadre =
    !fixe && format === 'ordinateur' ? Math.max(largeurNominale, largeurUtile) : largeurNominale;
  const echelle = fixe
    ? echelleDeLAppareil(largeurUtile, hauteurUtile, largeurNominale, hauteurNominale)
    : echelleDuFormat(largeurUtile, largeurDuCadre);
  // Un appareil se centre aussi en hauteur : la place restante se répartit autour.
  const haut = fixe ? Math.max(marge, (place.hauteur - (hauteurNominale as number) * echelle) / 2) : marge;
  const hauteurDuCadre = fixe ? (hauteurNominale as number) : place.hauteur ? hauteurUtile / echelle : '100%';

  const choisirAppareil = (choisi: AppareilDApercu) => setPrefereAppareil(choisi.id);

  const aller = () => {
    const propre = saisie.trim().startsWith('/') ? saisie.trim() : `/${saisie.trim()}`;
    setSaisie(propre);
    setChemin(propre);
    setTour((n) => n + 1);
    /* L'accueil ne s'écrit que pour effacer une adresse déjà retenue ; une
       adresse que la règle refuse revient à l'accueil. */
    const retenu = cheminRetenu(propre);
    if (retenu !== '/' || cheminDuProjet !== undefined) setCheminDuProjet(retenu);
  };

  return (
    <section
      aria-label="Aperçu du site de développement"
      data-volet-apercu=""
      className={cn('flex min-h-0 min-w-0 flex-1 flex-col bg-surface', !telephone && 'p-2')}
    >
      {/* LA FENÊTRE DU NAVIGATEUR : sur ordinateur, elle flotte sur le fond du
          volet (coins ronds, liseré `--faint`, ombre très légère). Sur
          téléphone, l'aperçu prend l'écran entier, sans cadre. */}
      <div
        data-apercu-fenetre=""
        className={cn(
          'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg',
          !telephone && 'rounded-xl shadow-sm ring-1 ring-faint/25',
        )}
      >
        {/* LA BARRE DU NAVIGATEUR */}
        <div className="flex shrink-0 items-center gap-1.5 px-2 py-1.5">
          <Tooltip label={t('Recharger')}>
            <Button variant="ghost" size="icon-barre" aria-label="Recharger" onClick={() => setTour((n) => n + 1)} data-apercu-recharger="">
              {charge ? <RotateCw className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin text-muted" />}
            </Button>
          </Tooltip>
          <form
            className="flex h-8 min-w-0 flex-1 items-center rounded-full bg-raised px-3 text-[13px]"
            onSubmit={(event) => {
              event.preventDefault();
              aller();
            }}
          >
            {/* L'aperçu ne montre que l'adresse de développement : la pastille le dit toujours. */}
            {place.largeur >= LARGEUR_MIN_DE_LA_PASTILLE ? (
              <span
                data-apercu-environnement=""
                className="mr-2 shrink-0 rounded-full bg-surface px-2 py-0.5 text-[11px] leading-none text-muted"
              >
                {t('Développement')}
              </span>
            ) : null}
            <span className="shrink-0 text-faint">{hote}</span>
            <input
              value={saisie}
              onChange={(event) => setSaisie(event.target.value)}
              aria-label="Chemin de la page"
              spellCheck={false}
              data-apercu-adresse=""
              className="min-w-0 flex-1 bg-transparent text-text outline-none"
            />
          </form>
          <Tooltip label={t('Ouvrir dans un onglet')}>
            <Button variant="ghost" size="icon-barre" aria-label="Ouvrir dans un onglet" asChild>
              <a href={cible} target="_blank" rel="noreferrer">
                <ArrowUpRight className="h-4 w-4" />
              </a>
            </Button>
          </Tooltip>
          {/* Sur téléphone, c'est la flèche de l'en-tête qui referme l'aperçu. */}
          {telephone ? null : (
            <Tooltip label={t('Fermer l’aperçu')}>
              <Button variant="ghost" size="icon-barre" aria-label="Fermer l’aperçu" onClick={onFermer} data-apercu-fermer="" data-croix-du-volet="apercu">
                <X className="h-4 w-4" />
              </Button>
            </Tooltip>
          )}
          {/* LE CHOIX DE L'APPAREIL, TOUT À DROITE : chaque icône ouvre son menu
              (familles, puis modèles) ; sur téléphone, un seul bouton ouvre le
              même menu, format compris. */}
          {telephone ? (
            <BoutonDuFormat
              format={format}
              cyclique
              appareilActif={appareilActif}
              orientation={orientation}
              orientationRetenue={orientationRetenue}
              onAppareil={choisirAppareil}
              onOrientation={setPrefereOrientation}
            />
          ) : (
            <div role="radiogroup" aria-label="Format d’affichage" data-apercu-formats="" className="flex shrink-0 items-center">
              {FORMATS_D_APERCU.map((f) => (
                <BoutonDuFormat
                  key={f}
                  format={f}
                  actif={f === format}
                  appareilActif={appareilActif}
                  orientation={orientation}
                  orientationRetenue={orientationRetenue}
                  onAppareil={choisirAppareil}
                  onOrientation={setPrefereOrientation}
                />
              ))}
            </div>
          )}
        </div>

        {/* LA PAGE */}
        <div ref={setZone} className="relative min-h-0 flex-1 overflow-hidden overscroll-none bg-bg">
          {/* Le cadre garde les dimensions de son appareil ; s'il ne tient pas,
              il se réduit en entier depuis son milieu haut. Sans hauteur propre
              (« Adapté à la place »), sa hauteur est agrandie d'autant pour
              remplir la place une fois réduit. */}
          <iframe
            key={`${cible}#${tour}`}
            src={cible}
            title={t('Aperçu du site de développement')}
            onLoad={() => setCharge(true)}
            data-apercu-cadre=""
            data-apercu-format={format}
            data-apercu-modele={appareilActif.id}
            data-apercu-orientation={orientation}
            data-apercu-echelle={echelle.toFixed(3)}
            className={cn('absolute left-1/2 border-0 bg-white', appareil && 'shadow-lg', inerte && 'pointer-events-none')}
            style={{
              top: haut,
              width: largeurDuCadre,
              height: hauteurDuCadre,
              borderRadius: appareil ? 24 / echelle : 0,
              transform: `translateX(-50%) scale(${echelle})`,
              transformOrigin: 'top center',
            }}
          />
          {lent && !charge ? (
            <div className="absolute inset-x-3 bottom-3 mx-auto w-fit rounded-2xl bg-raised px-3 py-1.5 text-center text-[13px] text-muted">
              {t('Le site tarde à s’afficher ? Il refuse peut-être d’être affiché ici :')}{' '}
              <a href={cible} target="_blank" rel="noreferrer" className="text-text underline">
                {t('ouvrez-le dans un onglet')}
              </a>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/**
 * UN FORMAT DE LA BASCULE, ET SON MENU. DEUX TEMPS (demande du 15/10/2026) :
 *
 *  1. L'icône d'un format qui n'est pas affiché le MONTRE aussitôt, en
 *     « version de base » — sa largeur standard, toute la hauteur
 *     (`appareilAdapte`). Aucun menu ne s'ouvre : le menu Radix s'ouvrirait à
 *     l'appui, donc l'appui (et le clavier) est intercepté avant lui.
 *  2. Un second clic sur l'icône DÉJÀ ACTIVE ouvre le menu : les familles, puis
 *     leurs modèles avec leur résolution, et Portrait / Paysage à la suite. Le
 *     choisi s'écrit en violet, l'appareil choisi referme le menu.
 *
 * Le bouton UNIQUE du téléphone (`cyclique`) n'a pas d'icône « active » à
 * recliquer : son menu donne d'abord les trois formats — choisir l'un l'affiche
 * en version de base et referme —, puis une ligne « Appareil » (les modèles du
 * format affiché) et l'orientation.
 */
function BoutonDuFormat({
  format,
  actif,
  cyclique,
  appareilActif,
  orientation,
  orientationRetenue,
  onAppareil,
  onOrientation,
}: {
  format: FormatDApercu;
  actif?: boolean;
  cyclique?: boolean;
  appareilActif: AppareilDApercu;
  orientation: OrientationDApercu;
  orientationRetenue: OrientationDApercu;
  onAppareil: (appareil: AppareilDApercu) => void;
  onOrientation: (orientation: OrientationDApercu) => void;
}) {
  const [ouvert, setOuvert] = React.useState(false);
  const Icone = ICONE_DU_FORMAT[format];
  /* L'infobulle de l'icône active dit l'appareil : son nom et sa résolution. */
  const libelle =
    cyclique || actif
      ? `${nomDuFormat(format)} — ${libelleDeLAppareil(appareilActif, orientation)}`
      : nomDuFormat(format);
  // Le repère d'accessibilité reste le même dans les cinq langues (`verif-langues.mjs`).
  const repere = `Format ${format}`;

  const choisir = (appareil: AppareilDApercu) => {
    onAppareil(appareil);
    setOuvert(false);
  };
  const pivoter = (suivante: OrientationDApercu) => {
    onOrientation(suivante);
    setOuvert(false);
  };

  /* LES MODÈLES D'UN FORMAT, une ligne chacun : le nom à gauche, la résolution
     à droite, la coche sur l'appareil actif. Sur téléphone, le menu est un
     tiroir : les lignes ont la hauteur d'un doigt (`py-2.5`). */
  const ligneDeModele = (appareil: AppareilDApercu) => (
    <ActionTiroir
      key={appareil.id}
      actif={appareil.id === appareilActif.id}
      valeur={resolutionDe(appareil, orientationRetenue)}
      onClick={() => choisir(appareil)}
      className="py-2.5 sm:py-2"
      data-apercu-modele-choix={appareil.id}
    >
      {appareil.famille === 'adapte' ? t('Adapté à la place') : appareil.nom}
    </ActionTiroir>
  );

  /* PORTRAIT / PAYSAGE : la rotation vit dans le menu, jamais à côté des icônes. */
  const lignesDOrientation = (
    <GroupeTiroir titre={t('Orientation')}>
      {(['portrait', 'paysage'] as const).map((valeur) => (
        <ActionTiroir
          key={valeur}
          actif={orientationRetenue === valeur}
          onClick={() => pivoter(valeur)}
          className="py-2.5 sm:py-2"
          data-apercu-orientation-choix={valeur}
        >
          {valeur === 'portrait' ? t('Portrait') : t('Paysage')}
        </ActionTiroir>
      ))}
    </GroupeTiroir>
  );

  /* Un format, en deux niveaux : famille → modèles (ordinateur) ; sur
     téléphone, ses modèles groupés par famille sous le format. */
  const familles = (f: FormatDApercu) => famillesDuFormat(f);
  const modelesDeLaFamille = (f: FormatDApercu, famille: FamilleDAppareil) =>
    appareilsDuFormat(f).filter((a) => a.famille === famille);

  const contenuDesFamilles = (f: FormatDApercu) => (
    <>
      {familles(f).map((famille) => (
        <SousMenuTiroir
          key={famille}
          titre={nomDeLaFamille(famille)}
          valeur={modelesDeLaFamille(f, famille).find((a) => a.id === appareilActif.id)?.nom}
          data-apercu-famille={famille}
        >
          {modelesDeLaFamille(f, famille).map(ligneDeModele)}
        </SousMenuTiroir>
      ))}
      {ligneDeModele(appareilAdapte(f))}
    </>
  );

  return (
    <DropdownMenu open={ouvert} onOpenChange={setOuvert}>
      {/* L'INFOBULLE EST UN `title` : la couche des infobulles le rend dès
          l'appui. Une `Tooltip` serait restée ouverte sous le menu et aurait
          pris le premier Échap à sa place. */}
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-barre"
          aria-label={repere}
          aria-haspopup="menu"
          title={libelle}
          /* PREMIER CLIC : la version de base, sans menu. `preventDefault` ici
             coupe le gestionnaire d'appui de Radix (qui ouvre le menu) ; le
             clavier suit la même règle. Une icône déjà active laisse faire
             Radix : son menu s'ouvre. */
          onPointerDown={(event) => {
            if (cyclique || actif || event.button !== 0) return;
            event.preventDefault();
            choisir(appareilAdapte(format));
          }}
          onKeyDown={(event) => {
            if (cyclique || actif) return;
            if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
              event.preventDefault();
              choisir(appareilAdapte(format));
            }
          }}
          {...(cyclique ? {} : { role: 'radio', 'aria-checked': !!actif })}
          data-apercu-appareil={format}
          data-actif={actif ? '' : undefined}
          className={cn('shrink-0', actif || cyclique ? 'text-teinte hover:text-teinte' : 'text-muted')}
        >
          <Icone className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" data-apercu-menu={cyclique ? 'unique' : format} className="sm:min-w-[220px]">
        {cyclique ? (
          <>
            {/* LES TROIS FORMATS : un choix l'affiche en version de base et referme. */}
            {FORMATS_D_APERCU.map((f) => {
              const IconeDuFormat = ICONE_DU_FORMAT[f];
              return (
                <ActionTiroir
                  key={f}
                  icone={<IconeDuFormat className="h-4 w-4" />}
                  actif={f === appareilActif.format}
                  onClick={() => choisir(appareilAdapte(f))}
                  className="py-2.5 sm:py-2"
                  data-apercu-format-choix={f}
                >
                  {nomDuFormat(f)}
                </ActionTiroir>
              );
            })}
            <DropdownMenuSeparator />
            {/* L'APPAREIL ET L'ORIENTATION, À PART : ceux du format affiché. */}
            <SousMenuTiroir
              titre={t('Appareil')}
              valeur={libelleDeLAppareil(appareilActif, orientation)}
              data-apercu-appareil-choix=""
            >
              {familles(appareilActif.format).map((famille) => (
                <GroupeTiroir key={famille} titre={nomDeLaFamille(famille)}>
                  {modelesDeLaFamille(appareilActif.format, famille).map(ligneDeModele)}
                </GroupeTiroir>
              ))}
              {ligneDeModele(appareilAdapte(appareilActif.format))}
            </SousMenuTiroir>
            {appareilActif.format !== 'ordinateur' ? (
              <>
                <DropdownMenuSeparator />
                {lignesDOrientation}
              </>
            ) : null}
          </>
        ) : (
          <>
            {contenuDesFamilles(format)}
            {format !== 'ordinateur' ? (
              <>
                <DropdownMenuSeparator />
                {lignesDOrientation}
              </>
            ) : null}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
