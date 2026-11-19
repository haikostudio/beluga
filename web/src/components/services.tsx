import * as React from 'react';
import { niveauDeMonService } from '@/lib/mes-droits';
import {
  Activity,
  BarChart3,
  Clapperboard,
  Film,
  HardDriveDownload,
  Key,
  Gauge,
  Library,
  Megaphone,
  Repeat,
  UsersRound,
  Palette,
  FolderOpen,
  Paperclip,
  ShieldCheck,
} from '@/components/ui/icones';
import { compterEnPanne, type VueCentrale } from '@beluga/shared';
import { Drawer, EnteteDeFeuille } from '@/components/ui';
import { useApp } from '@/lib/use-app';
import { ouvrirLesFichiers as ouvrirLaFenetreDesFichiers } from '@/lib/ouvrir-les-fichiers';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/** Une destination de la zone principale qui n'est pas un projet : un service. */
type Service = Exclude<VueCentrale, 'projet' | 'en-route'>;

/**
 * LES SERVICES, UNE SEULE DÉFINITION : leur ordre, leur icône, leur nom (une
 * CLÉ du dictionnaire) et le repère `data-ouvrir-*` que visent les contrôles.
 */
export const CLES_DES_SERVICES: { cle: Service; repere: string; Icone: typeof Key; cleLibelle: string }[] = [
  { cle: 'tableau-de-bord', repere: 'tableau-de-bord', Icone: Gauge, cleLibelle: 'Résumé' },
  { cle: 'statistiques', repere: 'statistiques', Icone: BarChart3, cleLibelle: 'Statistiques' },
  { cle: 'coffre', repere: 'coffre', Icone: Key, cleLibelle: 'Coffre-fort' },
  { cle: 'memoire', repere: 'memoire', Icone: Library, cleLibelle: 'Mémoire' },
  { cle: 'espace-client', repere: 'espace-client', Icone: UsersRound, cleLibelle: 'Messagerie' },
  { cle: 'backups', repere: 'backups', Icone: HardDriveDownload, cleLibelle: 'Backup' },
  { cle: 'surveillance', repere: 'surveillance', Icone: Activity, cleLibelle: 'Surveillance' },
  { cle: 'securite', repere: 'securite', Icone: ShieldCheck, cleLibelle: 'Sécurité' },
  { cle: 'taches-recurrentes', repere: 'taches-recurrentes', Icone: Repeat, cleLibelle: 'Tâches planifiées' },
  { cle: 'plaquettes', repere: 'plaquettes', Icone: Palette, cleLibelle: 'Charte graphique' },
  /* LES NOUVEAUX OUTILS PRENNENT LA PLACE DES ANCIENS (décision de l'utilisateur, 10/11/2026) : l'ancien
     Communication (vue `communication`) et l'ancien Marketing (vue `strategie`) sont SUPPRIMÉS le 11/11/2026 : leurs
     anciennes adresses ouvrent les nouveaux. Les nouveaux (vues `communication2`, `marketing2`, identifiants
     gardés pour les adresses déjà données) s'appellent « Communication » et « Marketing », avec leurs icônes. */
  { cle: 'communication2', repere: 'communication2', Icone: Megaphone, cleLibelle: 'Communication' },
  { cle: 'studio', repere: 'studio', Icone: Clapperboard, cleLibelle: 'Studio' },
];

/** Les services que ce compte peut ouvrir : l'accès tiers n'a que ce que sa grille lui ouvre. */
export function useServicesOuverts() {
  const state = useApp();
  /* Les services réservés à un seul compte, que ce compte-ci n'a pas. */
  const reserves = new Set<string>();
  return CLES_DES_SERVICES.filter((service) =>
    reserves.has(service.cle)
      ? false
      : state.monRole === 'admin'
        ? true
        : service.cle === 'communication2' || (service.cle === 'coffre' && niveauDeMonService(state, 'coffre') !== 'aucun'),
  );
}

/** Les deux groupes des outils d'un projet (maquette A du 12/11/2026). */
export const OUTILS_DE_CREATION: readonly string[] = ['plaquettes', 'communication2', 'studio', 'marketing2'];
export const OUTILS_DE_FONCTIONNEMENT: readonly string[] = [
  'tableau-de-bord',
  'statistiques',
  'espace-client',
  'backups',
  'surveillance',
  'securite',
  'taches-recurrentes',
];

/** Un point sur une entrée quand un message attend, qu'un site est tombé, ou que le directeur a écrit. */
export function useAlerteDuService(): (cle: string) => boolean {
  const state = useApp();
  const sitesEnPanne = compterEnPanne(state.surveillance);
  return (cle: string) =>
    (cle === 'espace-client' && state.compteursMessagerie.nonLu + state.compteursMessagerie.aTraiter > 0) ||
    (cle === 'surveillance' && sitesEnPanne > 0) ||
    (cle === 'communication2' && state.communicationNonLus > 0);
}

