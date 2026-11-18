import * as React from 'react';
import {
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  EllipsisVertical,
  File,
  Folder,
  FolderOpen,
  FolderSearch,
  FolderTree,
  HardDrive,
  Link2,
  Loader2,
  RefreshCw,
  Sparkles,
} from '@/components/ui/icones';
import {
  cransDansLeDisque,
  dossierParent,
  tailleEnClair,
  formaterVariation,
  partOccupee,
  type ElementLourd,
  type EntreeDeDossier,
  type FicheDeLaMachine,
} from '@beluga/shared';
import {
  Button,
  CLASSE_GROUPE_DE_LIGNES,
  CLASSE_LIGNE_DE_GROUPE,
  Dialog,
  DialogContentLibre,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Gauge,
  Tooltip,
  ZoneDefilement,
} from '@/components/ui';
import { Silhouette } from '@/components/silhouettes';
import { Groupe } from '@/components/reglages/communs';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { lancerIntervalleVisible } from '@/lib/veille';
import { useTelephone } from '@/lib/telephone';
import { cn, elapsed } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Les données lues au démon (`server/src/occupation-disque.ts`)        */
/* ------------------------------------------------------------------ */

interface ReponseFiche {
  fiche: FicheDeLaMachine;
  capacite: { at: number; loadPct: number; memUsedMb: number; running: number }[];
  disques: { at: number; disques: { montage: string; utilise: number; taille: number }[] }[];
  hebergee: boolean;
}

interface EtatDesPlusLourds {
  elements: ElementLourd[];
  enCours: string[];
  releveLe?: number;
  veilleLe?: number;
  partiel?: boolean;
  erreurs?: { montage: string; message: string }[];
}

/** Un disque, racine de l'arbre de l'explorateur. */
interface RacineDeLExplorateur {
  montage: string;
  externe: boolean;
  taille: number;
  utilise: number;
  injoignable?: boolean;
}

interface ContenuDuDossier {
  chemin: string;
  montage: string;
  disques: RacineDeLExplorateur[];
  entrees: EntreeDeDossier[];
  tailles: 'mesurees' | 'releve' | 'aucune';
  taillesLe?: number;
  mesureEnCours?: boolean;
  tronque?: number;
  erreur?: string;
}

/** Le nom d'un disque, en mots courants. */
function nomDuDisque(montage: string, externe: boolean): string {
  if (montage === '/') return t('Disque du serveur');
  return externe ? t('Disque externe') : t('Disque');
}

function duree(secondes: number): string {
  const jours = Math.floor(secondes / 86_400);
  const heures = Math.floor((secondes % 86_400) / 3_600);
  if (jours) return t('{j} j {h} h', { j: jours, h: heures });
  return t('{h} h {m} min', { h: heures, m: Math.floor((secondes % 3_600) / 60) });
}

/* ------------------------------------------------------------------ */
/* La fiche de la machine et ses courbes                                 */
/* ------------------------------------------------------------------ */

/**
 * LA FICHE ET LES COURBES. Demandées par la page elle-même, jamais par
 * l'enveloppe des réglages : une page qu'on n'ouvre pas ne demande rien. La
 * fiche se relit toutes les 30 s tant que la page est à l'écran.
 */
export function useFicheDuServeur(): ReponseFiche | null {
  const [donnees, setDonnees] = React.useState<ReponseFiche | null>(null);
  React.useEffect(() => {
    let vivant = true;
    const lire = () =>
      client
        .call<ReponseFiche>({ type: 'serveur.fiche' })
        .then((d) => vivant && setDonnees(d))
        .catch(() => undefined);
    lire();
    const arret = lancerIntervalleVisible(lire, 30_000);
    return () => {
      vivant = false;
      arret();
    };
  }, []);
  return donnees;
}

