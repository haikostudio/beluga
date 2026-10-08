import * as React from 'react';
import { Check, Circle, Loader2, Paperclip, X } from 'lucide-react';
import { Attachment, reponsePrete, texteDeReponse, triImages } from '@beluga/shared';
import { Button, Textarea } from '@/components/ui';
import { AttachmentPreview, AttachmentThumb } from '@/components/attachment-preview';
import { PastilleDeFichier } from '@/components/pastille-de-fichier';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';
import { oublierLaSaisie, retenirLaSaisie } from '@/lib/saisie-de-question';

/**
 * Les pièces jointes d'un message : les images se voient tout de suite, les
 * autres fichiers se reconnaissent à leur nom. Un clic ouvre l'aperçu en grand.
 */
export function PiecesJointes({ ids, projectId }: { ids: string[]; projectId?: string }) {
  const state = useApp();
  const [apercu, setApercu] = React.useState<Attachment | null>(null);
  const connues = projectId ? (state.attachments[projectId] ?? []) : [];

  // La liste du projet peut ne pas être encore chargée : on la demande.
  React.useEffect(() => {
    if (projectId && !state.attachments[projectId]) {
      client.send({ type: 'attachments.list', projectId });
    }
  }, [projectId]);

  const items = ids.map((id) => connues.find((item) => item.id === id)).filter(Boolean) as Attachment[];

  return (
    <>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {/* UNE PIÈCE ENCORE INCONNUE DU MAGASIN GARDE SON LIEN. Le repli était un
            badge MORT : on voyait « pièce jointe » sans pouvoir rien ouvrir, le
            temps que la liste du projet arrive. La pastille, elle, sait se
            rendre avec le seul identifiant — et le clic télécharge déjà. */}
        {items.length
          ? items.map((item) => <AttachmentThumb key={item.id} item={item} onOpen={() => setApercu(item)} />)
          : ids.map((id) => <PastilleDeFichier key={id} id={id} />)}
      </div>
      <AttachmentPreview
        item={apercu}
        onClose={() => setApercu(null)}
        galerie={items.filter((item) => item.mime.startsWith('image/'))}
        onNaviguer={setApercu}
      />
    </>
  );
}

/** Une option proposée : ce qu'il faut pour dessiner sa pastille. */
export interface OptionDeQuestion {
  id: string;
  label: string;
  description?: string;
}

/** Une question à poser, quelle que soit la façon dont elle est arrivée. */
export interface QuestionAAfficher {
  /** Le texte de la question. Vide quand l'entête le dit déjà. */
  question?: string;
  /** Ce qu'il faut savoir pour répondre, lu sous la question et avant les choix. */
  description?: string;
  /** Les choix proposés, en pastilles. */
  options: OptionDeQuestion[];
  /** Un seul choix, ou plusieurs à la fois. */
  kind?: 'single' | 'multiple' | 'text';
  /** L'écriture libre est-elle ouverte à côté des choix ? */
  allowFreeText?: boolean;
  /**
   * LA RÉPONSE QUE L'AGENT CONSEILLE (questions gardées sur la carte) : le
   * libellé d'une option, marquée « Conseillé », ou une réponse libre, lue
   * sous la question.
   */
  recommandee?: string;
}

/**
 * LA BULLE DE QUESTION — LE SEUL ENDROIT OÙ L'ON RÉPOND À UN AGENT.
 *
 * Il y avait trois façons de poser une question à l'écran : la bulle de l'outil
 * `ask_user` (pastilles, images, « Répondre » / « Annuler »), la bulle jaune
 * d'une question écrite en texte ordinaire (un champ de saisie et rien d'autre)
 * et le tiroir de publication (des boutons d'option, la réponse écrite dans la
 * barre du tiroir). Trois rendus, trois comportements, trois endroits à
 * corriger — et surtout, pour l'utilisateur, deux manières différentes de faire
 * exactement le même geste.
 *
 * Il n'y en a plus qu'UNE. Ce composant porte la question, ses choix en
 * pastilles, l'écriture libre quand elle est ouverte, les images jointes et les
 * deux issues. Ce qui change d'un appelant à l'autre — ce que veut dire
 * « répondre », ce que veut dire « annuler » — arrive par `onRepondre` et
 * `onAnnuler` : le composant ne connaît AUCUN chemin réseau.
 *
 * UN CHAMP DE SAISIE NE PARAÎT PLUS SEUL : dès qu'un choix est lisible, il
 * s'affiche en pastille. C'est vrai même d'une question écrite en texte
 * ordinaire, dont les options sont relues dans la phrase
 * (`choixDeQuestionEnTexte`, `shared/src/question-en-texte.ts`).
 */
