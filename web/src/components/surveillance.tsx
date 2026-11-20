import { useTiroirAdresse } from '@/lib/tiroirs-adresse';
import * as React from 'react';
import { EtatVideDuProjet, useProjetDuService } from '@/components/projet-du-service';
import { Activity, AlertTriangle, Check, CheckCircle2, ChevronDown, ExternalLink, Eye, Loader2, Plus, RefreshCw, Send, Trash2, Wrench } from '@/components/ui/icones';
import {
  type Agent,
  type CaseDeFrise,
  type ControleSurveillance,
  DEMANDE_SURVEILLANCE_MAX,
  LIBELLE_RAISON,
  PERIODE_SURVEILLANCE_MS,
  type SiteSurveille,
  type ConstatWordpress,
  type DernierNettoyage,
  JOURS_GARDES_JOURNAL,
  type SouciWordpress,
  aSurveiller,
  alerteGraveWordpress,
  estImportant,
  apaisement,
  disponibilite24h,
  frise24h,
  raisonDemandeSurveillanceRefusee,
} from '@beluga/shared';
import {
  BulleInfo,
  Badge,
  Button,
  ConfirmDialog,
  DialogTitle,
  TitreDePage,
  Drawer,
  HAUTEUR_DE_CONTROLE,
  Textarea,
  Tooltip,
  ZoneDefilement,
} from '@/components/ui';
import { SilhouetteSurveillance } from '@/components/silhouettes';
import { BoutonPrincipal, CranDuFil, GestePrincipal, OptionDePage, OptionsDePage, SuiteDuFil } from '@/components/entete-de-zone';
import { CLASSE_SECTION_DE_SERVICE, ColonneDeService, useColonneDeService } from '@/components/colonne-de-service';
import { GesteDeCreationDeColonne, RubriqueDeColonne } from '@/components/rubriques-de-colonne';
import { EnTeteDePanneau, Panneau } from '@/components/panneau';
import { Chat } from '@/components/chat';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { useTelephone } from '@/lib/telephone';
import { formatRegional, t } from '@/lib/langue';
import { PasAPas } from '@/components/pas-a-pas';
import { ApercuAuSurvol, BasculeTableauCartes, CorpsDApercu, useVueDeLaListe } from '@/components/ui/apercu-au-survol';
import { colonneProjet } from '@/components/ui/colonne-projet';
import { CarteDeTableau } from '@/components/ui/carte-de-tableau';
import { BasculeDePage, RechercheDuService } from '@/components/fenetre-de-service';
import { TitreEtSous } from '@/components/ui/apercu-de-ligne';
import { Tableau, type ColonneDuTableauCommun } from '@/components/ui/tableau';
import { bytes, cn } from '@/lib/utils';
import { useElementAdresse } from '@/lib/adresse-element';

/**
 * LA SURVEILLANCE DES SITES — une liste, et un tiroir par surveillance.
 *
 * Ce que la fenêtre montre vient du MAGASIN, jamais d'une copie locale : la
 * pastille du menu et cette liste lisent la même chose. Une tournée du serveur
 * les met à jour toutes les deux, fenêtre ouverte ou fermée.
 *
 * ON NE TAPE PLUS UNE ADRESSE, ON PARLE À UN AGENT. « Nouvelle surveillance »
 * ouvre un tiroir empilé (la liste reste ouverte derrière) où une phrase lance
 * l'agent de surveillance ; sa conversation s'y suit aussitôt. Un clic sur une
 * ligne ouvre le tiroir de CETTE surveillance : son état, la frise de ses
 * contrôles des dernières 24 heures, et la conversation de son agent pour la
 * modifier.
 *
 * EN HAUT, DEUX BANDEAUX QUI NE COEXISTENT JAMAIS : ce qui est tombé (rouge,
 * nommé), ou l'apaisement (vert) quand tout est revenu après une panne récente.
 */

function quand(instant: number): string {
  if (!instant) return t('jamais');
  return new Date(instant).toLocaleTimeString(formatRegional(), { hour: '2-digit', minute: '2-digit' });
}

function rythme(site: SiteSurveille): string {
  return t('toutes les {n} min', { n: Math.round((site.periodeMs ?? PERIODE_SURVEILLANCE_MS) / 60_000) });
}

