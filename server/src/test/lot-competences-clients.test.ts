import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import {
  descriptionDUneLigne,
  jugerCompetence,
  jugerCompetencePourClients,
  manifesteDepuisTexte,
  sourceProtegee,
  teteDeFicheProtegee,
  cheminHorsDuLot,
  registreDepuisTexte,
} from '@beluga/shared';
import {
  chiffrerLaFiche,
  dechiffrerLaFiche,
  fabriquerLeLot,
  fichiersDeLaFiche,
  ouvrirLaFicheProtegee,
  effacerLesDechiffrementsDeLAgent,
  retenirLaCleDesCompetences,
  cheminDansUnDechiffrement,
} from '../lot-competences-clients.js';

const fiche = (nom: string, tete: string, corps = 'Un mode d’emploi générique.') =>
  `---\nname: ${nom}\ndescription: À utiliser dès que l’on veut faire ${nom}.\n${tete}\n---\n\n# ${nom}\n\n${corps}\n`;

test('le lot des clients prend tout le pool non sensible — beluga-, bibliothèques et thèmes privés compris', () => {
  const part = (nom: string, tete: string, corps?: string) => jugerCompetencePourClients({ nom, texte: fiche(nom, tete, corps) }, ['Clientissime']);
  assert.equal(part('beluga-interne', 'themes: cartes').part, true);
  assert.equal(part('importee', 'themes: interface\nprovenance-bibliotheque: autrui').part, true);
  assert.equal(part('sans-theme', 'etat: active').part, true);
  // …mais rien de ce qui est sensible.
  assert.match(part('propre', 'projets: Projetix').raison, /propre à un projet/);
  assert.match(part('nuance', 'etend: autre').raison, /nuance/);
  assert.match(part('archivee', 'etat: archivee').raison, /archivee/);
  assert.match(part('ip', '', 'Le serveur 91.98.12.34 répond.').raison, /adresse IP/);
  assert.match(part('client', '', 'Comme sur Clientissime, le tiroir…').raison, /projet ou un client/);
  assert.match(part('cle', '', 'export X=sk-abcdefghijklmnopqrstuv1234').raison, /clé/);
  assert.match(part('perso', '', 'Lancer /root/outil.sh').raison, /chemin personnel/);
  assert.equal(
    jugerCompetencePourClients({ nom: 'annexe', texte: fiche('annexe', ''), annexes: { 'notes.md': 'mot de passe : Tr0ub4dor&3xyz' } }, []).part,
    false,
  );
});

test('une bibliothèque protégée part chiffrée : registre ou organisation digital-tales-cerveaux', () => {
  assert.equal(sourceProtegee('https://github.com/digital-tales-cerveaux/ux-brain.git'), true);
  assert.equal(sourceProtegee('https://github.com/anthropics/skills.git'), false);
  const parSource = jugerCompetencePourClients(
    { nom: 'ux-brain', texte: fiche('ux-brain', 'provenance-source: https://github.com/digital-tales-cerveaux/ux-brain.git') },
    [],
  );
  assert.deepEqual([parSource.part, parSource.protegee], [true, true]);
  assert.equal(jugerCompetencePourClients({ nom: 'x', texte: fiche('x', '') }, [], { protegee: true }).protegee, true);
  assert.equal(jugerCompetencePourClients({ nom: 'x', texte: fiche('x', '') }, []).protegee, false);
  // Le drapeau du registre se lit.
  const registre = registreDepuisTexte(JSON.stringify({ 'digital-tales-ux': { source: 's', importeeLe: 1, competences: ['ux-brain'], protegee: true } }));
  assert.equal(registre['digital-tales-ux'].protegee, true);
});

test('le tri du dépôt public : un cerveau de Digital Tales n’y part jamais, une fiche beluga- part', () => {
  const texte = fiche('importee', 'themes: interface\nprovenance-bibliotheque: digital-tales-ux');
  assert.equal(jugerCompetence({ nom: 'importee', texte }, []).publiee, false);
  assert.equal(jugerCompetence({ nom: 'beluga-x', texte: fiche('beluga-x', 'themes: interface') }, []).publiee, true);
  assert.match(jugerCompetence({ nom: 'ip', texte: fiche('ip', 'themes: interface', '91.98.12.34') }, []).raison, /adresse IP/);
  assert.equal(jugerCompetence({ nom: 'ok', texte: fiche('ok', 'themes: interface') }, []).publiee, true);
});

test('la tête réduite d’une fiche protégée ne porte que son nom et une ligne', () => {
  const longue = 'Une description '.repeat(40);
  const tete = teteDeFicheProtegee('ux-brain', longue);
  assert.match(tete, /^---\nname: ux-brain\n/);
  assert.match(tete, /protegee: oui/);
  assert.ok(descriptionDUneLigne(longue).length <= 181);
  assert.equal(cheminHorsDuLot('.raw/secrets/x.md'), true);
  assert.equal(cheminHorsDuLot('scripts/.venv/bin/python'), true);
  assert.equal(cheminHorsDuLot('wiki/page.md'), false);
  assert.equal(manifesteDepuisTexte('{"format":1,"version":"zz","fiches":[]}'), null);
});

