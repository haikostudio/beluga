import * as React from 'react';
import { Slash, X } from 'lucide-react';
import { CommandeSlash, OrigineCommande } from '@beluga/shared';
import { ZoneDefilement } from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * LE MENU DES COMMANDES « / », POSÉ AU-DESSUS DE LA BARRE D'ÉCRITURE.
 *
 * Même endroit et même habillage que le repère des tâches en cours
 * (`TravailEnCours`, `chat.tsx`) : un bandeau à bord haut arrondi, collé au
 * champ, sur le fond dédié `bg-bloc-etapes` — celui qui contraste avec le fond
 * noir de la conversation comme avec le gris du tiroir d'une carte.
 *
 * Il ne montre QUE les commandes du moteur choisi dans les réglages de l'agent.
 * Changer de moteur change donc la liste, sans rien fermer.
 */

/** D'où vient la commande, dit en un mot à droite de son nom. */
function motDOrigine(origine: OrigineCommande): string {
  // Les mêmes mots que le reste de l'interface : le dictionnaire ne garde pas
  // deux clés pour un seul mot. L'affichage les met en capitales lui-même.
  if (origine === 'projet') return t('Projet');
  if (origine === 'compte') return t('Compte');
  return t('Moteur');
}

export function MenuSlash({
  commandes,
  index,
  nomDuMoteur,
  onChoisir,
  onSurvol,
}: {
  /** Déjà filtrées sur ce qui est tapé, et triées. */
  commandes: CommandeSlash[];
  /** La ligne visée au clavier ; les flèches la déplacent depuis le champ. */
  index: number;
  nomDuMoteur: string;
  onChoisir: (commande: CommandeSlash) => void;
  onSurvol: (index: number) => void;
}) {
  const ligneVisee = React.useRef<HTMLButtonElement | null>(null);

  // La ligne visée reste sous les yeux quand les flèches sortent de la fenêtre.
  React.useEffect(() => {
    ligneVisee.current?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  return (
    <div
      data-menu-slash
      className={cn(
        // Mêmes règles que le repère des tâches : pas de marge latérale (il vit
        // dans le conteneur du champ), bord bas absent, recouvrement de 8px.
        'relative z-0 -mb-2 flex shrink-0 flex-col rounded-t-lg',
        'border border-b-0 border-border bg-bloc-etapes',
        'shadow-[inset_0_-6px_6px_-6px_rgba(0,0,0,0.35)]',
      )}
    >
      <div className="flex items-center gap-2 px-3 pt-1.5">
        <Slash className="h-3 w-3 shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
          {t('Commandes de {v0}', { v0: nomDuMoteur })}
        </span>
        {commandes.length ? (
          <span className="shrink-0 text-[11.5px] text-faint">{t('↑ ↓ puis Entrée')}</span>
        ) : null}
      </div>

      {commandes.length ? (
        <ZoneDefilement classeEnveloppe="max-h-[min(35vh,240px)] flex-none" className="px-1.5 pb-4 pt-1">
          <ul>
            {commandes.map((commande, rang) => (
              <li key={`${commande.origine}-${commande.nom}`}>
                <button
                  ref={rang === index ? ligneVisee : undefined}
                  type="button"
                  data-commande={commande.nom}
                  data-visee={rang === index ? '1' : undefined}
                  // Le clic doit passer AVANT que le champ ne perde le focus :
                  // sur `mousedown`, le curseur est encore là où il faut écrire.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onChoisir(commande);
                  }}
                  onMouseEnter={() => onSurvol(rang)}
                  className={cn(
                    'flex w-full items-baseline gap-2 rounded px-1.5 py-1 text-left',
                    rang === index ? 'bg-accent/12' : 'hover:bg-raised',
                  )}
                >
                  <span
                    className={cn(
                      'shrink-0 text-[13.5px] font-medium tabular-nums',
                      rang === index ? 'text-accent' : 'text-text',
                    )}
                  >
                    /{commande.nom}
                  </span>
                  {commande.description ? (
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">{commande.description}</span>
                  ) : (
                    <span className="min-w-0 flex-1" />
                  )}
                  <span className="shrink-0 text-[11px] uppercase tracking-wide text-faint">
                    {motDOrigine(commande.origine)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </ZoneDefilement>
      ) : (
        <p className="px-3 pb-4 pt-1 text-[12.5px] leading-snug text-faint">
          {t('Aucune commande « / » pour ce moteur : continuez d’écrire normalement.')}
        </p>
      )}
    </div>
  );
}

/**
 * LA COMMANDE RECONNUE DANS LE MESSAGE, montrée en pastille au-dessus du champ.
 *
 * Le texte, lui, n'est PAS transformé : « /nom » reste écrit en toutes lettres
 * en tête du message, la seule forme que les moteurs comprennent. La pastille
 * ne fait que le DIRE — c'est ainsi qu'on voit, avant d'envoyer, que le moteur
 * recevra bien une commande et pas une phrase qui commence par une barre.
 */
export function PastilleCommande({ nom, onRetirer }: { nom: string; onRetirer: () => void }) {
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1.5 px-1">
      <span
        data-commande-reconnue={nom}
        className="inline-flex max-w-full items-center gap-1 rounded border border-accent/40 bg-accent/12 px-1.5 py-0.5 text-[12.5px] text-accent"
      >
        <Slash className="h-3 w-3 shrink-0" />
        <span className="truncate">{nom}</span>
        <button
          type="button"
          onClick={onRetirer}
          title={t('Retirer la commande')}
          className="shrink-0 opacity-70 hover:opacity-100"
        >
          <X className="h-3 w-3" />
        </button>
      </span>
      <span className="text-[12px] text-faint">{t('part en tête du message, telle quelle')}</span>
    </div>
  );
}
