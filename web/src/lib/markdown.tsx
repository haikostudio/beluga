import * as React from 'react';
import {
  Lightbulb,
  Info,
  AlertTriangle,
  ChevronRight,
  OctagonAlert,
  Plus,
  Check,
  ClipboardList,
  Search,
  CheckCircle2,
  Repeat,
  Target,
  Sprout,
  Coins,
  Scale,
  FileText,
  Hash,
  type LucideIcon,
} from 'lucide-react';
import { MOTIF_MARKDOWN_EN_LIGNE, paragraphBreakAfter, titreSansEmoji } from '@beluga/shared';
import { cn } from './utils';
import { t } from '@/lib/langue';

/**
 * Rendu Markdown maison : titres numérotés (l'application ajoute les icônes),
 * encadrés colorés, et surtout les « Évolutions possibles » CLIQUABLES (§15).
 *
 * Les paragraphes du moteur sont RESPECTÉS : deux lignes ne sont recollées que
 * si la première s'arrête en plein milieu d'une phrase (voir
 * `paragraphBreakAfter` dans le paquet partagé). Sans ça, une réponse écrite
 * ligne par ligne se retrouvait fondue en un seul pavé.
 */

/**
 * Chaque section est classée par sa NATURE — comprendre, agir, en tirer les
 * conséquences, ou conclure — et rendue dans un cadre de la couleur d'état
 * correspondante (§17 : seules les couleurs d'état existent dans la palette,
 * jamais une teinte décorative). L'icône reste, mais ne suffit plus seule :
 * le cadre se voit avant même de lire le titre.
 */
type Tone = 'info' | 'success' | 'warning' | 'neutral';

/*
 * DES ICÔNES AU TRAIT FIN, JAMAIS D'EMOJI. Les emojis en couleur du sommaire et
 * des titres de parties juraient avec le reste de l'application : chaque
 * nature garde son image, mais dessinée par la même famille d'icônes.
 */
const SECTION_ICONS: { test: RegExp; icon: LucideIcon; tone: Tone }[] = [
  /* LE PREMIER BLOC D'UN PLAN : la liste des tâches à réaliser. Il passe AVANT
     « chemin à suivre » pour garder son icône à lui. */
  { test: /liste des tâches|liste de tâches|tâches à réaliser/i, icon: ClipboardList, tone: 'neutral' },
  { test: /décisions des itérations|décisions/i, icon: Scale, tone: 'neutral' },
  { test: /analyse|faisabilité/i, icon: Search, tone: 'info' },
  { test: /ce qui est fait|actions faites|tâches publiées|ce qui a été publié|chemin à suivre/i, icon: CheckCircle2, tone: 'success' },
  { test: /conséquences|ce qui change|approche retenue|déroulé|ce qui est en ligne/i, icon: Repeat, tone: 'warning' },
  { test: /impact|vérification|résultat|améliorations apportées/i, icon: Target, tone: 'warning' },
  { test: /évolutions possibles|suites éventuelles|état final/i, icon: Sprout, tone: 'neutral' },
  { test: /coûts|activation|facturation|temps et coût|estimation développeur/i, icon: Coins, tone: 'neutral' },
];

const TONE_CLASSES: Record<Tone, string> = {
  info: 'border-info/30 bg-info/5',
  success: 'border-success/30 bg-success/5',
  warning: 'border-warning/30 bg-warning/5',
  neutral: 'border-border bg-surface/60',
};

/**
 * Toute ligne a son icône, pour que le texte du sommaire reste aligné : un
 * titre de premier niveau (le titre du plan) prend un document, tout autre
 * titre non reconnu un repère neutre.
 */
function styleFor(title: string, level = 2): { icon: LucideIcon; tone: Tone } {
  const entry = SECTION_ICONS.find((e) => e.test.test(title));
  return { icon: entry?.icon ?? (level === 1 ? FileText : Hash), tone: entry?.tone ?? 'neutral' };
}

const CALLOUTS: Record<string, { icon: React.ReactNode; className: string; label: string }> = {
  TIP: { icon: <Lightbulb className="h-3.5 w-3.5" />, className: 'border-success/30 bg-success/5 text-success', label: 'Conseil' },
  NOTE: { icon: <Info className="h-3.5 w-3.5" />, className: 'border-border bg-raised text-muted', label: 'Note' },
  IMPORTANT: { icon: <Info className="h-3.5 w-3.5" />, className: 'border-border bg-raised text-text', label: 'Important' },
  WARNING: { icon: <AlertTriangle className="h-3.5 w-3.5" />, className: 'border-warning/30 bg-warning/5 text-warning', label: 'Attention' },
  CAUTION: { icon: <OctagonAlert className="h-3.5 w-3.5" />, className: 'border-danger/30 bg-danger/5 text-danger', label: 'Risque' },
};

