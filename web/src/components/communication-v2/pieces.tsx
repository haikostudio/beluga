import * as React from 'react';
import { ArrowLeft, ArrowRight, ArrowUp, ChevronDown, ChevronUp, Loader2 } from '@/components/ui/icones';
import { pasDeLaBarreV2, type EtapeCommunicationV2, type GenreDeCoulisses } from '@beluga/shared';
import { Button } from '@/components/ui';
import { JournalDeLAgent, useJournalDeLAgent } from '@/components/journal-de-l-agent';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import { enPreparation, useV2, type Cibles } from './contexte';

/**
 * LES PIÈCES DE COMMUNICATION 2.
 *
 * LE VIOLET N'EST PORTÉ QU'ICI (liste fermée de `scripts/verif-themes.mjs`) : ce que le chef EST EN TRAIN de préparer
 * en coulisses, et l'élément CHOISI (l'étape ouverte, la publication regardée, le jour glissé, les dates retenues).
 * Les autres fichiers de l'espace prennent ces classes, jamais le violet en dur.
 */
export const VIOLET = {
  texte: 'text-teinte',
  fond: 'bg-teinte',
  fondLeger: 'bg-teinte/15',
  fondPale: 'bg-teinte/[0.07]',
  anneau: 'ring-1 ring-inset ring-teinte',
  survolLeger: 'hover:bg-teinte/20',
} as const;

/** « Le programme se prépare… » : ce que le chef fait en ce moment, en violet, avec sa roue. */
export function EnPreparation({ texte, className, ...reste }: { texte: string; className?: string } & React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('flex min-w-0 items-center gap-2 text-[13px] font-medium', VIOLET.texte, className)} data-v2-en-preparation {...reste}>
      <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
      <span className="min-w-0">{texte}</span>
    </p>
  );
}

/**
 * LE CHAMP D'UNE PAGE : la demande part au chef de la marque, en coulisses — régler un canal, changer un programme,
 * retoucher une publication. Pendant qu'il travaille, le champ le dit en violet et ne renvoie rien (pas de doublon).
 * Marqué `data-champ-d-ecriture` : au clavier de l'iPhone, il reste posé sur le clavier.
 *
 * LE MÊME DESSIN QUE LA ZONE D'ÉCRITURE DES AGENTS (capture #e4b8) : une boîte au fond gris pâle (`bg-raised`,
 * `rounded-lg`), le texte en haut, l'envoi sur la rangée du bas. Le groupe de boutons d'avance se pose AU-DESSUS
 * (`GestesDesEtapes`, `PageV2`). Ce que fait le chef se lit dans un bloc COLLÉ au cadre, repliable comme la liste des
 * tâches des agents (`TravailDuChef`, demande du 09/11/2026). AUCUNE PHRASE sous le champ ni sous un bouton : « le
 * chef termine un autre travail » est l'INFOBULLE du bouton d'envoi éteint.
 */
