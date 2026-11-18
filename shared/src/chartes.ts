import { minusculesSansAccents } from './mots.js';
/**
 * LES CHARTES D'INTERFACE D'UN PROJET — règles pures, sans disque ni base.
 *
 * Constat du 05/11/2026 : les règles d'interface existaient (MEM-5799, MEM-0781,
 * la compétence de structure…) mais n'arrivaient pas à l'agent qui code. Elles
 * étaient noyées parmi 3 600 unités P1 que l'accueil plafonné ne sert presque
 * pas, et l'agent ne les cherchait jamais. Une CHARTE est la réponse : un texte
 * COURT (une vingtaine de règles), versionné dans le dépôt du projet
 * (`docs/chartes/<nom>.md`), SERVI D'OFFICE à tout tour qui touche son domaine,
 * et dont les INTERDITS se contrôlent sans navigateur.
 *
 * Plusieurs chartes par projet : chacune a son domaine (application, espace
 * client, documents…) et ses déclencheurs — des chemins de fichiers et des mots
 * de la demande.
 *
 * FORMAT D'UN FICHIER (une entête entre deux lignes « --- », puis le corps) :
 *
 *   ---
 *   titre: Application Beluga
 *   domaine: L'interface de l'application (web/src)
 *   etat: validee                      # ou « proposee »
 *   chemins: web/src/**, web/index.html
 *   mots: écran, page, formulaire, liste
 *   modeles: web/src/components/modeles
 *   interdit: <select> | Liste native : passe par ListeDeroulante | web/src/components/ui/index.tsx
 *   interdit: <input type=checkbox|radio> | Case native : CaseACocher | web/src/components/ui/elements-maison.tsx
 *   interdit: /\bwindow\.confirm\(/ | Pas de fenêtre native
 *   ---
 *   1. Première règle…
 *
 * Un INTERDIT : un motif, un message, puis les chemins exemptés (séparés par
 * des virgules). Le motif est une BALISE (`<select>`, `<input type=a|b>`) —
 * cherchée dans le code débarrassé de ses commentaires, attributs lus jusqu'à
 * la vraie fin de la balise (une flèche `=>` dans un attribut ne la coupe pas) —
 * ou une expression régulière entre barres obliques.
 */

export type EtatDeCharte = 'proposee' | 'validee';

export interface InterditDeCharte {
  /** Le motif tel qu'écrit dans la charte. */
  motif: string;
  message: string;
  /** Les chemins (motifs) où l'interdit ne s'applique pas — le composant maison lui-même. */
  sauf: string[];
}

export interface Charte {
  /** Le nom du fichier, sans « .md » : sa clé. */
  nom: string;
  titre: string;
  domaine: string;
  etat: EtatDeCharte;
  chemins: string[];
  mots: string[];
  modeles?: string;
  interdits: InterditDeCharte[];
  /** Les règles, en Markdown. */
  corps: string;
}

/** Le dossier des chartes, à la racine du dépôt de chaque projet. */
export const DOSSIER_DES_CHARTES = 'docs/chartes';

/**
 * LE PLAFOND D'UNE CHARTE SERVIE, mesuré (2,2 signes par jeton : ~2 700 jetons).
 * Une charte plus longue est tronquée au service et le contrôle la refuse :
 * une charte qui s'allonge redevient la mémoire noyée qu'elle remplace.
 */
export const PLAFOND_D_UNE_CHARTE = 6_000;
/** Le plafond du bloc entier, quand plusieurs chartes concernent le même tour. */
export const PLAFOND_DU_BLOC_DES_CHARTES = 14_000;

