import * as React from 'react';
import { Slash } from '@/components/ui/icones';
import { CommandeSlash, OrigineCommande, RefusDeCommande, sectionDeLaCommande } from '@beluga/shared';
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
 * DEUX SECTIONS, dans cet ordre : celles de BELUGA (communes à tous les
 * moteurs, changées en consigne par le démon), puis celles du moteur choisi
 * dans les réglages de l'agent (projet, compte, moteur). Changer de moteur
 * change la seconde, sans rien fermer. L'ordre affiché EST celui de la liste
 * reçue (`filtrerCommandes` garde les sections) : les flèches la parcourent
 * telle quelle, d'une section à l'autre.
 *
 * UNE COMMANDE DU MOTEUR PART SEULE (`refusDeCommande`) : la ligne qui ne peut
 * pas s'écrire dans ce message reste visible mais grisée, et DIT pourquoi à la
 * place de sa description — le choix n'écrit rien.
 */

/** Le refus, dit en mots courants. */
function texteDuRefus(refus: RefusDeCommande): string {
  return refus === 'moteur-seule'
    ? t('Une commande du moteur part seule dans son message')
    : t('Ce message porte déjà une commande du moteur, qui part seule');
}

/** Une description écrite PAR NOUS (Beluga, moteur recopié) passe au dictionnaire ; celle du disque reste telle quelle. */
function descriptionAffichee(commande: CommandeSlash): string | undefined {
  if (!commande.description) return undefined;
  /* « /ordinateur:<repère> » : la description est le NOM de l'ordinateur, une donnée — jamais traduite. */
  if (commande.nom.includes(':') && commande.origine === 'beluga') return commande.description;
  return commande.origine === 'beluga' || commande.origine === 'moteur' ? t(commande.description) : commande.description;
}

/** D'où vient la commande, dit en un mot à droite de son nom. */
function motDOrigine(origine: OrigineCommande): string {
  // Les mêmes mots que le reste de l'interface : le dictionnaire ne garde pas
  // deux clés pour un seul mot. L'affichage les met en capitales lui-même.
  if (origine === 'projet') return t('Projet');
  if (origine === 'compte') return t('Compte');
  if (origine === 'beluga') return '';
  return t('Moteur');
}

export function MenuSlash({
  commandes,
  index,
  nomDuMoteur,
  onChoisir,
  onSurvol,
  refus,
}: {
  /** Déjà filtrées sur ce qui est tapé, et triées. */
  commandes: CommandeSlash[];
  /** La ligne visée au clavier ; les flèches la déplacent depuis le champ. */
  index: number;
  nomDuMoteur: string;
  onChoisir: (commande: CommandeSlash) => void;
  onSurvol: (index: number) => void;
  /** Pourquoi une commande ne peut pas s'écrire dans ce message, ou `null`. */
  refus?: (commande: CommandeSlash) => RefusDeCommande | null;
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
        // dans le conteneur du champ), bord bas absent, et 12 px de
        // recouvrement — le rayon du champ, sous lequel il passe vraiment.
        'relative z-0 -mb-3 flex shrink-0 flex-col rounded-t-lg',
        'border border-b-0 border-border bg-bloc-etapes [--fond-zone-defilement:hsl(var(--bloc-etapes))]',
        'shadow-[inset_0_-6px_6px_-6px_rgba(0,0,0,0.35)]',
      )}
    >
      <div className="flex items-center gap-2 px-3 pt-1.5">
        <Slash className="h-3 w-3 shrink-0 text-teinte" />
        <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{t('Commandes « / »')}</span>
        {commandes.length ? (
          <span className="shrink-0 text-[11.5px] text-faint">{t('↑ ↓ puis Entrée')}</span>
        ) : null}
      </div>

      {commandes.length ? (
        <ZoneDefilement classeEnveloppe="max-h-[min(35vh,240px)] flex-none" className="px-1.5 pb-5 pt-1">
          <ul>
            {commandes.map((commande, rang) => {
              const section = sectionDeLaCommande(commande);
              const ouvreSection = rang === 0 || sectionDeLaCommande(commandes[rang - 1]!) !== section;
              const origine = motDOrigine(commande.origine);
              const refusee = refus?.(commande) ?? null;
              const description = refusee ? texteDuRefus(refusee) : descriptionAffichee(commande);
              return (
              <li key={`${commande.origine}-${commande.nom}`}>
                {ouvreSection ? (
                  <p
                    data-section-slash={section}
                    className={cn('truncate px-2 pb-0.5 text-[11px] uppercase tracking-wide text-faint sm:px-1.5', rang > 0 && 'pt-2')}
                  >
                    {section === 'beluga' ? 'Beluga' : t('Commandes de {v0}', { v0: nomDuMoteur })}
                  </p>
                ) : null}
                <button
                  ref={rang === index ? ligneVisee : undefined}
                  type="button"
                  data-commande={commande.nom}
                  data-visee={rang === index ? '1' : undefined}
                  data-commande-refusee={refusee ?? undefined}
                  aria-disabled={refusee ? true : undefined}
                  // Le clic doit passer AVANT que le champ ne perde le focus :
                  // sur `mousedown`, le curseur est encore là où il faut écrire.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onChoisir(commande);
                  }}
                  onMouseEnter={() => onSurvol(rang)}
                  className={cn(
                    // La marge de défilement garde la ligne visée hors du fondu des bords.
                    'flex w-full scroll-my-6 items-baseline gap-2 rounded px-2 sm:px-1.5 py-1.5 sm:py-1 text-left',
                    refusee ? 'cursor-not-allowed' : rang === index ? 'bg-teinte-fond' : 'hover:bg-raised',
                    refusee && rang === index && 'bg-raised',
                  )}
                >
                  <span
                    className={cn(
                      'shrink-0 text-[13.5px] font-medium tabular-nums',
                      refusee ? 'text-faint' : rang === index ? 'text-teinte' : 'text-text',
                    )}
                  >
                    /{commande.nom}
                  </span>
                  {description ? (
                    <span className={cn('min-w-0 flex-1 truncate text-[12.5px]', refusee ? 'text-faint' : 'text-muted')}>{description}</span>
                  ) : (
                    <span className="min-w-0 flex-1" />
                  )}
                  {origine ? (
                    <span className="shrink-0 text-[11px] uppercase tracking-wide text-faint">{origine}</span>
                  ) : null}
                </button>
              </li>
              );
            })}
          </ul>
        </ZoneDefilement>
      ) : (
        <p className="px-3 pb-5 pt-1 text-[12.5px] leading-snug text-faint">
          {t('Aucune commande « / » pour ce moteur : continuez d’écrire normalement.')}
        </p>
      )}
    </div>
  );
}
