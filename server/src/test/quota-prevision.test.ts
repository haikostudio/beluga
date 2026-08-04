import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compteDeSecours,
  doitAlerterEpuisementProche,
  previsionEpuisement,
  profilHoraire,
  profilSemaine,
  type CandidatSecours,
  type ReleveQuota,
} from '@haikodev/shared';

const MAINTENANT = new Date('2026-08-03T09:00:00+02:00').getTime();
const h = (n: number) => n * 3600_000;
const j = (n: number) => n * 24 * 3600_000;

/** Une suite de relevés réguliers : `pas` points de % par heure, sur `heures`. */
function releves(depart: number, pas: number, heures: number, fin = MAINTENANT): ReleveQuota[] {
  const out: ReleveQuota[] = [];
  for (let i = heures; i >= 0; i--) {
    out.push({ at: fin - h(i), weekly: depart + pas * (heures - i) });
  }
  return out;
}

test('rythme régulier : la prévision tombe avant la remise à zéro', () => {
  // 40 % consommés, 1 % par heure : les 60 % restants partent en 60 h,
  // pour une fenêtre qui ne se remet à zéro que dans 5 jours.
  const prevision = previsionEpuisement(
    releves(20, 1, 20),
    { usedPct: 40, resetsAt: MAINTENANT + j(5) },
    MAINTENANT,
  );
  assert.ok(prevision, 'une prévision est attendue');
  assert.equal(prevision.niveau, 'manque');
  assert.equal(Math.round(prevision.at), MAINTENANT + h(60));
  assert.match(prevision.texte, /^épuisé \S+ vers \d+ h( 30)?$/);
  assert.ok(Math.abs(prevision.parJour - 24) < 0.01, 'environ 24 % par jour');
});

test('la formulation nomme le jour de la semaine', () => {
  const prevision = previsionEpuisement(
    releves(20, 1, 20),
    { usedPct: 40, resetsAt: MAINTENANT + j(5) },
    MAINTENANT,
  );
  // 60 h après un lundi 9 h → le mercredi suivant, vers 21 h.
  assert.equal(prevision?.texte, 'épuisé mercredi vers 21 h');
});

test('rythme nul : rien à annoncer', () => {
  const plat = releves(30, 0, 20);
  assert.equal(previsionEpuisement(plat, { usedPct: 30, resetsAt: MAINTENANT + j(5) }, MAINTENANT), null);
});

test('historique trop court : rien à annoncer', () => {
  const court = [
    { at: MAINTENANT - h(0.5), weekly: 40 },
    { at: MAINTENANT, weekly: 45 },
  ];
  assert.equal(previsionEpuisement(court, { usedPct: 45, resetsAt: MAINTENANT + j(5) }, MAINTENANT), null);
  // Un seul relevé non plus.
  assert.equal(
    previsionEpuisement([{ at: MAINTENANT, weekly: 45 }], { usedPct: 45, resetsAt: MAINTENANT + j(5) }, MAINTENANT),
    null,
  );
});

test('fenêtre déjà épuisée : rien à annoncer', () => {
  const pleine = releves(80, 1, 20);
  assert.equal(previsionEpuisement(pleine, { usedPct: 100, resetsAt: MAINTENANT + j(5) }, MAINTENANT), null);
});

test('épuisement au-delà de la remise à zéro : silence', () => {
  // 0,1 % par heure sur 90 % restants : 900 h, bien après la fin de fenêtre.
  const lent = releves(9, 0.1, 20);
  assert.equal(previsionEpuisement(lent, { usedPct: 10, resetsAt: MAINTENANT + j(5) }, MAINTENANT), null);
});

