/**
 * UN TEXTE QUI SE LIT, ET QUI S'ÉDITE À SA PLACE EXACTE.
 *
 * Le titre et la description d'une demande étaient des CHAMPS DE SAISIE
 * toujours ouverts : on ne lisait pas une fiche, on regardait un formulaire, et
 * un clic distrait suffisait à modifier le texte d'une demande sans s'en
 * apercevoir. Ils se LISENT désormais comme du texte.
 *
 * TOUCHER LE TEXTE OUVRE L'ÉDITION. Il n'y a plus de crayon : sur téléphone il
 * se visait mal et couvrait la fin du titre. Le texte lu porte le rôle de
 * bouton (clavier : Entrée ou Espace) quand on a le droit d'écrire, et reste un
 * simple texte sinon.
 *
 * LE CHAMP S'OUVRE À LA PLACE EXACTE DU TEXTE. La hauteur lue juste avant la
 * bascule devient la hauteur minimale du champ : rien ne saute, ni au-dessus ni
 * en dessous. On valide par le bouton ou par le clavier, on annule par
 * « Échap » — et annuler remet le texte d'avant, jamais celui qu'on tapait.
 *
 * AUCUNE BORDURE. La fiche d'une demande est un flux continu sans cadre ni
 * trait : le champ se distingue par son FOND (`raised`), qui existe dans les
 * douze palettes, jamais par un liseré.
 */
import * as React from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';
import { useTelephone } from '@/lib/telephone';

