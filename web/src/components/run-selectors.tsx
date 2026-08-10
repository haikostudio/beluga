import * as React from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, SlidersHorizontal } from 'lucide-react';
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
 * UN SEUL point d'entrée : un bouton qui résume la configuration actuelle et
 * ouvre, au clic, une liste verticale à une seule colonne. Choisir « Moteur »,
 * « Modèle » ou « Réflexion » y creuse vers la liste de CE seul réglage, elle
 * aussi verticale — jamais deux colonnes, jamais de texte tronqué à quelques
 * lettres. La barre d'écriture affiche ce point d'entrée pour l'agent en
 * cours, la carte à valider pour l'agent qui l'exécutera plus tard : même
 * composant, même comportement.
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

type Vue = 'apercu' | 'moteur' | 'modele' | 'reflexion';

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
  /** Le bouton d'entrée prend toute la largeur — pour un pied de carte empilé. */
  pleineLargeur?: boolean;
}) {
  const { installed, engine, models, model, thinkingOptions, thinking } = resoudreRun(engines, choix);
  const [ouvert, setOuvert] = React.useState(false);
  const [vue, setVue] = React.useState<Vue>('apercu');
  const avertissementModele = messageDeRepli(engine);

  const resume = [nomCourtMoteur(engine), model?.label, thinkingOptions.length > 1 ? thinking?.label : null]
    .filter(Boolean)
    .join(' · ');

  const choisir = (patch: RunChoix) => {
    onSelect(patch);
    setOuvert(false);
  };

  return (
    <DropdownMenu
      open={ouvert}
      onOpenChange={(valeur) => {
        setOuvert(valeur);
        if (!valeur) setVue('apercu');
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'min-w-0 gap-1 text-[13px] text-faint hover:text-text',
            pleineLargeur ? 'w-full justify-between px-1.5' : 'px-1.5',
          )}
          data-selecteur="config"
        >
          <SlidersHorizontal className="h-3 w-3 shrink-0" />
          <span className={cn('truncate', pleineLargeur ? '' : 'max-w-[130px] sm:max-w-[220px]')}>
            {resume || 'Réglages'}
          </span>
          <ChevronDown className="h-2.5 w-2.5 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[240px] sm:max-h-[360px]">
        {vue === 'apercu' ? (
          <>
            <DropdownMenuLabel>Réglages de l'agent</DropdownMenuLabel>
            <LigneApercu
              titre="Moteur"
              valeur={nomCourtMoteur(engine)}
              repere="moteur"
              onClick={() => setVue('moteur')}
            />
            <LigneApercu
              titre="Modèle"
              valeur={model?.label ?? '—'}
              repere="modele"
              alerte={!!avertissementModele}
              onClick={() => setVue('modele')}
            />
            {thinkingOptions.length > 1 ? (
              <LigneApercu
                titre="Réflexion"
                valeur={thinking?.label ?? '—'}
                repere="reflexion"
                onClick={() => setVue('reflexion')}
              />
            ) : null}
          </>
        ) : null}

        {vue === 'moteur' ? (
          <Detail titre="Moteur" onRetour={() => setVue('apercu')}>
            {installed.map((e) => (
              <ItemListe
                key={e.id}
                actif={e.id === engine?.id}
                onSelect={() => choisir({ engine: e.id as RunConfig['engine'] })}
              >
                <span className="min-w-0 flex-1 truncate">{nomCourtMoteur(e)}</span>
                {e.version ? (
                  <span className="shrink-0 text-[11px] text-faint">{e.version.replace(/[^\d.]/g, '').slice(0, 8)}</span>
                ) : null}
              </ItemListe>
            ))}
          </Detail>
        ) : null}

        {vue === 'modele' ? (
          <Detail
            titre={engine?.live ? 'Modèle (liste du moteur)' : 'Modèle'}
            onRetour={() => setVue('apercu')}
            avertissement={avertissementModele}
          >
            {models.map((m) => {
              const note =
                m.note ??
                (m.releasedAt
                  ? new Date(m.releasedAt).toLocaleDateString('fr-CH', { month: '2-digit', year: '2-digit' })
                  : undefined);
              return (
                <ItemListe key={m.id} actif={m.id === model?.id} onSelect={() => choisir({ model: m.id })}>
                  {m.appetite ? <Appetite level={m.appetite} /> : null}
                  <span className="min-w-0 flex-1 truncate">{m.label}</span>
                  {note ? <span className="shrink-0 text-[11px] text-faint">{note}</span> : null}
                </ItemListe>
              );
            })}
          </Detail>
        ) : null}

        {vue === 'reflexion' ? (
          <Detail titre="Niveau de réflexion" onRetour={() => setVue('apercu')}>
            {thinkingOptions.map((niveau) => (
              <ItemListe key={niveau.id} actif={niveau.id === thinking?.id} onSelect={() => choisir({ thinking: niveau.id })}>
                <span className="min-w-0 flex-1 truncate">{niveau.label}</span>
              </ItemListe>
            ))}
          </Detail>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Une ligne de l'aperçu : le nom du réglage, sa valeur actuelle, une flèche
 * vers sa liste. `data-valeur` porte la valeur SEULE, sans le nom du réglage
 * ni la flèche — c'est ce que les scripts de vérification lisent, plutôt que
 * de reconstituer le texte affiché.
 */
function LigneApercu({
  titre,
  valeur,
  repere,
  alerte,
  onClick,
}: {
  titre: string;
  valeur: string;
  repere: string;
  alerte?: boolean;
  onClick: () => void;
}) {
  return (
    <DropdownMenuItem
      data-selecteur={repere}
      data-valeur={valeur}
      onSelect={(event) => {
        event.preventDefault();
        onClick();
      }}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px]"
    >
      <span className="text-[11.5px] uppercase tracking-wide text-faint">{titre}</span>
      <span className="ml-auto flex min-w-0 items-center gap-1 text-text">
        <span className="max-w-[130px] truncate">{valeur}</span>
        {alerte ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" title="Liste de secours" /> : null}
        <ChevronRight className="h-3 w-3 shrink-0 text-faint" />
      </span>
    </DropdownMenuItem>
  );
}

/** La liste verticale d'UN SEUL réglage, avec son chemin de retour vers l'aperçu. */
function Detail({
  titre,
  onRetour,
  avertissement,
  children,
}: {
  titre: string;
  onRetour: () => void;
  avertissement?: string | null;
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Un bouton ordinaire, pas un item de menu : il ne doit ni fermer le
          menu ni compter comme un choix dans les listes qui suivent. */}
      <button
        type="button"
        onClick={onRetour}
        className="mb-1 flex w-full items-center gap-1 rounded-md px-2 py-1 text-[12px] text-faint hover:text-text"
      >
        <ChevronLeft className="h-3 w-3 shrink-0" />
        {titre}
      </button>
      {avertissement ? (
        <p data-repli="liste-de-secours" className="px-2 pb-1.5 text-[12px] leading-snug text-warning" role="note">
          {avertissement}
        </p>
      ) : null}
      <div className="flex flex-col gap-1 p-1">{children}</div>
    </>
  );
}

function ItemListe({
  actif,
  onSelect,
  children,
}: {
  actif: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      className={cn(
        'flex items-center gap-2 rounded-md border px-2 py-1.5 text-[13px]',
        actif ? 'border-accent/60 bg-accent/10 text-text' : 'border-border text-muted',
      )}
    >
      {children}
      {actif ? <Check className="ml-auto h-3 w-3 shrink-0 text-success" /> : null}
    </DropdownMenuItem>
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