function poolDEssai(): { pool: string; sortie: string } {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'lot-clients-'));
  const pool = path.join(racine, 'competences');
  const poser = (nom: string, texte: string, annexes: Record<string, string> = {}) => {
    fs.mkdirSync(path.join(pool, nom), { recursive: true });
    fs.writeFileSync(path.join(pool, nom, 'SKILL.md'), texte);
    for (const [relatif, contenu] of Object.entries(annexes)) {
      fs.mkdirSync(path.dirname(path.join(pool, nom, relatif)), { recursive: true });
      fs.writeFileSync(path.join(pool, nom, relatif), contenu);
    }
  };
  poser('bouton-propre', fiche('bouton-propre', 'themes: interface'));
  poser('cerveau-secret', fiche('cerveau-secret', 'license: Proprietary', 'PHRASE-SECRETE-DU-CERVEAU'), {
    'wiki/page.md': 'Encore du contenu protégé : PHRASE-SECRETE-DU-CERVEAU',
    '.raw/secrets/client.md': 'jamais transporté',
  });
  poser('fiche-projet', fiche('fiche-projet', 'projets: Projetix'));
  return { pool, sortie: path.join(racine, 'lots') };
}

test('le lot fabriqué chiffre les fiches protégées, n’en laisse aucun fichier en clair, et se relit', () => {
  const { pool, sortie } = poolDEssai();
  const cle = crypto.randomBytes(32);
  const lot = fabriquerLeLot({ pool, sortie, cle, nomsPrives: [], protegees: new Set(['cerveau-secret']) });
  assert.deepEqual(
    lot.manifeste.fiches.map((f) => `${f.nom}:${f.protegee}`),
    ['bouton-propre:false', 'cerveau-secret:true'],
  );
  assert.match(lot.verdicts.find((v) => v.nom === 'fiche-projet')!.raison, /propre à un projet/);
  // L'archive extraite : la phrase secrète n'apparaît nulle part.
  const extrait = fs.mkdtempSync(path.join(os.tmpdir(), 'lot-extrait-'));
  execFileSync('tar', ['-xzf', lot.archive, '-C', extrait]);
  assert.equal(fichiersQuiNomment(extrait, 'PHRASE-SECRETE').length, 0, 'aucun fichier en clair de la fiche protégée');
  assert.ok(fs.existsSync(path.join(extrait, 'cerveau-secret', 'contenu.chiffre')));
  assert.ok(!fs.existsSync(path.join(extrait, 'cerveau-secret', 'wiki')));
  assert.ok(fs.existsSync(path.join(extrait, 'bouton-propre', 'SKILL.md')));
  assert.ok(manifesteDepuisTexte(fs.readFileSync(path.join(extrait, 'manifeste.json'), 'utf8')));
  // Même contenu, même clé : même version, rien n'est refait.
  const encore = fabriquerLeLot({ pool, sortie, cle, nomsPrives: [], protegees: new Set(['cerveau-secret']) });
  assert.equal(encore.version, lot.version);
  assert.equal(encore.dejaFabrique, true);

  // Le serveur loué ouvre la fiche le temps d'un tour, puis l'efface.
  process.env.BELUGA_DECHIFFREMENTS = fs.mkdtempSync(path.join(os.tmpdir(), 'ouvertes-'));
  process.env.BELUGA_FICHIER_ENV_HOTE = path.join(extrait, 'absent.env');
  const env: NodeJS.ProcessEnv = { BELUGA_CLE_COMPETENCES: cle.toString('hex') };
  retenirLaCleDesCompetences(env);
  assert.equal(env.BELUGA_CLE_COMPETENCES, undefined, 'la clé quitte l’environnement hérité');
  const ouverte = ouvrirLaFicheProtegee(extrait, 'cerveau-secret', 'agent-1')!;
  assert.match(fs.readFileSync(ouverte.fichier, 'utf8'), /PHRASE-SECRETE-DU-CERVEAU/);
  assert.ok(fs.existsSync(path.join(ouverte.dossier, 'wiki', 'page.md')));
  assert.ok(cheminDansUnDechiffrement(ouverte.fichier));
  assert.equal(ouvrirLaFicheProtegee(extrait, 'bouton-propre', 'agent-1'), null, 'une fiche en clair ne passe pas par là');
  effacerLesDechiffrementsDeLAgent('agent-1');
  assert.ok(!fs.existsSync(ouverte.dossier));
});

test('un contenu chiffré déplacé sous un autre nom, ou ouvert avec une autre clé, ne se lit pas', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'fiche-'));
  fs.writeFileSync(path.join(dossier, 'SKILL.md'), 'secret');
  const cle = crypto.randomBytes(32);
  const blob = chiffrerLaFiche('a', fichiersDeLaFiche(dossier), cle);
  assert.equal(dechiffrerLaFiche('a', blob, cle)[0].contenu.toString(), 'secret');
  assert.throws(() => dechiffrerLaFiche('b', blob, cle));
  assert.throws(() => dechiffrerLaFiche('a', blob, crypto.randomBytes(32)));
});

/** Les fichiers d'un dossier dont le contenu porte `texte`. */
function fichiersQuiNomment(dossier: string, texte: string): string[] {
  const trouves: string[] = [];
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true, recursive: true })) {
    if (!entree.isFile()) continue;
    const plein = path.join(entree.parentPath, entree.name);
    if (fs.readFileSync(plein).includes(texte)) trouves.push(plein);
  }
  return trouves;
}
