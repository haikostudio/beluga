import * as React from 'react';
import {
  ArrowUpDown,
  CalendarClock,
  ChevronLeft,
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
} from '@/components/ui';
import { AttachmentPreview, AttachmentThumb } from '@/components/attachment-preview';
import { EditeurRiche } from '@/components/editeur-riche';
import { SilhouetteNotes } from '@/components/silhouettes';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import {
  IMPORTANCES_NOTE,
  LIBELLES_IMPORTANCE,
  LIBELLES_TRI,
  TRIS_NOTE,
  TRI_PAR_DEFAUT,
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
  haute: 'border-danger/40 text-danger',
  moyenne: 'border-warning/40 text-warning',
  basse: 'border-border text-muted',
  aucune: 'border-transparent text-faint',
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
  const creer = async () => {
    const projet = filtreProjet ?? projectId ?? state.projects[0]?.id;
    if (!projet) return;
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
      // La note créée est la plus récemment créée du projet visé.
      const neuve = (data.notes ?? [])
        .filter((n) => n.projectId === projet)
        .sort((a, b) => b.creeLe - a.creeLe)[0];
      if (neuve) setOuverte(neuve.id);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Note non enregistrée'));
    }
  };

  return (
    <div className="flex h-full min-h-0" data-page-notes>
      {/* LE VOLET DE GAUCHE : la liste des notes, en cartes.
          Sur téléphone les deux volets ne tiennent pas côte à côte : la liste
          s'efface dès qu'une note est ouverte, et une flèche y ramène. */}
      <div
        className={cn(
          'min-h-0 w-full shrink-0 flex-col border-r border-border sm:flex sm:w-[320px]',
          noteOuverte ? 'hidden' : 'flex',
        )}
      >
        <div className="shrink-0 px-3 pt-3">
          <div className="flex items-center gap-2">
            <NotebookPen className="h-4 w-4 shrink-0 text-faint" />
            <h1 className="min-w-0 flex-1 truncate text-[15px] font-medium">{t('Notes')}</h1>
            <Button
              variant="default"
              size="icon-sm"
              data-ajouter-note
              aria-label="Ajouter une note"
              disabled={!state.projects.length}
              onClick={() => void creer()}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <Input
              value={demande}
              aria-label="Rechercher une note"
              placeholder={t('Rechercher…')}
              className="pl-7"
              data-recherche-notes
              onChange={(event) => setDemande(event.target.value)}
            />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" aria-label="Trier les notes" data-tri-notes>
                  <ArrowUpDown className="h-3.5 w-3.5" />
                  {t(LIBELLES_TRI[tri])}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {TRIS_NOTE.map((cle) => (
                  <DropdownMenuItem key={cle} onSelect={() => setTri(cle)}>
                    {t(LIBELLES_TRI[cle])}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" aria-label="Filtrer par projet" data-filtre-projet>
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

        <ZoneDefilement className="min-h-0 flex-1 px-2 pb-4 pt-2">
          {chargement ? (
            /* PAS DE PHRASE D'ATTENTE : la liste à venir se dessine en
               silhouette, et l'état vide (« Aucune note pour l'instant »)
               attend d'être VRAI pour paraître. */
            <SilhouetteNotes />
          ) : !visibles.length ? (
            <EmptyState
              icon={<NotebookPen className="h-5 w-5" />}
              title={notes.length ? t('Aucune note ne correspond') : t('Aucune note pour l’instant')}
              hint={
                notes.length
                  ? t('Changez la recherche ou le filtre de projet.')
                  : t('Une note garde une idée, une échéance, un fichier — sans passer par le tableau.')
              }
            />
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
                        'w-full rounded-md border border-transparent px-2.5 py-2 text-left transition-colors',
                        note.id === ouverte ? 'bg-ligne-active' : 'hover:bg-surface',
                      )}
                    >
                      <p className="truncate text-[13.5px] font-medium">{note.titre}</p>
                      {extrait ? (
                        <p className="mt-0.5 truncate text-[12.5px] text-muted">{extrait}</p>
                      ) : null}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-faint">
                        <span className="truncate rounded border border-border px-1.5 py-0.5">
                          {nomDuProjet(note.projectId) || t('Projet retiré')}
                        </span>
                        {note.importance !== 'aucune' ? (
                          <span
                            className={cn('rounded border px-1.5 py-0.5', TON_IMPORTANCE[note.importance])}
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
      </div>

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
            onApercu={setApercu}
            pieceDe={pieceDe}
          />
        ) : (
          <EmptyState
            icon={<NotebookPen className="h-5 w-5" />}
            title={t('Aucune note ouverte')}
            hint={t('Choisissez une note à gauche, ou créez-en une avec le bouton +.')}
          />
        )}
      </div>

      <AttachmentPreview item={apercu} onClose={() => setApercu(null)} />
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
}: {
  note: Note;
  pieces: Attachment[];
  onRetour: () => void;
  onRecu: (data: { notes?: Note[]; pieces?: Attachment[] }) => void;
  onSupprimer: () => void;
  onApercu: (piece: Attachment) => void;
  pieceDe: (id: string) => Attachment | null;
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
    <div className="flex min-h-0 flex-1 flex-col" data-fiche-note={note.id}>
      {/* Le bandeau : retour (sur téléphone), état d'enregistrement, gestes. */}
      <div className="flex shrink-0 items-center gap-1.5 px-3 pt-3">
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
        <select
          value={projet}
          aria-label="Projet de la note"
          data-projet-note
          onChange={(event) => setProjet(event.target.value)}
          className="h-7 rounded-md border border-border bg-surface px-2 text-[12.5px]"
        >
          {projetsEnArbre(state.projects).map((ligne) => (
            <option key={ligne.projet.id} value={ligne.projet.id} data-membre-de={ligne.parentId}>
              {libelleDansUnMenu(ligne.projet.name, ligne)}
            </option>
          ))}
        </select>
        <select
          value={importance}
          aria-label="Importance de la note"
          data-importance-note
          onChange={(event) => setImportance(event.target.value as ImportanceNote)}
          className="h-7 rounded-md border border-border bg-surface px-2 text-[12.5px]"
        >
          {IMPORTANCES_NOTE.map((cle) => (
            <option key={cle} value={cle}>
              {t(LIBELLES_IMPORTANCE[cle])}
            </option>
          ))}
        </select>
        <input
          type="datetime-local"
          value={echeance}
          aria-label="Échéance de la note"
          data-echeance-note
          onChange={(event) => setEcheance(event.target.value)}
          className="h-7 rounded-md border border-border bg-surface px-2 text-[12.5px]"
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
          className="flex shrink-0 flex-wrap gap-1.5 border-t border-border px-4 py-2"
          data-pieces-note
        >
          {jointes.map((id) => {
            const piece = pieceDe(id) ?? pieces.find((p) => p.id === id) ?? null;
            return piece ? (
              <div key={id} className="relative">
                <AttachmentThumb item={piece} compact onOpen={() => onApercu(piece)} />
                <button
                  type="button"
                  title={t('Retirer ce fichier')}
                  aria-label="Retirer ce fichier"
                  onClick={() => setJointes((actuelles) => actuelles.filter((f) => f !== id))}
                  className="absolute -right-1 -top-1 rounded-full border border-border bg-surface p-0.5 text-faint hover:border-danger/40 hover:text-danger"
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