export function TexteEditable({
  valeur,
  onValider,
  editable,
  multiligne,
  classeTexte,
  placeholder,
  repere,
  libelle,
  onEdition,
}: {
  /** Prévenu à l'ouverture et à la fermeture du champ — la fiche ne replie pas un texte qu'on écrit. */
  onEdition?: (enEdition: boolean) => void;
  valeur: string;
  onValider: (suite: string) => void;
  /** Sans le droit d'écrire, il n'y a ni bouton ni champ : c'est du texte. */
  editable: boolean;
  multiligne?: boolean;
  /** Le style du texte LU — le champ le reprend, pour que rien ne change d'aspect. */
  classeTexte: string;
  placeholder?: string;
  repere: string;
  /** Ce que dit le bouton d'édition : « Modifier le titre », « Modifier la description ». */
  libelle: string;
}) {
  const telephone = useTelephone();
  const [enEdition, setEnEdition] = React.useState(false);
  const [brouillon, setBrouillon] = React.useState(valeur);
  const [hauteur, setHauteur] = React.useState<number | undefined>(undefined);
  const lecture = React.useRef<HTMLDivElement | null>(null);
  const champ = React.useRef<HTMLTextAreaElement | null>(null);

  /* Le texte peut changer du DEHORS pendant qu'on ne l'édite pas — un autre
     appareil, un geste de Haiko. On ne recopie jamais par-dessus une saisie. */
  React.useEffect(() => {
    if (!enEdition) setBrouillon(valeur);
  }, [valeur, enEdition]);

  React.useEffect(() => {
    onEdition?.(enEdition);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enEdition]);

  const ouvrir = () => {
    setHauteur(lecture.current?.offsetHeight);
    setBrouillon(valeur);
    setEnEdition(true);
  };

  /**
   * LE CHAMP FAIT LA HAUTEUR DE SON TEXTE, NI PLUS NI MOINS.
   *
   * Un `rows` fixe donne au champ une hauteur ARBITRAIRE — quatre lignes pour
   * une description d'une ligne —, et la fiche bondissait de cent pixels à
   * l'ouverture. Une hauteur MINIMALE ne suffit pas non plus : la hauteur
   * naturelle d'un `textarea` dépasse déjà celle du texte lu. On la POSE donc,
   * à partir du contenu réel, et on la reprend à chaque frappe — le champ grandit
   * en écrivant, il ne saute jamais.
   */
  const ajusterLaHauteur = React.useCallback(
    (zone: HTMLTextAreaElement | null) => {
      if (!zone) return;
      /* On REMET À ZÉRO avant de lire : à `auto`, un `textarea` garde la hauteur
         de ses `rows`, et `scrollHeight` rend cette hauteur-là plutôt que celle
         du texte. À zéro, il ne reste que le contenu. */
      zone.style.height = '0px';
      zone.style.height = `${Math.max(hauteur ?? 0, zone.scrollHeight)}px`;
    },
    [hauteur],
  );

  React.useEffect(() => {
    if (!enEdition) return;
    const zone = champ.current;
    if (!zone) return;
    ajusterLaHauteur(zone);
    zone.focus();
    zone.setSelectionRange(zone.value.length, zone.value.length);
  }, [enEdition, ajusterLaHauteur]);

  const valider = () => {
    setEnEdition(false);
    if (brouillon !== valeur) onValider(brouillon);
  };

  const annuler = () => {
    setBrouillon(valeur);
    setEnEdition(false);
  };

  if (enEdition) {
    return (
      <div className="relative" data-texte-editable={repere} data-en-edition="">
        <textarea
          ref={champ}
          value={brouillon}
          onChange={(event) => {
            setBrouillon(event.target.value);
            ajusterLaHauteur(event.target);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              annuler();
              return;
            }
            /* Sur une seule ligne, « Entrée » valide. Sur plusieurs, elle va à
               la ligne — et c'est « Ctrl/⌘ + Entrée » qui valide. */
            if (event.key !== 'Enter') return;
            if (multiligne && !event.metaKey && !event.ctrlKey) return;
            event.preventDefault();
            valider();
          }}
          rows={1}
          placeholder={placeholder}
          aria-label={libelle}
          className={cn(
            /* AUCUN LISERÉ : le fond seul dit qu'on est dans un champ. */
            /* `block` n'est pas un détail : un `textarea` est en ligne par défaut, et son
             parent lui réserve alors la place des jambages sous la ligne de base —
             cinq pixels de plus que le texte qu'il remplace, à chaque ouverture. */
            /* Le texte lu n'a pas de retrait : le champ déborde de 8 px de
               chaque côté (`-mx-2`) pour que les lettres restent à la même place. */
            '-mx-2 block w-[calc(100%+1rem)] resize-none overflow-hidden rounded-md bg-raised px-2 py-1 pr-14 outline-none ring-1 ring-inset ring-accent/40',
            classeTexte,
          )}
          data-champ-edition={repere}
        />
        {/*
         * VALIDER ET ANNULER SONT POSÉS EN ABSOLU, dans le coin du champ, là où
         * était le crayon : une rangée de boutons EN FLUX aurait poussé vers le
         * bas tout ce qui suit à chaque ouverture. Rien ne bouge.
         */}
        <div className="absolute right-0 top-0 flex items-center gap-0.5">
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={valider}
            title={t('Valider')}
            aria-label="Valider"

            className="bg-surface/80"
            data-valider-edition={repere}
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={annuler}
            title={t('Annuler')}
            aria-label="Annuler"

            className="bg-surface/80"
            data-annuler-edition={repere}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative" data-texte-editable={repere}>
      <div
        ref={lecture}
        /*
         * LE TEXTE LUI-MÊME OUVRE L'ÉDITION. Le crayon posé en coin se visait
         * mal au pouce et masquait la fin du titre : toucher le titre ou la
         * description suffit. Un lien touché s'ouvre, une sélection à la souris
         * se copie — ni l'un ni l'autre ne bascule en édition.
         */
        role={editable ? 'button' : undefined}
        tabIndex={editable ? 0 : undefined}
        aria-label={editable ? libelle : undefined}
        title={editable && !telephone ? libelle : undefined}
        onClick={
          editable
            ? (event) => {
                if ((event.target as HTMLElement).closest('a')) return;
                if (window.getSelection()?.toString()) return;
                ouvrir();
              }
            : undefined
        }
        onKeyDown={
          editable
            ? (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                ouvrir();
              }
            : undefined
        }
        className={cn(
          /* AUCUN RETRAIT HORIZONTAL : le texte part du même bord gauche que
             la ligne « auteur · date » qui le suit. */
          'whitespace-pre-wrap break-words py-1',
          editable ? 'cursor-text rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-accent/40' : null,
          classeTexte,
          !valeur.trim() ? 'text-faint' : null,
        )}
        data-texte-lu={repere}
        data-ouvrir-edition={editable ? repere : undefined}
      >
        {valeur.trim() || placeholder || ''}
      </div>
    </div>
  );
}