export function Surveillance({
  open,
  onClose,
  enPage,
  vise,
  onVise,
}: {
  open: boolean;
  onClose: () => void;
  /** Écran plein du volet central, au lieu d'un tiroir posé par-dessus. */
  enPage?: boolean;
  /** LE SITE DÉSIGNÉ PAR L'ADRESSE : « #surveillance/<id> ». */
  vise?: string | null;
  /** …et le site ouvert, remonté pour que l'adresse le décrive. */
  onVise?: (siteId: string | null) => void;
}) {
  const state = useApp();
  /* DANS L'ONGLET D'UN PROJET (refonte du 13/11/2026) : les sites rattachés à ce projet seulement. */
  const projetDuService = useProjetDuService();
  const sites = projetDuService
    ? state.surveillance.filter((site) => site.projetRattache === projetDuService.id)
    : state.surveillance;
  const [verifEnCours, setVerifEnCours] = React.useState(false);
  const [aSupprimer, setASupprimer] = React.useState<SiteSurveille | null>(null);
  /** Le tiroir ouvert : une surveillance, ou « nouvelle ». */
  const [tiroir, setTiroir] = React.useState<{ siteId: string } | { nouvelle: true } | null>(null);
  useTiroirAdresse(
    'nouveau-site-surveillance',
    tiroir !== null && 'nouvelle' in tiroir,
    (ouvert) => setTiroir((avant) => (ouvert ? { nouvelle: true } : avant && 'nouvelle' in avant ? null : avant)),
  );

  // La liste vit dans le magasin, mais le serveur ne la rediffuse qu'aux
  // changements : à l'ouverture, on la redemande une fois.
  React.useEffect(() => {
    if (!open) return;
    client.send({ type: 'surveillance.lister' });
  }, [open]);

  /*
   * LE TIROIR D'UN SITE EST UNE DESTINATION, « nouvelle surveillance » NON :
   * un formulaire en cours de saisie n'a pas d'adresse à partager, et ne doit
   * pas se rouvrir tout seul au rechargement.
   */
  useElementAdresse({
    vise,
    onVise,
    ouvertId: tiroir && 'siteId' in tiroir ? tiroir.siteId : null,
    /* La liste vit dans le magasin : tant qu'elle est vide, elle n'est pas
       « sans le site visé », elle n'est pas encore arrivée. */
    pret: sites.length > 0,
    absent: t('Ce site n’est plus surveillé.'),
    ouvrir: (id) => {
      if (!sites.some((site) => site.id === id)) return false;
      setTiroir({ siteId: id });
      return true;
    },
  });

  const [recherche, setRecherche] = React.useState('');
  const [vueDeLaListe, setVueDeLaListe] = useVueDeLaListe('surveillance.vueDeLaListe');
  const nomDuProjet = (id: string | null | undefined) => (id ? (state.projects.find((p) => p.id === id)?.name ?? null) : null);
  const enPanne = sites.filter((site) => site.etat === 'panne');
  const apaise = apaisement(sites, Date.now());
  /* LA COLONNE DE GAUCHE EST CELLE DE LA SURVEILLANCE (demande du 12/10/2026) :
     le geste qui crée, détaché, le classement par état et « Vérifier
     maintenant ». Sur téléphone, ces gestes restent dans la page. */
  const dansLaColonne = useColonneDeService();
  const [etatRetenu, setEtatRetenu] = React.useState<'tous' | 'panne' | 'a-surveiller'>('tous');
  const aSurveillerListe = sites.filter((site) => site.etat !== 'panne' && aSurveiller(site));
  const sitesAffiches =
    etatRetenu === 'panne' ? enPanne : etatRetenu === 'a-surveiller' ? aSurveillerListe : sites;

  const verifier = async () => {
    setVerifEnCours(true);
    try {
      await client.call({ type: 'surveillance.verifier' }, 120_000);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Vérification impossible'));
    } finally {
      setVerifEnCours(false);
    }
  };

  const supprimer = async (site: SiteSurveille) => {
    try {
      await client.call({ type: 'surveillance.supprimer', id: site.id });
      setTiroir((actuel) => (actuel && 'siteId' in actuel && actuel.siteId === site.id ? null : actuel));
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Adresse non retirée'));
    }
  };

  /* UN PROJET SANS SURVEILLANCE, OUVERT EN ONGLET : il le dit, et propose de commencer (maquette #4e4f) — UNE FOIS LA
     LISTE REÇUE (20/11/2026) : avant, la page montre sa silhouette, jamais un « aucune surveillance » à tort. */
  if (projetDuService && state.surveillanceRecue && !sites.length && tiroir === null) {
    return (
      <Drawer open={open} onClose={onClose} enPage={enPage}>
        <EtatVideDuProjet
          icone={<Activity />}
          titre={t('Aucune surveillance pour {v0}', { v0: projetDuService.name })}
          texte={t('Un agent contrôle régulièrement que le site répond, et vous prévient au premier signe de panne.')}
          action={t('Créer une surveillance')}
          onAction={() => setTiroir({ nouvelle: true })}
          note={t('Le premier contrôle part dès la création.')}
          fond={<SilhouetteSurveillance lignes={8} />}
          data-surveillance-vide
        />
      </Drawer>
    );
  }

  return (
    <>
      <Drawer open={open} onClose={onClose} enPage={enPage}>
        <TitreDePage>{t('Surveillance')}</TitreDePage>
        {sites.length ? (
          <>
            <RechercheDuService valeur={recherche} onChange={setRecherche} placeholder={t('Rechercher un site…')} data-surveillance-recherche />
            <BasculeDePage>
              <BasculeTableauCartes repere="vue-de-la-surveillance" valeur={vueDeLaListe} onChange={setVueDeLaListe} />
            </BasculeDePage>
          </>
        ) : null}
        {dansLaColonne ? null : (
          <>
          {/* SUR TÉLÉPHONE : « Vérifier maintenant » est une ligne du menu à trois
              points (qui tourne pendant la vérification), « Nouvelle
              surveillance » le bouton du bas de l'écran. */}
          <OptionsDePage enCours={verifEnCours}>
            <OptionDePage
              data-surveillance-verifier
              disabled={verifEnCours || !sites.length}
              onClick={() => void verifier()}
              icone={verifEnCours ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            >
              {t('Vérifier maintenant')}
            </OptionDePage>
          </OptionsDePage>
          <GestePrincipal>
            <BoutonPrincipal data-surveillance-nouvelle onClick={() => setTiroir({ nouvelle: true })}>
              <Plus className="h-3 w-3" />
              {t('Nouvelle surveillance')}
            </BoutonPrincipal>
          </GestePrincipal>
          </>
        )}
        <ColonneDeService>
          <nav aria-label="Rubriques de la surveillance" data-colonne-surveillance className="flex min-h-0 flex-1 flex-col gap-0.5 pt-1">
            <GesteDeCreationDeColonne
              libelle={t('Nouvelle surveillance')}
              aria-label="Nouvelle surveillance"
              data-surveillance-nouvelle
              onClick={() => setTiroir({ nouvelle: true })}
            />
            <RubriqueDeColonne
              icone={<Activity />}
              libelle={t('Toutes les surveillances')}
              compte={sites.length}
              actif={etatRetenu === 'tous'}
              onClick={() => setEtatRetenu('tous')}
              data-surveillance-rubrique="tous"
            />
            {enPanne.length || etatRetenu === 'panne' ? (
              <RubriqueDeColonne
                icone={<AlertTriangle />}
                libelle={t('En panne')}
                compte={enPanne.length}
                actif={etatRetenu === 'panne'}
                onClick={() => setEtatRetenu('panne')}
                data-surveillance-rubrique="panne"
              />
            ) : null}
            {aSurveillerListe.length || etatRetenu === 'a-surveiller' ? (
              <RubriqueDeColonne
                icone={<Eye />}
                libelle={t('À surveiller')}
                compte={aSurveillerListe.length}
                actif={etatRetenu === 'a-surveiller'}
                onClick={() => setEtatRetenu('a-surveiller')}
                data-surveillance-rubrique="a-surveiller"
              />
            ) : null}
            <p className={CLASSE_SECTION_DE_SERVICE}>{t('Actions')}</p>
            <RubriqueDeColonne
              icone={<RefreshCw />}
              libelle={t('Vérifier maintenant')}
              enCours={verifEnCours}
              disabled={verifEnCours || !sites.length}
              onClick={() => void verifier()}
              data-surveillance-verifier
            />
          </nav>
        </ColonneDeService>

        {/* Le bandeau : ce qui est tombé, ou l'apaisement. Jamais les deux. */}
        {enPanne.length ? (
          <div
            data-surveillance-bandeau="panne"
            className="mb-4 shrink-0 rounded-xl bg-danger/10 px-4 py-3 text-[14px] text-danger"
          >
            {enPanne.length > 1
              ? t('{n} sites ne répondent plus.', { n: enPanne.length })
              : t('{site} ne répond plus.', { site: enPanne[0].nom })}
          </div>
        ) : apaise ? (
          <div
            data-surveillance-bandeau="apaise"
            className="mb-4 flex shrink-0 items-center gap-2 px-1 text-[14px] text-muted"
          >
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            {t('Tout est revenu en ligne.')}
          </div>
        ) : null}

        <ZoneDefilement fond="hsl(var(--bg))" className="pb-6">
          {!state.surveillanceRecue ? (
            /* RIEN N'EST ENCORE ARRIVÉ : la liste est vide parce qu'on ne la
               connaît pas, pas parce qu'aucune adresse n'est surveillée. */
            <SilhouetteSurveillance />
          ) : !sites.length ? (
            <PasAPas
              repere="surveillance"
              titre={t('Aucune surveillance pour l’instant. Créez-en une avec l’agent.')}
              explication={t('La surveillance vérifie vos sites à intervalle régulier et vous prévient dès que l’un d’eux tombe.')}
              etapes={[
                t('Demandez à l’agent de surveiller une adresse.'),
                t('Il prépare la vérification et l’essaie devant vous.'),
                t('Une panne vous est signalée, et une enquête se lance si elle se répète.'),
              ]}
            />
          ) : !sitesAffiches.length ? (
            <p className="px-1 py-3 text-[12.5px] text-faint">{t('Aucune surveillance dans cette rubrique.')}</p>
          ) : (
            /* LES SURVEILLANCES EN TABLEAU (carte « Onglets, services et listes repensés », 14/11/2026) : site, état,
               dernier contrôle, temps de réponse, rythme, et « Retirer » au bout ; l'aperçu au survol dit le reste. */
            <ApercuAuSurvol lire={(id) => sitesAffiches.find((s) => s.id === id)} rendu={(s) => <ApercuDeSurveillance site={s} />}>
              <Tableau
                repere="surveillance"
                lignes={sitesAffiches}
                cle={(s) => s.id}
                onLigne={(s) => setTiroir({ siteId: s.id })}
                aere
                attributsLigne={(s) => ({ 'data-surveillance-site': s.id, 'data-etat': s.etat, 'data-attention': aSurveiller(s) ? '' : undefined })}
                colonnes={colonnesDeSurveillance((s) => setASupprimer(s), nomDuProjet)}
                rechercheExterne={recherche}
                {...(vueDeLaListe === 'cartes'
                  ? {
                      grille: (s: SiteSurveille) => (
                        <CarteDeTableau
                          projet={{ id: s.projetRattache ?? null, nom: nomDuProjet(s.projetRattache) }}
                          etat={<BadgeEtat site={s} />}
                          titre={s.nom}
                          texte={s.url}
                          chiffres={[
                            { libelle: t('Réponse'), valeur: tempsDeReponse(s) },
                            { libelle: t('Rythme'), valeur: rythme(s) },
                            { libelle: t('Contrôlé à'), valeur: quand(s.verifieLe) },
                          ]}
                          data-surveillance-carte={s.id}
                        />
                      ),
                    }
                  : {})}
                pile={(s) => (
                  <>
                    <span className="min-w-0 flex-1">
                      <TitreEtSous titre={s.nom} sous={`${s.url} · ${t('vu à {heure}', { heure: quand(s.verifieLe) })}`} />
                    </span>
                    <BadgeEtat site={s} />
                  </>
                )}
              />
            </ApercuAuSurvol>
          )}
        </ZoneDefilement>
      </Drawer>

      <TiroirSurveillance
        cible={tiroir}
        site={tiroir && 'siteId' in tiroir ? (sites.find((s) => s.id === tiroir.siteId) ?? null) : null}
        sites={sites}
        onChoisirSite={(siteId) => setTiroir({ siteId })}
        onClose={() => setTiroir(null)}
        onSupprimer={(site) => setASupprimer(site)}
      />

      <ConfirmDialog
        open={aSupprimer !== null}
        title={t('Ne plus surveiller cette adresse ?')}
        description={aSupprimer?.url}
        confirmLabel={t('Retirer')}
        danger
        onConfirm={() => {
          const site = aSupprimer;
          setASupprimer(null);
          if (site) void supprimer(site);
        }}
        onClose={() => setASupprimer(null)}
      />
    </>
  );
}

/** La pastille d'état d'une surveillance : la même dans la liste et dans le tiroir. */
function BadgeEtat({ site }: { site: SiteSurveille }) {
  if (site.etat === 'panne') {
    const raison = site.raison ? t(LIBELLE_RAISON[site.raison]) : '';
    return (
      <Badge tone="danger" data-surveillance-etat="panne">
        {raison || t('En panne')}
        {site.code ? ` ${site.code}` : ''}
      </Badge>
    );
  }
  // Debout, mais le contrôle WordPress a relevé un souci : jaune, jamais orange
  // (l'orange dit « en cours ») ni rouge (réservé à la panne).
  if (aSurveiller(site))
    return (
      <Badge tone="attention" data-surveillance-etat="attention">
        {t('À surveiller')}
      </Badge>
    );
  if (site.etat === 'ok')
    return (
      <Badge tone="success" data-surveillance-etat="ok">
        {t('En ligne')}
      </Badge>
    );
  return (
    <Badge tone="neutral" data-surveillance-etat="inconnu">
      {t('Pas encore vérifié')}
    </Badge>
  );
}

function tempsDeReponse(site: SiteSurveille): string {
  return site.dureeMs ? t('{n} ms', { n: Math.round(site.dureeMs).toLocaleString(formatRegional()) }) : '—';
}

/** Les colonnes du tableau des surveillances (14/11/2026). */
function colonnesDeSurveillance(onSupprimer: (site: SiteSurveille) => void, nomDuProjet: (id: string | null | undefined) => string | null): ColonneDuTableauCommun<SiteSurveille>[] {
  return [
    { cle: 'site', libelle: t('Site'), valeur: (s) => s.nom, filtre: 'texte', lireFiltre: (s) => `${s.nom} ${s.url}`, rendu: (s) => <TitreEtSous titre={s.nom} sous={s.url} /> },
    colonneProjet<SiteSurveille>((s) => ({ id: s.projetRattache ?? null, nom: nomDuProjet(s.projetRattache) }), { largeur: 170, secondaire: true }),
    { cle: 'etat', libelle: t('État'), largeur: 150, valeur: (s) => (s.etat === 'panne' ? 0 : aSurveiller(s) ? 1 : s.etat === 'ok' ? 2 : 3), sensNaturel: 'asc', rendu: (s) => <BadgeEtat site={s} /> },
    { cle: 'controle', libelle: t('Dernier contrôle'), largeur: 130, droite: true, valeur: (s) => s.verifieLe, rendu: (s) => <span className="text-muted">{quand(s.verifieLe)}</span> },
    { cle: 'reponse', libelle: t('Temps de réponse'), largeur: 170, droite: true, secondaire: true, valeur: (s) => s.dureeMs ?? null, rendu: (s) => <span className="tabular-nums text-muted">{tempsDeReponse(s)}</span> },
    { cle: 'rythme', libelle: t('Rythme'), largeur: 140, secondaire: true, valeur: (s) => s.periodeMs ?? PERIODE_SURVEILLANCE_MS, rendu: (s) => <span className="truncate text-faint">{rythme(s)}</span> },
    {
      cle: 'gestes',
      libelle: '',
      largeur: 52,
      libre: true,
      rendu: (s) => (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Retirer"
          title={t('Retirer')}
          data-surveillance-supprimer={s.id}
          onClick={(e) => {
            e.stopPropagation();
            onSupprimer(s);
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      ),
    },
  ];
}

/** L'aperçu d'une surveillance au survol : son état, depuis quand, sa dernière panne, sa réponse, son rythme. */
function ApercuDeSurveillance({ site: s }: { site: SiteSurveille }) {
  return (
    <CorpsDApercu
      sous={s.url}
      titre={s.nom}
      chiffres={[
        { libelle: t('État'), valeur: <BadgeEtat site={s} /> },
        { libelle: t('Temps de réponse'), valeur: tempsDeReponse(s) },
        { libelle: t('Dernier contrôle'), valeur: quand(s.verifieLe) },
        { libelle: t('Dernière panne'), valeur: s.dernierePanne ? jourEtHeure(s.dernierePanne) : t('jamais') },
      ]}
    >
      <p className="pt-1 text-[12px] text-faint">
        {s.depuis ? t('Dans cet état depuis le {date}', { date: jourEtHeure(s.depuis) }) : null}
        {s.depuis ? ' · ' : null}
        {rythme(s)}
      </p>
    </CorpsDApercu>
  );
}

/**
 * LE TIROIR D'UNE SURVEILLANCE, empilé sur la liste. Pour une surveillance :
 * l'état, la frise des 24 heures, puis la conversation de son agent. Pour une
 * nouvelle : la phrase qui lance l'agent, puis sa conversation.
 */
function TiroirSurveillance({
  cible,
  site,
  sites,
  onChoisirSite,
  onClose,
  onSupprimer,
}: {
  cible: { siteId: string } | { nouvelle: true } | null;
  site: SiteSurveille | null;
  /** Les autres sites surveillés, sous le chevron du cran du fil. */
  sites: readonly SiteSurveille[];
  onChoisirSite: (siteId: string) => void;
  onClose: () => void;
  onSupprimer: (site: SiteSurveille) => void;
}) {
  const state = useApp();
  const telephone = useTelephone();
  /* LE CRAN DU FIL NE PORTE QUE LE NOM DU PROJET (15/11/2026, capture #f46c1 : « InVia », jamais « InVia —
     association-invia.ch ») ; un site sans projet rattaché garde son nom. */
  const nomDuCran = (s: SiteSurveille) => (s.projetRattache ? state.projects.find((p) => p.id === s.projetRattache)?.name : null) ?? s.nom;
  /** L'agent lancé depuis ce tiroir, avant qu'il n'ait enregistré quoi que ce soit. */
  const [depart, setDepart] = React.useState<{ agentId: string; projectId: string } | null>(null);

  React.useEffect(() => setDepart(null), [cible && 'siteId' in cible ? cible.siteId : cible ? 'nouvelle' : null]);

  const agentId = depart?.agentId ?? site?.agentId;
  const projectId = depart?.projectId ?? site?.projectId;
  const agent: Agent | null = agentId ? (state.agents[agentId] ?? null) : null;

  // La conversation peut n'être jamais passée par ce navigateur : on la réclame.
  React.useEffect(() => {
    if (agentId) void client.chargerAgent(agentId);
  }, [agentId]);

  const ouvert = cible !== null && ('nouvelle' in cible || site !== null);

  const historique = useHistoriqueDuSite(site);
  const { choisie, setChoisie } = historique;
  // Le volet refermé oublie la case choisie : il se rouvre sur sa tête, sans détail.
  React.useEffect(() => {
    if (!ouvert) setChoisie(null);
  }, [ouvert]);
  /** Ce qui défile sous la tête : le détail de la case choisie, puis WordPress. */
  const defileRef = React.useRef<HTMLDivElement>(null);

  // UNE CASE TOUCHÉE : son détail paraît en tête de la partie qui défile, et
  // cette partie remonte pour qu'on le voie.
  React.useEffect(() => {
    if (!choisie) return;
    const zone = zoneQuiDefile(defileRef.current);
    if (zone) zone.scrollTo({ top: 0, behavior: 'smooth' });
  }, [choisie?.debut]);

  /*
   * LA TÊTE NE BOUGE PAS. Le titre et son état, l'adresse, les gestes, le projet
   * du site, puis la frise des 24 heures restent fixes en haut du volet. Tout
   * le reste — le détail d'une case, l'état WordPress, puis la conversation —
   * défile d'un seul tenant entre cette tête et la barre d'écriture.
   */
  const teteFixe = (
    <div className={cn('flex shrink-0 flex-col', site && 'border-b border-faint/30')} data-surveillance-tete-fixe="">
      {/* LE NOM DU SITE EST LE DERNIER CRAN DU FIL D'ARIANE — « Tableaux de bord ›
          Surveillance › InVia » : il monte dans la barre d'en-tête de la page, son
          état juste à sa droite (demande du 31/10/2026), ses gestes tout à droite
          (`EnTeteDuSite`). Plus de second en-tête sous la barre. */}
      <DialogTitle className="min-w-0 truncate px-3 pb-2">
        {site ? (
          <span className="flex min-w-0 items-center gap-2" data-surveillance-titre-et-etat>
            <span className="min-w-0 truncate">{site.nom}</span>
            <BadgeEtat site={site} />
          </span>
        ) : (
          t('Nouvelle surveillance')
        )}
      </DialogTitle>
      {site ? (
        <div className="flex flex-col gap-2 px-3 pb-3" data-surveillance-infos="">
          <EnTeteDuSite site={site} onSupprimer={() => onSupprimer(site)} />
          <FriseDuSite historique={historique} />
        </div>
      ) : null}
    </div>
  );
  const aDefiler = Boolean(site && (choisie || site.wordpress));
  const defile = site ? (
    <div ref={defileRef} className="contents" data-surveillance-defilement-tete="">
      {choisie ? (
        <div className="px-3 pt-3">
          <DetailDeCase tranche={choisie} />
        </div>
      ) : null}
      {site.wordpress ? <EtatWordpress key={site.id} site={site} /> : null}
    </div>
  ) : null;

  return (
    /* UN VRAI TIROIR PAR-DESSUS LA PAGE (15/11/2026) : la feuille commune — elle monte du bas, sur ordinateur comme sur
       téléphone (DEC-474) —, la liste des sites reste dessous. Son site est le dernier cran du fil de la page. */
    <Drawer open={ouvert} onClose={onClose} feuille={!telephone} empile className="h-[92dvh]">
      {site ? (
        <SuiteDuFil onRacine={onClose} retour={{ action: onClose, reperes: { 'data-surveillance-retour': '' } }}>
          <CranDuFil
            voisinsSurLeDernier
            voisins={{
              nom: nomDuCran(site),
              valeur: site.id,
              titre: t('Surveillance'),
              repere: 'surveillance-site',
              options: sites.map((s) => ({ valeur: s.id, libelle: s.nom })),
              onChoisir: (id) => (id === site.id ? undefined : onChoisirSite(id)),
            }}
            data-surveillance-cran-du-site={site.id}
          >
            {nomDuCran(site)}
          </CranDuFil>
        </SuiteDuFil>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col" data-surveillance-tiroir={site?.id ?? 'nouvelle'}>
        {teteFixe}
        {agent && projectId ? (
          <div className="flex min-h-0 flex-1 flex-col" data-surveillance-conversation={agent.id}>
            <Chat agent={agent} projectId={projectId} enTeteDuFil={aDefiler ? defile : undefined} enTeteDuFilLibre />
          </div>
        ) : (
          <>
            <ZoneDefilement className="flex flex-col">
              {defile}
              {agentId ? (
                <div className="flex flex-1 items-center justify-center py-6 text-faint">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : null}
            </ZoneDefilement>
            {agentId ? null : (
              <DemandeALAgent
                site={site}
                onLance={(d) => {
                  client.setActiveProject(d.projectId);
                  setDepart(d);
                }}
              />
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}

/** Le premier ancêtre qui défile vraiment (la zone du fil, ou celle du volet sans agent). */
function zoneQuiDefile(el: HTMLElement | null): HTMLElement | null {
  for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
    const o = getComputedStyle(n).overflowY;
    if (o === 'auto' || o === 'scroll') return n;
  }
  return null;
}

type HistoriqueDuSite = {
  controles: ControleSurveillance[] | null;
  choisie: CaseDeFrise | null;
  setChoisie: React.Dispatch<React.SetStateAction<CaseDeFrise | null>>;
};

/**
 * L'HISTORIQUE DES 24 HEURES, lu UNE fois pour la frise (fixe) et le détail
 * d'une case (qui défile) : les deux parties du volet partagent cet état.
 */
function useHistoriqueDuSite(site: SiteSurveille | null): HistoriqueDuSite {
  const [controles, setControles] = React.useState<ControleSurveillance[] | null>(null);
  const [choisie, setChoisie] = React.useState<CaseDeFrise | null>(null);
  const id = site?.id;

  React.useEffect(() => setChoisie(null), [id]);

  // L'historique se charge à l'ouverture, et se relit après chaque passage.
  React.useEffect(() => {
    if (!id) {
      setControles(null);
      return;
    }
    let vivant = true;
    client
      .call<{ controles: ControleSurveillance[] }>({ type: 'surveillance.historique', id })
      .then((r) => vivant && setControles(r.controles))
      .catch(() => vivant && setControles([]));
    return () => {
      vivant = false;
    };
  }, [id, site?.verifieLe]);

  return { controles, choisie, setChoisie };
}

/**
 * CE QUI EST VÉRIFIÉ ET LES GESTES, fixes en haut du volet : adresse, rythme,
 * recette, étape en échec, « Vérifier maintenant » (toute la largeur), la
 * corbeille seule tout à droite, puis le projet du site.
 */
function EnTeteDuSite({ site, onSupprimer }: { site: SiteSurveille; onSupprimer: () => void }) {
  const [verifEnCours, setVerifEnCours] = React.useState(false);
  const recette = site.recette;

  const verifier = async () => {
    setVerifEnCours(true);
    try {
      await client.call({ type: 'surveillance.verifier', id: site.id }, 120_000);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Vérification impossible'));
    } finally {
      setVerifEnCours(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-faint">
        <span className="min-w-0 truncate">{site.url}</span>
        <span aria-hidden>·</span>
        <span>{rythme(site)}</span>
        <span aria-hidden>·</span>
        <span data-surveillance-recette={recette?.type ?? 'appel'}>
          {recette?.type === 'parcours'
            ? t('Parcours de {n} étapes', { n: recette.etapes.length })
            : recette?.motAttendu
              ? t('« {mot} » doit figurer sur la page', { mot: recette.motAttendu })
              : t('Simple appel de la page')}
        </span>
      </div>
      {site.etat === 'panne' && site.etapeEchouee ? (
        <p className="text-[12px] text-danger" data-surveillance-etape-echouee>
          {t('Étape en échec : {etape}', { etape: site.etapeEchouee })}
        </p>
      ) : null}
      {/* LES GESTES DU SITE, DANS LA TÊTE FIXE DU TIROIR (15/11/2026 : le tiroir couvre la page, ses gestes vivent en
          lui) : « Vérifier maintenant » sur toute la largeur, la corbeille seule collée à droite. */}
      <div className="flex min-w-0 items-center gap-1.5" data-surveillance-gestes="">
        <Button
          variant="subtle"
          size="sm"
          className={cn(HAUTEUR_DE_CONTROLE, 'min-w-0 flex-1')}
          disabled={verifEnCours}
          aria-busy={verifEnCours || undefined}
          onClick={() => void verifier()}
          data-surveillance-verifier-site
        >
          {verifEnCours ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {t('Vérifier maintenant')}
        </Button>
        <Button variant="ghost" size="icon" className={cn(HAUTEUR_DE_CONTROLE, 'w-9 shrink-0 text-muted')} title={t('Retirer')} aria-label="Retirer" onClick={onSupprimer} data-surveillance-retirer-site>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* « PROJET DE CE SITE » A QUITTÉ LE TIROIR (15/11/2026, capture #e385) : le lien du site à son projet reste en
          base — posé à la création, modifiable par l'agent du site. Seul le chemin vers la carte d'une panne reste. */}
      <CarteDeLaPanne site={site} />
    </>
  );
}

/** LA FRISE DES 24 HEURES et la disponibilité, fixes sous les gestes. */
function FriseDuSite({ historique }: { historique: HistoriqueDuSite }) {
  const { controles, choisie, setChoisie } = historique;
  const maintenant = Date.now();
  const cases = controles ? frise24h(controles, maintenant) : [];
  const dispo = controles ? disponibilite24h(controles, maintenant) : null;

  return (
    <div className="flex flex-col gap-1" data-surveillance-frise={controles ? controles.length : 'chargement'}>
      <div className="flex items-baseline gap-2 text-[12px]">
        <span className="min-w-0 flex-1 text-text">{t('Contrôles des dernières 24 heures')}</span>
        {dispo !== null ? (
          <span className="text-faint" data-surveillance-disponibilite>
            {t('Disponibilité : {pourcentage}', { pourcentage: `${Math.round(dispo * 1000) / 10} %` })}
          </span>
        ) : null}
      </div>
      {controles === null ? (
        <div className="h-6 animate-pulse rounded-sm bg-faint/15" />
      ) : (
        <div className="flex h-6 items-stretch gap-px" role="list">
          {cases.map((c) => (
            <Tooltip key={c.debut} label={libelleDeCase(c)}>
              <button
                type="button"
                role="listitem"
                aria-label={libelleDeCase(c)}
                data-surveillance-case={c.etat}
                onClick={() => setChoisie((actuelle) => (actuelle?.debut === c.debut ? null : c))}
                className={cn(
                  'min-w-0 flex-1 rounded-[2px]',
                  c.etat === 'ok' ? 'bg-success' : c.etat === 'panne' ? 'bg-danger' : 'bg-faint/20',
                  choisie?.debut === c.debut && 'ring-1 ring-faint',
                )}
              />
            </Tooltip>
          ))}
        </div>
      )}
      {controles && !controles.length ? (
        <p className="text-[12px] text-faint">{t('Aucun contrôle sur les dernières 24 heures.')}</p>
      ) : null}
    </div>
  );
}

/** Un souci du contrôle WordPress, dit en clair dans la langue de l'écran. */
function phraseDeSouci(s: SouciWordpress): string {
  const version = s.version ?? '';
  switch (s.genre) {
    case 'faille':
      return s.versionCible
        ? t('Faille connue : {sujet} {version} — corrigée en {cible}', { sujet: s.sujet, version, cible: s.versionCible })
        : t('Faille connue : {sujet} {version} — aucun correctif, à désactiver', { sujet: s.sujet, version });
    case 'desactivee':
      return t('Extension désactivée : {sujet}', { sujet: s.sujet });
    case 'disparue':
      return t('Extension disparue : {sujet}', { sujet: s.sujet });
    case 'pic':
      return t('Pic d’avertissements dans les journaux : {n} (habituellement {habituel})', {
        n: s.nombre ?? 0,
        habituel: s.habituel ?? 0,
      });
    case 'fatale':
      return t('Erreur grave dans les journaux');
    case 'maj':
      return t('Mise à jour disponible : {sujet} {version} → {cible}', { sujet: s.sujet, version, cible: s.versionCible ?? '?' });
    case 'abandon':
      return s.detail === 'fermee'
        ? t('Extension retirée du catalogue WordPress : {sujet}', { sujet: s.sujet })
        : t('Extension abandonnée (dernière mise à jour : {date}) : {sujet}', { sujet: s.sujet, date: s.date ?? '?' });
    case 'acces':
      return t('Contrôle WordPress impossible : accès au serveur refusé ou trop lent');
  }
}

/**
 * UN SOUCI EN DEUX ÉTAGES, pour sa rangée du bloc « État WordPress » : un TITRE
 * qui dit ce qui est touché (le nom de l'extension, mis en avant), puis un
 * DÉTAIL plus discret (versions, titre de la faille, chiffres). Le genre, lui,
 * passe dans l'étiquette de gravité (`etiquetteDeSouci`) : le redire dans la
 * phrase la rallongeait sans rien apprendre. `phraseDeSouci` garde la phrase
 * d'un seul tenant pour le suivi des 30 jours.
 */
function titreEtDetailDeSouci(s: SouciWordpress): { titre: string; details: string[] } {
  const version = s.version ?? '';
  switch (s.genre) {
    case 'faille':
      return {
        titre: s.sujet,
        details: [
          s.versionCible
            ? t('{version} — corrigée en {cible}', { version, cible: s.versionCible })
            : t('{version} — aucun correctif, à désactiver', { version }),
          ...(s.detail ? [s.detail] : []),
        ],
      };
    case 'desactivee':
    case 'disparue':
      return { titre: s.sujet, details: [] };
    case 'pic':
      return {
        titre: t('Pic d’avertissements dans les journaux'),
        details: [t('Avertissements : {n} (habituellement {habituel})', { n: s.nombre ?? 0, habituel: s.habituel ?? 0 })],
      };
    case 'fatale':
      return { titre: t('Erreur grave dans les journaux'), details: s.detail ? [s.detail] : [] };
    case 'maj':
      return { titre: s.sujet, details: [t('{version} → {cible}', { version, cible: s.versionCible ?? '?' })] };
    case 'abandon':
      return {
        titre: s.sujet,
        details: [
          s.detail === 'fermee'
            ? t('Retirée du catalogue WordPress')
            : t('Dernière mise à jour : {date}', { date: s.date ?? '?' }),
        ],
      };
    case 'acces':
      return { titre: t('Contrôle WordPress impossible'), details: [t('Accès au serveur refusé ou trop lent')] };
  }
}

/**
 * L'ÉTIQUETTE DE GRAVITÉ d'un souci : un mot court sur un fond teinté, avec la
 * pastille de couleur que portait l'ancienne ligne. Rouge pour une erreur
 * grave, jaune pour ce qui fait partir un courriel (`estImportant`), neutre pour
 * le reste. Le mot reste dans la couleur du texte : un jaune écrit sur fond
 * clair ne se lirait pas, la couleur vit dans la pastille et dans le fond.
 */
function etiquetteDeSouci(s: SouciWordpress): { libelle: string; gravite: 'grave' | 'importante' | 'simple' } {
  const gravite = s.genre === 'fatale' ? 'grave' : estImportant(s) ? 'importante' : 'simple';
  const libelle = {
    faille: t('Faille'),
    desactivee: t('Désactivée'),
    disparue: t('Disparue'),
    pic: t('Avertissements'),
    fatale: t('Erreur grave'),
    maj: t('Mise à jour'),
    abandon: s.detail === 'fermee' ? t('Retirée') : t('Abandonnée'),
    acces: t('Accès refusé'),
  }[s.genre];
  return { libelle, gravite };
}

/** Une date courte : le jour et l'heure. */
function jourEtHeure(instant: number): string {
  return new Date(instant).toLocaleString(formatRegional(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * L'ÉTAT WORDPRESS DU SITE — ce que le contrôle sans agent a relevé, dans un
 * BLOC À DEUX ÉTAGES (`EnTeteDePanneau` + `Panneau`) qui se détache du tiroir
 * par son fond. L'en-tête porte le titre, le nombre de soucis et l'heure du
 * relevé ; le panneau, une RANGÉE par souci (un fond d'une marche au-dessus,
 * `.panneau .panneau`), avec son étiquette de gravité, son titre, son détail et
 * sa date ; puis un PIED plus discret : clé de failles manquante, allègement du
 * journal, geste pour accepter les extensions, suivi des 30 derniers jours
 * (chargé à l'ouverture du tiroir et relu à chaque passage).
 *
 * REPLIABLE PAR SON EN-TÊTE. À l'ouverture du tiroir (le composant est monté
 * par site, `key={site.id}`), le bloc est OUVERT seulement s'il porte une
 * faille ou une erreur grave (`alerteGraveWordpress`), REPLIÉ sinon. Le choix
 * fait à la main tient jusqu'à la fermeture du tiroir : un nouveau relevé
 * (`wpResume` rafraîchi) ne le rouvre ni ne le referme. Rien n'est gardé
 * d'une ouverture à l'autre.
 */
function EtatWordpress({ site }: { site: SiteSurveille }) {
  const resume = site.wpResume;
  const [constats, setConstats] = React.useState<ConstatWordpress[] | null>(null);
  const [acceptation, setAcceptation] = React.useState(false);
  const [correction, setCorrection] = React.useState(false);
  const [deplie, setDeplie] = React.useState(() => alerteGraveWordpress(resume?.soucis ?? []));

  React.useEffect(() => {
    let vivant = true;
    client
      .call<{ constats: ConstatWordpress[] }>({ type: 'surveillance.wordpress', id: site.id })
      .then((r) => vivant && setConstats(r.constats))
      .catch(() => vivant && setConstats([]));
    return () => {
      vivant = false;
    };
  }, [site.id, resume?.extensionsLe, resume?.journauxLe]);

  const soucis = [...(resume?.soucis ?? [])].sort((a, b) => Number(estImportant(b)) - Number(estImportant(a)));
  const resolus = (constats ?? []).filter((c) => c.resoluLe);
  const aAccepter = soucis.some((s) => s.genre === 'desactivee' || s.genre === 'disparue');
  const clefManquante = Boolean(resume && !resume.faillesActives);
  const aUnPied = clefManquante || Boolean(resume?.dernierNettoyage) || aAccepter || resolus.length > 0;

  const accepter = async () => {
    setAcceptation(true);
    try {
      await client.call({ type: 'surveillance.wordpress.accepter', id: site.id });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('État non accepté'));
    } finally {
      setAcceptation(false);
    }
  };

  /* UN BOUTON QUI PART EN REQUÊTE LE DIT DÈS LE CLIC : roue, puis la carte s'ouvre. */
  const corriger = async () => {
    if (correction) return;
    setCorrection(true);
    try {
      const carte = await client.call<{ cardId: string; projectId: string }>({ type: 'surveillance.wordpress.corriger', id: site.id });
      if (carte?.cardId) client.allerVersDecision({ projectId: carte.projectId, cardId: carte.cardId });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('La carte de correction n’a pas pu s’ouvrir'));
    } finally {
      setCorrection(false);
    }
  };

  return (
    <section className="contents" data-surveillance-wordpress={soucis.length} data-surveillance-wordpress-ouvert={deplie ? 'oui' : 'non'}>
      {/* LE BLOC ENTIER RESTE EN HAUT QUAND ON DESCEND DANS LA CONVERSATION (demandes du 31/10/2026, captures #8f337
          et #760d) : la barre ET son contenu déplié collent ensemble, sur le fond de la zone, sans quoi il fallait
          remonter tout le fil pour relire les soucis. Le contenu est plafonné (~40 % de l'écran) et défile sur
          lui-même : une longue liste ne mange pas la conversation. Rien ne l'enferme : `section` et l'en-tête du fil
          sont en `contents`, sans quoi il ne collerait que le temps de leur propre hauteur. */}
      <div className="sticky top-0 z-10 bg-bg px-3 pb-2 pt-3" data-surveillance-wordpress-colle>
      <EnTeteDePanneau className={cn('p-0 text-[12px]', !deplie && 'rounded-md')}>
        <button
          type="button"
          aria-expanded={deplie}
          onClick={() => setDeplie((d) => !d)}
          className="flex min-h-[43px] sm:min-h-9 w-full items-center gap-2 rounded-[inherit] px-3.5 sm:px-3 py-2 sm:py-1.5 text-left"
          data-surveillance-wordpress-bascule=""
        >
          <ChevronDown aria-hidden className={cn('h-3.5 w-3.5 shrink-0 text-faint transition-transform', !deplie && '-rotate-90')} />
          <span className="min-w-0 truncate">{t('État WordPress')}</span>
          {soucis.length ? (
            <span
              className="shrink-0 rounded-full bg-text/10 px-1.5 py-px text-[11px] font-medium leading-tight tabular-nums text-text"
              title={t('Soucis en cours : {n}', { n: soucis.length })}
            >
              {soucis.length}
            </span>
          ) : null}
          <span className="ml-auto shrink-0 font-normal text-faint">
            {resume?.extensionsLe
              ? t('extensions vues à {heure}', { heure: quand(resume.extensionsLe) })
              : t('premier relevé en attente')}
          </span>
        </button>
      </EnTeteDePanneau>
      {deplie ? (
        <ZoneDefilement classeEnveloppe="max-h-[40vh] flex-none" data-surveillance-wordpress-contenu>
        <Panneau className="flex flex-col gap-2 text-[12px]">
          {soucis.length ? (
            <ul className="flex flex-col gap-1">
              {soucis.map((s) => {
                const { titre, details } = titreEtDetailDeSouci(s);
                const { libelle, gravite } = etiquetteDeSouci(s);
                return (
                  <li
                    key={s.cle}
                    className="panneau flex items-start gap-2 rounded-md px-2 py-1.5"
                    data-surveillance-souci={s.genre}
                  >
                    <span
                      className={cn(
                        'mt-px inline-flex w-[6.5rem] shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium leading-tight text-text',
                        gravite === 'grave' ? 'bg-danger/20' : gravite === 'importante' ? 'bg-a-surveiller/20' : 'bg-text/10',
                      )}
                      data-gravite={gravite}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'h-1.5 w-1.5 shrink-0 rounded-full',
                          gravite === 'grave' ? 'bg-danger' : gravite === 'importante' ? 'bg-a-surveiller' : 'bg-faint',
                        )}
                      />
                      <span className="min-w-0 truncate">{libelle}</span>
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="break-words font-medium text-text">{titre}</span>
                      {details.map((d) => (
                        <span key={d} className="break-words text-[11.5px] leading-snug text-faint">
                          {d}
                        </span>
                      ))}
                    </span>
                    <span className="mt-px shrink-0 text-[11px] text-faint">{t('depuis {date}', { date: jourEtHeure(s.depuis) })}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-faint">{resume?.extensionsLe ? t('Rien à signaler.') : t('Le contrôle WordPress passera dans l’heure.')}</p>
          )}
          {aUnPied ? (
            <div className="flex flex-col gap-1 pt-0.5">
              {clefManquante ? (
                <p className="text-faint" data-surveillance-failles-inactives>
                  {t('Failles connues non cherchées : la clé Wordfence manque au coffre-fort.')}
                </p>
              ) : null}
              {resume?.dernierNettoyage ? <LigneNettoyage nettoyage={resume.dernierNettoyage} /> : null}
              {aAccepter ? (
                <div>
                  <Button variant="ghost" size="sm" disabled={acceptation} onClick={() => void accepter()} data-surveillance-accepter>
                    {acceptation ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    {t('Accepter les extensions actuelles')}
                  </Button>
                </div>
              ) : null}
              {resolus.length ? (
                <details>
                  <summary className="cursor-pointer text-faint">{t('Suivi des 30 derniers jours ({n} réglés)', { n: resolus.length })}</summary>
                  <ul className="flex flex-col gap-0.5 pt-1 text-faint">
                    {resolus.map((c) => (
                      <li key={`${c.cle}-${c.premiereVue}`} className="flex gap-1.5">
                        <span className="min-w-0 flex-1">{phraseDeSouci(c)}</span>
                        <span className="shrink-0">{t('réglé le {date}', { date: jourEtHeure(c.resoluLe!) })}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}
          {soucis.length ? (
            <div className="flex justify-end pt-0.5">
              <Tooltip label={t('Ouvre une carte avec tout ce qui a été détecté, et un agent prépare la correction : rien n’est corrigé sans votre accord.')}>
                <Button size="sm" variant="subtle" disabled={correction} aria-busy={correction} onClick={() => void corriger()} data-surveillance-corriger>
                  {correction ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
                  {t('Corriger avec un agent')}
                </Button>
              </Tooltip>
            </div>
          ) : null}
        </Panneau>
        </ZoneDefilement>
      ) : null}
      </div>
    </section>
  );
}

/** Le dernier allègement des journaux propres à WordPress : la date, et le poids avant/après. */
function LigneNettoyage({ nettoyage }: { nettoyage: DernierNettoyage }) {
  const avant = nettoyage.journaux.reduce((n, j) => n + j.avant, 0);
  const apres = nettoyage.journaux.reduce((n, j) => n + j.apres, 0);
  return (
    <p className="text-[12px] text-faint" data-surveillance-nettoyage>
      {t('Journal d’erreurs allégé le {date} : {avant} → {apres} ({jours} derniers jours gardés)', {
        date: jourEtHeure(nettoyage.le),
        avant: bytes(avant),
        apres: apres ? bytes(apres) : t('{n} o', { n: 0 }),
        jours: JOURS_GARDES_JOURNAL,
      })}
    </p>
  );
}

/**
 * LE PROJET DU SITE — celui où s'ouvrira la carte d'une panne répétée.
 *
 * À ne pas confondre avec le projet où vit la conversation de l'agent qui a
 * écrit la recette : ce menu-là désigne le DÉPÔT QUI SERT LE SITE. Laissé « à
 * deviner d'après l'adresse », il se remplit tout seul en comparant l'adresse
 * du site à celles que les projets connaissent, et la ligne le dit.
 *
 * Quand une panne est ouverte, un bouton mène droit à sa carte.
 */
function CarteDeLaPanne({ site }: { site: SiteSurveille }) {
  if (!site.incidentCardId) return null;
  return (
    <div className="flex" data-surveillance-projet={site.projetRattache ?? ''}>
      <Button
        variant="subtle"
        size="sm"
        data-surveillance-carte-panne={site.incidentCardId}
        onClick={() => client.allerVersDecision({ cardId: site.incidentCardId })}
      >
        <ExternalLink className="h-3 w-3" />
        {t('Ouvrir la carte de la panne')}
      </Button>
    </div>
  );
}

function libelleDeCase(c: CaseDeFrise): string {
  const tranche = `${quand(c.debut)} – ${quand(c.fin)}`;
  if (c.etat === 'vide') return `${tranche} · ${t('Aucun contrôle')}`;
  const pannes = c.controles.filter((x) => x.etat === 'panne').length;
  return `${tranche} · ${t('{n} contrôles, {pannes} en panne', { n: c.controles.length, pannes })}`;
}

/** Les passages d'une tranche, touchée ou cliquée : l'heure, le résultat, la raison. */
function DetailDeCase({ tranche }: { tranche: CaseDeFrise }) {
  return (
    // En entier : la partie haute du tiroir défile déjà.
    <ul className="flex flex-col gap-0.5 text-[12px]" data-surveillance-detail>
      {tranche.controles.length ? (
        tranche.controles.map((c) => (
          <li key={c.instant} className={cn('flex flex-wrap gap-x-1.5', c.etat === 'panne' ? 'text-danger' : 'text-faint')}>
            <span>{quand(c.instant)}</span>
            <span>{c.etat === 'ok' ? t('En ligne') : c.raison ? t(LIBELLE_RAISON[c.raison]) : t('En panne')}</span>
            {c.code ? <span>{c.code}</span> : null}
            <span>{t('{duree} ms', { duree: c.dureeMs })}</span>
            {c.etape ? <span className="min-w-0 truncate">{c.etape}</span> : null}
          </li>
        ))
      ) : (
        <li className="text-faint">{t('Aucun contrôle')}</li>
      )}
    </ul>
  );
}

/** La phrase qui lance l'agent : créer une surveillance, ou modifier celle-ci. */
function DemandeALAgent({
  site,
  onLance,
}: {
  site: SiteSurveille | null;
  onLance: (depart: { agentId: string; projectId: string }) => void;
}) {
  const [demande, setDemande] = React.useState('');
  const [enCours, setEnCours] = React.useState(false);
  const refus = raisonDemandeSurveillanceRefusee(demande);

  const lancer = async () => {
    setEnCours(true);
    try {
      const depart = await client.call<{ agentId: string; projectId: string }>({
        type: 'surveillance.assistant',
        demande,
        ...(site ? { id: site.id } : {}),
      });
      setDemande('');
      onLance(depart);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('L’agent n’a pas pu démarrer'));
    } finally {
      setEnCours(false);
    }
  };

  return (
    <div className={cn('flex flex-col gap-2 px-3 pb-3', site && 'border-t border-border pt-3')}>
      <Textarea
        value={demande}
        onChange={(e) => setDemande(e.target.value)}
        maxLength={DEMANDE_SURVEILLANCE_MAX}
        rows={4}
        placeholder={t('Ex. : l’espace client de la boutique, se connecter et vérifier que le tableau de bord s’affiche, toutes les 5 minutes')}
        className="text-[13px]"
        data-surveillance-demande
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !refus && !enCours) void lancer();
        }}
      />
      <div className="flex items-center justify-end gap-1.5">
        <BulleInfo>
          {site
          ? t('Dites à l’agent ce qu’il faut changer : un nouveau mot de passe, une autre page à vérifier, un autre rythme.')
          : t(
              'Décrivez ce qu’il faut surveiller : l’adresse, les accès s’il faut se connecter, ce qui doit figurer sur la page et le rythme. L’agent pose ses questions, essaie le contrôle pour de vrai, puis l’enregistre.',
            )}
        </BulleInfo>
        <Button size="sm" disabled={!!refus || enCours} onClick={() => void lancer()} data-surveillance-demander>
          {enCours ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          {t('Demander à l’agent')}
        </Button>
      </div>
    </div>
  );
}
