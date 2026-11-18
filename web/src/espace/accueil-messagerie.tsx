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
import { Pastille, Tooltip, ZoneDefilement, TELEPHONE_ENTRE_SECTIONS } from '@/components/ui';
import { cn } from '@/lib/utils';
import { ApercuAuSurvol, BasculeTableauCartes, CorpsDApercu, CourbeDApercu, useVueDeLaListe } from '@/components/ui/apercu-au-survol';
import { CarteDeTableau } from '@/components/ui/carte-de-tableau';
import { CelluleProjet } from '@/components/ui/colonne-projet';
import { TitreEtSous } from '@/components/ui/apercu-de-ligne';
import { Tableau, type ColonneDuTableauCommun } from '@/components/ui/tableau';
import { t } from '@/lib/langue';
import {
  COLONNES_DEMANDE,
  COULEURS_COLONNES_DEMANDE,
  ECHELLES_DU_TABLEAU,
  TITRES_COLONNES_DEMANDE,
  joursDeLaPeriode,
  totauxDuTableau,
  minusculesSansAccents,
  type DemandeAffichee,
  type FicheClientTableau,
} from '@beluga/shared';
import { SelecteurPeriode } from '@/components/selecteur-periode';
import { OptionsDePage } from '@/components/entete-de-zone';
import { useTelephone } from '@/lib/telephone';
import { BasculeDePage, DroiteDePage, RechercheDuService } from '@/components/fenetre-de-service';
import { canalEspace } from './canal-espace';
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
  compact = false,
}: {
  jours: number[];
  series: { clientId: string; nomAffiche: string; couleur: string; valeurs: number[] }[];
  masques: ReadonlySet<string>;
  /** Plus basse (≈ 110 px) : la courbe passe sous les chiffres, au-dessus des demandes. */
  compact?: boolean;
}) {
  const visibles = series.filter((serie) => !masques.has(serie.clientId));
  const totaux = jours.map((_, rang) => visibles.reduce((somme, serie) => somme + (serie.valeurs[rang] ?? 0), 0));
  const sommet = Math.max(...totaux, 1);
  /* Une étiquette tous les N jours : au-delà, elles se chevaucheraient. */
  const pasDEtiquette = Math.max(1, Math.ceil(jours.length / 8));

  return (
    <div className="space-y-1" data-graphique-journalier={jours.length}>
      <div className={cn('flex items-end gap-px', compact ? 'h-[84px]' : 'h-32')} role="img" aria-label="Echanges jour par jour">
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
/** Les colonnes du tableau des clients (14/11/2026). Les repères des contrôles d'avant restent sur les cellules. */
function colonnesDesClients(couleur: (fiche: FicheClientTableau) => string): ColonneDuTableauCommun<FicheClientTableau>[] {
  return [
    {
      cle: 'client',
      libelle: t('Client'),
      valeur: (f) => f.nomAffiche,
      filtre: 'texte',
      rendu: (f) => (
        <span className="flex min-w-0 items-center gap-3">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: couleur(f) }} aria-hidden />
          <span className="block min-w-0">
            <span className="block truncate font-medium text-text">{f.nomAffiche}</span>
            {/* LE PROJET SOUS LE NOM : deux clients peuvent porter des noms proches, c'est le projet qui lève le doute. */}
            <span className="block truncate text-[11.5px] text-muted" data-fiche-projets>
              {f.projets?.map((p) => p.nom).join(' · ') || t('Aucun projet')}
            </span>
          </span>
          {/* Le détail par colonne reste lu à voix haute et mesuré par les contrôles ; il se lit en ouvrant le client. */}
          <dl className="sr-only" data-fiche-colonnes>
            {COLONNES_DEMANDE.map((colonne) => (
              <span key={colonne}>
                <dd data-fiche-colonne={colonne}>{f.parColonne?.[colonne] ?? 0}</dd>
                <dt>{t(TITRES_COLONNES_DEMANDE[colonne])}</dt>
              </span>
            ))}
          </dl>
          <span className="sr-only" data-fiche-taches={f.tachesOuvertes}>
            {t('{v0} tâches ouvertes', { v0: String(f.tachesOuvertes) })}
          </span>
        </span>
      ),
    },
    {
      cle: 'non-lus',
      libelle: t('Non lus'),
      largeur: 96,
      droite: true,
      valeur: (f) => f.compteurs.nonLu,
      rendu: (f) => (f.compteurs.nonLu ? <Pastille nombre={f.compteurs.nonLu} ton="lire" data-fiche-non-lus={f.compteurs.nonLu} /> : <span className="text-faint">—</span>),
    },
    {
      cle: 'a-traiter',
      libelle: t('À traiter'),
      largeur: 96,
      droite: true,
      valeur: (f) => f.compteurs.aTraiter,
      rendu: (f) => (f.compteurs.aTraiter ? <Pastille nombre={f.compteurs.aTraiter} ton="repondre" data-fiche-a-traiter={f.compteurs.aTraiter} /> : <span className="text-faint">—</span>),
    },
    { cle: 'echanges', libelle: t('Échanges'), largeur: 96, droite: true, secondaire: true, valeur: (f) => f.messages, rendu: (f) => <span className="tabular-nums text-muted">{f.messages}</span> },
    {
      cle: 'dernier',
      libelle: t('Dernier échange'),
      largeur: 140,
      droite: true,
      valeur: (f) => f.derniereActivite ?? null,
      rendu: (f) => (
        <span className="text-muted" data-fiche-activite>
          {f.derniereActivite ? jourCourt(f.derniereActivite) : t('Aucun échange')}
        </span>
      ),
    },
  ];
}

