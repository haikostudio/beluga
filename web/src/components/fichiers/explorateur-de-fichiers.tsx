import * as React from 'react';
import {
  ArrowLeft,
  Brain,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Code,
  Compass,
  DatabaseBackup,
  Download,
  ExternalLink,
  File,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  Megaphone,
  MessagesSquare,
  Music,
  Pencil,
  RotateCcw,
  ScrollText,
  Sparkles,
  SquareKanban,
  Trash2,
  Upload,
  Video,
  Camera,
  HardDrive,
  Images,
} from '@/components/ui/icones';
import { FICHES_DES_SERVICES, type ServiceDeFichiers } from '@beluga/shared';
import { Badge, Button, ConfirmDialog, Dialog, DialogContent, DialogContentLibre, DialogHeader, DialogTitle, Drawer, EnteteDeFeuille, Input, ZoneDefilement } from '@/components/ui';
import { ChampDeRecherche } from '@/components/ui/champ-de-recherche';
import { Silhouette } from '@/components/silhouettes';
import { adresseDePiece } from '@/components/pastille-de-fichier';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { ouvrirUnMedia } from '@/lib/ouvrir-un-media';
import { useTelephone } from '@/lib/telephone';
import { useApp } from '@/lib/use-app';
import { bytes, cn, relativeTime } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Ce que le serveur rend (`server/src/fichiers-ranges.ts`)             */
/* ------------------------------------------------------------------ */

type Genre = 'image' | 'video' | 'son' | 'pdf' | 'texte' | 'code' | 'archive' | 'autre';

export interface FichierRange {
  id: string;
  origine: string;
  projetId: string | null;
  service: ServiceDeFichiers;
  nom: string;
  chemin: string;
  genre: Genre;
  mime: string | null;
  taille: number;
  creeLe: number;
  modifieLe: number;
  utilisePar: string[];
  pieceId: string | null;
  supprimeLe: number | null;
  joursRestants?: number;
  renommable: boolean;
  supprimable: boolean;
  extrait?: string;
  /** Le disque qui garde vraiment le fichier. */
  disque?: Disque;
}

/** Le disque qui porte un fichier (`disqueQuiPorte`, `shared/src/rangement-des-fichiers.ts`). */
type Disque = 'serveur' | 'stockage';

interface DossierRange {
  nom: string;
  chemin: string;
  nombre: number;
  taille: number;
  service?: ServiceDeFichiers;
  projetId?: string | null;
  paresseux?: boolean;
  /** Le fichier le plus récent du dossier : son aperçu et son badge remplacent l'icône de dossier. */
  apercu?: { id: string; pieceId: string | null; genre: Genre; nom: string; mime: string | null };
  /** Le disque de tout son contenu ; absent quand il est réparti sur les deux. */
  disque?: Disque;
}

interface RapportDeRangement {
  essai: boolean;
  total: number;
  nouveaux: number;
  misAJour: number;
  retires: number;
  nonClasses: number;
  parService: Record<string, number>;
  parProjet: { nom: string; nombre: number }[];
  exemples: { chemin: string; vers: string }[];
  dureeMs: number;
  at: number;
}

interface ContenuDuDossier {
  chemin: string;
  dossiers: DossierRange[];
  fichiers: FichierRange[];
  rangement: RapportDeRangement | null;
}

/* ------------------------------------------------------------------ */
/* Les petits rendus                                                    */
/* ------------------------------------------------------------------ */

const ICONES_DES_SERVICES: Record<ServiceDeFichiers, React.ComponentType<{ className?: string }>> = {
  studio: Clapperboard,
  communication: Megaphone,
  captures: Camera,
  medias: Images,
  conversations: MessagesSquare,
  cartes: SquareKanban,
  strategie: Compass,
  ajouts: FolderInput,
  code: Code,
  memoire: Brain,
  journaux: ScrollText,
  sauvegardes: DatabaseBackup,
};

/**
 * LE BADGE DU DISQUE (08/11/2026) : sur quel disque le fichier — ou tout le contenu du dossier — est VRAIMENT gardé.
 * Sobre, sans couleur : une étiquette grise, posée en tête de la ligne d'informations pour ne rien voler au nom.
 */
function BadgeDuDisque({ disque }: { disque?: Disque }) {
  if (!disque) return null;
  return (
    <Badge
      className="shrink-0 px-1 py-px text-[10.5px] font-normal"
      title={disque === 'stockage' ? t('Gardé sur le disque de stockage') : t('Gardé sur le disque du serveur')}
      data-fichiers-disque={disque}
    >
      <HardDrive className="h-3 w-3" />
      {disque === 'stockage' ? t('Stockage') : t('Serveur')}
    </Badge>
  );
}

/** Le nom d'un service, traduit. */
function libelleDuService(service: ServiceDeFichiers): string {
  return t(FICHES_DES_SERVICES[service].libelle);
}

/** Le nom montré d'un dossier : un service se traduit, un projet ou une carte garde son nom. */
function nomDuDossier(d: DossierRange): string {
  return d.service && d.chemin.split('/').length === 2 ? libelleDuService(d.service) : d.nom;
}

function IconeDuGenre({ genre, className }: { genre: Genre; className?: string }) {
  const Icone = genre === 'image' ? ImageIcon : genre === 'video' ? Video : genre === 'son' ? Music : genre === 'texte' || genre === 'pdf' ? FileText : genre === 'code' ? Code : File;
  return <Icone className={className} />;
}

