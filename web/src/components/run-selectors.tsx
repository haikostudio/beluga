import * as React from 'react';
import { Check, ChevronDown, Search, SlidersHorizontal } from 'lucide-react';
import {
  AccountQuota,
  EngineInfo,
  MODELES_AFFICHES_D_ABORD,
  RunConfig,
  messageDeRepli,
  modelesAffiches,
  nomCourtDuMoteur,
  resoudreRun,
} from '@beluga/shared';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  ouvertureAuClic,
  rendreLeFocusALEntreeDuSousMenu,
} from '@/components/ui';
import { cn } from '@/lib/utils';
import { t, formatRegional } from '@/lib/langue';

/**
 * Les réglages d'un agent — moteur, modèle, niveau de réflexion, compte — dans
 * UN SEUL point d'entrée : un bouton qui résume la configuration actuelle et
 * ouvre, au clic, UN PETIT MENU ANCRÉ SOUS LUI — jamais une page (demande du
 * 11/10/2026 : « un bouton d'options ouvre un menu déroulant »). Le menu porte
 * une entrée par réglage, qui montre sa valeur actuelle ; chacune DÉPLIE la
 * liste de ses choix en sous-menu, à côté d'elle (un panneau du bas sur
 * téléphone). Choisir une valeur replie le sous-menu et LAISSE LE MENU OUVERT,
 * ses valeurs à jour : on règle le moteur puis le modèle sans rouvrir quoi que
 * ce soit. Le menu se referme comme tout menu — un clic ailleurs, l'échappement.
 *
 * La barre d'écriture affiche ce point d'entrée pour l'agent en cours, la carte
 * à valider pour l'agent qui l'exécutera plus tard : même composant, même
 * comportement.
 *
 * UN ÉCRAN QUI MONTRE DÉJÀ SES RÉGLAGES LIGNE PAR LIGNE confie SA ligne au menu
 * (`declencheur`) et nomme le réglage qu'elle ouvre (`ouvrirSur`) : le menu est
 * alors DIRECTEMENT la liste de ce réglage, ancrée à la ligne cliquée.
 */

export type RunChoix = Partial<Pick<RunConfig, 'engine' | 'model' | 'thinking' | 'account'>>;

/** Les quatre réglages, dans l'ordre où ils se lisent. */
export type ReglageDeRun = 'moteur' | 'modele' | 'reflexion' | 'compte';

/**
 * Le nom court du moteur, celui que tout le monde utilise à l'oral : « Claude »,
 * « GPT » (Codex tourne sur des modèles GPT) ou « Cursor ». Le libellé complet
 * reste dans le catalogue pour les infobulles ; ici on ne garde que l'essentiel.
 */
export function nomCourtMoteur(engine: Pick<EngineInfo, 'id' | 'label'> | undefined): string {
  if (!engine) return 'moteur';
  // Le nom court vient du registre des moteurs : un moteur ajouté l'a d'office.
  return nomCourtDuMoteur(engine.id, engine.label);
}

/**
 * Ce qui est réellement affiché à partir d'un choix : un modèle enregistré
 * peut avoir disparu du catalogue, un moteur peut ne plus être installé. On
 * retombe alors sur le plus proche équivalent plutôt que sur du vide.
 */
export { resoudreRun };

type ComptesConnus = Pick<AccountQuota, 'id' | 'engine' | 'label' | 'disabled'>[];

/** Tout ce que le menu montre, lu UNE fois : le choix résolu, les comptes du moteur, l'alerte de repli. */
function lireLesReglages(engines: EngineInfo[], choix: RunChoix | undefined, comptes: ComptesConnus | undefined) {
  const resolu = resoudreRun(engines, choix);
  const comptesDuMoteur = (comptes ?? []).filter((c) => c.engine === resolu.engine?.id && !c.disabled);
  const compteChoisi = choix?.account ? comptesDuMoteur.find((c) => c.id === choix.account) : undefined;
  return { ...resolu, comptesDuMoteur, compteChoisi, avertissementModele: messageDeRepli(resolu.engine) };
}
type ReglagesLus = ReturnType<typeof lireLesReglages>;

/** La tenue d'un menu de réglages : assez large pour un nom de modèle, borné à la place libre. */
const CLASSE_MENU_DE_REGLAGES =
  'min-w-[240px] sm:max-h-[min(480px,var(--radix-dropdown-menu-content-available-height))] sm:max-w-[min(340px,calc(100vw-16px))]';

