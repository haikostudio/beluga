/*
 * LE BAS DE LA COLONNE : UNE LIGNE « SERVICES », UNE RECHERCHE, DES PUNAISES (carte « Services homogènes et centrés »,
 * 14/11/2026, piste D retenue par l'utilisateur : « un bouton Services qui ouvre la liste dans le dropdown plutôt que
 * lister avec le bouton plus », puis « j'aime l'idée de pouvoir fixer certains services avec un bouton »).
 *
 *  - Plus de raccourcis fixes ni de « Voir plus » : une seule ligne « Services », juste au-dessus du pied, hors de la zone
 *    qui défile. Elle ouvre, vers le haut, TOUS les services : un champ « Rechercher un service… » en tête (prêt à la
 *    frappe ; Entrée ouvre le premier trouvé), puis Créer, Suivre, et les deux services communs — Coffre-fort et
 *    Mémoire, qui ont quitté le menu à trois points du haut —, puis « Tous les services… » (la fenêtre des cartes).
 *  - CHAQUE ENTRÉE PORTE UNE PUNAISE : un service épinglé s'affiche juste au-dessus de « Services », dans l'ordre de la
 *    liste, et s'ouvre en un clic. Au départ, rien n'est épinglé ; les épingles suivent le compte d'un appareil à
 *    l'autre (`colonne.servicesEpingles`).
 *  - Le point violet d'une alerte (Messagerie…) reste sur l'entrée épinglée, et se reporte sur « Services » quand le
 *    service qui alerte n'est pas épinglé.
 *
 * Un compte tiers ne voit que ses services (`useServicesOuverts`). Colonne réduite : les icônes seules.
 * Repères : `data-services-du-bas`, `data-service-du-bas=<clé>` (une entrée épinglée), `data-bouton-services` (et
 * `data-voir-plus-services`, gardé pour les contrôles), `data-menu-des-services`, `data-recherche-de-services`,
 * `data-service-de-la-colonne=<clé>`, `data-punaise-de-service=<clé>`, `data-tous-les-services`,
 * `data-fenetre-des-services`, `data-carte-service=<clé>`, `data-etat-de-service`.
 */
import * as React from 'react';
import { compterEnPanne, minusculesSansAccents } from '@beluga/shared';
import { ChevronDown, ChevronUp, LayoutGrid, Pin, PinOff, Search } from '@/components/ui/icones';
import { CLES_SERVICES_DU_MENU, type ServiceDuMenu } from '@/components/menus-de-la-colonne';
import { useAlerteDuService, useServicesOuverts } from '@/components/services';
import {
  CLASSE_MENU_PAR_DESSUS_DU_BOUTON,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HAUTEUR_DE_CONTROLE,
} from '@/components/ui';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { usePref } from '@/lib/prefs';
import { useApp } from '@/lib/use-app';
import { useTelephone } from '@/lib/telephone';
import { cn } from '@/lib/utils';

/** La préférence des services épinglés au-dessus de « Services » : leurs clés, partagées entre appareils. */
export const CLE_DES_SERVICES_EPINGLES = 'colonne.servicesEpingles';

/** Les services que ce compte peut ouvrir, dans l'ordre du menu, avec leur groupe. */
function useServicesVisibles(): ServiceDuMenu[] {
  const ouverts = new Set(useServicesOuverts().map((s) => s.cle as string));
  return CLES_SERVICES_DU_MENU.filter((s) => ouverts.has(s.requis ?? s.cle));
}

/** Les lettres de `saisie` se suivent-elles dans `texte`, dans l'ordre (pas forcément collées) ? */
function lettresDansLOrdre(texte: string, saisie: string): boolean {
  const lettres = saisie.replace(/\s+/g, '');
  if (!lettres) return false;
  let rang = 0;
  for (const lettre of texte) if (rang < lettres.length && lettre === lettres[rang]) rang += 1;
  return rang === lettres.length;
}

/** Un service commun (Coffre-fort, Mémoire), tel que la colonne le reçoit. */
export interface ServiceCommun {
  cle: string;
  repere: string;
  Icone: React.ComponentType<{ className?: string }>;
  cleLibelle: string;
}

interface EntreeDeService {
  cle: string;
  Icone: React.ComponentType<{ className?: string }>;
  libelle: string;
  groupe: 'creer' | 'suivre' | 'communs';
  repere?: string;
}

