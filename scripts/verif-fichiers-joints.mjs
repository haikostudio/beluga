#!/usr/bin/env node
/**
 * UN AGENT REND N'IMPORTE QUEL FICHIER, ET TOUT FICHIER SE TÉLÉCHARGE D'UN CLIC.
 *
 * Deux moitiés. La première ne LIT que du texte : l'outil de l'agent n'a plus de
 * filtre d'extension, il garde sa borne de poids, son ancien nom reste servi, et
 * les trois endroits qui affichent une pièce jointe passent tous par la MÊME
 * pièce (`PastilleDeFichier`) — plus aucun lien mort « Pièce jointe » sans nom.
 *
 * La seconde monte un démon à soi (base neuve, port libre, plafond d'agents à zéro, aucun moteur appelé) et y
 * envoie un VRAI PDF et une VRAIE image par `/api/upload` : le stockage central doit les accepter sous leur vrai type.
 * (L'affichage de la pastille dans un navigateur se jugeait sur une note, retirée avec le service Notes : aucun autre
 * écran ne montre encore une pièce jointe sans passer par un tour d'agent réel.)
 *
 *   npm run build && node scripts/verif-fichiers-joints.mjs
 */
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* La racine se déduit du script : lancé d'une copie de travail, il juge CE
   code-là, jamais le dossier principal. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BELUGA_FICHIERS_PORT || 7207);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = `${RACINE}/data/verification`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-fichiers-joints-'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const lire = (relatif) => fs.readFileSync(path.join(RACINE, relatif), 'utf8');

/* ================================================================== */
/* 1. CE QUI SE LIT DANS LE CODE                                       */
/* ================================================================== */

