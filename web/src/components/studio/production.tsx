import * as React from 'react';
import { ArrowRight, BadgeCheck, Download, Loader2, Rocket, Upload } from 'lucide-react';
import { type DepenseStudio, type FormatStudio, type ReglagesExport, REGLAGES_EXPORT_PAR_DEFAUT, exportFini, partagerLesExports } from '@beluga/shared';
import { BarreProgression } from '@/components/barre-progression';
import { BulleInfo, Button, Dialog, DialogContent, DialogFooter, DialogHeader, Drawer, ZoneDefilement } from '@/components/ui';
import { client } from '@/lib/client';
import { useTelephone } from '@/lib/telephone';
import { usePref } from '@/lib/prefs';
import { useTelechargement } from '@/lib/telechargement';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import { EtapeFichiers, EtapeFormats, PanneauVoix, fichiersDuLot, useAvancementDesVoix } from './panneaux';
import { EnteteDeFenetre, Section } from './champs';
import type { DonneesCreation } from './types';

type Etape = 'voix' | 'formats' | 'fichiers';
const ETAPES: Etape[] = ['voix', 'formats', 'fichiers'];

/**
 * « METTRE EN PRODUCTION » — le bouton du haut de l'éditeur. Il ouvre UNE
 * fenêtre qui se suit en TROIS ÉTAPES, l'une après l'autre :
 *
 *  1. LA VOIX FINALE ET LE MODÈLE : les voix de la création, le choix de la voix
 *     finale et son devis, « Valider la voix », ce qu'elles ont coûté, et
 *     « Garder comme modèle » ;
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
  const enFabrication = courants.filter((e) => !exportFini(e)).length;

  /** UN LOT : un export par format coché, sous le même repère ; l'écran passe aux fichiers dès qu'ils sont en file. */
  const exporter = (genre: 'video' | 'image') => {
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

  const titre = etape === 'voix' ? t('Voix finale et modèle') : etape === 'formats' ? t('Formats et réglages') : t('Fichiers à télécharger');
  const aide = (
    <BulleInfo cote="end">
      {etape === 'voix'
        ? t('Choisissez la voix finale et validez-la. Vous pouvez aussi garder la vidéo comme modèle. Continuez ensuite vers l’export.')
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
        <GarderCommeModele donnees={donnees} />
      </div>
    ) : etape === 'formats' ? (
      <div className="flex flex-col gap-2" data-studio-production="export">
        <EtapeFormats donnees={donnees} choisis={formats} onChoisis={setChoisis} temps={temps} onImage={() => exporter('image')} />
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
        <DialogHeader className="px-3 pt-2.5">{entete}</DialogHeader>
        {corps}
        <DialogFooter pleineLargeur>{principal}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * « GARDER COMME MODÈLE » : la version courante devient le MODÈLE du projet,
 * rangé dans l'onglet « Style » pour repartir de lui (seule la vidéo entière).
 * Le bloc DIT ce qu'est un modèle et où en est le sien — pas de modèle, modèle
 * en retard sur la vidéo, ou modèle à jour — puis son bouton, en pleine largeur.
 */
function GarderCommeModele({ donnees }: { donnees: DonneesCreation }) {
  const aJour = !!donnees.modele && donnees.modele.version === donnees.creation.version;
  const libelle = aJour ? t('Modèle à jour') : donnees.modele ? t('Mettre le modèle à jour') : t('Garder comme modèle');
  return (
    <Section liste titre={t('Garder cette vidéo comme modèle (facultatif)')}>
      <p className="text-[12.5px] text-muted">
        {t('Un modèle est une copie figée de cette vidéo, rangée dans l’onglet « Style ». Une nouvelle vidéo peut repartir de lui, dans ce projet ou un autre. L’export n’en dépend pas.')}
      </p>
      <p className={cn('text-[12.5px]', aJour ? 'text-termine' : 'text-text')} data-studio-etat-modele>
        {aJour
          ? t('Le modèle est à jour : il correspond à la vidéo actuelle.')
          : donnees.modele
            ? t('Le modèle existant date de la version {a} ; la vidéo en est à la version {b}.', { a: donnees.modele.version, b: donnees.creation.version })
            : t('Cette vidéo n’a pas encore de modèle.')}
      </p>
      <Button
        variant={aJour ? 'ghost' : 'outline'}
        disabled={aJour}
        className="w-full"
        data-studio-valider-creation={aJour ? 'a-jour' : donnees.modele ? 'en-retard' : 'aucun'}
        onClick={() =>
          client
            .call<{ nouveau: boolean }>({ type: 'studio.modele.valider', creationId: donnees.creation.id })
            .then((r) => client.pushToast('success', r.nouveau ? t('Vidéo gardée : elle est maintenant un modèle du projet.') : t('Le modèle est à jour.')))
            .catch((err: any) => client.pushToast('error', err?.message ?? t('Validation impossible')))
        }
      >
        <BadgeCheck className={cn('h-3.5 w-3.5', aJour && 'text-termine')} />
        {libelle}
      </Button>
    </Section>
  );
}

/**
 * Le bouton du haut de l'éditeur : il ouvre la fenêtre de mise en production.
 * PENDANT LA FABRICATION DE LA VOIX FINALE, il en porte l'avancement — fenêtre
 * fermée comme ouverte : le pourcentage après le libellé et la barre fine au
 * ras du bas (le modèle du bouton « Tout déployer »). En compact (téléphone),
 * la barre seule. Le tic ne vit que dans ce bouton, et seulement pendant la
 * fabrication.
 */
export function BoutonMiseEnProduction({ compact, depenses, onClick }: { compact: boolean; depenses: DepenseStudio[]; onClick: () => void }) {
  const avancement = useAvancementDesVoix(depenses);
  const pourcent = avancement ? Math.round(avancement.global) : null;
  return (
    <Button
      size={compact ? 'icon' : 'sm'}
      variant="default"
      className="relative overflow-hidden"
      aria-label="Mettre en production"
      title={pourcent === null ? t('Voix finale, modèle et export') : t('Voix finale en cours… {p} %', { p: pourcent })}
      onClick={onClick}
      data-studio-mettre-en-production
      data-studio-production-avancement={pourcent === null ? undefined : String(pourcent)}
    >
      <Rocket className="h-3.5 w-3.5" />
      {compact ? null : t('Mettre en production')}
      {pourcent !== null && !compact ? <span className="shrink-0 text-[12px] font-semibold tabular-nums">{pourcent} %</span> : null}
      {avancement ? <BarreProgression pourcent={avancement.global} teinte="en-cours" className="absolute inset-x-0 bottom-0" data-studio-production-barre="" /> : null}
    </Button>
  );
}
