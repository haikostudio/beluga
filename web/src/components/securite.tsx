import * as React from 'react';
import {
  ORDRE_DES_GRAVITES,
  compteParGravite,
  noteDeSecurite,
  phraseDeLaNoteDeSecurite,
  construireFragment,
  empreinteDuConstat,
  ligneDeSuggestion,
  texteDuPointPourLeChamp,
  type Agent,
  type ConstatSecurite,
  ordonnerParDerniereActivite,
  type GraviteSecurite,
  type PointSuivi,
  type ProjetSuiviSecurite,
  type ResumeDAudit,
  type VueDAudit,
  type VisiteurBloque,
  type ServeurDesSites,
  famillesAutorisees,
  type EtatDesRobots,
  type FamilleDeRobots,
  type ReglageRobots,
} from '@beluga/shared';

interface VisiteursBloquesDuProjet {
  serveur: ServeurDesSites | null;
  gardeActif: boolean | null;
  visiteurs: VisiteurBloque[];
  note?: string;
}
import { Check, ChevronDown, ChevronUp, CircleAlert, CircleCheck, ExternalLink, Info, Loader2, Plus, RefreshCw, ShieldCheck, TriangleAlert, X } from '@/components/ui/icones';
import {
  BlocRepliable,
  Button,
  Drawer,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  ListeDeroulante,
  Switch,
  TitreDePage,
  ZoneDefilement,
} from '@/components/ui';
import { AnneauDeNote, BarreDeGravite, CourbeDeNote, NoteEnLigne } from '@/components/note-de-securite';
import { Tableau } from '@/components/ui/tableau';
import { BasculeTableauCartes, useVueDeLaListe } from '@/components/ui/apercu-au-survol';
import { colonneProjet } from '@/components/ui/colonne-projet';
import { CarteDeTableau } from '@/components/ui/carte-de-tableau';
import { BarreDOnglets } from '@/components/ui/barre-d-onglets';
import { BasculeDePage, GesteDeLEnteteDeFeuille, RechercheDuService, useDansUneFeuilleDeService, useSansLigneDeTitre } from '@/components/fenetre-de-service';
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
import { formatRegional, t } from '@/lib/langue';
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

/* LES DATES DANS LA LANGUE DE L'INTERFACE (25/11/2026) : la locale du navigateur faisait lire « November 22, 2026 » sur
   un écran en français. */
function dateLisible(at: number): string {
  return new Date(at).toLocaleDateString(formatRegional(), { day: 'numeric', month: 'short', year: 'numeric' });
}

