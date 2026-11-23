/**
 * LES GESTES DE JARVIS À L'ÉCRAN (carte « Relier Beluga Pass dans les réglages », 16/11/2026).
 *
 * Jarvis — l'assistant global quand on lui parle — agit DANS l'interface de Beluga comme l'utilisateur, devant lui :
 * l'outil « assistant_ecran » reçoit un PLAN de gestes (ouvrir, cliquer, saisir, touche, attendre), chacun nommé en
 * première personne. Le démon ne touche jamais l'écran : il envoie chaque geste (événement `jarvis.geste`) au SEUL
 * navigateur qui tient la conversation vocale (`client`, posé par `voix.direct.demarrer`), qui le joue avec son curseur
 * à lui et l'accuse (`jarvis.geste.fait`). L'avancement part dans le fil du module de voix (`voix.direct.action`).
 *
 * L'utilisateur garde la main (décision du 16/11/2026) : un geste RÉEL de sa part arrête l'action aussitôt
 * (`jarvis.action.arreter`) ; deux boutons du fil la reprennent ou l'annulent. Une action finie SANS interruption
 * garde son chemin (table `jarvis_chemins`), et chaque nuit les chemins du jour se rangent en compétences de Jarvis
 * (`passageDeNuitDesChemins`), sans rien demander. Un chemin échoué ou interrompu n'est jamais gardé.
 *
 * Règles pures (plan, geste qui engage, familles, compétence d'une famille) : `shared/src/gestes-de-jarvis.ts`.
 */
import crypto from 'node:crypto';
import {
  DELAI_D_UN_GESTE_DE_JARVIS_MS,
  cheminsProches,
  competenceDeLaFamille,
  doitPasserLaNuit,
  gesteEngageant,
  gestesEnLignes,
  planValide,
  regrouperLesChemins,
  type CheminDeJarvis,
  type EtatDeGeste,
  type GesteDeJarvis,
} from '@beluga/shared';
import { bus } from './bus.js';
import { getDb, getMeta, setMeta } from './db.js';
import { log } from './logger.js';
import * as store from './store.js';
import type { ToolResult } from './tools.js';

/* ------------------------------------------------------------------ */
/* Le navigateur qui tient la conversation                              */
/* ------------------------------------------------------------------ */

let clientDeLaVoix: string | null = null;

/** Posé à l'ouverture du direct (l'identifiant de l'onglet qui parle), retiré à sa fermeture. */
/** L'onglet qui tient la conversation vocale, s'il y en a un (l'outil « carte_demande » y écrit le brouillon). */
export function ongletDeLaVoix(): string | null {
  return clientDeLaVoix;
}

export function poserLeClientDeLaVoix(client: string | null | undefined): void {
  clientDeLaVoix = client?.trim() || null;
  if (!clientDeLaVoix && action?.statut === 'en-cours') arreterLAction(action.id, 'La conversation s’est fermée.');
}

/* ------------------------------------------------------------------ */
/* L'action en cours                                                    */
/* ------------------------------------------------------------------ */

type Statut = 'en-cours' | 'arretee' | 'finie' | 'annulee' | 'echouee';

interface Action {
  id: string;
  client: string;
  titre: string;
  intention: string;
  projet: string | null;
  gestes: GesteDeJarvis[];
  etats: EtatDeGeste[];
  statut: Statut;
  /** L'utilisateur a repris la main au moins une fois : le chemin ne sera pas gardé. */
  interrompue: boolean;
  erreur?: string;
}

interface Accuse {
  ok: boolean;
  erreur?: string;
  arrete?: boolean;
  rendu?: string;
}

let action: Action | null = null;
const enAttente = new Map<string, { actionId: string; resoudre: (a: Accuse) => void }>();

function annoncer(a: Action): void {
  bus.emit({
    type: 'voix.direct.action',
    id: a.id,
    client: a.client,
    titre: a.titre,
    statut: a.statut,
    gestes: a.gestes.map((g, i) => ({ libelle: g.libelle, etat: a.etats[i] ?? 'todo' })),
    ...(a.erreur ? { erreur: a.erreur } : {}),
  });
}

