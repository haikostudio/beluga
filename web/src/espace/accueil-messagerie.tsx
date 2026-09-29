/**
 * L'ACCUEIL DE LA MESSAGERIE : L'ACTIVITÉ DE LA PÉRIODE, PUIS QUI ATTEND QUOI.
 *
 * Il se lit de haut en bas, dans l'ordre où l'on se pose les questions :
 * QUAND a-t-on échangé (le graphique journalier et sa période), COMBIEN en est
 * ressorti (les chiffres, colonne par colonne du tableau des demandes), puis
 * AVEC QUI (une fiche par client, la plus active en tête).
 *
 * TOUT VIENT D'UN SEUL APPEL (`espace.tableauDeBord`) : les chiffres sont
 * calculés au serveur, l'écran ne fait que dessiner.
 *
 * LE GRAPHIQUE EST FAIT MAISON, en colonnes empilées : aucune bibliothèque
 * n'est ajoutée pour dessiner des rectangles, et chaque couleur sort d'un jeton
 * du thème — il reste donc lisible dans les douze apparences.
 *
 * LE TÉLÉPHONE D'ABORD : les chiffres tiennent sur deux colonnes à 320 px et
 * s'étalent sur un seul rang au-delà, aucun libellé n'est tronqué, et chaque
 * fiche client s'ouvre d'un seul toucher.
 *
 * AUCUN ÉTAT VIDE PENDANT L'ATTENTE : une silhouette tient la place, aux mêmes
 * dimensions que les vrais blocs, pour que rien ne saute à leur arrivée.
 */
import * as React from 'react';
import { ListChecks, MessagesSquare } from 'lucide-react';
import { Pastille, Tooltip, ZoneDefilement } from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';
import {
  COLONNES_DEMANDE,
  COULEURS_COLONNES_DEMANDE,
  ECHELLES_DU_TABLEAU,
  TITRES_COLONNES_DEMANDE,
  joursDeLaPeriode,
  totauxDuTableau,
  type FicheClientTableau,
} from '@beluga/shared';
import { SelecteurPeriode } from '@/components/selecteur-periode';
import { TON_COLONNE, jourCourt, jourDe } from './formats';

/** La période affichée, telle que le serveur l'a retenue. */
export interface PeriodeDuTableau {
  debut: number;
  fin: number;
  jours: number;
}

/**
 * LA PALETTE DES CLIENTS : des JETONS DU THÈME, jamais une couleur en dur.
 *
 * Six teintes bien séparées suffisent ; au-delà, on recommence — deux clients
 * partagent alors une couleur, ce que la légende lève d'un survol. Le rang se
 * tire de l'ordre alphabétique des identifiants : la couleur d'un client ne
 * change donc pas d'une visite à l'autre, même si son activité le fait monter
 * ou descendre dans la liste.
 */
const TEINTES_CLIENTS = ['--info', '--publie', '--success', '--warning', '--danger', '--accent'] as const;

function couleurDuClient(rang: number): string {
  return `hsl(var(${TEINTES_CLIENTS[rang % TEINTES_CLIENTS.length]}))`;
}

/* ------------------------------------------------------------------ */
/* Le graphique journalier                                              */
/* ------------------------------------------------------------------ */

/**
 * UNE COLONNE PAR JOUR, PARTAGÉE ENTRE LES CLIENTS.
 *
 * La hauteur d'un segment est proportionnelle aux échanges de ce jour-là avec
 * ce client. LES JOURS SANS RIEN GARDENT LEUR COLONNE, vide : c'est en voyant
 * les trous qu'on lit la régularité de l'activité. Le survol d'une colonne
 * donne la date et le détail, client par client.
 *
 * Sur une longue période, les colonnes se resserrent au lieu de déborder
 * (`flex-1` sur chacune) et les étiquettes de dates s'espacent pour rester
 * lisibles.
 */
