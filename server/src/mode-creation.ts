/**
 * LE MODE « CRÉATION » CÔTÉ DÉMON — le tour de service qui consulte un autre
 * moteur, le juge qui départage, la consigne qui part avec la demande.
 *
 * Les règles (qui répond à quel rôle, repli sans quota, plafonds, suggestion
 * acceptée) sont PURES et vivent dans `shared/src/mode-creation.ts`. Ici, on
 * les applique au vrai monde : catalogue des moteurs, comptes, processus.
 *
 * LE TOUR DE SERVICE D'UNE DÉLÉGATION :
 *  - BORNÉ (`DELAI_DELEGATION_MS`) : un moteur muet est coupé, jamais attendu ;
 *  - INSCRIT comme moteur de service de l'agent chef (`suivreLeService`) : le
 *    bouton d'arrêt le coupe avec le reste (MEM-0343) ;
 *  - EN LECTURE : outils d'écriture fermés, bac à sable en lecture seule — seul
 *    le chef modifie la copie de travail, jamais deux agents à la fois ;
 *  - SANS OUTILS DU DÉMON : aucune configuration MCP, et Claude part toujours
 *    en `--strict-mcp-config` (MEM-2556) ;
 *  - SUR UN COMPTE QUI A DU QUOTA (`pickAccount`), jamais sur le compte du chef
 *    par défaut ;
 *  - CURSOR DANS UN DOSSIER À LUI : un tour Cursor tient le verrou de son
 *    dossier jusqu'à sa fin (`avecVerrouCwd`). Un chef sous Cursor qui
 *    consulterait Cursor dans la MÊME copie s'attendrait lui-même : le délégué
 *    part donc d'un dossier vide, la copie de la carte ouverte en lecture.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AgentQuestion,
  PLAFOND_DELEGATIONS_PAR_TOUR,
  PROPOSITIONS_A_DEPARTAGER_MAX,
  ROLES_CREATION,
  cleDeProposition,
  consigneDuModeCreation,
  moteursDAvis,
  nomDuMoteurCreation,
  numeroDeProposition,
  questionDeSuggestion,
  reglageCreation,
  resoudreRoleCreation,
  surchargesAcceptees,
  type AffectationCreation,
  type Card,
  type ChoixCreation,
  type IdMoteur,
  type RoleCreation,
  estUnMoteur,
  descriptionMoteur,
} from '@beluga/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { log } from './logger.js';
import { catalogueMoteurs } from './catalogue-moteurs.js';
import { applyAccountEnv, pickAccount } from './accounts.js';
import { adapterFor } from './engines/index.js';
import { layaPret } from './laya.js';
import { interroger, usageDuJugeAllume } from './jugement-rapide.js';
import { dossiersDeDonneesOuverts } from './pieces-jointes.js';

/** Le plafond d'une délégation : au-delà, le moteur consulté est coupé. */
export const DELAI_DELEGATION_MS = 6 * 60_000;

/** La réponse rendue au chef, bornée : un avis n'est pas un roman. */
const PLAFOND_REPONSE = 24_000;

/** Les outils qu'un moteur consulté n'a jamais : il lit, il n'écrit pas. */
const OUTILS_FERMES_AU_DELEGUE = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'Task', 'Agent'];

/* ------------------------------------------------------------------ */
/* L'état de la carte                                                  */
/* ------------------------------------------------------------------ */

/** Le mode est-il allumé sur la carte de cet agent ? */
export function creationAllumeePourLAgent(agentId: string): boolean {
  const agent = store.getAgent(agentId);
  if (!agent?.cardId) return false;
  return !!store.getCard(agent.cardId)?.parcours?.creationSouhaitee;
}

/**
 * LES SUGGESTIONS ACCEPTÉES, lues dans le fil de l'agent qui les a posées :
 * la réponse vit sur la question, jamais recopiée à côté.
 */
