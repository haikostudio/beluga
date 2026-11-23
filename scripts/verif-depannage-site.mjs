#!/usr/bin/env node
/**
 * TROIS CONTRÔLES RATÉS D'AFFILÉE OUVRENT UNE CARTE, ET UNE SEULE.
 *
 *   npm run build:server && node scripts/verif-depannage-site.mjs
 *
 * Le scénario entier tourne sur un démon JETABLE (base neuve, port libre,
 * dossier de projets à part) et sur des sites d'essai servis ici même : rien ne
 * sort de la machine, le démon de production n'est pas touché, et AUCUN MOTEUR
 * n'est appelé — `maxAgents: 0` retient le tour de l'agent en file, ce qui
 * suffit : ce qu'on vérifie, c'est la CARTE et la fiche du site.
 *
 * Ce qu'il exige, un contrôle par promesse de la carte :
 *
 *  1. le site est rattaché à SON projet d'après son adresse, et cela se lit sur
 *     sa fiche comme un rattachement DEVINÉ ;
 *  2. deux échecs n'ouvrent AUCUNE carte ;
 *  3. le troisième en ouvre une, dans le projet du site, avec son étiquette et
 *     son titre — et elle naît dans « Demande », jamais en « En cours » ;
 *  4. un quatrième et un cinquième échec n'en ouvrent pas de seconde ;
 *  5. un contrôle réussi REFERME l'incident sans effacer la date du dernier
 *     lancement ;
 *  6. le site qui retombe dans les six heures n'ouvre pas de nouvelle carte ;
 *  7. un choix fait à la main sur la fiche l'emporte sur l'adresse ;
 *  8. un site dont l'adresse ne correspond à rien ouvre sa carte chez
 *     Beluga Build ;
 *  9. l'alerte du premier échec est toujours partie ;
 * 10. LE COURRIEL D'ALERTE suit le même compteur : rien avant le troisième
 *     échec, une seule date posée, aucune autre au quatrième ni au cinquième,
 *     et la fiche redevient vierge dès que le site revient. AUCUN COURRIEL NE
 *     PART : le coffre-fort du démon jetable est vide, donc sans façon d'envoyer —
 *     ce qu'on lit, c'est la MÉMOIRE de l'envoi, posée avant lui.
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(import.meta.url);
const Database = require_('better-sqlite3');
const ws = require_('ws');
const PORT = Number(process.env.BELUGA_DEPANNAGE_PORT || 7233);
const PORT_SITES = PORT + 1;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-depannage-'));
const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
for (const dossier of [DATA, PROJETS]) fs.mkdirSync(dossier, { recursive: true });

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/*
 * DEUX SITES D'ESSAI. « /boutique » casse et se répare à la demande :
 * c'est lui qui joue la panne, le retour et la rechute. « /inconnu » casse
 * toujours, et son adresse ne correspond à aucun projet.
 */
let boutiqueReparee = false;
const sites = http.createServer((req, res) => {
  const casse = req.url.startsWith('/boutique') ? !boutiqueReparee : true;
  res.writeHead(casse ? 500 : 200, { 'content-type': 'text/html' });
  res.end(casse ? '<html><body>Panne interne</body></html>' : '<html><body>Tout va bien</body></html>');
});

const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...process.env,
    BELUGA_PORT: String(PORT),
    BELUGA_HOST: '127.0.0.1',
    BELUGA_DATA: DATA,
    BELUGA_PROJECTS_ROOT: PROJETS,
    BELUGA_WEB: process.env.BELUGA_WEB_ESSAI || path.join(RACINE, 'web', 'dist'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const journal = [];
demon.stdout.on('data', (d) => journal.push(String(d)));
demon.stderr.on('data', (d) => journal.push(String(d)));

const ranger = () => {
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  try {
    sites.close();
  } catch {
    /* déjà fermé */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
};
process.on('exit', ranger);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    ranger();
    process.exit(130);
  });
}

