import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DUREE_FENETRE_MS,
  ECHECS_AVANT_ALERTE,
  alerterApresEchec,
  comptesAAmorcer,
  compteQuiRecoitLeTravail,
  creneauxDesComptes,
  fenetreOuverte,
  dansLesHeuresDeSilence,
  decisionAmorce,
  estRefusDeSaturation,
  fenetreHorsCreneau,
  finDeFenetre,
  modeleLePlusLeger,
  natureDuJumelage,
  texteEchecAmorce,
} from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* Amorcer la fenêtre de 5 h dès qu'elle repart à zéro                  */
/* ------------------------------------------------------------------ */

const T = 1_000_000_000_000;
const compte = (patch: Record<string, unknown> = {}) => ({
  id: 'claude-1',
  engine: 'claude',
  sessionPct: 0,
  ...patch,
});

test('une fenêtre retombée à zéro est amorcée', () => {
  assert.equal(decisionAmorce(compte(), T), 'a-amorcer');
});

test('une fenêtre déjà lancée est laissée tranquille', () => {
  assert.equal(decisionAmorce(compte({ sessionPct: 0.4 }), T), 'fenetre-en-cours');
  assert.equal(decisionAmorce(compte({ sessionPct: 53 }), T), 'fenetre-en-cours');
});

test('un compte sans relevé fiable ne déclenche rien', () => {
  assert.equal(decisionAmorce(compte({ lectureEnEchec: true }), T), 'lecture-en-echec');
});

test("un agent au travail a déjà lancé la fenêtre : pas d'amorce", () => {
  assert.equal(decisionAmorce(compte({ agentEnCours: true }), T), 'agent-en-cours');
});

test('les autres moteurs ne sont pas concernés : Codex n\'a pas de fenêtre courte', () => {
  assert.equal(decisionAmorce(compte({ engine: 'codex' }), T), 'autre-moteur');
});

/* -------- La pause de la nuit -------- */

test('pendant les heures de silence, aucun compte n\'est amorcé', () => {
  assert.equal(decisionAmorce(compte(), T, true), 'heures-de-silence');
  assert.deepEqual(comptesAAmorcer([compte(), compte({ id: 'b' })], T, true), []);
});

test('une plage de silence qui passe minuit tient sur les deux nuits', () => {
  assert.equal(dansLesHeuresDeSilence(23, 22, 7), true);
  assert.equal(dansLesHeuresDeSilence(3, 22, 7), true);
  assert.equal(dansLesHeuresDeSilence(7, 22, 7), false);
  assert.equal(dansLesHeuresDeSilence(14, 22, 7), false);
});

test('une plage de silence en pleine journée reste dans la journée', () => {
  assert.equal(dansLesHeuresDeSilence(13, 12, 14), true);
  assert.equal(dansLesHeuresDeSilence(15, 12, 14), false);
});

test('sans heures de silence réglées, il n\'y a pas de silence', () => {
  assert.equal(dansLesHeuresDeSilence(3, undefined, undefined), false);
  assert.equal(dansLesHeuresDeSilence(3, 22, undefined), false);
});

/* -------- Les échecs répétés -------- */

test('on ne prévient qu\'au troisième échec d\'affilée, et une seule fois', () => {
  assert.equal(ECHECS_AVANT_ALERTE, 3);
  assert.equal(alerterApresEchec(1), false);
  assert.equal(alerterApresEchec(2), false);
  assert.equal(alerterApresEchec(3), true);
  // Les échecs suivants ne renvoient pas de notification : elle a déjà été dite.
  assert.equal(alerterApresEchec(4), false);
  assert.equal(alerterApresEchec(12), false);
});

test('jamais deux amorces sur la même fenêtre, même si le compteur affiche encore zéro', () => {
  const deja = compte({ derniereAmorce: { at: T - 60_000, jusqua: T + 3 * 3600_000 } });
  assert.equal(decisionAmorce(deja, T), 'fenetre-deja-amorcee');
});