function adresseDuContenu(f: FichierRange, opts: { telecharger?: boolean; largeur?: number } = {}): string {
  if (f.pieceId) return adresseDePiece(f.pieceId, opts.telecharger, opts.largeur);
  return `/api/fichiers/contenu?id=${encodeURIComponent(f.id)}${opts.telecharger ? '&download=1' : ''}${opts.largeur ? `&w=${opts.largeur}` : ''}`;
}

/** Le type d'un fichier en badge : son extension (« PNG », « MP4 », « PDF »), sinon son genre. */
export function badgeDuType(nom: string, genre: Genre): string {
  const ext = /\.([A-Za-z0-9]{1,5})$/.exec(nom)?.[1];
  if (ext) return ext.toUpperCase();
  return genre === 'autre' ? '' : genre.toUpperCase().slice(0, 4);
}

/** Les genres qui ont une vraie vignette (image réduite, première page du PDF, image de la vidéo), jamais l'original. */
const GENRES_A_VIGNETTE: readonly Genre[] = ['image', 'pdf', 'video'];

/**
 * LA VIGNETTE D'UN FICHIER (carte « Aperçu, chat, Agentik et vraie charte ») : l'aperçu réduit côté serveur (image,
 * première page d'un PDF, image d'une vidéo), sinon l'icône de son genre — avec, en bas à droite, le BADGE DE SON TYPE.
 * Chargée paresseusement : seule la ligne qui entre à l'écran demande sa miniature.
 */
function Vignette({ f, badge = true }: { f: Pick<FichierRange, 'id' | 'pieceId' | 'genre' | 'nom'>; badge?: boolean }) {
  const [rate, setRate] = React.useState(false);
  const type = badge ? badgeDuType(f.nom, f.genre) : '';
  const apercu = GENRES_A_VIGNETTE.includes(f.genre) && !rate;
  return (
    <span className="relative flex h-9 w-9 shrink-0" data-fichiers-vignette={apercu ? 'apercu' : 'icone'}>
      {apercu ? (
        <img
          src={adresseDuContenu(f as FichierRange, { largeur: 96 })}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setRate(true)}
          className="h-9 w-9 rounded-md bg-raised object-cover"
        />
      ) : (
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-raised text-muted">
          <IconeDuGenre genre={f.genre} className="h-4 w-4" />
        </span>
      )}
      {type ? (
        <span
          className="absolute -bottom-1 -right-1.5 rounded-[4px] bg-encre px-1 text-[8.5px] font-bold leading-[13px] tracking-wide text-encre-fg"
          data-fichiers-badge={type}
        >
          {type}
        </span>
      ) : null}
    </span>
  );
}

