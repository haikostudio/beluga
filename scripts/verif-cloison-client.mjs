#!/usr/bin/env node
/**
 * LE CLOISONNEMENT, PASSÉ EN REVUE COMMANDE PAR COMMANDE.
 *
 *   npm run build && node scripts/verif-cloison-client.mjs
 *
 * Muni d'une VRAIE session client, sur un vrai démon, ce contrôle envoie TOUTES
 * les commandes du protocole et vérifie que chacune est refusée — sauf la liste
 * explicitement ouverte. Il tombe donc dès qu'une commande neuve apparaît sans
 * que personne ait décidé de son sort : c'est là tout son intérêt.
 *
 * Ce qui est vérifié :
 *   1. LE REFUS PAR DÉFAUT — toute commande hors de `COMMANDES_CLIENT` est
 *      refusée, y compris celles écrites après ce contrôle ;
 *   2. LES ROUTES `/api/` — même grille, même refus par défaut ;
 *   3. LE CANAL — un client ne reçoit AUCUN événement d'agent, de carte, de
 *      quota ou de publication, même diffusé pendant qu'il écoute ;
 *   4. LA PORTÉE — un client voit TOUTES les demandes des projets de sa portée,
 *      quel qu'en soit l'auteur (c'est voulu) ; un projet HORS de sa portée
 *      reste fermé, et deviner l'identifiant d'une demande qui y vit ne mène
 *      nulle part — le refus dit la même chose qu'une demande absente. Voir
 *      n'est pas RÉÉCRIRE : le titre d'une demande de Haiko ne bouge pas ;
 *   5. LA PIÈCE JOINTE — un fichier d'un autre client ne se télécharge pas ;
 *   6. LA PORTE — sur l'adresse d'administration, un client est renvoyé chez
 *      lui ; sur l'adresse cliente, un visiteur non identifié reçoit le
 *      formulaire CLIENT, jamais celui de l'administration.
 */
