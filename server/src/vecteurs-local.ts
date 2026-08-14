import fs from 'node:fs';
import path from 'node:path';
import { LOT_VECTEURS_LOCAL, MODELE_LOCAL, normaliserLeVecteur } from '@haikodev/shared';
import { CONFIG } from './config.js';
import { log } from './logger.js';

/**
 * LE MOTEUR DE VECTORISATION LOCAL — BAAI/bge-m3, sur cette machine.
 *
 * Le sens ne part plus chez un fournisseur : le modèle tourne ici, sur les
 * quatre cœurs du serveur. Aucun octet de documentation ne sort, aucun centime
 * n'est dépensé par appel. C'est plus lent qu'un service en ligne — deux
 * passages par seconde contre cent —, et c'est précisément pourquoi la
 * vectorisation est un travail de NUIT (`vecteurs-nocturne.ts`).
 *
 * LE MOTEUR VIT HORS DU DÉPÔT, dans `data/vectoriseur`, posé par
 * `scripts/installer-vectoriseur.mjs` : bibliothèque et modèle pèsent ensemble
 * plus d'un gigaoctet, et chaque carte lancée refait `npm install` dans sa
 * propre copie du dépôt — les y mettre ralentirait TOUS les lancements pour un
 * moteur dont un seul processus se sert. Même choix que Kokoro pour la voix.
 *
 * On l'importe donc DYNAMIQUEMENT, par son chemin. S'il n'est pas installé, on
 * le DIT une fois et on rend `undefined` : la recherche retombe sur l'empreinte
 * de mots, elle ne tombe jamais en panne.
 */

/**
 * Le dossier du moteur, hors dépôt, à côté des autres données du démon.
 *
 * `HAIKODEV_VECTORISEUR` le déplace, et ce n'est pas un luxe : un contrôle pose
 * sa base dans un dossier JETABLE (`HAIKODEV_DATA`), où le moteur n'est
 * évidemment pas installé — sans cette variable, il ne pourrait jamais éprouver
 * la recherche par le sens. Lu à CHAQUE appel, jamais figé au chargement.
 */
export function dossierDuVectoriseur(): string {
  return process.env.HAIKODEV_VECTORISEUR?.trim() || path.join(CONFIG.dataDir, 'vectoriseur');
}

/** Le moteur local est-il posé sur cette machine ? */
export function vectoriseurLocalInstalle(): boolean {
  return fs.existsSync(path.join(dossierDuVectoriseur(), 'node_modules', '@huggingface', 'transformers'));
}

/**
 * LE MODÈLE, CHARGÉ UNE SEULE FOIS ET GARDÉ. Le charger prend une dizaine de
 * secondes et environ 700 Mo : le refaire à chaque question rendrait chaque
 * lancement de carte insupportable. Il reste donc en mémoire — le serveur a la
 * place, et c'est le seul processus qui s'en sert.
 */
let chargement: Promise<((textes: string[], options: object) => Promise<{ tolist(): number[][] }>) | undefined> | undefined;
let manquantDit = false;

async function extracteur() {
  if (chargement) {
    const deja = await chargement;
    /*
     * ON NE MÉMORISE QUE LE SUCCÈS. Un premier appel tombé — moteur pas encore
     * installé, dossier pointé ailleurs le temps d'un contrôle — figeait
     * l'absence POUR TOUJOURS : le moteur posé ensuite n'était jamais repris
     * sans redémarrer le démon. Réessayer ne coûte qu'un regard sur le disque,
     * et le message d'absence, lui, ne se redit pas.
     */
    if (deja) return deja;
    chargement = undefined;
  }
  chargement = (async () => {
    if (!vectoriseurLocalInstalle()) {
      if (!manquantDit) {
        manquantDit = true;
        log.warn(
          'vectorisation locale indisponible : lance « node scripts/installer-vectoriseur.mjs ». ' +
            'La recherche continue sur les mots.',
        );
      }
      return undefined;
    }
    const dossier = dossierDuVectoriseur();
    const entree = path.join(dossier, 'node_modules', '@huggingface', 'transformers', 'dist', 'transformers.node.mjs');
    try {
      const { pipeline, env } = (await import(entree)) as any;
      // Le modèle est rangé AVEC le moteur, jamais dans un cache du dossier
      // personnel : un démon relancé sous un autre compte doit le retrouver.
      env.cacheDir = path.join(dossier, 'modeles');
      env.allowLocalModels = true;
      const debut = Date.now();
      /*
       * LE NOMBRE DE FILS. Mesuré ici : un processus qui prend les quatre cœurs
       * rend 1,4 passage/s, trois processus d'UN cœur en rendent 2,4 à eux
       * trois. La vectorisation en masse gagne donc à se lancer en plusieurs
       * processus d'un fil (`HAIKODEV_EMBED_THREADS=1`) ; le démon, lui, qui ne
       * vectorise qu'une question à la fois, garde tous les cœurs.
       */
      const fils = Number(process.env.HAIKODEV_EMBED_THREADS || 0);
      const options: Record<string, unknown> = { dtype: 'q8' };
      if (fils > 0) options.session_options = { intraOpNumThreads: fils, interOpNumThreads: 1 };
      const extraire = await pipeline('feature-extraction', MODELE_LOCAL, options);
      log.info(`vectorisation locale prête (${MODELE_LOCAL}) en ${Math.round((Date.now() - debut) / 1000)} s`);
      return extraire;
    } catch (err) {
      log.warn(`vectorisation locale impossible : ${(err as Error).message}`);
      return undefined;
    }
  })();
  return chargement;
}

/**
 * UN LOT vectorisé sur place. Aucun réseau, donc aucune panne passagère à
 * retenter : ou le modèle répond, ou il n'est pas là. On ne lève jamais.
 */
async function vectoriserUnLotLocal(textes: string[]): Promise<number[][] | undefined> {
  const extraire = await extracteur();
  if (!extraire) return undefined;
  try {
    const sortie = await extraire(textes, { pooling: 'cls', normalize: true });
    const vecteurs = sortie.tolist();
    if (vecteurs.length !== textes.length) {
      log.warn(`vectorisation locale incomplète : ${vecteurs.length} vecteurs pour ${textes.length} textes`);
      return undefined;
    }
    // `normalize: true` le fait déjà ; on le refait car c'est notre garantie à
    // nous, et elle ne coûte rien à côté du passage dans le modèle.
    return vecteurs.map((vecteur) => normaliserLeVecteur(vecteur));
  } catch (err) {
    log.warn(`vectorisation locale tombée : ${(err as Error).message}`);
    return undefined;
  }
}

/**
 * LA VECTORISATION D'UNE LISTE DE TEXTES, par petits lots. Rend `undefined` dès
 * qu'un lot échoue : un index à moitié vectorisé se reconnaît et retombe
 * proprement sur les mots, alors qu'un index à moitié FAUX ne se reconnaîtrait
 * pas.
 */
export async function vectoriserEnLocal(textes: string[]): Promise<number[][] | undefined> {
  if (!textes.length) return [];
  const sortie: number[][] = [];
  for (let debut = 0; debut < textes.length; debut += LOT_VECTEURS_LOCAL) {
    const lot = await vectoriserUnLotLocal(textes.slice(debut, debut + LOT_VECTEURS_LOCAL));
    if (!lot) return undefined;
    sortie.push(...lot);
  }
  return sortie;
}