/** Envoie un geste au navigateur et attend son accusé (ou le délai : l'écran n'a pas répondu). */
function envoyer(actionId: string, client: string, geste: { action: GesteDeJarvis['action'] | 'lire'; cible?: string; texte?: string; libelle: string }, delai = DELAI_D_UN_GESTE_DE_JARVIS_MS): Promise<Accuse> {
  const id = crypto.randomUUID();
  return new Promise<Accuse>((resoudre) => {
    const minuterie = setTimeout(() => {
      enAttente.delete(id);
      resoudre({ ok: false, erreur: 'L’écran n’a pas répondu à temps (onglet fermé ou en veille ?).' });
    }, delai);
    enAttente.set(id, {
      actionId,
      resoudre: (a) => {
        clearTimeout(minuterie);
        enAttente.delete(id);
        resoudre(a);
      },
    });
    bus.emit({ type: 'jarvis.geste', client, actionId, id, geste });
  });
}

/** L'accusé d'un geste, venu du navigateur. */
export function accuserUnGeste(cmd: { id: string; ok: boolean; erreur?: string; arrete?: boolean; rendu?: string }): { ok: true } {
  enAttente.get(cmd.id)?.resoudre({ ok: cmd.ok, erreur: cmd.erreur, arrete: cmd.arrete, rendu: cmd.rendu });
  return { ok: true };
}

/** Joue les gestes de l'action depuis `debut`, jusqu'au bout, à l'arrêt ou au premier échec. */
async function jouerDepuis(a: Action, debut: number): Promise<void> {
  for (let i = debut; i < a.gestes.length; i += 1) {
    if (a.statut !== 'en-cours') return;
    a.etats[i] = 'running';
    annoncer(a);
    const accuse = await envoyer(a.id, a.client, a.gestes[i]!);
    if (a.statut !== 'en-cours') return; // arrêtée ou annulée pendant le geste : l'état est déjà posé
    if (accuse.arrete) {
      arreterLAction(a.id);
      return;
    }
    if (!accuse.ok) {
      a.etats[i] = 'failed';
      a.statut = 'echouee';
      a.erreur = accuse.erreur ?? 'Le geste n’a pas abouti.';
      annoncer(a);
      return;
    }
    a.etats[i] = 'done';
  }
  a.statut = 'finie';
  annoncer(a);
  if (!a.interrompue) garderLeChemin(a);
}

/** Un geste RÉEL de l'utilisateur (ou la conversation fermée) : l'action s'arrête là où elle en est. */
export function arreterLAction(id: string, raison?: string): { ok: boolean } {
  const a = action;
  if (!a || a.id !== id || a.statut !== 'en-cours') return { ok: false };
  a.statut = 'arretee';
  a.interrompue = true;
  if (raison) a.erreur = raison;
  const i = a.etats.indexOf('running');
  if (i >= 0) a.etats[i] = 'stopped';
  else {
    const suivant = a.etats.indexOf('todo');
    if (suivant >= 0) a.etats[suivant] = 'stopped';
  }
  for (const attente of [...enAttente.values()]) if (attente.actionId === id) attente.resoudre({ ok: false, arrete: true });
  annoncer(a);
  return { ok: true };
}

/** « Reprendre » (bouton du fil, ou « continue » à la voix) : la suite se rejoue depuis le geste interrompu. */
export async function reprendreLAction(id?: string): Promise<{ ok: boolean; texte: string }> {
  const a = action;
  if (!a || (id && a.id !== id)) return { ok: false, texte: 'Aucune action à reprendre.' };
  if (a.statut !== 'arretee' && a.statut !== 'echouee') return { ok: false, texte: `L’action est ${a.statut === 'finie' ? 'déjà finie' : a.statut === 'annulee' ? 'annulée' : 'en cours'}.` };
  if (!clientDeLaVoix) return { ok: false, texte: 'Aucun écran ne tient la conversation : rien à reprendre.' };
  a.client = clientDeLaVoix;
  const debut = a.etats.findIndex((e) => e !== 'done');
  for (let i = debut; i < a.etats.length; i += 1) a.etats[i] = 'todo';
  a.statut = 'en-cours';
  a.erreur = undefined;
  await jouerDepuis(a, Math.max(0, debut));
  return { ok: (a.statut as Statut) === 'finie', texte: compteRendu(a) };
}

export function annulerLAction(id: string): { ok: boolean } {
  const a = action;
  if (!a || a.id !== id || a.statut === 'finie' || a.statut === 'annulee') return { ok: false };
  if (a.statut === 'en-cours') arreterLAction(id);
  a.statut = 'annulee';
  annoncer(a);
  return { ok: true };
}

