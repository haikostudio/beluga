import * as React from 'react';
import { ArrowLeft, BadgeCheck, Rocket, Upload } from 'lucide-react';
import type { DepenseStudio, FormatStudio } from '@beluga/shared';
import { BarreProgression } from '@/components/barre-progression';
import { BulleInfo, Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Drawer, ZoneDefilement } from '@/components/ui';
import { client } from '@/lib/client';
import { useTelephone } from '@/lib/telephone';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import { PanneauExports, PanneauVoix, useAvancementDesVoix } from './panneaux';
import { Section } from './champs';
import type { DonneesCreation } from './types';

/**
 * « METTRE EN PRODUCTION » — le bouton du haut de l'éditeur, qui remplace
 * « Valider la création ». Il ouvre UNE fenêtre en deux écrans :
 *
 *  1. LES RÉGLAGES DE MISE EN PRODUCTION : les voix de la création (essai,
 *     finale), le choix de la voix finale et son devis, « Valider la voix »,
 *     ce que les voix ont coûté, et l'option « Garder comme modèle » (l'ancien
 *     « Valider la création », avec ses trois états) ;
 *  2. L'EXPORT, ouvert par le bouton « Exporter » du pied : format,
 *     déclinaisons, réglages vidéo et image, liste des exports.
 *
 * Les onglets « Voix » et « Exports » du volet ont disparu : c'est ici, au
 * moment de produire, que l'utilisateur choisit sa voix et exporte. Sur
 * téléphone, un tiroir plein (`Drawer empile plein`).
 */
export function FenetreMiseEnProduction({
  donnees,
  format,
  onFormat,
  temps,
  onVoixEssai,
  onClose,
}: {
  donnees: DonneesCreation;
  format: FormatStudio;
  onFormat: (f: FormatStudio) => void;
  temps: number;
  onVoixEssai: (segmentId?: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const telephone = useTelephone();
  const [ecran, setEcran] = React.useState<'reglages' | 'export'>('reglages');
  const titre = ecran === 'reglages' ? t('Mettre en production') : t('Exporter');
  const aide = (
    <BulleInfo cote="start">
      {ecran === 'reglages'
        ? t('Choisissez la voix finale et validez-la, gardez la vidéo comme modèle si vous voulez repartir d’elle, puis exportez.')
        : t('Choisissez le format et les réglages du fichier. Une vidéo se fabrique sur le serveur, une à la fois.')}
    </BulleInfo>
  );
  const corps =
    ecran === 'reglages' ? (
      <div className="flex flex-col gap-2" data-studio-production="reglages">
        <PanneauVoix donnees={donnees} onVoixEssai={onVoixEssai} />
        <GarderCommeModele donnees={donnees} />
      </div>
    ) : (
      <div className="flex flex-col gap-2" data-studio-production="export">
        <PanneauExports donnees={donnees} format={format} onFormat={onFormat} temps={temps} />
      </div>
    );
  const pied =
    ecran === 'reglages' ? (
      <>
        <Button variant="ghost" onClick={onClose}>
          {t('Fermer')}
        </Button>
        <Button variant="default" onClick={() => setEcran('export')} data-studio-ouvrir-export>
          <Upload className="h-3.5 w-3.5" />
          {t('Exporter')}
        </Button>
      </>
    ) : (
      <>
        <Button variant="ghost" onClick={() => setEcran('reglages')} data-studio-retour-production>
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('Retour aux réglages')}
        </Button>
        <Button variant="outline" onClick={onClose}>
          {t('Fermer')}
        </Button>
      </>
    );

  if (telephone) {
    return (
      <Drawer open onClose={onClose} empile plein>
        <header className="flex shrink-0 items-center gap-2 px-4 pb-2">
          <DialogTitle className="min-w-0 truncate">{titre}</DialogTitle>
          {aide}
        </header>
        <ZoneDefilement fond="hsl(var(--surface))" className="px-3 pb-4" data-studio-fenetre-production={ecran}>
          {corps}
        </ZoneDefilement>
        <DialogFooter>{pied}</DialogFooter>
      </Drawer>
    );
  }
  return (
    <Dialog open onOpenChange={(ouvert) => !ouvert && onClose()}>
      <DialogContent className="sm:max-h-[90dvh] sm:w-[min(640px,100%)]" aria-describedby={undefined} data-studio-fenetre-production={ecran}>
        <DialogHeader className="flex items-center gap-1">
          <DialogTitle>{titre}</DialogTitle>
          {aide}
        </DialogHeader>
        {corps}
        <DialogFooter>{pied}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * « GARDER COMME MODÈLE » : la version courante devient le MODÈLE du projet,
 * rangé dans l'onglet « Style » pour repartir de lui (seule la vidéo entière).
 * Le bouton dit où l'on en est : pas de modèle, modèle en retard sur la
 * création, ou modèle à jour.
 */
function GarderCommeModele({ donnees }: { donnees: DonneesCreation }) {
  const aJour = !!donnees.modele && donnees.modele.version === donnees.creation.version;
  const libelle = aJour ? t('Modèle à jour') : donnees.modele ? t('Mettre le modèle à jour') : t('Garder comme modèle');
  return (
    <Section
      liste
      titre={t('Modèle du projet')}
      action={<BulleInfo cote="end">{t('Un modèle se retrouve dans l’onglet « Style » : une nouvelle création peut repartir de lui, dans ce projet ou un autre.')}</BulleInfo>}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-[12.5px] text-muted">
          {aJour
            ? t('Cette version est le modèle du projet.')
            : donnees.modele
              ? t('Le modèle date d’une version précédente de cette vidéo.')
              : t('Cette vidéo n’est pas encore un modèle.')}
        </span>
        <Button
          size="sm"
          variant={aJour ? 'ghost' : 'outline'}
          disabled={aJour}
          className="shrink-0"
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
      </div>
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
