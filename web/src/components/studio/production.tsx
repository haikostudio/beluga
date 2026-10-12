import * as React from 'react';
import { ArrowRight, Download, Loader2, Rocket, Upload } from 'lucide-react';
import { type DepenseStudio, type ExportStudio, type FormatStudio, type ReglagesExport, REGLAGES_EXPORT_PAR_DEFAUT, avancementDesExports, exportFini, partagerLesExports } from '@beluga/shared';
import { BarreProgression } from '@/components/barre-progression';
import { BulleInfo, Button, Dialog, DialogContent, DialogFooter, DialogHeader, Drawer, DropdownMenuItem, ZoneDefilement } from '@/components/ui';
import { useTenueDesOptions } from '@/components/entete-de-zone';
import { client } from '@/lib/client';
import { useTelephone } from '@/lib/telephone';
import { usePref } from '@/lib/prefs';
import { useTelechargement } from '@/lib/telechargement';
import { t } from '@/lib/langue';
import { EtapeFichiers, EtapeFormats, PanneauVoix, fichiersDuLot, useAvancementDesVoix } from './panneaux';
import { EnteteDeFenetre } from './champs';
import type { DonneesCreation } from './types';

type Etape = 'voix' | 'formats' | 'fichiers';
const ETAPES: Etape[] = ['voix', 'formats', 'fichiers'];

/**
 * « METTRE EN PRODUCTION » — le bouton du haut de l'éditeur. Il ouvre UNE
 * fenêtre qui se suit en TROIS ÉTAPES, l'une après l'autre :
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
  onClose,
}: {
  donnees: DonneesCreation;
  /** Le format affiché dans l'éditeur : coché d'office avec les autres formats de la création. */
  format: FormatStudio;
  temps: number;
  onVoixEssai: (segmentId?: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const telephone = useTelephone();
  const [etape, setEtape] = React.useState<Etape>(() => (donnees.exports.some((e) => !exportFini(e)) ? 'fichiers' : 'voix'));
  /* TOUS LES FORMATS DE LA CRÉATION SONT COCHÉS AU DÉPART : mettre en production, c'est sortir chaque déclinaison. */
  const [choisis, setChoisis] = React.useState<FormatStudio[]>(() => (donnees.creation.formats.length ? donnees.creation.formats : [format]));
  const [retenus] = usePref<Partial<ReglagesExport>>('studio.export.reglages', REGLAGES_EXPORT_PAR_DEFAUT);
  const [envoi, setEnvoi] = React.useState(false);
  const formats = choisis.filter((f) => donnees.creation.formats.includes(f));
  const rang = ETAPES.indexOf(etape);
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
      sousTitre={<span data-studio-etape-production={rang + 1}>{t('Mettre en production · étape {n} sur 3', { n: rang + 1 })}</span>}
      onRetour={rang > 0 ? () => setEtape(ETAPES[rang - 1]!) : undefined}
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
        <PanneauVoix donnees={donnees} onVoixEssai={onVoixEssai} />
      </div>
    ) : etape === 'formats' ? (
      <div className="flex flex-col gap-2" data-studio-production="export">
        <EtapeFormats donnees={donnees} choisis={formats} onChoisis={setChoisis} temps={temps} onImage={() => exporter('image')} enFabrication={enFabrication} />
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
 * Le bouton du haut de l'éditeur : il ouvre la fenêtre de mise en production.
 * PENDANT LA FABRICATION DE LA VOIX FINALE, PUIS PENDANT CELLE DES EXPORTS, il
 * en porte l'avancement — fenêtre fermée comme ouverte : le pourcentage après
 * le libellé (« 1/4 · 37 % » pour les exports) et la barre fine au ras du bas
 * (le modèle du bouton « Tout déployer »). La voix passe d'abord : l'export
 * qui la suit attend qu'elle soit posée. En compact (téléphone), la barre
 * seule. Le tic ne vit que dans ce bouton, et seulement pendant la fabrication.
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
 * LA PRODUCTION TOURNE-T-ELLE ? Sur téléphone, « Mettre en production » est une
 * ligne du menu à trois points, démontée tant qu'il est fermé : c'est le bouton
 * à trois points qui le dit à sa place (`OptionsDePage enCours`).
 */
export function useProductionEnCours(depenses: DepenseStudio[], exports: ExportStudio[]): boolean {
  return useAvancementDeLaProduction(depenses, exports).pourcent !== null;
}

export function BoutonMiseEnProduction({ compact, bloque, depenses, exports, onClick }: { compact: boolean; bloque?: boolean; depenses: DepenseStudio[]; exports: ExportStudio[]; onClick: () => void }) {
  const { voix, enExport, pourcent, libelle } = useAvancementDeLaProduction(depenses, exports);
  const tenue = useTenueDesOptions();
  /* DANS LE MENU À TROIS POINTS DU TÉLÉPHONE : une ligne nommée, son avancement à droite. */
  if (tenue === 'ligne') {
    return (
      <DropdownMenuItem
        disabled={bloque}
        onSelect={onClick}
        data-studio-mettre-en-production
        data-studio-production-avancement={pourcent === null ? undefined : String(pourcent)}
        data-studio-production-exports={!voix && enExport ? `${enExport.faits}/${enExport.total}` : undefined}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted">
          <Rocket className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1 truncate">{t('Mettre en production')}</span>
        {libelle !== null ? <span className="shrink-0 text-[12px] font-semibold tabular-nums text-muted">{libelle}</span> : null}
      </DropdownMenuItem>
    );
  }
  return (
    <Button
      size={compact ? 'icon' : 'sm'}
      variant="default"
      className="relative overflow-hidden disabled:opacity-50"
      disabled={bloque}
      aria-label="Mettre en production"
      title={
        bloque
          ? t('L’agent travaille')
          : voix
          ? t('Voix finale en cours… {p} %', { p: pourcent ?? 0 })
          : enExport
            ? t('Export en cours : {a} sur {b} fini(s) · {p} %', { a: enExport.faits, b: enExport.total, p: enExport.pourcent })
            : t('Voix finale et export')
      }
      onClick={onClick}
      data-studio-mettre-en-production
      data-studio-production-avancement={pourcent === null ? undefined : String(pourcent)}
      data-studio-production-exports={!voix && enExport ? `${enExport.faits}/${enExport.total}` : undefined}
    >
      <Rocket className="h-3.5 w-3.5" />
      {compact ? null : t('Mettre en production')}
      {libelle !== null && !compact ? <span className="shrink-0 text-[12px] font-semibold tabular-nums">{libelle}</span> : null}
      {pourcent !== null ? <BarreProgression pourcent={voix ? voix.global : pourcent} teinte="en-cours" className="absolute inset-x-0 bottom-0" data-studio-production-barre="" /> : null}
    </Button>
  );
}
