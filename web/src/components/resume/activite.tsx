import * as React from 'react';
import { Activity, BookOpen, Clock, Gauge, History, ListChecks, Repeat, TrendingUp } from 'lucide-react';
import {
  couleurIntensite,
  type MesureDeTache,
  type NoteDeQualite,
  type PointDeTendance,
  type ResumeDeTendance,
  type ResumeEnsemble,
  type ResumeTaches,
} from '@beluga/shared';
import { BulleInfo } from '@/components/ui';
import { TableauDeDonnees } from '@/components/ui/tableau-de-donnees';
import { SilhouetteRubrique } from '@/components/silhouettes';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { formatRegional, t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import {
  AxeDesJours,
  BarreDePart,
  CourbeDuResume,
  EtatDeRubrique,
  Section,
  Tuile,
  Tuiles,
  dateCourte,
  dateHeure,
  dureeEnClair,
  jetonsEnClair,
  nombre,
  partEnClair,
  useResume,
  useTailleDePage,
  type ProprietesDeRubrique,
} from './commun';

/*
 * LES RUBRIQUES DE L'ACTIVITÉ DES AGENTS : « Vue d'ensemble » (temps de
 * travail, projets) et « Tâches des agents » (historique par carte, puis la
 * télémétrie des tâches : jetons réels, mémoire ouverte, note de qualité).
 */

/* ------------------------------------------------------------------ */
/* Vue d'ensemble                                                      */
/* ------------------------------------------------------------------ */

export function RubriqueEnsemble({ debut, fin }: ProprietesDeRubrique) {
  const etat = useResume<ResumeEnsemble>('ensemble', debut, fin);
  const state = useApp();
  const [taille, setTaille] = useTailleDePage();
  return (
    <EtatDeRubrique etat={etat}>
      {(d) => {
        // Le nom vivant d'abord, sinon celui figé à la dépense.
        const nomDuProjet = (p: ResumeEnsemble['projets'][number]) =>
          state.projects.find((x) => x.id === p.projectId)?.name ?? p.nom ?? t('Projet retiré');
        return (
          <>
            <Tuiles>
              <Tuile
                icone={<Clock className="h-3.5 w-3.5" />}
                titre={t('Temps de travail')}
                valeur={dureeEnClair(d.secondes)}
                dessous={t('Cumul des agents, tous projets')}
                repere="temps"
              />
              <Tuile
                icone={<ListChecks className="h-3.5 w-3.5" />}
                titre={t('Tâches exécutées')}
                valeur={nombre(d.taches)}
                dessous={t('{v0} projet{v1} concerné{v2}', {
                  v0: d.projets.length,
                  v1: d.projets.length > 1 ? 's' : '',
                  v2: d.projets.length > 1 ? 's' : '',
                })}
                repere="taches"
              />
              <Tuile
                icone={<Repeat className="h-3.5 w-3.5" />}
                titre={t("Tours d'agent")}
                valeur={nombre(d.tours)}
                dessous={t('{v0} jetons', { v0: jetonsEnClair(d.jetons) })}
                repere="tours"
              />
              <Tuile
                icone={<Gauge className="h-3.5 w-3.5" />}
                titre={t('Qualité moyenne')}
                valeur={d.note === null ? '—' : t('{v0}/100', { v0: d.note })}
                dessous={t('estimation, détaillée tâche par tâche')}
                repere="qualite"
              />
            </Tuiles>

            <Section
              titre={t('Activité au fil des jours')}
              icone={<TrendingUp className="h-3.5 w-3.5 text-faint" />}
              aide={t('Le temps de travail des agents chaque jour (les barres) et le nombre de tâches (la ligne), tous moteurs confondus.')}
            >
              <CourbeDuResume
                jours={d.jours}
                barres={{ libelle: t('Temps de travail'), valeurs: d.parJour.secondes, format: dureeEnClair }}
                ligne={{ libelle: t('Tâches'), valeurs: d.parJour.taches }}
                vide={t('Aucune consommation relevée sur la période.')}
              />
            </Section>

            <Section titre={t('Projets les plus travaillés')} icone={<Gauge className="h-3.5 w-3.5 text-faint" />}>
              <TableauDeDonnees
                repere="projets"
                lignes={d.projets}
                cle={(p) => p.projectId}
                taille={taille}
                onTaille={setTaille}
                triInitial={{ colonne: 'temps', sens: 'desc' }}
                vide={t('Aucune consommation relevée sur la période.')}
                colonnes={[
                  { cle: 'projet', libelle: t('Projet'), valeur: nomDuProjet },
                  { cle: 'taches', libelle: t('Tâches'), valeur: (p) => p.taches, droite: true },
                  { cle: 'tours', libelle: t('Tours'), valeur: (p) => p.tours, droite: true, masqueSurTelephone: true },
                  { cle: 'temps', libelle: t('Temps'), valeur: (p) => p.secondes, rendu: (p) => dureeEnClair(p.secondes), droite: true },
                  {
                    cle: 'jetons',
                    libelle: t('Jetons'),
                    valeur: (p) => p.jetons,
                    rendu: (p) => jetonsEnClair(p.jetons),
                    droite: true,
                    masqueSurTelephone: true,
                  },
                  {
                    cle: 'part',
                    libelle: t('Part du temps'),
                    valeur: (p) => p.secondes,
                    rendu: (p) => <BarreDePart valeur={p.secondes} max={d.secondes} repere={p.projectId} />,
                    droite: true,
                  },
                ]}
              />
            </Section>
          </>
        );
      }}
    </EtatDeRubrique>
  );
}

/* ------------------------------------------------------------------ */
/* Tâches des agents                                                   */
/* ------------------------------------------------------------------ */

/** Ce que le serveur renvoie pour la commande `stats.telemetrie`. */
type DonneesTelemetrie = {
  jours: number;
  taches: (MesureDeTache & { titre?: string; projet?: string; qualite: NoteDeQualite })[];
  tendances: PointDeTendance[];
  resume: ResumeDeTendance;
  references: { jetons: number; secondes: number };
};

export function RubriqueTaches({ debut, fin }: ProprietesDeRubrique) {
  const etat = useResume<ResumeTaches>('taches', debut, fin);
  const [taille, setTaille] = useTailleDePage();
  /* L'historique et la télémétrie voyagent séparément : l'échec de l'un
     n'emporte pas l'autre. */
  return (
    <div className="space-y-4">
      <EtatDeRubrique etat={etat}>
        {(d) => (
          <Section
            titre={t('Historique des tâches')}
            icone={<History className="h-3.5 w-3.5 text-faint" />}
            aide={t("Chaque tâche exécutée sur la période, avec ses jetons d'entrée et de sortie réels, la plus récente en tête.")}
            data-historique-taches
          >
            <TableauDeDonnees
              repere="historique"
              lignes={d.lignes}
              cle={(l) => l.cardId}
              taille={taille}
              onTaille={setTaille}
              attributsLigne={(l) => ({ 'data-tache-historique': l.cardId })}
              vide={t('Aucune tâche exécutée sur la période.')}
              colonnes={[
                { cle: 'titre', libelle: t('Tâche'), valeur: (l) => l.titre ?? t('Carte retirée'), largeur: 'sm:min-w-[200px]' },
                { cle: 'projet', libelle: t('Projet'), valeur: (l) => l.projet ?? t('Projet retiré'), masqueSurTelephone: true },
                { cle: 'date', libelle: t('Dernier tour'), valeur: (l) => l.at, rendu: (l) => dateHeure(l.at), droite: true },
                { cle: 'tours', libelle: t('Tours'), valeur: (l) => l.tours, droite: true, masqueSurTelephone: true },
                {
                  cle: 'duree',
                  libelle: t('Durée'),
                  valeur: (l) => l.secondes,
                  rendu: (l) => dureeEnClair(l.secondes),
                  droite: true,
                  masqueSurTelephone: true,
                },
                {
                  cle: 'entree',
                  libelle: t('Entrée'),
                  valeur: (l) => l.entree,
                  rendu: (l) => jetonsEnClair(l.entree),
                  droite: true,
                  masqueSurTelephone: true,
                },
                {
                  cle: 'sortie',
                  libelle: t('Sortie'),
                  valeur: (l) => l.sortie,
                  rendu: (l) => jetonsEnClair(l.sortie),
                  droite: true,
                  masqueSurTelephone: true,
                },
                { cle: 'jetons', libelle: t('Jetons'), valeur: (l) => l.jetons, rendu: (l) => jetonsEnClair(l.jetons), droite: true },
              ]}
            />
          </Section>
        )}
      </EtatDeRubrique>
      <Telemetrie debut={debut} fin={fin} taille={taille} onTaille={setTaille} />
    </div>
  );
}

/**
 * LA TÉLÉMÉTRIE DES TÂCHES, sur la même période : elle voyage à part
 * (`stats.telemetrie`), et son échec n'emporte pas l'historique.
 */
function Telemetrie({ debut, fin, taille, onTaille }: ProprietesDeRubrique & { taille: number; onTaille: (n: number) => void }) {
  const [telemetrie, setTelemetrie] = React.useState<DonneesTelemetrie | null | 'erreur'>(null);
  React.useEffect(() => {
    let vivant = true;
    setTelemetrie(null);
    client
      .call({ type: 'stats.telemetrie', debut, fin }, 120000)
      .then((data) => vivant && setTelemetrie(data as DonneesTelemetrie))
      .catch(() => vivant && setTelemetrie('erreur'));
    return () => {
      vivant = false;
    };
  }, [debut, fin]);

  return (
    <Section
      titre={t('Télémétrie des tâches')}
      icone={<Activity className="h-3.5 w-3.5 text-faint" />}
      aide={t(
        "Pour chaque tâche terminée : les jetons réellement consommés par le moteur, les sujets de mémoire ouverts et le temps qu'ils ont pris, et une estimation de qualité.",
      )}
      data-telemetrie-taches
    >
      {telemetrie === null ? (
        <SilhouetteRubrique />
      ) : telemetrie === 'erreur' ? (
        <p className="text-[13px] text-faint">{t("Les statistiques n'ont pas pu être chargées. Réessayez dans un instant.")}</p>
      ) : telemetrie.taches.length ? (
        <div className="space-y-4">
          <Tuiles>
            <Tuile
              icone={<ListChecks className="h-3.5 w-3.5" />}
              titre={t('Tâches mesurées')}
              valeur={nombre(telemetrie.resume.taches)}
              dessous={t('sur la période')}
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
          </Tuiles>

          <div>
            <h3 className="mb-2 text-[12.5px] font-medium text-text">{t('Jetons et durée, jour par jour')}</h3>
            <CourbeJetonsEtDuree tendances={telemetrie.tendances} />
          </div>

          <div>
            <h3 className="mb-2 flex items-center gap-1 text-[12.5px] font-medium text-text">
              {t('Le détail, tâche par tâche')}
              <BulleInfo cote="start">
                {t(
                  "Une ligne par tâche, la plus récente en tête. Ouvrez-en une pour voir d'où vient sa note et ce qu'elle a lu dans la mémoire du projet.",
                )}
                {'\n\n'}
                {t(
                  "La note compare chaque tâche à la médiane mesurée sur ce dépôt : {v0} jetons et {v1} min. C'est une estimation du déroulé, pas un jugement du code produit.",
                  {
                    v0: telemetrie.references.jetons.toLocaleString(formatRegional()),
                    v1: Math.round(telemetrie.references.secondes / 60),
                  },
                )}
              </BulleInfo>
            </h3>
            <TableauDeDonnees
              repere="telemetrie"
              lignes={telemetrie.taches}
              cle={(l) => l.cardId}
              taille={taille}
              onTaille={onTaille}
              attributsLigne={(l) => ({ 'data-tache-mesuree': l.cardId })}
              detail={(l) => <DetailDeTache tache={l} />}
              vide={t('Aucune tâche mesurée sur la période.')}
              colonnes={[
                { cle: 'titre', libelle: t('Tâche'), valeur: (l) => l.titre ?? t('Carte retirée'), largeur: 'sm:min-w-[200px]' },
                { cle: 'projet', libelle: t('Projet'), valeur: (l) => l.projet ?? t('Projet retiré'), masqueSurTelephone: true },
                { cle: 'issue', libelle: t('Issue'), valeur: (l) => issueEnClair(l.issue), masqueSurTelephone: true },
                { cle: 'duree', libelle: t('Durée'), valeur: (l) => l.secondes, rendu: (l) => dureeEnClair(l.secondes), droite: true },
                {
                  cle: 'jetons',
                  libelle: t('Jetons'),
                  valeur: (l) => l.tokensEntree + l.tokensSortie,
                  rendu: (l) => jetonsEnClair(l.tokensEntree + l.tokensSortie),
                  droite: true,
                  masqueSurTelephone: true,
                },
                { cle: 'memoire', libelle: t('Mémoire'), valeur: (l) => l.memoire.ouvertures, droite: true, masqueSurTelephone: true },
                {
                  cle: 'note',
                  libelle: t('Note'),
                  valeur: (l) => l.qualite.note,
                  rendu: (l) => <PastilleDeNote qualite={l.qualite} />,
                  droite: true,
                },
              ]}
            />
          </div>
        </div>
      ) : (
        <p className="text-[13px] text-faint">{t('Aucune tâche mesurée sur la période.')}</p>
      )}
    </Section>
  );
}

function issueEnClair(issue: MesureDeTache['issue']): string {
  return issue === 'terminee' ? t('terminée') : issue === 'interrompue' ? t('interrompue') : t('en échec');
}

/** La note d'une tâche, avec le détail de ses quatre critères au survol. */
function PastilleDeNote({ qualite }: { qualite: NoteDeQualite }) {
  const detail = qualite.criteres.map((c) => `${c.points}/${c.sur} — ${c.raison}`).join('\n');
  return (
    <span className="rounded bg-raised px-1.5 py-0.5 text-[12px] font-medium text-text" title={detail} data-note-tache={qualite.note}>
      {t('{v0}/100', { v0: qualite.note })}
    </span>
  );
}

/** Le détail d'une tâche dépliée : sa note critère par critère, la mémoire ouverte, ses jetons. */
function DetailDeTache({ tache }: { tache: MesureDeTache & { qualite: NoteDeQualite } }) {
  return (
    <div className="whitespace-normal" data-detail-tache-mesuree>
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
          : t("La mémoire du projet n'a pas été ouverte.")}
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
        {' · '}
        {dateHeure(tache.at)}
      </p>
    </div>
  );
}

