/**
 * REMONTER TOUT SEUL UN DOSSIER DE PROJET DÉCROCHÉ.
 *
 * La décision — quoi remonter, dans quel ordre — vit dans `shared/` et se teste
 * sans disque. Ici, seulement l'exécution : lire `/etc/fstab`, jouer le plan,
 * puis constater si le dossier répond de nouveau.
 *
 * Le démon appelle ce module au lancement d'une carte, avant de refuser :
 * exactement ce qu'il fait déjà pour la « dubious ownership » de git — tenter,
 * puis refuser seulement si la réparation échoue.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import {
  montagesDeclares,
  planDeRemontage,
  pointDeMontagePorteur,
  type MontageDeclare,
} from '@beluga/shared';
import { log } from './logger.js';

const execFileAsync = promisify(execFile);

/**
 * DEUX TENTATIVES RAPPROCHÉES SUR LE MÊME POINT NE SERVENT À RIEN.
 *
 * Quand le stockage tombe, les dix-neuf projets deviennent muets d'un coup et
 * l'ordonnanceur passe en revue toutes les cartes à la suite. Sans ce garde-fou,
 * chaque carte relancerait un `umount`/`mount` sur le même point, en rafale, et
 * le remède deviendrait la panne.
 */
const DELAI_ENTRE_DEUX_ESSAIS_MS = 60_000;
const dernierEssai = new Map<string, number>();

const FSTAB_REEL = '/etc/fstab';

/**
 * LE CONTRÔLE REJOUE LA PANNE SUR SES PROPRES MONTAGES, PAS SUR CEUX DE LA
 * MACHINE. `BELUGA_FSTAB` lui laisse déclarer un montage d'essai dans un fichier
 * à lui ; `mount -T` le lit à la place du vrai. Hors contrôle, la variable
 * n'existe pas et rien ne change.
 */
function fichierFstab(): string {
  return process.env.BELUGA_FSTAB?.trim() || FSTAB_REEL;
}

/** Un dossier monté répond-il encore ? Un montage mort refuse la lecture. */
async function repond(dossier: string): Promise<boolean> {
  try {
    await fs.readdir(dossier);
    return true;
  } catch {
    return false;
  }
}

async function lireLesMontages(): Promise<MontageDeclare[]> {
  try {
    return montagesDeclares(await fs.readFile(fichierFstab(), 'utf8'));
  } catch {
    // Pas de `fstab` lisible : rien de déclaré, donc rien à remonter.
    return [];
  }
}

/** `mount` doit lire le même fichier que nous, sinon il remonterait autre chose. */
function argumentsDeLEtape(etape: { commande: string; arguments: string[] }): string[] {
  const fstab = fichierFstab();
  if (fstab === FSTAB_REEL) return etape.arguments;
  const rang = etape.arguments.indexOf('mount');
  if (rang < 0) return etape.arguments;
  const copie = [...etape.arguments];
  copie.splice(rang + 1, 0, '-T', fstab);
  return copie;
}

/**
 * TENTER DE RENDRE CE DOSSIER JOIGNABLE. Rend `true` s'il répond à la sortie.
 *
 * Trois marches, de la plus douce à la plus lourde :
 *
 *  1. une simple relecture — le montage distant porte l'option `reconnect`, et
 *     la lecture qui vient d'échouer a pu suffire à réveiller la connexion ;
 *  2. le « bind » du projet, détaché puis remonté ;
 *  3. le montage distant lui-même, mais SEULEMENT s'il ne répond plus non plus
 *     — le rouvrir pour rien décrocherait tous les autres projets.
 */
export async function remonterLeDossierDuProjet(projectPath: string): Promise<boolean> {
  const cible = (projectPath ?? '').trim();
  if (!cible) return false;

  // 1. La relecture gratuite : la connexion s'est peut-être déjà reprise.
  if (await repond(cible)) return true;

  const montages = await lireLesMontages();
  const porteur = pointDeMontagePorteur(cible, montages);
  if (!porteur) {
    log.warn('dossier injoignable et porté par aucun montage déclaré', cible);
    return false;
  }

  const depuis = dernierEssai.get(porteur.point) ?? 0;
  if (Date.now() - depuis < DELAI_ENTRE_DEUX_ESSAIS_MS) {
    log.info('remontage déjà tenté à l’instant, on ne recommence pas', porteur.point);
    return false;
  }
  dernierEssai.set(porteur.point, Date.now());

  // Le montage distant n'est rouvert que s'il est tombé lui aussi.
  const parent = pointDeMontagePorteur(
    porteur.source,
    montages.filter((m) => !m.bind),
  );
  const porteurInjoignable = !!parent && !(await repond(parent.point));

  const plan = planDeRemontage(cible, montages, { porteurInjoignable });
  if (plan.length === 0) return false;

  log.warn(
    `dossier injoignable, remontage automatique : ${cible}`,
    plan.map((e) => e.intention).join(' → '),
  );

  for (const etape of plan) {
    try {
      await execFileAsync(etape.commande, argumentsDeLEtape(etape), { timeout: 30_000 });
    } catch (err) {
      const message = String((err as Error)?.message ?? err).slice(0, 200);
      if (etape.tolereLEchec) continue;
      log.warn(`remontage : ${etape.intention} a échoué`, message);
      break;
    }
  }

  const repare = await repond(cible);
  if (repare) log.info('dossier de projet remonté tout seul', cible);
  else log.warn('remontage automatique sans effet, le refus est maintenu', cible);
  return repare;
}

/** Le décor d'un test peut vouloir repartir sans mémoire des essais. */
export function oublierLesEssaisDeRemontage(): void {
  dernierEssai.clear();
}