export function surchargesDeLaCarte(card: Card): Partial<Record<RoleCreation, AffectationCreation>> {
  const suggestions = card.parcours?.creationSuggestions ?? [];
  if (!suggestions.length) return {};
  const reponses = new Map<string, string | undefined>();
  const agents = new Set(suggestions.map((s) => s.agentId).filter((id): id is string => !!id));
  for (const agentId of agents) {
    for (const message of store.listMessages(agentId)) {
      for (const question of message.questions ?? []) reponses.set(question.id, question.answer);
    }
  }
  return surchargesAcceptees(suggestions, reponses);
}

function jugeDisponible(): boolean {
  return layaPret() && usageDuJugeAllume('evaluation-creation');
}

/** Le bloc du mode, prêt à partir avec la demande du tour. */
export async function consigneDeCreationDeLaCarte(card: Card): Promise<string> {
  if (!card.parcours?.creationSouhaitee) return '';
  return consigneDuModeCreation({
    reglage: reglageCreation(store.getSettings().creation),
    catalogue: await catalogueMoteurs(),
    surcharges: surchargesDeLaCarte(card),
    jugeDisponible: jugeDisponible(),
  });
}

/* ------------------------------------------------------------------ */
/* Les compteurs d'un tour du chef                                     */
/* ------------------------------------------------------------------ */

interface CompteDuTour {
  total: number;
  avis: number;
}

/** Par tour du chef (son message en cours) : combien de délégations, dont d'avis. */
const comptesParTour = new Map<string, CompteDuTour>();

async function cleDuTour(agentId: string): Promise<string> {
  const runtime = await import('./runtime.js');
  return `${agentId}:${runtime.liveRun(agentId)?.messageId ?? 'hors-tour'}`;
}

function compteDe(cle: string): CompteDuTour {
  const existant = comptesParTour.get(cle);
  if (existant) return existant;
  // Un tour à la fois par agent : on oublie les tours précédents du même chef.
  const agent = cle.split(':')[0];
  for (const autre of comptesParTour.keys()) if (autre.startsWith(`${agent}:`)) comptesParTour.delete(autre);
  const neuf = { total: 0, avis: 0 };
  comptesParTour.set(cle, neuf);
  return neuf;
}

/* ------------------------------------------------------------------ */
/* Les trois outils                                                    */
/* ------------------------------------------------------------------ */

export interface ContexteCreation {
  agentId: string;
  projectId: string;
  cardId?: string;
}

export interface ResultatCreation {
  ok: boolean;
  text: string;
  question?: AgentQuestion;
}

const REFUS_MODE_ETEINT = 'Le mode Création n’est pas allumé sur cette carte : fais le travail toi-même.';

function roleLu(brut: unknown): RoleCreation | undefined {
  return (ROLES_CREATION as readonly string[]).includes(String(brut)) ? (brut as RoleCreation) : undefined;
}

function moteurLu(brut: unknown): IdMoteur | undefined {
  return estUnMoteur(brut) ? brut : undefined;
}

/** Le dossier que le délégué lit : la copie de la carte, sinon le projet. */
function dossierALire(agentId: string, projectId: string): string | undefined {
  const agent = store.getAgent(agentId);
  const copie = (agent as { workdir?: string } | null)?.workdir;
  if (copie && fs.existsSync(copie)) return copie;
  const projet = store.getProject(projectId)?.path;
  return projet && fs.existsSync(projet) ? projet : undefined;
}

