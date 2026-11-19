import * as React from 'react';
import { EtatVideDuProjet, useProjetDuService } from '@/components/projet-du-service';
import { CalendarClock, ExternalLink, Loader2, RefreshCw, Repeat, X } from '@/components/ui/icones';
import {
  construireFragment,
  veilleActive,
  veilleAReparer,
  type EtapeParcours,
  type EtatVeille,
  type VeilleListee,
} from '@beluga/shared';
import { Button, CLASSE_GROUPE_DE_LIGNES, CLASSE_LIGNE_DE_GROUPE, ConfirmDialog, DialogTitle, Drawer, EnteteDeFeuille, TitreDePage, ZoneDefilement } from '@/components/ui';
import { dateDeDepartLisible } from '@/components/depart-de-la-carte';
import { Tableau } from '@/components/ui/tableau';
import { ApercuAuSurvol, BasculeTableauCartes, CorpsDApercu, useVueDeLaListe } from '@/components/ui/apercu-au-survol';
import { colonneProjet } from '@/components/ui/colonne-projet';
import { CarteDeTableau } from '@/components/ui/carte-de-tableau';
import { BasculeDePage, RechercheDuService } from '@/components/fenetre-de-service';
import { SilhouetteTachesRecurrentes } from '@/components/silhouettes';
import { BoutonDeReparation, heureLisible, horairesDeLaVeille, issueLisible, quandLisible, ResultatDeVeille, useGestesDeVeille } from '@/components/veille-de-carte';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import { useTelephone } from '@/lib/telephone';
import { CranDuFil, SuiteDuFil } from '@/components/entete-de-zone';

/**
 * LE SERVICE « TÂCHES RÉCURRENTES » (demande du 22/10/2026) — les VEILLES
 * posées par les agents (`veille_poser`), réunies projet par projet : ce qui
 * se revérifie tout seul, sans moteur, en attendant un tiers.
 *
 * La colonne de gauche liste les projets qui ont des veilles (avec le nombre
 * de celles qui courent) ; à droite, les veilles du projet choisi — celles qui
 * courent en haut, les terminées (levée, arrêtée, échue) dessous dans
 * « Historique », replié. Une ligne ouvre le TIROIR de sa veille : ce qu'elle
 * vérifie, à quel rythme, ses horaires, et les deux gestes du bandeau de la
 * carte. Sur téléphone, où la colonne n'existe pas, la page montre la liste des
 * projets tant qu'aucun n'est choisi ; la flèche de la barre d'en-tête y ramène
 * (`data-recurrentes-retour`).
 *
 * La liste se lit au DÉMON (`veilles.lister`), jamais dans les cartes chargées
 * de l'écran, et se relit à chaque `veilles.compte` : une veille posée,
 * contrôlée ou terminée change la page ouverte.
 */

/** La clé d'un projet dans l'adresse ; les veilles dont la carte a disparu se rangent sous « sans-carte ». */
const SANS_CARTE = 'sans-carte';
const cleDuProjet = (projectId: string | null) => projectId ?? SANS_CARTE;

function etatLisible(etat: EtatVeille): string {
  return etat === 'en_cours'
    ? t('Active')
    : etat === 'levee'
      ? t('Blocage levé')
      : etat === 'expiree'
        ? t('Échue')
        : etat === 'attend_deploiement'
          ? t('Après le déploiement')
          : t('Arrêtée');
}

function frequenceLisible(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes === 60) return t('toutes les heures');
  return minutes % 60 === 0 ? t('toutes les {n} h', { n: minutes / 60 }) : t('toutes les {n} min', { n: minutes });
}

function etapeLisible(etape: EtapeParcours): string {
  switch (etape.action) {
    case 'aller':
      return t('Ouvrir {adresse}', { adresse: etape.url });
    case 'remplir':
      return t('Remplir le champ {cible}', { cible: etape.selecteur });
    case 'cliquer':
      return t('Cliquer sur {cible}', { cible: etape.selecteur });
    case 'attendre':
      return etape.selecteur ? t('Attendre {cible}', { cible: etape.selecteur }) : t('Attendre {n} s', { n: Math.round((etape.ms ?? 0) / 1000) });
    case 'verifierTexte':
      return t('Chercher le texte « {texte} »', { texte: etape.texte });
    case 'verifierSelecteur':
      return t('Vérifier la présence de {cible}', { cible: etape.selecteur });
  }
}