const CORPS_DE_RECIT = (a: Action) => a.gestes.map((g, i) => `${i + 1}. [${a.etats[i]}] ${g.libelle}`).join('\n');

function compteRendu(a: Action): string {
  switch (a.statut) {
    case 'finie':
      return `Fait, à l'écran, devant l'utilisateur :\n${CORPS_DE_RECIT(a)}\nDis en une phrase ce qui a été fait.`;
    case 'arretee':
      return `ARRÊTÉ à la demande de l'utilisateur (bouton Arrêter ou parole)${a.erreur ? ` (${a.erreur})` : ''}. Gestes :\n${CORPS_DE_RECIT(a)}\nDis-lui en une phrase que tu t'es arrêté et où ; il peut toucher « Reprendre » dans le fil ou dire « continue » (assistant_ecran « reprendre »). N'agis plus d'ici là.`;
    case 'echouee':
      return `ÉCHEC : ${a.erreur ?? 'un geste n’a pas abouti'}. Gestes :\n${CORPS_DE_RECIT(a)}\nRegarde l'écran avec « lire », corrige le plan et rejoue la suite, ou dis ce qui bloque.`;
    case 'annulee':
      return 'Action annulée par l’utilisateur.';
    default:
      return `En cours :\n${CORPS_DE_RECIT(a)}`;
  }
}

/* ------------------------------------------------------------------ */
/* L'outil de l'assistant                                               */
/* ------------------------------------------------------------------ */

/** La définition de l'outil, servie à l'assistant global (`assistant-global.ts`). */
export const OUTIL_ECRAN = {
  name: 'assistant_ecran',
  description:
    "AGIR SUR L'ÉCRAN DE L'UTILISATEUR, devant lui, avec ton propre curseur — seulement pendant une conversation vocale. Actions : « chemins » (« intention » : la demande en mots courants — rend les chemins déjà réussis pour une demande proche, à rejouer tels quels) ; « lire » (ce qui est visible et cliquable à l'écran : libellé, rôle, repère) ; « jouer » (« titre » : l'action en quelques mots, « intention » : la demande de l'utilisateur, « gestes » : le plan, chacun { action: ouvrir | cliquer | saisir | touche | attendre, cible, texte?, libelle } — « ouvrir » vise une adresse interne « #projet/<id> », « #projet/<id>/tache/<id> » ou « #reglages/<page> » ; « cliquer », « saisir », « attendre » visent un repère « [data-…] » ou un texte visible ; « libelle » dit en première personne ce que tu fais : « J'ouvre le projet Beluga ») ; « reprendre » (après un arrêt, ou « continue » de l'utilisateur) ; « annuler ». OUVRIR UNE CARTE, UN PROJET OU UNE PAGE : UN SEUL geste « ouvrir » avec son adresse — « #tableau-de-bord » (les Tableaux de bord), « #projet/<id> », « #projet/<id>/tache/<id> » (le lien que rend assistant_gestes « trouver »), « #reglages/<page> » — JAMAIS « cliquer » sur un libellé : il change d'un écran à l'autre (sur téléphone, « Tableaux de bord » s'appelle « Tableaux » et le menu est replié). SERT À MONTRER UN ÉCRAN : pour FAIRE le travail, préfère les outils du serveur (carte_demande, board_*, assistant_gestes, beluga_commande). Il ne sert JAMAIS à afficher une information à l'utilisateur (liens, tableau, liste) : c'est « voix_montrer », dans ta bulle. « saisir » n'écrit dans un champ QUE si l'utilisateur te l'a demandé, et toujours À LA SUITE de ce qu'il contient : rien n'est effacé ni remplacé. Bouger la souris n'arrête pas un plan. Un geste qui MET EN PRODUCTION, PAIE, ÉCRIT À UN CLIENT ou SUPPRIME est refusé tant que tu n'as pas eu la confirmation à voix haute : redemande alors avec « confirme »: true. Un plan rendu « ARRÊTÉ » : l'utilisateur t'a demandé d'arrêter, n'agis plus.",
  inputSchema: {
    type: 'object',
    required: ['action'],
    properties: {
      action: { type: 'string', enum: ['chemins', 'lire', 'jouer', 'reprendre', 'annuler'] },
      titre: { type: 'string' },
      intention: { type: 'string' },
      gestes: {
        type: 'array',
        items: {
          type: 'object',
          required: ['action', 'cible', 'libelle'],
          properties: {
            action: { type: 'string', enum: ['ouvrir', 'cliquer', 'saisir', 'touche', 'attendre'] },
            cible: { type: 'string' },
            texte: { type: 'string' },
            libelle: { type: 'string' },
          },
        },
      },
      confirme: { type: 'boolean', description: 'Vrai seulement après la confirmation dite à voix haute par l’utilisateur.' },
    },
  },
};

