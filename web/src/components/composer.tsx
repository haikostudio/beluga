import * as React from 'react';
import { ArrowUp, Check, FileText, GripVertical, Loader2, Paperclip, Pencil, Route, Square, Trash2, X } from 'lucide-react';
import {
  Agent,
  Attachment,
  EngineInfo,
  QueuedPrompt,
  ancre,
  boutonsBarreEcriture,
  deplacerJointe,
  insereAncre,
  jointesApresFrappe,
  retireAncre,
  texteApresInsertion,
} from '@haikodev/shared';
import { useArretAgent } from '@/components/arret-agent';
import { AttachmentPreview } from '@/components/attachment-preview';
import { Button, Textarea, Tooltip } from '@/components/ui';
import { MicButton, RecorderErrorBar, RecordingBar, useRecorder } from '@/components/recorder';
import { RunChoix, RunSelectors } from '@/components/run-selectors';
import { indexAuPoint, montreLeMorceau } from '@/lib/miroir-texte';
import { usePref } from '@/lib/prefs';
import { client } from '@/lib/client';
import { cn } from '@/lib/utils';

export interface ComposerProps {
  agent: Agent | null;
  engines: EngineInfo[];
  queue: QueuedPrompt[];
  busy: boolean;
  picked: string[];
  onRemovePicked: (text: string) => void;
  onClearPicked: () => void;
  /**
   * UN TEXTE DÉPOSÉ DEPUIS LE FIL, jamais envoyé : le refus d'un plan et ses
   * suggestions d'optimisation (`shared/src/suggestions-de-plan.ts`). Il
   * s'ajoute à ce qui est déjà écrit, il ne l'écrase pas. Le `nonce` distingue
   * deux clics sur la MÊME pastille — sans lui, le second ne ferait rien.
   */
  aEcrire?: { texte: string; nonce: number } | null;
  projectId: string;
  /** Depuis une carte, l'envoi peut devenir une proposition de tâche (§15). */
  onProposeTask?: (text: string) => void;
  /** Dans le tiroir d'une carte : des boutons suivent en dessous, la barre ne
   *  touche donc pas le bas de l'écran et ne réserve pas le creux du téléphone. */
  dansTiroir?: boolean;
  /** Depuis le tiroir d'une carte : l'arrêt ne vaut que pour SA tâche. */
  cardId?: string;
  /** Seule la conversation permanente du chef d'orchestre vit sur fond noir
   *  (pas dans un tiroir) ; partout ailleurs (tiroir de carte, pile des
   *  agents) le fond entourant est gris cendré, la barre doit le reprendre. */
  fondNoir?: boolean;
  /**
   * Le témoin « travail en cours », rendu ICI plutôt qu'à côté : dans ce
   * même conteneur (même repli latéral que la zone de saisie), il en épouse
   * exactement la largeur, et rien ne peut plus s'intercaler entre lui et
   * elle — la file d'attente, les pièces jointes et le reste restent tous
   * au-dessus, comme le fil des messages déjà envoyés.
   */
  barreTravail?: React.ReactNode;
}

