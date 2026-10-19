import * as React from 'react';
import { BookOpen, Clapperboard, Download, FileText, FileType, Loader2, Pause, Play, Rocket, VideoOff } from 'lucide-react';
import {
  Card,
  LIBELLES_PHASES_DE_REALISATION,
  etatDeLaRealisation,
  LIBELLES_TYPES_DE_MEDIA_DE_REALISATION,
  nomDeLaRealisationExportee,
  partiesDuCahier,
  pauseDeRealisationPossible,
  pourcentageDeLaRealisation,
  realisationDeLaCarte,
  repriseDeRealisationPossible,
  typesDeMediaDeLaRealisation,
} from '@beluga/shared';
import {
  Button,
  DialogTitle,
  Drawer,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
  ZoneDefilement,
} from '@/components/ui';
import { useTelechargement } from '@/lib/telechargement';
import { BarreProgression } from '@/components/barre-progression';
import { Silhouette } from '@/components/silhouettes';
import { client } from '@/lib/client';
import { BoutonCopierDocument } from '@/components/bouton-copier-document';
import { Markdown } from '@/lib/markdown';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * LE BANDEAU DU VOLET DE RÉALISATION (caméra), à la place de la barre
 * d'écriture — le jumeau de `BandeauCahierDesCharges`.
 *
 * Tant qu'aucun type de média n'est choisi, il ne pose AUCUNE question et ne
 * lance rien : il dit seulement que le premier message partira au cadrage, dont
 * la première question (quels types de média, audio compris) se pose dans la
 * discussion. Ensuite il dit où en est le questionnaire — phase, pourcentage, pause —, ouvre le document tel
 * qu'il s'écrit, et, une fois tout tranché, porte « Lancer la fabrication ».
 * Les règles sont dans `shared/src/mode-realisation.ts` ; ce composant dessine.
 */
