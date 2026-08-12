import * as React from 'react';
import { ArrowLeft, Clock, Gauge, ListChecks, TrendingUp } from 'lucide-react';
import { couleurIntensite } from '@haikodev/shared';
import { Button, ZoneDefilement } from '@/components/ui';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';

/* Ce que le serveur renvoie pour la commande `stats.dashboard`. */
type DonneesTableau = {
  byProject: { projectId: string; name?: string; tokens: number; seconds: number; tasks: number }[];
  byDay: { day: string; tokens: number; seconds: number; tasks: number }[];
  byCard: {
    cardId: string;
    title: string;
    projectName?: string;
    column?: string;
    /** MESURÉ, en points de pourcentage : ce que la carte a réellement pris. 0 = aucun relevé. */
    quota5h: number;
    quotaSemaine: number;
    /** ESTIMÉ à la validation, en fraction (0,12) — jamais mélangé au mesuré. */
    quotaEstime?: number;
    tokens: number;
    seconds: number;
    turns: number;
  }[];
};

/** Secondes machine → « 3 h 20 » ou « 12 min », lisible d'un coup d'œil. */
function dureeEnClair(secondes: number): string {
  const minutes = Math.round(secondes / 60);
  if (minutes < 60) return `${minutes} min`;
  const heures = Math.floor(minutes / 60);
  const reste = minutes % 60;
  return reste ? `${heures} h ${reste.toString().padStart(2, '0')}` : `${heures} h`;
}

/** Un jour « 2026-08-04 » → « 4 août », pour l'axe de la courbe. */
function jourEnClair(jour: string): string {
  const [, mois, quantieme] = jour.split('-');
  const noms = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  return `${Number(quantieme)} ${noms[Number(mois) - 1] ?? ''}`.trim();
}

/**
 * Une part de quota ESTIMÉE, notée en fraction (0,42) OU déjà en pourcent (42)
 * → « 42 % ». L'échelle des estimations anciennes n'est pas garantie, d'où ce
 * rattrapage ; il ne vaut QUE pour l'estimation.
 */
function partEnClair(part: number): string {
  const pourcent = part <= 1 ? part * 100 : part;
  return `${pourcent.toFixed(pourcent < 10 ? 1 : 0)} %`;
}

/**
 * Une part de quota MESURÉE : toujours en points de pourcentage (c'est ce que
 * la base range), donc aucune conversion — 0,5 vaut bien un demi-pourcent, et
 * non 50 %. Deux décimales sous 1 %, pour qu'une petite tâche ne s'affiche pas
 * « 0 % ».
 */
function pourcentEnClair(part: number): string {
  if (part < 1) return `${part.toFixed(2)} %`;
  return `${part.toFixed(part < 10 ? 1 : 0)} %`;
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
  if (!jours.length) return <p className="text-[13px] text-faint">Aucune consommation relevée pour l'instant.</p>;
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
          'Touchez une barre pour voir le détail du jour.'
        )}
      </p>
    </div>
  );
}