/** Ce que la veille vérifie, en phrases : une par étape. */
function ceQuiEstVerifie(veille: VeilleListee): string[] {
  const { recette } = veille;
  if (recette.recette.type === 'parcours') return recette.recette.etapes.map(etapeLisible);
  return [
    recette.recette.motAttendu
      ? t('Ouvrir {adresse} et chercher « {texte} »', { adresse: recette.url, texte: recette.recette.motAttendu })
      : t('Ouvrir {adresse} et vérifier qu’elle répond', { adresse: recette.url }),
  ];
}

/** La liste, lue au démon à l'ouverture puis à chaque changement annoncé. */
function useVeilles(open: boolean): VeilleListee[] | null {
  const signal = useApp().veilles.a;
  const [veilles, setVeilles] = React.useState<VeilleListee[] | null>(null);
  React.useEffect(() => {
    if (!open) return;
    let vivant = true;
    client
      .call<{ veilles: VeilleListee[] }>({ type: 'veilles.lister' })
      .then((r) => vivant && setVeilles(r.veilles ?? []))
      .catch(() => vivant && setVeilles((v) => v ?? []));
    return () => {
      vivant = false;
    };
  }, [open, signal]);
  return veilles;
}

/** Une carte qui attend sa date de départ (`cartes.programmees`). */
interface CarteProgrammee {
  id: string;
  projectId: string;
  title: string;
  departPrevu: number;
}

/** Les départs programmés, lus au démon à l'ouverture ; `relire` après une annulation. */
function useCartesProgrammees(open: boolean): { cartes: CarteProgrammee[] | null; relire: () => void } {
  const [cartes, setCartes] = React.useState<CarteProgrammee[] | null>(null);
  const [tour, setTour] = React.useState(0);
  React.useEffect(() => {
    if (!open) return;
    let vivant = true;
    client
      .call<{ cartes: CarteProgrammee[] }>({ type: 'cartes.programmees' })
      .then((r) => vivant && setCartes(r.cartes ?? []))
      .catch(() => vivant && setCartes((c) => c ?? []));
    return () => {
      vivant = false;
    };
  }, [open, tour]);
  return { cartes, relire: () => setTour((n) => n + 1) };
}

/**
 * « DÉPARTS PROGRAMMÉS » (page « Tâches planifiées », 19/11/2026) : les cartes qui partiront seules à leur date,
 * choisie dans leur configuration (ligne « Départ »). Chaque ligne : le titre, le projet, la date ; elle ouvre la
 * carte, et « Annuler le départ » retire la date (`card.schedule` sans date) — la carte attend alors son « Lancer ».
 */
