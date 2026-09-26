/**
 * L'ENTÊTE DE L'ESPACE : LE NOM, PUIS UN BURGER.
 *
 * Avant, huit commandes s'empilaient sur trois rangs ; puis tout s'était rangé
 * sous un « … » et la discussion était devenue invisible ; puis « + »,
 * « Discussion », « Backups », « Accès » et un menu « Filtre » global tenaient
 * sur un rang — cinq boutons qui mangeaient le nom du projet sur un téléphone.
 *
 * CHAQUE COMMANDE EST DÉSORMAIS LÀ OÙ ELLE AGIT :
 *  - le « + » et le FILTRE vivent dans la tête de chaque COLONNE : filtrer
 *    « À faire » ne touche plus « Terminé », et une demande se crée là où elle
 *    arrive (`colonne-demandes.tsx`) ;
 *  - la DISCUSSION est un onglet glissable en bas du tableau
 *    (`onglet-discussion.tsx`) ;
 *  - les BACKUPS, l'ACCÈS, le PROFIL, la DÉCONNEXION et, vu comme Haiko, les
 *    comptes du client vivent dans le BURGER (`menu-espace.tsx`) — les demandes
 *    archivées, elles, sont un filtre de CHAQUE COLONNE.
 *
 * ET TOUT CELA TIENT SUR UN SEUL RANG. Ce qui venait d'AU-DESSUS se pose à
 * gauche de cette ligne (`avant`), et le nom du projet le suit en second plan.
 */
import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { Button, SelecteurTiroir } from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

export function EnteteEspace({
  avant,
  projectId,
  projets,
  onProjet,
  menu,
  apres,
  cloche,
  nonLusParProjet,
}: {
  /** La cloche du client : posée parmi les boutons de droite, AVANT le nom et la déconnexion. */
  cloche?: React.ReactNode;
  /** Combien de demandes ont du nouveau, projet par projet — le sélecteur les montre. */
  nonLusParProjet?: Record<string, number>;
  /** Ce qui se pose à GAUCHE, sur la même ligne — le sélecteur de client. */
  avant?: React.ReactNode;
  /**
   * CE QUI SE POSE À DROITE, AVANT LE BURGER. Vu depuis la porte client, c'est
   * le nom de la personne connectée. Rien n'est passé ici pour la vue Haiko.
   */
  apres?: React.ReactNode;
  projectId: string;
  /** Vide quand le projet est imposé (vu comme Haiko) : le sélecteur disparaît. */
  projets: { id: string; nom: string }[];
  onProjet: (id: string) => void;
  /** Le burger et son tiroir, posés en dernier. */
  menu?: React.ReactNode;
}) {
  return (
    /*
     * Le trait qui ferme l'entête est le SEUL qui reste : à 25 % d'opacité, il
     * pose une limite sans découper l'écran. Il reste sur `--faint`, jamais
     * `--border`, effacé dans les onze palettes plates.
     */
    <div className="flex min-w-0 items-center gap-1.5 border-b border-faint/25 px-3 py-2" data-entete-espace>
      {avant}
      {/*
       * LE NOM DU PROJET, EN SECOND PLAN DERRIÈRE CE QUI PRÉCÈDE. Quand le
       * client n'a qu'un projet, ce n'est plus qu'une mention grise à côté de
       * son nom ; dès qu'il en a plusieurs, il redevient un bouton qu'on ouvre.
       */}
      {projets.length > 1 ? (
        <SelecteurTiroir
          valeur={projectId}
          options={projets.map((projet) => ({
            valeur: projet.id,
            libelle: projet.nom,
            // UN NON-LU PAR PROJET : on sait où aller avant d'ouvrir.
            detail: nonLusParProjet?.[projet.id]
              ? t('{n} demandes avec du nouveau', { n: nonLusParProjet[projet.id] })
              : undefined,
          }))}
          onChoisir={onProjet}
          titre={t('Projet')}
          repere="projet"
          declencheur={(ouvrir, libelle) => (
            <Button
              variant="ghost"
              size="sm"
              onClick={ouvrir}
              className="min-w-0 flex-1 justify-start gap-1.5 px-1.5 text-[14px] font-medium text-text"
              data-choix-projet={projectId}
              title={libelle}
            >
              <span className="min-w-0 truncate">{libelle}</span>
              {/* UN AUTRE PROJET A DU NOUVEAU : un point, sans ouvrir la liste. */}
              {projets.some((projet) => projet.id !== projectId && nonLusParProjet?.[projet.id]) ? (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" data-projet-du-nouveau aria-hidden />
              ) : null}
              <ChevronDown className="h-3 w-3 shrink-0 text-faint" aria-hidden />
            </Button>
          )}
        />
      ) : (
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            avant ? 'text-[12px] text-faint' : 'text-[14px] font-medium text-text',
          )}
          data-nom-projet
        >
          {projets[0]?.nom ?? t('Mes demandes')}
        </span>
      )}

      {cloche}

      {apres}

      {menu}
    </div>
  );
}