/** L'aperçu d'un client au survol : ses projets, ses chiffres, la courbe de ses échanges sur la période. */
function ApercuDuClient({ fiche: f }: { fiche: FicheClientTableau }) {
  return (
    <CorpsDApercu
      sous={f.projets?.map((p) => p.nom).join(' · ') || t('Aucun projet')}
      titre={f.nomAffiche}
      chiffres={[
        { libelle: t('Non lus'), valeur: f.compteurs.nonLu },
        { libelle: t('À traiter'), valeur: f.compteurs.aTraiter },
        { libelle: t('Demandes ouvertes'), valeur: f.demandesOuvertes },
        { libelle: t('Tâches ouvertes'), valeur: f.tachesOuvertes },
      ]}
    >
      <CourbeDApercu
        valeurs={f.interactions ?? []}
        legende={
          <>
            {t('{n} échange(s) sur la période', { n: f.messages })} · {f.derniereActivite ? jourCourt(f.derniereActivite) : t('Aucun échange')}
          </>
        }
      />
    </CorpsDApercu>
  );
}

/* ------------------------------------------------------------------ */
/* L'écran                                                              */
/* ------------------------------------------------------------------ */

/** Une demande de l'accueil : la demande, son projet et le client qui l'ouvre. */
interface LigneDeDemande {
  demande: DemandeAffichee;
  projet: { id: string; nom: string };
  client: FicheClientTableau | null;
}

/**
 * LES DEMANDES DES PROJETS QUI ONT DES CLIENTS, lues projet par projet (`espace.etat`, la même lecture que l'espace
 * d'un client) : `null` tant que toutes ne sont pas revenues. Rien de neuf côté démon.
 */
