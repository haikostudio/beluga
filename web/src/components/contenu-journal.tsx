import * as React from 'react';
import {
  Brain,
  CheckCircle2,
  ChevronRight,
  FileText,
  Globe,
  ListChecks,
  MessageCircleQuestion,
  Pencil,
  Search,
  Terminal,
  Wrench,
} from 'lucide-react';
import {
  ChampLisible,
  EntreeJournal,
  LIBELLE_TYPE,
  OptionDeLEntree,
  RefMemoire,
  Unite,
  VueDEntree,
  dejaDitDans,
  libelleDEtat,
  libelleLisible,
  sujetLisible,
  separerLaReponse,
  tagsDuTexte,
  texteAvecEtiquettes,
  titreDeLaSorte,
  vueDeLEntree,
} from '@beluga/shared';
import { PiecesJointes } from '@/components/bulle-question';
import {
  BlocReplie,
  ChampsNommes,
  Chemin,
  Constat,
  ContexteTeteDEtape,
  EncadreEtape,
  Etiquette,
  useTeteDEtape,
} from '@/components/encadre-etape';
import { Silhouette } from '@/components/silhouettes';
import { client } from '@/lib/client';
import { Markdown } from '@/lib/markdown';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * CE QU'UNE ÉTAPE D'AGENT MONTRE — UN ENCADRÉ ILLUSTRÉ PAR GENRE.
 *
 * Dépliée, chaque étape du fil rendait la même chose : un titre gris, puis des
 * pavés de texte à la suite. La question posée affichait ses choix en pastilles
 * et, juste dessous, la reprise TECHNIQUE de l'appel — on relisait la question
 * elle-même en JSON à la place de la réponse. La mémoire du projet, elle,
 * n'était qu'un mur de vingt lignes : la liste exacte de ce que l'agent savait
 * du projet, et personne ne la lisait.
 *
 * Chaque genre a maintenant SON dessin, tous bâtis sur la même coquille
 * (`encadre-etape.tsx`) : un bandeau de tête au fond contrasté qui porte
 * l'intitulé, puis des informations NOMMÉES — jamais leur forme de stockage.
 *
 * CE FICHIER NE DÉCIDE RIEN : la SORTE d'une étape est décidée en règle pure
 * (`vueDeLEntree`, `shared/src/contenu-journal.ts`), les références d'une
 * consultation de mémoire aussi (`lireLaMemoire`,
 * `shared/src/memoire-lue.ts`), et le partage entre choix retenus et complément
 * écrit à la main également (`separerLaReponse`). Ici, on dessine.
 *
 * LE JSON N'A QU'UN SEUL ENDROIT, ET IL LUI RESTE : le dernier point du flux
 * (« JSON intégral », `journal-carte.tsx`), d'un bloc et copiable. C'est sa
 * raison d'être. Partout ailleurs, rien de brut.
 */

/** Un texte à lire — une demande, un plan, un dernier mot : du markdown. */
function VueTexte({ texte }: { texte: string }) {
  return <Markdown content={texte} className="text-[13.5px]" />;
}

/* ------------------------------------------------------------------ */
/* La question posée                                                    */
/* ------------------------------------------------------------------ */

