import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { AccountQuota } from '@haikodev/shared';
import {
  MARGE_ECHEANCE_QUOTA_MS,
  RELANCE_QUOTA_MS,
  PlanificateurEcheancesQuotas,
  cibleDeLectureQuota,
  type HorlogeQuotas,
} from '../quota-echeances.js';

class HorlogeFactice implements HorlogeQuotas {
  private sequence = 0;
  private readonly taches = new Map<number, { date: number; action: () => void }>();

  constructor(public date: number) {}

  maintenant = () => this.date;

  programmer = (action: () => void, delai: number): ReturnType<typeof setTimeout> => {
    const id = ++this.sequence;
    this.taches.set(id, { date: this.date + delai, action });
    return id as unknown as ReturnType<typeof setTimeout>;
  };

  annuler = (minuteur: ReturnType<typeof setTimeout>) => {
    this.taches.delete(minuteur as unknown as number);
  };

  prochaineDate(): number | undefined {
    return [...this.taches.values()].sort((a, b) => a.date - b.date)[0]?.date;
  }

  async executerProchaine(): Promise<void> {
    const prochaine = [...this.taches.entries()].sort((a, b) => a[1].date - b[1].date)[0];
    assert.ok(prochaine, 'un minuteur doit être programmé');
    this.taches.delete(prochaine[0]);
    this.date = prochaine[1].date;
    prochaine[1].action();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function quota(
  id: string,
  resetsAt: number,
  fetchedAt: number,
  changements: Partial<AccountQuota> = {},
): AccountQuota {
  return {
    id,
    engine: 'claude',
    label: id,
    priority: 10,
    active: false,
    available: false,
    fetchedAt,
    session: { usedPct: 100, resetsAt },
    ...changements,
  };
}

test('une remise à zéro réussie est lue avec une petite marge puis diffusée', async () => {
  const debut = 1_000_000;
  const horloge = new HorlogeFactice(debut);
  const fin = debut + 20_000;
  const lectures: string[][] = [];
  const diffusions: AccountQuota[][] = [];
  let reveils = 0;
  const planificateur = new PlanificateurEcheancesQuotas({
    horloge,
    prochaineTentative: () => undefined,
    lire: async (comptes) => {
      lectures.push(comptes);
      return [quota('claude', horloge.date + 5 * 60 * 60_000, horloge.date, { available: true, session: { usedPct: 0, resetsAt: horloge.date + 5 * 60 * 60_000 } })];
    },
    diffuser: (quotas) => diffusions.push(quotas),
    apresLectureFraiche: () => {
      reveils += 1;
    },
  });

  planificateur.actualiser([quota('claude', fin, debut)]);
  assert.equal(horloge.prochaineDate(), fin + MARGE_ECHEANCE_QUOTA_MS);
  await horloge.executerProchaine();

  assert.deepEqual(lectures, [['claude']]);
  assert.equal(diffusions[0][0].available, true);
  assert.equal(reveils, 1, 'le relevé frais réveille aussitôt les travaux en attente');
  planificateur.arreter();
});

test('un échec après l’échéance garde le relevé ancien et programme une relance', async () => {
  const debut = 2_000_000;
  const horloge = new HorlogeFactice(debut);
  const fin = debut + 10_000;
  const ancien = quota('claude', fin, debut - 60_000);
  const planificateur = new PlanificateurEcheancesQuotas({
    horloge,
    prochaineTentative: () => undefined,
    lire: async () => [{ ...ancien, error: 'lecture momentanément indisponible' }],
    diffuser: () => undefined,
    apresLectureFraiche: () => assert.fail('un relevé en échec ne doit rien réveiller'),
  });

  planificateur.actualiser([ancien]);
  await horloge.executerProchaine();
  assert.equal(horloge.prochaineDate(), horloge.date + RELANCE_QUOTA_MS);
  planificateur.arreter();
});

test('plusieurs échéances proches partent dans une seule tournée', async () => {
  const debut = 3_000_000;
  const horloge = new HorlogeFactice(debut);
  const lectures: string[][] = [];
  const planificateur = new PlanificateurEcheancesQuotas({
    horloge,
    prochaineTentative: () => undefined,
    lire: async (comptes) => {
      lectures.push(comptes);
      return comptes.map((id) => quota(id, horloge.date + 5 * 60 * 60_000, horloge.date, { available: true }));
    },
    diffuser: () => undefined,
    apresLectureFraiche: () => undefined,
  });

  planificateur.actualiser([
    quota('premier', debut + 10_000, debut),
    quota('second', debut + 18_000, debut),
  ]);
  await horloge.executerProchaine();
  assert.deepEqual(lectures, [['premier', 'second']]);
  planificateur.arreter();
});

test('la temporisation du fournisseur repousse la relance planifiée', () => {
  const maintenant = 4_000_000;
  const autoriseA = maintenant + 7 * 60_000;
  const ancien = quota('claude', maintenant - 60_000, maintenant - 2 * 60_000, {
    error: 'lecture momentanément indisponible',
  });
  assert.equal(cibleDeLectureQuota(ancien, maintenant, autoriseA), autoriseA);
});

test('un compte redevenu disponible provoque la reprise automatique de la carte bloquée', async () => {
  const debut = 5_000_000;
  const horloge = new HorlogeFactice(debut);
  let carteEnAttente = true;
  const planificateur = new PlanificateurEcheancesQuotas({
    horloge,
    prochaineTentative: () => undefined,
    lire: async () => [quota('claude', horloge.date + 5 * 60 * 60_000, horloge.date, { available: true })],
    diffuser: () => undefined,
    apresLectureFraiche: (quotas) => {
      if (quotas.some((releve) => releve.available)) carteEnAttente = false;
    },
  });

  planificateur.actualiser([quota('claude', debut + 1_000, debut - 60_000)]);
  await horloge.executerProchaine();
  assert.equal(carteEnAttente, false);
  planificateur.arreter();

  const sources = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
  const demarrage = fs.readFileSync(path.join(sources, 'main.ts'), 'utf8');
  assert.match(
    demarrage,
    /apresLectureFraiche:\s*async \(\) => \{[\s\S]*?await tick\(\)/,
    "le vrai serveur doit réveiller l'ordonnanceur, pas seulement le test",
  );
});
