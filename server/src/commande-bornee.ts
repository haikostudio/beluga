/**
 * UNE COMMANDE BORNÉE NE LAISSE JAMAIS D'ORPHELIN DERRIÈRE ELLE.
 *
 * Mesuré le 19.09.2026 sur HaikoFormations, publication `92d6d6e4…` :
 * l'étape « Construction » lance `npm run build` par `bash -lc` et lui donne
 * dix minutes. À la dixième minute, `execFile` a bien coupé — mais il n'a tué
 * que son ENFANT DIRECT (`npm`). Le petit-fils (`nuxt build`, 1,6 Go de
 * mémoire, quarante fils d'exécution) a survécu QUATRE-VINGT-UNE SECONDES de
 * plus, seul, à écrire dans le même `.nuxt` et le même `.output`.
 *
 * Pendant ce temps la publication concluait « la construction a échoué »,
 * appelait un agent de dépannage, et RELANÇAIT une construction dans le même
 * dossier. Deux constructions se disputaient alors les mêmes fichiers sur un
 * montage réseau lent : chacune ralentissait l'autre, chacune atteignait son
 * délai, chacune laissait un nouvel orphelin. Les vingt-cinq minutes observées
 * ne sont pas une construction lente : ce sont trois constructions empilées.
 *
 * On lance donc la commande dans SON PROPRE GROUPE DE PROCESSUS
 * (`detached: true`), et le délai dépassé tue LE GROUPE ENTIER — d'abord
 * poliment, puis sans appel. Quand cette fonction rend la main, plus rien de ce
 * qu'elle a lancé ne tourne.
 *
 * Elle remonte en prime chaque LIGNE de sortie au fil de l'eau (`surLigne`) :
 * c'est ce qui permet à l'étape d'afficher sa dernière action au lieu de rester
 * muette pendant des minutes.
 *
 * Aucune base, aucun réseau : seulement un processus et une horloge.
 */

import { spawn } from 'node:child_process';

/** Ce qu'une commande bornée rend, quelle qu'en soit l'issue. */
export interface IssueDeCommande {
  ok: boolean;
  out: string;
  /** La commande a été coupée par son délai, elle n'a pas rendu la main. */
  delaiDepasse?: boolean;
  /** Combien de temps elle a réellement tourné, en millisecondes. */
  dureeMs: number;
  /** La dernière ligne non vide qu'elle a écrite, s'il y en a une. */
  derniereLigne?: string;
}

export interface OptionsDeCommande {
  /** Le plafond de durée, en millisecondes. */
  timeout?: number;
  /** Combien de signes de sortie on retient (`Infinity` = tout). */
  signesGardes?: number;
  /** Appelé pour chaque ligne écrite par la commande, au fil de l'eau. */
  surLigne?: (ligne: string) => void;
  /** Le délai laissé au groupe pour mourir poliment avant le coup de grâce. */
  delaiDeGraceMs?: number;
  /** Un ARRÊT demandé (bouton « Arrêter » d'une publication) : le groupe est tué sur-le-champ. */
  signal?: AbortSignal;
}

/** Le temps laissé à un groupe pour se refermer avant d'être tué sans appel. */
export const DELAI_DE_GRACE_MS = 5_000;

/** Au-delà, on cesse d'accumuler la sortie en mémoire (8 Mio, comme avant). */
const MEMOIRE_MAX = 8 * 1024 * 1024;

/**
 * Tue un groupe de processus entier, poliment puis sans appel.
 *
 * Le signe moins devant l'identifiant vise LE GROUPE, pas le seul processus :
 * c'est toute la descendance qui reçoit le signal, y compris un `nuxt build`
 * que son `npm` parent n'aurait jamais relayé.
 */
export function tuerLeGroupe(pid: number, signal: NodeJS.Signals = 'SIGTERM'): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    /* Le groupe est déjà parti : c'est exactement ce qu'on voulait. */
    return false;
  }
}