export function Composer({
  agent,
  engines,
  queue,
  busy,
  picked,
  onRemovePicked,
  onClearPicked,
  aEcrire,
  projectId,
  onProposeTask,
  dansTiroir,
  cardId,
  fondNoir,
  barreTravail,
}: ComposerProps) {
  const [text, setText] = React.useState('');
  /** Message en attente en cours de modification, et le texte mis de côté. */
  const [edition, setEdition] = React.useState<{ id: string; texteMisDeCote: string } | null>(null);
  const [attachments, setAttachments] = React.useState<Attachment[]>([]);
  /** La pièce jointe regardée en grand, avant même l'envoi du message. */
  const [apercu, setApercu] = React.useState<Attachment | null>(null);
  const [uploading, setUploading] = React.useState(false);
  /** L'étiquette en train d'être glissée, pour reposer les autres et l'estomper. */
  const [glissee, setGlissee] = React.useState<number | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  /**
   * Où l'ancre du prochain fichier doit s'écrire : le curseur posé dans le
   * texte, ou l'endroit visé par un fichier lâché sur les mots. Rien de posé
   * (collage, dépôt à côté du texte) → l'ancre va à la fin.
   */
  const curseur = React.useRef<number | null>(null);

  const retientCurseur = () => {
    const node = textareaRef.current;
    if (!node) return;
    curseur.current = node.selectionStart === node.selectionEnd ? node.selectionStart : null;
  };

  /**
   * Toute frappe passe par ici : une ancre effacée à la main retire aussitôt
   * sa pièce jointe, sinon le texte et la liste se contrediraient.
   */
  const majTexte = (suite: string) => {
    if (attachments.length) setAttachments((liste) => jointesApresFrappe(liste, text, suite));
    setText(suite);
  };

  /** Écrire l'ancre d'un fichier là où le curseur était posé. */
  const poseAncre = (nom: string) => {
    setText((avant) => {
      const suite = insereAncre(avant, nom, curseur.current);
      curseur.current = suite.curseur;
      return suite.texte;
    });
  };

  /**
   * Survoler une vignette montre le passage auquel le fichier se rapporte :
   * le texte défile jusqu'à son ancre. Rien n'est modifié, et le curseur
   * n'est pas volé — on ne fait que regarder.
   */
  const montreAncre = (item: Attachment) => {
    const zone = textareaRef.current;
    if (!zone) return;
    const debut = text.indexOf(ancre(item.name));
    if (debut === -1) return;
    montreLeMorceau(zone, debut, debut + ancre(item.name).length);
  };

  /** Retirer un fichier retire aussi son ancre du texte. */
  const retirerJointe = (item: Attachment) => {
    setAttachments((liste) => liste.filter((a) => a.id !== item.id));
    setText((avant) => retireAncre(avant, item.name));
    curseur.current = null;
  };

  // La dictée dépose son texte à la suite de ce qui est déjà écrit.
  const recorder = useRecorder((dicte) => setText((current) => (current ? `${current} ${dicte}` : dicte)));

  /*
   * UN TEXTE DÉPOSÉ DEPUIS LE FIL (refus d'un plan, suggestion d'optimisation)
   * s'écrit ICI et s'arrête là : aucun envoi, aucun tour lancé. Il s'AJOUTE à
   * ce qui était en train d'être écrit — on ne perd pas une phrase en cours
   * pour un clic — et le champ prend le curseur, à la fin du texte, pour que la
   * frappe reprenne au bon endroit.
   */
  const dernierDepot = React.useRef<number>(0);
  React.useEffect(() => {
    if (!aEcrire || aEcrire.nonce === dernierDepot.current) return;
    dernierDepot.current = aEcrire.nonce;
    setText((avant) => texteApresInsertion(avant, aEcrire.texte));
    const zone = textareaRef.current;
    if (!zone) return;
    window.requestAnimationFrame(() => {
      zone.focus();
      zone.setSelectionRange(zone.value.length, zone.value.length);
      zone.scrollTop = zone.scrollHeight;
    });
  }, [aEcrire]);

  /*
   * Brouillon conservé par conversation, côté serveur : on le retrouve depuis
   * n'importe quel écran. Ce qui est écrit ne s'efface QUE sur un geste de
   * l'utilisateur (envoi ou effacement) : ni un agent qui disparaît un instant,
   * ni une reconnexion, ni un changement d'onglet n'y touchent.
   */
  const agentId = agent?.id;
  const cleBrouillon = agentId ? `draft.${agentId}` : 'draft.aucun';
  const [draft] = usePref<string>(cleBrouillon, '');
  const chargePour = React.useRef<string | undefined>(undefined);
  const premierPassage = React.useRef(true);
  /** Le brouillon n'est posé qu'UNE fois par conversation ouverte. */
  const brouillonPose = React.useRef<string | undefined>(undefined);
  /** Le dernier texte parti : il ne doit JAMAIS revenir tout seul dans le champ. */
  const dejaEnvoye = React.useRef<string | null>(null);

  React.useEffect(() => {
    // Agent absent l'espace d'un instant : on ne touche surtout à rien.
    if (!agentId) return;

    if (chargePour.current !== agentId) {
      // Vraie ouverture d'une autre conversation : on affiche SON brouillon.
      chargePour.current = agentId;
      premierPassage.current = true;
      brouillonPose.current = draft ? agentId : undefined;
      dejaEnvoye.current = null;
      setText(draft);
      return;
    }

    /*
     * Même conversation. Le brouillon peut arriver du serveur juste après
     * l'ouverture : on le pose alors UNE seule fois. Passé ce moment, plus
     * rien ne réécrit le champ tout seul — surtout pas un message déjà parti,
     * dont l'écho tardif remettait le texte envoyé sous les yeux.
     */
    if (brouillonPose.current === agentId) return;
    if (!draft || draft === dejaEnvoye.current) return;
    brouillonPose.current = agentId;
    setText((current) => current || draft);
  }, [agentId, draft]);

  React.useEffect(() => {
    if (!agentId || chargePour.current !== agentId) return;
    // Le premier passage est l'affichage du brouillon, pas une saisie.
    if (premierPassage.current) {
      premierPassage.current = false;
      return;
    }
    // Pendant la modification d'un message en attente, le brouillon garde ce
    // qui a été mis de côté : il ne prend pas la place du texte modifié.
    if (edition) return;
    // Dès que la personne écrit à nouveau, l'ancien envoi cesse d'être une
    // référence : c'est un texte neuf.
    if (text) dejaEnvoye.current = null;
    // Retenu tout de suite en mémoire, envoyé au serveur juste après.
    client.setPrefLocally(cleBrouillon, text);
    const timer = window.setTimeout(
      () => client.send({ type: 'prefs.set', key: cleBrouillon, value: text }),
      600,
    );
    return () => window.clearTimeout(timer);
  }, [text, agentId, cleBrouillon]);

  React.useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 180)}px`;
  }, [text]);

  const modePlan = agent?.run?.mode === 'plan';

  // Le serveur tranche : il réinitialise les choix d'après et vérifie que la
  // combinaison existe vraiment (PLAN §14).
  const updateRun = async (patch: RunChoix) => {
    if (!agent) return;
    try {
      await client.call({ type: 'agent.config', agentId: agent.id, run: patch });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'réglage impossible');
    }
  };

  /**
   * Joindre des fichiers. Chaque nouveau fichier écrit son ancre dans le
   * texte : à l'endroit du curseur s'il y en avait un, à la fin sinon.
   */
  const upload = async (files: FileList | File[], aLaFin = false) => {
    if (aLaFin) curseur.current = null;
    const dejaVues = new Set(attachments.map((a) => a.id));
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const response = await fetch(
          `/api/upload?project=${encodeURIComponent(projectId)}${agent ? `&agent=${agent.id}` : ''}${
            agent?.cardId ? `&card=${agent.cardId}` : ''
          }`,
          {
            method: 'POST',
            headers: { 'content-type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) },
            body: file,
          },
        );
        const data = await response.json();
        const jointe: Attachment | undefined = data.attachment;
        // Le même fichier renvoyé deux fois ne s'ajoute — et ne s'ancre — qu'une fois.
        if (!jointe || dejaVues.has(jointe.id)) continue;
        dejaVues.add(jointe.id);
        setAttachments((current) => (current.some((a) => a.id === jointe.id) ? current : [...current, jointe]));
        poseAncre(jointe.name);
      }
    } catch {
      client.pushToast('error', "Envoi du fichier impossible");
    } finally {
      setUploading(false);
    }
  };

  /*
   * Modifier un message en attente : il s'ouvre ICI, dans la barre d'écriture.
   * Ce qui était déjà écrit est mis de côté et revient intact une fois la
   * modification envoyée (ou annulée) — on ne perd jamais un début de phrase.
   */
  const ouvrirEnEdition = (item: QueuedPrompt) => {
    setEdition((courante) => ({ id: item.id, texteMisDeCote: courante?.texteMisDeCote ?? text }));
    setText(item.text);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const terminerEdition = (envoyer: boolean) => {
    if (!edition) return;
    if (envoyer && text.trim()) {
      client.send({ type: 'queue.update', id: edition.id, text: text.trim() });
    }
    setText(edition.texteMisDeCote);
    setEdition(null);
  };

  const submit = async (asProposal = false) => {
    // En cours de modification, le bouton d'envoi enregistre la modification.
    if (edition) {
      terminerEdition(true);
      return;
    }

    const body = [text.trim(), ...picked].filter(Boolean).join('\n');
    if (!body || !agent) return;

    /*
     * Un message parti est parti. On efface le brouillon TOUT DE SUITE, en
     * mémoire et sur le serveur, et on retient le texte envoyé : un écho tardif
     * du serveur ne peut plus le remettre dans le champ. Seule la modification
     * d'un message en attente remet du texte, et c'est un geste volontaire.
     */
    const oublierBrouillon = () => {
      dejaEnvoye.current = text;
      brouillonPose.current = agentId;
      client.setPrefLocally(cleBrouillon, '');
      client.send({ type: 'prefs.set', key: cleBrouillon, value: '' });
    };

    if (asProposal && onProposeTask) {
      onProposeTask(body);
      oublierBrouillon();
      setText('');
      onClearPicked();
      return;
    }

    oublierBrouillon();
    setText('');
    onClearPicked();
    setAttachments([]);
    curseur.current = null;
    try {
      await client.call({
        type: 'agent.prompt',
        agentId: agent.id,
        text: body,
        attachments: attachments.map((a) => a.id),
      });
    } catch (err: any) {
      // L'envoi a échoué : là, on rend le texte, sinon il serait perdu.
      client.pushToast('error', err?.message ?? 'envoi impossible');
      dejaEnvoye.current = null;
      setText(body);
    }
  };

  /*
   * ARRÊTER SANS REMONTER EN HAUT DU FIL. La bande « en cours » garde son
   * bouton, mais dans une longue conversation elle sort de l'écran : tant que
   * l'agent travaille, la flèche d'envoi devient un carré d'arrêt, au même
   * endroit et à la même taille. C'est le MÊME geste (`useArretAgent`) :
   * même contrôle, même commande, même confirmation au-delà de cinq minutes.
   */
  const arret = useArretAgent({ agent, cardId });
  const boutons = boutonsBarreEcriture({
    occupe: busy,
    arretPossible: arret.possible,
    aDuTexte: !!text.trim() || picked.length > 0,
    enEdition: !!edition,
  });

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <div
      className={cn('px-2.5 pt-2', fondNoir ? 'bg-bg' : 'bg-surface')}
      /*
       * Le creux du téléphone (barre de gestes) n'est réservé QUE si la barre
       * d'écriture touche vraiment le bas de l'écran. Dans le tiroir d'une
       * carte, des boutons de décision viennent en dessous et réservent déjà
       * cette place : la réserver deux fois creusait un vide sous le composeur.
       */
      style={{ paddingBottom: dansTiroir ? '8px' : 'max(10px, env(safe-area-inset-bottom))' }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        const files = Array.from(event.dataTransfer.files);
        if (!files.length) return;
        event.preventDefault();
        // Lâché sur les mots, le fichier s'ancre À CET ENDROIT ; lâché à côté
        // du texte (réglages, pastilles, bord de la barre), il va à la fin.
        const zone = textareaRef.current;
        const surLeTexte = zone && event.target instanceof Node && zone.contains(event.target);
        const vise = surLeTexte ? indexAuPoint(zone, event.clientX, event.clientY) : null;
        if (vise === null) {
          void upload(files, true);
          return;
        }
        curseur.current = vise;
        void upload(files);
      }}
    >
      {/* La file d'attente s'empile juste au-dessus de la barre d'écriture */}
      {queue.length ? (
        <div className="mb-1.5 space-y-1">
          {queue.map((item, index) => (
            <QueuedItem
              key={item.id}
              item={item}
              index={index}
              actif={edition?.id === item.id}
              onEdit={() => ouvrirEnEdition(item)}
            />
          ))}
          <p className="px-1 text-[12px] text-faint">
            {queue.length === 1
              ? "Votre message part dès que l'agent a fini."
              : `${queue.length} messages en attente : ils partiront l'un après l'autre.`}
          </p>
        </div>
      ) : null}

      {/* Les pastilles d'évolutions retenues partent avec le message */}
      {picked.length ? (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {picked.map((item) => (
            <button
              key={item}
              type="button"
              data-composeur-retenu
              onClick={() => onRemovePicked(item)}
              className="group inline-flex max-w-[300px] items-center gap-1 rounded-md border border-border bg-raised px-1.5 py-1 text-[13px] text-muted hover:border-danger/40 hover:text-text"
            >
              <span className="truncate">{item}</span>
              <X className="h-2.5 w-2.5 shrink-0 text-faint group-hover:text-danger" />
            </button>
          ))}
        </div>
      ) : null}

      {/* Les fichiers joints en attente : chacun est une ÉTIQUETTE qu'on peut
          glisser pour changer l'ordre d'envoi, avec sa croix à droite pour le
          retirer (lui ET son ancre du texte). Un clic sur le nom ouvre
          l'aperçu en grand. */}
      {attachments.length ? (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {attachments.map((file, index) => (
            <div
              key={file.id}
              draggable
              onDragStart={(event) => {
                setGlissee(index);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(event) => {
                if (glissee === null) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (glissee === null) return;
                setAttachments((liste) => deplacerJointe(liste, glissee, index));
                setGlissee(null);
              }}
              onDragEnd={() => setGlissee(null)}
              onMouseEnter={() => montreAncre(file)}
              onFocus={() => montreAncre(file)}
              className={cn(
                'flex h-8 max-w-[220px] cursor-grab items-center gap-1.5 rounded-md border border-border bg-surface px-1.5 text-[12.5px] text-muted active:cursor-grabbing',
                glissee === index && 'opacity-40',
              )}
            >
              <GripVertical className="h-3 w-3 shrink-0 text-faint" />
              {file.mime.startsWith('image/') ? (
                <button
                  type="button"
                  onClick={() => setApercu(file)}
                  className="h-5 w-5 shrink-0 overflow-hidden rounded border border-border"
                >
                  <img src={`/api/attachment?id=${file.id}`} alt={file.name} className="h-full w-full object-cover" />
                </button>
              ) : (
                <button type="button" onClick={() => setApercu(file)} className="shrink-0 text-faint">
                  {file.mime === 'application/pdf' ? <FileText className="h-3 w-3" /> : <Paperclip className="h-3 w-3" />}
                </button>
              )}
              <button
                type="button"
                title={file.name}
                onClick={() => setApercu(file)}
                className="min-w-0 flex-1 truncate text-left hover:text-text"
              >
                {file.name}
              </button>
              <button
                type="button"
                title="Retirer ce fichier"
                onClick={() => retirerJointe(file)}
                className="shrink-0 text-faint hover:text-danger"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <AttachmentPreview item={apercu} onClose={() => setApercu(null)} />

      {recorder.recording ? (
        <RecordingBar
          levels={recorder.levels}
          seconds={recorder.seconds}
          onValidate={() => recorder.finish(true)}
          onDiscard={() => recorder.finish(false)}
        />
      ) : null}

      {recorder.error ? (
        <RecorderErrorBar message={recorder.error} onRetry={recorder.retry} onDiscard={recorder.discardError} />
      ) : null}

      {edition ? (
        <div className="mb-1.5 flex items-center gap-2 rounded-md border border-accent/50 bg-surface px-2.5 py-1.5">
          <Pencil className="h-3 w-3 shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
            Modification d'un message en attente
            {edition.texteMisDeCote ? ' — ce que vous écriviez revient juste après' : ''}
          </span>
          <button
            type="button"
            onClick={() => terminerEdition(false)}
            className="shrink-0 text-[12.5px] text-faint hover:text-text"
          >
            Annuler
          </button>
        </div>
      ) : null}

      {/* Collée à la zone de saisie, rien entre les deux : la file d'attente,
          les pièces jointes et l'édition en cours restent au-dessus. */}
      {barreTravail}

      <div className={cn('relative rounded-lg border border-border bg-raised', recorder.recording && 'hidden')}>
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => {
            majTexte(event.target.value);
            curseur.current = event.target.selectionStart;
          }}
          onKeyDown={onKeyDown}
          onKeyUp={retientCurseur}
          onClick={retientCurseur}
          onSelect={retientCurseur}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files);
            if (files.length) {
              event.preventDefault();
              /*
               * Coller un message copié avec ses images (BoutonCopier) doit
               * réinjecter le TEXTE en plus des fichiers, sinon seules les
               * images arrivaient et la phrase copiée disparaissait.
               */
              const texteColle = event.clipboardData.getData('text/plain');
              if (texteColle) {
                const zone = textareaRef.current;
                const debut = zone ? zone.selectionStart : text.length;
                const fin = zone ? zone.selectionEnd : text.length;
                setText((avant) => `${avant.slice(0, debut)}${texteColle}${avant.slice(fin)}`);
                const position = debut + texteColle.length;
                window.requestAnimationFrame(() => {
                  zone?.focus();
                  zone?.setSelectionRange(position, position);
                });
              }
              // Les fichiers, eux, ne visent aucun endroit précis : à la fin.
              void upload(files, true);
            }
          }}
          placeholder={
            edition
              ? 'Modifiez le message en attente…'
              : busy
                ? "L'agent travaille — votre message attendra son tour…"
                : 'Écrivez votre demande…'
          }
          rows={1}
          className="min-h-[38px] border-0 bg-transparent pr-14 focus-visible:ring-0"
        />

        {/* Une seule ligne, même sur téléphone : les réglages rétrécissent,
            les boutons d'envoi gardent leur taille. */}
        <div className="flex min-w-0 items-center gap-0.5 px-1.5 pb-1.5 sm:gap-1">
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => event.target.files && upload(event.target.files)}
          />
          <Tooltip label="Joindre un fichier">
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
            </Button>
          </Tooltip>

          <div className="mx-0.5 hidden h-4 w-px shrink-0 bg-border sm:block" />

          {/* Bascule direct / plan : l'agent réfléchit sans agir tant qu'elle
              est allumée. Placée à gauche du choix de moteur, elle reste un
              réglage à part — pas un quatrième maillon de la cascade. */}
          <Tooltip label={modePlan ? 'Mode plan activé : repasser en exécution directe' : "Passer en mode plan : l'agent prépare sans exécuter"}>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'shrink-0 gap-1 px-1.5 text-[12.5px]',
                modePlan ? 'border border-accent/60 bg-accent/10 text-text' : 'text-faint hover:text-text',
              )}
              onClick={() => updateRun({ mode: modePlan ? 'direct' : 'plan' })}
              disabled={!agent}
              data-mode-plan={modePlan ? 'actif' : 'inactif'}
            >
              <Route className="h-3 w-3 shrink-0" />
              Plan
            </Button>
          </Tooltip>

          <div className="mx-0.5 hidden h-4 w-px shrink-0 bg-border sm:block" />

          {/* Trois réglages EN CASCADE, alimentés par le serveur */}
          <RunSelectors engines={engines} choix={agent?.run} onSelect={updateRun} />

          <div className="ml-auto flex shrink-0 items-center gap-1">
            {onProposeTask && !edition && (text.trim() || picked.length) ? (
              <Button variant="ghost" size="sm" onClick={() => submit(true)}>
                En faire une tâche
              </Button>
            ) : null}
            <MicButton onStart={recorder.start} working={recorder.working} disabled={!agent} />
            {/* Le carré d'arrêt : seul quand rien n'est écrit, à côté de la
                flèche dès qu'une phrase attend d'être envoyée. */}
            {boutons.arret ? (
              <Tooltip label="Arrêter l'agent">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Arrêter l'agent"
                  className="shrink-0 border border-border text-muted hover:border-danger hover:text-danger"
                  onClick={arret.demander}
                >
                  <Square className="h-3 w-3 fill-current" />
                </Button>
              </Tooltip>
            ) : null}
            {boutons.envoi ? (
              <Button
                variant="default"
                size="icon"
                title={edition ? 'Enregistrer la modification' : 'Envoyer'}
                disabled={edition ? !text.trim() : !agent || (!text.trim() && !picked.length)}
                onClick={() => submit()}
              >
                {edition ? <Check className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />}
              </Button>
            ) : null}
          </div>
          {arret.dialogue}
        </div>
      </div>
    </div>
  );
}

/**
 * Un message en attente tient sur UNE seule ligne : le numéro, le début du
 * texte coupé proprement, le crayon et la corbeille. Le texte entier reste
 * accessible en le modifiant — il s'ouvre alors dans la BARRE D'ÉCRITURE, en
 * bas, avec toute la place.
 */
function QueuedItem({
  item,
  index,
  actif,
  onEdit,
}: {
  item: QueuedPrompt;
  index: number;
  actif: boolean;
  onEdit: () => void;
}) {
  // Les retours à la ligne deviennent des espaces : sinon la ligne unique
  // afficherait un texte coupé au premier saut plutôt qu'à sa largeur.
  const apercu = item.text.replace(/\s+/g, ' ').trim();
  return (
    <div
      className={cn(
        'flex h-8 items-center gap-1.5 rounded-md border bg-surface px-2',
        actif ? 'border-accent/50' : 'border-border',
      )}
    >
      <GripVertical className="h-3 w-3 shrink-0 text-faint" />
      <span className="shrink-0 text-[12px] text-faint">{index + 1}</span>
      <button
        type="button"
        onClick={onEdit}
        title={apercu}
        className="min-w-0 flex-1 truncate text-left text-[13.5px] text-muted hover:text-text"
      >
        {apercu}
      </button>
      <button type="button" title="Modifier" onClick={onEdit} className="shrink-0 text-faint hover:text-text">
        <Pencil className="h-3 w-3" />
      </button>
      <button
        type="button"
        title="Retirer de la file"
        onClick={() => client.send({ type: 'queue.remove', id: item.id })}
        className="shrink-0 text-faint hover:text-danger"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}
