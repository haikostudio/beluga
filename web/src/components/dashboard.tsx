import * as React from 'react';
import { ArrowLeft, Clock, Gauge, History, ListChecks, TrendingUp } from 'lucide-react';
import { couleurIntensite } from '@haikodev/shared';
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
