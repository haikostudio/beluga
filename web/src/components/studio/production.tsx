import * as React from 'react';
import { ArrowRight, Download, Hammer, Loader2, Upload } from '@/components/ui/icones';
import { type DepenseStudio, type EtapeDeConstruction, type ExportStudio, type FormatStudio, type OperationStudio, type ReglagesExport, REGLAGES_EXPORT_PAR_DEFAUT, avancementDesExports, etapeDeDepartDeConstruction, etapesDeConstruction, exportFini, partagerLesExports } from '@beluga/shared';
import { BarreProgression } from '@/components/barre-progression';
import { BulleInfo, Button, Dialog, DialogContent, DialogFooter, DialogHeader, Drawer, Tooltip, ZoneDefilement } from '@/components/ui';
import { CLASSES_BOUTON_DU_FIL } from '@/components/parcours-carte';
import { client } from '@/lib/client';
import { useTelephone } from '@/lib/telephone';
import { usePref } from '@/lib/prefs';
import { useTelechargement } from '@/lib/telechargement';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import { EtapeFichiers, EtapeFormats, PanneauVoix, fichiersDuLot, useAvancementDesVoix } from './panneaux';
import { EnteteDeFenetre } from './champs';
import { GestesDeDeclinaison } from './outils-du-studio';
import type { DonneesCreation } from './types';

type Etape = EtapeDeConstruction;

/**
 * « CONSTRUCTION » — le bouton du haut de l'éditeur. Il ouvre UNE
 * fenêtre qui se suit en ÉTAPES, l'une après l'autre — TROIS pour une vidéo
 * qui a une voix, DEUX sinon (`etapesDeConstruction`, carte du 12/11/2026 :
 * pas d'étape « Voix finale » pour un média sans voix) :
 *
 *  1. LA VOIX FINALE : UN SEUL BLOC — les voix de la création (cochées une fois
 *     faites), le choix de la voix finale et son devis, l'historique de ce
 *     qu'elles ont coûté (replié), « Valider la voix ». Il n'y a plus de bloc
 *     « modèle » : la vidéo exportée devient d'elle-même le modèle du projet
 *     (côté serveur, à chaque export vidéo) ;
 *  2. LES FORMATS ET LES RÉGLAGES : les formats à exporter se cochent, les
 *     réglages valent pour tous — « Exporter » lance une vidéo par format coché,
 *     toutes du même lot ;
 *  3. LES FICHIERS : le lot qu'on vient de lancer (état, lecture,
 *     téléchargement un à un ou groupé), et les anciens exports repliés.
 *
 * UNE SEULE DISPOSITION, téléphone comme ordinateur : le RETOUR en haut à
 * gauche, le TITRE au centre, et le geste principal dans un PIED FIXE en pleine
 * largeur (`DialogFooter pleineLargeur`) — plus aucun bouton aligné à droite.
 * On referme par la poignée du tiroir, la croix ou Échap. Rouverte pendant
 * qu'un export se fabrique, la fenêtre revient sur les fichiers.
 */
