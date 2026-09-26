import { AccountQuota, LimiteConnue, MotifDeLimite, comptesALimiteConnue, limiteEnCours } from '@beluga/shared';
import { getMeta, setMeta } from './db.js';
import { log } from './logger.js';

/**
 * LES LIMITES CONNUES, PAR COMPTE — LA MÉMOIRE QUI MANQUAIT AU CHOIX DU COMPTE.
 *
 * Quand un tour tombe sur la limite d'un compte, la reprise le sait (elle est
 * écrite sur le message du tour tombé), mais le CHOIX du tour suivant ne le
 * savait pas : il relisait le relevé de quota, qui disait encore
 * « disponible » — un manque de crédits ne se voit pas dans un relevé —, et
 * repartait sur le même compte. Chaque tour ordinaire tombait, chaque relève
 * repartait ; constaté sur une carte entière le 06.09.2026.
 *
 * Ce fichier tient la table des limites rencontrées, PERSISTÉE en base (clé
 * `meta`) pour survivre à un redémarrage du démon. Elle s'écrit à la fin d'un
 * tour tombé sur une limite (`runtime.ts`), se lit avant chaque choix de
 * compte (`compteDuTour`, `pickAccount`, les relèves), et s'efface de deux
 * façons : à l'ÉCHÉANCE de la limite (`echeanceDeLaLimite`, règle pure), ou
 * quand un RELEVÉ FRAIS montre la fenêtre du compte remise à zéro depuis.
 */

const CLE_META = 'limites-connues';

function lire(): LimiteConnue[] {
  try {
    const brut = getMeta(CLE_META);
    if (!brut) return [];
    const liste = JSON.parse(brut);
    return Array.isArray(liste) ? liste.filter((l) => l && typeof l.compte === 'string' && typeof l.noteeA === 'number') : [];
  } catch {
    return [];
  }
}

function ecrire(limites: readonly LimiteConnue[]): void {
  setMeta(CLE_META, JSON.stringify(limites));
}

/** Les limites encore EN COURS à cet instant — les échues sont oubliées au passage. */
export function limitesConnues(now = Date.now()): LimiteConnue[] {
  const toutes = lire();
  const vivantes = toutes.filter((limite) => limiteEnCours(limite, now));
  if (vivantes.length !== toutes.length) ecrire(vivantes);
  return vivantes;
}

/** Les comptes qu'une limite connue écarte encore. */
export function comptesEcartesParLimite(now = Date.now()): Set<string> {
  return comptesALimiteConnue(limitesConnues(now), now);
}

/**
 * Un tour vient de tomber sur la limite de ce compte : on le note. Une limite
 * déjà connue est REMPLACÉE — la plus récente fait foi, avec son échéance.
 */
export function noterLimiteConnue(entree: { compte: string; motif: MotifDeLimite; resetsAt?: number; now?: number }): LimiteConnue {
  const now = entree.now ?? Date.now();
  const limite: LimiteConnue = { compte: entree.compte, motif: entree.motif, resetsAt: entree.resetsAt, noteeA: now };
  const autres = limitesConnues(now).filter((l) => l.compte !== entree.compte);
  ecrire([...autres, limite]);
  return limite;
}

/**
 * UN RELEVÉ FRAIS PEUT LEVER UNE LIMITE AVANT SON ÉCHÉANCE. La preuve : une
 * fenêtre du relevé a COMMENCÉ après que la limite a été notée (sa prochaine
 * remise à zéro moins sa durée annoncée) — la fenêtre qui portait la limite a
 * donc tourné. C'est ce qui rend un compte plus tôt que la fenêtre de cinq
 * heures d'une limite sans échéance, ou plus tôt qu'une remise à zéro mal
 * annoncée. Un relevé en erreur ne prouve rien ; un compte à sec ou à 100 %
 * non plus ; une fenêtre sans durée annoncée ne dit pas quand elle a commencé.
 */
export function effacerLesLimitesLevees(quotas: readonly AccountQuota[], now = Date.now()): string[] {
  const limites = limitesConnues(now);
  if (!limites.length) return [];
  const levees: string[] = [];
  for (const limite of limites) {
    const quota = quotas.find((q) => q.id === limite.compte);
    if (!quota || quota.error || quota.available === false) continue;
    const pleine = (quota.session?.usedPct ?? 0) >= 100 || (quota.weekly?.usedPct ?? 0) >= 100;
    if (pleine) continue;
    const remiseAZero = [quota.session, quota.weekly].some(
      (fenetre) =>
        !!fenetre &&
        typeof fenetre.resetsAt === 'number' &&
        typeof fenetre.durationSeconds === 'number' &&
        fenetre.resetsAt - fenetre.durationSeconds * 1000 > limite.noteeA &&
        fenetre.resetsAt - fenetre.durationSeconds * 1000 <= now,
    );
    if (!remiseAZero) continue;
    levees.push(limite.compte);
  }
  if (levees.length) {
    ecrire(limites.filter((limite) => !levees.includes(limite.compte)));
    log.info(`limite levée sur relevé frais : ${levees.join(', ')} — le compte redevient candidat`);
  }
  return levees;
}
