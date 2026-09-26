/*
 * LE GARDE DU DÉMON : AUCUNE COMMANDE D'AGENT NE COUPE PLUS LE SERVEUR.
 *
 * La règle d'arrêt (`decisionSurSignalDArret`, `demon.ts`) retient un SIGTERM
 * tant qu'un travail tourne. Elle ne peut RIEN contre un `kill -9`, qu'aucun
 * programme ne rattrape, ni contre un `systemctl restart` — qui envoie certes
 * un SIGTERM retenu, mais tue de force vingt secondes plus tard
 * (`TimeoutStopSec=20`). Le 14/08/2026, un agent nettoyant ses processus
 * d'essai a lancé `pkill -9 -f "beluga-serveu"` : le démon est tombé avec
 * onze étapes de travail en vol.
 *
 * On ferme donc le chemin EN AMONT : avant qu'une commande ne parte, on regarde
 * si elle peut atteindre le démon, les moteurs qui portent les tâches ou le
 * service système. Si oui, elle est refusée et l'agent reçoit quoi viser à la
 * place. La règle vit ici, sans disque ni processus : elle se rejoue seule.
 */

import { TITRE_DU_PROCESSUS, TITRE_DU_SERVEUR_D_ESSAI } from './demon.js';

/** Le service système qui porte le démon. */
export const SERVICE_DU_DEMON = 'beluga';

/**
 * LE NOM DU SERVICE, TEL QUE LE GARDE LE SURVEILLE. Un seul : le démon tourne
 * sous `beluga.service`, et aucun ancien nom n'est plus gardé.
 */
export const NOMS_DU_SERVICE = [SERVICE_DU_DEMON];

/**
 * Ce qu'un motif de `pkill`/`killall` ne doit JAMAIS pouvoir désigner. Le démon
 * lui-même, le chemin qu'il portait avant de se renommer, et les moteurs en
 * ligne de commande : tuer un moteur, c'est couper la tâche qu'il exécute.
 */
export const CIBLES_PROTEGEES = [
  TITRE_DU_PROCESSUS,
  'server/dist/main.js',
  '/usr/bin/node',
  'node',
  'npm',
  'claude',
  'codex',
  'cursor-agent',
  ...NOMS_DU_SERVICE.map((nom) => `${nom}.service`),
];

export interface MondeDuGarde {
  /** Le numéro du processus du démon, quand on le connaît. */
  pidDuDemon?: number;
  /** La racine du dépôt du démon : un motif qui la désigne frappe tout. */
  racineDuDemon?: string;
}

export interface VerdictDuGarde {
  /** La commande peut-elle atteindre le démon ou une tâche en cours ? */
  refusee: boolean;
  /** Ce qui est refusé, en une phrase. */
  raison?: string;
  /** Ce qu'il faut faire à la place. */
  conseil?: string;
}

const PASSE: VerdictDuGarde = { refusee: false };

/** Le conseil, toujours le même : viser SON propre essai, jamais un nom partagé. */
const CONSEIL = `Vise le nom de TON propre script d'essai (« pkill -f "[s]cripts/_mon-essai.mjs" » — la première lettre entre crochets, pour que pkill ne tue pas le shell qui le lance), jamais un nom partagé. Un serveur monté pour un contrôle s'appelle « ${TITRE_DU_SERVEUR_D_ESSAI}-<port> » : ce nom-là se vise sans danger (« pkill -f "[${TITRE_DU_SERVEUR_D_ESSAI[0]}]${TITRE_DU_SERVEUR_D_ESSAI.slice(1)}-<port>" »). Pour arrêter ou redémarrer Beluga Build, passe par le bouton de l'interface — il attend la fin des travaux en cours.`;

/**
 * Découpe une ligne de commande en instructions, sans prétendre lire le shell :
 * on veut seulement examiner chaque morceau séparément.
 */