function useDemandesDesProjets(projets: readonly { id: string }[], version: number): Map<string, DemandeAffichee[]> | null {
  const [lues, setLues] = React.useState<Map<string, DemandeAffichee[]> | null>(null);
  const cle = projets.map((p) => p.id).join(',');
  React.useEffect(() => {
    let vivant = true;
    void Promise.all(
      projets.map((p) =>
        canalEspace
          .demander({ type: 'espace.etat', projectId: p.id })
          .then((r: { demandes?: DemandeAffichee[] }) => [p.id, (r.demandes ?? []).filter((d) => !d.archiveeLe)] as const)
          .catch(() => [p.id, [] as DemandeAffichee[]] as const),
      ),
    ).then((paires) => {
      if (vivant) setLues(new Map(paires));
    });
    return () => {
      vivant = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, version]);
  return lues;
}

/**
 * L'ACCUEIL DE LA MESSAGERIE, AU MODÈLE COMMUN DES SERVICES (carte « Services homogènes et centrés », 14/11/2026, piste
 * D retenue par l'utilisateur : « un tableau avec carte ou ligne pour chacun des projets et les statistiques en
 * dessus »). Dans l'ordre :
 *  1. LES CHIFFRES de la période (à faire, en cours, terminé, validé, messages, tâches ouvertes) ;
 *  2. LA COURBE des échanges, plus basse — ABSENTE quand la période n'en compte aucun (pas de blanc) ;
 *  3. LES DEMANDES RANGÉES SOUS CHAQUE PROJET : un intitulé « Projet · n client(s) · n demande(s) », puis ses
 *     demandes (client, état, ce qui reste à traiter, dernière activité) — en lignes ou en cartes. Un projet qui a des
 *     clients mais aucune demande garde son intitulé.
 * La période se règle à droite du titre de la page ; « Gérer les comptes » est une ligne du menu d'options.
 */
export function AccueilMessagerie({
  fiches,
  periode,
  echelle,
  onEchelle,
  onPeriodeLibre,
  onOuvrirClient,
  onOuvrirDemande,
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
  /** Ouvrir une demande chez son client. */
  onOuvrirDemande?: (clientId: string, demandeId: string) => void;
  /** Les options de la page : la gestion des comptes, le filtre payants / open source. */
  action?: React.ReactNode;
}) {
  const [masques, setMasques] = React.useState<Set<string>>(() => new Set());
  const telephone = useTelephone();
  const [recherche, setRecherche] = React.useState('');
  const [vue, setVue] = useVueDeLaListe('messagerie.vueDeLaListe');
  const basculerClient = React.useCallback((clientId: string) => {
    setMasques((avant) => {
      const apres = new Set(avant);
      if (apres.has(clientId)) apres.delete(clientId);
      else apres.add(clientId);
      return apres;
    });
  }, []);
  /* LES PROJETS DES CLIENTS, dans l'ordre alphabétique : chacun devient un groupe du tableau. */
  const projets = React.useMemo(() => {
    const vus = new Map<string, { id: string; nom: string; clients: FicheClientTableau[] }>();
    for (const f of fiches ?? []) {
      for (const p of f.projets ?? []) {
        const groupe = vus.get(p.id) ?? { id: p.id, nom: p.nom, clients: [] };
        groupe.clients.push(f);
        vus.set(p.id, groupe);
      }
    }
    return [...vus.values()].sort((a, b) => a.nom.localeCompare(b.nom));
  }, [fiches]);
  const version = (fiches ?? []).reduce((n, f) => n + f.messages + f.compteurs.aTraiter + f.compteurs.nonLu, 0);
  const demandes = useDemandesDesProjets(projets, version);

  if (!fiches || !periode) return <SilhouetteAccueil avecClients />;

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
  const echangesSurLaPeriode = series.some((serie) => serie.valeurs.some((v) => v > 0));
  const clientDe = (d: DemandeAffichee, groupe: { clients: FicheClientTableau[] }) =>
    groupe.clients.find((c) => c.clientId === d.auteurId) ?? groupe.clients[0] ?? null;
  const cherche = minusculesSansAccents(recherche.trim());
  const groupes = projets.map((groupe) => {
    const lignes: LigneDeDemande[] = (demandes?.get(groupe.id) ?? [])
      .map((demande) => ({ demande, projet: { id: groupe.id, nom: groupe.nom }, client: clientDe(demande, groupe) }))
      .filter((l) => !cherche || minusculesSansAccents(`${l.demande.titre} ${l.client?.nomAffiche ?? l.demande.auteurNom} ${groupe.nom}`).includes(cherche))
      .sort((a, b) => b.demande.derniereActivite - a.demande.derniereActivite);
    return { ...groupe, lignes, total: demandes?.get(groupe.id)?.length ?? 0 };
  });
  const ouvrir = (l: LigneDeDemande) => {
    // Un texte qu'on vient de sélectionner à la souris ne vaut pas un clic : la ligne reste copiable.
    if (window.getSelection()?.toString()) return;
    const clientId = l.client?.clientId;
    if (!clientId) return;
    if (onOuvrirDemande) onOuvrirDemande(clientId, l.demande.id);
    else onOuvrirClient(clientId);
  };

  return (
    <ZoneDefilement
      fond="hsl(var(--fond-zone, var(--bg)))"
      className={cn('min-h-0 flex-1 pb-12', telephone ? 'px-4 pt-1' : '')}
      data-accueil-messagerie={fiches.length}
      data-periode-jours={periode.jours}
    >
      {/* LA PÉRIODE, LA RECHERCHE ET LA BASCULE MONTENT DANS LA RANGÉE DU TITRE ; « Gérer les comptes » et le filtre
          payants / open source sont des lignes du menu d'options. */}
      <RechercheDuService valeur={recherche} onChange={setRecherche} placeholder={t('Rechercher une demande…')} data-messagerie-recherche />
      <BasculeDePage>
        <BasculeTableauCartes repere="vue-de-la-messagerie" valeur={vue} onChange={setVue} />
      </BasculeDePage>
      <DroiteDePage>
        <SelecteurPeriode
          echelles={ECHELLES_DU_TABLEAU}
          echelle={echelle}
          debut={periode.debut}
          fin={periode.fin}
          onEchelle={onEchelle}
          onLibre={onPeriodeLibre}
        />
      </DroiteDePage>
      {action ? <OptionsDePage>{action}</OptionsDePage> : null}
      <h1 className="sr-only" data-titre-de-page>
        {t('Messagerie')}
      </h1>

      <div className="flex w-full flex-col gap-8">
        {/* 1. LES CHIFFRES DE LA PÉRIODE, AU-DESSUS DE TOUT. Des nombres nus, sans boîte : c'est leur taille qui les
            fait lire. */}
        <section className="flex flex-col gap-4" data-bloc-graphique>
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
          {/* 2. LA COURBE, PLUS BASSE, SEULEMENT QUAND LA PÉRIODE COMPTE DES ÉCHANGES. */}
          {echangesSurLaPeriode ? (
            <div className="space-y-2" data-courbe-des-echanges>
              <GraphiqueJournalier jours={jours} series={series} masques={masques} compact />
              {series.length ? <LegendeDuGraphique series={series} masques={masques} onBasculer={basculerClient} /> : null}
            </div>
          ) : null}
        </section>

        {/* 3. LES DEMANDES, RANGÉES SOUS CHAQUE PROJET. */}
        <section className="flex flex-col gap-6" data-demandes-par-projet={groupes.length} data-fiches-clients={fiches.length}>
          {demandes === null ? (
            <div className="space-y-0.5 rounded-2xl bg-surface p-1.5" data-silhouette="demandes" aria-hidden>
              {[0, 1, 2].map((rang) => (
                <div key={rang} className="flex h-[52px] items-center gap-3 px-3.5">
                  <div className="h-[14px] w-56 animate-pulse rounded bg-raised" />
                </div>
              ))}
            </div>
          ) : !groupes.length ? (
            <p className="py-6 text-[13.5px] text-muted">{t('Aucun client pour l’instant.')}</p>
          ) : (
            groupes.map((g) => (
              <div key={g.id} className="flex flex-col gap-2" data-groupe-de-projet={g.id}>
                <h2 className="flex min-w-0 items-center gap-2 text-[13px] text-faint" data-intitule-de-projet={g.id}>
                  <CelluleProjet id={g.id} nom={g.nom} />
                  <span className="shrink-0 tabular-nums">
                    · {t('{n} client(s)', { n: g.clients.length })} · {g.total ? t('{n} demande(s)', { n: g.total }) : t('aucune demande')}
                  </span>
                </h2>
                {g.lignes.length ? (
                  <ApercuAuSurvol lire={(id) => g.lignes.find((l) => l.demande.id === id)} rendu={(l) => <ApercuDeDemande ligne={l} />} actif={vue === 'tableau'}>
                    <Tableau
                      repere={`demandes-${g.id}`}
                      lignes={g.lignes}
                      cle={(l) => l.demande.id}
                      onLigne={ouvrir}
                      aere
                      recherche={false}
                      /* UN TABLEAU PAR PROJET : en cartes, aucun n'ajoute son propre bouton de tri à la rangée du titre. */
                      sansMenuDeTri
                      colonnes={colonnesDesDemandes((f) => couleurDuClient(rangs.get(f.clientId) ?? 0))}
                      attributsLigne={(l) => ({ 'data-demande-de-l-accueil': l.demande.id, 'data-fiche-client': l.client?.clientId })}
                      pile={(l) => (
                        <>
                          <span className="min-w-0 flex-1">
                            <TitreEtSous titre={l.demande.titre} sous={l.client?.nomAffiche ?? l.demande.auteurNom} />
                          </span>
                          <EtatDeDemande demande={l.demande} />
                        </>
                      )}
                      {...(vue === 'cartes'
                        ? {
                            grille: (l: LigneDeDemande) => (
                              <CarteDeTableau
                                projet={l.projet}
                                etat={<EtatDeDemande demande={l.demande} />}
                                titre={l.demande.titre}
                                texte={l.demande.description}
                                chiffres={[
                                  { libelle: t('Client'), valeur: l.client?.nomAffiche ?? l.demande.auteurNom },
                                  { libelle: t('À traiter'), valeur: aTraiterDe(l.demande) || '—' },
                                  { libelle: t('Dernière activité'), valeur: jourCourt(l.demande.derniereActivite) },
                                ]}
                                data-demande-carte={l.demande.id}
                              />
                            ),
                          }
                        : {})}
                    />
                  </ApercuAuSurvol>
                ) : null}
              </div>
            ))
          )}
        </section>
      </div>
    </ZoneDefilement>
  );
}

/** Ce qui reste à traiter sur une demande : ses commentaires non lus, plus un point si on ne l'a jamais ouverte. */
function aTraiterDe(d: DemandeAffichee): number {
  return d.resume.nonLus + (d.resume.jamaisOuverte ? 1 : 0);
}

function EtatDeDemande({ demande }: { demande: DemandeAffichee }) {
  return (
    <span className={cn('inline-flex h-6 items-center rounded-md bg-raised px-2 text-[12px] font-medium', TON_COLONNE[COULEURS_COLONNES_DEMANDE[demande.colonne]])} data-etat-demande={demande.colonne}>
      {t(TITRES_COLONNES_DEMANDE[demande.colonne])}
    </span>
  );
}

/** Les colonnes du tableau des demandes d'un projet (14/11/2026). */
function colonnesDesDemandes(couleur: (fiche: FicheClientTableau) => string): ColonneDuTableauCommun<LigneDeDemande>[] {
  return [
    { cle: 'demande', libelle: t('Demande'), valeur: (l) => l.demande.titre, rendu: (l) => <span className="block truncate font-medium text-text">{l.demande.titre}</span> },
    {
      cle: 'client',
      libelle: t('Client'),
      largeur: 200,
      secondaire: true,
      valeur: (l) => l.client?.nomAffiche ?? l.demande.auteurNom,
      rendu: (l) => (
        <span className="flex min-w-0 items-center gap-2">
          {l.client ? <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: couleur(l.client) }} aria-hidden /> : null}
          <span className="truncate text-muted">{l.client?.nomAffiche ?? l.demande.auteurNom}</span>
        </span>
      ),
    },
    { cle: 'etat', libelle: t('État'), largeur: 130, valeur: (l) => COLONNES_DEMANDE.indexOf(l.demande.colonne), rendu: (l) => <EtatDeDemande demande={l.demande} /> },
    {
      cle: 'a-traiter',
      libelle: t('À traiter'),
      largeur: 100,
      droite: true,
      valeur: (l) => aTraiterDe(l.demande),
      rendu: (l) => (aTraiterDe(l.demande) ? <Pastille nombre={aTraiterDe(l.demande)} ton="repondre" /> : <span className="text-faint">—</span>),
    },
    { cle: 'activite', libelle: t('Dernière activité'), largeur: 150, droite: true, valeur: (l) => l.demande.derniereActivite, rendu: (l) => <span className="text-muted">{jourCourt(l.demande.derniereActivite)}</span> },
  ];
}

