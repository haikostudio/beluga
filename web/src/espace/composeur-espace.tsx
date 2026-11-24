/**
 * LE COMPOSEUR DE L'ESPACE CLIENT, CALQUÉ SUR CELUI DE BELUGA.
 *
 * Il n'est pas réinventé : il reprend, geste pour geste, la disposition du
 * composeur de la conversation (`web/src/components/composer.tsx`) —
 *
 *  - les pièces jointes en attente s'affichent EN PETIT AU-DESSUS du champ,
 *    REPLIÉES par défaut, ouvrables d'un clic ; le bandeau dit combien il y en
 *    a. Sans ce repli, six captures déposées mangeaient la moitié d'un écran de
 *    téléphone ;
 *  - le TROMBONE et l'ENVOI se posent DANS le coin bas-droit du champ, comme la
 *    barre d'écriture des agents (`pastille-champ`) — le champ garde leur place
 *    en bas (`pb-12`) pour qu'on n'écrive pas dessous. La barre « Envoyer »
 *    pleine largeur, SOUS le champ, a disparu (cadrage du 24/11/2026, maquette
 *    #93cf) : elle doublait la hauteur du pied pour un seul geste.
 *  - l'envoi DIT qu'il part dès le clic (roue qui tourne, bouton éteint) : un
 *    commentaire qui met une seconde à revenir ne s'envoie plus deux fois.
 *
 * Deux gestes s'y ajoutent, valables partout où ce composeur est posé : COLLER
 * une image au presse-papiers (Ctrl+V) et DÉPOSER un fichier sur la zone. Les
 * deux passent par le même chemin d'envoi que le trombone — il n'y a qu'une
 * seule façon d'attacher un fichier.
 *
 * AUCUN TRAIT AU-DESSUS : ce qui se pose juste avant lui (les Options de la
 * fiche) se détache par son fond, et un liseré coupait l'écran en deux.
 */
import * as React from 'react';
import { ChevronDown, Loader2, Paperclip, Send, X } from '@/components/ui/icones';
import { Button, Textarea } from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';
import { genreDuFichier } from '@beluga/shared';
import { EnvoisEnCours, IconeDeGenre, useEnvois } from './pieces';

/** Ce que `useEnvois` rend : le composeur ne le refabrique pas. */
export type Envois = ReturnType<typeof useEnvois>;

/**
 * LA MENTION @ NE VISE QUE CEUX QUI ONT ACCÈS AU PROJET. Nommer quelqu'un qui
 * ne verra jamais la demande n'appelle personne : la liste est fermée à ce que
 * le serveur a déjà envoyé.
 */
export interface MentionPossible {
  id: string;
  nom: string;
}

