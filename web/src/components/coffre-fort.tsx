import { useTiroirAdresse } from '@/lib/tiroirs-adresse';
import * as React from 'react';
import {
  Archive,
  ArchiveRestore,
  Asterisk,
  BookUser,
  Car,
  Check,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  CreditCard,
  Database,
  EllipsisVertical,
  Eye,
  EyeOff,
  Folder,
  FolderPlus,
  Download,
  FilePlus,
  IdCard,
  Paperclip,
  KeyRound,
  Landmark,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Search,
  Terminal,
  Ticket,
  Trash2,
  X,
} from 'lucide-react';
import {
  AccesCoffre,
  Attachment,
  CHAMPS_LIBRES_MAX,
  ChampAcces,
  ChampLibre,
  DossierCoffre,
  LIBELLE_CHAMP_LIBRE_MAX,
  refusDuFichierDuCoffre,
  refusDuPoidsDeLaFiche,
  genreDuFichier,
  LIBELLE_TYPE_ACCES,
  NOM_ACCES_MAX,
  NOM_DOSSIER_MAX,
  TYPES_ACCES,
  TypeAcces,
  apercuAcces,
  champsACompleter,
  champsDuType,
  echeanceArchive,
  filtrerAcces,
  libelleDansUnMenu,
  projetsEnArbre,
  construireArbreDeDossiers,
  cheminDuDossier,
  descendantsDuDossier,
  regrouperParDossier,
  SEPARATEUR_AFFICHAGE,
  type NoeudDeDossier,
} from '@beluga/shared';
import {
  BulleInfo,
  Badge,
  Button,
  ConfirmDialog,
  DialogFooter,
  DialogTitle,
  TitreDePage,
  CLASSE_GROUPE_DE_LIGNES,
  CLASSE_LIGNE_DE_GROUPE,
  Drawer,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Input,
  Textarea,
  ZoneDefilement,
  ListeDeroulante,
  FormulaireEnColonnes,
  LigneFormulaire,
  Tooltip,
} from '@/components/ui';
import { SilhouetteCoffre } from '@/components/silhouettes';
import { BoutonPrincipal, GestePrincipal, GestesDePage, OptionDePage, OptionsDePage } from '@/components/entete-de-zone';
import { CLASSE_SECTION_DE_SERVICE, ColonneDeService, useColonneDeService } from '@/components/colonne-de-service';
import { GesteDeCreationDeColonne, RubriqueDeColonne } from '@/components/rubriques-de-colonne';
import { AttachmentPreview } from '@/components/attachment-preview';
import { IconeDeGenre, ImageDePiece, adresseDePiece } from '@/components/pastille-de-fichier';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { formatRegional, t } from '@/lib/langue';
import { PasAPas } from '@/components/pas-a-pas';
import { bytes, cn } from '@/lib/utils';
import { useElementAdresse } from '@/lib/adresse-element';

/**
 * LE COFFRE-FORT — un tiroir, une liste, un tiroir empilé par fiche.
 *
 * Le premier tiroir montre TOUS les accès enregistrés, tous projets confondus,
 * avec une barre de recherche qui mord sur le nom, le projet et le type. Le
 * bouton de création propose les types d'accès ; l'ouverture d'une fiche —
 * nouvelle ou existante — se fait dans un SECOND tiroir posé par-dessus le
 * premier, jamais à sa place : on referme le détail et la liste est toujours
 * là, à la même ligne.
 *
 * RETIRER N'EFFACE PAS : une fiche retirée part aux ARCHIVES, qui vivent dans
 * un TIROIR À ELLES, ouvert par le bouton « Archives » de l'entête et posé
 * par-dessus la liste des accès actifs — jamais à sa place : l'ancienne bascule
 * changeait le contenu de la liste sans que rien ne dise qu'on regardait autre
 * chose. Le tiroir porte sa propre recherche, la date d'effacement de chaque
 * fiche (six mois après son retrait) et le bouton qui la restaure ; on revient
 * aux accès actifs en le refermant, jamais en recliquant « Archives ».
 *
 * UNE FICHE PORTE DES IMAGES (capture, code QR, document scanné) : elles se
 * choisissent, se glissent ou se collent dans la fiche, s'affichent en
 * vignettes sous ses champs et s'ouvrent en grand au clic. Elles partent au
 * coffre par `/api/upload?coffre=1`, réservé à l'administrateur, et ne sont
 * rattachées à la fiche qu'à l'ENREGISTREMENT.
 *
 * Les règles (types, champs, recherche, archives, images) vivent dans `shared/src/coffre-fort.ts`.
 */

/** Ce que rend chaque commande du coffre : les fiches, et les images qu'elles citent. */
interface ReponseDuCoffre {
  acces?: AccesCoffre[];
  liste?: AccesCoffre[];
  archives?: AccesCoffre[];
  pieces?: Attachment[];
  /** Les dossiers actifs, puis les archivés (avec leurs fiches). */
  dossiers?: DossierCoffre[];
  dossiersArchives?: DossierCoffre[];
}

/** La date d'effacement d'une archive, dans la langue en vigueur. */
function dateEffacement(acces: AccesCoffre): string {
  const echeance = echeanceArchive(acces);
  return echeance ? new Date(echeance).toLocaleDateString(formatRegional()) : '';
}

/** Une fiche vierge du type demandé, telle que le second tiroir la reçoit. */
function ficheVierge(type: TypeAcces, projectId: string | null): AccesCoffre {
  return {
    id: '',
    nom: '',
    type,
    projectId,
    champs: {},
    note: '',
    creeLe: 0,
    modifieLe: 0,
    origine: 'coffre',
    images: [],
    champsLibres: [],
  };
}

/** L'icône de chaque type d'accès, dans la colonne de gauche. */
const ICONE_DU_TYPE: Readonly<Record<TypeAcces, React.ReactNode>> = {
  'cle-api': <KeyRound />,
  'mot-de-passe': <Lock />,
  ssh: <Terminal />,
  jeton: <Ticket />,
  'base-de-donnees': <Database />,
  'compte-bancaire': <Landmark />,
  'carte-paiement': <CreditCard />,
  'carte-identite': <IdCard />,
  passeport: <BookUser />,
  'permis-conduire': <Car />,
  autre: <Asterisk />,
};

