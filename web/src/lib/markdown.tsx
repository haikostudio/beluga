import * as React from 'react';
import {
  Lightbulb,
  Info,
  AlertTriangle,
  ChevronRight,
  OctagonAlert,
  Check,
  ClipboardList,
  Search,
  CheckCircle2,
  Repeat,
  Target,
  Sprout,
  Coins,
  Scale,
  FileText,
  Hash,
  Sparkles,
  Loader2,
  ExternalLink,
  type LucideIcon,
} from '@/components/ui/icones';
import { buttonVariants } from '@/components/ui';
import { CheminCliquable } from '@/lib/chemin-cliquable';
import {
  cheminDeFichierCite,
  MOTIF_MARKDOWN_EN_LIGNE,
  REPERE_SERVICES_CREATION,
  sansBlocDeChiffrage,
  SUITES_MAX_APRES_AJOUTS,
  ideeDejaEnvoyee,
  lireLigneDIllustration,
  mediaDuLien,
  type SuiteProposee,
  ligneDeSuggestion,
  paragraphBreakAfter,
  titreSansEmoji,
  MARQUE_ECART_FERME,
  MARQUE_ECART_OUVRE,
  sansMarquesDEcart,
} from '@beluga/shared';
import { cn } from './utils';
import { t } from '@/lib/langue';
import { ContexteTextesEnvoyes, useIdeeEnvoyee, useLignesDansLeChamp } from '@/lib/texte-du-champ';
import { client } from '@/lib/client';
import { ouvrirUnMedia } from '@/lib/ouvrir-un-media';
import { ImageDeVignette, noterLaLegende, ReferenceSousLeMedia, useReferenceDeLaPiece } from '@/components/cadre-de-media';

/**
 * Rendu Markdown maison : titres numérotés (l'application ajoute les icônes),
 * encadrés colorés, et surtout les « Évolutions possibles » CLIQUABLES (§15).
 *
 * Les paragraphes du moteur sont RESPECTÉS : deux lignes ne sont recollées que
 * si la première s'arrête en plein milieu d'une phrase (voir
 * `paragraphBreakAfter` dans le paquet partagé). Sans ça, une réponse écrite
 * ligne par ligne se retrouvait fondue en un seul pavé.
 */

/**
 * Chaque section est classée par sa NATURE — comprendre, agir, en tirer les
 * conséquences, ou conclure — et rendue dans un cadre de la couleur d'état
 * correspondante (§17 : seules les couleurs d'état existent dans la palette,
 * jamais une teinte décorative). L'icône reste, mais ne suffit plus seule :
 * le cadre se voit avant même de lire le titre.
 */
type Tone = 'info' | 'success' | 'warning' | 'neutral';

/*
 * DES ICÔNES AU TRAIT FIN, JAMAIS D'EMOJI. Les emojis en couleur du sommaire et
 * des titres de parties juraient avec le reste de l'application : chaque
 * nature garde son image, mais dessinée par la même famille d'icônes.
 */
const SECTION_ICONS: { test: RegExp; icon: LucideIcon; tone: Tone }[] = [
  /* LE PREMIER BLOC D'UN PLAN : la liste des tâches à réaliser. Il passe AVANT
     « chemin à suivre » pour garder son icône à lui. */
  { test: /liste des tâches|liste de tâches|tâches à réaliser/i, icon: ClipboardList, tone: 'neutral' },
  { test: /décisions des itérations|décisions/i, icon: Scale, tone: 'neutral' },
  { test: /analyse|faisabilité/i, icon: Search, tone: 'info' },
  { test: /ce qui est fait|actions faites|tâches publiées|ce qui a été publié|chemin à suivre/i, icon: CheckCircle2, tone: 'success' },
  { test: /conséquences|ce qui change|approche retenue|déroulé|ce qui est en ligne/i, icon: Repeat, tone: 'warning' },
  { test: /impact|vérification|résultat|améliorations apportées/i, icon: Target, tone: 'warning' },
  { test: /évolutions possibles|suites éventuelles|état final/i, icon: Sprout, tone: 'neutral' },
  { test: /coûts|activation|facturation|temps et coût|estimation développeur/i, icon: Coins, tone: 'neutral' },
];

const TONE_CLASSES: Record<Tone, string> = {
  info: 'border-transparent bg-surface',
  success: 'border-transparent bg-surface',
  warning: 'border-transparent bg-surface',
  neutral: 'border-transparent bg-surface',
};

/**
 * Toute ligne a son icône, pour que le texte du sommaire reste aligné : un
 * titre de premier niveau (le titre du plan) prend un document, tout autre
 * titre non reconnu un repère neutre.
 */
function styleFor(title: string, level = 2): { icon: LucideIcon; tone: Tone } {
  const entry = SECTION_ICONS.find((e) => e.test.test(title));
  return { icon: entry?.icon ?? (level === 1 ? FileText : Hash), tone: entry?.tone ?? 'neutral' };
}

const CALLOUTS: Record<string, { icon: React.ReactNode; className: string; label: string }> = {
  TIP: { icon: <Lightbulb className="h-3.5 w-3.5" />, className: 'border-transparent bg-surface text-muted', label: 'Conseil' },
  NOTE: { icon: <Info className="h-3.5 w-3.5" />, className: 'border-transparent bg-surface text-muted', label: 'Note' },
  IMPORTANT: { icon: <Info className="h-3.5 w-3.5" />, className: 'border-transparent bg-raised text-text', label: 'Important' },
  WARNING: { icon: <AlertTriangle className="h-3.5 w-3.5" />, className: 'border-transparent bg-raised text-text', label: 'Attention' },
  CAUTION: { icon: <OctagonAlert className="h-3.5 w-3.5" />, className: 'border-transparent bg-danger/10 text-danger', label: 'Risque' },
};

/** Un morceau d'un texte en ligne : du texte nu, ou l'un de ses quatre habillages. */
type MorceauEnLigne =
  | { genre: 'texte' | 'gras' | 'code' | 'italique'; texte: string }
  | { genre: 'lien'; texte: string; href: string };

/**
 * LE DÉCOUPAGE D'UN TEXTE EN LIGNE, LU UNE SEULE FOIS. Le rendu (`inline`) et
 * le texte lisible (`texteEnLigne`) partent de ces mêmes morceaux : ce qui
 * s'affiche en gras est exactement ce qui perd ses étoiles.
 */
