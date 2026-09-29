import { FUSEAU, type DureeDecoupee, type PrevisionEpuisement } from '@beluga/shared';
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
  const { jour, heure, demiHeure } = prevision.morceaux;
  const nomDuJour =
    jour === 'aujourdhui'
      ? t('aujourd’hui')
      : jour === 'demain'
        ? t('demain')
        : new Date(prevision.at).toLocaleDateString(formatRegional(), { timeZone: FUSEAU, weekday: 'long' });
  const heureDite = demiHeure ? t('{heure} h 30', { heure }) : t('{heure} h', { heure });
  return t('épuisé {jour} vers {heure}', { jour: nomDuJour, heure: heureDite });
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
        : t('en tenant compte des heures creuses mesurées (la nuit consomme peu)');
  const exact = new Date(brut).toLocaleString(formatRegional(), {
    timeZone: FUSEAU,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  return t(
    'Au rythme observé ({cadence}), {base}, épuisement estimé {exact}, avant la remise à zéro : il manquerait {duree} jusque-là.',
    { cadence: cadenceDite, base: baseDite, exact, duree: dureeDuManque(manque) },
  );
}
