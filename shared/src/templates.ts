import { ColumnKey } from './columns.js';

/**
 * Les gabarits de réponse (PLAN §9). Le démon enveloppe chaque instruction
 * avant de la transmettre : la forme est IMPOSÉE, pas choisie par le moteur.
 * Un seul point de passage — c'est ici.
 */

export type TemplateKind =
  | 'pre_run'
  | 'in_run'
  | 'deploy'
  | 'deploy_batch'
  | 'free'
  | 'none';

export interface ResponseTemplate {
  kind: TemplateKind;
  sections: string[];
  /** Écrit noir sur blanc, pas seulement sous-entendu. */
  exclusions: string[];
}

/**
 * La LONGUEUR DE RÉFÉRENCE d'une réponse. Un gabarit unique à six sections
 * obligeait à servir six blocs même pour une retouche d'une ligne : le moteur
 * délayait, et chaque mot délayé est du quota dépensé. La forme reste imposée,
 * c'est le REMPLISSAGE qui devient proportionnel au travail réel.
 */
export type Ampleur = 'breve' | 'standard' | 'complete';

/** Les trois longueurs, décrites pour le moteur ET pour le contrôle de forme. */
export const AMPLEURS: Record<Ampleur, { mots: number; sections: string[]; libelle: string }> = {
  breve: { mots: 120, sections: [], libelle: 'brève' },
  standard: { mots: 250, sections: ['Ce qui est fait', 'Conséquences', 'Coûts'], libelle: 'moyenne' },
  complete: { mots: 900, sections: [], libelle: 'complète' },
};

/**
 * Le compte rendu de travail, en six blocs nettement séparés (la forme retenue
 * dans Paseo). Les quatre sections d'avant tenaient dans un seul pavé : on ne
 * distinguait plus l'analyse du résultat, ni les conséquences du coût.
 */
const REPORT_SECTIONS = [
  'Analyse',
  'Ce qui est fait',
  'Conséquences',
  'Impact',
  'Évolutions possibles',
  'Coûts',
];

export const TEMPLATES: Record<TemplateKind, ResponseTemplate> = {
  pre_run: {
    kind: 'pre_run',
    sections: [
      'Analyse de la demande',
      // Une analyse qui n'a rien regardé ne vaut rien : elle DIT ce qu'elle a
      // trouvé dans le projet, c'est ce qui rend son chiffrage crédible.
      'Ce que j’ai trouvé dans le projet',
      'Approche retenue',
      'Impact attendu et points de vigilance',
      'Temps et coût pour la machine',
      'Estimation développeur senior',
    ],
    exclusions: [
      "Interdit d'écrire « Ce qui est fait » : rien n'a encore été exécuté, ce serait un mensonge.",
      'Interdit de parler au passé de modifications de code.',
    ],
  },
  in_run: {
    kind: 'in_run',
    sections: REPORT_SECTIONS,
    exclusions: [
      "Interdit d'annoncer une mise en ligne : la publication est un geste séparé de l'utilisateur.",
      "Interdit de créer ou de modifier une facture : la section « Coûts » informe, elle ne facture rien.",
    ],
  },
  deploy: {
    kind: 'deploy',
    sections: ['Ce qui a été publié', 'Déroulé', 'Vérification', 'Suites éventuelles'],
    exclusions: ["Interdit de terminer par une ligne de facture : un journal de publication ne facture rien."],
  },
  deploy_batch: {
    kind: 'deploy_batch',
    sections: ['Tâches publiées', 'Ce qui est en ligne', 'Résultat', 'État final'],
    exclusions: ["Interdit de terminer par une ligne de facture."],
  },
  free: {
    kind: 'free',
    sections: REPORT_SECTIONS,
    exclusions: [
      "Interdit de créer ou de modifier une facture sans accord explicite : la section « Coûts » informe.",
    ],
  },
  none: { kind: 'none', sections: [], exclusions: [] },
};

/** Le gabarit dépend de la colonne, parce qu'une réponse ne dit pas la même chose selon l'endroit. */
export function templateForColumn(column: ColumnKey | undefined, deployed = false): TemplateKind {
  if (deployed) return 'deploy';
  switch (column) {
    case 'validated':
    case 'planned':
      return 'pre_run';
    case 'running':
    case 'done':
    case 'to_deploy':
      return 'in_run';
    case 'notes':
    case 'todo':
    case 'archived':
    case undefined:
      return 'free';
    default:
      return 'free';
  }
}

