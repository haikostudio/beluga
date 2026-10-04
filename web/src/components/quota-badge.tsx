import * as React from 'react';
import { Check, ChevronDown, RefreshCw, Settings, TriangleAlert, X } from 'lucide-react';
import {
  AccountQuota,
  EngineId,
  compteDeSecours,
  fraicheurDuReleve,
  heureDeRemiseAZero,
  historiquePourProfil,
  niveauQuota,
  previsionEpuisement,
  profilHoraire,
  tempsRestant,
  trancheLaPlusChargee,
  moteurSansQuota,
  montantCursorEnClair,
  usageCursorEnClair,
  type AgregatHoraire,
  type CreditCursor,
  type PrevisionEpuisement,
  type ReleveQuota,
  type SerieQuota,
  compteEpuise,
  construireFragment,
} from '@beluga/shared';
import {
  BulleInfo,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Gauge,
  Switch,
  Tooltip,
} from '@/components/ui';
import { client } from '@/lib/client';
import { cn } from '@/lib/utils';
import { t, formatRegional } from '@/lib/langue';
import { detailDePrevision, texteDePrevision, texteDuManque } from '@/lib/prevision-quota';
import { useMinute } from '@/lib/horloge';
import { lancerIntervalleVisible } from '@/lib/veille';

/**
 * Le bouton de quota : DEUX ronds côte à côte — la fenêtre courte (5 h) à
 * gauche, la semaine à droite, chacun avec son propre chiffre — pour chaque
 * compte EN SERVICE à tour de rôle, toutes les 10 s, tous moteurs confondus.
 * Au clic, le détail de tous les comptes, fenêtre courte et semaine.
 */

/** Durée d'affichage d'un compte avant de passer au suivant. */
const DUREE_PAR_COMPTE_MS = 10_000;
/** Un rond, dans un carré de 24 (1 unité = 1 px). */
const ANNEAU_ROND = { r: 9, epaisseur: 3 };

function ring(pct: number, rayon: number): { color: string; dash: string } {
  const value = Math.max(0, Math.min(100, pct));
  const circumference = 2 * Math.PI * rayon;
  // Même règle que les barres des comptes : vert, jaune sous 30 % restants,
  // rouge sous 15 %. L'anneau et les barres virent donc ensemble.
  const niveau = niveauQuota(value);
  const color =
    niveau === 'critique' ? 'stroke-danger' : niveau === 'attention' ? 'stroke-warning' : 'stroke-success';
  return { color, dash: `${(value / 100) * circumference} ${circumference}` };
}

function Anneau({ pct, r, epaisseur, vide }: { pct: number; r: number; epaisseur: number; vide?: boolean }) {
  const { color, dash } = ring(pct, r);
  return (
    <>
      <circle cx="12" cy="12" r={r} className="fill-none stroke-border" strokeWidth={epaisseur} />
      {vide ? null : (
        <circle
          cx="12"
          cy="12"
          r={r}
          className={cn('fill-none transition-all duration-500', color)}
          strokeWidth={epaisseur}
          strokeLinecap="round"
          strokeDasharray={dash}
        />
      )}
    </>
  );
}

/** Un seul rond du badge, avec son propre chiffre centré. */
function RondQuota({ pct, vide, chiffre }: { pct: number; vide?: boolean; chiffre: string }) {
  return (
    <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
      <svg viewBox="0 0 24 24" className="absolute inset-0 -rotate-90">
        <Anneau pct={pct} vide={vide} {...ANNEAU_ROND} />
      </svg>
      <span className="relative text-[7px] font-medium leading-none tracking-tighter text-text">{chiffre}</span>
    </span>
  );
}

/** Le chiffre d'un rond Cursor : un tiret tant que le pourcentage n'est pas lisible, jamais un 0 inventé. */
function chiffreRond(pct?: number): string {
  return typeof pct === 'number' && Number.isFinite(pct) ? String(Math.round(pct)) : '—';
}

/**
 * Une courbe simple : la consommation du compte sur les derniers jours. Quand
 * une prévision existe, le trait de la semaine se prolonge en POINTILLÉ jusqu'à
 * la ligne du haut : on voit d'un coup d'œil où la pente conduit.
 */