function telecharger(f: FichierRange): void {
  const a = document.createElement('a');
  a.href = adresseDuContenu(f, { telecharger: true });
  a.download = f.nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** OUVRIR UN FICHIER : un média dans la visionneuse commune, un texte ou du code dans l'aperçu du volet. */
function ouvrirDansLaVisionneuse(f: FichierRange): boolean {
  if (f.genre === 'image' || f.genre === 'video' || f.genre === 'son' || f.genre === 'pdf') {
    ouvrirUnMedia({ adresse: adresseDuContenu(f), piece: f.pieceId, genre: f.genre, nom: f.nom });
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Les lectures                                                         */
/* ------------------------------------------------------------------ */

async function lireDossier(chemin: string): Promise<ContenuDuDossier> {
  return client.call<ContenuDuDossier>({ type: 'fichiers.dossier', chemin });
}

function useDossier(chemin: string | null, version: number) {
  const [etat, setEtat] = React.useState<{ chemin: string; contenu: ContenuDuDossier | null; erreur: string | null } | null>(null);
  React.useEffect(() => {
    if (chemin === null) return;
    let vivant = true;
    setEtat((e) => (e?.chemin === chemin ? e : { chemin, contenu: null, erreur: null }));
    lireDossier(chemin)
      .then((contenu) => vivant && setEtat({ chemin, contenu, erreur: null }))
      .catch((err: Error) => vivant && setEtat({ chemin, contenu: null, erreur: err.message || t('Ce dossier ne vous est pas ouvert.') }));
    return () => {
      vivant = false;
    };
  }, [chemin, version]);
  return etat?.chemin === chemin ? etat : null;
}

/* ------------------------------------------------------------------ */
/* L'arbre de gauche                                                    */
/* ------------------------------------------------------------------ */

function NoeudDeLArbre({ dossier, profondeur, courant, ouverts, basculer, aller, version }: { dossier: DossierRange; profondeur: number; courant: string; ouverts: Set<string>; basculer: (chemin: string) => void; aller: (chemin: string) => void; version: number }) {
  const ouvert = ouverts.has(dossier.chemin);
  const contenu = useDossier(ouvert ? dossier.chemin : null, version);
  const choisi = courant === dossier.chemin;
  const Icone = dossier.service && dossier.chemin.split('/').length === 2 ? ICONES_DES_SERVICES[dossier.service] : ouvert ? FolderOpen : Folder;
  return (
    <li>
      <div
        className={cn('group flex h-8 items-center gap-1 rounded-md pr-2 text-[13px]', choisi ? 'bg-teinte/12 text-text' : 'text-muted hover:bg-raised hover:text-text')}
        style={{ paddingLeft: 4 + profondeur * 14 }}
        data-fichiers-noeud={dossier.chemin}
        aria-current={choisi ? 'true' : undefined}
      >
        <button type="button" aria-label={ouvert ? 'Replier' : 'Déplier'} title={ouvert ? t('Replier') : t('Déplier')} className="flex h-6 w-5 shrink-0 items-center justify-center rounded text-faint hover:text-text" onClick={() => basculer(dossier.chemin)}>
          {ouvert ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => aller(dossier.chemin)}>
          <Icone className={cn('h-3.5 w-3.5 shrink-0', choisi && 'text-teinte')} />
          <span className="min-w-0 flex-1 truncate">{nomDuDossier(dossier)}</span>
          {dossier.nombre ? <span className="shrink-0 text-[11px] tabular-nums text-faint">{dossier.nombre.toLocaleString()}</span> : null}
        </button>
      </div>
      {ouvert ? (
        contenu?.contenu ? (
          contenu.contenu.dossiers.length ? (
            <ul>
              {contenu.contenu.dossiers.map((d) => (
                <NoeudDeLArbre key={d.chemin} dossier={d} profondeur={profondeur + 1} courant={courant} ouverts={ouverts} basculer={basculer} aller={aller} version={version} />
              ))}
            </ul>
          ) : null
        ) : contenu?.erreur ? null : (
          <div className="py-1" style={{ paddingLeft: 26 + profondeur * 14 }}>
            <Silhouette className="h-3 w-24" />
          </div>
        )
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* L'explorateur                                                        */
/* ------------------------------------------------------------------ */

/**
 * L'EXPLORATEUR DES FICHIERS RANGÉS — le même dans la fenêtre « Fichiers » (tous les projets du compte) et dans
 * l'explorateur d'un projet (`racine` : le dossier du projet, qu'on ne quitte pas). L'arbre à gauche (sur ordinateur),
 * le dossier ouvert à droite ; dès qu'on écrit dans la recherche, les résultats les plus pertinents remplacent le
 * dossier, avec leur extrait et leur emplacement. Gestes : ouvrir, télécharger, ajouter, renommer, mettre à la
 * corbeille (30 jours, restaurable). Les droits se vérifient au serveur : l'écran ne montre que ce qu'il reçoit.
 */
export function ExplorateurDeFichiers({ racine, projetId, depart, onTitre }: { racine?: string; projetId?: string; depart?: string; onTitre?: (titre: string) => void }) {
  const state = useApp();
  const admin = state.monRole === 'admin';
  const telephone = useTelephone();
  const [chemin, setChemin] = React.useState(depart ?? racine ?? '');
  const [version, setVersion] = React.useState(0);
  const [ouverts, setOuverts] = React.useState<Set<string>>(() => new Set(racine ? [racine] : []));
  const [recherche, setRecherche] = React.useState('');
  const [resultats, setResultats] = React.useState<{ demande: string; liste: FichierRange[]; parLeSens: boolean } | null>(null);
  const [corbeille, setCorbeille] = React.useState<FichierRange[] | null>(null);
  const [apercu, setApercu] = React.useState<{ f: FichierRange; texte: string | null } | null>(null);
  const [aRenommer, setARenommer] = React.useState<FichierRange | null>(null);
  const [aSupprimer, setASupprimer] = React.useState<FichierRange | null>(null);
  const [envoi, setEnvoi] = React.useState<number>(0);
  const [glisse, setGlisse] = React.useState(false);
  const champ = React.useRef<HTMLInputElement>(null);
  const racineDeLArbre = useDossier(racine ?? '', version);
  const courant = useDossier(chemin, version);

  React.useEffect(() => {
    if (depart !== undefined) setChemin(depart);
  }, [depart]);

  /* Le fil d'Ariane : chaque cran du chemin, la racine imposée en tête. */
  const crans = React.useMemo(() => {
    const morceaux = chemin ? chemin.split('/') : [];
    const debut = racine ? racine.split('/').length : 0;
    const liste = morceaux.map((nom, i) => ({ nom, chemin: morceaux.slice(0, i + 1).join('/') })).slice(Math.max(0, debut - 1));
    return racine ? liste : [{ nom: t('Tous les fichiers'), chemin: '' }, ...liste];
  }, [chemin, racine]);
  const titre = crans.length ? crans[crans.length - 1]!.nom : t('Fichiers');
  React.useEffect(() => onTitre?.(titre), [titre, onTitre]);

  const aller = (vers: string) => {
    setChemin(vers);
    setApercu(null);
    setCorbeille(null);
    setRecherche('');
    setResultats(null);
    if (vers) setOuverts((o) => new Set([...o, ...vers.split('/').map((_, i, m) => m.slice(0, i + 1).join('/'))]));
  };
  const basculer = (c: string) =>
    setOuverts((o) => {
      const n = new Set(o);
      if (n.has(c)) n.delete(c);
      else n.add(c);
      return n;
    });
  const parent = chemin && chemin !== racine ? chemin.split('/').slice(0, -1).join('/') : null;

  /* LA RECHERCHE PENDANT LA SAISIE : 250 ms après la dernière touche ; la dernière demande partie a le dernier mot. */
  React.useEffect(() => {
    const demande = recherche.trim();
    if (demande.length < 2) {
      setResultats(null);
      return;
    }
    let vivant = true;
    const minuteur = window.setTimeout(() => {
      client
        .call<{ resultats: FichierRange[]; parLeSens: boolean }>({ type: 'fichiers.recherche', demande, ...(projetId ? { projetId } : {}) })
        .then((r) => vivant && setResultats({ demande, liste: r.resultats, parLeSens: r.parLeSens }))
        .catch(() => vivant && setResultats({ demande, liste: [], parLeSens: false }));
    }, 250);
    return () => {
      vivant = false;
      window.clearTimeout(minuteur);
    };
  }, [recherche, projetId]);

  const rafraichir = () => setVersion((v) => v + 1);

  const ouvrir = async (f: FichierRange) => {
    if (ouvrirDansLaVisionneuse(f)) return;
    if (f.genre === 'texte' || f.genre === 'code') {
      setApercu({ f, texte: null });
      try {
        const r = await fetch(adresseDuContenu(f));
        const texte = r.ok ? await r.text() : t('Ce fichier ne peut pas être lu.');
        setApercu((a) => (a?.f.id === f.id ? { f, texte: texte.length > 200_000 ? `${texte.slice(0, 200_000)}\n…` : texte } : a));
      } catch {
        setApercu((a) => (a?.f.id === f.id ? { f, texte: t('Ce fichier ne peut pas être lu.') } : a));
      }
      return;
    }
    telecharger(f);
  };

  const geste = async (type: 'fichiers.supprimer' | 'fichiers.restaurer', f: FichierRange) => {
    try {
      await client.call({ type, id: f.id });
      rafraichir();
      if (corbeille) setCorbeille((c) => c?.filter((x) => x.id !== f.id) ?? null);
    } catch (err) {
      client.pushToast('error', (err as Error).message);
    }
  };

  const ouvrirLaCorbeille = async () => {
    setApercu(null);
    setResultats(null);
    setRecherche('');
    setCorbeille([]);
    try {
      const r = await client.call<{ fichiers: FichierRange[] }>({ type: 'fichiers.corbeille' });
      setCorbeille(projetId ? r.fichiers.filter((f) => f.projetId === projetId) : r.fichiers);
    } catch (err) {
      client.pushToast('error', (err as Error).message);
      setCorbeille(null);
    }
  };

  /* AJOUTER : par le bouton ou en déposant sur le volet. Un dossier qui ne prend pas de dépôt l'envoie dans « Ajouts ». */
  const peutDeposer = !!chemin && (state.monRole === 'admin' || state.monRole === 'membre') && !chemin.startsWith('Commun');
  const deposer = async (fichiers: FileList | File[]) => {
    const liste = [...fichiers];
    if (!liste.length || !peutDeposer) return;
    setEnvoi((n) => n + liste.length);
    for (const fichier of liste) {
      try {
        const r = await fetch(`/api/fichiers/deposer?dossier=${encodeURIComponent(chemin)}&nom=${encodeURIComponent(fichier.name)}`, { method: 'POST', body: fichier });
        if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || t('Dépôt refusé'));
      } catch (err) {
        client.pushToast('error', t('« {nom} » n’a pas été ajouté : {raison}', { nom: fichier.name, raison: (err as Error).message }));
      } finally {
        setEnvoi((n) => n - 1);
      }
    }
    rafraichir();
  };
  const choisir = React.useRef<HTMLInputElement>(null);

  const contenu = courant?.contenu ?? null;
  const rangement = (racineDeLArbre?.contenu ?? contenu)?.rangement ?? null;

  /* -------------------------- le volet de droite -------------------------- */
  let volet: React.ReactNode;
  if (apercu) {
    volet = (
      <div className="flex min-h-0 flex-1 flex-col" data-fichiers-apercu={apercu.f.id}>
        <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-3">
          <Button size="sm" variant="ghost" onClick={() => setApercu(null)}>
            <ArrowLeft className="h-3.5 w-3.5" />
            {t('Retour au dossier')}
          </Button>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{apercu.f.nom}</span>
          <Button size="sm" variant="ghost" onClick={() => telecharger(apercu.f)}>
            <Download className="h-3.5 w-3.5" />
            {t('Télécharger')}
          </Button>
        </div>
        <ZoneDefilement className="px-4 pb-4">
          {apercu.texte === null ? (
            <div className="flex flex-col gap-2">
              <Silhouette className="h-3 w-full" />
              <Silhouette className="h-3 w-4/5" />
              <Silhouette className="h-3 w-2/3" />
            </div>
          ) : (
            <pre className="whitespace-pre-wrap break-words rounded-lg bg-raised p-3 font-mono text-[12px] leading-relaxed text-text select-text">{apercu.texte}</pre>
          )}
        </ZoneDefilement>
      </div>
    );
  } else if (corbeille) {
    volet = (
      <ZoneDefilement className="px-4 pb-4 pt-3" data-fichiers-corbeille>
        <div className="mb-2 flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setCorbeille(null)}>
            <ArrowLeft className="h-3.5 w-3.5" />
            {t('Retour au dossier')}
          </Button>
          <span className="text-[13px] text-muted">{t('Corbeille · gardée 30 jours')}</span>
        </div>
        {!corbeille.length ? (
          <p className="px-1 text-[13px] text-muted">{t('La corbeille est vide.')}</p>
        ) : (
          <ul className="flex flex-col">
            {corbeille.map((f) => (
              <li key={f.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-raised/60" data-fichiers-ligne-corbeille={f.id}>
                <Vignette f={f} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">{f.nom}</span>
                  <span className="block truncate text-[12px] text-muted">{f.chemin.split('/').slice(0, -1).join(' › ')}</span>
                </span>
                <span className="shrink-0 text-[12px] text-faint">{t('{n} j', { n: f.joursRestants ?? 0 })}</span>
                <Button size="sm" variant="subtle" onClick={() => void geste('fichiers.restaurer', f)} data-fichiers-restaurer={f.id}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t('Restaurer')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </ZoneDefilement>
    );
  } else if (resultats || recherche.trim().length >= 2) {
    volet = (
      <ZoneDefilement className="px-4 pb-4 pt-3" data-fichiers-resultats={resultats?.liste.length ?? ''}>
        {!resultats ? (
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Silhouette className="h-9 w-9" />
                <span className="flex flex-1 flex-col gap-1.5">
                  <Silhouette className="h-3 w-1/2" />
                  <Silhouette className="h-3 w-3/4" />
                </span>
              </div>
            ))}
          </div>
        ) : !resultats.liste.length ? (
          <p className="px-1 text-[13px] text-muted">{t('Aucun fichier ne répond à « {demande} ».', { demande: resultats.demande })}</p>
        ) : (
          <>
            <p className="mb-1.5 flex items-center gap-1.5 px-1 text-[12px] text-faint">
              {resultats.parLeSens ? <Sparkles className="h-3 w-3" /> : null}
              {resultats.liste.length === 1 ? t('1 résultat') : resultats.parLeSens ? t('{n} résultats, classés par pertinence et par sens', { n: resultats.liste.length }) : t('{n} résultats', { n: resultats.liste.length })}
            </p>
            <ul className="flex flex-col">
              {resultats.liste.map((f) => (
                <li key={f.id} className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-raised/60" data-fichiers-resultat={f.id}>
                  <Vignette f={f} />
                  <span className="min-w-0 flex-1">
                    <button type="button" className="block max-w-full truncate text-left text-[13px] font-medium text-text hover:underline" onClick={() => void ouvrir(f)}>
                      {f.nom}
                    </button>
                    {f.extrait ? <span className="line-clamp-2 block text-[12px] text-muted">{f.extrait}</span> : null}
                    <button type="button" className="mt-0.5 block max-w-full truncate text-left text-[11.5px] text-faint hover:text-text" onClick={() => aller(f.chemin.split('/').slice(0, -1).join('/'))} data-fichiers-resultat-dossier>
                      {f.chemin.split('/').slice(0, -1).join(' › ')}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </ZoneDefilement>
    );
  } else {
    volet = (
      <ZoneDefilement
        className={cn('px-4 pb-4 pt-2', glisse && 'bg-teinte/5')}
        data-fichiers-dossier={chemin}
        onDragOver={(e) => {
          if (!peutDeposer) return;
          e.preventDefault();
          setGlisse(true);
        }}
        onDragLeave={() => setGlisse(false)}
        onDrop={(e) => {
          if (!peutDeposer) return;
          e.preventDefault();
          setGlisse(false);
          void deposer(e.dataTransfer.files);
        }}
      >
        {admin && !rangement && !racine ? <BandeauDuRangement onFait={rafraichir} /> : null}
        {courant?.erreur ? (
          <p className="px-1 py-3 text-[13px] text-muted">{courant.erreur}</p>
        ) : !contenu ? (
          <div className="flex flex-col gap-2.5 pt-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Silhouette className="h-9 w-9" />
                <Silhouette className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : !contenu.dossiers.length && !contenu.fichiers.length ? (
          <p className="px-1 py-3 text-[13px] text-muted">{peutDeposer ? t('Ce dossier est vide. Déposez-y un fichier, ou utilisez « Ajouter ».') : t('Ce dossier est vide.')}</p>
        ) : (
          <ul className="flex flex-col">
            {contenu.dossiers.map((d) => {
              const Icone = d.service && d.chemin.split('/').length === 2 ? ICONES_DES_SERVICES[d.service] : Folder;
              return (
                <li key={d.chemin}>
                  <button type="button" className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-raised/60" onClick={() => aller(d.chemin)} data-fichiers-sous-dossier={d.chemin}>
                    {d.apercu && !(d.service && d.chemin.split('/').length === 2) ? (
                      /* UN DOSSIER QUI PORTE DES FICHIERS montre l'aperçu du plus récent et son type, plus l'icône de dossier. */
                      <Vignette f={d.apercu} badge={d.nombre === 1} />
                    ) : (
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-raised text-muted">
                        <Icone className="h-4 w-4" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-text">{nomDuDossier(d)}</span>
                      <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
                        <BadgeDuDisque disque={d.disque} />
                        <span className="min-w-0 truncate">
                          {d.paresseux ? t('Lu dans le dépôt du projet') : [d.nombre === 1 ? t('1 fichier') : t('{n} fichiers', { n: d.nombre.toLocaleString() }), d.taille ? bytes(d.taille) : null].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
                  </button>
                </li>
              );
            })}
            {contenu.fichiers.map((f) => (
              <LigneDeFichier key={f.id} f={f} onOuvrir={() => void ouvrir(f)} onRenommer={() => setARenommer(f)} onSupprimer={() => setASupprimer(f)} peutModifier={state.monRole === 'admin' || state.monRole === 'membre'} />
            ))}
          </ul>
        )}
      </ZoneDefilement>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-explorateur-fichiers={racine ? 'projet' : 'tout'}>
      <div className="flex min-h-0 flex-1">
        {/* ------------------------------ L'ARBRE ------------------------------ */}
        {!telephone ? (
          <nav className="flex min-h-0 w-[260px] shrink-0 flex-col border-r border-border" data-fichiers-arbre>
            <div className="shrink-0 px-3 py-2">
              <ChampDeRecherche ref={champ} valeur={recherche} onChange={setRecherche} placeholder={t('Rechercher un fichier, une idée…')} data-fichiers-recherche />
            </div>
            <ZoneDefilement className="px-2 pb-3">
              {racineDeLArbre?.contenu ? (
                <ul>
                  {racine ? (
                    <NoeudDeLArbre dossier={{ nom: racine, chemin: racine, nombre: 0, taille: 0 }} profondeur={0} courant={chemin} ouverts={ouverts} basculer={basculer} aller={aller} version={version} />
                  ) : (
                    racineDeLArbre.contenu.dossiers.map((d) => <NoeudDeLArbre key={d.chemin} dossier={d} profondeur={0} courant={chemin} ouverts={ouverts} basculer={basculer} aller={aller} version={version} />)
                  )}
                </ul>
              ) : (
                <div className="flex flex-col gap-2 px-2 pt-1">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <Silhouette key={i} className="h-3.5 w-3/4" />
                  ))}
                </div>
              )}
            </ZoneDefilement>
            <div className="shrink-0 border-t border-border px-2 py-1.5">
              <button type="button" className={cn('flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px]', corbeille ? 'bg-teinte/12 text-text' : 'text-muted hover:bg-raised hover:text-text')} onClick={() => void ouvrirLaCorbeille()} data-fichiers-ouvrir-corbeille>
                <Trash2 className="h-3.5 w-3.5" />
                {t('Corbeille')}
              </button>
            </div>
          </nav>
        ) : null}

        {/* ------------------------------ LE VOLET ----------------------------- */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {telephone ? (
            <div className="shrink-0 px-4 pb-1 pt-2">
              <ChampDeRecherche ref={champ} valeur={recherche} onChange={setRecherche} placeholder={t('Rechercher un fichier, une idée…')} data-fichiers-recherche />
            </div>
          ) : null}
          <div className="flex shrink-0 items-center gap-1.5 px-4 pb-1 pt-2.5">
            {parent !== null && !apercu && !corbeille && !resultats ? (
              <Button size="icon" variant="ghost" aria-label="Dossier parent" title={t('Dossier parent')} onClick={() => aller(parent)} data-fichiers-parent>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            ) : null}
            <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden text-[13px]" aria-label="Emplacement" data-fichiers-fil>
              {crans.map((c, i) => (
                <React.Fragment key={c.chemin || 'racine'}>
                  {i ? <ChevronRight className="h-3 w-3 shrink-0 text-faint" /> : null}
                  <button type="button" className={cn('min-w-0 truncate rounded px-1 py-0.5', i === crans.length - 1 ? 'font-medium text-text' : 'text-muted hover:bg-raised hover:text-text')} onClick={() => aller(c.chemin)}>
                    {c.chemin.split('/').length === 2 && FICHES_DES_SERVICES[Object.keys(FICHES_DES_SERVICES).find((s) => FICHES_DES_SERVICES[s as ServiceDeFichiers].libelle === c.nom) as ServiceDeFichiers] ? t(c.nom) : c.nom}
                  </button>
                </React.Fragment>
              ))}
            </nav>
            {envoi > 0 ? <Loader2 className="h-4 w-4 animate-spin text-teinte motion-reduce:animate-none" aria-label="Envoi en cours" /> : null}
            {peutDeposer && !apercu && !corbeille ? (
              <>
                <input ref={choisir} type="file" multiple hidden onChange={(e) => e.target.files && void deposer(e.target.files)} data-fichiers-choisir />
                <Button size="sm" variant="subtle" onClick={() => choisir.current?.click()} data-fichiers-ajouter>
                  <Upload className="h-3.5 w-3.5" />
                  {t('Ajouter')}
                </Button>
              </>
            ) : null}
            {telephone ? (
              <Button size="icon" variant="ghost" aria-label="Corbeille" title={t('Corbeille')} onClick={() => void ouvrirLaCorbeille()} data-fichiers-ouvrir-corbeille>
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
          {volet}
        </section>
      </div>

      <FenetreDeRenommage f={aRenommer} onClose={() => setARenommer(null)} onFait={rafraichir} />
      <ConfirmDialog
        open={!!aSupprimer}
        onClose={() => setASupprimer(null)}
        danger
        title={t('Mettre « {nom} » à la corbeille ?', { nom: aSupprimer?.nom ?? '' })}
        description={
          aSupprimer?.utilisePar.length
            ? t('Attention : ce fichier sert encore ({usages}). Il quitte l’arbre tout de suite, reste restaurable 30 jours, et n’est jamais effacé tant qu’il sert.', { usages: aSupprimer.utilisePar.join(', ') })
            : t('Il reste dans la corbeille 30 jours, d’où vous pouvez le restaurer.')
        }
        confirmLabel={t('Mettre à la corbeille')}
        onConfirm={() => {
          if (aSupprimer) void geste('fichiers.supprimer', aSupprimer);
          setASupprimer(null);
        }}
      />
    </div>
  );
}

function LigneDeFichier({ f, onOuvrir, onRenommer, onSupprimer, peutModifier }: { f: FichierRange; onOuvrir: () => void; onRenommer: () => void; onSupprimer: () => void; peutModifier: boolean }) {
  return (
    <li className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-raised/60" data-fichiers-ligne={f.id} data-fichiers-nom={f.nom}>
      <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={onOuvrir} data-fichiers-ouvrir={f.id}>
        <Vignette f={f} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-text">{f.nom}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
            <BadgeDuDisque disque={f.disque} />
            <span className="min-w-0 truncate">{[bytes(f.taille), relativeTime(f.modifieLe), f.utilisePar[0]].filter(Boolean).join(' · ')}</span>
          </span>
        </span>
      </button>
      <span className="flex shrink-0 items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
        <Button size="icon" variant="ghost" aria-label="Ouvrir" title={t('Ouvrir')} onClick={onOuvrir}>
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon" variant="ghost" aria-label="Télécharger" title={t('Télécharger')} onClick={() => telecharger(f)} data-fichiers-telecharger={f.id}>
          <Download className="h-3.5 w-3.5" />
        </Button>
        {peutModifier && f.renommable ? (
          <Button size="icon" variant="ghost" aria-label="Renommer" title={t('Renommer')} onClick={onRenommer} data-fichiers-renommer={f.id}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        {peutModifier && f.supprimable ? (
          <Button size="icon" variant="ghost" aria-label="Mettre à la corbeille" title={t('Mettre à la corbeille')} onClick={onSupprimer} data-fichiers-supprimer={f.id}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </span>
    </li>
  );
}

function FenetreDeRenommage({ f, onClose, onFait }: { f: FichierRange | null; onClose: () => void; onFait: () => void }) {
  const [nom, setNom] = React.useState('');
  const [enCours, setEnCours] = React.useState(false);
  React.useEffect(() => {
    if (f) setNom(f.nom);
  }, [f]);
  const valider = async () => {
    if (!f || !nom.trim()) return;
    setEnCours(true);
    try {
      await client.call({ type: 'fichiers.renommer', id: f.id, nom: nom.trim() });
      onFait();
      onClose();
    } catch (err) {
      client.pushToast('error', (err as Error).message);
    } finally {
      setEnCours(false);
    }
  };
  return (
    <Dialog open={!!f} onOpenChange={(o) => !o && onClose()}>
      <DialogContent adresse="saisie" className="sm:w-[min(440px,100%)]">
        <DialogHeader>
          <DialogTitle>{t('Renommer le fichier')}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-3 pb-1"
          onSubmit={(e) => {
            e.preventDefault();
            void valider();
          }}
        >
          <Input autoFocus value={nom} onChange={(e) => setNom(e.target.value)} data-fichiers-nouveau-nom />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('Annuler')}
            </Button>
            <Button type="submit" variant="principal" disabled={enCours || !nom.trim()} data-fichiers-valider-nom>
              {enCours ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : null}
              {t('Renommer')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * LE PREMIER RANGEMENT DES FICHIERS EXISTANTS (administrateur) : « Voir ce qui va bouger » lance l'essai à blanc et
 * montre son rapport ; « Ranger maintenant » l'applique. Rien n'est déplacé : chaque fichier reçoit sa place dans
 * l'arbre, et tous les anciens liens continuent de fonctionner.
 */
function BandeauDuRangement({ onFait }: { onFait: () => void }) {
  const [rapport, setRapport] = React.useState<RapportDeRangement | null>(null);
  const [enCours, setEnCours] = React.useState<'essai' | 'ranger' | null>(null);
  const lancer = async (appliquer: boolean) => {
    setEnCours(appliquer ? 'ranger' : 'essai');
    try {
      const r = await client.call<{ rapport: RapportDeRangement }>({ type: 'fichiers.rangement', appliquer }, 600_000);
      setRapport(r.rapport);
      if (appliquer) onFait();
    } catch (err) {
      client.pushToast('error', (err as Error).message);
    } finally {
      setEnCours(null);
    }
  };
  return (
    <div className="mb-3 rounded-xl bg-raised/70 p-3.5" data-fichiers-bandeau-rangement>
      <p className="text-[13px] font-medium text-text">{t('Vos fichiers existants ne sont pas encore rangés')}</p>
      <p className="mt-0.5 text-[12.5px] text-muted">
        {t('Chaque fichier déjà créé va recevoir sa place, par projet puis par service. Rien n’est déplacé ni copié : tous les anciens liens continuent de fonctionner.')}
      </p>
      {rapport ? (
        <div className="mt-2.5 text-[12.5px] text-muted" data-fichiers-rapport={rapport.essai ? 'essai' : 'fait'}>
          <p className="text-text">
            {rapport.essai
              ? t('Essai à blanc : {n} fichiers seraient rangés dans {p} dossiers de projet, dont {c} sans projet (« Commun »).', { n: rapport.total.toLocaleString(), p: rapport.parProjet.length, c: rapport.nonClasses })
              : t('{n} fichiers rangés.', { n: rapport.total.toLocaleString() })}
          </p>
          <p className="mt-1">
            {Object.entries(rapport.parService)
              .map(([s, n]) => `${FICHES_DES_SERVICES[s as ServiceDeFichiers] ? libelleDuService(s as ServiceDeFichiers) : s} ${n.toLocaleString()}`)
              .join(' · ')}
          </p>
          {rapport.essai && rapport.exemples.length ? (
            <ul className="mt-1.5 flex flex-col gap-0.5 font-mono text-[11px] text-faint">
              {rapport.exemples.slice(0, 5).map((e) => (
                <li key={e.vers} className="truncate">
                  → {e.vers}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="subtle" disabled={!!enCours} onClick={() => void lancer(false)} data-fichiers-essai-a-blanc>
          {enCours === 'essai' ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : null}
          {t('Voir ce qui va bouger')}
        </Button>
        <Button size="sm" variant="principal" disabled={!!enCours} onClick={() => void lancer(true)} data-fichiers-ranger>
          {enCours === 'ranger' ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : null}
          {t('Ranger maintenant')}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* La fenêtre « Fichiers »                                              */
/* ------------------------------------------------------------------ */

/**
 * LA FENÊTRE « FICHIERS », ouverte par le bouton du haut de la colonne de gauche : tous les fichiers des projets du
 * compte. Sur téléphone, elle occupe l'écran ; la flèche de l'en-tête remonte d'un dossier.
 */
export function FenetreDesFichiers({ open, onClose, chemin, projetId }: { open: boolean; onClose: () => void; chemin?: string; projetId?: string }) {
  /* OUVERTE DEPUIS UN AGENT (menu « Fichiers » de son projet) : la même fenêtre, partie du dossier de ce projet — on
     peut en remonter. Plus de tiroir qui change l'adresse : la page en dessous ne bouge pas. */
  const [departDuProjet, setDepartDuProjet] = React.useState<{ projetId: string; chemin: string } | null>(null);
  React.useEffect(() => {
    if (!open || !projetId || departDuProjet?.projetId === projetId) return;
    let vivant = true;
    client
      .call<{ chemin: string }>({ type: 'fichiers.dossierDuProjet', projectId: projetId })
      .then((r) => vivant && setDepartDuProjet({ projetId, chemin: r.chemin }))
      .catch(() => vivant && setDepartDuProjet({ projetId, chemin: '' }));
    return () => {
      vivant = false;
    };
  }, [open, projetId, departDuProjet?.projetId]);
  const pret = !projetId || departDuProjet?.projetId === projetId;
  const depart = projetId ? departDuProjet?.chemin || undefined : chemin;
  const telephone = useTelephone();
  const contenu =
    open && pret ? (
      <ExplorateurDeFichiers key={projetId ?? chemin ?? ''} depart={depart} />
    ) : open ? (
      <div className="flex flex-col gap-2.5 px-4 pt-3">
        {[0, 1, 2].map((i) => (
          <Silhouette key={i} className="h-3.5 w-2/3" />
        ))}
      </div>
    ) : null;
  /* SUR TÉLÉPHONE, UNE FEUILLE QUI MONTE DU BAS (décision du 07/11/2026) : la page d'avant reste visible
     au-dessus, et l'on referme en tirant la poignée vers le bas — la même feuille que Déploiement et Mise en
     production (`Drawer feuille`). Hauteur FIXE : la silhouette puis la liste ne la font pas sauter. Le geste ne
     part que de la bande du haut : faire défiler la liste ou l'arbre ne la ferme pas. La visionneuse ouverte
     par-dessus est un `role="dialog"`, que la feuille ne prend jamais pour un appui « dehors ». */
  if (telephone) {
    return (
      <Drawer feuille hauteurFixe open={open} onClose={onClose}>
        <EnteteDeFeuille titre={t('Fichiers')} gauche={<FolderOpen className="ml-1 h-4 w-4 shrink-0 text-muted" />} />
        <div className="flex min-h-0 flex-1 flex-col" data-fenetre-fichiers data-fenetre-fichiers-forme="feuille">
          {contenu}
        </div>
      </Drawer>
    );
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContentLibre
        className="h-[100dvh] sm:h-[min(760px,88dvh)] sm:w-[min(1100px,100%)]"
        data-fenetre-fichiers
        data-fenetre-fichiers-forme="fenetre"
        onInteractOutside={(e) => {
          /* La visionneuse s'ouvre PAR-DESSUS : un appui chez elle n'est pas un appui « dehors ». */
          const cible = e.target as HTMLElement | null;
          if (cible?.closest('[role="dialog"]')) e.preventDefault();
        }}
      >
        <DialogHeader className="border-b border-border pb-2.5">
          <DialogTitle className="flex min-w-0 items-center gap-2">
            <FolderOpen className="h-4 w-4 shrink-0 text-muted" />
            <span className="truncate">{t('Fichiers')}</span>
          </DialogTitle>
        </DialogHeader>
        {contenu}
      </DialogContentLibre>
    </Dialog>
  );
}

/**
 * L'EXPLORATEUR D'UN PROJET (tiroir « Fichiers » du projet) : la même source, ouverte directement sur le dossier du
 * projet — on n'en sort pas.
 */
export function FichiersDuProjet({ projectId }: { projectId: string }) {
  const [racine, setRacine] = React.useState<string | null>(null);
  const [erreur, setErreur] = React.useState<string | null>(null);
  React.useEffect(() => {
    let vivant = true;
    client
      .call<{ chemin: string }>({ type: 'fichiers.dossierDuProjet', projectId })
      .then((r) => vivant && setRacine(r.chemin))
      .catch((err: Error) => vivant && setErreur(err.message));
    return () => {
      vivant = false;
    };
  }, [projectId]);
  if (erreur) return <p className="px-4 py-3 text-[13px] text-muted">{erreur}</p>;
  if (!racine)
    return (
      <div className="flex flex-col gap-2.5 px-4 pt-3">
        {[0, 1, 2].map((i) => (
          <Silhouette key={i} className="h-3.5 w-2/3" />
        ))}
      </div>
    );
  return <ExplorateurDeFichiers racine={racine} projetId={projectId} />;
}