export function Dashboard({ onClose }: { onClose: () => void }) {
  const state = useApp();
  const [donnees, setDonnees] = React.useState<DonneesTableau | null>(null);
  const [erreur, setErreur] = React.useState(false);

  React.useEffect(() => {
    let vivant = true;
    client
      .call({ type: 'stats.dashboard' }, 120000)
      .then((data) => vivant && setDonnees(data as DonneesTableau))
      .catch(() => vivant && setErreur(true));
    return () => {
      vivant = false;
    };
  }, []);

  // Le nom vivant d'abord, sinon celui figé à la dépense.
  const nomDuProjet = (row: { projectId: string; name?: string }) =>
    state.projects.find((p) => p.id === row.projectId)?.name ?? row.name ?? `Projet supprimé · ${row.projectId.slice(0, 8)}`;

  const byProject = donnees?.byProject ?? [];
  const tempsTotal = byProject.reduce((total, p) => total + (p.seconds ?? 0), 0);
  const tachesTotal = byProject.reduce((total, p) => total + (p.tasks ?? 0), 0);
  // Le classement suit le TEMPS de travail (ce que la ligne affiche), le plus long en tête,
  // et la barre mesure la même grandeur : elle décroît donc du haut vers le bas.
  const projetsParTemps = [...byProject].sort((a, b) => (b.seconds ?? 0) - (a.seconds ?? 0));
  const maxProjet = Math.max(1, ...byProject.map((p) => p.seconds ?? 0));
  // Les jours arrivent du plus récent au plus ancien : la courbe se lit à l'endroit.
  const jours = [...(donnees?.byDay ?? [])].reverse();
  // Les cartes se rangent en deux tas, jamais mélangés : celles dont la part de
  // quota a été MESURÉE (classées par la part de SEMAINE décroissante — ce que
  // la ligne affiche en tête, et ce que le serveur trie déjà), et les anciennes
  // sans le moindre relevé, qui le disent au lieu d'afficher un zéro trompeur.
  const toutesLesCartes = donnees?.byCard ?? [];
  const cartesMesurees = toutesLesCartes
    .filter((c) => (c.quotaSemaine ?? 0) > 0 || (c.quota5h ?? 0) > 0)
    .sort((a, b) => (b.quotaSemaine ?? 0) - (a.quotaSemaine ?? 0));
  const cartesSansReleve = toutesLesCartes.filter((c) => !((c.quotaSemaine ?? 0) > 0 || (c.quota5h ?? 0) > 0));
  const totalSemaine = cartesMesurees.reduce((total, c) => total + (c.quotaSemaine ?? 0), 0);
  const total5h = cartesMesurees.reduce((total, c) => total + (c.quota5h ?? 0), 0);
  // La barre se mesure au plus gros consommateur de la SEMAINE : même grandeur
  // que le classement, donc elle décroît du haut vers le bas.
  const maxSemaine = Math.max(0.0001, ...cartesMesurees.map((c) => c.quotaSemaine ?? 0));

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={onClose} data-fermer-tableau-de-bord>
          <ArrowLeft className="h-3.5 w-3.5" /> Revenir au tableau
        </Button>
        <h1 className="ml-1 text-[15px] font-semibold text-text">Tableau de bord</h1>
      </header>

      <ZoneDefilement className="px-3 py-3" data-fil="tableau-de-bord">
        <div className="mx-auto w-full max-w-[1100px] space-y-5">
          {erreur ? (
            <p className="text-[13px] text-faint">Les statistiques n'ont pas pu être chargées. Réessayez dans un instant.</p>
          ) : null}

          {/* 1. Chiffres de tête : temps de travail, tâches. */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Tuile
              icone={<Clock className="h-3.5 w-3.5" />}
              titre="Temps de travail total"
              valeur={dureeEnClair(tempsTotal)}
              dessous="Cumul des agents, tous projets"
            />
            <Tuile
              icone={<ListChecks className="h-3.5 w-3.5" />}
              titre="Tâches exécutées"
              valeur={tachesTotal.toLocaleString('fr-CH')}
              dessous={`${byProject.length} projet${byProject.length > 1 ? 's' : ''} concerné${byProject.length > 1 ? 's' : ''}`}
            />
          </div>

          {/* 2. Le temps de travail au fil des jours. */}
          <section className="rounded-lg border border-border bg-surface px-3 py-3">
            <h2 className="flex items-center gap-1.5 text-[13.5px] font-medium text-text">
              <TrendingUp className="h-3.5 w-3.5 text-faint" /> Activité au fil des jours
            </h2>
            <p className="mb-3 mt-0.5 text-[12.5px] text-faint">
              Le temps de travail des agents chaque jour, tous moteurs confondus, sur le dernier mois.
            </p>
            <CourbeParJour jours={jours} />
          </section>

          {/* 3. Les projets les plus travaillés. */}
          <section className="rounded-lg border border-border bg-surface px-3 py-3">
            <h2 className="flex items-center gap-1.5 text-[13.5px] font-medium text-text">
              <Gauge className="h-3.5 w-3.5 text-faint" /> Projets les plus travaillés
            </h2>
            {byProject.length ? (
              <div className="mt-2 space-y-1.5">
                {projetsParTemps.slice(0, 10).map((row) => (
                  <div key={row.projectId}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13px] text-text">{nomDuProjet(row)}</span>
                      <span className="shrink-0 text-[11.5px] text-faint">
                        {row.tasks} tâche{row.tasks > 1 ? 's' : ''} · {dureeEnClair(row.seconds)}
                      </span>
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
              <p className="mt-1 text-[13px] text-faint">Aucune consommation relevée pour l'instant.</p>
            )}
          </section>

          {/* 4. La part de quota par carte (dépend de la carte précédente). */}
          <section className="rounded-lg border border-border bg-surface px-3 py-3">
            <h2 className="flex items-center gap-1.5 text-[13.5px] font-medium text-text">
              <Gauge className="h-3.5 w-3.5 text-faint" /> Part de quota par carte
            </h2>
            <p className="mb-2 mt-0.5 text-[12.5px] text-faint">
              La part de quota que chaque tâche a réellement consommée : la semaine en tête, la fenêtre de 5 h juste
              après. Les tâches sont classées de la plus gourmande à la moins gourmande sur la semaine.
            </p>
            {cartesMesurees.length ? (
              <>
                {/* Le total de la période, rappelé AU-DESSUS de la liste. */}
                <p className="mb-2 text-[12.5px] text-text" data-total-quota>
                  Total mesuré sur la période :{' '}
                  <span className="font-semibold">{pourcentEnClair(totalSemaine)} du quota de la semaine</span>
                  {' · '}
                  {pourcentEnClair(total5h)} de fenêtres de 5 h, sur {cartesMesurees.length} tâche
                  {cartesMesurees.length > 1 ? 's' : ''}
                </p>
                <div className="space-y-1.5">
                  {cartesMesurees.slice(0, 20).map((carte) => (
                    <div
                      key={carte.cardId}
                      className="rounded-md border border-border bg-bg px-2 py-1.5"
                      data-quota-carte
                      data-quota-semaine={carte.quotaSemaine}
                    >
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] text-text">{carte.title}</p>
                          <p className="truncate text-[11px] text-faint">
                            {carte.projectName ?? 'Projet retiré'} · {dureeEnClair(carte.seconds)}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <span className="rounded bg-raised px-1.5 py-0.5 text-[12px] font-medium text-text">
                            {pourcentEnClair(carte.quotaSemaine ?? 0)} semaine
                          </span>
                          <p className="mt-0.5 text-[11px] text-faint">{pourcentEnClair(carte.quota5h ?? 0)} sur 5 h</p>
                        </div>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-raised">
                        <div
                          className="h-full rounded-full"
                          data-barre-carte={carte.cardId}
                          style={{
                            width: `${Math.round(((carte.quotaSemaine ?? 0) / maxSemaine) * 100)}%`,
                            backgroundColor: couleurIntensite(carte.quotaSemaine ?? 0, maxSemaine),
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-[13px] text-faint">
                Aucune tâche ne porte encore de part de quota mesurée. Ce bloc se remplira à mesure que de nouvelles
                tâches s'exécutent.
              </p>
            )}

            {/* Les tâches sans le moindre relevé : dites, jamais chiffrées à zéro. */}
            {cartesSansReleve.length ? (
              <div className="mt-3 border-t border-border pt-2">
                <p className="text-[12px] text-faint">
                  {cartesSansReleve.length} tâche{cartesSansReleve.length > 1 ? 's' : ''} sans relevé de quota — la
                  mesure est récente, les tâches plus anciennes n'en portent pas.
                </p>
                <div className="mt-1 space-y-0.5">
                  {cartesSansReleve.slice(0, 5).map((carte) => (
                    <div
                      key={carte.cardId}
                      className="flex items-center gap-2 rounded-md border border-border bg-bg px-2 py-1"
                      data-quota-sans-releve
                    >
                      <p className="min-w-0 flex-1 truncate text-[12.5px] text-faint">{carte.title}</p>
                      <span className="shrink-0 text-[11px] text-faint">
                        {carte.quotaEstime != null
                          ? `${partEnClair(carte.quotaEstime)} estimés, jamais mesurés`
                          : 'pas de relevé'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </ZoneDefilement>
    </div>
  );
}
