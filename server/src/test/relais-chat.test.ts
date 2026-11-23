import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

/* ------------------------------------------------------------------ */
/* Les moteurs ajoutés au format « chat » (Gemini) : Codex ne parle plus */
/* que « responses », le relais local traduit ; la sonde détecte seule le */
/* format, et une réponse « introuvable » n'est JAMAIS une clé refusée.   */
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'relais-chat-'));
process.env.BELUGA_DATA = bacASable;

const { cleDuMoteurDansLeCoffre, compatibiliteAgents, etatDeLaCarteDAjout, jugerDeclaration, verdictDEpreuve } = await import('@beluga/shared');
const relais = await import('../engines/relais-chat.js');
const { environnementOpenAI, raisonDeNePasPartir, raisonDeRefus, sonderLaFiche } = await import('../engines/ajoutes.js');

type Fiche = import('@beluga/shared').FicheMoteur;

/** Un faux fournisseur : `/responses` introuvable, `/chat/completions` en flux, appel d'outil au premier tour. */
function fournisseurChat(): Promise<{ url: string; demandes: any[]; fermer: () => void }> {
  const demandes: any[] = [];
  const serveur = http.createServer((req, res) => {
    let corps = '';
    req.on('data', (m) => (corps += m));
    req.on('end', () => {
      if (req.url?.endsWith('/responses')) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end('[{"error":{"code":404,"message":"introuvable"}}]');
        return;
      }
      if (req.headers.authorization !== 'Bearer bonne-cle') {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end('{"error":{"message":"API key not valid"}}');
        return;
      }
      const lu = JSON.parse(corps || '{}');
      demandes.push(lu);
      if (!lu.stream) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"choices":[{"message":{"content":"ok"}}]}');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const envoyer = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      const dejaOutil = lu.messages.some((m: any) => m.role === 'tool');
      if (!dejaOutil) {
        envoyer({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'appel-1',
                    type: 'function',
                    function: { name: 'exec_command', arguments: '{"cmd":' },
                    extra_content: { google: { thought_signature: 'SIG' } },
                  },
                ],
              },
            },
          ],
        });
        envoyer({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"cat note.txt"}' } }] } }] });
      } else {
        envoyer({ choices: [{ delta: { content: 'beluga-' } }] });
        envoyer({ choices: [{ delta: { content: '42' } }] });
      }
      envoyer({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } });
      res.end('data: [DONE]\n\n');
    });
  });
  return new Promise((resolve) =>
    serveur.listen(0, '127.0.0.1', () =>
      resolve({ url: `http://127.0.0.1:${(serveur.address() as AddressInfo).port}/v1beta/openai`, demandes, fermer: () => serveur.close() }),
    ),
  );
}

const fiche = (url: string, api?: 'responses' | 'chat'): Fiche => ({
  id: 'ext-essai-chat',
  label: 'Essai chat',
  nomCourt: 'Essai',
  famille: 'openai',
  urlDeBase: url,
  ...(api ? { api } : {}),
  modeleParDefaut: 'modele-pro',
  statut: 'essai',
  creeLe: 1,
});

/** Lit un flux SSE « responses » et rend ses événements. */
async function evenementsDe(res: Response): Promise<any[]> {
  const texte = await res.text();
  return texte
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => JSON.parse(l.slice(6)));
}

test('une demande « responses » devient une demande « chat » : consignes, appels, sorties, outils', () => {
  const signatures = new relais.MemoireDesSignatures();
  signatures.retenir('c1', { google: { thought_signature: 'S' } });
  const chat: any = relais.demandeChatDepuisResponses(
    {
      model: 'm',
      instructions: 'Tu es un agent.',
      input: [
        { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'Règle' }] },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Lis note.txt' }] },
        { type: 'reasoning', encrypted_content: 'x' },
        { type: 'function_call', call_id: 'c1', name: 'exec_command', arguments: '{"cmd":"cat note.txt"}' },
        { type: 'function_call_output', call_id: 'c1', output: 'contenu' },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'fini' }] },
      ],
      tools: [
        { type: 'function', name: 'exec_command', description: 'd', parameters: { type: 'object', properties: {} } },
        { type: 'namespace', name: 'multi_agent_v1' },
        { type: 'web_search' },
      ],
      tool_choice: 'auto',
      stream: true,
    },
    signatures,
  );
  assert.deepEqual(chat.messages[0], { role: 'system', content: 'Tu es un agent.\n\nRègle' });
  assert.deepEqual(chat.messages[1], { role: 'user', content: 'Lis note.txt' });
  assert.equal(chat.messages[2].role, 'assistant');
  assert.equal(chat.messages[2].tool_calls[0].id, 'c1');
  // La signature de pensée de Gemini revient avec son appel.
  assert.deepEqual(chat.messages[2].tool_calls[0].extra_content, { google: { thought_signature: 'S' } });
  assert.deepEqual(chat.messages[3], { role: 'tool', tool_call_id: 'c1', content: 'contenu' });
  assert.deepEqual(chat.messages[4], { role: 'assistant', content: 'fini' });
  assert.equal(chat.tools.length, 1);
  assert.equal(chat.tools[0].function.name, 'exec_command');
  assert.equal(chat.stream, true);
});

