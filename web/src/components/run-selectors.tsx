import * as React from 'react';
import { Check, ChevronDown, ChevronRight, SlidersHorizontal } from 'lucide-react';
import { AccountQuota, EngineInfo, RunConfig, messageDeRepli, resoudreRun } from '@beluga/shared';
import { Button, DialogTitle, Drawer, ZoneDefilement } from '@/components/ui';
import { cn } from '@/lib/utils';
import { t, formatRegional } from '@/lib/langue';

/**
 * Les trois réglages d'un agent — moteur, modèle, niveau de réflexion — dans
 * UN SEUL point d'entrée : un bouton qui résume la configuration actuelle et
 * ouvre, au clic, un tiroir d'aperçu à trois lignes, alignées à gauche (le nom
 * du réglage au-dessus, sa valeur juste en dessous). Choisir une ligne ouvre
 * un SECOND tiroir, empilé par-dessus le premier — jamais un remplacement de
 * son contenu — avec la liste verticale de CE seul réglage. Aucun bouton
 * retour : le tiroir du dessus se referme comme n'importe quel tiroir (voile,
 * geste, échappement) et retrouve l'aperçu resté ouvert en dessous — que ce
 * retour vienne d'un choix retenu ou d'un renoncement, l'aperçu, lui, ne se
 * ferme JAMAIS tout seul. La barre d'écriture affiche ce point d'entrée pour
 * l'agent en cours, la carte à valider pour l'agent qui l'exécutera plus
 * tard : même composant, même comportement.
 */

export type RunChoix = Partial<Pick<RunConfig, 'engine' | 'model' | 'thinking' | 'account'>>;

/**
 * Le nom court du moteur, celui que tout le monde utilise à l'oral : « Claude »,
 * « GPT » (Codex tourne sur des modèles GPT) ou « Cursor ». Le libellé complet
 * reste dans le catalogue pour les infobulles ; ici on ne garde que l'essentiel.
 */
export function nomCourtMoteur(engine: Pick<EngineInfo, 'id' | 'label'> | undefined): string {
  if (!engine) return 'moteur';
  if (engine.id === 'codex') return 'GPT';
  if (engine.id === 'claude') return 'Claude';
  if (engine.id === 'cursor') return 'Cursor';
  return engine.label;
}

/**
 * Ce qui est réellement affiché à partir d'un choix : un modèle enregistré
 * peut avoir disparu du catalogue, un moteur peut ne plus être installé. On
 * retombe alors sur le plus proche équivalent plutôt que sur du vide.
 */
export { resoudreRun };

type SousVue = 'moteur' | 'modele' | 'reflexion' | 'compte' | null;