function partieStatique() {
  console.log('\nL’OUTIL DE L’AGENT ET LES QUATRE AFFICHAGES\n');

  const outils = lire('server/src/tools.ts');

  noter("l'outil s'appelle « attach_file »", outils.includes("name: 'attach_file',"));
  noter(
    "l'ancien nom « attach_screenshot » reste servi en alias",
    /case 'attach_file':\s*\n\s*case 'attach_screenshot': \{/.test(outils),
  );
  noter(
    "plus aucun filtre d'extension ne refuse un fichier",
    !outils.includes("Ce n'est pas une image reconnue") && !/const MIME_PAR_EXTENSION/.test(outils),
    'la table d’extensions bloquante a disparu de l’outil',
  );
  /* LA JOINTURE VIT DANS UN MODULE À ELLE (`joindre-fichier.ts`), partagée avec
     la conversation : l'outil ne fait plus que la déléguer et dire son refus. */
  const jointure = lire('server/src/joindre-fichier.ts');
  noter(
    "l'outil délègue la jointure au module commun",
    /import \{[^}]*\bjoindreUnFichier\b[^}]*\} from '\.\/joindre-fichier\.js';/.test(outils) &&
      outils.includes('await joindreUnFichier({'),
  );
  noter("le type est deviné, avec un repli pour l'inconnu", jointure.includes('mimeDuFichier(fichier)'));
  noter(
    'le poids est borné, et le refus se dit en clair',
    jointure.includes('refusDeTaille(poids)') &&
      jointure.includes('if (refus) return { ok: false, refus };') &&
      /return \{ ok: false, text: `\$\{jointure\.refus\}/.test(outils),
  );

  const mimes = lire('shared/src/mime-fichiers.ts');
  noter(
    "un type inconnu retombe sur « application/octet-stream »",
    mimes.includes("export const MIME_INCONNU = 'application/octet-stream';"),
  );

  /* LES QUATRE AFFICHAGES PASSENT PAR LA MÊME PIÈCE. C'est là qu'était le vrai
     défaut : deux rendus austères côté client, un badge MORT côté carte. */
  const pastille = lire('web/src/components/pastille-de-fichier.tsx');
  noter(
    'la pastille rend un VRAI lien de téléchargement, sous le vrai nom',
    pastille.includes('adresseDePiece(id, true)') && pastille.includes('download={aEnregistrer || undefined}'),
  );
  noter(
    'la pastille porte les repères de contrôle data-lien-piece / data-apercu-image',
    pastille.includes('data-lien-piece={id}') && pastille.includes('data-apercu-image={id}'),
  );

  for (const [quoi, fichier] of [
    ['le fil d’une carte', 'web/src/components/attachment-preview.tsx'],
    ['le repli d’une pièce encore inconnue', 'web/src/components/bulle-question.tsx'],
  ]) {
    noter(`${quoi} passe par la pastille unique`, lire(fichier).includes('PastilleDeFichier'));
  }

  /* L'ESPACE CLIENT rend ses pièces par UN module (`espace/pieces.tsx`) : c'est
     lui qui pose la pastille, et ses deux écrans passent par lui. */
  const piecesEspace = lire('web/src/espace/pieces.tsx');
  noter(
    'les pièces de l’espace client passent par la pastille unique',
    /<PastilleDeFichier\s+key=\{piece\.id\}\s+id=\{piece\.id\}\s+nom=\{piece\.nom\}\s+mime=\{piece\.mime\}\s+poids=\{piece\.taille\}/.test(
      piecesEspace,
    ),
    'nom, type et poids transmis',
  );
  for (const [quoi, fichier] of [
    ['la discussion de l’espace client', 'web/src/espace/espace-client.tsx'],
    ['la fiche d’une demande', 'web/src/espace/tiroir-demande.tsx'],
  ]) {
    const code = lire(fichier);
    noter(
      `${quoi} passe par la pastille unique`,
      /import \{[^}]*\bPiecesDuMessage\b[^}]*\} from '\.\/pieces';/.test(code) && code.includes('<PiecesDuMessage'),
      'par PiecesDuMessage',
    );
  }

  noter(
    "plus aucun lien mort « Pièce jointe » sans nom ni poids",
    !lire('web/src/espace/espace-client.tsx').includes("t('Pièce jointe')") &&
      !lire('web/src/espace/tiroir-demande.tsx').includes("t('Pièce jointe')") &&
      !piecesEspace.includes("t('Pièce jointe')") &&
      !lire('web/src/components/bulle-question.tsx').includes("t('pièce jointe')"),
  );

  /* LE SERVEUR ENVOIE LE NOM ET LE POIDS AVEC LE FIL : sans eux, l'écran ne
     pourrait afficher qu'un identifiant. */
  noter(
    'le fil de discussion part avec ses pièces (nom, type, poids)',
    lire('server/src/espace-commandes.ts').includes('espace.piecesDuFil(messages)'),
  );

  /* L'ARRONDI DU CAS PHOTOGRAPHIÉ : les options d'une question. Le fil les
     rend désormais par l'encadré de question du journal (`contenu-journal.tsx`). */
  const journal = lire('web/src/components/contenu-journal.tsx');
  const optionsQuestion = journal.slice(journal.indexOf('data-encadre-question-option='), journal.indexOf('data-encadre-question-option=') + 600);
  noter(
    'les options d’une question ne sont plus en arrondi plein',
    lire('web/src/components/flux-en-points.tsx').includes('options={bloc.question.options.map(') &&
      optionsQuestion.includes("'flex items-start gap-1.5 rounded-md border px-2 py-1 text-[13px]'") &&
      !optionsQuestion.includes('rounded-full'),
  );
}

/* ================================================================== */
/* 2. UN DÉMON À SOI, UN VRAI FICHIER, UN VRAI NAVIGATEUR              */
/* ================================================================== */

const DATA = path.join(TMP, 'data');
const PROJETS = path.join(TMP, 'projets');
const DOSSIER = path.join(TMP, 'projet');
for (const dossier of [DATA, PROJETS, DOSSIER]) fs.mkdirSync(dossier, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

const demon = spawn('node', [path.join(RACINE, 'server', 'dist', 'main.js')], {
  env: {
    ...process.env,
    BELUGA_PORT: String(PORT),
    BELUGA_HOST: '127.0.0.1',
    BELUGA_DATA: DATA,
    BELUGA_PROJECTS_ROOT: PROJETS,
    BELUGA_WEB: path.join(RACINE, 'web', 'dist'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
demon.stdout.on('data', () => {});
demon.stderr.on('data', () => {});

process.on('exit', () => {
  try {
    demon.kill('SIGKILL');
  } catch {
    /* déjà parti */
  }
  fs.rmSync(TMP, { recursive: true, force: true });
});

async function attendrePort(limiteMs = 60000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    const ouvert = await new Promise((resolve) => {
      const prise = net.connect(PORT, '127.0.0.1');
      prise.on('connect', () => (prise.end(), resolve(true)));
      prise.on('error', () => resolve(false));
    });
    if (ouvert) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/* LE JETON EST HACHÉ EN BASE : la session d'une heure se fabrique puis se retire
   avec le dossier temporaire tout entier. */
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const JETON = crypto.randomBytes(32).toString('hex');
const PROJET_ID = 'p-fichiers';
const base = () => new Database(path.join(DATA, 'beluga.db'));

const marque = Date.now();
const TEXTE = `Voici ce que j'ai produit — ${marque}.`;
const NOM_PDF = `rapport-${marque}.pdf`;
const NOM_IMAGE = `capture-${marque}.png`;

function poserLeDecor() {
  const db = base();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    sha(JETON),
    maintenant,
    maintenant + 3600_000,
    'vérification des fichiers joints',
  );

  // Plafond d'agents à ZÉRO : rien ne peut démarrer tout seul dans le dos.
  const reglages = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'settings'").get()?.value ?? '{}');
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify({ ...reglages, maxAgents: 0 }));

  db.prepare('DELETE FROM projects').run();
  const projet = {
    id: PROJET_ID,
    name: 'Essai des fichiers joints',
    path: DOSSIER,
    defaultEngine: 'claude',
    isSelf: false,
    rank: 1,
    archived: false,
    createdAt: maintenant,
    updatedAt: maintenant,
  };
  db.prepare(
    'INSERT INTO projects (id, name, path, archived, data, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
  ).run(projet.id, projet.name, projet.path, JSON.stringify(projet), maintenant, maintenant);

  db.close();
}

