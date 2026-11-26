/*
 * LES SERVICES DE LA COLONNE DE GAUCHE (carte « Beluga piloté par des agents », 26/11/2026).
 *
 * La ligne « Services » (sous « Tableaux de bord », avec sa liste, sa recherche, ses épingles et sa fenêtre) a quitté
 * la colonne : les services métier s'ouvrent par l'agent qui en a la charge (onglets du volet d'un agent, pied
 * « Ouvrir : … »). Rien n'est perdu : Coffre-fort, Mémoire et Messagerie, sans agent qui les porte, s'ouvrent depuis
 * le menu à trois points de la tête de la colonne, et TOUS les services y restent dans « Tous les services ».
 */
import * as React from 'react';
import { LayoutGrid } from '@/components/ui/icones';
import { CLES_SERVICES_DU_MENU, type ServiceDuMenu } from '@/components/menus-de-la-colonne';
import { useAlerteDuService, useServicesOuverts } from '@/components/services';
import { DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from '@/components/ui';
import { t } from '@/lib/langue';

function useServicesVisibles(): ServiceDuMenu[] {
  const ouverts = new Set(useServicesOuverts().map((s) => s.cle as string));
  return CLES_SERVICES_DU_MENU.filter((s) => ouverts.has(s.requis ?? s.cle));
}

/**
 * UNE ALERTE DE SERVICE (un message client à traiter, un site en panne, un non-lu de la Communication) : elle portait un
 * point sur la ligne « Services » ; elle le porte désormais sur le bouton à trois points de la colonne
 * (`data-alerte-navigation`), et sur l'entrée du service dans le menu (`data-alerte-de-tuile`).
 */
export function useUneAlerteDeService(): boolean {
  const visibles = useServicesVisibles();
  const alerte = useAlerteDuService();
  return visibles.some((s) => alerte(s.cle));
}

const POINT_D_ALERTE = <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-teinte" data-alerte-de-tuile aria-hidden />;

/** Un service commun (Coffre-fort, Mémoire), tel que la colonne le reçoit. */
export interface ServiceCommun {
  cle: string;
  repere: string;
  Icone: React.ComponentType<{ className?: string }>;
  cleLibelle: string;
}

/**
 * LES SERVICES DANS LE MENU À TROIS POINTS DE LA COLONNE (carte « Beluga piloté par des agents », 26/11/2026) : la ligne
 * « Services » a quitté la colonne, ses services n'ont pas disparu. Coffre-fort, Mémoire et Messagerie — sans agent qui
 * les porte — s'ouvrent ici d'un clic ; TOUS les autres sont dans « Tous les services » (les services métier
 * s'ouvrent aussi depuis l'agent qui en a la charge). Repères : `data-service-du-menu-colonne=<clé>`.
 */
export function ServicesDuMenuDeLaColonne({
  communs,
  onOuvrir,
  onOuvrirCommun,
}: {
  communs: readonly ServiceCommun[];
  onOuvrir: (cle: string) => void;
  onOuvrirCommun: (cle: string) => void;
}) {
  const visibles = useServicesVisibles();
  const alerte = useAlerteDuService();
  const messagerie = visibles.find((s) => s.cle === 'espace-client') ?? null;
  const alerteDansLaListe = visibles.some((s) => s.cle !== 'espace-client' && alerte(s.cle));
  if (!communs.length && !visibles.length) return null;
  return (
    <>
      <DropdownMenuSeparator />
      {communs.map((s) => (
        <DropdownMenuItem key={s.cle} onSelect={() => onOuvrirCommun(s.cle)} className="gap-2.5" data-service-du-menu-colonne={s.cle} {...{ [s.repere]: '' }}>
          <s.Icone className="h-4 w-4 shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate">{t(s.cleLibelle)}</span>
        </DropdownMenuItem>
      ))}
      {messagerie ? (
        <DropdownMenuItem onSelect={() => onOuvrir(messagerie.cle)} className="gap-2.5" data-service-du-menu-colonne={messagerie.cle}>
          <messagerie.Icone className="h-4 w-4 shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate">{t(messagerie.cleLibelle)}</span>
          {alerte(messagerie.cle) ? POINT_D_ALERTE : null}
        </DropdownMenuItem>
      ) : null}
      {visibles.length ? (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2.5" data-tous-les-services="">
            <LayoutGrid className="h-4 w-4 shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate">{t('Tous les services')}</span>
            {alerteDansLaListe ? POINT_D_ALERTE : null}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="sm:w-[232px]" data-tous-les-services-panneau="">
            {visibles.map((s) => (
              <DropdownMenuItem key={s.cle} onSelect={() => onOuvrir(s.cle)} className="gap-2.5" data-service-du-menu-colonne={s.cle}>
                <s.Icone className="h-4 w-4 shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate">{t(s.cleLibelle)}</span>
                {alerte(s.cle) ? POINT_D_ALERTE : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      ) : null}
    </>
  );
}
