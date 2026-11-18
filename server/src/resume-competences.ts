import fs from 'node:fs';
import {
  CLE_RESUME_FR,
  MODELE_RESUME_COMPETENCE,
  SCHEMA_RESUME_COMPETENCE,
  URL_OPENROUTER,
  cleOpenRouterDuRelais,
  corpsDuModeDEmploi,
  enTeteAvecCles,
  enTeteDeCompetence,
  ficheAResumer,
  messagesDuResume,
  validerLeResume,
  type Competence,
} from '@beluga/shared';
import { dossierDesCompetences, enregistrerLePool, lirePool, reecrireLesFichiersDEntree } from './competences.js';
import { log } from './logger.js';

/**
 * LE RÉSUMÉ EN FRANÇAIS DES FICHES DE BIBLIOTHÈQUE — l'appel au petit modèle et
 * l'écriture dans le pool. Les règles (quelles fiches, la consigne, la
 * vérification de la sortie) vivent dans `shared/src/resume-competence.ts`.
 *
 * Deux chemins : le LOT, lancé à la main (`scripts/resumer-competences-importees.mjs`),
 * et le FOND, après chaque import accepté d'une bibliothèque
 * (`resumerApresImport`, `server/src/bibliotheques-competences.ts`). Jamais la
 * veille hebdomadaire : elle propose, elle n'importe pas (MEM-4675).
 *
 * Seuls `resume-fr` et — sur une fiche qui n'en a pas — `symptomes` sont écrits,
 * en DERNIÈRES lignes de l'en-tête (là où le réimport les remet : la fiche reste
 * « inchangée »). La description d'origine n'est jamais touchée.
 */

export interface BilanDeResume {
  faites: string[];
  echecs: { nom: string; raison: string }[];
  /** Le coût réel facturé, en dollars (somme des `usage.cost`). */
  cout: number;
  /** Arrêt avant la fin : budget atteint, clé refusée… */
  arret?: string;
}

export interface OptionsDeResume {
  racine?: string;
  /** Ne traiter que ces fiches (par nom) ; absent : toutes celles qui attendent leur résumé. */
  noms?: readonly string[];
  /** La clé OpenRouter ; absente, celle du relais de Beluga Build (coffre-fort). */
  cle?: string;
  modele?: string;
  /** Appels en parallèle : au-delà de 4, la cadence d'OpenRouter refuse (429). */
  parallele?: number;
  /** On s'arrête dès que le coût réel dépasse ce montant, en dollars. */
  plafondDollars?: number;
  /** Au plus tant de fiches (essai). */
  max?: number;
  journal?: (ligne: string) => void;
}

const DELAI_D_UN_APPEL_MS = 60_000;

/** La clé du relais de Beluga Build, lue dans le coffre-fort — jamais une exception. */
async function cleDuRelais(): Promise<string | undefined> {
  try {
    const { listerAcces } = await import('./coffre-fort.js');
    return cleOpenRouterDuRelais(listerAcces());
  } catch {
    return undefined;
  }
}

type Reponse = { ok: true; texte: string; cout: number } | { ok: false; raison: string; passagere: boolean; budget?: boolean };

async function unAppel(cle: string, modele: string, messages: { role: string; content: string }[]): Promise<Reponse> {
  let reponse: Response;
  try {
    reponse = await fetch(URL_OPENROUTER, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cle}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://belugabuild.com',
        'X-Title': 'Beluga Build',
      },
      body: JSON.stringify({
        model: modele,
        messages,
        temperature: 0.2,
        max_tokens: 1_200,
        reasoning: { effort: 'minimal', exclude: true },
        response_format: { type: 'json_schema', json_schema: { name: 'resume_de_competence', strict: true, schema: SCHEMA_RESUME_COMPETENCE } },
        provider: { require_parameters: true },
        usage: { include: true },
      }),
      signal: AbortSignal.timeout(DELAI_D_UN_APPEL_MS),
    });
  } catch (err) {
    return { ok: false, raison: (err as Error).message, passagere: true };
  }
  const corps = (await reponse.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[];
    usage?: { cost?: number };
    error?: { message?: string };
  } | null;
  const cout = Number(corps?.usage?.cost ?? 0) || 0;
  if (!reponse.ok) {
    const message = corps?.error?.message ?? `HTTP ${reponse.status}`;
    const budget = reponse.status === 402 || ((reponse.status === 401 || reponse.status === 403) && /limit|budget|credit/i.test(message));
    const passagere = reponse.status === 429 || reponse.status >= 500 || /provider returned error/i.test(message);
    return { ok: false, raison: `${reponse.status} ${message}`, passagere, budget };
  }
  const texte = corps?.choices?.[0]?.message?.content;
  if (!texte) return { ok: false, raison: 'réponse sans contenu', passagere: true };
  return { ok: true, texte, cout };
}

/** Écrit le résumé (et les symptômes d'une fiche qui n'en a pas) en fin d'en-tête. */
function ecrireLeResume(fiche: Competence, resume: string, symptomes: string[]): void {
  const actuel = fs.readFileSync(fiche.fichier, 'utf8');
  const entete = enTeteDeCompetence(actuel);
  // Relu à l'instant : un classement posé entre-temps n'est pas écrasé.
  if (entete.resumeFr?.trim()) return;
  const cles: Record<string, string | undefined> = {
    symptomes: entete.symptomes?.trim() ? undefined : symptomes.join(', '),
    [CLE_RESUME_FR]: resume,
  };
  fs.writeFileSync(fiche.fichier, enTeteAvecCles(actuel, cles), 'utf8');
}