export function FenetreMiseEnProduction({
  donnees,
  format,
  temps,
  onVoixEssai,
  onOperation,
  onOuvrir,
  onClose,
}: {
  donnees: DonneesCreation;
  /** Régler la voix d'une phrase depuis l'étape « Voix finale ». */
  onOperation?: (op: OperationStudio) => Promise<unknown>;
  /** Le format affiché dans l'éditeur : coché d'office avec les autres formats de la création. */
  format: FormatStudio;
  temps: number;
  onVoixEssai: (segmentId?: string) => Promise<unknown>;
  /** « Décliner » dans une autre langue ouvre la copie : l'éditeur la montre. */
  onOuvrir: (creationId: string) => void;
  onClose: () => void;
}) {
  const telephone = useTelephone();
  /* LES ÉTAPES SUIVENT LE MÉDIA : « Voix finale » n'existe que si la composition a une voix à fabriquer. */
  const etapes = React.useMemo(() => etapesDeConstruction(donnees.composition), [donnees.composition]);
  const [etape, setEtape] = React.useState<Etape>(() => etapeDeDepartDeConstruction(etapes, donnees.exports.some((e) => !exportFini(e))));
  /* La dernière voix retirée pendant que la fenêtre est ouverte : on ne reste pas sur une étape qui n'existe plus. */
  React.useEffect(() => {
    if (!etapes.includes(etape)) setEtape(etapes[0]!);
  }, [etapes, etape]);
  /* TOUS LES FORMATS DE LA CRÉATION SONT COCHÉS AU DÉPART : mettre en production, c'est sortir chaque déclinaison. */
  const [choisis, setChoisis] = React.useState<FormatStudio[]>(() => (donnees.creation.formats.length ? donnees.creation.formats : [format]));
  const [retenus] = usePref<Partial<ReglagesExport>>('studio.export.reglages', REGLAGES_EXPORT_PAR_DEFAUT);
  const [envoi, setEnvoi] = React.useState(false);
  const formats = choisis.filter((f) => donnees.creation.formats.includes(f));
  const rang = Math.max(0, etapes.indexOf(etape));
  const { courants } = partagerLesExports(donnees.exports);
  const lot = React.useMemo(() => fichiersDuLot(donnees.creation.titre, courants), [donnees.creation.titre, courants.map((e) => `${e.id}:${e.etat}`).join('|')]);
  const telechargement = useTelechargement(lot.fichiers, lot.archive);
  /* UN EXPORT QUI ATTEND OU SE FABRIQUE — quel qu'il soit, lancé d'ici, par l'agent ou après la voix — BLOQUE
     « Exporter » : le pied devient « Voir la progression ». Un second clic remettait le même lot dans la file. */
  const enFabrication = donnees.exports.filter((e) => !exportFini(e)).length;

  /** UN LOT : un export par format coché, sous le même repère ; l'écran passe aux fichiers dès qu'ils sont en file. */
  const exporter = (genre: 'video' | 'image') => {
    if (enFabrication) {
      setEtape('fichiers');
      return;
    }
    if (!formats.length || envoi) return;
    const repere = `lot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    setEnvoi(true);
    void (async () => {
      try {
        // L'un après l'autre : l'ordre des formats est celui de la file, donc celui de l'écran.
        for (const f of formats) {
          await client.call({ type: 'studio.exporter', creationId: donnees.creation.id, format: f, genre, reglages: { ...retenus }, lot: repere, ...(genre === 'image' ? { instant: temps } : {}) });
        }
        setEtape('fichiers');
      } catch (err: any) {
        client.pushToast('error', err?.message ?? t('Export impossible'));
      } finally {
        setEnvoi(false);
      }
    })();
  };

  const titre = etape === 'voix' ? t('Voix finale') : etape === 'formats' ? t('Formats et réglages') : t('Fichiers à télécharger');
  const aide = (
    <BulleInfo cote="end">
      {etape === 'voix'
        ? t('Choisissez la voix finale et validez-la, puis continuez vers l’export. La vidéo exportée devient le modèle du projet.')
        : etape === 'formats'
          ? t('Cochez les formats à sortir et réglez le fichier. Chaque format coché donne une vidéo, fabriquée sur le serveur, une à la fois.')
          : t('Les fichiers de votre dernier export. Téléchargez-les un par un ou tous ensemble ; les exports précédents sont rangés en dessous.')}
    </BulleInfo>
  );
  /* L'ENTÊTE : retour à gauche, titre au centre, aide à droite (à gauche de la croix, sur ordinateur). */
  const entete = (
    <EnteteDeFenetre
      titre={titre}
      sousTitre={
        <span data-studio-etape-production={rang + 1} data-studio-etapes-production={etapes.join(',')}>
          {t('Construction · étape {n} sur {total}', { n: rang + 1, total: etapes.length })}
        </span>
      }
      onRetour={rang > 0 ? () => setEtape(etapes[rang - 1]!) : undefined}
      /* Un retour INTERNE : d'une étape à la précédente, sans quitter la page.
         Sans ce drapeau il disparaissait sur téléphone, où la fenêtre est une
         page — seule restait la flèche de la barre, qui referme tout. */
      retourInterne
      repereRetour="data-studio-retour-production"
      droite={aide}
      croix={!telephone}
      data-studio-entete-production=""
    />
  );
  const corps =
    etape === 'voix' ? (
      <div className="flex flex-col gap-2" data-studio-production="reglages">
        <PanneauVoix donnees={donnees} onVoixEssai={onVoixEssai} onOperation={onOperation} />
      </div>
    ) : etape === 'formats' ? (
      <div className="flex flex-col gap-2" data-studio-production="export">
        <EtapeFormats donnees={donnees} choisis={formats} onChoisis={setChoisis} temps={temps} onImage={() => exporter('image')} enFabrication={enFabrication} />
        {/* DÉCLINER VIT ICI (refonte du 31/10/2026), avec les formats : sortir la vidéo dans tous les formats, dans une
            autre langue, ou l'envoyer en brouillon vers les réseaux sociaux. */}
        <section className="rounded-lg bg-raised" data-studio-production-decliner>
          <p className="px-3 pt-2.5 text-[13px] font-semibold text-text">{t('Décliner')}</p>
          <GestesDeDeclinaison
            donnees={donnees}
            temps={temps}
            onOuvrir={(id) => {
              onClose();
              onOuvrir(id);
            }}
          />
        </section>
        {donnees.exports.length ? (
          <Button size="sm" variant="ghost" className="w-full" onClick={() => setEtape('fichiers')} data-studio-voir-fichiers>
            {t('Voir les fichiers déjà exportés ({n})', { n: donnees.exports.length })}
          </Button>
        ) : null}
      </div>
    ) : (
      <div className="flex flex-col gap-2" data-studio-production="fichiers">
        <EtapeFichiers donnees={donnees} />
      </div>
    );
  const principal =
    etape === 'voix' ? (
      <Button variant="default" size="lg" onClick={() => setEtape('formats')} data-studio-ouvrir-export>
        {t('Continuer vers l’export')}
        <ArrowRight className="h-4 w-4" />
      </Button>
    ) : etape === 'formats' && enFabrication ? (
      <Button variant="default" size="lg" onClick={() => setEtape('fichiers')} data-studio-voir-progression={enFabrication}>
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('Voir la progression ({n} en cours)', { n: enFabrication })}
      </Button>
    ) : etape === 'formats' ? (
      <Button variant="default" size="lg" disabled={!donnees.rendu.pret || !formats.length || envoi} onClick={() => exporter('video')} data-studio-exporter="video" data-studio-exporter-formats={formats.join(',')}>
        {envoi ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {formats.length > 1 ? t('Exporter {n} vidéos', { n: formats.length }) : t('Exporter la vidéo')}
      </Button>
    ) : (
      <Button
        variant="default"
        size="lg"
        disabled={!lot.fichiers.length || telechargement.etat === 'reception'}
        onClick={telechargement.lancer}
        data-studio-tout-telecharger={lot.fichiers.length}
        data-etat={telechargement.etat}
      >
        {telechargement.etat === 'reception' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {telechargement.etat === 'reception'
          ? t('Réception… {p} %', { p: telechargement.pourcent })
          : telechargement.etat === 'pret'
            ? t('Enregistrer les fichiers')
            : !lot.fichiers.length && enFabrication
              ? t('Fabrication en cours…')
              : lot.fichiers.length > 1
                ? t('Tout télécharger ({n} fichiers)', { n: lot.fichiers.length })
                : t('Télécharger le fichier')}
      </Button>
    );

  if (telephone) {
    return (
      <Drawer open onClose={onClose} empile plein>
        <header className="shrink-0 px-3 pb-2">{entete}</header>
        <ZoneDefilement fond="hsl(var(--surface))" className="px-3 pb-4" data-studio-fenetre-production={etape}>
          {corps}
        </ZoneDefilement>
        <DialogFooter pleineLargeur>{principal}</DialogFooter>
      </Drawer>
    );
  }
  return (
    <Dialog open onOpenChange={(ouvert) => !ouvert && onClose()}>
      <DialogContent className="sm:max-h-[90dvh] sm:w-[min(640px,100%)]" aria-describedby={undefined} data-studio-fenetre-production={etape}>
        {/* La croix de la fenêtre occupe le coin droit, le retour le coin gauche : mêmes marges des deux côtés, titre au centre. */}
        <DialogHeader libre className="px-3 pt-2.5">{entete}</DialogHeader>
        {corps}
        <DialogFooter pleineLargeur>{principal}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Le bouton « Construction », en bas de la conversation : il ouvre la fenêtre de mise en production.
 * PENDANT LA FABRICATION DE LA VOIX FINALE, PUIS PENDANT CELLE DES EXPORTS, il
 * en porte l'avancement — fenêtre fermée comme ouverte : le pourcentage après
 * le libellé (« 1/4 · 37 % » pour les exports) et la barre fine au ras du bas
 * (le modèle du bouton « Tout déployer »). La voix passe d'abord : l'export
 * qui la suit attend qu'elle soit posée. Dans la barre de l'atelier, il porte
 * son libellé sur l'aplat violet (`violet`, refonte du 31/10/2026) ; en compact
 * (icône seule), la barre seule, le nom et le pourcentage au survol (`title`). Le tic ne vit que dans ce bouton, et seulement pendant la fabrication.
 */
/** `bloque` : l'agent de la création travaille, le bouton est grisé à 50 % et sans effet. */
/** L'avancement de la production d'une création : la voix finale d'abord, sinon les exports. */
function useAvancementDeLaProduction(depenses: DepenseStudio[], exports: ExportStudio[]) {
  const voix = useAvancementDesVoix(depenses);
  // Seule la progression des exports réveille l'appelant, pas chaque changement du magasin général.
  const progression = React.useSyncExternalStore(client.subscribe, () => client.lireEtat().studioProgression);
  const enExport = avancementDesExports(exports, Object.fromEntries(exports.map((e) => [e.id, progression[e.id]?.valeur ?? 0])));
  const pourcent = voix ? Math.round(voix.global) : enExport ? enExport.pourcent : null;
  const libelle = voix ? `${pourcent} %` : enExport ? `${enExport.faits}/${enExport.total} · ${enExport.pourcent} %` : null;
  return { voix, enExport, pourcent, libelle };
}

/**
 * LA PRODUCTION TOURNE-T-ELLE ? Sur téléphone, « Construction » est une
 * ligne du menu à trois points, démontée tant qu'il est fermé : c'est le bouton
 * à trois points qui le dit à sa place (`OptionsDePage enCours`).
 */
export function useProductionEnCours(depenses: DepenseStudio[], exports: ExportStudio[]): boolean {
  return useAvancementDeLaProduction(depenses, exports).pourcent !== null;
}

export function BoutonMiseEnProduction({
  depenses,
  exports,
  onClick,
  raison,
}: {
  /**
   * LE SEUL BOUTON DU STUDIO, EN BAS DE LA CONVERSATION (demande du 01/11/2026) :
   * pleine largeur, à la hauteur des boutons du fil, sur l'aplat violet quand il est
   * allumé ; éteint, il DIT pourquoi (`raison`, `etatDuBoutonDeProduction`). Ses
   * anciennes tenues (icône de la barre de l'atelier, ligne du menu à trois points)
   * n'avaient plus d'appelant et ont été retirées le 12/11/2026.
   */
  raison?: string | null;
  depenses: DepenseStudio[];
  exports: ExportStudio[];
  onClick: () => void;
}) {
  const { voix, enExport, pourcent, libelle } = useAvancementDeLaProduction(depenses, exports);
  const eteint = !!raison;
  const bouton = (
    <Button
      type="button"
      variant="default"
      aria-label="Construction"
      aria-disabled={eteint}
      data-studio-mettre-en-production="fil"
      data-geste-possible={eteint ? 'non' : 'oui'}
      data-raison={raison ?? undefined}
      data-studio-production-avancement={pourcent === null ? undefined : String(pourcent)}
      data-studio-production-exports={!voix && enExport ? `${enExport.faits}/${enExport.total}` : undefined}
      title={eteint ? t(raison!) : undefined}
      onClick={eteint ? undefined : onClick}
      className={cn(
        CLASSES_BOUTON_DU_FIL,
        'relative overflow-hidden',
        /* Allumé, l'aplat VIOLET de la charte (`teinte-plein`) : le seul geste coloré de l'atelier, comme l'était le bouton du haut. */
        eteint ? 'cursor-not-allowed bg-raised text-faint hover:bg-raised hover:text-faint' : 'bg-teinte-plein text-sur-couleur hover:bg-teinte-plein hover:opacity-90',
      )}
    >
      <Hammer className="h-3.5 w-3.5" />
      <span className="min-w-0 truncate">{t('Construction')}</span>
      {libelle !== null ? <span className="shrink-0 text-[12px] font-semibold tabular-nums">{libelle}</span> : null}
      {pourcent !== null ? <BarreProgression pourcent={voix ? voix.global : pourcent} teinte="en-cours" className="absolute inset-x-0 bottom-0" data-studio-production-barre="" /> : null}
    </Button>
  );
  return eteint ? <Tooltip label={t(raison!)}>{bouton}</Tooltip> : bouton;
}
