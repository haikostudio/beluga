import * as React from 'react';
import { BookOpen, ClipboardList, Download, FileText, FileType, Loader2, Pause, Play } from 'lucide-react';
import {
  Card,
  LIBELLES_PHASES_DU_CAHIER,
  nomDuCahierExporte,
  etatDuCahier,
  partiesDuCahier,
  pausePossible,
  pourcentageDuCahier,
  reprisePossible,
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
import { useApp } from '@/lib/use-app';
import { Markdown } from '@/lib/markdown';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * LE BANDEAU DU CAHIER DES CHARGES, collé au-dessus des gestes de la carte.
 *
 * Seule la carte née de la case « Démarrer par un cahier des charges » le porte
 * (`Card.cahierDesCharges`, `shared/src/cahier-des-charges.ts`). Il dit où on
 * en est — questions tranchées, phase, pause —, ouvre le document tel qu'il
 * s'écrit, et porte la pause et la reprise. Les règles (pourcentage, boutons
 * éteints et leur raison) sont dans `shared/` ; ce composant ne fait que
 * dessiner.
 */
export function BandeauCahierDesCharges({ carte }: { carte: Card }) {
  const cahier = carte.cahierDesCharges;
  const [geste, setGeste] = React.useState<'pause' | 'reprise' | null>(null);
  const [lecture, setLecture] = React.useState(false);
  if (!cahier) return null;

  const etat = etatDuCahier(cahier);
  const pourcent = pourcentageDuCahier(cahier);
  const pause = pausePossible(cahier);
  const reprise = reprisePossible(cahier);

  /* UN BOUTON QUI PART EN REQUÊTE LE DIT DÈS LE CLIC : roue pendant l'attente,
     refus dit en rouge. */
  const agir = async (quoi: 'pause' | 'reprise') => {
    setGeste(quoi);
    try {
      await client.call({ type: quoi === 'pause' ? 'card.cahierPause' : 'card.cahierReprendre', id: carte.id });
    } catch (err: any) {
      client.signalerRefus(err?.message ?? t('Geste refusé'), carte.id);
    } finally {
      setGeste(null);
    }
  };

  const libelleEtat =
    etat === 'en-pause'
      ? t('En pause')
      : etat === 'termine'
        ? t('Toutes les questions ont leur réponse')
        : t(LIBELLES_PHASES_DU_CAHIER[cahier.phase]);

  return (
    <div
      className="mb-1.5 rounded-md bg-raised px-3 py-2"
      data-cahier-des-charges={carte.id}
      data-cahier-etat={etat}
    >
      <div className="flex items-center gap-2 text-[13px]">
        <ClipboardList className="h-3.5 w-3.5 shrink-0 text-muted" />
        <span className="font-medium text-text">{t('Cahier des charges')}</span>
        <span className={cn('min-w-0 truncate', etat === 'en-pause' ? 'text-warning' : 'text-muted')}>
          · {libelleEtat}
        </span>
        <span className="ml-auto shrink-0 tabular-nums text-faint" data-cahier-avancement>
          {cahier.total
            ? t('{v0} questions sur {v1}', { v0: cahier.faites, v1: cahier.total })
            : t('{v0} questions', { v0: cahier.faites })}
        </span>
      </div>
      <BarreProgression
        pourcent={pourcent}
        teinte={etat === 'termine' ? 'success' : 'en-cours'}
        className="mt-1.5"
        data-cahier-jauge={String(pourcent)}
      />
      {/* LA LECTURE PREND TOUTE LA LARGEUR ; la pause (ou la reprise) n'est
          plus qu'une icône à sa droite, avec sa raison au survol. */}
      <div className="mt-2 flex items-center gap-1.5">
        <Button size="sm" variant="outline" className="min-w-0 flex-1" onClick={() => setLecture(true)} data-cahier-lire>
          <BookOpen className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 truncate">{t('Lire le cahier des charges')}</span>
        </Button>
        {etat === 'en-pause' ? (
          <Tooltip label={reprise.possible ? t('Repartir à la question suivante') : t(reprise.raison ?? '')}>
            <Button
              size="icon"
              variant="default"
              className="shrink-0"
              aria-label="Reprendre"
              disabled={!reprise.possible || geste !== null}
              onClick={() => agir('reprise')}
              data-cahier-reprendre
            >
              {geste === 'reprise' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            </Button>
          </Tooltip>
        ) : etat === 'en-cours' ? (
          <Tooltip label={pause.possible ? t('Mettre en pause : vous reprendrez à la question suivante') : t(pause.raison ?? '')}>
            <Button
              size="icon"
              variant="outline"
              className="shrink-0"
              aria-label="Mettre en pause"
              disabled={!pause.possible || geste !== null}
              onClick={() => agir('pause')}
              data-cahier-pause
            >
              {geste === 'pause' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-3.5 w-3.5" />}
            </Button>
          </Tooltip>
        ) : null}
      </div>
      <TiroirDuCahier projectId={carte.projectId} majA={cahier.majA} open={lecture} onClose={() => setLecture(false)} />
    </div>
  );
}

/**
 * LE DOCUMENT, LU SUR LE DISQUE À L'OUVERTURE puis à chaque réécriture (la date
 * `majA` de la carte change à chaque réponse enregistrée). Une partie encore à
 * trancher porte sa pastille « À voir ».
 */
export function TiroirDuCahier({
  projectId,
  majA,
  open,
  onClose,
}: {
  projectId: string;
  /** La dernière écriture, quand une carte du cahier existe : le tiroir se relit à chaque réponse. */
  majA?: number;
  open: boolean;
  onClose: () => void;
}) {
  const texte = useDocumentDuCahier(projectId, open, majA);

  const parties = texte ? partiesDuCahier(texte) : [];
  return (
    <Drawer adresse="cahier-des-charges" open={open} onClose={onClose} empile plein>
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-5" data-tiroir-cahier={projectId}>
        <div className="flex items-center gap-2">
          <DialogTitle className="min-w-0 flex-1">{t('Cahier des charges')}</DialogTitle>
          {texte ? <MenuExportDuCahier projectId={projectId} /> : null}
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
                <section key={`${partie.titre}-${index}`} data-cahier-partie={partie.aVoir ? 'a-voir' : 'tranchee'}>
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

/**
 * LE DOCUMENT DU PROJET, lu sur le disque quand `actif` (et relu quand `majA`
 * change). `undefined` : en route ; `null` : pas de document.
 */
export function useDocumentDuCahier(projectId: string, actif: boolean, majA?: number): string | null | undefined {
  const [texte, setTexte] = React.useState<string | null | undefined>(undefined);
  React.useEffect(() => {
    if (!actif) return;
    let vivant = true;
    client
      .call<{ texte: string | null }>({ type: 'project.cahierDocument', projectId })
      .then((data) => vivant && setTexte(data.texte ?? null))
      .catch(() => vivant && setTexte(null));
    return () => {
      vivant = false;
    };
  }, [actif, projectId, majA]);
  return texte;
}

/**
 * EXPORTER LE CAHIER DES CHARGES : un petit menu, « PDF » ou « Texte ». Le
 * fichier est fabriqué par le démon (`/api/projets/cahier-des-charges`) puis
 * téléchargé par le chemin commun (`useTelechargement`) — feuille de partage
 * sur téléphone, téléchargement ordinaire ailleurs.
 */
export function MenuExportDuCahier({ projectId, avecLibelle = false }: { projectId: string; avecLibelle?: boolean }) {
  const projet = useApp().projects.find((p) => p.id === projectId);
  const nom = projet?.name ?? 'projet';
  const adresse = (format: 'pdf' | 'md') =>
    `/api/projets/cahier-des-charges?projet=${encodeURIComponent(projectId)}&format=${format}`;
  const pdf = useTelechargement([{ adresse: adresse('pdf'), nom: nomDuCahierExporte(nom, 'pdf') }]);
  const md = useTelechargement([{ adresse: adresse('md'), nom: nomDuCahierExporte(nom, 'md') }]);
  const enRoute = pdf.etat === 'reception' || md.etat === 'reception';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size={avecLibelle ? 'sm' : 'icon'}
          variant={avecLibelle ? 'outline' : 'ghost'}
          className="shrink-0"
          title={t('Exporter le cahier des charges')}
          aria-label="Exporter le cahier des charges"
          data-cahier-exporter
        >
          {enRoute ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {avecLibelle ? t('Exporter') : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => pdf.lancer()} data-cahier-export="pdf">
          <FileType className="h-4 w-4" />
          {t('PDF')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => md.lancer()} data-cahier-export="md">
          <FileText className="h-4 w-4" />
          {t('Texte (Markdown)')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * LE BOUTON « CAHIER DES CHARGES » DE LA CONFIGURATION DU PROJET. Il ne paraît
 * que si le projet a un document ; il ouvre le même tiroir de lecture, avec son
 * menu d'export.
 */
export function BoutonCahierDuProjet({ projectId }: { projectId: string }) {
  const texte = useDocumentDuCahier(projectId, true);
  const [ouvert, setOuvert] = React.useState(false);
  if (!texte) return null;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOuvert(true)} data-cahier-du-projet={projectId}>
        <ClipboardList className="h-3.5 w-3.5" />
        {t('Cahier des charges')}
      </Button>
      <TiroirDuCahier projectId={projectId} open={ouvert} onClose={() => setOuvert(false)} />
    </>
  );
}