test('sans heure de remise à zéro connue, on n’invente rien', () => {
  const points = releves(20, 1, 20);
  assert.equal(previsionEpuisement(points, { usedPct: 40 }, MAINTENANT), null);
  assert.equal(previsionEpuisement(points, undefined, MAINTENANT), null);
  // Fenêtre déjà terminée : plus rien à prévoir dessus.
  assert.equal(previsionEpuisement(points, { usedPct: 40, resetsAt: MAINTENANT - h(1) }, MAINTENANT), null);
});

test('épuisement de peu avant la fin : « juste », pas « manque »', () => {
  // 50 % restants à 1 % par heure → 50 h, pour une fenêtre qui finit dans 52 h.
  const prevision = previsionEpuisement(
    releves(30, 1, 20),
    { usedPct: 50, resetsAt: MAINTENANT + h(52) },
    MAINTENANT,
  );
  assert.equal(prevision?.niveau, 'juste');
});

/* ---------------- Les heures creuses ---------------- */

/**
 * Trois jours de relevés d'heure en heure, avec une vraie nuit creuse : entre
 * 1 h et 7 h du matin il ne se consomme presque rien, le reste de la journée
 * brûle `plein` point de % par heure. La fenêtre repart de zéro à `resetIl`
 * heures d'ici, pour que la pente « récente » soit une pente de plein jour.
 */
function relevesAvecNuit({
  jours = 3,
  plein = 1,
  creux = 0.05,
  resetIl = 2,
}: { jours?: number; plein?: number; creux?: number; resetIl?: number } = {}): ReleveQuota[] {
  const total = jours * 24;
  const out: ReleveQuota[] = [];
  let cumul = 0;
  for (let i = total; i >= 0; i--) {
    const at = MAINTENANT - h(i);
    if (i === resetIl) cumul = 0; // la fenêtre hebdomadaire repart de zéro
    out.push({ at, weekly: cumul });
    const heure = new Date(at).getHours();
    cumul += heure >= 1 && heure < 7 ? creux : plein;
  }
  return out;
}

test('la nuit creuse repousse l’heure d’épuisement annoncée', () => {
  const points = relevesAvecNuit();
  const fenetre = { usedPct: 70, resetsAt: MAINTENANT + j(5) };
  const prevision = previsionEpuisement(points, fenetre, MAINTENANT);
  assert.ok(prevision, 'une prévision est attendue');
  assert.equal(prevision.heuresCreuses, true, 'le profil mesuré doit avoir servi');

  // La pente des deux dernières heures est une pente de plein jour : 1 % par
  // heure. Prolongée telle quelle, elle viderait les 30 % restants en 30 h.
  const plat = MAINTENANT + h(30);
  assert.ok(
    prevision.at > plat + h(2),
    `l’épuisement doit être repoussé (${new Date(prevision.at).toISOString()} vs ${new Date(plat).toISOString()})`,
  );
  // Et il reste avant la remise à zéro, sinon la fonction se serait tue.
  assert.ok(prevision.at < fenetre.resetsAt);
});

test('le profil mesuré creuse bien la nuit, sans heure écrite dans le code', () => {
  const profil = profilHoraire(relevesAvecNuit());
  assert.ok(profil, 'un profil est attendu');
  assert.equal(profil.length, 24);
  const moyenne = profil.reduce((somme, p) => somme + p, 0) / 24;
  assert.ok(Math.abs(moyenne - 1) < 0.01, 'le profil est ramené à une moyenne de 1');
  // Le cœur de la nuit est très bas, le milieu d'après-midi bien au-dessus.
  assert.ok(profil[3] < 0.2, `3 h du matin doit être creux (${profil[3]})`);
  assert.ok(profil[15] > 1.2, `15 h doit être plein (${profil[15]})`);
});

