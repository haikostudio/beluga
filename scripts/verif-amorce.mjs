#!/usr/bin/env node
/**
 * Vérification sur les VRAIS comptes de l'amorçage de la fenêtre de cinq
 * heures : on lit le compteur avant, on laisse le mécanisme décider et
 * envoyer, puis on relit le compteur après.
 *
 *   node scripts/verif-amorce.mjs
 *
 * Le mécanisme n'amorce que ce qu'il doit : un compte dont la fenêtre tourne
 * déjà est laissé tranquille, et le script le dit plutôt que de forcer.
 */
import { openDb } from '../server/dist/db.js';
import { bootstrapAccounts, refreshQuotas, listAccountRecords } from '../server/dist/accounts.js';
import { amorcerFenetres, apercuAmorce, envoyerAmorce } from '../server/dist/amorce.js';

const heure = (t) => (t ? new Date(t).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' }) : '—');

function tableau(titre, quotas) {
  console.log(`\n── ${titre}`);
  for (const q of quotas.filter((q) => q.engine === 'claude')) {
    console.log(
      `   ${q.label.padEnd(38)} fenêtre ${String(q.session?.usedPct ?? '—').padStart(5)} %` +
        ` · remise à zéro ${heure(q.session?.resetsAt)}${q.error ? ` · ${q.error}` : ''}`,
    );
  }
}

openDb();
bootstrapAccounts();

const avant = await refreshQuotas(true);
tableau('AVANT', avant);

console.log('\n── Ce que le mécanisme décide, compte par compte');
for (const { id, raison } of apercuAmorce()) console.log(`   ${id.padEnd(20)} ${raison}`);

const posees = await amorcerFenetres();
console.log(`\n── ${posees} amorce(s) envoyée(s) par le passage automatique`);

// En essai forcé (--forcer), on envoie quand même une amorce sur chaque compte
// pour vérifier le chemin d'envoi lui-même, sans rien retenir.
if (process.argv.includes('--forcer')) {
  for (const account of listAccountRecords().filter((a) => a.engine === 'claude')) {
    const r = await envoyerAmorce(account, 'claude-haiku-4-5-20251001');
    console.log(`   essai forcé ${account.label} : ${r.ok ? `ok, ${r.tokens} jetons` : `échec — ${r.error}`}`);
    await new Promise((res) => setTimeout(res, 2000));
  }
}

await new Promise((res) => setTimeout(res, 20000));
const apres = await refreshQuotas(true);
tableau('APRÈS', apres);
process.exit(0);