async function attendrePort(port, limiteMs = 60000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const ouvert = await new Promise((resolve) => {
      const prise = net.connect(port, '127.0.0.1');
      prise.on('connect', () => (prise.end(), resolve(true)));
      prise.on('error', () => resolve(false));
    });
    if (ouvert) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function attendreLaBase(limiteMs = 30000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    try {
      const db = new Database(path.join(DATA, 'beluga.db'), { readonly: true });
      const colonne = db
        .prepare("SELECT 1 AS n FROM pragma_table_info('sites_surveilles') WHERE name = 'alerte_courriel_le'")
        .get();
      db.close();
      if (colonne) return true;
    } catch {
      /* base pas encore là */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const jeton = crypto.randomBytes(32).toString('hex');
const ouvrir = (lectureSeule = false) => new Database(path.join(DATA, 'beluga.db'), { readonly: lectureSeule });

/** Une session d'une heure, fabriquée à la main : aucun mot de passe en jeu. */
function poserLaSession() {
  const db = ouvrir();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(jeton),
    maintenant,
    maintenant + 3600_000,
    'vérification du dépannage de site',
  );
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  // AUCUN MOTEUR : le tour de l'agent reste en file, la carte est déjà posée.
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));
  db.close();
}

/**
 * LE PROJET DE LA BOUTIQUE. Beluga Build s'inscrit LUI-MÊME à son démarrage
 * (projet `isSelf`) : on ne le repose pas, on le retrouve — c'est lui qui
 * accueille la carte d'un site dont aucun projet n'est reconnu.
 */
function poserLeProjetDeLaBoutique() {
  const db = ouvrir();
  const maintenant = Date.now();
  db.prepare('INSERT INTO projects (id, name, path, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    'p-boutique',
    'Boutique',
    path.join(PROJETS, 'p-boutique'),
    JSON.stringify({
      id: 'p-boutique',
      name: 'Boutique',
      path: path.join(PROJETS, 'p-boutique'),
      devUrl: `http://127.0.0.1:${PORT_SITES}`,
      createdAt: maintenant,
      updatedAt: maintenant,
    }),
    maintenant,
    maintenant,
  );
  db.close();
  fs.mkdirSync(path.join(PROJETS, 'p-boutique'), { recursive: true });
}

/** Le projet que Beluga Build s'est donné à lui-même. */
function projetDeBelugaBuild() {
  const db = ouvrir(true);
  const ligne = db
    .prepare("SELECT id FROM projects WHERE json_extract(data, '$.isSelf') = 1")
    .get();
  db.close();
  return ligne?.id ?? null;
}

/** Deux sites surveillés, posés en base comme des lignes reprises. */
function poserLesSites() {
  const db = ouvrir();
  const poser = db.prepare(
    'INSERT INTO sites_surveilles (id, url, nom, etat, verifie_le, depuis, derniere_panne, cree_le) VALUES (?, ?, ?, ?, 0, 0, 0, ?)',
  );
  // L'adresse du projet est 127.0.0.1 : c'est le MÊME hôte, donc le projet est
  // reconnu. « /inconnu » vise un autre hôte, qui ne correspond à rien.
  poser.run('s-boutique', `http://127.0.0.1:${PORT_SITES}/boutique`, 'Boutique', 'inconnu', Date.now());
  poser.run('s-inconnu', `http://localhost:${PORT_SITES}/inconnu`, 'Site sans projet', 'inconnu', Date.now() + 1);
  db.close();
}

const leSite = (id) => {
  const db = ouvrir(true);
  const ligne = db.prepare('SELECT * FROM sites_surveilles WHERE id = ?').get(id);
  db.close();
  return ligne;
};

/*
 * LES CHAMPS D'UNE CARTE SONT DE VRAIES COLONNES (`shared/src/carte-sql.ts`) :
 * les étiquettes vivent dans leur propre table, pas dans le JSON de `data`.
 */
