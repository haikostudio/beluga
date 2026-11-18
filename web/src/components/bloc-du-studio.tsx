/**
 * LE BLOC DE SUIVI D'UNE CRÉATION DU STUDIO, DANS LE FIL DE L'AGENT QUI L'A DEMANDÉE (carte « Campagne, studio et mode
 * du champ », 11/11/2026, capture #b1ff).
 *
 * Le démon tient le bloc (`server/src/suivi-studio.ts`) et le réécrit à chaque étape ; l'écran en fait un LECTEUR :
 *  - tant qu'aucun export n'est prêt, l'APERÇU EN DIRECT de la composition courante — la même page que l'éditeur
 *    (`Apercu`), mais en LECTURE SEULE : un voile capte tous les gestes (ni sélection, ni retouche) et un clic lit ou
 *    met en pause. Il ne se monte qu'AU CLIC : un long fil de campagne ne charge pas un cadre lourd par bloc. Les
 *    adresses signées des médias sont redemandées à chaque ouverture (elles expirent), et l'aperçu se relit quand la
 *    version de la création change ;
 *  - dès qu'un export est prêt, le FICHIER FINI dans le lecteur vidéo commun (`LecteurVideo`), format par format ;
 *  - puis, chacun SUR SA LIGNE : l'étape, l'échec éventuel, les formats prêts, et « Ouvrir dans le Studio » SEUL en bas.
 * Les boutons à prix (miroirs des questions du directeur) se posent sous le bloc, comme toute question.
 */
import * as React from 'react';
import { Check, Circle, Clapperboard, Image as ImageIcon, Loader2, Maximize2, Pause, Play, TriangleAlert, X } from '@/components/ui/icones';
import { FORMATS_STUDIO, dureeExportee, estFormatStudio, type FormatStudio, type SuiviStudioDuMessage } from '@beluga/shared';
import { Apercu, type MessageDuCadre, type PoigneeApercu } from '@/components/studio/apercu';
import type { DonneesCreation } from '@/components/studio/types';
import { LecteurVideo, tempsDeLecture } from '@/components/lecteur-video';
import { adresseDePiece } from '@/components/pastille-de-fichier';
import { BoutonOuvrirLeStudio } from '@/lib/markdown';
import { Button, Dialog, DialogContentLibre, DialogHeader, DialogTitle } from '@/components/ui';
import { Markdown } from '@/lib/markdown';
import { ouvrirUnMedia } from '@/lib/ouvrir-un-media';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/** La boîte d'un format, bornée : un 9:16 ne mange pas tout l'écran, un 16:9 prend la largeur du fil. */
function styleDuCadre(format: FormatStudio): React.CSSProperties {
  const { largeur, hauteur } = FORMATS_STUDIO[format];
  return { aspectRatio: `${largeur} / ${hauteur}`, width: '100%', maxWidth: largeur >= hauteur ? '100%' : hauteur / largeur > 1.5 ? 260 : 340 };
}

