import * as React from 'react';
import { ArrowRight, CalendarDays, ChevronLeft, Mail } from '@/components/ui/icones';
import { bandesDeLaSemaine, caseDeplacable, decalerJour, lundisDesSemaines } from '@beluga/shared';
import { Button, ConfirmDialog, Drawer, EnteteDeFeuille, ZoneDefilement } from '@/components/ui';
import { LogoReseau } from '@/components/logos-reseaux';
import { SilhouetteMarketing } from '@/components/silhouettes';
import { PageV2 as PageEnPlace } from './page-v2';
import { Apercu, dateCourteLocale, estUnReseau, jouerUnGeste } from '@/components/communication-v2/socle/pieces';
import { usePointerDrag, type DragItem, type DropTarget } from '@/lib/dnd';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { useTelephone } from '@/lib/telephone';
import { cn } from '@/lib/utils';
import { useV2 } from './contexte';
import { usePublicationsDeLaMarque, type ContenuDuCalendrier, type PublicationV2 } from './donnees';
import { ApercuV2, dateDePublication } from './apercu-v2';
import { ChampDeDemande, EtatDePublication, MotDuChef, VIOLET } from './pieces';

const jourLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Combien de semaines s'ajoutent d'un coup en approchant d'un bord, et jusqu'où la grille peut s'étendre. */
const PAQUET_DE_SEMAINES = 8;
const SEMAINES_MAX_DE_CHAQUE_COTE = 60;
/** En descendant, les semaines suivantes s'ajoutent quand le bas approche à moins de cette distance. */
const MARGE_DU_BAS = 700;
/** En REMONTANT, les semaines précédentes ne s'ajoutent que quand le haut est RÉELLEMENT en vue. */
const MARGE_DU_HAUT = 60;
/** Une bande de campagne : sa hauteur, et l'espace sous le numéro du jour. */
const HAUTEUR_DE_BANDE = 20;
const HAUT_DES_BANDES = 26;

/** La zone qui défile autour d'un élément : le premier parent qui défile pour de vrai. */
function zoneQuiDefile(el: HTMLElement | null): HTMLElement | null {
  let repli: HTMLElement | null = null;
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o !== 'auto' && o !== 'scroll') continue;
    if (p.scrollHeight > p.clientHeight) return p;
    repli ??= p;
  }
  return repli;
}

/** Le mois auquel appartient une semaine : celui de son jeudi (une semaine à cheval compte pour le mois qui en a le plus). */
const moisDeLaSemaine = (lundi: string) => decalerJour(lundi, 3).slice(0, 7);

/** Une publication du calendrier, prête pour l'aperçu commun. */
const enPublication = (c: ContenuDuCalendrier): PublicationV2 => ({ ...(c as PublicationV2), famille: c.id, chiffres: (c as Partial<PublicationV2>).chiffres ?? null });

/**
 * ÉTAPE 3 — LE CALENDRIER AU MOIS, SANS FIN (piste A #9025 choisie par l'utilisateur, « affiché à l'infini en
 * vertical ») : les semaines en rangées de sept jours, le mois en en-tête collant, et ça DÉFILE vers le passé comme vers
 * l'avenir. Les campagnes y forment des BANDES nommées sur leurs dates (`bandesDeLaSemaine`, coupées aux bords de la
 * semaine, empilées quand elles se chevauchent) ; les publications des VIGNETTES (miniature, réseau, heure) qu'on GLISSE
 * d'un jour à l'autre (`usePointerDrag`, geste `contenu.date`, qui refuse une date passée). Un appui ouvre l'aperçu.
 * Au téléphone, la même grille en compact : des points, et un appui sur un jour ouvre ses publications en feuille.
 *
 * Les pièges du calendrier infini de l'espace actuel sont repris tels quels : semaines ajoutées AU-DESSUS sans faire
 * sauter la ligne regardée (ancrage coupé, défilement compensé avant la peinture), ajouts pilotés par le SENS du
 * défilement — jamais un observateur à large marge, qui ajoutait en cascade —, et une borne de chaque côté.
 */