const lesCartes = () => {
  const db = ouvrir(true);
  const lignes = db.prepare('SELECT id, project_id, title, column_key FROM cards ORDER BY created_at ASC').all();
  const etiquettes = db.prepare('SELECT label FROM card_labels WHERE card_id = ? ORDER BY position ASC');
  const cartes = lignes.map((l) => ({ ...l, labels: etiquettes.all(l.id).map((e) => e.label) }));
  db.close();
  return cartes;
};

function commande(cmd) {
  return new Promise((resolve, reject) => {
    const prise = new ws.WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
      headers: { Cookie: `beluga_session=${jeton}` },
    });
    const id = crypto.randomBytes(6).toString('hex');
    const minuteur = setTimeout(() => (prise.close(), reject(new Error('le démon ne répond pas'))), 60000);
    prise.on('open', () => prise.send(JSON.stringify({ id, cmd })));
    prise.on('message', (brut) => {
      const evenement = JSON.parse(String(brut));
      if (evenement.type !== 'ack' || evenement.id !== id) return;
      clearTimeout(minuteur);
      prise.close();
      if (evenement.error) reject(new Error(evenement.error));
      else resolve(evenement);
    });
    prise.on('error', (e) => (clearTimeout(minuteur), reject(e)));
  });
}

/**
 * L'ALERTE SE LIT LÀ OÙ ELLE PASSE VRAIMENT : dans le canal ouvert entre le
 * démon et l'application. On ne se fie ni au journal ni à la base.
 */
const alertes = [];
function ecouterLesAlertes() {
  const prise = new ws.WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
    headers: { Cookie: `beluga_session=${jeton}` },
  });
  prise.on('message', (brut) => {
    try {
      const evenement = JSON.parse(String(brut));
      if (evenement?.type === 'notify') alertes.push(evenement);
    } catch {
      /* trame illisible : rien à en tirer */
    }
  });
  prise.on('error', () => undefined);
  return prise;
}

/** Un passage sur un site, puis le temps que le déclencheur ait tout fini. */
async function unPassage(id) {
  await commande({ type: 'surveillance.verifier', id });
  await new Promise((r) => setTimeout(r, 1200));
}

