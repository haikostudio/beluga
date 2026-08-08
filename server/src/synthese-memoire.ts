import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SEUIL_SYNTHESE, doitSynthetiser, nettoyer, syntheseAcceptable } from '@haikodev/shared';
import { memoryFacts, readMemory, replaceMemory } from './memory.js';
import { adapterFor } from './engines/index.js';
import { log } from './logger.js';

const execFileAsync = promisify(execFile);

/**
 * La SYNTHÈSE de la mémoire. Avant, au-delà d'un plafond, les plus anciennes
 * lignes étaient coupées à l'aveugle : un piège écrit six mois plus tôt et
 * toujours vrai disparaissait sans que personne le sache.
 *
 * Désormais, au-delà d'un seuil, un petit modèle (Haiku, le moins gourmand)
 * relit la mémoire, fusionne les faits voisins, réécrit plus court et retire ce
 * qui est manifestement périmé. La version d'avant est déposée à côté du
 * fichier : la synthèse est relisible et réversible.
 */

const FICHIER_AVANT = 'MEMOIRE.avant-synthese.md';
const MODELE = 'haiku';

/** Une synthèse à la fois par projet : deux réécritures en parallèle se marcheraient dessus. */
const enCours = new Set<string>();

const CONSIGNE = `Tu relis la MÉMOIRE d'un projet logiciel : une liste de faits durables et de pièges, écrits en français simple par des agents successifs.

Ta tâche : la réécrire plus courte, SANS rien perdre d'utile.
- Fusionne les faits qui parlent de la même chose en une seule ligne.
- Retire ce qui est manifestement périmé (un fait remplacé plus bas par sa version corrigée : garde la version corrigée).
- Retire les lignes qui racontent une livraison datée plutôt qu'une règle.
- Garde le VERBE de la règle et la RAISON quand elle existe : c'est la raison qui évite qu'on refasse l'erreur.
- N'invente rien, ne généralise pas, ne change pas le sens.
- Français simple, une ligne par fait, chaque ligne commence par « - ».

Réponds UNIQUEMENT par la liste réécrite. Aucun titre, aucun commentaire, aucune explication.`;

/** Le petit modèle, lancé par le moteur déjà authentifié — aucune clé facturée. */
async function relireAvecHaiku(faits: string[], cwd: string): Promise<string[]> {
  const binaire = adapterFor('claude').binary;
  const prompt = `${CONSIGNE}\n\nLA MÉMOIRE À RÉÉCRIRE (${faits.length} faits) :\n${faits.map((f) => `- ${f}`).join('\n')}`;
  const { stdout } = await execFileAsync(
    binaire,
    ['-p', prompt, '--model', MODELE, '--output-format', 'text'],
    { cwd, timeout: 180000, maxBuffer: 8 * 1024 * 1024 },
  );
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map(nettoyer)
    .filter(Boolean);
}

export interface ResultatSynthese {
  fait: boolean;
  avant: number;
  apres: number;
  raison?: string;
}

/** La synthèse, de bout en bout. Elle ne jette jamais la mémoire d'origine. */
export async function synthetiserMemoire(projectPath: string): Promise<ResultatSynthese> {
  const avant = memoryFacts(projectPath);
  if (avant.length < 10) return { fait: false, avant: avant.length, apres: avant.length, raison: 'mémoire trop courte' };

  const apres = await relireAvecHaiku(avant, projectPath);
  const verdict = syntheseAcceptable(avant, apres);
  if (!verdict.ok) {
    log.warn(`mémoire : synthèse refusée (${verdict.raison})`);
    return { fait: false, avant: avant.length, apres: apres.length, raison: verdict.raison };
  }

  // Réversible : la version d'avant reste à côté, dans le dépôt. La mémoire
  // étant découpée par sujet, on dépose son texte RÉUNI — un seul fichier à
  // relire, exactement comme avant le découpage.
  try {
    fs.writeFileSync(path.join(projectPath, FICHIER_AVANT), readMemory(projectPath), 'utf8');
  } catch (err) {
    log.warn('mémoire : copie de sauvegarde impossible', err);
  }
  replaceMemory(projectPath, apres);
  log.info(`mémoire : synthèse ${avant.length} → ${apres.length} faits (${projectPath})`);
  return { fait: true, avant: avant.length, apres: apres.length };
}

/**
 * Le déclencheur, appelé après chaque ajout de fait. Il ne bloque jamais la
 * tâche en cours : la synthèse tourne à côté, et un échec ne se voit que dans
 * le journal du démon.
 */
export function synthetiserSiNecessaire(projectPath: string, seuil = SEUIL_SYNTHESE): void {
  if (enCours.has(projectPath)) return;
  if (!doitSynthetiser(memoryFacts(projectPath), seuil)) return;
  enCours.add(projectPath);
  synthetiserMemoire(projectPath)
    .catch((err) => log.warn('mémoire : synthèse impossible', err))
    .finally(() => enCours.delete(projectPath));
}