test('le pointillé suit la même projection que le texte', () => {
  const prevision = previsionEpuisement(relevesAvecNuit(), { usedPct: 70, resetsAt: MAINTENANT + j(5) }, MAINTENANT);
  assert.ok(prevision);
  const chemin = prevision.trajectoire;
  assert.ok(chemin.length > 2, 'la trajectoire suit les tranches horaires');
  assert.equal(chemin[chemin.length - 1].pct, 100);
  assert.ok(Math.abs(chemin[chemin.length - 1].at - prevision.at) < 30 * 60_000);
  // Les pourcentages ne reculent jamais : un quota ne se remplit pas tout seul.
  for (let i = 1; i < chemin.length; i++) assert.ok(chemin[i].pct >= chemin[i - 1].pct - 0.001);
});

test('historique trop court ou trop maigre : on garde le calcul d’avant', () => {
  // Vingt heures d'observation : pas même une journée entière.
  assert.equal(profilHoraire(releves(20, 1, 20)), null);
  // Trois jours, mais presque rien de consommé : ce ne serait que du bruit.
  assert.equal(profilHoraire(relevesAvecNuit({ plein: 0.01, creux: 0 })), null);
  // Et la prévision, elle, continue de sortir sans profil.
  const prevision = previsionEpuisement(
    releves(20, 1, 20),
    { usedPct: 40, resetsAt: MAINTENANT + j(5) },
    MAINTENANT,
  );
  assert.equal(prevision?.heuresCreuses, false);
  assert.equal(Math.round(prevision!.at), MAINTENANT + h(60));
});

test('l’infobulle dit sur quelle base le chiffre est calculé', () => {
  const avec = previsionEpuisement(relevesAvecNuit(), { usedPct: 70, resetsAt: MAINTENANT + j(5) }, MAINTENANT);
  assert.match(avec!.detail, /heures creuses/);
  const sans = previsionEpuisement(releves(20, 1, 20), { usedPct: 40, resetsAt: MAINTENANT + j(5) }, MAINTENANT);
  assert.match(sans!.detail, /rythme des dernières heures/);
});

/* ---------------- Les week-ends ---------------- */

/** Un vendredi soir : la prévision qui part de là traverse un week-end entier. */
const VENDREDI = new Date('2026-07-31T20:00:00+02:00').getTime();

/**
 * Deux semaines de relevés d'heure en heure. Les jours ouvrés brûlent `plein`
 * point de % par heure, sauf la nuit (1 h → 7 h) ; le week-end reste très calme
 * du matin au soir. La fenêtre hebdomadaire repart de zéro deux heures avant la
 * fin, donc en plein vendredi soir : la pente « récente » est une pente de
 * pleine activité.
 */
function relevesDeuxSemaines({
  plein = 1,
  nuit = 0.05,
  weekend = 0.05,
  fin = VENDREDI,
}: { plein?: number; nuit?: number; weekend?: number; fin?: number } = {}): ReleveQuota[] {
  const out: ReleveQuota[] = [];
  let cumul = 0;
  for (let i = 14 * 24; i >= 0; i--) {
    const at = fin - h(i);
    if (i === 2) cumul = 0; // la fenêtre hebdomadaire repart de zéro
    out.push({ at, weekly: cumul });
    const date = new Date(at);
    const jour = date.getDay();
    const heure = date.getHours();
    const estWeekEnd = jour === 0 || jour === 6;
    cumul += estWeekEnd ? weekend : heure >= 1 && heure < 7 ? nuit : plein;
  }
  return out;
}

/** Trois jours ouvrés d'affilée : aucun week-end n'a été observé. */
function relevesSemaineSeule(): ReleveQuota[] {
  const fin = new Date('2026-08-06T00:00:00+02:00').getTime(); // jeudi 0 h
  const out: ReleveQuota[] = [];
  let cumul = 0;
  for (let i = 3 * 24; i >= 0; i--) {
    const at = fin - h(i);
    out.push({ at, weekly: cumul });
    const heure = new Date(at).getHours();
    cumul += heure >= 1 && heure < 7 ? 0.05 : 1;
  }
  return out;
}

