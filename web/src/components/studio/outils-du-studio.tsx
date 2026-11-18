import * as React from 'react';
import { PriseDUnMedia, useContexteDePose, useSourceVersUnePiste } from '@/components/pose-sur-piste';
import { Boxes, Check, Eraser, KeyRound, Loader2, RotateCcw, Search } from '@/components/ui/icones';
import { ouvrirLeCoffre } from '@/lib/ouvrir-coffre';
import {
  LIBELLES_DES_TYPES_DE_MODELE,
  TYPES_DE_MODELE_DU_STUDIO,
  motsJoues,
  passagesDesMotsEffaces,
  type Composition,
  type MotHorodate,
  type SegmentVoix,
  type TypeDeModeleDuStudio,
  type Attachment,
  normaliserPourFiltre,
} from '@beluga/shared';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  ListeDeroulante,
  ZoneDefilement,
} from '@/components/ui';
import { CLASSE_SECTION_DE_SERVICE } from '@/components/colonne-de-service';
import { formatRegional } from '@/lib/langue';
import { AttachmentPreview } from '@/components/attachment-preview';
import { Tableau, type ColonneDuTableauCommun } from '@/components/ui/tableau';
import { BoutonFiltres } from '@/components/ui/boutons-a-menu';
import { ApercuDeLigne, TitreEtSous, dateDeLigne } from '@/components/ui/apercu-de-ligne';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import type { DonneesCreation } from './types';

/**
 * LES PANNEAUX AJOUTÉS AU RETOUR DU STUDIO (30/10/2026) : le choix des modèles, les
 * versions, la bibliothèque commune (les notes vivent sur la ligne de temps depuis le 31/10/2026), la coupe au
 * texte, le rythme, la déclinaison et l'envoi vers Réseaux sociaux. Chacun parle au
 * démon par une commande `studio.*` et se relit au signal du Studio.
 */

const signaler = (err: any) => client.pushToast('error', err?.message ?? t('geste impossible'));

/* ------------------------------------------------------------------ */
/* Les modèles                                                          */
/* ------------------------------------------------------------------ */

interface LigneDuMenu {
  id: string;
  nom: string;
  qualite: number;
  usage: string;
  prix: number | null;
  unite: string;
  enDirect?: boolean;
  service?: 'kie' | 'openrouter' | 'higgsfield' | 'fal';
}

const libellePrix = (l: LigneDuMenu) => (l.prix !== null ? `${l.prix < 1 ? l.prix.toFixed(3) : l.prix.toFixed(2)} $ ${t(l.unite)}` : t('prix annoncé au devis'));

/**
 * LE MODÈLE PAR TYPE DE FABRICATION, DANS LE CHAMP D'ÉCRITURE (31/10/2026 : il quitte le tiroir de l'aperçu) : un
 * bouton de la rangée du bas ouvre une liste déroulante, rangée par type (voix, musique, image, vidéo). Le choix se
 * garde sur la création et s'impose aux devis du directeur ; « Laisser l'agent recommander » le retire.
 */
