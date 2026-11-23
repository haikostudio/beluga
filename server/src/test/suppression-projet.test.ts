import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/*
 * LA SUPPRESSION DÉFINITIVE D'UN PROJET — ESSAIS SUR DES PROJETS JETABLES.
 *
 * Tout se passe dans un bac à sable : base temporaire, dossiers temporaires,
 * dépôt GitHub FACTICE (jamais un vrai `gh repo delete`). On prouve les trois
 * verrous (nom, agent au travail, sauvegarde), l'arrêt total quand GitHub
 * refuse, le refus d'un dossier hors zone, et qu'aucune ligne ne reste.
 */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'suppression-projet-'));
process.env.BELUGA_DATA = path.join(bacASable, 'data');
fs.mkdirSync(process.env.BELUGA_DATA, { recursive: true });

const { Agent, Attachment, Card, DeployRun, Message, Project } = await import('@beluga/shared');
const store = await import('../store.js');
const { getDb } = await import('../db.js');
const { apercuDeSuppression, dependancesReelles, lignesDuProjet, supprimerDefinitivementLeProjet } = await import('../suppression-projet.js');
const { PATHS } = await import('../config.js');
const { ecrireCopieDuProjet, purgerCopiesDeProjetsSupprimes, dossierDesCopiesDeProjetsSupprimes } = await import('../copie-de-projet-supprime.js');

type Deps = import('../suppression-projet.js').Dependances;

/** Un dossier git jetable. */
function dossierGit(nom: string): string {
  const dossier = path.join(bacASable, 'projets', nom);
  fs.mkdirSync(dossier, { recursive: true });
  execFileSync('git', ['init', '-q', dossier]);
  fs.writeFileSync(path.join(dossier, 'fichier.txt'), 'contenu');
  return dossier;
}

let compteur = 0;
function monterProjet(nom: string, extra: Record<string, unknown> = {}) {
  const dossier = dossierGit(nom);
  const projet = store.saveProject(
    Project.parse({
      id: `p-${nom}`,
      name: nom,
      path: dossier,
      gitRemote: `git@github.com:jetable/${nom}.git`,
      createdAt: store.now(),
      updatedAt: store.now(),
      ...extra,
    }),
  );
  store.saveCard(
    Card.parse({ id: `c-${nom}`, projectId: projet.id, column: 'archived', position: 1, title: 'Carte', run: { engine: 'claude' }, createdAt: store.now(), updatedAt: store.now() }),
  );
  store.saveAgent(
    Agent.parse({ id: `a-${nom}`, projectId: projet.id, cardId: `c-${nom}`, role: 'task', title: 'Agent', run: { engine: 'claude' }, status: 'done', createdAt: store.now(), updatedAt: store.now() }),
  );
  store.saveMessage(Message.parse({ id: `m-${nom}`, agentId: `a-${nom}`, role: 'user', content: 'bonjour', createdAt: store.now() }));
  store.saveAttachment(
    // Même contenu (même empreinte) dans tous les projets : chacun a pourtant SON fichier.
    Attachment.parse({ id: `pj-${nom}`, projectId: projet.id, name: 'a.png', mime: 'image/png', size: 1, sha: 'sha-commun', createdAt: store.now() }),
  );
  fs.mkdirSync(PATHS.attachments, { recursive: true });
  fs.writeFileSync(path.join(PATHS.attachments, `pj-${nom}-a.png`), `image de ${nom} ${compteur++}`);
  store.saveDeploy(DeployRun.parse({ id: `d-${nom}`, projectId: projet.id, state: 'success', startedAt: store.now(), steps: [] }));
  return projet;
}

