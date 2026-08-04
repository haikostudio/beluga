import * as React from 'react';
import { Activity, ArrowLeft, Clock, Gauge, ListChecks, TrendingUp } from 'lucide-react';
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
    quotaShare?: number;
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

/** Une part de quota, notée en fraction (0,42) OU déjà en pourcent (42) → « 42 % ». */
function partEnClair(part: number): string {
  const pourcent = part <= 1 ? part * 100 : part;
  return `${pourcent.toFixed(pourcent < 10 ? 1 : 0)} %`;
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
 * Histogramme des jetons dépensés jour par jour, tous moteurs confondus. Une
 * barre par jour, du plus ancien au plus récent, avec une infobulle qui donne
 * le détail. Pur SVG : aucune bibliothèque de graphiques dans le projet.
 */
function CourbeParJour({ jours }: { jours: DonneesTableau['byDay'] }) {
  if (!jours.length) return <p className="text-[13px] text-faint">Aucune consommation relevée pour l'instant.</p>;
  const max = Math.max(1, ...jours.map((j) => j.tokens));
  return (
    <div className="flex items-end gap-1" style={{ height: 140 }}>
      {jours.map((jour) => {
        const hauteur = Math.max(2, Math.round((jour.tokens / max) * 120));
        return (
          <div key={jour.day} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${jourEnClair(jour.day)} · ${jour.tokens.toLocaleString('fr-CH')} jetons · ${dureeEnClair(jour.seconds)}`}>
            <div className="flex w-full flex-1 items-end">
              <div className="w-full rounded-t bg-muted/70" style={{ height: hauteur }} />
            </div>
            <span className="w-full truncate text-center text-[9px] text-faint">{Number(jour.day.split('-')[2])}</span>
          </div>
        );
      })}
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
  const jetonsTotal = byProject.reduce((total, p) => total + (p.tokens ?? 0), 0);
  // Le classement suit le TEMPS de travail (ce que la ligne affiche), le plus long en tête,
  // et la barre mesure la même grandeur : elle décroît donc du haut vers le bas.
  const projetsParTemps = [...byProject].sort((a, b) => (b.seconds ?? 0) - (a.seconds ?? 0));
  const maxProjet = Math.max(1, ...byProject.map((p) => p.seconds ?? 0));
  // Les jours arrivent du plus récent au plus ancien : la courbe se lit à l'endroit.
  const jours = [...(donnees?.byDay ?? [])].reverse();
  // La conso par carte n'apparaît qu'avec une part de quota mesurée (carte précédente).
  const cartesAvecQuota = (donnees?.byCard ?? []).filter((c) => c.quotaShare != null);

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

          {/* 1. Chiffres de tête : temps de travail, tâches, jetons. */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
            <Tuile
              icone={<Activity className="h-3.5 w-3.5" />}
              titre="Jetons consommés"
              valeur={jetonsTotal.toLocaleString('fr-CH')}
              dessous="Tous moteurs confondus"
            />
          </div>

          {/* 2. La consommation au fil des jours. */}
          <section className="rounded-lg border border-border bg-surface px-3 py-3">
            <h2 className="flex items-center gap-1.5 text-[13.5px] font-medium text-text">
              <TrendingUp className="h-3.5 w-3.5 text-faint" /> Consommation au fil des jours
            </h2>
            <p className="mb-3 mt-0.5 text-[12.5px] text-faint">
              Les jetons dépensés chaque jour, tous moteurs confondus, sur le dernier mois.
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
                      <div className="h-full rounded-full bg-muted/70" style={{ width: `${Math.round(((row.seconds ?? 0) / maxProjet) * 100)}%` }} />
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
              La part de quota (fenêtre de 5 h et semaine) que chaque carte a réellement consommée. Cette mesure vient
              d'être ajoutée : les tâches anciennes n'en portent pas encore.
            </p>
            {cartesAvecQuota.length ? (
              <div className="space-y-0.5">
                {cartesAvecQuota.slice(0, 20).map((carte) => (
                  <div key={carte.cardId} className="flex items-center gap-2 rounded-md border border-border bg-bg px-2 py-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-text">{carte.title}</p>
                      <p className="truncate text-[11px] text-faint">
                        {carte.projectName ?? 'Projet retiré'} · {dureeEnClair(carte.seconds)}
                      </p>
                    </div>
                    <span className="shrink-0 rounded bg-raised px-1.5 py-0.5 text-[12px] font-medium text-text">
                      {partEnClair(carte.quotaShare!)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-faint">
                Aucune carte ne porte encore de part de quota mesurée. Ce bloc se remplira à mesure que de nouvelles
                tâches s'exécutent.
              </p>
            )}
          </section>
        </div>
      </ZoneDefilement>
    </div>
  );
}