const listeSeparee = (texte: string): string[] =>
  texte
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** Lit un fichier de charte. Rend `null` quand l'entête manque ou n'a pas de titre. */
export function lireCharte(nom: string, texte: string): Charte | null {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(texte);
  if (!m) return null;
  const charte: Charte = { nom, titre: '', domaine: '', etat: 'proposee', chemins: [], mots: [], interdits: [], corps: m[2].trim() };
  for (const ligne of m[1].split(/\r?\n/)) {
    const i = ligne.indexOf(':');
    if (i < 0) continue;
    const cle = ligne.slice(0, i).trim().toLowerCase();
    const valeur = ligne.slice(i + 1).trim();
    if (cle === 'titre') charte.titre = valeur;
    else if (cle === 'domaine') charte.domaine = valeur;
    else if (cle === 'etat') charte.etat = /^valid/i.test(valeur) ? 'validee' : 'proposee';
    else if (cle === 'chemins') charte.chemins = listeSeparee(valeur);
    else if (cle === 'mots') charte.mots = listeSeparee(valeur).map((x) => x.toLowerCase());
    else if (cle === 'modeles') charte.modeles = valeur || undefined;
    else if (cle === 'interdit') {
      const [motif, message, sauf] = valeur.split(' | ').map((x) => x?.trim() ?? '');
      if (motif && message) charte.interdits.push({ motif, message, sauf: listeSeparee(sauf ?? '') });
    }
  }
  return charte.titre ? charte : null;
}

/** `**` traverse les dossiers, `*` reste dans un nom ; un motif sans joker vaut aussi pour ce qu'il contient. */
export function cheminCorrespond(motif: string, chemin: string): boolean {
  const propre = chemin.replace(/\\/g, '/').replace(/^\.\//, '');
  const m = motif.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!/[*?]/.test(m)) return propre === m || propre.startsWith(m.endsWith('/') ? m : `${m}/`);
  const source = m
    .split('**')
    .map((bout) => bout.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]'))
    .join('.*');
  return new RegExp(`^${source}$`).test(propre);
}

const sansAccents = minusculesSansAccents;

/**
 * LES CHARTES QUI CONCERNENT UN TOUR : un fichier prévu ou touché sous l'un de
 * leurs chemins, ou l'un de leurs mots dans la demande (mot entier, accents
 * ignorés). Les chartes validées passent avant les proposées.
 */
export function chartesConcernees(
  chartes: readonly Charte[],
  travail: { fichiers?: readonly string[]; demande?: string },
): Charte[] {
  const demande = ` ${sansAccents(travail.demande ?? '').replace(/[^a-z0-9]+/g, ' ')} `;
  return chartes
    .filter(
      (c) =>
        (travail.fichiers ?? []).some((f) => c.chemins.some((motif) => cheminCorrespond(motif, f))) ||
        c.mots.some((mot) => {
          const propre = sansAccents(mot).replace(/[^a-z0-9]+/g, ' ').trim();
          return propre && (demande.includes(` ${propre} `) || demande.includes(` ${propre}s `));
        }),
    )
    .sort((a, b) => (a.etat === b.etat ? 0 : a.etat === 'validee' ? -1 : 1));
}