export function RunSelectors({
  engines,
  choix,
  onSelect,
  pleineLargeur,
  comptes,
  masquerDeclencheur,
  ouvertControle,
  onOuvertControleChange,
  ouvrirSur,
}: {
  engines: EngineInfo[];
  choix: RunChoix | undefined;
  /** Un seul réglage change à la fois ; celui qui appelle décide de la suite. */
  onSelect: (patch: RunChoix) => void;
  /** Le bouton d'entrée prend toute la largeur — pour un pied de carte empilé. */
  pleineLargeur?: boolean;
  /**
   * Tous les comptes connus, tous moteurs confondus (`state.quotas`). La ligne
   * « Compte » ne s'affiche que si plusieurs d'entre eux, une fois filtrés sur
   * le moteur choisi et non coupés, se disputent le travail — sinon le choix
   * automatique suffit et n'a rien à montrer.
   */
  comptes?: Pick<AccountQuota, 'id' | 'engine' | 'label' | 'disabled'>[];
  /**
   * Cache le bouton d'entrée : celui qui appelle porte déjà son propre
   * déclencheur (une bulle du fil, par exemple) et pilote l'ouverture du
   * tiroir d'aperçu lui-même via `ouvertControle` / `onOuvertControleChange` —
   * sans ce couple, le tiroir ne pourrait plus jamais s'ouvrir.
   */
  masquerDeclencheur?: boolean;
  ouvertControle?: boolean;
  onOuvertControleChange?: (ouvert: boolean) => void;
  /**
   * OUVRIR DIRECTEMENT SUR UN RÉGLAGE. La carte de configuration d'une tâche
   * neuve affiche déjà les trois valeurs : cliquer « Modèle » doit donner la
   * liste des modèles, pas un aperçu qu'il faut re-cliquer. Sans cette
   * propriété, le tiroir s'ouvre sur son aperçu, comme partout ailleurs.
   */
  ouvrirSur?: 'moteur' | 'modele' | 'reflexion' | 'compte';
}) {
  const { installed, engine, models, model, thinkingOptions, thinking } = resoudreRun(engines, choix);
  const [ouvertInterne, setOuvertInterne] = React.useState(false);
  const ouvert = ouvertControle ?? ouvertInterne;
  const setOuvert = onOuvertControleChange ?? setOuvertInterne;
  const [sousVue, setSousVue] = React.useState<SousVue>(null);
  const avertissementModele = messageDeRepli(engine);

  /*
   * L'ouverture demandée sur un réglage PRÉCIS n'est jouée qu'au moment où le
   * tiroir s'ouvre : rejouée à chaque rendu, elle rouvrirait la liste que
   * l'utilisateur vient de refermer.
   */
  const etaitOuvert = React.useRef(false);
  React.useEffect(() => {
    if (ouvert && !etaitOuvert.current && ouvrirSur) setSousVue(ouvrirSur);
    if (!ouvert) setSousVue(null);
    etaitOuvert.current = ouvert;
  }, [ouvert, ouvrirSur]);

  const comptesDuMoteur = (comptes ?? []).filter((c) => c.engine === engine?.id && !c.disabled);
  const compteChoisi = choix?.account ? comptesDuMoteur.find((c) => c.id === choix.account) : undefined;

  const resume = [
    nomCourtMoteur(engine),
    model?.label,
    thinkingOptions.length > 1 ? thinking?.label : null,
    compteChoisi ? compteChoisi.label : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const fermerTout = () => {
    setOuvert(false);
    setSousVue(null);
  };

  const choisir = (patch: RunChoix) => {
    onSelect(patch);
    setSousVue(null);
  };

  const titreSousVue =
    sousVue === 'moteur'
      ? t('Moteur')
      : sousVue === 'modele'
        ? engine?.live
          ? t('Modèle (liste du moteur)')
          : t('Modèle')
        : sousVue === 'reflexion'
          ? t('Niveau de réflexion')
          : sousVue === 'compte'
            ? t('Compte')
            : '';

  return (
    <>
      {masquerDeclencheur ? null : (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOuvert(true)}
          className={cn(
            'min-w-0 gap-1 text-[13px] text-faint hover:text-text',
            pleineLargeur ? 'w-full justify-between px-1.5' : 'px-1.5',
          )}
          data-selecteur="config"
        >
          <SlidersHorizontal className="h-3 w-3 shrink-0" />
          <span className={cn('truncate', pleineLargeur ? '' : 'max-w-[130px] sm:max-w-[220px]')}>
            {resume || t('Réglages')}
          </span>
          <ChevronDown className="h-2.5 w-2.5 shrink-0" />
        </Button>
      )}

      {/* Le tiroir d'aperçu : trois lignes, chacune alignée à gauche. */}
      <Drawer open={ouvert} onClose={fermerTout}>
        <header className="flex shrink-0 items-center gap-2 px-3 pb-2">
          <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-accent" />
          <DialogTitle className="min-w-0 flex-1 truncate">{t('Réglages de l\'agent')}</DialogTitle>
        </header>
        <div
          role="menu"
          aria-label="Réglages de l'agent"
          // Masqué de l'arbre d'accessibilité pendant qu'un détail est
          // ouvert par-dessus : les scripts qui comptent les entrées de la
          // liste du dessus ne doivent pas retomber sur ces trois lignes.
          aria-hidden={sousVue !== null || undefined}
          className="flex flex-col gap-1 px-2 pb-3"
        >
          <LigneApercu
            titre={t('Moteur')}
            valeur={nomCourtMoteur(engine)}
            repere="moteur"
            menuitem={sousVue === null}
            onClick={() => setSousVue('moteur')}
          />
          <LigneApercu
            titre={t('Modèle')}
            valeur={model?.label ?? '—'}
            repere="modele"
            alerte={!!avertissementModele}
            menuitem={sousVue === null}
            onClick={() => setSousVue('modele')}
          />
          {thinkingOptions.length > 1 ? (
            <LigneApercu
              titre={t('Réflexion')}
              valeur={thinking?.label ?? '—'}
              repere="reflexion"
              menuitem={sousVue === null}
              onClick={() => setSousVue('reflexion')}
            />
          ) : null}
          {comptesDuMoteur.length > 1 ? (
            <LigneApercu
              titre={t('Compte')}
              valeur={compteChoisi?.label ?? t('Automatique')}
              repere="compte"
              menuitem={sousVue === null}
              onClick={() => setSousVue('compte')}
            />
          ) : null}
        </div>
      </Drawer>

      {/* Le tiroir de détail : empilé par-dessus l'aperçu, sans bouton retour —
          le refermer (voile, geste, échappement) retrouve l'aperçu resté ouvert. */}
      <Drawer open={sousVue !== null} onClose={() => setSousVue(null)} empile>
        <header className="flex shrink-0 items-center gap-2 px-3 pb-2">
          <DialogTitle className="min-w-0 flex-1 truncate">{titreSousVue}</DialogTitle>
        </header>
        {sousVue === 'modele' && avertissementModele ? (
          <p data-repli="liste-de-secours" className="px-3 pb-1.5 text-[12px] leading-snug text-warning" role="note">
            {avertissementModele}
          </p>
        ) : null}
        <ZoneDefilement role="menu" aria-label={titreSousVue} className="flex flex-col gap-1 px-2 pb-3">
          {sousVue === 'moteur'
            ? installed.map((e) => (
                <ItemListe
                  key={e.id}
                  actif={e.id === engine?.id}
                  moteurId={e.id}
                  onSelect={() => choisir({ engine: e.id as RunConfig['engine'] })}
                >
                  <span className="min-w-0 flex-1 truncate">{nomCourtMoteur(e)}</span>
                  {e.version ? (
                    <span className="shrink-0 text-[11px] text-faint">
                      {e.version.replace(/[^\d.]/g, '').slice(0, 8)}
                    </span>
                  ) : null}
                </ItemListe>
              ))
            : null}

          {sousVue === 'modele'
            ? models.map((m) => {
                const note =
                  m.note ??
                  (m.releasedAt
                    ? new Date(m.releasedAt).toLocaleDateString(formatRegional(), { month: '2-digit', year: '2-digit' })
                    : undefined);
                return (
                  <ItemListe key={m.id} actif={m.id === model?.id} modeleId={m.id} onSelect={() => choisir({ model: m.id })}>
                    {m.appetite ? <Appetite level={m.appetite} /> : null}
                    <span className="min-w-0 flex-1 truncate">{m.label}</span>
                    {note ? <span className="shrink-0 text-[11px] text-faint">{note}</span> : null}
                  </ItemListe>
                );
              })
            : null}

          {sousVue === 'reflexion'
            ? thinkingOptions.map((niveau) => (
                <ItemListe
                  key={niveau.id}
                  actif={niveau.id === thinking?.id}
                  onSelect={() => choisir({ thinking: niveau.id })}
                >
                  <span className="min-w-0 flex-1 truncate">{niveau.label}</span>
                </ItemListe>
              ))
            : null}

          {sousVue === 'compte' ? (
            <>
              {/* Repartir sur la répartition automatique — celle qui suit le
                  quota disponible — plutôt que sur un compte figé. */}
              <ItemListe actif={!choix?.account} onSelect={() => choisir({ account: undefined })}>
                <span className="min-w-0 flex-1 truncate">{t('Automatique')}</span>
              </ItemListe>
              {comptesDuMoteur.map((c) => (
                <ItemListe key={c.id} actif={c.id === choix?.account} onSelect={() => choisir({ account: c.id })}>
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                </ItemListe>
              ))}
            </>
          ) : null}
        </ZoneDefilement>
      </Drawer>
    </>
  );
}