/**
 * L'ANCIEN calcul, gardé ici comme point de comparaison : le même déroulé, mais
 * sur un profil de journée type à vingt-quatre tranches, qui verse un samedi
 * 15 h et un mardi 15 h dans la même case. Rend l'instant d'épuisement.
 */
function previsionSurProfilJournee(releves: ReleveQuota[], reste: number, maintenant: number): number {
  const points = releves.filter((p) => p.at <= maintenant).sort((a, b) => a.at - b.at);
  const profil = profilHoraire(points);
  assert.ok(profil, 'un profil de journée est attendu pour la comparaison');
  let debut = 0;
  for (let i = points.length - 1; i > 0; i--) {
    if (points[i].weekly < points[i - 1].weekly) {
      debut = i;
      break;
    }
  }
  const premier = points[debut];
  const dernier = points[points.length - 1];
  let pondere = 0;
  let curseur = premier.at;
  while (curseur < dernier.at) {
    const bord = Math.min(new Date(curseur).setMinutes(60, 0, 0), dernier.at);
    pondere += (bord - curseur) * profil[new Date(curseur).getHours()];
    curseur = bord;
  }
  const rythme = (dernier.weekly - premier.weekly) / pondere;
  let manquant = reste;
  curseur = maintenant;
  for (let pas = 0; pas < 24 * 60; pas++) {
    const vitesse = rythme * profil[new Date(curseur).getHours()];
    const bord = new Date(curseur).setMinutes(60, 0, 0);
    const mangeable = vitesse * (bord - curseur);
    if (mangeable >= manquant) return curseur + manquant / vitesse;
    manquant -= mangeable;
    curseur = bord;
  }
  throw new Error('épuisement introuvable');
}

test('le profil de semaine sépare les week-ends des jours ouvrés', () => {
  const profil = profilSemaine(relevesDeuxSemaines());
  assert.ok(profil, 'un profil de semaine est attendu');
  assert.equal(profil.length, 48);
  // Une semaine type : cinq jours ouvrés et deux de week-end. La moyenne ainsi
  // pesée vaut 1, donc le profil ne change rien au total consommé en une semaine.
  const moyenne = profil.reduce(
    (somme, p, i) => somme + p * (i < 24 ? 5 / 7 / 24 : 2 / 7 / 24),
    0,
  );
  assert.ok(Math.abs(moyenne - 1) < 0.01, `moyenne pondérée de 1 attendue (${moyenne})`);
  // Mardi 15 h est plein, samedi 15 h est calme : les deux ne sont plus mêlés.
  assert.ok(profil[15] > 1.2, `15 h en jour ouvré doit être plein (${profil[15]})`);
  assert.ok(profil[24 + 15] < 0.2, `15 h le week-end doit être calme (${profil[24 + 15]})`);
  // Et la nuit reste creuse des deux côtés.
  assert.ok(profil[3] < 0.2, `3 h en jour ouvré doit être creux (${profil[3]})`);
});

test('un vendredi soir, le week-end calme repousse l’épuisement annoncé', () => {
  const points = relevesDeuxSemaines();
  const fenetre = { usedPct: 70, resetsAt: VENDREDI + j(7) };
  const prevision = previsionEpuisement(points, fenetre, VENDREDI);
  assert.ok(prevision, 'une prévision est attendue');
  assert.equal(prevision.heuresCreuses, true);

  const ancienne = previsionSurProfilJournee(points, 30, VENDREDI);
  assert.ok(
    prevision.at > ancienne + 30 * 60_000,
    `l’épuisement doit être repoussé : ${new Date(prevision.at).toISOString()} vs ${new Date(ancienne).toISOString()}`,
  );
  assert.ok(prevision.at < fenetre.resetsAt);
  // Le samedi et le dimanche ne mangent presque rien : la trajectoire s'aplatit.
  const samedi = prevision.trajectoire.filter((p) => new Date(p.at).getDay() === 6);
  // La trajectoire est allégée avant d'être rendue : une poignée de points
  // suffit à couvrir la journée du samedi.
  assert.ok(samedi.length >= 8, `la trajectoire traverse bien le samedi (${samedi.length} points)`);
  assert.ok(
    samedi[samedi.length - 1].pct - samedi[0].pct < 3,
    `le samedi doit rester presque plat (${samedi[samedi.length - 1].pct - samedi[0].pct})`,
  );
});

