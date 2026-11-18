import * as React from 'react';
import { Search } from '@/components/ui/icones';
import { Button } from '@/components/ui';
import { ChampDeRecherche } from '@/components/ui/champ-de-recherche';
import { t } from '@/lib/langue';
import { useTelephone } from '@/lib/telephone';
import { cn } from '@/lib/utils';

type Reperes = Record<`data-${string}`, string | number | boolean | undefined>;

/**
 * LA RECHERCHE EN ICÔNE, EN HAUT À DROITE (carte « Refonte de l'espace Médias », 05/11/2026, captures #b9da #14f9 :
 * « la recherche et le filtre en boutons à icône en haut à droite, partout dans l'app ») : une loupe de la hauteur des
 * boutons de barre ; un clic l'ouvre en champ, sur place. Le champ reste ouvert tant qu'il porte un texte ; vide, il
 * se referme quand on le quitte (ou par Échap). Les repères `data-*` passés se posent sur le CHAMP (les contrôles
 * existants le visent) ; la loupe fermée porte `data-recherche-en-icone`.
 */
export function RechercheEnIcone({
  valeur,
  onChange,
  placeholder,
  className,
  largeur = 'w-60',
  'aria-label': ariaLabel,
  ...reperes
}: {
  valeur: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  /** La largeur du champ ouvert (classe). */
  largeur?: string;
  'aria-label'?: string;
} & Reperes) {
  const [ouvert, setOuvert] = React.useState(false);
  const champ = React.useRef<HTMLInputElement | null>(null);
  const deplie = ouvert || !!valeur;
  const libelle = placeholder ?? t('Rechercher…');
  if (!deplie) {
    return (
      <Button
        type="button"
        size="icon-barre"
        variant="ghost"
        className={cn('shrink-0 text-muted', className)}
        onClick={() => setOuvert(true)}
        aria-label="Rechercher"
        title={libelle}
        data-recherche-en-icone=""
      >
        <Search className="h-4 w-4" />
      </Button>
    );
  }
  return (
    <span
      className={cn('flex shrink-0', largeur, className)}
      data-recherche-en-icone="ouverte"
      onBlur={(e) => {
        if (!valeur && !e.currentTarget.contains(e.relatedTarget as Node | null)) setOuvert(false);
      }}
    >
      <ChampDeRecherche
        ref={champ}
        valeur={valeur}
        onChange={onChange}
        placeholder={libelle}
        autoFocus={ouvert}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !valeur) {
            e.stopPropagation();
            setOuvert(false);
          }
        }}
        {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
        {...reperes}
      />
    </span>
  );
}

/**
 * LA RECHERCHE D'UNE PAGE DE SERVICE, SUR TÉLÉPHONE SEULEMENT : le champ pleine largeur, à sa place dans la page
 * (`telephone`). SUR ORDINATEUR, PLUS DE LOUPE EN HAUT À DROITE (carte « Lecteur de charte : commentaires et barre »,
 * décision de l'utilisateur) : la recherche au clavier (⌘F, `RechercheCentrale`) trouve ce que ces pages montrent —
 * documents de charte, fiches du coffre, créations du Studio, mémoire, sites suivis.
 */
export function RechercheDePage({ telephone: surTelephone }: { telephone: React.ReactNode }) {
  const telephone = useTelephone();
  return telephone ? <>{surTelephone}</> : null;
}