export function ChampDeDemande({
  invite,
  genre,
  genresSuivis,
  cibles,
  preparation,
  repere,
  dansLaPage = false,
  contexte,
}: {
  invite: string;
  genre: GenreDeCoulisses;
  /** Les demandes dont l'avancement se montre ici (par défaut : la sienne). */
  genresSuivis?: readonly GenreDeCoulisses[];
  cibles?: Cibles;
  /** Le texte violet pendant le travail. */
  preparation: string;
  repere: string;
  /** Posé dans le flux (sous un aperçu) plutôt que collé en bas de page. */
  dansLaPage?: boolean;
  /** Le brouillon de la page, joint à la demande (l'assistant de campagne : l'idée et les dates en cours). */
  contexte?: string;
}) {
  const { demander, coulisses } = useV2();
  const [texte, setTexte] = React.useState('');
  const [parti, setParti] = React.useState(false);
  const occupe = enPreparation(coulisses, genresSuivis ?? [genre], cibles);
  const chefPris = !!coulisses?.chefAuTravail && !occupe;
  const envoyer = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const propre = texte.trim();
    if (!propre || parti || occupe) return;
    setParti(true);
    const ok = await demander(genre, contexte ? `${propre}\n\n${contexte}` : propre, cibles);
    setParti(false);
    if (ok) setTexte('');
  };
  return (
    <form onSubmit={(e) => void envoyer(e)} className={cn('flex min-w-0 flex-1 flex-col', !dansLaPage && 'w-full')} data-champ-d-ecriture data-v2-champ={repere}>
      {occupe || parti ? <TravailDuChef preparation={preparation} /> : null}
      {/* `relative z-[1]` : le cadre recouvre le bas du bloc du chef (`-mb-3`), comme le champ des agents recouvre la liste des tâches ; `data-fond-propre` le garde opaque, hors du voile translucide des blocs. */}
      <div className="relative z-[1] flex w-full min-w-0 flex-col rounded-lg bg-raised" data-v2-cadre-du-champ={repere} data-fond-propre>
        <input
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          placeholder={invite}
          aria-label={invite}
          disabled={occupe}
          className="h-11 w-full min-w-0 bg-transparent px-3 text-[14px] text-text placeholder:text-faint focus-visible:outline-none disabled:opacity-50 max-sm:text-[16px]"
          data-v2-champ-texte={repere}
        />
        <div className="flex min-w-0 items-center gap-1.5 px-1.5 pb-1.5" data-v2-rangee-du-champ>
          <span className="min-w-0 flex-1" />
          {/* Le chef est pris ailleurs : le bouton éteint DIT pourquoi, en infobulle sur son enveloppe (un bouton éteint ne
              reçoit plus le pointeur, `disabled:pointer-events-none`). */}
          <BulleDuBoutonEteint raison={chefPris ? t('Le chef termine un autre travail : vous pourrez écrire dans un instant.') : null} className="shrink-0" data-v2-chef-pris={chefPris ? '' : undefined}>
            <Button type="submit" size="icon-barre" variant="principal" disabled={!texte.trim() || parti || occupe || chefPris} aria-label="Envoyer" title={chefPris ? undefined : t('Envoyer au chef')} data-v2-envoyer={repere}>
              {parti ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </Button>
          </BulleDuBoutonEteint>
        </div>
      </div>
    </form>
  );
}

/** Où l'on retient le pli du bloc du chef, comme celui de la liste des tâches (`beluga.volet-taches.deplie`). */
const CLE_PLI_DU_CHEF = 'beluga.v2-travail-du-chef.deplie';

/** Le pli du bloc du chef : REPLIÉ D'OFFICE, retenu d'une fois sur l'autre (calqué sur `usePliDesTaches`). */
function usePliDuChef(): [boolean, () => void] {
  const [ouvert, setOuvert] = React.useState(() => {
    try {
      return window.localStorage.getItem(CLE_PLI_DU_CHEF) === '1';
    } catch {
      return false;
    }
  });
  const basculer = React.useCallback(
    () =>
      setOuvert((v) => {
        try {
          window.localStorage.setItem(CLE_PLI_DU_CHEF, v ? '0' : '1');
        } catch {
          /* navigation privée : le choix vaut pour la session. */
        }
        return !v;
      }),
    [],
  );
  return [ouvert, basculer];
}

/**
 * CE QUE LE CHEF FAIT, DANS UN BLOC COLLÉ AU CHAMP (demande du 09/11/2026, capture #7ce7) : le même décroché que la
 * liste des tâches des agents (`TravailEnCours` de chat.tsx — fond `decroche-degrade decroche-gris`, coins du haut
 * arrondis, 12 px glissés SOUS le cadre du champ). Replié : UNE ligne, la roue et sa dernière action en violet (avant
 * la première, la phrase de la page), un chevron. Déplié : ses six dernières actions (`JournalDeLAgent`), la plus
 * récente en bas ; une nouvelle pousse la plus ancienne hors du bloc, par le haut. Présent seulement pendant le
 * travail ; à la fin, le mot du chef reste dans la page (`MotDuChef`).
 */