export function MenuDesModeles({ donnees }: { donnees: DonneesCreation }) {
  const [menu, setMenu] = React.useState<Record<TypeDeModeleDuStudio, LigneDuMenu[]> | null>(null);
  const [cles, setCles] = React.useState<{ kie: boolean; openrouter: boolean } | null>(null);
  const creationId = donnees.creation.id;
  const charger = () => {
    if (menu) return;
    client
      .call<{ menu: Record<TypeDeModeleDuStudio, LigneDuMenu[]>; cles?: { kie: boolean; openrouter: boolean } }>({ type: 'studio.modeles.lister', creationId })
      .then((r) => {
        setMenu(r.menu);
        setCles(r.cles ?? null);
      })
      .catch(signaler);
  };
  const choisis = donnees.modelesChoisis ?? {};
  const nombreChoisis = TYPES_DE_MODELE_DU_STUDIO.filter((type) => choisis[type]).length;
  const choisir = (genre: TypeDeModeleDuStudio, modele: string | null) => void client.call({ type: 'studio.modeles.choisir', creationId, genre, modele }).catch(signaler);
  return (
    <DropdownMenu onOpenChange={(ouvert) => ouvert && charger()}>
      {/* Pas de `Tooltip` autour du déclencheur d'un menu : `title`. */}
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="shrink-0" title={t('Modèles de fabrication')} aria-label="Modèles de fabrication" data-studio-menu-modeles={nombreChoisis}>
          <Boxes className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="sm:w-[340px]" data-studio-panneau-modeles>
        {/* SANS CLÉ, LE CHOIX EST VIDE : on mène au coffre-fort, où chaque service a sa fiche (kie.ai, OpenRouter). */}
        {cles && (!cles.kie || !cles.openrouter) ? (
          <DropdownMenuItem onSelect={ouvrirLeCoffre} data-studio-modeles-coffre data-studio-modeles-sans-cle={!cles.kie && !cles.openrouter ? 'aucune' : cles.kie ? 'openrouter' : 'kie'}>
            <KeyRound className="h-3.5 w-3.5" />
            <span className="min-w-0 whitespace-normal">
              {!cles.kie && !cles.openrouter ? t('Aucun service n’a sa clé : ajoutez celle de kie.ai ou d’OpenRouter pour fabriquer.') : !cles.kie ? t('kie.ai n’a pas sa clé : ses modèles paraîtront ici une fois ajoutée.') : t('OpenRouter n’a pas sa clé : ses modèles paraîtront ici une fois ajoutée.')}
            </span>
          </DropdownMenuItem>
        ) : null}
        {!menu ? <p className="px-2 py-1.5 text-[13px] text-muted">{t('Chargement…')}</p> : null}
        {menu
          ? TYPES_DE_MODELE_DU_STUDIO.map((type, i) => (
              <React.Fragment key={type}>
                {i ? <DropdownMenuSeparator /> : null}
                <DropdownMenuLabel>{t(LIBELLES_DES_TYPES_DE_MODELE[type])}</DropdownMenuLabel>
                {[{ id: '', nom: t('Laisser l’agent recommander'), prix: null } as Pick<LigneDuMenu, 'id' | 'nom' | 'prix'> & Partial<LigneDuMenu>, ...(menu[type] ?? [])].map((l) => {
                  const actif = (choisis[type] ?? '') === l.id;
                  return (
                    <DropdownMenuItem key={l.id || 'agent'} onSelect={() => choisir(type, l.id || null)} data-studio-modele={type} data-studio-modele-option={l.id} data-studio-modele-choisi={actif ? '' : undefined}>
                      <Check className={cn('h-3.5 w-3.5', actif ? 'text-accent' : 'invisible')} />
                      <span className="min-w-0 flex-1 truncate">{l.nom}</span>
                      {l.id && l.unite !== undefined ? <span className="shrink-0 text-[12px] text-faint">{libellePrix(l as LigneDuMenu)}</span> : null}
                    </DropdownMenuItem>
                  );
                })}
              </React.Fragment>
            ))
          : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ------------------------------------------------------------------ */
/* Les versions                                                         */
/* ------------------------------------------------------------------ */

interface VersionLue {
  numero: number;
  raison: string;
  auteur: string;
  creeLe: number;
}

/**
 * LES ARCHIVES DE LA CRÉATION, DANS LA COLONNE DE GAUCHE (31/10/2026) : sous les rubriques et séparées d'elles, les
 * vingt dernières modifications, la plus récente en haut — chaque geste enregistré en ajoute une, en direct. Au
 * survol, une icône ramène à une version : ce retour s'AJOUTE en tête (« version n restaurée »), rien n'est effacé,
 * et annuler / rétablir continuent de marcher.
 */
export const ARCHIVES_AFFICHEES = 20;

export function ArchivesDeLaCreation({ donnees, bloque }: { donnees: DonneesCreation; bloque?: boolean }) {
  const [versions, setVersions] = React.useState<VersionLue[] | null>(null);
  const creationId = donnees.creation.id;
  const version = donnees.creation.version;
  React.useEffect(() => {
    let vivant = true;
    client
      .call<{ versions: VersionLue[] }>({ type: 'studio.historique', creationId })
      .then((r) => vivant && setVersions(r.versions.slice(0, ARCHIVES_AFFICHEES)))
      .catch(() => vivant && setVersions([]));
    return () => {
      vivant = false;
    };
  }, [creationId, version]);
  const jalons = donnees.jalons ?? {};
  const aujourdhui = new Date().toDateString();
  const quand = (creeLe: number) => {
    const d = new Date(creeLe);
    return d.toDateString() === aujourdhui
      ? d.toLocaleTimeString(formatRegional(), { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString(formatRegional(), { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString(formatRegional(), { hour: '2-digit', minute: '2-digit' });
  };
  const revenir = (numero: number) => void client.call({ type: 'studio.restaurer', creationId, numero }).catch(signaler);
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Archives" data-studio-archives={versions?.length ?? 0}>
      <p className={CLASSE_SECTION_DE_SERVICE}>{t('Archives')}</p>
      <ZoneDefilement classeEnveloppe="min-h-0 flex-1" className="pb-2">
        <ul className="flex flex-col gap-0.5">
          {(versions ?? []).map((v) => {
            const courante = v.numero === version;
            return (
              <li
                key={v.numero}
                className="group flex min-h-8 items-center gap-2 rounded-md px-2.5 py-1 transition-colors hover:bg-raised"
                data-studio-archive={v.numero}
                data-studio-archive-courante={courante ? '' : undefined}
              >
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-[13px]', courante ? 'text-text' : 'text-muted')}>{jalons[v.numero] ?? v.raison}</span>
                  <span className="block truncate text-[11.5px] text-faint">{quand(v.creeLe)}</span>
                </span>
                {courante ? (
                  <span className="shrink-0 text-[11.5px] text-faint">{t('Actuelle')}</span>
                ) : (
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={bloque}
                    className="shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                    title={t('Revenir à cette version')}
                    aria-label="Revenir à cette version"
                    onClick={() => revenir(v.numero)}
                    data-studio-revenir={v.numero}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </ZoneDefilement>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* La bibliothèque commune                                              */
/* ------------------------------------------------------------------ */

interface LigneDeBibliotheque {
  attachmentId: string;
  genre: 'image' | 'video' | 'audio';
  nom: string;
  origine: string;
  mediaId?: string;
  creeLe: number;
}

/** LES ONGLETS DU TIROIR DES MÉDIAS, en haut (demande du 31/10/2026), chacun avec son compteur (03/11/2026). */
const CLES_GENRES = [
  { value: '', label: 'Tout' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Vidéos' },
  { value: 'audio', label: 'Sons' },
];

/** Le genre d'un média, dit dans la langue de l'écran. */
const libelleDuGenre = (g: string): string => (g === 'image' ? t('Image') : g === 'video' ? t('Vidéo') : g === 'audio' ? t('Son') : g);

const MIME_DU_GENRE: Record<LigneDeBibliotheque['genre'], string> = { image: 'image/png', video: 'video/mp4', audio: 'audio/mpeg' };

/** La pièce jointe d'une ligne, telle que la visionneuse la lit (le serveur ne rend que l'identifiant et le genre). */
function pieceDeLaLigne(l: LigneDeBibliotheque, projectId: string): Attachment {
  return { id: l.attachmentId, projectId, name: l.nom, mime: MIME_DU_GENRE[l.genre], size: 0, sha: l.attachmentId, createdAt: l.creeLe };
}

const filtreDeLaRubrique = { recherche: '', genre: '' };

/** L'aperçu d'un média de la rubrique : un clic l'ouvre (la visionneuse le lit), un glisser le pose sur une piste. */
function ApercuDeLaRubrique({ l, onOuvrir }: { l: LigneDeBibliotheque; onOuvrir: () => void }) {
  const source = useSourceVersUnePiste({ attachmentId: l.attachmentId, genre: l.genre === 'audio' ? 'son' : l.genre, nom: l.nom, depuisLaRubrique: true });
  return <ApercuDeLigne piece={l.attachmentId} genre={l.genre} taille={44} onOuvrir={onOuvrir} libelle={t('Ouvrir en grand')} data-studio-media-ouvrir={l.attachmentId} {...source} />;
}

/**
 * LE TIROIR DES MÉDIAS DU PROJET (rubrique « Médias » de la colonne de gauche) — UN TABLEAU depuis le 03/11/2026
 * (décision de l'utilisateur : « toutes les listes deviennent des tableaux », médias compris). Les onglets
 * Tout / Images / Vidéos / Sons en haut, CHACUN AVEC SON COMPTEUR, la recherche, puis une ligne par média :
 * l'aperçu (un clic ouvre la visionneuse, qui lit la vidéo ou le son et feuillette les médias affichés ; un glisser
 * le pose sur une piste), le titre, le genre, la source et la date. En bout de ligne, la prise à glisser,
 * le détourage et « Poser ici », qui pose le média à l'instant de la tête de lecture, sans copie du fichier.
 * La liste se lit une fois (300 au plus) : onglets, compteurs et recherche travaillent sur elle, sans requête.
 */
export function PanneauMedias({ donnees }: { donnees: DonneesCreation }) {
  const [tous, setTous] = React.useState<LigneDeBibliotheque[] | null>(null);
  /* La rubrique se referme le temps d'un glisser : elle revient sur la même recherche. */
  const [recherche, setRecherche] = React.useState(filtreDeLaRubrique.recherche);
  const [genre, setGenre] = React.useState(filtreDeLaRubrique.genre);
  filtreDeLaRubrique.recherche = recherche;
  filtreDeLaRubrique.genre = genre;
  const [ouverte, setOuverte] = React.useState<Attachment | null>(null);
  const creationId = donnees.creation.id;
  const projectId = donnees.creation.projectId;
  React.useEffect(() => {
    let vivant = true;
    client
      .call<{ lignes: LigneDeBibliotheque[] }>({ type: 'studio.bibliotheque.lister', creationId, recherche: '', genre: '' })
      .then((r) => vivant && setTous(r.lignes))
      .catch(signaler);
    return () => {
      vivant = false;
    };
  }, [creationId, donnees.medias.length]);
  const pose = useContexteDePose();
  const cherche = normaliserPourFiltre(recherche);
  const trouves = React.useMemo(
    () => (tous ?? []).filter((l) => !cherche || cherche.split(' ').every((m) => normaliserPourFiltre(`${l.nom} ${l.origine}`).includes(m))),
    [tous, cherche],
  );
  const lignes = React.useMemo(() => trouves.filter((l) => !genre || l.genre === genre), [trouves, genre]);
  const galerie = React.useMemo(() => lignes.map((l) => pieceDeLaLigne(l, projectId)), [lignes, projectId]);
  const ouvrir = (l: LigneDeBibliotheque) => setOuverte(pieceDeLaLigne(l, projectId));
  const colonnes: ColonneDuTableauCommun<LigneDeBibliotheque>[] = [
    { cle: 'apercu', libelle: t('Aperçu'), largeur: 64, rendu: (l) => <ApercuDeLaRubrique l={l} onOuvrir={() => ouvrir(l)} /> },
    {
      cle: 'titre',
      libelle: t('Titre'),
      valeur: (l) => l.nom,
      filtre: 'texte',
      rendu: (l) => <TitreEtSous titre={<span title={l.nom}>{l.nom}</span>} sous={l.origine} />,
    },
    { cle: 'genre', libelle: t('Genre'), largeur: 84, secondaire: true, valeur: (l) => l.genre, filtre: 'choix', libelleDuChoix: libelleDuGenre, rendu: (l) => <span className="text-muted">{libelleDuGenre(l.genre)}</span> },
    { cle: 'source', libelle: t('Source'), largeur: 150, secondaire: true, valeur: (l) => l.origine, filtre: 'choix', rendu: (l) => <span className="block truncate text-muted">{l.origine}</span> },
    { cle: 'date', libelle: t('Date'), largeur: 128, secondaire: true, droite: true, valeur: (l) => l.creeLe, rendu: (l) => <span className="text-muted">{dateDeLigne(l.creeLe)}</span> },
    {
      cle: 'actions',
      libelle: '',
      largeur: 150,
      libre: true,
      rendu: (l) => (
        <span className="flex items-center justify-end gap-1">
          <PriseDUnMedia source={{ attachmentId: l.attachmentId, genre: l.genre === 'audio' ? 'son' : l.genre, nom: l.nom, depuisLaRubrique: true }} />
          {pose && l.genre !== 'audio' ? (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              disabled={pose.etatDuFond(l.attachmentId) === 'en-cours'}
              aria-label={pose.etatDuFond(l.attachmentId) === 'retire' ? 'Remettre le fond' : 'Retirer le fond'}
              title={pose.etatDuFond(l.attachmentId) === 'retire' ? t('Remettre le fond') : t('Retirer le fond')}
              onClick={() => pose.gesteDuFond(pose.etatDuFond(l.attachmentId) === 'retire' ? 'remettre' : 'retirer', l.attachmentId)}
              data-studio-fond-du-media={l.attachmentId}
            >
              {pose.etatDuFond(l.attachmentId) === 'en-cours' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eraser className="h-3.5 w-3.5" />}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" className="shrink-0" onClick={() => void pose?.poser({ attachmentId: l.attachmentId })} data-studio-poser-media={l.attachmentId}>
            {t('Poser ici')}
          </Button>
        </span>
      ),
    },
  ];
  const nombreDe = (g: string) => trouves.filter((l) => !g || l.genre === g).length;
  return (
    <>
      <div className="flex shrink-0 flex-col gap-2 px-3 pb-2" data-studio-panneau-medias>
        {/* LE GENRE SE FILTRE PAR UN BOUTON À MENU (04/11/2026, deuxième passe : plus de barre d'onglets), compteurs compris. */}
        <div className="flex justify-end" data-studio-medias-onglets>
          <BoutonFiltres
            repere="studio-medias"
            groupes={[
              {
                cle: 'genre',
                titre: t('Genre'),
                valeur: genre,
                onChoisir: setGenre,
                options: CLES_GENRES.map((g) => ({ valeur: g.value, libelle: tous ? `${t(g.label)} · ${nombreDe(g.value)}` : t(g.label) })),
              },
            ]}
          />
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" aria-hidden />
          <Input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder={t('Chercher un média du projet')} className="pl-8" data-studio-chercher-media />
        </div>
      </div>
      <ZoneDefilement fond="hsl(var(--surface))" classeEnveloppe="min-h-0 flex-1" className="px-3 pb-3">
        {!tous ? (
          <SilhouetteLignes lignes={4} />
        ) : (
          <Tableau
            repere="studio-medias"
            colonnes={colonnes}
            lignes={lignes}
            cle={(l) => l.attachmentId}
            vide={t('Aucun média ne répond à cette recherche.')}
            attributsLigne={(l) => ({ 'data-studio-media-commun': l.attachmentId, 'data-studio-media-genre': l.genre })}
            taille={50}
          />
        )}
      </ZoneDefilement>
      {ouverte ? <AttachmentPreview item={ouverte} onClose={() => setOuverte(null)} galerie={galerie} onNaviguer={setOuverte} /> : null}
    </>
  );
}

/** La silhouette des lignes pendant la lecture : jamais un état vide. */
function SilhouetteLignes({ lignes }: { lignes: number }) {
  return (
    <div className="flex flex-col gap-1.5" data-silhouette>
      {Array.from({ length: lignes }, (_, i) => (
        <div key={i} className="h-11 animate-pulse rounded-md bg-raised/60" />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* La coupe au texte                                                    */
/* ------------------------------------------------------------------ */

/**
 * COUPER UNE VOIX EN EFFAÇANT SES MOTS : chaque mot se touche pour le barrer, et
 * « Couper » retire ces passages partout (son, images, textes) en une seule
 * version, annulable. La voix n'est pas refabriquée.
 */
export function CoupeAuTexte({ donnees, composition, segmentId }: { donnees: DonneesCreation; composition: Composition; segmentId: string }) {
  const segment = composition.pistes.flatMap((p) => p.segments).find((s) => s.id === segmentId);
  const [mots, setMots] = React.useState<MotHorodate[] | null>(null);
  const [effaces, setEffaces] = React.useState<Set<number>>(new Set());
  const mediaId = segment && (segment.genre === 'audio' || segment.genre === 'video' || segment.genre === 'voix') ? segment.mediaId : undefined;
  const creationId = donnees.creation.id;
  React.useEffect(() => {
    setEffaces(new Set());
    if (!segment) return;
    if (segment.genre === 'voix' && (segment as SegmentVoix).mots?.length) {
      setMots(motsJoues(segment as SegmentVoix));
      return;
    }
    setMots(null);
  }, [segmentId, segment?.genre === 'voix' ? (segment as SegmentVoix).mots?.length : 0, segment?.debut, segment?.duree]);
  if (!segment || !mediaId) return null;
  const reconnaitre = () => {
    void client
      .call<{ mots: MotHorodate[] }>({ type: 'studio.mots', creationId, mediaId })
      .then((r) => {
        const decalage = ('debutMedia' in segment ? (segment.debutMedia ?? 0) : 0) as number;
        const vitesse = ('vitesse' in segment && segment.vitesse ? segment.vitesse : 1) as number;
        setMots(
          r.mots
            .filter((m) => m.fin > decalage && m.debut < decalage + segment.duree * vitesse)
            .map((m) => ({ texte: m.texte, debut: segment.debut + (m.debut - decalage) / vitesse, fin: segment.debut + (m.fin - decalage) / vitesse })),
        );
      })
      .catch(signaler);
  };
  const couper = () => {
    if (!mots) return;
    void client
      .call({ type: 'studio.couper', creationId, passages: passagesDesMotsEffaces(mots, effaces) })
      .then(() => setEffaces(new Set()))
      .catch(signaler);
  };
  if (!mots) {
    return (
      <div className="flex flex-col gap-1.5" data-studio-coupe-texte="sans-mots">
        <p className="text-[12.5px] text-muted">{t('Affichez le texte de ce son pour le couper en effaçant des mots.')}</p>
        <Button size="sm" variant="ghost" className="self-start" onClick={reconnaitre} data-studio-reconnaitre-mots>
          {t('Afficher le texte')}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5" data-studio-coupe-texte="mots">
      <p className="text-[12.5px] text-muted">{t('Touchez les mots à retirer : le son et les images de ce passage sont coupés ensemble.')}</p>
      <p className="flex flex-wrap gap-x-1 gap-y-0.5 text-[13px] leading-relaxed">
        {mots.map((m, i) => (
          <button
            key={i}
            type="button"
            onClick={() =>
              setEffaces((avant) => {
                const suite = new Set(avant);
                if (suite.has(i)) suite.delete(i);
                else suite.add(i);
                return suite;
              })
            }
            className={cn('rounded px-0.5', effaces.has(i) ? 'bg-danger/15 text-danger line-through' : 'text-text hover:bg-raised')}
            data-studio-mot={i}
            aria-pressed={effaces.has(i)}
          >
            {m.texte}
          </button>
        ))}
      </p>
      <Button size="sm" className="self-start" disabled={!effaces.size} onClick={couper} data-studio-couper-mots>
        {t('Couper {n} mot(s)', { n: effaces.size })}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Le rythme                                                            */
/* ------------------------------------------------------------------ */

/** Le rythme de la musique de la création, relu à chaque version : ses temps servent de repères et d'aimant. */
export function useRythme(creationId: string, version: number): { bpm: number; temps: number[] } {
  const [rythme, setRythme] = React.useState<{ bpm: number; temps: number[] }>({ bpm: 0, temps: [] });
  React.useEffect(() => {
    let vivant = true;
    client
      .call<{ rythme: { bpm: number; temps: number[] } }>({ type: 'studio.rythme', creationId })
      .then((r) => vivant && setRythme(r.rythme))
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
  }, [creationId, version]);
  return rythme;
}

/* ------------------------------------------------------------------ */
/* Déclinaison et réseaux                                               */
/* ------------------------------------------------------------------ */

const CLES_LANGUES = [
  { value: 'en', label: 'Anglais' },
  { value: 'de', label: 'Allemand' },
  { value: 'es', label: 'Espagnol' },
  { value: 'it', label: 'Italien' },
  { value: 'pt', label: 'Portugais' },
  { value: 'nl', label: 'Néerlandais' },
  { value: 'fr', label: 'Français' },
];
const TOUS_LES_FORMATS = ['9:16', '1:1', '4:5', '16:9'];

/** DÉCLINER EN UN CLIC : les quatre formats partent à l'export, une langue ouvre une copie confiée à l'agent. Envoyer : un brouillon, jamais une publication. */
export function GestesDeDeclinaison({ donnees, temps, onOuvrir }: { donnees: DonneesCreation; temps: number; onOuvrir: (id: string) => void }) {
  const creationId = donnees.creation.id;
  const [langue, setLangue] = React.useState('en');
  const [lot] = React.useState(() => `decliner-${Date.now()}`);
  const declinerFormats = () => {
    void client
      .call({ type: 'studio.creation.modifier', id: creationId, formats: TOUS_LES_FORMATS })
      .then(() => Promise.all(TOUS_LES_FORMATS.map((format) => client.call({ type: 'studio.exporter', creationId, format, genre: 'video', instant: temps, lot }))))
      .then(() => client.pushToast('success', t('Les quatre formats partent à l’export.')))
      .catch(signaler);
  };
  const declinerLangue = () => {
    void client
      .call<{ creationId: string }>({ type: 'studio.decliner.langue', creationId, langue })
      .then((r) => onOuvrir(r.creationId))
      .catch(signaler);
  };
  const versReseaux = () => {
    void client
      .call<{ nouveau: boolean }>({ type: 'studio.versReseaux', creationId })
      .then((r) => client.pushToast('success', r.nouveau ? t('Brouillon créé dans Réseaux sociaux : rien n’est publié.') : t('Ce brouillon existe déjà dans Réseaux sociaux.')))
      .catch(signaler);
  };
  return (
    <div className="flex flex-col gap-3 p-3" data-studio-panneau-declinaison>
      <div className="flex flex-col gap-1">
        <p className="text-[12.5px] font-medium text-text">{t('Tous les formats')}</p>
        <p className="text-[12.5px] text-muted">{t('Vertical, carré, portrait et horizontal partent à l’export. Un recadrage peut demander une retouche.')}</p>
        <Button size="sm" className="self-start" onClick={declinerFormats} data-studio-decliner-formats>
          {t('Décliner en quatre formats')}
        </Button>
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-[12.5px] font-medium text-text">{t('Une autre langue')}</p>
        <p className="text-[12.5px] text-muted">{t('Une copie garde les images déjà payées ; l’agent traduit les textes et la voix. La voix finale reste à valider, avec son prix.')}</p>
        <div className="flex items-center gap-1.5">
          <div className="min-w-0 flex-1">
            <ListeDeroulante valeur={langue} onChoisir={setLangue} options={CLES_LANGUES.map((l) => ({ valeur: l.value, libelle: t(l.label) }))} titre={t('Langue')} />
          </div>
          <Button size="sm" onClick={declinerLangue} data-studio-decliner-langue>
            {t('Décliner')}
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-[12.5px] font-medium text-text">{t('Réseaux sociaux')}</p>
        <p className="text-[12.5px] text-muted">{t('Les exports prêts partent en brouillon dans le calendrier. Rien n’est publié sans vous.')}</p>
        <Button size="sm" variant="ghost" className="self-start" onClick={versReseaux} data-studio-vers-reseaux>
          {t('Envoyer en brouillon')}
        </Button>
      </div>
    </div>
  );
}
