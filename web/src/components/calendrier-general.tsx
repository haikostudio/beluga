/*
 * LE CALENDRIER GÉNÉRAL (décision de l'utilisateur, 14/11/2026, maquette #29711) : « Calendrier », en bas de la colonne,
 * ouvre une PAGE (refonte du 14/11/2026, carte « Onglets, services et listes repensés », maquettes 6, 7 et 8) : TOUTES
 * les campagnes de TOUS les projets réunies, en deux rubriques, « Mois » et « Liste ».
 *  - Plus de bande des projets sous le titre : le nombre de publications de chaque projet est DANS le filtre de droite,
 *    qui a sa recherche et montre d'abord les projets qui publient.
 *  - Un clic sur une publication (mois ou liste) ouvre LE MÊME TIROIR D'APERÇU QUE COMMUNICATION (15/11/2026, il
 *    remplace le volet à droite de MEM-7353) : le titre, « Précédente / n sur N / Suivante », le post tel qu'il
 *    paraîtra, sa date et son état, « Valider » s'il attend, puis le lien vers sa campagne. Les boutons ET les flèches
 *    gauche / droite du clavier passent d'une publication à l'autre dans l'ordre des dates — la suite du jour, puis
 *    les jours suivants (ou précédents), d'un mois à l'autre, filtre de projet compris. L'adresse le suit
 *    (« #calendrier/<publication> »).
 *  - « Liste » range les publications programmées jour par jour, à partir d'aujourd'hui.
 *
 * Les données : la liste des marques, puis les publications de chacune (les mêmes lectures que l'espace
 * Communication). La grille et le rangement par jour sont des règles pures (`shared/src/calendrier-general.ts`).
 */
import * as React from 'react';
import { CalendarDays, Check, ChevronLeft, ChevronRight, ExternalLink, List, Loader2 } from '@/components/ui/icones';
import { type Project, jourIso, moisVoisin, ordreDesPublications, nombresParProjet, publicationsAVenirParJour, publicationsParJour, semainesDuMois, type PublicationDuCalendrier } from '@beluga/shared';
import { PastilleProjet } from '@/components/pastille-projet';
import { Apercu, estUnReseau, jouerUnGeste, libelleDuCanal } from '@/components/communication-v2/socle/pieces';
import { EtatDePublication } from '@/components/communication-v2/pieces';
import { LogoReseau } from '@/components/logos-reseaux';
import { DroiteDePage, RubriquesDePage } from '@/components/fenetre-de-service';
import { BarreDOnglets } from '@/components/ui/barre-d-onglets';
import { FiltreDuProjetDeLaPage, TOUS_LES_PROJETS } from '@/components/menus-de-la-colonne';
import { Button, Drawer, EnteteDeFeuille, HAUTEUR_DE_CONTROLE, ZoneDefilement } from '@/components/ui';
import { ApercuDePost, largeurDeLApercu } from '@/components/communication-v2/socle/apercu-de-post';
import { client } from '@/lib/client';
import { formatRegional, t } from '@/lib/langue';
import { useTelephone } from '@/lib/telephone';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';

type PublicationAffichee = PublicationDuCalendrier & {
  apercu: { attachmentId: string; genre: string } | null;
  canal: string | null;
  texte: string;
  etape: string;
  genre: string | null;
};

interface MarqueLue {
  id: string;
  projets: { id: string }[];
}
interface ContenuLu {
  id: string;
  projectId: string;
  titre: string;
  datePrevue?: string;
  heurePrevue?: string;
  campagneId?: string;
  apercu: { attachmentId: string; genre: string } | null;
  canal?: string;
  canaux?: string[];
  texte?: string;
  etape?: string;
  genre?: string;
}

