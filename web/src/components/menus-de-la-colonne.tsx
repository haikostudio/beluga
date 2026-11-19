/*
 * LES DEUX MENUS DE LA TÊTE DE COLONNE (décisions de l'utilisateur du 14/11/2026, maquettes #07c5 et #2e02).
 *
 *  - « Nouvel agent » demande d'abord le TYPE d'agent (Programmation, Studio, Campagne, Marketing, Charte graphique,
 *    Surveillance, Tâche récurrente), puis, à côté, le PROJET (« Pour quel projet ? »). Le choix ouvre aussitôt
 *    l'onglet dans ce projet, l'agent à gauche et ses données à droite. La dernière ligne, « Une autre
 *    entreprise… », crée un projet LÉGER au nom de l'entreprise (sans code, sans adresse publique, sans publication).
 *  - Les SERVICES ont quitté la tête de colonne (14/11/2026) : ils vivent en bas (`services-de-la-colonne.tsx`), et
 *    leur liste commune est ici (`CLES_SERVICES_DU_MENU`). Chaque entrée ouvre la page centrale du service, qui
 *    montre TOUS les projets et se filtre par projet.
 *
 * « Nouvel artefact » n'a PLUS DE FOND (15/11/2026, capture #35e2) : la tenue d'une ligne de la colonne, comme
 * « Services » (texte plein, fond au survol et menu ouvert seulement).
 */
import * as React from 'react';
import {
  Activity,
  ShieldCheck,
  BarChart3,
  CalendarDays,
  ChevronDown,
  Clapperboard,
  Code2,
  HardDriveDownload,
  Megaphone,
  Palette,
  Repeat,
  SquarePen,
  UsersRound,
  Building2,
  Search,
} from '@/components/ui/icones';
import { ordonnerParDerniereActivite, projetsQuiCorrespondent, type Project } from '@beluga/shared';
import { PastilleProjet } from '@/components/pastille-projet';
import { useSuiteDuFilFournie } from '@/components/entete-de-zone';
import { useServicesOuverts } from '@/components/services';
import {
  CLASSE_MENU_PAR_DESSUS_DU_BOUTON,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  HAUTEUR_DE_CONTROLE,
  ListeDeroulante,
  PromptDialog,
} from '@/components/ui';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Le projet visé : un projet existant, ou une entreprise extérieure    */
/* ------------------------------------------------------------------ */

export type CibleDeCreation = { projectId: string } | { entreprise: string };

/**
 * Les projets que l'on peut viser : ni archivés, ni simples supports de marque, du plus récemment actif au plus
 * ancien (la colonne de gauche garde son ordre manuel). L'ordre est FIGÉ à l'ouverture du menu : une carte qui
 * bouge pendant qu'on choisit ne fait pas sauter la liste sous le doigt.
 */
function useProjetsAViser(): Pick<Project, 'id' | 'name' | 'favicon'>[] {
  const projets = useApp().projects;
  const ordreFige = React.useRef<string[] | null>(null);
  return React.useMemo(() => {
    const vises = projets.filter((p) => !p.archived && !p.marqueSansDepot);
    if (!ordreFige.current && vises.length) ordreFige.current = ordonnerParDerniereActivite(vises).map((p) => p.id);
    const ordre = ordreFige.current ?? [];
    const place = (id: string) => (ordre.includes(id) ? ordre.indexOf(id) : ordre.length);
    return [...vises].sort((a, b) => place(a.id) - place(b.id));
  }, [projets]);
}

/**
 * « POUR QUEL PROJET ? » : la liste des projets, puis « Une autre entreprise… ». Partagée par le menu « Nouvel
 * agent » et par le bouton « Nouveau » des pages centrales des services. `sansEntreprise` retire la dernière ligne
 * (une programmation vise toujours un vrai projet).
 */