test('la fenêtre suivante, elle, est bien amorcée', () => {
  const passee = compte({ derniereAmorce: { at: T - DUREE_FENETRE_MS, jusqua: T - 1 } });
  assert.equal(decisionAmorce(passee, T), 'a-amorcer');
});

test('la liste ne retient que les comptes à amorcer, dans l\'ordre reçu', () => {
  const etats = [
    compte({ id: 'a', sessionPct: 12 }),
    compte({ id: 'b' }),
    compte({ id: 'c', engine: 'codex' }),
    compte({ id: 'd' }),
  ];
  assert.deepEqual(
    comptesAAmorcer(etats, T).map((e) => e.id),
    ['b', 'd'],
  );
});

test("l'heure de remise à zéro annoncée fait foi ; sans elle, cinq heures", () => {
  assert.equal(finDeFenetre(T, T + 3600_000), T + 3600_000);
  assert.equal(finDeFenetre(T, undefined), T + DUREE_FENETRE_MS);
  // Une heure déjà passée ne protège de rien : on repart sur cinq heures.
  assert.equal(finDeFenetre(T, T - 10), T + DUREE_FENETRE_MS);
});

/* -------- Un compte saturé n'est pas une panne -------- */

test('un refus 429 se reconnaît sur le code, jamais sur un mot du message', () => {
  assert.equal(estRefusDeSaturation('refus (429)'), true);
  assert.equal(estRefusDeSaturation('refus (500)'), false);
  assert.equal(estRefusDeSaturation('envoi impossible'), false);
  assert.equal(estRefusDeSaturation('compte non connecté'), false);
  assert.equal(estRefusDeSaturation(undefined), false);
});

test('une saturation se dit en clair, une vraie panne garde sa raison', () => {
  assert.equal(texteEchecAmorce('refus (429)'), 'limite atteinte');
  assert.equal(texteEchecAmorce('refus (500)'), 'refus (500)');
  assert.equal(texteEchecAmorce('envoi impossible'), 'envoi impossible');
});

test('le modèle retenu est le moins gourmand du catalogue', () => {
  const catalogue = [
    { id: 'opus-5', appetite: 'heavy' },
    { id: 'sonnet-5', appetite: 'medium' },
    { id: 'haiku-4-5', appetite: 'light' },
  ];
  assert.equal(modeleLePlusLeger(catalogue)?.id, 'haiku-4-5');
  // Catalogue vide : on ne devine pas, l'appelant garde son repli.
  assert.equal(modeleLePlusLeger([]), undefined);
});

/* ------------------------------------------------------------------ */
/* Des fenêtres décalées à parts égales entre les comptes              */
/* ------------------------------------------------------------------ */

const H = 60 * 60 * 1000;
const cal = (id: string, priority: number, patch: Record<string, unknown> = {}) => ({
  id,
  engine: 'claude',
  priority,
  ...patch,
});
// Le repère a ouvert sa fenêtre à T : elle remet à zéro à T + 5 h.
const repereOuvert = cal('perso', 10, { sessionPct: 30, resetsAt: T + DUREE_FENETRE_MS });

test('deux comptes : le second se cale 2 h 30 après le repère', () => {
  const c = creneauxDesComptes([repereOuvert, cal('pro', 20)], T + H);
  assert.equal(c.get('pro')?.decalageMs, 2.5 * H);
  assert.equal(c.get('pro')?.prochainCreneau, T + 2.5 * H);
  assert.equal(c.get('perso')?.prochainCreneau, undefined);
  assert.equal(c.get('perso')?.prochainReveil, T + DUREE_FENETRE_MS);
});

test('trois comptes : un tiers de fenêtre, soit 1 h 40', () => {
  const c = creneauxDesComptes([cal('c', 30), repereOuvert, cal('b', 20)], T);
  assert.equal(c.get('b')?.prochainCreneau, T + (100 / 60) * H);
  assert.equal(c.get('c')?.prochainCreneau, T + (200 / 60) * H);
});

