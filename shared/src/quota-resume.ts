import type { ReleveQuota, SerieQuota } from './quota.js';

/* ------------------------------------------------------------------ */
/* Le résumé de l'historique des quotas                                */
/* ------------------------------------------------------------------ */

/**
 * Le profil des heures creuses se mesure sur l'historique des relevés. Plus il
 * remonte loin, plus une soirée exceptionnelle se noie dans l'habitude — mais
 * un relevé par quart d'heure sur deux mois, c'est six mille lignes par compte
 * pour rien : à cette distance, seul le RYTHME de chaque tranche compte encore,
 * pas le détail des points.
 *
 * D'où le résumé : passé quatorze jours, les relevés d'une même journée et
 * d'une même heure sont réduits à deux nombres — le temps observé et ce qui a
 * été consommé pendant ce temps. C'est exactement la matière dont le profil se
 * nourrit ; le détail, lui, ne servait qu'à la courbe, qui ne montre que les
 * derniers jours.
 *
 * Les règles vivent ici, sans base ni disque : elles se testent seules.
 */

/** Le rythme d'une tranche : tel jour, telle heure, tant de temps, tant de %. */
export interface AgregatHoraire {
  /** Le jour local, « 2026-08-04 » : c'est lui qui permet le ménage à deux mois. */
  jour: string;
  /** L'heure locale, de 0 à 23. */
  heure: number;
  /** Le temps réellement observé dans cette tranche, en millisecondes. */
  dureeMs: number;
  /** Ce qui a été consommé pendant ce temps, en points de pourcentage. */
  consommePct: number;
}

/** Deux mois de résumé : au-delà, une habitude d'il y a un trimestre n'apprend plus rien. */
export const RESUME_RETENTION_JOURS = 60;
/** En deçà, on garde le détail : c'est ce que la courbe du volet affiche. */
export const DETAIL_RETENTION_JOURS = 14;

/** Le jour local d'un instant, « 2026-08-04 » — jamais l'heure UTC, qui décalerait les nuits. */
export function jourLocal(at: number): string {
  const date = new Date(at);
  const deuxChiffres = (valeur: number) => String(valeur).padStart(2, '0');
  return `${date.getFullYear()}-${deuxChiffres(date.getMonth() + 1)}-${deuxChiffres(date.getDate())}`;
}

/** L'instant du début d'un jour résumé, pour reconstruire ses tranches. */
export function debutDuJour(jour: string): number {
  const [annee, mois, jourDuMois] = jour.split('-').map((part) => Number(part));
  return new Date(annee, (mois || 1) - 1, jourDuMois || 1, 0, 0, 0, 0).getTime();
}

/** La valeur lue sur la série demandée ; la semaine à défaut. */
function valeur(releve: ReleveQuota, serie: SerieQuota): number {
  return serie === 'session' ? (releve.session ?? 0) : releve.weekly;
}

/**
 * Résume une suite de relevés en tranches d'une heure. Même découpe que le
 * profil : la consommation d'un intervalle est répartie sur les heures qu'il
 * traverse, au prorata du temps passé dans chacune. Un pourcentage qui RECULE
 * est une remise à zéro — l'intervalle entier sort du compte, comme dans le
 * profil, sans quoi le résumé porterait une consommation inventée.
 */
export function resumerReleves(releves: ReleveQuota[], serie: SerieQuota = 'weekly'): AgregatHoraire[] {
  const points = [...releves].sort((a, b) => a.at - b.at);
  const cases = new Map<string, AgregatHoraire>();

  const ajouter = (debut: number, fin: number, part: number) => {
    if (fin <= debut) return;
    const cle = `${jourLocal(debut)} ${new Date(debut).getHours()}`;
    const existant = cases.get(cle);
    if (existant) {
      existant.dureeMs += fin - debut;
      existant.consommePct += part;
      return;
    }
    cases.set(cle, {
      jour: jourLocal(debut),
      heure: new Date(debut).getHours(),
      dureeMs: fin - debut,
      consommePct: part,
    });
  };

  for (let i = 1; i < points.length; i++) {
    const span = points[i].at - points[i - 1].at;
    const delta = valeur(points[i], serie) - valeur(points[i - 1], serie);
    if (span <= 0 || delta < 0) continue;

    let curseur = points[i - 1].at;
    const fin = points[i].at;
    // Garde-fou : un trou de plusieurs semaines entre deux relevés ne doit pas
    // faire tourner cette boucle indéfiniment.
    for (let pas = 0; pas < 24 * 60 && curseur < fin; pas++) {
      const bord = Math.min(new Date(curseur).setMinutes(60, 0, 0), fin);
      ajouter(curseur, bord, (delta * (bord - curseur)) / span);
      curseur = bord;
    }
  }

  return [...cases.values()].sort((a, b) => (a.jour === b.jour ? a.heure - b.heure : a.jour < b.jour ? -1 : 1));
}

