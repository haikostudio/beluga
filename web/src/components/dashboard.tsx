import * as React from 'react';
import { ArrowLeft, Activity, BookOpen, Clock, Gauge, History, ListChecks, Scissors, TrendingUp } from 'lucide-react';
import {
  couleurIntensite,
  type MesureDeTache,
  type NoteDeQualite,
  type PointDeTendance,
  type ResumeDeTendance,
} from '@haikodev/shared';
import { Button, ZoneDefilement } from '@/components/ui';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { t, formatRegional } from '@/lib/langue';

/* Ce que le serveur renvoie pour la commande `stats.dashboard`. */
type DonneesTableau = {
  byProject: { projectId: string; name?: string; tokens: number; seconds: number; tasks: number }[];
  byDay: { day: string; tokens: number; seconds: number; tasks: number }[];
  /**
   * L'HISTORIQUE DES TÂCHES EXÉCUTÉES, la plus récente d'abord : une ligne par
   * tour réellement parti, avec ses jetons d'entrée et de sortie RÉELS —
   * jamais une estimation.
   */
  historique: {
    cardId: string;
    title: string;
    projectName?: string;
    at: number;
    inputTokens: number;
    outputTokens: number;
    tokens: number;
  }[];
};

/** Ce que le serveur renvoie pour la commande `stats.telemetrie`. */
type DonneesTelemetrie = {
  jours: number;
  taches: (MesureDeTache & { qualite: NoteDeQualite })[];
  tendances: PointDeTendance[];
  resume: ResumeDeTendance;
  references: { jetons: number; secondes: number };
};

/** Secondes machine → « 3 h 20 » ou « 12 min », lisible d'un coup d'œil. */
function dureeEnClair(secondes: number): string {
  const minutes = Math.round(secondes / 60);
  if (minutes < 60) return `${minutes} min`;
  const heures = Math.floor(minutes / 60);
  const reste = minutes % 60;
  return reste ? `${heures} h ${reste.toString().padStart(2, '0')}` : `${heures} h`;
}

/**
 * Un jour « 2026-08-04 » → « 4 août », pour l'axe de la courbe.
 *
 * Les noms de mois étaient écrits À LA MAIN, en français, dans un tableau de
 * douze : la moitié serait restée française dans une page anglaise, et l'ordre
 * « quantième puis mois » n'est pas celui de toutes les langues. On laisse donc
 * le NAVIGATEUR écrire la date, dans le format régional de la langue en vigueur
 * — il connaît les douze mois des cinq langues, et leur ordre.
 */
function jourEnClair(jour: string): string {
  const [annee, mois, quantieme] = jour.split('-').map(Number);
  if (!annee || !mois || !quantieme) return jour;
  /* Construit par PARTIES, jamais par `new Date('2026-08-04')` : cette forme est
     lue en temps universel et peut reculer d'un jour selon le fuseau. */
  const date = new Date(annee, mois - 1, quantieme);
  return date.toLocaleDateString(formatRegional(), { day: 'numeric', month: 'short' });
}

