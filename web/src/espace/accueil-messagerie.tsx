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
import { CLASSE_TITRE_SEUL_EN_BARRE, Pastille, Tooltip, ZoneDefilement } from '@/components/ui';
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
import { OptionsDePage } from '@/components/entete-de-zone';
import { useColonneDeService } from '@/components/colonne-de-service';
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
    <div className="min-w-0" data-chiffre-cle={repere}>
      <span className={cn('block text-[24px] font-semibold leading-tight tabular-nums', ton ?? 'text-text')}>{valeur}</span>
      <span className="mt-1 flex items-center gap-1.5 text-[13px] leading-tight text-muted">
        {icone ? <span className="shrink-0 text-faint">{icone}</span> : null}
        {libelle}
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
      className="flex cursor-pointer items-center gap-3 rounded-xl px-3.5 py-3 transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-faint active:bg-raised"
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
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: couleur }}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-medium text-text">{fiche.nomAffiche}</span>
          {/* LE PROJET SOUS LE NOM : deux clients peuvent porter des noms
              proches, c'est le projet qui lève le doute. */}
          <span className="block truncate text-[12.5px] text-faint" data-fiche-projets>
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

      {/* LE DÉTAIL PAR COLONNE N'EST PLUS ÉCRIT SUR LA LIGNE : il reste lu à
          voix haute et mesuré par les contrôles, et se lit en ouvrant le
          client. La ligne ne garde que la date du dernier échange. */}
      <dl className="sr-only" data-fiche-colonnes>
        {COLONNES_DEMANDE.map((colonne) => (
          <span key={colonne}>
            <dd data-fiche-colonne={colonne}>{fiche.parColonne?.[colonne] ?? 0}</dd>
            <dt>{t(TITRES_COLONNES_DEMANDE[colonne])}</dt>
          </span>
        ))}
      </dl>
      <span className="sr-only" data-fiche-taches={fiche.tachesOuvertes}>
        {t('{v0} tâches ouvertes', { v0: String(fiche.tachesOuvertes) })}
      </span>
      <span className="shrink-0 text-[12.5px] text-faint" data-fiche-activite>
        {fiche.derniereActivite ? jourCourt(fiche.derniereActivite) : t('Aucun échange')}
      </span>
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
  action,
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
  /** Le geste posé en haut à droite : l'engrenage de la gestion des comptes. */
  action?: React.ReactNode;
}) {
  const [masques, setMasques] = React.useState<Set<string>>(() => new Set());
  /* SUR ORDINATEUR, LES CLIENTS VIVENT DANS LA COLONNE DE GAUCHE (demande du
     12/10/2026) : nom, projet et pastilles y sont déjà, la page n'en garde que
     l'activité. Sur téléphone la colonne n'existe pas : le bloc reste la porte
     de chez chacun. */
  const clientsEnColonne = useColonneDeService();
  const basculerClient = React.useCallback((clientId: string) => {
    setMasques((avant) => {
      const apres = new Set(avant);
      if (apres.has(clientId)) apres.delete(clientId);
      else apres.add(clientId);
      return apres;
    });
  }, []);

  if (!fiches || !periode) return <SilhouetteAccueil avecClients={!clientsEnColonne} />;

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
      className="min-h-0 flex-1 px-4 pb-12 pt-2 sm:px-8 sm:pt-8"
      data-accueil-messagerie={fiches.length}
      data-periode-jours={periode.jours}
    >
      {/* UNE COLONNE ÉTROITE ET CENTRÉE, comme chaque page de service — et
          TROIS choses seulement, dans l'ordre où on en a besoin : les clients
          (la porte de chez chacun), puis les chiffres, puis le graphique. */}
      <div className="mx-auto w-full max-w-[756px] space-y-10">
      <div>
        {/* SUR TÉLÉPHONE LE NOM DE LA PAGE NE S'ÉCRIT QU'UNE FOIS, dans la barre
            d'en-tête : ce titre-ci reste seulement lu à voix haute. */}
        <h1 className={cn('pb-5 text-[26px] font-semibold leading-tight tracking-tight text-text sm:pb-6', CLASSE_TITRE_SEUL_EN_BARRE)} data-titre-de-page>
          {t('Messagerie')}
        </h1>
        {/* L'engrenage des comptes monte dans la barre d'en-tête ; sur téléphone
            c'est une ligne nommée du menu à trois points (`OptionDePage`). */}
        {action ? <OptionsDePage>{action}</OptionsDePage> : null}

        {/* UNE LIGNE PAR CLIENT, LA PLUS ACTIVE EN TÊTE. Le serveur les a déjà
            rangées : l'écran ne retrie rien, sinon les deux se contrediraient. */}
        {clientsEnColonne ? null : (
          <section className="flex flex-col gap-0.5 rounded-2xl bg-surface p-1.5" data-fiches-clients={fiches.length}>
            {fiches.map((fiche) => (
              <FicheClient
                key={fiche.clientId}
                fiche={fiche}
                couleur={couleurDuClient(rangs.get(fiche.clientId) ?? 0)}
                onOuvrir={() => onOuvrirClient(fiche.clientId)}
              />
            ))}
          </section>
        )}
      </div>

      {/* LES CHIFFRES ET LE GRAPHIQUE, SOUS UNE MÊME PÉRIODE. Des nombres nus,
          sans boîte : c'est leur taille qui les fait lire. */}
      <section className="space-y-6" data-bloc-graphique>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[16px] font-semibold text-text">{t('Échanges jour par jour')}</h2>
          <SelecteurPeriode
            echelles={ECHELLES_DU_TABLEAU}
            echelle={echelle}
            debut={periode.debut}
            fin={periode.fin}
            onEchelle={onEchelle}
            onLibre={onPeriodeLibre}
          />
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-6" data-chiffres-cles>
          {COLONNES_DEMANDE.map((colonne) => (
            <ChiffreCle
              key={colonne}
              valeur={totaux.parColonne[colonne]}
              libelle={t(TITRES_COLONNES_DEMANDE[colonne])}
              repere={`colonne-${colonne}`}
              ton={TON_COLONNE[COULEURS_COLONNES_DEMANDE[colonne]]}
            />
          ))}
          <ChiffreCle valeur={totaux.messages} libelle={t('Messages sur la période')} repere="messages" />
          <ChiffreCle valeur={totaux.tachesOuvertes} libelle={t('Tâches ouvertes')} repere="taches-ouvertes" />
        </div>

        <div className="space-y-2">
          <GraphiqueJournalier jours={jours} series={series} masques={masques} />
          {series.length ? (
            <LegendeDuGraphique series={series} masques={masques} onBasculer={basculerClient} />
          ) : null}
        </div>
      </section>
      </div>
    </ZoneDefilement>
  );
}

