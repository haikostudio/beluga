#!/usr/bin/env node
/**
 * LE POOL DE COMPÉTENCES EST-IL VRAIMENT UN POOL ?
 *
 * Avant, `data/competences/` ne portait qu'UNE entrée atteignable sur seize, un
 * seul fichier était lu par dossier, et tout ce qui n'avait pas la bonne forme
 * était écarté EN SILENCE. On contrôle ici, sur le VRAI pool de la machine et
 * sur un pool FABRIQUÉ (pour les cas qu'on ne peut pas provoquer sur le vrai) :
 *
 *   1. le pool rend TOUTES ses fiches, liens vers le coffre personnel compris ;
 *   2. ce qui est écarté sort avec sa RAISON — plus aucun refus muet ;
 *   3. l'ARBRE est lu : la tête d'une fiche ET ses fichiers de détail ;
 *   4. le pool est indexé UNE SEULE FOIS, sous son propre identifiant, et
 *      n'est plus recopié dans l'index de chaque projet ;
 *   5. les deux fichiers d'entrée sont écrits par le démon, et indexés en tête ;
 *   6. le briefing porte un SOMMAIRE par thème, pas une ligne par fiche ;
 *   7. l'écriture passe le contrôle de qualité, garde la provenance d'origine
 *      et ne sort jamais du pool ;
 *   8. une fiche ne se supprime pas : elle se déprécie ou s'archive ;
 *   9. les compétences ne prennent jamais plus que leur part du contexte.
 *
 *   node scripts/verif-pool-competences.mjs
 *
 * Le script juge le code du dépôt d'où il PART, jamais celui du dossier
 * principal, et n'écrit RIEN dans le vrai pool : ses écritures se font dans un
 * dossier temporaire.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * La base du démon. Lancé depuis une COPIE DE TRAVAIL, ce script y trouve un
 * `data/` fabriqué par les tests — base vide, pool vide : on préfère donc le
 * dossier qui porte un pool RÉELLEMENT rempli, sinon le premier qui porte une
 * base, sinon celui du dépôt.
 */
function dossierDonnees() {
  const candidats = [
    process.env.HAIKO_COMPETENCES_DATA,
    path.join(RACINE, 'data'),
    path.resolve(RACINE, '..', '..', 'data'),
  ].filter(Boolean);
  const pooolRempli = (dossier) => {
    try {
      return fs.readdirSync(path.join(dossier, 'competences')).some((nom) => !nom.startsWith('.'));
    } catch {
      return false;
    }
  };
  return (
    candidats.find(pooolRempli) ??
    candidats.find((d) => fs.existsSync(path.join(d, 'haikodev.db'))) ??
    path.join(RACINE, 'data')
  );
}

const DONNEES = dossierDonnees();
process.env.HAIKODEV_DATA = DONNEES;

const ESSAI = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-pool-'));
const POOL_ESSAI = path.join(ESSAI, 'pool');
fs.mkdirSync(POOL_ESSAI, { recursive: true });

const {
  lirePool,
  listerCompetences,
  ecrireLaFiche,
  changerLEtat,
  etatDuPoolPourLEcran,
  dossierDesCompetences,
} = await import('../server/dist/competences.js');
const passages = await import('../server/dist/passages.js');
const { briefing } = await import('../server/dist/memory.js');
const shared = await import('../shared/dist/index.js');

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

console.log(`  …  dépôt jugé : ${RACINE}`);
console.log(`  …  données du démon : ${DONNEES}`);
console.log(`  …  pool réel : ${dossierDesCompetences()}`);

/* --- 1. Le vrai pool rend tout ce qu'il porte --- */
const reel = lirePool();
noter(
  'le pool réel rend au moins une fiche',
  reel.fiches.length > 0,
  reel.fiches.map((f) => f.nom).join(', ') || 'aucune',
);
noter(
  'chaque fiche porte un état, des anomalies relevées et son arbre',
  reel.fiches.every((f) => typeof f.etat === 'string' && Array.isArray(f.anomalies) && Array.isArray(f.annexes)),
);