/** Envoyer un fichier au démon comme le ferait la page, et rendre sa pièce. */
async function envoyerFichier(nom, mime, contenu) {
  const fichier = path.join(TMP, nom);
  fs.writeFileSync(fichier, contenu);
  const reponse = await fetch(`${BASE}/api/upload?project=${PROJET_ID}`, {
    method: 'POST',
    headers: {
      cookie: `beluga_session=${JETON}`,
      'content-type': mime,
      'x-file-name': encodeURIComponent(nom),
    },
    body: fs.readFileSync(fichier),
  });
  if (!reponse.ok) return null;
  const data = await reponse.json();
  return data.attachment ?? null;
}

async function main() {
  partieStatique();

  console.log('\nUN VRAI FICHIER, ENVOYÉ À UN DÉMON À SOI\n');
  if (!(await attendrePort())) throw new Error("le démon d'essai n'a pas démarré");
  poserLeDecor();
  await new Promise((r) => setTimeout(r, 1500));

  const pdf = await envoyerFichier(NOM_PDF, 'application/pdf', `%PDF-1.4 rapport d'essai ${marque}\n`);
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAP0lEQVR42u3OMQEAAAgDoC252H0M' +
      'Ywm4mUryJgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgWQ0YMAAB8W8LqQAAAABJRU5ErkJggg==',
    'base64',
  );
  const image = await envoyerFichier(NOM_IMAGE, 'image/png', Buffer.concat([png, crypto.randomBytes(8)]));
  if (!pdf || !image) throw new Error("les fichiers d'essai n'ont pas été acceptés");
  noter('Un PDF est accepté par le stockage central', pdf.mime === 'application/pdf', pdf.mime);
  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
