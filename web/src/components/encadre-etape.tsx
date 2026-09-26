import * as React from 'react';
import { ChevronRight, CircleAlert } from 'lucide-react';
import { cn, duration } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * LA COQUILLE COMMUNE À TOUS LES ENCADRÉS D'UNE ÉTAPE D'AGENT.
 *
 * Chaque genre d'étape — une question posée, une commande lancée, la mémoire
 * ouverte — a désormais son propre dessin. Sans coquille partagée, ces dessins
 * auraient dérivé l'un de l'autre dès le troisième : un titre ici en capitales
 * et là en minuscules, un fond gris à deux nuances près, un repliement à deux
 * gestes différents.
 *
 * ELLE TIENT EN TROIS PIÈCES, ET TROIS SEULEMENT :
 *
 *  - `EncadreEtape` : un BANDEAU DE TÊTE au fond contrasté qui porte l'intitulé
 *    de l'étape, et un corps en dessous ;
 *  - `LigneDeChamp` / `ChampsNommes` : un couple intitulé-valeur, pour tout ce
 *    qui se dit en un mot ;
 *  - `BlocReplie` : un contenu long qui tient sa place sans écraser le fil.
 *
 * LES COULEURS VIENNENT TOUTES DU THÈME (`bg-raised`, `text-faint`, `--faint`
 * pour les traits porteurs d'information) : les douze apparences claires et
 * sombres se corrigent donc ensemble, et aucune teinte n'est écrite en dur.
 */

/**
 * CE QUE LA SOUS-LIGNE D'UNE ÉTAPE PORTAIT, REMONTÉ DANS LE BANDEAU.
 *
 * Ouvrir une étape du fil montrait une sous-ligne par geste (« Lire le module
 * de TVA — 1 s »), qu'il fallait rouvrir pour voir l'encadré : un clic de
 * plus, et une phrase qui redisait l'encadré. Les encadrés s'affichent
 * maintenant directement ; le temps pris, l'état et l'échec — seules
 * informations propres à la sous-ligne — passent dans la tête de l'encadré.
 *
 * C'EST UN CONTEXTE, pas une prop : l'aiguillage (`ContenuDeLEntree`) connaît
 * l'entrée, chaque dessin de sorte ne connaît que sa vue, et la coquille est
 * posée par chacun d'eux. Hors d'une étape (la question d'un bloc raconté),
 * rien n'est fourni et le bandeau reste nu.
 */
export interface TeteDEtape {
  dureeMs?: number;
  /** L'état déjà dit en mots (« En cours »), traduit par la coquille. */
  etat?: string;
  echec?: boolean;
  /**
   * LA PHRASE DÉJÀ LUE JUSTE AU-DESSUS (celle du bloc raconté). Un dessin qui
   * allait la redire — l'intention d'une commande — s'en abstient.
   */
  dejaDit?: string;
}

export const ContexteTeteDEtape = React.createContext<TeteDEtape | null>(null);

/** La tête de l'étape en cours de dessin, s'il y en a une. */
export function useTeteDEtape(): TeteDEtape | null {
  return React.useContext(ContexteTeteDEtape);
}

/** Combien de lignes un contenu long montre avant de proposer la suite. */
const LIGNES_AVANT_REPLI = 12;

/**
 * UN ENCADRÉ D'ÉTAPE : son bandeau de tête, et son corps.
 *
 * Le bandeau porte l'intitulé de l'étape — repris des titres déjà écrits pour
 * le récit (`TITRES_DU_GENRE`), jamais inventé ici — sur un fond plus marqué
 * que le corps : c'est ce contraste, et lui seul, qui dit où un encadré commence
 * quand trois se suivent dans le fil.
 */
export function EncadreEtape({
  titre,
  icone: Icone,
  aDroite,
  sorte,
  ton = 'neutre',
  children,
}: {
  titre: string;
  icone?: React.ComponentType<{ className?: string }>;
  /** Ce qui se pose à droite du bandeau : un genre de choix, un compte. */
  aDroite?: React.ReactNode;
  /** La sorte de contenu, posée en repère pour les contrôles navigateur. */
  sorte: string;
  /** `echec` teinte le bandeau en rouge : une commande refusée se voit repliée. */
  ton?: 'neutre' | 'echec';
  children: React.ReactNode;
}) {
  const tete = useTeteDEtape();
  const enEchec = ton === 'echec' || tete?.echec === true;
  /* Moins d'une seconde ne se dit pas : `duration` rendrait un tiret, qui ne
     porte aucune information et se lisait comme un bouton. */
  const duree = tete?.dureeMs !== undefined && tete.dureeMs >= 1000 ? duration(tete.dureeMs / 1000) : undefined;
  return (
    <section
      className="overflow-hidden rounded-lg bg-raised/40"
      data-encadre={sorte}
      data-encadre-echec={enEchec ? 'oui' : undefined}
    >
      <header
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5',
          enEchec ? 'bg-danger/15' : 'bg-raised',
        )}
        data-encadre-bandeau
      >
        {enEchec ? (
          <CircleAlert className="h-3.5 w-3.5 shrink-0 text-danger" aria-hidden />
        ) : Icone ? (
          <Icone className="h-3.5 w-3.5 shrink-0 text-faint" />
        ) : null}
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-[12px] font-semibold uppercase tracking-wide',
            enEchec ? 'text-danger' : 'text-muted',
          )}
          data-encadre-titre
        >
          {titre}
        </span>
        {aDroite ? <span className="min-w-0 shrink truncate text-[12px] text-faint">{aDroite}</span> : null}
        {tete?.etat ? (
          <span className="shrink-0 text-[12px] text-faint" data-encadre-etat>
            {t(tete.etat)}
          </span>
        ) : null}
        {duree ? (
          <span className="shrink-0 font-mono text-[12px] text-faint" data-encadre-duree={tete?.dureeMs}>
            {duree}
          </span>
        ) : null}
      </header>
      <div className="space-y-2 px-2.5 py-2">{children}</div>
    </section>
  );
}