export async function outilEcran(args: Record<string, any>, projetVise?: string): Promise<ToolResult> {
  const quoi = String(args.action ?? '');
  if (quoi === 'chemins') {
    const intention = String(args.intention ?? '').trim();
    if (!intention) return { ok: false, text: 'Donne l’« intention » : la demande de l’utilisateur, en mots courants.' };
    const proches = cheminsProches(intention, lireLesChemins(500));
    if (!proches.length) {
      /* UN APPEL DE MOINS (carte « Jarvis : volet, voix et rapidité », 16/11/2026) : sans chemin connu, l'écran est lu
         DANS LE MÊME APPEL — « chemins » puis « jouer », deux allers-retours au lieu de trois. */
      const ecran = clientDeLaVoix
        ? await envoyer('lecture', clientDeLaVoix, { action: 'lire', libelle: 'Je regarde l’écran' }, 5_000).catch(() => null)
        : null;
      if (ecran?.ok) {
        return { ok: true, text: `Aucun chemin connu pour cette demande. Ce qui est cliquable à l’écran :\n${ecran.rendu || 'Rien de cliquable à l’écran.'}\n\nJoue maintenant ton plan avec « jouer ».` };
      }
      return { ok: true, text: 'Aucun chemin connu pour cette demande : regarde l’écran avec « lire », puis joue ton plan.' };
    }
    return {
      ok: true,
      text: proches.map((c) => `Chemin réussi pour « ${c.intention} »${c.projet ? ` (projet ${nomDuProjet(c.projet)})` : ''} :\n${gestesEnLignes(c.gestes)}`).join('\n\n'),
    };
  }
  if (quoi === 'reprendre') {
    const r = await reprendreLAction();
    return { ok: r.ok, text: r.texte };
  }
  if (quoi === 'annuler') {
    if (!action) return { ok: false, text: 'Aucune action en cours.' };
    annulerLAction(action.id);
    return { ok: true, text: 'Action annulée.' };
  }
  const client = clientDeLaVoix;
  if (!client) {
    return { ok: false, text: 'Aucun écran ne tient de conversation vocale : agis par les autres outils (board_create_card, assistant_gestes…) et dis-le.' };
  }
  if (quoi === 'lire') {
    const r = await envoyer('lecture', client, { action: 'lire', libelle: 'Je regarde l’écran' }, 5_000);
    return r.ok ? { ok: true, text: r.rendu || 'Rien de cliquable à l’écran.' } : { ok: false, text: r.erreur ?? 'Lecture impossible.' };
  }
  if (quoi !== 'jouer') return { ok: false, text: `Action inconnue : ${quoi}.` };
  if (action?.statut === 'en-cours') return { ok: false, text: 'Une action est déjà en cours à l’écran : attends sa fin, ou « annuler ».' };
  const plan = planValide(args.gestes);
  if (!plan.ok) return { ok: false, text: plan.raison };
  const engageants = plan.gestes.filter(gesteEngageant);
  if (engageants.length && args.confirme !== true) {
    return {
      ok: false,
      text: `Refusé sans confirmation : « ${engageants.map((g) => g.libelle).join(' », « ')} » engage. Redis-le à l'utilisateur, attends son « oui » à voix haute, puis rejoue avec « confirme »: true.`,
    };
  }
  const a: Action = {
    id: crypto.randomUUID(),
    client,
    titre: String(args.titre ?? '').trim().slice(0, 120) || plan.gestes[0]!.libelle,
    intention: String(args.intention ?? args.titre ?? '').trim().slice(0, 300),
    projet: projetVise ?? null,
    gestes: plan.gestes,
    etats: plan.gestes.map(() => 'todo'),
    statut: 'en-cours',
    interrompue: false,
  };
  action = a;
  await jouerDepuis(a, 0);
  return { ok: a.statut === 'finie', text: compteRendu(a) };
}

/* ------------------------------------------------------------------ */
/* Les chemins gardés                                                   */
/* ------------------------------------------------------------------ */

function nomDuProjet(id: string): string {
  return store.getProject(id)?.name ?? id;
}