export function RunSelectors({
  engines,
  choix,
  onSelect,
  pleineLargeur,
  comptes,
  declencheur,
  ouvrirSur,
}: {
  engines: EngineInfo[];
  choix: RunChoix | undefined;
  /** Un seul réglage change à la fois ; celui qui appelle décide de la suite. */
  onSelect: (patch: RunChoix) => void;
  /** Le bouton d'entrée prend toute la largeur — pour un pied de carte empilé. */
  pleineLargeur?: boolean;
  /**
   * Tous les comptes connus, tous moteurs confondus (`state.quotas`). L'entrée
   * « Compte » ne s'affiche que si plusieurs d'entre eux, une fois filtrés sur
   * le moteur choisi et non coupés, se disputent le travail — sinon le choix
   * automatique suffit et n'a rien à montrer.
   */
  comptes?: ComptesConnus;
  /**
   * LE BOUTON DE CELUI QUI APPELLE, à la place du bouton de résumé. Un menu a
   * besoin de SON bouton comme ancre : un écran qui a déjà le sien (une ligne
   * de configuration, l'icône du Studio) le confie ici, et c'est sous lui que
   * le menu s'ouvre. Un élément qui transmet sa référence et ses propriétés à
   * un vrai `button`.
   */
  declencheur?: React.ReactElement;
  /**
   * LE MENU EST DIRECTEMENT LA LISTE D'UN RÉGLAGE. La carte de configuration
   * d'une tâche neuve affiche déjà les quatre valeurs : cliquer « Modèle » doit
   * donner la liste des modèles sous cette ligne, pas un menu qui les répète.
   * Sans cette propriété, le menu porte une entrée par réglage.
   */
  ouvrirSur?: ReglageDeRun;
}) {
  const lu = lireLesReglages(engines, choix, comptes);
  const [ouvert, setOuvert] = React.useState(false);

  const resume = [
    nomCourtMoteur(lu.engine),
    lu.model?.label,
    lu.thinkingOptions.length > 1 ? lu.thinking?.label : null,
    lu.compteChoisi ? lu.compteChoisi.label : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <DropdownMenu open={ouvert} onOpenChange={setOuvert}>
      <DropdownMenuTrigger asChild {...ouvertureAuClic(() => setOuvert(true))}>
        {declencheur ?? (
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
              {resume || t('Réglages')}
            </span>
            <ChevronDown className="h-2.5 w-2.5 shrink-0" />
          </Button>
        )}
      </DropdownMenuTrigger>
      {ouvrirSur ? (
        /* Un seul réglage : le menu EST sa liste, et choisir le referme — il n'y
           a rien d'autre à y faire. Il garde le nom de la ligne qui l'a ouvert. */
        <DropdownMenuContent
          align="start"
          collisionPadding={8}
          className={CLASSE_MENU_DE_REGLAGES}
          data-menu-reglages={ouvrirSur}
        >
          <ListeDUnReglage reglage={ouvrirSur} lu={lu} choix={choix} onChoisir={(patch) => onSelect(patch)} />
        </DropdownMenuContent>
      ) : (
        /* Tous les réglages : le menu porte SON nom, pas celui du bouton — un
           résumé qui change à chaque choix. */
        <DropdownMenuContent
          align="start"
          collisionPadding={8}
          className={CLASSE_MENU_DE_REGLAGES}
          data-menu-reglages="tous"
          aria-labelledby={undefined}
          aria-label="Réglages de l'agent"
        >
          <DropdownMenuLabel>{t('Réglages de l\'agent')}</DropdownMenuLabel>
          <EntreesDeReglages engines={engines} choix={choix} onSelect={onSelect} comptes={comptes} />
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
}

/**
 * LES ENTRÉES D'UN MENU DE RÉGLAGES — une par réglage, qui montre sa valeur et
 * déplie sa liste en sous-menu. Elles se posent dans N'IMPORTE QUEL menu
 * (`DropdownMenuContent`) : celui du bouton de résumé ci-dessus, ou celui de la
 * configuration d'une carte (`chat.tsx`), qui a son propre bouton.
 *
 * « Réflexion » ne paraît que si le modèle offre plusieurs niveaux, « Compte »
 * que si plusieurs comptes du moteur se disputent le travail.
 *
 * `data-valeur` porte la valeur SEULE, sans le nom du réglage ni la flèche —
 * c'est ce que les scripts de vérification lisent, plutôt que de reconstituer
 * le texte affiché.
 */
export function EntreesDeReglages({
  engines,
  choix,
  onSelect,
  comptes,
}: {
  engines: EngineInfo[];
  choix: RunChoix | undefined;
  onSelect: (patch: RunChoix) => void;
  comptes?: ComptesConnus;
}) {
  const lu = lireLesReglages(engines, choix, comptes);
  /* UN SEUL SOUS-MENU À LA FOIS, et c'est ici qu'on le sait : un choix le
     replie sans toucher au menu. */
  const [deplie, setDeplie] = React.useState<ReglageDeRun | null>(null);

  const entree = (reglage: ReglageDeRun, titre: string, valeur: string, alerte?: boolean) => (
    <DropdownMenuSub
      key={reglage}
      open={deplie === reglage}
      onOpenChange={(ouvert) => setDeplie((avant) => (ouvert ? reglage : avant === reglage ? null : avant))}
    >
      <DropdownMenuSubTrigger data-selecteur={reglage} data-valeur={valeur} className="min-w-0 rounded-md py-2">
        <span className="shrink-0 text-faint">{titre}</span>
        <span className="min-w-0 flex-1 truncate text-right text-text">{valeur}</span>
        {alerte ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" title={t('Liste de secours')} /> : null}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-[220px] sm:max-w-[min(340px,calc(100vw-16px))]">
        <ListeDUnReglage
          reglage={reglage}
          lu={lu}
          choix={choix}
          onChoisir={(patch, evenement) => {
            /* LE SOUS-MENU SE REPLIE, LE MENU RESTE : la valeur choisie s'y lit
               aussitôt, et le réglage suivant est à un clic. */
            evenement.preventDefault();
            onSelect(patch);
            rendreLeFocusALEntreeDuSousMenu(evenement.currentTarget as Element | null);
            setDeplie(null);
          }}
        />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );

  return (
    <>
      {entree('moteur', t('Moteur'), nomCourtMoteur(lu.engine))}
      {entree('modele', t('Modèle'), lu.model?.label ?? '—', !!lu.avertissementModele)}
      {lu.thinkingOptions.length > 1 ? entree('reflexion', t('Réflexion'), lu.thinking?.label ?? '—') : null}
      {lu.comptesDuMoteur.length > 1
        ? entree('compte', t('Compte'), lu.compteChoisi?.label ?? t('Automatique'))
        : null}
    </>
  );
}

/**
 * LA LISTE DES CHOIX D'UN RÉGLAGE : son titre, l'avertissement de la liste de
 * secours pour les modèles, puis un choix par ligne. Elle sert telle quelle au
 * sous-menu d'une entrée et au menu ouvert directement sur un réglage.
 */
function ListeDUnReglage({
  reglage,
  lu,
  choix,
  onChoisir,
}: {
  reglage: ReglageDeRun;
  lu: ReglagesLus;
  choix: RunChoix | undefined;
  onChoisir: (patch: RunChoix, evenement: Event) => void;
}) {
  const titre =
    reglage === 'moteur'
      ? t('Moteur')
      : reglage === 'modele'
        ? lu.engine?.live
          ? t('Modèle (liste du moteur)')
          : t('Modèle')
        : reglage === 'reflexion'
          ? t('Niveau de réflexion')
          : t('Compte');

  let lignes: React.ReactNode[] = [];
  if (reglage === 'moteur') {
    lignes = lu.installed.map((e) => (
      <ChoixDeReglage
        key={e.id}
        actif={e.id === lu.engine?.id}
        moteurId={e.id}
        onChoisir={(evenement) => onChoisir({ engine: e.id as RunConfig['engine'] }, evenement)}
      >
        <span className="min-w-0 flex-1 truncate">{nomCourtMoteur(e)}</span>
        {e.version ? (
          <span className="shrink-0 text-[11px] text-faint">{e.version.replace(/[^\d.]/g, '').slice(0, 8)}</span>
        ) : null}
      </ChoixDeReglage>
    ));
  } else if (reglage === 'modele') {
    lignes = lu.models.length ? [<ListeDesModeles key="§modeles" lu={lu} onChoisir={onChoisir} />] : [];
  } else if (reglage === 'reflexion') {
    lignes = lu.thinkingOptions.map((niveau) => (
      <ChoixDeReglage
        key={niveau.id}
        actif={niveau.id === lu.thinking?.id}
        onChoisir={(evenement) => onChoisir({ thinking: niveau.id }, evenement)}
      >
        <span className="min-w-0 flex-1 truncate">{niveau.label}</span>
      </ChoixDeReglage>
    ));
  } else {
    lignes = [
      /* Repartir sur la répartition automatique — celle qui suit le quota
         disponible — plutôt que sur un compte figé. */
      <ChoixDeReglage key="§automatique" actif={!choix?.account} onChoisir={(evenement) => onChoisir({ account: undefined }, evenement)}>
        <span className="min-w-0 flex-1 truncate">{t('Automatique')}</span>
      </ChoixDeReglage>,
      ...lu.comptesDuMoteur.map((c) => (
        <ChoixDeReglage
          key={c.id}
          actif={c.id === choix?.account}
          onChoisir={(evenement) => onChoisir({ account: c.id }, evenement)}
        >
          <span className="min-w-0 flex-1 truncate">{c.label}</span>
        </ChoixDeReglage>
      )),
    ];
  }

  return (
    <div className="flex flex-col gap-0.5" data-selecteur-liste={reglage}>
      <DropdownMenuLabel>{titre}</DropdownMenuLabel>
      {reglage === 'modele' && lu.avertissementModele ? (
        <p data-repli="liste-de-secours" className="px-2 pb-1 text-[12px] leading-snug text-warning" role="note">
          {lu.avertissementModele}
        </p>
      ) : null}
      {lignes}
      {!lignes.length ? <p className="px-2 py-2 text-[13px] text-faint">{t('Rien à choisir pour ce réglage.')}</p> : null}
    </div>
  );
}

/**
 * LES MODÈLES DU MOTEUR, TOUS (carte « Branches et choix des modèles ») : une
 * recherche en tête, les dix plus récents, puis « Afficher plus » pour le
 * reste. Le modèle retenu reste visible même au-delà des dix
 * (`modelesAffiches`). La recherche garde la frappe pour elle : sans
 * `stopPropagation`, le menu prendrait chaque lettre pour un saut vers une
 * ligne. 16 px sur téléphone, sinon Safari zoome au focus.
 */
function ListeDesModeles({
  lu,
  onChoisir,
}: {
  lu: ReglagesLus;
  onChoisir: (patch: RunChoix, evenement: Event) => void;
}) {
  const [recherche, setRecherche] = React.useState('');
  const [tout, setTout] = React.useState(false);
  const { visibles, caches } = modelesAffiches(lu.models, { recherche, tout, choisi: lu.model?.id });
  return (
    <>
      {lu.models.length > MODELES_AFFICHES_D_ABORD ? (
        <div className="flex items-center gap-1.5 px-2 pb-1">
          <Search className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
          <input
            type="search"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            onKeyDown={(e) => {
              if (!['Escape', 'ArrowDown', 'ArrowUp', 'Tab'].includes(e.key)) e.stopPropagation();
            }}
            placeholder={t('Rechercher un modèle')}
            className="min-w-0 flex-1 bg-transparent py-1 text-[16px] text-text outline-none placeholder:text-faint sm:text-[13px]"
            data-recherche-modeles
            autoComplete="off"
          />
        </div>
      ) : null}
      {visibles.map((m) => {
        const note =
          m.note ??
          (m.releasedAt
            ? new Date(m.releasedAt).toLocaleDateString(formatRegional(), { month: '2-digit', year: '2-digit' })
            : undefined);
        return (
          <ChoixDeReglage
            key={m.id}
            actif={m.id === lu.model?.id}
            modeleId={m.id}
            onChoisir={(evenement) => onChoisir({ model: m.id }, evenement)}
          >
            {m.appetite ? <Appetite level={m.appetite} /> : null}
            <span className="min-w-0 flex-1 truncate">{m.label}</span>
            {note ? <span className="shrink-0 text-[11px] text-faint">{note}</span> : null}
          </ChoixDeReglage>
        );
      })}
      {recherche && !visibles.length ? (
        <p className="px-2 py-2 text-[13px] text-faint" data-aucun-modele>
          {t('Aucun modèle ne correspond.')}
        </p>
      ) : null}
      {caches > 0 ? (
        <DropdownMenuItem
          data-afficher-plus-modeles={caches}
          onSelect={(evenement) => {
            /* Le menu reste ouvert : on déplie la liste, on ne choisit rien. */
            evenement.preventDefault();
            setTout(true);
          }}
          className="gap-2 rounded-md px-2 py-1.5 text-[13px] text-faint data-[highlighted]:text-text"
        >
          <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="flex-1">{t('Afficher plus')}</span>
          <span className="shrink-0 text-[11px]">{caches}</span>
        </DropdownMenuItem>
      ) : null}
    </>
  );
}

/**
 * Un choix d'une liste : une entrée de menu (`role="menuitem"`). Le choix
 * RETENU s'écrit en violet avec sa coche et le dit à une machine (`data-actif`,
 * `aria-current`) — aucun trait autour.
 */
function ChoixDeReglage({
  actif,
  moteurId,
  modeleId,
  onChoisir,
  children,
}: {
  actif: boolean;
  moteurId?: string;
  modeleId?: string;
  onChoisir: (evenement: Event) => void;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenuItem
      data-moteur-id={moteurId}
      data-modele-id={modeleId}
      data-actif={actif ? '' : undefined}
      aria-current={actif ? 'true' : undefined}
      onSelect={onChoisir}
      className={cn(
        'gap-2 rounded-md px-2 py-1.5 text-[13px]',
        actif ? 'text-teinte' : 'text-muted data-[highlighted]:text-text',
      )}
    >
      {children}
      <Check className={cn('h-3.5 w-3.5 shrink-0 text-teinte', !actif && 'invisible')} aria-hidden />
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
