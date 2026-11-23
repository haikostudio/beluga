import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MEMOIRE_POUR_CHARGER_LE_TRIEUR_MO,
  commandeLanceUnEssai,
  gardeDeMemoire,
  PHRASE_D_ATTENTE_DE_MEMOIRE,
  porteDesTravauxLourds,
  signesDeMeminfo,
  triDesCompetencesPermis,
} from '@beluga/shared';
import { attendreLaPlaceDesTravauxLourds } from '../porte-des-travaux-lourds.js';
import { arreterLeVectoriseur, etatDuTrieur, noterParLeTri, reglerLeTriPourLesTests } from '../vectoriseur.js';

/**
 * LES DÉCROCHAGES DES 17 ET 18/11/2026 : la mémoire pleine figeait le démon.
 * Décisions de l'utilisateur : un travail lourd ATTEND la place et le dit,
 * une attente BORNÉE ; le tri des compétences est gardé, SEULEMENT quand la
 * machine a de la place, un seul à la fois, et il s'arrête vraiment au délai.
 */

const PLEINE = { suspendre: true, raison: 'Mémoire presque pleine (96 %)' };
const LIBRE = { suspendre: false };

test('la porte des travaux lourds : libre → partir, pleine → attendre, puis forcer au-delà du plafond', () => {
  assert.equal(porteDesTravauxLourds(LIBRE, 0), 'partir');
  assert.equal(porteDesTravauxLourds(PLEINE, 0), 'attendre');
  assert.equal(porteDesTravauxLourds(PLEINE, 60_000, 180_000), 'attendre');
  assert.equal(porteDesTravauxLourds(PLEINE, 180_000, 180_000), 'forcer');
  assert.equal(porteDesTravauxLourds(LIBRE, 999_999, 180_000), 'partir');
});

test('la phrase d’attente est stable : ni chiffre ni compte à rebours', () => {
  assert.doesNotMatch(PHRASE_D_ATTENTE_DE_MEMOIRE, /\d/);
});

test('les signes de /proc/meminfo : part prise, disponible, échange', () => {
  const texte = 'MemTotal:        7930880 kB\nMemFree:          800000 kB\nMemAvailable:    1586176 kB\nSwapTotal:       8388604 kB\nSwapFree:         167772 kB\n';
  const s = signesDeMeminfo(texte)!;
  assert.equal(s.memPct, 80);
  assert.equal(s.memDispoMo, 1549);
  assert.equal(s.swapPct, 98);
  assert.equal(signesDeMeminfo('MemTotal: 100 kB\nMemAvailable: 50 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n')?.swapPct, undefined);
  assert.equal(signesDeMeminfo('rien'), undefined);
});

test('le tri : sauté sous pression, et sauté s’il faut charger le trieur sans la place', () => {
  assert.equal(triDesCompetencesPermis({ pression: PLEINE, trieurCharge: true, memDispoMo: 4000 }).permis, false);
  const sansPlace = triDesCompetencesPermis({ pression: LIBRE, trieurCharge: false, memDispoMo: MEMOIRE_POUR_CHARGER_LE_TRIEUR_MO - 1 });
  assert.equal(sansPlace.permis, false);
  assert.match(sansPlace.raison!, /trop peu pour charger le trieur/);
  // Déjà chargé : rien à payer, il trie.
  assert.equal(triDesCompetencesPermis({ pression: LIBRE, trieurCharge: true, memDispoMo: 200 }).permis, true);
  assert.equal(triDesCompetencesPermis({ pression: LIBRE, trieurCharge: false, memDispoMo: 3000 }).permis, true);
  // Échange plein (18/11/2026 08:28 : 8191/8191 Mo) : refusé, même trieur chargé et mémoire vive libre.
  const echangePlein = triDesCompetencesPermis({ pression: LIBRE, trieurCharge: true, memDispoMo: 3000, swapPct: 100 });
  assert.equal(echangePlein.permis, false);
  assert.match(echangePlein.raison ?? '', /échange plein à 100 %/);
  assert.equal(triDesCompetencesPermis({ pression: LIBRE, trieurCharge: false, memDispoMo: 3000, swapPct: 90 }).permis, true);
  assert.equal(triDesCompetencesPermis({ pression: LIBRE, trieurCharge: false, memDispoMo: 3000, swapPct: 91 }).permis, false);
});

