/*
 * LE GENRE D'UNE ÉTAPE, D'APRÈS SON OUTIL : commandes, lecture, écriture, aides
 * (sous-agents), réponse attendue de l'utilisateur, ou autre outil. Une règle
 * pure, lue par le déroulé en direct pour peindre les AIDES en violet
 * (`web/src/components/steps.tsx`, `chat.tsx`).
 *
 * La répartition du temps d'un tour par genre, affichée sous chaque réponse,
 * a été retirée à la demande de l'utilisateur (19/10/2026) : seule reste la
 * reconnaissance du genre.
 */
import type { RunStep } from './models.js';
import { nomSansPont } from './noms-outils.js';

export type GenreDeTemps = 'reflexion' | 'commandes' | 'lecture' | 'ecriture' | 'aides' | 'outils' | 'reponse';

const PAR_OUTIL: Record<string, GenreDeTemps> = {
  agent: 'aides',
  task: 'aides',
  bash: 'commandes',
  bashoutput: 'commandes',
  killshell: 'commandes',
  monitor: 'commandes',
  shell: 'commandes',
  exec_command: 'commandes',
  local_shell: 'commandes',
  read: 'lecture',
  grep: 'lecture',
  glob: 'lecture',
  ls: 'lecture',
  websearch: 'lecture',
  webfetch: 'lecture',
  web_search: 'lecture',
  write: 'ecriture',
  edit: 'ecriture',
  multiedit: 'ecriture',
  notebookedit: 'ecriture',
  apply_patch: 'ecriture',
  ask_user: 'reponse',
};

/** Le genre de temps d'une étape, d'après son outil (ou son libellé, à défaut). */
export function genreDeTempsDeLEtape(step: Pick<RunStep, 'outil' | 'label'>): GenreDeTemps {
  const outil = nomSansPont(step.outil ?? '').toLowerCase();
  if (outil && PAR_OUTIL[outil]) return PAR_OUTIL[outil];
  if (outil) return 'outils';
  const libelle = (step.label ?? '').toLowerCase();
  if (/sous-agent|aide/.test(libelle)) return 'aides';
  if (/commande/.test(libelle)) return 'commandes';
  if (/lecture|recherche|consultation/.test(libelle)) return 'lecture';
  if (/écriture|modification/.test(libelle)) return 'ecriture';
  return 'outils';
}

/** Une étape est-elle une AIDE (sous-agent) ? Elle se peint alors en violet. */
export function estUneAide(step: Pick<RunStep, 'outil' | 'label'>): boolean {
  return genreDeTempsDeLEtape(step) === 'aides';
}
