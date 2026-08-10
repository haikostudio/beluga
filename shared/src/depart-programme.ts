/**
 * « Cette carte partira mardi à 6 h. »
 *
 * Une carte prête à partir n'avait que deux vitesses : elle attendait un clic,
 * ou elle partait « dès que possible ». Rien ne permettait de dire QUAND — d'où
 * cette date de départ souhaitée, posée sur l'état d'ordonnancement
 * (`SchedulingState.departPrevu`, en millisecondes).
 *
 * La règle est volontairement petite et sans mémoire : elle compare une date à
 * l'instant présent et dit ce qu'il faut en faire. Ni base, ni disque, ni
 * horloge cachée — l'instant est TOUJOURS passé en argument, sinon les tests
 * dépendraient de l'heure qu'il est.
 *
 * Trois principes tiennent tout :
 *   - une date FUTURE retient la carte, quoi qu'il arrive par ailleurs : c'est
 *     bien ce qu'on a demandé en la posant ;
 *   - une date PASSÉE autorise le départ, et le reste autorisé indéfiniment —
 *     un démon redémarré rattrape donc l'heure manquée au lieu de l'oublier ;
 *   - une carte SUSPENDUE à la main ne part jamais : le geste humain l'emporte
 *     sur la date.
 *
 * Le départ CONSOMME la date (le démon l'efface en lançant la carte) : une
 * date, une fois, jamais une récurrence.
 */

/** Ce que la règle a besoin de savoir de l'état d'ordonnancement d'une carte. */
export interface DepartAJuger {
  /** Le moment souhaité du départ, en millisecondes. Absent = aucune date. */
  departPrevu?: number;
  /** Suspendue à la main : aucune date ne passe devant ce geste. */
  suspendu?: boolean;
}

/**
 * Où en est la date de cette carte :
 *   - « aucun » : elle n'en porte pas, rien ne change pour elle ;
 *   - « attend » : l'heure n'est pas venue, la carte reste en place ;
 *   - « venu » : l'heure est passée, la carte peut partir.
 */
export type EtatDepart = 'aucun' | 'attend' | 'venu';

export function etatDuDepart(scheduling: DepartAJuger | undefined, maintenant: number): EtatDepart {
  const date = scheduling?.departPrevu;
  if (!date || !Number.isFinite(date)) return 'aucun';
  return date > maintenant ? 'attend' : 'venu';
}

/**
 * Lit une date de départ écrite par un humain ou par un agent : un nombre de
 * millisecondes, ou un texte de date. Rend `null` sur tout ce qui n'est pas une
 * date — on ne devine pas, on refuse.
 *
 * Une date SANS heure (« 2026-08-12 ») est lue à MINUIT LOCAL, et non à minuit
 * UTC comme le ferait `Date.parse` : « mardi », pour qui l'écrit, commence chez
 * lui, pas à Greenwich.
 */
export function lireDateDeDepart(valeur: unknown): number | null {
  if (typeof valeur === 'number') return Number.isFinite(valeur) && valeur > 0 ? Math.round(valeur) : null;
  if (typeof valeur !== 'string') return null;
  const texte = valeur.trim();
  if (!texte) return null;

  const jourSeul = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texte);
  if (jourSeul) {
    const [, annee, mois, jour] = jourSeul;
    return new Date(Number(annee), Number(mois) - 1, Number(jour), 0, 0, 0, 0).getTime();
  }

  const lu = Date.parse(texte);
  return Number.isNaN(lu) ? null : lu;
}

/** Deux instants tombent-ils le même jour du calendrier, heure locale ? */
function memeJour(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

/**
 * Le moment du départ, écrit pour être lu : « aujourd'hui à 06:00 », « demain à
 * 06:00 », « le 12.08 à 06:00 ». L'année n'apparaît que si elle n'est pas
 * l'année en cours — sinon elle encombre sans rien apprendre.
 */
export function momentDeDepart(date: number, maintenant: number): string {
  const quand = new Date(date);
  const ici = new Date(maintenant);
  const deuxChiffres = (n: number) => String(n).padStart(2, '0');
  const heure = `${deuxChiffres(quand.getHours())}:${deuxChiffres(quand.getMinutes())}`;

  const demain = new Date(ici.getFullYear(), ici.getMonth(), ici.getDate() + 1);
  const jour = memeJour(quand, ici)
    ? "aujourd'hui"
    : memeJour(quand, demain)
      ? 'demain'
      : `le ${deuxChiffres(quand.getDate())}.${deuxChiffres(quand.getMonth() + 1)}${
          quand.getFullYear() === ici.getFullYear() ? '' : `.${quand.getFullYear()}`
        }`;

  return `${jour} à ${heure}`;
}

/**
 * La phrase portée par une carte qui attend sa date. Elle dit les deux choses
 * qu'on vient chercher : quand, et que personne n'aura à cliquer.
 */
export function phraseDepartProgramme(date: number, maintenant: number): string {
  return `Départ programmé ${momentDeDepart(date, maintenant)} — la carte part toute seule à l'heure dite.`;
}

/** La phrase d'une carte dont l'heure est passée : elle part au prochain passage. */
export function phraseDepartVenu(date: number, maintenant: number): string {
  return `Heure de départ atteinte (${momentDeDepart(date, maintenant)}) — la carte part au prochain passage.`;
}

/**
 * La mention affichée sur la carte du tableau et dans son détail. Elle se
 * recalcule à chaque affichage plutôt que d'être stockée : une phrase gardée en
 * base dirait encore « demain » trois jours plus tard.
 *
 * Elle se tait partout où la date n'a plus de sens : hors des colonnes qui
 * précèdent le travail, sans date, ou sur une carte suspendue — la suspension
 * dit alors mieux pourquoi rien ne part.
 */
export function mentionDepartProgramme(
  carte: { column: string; scheduling?: DepartAJuger },
  maintenant: number,
): string | null {
  if (carte.column !== 'todo') return null;
  if (carte.scheduling?.suspendu) return null;
  const date = carte.scheduling?.departPrevu;
  if (!date) return null;
  const etat = etatDuDepart(carte.scheduling, maintenant);
  return etat === 'attend' ? phraseDepartProgramme(date, maintenant) : phraseDepartVenu(date, maintenant);
}
