import * as React from 'react';
import { Check, ChevronDown, Copy, ExternalLink, GitBranch, GitBranchPlus, Github, Loader2, PencilLine, Search } from 'lucide-react';
import {
  Card,
  PREFIXE_BRANCHE_DE_TACHE,
  brancheDeLaCarte,
  etapeDeLaBranche,
  type BranchesDeLaCarte,
  type GesteDeBranche,
  type ReponseGesteDeBranche,
  type SortDuTravail,
} from '@beluga/shared';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  ouvertureAuClic,
} from '@/components/ui';
import { client } from '@/lib/client';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * LE BOUTON DE BRANCHE, au bout du fil d'Ariane d'une tâche (demande de
 * l'utilisateur, « comme dans Conductor ») : il dit dans quelle branche la
 * tâche travaille, et son menu la gère — copier le nom, l'ouvrir sur GitHub,
 * la renommer, en créer une depuis un départ choisi, reprendre une branche
 * existante l'une après l'autre. Quand la tâche a déjà du travail, changer de
 * branche DEMANDE à chaque fois s'il faut le laisser ou l'emporter.
 *
 * En tête du menu, le PARCOURS vers la mise en ligne : la branche de la tâche,
 * la branche de déploiement, la production — l'étape courante en violet. La
 * destination ne se choisit pas : tout part avec le lot « À déployer ».
 *
 * Sur téléphone, seul le pictogramme reste dans le fil. Les règles vivent dans
 * `shared/src/gestion-de-branche.ts`, les gestes dans le démon
 * (`server/src/gestion-de-branche.ts`).
 */

type Mode = { genre: 'menu' } | { genre: 'renommer' } | { genre: 'creer' } | { genre: 'question'; geste: GesteDeBranche; nom: string; depart?: string };

/** Une saisie posée DANS un menu : la frappe reste à elle, Entrée valide. */
function ChampDuMenu({
  valeur,
  onChange,
  onValider,
  placeholder,
  repere,
  autoFocus,
}: {
  valeur: string;
  onChange: (v: string) => void;
  onValider?: () => void;
  placeholder: string;
  repere: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      type="text"
      value={valeur}
      autoFocus={autoFocus}
      autoComplete="off"
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onValider) {
          e.preventDefault();
          onValider();
        }
        if (!['Escape', 'ArrowDown', 'ArrowUp', 'Tab'].includes(e.key)) e.stopPropagation();
      }}
      placeholder={placeholder}
      className="min-w-0 flex-1 rounded-md bg-raised px-2 py-1.5 text-[16px] text-text outline-none placeholder:text-faint sm:text-[13px]"
      {...{ [repere]: '' }}
    />
  );
}

/** Le parcours de la branche : tâche → déploiement → production, l'étape courante en violet. */
function ParcoursDeLaBranche({ card, vue }: { card: Card; vue: BranchesDeLaCarte | null }) {
  const etape = etapeDeLaBranche(card);
  const crans = [
    { cle: 'branche', libelle: t('Tâche'), actif: etape !== 'deployee' },
    { cle: 'deploiement', libelle: vue?.deploiement ?? 'dev', actif: etape === 'deployee' },
    { cle: 'production', libelle: vue?.production ?? 'main', actif: false },
  ];
  const legende =
    etape === 'deployee'
      ? t('Fusionnée dans la branche de déploiement.')
      : etape === 'a-deployer'
        ? t('Part avec le prochain lot « À déployer ».')
        : t('Le travail avance sur cette branche.');
  return (
    <div className="px-2 pb-2 pt-1" data-parcours-de-branche={etape}>
      <div className="flex items-center gap-1.5">
        {crans.map((cran, index) => (
          <React.Fragment key={cran.cle}>
            {index ? <span className="h-px min-w-3 flex-1 bg-faint" aria-hidden /> : null}
            <span
              className={cn(
                'flex min-w-0 items-center gap-1 text-[12px]',
                cran.actif ? 'font-medium text-teinte' : 'text-faint',
              )}
              data-cran-de-parcours={cran.cle}
              data-actif={cran.actif ? '' : undefined}
            >
              <span className={cn('h-2 w-2 shrink-0 rounded-full', cran.actif ? 'bg-teinte' : 'bg-faint')} aria-hidden />
              <span className="truncate">{cran.libelle}</span>
            </span>
          </React.Fragment>
        ))}
      </div>
      <p className="mt-1.5 text-[12px] leading-snug text-faint">{legende}</p>
    </div>
  );
}