export function PageCalendrier({ element }: { element: string[] }) {
  const { aller } = useV2();
  const telephone = useTelephone();
  const { donnees } = usePublicationsDeLaMarque();
  const aujourdhui = jourLocal(new Date());
  const [versAujourdhui, setVersAujourdhui] = React.useState(0);
  const [ouvert, setOuvert] = React.useState<string | null>(element[0] === 'pub' ? (element[1] ?? null) : null);
  const [jourOuvert, setJourOuvert] = React.useState<string | null>(null);
  const contenus = React.useMemo(() => (donnees?.contenus ?? []).filter((c) => !!c.datePrevue && c.etape !== 'abandonne'), [donnees]);
  const parJour = React.useMemo(() => {
    const m = new Map<string, ContenuDuCalendrier[]>();
    for (const c of contenus) m.set(c.datePrevue!, [...(m.get(c.datePrevue!) ?? []), c]);
    for (const l of m.values()) l.sort((a, b) => (a.heurePrevue ?? '').localeCompare(b.heurePrevue ?? ''));
    return m;
  }, [contenus]);
  const campagnes = donnees?.campagnes ?? [];
  const publicationOuverte = ouvert ? contenus.find((c) => c.id === ouvert) ?? (donnees?.contenus ?? []).find((c) => c.id === ouvert) ?? null : null;
  const fermerLApercu = () => setOuvert(null);
  return (
    <PageEnPlace
      titre={t('Calendrier')}
      sousTitre={t('Glissez une publication pour changer son jour')}
      droite={
        <Button size="sm" variant="subtle" onClick={() => setVersAujourdhui((n) => n + 1)} data-v2-aujourdhui>
          <CalendarDays className="h-3.5 w-3.5" />
          {t('Aujourd’hui')}
        </Button>
      }
      invite={null}
      pied={<ChampDeDemande invite={t('Demander un changement du calendrier…')} genre="calendrier" preparation={t('Le chef met le calendrier à jour…')} repere="calendrier" />}
      data-v2-calendrier
    >
      <MotDuChef genres={['calendrier']} />
      {!donnees ? (
        <SilhouetteMarketing />
      ) : (
        <GrilleInfinie
          aujourdhui={aujourdhui}
          versAujourdhui={versAujourdhui}
          parJour={parJour}
          campagnes={campagnes}
          compacte={telephone}
          onOuvrir={(c) => setOuvert(c.id)}
          onJour={(j) => setJourOuvert(j)}
          onCampagne={(id) => aller('campagnes', id)}
          contenus={contenus}
        />
      )}
      <Drawer feuille open={!!publicationOuverte || !!jourOuvert} onClose={() => (publicationOuverte ? fermerLApercu() : setJourOuvert(null))}>
        {publicationOuverte ? (
          <>
            <EnteteDeFeuille
              titre={publicationOuverte.titre}
              {...(jourOuvert
                ? {
                    gauche: (
                      <Button size="icon-barre" variant="ghost" aria-label="Retour au jour" onClick={fermerLApercu} data-v2-retour-jour>
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                    ),
                  }
                : {})}
              data-v2-feuille-publication={publicationOuverte.id}
            />
            <ZoneDefilement className="px-4 pb-4">
              <div className="mx-auto flex w-full max-w-[440px] flex-col gap-3">
                <ApercuV2 key={publicationOuverte.id} membres={[enPublication(publicationOuverte)]} {...(publicationOuverte.campagneId ? { campagneId: publicationOuverte.campagneId } : {})} />
                {publicationOuverte.campagneId ? (
                  <Button variant="subtle" className="w-full" onClick={() => aller('campagnes', publicationOuverte.campagneId!, 'pub', publicationOuverte.id)} data-v2-ouvrir-sa-campagne>
                    {t('Ouvrir sa campagne')}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            </ZoneDefilement>
          </>
        ) : jourOuvert ? (
          <>
            <EnteteDeFeuille titre={new Date(`${jourOuvert}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} data-v2-feuille-jour={jourOuvert} />
            <ZoneDefilement className="px-4 pb-4">
              {(parJour.get(jourOuvert) ?? []).length ? (
                <ul className="flex flex-col overflow-hidden rounded-xl bg-surface">
                  {(parJour.get(jourOuvert) ?? []).map((c) => (
                    <li key={c.id}>
                      <button type="button" className="flex w-full min-w-0 items-center gap-2.5 border-t border-faint/15 px-3 py-2.5 text-left first:border-0 hover:bg-raised" onClick={() => setOuvert(c.id)} data-v2-ligne-jour={c.id}>
                        <Apercu piece={c.apercu?.attachmentId ?? null} genre={c.apercu?.genre ?? 'image'} taille={36} />
                        <span className="min-w-0 flex-1">
                          <b className="block truncate text-[13.5px] font-semibold text-text">{c.titre}</b>
                          <span className="block truncate text-[12px] text-muted first-letter:uppercase">{dateDePublication(c)}</span>
                        </span>
                        <EtatDePublication etape={c.etape} envoiChrome={c.envoiChrome} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-4 text-center text-[13px] text-muted">{t('Rien de prévu ce jour-là.')}</p>
              )}
            </ZoneDefilement>
          </>
        ) : null}
      </Drawer>
    </PageEnPlace>
  );
}

function GrilleInfinie({
  aujourdhui,
  versAujourdhui,
  parJour,
  campagnes,
  contenus,
  compacte,
  onOuvrir,
  onJour,
  onCampagne,
}: {
  aujourdhui: string;
  versAujourdhui: number;
  parJour: Map<string, ContenuDuCalendrier[]>;
  campagnes: readonly { id: string; titre: string; debut?: string | null; fin?: string | null }[];
  contenus: readonly ContenuDuCalendrier[];
  compacte: boolean;
  onOuvrir: (c: ContenuDuCalendrier) => void;
  onJour: (jour: string) => void;
  onCampagne: (id: string) => void;
}) {
  const [bornes, setBornes] = React.useState({ avant: 6, apres: 14 });
  const lundis = React.useMemo(() => lundisDesSemaines(aujourdhui, bornes.avant, bornes.apres), [aujourdhui, bornes.avant, bornes.apres]);
  const racine = React.useRef<HTMLDivElement | null>(null);
  const haut = React.useRef<HTMLDivElement | null>(null);
  const bas = React.useRef<HTMLDivElement | null>(null);
  const ajoutAuDessus = React.useRef<{ zone: HTMLElement; hauteur: number; top: number } | null>(null);
  const bornesLues = React.useRef(bornes);
  bornesLues.current = bornes;

  const ajouterAvant = React.useCallback(() => {
    if (bornesLues.current.avant >= SEMAINES_MAX_DE_CHAQUE_COTE) return;
    const zone = zoneQuiDefile(racine.current);
    /* L'ANCRAGE DU NAVIGATEUR EST COUPÉ LE TEMPS DE L'AJOUT : Safari ne compense pas seul, Chrome si — compenser à la
       main par-dessus faisait sauter la rangée du double. */
    if (zone) {
      zone.style.overflowAnchor = 'none';
      ajoutAuDessus.current = { zone, hauteur: zone.scrollHeight, top: zone.scrollTop };
    }
    setBornes((b) => (b.avant >= SEMAINES_MAX_DE_CHAQUE_COTE ? b : { ...b, avant: Math.min(SEMAINES_MAX_DE_CHAQUE_COTE, b.avant + PAQUET_DE_SEMAINES) }));
  }, []);
  /* LA RANGÉE REGARDÉE NE SAUTE PAS : la hauteur ajoutée au-dessus est rendue au défilement, avant la peinture. */
  React.useLayoutEffect(() => {
    const a = ajoutAuDessus.current;
    if (!a) return;
    ajoutAuDessus.current = null;
    a.zone.scrollTop = a.top + (a.zone.scrollHeight - a.hauteur);
    a.zone.style.overflowAnchor = '';
  }, [bornes.avant]);

  /* LES SEMAINES S'AJOUTENT SUR UN DÉFILEMENT RÉEL, SELON SON SENS : au-dessus seulement en REMONTANT (le haut en vue),
     au-dessous seulement en DESCENDANT. La compensation (vers le bas) ne relance donc jamais un ajout au-dessus. */
  React.useEffect(() => {
    const zone = zoneQuiDefile(racine.current);
    if (!zone) return;
    let dernier = zone.scrollTop;
    let image = 0;
    const regarder = () => {
      image = 0;
      const top = zone.scrollTop;
      const sens = top - dernier;
      dernier = top;
      if (ajoutAuDessus.current) return;
      const cadre = zone.getBoundingClientRect();
      if (sens > 0 && bas.current && bas.current.getBoundingClientRect().top - cadre.bottom < MARGE_DU_BAS) {
        setBornes((b) => (b.apres >= SEMAINES_MAX_DE_CHAQUE_COTE ? b : { ...b, apres: Math.min(SEMAINES_MAX_DE_CHAQUE_COTE, b.apres + PAQUET_DE_SEMAINES) }));
      }
      if (sens < 0 && haut.current && haut.current.getBoundingClientRect().bottom > cadre.top - MARGE_DU_HAUT) ajouterAvant();
    };
    const auDefilement = () => {
      if (!image) image = window.requestAnimationFrame(regarder);
    };
    zone.addEventListener('scroll', auDefilement, { passive: true });
    return () => {
      zone.removeEventListener('scroll', auDefilement);
      window.cancelAnimationFrame(image);
    };
  }, [ajouterAvant]);

  /* À L'OUVERTURE, ET À CHAQUE « AUJOURD'HUI » : la semaine du jour juste sous son mois collant, d'un coup. */
  const allerAAujourdhui = React.useCallback(() => {
    const zone = zoneQuiDefile(racine.current);
    const rangee = racine.current?.querySelector<HTMLElement>(`[data-v2-semaine="${lundisDesSemaines(aujourdhui, 0, 0)[0]}"]`);
    if (!zone || !rangee) return;
    const entete = rangee.closest('section')?.querySelector<HTMLElement>('[data-v2-mois-collant]')?.offsetHeight ?? 0;
    zone.scrollTop += rangee.getBoundingClientRect().top - zone.getBoundingClientRect().top - entete - 8;
  }, [aujourdhui]);
  React.useLayoutEffect(() => {
    allerAAujourdhui();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  React.useEffect(() => {
    if (versAujourdhui) allerAAujourdhui();
  }, [versAujourdhui, allerAAujourdhui]);

  /* LE GLISSER D'UNE VIGNETTE : seule la date change ; une publication programmée se reprogramme sur confirmation. */
  const [aConfirmer, setAConfirmer] = React.useState<{ id: string; jour: string; titre: string } | null>(null);
  const resolve = React.useCallback((el: Element): DropTarget | null => {
    const jour = el.closest('[data-v2-jour]')?.getAttribute('data-v2-jour');
    return jour ? { id: jour, kind: 'jour', position: 'inside' } : null;
  }, []);
  const deposer = React.useCallback(
    (item: DragItem, cible: DropTarget | null) => {
      if (!cible) return;
      const contenu = contenus.find((c) => c.id === item.id);
      if (!contenu || contenu.datePrevue === cible.id) return;
      if (cible.id < aujourdhui) return client.pushToast('error', t('Une publication ne se déplace pas dans le passé.'));
      if (contenu.etape === 'programme') return setAConfirmer({ id: item.id, jour: cible.id, titre: contenu.titre });
      void jouerUnGeste('contenu.date', item.id, { datePrevue: cible.id });
    },
    [contenus, aujourdhui],
  );
  const { dragging, target, start } = usePointerDrag({ resolve, onDrop: deposer, holdMs: 250 });
  const vientDeGlisser = React.useRef(false);
  React.useEffect(() => {
    if (dragging) vientDeGlisser.current = true;
  }, [dragging]);

  /* LES SEMAINES RANGÉES PAR MOIS (celui de leur jeudi) : un en-tête collant par mois, avec les jours de la semaine. */
  const parMois = React.useMemo(() => {
    const groupes: { mois: string; lundis: string[] }[] = [];
    for (const l of lundis) {
      const m = moisDeLaSemaine(l);
      const dernier = groupes[groupes.length - 1];
      if (dernier?.mois === m) dernier.lundis.push(l);
      else groupes.push({ mois: m, lundis: [l] });
    }
    return groupes;
  }, [lundis]);
  const nomsDesJours = React.useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2026, 10, 2 + i, 12)).toLocaleDateString(undefined, { weekday: compacte ? 'narrow' : 'short', timeZone: 'UTC' }).replace('.', '')), [compacte]);
  const titreDeCampagne = (id: string) => campagnes.find((c) => c.id === id)?.titre ?? '';

  return (
    <div ref={racine} className="flex min-w-0 select-none flex-col" data-v2-grille={lundis.length} data-v2-semaines-avant={bornes.avant} data-v2-semaines-apres={bornes.apres}>
      <div ref={haut} className="flex justify-center pb-1" data-v2-grille-haut>
        {bornes.avant < SEMAINES_MAX_DE_CHAQUE_COTE ? (
          <Button size="sm" variant="ghost" className="text-muted" onClick={ajouterAvant} data-v2-semaines-precedentes>
            {t('Semaines précédentes')}
          </Button>
        ) : null}
      </div>
      {parMois.map((g) => (
        <section key={g.mois} className="min-w-0" data-v2-mois={g.mois}>
          <div className="sticky top-0 z-10 bg-[var(--fond-zone-defilement,hsl(var(--bg)))] pb-1 pt-2" data-v2-mois-collant>
            <h3 className="pb-1 text-[14px] font-semibold capitalize text-text">{new Date(`${g.mois}-01T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h3>
            <div className="grid grid-cols-7 text-[11px] capitalize text-faint" aria-hidden>
              {nomsDesJours.map((j, i) => (
                <span key={i} className="px-1.5">
                  {j}
                </span>
              ))}
            </div>
          </div>
          <div className="overflow-hidden rounded-xl bg-surface">
            {g.lundis.map((lundi) => {
              const bandes = bandesDeLaSemaine(lundi, campagnes);
              const rangs = bandes.reduce((m, b) => Math.max(m, b.rang + 1), 0);
              /* AU TÉLÉPHONE, LA BANDE EST UN FIL FIN, SANS NOM, QUI NE PREND PAS L'APPUI : toucher le jour ouvre ses
                 publications (la campagne s'ouvre depuis l'aperçu). Sur ordinateur, la bande nommée s'ouvre d'un clic. */
              const pas = compacte ? 7 : HAUTEUR_DE_BANDE;
              const espace = HAUT_DES_BANDES + rangs * pas;
              const jours = Array.from({ length: 7 }, (_, i) => decalerJour(lundi, i));
              return (
                <div key={lundi} className="relative grid grid-cols-7 border-t border-faint/15 first:border-t-0" data-v2-semaine={lundi}>
                  {jours.map((jour) => {
                    const liste = parJour.get(jour) ?? [];
                    const estAujourdhui = jour === aujourdhui;
                    const autreMois = jour.slice(0, 7) !== g.mois;
                    const survole = !!dragging && target?.id === jour;
                    return (
                      <div
                        key={jour}
                        data-v2-jour={jour}
                        data-aujourdhui={estAujourdhui ? 'oui' : undefined}
                        role={compacte ? 'button' : undefined}
                        tabIndex={compacte ? 0 : undefined}
                        onClick={compacte ? () => onJour(jour) : undefined}
                        className={cn('relative flex min-w-0 flex-col gap-1 border-l border-faint/15 px-1 pb-1.5 first:border-l-0', compacte ? 'min-h-[64px]' : 'min-h-[112px]', jour < aujourdhui && 'bg-bg/30', survole && VIOLET.fondLeger)}
                        style={{ paddingTop: espace }}
                      >
                        <span
                          className={cn(
                            'absolute left-1 top-1.5 flex h-[20px] min-w-[20px] items-center justify-center rounded-full px-1 text-[11.5px] tabular-nums',
                            estAujourdhui ? cn(VIOLET.fond, 'font-semibold text-sur-couleur') : autreMois ? 'text-faint' : 'text-muted',
                          )}
                        >
                          {jour.endsWith('-01') && !compacte ? new Date(`${jour}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : Number(jour.slice(8))}
                        </span>
                        {compacte ? (
                          liste.length ? (
                            <span className="flex flex-wrap justify-center gap-0.5" data-v2-points={liste.length}>
                              {liste.slice(0, 4).map((c) => (
                                <span key={c.id} className={cn('h-1.5 w-1.5 rounded-full', c.etape === 'a_valider' ? 'bg-comprehension' : c.etape === 'publie' ? 'bg-muted' : 'bg-text')} />
                              ))}
                            </span>
                          ) : null
                        ) : (
                          <>
                            {liste.slice(0, 3).map((c) => (
                              <Vignette
                                key={c.id}
                                c={c}
                                glisse={dragging?.id === c.id}
                                onPointerDown={(e) => {
                                  if (!caseDeplacable(c.etape)) return;
                                  vientDeGlisser.current = false;
                                  start(e, { id: c.id, kind: 'contenu', label: c.titre });
                                }}
                                onClick={() => {
                                  if (!vientDeGlisser.current) onOuvrir(c);
                                  vientDeGlisser.current = false;
                                }}
                              />
                            ))}
                            {liste.length > 3 ? (
                              <button type="button" className="self-start rounded px-1 text-[11px] text-muted hover:bg-raised hover:text-text" onClick={() => onJour(jour)} data-v2-plus={jour}>
                                {t('+{n} de plus', { n: liste.length - 3 })}
                              </button>
                            ) : null}
                          </>
                        )}
                      </div>
                    );
                  })}
                  {bandes.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCampagne(b.id);
                      }}
                      title={titreDeCampagne(b.id)}
                      tabIndex={compacte ? -1 : undefined}
                      className={cn('absolute flex items-center overflow-hidden px-1.5 text-left text-[11px] font-medium text-text', compacte ? 'pointer-events-none bg-text/[0.22]' : 'bg-text/[0.13] hover:bg-text/[0.2]', b.suiteAvant ? 'rounded-l-none' : 'rounded-l-md', b.suiteApres ? 'rounded-r-none' : 'rounded-r-md')}
                      style={{ top: HAUT_DES_BANDES - 2 + b.rang * pas, height: pas - (compacte ? 3 : 4), left: `calc(${(b.de / 7) * 100}% + ${b.suiteAvant ? 0 : 3}px)`, width: `calc(${((b.a - b.de + 1) / 7) * 100}% - ${(b.suiteAvant ? 0 : 3) + (b.suiteApres ? 0 : 3)}px)` }}
                      data-v2-bande={b.id}
                      data-de={b.de}
                      data-a={b.a}
                      data-rang={b.rang}
                    >
                      <span className="min-w-0 truncate">{compacte ? '' : titreDeCampagne(b.id)}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <div ref={bas} className="h-px" data-v2-grille-bas />
      <ConfirmDialog
        open={!!aConfirmer}
        onClose={() => setAConfirmer(null)}
        title={t('Reprogrammer cette publication ?')}
        description={aConfirmer ? t('« {titre} » partira le {jour}, à la place de la date prévue.', { titre: aConfirmer.titre, jour: dateCourteLocale(aConfirmer.jour) }) : ''}
        confirmLabel={t('Reprogrammer')}
        onConfirm={() => {
          if (aConfirmer) void jouerUnGeste('contenu.date', aConfirmer.id, { datePrevue: aConfirmer.jour });
          setAConfirmer(null);
        }}
      />
    </div>
  );
}

/** UNE PUBLICATION DANS SA CASE : la miniature, le réseau, l'heure ; elle se glisse, et un appui l'ouvre. */
function Vignette({ c, glisse, onPointerDown, onClick }: { c: ContenuDuCalendrier; glisse: boolean; onPointerDown: (e: React.PointerEvent) => void; onClick: () => void }) {
  const reseau = c.canaux.find(estUnReseau);
  return (
    <div
      role="button"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      title={c.envoiChrome === 'attente-chrome' ? t('{titre} — attend Chrome : il partira dès sa réouverture.', { titre: c.titre }) : c.titre}
      className={cn(
        'flex min-w-0 cursor-pointer items-center gap-1 rounded-md bg-raised px-1 py-0.5 outline-none hover:bg-fond-survol focus-visible:ring-1 focus-visible:ring-faint',
        c.etape === 'a_valider' && 'ring-1 ring-inset ring-comprehension',
        c.envoiChrome === 'attente-chrome' && 'ring-1 ring-inset ring-danger',
        caseDeplacable(c.etape) && 'cursor-grab',
        glisse && 'opacity-40',
      )}
      data-v2-vignette={c.id}
      data-etape={c.etape}
      data-v2-envoi-chrome={c.envoiChrome ?? undefined}
    >
      <Apercu piece={c.apercu?.attachmentId ?? null} genre={c.apercu?.genre ?? 'image'} taille={22} className="rounded" />
      {reseau ? <LogoReseau reseau={reseau} className="h-3 w-3 shrink-0" /> : <Mail className="h-3 w-3 shrink-0 text-muted" />}
      <span className="min-w-0 flex-1 truncate text-[11px] leading-4 text-text">{c.heurePrevue ?? c.titre}</span>
    </div>
  );
}