export function FicheDeLaMachineVue({ donnees }: { donnees: ReponseFiche | null }) {
  if (!donnees) {
    return (
      <div aria-busy="true" data-silhouette="fiche-serveur" className="space-y-2">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Silhouette key={i} className="h-[68px] rounded-xl" />
          ))}
        </div>
        <Silhouette className="h-[60px] w-full rounded-xl" />
      </div>
    );
  }
  const { fiche } = donnees;
  const memoireUtilisee = fiche.memoireTotale - fiche.memoireDisponible;
  return (
    <div className="space-y-2" data-fiche-serveur>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tuile
          titre={t('Adresse IP')}
          valeur={fiche.ipv4[0] ?? fiche.ipv6[0] ?? t('Aucune')}
          detail={fiche.ipv4[0] && fiche.ipv6[0] ? fiche.ipv6[0] : fiche.nom}
          reperes={{ 'data-fiche-ip': fiche.ipv4[0] ?? '' }}
        />
        <Tuile
          titre={t('Processeur')}
          valeur={t('{n} vCPU', { n: fiche.coeurs })}
          detail={fiche.processeur || fiche.systeme}
          reperes={{ 'data-fiche-vcpu': fiche.coeurs }}
        />
        <Tuile
          titre={t('Mémoire vive')}
          valeur={tailleEnClair(fiche.memoireTotale)}
          detail={t('{v} libres', { v: tailleEnClair(fiche.memoireDisponible) })}
          barre={Math.round((memoireUtilisee / Math.max(1, fiche.memoireTotale)) * 100)}
        />
        <Tuile titre={t('Système')} valeur={fiche.nom} detail={t('{s} · allumé depuis {d}', { s: fiche.systeme, d: duree(fiche.demarreeDepuis) })} />
      </div>

      <div className={CLASSE_GROUPE_DE_LIGNES} data-disques-serveur>
        {fiche.disques.map((disque) => {
          const pct = partOccupee(disque);
          return (
            <div key={disque.montage} className="rounded-xl px-1.5 py-2.5" data-disque={disque.montage}>
              <div className="flex items-baseline gap-2">
                <span className="shrink-0 text-[14px] text-text">{nomDuDisque(disque.montage, disque.externe)}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-faint">{disque.montage}</span>
                <span className="shrink-0 text-[13px] font-medium text-text">{pct} %</span>
              </div>
              <Gauge value={pct} tone={pct >= 90 ? 'auto' : 'neutral'} height="h-1.5" className="mt-1.5" />
              <p className="mt-1 text-[12px] text-muted">
                {t('{u} utilisés sur {s} — {l} libres', {
                  u: tailleEnClair(disque.utilise),
                  s: tailleEnClair(disque.taille),
                  l: tailleEnClair(disque.libre),
                })}
              </p>
            </div>
          );
        })}
        {fiche.disquesInjoignables ? (
          <p className="px-1.5 py-2 text-[12.5px] text-muted" data-disque-injoignable>
            {t('Le stockage externe ne répond pas en ce moment : seuls les disques de la machine sont affichés.')}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Tuile({
  titre,
  valeur,
  detail,
  barre,
  reperes,
}: {
  titre: string;
  valeur: string;
  detail?: string;
  barre?: number;
  reperes?: Record<string, string | number>;
}) {
  return (
    <div className="min-w-0 rounded-xl bg-surface px-3 py-2.5" {...reperes}>
      <p className="truncate text-[11.5px] uppercase tracking-wide text-faint">{titre}</p>
      <p className="mt-0.5 truncate text-[15px] font-medium text-text">{valeur}</p>
      {barre !== undefined ? <Gauge value={barre} tone="neutral" height="h-1" className="mt-1" /> : null}
      {detail ? <p className="mt-0.5 truncate text-[11.5px] text-faint" title={detail}>{detail}</p> : null}
    </div>
  );
}

/** Les trois courbes : processeur et mémoire sur 24 h, disques sur 30 jours. */
export function CourbesDuServeur({ donnees }: { donnees: ReponseFiche | null }) {
  if (!donnees) {
    return (
      <div aria-busy="true" data-silhouette="courbes-serveur" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Silhouette key={i} className="h-[112px] rounded-xl" />
        ))}
      </div>
    );
  }
  const memTotaleMo = donnees.fiche.memoireTotale / 1024 / 1024;
  const processeur = donnees.capacite.map((p) => ({ at: p.at, v: p.loadPct }));
  const memoire = donnees.capacite.map((p) => ({ at: p.at, v: (p.memUsedMb / Math.max(1, memTotaleMo)) * 100 }));
  const montages = donnees.fiche.disques.map((d) => d.montage);
  const series = montages.map((montage) => ({
    montage,
    points: donnees.disques
      .map((p) => {
        const d = p.disques.find((x) => x.montage === montage);
        return d ? { at: p.at, v: (d.utilise / Math.max(1, d.taille)) * 100 } : null;
      })
      .filter((p): p is { at: number; v: number } => !!p),
  }));
  const dernier = (points: { v: number }[]) => (points.length ? `${Math.round(points[points.length - 1].v)} %` : '—');
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" data-courbes-serveur>
      <Courbe titre={t('Processeur')} valeur={dernier(processeur)} periode={t('24 heures')} series={[{ points: processeur }]} reperes="processeur" />
      <Courbe titre={t('Mémoire vive')} valeur={dernier(memoire)} periode={t('24 heures')} series={[{ points: memoire }]} reperes="memoire" />
      <Courbe
        titre={t('Disques')}
        valeur={dernier(series[0]?.points ?? [])}
        periode={t('30 jours')}
        series={series.map((s, i) => ({ points: s.points, attenuee: i > 0 }))}
        legende={series.length > 1 ? t('Trait plein : disque du serveur · pointillé : disque externe') : undefined}
        reperes="disques"
      />
    </div>
  );
}

/**
 * UNE COURBE MAISON, sans bibliothèque : une aire grise de 0 à 100 %, l'heure
 * de début et « maintenant » sous elle. Monochrome : la teinte est réservée à
 * ce que fait l'agent et à l'élément choisi.
 */