/**
 * JETONS CONTRE DURÉE, JOUR PAR JOUR — les jetons en barres (une masse), la
 * durée moyenne d'une tâche en ligne par-dessus (une allure) : un jour cher
 * n'est pas forcément un jour long.
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
  const jourEnClair = (jour: string) => dateCourte(Date.parse(`${jour}T12:00:00Z`));

  return (
    <div data-courbe-jetons-duree>
      <div className="relative" style={{ height: hauteur }}>
        <div className="absolute inset-0 flex items-end gap-px sm:gap-0.5">
          {tendances.map((point) => (
            <button
              type="button"
              key={point.jour}
              onClick={() => setActif((prec) => (prec === point.jour ? null : point.jour))}
              className="flex min-w-0 flex-1 items-end self-stretch"
              aria-pressed={point.jour === actif}
              aria-label={`${jourEnClair(point.jour)} · ${jetonsEnClair(point.jetons)} · ${point.minutesParTache} min`}
              title={t('{v0} · {v1} · {v2} min', { v0: jourEnClair(point.jour), v1: jetonsEnClair(point.jetons), v2: point.minutesParTache })}
            >
              <div
                className={cn('w-full rounded-t', point.jour === actif && 'ring-2 ring-accent ring-offset-1 ring-offset-surface')}
                style={{
                  height: Math.max(2, Math.round((point.jetons / maxJetons) * (hauteur - 12))),
                  backgroundColor: couleurIntensite(point.jetons, maxJetons),
                }}
                data-barre-jetons={point.jour}
              />
            </button>
          ))}
        </div>
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 100 ${hauteur}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d={ligne} fill="none" stroke="hsl(var(--accent))" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <AxeDesJours
        etiquettes={tendances.map((point) => String(Number(point.jour.split('-')[2])))}
        actif={actif === null ? null : tendances.findIndex((p) => p.jour === actif)}
      />
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-faint">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: couleurIntensite(1, 1) }} />
          {t('Jetons facturables')}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-[2px] w-3 rounded-full bg-accent" />
          {t("Durée moyenne d'une tâche")}
        </span>
      </div>
      <p className="mt-1 min-h-[18px] text-[12px] text-faint" aria-live="polite" data-detail-jour-telemetrie>
        {pointActif ? (
          <>
            <span className="font-semibold text-text">{jourEnClair(pointActif.jour)}</span>
            {` · ${t('{v0} tâche{v1}', { v0: pointActif.taches, v1: pointActif.taches > 1 ? 's' : '' })}`}
            {` · ${jetonsEnClair(pointActif.jetons)} ${t('jetons')}`}
            {` · ${t('{v0} min par tâche', { v0: pointActif.minutesParTache })}`}
            {` · ${t('mémoire triée à {v0}', { v0: partEnClair(pointActif.rendementMemoire) })}`}
          </>
        ) : (
          t('Touchez une barre pour voir le détail du jour.')
        )}
      </p>
    </div>
  );
}