test('l’infobulle nomme le week-end quand le profil de semaine a servi', () => {
  const avec = previsionEpuisement(
    relevesDeuxSemaines(),
    { usedPct: 70, resetsAt: VENDREDI + j(7) },
    VENDREDI,
  );
  assert.match(avec!.detail, /heures creuses/);
  assert.match(avec!.detail, /week-end/);
});

test('sans week-end observé, on retombe sur les vingt-quatre tranches', () => {
  const points = relevesSemaineSeule();
  const maintenant = points[points.length - 1].at;
  assert.equal(profilSemaine(points), null, 'aucun week-end vu : pas de profil de semaine');
  const journee = profilHoraire(points);
  assert.ok(journee, 'le profil de journée, lui, tient debout');
  assert.equal(journee.length, 24);
  // Et la prévision continue de sortir, sur ce profil-là.
  const prevision = previsionEpuisement(points, { usedPct: 70, resetsAt: maintenant + j(5) }, maintenant);
  assert.ok(prevision);
  assert.equal(prevision.heuresCreuses, true);
  assert.doesNotMatch(prevision.detail, /week-end/);
});

/* ---------------- La fenêtre de cinq heures ---------------- */

/** Des relevés qui portent AUSSI la fenêtre courte, `pas` % par heure. */
function relevesCourts(depart: number, pas: number, minutes: number): ReleveQuota[] {
  const out: ReleveQuota[] = [];
  for (let i = minutes; i >= 0; i -= 10) {
    out.push({ at: MAINTENANT - i * 60_000, weekly: 30, session: depart + (pas * (minutes - i)) / 60 });
  }
  return out;
}

test('la fenêtre de cinq heures a sa prévision quand la journée le permet', () => {
  // 40 % consommés, 20 % par heure : les 60 % restants partent en 3 h,
  // pour une fenêtre de cinq heures qui finit dans 4 h.
  const prevision = previsionEpuisement(
    relevesCourts(0, 20, 120),
    { usedPct: 40, resetsAt: MAINTENANT + h(4) },
    MAINTENANT,
    'session',
  );
  assert.ok(prevision, 'une prévision est attendue');
  assert.equal(prevision.texte, 'épuisé aujourd’hui vers 12 h');
  assert.match(prevision.detail, /% par heure/);
});

test('la fenêtre de cinq heures se tait sous vingt minutes d’observation', () => {
  const court = [
    { at: MAINTENANT - 10 * 60_000, weekly: 30, session: 20 },
    { at: MAINTENANT, weekly: 30, session: 40 },
  ];
  assert.equal(
    previsionEpuisement(court, { usedPct: 40, resetsAt: MAINTENANT + h(4) }, MAINTENANT, 'session'),
    null,
  );
});

test('chaque série regarde SA remise à zéro', () => {
  // La fenêtre courte est repartie de zéro il y a une heure, la semaine non.
  const points: ReleveQuota[] = [
    { at: MAINTENANT - h(3), weekly: 20, session: 80 },
    { at: MAINTENANT - h(2), weekly: 25, session: 95 },
    { at: MAINTENANT - h(1), weekly: 30, session: 10 },
    { at: MAINTENANT, weekly: 35, session: 40 },
  ];
  const courte = previsionEpuisement(points, { usedPct: 40, resetsAt: MAINTENANT + h(4) }, MAINTENANT, 'session');
  // 30 % par heure sur la dernière heure : 60 % restants en 2 h.
  assert.ok(courte && Math.abs(courte.at - (MAINTENANT + h(2))) <= 30 * 60_000);
  // La semaine, elle, n'a pas été remise à zéro : 5 % par heure depuis 3 h.
  const semaine = previsionEpuisement(points, { usedPct: 35, resetsAt: MAINTENANT + j(2) }, MAINTENANT);
  assert.ok(semaine && Math.abs(semaine.parJour - 120) < 0.01);
});

