import * as React from 'react';
import { Check, ImagePlus, Loader2, Send } from 'lucide-react';
import {
  ANGLES_DE_VUE,
  PARAMETRES_DES_ANGLES,
  arrondi,
  decoupageDuMedia,
  estRetenu,
  planDuMedia,
  type Attachment,
  type DirectionDeLumiere,
  type MediaDuSuivi,
} from '@beluga/shared';
import { Button, Drawer, EnteteDeFeuille, Input, Switch, Textarea, ZoneDefilement } from '@/components/ui';
import { BoutonsRadio, Curseur } from '@/components/ui/elements-maison';
import { ImageDePiece } from '@/components/pastille-de-fichier';
import { SphereDeLumiere } from '@/components/sphere-de-lumiere';
import { client } from '@/lib/client';
import { useProduction } from '@/lib/production-de-carte';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LES PANNEAUX DU MENU « … » D'UN MÉDIA (décision de l'utilisateur du
 * 26/10/2026 : « ça devrait m'ouvrir un drawer qui me demande l'image target,
 * et ensuite envoyer ») — une FEUILLE DU BAS par option, avec le composant qui
 * lui convient :
 *  - « Remplacer le visage » : les photos du visage (celles de la carte, ou
 *    ajoutées) et la personne à remplacer ;
 *  - « Changer la lumière » : la sphère de lumière ;
 *  - « Autres angles » : l'angle voulu ;
 *  - « Animer ce plan » : l'image de fin (facultative), la durée, le son ;
 *  - « Reprendre ses gestes » : l'image du personnage, l'orientation ;
 *  - « Redemander avec une consigne » : la consigne.
 * Le MEILLEUR MODÈLE est choisi d'office (`realisation.panneau.chiffrer`) ; un
 * second n'est proposé que s'il se vaut vraiment. On choisit 2 à 4 variantes.
 * Le bouton « Envoyer · prix » PORTE LE PRIX et VAUT ACCORD : la génération part
 * aussitôt (`realisation.panneau.lancer`), sans que l'agent repose de question,
 * et les brouillons arrivent au bas de la conversation.
 *
 * La feuille du bas, réservée jusqu'ici au déploiement, sert ici par demande
 * explicite de l'utilisateur ; elle se tire par sa SEULE poignée — la sphère
 * capture son pointeur et ne la ferme pas.
 */

export type OperationDuPanneau = 'visage' | 'lumiere' | 'angles' | 'animer' | 'gestes' | 'consigne';

/* Les libellés, traduits à l'affichage (même idiome que les étapes du suivi). */
export const LIBELLES_OPERATIONS_DU_PANNEAU: Record<OperationDuPanneau, () => string> = {
  visage: () => t('Remplacer le visage'),
  lumiere: () => t('Changer la lumière'),
  angles: () => t('Autres angles'),
  animer: () => t('Animer ce plan'),
  gestes: () => t('Reprendre ses gestes'),
  consigne: () => t('Redemander avec une consigne'),
};

const DESCRIPTIONS_OPERATIONS_DU_PANNEAU: Record<OperationDuPanneau, () => string> = {
  visage: () => t('Choisissez les photos du visage à poser, puis la personne à remplacer.'),
  lumiere: () => t('Déplacez le point : la lumière viendra de là.'),
  angles: () => t('Choisissez l’angle de vue : sujet, style et lumière restent les mêmes.'),
  animer: () => t('L’image validée du plan est l’image de départ ; une image de fin est facultative.'),
  gestes: () => t('Le personnage d’une image refait les gestes de cette vidéo.'),
  consigne: () => t('Dites ce qui doit changer : le reste est gardé.'),
};

interface ModeleDuPanneau {
  service: string;
  modele: string;
  nom: string;
  qualite: number;
  usage: string;
  prix: number | null;
  fin?: boolean;
  sources?: number;
  lumiere?: 'libre' | { azimut: number; elevation: number; libelle: string }[];
}

/** Les pièces jointes du projet, demandées une fois si l'écran ne les a pas encore. */
function usePiecesDuProjet(projectId: string | undefined): Attachment[] {
  const connues = useApp().attachments[projectId ?? ''];
  React.useEffect(() => {
    if (projectId && !connues) client.send({ type: 'attachments.list', projectId });
  }, [projectId, !connues]);
  return connues ?? [];
}

