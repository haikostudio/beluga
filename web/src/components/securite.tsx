import * as React from 'react';
import {
  ORDRE_DES_GRAVITES,
  construireFragment,
  empreinteDuConstat,
  ligneDeSuggestion,
  texteDuPointPourLeChamp,
  type Agent,
  type ConstatSecurite,
  type GraviteSecurite,
  type PointSuivi,
  type ProjetSuiviSecurite,
  type ResumeDAudit,
  type VueDAudit,
} from '@beluga/shared';
import { Check, ExternalLink, Loader2, Plus, RefreshCw, ShieldCheck, X } from '@/components/ui/icones';
import { BlocRepliable, Button, Drawer, ListeDeroulante, TitreDePage, ZoneDefilement } from '@/components/ui';
import { Tableau } from '@/components/ui/tableau';
import { BasculeTableauCartes, useVueDeLaListe } from '@/components/ui/apercu-au-survol';
import { colonneProjet } from '@/components/ui/colonne-projet';
import { CarteDeTableau } from '@/components/ui/carte-de-tableau';
import { BarreDOnglets } from '@/components/ui/barre-d-onglets';
import { BasculeDePage, RechercheDuService } from '@/components/fenetre-de-service';
import { BoutonPrincipal, CranDuFil, GestePrincipal, OptionDePage, OptionsDePage, SuiteDuFil } from '@/components/entete-de-zone';
import { CaseACocher } from '@/components/ui/elements-maison';
import { EtatVideDuProjet, useProjetDuService } from '@/components/projet-du-service';
import { SilhouetteConversation, SilhouetteTableauDeService } from '@/components/silhouettes';
import { Chat } from '@/components/chat';
import { ResizeHandle, useResizable } from '@/components/resizer';
import { CLASSE_FENETRE_DU_VOLET, CLASSE_VOLET_DU_PLAN, CLE_DE_LARGEUR_DU_PLAN, PanneauDuVolet, bornesDuVoletDuPlan, usePlaceDeLaRangee } from '@/components/volet-comme-un-plan';
import { ContexteTexteDuChamp, creerTexteDuChamp, useLignesDansLeChamp, type TexteDuChamp } from '@/lib/texte-du-champ';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { useTelephone } from '@/lib/telephone';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LE SERVICE « SÉCURITÉ » (carte « Service Sécurité des projets », 15/11/2026).
 *
 * La LISTE des projets suivis, sur le modèle commun des services (titre, recherche, bascule lignes/cartes et filtre des
 * projets sur une ligne ; colonne Projet ; « Ajouter un projet » dans le pied), puis la PAGE d'un projet : la
 * conversation de son agent de sécurité à gauche, le rapport d'audit à droite dans le volet commun du plan (même
 * largeur, même poignée), en blocs repliables par gravité. Une case par point écrit (ou retire) sa ligne dans le champ
 * d'écriture — UN CLIC N'ENVOIE JAMAIS RIEN —, « Tout ajouter » fait le bloc entier. Sur téléphone, deux onglets :
 * Conversation et Rapport ; la flèche de la barre d'en-tête ramène à la liste (`data-securite-retour`).
 *
 * Tout se lit au démon (`securite.*`), et se relit à chaque événement `securite` (`securiteVersion`).
 */

/** Le nom court d'une gravité, traduit (chaque texte passe par `t` en toutes lettres : le dictionnaire le retrouve). */
function libelleGravite(g: GraviteSecurite): string {
  switch (g) {
    case 'critique':
      return t('Critique');
    case 'elevee':
      return t('Élevée');
    case 'moyenne':
      return t('Moyenne');
    case 'faible':
      return t('Faible');
  }
}