function garderLeChemin(a: Action): void {
  if (!a.intention) return;
  try {
    getDb()
      .prepare('INSERT INTO jarvis_chemins (quand, intention, projet, gestes) VALUES (?, ?, ?, ?)')
      .run(Date.now(), a.intention, a.projet, JSON.stringify(a.gestes));
  } catch (err) {
    log.warn(`gestes de Jarvis : chemin non gardé — ${(err as Error).message}`);
  }
}

/** Les chemins gardés, du plus récent au plus ancien. */
export function lireLesChemins(combien = 500, depuis = 0): CheminDeJarvis[] {
  try {
    const lignes = getDb()
      .prepare('SELECT id, quand, intention, projet, gestes FROM jarvis_chemins WHERE quand >= ? ORDER BY quand DESC LIMIT ?')
      .all(depuis, combien) as { id: number; quand: number; intention: string; projet: string | null; gestes: string }[];
    return lignes.flatMap((l) => {
      try {
        return [{ id: l.id, quand: l.quand, intention: l.intention, projet: l.projet, gestes: JSON.parse(l.gestes) as GesteDeJarvis[] }];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Le rangement de nuit                                                 */
/* ------------------------------------------------------------------ */

const CLE_DERNIER_PASSAGE = 'jarvis.chemins.nuit';
const VEILLE_MS = 10 * 60 * 1000;

/**
 * RANGE LES CHEMINS EN COMPÉTENCES : chaque famille d'action qui a reçu un chemin depuis le dernier passage voit sa
 * compétence « jarvis-<famille> » écrite ou complétée par la porte unique du pool (`ecrireLaFiche`). Rend le nombre
 * de fiches écrites. Une erreur sur une famille n'arrête pas les autres.
 */
export async function rangerLesChemins(depuis: number, maintenant = Date.now()): Promise<number> {
  const familles = regrouperLesChemins(lireLesChemins(2000));
  const { ecrireLaFiche } = await import('./competences.js');
  let ecrites = 0;
  for (const f of familles) {
    if (!f.variantes.some((v) => v.chemin.quand >= depuis)) continue;
    try {
      const c = competenceDeLaFamille({ ...f, projets: f.projets.map(nomDuProjet) }, maintenant);
      const r = ecrireLaFiche({ ...c, projets: ['Beluga'], provenance: { projet: 'Beluga', creeeLe: maintenant } });
      if (r.ok) ecrites += 1;
      else log.warn(`gestes de Jarvis : compétence « ${c.nom} » refusée — ${(r.raisons ?? []).join(' ; ')}`);
    } catch (err) {
      log.warn(`gestes de Jarvis : famille « ${f.famille} » non rangée — ${(err as Error).message}`);
    }
  }
  return ecrites;
}

export async function passageDeNuitDesChemins(maintenant = new Date()): Promise<boolean> {
  const dernier = Number(getMeta(CLE_DERNIER_PASSAGE) ?? 0) || undefined;
  if (!doitPasserLaNuit(maintenant, dernier)) return false;
  setMeta(CLE_DERNIER_PASSAGE, String(maintenant.getTime()));
  const ecrites = await rangerLesChemins(dernier ?? 0, maintenant.getTime());
  if (ecrites) log.info(`gestes de Jarvis : ${ecrites} compétence(s) rangée(s) depuis les chemins du jour`);
  return true;
}

export function planifierLeRangementDesChemins(): NodeJS.Timeout {
  return setInterval(() => {
    passageDeNuitDesChemins().catch((err) => log.warn(`gestes de Jarvis : rangement de nuit sauté — ${(err as Error).message}`));
  }, VEILLE_MS);
}

/**
 * SUR UN DÉMON D'ESSAI (`jarvis.essai.jouer`, contrôle `scripts/verif-gestes-jarvis.mjs`) : joue un plan vers un onglet
 * comme si l'assistant l'avait demandé pendant une conversation vocale, sans moteur.
 */
export async function jouerPourUnEssai(client: string, args: { titre?: string; intention?: string; gestes: unknown[] }): Promise<ToolResult> {
  clientDeLaVoix = client;
  return outilEcran({ action: 'jouer', titre: args.titre, intention: args.intention, gestes: args.gestes });
}

/** Pour les essais : oublier l'action en cours. */
export function oublierLActionPourLesEssais(): void {
  action = null;
  enAttente.clear();
}