test('le relais conduit un tour entier : appel d’outil, sortie renvoyée, texte final et consommation', async () => {
  const amont = await fournisseurChat();
  try {
    await relais.demarrerRelaisChat();
    const adresse = relais.adresseCodexDeLaFiche(fiche(amont.url, 'chat'));
    assert.ok(adresse?.startsWith('http://127.0.0.1:'));
    const appel = (input: unknown[]) =>
      fetch(`${adresse}/responses`, {
        method: 'POST',
        headers: { authorization: 'Bearer bonne-cle', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'modele-pro', instructions: 'i', input, tools: [{ type: 'function', name: 'exec_command', parameters: { type: 'object' } }], stream: true }),
      });
    const premier = await evenementsDe(await appel([{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'lis' }] }]));
    assert.equal(premier[0].type, 'response.created');
    const fait = premier.find((e) => e.type === 'response.output_item.done');
    assert.equal(fait.item.type, 'function_call');
    assert.equal(fait.item.call_id, 'appel-1');
    assert.equal(fait.item.arguments, '{"cmd":"cat note.txt"}');
    assert.equal(premier.at(-1).type, 'response.completed');

    const second = await evenementsDe(
      await appel([
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'lis' }] },
        { type: 'function_call', call_id: 'appel-1', name: 'exec_command', arguments: '{"cmd":"cat note.txt"}' },
        { type: 'function_call_output', call_id: 'appel-1', output: 'Le mot secret est beluga-42.' },
      ]),
    );
    // Le fournisseur a reçu la signature gardée par le relais.
    assert.deepEqual(amont.demandes[1].messages.find((m: any) => m.tool_calls).tool_calls[0].extra_content, { google: { thought_signature: 'SIG' } });
    assert.equal(second.filter((e) => e.type === 'response.output_text.delta').map((e) => e.delta).join(''), 'beluga-42');
    const fin = second.at(-1);
    assert.equal(fin.type, 'response.completed');
    assert.equal(fin.response.output[0].content[0].text, 'beluga-42');
    assert.equal(fin.response.usage.input_tokens, 10);
    assert.equal(fin.response.usage.output_tokens, 3);

    // Une clé refusée remonte avec son statut : Codex montre la cause.
    const refus = await fetch(`${adresse}/responses`, { method: 'POST', headers: { authorization: 'Bearer mauvaise' }, body: '{"input":"x"}' });
    assert.equal(refus.status, 401);
    // Le relais ne vise que les fournisseurs inscrits.
    const inconnu = await fetch(`${relais.adresseDuRelaisChat()}/f/ext-jamais-vu/responses`, { method: 'POST', body: '{}' });
    assert.equal(inconnu.status, 404);
  } finally {
    amont.fermer();
  }
});

test('la sonde détecte le format « chat », et « introuvable » n’est jamais une clé refusée', async () => {
  const amont = await fournisseurChat();
  try {
    const bonne = await sonderLaFiche(fiche(amont.url), 'bonne-cle');
    assert.deepEqual(bonne, { ok: true, api: 'chat' });
    const mauvaise = await sonderLaFiche(fiche(amont.url), 'mauvaise');
    assert.equal(mauvaise.ok, false);
    assert.equal(mauvaise.formatInconnu, false);
    assert.match(mauvaise.erreur ?? '', /clé refusée/);
    // Format imposé « responses » : 404 → format inconnu, pas une clé refusée.
    const introuvable = await sonderLaFiche(fiche(amont.url, 'responses'), 'bonne-cle');
    assert.equal(introuvable.formatInconnu, true);
    assert.doesNotMatch(introuvable.erreur ?? '', /clé refusée/);
    assert.match(introuvable.erreur ?? '', /introuvable/);
  } finally {
    amont.fermer();
  }
  assert.doesNotMatch(raisonDeRefus(fiche('https://x.test'), 404), /clé refusée/);
  assert.match(raisonDeRefus(fiche('https://x.test'), 403), /clé refusée/);
});

test('en « chat », Codex vise le relais, et sans relais le tour ne part pas', async () => {
  const f = fiche('https://generativelanguage.example/v1beta/openai', 'chat');
  const coffre = path.join(bacASable, 'coffre-chat');
  await relais.demarrerRelaisChat();
  const env = environnementOpenAI(f, 'k', coffre);
  assert.equal(raisonDeNePasPartir(f, env), null);
  const config = fs.readFileSync(path.join(coffre, 'config.toml'), 'utf8');
  assert.match(config, /base_url = "http:\/\/127\.0\.0\.1:\d+\/f\/ext-essai-chat"/);
  assert.match(config, /wire_api = "responses"/);
  relais.arreterRelaisChat();
  assert.match(raisonDeNePasPartir(f, env) ?? '', /ne part pas/);
  const sans = environnementOpenAI(f, 'k', path.join(bacASable, 'coffre-sans'));
  assert.match(raisonDeNePasPartir(f, sans) ?? '', /ne part pas/);
});

