import * as React from 'react';
import { Lightbulb, Info, AlertTriangle, OctagonAlert, Plus, Check } from 'lucide-react';
import { paragraphBreakAfter } from '@haikodev/shared';
import { cn } from './utils';

/**
 * Rendu Markdown maison : titres numérotés (l'application ajoute les icônes),
 * encadrés colorés, et surtout les « Évolutions possibles » CLIQUABLES (§15).
 *
 * Les paragraphes du moteur sont RESPECTÉS : deux lignes ne sont recollées que
 * si la première s'arrête en plein milieu d'une phrase (voir
 * `paragraphBreakAfter` dans le paquet partagé). Sans ça, une réponse écrite
 * ligne par ligne se retrouvait fondue en un seul pavé.
 */

const SECTION_ICONS: { test: RegExp; icon: string }[] = [
  { test: /analyse/i, icon: '🔍' },
  { test: /ce qui est fait|actions faites|tâches publiées|ce qui a été publié/i, icon: '✅' },
  { test: /conséquences|ce qui change|approche retenue|déroulé|ce qui est en ligne/i, icon: '🔁' },
  { test: /impact|vérification|résultat/i, icon: '🎯' },
  { test: /évolutions possibles|suites éventuelles|état final/i, icon: '🌱' },
  { test: /coûts|activation|facturation|temps et coût|estimation développeur/i, icon: '💳' },
];

function iconFor(title: string): string | null {
  return SECTION_ICONS.find((entry) => entry.test.test(title))?.icon ?? null;
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
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|_[^_]+_)/g;
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
  /** Réponse encore en train d'arriver : pas de sommaire tant qu'elle bouge. */
  streaming?: boolean;
  className?: string;
}

export function Markdown({
  content,
  pickedEvolutions,
  onToggleEvolution,
  onToggleAll,
  streaming,
  className,
}: MarkdownProps) {
  const blocks = React.useMemo(() => parse(content), [content]);
  const picked = new Set(pickedEvolutions ?? []);
  let inEvolutions = false;

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

  return (
    <div className={cn('prose-hd', className)}>
      {titres.length ? (
        <nav className="mb-4 rounded-md border border-border bg-raised/60 px-2.5 py-2">
          <p className="mb-1.5 text-[12px] text-faint">Sommaire</p>
          <div className="flex flex-wrap gap-1.5">
            {titres.map((titre) => (
              <button
                key={titre.index}
                type="button"
                onClick={() => allerA(titre.index)}
                className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-[13px] text-muted transition-colors hover:border-accent/50 hover:text-text"
              >
                {titre.icon ? <span aria-hidden>{titre.icon}</span> : null}
                {titre.text}
              </button>
            ))}
          </div>
        </nav>
      ) : null}

      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'heading': {
            inEvolutions = /évolutions possibles/i.test(block.text);
            const icon = iconFor(block.text);
            const items = inEvolutions ? nextListItems(blocks, index) : [];
            const allPicked = items.length > 0 && items.every((item) => picked.has(item));
            return (
              <h2
                key={index}
                ref={(node) => {
                  if (node) ancres.current.set(index, node);
                  else ancres.current.delete(index);
                }}
                className={cn(cible === index && 'text-accent')}
              >
                {icon ? <span aria-hidden>{icon}</span> : null}
                <span>{block.text}</span>
                {inEvolutions && items.length > 1 && onToggleAll ? (
                  <button
                    type="button"
                    onClick={() => onToggleAll(items)}
                    className="ml-auto rounded border border-border px-1.5 py-0.5 text-[12px] font-normal text-muted hover:bg-raised hover:text-text"
                  >
                    {allPicked ? 'Tout retirer' : 'Tout ajouter'}
                  </button>
                ) : null}
              </h2>
            );
          }

          case 'list':
            return (
              <ul key={index}>
                {block.items.map((item, itemIndex) => {
                  const isEvolution = inEvolutions && !!onToggleEvolution;
                  const active = picked.has(item);
                  if (!isEvolution) {
                    return <li key={itemIndex}>{inline(item, `${index}-${itemIndex}`)}</li>;
                  }
                  return (
                    // Pas de tiret devant une suggestion : la carte à cocher
                    // se suffit à elle-même.
                    <li key={itemIndex} className="!block before:content-none">
                      <button
                        type="button"
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
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */

type Block =
  | { kind: 'heading'; text: string }
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
  icon: string | null;
}

function sommaire(blocks: Block[], content: string): EntreeSommaire[] {
  if (content.length < SOMMAIRE_SIGNES_MIN) return [];
  const titres = blocks.flatMap((block, index) =>
    block.kind === 'heading' ? [{ index, text: block.text, icon: iconFor(block.text) }] : [],
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
      blocks.push({ kind: 'heading', text: heading[1].replace(/^\d+\.\s*/, '').trim() });
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
