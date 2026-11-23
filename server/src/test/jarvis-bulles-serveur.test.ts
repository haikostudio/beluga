import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * JARVIS PARLE DANS SES BULLES, CÔTÉ DÉMON (carte du 23/11/2026) : la bulle d'information est émise et gardée, une
 * annonce d'affichage sans bulle est reprise une fois, l'écriture non demandée est refusée, l'historique se pagine.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-bulles-'));
process.env.BELUGA_DATA = bacASable;

const { sessionDEssai, montrerUneInformation, ecritureAutorisee, souvenirsDesDerniersJours } = await import('../voix-directe.js');
const discussions = await import('../discussions-vocales.js');
const { bus } = await import('../bus.js');

test('voix_montrer pose la bulle, la garde dans la discussion, et seulement alors dit « affiché »', () => {
  const numero = discussions.ouvrirDiscussion({ agentId: 'agent-bulles' });
  const vus: any[] = [];
  const desabonner = bus.subscribe((e: any) => {
    if (e?.type === 'voix.direct.information') vus.push(e);
  });
  const essai = sessionDEssai('agent-bulles', numero);
  try {
    assert.equal(montrerUneInformation('agent-bulles', 'Doc', '').ok, false);
    const r = montrerUneInformation('agent-bulles', 'Documentation', '| a | b |\n|---|---|\n| 1 | 2 |\n\n[Guide](https://exemple.fr)');
    assert.equal(r.ok, true);
    assert.match(r.text, /Affiché à l’écran/);
    assert.equal(vus.length, 1);
    assert.equal(vus[0].titre, 'Documentation');
    const d = discussions.lireDiscussion(numero)!;
    const info = d.echanges.find((e) => e.role === 'information');
    assert.ok(info, 'la bulle est gardée dans la discussion');
    assert.match(info!.texte, /\| a \| b \|\n\|---\|---\|/, 'le Markdown garde ses retours à la ligne');
    assert.equal(montrerUneInformation('agent-inconnu', 'x', 'y').ok, false, 'sans conversation, rien ne prétend s’afficher');
  } finally {
    essai.retirer();
    desabonner();
  }
});

test('une annonce d’affichage sans bulle est reprise une seule fois ; après une vraie bulle, rien', async () => {
  const appels: { methode: string; params: any }[] = [];
  const essai = sessionDEssai('agent-annonce', discussions.ouvrirDiscussion({ agentId: 'agent-annonce' }), appels);
  const corrections = () => appels.filter((a) => a.methode === 'thread/realtime/appendText' && /CORRECTION DE BELUGA/.test(a.params.text)).length;
  try {
    essai.notifier('thread/realtime/transcript/done', { role: 'user', text: 'Trouve-moi les liens de la doc' });
    essai.notifier('thread/realtime/transcript/done', { role: 'assistant', text: 'Je te les ai mis dans la conversation.' });
    essai.notifier('thread/realtime/transcript/done', { role: 'assistant', text: 'Les voilà.' });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(corrections(), 1, 'une seule correction par phrase de l’utilisateur');
    essai.notifier('thread/realtime/transcript/done', { role: 'user', text: 'Et le tableau ?' });
    montrerUneInformation('agent-annonce', 'Tableau', '| x |\n|---|\n| 1 |');
    essai.notifier('thread/realtime/transcript/done', { role: 'assistant', text: 'C’est dans la bulle juste au-dessus.' });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(corrections(), 1, 'une vraie bulle : aucune correction');
  } finally {
    essai.retirer();
  }
});

test('Jarvis n’écrit dans un champ que si on le lui a demandé', () => {
  const essai = sessionDEssai('agent-ecrit', discussions.ouvrirDiscussion({ agentId: 'agent-ecrit' }));
  try {
    essai.notifier('thread/realtime/transcript/done', { role: 'user', text: 'Sors-moi les liens ici' });
    assert.equal(ecritureAutorisee('agent-ecrit'), false);
    essai.notifier('thread/realtime/transcript/done', { role: 'user', text: 'Écris-le dans la carte' });
    assert.equal(ecritureAutorisee('agent-ecrit'), true);
  } finally {
    essai.retirer();
  }
  assert.equal(ecritureAutorisee('agent-ecrit'), true, 'hors voix, rien n’est bloqué ici');
});

test('l’historique se pagine du plus récent au plus ancien, sans l’appel en cours', () => {
  const ancienne = discussions.ouvrirDiscussion({ agentId: 'agent-histoire' });
  for (let i = 0; i < 5; i += 1) discussions.ajouterTour(ancienne, i % 2 ? 'assistant' : 'user', `ancien ${i}`);
  const autre = discussions.ouvrirDiscussion({ agentId: 'autre-agent' });
  discussions.ajouterTour(autre, 'user', 'pas à moi');
  const recente = discussions.ouvrirDiscussion({ agentId: 'agent-histoire' });
  for (let i = 0; i < 3; i += 1) discussions.ajouterTour(recente, 'user', `récent ${i}`);
  const muette = discussions.ouvrirDiscussion({ agentId: 'agent-histoire' });
  discussions.ajouterTour(muette, 'assistant', 'Salut, je t’écoute.');
  const p1 = discussions.pageDHistorique('agent-histoire', { limite: 4 });
  assert.deepEqual(p1.tours.map((t) => t.texte), ['ancien 4', 'récent 0', 'récent 1', 'récent 2']);
  assert.equal(p1.fin, false);
  const p2 = discussions.pageDHistorique('agent-histoire', { limite: 4, avant: p1.tours[0]!.id });
  assert.deepEqual(p2.tours.map((t) => t.texte), ['ancien 0', 'ancien 1', 'ancien 2', 'ancien 3']);
  assert.equal(p2.fin, true);
  assert.ok(p2.tours.every((t) => t.discussion === ancienne && t.debut > 0));
  const sansCourant = discussions.pageDHistorique('agent-histoire', { sauf: { discussion: recente, depuis: 0 } });
  assert.ok(sansCourant.tours.every((t) => t.discussion !== recente), 'l’appel en cours vit déjà dans la pile');
});

test('le récit des trois derniers jours se lit sans quota', () => {
  const numero = discussions.ouvrirDiscussion({ agentId: 'agent-recit' });
  discussions.ajouterTour(numero, 'user', 'On parlait des captures effacées');
  const r = souvenirsDesDerniersJours('agent-recit');
  assert.equal(r.ok, true);
  assert.match(r.text, /TROIS DERNIERS JOURS/);
  assert.match(r.text, /captures effacées/);
  assert.match(souvenirsDesDerniersJours('agent-sans-rien').text, /Aucune discussion/);
});
