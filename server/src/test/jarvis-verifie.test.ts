import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  Card,
  consigneDeLaVoix,
  consigneDuDirect,
  ligneDuModeleDuDirect,
  libelleDuModeleDuDirect,
  modeleEtEffortDuDirect,
  publicationsDuResume,
  resultatDeLaSource,
  resultatDeLOutil,
  resumeDeLActivite,
  libelleDeLActivite,
  genreDeLAppel,
} from '@beluga/shared';

/*
 * CARTE « JARVIS PLUS FIABLE ET VÉRIFIÉ » (18/11/2026) : les erreurs des appels vocaux du 18/11 (DISC-0043, DISC-0044),
 * rejouées en contrôles.
 *  - 10 h 34 : « aucune tâche en cours » pendant des mises en production, puis présentées « en pause » ;
 *  - 10 h 34 : « GPT-5 » annoncé au lieu de « GPT-5.6 Sol » ;
 *  - 10 h 34 : la carte « Rendre l'assistant vocal beaucoup plus rapide » pas retrouvée ;
 *  - 10 h 44 : « je passe en revue la mémoire » sans l'avoir ouverte.
 */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-verifie-'));
process.env.BELUGA_DATA = bacASable;

const store = await import('../store.js');
const { executerPourLAssistant, trouverDesCartesApprochantes, motsDeRecherche, outilsDeLAssistant, activitePourLaVoix } = await import('../assistant-global.js');

const projet = (id: string, name: string) =>
  store.saveProject({ id, name, path: bacASable, defaultEngine: 'claude', isSelf: false, archived: false, createdAt: store.now(), updatedAt: store.now() } as any);
projet('beluga-essai', 'Beluga essai');
projet('toogo-essai', 'TooGo essai');

