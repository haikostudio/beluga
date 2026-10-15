/*
 * LE GARDE DES ATTENTES : UNE COMMANDE D'AGENT NE BLOQUE PLUS SA TÂCHE POUR RIEN.
 *
 * Mesure du 14/10/2026 sur 511 tours de tâche (124 h) : 9 % du temps partait en
 * attentes en boucle (« while …; do sleep 5; done », « sleep 120 »), et 4 % en
 * commandes restées bloquées jusqu'à leur limite de dix minutes — presque
 * toujours un serveur d'essai lancé au PREMIER PLAN (« npm run dev », « vite »),
 * qui ne rend jamais la main. Le tour attend alors sans rien faire.
 *
 * La règle est jugée AVANT que la commande parte (hook PreToolUse, comme
 * `garde-demon.ts`). Elle ne refuse que des formes sûres, et chaque refus porte
 * TOUTES ses issues : la même commande lancée en arrière-plan, bornée par
 * `timeout`, ou raccourcie. Un refus se lève donc toujours par un geste possible
 * (compétence « regle-d-agent-tenue-par-refus-d-outil »).
 */

export interface ContexteDuGardeDesAttentes {
  /** L'outil lance déjà la commande en arrière-plan (`run_in_background`). */
  arrierePlan?: boolean;
}

export interface VerdictDesAttentes {
  refusee: boolean;
  /** Le genre de blocage, pour les contrôles et la mesure. */
  genre?: 'boucle' | 'sommeil' | 'serveur' | 'suivi';
  raison?: string;
  conseil?: string;
}

const PASSE: VerdictDesAttentes = { refusee: false };

/** Au-delà, un `sleep` au premier plan est une attente, pas une respiration. */
export const SOMMEIL_MAXIMUM_S = 20;
/** Une boucle d'attente bornée par `timeout` au plus à cette durée passe. */
export const BOUCLE_BORNEE_MAXIMUM_S = 120;

const ISSUE_ARRIERE_PLAN =
  "lance-la en arrière-plan (option run_in_background de l'outil, ou « … > /tmp/journal.log 2>&1 & ») : tu seras prévenu à sa fin, et tu continues ton travail en attendant";

/** Une durée de `sleep`/`timeout` en secondes (« 30 », « 2m », « 1.5h »), ou NaN. */
export function dureeEnSecondes(valeur: string): number {
  const m = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(valeur.trim());
  if (!m) return Number.NaN;
  const n = Number(m[1]);
  const facteur = { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2] as '' | 's' | 'm' | 'h' | 'd'];
  return n * facteur;
}

interface Morceau {
  texte: string;
  /** Suivi d'un `&` seul : il part en arrière-plan. */
  enFond: boolean;
}

/**
 * Découpe une ligne de commande en instructions EN GARDANT le `&` final de
 * chacune — `garde-demon.ts` le jette, ici il change tout. Le texte entre
 * guillemets n'est pas découpé.
 */
export function morceaux(commande: string): Morceau[] {
  const out: Morceau[] = [];
  let courant = '';
  let guillemet: string | null = null;
  const pousser = (enFond: boolean) => {
    if (courant.trim()) out.push({ texte: courant.trim(), enFond });
    courant = '';
  };
  for (let i = 0; i < commande.length; i += 1) {
    const c = commande[i]!;
    const suivant = commande[i + 1];
    if (guillemet) {
      courant += c;
      if (c === guillemet) guillemet = null;
      continue;
    }
    if (c === '"' || c === "'") {
      guillemet = c;
      courant += c;
      continue;
    }
    if ((c === '&' && suivant === '&') || (c === '|' && suivant === '|')) {
      pousser(false);
      i += 1;
      continue;
    }
    if (c === '&' && suivant === '>') {
      courant += c;
      continue;
    }
    if (c === '&' && commande[i - 1] === '>') {
      courant += c;
      continue;
    }
    if (c === '&') {
      pousser(true);
      continue;
    }
    if (c === ';' || c === '\n' || c === '|') {
      pousser(false);
      continue;
    }
    courant += c;
  }
  pousser(false);
  return out;
}