/* ---------------- Le compte de secours ---------------- */

const candidat = (over: Partial<CandidatSecours> & { id: string }): CandidatSecours => ({
  label: over.id,
  engine: 'claude',
  disponible: true,
  tientJusquAuBout: true,
  consommePct: 10,
  ...over,
});

test('le secours est le compte le MOINS entamé du même moteur', () => {
  const choisi = compteDeSecours({ id: 'a', engine: 'claude' }, [
    candidat({ id: 'a', consommePct: 90 }),
    candidat({ id: 'b', consommePct: 60 }),
    candidat({ id: 'c', consommePct: 20 }),
  ]);
  assert.equal(choisi?.id, 'c');
});

test('un compte d’un autre moteur ne remplace pas', () => {
  const choisi = compteDeSecours({ id: 'a', engine: 'claude' }, [
    candidat({ id: 'a' }),
    candidat({ id: 'z', engine: 'codex', consommePct: 0 }),
  ]);
  assert.equal(choisi, null);
});

test('un compte épuisé ou lui-même en manque n’est pas un refuge', () => {
  assert.equal(
    compteDeSecours({ id: 'a', engine: 'claude' }, [
      candidat({ id: 'a' }),
      candidat({ id: 'b', disponible: false }),
      candidat({ id: 'c', tientJusquAuBout: false }),
    ]),
    null,
  );
});

/* ---------------- L'alerte sur le téléphone ---------------- */

test('on prévient une seule fois par semaine, et seulement sur un manque', () => {
  const semaine = MAINTENANT + j(3);
  assert.equal(doitAlerterEpuisementProche({ resetsAt: semaine, niveau: 'manque' }, MAINTENANT), true);
  // Déjà annoncée pour cette semaine-là.
  assert.equal(
    doitAlerterEpuisementProche({ resetsAt: semaine, niveau: 'manque', dejaAnnoncee: semaine }, MAINTENANT),
    false,
  );
  // La semaine suivante redonne droit à une alerte.
  assert.equal(
    doitAlerterEpuisementProche({ resetsAt: semaine + j(7), niveau: 'manque', dejaAnnoncee: semaine }, MAINTENANT),
    true,
  );
  // « juste » ou pas de prévision du tout : rien à dire.
  assert.equal(doitAlerterEpuisementProche({ resetsAt: semaine, niveau: 'juste' }, MAINTENANT), false);
  assert.equal(doitAlerterEpuisementProche({ resetsAt: semaine }, MAINTENANT), false);
  // Chiffres périmés : prévenir sur une preuve qu'on n'a plus n'aide personne.
  assert.equal(
    doitAlerterEpuisementProche({ resetsAt: semaine, niveau: 'manque', lectureEnEchec: true }, MAINTENANT),
    false,
  );
});

test('une remise à zéro dans l’historique ne fausse pas la pente', () => {
  // Vieille fenêtre montée à 90 %, puis remise à zéro il y a 20 h.
  const vieux: ReleveQuota[] = [
    { at: MAINTENANT - h(40), weekly: 70 },
    { at: MAINTENANT - h(30), weekly: 90 },
  ];
  const prevision = previsionEpuisement(
    [...vieux, ...releves(20, 1, 20)],
    { usedPct: 40, resetsAt: MAINTENANT + j(5) },
    MAINTENANT,
  );
  // Seuls les relevés d'après la remise à zéro comptent : 1 % par heure.
  assert.ok(prevision && Math.abs(prevision.parJour - 24) < 0.01);
});