function promptDuDelegue(options: {
  role: RoleCreation;
  consigne: string;
  fichiers: string[];
  dossier?: string;
}): string {
  const mission: Record<RoleCreation, string> = {
    texte: 'Tu rédiges. On attend un TEXTE prêt à l’emploi, soigné, dans la langue de la consigne.',
    code: 'Tu programmes. On attend du CODE prêt à coller (blocs complets, chemin de fichier en tête de chaque bloc), avec deux lignes d’explication au plus.',
    avis: 'Tu donnes un REGARD NEUF : ce qui manque, ce qui cloche, une alternative plus créative ou plus solide. Sois concret et bref.',
  };
  return [
    'Un autre agent (le chef) te consulte pour une contribution PONCTUELLE. Tu n’as aucun outil du projet, tu ne poses aucune question et tu ne MODIFIES AUCUN FICHIER : tu peux lire, puis tu rends ta contribution en texte, et rien d’autre.',
    mission[options.role],
    options.dossier ? `Le travail en cours vit dans : ${options.dossier}` : null,
    options.fichiers.length
      ? `Fichiers utiles (chemins relatifs à ce dossier) :\n${options.fichiers.map((f) => `- ${f}`).join('\n')}`
      : null,
    '',
    'CONSIGNE DU CHEF :',
    options.consigne,
  ]
    .filter((ligne): ligne is string => ligne !== null)
    .join('\n');
}

/**
 * « deleguer » : un tour de service d'un autre moteur, rendu en texte au chef.
 * Ne lève jamais : chaque échec se DIT, et le chef fait alors le travail lui-même.
 */