/**
 * RÉSUMER LES FICHES QUI L'ATTENDENT. Reprise idempotente : une fiche qui a déjà
 * son résumé n'est jamais renvoyée au modèle. Trois essais espacés sur une panne
 * passagère (429, 5xx, « Provider returned error », réponse vide) ; un budget
 * épuisé arrête tout le lot.
 */
export async function resumerLesCompetences(options: OptionsDeResume = {}): Promise<BilanDeResume> {
  const racine = options.racine ?? dossierDesCompetences();
  const journal = options.journal ?? ((ligne: string) => log.info(ligne));
  const bilan: BilanDeResume = { faites: [], echecs: [], cout: 0 };
  const cle = options.cle ?? (await cleDuRelais());
  if (!cle) {
    bilan.arret = 'aucune clé OpenRouter (fiche « OpenRouter — Haiko — relais IA » du coffre-fort)';
    return bilan;
  }
  const modele = options.modele ?? MODELE_RESUME_COMPETENCE;
  const plafond = options.plafondDollars ?? 2;
  const voulues = options.noms ? new Set(options.noms) : null;
  let file = lirePool(racine).fiches.filter((f) => ficheAResumer(f) && (!voulues || voulues.has(f.nom)));
  if (options.max !== undefined) file = file.slice(0, options.max);
  const total = file.length;
  let rang = 0;

  const traiter = async (fiche: Competence): Promise<void> => {
    let texte = '';
    try {
      texte = fs.readFileSync(fiche.fichier, 'utf8');
    } catch (err) {
      bilan.echecs.push({ nom: fiche.nom, raison: `illisible : ${(err as Error).message}` });
      return;
    }
    const messages = messagesDuResume(fiche, corpsDuModeDEmploi(texte));
    for (let essai = 1; essai <= 3; essai += 1) {
      if (bilan.arret) return;
      const r = await unAppel(cle, modele, messages);
      if (r.ok) {
        bilan.cout += r.cout;
        const valide = validerLeResume(r.texte);
        if (valide.ok) {
          try {
            ecrireLeResume(fiche, valide.resume, valide.symptomes);
            bilan.faites.push(fiche.nom);
          } catch (err) {
            bilan.echecs.push({ nom: fiche.nom, raison: `écriture impossible : ${(err as Error).message}` });
          }
          return;
        }
        if (essai === 3) bilan.echecs.push({ nom: fiche.nom, raison: valide.raison });
        continue;
      }
      if (r.budget) {
        bilan.arret = `budget OpenRouter épuisé : ${r.raison}`;
        return;
      }
      if (!r.passagere || essai === 3) {
        bilan.echecs.push({ nom: fiche.nom, raison: r.raison });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 4_000 * essai));
    }
  };

  const ouvriers = Array.from({ length: Math.max(1, Math.min(options.parallele ?? 4, 6)) }, async () => {
    while (!bilan.arret) {
      const fiche = file.shift();
      if (!fiche) return;
      rang += 1;
      await traiter(fiche);
      if (bilan.cout > plafond) bilan.arret = `plafond de ${plafond} $ atteint (${bilan.cout.toFixed(4)} $ dépensés)`;
      if (rang % 50 === 0) journal(`résumés : ${rang}/${total} — ${bilan.faites.length} écrit(s), ${bilan.echecs.length} échec(s), ${bilan.cout.toFixed(4)} $`);
    }
  });
  await Promise.all(ouvriers);
  journal(
    `résumés en français : ${bilan.faites.length} fiche(s) sur ${total}, ${bilan.echecs.length} échec(s), coût réel ${bilan.cout.toFixed(4)} $` +
      (bilan.arret ? ` — arrêt : ${bilan.arret}` : ''),
  );
  return bilan;
}

/**
 * APRÈS UN IMPORT ACCEPTÉ : les fiches nouvelles ou mises à jour qui n'ont pas
 * de résumé le reçoivent, EN FOND — l'import a déjà rendu la main. Un échec ne
 * fait que se dire au journal ; la fiche reste servie par sa description, et un
 * prochain import (ou le lot) la reprendra.
 */
export function resumerApresImport(noms: readonly string[], racine = dossierDesCompetences()): void {
  if (!noms.length) return;
  void (async () => {
    try {
      const bilan = await resumerLesCompetences({ racine, noms, plafondDollars: 1 });
      if (!bilan.faites.length) {
        if (bilan.arret) log.warn(`résumés après import : ${bilan.arret}`);
        return;
      }
      reecrireLesFichiersDEntree(racine);
      void enregistrerLePool(racine, `résume en français ${bilan.faites.length} fiche(s) importée(s)`);
      const { synchroniserSansEchec } = await import('./competences-memoire.js');
      synchroniserSansEchec(bilan.faites);
    } catch (err) {
      log.warn(`résumés après import abandonnés : ${(err as Error).message}`);
    }
  })();
}