/** Des dépendances factices : on note ce qui est appelé. */
function factices(surcharge: Partial<Deps> = {}) {
  const appels: string[] = [];
  const dep: Deps = {
    agentsAuTravail: async () => [],
    publicationEnCours: async () => false,
    sauvegarder: async () => {
      appels.push('sauvegarde');
      return 'sauvegarde-factice.tar.gz';
    },
    supprimerDepot: async (depot) => {
      appels.push(`depot:${depot.proprietaire}/${depot.nom}`);
      return { ok: true };
    },
    retirerAdresse: async () => {
      appels.push('adresse');
      return { ok: true, detail: 'retirée' };
    },
    dossiersProteges: () => [path.join(bacASable, 'protege')],
    copiesDeTravail: async () => [],
    estUnDepotGit: (d) => fs.existsSync(path.join(d, '.git')),
    effacementPossible: async () => null,
    effacerDossier: async (d) => {
      appels.push(`dossier:${path.basename(d)}`);
      fs.rmSync(d, { recursive: true, force: true });
    },
    // Les VRAIS fichiers du bac à sable : on prouve qu'un voisin garde les siens.
    effacerPiecesJointes: async (pieces) => {
      appels.push(`pieces:${pieces.length}`);
      return dependancesReelles().effacerPiecesJointes(pieces);
    },
    ...surcharge,
  };
  return { dep, appels };
}

function lignesRestantes(id: string): string[] {
  const db = getDb();
  const restes: string[] = [];
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
  for (const { name } of tables) {
    const cols = (db.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes('project_id')) continue;
    const n = (db.prepare(`SELECT count(*) n FROM "${name}" WHERE project_id = ?`).get(id) as { n: number }).n;
    if (n) restes.push(`${name}:${n}`);
  }
  return restes;
}

test('un nom qui n’est pas EXACTEMENT celui du projet est refusé, rien ne part', async () => {
  const projet = monterProjet('alpha');
  const { dep, appels } = factices();
  for (const faux of ['Alpha', 'alpha ', '', 'alph']) {
    const res = await supprimerDefinitivementLeProjet(projet.id, faux, dep);
    assert.equal(res.ok, false, `« ${faux} » ne doit pas suffire`);
  }
  const sansNom = await supprimerDefinitivementLeProjet(projet.id, undefined, dep);
  assert.equal(sansNom.ok, false);
  assert.deepEqual(appels, [], 'ni sauvegarde, ni GitHub, ni dossier');
  assert.ok(store.getProject(projet.id));
  assert.ok(fs.existsSync(projet.path));
});

test('un agent au travail, ou une mise en ligne en cours, bloque tout', async () => {
  const projet = monterProjet('bravo');
  const agent = factices({ agentsAuTravail: async () => ['Ma tâche'] });
  const r1 = await supprimerDefinitivementLeProjet(projet.id, 'bravo', agent.dep);
  assert.equal(r1.ok, false);
  assert.match(r1.erreur ?? '', /agent travaille/i);
  const pub = factices({ publicationEnCours: async () => true });
  const r2 = await supprimerDefinitivementLeProjet(projet.id, 'bravo', pub.dep);
  assert.equal(r2.ok, false);
  assert.match(r2.erreur ?? '', /mise en ligne/i);
  assert.deepEqual([...agent.appels, ...pub.appels], []);
  assert.ok(store.getProject(projet.id));
});

test('l’aperçu donne les vrais nombres et la raison d’un refus', async () => {
  const projet = monterProjet('charlie');
  const { dep } = factices({ agentsAuTravail: async () => ['Tâche en cours'] });
  const apercu = await apercuDeSuppression(projet.id, dep);
  assert.equal(apercu.depot, 'jetable/charlie');
  assert.equal(apercu.cartes, 1);
  assert.equal(apercu.conversations, 1);
  assert.equal(apercu.piecesJointes, 1);
  assert.equal(apercu.miseEnLigne, 1);
  assert.match(apercu.refus ?? '', /agent travaille/i);
});

test('GitHub qui refuse arrête tout : sauvegarde faite, mais dossier et base intacts', async () => {
  const projet = monterProjet('delta');
  const { dep, appels } = factices({
    supprimerDepot: async () => ({ ok: false, erreur: 'HTTP 403 : delete_repo manquant' }),
  });
  const res = await supprimerDefinitivementLeProjet(projet.id, 'delta', dep);
  assert.equal(res.ok, false);
  assert.match(res.erreur ?? '', /rien d’autre n’a été touché/);
  assert.deepEqual(appels, ['sauvegarde']);
  assert.ok(fs.existsSync(projet.path), 'le dossier est resté');
  assert.ok(store.getProject(projet.id), 'le projet est resté');
  assert.equal(store.listCards(projet.id).length, 1);
  assert.ok(lignesRestantes(projet.id).length > 0);
});

