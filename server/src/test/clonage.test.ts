import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  Agent,
  CONSIGNE_ASSISTANT_GLOBAL,
  CONSIGNE_CADRAGE,
  Card,
  DOSSIER_DE_LA_SOURCE,
  OUTILS_REA_DU_CLONAGE,
  Project,
  REGLE_DEMANDE_DE_CLONAGE,
  SERVEUR_MCP_REA,
  barreDuCahier,
  cahierNeuf,
  consigneDuCahier,
  consigneDuClonage,
  demandeDeRepriseDuCahier,
  demandeDuPremierTourDuClonage,
  genreDevine,
  lireAvancement,
  lireGesteProjet,
  lireSourceFournie,
  majDeLaSource,
  nomDeFichierDeSource,
  phasesDuCahier,
} from '@beluga/shared';

/*
 * LE CLONAGE D'UN PRODUIT EXISTANT (décision du 14.10.2026) : une source à
 * cloner fait naître un cahier des charges qui commence par une phase
 * « Source » (vrai clone ou inspiration, identité reprise à chaque clone), et
 * seul l'agent de ce cahier reçoit REA. Un cahier ordinaire ne change pas.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'clonage-'));
process.env.BELUGA_DATA = bacASable;
/* Un REA factice : le branchement se juge sans les 230 Mo du vrai. */
const reaFactice = fs.mkdtempSync(path.join(os.tmpdir(), 'rea-factice-'));
fs.mkdirSync(path.join(reaFactice, 'node_modules/rea-agents/scripts'), { recursive: true });
fs.writeFileSync(path.join(reaFactice, 'node_modules/rea-agents/scripts/rea.mjs'), '');
process.env.BELUGA_REA_DIR = reaFactice;

const store = await import('../store.js');
const { createCard, callTool, writeMcpConfig } = await import('../tools.js');
const { estAgentDuCahier, estAgentDuClonage, consigneSystemeDuCahier, ouvrirLeCahierDesCharges } = await import(
  '../cahier-des-charges.js'
);
const { serveurMcpRea } = await import('../rea.js');

/* ------------------------------------------------------------------ */
/* LA RÈGLE PURE                                                       */
/* ------------------------------------------------------------------ */

test('la source fournie se lit : lien, nom en clair, fichiers — rien de fourni, pas de source', () => {
  assert.equal(lireSourceFournie(undefined), undefined);
  assert.equal(lireSourceFournie('  '), undefined);
  assert.equal(lireSourceFournie({ url: '', fichiers: [] }), undefined);

  const site = lireSourceFournie('notion.so');
  assert.equal(site?.url, 'https://notion.so/');
  assert.equal(site?.genre, 'site');
  assert.equal(site?.analyse, 'a-faire');

  const nomme = lireSourceFournie("l'appli Android de Strava");
  assert.equal(nomme?.url, undefined);
  assert.equal(nomme?.nom, "l'appli Android de Strava");
  assert.equal(nomme?.genre, 'android');

  const apk = lireSourceFournie({ fichiers: ['/tmp/x/app.apk'] });
  assert.equal(apk?.genre, 'android');
  assert.equal(lireSourceFournie({ url: 'javascript:alert(1)' })?.url, undefined);
});

test('le genre se devine du fichier, puis du lien', () => {
  assert.equal(genreDevine({ fichiers: ['a.ipa'] }), 'iphone');
  assert.equal(genreDevine({ fichiers: ['app.asar'] }), 'bureau');
  assert.equal(genreDevine({ url: 'https://play.google.com/store/apps/details?id=x' }), 'android');
  assert.equal(genreDevine({ url: 'https://apps.apple.com/app/x' }), 'iphone');
  assert.equal(genreDevine({ url: 'https://store.steampowered.com/app/1' }), 'jeu');
  assert.equal(genreDevine({}), 'autre');
});

test('un cahier à source commence par « Source » ; un cahier ordinaire ne la voit jamais', () => {
  const source = lireSourceFournie('https://exemple.fr')!;
  assert.equal(cahierNeuf(source).phase, 'source');
  assert.equal(cahierNeuf().phase, 'vision');
  assert.equal(cahierNeuf().source, undefined);
  assert.deepEqual(phasesDuCahier(false)[0], 'vision');
  assert.deepEqual(phasesDuCahier(true)[0], 'source');
  assert.doesNotMatch(consigneDuCahier('/c', '/p'), /Source →/);
  assert.match(consigneDuCahier('/c', '/p', true), /Source → Vision/);

  /* La phase « source » est refusée à un cahier ordinaire, acceptée à un cahier à source. */
  assert.equal(lireAvancement({ faites: 0, phase: 'source' }, cahierNeuf(), 1).ok, false);
  assert.equal(lireAvancement({ faites: 0, phase: 'source' }, cahierNeuf(source), 1).ok, true);

  /* La barre du volet reste la même : trois étapes. */
  assert.deepEqual(barreDuCahier(cahierNeuf(source)), barreDuCahier(cahierNeuf()));
});