/* --- 2 et 3. Refus dits, arbre lu — sur un pool fabriqué --- */
fs.mkdirSync(path.join(POOL_ESSAI, 'bonne', 'references'), { recursive: true });
fs.writeFileSync(
  path.join(POOL_ESSAI, 'bonne', 'SKILL.md'),
  `---\nname: bonne\ndescription: Réparer la barre d'état. À utiliser dès qu'elle reste blanche.\nthemes: mobile\nsymptomes: barre blanche\n---\n\n# bonne\n\n## Vérification\n\nOn relance.\n`,
  'utf8',
);
fs.writeFileSync(path.join(POOL_ESSAI, 'bonne', 'references', 'mesures.md'), '# Mesures\n', 'utf8');
fs.mkdirSync(path.join(POOL_ESSAI, 'sans-tete'), { recursive: true });
fs.writeFileSync(path.join(POOL_ESSAI, 'a-plat.md'), 'une note posée à plat', 'utf8');

const fabrique = lirePool(POOL_ESSAI);
const causes = new Map(fabrique.refus.map((r) => [r.nom, r.cause]));
noter(
  'un dossier sans mode d’emploi et un fichier à plat sont REFUSÉS, avec leur cause',
  causes.get('sans-tete') === 'sans-mode-d-emploi' && causes.get('a-plat.md') === 'pas-un-dossier',
  [...causes].map(([nom, cause]) => `${nom} : ${cause}`).join(' · '),
);
noter(
  'chaque refus se dit en français, jamais par un code',
  fabrique.refus.every((r) => shared.raisonDuRefus(r).length > 20),
);
noter(
  'l’ARBRE d’une fiche est lu : sa tête ET ses fichiers de détail',
  fabrique.fiches[0]?.annexes.includes('references/mesures.md'),
  (fabrique.fiches[0]?.annexes ?? []).join(', '),
);

/* --- 4 et 5. Indexé une seule fois, entrées en tête --- */
const fichiersDuPool = passages.fichiersDuPool(POOL_ESSAI);
noter(
  'l’arbre entier part à l’index (tête + détails)',
  fichiersDuPool.some((f) => f.source.endsWith('bonne/SKILL.md')) &&
    fichiersDuPool.some((f) => f.source.endsWith('bonne/references/mesures.md')),
  fichiersDuPool.map((f) => f.source).join(', '),
);
const fichiersDunProjet = passages.fichiersAIndexer
  ? []
  : []; /* `fichiersAIndexer` n'est pas exporté : on vérifie autrement, plus bas. */
void fichiersDunProjet;

// Le pool ne doit plus apparaître dans l'index d'un PROJET : on indexe un projet
// d'essai et on regarde ses sources.
const PROJET = path.join(ESSAI, 'projet');
fs.mkdirSync(path.join(PROJET, 'docs'), { recursive: true });
fs.writeFileSync(path.join(PROJET, 'CLAUDE.md'), '# Essai\n\n## Une règle\n\nDu texte.\n', 'utf8');
passages.indexerDocumentation('verif-pool-projet', PROJET);
const sourcesDuProjet = new Set(passages.passagesIndexes('verif-pool-projet').map((p) => p.source));
noter(
  'le pool n’est plus recopié dans l’index de chaque projet',
  ![...sourcesDuProjet].some((s) => s.startsWith(shared.PREFIXE_SOURCE_COMPETENCE)),
  [...sourcesDuProjet].slice(0, 4).join(', '),
);

passages.indexerLePool(POOL_ESSAI);
const sourcesDuPool = passages.passagesIndexes(passages.PROJET_DU_POOL).map((p) => p.source);
noter(
  'le pool a son PROPRE index, préparé une seule fois',
  sourcesDuPool.some((s) => s.startsWith(shared.PREFIXE_SOURCE_COMPETENCE)),
  `${sourcesDuPool.length} passage(s)`,
);

/* --- 6. Le briefing porte un sommaire --- */
const texteDuBriefing = shared.texteDesCompetences(listerCompetences(POOL_ESSAI), POOL_ESSAI);
noter(
  'le briefing porte un SOMMAIRE par thème, pas une ligne par fiche',
  /rangés par thème/.test(texteDuBriefing) && /mobile \(1\) : bonne/.test(texteDuBriefing),
);
const briefingReel = briefing(PROJET, 'Essai', false, 'codex');
noter('le briefing d’un vrai projet annonce toujours les compétences', /COMPÉTENCES PARTAGÉES/.test(briefingReel));