test('une sauvegarde qui échoue empêche tout, même GitHub', async () => {
  const projet = monterProjet('echo');
  const { dep, appels } = factices({
    sauvegarder: async () => {
      throw new Error('disque plein');
    },
  });
  const res = await supprimerDefinitivementLeProjet(projet.id, 'echo', dep);
  assert.equal(res.ok, false);
  assert.deepEqual(appels, []);
  assert.ok(store.getProject(projet.id));
});

test('un dossier protégé, ou parent d’un autre projet, est refusé avant toute écriture', async () => {
  // Le dossier du projet EST un dossier protégé.
  const protege = monterProjet('foxtrot');
  const a = factices({ dossiersProteges: () => [protege.path] });
  const r1 = await supprimerDefinitivementLeProjet(protege.id, 'foxtrot', a.dep);
  assert.equal(r1.ok, false);
  assert.deepEqual(a.appels, []);

  // Le dossier du projet CONTIENT le dossier d'un autre projet (le piège du parent).
  const parent = store.saveProject(
    Project.parse({ id: 'p-parent', name: 'parent', path: path.join(bacASable, 'projets'), createdAt: store.now(), updatedAt: store.now() }),
  );
  fs.mkdirSync(path.join(parent.path, '.git'), { recursive: true });
  const b = factices();
  const r2 = await supprimerDefinitivementLeProjet(parent.id, 'parent', b.dep);
  assert.equal(r2.ok, false);
  assert.match(r2.erreur ?? '', /autre projet/);
  assert.deepEqual(b.appels, []);
  assert.ok(fs.existsSync(protege.path));
  store.mettreProjetDeCote(parent.id);
});

test('un dossier qui n’est pas un dépôt git n’est pas effacé', async () => {
  const projet = monterProjet('golf');
  fs.rmSync(path.join(projet.path, '.git'), { recursive: true, force: true });
  const { dep, appels } = factices();
  const res = await supprimerDefinitivementLeProjet(projet.id, 'golf', dep);
  assert.equal(res.ok, false);
  assert.match(res.erreur ?? '', /dépôt git/);
  assert.deepEqual(appels, []);
});

test('la suppression complète efface dépôt, dossier et toutes les lignes — et rien d’autre', async () => {
  const cible = monterProjet('hotel');
  const voisin = monterProjet('india');
  // Un accès du coffre-fort lié au projet : il survit, détaché.
  getDb()
    .prepare("INSERT INTO secrets (id, nom, type, project_id, champs, note, cree_le, modifie_le) VALUES ('s1','Accès hotel','mot_de_passe',?, '{}', '', 1, 1)")
    .run(cible.id);
  const { dep, appels } = factices();

  const res = await supprimerDefinitivementLeProjet(cible.id, 'hotel', dep);
  assert.equal(res.ok, true, res.erreur);
  assert.deepEqual(appels.filter((a) => !a.startsWith('adresse')), ['sauvegarde', 'depot:jetable/hotel', 'dossier:hotel', 'pieces:1']);
  assert.equal(fs.existsSync(path.join(PATHS.attachments, 'pj-hotel-a.png')), false, 'le fichier de sa pièce jointe est effacé');
  assert.equal(fs.existsSync(path.join(PATHS.attachments, 'pj-india-a.png')), true, 'celui du voisin, même contenu, reste');
  assert.equal(fs.existsSync(cible.path), false);
  assert.equal(store.getProject(cible.id), null);
  assert.deepEqual(lignesRestantes(cible.id), [], 'aucune table ne garde une ligne de ce projet');
  assert.equal(store.getCard(`c-hotel`), null);
  assert.equal(store.getAgent(`a-hotel`), null);
  const db = getDb();
  assert.equal((db.prepare("SELECT count(*) n FROM messages WHERE agent_id = 'a-hotel'").get() as any).n, 0);
  const secret = db.prepare("SELECT project_id FROM secrets WHERE id = 's1'").get() as { project_id: string | null };
  assert.equal(secret.project_id, null, 'le coffre-fort garde la fiche, détachée');

  // Le voisin est intact.
  assert.ok(store.getProject(voisin.id));
  assert.ok(fs.existsSync(voisin.path));
  assert.equal(store.listCards(voisin.id).length, 1);
  assert.equal((db.prepare('SELECT count(*) n FROM messages WHERE agent_id = ?').get('a-india') as any).n, 1);
});