test('un compte coupé ou jumeau ne compte pas dans le partage', () => {
  const c = creneauxDesComptes(
    [repereOuvert, cal('coupe', 15, { disabled: true }), cal('pro', 20, { jumeauDe: 'g' }), cal('double', 25, { jumeauDe: 'g' })],
    T,
  );
  assert.equal(c.get('pro')?.parts, 2);
  assert.equal(c.has('coupe'), false);
  assert.equal(c.has('double'), false);
  assert.equal(c.size, 2);
});

test('un compte Codex ne se cale pas', () => {
  const c = creneauxDesComptes([repereOuvert, { id: 'x', engine: 'codex', priority: 1 }], T);
  assert.equal(c.size, 1);
});

test('le repère au repos va partir maintenant : les autres attendent leur part', () => {
  const c = creneauxDesComptes([cal('perso', 10), cal('pro', 20)], T);
  assert.equal(c.get('pro')?.prochainCreneau, T + 2.5 * H);
});

test('un repère incertain ne cale personne : ancien comportement', () => {
  const c = creneauxDesComptes([cal('perso', 10, { incertain: true }), cal('pro', 20)], T);
  assert.equal(c.get('pro')?.prochainCreneau, undefined);
  assert.equal(decisionAmorce(compte({ id: 'pro' }), T, false, c.get('pro')?.prochainCreneau), 'a-amorcer');
});

test("tolérance : un créneau passé de peu s'amorce encore, au-delà on attend le suivant", () => {
  const peu = creneauxDesComptes([repereOuvert, cal('pro', 20)], T + 2.5 * H + 5 * 60_000);
  assert.equal(peu.get('pro')?.prochainCreneau, T + 2.5 * H);
  assert.equal(decisionAmorce(compte({ id: 'pro' }), T + 2.5 * H + 5 * 60_000, false, T + 2.5 * H), 'a-amorcer');
  const trop = creneauxDesComptes([repereOuvert, cal('pro', 20)], T + 2.5 * H + 20 * 60_000);
  assert.equal(trop.get('pro')?.prochainCreneau, T + 7.5 * H);
});

test('avant son créneau, le compte au repos attend ; une minute d\'avance suffit', () => {
  assert.equal(decisionAmorce(compte(), T, false, T + H), 'avant-son-creneau');
  assert.equal(decisionAmorce(compte(), T, false, T + 30_000), 'a-amorcer');
  assert.deepEqual(comptesAAmorcer([compte()], T, false, new Map([['claude-1', { prochainCreneau: T + H } as any]])), []);
});

test('une fenêtre ouverte hors créneau par le travail se recale au créneau suivant', () => {
  // Le travail a ouvert « pro » à T + 30 min : sa fenêtre finit à T + 5 h 30,
  // après son créneau de T + 2 h 30. Prochain réveil : T + 7 h 30.
  const c = creneauxDesComptes(
    [repereOuvert, cal('pro', 20, { sessionPct: 12, resetsAt: T + 5.5 * H })],
    T + 3 * H,
  );
  assert.equal(c.get('pro')?.prochainReveil, T + 7.5 * H);
  // Fenêtre finie à T + 5 h 30 : le compte attend, il ne se rouvre pas aussitôt.
  assert.equal(decisionAmorce(compte({ id: 'pro' }), T + 5.5 * H, false, T + 7.5 * H), 'avant-son-creneau');
});

test('fenêtre ouverte : compteur, amorce récente ou agent au travail', () => {
  assert.equal(fenetreOuverte({ sessionPct: 3 }, T), true);
  assert.equal(fenetreOuverte({ derniereAmorce: { at: T - H, ok: true } }, T), true);
  assert.equal(fenetreOuverte({ derniereAmorce: { at: T - 6 * H, ok: true } }, T), false);
  assert.equal(fenetreOuverte({ derniereAmorce: { at: T - H, ok: false } }, T), false);
  assert.equal(fenetreOuverte({ agentEnCours: true }, T), true);
  assert.equal(fenetreOuverte({}, T), false);
});

