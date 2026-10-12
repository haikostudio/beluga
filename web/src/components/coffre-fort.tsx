import { useTiroirAdresse } from '@/lib/tiroirs-adresse';
import * as React from 'react';
import {
  Archive,
  ArchiveRestore,
  Asterisk,
  Check,
  Copy,
  Database,
  Eye,
  EyeOff,
  ImagePlus,
  Images,
  KeyRound,
  Loader2,
  Lock,
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
  ChampAcces,
  IMAGES_ACCES_MAX,
  LIBELLE_TYPE_ACCES,
  NOM_ACCES_MAX,
  TYPES_ACCES,
  TypeAcces,
  apercuAcces,
  champsDuType,
  echeanceArchive,
  filtrerAcces,
  libelleDansUnMenu,
  projetsEnArbre,
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
} from '@/components/ui';
import { SilhouetteCoffre } from '@/components/silhouettes';
import { BoutonPrincipal, GestePrincipal, GestesDePage, OptionDePage, OptionsDePage } from '@/components/entete-de-zone';
import { CLASSE_SECTION_DE_SERVICE, ColonneDeService, useColonneDeService } from '@/components/colonne-de-service';
import { GesteDeCreationDeColonne, RubriqueDeColonne } from '@/components/rubriques-de-colonne';
import { AttachmentPreview } from '@/components/attachment-preview';
import { ImageDePiece } from '@/components/pastille-de-fichier';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { formatRegional, t } from '@/lib/langue';
import { cn } from '@/lib/utils';
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
  };
}

