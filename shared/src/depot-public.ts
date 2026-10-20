/*
 * LE DÉPÔT PUBLIC DE BELUGA SE LIT, IL NE REÇOIT JAMAIS RIEN D'UNE COPIE.
 *
 * Décision de l'utilisateur du 20/10/2026 : une installation venue du dépôt
 * public (`DEPOT_PUBLIC`) garde le moyen de se METTRE À JOUR depuis lui, mais
 * rien de ce qu'on y modifie ne doit jamais y repartir — ni code, ni
 * proposition de modification, ni ticket. Le seul chemin d'envoi vers lui est
 * la synchronisation du miroir, sur la machine de l'auteur.
 *
 * Trois verrous, du plus bas au plus haut :
 *  1. git : tout distant qui désigne le dépôt public reçoit une adresse
 *     d'ENVOI impossible (`ADRESSE_D_ENVOI_INTERDITE`) — la lecture, elle, ne
 *     change pas. Plus une règle `pushInsteadOf` globale du compte du service,
 *     qui couvre aussi un distant ajouté à la main ou une adresse tapée en
 *     entier, terminal du serveur compris ;
 *  2. le démon refuse lui-même tout envoi vers ce dépôt (`deploy.ts` et les
 *     autres poussées) ;
 *  3. le garde des commandes d'agent refuse `git push`, `gh pr create`,
 *     `gh issue create`, `gh api` en écriture… qui le visent
 *     (`commandeEnvoieAuDepotPublic`).
 *
 * La règle vit ici, sans disque ni processus : elle se rejoue seule.
 */

import { DEPOT_PUBLIC, DISTANT_PUBLIC, depotDeLAdresse } from './installation.js';

/**
 * L'ADRESSE D'ENVOI D'UN DISTANT VERROUILLÉ. Un protocole que git ne connaît
 * pas : l'envoi échoue tout de suite, en nommant la raison, sans réseau.
 */
export const ADRESSE_D_ENVOI_INTERDITE = 'envoi-interdit://depot-public-de-beluga';

/** Le dépôt public, tel que `depotDeLAdresse` le rend (« propriétaire/nom »). */
const DEPOT_PUBLIC_COURT = depotDeLAdresse(DEPOT_PUBLIC);

/** Cette adresse désigne-t-elle le dépôt public, sous quelque forme que ce soit ? */
export function estLeDepotPublic(adresse: string | null | undefined): boolean {
  return !!adresse && depotDeLAdresse(adresse) === DEPOT_PUBLIC_COURT;
}

/**
 * LES PRÉFIXES QUE LA RÈGLE GLOBALE `pushInsteadOf` DÉTOURNE. Seulement les
 * formes en `.git` : git compare des PRÉFIXES, et « …/beluga » sans suffixe
 * attraperait aussi « …/beluga-autre ». Les formes sans suffixe sont couvertes
 * par l'adresse d'envoi posée sur chaque distant et par le garde des agents.
 */
export function prefixesDuDepotPublic(): string[] {
  return [
    `https://github.com/${DEPOT_PUBLIC_COURT}.git`,
    `git@github.com:${DEPOT_PUBLIC_COURT}.git`,
    `ssh://git@github.com/${DEPOT_PUBLIC_COURT}.git`,
  ];
}

/** Un distant, lu dans `git remote -v` : son adresse de lecture et son adresse d'envoi. */
export interface DistantLu {
  nom: string;
  lecture?: string;
  envoi?: string;
}

/** `git remote -v` rangé par distant. */
export function lireLesDistants(sortie: string): DistantLu[] {
  const parNom = new Map<string, DistantLu>();
  for (const ligne of sortie.split('\n')) {
    const trouve = /^(\S+)\s+(\S+)\s+\((fetch|push)\)\s*$/.exec(ligne.trim());
    if (!trouve) continue;
    const [, nom, adresse, sens] = trouve;
    const distant = parNom.get(nom) ?? { nom };
    if (sens === 'fetch') distant.lecture = adresse;
    else distant.envoi = adresse;
    parNom.set(nom, distant);
  }
  return [...parNom.values()];
}

/**
 * LES DISTANTS À VERROUILLER : ceux qui lisent OU envoient vers le dépôt
 * public et dont l'adresse d'envoi n'est pas encore l'adresse interdite. Un
 * distant d'un autre dépôt (le dépôt privé d'une copie, celui de l'auteur)
 * n'est jamais touché.
 */
export function distantsAVerrouiller(distants: readonly DistantLu[]): string[] {
  return distants
    .filter((d) => (estLeDepotPublic(d.lecture) || estLeDepotPublic(d.envoi)) && d.envoi !== ADRESSE_D_ENVOI_INTERDITE)
    .map((d) => d.nom);
}