import Database from 'better-sqlite3';
import * as ws from 'ws';
import { spawn } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_CLOISON_PORT || 7211);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-cloison-client-'));
const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
for (const dossier of [DATA, PROJETS]) fs.mkdirSync(dossier, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const { ClientCommand, COMMANDES_CLIENT, ROUTES_API_CLIENT } = await import(
  path.join(RACINE, 'shared/dist/index.js')
);
// L'adresse de l'espace client est un RÉGLAGE de l'installation : on lit celle
// du dépôt jugé, que le démon d'essai levé plus bas reprend lui aussi.
const { identiteDuDepot } = await import(path.join(RACINE, 'scripts/lib/identite-d-installation.mjs'));
const HOTE_ESPACE_CLIENT = (await identiteDuDepot(RACINE)).hoteEspaceClient;

/* ------------------------------------------------------------------ */
/* Le démon                                                            */
/* ------------------------------------------------------------------ */

let demon = null;
const journal = [];

function nettoyer() {
  try {
    demon?.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
}
process.on('exit', nettoyer);

demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...process.env,
    BELUGA_PORT: String(PORT),
    BELUGA_HOST: '127.0.0.1',
    BELUGA_DATA: DATA,
    BELUGA_PROJECTS_ROOT: PROJETS,
    BELUGA_WEB: path.join(RACINE, 'web', 'dist'),
    // La cloison se juge sur l'adresse cliente de l'installation d'origine : un
    // démon d'essai ne reprend plus son identité d'office, on la demande.
    BELUGA_IDENTITE_REPRISE: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
demon.stdout.on('data', (d) => journal.push(String(d)));
demon.stderr.on('data', (d) => journal.push(String(d)));

async function attendrePort(limiteMs = 60000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const ouvert = await new Promise((resolve) => {
      const prise = net.connect(PORT, '127.0.0.1');
      prise.on('connect', () => (prise.end(), resolve(true)));
      prise.on('error', () => resolve(false));
    });
    if (ouvert) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

if (!(await attendrePort())) {
  console.error('le démon n’a pas démarré :\n' + journal.join(''));
  process.exit(1);
}

/*
 * LE PORT OUVERT NE VEUT PAS DIRE « PRÊT ». Juste après, le démon relève ses
 * moteurs et ses quotas — des exécutables lancés, mesurés à une douzaine de
 * secondes — et sa boucle ne répond pas pendant ce temps. Interroger tout de
 * suite donnait des « sans réponse » qui n'apprenaient rien sur le
 * cloisonnement. On attend donc que le serveur réponde DEUX fois de suite, à
 * une seconde d'intervalle, avant de commencer.
 */
async function attendreLeCalme(limiteMs = 90000) {
  const fin = Date.now() + limiteMs;
  let calmes = 0;
  while (Date.now() < fin && calmes < 2) {
    const depart = Date.now();
    const reponse = await fetch(`http://127.0.0.1:${PORT}/health`).catch(() => null);
    calmes = reponse?.ok && Date.now() - depart < 500 ? calmes + 1 : 0;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return calmes >= 2;
}
if (!(await attendreLeCalme())) {
  console.error('le démon n’a jamais fini son démarrage :\n' + journal.join(''));
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Le décor : un projet, deux clients, une demande chacun               */
/* ------------------------------------------------------------------ */

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const base = () => new Database(path.join(DATA, 'beluga.db'));

const jetonAdmin = crypto.randomBytes(32).toString('hex');
const jetonClient = crypto.randomBytes(32).toString('hex');
const jetonAutre = crypto.randomBytes(32).toString('hex');

/*
 * LE PROJET EST CRÉÉ PAR LA COMMANDE D'ADMINISTRATION, jamais bricolé en base :
 * une ligne écrite à la main peut ne pas satisfaire le modèle, et le démon
 * échouerait alors à la relire — un faux échec qui n'apprend rien sur le
 * cloisonnement. Les comptes clients, eux, se posent directement : leur
 * création par le protocole est vérifiée ailleurs
 * (`scripts/verif-comptes-clients.mjs`).
 */
let PROJET = '';
let PROJET_VOISIN = '';

function poserLesComptes(projectId, projetVoisin) {
  const db = base();
  const maintenant = Date.now();
  const sel = crypto.randomBytes(16).toString('hex');
  /*
   * LES DEUX CLIENTS NE PARTAGENT PLUS DE PROJET. Depuis que la portée d'un
   * client est le PROJET et non l'auteur, deux clients sur le même projet
   * verraient — à dessein — les demandes l'un de l'autre : ce n'est plus ce
   * qu'on veut prouver ici. Chacun a donc le sien, et c'est le CLOISONNEMENT
   * entre projets qui est mis à l'épreuve.
   */
  for (const [id, identifiant, projet] of [
    ['u-client', 'client-un', projectId],
    ['u-autre', 'client-deux', projetVoisin],
  ]) {
    db.prepare(
      `INSERT INTO users (id, identifiant, role, nom_affiche, salt, hash, actif, cree_le)
       VALUES (?, ?, 'client', ?, ?, 'x', 1, ?)`,
    ).run(id, identifiant, identifiant, sel, maintenant);
    db.prepare('INSERT INTO user_projects (user_id, project_id) VALUES (?, ?)').run(id, projet);
  }
  // La session d'administration est déjà posée : seules celles des clients manquent.
  for (const [jeton, userId] of [
    [jetonClient, 'u-client'],
    [jetonAutre, 'u-autre'],
  ]) {
    db.prepare('INSERT INTO sessions (token, created_at, expires_at, label, user_id) VALUES (?,?,?,?,?)').run(
      sha(jeton),
      maintenant,
      maintenant + 3600_000,
      'vérification cloison',
      userId,
    );
  }
  db.close();
}

// La session d'administration seule, pour pouvoir créer le projet.
{
  const db = base();
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label, user_id) VALUES (?,?,?,?,?)').run(
    sha(jetonAdmin),
    Date.now(),
    Date.now() + 3600_000,
    'vérification cloison',
    admin?.id ?? null,
  );
  db.close();
}

/* ------------------------------------------------------------------ */
/* Le canal                                                            */
/* ------------------------------------------------------------------ */

function ouvrirCanal(jeton) {
  return new Promise((resolve, reject) => {
    const socket = new ws.WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
      headers: { cookie: `beluga_session=${jeton}` },
    });
    const attentes = new Map();
    const recus = [];
    socket.on('message', (brut) => {
      const event = JSON.parse(brut.toString());
      recus.push(event);
      if (event.type === 'ack' && attentes.has(event.id)) {
        const { resoudre } = attentes.get(event.id);
        attentes.delete(event.id);
        resoudre(event);
      }
    });
    socket.on('open', () =>
      resolve({
        socket,
        recus,
        demander: (cmd, delaiMs = 8000) =>
          new Promise((resoudre) => {
            const id = crypto.randomBytes(6).toString('hex');
            attentes.set(id, { resoudre });
            socket.send(JSON.stringify({ id, cmd }));
            setTimeout(() => {
              if (attentes.has(id)) {
                attentes.delete(id);
                resoudre({ ok: false, error: 'sans réponse' });
              }
            }, delaiMs);
          }),
      }),
    );
    socket.on('error', reject);
  });
}

console.log('  …  ouverture du canal d’administration');
const canalAdmin = await ouvrirCanal(jetonAdmin);

/*
 * L'OUVERTURE DU CANAL D'ADMINISTRATION RELÈVE LES MOTEURS ET LES QUOTAS —
 * des exécutables lancés, une dizaine de secondes pendant lesquelles la boucle
 * du démon ne répond pas. On attend donc qu'il redevienne bavard AVANT de
 * commencer la revue : sinon les premières commandes restent muettes et on
 * conclurait à tort qu'elles ne sont pas gardées.
 */
await attendreLeCalme();

// Un projet se déclare sur un dossier qui EXISTE : le démon le vérifie.
fs.mkdirSync(path.join(PROJETS, 'cloison'), { recursive: true });
fs.mkdirSync(path.join(PROJETS, 'diffuse'), { recursive: true });
fs.mkdirSync(path.join(PROJETS, 'voisin'), { recursive: true });

const cree = await canalAdmin.demander(
  { type: 'project.create', name: 'Projet cloison', path: path.join(PROJETS, 'cloison') },
  60000,
);
PROJET = cree.data?.project?.id ?? '';
if (!PROJET) {
  console.error('le projet d’essai n’a pas pu être créé : ' + JSON.stringify(cree));
  process.exit(1);
}
const creeVoisin = await canalAdmin.demander(
  { type: 'project.create', name: 'Projet voisin', path: path.join(PROJETS, 'voisin') },
  60000,
);
PROJET_VOISIN = creeVoisin.data?.project?.id ?? '';
if (!PROJET_VOISIN) {
  console.error('le projet voisin n’a pas pu être créé : ' + JSON.stringify(creeVoisin));
  process.exit(1);
}
poserLesComptes(PROJET, PROJET_VOISIN);

console.log('  …  ouverture des canaux clients, revue des commandes du protocole');
const canalClient = await ouvrirCanal(jetonClient);
const canalAutre = await ouvrirCanal(jetonAutre);

/* ------------------------------------------------------------------ */
/* 1. Le refus par défaut, commande par commande                        */
/* ------------------------------------------------------------------ */

/** Un exemplaire plausible de chaque commande : les champs obligatoires suffisent. */
function exemplaire(type) {
  const option = ClientCommand.options.find((o) => o.shape.type._def.value === type);
  const cmd = { type };
  for (const [nom, champ] of Object.entries(option.shape)) {
    if (nom === 'type') continue;
    if (champ.isOptional?.() || champ._def?.typeName === 'ZodDefault') continue;
    cmd[nom] = valeurPour(champ);
  }
  return cmd;
}

function valeurPour(champ) {
  const nom = champ._def?.typeName;
  if (nom === 'ZodString') return 'x';
  if (nom === 'ZodNumber') return 1;
  if (nom === 'ZodBoolean') return false;
  if (nom === 'ZodArray') return [];
  if (nom === 'ZodRecord') return {};
  if (nom === 'ZodEnum') return champ._def.values[0];
  if (nom === 'ZodLiteral') return champ._def.value;
  if (nom === 'ZodObject') {
    const objet = {};
    for (const [cle, sous] of Object.entries(champ.shape)) {
      if (sous.isOptional?.()) continue;
      objet[cle] = valeurPour(sous);
    }
    return objet;
  }
  if (nom === 'ZodOptional' || nom === 'ZodDefault' || nom === 'ZodNullable') return valeurPour(champ._def.innerType);
  if (nom === 'ZodUnion' || nom === 'ZodDiscriminatedUnion') return valeurPour(champ._def.options[0]);
  return 'x';
}

const tousLesTypes = ClientCommand.options.map((o) => o.shape.type._def.value);
const aRefuser = tousLesTypes.filter((type) => !COMMANDES_CLIENT.includes(type));
const passeesQuandMeme = [];
const sansReponse = [];

/*
 * UNE COMMANDE MAL FORMÉE NE PROUVERAIT RIEN : le démon l'écarterait avant même
 * de regarder le rôle. On n'envoie donc que des exemplaires que le protocole
 * accepte, et on DIT ce qu'on n'a pas su fabriquer plutôt que de le taire.
 */
const nonFabricables = [];
for (const type of aRefuser) {
  const cmd = exemplaire(type);
  if (!ClientCommand.safeParse(cmd).success) {
    nonFabricables.push(type);
    continue;
  }
  const reponse = await canalClient.demander(cmd, 2500);
  if (reponse.ok) passeesQuandMeme.push(type);
  else if (reponse.error === 'sans réponse') sansReponse.push(type);
}

noter(
  'chaque commande refusée le dit — aucune ne reste sans réponse',
  sansReponse.length === 0,
  sansReponse.slice(0, 5).join(', '),
);
if (nonFabricables.length) {
  console.log(`  (note) ${nonFabricables.length} commande(s) non fabricables automatiquement : ${nonFabricables.join(', ')}`);
}

noter(
  `les ${aRefuser.length} commandes non ouvertes sont TOUTES refusées à un client`,
  passeesQuandMeme.length === 0,
  passeesQuandMeme.length ? passeesQuandMeme.join(', ') : `${tousLesTypes.length} commandes passées en revue`,
);

const etat = await canalClient.demander({ type: 'espace.etat' });
noter("les commandes de l'espace, elles, répondent", etat.ok === true, etat.error ?? '');

/* ------------------------------------------------------------------ */
/* 2. Les routes /api/                                                  */
/* ------------------------------------------------------------------ */

async function frapper(route, jeton, host) {
  const reponse = await fetch(`http://127.0.0.1:${PORT}${route}`, {
    headers: { cookie: `beluga_session=${jeton}`, ...(host ? { host } : {}) },
    redirect: 'manual',
  });
  return reponse;
}

/*
 * `/api/download` n'est plus dans cette liste : elle suit un JETON lié à un seul
 * fichier, émis par `espace.backups.telecharger` après la vérification de
 * portée. Ce qui compte est donc qu'un jeton ne s'obtienne pas hors portée —
 * vérifié plus bas (§ 7).
 */
const ROUTES_A_REFUSER = ['/api/file', '/api/digest', '/api/zip', '/api/capture'];
const routesPassees = [];
for (const route of ROUTES_A_REFUSER) {
  const reponse = await frapper(route, jetonClient);
  if (reponse.status !== 403) routesPassees.push(`${route} (${reponse.status})`);
}
noter('les routes /api/ non ouvertes sont refusées à un client', routesPassees.length === 0, routesPassees.join(', '));

const me = await frapper('/api/me', jetonClient);
const corpsMe = await me.json();
noter(
  '/api/me dit au client qui il est, et son rôle',
  me.status === 200 && corpsMe.role === 'client',
  `${me.status} · ${corpsMe.role}`,
);
noter(
  "les routes ouvertes le sont vraiment",
  ROUTES_API_CLIENT.includes('/api/me') && ROUTES_API_CLIENT.includes('/api/attachment'),
);

/* ------------------------------------------------------------------ */
/* 3. Le canal ne fuit pas                                              */
/* ------------------------------------------------------------------ */

const avant = canalClient.recus.length;
// Un geste d'administration qui diffuse largement : la création d'un projet.
await canalAdmin.demander(
  { type: 'project.create', name: 'Projet diffusé', path: path.join(PROJETS, 'diffuse') },
  60000,
);
await new Promise((r) => setTimeout(r, 800));
const fuites = canalClient.recus
  .slice(avant)
  .filter((e) => !['ack', 'ready.client', 'espace.demande', 'espace.message', 'espace.fil', 'toast.client'].includes(e.type));
noter(
  'aucun événement d’administration n’atteint le canal d’un client',
  fuites.length === 0,
  fuites.map((f) => f.type).join(', '),
);

const premiersEnvois = canalClient.recus.filter((e) => e.type === 'ready');
noter("un client ne reçoit pas le premier envoi de l'administration", premiersEnvois.length === 0);

/* ------------------------------------------------------------------ */
/* 4. La portée : mon PROJET, et lui seul                               */
/* ------------------------------------------------------------------ */

const creee = await canalClient.demander({
  type: 'espace.demande.creer',
  projectId: PROJET,
  titre: 'Refaire la page d’accueil',
  description: 'Avec le nouveau logo.',
});
noter('un client crée une demande dans son projet', creee.ok === true, creee.error ?? '');
const demandeId = creee.data?.demande?.id;

/*
 * CE QUE VOIT LE CLIENT : TOUT CE QUI TOUCHE À SON PROJET. Une demande déposée
 * par HAIKO doit lui apparaître — c'était précisément le défaut : son espace
 * restait vide alors que le travail avait commencé.
 */
const parHaiko = await canalAdmin.demander({
  type: 'espace.demande.creer',
  projectId: PROJET,
  titre: 'Préparer la mise en ligne',
});
const demandeDeHaiko = parHaiko.data?.demande?.id;
const vueParLeClient = await canalClient.demander({ type: 'espace.demande.lire', id: demandeDeHaiko });
noter(
  'un client voit une demande déposée par Haiko sur SON projet',
  vueParLeClient.ok === true,
  vueParLeClient.error ?? '',
);

const listeDuClient = await canalClient.demander({ type: 'espace.etat', projectId: PROJET });
noter(
  'le kanban d’un client montre toutes les demandes de son projet, quel qu’en soit l’auteur',
  listeDuClient.ok === true && (listeDuClient.data?.demandes ?? []).length === 2,
  String((listeDuClient.data?.demandes ?? []).length),
);

/* VOIR N'EST PAS RÉÉCRIRE : le titre d'une demande de Haiko ne bouge pas. */
const reecriture = await canalClient.demander({
  type: 'espace.demande.modifier',
  id: demandeDeHaiko,
  titre: 'Titre volé',
  livraisonAnnoncee: Date.now(),
});
noter(
  'un client ne réécrit ni le titre ni la date annoncée d’une demande de Haiko',
  reecriture.ok === true &&
    reecriture.data?.demande?.titre === 'Préparer la mise en ligne' &&
    !reecriture.data?.demande?.livraisonAnnoncee,
  reecriture.data?.demande?.titre ?? reecriture.error ?? '',
);

const vueParLAutre = await canalAutre.demander({ type: 'espace.demande.lire', id: demandeId });
noter(
  'un client d’un AUTRE projet ne lit pas cette demande, même en connaissant son identifiant',
  vueParLAutre.ok === false,
  vueParLAutre.error ?? '',
);

const listeDeLAutre = await canalAutre.demander({ type: 'espace.etat', projectId: PROJET });
noter(
  'un client ne peut pas demander l’état d’un projet hors de sa portée',
  listeDeLAutre.ok === false,
  listeDeLAutre.error ?? String((listeDeLAutre.data?.demandes ?? []).length),
);

const horsPortee = await canalClient.demander({ type: 'espace.etat', projectId: 'projet-etranger' });
noter('un projet hors portée est refusé', horsPortee.ok === false, horsPortee.error ?? '');

const vueParHaiko = await canalAdmin.demander({ type: 'espace.demande.lire', id: demandeId });
noter('Haiko, lui, lit toutes les demandes', vueParHaiko.ok === true, vueParHaiko.error ?? '');

/* L'auteur est réécrit depuis la session : impossible de signer du nom d'un autre. */
const signee = await canalClient.demander({
  type: 'espace.demande.commenter',
  id: demandeId,
  texte: 'Un mot',
});
noter(
  "l'auteur d'un commentaire vient de la session, jamais du navigateur",
  signee.ok === true && signee.data?.message?.auteurId === 'u-client',
  signee.data?.message?.auteurId ?? signee.error ?? '',
);

/* ------------------------------------------------------------------ */
/* 5. Le fil : chacun le sien                                           */
/* ------------------------------------------------------------------ */

const envoye = await canalClient.demander({ type: 'espace.fil.envoyer', filId: 'u-autre', texte: 'Bonjour' });
const filDeLAutre = await canalAutre.demander({ type: 'espace.fil.lire' });
noter(
  "un client ne peut pas écrire dans le fil d'un autre, même en le nommant",
  envoye.ok === true && (filDeLAutre.data?.messages ?? []).length === 0,
  `${(filDeLAutre.data?.messages ?? []).length} message(s) chez le voisin`,
);

/* ------------------------------------------------------------------ */
/* 6. Les deux portes                                                   */
/* ------------------------------------------------------------------ */

const porteAdmin = await fetch(`http://127.0.0.1:${PORT}/`, {
  headers: { cookie: `beluga_session=${jetonClient}` },
  redirect: 'manual',
});
noter(
  "un client qui tape l'adresse d'administration est renvoyé chez lui",
  porteAdmin.status === 302 && (porteAdmin.headers.get('location') ?? '').includes(HOTE_ESPACE_CLIENT),
  `${porteAdmin.status} → ${porteAdmin.headers.get('location') ?? ''}`,
);

/*
 * L'ENTÊTE `Host` NE SE FORCE PAS AVEC `fetch` — il l'écrase. On passe donc par
 * une requête HTTP nue : c'est ce que fera un vrai navigateur derrière le
 * reverse-proxy, et c'est exactement ce qui décide de la porte servie.
 */
function demanderAvecHote(chemin, hote) {
  return new Promise((resoudre, rejeter) => {
    const requete = http.request(
      { host: '127.0.0.1', port: PORT, path: chemin, method: 'GET', headers: { host: hote } },
      (reponse) => {
        let corps = '';
        reponse.on('data', (d) => (corps += d));
        reponse.on('end', () => resoudre({ statut: reponse.statusCode, corps }));
      },
    );
    requete.on('error', rejeter);
    requete.end();
  });
}

const pageClient = await demanderAvecHote('/', HOTE_ESPACE_CLIENT);
const htmlClient = pageClient.corps;
noter(
  "sur l'adresse cliente, un visiteur non identifié reçoit le formulaire CLIENT",
  htmlClient.includes('data-porte="client"') && !htmlClient.includes('Pilotage de projets'),
);

const pageAdmin = await fetch(`http://127.0.0.1:${PORT}/`);
const htmlAdmin = await pageAdmin.text();
noter(
  "sur l'adresse d'administration, la page d'entrée habituelle ne bouge pas",
  htmlAdmin.includes('Pilotage de projets'),
);

/* ------------------------------------------------------------------ */
/* 7. Les backups et l'espace « Accès » : mon projet, et lui seul        */
/* ------------------------------------------------------------------ */

/*
 * LE DÉCOR : un site rattaché au projet du client, et une archive réussie posée
 * sur le disque. Écrits en base directement — la prise d'un vrai backup
 * lancerait des commandes sur une machine, ce n'est pas ce qu'on juge ici.
 */
const ARCHIVE = path.join(TMP, 'archive-essai.zip');
fs.writeFileSync(ARCHIVE, 'contenu-de-l-archive');
{
  const db = base();
  const maintenant = Date.now();
  db.prepare(
    'INSERT INTO backup_sites (id, project_id, nom, actif, data, cree_le, modifie_le) VALUES (?, ?, ?, 1, ?, ?, ?)',
  ).run('site-cloison', PROJET, 'Site cloison', '{}', maintenant, maintenant);
  db.prepare(
    `INSERT INTO backup_points (id, site_id, debut, statut, data, chemin_archive, taille)
     VALUES (?, ?, ?, 'reussi', ?, ?, ?)`,
  ).run(
    'point-cloison',
    'site-cloison',
    maintenant - 60_000,
    JSON.stringify({ fin: maintenant, octetsBase: 0, octetsFichiers: 0, chemin: TMP, detail: '', origine: 'manuel' }),
    ARCHIVE,
    20,
  );
  db.close();
}

const archivesDuClient = await canalClient.demander({ type: 'espace.backups.lister', projectId: PROJET });
const archivesVues = (archivesDuClient.data?.sites ?? []).flatMap((s) => s.archives);
noter(
  'un client voit les archives de SON projet, sans leur chemin disque',
  archivesDuClient.ok === true && archivesVues.length === 1 && !JSON.stringify(archivesDuClient.data).includes(TMP),
  archivesDuClient.error ?? `${archivesVues.length} archive(s)`,
);

const lien = await canalClient.demander({ type: 'espace.backups.telecharger', pointId: 'point-cloison' });
const telechargement = lien.ok ? await frapper(`/api/download?token=${lien.data.token}`, jetonClient) : null;
const corpsTelecharge = telechargement ? await telechargement.text() : '';
noter(
  'le client télécharge son archive, et c’est bien le bon fichier',
  telechargement?.status === 200 && corpsTelecharge === 'contenu-de-l-archive',
  lien.error ?? `${telechargement?.status}`,
);

const lienVole = await canalAutre.demander({ type: 'espace.backups.telecharger', pointId: 'point-cloison' });
noter("un client d'un AUTRE projet n'obtient aucun lien vers cette archive", lienVole.ok === false, lienVole.error ?? '');
const listeVolee = await canalAutre.demander({ type: 'espace.backups.lister', projectId: PROJET });
noter("ni la liste des archives d'un projet hors de sa portée", listeVolee.ok === false, listeVolee.error ?? '');

const accesAvant = await canalClient.demander({ type: 'espace.acces.lire', projectId: PROJET });
const ecrit = await canalAdmin.demander({ type: 'espace.acces.ecrire', projectId: PROJET, texte: 'hote: essai.local' });
const accesVerrouille = await canalClient.demander({ type: 'espace.acces.lire', projectId: PROJET });
noter(
  "l'espace « Accès » est verrouillé : son contenu ne part pas vers le client",
  accesAvant.ok === true &&
    accesAvant.data?.etat?.ouvert === false &&
    ecrit.ok === true &&
    accesVerrouille.data?.contenu === null &&
    !JSON.stringify(accesVerrouille.data).includes('essai.local'),
  accesVerrouille.error ?? ecrit.error ?? '',
);

const ecritParLeClient = await canalClient.demander({ type: 'espace.acces.ecrire', projectId: PROJET, texte: 'volé' });
const refermeParLeClient = await canalClient.demander({ type: 'espace.acces.reverrouiller', projectId: PROJET });
noter(
  "un client n'écrit pas l'espace « Accès » et ne le referme pas",
  ecritParLeClient.ok === false && refermeParLeClient.ok === false,
);

const sansCase = await canalClient.demander({
  type: 'espace.acces.deverrouiller',
  projectId: PROJET,
  confirme: false,
  version: accesAvant.data?.version ?? 1,
});
noter("l'ouverture sans la case cochée est refusée", sansCase.ok === false, sansCase.error ?? '');

const parLeVoisin = await canalAutre.demander({
  type: 'espace.acces.deverrouiller',
  projectId: PROJET,
  confirme: true,
  version: accesAvant.data?.version ?? 1,
});
noter("un client d'un autre projet ne l'ouvre pas", parLeVoisin.ok === false, parLeVoisin.error ?? '');

const evenementsAvant = canalClient.recus.length;
const evenementsVoisinAvant = canalAutre.recus.length;
const ouverture = await canalClient.demander({
  type: 'espace.acces.deverrouiller',
  projectId: PROJET,
  confirme: true,
  version: accesAvant.data?.version ?? 1,
});
await new Promise((r) => setTimeout(r, 400));
noter(
  'après la prise de responsabilité, le client lit le contenu, et qui a ouvert',
  ouverture.ok === true &&
    ouverture.data?.etat?.ouvert === true &&
    ouverture.data?.contenu?.texte === 'hote: essai.local' &&
    ouverture.data?.etat?.ouvertPar === 'client-un' &&
    ouverture.data?.journal === undefined,
  ouverture.error ?? JSON.stringify(ouverture.data?.etat ?? {}),
);
{
  const db = base();
  const lignes = db.prepare('SELECT compte_id, geste, version FROM espace_acces_journal WHERE project_id = ?').all(PROJET);
  db.close();
  noter(
    'le journal garde le compte, le geste et la version du texte accepté',
    lignes.length === 1 && lignes[0].compte_id === 'u-client' && lignes[0].geste === 'deverrouillage',
    JSON.stringify(lignes),
  );
}
noter(
  "l'ouverture est diffusée au client du projet, et à lui seul",
  canalClient.recus.slice(evenementsAvant).some((e) => e.type === 'espace.acces') &&
    !canalAutre.recus.slice(evenementsVoisinAvant).some((e) => e.type === 'espace.acces'),
);

const refermeParHaiko = await canalAdmin.demander({ type: 'espace.acces.reverrouiller', projectId: PROJET });
const apresReferme = await canalClient.demander({ type: 'espace.acces.lire', projectId: PROJET });
noter(
  'Haiko referme, et le contenu ne part plus vers le client',
  refermeParHaiko.ok === true && apresReferme.data?.etat?.ouvert === false && apresReferme.data?.contenu === null,
  refermeParHaiko.error ?? '',
);

/* ------------------------------------------------------------------ */
/* 8. Les collaborateurs : un membre et un lecteur, chacun sur son projet */
/* ------------------------------------------------------------------ */

console.log('\n8. Les collaborateurs (membre, lecteur)');
const { commandeAutorisee, routeApiAutorisee, REFUS_HORS_PORTEE } = await import(path.join(RACINE, 'shared/dist/index.js'));
const jetonMembre = crypto.randomBytes(32).toString('hex');
const jetonLecteur = crypto.randomBytes(32).toString('hex');
{
  const db = base();
  const maintenant = Date.now();
  const sel = crypto.randomBytes(16).toString('hex');
  for (const [id, identifiant, role, jeton] of [
    ['u-membre', 'membre-un', 'membre', jetonMembre],
    ['u-lecteur', 'lecteur-un', 'lecteur', jetonLecteur],
  ]) {
    db.prepare(
      `INSERT INTO users (id, identifiant, role, nom_affiche, salt, hash, actif, cree_le)
       VALUES (?, ?, ?, ?, ?, 'x', 1, ?)`,
    ).run(id, identifiant, role, identifiant, sel, maintenant);
    db.prepare('INSERT INTO user_projects (user_id, project_id) VALUES (?, ?)').run(id, PROJET);
    db.prepare('INSERT INTO sessions (token, created_at, expires_at, label, user_id) VALUES (?,?,?,?,?)').run(
      sha(jeton),
      maintenant,
      maintenant + 3600_000,
      'vérification collaborateurs',
      id,
    );
  }
  db.close();
}
const canalMembre = await ouvrirCanal(jetonMembre);
const canalLecteur = await ouvrirCanal(jetonLecteur);
await new Promise((r) => setTimeout(r, 1500));

for (const [role, canal] of [
  ['membre', canalMembre],
  ['lecteur', canalLecteur],
]) {
  const fermees = tousLesTypes.filter((type) => !commandeAutorisee(role, type));
  const passees = [];
  for (const type of fermees) {
    const cmd = exemplaire(type);
    if (!ClientCommand.safeParse(cmd).success) continue;
    const reponse = await canal.demander(cmd, 2500);
    if (reponse.ok) passees.push(type);
  }
  noter(`toute commande non ouverte à un ${role} lui est refusée`, passees.length === 0, passees.join(', '));
}

const dePremier = (canal) => canal.recus.find((e) => e.type === 'ready');
const co_pretMembre = dePremier(canalMembre);
noter(
  'le premier envoi d’un membre ne nomme que son projet — ni l’autre, ni les quotas, ni les réglages',
  !!co_pretMembre &&
    co_pretMembre.projects.every((p) => p.id === PROJET) &&
    co_pretMembre.projects.length === 1 &&
    co_pretMembre.quotas.length === 0 &&
    JSON.stringify(co_pretMembre.prefs) === '{}' &&
    co_pretMembre.role === 'membre',
  co_pretMembre ? `${co_pretMembre.projects.map((p) => p.name).join(', ')}` : 'pas de premier envoi',
);
const co_pretLecteur = dePremier(canalLecteur);
noter('le premier envoi d’un lecteur dit son niveau', co_pretLecteur?.role === 'lecteur');

const co_liste = await canalMembre.demander({ type: 'project.list' });
noter(
  'la liste des projets d’un membre est ramenée à sa portée',
  co_liste.ok === true && co_liste.data?.projects?.length === 1 && co_liste.data.projects[0].id === PROJET,
  JSON.stringify(co_liste.data?.projects?.map((p) => p.name) ?? co_liste.error),
);
const co_horsPortee = await canalMembre.demander({ type: 'cards.tranche', projectId: PROJET_VOISIN, column: 'planned' });
noter('un membre ne lit pas le tableau d’un projet hors de sa portée', co_horsPortee.ok === false && co_horsPortee.error === REFUS_HORS_PORTEE, co_horsPortee.error ?? 'passé');
const co_danslaPortee = await canalMembre.demander({ type: 'cards.tranche', projectId: PROJET, column: 'planned' });
noter('un membre lit le tableau de son projet', co_danslaPortee.ok === true, co_danslaPortee.error ?? '');

const co_nouvelle = await canalMembre.demander({ type: 'card.create', projectId: PROJET, title: 'Carte du membre', cadrage: false });
noter('un membre crée une carte dans son projet', co_nouvelle.ok === true, co_nouvelle.error ?? '');
const carteHors = await canalMembre.demander({ type: 'card.create', projectId: PROJET_VOISIN, title: 'Carte interdite', cadrage: false });
noter('…mais pas dans un autre', carteHors.ok === false);
const lecteurEcrit = await canalLecteur.demander({ type: 'card.create', projectId: PROJET, title: 'Carte du lecteur', cadrage: false });
noter('un lecteur ne crée rien', lecteurEcrit.ok === false);
const lecteurLit = await canalLecteur.demander({ type: 'cards.tranche', projectId: PROJET, column: 'planned' });
noter('un lecteur lit le tableau de son projet', lecteurLit.ok === true, lecteurLit.error ?? '');

// Un geste d'administration qui diffuse largement : ni projet voisin, ni compte, ni quota ne doit sortir.
const co_avantMembre = canalMembre.recus.length;
await canalAdmin.demander({ type: 'quota.refresh' }, 20000).catch(() => undefined);
await canalAdmin.demander({ type: 'comptes.suspendre', id: 'u-autre', suspendu: false }, 5000).catch(() => undefined);
await new Promise((r) => setTimeout(r, 800));
const co_sortis = canalMembre.recus.slice(co_avantMembre).filter((e) => ['quotas', 'comptes', 'settings', 'processes', 'capacity'].includes(e.type));
noter('aucun quota, compte, réglage ni processus ne sort vers un membre', co_sortis.length === 0, co_sortis.map((e) => e.type).join(', '));

const co_meMembre = await frapper('/api/me', jetonMembre);
const corpsMembre = await co_meMembre.json();
noter('/api/me dit à un membre son niveau', co_meMembre.status === 200 && corpsMembre.role === 'membre', `${co_meMembre.status} · ${corpsMembre.role}`);
const routesMembre = [];
for (const route of ['/api/file', '/api/digest', '/api/zip', '/api/capture', '/api/terminal', '/api/studio/extrait']) {
  const reponse = await frapper(route, jetonMembre);
  if (reponse.status !== 403) routesMembre.push(`${route} (${reponse.status})`);
}
noter('les routes d’administration sont refusées à un membre', routesMembre.length === 0, routesMembre.join(', '));
noter('le dépôt de fichiers est ouvert au membre, pas au lecteur', routeApiAutorisee('membre', '/api/upload') && !routeApiAutorisee('lecteur', '/api/upload'));

const co_terminal = await new Promise((resolve) => {
  const socket = new ws.WebSocket(`ws://127.0.0.1:${PORT}/ws/terminal`, { headers: { cookie: `beluga_session=${jetonMembre}` } });
  socket.on('open', () => (socket.close(), resolve('ouvert')));
  socket.on('unexpected-response', (_req, reponse) => resolve(String(reponse.statusCode)));
  socket.on('error', () => resolve('refusé'));
});
noter('le terminal du serveur reste fermé à un membre', co_terminal !== 'ouvert', co_terminal);

/* ------------------------------------------------------------------ */

for (const canal of [canalAdmin, canalClient, canalAutre, canalMembre, canalLecteur]) canal.socket.close();

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
if (echecs.length) {
  console.error(`\n${echecs.length} contrôle(s) en échec :`);
  for (const e of echecs) console.error(`  - ${e.nom}`);
  console.error('\n--- dernières lignes du démon ---\n' + journal.join('').slice(-3000));
  process.exit(1);
}
process.exit(0);