async function main() {
  sites.listen(PORT_SITES, '127.0.0.1');
  if (!(await attendrePort(PORT_SITES, 10000))) throw new Error("les sites d'essai n'ont pas démarré");
  if (!(await attendrePort(PORT))) throw new Error(`le démon d'essai n'a jamais ouvert le port ${PORT}`);
  if (!(await attendreLaBase()))
    throw new Error('les colonnes de l’incident et du courriel ne sont jamais apparues : les migrations 75 et 83 n’ont pas tourné');
  noter('Les migrations posent le projet rattaché, l’incident et le courriel d’alerte sur chaque fiche', true);

  poserLaSession();
  poserLeProjetDeLaBoutique();
  const canal = ecouterLesAlertes();
  poserLesSites();

  /* 1. Deux échecs : le compteur monte, aucune carte ne s'ouvre. */
  await unPassage('s-boutique');
  await unPassage('s-boutique');
  noter(
    'DEUX ÉCHECS N’OUVRENT AUCUNE CARTE',
    lesCartes().length === 0 && !leSite('s-boutique').incident_card_id,
    `${lesCartes().length} carte(s)`,
  );
  noter(
    'DEUX ÉCHECS N’ÉCRIVENT AUCUN COURRIEL',
    !leSite('s-boutique').alerte_courriel_le && !leSite('s-boutique').alerte_courriel_depuis,
    `courriel=${leSite('s-boutique').alerte_courriel_le}`,
  );

  /* 2. Le troisième échec : une carte, dans le projet du site. */
  await unPassage('s-boutique');
  let cartes = lesCartes();
  const carte = cartes[0];
  noter(
    'LE TROISIÈME ÉCHEC OUVRE UNE CARTE, ET UNE SEULE',
    cartes.length === 1,
    `${cartes.length} carte(s)${carte ? ` : « ${carte.title} »` : ''}`,
  );
  noter(
    'Elle s’ouvre dans LE PROJET DU SITE, deviné d’après son adresse',
    carte?.project_id === 'p-boutique',
    `projet = ${carte?.project_id}`,
  );
  noter('Son titre nomme le site', carte?.title === 'Panne de Boutique', carte?.title ?? '');
  noter(
    'Elle porte l’étiquette des pannes détectées',
    carte?.labels.includes('panne détectée'),
    (carte?.labels ?? []).join(', ') || 'aucune',
  );
  noter(
    'Elle naît dans « Demande », jamais en « En cours »',
    carte?.column_key === 'planned',
    `colonne = ${carte?.column_key}`,
  );

  const fiche = leSite('s-boutique');
  noter(
    'La fiche du site garde la carte de la panne et l’heure du lancement',
    fiche.incident_card_id === carte?.id && Number(fiche.incident_lance_le) > 0 && Number(fiche.incident_depuis) > 0,
    `carte=${fiche.incident_card_id?.slice(0, 8)} lancé=${fiche.incident_lance_le}`,
  );
  noter(
    'Le rattachement est marqué comme DEVINÉ, et ne touche pas au projet de l’agent de configuration',
    fiche.projet_rattache === 'p-boutique' && Number(fiche.projet_devine) === 1 && !fiche.project_id,
    `rattaché=${fiche.projet_rattache} deviné=${fiche.projet_devine} agent=${fiche.project_id}`,
  );

  noter(
    'LE TROISIÈME ÉCHEC ÉCRIT UN COURRIEL, ET NOTE SA DATE AVANT DE L’ENVOYER',
    Number(fiche.alerte_courriel_le) > 0 && Number(fiche.alerte_courriel_depuis) > 0,
    `courriel=${fiche.alerte_courriel_le} panne=${fiche.alerte_courriel_depuis}`,
  );
  const premierCourriel = Number(fiche.alerte_courriel_le);

  /* 3. Quatrième et cinquième échec : pas de seconde carte, pas de second courriel. */
  await unPassage('s-boutique');
  await unPassage('s-boutique');
  noter(
    'UN QUATRIÈME ET UN CINQUIÈME ÉCHEC N’OUVRENT PAS DE DEUXIÈME CARTE',
    lesCartes().length === 1,
    `${lesCartes().length} carte(s)`,
  );
  noter(
    'UN QUATRIÈME ET UN CINQUIÈME ÉCHEC N’ÉCRIVENT PAS DE SECOND COURRIEL : LE RAPPEL ATTEND SIX HEURES',
    Number(leSite('s-boutique').alerte_courriel_le) === premierCourriel,
    `courriel=${leSite('s-boutique').alerte_courriel_le} (premier=${premierCourriel})`,
  );

  /* 4. Le site revient : l'incident se referme, la date de lancement reste. */
  boutiqueReparee = true;
  await unPassage('s-boutique');
  const revenu = leSite('s-boutique');
  noter(
    'UN CONTRÔLE RÉUSSI REFERME L’INCIDENT, ET GARDE LA DATE DU DERNIER LANCEMENT',
    revenu.etat === 'ok' && !revenu.incident_card_id && Number(revenu.incident_lance_le) > 0,
    `état=${revenu.etat} carte=${revenu.incident_card_id} lancé=${revenu.incident_lance_le}`,
  );
  noter(
    'ET IL OUBLIE LE COURRIEL : LA PANNE SUIVANTE EN ÉCRIRA UN NEUF, PAS UN RAPPEL',
    !revenu.alerte_courriel_le && !revenu.alerte_courriel_depuis,
    `courriel=${revenu.alerte_courriel_le} panne=${revenu.alerte_courriel_depuis}`,
  );

  /* 5. Il retombe tout de suite : la limite de six heures tient. */
  boutiqueReparee = false;
  for (let i = 0; i < 3; i++) await unPassage('s-boutique');
  noter(
    'UN SITE QUI REVIENT PUIS RETOMBE DANS LES SIX HEURES N’OUVRE PAS DE NOUVELLE CARTE',
    lesCartes().length === 1,
    `${lesCartes().length} carte(s)`,
  );
  noter(
    'Mais la nouvelle panne, elle, écrit son courriel : le compteur est reparti de zéro',
    Number(leSite('s-boutique').alerte_courriel_le) > premierCourriel,
    `courriel=${leSite('s-boutique').alerte_courriel_le} (premier=${premierCourriel})`,
  );

  /* 6. Un choix fait à la main l'emporte sur l'adresse. */
  const soi = projetDeBelugaBuild();
  await commande({ type: 'surveillance.rattacher', id: 's-boutique', projectId: soi });
  let choisi = leSite('s-boutique');
  noter(
    'UN CHOIX FAIT À LA MAIN SUR LA FICHE L’EMPORTE, ET N’EST PLUS DIT « DEVINÉ »',
    choisi.projet_rattache === soi && Number(choisi.projet_devine) === 0,
    `rattaché=${choisi.projet_rattache} deviné=${choisi.projet_devine}`,
  );
  await unPassage('s-boutique');
  choisi = leSite('s-boutique');
  noter(
    'Et un passage de plus ne le redevine pas',
    choisi.projet_rattache === soi && Number(choisi.projet_devine) === 0,
    `rattaché=${choisi.projet_rattache}`,
  );
  await commande({ type: 'surveillance.rattacher', id: 's-boutique', projectId: null });
  noter(
    '« À deviner d’après l’adresse » efface bien le choix',
    !leSite('s-boutique').projet_rattache,
    `rattaché=${leSite('s-boutique').projet_rattache}`,
  );

  /* 7. Un site sans projet trouvé ouvre sa carte chez Beluga Build. */
  for (let i = 0; i < 3; i++) await unPassage('s-inconnu');
  cartes = lesCartes();
  const orpheline = cartes.find((c) => c.title.includes('sans projet'));
  noter(
    'UN SITE SANS PROJET TROUVÉ OUVRE SA CARTE CHEZ BELUGA BUILD',
    Boolean(orpheline) && Boolean(soi) && orpheline.project_id === soi,
    orpheline ? `« ${orpheline.title} » dans ${orpheline.project_id} (Beluga Build = ${soi})` : `aucune carte (${cartes.length} au total)`,
  );
  noter(
    'Et sa fiche ne rattache aucun projet',
    !leSite('s-inconnu').projet_rattache,
    `rattaché=${leSite('s-inconnu').projet_rattache}`,
  );

  /*
   * 8. L'alerte du premier échec est toujours là. On laisse passer la FENÊTRE
   * DE GROUPEMENT du guichet des notifications (`server/src/notify.ts`) : plus
   * tôt, on constaterait une absence qui n'en est pas une.
   */
  await new Promise((r) => setTimeout(r, 6000));
  const chutes = alertes.filter((a) => a.motif === 'site-indisponible');
  noter(
    'L’ALERTE ENVOYÉE AU PREMIER ÉCHEC EST TOUJOURS LÀ',
    chutes.length >= 1,
    chutes.length ? `${chutes.length} alerte(s) : ${chutes[0].title}` : `aucune (${alertes.length} au total)`,
  );

  /* 9. Aucun code n'a été touché : la carte s'arrête avant toute correction. */
  const salis = fs.readdirSync(path.join(PROJETS, 'p-boutique'));
  noter(
    'AUCUNE MODIFICATION N’EST ENREGISTRÉE SUR LE PROJET',
    salis.length === 0,
    salis.length ? salis.join(', ') : 'dossier intact',
  );

  canal.close();

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles réussis.`);
  if (echecs.length) console.log('Journal du démon :\n' + journal.join(''));
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error('ÉCHEC :', error);
  console.log('Journal du démon :\n' + journal.join(''));
  process.exit(1);
});