/** Additionne deux résumés : c'est ainsi qu'un compactage s'ajoute au précédent. */
export function fusionnerResumes(...resumes: AgregatHoraire[][]): AgregatHoraire[] {
  const cases = new Map<string, AgregatHoraire>();
  for (const resume of resumes) {
    for (const tranche of resume) {
      const cle = `${tranche.jour} ${tranche.heure}`;
      const existant = cases.get(cle);
      if (existant) {
        existant.dureeMs += tranche.dureeMs;
        existant.consommePct += tranche.consommePct;
      } else {
        cases.set(cle, { ...tranche });
      }
    }
  }
  return [...cases.values()].sort((a, b) => (a.jour === b.jour ? a.heure - b.heure : a.jour < b.jour ? -1 : 1));
}

/**
 * Le résumé rendu à la forme que le calcul du profil sait lire : deux relevés
 * par tranche, écartés du temps observé et séparés par la consommation de la
 * tranche. Le profil y retrouve exactement le même rythme par heure ; il ne
 * peut simplement plus voir le détail des points, ce dont il n'a que faire.
 *
 * Les valeurs partent VOLONTAIREMENT très haut (bien au-delà de cent) et ne
 * font que monter : le passage du dernier point reconstruit au premier relevé
 * réel est donc une BAISSE, que la prévision lit comme une remise à zéro — la
 * pente du moment, elle, continue de se mesurer sur les seuls relevés réels.
 */
export const BASE_RECONSTRUITE = 100_000;

export function relevesDepuisResume(resume: AgregatHoraire[]): ReleveQuota[] {
  const tranches = [...resume].sort((a, b) =>
    a.jour === b.jour ? a.heure - b.heure : a.jour < b.jour ? -1 : 1,
  );
  const points: ReleveQuota[] = [];
  let cumul = BASE_RECONSTRUITE;
  let coupures = 0;
  let precedenteFin: number | null = null;

  for (const tranche of tranches) {
    const debut = debutDuJour(tranche.jour) + tranche.heure * 3600 * 1000;
    const duree = Math.max(0, Math.min(3600 * 1000, tranche.dureeMs));
    if (duree <= 0) continue;
    /*
     * Deux tranches qui ne se touchent pas ne se relient pas : le temps NON
     * observé entre elles compterait sinon comme une heure sans consommation et
     * éteindrait le rythme d'une tranche pourtant chargée. La reprise repart
     * donc d'une valeur PLUS BASSE que tout ce qui précède : la baisse se lit
     * comme une remise à zéro, et l'intervalle creux sort du calcul.
     */
    if (precedenteFin === null || debut !== precedenteFin) {
      coupures += 1;
      cumul = BASE_RECONSTRUITE - coupures;
      points.push({ at: debut, weekly: cumul, session: cumul });
    }
    cumul += Math.max(0, tranche.consommePct);
    points.push({ at: debut + duree, weekly: cumul, session: cumul });
    precedenteFin = debut + duree;
  }

  return points;
}

/**
 * L'historique servant au PROFIL : le résumé lointain remis en relevés, suivi
 * des relevés récents gardés en détail. Rien d'autre ne change — la courbe du
 * volet, elle, continue de n'afficher que les relevés récents.
 */
export function historiquePourProfil(
  resume: AgregatHoraire[] | undefined,
  recents: ReleveQuota[] | undefined,
): ReleveQuota[] {
  const anciens = resume?.length ? relevesDepuisResume(resume) : [];
  const suite = [...(recents ?? [])].sort((a, b) => a.at - b.at);
  if (!anciens.length) return suite;
  // Le résumé ne doit jamais chevaucher le détail : sinon la même heure serait
  // comptée deux fois dans le profil.
  const premierReel = suite[0]?.at ?? Infinity;
  return [...anciens.filter((point) => point.at < premierReel), ...suite];
}

/** Ce qui doit sortir du résumé : au-delà de la rétention, un jour ne sert plus. */
export function resumePerime(jour: string, maintenant: number, retentionJours = RESUME_RETENTION_JOURS): boolean {
  return debutDuJour(jour) < maintenant - retentionJours * 24 * 3600 * 1000;
}