/** Le petit titre gris d'un champ — le même partout, pour que rien ne dérive. */
export function Etiquette({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] uppercase tracking-wide text-faint">{children}</p>;
}

/**
 * UN COUPLE INTITULÉ-VALEUR. C'est la forme de tout ce qui se dit en un mot :
 * un délai, un mode, un état. La valeur se copie à la souris — ces textes sont
 * faits pour être repris ailleurs.
 */
export function ChampsNommes({ champs }: { champs: readonly { cle: string; libelle: string; valeur: string }[] }) {
  if (!champs.length) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px]" data-encadre-champs>
      {champs.map((champ) => (
        <React.Fragment key={champ.cle}>
          <dt className="text-faint">{champ.libelle}</dt>
          <dd className="min-w-0 break-words text-text texte-copiable">{champ.valeur}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/**
 * UN CONTENU LONG, REPLIÉ SOUS SON ÉTIQUETTE.
 *
 * Le repli n'est PAS un `line-clamp` posé dans un bouton : un texte replié dans
 * un `button` ne se sélectionne plus à la souris. Le texte garde donc son
 * propre cadre, borné en hauteur, et le bouton « voir la suite » vit À CÔTÉ de
 * lui — jamais autour.
 */
export function BlocReplie({
  titre,
  texte,
  className,
  mono = true,
  repere,
}: {
  titre?: string;
  texte: string;
  className?: string;
  /** Les sorties de commandes et les extraits de code gardent leur alignement. */
  mono?: boolean;
  repere?: string;
}) {
  const [tout, setTout] = React.useState(false);
  const lignes = texte.split('\n').length;
  const long = lignes > LIGNES_AVANT_REPLI || texte.length > 1200;

  return (
    <div className="min-w-0" {...(repere ? { [repere]: '' } : {})}>
      {titre ? <Etiquette>{titre}</Etiquette> : null}
      <pre
        className={cn(
          'mt-0.5 overflow-auto whitespace-pre-wrap break-words rounded-md bg-raised/60 px-2 py-1.5 text-text texte-copiable',
          mono ? 'font-mono text-[12.5px]' : 'text-[13px]',
          long && !tout ? 'max-h-48' : 'max-h-96',
          className,
        )}
        data-encadre-texte
      >
        {texte}
      </pre>
      {long ? (
        <button
          type="button"
          onClick={() => setTout((v) => !v)}
          aria-expanded={tout}
          data-encadre-repli={tout ? 'ouvert' : 'ferme'}
          className="mt-1 flex items-center gap-1 text-[12.5px] text-faint transition-colors hover:text-muted"
        >
          <ChevronRight className={cn('h-3 w-3 transition-transform', tout && 'rotate-90')} aria-hidden />
          {tout ? t('Replier') : t('Tout voir')}
        </button>
      ) : null}
    </div>
  );
}

/**
 * UNE PHRASE D'ÉTAT : « restée sans réponse », « aucune sortie ». Elle est en
 * retrait et en italique — c'est un CONSTAT sur l'étape, pas son contenu.
 */
export function Constat({ children, repere }: { children: React.ReactNode; repere?: string }) {
  return (
    <p className="text-[12.5px] italic text-faint" {...(repere ? { [repere]: '' } : {})}>
      {children}
    </p>
  );
}

/**
 * UN CHEMIN DE FICHIER : son NOM ressort, son dossier s'efface. C'est le nom
 * qu'on cherche des yeux dans une colonne de vingt lectures ; le dossier n'est
 * là que pour lever un doute.
 */
export function Chemin({ chemin }: { chemin: string }) {
  const coupe = chemin.lastIndexOf('/');
  const dossier = coupe > 0 ? chemin.slice(0, coupe + 1) : '';
  const nom = coupe > 0 ? chemin.slice(coupe + 1) : chemin;
  return (
    <span className="min-w-0 break-all font-mono text-[12.5px] texte-copiable" data-encadre-chemin>
      {dossier ? <span className="text-faint">{dossier}</span> : null}
      <span className="text-text">{nom}</span>
    </span>
  );
}