export function EntreesPourQuelProjet({
  onChoisir,
  onAutreEntreprise,
  repere,
}: {
  onChoisir: (projectId: string) => void;
  onAutreEntreprise?: () => void;
  repere?: string;
}) {
  const tous = useProjetsAViser();
  /* LA RECHERCHE EN TÊTE (14/11/2026, maquette 3) : elle filtre au fil de la frappe, Entrée choisit le premier. Le
     champ garde ses touches (le menu ferait sinon sa recherche par lettre), sauf Échap, Tab et les flèches. */
  const [saisie, setSaisie] = React.useState('');
  const projets = projetsQuiCorrespondent(tous, saisie);
  const champ = React.useRef<HTMLInputElement | null>(null);
  React.useEffect(() => {
    const minuterie = window.setTimeout(() => champ.current?.focus(), 30);
    return () => window.clearTimeout(minuterie);
  }, []);
  return (
    <>
      <DropdownMenuLabel>{t('Pour quel projet ?')}</DropdownMenuLabel>
      <label className={cn('mx-1 mb-1 flex items-center gap-2 rounded-lg bg-raised px-2.5', HAUTEUR_DE_CONTROLE)}>
        <Search className="h-3.5 w-3.5 shrink-0 text-faint" />
        <input
          ref={champ}
          type="search"
          value={saisie}
          onChange={(event) => setSaisie(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (!projets[0]) return;
              onChoisir(projets[0].id);
              /* Le menu se referme comme après un clic sur la ligne. */
              event.currentTarget.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              return;
            }
            if (!['Escape', 'Tab', 'ArrowDown', 'ArrowUp'].includes(event.key)) event.stopPropagation();
          }}
          placeholder={t('Rechercher un projet…')}
          aria-label="Rechercher un projet"
          data-recherche-projet-a-viser={repere}
          className="min-w-0 flex-1 bg-transparent text-[16px] text-text outline-none placeholder:text-faint sm:text-[13px] [&::-webkit-search-cancel-button]:hidden"
        />
      </label>
      {saisie.trim() && !projets.length ? <p className="px-2.5 py-1.5 text-[12.5px] text-muted" data-aucun-projet-trouve>{t('Aucun projet ne correspond.')}</p> : null}
      {projets.map((p) => (
        <DropdownMenuItem key={p.id} className="gap-2.5" data-projet-a-viser={p.id} data-pour-le-type={repere} onSelect={() => onChoisir(p.id)}>
          <PastilleProjet project={p} taille={18} />
          <span className="min-w-0 flex-1 truncate">{p.name}</span>
        </DropdownMenuItem>
      ))}
      {onAutreEntreprise ? (
        <>
          {projets.length ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem className="gap-2.5 text-muted" data-autre-entreprise={repere} onSelect={onAutreEntreprise}>
            <Building2 className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t('Une autre entreprise…')}</span>
          </DropdownMenuItem>
        </>
      ) : null}
    </>
  );
}

