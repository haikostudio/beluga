#!/usr/bin/env node
/**
 * LE DÉCOR DU DÉMON D'ESSAI NE SE RECOPIE PLUS.
 *
 * Les contrôles de `scripts/` montent presque tous le même décor avant de
 * regarder quoi que ce soit : dossier temporaire, `DATA`/`PROJETS`/`DEPOT`,
 * dépôt git d'essai, `spawn` du démon, journal capturé, nettoyage à la sortie,
 * `attendrePort`. Il vit maintenant dans `scripts/lib/demon-d-essai.mjs`.
 *
 * Ce contrôle tient la ligne : il compte ce qui recopie encore le décor à la
 * main et refuse que ce nombre REMONTE. Les scripts qui s'écartent du modèle
 * (démon relancé en cours de route, nettoyage qui ferme autre chose, lot
 * `verify-agents*`) sont nommés ici et restent tolérés.
 *
 *   node scripts/verif-decor-demon-essai.mjs
 *
 * Lecture du dépôt seule : aucun démon lancé, aucun jeton dépensé.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerResultats } from './lib/verif-resultats.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(RACINE, 'scripts');
const { results, record: noter } = creerResultats();

/* Ceux dont le décor est VRAIMENT différent : ils gardent le leur, exprès. */
const TOLERES = new Set([
  'verify-agents.mjs',
  'verify-agents2.mjs',
  'verify-agents3.mjs',
  'verif-arret-en-force.mjs',
  'verif-assistant-moteurs.mjs',
  'verif-assistant-vocal.mjs',
  'verif-attente-question.mjs',
  'verif-canal-coupe.mjs',
  'verif-carte-fil-cadrage.mjs',
  'verif-carte-finie-qui-tourne-encore.mjs',
  'verif-cloison-client.mjs',
  'verif-copier-message-jointes.mjs',
  'verif-cycle-de-vie-carte.mjs',
  'verif-demande-affichee-aussitot.mjs',
  'verif-erreurs-interface.mjs',
  'verif-espace-client.mjs',
  'verif-favicon-projets.mjs',
  'verif-flux-compte-et-plan.mjs',
  'verif-messagerie-mobile.mjs',
  'verif-moteur-cursor.mjs',
  'verif-notifications.mjs',
  'verif-parcours-telephone.mjs',
  'verif-procedure-publication.mjs',
  'verif-prompt-envoye-tour-lance.mjs',
  'verif-redemarrage-attend-tache.mjs',
  'verif-reglages-etroit.mjs',
  'verif-reglages-proposition.mjs',
  'verif-relais-llm.mjs',
  'verif-reprise-carte.mjs',
  'verif-retrait-compte.mjs',
  'verif-rien-ne-fige-a-l-envoi.mjs',
  'verif-backups.mjs',
  'verif-surveillance.mjs',
  'verif-taches-fin-de-tour.mjs',
  'verif-temoin-pendant-commandes.mjs',
  'verif-temoin-reflexion.mjs',
]);

const fichiers = fs.readdirSync(SCRIPTS).filter((f) => f.endsWith('.mjs'));
const aLaMain = [];
const migres = [];

for (const f of fichiers) {
  const texte = fs.readFileSync(path.join(SCRIPTS, f), 'utf8');
  if (f === 'verif-decor-demon-essai.mjs') continue;
  if (texte.includes('demarrerDemonDEssai')) {
    migres.push(f);
    continue;
  }
  if (!texte.includes("const DATA = path.join(TMP, 'data')")) continue;
  if (TOLERES.has(f)) continue;
  aLaMain.push(f);
}

noter(
  'aucun décor de démon d’essai recopié hors des scripts tolérés',
  aLaMain.length === 0,
  aLaMain.length ? aLaMain.join(', ') + ' — appeler demarrerDemonDEssai()' : `${migres.length} script(s) passés par l’aide partagée`,
);

/* L'aide elle-même doit rester en place et rendre ce que les scripts attendent. */
const aide = path.join(SCRIPTS, 'lib', 'demon-d-essai.mjs');
const texteAide = fs.existsSync(aide) ? fs.readFileSync(aide, 'utf8') : '';
noter('l’aide partagée existe', !!texteAide, aide.replace(RACINE + '/', ''));
for (const rendu of ['TMP', 'DATA', 'PROJETS', 'DEPOT', 'demon', 'journal', 'nettoyer', 'attendrePort']) {
  noter(`l’aide rend « ${rendu} »`, new RegExp('\\b' + rendu + '\\b').test(texteAide));
}
for (const option of ['prefixe', 'tmp', 'port', 'env', 'depot', 'messageCommit', 'dossiers', 'signaux']) {
  noter(`l’aide accepte l’option « ${option} »`, new RegExp('\\n\\s*' + option + '\\s*[,=:]').test(texteAide));
}

/*
 * ZONE MORTE : ce qui est CITÉ dans l'appel doit être déclaré AVANT lui. Une
 * constante posée après l'appel et utilisée dedans passe `node --check` sans
 * broncher, puis tombe à l'exécution.
 */
const zonesMortes = [];
for (const f of migres) {
  const texte = fs.readFileSync(path.join(SCRIPTS, f), 'utf8');
  const iAppel = texte.indexOf('demarrerDemonDEssai({');
  if (iAppel < 0) continue;
  const debut = texte.lastIndexOf('\nconst {', iAppel) + 1;
  const fin = texte.indexOf('\n});\n', iAppel) + 5;
  const rendus = new Set(
    (texte.slice(debut, iAppel).match(/\{([^}]*)\}/)?.[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  );
  const corps = texte
    .slice(iAppel, fin)
    .replace(/'[^']*'/g, "''")
    .replace(/`[^`]*`/g, '``')
    .replace(/\.\w+/g, '.')
    .replace(/^\s*\w+:/gm, '');
  const amont = texte.slice(0, debut);
  for (const nom of new Set(corps.match(/\b[A-Z][A-Z_0-9]*\b/g) ?? [])) {
    if (rendus.has(nom) || nom === 'RACINE' || nom === 'TMP' && rendus.has('TMP')) continue;
    const declare = new RegExp('(?:^|\\n)\\s*(?:const|let|var)\\s+' + nom + '\\b').test(amont);
    if (!declare) zonesMortes.push(`${f} → ${nom}`);
  }
}
noter('rien n’est cité dans l’appel avant d’être déclaré', zonesMortes.length === 0, zonesMortes.join(', '));

const echecs = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - echecs.length}/${results.length} contrôles tenus — ` +
    `${migres.length} script(s) sur l’aide partagée, ${TOLERES.size} toléré(s).`,
);
process.exit(echecs.length ? 1 : 0);