function TravailDuChef({ preparation }: { preparation: string }) {
  const { coulisses } = useV2();
  const { phrases } = useJournalDeLAgent(coulisses?.agentId ?? null, coulisses?.enCours?.depuis ?? Date.now());
  const [ouvert, basculer] = usePliDuChef();
  const deplie = ouvert && phrases.length > 0;
  const enCours = phrases.at(-1)?.texte ?? preparation;
  return (
    <div
      className="decroche-degrade decroche-gris relative z-0 -mb-3 flex min-w-0 shrink-0 flex-col rounded-t-lg [--hauteur-du-degrade:34px]"
      data-v2-travail-du-chef={ouvert ? 'ouvert' : 'ferme'}
      data-v2-lignes-du-chef={phrases.length}
    >
      <button
        type="button"
        aria-expanded={deplie}
        aria-label={ouvert ? t('Replier le travail du chef') : t('Déplier le travail du chef')}
        onClick={basculer}
        className={cn('flex min-w-0 items-center gap-2 px-3 pt-1.5 text-left text-[12.5px] font-medium', VIOLET.texte, deplie ? 'pb-1' : 'pb-5')}
        data-v2-en-preparation
      >
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        <span className="min-w-0 flex-1 truncate" data-v2-action-du-chef>
          {enCours}
        </span>
        {phrases.length > 1 ? <span className="shrink-0 text-[11px] tabular-nums text-faint">{phrases.length}</span> : null}
        <span className="shrink-0 text-faint" aria-hidden>
          {deplie ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
        </span>
      </button>
      {deplie ? (
        <div className="px-3 pb-5" data-v2-journal-du-chef>
          <JournalDeLAgent phrases={phrases} classeTexte={VIOLET.texte} enTravail={false} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * LA RAISON D'UN BOUTON ÉTEINT, EN INFOBULLE (demandée deux fois, la dernière le 09/11/2026 : « ces phrases… dans des
 * tooltips ») : plus aucune ligne sous un bouton. Un bouton `disabled` ne reçoit plus le pointeur
 * (`disabled:pointer-events-none`) : c'est son ENVELOPPE qui porte le `title`, rendu en bulle par la couche des
 * infobulles de l'application (`InfobullesDeLApplication`). Sur un écran tactile (aucun survol), un appui sur le
 * bouton éteint ouvre la même bulle, au-dessus, le temps de la lire. Repère `data-v2-raison-eteint` = la raison.
 */
export function BulleDuBoutonEteint({
  raison,
  children,
  className,
  ...reste
}: { raison: string | null | undefined; children: React.ReactNode; className?: string } & React.HTMLAttributes<HTMLSpanElement>) {
  const [touchee, setTouchee] = React.useState(false);
  React.useEffect(() => {
    if (!touchee) return;
    const fin = window.setTimeout(() => setTouchee(false), 2800);
    return () => window.clearTimeout(fin);
  }, [touchee]);
  React.useEffect(() => {
    if (!raison) setTouchee(false);
  }, [raison]);
  return (
    <span
      className={cn('relative flex min-w-0', className)}
      {...(raison ? { title: raison, 'data-v2-raison-eteint': raison, tabIndex: 0, 'aria-label': raison } : {})}
      onPointerUp={(e) => {
        if (raison && e.pointerType !== 'mouse') setTouchee(true);
      }}
      {...reste}
    >
      {children}
      {raison && touchee ? (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-[100] mb-1.5 w-max max-w-[260px] -translate-x-1/2 animate-fade-in whitespace-normal rounded-md bg-text px-2 py-1.5 text-center text-[13px] leading-snug text-surface shadow-xl"
          data-v2-bulle-tactile
        >
          {raison}
        </span>
      ) : null}
    </span>
  );
}

/** Le dernier mot du chef sur ce sujet (moins d'un jour), en gris : ce qui est prêt. */
export function MotDuChef({ genres, cibles }: { genres: readonly GenreDeCoulisses[]; cibles?: Cibles }) {
  const { coulisses } = useV2();
  const d = coulisses?.dernier;
  if (!d || coulisses?.enCours || !genres.includes(d.genre) || Date.now() - d.at > 86_400_000) return null;
  if (cibles?.campagneId && d.campagneId !== cibles.campagneId) return null;
  if (cibles?.contenuId && d.contenuId !== cibles.contenuId) return null;
  if (cibles?.messageId && d.messageId !== cibles.messageId) return null;
  const texte = d.texte.replace(/```[\s\S]*?```/g, '').trim();
  if (!texte) return null;
  return (
    <p className={cn('rounded-lg bg-surface px-3 py-2 text-[12.5px] leading-relaxed', d.ok ? 'text-muted' : 'text-danger')} data-v2-mot-du-chef={d.genre}>
      <b className="font-semibold text-text">{t('Le chef :')}</b> {texte.length > 320 ? `${texte.slice(0, 320)}…` : texte}
    </p>
  );
}

/**
 * L'ÉTAT D'UNE PUBLICATION, en clair : à valider, validée, programmée, publiée, en échec — et « En fabrication »
 * (le Studio y travaille, en violet) ou « Au programme » (un brouillon qui attend la validation du programme).
 */
export function EtatDePublication({ etape, fabrication, envoiChrome }: { etape: string; fabrication?: boolean; envoiChrome?: 'attente-chrome' | 'en-retard' | null }) {
  /* UN POST PAR CHROME (09/11/2026) : son heure est passée et Chrome est fermé — il part à la réouverture ; ou il est
     parti au rattrapage. Un blocage se dit en rouge, un retard en gris. */
  if (envoiChrome === 'attente-chrome' && etape === 'programme') {
    return (
      <span className="inline-flex shrink-0 items-center rounded-full bg-danger/15 px-2 py-0.5 text-[11.5px] font-medium text-danger" data-v2-etat-publication="attente-chrome" title={t('Chrome est fermé : le post partira dès sa réouverture.')}>
        {t('Attend Chrome')}
      </span>
    );
  }
  if (envoiChrome === 'en-retard' && etape === 'publie') {
    return (
      <span className="inline-flex shrink-0 items-center rounded-full bg-raised px-2 py-0.5 text-[11.5px] font-medium text-muted" data-v2-etat-publication="en-retard">
        {t('Publiée en retard')}
      </span>
    );
  }
  if (fabrication && (etape === 'brouillon' || etape === 'a_valider')) {
    return (
      <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium', VIOLET.fondLeger, VIOLET.texte)} data-v2-etat-publication="fabrication">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t('En fabrication')}
      </span>
    );
  }
  const etat = (
    {
      brouillon: { libelle: t('Au programme'), classe: 'bg-raised text-muted' },
      a_valider: { libelle: t('À valider'), classe: 'bg-comprehension/15 text-text ring-1 ring-inset ring-comprehension' },
      pret: { libelle: t('Validée'), classe: 'bg-text/[0.1] text-text' },
      programme: { libelle: t('Programmée'), classe: 'bg-text/[0.1] text-text' },
      publie: { libelle: t('Publiée'), classe: 'bg-raised text-muted' },
      echec: { libelle: t('Échec'), classe: 'bg-danger/15 text-danger' },
    } as Record<string, { libelle: string; classe: string }>
  )[etape] ?? { libelle: etape, classe: 'bg-raised text-muted' };
  return (
    <span className={cn('inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11.5px] font-medium', etat.classe)} data-v2-etat-publication={etape}>
      {etat.libelle}
    </span>
  );
}

export const nomDeLEtapeV2 = (id: EtapeCommunicationV2): string => ({ campagnes: t('Campagnes'), connexion: t('Connexion'), calendrier: t('Calendrier') })[id];

/** Pourquoi « Suivant » est éteint, en clair (le texte de `RAISONS_DU_SUIVANT_BLOQUE`, traduit littéralement). */
export function raisonDuSuivantEteint(page: EtapeCommunicationV2): string {
  return ({
    campagnes: t('Terminez une campagne — tous ses visuels faits — pour passer à la connexion.'),
    connexion: t('Connectez au moins un réseau pour passer au calendrier.'),
    calendrier: '',
  } as Record<EtapeCommunicationV2, string>)[page];
}

/**
 * LE PIED D'AVANCE DE COMMUNICATION 2 (demandes du 08/11/2026 puis du 09/11/2026, capture #7ce7) : UN GROUPE collé —
 * à gauche, s'il y a un pas d'avant, une flèche ICÔNE SEULE ; puis LE grand bouton qui fait avancer, pleine largeur.
 * Les deux ont le MÊME fond (la variante par défaut de Button, celle du grand bouton) et ne sont séparés que par une coupure d'un
 * pixel (`gap-px`) — comme « Suspendre » et ses réglages dans la rangée d'action d'une carte. Aucune ligne dessous :
 * un bouton éteint dit pourquoi EN INFOBULLE (`BulleDuBoutonEteint`). Posé juste au-dessus du champ du chef, partout :
 * pages d'étapes (`GestesDesEtapes`), assistant, programme.
 *
 * NOIR QUAND IL SERT, GRIS FRANC QUAND IL EST ÉTEINT (décision de l'utilisateur, carte « Réponses mises en page et
 * boutons contrastés ») : tout bouton utilisable du pied est la variante par défaut (noir en clair, clair en sombre) ;
 * éteint, il ne pâlit plus en noir délavé, il prend le fond gris et le texte atténué (règle `[data-v2-pied-d-avance]`
 * de styles.css). Un bouton qui MONTRE un travail en cours (rouet) porte `data-en-route` et garde son fond plein.
 */
export function PiedDAvance({
  retour,
  principal,
  raison,
  className,
  ...reste
}: {
  /** La flèche d'en bas à gauche : son nom (lu à voix haute, bulle), son geste et ses repères. */
  retour?: { libelle: string; aller: () => void; reperes?: Record<string, string> } | null;
  /** LE bouton de la page, pleine largeur (`w-full`) ; `null` : la flèche seule. */
  principal: React.ReactNode | null;
  /** Pourquoi le bouton est éteint : lue en infobulle, jamais écrite dessous. */
  raison?: string | null;
} & React.HTMLAttributes<HTMLDivElement>) {
  if (!retour && !principal) return null;
  return (
    <div className={cn('flex w-full min-w-0 items-stretch gap-px', className)} data-v2-pied-d-avance data-v2-groupe-d-avance={retour && principal ? 'colle' : 'seul'} {...reste}>
      {retour ? (
        <Button
          type="button"
          /* La variante PLEINE (`default` : noir en clair), celle des grands boutons d'avance : même fond que le bouton
             collé. Elle se NOMME : sans `variant`, Button prend `outline`, un voile presque transparent. */
          variant="default"
          className={cn('h-[38px] w-[38px] shrink-0 px-0 sm:h-8 sm:w-8 sm:px-0', principal && 'rounded-r-none')}
          onClick={retour.aller}
          aria-label={retour.libelle}
          title={retour.libelle}
          data-v2-fleche-d-avance
          {...(retour.reperes ?? {})}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
      ) : null}
      {principal ? (
        <BulleDuBoutonEteint raison={raison} className={cn('flex-1 [&>button]:w-full', retour && '[&>button]:rounded-l-none')}>
          {principal}
        </BulleDuBoutonEteint>
      ) : null}
    </div>
  );
}

/**
 * LE PIED DES ÉTAPES (Canaux, Campagnes, Calendrier) : la flèche vers l'étape d'avant, en icône, puis « Suivant » en
 * grand. L'étape suivante encore fermée garde son bouton, ÉTEINT, avec ce qui manque en infobulle ; la dernière étape n'a
 * que la flèche. `aria-label` fixes (« Étape précédente », « Étape suivante »), jamais par `t()`.
 */
export function GestesDesEtapes() {
  const { marque, page, aller } = useV2();
  if (page === 'reponses' || page === 'canaux') return null;
  const pas = pasDeLaBarreV2(page, marque.v2);
  const suivante = pas.suivante;
  if (!pas.precedente && !suivante) return null;
  return (
    <PiedDAvance
      data-v2-barre-etapes={page}
      retour={pas.precedente ? { libelle: t('Revenir à : {etape}', { etape: nomDeLEtapeV2(pas.precedente) }), aller: () => aller(pas.precedente!), reperes: { 'data-v2-precedent': pas.precedente } } : null}
      principal={
        suivante ? (
          <Button type="button" variant="default" disabled={!!pas.bloque} onClick={() => aller(suivante)} aria-label="Étape suivante" title={t('Passer à : {etape}', { etape: nomDeLEtapeV2(suivante) })} data-v2-suivant={suivante} data-v2-suivant-eteint={pas.bloque ? '' : undefined}>
            {t('Suivant : {etape}', { etape: nomDeLEtapeV2(suivante) })}
            <ArrowRight className="h-4 w-4" />
          </Button>
        ) : null
      }
      raison={pas.bloque ? raisonDuSuivantEteint(page) : null}
    />
  );
}
