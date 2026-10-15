import * as React from 'react';
import {
  CalendarClock,
  Check,
  ChevronLeft,
  ListFilter,
  Loader2,
  NotebookPen,
  Paperclip,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  ZoneDefilement,
  ListeDeroulante,
} from '@/components/ui';
import { AttachmentPreview, AttachmentThumb } from '@/components/attachment-preview';
import { EditeurRiche } from '@/components/editeur-riche';
import { SilhouetteNotes } from '@/components/silhouettes';
import { BoutonPrincipal, CranDuFil, GestePrincipal, SuiteDuFil } from '@/components/entete-de-zone';
import { ColonneDeService, useColonneDeService } from '@/components/colonne-de-service';
import { GesteDeCreationDeColonne } from '@/components/rubriques-de-colonne';
import { client } from '@/lib/client';
import { useImagesVues } from '@/lib/use-images-vues';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';
import { PasAPas } from '@/components/pas-a-pas';
import { cn } from '@/lib/utils';
import {
  IMPORTANCES_NOTE,
  LIBELLES_IMPORTANCE,
  LIBELLES_TRI,
  TRIS_NOTE,
  TRI_PAR_DEFAUT,
  capturesDuFlux,
  echeanceDepassee,
  extraitDeNote,
  filtrerEtTrierNotes,
  libelleDansUnMenu,
  projetsEnArbre,
  type Attachment,
  type ImportanceNote,
  type Note,
  type TriNote,
} from '@beluga/shared';
import { useElementAdresse } from '@/lib/adresse-element';

/**
 * LA PAGE DES NOTES — deux volets, à la manière d'un carnet.
 *
 * À GAUCHE, la liste : une carte par note, avec son projet, son échéance et son
 * importance. À DROITE, la note ouverte : son titre, ses repères, et un éditeur
 * riche où l'on écrit directement mis en forme (`editeur-riche.tsx`). Il n'y a
 * plus de tiroir de formulaire : on clique une note, on écrit, c'est tout.
 *
 * CE QUI EST ENREGISTRÉ EST DU MARKDOWN (`shared/src/editeur-riche.ts`) : le
 * champ `description` d'une note porte désormais sa mise en page, sans que la
 * base change de forme.
 *
 * L'ENREGISTREMENT EST AUTOMATIQUE, une seconde après la dernière frappe : on
 * ne perd pas une note parce qu'on a changé d'écran. Le bandeau du haut dit
 * toujours où en est ce qu'on vient de taper.
 *
 * TOUT LE FILTRAGE EST LOCAL (`filtrerEtTrierNotes`) : le démon rend toutes les
 * notes une fois, taper une lettre ne redemande rien.
 */

/** Le ton d'une importance, en jetons du thème — jamais une couleur écrite en dur. */
const TON_IMPORTANCE: Record<ImportanceNote, string> = {
  haute: 'bg-danger/10 text-danger',
  moyenne: 'bg-raised text-text',
  basse: 'bg-raised text-muted',
  aucune: 'text-faint',
};

/** Le délai d'écriture : assez court pour ne rien perdre, assez long pour ne pas marteler. */
const DELAI_ENREGISTREMENT = 900;