export function CoffreFort({
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
  /** LA FICHE DÉSIGNÉE PAR L'ADRESSE : « #coffre/<id> ». */
  vise?: string | null;
  /** …et, en sens inverse, la fiche ouverte, pour que l'adresse la décrive. */
  onVise?: (ficheId: string | null) => void;
}) {
  const state = useApp();
  const [liste, setListe] = React.useState<AccesCoffre[]>([]);
  const [archives, setArchives] = React.useState<AccesCoffre[]>([]);
  /* LES DOSSIERS : un seul niveau, repliés au départ. Ils ne sont jamais des
     fiches — une autre liste, un autre état. */
  const [dossiers, setDossiers] = React.useState<DossierCoffre[]>([]);
  const [dossiersArchives, setDossiersArchives] = React.useState<DossierCoffre[]>([]);
  const [ouverts, setOuverts] = React.useState<ReadonlySet<string>>(new Set());
  /** Le dossier en cours d'édition : `null` = aucun, `{ dossier: null }` = un dossier neuf. */
  const [edition, setEdition] = React.useState<{ dossier: DossierCoffre | null; parentId?: string | null } | null>(null);
  /* Le tiroir des archives : une COUCHE de plus, pas une autre liste à la
     place de celle-ci. Sa recherche est la sienne — partager celle du fond
     ferait disparaître des lignes derrière, sans raison visible. */
  const [archivesOuvertes, setArchivesOuvertes] = React.useState(false);
  useTiroirAdresse('archives-coffre', archivesOuvertes, setArchivesOuvertes);
  const [recherche, setRecherche] = React.useState('');
  /* VRAI DÈS LE PREMIER RENDU : l'effet qui lit le coffre ne tourne qu'APRÈS,
     et l'écran annonçait « aucun accès enregistré » le temps d'une image. */
  const [chargement, setChargement] = React.useState(true);
  /* UNE LECTURE RATÉE N'EST PAS UN COFFRE VIDE. `echec` porte la raison d'une
     lecture refusée tant qu'AUCUNE n'a réussi ; `recu` dit qu'une liste est
     là — elle n'est alors plus jamais vidée ni remplacée par un message. */
  const [echec, setEchec] = React.useState<string | null>(null);
  const recu = React.useRef(false);
  const [essai, setEssai] = React.useState(0);
  const [fiche, setFiche] = React.useState<AccesCoffre | null>(null);
  /* LA COLONNE DE GAUCHE EST CELLE DU COFFRE-FORT (demande du 12/10/2026 :
     « chaque sidebar de chaque service doit être spécifique au service »). Sur
     ordinateur elle porte « Nouvel accès », « Tous les accès », le classement
     par type et « Archives » ; la barre d'en-tête n'a plus ces deux gestes.
     Sur téléphone, rien ne change : ils restent dans la page. */
  const dansLaColonne = useColonneDeService();
  /** Le type d'accès retenu dans la colonne ; `null` : tous. */
  const [typeRetenu, setTypeRetenu] = React.useState<TypeAcces | null>(null);
  /* Les images citées par les fiches, par identifiant : leurs vignettes. */
  const [pieces, setPieces] = React.useState<Attachment[]>([]);

  const nomProjet = React.useCallback(
    (projectId: string | null) => state.projects.find((p) => p.id === projectId)?.name,
    [state.projects],
  );

  /*
   * La liste se relit à CHAQUE ouverture : un accès posé depuis un autre onglet
   * ou par un agent doit être là, sans recharger la page.
   *
   * …ET SEULEMENT LIEN OUVERT, PUIS À CHAQUE RETOUR DU LIEN (carte « Coffre-fort
   * qui plante dans un dossier ») : l'écran se monte souvent avant le canal —
   * rechargement, retour de veille, reconnexion — et la lecture partait dans
   * le vide (« non connecté »), sans jamais être refaite : le coffre restait
   * affiché VIDE. Une seule lecture par ouverture du lien, annulée au démontage.
   * Une relecture ne repasse pas en chargement quand une liste est déjà là :
   * la fiche visée par l'adresse et les dossiers dépliés restent en place.
   */
  const connecte = state.connected;
  React.useEffect(() => {
    if (!open || !connecte) return;
    let vivant = true;
    if (!recu.current) setChargement(true);
    client
      .call<ReponseDuCoffre>({
        type: 'coffre.lister',
      })
      .then((data) => {
        if (!vivant) return;
        recu.current = true;
        setEchec(null);
        setListe(data.acces ?? []);
        setArchives(data.archives ?? []);
        setPieces(data.pieces ?? []);
        setDossiers(data.dossiers ?? []);
        setDossiersArchives(data.dossiersArchives ?? []);
      })
      .catch((err: any) => {
        if (!vivant) return;
        /* Le lien est retombé entre-temps : son retour relance cette lecture,
           et la coupure se dit déjà par le message du canal. */
        if (err?.canalFerme) return;
        const raison = err?.message || t('Coffre-fort illisible');
        if (recu.current) client.pushToast('error', raison);
        else setEchec(raison);
      })
      .finally(() => {
        if (vivant) setChargement(false);
      });
    return () => {
      vivant = false;
    };
  }, [open, connecte, essai]);

  /*
   * L'ADRESSE ET LA FICHE OUVERTE SE SUIVENT. Une fiche ARCHIVÉE reste
   * atteignable par son lien : on cherche dans les deux listes, et l'on OUVRE
   * le tiroir des archives quand la cible y est — sinon la fiche se poserait
   * sur une liste qui ne la contient pas.
   */
  useElementAdresse({
    vise,
    onVise,
    ouvertId: fiche?.id || null,
    pret: !chargement,
    absent: t('Cet accès n’existe plus dans le coffre-fort.'),
    ouvrir: (id) => {
      const active = liste.find((acces) => acces.id === id);
      if (active) {
        // La fiche visée se montre : son dossier s'ouvre.
        // …et toute la chaîne de ses parents, sinon elle resterait cachée dans un dossier replié.
        if (active.dossierId) {
          const chaine = chaineDeParents(dossiers, active.dossierId);
          setOuverts((avant) => new Set([...avant, ...chaine]));
        }
        setFiche(active);
        return true;
      }
      const archivee = archives.find((acces) => acces.id === id);
      if (!archivee) return false;
      setArchivesOuvertes(true);
      setFiche(archivee);
      return true;
    },
  });

  /* Un dossier se cherche par son CHEMIN complet : « Clients/Acme/Prod » trouve
     ses fiches par n'importe lequel de ces mots. */
  const nomDossier = React.useCallback(
    (id: string | null) => (id ? cheminDuDossier(dossiers, id).join(' ') || undefined : undefined),
    [dossiers],
  );
  const visibles = filtrerAcces(liste, recherche, nomProjet, nomDossier).filter(
    (acces) => !typeRetenu || acces.type === typeRetenu,
  );
  /* Une recherche ou un filtre de type OUVRE les dossiers où quelque chose est
     trouvé, et cache les dossiers vides : on voit la fiche avec son dossier. */
  const filtre = Boolean(recherche.trim() || typeRetenu);
  const arbre = construireArbreDeDossiers(visibles, dossiers, { sansVides: filtre });
  const rienAMontrer = !arbre.racines.length && !arbre.acces.length;
  const bascule = (id: string) =>
    setOuverts((avant) => {
      const suite = new Set(avant);
      if (!suite.delete(id)) suite.add(id);
      return suite;
    });
  /* TOUTE UNE BRANCHE D'UN CLIC (l'icône à droite du nom d'un dossier) : le
     dossier et tous ses sous-dossiers s'ouvrent, ou se referment ensemble. */
  const toutBasculer = (ids: readonly string[], ouvrir: boolean) =>
    setOuverts((avant) => {
      const suite = new Set(avant);
      for (const id of ids) {
        if (ouvrir) suite.add(id);
        else suite.delete(id);
      }
      return suite;
    });
  /* Les types qui ont au moins un accès, et celui qui est retenu : un type
     vide n'est pas une rubrique à proposer. */
  const typesPresents = TYPES_ACCES.filter((type) => type === typeRetenu || liste.some((acces) => acces.type === type));
  const creerUnAcces = (type: TypeAcces) => setFiche(ficheVierge(type, state.activeProjectId ?? null));
  const recevoir = (data: ReponseDuCoffre) => {
    setListe(data.liste ?? data.acces ?? []);
    if (data.archives) setArchives(data.archives);
    if (data.pieces) setPieces(data.pieces);
    if (data.dossiers) setDossiers(data.dossiers);
    if (data.dossiersArchives) setDossiersArchives(data.dossiersArchives);
  };
  const restaurerUnDossier = async (dossier: DossierCoffre) => {
    try {
      const data = await client.call<ReponseDuCoffre>({ type: 'coffre.dossier.restaurer', id: dossier.id });
      recevoir(data);
      client.pushToast('success', t('Dossier restauré.'));
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Dossier non restauré'));
    }
  };

  return (
    <>
      <Drawer open={open} onClose={onClose} enPage={enPage}>
        {dansLaColonne ? (
          /* SUR ORDINATEUR, « NOUVEAU DOSSIER » SE POSE À DROITE DU TITRE (demande
             du 20/10/2026) : la colonne ne garde que « Nouvel accès » comme geste
             qui crée. Sur téléphone, le titre ne se dessine pas et le geste reste
             dans le menu à trois points. */
          <div className="flex min-w-0 shrink-0 items-start gap-3">
            <TitreDePage className="min-w-0 flex-1">{t('Coffre-fort')}</TitreDePage>
            <Button
              variant="subtle"
              size="sm"
              className="shrink-0"
              onClick={() => setEdition({ dossier: null })}
              data-coffre-nouveau-dossier
              aria-label="Nouveau dossier"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              {t('Nouveau dossier')}
            </Button>
          </div>
        ) : (
          <TitreDePage>{t('Coffre-fort')}</TitreDePage>
        )}
        {dansLaColonne ? null : (
          <>
          {/* SUR TÉLÉPHONE : « Archives » est une ligne du menu à trois points,
              « Nouvel accès » le bouton du bas de l'écran — il y ouvre la même
              liste des types d'accès. */}
          <OptionsDePage>
            <OptionDePage
              variante="ghost"
              icone={<Folder className="h-3 w-3" />}
              onClick={() => setEdition({ dossier: null })}
              data-coffre-nouveau-dossier
            >
              {t('Nouveau dossier')}
            </OptionDePage>
            <OptionDePage
              variante="ghost"
              icone={<Archive className="h-3 w-3" />}
              onClick={() => setArchivesOuvertes(true)}
              aria-haspopup="dialog"
              data-coffre-voir-archives
            >
              {t('Archives')}
              {archives.length ? <span className="text-faint">{archives.length}</span> : null}
            </OptionDePage>
          </OptionsDePage>
          <GestePrincipal>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <BoutonPrincipal data-coffre-creer>
                  <Plus className="h-3 w-3" />
                  {t('Nouvel accès')}
                </BoutonPrincipal>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{t('Type d’accès')}</DropdownMenuLabel>
                {TYPES_ACCES.map((type) => (
                  <DropdownMenuItem
                    key={type}
                    data-coffre-type={type}
                    onSelect={() => setFiche(ficheVierge(type, state.activeProjectId ?? null))}
                  >
                    {t(LIBELLE_TYPE_ACCES[type])}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </GestePrincipal>
          </>
        )}

        {/* LA COLONNE DU SERVICE : le geste qui crée, détaché ; puis les rubriques
            (tous les accès, un type), puis les archives. */}
        <ColonneDeService>
          <nav aria-label="Rubriques du coffre-fort" data-colonne-coffre className="flex min-h-0 flex-1 flex-col gap-0.5 pt-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <GesteDeCreationDeColonne libelle={t('Nouvel accès')} data-coffre-creer aria-label="Nouvel accès" />
              </DropdownMenuTrigger>
              {/* LE FOCUS NE REVIENT PAS AU BOUTON DE LA COLONNE : choisir un type
                  ouvre la fiche, et rendre le focus à un bouton posé HORS de
                  cette page la fermait aussitôt (le focus hors d'une page
                  empilée la dissout). */}
              <DropdownMenuContent align="start" onCloseAutoFocus={(event) => event.preventDefault()}>
                <DropdownMenuLabel>{t('Type d’accès')}</DropdownMenuLabel>
                {TYPES_ACCES.map((type) => (
                  <DropdownMenuItem key={type} data-coffre-type={type} onSelect={() => creerUnAcces(type)}>
                    {t(LIBELLE_TYPE_ACCES[type])}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <RubriqueDeColonne
              icone={<KeyRound />}
              libelle={t('Tous les accès')}
              compte={liste.length}
              actif={typeRetenu === null}
              onClick={() => setTypeRetenu(null)}
              data-coffre-rubrique="tous"
            />
            {typesPresents.length ? <p className={CLASSE_SECTION_DE_SERVICE}>{t('Par type')}</p> : null}
            {typesPresents.map((type) => (
              <RubriqueDeColonne
                key={type}
                icone={ICONE_DU_TYPE[type]}
                libelle={t(LIBELLE_TYPE_ACCES[type])}
                compte={liste.filter((acces) => acces.type === type).length}
                actif={typeRetenu === type}
                onClick={() => setTypeRetenu(type)}
                data-coffre-rubrique={type}
              />
            ))}
            <p className={CLASSE_SECTION_DE_SERVICE}>{t('Retirés')}</p>
            <RubriqueDeColonne
              icone={<Archive />}
              libelle={t('Archives')}
              compte={archives.length}
              onClick={() => setArchivesOuvertes(true)}
              aria-haspopup="dialog"
              data-coffre-voir-archives
            />
          </nav>
        </ColonneDeService>

        <div className="shrink-0 pb-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <Input
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder={t('Chercher par nom, dossier, projet ou type…')}
              className="h-10 rounded-xl pl-10 text-[14px]"
              autoComplete="off"
              data-coffre-recherche
            />
          </div>
        </div>

        <ZoneDefilement fond="hsl(var(--bg))" className="pb-6">
          {!recu.current && echec && !chargement ? (
            /* Une lecture REFUSÉE se dit comme telle, avec de quoi réessayer :
               jamais « aucun accès enregistré » sur un coffre qu'on n'a pas lu. */
            <div className="flex flex-col items-center gap-2 px-1 py-8 text-center" data-coffre-illisible>
              <p className="text-[14px] font-medium text-text">{t('Le coffre-fort n’a pas pu être lu.')}</p>
              <p className="max-w-[420px] text-[12.5px] text-faint">{echec}</p>
              <Button variant="ghost" size="sm" onClick={() => setEssai((n) => n + 1)} data-coffre-relire>
                {t('Réessayer')}
              </Button>
            </div>
          ) : !recu.current ? (
            /* Les accès à venir en silhouette, jamais une phrase d'attente :
               l'état vide ne se dit qu'une fois la liste réellement reçue —
               lien coupé compris, la lecture repart seule à son retour. */
            <SilhouetteCoffre />
          ) : rienAMontrer ? (
            recherche || typeRetenu ? (
              <p className="px-1 py-3 text-[12.5px] text-faint">{t('Aucun accès ne correspond.')}</p>
            ) : (
              <PasAPas
                repere="coffre"
                titre={t('Aucun accès enregistré pour l’instant.')}
                explication={t('Le coffre-fort range vos mots de passe, clés et accès aux serveurs : vos agents s’en servent sans que vous ayez à les redonner.')}
                etapes={[
                  t('Ajoutez un accès : un site, un serveur, une clé d’API.'),
                  t('Donnez-lui un nom clair : le site ou le serveur qu’il ouvre.'),
                  t('Vos agents le trouvent seuls quand une tâche en a besoin.'),
                ]}
              />
            )
          ) : (
            <div className={CLASSE_GROUPE_DE_LIGNES} data-coffre-liste="actifs">
              {arbre.racines.map((noeud) => (
                <BrancheDeDossier
                  key={noeud.dossier.id}
                  noeud={noeud}
                  filtre={filtre}
                  ouverts={ouverts}
                  nomProjet={nomProjet}
                  onBascule={bascule}
                  onToutBasculer={toutBasculer}
                  onModifier={(dossier) => setEdition({ dossier })}
                  onSousDossier={(dossier) => {
                    // Le parent s'ouvre : le sous-dossier neuf s'y montrera dès sa création.
                    setOuverts((avant) => new Set(avant).add(dossier.id));
                    setEdition({ dossier: null, parentId: dossier.id });
                  }}
                  onOuvrir={setFiche}
                />
              ))}
              {arbre.acces.length ? (
                <>
                  {arbre.racines.length ? (
                    <p className="px-3.5 pb-1 pt-3 text-[12px] text-faint" data-coffre-sans-dossier>
                      {t('Sans dossier')}
                    </p>
                  ) : null}
                  {arbre.acces.map((acces) => (
                    <LigneAcces
                      key={acces.id}
                      acces={acces}
                      projet={nomProjet(acces.projectId)}
                      onOuvrir={() => setFiche(acces)}
                    />
                  ))}
                </>
              ) : null}
            </div>
          )}
        </ZoneDefilement>
      </Drawer>

      {/* Les archives : un tiroir posé par-dessus la liste, qui reste entière
          derrière lui. */}
      <TiroirArchives
        open={archivesOuvertes}
        onClose={() => setArchivesOuvertes(false)}
        archives={archives}
        dossiersArchives={dossiersArchives}
        nomProjet={nomProjet}
        onOuvrir={setFiche}
        onRestaurerDossier={restaurerUnDossier}
      />

      {/* Le détail : empilé par-dessus la liste — ou par-dessus les archives. */}
      <FicheAcces
        fiche={fiche}
        pieces={pieces}
        dossiers={dossiers}
        onClose={() => setFiche(null)}
        onListe={recevoir}
      />

      {/* Un dossier : son nom et son projet, rien d'autre. */}
      <FicheDossier edition={edition} dossiers={dossiers} onClose={() => setEdition(null)} onListe={recevoir} />
    </>
  );
}

/**
 * LE TIROIR DES ARCHIVES — tout ce qu'on peut faire d'une fiche retirée, au
 * même endroit : la chercher, lire la date où elle sera effacée, l'ouvrir pour
 * la restaurer. Il se referme comme n'importe quel tiroir, et la liste des
 * accès actifs est là, intacte, dessous.
 */
function TiroirArchives({
  open,
  onClose,
  archives,
  dossiersArchives,
  nomProjet,
  onOuvrir,
  onRestaurerDossier,
}: {
  open: boolean;
  onClose: () => void;
  archives: AccesCoffre[];
  /** Les dossiers retirés : leurs fiches reviennent avec eux. */
  dossiersArchives: DossierCoffre[];
  nomProjet: (projectId: string | null) => string | undefined;
  onOuvrir: (acces: AccesCoffre) => void;
  onRestaurerDossier: (dossier: DossierCoffre) => void;
}) {
  const [recherche, setRecherche] = React.useState('');
  /* La recherche repart à blanc à chaque ouverture : un filtre oublié d'une
     fois sur l'autre ferait croire à des archives disparues. */
  React.useEffect(() => {
    if (!open) setRecherche('');
  }, [open]);

  const visibles = filtrerAcces(archives, recherche, nomProjet, (id) =>
    id ? cheminDuDossier(dossiersArchives, id).join(' ') || undefined : undefined,
  );
  const groupes = regrouperParDossier(visibles, dossiersArchives, { sansVides: true });

  return (
    <Drawer open={open} onClose={onClose} empile>
      <header className="flex shrink-0 flex-wrap items-center gap-2 px-3 pb-2">
        <Archive className="h-3.5 w-3.5 shrink-0 text-accent" />
        <DialogTitle className="min-w-0 flex-1 truncate">{t('Archives du coffre-fort')}</DialogTitle>
        {archives.length ? <Badge tone="neutral">{archives.length}</Badge> : null}
        <BulleInfo>
          {t('Une fiche ou un dossier retiré reste ici six mois, puis il est effacé pour de bon.')}
        </BulleInfo>
      </header>

      <div className="shrink-0 px-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
          <Input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder={t('Chercher par nom, dossier, projet ou type…')}
            className="h-8 pl-7 text-[13px]"
            autoComplete="off"
            data-coffre-recherche-archives
          />
        </div>
      </div>

      <ZoneDefilement fond="hsl(var(--surface))" className="px-2 pb-3">
        {!groupes.length ? (
          <p className="px-1 py-3 text-[12.5px] text-faint">
            {recherche ? t('Aucun accès ne correspond.') : t('Aucune fiche archivée.')}
          </p>
        ) : (
          <div className="flex flex-col gap-1" data-coffre-liste="archives">
            {groupes.map((groupe) =>
              groupe.dossier ? (
                <LigneDeDossier
                  key={groupe.dossier.id}
                  dossier={groupe.dossier}
                  libelle={groupe.chemin}
                  nombre={groupe.acces.length}
                  ouvert
                  onRestaurer={() => onRestaurerDossier(groupe.dossier!)}
                >
                  {groupe.acces.map((acces) => (
                    <LigneAcces
                      key={acces.id}
                      acces={acces}
                      projet={nomProjet(acces.projectId)}
                      onOuvrir={() => onOuvrir(acces)}
                    />
                  ))}
                </LigneDeDossier>
              ) : (
                groupe.acces.map((acces) => (
                  <LigneAcces
                    key={acces.id}
                    acces={acces}
                    projet={nomProjet(acces.projectId)}
                    onOuvrir={() => onOuvrir(acces)}
                  />
                ))
              ),
            )}
          </div>
        )}
      </ZoneDefilement>
    </Drawer>
  );
}

/** Les identifiants de ce dossier et de tous ses parents, pour ouvrir toute la chaîne d'un coup. */
function chaineDeParents(dossiers: readonly DossierCoffre[], id: string): string[] {
  const parId = new Map(dossiers.map((d) => [d.id, d]));
  const chaine: string[] = [];
  let courant = parId.get(id);
  while (courant && !chaine.includes(courant.id)) {
    chaine.push(courant.id);
    courant = courant.parentId ? parId.get(courant.parentId) : undefined;
  }
  return chaine;
}

/**
 * UNE BRANCHE DE L'ARBRE : un dossier, puis ses sous-dossiers (la même branche,
 * un cran plus loin), puis ses fiches. Chaque dossier se replie seul ; le retrait
 * vient de `LigneDeDossier`, qui décale ses enfants d'un cran à chaque niveau.
 */
function idsDeLaBranche(noeud: NoeudDeDossier): string[] {
  return [noeud.dossier.id, ...noeud.enfants.flatMap(idsDeLaBranche)];
}

function BrancheDeDossier({
  noeud,
  filtre,
  ouverts,
  nomProjet,
  onBascule,
  onToutBasculer,
  onModifier,
  onSousDossier,
  onOuvrir,
}: {
  noeud: NoeudDeDossier;
  filtre: boolean;
  ouverts: Set<string>;
  nomProjet: (projectId: string | null) => string | undefined;
  onBascule: (id: string) => void;
  onToutBasculer: (ids: readonly string[], ouvrir: boolean) => void;
  onModifier: (dossier: DossierCoffre) => void;
  onSousDossier: (dossier: DossierCoffre) => void;
  onOuvrir: (acces: AccesCoffre) => void;
}) {
  const { dossier } = noeud;
  /* L'icône « tout ouvrir / tout fermer » ne sert qu'à un dossier qui a des
     sous-dossiers, et jamais pendant une recherche : tout y est déjà ouvert. */
  const branche = !filtre && noeud.enfants.length > 0 ? idsDeLaBranche(noeud) : null;
  const toutOuvert = branche ? branche.every((id) => ouverts.has(id)) : false;
  return (
    <LigneDeDossier
      dossier={dossier}
      nombre={noeud.total}
      sousDossiers={noeud.enfants.length > 0}
      ouvert={filtre || ouverts.has(dossier.id)}
      onBascule={() => onBascule(dossier.id)}
      toutOuvert={toutOuvert}
      onToutBasculer={branche ? () => onToutBasculer(branche, !toutOuvert) : undefined}
      onModifier={() => onModifier(dossier)}
      onSousDossier={() => onSousDossier(dossier)}
    >
      {noeud.enfants.map((enfant) => (
        <BrancheDeDossier
          key={enfant.dossier.id}
          noeud={enfant}
          filtre={filtre}
          ouverts={ouverts}
          nomProjet={nomProjet}
          onBascule={onBascule}
          onToutBasculer={onToutBasculer}
          onModifier={onModifier}
          onSousDossier={onSousDossier}
          onOuvrir={onOuvrir}
        />
      ))}
      {noeud.acces.map((acces) => (
        <LigneAcces key={acces.id} acces={acces} projet={nomProjet(acces.projectId)} onOuvrir={() => onOuvrir(acces)} />
      ))}
    </LigneDeDossier>
  );
}

/**
 * UNE LIGNE DE DOSSIER, repliable : le chevron, le nom et, collé à lui, le
 * nombre de fiches. Ses fiches se posent dessous, en retrait. Dans la liste des
 * accès, le menu à trois points crée un sous-dossier ou l'édite ; dans les
 * archives, le bouton le restaure AVEC ses fiches.
 * Le texte replié reste dans un `span` : jamais de `line-clamp` dans un `button`.
 */
function LigneDeDossier({
  dossier,
  libelle,
  nombre,
  sousDossiers,
  ouvert,
  onBascule,
  toutOuvert,
  onToutBasculer,
  onModifier,
  onSousDossier,
  onRestaurer,
  children,
}: {
  dossier: DossierCoffre;
  /** Ce qui s'affiche à la place du nom seul : le chemin complet, dans les archives. */
  libelle?: string;
  nombre: number;
  /** Le dossier contient des sous-dossiers (même vides) : il y a donc quelque chose à déplier. */
  sousDossiers?: boolean;
  ouvert: boolean;
  onBascule?: () => void;
  /** Toute la branche (le dossier et ses sous-dossiers) est ouverte. */
  toutOuvert?: boolean;
  /** Ouvre ou ferme toute la branche ; absent : pas d'icône (archives, recherche, dossier sans sous-dossier). */
  onToutBasculer?: () => void;
  onModifier?: () => void;
  onSousDossier?: () => void;
  onRestaurer?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div data-coffre-dossier={dossier.id} data-ouvert={ouvert ? 'oui' : 'non'}>
      <div className="flex items-center gap-1 rounded-xl transition-colors hover:bg-raised">
        {/* LE NOMBRE D'ACCÈS SUIT LE NOM, et l'icône « tout ouvrir / tout
            fermer » les suit : la ligne se coupe donc en deux boutons de
            bascule — le nom et son nombre, puis le reste de la ligne — pour ne
            jamais poser un bouton dans un autre. Le second n'est qu'une surface
            de clic : hors du parcours au clavier. Quand la place manque
            (téléphone), le nom se coupe et le nombre ne cède jamais. Le projet
            n'est pas redit : la racine de l'arbre le porte déjà. */}
        <button
          type="button"
          onClick={onBascule}
          aria-expanded={ouvert}
          disabled={!onBascule}
          data-coffre-dossier-bascule
          className={cn('flex min-w-0 items-center gap-2 py-3 pl-3.5 text-left', onToutBasculer ? 'pr-1' : 'pr-2')}
        >
          <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-faint transition-transform', ouvert && 'rotate-90')} />
          <Folder className="h-4 w-4 shrink-0 text-muted" />
          <span className="min-w-0 truncate text-[14.5px] text-text" data-coffre-dossier-nom>
            {libelle || dossier.nom}
          </span>
          <span className="shrink-0 text-[12px] tabular-nums text-faint" data-coffre-dossier-nombre>
            {nombre}
          </span>
        </button>
        {onToutBasculer ? (
          <button
            type="button"
            onClick={onToutBasculer}
            title={toutOuvert ? t('Tout replier') : t('Tout déplier')}
            aria-label={toutOuvert ? 'Tout replier' : 'Tout déplier'}
            data-coffre-dossier-tout={toutOuvert ? 'ouvert' : 'ferme'}
            className="flex h-[29px] sm:h-6 w-[29px] sm:w-6 shrink-0 items-center justify-center rounded-lg text-faint transition-colors hover:text-text"
          >
            {toutOuvert ? <ChevronsDownUp className="h-3.5 w-3.5" /> : <ChevronsUpDown className="h-3.5 w-3.5" />}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onBascule}
          disabled={!onBascule}
          tabIndex={-1}
          aria-hidden
          title={onBascule ? (ouvert ? t('Replier le dossier') : t('Déplier le dossier')) : undefined}
          className="min-w-0 flex-1 self-stretch"
        />
        {/* LES GESTES DE LA LIGNE vivent derrière un seul bouton à trois points,
            frère des bascules : l'ouvrir ne replie ni ne déplie le dossier. */}
        {onSousDossier || onModifier ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title={t('Actions du dossier')}
                aria-label="Actions du dossier"
                data-coffre-dossier-actions
                className="mr-2 flex h-[34px] sm:h-7 w-[34px] sm:w-7 shrink-0 items-center justify-center rounded-lg text-faint transition-colors hover:text-text"
              >
                <EllipsisVertical className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
              {onSousDossier ? (
                <DropdownMenuItem onSelect={onSousDossier} data-coffre-dossier-sous-dossier>
                  <FolderPlus className="h-3.5 w-3.5" />
                  {t('Nouveau sous-dossier')}
                </DropdownMenuItem>
              ) : null}
              {onModifier ? (
                <DropdownMenuItem onSelect={onModifier} data-coffre-dossier-modifier>
                  <Pencil className="h-3.5 w-3.5" />
                  {t('Modifier le dossier')}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {onRestaurer ? (
          <button
            type="button"
            onClick={onRestaurer}
            title={t('Restaurer le dossier')}
            aria-label="Restaurer le dossier"
            data-coffre-dossier-restaurer
            className="mr-2 flex h-[34px] sm:h-7 w-[34px] sm:w-7 shrink-0 items-center justify-center rounded-lg text-faint transition-colors hover:text-text"
          >
            <ArchiveRestore className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {ouvert && (nombre > 0 || sousDossiers) ? <div className="flex flex-col gap-0.5 pl-6">{children}</div> : null}
    </div>
  );
}

/**
 * LE TIROIR D'UN DOSSIER : un nom et un projet, rien d'autre — il ne porte
 * jamais un identifiant. Le retirer archive ses fiches avec lui, et le dit
 * avant de le faire.
 */
function FicheDossier({
  edition,
  dossiers,
  onClose,
  onListe,
}: {
  edition: { dossier: DossierCoffre | null; parentId?: string | null } | null;
  /** Les dossiers actifs : de quoi choisir le parent. */
  dossiers: DossierCoffre[];
  onClose: () => void;
  onListe: (data: ReponseDuCoffre) => void;
}) {
  const state = useApp();
  const dossier = edition?.dossier ?? null;
  const [nom, setNom] = React.useState('');
  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [parentId, setParentId] = React.useState<string | null>(null);
  const [enCours, setEnCours] = React.useState(false);
  const [aSupprimer, setASupprimer] = React.useState(false);

  /* Le parent peut être n'importe quel dossier SAUF lui-même et ce qu'il contient :
     le serveur refuse de toute façon une boucle, mais on ne la propose pas. */
  const parentsPossibles = React.useMemo(() => {
    const exclus = new Set<string>(
      dossier ? [dossier.id, ...descendantsDuDossier(dossiers, dossier.id).map((d) => d.id)] : [],
    );
    return dossiers
      .filter((d) => !exclus.has(d.id))
      .map((d) => ({ id: d.id, chemin: cheminDuDossier(dossiers, d.id).join(SEPARATEUR_AFFICHAGE) }))
      .sort((a, b) => a.chemin.localeCompare(b.chemin));
  }, [dossiers, dossier]);
  const parent = parentId ? dossiers.find((d) => d.id === parentId) : undefined;

  React.useEffect(() => {
    if (!edition) return;
    setNom(dossier?.nom ?? '');
    const parentDepart = dossier ? (dossier.parentId ?? null) : (edition.parentId ?? null);
    setParentId(parentDepart);
    const dossierParent = parentDepart ? dossiers.find((d) => d.id === parentDepart) : undefined;
    setProjectId(dossierParent ? dossierParent.projectId : dossier ? dossier.projectId : (state.activeProjectId ?? null));
    // Le tiroir se remplit à l'ouverture, et seulement là.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edition]);

  const enregistrer = async () => {
    setEnCours(true);
    try {
      const data = await client.call<ReponseDuCoffre>({
        type: 'coffre.dossier.enregistrer',
        dossier: { id: dossier?.id ?? '', nom, projectId: parent ? parent.projectId : projectId, parentId },
      });
      onListe(data);
      client.pushToast('success', t('Dossier enregistré.'));
      onClose();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Dossier non enregistré'));
    } finally {
      setEnCours(false);
    }
  };

  const supprimer = async () => {
    if (!dossier) return;
    try {
      const data = await client.call<ReponseDuCoffre>({ type: 'coffre.dossier.supprimer', id: dossier.id });
      onListe(data);
      client.pushToast('success', t('Dossier archivé.'));
      onClose();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Dossier non retiré'));
    }
  };

  return (
    <>
      <Drawer open={edition !== null} onClose={onClose} empile>
        <DialogTitle className="min-w-0 truncate px-3 pb-2">
          {dossier ? dossier.nom : parent ? t('Nouveau sous-dossier') : t('Nouveau dossier')}
        </DialogTitle>
        <ZoneDefilement fond="hsl(var(--surface))" className="px-3 pb-3 pt-4">
          <FormulaireEnColonnes data-coffre-fiche-dossier>
            <Champ libelle={t('Nom')}>
              <Input
                value={nom}
                onChange={(e) => setNom(e.target.value)}
                maxLength={NOM_DOSSIER_MAX}
                placeholder={t('Ex. Serveur OVH')}
                className="h-8 text-[13px]"
                autoComplete="off"
                data-coffre-dossier-champ-nom
              />
            </Champ>
            <Champ libelle={t('Dossier parent')}>
              <ListeDeroulante
                valeur={parentId ?? ''}
                titre={t('Dossier parent')}
                repere="coffre-dossier-parent"
                data-coffre-dossier-parent
                onChoisir={(valeur) => {
                  setParentId(valeur || null);
                  const choisi = dossiers.find((d) => d.id === valeur);
                  if (choisi) setProjectId(choisi.projectId);
                }}
                options={[
                  { valeur: '', libelle: t('Racine du coffre') },
                  ...parentsPossibles.map((p) => ({ valeur: p.id, libelle: p.chemin })),
                ]}
              />
            </Champ>
            <Champ libelle={t('Projet')}>
              <ListeDeroulante
                valeur={projectId ?? ''}
                titre={t('Projet')}
                repere="coffre-dossier-projet"
                data-coffre-dossier-projet
                /* Un sous-dossier prend le projet de son parent. */
                desactivee={Boolean(parent)}
                onChoisir={(valeur) => setProjectId(valeur || null)}
                options={[
                  { valeur: '', libelle: t('Général') },
                  ...projetsEnArbre(state.projects).map((ligne) => ({
                    valeur: ligne.projet.id,
                    libelle: libelleDansUnMenu(ligne.projet.name, ligne),
                    attributs: { 'data-membre-de': ligne.parentId },
                  })),
                ]}
              />
            </Champ>
            <p className="text-[12px] leading-relaxed text-faint">
              {t('Les fiches et les sous-dossiers d’un dossier suivent son projet.')}
            </p>
          </FormulaireEnColonnes>
        </ZoneDefilement>
        <DialogFooter className="justify-start px-3 pt-2">
          <Button
            variant="subtle"
            size="sm"
            onClick={enregistrer}
            disabled={enCours || !nom.trim()}
            data-coffre-dossier-enregistrer
          >
            {enCours ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            {t('Enregistrer')}
          </Button>
          {dossier ? (
            <Button variant="ghost" size="sm" onClick={() => setASupprimer(true)} data-coffre-dossier-supprimer>
              <Trash2 className="h-3 w-3" />
              {t('Retirer')}
            </Button>
          ) : null}
        </DialogFooter>
      </Drawer>

      <ConfirmDialog
        open={aSupprimer}
        onClose={() => setASupprimer(false)}
        title={t('Retirer ce dossier ?')}
        description={t(
          'Le dossier, ses sous-dossiers et toutes leurs fiches partent aux archives ensemble : ils se restaurent pendant six mois, puis ils sont effacés pour de bon.',
        )}
        confirmLabel={t('Retirer')}
        danger
        onConfirm={supprimer}
      />
    </>
  );
}

/** Une ligne de la liste : ce qui identifie l'accès, jamais ce qu'il protège. */
function LigneAcces({ acces, projet, onOuvrir }: { acces: AccesCoffre; projet?: string; onOuvrir: () => void }) {
  const apercu = apercuAcces(acces);
  return (
    <button
      type="button"
      onClick={onOuvrir}
      data-coffre-acces={acces.id}
      className={cn('flex w-full flex-col items-start gap-1', CLASSE_LIGNE_DE_GROUPE)}
    >
      <span className="flex w-full min-w-0 items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[14.5px] text-text">{acces.nom}</span>
        {acces.images?.length ? (
          <span
            className="flex shrink-0 items-center gap-0.5 text-[12px] tabular-nums text-faint"
            title={t('Fichiers joints')}
            data-coffre-nombre-images={acces.images.length}
          >
            <Paperclip className="h-3 w-3" />
            {acces.images.length}
          </span>
        ) : null}
        {/* À COMPLÉTER : le secret qui rend la fiche utilisable manque. Calculé, jamais stocké. */}
        {!acces.archiveLe && champsACompleter(acces).length ? (
          <Badge tone="attention" data-coffre-a-completer>
            {t('À compléter')}
          </Badge>
        ) : null}
        <Badge tone="neutral">{t(LIBELLE_TYPE_ACCES[acces.type] ?? LIBELLE_TYPE_ACCES.autre)}</Badge>
      </span>
      <span className="flex w-full min-w-0 items-center gap-1.5 text-[12px] text-faint">
        {/* LE PROJET GARDE SON NOM : c'est l'aperçu, plus long, qui se replie.
            Deux textes repliables côte à côte se partageaient le manque de
            place, et sur téléphone le projet se réduisait à une lettre. */}
        <span className="max-w-[45%] shrink-0 truncate">{projet ?? t('Général')}</span>
        {acces.archiveLe ? (
          <>
            <span aria-hidden>·</span>
            <span className="shrink-0" data-coffre-effacement>
              {t('effacée le {date}', { date: dateEffacement(acces) })}
            </span>
          </>
        ) : null}
        {apercu ? (
          <>
            <span aria-hidden>·</span>
            <span className="min-w-0 truncate">{apercu}</span>
          </>
        ) : null}
      </span>
    </button>
  );
}

/**
 * Le tiroir empilé : les champs du type, le projet, la note. Un champ secret
 * est masqué tant qu'on ne demande pas à le voir, et se copie sans jamais
 * s'afficher.
 */
function FicheAcces({
  fiche,
  pieces,
  dossiers,
  onClose,
  onListe,
}: {
  fiche: AccesCoffre | null;
  /** Les images déjà connues du coffre, pour les vignettes de la fiche ouverte. */
  pieces: Attachment[];
  /** Les dossiers où l'on peut ranger la fiche. */
  dossiers: DossierCoffre[];
  onClose: () => void;
  onListe: (data: ReponseDuCoffre) => void;
}) {
  const state = useApp();
  const [nom, setNom] = React.useState('');
  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [dossierId, setDossierId] = React.useState<string | null>(null);
  const [champs, setChamps] = React.useState<Record<string, string>>({});
  const [note, setNote] = React.useState('');
  const [champsLibres, setChampsLibres] = React.useState<ChampLibre[]>([]);
  const [images, setImages] = React.useState<Attachment[]>([]);
  const [enCours, setEnCours] = React.useState(false);
  const [aSupprimer, setASupprimer] = React.useState(false);

  // Le formulaire se REMPLIT à l'ouverture, et seulement là : une frappe en
  // cours ne doit pas se faire écraser par une relecture de la liste.
  React.useEffect(() => {
    if (!fiche) return;
    setNom(fiche.nom);
    setProjectId(fiche.projectId);
    setDossierId(fiche.dossierId ?? null);
    setChamps({ ...fiche.champs });
    setNote(fiche.note);
    setChampsLibres((fiche.champsLibres ?? []).map((c) => ({ ...c })));
    // Une image dont le fichier a disparu n'a plus de vignette : elle sort de
    // la liste, et l'enregistrement suivant ne la cite plus.
    setImages((fiche.images ?? []).map((id) => pieces.find((p) => p.id === id)).filter((p): p is Attachment => !!p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fiche?.id, fiche?.type, fiche]);

  const type = fiche?.type ?? 'autre';
  const archivee = Boolean(fiche?.archiveLe);
  /** Les cases principales encore vides, d'après ce qui est TAPÉ : la mention tombe dès qu'on remplit. */
  const aCompleter = champsACompleter({ type, champs });
  /** Le nom ENREGISTRÉ de la fiche — celui du fil d'Ariane et du grand titre. */
  const titreDeLaFiche = fiche?.id ? fiche.nom || t('Accès') : t('Nouvel accès');

  const enregistrer = async () => {
    if (!fiche) return;
    setEnCours(true);
    try {
      const data = await client.call<ReponseDuCoffre>({
        type: 'coffre.enregistrer',
        acces: {
          id: fiche.id,
          nom,
          type,
          projectId,
          dossierId,
          champs,
          note,
          champsLibres,
          images: images.map((image) => image.id),
        },
      });
      onListe(data);
      client.pushToast('success', t('Accès enregistré.'));
      onClose();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Accès non enregistré'));
    } finally {
      setEnCours(false);
    }
  };

  const supprimer = async () => {
    if (!fiche) return;
    try {
      const data = await client.call<ReponseDuCoffre>({
        type: 'coffre.supprimer',
        id: fiche.id,
      });
      onListe(data);
      client.pushToast('success', t('Accès archivé.'));
      onClose();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Accès non retiré'));
    }
  };

  const restaurer = async () => {
    if (!fiche) return;
    setEnCours(true);
    try {
      const data = await client.call<ReponseDuCoffre>({
        type: 'coffre.restaurer',
        id: fiche.id,
      });
      onListe(data);
      client.pushToast('success', t('Accès restauré.'));
      onClose();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Accès non restauré'));
    } finally {
      setEnCours(false);
    }
  };

  return (
    <>
      <Drawer open={fiche !== null} onClose={onClose} empile>
        {/* LE NOM DE LA FICHE EST LE DERNIER CRAN DU FIL D'ARIANE — « Services ›
            Coffre-fort › son nom » ; son type se pose à droite de la barre
            d'en-tête de la page. */}
        <DialogTitle className="min-w-0 truncate px-3 pb-2">{titreDeLaFiche}</DialogTitle>
        <GestesDePage className="px-3">
          {aCompleter.length && !archivee ? (
            <Badge tone="attention" data-coffre-fiche-a-completer>
              {t('À compléter')}
            </Badge>
          ) : null}
          <Badge tone="neutral">{t(LIBELLE_TYPE_ACCES[type] ?? LIBELLE_TYPE_ACCES.autre)}</Badge>
        </GestesDePage>

        {/* ET IL SE LIT EN GRAND, EN TÊTE DE LA PAGE — le dessin d'un titre de
            page (`TitreDePage`), avec de l'air au-dessus : le formulaire ne
            commence plus collé sous la barre. C'est le nom ENREGISTRÉ, pas celui
            qu'on est en train de taper. LE TITRE DE LA PAGE RESTE UNIQUE : celui
            du fil d'Ariane est lu à voix haute, celui-ci n'en est que le dessin
            (`aria-hidden`), pour ne pas le dire deux fois. */}
        <p
          aria-hidden
          data-grand-titre-de-fiche
          className="shrink-0 break-words px-3 pb-5 pt-5 text-[26px] font-semibold leading-tight tracking-tight text-text sm:pb-6 sm:pt-8"
        >
          {titreDeLaFiche}
        </p>
        {/* Où la fiche est rangée : le chemin complet de son dossier, sous son nom. */}
        {fiche?.dossierId && cheminDuDossier(dossiers, fiche.dossierId).length ? (
          <p className="-mt-3 shrink-0 truncate px-3 pb-4 text-[12.5px] text-faint" data-coffre-fiche-chemin>
            {cheminDuDossier(dossiers, fiche.dossierId).join(SEPARATEUR_AFFICHAGE)}
          </p>
        ) : null}

        <ZoneDefilement fond="hsl(var(--surface))" className="px-3 pb-3">
          <FormulaireEnColonnes data-coffre-fiche>
            <Champ libelle={t('Nom')}>
              <Input
                value={nom}
                onChange={(e) => setNom(e.target.value)}
                maxLength={NOM_ACCES_MAX}
                placeholder={t('Comment reconnaître cet accès')}
                className="h-8 text-[13px]"
                autoComplete="off"
                data-coffre-nom
              />
            </Champ>

            <Champ libelle={t('Projet')}>
              <ListeDeroulante
                valeur={projectId ?? ''}
                titre={t('Projet')}
                repere="coffre-projet"
                data-coffre-projet
                /* Une fiche rangée dans un dossier suit le projet du dossier. */
                desactivee={Boolean(dossierId) || archivee}
                onChoisir={(valeur) => setProjectId(valeur || null)}
                options={[
                  { valeur: '', libelle: t('Général') },
                  /* Les membres d'un projet réuni se rangent sous lui, en retrait. */
                  ...projetsEnArbre(state.projects).map((ligne) => ({
                    valeur: ligne.projet.id,
                    libelle: libelleDansUnMenu(ligne.projet.name, ligne),
                    attributs: { 'data-membre-de': ligne.parentId },
                  })),
                ]}
              />
            </Champ>

            {dossiers.length || dossierId ? (
              <Champ libelle={t('Dossier')}>
                <ListeDeroulante
                  valeur={dossierId ?? ''}
                  titre={t('Dossier')}
                  repere="coffre-dossier"
                  data-coffre-dossier-choix
                  desactivee={archivee}
                  onChoisir={(valeur) => {
                    setDossierId(valeur || null);
                    const choisi = dossiers.find((d) => d.id === valeur);
                    if (choisi) setProjectId(choisi.projectId);
                  }}
                  options={[
                    { valeur: '', libelle: t('Aucun dossier') },
                    ...dossiers
                      .map((d) => ({ valeur: d.id, libelle: cheminDuDossier(dossiers, d.id).join(SEPARATEUR_AFFICHAGE) }))
                      .sort((a, b) => a.libelle.localeCompare(b.libelle)),
                  ]}
                />
              </Champ>
            ) : null}

            {champsDuType(type).map((champ) => (
              <ChampValeur
                key={champ.cle}
                champ={champ}
                valeur={champs[champ.cle] ?? ''}
                onChange={(valeur) => setChamps((avant) => ({ ...avant, [champ.cle]: valeur }))}
              />
            ))}

            <CasesEnPlus cases={champsLibres} onChange={setChampsLibres} figee={archivee} />

            {aCompleter.length && !archivee ? (
              <p className="text-[12px] leading-relaxed text-faint" data-coffre-message-a-completer>
                {t('À compléter : {cases}. La fiche est gardée telle quelle en attendant.', {
                  cases: aCompleter.map((c) => t(c.libelle)).join(` ${t('ou')} `),
                })}
              </p>
            ) : null}

            <Champ libelle={t('Note')}>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder={t('À quoi sert cet accès (aucune valeur ici : chaque valeur a sa case)')}
                className="text-[13px]"
                data-coffre-note
              />
            </Champ>

            <ImagesDeLaFiche images={images} onChange={setImages} figee={archivee} />

            {archivee && fiche ? (
              <p className="text-[12px] leading-relaxed text-faint" data-coffre-archive-info>
                {t('Fiche archivée : elle sera effacée le {date}, sauf si vous la restaurez.', {
                  date: dateEffacement(fiche),
                })}
              </p>
            ) : null}
          </FormulaireEnColonnes>
        </ZoneDefilement>

        <DialogFooter className="justify-start px-3 pt-2">
          {archivee ? (
            <Button variant="subtle" size="sm" onClick={restaurer} disabled={enCours} data-coffre-restaurer>
              {enCours ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArchiveRestore className="h-3 w-3" />}
              {t('Restaurer')}
            </Button>
          ) : (
            <Button
              variant="subtle"
              size="sm"
              onClick={enregistrer}
              disabled={enCours || !nom.trim()}
              data-coffre-enregistrer
            >
              {enCours ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              {t('Enregistrer')}
            </Button>
          )}
          {fiche?.id && !archivee ? (
            <Button variant="ghost" size="sm" onClick={() => setASupprimer(true)} data-coffre-supprimer>
              <Trash2 className="h-3 w-3" />
              {t('Retirer')}
            </Button>
          ) : null}
        </DialogFooter>
      </Drawer>

      <ConfirmDialog
        open={aSupprimer}
        onClose={() => setASupprimer(false)}
        title={t('Retirer cet accès ?')}
        description={t(
          'La fiche part aux archives : elle se restaure pendant six mois, puis elle est effacée pour de bon.',
        )}
        confirmLabel={t('Retirer')}
        danger
        onConfirm={supprimer}
      />
    </>
  );
}

/** Envoie UN fichier au coffre et rend la pièce déposée, ou rien en cas de refus. */
async function envoyerFichierAuCoffre(fichier: File): Promise<Attachment | null> {
  // Le serveur refuse aussi : ce premier refus évite seulement d'envoyer un programme pour rien.
  const refus = refusDuFichierDuCoffre(fichier.type, fichier.name);
  if (refus) {
    client.pushToast('error', t('Le coffre-fort ne prend pas les programmes ({v0}).', { v0: fichier.name }));
    return null;
  }
  try {
    const reponse = await fetch('/api/upload?coffre=1', {
      method: 'POST',
      headers: {
        'content-type': fichier.type || 'application/octet-stream',
        'x-file-name': encodeURIComponent(fichier.name || 'fichier'),
      },
      body: fichier,
    });
    const data = await reponse.json().catch(() => ({}));
    if (!reponse.ok) throw new Error(typeof data?.error === 'string' ? data.error : String(reponse.status));
    return (data.attachment as Attachment) ?? null;
  } catch (err: any) {
    client.pushToast('error', /^\d+$/.test(err?.message ?? '') ? t('Envoi du fichier impossible') : (err?.message ?? t('Envoi du fichier impossible')));
    return null;
  }
}

/** Au-delà, un texte n'est pas lu pour l'aperçu rapide : on n'en demande que le début. */
const DEBUT_DE_TEXTE_OCTETS = 2048;
const estUnTexte = (mime: string) => mime.startsWith('text/') || mime === 'application/json';

/** Le début d'un fichier texte, demandé par une lecture partielle — jamais le fichier entier. */
function DebutDeTexte({ id }: { id: string }) {
  const [texte, setTexte] = React.useState<string | null>(null);
  React.useEffect(() => {
    const arret = new AbortController();
    fetch(adresseDePiece(id), { headers: { range: `bytes=0-${DEBUT_DE_TEXTE_OCTETS - 1}` }, signal: arret.signal })
      .then((r) => (r.ok ? r.text() : ''))
      .then((contenu) => setTexte(contenu.slice(0, 600)))
      .catch(() => {});
    return () => arret.abort();
  }, [id]);
  return (
    <pre className="h-full w-full overflow-hidden whitespace-pre-wrap break-words p-2 text-left font-mono text-[11px] leading-snug text-muted">
      {texte ?? t('Lecture…')}
    </pre>
  );
}

/**
 * L'APERÇU RAPIDE D'UN FICHIER, DANS L'INFOBULLE DE SA LIGNE. L'infobulle ne
 * se monte qu'au survol (et jamais sans pointeur qui survole) : rien de ceci
 * ne se télécharge à l'ouverture de la fiche. Une image en vignette, la
 * première page d'un PDF, la première image d'une vidéo (muette, seulement
 * ses métadonnées), le début d'un texte ; sinon l'icône et le nom.
 */
function ApercuRapide({ piece }: { piece: Attachment }) {
  const genre = genreDuFichier(piece.mime);
  const source = adresseDePiece(piece.id);
  return (
    <span className="flex w-[240px] flex-col gap-1" data-coffre-apercu-rapide={piece.id}>
      <span className="relative flex h-[170px] w-full items-center justify-center overflow-hidden rounded bg-surface">
        {genre === 'image' ? (
          <ImageDePiece id={piece.id} alt={piece.name} className="max-h-full max-w-full object-contain" />
        ) : genre === 'video' ? (
          <video src={`${source}#t=${piece.apercuSeconde ?? 0.1}`} preload="metadata" muted playsInline className="max-h-full max-w-full" />
        ) : piece.mime === 'application/pdf' ? (
          <iframe title={piece.name} src={`${source}#toolbar=0&navpanes=0&view=FitH`} className="h-full w-full" tabIndex={-1} />
        ) : estUnTexte(piece.mime) ? (
          <DebutDeTexte id={piece.id} />
        ) : (
          <IconeDeGenre genre={genre} className="h-8 w-8 text-faint" />
        )}
      </span>
      <span className="truncate text-[12px]">{piece.name}</span>
    </span>
  );
}

/**
 * LES FICHIERS D'UNE FICHE : une LISTE sous les champs — une ligne par fichier,
 * avec l'icône de son genre, son nom et son poids. Le survol d'une ligne
 * montre un aperçu rapide en infobulle ; un clic (ou un toucher, sur
 * téléphone) ouvre la visionneuse, qui feuillette toute la liste et propose
 * de télécharger ce qu'elle ne sait pas montrer. Tout genre de fichier sauf un
 * programme, sans limite de nombre, 1 Go au total. Trois façons d'en ajouter
 * — choisir, glisser, coller. Une fiche archivée (`figee`) les montre sans
 * permettre d'y toucher.
 *
 * Coller marche DANS TOUTE LA FICHE, pas seulement sur cette zone : une
 * capture d'écran se colle d'instinct, sans viser. L'écoute est posée sur le
 * document tant que la fiche est ouverte, et ne prend que les collages qui
 * portent un FICHIER — un texte collé dans un champ suit son chemin.
 */
function ImagesDeLaFiche({
  images,
  onChange,
  figee,
}: {
  images: Attachment[];
  onChange: React.Dispatch<React.SetStateAction<Attachment[]>>;
  figee: boolean;
}) {
  const champ = React.useRef<HTMLInputElement>(null);
  const [envoi, setEnvoi] = React.useState(false);
  const [survol, setSurvol] = React.useState(false);
  const [apercu, setApercu] = React.useState<Attachment | null>(null);
  const poidsActuel = React.useRef(0);
  poidsActuel.current = images.reduce((total, piece) => total + piece.size, 0);
  const total = poidsActuel.current;

  const ajouter = React.useCallback(
    async (fichiers: File[]) => {
      if (!fichiers.length) return;
      setEnvoi(true);
      try {
        let poids = poidsActuel.current;
        for (const fichier of fichiers) {
          // Le plafond d'1 Go se juge avant d'envoyer : rien ne part qui serait refusé à l'enregistrement.
          const tropLourd = refusDuPoidsDeLaFiche(poids + fichier.size);
          if (tropLourd) {
            client.pushToast('error', t('« {v0} » ferait dépasser 1 Go à la fiche : il n’est pas ajouté.', { v0: fichier.name }));
            continue;
          }
          const piece = await envoyerFichierAuCoffre(fichier);
          if (!piece) continue;
          poids += piece.size;
          onChange((avant) => (avant.some((autre) => autre.id === piece.id) ? avant : [...avant, piece]));
        }
      } finally {
        setEnvoi(false);
        if (champ.current) champ.current.value = '';
      }
    },
    [onChange],
  );

  React.useEffect(() => {
    if (figee) return;
    const coller = (e: ClipboardEvent) => {
      // Seulement quand la fiche est à l'écran : ce composant ne vit que là.
      const fichiers = Array.from(e.clipboardData?.files ?? []);
      if (!fichiers.length) return;
      e.preventDefault();
      void ajouter(fichiers);
    };
    document.addEventListener('paste', coller);
    return () => document.removeEventListener('paste', coller);
  }, [ajouter, figee]);

  if (figee && !images.length) return null;

  return (
    <div className="flex flex-col gap-1" data-coffre-images={images.length}>
      <span className="flex items-baseline gap-1.5 text-[12px] font-medium text-muted">
        {t('Fichiers')}
        {images.length ? (
          <span className="font-normal tabular-nums text-faint" data-coffre-poids-total={total}>
            {t('{v0} sur 1 Go', { v0: bytes(total) })}
          </span>
        ) : null}
      </span>
      <div
        onDragOver={(e) => {
          if (figee) return;
          e.preventDefault();
          setSurvol(true);
        }}
        onDragLeave={() => setSurvol(false)}
        onDrop={(e) => {
          if (figee) return;
          e.preventDefault();
          setSurvol(false);
          void ajouter(Array.from(e.dataTransfer.files ?? []));
        }}
        className={cn('flex flex-col gap-0.5 rounded-md bg-bloc p-1 transition-colors', survol && 'bg-raised')}
      >
        {images.map((piece) => (
          <div key={piece.id} className="group flex min-w-0 items-center gap-1 rounded-md hover:bg-raised" data-coffre-image={piece.id}>
            <Tooltip label={<ApercuRapide piece={piece} />}>
              <button
                type="button"
                onClick={() => setApercu(piece)}
                className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 sm:py-1.5 text-left text-[13px] text-text"
                aria-label={piece.name}
                data-coffre-fichier-ouvrir={piece.id}
              >
                <IconeDeGenre genre={genreDuFichier(piece.mime)} className="h-3.5 w-3.5 shrink-0 text-faint" />
                <span className="min-w-0 flex-1 truncate">{piece.name}</span>
                <span className="shrink-0 text-[11.5px] tabular-nums text-faint">{bytes(piece.size)}</span>
              </button>
            </Tooltip>
            <a
              href={adresseDePiece(piece.id, true)}
              download={piece.name}
              title={t('Télécharger')}
              aria-label="Telecharger"
              className="grid h-8 w-8 sm:h-7 sm:w-7 shrink-0 place-items-center rounded-md text-faint transition-colors hover:text-text"
            >
              <Download className="h-3.5 w-3.5" />
            </a>
            {figee ? null : (
              <button
                type="button"
                onClick={() => onChange((avant) => avant.filter((autre) => autre.id !== piece.id))}
                className="grid h-8 w-8 sm:h-7 sm:w-7 shrink-0 place-items-center rounded-md text-faint transition-colors hover:text-text"
                aria-label="Retirer ce fichier"
                title={t('Retirer ce fichier')}
                data-coffre-image-retirer={piece.id}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
        {figee ? null : (
          <button
            type="button"
            onClick={() => champ.current?.click()}
            disabled={envoi}
            className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-md px-2 py-2 text-center text-[12px] leading-tight text-faint transition-colors hover:bg-raised hover:text-text disabled:opacity-60"
            data-coffre-image-ajouter
          >
            {envoi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FilePlus className="h-3.5 w-3.5" />}
            {images.length ? t('Ajouter un fichier') : t('Choisir, glisser ou coller un fichier')}
          </button>
        )}
      </div>
      <input
        ref={champ}
        type="file"
        multiple
        hidden
        onChange={(e) => void ajouter(Array.from(e.target.files ?? []))}
        data-coffre-image-champ
      />
      <AttachmentPreview item={apercu} onClose={() => setApercu(null)} galerie={images} onNaviguer={setApercu} />
    </div>
  );
}

/** Une ligne de la fiche : son libellé au-dessus de sa valeur (`LigneFormulaire`). */
function Champ({ libelle, children }: { libelle: string; children: React.ReactNode }) {
  return <LigneFormulaire libelle={libelle}>{children}</LigneFormulaire>;
}

/**
 * LES CASES EN PLUS : ce qu'aucune case du modèle ne prévoit, nommé par celui
 * qui le remplit. Chaque case a son nom, sa valeur, et peut être SECRÈTE
 * (masquée, hors recherche). Une case sans valeur n'est pas gardée.
 */
function CasesEnPlus({
  cases,
  onChange,
  figee,
}: {
  cases: ChampLibre[];
  onChange: React.Dispatch<React.SetStateAction<ChampLibre[]>>;
  figee: boolean;
}) {
  const changer = (index: number, partiel: Partial<ChampLibre>) =>
    onChange((avant) => avant.map((c, i) => (i === index ? { ...c, ...partiel } : c)));
  if (figee && !cases.length) return null;
  return (
    <div className="flex flex-col gap-2" data-coffre-cases-en-plus={cases.length}>
      {cases.length ? <span className="text-[12.5px] font-medium text-muted">{t('Cases en plus')}</span> : null}
      {cases.map((c, index) => (
        <div key={index} className="flex flex-col gap-1" data-coffre-case-en-plus={index}>
          <div className="flex items-center gap-1.5">
            <Input
              value={c.libelle}
              onChange={(e) => changer(index, { libelle: e.target.value })}
              maxLength={LIBELLE_CHAMP_LIBRE_MAX}
              placeholder={t('Nom de la case')}
              className="h-7 flex-1 text-[12px]"
              autoComplete="off"
              disabled={figee}
              data-coffre-case-libelle
            />
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              aria-pressed={c.secret === true}
              aria-label="Valeur secrète"
              title={c.secret ? t('Valeur secrète : masquée, hors recherche') : t('Rendre la valeur secrète')}
              onClick={() => changer(index, { secret: !c.secret })}
              disabled={figee}
              data-coffre-case-secrete={c.secret ? 'oui' : 'non'}
            >
              <Lock className={cn('h-3.5 w-3.5', !c.secret && 'opacity-40')} />
            </Button>
            {!figee ? (
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                aria-label="Retirer la case"
                title={t('Retirer la case')}
                onClick={() => onChange((avant) => avant.filter((_, i) => i !== index))}
                data-coffre-case-retirer
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
          <ChampValeur
            champ={{ cle: `libre-${index}`, libelle: '', secret: c.secret === true }}
            valeur={c.valeur}
            onChange={(valeur) => changer(index, { valeur })}
            sansLibelle
          />
        </div>
      ))}
      {!figee && cases.length < CHAMPS_LIBRES_MAX ? (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => onChange((avant) => [...avant, { libelle: '', valeur: '' }])}
          data-coffre-ajouter-case
        >
          <Plus className="h-3 w-3" />
          {t('Ajouter une case')}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Un champ de la fiche. Secret, il est masqué par défaut : un œil le dévoile,
 * un bouton le copie sans qu'il ait jamais à s'afficher.
 */
function ChampValeur({
  champ,
  valeur,
  onChange,
  sansLibelle,
}: {
  champ: ChampAcces;
  valeur: string;
  onChange: (valeur: string) => void;
  /** Une case en plus porte son nom au-dessus, dans son propre champ. */
  sansLibelle?: boolean;
}) {
  const [visible, setVisible] = React.useState(false);
  const masque = champ.secret === true && !visible;

  const copier = () => {
    void navigator.clipboard?.writeText(valeur);
    client.pushToast('success', t('Copié'));
  };

  const saisie = (
      <div className="flex items-start gap-1.5">
        {champ.multiligne && !masque ? (
          <Textarea
            value={valeur}
            onChange={(e) => onChange(e.target.value)}
            rows={3}
            placeholder={champ.exemple}
            className={cn('flex-1 text-[13px]', champ.secret && 'font-mono')}
            data-coffre-champ={champ.cle}
          />
        ) : (
          <Input
            type={masque ? 'password' : 'text'}
            value={valeur}
            onChange={(e) => onChange(e.target.value)}
            placeholder={champ.exemple}
            className={cn('h-8 flex-1 text-[13px]', champ.secret && 'font-mono')}
            autoComplete="off"
            data-coffre-champ={champ.cle}
          />
        )}
        {champ.secret ? (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label={visible ? 'Masquer' : 'Afficher'}
            title={visible ? t('Masquer') : t('Afficher')}
            onClick={() => setVisible((v) => !v)}
            data-coffre-oeil={champ.cle}
          >
            {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </Button>
        ) : null}
        {valeur ? (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label="Copier"
            title={t('Copier')}
            onClick={copier}
            data-coffre-copier={champ.cle}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
  );
  return sansLibelle ? saisie : <Champ libelle={t(champ.libelle)}>{saisie}</Champ>;
}