function morceauxEnLigne(text: string): MorceauEnLigne[] {
  const morceaux: MorceauEnLigne[] = [];
  // L'italique par soulignés ne s'ouvre qu'en bordure de mot : `userspsy_language_tmp` reste intact.
  const pattern = new RegExp(MOTIF_MARKDOWN_EN_LIGNE.source, MOTIF_MARKDOWN_EN_LIGNE.flags);
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) morceaux.push({ genre: 'texte', texte: text.slice(last, match.index) });
    const token = match[0];
    if (token.startsWith('**')) morceaux.push({ genre: 'gras', texte: token.slice(2, -2) });
    else if (token.startsWith('`')) morceaux.push({ genre: 'code', texte: token.slice(1, -1) });
    else if (token.startsWith('_') || token.startsWith('*')) morceaux.push({ genre: 'italique', texte: token.slice(1, -1) });
    else {
      const linkMatch = token.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        /* UNE IMAGE « ![…](piece:…) » restée DANS une phrase : jamais un « ! » suivi d'un lien (capture #fbac0). */
        const avant = morceaux[morceaux.length - 1];
        if (linkMatch[2].startsWith('piece:') && avant?.genre === 'texte' && avant.texte.endsWith('!')) {
          avant.texte = avant.texte.slice(0, -1);
          if (!avant.texte) morceaux.pop();
        }
        morceaux.push({ genre: 'lien', texte: linkMatch[1], href: linkMatch[2] });
      }
    }
    last = match.index + token.length;
  }
  if (last < text.length) morceaux.push({ genre: 'texte', texte: text.slice(last) });
  return morceaux;
}

/**
 * `sansLien` : le texte vit DANS un bouton (une idée à cocher). Un lien y
 * serait un second geste niché dans le premier : seul son libellé s'affiche.
 */
function inline(text: string, key: string, sansLien = false): React.ReactNode {
  if (text.includes(MARQUE_ECART_OUVRE) || text.includes(MARQUE_ECART_FERME)) return inlineAvecEcarts(text, key, sansLien);
  return inlineSansEcarts(text, key, sansLien);
}

/**
 * CE QUI A CHANGÉ DEPUIS LA COMPRÉHENSION PRÉCÉDENTE, EN VIOLET (13/11/2026) : les phrases neuves arrivent entourées
 * des marques d'écart (`marquerLesEcarts`, shared). Chaque tronçon entre deux marques se rend normalement, et ceux
 * qui sont « dedans » se posent dans un `span` violet (`text-teinte`, jamais un fond) — gras et liens compris.
 */
function inlineAvecEcarts(text: string, key: string, sansLien: boolean): React.ReactNode {
  const troncons: { texte: string; neuf: boolean }[] = [];
  let neuf = false;
  let courant = '';
  for (const caractere of text) {
    if (caractere === MARQUE_ECART_OUVRE || caractere === MARQUE_ECART_FERME) {
      if (courant) troncons.push({ texte: courant, neuf });
      courant = '';
      neuf = caractere === MARQUE_ECART_OUVRE;
      continue;
    }
    courant += caractere;
  }
  if (courant) troncons.push({ texte: courant, neuf });
  /* Un habillage (`**…**`) coupé par une marque se recolle : on rend le tronçon entier quand il est déséquilibré. */
  return troncons.map((troncon, rang) =>
    troncon.neuf ? (
      <span key={`${key}-e${rang}`} className="text-teinte" data-ecart-de-comprehension>
        {inlineSansEcarts(troncon.texte, `${key}-e${rang}`, sansLien)}
      </span>
    ) : (
      <React.Fragment key={`${key}-e${rang}`}>{inlineSansEcarts(troncon.texte, `${key}-e${rang}`, sansLien)}</React.Fragment>
    ),
  );
}

function inlineSansEcarts(text: string, key: string, sansLien = false): React.ReactNode {
  let index = 0;
  const morceaux = morceauxEnLigne(text);
  /* UN LIEN SEUL SUR SA LIGNE (aucun autre mot autour) : c'est là, et là seulement, qu'un lien du Studio devient un bouton. */
  const seulSurSaLigne = morceaux.filter((m) => m.genre !== 'texte' || m.texte.trim()).length === 1;
  return morceaux.map((morceau) => {
    if (morceau.genre === 'texte') return morceau.texte;
    const id = `${key}-${index++}`;
    if (morceau.genre === 'lien') {
      /* UNE COMMANDE « / » D'UN MESSAGE ENVOYÉ se lit en pastille violette, comme dans le champ qui l'a écrite
         (`commandesEnPastilles`, contenu-journal.tsx). */
      if (morceau.href.startsWith('commande:')) {
        return (
          <span
            key={id}
            data-commande-pastille={morceau.href.slice('commande:'.length)}
            className="whitespace-nowrap rounded-[0.3em] bg-teinte-fond px-[0.3em] text-teinte"
          >
            {morceau.texte}
          </span>
        );
      }
      if (sansLien) return morceau.texte;
      if (morceau.href.startsWith('piece:')) {
        return <ImageEnLigne key={id} piece={morceau.href.slice('piece:'.length)} libelle={morceau.texte} />;
      }
      /* UNE CRÉATION DU STUDIO (« #studio/<id> ») s'ouvre dans une NOUVELLE FENÊTRE, pour l'éditer sans quitter la
         discussion (10/11/2026). SEUL SUR SA LIGNE, c'est un BOUTON ; cité DANS UNE PHRASE, un simple lien souligné —
         un bouton posé au milieu du texte ne se comprenait pas (capture #b1ff, 11/11/2026). Les aperçus de médias,
         eux, restent dans la visionneuse (MEM-6846). */
      if (morceau.href.startsWith('#studio/')) {
        return seulSurSaLigne ? (
          <BoutonOuvrirLeStudio key={id} adresse={morceau.href}>
            {morceau.texte}
          </BoutonOuvrirLeStudio>
        ) : (
          <LienDuStudio key={id} adresse={morceau.href}>
            {morceau.texte}
          </LienDuStudio>
        );
      }
      /* UN LIEN VERS UN FICHIER s'ouvre dans la visionneuse ; un lien vers un
         SITE reste en nouvel onglet (décision de l'utilisateur). */
      if (cheminDeFichierCite(morceau.href)) {
        return (
          <CheminCliquable key={id} chemin={morceau.href}>
            {morceau.texte}
          </CheminCliquable>
        );
      }
      return (
        <LienDuTexte key={id} href={morceau.href}>
          {morceau.texte}
        </LienDuTexte>
      );
    }
    if (morceau.genre === 'gras') return <strong key={id}>{morceau.texte}</strong>;
    if (morceau.genre === 'code') {
      /* UN CHEMIN EN `code` se clique, sauf dans un bouton (`sansLien`). */
      if (!sansLien && cheminDeFichierCite(morceau.texte)) {
        return (
          <CheminCliquable key={id} chemin={morceau.texte}>
            <code>{morceau.texte}</code>
          </CheminCliquable>
        );
      }
      return <code key={id}>{morceau.texte}</code>;
    }
    return <em key={id}>{morceau.texte}</em>;
  });
}

