import type { AccountQuota } from '@beluga/shared';

/** Petite marge : on lit après la bascule annoncée, jamais juste avant. */
export const MARGE_ECHEANCE_QUOTA_MS = 15_000;
/** Deux échéances aussi proches partagent la même tournée de lecture. */
export const GROUPE_ECHEANCES_QUOTA_MS = 10_000;
/** Une panne ordinaire est retentée sans marteler le fournisseur. */
export const RELANCE_QUOTA_MS = 60_000;

type Minuteur = ReturnType<typeof setTimeout>;

export interface HorlogeQuotas {
  maintenant: () => number;
  programmer: (action: () => void, delai: number) => Minuteur;
  annuler: (minuteur: Minuteur) => void;
}

export interface OptionsPlanificateurQuotas {
  lire: (comptes: string[]) => Promise<AccountQuota[]>;
  diffuser: (quotas: AccountQuota[]) => void;
  /** Réveille notamment les cartes qui attendaient ce compte. */
  apresLectureFraiche: (quotas: AccountQuota[]) => void | Promise<void>;
  prochaineTentative: (compte: string) => number | undefined;
  signalerErreur?: (erreur: unknown) => void;
  horloge?: HorlogeQuotas;
}

const horlogeReelle: HorlogeQuotas = {
  maintenant: () => Date.now(),
  programmer: (action, delai) => setTimeout(action, delai),
  annuler: (minuteur) => clearTimeout(minuteur),
};

function echeances(quota: AccountQuota): number[] {
  return [quota.session?.resetsAt, quota.weekly?.resetsAt].filter(
    (valeur): valeur is number => typeof valeur === 'number' && Number.isFinite(valeur),
  );
}

/**
 * Prochain instant utile pour un compte. Après une échéance ratée, l'ancien
 * `fetchedAt` prouve qu'aucune lecture fraîche n'a encore confirmé la bascule.
 */
export function cibleDeLectureQuota(
  quota: AccountQuota,
  maintenant: number,
  prochaineTentative?: number,
): number | null {
  if (quota.disabled) return null;
  const dates = echeances(quota);
  if (!dates.length) return null;

  const futures = dates.map((date) => date + MARGE_ECHEANCE_QUOTA_MS).filter((date) => date > maintenant);
  const depasseesSansLecture = dates.filter(
    (date) => date + MARGE_ECHEANCE_QUOTA_MS <= maintenant && (quota.fetchedAt ?? 0) <= date,
  );

  if (depasseesSansLecture.length) {
    const sansMarteler = quota.error ? maintenant + RELANCE_QUOTA_MS : maintenant;
    return Math.max(sansMarteler, prochaineTentative ?? 0);
  }

  return futures.length ? Math.min(...futures) : null;
}

/**
 * Un seul minuteur central suffit : il garde une cible par compte, regroupe les
 * échéances proches, puis recalcule tout à partir du relevé obtenu.
 */
export class PlanificateurEcheancesQuotas {
  private readonly horloge: HorlogeQuotas;
  private readonly quotas = new Map<string, AccountQuota>();
  private minuteur?: Minuteur;
  private arrete = false;

  constructor(private readonly options: OptionsPlanificateurQuotas) {
    this.horloge = options.horloge ?? horlogeReelle;
  }

  actualiser(quotas: AccountQuota[]): void {
    for (const quota of quotas) this.quotas.set(quota.id, quota);
    this.reprogrammer();
  }

  arreter(): void {
    this.arrete = true;
    if (this.minuteur) this.horloge.annuler(this.minuteur);
    this.minuteur = undefined;
  }

  private reprogrammer(): void {
    if (this.arrete) return;
    if (this.minuteur) this.horloge.annuler(this.minuteur);
    this.minuteur = undefined;
    const maintenant = this.horloge.maintenant();
    const cibles = [...this.quotas.values()]
      .map((quota) => cibleDeLectureQuota(quota, maintenant, this.options.prochaineTentative(quota.id)))
      .filter((date): date is number => date !== null);
    if (!cibles.length) return;
    const prochaine = Math.min(...cibles);
    this.minuteur = this.horloge.programmer(() => void this.relire(), Math.max(0, prochaine - maintenant));
  }

  private async relire(): Promise<void> {
    this.minuteur = undefined;
    if (this.arrete) return;
    const maintenant = this.horloge.maintenant();
    const comptes = [...this.quotas.values()]
      .filter((quota) => {
        const cible = cibleDeLectureQuota(quota, maintenant, this.options.prochaineTentative(quota.id));
        return cible !== null && cible <= maintenant + GROUPE_ECHEANCES_QUOTA_MS;
      })
      .map((quota) => quota.id);
    if (!comptes.length) return this.reprogrammer();

    const avant = new Map(comptes.map((id) => [id, this.quotas.get(id)]));
    try {
      const quotas = await this.options.lire(comptes);
      this.options.diffuser(quotas);
      for (const quota of quotas) this.quotas.set(quota.id, quota);
      const lectureFraiche = comptes.some((id) => {
        const precedent = avant.get(id);
        const courant = this.quotas.get(id);
        return !!courant && !courant.error && (courant.fetchedAt ?? 0) > (precedent?.fetchedAt ?? 0);
      });
      if (lectureFraiche) await this.options.apresLectureFraiche(quotas);
    } catch (erreur) {
      // Une panne plus large que la réponse du fournisseur ne doit ni créer une
      // boucle immédiate, ni tuer le planificateur. Les anciens chiffres restent.
      for (const id of comptes) {
        const quota = this.quotas.get(id);
        if (quota) this.quotas.set(id, { ...quota, error: quota.error ?? 'lecture momentanément indisponible' });
      }
      this.options.signalerErreur?.(erreur);
    } finally {
      this.reprogrammer();
    }
  }
}
