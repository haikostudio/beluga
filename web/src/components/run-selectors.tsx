import * as React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { EngineInfo, RunConfig, messageDeRepli } from '@haikodev/shared';
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

export type RunChoix = Partial<Pick<RunConfig, 'engine' | 'model' | 'thinking' | 'mode'>>;

/**
 * Le nom court du moteur, celui que tout le monde utilise à l'oral : « Claude »
 * ou « GPT » (Codex tourne sur des modèles GPT). Le libellé complet reste
 * dans le catalogue pour les infobulles ; ici on ne garde que l'essentiel.
 */
export function nomCourtMoteur(engine: Pick<EngineInfo, 'id' | 'label'> | undefined): string {
  if (!engine) return 'moteur';
  if (engine.id === 'codex') return 'GPT';
  if (engine.id === 'claude') return 'Claude';
  return engine.label;
}

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
  pleineLargeur,
}: {
  engines: EngineInfo[];
  choix: RunChoix | undefined;
  /** Un seul réglage change à la fois ; celui qui appelle décide de la suite. */
  onSelect: (patch: RunChoix) => void;
  /** Chaque menu prend toute la largeur, sans troncature — pour un pied empilé en lignes. */
  pleineLargeur?: boolean;
}) {
  const { installed, engine, models, model, thinkingOptions, thinking } = resoudreRun(engines, choix);
  return (
    <>
      <Selector
        label={nomCourtMoteur(engine)}
        items={installed.map((e) => ({
          id: e.id,
          label: nomCourtMoteur(e),
          note: e.version?.replace(/[^\d.]/g, '').slice(0, 8),
        }))}
        value={engine?.id}
        // La liste ne contient QUE des moteurs connus : l'identifiant en vient.
        onSelect={(id) => onSelect({ engine: id as RunConfig['engine'] })}
        title="Moteur"
        pleineLargeur={pleineLargeur}
      />
      <Selector
        label={model?.label ?? 'modèle'}
        items={models.map((m) => ({
          id: m.id,
          label: m.label,
          appetite: m.appetite,
          // Le repère de droite : la date de sortie quand le moteur la donne,
          // sinon l'identifiant quand deux modèles portent le même nom.
          note:
            m.note ??
            (m.releasedAt
              ? new Date(m.releasedAt).toLocaleDateString('fr-CH', { month: '2-digit', year: '2-digit' })
              : undefined),
        }))}
        value={model?.id}
        onSelect={(id) => onSelect({ model: id })}
        title={engine?.live ? 'Modèle (liste du moteur)' : 'Modèle'}
        avertissement={messageDeRepli(engine)}
        repere="modele"
        pleineLargeur={pleineLargeur}
      />
      {thinkingOptions.length > 1 ? (
        <Selector
          label={thinking?.label ?? 'réflexion'}
          items={thinkingOptions.map((level) => ({ id: level.id, label: level.label }))}
          value={thinking?.id}
          onSelect={(id) => onSelect({ thinking: id })}
          title="Niveau de réflexion"
          pleineLargeur={pleineLargeur}
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
  avertissement,
  repere,
  pleineLargeur,
}: {
  label: string;
  items: { id: string; label: string; note?: string; appetite?: 'light' | 'medium' | 'heavy' }[];
  value?: string;
  onSelect: (id: string) => void;
  title: string;
  /** Ce qu'il faut savoir sur la liste elle-même — par exemple qu'elle est de secours. */
  avertissement?: string | null;
  /** Repère stable pour les scripts de vérification, jamais lu par l'interface. */
  repere?: string;
  /** Le menu prend toute la largeur, libellé entier à gauche, chevron à droite. */
  pleineLargeur?: boolean;
}) {
  if (!items.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'text-[13px] text-faint hover:text-text',
            pleineLargeur
              ? 'w-full justify-between px-1.5'
              : 'min-w-0 shrink gap-0.5 px-1 sm:gap-1 sm:px-1.5',
          )}
          title={avertissement ?? undefined}
          data-selecteur={repere}
        >
          <span className={pleineLargeur ? 'truncate' : 'max-w-[56px] truncate sm:max-w-[110px]'}>{label}</span>
          <ChevronDown className="h-2.5 w-2.5 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      {/* Colonnes compactes : juste le nom et son repère, sans texte
          d'explication en dessous — la liste se parcourt d'un coup d'œil. */}
      <DropdownMenuContent align="start" className="sm:max-h-[320px] sm:w-[220px]">
        <DropdownMenuLabel>{title}</DropdownMenuLabel>
        {avertissement ? (
          <p
            data-repli="liste-de-secours"
            className="px-2 pb-1.5 text-[12px] leading-snug text-warning"
            role="note"
          >
            {avertissement}
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-1 p-1">
          {items.map((item) => (
            <DropdownMenuItem
              key={item.id}
              onSelect={() => onSelect(item.id)}
              className={cn(
                'flex-col items-start gap-0.5 rounded-md border px-2 py-1.5 text-[12.5px]',
                value === item.id ? 'border-accent/60 bg-accent/10 text-text' : 'border-border',
              )}
            >
              <span className="flex w-full min-w-0 items-center gap-1">
                {item.appetite ? <Appetite level={item.appetite} /> : null}
                <span className="truncate text-text">{item.label}</span>
                {value === item.id ? <Check className="ml-auto h-2.5 w-2.5 shrink-0 text-success" /> : null}
              </span>
              {item.note ? <span className="truncate text-[10.5px] text-faint">{item.note}</span> : null}
            </DropdownMenuItem>
          ))}
        </div>
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