function Courbe({
  points,
  prevision,
  showSession,
  showWeekly,
}: {
  points: { at: number; weekly: number; session: number }[];
  prevision?: PrevisionEpuisement | null;
  showSession: boolean;
  showWeekly: boolean;
}) {
  if ((!showSession && !showWeekly) || points.length < 2) return null;

  const largeur = 250;
  const hauteur = 30;
  const debut = points[0].at;
  const dernier = points[points.length - 1];
  // Le pointillé a besoin de place : la fin du graphique recule jusqu'à lui.
  const fin = Math.max(dernier.at, prevision?.at ?? 0);
  const x = (at: number) => ((at - debut) / Math.max(1, fin - debut)) * largeur;
  const y = (pct: number) => hauteur - (Math.min(100, pct) / 100) * hauteur;
  const trace = (cle: 'weekly' | 'session') =>
    points
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.at).toFixed(1)},${y(point[cle]).toFixed(1)}`)
      .join(' ');

  return (
    <div className="mt-1.5">
      <svg viewBox={`0 0 ${largeur} ${hauteur}`} className="h-[30px] w-full" preserveAspectRatio="none">
        {showSession ? (
          <path
            d={trace('session')}
            fill="none"
            stroke="hsl(var(--faint))"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {showWeekly ? (
          <path
            d={trace('weekly')}
            fill="none"
            stroke="hsl(var(--muted))"
            strokeWidth="1.4"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {prevision && showWeekly ? (
          <path
            /* Le pointillé suit la MÊME projection que le texte : quand les
               heures creuses sont mesurées, il s'aplatit la nuit et remonte le
               jour au lieu de filer tout droit. */
            d={[
              `M${x(dernier.at).toFixed(1)},${y(dernier.weekly).toFixed(1)}`,
              ...prevision.trajectoire
                .filter((point) => point.at >= dernier.at)
                .map((point) => `L${x(point.at).toFixed(1)},${y(point.pct).toFixed(1)}`),
              `L${x(prevision.at).toFixed(1)},${y(100).toFixed(1)}`,
            ].join(' ')}
            fill="none"
            stroke={prevision.niveau === 'manque' ? 'hsl(var(--warning))' : 'hsl(var(--faint))'}
            strokeWidth="1.4"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>
    </div>
  );
}

/**
 * LA LÉGENDE DE LA COURBE, pour la bulle « i » : elle explique, elle n'appelle
 * aucune réaction, elle n'a donc pas sa place sous le graphique.
 */
function legendeCourbe(
  points: { at: number }[],
  prevision: PrevisionEpuisement | null | undefined,
  showSession: boolean,
  showWeekly: boolean,
): string | null {
  if (!showSession && !showWeekly) return null;
  if (points.length < 2) return t('Pas encore assez de relevés pour tracer la courbe.');
  const jours = Math.max(1, Math.round((points[points.length - 1].at - points[0].at) / (24 * 3600 * 1000)));
  return [
    jours === 1 ? t('{jours} jour', { jours }) : t('{jours} jours', { jours }),
    showWeekly ? t(' · trait épais : la semaine') : '',
    showSession ? t(' · trait fin : la fenêtre courte') : '',
    prevision
      ? prevision.heuresCreuses
        ? t(' · pointillé : la suite, heures creuses comprises')
        : t(' · pointillé : la suite au rythme observé')
      : '',
  ].join('');
}

/**
 * La dépense Cursor à la demande dans le temps : un montant, pas un pourcentage.
 * L'échelle suit le plus haut relevé connu, jamais un plafond inventé.
 */
function CourbeCredit({ points }: { points: { at: number; credit?: number }[] }) {
  const utilisables = points.filter((point) => typeof point.credit === 'number');
  if (utilisables.length < 2) return null;

  const largeur = 250;
  const hauteur = 30;
  const debut = utilisables[0].at;
  const dernier = utilisables[utilisables.length - 1];
  const max = Math.max(...utilisables.map((point) => point.credit ?? 0), 1);
  const x = (at: number) => ((at - debut) / Math.max(1, dernier.at - debut)) * largeur;
  const y = (centimes: number) => hauteur - (Math.min(max, centimes) / max) * hauteur;
  const trace = utilisables
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.at).toFixed(1)},${y(point.credit ?? 0).toFixed(1)}`)
    .join(' ');

  return (
    <div className="mt-1.5">
      <svg viewBox={`0 0 ${largeur} ${hauteur}`} className="h-[30px] w-full" preserveAspectRatio="none">
        <path
          d={trace}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth="1.4"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

function legendeCourbeCredit(points: { at: number; credit?: number }[]): string | null {
  const utilisables = points.filter((point) => typeof point.credit === 'number');
  if (utilisables.length < 2) return null;
  const jours = Math.max(1, Math.round((utilisables[utilisables.length - 1].at - utilisables[0].at) / (24 * 3600 * 1000)));
  return t('{jours} jour{v0} · trait : la dépense relevée', { jours, v0: jours > 1 ? 's' : '' });
}

/**
 * Ce compte n'a AUCUNE fenêtre de pourcentage à jauger : moteur payé à la
 * dépense, ou ligne de suivi (Gemini, dont la fiche n'est pas active et que le
 * registre ne connaît donc pas).
 */
function sansFenetre(quota: AccountQuota): boolean {
  return moteurSansQuota(quota.engine) || Boolean(quota.suivi);
}

/**
 * CE QUE LA BULLE « i » D'UN COMPTE RACONTE : la légende de la courbe, le
 * moment le plus chargé, l'amorce réussie du serveur, le travail enregistré
 * ici. Rien de ce qui demande une réaction (alerte, erreur, prévision) : cela
 * reste sur la carte. Liste vide : le bouton ne s'affiche pas.
 */
function textesDAide(
  quota: AccountQuota,
  points: { at: number; credit?: number }[],
  releves: ReleveQuota[] | undefined,
  prevision: PrevisionEpuisement | null | undefined,
): string[] {
  const textes: (string | null | undefined)[] = [];
  if (sansFenetre(quota)) {
    textes.push(legendeCourbeCredit(points));
    if (quota.usageMesuree) {
      textes.push(t("Xiaomi ne publie pas le solde de l'abonnement : la barre du mois part du chiffre saisi dans Réglages › Comptes, puis ajoute ce que Beluga envoie. Elle est estimée : l'usage de la même clé hors Beluga n'est pas compté."));
    }
    if (quota.suivi) textes.push(t('Suivi seulement : ce moteur ne reçoit jamais de travail.'));
    textes.push(quota.usageLocal ? usageCursorEnClair(quota.usageLocal.seconds, quota.usageLocal.tours) : null);
  } else {
    textes.push(legendeCourbe(points, prevision, Boolean(quota.session), Boolean(quota.weekly)));
    textes.push(trancheLaPlusChargee(profilHoraire(releves ?? []))?.texte);
  }
  if (quota.derniereAmorce?.ok) {
    textes.push(t('fenêtre amorcée par le serveur à {v0}', { v0: heureCourte(quota.derniereAmorce.at) }));
  }
  return textes.filter((texte): texte is string => Boolean(texte));
}

export function QuotaBadge({ activeEngine }: { activeEngine: EngineId }) {
  const [open, setOpen] = React.useState(false);
  const state = client.lireEtat();
  // Les lignes de suivi (Gemini) ne vivent que dans ce volet : ailleurs, `state.quotas` ne porte que des comptes.
  const quotas = React.useMemo(() => [...state.quotas, ...state.quotasSuivi], [state.quotas, state.quotasSuivi]);
  /* Le bouton tourne pendant tout l'aller-retour, réussite comme échec : un
     `send` sans réponse ne le permettait pas, il faut le `call` qui attend
     la fin du relevé. */
  const [actualisation, setActualisation] = React.useState(false);
  const actualiser = React.useCallback(async () => {
    if (actualisation) return;
    setActualisation(true);
    try {
      await client.call({ type: 'quota.refresh' });
    } catch {
      // L'échec s'affiche déjà par ailleurs (compte en erreur) ; ici, seul le
      // voyant doit s'éteindre.
    } finally {
      setActualisation(false);
    }
  }, [actualisation]);
  const [histoire, setHistoire] = React.useState<
    Record<string, { at: number; session: number; weekly: number; credit?: number }[]>
  >({});
  /* Le résumé des semaines passées : il ne se voit pas, il ne sert qu'au profil
     des heures creuses de la prévision. */
  const [resume, setResume] = React.useState<Record<string, AgregatHoraire[]>>({});
  /* Les comptes dont on attend la réponse du serveur : leur interrupteur porte
     un voyant d'attente et n'accepte pas de second appui. */
  const [enAttente, setEnAttente] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (!open) return;
    client
      .call<{ history: typeof histoire; resume?: Record<string, AgregatHoraire[]> }>({
        type: 'quota.history',
        days: 7,
      })
      .then((data) => {
        setHistoire(data.history ?? {});
        setResume(data.resume ?? {});
      })
      .catch(() => {
        setHistoire({});
        setResume({});
      });
  }, [open]);

  /** Les relevés récents précédés du résumé lointain : la matière du profil. */
  const pourProfil = React.useCallback(
    (id: string) => historiquePourProfil(resume[id], histoire[id]),
    [histoire, resume],
  );

  /*
   * Les prévisions hebdomadaires de TOUS les comptes, calculées ensemble : le
   * compte de secours d'un moteur en manque se choisit parmi ceux qui, eux,
   * tiennent jusqu'à la remise à zéro.
   */
  const previsions = React.useMemo(() => {
    const out: Record<string, PrevisionEpuisement | null> = {};
    for (const quota of quotas) {
      out[quota.id] = quota.weekly ? previsionEpuisement(pourProfil(quota.id), quota.weekly) : null;
    }
    return out;
  }, [quotas, pourProfil]);

  const secoursDe = (quota: AccountQuota) =>
    compteDeSecours(
      { id: quota.id, engine: quota.engine },
      quotas.map((autre) => ({
        id: autre.id,
        label: autre.label,
        engine: autre.engine,
        disponible: autre.available !== false,
        // Un compte qui tient « de justesse » n'est pas un refuge : seuls
        // ceux sans aucune prévision de fin comptent.
        tientJusquAuBout: !previsions[autre.id],
        consommePct: autre.weekly?.usedPct ?? 0,
      })),
    );

  /*
   * Couper ou rallumer un compte se fait avec ACCUSÉ DE RÉCEPTION : un envoi
   * sans réponse laissait croire à un compte coupé qui continuait d'être
   * consommé. Le serveur répond `ok: false` quand le compte est introuvable ;
   * tout refus, comme toute panne de liaison, s'affiche en message court.
   */
  const basculerCompte = async (id: string, label: string, actif: boolean) => {
    setEnAttente((liste) => [...liste, id]);
    try {
      const reponse = await client.call<{ ok: boolean }>({ type: 'account.disable', id, disabled: !actif });
      if (!reponse?.ok) {
        client.pushToast('error', t('{label} : le serveur n\'a pas pu {v0} ce compte.', { label, v0: actif ? 'remettre en service' : 'couper' }));
      }
    } catch (err) {
      client.pushToast(
        'error',
        t('{label} : {raison}', { label, raison: err instanceof Error ? err.message : t('commande refusée') }),
      );
    } finally {
      // Le voyant s'éteint dans TOUS les cas : réussite, refus du serveur,
      // panne de liaison. Sans ce `finally`, un refus le laisserait tourner.
      setEnAttente((liste) => liste.filter((autre) => autre !== id));
    }
  };

  /*
   * Le bouton passe d'un compte EN SERVICE à l'autre (« en service » = pas
   * désactivé ; `active` marque seulement le compte en usage de son moteur).
   * Le défilement démarre sur le compte en usage du moteur de travail. Un
   * compte coupé ou rallumé en cours de route change la liste : l'indice est
   * ramené dans ses bornes par le modulo, rien ne casse.
   */
  const enService = quotas.filter((q) => !q.disabled && !q.suivi);
  const [rang, setRang] = React.useState(() => {
    const depart = enService.findIndex((q) => q.engine === activeEngine && q.active);
    return depart >= 0 ? depart : Math.max(0, enService.findIndex((q) => q.engine === activeEngine));
  });
  const defile = enService.length > 1;
  React.useEffect(() => {
    if (!defile) return;
    return lancerIntervalleVisible(() => setRang((valeur) => valeur + 1), DUREE_PAR_COMPTE_MS);
  }, [defile]);
  // Tous comptes coupés : on montre quand même le premier, plutôt qu'un bouton vide.
  const current = enService.length ? enService[rang % enService.length] : quotas[0];
  const cursorActif = current ? moteurSansQuota(current.engine) : false;
  /* Cursor a lui aussi deux jauges : les modèles Cursor à gauche, les autres
     modèles à droite — même disposition que la fenêtre 5 h / semaine. */
  const creditActif = cursorActif ? current?.credit : undefined;
  const session = cursorActif ? (creditActif?.cursorPct ?? 0) : (current?.session?.usedPct ?? 0);
  const semaine = cursorActif ? (creditActif?.autresPct ?? 0) : (current?.weekly?.usedPct ?? 0);
  const videGauche = cursorActif && creditActif?.cursorPct === undefined;
  const videDroite = cursorActif && creditActif?.autresPct === undefined;
  const chiffreGauche = cursorActif ? chiffreRond(creditActif?.cursorPct) : String(Math.round(session));
  const chiffreDroite = cursorActif ? chiffreRond(creditActif?.autresPct) : String(Math.round(semaine));

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-transparent px-2 text-[12.5px] text-muted transition-colors hover:bg-raised hover:text-text"
          title={t('Quotas des moteurs')}
          data-essai="badge-quota"
          data-compte={current?.id}
          data-session={Math.round(session)}
          data-semaine={Math.round(semaine)}
        >
          {/* Une part Cursor illisible laisse sa piste vide : jamais un 0 % inventé. */}
          <span className="flex shrink-0 items-center gap-1">
            <RondQuota pct={session} vide={videGauche} chiffre={chiffreGauche} />
            <RondQuota pct={semaine} vide={videDroite} chiffre={chiffreDroite} />
          </span>
          {/* Largeur FIXE : les noms défilent sans faire bouger la barre du haut. */}
          <span key={current?.id} className="hidden w-[86px] animate-fade-in truncate [animation-duration:500ms] sm:inline">
            {current?.label ?? 'quotas'}
          </span>
          <ChevronDown className="h-2.5 w-2.5 shrink-0" />
        </button>
      </DropdownMenuTrigger>

      {/* Sur grand écran, le panneau s'arrête à la hauteur disponible et
          défile : sinon sa dernière ligne (journal, roue des réglages) sortait
          de l'écran, hors d'atteinte. */}
      <DropdownMenuContent
        align="end"
        className="p-2 sm:max-h-[var(--radix-dropdown-menu-content-available-height)] sm:w-[310px]"
      >
        <div className="mb-1.5 flex items-center justify-between gap-1.5">
          <span className="text-[12px] uppercase tracking-wide text-faint">{t('Quotas')}</span>
          <DernierReleveReussi quotas={quotas} />
          <button
            onClick={actualiser}
            disabled={actualisation}
            className="shrink-0 rounded p-1 text-faint hover:bg-raised hover:text-text disabled:opacity-70"
            title={t('Actualiser')}
          >
            <RefreshCw className={cn('h-3 w-3', actualisation && 'animate-spin')} />
          </button>
        </div>

        {quotas.length ? (
          <div className="space-y-2">
            {quotas.map((quota) => {
              const aide = textesDAide(quota, histoire[quota.id] ?? [], pourProfil(quota.id), previsions[quota.id]);
              return (
              <div
                key={quota.id}
                // Chaque compte est une carte à part entière : bordure et fond
                // pour tous. Le compte qui sert est marqué par sa bordure, pas
                // par l'absence de carte chez les autres.
                className={cn(
                  'rounded-md border bg-raised px-2 py-1.5',
                  quota.disabled ? 'border-border opacity-60' : quota.active ? 'border-muted' : 'border-border',
                )}
              >
                {/* L'entête tient sur UNE rangée, en colonnes de largeur fixe :
                    le nom prend le reste et se tronque, puis le « i », la
                    pastille d'état et l'interrupteur tombent sur la même
                    verticale d'une carte à l'autre — même quand le « i » manque,
                    sa place reste réservée. Plus aucun badge texte pour pousser
                    la rangée sur deux lignes. */}
                <div className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">{quota.label}</span>
                  {/* Les explications du compte, rangées derrière un « i » : la
                      carte ne garde que ce qui se lit d'un coup d'œil. */}
                  <span className="flex w-5 shrink-0 justify-center">
                    {aide.length ? (
                      <BulleInfo label={t('Explications sur {v0}', { v0: quota.label })}>
                        <ul className="space-y-1" data-essai="bulle-quota" data-compte={quota.id}>
                          {aide.map((texte) => (
                            <li key={texte}>{texte}</li>
                          ))}
                        </ul>
                      </BulleInfo>
                    ) : null}
                  </span>
                  <PastilleEtatCompte quota={quota} />
                  {/* L'interrupteur coupe ou rallume le compte. Coupé, il n'est
                      plus choisi par l'ordonnanceur et sa fenêtre de 5 h n'est
                      plus amorcée ; il reste dans la liste, éteint. Une ligne de
                      SUIVI (Gemini) n'est pas un compte : sa place reste vide. */}
                  {quota.suivi ? <span className="h-5 w-9 shrink-0" aria-hidden /> : (
                  <Tooltip label={quota.disabled ? t('Compte désactivé — le remettre en service') : t('Désactiver ce compte')}>
                    <Switch
                      data-interrupteur-compte={quota.id}
                      attente={enAttente.includes(quota.id)}
                      checked={!quota.disabled}
                      onCheckedChange={(actif) => basculerCompte(quota.id, quota.label, actif)}
                      aria-label={quota.disabled ? t('Réactiver {v0}', { v0: quota.label }) : t('Désactiver {v0}', { v0: quota.label })}
                    />
                  </Tooltip>
                  )}
                </div>

                <div className="mt-1.5 space-y-1.5">
                  {sansFenetre(quota) ? (
                    <>
                      <UsageCursor credit={quota.credit} enErreur={Boolean(quota.error)} />
                      <UsageMesuree usage={quota.usageMesuree} />
                    </>
                  ) : (
                    <>
                      {quota.session ? (
                        <Window
                          label={libelleFenetre(quota.session, 'session')}
                          window={quota.session}
                          releves={histoire[quota.id]}
                          serie="session"
                        />
                      ) : null}
                      {quota.weekly ? (
                        <Window
                          label={libelleFenetre(quota.weekly, 'weekly')}
                          window={quota.weekly}
                          releves={pourProfil(quota.id)}
                          secours={secoursDe(quota)?.label}
                        />
                      ) : null}
                    </>
                  )}
                </div>

                {sansFenetre(quota) ? (
                  <CourbeCredit points={histoire[quota.id] ?? []} />
                ) : (
                  <Courbe
                    points={histoire[quota.id] ?? []}
                    prevision={previsions[quota.id]}
                    showSession={Boolean(quota.session)}
                    showWeekly={Boolean(quota.weekly)}
                  />
                )}

                <AlerteJumeaux jumeaux={quota.jumeaux} certains={quota.jumeauxCertains} />

                <AmorceRefusee amorce={quota.derniereAmorce} />

                {quota.error ? (
                  <ReleveAncien
                    erreur={quota.error}
                    fetchedAt={quota.fetchedAt}
                    aReconnecter={!quota.suivi && quota.connexion?.doitReconnecter}
                  />
                ) : null}
              </div>
              );
            })}
          </div>
        ) : (
          <p className="px-1 py-2 text-[13px] text-faint">{t('Aucun compte connecté.')}</p>
        )}

        <JournalDesAmorces ouvertMenu={open} onReglages={() => setOpen(false)} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * L'USAGE D'UN COMPTE CURSOR, comme sur son tableau de bord : le forfait, la
 * part consommée des modèles Cursor et des autres modèles, la remise à zéro,
 * puis la dépense à la demande rapportée à sa limite. Repris tel quel dans les
 * réglages (Comptes, Consommation) : les écrans ne se contredisent pas. Un
 * chiffre illisible ne s'affiche pas — ni jauge vide, ni zéro.
 */