test('le travail va d\'abord sur un compte ouvert, le repos en dernier recours', () => {
  const perso = { id: 'perso', priority: 10, sessionPct: 0, fenetreOuverte: false };
  const pro = { id: 'pro', priority: 20, sessionPct: 40, fenetreOuverte: true };
  assert.equal(compteQuiRecoitLeTravail([perso, pro])?.id, 'pro');
  // Le compte ouvert est plein : le travail part quand même, sur le repos.
  assert.equal(compteQuiRecoitLeTravail([perso, { ...pro, sessionPct: 100 }])?.id, 'perso');
  // Sans information de fenêtre, la priorité réglée décide comme avant.
  assert.equal(compteQuiRecoitLeTravail([{ id: 'perso', priority: 10 }, { id: 'pro', priority: 20 }])?.id, 'perso');
  // Deux comptes ouverts et semblables : la fenêtre la plus entamée finit
  // d'abord (27/10/2026) ; à consommation égale, la priorité départage.
  assert.equal(compteQuiRecoitLeTravail([{ ...perso, fenetreOuverte: true }, pro])?.id, 'pro');
  assert.equal(compteQuiRecoitLeTravail([{ ...perso, sessionPct: 40, fenetreOuverte: true }, pro])?.id, 'perso');
});

test('un jeton expiré qui attend son créneau est réveillé au créneau, pas avant (cas du 25/10)', () => {
  // Le relevé en attente n'est pas une lecture ratée (`etatDesComptes`) : le
  // compte suit donc son créneau, et c'est l'amorce du créneau qui renouvelle.
  const enAttente = compte({ id: 'pro', sessionPct: undefined, lectureEnEchec: false });
  assert.equal(decisionAmorce(enAttente, T, false, T + 2.5 * H), 'avant-son-creneau');
  assert.equal(decisionAmorce(enAttente, T + 2.5 * H, false, T + 2.5 * H), 'a-amorcer');
  // Une lecture vraiment ratée, elle, ne réveille toujours personne.
  assert.equal(decisionAmorce(compte({ id: 'pro', lectureEnEchec: true }), T + 2.5 * H, false, T + 2.5 * H), 'lecture-en-echec');
});

/* ------------------------------------------------------------------ */
/* Un alignement causé par le travail se repère, puis se recale         */
/* ------------------------------------------------------------------ */

test("le travail rouvre le second compte en même temps que le repère : alignement repéré, recalage à T + 7 h 30 (cas du 25/10)", () => {
  // Repère réveillé à T ; un tour parti juste avant la fin de fenêtre de
  // « pro » l'a rouvert à T aussi : les deux finissent à T + 5 h.
  const pendant = creneauxDesComptes(
    [repereOuvert, cal('pro', 20, { sessionPct: 3, resetsAt: T + DUREE_FENETRE_MS })],
    T + 10 * 60_000,
  );
  const pro = pendant.get('pro');
  assert.equal(pro?.horsCreneau?.finFenetre, T + DUREE_FENETRE_MS);
  assert.equal(pro?.horsCreneau?.ecartMs, 2.5 * H);
  assert.equal(pro?.horsCreneau?.alignee, true);
  assert.equal(pro?.prochainReveil, T + 7.5 * H);
  // Le repère, lui, n'est jamais « hors créneau » : c'est sur lui qu'on se cale.
  assert.equal(pendant.get('perso')?.horsCreneau, undefined);

  // À T + 5 h les deux fenêtres retombent ; le repère est réamorcé aussitôt.
  const apres = T + DUREE_FENETRE_MS + 60_000;
  const reamorce = cal('perso', 10, { sessionPct: 1, resetsAt: T + 2 * DUREE_FENETRE_MS });
  const ensuite = creneauxDesComptes([reamorce, cal('pro', 20, { sessionPct: 0 })], apres);
  assert.equal(ensuite.get('pro')?.prochainCreneau, T + 7.5 * H);
  // Le second n'est PAS réveillé quand il retombe, mais à son créneau.
  assert.equal(decisionAmorce(compte({ id: 'pro' }), apres, false, T + 7.5 * H), 'avant-son-creneau');
  assert.equal(decisionAmorce(compte({ id: 'pro' }), T + 7.5 * H, false, T + 7.5 * H), 'a-amorcer');
  // Fenêtre retombée, le compte fautif est « au repos » : dernier recours seulement.
  assert.equal(fenetreOuverte({ sessionPct: 0 }, apres), false);
});

