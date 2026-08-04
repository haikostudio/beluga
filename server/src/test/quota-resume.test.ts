import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  historiquePourProfil,
  profilHoraire,
  resumerReleves,
  relevesDepuisResume,
  type ReleveQuota,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* L'historique des quotas remonte à deux mois, résumé au-delà de deux  */
/* semaines                                                            */
/* ------------------------------------------------------------------ */

/*
 * Le compactage écrit dans une VRAIE base : elle est posée dans un dossier
 * jetable, le test n'a rien à faire de celle du serveur.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-resume-'));
process.env.HAIKODEV_DATA = bacASable;

const store = await import('../store.js');
const { getDb } = await import('../db.js');

const MAINTENANT = new Date('2026-08-03T09:00:00+02:00').getTime();
const QUART = 15 * 60 * 1000;
const COMPTE = 'compte-d-essai';

/**
 * Trois mois de relevés, un par quart d'heure, avec une nuit franchement creuse
 * (de 1 h à 7 h) et un jour bien chargé : de quoi mesurer un vrai profil.
 */
function troisMoisDeReleves(): ReleveQuota[] {
  const out: ReleveQuota[] = [];
  const debut = MAINTENANT - 90 * 24 * 3600 * 1000;
  let cumul = 0;
  for (let at = debut; at <= MAINTENANT; at += QUART) {
    const heure = new Date(at).getHours();
    const creux = heure >= 1 && heure < 7;
    cumul += creux ? 0.01 : 0.25;
    out.push({ at, weekly: cumul, session: 0 });
  }
  return out;
}

function poserLesReleves(releves: ReleveQuota[]): void {
  const insert = getDb().prepare(
    'INSERT INTO quota_samples (account, at, session_pct, weekly_pct) VALUES (?, ?, ?, ?)',
  );
  getDb().transaction(() => {
    for (const releve of releves) insert.run(COMPTE, releve.at, releve.session ?? 0, releve.weekly);
  })();
}

function comparerProfils(avant: number[] | null, apres: number[] | null, tolerance = 0.01): void {
  assert.ok(avant, 'un profil est attendu AVANT compactage');
  assert.ok(apres, 'un profil est attendu APRÈS compactage');
  assert.equal(apres.length, avant.length, 'le profil garde le même nombre de tranches');
  for (let i = 0; i < avant.length; i++) {
    const ecart = Math.abs(apres[i] - avant[i]) / Math.max(0.001, avant[i]);
    assert.ok(ecart <= tolerance, `tranche ${i} : ${avant[i]} devient ${apres[i]} (écart ${(ecart * 100).toFixed(2)} %)`);
  }
}

test('le résumé rend le même profil que le détail, à moins d’un pour cent près', () => {
  const releves = troisMoisDeReleves();
  const avant = profilHoraire(releves);
  const apres = profilHoraire(relevesDepuisResume(resumerReleves(releves)));
  comparerProfils(avant, apres);
});

test('le ménage ne supprime que le détail, jamais le résumé', () => {
  poserLesReleves(troisMoisDeReleves());
  const avant = profilHoraire(store.quotaHistory(120)[COMPTE] ?? []);

  store.compacterQuotaSamples(MAINTENANT);

  const detail = store.quotaHistory(120)[COMPTE] ?? [];
  assert.ok(detail.length > 0, 'le détail des derniers jours reste');
  const plusVieux = Math.min(...detail.map((point) => point.at));
  // Quatorze jours de détail, à l'ancre près (un relevé gardé exprès sous le seuil).
  const seuil = MAINTENANT - 14 * 24 * 3600 * 1000;
  assert.ok(plusVieux >= seuil - QUART, 'plus rien de détaillé au-delà de quatorze jours');

  const resume = store.quotaResume()[COMPTE] ?? [];
  assert.ok(resume.length > 24, `le résumé garde les heures anciennes (${resume.length} tranches)`);
  // Deux mois de rétention : rien de plus vieux ne survit au ménage.
  const limite = new Date(MAINTENANT - 60 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  assert.ok(
    resume.every((tranche) => tranche.jour >= limite),
    'le résumé ne garde pas plus de deux mois',
  );

  // Et surtout : le profil calculé sur résumé + détail vaut celui d'avant.
  const apres = profilHoraire(historiquePourProfil(resume, detail));
  comparerProfils(avant, apres);
});

test('le compactage est rejouable sans rien doubler', () => {
  const avant = store.quotaResume()[COMPTE] ?? [];
  store.compacterQuotaSamples(MAINTENANT);
  const apres = store.quotaResume()[COMPTE] ?? [];
  assert.equal(apres.length, avant.length, 'aucune tranche en plus');
  const somme = (tranches: typeof avant) => tranches.reduce((total, t) => total + t.consommePct, 0);
  assert.ok(
    Math.abs(somme(apres) - somme(avant)) < 0.001,
    `la consommation résumée ne double pas (${somme(avant)} → ${somme(apres)})`,
  );
});

test('le résumé ne fausse pas la pente du moment', () => {
  // Deux heures de relevés récents, à 2 % l'heure : la pente doit rester celle-là,
  // que le résumé lointain soit là ou non.
  const recents: ReleveQuota[] = [
    { at: MAINTENANT - 2 * 3600 * 1000, weekly: 40 },
    { at: MAINTENANT - 3600 * 1000, weekly: 42 },
    { at: MAINTENANT, weekly: 44 },
  ];
  const melange = historiquePourProfil(store.quotaResume()[COMPTE], recents);
  const reels = melange.filter((point) => point.at >= MAINTENANT - 2 * 3600 * 1000);
  assert.equal(reels.length, 3, 'les relevés récents passent tels quels');
  // Le dernier point reconstruit est PLUS HAUT que le premier relevé réel :
  // c'est cette baisse que la prévision lit comme une remise à zéro.
  const anciens = melange.filter((point) => point.at < MAINTENANT - 2 * 3600 * 1000);
  assert.ok(anciens.length > 0, 'le résumé fournit bien un passé');
  assert.ok(anciens[anciens.length - 1].weekly > 44, 'la jonction se lit comme une remise à zéro');
});