test('l’avancement garde la source et y pose mode, identité et analyse', () => {
  const source = lireSourceFournie('https://exemple.fr')!;
  const lu = lireAvancement(
    { faites: 1, phase: 'source', mode: 'clone', identiteReprise: false, analyse: 'en-cours' },
    cahierNeuf(source),
    3,
  );
  assert.ok(lu.ok);
  assert.equal(lu.cahier.source?.url, 'https://exemple.fr/');
  assert.equal(lu.cahier.source?.mode, 'clone');
  assert.equal(lu.cahier.source?.identiteReprise, false);
  assert.equal(lu.cahier.source?.analyse, 'en-cours');

  /* Une écriture sans ces champs ne les efface pas. */
  const suite = lireAvancement({ faites: 2, phase: 'vision' }, lu.cahier, 4);
  assert.ok(suite.ok);
  assert.equal(suite.cahier.source?.mode, 'clone');

  /* L'identité n'a de sens que pour un clone. */
  assert.equal(majDeLaSource(lu.cahier.source, { mode: 'inspiration' })?.identiteReprise, undefined);
  assert.equal(majDeLaSource(undefined, { mode: 'clone' }), undefined);
  assert.equal(majDeLaSource(source, { mode: 'n-importe' })?.mode, undefined);
});

test('les consignes : vrai clone ou inspiration d’abord, identité à chaque clone, coffre pour les accès', () => {
  const source = lireSourceFournie({ url: 'https://exemple.fr', fichiers: [`${DOSSIER_DE_LA_SOURCE}/a.apk`] })!;
  const consigne = consigneDuClonage(source, '/srv/p', '/rea/SKILL.md');
  assert.match(consigne, /VRAI CLONE/);
  assert.match(consigne, /S'INSPIRER PROFONDÉMENT|INSPIRER PROFONDÉMENT/);
  assert.match(consigne, /à CHAQUE clone/);
  assert.match(consigne, /coffre_fort/);
  assert.match(consigne, /AUCUNE décompilation/);
  assert.match(consigne, /## Source analysée/);
  /* Le genre, que l'agent peut corriger, n'est PAS dans la consigne système : elle reste stable. */
  assert.doesNotMatch(consigne, /genre deviné à la création/);
  assert.match(demandeDuPremierTourDuClonage({ name: 'X' }, source), /genre deviné à la création/);

  const reprise = demandeDeRepriseDuCahier(
    { ...cahierNeuf(source), source: { ...source, mode: 'clone', identiteReprise: true, analyse: 'terminee' } },
    '# doc',
  );
  assert.match(reprise, /vrai clone, identité reprise/);
  assert.match(reprise, /analyse terminée/);
  assert.doesNotMatch(demandeDeRepriseDuCahier(cahierNeuf(), '# doc'), /LA SOURCE/);
});

test('la règle de reconnaissance est dans le cadrage et l’assistant, et distingue un simple détail', () => {
  assert.ok(CONSIGNE_CADRAGE.includes(REGLE_DEMANDE_DE_CLONAGE));
  assert.ok(CONSIGNE_ASSISTANT_GLOBAL.includes(REGLE_DEMANDE_DE_CLONAGE));
  assert.match(REGLE_DEMANDE_DE_CLONAGE, /n'est PAS un clonage/);
});

test('project_manage creer : une source coche d’office le cahier des charges', () => {
  const base = { action: 'creer', nom: 'Clone', sansAdresse: true };
  const lu = lireGesteProjet({ ...base, cahierDesCharges: false, source: { url: 'https://exemple.fr' } });
  assert.ok(lu.ok && lu.demande.geste === 'creer');
  if (lu.ok && lu.demande.geste === 'creer') {
    assert.equal(lu.demande.cahierDesCharges, true);
    assert.equal(lu.demande.source?.url, 'https://exemple.fr/');
  }
  // Sans source, un projet neuf garde son cahier, obligatoire (18/11/2026) — mais aucune source.
  const sans = lireGesteProjet({ ...base, cahierDesCharges: false });
  assert.ok(sans.ok && sans.demande.geste === 'creer' && sans.demande.cahierDesCharges === true && !sans.demande.source);
});

test('un nom de fichier fourni perd tout chemin et tout caractère risqué', () => {
  assert.equal(nomDeFichierDeSource('../../etc/passwd'), 'passwd');
  assert.equal(nomDeFichierDeSource('C:\\x\\Mon app.apk'), 'Mon app.apk');
  assert.equal(nomDeFichierDeSource('..'), 'fichier');
});

/* ------------------------------------------------------------------ */
/* SUR UNE VRAIE BASE                                                  */
/* ------------------------------------------------------------------ */

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'projet-clone-'));
const projet = store.saveProject(
  Project.parse({ id: 'p-clone', name: 'Clone', path: dossier, createdAt: Date.now(), updatedAt: Date.now() }),
);

function cadrageDe(cardId: string): Agent {
  return store.saveAgent(
    Agent.parse({
      id: store.newId(),
      projectId: projet.id,
      cardId,
      role: 'cadrage',
      title: 'cadrage',
      run: { engine: 'claude', thinking: 'medium' },
      status: 'idle',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

function carte(source?: ReturnType<typeof lireSourceFournie>): Card {
  const c = createCard(projet.id, { title: 'Cahier des charges', origin: 'user', cadrage: true });
  return store.saveCard({ ...c, cahierDesCharges: cahierNeuf(source) });
}

test('REA n’est branché que sur l’agent d’un cahier à source', () => {
  const aSource = cadrageDe(carte(lireSourceFournie('https://exemple.fr')).id);
  const ordinaire = cadrageDe(carte().id);
  const quelconque = cadrageDe(createCard(projet.id, { title: 'Autre', origin: 'user', cadrage: true }).id);

  assert.equal(estAgentDuClonage(aSource.id), true);
  assert.equal(estAgentDuClonage(ordinaire.id), false);
  assert.equal(estAgentDuCahier(ordinaire.id), true);
  assert.equal(estAgentDuClonage(quelconque.id), false);

  assert.match(consigneSystemeDuCahier(aSource.id), /PRODUIT EXISTANT/);
  assert.doesNotMatch(consigneSystemeDuCahier(ordinaire.id), /PRODUIT EXISTANT/);

  const rea = serveurMcpRea();
  assert.ok(rea);
  assert.equal(rea!.env.REA_OUTILS_PERMIS, OUTILS_REA_DU_CLONAGE.join(','));
  assert.equal(rea!.env.REA_MCP_INPUT_SCHEMA_PROFILE, 'compact');
  assert.match(rea!.args[0]!, /rea-mcp\.mjs$/);

  /* La configuration écrite : le pont du démon toujours, REA seulement si on le passe. */
  const avec = path.join(bacASable, 'mcp-avec.json');
  const sans = path.join(bacASable, 'mcp-sans.json');
  writeMcpConfig(avec, 't', 'u', aSource.id, '/pont.mjs', 'tour', { [SERVEUR_MCP_REA]: rea! });
  writeMcpConfig(sans, 't', 'u', ordinaire.id, '/pont.mjs', 'tour');
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(avec, 'utf8')).mcpServers).sort(), ['beluga', 'rea']);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(sans, 'utf8')).mcpServers), ['beluga']);
});