function inline(text: string, key: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  // L'italique par soulignés ne s'ouvre qu'en bordure de mot : `userspsy_language_tmp` reste intact.
  const pattern = new RegExp(MOTIF_MARKDOWN_EN_LIGNE.source, MOTIF_MARKDOWN_EN_LIGNE.flags);
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const id = `${key}-${index++}`;
    if (token.startsWith('**')) nodes.push(<strong key={id}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith('`')) nodes.push(<code key={id}>{token.slice(1, -1)}</code>);
    else if (token.startsWith('_')) nodes.push(<em key={id}>{token.slice(1, -1)}</em>);
    else {
      const linkMatch = token.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        nodes.push(
          <a key={id} href={linkMatch[2]} target="_blank" rel="noreferrer">
            {linkMatch[1]}
          </a>,
        );
      }
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export interface MarkdownProps {
  content: string;
  /** Suggestions retenues (pastilles actives dans le composeur). */
  pickedEvolutions?: string[];
  onToggleEvolution?: (text: string) => void;
  onToggleAll?: (items: string[]) => void;
  /**
   * UNE SECONDE SECTION CLIQUABLE, en plus des « Évolutions possibles ». Le
   * cadre d'un plan s'en sert pour ses « Améliorations apportées », devenues
   * une liste d'idées à retenir d'un clic (`estTitreDesSuggestions`,
   * `shared/src/suggestions-de-plan.ts`). Absent = seules les évolutions le
   * sont, comme dans une réponse d'agent ordinaire.
   */
  autreTitreCliquable?: (titre: string) => boolean;
  /**
   * TOUTES LES LISTES DE CE TEXTE SE COCHENT, sans avoir de titre au-dessus.
   * Sert à un texte dont le titre « Améliorations apportées » est dessiné par
   * l'appelant : sans ce drapeau, la liste d'idées perdrait ses cases à cocher
   * pour la seule raison qu'elle n'a plus de titre au-dessus d'elle. Un plan,
   * lui, se rend d'un bloc (`PlanRapport`) et garde son titre.
   */
  listesCliquables?: boolean;
  /** Réponse encore en train d'arriver : pas de sommaire tant qu'elle bouge. */
  streaming?: boolean;
  className?: string;
}

export function Markdown({
  content,
  pickedEvolutions,
  onToggleEvolution,
  onToggleAll,
  autreTitreCliquable,
  listesCliquables,
  streaming,
  className,
}: MarkdownProps) {
  const blocks = React.useMemo(() => parse(content), [content]);
  const picked = new Set(pickedEvolutions ?? []);

  /** Les listes de CETTE section se cochent-elles ? */
  const sectionCliquable = (titre: string) =>
    /évolutions possibles/i.test(titre) || !!autreTitreCliquable?.(titre);

  const titres = React.useMemo(() => (streaming ? [] : sommaire(blocks, content)), [blocks, content, streaming]);
  const ancres = React.useRef(new Map<number, HTMLHeadingElement>());
  const [cible, setCible] = React.useState<number | null>(null);

  /** Un clic sur le sommaire amène la partie en haut, et la fait ressortir un instant. */
  const allerA = (index: number) => {
    const titre = ancres.current.get(index);
    if (!titre) return;
    titre.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setCible(index);
    window.setTimeout(() => setCible((actuelle) => (actuelle === index ? null : actuelle)), 1600);
  };

  /** Un bloc qui n'est pas un titre : liste, encadré, code, tableau ou simple paragraphe. */
  const renderBlock = (block: Block, index: number, dansEvolutions: boolean): React.ReactNode => {
    switch (block.kind) {
      case 'list':
        return (
          <ul key={index}>
            {block.items.map((item, itemIndex) => {
              const isEvolution = dansEvolutions && !!onToggleEvolution;
              const active = picked.has(item);
              if (!isEvolution) {
                // Le <li> est une boîte flex (tiret + contenu). Sans ce span,
                // chaque fragment de texte et chaque `code` devient une
                // colonne à part, écrasée à une lettre de large.
                return (
                  <li key={itemIndex}>
                    <span className="min-w-0 flex-1">{inline(item, `${index}-${itemIndex}`)}</span>
                  </li>
                );
              }
              return (
                // Pas de tiret devant une suggestion : la carte à cocher
                // se suffit à elle-même.
                <li key={itemIndex} className="!block before:content-none">
                  <button
                    type="button"
                    data-suggestion-cliquable
                    aria-pressed={active}
                    onClick={() => onToggleEvolution?.(item)}
                    className={cn(
                      'group flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left transition-colors',
                      active
                        ? 'border-accent/40 bg-raised text-text'
                        : 'border-border/60 bg-transparent text-muted hover:border-border hover:bg-raised',
                    )}
                  >
                    <span className="mt-[3px] shrink-0">
                      {active ? <Check className="h-3 w-3 text-success" /> : <Plus className="h-3 w-3 text-faint" />}
                    </span>
                    <span className="text-[14px] leading-snug">{item}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        );

      case 'callout': {
        const config = CALLOUTS[block.variant] ?? CALLOUTS.NOTE;
        return (
          <div key={index} className={cn('my-3 flex gap-2 rounded-md border px-2.5 py-2', config.className)}>
            <span className="mt-0.5 shrink-0">{config.icon}</span>
            <div className="text-[14px] leading-relaxed">
              {block.lines.map((line, lineIndex) => (
                <p key={lineIndex} className="!my-0 !text-inherit">
                  {inline(line, `${index}-${lineIndex}`)}
                </p>
              ))}
            </div>
          </div>
        );
      }

      case 'code':
        return (
          <pre key={index}>
            <code>{block.text}</code>
          </pre>
        );

      case 'table':
        return (
          <table key={index}>
            <thead>
              <tr>
                {block.head.map((cell, cellIndex) => (
                  <th key={cellIndex}>{inline(cell, `${index}-h-${cellIndex}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{inline(cell, `${index}-${rowIndex}-${cellIndex}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        );

      default:
        return <p key={index}>{inline(block.text, String(index))}</p>;
    }
  };

  return (
    <div className={cn('prose-hd', className)}>
      {/* Une entrée = une LIGNE pleine largeur : un sommaire se lit de haut en
          bas, pas comme une grappe de pastilles de tailles inégales. */}
      {titres.length ? (
        <nav className="mb-4 overflow-hidden rounded-md border border-border bg-raised/60">
          <p className="border-b border-border/70 px-3 py-1.5 text-[12px] uppercase tracking-wide text-faint">
            {t('Sommaire')}</p>
          {titres.map((titre) => (
            <button
              key={titre.index}
              type="button"
              onClick={() => allerA(titre.index)}
              className="flex w-full items-center gap-2 border-b border-border/40 px-3 py-2 text-left text-[14px] text-muted transition-colors last:border-b-0 hover:bg-surface hover:text-text"
            >
              <titre.icon className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{titreSansEmoji(titre.text)}</span>
              <ChevronRight className="h-3 w-3 shrink-0 text-faint" />
            </button>
          ))}
        </nav>
      ) : null}

      {sections(blocks).map((section) => {
        const body = section.body.map(({ block, index }) =>
          renderBlock(
            block,
            index,
            !!listesCliquables || (section.heading ? sectionCliquable(section.heading.text) : false),
          ),
        );

        if (!section.heading) {
          // Le texte avant le premier titre (ou une réponse sans titre du
          // tout) reste nu : le cadre de couleur ne sert qu'aux sections
          // nommées, il n'a pas de nature à annoncer sans titre.
          return <React.Fragment key={`préambule-${section.index}`}>{body}</React.Fragment>;
        }

        const headingIndex = section.index;
        const headingText = section.heading.text;
        const { icon: IconeDuTitre, tone } = styleFor(headingText, section.heading.level);
        const inEvolutions = sectionCliquable(headingText);
        const items = inEvolutions ? nextListItems(blocks, headingIndex) : [];
        const allPicked = items.length > 0 && items.every((item) => picked.has(item));

        return (
          <section
            key={headingIndex}
            className={cn('my-3 rounded-md border px-3 py-2.5', TONE_CLASSES[tone])}
          >
            <h2
              ref={(node) => {
                if (node) ancres.current.set(headingIndex, node);
                else ancres.current.delete(headingIndex);
              }}
              /* Le cadre de couleur remplace déjà la ligne de séparation et
                 l'espace du haut que porte `.prose-hd h2` : sans ce retrait, la
                 section colorée traînerait un second trait et un grand vide. */
              className={cn('!mt-0 !mb-3 !border-t-0 !pt-0', cible === headingIndex && 'text-accent')}
            >
              <IconeDuTitre className="h-4 w-4 shrink-0 text-faint" aria-hidden />
              <span>{titreSansEmoji(headingText)}</span>
              {inEvolutions && items.length > 1 && onToggleAll ? (
                <button
                  type="button"
                  onClick={() => onToggleAll(items)}
                  className="ml-auto rounded border border-border px-1.5 py-0.5 text-[12px] font-normal text-muted hover:bg-raised hover:text-text"
                >
                  {allPicked ? t('Tout retirer') : t('Tout ajouter')}
                </button>
              ) : null}
            </h2>
            {body}
          </section>
        );
      })}
    </div>
  );
}

/** Une section = un titre (ou aucun, pour le texte qui précède le premier) et ses blocs, jusqu'au titre suivant. */
interface Section {
  index: number;
  heading: Extract<Block, { kind: 'heading' }> | null;
  body: { block: Block; index: number }[];
}

function sections(blocks: Block[]): Section[] {
  const result: Section[] = [];
  let current: Section = { index: -1, heading: null, body: [] };
  blocks.forEach((block, index) => {
    if (block.kind === 'heading') {
      if (current.heading || current.body.length) result.push(current);
      current = { index, heading: block, body: [] };
    } else {
      current.body.push({ block, index });
    }
  });
  if (current.heading || current.body.length) result.push(current);
  return result;
}

/* ------------------------------------------------------------------ */

type Block =
  | { kind: 'heading'; text: string; level: number }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'code'; text: string }
  | { kind: 'callout'; variant: string; lines: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] };

/*
 * Le sommaire ne sert que sur une réponse qu'on ne voit pas d'un seul écran :
 * en dessous de ces seuils, il ferait double emploi avec les titres eux-mêmes.
 */
const SOMMAIRE_TITRES_MIN = 4;
const SOMMAIRE_SIGNES_MIN = 1200;

interface EntreeSommaire {
  index: number;
  text: string;
  icon: LucideIcon;
}

function sommaire(blocks: Block[], content: string): EntreeSommaire[] {
  if (content.length < SOMMAIRE_SIGNES_MIN) return [];
  const titres = blocks.flatMap((block, index) =>
    block.kind === 'heading' ? [{ index, text: block.text, icon: styleFor(block.text, block.level).icon }] : [],
  );
  return titres.length >= SOMMAIRE_TITRES_MIN ? titres : [];
}

function nextListItems(blocks: Block[], fromIndex: number): string[] {
  for (let i = fromIndex + 1; i < blocks.length; i++) {
    if (blocks[i].kind === 'list') return (blocks[i] as { items: string[] }).items;
    if (blocks[i].kind === 'heading') break;
  }
  return [];
}

function parse(content: string): Block[] {
  const lines = content.replace(/\r/g, '').split('\n');
  const blocks: Block[] = [];
  let buffer: string[] = [];

  const flushParagraph = () => {
    if (buffer.length) {
      blocks.push({ kind: 'paragraph', text: buffer.join(' ').trim() });
      buffer = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    if (trimmed.startsWith('```')) {
      flushParagraph();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i]), i++;
      blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }

    const calloutMatch = trimmed.match(/^>\s*\[!(TIP|NOTE|IMPORTANT|WARNING|CAUTION)\]/i);
    if (calloutMatch) {
      flushParagraph();
      const variant = calloutMatch[1].toUpperCase();
      const body: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        body.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      i--;
      blocks.push({ kind: 'callout', variant, lines: body.filter(Boolean) });
      continue;
    }

    const heading = trimmed.match(/^#{1,4}\s+(.*)$/);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: 'heading', level: trimmed.match(/^#+/)![0].length, text: heading[1].replace(/^\d+\.\s*/, '').trim() });
      continue;
    }

    if (/^\|.*\|$/.test(trimmed) && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
      flushParagraph();
      const cells = (row: string) =>
        row
          .trim()
          .slice(1, -1)
          .split('|')
          .map((cell) => cell.trim());
      const head = cells(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
        rows.push(cells(lines[i].trim()));
        i++;
      }
      i--;
      blocks.push({ kind: 'table', head, rows });
      continue;
    }

    if (/^[-*•]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      flushParagraph();
      const items: string[] = [];
      while (
        i < lines.length &&
        (/^[-*•]\s+/.test(lines[i].trim()) || /^\d+\.\s+/.test(lines[i].trim()) || /^\s{2,}\S/.test(lines[i]))
      ) {
        const current = lines[i].trim();
        if (/^[-*•]\s+/.test(current) || /^\d+\.\s+/.test(current)) {
          items.push(current.replace(/^[-*•]\s+/, '').replace(/^\d+\.\s+/, ''));
        } else if (items.length) {
          items[items.length - 1] += ` ${current}`;
        }
        i++;
      }
      i--;
      blocks.push({ kind: 'list', items });
      continue;
    }

    // Retour à la ligne du moteur = nouveau paragraphe, sauf phrase coupée.
    if (buffer.length && paragraphBreakAfter(buffer[buffer.length - 1], trimmed)) {
      flushParagraph();
    }
    buffer.push(trimmed);
  }

  flushParagraph();
  return blocks;
}