test('une fenêtre à son créneau, ou décalée de peu, n\'est pas hors créneau', () => {
  const calee = creneauxDesComptes(
    [repereOuvert, cal('pro', 20, { sessionPct: 20, resetsAt: T + 2.5 * H + 5 * 60_000 })],
    T + H,
  );
  assert.equal(calee.get('pro')?.horsCreneau, undefined);
  assert.equal(fenetreHorsCreneau(T, T + 25 * 60_000), undefined);
  assert.equal(fenetreHorsCreneau(T, T + 5 * H - 25 * 60_000), undefined);
  assert.equal(fenetreHorsCreneau(T, T + 40 * 60_000)?.ecartMs, 40 * 60_000);
});

test("le repère rattrape le second : c'est quand même le second qui se recale", () => {
  // « pro » a ouvert à T + 1 h hors créneau ; le repère se trouve à T. Seul
  // « pro » porte l'alignement perdu, le repère garde son rythme.
  const c = creneauxDesComptes([repereOuvert, cal('pro', 20, { sessionPct: 50, resetsAt: T + 6 * H })], T + 2 * H);
  assert.equal(c.get('pro')?.horsCreneau?.alignee, false);
  assert.equal(c.get('pro')?.prochainReveil, T + 7.5 * H);
  assert.equal(c.get('perso')?.horsCreneau, undefined);
});

test('un repère au repos ou incertain ne fait repérer aucun alignement', () => {
  const repos = creneauxDesComptes([cal('perso', 10), cal('pro', 20, { sessionPct: 5, resetsAt: T + 3 * H })], T);
  assert.equal(repos.get('pro')?.horsCreneau, undefined);
  const incertain = creneauxDesComptes(
    [cal('perso', 10, { incertain: true }), cal('pro', 20, { sessionPct: 5, resetsAt: T + 3 * H })],
    T,
  );
  assert.equal(incertain.get('pro')?.horsCreneau, undefined);
  assert.equal(incertain.get('pro')?.prochainCreneau, undefined);
});

test('repère plein : le second compte reçoit quand même le travail, même hors créneau', () => {
  const perso = { id: 'perso', priority: 10, sessionPct: 100, fenetreOuverte: true };
  const pro = { id: 'pro', priority: 20, sessionPct: 0, fenetreOuverte: false };
  assert.equal(compteQuiRecoitLeTravail([perso, pro])?.id, 'pro');
});

test('deux fenêtres alignées ne font pas passer deux comptes pour jumeaux', () => {
  const a = { id: 'perso', engine: 'claude', sessionPct: 12, sessionResetsAt: T + DUREE_FENETRE_MS, weeklyPct: 40, weeklyResetsAt: T + 50 * H };
  const b = { ...a, id: 'pro', weeklyPct: 22, weeklyResetsAt: T + 90 * H };
  assert.equal(natureDuJumelage(a, b), null);
  // Même aux mêmes chiffres, deux identités connues et différentes tranchent.
  const memes = { ...a, id: 'pro' };
  assert.equal(natureDuJumelage({ ...a, compteFournisseur: 'x' }, { ...memes, compteFournisseur: 'y' }), null);
});