export function BulleQuestion({
  question,
  projectId,
  agentId,
  entete,
  variante = 'neutre',
  onRepondre,
  onAnnuler,
  repere,
  cleDeSaisie,
}: {
  question: QuestionAAfficher;
  /** Le projet : c'est lui qui porte les pièces jointes. */
  projectId?: string;
  /** L'agent qui a posé la question : les images lui sont rattachées. */
  agentId?: string;
  /** Une ligne posée au-dessus de la question (« L'agent attend votre réponse »). */
  entete?: React.ReactNode;
  /**
   * `attention` pose le liseré orange d'une question restée en travers du fil.
   * `contraste` garde le seul étage de fond, sans liseré : le bloc qui porte la
   * question dessine DÉJÀ son propre cadre jaune (panneau « Une décision
   * attend »), et deux cadres imbriqués se répondaient pour rien.
   */
  variante?: 'neutre' | 'attention' | 'contraste';
  /** Répondre : le texte assemblé, et les images retenues. */
  onRepondre: (reponse: string, images: string[]) => Promise<void>;
  /** Fermer la question sans répondre. Absent : pas de sortie proposée. */
  onAnnuler?: () => Promise<void>;
  /** Le repère de test posé sur le bloc. */
  repere?: Record<string, string>;
  /**
   * La clé sous laquelle la barre d'écriture retrouve ce que cette bulle tient
   * (`saisie-de-question.ts`). Absente : la barre ne répond pas à cette question.
   */
  cleDeSaisie?: string;
}) {
  const [choisis, setChoisis] = React.useState<string[]>([]);
  /** Le texte libre de la réponse, écrit directement dans la bulle. */
  const [texteLibre, setTexteLibre] = React.useState('');
  /** Les images jointes à la réponse, avant l'envoi. */
  const [images, setImages] = React.useState<Attachment[]>([]);
  const [apercu, setApercu] = React.useState<Attachment | null>(null);
  const [envoiFichier, setEnvoiFichier] = React.useState(false);
  const [envoi, setEnvoi] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  // Une question sans choix ni réponse libre n'offre aucune façon de répondre.
  // Elle doit alors donner une sortie nette, plutôt que laisser une zone vide
  // qui ressemble à un blocage.
  const reponsePossible = question.options.length > 0 || !!question.allowFreeText;

  /**
   * Joindre des images à la réponse. On réutilise le dépôt de fichiers de la
   * barre d'écriture, à l'identique — seul le tri change : ici, des images et
   * rien d'autre, et un fichier refusé le dit au lieu de disparaître.
   */
  const joindre = async (fichiers: FileList | File[]) => {
    const { gardees, refusees } = triImages(
      Array.from(fichiers).map((file) => ({ file, name: file.name, mime: file.type })),
    );
    if (refusees.length) {
      client.pushToast('warning', t('Seules les images peuvent être jointes à une réponse.'));
    }
    if (!gardees.length) return;
    setEnvoiFichier(true);
    try {
      for (const { file } of gardees) {
        const response = await fetch(
          `/api/upload?project=${encodeURIComponent(projectId ?? '')}${agentId ? `&agent=${agentId}` : ''}`,
          {
            method: 'POST',
            headers: {
              'content-type': file.type || 'application/octet-stream',
              'x-file-name': encodeURIComponent(file.name),
            },
            body: file,
          },
        );
        const data = await response.json();
        const jointe: Attachment | undefined = data.attachment;
        if (!jointe) continue;
        // La même image envoyée deux fois ne s'ajoute qu'une fois.
        setImages((current) => (current.some((a) => a.id === jointe.id) ? current : [...current, jointe]));
      }
    } catch {
      client.pushToast('error', t('Envoi de l\'image impossible'));
    } finally {
      setEnvoiFichier(false);
    }
  };

  /*
   * Ces deux gestes RENDENT leur requête : c'est le bouton qui pose sa roue,
   * sa coche et son retour à l'état initial. Le refus est dit en rouge PUIS
   * relancé — sans quoi le bouton croirait avoir réussi.
   */
  const envoyer = async () => {
    const libelles = question.options.filter((o) => choisis.includes(o.id)).map((o) => o.label);
    const reponse = texteDeReponse(libelles, texteLibre, images.length);
    if (!reponse) return;
    setEnvoi(true);
    try {
      await onRepondre(reponse, images.map((a) => a.id));
    } finally {
      setEnvoi(false);
    }
  };

  const basculer = (id: string) =>
    setChoisis((current) =>
      question.kind === 'multiple'
        ? current.includes(id)
          ? current.filter((c) => c !== id)
          : [...current, id]
        : current.includes(id)
          ? []
          : [id],
    );

  const libellesChoisis = question.options.filter((o) => choisis.includes(o.id)).map((o) => o.label);

  /*
   * LA BARRE D'ÉCRITURE RÉPOND À LA MÊME QUESTION : elle doit voir ce qui est
   * coché ici. Le reflet se dépose à chaque changement et se retire avec la
   * bulle — rien ne s'y abonne, la frappe ne redessine que ce champ.
   */
  const bulle = React.useId();
  React.useEffect(() => {
    if (!cleDeSaisie || !agentId) return;
    retenirLaSaisie(cleDeSaisie, agentId, bulle, {
      libelles: libellesChoisis,
      texte: texteLibre,
      images: images.map((image) => image.id),
    });
  }, [cleDeSaisie, agentId, bulle, choisis, texteLibre, images, question.options]);
  React.useEffect(() => {
    if (!cleDeSaisie) return;
    return () => oublierLaSaisie(cleDeSaisie, bulle);
  }, [cleDeSaisie, bulle]);
  const pret = reponsePrete(libellesChoisis, texteLibre, images.length) && !envoi;
  /*
   * LA BULLE PORTE TOUT : options, texte libre et images. C'est le SEUL endroit
   * où répondre — le bouton « Répondre » valide ce qui s'y trouve.
   */
  const aValiderIci = question.options.length > 0 || images.length > 0 || !!question.allowFreeText;

  /* Les deux variantes non neutres posent le MÊME étage de fond (`--raised`) :
     ce qui se dessine par-dessus (zone de choix, pastille retenue, barre des
     issues) suit ce fond, pas le liseré. */
  const surFondRaised = variante !== 'neutre';

  return (
    <div
      /* UI MINIMALISTE : plus de cadre d'alerte jaune autour d'une simple
         question. C'est le MÊME fond neutre que les autres blocs du fil
         (`bg-bloc-fil`) — une question de cadrage n'est pas une erreur. */
      /* LA VARIANTE « ATTENTION » DOIT SE DÉTACHER DU BLOC QUI LA PORTE. Elle
         posait un voile orange à 5 % sur le fond du cadrage : deux surfaces
         quasi identiques, et la question se fondait dans l'encart foncé. Elle
         prend donc un ÉTAGE de fond différent (`--raised`) et un liseré orange
         franc — la convention EN COURS, lisible dans les douze palettes. */
      className={cn(
        'rounded-lg px-3 py-2.5',
        variante === 'attention'
          ? 'border border-warning/40 bg-raised'
          : variante === 'contraste'
            ? 'bg-raised'
            : 'bg-bloc-fil',
      )}
      /* UN REPÈRE STABLE POUR LES CONTRÔLES : la bulle se retrouvait par sa
         classe de liseré, qui n'existe plus dans le panneau de décision. Un
         contrôle ne vise plus une décoration, mais ce repère. */
      data-bulle-question={variante}
      {...(repere ?? {})}
      /* Une image lâchée n'importe où sur le bloc de la question se joint à la
         réponse : viser le champ au pixel près serait une contrainte inutile. */
      onPaste={reponsePossible ? (event) => {
        const fichiers = Array.from(event.clipboardData?.files ?? []);
        if (!fichiers.length) return;
        event.preventDefault();
        void joindre(fichiers);
      } : undefined}
      onDragOver={reponsePossible ? (event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      } : undefined}
      onDrop={reponsePossible ? (event) => {
        const fichiers = Array.from(event.dataTransfer.files);
        if (!fichiers.length) return;
        event.preventDefault();
        void joindre(fichiers);
      } : undefined}
    >
      {entete}

      {/* 1. LA QUESTION, EN HAUT ET SEULE DANS SA ZONE.
          PAS D'ICÔNE ICI : l'étape « Questions de cadrage » de la timeline en
          porte déjà une. Deux points d'interrogation pour une seule question,
          c'était exactement le doublon reproché. */}
      {question.question ? (
        <p
          data-intitule-question
          className={cn('text-[15px] font-medium leading-snug text-text', entete ? 'mt-1.5' : undefined)}
        >
          {question.question}
        </p>
      ) : null}

      {/* 1 bis. CE QU'IL FAUT SAVOIR POUR RÉPONDRE, sous la question et AVANT
          les choix. L'agent noyait ce contexte dans l'intitulé — un paragraphe
          entier en gras, la vraie question perdue dedans — ou le laissait
          dehors, et l'on répondait à l'aveugle. Il se lit ici, en texte
          ordinaire : la question garde son poids, l'explication le sien. */}
      {question.description ? (
        <p
          data-description-question
          className={cn(
            'whitespace-pre-line text-[13.5px] leading-relaxed text-muted',
            question.question ? 'mt-1.5' : entete ? 'mt-1.5' : undefined,
          )}
        >
          {question.description}
        </p>
      ) : null}

      {/* 1 ter. LA RÉPONSE CONSEILLÉE QUI N'EST PAS UN CHOIX DE LA LISTE. */}
      {question.recommandee && !question.options.some((option) => option.label === question.recommandee) ? (
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted" data-reponse-conseillee>
          {t('Réponse conseillée : {v0}', { v0: question.recommandee })}
        </p>
      ) : null}

      {/* 2. LES RÉPONSES POSSIBLES, DANS LEUR PROPRE ZONE ET ANNONCÉES.
          Les pastilles suivaient la question sans rien qui les sépare : on ne
          savait pas si l'on regardait la fin de la phrase ou le début des
          choix, ni combien on avait le droit d'en prendre. La zone porte donc
          son intitulé — « Un seul choix » ou « Plusieurs réponses possibles » —
          et son propre fond, distinct de celui de la bulle. */}
      {question.options.length ? (
        <div
          className={cn(
            'mt-2 rounded-md px-2 py-1.5',
            surFondRaised ? 'bg-text/5' : 'bg-raised/40',
          )}
          data-zone-choix-question
        >
          <p className="mb-1 text-[12px] uppercase tracking-wide text-faint">
            {question.kind === 'multiple' ? t('Plusieurs réponses possibles') : t('Un seul choix')}
          </p>
          <div className="space-y-1" data-choix-question>
          {question.options.map((option) => {
            const actif = choisis.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => basculer(option.id)}
                data-option-question={option.id}
                className={cn(
                  'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                  /* LE CHOIX RETENU DOIT RESTER VISIBLE : sur ces variantes,
                     le bloc est DÉJÀ posé sur `--raised` — une pastille du
                     même fond n'aurait plus rien montré. */
                  surFondRaised
                    ? actif
                      ? 'bg-text/10 text-text'
                      : 'text-muted hover:bg-text/5'
                    : actif
                      ? 'bg-raised text-text'
                      : 'text-muted hover:bg-raised/60',
                )}
              >
                <span className="mt-0.5 shrink-0">
                  {actif ? <Check className="h-3 w-3 text-success" /> : <Circle className="h-3 w-3 text-faint" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] leading-snug">
                    {option.label}
                    {question.recommandee && option.label === question.recommandee ? (
                      <span
                        className="ml-2 rounded bg-accent/15 px-1.5 py-0.5 text-[11.5px] font-medium text-accent"
                        data-option-conseillee
                      >
                        {t('Conseillé')}
                      </span>
                    ) : null}
                  </span>
                  {option.description ? (
                    <span className="block text-[12.5px] text-faint">{option.description}</span>
                  ) : null}
                </span>
              </button>
            );
          })}
          </div>
        </div>
      ) : null}

      {/* 3. LA RÉPONSE LIBRE, DANS SA ZONE À ELLE — le SEUL endroit qui compte.
          La barre de la conversation reste libre pour autre chose. */}
      {question.allowFreeText ? (
        <div className="mt-2" data-zone-reponse-libre>
          <p className="mb-1 text-[12px] uppercase tracking-wide text-faint">
            {question.options.length ? t('Ou votre propre réponse') : t('Votre réponse')}
          </p>
        <Textarea
          value={texteLibre}
          onChange={(event) => setTexteLibre(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            if (pret) void envoyer();
          }}
          placeholder={
            question.options.length
              ? t('Écrivez une précision, ou choisissez ci-dessus…')
              : t('Écrivez votre réponse…')
          }
          rows={2}
          className="text-[13.5px]"
          data-champ-reponse-question
        />
        </div>
      ) : null}

      {/* Les images jointes en attente : la croix retire celle qu'on ne veut
          plus, et rien ne part avant le clic sur « Répondre ». */}
      {images.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5" data-images-reponse>
          {images.map((image) => (
            <div key={image.id} className="relative">
              <AttachmentThumb item={image} compact onOpen={() => setApercu(image)} />
              <button
                type="button"
                title={t('Retirer cette image')}
                aria-label={`Retirer l'image ${image.name}`}
                onClick={() => setImages((liste) => liste.filter((a) => a.id !== image.id))}
                className="absolute -right-1 -top-1 rounded-full border border-border bg-surface p-0.5 text-faint hover:border-danger/40 hover:text-danger"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <AttachmentPreview item={apercu} onClose={() => setApercu(null)} />

      {/* Une question peut porter assez d'options pour dépasser l'écran. Les
          deux issues restent donc collées au bas du fil pendant sa lecture :
          répondre ou quitter ne doit jamais demander de deviner qu'un bouton
          se cache plus bas. */}
      <div
        className={cn(
          'sticky bottom-0 z-10 -mx-3 -mb-2.5 mt-2 flex flex-wrap items-center gap-1.5 border-t border-faint/15 px-3 py-2 backdrop-blur-sm',
          surFondRaised ? 'bg-raised/95' : 'bg-bloc-fil-voile',
        )}
        data-actions-question
        data-question-sans-reponse={reponsePossible ? undefined : ''}
      >
        {reponsePossible ? (
          <>
            {aValiderIci ? (
              <Button
                variant="default"
                size="sm"
                disabled={!pret}
                onClick={envoyer}
                data-repondre-question
              >
                {envoi ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                {t('Répondre')}</Button>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              data-champ-image
              onChange={(event) => {
                if (event.target.files?.length) void joindre(event.target.files);
                event.target.value = '';
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              title={t('Joindre une image')}
              aria-label="Joindre une image à la réponse"
              disabled={envoiFichier}
              onClick={() => fileRef.current?.click()}
            >
              {envoiFichier ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Paperclip className="h-3 w-3" />
              )}
{t('Image')}
</Button>
          </>
        ) : null}
        {/* Sans aucune façon de répondre, « Annuler » est la SEULE issue : il
            prend toute la largeur de la bulle, avec sa bordure, au lieu de se
            faire passer pour un lien discret posé dans un coin. */}
        {onAnnuler ? (
          <Button
            variant={reponsePossible ? 'ghost' : 'outline'}
            size="sm"
            title={t('Fermer la question sans répondre')}
            onClick={onAnnuler}
            data-annuler-question
            className={cn(
              reponsePossible
                ? 'text-faint hover:text-danger'
                : 'w-full justify-center border-danger/40 text-danger hover:bg-danger/10 hover:text-danger',
            )}
          >
            <X className="h-3 w-3" />

{t('Annuler')}
</Button>
        ) : null}
      </div>
    </div>
  );
}