/**
 * UNE QUESTION POSÉE, COMME UNE FICHE DE DÉCISION.
 *
 * Le bandeau dit ce que c'est. Dessous, la question, puis ce qui l'éclairait.
 * Les réponses proposées viennent ensuite EN LISTE VERTICALE, une par ligne
 * avec son explication : en pastilles alignées, un libellé de dix mots se
 * cassait en trois lettres par ligne. CELLE QUI A ÉTÉ RETENUE porte une bordure
 * colorée et un fond marqué ; les autres restent en retrait. Enfin, s'il y en a
 * un, le complément écrit à la main, clairement séparé des choix proposés.
 *
 * LES CHOIX SONT MONTRÉS, PAS OFFERTS — c'est une trace, pas un formulaire :
 * une case cochable ici laisserait croire qu'on peut encore trancher.
 *
 * LE PARTAGE ENTRE CHOIX RETENUS ET COMPLÉMENT NE SE DEVINE PAS : la réponse
 * est enregistrée en UNE chaîne (libellés collés, puis « — », puis le texte
 * libre), et `separerLaReponse` la redécoupe. On ne cherche plus le libellé
 * « quelque part dans » la réponse, ce qui faisait briller « Oui » dès qu'on
 * avait écrit « Oui, mais plus tard ».
 *
 * Exporté : le bloc raconté du fil (`flux-en-points.tsx`) montre le MÊME
 * encadré, pour que la version racontée et la version détaillée ne divergent
 * jamais.
 */