test('un dépôt déjà absent de GitHub n’est pas une panne', async () => {
  const projet = monterProjet('juliet');
  const { dep } = factices({ supprimerDepot: async () => ({ ok: true, absent: true }) });
  const res = await supprimerDefinitivementLeProjet(projet.id, 'juliet', dep);
  assert.equal(res.ok, true, res.erreur);
  assert.ok(res.etapes.some((e) => e.titre === 'Dépôt GitHub' && e.detail === 'déjà absent'));
});

test('Beluga Build ne se supprime pas lui-même', async () => {
  const soi = monterProjet('kilo', { isSelf: true });
  const { dep, appels } = factices();
  const res = await supprimerDefinitivementLeProjet(soi.id, 'kilo', dep);
  assert.equal(res.ok, false);
  assert.deepEqual(appels, []);
});

test('la commande ne passe que par la porte gardée : project.delete, lui, ne fait toujours que mettre de côté', () => {
  const ici = path.dirname(new URL(import.meta.url).pathname);
  const source = fs.readFileSync(path.resolve(ici, '../../src/ws.ts'), 'utf8');
  const debut = source.indexOf("case 'project.delete':");
  const bloc = source.slice(debut, source.indexOf('case ', debut + 10));
  assert.match(bloc, /mettreProjetDeCote/);
  assert.doesNotMatch(bloc, /supprimerDefinitivement|DELETE|delete[A-Z]/);
  // Et la nouvelle commande exige le nom confirmé.
  const porte = source.slice(source.indexOf("case 'project.supprimerDefinitivement':"));
  assert.match(porte.slice(0, 400), /cmd\.nomConfirme/);
});

test('un dossier qu’on ne pourra pas effacer est refusé AVANT la copie, GitHub et l’adresse — et l’aperçu le dit', async () => {
  const projet = monterProjet('lima');
  const { dep, appels } = factices({
    effacementPossible: async (dossiers) => {
      assert.ok(dossiers.includes(projet.path));
      return `Le dossier ${projet.path} appartient au système.`;
    },
  });
  const res = await supprimerDefinitivementLeProjet(projet.id, 'lima', dep);
  assert.equal(res.ok, false);
  assert.match(res.erreur ?? '', /appartient au système/);
  assert.deepEqual(appels, [], 'ni copie, ni GitHub, ni adresse, ni dossier');
  assert.ok(store.getProject(projet.id));
  const apercu = await apercuDeSuppression(projet.id, dep);
  assert.match(apercu.refus ?? '', /appartient au système/);
});

test('un dossier déjà absent n’a pas besoin d’être effaçable : la suppression va au bout', async () => {
  const projet = monterProjet('mike');
  fs.rmSync(projet.path, { recursive: true, force: true });
  const { dep } = factices({ effacementPossible: async () => 'ne doit pas être demandé' });
  const res = await supprimerDefinitivementLeProjet(projet.id, 'mike', dep);
  assert.equal(res.ok, true, res.erreur);
  assert.equal(store.getProject(projet.id), null);
});

test('un second clic pendant la suppression est refusé, sans rien relancer', async () => {
  const projet = monterProjet('november');
  let lacher: () => void = () => undefined;
  const { dep, appels } = factices({
    sauvegarder: async () => {
      appels.push('sauvegarde');
      await new Promise<void>((r) => (lacher = r));
      return 'lente.tar';
    },
  });
  const premier = supprimerDefinitivementLeProjet(projet.id, 'november', dep);
  await new Promise((r) => setTimeout(r, 20));
  const second = await supprimerDefinitivementLeProjet(projet.id, 'november', dep);
  assert.equal(second.ok, false);
  assert.match(second.erreur ?? '', /déjà en cours/);
  lacher();
  assert.equal((await premier).ok, true);
  assert.deepEqual(appels.filter((a) => a === 'sauvegarde'), ['sauvegarde']);
});

