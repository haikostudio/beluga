import * as React from 'react';
import { Check, ChevronLeft, ChevronRight, GitCommitHorizontal, Loader2, Rocket, Settings2 } from 'lucide-react';
import {
  type ColumnKey,
  type DeployRun,
  type EtatProduction,
  type Project,
  annonceMiseAJourProduction,
  descriptionDeLEtape,
  ecartProduction,
  empreinteCourte,
  membrePret,
  procedureEnPlace,
  productionEnRetard,
  raisonMembrePasPret,
  rapportAGarder,
  resumeDeLaProductionDuGroupe,
  runDeProductionDuMembre,
  suiviDeLaPublication,
} from '@beluga/shared';
import { BandeauProduction } from '@/components/deploy-panel';
import { BarreProgression } from '@/components/barre-progression';
import { PastilleProjet } from '@/components/pastille-projet';
import { ExplicationDeConfiguration } from '@/components/tiroir-procedure-production';
import { DeployControls } from '@/components/tiroir-deploiement';
import { CorpsDuVolet } from '@/components/volet-publication';
import { Button, ConfirmDialog, Pastille, ZoneDefilement } from '@/components/ui';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { useSeconde } from '@/lib/horloge';
import { ouvrirRubriqueDeLEtape } from '@/lib/ouvrir-config-projet';
import { lancerIntervalleVisible } from '@/lib/veille';
import { cn, elapsed } from '@/lib/utils';
import { t } from '@/lib/langue';

/** Ce que le contrôle d'avant-clic dit d'un membre. */
type ControleDuMembre = { occupes: string[]; bloquee: string | null };

/**
 * LE BANDEAU DE MISE EN PRODUCTION D'UN REGROUPEMENT.
 *
 * Un regroupement n'a ni dépôt ni processus : son bandeau proposait d'en
 * « initier » un, qui n'aurait rien eu à publier. Il DÉLÈGUE désormais à ses
 * projets membres. Le tiroir pose une ligne par membre — son état, son bouton,
 * son avancement — et un bouton en pied qui lance TOUS les membres prêts EN
 * MÊME TEMPS : aucun enchaînement, l'échec de l'un n'arrête pas l'autre, et
 * chaque refus s'écrit sur la ligne de son projet. Un clic sur une ligne ouvre
 * le suivi du membre (le MÊME `CorpsDuVolet` que partout), avec un retour.
 *
 * La barre, le tiroir et son entête restent ceux d'un projet seul
 * (`BandeauProduction`) ; les règles vivent dans `shared/src/production-de-groupe.ts`.
 * L'interrupteur et les réglages restent ceux de CHAQUE projet : le groupe
 * n'en a pas, et une ligne éteinte dit pourquoi.
 */