/**
 * LA SILHOUETTE DE CET ÉCRAN. Ses blocs ont les MÊMES dimensions que les vrais :
 * à l'arrivée des chiffres, rien ne se décale.
 */
export function SilhouetteAccueil({ avecClients = true }: { avecClients?: boolean } = {}) {
  return (
    <div className="mx-auto min-h-0 w-full max-w-[820px] flex-1 space-y-10 px-4 pb-12 pt-2 sm:px-8 sm:pt-8" data-silhouette="accueil-messagerie">
      <div>
        <div className="mb-6 h-[30px] w-44 animate-pulse rounded-lg bg-raised" />
        {avecClients ? (
          <div className="space-y-0.5 rounded-2xl bg-surface p-1.5">
            {[0, 1, 2].map((rang) => (
              <div key={rang} className="flex h-[62px] items-center gap-3 px-3.5">
                <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-raised" />
                <div className="h-[14px] w-40 animate-pulse rounded bg-raised" />
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="h-[18px] w-48 animate-pulse rounded bg-raised" />
          <div className="h-8 w-52 animate-pulse rounded-lg bg-raised" />
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
          {[0, 1, 2, 3, 4, 5].map((rang) => (
            <div key={rang} className="h-[50px] w-20 animate-pulse rounded-lg bg-raised/70" />
          ))}
        </div>
        <div className="h-32 animate-pulse rounded-lg bg-raised/60" />
      </div>
    </div>
  );
}