function DepartsProgrammes({
  cartes,
  nomDuProjet,
  relire,
}: {
  cartes: CarteProgrammee[];
  nomDuProjet: (id: string) => string;
  relire: () => void;
}) {
  const [annulation, setAnnulation] = React.useState<string | null>(null);
  /* Sur téléphone le bouton dit « Annuler » : le titre de la carte garde la place. */
  const telephone = useTelephone();
  const annuler = async (id: string) => {
    setAnnulation(id);
    try {
      await client.call({ type: 'card.schedule', id });
      relire();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Réglage impossible'));
    } finally {
      setAnnulation(null);
    }
  };
  return (
    <section className="mb-5" data-departs-programmes={cartes.length}>
      <h2 className="mb-1.5 px-1 text-[12.5px] uppercase tracking-wide text-faint">{t('Départs programmés')}</h2>
      <div className={CLASSE_GROUPE_DE_LIGNES}>
        {cartes.map((c) => (
          <div key={c.id} className={cn(CLASSE_LIGNE_DE_GROUPE, 'flex min-w-0 items-center gap-3 py-2.5')} data-depart-programme={c.id}>
            <CalendarClock className="h-4 w-4 shrink-0 text-faint" aria-hidden />
            <button type="button" className="flex min-w-0 flex-1 flex-col text-left" onClick={() => ouvrirLaCarte(c.projectId, c.id)} title={t('Ouvrir la carte')}>
              <span className="truncate text-[14px] font-medium text-text">{c.title}</span>
              <span className="truncate text-[12.5px] text-faint">
                {dateDeDepartLisible(c.departPrevu)} · {nomDuProjet(c.projectId)}
              </span>
            </button>
            <Button
              variant="subtle"
              size="sm"
              className="shrink-0"
              disabled={annulation === c.id}
              onClick={() => void annuler(c.id)}
              data-annuler-depart={c.id}
            >
              {annulation === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {telephone ? t('Annuler') : t('Annuler le départ')}
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Ouvre la carte d'une veille dans son projet, par l'adresse : la carte n'a pas besoin d'être déjà chargée. */
function ouvrirLaCarte(projectId: string, cardId: string): void {
  window.history.pushState(null, '', `#${construireFragment({ vue: 'projet', projectId, cardId })}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function TachesRecurrentes({
  open,
  enPage,
  onClose,
  vise,
  veilleVisee,
  onVise,
}: {
  open: boolean;
  enPage?: boolean;
  onClose: () => void;
  /** Le projet choisi (« sans-carte » pour les veilles orphelines). */
  vise: string | null;
  /** La veille ouverte dans le tiroir. */
  veilleVisee: string | null;
  onVise: (projet: string | null, veilleId?: string | null) => void;
}) {
  const state = useApp();
  const veilles = useVeilles(open);
  const { cartes: programmees, relire: relireLesProgrammees } = useCartesProgrammees(open);

  /* DANS L'ONGLET D'UN PROJET (refonte du 13/11/2026) : ce projet, et lui seul. */
  const projetDuService = useProjetDuService();
  React.useEffect(() => {
    if (projetDuService && vise !== projetDuService.id) onVise(projetDuService.id);
  }, [projetDuService, vise, onVise]);

  const nomDuProjet = (cle: string) =>
    cle === SANS_CARTE ? t('Cartes supprimées') : state.projects.find((p) => p.id === cle)?.name ?? cle;
  const veilleOuverte = veilleVisee ? veilles?.find((v) => v.id === veilleVisee) ?? null : null;

  /*
   * UN SEUL TABLEAU, PLUS DE FEUILLE (décision du 13/11/2026, maquette #c7a3) : dans l'onglet d'un projet, ses tâches
   * récurrentes ; sous « Tous les projets », toutes, avec la colonne Projet. Une ligne ouvre le tiroir de sa veille.
   * L'ancienne feuille du téléphone se rouvrait toute seule et restait posée sur les autres onglets : elle n'existe
   * plus.
   */
  const lignes = React.useMemo(
    () => (veilles ?? []).filter((v) => !projetDuService || v.projectId === projetDuService.id),
    [veilles, projetDuService?.id],
  );
  const departs = (programmees ?? []).filter((c) => !projetDuService || c.projectId === projetDuService.id);
  const blocDesDeparts = departs.length ? <DepartsProgrammes cartes={departs} nomDuProjet={nomDuProjet} relire={relireLesProgrammees} /> : null;
  const ouvrir = (v: VeilleListee) => onVise(cleDuProjet(v.projectId), v.id);
  const [recherche, setRecherche] = React.useState('');
  const [vueDeLaListe, setVueDeLaListe] = useVueDeLaListe('taches-recurrentes.vueDeLaListe');
  const dernierControle = (v: VeilleListee) => v.dernierControle?.a ?? v.termineA ?? v.creeA;
  /* LA LIGNE ENTIÈRE OUVRE LA VEILLE, ET UN APERÇU AU SURVOL dit son dernier contrôle (carte « Onglets, services et
     listes repensés », 14/11/2026). */
  const tableau = (
    <ApercuAuSurvol lire={(id) => lignes.find((v) => v.id === id)} rendu={(v) => <ApercuDeVeille veille={v} projet={nomDuProjet(cleDuProjet(v.projectId))} />}>
    <Tableau<VeilleListee>
      repere="taches-recurrentes"
      lignes={lignes}
      cle={(v) => v.id}
      onLigne={ouvrir}
      rechercheExterne={recherche}
      {...(vueDeLaListe === 'cartes'
        ? {
            grille: (v: VeilleListee) => (
              <CarteDeTableau
                projet={{ id: v.projectId ?? null, nom: nomDuProjet(cleDuProjet(v.projectId)) }}
                etat={<EtatDeVeille veille={v} />}
                titre={v.raison}
                texte={v.dernierControle?.detail ?? v.titreCarte ?? ''}
                chiffres={[
                  { libelle: t('Rythme'), valeur: frequenceLisible(v.intervalleMs) },
                  { libelle: t('Dernier contrôle'), valeur: quandLisible(dernierControle(v)) },
                  { libelle: t('Résultat'), valeur: v.dernierControle ? issueLisible(v.dernierControle.issue) : '—' },
                ]}
                data-recurrentes-carte={v.id}
              />
            ),
          }
        : {})}
      disposition="auto"
      pied="toujours"
      triInitial={{ colonne: 'controle', sens: 'desc' }}
      vide={t('Aucune tâche récurrente pour l’instant.')}
      attributsLigne={(v) => ({ 'data-recurrentes-veille': v.id, 'data-veille': v.etat })}
      colonnes={[
        {
          cle: 'tache',
          libelle: t('Tâche récurrente'),
          valeur: (v) => v.raison,
          filtre: 'texte',
          rendu: (v) => (
            <button type="button" className="block w-full min-w-0 truncate text-left text-text" title={v.raison} onClick={() => ouvrir(v)}>
              {v.raison}
            </button>
          ),
        },
        /* LA COLONNE PROJET COMMUNE (14/11/2026) : pastille et nom ; le filtre des projets de la page la remplace comme
           filtre. */
        colonneProjet<VeilleListee>((v) => ({ id: v.projectId ?? null, nom: nomDuProjet(cleDuProjet(v.projectId)) }), { largeur: 200 }),
        {
          cle: 'etat',
          libelle: t('État'),
          valeur: (v) => etatLisible(v.etat),
          filtre: 'choix',
          rendu: (v) => <EtatDeVeille veille={v} />,
        },
        { cle: 'rythme', libelle: t('Rythme'), valeur: (v) => v.intervalleMs, rendu: (v) => <span className="text-muted">{frequenceLisible(v.intervalleMs)}</span>, masqueSurTelephone: true },
        {
          cle: 'controle',
          libelle: t('Dernier contrôle'),
          valeur: dernierControle,
          sensNaturel: 'desc',
          rendu: (v) => <span className="text-muted">{quandLisible(dernierControle(v))}</span>,
        },
      ]}
    />
    </ApercuAuSurvol>
  );

  if (projetDuService && veilles !== null && programmees !== null && !lignes.length && !departs.length) {
    return (
      <Drawer open={open} onClose={onClose} enPage={enPage}>
        <EtatVideDuProjet
          icone={<Repeat />}
          titre={t('Aucune tâche récurrente pour {v0}', { v0: projetDuService.name })}
          texte={t('Une tâche récurrente revient d’elle-même : vérifier chaque matin une fiche, relancer une publication, surveiller un concurrent… Demandez-la à un agent dans une tâche de ce projet : elle apparaîtra ici.')}
          data-recurrentes-vide-projet
        />
      </Drawer>
    );
  }

  return (
    <Drawer open={open} onClose={onClose} enPage={enPage}>
      <TitreDePage className="max-sm:sr-only">{t('Tâches planifiées')}</TitreDePage>
      {lignes.length ? (
        <>
          <RechercheDuService valeur={recherche} onChange={setRecherche} placeholder={t('Rechercher une tâche…')} data-recurrentes-recherche />
          <BasculeDePage>
            <BasculeTableauCartes repere="vue-des-recurrentes" valeur={vueDeLaListe} onChange={setVueDeLaListe} />
          </BasculeDePage>
        </>
      ) : null}
      <ZoneDefilement fond="hsl(var(--bg))" className="pb-6">
        {blocDesDeparts}
        {blocDesDeparts && veilles !== null ? (
          <h2 className="mb-1.5 px-1 text-[12.5px] uppercase tracking-wide text-faint">{t('Tâches récurrentes')}</h2>
        ) : null}
        {veilles === null ? (
          <SilhouetteTachesRecurrentes />
        ) : !lignes.length ? (
          <p className="text-[14px] text-muted" data-recurrentes-vide>
            {t('Aucune tâche récurrente pour l’instant. Quand un agent attend un tiers, il pose une veille qui revérifie toute seule : elle apparaîtra ici.')}
          </p>
        ) : (
          <div data-recurrentes-tableau={projetDuService ? 'projet' : 'tous'}>{tableau}</div>
        )}
      </ZoneDefilement>
      <TiroirDeVeille veille={veilleOuverte} onClose={() => onVise(vise, null)} />
    </Drawer>
  );
}

/** L'état d'une veille : un point vert quand elle tourne, rouge à réparer, gris sinon. */
function EtatDeVeille({ veille: v }: { veille: VeilleListee }) {
  return veilleActive(v) ? (
    <span className="inline-flex items-center gap-1.5 text-text">
      <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-text" aria-hidden />
      {etatLisible(v.etat)}
    </span>
  ) : (
    <span className={veilleAReparer(v) ? 'text-danger' : 'text-muted'}>{etatLisible(v.etat)}</span>
  );
}

/** L'aperçu d'une veille au survol : son projet, son état, son rythme et le résultat de son dernier contrôle. */
function ApercuDeVeille({ veille: v, projet }: { veille: VeilleListee; projet: string }) {
  const controle = v.dernierControle;
  return (
    <CorpsDApercu
      sous={[projet, v.titreCarte ?? t('carte supprimée')].join(' · ')}
      titre={v.raison}
      chiffres={[
        { libelle: t('État'), valeur: etatLisible(v.etat) },
        { libelle: t('Rythme'), valeur: frequenceLisible(v.intervalleMs) },
        { libelle: t('Dernier contrôle'), valeur: controle ? quandLisible(controle.a) : t('jamais') },
        { libelle: t('Résultat'), valeur: controle ? issueLisible(controle.issue) : '—' },
      ]}
    >
      {controle?.detail ? <p className={cn('line-clamp-3 pt-1 text-[12px] leading-snug', controle.issue === 'levee' ? 'text-muted' : 'text-faint')}>{controle.detail}</p> : null}
      {veilleActive(v) ? <p className="pt-1 text-[12px] text-faint">{horairesDeLaVeille(v)}</p> : null}
    </CorpsDApercu>
  );
}

/** Une ligne du tiroir : son nom à gauche, sa valeur dessous sur téléphone, à droite ailleurs. */
function Ligne({ nom, children }: { nom: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4">
      <dt className="shrink-0 text-[12.5px] text-faint sm:w-40">{nom}</dt>
      <dd className="min-w-0 flex-1 select-text break-words text-[13.5px] text-text">{children}</dd>
    </div>
  );
}

function TiroirDeVeille({ veille, onClose }: { veille: VeilleListee | null; onClose: () => void }) {
  const telephone = useTelephone();
  /* Le tiroir garde la dernière veille montrée pendant qu'il se referme. */
  const derniere = React.useRef<VeilleListee | null>(null);
  if (veille) derniere.current = veille;
  const v = veille ?? derniere.current;
  return (
    /* UN VRAI TIROIR PAR-DESSUS LA PAGE (15/11/2026) : la feuille commune sur ordinateur — la liste reste dessous —, la
       feuille du bas pleine hauteur sur téléphone (DEC-474). La veille ouverte est le dernier cran du fil de la page. */
    <Drawer open={!!veille} onClose={onClose} feuille={!telephone} empile className={telephone ? undefined : 'h-[85dvh]'}>
      {v && veille ? (
        <SuiteDuFil onRacine={onClose} retour={{ action: onClose, reperes: { 'data-recurrentes-retour': '' } }}>
          <CranDuFil data-recurrentes-cran={v.id}>{v.raison}</CranDuFil>
        </SuiteDuFil>
      ) : null}
      {v ? <ContenuDuTiroir key={v.id} veille={v} /> : null}
    </Drawer>
  );
}

function ContenuDuTiroir({ veille }: { veille: VeilleListee }) {
  const { occupe, agir, resultat } = useGestesDeVeille(veille.cardId);
  const [confirmer, setConfirmer] = React.useState(false);
  const active = veilleActive(veille);
  const arretable = active || veille.etat === 'expiree' || veille.etat === 'attend_deploiement';
  const controle = veille.dernierControle;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-recurrentes-tiroir={veille.id} data-veille={veille.etat}>
      <div className="flex shrink-0 flex-col gap-2 px-3 pb-3">
        {/* Le titre monte dans la barre d'en-tête, comme dernier cran du fil d'Ariane. */}
        <DialogTitle className="min-w-0 truncate">{veille.raison}</DialogTitle>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-raised px-2.5 py-0.5 text-[12px] text-muted" data-recurrentes-etat={veille.etat}>
            {etatLisible(veille.etat)}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-1">
            <BoutonDeReparation veille={veille} occupe={occupe} agir={(g) => void agir(g)} />
            {active ? (
              <Button variant="ghost" size="sm" disabled={occupe !== null} onClick={() => void agir('verifier')} data-veille-verifier>
                {occupe === 'verifier' ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                {t('Vérifier maintenant')}
              </Button>
            ) : null}
            {arretable ? (
              <Button variant="ghost" size="sm" disabled={occupe !== null} onClick={() => setConfirmer(true)} data-veille-arreter>
                {occupe === 'arreter' ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                {t('Arrêter la veille')}
              </Button>
            ) : null}
          </div>
        </div>
        <ResultatDeVeille resultat={resultat} />
      </div>
      <ZoneDefilement className="px-3 pb-6">
        <dl className="flex flex-col">
          <Ligne nom={t('Carte')}>
            {veille.projectId && veille.titreCarte ? (
              <button
                type="button"
                className="inline-flex max-w-full items-start gap-1.5 text-left hover:underline"
                onClick={() => ouvrirLaCarte(veille.projectId!, veille.cardId)}
                data-recurrentes-ouvrir-carte
              >
                <span className="min-w-0 break-words">{veille.titreCarte}</span>
                <ExternalLink className="mt-[3px] h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
              </button>
            ) : (
              <span className="text-muted">{t('carte supprimée')}</span>
            )}
          </Ligne>
          <Ligne nom={t('Ce qui est vérifié')}>
            <ul className="flex flex-col gap-0.5">
              {ceQuiEstVerifie(veille).map((phrase, i) => (
                <li key={i}>{phrase}</li>
              ))}
            </ul>
            {veille.recette.recette.explication ? <p className="mt-1 text-muted">{veille.recette.recette.explication}</p> : null}
            {veille.recette.profil ? (
              <p className="mt-1 text-muted">{t('Page lue avec la session « {profil} »', { profil: veille.recette.profil })}</p>
            ) : null}
          </Ligne>
          <Ligne nom={t('Blocage levé quand')}>
            {veille.recette.leveeSi === 'contenuAbsent' ? t('le contenu vérifié a disparu') : t('le contrôle réussit')}
          </Ligne>
          <Ligne nom={t('Rythme')}>{frequenceLisible(veille.intervalleMs)}</Ligne>
          <Ligne nom={t('Posée le')}>{quandLisible(veille.creeA)}</Ligne>
          <Ligne nom={veille.etat === 'expiree' ? t('Échue le') : t('Échéance')}>{quandLisible(veille.echeance)}</Ligne>
          <Ligne nom={t('Dernier contrôle')}>
            {controle ? (
              <>
                <span className={controle.issue === 'panne' ? 'text-danger' : undefined} data-veille-dernier={controle.issue}>
                  {t('{date}, {issue}', { date: quandLisible(controle.a), issue: issueLisible(controle.issue) })}
                </span>
                {controle.detail ? <p className="mt-0.5 text-muted">{controle.detail}</p> : null}
              </>
            ) : (
              <span className="text-muted">{t('aucun pour l’instant')}</span>
            )}
          </Ligne>
          {active && veille.prochainControleA ? <Ligne nom={t('Prochain contrôle')}>{heureLisible(veille.prochainControleA)}</Ligne> : null}
          {!active && veille.termineA ? <Ligne nom={t('Terminée le')}>{quandLisible(veille.termineA)}</Ligne> : null}
        </dl>
      </ZoneDefilement>
      <ConfirmDialog
        open={confirmer}
        title={t('Arrêter cette veille ?')}
        description={t('Le contrôle cesse. La carte reste en pause : c’est votre prochain message qui relancera l’agent.')}
        confirmLabel={t('Arrêter la veille')}
        danger
        onConfirm={() => {
          setConfirmer(false);
          void agir('arreter');
        }}
        onClose={() => setConfirmer(false)}
      />
    </div>
  );
}