/** Ce groupe de processus existe-t-il encore ? */
export function groupeEncoreVivant(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lancer une commande de shell, bornée dans le temps, sans orphelin possible.
 */
export function lancerCommandeBornee(
  cwd: string,
  command: string,
  options: OptionsDeCommande = {},
): Promise<IssueDeCommande> {
  const timeout = options.timeout ?? 15 * 60 * 1000;
  const signesGardes = options.signesGardes ?? 3000;
  const delaiDeGrace = options.delaiDeGraceMs ?? DELAI_DE_GRACE_MS;
  const depart = Date.now();

  return new Promise<IssueDeCommande>((resolve) => {
    let sortie = '';
    let reste = '';
    let derniereLigne: string | undefined;
    let delaiDepasse = false;
    let rendu = false;

    const enfant = spawn('bash', ['-lc', command], {
      cwd,
      // SON PROPRE GROUPE : c'est ce qui rend le coup de grâce collectif possible.
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const garder = (texte: string) => (signesGardes === Infinity ? texte : texte.slice(-signesGardes));

    const avaler = (morceau: string) => {
      sortie += morceau;
      // La mémoire est bornée : au-delà, seule la FIN est gardée, c'est là que
      // vit l'erreur qui a fait tomber la commande.
      if (sortie.length > MEMOIRE_MAX) sortie = sortie.slice(-MEMOIRE_MAX);
      reste += morceau;
      const lignes = reste.split('\n');
      reste = lignes.pop() ?? '';
      for (const brute of lignes) {
        const ligne = brute.replace(/\r/g, '').trim();
        if (!ligne) continue;
        derniereLigne = ligne;
        options.surLigne?.(ligne);
      }
    };

    enfant.stdout?.on('data', (d) => avaler(String(d)));
    enfant.stderr?.on('data', (d) => avaler(String(d)));

    let coupDeGrace: NodeJS.Timeout | undefined;
    const minuteur = setTimeout(() => {
      delaiDepasse = true;
      if (enfant.pid) {
        tuerLeGroupe(enfant.pid, 'SIGTERM');
        coupDeGrace = setTimeout(() => {
          if (enfant.pid) tuerLeGroupe(enfant.pid, 'SIGKILL');
        }, delaiDeGrace);
        coupDeGrace.unref?.();
      }
    }, timeout);
    minuteur.unref?.();

    let arrete = false;
    const surArret = () => {
      arrete = true;
      if (enfant.pid) {
        tuerLeGroupe(enfant.pid, 'SIGTERM');
        const fin = setTimeout(() => {
          if (enfant.pid && groupeEncoreVivant(enfant.pid)) tuerLeGroupe(enfant.pid, 'SIGKILL');
        }, delaiDeGrace);
        fin.unref?.();
      }
    };
    if (options.signal?.aborted) surArret();
    else options.signal?.addEventListener('abort', surArret, { once: true });

    const rendreLaMain = (ok: boolean, complement = '') => {
      if (rendu) return;
      rendu = true;
      clearTimeout(minuteur);
      options.signal?.removeEventListener('abort', surArret);
      if (coupDeGrace) clearTimeout(coupDeGrace);
      /*
       * DERNIER BALAYAGE : même sorti, le groupe peut garder un traînard. On ne
       * rend la main qu'après lui avoir envoyé le coup de grâce.
       */
      if (delaiDepasse && enfant.pid && groupeEncoreVivant(enfant.pid)) {
        tuerLeGroupe(enfant.pid, 'SIGKILL');
      }
      if (reste.trim()) derniereLigne = reste.trim();
      const entete = delaiDepasse
        ? `La commande a été coupée : elle n’avait toujours pas rendu la main après ${Math.round(timeout / 1000)} s.\n`
        : arrete
          ? 'La commande a été coupée : arrêt demandé.\n'
          : '';
      resolve({
        ok,
        out: entete + garder(sortie + complement),
        delaiDepasse: delaiDepasse || undefined,
        dureeMs: Date.now() - depart,
        derniereLigne,
      });
    };

    enfant.on('error', (err) => rendreLaMain(false, `\n${String(err?.message ?? err)}`));
    enfant.on('close', (code) => rendreLaMain(!delaiDepasse && !arrete && code === 0));
  });
}