/** Les gabarits dont la longueur s'adapte ; les autres ont une forme structurelle. */
const GABARITS_ADAPTABLES = new Set<TemplateKind>(['in_run', 'free']);

const DÉBUTS_DE_QUESTION =
  /^(quoi|qui|où|ou\b|quand|comment|pourquoi|combien|quel|quelle|est-ce|peux-tu|peux tu|explique|montre|liste|dis-moi|dis moi|c'est quoi|as-tu|y a-t-il)/i;

/**
 * La longueur de référence déduite de la DEMANDE, avant tout travail. Ce n'est
 * qu'un point de départ annoncé au moteur : lui seul sait, à la fin, si le
 * travail réel était une retouche ou une vraie tâche, et il ajuste.
 */
export function ampleurParDefaut(kind: TemplateKind, userText: string): Ampleur {
  if (!GABARITS_ADAPTABLES.has(kind)) return 'complete';
  const texte = userText.trim();
  if (texte.includes('?') || DÉBUTS_DE_QUESTION.test(texte)) return 'breve';
  if (texte.length < 80) return 'breve';
  if (texte.length > 400) return 'complete';
  return 'standard';
}

/** Les titres réellement demandés pour ce gabarit à cette longueur. */
export function sectionsPour(kind: TemplateKind, ampleur: Ampleur): string[] {
  const tpl = TEMPLATES[kind];
  if (!GABARITS_ADAPTABLES.has(kind) || ampleur === 'complete') return tpl.sections;
  return AMPLEURS[ampleur].sections;
}

/**
 * La partie le plus souvent ratée : les moteurs rendent un pavé continu où les
 * sections se confondent. Elle est donc écrite à part, avant les règles de fond,
 * avec un plafond qui garde la réponse dense SANS la tasser.
 */
const LAYOUT_RULES = [
  'Chaque section est un BLOC LISIBLE : son titre, puis un ou plusieurs paragraphes courts.',
  'Un paragraphe = 2 à 3 phrases. Deux paragraphes sont TOUJOURS séparés par une LIGNE VIDE.',
  'Laisse une ligne vide avant et après chaque titre, chaque liste et chaque encadré.',
  'Une puce = une idée, sur une seule ligne, sans sous-liste.',
  'Jamais de pavé continu, jamais de section réduite à une phrase collée au titre.',
  'Reste dense malgré tout : au plus 3 paragraphes courts OU 5 puces par section.',
];

const COMMON_RULES = [
  'Écris en français simple, pour un lecteur qui n\'est pas informaticien.',
  'Titres numérotés en Markdown : `## 1. Titre`, `## 2. Titre`… sans icône (l\'application les ajoute).',
  'Commence par UNE ligne d\'en-tête : modèle utilisé, niveau, temps estimé, coût approximatif à 130 CHF/heure.',
  'Pas de préambule, pas de conclusion générale, aucune redite d\'une section à l\'autre.',
  'Pas de chemins de fichiers ni de jargon sauf demande explicite.',
  'Encadrés `> [!TIP]`, `> [!NOTE]`, `> [!WARNING]` uniquement quand ils aident vraiment.',
];

/** Ce que chaque section du compte rendu doit contenir — sinon elles se répètent. */
const REPORT_GUIDE = [
  'Analyse : ce que tu as compris de la demande et l\'état trouvé avant de toucher à quoi que ce soit.',
  'Ce qui est fait : les actions réellement menées, au passé, une par idée.',
  'Conséquences : ce que ces actions entraînent concrètement dans le produit.',
  'Impact : ce que ça change pour la personne qui s\'en sert au quotidien.',
  'Coûts : temps machine, heures d\'un développeur senior, coût approximatif à 130 CHF/heure.',
];

export interface OptionsEnveloppe {
  /**
   * La session du moteur est DÉJÀ ouverte : il a reçu le gabarit entier au
   * premier tour et l'a toujours dans son contexte. Le recoller à chaque
   * message coûte environ cinq cents jetons pour rien : on n'envoie plus
   * qu'un rappel d'une ligne.
   */
  rappel?: boolean;
  /** La longueur de référence annoncée ; déduite de la demande si absente. */
  ampleur?: Ampleur;
}

/** Le rappel de forme des tours suivants : quelques mots au lieu du bloc entier. */
function rappelDeForme(kind: TemplateKind, ampleur: Ampleur): string {
  const titres = sectionsPour(kind, ampleur);
  const forme = titres.length
    ? `titres numérotés « ${titres.join(' », « ')} »`
    : 'quelques phrases, sans titres imposés';
  return `RAPPEL DE FORME (les règles complètes sont déjà dans ce fil) : ${forme}. Longueur de référence : ${AMPLEURS[ampleur].libelle}, ${AMPLEURS[ampleur].mots} mots au plus — ajuste-la au travail réellement fait, sans jamais cacher ce que tu as changé.`;
}

/** Les trois longueurs, écrites une seule fois par session. */
const RÈGLE_LONGUEUR = `LONGUEUR DE TA RÉPONSE — elle suit le travail RÉELLEMENT fait, pas le gabarit :
- Question, information, geste d'une seule ligne → quelques phrases, aucune section imposée, ${AMPLEURS.breve.mots} mots au plus.
- Correction ou ajustement contenu → trois titres seulement (${AMPLEURS.standard.sections.join(', ')}), ${AMPLEURS.standard.mots} mots au plus.
- Vraie tâche (plusieurs fichiers, décisions à expliquer) → tous les titres ci-dessus.
Une section qui n'a rien à dire ne s'écrit pas : mieux vaut trois lignes vraies que six sections délayées. Raccourcir ne veut jamais dire taire un changement, un échec ou une décision.`;

/** L'enveloppe réellement ajoutée à l'instruction envoyée au moteur. */
export function wrapPrompt(
  kind: TemplateKind,
  userText: string,
  context?: string,
  options: OptionsEnveloppe = {},
): string {
  if (kind === 'none') {
    return context ? `${context}\n\n---\n\n${userText}` : userText;
  }
  const tpl = TEMPLATES[kind];
  const ampleur = options.ampleur ?? ampleurParDefaut(kind, userText);

  if (options.rappel) {
    const tête = context ? `${context}\n\n---\n\n` : '';
    return `${tête}DEMANDE :\n${userText}\n\n---\n${rappelDeForme(kind, ampleur)}`;
  }

  // Une ligne vide ENTRE les titres : le gabarit montre lui-même l'aération
  // qu'il réclame, au lieu de la décrire seulement.
  const sections = tpl.sections.map((s, i) => `## ${i + 1}. ${s}`).join('\n\n');
  const layout = LAYOUT_RULES.map((r) => `- ${r}`).join('\n');
  const rules = COMMON_RULES.map((r) => `- ${r}`).join('\n');
  const guide = tpl.sections === REPORT_SECTIONS ? `\nCONTENU DE CHAQUE SECTION :\n${REPORT_GUIDE.map((g) => `- ${g}`).join('\n')}\n` : '';
  const exclusions = tpl.exclusions.length
    ? `\nINTERDICTIONS :\n${tpl.exclusions.map((e) => `- ${e}`).join('\n')}\n`
    : '';

  const extra =
    kind === 'pre_run'
      ? `\nLes deux dernières sections sont LUES PAR L'APPLICATION. Termine ta réponse par un bloc de code json (et rien après) :
\`\`\`json
{"machineSeconds": 600, "tokens": 40000, "quotaShare": 0.03, "confidence": "medium", "summary": "…", "seniorHours": 2.5, "billingTitle": "…", "billingDescription": "…"}
\`\`\`
machineSeconds = ta durée d'exécution prévue en secondes. seniorHours = le temps qu'un développeur senior mettrait à la main. Ne confonds JAMAIS les deux.\n`
      : '';

  const evolutions =
    tpl.sections.includes('Évolutions possibles')
      ? "\nDans « Évolutions possibles », écris chaque suggestion sur sa propre ligne, en puce `- `, formulée comme une demande actionnable (l'utilisateur peut cliquer dessus pour la réutiliser).\n"
      : '';

  // La règle de longueur ne concerne que les gabarits adaptables : un journal
  // de publication ou un chiffrage ont une forme structurelle, pas variable.
  const longueur = GABARITS_ADAPTABLES.has(kind)
    ? `\n${RÈGLE_LONGUEUR}\nPour CETTE demande, la référence est : ${AMPLEURS[ampleur].libelle}.\n`
    : '';

  return `${context ? context + '\n\n---\n\n' : ''}DEMANDE :
${userText}

---
FORME DE TA RÉPONSE FINALE (imposée, non négociable) — utilise exactement ces titres, dans cet ordre :

${sections}
${longueur}
MISE EN FORME (la partie le plus souvent ratée — relis-la avant d'envoyer) :
${layout}

RÈGLES :
${rules}
${guide}${exclusions}${extra}${evolutions}`;
}

/** Au-delà de ce nombre de signes d'affilée sans respiration, c'est un pavé. */
const DENSE_LIMIT = 420;

/**
 * Les sections rendues en un seul bloc compact. Le contrôle de forme vérifiait
 * la présence des titres mais pas leur lisibilité : un moteur pouvait poser les
 * six titres et tasser tout le texte dessous.
 */
export function denseSections(text: string): string[] {
  const out: string[] = [];
  let title = "En-tête";
  let buffer = '';
  let inCode = false;

  const flush = () => {
    if (buffer.length > DENSE_LIMIT && !out.includes(title)) out.push(title);
    buffer = '';
  };

  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (line.startsWith('```')) {
      inCode = !inCode;
      flush();
      continue;
    }
    if (inCode) continue;

    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (heading) {
      flush();
      title = heading[1].replace(/^\d+\.\s*/, '').trim();
      continue;
    }
    // Listes, tableaux et encadrés respirent déjà par eux-mêmes.
    if (!line || /^[-*•>|]/.test(line) || /^\d+\.\s/.test(line)) {
      flush();
      continue;
    }
    buffer += (buffer ? ' ' : '') + line;
  }
  flush();
  return out;
}