export function BandeauDeRealisation({ carte }: { carte: Card }) {
  const realisation = realisationDeLaCarte(carte);
  const [geste, setGeste] = React.useState<string | null>(null);
  const [lecture, setLecture] = React.useState(false);

  const etat = etatDeLaRealisation(realisation);
  const types = typesDeMediaDeLaRealisation(realisation);
  const pourcent = pourcentageDeLaRealisation(realisation);
  const pause = pauseDeRealisationPossible(realisation);
  const reprise = repriseDeRealisationPossible(realisation);

  /* UN BOUTON QUI PART EN REQUÊTE LE DIT DÈS LE CLIC : roue pendant l'attente,
     refus dit en rouge. */
  const agir = async (quoi: string, appel: () => Promise<unknown>) => {
    setGeste(quoi);
    try {
      await appel();
    } catch (err: any) {
      client.signalerRefus(err?.message ?? t('Geste refusé'), carte.id);
    } finally {
      setGeste(null);
    }
  };
  const eteindre = (
    <Tooltip label={t('Quitter le mode réalisation : la conversation redevient ordinaire, rien n’est effacé')}>
      <Button
        size="icon"
        variant="ghost"
        className="shrink-0"
        aria-label="Quitter le mode réalisation"
        disabled={geste !== null}
        onClick={() => agir('eteindre', () => client.call({ type: 'card.realisation.souhaitee', cardId: carte.id, actif: false }))}
        data-realisation-eteindre
      >
        {geste === 'eteindre' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <VideoOff className="h-3.5 w-3.5" />}
      </Button>
    </Tooltip>
  );

  if (etat === 'genre') {
    return (
      <div className="mb-1.5 rounded-md bg-raised px-3 py-2" data-realisation={carte.id} data-realisation-etat="genre">
        <div className="flex items-center gap-2 text-[13px]">
          <Clapperboard className="h-3.5 w-3.5 shrink-0 text-teinte" />
          <span className="shrink-0 font-medium text-text">{t('Réalisation')}</span>
          <span className="min-w-0 flex-1 truncate text-muted" data-realisation-consigne>
            · {t('Décrivez votre projet : la première question portera sur les types de média (image, vidéo, musique…).')}
          </span>
          {eteindre}
        </div>
      </div>
    );
  }

  const libelleEtat =
    etat === 'en-pause'
      ? t('En pause')
      : etat === 'termine'
        ? t('Toutes les questions ont leur réponse')
        : t(LIBELLES_PHASES_DE_REALISATION[realisation.phase]);

  return (
    <div className="mb-1.5 rounded-md bg-raised px-3 py-2" data-realisation={carte.id} data-realisation-etat={etat}>
      <div className="flex items-center gap-2 text-[13px]">
        <Clapperboard className="h-3.5 w-3.5 shrink-0 text-muted" />
        <span className="shrink-0 font-medium text-text">
          {types.length ? types.map((type) => t(LIBELLES_TYPES_DE_MEDIA_DE_REALISATION[type])).join(' + ') : t('Réalisation')}
        </span>
        <span className={cn('min-w-0 truncate', etat === 'en-pause' ? 'text-warning' : 'text-muted')}>· {libelleEtat}</span>
        <span className="ml-auto shrink-0 tabular-nums text-faint" data-realisation-avancement>
          {realisation.total
            ? realisation.faites > 1
              ? t('{v0} questions sur {v1}', { v0: realisation.faites, v1: realisation.total })
              : t('{v0} question sur {v1}', { v0: realisation.faites, v1: realisation.total })
            : realisation.faites > 1
              ? t('{v0} questions', { v0: realisation.faites })
              : t('{v0} question', { v0: realisation.faites })}
        </span>
      </div>
      <BarreProgression
        pourcent={pourcent}
        teinte={etat === 'termine' ? 'success' : 'en-cours'}
        className="mt-1.5"
        data-realisation-jauge={String(pourcent)}
      />
      <div className="mt-2 flex items-center gap-1.5">
        <Button size="sm" variant="outline" className="min-w-0 flex-1" onClick={() => setLecture(true)} data-realisation-lire>
          <BookOpen className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 truncate">{t('Lire le cahier de réalisation')}</span>
        </Button>
        {etat === 'termine' ? (
          <Button
            size="sm"
            variant="default"
            className="shrink-0"
            disabled={geste !== null}
            onClick={() => agir('lancer', () => client.demanderLeLancement(carte.id))}
            data-realisation-lancer
          >
            {geste === 'lancer' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
            {t('Lancer la fabrication')}
          </Button>
        ) : etat === 'en-pause' ? (
          <Tooltip label={reprise.possible ? t('Repartir à la question suivante') : t(reprise.raison ?? '')}>
            <Button
              size="icon"
              variant="default"
              className="shrink-0"
              aria-label="Reprendre"
              disabled={!reprise.possible || geste !== null}
              onClick={() => agir('reprise', () => client.call({ type: 'card.realisationReprendre', id: carte.id }))}
              data-realisation-reprendre
            >
              {geste === 'reprise' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            </Button>
          </Tooltip>
        ) : (
          <Tooltip label={pause.possible ? t('Mettre en pause : vous reprendrez à la question suivante') : t(pause.raison ?? '')}>
            <Button
              size="icon"
              variant="outline"
              className="shrink-0"
              aria-label="Mettre en pause"
              disabled={!pause.possible || geste !== null}
              onClick={() => agir('pause', () => client.call({ type: 'card.realisationPause', id: carte.id }))}
              data-realisation-pause
            >
              {geste === 'pause' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-3.5 w-3.5" />}
            </Button>
          </Tooltip>
        )}
        {eteindre}
      </div>
      <TiroirDeRealisation carte={carte} open={lecture} onClose={() => setLecture(false)} />
    </div>
  );
}

/**
 * LE DOCUMENT, LU SUR LE DISQUE À L'OUVERTURE puis à chaque réécriture (`majA`
 * change à chaque réponse enregistrée). Une rubrique encore à trancher porte sa
 * pastille « À voir ».
 */
function TiroirDeRealisation({ carte, open, onClose }: { carte: Card; open: boolean; onClose: () => void }) {
  const majA = carte.realisation?.majA;
  const [texte, setTexte] = React.useState<string | null | undefined>(undefined);
  React.useEffect(() => {
    if (!open) return;
    let vivant = true;
    client
      .call<{ texte: string | null }>({ type: 'card.realisationDocument', id: carte.id })
      .then((data) => vivant && setTexte(data.texte ?? null))
      .catch(() => vivant && setTexte(null));
    return () => {
      vivant = false;
    };
  }, [open, carte.id, majA]);
  const parties = texte ? partiesDuCahier(texte) : [];
  return (
    <Drawer adresse="cahier-de-realisation" open={open} onClose={onClose} empile plein feuille>
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-5" data-tiroir-realisation={carte.id}>
        <div className="flex items-center gap-2">
          <DialogTitle className="min-w-0 flex-1">{t('Cahier de réalisation')}</DialogTitle>
          {texte ? <BoutonCopierDocument texte={texte} repere="data-realisation-copier" /> : null}
          {texte ? <MenuExportDeRealisation carte={carte} /> : null}
        </div>
        <ZoneDefilement className="min-h-0 flex-1">
          {texte === undefined ? (
            <div aria-busy className="flex flex-col gap-2" data-silhouette>
              <Silhouette className="h-5 w-1/2" />
              <Silhouette className="h-3 w-full" />
              <Silhouette className="h-3 w-5/6" />
              <Silhouette className="h-5 w-1/3" />
              <Silhouette className="h-3 w-full" />
            </div>
          ) : texte === null ? (
            <p className="text-[13.5px] text-faint">
              {t('Le document n’est pas encore écrit : il apparaît dès la première réponse.')}
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {parties.map((partie, index) => (
                <section key={`${partie.titre}-${index}`} data-realisation-partie={partie.aVoir ? 'a-voir' : 'tranchee'}>
                  {partie.titre ? (
                    <h3 className="mb-1 flex items-center gap-2 text-[14px] font-semibold text-text">
                      {partie.titre}
                      {partie.aVoir ? (
                        <span className="rounded bg-warning/10 px-1.5 py-0.5 text-[11px] font-medium text-warning">
                          {t('À voir')}
                        </span>
                      ) : null}
                    </h3>
                  ) : null}
                  {partie.texte ? (
                    <Markdown className={cn('texte-du-fil', partie.aVoir && 'text-muted')} content={partie.texte} />
                  ) : null}
                </section>
              ))}
            </div>
          )}
        </ZoneDefilement>
      </div>
    </Drawer>
  );
}

/** EXPORTER LE CAHIER DE RÉALISATION : « PDF » ou « Texte », fabriqué par le démon (`/api/cartes/realisation`). */
function MenuExportDeRealisation({ carte }: { carte: Card }) {
  const adresse = (format: 'pdf' | 'md') => `/api/cartes/realisation?carte=${encodeURIComponent(carte.id)}&format=${format}`;
  const pdf = useTelechargement([{ adresse: adresse('pdf'), nom: nomDeLaRealisationExportee(carte.title, 'pdf') }]);
  const md = useTelechargement([{ adresse: adresse('md'), nom: nomDeLaRealisationExportee(carte.title, 'md') }]);
  const enRoute = pdf.etat === 'reception' || md.etat === 'reception';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="shrink-0"
          title={t('Exporter le cahier de réalisation')}
          aria-label="Exporter le cahier de réalisation"
          data-realisation-exporter
        >
          {enRoute ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => pdf.lancer()} data-realisation-export="pdf">
          <FileType className="h-4 w-4" />
          {t('PDF')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => md.lancer()} data-realisation-export="md">
          <FileText className="h-4 w-4" />
          {t('Texte (Markdown)')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