/** Un horodatage (ms) → « 4 août, 15:27 », dans le format régional de la langue en vigueur. */
function dateHeureEnClair(at: number): string {
  const date = new Date(at);
  return date.toLocaleString(formatRegional(), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Une grande tuile de chiffre, en tête de page. */
function Tuile({ icone, titre, valeur, dessous }: { icone: React.ReactNode; titre: string; valeur: string; dessous?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-3">
      <p className="flex items-center gap-1.5 text-[11.5px] uppercase tracking-wide text-faint">
        {icone} {titre}
      </p>
      <p className="mt-1 text-[22px] font-semibold leading-tight text-text">{valeur}</p>
      {dessous ? <p className="mt-0.5 text-[12px] text-faint">{dessous}</p> : null}
    </div>
  );
}

/**
 * Histogramme du TEMPS DE TRAVAIL dépensé jour par jour, tous moteurs
 * confondus — plus aucun compteur de jetons. Une barre par jour, du plus
 * ancien au plus récent. À la souris, une infobulle donne le détail au
 * survol ; au toucher (téléphone, sans survol), un appui sur une barre
 * affiche son détail sous le graphique et la met en évidence — un second
 * appui, ou un appui ailleurs, referme. Pur SVG : aucune bibliothèque de
 * graphiques dans le projet.
 */
function CourbeParJour({ jours }: { jours: DonneesTableau['byDay'] }) {
  const [actif, setActif] = React.useState<string | null>(null);
  if (!jours.length) return <p className="text-[13px] text-faint">{t('Aucune consommation relevée pour l\'instant.')}</p>;
  const max = Math.max(1, ...jours.map((j) => j.seconds));
  const jourActif = jours.find((j) => j.day === actif) ?? null;
  return (
    <div>
      <div className="flex items-end gap-1" style={{ height: 140 }}>
        {jours.map((jour) => {
          const hauteur = Math.max(2, Math.round((jour.seconds / max) * 120));
          const estActif = jour.day === actif;
          return (
            <button
              type="button"
              key={jour.day}
              onClick={() => setActif((prec) => (prec === jour.day ? null : jour.day))}
              className="flex min-w-0 flex-1 flex-col items-center gap-1"
              aria-pressed={estActif}
              aria-label={`${jourEnClair(jour.day)} · ${dureeEnClair(jour.seconds)}`}
              title={`${jourEnClair(jour.day)} · ${dureeEnClair(jour.seconds)}`}
            >
              <div className="flex w-full flex-1 items-end">
                {/* La COULEUR dit l'intensité du jour (calme → chargé) ; la barre
                    choisie garde en plus son liseré d'accent, qui la détache de
                    toutes les autres quelle que soit sa teinte. */}
                <div
                  className={`w-full rounded-t ${estActif ? 'ring-2 ring-accent ring-offset-1 ring-offset-surface' : ''}`}
                  style={{ height: hauteur, backgroundColor: couleurIntensite(jour.seconds, max) }}
                  data-barre-jour={jour.day}
                />
              </div>
              <span className={`w-full truncate text-center text-[9px] ${estActif ? 'font-semibold text-text' : 'text-faint'}`}>
                {Number(jour.day.split('-')[2])}
              </span>
            </button>
          );
        })}
      </div>
      {/* Détail de la barre choisie, lisible même sans survol (téléphone). */}
      <p className="mt-2 min-h-[18px] text-[12px] text-faint" aria-live="polite">
        {jourActif ? (
          <>
            <span className="font-semibold text-text">{jourEnClair(jourActif.day)}</span>
            {` · ${dureeEnClair(jourActif.seconds)}`}
          </>
        ) : (
          t('Touchez une barre pour voir le détail du jour.')
        )}
      </p>
    </div>
  );
}

/** Un grand nombre de jetons → « 1,2 M » ou « 340 k », lisible sans compter les zéros. */
function jetonsEnClair(jetons: number): string {
  if (jetons >= 1_000_000) return `${(jetons / 1_000_000).toFixed(1)} M`;
  if (jetons >= 1_000) return `${Math.round(jetons / 1_000)} k`;
  return `${jetons}`;
}

/**
 * JETONS CONTRE DURÉE, JOUR PAR JOUR — deux grandeurs, deux échelles, un seul
 * dessin.
 *
 * Les JETONS sont des barres (une masse qui s'accumule), la DURÉE MOYENNE d'une
 * tâche une ligne posée par-dessus (une allure, pas un volume). C'est la seule
 * façon de voir d'un coup l'écart qui intéresse : un jour cher mais rapide n'est
 * pas un jour long mais sobre. Chaque échelle est indépendante — les mêler
 * ferait disparaître la plus petite.
 *
 * Pur SVG, comme le reste de la page : aucune bibliothèque de graphiques dans
 * le projet.
 */
function CourbeJetonsEtDuree({ tendances }: { tendances: PointDeTendance[] }) {
  const [actif, setActif] = React.useState<string | null>(null);
  if (!tendances.length) return <p className="text-[13px] text-faint">{t('Aucune tâche mesurée sur la période.')}</p>;

  const maxJetons = Math.max(1, ...tendances.map((p) => p.jetons));
  const maxMinutes = Math.max(1, ...tendances.map((p) => p.minutesParTache));
  const pointActif = tendances.find((p) => p.jour === actif) ?? null;
  const hauteur = 120;
  const largeurPas = 100 / tendances.length;
  const ligne = tendances
    .map((point, i) => {
      const x = largeurPas * i + largeurPas / 2;
      const y = hauteur - (point.minutesParTache / maxMinutes) * (hauteur - 12) - 6;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <div data-courbe-jetons-duree>
      <div className="relative" style={{ height: hauteur }}>
        <div className="absolute inset-0 flex items-end gap-1">
          {tendances.map((point) => (
            <button
              type="button"
              key={point.jour}
              onClick={() => setActif((prec) => (prec === point.jour ? null : point.jour))}
              className="flex min-w-0 flex-1 items-end self-stretch"
              aria-pressed={point.jour === actif}
              aria-label={`${jourEnClair(point.jour)} · ${jetonsEnClair(point.jetons)} · ${point.minutesParTache} min`}
              title={`${jourEnClair(point.jour)} · ${jetonsEnClair(point.jetons)} · ${point.minutesParTache} min`}
            >
              <div
                className={`w-full rounded-t ${point.jour === actif ? 'ring-2 ring-accent ring-offset-1 ring-offset-surface' : ''}`}
                style={{
                  height: Math.max(2, Math.round((point.jetons / maxJetons) * (hauteur - 12))),
                  backgroundColor: couleurIntensite(point.jetons, maxJetons),
                }}
                data-barre-jetons={point.jour}
              />
            </button>
          ))}
        </div>
        {/* La durée moyenne, par-dessus les barres : une allure, pas un volume. */}
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 100 ${hauteur}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {/* `--accent` ne porte que les composantes d'une couleur (« 0 0% 100% »),
              jamais une couleur complète : sans `hsl(…)`, le trait est INVALIDE
              et le navigateur ne dessine rien du tout, en silence. */}
          <path d={ligne} fill="none" stroke="hsl(var(--accent))" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>

      <div className="mt-1 flex gap-1">
        {tendances.map((point) => (
          <span
            key={point.jour}
            className={`min-w-0 flex-1 truncate text-center text-[9px] ${point.jour === actif ? 'font-semibold text-text' : 'text-faint'}`}
          >
            {Number(point.jour.split('-')[2])}
          </span>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-faint">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: couleurIntensite(1, 1) }} />
          {t('Jetons facturables')}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-[2px] w-3 rounded-full bg-accent" />
          {t('Durée moyenne d\'une tâche')}
        </span>
      </div>

      <p className="mt-1 min-h-[18px] text-[12px] text-faint" aria-live="polite" data-detail-jour-telemetrie>
        {pointActif ? (
          <>
            <span className="font-semibold text-text">{jourEnClair(pointActif.jour)}</span>
            {` · ${t('{v0} tâche{v1}', { v0: pointActif.taches, v1: pointActif.taches > 1 ? 's' : '' })}`}
            {` · ${jetonsEnClair(pointActif.jetons)} ${t('jetons')}`}
            {` · ${t('{v0} min par tâche', { v0: pointActif.minutesParTache })}`}
            {` · ${t('mémoire triée à {v0}', { v0: fractionEnClair(pointActif.rendementMemoire) })}`}
          </>
        ) : (
          t('Touchez une barre pour voir le détail du jour.')
        )}
      </p>
    </div>
  );
}

/** La note d'une tâche, avec le détail de ses quatre critères au survol. */
function PastilleDeNote({ qualite }: { qualite: NoteDeQualite }) {
  const detail = qualite.criteres.map((c) => `${c.points}/${c.sur} — ${c.raison}`).join('\n');
  return (
    <span
      className="shrink-0 rounded bg-raised px-1.5 py-0.5 text-[12px] font-medium text-text"
      title={detail}
      data-note-tache={qualite.note}
    >
      {t('{v0}/100', { v0: qualite.note })}
    </span>
  );
}

/**
 * UNE TÂCHE MESURÉE, LIGNE PAR LIGNE : ce qu'elle a coûté, ce qu'elle est allée
 * chercher, et ce que ça vaut. Un dépliant montre le détail de la note et les
 * sujets de mémoire ouverts — repliée, la ligne tient sur deux lignes de texte.
 */
function LigneDeTache({ tache }: { tache: MesureDeTache & { qualite: NoteDeQualite } }) {
  const [ouverte, setOuverte] = React.useState(false);
  const facturables = tache.tokensEntree + tache.tokensSortie;
  const issue =
    tache.issue === 'terminee' ? t('terminée') : tache.issue === 'interrompue' ? t('interrompue') : t('en échec');
  return (
    <div className="rounded-md border border-border bg-bg px-2 py-1.5" data-tache-mesuree={tache.cardId}>
      <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setOuverte((o) => !o)} aria-expanded={ouverte}>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] text-text">{tache.titre ?? t('Carte retirée')}</p>
          <p className="truncate text-[11px] text-faint">
            {tache.projet ?? t('Projet retiré')} · {issue} ·{' '}
            {t('{v0} tour{v1}', { v0: tache.tours, v1: tache.tours > 1 ? 's' : '' })}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <PastilleDeNote qualite={tache.qualite} />
          <p className="mt-0.5 text-[11px] text-faint">
            {jetonsEnClair(facturables)} {t('jetons')} · {dureeEnClair(tache.secondes)}
          </p>
        </div>
      </button>

      {ouverte ? (
        <div className="mt-2 border-t border-faint/30 pt-2" data-detail-tache-mesuree>
          <div className="space-y-0.5">
            {tache.qualite.criteres.map((critere) => (
              <p key={critere.cle} className="text-[11.5px] text-faint">
                <span className="font-medium text-text">
                  {critere.points}/{critere.sur}
                </span>{' '}
                — {critere.raison}
              </p>
            ))}
          </div>

          <p className="mt-2 text-[11.5px] text-faint">
            <BookOpen className="mr-1 inline h-3 w-3" />
            {tache.memoire.ouvertures
              ? t('{v0} ouverture{v1} de mémoire en {v2} ms · {v3} bloc{v4} demandé{v4} pour {v5} rendu{v6}', {
                  v0: tache.memoire.ouvertures,
                  v1: tache.memoire.ouvertures > 1 ? 's' : '',
                  v2: tache.memoire.millisecondes,
                  v3: tache.memoire.demandes,
                  v4: tache.memoire.demandes > 1 ? 's' : '',
                  v5: tache.memoire.rendus,
                  v6: tache.memoire.rendus > 1 ? 's' : '',
                })
              : t('La mémoire du projet n\'a pas été ouverte.')}
          </p>

          {tache.memoire.sujets.length ? (
            <div className="mt-1 flex flex-wrap gap-1" data-sujets-memoire>
              {tache.memoire.sujets.map((sujet) => (
                <span key={sujet} className="rounded bg-raised px-1.5 py-0.5 text-[11px] text-text">
                  {sujet}
                </span>
              ))}
            </div>
          ) : null}

          <p className="mt-1.5 text-[11px] text-faint">
            {t('Entrée neuve {v0} · relue au cache {v1} · sortie {v2}', {
              v0: jetonsEnClair(tache.tokensEntree),
              v1: jetonsEnClair(tache.tokensCache),
              v2: jetonsEnClair(tache.tokensSortie),
            })}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function Dashboard({ onClose }: { onClose: () => void }) {
  const state = useApp();
  const [donnees, setDonnees] = React.useState<DonneesTableau | null>(null);
  const [telemetrie, setTelemetrie] = React.useState<DonneesTelemetrie | null>(null);
  const [erreur, setErreur] = React.useState(false);

  React.useEffect(() => {
    let vivant = true;
    client
      .call({ type: 'stats.dashboard' }, 120000)
      .then((data) => vivant && setDonnees(data as DonneesTableau))
      .catch(() => vivant && setErreur(true));
    /*
     * LA TÉLÉMÉTRIE VOYAGE À PART, et son échec n'emporte pas la page : ce sont
     * deux fenêtres de temps différentes (sept jours contre trente), et une
     * base qui n'a encore rien mesuré ne doit pas faire disparaître le reste du
     * tableau de bord.
     */
    client
      .call({ type: 'stats.telemetrie' }, 120000)
      .then((data) => vivant && setTelemetrie(data as DonneesTelemetrie))
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
  }, []);

  // Le nom vivant d'abord, sinon celui figé à la dépense.
  const nomDuProjet = (row: { projectId: string; name?: string }) =>
    state.projects.find((p) => p.id === row.projectId)?.name ?? row.name ?? t('Projet supprimé · {v0}', { v0: row.projectId.slice(0, 8) });

  const byProject = donnees?.byProject ?? [];
  const tempsTotal = byProject.reduce((total, p) => total + (p.seconds ?? 0), 0);
  const tachesTotal = byProject.reduce((total, p) => total + (p.tasks ?? 0), 0);
  // Le classement suit le TEMPS de travail (ce que la ligne affiche), le plus long en tête,
  // et la barre mesure la même grandeur : elle décroît donc du haut vers le bas.
  const projetsParTemps = [...byProject].sort((a, b) => (b.seconds ?? 0) - (a.seconds ?? 0));
  const maxProjet = Math.max(1, ...byProject.map((p) => p.seconds ?? 0));
  // Les jours arrivent du plus récent au plus ancien : la courbe se lit à l'endroit.
  const jours = [...(donnees?.byDay ?? [])].reverse();
  // Déjà trié récent d'abord côté serveur ; le tri se refait ici pour ne
  // dépendre de rien d'autre que les dates reçues.
  const historique = [...(donnees?.historique ?? [])].sort((a, b) => b.at - a.at);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={onClose} data-fermer-tableau-de-bord>
          <ArrowLeft className="h-3.5 w-3.5" />  {t('Revenir au tableau')}
</Button>
        <h1 className="ml-1 text-[15px] font-semibold text-text">{t('Tableau de bord')}</h1>
      </header>

      <ZoneDefilement className="px-3 py-3" data-fil="tableau-de-bord">
        <div className="mx-auto w-full max-w-[1100px] space-y-5">
          {erreur ? (
            <p className="text-[13px] text-faint">{t('Les statistiques n\'ont pas pu être chargées. Réessayez dans un instant.')}</p>
          ) : null}

          {/* 1. Chiffres de tête : temps de travail, tâches. */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Tuile
              icone={<Clock className="h-3.5 w-3.5" />}
              titre={t('Temps de travail total')}
              valeur={dureeEnClair(tempsTotal)}
              dessous="Cumul des agents, tous projets"
            />
            <Tuile
              icone={<ListChecks className="h-3.5 w-3.5" />}
              titre={t('Tâches exécutées')}
              valeur={tachesTotal.toLocaleString(formatRegional())}
              dessous={t('{v0} projet{v1} concerné{v2}', { v0: byProject.length, v1: byProject.length > 1 ? 's' : '', v2: byProject.length > 1 ? 's' : '' })}
            />
          </div>

          {/* 2. Le temps de travail au fil des jours. */}
          <section className="rounded-lg border border-border bg-surface px-3 py-3">
            <h2 className="flex items-center gap-1.5 text-[13.5px] font-medium text-text">
              <TrendingUp className="h-3.5 w-3.5 text-faint" />  {t('Activité au fil des jours')}
</h2>
            <p className="mb-3 mt-0.5 text-[12.5px] text-faint">
              {t('Le temps de travail des agents chaque jour, tous moteurs confondus, sur le dernier mois.')}</p>
            <CourbeParJour jours={jours} />
          </section>

          {/* 3. Les projets les plus travaillés. */}
          <section className="rounded-lg border border-border bg-surface px-3 py-3">
            <h2 className="flex items-center gap-1.5 text-[13.5px] font-medium text-text">
              <Gauge className="h-3.5 w-3.5 text-faint" />  {t('Projets les plus travaillés')}
</h2>
            {byProject.length ? (
              <div className="mt-2 space-y-1.5">
                {projetsParTemps.slice(0, 10).map((row) => (
                  <div key={row.projectId}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13px] text-text">{nomDuProjet(row)}</span>
                      <span className="shrink-0 text-[11.5px] text-faint">
                        {t('{v0} tâche{v1} · {v2}', { v0: row.tasks, v1: row.tasks > 1 ? 's' : '', v2: dureeEnClair(row.seconds) })}</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-raised">
                      {/* Même règle de couleur que la courbe des jours : la page tient ensemble. */}
                      <div
                        className="h-full rounded-full"
                        data-barre-projet={row.projectId}
                        style={{
                          width: `${Math.round(((row.seconds ?? 0) / maxProjet) * 100)}%`,
                          backgroundColor: couleurIntensite(row.seconds ?? 0, maxProjet),
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-[13px] text-faint">{t('Aucune consommation relevée pour l\'instant.')}</p>
            )}
          </section>

          {/* 4. L'historique des tâches exécutées, la plus récente d'abord. */}
          <section className="rounded-lg border border-border bg-surface px-3 py-3" data-historique-taches>
            <h2 className="flex items-center gap-1.5 text-[13.5px] font-medium text-text">
              <History className="h-3.5 w-3.5 text-faint" />  {t('Historique des tâches')}
</h2>
            <p className="mb-2 mt-0.5 text-[12.5px] text-faint">
              {t('Chaque tâche exécutée, avec ses jetons d\'entrée et de sortie réels, la plus récente en tête.')}</p>
            {historique.length ? (
              <div className="space-y-1.5">
                {historique.slice(0, 20).map((ligne, index) => (
                  <div
                    key={`${ligne.cardId}-${ligne.at}-${index}`}
                    className="flex items-center gap-2 rounded-md border border-border bg-bg px-2 py-1.5"
                    data-tache-historique={ligne.cardId}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-text">{ligne.title}</p>
                      <p className="truncate text-[11px] text-faint">
                        {ligne.projectName ?? t('Projet retiré')} · {dateHeureEnClair(ligne.at)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="rounded bg-raised px-1.5 py-0.5 text-[12px] font-medium text-text">
                        {t('{v0} jetons', { v0: ligne.tokens.toLocaleString(formatRegional()) })}
                      </span>
                      <p className="mt-0.5 text-[11px] text-faint">
                        {t('{v0} entrée · {v1} sortie', {
                          v0: ligne.inputTokens.toLocaleString(formatRegional()),
                          v1: ligne.outputTokens.toLocaleString(formatRegional()),
                        })}
                      </p>
                    </div>

          {/* 5. La télémétrie complète des tâches : jetons, mémoire, durée, qualité. */}
          <section className="rounded-lg border border-border bg-surface px-3 py-3" data-telemetrie-taches>
            <h2 className="flex items-center gap-1.5 text-[13.5px] font-medium text-text">
              <Activity className="h-3.5 w-3.5 text-faint" />  {t('Télémétrie des tâches')}
</h2>
            <p className="mb-3 mt-0.5 text-[12.5px] text-faint">
              {t('Pour chaque tâche terminée : les jetons réellement consommés par le moteur, les sujets de mémoire ouverts et le temps qu\'ils ont pris, et une estimation de qualité. Mesuré depuis la mise en service, sur les {v0} derniers jours.', { v0: telemetrie?.jours ?? 7 })}</p>

            {telemetrie && telemetrie.taches.length ? (
              <>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <Tuile
                    icone={<ListChecks className="h-3.5 w-3.5" />}
                    titre={t('Tâches mesurées')}
                    valeur={telemetrie.resume.taches.toLocaleString(formatRegional())}
                    dessous={t('sur les {v0} derniers jours', { v0: telemetrie.jours })}
                  />
                  <Tuile
                    icone={<TrendingUp className="h-3.5 w-3.5" />}
                    titre={t('Jetons facturables')}
                    valeur={jetonsEnClair(telemetrie.resume.jetons)}
                    dessous={t('entrée neuve et sortie, hors relecture au cache')}
                  />
                  <Tuile
                    icone={<Clock className="h-3.5 w-3.5" />}
                    titre={t('Durée moyenne')}
                    valeur={t('{v0} min', { v0: telemetrie.resume.minutesParTache })}
                    dessous={t('par tâche, temps machine')}
                  />
                  <Tuile
                    icone={<Gauge className="h-3.5 w-3.5" />}
                    titre={t('Qualité moyenne')}
                    valeur={t('{v0}/100', { v0: telemetrie.resume.note })}
                    dessous={t('estimation, détaillée tâche par tâche')}
                  />
                </div>

                <div className="mt-3">
                  <h3 className="text-[12.5px] font-medium text-text">{t('Jetons et durée, jour par jour')}</h3>
                  <p className="mb-2 mt-0.5 text-[12px] text-faint">
                    {t('Les barres donnent les jetons du jour, la ligne la durée moyenne d\'une tâche : un jour cher n\'est pas forcément un jour long.')}</p>
                  <CourbeJetonsEtDuree tendances={telemetrie.tendances} />
                </div>

                <div className="mt-3">
                  <h3 className="text-[12.5px] font-medium text-text">{t('Le détail, tâche par tâche')}</h3>
                  <p className="mb-2 mt-0.5 text-[12px] text-faint">
                    {t('Une ligne par tâche, la plus récente en tête. Ouvrez-en une pour voir d\'où vient sa note et ce qu\'elle a lu dans la mémoire du projet.')}</p>
                  <div className="space-y-1.5">
                    {telemetrie.taches.slice(0, 30).map((tache) => (
                      <LigneDeTache key={tache.cardId} tache={tache} />
                    ))}
                  </div>
                  <p className="mt-2 text-[11.5px] text-faint">
                    {t('La note compare chaque tâche à la médiane mesurée sur ce dépôt : {v0} jetons et {v1} min. C\'est une estimation du déroulé, pas un jugement du code produit.', {
                      v0: telemetrie.references.jetons.toLocaleString(formatRegional()),
                      v1: Math.round(telemetrie.references.secondes / 60),
                    })}</p>
                </div>
              </>
            ) : (
              <p className="text-[13px] text-faint">
                {t('Aucune tâche mesurée pour l\'instant. Ce bloc se remplit à la fin de chaque tâche lancée depuis la mise en service de la mesure.')}</p>
            )}
          </section>

          {/* 6. Ce que le tri de la mémoire a évité d'envoyer, sur le mois. */}
          <section className="rounded-lg border border-border bg-surface px-3 py-3" data-economie-memoire>
            <h2 className="flex items-center gap-1.5 text-[13.5px] font-medium text-text">
              <Scissors className="h-3.5 w-3.5 text-faint" />  {t('Mémoire évitée par le tri')}
</h2>
            <p className="mb-2 mt-0.5 text-[12.5px] text-faint">
              {t('Un sujet de mémoire n\'est plus envoyé en entier : seuls les passages qui parlent du travail de la carte partent. Voici ce que ce tri a évité d\'envoyer sur les {v0} derniers jours.', { v0: memoire?.jours ?? 30 })}</p>

            {memoire && memoire.ouvertures ? (
              <>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Tuile
                    icone={<Scissors className="h-3.5 w-3.5" />}
                    titre={t('Mémoire non envoyée')}
                    valeur={fractionEnClair(memoire.part)}
                    dessous={t('sur {v0} ouverture{v1} de mémoire, {v2} carte{v3}', {
                      v0: memoire.ouvertures,
                      v1: memoire.ouvertures > 1 ? 's' : '',
                      v2: memoire.cartes,
                      v3: memoire.cartes > 1 ? 's' : '',
                    })}
                  />
                  <Tuile
                    icone={<Gauge className="h-3.5 w-3.5" />}
                    titre={t('Quota de semaine épargné')}
                    valeur={memoire.quotaEvite != null ? pourcentEnClair(memoire.quotaEvite) : '—'}
                    dessous={
                      memoire.quotaEvite != null
                        ? t('déduit de la consommation réellement relevée sur la période')
                        : t('aucune consommation relevée : la part de quota ne se déduit pas encore')
                    }
                  />
                </div>

                {memoire.parCarte.length ? (
                  <div className="mt-3 space-y-1.5">
                    {memoire.parCarte.slice(0, 20).map((carte) => (
                      <div
                        key={carte.cardId}
                        className="flex items-center gap-2 rounded-md border border-border bg-bg px-2 py-1.5"
                        data-economie-carte={carte.cardId}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] text-text">{carte.title}</p>
                          <p className="truncate text-[11px] text-faint">
                            {carte.projectName ?? t('Projet retiré')} ·{' '}
                            {t('{v0} ouverture{v1}', { v0: carte.ouvertures, v1: carte.ouvertures > 1 ? 's' : '' })}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <span className="rounded bg-raised px-1.5 py-0.5 text-[12px] font-medium text-text">
                            {t('{v0} évités', { v0: fractionEnClair(carte.part) })}
                          </span>
                          {carte.quotaEvite != null ? (
                            <p className="mt-0.5 text-[11px] text-faint">
                              {t('{v0} de quota', { v0: pourcentEnClair(carte.quotaEvite) })}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>

                ))}

              </div>

            ) : (

              <p className="text-[13px] text-faint">

                {t('Aucune tâche exécutée pour l\'instant. Ce bloc se remplira à mesure que des tâches s\'exécutent.')}</p>

            )}

          </section>

        </div>

      </ZoneDefilement>

    </div>

  );

}