test('une déclaration openai accepte « api », et refuse une valeur inconnue', () => {
  const ok = jugerDeclaration({ label: 'Gemini', famille: 'openai', api: 'chat', urlDeBase: 'https://x.test/v1', modeleParDefaut: 'm' }, [], 1);
  assert.ok('fiche' in ok && ok.fiche.api === 'chat');
  assert.ok('refus' in jugerDeclaration({ label: 'G', famille: 'openai', api: 'grpc', urlDeBase: 'https://x.test', modeleParDefaut: 'm' }, [], 1));
});

test('la compatibilité avec les agents se lit dans ce que l’épreuve a vu', () => {
  const vu = (c: Partial<{ cleAcceptee: boolean; formatReconnu: boolean; outilUtilise: boolean; reponseJuste: boolean }>) => ({
    statut: 'essai' as const,
    epreuve: { ok: false, at: 1, resume: 'raté', constat: { cleAcceptee: true, formatReconnu: true, outilUtilise: true, reponseJuste: false, ...c } },
  });
  assert.equal(compatibiliteAgents({ statut: 'essai' }).etat, 'inconnue');
  assert.equal(compatibiliteAgents({ statut: 'actif' }).etat, 'oui');
  assert.equal(compatibiliteAgents(vu({ formatReconnu: false })).motif, 'format-inconnu');
  assert.equal(compatibiliteAgents(vu({ cleAcceptee: false })).etat, 'inconnue');
  assert.equal(compatibiliteAgents(vu({ cleAcceptee: false, cleRefusee: false } as any)).motif, 'sans-reponse');
  assert.equal(compatibiliteAgents(vu({ outilUtilise: false })).motif, 'sans-outil');
  assert.equal(compatibiliteAgents(vu({})).motif, 'inacheve');
  const constat = { cleAcceptee: true, formatReconnu: false, outilUtilise: false, reponseJuste: false, finPropre: false, modelesLus: null, usageLu: false };
  assert.match(verdictDEpreuve(constat).resume, /aucun format/);
  assert.doesNotMatch(verdictDEpreuve(constat).resume, /clé n’a pas été acceptée/);
  // Une sonde restée sans réponse (surcharge, délai) ne met jamais la clé en cause.
  const muet = { ...constat, formatReconnu: true, cleAcceptee: false, cleRefusee: false };
  assert.match(verdictDEpreuve(muet).resume, /la clé n’est pas en cause/);
});

test('la carte d’un ajout suit la demande : « Travail » jusqu’à l’activation, puis « Archivé »', () => {
  assert.equal(etatDeLaCarteDAjout(undefined, true).colonne, 'running');
  assert.equal(etatDeLaCarteDAjout(undefined, false).colonne, 'running');
  const f = { label: 'Gemini', statut: 'essai' as const };
  assert.match(etatDeLaCarteDAjout(f, false).phrase, /pas encore essayé/);
  const rate = etatDeLaCarteDAjout({ ...f, epreuve: { ok: false, at: 1, resume: 'Épreuve ratée : x.' } }, false);
  assert.equal(rate.colonne, 'running');
  assert.match(rate.phrase, /^Épreuve ratée : x\. .*relancez l’essai/);
  assert.equal(etatDeLaCarteDAjout({ ...f, statut: 'actif' }, false).colonne, 'archived');
  // Un agent au travail garde toujours sa carte en « Travail ».
  assert.equal(etatDeLaCarteDAjout({ ...f, statut: 'actif' }, true).colonne, 'running');
});

test('sans clé collée, la clé du fournisseur se retrouve au coffre : même hôte d’abord, puis le nom', () => {
  const acces = (nom: string, champs: Record<string, string>, modifieLe = 1) =>
    ({ id: nom, nom, type: 'cle-api', projectId: null, champs, note: '', creeLe: 1, modifieLe }) as any;
  const gemini = { urlDeBase: 'https://generativelanguage.googleapis.com/v1beta/openai', nomCourt: 'Gemini', label: 'Google Gemini' };
  const coffre = [
    acces('OpenRouter', { service: 'OpenRouter', cle: 'or', adresse: 'https://openrouter.ai/api/v1' }),
    acces('Google Gemini API — production', { service: 'Google Gemini API', cle: 'ancienne', adresse: 'https://generativelanguage.googleapis.com/v1beta' }, 1),
    acces('Google Gemini API — neuve', { service: 'Google Gemini API', cle: 'neuve', adresse: 'https://generativelanguage.googleapis.com/v1beta' }, 5),
  ];
  assert.equal(cleDuMoteurDansLeCoffre(coffre, gemini), 'neuve');
  assert.equal(cleDuMoteurDansLeCoffre([acces('Clé Gemini', { cle: 'parnom' })], gemini), 'parnom');
  assert.equal(cleDuMoteurDansLeCoffre([coffre[0]], gemini), undefined);
});