export function BandeauProductionGroupe({
  groupe,
  membres,
  colonne = 'archived',
}: {
  groupe: Pick<Project, 'id' | 'name'>;
  membres: Project[];
  colonne?: ColumnKey;
}) {
  const state = useApp();
  const [ouvert, setOuvert] = React.useState(false);
  /* Le membre dont le tiroir montre le suivi ; `null` : la liste. */
  const [detail, setDetail] = React.useState<string | null>(null);
  /* La dernière mise en PRODUCTION de chaque membre, relue en base : l'état du
     tableau ne porte que les projets déjà ouvert sur cet écran. */
  const [historique, setHistorique] = React.useState<Record<string, DeployRun | null>>({});
  const [etats, setEtats] = React.useState<Record<string, EtatProduction | null>>({});
  const [controles, setControles] = React.useState<Record<string, ControleDuMembre>>({});
  /* Les membres dont la demande est partie et n'a pas encore répondu. */
  const [envoi, setEnvoi] = React.useState<ReadonlySet<string>>(new Set());
  /* Le refus du serveur, écrit sur la ligne du membre jusqu'à son prochain lancement. */
  const [erreurs, setErreurs] = React.useState<Record<string, string>>({});
  const [confirmation, setConfirmation] = React.useState<{ ids: string[]; tous: boolean } | null>(null);
  /* L'instant du montage : une réussite arrivée APRÈS se dit, jamais celle
     retrouvée au rechargement. */
  const [depuis] = React.useState(() => Date.now());

  const ids = membres.map((membre) => membre.id).join(',');
  const lignes = membres.map((membre) => {
    const direct = state.deploys[membre.id];
    const run = runDeProductionDuMembre(direct, historique[membre.id]);
    const suivi = run ? suiviDeLaPublication(run) : null;
    const enCours = run?.state === 'running';
    const controle = controles[membre.id];
    const regle = {
      projet: membre,
      enCours,
      autrePublication: direct?.state === 'running' && direct.cible !== 'production',
      agentsOccupes: controle?.occupes,
      productionBloquee: controle?.bloquee,
      horsLigne: !state.connected,
    };
    return {
      membre,
      run,
      suivi,
      enCours,
      etat: etats[membre.id] ?? null,
      enPlace: procedureEnPlace(membre, 'production'),
      raison: raisonMembrePasPret(regle),
      pret: membrePret(regle),
    };
  });
  const resume = resumeDeLaProductionDuGroupe(lignes);
  const prets = lignes.filter((ligne) => ligne.pret && !envoi.has(ligne.membre.id));
  useSeconde(resume.enRoute);

  React.useEffect(() => {
    let vivant = true;
    for (const membre of membres) {
      void client
        .call<{ runs?: DeployRun[] }>({ type: 'deploy.historique', projectId: membre.id })
        .then((res) => {
          if (!vivant || !Array.isArray(res?.runs)) return;
          const dernier = res.runs.find((run) => run.cible === 'production') ?? null;
          setHistorique((prev) => ({ ...prev, [membre.id]: dernier }));
        })
        /* Un historique illisible n'est pas un incident : la ligne reste au repos. */
        .catch(() => undefined);
    }
    return () => {
      vivant = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  /* L'ÉTAT DE LA VERSION de chaque membre, relu quand une de leurs mises en
     production change d'état — c'est elle qui le fait bouger. Lecture seule. */
  const signatureDesEtats = lignes.map((ligne) => `${ligne.membre.id}:${ligne.enPlace}:${ligne.run?.state ?? ''}`).join(',');
  React.useEffect(() => {
    let vivant = true;
    for (const ligne of lignes) {
      if (!ligne.enPlace) continue;
      const id = ligne.membre.id;
      client
        .call({ type: 'deploy.etatProduction', projectId: id })
        .then((res: any) => {
          if (vivant) setEtats((prev) => ({ ...prev, [id]: res?.etat ?? null }));
        })
        .catch(() => {
          if (vivant) setEtats((prev) => ({ ...prev, [id]: null }));
        });
    }
    return () => {
      vivant = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signatureDesEtats]);

  /* LE CONTRÔLE D'AVANT-CLIC, tiroir ouvert seulement : agents au travail dans
     le dossier d'un membre, processus refusé. Rejoué toutes les vingt secondes,
     comme sur le bandeau d'un projet seul. */
  const signatureDuControle = lignes.map((ligne) => `${ligne.membre.id}:${ligne.enPlace}:${ligne.enCours}`).join(',');
  React.useEffect(() => {
    if (!ouvert) return;
    let vivant = true;
    const controler = () => {
      for (const ligne of lignes) {
        if (!ligne.enPlace || ligne.enCours) continue;
        const id = ligne.membre.id;
        client
          .call({ type: 'deploy.check', projectId: id, source: colonne })
          .then((res: any) => {
            if (!vivant) return;
            const occupes = (res?.busy ?? []).map((agent: { title: string }) => agent.title);
            setControles((prev) => ({ ...prev, [id]: { occupes, bloquee: res?.productionBloquee ?? null } }));
          })
          .catch(() => undefined);
      }
    };
    controler();
    const arreter = lancerIntervalleVisible(controler, 20000);
    return () => {
      vivant = false;
      arreter();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert, signatureDuControle, colonne]);

  /* Le tiroir refermé revient à la liste : le rouvrir ne tombe pas sur un détail oublié. */
  React.useEffect(() => {
    if (!ouvert) setDetail(null);
  }, [ouvert]);

  /* LE SUIVI D'UN MEMBRE DEMANDÉ D'AILLEURS (`client.demanderProduction`) : la
     carte violette de sa mise en production, en tête de « En cours », ouvre le
     tiroir du groupe DIRECTEMENT sur ce projet. */
  const productionDemandee = state.productionDemandee;
  React.useEffect(() => {
    if (!productionDemandee || !ids.split(',').includes(productionDemandee.projectId)) return;
    setOuvert(true);
    setDetail(productionDemandee.projectId);
    client.demanderProduction(null);
  }, [productionDemandee, ids]);

  /*
   * LE LANCEMENT — d'un membre ou de tous, par le MÊME chemin. Les demandes
   * partent ENSEMBLE et chacune rend son propre verdict (`allSettled`) : un
   * refus s'écrit sur la ligne de son projet sans retenir les autres.
   */
  const lancer = async (cibles: string[]) => {
    setEnvoi((prev) => new Set([...prev, ...cibles]));
    setErreurs((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !cibles.includes(id))));
    const issues = await Promise.allSettled(
      cibles.map((id) => client.call({ type: 'deploy.start', projectId: id, cible: 'production' })),
    );
    const refus: Record<string, string> = {};
    issues.forEach((issue, rang) => {
      if (issue.status === 'rejected') refus[cibles[rang]] = issue.reason?.message ?? t('Mise en production impossible');
    });
    setErreurs((prev) => ({ ...prev, ...refus }));
    setEnvoi((prev) => new Set([...prev].filter((id) => !cibles.includes(id))));
  };

  const ligneDuDetail = detail ? lignes.find((ligne) => ligne.membre.id === detail) : undefined;
  const aConfirmer = confirmation ? lignes.filter((ligne) => confirmation.ids.includes(ligne.membre.id)) : [];

  const boutonDuMembre = (ligne: (typeof lignes)[number], pied = false) => {
    const id = ligne.membre.id;
    const parti = envoi.has(id);
    /* PLEINE LARGEUR, sur la carte du projet comme en pied de son détail
       (05/10/2026) : le bouton occupe toute la largeur, sous le contenu. */
    return (
      <Button
        variant={pied ? 'default' : 'outline'}
        size="pied"
        className="shrink-0 gap-1.5"
        disabled={!ligne.pret || parti}
        title={ligne.raison ? t(ligne.raison) : undefined}
        onClick={() => setConfirmation({ ids: [id], tous: false })}
        data-bouton-production-membre={id}
      >
        {parti ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : <Rocket className="h-3 w-3 shrink-0" />}
        <span className="truncate">{t('Mettre en production')}</span>
      </Button>
    );
  };

  return (
    <BandeauProduction
      groupe
      projectId={groupe.id}
      colonne={colonne}
      suivi={resume.suivi}
      ouvert={ouvert}
      onOuvert={setOuvert}
      enRoute={resume.enRoute}
      tombee={resume.tombee}
      pourcent={resume.pourcent}
      enAttente={
        resume.enAttente
          ? {
              ...resume.enAttente,
              resume:
                resume.enAttente.nombre > 1
                  ? t('{n} versions en attente sur les projets du groupe', { n: resume.enAttente.nombre })
                  : resume.enAttente.nombre === 1
                    ? t('1 version en attente sur les projets du groupe')
                    : t('Les projets du groupe sont à jour'),
            }
          : null
      }
      titre={ligneDuDetail ? ligneDuDetail.membre.name : t('Mise en production')}
      avant={
        ligneDuDetail ? (
          <Button
            variant="ghost"
            size="icon"
            className="-ml-1.5 shrink-0 text-muted"
            onClick={() => setDetail(null)}
            aria-label="Retour à la liste des projets"
            title={t('Retour à la liste des projets')}
            data-retour-membres-production
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        ) : undefined
      }
      barre={
        resume.pourcent !== null ? (
          <BarreProgression
            className="absolute inset-x-0 bottom-0"
            pourcent={resume.pourcent}
            erreur={!resume.enRoute && resume.tombee}
            teinte="en-cours"
            data-barre-bandeau={groupe.id}
          />
        ) : null
      }
      deroule={
        ligneDuDetail ? (
          <DetailDuMembre
            ligne={ligneDuDetail}
            erreur={erreurs[ligneDuDetail.membre.id]}
            bouton={boutonDuMembre(ligneDuDetail, true)}
          />
        ) : null
      }
      corps={
        <div className="flex flex-col gap-2">
          <p className="text-[13px] leading-snug text-muted">
            {t('Chaque projet du groupe a sa propre mise en production : lancez-les un par un, ou tous en même temps.')}
          </p>
          <ul className="flex flex-col gap-1.5" data-membres-production={membres.length}>
            {lignes.map((ligne) => {
              const id = ligne.membre.id;
              const erreur = erreurs[id];
              const reussie = ligne.suivi?.etat === 'reussie' && (ligne.suivi.finiA ?? 0) >= depuis;
              const tombee = ligne.suivi?.etat === 'en-echec' || ligne.suivi?.etat === 'arretee';
              const ecart = ecartProduction(ligne.etat);
              return (
                <li
                  key={id}
                  className="relative overflow-hidden rounded-md bg-raised/45"
                  data-membre-production={id}
                  data-etat-membre={ligne.enCours ? 'en-cours' : tombee ? ligne.suivi!.etat : ligne.pret ? 'pret' : 'eteint'}
                >
                  {/* LA CARTE D'UN PROJET : son état et, DANS LE COIN HAUT DROIT,
                      ses réglages ; dessous, son bouton sur toute la largeur. */}
                  <div className="flex items-start gap-1 px-2.5 pt-2">
                    <button
                      type="button"
                      onClick={() => setDetail(id)}
                      className="flex min-w-0 flex-1 items-start gap-2 text-left"
                      title={t('Voir le détail de ce projet')}
                      data-ouvrir-membre-production={id}
                    >
                      <span className="mt-[3px] shrink-0">
                        <PastilleProjet project={ligne.membre} />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="min-w-0 truncate text-[14px] font-medium text-text">{ligne.membre.name}</span>
                          {ligne.etat?.commit && (ligne.etat.ecart ?? 0) > 0 ? (
                            <Pastille
                              nombre={ligne.etat.ecart!}
                              ton="repondre"
                              className="h-[18px] min-w-[18px] px-1 text-[10.5px]"
                              title={t(ecart.texte, ecart.valeurs)}
                              data-mises-a-jour-en-attente={ligne.etat.ecart}
                            />
                          ) : null}
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint" />
                        </span>
                        {ligne.enCours && ligne.suivi ? (
                          <span className="truncate text-[12.5px] text-en-cours" data-avancement-membre={ligne.suivi.pourcent}>
                            {ligne.suivi.etape ? `${t(descriptionDeLEtape(ligne.suivi.etape, 'production').libelle)} · ` : ''}
                            <span className="font-semibold tabular-nums">{ligne.suivi.pourcent} %</span>
                          </span>
                        ) : reussie ? (
                          <span className="flex items-center gap-1 truncate text-[12.5px] text-termine" data-reussite-membre>
                            <Check className="h-3 w-3 shrink-0" />
                            {t('Mise en production terminée')}
                          </span>
                        ) : ligne.enPlace ? (
                          <span
                            className={cn(
                              'flex min-w-0 items-center gap-1.5 text-[12.5px]',
                              productionEnRetard(ligne.etat) ? 'text-warning' : 'text-muted',
                            )}
                            data-ecart-production
                          >
                            <span className="min-w-0 truncate">{t(ecart.texte, ecart.valeurs)}</span>
                            {ligne.etat?.commit ? (
                              <span className="flex shrink-0 items-center gap-1 text-faint">
                                <GitCommitHorizontal className="h-3 w-3 shrink-0" />
                                <span className="font-mono">{empreinteCourte(ligne.etat.commit)}</span>
                                {ligne.etat.at ? <span>· {elapsed(ligne.etat.at)}</span> : null}
                              </span>
                            ) : null}
                          </span>
                        ) : null}
                        {tombee && !erreur ? (
                          <span className="truncate text-[12.5px] text-danger" data-derniere-production={ligne.run?.state}>
                            {ligne.suivi?.etat === 'arretee'
                              ? t('La dernière mise à jour a été arrêtée')
                              : t('La dernière mise à jour a échoué')}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="-mr-1 -mt-0.5 h-7 w-7 shrink-0 text-muted"
                      onClick={() => {
                        setOuvert(false);
                        ouvrirRubriqueDeLEtape(id, 'production');
                      }}
                      aria-label="Réglages de la mise en production"
                      title={t('Réglages de la mise en production')}
                      data-reglages-membre-production={id}
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="px-2.5 pb-2 pt-2">{boutonDuMembre(ligne)}</div>
                  {/* UNE LIGNE ÉTEINTE DIT POURQUOI, en clair : l'infobulle d'un
                      bouton désactivé ne se lit pas au doigt. Le refus du
                      serveur, lui, s'écrit en couleur d'erreur. */}
                  {erreur ? (
                    <p className="px-2.5 pb-2 text-[12px] leading-snug text-danger" data-erreur-membre-production>
                      {erreur}
                    </p>
                  ) : ligne.raison ? (
                    <p className="px-2.5 pb-2 text-[12px] leading-snug text-faint" data-raison-membre-production>
                      {t(ligne.raison)}
                    </p>
                  ) : null}
                  {ligne.suivi && (ligne.enCours || tombee) ? (
                    <BarreProgression
                      className="absolute inset-x-0 bottom-0"
                      pourcent={ligne.suivi.pourcent}
                      erreur={tombee}
                      teinte="en-cours"
                      data-barre-membre-production={id}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      }
      pied={
        <>
          {!prets.length ? (
            <p className="mb-1.5 text-[12px] leading-snug text-faint" data-raison-bouton-production>
              {resume.enRoute
                ? t('Les mises en production lancées sont en cours.')
                : t('Aucun projet du groupe n’est prêt à partir : la raison est écrite sur chaque ligne.')}
            </p>
          ) : null}
          <Button
            variant="default"
            size="pied"
            className="gap-1.5"
            disabled={!prets.length}
            onClick={() => setConfirmation({ ids: prets.map((ligne) => ligne.membre.id), tous: true })}
            data-bouton-production-groupe={prets.length}
          >
            {envoi.size ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : <Rocket className="h-3 w-3 shrink-0" />}
            <span className="truncate">{t('Tout mettre en production ({n})', { n: prets.length })}</span>
          </Button>
        </>
      }
    >
      {/* UNE SEULE CONFIRMATION, pour un projet comme pour tous : elle nomme ce
          qui part, et rien ne part avant elle. */}
      <ConfirmDialog
        open={!!confirmation}
        title={
          confirmation?.tous || !aConfirmer[0]
            ? t('Mise en production')
            : t('Mise en production de {nom}', { nom: aConfirmer[0].membre.name })
        }
        description={
          confirmation?.tous ? (
            <>
              {aConfirmer.length > 1
                ? t('{n} projets vont partir en production en même temps : {noms}.', {
                    n: aConfirmer.length,
                    noms: aConfirmer.map((ligne) => ligne.membre.name).join(', '),
                  })
                : t('1 projet va partir en production : {noms}.', {
                    noms: aConfirmer.map((ligne) => ligne.membre.name).join(', '),
                  })}
            </>
          ) : aConfirmer[0] ? (
            <>
              {t(
                annonceMiseAJourProduction(aConfirmer[0].etat).texte,
                annonceMiseAJourProduction(aConfirmer[0].etat).valeurs,
              )}
            </>
          ) : null
        }
        confirmLabel={t('Mettre à jour')}
        danger
        onConfirm={() => {
          if (confirmation) void lancer(confirmation.ids);
        }}
        onClose={() => setConfirmation(null)}
      />
    </BandeauProduction>
  );
}

/**
 * LE DÉTAIL D'UN MEMBRE, à la place de la liste : le déroulé de sa mise en
 * production tant qu'elle tourne ou qu'elle est tombée (relancer et arrêter s'y
 * font), sinon ce que son bouton fera — l'explication de son processus — et
 * son bouton en pied.
 */
function DetailDuMembre({
  ligne,
  erreur,
  bouton,
}: {
  ligne: { membre: Project; run: DeployRun | null; enCours: boolean; raison: string | null };
  erreur?: string;
  bouton: React.ReactNode;
}) {
  const id = ligne.membre.id;
  if (ligne.run && (ligne.enCours || rapportAGarder(ligne.run.state))) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-detail-membre-production={id}>
        <CorpsDuVolet
          sansTitre
          cible="production"
          ouvrirSur="parcours"
          run={ligne.run}
          sousTitre={t('La version déjà déployée part chez le client — aucune carte n’est embarquée.')}
          controls={<DeployControls run={ligne.run} actions />}
        />
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-detail-membre-production={id}>
      <ZoneDefilement fond="hsl(var(--surface))" className="min-h-0 px-4 pb-2">
        <ExplicationDeConfiguration processus={ligne.membre.miseEnProduction?.processus} />
      </ZoneDefilement>
      <div className="shrink-0 px-4 pb-3 pt-2" data-pied-tiroir-production>
        {erreur ? (
          <p className="mb-1.5 text-[12px] leading-snug text-danger" data-erreur-membre-production>
            {erreur}
          </p>
        ) : ligne.raison ? (
          <p className="mb-1.5 text-[12px] leading-snug text-faint" data-raison-bouton-production>
            {t(ligne.raison)}
          </p>
        ) : null}
        {bouton}
      </div>
    </div>
  );
}