export async function deleguer(ctx: ContexteCreation, args: Record<string, unknown>): Promise<ResultatCreation> {
  const card = ctx.cardId ? store.getCard(ctx.cardId) : null;
  if (!card?.parcours?.creationSouhaitee) return { ok: false, text: REFUS_MODE_ETEINT };

  const role = roleLu(args.role);
  if (!role) return { ok: false, text: 'Rôle inconnu : « texte », « code » ou « avis ».' };
  const consigne = String(args.consigne ?? '').trim();
  if (!consigne) return { ok: false, text: 'La consigne est vide : dis précisément ce que tu attends.' };
  const fichiers = (Array.isArray(args.fichiers) ? args.fichiers : [])
    .map((f) => String(f ?? '').trim())
    .filter(Boolean)
    .slice(0, 20);

  const cle = await cleDuTour(ctx.agentId);
  const compte = compteDe(cle);
  if (compte.total >= PLAFOND_DELEGATIONS_PAR_TOUR) {
    return {
      ok: false,
      text: `Plafond atteint : ${PLAFOND_DELEGATIONS_PAR_TOUR} délégations dans ce tour. Termine avec ce que tu as.`,
    };
  }

  const reglage = reglageCreation(store.getSettings().creation);
  const catalogue = await catalogueMoteurs();
  const surcharges = surchargesDeLaCarte(card);
  let choix: ChoixCreation | null;
  if (role === 'avis') {
    const ouverts = moteursDAvis(reglage, catalogue, compte.avis, surcharges.avis);
    if (!ouverts.length) {
      return {
        ok: false,
        text:
          compte.avis >= reglage.plafondAvis
            ? `Plafond d’avis atteint (${reglage.plafondAvis} par tour).`
            : 'Aucun moteur d’avis n’a de compte disponible en ce moment : continue sans.',
      };
    }
    const vise = moteurLu(args.moteur);
    choix = ouverts.find((o) => o.moteur === vise) ?? ouverts[compte.avis % ouverts.length];
  } else {
    choix = resoudreRoleCreation(role, reglage, catalogue, surcharges[role]);
  }
  if (!choix) return { ok: false, text: 'Aucun moteur n’a de compte disponible pour ce rôle : fais-le toi-même.' };

  const compteMoteur = await pickAccount(choix.moteur).catch(() => null);
  if (!compteMoteur) {
    return { ok: false, text: `${nomDuMoteurCreation(choix.moteur)} n’a aucun compte disponible : fais-le toi-même.` };
  }

  compte.total += 1;
  if (role === 'avis') compte.avis += 1;

  const dossier = dossierALire(ctx.agentId, ctx.projectId);
  // Un moteur dont le fil ne se reprend pas hors dossier (Cursor) travaille à part.
  const isole = !descriptionMoteur(choix.moteur)?.repriseHorsDossier || !dossier;
  const cwd = isole ? fs.mkdtempSync(path.join(os.tmpdir(), 'beluga-creation-')) : dossier!;
  const runtime = await import('./runtime.js');
  const depart = Date.now();
  let texte = '';
  let erreur: string | undefined;
  try {
    const handle = adapterFor(choix.moteur).run({
      cwd,
      prompt: promptDuDelegue({ role, consigne, fichiers, dossier }),
      model: choix.modele,
      fullAccess: false,
      role: 'task',
      disallowedTools: OUTILS_FERMES_AU_DELEGUE,
      dossiersLisibles: [...dossiersDeDonneesOuverts(), ...(isole && dossier ? [dossier] : [])],
      env: applyAccountEnv(compteMoteur),
      plafondMs: DELAI_DELEGATION_MS,
      surLancement: runtime.suivreLeService(ctx.agentId),
      onEvent: (event) => {
        if (event.kind === 'text' && event.text) texte += `${texte ? '\n\n' : ''}${event.text}`;
        if (event.kind === 'error' && event.error) erreur = event.error;
        if (event.kind === 'usage' && event.usage) {
          log.info(
            `mode Création : ${choix!.moteur} (${compteMoteur.label}) a consommé ` +
              `${event.usage.inputTokens} + ${event.usage.outputTokens} jetons pour la carte ${ctx.cardId}`,
          );
        }
      },
    });
    const resultat = await handle.finished;
    if (!resultat.ok && !erreur) erreur = resultat.error ?? 'le moteur s’est arrêté sans réponse';
  } catch (err) {
    erreur = String((err as Error)?.message ?? err);
  } finally {
    if (isole) fs.rm(cwd, { recursive: true, force: true }, () => {});
  }

  const nom = `${nomDuMoteurCreation(choix.moteur)}${choix.modele ? ` (${choix.modele})` : ''}`;
  const duree = Math.round((Date.now() - depart) / 1000);
  const reponse = texte.trim();
  if (!reponse) {
    const coupe = Date.now() - depart >= DELAI_DELEGATION_MS - 1000;
    return {
      ok: false,
      text: `${nom} n’a rien rendu (${coupe ? 'délai dépassé, moteur coupé' : erreur ?? 'réponse vide'}). Continue sans cette contribution.`,
    };
  }
  const entete = [
    `Contribution de ${nom} — rôle « ${role} », en ${duree} s.`,
    choix.repli ? choix.repli : null,
    'Elle n’a rien modifié : à toi de retenir, d’assembler et d’appliquer.',
  ]
    .filter(Boolean)
    .join('\n');
  const corps = reponse.length > PLAFOND_REPONSE ? `${reponse.slice(0, PLAFOND_REPONSE)}\n… (coupé)` : reponse;
  return { ok: true, text: `${entete}\n\n${corps}` };
}

/**
 * « evaluer » : le juge local départage des propositions. Son verdict est un
 * CONSEIL ; absent ou peu sûr de lui, il le dit et le chef tranche.
 */