test('REA absent de la machine : aucun serveur, et rien ne casse', () => {
  const avant = process.env.BELUGA_REA_DIR;
  process.env.BELUGA_REA_DIR = path.join(bacASable, 'nulle-part');
  try {
    assert.equal(serveurMcpRea(), undefined);
  } finally {
    process.env.BELUGA_REA_DIR = avant;
  }
});

test('l’outil du cahier enregistre le mode et l’identité sur la carte', async () => {
  const c = carte(lireSourceFournie('https://exemple.fr'));
  const agent = cadrageDe(c.id);
  const ctx = { agentId: agent.id, projectId: projet.id, role: 'cadrage' as const, cardId: c.id };
  const r = await callTool(ctx, 'cahier_des_charges', {
    document: '# Cahier\n\n## Source analysée\nÀ voir.',
    faites: 2,
    phase: 'source',
    mode: 'clone',
    identiteReprise: true,
  });
  assert.equal(r.ok, true, r.text);
  const lue = store.getCard(c.id)!;
  assert.equal(lue.cahierDesCharges?.source?.mode, 'clone');
  assert.equal(lue.cahierDesCharges?.source?.identiteReprise, true);
});

test('la naissance d’un cahier à source recopie les fichiers fournis dans le projet', async () => {
  const fourni = path.join(bacASable, 'mon app.apk');
  fs.writeFileSync(fourni, 'apk');
  const source = lireSourceFournie({ url: 'https://exemple.fr', fichiers: [fourni, path.join(bacASable, 'absent.apk')] })!;
  const nee = await ouvrirLeCahierDesCharges(projet, 'un clone', source);
  assert.ok(nee?.cahierDesCharges?.source);
  assert.deepEqual(nee!.cahierDesCharges!.source!.fichiers, [`${DOSSIER_DE_LA_SOURCE}/mon app.apk`]);
  assert.equal(nee!.cahierDesCharges!.phase, 'source');
  assert.equal(fs.readFileSync(path.join(dossier, DOSSIER_DE_LA_SOURCE, 'mon app.apk'), 'utf8'), 'apk');
});