function GraphiqueJournalier({
  jours,
  series,
  masques,
}: {
  jours: number[];
  series: { clientId: string; nomAffiche: string; couleur: string; valeurs: number[] }[];
  masques: ReadonlySet<string>;
}) {
  const visibles = series.filter((serie) => !masques.has(serie.clientId));
  const totaux = jours.map((_, rang) => visibles.reduce((somme, serie) => somme + (serie.valeurs[rang] ?? 0), 0));
  const sommet = Math.max(...totaux, 1);
  /* Une étiquette tous les N jours : au-delà, elles se chevaucheraient. */
  const pasDEtiquette = Math.max(1, Math.ceil(jours.length / 8));

  return (
    <div className="space-y-1" data-graphique-journalier={jours.length}>
      <div className="flex h-32 items-end gap-px" role="img" aria-label="Echanges jour par jour">
        {jours.map((jour, rang) => (
          <Tooltip
            key={jour}
            label={
              <span className="block space-y-0.5">
                <span className="block font-medium">{jourDe(jour)}</span>
                {totaux[rang] ? (
                  visibles
                    .filter((serie) => serie.valeurs[rang])
                    .map((serie) => (
                      <span key={serie.clientId} className="block">
                        {serie.nomAffiche} · {serie.valeurs[rang]}
                      </span>
                    ))
                ) : (
                  <span className="block text-faint">{t('Aucun échange')}</span>
                )}
              </span>
            }
          >
            <span
              className="flex h-full min-w-0 flex-1 cursor-default flex-col justify-end rounded-sm hover:bg-raised/60"
              data-colonne-jour={rang}
              data-jour-total={totaux[rang]}
            >
              {/* La colonne d'un jour sans échange reste tracée, d'un trait
                  discret au ras du sol : elle dit « ce jour existe, il a été
                  vide », ce qu'une absence de colonne ne dirait pas. */}
              {totaux[rang] ? (
                visibles.map((serie) =>
                  serie.valeurs[rang] ? (
                    <span
                      key={serie.clientId}
                      className="block w-full first:rounded-t-sm"
                      style={{
                        height: `${((serie.valeurs[rang] ?? 0) / sommet) * 100}%`,
                        backgroundColor: serie.couleur,
                      }}
                      data-segment-client={serie.clientId}
                    />
                  ) : null,
                )
              ) : (
                <span className="block h-px w-full bg-faint/30" aria-hidden />
              )}
            </span>
          </Tooltip>
        ))}
      </div>

      {/* LES DATES SOUS LES COLONNES, espacées pour rester lisibles. Elles
          gardent la même largeur que leur colonne, donc restent alignées. */}
      <div className="flex gap-px" aria-hidden>
        {jours.map((jour, rang) => (
          <span key={jour} className="min-w-0 flex-1 overflow-visible text-center text-[9.5px] text-faint">
            {rang % pasDEtiquette === 0 ? jourCourt(jour) : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * LA LÉGENDE, CLIQUABLE. Un clic retire un client du graphique ou l'y remet :
 * c'est le seul moyen de lire l'activité d'un client quand un autre écrase tout
 * le reste.
 */
function LegendeDuGraphique({
  series,
  masques,
  onBasculer,
}: {
  series: { clientId: string; nomAffiche: string; couleur: string; valeurs: number[] }[];
  masques: ReadonlySet<string>;
  onBasculer: (clientId: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1" data-legende-graphique={series.length}>
      {series.map((serie) => {
        const masque = masques.has(serie.clientId);
        const total = serie.valeurs.reduce((somme, n) => somme + n, 0);
        return (
          <button
            key={serie.clientId}
            type="button"
            onClick={() => onBasculer(serie.clientId)}
            aria-pressed={!masque}
            data-legende-client={serie.clientId}
            data-legende-masque={masque ? '' : undefined}
            className={cn(
              'flex min-h-[28px] items-center gap-1.5 rounded px-1 text-[12px] transition-opacity hover:bg-raised',
              masque ? 'opacity-40' : 'opacity-100',
            )}
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: serie.couleur }}
              aria-hidden
            />
            <span className="text-muted">{serie.nomAffiche}</span>
            <span className="tabular-nums text-faint">{total}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Les chiffres clés                                                    */
/* ------------------------------------------------------------------ */

/**
 * UN CHIFFRE CLÉ, SUR DEUX LIGNES. Le libellé n'est JAMAIS coupé : il passe à
 * la ligne plutôt que de finir en « Clien… », ce que faisaient les quatre
 * tuiles d'un seul rang sur un téléphone de 390 px.
 */
function ChiffreCle({
  valeur,
  libelle,
  repere,
  ton,
  icone,
}: {
  valeur: number;
  libelle: string;
  repere: string;
  ton?: string;
  icone?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-lg bg-raised px-2.5 py-2" data-chiffre-cle={repere}>
      {icone ? <span className="mt-0.5 shrink-0 text-faint">{icone}</span> : null}
      <span className="min-w-0">
        <span className={cn('block text-[19px] font-semibold leading-tight tabular-nums', ton ?? 'text-text')}>
          {valeur}
        </span>
        <span className="block text-[11.5px] leading-tight text-faint">{libelle}</span>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Une fiche client                                                     */
/* ------------------------------------------------------------------ */

/**
 * UNE FICHE PAR CLIENT, ET LA FICHE ENTIÈRE EST LA PORTE DE CHEZ LUI.
 *
 * Plus aucun bouton en pied de fiche : un clic (ou un toucher) n'importe où
 * dessus ouvre le tableau des demandes du client, SANS le volet de discussion
 * par-dessus — la discussion reste à un toucher, sur sa bulle. La fiche n'est PAS un `button` — elle porte
 * des textes repliés (`truncate`) et une liste de définitions : c'est un bloc
 * `role="button"`, joignable au clavier (Tab, puis Entrée ou Espace).
 */
function FicheClient({
  fiche,
  couleur,
  onOuvrir,
}: {
  fiche: FicheClientTableau;
  couleur: string;
  onOuvrir: () => void;
}) {
  const nomsDesProjets = fiche.projets?.map((p) => p.nom).join(' · ') || t('Aucun projet');
  return (
    <div
      role="button"
      tabIndex={0}
      className="flex cursor-pointer flex-col gap-2 rounded-lg bg-surface p-3 transition-colors hover:bg-raised/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-faint active:bg-raised/60"
      data-fiche-client={fiche.clientId}
      onClick={() => {
        // Un texte qu'on vient de sélectionner à la souris ne vaut pas un clic :
        // la fiche reste copiable.
        if (window.getSelection()?.toString()) return;
        onOuvrir();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOuvrir();
        }
      }}
      data-en-attente={fiche.compteurs.nonLu || fiche.compteurs.aTraiter ? '' : undefined}
    >
      <div className="flex min-w-0 items-start gap-2">
        <span
          className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm"
          style={{ backgroundColor: couleur }}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium text-text">{fiche.nomAffiche}</span>
          {/* LE PROJET SOUS LE NOM : deux clients peuvent porter des noms
              proches, c'est le projet qui lève le doute. */}
          <span className="block truncate text-[11.5px] text-faint" data-fiche-projets>
            {nomsDesProjets}
          </span>
        </span>
        <Pastille nombre={fiche.compteurs.nonLu} ton="lire" data-fiche-non-lus={fiche.compteurs.nonLu || undefined} />
        <Pastille
          nombre={fiche.compteurs.aTraiter}
          ton="repondre"
          data-fiche-a-traiter={fiche.compteurs.aTraiter || undefined}
        />
      </div>

      {/* LES MÊMES COLONNES QUE L'ENTÊTE, ramenées à ce client : on compare une
          fiche au total sans changer de repère. */}
      <dl className="grid grid-cols-4 gap-1 text-center" data-fiche-colonnes>
        {COLONNES_DEMANDE.map((colonne) => (
          <span key={colonne} className="min-w-0 rounded bg-raised/60 px-1 py-1">
            <dd
              className={cn('text-[14px] font-semibold tabular-nums', TON_COLONNE[COULEURS_COLONNES_DEMANDE[colonne]])}
              data-fiche-colonne={colonne}
            >
              {fiche.parColonne?.[colonne] ?? 0}
            </dd>
            <dt className="text-[10px] leading-tight text-faint">{t(TITRES_COLONNES_DEMANDE[colonne])}</dt>
          </span>
        ))}
      </dl>

      <div className="flex items-center justify-between gap-2 text-[11.5px] text-faint">
        <span data-fiche-taches={fiche.tachesOuvertes}>
          {t('{v0} tâches ouvertes', { v0: String(fiche.tachesOuvertes) })}
        </span>
        <span data-fiche-activite>
          {fiche.derniereActivite ? jourCourt(fiche.derniereActivite) : t('Aucun échange')}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* L'écran                                                              */
/* ------------------------------------------------------------------ */

export function AccueilMessagerie({
  fiches,
  periode,
  echelle,
  onEchelle,
  onPeriodeLibre,
  onOuvrirClient,
}: {
  /** `null` : les chiffres ne sont pas encore arrivés — on montre la silhouette. */
  fiches: FicheClientTableau[] | null;
  /** La période que le SERVEUR a retenue — jamais celle qui a été demandée. */
  periode: PeriodeDuTableau | null;
  /** L'échelle toute prête retenue, en jours ; `null` si deux dates ont été posées. */
  echelle: number | null;
  onEchelle: (jours: number) => void;
  onPeriodeLibre: (debut: number, fin: number) => void;
  onOuvrirClient: (clientId: string) => void;
}) {
  const [masques, setMasques] = React.useState<Set<string>>(() => new Set());
  const basculerClient = React.useCallback((clientId: string) => {
    setMasques((avant) => {
      const apres = new Set(avant);
      if (apres.has(clientId)) apres.delete(clientId);
      else apres.add(clientId);
      return apres;
    });
  }, []);

  if (!fiches || !periode) return <SilhouetteAccueil />;

  const totaux = totauxDuTableau(fiches);
  /* La couleur d'un client suit l'ordre alphabétique de son identifiant : elle
     ne bouge donc pas quand son activité le fait monter dans la liste. */
  const rangs = new Map([...fiches].sort((a, b) => a.clientId.localeCompare(b.clientId)).map((f, i) => [f.clientId, i]));
  const jours = joursDeLaPeriode(periode.debut, periode.fin);
  const series = fiches.map((fiche) => ({
    clientId: fiche.clientId,
    nomAffiche: fiche.nomAffiche,
    couleur: couleurDuClient(rangs.get(fiche.clientId) ?? 0),
    valeurs: fiche.interactions ?? [],
  }));

  return (
    <ZoneDefilement
      fond="hsl(var(--fond-zone, var(--bg)))"
      className="min-h-0 flex-1 space-y-4 p-3"
      data-accueil-messagerie={fiches.length}
      data-periode-jours={periode.jours}
    >
      {/* LE GRAPHIQUE ET SA PÉRIODE, EN TÊTE : « quand a-t-on échangé » se lit
          avant « combien » et « avec qui ». */}
      <section className="space-y-2" data-bloc-graphique>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[11px] uppercase tracking-wide text-faint">{t('Échanges jour par jour')}</h2>
          <SelecteurPeriode
            echelles={ECHELLES_DU_TABLEAU}
            echelle={echelle}
            debut={periode.debut}
            fin={periode.fin}
            onEchelle={onEchelle}
            onLibre={onPeriodeLibre}
          />
        </div>
        <GraphiqueJournalier jours={jours} series={series} masques={masques} />
        {series.length ? (
          <LegendeDuGraphique series={series} masques={masques} onBasculer={basculerClient} />
        ) : null}
      </section>

      {/* LES CHIFFRES, COLONNE PAR COLONNE DU TABLEAU DES DEMANDES. Chaque
          colonne garde la couleur qu'elle a sur le tableau : on la reconnaît
          sans lire son nom. Deux colonnes à 320 px, six sur grand écran. */}
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-chiffres-cles>
        {COLONNES_DEMANDE.map((colonne) => (
          <ChiffreCle
            key={colonne}
            valeur={totaux.parColonne[colonne]}
            libelle={t(TITRES_COLONNES_DEMANDE[colonne])}
            repere={`colonne-${colonne}`}
            ton={TON_COLONNE[COULEURS_COLONNES_DEMANDE[colonne]]}
          />
        ))}
        <ChiffreCle
          valeur={totaux.messages}
          libelle={t('Messages sur la période')}
          repere="messages"
          icone={<MessagesSquare className="h-4 w-4" />}
        />
        <ChiffreCle
          valeur={totaux.tachesOuvertes}
          libelle={t('Tâches ouvertes')}
          repere="taches-ouvertes"
          icone={<ListChecks className="h-4 w-4" />}
        />
      </section>

      {/* UNE FICHE PAR CLIENT, LA PLUS ACTIVE EN TÊTE. Le serveur les a déjà
          rangées : l'écran ne retrie rien, sinon les deux se contrediraient. */}
      <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" data-fiches-clients={fiches.length}>
        {fiches.map((fiche) => (
          <FicheClient
            key={fiche.clientId}
            fiche={fiche}
            couleur={couleurDuClient(rangs.get(fiche.clientId) ?? 0)}
            onOuvrir={() => onOuvrirClient(fiche.clientId)}
          />
        ))}
      </section>
    </ZoneDefilement>
  );
}

/**
 * LA SILHOUETTE DE CET ÉCRAN. Ses blocs ont les MÊMES dimensions que les vrais :
 * à l'arrivée des chiffres, rien ne se décale.
 */
export function SilhouetteAccueil() {
  return (
    <div className="min-h-0 flex-1 space-y-4 p-3" data-silhouette="accueil-messagerie">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="h-[14px] w-32 animate-pulse rounded bg-raised" />
          <div className="h-7 w-52 animate-pulse rounded-md bg-raised" />
        </div>
        <div className="h-32 animate-pulse rounded bg-raised/70" />
        <div className="h-[28px] w-40 animate-pulse rounded bg-raised/70" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((rang) => (
          <div key={rang} className="h-[54px] animate-pulse rounded-lg bg-raised" />
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((rang) => (
          <div key={rang} className="h-[142px] animate-pulse rounded-lg bg-surface" />
        ))}
      </div>
    </div>
  );
}