function dateLisible(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

function dateEtHeure(at: number): string {
  return new Date(at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function declencheurLisible(d: ResumeDAudit['declencheur']): string {
  if (d === 'etude') return t('étude approfondie');
  return d === 'hebdo' ? t('chaque semaine') : d === 'manuel' ? t('à la demande') : d === 'ajout' ? t('à l’ajout') : t('après une mise en ligne');
}

/** « 1 critique · 2 élevées », ou « Rien à traiter ». */
function compteLisible(compte: Record<GraviteSecurite, number>): string {
  const parts = ORDRE_DES_GRAVITES.filter((g) => compte[g]).map((g) => `${compte[g]} ${libelleGravite(g).toLowerCase()}`);
  return parts.length ? parts.join(' · ') : t('Rien à traiter');
}

/** Ouvre une carte dans son projet, par l'adresse : elle n'a pas besoin d'être chargée. */
function ouvrirLaCarte(projectId: string, cardId: string): void {
  window.history.pushState(null, '', `#${construireFragment({ vue: 'projet', projectId, cardId })}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** La liste des projets suivis, relue à l'ouverture et à chaque changement annoncé. */
function useProjetsSuivis(open: boolean): [ProjetSuiviSecurite[] | null, (p: ProjetSuiviSecurite[]) => void] {
  const version = useApp().securiteVersion;
  const [projets, setProjets] = React.useState<ProjetSuiviSecurite[] | null>(null);
  React.useEffect(() => {
    if (!open) return;
    let vivant = true;
    client
      .call<{ projets: ProjetSuiviSecurite[] }>({ type: 'securite.lister' })
      .then((r) => vivant && setProjets(r.projets ?? []))
      .catch(() => vivant && setProjets((p) => p ?? []));
    return () => {
      vivant = false;
    };
  }, [open, version]);
  return [projets, setProjets];
}

export function Securite({
  open,
  enPage,
  onClose,
  vise,
  onVise,
}: {
  open: boolean;
  enPage?: boolean;
  onClose: () => void;
  /** Le projet ouvert (sa page), ou la liste. */
  vise: string | null;
  onVise: (projetId: string | null) => void;
}) {
  const state = useApp();
  const [projets, setProjets] = useProjetsSuivis(open);
  const projetDuService = useProjetDuService();
  const [recherche, setRecherche] = React.useState('');
  const [vueDeLaListe, setVueDeLaListe] = useVueDeLaListe('securite.vueDeLaListe');
  const [ajout, setAjout] = React.useState(false);
  /* LA SÉLECTION DE LA LISTE (« Corriger la sélection ») : les projets cochés, vidés de ceux qui quittent la liste. */
  const [selection, setSelection] = React.useState<ReadonlySet<string>>(() => new Set());
  const [correction, setCorrection] = React.useState(false);

  const nomDuProjet = (id: string) => state.projects.find((p) => p.id === id)?.name ?? id;
  const lignes = React.useMemo(
    () => (projets ?? []).filter((p) => !projetDuService || p.projectId === projetDuService.id),
    [projets, projetDuService?.id],
  );
  React.useEffect(() => {
    setSelection((avant) => {
      const presents = new Set(lignes.map((p) => p.projectId));
      const reste = [...avant].filter((id) => presents.has(id));
      return reste.length === avant.size ? avant : new Set(reste);
    });
  }, [lignes]);
  /* La case d'en-tête vise les lignes VISIBLES (celles que la recherche garde). */
  const visibles = React.useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return lignes.filter((p) => !q || nomDuProjet(p.projectId).toLowerCase().includes(q)).map((p) => p.projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lignes, recherche, state.projects]);
  const basculer = (id: string) =>
    setSelection((avant) => {
      const n = new Set(avant);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toutesCochees = visibles.length > 0 && visibles.every((id) => selection.has(id));
  const basculerTout = () =>
    setSelection((avant) => {
      const n = new Set(avant);
      if (toutesCochees) visibles.forEach((id) => n.delete(id));
      else visibles.forEach((id) => n.add(id));
      return n;
    });

  /* « CORRIGER LA SÉLECTION » : une carte de correction par projet coché, créée PUIS lancée par le démon. */
  const corriger = async () => {
    if (!selection.size || correction) return;
    setCorrection(true);
    try {
      const r = await client.call<{ cartes: { projectId: string; cardId: string }[]; ecartes: { projectId: string; raison: string }[]; projets: ProjetSuiviSecurite[] }>(
        { type: 'securite.corriger', projets: [...selection] },
        60000,
      );
      setProjets(r.projets ?? []);
      setSelection(new Set());
      const ecartes = r.ecartes.map((e) => `${nomDuProjet(e.projectId)} (${e.raison})`).join(', ');
      const lancees = r.cartes.length > 1 ? t('{v0} cartes de correction lancées.', { v0: r.cartes.length }) : r.cartes.length ? t('1 carte de correction lancée.') : t('Aucune carte lancée.');
      client.pushToast(r.cartes.length ? 'success' : 'info', ecartes ? `${lancees} ${t('Écartés : {v0}', { v0: ecartes })}` : lancees);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('La correction n’a pas pu partir'));
    } finally {
      setCorrection(false);
    }
  };

  const suivis = new Set((projets ?? []).map((p) => p.projectId));
  const ajoutables = state.projects.filter((p) => !p.archived && !suivis.has(p.id));

  const ajouter = async (projectId: string) => {
    setAjout(true);
    try {
      const r = await client.call<{ projets: ProjetSuiviSecurite[] }>({ type: 'securite.ajouter', projectId });
      setProjets(r.projets ?? []);
      onVise(projectId);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Le projet n’a pas pu être ajouté'));
    } finally {
      setAjout(false);
    }
  };

  const ouvert = vise ? (projets ?? []).find((p) => p.projectId === vise) ?? null : null;
  if (vise && ouvert) {
    return (
      <Drawer open={open} onClose={onClose} enPage={enPage}>
        <PageDuProjet projet={ouvert} nom={nomDuProjet(ouvert.projectId)} onRetour={() => onVise(null)} />
      </Drawer>
    );
  }

  /* LE BOUTON DE LA PAGE, DANS LE PIED : un projet de Beluga pris parmi ceux qui ne sont pas encore suivis. */
  const boutonAjouter = (libelle: string) =>
    ajoutables.length ? (
      <ListeDeroulante
        valeur=""
        titre={t('Projet à suivre')}
        options={ajoutables.map((p) => ({ valeur: p.id, libelle: p.name }))}
        onChoisir={(id) => void ajouter(id)}
        repere="securite-ajouter"
        declencheur={(ouvrir) => (
          <BoutonPrincipal onClick={(e: React.MouseEvent) => ouvrir(e)} disabled={ajout} data-securite-ajouter="">
            {ajout ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {libelle}
          </BoutonPrincipal>
        )}
      />
    ) : null;

  /* DANS L'ONGLET D'UN PROJET QUI N'EST PAS SUIVI : le dire, et proposer de le suivre. */
  if (projetDuService && projets !== null && !lignes.length) {
    return (
      <Drawer open={open} onClose={onClose} enPage={enPage}>
        <EtatVideDuProjet
          icone={<ShieldCheck />}
          titre={t('{v0} n’est pas suivi', { v0: projetDuService.name })}
          texte={t('Suivre un projet lance son audit de sécurité tout de suite, puis chaque semaine, sans rien dépenser. Un point grave nouveau vous est signalé avec sa carte de correction prête.')}
          action={t('Suivre ce projet')}
          onAction={() => void ajouter(projetDuService.id)}
          enCours={ajout}
          data-securite-vide-projet=""
        />
      </Drawer>
    );
  }

  const etatDuProjet = (p: ProjetSuiviSecurite) => <EtatDuProjet projet={p} />;
  const tableau = (
    <Tableau<ProjetSuiviSecurite>
      repere="securite"
      lignes={lignes}
      cle={(p) => p.projectId}
      onLigne={(p) => onVise(p.projectId)}
      rechercheExterne={recherche}
      {...(vueDeLaListe === 'cartes'
        ? {
            grille: (p: ProjetSuiviSecurite) => (
              <CarteDeTableau
                projet={{ id: p.projectId, nom: nomDuProjet(p.projectId) }}
                etat={etatDuProjet(p)}
                titre={nomDuProjet(p.projectId)}
                texte={compteLisible(p.aTraiter)}
                chiffres={[
                  { libelle: t('Dernier audit'), valeur: p.dernierAudit ? dateLisible(p.dernierAudit.lance) : '—' },
                  { libelle: t('En correction'), valeur: String(p.enCorrection) },
                  { libelle: t('Prochain audit'), valeur: dateLisible(p.prochainPassage) },
                ]}
                bas={
                  <span data-pas-de-clic-de-ligne="" className="inline-flex items-center gap-2 text-[12.5px] text-muted">
                    <CaseACocher
                      checked={selection.has(p.projectId)}
                      onCheckedChange={() => basculer(p.projectId)}
                      aria-label={`Sélectionner ${nomDuProjet(p.projectId)}`}
                      data-securite-choisir={p.projectId}
                    />
                    {selection.has(p.projectId) ? t('Sélectionné') : t('Sélectionner')}
                  </span>
                }
                data-securite-carte={p.projectId}
              />
            ),
          }
        : {})}
      disposition="auto"
      pied="toujours"
      triInitial={{ colonne: 'projet', sens: 'asc' }}
      vide={t('Aucun projet suivi pour l’instant.')}
      attributsLigne={(p) => ({ 'data-securite-ligne': p.projectId })}
      classeLigne={(p) => (selection.has(p.projectId) ? 'bg-raised/70' : undefined)}
      colonnes={[
        {
          cle: 'choix',
          largeur: 'w-10',
          libelle: (
            <CaseACocher
              checked={toutesCochees}
              onCheckedChange={basculerTout}
              disabled={!visibles.length}
              aria-label={toutesCochees ? 'Tout désélectionner' : 'Tout sélectionner'}
              data-securite-tout-choisir=""
            />
          ),
          rendu: (p) => (
            <span data-pas-de-clic-de-ligne="" className="inline-flex">
              <CaseACocher
                checked={selection.has(p.projectId)}
                onCheckedChange={() => basculer(p.projectId)}
                aria-label={`Sélectionner ${nomDuProjet(p.projectId)}`}
                data-securite-choisir={p.projectId}
              />
            </span>
          ),
        },
        colonneProjet<ProjetSuiviSecurite>((p) => ({ id: p.projectId, nom: nomDuProjet(p.projectId) })),
        {
          cle: 'etat',
          libelle: t('État'),
          valeur: (p) => (p.enCours ? 0 : p.aTraiter.critique * 1000 + p.aTraiter.elevee * 100 + p.aTraiter.moyenne * 10 + p.aTraiter.faible),
          rendu: etatDuProjet,
        },
        {
          cle: 'aTraiter',
          libelle: t('À traiter'),
          valeur: (p) => compteLisible(p.aTraiter),
          rendu: (p) => <span className="whitespace-nowrap text-muted">{compteLisible(p.aTraiter)}</span>,
        },
        {
          cle: 'audit',
          libelle: t('Dernier audit'),
          valeur: (p) => p.dernierAudit?.lance ?? 0,
          sensNaturel: 'desc',
          rendu: (p) => <span className="text-muted">{p.dernierAudit ? dateLisible(p.dernierAudit.lance) : '—'}</span>,
          masqueSurTelephone: true,
        },
        {
          cle: 'prochain',
          libelle: t('Prochain audit'),
          valeur: (p) => p.prochainPassage,
          rendu: (p) => <span className="text-muted">{dateLisible(p.prochainPassage)}</span>,
          masqueSurTelephone: true,
        },
      ]}
    />
  );

  return (
    <Drawer open={open} onClose={onClose} enPage={enPage}>
      <TitreDePage className="max-sm:sr-only">{t('Sécurité')}</TitreDePage>
      {lignes.length ? (
        <>
          <RechercheDuService valeur={recherche} onChange={setRecherche} placeholder={t('Rechercher un projet…')} data-securite-recherche="" />
          <BasculeDePage>
            <BasculeTableauCartes repere="vue-de-la-securite" valeur={vueDeLaListe} onChange={setVueDeLaListe} />
          </BasculeDePage>
        </>
      ) : null}
      <ZoneDefilement fond="hsl(var(--bg))" className="pb-6">
        {projets === null ? (
          <SilhouetteTableauDeService zone="securite" />
        ) : !lignes.length ? (
          <p className="text-[14px] text-muted" data-securite-vide="">
            {t('Aucun projet suivi pour l’instant. Ajoutez-en un : son audit de sécurité part tout de suite, puis chaque semaine, sans rien dépenser.')}
          </p>
        ) : (
          <div data-securite-tableau={projetDuService ? 'projet' : 'tous'}>{tableau}</div>
        )}
      </ZoneDefilement>
      {selection.size ? (
        <OptionsDePage>
          <OptionDePage variante="ghost" icone={<X className="h-3.5 w-3.5" />} onClick={() => setSelection(new Set())} data-securite-annuler-selection="">
            {t('Annuler la sélection')}
          </OptionDePage>
        </OptionsDePage>
      ) : null}
      {projets !== null ? (
        <GestePrincipal>
          {selection.size ? (
            <BoutonPrincipal onClick={() => void corriger()} disabled={correction} data-securite-corriger={selection.size}>
              {correction ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {t('Corriger la sélection ({v0})', { v0: selection.size })}
            </BoutonPrincipal>
          ) : (
            boutonAjouter(t('Ajouter un projet'))
          )}
        </GestePrincipal>
      ) : null}
    </Drawer>
  );
}

/** L'état d'un projet suivi : l'audit qui tourne, sinon le plus grave de ce qui reste à traiter. */
function EtatDuProjet({ projet: p }: { projet: ProjetSuiviSecurite }) {
  if (p.enCours)
    return (
      <span className="inline-flex items-center gap-1.5 text-teinte" data-securite-etat="en-cours">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t('Audit en cours')}
      </span>
    );
  if (p.dernierAudit?.erreur && !p.dernierAudit.compte)
    return (
      <span className="text-danger" data-securite-etat="erreur">
        {t('Audit impossible')}
      </span>
    );
  const pire = ORDRE_DES_GRAVITES.find((g) => p.aTraiter[g]);
  if (!pire)
    return (
      <span className="inline-flex items-center gap-1.5 text-muted" data-securite-etat="ok">
        <Check className="h-3.5 w-3.5" />
        {t('Rien à traiter')}
      </span>
    );
  return (
    <span className={cn('inline-flex items-center gap-1.5', pire === 'critique' || pire === 'elevee' ? 'font-medium text-text' : 'text-muted')} data-securite-etat={pire}>
      {/* La gravité se lit à la FORME (monochrome) : rond plein pour le grave, anneau sinon. */}
      <span
        aria-hidden
        className={cn('h-[7px] w-[7px] shrink-0 rounded-full', pire === 'critique' || pire === 'elevee' ? 'bg-text' : 'ring-[1.5px] ring-inset ring-muted')}
      />
      {libelleGravite(pire)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* La page d'un projet                                                 */
/* ------------------------------------------------------------------ */

function PageDuProjet({ projet, nom, onRetour }: { projet: ProjetSuiviSecurite; nom: string; onRetour: () => void }) {
  const state = useApp();
  const telephone = useTelephone();
  const version = state.securiteVersion;
  const [agentId, setAgentId] = React.useState<string | null>(projet.agentId ?? null);
  const [panne, setPanne] = React.useState<string | null>(null);
  const [auditChoisi, setAuditChoisi] = React.useState<string | null>(null);
  const [vue, setVue] = React.useState<VueDAudit | null | undefined>(undefined);
  const [audits, setAudits] = React.useState<ResumeDAudit[]>([]);
  const [onglet, setOnglet] = React.useState<'conversation' | 'rapport'>('rapport');
  const [lancement, setLancement] = React.useState(false);
  /* LE CHAMP D'ÉCRITURE DE LA CONVERSATION, partagé avec le volet : ses cases y lisent leur ligne. */
  const [champ] = React.useState<TexteDuChamp>(creerTexteDuChamp);
  const [depot, setDepot] = React.useState<{ texte: string; nonce: number; retirer?: boolean } | null>(null);
  const deposer = React.useCallback((texte: string, retirer: boolean) => {
    setDepot((avant) => ({ texte, retirer, nonce: (avant?.nonce ?? 0) + 1 }));
    // Sur téléphone, ce qu'on coche part dans la conversation : on y bascule seulement à la main.
  }, []);

  /* SON AGENT : déjà né, ou né à la première ouverture de la page (sa carte d'abord, aucun tour ne part). */
  React.useEffect(() => {
    let vivant = true;
    client
      .call<{ agentId: string }>({ type: 'securite.agent', projectId: projet.projectId }, 30000)
      .then((r) => {
        if (!vivant) return;
        setAgentId(r.agentId);
        void client.chargerAgent(r.agentId);
      })
      .catch((err: any) => vivant && setPanne(err?.message ?? t('La conversation n’a pas pu s’ouvrir')));
    return () => {
      vivant = false;
    };
  }, [projet.projectId]);

  React.useEffect(() => {
    let vivant = true;
    client
      .call<{ vue: VueDAudit | null }>({ type: 'securite.audit', projectId: projet.projectId, auditId: auditChoisi })
      .then((r) => vivant && setVue(r.vue ?? null))
      .catch(() => vivant && setVue((v) => v ?? null));
    client
      .call<{ audits: ResumeDAudit[] }>({ type: 'securite.audits', projectId: projet.projectId })
      .then((r) => vivant && setAudits(r.audits ?? []))
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
  }, [projet.projectId, auditChoisi, version]);

  const lancerUnAudit = async () => {
    setLancement(true);
    try {
      await client.call({ type: 'securite.auditer', projectId: projet.projectId });
      setAuditChoisi(null);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('L’audit n’a pas pu partir'));
    } finally {
      setLancement(false);
    }
  };

  const agent: Agent | null = agentId ? (state.agents[agentId] ?? null) : null;
  const [placeDeLaRangee, setRangee] = usePlaceDeLaRangee();
  const { width, start, reset } = useResizable(CLE_DE_LARGEUR_DU_PLAN, bornesDuVoletDuPlan(placeDeLaRangee));

  const conversation = agent ? (
    <Chat agent={agent} projectId={agent.projectId} champ={champ} depot={depot} libelleDuChamp={t('Écrire à l’agent de sécurité…')} />
  ) : (
    <div className="px-4 pt-3">{panne ? <p className="text-[13px] text-danger">{panne}</p> : <SilhouetteConversation bulles={2} />}</div>
  );
  const rapport = (
    <ContexteTexteDuChamp.Provider value={champ}>
      <RapportDuVolet
        vue={vue}
        audits={audits}
        enCours={projet.enCours}
        lancement={lancement}
        onLancer={() => void lancerUnAudit()}
        auditChoisi={auditChoisi}
        onChoisirAudit={setAuditChoisi}
        onDeposer={deposer}
        dernier={!auditChoisi}
      />
    </ContexteTexteDuChamp.Provider>
  );

  return (
    <>
      <SuiteDuFil onRacine={onRetour} retour={{ action: onRetour, reperes: { 'data-securite-retour': '' } }}>
        <CranDuFil data-securite-cran={projet.projectId}>{nom}</CranDuFil>
      </SuiteDuFil>
      {telephone ? (
        <div className="flex min-h-0 flex-1 flex-col" data-securite-page={projet.projectId}>
          {/* La marge de page (16 px) est portée par l'enveloppe : la barre pleine largeur la débordait à droite. */}
          <div className="shrink-0 px-4 pb-2">
            <BarreDOnglets
              repere="securite-onglets"
              pleineLargeur
              valeur={onglet}
              onChange={setOnglet}
              onglets={[
                { cle: 'rapport', libelle: t('Rapport') },
                { cle: 'conversation', libelle: t('Conversation') },
              ]}
            />
          </div>
          {/* Les deux restent montés : le champ garde ce qu'on y a coché en passant d'un onglet à l'autre. */}
          <div className={cn('min-h-0 flex-1 flex-col', onglet === 'conversation' ? 'flex' : 'hidden')} data-securite-conversation={agent?.id ?? 'chargement'}>
            {conversation}
          </div>
          {/* Caché par son ENVELOPPE : cacher l'intérieur laissait l'enveloppe prendre la moitié de la hauteur, et le champ
              d'écriture de la conversation flottait au milieu de l'écran. */}
          <ZoneDefilement className="px-4 pb-6" classeEnveloppe={onglet === 'rapport' ? undefined : 'hidden'} data-securite-volet="">
            {rapport}
          </ZoneDefilement>
        </div>
      ) : (
        <div ref={setRangee} className="flex min-h-0 min-w-0 flex-1" data-securite-page={projet.projectId} data-plein-cadre>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-securite-conversation={agent?.id ?? 'chargement'}>
            <div className="mx-auto flex min-h-0 w-full max-w-[820px] flex-1 flex-col [--fond-du-pied:transparent] [--retrait-du-fil:1rem]">
              {conversation}
            </div>
          </div>
          <ResizeHandle onPointerDown={(e) => start(e, 'right')} onDoubleClick={reset} className="z-30" data-document-poignee="securite" />
          <aside className={cn('min-h-0', CLASSE_VOLET_DU_PLAN)} style={{ width }} aria-label="Rapport d’audit" data-securite-volet="">
            <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', CLASSE_FENETRE_DU_VOLET)}>
              <PanneauDuVolet titre={t('Rapport d’audit')} libelleFermer={t('Revenir à la liste')} onFermer={onRetour} reperesCroix={{ 'data-croix-du-volet': 'securite' }}>
                {rapport}
              </PanneauDuVolet>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Le rapport                                                          */
/* ------------------------------------------------------------------ */

function RapportDuVolet({
  vue,
  audits,
  enCours,
  lancement,
  onLancer,
  auditChoisi,
  onChoisirAudit,
  onDeposer,
  dernier,
}: {
  vue: VueDAudit | null | undefined;
  audits: ResumeDAudit[];
  enCours: boolean;
  lancement: boolean;
  onLancer: () => void;
  auditChoisi: string | null;
  onChoisirAudit: (id: string | null) => void;
  onDeposer: (texte: string, retirer: boolean) => void;
  /** Le dernier audit est montré : les cases écrivent dans le champ. Un audit passé se lit seulement. */
  dernier: boolean;
}) {
  const audit = vue?.audit ?? null;
  const etats = new Map((vue?.points ?? []).map((p) => [p.empreinte, p]));
  const nouveaux = new Set(vue?.nouveaux ?? []);
  const constats = audit?.rapport?.constats ?? [];
  const finis = audits.filter((a) => a.fini);

  /* LA TÊTE DU VOLET : l'audit montré (et les autres des douze mois), puis « Lancer un audit » — même hauteur. */
  const tete = (
    <div className="flex flex-wrap items-center gap-2 pb-3" data-securite-tete-du-rapport="">
      {finis.length ? (
        <ListeDeroulante
          valeur={auditChoisi ?? finis[0]?.id ?? ''}
          titre={t('Audits des douze derniers mois')}
          options={finis.map((a) => ({
            valeur: a.id,
            libelle: dateEtHeure(a.lance),
            detail: a.erreur && !a.compte ? t('impossible : {v0}', { v0: a.erreur }) : `${declencheurLisible(a.declencheur)} · ${a.compte ? compteLisible(a.compte) : ''}`,
          }))}
          onChoisir={(id) => onChoisirAudit(id === finis[0]?.id ? null : id)}
          repere="securite-audits"
          variante="discret"
          className="min-w-0"
        />
      ) : null}
      <Button variant="ghost" size="sm" className="ml-auto" disabled={enCours || lancement} onClick={onLancer} data-securite-lancer="">
        {enCours || lancement ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        {enCours ? t('Audit en cours…') : t('Lancer un audit')}
      </Button>
    </div>
  );

  if (vue === undefined) return <SilhouetteConversation bulles={3} />;
  if (!audit || (!audit.rapport && !audit.fini))
    return (
      <div className="flex flex-col">
        {tete}
        <p className="text-[13.5px] text-muted" data-securite-rapport="attente">
          {t('Le premier audit tourne : il lit le code enregistré, les composants externes et l’adresse publique. Comptez une à deux minutes.')}
        </p>
      </div>
    );
  if (!audit.rapport)
    return (
      <div className="flex flex-col">
        {tete}
        <p className="text-[13.5px] text-danger" data-securite-rapport="erreur">
          {t('Cet audit n’a pas pu se faire : {v0}', { v0: audit.erreur ?? t('raison inconnue') })}
        </p>
      </div>
    );

  return (
    <div className="flex flex-col gap-1" data-securite-rapport={audit.id}>
      {tete}
      <p className="pb-2 text-[12.5px] text-faint">
        {t('Audit du {v0}, {v1}.', { v0: dateLisible(audit.lance), v1: declencheurLisible(audit.declencheur) })}{' '}
        {audit.rapport.depotPublic === null ? t('Visibilité du dépôt inconnue.') : audit.rapport.depotPublic ? t('Dépôt public.') : t('Dépôt privé.')}
      </p>
      {/* « CE QUI A ÉTÉ VÉRIFIÉ » EN TÊTE, DÉPLIÉ : on lit d'abord l'étendue du contrôle, puis ce qu'il a trouvé. */}
      <BlocRepliable titre={t('Ce qui a été vérifié')} repere="securite-verifie" defautOuvert compte={audit.rapport.etapes.length}>
        <ul className="flex flex-col gap-1 pt-1" data-securite-verifie="">
          {audit.rapport.etapes.map((e, i) => (
            <li key={i} className="flex items-start gap-2 text-[13px]">
              <span className={cn('mt-0.5 shrink-0', e.etat === 'fait' ? 'text-text' : 'text-faint')}>{e.etat === 'fait' ? '✓' : '–'}</span>
              <span className="min-w-0 flex-1">
                <span className={e.etat === 'fait' ? 'text-text' : 'text-muted'}>{e.nom}</span>
                {e.etat !== 'fait' ? <span className="text-muted"> · {t('non vérifié')}</span> : null}
                {e.note ? <span className="block text-[12px] text-faint">{e.note}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </BlocRepliable>
      {!constats.length ? (
        <p className="pb-2 text-[13.5px] text-text" data-securite-aucun-point="">
          {t('Aucun point relevé par cet audit.')}
        </p>
      ) : null}
      {ORDRE_DES_GRAVITES.map((g) => {
        const liste = constats.filter((c) => c.gravite === g);
        if (!liste.length) return null;
        return (
          <BlocDeGravite
            key={`${audit.id}:${g}`}
            gravite={g}
            constats={liste}
            etats={etats}
            nouveaux={nouveaux}
            cartes={vue?.cartes ?? {}}
            onDeposer={dernier ? onDeposer : null}
          />
        );
      })}
    </div>
  );
}

/** La ligne d'un point dans le champ d'écriture : « - Corriger : <titre> ». */
function ligneDuPoint(c: ConstatSecurite): string {
  return ligneDeSuggestion(texteDuPointPourLeChamp(c));
}

function BlocDeGravite({
  gravite,
  constats,
  etats,
  nouveaux,
  cartes,
  onDeposer,
}: {
  gravite: GraviteSecurite;
  constats: ConstatSecurite[];
  etats: Map<string, PointSuivi>;
  nouveaux: Set<string>;
  cartes: VueDAudit['cartes'];
  onDeposer: ((texte: string, retirer: boolean) => void) | null;
}) {
  const aTraiter = constats.filter((c) => (etats.get(empreinteDuConstat(c))?.etat ?? 'a-traiter') === 'a-traiter');
  const lignes = aTraiter.map(ligneDuPoint);
  const toutes = useLignesDansLeChamp(lignes);
  return (
    <BlocRepliable
      titre={libelleGravite(gravite)}
      repere={`securite-${gravite}`}
      defautOuvert={gravite === 'critique' || gravite === 'elevee'}
      compte={constats.length}
      action={
        onDeposer && lignes.length ? (
          <button
            type="button"
            onClick={() => onDeposer(lignes.join('\n'), toutes)}
            className="rounded-md bg-raised px-2.5 py-1 text-[12px] text-muted transition-colors hover:text-text sm:px-2 sm:py-0.5"
            data-securite-tout-ajouter={gravite}
          >
            {toutes ? t('Tout retirer') : t('Tout ajouter')}
          </button>
        ) : null
      }
    >
      <div className="flex flex-col gap-1.5 pt-1">
        {constats.map((c) => {
          const empreinte = empreinteDuConstat(c);
          const point = etats.get(empreinte);
          return <PointDuRapport key={empreinte} constat={c} point={point ?? null} nouveau={nouveaux.has(empreinte)} carte={point?.cardId ? cartes[point.cardId] ?? null : null} onDeposer={onDeposer} />;
        })}
      </div>
    </BlocRepliable>
  );
}

function PointDuRapport({
  constat: c,
  point,
  nouveau,
  carte,
  onDeposer,
}: {
  constat: ConstatSecurite;
  point: PointSuivi | null;
  nouveau: boolean;
  carte: { titre: string; projectId: string } | null;
  onDeposer: ((texte: string, retirer: boolean) => void) | null;
}) {
  const etat = point?.etat ?? 'a-traiter';
  const ligne = ligneDuPoint(c);
  const dansLeChamp = useLignesDansLeChamp([ligne]);
  const cochable = etat === 'a-traiter' && !!onDeposer;
  const coche = cochable && dansLeChamp;
  return (
    <div className="flex items-start gap-2.5 rounded-lg bg-surface px-3 py-2.5" data-securite-point={empreinteDuConstat(c)} data-securite-etat-point={etat}>
      <button
        type="button"
        role="checkbox"
        aria-checked={coche}
        aria-label="Ajouter ce point au message"
        title={cochable ? (coche ? t('Retirer du message') : t('Ajouter au message')) : undefined}
        disabled={!cochable}
        onClick={() => onDeposer?.(ligne, dansLeChamp)}
        data-securite-case={coche ? 'cochee' : 'vide'}
        className={cn(
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] transition-colors',
          !cochable ? 'opacity-0' : coche ? 'bg-accent text-accent-fg' : 'ring-[1.5px] ring-inset ring-muted hover:ring-text',
        )}
      >
        {coche ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="min-w-0 select-text break-words text-[13.5px] font-medium text-text">{c.titre}</span>
          {nouveau ? (
            <span className="rounded-full bg-raised px-2 py-px text-[11px] text-text" data-securite-nouveau="">
              {t('Nouveau')}
            </span>
          ) : null}
          {etat !== 'a-traiter' ? (
            <span className="rounded-full bg-raised px-2 py-px text-[11px] text-muted" data-securite-badge-etat={etat}>
              {etat === 'en-correction' ? t('En correction') : t('Corrigé')}
            </span>
          ) : null}
        </div>
        <p className="select-text text-[12.5px] leading-snug text-muted">
          <span className="text-faint">{t('Ce qui risque')} · </span>
          {c.risque}
        </p>
        {c.proposition ? (
          <p className="select-text text-[12.5px] leading-snug text-muted">
            <span className="text-faint">{t('Ce qu’on propose')} · </span>
            {c.proposition}
          </p>
        ) : null}
        {c.ou.length ? <p className="select-text break-all text-[12px] text-faint">{c.ou.join(' · ')}</p> : null}
        {carte && point?.cardId ? (
          <button
            type="button"
            onClick={() => ouvrirLaCarte(carte.projectId, point.cardId!)}
            className="inline-flex w-fit max-w-full items-center gap-1 text-left text-[12.5px] text-accent hover:underline"
            data-securite-ouvrir-carte={point.cardId}
          >
            <span className="min-w-0 truncate">{carte.titre}</span>
            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}