function dateCourte(instant: number | null): string {
  if (instant === null) return '';
  return new Date(instant).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** Un instant en valeur de champ « datetime-local », dans l'heure de la machine. */
function versChamp(instant: number | null): string {
  if (instant === null) return '';
  const d = new Date(instant - new Date(instant).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

export function NotesPage({
  projectId,
  vise,
  onVise,
}: {
  projectId: string | null;
  /** LA NOTE DÉSIGNÉE PAR L'ADRESSE : « #notes/<id> ». */
  vise?: string | null;
  /** …et la note ouverte, remontée pour que l'adresse la décrive. */
  onVise?: (noteId: string | null) => void;
}) {
  const state = useApp();
  const [notes, setNotes] = React.useState<Note[]>([]);
  const [pieces, setPieces] = React.useState<Attachment[]>([]);
  const [chargement, setChargement] = React.useState(true);
  const [demande, setDemande] = React.useState('');
  const [tri, setTri] = React.useState<TriNote>(TRI_PAR_DEFAUT);
  const [filtreProjet, setFiltreProjet] = React.useState<string | null>(null);
  const [ouverte, setOuverte] = React.useState<string | null>(null);
  const [apercu, setApercu] = React.useState<Attachment | null>(null);
  const [galerieDApercu, setGalerieDApercu] = React.useState<Attachment[]>([]);

  /*
   * L'ŒIL « DÉJÀ VUE » des images d'une note : le même mécanisme que la bande
   * « Ce que l'agent a vu » (`useImagesVues`). Ouvrir une image en grand, ou la
   * feuilleter, la marque ; l'œil se pose sur sa vignette. Pas de filtre ici.
   */
  const imagesDesNotes = React.useMemo(() => pieces.filter((p) => p.mime.startsWith('image/')), [pieces]);
  const capturesDesNotes = React.useMemo(() => capturesDuFlux([], imagesDesNotes), [imagesDesNotes]);
  const captureDe = React.useMemo(
    () => new Map(capturesDesNotes.flatMap((c) => (c.genre === 'jointe' ? [[c.id, c] as const] : []))),
    [capturesDesNotes],
  );
  const vues = useImagesVues(capturesDesNotes);
  const { ouvrirEnMarquant, dejaVue, dejaVueAvantOuverture } = vues;
  const pieceVue = React.useCallback(
    (piece: Attachment) => {
      const c = captureDe.get(piece.id);
      return !!c && dejaVue(c);
    },
    [captureDe, dejaVue],
  );
  const pieceVueAvantOuverture = React.useCallback(
    (piece: Attachment) => {
      const c = captureDe.get(piece.id);
      return c ? dejaVueAvantOuverture(c) : false;
    },
    [captureDe, dejaVueAvantOuverture],
  );
  const ouvrirPiece = React.useCallback(
    (piece: Attachment) => {
      ouvrirEnMarquant(captureDe.get(piece.id));
      setApercu(piece);
    },
    [captureDe, ouvrirEnMarquant],
  );

  const recevoir = React.useCallback((data: { notes?: Note[]; pieces?: Attachment[] }) => {
    setNotes(data.notes ?? []);
    setPieces(data.pieces ?? []);
  }, []);

  React.useEffect(() => {
    let vivant = true;
    client
      .call<{ notes: Note[]; pieces: Attachment[] }>({ type: 'notes.lister' })
      .then((data) => {
        if (vivant) recevoir(data);
      })
      .catch((err: any) => client.pushToast('error', err?.message ?? t('Notes illisibles')))
      .finally(() => {
        if (vivant) setChargement(false);
      });
    return () => {
      vivant = false;
    };
  }, [recevoir]);

  const nomDuProjet = React.useCallback(
    (id: string) => state.projects.find((p) => p.id === id)?.name ?? '',
    [state.projects],
  );

  const visibles = React.useMemo(
    () => filtrerEtTrierNotes(notes, { demande, projectId: filtreProjet, tri, nomDuProjet }),
    [notes, demande, filtreProjet, tri, nomDuProjet],
  );

  const noteOuverte = React.useMemo(
    () => notes.find((n) => n.id === ouverte) ?? null,
    [notes, ouverte],
  );

  /*
   * L'ADRESSE SUIT LA NOTE OUVERTE. Le filtre de projet et le tri, eux, restent
   * DEHORS : ce sont des réglages de lecture, pas un endroit qu'on partage — et
   * les mettre dans l'adresse empilerait une entrée d'historique à chaque clic
   * de tri. Une note visée par un lien se montre même si le filtre courant la
   * cacherait : on lève donc le filtre de projet pour elle.
   */
  useElementAdresse({
    vise,
    onVise,
    ouvertId: ouverte,
    pret: !chargement,
    absent: t('Cette note n’existe plus.'),
    ouvrir: (id) => {
      const note = notes.find((n) => n.id === id);
      if (!note) return false;
      setFiltreProjet((filtre) => (filtre && filtre !== note.projectId ? null : filtre));
      setOuverte(id);
      return true;
    },
  });

  const pieceDe = React.useCallback(
    (id: string) => pieces.find((p) => p.id === id) ?? null,
    [pieces],
  );

  const supprimer = async (note: Note) => {
    try {
      const data = await client.call<{ notes: Note[]; pieces: Attachment[] }>({
        type: 'notes.supprimer',
        id: note.id,
      });
      recevoir(data);
      if (ouverte === note.id) setOuverte(null);
      client.pushToast('success', t('Note retirée.'));
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Note non retirée'));
    }
  };

  /** Une note NEUVE part vide, sur le projet regardé, et s'ouvre aussitôt. */
  const [creation, setCreation] = React.useState(false);
  const creer = async () => {
    const projet = filtreProjet ?? projectId ?? state.projects[0]?.id;
    if (!projet || creation) return;
    setCreation(true);
    const avant = new Set(notes.map((n) => n.id));
    try {
      const data = await client.call<{ notes: Note[]; pieces: Attachment[] }>({
        type: 'notes.enregistrer',
        note: {
          projectId: projet,
          titre: t('Nouvelle note'),
          description: '',
          echeance: null,
          importance: 'aucune',
          piecesJointes: [],
        },
      });
      recevoir(data);
      // La note créée est celle qui n'existait pas avant l'appel — pas une
      // supposition sur la date de création.
      const neuve =
        (data.notes ?? []).find((n) => n.projectId === projet && !avant.has(n.id)) ??
        (data.notes ?? []).filter((n) => n.projectId === projet).sort((a, b) => b.creeLe - a.creeLe)[0];
      if (neuve) setOuverte(neuve.id);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Note non enregistrée'));
    } finally {
      setCreation(false);
    }
  };

  /* SUR ORDINATEUR, LA LISTE DES NOTES PREND LA COLONNE DE GAUCHE, à la place
     des projets ; la zone principale ne montre que la note ouverte. */
  const dansLaColonne = useColonneDeService();

  return (
    <div className="flex h-full min-h-0" data-page-notes>
      {/* LE VOLET DE GAUCHE : la liste des notes, en cartes.
          Sur téléphone les deux volets ne tiennent pas côte à côte : la liste
          s'efface dès qu'une note est ouverte, et une flèche y ramène. */}
      <VoletDesNotes dansLaColonne={dansLaColonne} cache={!!noteOuverte}>
        <div className="shrink-0 pt-1">
          <h1 className="sr-only">{t('Notes')}</h1>
          {/* SUR TÉLÉPHONE, « NOUVELLE NOTE » EST LE BOUTON DU BAS DE L'ÉCRAN —
              tant qu'on regarde la liste : une note ouverte reprend la place,
              le bas de l'écran ne porte jamais deux choses. */}
          {/* SUR ORDINATEUR, LE GESTE QUI CRÉE EST EN TÊTE DE LA COLONNE, noir et
              détaché, comme dans les autres colonnes (demande du 12/10/2026). */}
          {dansLaColonne ? (
            <GesteDeCreationDeColonne
              libelle={t('Nouvelle note')}
              data-ajouter-note
              aria-label="Ajouter une note"
              disabled={!state.projects.length || creation}
              enCours={creation}
              onClick={() => void creer()}
            />
          ) : !noteOuverte ? (
            <GestePrincipal>
              <BoutonPrincipal
                data-ajouter-note
                aria-label="Ajouter une note"
                disabled={!state.projects.length || creation}
                onClick={() => void creer()}
              >
                <Plus className="h-3.5 w-3.5" />
                {t('Nouvelle note')}
              </BoutonPrincipal>
            </GestePrincipal>
          ) : null}

          {/* LA RECHERCHE ET, À SA DROITE, LE TRI : un bouton d'icône sans
              libellé, sur la même rangée. Le tri retenu se lit dans son menu
              (en violet, coché) et sur le bouton, pour une machine
              (`data-tri-notes`). */}
          <div className="flex items-center gap-1.5">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
              <Input
                value={demande}
                aria-label="Rechercher une note"
                placeholder={t('Rechercher…')}
                className="h-9 rounded-lg pl-10 text-[14px]"
                data-recherche-notes
                onChange={(event) => setDemande(event.target.value)}
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  title={t('Trier les notes')}
                  aria-label="Trier les notes"
                  data-tri-notes={tri}
                >
                  <ListFilter className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {TRIS_NOTE.map((cle) => (
                  <DropdownMenuItem
                    key={cle}
                    onSelect={() => setTri(cle)}
                    data-tri={cle}
                    data-actif={cle === tri ? '' : undefined}
                    aria-current={cle === tri ? 'true' : undefined}
                    className={cn(cle === tri && 'text-teinte')}
                  >
                    <span className="min-w-0 flex-1">{t(LIBELLES_TRI[cle])}</span>
                    <Check className={cn('h-3.5 w-3.5 shrink-0 text-teinte', cle !== tri && 'invisible')} aria-hidden />
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className={cn('px-2', !dansLaColonne && '-ml-2')} aria-label="Filtrer par projet" data-filtre-projet>
                  {filtreProjet ? nomDuProjet(filtreProjet) : t('Tous les projets')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => setFiltreProjet(null)}>
                  {t('Tous les projets')}
                </DropdownMenuItem>
                {/* Les membres d'un projet réuni se rangent sous lui, en retrait. */}
                {projetsEnArbre(state.projects).map((ligne) => (
                  <DropdownMenuItem
                    key={ligne.projet.id}
                    data-membre-de={ligne.parentId}
                    onSelect={() => setFiltreProjet(ligne.projet.id)}
                  >
                    {libelleDansUnMenu(ligne.projet.name, ligne)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* SUR TÉLÉPHONE, LE TEXTE D'UNE NOTE TOMBE SUR LA MARGE DE LA PAGE, comme
            le champ de recherche : la ligne garde son retrait de 14 px pour son
            fond de survol, et la liste déborde d'autant. */}
        <ZoneDefilement className={cn('min-h-0 flex-1 pb-6 pt-2', !dansLaColonne && '-mx-3.5')}>
          {chargement ? (
            /* PAS DE PHRASE D'ATTENTE : la liste à venir se dessine en
               silhouette, et l'état vide (« Aucune note pour l'instant »)
               attend d'être VRAI pour paraître. */
            <SilhouetteNotes />
          ) : !visibles.length ? (
            notes.length ? (
              <EmptyState
                icon={<NotebookPen className="h-5 w-5" />}
                title={t('Aucune note ne correspond')}
                hint={t('Changez la recherche ou le filtre de projet.')}
              />
            ) : (
              <PasAPas
                repere="notes"
                icone={<NotebookPen className="h-6 w-6" />}
                titre={t('Aucune note pour l’instant')}
                explication={t('Une note garde une idée, une échéance, un fichier — sans passer par le tableau.')}
                etapes={[
                  t('Écrivez une note : une idée, un rappel, un document à garder.'),
                  t('Rattachez-la à un projet si elle le concerne.'),
                  t('Retrouvez-la ici, avec celles du même projet.'),
                ]}
              />
            )
          ) : (
            <ul className="flex flex-col gap-1" data-liste-notes>
              {visibles.map((note) => {
                const extrait = extraitDeNote(note.description, 90);
                return (
                  <li key={note.id}>
                    <button
                      type="button"
                      data-note={note.id}
                      data-note-ouverte={note.id === ouverte || undefined}
                      onClick={() => setOuverte(note.id)}
                      className={cn(
                        'w-full rounded-xl px-3.5 py-3 text-left transition-colors',
                        note.id === ouverte ? 'bg-ligne-active' : 'hover:bg-raised',
                      )}
                    >
                      <p className={cn('truncate text-[14.5px] font-medium', note.id === ouverte && 'text-teinte')}>{note.titre}</p>
                      {extrait ? (
                        <p className="mt-0.5 truncate text-[12.5px] text-muted">{extrait}</p>
                      ) : null}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-faint">
                        <span className="truncate">{nomDuProjet(note.projectId) || t('Projet retiré')}</span>
                        {note.importance !== 'aucune' ? (
                          <span
                            className={cn('rounded-md px-1.5 py-0.5', TON_IMPORTANCE[note.importance])}
                          >
                            {t(LIBELLES_IMPORTANCE[note.importance])}
                          </span>
                        ) : null}
                        {note.echeance !== null ? (
                          <span
                            className={cn(
                              'inline-flex items-center gap-1',
                              echeanceDepassee(note) && 'text-danger',
                            )}
                          >
                            <CalendarClock className="h-3 w-3" />
                            {dateCourte(note.echeance)}
                          </span>
                        ) : null}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </ZoneDefilement>
      </VoletDesNotes>

      {/* LE FIL D'ARIANE DIT LA NOTE OUVERTE — « Services › Notes › son titre » ;
          « Notes » y ramène à la liste. */}
      {noteOuverte ? (
        <SuiteDuFil onRacine={() => setOuverte(null)}>
          <CranDuFil data-note-du-fil={noteOuverte.id}>{noteOuverte.titre || t('Sans titre')}</CranDuFil>
        </SuiteDuFil>
      ) : null}

      {/* LE VOLET DE DROITE : la note ouverte, en entier. */}
      <div
        className={cn(
          'min-h-0 min-w-0 flex-1 flex-col sm:flex',
          noteOuverte ? 'flex' : 'hidden',
        )}
      >
        {noteOuverte ? (
          <FicheNote
            key={noteOuverte.id}
            note={noteOuverte}
            pieces={pieces}
            onRetour={() => setOuverte(null)}
            onRecu={recevoir}
            onSupprimer={() => void supprimer(noteOuverte)}
            onApercu={(piece, galerie) => {
              setGalerieDApercu(galerie);
              ouvrirPiece(piece);
            }}
            pieceDe={pieceDe}
            dejaVue={pieceVue}
          />
        ) : (
          <EmptyState
            icon={<NotebookPen className="h-5 w-5" />}
            title={t('Aucune note ouverte')}
            hint={t('Choisissez une note à gauche, ou créez-en une avec « Nouvelle note ».')}
          />
        )}
      </div>

      <AttachmentPreview
        item={apercu}
        onClose={() => setApercu(null)}
        galerie={galerieDApercu}
        onNaviguer={ouvrirPiece}
        dejaVue={pieceVueAvantOuverture}
      />
    </div>
  );
}

/**
 * LE VOLET DE LA LISTE. Sur ordinateur il s'écrit dans la colonne de gauche
 * (`ColonneDeService`) ; sur téléphone il reste dans la page, et s'efface dès
 * qu'une note est ouverte.
 */
function VoletDesNotes({
  dansLaColonne,
  cache,
  children,
}: {
  dansLaColonne: boolean;
  cache: boolean;
  children: React.ReactNode;
}) {
  if (dansLaColonne)
    return (
      <ColonneDeService>
        <div className="flex min-h-0 flex-1 flex-col" data-volet-notes="colonne">
          {children}
        </div>
      </ColonneDeService>
    );
  return (
    /* LA MARGE DE LA PAGE, la même que partout sur téléphone (16 px). */
    <div className={cn('min-h-0 w-full shrink-0 flex-col px-4', cache ? 'hidden' : 'flex')} data-volet-notes="page">
      {children}
    </div>
  );
}

/**
 * LA NOTE OUVERTE : son titre, ses repères, son texte mis en forme.
 *
 * Tout s'enregistre tout seul, une seconde après la dernière frappe. Le
 * bandeau du haut affiche « Enregistrement… » puis la date de modification :
 * on ne cherche jamais si son texte est parti.
 */
function FicheNote({
  note,
  pieces,
  onRetour,
  onRecu,
  onSupprimer,
  onApercu,
  pieceDe,
  dejaVue,
}: {
  note: Note;
  pieces: Attachment[];
  onRetour: () => void;
  onRecu: (data: { notes?: Note[]; pieces?: Attachment[] }) => void;
  onSupprimer: () => void;
  /** La pièce à ouvrir en grand, et les images de la note qu'on y feuillette. */
  onApercu: (piece: Attachment, galerie: Attachment[]) => void;
  pieceDe: (id: string) => Attachment | null;
  /** Cette image a-t-elle déjà été ouverte en grand ? Son vignette porte alors un œil. */
  dejaVue: (piece: Attachment) => boolean;
}) {
  const state = useApp();
  const [titre, setTitre] = React.useState(note.titre);
  const [contenu, setContenu] = React.useState(note.description);
  const [echeance, setEcheance] = React.useState(versChamp(note.echeance));
  const [importance, setImportance] = React.useState<ImportanceNote>(note.importance);
  const [projet, setProjet] = React.useState(note.projectId);
  const [jointes, setJointes] = React.useState<string[]>(note.piecesJointes);
  const [enCours, setEnCours] = React.useState(false);
  const [envoi, setEnvoi] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const premierRendu = React.useRef(true);

  /*
   * L'ENREGISTREMENT DIFFÉRÉ. Chaque changement relance le compteur ; rien ne
   * part au premier rendu (sinon ouvrir une note l'aurait aussitôt réécrite).
   */
  React.useEffect(() => {
    if (premierRendu.current) {
      premierRendu.current = false;
      return;
    }
    setEnCours(true);
    const minuteur = window.setTimeout(async () => {
      try {
        const data = await client.call<{ notes: Note[]; pieces: Attachment[] }>({
          type: 'notes.enregistrer',
          note: {
            id: note.id,
            projectId: projet,
            titre: titre.trim() || t('Sans titre'),
            description: contenu,
            echeance: echeance ? new Date(echeance).getTime() : null,
            importance,
            piecesJointes: jointes,
          },
        });
        onRecu(data);
      } catch (err: any) {
        client.pushToast('error', err?.message ?? t('Note non enregistrée'));
      } finally {
        setEnCours(false);
      }
    }, DELAI_ENREGISTREMENT);
    return () => window.clearTimeout(minuteur);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titre, contenu, echeance, importance, projet, jointes]);

  /** Envoyer un fichier et rendre la pièce déposée. */
  const envoyer = async (fichier: File): Promise<Attachment | null> => {
    setEnvoi(true);
    try {
      const reponse = await fetch(`/api/upload?project=${encodeURIComponent(projet)}`, {
        method: 'POST',
        headers: {
          'content-type': fichier.type || 'application/octet-stream',
          'x-file-name': encodeURIComponent(fichier.name),
        },
        body: fichier,
      });
      if (!reponse.ok) throw new Error(String(reponse.status));
      const data = await reponse.json();
      return (data.attachment as Attachment) ?? null;
    } catch {
      client.pushToast('error', t('Envoi du fichier impossible'));
      return null;
    } finally {
      setEnvoi(false);
    }
  };

  /** Le bouton « image » de l'éditeur : on choisit un fichier, il entre dans le texte. */
  const choisirImage = (): Promise<string | null> =>
    new Promise((resoudre) => {
      const champ = document.createElement('input');
      champ.type = 'file';
      champ.accept = 'image/*';
      champ.onchange = async () => {
        const fichier = champ.files?.[0];
        if (!fichier) return resoudre(null);
        const jointe = await envoyer(fichier);
        resoudre(jointe ? `/api/attachment?id=${jointe.id}` : null);
      };
      champ.click();
    });

  const joindre = async (fichiers: FileList) => {
    for (const fichier of Array.from(fichiers)) {
      const jointe = await envoyer(fichier);
      if (jointe) {
        setJointes((actuelles) =>
          actuelles.includes(jointe.id) ? actuelles : [...actuelles, jointe.id],
        );
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-[860px] flex-1 flex-col sm:px-6" data-fiche-note={note.id}>
      {/* Le bandeau : retour (sur téléphone), état d'enregistrement, gestes. */}
      <div className="flex shrink-0 items-center gap-1.5 px-4 pt-1 sm:pt-2">
        <Button
          variant="ghost"
          size="icon-sm"
          className="sm:hidden"
          aria-label="Revenir à la liste"
          onClick={onRetour}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-0 flex-1 truncate text-[12px] text-faint" data-etat-note>
          {enCours ? t('Enregistrement…') : `${t('Modifiée le')} ${dateCourte(note.modifieLe)}`}
        </span>
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          data-note-fichier
          onChange={(event) => event.target.files && void joindre(event.target.files)}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Joindre un fichier"
          disabled={envoi}
          onClick={() => fileRef.current?.click()}
        >
          {envoi ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Paperclip className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Supprimer la note" onClick={onSupprimer}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Le titre : un vrai champ, sans étiquette — c'est la première ligne. */}
      <input
        value={titre}
        aria-label="Titre de la note"
        data-titre-note
        placeholder={t('Titre de la note…')}
        onChange={(event) => setTitre(event.target.value)}
        className="shrink-0 border-none bg-transparent px-4 pb-1 pt-2 text-[20px] font-semibold tracking-tight outline-none placeholder:text-faint"
      />

      {/* Les repères de la note : projet, importance, échéance. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 pb-2 text-[12.5px]">
        <ListeDeroulante
          valeur={projet}
          titre={t('Projet de la note')}
          repere="projet-note"
          data-projet-note
          onChoisir={setProjet}
          className="h-7 w-auto max-w-[220px] text-[12.5px]"
          options={projetsEnArbre(state.projects).map((ligne) => ({
            valeur: ligne.projet.id,
            libelle: libelleDansUnMenu(ligne.projet.name, ligne),
            attributs: { 'data-membre-de': ligne.parentId },
          }))}
        />
        <ListeDeroulante
          valeur={importance}
          titre={t('Importance de la note')}
          repere="importance-note"
          data-importance-note
          onChoisir={(valeur) => setImportance(valeur as ImportanceNote)}
          className="h-7 w-auto text-[12.5px]"
          options={IMPORTANCES_NOTE.map((cle) => ({ valeur: cle, libelle: t(LIBELLES_IMPORTANCE[cle]) }))}
        />
        <input
          type="datetime-local"
          value={echeance}
          aria-label="Échéance de la note"
          data-echeance-note
          onChange={(event) => setEcheance(event.target.value)}
          className="h-7 rounded-md border border-transparent bg-raised px-2 text-[12.5px]"
        />
      </div>

      <EditeurRiche
        cle={note.id}
        valeur={contenu}
        onChange={setContenu}
        onInsererImage={choisirImage}
        placeholder={t('Écrivez votre note…')}
      />

      {/* Les fichiers joints à la note, sous le texte. */}
      {jointes.length ? (
        <div
          className="flex shrink-0 flex-wrap gap-1.5 px-4 py-3"
          data-pieces-note
        >
          {jointes.map((id) => {
            const piece = pieceDe(id) ?? pieces.find((p) => p.id === id) ?? null;
            return piece ? (
              <div key={id} className="relative">
                <AttachmentThumb
                  item={piece}
                  compact
                  vue={dejaVue(piece)}
                  onOpen={() =>
                    onApercu(
                      piece,
                      jointes
                        .map((j) => pieceDe(j) ?? pieces.find((p) => p.id === j))
                        .filter((p): p is Attachment => !!p && p.mime.startsWith('image/')),
                    )
                  }
                />
                <button
                  type="button"
                  title={t('Retirer ce fichier')}
                  aria-label="Retirer ce fichier"
                  onClick={() => setJointes((actuelles) => actuelles.filter((f) => f !== id))}
                  className="absolute -right-1 -top-1 rounded-full bg-raised p-0.5 text-faint shadow-sm transition-colors hover:bg-danger hover:text-sur-etat"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ) : null;
          })}
        </div>
      ) : null}
    </div>
  );
}
