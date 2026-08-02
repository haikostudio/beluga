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

export const TEMPLATES: Record<TemplateKind, ResponseTemplate> = {
  pre_run: {
    kind: 'pre_run',
    sections: [
      'Analyse de la demande',
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
    sections: ['Ce qui est fait', 'Ce qui change', 'Impact', 'Évolutions possibles'],
    exclusions: [
      "Interdit d'annoncer une mise en ligne : la publication est un geste séparé de l'utilisateur.",
      'Interdit de terminer par une ligne de facture.',
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
    sections: [
      'Ce qui est fait',
      'Ce qui change',
      'Impact',
      'Évolutions possibles',
      'Activation & facturation',
    ],
    exclusions: [],
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

const COMMON_RULES = [
  'Écris en français simple, pour un lecteur qui n\'est pas informaticien.',
  'Titres numérotés en Markdown : `## 1. Titre`, `## 2. Titre`… sans icône (l\'application les ajoute).',
  'Commence par UNE ligne d\'en-tête : modèle utilisé, niveau, temps estimé, coût approximatif à 130 CHF/heure.',
  'Sois bref : 1 à 3 phrases par section, ou 3 à 5 puces courtes.',
  'Pas de chemins de fichiers ni de jargon sauf demande explicite.',
  'Encadrés `> [!TIP]`, `> [!NOTE]`, `> [!WARNING]` uniquement quand ils aident vraiment.',
];

/** L'enveloppe réellement ajoutée à l'instruction envoyée au moteur. */
export function wrapPrompt(kind: TemplateKind, userText: string, context?: string): string {
  if (kind === 'none') {
    return context ? `${context}\n\n---\n\n${userText}` : userText;
  }
  const tpl = TEMPLATES[kind];
  const sections = tpl.sections.map((s, i) => `## ${i + 1}. ${s}`).join('\n');
  const rules = COMMON_RULES.map((r) => `- ${r}`).join('\n');
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

  return `${context ? context + '\n\n---\n\n' : ''}DEMANDE :
${userText}

---
FORME DE TA RÉPONSE FINALE (imposée, non négociable) — utilise exactement ces titres, dans cet ordre :
${sections}

RÈGLES :
${rules}
${exclusions}${extra}${evolutions}`;
}

/** Contrôle de forme : un moteur qui ignore la consigne se fait rattraper. */
export function checkTemplate(kind: TemplateKind, text: string): { ok: boolean; missing: string[] } {
  if (kind === 'none') return { ok: true, missing: [] };
  const tpl = TEMPLATES[kind];
  const missing = tpl.sections.filter((s) => {
    const needle = s.toLowerCase().replace(/\s+/g, ' ');
    return !text.toLowerCase().replace(/\s+/g, ' ').includes(needle);
  });
  return { ok: missing.length === 0, missing };
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
