/**
 * UN BLOC DE LA FICHE : UN FOND, UN TITRE, ET RIEN D'AUTRE.
 *
 * Ni cadre, ni trait de séparation — ce qui détache le bloc de la fiche est son
 * FOND (`raised` contre le `surface` du tiroir), un jeton du thème, donc valable
 * dans les douze palettes, y compris les onze plates où `--border` est effacé.
 *
 * Il est REPLIÉ AU DÉPART et ne retient pas son état : une fiche s'ouvre sur ce
 * qu'on vient y lire — la demande et les messages —, pas sur ce qu'on a déplié
 * la dernière fois. Sa ligne de titre porte un INDICE (« 2/5 ») qui dit ce que
 * le bloc contient sans qu'on ait à l'ouvrir.
 *
 * Ce n'est pas `BlocRepliable` : celui-là écrit son titre en capitales grises et
 * ne pose aucun fond. Ici, le bloc EST le fond.
 *
 * IL VIT DANS SON PROPRE MODULE parce que DEUX tiroirs l'emploient : la fiche
 * d'une demande et le formulaire de dépôt, qui replient tous deux leurs
 * « Options » derrière la même ligne à chevron. Une seconde copie dans le
 * formulaire aurait dérivé au premier changement de fond ou de repère.
 */
import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export function BlocDeFiche({
  repere,
  titre,
  icone,
  indice,
  indiceAttribut,
  attributs,
  children,
}: {
  repere: string;
  titre: string;
  icone?: React.ReactNode;
  /** Ce que le bloc contient, lu SANS l'ouvrir. */
  indice?: string;
  indiceAttribut?: Record<string, string>;
  /** Les repères propres au bloc, pour les contrôles. */
  attributs?: Record<string, string | number>;
  children: React.ReactNode;
}) {
  const [ouvert, setOuvert] = React.useState(false);
  return (
    <section
      className="mt-2 rounded-lg bg-raised p-2.5"
      data-bloc-fiche={repere}
      data-bloc-ouvert={ouvert ? '' : undefined}
      {...attributs}
    >
      <button
        type="button"
        onClick={() => setOuvert((avant) => !avant)}
        aria-expanded={ouvert}
        className="flex w-full min-w-0 items-center gap-2 text-left"
        data-bloc-bascule={repere}
      >
        <ChevronDown
          className={cn('h-3.5 w-3.5 shrink-0 text-faint transition-transform', ouvert ? '' : '-rotate-90')}
          aria-hidden
        />
        {icone}
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium uppercase tracking-wide text-faint">
          {titre}
        </span>
        {indice ? (
          <span className="shrink-0 text-[11px] text-faint" {...indiceAttribut}>
            {indice}
          </span>
        ) : null}
      </button>
      {/* Replié, le contenu QUITTE le flux : sinon ses champs resteraient
          joignables au clavier et à un contrôle. */}
      {ouvert ? <div className="pt-1.5">{children}</div> : null}
    </section>
  );
}