/** L'aperçu d'une demande au survol : son projet, son client, sa description, ses chiffres. */
function ApercuDeDemande({ ligne: l }: { ligne: LigneDeDemande }) {
  return (
    <CorpsDApercu
      sous={`${l.projet.nom} · ${l.client?.nomAffiche ?? l.demande.auteurNom}`}
      titre={l.demande.titre}
      texte={l.demande.description || undefined}
      chiffres={[
        { libelle: t('État'), valeur: t(TITRES_COLONNES_DEMANDE[l.demande.colonne]) },
        { libelle: t('Commentaires'), valeur: l.demande.resume.commentaires },
        { libelle: t('À traiter'), valeur: aTraiterDe(l.demande) },
        { libelle: t('Dernière activité'), valeur: jourCourt(l.demande.derniereActivite) },
      ]}
    />
  );
}

/**
 * LA SILHOUETTE DE CET ÉCRAN. Ses blocs ont les MÊMES dimensions que les vrais :
 * à l'arrivée des chiffres, rien ne se décale.
 */
export function SilhouetteAccueil({ avecClients = true }: { avecClients?: boolean } = {}) {
  return (
    <div className={cn('mx-auto min-h-0 w-full max-w-[820px] flex-1 space-y-10 px-4 pb-12 pt-2 sm:px-8 sm:pt-8', TELEPHONE_ENTRE_SECTIONS)} data-silhouette="accueil-messagerie">
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
      <div className={cn('space-y-6', TELEPHONE_ENTRE_SECTIONS)}>
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