export function ComposeurEspace({
  valeur,
  onValeur,
  onEnvoyer,
  envois,
  placeholder,
  mentions = [],
  envoiSurEntree,
  repere,
}: {
  valeur: string;
  onValeur: (texte: string) => void;
  onEnvoyer: () => void | Promise<void>;
  envois: Envois;
  placeholder: string;
  mentions?: MentionPossible[];
  /** Dans un fil de discussion, « Entrée » envoie ; dans un commentaire, non. */
  envoiSurEntree?: boolean;
  /** Le repère posé sur le bouton d'envoi, pour les contrôles. */
  repere: string;
}) {
  const [piecesOuvertes, setPiecesOuvertes] = React.useState(false);
  const [survol, setSurvol] = React.useState(false);
  const [mentionOuverte, setMentionOuverte] = React.useState(false);
  const [envoiEnCours, setEnvoiEnCours] = React.useState(false);
  const champ = React.useRef<HTMLTextAreaElement | null>(null);

  const pieces = envois.pieces;
  const vide = !valeur.trim() && !pieces.length;

  /* LES MENTIONS : ouvertes dès qu'un « @ » vient d'être tapé, fermées sinon. */
  const motApresArobase = React.useMemo(() => {
    const avant = valeur.slice(0, champ.current?.selectionStart ?? valeur.length);
    const trouve = /@([\p{L}\d._-]*)$/u.exec(avant);
    return trouve ? trouve[1]!.toLowerCase() : null;
  }, [valeur]);

  const mentionsVisibles =
    mentionOuverte && motApresArobase !== null
      ? mentions.filter((m) => m.nom.toLowerCase().includes(motApresArobase)).slice(0, 6)
      : [];

  const poserLaMention = (nom: string) => {
    const position = champ.current?.selectionStart ?? valeur.length;
    const avant = valeur.slice(0, position).replace(/@([\p{L}\d._-]*)$/u, `@${nom} `);
    onValeur(avant + valeur.slice(position));
    setMentionOuverte(false);
    champ.current?.focus();
  };

  const envoyer = () => {
    if (vide || envois.occupe || envoiEnCours) return;
    setEnvoiEnCours(true);
    void Promise.resolve(onEnvoyer()).finally(() => setEnvoiEnCours(false));
    setPiecesOuvertes(false);
  };

  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 px-3 pb-3 pt-2',
        // LE DÉPÔT D'UN FICHIER SE VOIT AVANT DE LÂCHER : sans ce liseré, on ne
        // sait pas si la zone accepte ce qu'on tient.
        survol && 'bg-raised ring-1 ring-inset ring-accent/50',
      )}
      data-composeur-espace
      data-depot-survole={survol ? '' : undefined}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setSurvol(true);
      }}
      onDragLeave={() => setSurvol(false)}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length) return;
        event.preventDefault();
        setSurvol(false);
        envois.ajouter(event.dataTransfer.files);
      }}
    >
      <EnvoisEnCours envois={envois.envois} onReprendre={envois.reprendre} onOublier={envois.oublier} />

      {/* LES PIÈCES EN ATTENTE, EN PETIT ET REPLIÉES. Le bandeau dit combien il
          y en a ; la liste ne s'ouvre qu'au clic. */}
      {pieces.length ? (
        <div data-pieces-jointes={pieces.length} data-pieces-ouvertes={piecesOuvertes ? '' : undefined}>
          <button
            type="button"
            onClick={() => setPiecesOuvertes((ouvert) => !ouvert)}
            aria-expanded={piecesOuvertes}
            data-pieces-bascule
            className="flex w-full items-center gap-1.5 rounded-md px-1.5 sm:px-1 py-1.5 sm:py-1 text-left text-[12.5px] text-faint hover:text-text"
          >
            <Paperclip className="h-3 w-3 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{t('{v0} pièces jointes', { v0: pieces.length })}</span>
            <ChevronDown
              className={cn('h-3.5 w-3.5 shrink-0 transition-transform', piecesOuvertes && 'rotate-180')}
              aria-hidden
            />
          </button>
          <div className={cn('flex flex-wrap gap-1.5 pt-1', !piecesOuvertes && 'hidden')} data-pieces-liste>
            {pieces.map((piece) => (
              <span
                key={piece.id}
                className="inline-flex h-7 max-w-[200px] items-center gap-1.5 rounded-md bg-raised px-1.5 text-[12.5px] text-muted"
              >
                <IconeDeGenre genre={genreDuFichier(piece.mime)} className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 truncate">{piece.name}</span>
                <button
                  type="button"
                  onClick={() => envois.retirerPiece(piece.id)}
                  className="shrink-0 text-faint hover:text-text"
                  title={t('Retirer')}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {envois.occupe ? (
        <span className="text-[11px] text-faint" data-envoi-en-cours>
          {t('Envoi en cours…')}
        </span>
      ) : null}

      {/* LE CHAMP, ET SES DEUX GESTES DANS SON COIN BAS-DROIT. */}
      <div className="relative">
        {mentionsVisibles.length ? (
          <div
            className="absolute bottom-full left-0 z-20 mb-1 w-56 overflow-hidden rounded-md border border-border bg-surface shadow-lg"
            data-mentions
          >
            {mentionsVisibles.map((personne) => (
              <button
                key={personne.id}
                type="button"
                onClick={() => poserLaMention(personne.nom)}
                className="block w-full px-2.5 sm:px-2 py-2 sm:py-1.5 text-left text-[13px] text-text hover:bg-raised"
                data-mention={personne.id}
              >
                @{personne.nom}
              </button>
            ))}
          </div>
        ) : null}

        <Textarea
          ref={champ}
          value={valeur}
          rows={2}
          className="pb-12"
          placeholder={placeholder}
          data-champ-espace
          onChange={(event) => {
            onValeur(event.target.value);
            setMentionOuverte(event.target.value.slice(0, event.target.selectionStart).endsWith('@') || mentionOuverte);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setMentionOuverte(false);
            if (event.key === 'Enter' && !event.shiftKey && envoiSurEntree) {
              event.preventDefault();
              envoyer();
            }
          }}
          /*
           * COLLER UNE IMAGE (Ctrl+V) L'ATTACHE. C'est le geste le plus courant
           * pour signaler une anomalie : une capture d'écran, collée dans le
           * champ. Sans ceci, elle se perdait en silence.
           */
          onPaste={(event) => {
            const fichiers = Array.from(event.clipboardData.files);
            if (!fichiers.length) return;
            event.preventDefault();
            envois.ajouter(fichiers);
          }}
        />

        <div className="absolute bottom-2 right-2 z-10 flex items-center gap-1.5" data-gestes-du-champ-espace>
          <BoutonTrombone onFichiers={envois.ajouter} />
          <Button
            type="button"
            variant="default"
            size="pastille-champ"
            onClick={envoyer}
            disabled={vide || envois.occupe || envoiEnCours}
            title={t('Envoyer')}
            aria-label="Envoyer"
            data-envoyer={repere}
            data-envoi-part={envoiEnCours ? '' : undefined}
          >
            {envoiEnCours ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

    </div>
  );
}

/** Le trombone posé DANS le coin du champ, à gauche de l'envoi — jamais dans une colonne à côté. */
function BoutonTrombone({ onFichiers }: { onFichiers: (fichiers: FileList | null) => void }) {
  const champ = React.useRef<HTMLInputElement | null>(null);
  return (
    <>
      <input
        ref={champ}
        type="file"
        multiple
        className="hidden"
        data-espace-fichier
        onChange={(event) => {
          onFichiers(event.target.files);
          event.target.value = '';
        }}
      />
      <Button
        type="button"
        variant="doux"
        size="pastille-champ"
        onClick={() => champ.current?.click()}
        title={t('Joindre un fichier')}
        aria-label="Joindre un fichier"
        data-joindre-espace
      >
        <Paperclip className="h-4 w-4" />
      </Button>
    </>
  );
}