/**
 * Une ligne de l'aperçu, alignée à gauche : le nom du réglage au-dessus, sa
 * valeur actuelle juste en dessous, une flèche vers sa liste. `data-valeur`
 * porte la valeur SEULE, sans le nom du réglage ni la flèche — c'est ce que
 * les scripts de vérification lisent, plutôt que de reconstituer le texte
 * affiché.
 */
function LigneApercu({
  titre,
  valeur,
  repere,
  alerte,
  menuitem,
  onClick,
}: {
  titre: string;
  valeur: string;
  repere: string;
  alerte?: boolean;
  /** L'état du mode plan, lu tel quel par les scripts de vérification. */
  /** Faux tant qu'un détail est ouvert par-dessus : la ligne sort alors de la
   * liste des « menuitem », pour ne pas se mêler à celles du tiroir du dessus. */
  menuitem: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role={menuitem ? 'menuitem' : undefined}
      data-selecteur={repere}
      data-valeur={valeur}
      onClick={onClick}
      className="flex items-center justify-between gap-2 rounded-md px-2 py-2 text-left hover:bg-raised"
    >
      <span className="flex min-w-0 flex-col items-start gap-0.5">
        <span className="text-[11px] uppercase tracking-wide text-faint">{titre}</span>
        <span className="max-w-[220px] truncate text-[14px] text-text">{valeur}</span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {alerte ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" title={t('Liste de secours')} /> : null}
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint" />
      </span>
    </button>
  );
}

function ItemListe({
  actif,
  moteurId,
  modeleId,
  onSelect,
  children,
}: {
  actif: boolean;
  moteurId?: string;
  modeleId?: string;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="menuitem"
      data-moteur-id={moteurId}
      data-modele-id={modeleId}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-[13px] outline-none',
        actif ? 'border-accent/60 bg-accent/10 text-text' : 'border-border text-muted hover:bg-raised',
      )}
    >
      {children}
      {actif ? <Check className="ml-auto h-3 w-3 shrink-0 text-success" /> : null}
    </div>
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
      ? t('Gourmand : consomme beaucoup de quota')
      : level === 'medium'
        ? t('Moyen : consommation de quota raisonnable')
        : t('Léger : consomme peu de quota');
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

/**
 * LE RÉGLAGE RÉEL D'UN AGENT, EN LECTURE SEULE.
 *
 * Un agent de dépannage de publication n'a pas de barre de réglages : le démon
 * choisit pour lui (première passe sur le modèle le plus léger du moteur, puis
 * le modèle de la carte). Ce bandeau MONTRE ce qui tourne — moteur, modèle,
 * réflexion, compte —, sans rien permettre de changer. Il lit l'agent en
 * direct : une seconde passe ouvre un autre agent, et le bandeau suit celui
 * qu'on regarde.
 */
export function ReglageEnLecture({
  engines,
  run,
  compte,
  comptes,
}: {
  engines: EngineInfo[];
  run: Pick<RunConfig, 'engine' | 'model' | 'thinking'>;
  /** Le compte porteur du tour (`agent.account`), vide tant qu'aucun tour n'est parti. */
  compte?: string;
  comptes?: Pick<AccountQuota, 'id' | 'label'>[];
}) {
  /* Aucun REPLI ici, contrairement au sélecteur : un modèle absent du catalogue
     s'affiche sous son identifiant brut, jamais sous le nom du modèle par défaut
     — le bandeau dit ce qui tourne, pas ce qu'on pourrait choisir. */
  const engine = engines.find((e) => e.id === run.engine);
  const model = engine?.models.find((m) => m.id === (run.model ?? engine.defaultModel));
  const thinking = model?.thinking?.find((o) => o.id === run.thinking);
  const libelleCompte = compte ? (comptes?.find((c) => c.id === compte)?.label ?? compte) : t('Automatique');
  const lignes: [string, string, string][] = [
    ['moteur', t('Moteur'), engine ? nomCourtMoteur(engine) : run.engine],
    ['modele', t('Modèle'), model?.label ?? run.model ?? '—'],
    ...(run.thinking && run.thinking !== 'none'
      ? [['reflexion', t('Réflexion'), thinking?.label ?? run.thinking] as [string, string, string]]
      : []),
    ['compte', t('Compte'), libelleCompte],
  ];
  return (
    <dl
      className="mt-2 flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-raised px-3 py-2 text-[12px]"
      aria-label="Réglage de l'agent"
      data-reglage-agent
    >
      {lignes.map(([cle, titre, valeur]) => (
        <div key={cle} className="flex min-w-0 items-baseline gap-1.5" data-reglage={cle}>
          <dt className="shrink-0 text-faint">{titre}</dt>
          <dd className="min-w-0 truncate font-medium text-text">{valeur}</dd>
        </div>
      ))}
    </dl>
  );
}
