import * as React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { EngineInfo, RunConfig } from '@haikodev/shared';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui';
import { cn } from '@/lib/utils';

/**
 * Les trois réglages d'un agent — moteur, modèle, niveau de réflexion — dans
 * un seul endroit : la barre d'écriture les affiche pour l'agent en cours, la
 * carte à valider les affiche pour l'agent qui l'exécutera plus tard. Mêmes
 * menus, même comportement, une seule définition.
 */

export type RunChoix = Partial<Pick<RunConfig, 'engine' | 'model' | 'thinking'>>;

/**
 * Ce qui est réellement affiché à partir d'un choix : un modèle enregistré
 * peut avoir disparu du catalogue, un moteur peut ne plus être installé. On
 * retombe alors sur le plus proche équivalent plutôt que sur du vide.
 */
export function resoudreRun(engines: EngineInfo[], choix: RunChoix | undefined) {
  const installed = engines.filter((e) => e.installed);
  const engine = installed.find((e) => e.id === choix?.engine) ?? installed[0];
  const models = engine?.models ?? [];
  const model =
    models.find((m) => m.id === choix?.model) ?? models.find((m) => m.id === engine?.defaultModel) ?? models[0];
  // Les niveaux affichés sont EXACTEMENT ceux que ce modèle propose.
  const thinkingOptions = model?.thinking ?? [];
  const thinking = thinkingOptions.find((t) => t.id === choix?.thinking) ?? thinkingOptions[0];
  return { installed, engine, models, model, thinkingOptions, thinking };
}

export function RunSelectors({
  engines,
  choix,
  onSelect,
}: {
  engines: EngineInfo[];
  choix: RunChoix | undefined;
  /** Un seul réglage change à la fois ; celui qui appelle décide de la suite. */
  onSelect: (patch: RunChoix) => void;
}) {
  const { installed, engine, models, model, thinkingOptions, thinking } = resoudreRun(engines, choix);
  return (
    <>
      <Selector
        label={engine?.label ?? 'moteur'}
        items={installed.map((e) => ({
          id: e.id,
          label: e.label,
          note: e.version?.replace(/[^\d.]/g, '').slice(0, 8),
        }))}
        value={engine?.id}
        onSelect={(id) => onSelect({ engine: id })}
        title="Moteur"
      />
      <Selector
        label={model?.label ?? 'modèle'}
        items={models.map((m) => ({
          id: m.id,
          label: m.label,
          description: m.description,
          appetite: m.appetite,
          note: m.releasedAt
            ? new Date(m.releasedAt).toLocaleDateString('fr-CH', { month: '2-digit', year: '2-digit' })
            : undefined,
        }))}
        value={model?.id}
        onSelect={(id) => onSelect({ model: id })}
        title={engine?.live ? 'Modèle (liste du moteur)' : 'Modèle'}
      />
      {thinkingOptions.length > 1 ? (
        <Selector
          label={thinking?.label ?? 'réflexion'}
          items={thinkingOptions.map((level) => ({
            id: level.id,
            label: level.label,
            description: level.description,
          }))}
          value={thinking?.id}
          onSelect={(id) => onSelect({ thinking: id })}
          title="Niveau de réflexion"
        />
      ) : null}
    </>
  );
}

export function Selector({
  label,
  items,
  value,
  onSelect,
  title,
}: {
  label: string;
  items: { id: string; label: string; note?: string; description?: string; appetite?: 'light' | 'medium' | 'heavy' }[];
  value?: string;
  onSelect: (id: string) => void;
  title: string;
}) {
  if (!items.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="min-w-0 shrink gap-0.5 px-1 text-[13px] text-faint hover:text-text sm:gap-1 sm:px-1.5"
        >
          <span className="max-w-[56px] truncate sm:max-w-[110px]">{label}</span>
          <ChevronDown className="h-2.5 w-2.5 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="sm:max-h-[320px] sm:w-[268px] sm:overflow-y-auto">
        <DropdownMenuLabel>{title}</DropdownMenuLabel>
        {items.map((item) => (
          <DropdownMenuItem key={item.id} onSelect={() => onSelect(item.id)} className="items-start">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                {item.appetite ? <Appetite level={item.appetite} /> : null}
                <span className="truncate text-text">{item.label}</span>
                {item.note ? <span className="ml-auto shrink-0 text-[11.5px] text-faint">{item.note}</span> : null}
              </div>
              {item.description ? (
                <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-faint">{item.description}</p>
              ) : null}
            </div>
            {value === item.id ? <Check className="mt-0.5 h-3 w-3 shrink-0 text-success" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * L'appétit en quota, sans chiffre : trois traits pleins = gourmand, un seul =
 * léger. On veut savoir si un modèle va manger le quota, pas combien il coûte.
 */
export function Appetite({ level }: { level: 'light' | 'medium' | 'heavy' }) {
  const rempli = level === 'heavy' ? 3 : level === 'medium' ? 2 : 1;
  const titre =
    level === 'heavy'
      ? 'Gourmand : consomme beaucoup de quota'
      : level === 'medium'
        ? 'Moyen : consommation de quota raisonnable'
        : 'Léger : consomme peu de quota';
  return (
    <span className="flex shrink-0 items-end gap-[1.5px]" title={titre} aria-label={titre}>
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={cn(
            'w-[3px] rounded-[1px]',
            index < rempli
              ? level === 'heavy'
                ? 'bg-warning'
                : level === 'medium'
                  ? 'bg-muted'
                  : 'bg-success'
              : 'bg-border',
          )}
          style={{ height: `${4 + index * 3}px` }}
        />
      ))}
    </span>
  );
}
