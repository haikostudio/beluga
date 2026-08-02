import * as React from 'react';
import { BookOpen, Loader2 } from 'lucide-react';
import { Drawer, DialogTitle } from '@/components/ui';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';

/**
 * La mémoire du projet, lisible à tout moment depuis le menu du haut. C'est le
 * MÊME texte que les agents relisent avant d'agir : une ligne par fait durable.
 * Le texte n'est demandé au serveur qu'à l'ouverture, et il est rafraîchi à
 * chaque fois — la mémoire bouge à mesure que les agents travaillent.
 */
export function MemoryView({
  open,
  projectId,
  onClose,
}: {
  open: boolean;
  projectId?: string;
  onClose: () => void;
}) {
  const state = useApp();
  const texte = projectId ? state.memory[projectId] : undefined;
  const projet = state.projects.find((p) => p.id === projectId);

  React.useEffect(() => {
    if (open && projectId) client.send({ type: 'memory.get', projectId });
  }, [open, projectId]);

  // Une ligne par fait : les puces sont détachées, les titres mis en avant.
  const lignes = (texte ?? '')
    .split('\n')
    .map((ligne) => ligne.trim())
    .filter(Boolean);
  const faits = lignes.filter((ligne) => ligne.startsWith('- ')).map((ligne) => ligne.slice(2));

  return (
    <Drawer open={open} onClose={onClose}>
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 pb-2">
        <BookOpen className="h-3.5 w-3.5 shrink-0 text-accent" />
        <DialogTitle className="min-w-0 flex-1 truncate">
          Mémoire {projet ? `de ${projet.name}` : 'du projet'}
        </DialogTitle>
        <span className="shrink-0 text-[12.5px] text-faint">
          {faits.length} fait{faits.length > 1 ? 's' : ''}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3">
        {texte === undefined ? (
          <p className="flex items-center gap-2 text-[14px] text-faint">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Lecture…
          </p>
        ) : faits.length ? (
          <ul className="space-y-1.5">
            {faits.map((fait, index) => (
              <li
                key={index}
                className="rounded-md border border-border bg-surface/60 px-2.5 py-2 text-[13.5px] leading-relaxed text-muted"
              >
                {fait}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px] text-faint">
            Ce projet n'a encore aucun fait en mémoire. Les agents en ajoutent au fil de leur travail.
          </p>
        )}
      </div>
    </Drawer>
  );
}