/** UNE GRILLE DE VIGNETTES À CHOISIR : une seule, ou plusieurs (photos du visage). */
function ChoixDImages({
  images,
  choisies,
  onBasculer,
  vide,
  repere,
}: {
  images: { id: string; piece: string; legende: string }[];
  choisies: readonly string[];
  onBasculer: (id: string) => void;
  vide: string;
  repere: string;
}) {
  if (!images.length) return <p className="text-[12.5px] text-faint">{vide}</p>;
  return (
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4" {...{ [`data-${repere}`]: '' }}>
      {images.map((image) => {
        const choisie = choisies.includes(image.id);
        return (
          <button
            key={image.id}
            type="button"
            aria-pressed={choisie}
            title={image.legende}
            onClick={() => onBasculer(image.id)}
            data-image-a-choisir={image.id}
            className={cn('relative aspect-square overflow-hidden rounded-md bg-raised', choisie && 'ring-2 ring-teinte')}
          >
            <ImageDePiece id={image.piece} alt={image.legende} className="h-full w-full object-cover" />
            {choisie ? (
              <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-teinte-plein text-white">
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function Rubrique({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <p className="text-[12px] uppercase tracking-wide text-faint">{titre}</p>
      {children}
    </section>
  );
}

export function PanneauDuMedia({
  ouvert,
  onFermer,
  operation,
  cardId,
  media,
}: {
  ouvert: boolean;
  onFermer: () => void;
  operation: OperationDuPanneau;
  cardId: string;
  media: MediaDuSuivi;
}) {
  const state = useApp();
  const carte = state.cards[cardId];
  const production = useProduction(cardId);
  const piecesDuProjet = usePiecesDuProjet(carte?.projectId);
  const [chiffre, setChiffre] = React.useState<{ modeles: ModeleDuPanneau[]; recommande: string | null; raison?: string } | null>(null);
  const [modele, setModele] = React.useState<string | null>(null);
  const [variantes, setVariantes] = React.useState(2);
  const [photos, setPhotos] = React.useState<string[]>([]);
  const [cible, setCible] = React.useState('');
  const [lumiere, setLumiere] = React.useState<DirectionDeLumiere | null>(null);
  const [angle, setAngle] = React.useState<string>(ANGLES_DE_VUE[0]!);
  const [fin, setFin] = React.useState<string | null>(null);
  const [son, setSon] = React.useState(true);
  const [personnage, setPersonnage] = React.useState<string | null>(null);
  const [orientation, setOrientation] = React.useState<'image' | 'video'>('video');
  const [consigne, setConsigne] = React.useState('');
  const [envoi, setEnvoi] = React.useState(false);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [envoiPhoto, setEnvoiPhoto] = React.useState(false);
  const champPhoto = React.useRef<HTMLInputElement>(null);

  /* LA DURÉE DU PLAN, écrite au découpage : c'est elle que l'animation reprend. */
  const plans = React.useMemo(() => decoupageDuMedia(production?.elements ?? []), [production?.elements]);
  const dureeDuPlan = plans.find((p) => p.cle === planDuMedia(media.plan, plans))?.duree ?? null;
  const [duree, setDuree] = React.useState(5);

  React.useEffect(() => {
    if (!ouvert) return;
    setErreur(null);
    setChiffre(null);
    setModele(null);
    setVariantes(2);
    setPhotos([]);
    setCible('');
    setFin(null);
    setPersonnage(null);
    setConsigne('');
    setDuree(Math.round(Math.min(15, Math.max(3, dureeDuPlan ?? 5))));
    let vivant = true;
    client
      .call<{ modeles: ModeleDuPanneau[]; recommande: string | null; raison?: string }>({
        type: 'realisation.panneau.chiffrer',
        cardId,
        mediaId: media.id,
        operation,
        ...(operation === 'animer' && dureeDuPlan ? { duree: dureeDuPlan } : {}),
      })
      .then((r) => {
        if (!vivant) return;
        setChiffre(r);
        setModele(r.recommande);
      })
      .catch((err: any) => vivant && setErreur(err?.message ?? t('Le prix n’a pas pu être lu')));
    return () => {
      vivant = false;
    };
  }, [ouvert, operation, media.id]);

  const choisi = chiffre?.modeles.find((m) => m.modele === modele) ?? null;
  const validees = (production?.medias ?? []).filter((m) => estRetenu(m) && m.genre === 'image' && !!m.attachmentId && m.id !== media.id);
  const imagesDeLaCarte = validees.map((m) => ({ id: m.id, piece: m.attachmentId!, legende: `${m.plan} v${m.version}` }));
  /* Les photos du visage : les images jointes au projet par l'utilisateur, et celles de la carte. */
  const photosPossibles = [
    ...imagesDeLaCarte,
    ...piecesDuProjet
      .filter((p) => p.mime.startsWith('image/') && p.id !== media.attachmentId && !validees.some((m) => m.attachmentId === p.id))
      .slice(-24)
      .reverse()
      .map((p) => ({ id: p.id, piece: p.id, legende: p.name })),
  ];
  const plafondPhotos = choisi?.sources ?? 3;

  const ajouterUnePhoto = async (fichiers: FileList | null) => {
    if (!fichiers?.length || !carte) return;
    setEnvoiPhoto(true);
    try {
      for (const file of Array.from(fichiers)) {
        const reponse = await fetch(`/api/upload?project=${encodeURIComponent(carte.projectId)}${carte.agentId ? `&agent=${carte.agentId}` : ''}`, {
          method: 'POST',
          headers: { 'content-type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) },
          body: file,
        });
        const data = await reponse.json();
        const jointe: Attachment | undefined = data.attachment;
        if (jointe) setPhotos((avant) => (avant.includes(jointe.id) || avant.length >= plafondPhotos ? avant : [...avant, jointe.id]));
      }
      client.send({ type: 'attachments.list', projectId: carte.projectId });
    } catch {
      client.pushToast('error', t('Envoi du fichier impossible'));
    } finally {
      setEnvoiPhoto(false);
    }
  };

  const manque =
    !choisi
      ? null
      : operation === 'visage' && !photos.length
        ? t('Choisissez au moins une photo du visage.')
        : operation === 'gestes' && !personnage
          ? t('Choisissez l’image du personnage.')
          : operation === 'consigne' && !consigne.trim()
            ? t('Écrivez ce qui doit changer.')
            : null;
  const prixTotal = choisi?.prix === null || choisi?.prix === undefined ? null : choisi.prix * variantes;
  const libelleDuPrix = prixTotal === null ? t('prix non publié') : `${arrondi(prixTotal)} $`;

  const envoyer = async () => {
    if (!choisi || manque || envoi) return;
    setEnvoi(true);
    setErreur(null);
    try {
      await client.call({
        type: 'realisation.panneau.lancer',
        cardId,
        mediaId: media.id,
        operation,
        service: choisi.service,
        modele: choisi.modele,
        variantes,
        ...(consigne.trim() ? { consigne: consigne.trim() } : {}),
        ...(operation === 'visage' ? { photos, cible: cible.trim() || t('la personne principale de l’image') } : {}),
        ...(operation === 'lumiere' && lumiere ? { lumiere: { azimut: lumiere.azimut, elevation: lumiere.elevation } } : {}),
        ...(operation === 'angles' ? { angle } : {}),
        ...(operation === 'animer' ? { duree, son, ...(fin ? { fin } : {}) } : {}),
        ...(operation === 'gestes' && personnage ? { image: personnage, orientation } : {}),
      });
      onFermer();
    } catch (err: any) {
      setErreur(err?.message ?? t('La génération n’a pas pu partir'));
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Drawer open={ouvert} onClose={onFermer} feuille>
      <EnteteDeFeuille titre={LIBELLES_OPERATIONS_DU_PANNEAU[operation]()} sousTitre={DESCRIPTIONS_OPERATIONS_DU_PANNEAU[operation]()} data-panneau-du-media={operation} />
      <ZoneDefilement className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 px-4 pb-4">
          <div className="flex items-center gap-3">
            {media.attachmentId && media.genre === 'image' ? (
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-raised">
                <ImageDePiece id={media.attachmentId} alt={media.plan} className="h-full w-full object-cover" />
              </div>
            ) : null}
            <p className="min-w-0 truncate text-[13px] text-muted">{media.plan}</p>
          </div>

          {operation === 'visage' ? (
            <>
              <Rubrique titre={t('Photos du visage')}>
                <ChoixDImages
                  images={photosPossibles}
                  choisies={photos}
                  onBasculer={(id) => setPhotos((avant) => (avant.includes(id) ? avant.filter((x) => x !== id) : avant.length >= plafondPhotos ? avant : [...avant, id]))}
                  vide={t('Aucune photo pour l’instant : ajoutez-en une.')}
                  repere="photos-du-visage"
                />
                <div className="flex items-center gap-2">
                  <Button type="button" size="sm" variant="ghost" className="gap-1.5" disabled={envoiPhoto} onClick={() => champPhoto.current?.click()} data-ajouter-photo="">
                    {envoiPhoto ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                    {t('Ajouter une photo')}
                  </Button>
                  <span className="text-[12px] text-faint">{t('{n} au plus', { n: plafondPhotos })}</span>
                </div>
                <input ref={champPhoto} type="file" accept="image/*" multiple className="hidden" onChange={(event) => void ajouterUnePhoto(event.target.files)} />
              </Rubrique>
              <Rubrique titre={t('Personne à remplacer')}>
                <Input value={cible} onChange={(e) => setCible(e.target.value)} placeholder={t('la personne principale de l’image')} data-cible-du-visage="" />
              </Rubrique>
            </>
          ) : null}

          {operation === 'lumiere' && choisi ? (
            <Rubrique titre={t('Direction de la lumière')}>
              <SphereDeLumiere
                key={choisi.modele}
                sphere={{ directions: choisi.lumiere ?? 'libre', modele: choisi.nom, ...(media.attachmentId ? { image: media.attachmentId } : {}) }}
                onChange={setLumiere}
              />
            </Rubrique>
          ) : null}

          {operation === 'angles' ? (
            <Rubrique titre={t('Angle de vue')}>
              <BoutonsRadio
                libelle={t('Angle de vue')}
                valeur={angle}
                onChoisir={setAngle}
                options={ANGLES_DE_VUE.map((a) => ({ valeur: a, libelle: t(PARAMETRES_DES_ANGLES[a].libelle) }))}
                className="grid grid-cols-2 gap-1"
                data-angles-du-panneau=""
              />
            </Rubrique>
          ) : null}

          {operation === 'animer' ? (
            <>
              <Rubrique titre={t('Image de fin (facultative)')}>
                <ChoixDImages
                  images={imagesDeLaCarte}
                  choisies={fin ? [fin] : []}
                  onBasculer={(id) => setFin((avant) => (avant === id ? null : id))}
                  vide={t('Aucune autre image validée : le plan s’animera sans image de fin.')}
                  repere="image-de-fin"
                />
                {fin && choisi && !choisi.fin ? <p className="text-[12px] text-faint">{t('Ce modèle ne prend pas d’image de fin : elle sera ignorée.')}</p> : null}
              </Rubrique>
              <Rubrique titre={t('Durée')}>
                <div className="flex items-center gap-3" data-duree-du-plan={duree}>
                  <Curseur valeur={duree} min={3} max={15} onChange={setDuree} onValider={setDuree} aria-label="Durée" className="flex-1" />
                  <span className="w-12 shrink-0 text-right text-[13px] tabular-nums text-text">{t('{n} s', { n: duree })}</span>
                </div>
              </Rubrique>
              <label className="flex items-center justify-between gap-3 text-[13px] text-text">
                {t('Son d’ambiance')}
                <Switch checked={son} onCheckedChange={setSon} data-son-du-plan="" />
              </label>
            </>
          ) : null}

          {operation === 'gestes' ? (
            <>
              <Rubrique titre={t('Image du personnage')}>
                <ChoixDImages
                  images={imagesDeLaCarte}
                  choisies={personnage ? [personnage] : []}
                  onBasculer={(id) => setPersonnage((avant) => (avant === id ? null : id))}
                  vide={t('Validez d’abord l’image du personnage dans les esquisses.')}
                  repere="image-du-personnage"
                />
              </Rubrique>
              <Rubrique titre={t('Orientation')}>
                <BoutonsRadio
                  libelle={t('Orientation')}
                  valeur={orientation}
                  onChoisir={(v) => setOrientation(v === 'image' ? 'image' : 'video')}
                  options={[
                    { valeur: 'video', libelle: t('D’après la vidéo') },
                    { valeur: 'image', libelle: t('D’après l’image') },
                  ]}
                />
              </Rubrique>
            </>
          ) : null}

          {operation === 'consigne' || operation === 'visage' || operation === 'lumiere' || operation === 'angles' || operation === 'animer' ? (
            <Rubrique titre={operation === 'consigne' ? t('Ce qui doit changer') : t('Précision (facultative)')}>
              <Textarea value={consigne} onChange={(e) => setConsigne(e.target.value)} rows={3} data-consigne-du-panneau="" />
            </Rubrique>
          ) : null}

          <Rubrique titre={t('Modèle')}>
            {!chiffre && !erreur ? (
              <p className="flex items-center gap-1.5 text-[13px] text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('Choix du meilleur modèle…')}
              </p>
            ) : chiffre && !chiffre.modeles.length ? (
              <p className="text-[13px] text-muted">{chiffre.raison ? t(chiffre.raison) : t('Aucun modèle disponible.')}</p>
            ) : chiffre && chiffre.modeles.length === 1 ? (
              <p className="text-[13px] text-text" data-modele-du-panneau={chiffre.modeles[0]!.modele}>
                {chiffre.modeles[0]!.nom}
                <span className="text-faint"> · {t('qualité {q}/5', { q: chiffre.modeles[0]!.qualite })} · {chiffre.modeles[0]!.prix === null ? t('prix non publié') : t('{prix} par variante', { prix: `${arrondi(chiffre.modeles[0]!.prix)} $` })}</span>
              </p>
            ) : chiffre ? (
              <BoutonsRadio
                libelle={t('Modèle')}
                valeur={modele ?? ''}
                onChoisir={setModele}
                options={chiffre.modeles.map((m) => ({
                  valeur: m.modele,
                  libelle: m.nom,
                  detail: `${t('qualité {q}/5', { q: m.qualite })} · ${m.prix === null ? t('prix non publié') : t('{prix} par variante', { prix: `${arrondi(m.prix)} $` })}`,
                }))}
                data-modeles-du-panneau=""
              />
            ) : null}
          </Rubrique>

          <Rubrique titre={t('Variantes')}>
            <div className="flex gap-1.5" role="radiogroup" aria-label="Variantes" data-variantes-du-panneau={variantes}>
              {[2, 3, 4].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={variantes === n}
                  onClick={() => setVariantes(n)}
                  className={cn('h-8 min-w-10 rounded-md px-3 text-[13px] tabular-nums transition-colors', variantes === n ? 'bg-teinte-plein text-white' : 'bg-raised text-text hover:bg-raised/70')}
                >
                  {n}
                </button>
              ))}
            </div>
          </Rubrique>

          {erreur ? <p className="text-[12.5px] text-danger" data-erreur-du-panneau="">{erreur}</p> : null}
        </div>
      </ZoneDefilement>
      <div className="flex shrink-0 items-center justify-end gap-2 px-4 pb-3 pt-2">
        {manque ? <span className="mr-auto min-w-0 truncate text-[12px] text-faint">{manque}</span> : null}
        <Button type="button" variant="ghost" size="sm" onClick={onFermer}>
          {t('Annuler')}
        </Button>
        <Button
          type="button"
          size="sm"
          className="gap-1.5 bg-accent text-accent-fg hover:opacity-90"
          disabled={!choisi || !!manque || envoi}
          aria-busy={envoi}
          onClick={() => void envoyer()}
          data-envoyer-le-panneau=""
          data-prix-du-panneau={prixTotal === null ? 'non-publie' : String(prixTotal)}
        >
          {envoi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {t('Envoyer · {prix}', { prix: libelleDuPrix })}
        </Button>
      </div>
    </Drawer>
  );
}
