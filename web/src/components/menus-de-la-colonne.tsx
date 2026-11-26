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
import { ChevronDesVoisins, type VoisinsDuCran } from '@/components/voisins-du-fil';
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

/* ------------------------------------------------------------------ */
/* « Services » : la liste déroulante des services                      */
/* ------------------------------------------------------------------ */

/** Un service de la colonne : sa clé, son icône, son libellé, son groupe (« Créer » ou « Suivre »). */
export interface ServiceDuMenu {
  cle: string;
  Icone: typeof Code2;
  cleLibelle: string;
  groupe: 'creer' | 'suivre';
  /** Le service qu'il faut avoir ouvert pour voir celui-ci. */
  requis?: string;
}

/**
 * LES SERVICES DE LA COLONNE, DANS L'ORDRE (14/11/2026) : en bas de la colonne et dans la fenêtre des services
 * (`services-de-la-colonne.tsx`). Le bouton « Services » de la tête de colonne n'existe plus.
 */
export const CLES_SERVICES_DU_MENU: ServiceDuMenu[] = [
  { cle: 'plaquettes', Icone: Palette, cleLibelle: 'Charte graphique', groupe: 'creer' },
  { cle: 'communication2', Icone: Megaphone, cleLibelle: 'Communication', groupe: 'creer' },
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
 * UN CRAN DU FIL D'UNE PAGE DE SERVICE (carte « Fil d'Ariane et Communication repensés », 20/11/2026, capture #c3d8) :
 * « les fils d'Ariane doivent juste avoir le nom de chaque section ; au survol, le chevron s'affiche pour avoir la liste
 * des éléments similaires ». Le NOM se clique pour aller à la section ; le chevron (`ChevronDesVoisins`, au survol
 * seulement) ouvre la liste des voisins : les autres services, ou les autres projets. Aucune icône.
 */
function CranDeLaPageDeService({
  libelle,
  repere,
  dernier,
  onOuvrir,
  voisins,
}: {
  libelle: string;
  repere: string;
  /** Le dernier cran de l'accueil (en texte plein) ; dans une sous-page, il redevient un cran d'avant. */
  dernier: boolean;
  onOuvrir: () => void;
  voisins: VoisinsDuCran;
}) {
  return (
    <span className="group/cran flex min-w-0 max-w-[240px] shrink-0 items-center" data-cran-a-menu={repere}>
      <button
        type="button"
        onClick={onOuvrir}
        className={cn(
          'min-w-0 truncate rounded-md px-1 py-0.5 text-left text-[14px] transition-colors hover:text-text',
          dernier ? 'font-medium text-text [[data-sous-page]_&]:font-normal [[data-sous-page]_&]:text-muted' : 'text-muted',
        )}
        data-cran-du-fil
        data-nom-du-cran={repere}
        aria-current={dernier ? 'page' : undefined}
      >
        {libelle}
      </button>
      <ChevronDesVoisins voisins={voisins} onOuvrir={onOuvrir} />
    </span>
  );
}

/**
 * LES PREMIERS CRANS DE TOUTE PAGE DE SERVICE : « Service / Projet », puis la fiche que le service écrit
 * (`SuiteDuFil`). Décision de l'utilisateur du 20/11/2026 : « on doit avoir le service, ensuite le projet, puis la fiche
 * détail, et ça pour tous les services » — plus jamais le projet avant le service, ni deux fois. Le SERVICE mène à son
 * accueil sur tous les projets ; son chevron liste les autres services (rangés Créer, Suivre). Le PROJET n'existe que si
 * la page est limitée à un projet : il mène à l'accueil du service pour ce projet ; son chevron liste « Tous les projets »
 * en tête, puis les projets.
 */
export function FilDesPagesDeService({
  portee,
  onPortee,
  service,
  onService,
  onTousLesProjets,
}: {
  /** L'identifiant du projet, ou `TOUS_LES_PROJETS`. */
  portee: string;
  onPortee: (projectId: string) => void;
  service: string;
  onService: (cle: string) => void;
  /**
   * REVENIR À « TOUS LES PROJETS » (le nom du service, ou le premier choix du chevron du projet) : l'accueil du service,
   * sur tous les projets. Par défaut, la portée seule change.
   */
  onTousLesProjets?: () => void;
}) {
  /* Le retour à l'accueil du service, tenu par la page (ses sous-pages l'écrivent). */
  const suite = useSuiteDuFilFournie();
  const projets = useProjetsAViser();
  const ouverts = new Set(useServicesOuverts().map((s) => s.cle as string));
  const services = CLES_SERVICES_DU_MENU.filter((s) => ouverts.has(s.requis ?? s.cle));
  const projet = portee ? (projets.find((p) => p.id === portee) ?? null) : null;
  const leService = services.find((s) => s.cle === service) ?? CLES_SERVICES_DU_MENU.find((s) => s.cle === service) ?? null;
  const nomDuService = leService ? t(leService.cleLibelle) : service;
  const allerALAccueil = () => suite?.retour.current?.();
  const versTousLesProjets = () => (onTousLesProjets ? onTousLesProjets() : onPortee(TOUS_LES_PROJETS));
  return (
    <>
      <CranDeLaPageDeService
        repere="service-de-la-page"
        libelle={nomDuService}
        dernier={!projet}
        /* Le service, sur tous les projets. */
        onOuvrir={() => {
          allerALAccueil();
          if (portee !== TOUS_LES_PROJETS) versTousLesProjets();
        }}
        voisins={{
          nom: nomDuService,
          valeur: service,
          titre: t('Services'),
          repere: 'service-de-la-page',
          options: services.map((s) => ({ valeur: s.cle, libelle: t(s.cleLibelle), groupe: s.groupe === 'creer' ? t('Créer') : t('Suivre') })),
          onChoisir: (cle) => (cle === service ? allerALAccueil() : onService(cle)),
        }}
      />
      {projet ? (
        <>
          <span className="shrink-0 text-faint" aria-hidden data-separateur-du-fil>
            /
          </span>
          <CranDeLaPageDeService
            repere="portee-du-service"
            libelle={projet.name}
            dernier
            onOuvrir={allerALAccueil}
            voisins={{
              nom: projet.name,
              valeur: projet.id,
              titre: t('Projets'),
              repere: 'portee-du-service',
              options: [
                { valeur: '__tous__', libelle: t('Tous les projets'), groupe: t('Projets') },
                ...projets.map((p) => ({ valeur: p.id, libelle: p.name, groupe: t('Projets') })),
              ],
              onChoisir: (id) => (id === '__tous__' ? versTousLesProjets() : onPortee(id)),
            }}
          />
        </>
      ) : null}
    </>
  );
}