export function BoutonDeBranche({
  card,
  onVoirLaBranche,
}: {
  card: Card;
  /**
   * « VOIR LA BRANCHE » ouvre le suivi GitHub de la tâche (ses commits, ses
   * fusions, ses déploiements) : l'onglet « GitHub » a quitté la colonne de la
   * tâche pour ce menu (demande du 30/10/2026).
   */
  onVoirLaBranche?: () => void;
}) {
  const [ouvert, setOuvert] = React.useState(false);
  const [vue, setVue] = React.useState<BranchesDeLaCarte | null>(null);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<Mode>({ genre: 'menu' });
  const [saisie, setSaisie] = React.useState('');
  const [depart, setDepart] = React.useState<string | undefined>(undefined);
  const [recherche, setRecherche] = React.useState('');
  const [enCours, setEnCours] = React.useState<string | null>(null);
  const [copie, setCopie] = React.useState(false);
  const courante = brancheDeLaCarte(card);

  const charger = React.useCallback(() => {
    client
      .call<{ branches: BranchesDeLaCarte }>({ type: 'card.branches', cardId: card.id }, 30000)
      .then((res) => {
        setVue(res.branches);
        setErreur(null);
      })
      .catch((err: Error) => setErreur(err.message));
  }, [card.id]);

  /* La liste se relit à chaque ouverture, et quand la branche de la carte change. */
  React.useEffect(() => {
    if (ouvert) charger();
  }, [ouvert, courante, charger]);

  const ouvrir = (suivant: boolean) => {
    setOuvert(suivant);
    if (!suivant) {
      setMode({ genre: 'menu' });
      setRecherche('');
      setErreur(null);
    }
  };

  const agir = async (geste: GesteDeBranche, nom: string, options: { depart?: string; travail?: SortDuTravail } = {}) => {
    setEnCours(`${geste}:${nom}:${options.travail ?? ''}`);
    setErreur(null);
    try {
      const { reponse } = await client.call<{ reponse: ReponseGesteDeBranche }>(
        { type: 'card.branche', cardId: card.id, geste, nom, ...options },
        180000,
      );
      if (reponse.question === 'travail') {
        setMode({ genre: 'question', geste, nom, depart: options.depart });
        return;
      }
      if (!reponse.ok) {
        setErreur(reponse.message ?? t('Le geste n’a pas abouti.'));
        return;
      }
      client.pushToast('info', reponse.message ?? t('Branche mise à jour.'), card.id);
      ouvrir(false);
    } catch (err) {
      setErreur((err as Error).message);
    } finally {
      setEnCours(null);
    }
  };

  const verrou = vue?.verrou;
  const filtre = recherche.trim().toLowerCase();
  const branches = (vue?.branches ?? []).filter((b) => !filtre || b.nom.toLowerCase().includes(filtre));
  const departChoisi = depart ?? vue?.depart;
  const roue = <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />;

  let contenu: React.ReactNode;
  if (mode.genre === 'question') {
    const cle = (travail: SortDuTravail) => `${mode.geste}:${mode.nom}:${travail}`;
    contenu = (
      <div className="flex flex-col gap-1 px-1 pb-1" data-question-travail>
        <p className="px-1 pb-1 text-[13px] leading-snug text-text">
          {t('Cette tâche a déjà du travail sur « {branche} ». Que doit-il devenir ?', { branche: courante })}
        </p>
        <DropdownMenuItem
          data-travail="laisser"
          disabled={!!enCours}
          onSelect={(e) => {
            e.preventDefault();
            void agir(mode.geste, mode.nom, { depart: mode.depart, travail: 'laisser' });
          }}
          className="flex-col items-start gap-0.5 rounded-md px-2 py-1.5"
        >
          <span className="flex items-center gap-2 text-[13px] text-text">
            {enCours === cle('laisser') ? roue : null}
            {t('Le laisser sur l’ancienne branche')}
          </span>
          <span className="text-[12px] text-faint">{t('Enregistré tel quel ; la tâche repart sur la nouvelle branche.')}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          data-travail="emporter"
          disabled={!!enCours}
          onSelect={(e) => {
            e.preventDefault();
            void agir(mode.geste, mode.nom, { depart: mode.depart, travail: 'emporter' });
          }}
          className="flex-col items-start gap-0.5 rounded-md px-2 py-1.5"
        >
          <span className="flex items-center gap-2 text-[13px] text-text">
            {enCours === cle('emporter') ? roue : null}
            {t('L’emporter sur la nouvelle branche')}
          </span>
          <span className="text-[12px] text-faint">{t('Rejoué sur la nouvelle branche ; en cas de heurt, rien ne bouge.')}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            setMode({ genre: 'menu' });
          }}
          className="rounded-md px-2 py-1.5 text-[13px] text-faint"
        >
          {t('Annuler')}
        </DropdownMenuItem>
      </div>
    );
  } else if (mode.genre === 'renommer' || mode.genre === 'creer') {
    const creer = mode.genre === 'creer';
    const valider = () => {
      if (!saisie.trim() || enCours) return;
      void agir(creer ? 'creer' : 'renommer', saisie, creer ? { depart: departChoisi } : {});
    };
    contenu = (
      <div className="flex flex-col gap-1.5 px-1 pb-1" data-saisie-de-branche={mode.genre}>
        <DropdownMenuLabel>{creer ? t('Nouvelle branche') : t('Renommer la branche')}</DropdownMenuLabel>
        <div className="flex items-center gap-1 px-1">
          <span className="shrink-0 text-[13px] text-faint">{PREFIXE_BRANCHE_DE_TACHE}</span>
          <ChampDuMenu
            valeur={saisie}
            onChange={setSaisie}
            onValider={valider}
            placeholder={t('nom-de-la-branche')}
            repere="data-nom-de-branche"
            autoFocus
          />
        </div>
        {creer ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="rounded-md py-1.5 text-[13px]" data-depart-de-branche={departChoisi}>
              <span className="shrink-0 text-faint">{t('Départ')}</span>
              <span className="min-w-0 flex-1 truncate text-right text-text">{departChoisi}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-[200px] sm:max-w-[min(320px,calc(100vw-16px))]">
              <DropdownMenuLabel>{t('Partir de')}</DropdownMenuLabel>
              {(vue?.departs ?? []).map((nom) => (
                <DropdownMenuItem
                  key={nom}
                  data-choix-de-depart={nom}
                  onSelect={() => setDepart(nom)}
                  className={cn('gap-2 rounded-md px-2 py-1.5 text-[13px]', nom === departChoisi ? 'text-teinte' : 'text-muted')}
                >
                  <span className="min-w-0 flex-1 truncate">{nom}</span>
                  <Check className={cn('h-3.5 w-3.5 shrink-0', nom !== departChoisi && 'invisible')} aria-hidden />
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
        <div className="flex items-center justify-end gap-1 px-1 pt-0.5">
          <Button variant="ghost" size="sm" onClick={() => setMode({ genre: 'menu' })}>
            {t('Annuler')}
          </Button>
          <Button size="sm" className="gap-1.5" disabled={!saisie.trim() || !!enCours} onClick={valider} data-valider-branche>
            {enCours ? roue : null}
            {creer ? t('Créer') : t('Renommer')}
          </Button>
        </div>
      </div>
    );
  } else {
    contenu = (
      <>
        <DropdownMenuLabel>{t('Branche de la tâche')}</DropdownMenuLabel>
        <p className="truncate px-2 pb-1 font-mono text-[12px] text-text" title={courante} data-branche-courante>
          {courante}
        </p>
        <ParcoursDeLaBranche card={card} vue={vue} />
        {vue?.partagee.length ? (
          <p className="px-2 pb-1 text-[12px] text-faint" data-branche-partagee>
            {t('Partagée avec « {titre} »', { titre: vue.partagee.map((c) => c.titre).join(' », « ') })}
          </p>
        ) : null}
        {verrou ? (
          <p className="px-2 pb-1 text-[12px] leading-snug text-faint" data-verrou-de-branche>
            {verrou}
          </p>
        ) : null}
        <DropdownMenuSeparator />
        {onVoirLaBranche ? (
          <DropdownMenuItem
            data-voir-la-branche
            onSelect={() => onVoirLaBranche()}
            className="gap-2 rounded-md px-2 py-1.5 text-[13px]"
          >
            <Github className="h-3.5 w-3.5" />
            <span className="flex-1">{t('Voir la branche')}</span>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          data-copier-branche
          onSelect={(e) => {
            e.preventDefault();
            void navigator.clipboard?.writeText(courante).then(() => {
              setCopie(true);
              window.setTimeout(() => setCopie(false), 1500);
            });
          }}
          className="gap-2 rounded-md px-2 py-1.5 text-[13px]"
        >
          {copie ? <Check className="h-3.5 w-3.5 text-teinte" /> : <Copy className="h-3.5 w-3.5" />}
          <span className="flex-1">{copie ? t('Copié') : t('Copier le nom')}</span>
        </DropdownMenuItem>
        {vue?.urlGithub ? (
          <DropdownMenuItem
            data-github-branche
            onSelect={() => window.open(vue.urlGithub, '_blank', 'noopener')}
            className="gap-2 rounded-md px-2 py-1.5 text-[13px]"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span className="flex-1">{t('Ouvrir sur GitHub')}</span>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          data-renommer-branche
          disabled={!vue || !!verrou}
          onSelect={(e) => {
            e.preventDefault();
            setSaisie(courante.replace(/^tache\//, ''));
            setMode({ genre: 'renommer' });
          }}
          className="gap-2 rounded-md px-2 py-1.5 text-[13px]"
        >
          <PencilLine className="h-3.5 w-3.5" />
          <span className="flex-1">{t('Renommer')}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          data-nouvelle-branche
          disabled={!vue || !!verrou}
          onSelect={(e) => {
            e.preventDefault();
            setSaisie('');
            setDepart(undefined);
            setMode({ genre: 'creer' });
          }}
          className="gap-2 rounded-md px-2 py-1.5 text-[13px]"
        >
          <GitBranchPlus className="h-3.5 w-3.5" />
          <span className="flex-1">{t('Nouvelle branche…')}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t('Reprendre une branche')}</DropdownMenuLabel>
        {(vue?.branches.length ?? 0) > 6 ? (
          <div className="flex items-center gap-1.5 px-2 pb-1">
            <Search className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
            <ChampDuMenu valeur={recherche} onChange={setRecherche} placeholder={t('Rechercher une branche')} repere="data-recherche-branches" />
          </div>
        ) : null}
        {!vue && !erreur ? (
          <div className="flex flex-col gap-1.5 px-2 py-1" aria-hidden data-branches-en-chargement>
            {[70, 55, 62].map((l) => (
              <span key={l} className="h-3 animate-pulse rounded bg-raised" style={{ width: `${l}%` }} />
            ))}
          </div>
        ) : null}
        {vue && !branches.length ? (
          <p className="px-2 py-1.5 text-[12px] text-faint">
            {filtre ? t('Aucune branche ne correspond.') : t('Aucune autre branche de travail dans le dépôt.')}
          </p>
        ) : null}
        {branches.map((b) => {
          const grisee = !!b.occupee || !!verrou;
          return (
            <DropdownMenuItem
              key={b.nom}
              data-branche-proposee={b.nom}
              data-occupee={b.occupee ? '' : undefined}
              disabled={grisee || !!enCours}
              title={b.occupee ?? verrou ?? undefined}
              onSelect={(e) => {
                e.preventDefault();
                void agir('reprendre', b.nom);
              }}
              className="flex-col items-start gap-0 rounded-md px-2 py-1.5"
            >
              <span className="flex w-full min-w-0 items-center gap-2 text-[13px]">
                {enCours === `reprendre:${b.nom}:` ? roue : <GitBranch className="h-3.5 w-3.5 shrink-0 text-faint" />}
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{b.nom}</span>
                {b.distante ? <span className="shrink-0 text-[11px] text-faint">{t('GitHub')}</span> : null}
              </span>
              {b.occupee || b.cartes.length ? (
                <span className="w-full truncate pl-5 text-[11px] text-faint">
                  {b.occupee ?? b.cartes.map((c) => c.titre).join(', ')}
                </span>
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </>
    );
  }

  return (
    <DropdownMenu open={ouvert} onOpenChange={ouvrir}>
      <DropdownMenuTrigger asChild {...ouvertureAuClic(() => ouvrir(true))}>
        <button
          type="button"
          className="group/cran ml-0.5 flex min-w-0 shrink items-center gap-1 rounded-md px-2 sm:px-1.5 py-1.5 sm:py-1 text-[12px] text-faint transition-colors hover:bg-raised hover:text-text data-[state=open]:bg-raised data-[state=open]:text-text"
          title={courante}
          data-bouton-de-branche={courante}
        >
          <GitBranch className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="hidden min-w-0 max-w-[200px] truncate font-mono sm:block">{courante.replace(/^tache\//, '')}</span>
          <ChevronDown className="hidden h-3 w-3 shrink-0 sm:block" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        collisionPadding={8}
        className="min-w-[280px] sm:max-h-[min(560px,var(--radix-dropdown-menu-content-available-height))] sm:max-w-[min(360px,calc(100vw-16px))]"
        data-menu-de-branche
      >
        {contenu}
        {erreur ? (
          <p className="px-2 pb-1 pt-1.5 text-[12px] leading-snug text-danger" role="alert" data-erreur-de-branche>
            {erreur}
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
