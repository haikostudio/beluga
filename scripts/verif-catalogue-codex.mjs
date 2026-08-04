#!/usr/bin/env node
/**
 * Combien de modèles Codex l'utilisateur voit-il vraiment ?
 *
 * On interroge le VRAI catalogue avec les comptes Codex du serveur et on donne
 * les deux chiffres qui comptent :
 *   1. combien de modèles l'API rend ;
 *   2. combien en restent après dédoublonnage — c'est ce que montre le menu.
 * Un écart entre les deux signale des modèles escamotés.
 *
 *   node scripts/verif-catalogue-codex.mjs
 *
 * Quand aucun compte ne répond, on le DIT (jeton refusé, session terminée) au
 * lieu d'annoncer une liste complète : c'est exactement le cas où l'interface
 * doit afficher « liste de secours ». N'écrit rien, ne publie rien.
 */
import { dedoublonnerModeles, messageDeRepli } from '../shared/dist/index.js';
import { codexTokens } from '../server/dist/engines/catalog.js';
import { codexAdapter } from '../server/dist/engines/codex.js';

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

const detecte = await codexAdapter.detect();
const version = (detecte.version ?? '').match(/[\d.]+/)?.[0] ?? '0.146.0';
console.log(`Codex ${detecte.installed ? `installé (${version})` : 'non installé'}`);

const jetons = codexTokens();
console.log(`Comptes Codex avec un jeton : ${jetons.length}`);

let brut = null;
let dernierEchec = 'aucun compte joignable';
for (const jeton of jetons) {
  try {
    const res = await fetch(`https://chatgpt.com/backend-api/codex/models?client_version=${version}`, {
      headers: { authorization: `Bearer ${jeton}`, originator: 'codex_cli_rs' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const corps = await res.json().catch(() => null);
      dernierEchec = `réponse ${res.status}${corps?.error?.message ? ` — ${corps.error.message}` : ''}`;
      continue;
    }
    const data = await res.json();
    brut = Array.isArray(data?.models) ? data.models : [];
    break;
  } catch (err) {
    dernierEchec = err?.message ?? String(err);
  }
}

if (!brut) {
  console.log(`\nLe catalogue n'a pas pu être lu : ${dernierEchec}`);
  const phrase = messageDeRepli({ installed: true, live: false, catalogError: dernierEchec });
  noter("la liste de secours s'annonce à l'écran", !!phrase && phrase.includes(dernierEchec), phrase ?? '');
  console.log('\nRebrancher un compte Codex (codex login) pour compter les modèles réels.');
  process.exit(resultats.every((r) => r.ok) ? 0 : 1);
}

const modeles = brut.map((entry) => ({
  id: entry.slug,
  label: entry.display_name ?? entry.slug,
  thinking: (entry.supported_reasoning_levels ?? []).map((l) => ({ id: String(l.effort), label: String(l.effort) })),
}));
const garde = dedoublonnerModeles(modeles);

console.log(`\nModèles rendus par l'API : ${brut.length}`);
console.log(`Modèles gardés après dédoublonnage : ${garde.length}`);
for (const m of garde) {
  const niveaux = m.thinking.map((t) => t.id).join(', ') || 'aucun';
  console.log(`  · ${m.label}${m.note ? ` (${m.note})` : ''} — niveaux : ${niveaux}`);
}

noter(
  'aucun modèle rendu par le moteur ne disparaît de la liste',
  garde.length === new Set(brut.map((e) => e.slug)).size,
  `${garde.length} gardés pour ${new Set(brut.map((e) => e.slug)).size} identifiants distincts`,
);
noter(
  'chaque modèle affiché porte ses niveaux de réflexion',
  garde.every((m) => m.thinking.length > 0),
  garde.filter((m) => !m.thinking.length).map((m) => m.id).join(', ') || 'tous',
);

process.exit(resultats.every((r) => r.ok) ? 0 : 1);
