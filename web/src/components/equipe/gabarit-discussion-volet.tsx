/*
 * LA FORME COMMUNE DES PAGES DE L'ÉQUIPE (carte « Beluga piloté par des agents », 26/11/2026, maquettes #1ff2, #1863,
 * #383ee) : la DISCUSSION à gauche, un VOLET à droite sur toute la hauteur — le même que celui du plan d'une carte
 * (`volet-comme-un-plan.tsx` : fond `fond-plan`, fenêtre arrondie, poignée, largeur retenue) —, en tête du volet la
 * BARRE D'ONGLETS STANDARD de Beluga (variante « accueil » : fond `onglets-barre`, onglet choisi en aplat contrasté),
 * et en pied le bouton d'action sur toute la largeur. Aucun grand titre : le nom de la page est dans le fil d'Ariane.
 *
 * Sur téléphone (< 640 px), la discussion et chaque onglet du volet deviennent des onglets d'une même barre en tête de
 * page, tous montés (le champ d'écriture garde ce qu'on y a écrit) ; le pied reste en bas, seul bouton de l'écran.
 */
import * as React from 'react';
import { ZoneDefilement } from '@/components/ui';
import { BarreDOnglets, type OngletDeBarre } from '@/components/ui/barre-d-onglets';
import { ResizeHandle, useResizable } from '@/components/resizer';
import { CLASSE_FENETRE_DU_VOLET, CLASSE_VOLET_DU_PLAN, CLE_DE_LARGEUR_DU_PLAN, bornesDuVoletDuPlan, usePlaceDeLaRangee } from '@/components/volet-comme-un-plan';
import { CLASSE_BOUTON_PLEINE_LARGEUR } from '@/components/menu-du-bas';
import { useTelephone } from '@/lib/telephone';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

export const CLE_DISCUSSION = 'discussion';

/** Le bouton du pied d'un volet : pleine largeur, gris doux, sans bordure (comme l'ancien « Nouvel artefact »). */
export const CLASSE_BOUTON_DU_PIED = cn(CLASSE_BOUTON_PLEINE_LARGEUR, 'bg-controle-doux text-text hover:bg-controle-doux-survol');

export function GabaritDiscussionEtVolet<C extends string>({
  repere,
  discussion,
  onglets,
  valeur,
  onChange,
  adresseDe,
  contenu,
  pied,
  defile = true,
  libelleDuVolet,
}: {
  /** Le repère de la page (`data-gabarit-equipe`). */
  repere: string;
  discussion: React.ReactNode;
  onglets: readonly OngletDeBarre<C>[];
  valeur: C;
  onChange: (cle: C) => void;
  /** L'adresse de chaque onglet (sans « # ») : un vrai lien. */
  adresseDe?: (cle: C) => string;
  /** Le contenu de l'onglet choisi. */
  contenu: React.ReactNode;
  /** Le bouton du pied du volet, pleine largeur. */
  pied?: React.ReactNode;
  /** Le contenu défile dans le volet (false : il gère lui-même sa hauteur — la table). */
  defile?: boolean;
  libelleDuVolet: string;
}) {
  const telephone = useTelephone();
  const [placeDeLaRangee, setRangee] = usePlaceDeLaRangee();
  const { width, start, reset } = useResizable(CLE_DE_LARGEUR_DU_PLAN, bornesDuVoletDuPlan(placeDeLaRangee));
  const [ongletTelephone, setOngletTelephone] = React.useState<string>(CLE_DISCUSSION);
  const corps = defile ? (
    <ZoneDefilement className="px-5 pb-4" classeEnveloppe="min-h-0 flex-1" data-volet-defile={repere}>
      {contenu}
    </ZoneDefilement>
  ) : (
    <div className="flex min-h-0 flex-1 flex-col">{contenu}</div>
  );
  const piedDuVolet = pied ? (
    <div className="shrink-0 px-5 pb-4 pt-2" data-pied-du-volet-equipe={repere}>
      {pied}
    </div>
  ) : null;

  if (telephone) {
    const tous: OngletDeBarre<string>[] = [{ cle: CLE_DISCUSSION, libelle: t('Discussion') }, ...onglets.map((o) => ({ ...o, cle: o.cle as string }))];
    const surLaDiscussion = ongletTelephone === CLE_DISCUSSION;
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-gabarit-equipe={repere}>
        <div className="shrink-0 px-4 pb-2 pt-1">
          <BarreDOnglets
            repere={`${repere}-onglets`}
            variante="accueil"
            valeur={surLaDiscussion ? CLE_DISCUSSION : (valeur as string)}
            onChange={(cle) => {
              setOngletTelephone(cle);
              if (cle !== CLE_DISCUSSION) onChange(cle as C);
            }}
            onglets={tous}
          />
        </div>
        <div className={cn('min-h-0 flex-1 flex-col', surLaDiscussion ? 'flex' : 'hidden')} data-discussion-de-la-page={repere}>
          {discussion}
        </div>
        <div className={cn('min-h-0 flex-1 flex-col', surLaDiscussion ? 'hidden' : 'flex')} data-volet-equipe={repere}>
          {corps}
          {piedDuVolet}
        </div>
      </div>
    );
  }

  return (
    <div ref={setRangee} className="flex min-h-0 min-w-0 flex-1" data-gabarit-equipe={repere} data-plein-cadre>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-discussion-de-la-page={repere}>
        <div className="mx-auto flex min-h-0 w-full max-w-[820px] flex-1 flex-col [--fond-du-pied:transparent] [--retrait-du-fil:1rem]">{discussion}</div>
      </div>
      <ResizeHandle onPointerDown={(e) => start(e, 'right')} onDoubleClick={reset} className="z-30" data-document-poignee={repere} />
      <aside className={cn('min-h-0', CLASSE_VOLET_DU_PLAN)} style={{ width }} aria-label={libelleDuVolet} data-volet-equipe={repere}>
        <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', CLASSE_FENETRE_DU_VOLET)}>
          <div className="shrink-0 px-5 pb-3 pt-4">
            <BarreDOnglets repere={`${repere}-onglets`} variante="accueil" valeur={valeur} onChange={onChange} onglets={onglets} adresseDe={adresseDe} />
          </div>
          {corps}
          {piedDuVolet}
        </div>
      </aside>
    </div>
  );
}