export function BlocDuStudio({ suivi }: { suivi: SuiviStudioDuMessage }) {
  const image = suivi.genre === 'image';
  const [choisi, setChoisi] = React.useState<string | null>(null);
  const exportLu = suivi.exports.find((e) => e.exportId === choisi) ?? suivi.exports[0] ?? null;
  const format: FormatStudio = estFormatStudio(exportLu?.format) ? exportLu!.format as FormatStudio : estFormatStudio(suivi.formats[0]) ? (suivi.formats[0] as FormatStudio) : '9:16';
  const Icone = image ? ImageIcon : Clapperboard;

  return (
    <div className="my-1 flex flex-col gap-2" data-bloc-du-studio={suivi.creationId} data-bloc-du-studio-etape={suivi.etape}>
      <p className="flex min-w-0 items-center gap-2 text-[14.5px] font-medium text-text">
        <Icone className="h-4 w-4 shrink-0 text-muted" />
        <span className="truncate">{image ? t('Image « {titre} »', { titre: suivi.titre }) : t('Vidéo « {titre} »', { titre: suivi.titre })}</span>
      </p>

      {exportLu ? (
        image ? (
          <ImageAgrandissable piece={exportLu.attachmentId} titre={suivi.titre} format={format} repere={{ 'data-bloc-du-studio-fichier': exportLu.attachmentId }} />
        ) : (
          /* Le lecteur commun garde ses proportions : seule la largeur est bornée (un cadre à hauteur fixée laissait un vide dessous). */
          <div className="w-full" style={{ maxWidth: styleDuCadre(format).maxWidth }} data-bloc-du-studio-fichier={exportLu.attachmentId}>
            <LecteurVideo key={exportLu.attachmentId} id={exportLu.attachmentId} nom={suivi.titre} />
          </div>
        )
      ) : suivi.apercu ? (
        <ImageAgrandissable piece={suivi.apercu} titre={suivi.titre} format={format} repere={{ 'data-bloc-du-studio-apercu-image': suivi.apercu }} />
      ) : image ? null : (
        <ApercuEnLecture creationId={suivi.creationId} version={suivi.version} format={format} titre={suivi.titre} />
      )}

      <TravailDuDirecteur suivi={suivi} />

      <p className="flex items-center gap-1.5 text-[13px] text-muted" data-bloc-du-studio-phrase>
        {suivi.exportEnCours ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-teinte" /> : null}
        <span>
          {suivi.phrase}
          {suivi.exportEnCours ? ` — ${t('export en cours')}` : ''}
        </span>
      </p>

      {suivi.echec ? (
        <p className="flex items-start gap-1.5 text-[13px] text-danger" data-bloc-du-studio-echec>
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t('Le dernier export a échoué : {erreur}', { erreur: suivi.echec })}</span>
        </p>
      ) : null}

      {suivi.exports.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1" data-bloc-du-studio-formats>
          <span className="mr-1 text-[13px] text-muted">{t('Formats prêts')}</span>
          {suivi.exports.map((e) => (
            <Button
              key={e.exportId}
              variant="ghost"
              size="sm"
              className={cn('h-7', e.exportId === exportLu?.exportId && 'bg-raised text-teinte')}
              onClick={() => setChoisi(e.exportId)}
              data-bloc-du-studio-format={e.format}
            >
              {e.format}
            </Button>
          ))}
        </div>
      ) : suivi.exports.length === 1 ? (
        <p className="text-[13px] text-muted" data-bloc-du-studio-formats>
          {t('Format prêt : {format}', { format: suivi.exports[0]!.format })}
        </p>
      ) : null}

      <BoutonOuvrirLeStudio adresse={`#studio/${encodeURIComponent(suivi.creationId)}`}>{t('Ouvrir dans le Studio')}</BoutonOuvrirLeStudio>
    </div>
  );
}

/**
 * UNE IMAGE DU BLOC S'AGRANDIT COMME LES IMAGES GÉNÉRÉES (12/11/2026) : un clic l'ouvre dans la visionneuse de
 * l'application (`ouvrirUnMedia`), jamais dans un onglet.
 */
function ImageAgrandissable({ piece, titre, format, repere }: { piece: string; titre: string; format: FormatStudio; repere: Record<string, string> }) {
  return (
    <button
      type="button"
      onClick={() => ouvrirUnMedia({ adresse: adresseDePiece(piece), piece, genre: 'image', nom: titre })}
      className="block cursor-zoom-in self-start overflow-hidden rounded-md bg-raised"
      style={styleDuCadre(format)}
      aria-label="Agrandir"
      title={t('Agrandir')}
      data-bloc-du-studio-agrandir={piece}
    >
      <img src={adresseDePiece(piece)} alt={titre} className="h-full w-full object-contain" {...repere} />
    </button>
  );
}

/**
 * CE QUE FAIT LE DIRECTEUR DU STUDIO, EN DIRECT (12/11/2026, capture #8adf : l'agent promettait un suivi « ci-dessous »
 * qui n'existait pas). Sa liste de tâches relayée par le démon, ligne par ligne — violet pour celle en cours —, puis,
 * son tour fini, son compte rendu court.
 */