export function ServicesDuBasDeLaColonne({
  bandeSeule,
  enTete = false,
  actif,
  onOuvrir,
  communs = [],
  onOuvrirCommun,
}: {
  bandeSeule: boolean;
  /**
   * POSÉ DANS LA TÊTE DE LA COLONNE, sous « Tableaux de bord » (15/11/2026) : la liste s'ouvre vers le BAS et les
   * services épinglés suivent la ligne. Sans lui (ancienne place au-dessus du pied) : vers le haut, épingles dessus.
   */
  enTete?: boolean;
  /** Le service dont la page est ouverte : son entrée est en violet. */
  actif?: string | null;
  onOuvrir: (cle: string) => void;
  /** Coffre-fort et Mémoire, en fin de liste. */
  communs?: readonly ServiceCommun[];
  onOuvrirCommun?: (cle: string) => void;
}) {
  const visibles = useServicesVisibles();
  const alerte = useAlerteDuService();
  const [fenetre, setFenetre] = React.useState(false);
  const [ouvert, setOuvert] = React.useState(false);
  const [recherche, setRecherche] = React.useState('');
  const [epingles, setEpingles] = usePref<string[]>(CLE_DES_SERVICES_EPINGLES, []);
  const champ = React.useRef<HTMLInputElement | null>(null);
  /* LE CHAMP PREND LA FRAPPE DÈS L'OUVERTURE : le menu pose d'abord le focus sur lui-même, le champ le reprend juste
     après. */
  /* …SUR ORDINATEUR SEULEMENT (15/11/2026, captures #1e70a / #2f68) : sur téléphone, le focus levait le clavier, qui
     réduisait la feuille de moitié à chaque réouverture. On touche le champ pour chercher. */
  const telephone = useTelephone();
  React.useEffect(() => {
    if (!ouvert || telephone) return;
    const minuteur = window.setTimeout(() => champ.current?.focus(), 30);
    return () => window.clearTimeout(minuteur);
  }, [ouvert, telephone]);
  const tous: EntreeDeService[] = [
    ...visibles.map((s) => ({ cle: s.cle, Icone: s.Icone, libelle: t(s.cleLibelle), groupe: s.groupe })),
    ...communs.map((s) => ({ cle: s.cle, Icone: s.Icone, libelle: t(s.cleLibelle), groupe: 'communs' as const, repere: s.repere })),
  ];
  if (!tous.length) return null;
  const epingle = (cle: string) => (epingles ?? []).includes(cle);
  const basculerLEpingle = (cle: string) => setEpingles(epingle(cle) ? (epingles ?? []).filter((c) => c !== cle) : [...(epingles ?? []), cle]);
  const ouvrir = (s: EntreeDeService) => {
    setOuvert(false);
    setRecherche('');
    if (s.groupe === 'communs') onOuvrirCommun?.(s.cle);
    else onOuvrir(s.cle);
  };
  const epinglees = tous.filter((s) => epingle(s.cle));
  const cherche = minusculesSansAccents(recherche.trim());
  /* D'ABORD CE QUI CONTIENT LA SAISIE, PUIS CE QUI EN CONTIENT LES LETTRES DANS L'ORDRE (« sto » trouve Studio) : quelques
     lettres tapées vite suffisent. */
  const trouves = cherche
    ? [...tous.filter((s) => minusculesSansAccents(s.libelle).includes(cherche)), ...tous.filter((s) => !minusculesSansAccents(s.libelle).includes(cherche) && lettresDansLOrdre(minusculesSansAccents(s.libelle), cherche))]
    : tous;
  const groupes = (['creer', 'suivre', 'communs'] as const).map((g) => trouves.filter((s) => s.groupe === g)).filter((g) => g.length);
  const uneAlerteCachee = tous.some((s) => alerte(s.cle) && !epingle(s.cle));
  const ligne = 'flex h-[43px] sm:h-9 w-full min-w-0 items-center gap-2.5 rounded-lg text-left text-[14px] transition-colors hover:bg-raised';
  const entreeDuMenu = (s: EntreeDeService) => (
    <DropdownMenuItem
      key={s.cle}
      data-service-de-la-colonne={s.cle}
      data-destination={s.cle}
      {...(s.repere ? { [`data-ouvrir-${s.repere}`]: '' } : {})}
      aria-current={actif === s.cle ? 'page' : undefined}
      onSelect={() => ouvrir(s)}
      className={cn('group/entree gap-2.5', actif === s.cle && 'text-important')}
    >
      <s.Icone className={cn('h-4 w-4 shrink-0', actif === s.cle ? 'text-important' : 'text-muted')} />
      <span className="min-w-0 flex-1 truncate">{s.libelle}</span>
      {alerte(s.cle) ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-teinte" data-alerte-de-tuile aria-hidden /> : null}
      {/* LA PUNAISE : elle épingle ou désépingle sans refermer le menu ni ouvrir le service. */}
      <button
        type="button"
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-fond-survol hover:text-text',
          epingle(s.cle) ? 'text-teinte' : 'text-faint opacity-60 group-hover/entree:opacity-100 group-focus/entree:opacity-100',
        )}
        aria-pressed={epingle(s.cle)}
        aria-label={epingle(s.cle) ? 'Désépingler' : 'Épingler'}
        title={epingle(s.cle) ? t('Désépingler') : t('Épingler')}
        data-punaise-de-service={s.cle}
        data-epingle={epingle(s.cle) ? '' : undefined}
        /* Ni l'appui ni le relâché ne remontent à la ligne : sinon le menu la choisirait (et se refermerait). */
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          basculerLEpingle(s.cle);
        }}
      >
        {epingle(s.cle) ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
      </button>
    </DropdownMenuItem>
  );
  const lignesEpinglees = epinglees.map((s) => (
        <button
          key={s.cle}
          type="button"
          data-service-du-bas={s.cle}
          data-service-de-la-colonne={s.cle}
          data-service-epingle
          {...(s.repere ? { [`data-ouvrir-${s.repere}`]: '' } : {})}
          aria-current={actif === s.cle ? 'page' : undefined}
          title={bandeSeule ? s.libelle : undefined}
          onClick={() => ouvrir(s)}
          className={cn(ligne, bandeSeule ? 'justify-center px-0' : 'px-2.5', actif === s.cle ? 'text-important' : 'text-text')}
        >
          <s.Icone className={cn('h-4 w-4 shrink-0', actif === s.cle ? 'text-important' : 'text-muted')} />
          <span className={cn('min-w-0 flex-1 truncate', bandeSeule && 'sr-only')}>{s.libelle}</span>
          {alerte(s.cle) ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-teinte" data-alerte-de-tuile aria-hidden /> : null}
        </button>
      ));
  /* LE SERVICE OUVERT SE LIT AUSSI SUR LA LIGNE « SERVICES » quand il n'est pas épinglé : son nom s'affiche en orange à
     droite, pour qu'on le retrouve sans ouvrir la liste. */
  const actifCache = actif && !epingle(actif) ? tous.find((s) => s.cle === actif) : undefined;
  return (
    <div className={cn('shrink-0', enTete ? 'flex flex-col gap-1.5' : cn('pt-1', bandeSeule ? 'px-1.5' : 'px-2'))} data-services-du-bas data-services-en-tete={enTete ? '' : undefined}>
      {enTete ? null : lignesEpinglees}
      <DropdownMenu
        open={ouvert}
        onOpenChange={(o) => {
          setOuvert(o);
          if (!o) setRecherche('');
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-bouton-services
            data-voir-plus-services
            title={bandeSeule ? t('Services') : undefined}
            className={cn(ligne, bandeSeule ? 'justify-center px-0' : 'px-2.5', 'text-text data-[state=open]:bg-raised')}
          >
            <LayoutGrid className={cn('h-4 w-4 shrink-0', actifCache ? 'text-important' : 'text-muted')} />
            <span className={cn('min-w-0 shrink-0 truncate', bandeSeule && 'sr-only')}>{t('Services')}</span>
            {actifCache && !bandeSeule ? (
              <span className="min-w-0 flex-1 truncate text-right text-[13px] text-important" data-service-actif-sur-la-ligne={actifCache.cle}>
                {actifCache.libelle}
              </span>
            ) : (
              <span className={cn('flex-1', bandeSeule && 'hidden')} />
            )}
            {uneAlerteCachee ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-teinte" data-alerte-navigation aria-hidden /> : null}
            {bandeSeule ? null : enTete ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
            ) : (
              <ChevronUp className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side={enTete ? 'bottom' : 'top'}
          align="start"
          sideOffset={bandeSeule ? 4 : 0}
          className={bandeSeule ? 'sm:w-[260px]' : CLASSE_MENU_PAR_DESSUS_DU_BOUTON}
          data-menu-des-services
        >
          <label className={cn('mb-1 flex items-center gap-2 rounded-lg bg-raised px-2.5', HAUTEUR_DE_CONTROLE)}>
            <Search className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
            <input
              ref={champ}
              type="text"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder={t('Rechercher un service…')}
              aria-label="Rechercher un service"
              autoComplete="off"
              data-recherche-de-services
              className="min-w-0 flex-1 bg-transparent text-[16px] text-text outline-none placeholder:text-faint sm:text-[13px]"
              onKeyDown={(e) => {
                /* La frappe reste au champ (pas de recherche par lettre du menu) ; Échap, les flèches et Tab gardent
                   leur rôle de menu ; Entrée ouvre le premier service trouvé. */
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  if (trouves[0]) ouvrir(trouves[0]);
                  return;
                }
                if (e.key === 'Escape' || e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab') return;
                e.stopPropagation();
              }}
            />
          </label>
          {groupes.map((groupe, rang) => (
            <React.Fragment key={groupe[0]!.groupe}>
              {rang ? <DropdownMenuSeparator /> : null}
              {groupe.map(entreeDuMenu)}
            </React.Fragment>
          ))}
          {!trouves.length ? (
            <p className="px-2.5 py-2 text-[12.5px] text-faint" data-aucun-service>
              {t('Aucun service ne correspond à cette recherche.')}
            </p>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="gap-2.5" data-tous-les-services onSelect={() => setFenetre(true)}>
            <LayoutGrid className="h-4 w-4 shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate">{t('Tous les services…')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {enTete ? lignesEpinglees : null}
      <FenetreDesServices
        ouverte={fenetre}
        onFermer={() => setFenetre(false)}
        onOuvrir={(cle) => {
          setFenetre(false);
          onOuvrir(cle);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* La fenêtre des services, en cartes identiques                        */
/* ------------------------------------------------------------------ */

interface ResumeDesServices {
  chartes: number | null;
  campagnes: number | null;
  publicationsDuMois: number | null;
  creations: number | null;
  plans: number | null;
  visites7j: number | null;
  derniereSauvegarde: number | null;
  sitesSauvegardes: number | null;
  projetsSecurite?: number | null;
  pointsGravesSecurite?: number | null;
}

/** La phrase de chaque carte : écrite pour tenir sur deux lignes, sans points de suspension. */
function phraseDuService(cle: string): string {
  switch (cle) {
    case 'plaquettes':
      return t('Chartes et plaquettes de tous vos projets');
    case 'communication2':
      return t('Campagnes, comptes et réponses reçues');
    case 'calendrier':
      return t('Toutes les publications programmées du mois');
    case 'studio':
      return t('Vidéos, images et sons fabriqués pour vous');
    case 'marketing2':
      return t('Stratégie et plans d’action de vos projets');
    case 'statistiques':
      return t('Les visites de vos sites, jour après jour');
    case 'espace-client':
      return t('Demandes et échanges avec vos clients');
    case 'backups':
      return t('Les sauvegardes et leurs points de reprise');
    case 'surveillance':
      return t('L’état de vos sites en ligne, en continu');
    case 'securite':
      return t('L’audit de vos projets, chaque semaine');
    case 'taches-recurrentes':
      return t('Veilles et contrôles qui reviennent seuls');
    default:
      return '';
  }
}

const nombre = (n: number) => n.toLocaleString('fr-FR');

/** L'heure d'une sauvegarde : « à 03:12 » aujourd'hui, sinon la date courte. */
function quandCourt(at: number): string {
  const d = new Date(at);
  const maintenant = new Date();
  const heure = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === maintenant.toDateString()) return t('Dernière à {v0}', { v0: heure });
  return t('Dernière le {v0}', { v0: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) });
}

/**
 * LA LIGNE D'ÉTAT D'UNE CARTE : toujours un texte, jamais rien. `null` : le chiffre n'est pas encore là (silhouette).
 * `fort` : à regarder (Messagerie en attente, site en panne) — en violet, avec un point.
 */
function etatDuService(cle: string, resume: ResumeDesServices | null, ecran: ReturnType<typeof useApp>): { texte: string; fort?: boolean } | null {
  const enPanne = compterEnPanne(ecran.surveillance);
  switch (cle) {
    case 'espace-client': {
      const n = ecran.compteursMessagerie.nonLu + ecran.compteursMessagerie.aTraiter;
      return n ? { texte: t('{v0} en attente', { v0: nombre(n) }), fort: true } : { texte: t('Rien en attente') };
    }
    case 'surveillance':
      if (!ecran.surveillanceRecue) return null;
      if (!ecran.surveillance.length) return { texte: t('Aucun site surveillé') };
      return enPanne
        ? { texte: t('{v0} sites · {v1} en panne', { v0: nombre(ecran.surveillance.length), v1: nombre(enPanne) }), fort: true }
        : { texte: t('{v0} sites · tout va bien', { v0: nombre(ecran.surveillance.length) }) };
    case 'taches-recurrentes':
      return ecran.veilles.a ? { texte: t('{v0} actives', { v0: nombre(ecran.veilles.actives) }) } : null;
  }
  if (!resume) return null;
  const ou = (n: number | null, texte: (n: number) => string, sinon: string) => ({ texte: n === null ? sinon : texte(n) });
  switch (cle) {
    case 'plaquettes':
      return ou(resume.chartes, (n) => (n === 1 ? t('1 charte') : t('{v0} chartes', { v0: nombre(n) })), t('Vos chartes'));
    case 'communication2':
      return ou(resume.campagnes, (n) => (n === 1 ? t('1 campagne') : t('{v0} campagnes', { v0: nombre(n) })), t('Vos campagnes'));
    case 'calendrier':
      return ou(resume.publicationsDuMois, (n) => t('{v0} ce mois-ci', { v0: nombre(n) }), t('Le mois en cours'));
    case 'studio':
      return ou(resume.creations, (n) => (n === 1 ? t('1 création') : t('{v0} créations', { v0: nombre(n) })), t('Vos créations'));
    case 'marketing2':
      return ou(resume.plans, (n) => (n === 1 ? t('1 plan') : t('{v0} plans', { v0: nombre(n) })), t('Vos plans'));
    case 'statistiques':
      return ou(resume.visites7j, (n) => t('{v0} visites en 7 jours', { v0: nombre(n) }), t('Vos visites'));
    case 'backups':
      if (resume.derniereSauvegarde) return { texte: quandCourt(resume.derniereSauvegarde) };
      return ou(resume.sitesSauvegardes, (n) => (n ? t('{v0} sites sauvegardés', { v0: nombre(n) }) : t('Aucune sauvegarde')), t('Vos sauvegardes'));
    case 'securite': {
      if (resume.projetsSecurite === null || resume.projetsSecurite === undefined) return { texte: t('Vos audits') };
      if (!resume.projetsSecurite) return { texte: t('Aucun projet suivi') };
      const graves = resume.pointsGravesSecurite ?? 0;
      return graves
        ? { texte: t('{v0} projets · {v1} points graves', { v0: nombre(resume.projetsSecurite), v1: nombre(graves) }), fort: true }
        : { texte: t('{v0} projets · rien de grave', { v0: nombre(resume.projetsSecurite) }) };
    }
  }
  return { texte: '' };
}

export function FenetreDesServices({ ouverte, onFermer, onOuvrir }: { ouverte: boolean; onFermer: () => void; onOuvrir: (cle: string) => void }) {
  const visibles = useServicesVisibles();
  const ecran = useApp();
  const [recherche, setRecherche] = React.useState('');
  const [resume, setResume] = React.useState<ResumeDesServices | null>(null);
  /* LES CHIFFRES SE LISENT À L'OUVERTURE, une fois : la fenêtre s'affiche aussitôt, les lignes en silhouette. */
  React.useEffect(() => {
    if (!ouverte) return;
    setRecherche('');
    let vivant = true;
    void client
      .call<ResumeDesServices>({ type: 'services.resume' }, 8000)
      .then((r) => {
        if (vivant) setResume(r);
      })
      .catch(() => {
        if (vivant) setResume({ chartes: null, campagnes: null, publicationsDuMois: null, creations: null, plans: null, visites7j: null, derniereSauvegarde: null, sitesSauvegardes: null, projetsSecurite: null, pointsGravesSecurite: null });
      });
    return () => {
      vivant = false;
    };
  }, [ouverte]);
  const cherche = recherche.trim().toLowerCase();
  const trouves = visibles.filter((s) => !cherche || t(s.cleLibelle).toLowerCase().includes(cherche) || phraseDuService(s.cle).toLowerCase().includes(cherche));
  const groupes: { titre: string; services: ServiceDuMenu[] }[] = [
    { titre: t('Créer'), services: trouves.filter((s) => s.groupe === 'creer') },
    { titre: t('Suivre'), services: trouves.filter((s) => s.groupe === 'suivre') },
  ];
  return (
    <Dialog open={ouverte} onOpenChange={(o) => !o && onFermer()}>
      <DialogContent className="sm:w-[min(980px,100%)]" data-fenetre-des-services onOpenAutoFocus={(event) => event.preventDefault()}>
        <DialogHeader
          droite={
            <label className={cn('flex w-[240px] items-center gap-2 rounded-lg bg-raised px-3 text-[13.5px] max-sm:hidden', HAUTEUR_DE_CONTROLE)}>
              <Search className="h-4 w-4 shrink-0 text-faint" />
              <input
                type="search"
                value={recherche}
                onChange={(event) => setRecherche(event.target.value)}
                placeholder={t('Rechercher un service…')}
                aria-label="Rechercher un service"
                data-recherche-services
                className="min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden"
              />
            </label>
          }
        >
          <DialogTitle>{t('Services')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 pb-5">
          {groupes.map((groupe) =>
            groupe.services.length ? (
              <section key={groupe.titre}>
                <h3 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-faint">{groupe.titre}</h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  {groupe.services.map((service) => (
                    <CarteDeService
                      key={service.cle}
                      service={service}
                      etat={etatDuService(service.cle, resume, ecran)}
                      onOuvrir={() => onOuvrir(service.cle)}
                    />
                  ))}
                </div>
              </section>
            ) : null,
          )}
          {!trouves.length ? <p className="py-6 text-center text-[13.5px] text-muted">{t('Aucun service ne correspond à cette recherche.')}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * UNE CARTE DE SERVICE : la même structure et la même hauteur pour toutes (158 px). Le texte replié (`line-clamp`) ne
 * se pose jamais dans un `button` : la carte est un élément focalisable qui s'ouvre au clic, à Entrée ou à Espace.
 */
function CarteDeService({ service, etat, onOuvrir }: { service: ServiceDuMenu; etat: { texte: string; fort?: boolean } | null; onOuvrir: () => void }) {
  const { cle, Icone, cleLibelle } = service;
  return (
    <div
      role="button"
      tabIndex={0}
      data-carte-service={cle}
      onClick={onOuvrir}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOuvrir();
        }
      }}
      className="flex h-[158px] min-w-0 cursor-pointer flex-col rounded-2xl bg-raised p-4 text-left outline-none transition-colors hover:bg-raised/70 focus-visible:ring-2 focus-visible:ring-teinte"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-bg text-text shadow-sm">
        <Icone className="h-[18px] w-[18px]" />
      </span>
      <p className="mt-3 truncate text-[14px] font-medium leading-5 text-text">{t(cleLibelle)}</p>
      <p className="mt-0.5 line-clamp-2 h-9 text-[12.5px] leading-[18px] text-muted">{phraseDuService(cle)}</p>
      {etat ? (
        <p className={cn('mt-auto flex min-w-0 items-center gap-1.5 truncate text-[12px] leading-4', etat.fort ? 'font-medium text-teinte' : 'text-faint')} data-etat-de-service={cle}>
          {etat.fort ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-teinte" aria-hidden /> : null}
          <span className="min-w-0 truncate">{etat.texte}</span>
        </p>
      ) : (
        <span className="mt-auto block h-4 w-24 animate-pulse rounded bg-bg" data-etat-de-service={cle} data-silhouette aria-hidden />
      )}
    </div>
  );
}
