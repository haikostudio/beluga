import * as React from 'react';
import { Eye, Code2 } from 'lucide-react';
import { FormatApercu, estMarkdown, formatParDefaut } from '@haikodev/shared';
import { Markdown } from '@/lib/markdown';
import { cn } from '@/lib/utils';

/**
 * L'aperçu d'un fichier texte, avec la bascule VISUEL / MARKDOWN.
 *
 * Un document Markdown s'ouvre mis en page : ses dièses et ses étoiles sont des
 * instructions de mise en forme, pas du texte à lire. On peut revenir à la
 * source d'un clic — pour la copier, ou pour comprendre un affichage bizarre.
 *
 * Pour tout autre fichier, il n'y a rien à mettre en page : la bascule ne
 * s'affiche pas, et le texte reste brut. Un bouton qui ne change rien est pire
 * qu'un bouton absent.
 */

/** La bascule, à poser dans l'en-tête de l'aperçu. */
export function BasculeApercu({
  format,
  onChange,
  className,
}: {
  format: FormatApercu;
  onChange: (format: FormatApercu) => void;
  className?: string;
}) {
  const choix: { cle: FormatApercu; libelle: string; icone: React.ReactNode }[] = [
    { cle: 'visuel', libelle: 'Visuel', icone: <Eye className="h-3 w-3" /> },
    { cle: 'markdown', libelle: 'Markdown', icone: <Code2 className="h-3 w-3" /> },
  ];
  return (
    <div className={cn('inline-flex shrink-0 items-center gap-0.5 rounded-md bg-surface p-0.5', className)}>
      {choix.map((item) => (
        <button
          key={item.cle}
          type="button"
          onClick={() => onChange(item.cle)}
          aria-pressed={format === item.cle}
          className={cn(
            'inline-flex h-6 items-center gap-1 rounded px-2 text-[12.5px] font-medium transition-colors',
            format === item.cle ? 'bg-raised text-text' : 'text-muted hover:text-text',
          )}
        >
          {item.icone}
          {item.libelle}
        </button>
      ))}
    </div>
  );
}

/**
 * Le contenu lui-même. `nom` sert à reconnaître un Markdown ; `format` vient de
 * l'état tenu par l'écran qui affiche l'aperçu, pour que la bascule et le
 * contenu ne se contredisent jamais.
 */
export function ContenuTexte({
  contenu,
  format,
}: {
  contenu: string;
  format: FormatApercu;
}) {
  if (format === 'visuel') {
    return <Markdown content={contenu} className="px-1" />;
  }
  return <pre className="whitespace-pre-wrap text-[13px] leading-relaxed text-muted">{contenu}</pre>;
}

/**
 * L'état de la bascule pour un fichier donné. Il repart du format par défaut
 * dès que le fichier change : ouvrir une image puis un document ne doit pas
 * garder le choix fait sur le précédent.
 */
export function useFormatApercu(nom: string | null | undefined, type?: string) {
  const markdown = estMarkdown(nom ?? '', type);
  const [format, setFormat] = React.useState<FormatApercu>(() => formatParDefaut(nom ?? '', type));

  React.useEffect(() => {
    setFormat(formatParDefaut(nom ?? '', type));
  }, [nom, type]);

  return { markdown, format, setFormat };
}