test('la copie de secours ne prend QUE le projet : ses lignes et ses fichiers, relue avant de rendre la main', async () => {
  const projet = monterProjet('oscar');
  monterProjet('papa');
  const archive = await ecrireCopieDuProjet({ projet, tables: lignesDuProjet(projet.id), pieces: store.listAttachments(projet.id) });
  assert.equal(path.dirname(archive), dossierDesCopiesDeProjetsSupprimes());
  assert.match(path.basename(archive), /^projet-supprime-oscar-poscar-.*\.tar$/);
  const entrees = execFileSync('tar', ['-tf', archive], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const base = path.basename(archive, '.tar');
  assert.ok(entrees.includes(`${base}/donnees.json.gz`));
  assert.ok(entrees.includes(`${base}/LISEZ-MOI.txt`));
  assert.deepEqual(entrees.filter((e) => e.includes('/pieces-jointes/') && !e.endsWith('/')), [`${base}/pieces-jointes/pj-oscar-a.png`]);
  // Le fichier est bien LE contenu, pas un lien vers le disque.
  const extrait = fs.mkdtempSync(path.join(bacASable, 'extrait-'));
  execFileSync('tar', ['-xf', archive, '-C', extrait]);
  assert.match(fs.readFileSync(path.join(extrait, base, 'pieces-jointes', 'pj-oscar-a.png'), 'utf8'), /image de oscar/);
  const donnees = JSON.parse(
    (await import('node:zlib')).gunzipSync(fs.readFileSync(path.join(extrait, base, 'donnees.json.gz'))).toString('utf8'),
  );
  assert.equal(donnees.projet.id, projet.id);
  assert.equal(donnees.tables.cards.length, 1);
  assert.equal(donnees.tables.messages.length, 1);
  assert.equal(donnees.tables.attachments.length, 1);
  assert.ok(!JSON.stringify(donnees).includes('p-papa'), 'rien du voisin');
  // Aucun fichier d'atelier ne traîne.
  assert.deepEqual(fs.readdirSync(dossierDesCopiesDeProjetsSupprimes()).filter((n) => n.startsWith('.en-cours-')), []);
});

test('la vraie copie de secours sert la suppression de bout en bout', async () => {
  const projet = monterProjet('quebec');
  const { dep } = factices({ sauvegarder: dependancesReelles().sauvegarder });
  const res = await supprimerDefinitivementLeProjet(projet.id, 'quebec', dep);
  assert.equal(res.ok, true, res.erreur);
  const copie = res.etapes.find((e) => e.titre === 'Copie de secours du projet');
  assert.ok(copie?.detail && fs.existsSync(path.join(dossierDesCopiesDeProjetsSupprimes(), copie.detail)));
});

test('la purge efface les copies de plus de 15 jours, et rien d’autre', async () => {
  const dossier = path.join(bacASable, 'purge');
  fs.mkdirSync(dossier, { recursive: true });
  const jour = 24 * 3600 * 1000;
  const maintenant = Date.now();
  const poser = (nom: string, ageJours: number) => {
    const f = path.join(dossier, nom);
    fs.writeFileSync(f, 'x');
    const t = new Date(maintenant - ageJours * jour);
    fs.utimesSync(f, t, t);
  };
  poser('projet-supprime-vieux-aaaa-2026-09-01T00-00-00.tar', 16);
  poser('projet-supprime-recent-bbbb-2026-10-01T00-00-00.tar', 14);
  poser('beluga-2026-09-01T00-00-00.tar.gz', 40);
  poser('projet-supprime-autre-format.zip', 40);
  const effaces = await purgerCopiesDeProjetsSupprimes(maintenant, dossier);
  assert.deepEqual(effaces, ['projet-supprime-vieux-aaaa-2026-09-01T00-00-00.tar']);
  assert.deepEqual(fs.readdirSync(dossier).sort(), [
    'beluga-2026-09-01T00-00-00.tar.gz',
    'projet-supprime-autre-format.zip',
    'projet-supprime-recent-bbbb-2026-10-01T00-00-00.tar',
  ]);
  assert.deepEqual(await purgerCopiesDeProjetsSupprimes(maintenant, path.join(bacASable, 'absent')), []);
});
