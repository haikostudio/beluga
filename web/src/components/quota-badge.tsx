import * as React from 'react';
import { Check, ChevronDown, EllipsisVertical, ExternalLink, RefreshCw, Settings, TriangleAlert, X } from '@/components/ui/icones';
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
  descriptionMoteur,
  groupeQuotaReplie,
  groupesDeComptes,
  partConsommeeIa,
  niveauDuSolde,
  seuilDansLUnite,
  seuilDuServiceUsd,
  servicesIaEnAlerte,
  SEUIL_PAR_DEFAUT_USD,
  type SoldeDeServiceIa,
} from '@beluga/shared';
import {
  BulleInfo,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Gauge,
  Input,
  Switch,
  Tooltip,
} from '@/components/ui';
import { IconeMoteur } from '@/components/icone-moteur';
import { IconeServiceIa } from '@/components/icone-service-ia';
import { Silhouette } from '@/components/silhouettes';
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
            stroke="hsl(var(--teinte) / 0.45)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {showWeekly ? (
          <path
            d={trace('weekly')}
            fill="none"
            stroke="hsl(var(--teinte))"
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
            stroke={prevision.niveau === 'manque' ? 'hsl(var(--warning))' : 'hsl(var(--teinte) / 0.45)'}
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
          stroke="hsl(var(--teinte))"
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

/**
 * LE TÉMOIN DU MOTEUR. Deux tenues pour le même menu des quotas :
 *  - `pied` : la carte au bas de la colonne des projets — logo, « LLM en
 *    ligne » et son point de liaison, puis le compte qui défile et ses deux
 *    pourcentages consommés ; le détail se lit en ouvrant ;
 *  - `bande` : la même, réduite au logo, quand la colonne est repliée.
 */