function instructions(commande: string): string[] {
  return commande
    .split(/[\n;]|&&|\|\||\||&/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Les mots d'une instruction, guillemets retirés. */
function mots(instruction: string): string[] {
  const bruts = instruction.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return bruts.map((mot) => mot.replace(/^['"]|['"]$/g, ''));
}

/** Le verbe de l'instruction, une fois les enveloppes habituelles écartées. */
function verbeEtArguments(instruction: string): { verbe: string; args: string[] } {
  const suite = mots(instruction);
  const enveloppes = new Set(['sudo', 'nohup', 'setsid', 'env', 'time', 'exec', 'command', 'bash', 'sh', '-c']);
  let i = 0;
  while (i < suite.length && (enveloppes.has(suite[i]) || suite[i].startsWith('-'))) i += 1;
  const verbe = (suite[i] ?? '').split('/').pop() ?? '';
  return { verbe, args: suite.slice(i + 1) };
}

/** Un motif de `pkill` peut-il désigner l'une des cibles protégées ? */
export function motifTouchLeDemon(motif: string, monde: MondeDuGarde = {}): string | null {
  const propre = motif.trim();
  if (!propre) return null;
  const cibles = [...CIBLES_PROTEGEES];
  if (monde.racineDuDemon?.trim()) cibles.push(monde.racineDuDemon.trim());
  for (const cible of cibles) {
    // `pkill` lit son motif comme une expression régulière étendue ; un motif
    // illisible est jugé pour ce qu'il est, du texte.
    let touche = false;
    try {
      touche = new RegExp(propre).test(cible);
    } catch {
      touche = cible.includes(propre);
    }
    if (touche) return cible;
  }
  return null;
}

/**
 * CE NOM D'UNITÉ EST-IL CELUI DU DÉMON ? Comparé EN ENTIER, jamais « contenu
 * dedans ».
 *
 * Le garde cherchait `mot.includes('beluga')` : il refusait donc
 * `belugabuild-demo.service`, `belugabuild.service` et `beluga-vitrine.service`
 * — trois services de PROJETS, qui n'ont rien à voir avec le démon. Un agent
 * envoyé réparer la publication de l'un d'eux se voyait refuser le seul geste
 * qui l'aurait remise d'aplomb (31/08/2026). On compare donc le nom d'unité
 * complet, suffixe `.service` et chemin retirés.
 */
export function estLeServiceDuDemon(mot: string): boolean {
  const nu = (mot.split('/').pop() ?? '').replace(/\.(service|socket|timer)$/i, '');
  return NOMS_DU_SERVICE.includes(nu);
}

/**
 * Cette commande peut-elle couper le démon ou une tâche en cours ? Rendue avant
 * qu'elle ne parte : c'est le seul moment où l'on peut encore l'empêcher.
 */
export function commandeMenaceLeDemon(commande: string, monde: MondeDuGarde = {}): VerdictDuGarde {
  if (!commande || !commande.trim()) return PASSE;
  for (const instruction of instructions(commande)) {
    const verdict = jugerUneInstruction(instruction, monde);
    if (verdict.refusee) return verdict;
  }
  const seVise = pkillQuiSeVise(commande);
  if (seVise) {
    return {
      refusee: true,
      raison: `le motif « ${seVise.motif} » figure dans cette commande elle-même : « pkill -f » compare TOUTE la ligne de commande des processus, il tuerait donc le shell qui le lance (code 143 ou 144) et la suite ne s'exécuterait jamais.`,
      conseil: `Écris le motif pour qu'il ne se reconnaisse pas : « pkill -f "${seVise.forme}" » vise le même processus sans viser ta propre commande. Si cette commande lance AUSSI ce processus en toutes lettres, fais le pkill dans un appel à part.`,
    };
  }
  return PASSE;
}

/** Les options de `pkill` qui prennent une valeur : cette valeur n'est pas un motif. */
const OPTIONS_A_VALEUR_DE_PKILL = new Set(['-g', '-G', '-P', '-s', '-t', '-u', '-U', '-F', '--signal', '--pidfile', '--ns', '--nslist']);

/**
 * UN `pkill -f` QUI SE VISE LUI-MÊME.
 *
 * `pkill -f` compare son motif à la ligne de commande ENTIÈRE de chaque
 * processus. Celle du shell qui exécute la commande de l'agent contient le
 * motif en toutes lettres : pkill épargne son propre processus, pas son parent,
 * et tue donc le shell. La suite de la commande ne s'exécute jamais, et l'étape
 * tombe en rouge sur un code 143 ou 144 — une centaine de fois en sept jours
 * chez les agents de tâche, venus arrêter leur serveur d'essai.
 *
 * La forme `[v]ite` désigne le même processus sans se reconnaître elle-même :
 * l'expression cherche « vite », la commande contient « [v]ite ».
 */
export function pkillQuiSeVise(commande: string): { motif: string; forme: string } | null {
  for (const instruction of instructions(commande)) {
    const { verbe, args } = verbeEtArguments(instruction);
    if (verbe !== 'pkill') continue;
    if (!args.some((arg) => arg === '--full' || /^-[a-z]*f[a-z]*$/.test(arg))) continue;
    for (let i = 0; i < args.length; i += 1) {
      const motif = args[i];
      // La valeur d'une option, ou une redirection (« 2>/dev/null », « > journal ») : pas un motif.
      if (OPTIONS_A_VALEUR_DE_PKILL.has(motif) || /^(\d+|&)?[<>]{1,2}(&\d+)?$/.test(motif)) {
        i += 1;
        continue;
      }
      if (motif.startsWith('-') || /^(\d+|&)?[<>]/.test(motif) || !motif.trim()) continue;
      let vise: boolean;
      try {
        vise = new RegExp(motif).test(commande);
      } catch {
        // Un motif illisible (souvent coupé par un « \| » du découpage) : pkill
        // le refuserait lui-même, il ne tue donc personne.
        vise = false;
      }
      if (vise) return { motif, forme: formeQuiNeSeVisePas(motif) };
    }
  }
  return null;
}

/** « vite --port 7099 » → « [v]ite --port 7099 » : le même processus, sans soi. */
export function formeQuiNeSeVisePas(motif: string): string {
  const i = motif.search(/[A-Za-z0-9]/);
  if (i < 0) return motif;
  return `${motif.slice(0, i)}[${motif[i]}]${motif.slice(i + 1)}`;
}

function jugerUneInstruction(instruction: string, monde: MondeDuGarde): VerdictDuGarde {
  const { verbe, args } = verbeEtArguments(instruction);

  /*
   * `… | xargs kill -9` : la liste des processus vient d'ailleurs — un `grep`
   * large, le plus souvent — et rien ici ne dit qui elle contient. On ne peut
   * pas juger ce qu'on ne voit pas : on refuse.
   */
  if (verbe === 'xargs' && args.some((mot) => mot === 'kill' || mot === 'pkill')) {
    return {
      refusee: true,
      raison: 'un « xargs kill » tue une liste de processus venue d’ailleurs : rien ne dit qu’elle épargne le démon.',
      conseil: CONSEIL,
    };
  }

  if (verbe === 'systemctl') {
    const gestes = ['restart', 'stop', 'kill', 'reload-or-restart', 'try-restart'];
    const geste = args.find((mot) => gestes.includes(mot));
    const vise = args.some((mot) => estLeServiceDuDemon(mot));
    if (geste && vise) {
      return {
        refusee: true,
        raison: `« ${geste} » sur le service ${SERVICE_DU_DEMON} coupe le démon : il tue de force vingt secondes après la demande, sans égard pour les tâches en vol.`,
        conseil: CONSEIL,
      };
    }
    return PASSE;
  }

  if (verbe === 'pkill' || verbe === 'killall') {
    for (const arg of args) {
      if (arg.startsWith('-')) continue;
      const cible = motifTouchLeDemon(arg, monde);
      if (cible) {
        return {
          refusee: true,
          raison: `le motif « ${arg} » désigne aussi « ${cible} » : ce ${verbe} couperait le démon Beluga Build ou un moteur qui exécute une tâche.`,
          conseil: CONSEIL,
        };
      }
    }
    return PASSE;
  }

  if (verbe === 'kill') {
    /*
     * Le premier argument peut être le SIGNAL (« -9 », « -KILL », « -s KILL ») :
     * il se lit comme un nombre négatif sans en être un. Ce qui suit, en
     * revanche, désigne des processus — et un nombre négatif y désigne tout un
     * groupe.
     */
    let debut = 0;
    if (args[0]?.startsWith('-')) debut = args[0] === '-s' || args[0] === '-n' ? 2 : 1;
    for (const arg of args.slice(debut)) {
      const numero = Number(arg);
      if (!Number.isInteger(numero)) continue;
      if (monde.pidDuDemon && numero === monde.pidDuDemon) {
        return {
          refusee: true,
          raison: `le processus ${numero} est le démon Beluga Build lui-même : le tuer coupe toutes les tâches et toutes les publications en cours.`,
          conseil: CONSEIL,
        };
      }
      if (numero <= 0) {
        return {
          refusee: true,
          raison: `« kill ${arg} » frappe tout un groupe de processus, démon compris.`,
          conseil: CONSEIL,
        };
      }
    }
    return PASSE;
  }

  return PASSE;
}

/** Le texte rendu à l'agent quand sa commande est refusée. */
export function refusDuGarde(verdict: VerdictDuGarde): string {
  if (!verdict.refusee) return '';
  return `Commande refusée : ${verdict.raison ?? 'elle peut couper le démon Beluga Build.'} ${verdict.conseil ?? CONSEIL}`.trim();
}

/**
 * Les réglages Claude qui branchent le garde devant CHAQUE commande d'un agent.
 * Le hook est un petit script du dépôt : il rejoue la règle ci-dessus et refuse
 * en clair, au lieu de laisser partir un geste irrattrapable.
 */
export function hooksDuGardeDuDemon(cheminDuGarde: string): Record<string, unknown> {
  return {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [{ type: 'command', command: `node ${cheminDuGarde}` }],
      },
    ],
  };
}