export function UsageCursor({ credit, enErreur }: { credit?: CreditCursor; enErreur?: boolean }) {
  useMinute();

  const lisible =
    credit?.cursorPct !== undefined || credit?.autresPct !== undefined || credit?.demandeCentimes !== undefined;
  /* UN MOTEUR QUI NE PUBLIE AUCUN CHIFFRE (Xiaomi MiMo) : une ligne d'état,
     « clé active » ou « solde épuisé », jamais une jauge inventée. */
  if (credit?.resume && !lisible) {
    return (
      <p
        className={cn('text-[11.5px] leading-relaxed', credit.soldeEpuise ? 'text-danger' : 'text-faint')}
        data-essai="quota-depense"
      >
        {credit.resume}
      </p>
    );
  }
  if (!credit || !lisible) {
    if (!credit && enErreur) return null;
    return (
      <p className={cn('text-[11.5px] leading-relaxed', credit ? 'text-warning' : 'text-faint')} data-essai="quota-cursor">
        {credit ? (credit.indisponible ?? t("L'usage n'a pas pu être lu.")) : t('Lecture de l’usage…')}
      </p>
    );
  }

  const format = formatRegional();
  const restant = tempsRestant(credit.finDuCycle);
  const remise = credit.finDuCycle
    ? new Date(credit.finDuCycle).toLocaleDateString(format, { day: 'numeric', month: 'long' })
    : null;
  const limite = credit.demandeLimiteCentimes;

  return (
    <div className="space-y-1.5" data-essai="quota-cursor">
      {credit.forfait ? (
        <div className="flex items-baseline gap-1.5">
          <span className="text-[12px] text-faint">{t('Forfait')}</span>
          <span className="ml-auto text-[12px] text-text">
            {credit.prix ? `${credit.forfait} · ${credit.prix}` : credit.forfait}
          </span>
        </div>
      ) : null}
      {credit.cursorPct !== undefined ? (
        <Window label={t('Modèles Cursor')} window={{ usedPct: credit.cursorPct }} />
      ) : null}
      {credit.autresPct !== undefined ? (
        <Window label={t('Autres modèles')} window={{ usedPct: credit.autresPct }} />
      ) : null}
      {remise ? (
        <Tooltip label={heureDeRemiseAZero(credit.finDuCycle) ?? ''}>
          <p className="w-fit text-[11px] text-faint">
            {restant ? t('Remise à zéro le {v0} · {v1}', { v0: remise, v1: restant }) : t('Remise à zéro le {v0}', { v0: remise })}
          </p>
        </Tooltip>
      ) : null}
      {credit.demandeCentimes !== undefined ? (
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[12px] text-faint">{t('À la demande')}</span>
            <span className="ml-auto text-[12px] text-muted">
              {montantCursorEnClair(credit.demandeCentimes, format)}
              {limite ? ` / ${montantCursorEnClair(limite, format)}` : ''}
            </span>
          </div>
          {limite ? <Gauge value={(credit.demandeCentimes / limite) * 100} tone="quota" height="h-1" /> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * LA BARRE DU MOIS d'un abonnement Xiaomi MiMo, seule fenêtre qu'il ait. Xiaomi
 * ne publie pas le solde : le forfait vient des réglages du compte, plus ce que
 * Beluga a envoyé depuis — une ESTIMATION, et l'écran le dit. Sans plafond saisi :
 * une phrase qui dit quoi renseigner, jamais une jauge vide.
 */
function UsageMesuree({ usage }: { usage?: AccountQuota['usageMesuree'] }) {
  if (!usage) return null;
  if (!usage.mois) {
    return (
      <p className="text-[11.5px] leading-relaxed text-faint" data-essai="usage-mesure">
        {t('Aucun plafond mensuel saisi : renseignez-le dans Réglages › Comptes pour voir la barre du mois.')}
      </p>
    );
  }
  return (
    <div className="space-y-1.5" data-essai="usage-mesure">
      <Window label={libelleFenetre(usage.mois, 'weekly')} window={usage.mois} />
      <p className="text-[11px] text-faint">{t('Estimé · le forfait saisi, plus ce que Beluga a envoyé depuis')}</p>
    </div>
  );
}

/**
 * L'USAGE CURSOR EN UNE LIGNE DE CHIFFRES, pour les réglages : forfait, part des
 * modèles Cursor et des autres modèles, remise à zéro, dépense à la demande. Les
 * mêmes chiffres que les barres du volet — les écrans ne se contredisent pas —,
 * sans les barres. `null` quand rien n'est lisible : l'appelant garde alors
 * l'état du volet (lecture en cours, erreur).
 */
export function LigneChiffresCursor({ credit }: { credit?: CreditCursor }) {
  if (!credit) return null;
  const format = formatRegional();
  const morceaux: string[] = [];
  if (credit.forfait) morceaux.push(credit.prix ? `${credit.forfait} · ${credit.prix}` : credit.forfait);
  if (credit.cursorPct !== undefined) morceaux.push(`${t('Modèles Cursor')} ${Math.round(credit.cursorPct)} %`);
  if (credit.autresPct !== undefined) morceaux.push(`${t('Autres modèles')} ${Math.round(credit.autresPct)} %`);
  if (credit.finDuCycle) {
    morceaux.push(
      t('Remise à zéro le {v0}', {
        v0: new Date(credit.finDuCycle).toLocaleDateString(format, { day: 'numeric', month: 'long' }),
      }),
    );
  }
  if (credit.demandeCentimes !== undefined) {
    const limite = credit.demandeLimiteCentimes;
    morceaux.push(
      `${t('À la demande')} ${montantCursorEnClair(credit.demandeCentimes, format)}${limite ? ` / ${montantCursorEnClair(limite, format)}` : ''}`,
    );
  }
  if (!morceaux.length) return null;
  return (
    <p className="text-[11.5px] leading-relaxed text-faint" data-essai="quota-cursor-chiffres">
      {morceaux.join(' · ')}
    </p>
  );
}

function ReleveAncien({
  erreur,
  fetchedAt,
  aReconnecter,
}: {
  erreur: string;
  fetchedAt?: number;
  aReconnecter?: boolean;
}) {
  useMinute();
  const fraicheur = fraicheurDuReleve(fetchedAt);
  return (
    <div className="mt-1 text-[11.5px] text-warning">
      <p>{erreur}</p>
      {fraicheur ? <p>{t('Chiffres anciens — {fraicheur}', { fraicheur })}</p> : null}
      {/* UN COMPTE COUPÉ DOIT DIRE OÙ ON LE RÉTABLIT. Le volet annonçait la
          panne sans jamais nommer le geste qui la répare : la session se refait
          à la main, depuis les réglages, et nulle part ailleurs. */}
      {aReconnecter ? <p>{t('À reconnecter dans Réglages › Comptes.')}</p> : null}
    </div>
  );
}

/**
 * L'heure du dernier relevé réussi, tous comptes confondus : elle bouge à
 * chaque relevé, manuel ou automatique, puisqu'elle vient de `fetchedAt`, posé
 * par le serveur sur chaque compte lu sans erreur.
 */
function DernierReleveReussi({ quotas }: { quotas: AccountQuota[] }) {
  useMinute();

  const dernier = quotas.reduce<number | undefined>((plusRecent, quota) => {
    if (quota.error || !quota.fetchedAt) return plusRecent;
    return !plusRecent || quota.fetchedAt > plusRecent ? quota.fetchedAt : plusRecent;
  }, undefined);
  if (!dernier) return null;

  return (
    <span className="truncate text-[10.5px] text-faint" title={t('Dernier relevé réussi')}>
      {t('relevé {v0}', { v0: heureCourte(dernier) })}
    </span>
  );
}

/** L'heure du jour, sans la date : le journal ne remonte que de quelques jours. */
function heureCourte(at: number): string {
  const date = new Date(at);
  const aujourdhui = date.toDateString() === new Date().toDateString();
  const heure = date.toLocaleTimeString(formatRegional(), { hour: '2-digit', minute: '2-digit' });
  return aujourdhui ? heure : `${date.toLocaleDateString(formatRegional(), { day: '2-digit', month: '2-digit' })} ${heure}`;
}

/**
 * La preuve, sur le compte lui-même, que le serveur a lancé la fenêtre tout
 * seul : l'heure à laquelle il a posé son amorce.
 */
/**
 * L'ÉTAT D'UN COMPTE EN UNE PASTILLE : un rond de taille fixe, toujours à la
 * même place, dont la couleur et l'icône disent l'essentiel — coche verte (en
 * usage) ou grise (prêt), triangle orange (un geste à faire : reconnecter,
 * séparer deux coffres jumeaux), croix rouge (plus utilisable). Le détail vit
 * dans l'infobulle ; les phrases sous la carte restent pour le téléphone, où
 * rien ne survole. Ordre : désactivé, puis panne, puis alerte, puis bon état.
 */
function PastilleEtatCompte({ quota }: { quota: AccountQuota }) {
  const jumeaux = quota.jumeaux?.map((j) => j.label).join(', ');
  const etat: { cle: string; ton: 'eteint' | 'danger' | 'warning' | 'success' | 'pret'; texte: string } = quota.disabled
    ? { cle: 'desactive', ton: 'eteint', texte: t('Compte désactivé : il ne reçoit plus de travail.') }
    : compteEpuise(quota)
      ? { cle: 'epuise', ton: 'danger', texte: t('Quota épuisé : ce compte ne peut plus servir avant sa remise à zéro.') }
      : quota.suivi
        ? { cle: 'suivi', ton: 'pret', texte: t('Suivi seulement : ce moteur ne reçoit jamais de travail.') }
      : quota.connexion?.doitReconnecter
        ? {
            cle: 'reconnecter',
            ton: 'warning',
            texte: t('{v0} — à reconnecter dans Réglages › Comptes.', {
              v0: quota.connexion.libelle.charAt(0).toUpperCase() + quota.connexion.libelle.slice(1),
            }),
          }
        : jumeaux
          ? { cle: 'jumeaux', ton: 'warning', texte: t('Même abonnement que {v0}.', { v0: jumeaux }) }
          : quota.active
            ? { cle: 'actif', ton: 'success', texte: t('Compte actif : utilisé en ce moment.') }
            : { cle: 'pret', ton: 'pret', texte: t('Compte prêt, pas utilisé en ce moment.') };
  const Icone = etat.ton === 'danger' ? X : etat.ton === 'warning' ? TriangleAlert : Check;
  return (
    <Tooltip label={etat.texte}>
      <span
        role="img"
        aria-label={etat.texte}
        data-essai="etat-compte"
        data-etat={etat.cle}
        className={cn(
          'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full',
          etat.ton === 'success' && 'bg-success/15 text-success',
          etat.ton === 'warning' && 'bg-warning/15 text-warning',
          etat.ton === 'danger' && 'bg-danger/15 text-danger',
          etat.ton === 'pret' && 'bg-raised text-faint ring-1 ring-inset ring-faint/40',
          etat.ton === 'eteint' && 'text-faint ring-1 ring-inset ring-faint/40',
        )}
      >
        {etat.ton === 'eteint' ? null : <Icone className="h-2.5 w-2.5" strokeWidth={3} />}
      </span>
    </Tooltip>
  );
}

/**
 * DEUX COMPTES, UN SEUL ABONNEMENT — ET L'ÉCRAN LE DIT.
 *
 * Chaque compte est relevé avec le jeton de son propre coffre : deux jauges
 * identiques au pourcentage ET à la minute d'échéance près ne peuvent venir que
 * d'un même abonnement chez le fournisseur. Sans cette ligne, l'interface
 * montrait deux réserves là où il n'y en a qu'une, sans rien signaler.
 *
 * On DIT le constat, on ne propose aucun geste automatique : séparer deux
 * comptes demande une reconnexion, avec un code que seul l'utilisateur peut
 * recopier depuis les réglages.
 */
function AlerteJumeaux({ jumeaux, certains }: { jumeaux?: AccountQuota['jumeaux']; certains?: boolean }) {
  if (!jumeaux?.length) return null;
  const noms = jumeaux.map((autre) => autre.label).join(', ');
  // Le PROFIL des deux coffres a rendu le même compte : c'est un fait, on le
  // dit comme tel. Sans identité lue, la coïncidence des chiffres ne vaut
  // qu'une présomption, et la phrase le reste.
  return (
    <p className="mt-1 text-[11px] text-warning" data-comptes-jumeaux>
      {certains
        ? t('Même compte que {v0} : ces coffres sont branchés sur un seul abonnement. Pour les séparer, reconnectez-en un dans Réglages → Comptes.', { v0: noms })
        : t('Relevé identique à {v0} : ces comptes pointent le même abonnement. Pour les séparer, reconnectez-en un dans Réglages → Comptes.', { v0: noms })}
    </p>
  );
}

/**
 * Une amorce REFUSÉE reste sur la carte : elle appelle une réaction. L'amorce
 * réussie, simple preuve du travail de fond, est passée dans la bulle « i ».
 */
function AmorceRefusee({ amorce }: { amorce?: AccountQuota['derniereAmorce'] }) {
  if (!amorce || amorce.ok) return null;
  return (
    <p className="mt-1 text-[11px] text-warning">
      {t('amorce refusée à {v0}{v1}', { v0: heureCourte(amorce.at), v1: amorce.error ? ` (${amorce.error})` : '' })}
    </p>
  );
}

/**
 * Le journal complet, replié par défaut : il raconte le travail de fond, il ne
 * doit pas prendre la place des chiffres qu'on vient lire.
 */
function JournalDesAmorces({ ouvertMenu, onReglages }: { ouvertMenu: boolean; onReglages: () => void }) {
  const [ouvert, setOuvert] = React.useState(false);
  const [entrees, setEntrees] = React.useState<
    { account: string; at: number; ok: boolean; model?: string; error?: string }[]
  >([]);

  React.useEffect(() => {
    if (!ouvertMenu || !ouvert) return;
    client
      .call<{ entries: typeof entrees }>({ type: 'amorce.history', limit: 30 })
      .then((data) => setEntrees(data.entries ?? []))
      .catch(() => setEntrees([]));
  }, [ouvertMenu, ouvert]);

  const nom = (id: string) => client.lireEtat().quotas.find((q) => q.id === id)?.label ?? id;
  const libelleReglages = t('Réglages des comptes');

  return (
    <div className="mt-2 border-t border-border pt-1.5">
      {/* Le repli du journal à gauche, la roue des réglages des comptes à
          droite, sur la même ligne : le panneau finit sur le geste qui répare
          ce qu'il signale (reconnecter, ajouter, couper un compte). */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOuvert((valeur) => !valeur)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[12px] text-faint hover:text-text"
        >
          <ChevronDown className={cn('h-2.5 w-2.5 shrink-0 transition-transform', !ouvert && '-rotate-90')} />
          <span>{t('Journal des amorces')}</span>
        </button>
        <Tooltip label={libelleReglages}>
          <button
            type="button"
            data-essai="reglages-comptes"
            aria-label={libelleReglages}
            onClick={() => {
              onReglages();
              // Même chemin qu'un Précédent/Suivant : l'adresse commande l'écran.
              window.history.pushState(null, '', `#${construireFragment({ vue: 'reglages', page: 'comptes' })}`);
              window.dispatchEvent(new PopStateEvent('popstate'));
            }}
            className="shrink-0 rounded p-1 text-faint hover:bg-raised hover:text-text"
          >
            <Settings className="h-3 w-3" />
          </button>
        </Tooltip>
      </div>

      {ouvert ? (
        entrees.length ? (
          <ul className="mt-1 space-y-0.5">
            {entrees.map((entree) => (
              <li key={`${entree.account}-${entree.at}`} className="flex items-baseline gap-1.5 text-[11px]">
                <span className="shrink-0 text-faint">{heureCourte(entree.at)}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{nom(entree.account)}</span>
                <span className={cn('shrink-0', entree.ok ? 'text-faint' : 'text-warning')}>
                  {entree.ok ? 'ok' : (entree.error ?? 'refus')}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[11px] text-faint">{t('Aucune amorce enregistrée pour l’instant.')}</p>
        )
      ) : null}
    </div>
  );
}

function libelleFenetre(
  win: { durationSeconds?: number },
  type: 'session' | 'weekly',
): string {
  const secondes = win.durationSeconds;
  if (secondes === 5 * 60 * 60) return t('Fenêtre 5 h');
  if (secondes === 7 * 24 * 60 * 60) return 'Semaine';
  // Un forfait mensuel (MiMo) : de 28 à 31 jours selon le mois.
  if (secondes && secondes >= 28 * 24 * 3600 && secondes <= 31 * 24 * 3600) return t('Mois');
  if (secondes && secondes < 24 * 60 * 60) {
    const heures = secondes / 3600;
    return Number.isInteger(heures) ? t('Fenêtre {heures} h', { heures }) : t('Fenêtre courte');
  }
  if (secondes) {
    const jours = secondes / (24 * 3600);
    return Number.isInteger(jours) ? t('Fenêtre {jours} jours', { jours }) : t('Fenêtre longue');
  }
  return type === 'weekly' ? t('Fenêtre longue') : t('Fenêtre courte');
}

function Window({
  label,
  window: win,
  releves,
  serie = 'weekly',
  secours,
}: {
  label: string;
  window?: { usedPct?: number; resetsAt?: number; durationSeconds?: number };
  /** Les relevés du compte, d'où se tire la prévision d'épuisement. */
  releves?: ReleveQuota[];
  /** Laquelle des deux fenêtres ces relevés doivent servir. */
  serie?: SerieQuota;
  /** Le compte sur lequel basculer, s'il en existe un qui tienne. */
  secours?: string;
}) {
  const pct = win?.usedPct ?? 0;
  /*
   * Le temps restant vieillit tout seul : sans ce battement d'une minute, il
   * resterait figé sur la valeur du moment où le menu s'est ouvert.
   */
  useMinute();

  const restant = tempsRestant(win?.resetsAt);
  const exact = heureDeRemiseAZero(win?.resetsAt);
  // Rien à annoncer tant que le calcul n'a pas de sens : la fonction se tait
  // toute seule (trop peu de relevés, rythme nul, quota qui tient jusqu'au bout).
  const prevision = releves ? previsionEpuisement(releves, win, Date.now(), serie) : null;

  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[12px] text-faint">{label}</span>
        <span className="ml-auto text-[12px] text-muted">{Math.round(pct)} %</span>
      </div>
      <Gauge value={pct} tone="quota" height="h-1" />
      {restant ? (
        <Tooltip label={exact ?? ''}>
          <p className="mt-0.5 w-fit text-[11px] text-faint">{restant}</p>
        </Tooltip>
      ) : null}
      {prevision ? (
        // Orange quand le quota tombe nettement avant la fin de la semaine,
        // discret quand il tient presque jusqu'au bout. L'heure exacte et le
        // rythme observé restent en infobulle, comme pour le temps restant.
        <Tooltip label={detailDePrevision(prevision)}>
          <p
            className={cn(
              'mt-0.5 w-fit text-[11px]',
              prevision.niveau === 'manque' ? 'font-medium text-warning' : 'text-faint',
            )}
          >
            {texteDePrevision(prevision)} ({texteDuManque(prevision)})
          </p>
        </Tooltip>
      ) : null}
      {prevision?.niveau === 'manque' && secours ? (
        // La question qui suit « ça va manquer » est toujours « on bascule sur
        // quoi ? » : la réponse est posée juste dessous, du même moteur et
        // choisie parmi les comptes qui, eux, tiennent jusqu'au bout.
        <p className="mt-0.5 text-[11px] text-faint">{t('bascule possible sur {secours}', { secours })}</p>
      ) : null}
    </div>
  );
}