function Courbe({
  titre,
  valeur,
  periode,
  series,
  legende,
  reperes,
}: {
  titre: string;
  valeur: string;
  periode: string;
  series: { points: { at: number; v: number }[]; attenuee?: boolean }[];
  legende?: string;
  reperes: string;
}) {
  const largeur = 300;
  const hauteur = 56;
  const tous = series.flatMap((s) => s.points);
  const debut = Math.min(...tous.map((p) => p.at));
  const fin = Math.max(...tous.map((p) => p.at));
  const x = (at: number) => ((at - debut) / Math.max(1, fin - debut)) * largeur;
  const y = (v: number) => hauteur - (Math.max(0, Math.min(100, v)) / 100) * hauteur;
  const assez = tous.length >= 2;
  return (
    <div className="min-w-0 rounded-xl bg-surface px-3 py-2.5" data-courbe={reperes}>
      <div className="flex items-baseline gap-2">
        <p className="min-w-0 flex-1 truncate text-[11.5px] uppercase tracking-wide text-faint">{titre}</p>
        <p className="shrink-0 text-[14px] font-medium text-text">{valeur}</p>
      </div>
      {assez ? (
        <svg viewBox={`0 0 ${largeur} ${hauteur}`} className="mt-1.5 h-14 w-full" preserveAspectRatio="none" aria-hidden>
          <line x1="0" x2={largeur} y1={hauteur / 2} y2={hauteur / 2} stroke="hsl(var(--faint))" strokeOpacity="0.35" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          {series.map((serie, i) => {
            if (serie.points.length < 2) return null;
            const trace = serie.points.map((p, j) => `${j === 0 ? 'M' : 'L'}${x(p.at).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
            const premier = serie.points[0];
            const ultime = serie.points[serie.points.length - 1];
            return (
              <g key={i}>
                {!serie.attenuee ? (
                  <path d={`${trace} L${x(ultime.at).toFixed(1)},${hauteur} L${x(premier.at).toFixed(1)},${hauteur} Z`} fill="hsl(var(--muted))" fillOpacity="0.14" />
                ) : null}
                <path
                  d={trace}
                  fill="none"
                  stroke={serie.attenuee ? 'hsl(var(--faint))' : 'hsl(var(--muted))'}
                  strokeWidth="1.3"
                  strokeDasharray={serie.attenuee ? '3 3' : undefined}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
        </svg>
      ) : (
        <p className="mt-1.5 flex h-14 items-center text-[12px] text-faint">{t('La courbe se dessine au fil des relevés.')}</p>
      )}
      <div className="mt-1 flex justify-between gap-2 text-[11px] text-faint">
        <span className="truncate">{t('il y a {p}', { p: periode })}</span>
        <span className="shrink-0">{t('maintenant')}</span>
      </div>
      {legende ? <p className="mt-0.5 truncate text-[11px] text-faint" title={legende}>{legende}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Le ménage confié à un agent                                           */
/* ------------------------------------------------------------------ */

type EtatDuMenage = { etat: 'envoi' } | { etat: 'pose'; cardId: string; titre: string };

/**
 * « DEMANDER À UN AGENT DE FAIRE LE MÉNAGE » pose une carte dans « Planifié »
 * du projet de l'application — rien ne part au moteur. Le bouton dit son envoi
 * dès le clic, puis la ligne dit où la carte est posée.
 */
function useMenage() {
  const [menages, setMenages] = React.useState<Record<string, EtatDuMenage>>({});
  const demander = async (chemin: string) => {
    setMenages((m) => ({ ...m, [chemin]: { etat: 'envoi' } }));
    const rendu = await client.geste<{ cardId: string; title: string }>({ type: 'serveur.menage', chemin }, t('Carte de ménage'));
    setMenages((m) => {
      const suite = { ...m };
      if (rendu?.cardId) suite[chemin] = { etat: 'pose', cardId: rendu.cardId, titre: rendu.title };
      else delete suite[chemin];
      return suite;
    });
  };
  return { menages, demander };
}

function SuiteDuMenage({ etat }: { etat?: EtatDuMenage }) {
  if (!etat || etat.etat !== 'pose') return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted" data-menage-pose={etat.cardId}>
      <span>{t('Carte posée dans « Planifié » : rien ne part tant que vous ne la lancez pas.')}</span>
      <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]" onClick={() => client.openCard(etat.cardId)} data-ouvrir-carte-menage>
        {t('Voir la carte')}
        <ArrowUpRight className="h-3 w-3" />
      </Button>
    </div>
  );
}

function MenuDUnElement({
  chemin,
  etat,
  onMenage,
  onOuvrirDossier,
}: {
  chemin: string;
  etat?: EtatDuMenage;
  onMenage: () => void;
  onOuvrirDossier?: () => void;
}) {
  if (etat?.etat === 'envoi') {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center text-muted" data-menage-envoi={chemin}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="shrink-0" title={t('Options')} aria-label="Options" data-menu-element={chemin}>
          <EllipsisVertical className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onOuvrirDossier ? (
          <DropdownMenuItem onSelect={onOuvrirDossier} data-ouvrir-dossier>
            <FolderSearch className="h-3.5 w-3.5 text-muted" />
            {t('Ouvrir son dossier')}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={onMenage} data-demander-menage={chemin}>
          <Sparkles className="h-3.5 w-3.5 text-muted" />
          {t('Demander à un agent de faire le ménage')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ------------------------------------------------------------------ */
/* Les dix plus lourds                                                   */
/* ------------------------------------------------------------------ */

/** Le nom à lire en premier, et son dossier en petit dessous. */
function NomEtDossier({ chemin }: { chemin: string }) {
  const parent = dossierParent(chemin);
  const nom = chemin.split('/').filter(Boolean).pop() ?? chemin;
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[14px] text-text">{nom}</span>
      <span className="block truncate text-[11.5px] text-faint" title={chemin}>
        {parent}
      </span>
    </span>
  );
}

export function LesPlusLourds({ onParcourir }: { onParcourir: (chemin: string) => void }) {
  const [etat, setEtat] = React.useState<EtatDesPlusLourds | null>(null);
  const [relance, setRelance] = React.useState(false);
  const { menages, demander } = useMenage();
  const lire = React.useCallback(
    () =>
      client
        .call<EtatDesPlusLourds>({ type: 'serveur.lourds' })
        .then(setEtat)
        .catch(() => undefined),
    [],
  );
  React.useEffect(() => {
    void lire();
  }, [lire]);
  const enCours = (etat?.enCours.length ?? 0) > 0;
  /* Pendant un relevé, la liste se relit toutes les 15 s : elle se remplit sans qu'on touche à rien. */
  React.useEffect(() => (enCours ? lancerIntervalleVisible(() => void lire(), 15_000) : undefined), [enCours, lire]);

  const relancer = async () => {
    setRelance(true);
    const rendu = await client.geste<EtatDesPlusLourds>({ type: 'serveur.releve' }, t('Relevé de l’occupation'));
    if (rendu) setEtat(rendu);
    setRelance(false);
  };

  const plusGros = Math.max(1, ...(etat?.elements ?? []).map((e) => e.octets));

  return (
    <Groupe
      titre={t('Ce qui pèse le plus')}
      aide={t('Les dix éléments les plus lourds du serveur, fichiers et dossiers mêlés, sur le disque principal et le stockage externe. Un dossier qui ne pèse que par un de ses sous-dossiers laisse sa place à celui-ci. Le relevé tourne en arrière-plan toutes les six heures (une fois par jour pour le stockage externe) ; la variation compare au relevé de la veille.')}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <p className="min-w-0 flex-1 text-[12.5px] text-muted" data-releve-lourds={enCours ? 'en-cours' : etat?.releveLe ? 'fait' : 'aucun'}>
          {enCours ? (
            <span className="inline-flex items-center gap-1.5 text-muted">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t('Relevé en cours, en arrière-plan — la liste se met à jour toute seule.')}
            </span>
          ) : etat?.releveLe ? (
            etat.veilleLe ? (
              t('Relevé il y a {d}, comparé à celui de la veille.', { d: elapsed(etat.releveLe) })
            ) : (
              t('Relevé il y a {d}. La variation paraîtra quand un relevé de la veille existera.', { d: elapsed(etat.releveLe) })
            )
          ) : etat ? (
            t('Aucun relevé encore : le premier part tout seul quelques minutes après le démarrage du serveur.')
          ) : null}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip label={t('Relancer le relevé')}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Relancer le relevé"
              disabled={enCours || relance}
              onClick={() => void relancer()}
              data-relancer-releve
            >
              {relance ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </Button>
          </Tooltip>
          <Button variant="subtle" size="sm" onClick={() => onParcourir('/')} data-parcourir-dossiers>
            <FolderSearch className="h-3.5 w-3.5" />
            {t('Parcourir les dossiers')}
          </Button>
        </div>
      </div>

      {!etat || (enCours && !etat.elements.length) ? (
        <div aria-busy="true" data-silhouette="plus-lourds" className={cn(CLASSE_GROUPE_DE_LIGNES, 'gap-1')}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Silhouette key={i} className="h-[46px] rounded-xl" />
          ))}
        </div>
      ) : etat.elements.length ? (
        <div className={CLASSE_GROUPE_DE_LIGNES} data-plus-lourds={etat.elements.length}>
          {etat.elements.map((element) => {
            const variation = formaterVariation(element.variation);
            return (
              <div key={element.chemin} className={cn(CLASSE_LIGNE_DE_GROUPE, 'px-2 py-1.5 sm:px-2.5')} data-element-lourd={element.chemin}>
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2.5 py-1 text-left"
                    onClick={() => onParcourir(element.genre === 'dossier' ? element.chemin : dossierParent(element.chemin))}
                    title={t('Ouvrir dans l’explorateur')}
                  >
                    {element.genre === 'dossier' ? (
                      <Folder className="h-4 w-4 shrink-0 text-faint" />
                    ) : (
                      <File className="h-4 w-4 shrink-0 text-faint" />
                    )}
                    <NomEtDossier chemin={element.chemin} />
                    <span className="flex shrink-0 flex-col items-end">
                      <span className="text-[13.5px] font-medium text-text">{tailleEnClair(element.octets)}</span>
                      <span className="text-[11.5px] text-faint" data-variation={element.variation ?? ''}>
                        {variation ? t('{v} depuis la veille', { v: variation }) : element.projet ?? ''}
                      </span>
                    </span>
                  </button>
                  <MenuDUnElement
                    chemin={element.chemin}
                    etat={menages[element.chemin]}
                    onMenage={() => void demander(element.chemin)}
                    onOuvrirDossier={() => onParcourir(dossierParent(element.chemin))}
                  />
                </div>
                <div className="ml-[26px] mr-10 mt-0.5 h-0.5 overflow-hidden rounded-full bg-raised">
                  <div className="h-full rounded-full bg-faint" style={{ width: `${Math.max(2, (element.octets / plusGros) * 100)}%` }} />
                </div>
                <SuiteDuMenage etat={menages[element.chemin]} />
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-[12.5px] text-muted">{t('Rien de lourd à signaler pour l’instant.')}</p>
      )}
      {etat?.erreurs?.length ? (
        <p className="text-[12px] text-danger" data-erreur-releve>
          {etat.erreurs.map((e) => `${e.montage} : ${e.message}`).join(' · ')}
        </p>
      ) : null}
    </Groupe>
  );
}

/* ------------------------------------------------------------------ */
/* L'explorateur, par-dessus les réglages                                */
/* ------------------------------------------------------------------ */

/** Le nom d'une racine de l'arbre : le disque du serveur, le disque externe. */
function nomDeLaRacine(racine: RacineDeLExplorateur, racines: readonly RacineDeLExplorateur[]): string {
  if (racine.montage === '/') return t('Disque du serveur');
  if (racine.externe) {
    const externes = racines.filter((r) => r.externe);
    return externes.length > 1 ? `${t('Disque externe')} · ${racine.montage.split('/').pop()}` : t('Disque externe');
  }
  return `${t('Disque')} ${racine.montage}`;
}

/** « il y a 3 min », ou « à l'instant » sous la minute (jamais « il y a — »). */
function ilYA(at: number): string {
  return Date.now() - at < 60_000 ? t('à l’instant') : t('il y a {p}', { p: elapsed(at) });
}

/** Tant d'enfants au plus dans un nœud de l'arbre : la liste de droite, elle, les montre tous. */
const ENFANTS_MAX_DANS_L_ARBRE = 200;

interface ContexteDeLArbre {
  courant: string;
  ouverts: Set<string>;
  listages: Record<string, ContenuDuDossier>;
  basculer: (chemin: string) => void;
  aller: (chemin: string) => void;
  lister: (chemin: string) => void;
}

function NoeudDuServeur({ chemin, nom, profondeur, ctx }: { chemin: string; nom: string; profondeur: number; ctx: ContexteDeLArbre }) {
  const ouvert = ctx.ouverts.has(chemin);
  const choisi = ctx.courant === chemin;
  const Icone = ouvert ? FolderOpen : Folder;
  return (
    <li>
      <div
        className={cn('flex h-8 items-center gap-1 rounded-md pr-2 text-[13px]', choisi ? 'bg-teinte-fond text-text' : 'text-muted hover:bg-raised hover:text-text')}
        style={{ paddingLeft: 4 + profondeur * 14 }}
        data-noeud-serveur={chemin}
        aria-current={choisi ? 'true' : undefined}
      >
        <button type="button" aria-label={ouvert ? 'Replier' : 'Déplier'} title={ouvert ? t('Replier') : t('Déplier')} className="flex h-6 w-5 shrink-0 items-center justify-center rounded text-faint hover:text-text" onClick={() => ctx.basculer(chemin)}>
          {ouvert ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => ctx.aller(chemin)}>
          <Icone className={cn('h-3.5 w-3.5 shrink-0', choisi && 'text-teinte')} />
          <span className="min-w-0 flex-1 truncate">{nom}</span>
        </button>
      </div>
      {ouvert ? <EnfantsDuNoeud chemin={chemin} profondeur={profondeur} ctx={ctx} /> : null}
    </li>
  );
}

function EnfantsDuNoeud({ chemin, profondeur, ctx }: { chemin: string; profondeur: number; ctx: ContexteDeLArbre }) {
  const contenu = ctx.listages[chemin];
  const { lister } = ctx;
  React.useEffect(() => {
    if (!contenu) lister(chemin);
  }, [contenu, chemin, lister]);
  if (!contenu) {
    return (
      <div className="py-1.5" style={{ paddingLeft: 26 + profondeur * 14 }}>
        <Silhouette className="h-3 w-24" />
      </div>
    );
  }
  const dossiers = contenu.entrees.filter((e) => e.genre === 'dossier').sort((a, b) => a.nom.localeCompare(b.nom));
  if (!dossiers.length) return null;
  const montres = dossiers.slice(0, ENFANTS_MAX_DANS_L_ARBRE);
  return (
    <ul>
      {montres.map((d) =>
        d.disque ? (
          /* Le point de montage du disque externe : un lien vers SA racine, jamais déplié ici. */
          <li key={d.chemin}>
            <button
              type="button"
              className="flex h-8 w-full items-center gap-1.5 rounded-md pr-2 text-left text-[13px] text-muted hover:bg-raised hover:text-text"
              style={{ paddingLeft: 4 + (profondeur + 1) * 14 + 24 }}
              onClick={() => ctx.aller(d.disque!)}
              title={t('Ouvrir le disque externe')}
              data-lien-disque-arbre={d.disque}
            >
              <HardDrive className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{d.nom}</span>
              <ArrowUpRight className="h-3 w-3 shrink-0 text-faint" />
            </button>
          </li>
        ) : (
          <NoeudDuServeur key={d.chemin} chemin={d.chemin} nom={d.nom} profondeur={profondeur + 1} ctx={ctx} />
        ),
      )}
      {dossiers.length > montres.length ? (
        <li className="py-1 text-[11.5px] text-faint" style={{ paddingLeft: 30 + (profondeur + 1) * 14 }}>
          {t('{n} autres dossiers, dans la liste de droite', { n: dossiers.length - montres.length })}
        </li>
      ) : null}
    </ul>
  );
}

/**
 * UN DISQUE, RACINE DE L'ARBRE : son nom et sa jauge. Les disques se posent
 * côte à côte en tête du volet, toujours visibles ; l'arbre dessous est celui
 * du disque choisi.
 */
function RacineDuServeur({ racine, racines, active, onChoisir }: { racine: RacineDeLExplorateur; racines: readonly RacineDeLExplorateur[]; active: boolean; onChoisir: () => void }) {
  const part = racine.taille ? Math.round((racine.utilise / racine.taille) * 100) : 0;
  return (
    <button
      type="button"
      onClick={onChoisir}
      className={cn('flex w-full min-w-0 flex-col rounded-lg px-2.5 pb-2 pt-1 text-left transition-colors', active ? 'bg-teinte-fond' : 'hover:bg-raised')}
      aria-current={active ? 'true' : undefined}
      data-racine-serveur={racine.montage}
      data-externe={racine.externe ? 'oui' : 'non'}
    >
      <span className="flex h-7 min-w-0 items-center gap-2 text-[13.5px] font-medium text-text">
        <HardDrive className={cn('h-4 w-4 shrink-0', active ? 'text-teinte' : 'text-muted')} />
        <span className="min-w-0 flex-1 truncate">{nomDeLaRacine(racine, racines)}</span>
        <span className="shrink-0 text-[11.5px] font-normal tabular-nums text-faint">{racine.injoignable ? '' : `${part} %`}</span>
      </span>
      <span className="pl-6">
        <Gauge value={part} tone="neutral" height="h-1" />
        <span className="mt-1 block truncate text-[11px] text-faint">
          {racine.injoignable
            ? t('injoignable en ce moment')
            : t('{u} utilisés sur {s} — {l} libres', { u: tailleEnClair(racine.utilise), s: tailleEnClair(racine.taille), l: tailleEnClair(Math.max(0, racine.taille - racine.utilise)) })}
        </span>
      </span>
    </button>
  );
}

/**
 * L'EXPLORATEUR EN LECTURE SEULE. Une fenêtre posée PAR-DESSUS la fenêtre des
 * réglages (une feuille du bas sur téléphone, comme toute fenêtre) : Échap ou
 * la croix la referment seule, les réglages restent ouverts dessous.
 *
 *  - À GAUCHE, L'ARBRE : deux racines, le disque du serveur et le disque
 *    externe, chacune avec sa jauge. Le point de montage du disque externe,
 *    sous « /mnt », n'est qu'un lien vers sa racine.
 *  - À DROITE, LE DOSSIER POINTÉ : listé tout de suite avec les tailles déjà
 *    connues (dernier relevé, mesures récentes), puis mesuré en arrière-plan —
 *    les tailles se mettent à jour seules. « Recalculer ce dossier » refait la
 *    mesure de CE dossier (ses entrées directes), jamais tout le disque.
 *  - Sur téléphone, un volet à la fois : le dossier, et l'arbre sur demande.
 *
 * On n'y fait rien d'autre que regarder, et demander le ménage à un agent.
 */
export function ExplorateurDuServeur({ chemin, onChemin, onClose }: { chemin: string | null; onChemin: (chemin: string) => void; onClose: () => void }) {
  const telephone = useTelephone();
  const [listages, setListages] = React.useState<Record<string, ContenuDuDossier>>({});
  const [erreurs, setErreurs] = React.useState<Record<string, string>>({});
  const [mesures, setMesures] = React.useState<Record<string, 'auto' | 'force'>>({});
  const [erreurDeMesure, setErreurDeMesure] = React.useState<{ chemin: string; message: string } | null>(null);
  const [ouverts, setOuverts] = React.useState<Set<string>>(() => new Set());
  const [vueArbre, setVueArbre] = React.useState(false);
  const [racines, setRacines] = React.useState<RacineDeLExplorateur[]>([]);
  const { menages, demander } = useMenage();
  const enListage = React.useRef(new Set<string>());

  const recevoir = React.useCallback((c: ContenuDuDossier) => {
    setListages((l) => ({ ...l, [c.chemin]: c }));
    if (c.disques?.length) setRacines(c.disques);
  }, []);

  const lister = React.useCallback(
    (vers: string): Promise<ContenuDuDossier | null> => {
      if (enListage.current.has(vers)) return Promise.resolve(null);
      enListage.current.add(vers);
      return client
        .call<ContenuDuDossier>({ type: 'serveur.dossier', chemin: vers }, 30_000)
        .then((c) => {
          recevoir(c);
          setErreurs(({ [vers]: _e, ...reste }) => reste);
          return c;
        })
        .catch((err: any) => {
          setErreurs((e) => ({ ...e, [vers]: err?.message ?? t('Ce dossier ne peut pas être lu.') }));
          return null;
        })
        .finally(() => enListage.current.delete(vers));
    },
    [recevoir],
  );

  /* LA MESURE D'UN DOSSIER : la réponse range les tailles dans SON dossier —
     arrivée après qu'on est passé ailleurs, elle remplit le cache sans toucher
     à ce qui est affiché. */
  const mesurer = React.useCallback(
    (vers: string, force: boolean) => {
      setMesures((m) => ({ ...m, [vers]: force ? 'force' : 'auto' }));
      if (force) setErreurDeMesure(null);
      client
        .call<ContenuDuDossier & { mesure: string }>({ type: 'serveur.dossier.tailles', chemin: vers, force }, 11 * 60_000)
        .then((c) => recevoir(c))
        .catch((err: any) => force && setErreurDeMesure({ chemin: vers, message: err?.message ?? t('La mesure n’a pas abouti.') }))
        .finally(() => setMesures(({ [vers]: _m, ...reste }) => reste));
    },
    [recevoir],
  );

  /* Ouvrir un dossier : la liste d'abord (instantanée), la mesure ensuite. */
  React.useEffect(() => {
    if (!chemin) return;
    setVueArbre(false);
    let vivant = true;
    void lister(chemin).then((c) => {
      if (vivant && c && !c.erreur && c.entrees.some((e) => e.genre === 'dossier' && !e.disque)) mesurer(chemin, false);
    });
    return () => {
      vivant = false;
    };
  }, [chemin, lister, mesurer]);

  const contenu = chemin ? listages[chemin] : undefined;
  const montage = contenu?.montage ?? racines.filter((r) => chemin && (r.montage === '/' || chemin === r.montage || chemin.startsWith(`${r.montage}/`))).sort((a, b) => b.montage.length - a.montage.length)[0]?.montage ?? '/';

  /* L'arbre suit le dossier pointé : sa racine et chaque cran sont dépliés. */
  React.useEffect(() => {
    if (!chemin) return;
    setOuverts((o) => {
      const suite = new Set(o);
      for (const cran of cransDansLeDisque(chemin, montage)) if (cran.chemin !== chemin) suite.add(cran.chemin);
      suite.add(montage);
      return suite.size === o.size ? o : suite;
    });
  }, [chemin, montage]);

  const ctx: ContexteDeLArbre = {
    courant: chemin ?? '',
    ouverts,
    listages,
    basculer: (c) =>
      setOuverts((o) => {
        const suite = new Set(o);
        if (suite.has(c)) suite.delete(c);
        else suite.add(c);
        return suite;
      }),
    aller: (c) => {
      setVueArbre(false);
      onChemin(c);
    },
    lister: (c) => void lister(c),
  };

  const racine = racines.find((r) => r.montage === montage);
  const crans = chemin ? cransDansLeDisque(chemin, montage) : [];
  /* Un chemin long ne tient pas sur un téléphone : la racine, « … », puis les deux derniers crans. */
  const montres = crans.length > 4 ? [crans[0], null, ...crans.slice(-2)] : crans;
  const total = (contenu?.entrees ?? []).reduce((s, e) => s + (e.octets ?? 0), 0);
  const enMesure = !!(chemin && (mesures[chemin] || contenu?.mesureEnCours));
  const erreur = chemin ? erreurs[chemin] ?? contenu?.erreur : undefined;
  const nomDuCran = (cran: { nom: string; chemin: string }) => (cran.chemin === montage ? (racine ? nomDeLaRacine(racine, racines) : cran.chemin === '/' ? t('Disque du serveur') : cran.nom) : cran.nom);

  const lesRacines = [...racines].sort((a, b) =>
    a.montage === '/' ? -1 : b.montage === '/' ? 1 : Number(a.externe) - Number(b.externe) || a.montage.localeCompare(b.montage),
  );
  const arbre = (
    <>
      <div className="flex shrink-0 flex-col gap-1 px-2 pt-2.5" data-disques-explorateur>
        {lesRacines.length
          ? lesRacines.map((r) => <RacineDuServeur key={r.montage} racine={r} racines={racines} active={r.montage === montage} onChoisir={() => ctx.aller(r.montage)} />)
          : [0, 1].map((i) => <Silhouette key={i} className="h-[58px] rounded-lg" />)}
      </div>
      <ZoneDefilement className="px-2 pb-3 pt-1.5">
        {racines.length ? (
          <EnfantsDuNoeud chemin={montage} profondeur={-1} ctx={ctx} />
        ) : (
          <div className="flex flex-col gap-2 px-2 pt-1" aria-busy="true" data-silhouette="arbre-serveur">
            {[0, 1, 2, 3, 4].map((i) => (
              <Silhouette key={i} className="h-3.5 w-3/4" />
            ))}
          </div>
        )}
      </ZoneDefilement>
    </>
  );

  return (
    <Dialog open={!!chemin} onOpenChange={(ouvert) => !ouvert && onClose()}>
      <DialogContentLibre className="h-[100dvh] sm:h-[min(720px,88dvh)] sm:w-[min(1040px,100%)]" adresse="explorateur-serveur" data-explorateur-serveur={chemin ?? ''}>
        <DialogHeader
          className="border-b border-border pb-2"
          gauche={
            telephone && vueArbre ? (
              <Button variant="ghost" size="icon-sm" aria-label="Revenir au dossier" title={t('Revenir au dossier')} onClick={() => setVueArbre(false)} data-quitter-arbre>
                <ChevronLeft className="h-4 w-4" />
              </Button>
            ) : chemin && chemin !== montage ? (
              <Button variant="ghost" size="icon-sm" aria-label="Dossier parent" title={t('Dossier parent')} onClick={() => onChemin(dossierParent(chemin))} data-dossier-parent>
                <ChevronLeft className="h-4 w-4" />
              </Button>
            ) : null
          }
          sous={
            <nav className="mt-1 flex min-w-0 items-center gap-0.5 overflow-hidden px-1.5 text-[12.5px]" data-fil-explorateur>
              {montres.map((cran, i) =>
                cran ? (
                  <React.Fragment key={cran.chemin}>
                    {i > 0 ? <span className="shrink-0 text-faint">/</span> : null}
                    <button
                      type="button"
                      onClick={() => onChemin(cran.chemin)}
                      className={cn(
                        'min-w-0 truncate rounded px-1 py-0.5 hover:bg-raised',
                        cran.chemin === chemin ? 'text-text' : 'text-muted',
                        i === montres.length - 1 ? 'shrink' : 'shrink-0 max-w-[40%]',
                      )}
                      data-cran-explorateur={cran.chemin}
                    >
                      {nomDuCran(cran)}
                    </button>
                  </React.Fragment>
                ) : (
                  <React.Fragment key="ellipse">
                    <span className="shrink-0 text-faint">/</span>
                    <span className="shrink-0 px-0.5 text-faint">…</span>
                  </React.Fragment>
                ),
              )}
            </nav>
          }
        >
          <DialogTitle>{t('Explorateur du serveur')}</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          {/* ------------------------------ L'ARBRE ------------------------------ */}
          {!telephone ? (
            <nav className="flex min-h-0 w-[270px] shrink-0 flex-col border-r border-border" data-arbre-explorateur>
              {arbre}
            </nav>
          ) : vueArbre ? (
            <nav className="flex min-h-0 min-w-0 flex-1 flex-col" data-arbre-explorateur>
              {arbre}
            </nav>
          ) : null}

          {/* ------------------------------ LE DOSSIER --------------------------- */}
          {!telephone || !vueArbre ? (
            <section className="flex min-h-0 min-w-0 flex-1 flex-col" data-volet-dossier>
              <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-4 pb-1.5 pt-2.5">
                {telephone ? (
                  <Button variant="subtle" size="sm" onClick={() => setVueArbre(true)} data-montrer-arbre>
                    <FolderTree className="h-3.5 w-3.5" />
                    {t('Arborescence')}
                  </Button>
                ) : null}
                <p className="min-w-0 flex-1 text-[12px] text-faint max-sm:order-last max-sm:basis-full max-sm:px-1" data-tailles-explorateur={contenu?.tailles ?? ''} data-mesure-explorateur={enMesure ? 'en-cours' : 'non'}>
                  {contenu && !erreur ? (
                    <>
                      <span>
                        {[
                          t('{n} éléments', { n: contenu.entrees.length }),
                          total ? tailleEnClair(total) : null,
                          contenu.tailles === 'mesurees' && contenu.taillesLe
                            ? Date.now() - contenu.taillesLe < 60_000
                              ? t('tailles mesurées à l’instant')
                              : t('tailles mesurées il y a {d}', { d: elapsed(contenu.taillesLe) })
                            : contenu.tailles === 'releve' && contenu.taillesLe
                              ? Date.now() - contenu.taillesLe < 60_000
                                ? t('tailles du dernier relevé')
                                : t('tailles du relevé d’il y a {d}', { d: elapsed(contenu.taillesLe) })
                              : t('tailles des dossiers pas encore connues'),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      {enMesure ? (
                        <span className="ml-1.5 inline-flex items-center gap-1 text-muted" data-mesure-en-cours>
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {t('mesure en cours…')}
                        </span>
                      ) : null}
                    </>
                  ) : null}
                </p>
                {contenu && !erreur ? (
                  <Button variant="subtle" size="sm" className="shrink-0 max-sm:ml-auto" disabled={enMesure} onClick={() => chemin && mesurer(chemin, true)} data-recalculer-dossier>
                    <RefreshCw className={cn('h-3.5 w-3.5', enMesure && 'animate-spin')} />
                    {t('Recalculer ce dossier')}
                  </Button>
                ) : null}
              </div>
              {erreurDeMesure && erreurDeMesure.chemin === chemin ? (
                <p className="shrink-0 px-4 pb-1 text-[12px] text-danger" data-erreur-mesure>
                  {erreurDeMesure.message}
                </p>
              ) : null}
              <ZoneDefilement className="px-3 pb-4 sm:px-4" style={{ paddingBottom: telephone ? 'var(--pied-natif, calc(max(20px, env(safe-area-inset-bottom)) + var(--marche-du-bas, 0px)))' : undefined }}>
                {erreur ? (
                  <p className="py-6 text-center text-[13px] text-muted" data-erreur-explorateur>
                    {erreur}
                  </p>
                ) : !contenu ? (
                  <div aria-busy="true" data-silhouette="explorateur" className={cn(CLASSE_GROUPE_DE_LIGNES, 'gap-1')}>
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <Silhouette key={i} className="h-[42px] rounded-xl" />
                    ))}
                  </div>
                ) : !contenu.entrees.length ? (
                  <p className="py-6 text-center text-[13px] text-muted">{t('Ce dossier est vide.')}</p>
                ) : (
                  <>
                    <div className={CLASSE_GROUPE_DE_LIGNES} data-entrees-explorateur={contenu.entrees.length}>
                      {contenu.entrees.map((entree) => {
                        if (entree.disque) {
                          const cible = racines.find((r) => r.montage === entree.disque);
                          return (
                            <div key={entree.chemin} className={cn(CLASSE_LIGNE_DE_GROUPE, 'px-2 py-1 sm:px-2.5')} data-entree-explorateur={entree.chemin} data-genre="disque">
                              <button type="button" onClick={() => onChemin(entree.disque!)} className="flex w-full min-w-0 items-center gap-2.5 py-1.5 text-left" data-lien-disque={entree.disque}>
                                <HardDrive className="h-4 w-4 shrink-0 text-muted" />
                                <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">{entree.nom}</span>
                                <span className="flex shrink-0 items-center gap-1 text-[12.5px] text-muted">
                                  {cible ? nomDeLaRacine(cible, racines) : t('Disque externe')}
                                  <ArrowUpRight className="h-3.5 w-3.5" />
                                </span>
                              </button>
                            </div>
                          );
                        }
                        const part = total && entree.octets ? (entree.octets / total) * 100 : 0;
                        const ouvrable = entree.genre === 'dossier';
                        const Icone = entree.genre === 'dossier' ? Folder : entree.genre === 'lien' ? Link2 : File;
                        return (
                          <div key={entree.chemin} className={cn(CLASSE_LIGNE_DE_GROUPE, 'px-2 py-1 sm:px-2.5')} data-entree-explorateur={entree.chemin} data-genre={entree.genre}>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={!ouvrable}
                                onClick={() => ouvrable && onChemin(entree.chemin)}
                                className="flex min-w-0 flex-1 items-center gap-2.5 py-1.5 text-left disabled:cursor-default"
                              >
                                <Icone className={cn('h-4 w-4 shrink-0', ouvrable ? 'text-muted' : 'text-faint')} />
                                <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">{entree.nom}</span>
                                <span className="flex shrink-0 flex-col items-end text-right">
                                  {entree.octets !== undefined ? (
                                    <span className="block text-[13px] text-text">{tailleEnClair(entree.octets)}</span>
                                  ) : enMesure && ouvrable ? (
                                    <Silhouette className="my-1 h-3 w-12" />
                                  ) : (
                                    <span className="block text-[13px] text-faint">—</span>
                                  )}
                                  {entree.genre === 'dossier' ? (
                                    // Un dossier : la date de son fichier le plus récent, jamais la sienne (trompeuse).
                                    entree.dernierFichierLe ? (
                                      <span className="block text-[11px] text-faint max-sm:hidden">
                                        {t('dernier fichier {quand}', { quand: ilYA(entree.dernierFichierLe) })}
                                      </span>
                                    ) : null
                                  ) : entree.modifieLe ? (
                                    <span className="block text-[11px] text-faint max-sm:hidden">{ilYA(entree.modifieLe)}</span>
                                  ) : null}
                                </span>
                              </button>
                              {entree.genre === 'dossier' || entree.genre === 'fichier' ? (
                                <MenuDUnElement chemin={entree.chemin} etat={menages[entree.chemin]} onMenage={() => void demander(entree.chemin)} />
                              ) : (
                                <span className="h-8 w-8 shrink-0" />
                              )}
                            </div>
                            {part > 0 ? (
                              <div className="ml-[26px] mr-10 h-0.5 overflow-hidden rounded-full bg-raised">
                                <div className="h-full rounded-full bg-faint" style={{ width: `${Math.max(1, part)}%` }} />
                              </div>
                            ) : null}
                            <SuiteDuMenage etat={menages[entree.chemin]} />
                          </div>
                        );
                      })}
                    </div>
                    {contenu.tronque ? (
                      <p className="mt-2 px-1 text-[12px] text-faint">{t('{n} autres éléments, plus légers, ne sont pas affichés.', { n: contenu.tronque })}</p>
                    ) : null}
                  </>
                )}
              </ZoneDefilement>
            </section>
          ) : null}
        </div>
      </DialogContentLibre>
    </Dialog>
  );
}