export function QuotaBadge({
  activeEngine,
  variante = 'pied',
  liaison,
}: {
  activeEngine: EngineId;
  variante?: 'pied' | 'bande';
  /** L'état de la liaison avec le serveur : le point à côté de « LLM en ligne ». */
  liaison?: { classe: string; texte: string; enLigne: boolean };
}) {
  const [open, setOpen] = React.useState(false);
  const state = client.lireEtat();
  const reglages = state.settings;
  /* LES GROUPES REPLIÉS À LA MAIN : ceux des réglages (partagés entre appareils), puis les clics de cette page en
     attendant l'écho du démon — l'écran suit le clic tout de suite. */
  const [clicsDesGroupes, setClicsDesGroupes] = React.useState<Record<string, boolean>>({});
  const choixDesGroupes = React.useMemo(() => ({ ...(reglages?.groupesQuotaReplies ?? {}), ...clicsDesGroupes }), [reglages?.groupesQuotaReplies, clicsDesGroupes]);
  const basculerGroupe = (engine: string, replie: boolean) => {
    const suite = { ...choixDesGroupes, [engine]: replie };
    setClicsDesGroupes((avant) => ({ ...avant, [engine]: replie }));
    void client.call({ type: 'settings.update', patch: { groupesQuotaReplies: suite } }).catch(() => {
      setClicsDesGroupes((avant) => {
        const { [engine]: _oublie, ...reste } = avant;
        return reste;
      });
      client.pushToast('error', t('Réglage non enregistré'));
    });
  };
  /* LES SEUILS D'ALERTE DES SERVICES D'IA : ceux des réglages (partagés entre appareils), puis les choix faits ici en
     attendant l'écho du démon. `null` : revenu au seuil par défaut. */
  const [clicsDesSeuils, setClicsDesSeuils] = React.useState<Record<string, number | null>>({});
  const seuilsServices = React.useMemo(() => {
    const suite: Record<string, number> = { ...(reglages?.seuilsServicesIa ?? {}) };
    for (const [id, v] of Object.entries(clicsDesSeuils)) {
      if (v === null) delete suite[id];
      else suite[id] = v;
    }
    return suite;
  }, [reglages?.seuilsServicesIa, clicsDesSeuils]);
  const changerSeuil = (id: string, valeur: number | null) => {
    const suite = { ...seuilsServices };
    if (valeur === null) delete suite[id];
    else suite[id] = valeur;
    setClicsDesSeuils((avant) => ({ ...avant, [id]: valeur }));
    void client.call({ type: 'settings.update', patch: { seuilsServicesIa: suite } }).catch(() => {
      setClicsDesSeuils((avant) => {
        const { [id]: _oublie, ...reste } = avant;
        return reste;
      });
      client.pushToast('error', t('Réglage non enregistré'));
    });
  };
  /* LE POINT ORANGE DU PIED DE COLONNE : au moins un service d'IA sous son seuil ou à sec, d'après le dernier relevé
     poussé par le démon (tournée de 30 min) — sans ouvrir le volet. */
  const alertesServices = React.useMemo(
    () => servicesIaEnAlerte(state.servicesIa?.soldes ?? [], seuilsServices),
    [state.servicesIa, seuilsServices],
  );
  const texteAlerteServices = alertesServices.length
    ? t('Solde bas : {v0}', { v0: alertesServices.map((a) => a.solde.nom).join(', ') })
    : undefined;
  // Les lignes de suivi (Gemini) ne vivent que dans ce volet : ailleurs, `state.quotas` ne porte que des comptes.
  const quotas = React.useMemo(() => [...state.quotas, ...state.quotasSuivi], [state.quotas, state.quotasSuivi]);
  /* Le bouton tourne pendant tout l'aller-retour, réussite comme échec : un
     `send` sans réponse ne le permettait pas, il faut le `call` qui attend
     la fin du relevé. */
  const [actualisation, setActualisation] = React.useState(false);
  /* Chaque appui sur « Actualiser » relit AUSSI les soldes des services d'IA, sans attendre les cinq minutes. */
  const [relectureServices, setRelectureServices] = React.useState(0);
  const actualiser = React.useCallback(async () => {
    if (actualisation) return;
    setActualisation(true);
    setRelectureServices((n) => n + 1);
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
  /* Le défilement se tient tant que la souris est sur le bouton : l'infobulle
     nomme le compte affiché, elle ne doit pas parler d'un autre dix secondes
     plus tard. */
  const [survole, setSurvole] = React.useState(false);
  const defile = enService.length > 1 && !survole;
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
  /*
   * LES POURCENTAGES DU COMPTE AFFICHÉ, lus au pied de la colonne pendant que
   * les comptes défilent (demande du 11/10/2026 : « affiche les pourcentages de
   * chaque LLM dans cette partie lorsqu'elle tourne »). Les deux mêmes parts
   * consommées que dans le menu : fenêtre courte puis semaine ; pour Cursor,
   * ses modèles puis les autres. UNE PART QUI N'A PAS PU ÊTRE LUE NE S'ÉCRIT
   * PAS — jamais un « 0 % » inventé. Ce sont des parts de quota, pas des
   * compteurs de jetons.
   */
  const pourcents: { chiffre: string; nom: string }[] = [];
  if (cursorActif) {
    if (!videGauche) pourcents.push({ chiffre: chiffreGauche, nom: t('Modèles Cursor') });
    if (!videDroite) pourcents.push({ chiffre: chiffreDroite, nom: t('Autres modèles') });
    // Un forfait au mois (MiMo) : sa seule part est celle du mois.
    const mois = current?.usageMesuree?.mois;
    if (typeof mois?.usedPct === 'number') pourcents.push({ chiffre: chiffreRond(mois.usedPct), nom: libelleFenetre(mois, 'weekly') });
  } else {
    if (current?.session) pourcents.push({ chiffre: chiffreGauche, nom: libelleFenetre(current.session, 'session') });
    if (current?.weekly) pourcents.push({ chiffre: chiffreDroite, nom: libelleFenetre(current.weekly, 'weekly') });
  }
  /*
   * LE CHIFFRE DE LA COLONNE REPLIÉE (demande du 26/10/2026) : sous le logo, la
   * SEULE part de la fenêtre courte (5 h) du compte qui défile — jamais la
   * semaine. Cursor et MiMo n'ont pas de fenêtre courte : leur première part
   * lue la remplace. Rien de lu, rien d'écrit.
   */
  const chiffreBande = cursorActif ? pourcents[0]?.chiffre : current?.session ? chiffreGauche : undefined;
  const pourcentsEnClair = pourcents.map(({ chiffre, nom }) => `${nom} ${chiffre} %`).join(' · ');

  /* La carte dépliée au toucher : sans survol, c'est le seul geste qui montre son graphique. */
  const [carteDepliee, setCarteDepliee] = React.useState<string | null>(null);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        {/* LE LOGO DU MOTEUR REMPLACE LE NOM DU COMPTE : le bouton tient en une
            icône et deux ronds. Le NOM se lit au survol, dans la bulle maison
            que la couche des infobulles tire de `title` — deux comptes Claude
            ont le même logo, et seul le nom les distingue. Pas de `Tooltip`
            Radix ici : imbriqué dans le déclencheur du menu, il se disputait
            le même bouton. */}
        <button
          className={cn(
            'flex min-w-0 items-center rounded-lg text-left transition-colors hover:bg-raised',
            variante === 'bande' ? 'relative h-[43px] sm:h-9 w-[43px] sm:w-9 flex-col justify-center gap-0.5' : 'h-11 flex-1 gap-2.5 px-2.5',
          )}
          title={[liaison?.texte, current?.label ?? t('Quotas des moteurs'), pourcentsEnClair, texteAlerteServices].filter(Boolean).join(' · ')}
          aria-label={current?.label ? `${t('Quotas des moteurs')} · ${current.label}` : t('Quotas des moteurs')}
          onMouseEnter={() => setSurvole(true)}
          onMouseLeave={() => setSurvole(false)}
          data-essai="badge-quota"
          /* PLUS DE PORTEFEUILLE À CÔTÉ DU POINT (15/11/2026, capture #48db6, demande de l'utilisateur) : le solde bas
             d'un service de création ne se lit plus que dans la bulle de la ligne (`title`, ci-dessus) et dans le
             volet des quotas. Le repère reste porté par la ligne, pour les contrôles. */
          data-alerte-services-ia={texteAlerteServices ? alertesServices.map((a) => a.solde.id).join(' ') : undefined}
          data-compte={current?.id}
          data-session={Math.round(session)}
          data-semaine={Math.round(semaine)}
        >
          {current ? (
            <span key={current.id} data-logo-badge={current.engine} className="flex shrink-0 animate-fade-in [animation-duration:500ms]">
              <IconeMoteur engine={current.engine} className={cn('shrink-0', variante === 'bande' ? 'h-4 w-4' : 'h-5 w-5')} />
            </span>
          ) : null}
          {variante === 'bande' ? (
            <>
              {current && chiffreBande !== undefined ? (
                <span
                  key={`pourcent-${current.id}`}
                  data-pourcent-bande={current.id}
                  className="whitespace-nowrap text-[10px] font-medium leading-none tabular-nums text-muted animate-fade-in [animation-duration:500ms]"
                >
                  {chiffreBande} %
                </span>
              ) : null}
              {liaison ? (
                <span data-point-etat className={cn('absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full', liaison.classe)} />
              ) : null}
              {texteAlerteServices ? (
                <span data-alerte-services-ia={alertesServices.map((a) => a.solde.id).join(' ')} className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-warning" />
              ) : null}
            </>
          ) : (
            <>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[13.5px] font-medium leading-tight text-text">
                  <span className="truncate">{liaison && !liaison.enLigne ? t('Reconnexion…') : t('LLM en ligne')}</span>
                  {liaison ? <span data-point-etat className={cn('h-1.5 w-1.5 shrink-0 rounded-full', liaison.classe)} /> : null}
                </span>
                {/* Le compte qui défile, puis ses pourcentages : c'est le nom
                    qui se tronque, jamais les chiffres. La ligne garde sa
                    hauteur, avec ou sans chiffres. */}
                <span className="flex items-baseline gap-1.5 text-[12px] leading-tight text-faint">
                  <span className="min-w-0 truncate">{current?.label ?? t('Quotas des moteurs')}</span>
                  {pourcents.length ? (
                    <span
                      key={current?.id}
                      data-pourcents-du-compte={current?.id}
                      className="shrink-0 animate-fade-in tabular-nums text-muted [animation-duration:500ms]"
                    >
                      {pourcents.map(({ chiffre }) => `${chiffre} %`).join(' · ')}
                    </span>
                  ) : null}
                </span>
              </span>
            </>
          )}
        </button>
      </DropdownMenuTrigger>

      {/* Sur grand écran, le panneau s'arrête à la hauteur disponible et
          défile : sinon sa dernière ligne (journal, roue des réglages) sortait
          de l'écran, hors d'atteinte. */}
      <DropdownMenuContent
        align="start"
        className="p-2 sm:max-h-[var(--radix-dropdown-menu-content-available-height)] sm:w-[310px]"
      >
        <div className="mb-1.5 flex items-center justify-between gap-1.5">
          <span className="text-[12px] uppercase tracking-wide text-faint">{t('Quotas')}</span>
          <DernierReleveReussi quotas={quotas} />
          <button
            onClick={actualiser}
            disabled={actualisation}
            className="shrink-0 rounded p-1.5 sm:p-1 text-faint hover:bg-raised hover:text-text disabled:opacity-70"
            title={t('Actualiser')}
          >
            <RefreshCw className={cn('h-3 w-3', actualisation && 'animate-spin')} />
          </button>
        </div>

        {quotas.length ? (
          /* RANGÉS PAR MOTEUR, COMME DANS LES RÉGLAGES DES COMPTES (carte du 05/11/2026, capture #8527) : un titre par
             moteur — logo, nom, nombre de comptes — qui replie ou déplie son groupe d'un clic. Replié, le groupe ne
             tient plus qu'en sa ligne de titre. Un moteur dont aucun compte ne sert est replié d'office ; le choix de
             l'utilisateur l'emporte ensuite, retenu dans les réglages, donc sur TOUS ses appareils
             (`groupeQuotaReplie`). Le titre est un simple bouton : il ne referme pas le menu. */
          <div className="space-y-1" data-groupes-quota>
            {groupesDeComptes(quotas, reglages?.ordreDesMoteurs).map((groupe) => {
              const replie = groupeQuotaReplie(groupe, choixDesGroupes);
              const nom = descriptionMoteur(groupe.engine)?.nomCourt ?? groupe.comptes[0]?.label ?? groupe.engine;
              return (
            <section key={groupe.engine} data-groupe-quota={groupe.engine} data-replie={replie || undefined}>
              <button
                type="button"
                aria-expanded={!replie}
                onClick={() => basculerGroupe(groupe.engine, !replie)}
                className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-raised"
                title={replie ? t('Déplier {v0}', { v0: nom }) : t('Replier {v0}', { v0: nom })}
                data-titre-groupe-quota={groupe.engine}
              >
                <ChevronDown className={cn('h-3 w-3 shrink-0 text-faint transition-transform', replie && '-rotate-90')} />
                <IconeMoteur engine={groupe.engine as EngineId} className="h-3.5 w-3.5" />
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-text">{nom}</span>
                <span className="shrink-0 text-[11.5px] tabular-nums text-faint">{groupe.comptes.length}</span>
              </button>
              {replie ? null : (
            <div className="mt-1 space-y-1.5 pb-1">
            {groupe.comptes.map((quota) => {
              const aide = textesDAide(quota, histoire[quota.id] ?? [], pourProfil(quota.id), previsions[quota.id]);
              return (
              <div
                key={quota.id}
                data-carte-quota={quota.id}
                data-moteur={quota.engine}
                /* AU TOUCHER, la carte déplie son graphique : ni l'interrupteur ni la
                   bulle « i », qui ont leur propre geste, ne le déclenchent. */
                onClick={(event) => {
                  if ((event.target as Element).closest('button, a, [role="switch"]')) return;
                  setCarteDepliee((avant) => (avant === quota.id ? null : quota.id));
                }}
                data-depliee={carteDepliee === quota.id || undefined}
                // Chaque compte est une carte à part entière : bordure et fond
                // pour tous. Le compte qui sert est marqué par sa bordure, pas
                // par l'absence de carte chez les autres.
                className={cn(
                  'group/carte-quota rounded-md border bg-raised px-2 py-1',
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
                  {/* Le logo du moteur ouvre la rangée : on lit la marque avant
                      le nom. Il ne rétrécit pas, c'est le nom qui se tronque. */}
                  <IconeMoteur engine={quota.engine} className="h-3.5 w-3.5" />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-text" data-nom-compte={quota.id}>{quota.label}</span>
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

                <div className="mt-1 space-y-1">
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

                <AlerteJumeaux jumeaux={quota.jumeaux} certains={quota.jumeauxCertains} />

                <AmorceRefusee amorce={quota.derniereAmorce} />

                {/* LE GRAPHIQUE ET LE TEXTE QUI LE SUIT, repliés au repos : ils s'ouvrent
                    au survol de la carte, au clavier, ou au toucher (`carteDepliee`). */}
                <div
                  data-detail-du-compte={quota.id}
                  className={cn(
                    'grid grid-rows-[0fr] transition-[grid-template-rows] duration-150 ease-out motion-reduce:transition-none',
                    'survol:group-hover/carte-quota:grid-rows-[1fr] group-has-[:focus-visible]/carte-quota:grid-rows-[1fr]',
                    carteDepliee === quota.id && 'grid-rows-[1fr]',
                  )}
                >
                  <div className="min-h-0 overflow-hidden">
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
                    <ProchainReveil creneau={quota.creneau} />
                  </div>
                </div>

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
              )}
            </section>
              );
            })}
          </div>
        ) : (
          <p className="px-1 py-2 text-[13px] text-faint">{t('Aucun compte connecté.')}</p>
        )}

        <ServicesIa
          ouvertMenu={open}
          relecture={relectureServices}
          pousse={state.servicesIa}
          seuils={seuilsServices}
          onSeuil={changerSeuil}
        />

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
    <div className="mt-1 text-[11.5px] text-danger">
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
 * LE CRÉNEAU DE RÉVEIL, en une ligne discrète sous la jauge : les comptes
 * Claude se calent sur le prioritaire, à parts égales de la fenêtre de 5 h.
 * Le repère lui-même n'en porte pas — c'est sur lui que les autres se règlent.
 */
function ProchainReveil({ creneau }: { creneau?: AccountQuota['creneau'] }) {
  if (!creneau || creneau.rang === 0 || !creneau.prochainReveil) return null;
  const minutes = Math.round(creneau.decalageMs / 60_000);
  const ecart = `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
  // La fenêtre en cours a perdu son créneau : on le dit, avec l'heure du recalage.
  if (creneau.horsCreneau) {
    const v = {
      v0: creneau.repere,
      v1: heureCourte(creneau.horsCreneau.finFenetre),
      v2: heureCourte(creneau.prochainReveil),
      v3: ecart,
    };
    return (
      <p className="mt-1 text-[11px] text-faint" data-prochain-reveil data-hors-creneau>
        {creneau.horsCreneau.alignee
          ? t("Fenêtre alignée sur {v0} jusqu'à {v1} · au repos ensuite, réveil à {v2} pour reprendre {v3} d'écart", v)
          : t("Fenêtre hors créneau jusqu'à {v1} · au repos ensuite, réveil à {v2} pour reprendre {v3} d'écart avec {v0}", v)}
      </p>
    );
  }
  return (
    <p className="mt-1 text-[11px] text-faint" data-prochain-reveil>
      {t('Prochain réveil {v0} · {v1} après {v2}', {
        v0: heureCourte(creneau.prochainReveil),
        v1: ecart,
        v2: creneau.repere,
      })}
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
/**
 * LES SERVICES D'IA CONNECTÉS (carte « Quotas des services d'IA », 08/11/2026) : sous les moteurs, un bloc
 * par COMPTE de service repéré dans le coffre (OpenRouter, kie.ai, HeyGen, Agentik, Groq, API Gemini) — son
 * logo, son solde restant et consommé quand le service le publie, « solde non communiqué » sinon, et un lien
 * vers sa page de facturation.
 *
 * LE SEUIL : sous 2 $ (ou le seuil choisi dans le menu à trois points du bloc, partagé entre appareils), le
 * restant passe en ORANGE ; à zéro, le bloc dit « À sec » (et le démon notifie, une fois). Un service qu'on
 * n'a pas su lire n'est jamais dit bas ni à sec (`niveauDuSolde`).
 *
 * LES DONNÉES : le relevé poussé par le démon (tournée de 30 min, `state.servicesIa`) ; l'ouverture du volet
 * le redemande (cache serveur de 5 min) et « Actualiser » le force. Le plus récent des deux s'affiche.
 */
function montantIa(valeur: number, unite: SoldeDeServiceIa['unite']): string {
  // Les dollars s'écrivent comme la dépense Cursor juste au-dessus (« 4,48 $ ») : un seul style dans le volet.
  if (unite === 'usd') return montantCursorEnClair(Math.round(valeur * 100), formatRegional());
  return t('{v0} crédits', { v0: new Intl.NumberFormat(formatRegional(), { maximumFractionDigits: 1 }).format(valeur) });
}

type ReleveIa = { soldes: SoldeDeServiceIa[]; releveLe: number };

function ServicesIa({
  ouvertMenu,
  relecture,
  pousse,
  seuils,
  onSeuil,
}: {
  ouvertMenu: boolean;
  relecture: number;
  /** Le dernier relevé poussé par le démon, `null` tant qu'il n'y en a pas eu. */
  pousse: ReleveIa | null;
  seuils: Record<string, number>;
  onSeuil: (id: string, valeurUsd: number | null) => void;
}) {
  const [repondu, setRepondu] = React.useState<ReleveIa | null>(null);
  const [panne, setPanne] = React.useState(false);
  // Seul un NOUVEL appui sur « Actualiser » force la relecture ; rouvrir le volet se contente du relevé gardé.
  const derniereRelecture = React.useRef(relecture);

  React.useEffect(() => {
    if (!ouvertMenu) return;
    let vivant = true;
    const forcer = relecture !== derniereRelecture.current;
    derniereRelecture.current = relecture;
    client
      .call<{ soldes: SoldeDeServiceIa[]; releveLe: number }>({ type: 'servicesIa.releve', force: forcer })
      .then((data) => {
        if (!vivant) return;
        setRepondu({ soldes: data.soldes ?? [], releveLe: data.releveLe ?? Date.now() });
        setPanne(false);
      })
      .catch(() => {
        if (vivant) setPanne(true);
      });
    return () => {
      vivant = false;
    };
  }, [ouvertMenu, relecture]);

  const releve = !pousse ? repondu : !repondu ? pousse : repondu.releveLe > pousse.releveLe ? repondu : pousse;
  const soldes = releve?.soldes ?? null;

  // Aucun service d'IA au coffre : la section ne prend aucune place.
  if (soldes && !soldes.length) return null;

  return (
    <section className="mt-2 pt-1" data-services-ia>
      <p className="mb-1 px-1.5 text-[12px] uppercase tracking-wide text-faint">{t('Services d’IA')}</p>
      {!soldes ? (
        panne ? (
          <p className="px-1.5 text-[12px] text-faint">{t('Soldes des services indisponibles pour le moment.')}</p>
        ) : (
          <div className="space-y-1.5" aria-busy data-silhouette="services-ia">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-md bg-raised px-2 py-1.5">
                <Silhouette className="h-3 w-2/5" />
                <Silhouette className="mt-1.5 h-2.5 w-3/5" />
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="space-y-1.5">
          {soldes.map((solde) => (
            <BlocServiceIa key={solde.id} solde={solde} seuils={seuils} onSeuil={onSeuil} />
          ))}
        </div>
      )}
    </section>
  );
}

function BlocServiceIa({
  solde,
  seuils,
  onSeuil,
}: {
  solde: SoldeDeServiceIa;
  seuils: Record<string, number>;
  onSeuil: (id: string, valeurUsd: number | null) => void;
}) {
  const part = partConsommeeIa(solde);
  const niveau = niveauDuSolde(solde, seuils);
  const seuilUsd = seuilDuServiceUsd(solde.id, seuils);
  const enAlerte = niveau === 'bas' || niveau === 'vide';
  return (
    <div
      data-service-ia={solde.id}
      data-etat={solde.etat}
      data-niveau={niveau ?? undefined}
      className="rounded-md border border-border bg-raised px-2 py-1"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <IconeServiceIa id={solde.id} />
        <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">{solde.nom}</span>
        {/* L'ÉTAT DIT EN MOTS : la palette est monochrome (`--warning` = texte fort), la couleur seule ne suffirait pas. */}
        {enAlerte ? (
          <span data-alerte-niveau={niveau} className="shrink-0 text-[11.5px] font-medium text-warning">
            {niveau === 'vide' ? t('À sec') : t('Solde bas')}
          </span>
        ) : null}
        <Tooltip label={t('Ouvrir la facturation de {v0} dans un nouvel onglet', { v0: solde.nom })}>
          <a
            href={solde.lien}
            target="_blank"
            rel="noopener noreferrer"
            data-lien-service-ia={solde.id}
            className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] text-faint transition-colors hover:bg-surface hover:text-text"
          >
            {t('Ouvrir')}
            <ExternalLink className="h-3 w-3" />
          </a>
        </Tooltip>
        {niveau !== null ? <MenuDuSeuil solde={solde} seuilUsd={seuilUsd} personnalise={solde.id in seuils} onSeuil={onSeuil} /> : null}
      </div>
      <div className="mt-0.5 pb-0.5">
        {solde.etat === 'ok' ? (
          <>
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[12px]">
              {solde.restant !== undefined ? (
                <span
                  className="text-muted"
                  title={enAlerte ? t('Sous le seuil de {v0}', { v0: montantIa(seuilDansLUnite(solde.unite, seuilUsd), solde.unite) }) : undefined}
                >
                  {t('Restant')}{' '}
                  <span data-restant-service-ia className={cn('tabular-nums', enAlerte ? 'font-medium text-warning' : 'text-text')}>
                    {montantIa(solde.restant, solde.unite)}
                  </span>
                </span>
              ) : null}
              {solde.consomme !== undefined ? (
                <span className="text-faint">
                  {t('Consommé')} <span className="tabular-nums">{montantIa(solde.consomme, solde.unite)}</span>
                </span>
              ) : null}
              {part !== undefined ? <span className="ml-auto shrink-0 text-muted">{Math.round(part)} %</span> : null}
            </div>
            {part !== undefined ? <Gauge value={part} tone="quota" height="h-1" /> : null}
          </>
        ) : solde.etat === 'non-communique' ? (
          <p className="text-[11.5px] text-faint">{t('Solde non communiqué par ce service')}</p>
        ) : (
          <p className="text-[11.5px] text-danger">{solde.raison ?? t('Relevé impossible')}</p>
        )}
      </div>
    </div>
  );
}

/** Lit un montant tapé à la française ou à l'anglaise (« 2,5 », « 2.5 », « 2 $ ») ; `null` s'il n'en est pas un. */
function montantSaisi(texte: string): number | null {
  const net = texte.replace(/[\s$€]/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(net)) return null;
  const n = Number(net);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

/**
 * LE MENU À TROIS POINTS D'UN BLOC : le seuil d'alerte du service, en dollars. Le champ vit DANS un menu Radix
 * (compétence champ-de-saisie-dans-un-menu-radix) : il arrête la propagation des touches — sauf Échap, les
 * flèches et Tab — pour que la recherche par frappe du menu (et celle du volet autour) ne vole pas les lettres.
 */
function MenuDuSeuil({
  solde,
  seuilUsd,
  personnalise,
  onSeuil,
}: {
  solde: SoldeDeServiceIa;
  seuilUsd: number;
  personnalise: boolean;
  onSeuil: (id: string, valeurUsd: number | null) => void;
}) {
  const [ouvert, setOuvert] = React.useState(false);
  const idDuLibelle = React.useId();
  const [texte, setTexte] = React.useState('');
  const [invalide, setInvalide] = React.useState(false);
  const enDollars = (v: number) => montantCursorEnClair(Math.round(v * 100), formatRegional());
  React.useEffect(() => {
    if (!ouvert) return;
    setTexte(new Intl.NumberFormat(formatRegional(), { maximumFractionDigits: 2 }).format(seuilUsd));
    setInvalide(false);
  }, [ouvert, seuilUsd]);
  const saisi = montantSaisi(texte);
  const valider = () => {
    if (saisi === null) {
      setInvalide(true);
      return false;
    }
    if (saisi !== seuilUsd) onSeuil(solde.id, saisi === SEUIL_PAR_DEFAUT_USD ? null : saisi);
    return true;
  };
  return (
    <DropdownMenu open={ouvert} onOpenChange={setOuvert}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={t('Alerte de {v0}', { v0: solde.nom })}
          data-menu-seuil-service-ia={solde.id}
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-faint transition-colors hover:bg-surface hover:text-text"
        >
          <EllipsisVertical className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="sm:w-[230px]" titre={t('Alerte de {v0}', { v0: solde.nom })}>
        <DropdownMenuLabel id={idDuLibelle}>{t('Prévenir sous (en dollars)')}</DropdownMenuLabel>
        <div className="px-2.5 pb-1.5">
          <Input
            value={texte}
            inputMode="decimal"
            autoFocus
            aria-labelledby={idDuLibelle}
            aria-invalid={invalide || undefined}
            data-champ-seuil-service-ia={solde.id}
            className="h-8 text-[16px] tabular-nums sm:text-[13px]"
            onChange={(e) => {
              setTexte(e.target.value);
              setInvalide(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Tab') return;
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                if (valider()) setOuvert(false);
              }
            }}
          />
          {invalide || (solde.unite === 'credits' && saisi !== null) ? (
            <p data-aide-seuil className={cn('mt-1 text-[11.5px]', invalide ? 'text-danger' : 'text-faint')}>
              {invalide || saisi === null ? t('Montant invalide') : t('soit {v0}', { v0: montantIa(seuilDansLUnite('credits', saisi), 'credits') })}
            </p>
          ) : null}
        </div>
        <DropdownMenuItem
          data-enregistrer-seuil-service-ia={solde.id}
          onSelect={(e) => {
            if (!valider()) e.preventDefault();
          }}
        >
          <Check className="h-3.5 w-3.5" />
          {t('Enregistrer')}
        </DropdownMenuItem>
        {personnalise ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem data-seuil-par-defaut-service-ia={solde.id} onSelect={() => onSeuil(solde.id, null)}>
              <RefreshCw className="h-3.5 w-3.5" />
              {t('Revenir à {v0}', { v0: enDollars(SEUIL_PAR_DEFAUT_USD) })}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
            className="shrink-0 rounded p-1.5 sm:p-1 text-faint hover:bg-raised hover:text-text"
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
                <span className={cn('shrink-0', entree.ok ? 'text-faint' : 'text-danger')}>
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
  if (secondes === 7 * 24 * 60 * 60) return t('Semaine');
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
      {/* LE TEMPS RESTANT REJOINT LA LIGNE DU LIBELLÉ (carte du 05/11/2026 : « que ça occupe moins de place ») : une
          ligne de moins par fenêtre, rien de retiré ; l'heure exacte reste en infobulle. */}
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span className="shrink-0 text-[12px] text-faint">{label}</span>
        {restant ? (
          <Tooltip label={exact ?? ''}>
            <span className="min-w-0 truncate text-[11px] text-faint" data-temps-restant>
              · {restant}
            </span>
          </Tooltip>
        ) : null}
        <span className="ml-auto shrink-0 text-[12px] text-muted">{Math.round(pct)} %</span>
      </div>
      <Gauge value={pct} tone="quota" height="h-1" />
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