/** Les chemins de fichiers cités dans un texte (tâches de la compréhension, demande). */
export function cheminsCitesDans(texte: string): string[] {
  const vus = new Set<string>();
  for (const m of texte.matchAll(/(?:^|[\s`'"(«])((?:[\w.@-]+\/)+[\w.@-]+\.[a-z0-9]{1,5})(?::\d+)?/gim)) vus.add(m[1]);
  return [...vus];
}

/** Le texte d'une charte pour l'agent, sous son plafond. */
function texteDUneCharte(c: Charte, plafond: number): string {
  const tete = [
    `### ${c.titre}${c.etat === 'proposee' ? ' (PROPOSÉE — pas encore validée par l’utilisateur : applique-la, et signale ce qui te semble faux)' : ''}`,
    `Domaine : ${c.domaine || '—'} · fichier \`${DOSSIER_DES_CHARTES}/${c.nom}.md\``,
    c.modeles ? `Modèles de pages à partir desquels construire : \`${c.modeles}\`` : '',
    c.interdits.length ? `Interdits contrôlés à la fin du tour : ${c.interdits.map((i) => i.motif).join(' · ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const reste = Math.max(0, plafond - tete.length - 2);
  const corps = c.corps.length > reste ? `${c.corps.slice(0, Math.max(0, reste - 40)).trimEnd()}\n… (suite dans le fichier)` : c.corps;
  return `${tete}\n\n${corps}`;
}

/**
 * LE BLOC DES CHARTES SERVI D'OFFICE. Il part dans la DEMANDE du tour, jamais
 * dans la consigne système (stable d'un tour à l'autre d'une session).
 */
export function texteDesChartes(chartes: readonly Charte[], options: { cadrage?: boolean } = {}): string {
  if (!chartes.length) return '';
  const entete = [
    'CHARTE D’INTERFACE DU PROJET — servie d’office parce que ce travail touche son domaine. Ses règles PASSENT AVANT tes habitudes : tu construis avec les composants et les modèles qu’elle nomme, jamais avec un élément natif ou un écran inventé.',
    options.cadrage
      ? 'AU CADRAGE : recopie dans les faits de ta compréhension les règles de cette charte qui concernent la demande (avec leur numéro), pour que l’agent qui exécute les ait sous les yeux.'
      : 'À LA FIN DU TOUR, un contrôle relit tes fichiers contre ses interdits et exige une RELECTURE EN IMAGES des écrans touchés (ordinateur 1440 px et téléphone 390 px, clair et sombre, captures écrites pendant le tour) : un manquement te renvoie corriger au lieu de rendre. Un doute sur une règle ou une mise en page non couverte se pose à l’utilisateur par « ask_user », captures à l’appui.',
  ].join('\n');
  // L'entête d'une charte (titre, domaine, interdits) s'ajoute à son corps : la place de chacune les compte tous deux.
  const parCharte = Math.max(1_500, Math.min(PLAFOND_D_UNE_CHARTE + 1_500, Math.floor((PLAFOND_DU_BLOC_DES_CHARTES - entete.length) / chartes.length)));
  return [entete, ...chartes.map((c) => texteDUneCharte(c, parCharte))].join('\n\n');
}

/* ------------------------------------------------------------------ */
/* Le garde-fou : les interdits contrôlés sans navigateur               */
/* ------------------------------------------------------------------ */

export interface ManquementALaCharte {
  charte: string;
  chemin: string;
  ligne: number;
  motif: string;
  message: string;
  extrait: string;
}

/**
 * Le code sans ses commentaires, LONGUEUR ET LIGNES GARDÉES (chaque signe d'un
 * commentaire devient une espace, chaque saut de ligne reste) : une position
 * dans le texte propre est la même que dans le fichier. Les chaînes sont
 * respectées — un « // » dans une adresse n'ouvre pas de commentaire.
 */
export function codeSansCommentaires(code: string): string {
  let sortie = '';
  let i = 0;
  let chaine: string | null = null;
  while (i < code.length) {
    const c = code[i];
    const suivant = code[i + 1];
    if (chaine) {
      sortie += c;
      if (c === '\\') {
        sortie += suivant ?? '';
        i += 2;
        continue;
      }
      // Une chaîne simple ne passe jamais la ligne : une apostrophe de texte prise pour une chaîne s'arrête là.
      if (c === chaine || (c === '\n' && chaine !== '`')) chaine = null;
      i += 1;
      continue;
    }
    if (c === '/' && suivant === '/') {
      while (i < code.length && code[i] !== '\n') {
        sortie += ' ';
        i += 1;
      }
      continue;
    }
    if (c === '/' && suivant === '*') {
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) {
        sortie += code[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      sortie += '  ';
      i += 2;
      continue;
    }
    // Les guillemets droits seulement : une apostrophe dans du texte JSX n'est pas une chaîne fiable,
    // on ne la suit que si elle ouvre visiblement une chaîne de code (après = ( , [ : ? ou une espace).
    if (c === '"' || c === '`' || (c === "'" && /[=(,[:?\s{]/.test(code[i - 1] ?? ' '))) {
      chaine = c;
    }
    sortie += c;
    i += 1;
  }
  return sortie;
}

/** La balise entière qui commence à `debut` (`<nom …>`), accolades et chaînes comprises. */
function baliseEntiere(code: string, debut: number): string {
  let profondeur = 0;
  let chaine: string | null = null;
  for (let i = debut + 1; i < code.length && i < debut + 4_000; i += 1) {
    const c = code[i];
    if (chaine) {
      if (c === '\\') i += 1;
      else if (c === chaine) chaine = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') chaine = c;
    else if (c === '{') profondeur += 1;
    else if (c === '}') profondeur -= 1;
    else if (c === '>' && profondeur <= 0) return code.slice(debut, i + 1);
  }
  return code.slice(debut, debut + 200);
}

interface MotifCompile {
  trouver: (code: string) => { index: number; extrait: string }[];
}

/** Compile le motif d'un interdit : balise `<nom attr=a|b>` ou expression `/…/`. */
export function compilerLeMotif(motif: string): MotifCompile | null {
  const expression = /^\/(.+)\/([a-z]*)$/.exec(motif);
  if (expression) {
    let re: RegExp;
    try {
      re = new RegExp(expression[1], expression[2].includes('g') ? expression[2] : `${expression[2]}g`);
    } catch {
      return null;
    }
    return {
      trouver: (code) => [...code.matchAll(re)].map((m) => ({ index: m.index ?? 0, extrait: m[0] })),
    };
  }
  const balise = /^<([A-Za-z][\w.-]*)((?:\s+[\w-]+=[^\s>]+)*)\s*\/?>$/.exec(motif.trim());
  if (!balise) return null;
  const nom = balise[1];
  const conditions = [...(balise[2] ?? '').matchAll(/([\w-]+)=([^\s>]+)/g)].map((m) => ({
    attribut: m[1],
    valeurs: m[2].split('|').map((v) => v.toLowerCase()),
  }));
  const ouverture = new RegExp(`<${nom.replace(/[.]/g, '\\.')}(?=[\\s/>])`, 'g');
  return {
    trouver: (code) => {
      const trouvees: { index: number; extrait: string }[] = [];
      for (const m of code.matchAll(ouverture)) {
        const index = m.index ?? 0;
        const tag = baliseEntiere(code, index);
        const ok = conditions.every(({ attribut, valeurs }) => {
          const v = new RegExp(`\\s${attribut}\\s*=\\s*(?:\\{\\s*)?["'\`]([^"'\`]*)["'\`]`).exec(tag);
          return !!v && valeurs.includes(v[1].toLowerCase());
        });
        if (ok) trouvees.push({ index, extrait: tag.replace(/\s+/g, ' ').slice(0, 120) });
      }
      return trouvees;
    },
  };
}

/**
 * LE CONTRÔLE DES INTERDITS : chaque fichier sous les chemins d'une charte
 * (hors ses exemptions) est relu, commentaires ôtés. Rend chaque manquement
 * avec son fichier et sa ligne — jamais un simple « non ».
 */
export function controlerLesInterdits(
  chartes: readonly Charte[],
  fichiers: readonly { chemin: string; contenu: string }[],
): ManquementALaCharte[] {
  const manquements: ManquementALaCharte[] = [];
  for (const charte of chartes) {
    const motifs = charte.interdits
      .map((interdit) => ({ interdit, compile: compilerLeMotif(interdit.motif) }))
      .filter((x): x is { interdit: InterditDeCharte; compile: MotifCompile } => !!x.compile);
    if (!motifs.length) continue;
    for (const fichier of fichiers) {
      if (!charte.chemins.some((m) => cheminCorrespond(m, fichier.chemin))) continue;
      if (!/\.(tsx|jsx|ts|js|vue|svelte|html|astro)$/.test(fichier.chemin)) continue;
      let propre: string | null = null;
      for (const { interdit, compile } of motifs) {
        if (interdit.sauf.some((m) => cheminCorrespond(m, fichier.chemin))) continue;
        propre ??= codeSansCommentaires(fichier.contenu);
        for (const t of compile.trouver(propre)) {
          manquements.push({
            charte: charte.nom,
            chemin: fichier.chemin,
            ligne: propre.slice(0, t.index).split('\n').length,
            motif: interdit.motif,
            message: interdit.message,
            extrait: t.extrait,
          });
        }
      }
    }
  }
  return manquements;
}

/** Les manquements en texte, pour l'agent renvoyé corriger et pour le test. */
export function texteDesManquements(manquements: readonly ManquementALaCharte[]): string {
  return manquements.map((m) => `- ${m.chemin}:${m.ligne} — ${m.message} (${m.extrait})`).join('\n');
}

/* ------------------------------------------------------------------ */
/* La porte de fin de tour                                              */
/* ------------------------------------------------------------------ */

/** Au-delà, la porte laisse rendre et le DIT : jamais une carte coincée en « En cours ». */
export const RENVOIS_MAX_DE_LA_PORTE = 2;

export interface EtatDeFinDeTour {
  /** Les fichiers modifiés sur la branche de la carte. */
  fichiersModifies: readonly string[];
  /** Les chartes du projet. */
  chartes: readonly Charte[];
  manquements: readonly ManquementALaCharte[];
  /** Images écrites ou jointes pendant le travail de la carte. */
  captures: number;
  /** Combien de fois la porte a déjà renvoyé l'agent sur cette carte. */
  renvois: number;
}

export type VerdictDeFinDeTour =
  | { issue: 'rendre'; raison: 'hors-interface' | 'conforme' }
  | { issue: 'rendre'; raison: 'renvois-epuises'; texte: string }
  | { issue: 'renvoyer'; texte: string };

/** Les fichiers d'écran touchés : sous les chemins d'une charte, et du code ou du style. */
export function fichiersDInterface(chartes: readonly Charte[], fichiers: readonly string[]): string[] {
  return fichiers.filter(
    (f) => /\.(tsx|jsx|vue|svelte|html|astro|css|scss)$/.test(f) && chartes.some((c) => c.chemins.some((m) => cheminCorrespond(m, f))),
  );
}

/**
 * LA PORTE DE FIN DE TOUR D'UNE CARTE QUI TOUCHE L'INTERFACE. Deux exigences :
 * aucun interdit d'une charte dans les fichiers modifiés, et une relecture en
 * images (au moins une capture pendant le travail). Un manquement RENVOIE
 * l'agent corriger, deux fois au plus ; au-delà la carte se rend quand même et
 * le manquement est DIT dans son fil — chaque fin de tour a une issue.
 */
export function verdictDeFinDeTour(e: EtatDeFinDeTour): VerdictDeFinDeTour {
  const ecrans = fichiersDInterface(e.chartes, e.fichiersModifies);
  if (!ecrans.length && !e.manquements.length) return { issue: 'rendre', raison: 'hors-interface' };
  const manques: string[] = [];
  if (e.manquements.length) {
    manques.push(
      `INTERDITS DE LA CHARTE — remplace chacun par le composant maison qu'elle nomme :\n${texteDesManquements(e.manquements)}`,
    );
  }
  if (ecrans.length && e.captures === 0) {
    manques.push(
      [
        `RELECTURE EN IMAGES MANQUANTE — tu as modifié ${ecrans.length} fichier(s) d'écran (${ecrans.slice(0, 5).join(', ')}${ecrans.length > 5 ? '…' : ''}) sans en regarder le rendu.`,
        'Lance le serveur de développement sur un port à toi (jamais l’application publiée), capture chaque écran touché à 1440 px puis 390 px, en clair puis en sombre, compare chaque capture à la charte, corrige, puis recapture. Les images écrites pendant le tour se joignent toutes seules au compte rendu.',
        'Si une règle est ambiguë ou si la mise en page n’est pas couverte par la charte, pose la question à l’utilisateur avec « ask_user », captures en options.',
      ].join('\n'),
    );
  }
  if (!manques.length) return { issue: 'rendre', raison: 'conforme' };
  const texte = manques.join('\n\n');
  if (e.renvois >= RENVOIS_MAX_DE_LA_PORTE) return { issue: 'rendre', raison: 'renvois-epuises', texte };
  return {
    issue: 'renvoyer',
    texte: [
      'CONTRÔLE DE FIN DE TRAVAIL — ta carte touche l’interface, et le contrôle de la charte n’est pas passé. Ne rends pas encore : corrige ce qui suit, revérifie, enregistre et sauvegarde, puis rends ton compte rendu.',
      texte,
    ].join('\n\n'),
  };
}

/* ------------------------------------------------------------------ */
/* La charte rédigée seule, projet par projet                           */
/* ------------------------------------------------------------------ */

/** L'étiquette des cartes qui rédigent la charte d'un projet. */
export const LABEL_CHARTE = 'charte-interface';
export const TITRE_CARTE_DE_CHARTE = 'Charte d’interface du projet';

/** Ce que la carte dit à l'écran, en mots courants. */
export function descriptionDeLaCarteDeCharte(nomDuProjet: string): string {
  return `Rédiger la charte d’interface de ${nomDuProjet} à partir de ce qui existe déjà : les règles d’écran, de formulaire et de liste que tout agent devra suivre, et des modèles de pages. Elle reste « proposée » jusqu’à ce que vous la validiez dans la configuration du projet.`;
}

/**
 * LA DEMANDE ENTIÈRE DE LA CARTE QUI RÉDIGE UNE CHARTE. Elle travaille DANS le
 * dépôt du projet (sa carte, sa branche) : depuis Beluga on ne touche jamais au
 * dépôt d'un autre projet.
 */
export function consigneDeRedactionDeCharte(projet: { nom: string }): string {
  return [
    `RÉDIGE LA CHARTE D’INTERFACE DE « ${projet.nom} », puis ses modèles de pages.`,
    '',
    'POURQUOI : les agents qui codent ne lisent presque jamais la mémoire. Une charte COURTE, versionnée dans le dépôt, leur est servie d’office dès que leur travail touche son domaine, et ses interdits sont contrôlés à la fin de leur tour. Elle doit donc dire ce qui fait l’unité de CE projet, pas des généralités.',
    '',
    'MARCHE À SUIVRE :',
    '1. Lis le dépôt : composants réutilisables (boutons, champs, listes, fenêtres, menus), pages existantes, thème (couleurs, typographie, espacements), et la mémoire du projet (outil « memoire », « chercher » : interface, design, composant, écran). Regarde les écrans RÉELS en images (serveur de développement sur un port à toi, captures ordinateur et téléphone, clair et sombre si le thème existe).',
    '2. Décide des DOMAINES : une charte par partie de l’interface qui a ses propres règles (application, espace client, site vitrine, courriels, documents…). Un petit projet n’en a qu’une. Un projet sans interface : une seule charte « documents » ou aucune — dis-le dans ton compte rendu.',
    `3. Écris chaque charte dans \`${DOSSIER_DES_CHARTES}/<domaine>.md\`, au format ci-dessous, avec \`etat: proposee\`. Une vingtaine de règles numérotées au plus, sous ${PLAFOND_D_UNE_CHARTE} signes : structure des pages, formulaires (libellés, champs maison), listes, menus et fenêtres, téléphone, couleurs et typographie, textes. Chaque règle nomme le COMPOSANT à utiliser (chemin et nom), jamais une intention vague. Ce que le code fait déjà de façon cohérente devient la règle ; une incohérence se signale, elle ne s’invente pas.`,
    '4. Déclare les INTERDITS contrôlables (éléments natifs remplacés par un composant maison, fenêtres natives du navigateur…) — SEULEMENT si le code actuel les respecte déjà, ou corrige les écarts dans la même carte : un interdit violé partout bloquerait tous les agents.',
    '5. Écris les MODÈLES DE PAGES dans le dépôt (par exemple `src/components/modeles/`), construits UNIQUEMENT avec les composants existants, chacun avec en tête ce qui NE VARIE PAS et ce qui PEUT VARIER ; nomme leur dossier dans l’entête (`modeles:`).',
    '6. Enregistre et sauvegarde ta branche. Ton compte rendu montre la charte en quelques lignes et les captures sur lesquelles elle s’appuie ; l’utilisateur la validera depuis la configuration du projet.',
    '',
    'FORMAT D’UN FICHIER DE CHARTE :',
    '```',
    '---',
    'titre: Application <projet>',
    'domaine: <ce que la charte couvre, en une phrase>',
    'etat: proposee',
    'chemins: src/**, <autres motifs de fichiers séparés par des virgules>',
    'mots: écran, page, formulaire, <mots de demande qui la déclenchent>',
    'modeles: src/components/modeles',
    'interdit: <select> | Liste native : passe par <Composant> (<chemin>) | <chemin du composant exempté>',
    'interdit: <input type=checkbox|radio|date|range|color> | Élément natif : <Composants> | <chemin exempté>',
    '---',
    '1. Première règle…',
    '```',
    'Un motif d’interdit est une balise (`<select>`, `<input type=a|b>`) ou une expression régulière entre barres obliques (`/\\bwindow\\.confirm\\(/`).',
  ].join('\n');
}