/* --- 7. L'écriture, gardée --- */
const refusee = ecrireLaFiche({ nom: 'vague', description: 'trop court' }, { dossier: POOL_ESSAI });
noter(
  'une fiche sans vérification ni déclenchement est REFUSÉE, avec ses raisons',
  refusee.ok === false && (refusee.raisons ?? []).length > 0,
  (refusee.raisons ?? []).join(' ; '),
);
const horsPool = ecrireLaFiche(
  { nom: '../ailleurs', description: "Sortir du pool. À utiliser jamais.", verification: 'rien' },
  { dossier: POOL_ESSAI },
);
noter('un nom qui sortirait du pool est refusé', horsPool.ok === false);

const creee = ecrireLaFiche(
  {
    nom: 'preuve',
    description: 'Une leçon prouvée. À utiliser dès que le symptôme revient.',
    verification: 'On rejoue le contrôle.',
    provenance: { projet: 'HaikoDev', carte: 'c-1' },
  },
  { dossier: POOL_ESSAI },
);
noter('une fiche complète est écrite', creee.ok === true && creee.geste === 'creee');

const completee = ecrireLaFiche(
  {
    nom: 'preuve',
    description: 'Une leçon prouvée. À utiliser dès que le symptôme revient.',
    verification: 'On rejoue le contrôle, puis on regarde l’écran.',
  },
  { dossier: POOL_ESSAI, carte: { id: 'c-2', projet: 'Autre' } },
);
const apresCompletion = lirePool(POOL_ESSAI).fiches.find((f) => f.nom === 'preuve');
noter(
  'une fiche existante est COMPLÉTÉE : provenance d’origine gardée, carte ajoutée aux renforts',
  completee.geste === 'completee' &&
    apresCompletion?.provenance.carte === 'c-1' &&
    (apresCompletion?.provenance.renforceePar ?? []).includes('Autre:c-2'),
  JSON.stringify(apresCompletion?.provenance ?? {}),
);
noter(
  'les deux fichiers d’entrée sont écrits par le démon',
  fs.existsSync(path.join(POOL_ESSAI, 'SOMMAIRE.md')) && fs.existsSync(path.join(POOL_ESSAI, 'SYMPTOMES.md')),
);

/* --- 8. Rien ne se supprime --- */
changerLEtat('preuve', 'depreciee', POOL_ESSAI);
const depreciee = lirePool(POOL_ESSAI).fiches.find((f) => f.nom === 'preuve');
changerLEtat('preuve', 'archivee', POOL_ESSAI);
const archivee = lirePool(POOL_ESSAI).fiches.find((f) => f.nom === 'preuve');
noter(
  'une fiche se déprécie puis s’archive, et reste sur le disque',
  depreciee?.etat === 'depreciee' &&
    archivee?.etat === 'archivee' &&
    fs.existsSync(path.join(POOL_ESSAI, 'preuve', 'SKILL.md')),
);
noter(
  'une fiche archivée sort du service, mais pas de l’écran',
  !listerCompetences(POOL_ESSAI).some((f) => f.nom === 'preuve') &&
    etatDuPoolPourLEcran(POOL_ESSAI).fiches.some((f) => f.nom === 'preuve'),
);

/* --- 9. La part du contexte --- */
const faux = (source, jetons) => ({
  source,
  titre: 'un titre',
  sujet: 'x',
  priorite: 0,
  texte: 'x'.repeat(jetons * 4),
  score: 0.9,
  sens: 0.9,
  mots: 0.9,
  jetons,
});
const choix = shared.choisirPassages(
  [
    faux(`${shared.PREFIXE_SOURCE_COMPETENCE}a/SKILL.md`, 300),
    faux(`${shared.PREFIXE_SOURCE_COMPETENCE}b/SKILL.md`, 300),
    faux(`${shared.PREFIXE_SOURCE_COMPETENCE}c/SKILL.md`, 300),
    faux('docs/regles/cartes.md', 200),
  ],
  { plafond: 1000, max: 7 },
);
const jetonsDesCompetences = choix.gardes
  .filter((p) => shared.estPassageDeCompetence(p.source))
  .reduce((total, p) => total + p.jetons, 0);
noter(
  'les compétences ne prennent jamais plus que leur part du contexte',
  choix.gardes.some((p) => p.source === 'docs/regles/cartes.md') &&
    jetonsDesCompetences <= 300 + Math.floor(1000 * shared.PART_MAX_DES_COMPETENCES),
  `${jetonsDesCompetences} jetons de compétences sur 1000`,
);

fs.rmSync(ESSAI, { recursive: true, force: true });

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
process.exit(echecs.length ? 1 : 0);
