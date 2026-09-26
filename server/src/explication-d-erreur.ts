import crypto from 'node:crypto';
import { expliquerLErreur, explicationDeFamille, type ExplicationDErreur } from '@beluga/shared';
import { classerLaFamilleDeLErreur } from './jugement-rapide.js';
import { log } from './logger.js';

/**
 * TRADUIRE UNE ERREUR EN PHRASE SIMPLE, AVANT QU'ELLE N'ATTEIGNE L'ÉCRAN.
 *
 * La règle vit dans `shared/src/familles-d-erreur.ts` : un message humain passe
 * tel quel, un message technique reconnu prend la phrase de sa famille. Ici,
 * le seul geste qui demande la machine : un message technique qu'AUCUN motif
 * ne reconnaît est confié à Laya (usage « famille-erreur » du juge rapide),
 * qui choisit entre deux familles larges.
 *
 * GARDE-FOUS — l'explication ne peut ni retarder ni casser une réponse :
 *  - délai court, tenu par le juge (`DELAI_LAYA_ERREUR_MS`), et jamais
 *    d'attente d'un modèle qui dort : on garde alors « erreur inattendue » ;
 *  - un CACHE par empreinte du message brut : la même panne en rafale (vingt
 *    projets décrochés d'un coup) ne relance pas vingt fois le modèle ;
 *  - aucune exception ne sort d'ici ;
 *  - le message brut part au journal, jamais dans la phrase affichée.
 */

const CACHE_MAX = 200;
const cache = new Map<string, ExplicationDErreur>();

function empreinte(texte: string): string {
  // Les nombres changent d'une occurrence à l'autre (pid, durées, ports) : on les efface pour mieux regrouper.
  return crypto.createHash('sha1').update(texte.replace(/\d+/g, '#').slice(0, 2000)).digest('hex').slice(0, 16);
}

function retenir(cle: string, explication: ExplicationDErreur): ExplicationDErreur {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(cle, explication);
  return explication;
}

/** Le seul point d'entrée : le message brut, et sa phrase simple. Ne lève jamais. */
export async function expliquerPourLEcran(brut: string | undefined, contexte = ''): Promise<ExplicationDErreur> {
  const premier = expliquerLErreur(brut);
  if (!premier.aClasser) return premier;
  const cle = empreinte(premier.brut);
  const deja = cache.get(cle);
  if (deja) return deja;
  try {
    const famille = await classerLaFamilleDeLErreur(premier.brut);
    const explication = famille ? explicationDeFamille(premier.brut, famille, 'laya') : premier;
    log.info(
      `erreur ${contexte ? `(${contexte}) ` : ''}classée ${famille ? `« ${famille} » par laya` : '« inconnue » (laya sans verdict sûr)'} : ${premier.brut.slice(0, 300)}`,
    );
    /* Un « sans verdict » n'est pas gardé : Laya dormait peut-être, la même
       erreur aura sa chance au prochain passage. */
    return famille ? retenir(cle, explication) : explication;
  } catch {
    return premier;
  }
}

/** Le même, réduit à la phrase — pour les endroits qui n'ont besoin que du texte. */
export async function phrasePourLEcran(brut: string | undefined, contexte = ''): Promise<string> {
  return (await expliquerPourLEcran(brut, contexte)).phrase;
}