test('l’attente des travaux lourds : libre sans un mot, dite une fois, bornée, puis départ forcé', async () => {
  const dits: string[] = [];
  assert.equal(await attendreLaPlaceDesTravauxLourds({ quoi: 'essai', lire: () => LIBRE, surAttente: (p) => dits.push(p) }), 'libre');
  assert.equal(dits.length, 0);

  const debut = Date.now();
  const issue = await attendreLaPlaceDesTravauxLourds({ quoi: 'essai', lire: () => PLEINE, surAttente: (p) => dits.push(p), maxMs: 120, relectureMs: 20 });
  assert.equal(issue, 'force');
  assert.ok(Date.now() - debut < 2_000, 'l’attente reste bornée');
  assert.deepEqual(dits, [PHRASE_D_ATTENTE_DE_MEMOIRE], 'la phrase se dit UNE fois');

  let lectures = 0;
  const liberee = await attendreLaPlaceDesTravauxLourds({ quoi: 'essai', lire: () => (++lectures < 3 ? PLEINE : LIBRE), maxMs: 5_000, relectureMs: 10 });
  assert.equal(liberee, 'apres-attente');

  const arret = new AbortController();
  setTimeout(() => arret.abort(), 30);
  assert.equal(await attendreLaPlaceDesTravauxLourds({ quoi: 'essai', lire: () => PLEINE, signal: arret.signal, maxMs: 60_000, relectureMs: 10_000 }), 'arrete');
});

test('le trieur : sauté sous pression, un seul tri en vol, et un tri abandonné s’arrête vraiment', async (t) => {
  const avant = process.env.BELUGA_SANS_TRI_DES_COMPETENCES;
  delete process.env.BELUGA_SANS_TRI_DES_COMPETENCES;
  t.after(() => {
    arreterLeVectoriseur();
    reglerLeTriPourLesTests({});
    if (avant !== undefined) process.env.BELUGA_SANS_TRI_DES_COMPETENCES = avant;
  });
  const documents = Array.from({ length: 40 }, (_, i) => `fiche ${i}`); // 5 lots de 8, 150 ms chacun

  // Mémoire pleine : rien n'est lancé, réponse immédiate.
  reglerLeTriPourLesTests({ modeleDeTri: '@essai', memoire: () => ({ pression: PLEINE, memDispoMo: 5000 }) });
  const debut = Date.now();
  assert.equal(await noterParLeTri('devis', documents, 5_000), undefined);
  assert.ok(Date.now() - debut < 200);
  assert.equal(etatDuTrieur().charge, false, 'le trieur n’est même pas chargé');

  // De la place : il trie.
  reglerLeTriPourLesTests({ modeleDeTri: '@essai', memoire: () => ({ pression: LIBRE, memDispoMo: 5000 }) });
  const notes = await noterParLeTri('devis', documents.slice(0, 8), 10_000);
  assert.equal(notes?.length, 8);

  // Un seul en vol : le second rend undefined tout de suite.
  const premier = noterParLeTri('devis', documents, 10_000);
  const second = await noterParLeTri('devis', documents, 10_000);
  assert.equal(second, undefined);
  assert.equal((await premier)?.length, 40);

  // Au délai, le processus reçoit l'annulation et s'arrête avant la fin.
  const annulesAvant = etatDuTrieur().annulationsConfirmees;
  assert.equal(await noterParLeTri('devis', documents, 200), undefined);
  assert.equal(etatDuTrieur().enVol, false, 'le tri abandonné libère la place');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(etatDuTrieur().annulationsConfirmees, annulesAvant + 1, 'le processus a confirmé l’arrêt');
});

test('les essais d’une tâche : repérés, retenus machine pleine, puis partis après l’attente bornée', () => {
  assert.equal(commandeLanceUnEssai('npm run dev --workspace web -- --port 7099 > /tmp/j.log 2>&1 &'), 'npm run dev');
  assert.equal(commandeLanceUnEssai('cd web && npx vite --port 7100'), 'npx vite');
  assert.equal(commandeLanceUnEssai('npx playwright test e2e/'), 'playwright test');
  assert.equal(commandeLanceUnEssai('npm run build && npm test'), null);
  assert.equal(commandeLanceUnEssai("cat > x.sh <<'FIN'\nnpm run dev\nFIN"), null, 'le corps d’un heredoc n’est pas lancé');

  const maintenant = 1_000_000;
  assert.equal(gardeDeMemoire({ commande: 'npm run build', pression: PLEINE, maintenant }).verdict, 'passe', 'une construction n’est pas un essai');
  assert.equal(gardeDeMemoire({ commande: 'npx vite &', pression: LIBRE, maintenant }).verdict, 'passe');
  const refus = gardeDeMemoire({ commande: 'npx vite &', pression: PLEINE, maintenant });
  assert.equal(refus.verdict, 'refuse');
  assert.match(refus.texte!, /relance la même commande/);
  assert.doesNotMatch(refus.texte!, /\d/, 'phrase stable, sans chiffre');
  assert.equal(gardeDeMemoire({ commande: 'npx vite &', pression: PLEINE, premierRefusLe: maintenant - 60_000, maintenant, maxMs: 180_000 }).verdict, 'refuse');
  assert.equal(gardeDeMemoire({ commande: 'npx vite &', pression: PLEINE, premierRefusLe: maintenant - 180_000, maintenant, maxMs: 180_000 }).verdict, 'force');
});