function dateEtHeure(at: number): string {
  return new Date(at).toLocaleString(formatRegional(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
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
  const [analyse, setAnalyse] = React.useState(false);

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

  /* « RELANCER L'ANALYSE » DE LA SÉLECTION : un audit par projet coché, gratuit, par la file commune. */
  const relancerLAnalyse = async () => {
    if (!selection.size || analyse) return;
    setAnalyse(true);
    try {
      const r = await client.call<{ lances: string[]; dejaEnCours: string[]; ecartes: { projectId: string; raison: string }[]; projets: ProjetSuiviSecurite[] }>(
        { type: 'securite.auditerSelection', projets: [...selection] },
        30000,
      );
      setProjets(r.projets ?? []);
      setSelection(new Set());
      const parts = [
        r.lances.length > 1 ? t('{v0} analyses lancées.', { v0: r.lances.length }) : r.lances.length ? t('1 analyse lancée.') : t('Aucune analyse lancée.'),
        r.dejaEnCours.length ? t('{v0} déjà en cours.', { v0: r.dejaEnCours.length }) : '',
        r.ecartes.length ? t('Écartés : {v0}', { v0: r.ecartes.map((e) => `${nomDuProjet(e.projectId)} (${e.raison})`).join(', ') }) : '',
      ].filter(Boolean);
      client.pushToast(r.lances.length ? 'success' : 'info', parts.join(' '));
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('L’analyse n’a pas pu partir'));
    } finally {
      setAnalyse(false);
    }
  };

  const suivis = new Set((projets ?? []).map((p) => p.projectId));
  const ajoutables = ordonnerParDerniereActivite(state.projects.filter((p) => !p.archived && !suivis.has(p.id)));

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
          fond={<SilhouetteTableauDeService lignes={8} />}
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
                  { libelle: t('Note'), valeur: p.note === null || p.note === undefined ? '—' : String(p.note) },
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
          /* LA NOTE DE SÉCURITÉ SUR 100 (25/11/2026, maquette #c972) : un petit anneau et le chiffre, l'anneau dans la teinte
             importante sous 40. Un projet sans audit réussi : « — », jamais 100. */
          cle: 'note',
          libelle: t('Note'),
          valeur: (p) => p.note ?? -1,
          rendu: (p) => <NoteEnLigne note={p.note} />,
        },
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
            /* LES ACTIONS SUR LA SÉLECTION (25/11/2026, maquette #c972) : un menu à deux gestes — relancer l'analyse de
               chaque projet coché, ou lancer leur correction (une carte par projet). */
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <BoutonPrincipal disabled={correction || analyse} data-securite-actions={selection.size}>
                  {correction || analyse ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {t('Actions sur la sélection ({v0})', { v0: selection.size })}
                  {correction || analyse ? null : <ChevronUp className="h-4 w-4" />}
                </BoutonPrincipal>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="center" titre={t('Actions sur la sélection ({v0})', { v0: selection.size })} className="min-w-[300px]">
                <DropdownMenuItem onSelect={() => void relancerLAnalyse()} data-securite-relancer-selection={selection.size}>
                  <RefreshCw />
                  <span className="flex min-w-0 flex-col">
                    <span>{t('Relancer l’analyse')}</span>
                    <span className="text-[12.5px] text-muted">
                      {selection.size > 1 ? t('Un audit pour chacun des {v0} projets · gratuit', { v0: selection.size }) : t('Un audit pour ce projet · gratuit')}
                    </span>
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void corriger()} data-securite-corriger={selection.size}>
                  <ShieldCheck />
                  <span className="flex min-w-0 flex-col">
                    <span>{t('Lancer la correction')}</span>
                    <span className="text-[12.5px] text-muted">{t('Une carte par projet, avec tous ses points')}</span>
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
  /* Conversation à gauche, volet à droite : pas de ligne de titre au-dessus (22/11/2026). */
  useSansLigneDeTitre();
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
  /* SUR TÉLÉPHONE, « LANCER UN AUDIT » MONTE DANS L'EN-TÊTE DE LA FEUILLE (22/11/2026, maquette #ccad), en bouton
     icône à droite de « Sécurité » : la tête du rapport ne garde que la liste des audits. Un seul exemplaire monté. */
  const dansUneFeuille = useDansUneFeuilleDeService();
  const lancerEnTete = telephone && dansUneFeuille;
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
        projectId={projet.projectId}
        sansLancer={lancerEnTete}
      />
    </ContexteTexteDuChamp.Provider>
  );

  return (
    <>
      <SuiteDuFil onRacine={onRetour} retour={{ action: onRetour, reperes: { 'data-securite-retour': '' } }}>
        <CranDuFil data-securite-cran={projet.projectId}>{nom}</CranDuFil>
      </SuiteDuFil>
      {lancerEnTete ? (
        <GesteDeLEnteteDeFeuille>
          <Button
            variant="ghost"
            size="icon"
            className="h-[38px] w-[38px] shrink-0 text-muted"
            disabled={projet.enCours || lancement}
            onClick={() => void lancerUnAudit()}
            aria-label="Lancer un audit"
            title={projet.enCours ? t('Audit en cours…') : t('Lancer un audit')}
            data-securite-lancer=""
            data-securite-lancer-en-tete=""
          >
            {projet.enCours || lancement ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </GesteDeLEnteteDeFeuille>
      ) : null}
      {telephone ? (
        /* UNE SEULE MARGE DE PAGE, 16 PX (22/11/2026, capture #7ae7 : « c'est quoi ces paddings / marges ? ») : la page de
           détail posée dans la feuille du service porte déjà 16 px de chaque côté ; la page les reprend (`-mx-4`) pour
           que seuls les onglets et le rapport posent la leur — les blocs tombent à 16 px du bord, pas à 32. */
        <div className={cn('flex min-h-0 flex-1 flex-col', dansUneFeuille && '-mx-4')} data-securite-page={projet.projectId}>
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
          <ZoneDefilement
            className="px-4 pb-6"
            classeEnveloppe={onglet === 'rapport' ? undefined : 'hidden'}
            hautSur={`${projet.projectId}:${onglet}`}
            data-securite-volet=""
          >
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
  projectId,
  sansLancer = false,
}: {
  /** « Lancer un audit » vit ailleurs (l'en-tête de la feuille du téléphone) : la tête ne garde que la liste. */
  sansLancer?: boolean;
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
  projectId: string;
}) {
  const audit = vue?.audit ?? null;
  const etats = new Map((vue?.points ?? []).map((p) => [p.empreinte, p]));
  const nouveaux = new Set(vue?.nouveaux ?? []);
  const constats = audit?.rapport?.constats ?? [];
  const finis = audits.filter((a) => a.fini);

  /* LA TÊTE DU VOLET : l'audit montré (et les autres des douze mois), puis « Lancer un audit » — même hauteur. */
  const tete = !finis.length && sansLancer ? null : (
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
      {sansLancer ? null : (
        <Button variant="ghost" size="sm" className="ml-auto" disabled={enCours || lancement} onClick={onLancer} data-securite-lancer="">
          {enCours || lancement ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {enCours ? t('Audit en cours…') : t('Lancer un audit')}
        </Button>
      )}
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

  const note = typeof audit.note === 'number' ? audit.note : noteDeSecurite(compteParGravite(constats));
  return (
    <div className="flex flex-col gap-3" data-securite-rapport={audit.id}>
      {tete}
      <p className="text-[12.5px] text-faint">
        {t('Audit du {v0}, {v1}.', { v0: dateLisible(audit.lance), v1: declencheurLisible(audit.declencheur) })}{' '}
        {audit.rapport.depotPublic === null ? t('Visibilité du dépôt inconnue.') : audit.rapport.depotPublic ? t('Dépôt public.') : t('Dépôt privé.')}
      </p>
      <CarteDeLaNote note={note} constats={constats} vue={vue ?? null} />
      <CarteDesCategories
        key={audit.id}
        constats={constats}
        etapes={audit.rapport.etapes}
        etats={etats}
        nouveaux={nouveaux}
        cartes={vue?.cartes ?? {}}
        onDeposer={dernier ? onDeposer : null}
      />
      {dernier ? <AccesDesRobots projectId={projectId} /> : null}
      {dernier ? <VisiteursBloques projectId={projectId} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* La note, l'avancement et l'évolution (disposition A, maquette #2312) */
/* ------------------------------------------------------------------ */

const CLASSE_CARTE_DU_VOLET = 'flex min-w-0 flex-col rounded-[14px] bg-raised px-4 py-3.5';

/** La phrase de la note, traduite (chaque texte passe par `t` en toutes lettres). */
function phraseDeLaNoteAffichee(note: number | null): string {
  const phrase = phraseDeLaNoteDeSecurite(note);
  switch (phrase) {
    case 'Bonne protection':
      return t('Bonne protection');
    case 'Protection correcte':
      return t('Protection correcte');
    case 'Protection moyenne':
      return t('Protection moyenne');
    case 'Protection faible':
      return t('Protection faible');
    default:
      return t('Pas encore notée');
  }
}

/** Une ligne qu'on déplie : un bouton plein, le chevron TOUJOURS en dernier. */
function LigneRepliable({
  ouvert,
  onBasculer,
  devant,
  titre,
  detail,
  compte,
  repere,
  children,
}: {
  ouvert: boolean;
  onBasculer: () => void;
  devant?: React.ReactNode;
  titre: React.ReactNode;
  detail?: React.ReactNode;
  compte?: React.ReactNode;
  repere: Record<string, string>;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col" {...repere} data-ouvert={ouvert ? 'oui' : 'non'}>
      <button type="button" onClick={onBasculer} aria-expanded={ouvert} className="flex min-w-0 items-center gap-2.5 py-2.5 text-left">
        {devant}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13.5px] font-medium text-text">{titre}</span>
          {detail ? <span className="truncate text-[12.5px] text-muted">{detail}</span> : null}
        </span>
        {compte !== undefined && compte !== null ? <span className="shrink-0 text-[12.5px] tabular-nums text-muted">{compte}</span> : null}
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted transition-transform', ouvert && 'rotate-180')} />
      </button>
      {ouvert ? <div className="flex min-w-0 flex-col gap-1.5 pb-3">{children}</div> : null}
    </div>
  );
}

function CarteDeLaNote({ note, constats, vue }: { note: number; constats: ConstatSecurite[]; vue: VueDAudit | null }) {
  const [avancementOuvert, setAvancementOuvert] = React.useState(false);
  const compte = compteParGravite(constats);
  const maximum = Math.max(1, ...ORDRE_DES_GRAVITES.map((g) => compte[g]));
  const avancement = vue?.avancement;
  const evolution = vue?.evolution ?? [];
  const premier = evolution[0];
  const dernier = evolution[evolution.length - 1];
  const ecart = premier && dernier && evolution.length >= 2 ? dernier.note - premier.note : null;
  const cartes = Object.entries(vue?.cartes ?? {});
  return (
    <div className={CLASSE_CARTE_DU_VOLET} data-securite-carte-note={note}>
      <div className="flex min-w-0 items-center gap-4 pb-3">
        <AnneauDeNote note={note}>
          <span className="text-[26px] font-semibold leading-none tabular-nums text-text">{note}</span>
          <span className="text-[11px] text-muted">{t('sur 100')}</span>
        </AnneauDeNote>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="truncate text-[15px] font-semibold text-text" data-securite-phrase-note="">
            {phraseDeLaNoteAffichee(note)}
          </p>
          {ORDRE_DES_GRAVITES.map((g) => (
            <BarreDeGravite key={g} libelle={libelleGravite(g)} valeur={compte[g]} maximum={maximum} teinte={g === 'critique' || g === 'elevee' ? 'important' : g === 'moyenne' ? 'text' : 'muted'} />
          ))}
        </div>
      </div>
      {avancement && avancement.total ? (
        <div className="border-t border-faint/25">
          <LigneRepliable
            ouvert={avancementOuvert}
            onBasculer={() => setAvancementOuvert((o) => !o)}
            titre={t('Avancement des corrections')}
            compte={
              avancement.corriges > 1
                ? t('{v0} corrigés sur {v1} · {v2} %', { v0: avancement.corriges, v1: avancement.total, v2: avancement.pourcent ?? 0 })
                : t('{v0} corrigé sur {v1} · {v2} %', { v0: avancement.corriges, v1: avancement.total, v2: avancement.pourcent ?? 0 })
            }
            repere={{ 'data-securite-avancement': String(avancement.pourcent ?? 0) }}
          >
            <div className="h-1.5 overflow-hidden rounded-full bg-faint/30" aria-hidden>
              <div className="h-full rounded-full bg-text" style={{ width: `${avancement.pourcent ?? 0}%` }} />
            </div>
            <p className="text-[12.5px] text-muted">
              {t('{v0} corrigé(s) · {v1} en correction · {v2} à traiter', { v0: avancement.corriges, v1: avancement.enCorrection, v2: avancement.aTraiter })}
            </p>
            {cartes.map(([cardId, carte]) => (
              <button
                key={cardId}
                type="button"
                onClick={() => ouvrirLaCarte(carte.projectId, cardId)}
                className="inline-flex w-fit max-w-full items-center gap-1 text-left text-[12.5px] text-accent hover:underline"
                data-securite-ouvrir-carte={cardId}
              >
                <span className="min-w-0 truncate">{carte.titre}</span>
                <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
              </button>
            ))}
          </LigneRepliable>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-col gap-2 border-t border-faint/25 pt-2.5" data-securite-evolution={evolution.length}>
        <p className="flex min-w-0 items-center gap-2">
          <span className="flex-1 truncate text-[13px] font-medium text-muted">{t('Évolution')}</span>
          {ecart !== null && premier ? (
            <span className="shrink-0 rounded-full bg-faint/20 px-2 py-0.5 text-[12px] text-text">
              {ecart > 0
                ? t('+{v0} depuis le {v1}', { v0: ecart, v1: dateLisible(premier.lance) })
                : ecart < 0
                  ? t('{v0} depuis le {v1}', { v0: ecart, v1: dateLisible(premier.lance) })
                  : t('Stable depuis le {v0}', { v0: dateLisible(premier.lance) })}
            </span>
          ) : null}
        </p>
        {evolution.length >= 2 ? <CourbeDeNote points={evolution} /> : <p className="text-[12.5px] text-muted">{t('La courbe se dessine à partir du deuxième audit.')}</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Par catégorie                                                        */
/* ------------------------------------------------------------------ */

type FamilleDuRapport = 'dependances' | 'cadre' | 'secrets' | 'acces' | 'injection' | 'xss' | 'entetes' | 'robots' | 'etude';

function familleDe(c: ConstatSecurite): FamilleDuRapport {
  return c.categorie === 'injection-sql' || c.categorie === 'injection-shell' ? 'injection' : (c.categorie as FamilleDuRapport);
}

function nomDeFamille(f: FamilleDuRapport): string {
  switch (f) {
    case 'dependances':
      return t('Composants externes');
    case 'cadre':
      return t('Socle du site');
    case 'secrets':
      return t('Clés et secrets');
    case 'acces':
      return t('Accès au serveur');
    case 'injection':
      return t('Requêtes et commandes');
    case 'xss':
      return t('Insertions de HTML');
    case 'entetes':
      return t('En-têtes');
    case 'robots':
      return t('Robots');
    case 'etude':
      return t('Étude approfondie');
  }
}

/** Les mots d'un contrôle (« Ce qui a été vérifié ») qui le rattachent à une famille : un contrôle couvert n'a pas de ligne à lui. */
const MOTS_DES_FAMILLES: Record<FamilleDuRapport, RegExp> = {
  dependances: /composant|d[ée]pendance/i,
  cadre: /socle|cadre/i,
  secrets: /cl[ée]|mot de passe|secret/i,
  acces: /acc[eè]s/i,
  injection: /requ[êe]te|commande/i,
  xss: /html/i,
  entetes: /en-t[êe]te/i,
  robots: /robot/i,
  etude: /^$/,
};

/** Le signe d'une ligne : la forme dit la gravité (monochrome), seule l'alerte prend la teinte importante. */
function SigneDeGravite({ pire }: { pire: GraviteSecurite | 'ok' | 'non-verifie' }) {
  if (pire === 'critique' || pire === 'elevee') return <TriangleAlert className="h-[17px] w-[17px] shrink-0 text-important" aria-label="Grave" />;
  if (pire === 'moyenne') return <CircleAlert className="h-[17px] w-[17px] shrink-0 text-text" aria-label="Moyenne" />;
  if (pire === 'faible') return <Info className="h-[17px] w-[17px] shrink-0 text-muted" aria-label="Faible" />;
  if (pire === 'ok') return <CircleCheck className="h-[17px] w-[17px] shrink-0 text-text" aria-label="Rien à signaler" />;
  return (
    <svg viewBox="0 0 24 24" className="h-[17px] w-[17px] shrink-0 text-faint" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-label="Non vérifié">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12h8" />
    </svg>
  );
}

function CarteDesCategories({
  constats,
  etapes,
  etats,
  nouveaux,
  cartes,
  onDeposer,
}: {
  constats: ConstatSecurite[];
  etapes: { nom: string; etat: string; note?: string }[];
  etats: Map<string, PointSuivi>;
  nouveaux: Set<string>;
  cartes: VueDAudit['cartes'];
  onDeposer: ((texte: string, retirer: boolean) => void) | null;
}) {
  const [ouverte, setOuverte] = React.useState<string | null>(null);
  const familles = new Map<FamilleDuRapport, ConstatSecurite[]>();
  for (const c of constats) familles.set(familleDe(c), [...(familles.get(familleDe(c)) ?? []), c]);
  const rang = (liste: ConstatSecurite[]) => Math.min(...liste.map((c) => ORDRE_DES_GRAVITES.indexOf(c.gravite)));
  const lignes = [...familles.entries()].sort((a, b) => rang(a[1]) - rang(b[1]) || b[1].length - a[1].length);
  const avecPoints = new Set(lignes.map(([f]) => f));
  /* Les contrôles qui n'ont rien trouvé gardent leur ligne : on voit d'un coup d'œil ce qui va ET ce qui ne va pas. */
  const controles = etapes.filter((e) => ![...avecPoints].some((f) => MOTS_DES_FAMILLES[f].test(e.nom)));
  return (
    <div className={cn(CLASSE_CARTE_DU_VOLET, 'py-1.5')} data-securite-categories={lignes.length}>
      <p className="py-2 text-[13px] font-medium text-muted">{t('Par catégorie')}</p>
      {!constats.length ? (
        <p className="border-t border-faint/25 py-2.5 text-[13.5px] text-text" data-securite-aucun-point="">
          {t('Aucun point relevé par cet audit.')}
        </p>
      ) : null}
      {lignes.map(([famille, liste]) => {
        const pire = ORDRE_DES_GRAVITES[rang(liste)]!;
        return (
          <div key={famille} className="border-t border-faint/25">
            <BlocDeCategorie
              famille={famille}
              pire={pire}
              constats={[...liste].sort((a, b) => ORDRE_DES_GRAVITES.indexOf(a.gravite) - ORDRE_DES_GRAVITES.indexOf(b.gravite))}
              controles={etapes.filter((e) => MOTS_DES_FAMILLES[famille].test(e.nom))}
              ouvert={ouverte === famille}
              onBasculer={() => setOuverte((o) => (o === famille ? null : famille))}
              etats={etats}
              nouveaux={nouveaux}
              cartes={cartes}
              onDeposer={onDeposer}
            />
          </div>
        );
      })}
      {controles.map((e, i) => (
        <div key={`controle:${i}`} className="flex min-w-0 items-center gap-2.5 border-t border-faint/25 py-2.5" data-securite-controle={e.etat === 'fait' ? 'ok' : 'non-verifie'}>
          <SigneDeGravite pire={e.etat === 'fait' ? 'ok' : 'non-verifie'} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13.5px] font-medium text-text">{e.nom}</span>
            <span className="truncate text-[12.5px] text-muted">{e.etat === 'fait' ? e.note || t('Rien à signaler') : `${t('Non vérifié')}${e.note ? ` — ${e.note}` : ''}`}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* L'accès des robots                                                  */
/* ------------------------------------------------------------------ */

const FAMILLES_AFFICHEES: { famille: FamilleDeRobots; libelle: () => string; detail: () => string }[] = [
  { famille: 'moteurs', libelle: () => t('Moteurs de recherche'), detail: () => t('Google, Bing : le site apparaît dans leurs résultats') },
  { famille: 'recherche', libelle: () => t('IA de recherche'), detail: () => t('ChatGPT, Perplexity, Claude : elles peuvent citer vos pages dans leurs réponses') },
  { famille: 'agents', libelle: () => t('Assistants qui visitent à la demande'), detail: () => t('Quand quelqu’un demande à son IA d’ouvrir une page du site') },
  { famille: 'entrainement', libelle: () => t('IA d’entraînement'), detail: () => t('GPTBot, ClaudeBot… apprennent sur votre contenu, sans vous citer') },
];

/**
 * L'ACCÈS DES ROBOTS (carte « Sécurité, rapports et marketing restructurés », 22/11/2026, maquette #9542) : en tête du
 * rapport, un interrupteur « Protection active » et quatre familles de sources. Chaque geste part au démon, qui
 * l'APPLIQUE sur le serveur du site (Caddy rechargé, jamais redémarré) et rend le nouvel état ; le geste le dit dès le
 * clic. Un site servi ailleurs le dit au lieu de proposer des cases sans effet.
 */
function AccesDesRobots({ projectId }: { projectId: string }) {
  const [etat, setEtat] = React.useState<EtatDesRobots | null | undefined>(undefined);
  const [envoi, setEnvoi] = React.useState<string | null>(null);
  const [panne, setPanne] = React.useState<string | null>(null);

  React.useEffect(() => {
    let vivant = true;
    setEtat(undefined);
    client
      .call<EtatDesRobots>({ type: 'securite.robots.lire', projectId }, 45000)
      .then((r) => vivant && setEtat(r))
      .catch((e) => {
        if (!vivant) return;
        setEtat(null);
        setPanne((e as Error)?.message ?? String(e));
      });
    return () => {
      vivant = false;
    };
  }, [projectId]);

  const regler = async (cle: string, reglage: ReglageRobots) => {
    if (!etat) return;
    setEnvoi(cle);
    setPanne(null);
    const avant = etat;
    setEtat({ ...etat, reglage });
    try {
      setEtat(await client.call<EtatDesRobots>({ type: 'securite.robots.regler', projectId, reglage }, 90000));
    } catch (e) {
      setEtat(avant);
      setPanne(t('Réglage non appliqué : {v0}', { v0: (e as Error)?.message ?? String(e) }));
    } finally {
      setEnvoi(null);
    }
  };

  if (etat === undefined) return <div className="h-[52px] animate-pulse rounded-xl bg-surface" data-securite-robots="chargement" />;
  if (etat === null)
    return (
      <p className="text-[12.5px] text-danger" data-securite-robots="erreur">
        {panne}
      </p>
    );
  const r = etat.reglage;
  const resume = r.protection
    ? t('{v0} sources sur 4 autorisées', { v0: famillesAutorisees(r) })
    : t('Protection coupée');
  const hote = etat.hote ?? '';
  /* TOUTES LES ADRESSES DU SITE, ET LA VERSION QU'ELLES PORTENT (carte « Accès des IA : prod ou dev », 23/11/2026). */
  const adresses = (etat.hotes?.length ? etat.hotes : hote ? [hote] : []).join(', ');
  const version =
    etat.version === 'en-ligne' ? t('Site final') : etat.version === 'travail' ? t('Site en développement') : null;
  return (
    <BlocRepliable
      titre={t('Accès des robots')}
      repere="securite-robots"
      clef="securite-robots-ouvert"
      defautOuvert={false}
      resumeReplie={etat.reglable ? resume : undefined}
      action={
        etat.reglable ? (
          <label className="flex items-center gap-2.5 text-[13px] text-muted">
            <span className="max-sm:hidden">{t('Protection active')}</span>
            <Switch
              checked={r.protection}
              attente={envoi === 'protection'}
              disabled={envoi !== null}
              onCheckedChange={(v) => void regler('protection', { ...r, protection: v })}
              aria-label="Protection active"
              data-securite-robots-protection={r.protection ? 'active' : 'coupee'}
            />
          </label>
        ) : null
      }
    >
      <div className="flex flex-col gap-3" data-securite-robots={etat.application}>
        {version && adresses ? (
          <p className="text-[12.5px] text-muted" data-securite-robots-version={etat.version}>
            <span className="text-faint">{version} · </span>
            <span className="break-all text-text">{adresses}</span>
          </p>
        ) : null}
        {etat.reserveeAuxConnectes ? (
          <p className="text-[13px] text-muted" data-securite-robots-reservee="">
            {t('Ce site en développement est réservé aux personnes connectées : aucun robot ni aucune IA n’y entre. Renseignez l’adresse du site final dans les paramètres du projet pour régler l’accès des IA au vrai site.')}
          </p>
        ) : !etat.reglable ? (
          <p className="text-[13px] text-muted" data-securite-robots-ailleurs="">
            {etat.application === 'sans-adresse'
              ? t('Ce projet n’a pas d’adresse : rien à régler.')
              : t('{v0} est servi hors de nos serveurs : ce site gère ses robots lui-même, dans son propre fichier robots.txt.', { v0: hote })}
          </p>
        ) : (
          <>
            <p className="text-[13px] text-muted">
              {t('Cochez les sources qui peuvent lire {v0}. Les autres sont renvoyées vers une page d’explication.', { v0: adresses || hote })}
            </p>
            <div className={cn('flex flex-col gap-3', !r.protection && 'opacity-50')}>
              {FAMILLES_AFFICHEES.map(({ famille, libelle, detail }) => {
                const moteursAilleurs = famille === 'moteurs' && !etat.moteursReglables;
                return (
                  <div key={famille} className="flex items-start gap-3" data-securite-robots-famille={famille}>
                    <CaseACocher
                      checked={r[famille]}
                      disabled={!r.protection || envoi !== null || moteursAilleurs}
                      onCheckedChange={(v) => void regler(famille, { ...r, [famille]: v })}
                      className="mt-0.5"
                      title={libelle()}
                      data-securite-robots-case={famille}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-center gap-2 text-[13.5px] text-text">
                        {libelle()}
                        {envoi === famille ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" /> : null}
                      </span>
                      <span className="text-[12.5px] text-muted">
                        {moteursAilleurs ? t('Sur le serveur des sites publics, ce choix se règle dans le fichier robots.txt du site.') : detail()}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="text-[12.5px] text-faint">
              {etat.application === 'garde-absente'
                ? t('La garde n’est pas encore installée sur le serveur des sites publics : ce réglage est gardé et s’appliquera dès son installation.')
                : t('Couper l’interrupteur laisse passer toutes les sources.')}
            </p>
            {etat.version === 'en-ligne' && etat.hotesDeTravail?.length ? (
              <p className="text-[12.5px] text-faint" data-securite-robots-travail="">
                {t('Le site en développement ({v0}) n’est pas concerné : il est fermé aux robots, et réservé aux personnes connectées quand sa protection est allumée.', {
                  v0: etat.hotesDeTravail.join(', '),
                })}
              </p>
            ) : null}
          </>
        )}
        {panne ? <p className="text-[12.5px] text-danger">{panne}</p> : null}
      </div>
    </BlocRepliable>
  );
}

/** La raison d'un blocage, d'après la prison du garde (mêmes mots que raisonDeLaPrison, traduits ici). */
function raisonLisible(prison: string): string {
  if (/pieges/.test(prison)) return t('A cherché des fichiers sensibles');
  if (/cadence-apps/.test(prison)) return t('Rafale de demandes sur une application d’équipe');
  if (/cadence/.test(prison)) return t('Rafale de pages');
  if (/recidive/.test(prison)) return t('Récidive');
  return t('Bloqué par le garde');
}

/** « 2026-11-19 08:43:38 » → « 19/11 à 08:43 ». */
function dateCourte(texte: string | null): string {
  const m = texte ? /^\d{4}-(\d\d)-(\d\d) (\d\d:\d\d)/.exec(texte) : null;
  return m ? t('{v0}/{v1} à {v2}', { v0: m[2]!, v1: m[1]!, v2: m[3]! }) : '';
}

/**
 * LES VISITEURS BLOQUÉS (carte « Anti-robots et référencement des projets », 18/11/2026) : les adresses coupées ou
 * bannies par le garde du serveur qui sert le projet (un bannissement vaut pour tout ce serveur), avec leur raison,
 * leur date et « Libérer », qui lève le bannissement d'un clic et le dit dès le clic. Pastille PLEINE : banni pour
 * toujours ; ANNEAU : coupé pour une durée. Lu à l'ouverture du rapport, jamais en boucle.
 */
function VisiteursBloques({ projectId }: { projectId: string }) {
  const [etat, setEtat] = React.useState<VisiteursBloquesDuProjet | null | undefined>(undefined);
  const [enLiberation, setEnLiberation] = React.useState<string | null>(null);
  const [panne, setPanne] = React.useState<string | null>(null);

  React.useEffect(() => {
    let vivant = true;
    setEtat(undefined);
    client
      .call<VisiteursBloquesDuProjet>({ type: 'securite.bloques', projectId }, 45000)
      .then((r) => vivant && setEtat(r))
      .catch((e) => {
        if (!vivant) return;
        setEtat(null);
        setPanne((e as Error)?.message ?? String(e));
      });
    return () => {
      vivant = false;
    };
  }, [projectId]);

  const liberer = async (ip: string) => {
    setEnLiberation(ip);
    setPanne(null);
    try {
      setEtat(await client.call<VisiteursBloquesDuProjet>({ type: 'securite.liberer', projectId, ip }, 45000));
    } catch (e) {
      setPanne(t('Impossible de libérer {v0} : {v1}', { v0: ip, v1: (e as Error)?.message ?? String(e) }));
    } finally {
      setEnLiberation(null);
    }
  };

  const visiteurs = etat?.visiteurs ?? [];
  return (
    /* Remonté une fois la liste lue : « ouvert d'office » ne se décide qu'à la pose du bloc, et il s'ouvre s'il y a des bannis. */
    <BlocRepliable key={etat ? 'lu' : 'attente'} titre={t('Visiteurs bloqués')} repere="securite-bloques" defautOuvert={visiteurs.length > 0} compte={etat ? visiteurs.length : undefined}>
      <div className="flex flex-col gap-1.5" data-securite-bloques="">
        {etat === undefined ? (
          <div className="h-12 animate-pulse rounded-xl bg-raised" />
        ) : etat === null ? null : !visiteurs.length ? (
          <p className="text-[13px] text-muted">
            {etat.gardeActif === false
              ? t('Aucun garde ne coupe les visiteurs insistants sur le serveur de ce projet.')
              : etat.gardeActif === null
                ? t('Liste non lue : {v0}.', { v0: etat.note ?? t('serveur inconnu') })
                : t('Aucune adresse bloquée en ce moment.')}
          </p>
        ) : (
          <>
            <p className="text-[12px] text-faint">
              {t('Un blocage vaut pour tout le serveur qui sert ce projet. Pastille pleine : banni pour toujours ; anneau : coupé pour une durée.')}
            </p>
            <ZoneDefilement className="max-h-[320px]">
              <div className="flex flex-col gap-0.5 rounded-xl bg-raised p-1.5">
                {visiteurs.map((v) => (
                  <div key={v.ip} className="flex items-center gap-3 rounded-xl px-3 py-2.5" data-securite-bloque={v.ip}>
                    <span
                      className={cn('h-[7px] w-[7px] shrink-0 rounded-full', v.definitif ? 'bg-text' : 'ring-[1.5px] ring-inset ring-text')}
                      aria-label={v.definitif ? t('banni pour toujours') : t('coupé pour une durée')}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[13px] text-text">{v.ip}</span>
                      <span className="block truncate text-[12px] text-muted">
                        {raisonLisible(v.prison)} · {v.definitif ? t('banni pour toujours') : t('jusqu’au {v0}', { v0: dateCourte(v.jusqua) })}
                      </span>
                    </span>
                    <Button
                      variant="subtle"
                      size="sm"
                      disabled={enLiberation !== null}
                      onClick={() => void liberer(v.ip)}
                      data-securite-liberer={v.ip}
                    >
                      {enLiberation === v.ip ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      {enLiberation === v.ip ? t('Libération…') : t('Libérer')}
                    </Button>
                  </div>
                ))}
              </div>
            </ZoneDefilement>
          </>
        )}
        {panne ? <p className="text-[12.5px] text-danger">{panne}</p> : null}
      </div>
    </BlocRepliable>
  );
}

/** La ligne d'un point dans le champ d'écriture : « - Corriger : <titre> ». */
function ligneDuPoint(c: ConstatSecurite): string {
  return ligneDeSuggestion(texteDuPointPourLeChamp(c));
}

function BlocDeCategorie({
  famille,
  pire,
  constats,
  controles,
  ouvert,
  onBasculer,
  etats,
  nouveaux,
  cartes,
  onDeposer,
}: {
  famille: FamilleDuRapport;
  pire: GraviteSecurite;
  constats: ConstatSecurite[];
  /** Les contrôles de l'audit rattachés à cette catégorie : leur mesure se lit en tête du bloc ouvert. */
  controles: { nom: string; etat: string; note?: string }[];
  ouvert: boolean;
  onBasculer: () => void;
  etats: Map<string, PointSuivi>;
  nouveaux: Set<string>;
  cartes: VueDAudit['cartes'];
  onDeposer: ((texte: string, retirer: boolean) => void) | null;
}) {
  const aTraiter = constats.filter((c) => (etats.get(empreinteDuConstat(c))?.etat ?? 'a-traiter') === 'a-traiter');
  const lignes = aTraiter.map(ligneDuPoint);
  const toutes = useLignesDansLeChamp(lignes);
  return (
    <LigneRepliable
      ouvert={ouvert}
      onBasculer={onBasculer}
      devant={<SigneDeGravite pire={pire} />}
      titre={nomDeFamille(famille)}
      detail={compteLisible(compteParGravite(constats))}
      compte={constats.length}
      repere={{ 'data-securite-categorie': famille }}
    >
      {controles.map((e, i) => (
        <p key={i} className="select-text text-[12.5px] leading-snug text-muted" data-securite-controle-de-categorie="">
          <span className="text-text">{e.nom}</span>
          {e.etat !== 'fait' ? ` · ${t('non vérifié')}` : ''}
          {e.note ? ` — ${e.note}` : ''}
        </p>
      ))}
      {onDeposer && lignes.length ? (
        <button
          type="button"
          onClick={() => onDeposer(lignes.join('\n'), toutes)}
          className="w-fit rounded-md bg-bg px-2.5 py-1 text-[12px] text-muted transition-colors hover:text-text sm:px-2 sm:py-0.5"
          data-securite-tout-ajouter={famille}
        >
          {toutes ? t('Tout retirer') : t('Tout ajouter')}
        </button>
      ) : null}
      {constats.map((c) => {
        const empreinte = empreinteDuConstat(c);
        const point = etats.get(empreinte);
        return <PointDuRapport key={empreinte} constat={c} point={point ?? null} nouveau={nouveaux.has(empreinte)} carte={point?.cardId ? cartes[point.cardId] ?? null : null} onDeposer={onDeposer} />;
      })}
    </LigneRepliable>
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
    <div className="flex items-start gap-2.5 rounded-lg bg-bg px-3 py-2.5" data-securite-point={empreinteDuConstat(c)} data-securite-etat-point={etat}>
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
          <span className="rounded-full bg-raised px-2 py-px text-[11px] text-muted" data-securite-gravite-point={c.gravite}>
            {libelleGravite(c.gravite)}
          </span>
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
