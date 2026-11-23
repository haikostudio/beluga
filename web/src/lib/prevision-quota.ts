import { FUSEAU, type DureeDecoupee, type EnsembleDeFamille, type MorceauxDePrevision, type PrevisionEpuisement } from '@beluga/shared';
import { formatRegional, t } from './langue';

/*
 * La prévision d'épuisement d'un compte, dite dans la langue choisie.
 *
 * `previsionEpuisement` (dans `shared/`) calcule en MORCEAUX (`morceaux`) et ne
 * rend que du français dans `texte` et `detail`. Ici, ces morceaux sont
 * assemblés à chaque rendu, jamais à l'import : `t` lit la langue du moment.
 * Chaque phrase part ENTIÈRE au dictionnaire, avec ses trous nommés, pour que
 * chaque langue range ses mots comme elle l'entend.
 */

/** « 1 j 4 h », « 3 h 05 », « 25 min », « moins d’une minute ». */
export function dureeDuManque({ jours, heures, minutes }: DureeDecoupee): string {
  if (jours >= 1) {
    return heures
      ? t('{jours} j {heures} h', { jours, heures })
      : t('{jours} j', { jours });
  }
  if (heures >= 1) {
    return minutes
      ? t('{heures} h {minutes}', { heures, minutes: String(minutes).padStart(2, '0') })
      : t('{heures} h', { heures });
  }
  return minutes >= 1 ? t('{minutes} min', { minutes }) : t('moins d’une minute');
}

/** « épuisé dimanche vers 13 h 30 », dans la langue choisie. */
export function texteDePrevision(prevision: PrevisionEpuisement): string {
  return t('épuisé {jour} vers {heure}', jourEtHeure(prevision.at, prevision.morceaux));
}

/** Le jour et l'heure d'un instant arrondi, dits dans la langue choisie. */
function jourEtHeure(at: number, { jour, heure, demiHeure }: Pick<MorceauxDePrevision, 'jour' | 'heure' | 'demiHeure'>) {
  const nomDuJour =
    jour === 'aujourdhui'
      ? t('aujourd’hui')
      : jour === 'demain'
        ? t('demain')
        : new Date(at).toLocaleDateString(formatRegional(), { timeZone: FUSEAU, weekday: 'long' });
  const heureDite = demiHeure ? t('{heure} h 30', { heure }) : t('{heure} h', { heure });
  return { jour: nomDuJour, heure: heureDite };
}

/**
 * LA LIGNE DE LA FAMILLE, sous le titre d'un moteur : quand il n'y aura plus AUCUN compte disponible et pour combien de
 * temps, ou que l'un d'eux tient toujours jusqu'aux remises à zéro.
 */
export function texteDeFamille(ensemble: EnsembleDeFamille): string {
  if (ensemble.tient) return t('Ensemble : tient jusqu’aux remises à zéro');
  return t('Ensemble : plus aucun compte {jour} vers {heure} (manque {duree})', {
    ...jourEtHeure(ensemble.at, ensemble.morceaux),
    duree: dureeDuManque(ensemble.morceaux.manque),
  });
}

/** L'infobulle de la ligne de famille : ce que le calcul suppose. */
export function detailDeFamille(): string {
  return t(
    'Les comptes de ce moteur se partagent le travail : quand l’un est épuisé, les autres prennent sa part, et il la reprend à sa remise à zéro. Les nuits comptent comme une pause, apprise sur votre activité.',
  );
}

/** « manque 1 j 4 h » : ce qui manquera avant la remise à zéro. */
export function texteDuManque(prevision: PrevisionEpuisement): string {
  return t('manque {duree}', { duree: dureeDuManque(prevision.morceaux.manque) });
}

/** L'infobulle : le rythme observé, d'où il sort, l'heure exacte et ce qui manquerait. */
export function detailDePrevision(prevision: PrevisionEpuisement): string {
  const { cadence, base, brut, manque } = prevision.morceaux;
  const pct = cadence.pct.toLocaleString(formatRegional(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const cadenceDite =
    cadence.unite === 'heure' ? t('environ {pct} % par heure', { pct }) : t('environ {pct} % par jour', { pct });
  const baseDite =
    base === 'prolongement'
      ? t('en prolongeant simplement le rythme des dernières heures')
      : base === 'semaine'
        ? t('en tenant compte des heures creuses mesurées (la nuit et le week-end consomment peu)')
        : base === 'nuits'
          ? t('en comptant une pause de six heures chaque nuit (de 1 h à 7 h, le temps d’apprendre vos horaires)')
          : t('en tenant compte des heures creuses mesurées (la nuit consomme peu)');
  const exact = new Date(brut).toLocaleString(formatRegional(), {
    timeZone: FUSEAU,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const { partage } = prevision.morceaux;
  if (partage) {
    return t(
      'Au rythme observé ({cadence}), {base}, charge partagée avec {comptes}, épuisement estimé {exact}, avant la remise à zéro : il manquerait {duree} jusque-là.',
      {
        cadence: cadenceDite,
        base: baseDite,
        comptes: partage.length ? partage.join(', ') : t('aucun autre compte disponible'),
        exact,
        duree: dureeDuManque(manque),
      },
    );
  }
  return t(
    'Au rythme observé ({cadence}), {base}, épuisement estimé {exact}, avant la remise à zéro : il manquerait {duree} jusque-là.',
    { cadence: cadenceDite, base: baseDite, exact, duree: dureeDuManque(manque) },
  );
}