/**
 * LE MÊME TEXTE, TEL QU'IL SE LIT : sans étoiles, sans accents graves, sans
 * soulignés d'italique. C'est lui qu'une idée cochée dépose dans le champ
 * d'écriture — personne n'envoie « **Titre** : … » à un agent.
 */
export function texteEnLigne(text: string): string {
  return morceauxEnLigne(sansMarquesDEcart(text))
    .map((morceau) => morceau.texte)
    .join('');
}

/**
 * L'APERÇU REPLIÉ D'UNE DESCRIPTION, TEL QU'IL SE LIT (15/11/2026) : sans
 * « ** », « # » ni puces — on lisait « **Constat** : … » dans la vignette.
 */
export function apercuSansMarques(description: string): string {
  return description
    .split('\n')
    .map((ligne) => texteEnLigne(ligne.replace(/^\s*(#{1,6}\s+|[-*+]\s+|>\s?)/, '')))
    .join('\n');
}

/** La ligne qu'une idée écrit dans le champ : c'est aussi elle que sa case y cherche. */
function ligneDUneIdee(idee: string): string {
  return ligneDeSuggestion(texteEnLigne(idee));
}

/**
 * UNE IDÉE À COCHER : UNE LIGNE, SA CASE À GAUCHE.
 *
 * Chaque idée portait un « + » et son Markdown BRUT, étoiles comprises. Elle se
 * lit désormais comme le reste du compte rendu (gras, italique et code rendus),
 * et sa case dit ce qui est VRAIMENT dans le champ d'écriture : elle se déduit
 * de son texte (`useLignesDansLeChamp`), jamais du souvenir d'un clic. Effacer
 * la ligne à la main la décoche ; la retrouver dans un brouillon rechargé la
 * coche. Un clic sur toute la ligne bascule.
 *
 * UNE IDÉE ENVOYÉE RESTE COCHÉE. L'envoi vide la barre d'écriture : sans autre
 * source, la case se décochait au moment même où l'idée partait, et rien ne
 * disait plus qu'elle avait été retenue. La case lit donc AUSSI les messages
 * réellement partis (`useIdeeEnvoyee`) : une idée dont la ligne figure dans l'un
 * d'eux est cochée, et ne se manipule plus — elle est déjà envoyée.
 *
 * `figee` : la liste d'un plan dépassé. Rien n'y est cliquable ; on n'y lit que
 * ce qui est parti.
 *
 * Un vrai `button` au rôle de case à cocher : Tab l'atteint, Espace et Entrée
 * le basculent, et un lecteur d'écran annonce son état.
 */
function IdeeACocher({
  idee,
  cle,
  onBasculer,
  figee,
  description,
}: {
  idee: string;
  cle: string;
  onBasculer?: (texte: string) => void;
  figee?: boolean;
  /** La phrase qui dit ce que la suite apporterait (`SuitesProposees`), sous son titre. */
  description?: string;
}) {
  const ligne = ligneDUneIdee(idee);
  const dansLeChamp = useLignesDansLeChamp([ligne]);
  const envoyee = useIdeeEnvoyee(ligne);
  const cochee = envoyee || (!figee && dansLeChamp);
  const inerte = envoyee || !!figee || !onBasculer;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={cochee}
      disabled={inerte}
      data-suggestion-cliquable={inerte ? undefined : ''}
      data-idee-cochee={cochee ? 'oui' : 'non'}
      data-idee-envoyee={envoyee ? 'oui' : 'non'}
      title={envoyee ? t('Idée déjà envoyée') : undefined}
      onClick={() => onBasculer?.(texteEnLigne(idee))}
      className={cn(
        'group flex w-full items-start gap-2.5 rounded-lg px-2.5 sm:px-2 py-2 sm:py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-faint',
        inerte ? 'cursor-default' : 'hover:bg-raised',
        cochee ? 'text-text' : 'text-muted',
      )}
    >
      {/* La case vide se dessine en `--muted`, d'un trait franc : c'est lui qui
          dit « ceci se coche » — plus pâle, on ne voyait plus la case, en clair
          comme en sombre. */}
      <span
        aria-hidden
        className={cn(
          'mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] transition-colors',
          cochee
            ? 'bg-accent text-accent-fg'
            : cn('ring-[1.5px] ring-inset ring-muted', !inerte && 'group-hover:ring-text'),
        )}
      >
        {cochee ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
      </span>
      <span className="min-w-0 flex-1">
        {inline(idee, cle, true)}
        {description ? (
          <span className="mt-0.5 block text-[13px] leading-snug text-faint" data-suite-description>
            {description}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/**
 * LES SUITES POSSIBLES D'UNE RÉPONSE, SOUS ELLE (17/10/2026).
 *
 * Le message de l'agent est une discussion (`shared/src/message-court.ts`) :
 * ses suites ne s'y écrivent plus, elles arrivent par l'outil
 * « proposer_suites » (`Message.suites`, ou `donnees.suites` du jalon). Chacune
 * se coche comme une idée d'avant — son titre s'écrit dans le champ — et porte
 * dessous la phrase qui dit ce qu'elle apporterait.
 *
 * « D'AUTRES IDÉES » CHERCHE EN ARRIÈRE-PLAN (17/10/2026). Le bouton ne dépose
 * plus de demande dans le champ : il demande au démon trois suites de plus
 * (`suites.autres`, `server/src/autres-idees.ts`), cherchées à part par le
 * moteur de la carte, sans tour. Il dit « Recherche… » dès le clic ; les suites
 * arrivent par la diffusion (`message.upsert`, `journal.entree`) et se posent
 * SOUS les existantes, cochables aussitôt. `cible` désigne la réponse : son
 * message (conversation) ou son jalon (fil de la carte). Sans cible, ou figé,
 * pas de bouton.
 */
export function SuitesProposees({
  suites,
  onBasculer,
  figee,
  cible,
}: {
  suites: readonly SuiteProposee[];
  onBasculer?: (texte: string) => void;
  figee?: boolean;
  cible?: { messageId?: string; entreeId?: string };
}) {
  const [etat, setEtat] = React.useState<'repos' | 'recherche' | 'echec'>('repos');
  const chercher = React.useCallback(() => {
    if (!cible || etat === 'recherche') return;
    setEtat('recherche');
    client
      .call<{ ok: boolean; enCours?: boolean }>({ type: 'suites.autres', ...cible }, 120000)
      .then((reponse) => setEtat(reponse?.ok || reponse?.enCours ? 'repos' : 'echec'))
      .catch(() => setEtat('echec'));
  }, [cible, etat]);
  const idTitre = React.useId();
  if (!suites.length) return null;
  const bouton = cible && !figee && suites.length < SUITES_MAX_APRES_AJOUTS;
  /* LA TAILLE DU TEXTE DE LA RÉPONSE (14,5 px, MEM-3218), posée ici : les suites
     vivent HORS du texte de la réponse (`.texte-du-fil`) et prenaient sinon la
     taille du corps de la page, un cran au-dessus (capture #fa53f, 18/10/2026). */
  return (
    /* UN BLOC QUI SE RECONNAÎT (capture #410a, 06/11/2026) : un titre « Suites
       possibles » et son propre fond (`bg-raised` — `bg-surface` est celui du
       fil, on ne le voyait pas ; les lignes survolées montent d'une marche,
       `bg-fond-survol`), posé à la suite du texte, avant les images du tour. */
    <div
      role="group"
      aria-labelledby={idTitre}
      className="mt-3 flex w-full flex-col gap-0.5 rounded-xl bg-raised p-1.5 text-[14.5px] leading-relaxed [&_[data-suggestion-cliquable]:hover]:bg-fond-survol"
      data-suites-proposees={suites.length}
    >
      <p id={idTitre} className="px-2.5 sm:px-2 pb-0.5 pt-1 text-[12.5px] font-semibold text-muted" data-suites-titre>
        {t('Suites possibles')}
      </p>
      {suites.map((suite, index) => (
        <IdeeACocher
          key={`${index}:${suite.titre}`}
          idee={suite.titre}
          cle={`suite-${index}`}
          description={suite.description}
          onBasculer={onBasculer}
          figee={figee}
        />
      ))}
      {bouton ? (
        <button
          type="button"
          onClick={chercher}
          disabled={etat === 'recherche'}
          aria-busy={etat === 'recherche'}
          className={cn(
            'ml-2 mb-1 mt-1 inline-flex w-fit items-center gap-1.5 rounded-md bg-surface px-2.5 sm:px-2 py-1.5 sm:py-1 text-[12.5px] transition-colors',
            etat === 'recherche' ? 'cursor-default text-accent' : 'text-muted hover:text-text',
          )}
          data-autres-idees={etat}
        >
          {etat === 'recherche' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
          )}
          {etat === 'recherche'
            ? t('Recherche d’idées…')
            : etat === 'echec'
              ? t('Recherche impossible, réessayer')
              : t('D’autres idées')}
        </button>
      ) : null}
    </div>
  );
}

/** Relit les suites portées par un jalon (`donnees.suites`) ; absentes sur les réponses d'avant. */
export function suitesDuJalon(donnees: string | undefined | null): SuiteProposee[] {
  if (!donnees) return [];
  try {
    const lu = JSON.parse(donnees) as { suites?: unknown };
    if (!Array.isArray(lu.suites)) return [];
    return lu.suites
      .map((s) => ({ titre: String((s as any)?.titre ?? '').trim(), description: String((s as any)?.description ?? '').trim() }))
      .filter((s) => s.titre);
  } catch {
    return [];
  }
}

/**
 * « Tout ajouter » tant qu'une idée manque dans le champ, « Tout retirer » quand
 * elles y sont toutes. Une idée déjà envoyée n'est ni à ajouter ni à retirer :
 * elle sort du compte, et le bouton disparaît quand il n'en reste aucune.
 */
function BoutonToutCocher({ idees, onBasculer }: { idees: string[]; onBasculer: (textes: string[]) => void }) {
  const envoyes = React.useContext(ContexteTextesEnvoyes);
  const restantes = idees.filter((idee) => !ideeDejaEnvoyee(envoyes, ligneDUneIdee(idee)));
  const toutes = useLignesDansLeChamp(restantes.map(ligneDUneIdee));
  if (!restantes.length) return null;
  return (
    <button
      type="button"
      onClick={() => onBasculer(restantes.map(texteEnLigne))}
      className="ml-auto rounded-md bg-raised px-2.5 sm:px-2 py-1 sm:py-0.5 text-[12px] font-normal text-muted transition-colors hover:text-text"
    >
      {toutes ? t('Tout retirer') : t('Tout ajouter')}
    </button>
  );
}

export interface MarkdownProps {
  content: string;
  /**
   * UN TEXTE EN POINTS (compte rendu, compréhension — demande de l'utilisateur, carte « Retouches de la charte
   * graphique ») : dès DEUX titres, un SOMMAIRE en tête dont chaque ligne mène à son point, puis chaque point
   * aligné à gauche — titre en gras, texte normal dessous —, sans cadre ni icône.
   */
  enPoints?: boolean;
  /**
   * Le clic sur une idée à cocher, et sur « Tout ajouter ». Ils reçoivent le
   * texte LISIBLE de l'idée (`texteEnLigne`), jamais son Markdown : c'est ce
   * texte-là qui s'écrit dans le champ d'écriture. Ce qui est coché ne se
   * passe pas ici — chaque ligne le lit dans le champ lui-même.
   */
  onToggleEvolution?: (text: string) => void;
  onToggleAll?: (items: string[]) => void;
  /**
   * LES IDÉES D'UN TEXTE DÉPASSÉ (un plan remplacé par une version suivante) :
   * rien n'y est cliquable, mais celles qui sont déjà parties s'y lisent
   * COCHÉES. Sans idée envoyée, la liste reste une liste ordinaire.
   */
  ideesFigees?: boolean;
  /**
   * UNE SECONDE SECTION CLIQUABLE, en plus des « Évolutions possibles ». Le
   * cadre d'un plan s'en sert pour ses « Améliorations apportées », devenues
   * une liste d'idées à retenir d'un clic (`estTitreDesSuggestions`,
   * `shared/src/suggestions-de-plan.ts`). Absent = seules les évolutions le
   * sont, comme dans une réponse d'agent ordinaire.
   */
  autreTitreCliquable?: (titre: string) => boolean;
  /**
   * TOUTES LES LISTES DE CE TEXTE SE COCHENT, sans avoir de titre au-dessus.
   * Sert à un texte dont le titre « Améliorations apportées » est dessiné par
   * l'appelant : sans ce drapeau, la liste d'idées perdrait ses cases à cocher
   * pour la seule raison qu'elle n'a plus de titre au-dessus d'elle. Un plan,
   * lui, se rend d'un bloc (`PlanRapport`) et garde son titre.
   */
  listesCliquables?: boolean;
  /** Réponse encore en train d'arriver : pas de sommaire tant qu'elle bouge. */
  streaming?: boolean;
  /**
   * UN TEXTE QUI SE LIT COMME UNE RÉPONSE : ni sommaire, ni carte ni icône par
   * section — des titres nus, suivis de leur texte. C'est le rendu d'un plan
   * (`PlanRapport`, demande du 12/10/2026) ; les cases à cocher des idées
   * restent. Le style des titres est celui du conteneur (`.plan-en-texte`).
   */
  enTexte?: boolean;
  className?: string;
}

/**
 * UN ÉCRAN PEUT RENDRE LUI-MÊME CERTAINS BLOCS DE CODE, d'après leur langage : c'est ainsi qu'un message
 * structuré du directeur marketing se lit en bloc illustré (`bloc-du-directeur.tsx`), et non comme du code.
 */
export const ContexteBlocsDeCode = React.createContext<((langage: string, texte: string) => React.ReactNode) | null>(null);

export function Markdown({
  content,
  onToggleEvolution,
  onToggleAll,
  ideesFigees,
  autreTitreCliquable,
  listesCliquables,
  streaming,
  enTexte,
  enPoints,
  className,
}: MarkdownProps) {
  /* Les messages déjà partis : une idée dont la ligne y figure se lit cochée. */
  const envoyes = React.useContext(ContexteTextesEnvoyes);
  const rendreBlocDeCode = React.useContext(ContexteBlocsDeCode);
  /* LE REPÈRE DE L'ENCADRÉ DES SERVICES DE CRÉATION (agent du Studio) ne se lit
     pas : l'écran pose l'encadré au bout du fil, le texte ne garde que la phrase. */
  /* LE BLOC JSON DU CHIFFRAGE est lu par l'application, jamais affiché
     (`sansBlocDeChiffrage`). */
  const blocks = React.useMemo(() => parse(sansBlocDeChiffrage(content).replaceAll(REPERE_SERVICES_CREATION, '')), [content]);

  /** Les listes de CETTE section se cochent-elles ? */
  const sectionCliquable = (titre: string) =>
    /évolutions possibles/i.test(titre) || !!autreTitreCliquable?.(titre);

  const titres = React.useMemo(
    () => (streaming || enTexte ? [] : enPoints ? sommaireDesPoints(blocks) : sommaire(blocks, content)),
    [blocks, content, streaming, enTexte, enPoints],
  );
  const ancres = React.useRef(new Map<number, HTMLHeadingElement>());
  const [cible, setCible] = React.useState<number | null>(null);

  /** Un clic sur le sommaire amène la partie en haut, et la fait ressortir un instant. */
  const allerA = (index: number) => {
    const titre = ancres.current.get(index);
    if (!titre) return;
    titre.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setCible(index);
    window.setTimeout(() => setCible((actuelle) => (actuelle === index ? null : actuelle)), 1600);
  };

  /** Un bloc qui n'est pas un titre : liste, encadré, code, tableau ou simple paragraphe. */
  const renderBlock = (block: Block, index: number, dansEvolutions: boolean): React.ReactNode => {
    switch (block.kind) {
      case 'list':
        const aLireSeulement =
          !onToggleEvolution &&
          !!ideesFigees &&
          block.items.some((item) => ideeDejaEnvoyee(envoyes, ligneDUneIdee(item)));
        if (dansEvolutions && (onToggleEvolution || aLireSeulement)) {
          /* DES LIGNES À COCHER, PAS UNE LISTE À TIRETS : ni `ul` ni `li`, donc
             ni le tiret ni la boîte flex de `.prose-hd li`. Le retrait négatif
             cale la CASE sur le bord du texte voisin ; seul le fond du survol
             déborde. */
          return (
            <div key={index} role="group" data-idees-a-cocher className="-mx-2 mb-4 flex flex-col gap-0.5">
              {block.items.map((item, itemIndex) => (
                <IdeeACocher
                  key={itemIndex}
                  idee={item}
                  cle={`${index}-${itemIndex}`}
                  onBasculer={onToggleEvolution}
                  figee={!onToggleEvolution}
                />
              ))}
            </div>
          );
        }
        return (
          <ul key={index}>
            {block.items.map((item, itemIndex) => (
              // Le <li> est une boîte flex (tiret + contenu). Sans ce span,
              // chaque fragment de texte et chaque `code` devient une
              // colonne à part, écrasée à une lettre de large.
              <li key={itemIndex}>
                <span className="min-w-0 flex-1">{inline(item, `${index}-${itemIndex}`)}</span>
              </li>
            ))}
          </ul>
        );

      case 'callout': {
        const config = CALLOUTS[block.variant] ?? CALLOUTS.NOTE;
        return (
          <div key={index} data-callout={block.variant} className={cn('my-3 flex gap-2 rounded-xl border px-3.5 py-2.5', config.className)}>
            <span className="mt-0.5 shrink-0">{config.icon}</span>
            <div className="text-[14px] leading-relaxed">
              {block.lines.map((line, lineIndex) => (
                <p key={lineIndex} className="!my-0 !text-inherit">
                  {inline(line, `${index}-${lineIndex}`)}
                </p>
              ))}
            </div>
          </div>
        );
      }

      case 'image':
        return <ImageDuTexte key={index} piece={block.piece} libelle={block.libelle} neuf={block.neuf} />;

      case 'code': {
        /* UN BLOC QU'UN ÉCRAN SAIT RENDRE LUI-MÊME (le message structuré du directeur marketing) : rendu par lui, jamais comme du code. */
        const rendu = block.langage && rendreBlocDeCode ? rendreBlocDeCode(block.langage, block.text) : null;
        if (rendu) return <React.Fragment key={index}>{rendu}</React.Fragment>;
        return (
          <pre key={index}>
            <code>{block.text}</code>
          </pre>
        );
      }

      case 'table':
        /* UN TABLEAU LARGE DÉFILE CHEZ LUI : l'enveloppe défile, le tableau garde
           toute la largeur du texte — jamais la colonne poussée hors de l'écran. */
        return (
          <div key={index} className="max-w-full overflow-x-auto" data-tableau-markdown="">
            <table>
              <thead>
                <tr>
                  {block.head.map((cell, cellIndex) => (
                    <th key={cellIndex}>{inline(cell, `${index}-h-${cellIndex}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex}>{inline(cell, `${index}-${rowIndex}-${cellIndex}`)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );

      default:
        return <p key={index}>{inline(block.text, String(index))}</p>;
    }
  };

  return (
    <div className={cn('prose-hd', className)}>
      {/* Une entrée = une LIGNE pleine largeur : un sommaire se lit de haut en
          bas, pas comme une grappe de pastilles de tailles inégales. */}
      {enPoints && titres.length ? (
        /* LE SOMMAIRE D'UN TEXTE EN POINTS : sans cadre, aligné sur le texte (le survol déborde de 8 px de chaque
           côté), une ligne numérotée par point. */
        <nav className="mb-5" aria-label="Sommaire" data-sommaire-en-points={titres.length}>
          <div className="mb-1 text-[12px] uppercase tracking-wide text-faint" data-intitule-du-sommaire>{t('Sommaire')}</div>
          {titres.map((titre, rang) => (
            <button
              key={titre.index}
              type="button"
              onClick={() => allerA(titre.index)}
              className="-mx-2 flex w-[calc(100%+16px)] items-baseline gap-2 rounded-md px-2 py-1 text-left text-muted transition-colors hover:bg-raised hover:text-text"
              data-ligne-du-sommaire={rang + 1}
            >
              {/* La colonne des numéros prend la largeur du PLUS GRAND rang (« 12. »), en
                  chiffres de même largeur : « 10. » ne se coupe plus en « 1 » / « 0. »,
                  et toutes les lignes restent alignées. */}
              <span
                className="shrink-0 whitespace-nowrap tabular-nums text-faint"
                style={{ width: `${String(titres.length).length + 1}ch` }}
              >{rang + 1}.</span>
              <span className="min-w-0 flex-1 truncate">{titreSansEmoji(sansMarquesDEcart(titre.text))}</span>
            </button>
          ))}
        </nav>
      ) : titres.length ? (
        <nav className="mb-4 overflow-hidden rounded-xl bg-surface">
          <p className="border-b border-border/70 px-3 py-1.5 text-[12px] uppercase tracking-wide text-faint">
            {t('Sommaire')}</p>
          {titres.map((titre) => (
            <button
              key={titre.index}
              type="button"
              onClick={() => allerA(titre.index)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[14px] text-muted transition-colors hover:bg-surface hover:text-text"
            >
              <titre.icon className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{titreSansEmoji(sansMarquesDEcart(titre.text))}</span>
              <ChevronRight className="h-3 w-3 shrink-0 text-faint" />
            </button>
          ))}
        </nav>
      ) : null}

      {sections(blocks).map((section) => {
        const body = section.body.map(({ block, index }) =>
          renderBlock(
            block,
            index,
            !!listesCliquables || (section.heading ? sectionCliquable(section.heading.text) : false),
          ),
        );

        if (!section.heading) {
          // Le texte avant le premier titre (ou une réponse sans titre du
          // tout) reste nu : le cadre de couleur ne sert qu'aux sections
          // nommées, il n'a pas de nature à annoncer sans titre.
          return <React.Fragment key={`préambule-${section.index}`}>{body}</React.Fragment>;
        }

        const headingIndex = section.index;
        const headingText = section.heading.text;
        const inEvolutions = sectionCliquable(headingText);
        const items = inEvolutions ? nextListItems(blocks, headingIndex) : [];

        if (enTexte || enPoints) {
          /* UN TITRE NU, puis son texte : pas de cadre, pas d'icône. Le niveau
             du titre reste lisible (le titre du plan, puis ses parties). */
          const Titre = section.heading.level <= 1 ? 'h1' : section.heading.level === 2 ? 'h2' : 'h3';
          return (
            <React.Fragment key={headingIndex}>
              <Titre
                ref={(node: HTMLHeadingElement | null) => {
                  if (node) ancres.current.set(headingIndex, node);
                  else ancres.current.delete(headingIndex);
                }}
                data-titre-du-plan={enTexte ? section.heading.level : undefined}
                data-titre-du-point={enPoints ? '' : undefined}
                className={cn(enPoints && 'scroll-mt-12 font-semibold transition-colors', enPoints && cible === headingIndex && 'text-teinte')}
              >
                {headingText.includes(MARQUE_ECART_OUVRE) ? (
                  /* UN POINT NEUF depuis la compréhension précédente : son titre en violet aussi. */
                  <span className="text-teinte" data-ecart-de-comprehension>
                    {titreSansEmoji(sansMarquesDEcart(headingText))}
                  </span>
                ) : (
                  <span>{titreSansEmoji(headingText)}</span>
                )}
                {inEvolutions && items.length > 1 && onToggleAll ? (
                  <BoutonToutCocher idees={items} onBasculer={onToggleAll} />
                ) : null}
              </Titre>
              {body}
            </React.Fragment>
          );
        }

        const { icon: IconeDuTitre, tone } = styleFor(headingText, section.heading.level);

        return (
          <section
            key={headingIndex}
            className={cn('my-3 rounded-2xl border px-4 py-3.5', TONE_CLASSES[tone])}
          >
            <h2
              ref={(node) => {
                if (node) ancres.current.set(headingIndex, node);
                else ancres.current.delete(headingIndex);
              }}
              /* Le cadre de couleur remplace déjà la ligne de séparation et
                 l'espace du haut que porte `.prose-hd h2` : sans ce retrait, la
                 section colorée traînerait un second trait et un grand vide. */
              className={cn('!mt-0 !mb-3 !border-t-0 !pt-0', cible === headingIndex && 'text-accent')}
            >
              <IconeDuTitre className="h-4 w-4 shrink-0 text-faint" aria-hidden />
              <span>{titreSansEmoji(headingText)}</span>
              {inEvolutions && items.length > 1 && onToggleAll ? (
                <BoutonToutCocher idees={items} onBasculer={onToggleAll} />
              ) : null}
            </h2>
            {body}
          </section>
        );
      })}
    </div>
  );
}

/** Une section = un titre (ou aucun, pour le texte qui précède le premier) et ses blocs, jusqu'au titre suivant. */
interface Section {
  index: number;
  heading: Extract<Block, { kind: 'heading' }> | null;
  body: { block: Block; index: number }[];
}

function sections(blocks: Block[]): Section[] {
  const result: Section[] = [];
  let current: Section = { index: -1, heading: null, body: [] };
  blocks.forEach((block, index) => {
    if (block.kind === 'heading') {
      if (current.heading || current.body.length) result.push(current);
      current = { index, heading: block, body: [] };
    } else {
      current.body.push({ block, index });
    }
  });
  if (current.heading || current.body.length) result.push(current);
  return result;
}

/* ------------------------------------------------------------------ */

type Block =
  | { kind: 'heading'; text: string; level: number }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'code'; text: string; langage?: string }
  | { kind: 'callout'; variant: string; lines: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'image'; piece: string; libelle: string; neuf?: boolean };

/**
 * L'OUVERTURE EN GRAND D'UNE IMAGE DU TEXTE (« ![…](piece:…) », un visuel de
 * la carte posé dans un plan, 30/10/2026). Sans fournisseur, l'image s'ouvre
 * seule dans un nouvel onglet.
 */
export const ContexteOuvrirUneImageDuTexte = React.createContext<((piece: string) => void) | null>(null);

/**
 * UN LIEN DU TEXTE : un SITE s'ouvre dans un onglet, un MÉDIA (pièce jointe, image d'étape, fichier cité, adresse
 * d'image, de vidéo, de son ou de PDF) dans l'aperçu de l'application — jamais dans un onglet (03/11/2026,
 * `mediaDuLien`). Un clic modifié (Cmd, Ctrl, Maj, molette) garde le geste du navigateur.
 */
function LienDuTexte({ href, children }: { href: string; children: React.ReactNode }) {
  const ouvrirLaPiece = React.useContext(ContexteOuvrirUneImageDuTexte);
  const media = typeof window === 'undefined' ? null : mediaDuLien(href, window.location.origin);
  return (
    <a
      href={media?.adresse ?? href}
      target="_blank"
      rel="noreferrer"
      className="text-important underline decoration-important-trait underline-offset-2"
      data-lien-media={media ? media.genre : undefined}
      onClick={
        media
          ? (event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              if (media.piece && ouvrirLaPiece) ouvrirLaPiece(media.piece);
              else ouvrirUnMedia(media);
            }
          : undefined
      }
    >
      {children}
    </a>
  );
}

/** Le Studio d'une création, ouvert dans une nouvelle fenêtre de l'application (même adresse, connectée). */
export function ouvrirLeStudioAPart(adresse: string): void {
  window.open(`${window.location.origin}${window.location.pathname}${adresse}`, '_blank', 'noopener');
}

/** Cité dans une phrase : un lien souligné, comme les autres liens du texte, qui ouvre la même fenêtre. */
function LienDuStudio({ adresse, children }: { adresse: string; children: React.ReactNode }) {
  return (
    <a
      href={adresse}
      data-lien-du-studio={adresse.slice('#studio/'.length)}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        ouvrirLeStudioAPart(adresse);
      }}
    >
      {children}
    </a>
  );
}

/** Seul sur sa ligne : un bouton posé EN BLOC (jamais au fil du texte), sur sa propre ligne. */
export function BoutonOuvrirLeStudio({ adresse, children }: { adresse: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      data-ouvrir-le-studio={adresse.slice('#studio/'.length)}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        ouvrirLeStudioAPart(adresse);
      }}
      className={cn(buttonVariants({ variant: 'contraste', size: 'sm' }), 'my-1 flex w-fit')}
    >
      <ExternalLink className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

/** Une image citée au milieu d'une phrase : une petite vignette qui s'ouvre en grand, jamais un lien. */
function ImageEnLigne({ piece, libelle }: { piece: string; libelle: string }) {
  const ouvrir = React.useContext(ContexteOuvrirUneImageDuTexte);
  const adresse = `/api/attachment?id=${encodeURIComponent(piece)}`;
  return (
    <button
      type="button"
      data-image-en-ligne={piece}
      onClick={() => (ouvrir ? ouvrir(piece) : ouvrirUnMedia({ adresse, piece, genre: 'image', nom: libelle || piece }))}
      title={libelle || t('Ouvrir en grand')}
      className="mx-0.5 inline-block overflow-hidden rounded bg-raised p-0.5 align-middle"
    >
      <img src={adresse} alt={libelle} loading="lazy" className="h-16 max-w-[160px] rounded object-contain" />
    </button>
  );
}

/** `neuf` : l'image fait partie de ce qui a changé depuis la compréhension précédente — un fin anneau violet, jamais un fond. */
function ImageDuTexte({ piece, libelle, neuf }: { piece: string; libelle: string; neuf?: boolean }) {
  const ouvrir = React.useContext(ContexteOuvrirUneImageDuTexte);
  const adresse = `/api/attachment?id=${encodeURIComponent(piece)}`;
  const reference = useReferenceDeLaPiece(piece);
  noterLaLegende(piece, libelle);
  return (
    <figure className="my-2" data-illustration-du-plan={piece}>
      {/* LE FOND ÉPOUSE L'IMAGE, SA RÉFÉRENCE DESSOUS (17/11/2026, #820bb) — `cadre-de-media.tsx`. */}
      <div
        className={cn('w-fit max-w-full overflow-hidden rounded-md bg-raised p-1 sm:p-0.5', neuf && 'ring-1 ring-teinte')}
        data-fond-de-vignette
        {...(neuf ? { 'data-ecart-de-comprehension': '' } : {})}
      >
        <button
          type="button"
          /* SANS GALERIE AUTOUR, LA VISIONNEUSE COMMUNE : plus jamais un onglet en secours (03/11/2026). */
          onClick={() => (ouvrir ? ouvrir(piece) : ouvrirUnMedia({ adresse, piece, genre: 'image', nom: libelle || piece }))}
          title={t('Ouvrir en grand')}
          className="block max-w-full"
        >
          <ImageDeVignette src={adresse} alt={libelle} hauteurMax={192} />
        </button>
        {reference ? <ReferenceSousLeMedia texte={reference} /> : null}
      </div>
      {libelle ? <figcaption className="mt-1 text-[12.5px] leading-snug text-muted texte-copiable">{libelle}</figcaption> : null}
    </figure>
  );
}

/*
 * Le sommaire ne sert que sur une réponse qu'on ne voit pas d'un seul écran :
 * en dessous de ces seuils, il ferait double emploi avec les titres eux-mêmes.
 */
const SOMMAIRE_TITRES_MIN = 4;
const SOMMAIRE_SIGNES_MIN = 1200;

interface EntreeSommaire {
  index: number;
  text: string;
  icon: LucideIcon;
}

/** Le sommaire d'un texte en points : tous ses titres, dès qu'il en a deux. */
function sommaireDesPoints(blocks: Block[]): EntreeSommaire[] {
  const titres = blocks.flatMap((block, index) =>
    block.kind === 'heading' ? [{ index, text: block.text, icon: styleFor(block.text, block.level).icon }] : [],
  );
  return titres.length >= 2 ? titres : [];
}

function sommaire(blocks: Block[], content: string): EntreeSommaire[] {
  if (content.length < SOMMAIRE_SIGNES_MIN) return [];
  const titres = blocks.flatMap((block, index) =>
    block.kind === 'heading' ? [{ index, text: block.text, icon: styleFor(block.text, block.level).icon }] : [],
  );
  return titres.length >= SOMMAIRE_TITRES_MIN ? titres : [];
}

function nextListItems(blocks: Block[], fromIndex: number): string[] {
  for (let i = fromIndex + 1; i < blocks.length; i++) {
    if (blocks[i].kind === 'list') return (blocks[i] as { items: string[] }).items;
    if (blocks[i].kind === 'heading') break;
  }
  return [];
}

function parse(content: string): Block[] {
  const lines = content.replace(/\r/g, '').split('\n');
  const blocks: Block[] = [];
  let buffer: string[] = [];

  const flushParagraph = () => {
    if (buffer.length) {
      blocks.push({ kind: 'paragraph', text: buffer.join(' ').trim() });
      buffer = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    if (trimmed.startsWith('```')) {
      flushParagraph();
      const code: string[] = [];
      const langage = trimmed.slice(3).trim() || undefined;
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i]), i++;
      blocks.push({ kind: 'code', text: code.join('\n'), ...(langage ? { langage } : {}) });
      continue;
    }

    const calloutMatch = trimmed.match(/^>\s*\[!(TIP|NOTE|IMPORTANT|WARNING|CAUTION)\]/i);
    if (calloutMatch) {
      flushParagraph();
      const variant = calloutMatch[1].toUpperCase();
      const body: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        body.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      i--;
      blocks.push({ kind: 'callout', variant, lines: body.filter(Boolean) });
      continue;
    }

    /* UNE IMAGE DE LA CARTE, seule sur sa ligne : jamais une adresse libre. */
    const illustration = lireLigneDIllustration(trimmed);
    if (illustration) {
      flushParagraph();
      blocks.push({ kind: 'image', piece: illustration.piece, libelle: illustration.libelle, neuf: illustration.neuf });
      continue;
    }

    const heading = trimmed.match(/^#{1,4}\s+(.*)$/);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: 'heading', level: trimmed.match(/^#+/)![0].length, text: heading[1].replace(/^\d+\.\s*/, '').trim() });
      continue;
    }

    if (/^\|.*\|$/.test(trimmed) && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
      flushParagraph();
      const cells = (row: string) =>
        row
          .trim()
          .slice(1, -1)
          .split('|')
          .map((cell) => cell.trim());
      const head = cells(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
        rows.push(cells(lines[i].trim()));
        i++;
      }
      i--;
      blocks.push({ kind: 'table', head, rows });
      continue;
    }

    if (/^[-*•]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      flushParagraph();
      const items: string[] = [];
      while (
        i < lines.length &&
        (/^[-*•]\s+/.test(lines[i].trim()) || /^\d+\.\s+/.test(lines[i].trim()) || /^\s{2,}\S/.test(lines[i]))
      ) {
        const current = lines[i].trim();
        if (/^[-*•]\s+/.test(current) || /^\d+\.\s+/.test(current)) {
          items.push(current.replace(/^[-*•]\s+/, '').replace(/^\d+\.\s+/, ''));
        } else if (items.length) {
          items[items.length - 1] += ` ${current}`;
        }
        i++;
      }
      i--;
      blocks.push({ kind: 'list', items });
      continue;
    }

    // Retour à la ligne du moteur = nouveau paragraphe, sauf phrase coupée.
    if (buffer.length && paragraphBreakAfter(buffer[buffer.length - 1], trimmed)) {
      flushParagraph();
    }
    buffer.push(trimmed);
  }

  flushParagraph();
  return blocks;
}