/** Les mots d'une instruction, guillemets retirés. */
function mots(instruction: string): string[] {
  const bruts = instruction.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return bruts.map((mot) => mot.replace(/^['"]|['"]$/g, ''));
}

/** La borne `timeout N` qui enveloppe une instruction, en secondes, ou rien. */
function borneTimeout(instruction: string): number | undefined {
  const suite = mots(instruction);
  const i = suite.indexOf('timeout');
  if (i < 0) return undefined;
  for (const mot of suite.slice(i + 1)) {
    if (mot.startsWith('-')) continue;
    const s = dureeEnSecondes(mot);
    return Number.isFinite(s) ? s : undefined;
  }
  return undefined;
}

/** Le verbe et ses arguments, enveloppes habituelles écartées. */
function verbeEtArguments(instruction: string): { verbe: string; args: string[] } {
  const suite = mots(instruction).filter((mot) => !/^[A-Z_][A-Z0-9_]*=/.test(mot));
  const enveloppes = new Set(['sudo', 'nohup', 'setsid', 'env', 'time', 'exec', 'command', 'stdbuf']);
  let i = 0;
  while (i < suite.length && (enveloppes.has(suite[i]!) || suite[i]!.startsWith('-'))) i += 1;
  const verbe = (suite[i] ?? '').split('/').pop() ?? '';
  return { verbe, args: suite.slice(i + 1) };
}

/**
 * CETTE INSTRUCTION LANCE-T-ELLE UN SERVEUR QUI NE REND JAMAIS LA MAIN ?
 * Seules les formes sûres : les scripts « dev »/« start »/« serve »/« preview »,
 * vite et next en mode serveur, les serveurs de fichiers, le démon lui-même,
 * docker compose sans `-d`.
 */
export function lanceUnServeur(instruction: string): string | null {
  const { verbe, args } = verbeEtArguments(instruction);
  // Les mots qui ressemblent à une sous-commande : ni option, ni nombre, ni chemin.
  const sousCommandes = args.filter((a) => /^[a-z][\w:-]*$/.test(a));
  const premier = sousCommandes[0] ?? '';
  const serveurs = ['dev', 'serve', 'preview'];

  if (verbe === 'npm' || verbe === 'pnpm' || verbe === 'yarn' || verbe === 'bun') {
    const run = args.findIndex((a) => a === 'run' || a === 'run-script');
    if (run >= 0) {
      const script = args.slice(run + 1).find((a) => !a.startsWith('-')) ?? '';
      return /^(dev|start|serve|preview)(:[\w-]+)?$/.test(script) ? `${verbe} run ${script}` : null;
    }
    return premier === 'start' || premier === 'dev' || premier === 'serve' ? `${verbe} ${premier}` : null;
  }
  if (verbe === 'npx' || verbe === 'pnpx' || verbe === 'bunx') {
    const [outil, sous] = sousCommandes;
    if (outil === 'vite') return !sous || serveurs.includes(sous) ? `npx vite${sous ? ` ${sous}` : ''}` : null;
    if (outil === 'next') return sous === 'dev' || sous === 'start' ? `npx next ${sous}` : null;
    if (outil === 'serve' || outil === 'http-server') return `npx ${outil}`;
    return null;
  }
  if (verbe === 'vite') return !premier || serveurs.includes(premier) ? 'vite' : null;
  if (verbe === 'next') return premier === 'dev' || premier === 'start' ? `next ${premier}` : null;
  if ((verbe === 'python' || verbe === 'python3') && args.includes('-m') && args.includes('http.server')) return 'python -m http.server';
  if (verbe === 'php' && args.includes('-S')) return 'php -S';
  if (verbe === 'node' && args.some((a) => /server\/dist\/main\.js$/.test(a))) return 'node server/dist/main.js';
  const compose = (verbe === 'docker' && premier === 'compose' && args.includes('up')) || (verbe === 'docker-compose' && premier === 'up');
  if (compose && !args.some((a) => a === '--detach' || /^-[a-z]*d[a-z]*$/.test(a))) return 'docker compose up';
  return null;
}

/** `tail -f`, `journalctl -f` : un suivi qui ne finit jamais seul. */
function suitSansFin(instruction: string): string | null {
  const { verbe, args } = verbeEtArguments(instruction);
  if (verbe === 'tail' && args.some((a) => a === '-f' || a === '-F' || a === '--follow' || /^-[a-zA-Z0-9]*[fF]$/.test(a)))
    return 'tail -f';
  if (verbe === 'journalctl' && args.some((a) => a === '-f' || a === '--follow')) return 'journalctl -f';
  return null;
}

/** Retire le corps des heredocs (« <<EOF … EOF ») : ce n'est pas du shell exécuté ici. */
export function sansHeredocs(commande: string): string {
  return commande.replace(/<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, (entier) =>
    entier.slice(0, entier.indexOf('\n')),
  );
}

/**
 * CETTE COMMANDE VA-T-ELLE BLOQUER LA TÂCHE À ATTENDRE ? Rendue avant qu'elle
 * parte. Lancée en arrière-plan, rien n'est jamais refusé.
 */
export function commandeAttendEnVain(brute: string, contexte: ContexteDuGardeDesAttentes = {}): VerdictDesAttentes {
  if (contexte.arrierePlan || !brute?.trim()) return PASSE;
  // Le CORPS d'un heredoc est du texte (un fichier écrit, un script Python), pas des commandes.
  const commande = sansHeredocs(brute);
  const tout = morceaux(commande);

  /* 1. UNE BOUCLE D'ATTENTE : while/until … sleep … done, non bornée. */
  const boucle = /\b(while|until)\b[\s\S]*\bdo\b[\s\S]*\bsleep\b[\s\S]*\bdone\b/.test(commande);
  const borne = borneTimeout(commande);
  const boucleBornee = borne !== undefined && borne <= BOUCLE_BORNEE_MAXIMUM_S;
  const boucleEnFond = tout.some((m) => m.enFond && /\bdone\b/.test(m.texte));
  if (boucle && !boucleBornee && !boucleEnFond) {
    return {
      refusee: true,
      genre: 'boucle',
      raison:
        "une boucle d'attente (« while/until … sleep … done ») au premier plan bloque la tâche tant que la condition n'arrive pas — jusqu'à dix minutes quand elle n'arrive jamais.",
      conseil: `Trois issues : ${ISSUE_ARRIERE_PLAN} ; ou borne-la : « timeout ${BOUCLE_BORNEE_MAXIMUM_S} bash -c '<la boucle>' » (${BOUCLE_BORNEE_MAXIMUM_S} s au plus) ; ou, si tu attends un serveur d'essai, vérifie-le une seule fois avec « curl --retry 10 --retry-connrefused --retry-delay 1 <adresse> ».`,
    };
  }

  for (const morceau of tout) {
    if (morceau.enFond) continue;
    const borneDuMorceau = borneTimeout(morceau.texte);

    /* 2. UN LONG SOMMEIL au premier plan. */
    const { verbe, args } = verbeEtArguments(morceau.texte);
    if (verbe === 'sleep') {
      // Le sommeil d'une boucle déjà bornée ne compte pas : la borne l'arrête.
      if (boucle && (boucleBornee || boucleEnFond)) continue;
      const total = args.map(dureeEnSecondes).filter(Number.isFinite).reduce((a, b) => a + b, 0);
      if (total > SOMMEIL_MAXIMUM_S) {
        return {
          refusee: true,
          genre: 'sommeil',
          raison: `« sleep ${args.join(' ')} » fait attendre la tâche ${Math.round(total)} s sans rien faire.`,
          conseil: `Deux issues : si tu attends la fin d'un travail, ${ISSUE_ARRIERE_PLAN} ; sinon, attends ${SOMMEIL_MAXIMUM_S} s au plus (« sleep ${SOMMEIL_MAXIMUM_S} ») puis vérifie l'état.`,
        };
      }
      continue;
    }

    if (borneDuMorceau !== undefined) continue;

    /* 3. UN SERVEUR D'ESSAI au premier plan : il ne rend jamais la main. */
    const serveur = lanceUnServeur(morceau.texte);
    if (serveur) {
      return {
        refusee: true,
        genre: 'serveur',
        raison: `« ${serveur} » lance un serveur qui ne rend jamais la main : au premier plan, la tâche reste bloquée jusqu'à la limite de dix minutes.`,
        conseil: `Deux issues : ${ISSUE_ARRIERE_PLAN}, puis attends qu'il réponde avec « curl --retry 10 --retry-connrefused --retry-delay 1 <adresse> » ; ou borne-le : « timeout 60 ${serveur} … ».`,
      };
    }

    /* 4. UN SUIVI SANS FIN (`tail -f`). */
    const suivi = suitSansFin(morceau.texte);
    if (suivi) {
      return {
        refusee: true,
        genre: 'suivi',
        raison: `« ${suivi} » suit un journal sans jamais s'arrêter : la tâche resterait bloquée jusqu'à sa limite.`,
        conseil: `Deux issues : lis la fin du journal une fois (« tail -n 80 <journal> ») ; ou borne le suivi : « timeout 30 ${suivi} <journal> ».`,
      };
    }
  }
  return PASSE;
}

/** Le texte rendu à l'agent quand sa commande est refusée. */
export function refusDesAttentes(verdict: VerdictDesAttentes): string {
  if (!verdict.refusee) return '';
  return `Commande non lancée : ${verdict.raison ?? ''} ${verdict.conseil ?? ''} Reprends simplement avec l'une de ces formes, sans en parler à l'utilisateur.`.trim();
}

/**
 * LA MÊME RÈGLE EN CONSIGNE, pour les moteurs sans hook (Codex, Cursor) : ils ne
 * peuvent pas être arrêtés avant la commande, on leur dit donc la forme juste.
 */
export const CONSIGNE_DES_ATTENTES = `ATTENTES : ne bloque jamais ton tour à attendre. Un serveur d'essai (npm run dev, vite, next dev, docker compose up…) se lance TOUJOURS en arrière-plan (« … > /tmp/journal.log 2>&1 & »), puis se vérifie avec « curl --retry 10 --retry-connrefused --retry-delay 1 <adresse> ». Pas de boucle « while/until … sleep … done » ni de « sleep » de plus de ${SOMMEIL_MAXIMUM_S} s au premier plan : borne-les par « timeout ${BOUCLE_BORNEE_MAXIMUM_S} » ou lance-les en arrière-plan. Pas de « tail -f » : lis « tail -n 80 ».`;