/*
 * LE MENU EN GRILLE N'EXISTE PLUS (décision du 13/11/2026, capture #72c1 : « je ne veux plus du tout avoir ce menu
 * nulle part ») : ni bouton aux quatre carrés en tête du fil des pages communes, ni tuiles, ni bouton violet
 * « Tableaux de bord ». Les outils d'un projet passent par `MenuDesOutils` (sa barre) ; le menu ⋮ de la colonne ne
 * les porte plus (13/11/2026 au soir : ils n'ont de sens que dans un projet).
 */

/** Le titre d'un groupe de la feuille des outils : petit, pâle, comme celui d'un menu. */
function TitreDeGroupe({ titre, repere }: { titre: string; repere: string }) {
  return (
    <div className="px-2.5 pb-0.5 pt-1 text-[12px] uppercase tracking-wide text-faint" data-titre-groupe-outils={repere}>
      {titre}
    </div>
  );
}

/**
 * SUR TÉLÉPHONE, LES OUTILS DU PROJET montent du bas (la feuille commune), depuis les trois points du haut : la même
 * LISTE en deux groupes que `MenuDesOutils` sur ordinateur — plus de tuiles.
 */
export function FeuilleDesServices({
  ouvert,
  onFermer,
  vue,
  onOuvrirVue,
}: {
  ouvert: boolean;
  onFermer: () => void;
  vue: VueCentrale;
  onOuvrirVue: (vue: VueCentrale) => void;
}) {
  const state = useApp();
  const services = useServicesOuverts().filter((s) => s.cle !== 'coffre' && s.cle !== 'memoire');
  const alerte = useAlerteDuService();
  const groupe = (cles: readonly string[], titre: string, repere: string) => {
    const liste = services.filter((s) => cles.includes(s.cle));
    if (!liste.length) return null;
    return (
      <div className="flex flex-col gap-0.5 pt-2">
        <TitreDeGroupe titre={titre} repere={repere} />
        {liste.map(({ cle, repere, Icone, cleLibelle }) => (
          <button
            key={cle}
            type="button"
            {...{ [`data-ouvrir-${repere}`]: '' }}
            data-destination={cle}
            aria-current={vue === cle ? 'page' : undefined}
            onClick={() => {
              onOuvrirVue(cle);
              onFermer();
            }}
            className={cn(
              'flex h-11 items-center gap-3 rounded-lg px-2.5 text-left text-[15px] transition-colors active:bg-raised',
              vue === cle ? 'text-teinte' : 'text-text',
            )}
          >
            <Icone className={cn('h-[18px] w-[18px] shrink-0', vue === cle ? 'text-teinte' : 'text-muted')} />
            <span className="min-w-0 flex-1 truncate">{t(cleLibelle)}</span>
            {alerte(cle) ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-teinte" data-alerte-de-tuile aria-hidden /> : null}
          </button>
        ))}
      </div>
    );
  };
  return (
    <Drawer feuille open={ouvert} onClose={onFermer}>
      <EnteteDeFeuille titre={t('Outils du projet')} droite={null} />
      <div className="px-4 pb-6" data-navigation-panneau={ouvert ? 'ouvert' : 'ferme'} data-feuille-des-services="projet">
        {/* LES MÊMES TROIS GROUPES TITRÉS que le menu de l'ordinateur (13/11/2026, capture #6fac). */}
        {groupe(OUTILS_DE_CREATION, t('Artefacts'), 'artefacts')}
        {groupe(OUTILS_DE_FONCTIONNEMENT, t('Services'), 'services')}
        <div className="flex flex-col gap-0.5 pt-2">
          <TitreDeGroupe titre={t('Documents')} repere="documents" />
          {(
            [
              { repere: 'data-menu-fichiers', Icone: FolderOpen, libelle: t('Fichiers'), geste: () => ouvrirLaFenetreDesFichiers({ projetId: state.activeProjectId ?? undefined }) },
              {
                repere: 'data-menu-pieces',
                Icone: Paperclip,
                libelle: t('Pièces jointes'),
                geste: () => window.dispatchEvent(new CustomEvent('beluga:ouvrir-fichiers', { detail: { vue: 'pieces' } })),
              },
            ] as const
          ).map(({ repere, Icone, libelle, geste }) => (
            <button
              key={repere}
              type="button"
              {...{ [repere]: '' }}
              onClick={() => {
                onFermer();
                geste();
              }}
              className="flex h-11 items-center gap-3 rounded-lg px-2.5 text-left text-[15px] text-text transition-colors active:bg-raised"
            >
              <Icone className="h-[18px] w-[18px] shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate">{libelle}</span>
            </button>
          ))}
        </div>
      </div>
    </Drawer>
  );
}