/** Marges de tolérance, un cran au-dessus des longueurs annoncées. */
const MOTS_BREF = 160;
const MOTS_STANDARD = 320;

const RANG: Record<Ampleur, number> = { breve: 0, standard: 1, complete: 2 };

export function compterMots(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * La longueur réellement servie, comparée à celle annoncée. On retient la plus
 * PETITE des deux : répondre plus court que la référence est le gain recherché,
 * jamais une faute. C'est le contrôle de densité, plus bas, qui empêche le pavé.
 */
export function ampleurEffective(annoncee: Ampleur, text: string): Ampleur {
  const mots = compterMots(text);
  const parLongueur: Ampleur = mots <= MOTS_BREF ? 'breve' : mots <= MOTS_STANDARD ? 'standard' : 'complete';
  return RANG[parLongueur] < RANG[annoncee] ? parLongueur : annoncee;
}

/** Contrôle de forme : un moteur qui ignore la consigne se fait rattraper. */
export function checkTemplate(
  kind: TemplateKind,
  text: string,
  ampleur: Ampleur = 'complete',
): { ok: boolean; missing: string[]; dense: string[] } {
  if (kind === 'none') return { ok: true, missing: [], dense: [] };
  // Une réponse courte n'a plus à servir six sections vides : les titres exigés
  // suivent la longueur réellement rendue.
  const attendues = GABARITS_ADAPTABLES.has(kind)
    ? sectionsPour(kind, ampleurEffective(ampleur, text))
    : TEMPLATES[kind].sections;
  const missing = attendues.filter((s) => {
    const needle = s.toLowerCase().replace(/\s+/g, ' ');
    return !text.toLowerCase().replace(/\s+/g, ' ').includes(needle);
  });
  const dense = denseSections(text);
  return { ok: missing.length === 0 && dense.length === 0, missing, dense };
}

const SENTENCE_END = /[.!?:;»"”)\]]$/;

/**
 * Faut-il ouvrir un nouveau paragraphe entre ces deux lignes ? Un moteur écrit
 * ses paragraphes à la ligne sans toujours laisser une ligne vide : les recoller
 * tous produisait justement le pavé. On ne recolle donc que ce qui continue
 * visiblement une phrase (ligne coupée en plein milieu).
 */
export function paragraphBreakAfter(line: string, next: string): boolean {
  const end = line.trim();
  const start = next.trim();
  if (!end || !start) return false;
  if (!SENTENCE_END.test(end)) return false;
  // Une minuscule au départ = la phrase se poursuit, malgré le point (abréviation…).
  return !/^[a-zà-öø-ÿ]/.test(start);
}

/** Les suggestions cliquables extraites de « Évolutions possibles » (PLAN §15). */
export function extractEvolutions(text: string): string[] {
  const lines = text.split('\n');
  const idx = lines.findIndex((l) => /^#{1,4}\s*\d*\.?\s*Évolutions possibles/i.test(l.trim()));
  if (idx < 0) return [];
  const out: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^#{1,4}\s/.test(line)) break;
    const m = line.match(/^[-*•]\s+(.*)$/);
    if (m && m[1].trim().length > 3) out.push(m[1].replace(/\*\*/g, '').trim());
  }
  return out.slice(0, 8);
}