/** L'icône de chaque type d'accès, dans la colonne de gauche. */
const ICONE_DU_TYPE: Readonly<Record<TypeAcces, React.ReactNode>> = {
  'cle-api': <KeyRound />,
  'mot-de-passe': <Lock />,
  ssh: <Terminal />,
  jeton: <Ticket />,
  'base-de-donnees': <Database />,
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
  /* Le tiroir des archives : une COUCHE de plus, pas une autre liste à la
     place de celle-ci. Sa recherche est la sienne — partager celle du fond
     ferait disparaître des lignes derrière, sans raison visible. */
  const [archivesOuvertes, setArchivesOuvertes] = React.useState(false);
  useTiroirAdresse('archives-coffre', archivesOuvertes, setArchivesOuvertes);
  const [recherche, setRecherche] = React.useState('');
  /* VRAI DÈS LE PREMIER RENDU : l'effet qui lit le coffre ne tourne qu'APRÈS,
     et l'écran annonçait « aucun accès enregistré » le temps d'une image. */
  const [chargement, setChargement] = React.useState(true);
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

  // La liste se relit à CHAQUE ouverture : un accès posé depuis un autre onglet
  // ou par un agent doit être là, sans recharger la page.
  React.useEffect(() => {
    if (!open) return;
    let vivant = true;
    setChargement(true);
    client
      .call<ReponseDuCoffre>({
        type: 'coffre.lister',
      })
      .then((data) => {
        if (!vivant) return;
        setListe(data.acces ?? []);
        setArchives(data.archives ?? []);
        setPieces(data.pieces ?? []);
      })
      .catch((err: any) => client.pushToast('error', err?.message ?? t('Coffre-fort illisible')))
      .finally(() => {
        if (vivant) setChargement(false);
      });
    return () => {
      vivant = false;
    };
  }, [open]);

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

  const visibles = filtrerAcces(liste, recherche, nomProjet).filter((acces) => !typeRetenu || acces.type === typeRetenu);
  /* Les types qui ont au moins un accès, et celui qui est retenu : un type
     vide n'est pas une rubrique à proposer. */
  const typesPresents = TYPES_ACCES.filter((type) => type === typeRetenu || liste.some((acces) => acces.type === type));
  const creerUnAcces = (type: TypeAcces) => setFiche(ficheVierge(type, state.activeProjectId ?? null));
  const recevoir = (nouvelle: AccesCoffre[], nouvellesArchives?: AccesCoffre[], nouvellesPieces?: Attachment[]) => {
    setListe(nouvelle);
    if (nouvellesArchives) setArchives(nouvellesArchives);
    if (nouvellesPieces) setPieces(nouvellesPieces);
  };

  return (
    <>
      <Drawer open={open} onClose={onClose} enPage={enPage}>
        <TitreDePage>{t('Coffre-fort')}</TitreDePage>
        {dansLaColonne ? null : (
          <>
          {/* SUR TÉLÉPHONE : « Archives » est une ligne du menu à trois points,
              « Nouvel accès » le bouton du bas de l'écran — il y ouvre la même
              liste des types d'accès. */}
          <OptionsDePage>
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

        <div className="shrink-0 pb-5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <Input
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder={t('Chercher par nom, projet ou type…')}
              className="h-10 rounded-xl pl-10 text-[14px]"
              autoComplete="off"
              data-coffre-recherche
            />
          </div>
        </div>

        <ZoneDefilement fond="hsl(var(--bg))" className="pb-6">
          {chargement && !liste.length ? (
            /* Les accès à venir en silhouette, jamais une phrase d'attente :
               l'état vide ne se dit qu'une fois la liste réellement reçue. */
            <SilhouetteCoffre />
          ) : !visibles.length ? (
            <p className="px-1 py-3 text-[12.5px] text-faint">
              {recherche || typeRetenu ? t('Aucun accès ne correspond.') : t('Aucun accès enregistré pour l’instant.')}
            </p>
          ) : (
            <div className={CLASSE_GROUPE_DE_LIGNES} data-coffre-liste="actifs">
              {visibles.map((acces) => (
                <LigneAcces
                  key={acces.id}
                  acces={acces}
                  projet={nomProjet(acces.projectId)}
                  onOuvrir={() => setFiche(acces)}
                />
              ))}
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
        nomProjet={nomProjet}
        onOuvrir={setFiche}
      />

      {/* Le détail : empilé par-dessus la liste — ou par-dessus les archives. */}
      <FicheAcces fiche={fiche} pieces={pieces} onClose={() => setFiche(null)} onListe={recevoir} />
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
  nomProjet,
  onOuvrir,
}: {
  open: boolean;
  onClose: () => void;
  archives: AccesCoffre[];
  nomProjet: (projectId: string | null) => string | undefined;
  onOuvrir: (acces: AccesCoffre) => void;
}) {
  const [recherche, setRecherche] = React.useState('');
  /* La recherche repart à blanc à chaque ouverture : un filtre oublié d'une
     fois sur l'autre ferait croire à des archives disparues. */
  React.useEffect(() => {
    if (!open) setRecherche('');
  }, [open]);

  const visibles = filtrerAcces(archives, recherche, nomProjet);

  return (
    <Drawer open={open} onClose={onClose} empile>
      <header className="flex shrink-0 flex-wrap items-center gap-2 px-3 pb-2">
        <Archive className="h-3.5 w-3.5 shrink-0 text-accent" />
        <DialogTitle className="min-w-0 flex-1 truncate">{t('Archives du coffre-fort')}</DialogTitle>
        {archives.length ? <Badge tone="neutral">{archives.length}</Badge> : null}
        <BulleInfo>{t('Une fiche retirée reste ici six mois, puis elle est effacée pour de bon.')}</BulleInfo>
      </header>

      <div className="shrink-0 px-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
          <Input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder={t('Chercher par nom, projet ou type…')}
            className="h-8 pl-7 text-[13px]"
            autoComplete="off"
            data-coffre-recherche-archives
          />
        </div>
      </div>

      <ZoneDefilement fond="hsl(var(--surface))" className="px-2 pb-3">
        {!visibles.length ? (
          <p className="px-1 py-3 text-[12.5px] text-faint">
            {recherche ? t('Aucun accès ne correspond.') : t('Aucune fiche archivée.')}
          </p>
        ) : (
          <div className="flex flex-col gap-1" data-coffre-liste="archives">
            {visibles.map((acces) => (
              <LigneAcces
                key={acces.id}
                acces={acces}
                projet={nomProjet(acces.projectId)}
                onOuvrir={() => onOuvrir(acces)}
              />
            ))}
          </div>
        )}
      </ZoneDefilement>
    </Drawer>
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
            title={t('Images jointes')}
            data-coffre-nombre-images={acces.images.length}
          >
            <Images className="h-3 w-3" />
            {acces.images.length}
          </span>
        ) : null}
        <Badge tone="neutral">{t(LIBELLE_TYPE_ACCES[acces.type])}</Badge>
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
  onClose,
  onListe,
}: {
  fiche: AccesCoffre | null;
  /** Les images déjà connues du coffre, pour les vignettes de la fiche ouverte. */
  pieces: Attachment[];
  onClose: () => void;
  onListe: (liste: AccesCoffre[], archives?: AccesCoffre[], pieces?: Attachment[]) => void;
}) {
  const state = useApp();
  const [nom, setNom] = React.useState('');
  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [champs, setChamps] = React.useState<Record<string, string>>({});
  const [note, setNote] = React.useState('');
  const [images, setImages] = React.useState<Attachment[]>([]);
  const [enCours, setEnCours] = React.useState(false);
  const [aSupprimer, setASupprimer] = React.useState(false);

  // Le formulaire se REMPLIT à l'ouverture, et seulement là : une frappe en
  // cours ne doit pas se faire écraser par une relecture de la liste.
  React.useEffect(() => {
    if (!fiche) return;
    setNom(fiche.nom);
    setProjectId(fiche.projectId);
    setChamps({ ...fiche.champs });
    setNote(fiche.note);
    // Une image dont le fichier a disparu n'a plus de vignette : elle sort de
    // la liste, et l'enregistrement suivant ne la cite plus.
    setImages((fiche.images ?? []).map((id) => pieces.find((p) => p.id === id)).filter((p): p is Attachment => !!p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fiche?.id, fiche?.type, fiche]);

  const type = fiche?.type ?? 'autre';
  const archivee = Boolean(fiche?.archiveLe);
  /** Le nom ENREGISTRÉ de la fiche — celui du fil d'Ariane et du grand titre. */
  const titreDeLaFiche = fiche?.id ? fiche.nom || t('Accès') : t('Nouvel accès');

  const enregistrer = async () => {
    if (!fiche) return;
    setEnCours(true);
    try {
      const data = await client.call<ReponseDuCoffre>({
        type: 'coffre.enregistrer',
        acces: { id: fiche.id, nom, type, projectId, champs, note, images: images.map((image) => image.id) },
      });
      onListe(data.liste ?? [], data.archives, data.pieces);
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
      onListe(data.liste ?? [], data.archives, data.pieces);
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
      onListe(data.liste ?? [], data.archives, data.pieces);
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
          <Badge tone="neutral">{t(LIBELLE_TYPE_ACCES[type])}</Badge>
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

            {champsDuType(type).map((champ) => (
              <ChampValeur
                key={champ.cle}
                champ={champ}
                valeur={champs[champ.cle] ?? ''}
                onChange={(valeur) => setChamps((avant) => ({ ...avant, [champ.cle]: valeur }))}
              />
            ))}

            <Champ libelle={t('Note')}>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder={t('À quoi sert cet accès, où il s’utilise…')}
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

/** Envoie UNE image au coffre et rend la pièce déposée, ou rien en cas de refus. */
async function envoyerImageAuCoffre(fichier: File): Promise<Attachment | null> {
  if (!fichier.type.startsWith('image/')) {
    client.pushToast('error', t('Le coffre-fort ne prend que des images.'));
    return null;
  }
  try {
    const reponse = await fetch('/api/upload?coffre=1', {
      method: 'POST',
      headers: {
        'content-type': fichier.type,
        'x-file-name': encodeURIComponent(fichier.name || 'image.png'),
      },
      body: fichier,
    });
    const data = await reponse.json().catch(() => ({}));
    if (!reponse.ok) throw new Error(typeof data?.error === 'string' ? data.error : String(reponse.status));
    return (data.attachment as Attachment) ?? null;
  } catch (err: any) {
    client.pushToast('error', /^\d+$/.test(err?.message ?? '') ? t('Envoi de l’image impossible') : (err?.message ?? t('Envoi de l’image impossible')));
    return null;
  }
}

/**
 * LES IMAGES D'UNE FICHE : des vignettes sous les champs, qui s'ouvrent en
 * grand, et trois façons d'en ajouter — choisir, glisser, coller. Une fiche
 * archivée (`figee`) les montre sans permettre d'y toucher.
 *
 * Coller marche DANS TOUTE LA FICHE, pas seulement sur cette zone : une
 * capture d'écran se colle d'instinct, sans viser. L'écoute est posée sur le
 * document tant que la fiche est ouverte, et ne prend que les collages qui
 * portent une image — un texte collé dans un champ suit son chemin.
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
  const pleine = images.length >= IMAGES_ACCES_MAX;

  const ajouter = React.useCallback(
    async (fichiers: File[]) => {
      const retenus = fichiers.filter((f) => f.type.startsWith('image/'));
      if (!retenus.length) return;
      setEnvoi(true);
      try {
        for (const fichier of retenus) {
          const piece = await envoyerImageAuCoffre(fichier);
          if (!piece) continue;
          onChange((avant) =>
            avant.some((image) => image.id === piece.id) || avant.length >= IMAGES_ACCES_MAX ? avant : [...avant, piece],
          );
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
      const fichiers = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
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
      <span className="text-[12px] font-medium text-muted">{t('Images')}</span>
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
        className={cn(
          'flex flex-wrap items-start gap-2 rounded-md bg-bloc p-2 transition-colors',
          survol && 'bg-raised',
        )}
      >
        {images.map((image) => (
          <span key={image.id} className="relative block h-[72px] w-[72px] shrink-0" data-coffre-image={image.id}>
            <button
              type="button"
              onClick={() => setApercu(image)}
              className="relative block h-full w-full overflow-hidden rounded-md bg-raised"
              aria-label={image.name}
              title={image.name}
            >
              <ImageDePiece id={image.id} alt={image.name} className="h-full w-full object-cover" />
            </button>
            {figee ? null : (
              <button
                type="button"
                onClick={() => onChange((avant) => avant.filter((autre) => autre.id !== image.id))}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-surface text-muted shadow-sm transition-colors hover:text-text"
                aria-label="Retirer cette image"
                title={t('Retirer cette image')}
                data-coffre-image-retirer={image.id}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
        {figee || pleine ? null : (
          <button
            type="button"
            onClick={() => champ.current?.click()}
            disabled={envoi}
            className="flex h-[72px] min-w-[72px] flex-1 flex-col items-center justify-center gap-1 rounded-md bg-raised px-2 text-center text-[12px] leading-tight text-faint transition-colors hover:bg-border hover:text-text disabled:opacity-60"
            data-coffre-image-ajouter
          >
            {envoi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
            {images.length ? t('Ajouter une image') : t('Choisir, glisser ou coller une image')}
          </button>
        )}
      </div>
      <input
        ref={champ}
        type="file"
        accept="image/*"
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
 * Un champ de la fiche. Secret, il est masqué par défaut : un œil le dévoile,
 * un bouton le copie sans qu'il ait jamais à s'afficher.
 */
function ChampValeur({
  champ,
  valeur,
  onChange,
}: {
  champ: ChampAcces;
  valeur: string;
  onChange: (valeur: string) => void;
}) {
  const [visible, setVisible] = React.useState(false);
  const masque = champ.secret === true && !visible;

  const copier = () => {
    void navigator.clipboard?.writeText(valeur);
    client.pushToast('success', t('Copié'));
  };

  return (
    <Champ libelle={t(champ.libelle)}>
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
    </Champ>
  );
}