export async function evaluer(ctx: ContexteCreation, args: Record<string, unknown>): Promise<ResultatCreation> {
  const card = ctx.cardId ? store.getCard(ctx.cardId) : null;
  if (!card?.parcours?.creationSouhaitee) return { ok: false, text: REFUS_MODE_ETEINT };
  const propositions = (Array.isArray(args.propositions) ? args.propositions : [])
    .map((p) => String(p ?? '').trim())
    .filter(Boolean)
    .slice(0, PROPOSITIONS_A_DEPARTAGER_MAX);
  if (propositions.length < 2) return { ok: false, text: 'Il faut au moins deux propositions à départager.' };
  if (!jugeDisponible()) {
    return { ok: true, text: 'Le juge local (Laya) n’est pas disponible sur ce serveur : tranche toi-même.' };
  }
  const critere = String(args.critere ?? '').trim() || 'la meilleure qualité de rendu pour la demande';
  const criteria: Record<string, string> = {};
  propositions.forEach((_, i) => {
    criteria[cleDeProposition(i + 1)] = `Proposition ${i + 1}`;
  });
  const etat = Object.fromEntries(propositions.map((p, i) => [`Proposition ${i + 1}`, p]));
  const reponses = await interroger(
    etat,
    {
      meilleure: {
        type: 'choice',
        instructions: `Laquelle de ces propositions répond le mieux au critère : ${critere} ?`,
        criteria,
      },
    },
    {
      usage: 'evaluation-creation',
      cardId: card.id,
      projectId: ctx.projectId,
      suite: 'conseil rendu au chef d’orchestre, qui garde le dernier mot',
    },
  );
  const verdict = reponses?.meilleure;
  const numero = verdict?.type === 'choice' ? numeroDeProposition(verdict.choice, propositions.length) : undefined;
  if (!verdict || verdict.type !== 'choice' || !numero) {
    return { ok: true, text: 'Le juge local n’a pas su trancher avec assez d’assurance : tranche toi-même.' };
  }
  return {
    ok: true,
    text: `Le juge local préfère la proposition ${numero} (confiance ${Math.round(verdict.confidence * 100)} %). C’est un conseil : tu gardes le dernier mot.`,
  };
}

/**
 * « suggerer_modele » : une question Accepter / Refuser, posée par le même
 * chemin que « ask_user » — elle ARRÊTE l'agent jusqu'à la réponse (DEC-026).
 * La suggestion est notée sur la carte ; seule une réponse « Accepter » la
 * rend effective, et pour cette carte seulement.
 */
export async function suggererModele(ctx: ContexteCreation, args: Record<string, unknown>): Promise<ResultatCreation> {
  const card = ctx.cardId ? store.getCard(ctx.cardId) : null;
  if (!card?.parcours?.creationSouhaitee) return { ok: false, text: REFUS_MODE_ETEINT };
  const role = roleLu(args.role);
  const moteur = moteurLu(args.moteur);
  const raison = String(args.raison ?? '').trim();
  if (!role || !moteur) return { ok: false, text: 'Il faut un rôle (texte, code, avis) et un moteur (claude, codex, cursor).' };
  if (!raison) return { ok: false, text: 'Dis en une phrase pourquoi ce modèle servirait mieux.' };
  const catalogue = await catalogueMoteurs();
  const cible = catalogue.find((m) => m.id === moteur);
  if (!cible?.installed) return { ok: false, text: `${nomDuMoteurCreation(moteur)} n’est pas installé sur ce serveur.` };
  const modeleVoulu = String(args.modele ?? '').trim();
  const modele = modeleVoulu && cible.models.some((m) => m.id === modeleVoulu) ? modeleVoulu : undefined;
  if (modeleVoulu && !modele) {
    return {
      ok: false,
      text: `Le modèle « ${modeleVoulu} » n’existe pas chez ${nomDuMoteurCreation(moteur)}. Modèles connus : ${cible.models.map((m) => m.id).join(', ') || 'aucun'}.`,
    };
  }

  const forme = questionDeSuggestion({ role, moteur, modele, raison });
  const question = AgentQuestion.parse({
    id: store.newId(),
    question: forme.question,
    description: forme.description,
    kind: 'single',
    options: forme.options.map((option, index) => ({ id: `o${index}`, ...option })),
    allowFreeText: true,
  });
  const suggestions = [
    ...(card.parcours.creationSuggestions ?? []),
    { questionId: question.id, agentId: ctx.agentId, role, moteur, ...(modele ? { modele } : {}), at: Date.now() },
  ].slice(-20);
  const ecrite = store.saveCard({ ...card, parcours: { ...card.parcours, creationSuggestions: suggestions } });
  bus.emit({ type: 'card.upsert', card: ecrite });
  return { ok: true, text: '', question };
}
