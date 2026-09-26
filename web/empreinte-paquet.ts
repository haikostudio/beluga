/**
 * L'EMPREINTE DU PAQUET, ET LE NUMÉRO DE CACHE QUI LA SUIT.
 *
 * Le service worker efface, à son activation, tout cache qui ne porte pas SON
 * numéro (`CACHE`, `web/public/sw.js`). Ce numéro était écrit À LA MAIN
 * (« beluga-v4 ») : il ne changeait que si quelqu'un pensait à l'incrémenter.
 * Une mise en ligne ordinaire laissait donc `sw.js` identique octet pour octet
 * — le navigateur n'y voyait aucune version neuve, ne réinstallait rien,
 * n'effaçait rien, et l'application installable pouvait continuer de servir
 * l'écran d'avant.
 *
 * Le numéro vaut désormais l'EMPREINTE des fichiers du paquet : deux paquets
 * différents ne peuvent pas porter le même. Un paquet neuf change donc
 * forcément `sw.js`, ce qui déclenche installation, effacement des anciens
 * caches, relève et rechargement — la chaîne était déjà écrite, il lui manquait
 * seulement son déclencheur.
 *
 * `empreinteDesFichiers` est la SEULE définition de l'empreinte : le contrôle
 * (`scripts/verif-fraicheur-application.mjs`) la recalcule de son côté sur les
 * fichiers réellement servis, et refuse un `sw.js` qui ne porterait pas celle
 * de ses propres voisins.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/** Le jeton posé dans `sw.js` à la place du numéro, et remplacé à la construction. */
export const JETON_EMPREINTE = '__EMPREINTE_DU_PAQUET__';

/**
 * L'empreinte d'un paquet : les NOMS de ses fichiers d'assets, triés, hachés.
 * Les noms suffisent — ils portent déjà le haché du contenu (`index-a1b2c3.js`)
 * —, et s'en tenir aux noms rend le calcul rejouable sans relire des mégaoctets.
 */
export function empreinteDesFichiers(noms: string[]): string {
  const tries = [...noms].sort();
  return createHash('sha256').update(tries.join('\n')).digest('hex').slice(0, 16);
}

/** L'empreinte d'un dossier servi : ses `assets/`, tels qu'ils sont sur le disque. */
export function empreinteDuDossier(racine: string): string {
  const assets = path.join(racine, 'assets');
  if (!existsSync(assets)) return empreinteDesFichiers([]);
  return empreinteDesFichiers(readdirSync(assets));
}

/**
 * Le greffon de construction : une fois le paquet écrit, il remplace le jeton
 * de `dist/sw.js` par l'empreinte, et dépose `dist/version.json` — de quoi lire
 * la version servie sans ouvrir un navigateur.
 */
export function empreinteDuServiceWorker(): Plugin {
  return {
    name: 'beluga-empreinte-sw',
    /* Après l'écriture du paquet ET la recopie de `public/` : c'est seulement
       là que `dist/sw.js` existe.

       Rollup appelle AUSSI ce crochet quand la construction a ÉCHOUÉ, en lui
       passant l'erreur. Rien n'a alors été écrit dans `dist/`, qui garde le
       paquet de la fois d'avant — jeton déjà remplacé. Lever ici recouvrirait
       la vraie panne par un faux message (rencontré le 02/09/2026 : une
       dépendance manquante annoncée comme un `sw.js` sans jeton). On rend donc
       la main sans rien dire : c'est l'erreur d'origine qui doit remonter. */
    closeBundle(erreur?: unknown) {
      if (erreur) return;
      const dist = path.resolve(__dirname, 'dist');
      const sw = path.join(dist, 'sw.js');
      if (!existsSync(sw)) return;

      const empreinte = empreinteDuDossier(dist);
      const source = readFileSync(sw, 'utf8');
      if (!source.includes(JETON_EMPREINTE)) {
        // Mieux vaut arrêter la construction qu'expédier un service worker dont
        // le numéro ne bougera plus jamais : c'est exactement le défaut réparé.
        throw new Error(
          `web/public/sw.js ne porte plus le jeton ${JETON_EMPREINTE} : le numéro de cache ne suivrait plus les mises en ligne.`,
        );
      }
      writeFileSync(sw, source.split(JETON_EMPREINTE).join(empreinte));
      writeFileSync(
        path.join(dist, 'version.json'),
        `${JSON.stringify({ empreinte, construitA: Date.now() }, null, 2)}\n`,
      );
    },
  };
}