/** La petite fenêtre qui demande l'entreprise extérieure : son site, ou son nom. */
export function DemandeDEntreprise({ ouvert, onFermer, onValider }: { ouvert: boolean; onFermer: () => void; onValider: (saisie: string) => void }) {
  return (
    <PromptDialog
      open={ouvert}
      title={t('Une autre entreprise')}
      description={t('Son site ou son nom : un projet léger se crée à son nom, sans code ni mise en ligne.')}
      placeholder={t('Adresse du site, ou nom de l’entreprise')}
      confirmLabel={t('Créer')}
      onClose={onFermer}
      onConfirm={(valeur) => {
        const v = valeur.trim();
        if (!v) return;
        onFermer();
        onValider(v);
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* « Nouvel agent » : le type, puis le projet                           */
/* ------------------------------------------------------------------ */

export type TypeDAgent = 'programmation' | 'studio' | 'campagne' | 'marketing' | 'charte' | 'surveillance' | 'recurrente';

const CLES_TYPES_D_AGENT: { type: TypeDAgent; Icone: typeof Code2; cleLibelle: string; service?: string }[] = [
  { type: 'programmation', Icone: Code2, cleLibelle: 'Programmation' },
  { type: 'studio', Icone: Clapperboard, cleLibelle: 'Studio', service: 'studio' },
  { type: 'campagne', Icone: Megaphone, cleLibelle: 'Campagne', service: 'communication2' },
  { type: 'charte', Icone: Palette, cleLibelle: 'Charte graphique', service: 'plaquettes' },
  { type: 'surveillance', Icone: Activity, cleLibelle: 'Surveillance', service: 'surveillance' },
  { type: 'recurrente', Icone: Repeat, cleLibelle: 'Tâche récurrente', service: 'taches-recurrentes' },
];

export function MenuNouvelAgent({
  bandeSeule,
  onCreer,
  onOuvert,
}: {
  bandeSeule: boolean;
  onCreer: (type: TypeDAgent, cible: CibleDeCreation) => void;
  /** Appelé quand on choisit : la colonne en tiroir (téléphone) se referme. */
  onOuvert?: () => void;
}) {
  const ouverts = new Set(useServicesOuverts().map((s) => s.cle as string));
  const types = CLES_TYPES_D_AGENT.filter((x) => !x.service || ouverts.has(x.service));
  const [entreprisePour, setEntreprisePour] = React.useState<TypeDAgent | null>(null);
  const choisir = (type: TypeDAgent, cible: CibleDeCreation) => {
    onOuvert?.();
    onCreer(type, cible);
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-ligne-nouvel-agent
            title={bandeSeule ? t('Nouvel artefact') : undefined}
            className={cn(
              'flex h-[43px] sm:h-9 w-full min-w-0 items-center gap-2.5 rounded-lg text-left text-[14px] font-medium text-text transition-colors hover:bg-raised data-[state=open]:bg-raised',
              bandeSeule ? 'justify-center px-0' : 'px-2.5',
            )}
          >
            <SquarePen className="h-4 w-4 shrink-0" />
            <span className={cn('min-w-0 flex-1 truncate', bandeSeule && 'sr-only')}>{t('Nouvel artefact')}</span>
            {bandeSeule ? null : <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={bandeSeule ? 4 : 0}
          className={bandeSeule ? 'sm:w-[240px]' : CLASSE_MENU_PAR_DESSUS_DU_BOUTON}
          data-menu-nouvel-agent
        >
          <DropdownMenuLabel>{t('Quel agent ?')}</DropdownMenuLabel>
          {types.map(({ type, Icone, cleLibelle }) => (
            <DropdownMenuSub key={type}>
              <DropdownMenuSubTrigger data-type-d-agent={type}>
                <Icone className="h-4 w-4 shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate">{t(cleLibelle)}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="sm:w-[240px]" data-projets-du-type={type}>
                <EntreesPourQuelProjet
                  repere={type}
                  onChoisir={(projectId) => choisir(type, { projectId })}
                  onAutreEntreprise={type === 'programmation' ? undefined : () => setEntreprisePour(type)}
                />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DemandeDEntreprise
        ouvert={!!entreprisePour}
        onFermer={() => setEntreprisePour(null)}
        onValider={(saisie) => {
          if (entreprisePour) choisir(entreprisePour, { entreprise: saisie });
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* « Services » : la liste déroulante des services                      */
/* ------------------------------------------------------------------ */

/** L'entrée « Calendrier » n'est pas une vue : c'est la page du calendrier général, toutes campagnes réunies. */
export const CLE_CALENDRIER_GENERAL = 'calendrier';

/** Un service de la colonne : sa clé, son icône, son libellé, son groupe (« Créer » ou « Suivre »). */
export interface ServiceDuMenu {
  cle: string;
  Icone: typeof Code2;
  cleLibelle: string;
  groupe: 'creer' | 'suivre';
  /** Le service qu'il faut avoir ouvert pour voir celui-ci (le Calendrier suit Communication). */
  requis?: string;
}

/**
 * LES SERVICES DE LA COLONNE, DANS L'ORDRE (14/11/2026) : en bas de la colonne et dans la fenêtre des services
 * (`services-de-la-colonne.tsx`). Le bouton « Services » de la tête de colonne n'existe plus.
 */
export const CLES_SERVICES_DU_MENU: ServiceDuMenu[] = [
  { cle: 'plaquettes', Icone: Palette, cleLibelle: 'Charte graphique', groupe: 'creer' },
  { cle: 'communication2', Icone: Megaphone, cleLibelle: 'Communication', groupe: 'creer' },
  { cle: CLE_CALENDRIER_GENERAL, Icone: CalendarDays, cleLibelle: 'Calendrier', groupe: 'creer', requis: 'communication2' },
  { cle: 'studio', Icone: Clapperboard, cleLibelle: 'Studio', groupe: 'creer' },
  { cle: 'statistiques', Icone: BarChart3, cleLibelle: 'Statistiques', groupe: 'suivre' },
  { cle: 'espace-client', Icone: UsersRound, cleLibelle: 'Messagerie', groupe: 'suivre' },
  { cle: 'backups', Icone: HardDriveDownload, cleLibelle: 'Backup', groupe: 'suivre' },
  { cle: 'surveillance', Icone: Activity, cleLibelle: 'Surveillance', groupe: 'suivre' },
  { cle: 'securite', Icone: ShieldCheck, cleLibelle: 'Sécurité', groupe: 'suivre' },
  { cle: 'taches-recurrentes', Icone: Repeat, cleLibelle: 'Tâches planifiées', groupe: 'suivre' },
];

/* ------------------------------------------------------------------ */
/* Le filtre de projet d'une page centrale                              */
/* ------------------------------------------------------------------ */

/** La valeur « tous les projets » du filtre. */
export const TOUS_LES_PROJETS = '';

/**
 * LE FILTRE D'UNE PAGE CENTRALE (14/11/2026) : la page ouverte depuis « Services » montre tous les projets ; ce choix
 * la limite à un seul. La liste déroulante commune, jamais un `<select>`.
 */
export function FiltreDuProjetDeLaPage({
  valeur,
  onChoisir,
  nombres,
}: {
  valeur: string;
  onChoisir: (projectId: string) => void;
  /**
   * LE NOMBRE D'ÉLÉMENTS DE CHAQUE PROJET (le calendrier, 14/11/2026 : « supprime la barre avec les projets et déplace
   * le nombre dans la liste de filtre à droite ») : « Tous les projets » porte le total, les projets qui en ont passent
   * en tête, rangés par nombre ; les autres suivent, sans nombre.
   */
  nombres?: ReadonlyMap<string, number>;
}) {
  const projets = useProjetsAViser();
  const compte = (n: number) => <span className="text-[12px] tabular-nums text-faint" data-nombre-du-filtre>{n}</span>;
  const avec = nombres ? projets.filter((p) => (nombres.get(p.id) ?? 0) > 0).sort((a, b) => (nombres.get(b.id) ?? 0) - (nombres.get(a.id) ?? 0)) : projets;
  const sans = nombres ? projets.filter((p) => !(nombres.get(p.id) ?? 0)) : [];
  const total = nombres ? [...nombres.values()].reduce((a, b) => a + b, 0) : 0;
  return (
    <ListeDeroulante
      valeur={valeur}
      seuilRecherche={0}
      options={[
        { valeur: TOUS_LES_PROJETS, libelle: t('Tous les projets'), ...(nombres ? { fin: compte(total) } : {}) },
        ...avec.map((p) => ({
          valeur: p.id,
          libelle: p.name,
          icone: <PastilleProjet project={p} taille={16} />,
          ...(nombres ? { fin: compte(nombres.get(p.id) ?? 0) } : {}),
        })),
        ...sans.map((p) => ({ valeur: p.id, libelle: p.name, icone: <PastilleProjet project={p} taille={16} />, groupe: t('Sans publication ce mois-ci') })),
      ]}
      onChoisir={onChoisir}
      titre={t('Projet')}
      repere="filtre-projet-de-la-page"
      className="w-full"
    />
  );
}

/* ------------------------------------------------------------------ */
/* Le fil d'Ariane des pages de service                                 */
/* ------------------------------------------------------------------ */

/**
 * UN CRAN DU FIL QUI OUVRE UNE LISTE (14/11/2026, « je dois de nouveau avoir en haut le chevron qui permet de switcher
 * d'outil, projet, campagne ») : son icône, son nom, un petit chevron ; la liste commune (`ListeDeroulante`) s'ancre
 * dessous. Le cran choisi est coché ; un clic sur lui-même (`onChoisir` avec la valeur courante) remonte à sa page.
 */
export function CranAMenu({
  icone,
  libelle,
  valeur,
  options,
  onChoisir,
  titre,
  repere,
  dernier = false,
  seuilRecherche = 8,
  onSection,
}: {
  icone?: React.ReactNode;
  libelle: string;
  valeur: string;
  options: React.ComponentProps<typeof ListeDeroulante>['options'];
  onChoisir: (valeur: string) => void;
  titre: string;
  repere: string;
  dernier?: boolean;
  seuilRecherche?: number;
  /**
   * LE DOUBLE CLIC MÈNE À LA SECTION DU CRAN (carte « Fil d'Ariane et corrections sécurité », 16/11/2026) : la liste
   * ouverte par le premier clic se referme, et la page revient à l'accueil du cran. Par défaut : choisir sa valeur
   * courante, qui « remonte à sa page ». Le clavier garde la même issue par la liste (sa valeur cochée).
   */
  onSection?: () => void;
}) {
  const allerALaSection = onSection ?? (() => onChoisir(valeur));
  return (
    <ListeDeroulante
      valeur={valeur}
      options={options}
      onChoisir={onChoisir}
      titre={titre}
      repere={repere}
      seuilRecherche={seuilRecherche}
      declencheur={(ouvrir, _libelle, fermer) => (
        <button
          type="button"
          /* Le second clic d'un double clic ne rouvre pas la liste : le double clic la referme et va à la section. */
          onClick={(e) => (e.detail >= 2 ? undefined : ouvrir(e))}
          onDoubleClick={() => {
            fermer();
            allerALaSection();
          }}
          className={cn(
            /* LES PREMIERS CRANS GARDENT LEUR LARGEUR (15/11/2026) : c'est le titre long d'une demande, au bout du fil, qui
               se replie — plus « ETSi… / Messag… ». Borné à 220 px pour un nom de projet très long. */
            'inline-flex h-8 min-w-0 max-w-[220px] shrink-0 items-center gap-1.5 rounded-lg px-2 text-[14px] transition-colors hover:bg-raised hover:text-text',
            /* Le service est le dernier cran sur son accueil ; dans une sous-page, un cran d'avant parmi d'autres. */
            dernier ? 'font-medium text-text [[data-sous-page]_&]:font-normal [[data-sous-page]_&]:text-muted' : 'text-muted',
          )}
          data-cran-a-menu={repere}
          aria-haspopup="listbox"
        >
          {icone ? <span className="flex shrink-0 items-center [&>svg]:h-4 [&>svg]:w-4">{icone}</span> : null}
          <span className="min-w-0 truncate">{libelle}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
        </button>
      )}
    />
  );
}

/**
 * LES DEUX PREMIERS CRANS DE TOUTE PAGE DE SERVICE : la PORTÉE (un projet, ou « Tous les projets ») — elle remplace le
 * filtre de projet de la rangée (DEC-524) — puis le SERVICE, dont la liste est rangée comme le menu « Services »
 * (Créer, Suivre). Choisir le service ouvert ramène à son accueil.
 */
export function FilDesPagesDeService({
  portee,
  onPortee,
  service,
  onService,
  sansPortee = false,
}: {
  /** Le service tient lui-même son filtre de projet, avec ses nombres (le calendrier général) : pas de cran de portée. */
  sansPortee?: boolean;
  /** L'identifiant du projet, ou `TOUS_LES_PROJETS`. */
  portee: string;
  onPortee: (projectId: string) => void;
  service: string;
  onService: (cle: string) => void;
}) {
  /* Le retour à l'accueil du service, tenu par la page (ses sous-pages l'écrivent). */
  const suite = useSuiteDuFilFournie();
  const projets = useProjetsAViser();
  const ouverts = new Set(useServicesOuverts().map((s) => s.cle as string));
  const services = CLES_SERVICES_DU_MENU.filter((s) => ouverts.has(s.requis ?? s.cle));
  const projet = projets.find((p) => p.id === portee) ?? null;
  const leService = services.find((s) => s.cle === service) ?? CLES_SERVICES_DU_MENU.find((s) => s.cle === service) ?? null;
  const IconeDuService = leService?.Icone;
  return (
    <>
      {sansPortee ? null : (
        <>
      <CranAMenu
        repere="portee-du-service"
        titre={t('Projet')}
        icone={projet ? <PastilleProjet project={projet} taille={16} /> : <Building2 />}
        libelle={projet ? projet.name : t('Tous les projets')}
        valeur={portee}
        seuilRecherche={0}
        options={[
          { valeur: TOUS_LES_PROJETS, libelle: t('Tous les projets'), icone: <Building2 className="h-4 w-4" /> },
          ...projets.map((p) => ({ valeur: p.id, libelle: p.name, icone: <PastilleProjet project={p} taille={16} /> })),
        ]}
        onChoisir={onPortee}
        onSection={() => suite?.retour.current?.()}
      />
      <span className="shrink-0 text-faint" aria-hidden data-separateur-du-fil>
        /
      </span>
        </>
      )}
      <CranAMenu
        repere="service-de-la-page"
        titre={t('Services')}
        dernier
        icone={IconeDuService ? <IconeDuService /> : undefined}
        libelle={leService ? t(leService.cleLibelle) : service}
        valeur={service}
        seuilRecherche={0}
        options={services.map((s) => ({
          valeur: s.cle,
          libelle: t(s.cleLibelle),
          icone: <s.Icone className="h-4 w-4" />,
          groupe: s.groupe === 'creer' ? t('Créer') : t('Suivre'),
        }))}
        onChoisir={(cle) => (cle === service ? suite?.retour.current?.() : onService(cle))}
      />
    </>
  );
}