/** Toutes les publications datées, toutes marques réunies ; `null` tant que la lecture n'est pas finie. */
function useToutesLesPublications(): PublicationAffichee[] | null {
  const version = useApp().communicationVersion;
  const [publications, setPublications] = React.useState<PublicationAffichee[] | null>(null);
  React.useEffect(() => {
    let abandon = false;
    void (async () => {
      try {
        const { marques } = await client.call<{ marques: MarqueLue[] }>({ type: 'communication.marques' });
        const lots = await Promise.all(
          marques.map((m) =>
            client
              .call<{ contenus: ContenuLu[] }>({ type: 'communication.publications', marqueId: m.id, periode: 30 })
              .then((r) => ({ marque: m, contenus: r.contenus ?? [] }))
              .catch(() => ({ marque: m, contenus: [] as ContenuLu[] })),
          ),
        );
        if (abandon) return;
        setPublications(
          lots.flatMap(({ marque, contenus }) =>
            contenus
              .filter((c) => !!c.datePrevue)
              .map((c) => ({
                id: c.id,
                jour: c.datePrevue!.slice(0, 10),
                heure: c.heurePrevue ?? null,
                titre: c.titre,
                /* Le projet d'une publication : celui de sa marque (une marque sans dépôt garde son support). */
                projectId: marque.projets[0]?.id ?? c.projectId,
                marqueId: marque.id,
                campagneId: c.campagneId ?? null,
                apercu: c.apercu,
                canal: c.canaux?.find(estUnReseau) ?? c.canal ?? null,
                texte: c.texte ?? '',
                etape: c.etape ?? '',
                genre: c.genre ?? null,
              })),
          ),
        );
      } catch {
        if (!abandon) setPublications([]);
      }
    })();
    return () => {
      abandon = true;
    };
  }, [version]);
  return publications;
}

type VueDuCalendrier = 'mois' | 'liste';