function carte(titre: string, column: Card['column'], projectId = 'beluga-essai') {
  return store.saveCard(
    Card.parse({
      id: store.newId(),
      projectId,
      title: titre,
      column,
      position: 1,
      run: { engine: 'claude', thinking: 'none', mode: 'direct' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}
carte('Rendre l’assistant vocal beaucoup plus rapide', 'planned');
carte('Refonte de la page tarifs', 'planned', 'toogo-essai');

function publication(projectId: string, cible: 'dev' | 'production', state: 'running' | 'success' | 'failed', depuisMin: number, finieMin?: number) {
  store.saveDeploy({
    id: store.newId(),
    projectId,
    state,
    cible,
    steps: [],
    queued: false,
    reprises: 0,
    startedAt: Date.now() - depuisMin * 60_000,
    ...(finieMin !== undefined ? { endedAt: Date.now() - finieMin * 60_000 } : {}),
  } as any);
}
publication('toogo-essai', 'production', 'running', 4);
publication('beluga-essai', 'production', 'success', 90, 60);

const resume = async () => (await executerPourLAssistant({} as any, 'assistant_resume', {}, undefined)).text;

test('10 h 34 — une mise en production qui tourne est dans « ce qui tourne », et jamais « en pause »', async () => {
  const texte = await resume();
  const section = texte.split('\n\n').find((b) => b.startsWith('MISES EN LIGNE ET EN PRODUCTION'));
  assert.ok(section, texte);
  assert.match(section!, /En cours \(1\) :\n- TooGo essai — mise en production — en train de tourner/);
  assert.match(section!, /Finies récemment \(ne tournent PLUS\) :\n- Beluga essai — mise en production — réussie/);
  assert.doesNotMatch(texte, /en pause|attend une décision/);
  // Les trois parties sont distinctes : tâches, publications, ce qui attend.
  assert.match(texte, /TÂCHES EN COURS \(en ce moment\)/);
  assert.match(texte, /CE QUI T'ATTEND \(décisions, questions, plans\)/);
  // Le dossier de la voix porte la même activité, sans la liste des projets.
  const activite = await activitePourLaVoix();
  assert.match(activite, /MISES EN LIGNE ET EN PRODUCTION/);
  // …et ce qui ATTEND un geste, même quand rien ne tourne (carte « Jarvis : déploiements vus et champ masqué »).
  assert.match(activite, /^PUBLICATIONS EN ATTENTE/m);
  assert.match(activite, /À DÉPLOYER — Rien n'attend le déploiement\./);
  assert.doesNotMatch(activite, /^Projets :/m);
  assert.equal(resumeDeLActivite(activite), 'aucune tâche au travail · 1 publication en cours');
});

test('la règle pure des publications : « en cours » seulement si elle tourne, la plus récente d’abord', () => {
  const r = publicationsDuResume([
    { projet: 'A', cible: 'dev', state: 'failed', startedAt: 1, endedAt: 2 },
    { projet: 'B', cible: 'production', state: 'running', startedAt: 5 },
    { projet: 'C', state: 'success', startedAt: 3, endedAt: 9 },
  ]);
  assert.equal(r.enCours.length, 1);
  assert.match(r.enCours[0]!, /^- B — mise en production — en train de tourner/);
  assert.match(r.recentes[0]!, /^- C — mise en ligne sur ce serveur — réussie/);
  assert.match(r.recentes[1]!, /^- A — mise en ligne sur ce serveur — en échec/);
});

test('10 h 34 — « améliore Jarvis » et « rapidité de la voix » retrouvent « Rendre l’assistant vocal beaucoup plus rapide »', () => {
  for (const demande of ['améliore Jarvis', 'la rapidité de la voix', 'assistant vocal plus rapide', 'mets à jour la carte de Jarvis']) {
    const trouvees = trouverDesCartesApprochantes(demande, { limite: 5 });
    assert.ok(trouvees.some((t) => t.card.title === 'Rendre l’assistant vocal beaucoup plus rapide'), demande);
  }
  assert.deepEqual(
    motsDeRecherche('la rapidité de Jarvis').map((m) => m.mot),
    ['rapidité', 'jarvis'],
  );
  assert.ok(motsDeRecherche('rapidité')[0]!.variantes.includes('rapid'));
});

test('10 h 34 — le modèle annoncé est celui du réglage, jamais « GPT-5 » tout court', () => {
  assert.deepEqual(modeleEtEffortDuDirect({}), { modele: 'gpt-5.6-sol', effort: 'high' });
  assert.deepEqual(modeleEtEffortDuDirect({ voixCodexModele: 'gpt-5.6-terra', voixCodexReflexion: 'medium' }), { modele: 'gpt-5.6-terra', effort: 'medium' });
  // Un modèle sorti du catalogue du compte, une réflexion inconnue : retour au défaut.
  assert.deepEqual(modeleEtEffortDuDirect({ voixCodexModele: 'gpt-4-ancien', voixCodexReflexion: 'xhigh' }, ['gpt-5.6-sol']), { modele: 'gpt-5.6-sol', effort: 'high' });
  assert.equal(libelleDuModeleDuDirect('gpt-5.6-sol'), 'GPT-5.6 Sol');
  const ligne = ligneDuModeleDuDirect('gpt-5.6-terra', 'medium');
  assert.match(ligne, /^TON MODÈLE : GPT-5\.6 Terra, réflexion moyenne/);
  assert.match(ligne, /jamais « GPT-5 » tout court/);
  assert.match(consigneDuDirect(ligne), /TON MODÈLE : GPT-5\.6 Terra/);
  assert.match(consigneDeLaVoix('Jarvis', 'Chris', { modele: ligne }), /TON MODÈLE : GPT-5\.6 Terra/);
  assert.match(consigneDuDirect(), /TON MODÈLE : GPT-5\.6 Sol, réflexion poussée/);
});

test('10 h 44 — le dossier de vérification est servi au cerveau de la voix, et à lui seul', () => {
  const voix = outilsDeLAssistant('agent-x', { voix: true }).map((t) => t.name);
  // « voix_silence » est retiré (18/11/2026) : plus aucune étape n'est dite, il n'y a plus rien à faire taire.
  assert.ok(voix.includes('voix_dossier') && !voix.includes('voix_silence'));
  const ecrit = outilsDeLAssistant('agent-x').map((t) => t.name);
  assert.ok(!ecrit.includes('voix_dossier'));
  assert.equal(genreDeLAppel('voix_dossier'), 'lecture');
  // Le dossier montre ses quatre sources : il n'a pas de ligne à lui.
  assert.equal(libelleDeLActivite('voix_dossier'), null);
});

test('le dossier sans conversation ouverte cherche quand même, et dit chaque source', async () => {
  const { dossierPourLeCerveau } = await import('../voix-directe.js');
  const r = await dossierPourLeCerveau('agent-inconnu', 'assistant vocal');
  assert.equal(r.ok, true);
  assert.match(r.text, /^DOSSIER DE BELUGA pour « assistant vocal »/);
  assert.match(r.text, /TÂCHES APPROCHANTES, TOUS PROJETS :\n- « Rendre l’assistant vocal beaucoup plus rapide »/);
  assert.match(r.text, /ACTIVITÉ EN CE MOMENT :\n/);
  const sans = await dossierPourLeCerveau('agent-inconnu');
  assert.equal(sans.ok, false);
});

test('les étapes : courts résultats de chaque source et de chaque outil', () => {
  const trouve = { memoire: ['- MEM-1', '- MEM-2', '- MEM-3'], discussions: [], cartes: ['- « X »'], activite: 'TÂCHES EN COURS (en ce moment) — En cours (2) :\n- a\n- b', enRetard: [] as any };
  assert.equal(resultatDeLaSource('memoire', trouve), '3 éléments trouvés');
  assert.equal(resultatDeLaSource('discussions', trouve), 'aucune sur ce sujet');
  assert.equal(resultatDeLaSource('cartes', trouve), '1 tâche approchante');
  assert.equal(resultatDeLaSource('activite', trouve), '2 tâches au travail · aucune publication en cours');
  assert.equal(resultatDeLaSource('memoire', { ...trouve, enRetard: ['memoire'] }), 'pas de réponse à temps');
  assert.equal(resultatDeLOutil('memoire', { geste: 'chercher' }, '4 unité(s) pour « x » :\n- MEM-1'), '4 éléments trouvés');
  assert.equal(resultatDeLOutil('memoire', { geste: 'chercher' }, 'Aucune unité.'), 'rien trouvé');
  assert.equal(resultatDeLOutil('assistant_gestes', { action: 'trouver' }, '- « A » — projet\n- « B » — projet'), '2 tâches trouvées');
  assert.equal(resultatDeLOutil('board_create_card', {}, 'ok'), null);
});

test('18/11 — « salut, ça va » ne fait rien chercher ; le dossier ne part que quand le cerveau le demande', async () => {
  const { sessionDEssai, dossierPourLeCerveau } = await import('../voix-directe.js');
  const { bus } = await import('../bus.js');
  const discussions = await import('../discussions-vocales.js');
  const vus: any[] = [];
  const ecoute = (e: any) => {
    if (e?.type === 'voix.direct.activite') vus.push(e);
  };
  const desabonner = bus.subscribe(ecoute);
  const essai = sessionDEssai('agent-voix', discussions.ouvrirDiscussion({ agentId: 'agent-voix' }));
  try {
    essai.notifier('thread/realtime/transcript/done', { role: 'user', text: 'Salut Jarvis, comment tu vas ?' });
    essai.notifier('thread/realtime/transcript/done', { role: 'assistant', text: 'Ça va bien, et toi ?' });
    essai.notifier('turn/completed', {});
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(vus.length, 0, 'aucune étape, aucune liste : rien n’a été cherché');
    essai.notifier('thread/realtime/transcript/done', { role: 'user', text: 'Tu te souviens de l’assistant vocal plus rapide ?' });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(vus.length, 0, 'la phrase seule ne lance toujours rien');
    const r = await dossierPourLeCerveau('agent-voix');
    assert.equal(r.ok, true);
    assert.match(r.text, /Rendre l’assistant vocal beaucoup plus rapide/);
    assert.ok(vus.some((e) => e.id.endsWith(':memoire') && e.etat === 'en-cours'), 'le dossier part à l’appel du cerveau');
    assert.ok(vus.every((e) => e.phrase && e.phrase === vus[0].phrase), 'ses étapes sont rangées sous la phrase');
  } finally {
    essai.retirer();
    desabonner();
  }
});
