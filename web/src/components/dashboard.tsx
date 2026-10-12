import * as React from 'react';
import {
  Activity,
  BarChart3,
  Clapperboard,
  HardDriveDownload,
  Key,
  LayoutDashboard,
  Library,
  ListChecks,
  Megaphone,
  NotebookPen,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { bornesDeLaPeriode, bornesDeLEchelle, rubriqueDuResume, type RubriqueDuResume } from '@beluga/shared';
import { ZoneDefilement } from '@/components/ui';
import { SelecteurPeriode } from '@/components/selecteur-periode';
import { SilhouetteRubrique } from '@/components/silhouettes';
import { CranDuFil, GestesDePage, SuiteDuFil } from '@/components/entete-de-zone';
import { CLASSE_LIGNE_DE_SERVICE, CLASSE_SECTION_DE_SERVICE, ColonneDeService } from '@/components/colonne-de-service';
import { usePref } from '@/lib/prefs';
import { t } from '@/lib/langue';
import { useTelephone } from '@/lib/telephone';
import { cn } from '@/lib/utils';

/*
 * LA PAGE « RÉSUMÉ » (vue centrale `tableau-de-bord`) — refondue le 06/10/2026.
 *
 * Trois étages :
 *  - l'ENTÊTE : le titre à gauche, la PÉRIODE à droite (`SelecteurPeriode`, la
 *    seule barre de dates de l'application). Une seule période pour toute la
 *    page, 30 jours à l'ouverture ; elle n'est pas retenue (comme partout).
 *  - la COLONNE DES RUBRIQUES, propre à cette page (une liste déroulante sur
 *    téléphone) : ce ne sont PAS des vues centrales, la colonne de gauche de
 *    l'application ne change pas. La rubrique ouverte est retenue en
 *    préférence (`resume.rubrique`).
 *  - la RUBRIQUE : un morceau chargé à la demande (une rubrique jamais ouverte
 *    ne se télécharge pas), qui demande SES chiffres au démon (`stats.resume`)
 *    et les pose en tuiles, courbe par jour et tableaux triables et paginés.
 *
 * Règles pures et formes des réponses : `shared/src/resume.ts`.
 */

const chargerActivite = () => import('@/components/resume/activite');
const chargerMemoire = () => import('@/components/resume/memoire');
const chargerServices = () => import('@/components/resume/services');

type Rubrique = React.ComponentType<{ debut: number; fin: number }>;

const COMPOSANTS: Record<RubriqueDuResume, React.LazyExoticComponent<Rubrique>> = {
  ensemble: React.lazy(() => chargerActivite().then((m) => ({ default: m.RubriqueEnsemble }))),
  taches: React.lazy(() => chargerActivite().then((m) => ({ default: m.RubriqueTaches }))),
  memoire: React.lazy(() => chargerMemoire().then((m) => ({ default: m.RubriqueMemoire }))),
  surveillance: React.lazy(() => chargerServices().then((m) => ({ default: m.RubriqueSurveillance }))),
  studio: React.lazy(() => chargerServices().then((m) => ({ default: m.RubriqueStudio }))),
  coffre: React.lazy(() => chargerServices().then((m) => ({ default: m.RubriqueCoffre }))),
  backups: React.lazy(() => chargerServices().then((m) => ({ default: m.RubriqueBackups }))),
  statistiques: React.lazy(() => chargerServices().then((m) => ({ default: m.RubriqueStatistiques }))),
  messagerie: React.lazy(() => chargerServices().then((m) => ({ default: m.RubriqueMessagerie }))),
  marketing: React.lazy(() => chargerServices().then((m) => ({ default: m.RubriqueMarketing }))),
  notes: React.lazy(() => chargerServices().then((m) => ({ default: m.RubriqueNotes }))),
};

/** Les rubriques, dans l'ordre de la colonne : l'activité des agents, puis les services. */
function rubriques(): { groupe: string; entrees: { cle: RubriqueDuResume; Icone: LucideIcon; libelle: string; aide: string }[] }[] {
  return [
    {
      groupe: t('Activité'),
      entrees: [
        {
          cle: 'ensemble',
          Icone: LayoutDashboard,
          libelle: t("Vue d'ensemble"),
          aide: t('Le temps de travail des agents, jour par jour et projet par projet.'),
        },
        {
          cle: 'taches',
          Icone: ListChecks,
          libelle: t('Tâches des agents'),
          aide: t('Chaque tâche exécutée : ses tours, sa durée, ses jetons et sa note.'),
        },
        {
          cle: 'memoire',
          Icone: Library,
          libelle: t('Mémoire et compétences'),
          aide: t('Ce que la mémoire a appris, combien de fois elle a été consultée, et ce qui a vraiment servi.'),
        },
      ],
    },
    {
      groupe: t('Services'),
      entrees: [
        {
          cle: 'surveillance',
          Icone: Activity,
          libelle: t('Surveillance'),
          aide: t('Les contrôles des sites surveillés, leurs pannes et leur temps de réponse.'),
        },
        { cle: 'studio', Icone: Clapperboard, libelle: t('Studio'), aide: t("Les visuels et vidéos créés, leurs exports et ce qu'ils ont coûté.") },
        {
          cle: 'coffre',
          Icone: Key,
          libelle: t('Coffre-fort'),
          aide: t("Le nombre d'accès rangés, par projet et par type. Aucun secret n'est affiché ici."),
        },
        { cle: 'backups', Icone: HardDriveDownload, libelle: t('Backup'), aide: t('Les sauvegardes prises, leur volume et leurs échecs.') },
        {
          cle: 'statistiques',
          Icone: BarChart3,
          libelle: t('Statistiques'),
          aide: t('Les visites des sites suivis, leurs visiteurs et les objectifs atteints.'),
        },
        { cle: 'messagerie', Icone: UsersRound, libelle: t('Messagerie'), aide: t('Les demandes des clients et les messages échangés.') },
        { cle: 'marketing', Icone: Megaphone, libelle: t('Marketing'), aide: t('Les contenus préparés, les actions menées et les ventes relevées.') },
        { cle: 'notes', Icone: NotebookPen, libelle: t('Notes'), aide: t('Les notes créées et modifiées.') },
      ],
    },
  ];
}

export function Dashboard() {
  const [rubriqueGardee, setRubrique] = usePref<string>('resume.rubrique', 'ensemble');
  const rubrique = rubriqueDuResume(rubriqueGardee);
  const telephone = useTelephone();
  const [periode, setPeriode] = React.useState<{ echelle: number | null; debut: number; fin: number }>(() => {
    const { debut, fin } = bornesDeLEchelle(30, Date.now());
    return { echelle: 30, debut, fin };
  });
  const groupes = rubriques();
  const toutes = groupes.flatMap((g) => g.entrees);
  const ouverte = toutes.find((r) => r.cle === rubrique) ?? toutes[0]!;
  const Composant = COMPOSANTS[rubrique];

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg" data-resume={rubrique}>
      {/* L'ENTÊTE : le titre, puis la période, calée à droite. On quitte la page
          par la colonne de gauche, ou par le menu du bas sur téléphone. */}
      <h1 className="sr-only">{t('Résumé')}</h1>
      <GestesDePage className="px-3">
        <div data-periode-resume={`${periode.debut}-${periode.fin}`}>
          <SelecteurPeriode
            /* Dans la barre d'en-tête du téléphone : un seul bouton. */
            compact={telephone}
            echelles={[7, 30, 90]}
            echelle={periode.echelle}
            debut={periode.debut}
            fin={periode.fin}
            onEchelle={(jours) => {
              const { debut, fin } = bornesDeLEchelle(jours, Date.now());
              setPeriode({ echelle: jours, debut, fin });
            }}
            onLibre={(d, f) => {
              const { debut, fin } = bornesDeLaPeriode(d, f, Date.now());
              setPeriode({ echelle: null, debut, fin });
            }}
          />
        </div>
      </GestesDePage>

      {/* LE FIL D'ARIANE DIT LA RUBRIQUE OUVERTE — « Services › Résumé ›
          Consommation » ; « Résumé » y ramène à la vue d'ensemble. */}
      <SuiteDuFil onRacine={() => setRubrique('ensemble')}>
        <CranDuFil data-rubrique-du-fil={rubrique}>
          {groupes.flatMap((groupe) => groupe.entrees).find((entree) => entree.cle === rubrique)?.libelle ?? ''}
        </CranDuFil>
      </SuiteDuFil>

      {/* LES RUBRIQUES VIVENT DANS LA COLONNE DE GAUCHE, à la place des projets :
          une seule colonne, jamais deux côte à côte. */}
      <ColonneDeService>
        <ZoneDefilement hauteur={16} className="pb-4" classeEnveloppe="w-full">
          <nav aria-label="Rubriques du resume">
            {groupes.map((groupe) => (
              <div key={groupe.groupe}>
                <p className={CLASSE_SECTION_DE_SERVICE}>{groupe.groupe}</p>
                {groupe.entrees.map(({ cle, Icone, libelle }) => (
                  <button
                    key={cle}
                    type="button"
                    onClick={() => setRubrique(cle)}
                    aria-current={cle === rubrique ? 'page' : undefined}
                    className={cn(CLASSE_LIGNE_DE_SERVICE, cle === rubrique ? 'bg-ligne-active text-teinte' : 'hover:bg-raised')}
                    data-rubrique={cle}
                  >
                    <Icone className="h-4 w-4 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate">{libelle}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </ZoneDefilement>
      </ColonneDeService>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <ZoneDefilement className="px-3 py-2 sm:px-8 sm:pb-20 sm:pt-6" data-fil="tableau-de-bord">
            <div className="mx-auto w-full max-w-[920px] space-y-6">
              {/* SUR TÉLÉPHONE, la colonne devient une liste déroulante en tête. */}
              <label className="block sm:hidden">
                <span className="sr-only">{t('Rubrique')}</span>
                <select
                  value={rubrique}
                  onChange={(e) => setRubrique(e.target.value)}
                  className="h-9 w-full rounded-md bg-surface px-2 text-[14px] text-text"
                  data-rubrique-choix
                >
                  {groupes.map((groupe) => (
                    <optgroup key={groupe.groupe} label={groupe.groupe}>
                      {groupe.entrees.map(({ cle, libelle }) => (
                        <option key={cle} value={cle}>
                          {libelle}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>

              <div>
                <h2 className="text-[26px] font-semibold tracking-tight text-text">{ouverte.libelle}</h2>
                <p className="mt-1.5 text-[14.5px] text-muted">{ouverte.aide}</p>
              </div>

              <React.Suspense fallback={<SilhouetteRubrique />}>
                <Composant key={rubrique} debut={periode.debut} fin={periode.fin} />
              </React.Suspense>
            </div>
          </ZoneDefilement>
        </div>
      </div>
    </div>
  );
}