export function CalendrierGeneral({
  onOuvrirCampagne,
  vise = null,
  onVise,
}: {
  onOuvrirCampagne: (projectId: string, adresse: string) => void;
  /** La publication ouverte dans l'aperçu, d'après l'adresse (« #calendrier/<publication> »). */
  vise?: string | null;
  onVise?: (publicationId: string | null) => void;
}) {
  const telephone = useTelephone();
  const projets = useApp().projects;
  const publications = useToutesLesPublications();
  const aujourdhui = jourIso(new Date());
  const [vue, setVue] = React.useState<VueDuCalendrier>('mois');
  const [mois, setMois] = React.useState(() => ({ annee: new Date().getFullYear(), mois: new Date().getMonth() }));
  const [projet, setProjet] = React.useState(TOUS_LES_PROJETS);
  const [ouverteId, setOuverteIdLocal] = React.useState<string | null>(vise);
  /* L'adresse commande (rechargement, Précédent) ; un clic l'écrit. */
  React.useEffect(() => setOuverteIdLocal(vise), [vise]);
  const setOuverteId = React.useCallback(
    (id: string | null) => {
      setOuverteIdLocal(id);
      onVise?.(id);
    },
    [onVise],
  );
  /* Une publication validée dans le volet : son état change ici aussitôt, sans attendre la relecture. */
  const [etapesLocales, setEtapesLocales] = React.useState<Record<string, string>>({});
  const semaines = React.useMemo(() => semainesDuMois(mois.annee, mois.mois), [mois]);
  const prefixeDuMois = `${mois.annee}-${String(mois.mois + 1).padStart(2, '0')}`;
  const toutes = React.useMemo(
    () => (publications ?? []).map((p) => (etapesLocales[p.id] ? { ...p, etape: etapesLocales[p.id]! } : p)),
    [publications, etapesLocales],
  );
  const parJour = React.useMemo(
    () => publicationsParJour(toutes, semaines.flat(), projet || null) as Map<string, PublicationAffichee[]>,
    [toutes, semaines, projet],
  );
  const joursDuMois = React.useMemo(() => semaines.flat().filter((j) => j.startsWith(prefixeDuMois)), [semaines, prefixeDuMois]);
  const nombres = React.useMemo(() => nombresParProjet(toutes, joursDuMois), [toutes, joursDuMois]);
  const aVenir = React.useMemo(() => publicationsAVenirParJour(toutes, aujourdhui, projet || null), [toutes, aujourdhui, projet]);
  const projetDe = (id: string) => projets.find((p) => p.id === id);
  const nomDuMois = new Date(mois.annee, mois.mois, 1).toLocaleDateString(formatRegional(), { month: 'long', year: 'numeric' });
  const nomsDesJours = semaines[0].map((jour) => new Date(`${jour}T12:00:00`).toLocaleDateString(formatRegional(), { weekday: 'short' }));
  const ouverte = ouverteId ? toutes.find((p) => p.id === ouverteId) ?? null : null;
  /* LE PARCOURS DU TIROIR : toutes les publications du filtre en cours, dans l'ordre des dates, d'un mois à l'autre. */
  const parcours = React.useMemo(
    () => ordreDesPublications(toutes.filter((p) => !projet || projet === TOUS_LES_PROJETS || p.projectId === projet)),
    [toutes, projet],
  );
  const rangOuverte = ouverte ? parcours.findIndex((p) => p.id === ouverte.id) : -1;
  const allerA = React.useCallback(
    (p: PublicationAffichee | undefined) => {
      if (!p) return;
      setOuverteId(p.id);
      /* La grille suit : une publication d'un autre mois montre son mois. */
      const [annee, moisUn] = p.jour.split('-').map(Number);
      if (annee && moisUn) setMois((m) => (m.annee === annee && m.mois === moisUn - 1 ? m : { annee, mois: moisUn - 1 }));
    },
    [setOuverteId],
  );
  const adresseDeLaCampagne = (p: PublicationAffichee) =>
    p.campagneId ? `communication2/${p.marqueId}/campagnes/${p.campagneId}` : `communication2/${p.marqueId}/calendrier`;

  const pastille = (p: PublicationAffichee, compacte: boolean) => {
    const proj = projetDe(p.projectId);
    const choisie = p.id === ouverteId;
    return (
      <button
        key={p.id}
        type="button"
        onClick={() => setOuverteId(p.id)}
        title={p.titre}
        aria-pressed={choisie}
        className={cn(
          'flex w-full min-w-0 items-center gap-1.5 rounded-md bg-raised px-1 py-1 text-left text-[12px] text-text transition-colors hover:bg-faint/20',
          choisie && 'ring-2 ring-inset ring-teinte',
        )}
        data-publication-du-calendrier={p.id}
      >
        <Apercu piece={p.apercu?.attachmentId ?? null} genre={p.apercu?.genre ?? 'image'} taille={compacte ? 22 : 30} className="shrink-0 rounded" />
        <span className="min-w-0 flex-1 truncate">{p.heure ? `${p.heure} · ` : ''}{p.titre}</span>
        {proj ? <PastilleProjet project={proj} taille={14} /> : null}
      </button>
    );
  };

  const filtre = (
    <div className={telephone ? 'w-[116px]' : 'w-[200px]'}>
      <FiltreDuProjetDeLaPage valeur={projet} onChoisir={setProjet} nombres={publications ? nombres : undefined} />
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-calendrier-general data-vue-du-calendrier={vue}>
      {/* LES RUBRIQUES « MOIS » / « LISTE » : à droite du titre, en tête de la rangée (sur téléphone, en icônes, en tête
          de la rangée de la feuille). */}
      <RubriquesDePage>
        <BarreDOnglets
          repere="vues-du-calendrier"
          libelle={t('Vues du calendrier')}
          onglets={[
            { cle: 'mois' as VueDuCalendrier, libelle: t('Mois'), ...(telephone ? { icone: <CalendarDays className="h-4 w-4" />, iconeSeule: true } : {}) },
            { cle: 'liste' as VueDuCalendrier, libelle: t('Liste'), ...(telephone ? { icone: <List className="h-4 w-4" />, iconeSeule: true } : {}) },
          ]}
          valeur={vue}
          onChange={setVue}
        />
      </RubriquesDePage>
      {/* À DROITE DE LA RANGÉE, DANS L'ORDRE COMMUN : le filtre des projets (chiffré), puis le réglage propre au
          calendrier — le mois (« Mois » seulement). Sur téléphone, le nom du mois raccourci ramène à aujourd'hui. */}
      <DroiteDePage>
        <div className="flex items-center gap-2">
          {filtre}
          {vue === 'mois' ? (
            <div className="flex items-center gap-1" data-navigation-du-mois>
              <Button variant="ghost" size="icon" className={cn(HAUTEUR_DE_CONTROLE, 'w-[38px] text-muted sm:w-8')} aria-label="Mois précédent" title={t('Mois précédent')} data-mois-precedent onClick={() => setMois((m) => moisVoisin(m.annee, m.mois, -1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              {telephone ? (
                <button
                  type="button"
                  className="h-[38px] min-w-[56px] text-center text-[13px] font-medium capitalize text-text"
                  data-mois-du-calendrier={prefixeDuMois}
                  data-mois-courant
                  title={t('Aujourd’hui')}
                  onClick={() => setMois({ annee: new Date().getFullYear(), mois: new Date().getMonth() })}
                >
                  {new Date(mois.annee, mois.mois, 1).toLocaleDateString(formatRegional(), { month: 'short', year: '2-digit' })}
                </button>
              ) : (
                <span className="min-w-[128px] text-center text-[14px] font-medium capitalize text-text" data-mois-du-calendrier={prefixeDuMois}>
                  {nomDuMois}
                </span>
              )}
              <Button variant="ghost" size="icon" className={cn(HAUTEUR_DE_CONTROLE, 'w-[38px] text-muted sm:w-8')} aria-label="Mois suivant" title={t('Mois suivant')} data-mois-suivant onClick={() => setMois((m) => moisVoisin(m.annee, m.mois, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              {telephone ? null : (
                <Button variant="subtle" size="sm" className={cn(HAUTEUR_DE_CONTROLE, 'bg-raised')} data-mois-courant onClick={() => setMois({ annee: new Date().getFullYear(), mois: new Date().getMonth() })}>
                  {t('Aujourd’hui')}
                </Button>
              )}
            </div>
          ) : null}
        </div>
      </DroiteDePage>

      {/* LA COLONNE COMMUNE PORTE LES BORDS (carte « Services homogènes et centrés ») : plus de largeur propre ici. */}
      <ZoneDefilement className={cn('pb-5', telephone && 'px-4')} classeEnveloppe="min-h-0 flex-1">
        <div>
          {publications === null && vue === 'liste' ? (
            /* LA SILHOUETTE DE LA LISTE : des lignes à leur hauteur, le temps des lectures. */
            <div className="flex flex-col gap-2 pt-4" data-silhouette-calendrier aria-hidden>
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="h-[52px] animate-silhouette rounded-lg bg-faint/25" />
              ))}
            </div>
          ) : publications === null ? (
            /* LA SILHOUETTE : la grille à sa taille, qui respire, le temps des lectures. */
            <div className="grid grid-cols-7 gap-1" data-silhouette-calendrier aria-hidden>
              {semaines.flat().map((jour) => (
                <div key={jour} className="h-24 animate-silhouette rounded-md bg-faint/25" />
              ))}
            </div>
          ) : vue === 'liste' ? (
            <ListeDesPublications jours={aVenir} aujourdhui={aujourdhui} ouverteId={ouverteId} onOuvrir={setOuverteId} projetDe={projetDe} />
          ) : telephone ? (
            /* SUR TÉLÉPHONE, UNE LISTE PAR JOUR : la grille de sept colonnes n'y tiendrait pas. */
            <div className="flex flex-col gap-3" data-calendrier-en-liste>
              {joursDuMois
                .filter((jour) => parJour.has(jour))
                .map((jour) => (
                  <div key={jour} className="flex flex-col gap-1">
                    <p className={cn('text-[13px] font-medium', jour === aujourdhui ? 'text-teinte' : 'text-muted')}>
                      {new Date(`${jour}T12:00:00`).toLocaleDateString(formatRegional(), { weekday: 'long', day: 'numeric', month: 'long' })}
                    </p>
                    {parJour.get(jour)!.map((p) => pastille(p, false))}
                  </div>
                ))}
              {!parJour.size ? <p className="py-10 text-center text-[14px] text-muted">{t('Aucune publication prévue ce mois-ci.')}</p> : null}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-7 gap-1 pb-1">
                {nomsDesJours.map((nom, i) => (
                  <div key={i} className="px-1 text-[12px] capitalize text-faint">
                    {nom}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1" data-grille-du-calendrier>
                {semaines.flat().map((jour) => {
                  const duMois = jour.startsWith(prefixeDuMois);
                  const liste = parJour.get(jour) ?? [];
                  return (
                    <div
                      key={jour}
                      className={cn('flex min-h-24 min-w-0 flex-col gap-1 rounded-md bg-surface p-1', !duMois && 'opacity-50')}
                      data-jour-du-calendrier={jour}
                      data-aujourdhui={jour === aujourdhui ? '' : undefined}
                    >
                      <span className={cn('px-0.5 text-[12px]', jour === aujourdhui ? 'font-semibold text-teinte' : 'text-muted')}>{Number(jour.slice(8))}</span>
                      {liste.slice(0, 3).map((p) => pastille(p, true))}
                      {liste.length > 3 ? <span className="px-1 text-[11.5px] text-faint">{t('+{v0} autres', { v0: liste.length - 3 })}</span> : null}
                    </div>
                  );
                })}
              </div>
              {!parJour.size ? <p className="py-6 text-center text-[14px] text-muted">{t('Aucune publication prévue ce mois-ci.')}</p> : null}
            </>
          )}
        </div>
      </ZoneDefilement>
      <Drawer feuille open={!!ouverte} onClose={() => setOuverteId(null)} className="sm:max-w-[480px]">
        {ouverte ? (
          <TiroirDApercu
            publication={ouverte}
            projet={projetDe(ouverte.projectId)}
            rang={rangOuverte}
            total={parcours.length}
            onPrecedente={rangOuverte > 0 ? () => allerA(parcours[rangOuverte - 1]) : undefined}
            onSuivante={rangOuverte >= 0 && rangOuverte < parcours.length - 1 ? () => allerA(parcours[rangOuverte + 1]) : undefined}
            onOuvrirCampagne={() => onOuvrirCampagne(ouverte.projectId, adresseDeLaCampagne(ouverte))}
            onValidee={() => setEtapesLocales((e) => ({ ...e, [ouverte.id]: 'pret' }))}
          />
        ) : null}
      </Drawer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* La vue « Liste »                                                     */
/* ------------------------------------------------------------------ */

const JOURS_PAR_PAQUET = 14;

function ListeDesPublications({
  jours,
  aujourdhui,
  ouverteId,
  onOuvrir,
  projetDe,
}: {
  jours: { jour: string; publications: PublicationAffichee[] }[];
  aujourdhui: string;
  ouverteId: string | null;
  onOuvrir: (id: string) => void;
  projetDe: (id: string) => Project | undefined;
}) {
  const telephone = useTelephone();
  /* LE CHARGEMENT PROGRESSIF : deux semaines de jours à la fois, la suite quand on arrive au bas. */
  const [nombre, setNombre] = React.useState(JOURS_PAR_PAQUET);
  const sentinelle = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const el = sentinelle.current;
    if (!el || nombre >= jours.length) return;
    const observateur = new IntersectionObserver((entrees) => {
      if (entrees.some((e) => e.isIntersecting)) setNombre((n) => n + JOURS_PAR_PAQUET);
    });
    observateur.observe(el);
    return () => observateur.disconnect();
  }, [nombre, jours.length]);
  if (!jours.length) return <p className="py-10 text-center text-[14px] text-muted">{t('Aucune publication programmée à venir.')}</p>;
  return (
    <div data-calendrier-liste>
      {telephone ? null : (
        <div className="grid grid-cols-[minmax(0,1fr)_180px_150px_120px] gap-4 border-b border-faint/20 px-3 pb-2 text-[12px] text-faint">
          <span>{t('Publication')}</span>
          <span>{t('Projet')}</span>
          <span>{t('Réseau')}</span>
          <span>{t('État')}</span>
        </div>
      )}
      {jours.slice(0, nombre).map(({ jour, publications }) => (
        <section key={jour} data-jour-de-la-liste={jour}>
          <p className={cn('px-3 pb-1.5 pt-4 text-[13px] font-medium first-letter:uppercase', jour === aujourdhui ? 'text-teinte' : 'text-muted')}>
            {new Date(`${jour}T12:00:00`).toLocaleDateString(formatRegional(), { weekday: 'long', day: 'numeric', month: 'long' })}
            {jour === aujourdhui ? ` · ${t('aujourd’hui')}` : ''}
          </p>
          {publications.map((p) => {
            const proj = projetDe(p.projectId);
            const choisie = p.id === ouverteId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onOuvrir(p.id)}
                aria-pressed={choisie}
                data-publication-du-calendrier={p.id}
                className={cn(
                  'grid w-full min-w-0 items-center gap-4 rounded-lg px-3 py-2 text-left transition-colors hover:bg-raised',
                  telephone ? 'grid-cols-[minmax(0,1fr)]' : 'grid-cols-[minmax(0,1fr)_180px_150px_120px]',
                  choisie && 'bg-teinte-fond',
                )}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <Apercu piece={p.apercu?.attachmentId ?? null} genre={p.apercu?.genre ?? 'image'} taille={40} className="h-[52px] w-[30px] shrink-0 rounded" />
                  <span className="w-11 shrink-0 text-[13.5px] tabular-nums text-muted">{p.heure ?? '—'}</span>
                  <span className="min-w-0 truncate text-[14px] text-text">{p.titre}</span>
                </span>
                {telephone ? null : (
                  <>
                    <span className="flex min-w-0 items-center gap-2 text-[13.5px] text-text">
                      {proj ? <PastilleProjet project={proj} taille={16} /> : null}
                      <span className="min-w-0 truncate">{proj?.name ?? '—'}</span>
                    </span>
                    <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
                      {p.canal && estUnReseau(p.canal) ? <LogoReseau reseau={p.canal} className="h-3.5 w-3.5 shrink-0" /> : null}
                      <span className="min-w-0 truncate">{p.canal ? libelleDuCanal(p.canal) : '—'}</span>
                    </span>
                    <span className="min-w-0">{p.etape ? <EtatDePublication etape={p.etape} /> : null}</span>
                  </>
                )}
              </button>
            );
          })}
        </section>
      ))}
      {nombre < jours.length ? <div ref={sentinelle} className="h-10" data-suite-de-la-liste aria-hidden /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Le volet d'une story                                                 */
/* ------------------------------------------------------------------ */

/**
 * LE TIROIR D'APERÇU D'UNE PUBLICATION — LE MÊME QUE COMMUNICATION (15/11/2026, il remplace le volet à droite de
 * MEM-7353) : la feuille commune, son titre, puis UNE colonne de la largeur du post (capture #0a85) — la navigation,
 * le post tel qu'il paraîtra, la date et l'état, « Valider » s'il attend, et le lien vers sa campagne. Les flèches
 * gauche / droite du clavier font « Précédente » / « Suivante » (hors d'un champ d'écriture).
 */
function TiroirDApercu({
  publication: p,
  projet,
  rang,
  total,
  onPrecedente,
  onSuivante,
  onOuvrirCampagne,
  onValidee,
}: {
  publication: PublicationAffichee;
  projet?: Project;
  rang: number;
  total: number;
  onPrecedente?: () => void;
  onSuivante?: () => void;
  onOuvrirCampagne: () => void;
  onValidee: () => void;
}) {
  const telephone = useTelephone();
  const [valide, setValide] = React.useState(false);
  const precedente = React.useRef(onPrecedente);
  const suivante = React.useRef(onSuivante);
  precedente.current = onPrecedente;
  suivante.current = onSuivante;
  React.useEffect(() => {
    const auClavier = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const cible = event.target as HTMLElement | null;
      if (cible && (cible.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(cible.tagName))) return;
      const geste = event.key === 'ArrowLeft' ? precedente.current : suivante.current;
      if (!geste) return;
      event.preventDefault();
      geste();
    };
    window.addEventListener('keydown', auClavier);
    return () => window.removeEventListener('keydown', auClavier);
  }, []);
  const valider = async () => {
    if (valide) return;
    setValide(true);
    const fait = await jouerUnGeste('publication.valider', p.id);
    setValide(false);
    if (fait) onValidee();
  };
  const reseau = p.canal ?? '';
  const date = new Date(`${p.jour}T12:00:00`).toLocaleDateString(formatRegional(), { weekday: 'long', day: 'numeric', month: 'long' });
  const visuels = p.apercu ? [{ piece: p.apercu.attachmentId, genre: p.apercu.genre }] : [];
  return (
    <>
      <EnteteDeFeuille titre={p.titre} data-tiroir-apercu-calendrier={p.id} />
      <ZoneDefilement className="px-4 pb-5">
        <div className="mx-auto flex w-full min-w-0 flex-col gap-3" style={{ maxWidth: largeurDeLApercu(reseau) }} data-colonne-de-l-apercu={largeurDeLApercu(reseau)}>
          <div className="flex min-w-0 items-center gap-2" data-calendrier-navigation-apercu>
            <Button size="sm" variant="subtle" disabled={!onPrecedente} onClick={onPrecedente} aria-label="Publication précédente" data-calendrier-apercu-precedent>
              <ChevronLeft className="h-3.5 w-3.5" />
              {telephone ? null : t('Précédente')}
            </Button>
            <span className="min-w-0 flex-1 text-center text-[12.5px] tabular-nums text-muted" data-calendrier-apercu-rang={rang + 1}>
              {rang >= 0 ? t('{a} sur {b}', { a: rang + 1, b: total }) : null}
            </span>
            <Button size="sm" variant="subtle" disabled={!onSuivante} onClick={onSuivante} aria-label="Publication suivante" data-calendrier-apercu-suivant>
              {telephone ? null : t('Suivante')}
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
          <ApercuDePost reseau={reseau} marque={{ nom: projet?.name ?? '', favicon: projet?.favicon ?? null }} visuels={visuels} texte={p.texte} />
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-[12.5px] text-muted">
            <CalendarDays className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate first-letter:uppercase">{p.heure ? `${date} · ${p.heure}` : date}</span>
            {p.etape ? <EtatDePublication etape={p.etape} /> : null}
          </div>
          {p.etape === 'a_valider' ? (
            <Button className="w-full" disabled={valide} aria-busy={valide || undefined} onClick={() => void valider()} data-valider-la-publication>
              {valide ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {t('Valider')}
            </Button>
          ) : null}
          <Button variant="subtle" className="w-full gap-1.5" onClick={onOuvrirCampagne} data-lien-campagne>
            {projet ? <PastilleProjet project={projet} taille={16} /> : <ExternalLink className="h-3.5 w-3.5" />}
            {t('Campagne')}
          </Button>
        </div>
      </ZoneDefilement>
    </>
  );
}
