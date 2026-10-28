import * as React from 'react';
import { Check, ImagePlus, Images, Loader2, Upload, X } from 'lucide-react';
import type { BoiteDeVisage } from '@beluga/shared';
import { ActionTiroir, Button, DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, ZoneDefilement, ouvertureAuClic } from '@/components/ui';
import { adresseDePiece, ImageDePiece } from '@/components/pastille-de-fichier';
import { analyserLesPieces, detecterLesVisages, visagesConnus } from '@/lib/detection-des-visages';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * « REMPLACER LE VISAGE », EN DEUX MOITIÉS (décision du 26/10/2026, captures
 * #7cc3 et #7a99).
 *
 *  - À GAUCHE, l'image d'origine : ses visages sont repérés dans le
 *    navigateur (`detection-des-visages.ts`) et entourés ; un clic désigne
 *    celui à remplacer (seul visage : choisi d'office). Le cadre choisi part au
 *    démon, qui le dit en mots au modèle (`phraseDeVisageCible`). Le champ
 *    texte « Personne à remplacer » a disparu.
 *  - À DROITE, la zone du visage à poser : un bouton ouvre « Choisir dans la
 *    bibliothèque » ou « Envoyer une photo ». La bibliothèque ne montre QUE
 *    les photos où un visage a été repéré, prises dans ce projet et dans cette
 *    création, les plus récentes en tête — jamais une capture de site. Une
 *    photo envoyée sans visage repéré n'est pas refusée : on le dit.
 */

export interface CandidatDeVisage {
  /** Ce qui part au démon : l'identifiant d'un média de la carte, ou d'une pièce du projet. */
  id: string;
  /** La pièce jointe montrée (et analysée). */
  piece: string;
  legende: string;
  quand: number;
}

/** Au-delà, les plus anciennes images du projet ne sont pas analysées : la bibliothèque reste rapide. */
const PLAFOND_D_ANALYSE = 60;

export function ChoixDuVisage({
  projectId,
  source,
  candidats,
  photos,
  plafond,
  onBasculerPhoto,
  onEnvoyer,
  envoiEnCours,
  onCible,
}: {
  projectId: string;
  /** La pièce jointe de l'image d'origine. */
  source: string | null;
  candidats: readonly CandidatDeVisage[];
  photos: readonly string[];
  plafond: number;
  onBasculerPhoto: (id: string) => void;
  /** Les fichiers choisis sur l'appareil : envoyés, puis ajoutés aux photos. */
  onEnvoyer: (fichiers: FileList | null) => void;
  envoiEnCours: boolean;
  /** Le visage à remplacer (et tous ceux repérés), ou `null` tant qu'il reste à cliquer. */
  onCible: (cible: { choisi: BoiteDeVisage | null; tous: BoiteDeVisage[]; aChoisir: boolean }) => void;
}) {
  /* --- L'image d'origine et ses visages --- */
  const [visages, setVisages] = React.useState<BoiteDeVisage[] | null>(null);
  const [echecDetection, setEchecDetection] = React.useState(false);
  const [choisi, setChoisi] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (!source) return;
    let vivant = true;
    setVisages(null);
    setChoisi(null);
    setEchecDetection(false);
    detecterLesVisages(source)
      .then((boites) => {
        if (!vivant) return;
        setVisages(boites);
        if (boites.length === 1) setChoisi(0);
      })
      .catch(() => {
        if (!vivant) return;
        setVisages([]);
        setEchecDetection(true);
      });
    return () => {
      vivant = false;
    };
  }, [source]);
  React.useEffect(() => {
    const tous = visages ?? [];
    onCible({ choisi: choisi !== null ? (tous[choisi] ?? null) : null, tous, aChoisir: tous.length > 1 && choisi === null });
  }, [visages, choisi]);

  /* --- La bibliothèque : les visages déjà repérés, puis l'analyse des pièces inconnues --- */
  const [bibliotheque, setBibliotheque] = React.useState(false);
  const [connus, setConnus] = React.useState<Map<string, BoiteDeVisage[]> | null>(null);
  const [enAnalyse, setEnAnalyse] = React.useState(0);
  const tries = React.useMemo(
    () => [...candidats].filter((c) => c.piece !== source).sort((a, b) => b.quand - a.quand).slice(0, PLAFOND_D_ANALYSE),
    [candidats, source],
  );
  const signature = tries.map((c) => c.piece).join(',');
  React.useEffect(() => {
    if (!bibliotheque) return;
    let vivant = true;
    (async () => {
      const deja = connus ?? (await visagesConnus(projectId).catch(() => new Map<string, BoiteDeVisage[]>()));
      if (!vivant) return;
      setConnus(new Map(deja));
      const inconnues = [...new Set(tries.map((c) => c.piece))].filter((piece) => !deja.has(piece));
      setEnAnalyse(inconnues.length);
      await analyserLesPieces(
        projectId,
        inconnues,
        (piece, boites) => {
          if (!vivant) return;
          setConnus((avant) => new Map(avant ?? []).set(piece, boites));
          setEnAnalyse((n) => Math.max(0, n - 1));
        },
        () => vivant,
      );
      if (vivant) setEnAnalyse(0);
    })();
    return () => {
      vivant = false;
    };
  }, [bibliotheque, signature, projectId]);
  const visagesDeLaBibliotheque = tries.filter((c) => (connus?.get(c.piece)?.length ?? 0) > 0);

  /* --- Les photos choisies : une photo sans visage repéré se signale --- */
  const pieceDe = (id: string) => candidats.find((c) => c.id === id)?.piece ?? id;
  const [sansVisage, setSansVisage] = React.useState<Set<string>>(new Set());
  React.useEffect(() => {
    for (const id of photos) {
      const piece = pieceDe(id);
      const connu = connus?.get(piece);
      if (connu) {
        if (!connu.length) setSansVisage((avant) => new Set(avant).add(id));
        continue;
      }
      void detecterLesVisages(piece)
        .then((boites) => {
          setConnus((avant) => new Map(avant ?? []).set(piece, boites));
          if (!boites.length) setSansVisage((avant) => new Set(avant).add(id));
          void client.call({ type: 'visages.ecrire', projectId, resultats: [{ attachmentId: piece, boites }] }).catch(() => {});
        })
        .catch(() => {});
    }
  }, [photos.join(',')]);

  const champ = React.useRef<HTMLInputElement>(null);
  const [menu, setMenu] = React.useState(false);
  const plein = photos.length >= plafond;

  return (
    <div className="flex flex-col gap-3" data-choix-du-visage="">
      <div className="grid gap-3 sm:grid-cols-2">
        {/* À GAUCHE : l'image d'origine, ses visages entourés. */}
        <section className="flex min-w-0 flex-col gap-1.5" data-image-d-origine="">
          <p className="text-[12px] uppercase tracking-wide text-faint">{t('Image d’origine')}</p>
          {source ? (
            <div className="relative w-fit max-w-full overflow-hidden rounded-md bg-raised">
              <img src={adresseDePiece(source, false, 960)} alt="" className="block max-h-72 w-auto max-w-full" draggable={false} />
              {(visages ?? []).map((b, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setChoisi(i)}
                  aria-pressed={choisi === i}
                  title={t('Remplacer ce visage')}
                  data-visage-detecte={i}
                  data-visage-choisi={choisi === i ? '' : undefined}
                  className={cn(
                    'absolute rounded-md transition-shadow',
                    choisi === i ? 'ring-2 ring-teinte' : 'ring-1 ring-text/60 hover:ring-2 hover:ring-text',
                  )}
                  style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.largeur * 100}%`, height: `${b.hauteur * 100}%` }}
                >
                  {choisi === i ? (
                    <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-surface text-teinte">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
          <p className="text-[12.5px] leading-snug text-muted" data-etat-des-visages={visages === null ? 'analyse' : visages.length}>
            {visages === null ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t('Recherche des visages…')}
              </span>
            ) : echecDetection ? (
              t('Les visages n’ont pas pu être repérés : la personne principale de l’image sera remplacée.')
            ) : visages.length === 0 ? (
              t('Aucun visage repéré : la personne principale de l’image sera remplacée.')
            ) : visages.length === 1 ? (
              t('Un visage repéré : c’est lui qui sera remplacé.')
            ) : choisi === null ? (
              t('{n} visages repérés : cliquez celui à remplacer.', { n: visages.length })
            ) : (
              t('Visage n° {i} sur {n} : il sera remplacé.', { i: choisi + 1, n: visages.length })
            )}
          </p>
        </section>

        {/* À DROITE : le visage à poser. */}
        <section className="flex min-w-0 flex-col gap-1.5" data-zone-du-visage={photos.length}>
          <p className="text-[12px] uppercase tracking-wide text-faint">{t('Visage à poser')}</p>
          <div className="flex min-h-[9rem] flex-col items-center justify-center gap-2 rounded-md bg-raised p-3">
            {photos.length ? (
              <div className="flex flex-wrap justify-center gap-2">
                {photos.map((id) => (
                  <div key={id} className="relative h-20 w-20 overflow-hidden rounded-md bg-surface" data-photo-du-visage={id}>
                    <ImageDePiece id={pieceDe(id)} alt="" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => onBasculerPhoto(id)}
                      title={t('Retirer')}
                      aria-label="Retirer"
                      className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-surface/85 text-text"
                    >
                      <X className="h-3 w-3" />
                    </button>
                    {sansVisage.has(id) ? (
                      <span className="absolute inset-x-0 bottom-0 bg-surface/85 px-1 text-center text-[10px] leading-4 text-warning">{t('aucun visage repéré')}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-[12.5px] text-muted">{t('Choisissez la photo du visage à poser.')}</p>
            )}
            <DropdownMenu open={menu} onOpenChange={setMenu}>
              <DropdownMenuTrigger asChild {...ouvertureAuClic(() => setMenu(true))}>
                <Button type="button" size="sm" variant="ghost" className="gap-1.5" disabled={plein || envoiEnCours} data-ajouter-un-visage="">
                  {envoiEnCours ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                  {photos.length ? t('Ajouter un visage') : t('Choisir un visage')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" collisionPadding={8} className="min-w-[220px]">
                <ActionTiroir
                  icone={<Images className="h-4 w-4" />}
                  onClick={() => {
                    setBibliotheque(true);
                    setMenu(false);
                  }}
                  data-ouvrir-bibliotheque=""
                >
                  {t('Choisir dans la bibliothèque')}
                </ActionTiroir>
                <ActionTiroir
                  icone={<Upload className="h-4 w-4" />}
                  onClick={() => {
                    setMenu(false);
                    champ.current?.click();
                  }}
                  data-envoyer-une-photo=""
                >
                  {t('Envoyer une photo')}
                </ActionTiroir>
              </DropdownMenuContent>
            </DropdownMenu>
            <span className="text-[12px] text-faint">{t('{n} au plus', { n: plafond })}</span>
            <input ref={champ} type="file" accept="image/*" multiple className="hidden" onChange={(event) => onEnvoyer(event.target.files)} />
          </div>
        </section>
      </div>

      {/* LA BIBLIOTHÈQUE : seulement des visages. */}
      {bibliotheque ? (
        <section className="flex flex-col gap-1.5" data-bibliotheque-des-visages={visagesDeLaBibliotheque.length}>
          <div className="flex items-center gap-2">
            <p className="text-[12px] uppercase tracking-wide text-faint">{t('Bibliothèque des visages')}</p>
            {enAnalyse > 0 ? (
              <span className="inline-flex items-center gap-1 text-[12px] text-faint">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t('{n} image(s) à examiner', { n: enAnalyse })}
              </span>
            ) : null}
            <span className="flex-1" />
            <Button type="button" size="sm" variant="ghost" onClick={() => setBibliotheque(false)}>
              {t('Fermer')}
            </Button>
          </div>
          <ZoneDefilement className="max-h-72">
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
              {visagesDeLaBibliotheque.map((c) => {
                const retenue = photos.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={retenue}
                    title={c.legende}
                    disabled={!retenue && plein}
                    onClick={() => onBasculerPhoto(c.id)}
                    data-visage-de-bibliotheque={c.id}
                    className={cn('relative aspect-square overflow-hidden rounded-md bg-raised disabled:opacity-50', retenue && 'ring-2 ring-teinte')}
                  >
                    <ImageDePiece id={c.piece} alt={c.legende} className="h-full w-full object-cover" />
                    {retenue ? (
                      <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-surface text-teinte">
                        <Check className="h-3 w-3" strokeWidth={3} />
                      </span>
                    ) : null}
                  </button>
                );
              })}
              {/* Les images encore à examiner : leur silhouette, jamais un vide. */}
              {Array.from({ length: connus === null ? 6 : Math.min(enAnalyse, 10) }, (_, i) => (
                <span key={`silhouette-${i}`} className="aspect-square animate-pulse rounded-md bg-raised motion-reduce:animate-none" aria-hidden data-visage-silhouette="" />
              ))}
            </div>
            {connus !== null && enAnalyse === 0 && !visagesDeLaBibliotheque.length ? (
              <p className="py-2 text-[12.5px] text-muted">{t('Aucune photo de visage dans ce projet pour l’instant : envoyez-en une.')}</p>
            ) : null}
          </ZoneDefilement>
        </section>
      ) : null}
    </div>
  );
}
