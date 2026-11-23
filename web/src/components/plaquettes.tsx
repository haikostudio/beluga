import * as React from 'react';
import { createPortal } from 'react-dom';
import { EtatVideDuProjet, useFiltreCentral, useProjetDuService } from '@/components/projet-du-service';
import { naviguerVers } from '@/components/ui/lien-interne';
import { creerUnAgentDeType } from '@/lib/creer-un-agent';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Check, ChevronDown, Maximize2, Minimize2, PanelRight, PanelRightClose, Presentation, RectangleHorizontal, RectangleVertical, Download, Eye, FileText, Link2, Link2Off, ListChecks, Loader2, MessageSquare, Palette, Pencil, RefreshCw, Stamp, Trash2, Undo2, X } from '@/components/ui/icones';
import {
  ancrerUnFil,
  FORMATS_DE_PLAQUETTE,
  type AdresseDePlaquette,
  type BlocDePlaquette,
  type FilDeCommentaires,
  type FormatDePlaquette,
  type MarqueDePlaquette,
  ordonnerParDerniereActivite,
  minusculesSansAccents,
  estUnMessageDuDemonDeCharte,
  parcoursDeLaCharte,
  type EtapeDeLaCharte,
} from '@beluga/shared';
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Drawer,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EnteteDeFeuille,
  Input,
  ListeDeroulante,
  Pastille,
  TitreDePage,
  ZoneDefilement,
} from '@/components/ui';
import { ApercuAuSurvol, BasculeTableauCartes, CorpsDApercu, useVueDeLaListe } from '@/components/ui/apercu-au-survol';
import { TitreEtSous } from '@/components/ui/apercu-de-ligne';
import { BasculeDePage, RechercheDuService, useSansLigneDeTitre } from '@/components/fenetre-de-service';
import { colonneProjet } from '@/components/ui/colonne-projet';
import { CarteDeTableau } from '@/components/ui/carte-de-tableau';
import { Tableau, type ColonneDuTableauCommun } from '@/components/ui/tableau';
import { BoutonsRadio, CaseACocher, ChoixDeCouleur } from '@/components/ui/elements-maison';
import { CLASSE_SECTION_DE_SERVICE, ColonneDeService, useColonneDeService } from '@/components/colonne-de-service';
import { CranDuFil, GestesDePage, OptionDePage, OptionsDePage, SuiteDuFil } from '@/components/entete-de-zone';
import { PastilleProjet } from '@/components/pastille-projet';
import { SilhouetteConversation, SilhouetteTableauDeService, SilhouetteTachesRecurrentes } from '@/components/silhouettes';
import { adresseDePiece, ImageDePiece } from '@/components/pastille-de-fichier';
import { libelleDuFormat, VignetteDePlaquette } from '@/components/carte-de-plaquette';
import { DocumentModifiable, type PoigneeDuLecteur } from '@/components/plaquette-editeur';
import { Chat } from '@/components/chat';
import { LigneDeParcours } from '@/components/ligne-de-parcours';
import { ResizeHandle, useResizable } from '@/components/resizer';
import { CLASSE_FENETRE_DU_VOLET, CLASSE_VOLET_DU_PLAN, bornesDuVoletDuPlan, usePlaceDeLaRangee } from '@/components/volet-comme-un-plan';
import { HAUTEUR_DE_CONTROLE } from '@/components/ui';
import { client } from '@/lib/client';
import { ouvrirUnMedia } from '@/lib/ouvrir-un-media';
import { useApp } from '@/lib/use-app';
import { useTelephone } from '@/lib/telephone';
import { formatRegional, t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LE SERVICE « CHARTE GRAPHIQUE » (carte « Refonte du service Charte graphique », 05/11/2026 — refonte demandée par
 * l'utilisateur ; identifiants internes inchangés : vue `plaquettes`, adresse `#plaquettes/…`, tables `plaquette*`).
 *
 *  - À GAUCHE, dans la colonne du service : une CARTE par document (aperçu, nom, description, compteur des
 *    commentaires ouverts — violet quand le client a écrit du neuf). Le document choisi est marqué.
 *  - AU CENTRE : le document ouvert, MODIFIABLE SUR PLACE (`DocumentModifiable`), le FORMAT en haut à DROITE
 *    (décision de l'utilisateur, ferme), le bouton « Charte graphique » fixé en bas, qui ouvre la charte dans un VOLET
 *    par-dessus le document (une feuille du bas sur téléphone).
 *  - EN HAUT, dans la barre d'en-tête : la recherche, l'icône lien (copie le lien privé), le menu à trois points
 *    (ouvrir le PDF, couper / rouvrir / renouveler le lien, commentaires résolus, marque par défaut, supprimer).
 *    Le nombre d'ouvertures ne s'affiche plus (la donnée reste en base).
 *
 * Chaque modification s'enregistre seule, peu après la dernière frappe (une nouvelle version : le lien du client la
 * montre aussitôt, le PDF se refait vingt secondes plus tard). Sur téléphone, sans colonne : la liste des cartes dans
 * la page ; un document ouvert remonte à la liste par la flèche de la barre d'en-tête.
 */

interface PlaquetteListee {
  id: string;
  projectId: string;
  titre: string;
  format: FormatDePlaquette;
  version: number;
  modifieLe: number;
  lienActif: boolean;
  marque: string;
  couleur: string;
  nonLues: number;
  filsOuverts: number;
  vignette: string | null;
  description: string;
}

interface Fiche {
  plaquette: {
    id: string;
    projectId: string;
    titre: string;
    langue: string;
    blocs: BlocDePlaquette[];
    marque: MarqueDePlaquette;
    format: FormatDePlaquette;
    adresse: AdresseDePlaquette;
    version: number;
    lienActif: boolean;
    modifieLe: number;
  };
  projetMarqueNom: string | null;
  lien: string;
  fils: FilDeCommentaires[];
  nonLues: number;
  pieces?: Record<string, { nom: string; mime?: string }>;
  /** Les retouches pas encore enregistrées (le client ne les voit pas), avec la version d'où elles sont parties. */
  brouillon: (Brouillon & { langue: string; modifieLe: number; base: number }) | null;
}

interface Brouillon {
  titre: string;
  blocs: BlocDePlaquette[];
  marque: MarqueDePlaquette;
  format: FormatDePlaquette;
  adresse: AdresseDePlaquette;
}

const dateCourte = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const parModification = (a: PlaquetteListee, b: PlaquetteListee) => b.modifieLe - a.modifieLe;
const sansAccents = minusculesSansAccents;

/**
 * TOUS LES DOCUMENTS, lus UNE fois ; un changement annoncé par le démon ne relit QUE le document concerné (un
 * commentaire du client ne recharge pas toute la liste).
 */
function useTousLesDocuments(): { liste: PlaquetteListee[] | null; marqueParDefaut: { id: string; nom: string } | null; relire: () => void } {
  const [liste, setListe] = React.useState<PlaquetteListee[] | null>(null);
  const [marqueParDefaut, setMarque] = React.useState<{ id: string; nom: string } | null>(null);
  const [signal, setSignal] = React.useState(0);
  React.useEffect(() => {
    let vivant = true;
    client
      .call<{ plaquettes: PlaquetteListee[]; marqueParDefaut: { id: string; nom: string } | null }>({ type: 'plaquettes.toutes' })
      .then((r) => {
        if (!vivant) return;
        setListe((r.plaquettes ?? []).slice().sort(parModification));
        setMarque(r.marqueParDefaut ?? null);
      })
      .catch(() => vivant && setListe((l) => l ?? []));
    return () => {
      vivant = false;
    };
  }, [signal]);
  React.useEffect(
    () =>
      client.onPlaquettes((e) => {
        void client
          .call<{ plaquettes: PlaquetteListee[] }>({ type: 'plaquettes.toutes', id: e.plaquetteId })
          .then((r) => {
            const ligne = r.plaquettes?.[0];
            setListe((l) => {
              if (!l) return l;
              const autres = l.filter((x) => x.id !== e.plaquetteId);
              return (ligne ? [...autres, ligne] : autres).sort(parModification);
            });
          })
          .catch(() => undefined);
      }),
    [],
  );
  return { liste, marqueParDefaut, relire: () => setSignal((n) => n + 1) };
}

export function Plaquettes({
  open,
  enPage,
  onClose,
  vise,
  plaquetteVisee,
  onVise,
}: {
  open: boolean;
  enPage?: boolean;
  onClose: () => void;
  /** Le projet du filtre (null : tous). */
  vise: string | null;
  plaquetteVisee: string | null;
  onVise: (projet: string | null, plaquetteId?: string | null) => void;
}) {
  const state = useApp();
  const telephone = useTelephone();
  const dansLaColonne = useColonneDeService();
  const { liste, marqueParDefaut, relire } = useTousLesDocuments();
  const [recherche, setRecherche] = React.useState('');
  const [marqueOuverte, setMarqueOuverte] = React.useState(false);
  const projet = (id: string) => state.projects.find((p) => p.id === id);
  /* DANS L'ONGLET D'UN PROJET (refonte du 13/11/2026) : ses documents seulement. */
  const projetDuService = useProjetDuService();
  const filtreCentral = useFiltreCentral();
  const [creationEnCours, setCreationEnCours] = React.useState(false);
  React.useEffect(() => {
    /* PAGE OUVERTE DEPUIS « SERVICES » SUR « TOUS LES PROJETS » (17/11/2026) : la liste suit la portée du fil. Passée
       d'un projet à « Tous », `vise` gardait l'ancien projet et la liste restait filtrée. Un document ouvert garde le
       sien (son ouverture pose `vise` sur son projet). */
    if (projetDuService) {
      if (vise !== projetDuService.id) onVise(projetDuService.id, plaquetteVisee);
    } else if (filtreCentral && vise && !plaquetteVisee) onVise(null, null);
  }, [projetDuService, filtreCentral, vise, plaquetteVisee, onVise]);
  const cherche = sansAccents(recherche.trim());
  const visibles = (liste ?? []).filter(
    (p) =>
      (!vise || p.projectId === vise) &&
      (!cherche || sansAccents(`${p.titre} ${p.marque} ${p.description} ${projet(p.projectId)?.name ?? ''}`).includes(cherche)),
  );
  /* UN DOCUMENT S'OUVRE AVEC SON PROJET (14/11/2026, « j'ai cliqué sur cette charte et rien, page vide ») : depuis
     « Tous les projets », `vise` est nul et le document s'ouvrait sans projet. On prend celui du document. */
  const ouvrir = (id: string | null) => onVise(vise ?? (id ? (liste ?? []).find((p) => p.id === id)?.projectId ?? null : null), id);

  /* AVEC LA LISTE À GAUCHE, LE CENTRE N'EST JAMAIS VIDE : sans document choisi, le plus récent s'ouvre. Sans menu à
     part (fenêtre des outils de création, téléphone), la liste est la page : rien ne s'ouvre tout seul. */
  const premier = visibles[0]?.id ?? null;
  React.useEffect(() => {
    if (dansLaColonne && !plaquetteVisee && premier) onVise(vise, premier);
  }, [dansLaColonne, plaquetteVisee, premier, vise, onVise]);

  const cartes = (
    <ul className="flex min-w-0 flex-col gap-1" data-plaquettes-liste data-plaquettes-lignes={visibles.length}>
      {visibles.map((p) => (
        <li key={p.id} className="min-w-0">
          <CarteDeDocument plaquette={p} projet={projet(p.projectId)?.name ?? null} choisie={p.id === plaquetteVisee} onOuvrir={() => ouvrir(p.id)} />
        </li>
      ))}
    </ul>
  );
  /* LE TABLEAU PAR DÉFAUT (carte « Onglets, services et listes repensés », 14/11/2026) : vignette, titre et
     description, projet, format, commentaires ouverts, modification ; la vignette en grand au survol. Les cartes
     d'avant restent l'autre vue (bascule retenue). */
  const [vueDeLaListe, setVueDeLaListe] = useVueDeLaListe('plaquettes.vueDeLaListe');
  const tableau = (
    <ApercuAuSurvol lire={(id) => visibles.find((p) => p.id === id)} rendu={(p) => <ApercuDeDocument plaquette={p} projet={projet(p.projectId)?.name ?? null} />}>
      <Tableau
        repere="plaquettes"
        lignes={visibles}
        cle={(p) => p.id}
        onLigne={(p) => ouvrir(p.id)}
        ligneChoisie={plaquetteVisee}
        aere
        recherche={false}
        attributsRacine={{ 'data-plaquettes-liste': '', 'data-plaquettes-lignes': visibles.length }}
        attributsLigne={(p) => ({ 'data-plaquettes-ligne': p.id })}
        colonnes={colonnesDesDocuments((id) => projet(id)?.name ?? null)}
        pile={(p) => (
          <>
            <VignetteDePlaquette vignette={p.vignette} format={p.format} couleur={p.couleur} titre={p.titre} className={cn('shrink-0', p.format === 'a4-portrait' ? 'w-8' : 'w-12')} />
            <span className="min-w-0 flex-1">
              <TitreEtSous titre={p.titre} sous={[projet(p.projectId)?.name, libelleDuFormat(p.format)].filter(Boolean).join(' · ')} />
            </span>
            <span className="shrink-0 text-[11.5px] text-faint">{dateCourte(p.modifieLe)}</span>
          </>
        )}
      />
    </ApercuAuSurvol>
  );
  /* LES CARTES DE LA PAGE (14/11/2026) : la vue en cartes du tableau commun — recherche, tri et pages gardés —, une
     carte de même forme par document. La liste en rangées (`cartes`) reste celle de la colonne de service. */
  const grilleDesDocuments = (
    <Tableau
      repere="plaquettes"
      lignes={visibles}
      cle={(p) => p.id}
      onLigne={(p) => ouvrir(p.id)}
      ligneChoisie={plaquetteVisee}
      recherche={false}
      attributsRacine={{ 'data-plaquettes-liste': '', 'data-plaquettes-lignes': visibles.length }}
      attributsLigne={(p) => ({ 'data-plaquettes-ligne': p.id })}
      colonnes={colonnesDesDocuments((id) => projet(id)?.name ?? null)}
      grille={(p) => (
        <CarteDeTableau
          image={<VignetteDePlaquette vignette={p.vignette} format={p.format} couleur={p.couleur} titre={p.titre} className={cn('shadow-sm', p.format === 'a4-portrait' ? 'h-[80%] w-auto' : 'w-[70%]')} />}
          projet={{ id: p.projectId, nom: projet(p.projectId)?.name ?? null }}
          etat={
            p.filsOuverts ? (
              <span
                className={cn('inline-block h-5 min-w-5 rounded-full px-1.5 text-center text-[11.5px] font-semibold leading-5', p.nonLues ? 'bg-text text-bg' : 'bg-raised text-muted')}
                title={t('{n} commentaire(s) ouvert(s)', { n: p.filsOuverts })}
              >
                {p.filsOuverts}
              </span>
            ) : null
          }
          titre={p.titre}
          texte={p.description || t('Aux couleurs de {marque}', { marque: p.marque })}
          chiffres={[
            { libelle: t('Format'), valeur: libelleDuFormat(p.format) },
            { libelle: t('Commentaires'), valeur: p.filsOuverts },
            { libelle: t('Modifié'), valeur: dateCourte(p.modifieLe) },
          ]}
        />
      )}
    />
  );
  const vide =
    liste !== null && !liste.length ? (
      <p className="max-w-xl px-2.5 text-[13.5px] text-muted" data-plaquettes-vide>
        {t('Aucun document pour l’instant. Demandez à un agent de rédiger un document de présentation (A4 portrait, A4 paysage ou diapositives) : il arrive dans la conversation, et ici.')}
      </p>
    ) : liste !== null && !visibles.length ? (
      <p className="px-2.5 text-[13px] text-muted" data-plaquettes-vide-filtre>
        {t('Aucun document ne correspond.')}
      </p>
    ) : null;
  const filtre =
    vise && projet(vise) && !projetDuService ? (
      <div className="flex min-w-0 items-center gap-2 px-2.5 pb-2 text-[12.5px] text-muted" data-plaquettes-filtre={vise}>
        <PastilleProjet project={projet(vise)!} />
        <span className="min-w-0 flex-1 truncate">{projet(vise)!.name}</span>
        <Button size="icon-sm" variant="ghost" onClick={() => onVise(null, plaquetteVisee)} aria-label="Voir tous les projets" title={t('Voir tous les projets')} data-plaquettes-filtre-effacer>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    ) : null;

  if (projetDuService && liste !== null && !visibles.length && !cherche) {
    return (
      <Drawer open={open} onClose={onClose} enPage={enPage}>
        <EtatVideDuProjet
          icone={<FileText />}
          titre={t('Aucune charte pour {v0}', { v0: projetDuService.name })}
          texte={t('L’agent de la charte la conçoit avec vous : il relève les couleurs et les polices du site, cherche le logo et vous pose ses questions une à une. La charte se remplit à mesure, à droite de la conversation.')}
          /* LA CHARTE SE CRÉE PAR SON AGENT (17/11/2026) : un document neuf s'ouvre, l'agent à gauche qui commence, le
             document à droite qui se remplit — le même chemin que « Nouvel agent › Charte graphique », sans carte. */
          action={t('Créer la charte graphique')}
          enCours={creationEnCours}
          onAction={() => {
            setCreationEnCours(true);
            void creerUnAgentDeType('charte', { projectId: projetDuService.id }, () => {}).finally(() => setCreationEnCours(false));
          }}
          /* « VOIR TOUS LES PROJETS » (carte « Charte FishFlow introuvable », 17/11/2026) : la charte d'un autre projet
             existe peut-être — l'adresse « #charte » rouvre la page sur tous les projets. */
          fond={<SilhouetteTableauDeService lignes={8} />}
          actionSecondaire={t('Voir tous les projets')}
          onActionSecondaire={() => naviguerVers('#charte')}
          data-plaquettes-vide-projet
        />
      </Drawer>
    );
  }

  return (
    <Drawer open={open} onClose={onClose} enPage={enPage}>
      <TitreDePage className="sr-only">{t('Charte graphique')}</TitreDePage>

      {/* LA COLONNE DU SERVICE : les documents en cartes. */}
      <ColonneDeService>
        <nav aria-label="Documents" data-colonne-plaquettes className="flex min-h-0 flex-1 flex-col pt-1">
          <p className={CLASSE_SECTION_DE_SERVICE}>{t('Documents')}</p>
          {filtre}
          <ZoneDefilement className="min-h-0 flex-1 pb-4">{liste === null ? <SilhouetteTachesRecurrentes /> : (vide ?? cartes)}</ZoneDefilement>
        </nav>
      </ColonneDeService>

      {/* LA RECHERCHE, DANS LA RANGÉE DU TITRE (carte « Services homogènes et centrés ») : un champ sur ordinateur, une
          loupe dans la rangée de la feuille sur téléphone — plus de champ « Filtrer… » au-dessus du tableau. */}
      {plaquetteVisee || dansLaColonne ? null : (
        <RechercheDuService valeur={recherche} onChange={setRecherche} placeholder={t('Chercher un document…')} data-plaquettes-recherche />
      )}

      {plaquetteVisee ? (
        <CharteAvecSonAgent
          key={plaquetteVisee}
          id={plaquetteVisee}
          titre={(liste ?? []).find((x) => x.id === plaquetteVisee)?.titre ?? null}
          onFermer={() => ouvrir(null)}
          onSupprime={() => {
            relire();
            ouvrir(null);
          }}
          onMarque={() => setMarqueOuverte(true)}
        />
      ) : (
        <>
          <OptionsDePage enMenu>
            <OptionDePage variante="ghost" icone={<Stamp className="h-3 w-3" />} onClick={() => setMarqueOuverte(true)} data-plaquettes-marque>
              {t('Signature des documents')}
            </OptionDePage>
          </OptionsDePage>
          {!dansLaColonne ? (
            <>
              {liste?.length ? (
                <BasculeDePage>
                  <BasculeTableauCartes repere="vue-de-la-charte" valeur={vueDeLaListe} onChange={setVueDeLaListe} />
                </BasculeDePage>
              ) : null}
              <ZoneDefilement className="min-h-0 flex-1 pb-8">
                {liste === null ? <SilhouetteTableauDeService lignes={3} zone="charte-liste" /> : <>{filtre}{vide ?? (vueDeLaListe === 'tableau' ? tableau : grilleDesDocuments)}</>}
              </ZoneDefilement>
            </>
          ) : liste === null ? (
            <SilhouetteTableauDeService lignes={3} zone="charte-liste" />
          ) : (
            <div className="flex flex-1 items-center justify-center">{vide}</div>
          )}
        </>
      )}

      <ChoixDeLaMarque
        ouvert={marqueOuverte}
        valeur={marqueParDefaut?.id ?? ''}
        onFermer={() => setMarqueOuverte(false)}
        onChoisi={() => relire()}
      />
    </Drawer>
  );
}

/** Les colonnes du tableau des documents (14/11/2026). */
function colonnesDesDocuments(nomDuProjet: (id: string) => string | null): ColonneDuTableauCommun<PlaquetteListee>[] {
  return [
    {
      cle: 'titre',
      libelle: t('Document'),
      valeur: (p) => p.titre,
      filtre: 'texte',
      rendu: (p) => (
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex w-12 shrink-0 justify-center">
            <VignetteDePlaquette vignette={p.vignette} format={p.format} couleur={p.couleur} titre={p.titre} className={cn('shadow-sm', p.format === 'a4-portrait' ? 'w-8' : 'w-12')} />
          </span>
          <TitreEtSous titre={p.titre} sous={p.description || t('Aux couleurs de {marque}', { marque: p.marque })} />
        </span>
      ),
    },
    colonneProjet<PlaquetteListee>((p) => ({ id: p.projectId, nom: nomDuProjet(p.projectId) })),
    { cle: 'format', libelle: t('Format'), largeur: 150, secondaire: true, valeur: (p) => libelleDuFormat(p.format), rendu: (p) => <span className="truncate text-muted">{libelleDuFormat(p.format)}</span> },
    {
      cle: 'commentaires',
      libelle: t('Commentaires'),
      largeur: 130,
      droite: true,
      valeur: (p) => p.filsOuverts,
      rendu: (p) =>
        p.filsOuverts ? (
          <span
            className={cn('inline-block h-5 min-w-5 rounded-full px-1.5 text-center text-[11.5px] font-semibold leading-5', p.nonLues ? 'bg-text text-bg' : 'bg-raised text-muted')}
            title={t('{n} commentaire(s) ouvert(s)', { n: p.filsOuverts })}
            data-plaquette-non-lues={p.nonLues}
            data-plaquette-fils-ouverts={p.filsOuverts}
          >
            {p.filsOuverts}
          </span>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
    { cle: 'modifie', libelle: t('Modifié'), largeur: 120, droite: true, valeur: (p) => p.modifieLe, rendu: (p) => <span className="text-muted">{dateCourte(p.modifieLe)}</span> },
  ];
}

/** L'aperçu d'un document au survol : sa vignette en grand, son titre, son projet, ses chiffres. */
function ApercuDeDocument({ plaquette: p, projet }: { plaquette: PlaquetteListee; projet: string | null }) {
  return (
    <CorpsDApercu
      image={
        <span className="flex h-full w-full items-center justify-center p-3">
          <VignetteDePlaquette vignette={p.vignette} format={p.format} couleur={p.couleur} titre={p.titre} className={cn('shadow-md', p.format === 'a4-portrait' ? 'h-full w-auto' : 'w-full')} />
        </span>
      }
      sous={[projet, libelleDuFormat(p.format)].filter(Boolean).join(' · ')}
      titre={p.titre}
      texte={p.description || t('Aux couleurs de {marque}', { marque: p.marque })}
      chiffres={[
        { libelle: t('Commentaires'), valeur: p.filsOuverts },
        { libelle: t('Modifié'), valeur: dateCourte(p.modifieLe) },
      ]}
    />
  );
}

/** Une carte de la colonne : l'aperçu du document, son nom, sa description, le compteur de commentaires ouverts. */
function CarteDeDocument({ plaquette: p, projet, choisie, onOuvrir }: { plaquette: PlaquetteListee; projet: string | null; choisie: boolean; onOuvrir: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOuvrir}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onOuvrir();
      }}
      aria-current={choisie ? 'true' : undefined}
      className={cn(
        'relative flex min-w-0 cursor-pointer gap-3 rounded-xl p-2 transition-colors hover:bg-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-text/30',
        choisie && 'bg-raised',
      )}
      data-plaquettes-carte={p.id}
      data-plaquettes-ligne={p.id}
    >
      <VignetteDePlaquette vignette={p.vignette} format={p.format} couleur={p.couleur} titre={p.titre} className={cn('shrink-0 shadow-sm', p.format === 'a4-portrait' ? 'w-11' : 'w-16')} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn('truncate text-[13.5px] font-medium', choisie ? 'text-teinte' : 'text-text')}>{p.titre}</span>
        <span className="line-clamp-2 text-[12px] leading-snug text-muted">{p.description || t('Aux couleurs de {marque}', { marque: p.marque })}</span>
        <span className="truncate text-[11.5px] text-faint">{[projet, libelleDuFormat(p.format), dateCourte(p.modifieLe)].filter(Boolean).join(' · ')}</span>
      </span>
      {p.filsOuverts ? (
        <span
          className={cn('h-5 min-w-5 shrink-0 self-start rounded-full px-1.5 text-center text-[11.5px] font-semibold leading-5', p.nonLues ? 'bg-text text-bg' : 'bg-raised text-muted')}
          title={t('{n} commentaire(s) ouvert(s)', { n: p.filsOuverts })}
          data-plaquette-non-lues={p.nonLues}
          data-plaquette-fils-ouverts={p.filsOuverts}
        >
          {p.filsOuverts}
        </span>
      ) : null}
    </div>
  );
}

