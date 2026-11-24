import * as React from 'react';
import { minusculesSansAccents } from '@beluga/shared';
import { BulleInfo, CLASSE_GROUPE_DE_LIGNES } from '@/components/ui';
import { t } from '@/lib/langue';

/**
 * LE TITRE DE LA SECTION QUI PORTE LA PAGE (colonne fixe des réglages, 24/11/2026). Une rubrique empile ses pages,
 * chacune sous son titre (« Mon compte », « La machine ») : un `Groupe` qui redit EXACTEMENT ce titre ne le répète
 * pas — son bloc suit directement le titre de la section. `null` hors d'une section (page seule, autre écran).
 */
export const ContexteTitreDeSection = React.createContext<string | null>(null);

const normaliserTitre = (titre: string) => minusculesSansAccents(titre.replace(/[’‘]/g, "'").trim());
export const memeTitre = (a: string, b: string) => normaliserTitre(a) === normaliserTitre(b);

/** Ce titre redit-il celui de la section qui porte la page ? */
export function useTitreRedit(titre: string): boolean {
  const titreDeSection = React.useContext(ContexteTitreDeSection);
  return !!titreDeSection && memeTitre(titre, titreDeSection);
}

/* ------------------------------------------------------------------ */
/* Les briques partagées par plusieurs sous-pages des réglages          */
/* ------------------------------------------------------------------ */

/**
 * UNE SECTION DE RÉGLAGES, AU STYLE « B » (refonte des réglages, 21/11/2026,
 * maquette #6b80) : le TITRE et sa description posés sur le fond de la page,
 * puis les options dans UN BLOC GRIS ARRONDI en dessous — la section se
 * délimite par son fond, jamais par un trait. Même tenue que
 * `RubriqueDeReglages` (modeles) : les deux s'alignent.
 *
 * `liste` : les enfants SONT des lignes (`CLASSE_LIGNE_DE_GROUPE`, `Ligne…`) —
 * le bloc les serre sans marge intérieure, comme `CLASSE_GROUPE_DE_LIGNES`.
 * Sans `liste`, le bloc pose une marge et espace ses enfants (texte, champs,
 * boutons). `nu` : pas de bloc du tout, pour un enfant qui dessine déjà le sien.
 */
export const CLASSE_BLOC_DE_REGLAGES = 'flex flex-col gap-3 rounded-2xl bg-surface p-4 max-sm:gap-4';

export function Groupe({
  titre,
  aide,
  description,
  liste,
  nu,
  children,
}: {
  titre: string;
  aide?: string;
  description?: React.ReactNode;
  liste?: boolean;
  nu?: boolean;
  children: React.ReactNode;
}) {
  const titreRedit = useTitreRedit(titre);
  return (
    <section className="flex flex-col gap-2 max-sm:gap-2.5" data-section-reglages>
      {titreRedit ? (
        /* Le titre est déjà celui de la section : l'aide se lit en clair sous lui, plus dans une bulle orpheline. */
        description || aide ? <p className="px-1 text-[13px] leading-relaxed text-muted">{description ?? aide}</p> : null
      ) : (
        <div className="flex flex-col gap-0.5 px-1">
          <div className="flex items-center gap-1">
            <h3 className="text-[14px] font-semibold text-text">{titre}</h3>
            {aide ? <BulleInfo cote="start">{aide}</BulleInfo> : null}
          </div>
          {description ? <p className="text-[13px] leading-relaxed text-muted">{description}</p> : null}
        </div>
      )}
      {nu ? (
        <div className="flex flex-col gap-3">{children}</div>
      ) : (
        <div className={liste ? CLASSE_GROUPE_DE_LIGNES : CLASSE_BLOC_DE_REGLAGES} data-bloc-reglages={liste ? 'liste' : 'bloc'}>
          {children}
        </div>
      )}
    </section>
  );
}

export function Mesure({ titre, valeur, detail }: { titre: string; valeur: string; detail: string }) {
  return (
    <div className="rounded-md border border-border bg-bloc px-2 py-1.5">
      <p className="text-[11.5px] uppercase tracking-wide text-faint">{titre}</p>
      <p className="mt-0.5 text-[14.5px] font-medium text-text">{valeur}</p>
      <p className="mt-0.5 text-[11.5px] leading-relaxed text-faint">{detail}</p>
    </div>
  );
}

/** Des mégaoctets par milliers ne se lisent pas : « 5,6 Go » se lit. */
export function gigas(mo: number): string {
  return `${(mo / 1024).toFixed(1).replace('.', ',')} Go`;
}

