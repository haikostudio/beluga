import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * UNE CAPTURE ÉCRITE PENDANT LE TOUR SE RANGE TOUTE SEULE EN PIÈCE JOINTE.
 *
 * Un script d'essai écrit son PNG sans que l'agent le relise : la capture doit
 * pourtant rejoindre les pièces jointes (même table, même dossier de stockage)
 * et le message du tour, pour que la bande du fil l'affiche en direct.
 */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'captures-auto-'));
process.env.BELUGA_DATA = bacASable;

const { Agent, Message, Project, nomSurDisque } = await import('@beluga/shared');
const store = await import('../store.js');
const { repererLesCaptures, imageDeCeTour } = await import('../captures-auto.js');
const { PATHS } = await import('../config.js');

const PNG_MINIMAL = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000a4944415478da6360000002000155a2497e0000000049454e44ae426082',
  'hex',
);
/** Un PNG différent à chaque appel (octets de fin variables) : empreinte distincte. */
const pngUnique = (n: number) => Buffer.concat([PNG_MINIMAL, Buffer.from(String(n))]);

const dossierProjet = fs.mkdtempSync(path.join(os.tmpdir(), 'projet-auto-'));

function poser() {
  const projet = store.saveProject(
    Project.parse({ id: 'projet-auto', name: 'Projet auto', path: dossierProjet, createdAt: store.now(), updatedAt: store.now() }),
  );
  const agent = store.saveAgent(
    Agent.parse({
      id: 'agent-auto',
      projectId: projet.id,
      cardId: 'carte-auto',
      role: 'task',
      title: 'Agent de test',
      run: { engine: 'claude' },
      workdir: dossierProjet,
      status: 'running',
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
  );
  store.saveMessage(Message.parse({ id: 'message-auto', agentId: agent.id, role: 'assistant', createdAt: store.now() }));
  return { projet, agent };
}

function contexte(projet: any, agent: any, debut: number, jointes: any[]) {
  return {
    projectId: projet.id,
    projectPath: projet.path,
    workdir: agent.workdir,
    cardId: agent.cardId,
    agentId: agent.id,
    debutDuTour: debut,
    surJointe: (piece: any, fichier: string) => jointes.push({ ...piece, fichier }),
    vivant: () => true,
  };
}

async function attendre(condition: () => boolean, ms = 8000) {
  const fin = Date.now() + ms;
  while (!condition() && Date.now() < fin) await new Promise((r) => setTimeout(r, 50));
}

test('un PNG nommé dans la commande est rangé en pièce jointe et rejoint le message', async () => {
  const { projet, agent } = poser();
  const debut = Date.now();
  const fichier = path.join(dossierProjet, 'tmp', 'accueil.png');
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  fs.writeFileSync(fichier, pngUnique(1));
  const jointes: any[] = [];
  repererLesCaptures({}, contexte(projet, agent, debut, jointes), { textes: [`node essai.mjs --out=${fichier}`], balayer: false });
  await attendre(() => jointes.length === 1);
  assert.equal(jointes.length, 1);
  assert.equal(jointes[0].mime, 'image/png');
  assert.ok(fs.existsSync(path.join(PATHS.attachments, nomSurDisque(jointes[0]))), 'le fichier est recopié dans les pièces jointes');
  assert.ok(store.listAttachments(projet.id).some((p) => p.id === jointes[0].id));
});

test('un PNG écrit par un script sans être nommé est retrouvé par le balayage', async () => {
  const { projet, agent } = poser();
  const debut = Date.now();
  const fichier = path.join(dossierProjet, 'captures', 'liste.png');
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  fs.writeFileSync(fichier, pngUnique(2));
  const jointes: any[] = [];
  repererLesCaptures({}, contexte(projet, agent, debut, jointes), { textes: ['node essai.mjs'], balayer: true });
  await attendre(() => jointes.some((j) => j.name === 'liste.png'));
  assert.ok(jointes.some((j) => j.name === 'liste.png'));
});

test('un fichier ancien, hors racines ou sous node_modules n’est pas une capture', () => {
  const { agent } = poser();
  const ancien = path.join(dossierProjet, 'ancien.png');
  fs.writeFileSync(ancien, pngUnique(3));
  const vieux = new Date(Date.now() - 3600_000);
  fs.utimesSync(ancien, vieux, vieux);
  const ctx = { workdir: agent.workdir, projectPath: dossierProjet, debutDuTour: Date.now() };
  assert.equal(imageDeCeTour(ancien, ctx), null, 'écrit avant le tour');

  const dehors = path.join(fs.mkdtempSync(path.join('/var/tmp', 'dehors-')), 'x.png');
  fs.writeFileSync(dehors, pngUnique(4));
  assert.equal(imageDeCeTour(dehors, { ...ctx, debutDuTour: 0 }), null, 'hors des racines');

  const dep = path.join(dossierProjet, 'node_modules', 'lib', 'logo.png');
  fs.mkdirSync(path.dirname(dep), { recursive: true });
  fs.writeFileSync(dep, pngUnique(5));
  assert.equal(imageDeCeTour(dep, { ...ctx, debutDuTour: 0 }), null, 'dépendance');
});

test('la même image vue deux fois ne donne qu’une pièce', async () => {
  const { projet, agent } = poser();
  const debut = Date.now() - 1000;
  const fichier = path.join(dossierProjet, 'double.png');
  fs.writeFileSync(fichier, pngUnique(6));
  const jointes: any[] = [];
  const cle = {};
  const ctx = contexte(projet, agent, debut, jointes);
  repererLesCaptures(cle, ctx, { textes: [fichier], balayer: false });
  repererLesCaptures(cle, ctx, { textes: [`cat ${fichier}`], balayer: false, capture: fichier });
  await attendre(() => jointes.length >= 1);
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(jointes.filter((j) => j.name === 'double.png').length, 1);
});

test('l’image regardée par une étape se range même écrite avant le tour, et la pièce dit d’où elle vient', async () => {
  const { projet, agent } = poser();
  const ecran = path.join(os.tmpdir(), `apercu-1360x860-${Date.now()}.png`);
  fs.writeFileSync(ecran, pngUnique(7));
  const vieux = new Date(Date.now() - 3600_000);
  fs.utimesSync(ecran, vieux, vieux);
  const jointes: any[] = [];
  repererLesCaptures({}, contexte(projet, agent, Date.now(), jointes), {
    textes: [JSON.stringify({ file_path: ecran })],
    balayer: false,
    capture: ecran,
  });
  await attendre(() => jointes.length === 1);
  assert.equal(jointes.length, 1);
  assert.equal(jointes[0].name, path.basename(ecran));
  assert.equal(jointes[0].fichier, ecran, 'le chemin d’origine relie la pièce à son étape');
});

test('le balayage écarte les copies d’icônes d’une construction, pas les illustrations', async () => {
  const { projet, agent } = poser();
  const debut = Date.now() - 1000;
  const res = path.join(dossierProjet, 'android', 'app', 'src', 'main', 'res');
  for (const [i, rel] of ['mipmap-hdpi/ic_launcher.png', 'mipmap-xxhdpi/ic_launcher_round.png', 'drawable-port-hdpi/splash.png'].entries()) {
    fs.mkdirSync(path.dirname(path.join(res, rel)), { recursive: true });
    fs.writeFileSync(path.join(res, rel), pngUnique(700 + i));
  }
  const appIcon = path.join(dossierProjet, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-512@2x.png');
  fs.mkdirSync(path.dirname(appIcon), { recursive: true });
  fs.writeFileSync(appIcon, pngUnique(710));
  const illustration = path.join(dossierProjet, 'public', 'kipou-001.png');
  fs.mkdirSync(path.dirname(illustration), { recursive: true });
  fs.writeFileSync(illustration, pngUnique(711));
  const jointes: any[] = [];
  repererLesCaptures({}, contexte(projet, agent, debut, jointes), { textes: ['npx cap sync'], balayer: true });
  await attendre(() => jointes.some((j) => j.name === 'kipou-001.png'));
  await new Promise((r) => setTimeout(r, 800));
  assert.ok(jointes.some((j) => j.name === 'kipou-001.png'));
  assert.equal(jointes.filter((j) => /ic_launcher|splash|AppIcon/.test(j.name)).length, 0);
});

test('une capture au nom vague reçoit le titre de la carte', async () => {
  const { projet, agent } = poser();
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'vague-'));
  const fichier = path.join(dossier, 'screenshot.png');
  fs.writeFileSync(fichier, pngUnique(800));
  const jointes: any[] = [];
  repererLesCaptures(
    {},
    { ...contexte(projet, agent, Date.now() - 1000, jointes), titreDeCarte: 'Retouches de la vitrine' },
    { textes: [], balayer: false, capture: fichier },
  );
  await attendre(() => jointes.length === 1);
  assert.equal(jointes[0]?.name, 'retouches-de-la-vitrine-screenshot.png');
});

test('une copie de travail fraîche ne range pas les images du dépôt ; une image retouchée ou neuve, si', async () => {
  const { execFileSync } = await import('node:child_process');
  const { projet, agent } = poser();
  /* Le dépôt jetable vit dans le dossier temporaire du système, jamais sous le
     dépôt de Beluga (MEM-2738). */
  const depot = fs.mkdtempSync(path.join(os.tmpdir(), 'depot-captures-'));
  const g = (...args: string[]) => execFileSync('git', ['-C', depot, ...args], { stdio: 'ignore' });
  g('init', '-q');
  g('config', 'user.email', 'essai@beluga.test');
  g('config', 'user.name', 'Essai');
  fs.mkdirSync(path.join(depot, 'docs', 'captures'), { recursive: true });
  fs.writeFileSync(path.join(depot, 'docs', 'captures', 'boite.png'), pngUnique(900));
  fs.writeFileSync(path.join(depot, 'docs', 'captures', 'icone.png'), pngUnique(901));
  g('add', '-A');
  g('commit', '-q', '-m', 'images du projet');
  /* Le tour commence APRÈS : toutes les images ont une date « fraîche »
     (c'est ce que fait la création d'une copie de travail). */
  const debut = Date.now() - 5000;
  fs.writeFileSync(path.join(depot, 'docs', 'captures', 'icone.png'), pngUnique(902));
  fs.writeFileSync(path.join(depot, 'nouvelle.png'), pngUnique(903));
  const jointes: any[] = [];
  const ctx = { ...contexte(projet, agent, debut, jointes), workdir: depot };
  repererLesCaptures({}, ctx, { textes: [`ls ${path.join(depot, 'docs/captures/boite.png')}`], balayer: true });
  await attendre(() => jointes.length >= 2);
  await new Promise((r) => setTimeout(r, 1500));
  const noms = jointes.map((j) => j.name).sort();
  assert.deepEqual(noms, ['icone.png', 'nouvelle.png'], 'l’image inchangée du dépôt reste dehors');

  /* L'image REGARDÉE par l'étape se range toujours, même inchangée. */
  const vues: any[] = [];
  repererLesCaptures({}, { ...contexte(projet, agent, debut, vues), workdir: depot }, {
    textes: [],
    balayer: false,
    capture: path.join(depot, 'docs', 'captures', 'boite.png'),
  });
  await attendre(() => vues.length === 1);
  assert.equal(vues[0]?.name, 'boite.png');
});