/** L'AUTEUR QUI SIGNE les documents (« Réalisé par … ») : la marque d'un document est celle du projet qu'il décrit. */
function ChoixDeLaMarque({ ouvert, valeur, onFermer, onChoisi }: { ouvert: boolean; valeur: string; onFermer: () => void; onChoisi: () => void }) {
  const state = useApp();
  const [occupe, setOccupe] = React.useState(false);
  const projets = ordonnerParDerniereActivite(state.projects.filter((p) => !p.archived));
  return (
    <Dialog open={ouvert} onOpenChange={(o) => !o && onFermer()}>
      <DialogContent adresse="saisie" className="sm:w-[min(440px,100%)]">
        <DialogHeader>
          <DialogTitle>{t('Signature des documents')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2 px-5">
          <p className="text-[13px] text-muted">{t('Chaque document est aux couleurs du projet qu’il décrit ; ce projet-ci le signe seulement, en petit.')}</p>
          <ListeDeroulante
            valeur={valeur}
            titre={t('Signature des documents')}
            placeholder={t('Choisir un projet')}
            options={projets.map((p) => ({ valeur: p.id, libelle: p.name, icone: <PastilleProjet project={p} /> }))}
            repere="plaquettes-marque"
            seuilRecherche={6}
            onChoisir={(v) => {
              setOccupe(true);
              void client
                .call({ type: 'settings.update', patch: { marqueDesPlaquettes: v } })
                .then(() => {
                  onChoisi();
                  onFermer();
                })
                .finally(() => setOccupe(false));
            }}
          />
          {occupe ? (
            <p className="flex items-center gap-1.5 text-[12.5px] text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('Enregistrement…')}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onFermer}>
            {t('Fermer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* La charte et son agent                                               */
/* ------------------------------------------------------------------ */

const CLE_DU_PLI_DE_LA_CHARTE = 'beluga.charte-volet';
/** La largeur du volet de la charte : SA mémoire (le document se lit plus large qu'un plan), les bornes communes. */
const CLE_DE_LARGEUR_DE_LA_CHARTE = 'volet-de-la-charte';

/** Le pli du volet de la charte, gardé sur l'appareil (ouvert tant qu'on ne l'a pas replié). */
function usePliDeLaCharte(): [boolean, (ouvert: boolean) => void] {
  const [ouvert, setOuvert] = React.useState<boolean>(() => {
    try {
      return window.localStorage.getItem(CLE_DU_PLI_DE_LA_CHARTE) !== 'ferme';
    } catch {
      return true;
    }
  });
  const poser = React.useCallback((o: boolean) => {
    setOuvert(o);
    try {
      window.localStorage.setItem(CLE_DU_PLI_DE_LA_CHARTE, o ? 'ouvert' : 'ferme');
    } catch {
      /* Un onglet privé garde le pli en mémoire seulement. */
    }
  }, []);
  return [ouvert, poser];
}

/** Les messages que le démon envoie à l'agent (son premier message) ne sont pas des bulles de l'utilisateur. */
const sansLesMessagesDuDemonDeCharte = (m: { role: string; content: string }) => !(m.role === 'user' && estUnMessageDuDemonDeCharte(m.content));

/** Les blocs du document, relus à chaque changement : la ligne d'étapes se lit dedans. */
function useBlocsDuDocument(id: string): BlocDePlaquette[] | null {
  const [blocs, setBlocs] = React.useState<BlocDePlaquette[] | null>(null);
  const [signal, setSignal] = React.useState(0);
  React.useEffect(() => client.onPlaquettes((e) => e.plaquetteId === id && setSignal((n) => n + 1)), [id]);
  React.useEffect(() => {
    let vivant = true;
    client
      .call<Fiche>({ type: 'plaquettes.fiche', id })
      .then((f) => vivant && setBlocs(f.plaquette.blocs))
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
  }, [id, signal]);
  return blocs;
}

/**
 * UNE CHARTE OUVERTE (décision de l'utilisateur, 17/11/2026, maquette #bb1a) : à GAUCHE la conversation avec SON agent,
 * spécialiste de la conception de chartes (`server/src/agent-de-charte.ts`), la ligne d'étapes collée au champ ; à
 * DROITE le document dans un volet qu'on élargit en tirant sur son bord, mis à jour à chaque écriture de l'agent.
 * « Agrandir », en haut à droite du volet, pose le document entier — tous ses gestes — PAR-DESSUS la conversation, qui
 * reste montée (brouillon et voix gardés) ; le même bouton ou Échap le remet. Sur téléphone, la conversation occupe
 * l'écran et le document s'ouvre dans la feuille du bas (« Voir la charte »), d'où « Agrandir » mène au document entier.
 */
function CharteAvecSonAgent({
  id,
  titre,
  onFermer,
  onSupprime,
  onMarque,
}: {
  id: string;
  titre: string | null;
  onFermer: () => void;
  onSupprime: () => void;
  onMarque: () => void;
}) {
  const state = useApp();
  /* Conversation à gauche, volet à droite : pas de ligne de titre au-dessus (22/11/2026). */
  useSansLigneDeTitre();
  const telephone = useTelephone();
  const [placeDeLaRangee, setRangee] = usePlaceDeLaRangee();
  const { width, start, reset } = useResizable(CLE_DE_LARGEUR_DE_LA_CHARTE, bornesDuVoletDuPlan(placeDeLaRangee));
  const [agentId, setAgentId] = React.useState<string | null>(null);
  const [panne, setPanne] = React.useState<string | null>(null);
  const [voletOuvert, setVoletOuvert] = usePliDeLaCharte();
  const [agrandie, setAgrandie] = React.useState(false);
  const [feuille, setFeuille] = React.useState(false);
  const blocs = useBlocsDuDocument(id);
  /* Les deux places du menu des options d'affichage : l'entête du volet, l'entête de la feuille du téléphone. */
  const [placeDuVolet, setPlaceDuVolet] = React.useState<HTMLSpanElement | null>(null);
  const [placeDeLaFeuille, setPlaceDeLaFeuille] = React.useState<HTMLSpanElement | null>(null);

  React.useEffect(() => {
    let vivant = true;
    client.call<{ agentId: string }>({ type: 'plaquettes.ouvrirAgent', id }).then(
      (r) => vivant && setAgentId(r.agentId),
      (err: Error) => vivant && setPanne(err?.message ?? String(err)),
    );
    return () => {
      vivant = false;
    };
  }, [id]);
  React.useEffect(() => {
    if (agentId) void client.chargerAgent(agentId);
  }, [agentId]);
  const agent = agentId ? state.agents[agentId] : undefined;

  /* ÉCHAP REMET LE DOCUMENT DANS SON VOLET — sauf pendant une saisie, ou quand un menu ou une fenêtre est ouvert. */
  React.useEffect(() => {
    if (!agrandie) return;
    const touche = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const cible = e.target as HTMLElement | null;
      if (cible?.closest?.('input,textarea,select,[contenteditable="true"]')) return;
      /* Un menu, une liste ou une confirmation OUVERTS gardent leur Échap (les enveloppes vides de Radix ne comptent pas). */
      const ouverts = [...document.querySelectorAll<HTMLElement>('[data-radix-popper-content-wrapper] [data-state="open"], [role="menu"][data-state="open"], [role="alertdialog"]')];
      if (ouverts.some((n) => n.getBoundingClientRect().width > 0)) return;
      e.preventDefault();
      e.stopPropagation();
      setAgrandie(false);
    };
    window.addEventListener('keydown', touche, true);
    return () => window.removeEventListener('keydown', touche, true);
  }, [agrandie]);

  const noms: Record<EtapeDeLaCharte, string> = {
    marque: t('Marque'),
    logo: t('Logo'),
    couleurs: t('Couleurs'),
    typographies: t('Typographies'),
    composants: t('Composants'),
    ton: t('Ton et voix'),
    presentation: t('Présentation'),
  };
  const parcours = blocs ? <LigneDeParcours repere="charte" etapes={parcoursDeLaCharte(blocs).map((e) => ({ cle: e.cle, libelle: noms[e.cle], etat: e.etat }))} /> : null;
  const nom = titre ?? t('Document');
  const leDocument = (compact: boolean) => (
    <DocumentOuvert
      id={id}
      compact={compact}
      onAgrandir={(a) => (setFeuille(false), setAgrandie(a))}
      onSupprime={onSupprime}
      onMarque={onMarque}
      emplacementDuMenu={telephone ? { noeud: placeDeLaFeuille, ou: 'feuille' } : { noeud: placeDuVolet, ou: 'volet' }}
    />
  );

  return (
    <>
      {/* LE FIL D'ARIANE : « Charte graphique › <document> » ; sur téléphone, la flèche remet d'abord le document dans
          la conversation, puis remonte à la liste. */}
      <SuiteDuFil onRacine={onFermer} retour={{ action: () => (agrandie ? setAgrandie(false) : onFermer()), reperes: { 'data-plaquettes-retour': '' } }}>
        <CranDuFil data-plaquette-titre-cran="">{nom}</CranDuFil>
      </SuiteDuFil>

      {telephone && !agrandie ? (
        <OptionsDePage enMenu>
          <OptionDePage variante="ghost" icone={<PanelRight className="h-3 w-3" />} onClick={() => setFeuille(true)} data-charte-voir>
            {t('Voir la charte')}
          </OptionDePage>
          <OptionDePage variante="ghost" icone={<Maximize2 className="h-3 w-3" />} onClick={() => setAgrandie(true)} data-charte-agrandir-ligne>
            {t('Agrandir la charte')}
          </OptionDePage>
        </OptionsDePage>
      ) : null}

      <div
        ref={setRangee}
        className="relative flex min-h-0 min-w-0 flex-1"
        data-charte-rangee={id}
        data-charte-etat={agrandie ? 'agrandie' : telephone ? 'feuille' : voletOuvert ? 'volet' : 'replie'}
        data-plein-cadre
      >
        {/* LA CONVERSATION, toujours montée : cachée (pas démontée) sous le document agrandi. */}
        <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', agrandie && 'invisible')} aria-hidden={agrandie || undefined} data-charte-conversation={agent?.id ?? 'chargement'}>
          {!telephone && !voletOuvert ? (
            <div className="flex shrink-0 items-center justify-end gap-1 px-2 pt-2" data-charte-haut-du-fil>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0 text-muted"
                aria-label="Afficher la charte"
                title={t('Afficher la charte')}
                onClick={() => setVoletOuvert(true)}
                data-charte-afficher
              >
                <PanelRight className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
          {agent ? (
            <div className={cn(CLASSE_COLONNE_DU_FIL_DE_CHARTE, 'flex min-h-0 flex-1 flex-col [--fond-du-pied:transparent] [--retrait-du-fil:1rem]')}>
              <Chat agent={agent} projectId={agent.projectId} filtreDesMessages={sansLesMessagesDuDemonDeCharte} libelleDuChamp={t('Écrire à l’agent de la charte…')} parcours={parcours} />
            </div>
          ) : (
            <div className={cn(CLASSE_COLONNE_DU_FIL_DE_CHARTE, 'px-4 pt-3')}>{panne ? <p className="text-[13px] text-danger">{panne}</p> : <SilhouetteConversation bulles={2} />}</div>
          )}
        </div>

        {!telephone && voletOuvert && !agrandie ? (
          <ResizeHandle onPointerDown={(e) => start(e, 'right')} onDoubleClick={reset} className="z-30" data-document-poignee="charte-volet" />
        ) : null}

        {/* LE DOCUMENT : dans le volet, ou agrandi par-dessus la conversation — le même, jamais remonté. */}
        {(!telephone && voletOuvert) || agrandie ? (
          <aside
            className={agrandie ? 'absolute inset-0 z-[5] flex min-h-0 flex-col bg-bg' : cn('min-h-0', CLASSE_VOLET_DU_PLAN)}
            style={agrandie ? undefined : { width }}
            aria-label="Charte graphique"
            data-charte-volet={agrandie ? 'agrandi' : 'volet'}
          >
            <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', !agrandie && CLASSE_FENETRE_DU_VOLET)}>
              {!agrandie ? (
                <div className="flex shrink-0 items-center gap-1 pb-2 pl-5 pr-3 pt-3" data-charte-entete-du-volet>
                  <FileText className="h-4 w-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate pl-1 text-[14.5px] font-medium text-text">{nom}</span>
                  {/* LE MENU DES OPTIONS D'AFFICHAGE (format, PDF, lien), rendu par le document lui-même. */}
                  <span ref={setPlaceDuVolet} className="contents" data-charte-place-du-menu="volet" />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0 text-muted"
                    aria-label="Agrandir la charte"
                    title={t('Agrandir la charte')}
                    onClick={() => setAgrandie(true)}
                    data-charte-agrandir="volet"
                  >
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0 text-muted"
                    aria-label="Replier la charte"
                    title={t('Replier la charte')}
                    onClick={() => setVoletOuvert(false)}
                    data-croix-du-volet="charte"
                  >
                    <PanelRightClose className="h-4 w-4" />
                  </Button>
                </div>
              ) : null}
              {leDocument(!agrandie)}
            </div>
          </aside>
        ) : null}
      </div>

      {telephone ? (
        <Drawer feuille plein open={feuille && !agrandie} onClose={() => setFeuille(false)}>
          <EnteteDeFeuille
            titre={nom}
            gauche={<span ref={setPlaceDeLaFeuille} className="contents" data-charte-place-du-menu="feuille" />}
            droite={
              <span className="flex items-center gap-1">
                <Button size="icon" variant="ghost" className="h-[38px] w-[38px] shrink-0 text-muted" aria-label="Agrandir la charte" title={t('Agrandir la charte')} onClick={() => (setFeuille(false), setAgrandie(true))} data-charte-agrandir="feuille">
                  <Maximize2 className="h-4 w-4" />
                </Button>
              </span>
            }
            data-charte-feuille
          />
          <div className="flex min-h-0 flex-1 flex-col">{feuille && !agrandie ? leDocument(true) : null}</div>
        </Drawer>
      ) : null}
    </>
  );
}

/** La conversation se centre dans la place que le volet lui laisse (comme celle d'un client du Marketing). */
const CLASSE_COLONNE_DU_FIL_DE_CHARTE = 'mx-auto w-full max-w-[820px]';

const DELAI_D_ENREGISTREMENT_MS = 900;

/**
 * LE DOCUMENT OUVERT, au centre. La saisie vit ici (`brouillon`) ; elle s'enregistre seule peu après la dernière
 * modification. Un changement venu d'ailleurs (l'agent, un autre onglet) remplace le document tant qu'aucune saisie
 * n'attend ; les commentaires, eux, suivent toujours.
 */
function DocumentOuvert({
  id,
  onSupprime,
  onMarque,
  compact = false,
  onAgrandir,
  emplacementDuMenu,
}: {
  id: string;
  onSupprime: () => void;
  onMarque: () => void;
  /**
   * LE DOCUMENT DANS LE VOLET, À DROITE DE SON AGENT (refonte du service Charte graphique, 17/11/2026) : l'aperçu en
   * lecture et son état, sans miniatures ni gestes — « Agrandir » pose le document entier, avec tous ses gestes, par-dessus
   * la conversation. Le MÊME composant reste monté d'un état à l'autre : un seul brouillon, jamais deux.
   */
  compact?: boolean;
  /** Agrandir (vrai) ou remettre dans le volet (faux) ; absent : le document n'a pas de volet. */
  onAgrandir?: (agrandir: boolean) => void;
  /**
   * OÙ POSER LE MENU DES OPTIONS D'AFFICHAGE quand le document est compact : l'entête du volet, ou celle de la
   * feuille du téléphone, posées par la page (`CharteAvecSonAgent`). Le menu reste rendu ICI, où vivent le format,
   * le PDF et le lien — il ne fait que s'afficher là-haut.
   */
  emplacementDuMenu?: { noeud: HTMLElement | null; ou: 'volet' | 'feuille' };
}) {
  const telephone = useTelephone();
  const [fiche, setFiche] = React.useState<Fiche | null>(null);
  const [brouillon, setBrouillon] = React.useState<Brouillon | null>(null);
  const [aEnregistrer, setAEnregistrer] = React.useState(0);
  /*
   * LIRE, ÉDITER, ENREGISTRER (décision de l'utilisateur, carte « Finitions du lecteur de charte ») : la page s'ouvre en
   * LECTURE ; « Éditer » rend le document modifiable ; chaque retouche va dans un BROUILLON (enregistré seul, jamais vu
   * par le client) ; le bouton violet « Enregistrer » le publie en NOUVELLE VERSION — la page ouverte du client change
   * aussitôt. Un brouillon laissé en plan rouvre la page en édition.
   */
  const [mode, setMode] = React.useState<'lecture' | 'edition'>('lecture');
  const modeRef = React.useRef(mode);
  modeRef.current = mode;
  const [etat, setEtat] = React.useState<'pret' | 'attente' | 'enregistrement' | 'enregistre' | 'publication' | 'publie' | 'erreur'>('pret');
  const [abandonner, setAbandonner] = React.useState(false);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [occupe, setOccupe] = React.useState<string | null>(null);
  /* UN SEUL VOLET À LA FOIS par-dessus le document : la charte, les pages du client, les pages du PDF. */
  const [volet, setVolet] = React.useState<'charte' | 'client' | 'pdf' | 'commentaires' | null>(null);
  /* Le lecteur monté : la liste des commentaires du haut s'en sert pour aller à un commentaire et l'ouvrir. */
  const poignee = React.useRef<PoigneeDuLecteur | null>(null);
  const charte = volet === 'charte';
  const setCharte = (o: boolean | ((v: boolean) => boolean)) => setVolet((v) => ((typeof o === 'function' ? o(v === 'charte') : o) ? 'charte' : null));
  const [pagesDesSections, setPagesDesSections] = React.useState<string[][]>([]);
  const [copie, setCopie] = React.useState(false);
  const [voirResolus, setVoirResolus] = React.useState(false);
  const [supprimer, setSupprimer] = React.useState(false);
  const [signal, setSignal] = React.useState(0);
  const enAttente = React.useRef(false);
  enAttente.current = etat === 'attente' || etat === 'enregistrement' || etat === 'publication';
  const premiere = React.useRef(true);

  const appliquer = React.useCallback((f: Fiche, remplacer: boolean) => {
    setFiche(f);
    /* Au premier chargement, un brouillon laissé en plan rouvre l'édition. */
    if (premiere.current) {
      premiere.current = false;
      if (f.brouillon) setMode('edition');
    }
    if (!remplacer) return;
    /* Le document montré : le brouillon tant qu'il existe (édition), sinon la version publiée (lecture). */
    const source = f.brouillon ?? f.plaquette;
    const neuf: Brouillon = { titre: source.titre, blocs: source.blocs, marque: source.marque, format: source.format, adresse: source.adresse ?? 'vous' };
    /* Un commentaire qui arrive relit la fiche : le document ne se redessine que s'il a VRAIMENT changé (une discussion en cours reste ouverte). */
    setBrouillon((b) => (b && JSON.stringify(b) === JSON.stringify(neuf) ? b : neuf));
  }, []);

  React.useEffect(() => client.onPlaquettes((e) => e.plaquetteId === id && setSignal((n) => n + 1)), [id]);
  React.useEffect(() => {
    let vivant = true;
    client
      .call<Fiche>({ type: 'plaquettes.fiche', id })
      .then((f) => vivant && appliquer(f, !enAttente.current))
      .catch((e: Error) => vivant && setErreur(e.message));
    return () => {
      vivant = false;
    };
  }, [id, signal, appliquer]);

  /* LE BROUILLON S'ENREGISTRE SEUL, peu après la dernière modification ; une retouche faite en lecture ouvre l'édition. */
  const changer = (patch: Partial<Brouillon>) => {
    setMode('edition');
    setBrouillon((b) => (b ? { ...b, ...patch } : b));
    setEtat('attente');
    setAEnregistrer((n) => n + 1);
  };
  const brouillonRef = React.useRef(brouillon);
  brouillonRef.current = brouillon;
  const contenu = (b: Brouillon) => ({
    titre: b.titre,
    format: b.format,
    adresse: b.adresse,
    blocs: b.blocs as unknown as Record<string, unknown>[],
    marque: b.marque as unknown as Record<string, unknown>,
  });
  const minuterie = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    if (!aEnregistrer) return;
    minuterie.current = setTimeout(() => {
      minuterie.current = null;
      const b = brouillonRef.current;
      if (!b) return;
      setEtat('enregistrement');
      client
        .call<Fiche>({ type: 'plaquettes.brouillon', id, ...contenu(b) })
        .then((f) => {
          setFiche(f);
          setErreur(null);
          setEtat((e) => (e === 'enregistrement' ? 'enregistre' : e));
        })
        .catch((e: Error) => {
          setErreur(e.message);
          setEtat('erreur');
        });
    }, DELAI_D_ENREGISTREMENT_MS);
    return () => {
      if (minuterie.current) clearTimeout(minuterie.current);
      minuterie.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aEnregistrer, id]);
  /* UNE FRAPPE EN ATTENTE PART AVEC LE DÉMONTAGE (la feuille du téléphone qui se ferme) : rien ne se perd. */
  React.useEffect(
    () => () => {
      if (!minuterie.current || !brouillonRef.current) return;
      clearTimeout(minuterie.current);
      minuterie.current = null;
      void client.call({ type: 'plaquettes.brouillon', id, ...contenu(brouillonRef.current) }).catch(() => undefined);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id],
  );
  /* « ENREGISTRER » : le brouillon (et la dernière frappe) devient la nouvelle version, que le client voit aussitôt. */
  const enregistrer = () => {
    const b = brouillonRef.current;
    if (!b) return;
    if (minuterie.current) clearTimeout(minuterie.current);
    minuterie.current = null;
    setEtat('publication');
    client
      .call<Fiche>({ type: 'plaquettes.publier', id, ...contenu(b) })
      .then((f) => {
        setErreur(null);
        setMode('lecture');
        setEtat('publie');
        appliquer(f, true);
      })
      .catch((e: Error) => {
        setErreur(e.message);
        setEtat('erreur');
      });
  };
  /* « ABANDONNER » : les retouches disparaissent, le document revient à la version que voit le client. */
  const abandonnerLeBrouillon = () => {
    if (minuterie.current) clearTimeout(minuterie.current);
    minuterie.current = null;
    void agir('abandonner', async () => {
      const f = await client.call<Fiche>({ type: 'plaquettes.abandonner', id });
      setMode('lecture');
      setEtat('pret');
      appliquer(f, true);
    });
  };

  /* LE VOLET DE LA CHARTE SE FERME AU CLIC DEHORS — sauf dans ses propres menus (couleur, police), posés ailleurs. */
  const voletCharte = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    if (volet !== 'charte' || telephone) return;
    const dehors = (e: PointerEvent) => {
      const cible = e.target as Element | null;
      const volet = voletCharte.current;
      if (!cible || !volet || volet.contains(cible)) return;
      if (cible.closest('[data-radix-popper-content-wrapper],[role="menu"],[role="listbox"],[data-plaquette-charte-bouton]')) return;
      /* Une fenêtre posée PAR-DESSUS (une confirmation) garde le volet ; la page elle-même, qui l'enveloppe, non. */
      const fenetre = cible.closest('[role="dialog"]');
      if (fenetre && !fenetre.contains(volet)) return;
      setVolet(null);
    };
    document.addEventListener('pointerdown', dehors, true);
    return () => document.removeEventListener('pointerdown', dehors, true);
  }, [volet, telephone]);

  const agir = async (quoi: string, geste: () => Promise<void>) => {
    setOccupe(quoi);
    setErreur(null);
    try {
      await geste();
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setOccupe(null);
    }
  };
  /* « TÉLÉCHARGER » : le PDF de la version courante (ses pages à lui), enregistré sur l'appareil. */
  const telechargerLePdf = () =>
    agir('telecharger', async () => {
      const r = await client.call<{ piece: { id: string; name: string } }>({ type: 'plaquettes.pdf', id });
      const a = document.createElement('a');
      a.href = adresseDePiece(r.piece.id, true);
      a.download = r.piece.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  const ouvrirLePdf = () =>
    agir('pdf', async () => {
      const r = await client.call<{ piece: { id: string; name: string } }>({ type: 'plaquettes.pdf', id });
      ouvrirUnMedia({ adresse: adresseDePiece(r.piece.id), piece: r.piece.id, genre: 'pdf', nom: r.piece.name });
    });
  const copierLeLien = () =>
    agir('copier', async () => {
      if (!fiche) return;
      await navigator.clipboard.writeText(fiche.lien);
      setCopie(true);
      setTimeout(() => setCopie(false), 1800);
    });
  const lien = (geste: 'couper' | 'rouvrir' | 'nouveau') =>
    agir(geste, async () => {
      const f = await client.call<Fiche>({ type: 'plaquettes.lien', id, geste });
      if (f) appliquer(f, false);
    });

  if (!fiche || !brouillon) {
    return (
      <div className="flex min-h-0 flex-1 flex-col pt-4">
        {erreur ? <p className="text-[14px] text-danger">{erreur}</p> : <SilhouetteTachesRecurrentes />}
      </div>
    );
  }
  const p = fiche.plaquette;
  const ouverts = fiche.fils.filter((f) => !f.resolu).length;
  /* LA PASTILLE DES COMMENTAIRES : les discussions ouvertes qui ont au moins un message non lu (celui du client). */
  const nonLus = fiche.fils.filter((f) => !f.resolu && f.messages.some((m) => m.role === 'client' && !m.lu && !m.supprime)).length;
  const allerAuFil = (filId: string) => {
    setVolet(null);
    /* La fenêtre (ou la feuille du bas) se referme d'abord : le défilement part sur la page entière. */
    requestAnimationFrame(() => poignee.current?.allerAuFil(filId));
  };
  const commentaires = (
    <ListeDesCommentaires fils={fiche.fils} voirResolus={voirResolus} pages={pagesDesSections} onChoisir={allerAuFil} />
  );
  const edition = mode === 'edition';
  const aUnBrouillon = !!fiche.brouillon || etat === 'attente' || etat === 'enregistrement';
  /* L'agent a publié une version pendant que l'équipe retouchait : l'enregistrement la remplacera. */
  const depasse = !!fiche.brouillon && fiche.brouillon.base < p.version;
  const libelleEtat =
    etat === 'attente' || etat === 'enregistrement'
      ? t('Enregistrement du brouillon…')
      : etat === 'publication'
        ? t('Enregistrement…')
        : etat === 'erreur'
          ? (erreur ?? t('L’enregistrement a échoué'))
          : etat === 'publie'
            ? t('Version {n} enregistrée — votre client la voit déjà', { n: p.version })
            : edition && depasse
              ? t('Une version plus récente a été publiée depuis votre brouillon : l’enregistrer la remplacera.')
              : edition && aUnBrouillon
                ? t('Brouillon enregistré — votre client voit encore la version {n}', { n: p.version })
                : edition
                  ? t('Édition — cliquez un texte pour le corriger')
                  : ouverts
                    ? t('Version {n} · {c} commentaire(s) ouvert(s)', { n: p.version, c: ouverts })
                    : t('Version {n} — c’est celle que voit votre client', { n: p.version });

  const menuDAffichage = (ou: 'volet' | 'agrandi' | 'feuille', onPages?: (sortie: 'pdf' | 'client') => void) => (
    <MenuDAffichage
      emplacement={ou}
      format={brouillon.format}
      onFormat={(f) => changer({ format: f })}
      occupe={occupe === 'telecharger'}
      onTelecharger={() => void telechargerLePdf()}
      lienActif={p.lienActif}
      copie={copie}
      onCopier={() => void copierLeLien()}
      onPages={onPages}
    />
  );

  return (
    <>
      {/* LE FIL D'ARIANE (« Charte graphique › <document> ») est posé par la page de la charte (`CharteAvecSonAgent`). */}
      {compact && emplacementDuMenu?.noeud ? createPortal(menuDAffichage(emplacementDuMenu.ou), emplacementDuMenu.noeud) : null}

      {/*
        LE HAUT DE LA PAGE, EN ICÔNES (décision de l'utilisateur) : les COMMENTAIRES (pastille des non lus, liste façon
        notifications), TÉLÉCHARGER (son chevron : les pages du PDF) et le LIEN du client (son chevron : les pages qu'il
        voit). Sur téléphone, ce sont des lignes du menu à trois points.
      */}
      {telephone || compact ? null : <GestesDePage>
        {/* UNE SEULE RANGÉE EN HAUT (15/11/2026, capture #bdba) : en édition, « Annuler » et le violet « Enregistrer »
            ouvrent la rangée ; puis les commentaires, le CHOIX DE DISPOSITION (portrait, paysage, diapositives),
            « Télécharger » et le lien du client — tous à la hauteur commune des contrôles. */}
        {edition ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              className={cn(HAUTEUR_DE_CONTROLE, 'shrink-0 text-muted')}
              disabled={etat === 'publication' || occupe === 'abandonner'}
              onClick={() => (aUnBrouillon ? setAbandonner(true) : setMode('lecture'))}
              title={aUnBrouillon ? t('Annuler les retouches') : t('Revenir à la lecture')}
              data-plaquette-abandonner
              data-plaquette-annuler
            >
              <Undo2 className="h-3.5 w-3.5" />
              {t('Annuler')}
            </Button>
            <Button
              size="sm"
              className={cn(HAUTEUR_DE_CONTROLE, 'shrink-0')}
              data-bouton-violet
              disabled={etat === 'publication'}
              onClick={() => (aUnBrouillon ? enregistrer() : setMode('lecture'))}
              data-plaquette-enregistrer
            >
              {etat === 'publication' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {t('Enregistrer')}
            </Button>
          </>
        ) : null}
        <PopoverPrimitive.Root open={volet === 'commentaires'} onOpenChange={(o) => setVolet(o ? 'commentaires' : null)}>
          <PopoverPrimitive.Trigger asChild>
            <Button
              size="icon-barre"
              variant="ghost"
              className={cn('relative shrink-0 text-muted', volet === 'commentaires' && 'text-text')}
              aria-label="Commentaires"
              title={nonLus ? t('{n} discussion(s) avec du nouveau', { n: nonLus }) : t('Commentaires')}
              data-plaquette-commentaires-bouton
              data-plaquette-commentaires-non-lus={nonLus}
            >
              <MessageSquare className={cn('h-4 w-4', nonLus > 0 && 'text-text')} />
              <Pastille nombre={nonLus} ton="repondre" position="coin" data-plaquette-commentaires-pastille="" />
            </Button>
          </PopoverPrimitive.Trigger>
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
              side="bottom"
              align="end"
              sideOffset={6}
              collisionPadding={12}
              onOpenAutoFocus={(e) => e.preventDefault()}
              className="z-[60] flex w-[min(380px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl border border-border bg-bg shadow-xl data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out"
              style={{ maxHeight: 'min(520px, calc(var(--radix-popover-content-available-height) - 12px))' }}
              aria-label="Commentaires"
              data-plaquette-commentaires
            >
              <div className="flex shrink-0 items-center gap-2 px-4 pb-1 pt-3">
                <h3 className="flex-1 text-[14px] font-semibold text-text">{t('Commentaires')}</h3>
              </div>
              <ZoneDefilement className="min-h-0 px-2 pb-2">{commentaires}</ZoneDefilement>
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
        {/* LES OPTIONS D'AFFICHAGE EN UN MENU (18/11/2026) : format, PDF et lien du client — le même que dans le volet.
            Les fenêtres du choix des pages s'ancrent sur son bouton. */}
        <MenuDesPages
          ouvert={volet === 'pdf'}
          onOuvert={(o) => setVolet(o ? 'pdf' : null)}
          sortie="pdf"
          contenu={<ChoixDesPages sortie="pdf" blocs={brouillon.blocs} pages={pagesDesSections} onChange={(blocs) => changer({ blocs })} />}
        >
          <span className="inline-flex shrink-0" data-plaquette-groupe-pdf>
            <MenuDesPages
              ouvert={volet === 'client'}
              onOuvert={(o) => setVolet(o ? 'client' : null)}
              sortie="client"
              contenu={<ChoixDesPages sortie="client" blocs={brouillon.blocs} pages={pagesDesSections} onChange={(blocs) => changer({ blocs })} />}
            >
              <span className="inline-flex shrink-0" data-plaquette-groupe-lien>
                {menuDAffichage('agrandi', (sortie) => requestAnimationFrame(() => setVolet(sortie)))}
              </span>
            </MenuDesPages>
          </span>
        </MenuDesPages>
        {/* LE MÊME BOUTON REMET LE DOCUMENT DANS SON VOLET, à droite de la conversation (Échap aussi). */}
        {onAgrandir ? (
          <Button
            size="icon-barre"
            variant="ghost"
            className="shrink-0 text-muted"
            onClick={() => onAgrandir(false)}
            aria-label="Remettre dans le volet"
            title={t('Remettre dans le volet')}
            data-charte-agrandir="agrandie"
          >
            <Minimize2 className="h-4 w-4" />
          </Button>
        ) : null}
      </GestesDePage>}

      {/* LES GESTES SECONDAIRES, derrière les trois points — le document agrandi seulement : le volet n'a que l'aperçu. */}
      {compact ? null : <OptionsDePage enMenu enCours={occupe === 'pdf' || occupe === 'nouveau' || occupe === 'couper' || occupe === 'rouvrir'}>
        {/* SUR TÉLÉPHONE, la barre du haut n'a pas la place de l'icône : la copie du lien est la première ligne du menu. */}
        {telephone ? (
          <>
            {/* Le document agrandi par-dessus sa conversation : la première ligne y ramène. */}
            {onAgrandir ? (
              <OptionDePage variante="ghost" icone={<Minimize2 className="h-3 w-3" />} onClick={() => onAgrandir(false)} data-charte-agrandir="agrandie-ligne">
                {t('Revenir à la conversation')}
              </OptionDePage>
            ) : null}
            <OptionDePage variante="ghost" icone={<Link2 className="h-3 w-3" />} onClick={() => void copierLeLien()} disabled={!p.lienActif || occupe !== null} data-plaquette-copier-ligne>
              {copie ? t('Lien copié') : t('Copier le lien du client')}
            </OptionDePage>
            <OptionDePage variante="ghost" icone={<ListChecks className="h-3 w-3" />} onClick={() => setVolet('client')} data-plaquette-pages-client-ligne>
              {t('Pages montrées au client')}
            </OptionDePage>
            <OptionDePage
              variante="ghost"
              icone={<MessageSquare className="h-3 w-3" />}
              onClick={() => setVolet('commentaires')}
              detail={nonLus ? t('{n} discussion(s) avec du nouveau', { n: nonLus }) : null}
              data-plaquette-commentaires-ligne
              data-plaquette-commentaires-non-lus={nonLus}
            >
              {t('Commentaires')}
            </OptionDePage>
            <OptionDePage variante="ghost" icone={<Download className="h-3 w-3" />} onClick={() => void telechargerLePdf()} disabled={occupe !== null} data-plaquette-telecharger-ligne>
              {occupe === 'telecharger' ? t('Fabrication du PDF…') : t('Télécharger le PDF')}
            </OptionDePage>
            <OptionDePage variante="ghost" icone={<ListChecks className="h-3 w-3" />} onClick={() => setVolet('pdf')} data-plaquette-pages-pdf-ligne>
              {t('Pages du PDF')}
            </OptionDePage>
          </>
        ) : null}
        <OptionDePage variante="ghost" icone={<FileText className="h-3 w-3" />} onClick={() => void ouvrirLePdf()} disabled={occupe !== null} data-plaquette-pdf>
          {occupe === 'pdf' ? t('Fabrication du PDF…') : t('Ouvrir le PDF')}
        </OptionDePage>
        <OptionDePage
          variante="ghost"
          icone={p.lienActif ? <Link2Off className="h-3 w-3" /> : <Link2 className="h-3 w-3" />}
          onClick={() => void lien(p.lienActif ? 'couper' : 'rouvrir')}
          disabled={occupe !== null}
          detail={p.lienActif ? t('Votre client ne pourra plus ouvrir le document.') : null}
          data-plaquette-couper={p.lienActif ? 'couper' : 'rouvrir'}
        >
          {p.lienActif ? t('Couper le lien') : t('Rouvrir le lien')}
        </OptionDePage>
        <OptionDePage
          variante="ghost"
          icone={<RefreshCw className="h-3 w-3" />}
          onClick={() => void lien('nouveau')}
          disabled={occupe !== null}
          detail={t('L’ancien lien ne mène plus nulle part.')}
          data-plaquette-nouveau-lien
        >
          {t('Nouveau lien')}
        </OptionDePage>
        <OptionDePage variante="ghost" icone={<Eye className="h-3 w-3" />} onClick={() => setVoirResolus((v) => !v)} data-plaquette-voir-resolus={voirResolus ? 'oui' : 'non'}>
          {voirResolus ? t('Cacher les commentaires résolus') : t('Afficher les commentaires résolus')}
        </OptionDePage>
        <OptionDePage variante="ghost" icone={<Stamp className="h-3 w-3" />} onClick={onMarque} data-plaquettes-marque>
          {t('Signature des documents')}
        </OptionDePage>
        <OptionDePage variante="ghost" icone={<Trash2 className="h-3 w-3" />} onClick={() => setSupprimer(true)} className="text-danger" data-plaquette-supprimer>
          {t('Supprimer le document')}
        </OptionDePage>
      </OptionsDePage>}

      {/* L'APERÇU EST FONCÉ DANS LES DOUZE PALETTES (décision de l'utilisateur) et prend TOUTE LA SURFACE de la zone
          (14/11/2026, capture #7e698) : `data-pleine-surface` fait lâcher à la page sa colonne centrée et ses marges, et
          fonce la bande des icônes du haut (styles.css). La liste des documents, elle, garde sa colonne. */}
      <div
        className={cn('apercu-sombre relative flex min-h-0 flex-1 flex-col pt-3', compact ? 'px-3' : 'px-4 sm:px-8')}
        data-plaquette-editeur={p.id}
        data-plaquette-tiroir={p.id}
        data-plaquette-apercu-sombre
        data-plaquette-compact={compact ? '' : undefined}
        {...(compact ? {} : { 'data-pleine-surface': '' })}
      >
        {/*
          LA RANGÉE DU DOCUMENT (décision de l'utilisateur) : l'état à gauche ; puis, en édition, « Annuler » et le
          violet « Enregistrer » À GAUCHE DES ONGLETS DE FORMAT, posés tout à droite. En lecture, « Éditer » est une
          icône au coin de la feuille survolée (sur téléphone, sans survol, une icône ici).
        */}
        {/* SUR ORDINATEUR, L'ÉTAT SEUL, À LA HAUTEUR DES GESTES DU COIN (15/11/2026) : la rangée vide au-dessus a
            disparu (styles.css, `data-pleine-surface`), l'état se lit à gauche des gestes et les pages remontent. */}
        <div className={cn('flex min-w-0 shrink-0 items-center gap-2 pb-2 sm:gap-3', !telephone && !compact && cn(HAUTEUR_DE_CONTROLE, 'box-content sm:pr-[460px]'))}>
          <span
            className={cn('min-w-0 flex-1 truncate text-[12.5px]', !compact && 'max-sm:sr-only', etat === 'erreur' ? 'text-danger' : 'text-muted')}
            role="status"
            data-plaquette-message
            data-plaquette-etat={etat}
          >
            {etat === 'attente' || etat === 'enregistrement' ? <Loader2 className="mr-1.5 inline h-3 w-3 animate-spin align-[-2px]" /> : null}
            {libelleEtat}
          </span>
          {compact ? null : edition && telephone ? (
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0 text-muted"
                disabled={etat === 'publication' || occupe === 'abandonner'}
                onClick={() => (aUnBrouillon ? setAbandonner(true) : setMode('lecture'))}
                title={aUnBrouillon ? t('Annuler les retouches') : t('Revenir à la lecture')}
                data-plaquette-abandonner
                data-plaquette-annuler
              >
                <Undo2 className="h-3.5 w-3.5" />
                <span className="max-sm:sr-only">{t('Annuler')}</span>
              </Button>
              <Button
                size="sm"
                className="shrink-0"
                data-bouton-violet
                disabled={etat === 'publication'}
                onClick={() => (aUnBrouillon ? enregistrer() : setMode('lecture'))}
                data-plaquette-enregistrer
              >
                {etat === 'publication' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                <span className="max-sm:sr-only">{t('Enregistrer')}</span>
              </Button>
            </div>
          ) : telephone ? (
            <Button size="icon-barre" variant="ghost" className="ml-auto shrink-0 bg-raised text-text hover:bg-fond-survol" onClick={() => setMode('edition')} aria-label="Éditer" title={t('Éditer')} data-plaquette-editer>
              <Pencil className="h-4 w-4" />
            </Button>
          ) : null}
          {/* SUR TÉLÉPHONE, le menu des options d'affichage dans la rangée : les trois onglets ne tiennent pas sur 390 px. */}
          {telephone && !compact ? (
            <div className="min-w-0 shrink">{menuDAffichage('agrandi')}</div>
          ) : null}
        </div>

        {/* LE DOCUMENT EN PLEIN VOLET (décision de l'utilisateur) : aucun cadre arrondi ni fond gris, les miniatures à sa gauche. */}
        <div className="relative flex min-h-0 flex-1 overflow-hidden" data-plaquette-apercu-zone>
          <DocumentModifiable
            brouillon={brouillon}
            langue={p.langue}
            fils={fiche.fils}
            plaquetteId={p.id}
            projectId={p.projectId}
            lecture={!edition || compact}
            voirResolus={voirResolus}
            pieces={fiche.pieces}
            onBlocs={(blocs) => changer({ blocs })}
            onPages={setPagesDesSections}
            /* Dans le volet, « Éditer » pose d'abord le document en grand : la retouche a besoin de ses gestes. */
            onEditer={() => {
              if (compact) onAgrandir?.(true);
              setMode('edition');
            }}
            poignee={poignee}
            sansMiniatures={compact}
          />

          {/* LE BOUTON « CHARTE GRAPHIQUE », FIXÉ EN BAS DU DOCUMENT (le document en grand seulement). */}
          {compact ? null : <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
            <Button
              className="pointer-events-auto bg-bg text-text shadow-lg hover:bg-bg hover:text-text"
              variant="ghost"
              onClick={() => setCharte((o) => !o)}
              aria-expanded={charte}
              data-plaquette-charte-bouton={charte ? 'ouverte' : 'fermee'}
            >
              <Palette className="h-4 w-4" />
              {t('Charte graphique')}
            </Button>
          </div>}

          {/* LA CHARTE, DANS UN VOLET PAR-DESSUS LE DOCUMENT (sur ordinateur). */}
          {charte && !telephone && !compact ? (
            <aside
              ref={voletCharte}
              className="absolute bottom-3 right-3 top-3 z-20 flex w-[min(360px,calc(100%-24px))] flex-col overflow-hidden rounded-xl bg-bg shadow-2xl"
              aria-label="Charte graphique"
              data-plaquette-charte
            >
              <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-3">
                <h3 className="flex-1 text-[14px] font-semibold text-text">{t('Charte graphique')}</h3>
                <Button size="icon-sm" variant="ghost" onClick={() => setCharte(false)} aria-label="Fermer" title={t('Fermer')} data-plaquette-charte-fermer>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <ZoneDefilement className="min-h-0 flex-1 px-4 pb-4">
                <CharteDuDocument brouillon={brouillon} projetMarqueNom={fiche.projetMarqueNom} onChange={changer} />
              </ZoneDefilement>
            </aside>
          ) : null}

        </div>
      </div>

      {telephone && !compact ? (
        <Drawer feuille open={charte} onClose={() => setCharte(false)}>
          <EnteteDeFeuille titre={t('Charte graphique')} droite={null} />
          <ZoneDefilement className="min-h-0 px-4 pb-6">
            <div data-plaquette-charte>
              <CharteDuDocument brouillon={brouillon} projetMarqueNom={fiche.projetMarqueNom} onChange={changer} />
            </div>
          </ZoneDefilement>
        </Drawer>
      ) : null}
      {telephone && !compact ? (
        <Drawer feuille open={volet === 'commentaires'} onClose={() => setVolet(null)}>
          <EnteteDeFeuille titre={t('Commentaires')} droite={null} />
          <ZoneDefilement className="min-h-0 px-2 pb-6">
            <div data-plaquette-commentaires>{commentaires}</div>
          </ZoneDefilement>
        </Drawer>
      ) : null}
      {telephone && !compact ? (
        <Drawer feuille open={volet === 'client' || volet === 'pdf'} onClose={() => setVolet(null)}>
          <EnteteDeFeuille titre={volet === 'pdf' ? t('Pages du PDF') : t('Pages montrées au client')} droite={null} />
          <ZoneDefilement className="min-h-0 px-4 pb-6">
            <div data-plaquette-volet-pages={volet ?? ''}>
              <ChoixDesPages sortie={volet === 'pdf' ? 'pdf' : 'client'} blocs={brouillon.blocs} pages={pagesDesSections} onChange={(blocs) => changer({ blocs })} />
            </div>
          </ZoneDefilement>
        </Drawer>
      ) : null}

      <ConfirmDialog
        open={abandonner}
        title={t('Annuler les retouches ?')}
        description={t('Le document revient à la version que voit votre client. Les retouches faites depuis disparaissent.')}
        confirmLabel={t('Annuler les retouches')}
        danger
        onConfirm={() => {
          setAbandonner(false);
          abandonnerLeBrouillon();
        }}
        onClose={() => setAbandonner(false)}
      />
      <ConfirmDialog
        open={supprimer}
        title={t('Supprimer ce document ?')}
        description={t('Le document, son lien et ses commentaires disparaissent. Les PDF déjà fabriqués restent dans les Fichiers.')}
        confirmLabel={t('Supprimer')}
        danger
        onConfirm={() => {
          setSupprimer(false);
          void agir('supprimer', async () => {
            await client.call({ type: 'plaquettes.supprimer', id });
            onSupprime();
          });
        }}
        onClose={() => setSupprimer(false)}
      />
    </>
  );
}

const quandDuCommentaire = (ms: number) => {
  const d = new Date(ms);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString(formatRegional(), { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(formatRegional(), { day: 'numeric', month: 'short' });
};

/**
 * LA LISTE DES COMMENTAIRES DU HAUT DE LA PAGE (décision de l'utilisateur : « comme des notifications ») : une ligne par
 * discussion ouverte, la plus récente en tête — l'initiale et le nom de qui a écrit en dernier, l'extrait, la page, la
 * date ; une discussion qui a du nouveau du client est en gras. Les résolues seulement si on les affiche. Un clic fait
 * défiler le document jusqu'à la bulle et ouvre la discussion.
 */
function ListeDesCommentaires({
  fils,
  voirResolus,
  pages,
  onChoisir,
}: {
  fils: FilDeCommentaires[];
  voirResolus: boolean;
  pages: string[][];
  onChoisir: (id: string) => void;
}) {
  const lignes = fils
    .filter((f) => voirResolus || !f.resolu)
    .map((f) => {
      const vivants = f.messages.filter((m) => !m.supprime);
      const dernier = vivants[vivants.length - 1] ?? f.messages[f.messages.length - 1];
      const auteur = (dernier?.auteur || (dernier?.role === 'equipe' ? t('L’équipe') : t('Votre client'))).trim();
      return {
        fil: f,
        auteur,
        extrait: dernier ? (dernier.supprime ? t('Message supprimé') : dernier.texte) : '',
        quand: dernier?.creeLe ?? f.modifieLe,
        page: ancrerUnFil(f, pages).page,
        nonLu: !f.resolu && f.messages.some((m) => m.role === 'client' && !m.lu && !m.supprime),
      };
    })
    .sort((a, b) => b.quand - a.quand);
  if (!lignes.length) {
    return (
      <p className="px-2 py-3 text-[13px] text-muted" data-plaquette-commentaires-vide>
        {t('Aucune discussion ouverte sur ce document.')}
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-0.5" data-plaquette-commentaires-liste>
      {lignes.map((l) => (
        <li key={l.fil.id}>
          <div
            role="button"
            tabIndex={0}
            onClick={() => onChoisir(l.fil.id)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              onChoisir(l.fil.id);
            }}
            className="flex min-w-0 cursor-pointer gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-text/30"
            data-plaquette-commentaire-ligne={l.fil.id}
            data-plaquette-commentaire-non-lu={l.nonLu ? 'oui' : 'non'}
          >
            <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-raised text-[12px] font-semibold text-text">
              {l.auteur.charAt(0).toUpperCase() || '?'}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className={cn('min-w-0 flex-1 truncate text-[13px]', l.nonLu ? 'font-semibold text-text' : 'font-medium text-text')}>{l.auteur}</span>
                <span className="shrink-0 text-[11.5px] text-faint">{quandDuCommentaire(l.quand)}</span>
              </span>
              <span className={cn('line-clamp-2 break-words text-[12.5px] leading-snug', l.nonLu ? 'font-medium text-text' : 'text-muted')}>{l.extrait}</span>
              <span className="truncate text-[11.5px] text-faint">
                {[`${t('Page')} ${l.page}`, l.fil.resolu ? t('Résolu') : null].filter(Boolean).join(' · ')}
              </span>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Le nom montré d'une section sans titre : son genre. */
function nomDuGenre(genre: BlocDePlaquette['genre']): string {
  const noms: Record<string, string> = {
    couverture: t('Couverture'),
    sommaire: t('Sommaire'),
    partie: t('Partie'),
    texte: t('Texte'),
    image: t('Image'),
    galerie: t('Galerie'),
    chiffres: t('Chiffres clés'),
    logo: t('Logo'),
    couleurs: t('Couleurs'),
    typographies: t('Typographies'),
    ressources: t('Ressources'),
    appel: t('Appel à l’action'),
    annexes: t('Annexes'),
  };
  return noms[genre] ?? genre;
}

/**
 * LE MENU DES PAGES (demande de l'utilisateur, capture #9fd4) : ACCROCHÉ sous le chevron de son bouton groupé, aligné
 * sur son bord droit, aussi haut que sa liste — il ne défile que s'il dépasse l'écran — et il se ferme au clic dehors.
 * Une case cochée ne le referme pas (fenêtre ancrée, pas un menu d'actions). Sur téléphone : la feuille du bas.
 */
/* LES FORMATS EN ICÔNES (décision de l'utilisateur) : la forme de la page dit le format, son nom passe en infobulle. */
/**
 * LES OPTIONS D'AFFICHAGE DE LA CHARTE, EN UN SEUL MENU (18/11/2026, capture #ba07 : « les options d'affichage dans
 * la partie haute du volet de droite, dans un dropdown »). Le bouton montre le format en cours ; le menu propose les
 * trois formats, puis « Télécharger le PDF » et « Copier le lien du client » — et, là où leurs fenêtres existent,
 * le choix des pages de chaque sortie. LE MÊME MENU sert dans l'entête du volet, dans le document agrandi et dans la
 * feuille du téléphone : les repères des anciens boutons (`data-plaquette-choix-format`, `data-plaquette-telecharger`,
 * `data-plaquette-copier`) vivent sur ses lignes.
 */
function MenuDAffichage({
  format,
  onFormat,
  occupe,
  onTelecharger,
  lienActif,
  copie,
  onCopier,
  onPages,
  emplacement,
}: {
  format: FormatDePlaquette;
  onFormat: (f: FormatDePlaquette) => void;
  occupe: boolean;
  onTelecharger: () => void;
  lienActif: boolean;
  copie: boolean;
  onCopier: () => void;
  /** Ouvre le choix des pages d'une sortie — absent là où ce choix n'a pas de fenêtre. */
  onPages?: (sortie: 'pdf' | 'client') => void;
  /** Où le menu se pose — pour la hauteur de son bouton. */
  emplacement: 'volet' | 'agrandi' | 'feuille';
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        {/* DANS LA FEUILLE DU TÉLÉPHONE, une icône carrée : l'entête centre son titre entre deux côtés étroits. */}
        <Button
          size={emplacement === 'feuille' ? 'icon' : 'sm'}
          variant="ghost"
          className={cn(
            'shrink-0 text-muted hover:text-text data-[state=open]:bg-raised data-[state=open]:text-text',
            emplacement === 'feuille' ? 'h-[38px] w-[38px]' : cn('gap-1.5 px-2', emplacement === 'agrandi' ? HAUTEUR_DE_CONTROLE : 'h-8'),
          )}
          aria-label={`${t('Options d’affichage')} — ${libelleDuFormat(format)}`}
          title={t('Options d’affichage')}
          data-plaquette-options-affichage={emplacement}
          data-plaquette-format={format}
        >
          {occupe ? <Loader2 className="h-4 w-4 animate-spin" /> : <IconeDuFormat format={format} />}
          {emplacement === 'feuille' ? null : (
            <>
              <span className="max-w-[120px] truncate text-[13px]">{libelleDuFormat(format)}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" titre={t('Options d’affichage')} data-plaquette-menu-affichage="">
        <DropdownMenuLabel>{t('Format')}</DropdownMenuLabel>
        {FORMATS_DE_PLAQUETTE.map((f) => (
          <DropdownMenuItem key={f} onSelect={() => onFormat(f)} data-plaquette-choix-format={f} data-state={f === format ? 'on' : 'off'}>
            <IconeDuFormat format={f} />
            <span className="min-w-0 flex-1 truncate">{libelleDuFormat(f)}</span>
            {f === format ? <Check className="h-4 w-4 shrink-0 text-teinte" /> : <span className="h-4 w-4 shrink-0" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={occupe} onSelect={onTelecharger} data-plaquette-telecharger>
          <Download className="h-4 w-4" />
          {occupe ? t('Fabrication du PDF…') : t('Télécharger le PDF')}
        </DropdownMenuItem>
        {onPages ? (
          <DropdownMenuItem onSelect={() => onPages('pdf')} data-plaquette-pages-pdf-bouton>
            <ListChecks className="h-4 w-4" />
            {t('Pages du PDF')}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem disabled={!lienActif} onSelect={onCopier} data-plaquette-copier={copie ? 'copie' : ''}>
          {copie ? <Check className="h-4 w-4" /> : lienActif ? <Link2 className="h-4 w-4" /> : <Link2Off className="h-4 w-4" />}
          {!lienActif ? t('Lien coupé : rouvrez-le depuis le menu') : copie ? t('Lien copié') : t('Copier le lien du client')}
        </DropdownMenuItem>
        {onPages ? (
          <DropdownMenuItem onSelect={() => onPages('client')} data-plaquette-pages-client-bouton>
            <ListChecks className="h-4 w-4" />
            {t('Pages montrées au client')}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function IconeDuFormat({ format }: { format: FormatDePlaquette }) {
  const Icone = format === 'a4-paysage' ? RectangleHorizontal : format === 'diapositives' ? Presentation : RectangleVertical;
  return <Icone className="h-4 w-4" aria-hidden />;
}

/* LE BOUTON GROUPÉ DE LA BARRE DU HAUT (MEM-6843) : mêmes règles que `BoutonGroupe` — segments du même fond, jour de
   2 px, arrondis aux deux bouts seulement —, mais sur un `span` que l'ancre du menu des pages peut tenir par sa
   référence. */
const CLASSE_GROUPE_DE_LA_BARRE =
  /* 1 PX ENTRE LE BOUTON ET SON CHEVRON, PAS PLUS (15/11/2026, capture #bdba) : les deux se lisent comme un seul bouton. */
  'inline-flex shrink-0 items-stretch gap-px [&>*]:!rounded-none [&>*:first-child]:!rounded-l-lg [&>*:last-child]:!rounded-r-lg';

function MenuDesPages({
  ouvert,
  onOuvert,
  sortie,
  contenu,
  children,
}: {
  ouvert: boolean;
  onOuvert: (o: boolean) => void;
  sortie: 'client' | 'pdf';
  contenu: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <PopoverPrimitive.Root open={ouvert} onOpenChange={onOuvert}>
      <PopoverPrimitive.Anchor asChild>{children}</PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom"
          align="end"
          sideOffset={6}
          avoidCollisions={false}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-[60] flex w-[min(340px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl border border-border bg-bg shadow-xl data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out"
          style={{ maxHeight: 'calc(var(--radix-popover-content-available-height) - 12px)' }}
          aria-label={sortie === 'client' ? 'Pages montrées au client' : 'Pages du PDF'}
          data-plaquette-volet-pages={sortie}
        >
          <div className="flex shrink-0 items-center gap-2 px-4 pb-1 pt-3">
            <h3 className="flex-1 text-[14px] font-semibold text-text">{sortie === 'client' ? t('Pages montrées au client') : t('Pages du PDF')}</h3>
          </div>
          <ZoneDefilement className="min-h-0 px-4 pb-4">{contenu}</ZoneDefilement>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/**
 * LE CHOIX DES PAGES D'UNE SORTIE (décision de l'utilisateur : depuis le chevron du bouton lien pour le client, du
 * bouton « Télécharger » pour le PDF). Une ligne par section, la page où elle se trouve, et sa case : décochée, la
 * section quitte CETTE sortie seulement. Une section masquée ne se montre nulle part : elle n'est pas proposée.
 */
function ChoixDesPages({ sortie, blocs, pages, onChange }: { sortie: 'client' | 'pdf'; blocs: BlocDePlaquette[]; pages: string[][]; onChange: (blocs: BlocDePlaquette[]) => void }) {
  const cle = sortie === 'client' ? 'horsClient' : 'horsPdf';
  const visibles = blocs.filter((b) => !b.masque);
  const pagesDe = (id: string) => pages.flatMap((ids, i) => (ids.includes(id) ? [i + 1] : []));
  const basculer = (id: string, garder: boolean) => onChange(blocs.map((b) => (b.id === id ? { ...b, [cle]: garder ? undefined : true } : b)));
  const tout = visibles.every((b) => !b[cle]);
  return (
    <div className="flex flex-col gap-3" data-plaquette-choix-pages={sortie}>
      <p className="text-[12.5px] text-muted">
        {sortie === 'client' ? t('Décochez une section pour la retirer de la page de votre client. Le PDF garde ses propres choix.') : t('Décochez une section pour la retirer du PDF. La page du client garde ses propres choix.')}
      </p>
      <Button size="sm" variant="ghost" className="self-start" onClick={() => onChange(blocs.map((b) => (b.masque ? b : { ...b, [cle]: tout ? true : undefined })))} data-plaquette-pages-tout>
        {tout ? t('Tout décocher') : t('Tout cocher')}
      </Button>
      <div className="flex flex-col gap-1">
        {visibles.map((b) => {
          const n = pagesDe(b.id);
          const garde = !b[cle];
          return (
            <div key={b.id} className="flex min-w-0 items-center gap-3 rounded-lg bg-raised px-3 py-2" data-plaquette-page-section={b.id}>
              <CaseACocher checked={garde} onCheckedChange={(v) => basculer(b.id, v)} aria-label={b.titre || nomDuGenre(b.genre)} data-plaquette-page-case={b.id} />
              <span className={cn('min-w-0 flex-1 truncate text-[13px]', garde ? 'text-text' : 'text-faint')}>{b.titre || nomDuGenre(b.genre)}</span>
              <span className="shrink-0 text-[12px] tabular-nums text-faint">{n.length ? (n.length > 1 ? t('p. {a}–{b}', { a: n[0]!, b: n[n.length - 1]! }) : t('p. {a}', { a: n[0]! })) : ''}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const POLICES = ['Inter', 'Helvetica Neue', 'Arial', 'Georgia', 'Times New Roman', 'Verdana', 'Trebuchet MS'];

/**
 * LA CHARTE GRAPHIQUE DU DOCUMENT : les trois couleurs, la police, le nom, la ligne de contact, le logo, et le
 * tutoiement ou le vouvoiement. Elle ne touche AUCUN autre document (décision de l'utilisateur) ; le document suit
 * chaque changement, et l'enregistrement part seul. Que des éléments maison : aucune liste, case de couleur ni champ
 * du navigateur.
 */
function CharteDuDocument({ brouillon, projetMarqueNom, onChange }: { brouillon: Brouillon; projetMarqueNom: string | null; onChange: (patch: Partial<Brouillon>) => void }) {
  const marque = brouillon.marque;
  const changerMarque = (patch: Partial<MarqueDePlaquette>) => onChange({ marque: { ...marque, ...patch } });
  const couleur = (cle: 'couleur' | 'texte' | 'fond', libelle: string) => (
    <div className="flex min-w-0 items-center gap-3 rounded-lg bg-raised px-3 py-2">
      <ChoixDeCouleur valeur={marque[cle]} onApercu={(v) => changerMarque({ [cle]: v })} onValider={(v) => changerMarque({ [cle]: v })} aria-label={libelle} data-plaquette-couleur={cle} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] text-text">{libelle}</span>
        <span className="font-mono text-[12px] text-muted">{marque[cle]}</span>
      </span>
    </div>
  );
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12.5px] text-muted">
        {projetMarqueNom ? t('Aux couleurs de {marque} — ne change que ce document.', { marque: projetMarqueNom }) : t('Ne change que ce document.')}
      </p>
      <section className="flex flex-col gap-2">
        <h4 className="text-[12px] font-medium text-muted">{t('Couleurs')}</h4>
        {couleur('couleur', t('Couleur principale'))}
        {couleur('texte', t('Couleur du texte'))}
        {couleur('fond', t('Fond des pages'))}
      </section>
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-muted">{t('Nom affiché')}</span>
        <Input value={marque.nom} onChange={(e) => changerMarque({ nom: e.target.value })} data-plaquette-marque-nom />
      </label>
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-muted">{t('Police')}</span>
        <ListeDeroulante
          valeur={marque.police ?? ''}
          titre={t('Police')}
          options={[{ valeur: '', libelle: t('Par défaut (Inter)') }, ...[...new Set([...(marque.police ? [marque.police] : []), ...POLICES])].map((f) => ({ valeur: f, libelle: f, style: { fontFamily: f } }))]}
          onChoisir={(v) => changerMarque({ police: v || undefined })}
          repere="plaquette-police"
          seuilRecherche={5}
        />
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-muted">{t('Contact en pied de page')}</span>
        <Input value={marque.contact ?? ''} onChange={(e) => changerMarque({ contact: e.target.value })} data-plaquette-contact />
      </label>
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-muted">{t('Logo')}</span>
        {marque.logo ? (
          <div className="flex items-center gap-3">
            <span className="relative inline-flex h-10 min-w-16 max-w-40 items-center justify-center overflow-hidden rounded-md px-2" style={{ background: marque.couleur }}>
              <ImageDePiece id={marque.logo} alt={marque.nom} className="max-h-8 w-auto object-contain" />
            </span>
            <Button size="sm" variant="ghost" onClick={() => changerMarque({ logo: undefined })} data-plaquette-logo-retirer>
              {t('Retirer le logo')}
            </Button>
          </div>
        ) : (
          <span className="text-[12.5px] text-faint">{t('Aucun logo : le nom de la marque s’affiche à sa place.')}</span>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-muted">{t('S’adresser au client')}</span>
        <BoutonsRadio
          libelle={t('S’adresser au client')}
          valeur={brouillon.adresse}
          onChoisir={(v) => onChange({ adresse: v === 'tu' ? 'tu' : 'vous' })}
          options={[
            { valeur: 'vous', libelle: t('Vouvoiement'), detail: t('Les textes de sa page disent « vous ».') },
            { valeur: 'tu', libelle: t('Tutoiement'), detail: t('Les textes de sa page disent « tu ».') },
          ]}
          data-plaquette-adresse={brouillon.adresse}
        />
      </div>
    </div>
  );
}
