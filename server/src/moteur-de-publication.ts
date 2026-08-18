import { EngineId } from '@haikodev/shared';
import {
  CompteDePublication,
  PLACE_MINIMALE_POUR_PUBLIER,
  compteQuiMeneLaPublication,
  estUneBasculeDeMoteur,
  phraseAucunMoteurLibre,
  phraseDeBasculeDeMoteur,
} from '@haikodev/shared';
import { AccountRecord, cachedQuotas, listAccountRecords, refreshQuotas } from './accounts.js';
import { cachedEngines, listEngines } from './engines/index.js';
import { log } from './logger.js';

/**
 * LE MOTEUR ET LE COMPTE QUI MÈNENT LA PUBLICATION.
 *
 * La publication lance ses propres agents : la mise en production confiée, le
 * dépanneur d'étape, la réparation des contrôles ou de la construction, la
 * résolution d'un conflit de fusion. Tous partaient sur le moteur PAR DÉFAUT du
 * projet, et `pickAccount` ne cherchait un compte QUE dans ce moteur. Tous ses
 * comptes saturés, `sendPrompt` écrivait « Aucun compte n'a de quota
 * disponible » et RENDAIT LA MAIN SANS ERREUR : la publication croyait l'agent
 * intervenu, rejouait l'étape, et tournait sur place sans rien dire.
 *
 * Ce fichier pose le choix AVANT la création de l'agent : on regarde tous les
 * moteurs installés, on compare la place réellement restante (règle pure
 * `shared/src/moteur-de-publication.ts`), et on rend soit un moteur avec son
 * compte, soit une PHRASE qui dit pourquoi il n'y en a aucun. Rien n'est mis en
 * ligne ici : on choisit qui travaille, jamais quoi publier.
 */

/**
 * LES MOTEURS VERS LESQUELS ON ACCEPTE DE BASCULER : Claude et Codex, les deux
 * qui portent une fenêtre de quota lisible.
 *
 * Cursor se facture au CRÉDIT, pas à la fenêtre : sa place restante n'est pas
 * mesurable de la même façon, et y basculer tout seul dépenserait de l'argent
 * sans que personne ne l'ait demandé. Un projet réglé sur Cursor le garde —
 * c'est son moteur préféré — mais on ne l'y envoie jamais de notre initiative.
 */
const MOTEURS_DE_BASCULE: EngineId[] = ['claude', 'codex'];

export interface ChoixDeMoteurDePublication {
  engine: EngineId;
  account: AccountRecord;
  /** Ce qui s'écrit au journal et dans le fil de l'étape. */
  raison: string;
  /** A-t-on dû quitter le moteur réglé sur le projet ? */
  bascule: boolean;
}

/** Rendu du choix : un moteur retenu, OU la raison en clair qu'il n'y en a pas. */
export type ResultatDeChoix = { choix: ChoixDeMoteurDePublication } | { manque: string };

/** Les moteurs réellement installés sur ce serveur, sans payer une détection complète. */
async function moteursInstalles(): Promise<Set<EngineId>> {
  const connus = cachedEngines();
  const engines = connus.length ? connus : await listEngines().catch(() => []);
  // Catalogue muet : on ne déclare personne absent sur une détection ratée.
  if (!engines.length) return new Set<EngineId>(['claude', 'codex', 'cursor']);
  return new Set(engines.filter((engine) => engine.installed).map((engine) => engine.id));
}

/**
 * Les comptes candidats, dans la forme que la règle pure attend.
 *
 * Un compte marqué INDISPONIBLE (`available: false`) n'est pas écarté de la
 * liste : ses deux fenêtres sont mises à 100 %. Il ne peut donc rien mener, et
 * il apparaît quand même dans la phrase qui explique qu'il n'y avait rien à
 * prendre — c'est justement ce qu'on veut lire quand tout est saturé.
 */
function comptesCandidats(prefere: EngineId | undefined, installes: Set<EngineId>): (CompteDePublication & {
  account: AccountRecord;
})[] {
  const quotas = cachedQuotas();
  const retenus = new Set<EngineId>([...MOTEURS_DE_BASCULE, ...(prefere ? [prefere] : [])]);
  return listAccountRecords()
    .filter((account) => retenus.has(account.engine))
    .map((account) => {
      const quota = quotas.find((q) => q.id === account.id);
      const sature = quota?.available === false;
      return {
        id: account.id,
        engine: account.engine,
        label: account.label,
        plan: quota?.plan ?? account.plan,
        priority: account.priority,
        sessionPct: sature ? 100 : quota?.session?.usedPct,
        weeklyPct: sature ? 100 : quota?.weekly?.usedPct,
        disabled: quota?.disabled ?? account.disabled,
        installe: installes.has(account.engine),
        resetsAt: quota?.session?.resetsAt ?? quota?.weekly?.resetsAt,
        account,
      };
    });
}

/** L'heure de remise à zéro la plus proche, écrite comme les portes de l'ordonnanceur. */
function prochaineRemiseEnClair(comptes: readonly CompteDePublication[]): string {
  const proche = comptes
    .map((compte) => compte.resetsAt)
    .filter((v): v is number => !!v)
    .sort((a, b) => a - b)[0];
  if (!proche) return '';
  const heure = new Date(proche).toLocaleString('fr-CH', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  });
  return ` La première remise à zéro connue est à ${heure}.`;
}

/**
 * LE CHOIX. `prefere` est le moteur réglé sur le projet : il garde la main tant
 * qu'il lui reste assez de place, et on ne bascule que lorsqu'il n'a plus de
 * quoi finir.
 *
 * Les quotas sont relus avant de décider (`refreshQuotas`, sans forcer : le
 * cache frais suffit) — décider sur des chiffres d'il y a une heure, c'est
 * repartir sur le compte qui vient justement de saturer.
 */
export async function moteurPourPublier(prefere?: EngineId): Promise<ResultatDeChoix> {
  await refreshQuotas(false).catch((err) => {
    log.warn('publication : relevé de quota impossible, on décide sur le dernier connu', err);
    return [];
  });

  const installes = await moteursInstalles();
  const candidats = comptesCandidats(prefere, installes);
  if (!candidats.length) {
    return { manque: 'Aucun compte n’est déclaré pour Claude ni pour Codex : la publication n’a personne à qui confier son travail.' };
  }

  const retenu = compteQuiMeneLaPublication(candidats, prefere);
  if (!retenu) {
    return { manque: `${phraseAucunMoteurLibre(candidats)}${prochaineRemiseEnClair(candidats)}` };
  }

  const bascule = estUneBasculeDeMoteur(retenu, prefere);
  const raison = phraseDeBasculeDeMoteur(retenu, prefere);
  if (bascule) log.info(`publication : ${raison}`);
  return { choix: { engine: retenu.engine as EngineId, account: retenu.account, raison, bascule } };
}

export { PLACE_MINIMALE_POUR_PUBLIER };