/** Un envoi vers ce distant partirait-il au dépôt public ? Lecture OU envoi suffisent à le dire. */
export function distantVersLeDepotPublic(distant: DistantLu | undefined): boolean {
  if (!distant) return false;
  return estLeDepotPublic(distant.lecture) || estLeDepotPublic(distant.envoi) || distant.envoi === ADRESSE_D_ENVOI_INTERDITE;
}

/* ------------------------------------------------------------------ */
/* Le garde des commandes d'agent                                       */
/* ------------------------------------------------------------------ */

export interface VerdictDEnvoi {
  refusee: boolean;
  raison?: string;
  conseil?: string;
}

const PASSE: VerdictDEnvoi = { refusee: false };

const CONSEIL_D_ENVOI =
  'Le dépôt public de Beluga Build se LIT (les nouveautés en viennent) mais ne reçoit jamais rien d’une installation. Envoie ton travail sur le dépôt de cette installation (« origin »), et pour écrire à l’équipe Beluga, passe par « Contacter l’équipe Beluga » dans les réglages.';

function instructionsDe(commande: string): string[] {
  return commande
    .split(/[\n;]|&&|\|\||\||&/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function motsDe(instruction: string): string[] {
  const bruts = instruction.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return bruts.map((mot) => mot.replace(/^['"]|['"]$/g, ''));
}

/** Le programme et ses arguments, enveloppes (`sudo`, `env X=1`…) et options de git (`-C dir`) écartées. */
function programmeEtArguments(instruction: string): { programme: string; args: string[] } {
  const suite = motsDe(instruction);
  const enveloppes = new Set(['sudo', 'nohup', 'setsid', 'env', 'time', 'exec', 'command']);
  let i = 0;
  while (i < suite.length && (enveloppes.has(suite[i]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(suite[i]) || (i > 0 && suite[i].startsWith('-') && enveloppes.has(suite[i - 1])))) i += 1;
  const programme = (suite[i] ?? '').split('/').pop() ?? '';
  return { programme, args: suite.slice(i + 1) };
}

/** Le sous-geste de git, ses options globales sautées (`-C <dir>`, `-c clé=val`, `--git-dir=…`). */
function sousCommandeDeGit(args: string[]): { geste: string; reste: string[] } {
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) {
    i += args[i] === '-C' || args[i] === '-c' ? 2 : 1;
  }
  return { geste: args[i] ?? '', reste: args.slice(i + 1) };
}

/** Un mot désigne-t-il le dépôt public (adresse, « propriétaire/nom ») ? */
function motDuDepotPublic(mot: string): boolean {
  const propre = mot.replace(/^--?[a-z-]+=/i, '').toLowerCase();
  return estLeDepotPublic(propre) || propre === DEPOT_PUBLIC_COURT;
}

/** Une adresse GitHub qui mène DANS le dépôt public (« …/haikostudio/beluga/pull/3 »). */
const ADRESSE_DANS_LE_DEPOT_PUBLIC = new RegExp(`github\\.com[:/]+${DEPOT_PUBLIC_COURT.replace('/', '\\/')}(\\.git)?(\\/|$)`, 'i');

/** La cible d'un `gh … -R/--repo <dépôt>`, d'un chemin `gh api repos/<dépôt>/…` ou d'une adresse du dépôt. */
function ghViseLeDepotPublic(args: string[]): boolean {
  for (let i = 0; i < args.length; i += 1) {
    const mot = args[i];
    if ((mot === '-R' || mot === '--repo') && args[i + 1] && motDuDepotPublic(args[i + 1])) return true;
    if (/^--repo=/.test(mot) && motDuDepotPublic(mot)) return true;
    if (new RegExp(`^/?repos/${DEPOT_PUBLIC_COURT}(/|$)`, 'i').test(mot)) return true;
    if (!/\s/.test(mot) && ADRESSE_DANS_LE_DEPOT_PUBLIC.test(mot)) return true;
    // `gh repo fork haikostudio/beluga` : la cible est un argument nu.
    if (!mot.startsWith('-') && mot.toLowerCase() === DEPOT_PUBLIC_COURT) return true;
  }
  return false;
}

/** Les gestes de `gh` qui ÉCRIVENT sur un dépôt. Tout le reste (lire, lister, cloner) passe. */
const GESTES_GH_QUI_ECRIVENT: Record<string, readonly string[]> = {
  pr: ['create', 'comment', 'edit', 'merge', 'close', 'reopen', 'review', 'ready'],
  issue: ['create', 'comment', 'edit', 'close', 'reopen', 'transfer', 'pin', 'lock'],
  repo: ['fork', 'edit', 'delete', 'archive', 'rename', 'sync'],
  release: ['create', 'upload', 'edit', 'delete'],
  label: ['create', 'edit', 'delete', 'clone'],
  workflow: ['run', 'enable', 'disable'],
  discussion: ['create', 'comment'],
};

/** `gh api` écrit dès qu'il a une méthode d'écriture ou un champ (`-f`, `-F`, `--input` le font passer en POST). */
function ghApiEcrit(args: string[]): boolean {
  for (let i = 0; i < args.length; i += 1) {
    const mot = args[i];
    if (mot === '-X' || mot === '--method') {
      if (/^(post|put|patch|delete)$/i.test(args[i + 1] ?? '')) return true;
    }
    if (/^--method=(post|put|patch|delete)$/i.test(mot) || /^-X(post|put|patch|delete)$/i.test(mot)) return true;
    if (['-f', '-F', '--field', '--raw-field', '--input'].includes(mot) || /^--(raw-)?field=/.test(mot)) return true;
  }
  return false;
}

function refus(raison: string): VerdictDEnvoi {
  return { refusee: true, raison, conseil: CONSEIL_D_ENVOI };
}

function jugerUneInstructionDEnvoi(instruction: string): VerdictDEnvoi {
  const { programme, args } = programmeEtArguments(instruction);

  if (programme === 'git') {
    const { geste, reste } = sousCommandeDeGit(args);
    if (geste === 'push') {
      const cibles = reste.filter((mot) => !mot.startsWith('-'));
      if (cibles[0] === DISTANT_PUBLIC || cibles.some(motDuDepotPublic) || cibles[0] === ADRESSE_D_ENVOI_INTERDITE) {
        return refus('cet envoi vise le dépôt public de Beluga Build, qui ne reçoit jamais rien d’une installation.');
      }
      return PASSE;
    }
    if (geste === 'remote') {
      const [action, ...suite] = reste;
      // Redonner au distant public une adresse d'envoi, c'est retirer le verrou.
      if (action === 'set-url' && suite.includes('--push')) {
        const [nom, ...adresses] = suite.filter((m) => !m.startsWith('-'));
        if (nom === DISTANT_PUBLIC || adresses.some(motDuDepotPublic)) {
          return refus('ce geste rouvrirait l’envoi vers le dépôt public de Beluga Build.');
        }
      }
      return PASSE;
    }
    if (geste === 'config') {
      const touche = reste.some((m) => /pushinsteadof|pushurl/i.test(m));
      const visePublic = reste.some((m) => m.includes(ADRESSE_D_ENVOI_INTERDITE) || motDuDepotPublic(m) || new RegExp(`^remote\\.${DISTANT_PUBLIC}\\.`, 'i').test(m));
      if (touche && visePublic) return refus('ce réglage toucherait au verrou d’envoi du dépôt public de Beluga Build.');
      return PASSE;
    }
    return PASSE;
  }

  if (programme === 'gh') {
    const [groupe, geste, ...suite] = args;
    if (groupe === 'api') {
      const reste = [geste ?? '', ...suite];
      if (ghApiEcrit(reste) && ghViseLeDepotPublic(reste)) {
        return refus('cet appel écrirait sur le dépôt public de Beluga Build (ticket, commentaire, proposition…).');
      }
      return PASSE;
    }
    const ecrit = GESTES_GH_QUI_ECRIVENT[groupe ?? '']?.includes(geste ?? '');
    if (ecrit && ghViseLeDepotPublic(suite)) {
      return refus(`« gh ${groupe} ${geste} » écrirait sur le dépôt public de Beluga Build, qui ne reçoit jamais rien d’une installation.`);
    }
    // `gh repo fork` sans cible, lancé dans une copie, prend le dépôt d'origine : refusé aussi.
    if (groupe === 'repo' && geste === 'fork') {
      return refus('« gh repo fork » ferait partir cette installation vers le dépôt public de Beluga Build.');
    }
    return PASSE;
  }

  return PASSE;
}

/**
 * CETTE COMMANDE ENVOIE-T-ELLE QUELQUE CHOSE AU DÉPÔT PUBLIC ? Rendue avant
 * qu'elle ne parte. Ne vise que les ENVOIS : lire (`git fetch amont`,
 * `gh repo view haikostudio/beluga`, `gh issue list -R …`) passe toujours.
 */
export function commandeEnvoieAuDepotPublic(commande: string): VerdictDEnvoi {
  if (!commande || !commande.trim()) return PASSE;
  for (const instruction of instructionsDe(commande)) {
    const verdict = jugerUneInstructionDEnvoi(instruction);
    if (verdict.refusee) return verdict;
  }
  return PASSE;
}

/** Le texte rendu à l'agent quand l'envoi est refusé. */
export function refusDEnvoi(verdict: VerdictDEnvoi): string {
  if (!verdict.refusee) return '';
  return `Commande refusée : ${verdict.raison ?? 'elle vise le dépôt public de Beluga Build.'} ${verdict.conseil ?? CONSEIL_D_ENVOI}`.trim();
}