export function EncadreQuestion({
  question,
  description,
  choix,
  options,
  reponse,
}: {
  question: string;
  description?: string;
  choix?: 'single' | 'multiple' | 'text';
  options: readonly OptionDeLEntree[];
  reponse?: string;
}) {
  const genre =
    choix === 'multiple' ? t('Plusieurs choix') : choix === 'text' ? t('Réponse libre') : options.length ? t('Un seul choix') : undefined;
  const repondu = React.useMemo(
    () => separerLaReponse(reponse, options.map((option) => option.label)),
    [reponse, options],
  );

  return (
    <EncadreEtape sorte="question" titre={t(titreDeLaSorte('question'))} icone={MessageCircleQuestion} aDroite={genre}>
      <p
        className="break-words [overflow-wrap:anywhere] text-[13.5px] font-medium leading-snug text-text texte-copiable"
        data-encadre-question
      >
        {question}
      </p>

      {/* CE QUI ÉCLAIRAIT LA QUESTION RESTE DANS SA TRACE : sans lui, on relit
          une phrase interrogative sans savoir ce qu'elle mettait en jeu. */}
      {description ? (
        <p className="whitespace-pre-line break-words text-[13px] leading-relaxed text-muted texte-copiable" data-encadre-question-description>
          {description}
        </p>
      ) : null}

      {options.length ? (
        <ul className="space-y-1" data-encadre-question-options={options.length}>
          {options.map((option) => {
            const retenue = repondu.libelles.includes(option.label);
            return (
              <li
                key={option.id}
                data-encadre-question-option={retenue ? 'retenue' : 'proposee'}
                className={cn(
                  /* LA BORDURE PORTE UNE INFORMATION : sur les apparences
                     plates, `--border` ne dessine rien — la marque de sélection
                     prend donc la couleur du « terminé », et les autres la
                     nuance `--faint`. */
                  'flex items-start gap-1.5 rounded-md border px-2 py-1 text-[13px]',
                  retenue
                    ? 'border-termine bg-termine/15 text-termine'
                    : 'border-faint/30 bg-raised/40 text-muted',
                )}
              >
                {retenue ? <CheckCircle2 className="mt-[3px] h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
                <span className="min-w-0 break-words">
                  <span className={cn(retenue && 'font-medium')}>{option.label}</span>
                  {option.description ? (
                    <span className="ml-1.5 text-[12.5px] text-faint">{option.description}</span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {repondu.complement ? (
        <div data-encadre-question-complement>
          <Etiquette>{t('Précision écrite à la main')}</Etiquette>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-[13.5px] text-text texte-copiable">
            {repondu.complement}
          </p>
        </div>
      ) : null}

      {!reponse ? <Constat repere="data-encadre-question-sans-reponse">{t('Restée sans réponse.')}</Constat> : null}
    </EncadreEtape>
  );
}

/** La question d'une entrée du journal, dans son encadré. */
function VueQuestion({ vue }: { vue: Extract<VueDEntree, { sorte: 'question' }> }) {
  return (
    <EncadreQuestion
      question={vue.question}
      description={vue.description}
      choix={vue.choix}
      options={vue.options}
      reponse={vue.reponse}
    />
  );
}

/* ------------------------------------------------------------------ */
/* La mémoire du projet                                                 */
/* ------------------------------------------------------------------ */

/** Ce qu'une fiche complète rend, une fois le volet ouvert. */
type FicheDUnite = { unite: Unite } | { erreur: true } | null;

/**
 * UN VOLET DE RÉFÉRENCE. Fermé, il ne montre que le titre, la nature et
 * l'importance. Ouvert, il va chercher la FICHE COMPLÈTE au serveur — le texte
 * entier, pas le résumé coupé à 240 signes que la recherche rend — et
 * l'affiche.
 *
 * LA FICHE NE SE DEMANDE QU'AU CLIC, jamais à l'affichage du bloc : une
 * consultation ramène huit références, et huit allers-retours à l'ouverture
 * d'une étape qu'on ne lira peut-être pas ne se justifient pas.
 *
 * PENDANT L'ATTENTE, UNE SILHOUETTE tient la place, aux dimensions du texte à
 * venir : sans elle, le volet s'ouvrait vide puis poussait tout le fil vers le
 * bas à l'arrivée de la fiche.
 *
 * SI LA FICHE N'ARRIVE PAS — unité dépréciée puis purgée, serveur qui ne
 * répond plus —, le volet retombe sur le résumé déjà connu. Pas de message
 * alarmant : l'information utile est là, seul son détail manque.
 */
function VoletDeReference({ reference }: { reference: RefMemoire }) {
  const [ouvert, setOuvert] = React.useState(false);
  const [fiche, setFiche] = React.useState<FicheDUnite>(null);
  const [enCours, setEnCours] = React.useState(false);

  const ouvrir = () => {
    const suivant = !ouvert;
    setOuvert(suivant);
    if (!suivant || fiche || enCours) return;
    setEnCours(true);
    client
      .call<{ unite: Unite }>({ type: 'memoire.unite', id: reference.id })
      .then((data) => setFiche(data.unite ? { unite: data.unite } : { erreur: true }))
      .catch(() => setFiche({ erreur: true }))
      .finally(() => setEnCours(false));
  };

  const unite = fiche && 'unite' in fiche ? fiche.unite : null;
  const nature = unite ? LIBELLE_TYPE[unite.type] : reference.type;

  return (
    <li
      className="rounded-md bg-raised/40"
      data-memoire-reference={reference.id}
      data-memoire-reference-etat={ouvert ? 'ouvert' : 'ferme'}
    >
      <button
        type="button"
        onClick={ouvrir}
        aria-expanded={ouvert}
        data-memoire-reference-bascule={reference.id}
        className="flex w-full items-start gap-1.5 px-2 py-1.5 text-left"
      >
        <ChevronRight
          className={cn('mt-[3px] h-3.5 w-3.5 shrink-0 text-faint transition-transform', ouvert && 'rotate-90')}
          aria-hidden
        />
        <span className="min-w-0 flex-1 break-words text-[13px] font-medium leading-snug text-text">
          {reference.titre}
        </span>
        <span className="shrink-0 pt-[2px] text-[11.5px] text-faint">
          {[nature ? t(nature) : '', reference.importance ?? '', reference.portee === 'global' ? t('commune') : '']
            .filter(Boolean)
            .join(' · ')}
        </span>
      </button>

      {ouvert ? (
        <div className="px-2 pb-2 pl-7" data-memoire-reference-detail={reference.id}>
          {enCours ? (
            <div className="space-y-1.5" data-memoire-reference-silhouette>
              <Silhouette className="h-3 w-full" />
              <Silhouette className="h-3 w-[92%]" />
              <Silhouette className="h-3 w-[70%]" />
            </div>
          ) : unite ? (
            <div className="space-y-1.5">
              <p className="text-[13px] leading-relaxed text-muted texte-copiable">{unite.resume}</p>
              {unite.detail ? (
                <div className="text-[13px] [&_p]:text-[13px]">
                  <Markdown content={unite.detail.replace(/^### /gm, '#### ')} />
                </div>
              ) : null}
              {unite.raisonnement ? (
                <div>
                  <Etiquette>{t('Pourquoi c’est important')}</Etiquette>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-muted texte-copiable">{unite.raisonnement}</p>
                </div>
              ) : null}
              {unite.statut === 'deprecated' ? (
                <Constat>{t('Cette fiche est dépréciée : elle ne fait plus foi.')}</Constat>
              ) : null}
            </div>
          ) : (
            /* LE REPLI : le résumé déjà connu, sans un mot d'alarme. */
            <p className="text-[13px] leading-relaxed text-muted texte-copiable" data-memoire-reference-repli>
              {reference.resume || t('Aucun détail conservé pour cette référence.')}
            </p>
          )}
        </div>
      ) : null}
    </li>
  );
}

/**
 * LA MÉMOIRE DU PROJET OUVERTE.
 *
 * Une RECHERCHE devient une liste de volets — un par référence trouvée —, tous
 * fermés au départ. Une recherche VIDE le dit en une phrase. Tout le reste —
 * une unité lue d'un bloc, une fiche numérotée, le changelog — garde une
 * présentation simple et mise en forme : ces textes sont ÉCRITS pour être lus,
 * les replier en volets n'apporterait rien.
 */
function VueMemoire({ vue }: { vue: Extract<VueDEntree, { sorte: 'memoire' }> }) {
  return (
    <EncadreEtape
      sorte="memoire"
      titre={t(titreDeLaSorte('memoire'))}
      icone={Brain}
      aDroite={vue.mode === 'recherche' ? t('{v0} référence{v1}', { v0: vue.references.length, v1: vue.references.length > 1 ? 's' : '' }) : undefined}
    >
      {vue.sujet ? (
        <div className="flex items-baseline gap-1.5">
          <Etiquette>{t('Sujet')}</Etiquette>
          <span className="min-w-0 break-words text-[13px] text-text texte-copiable">{vue.sujet}</span>
        </div>
      ) : null}

      {vue.mode === 'recherche' ? (
        <ul className="space-y-1" data-memoire-references={vue.references.length}>
          {vue.references.map((reference) => (
            <VoletDeReference key={reference.id} reference={reference} />
          ))}
        </ul>
      ) : vue.mode === 'vide' ? (
        <Constat repere="data-memoire-vide">{t('Aucune référence trouvée.')}</Constat>
      ) : (
        <VueTexte texte={vue.texte} />
      )}
    </EncadreEtape>
  );
}

/* ------------------------------------------------------------------ */
/* Les autres genres                                                    */
/* ------------------------------------------------------------------ */

/**
 * UNE COMMANDE LANCÉE. L'invite `$` la précède : elle dit d'un coup d'œil que
 * cette ligne a été TAPÉE, là où la sortie en dessous a été REÇUE — deux
 * textes à chasse fixe que rien d'autre ne distinguerait.
 */
function VueCommande({ vue }: { vue: Extract<VueDEntree, { sorte: 'commande' }> }) {
  /* L'INTENTION N'EST DITE QU'UNE FOIS : quand la phrase du bloc raconté
     l'enchâsse déjà, la redire sous le bandeau doublait la ligne. */
  const dejaDit = useTeteDEtape()?.dejaDit;
  const intention = vue.intention && !dejaDitDans(dejaDit, vue.intention) ? vue.intention : undefined;
  return (
    <EncadreEtape sorte="commande" titre={t(titreDeLaSorte('commande'))} icone={Terminal}>
      {intention ? (
        <p className="text-[13px] text-muted texte-copiable" data-encadre-intention>
          {intention}
        </p>
      ) : null}
      <div className="flex gap-1.5 rounded-md bg-raised/60 px-2 py-1.5" data-encadre-commande>
        <span className="select-none font-mono text-[12.5px] text-faint" aria-hidden>
          $
        </span>
        {vue.commande.trim() ? (
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-[12.5px] text-text texte-copiable">
            {vue.commande}
          </span>
        ) : (
          <span className="min-w-0 flex-1 text-[12.5px] text-faint">{t('commande non conservée')}</span>
        )}
      </div>
      {vue.sortie.trim() ? (
        <BlocReplie titre={t('Sortie')} texte={vue.sortie} repere="data-encadre-sortie" />
      ) : (
        <Constat>{t('Aucune sortie')}</Constat>
      )}
    </EncadreEtape>
  );
}

/** Un fichier regardé, et l'extrait qui en est revenu. */
function VueFichier({ vue }: { vue: Extract<VueDEntree, { sorte: 'fichier' }> }) {
  return (
    <EncadreEtape
      sorte="fichier"
      titre={t(titreDeLaSorte('fichier'))}
      icone={FileText}
      aDroite={vue.depuis === undefined ? undefined : t('à partir de la ligne {v0}', { v0: vue.depuis })}
    >
      <Chemin chemin={vue.chemin} />
      {vue.extrait.trim() ? (
        <BlocReplie titre={t('Extrait')} texte={vue.extrait} repere="data-encadre-extrait" />
      ) : (
        <Constat>{t('texte non conservé')}</Constat>
      )}
    </EncadreEtape>
  );
}

/**
 * UN FICHIER MODIFIÉ : ce qui a été remplacé, et par quoi. Les deux textes sont
 * l'un SOUS l'autre et non côte à côte : le panneau d'une carte est étroit, et
 * deux colonnes de code y deviendraient deux colonnes de trois mots.
 */
function VueModification({ vue }: { vue: Extract<VueDEntree, { sorte: 'modification' }> }) {
  return (
    <EncadreEtape
      sorte="modification"
      titre={t(titreDeLaSorte('modification'))}
      icone={Pencil}
      aDroite={vue.compte ? t('Partout dans le fichier') : undefined}
    >
      <Chemin chemin={vue.chemin} />
      {vue.avant ? <BlocReplie titre={t('Avant')} texte={vue.avant} className="bg-danger/10" repere="data-encadre-avant" /> : null}
      {vue.apres ? (
        <BlocReplie
          titre={vue.avant ? t('Après') : t('Écrit')}
          texte={vue.apres}
          className="bg-success/10"
          repere="data-encadre-apres"
        />
      ) : null}
      {!vue.avant && !vue.apres ? <Constat>{t('texte non conservé')}</Constat> : null}
    </EncadreEtape>
  );
}

/**
 * UNE RECHERCHE, SON MOTIF ET CE QU'ELLE A TROUVÉ. Le NOMBRE de lignes est dit
 * en clair : une recherche qui ne rend rien est un résultat, et un pavé vide ne
 * le dirait pas.
 */
function VueRecherche({ vue }: { vue: Extract<VueDEntree, { sorte: 'recherche' }> }) {
  return (
    <EncadreEtape
      sorte="recherche"
      titre={t(titreDeLaSorte('recherche'))}
      icone={Search}
      aDroite={
        vue.lignes.length
          ? t('{v0} ligne{v1} trouvée{v1}', { v0: vue.lignes.length, v1: vue.lignes.length > 1 ? 's' : '' })
          : undefined
      }
    >
      <div className="flex flex-wrap items-baseline gap-x-2" data-encadre-motif>
        <span className="break-all rounded bg-raised/60 px-1.5 py-0.5 font-mono text-[12.5px] text-text texte-copiable">
          {vue.motif}
        </span>
        {vue.ou ? <span className="font-mono text-[12px] text-faint">{vue.ou}</span> : null}
      </div>
      {vue.lignes.length ? (
        <BlocReplie texte={vue.lignes.join('\n')} repere="data-encadre-lignes" />
      ) : (
        <Constat>{t('Rien trouvé')}</Constat>
      )}
    </EncadreEtape>
  );
}

/** Une adresse consultée sur le web. */
function VueWeb({ vue }: { vue: Extract<VueDEntree, { sorte: 'web' }> }) {
  const dejaDit = useTeteDEtape()?.dejaDit;
  const intention = vue.intention && !dejaDitDans(dejaDit, vue.intention) ? vue.intention : undefined;
  return (
    <EncadreEtape sorte="web" titre={t(titreDeLaSorte('web'))} icone={Globe}>
      <a
        href={vue.adresse}
        target="_blank"
        rel="noreferrer noopener"
        className="block break-all text-[13px] text-accent underline underline-offset-2"
        data-encadre-adresse
      >
        {vue.adresse}
      </a>
      {intention ? <p className="text-[13px] text-muted texte-copiable">{intention}</p> : null}
      {vue.texte.trim() ? <VueTexte texte={vue.texte} /> : <Constat>{t('Aucune donnée rendue')}</Constat>}
    </EncadreEtape>
  );
}

/** Une ligne de la liste des tâches : son état, son rang. */
function VuePoint({ vue }: { vue: Extract<VueDEntree, { sorte: 'point' }> }) {
  const etat = libelleDEtat(vue.etat);
  return (
    <EncadreEtape
      sorte="point"
      titre={t(titreDeLaSorte('point'))}
      icone={ListChecks}
      aDroite={vue.rang !== undefined && vue.sur !== undefined ? t('étape {v0} sur {v1}', { v0: vue.rang, v1: vue.sur }) : undefined}
    >
      {etat ? (
        <div className="flex items-baseline gap-1.5 text-[13px]" data-encadre-point>
          <Etiquette>{t('État')}</Etiquette>
          <span className="text-text">{t(etat)}</span>
        </div>
      ) : (
        <Constat>{t('texte non conservé')}</Constat>
      )}
    </EncadreEtape>
  );
}

/**
 * UN APPEL D'OUTIL, DANS SON PROPRE ENCADRÉ.
 *
 * Le bandeau porte le NOM FRANÇAIS de l'outil (« Modification d'une carte »),
 * et le nom d'appel brut reste à droite, en petit : sans lui, dix appels
 * différents donnaient dix pavés identiques. Dessous, ce que l'outil a REÇU
 * (ses paramètres nommés) et ce qu'il a RENDU — ou, quand il a refusé, son
 * REFUS, dit comme tel et en rouge : « Trop tôt : le geste 1 n'est pas fait »
 * n'est pas une donnée récupérée.
 *
 * UNE CARTE SE NOMME PAR SON TITRE. Les outils du tableau la désignent par son
 * identifiant (`ba69aea9-ca55-…`) : illisible, et c'était tout ce que la ligne
 * montrait. Quand la carte est connue de l'écran, son titre prend la place.
 */
function VueOutil({ vue, libelle }: { vue: Extract<VueDEntree, { sorte: 'outil' }>; libelle?: string }) {
  const tete = useTeteDEtape();
  const cartes = useApp().cards;
  const champs = React.useMemo(
    () =>
      vue.champs.map((champ) => {
        if (champ.libelle !== 'Carte') return champ;
        const titre = cartes[champ.valeur.trim()]?.title?.trim();
        return titre ? { ...champ, valeur: titre } : champ;
      }),
    [vue.champs, cartes],
  );
  const nomBrut = vue.nom.replace(/^mcp__[a-z0-9_-]+__/i, '');
  return (
    <EncadreEtape
      sorte="outil"
      titre={libelle && sujetLisible(libelle) ? t(libelle) : t(titreDeLaSorte('outil'))}
      icone={Wrench}
      aDroite={nomBrut}
    >
      <span className="sr-only" data-contenu-outil-nom>
        {vue.nom}
      </span>
      <ChampsDeLEtape champs={champs} titre={t('Ce qu\'il a reçu')} />
      {vue.texte ? (
        tete?.echec ? (
          <div data-encadre-refus>
            <Etiquette>{t('Refus')}</Etiquette>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] text-danger texte-copiable">{vue.texte}</p>
          </div>
        ) : (
          <BlocReplie titre={t('Données récupérées')} texte={vue.texte} repere="data-encadre-donnees" />
        )
      ) : (
        <Constat>{t('Aucune donnée rendue')}</Constat>
      )}
    </EncadreEtape>
  );
}

/**
 * LA DEMANDE REÇUE, AVEC SES PIÈCES JOINTES. Le texte de l'utilisateur garde
 * son gabarit — un intitulé, puis le texte —, et les pièces se posent DESSOUS,
 * en vignettes qui s'ouvrent en grand d'un clic.
 */
function VueDemande({
  vue,
  projectId,
}: {
  vue: Extract<VueDEntree, { sorte: 'demande' }>;
  projectId?: string;
}) {
  /* LES TAGS SE LISENT PAR L'IDENTIFIANT COURT DE LEUR PIÈCE (« #1a0c »), celui
     que cite le plan ; le texte enregistré ne change pas. */
  const connues = useApp().attachments[projectId ?? ''] ?? [];
  const texte = React.useMemo(() => {
    const jointes = connues.filter((piece) => vue.pieces.includes(piece.id));
    return texteAvecEtiquettes(vue.texte, jointes, tagsDuTexte(vue.texte));
  }, [connues, vue.pieces, vue.texte]);
  return (
    <EncadreEtape
      sorte="demande"
      titre={t('Demande envoyée')}
      aDroite={t('{v0} pièce{v1} jointe{v1}', { v0: vue.pieces.length, v1: vue.pieces.length > 1 ? 's' : '' })}
    >
      <VueTexte texte={texte} />
      <div data-contenu-pieces={vue.pieces.length}>
        <PiecesJointes ids={vue.pieces} projectId={projectId} />
      </div>
    </EncadreEtape>
  );
}

/**
 * LES CHAMPS D'UNE ÉTAPE, NOMMÉS. Les valeurs COURTES tiennent sur une ligne,
 * en deux colonnes ; celles qui passent à la ligne prennent leur propre bloc —
 * une ligne de tableau ne tient pas un texte de vingt lignes.
 */
function ChampsDeLEtape({ champs, titre }: { champs: readonly ChampLisible[]; titre?: string }) {
  if (!champs.length) return null;
  const courts = champs.filter((champ) => !champ.long).map((champ) => ({ ...champ, libelle: libelleDuChamp(champ) }));
  const longs = champs.filter((champ) => champ.long);
  return (
    <div className="space-y-2">
      {courts.length ? (
        <div>
          {titre ? <Etiquette>{titre}</Etiquette> : null}
          <div className="mt-0.5">
            <ChampsNommes champs={courts} />
          </div>
        </div>
      ) : null}
      {longs.map((champ) => (
        <BlocReplie key={champ.cle} titre={libelleDuChamp(champ)} texte={champ.valeur} />
      ))}
    </div>
  );
}

/**
 * LE REFUGE : une étape d'un genre inattendu. Elle montre ses informations sous
 * forme de couples intitulé-valeur, jamais sous leur forme de stockage — c'est
 * le dernier recours de la règle pure, pas le retour du pavé brut.
 */
function VueChamps({ vue, libelle }: { vue: Extract<VueDEntree, { sorte: 'champs' }>; libelle?: string }) {
  return (
    <EncadreEtape sorte="champs" titre={libelle ? t(libelle) : t('Détail de l’étape')} icone={Wrench}>
      {/* AUCUNE ÉTAPE NE S'OUVRE SUR DU VIDE : ce que le journal n'a pas gardé
          (texte allégé après quelques semaines) se dit en une phrase. */}
      {!vue.champs.length && !vue.texte ? <Constat repere="data-encadre-non-conserve">{t('texte non conservé')}</Constat> : null}
      <ChampsDeLEtape champs={vue.champs} />
      {/* LE TEXTE DU REFUGE RESTE BRUT, JAMAIS DU MARKDOWN. C'est la SORTIE
          d'un outil qu'on ne reconnaît pas : une liste de fichiers, un code de
          sortie, un extrait. Rendue en markdown, elle perdait ses retours à la
          ligne — vingt chemins recollés en un paragraphe — et ses dièses
          devenaient des titres énormes au milieu du flux. */}
      {vue.texte ? <BlocReplie texte={vue.texte} /> : null}
    </EncadreEtape>
  );
}

/**
 * LE MOT D'UN CHAMP. Un champ CONNU porte un libellé du catalogue partagé, qui
 * se traduit ; un champ inconnu garde le nom technique que le moteur lui a
 * donné, et celui-là ne passe pas au dictionnaire — le traduire reviendrait à
 * inventer un mot français pour un paramètre qu'on ne connaît pas.
 */
function libelleDuChamp(champ: ChampLisible): string {
  return champ.libelle === champ.cle ? champ.cle : t(champ.libelle);
}

/**
 * CE QUE PORTE UNE ÉTAPE, DESSINÉ. Un seul aiguillage, sur la sorte décidée
 * par la règle pure : aucun composant ne devine plus ce qu'il affiche.
 *
 * L'aiguillage pose aussi la TÊTE de l'étape (temps pris, état, échec) pour la
 * coquille : c'est ce que la sous-ligne portait avant d'être retirée. `dejaDit`
 * est la phrase lue juste au-dessus, qu'aucun encadré ne doit redire.
 */
export function ContenuDeLEntree({
  entree,
  projectId,
  dejaDit,
}: {
  entree: EntreeJournal;
  projectId?: string;
  dejaDit?: string;
}) {
  const vue = React.useMemo(() => vueDeLEntree(entree), [entree]);
  const libelle = React.useMemo(() => libelleLisible(entree), [entree]);
  const etat = vue.sorte === 'point' ? undefined : libelleDEtat(entree.etat);
  const tete = React.useMemo(
    () => ({
      ...(entree.dureeMs !== undefined ? { dureeMs: entree.dureeMs } : {}),
      ...(etat ? { etat } : {}),
      ...(entree.reussie === false ? { echec: true } : {}),
      ...(dejaDit ? { dejaDit } : {}),
    }),
    [entree.dureeMs, etat, entree.reussie, dejaDit],
  );
  return (
    <ContexteTeteDEtape.Provider value={tete}>
      <div data-contenu-sorte={vue.sorte} data-contenu-entree={entree.id}>
        {vue.sorte === 'texte' ? <VueTexte texte={vue.texte} /> : null}
        {vue.sorte === 'demande' ? <VueDemande vue={vue} projectId={projectId} /> : null}
        {vue.sorte === 'outil' ? <VueOutil vue={vue} libelle={libelle} /> : null}
        {vue.sorte === 'question' ? <VueQuestion vue={vue} /> : null}
        {vue.sorte === 'commande' ? <VueCommande vue={vue} /> : null}
        {vue.sorte === 'fichier' ? <VueFichier vue={vue} /> : null}
        {vue.sorte === 'modification' ? <VueModification vue={vue} /> : null}
        {vue.sorte === 'memoire' ? <VueMemoire vue={vue} /> : null}
        {vue.sorte === 'recherche' ? <VueRecherche vue={vue} /> : null}
        {vue.sorte === 'web' ? <VueWeb vue={vue} /> : null}
        {vue.sorte === 'point' ? <VuePoint vue={vue} /> : null}
        {vue.sorte === 'champs' ? <VueChamps vue={vue} libelle={libelle} /> : null}
      </div>
    </ContexteTeteDEtape.Provider>
  );
}