function TravailDuDirecteur({ suivi }: { suivi: SuiviStudioDuMessage }) {
  const taches = suivi.taches ?? [];
  if (!taches.length && !suivi.directeurAuTravail && !suivi.compteRendu) return null;
  return (
    <div className="flex flex-col gap-1.5 rounded-xl bg-surface px-3 py-2.5" data-bloc-du-studio-taches={suivi.directeurAuTravail ? 'en-cours' : 'fini'}>
      <p className={cn('flex items-center gap-1.5 text-[12.5px] font-medium', suivi.directeurAuTravail ? 'text-teinte' : 'text-muted')}>
        {suivi.directeurAuTravail ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <Check className="h-3.5 w-3.5 shrink-0" />}
        {suivi.directeurAuTravail ? t('Le directeur du Studio travaille') : t('Le directeur du Studio a fini')}
      </p>
      {taches.length ? (
        <ul className="flex flex-col gap-1">
          {taches.map((tache, i) => (
            <li key={`${i}-${tache.label}`} className="flex min-w-0 items-start gap-2 text-[13px] leading-snug" data-bloc-du-studio-tache={tache.state}>
              <span className="mt-0.5 shrink-0">
                {tache.state === 'running' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-teinte" />
                ) : tache.state === 'done' ? (
                  <Check className="h-3.5 w-3.5 text-muted" />
                ) : tache.state === 'unfinished' ? (
                  <X className="h-3.5 w-3.5 text-faint" />
                ) : (
                  <Circle className="h-3.5 w-3.5 text-faint" />
                )}
              </span>
              <span className={cn('min-w-0 flex-1', tache.state === 'running' ? 'text-teinte' : tache.state === 'done' ? 'text-muted' : 'text-text')}>{tache.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {!suivi.directeurAuTravail && suivi.compteRendu ? (
        <div className="text-[13px] leading-relaxed text-text" data-bloc-du-studio-compte-rendu>
          <Markdown content={suivi.compteRendu} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * L'APERÇU EN DIRECT, EN LECTURE SEULE. Rien ne se charge avant le clic ; ensuite la création est relue
 * (`studio.creation.ouvrir`) à chaque nouvelle version, pour des adresses de médias fraîches.
 */
function ApercuEnLecture({ creationId, version, format, titre }: { creationId: string; version: number; format: FormatStudio; titre: string }) {
  const [ouvert, setOuvert] = React.useState(false);
  /* L'APERÇU S'AGRANDIT (12/11/2026) : la même composition, dans une fenêtre, à la taille de l'écran. */
  const [grand, setGrand] = React.useState(false);
  const poigneeEnGrand = React.useRef<PoigneeApercu | null>(null);
  const [donnees, setDonnees] = React.useState<DonneesCreation | null>(null);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [lecture, setLecture] = React.useState(false);
  const [temps, setTemps] = React.useState(0);
  const poignee = React.useRef<PoigneeApercu | null>(null);

  React.useEffect(() => {
    if (!ouvert) return;
    let vivant = true;
    setErreur(null);
    client
      .call<DonneesCreation>({ type: 'studio.creation.ouvrir', id: creationId })
      .then((r) => {
        if (!vivant) return;
        setDonnees(r);
        setLecture(true);
      })
      .catch((err: any) => vivant && setErreur(err?.message ?? t('Aperçu indisponible')));
    return () => {
      vivant = false;
    };
  }, [ouvert, creationId, version]);

  const formatLu: FormatStudio = donnees && !donnees.creation.formats.includes(format) ? (donnees.creation.formats[0] ?? format) : format;
  const duree = donnees ? dureeExportee(donnees.composition) : 0;

  /* La lecture part dès que le cadre est prêt, puis se commande d'un clic sur l'image. */
  const surMessage = React.useCallback((m: MessageDuCadre) => {
    if (m.type === 'pret') poignee.current?.lire(0);
    else if (m.type === 'temps' && typeof m.t === 'number') setTemps(m.t);
    else if (m.type === 'fin') {
      setLecture(false);
      if (typeof m.t === 'number') setTemps(m.t);
    }
  }, []);

  const basculer = () => {
    if (!donnees) return;
    if (lecture) {
      poignee.current?.pause();
      setLecture(false);
    } else {
      poignee.current?.lire(temps >= duree - 0.05 ? 0 : temps);
      setLecture(true);
    }
  };

  if (!ouvert) {
    return (
      <button
        type="button"
        onClick={() => setOuvert(true)}
        className="flex items-center justify-center rounded-md bg-raised text-muted hover:bg-fond-survol hover:text-text"
        style={styleDuCadre(format)}
        data-bloc-du-studio-lire-apercu
      >
        <span className="flex flex-col items-center gap-2 text-[13px]">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface">
            <Play className="h-5 w-5" />
          </span>
          {t('Voir la dernière version')}
        </span>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5" style={{ maxWidth: styleDuCadre(formatLu).maxWidth }}>
      <div className="relative overflow-hidden rounded-md bg-raised" style={styleDuCadre(formatLu)} data-bloc-du-studio-apercu={donnees ? 'pret' : 'chargement'}>
        {donnees ? (
          <Apercu
            ref={poignee}
            composition={donnees.composition}
            format={formatLu}
            kit={donnees.espace.kit}
            adressesMedias={donnees.adressesMedias}
            temps={0}
            lecture={lecture}
            onMessage={surMessage}
            className="absolute inset-0 flex items-center justify-center"
          />
        ) : erreur ? (
          <p className="absolute inset-0 flex items-center justify-center p-3 text-center text-[13px] text-danger">{erreur}</p>
        ) : (
          <div className="absolute inset-0 animate-pulse bg-raised" />
        )}
        {/* LECTURE SEULE : le voile capte tous les gestes — aucune pièce ne se choisit ni ne se déplace ici. */}
        <button type="button" aria-label={lecture ? t('Pause') : t('Lire')} className="absolute inset-0 z-10 cursor-pointer" onClick={basculer} data-bloc-du-studio-voile />
      </div>
      <div className="flex items-center gap-2 text-[12.5px] text-muted">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={basculer} disabled={!donnees} aria-label={lecture ? t('Pause') : t('Lire')} data-bloc-du-studio-lecture={lecture ? 'lit' : 'arret'}>
          {lecture ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </Button>
        <span className="tabular-nums">
          {tempsDeLecture(temps)} / {tempsDeLecture(duree)}
        </span>
        <span className="min-w-0 flex-1 truncate">{t('Aperçu en direct, version {version}', { version: donnees?.creation.version ?? version })}</span>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setGrand(true)} disabled={!donnees} aria-label="Agrandir" title={t('Agrandir')} data-bloc-du-studio-agrandir-apercu>
          <Maximize2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {grand && donnees ? (
        <Dialog open onOpenChange={(o) => !o && setGrand(false)}>
          <DialogContentLibre adresse="apercu-studio" className="sm:w-[min(1100px,100%)]" data-fenetre-apercu-studio={creationId}>
            <DialogHeader className="pb-3">
              <DialogTitle className="min-w-0 truncate text-[14.5px]">{titre}</DialogTitle>
            </DialogHeader>
            <div className="flex justify-center px-4 pb-4">
              <div
                className="relative overflow-hidden rounded-md bg-raised"
                style={{ ...styleDuCadre(formatLu), maxWidth: FORMATS_STUDIO[formatLu].largeur >= FORMATS_STUDIO[formatLu].hauteur ? '100%' : 'min(100%, 40vh)' }}
              >
                <Apercu
                  ref={poigneeEnGrand}
                  composition={donnees.composition}
                  format={formatLu}
                  kit={donnees.espace.kit}
                  adressesMedias={donnees.adressesMedias}
                  temps={0}
                  lecture
                  onMessage={(m) => m.type === 'pret' && poigneeEnGrand.current?.lire(0)}
                  className="absolute inset-0 flex items-center justify-center"
                />
              </div>
            </div>
          </DialogContentLibre>
        </Dialog>
      ) : null}
    </div>
  );
}
