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
 *  - le TROMBONE se pose DANS le coin haut-droit du champ, qui garde sa place
 *    à droite (`pr-10`) pour ne pas écrire dessous ;
 *  - le bouton d'ENVOI va dans la rangée SOUS le champ — et il en prend
 *    TOUTE LA LARGEUR : un petit bouton poussé à droite se cherchait.
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
import { ChevronDown, Paperclip, Send, X } from 'lucide-react';
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
    if (vide || envois.occupe) return;
    void onEnvoyer();
    setPiecesOuvertes(false);
  };

  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 p-2',
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
            className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-[12.5px] text-faint hover:text-text"
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
                className="inline-flex h-7 max-w-[200px] items-center gap-1.5 rounded-md border border-faint/60 bg-surface px-1.5 text-[12.5px] text-muted"
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

      {/* LE CHAMP, ET LE TROMBONE DANS SON COIN. */}
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
                className="block w-full px-2 py-1.5 text-left text-[13px] text-text hover:bg-raised"
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
          className="pr-10"
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

        <BoutonTrombone onFichiers={envois.ajouter} />
      </div>

      {/*
       * LA RANGÉE SOUS LE CHAMP : L'ENVOI PREND TOUTE LA LARGEUR. Un petit
       * bouton poussé à droite se cherchait, surtout au pouce ; à pleine
       * largeur il tombe sous le doigt sans viser. La mention « Envoi en
       * cours… » passe AU-DESSUS plutôt qu'à côté : elle ne rogne plus la
       * largeur du bouton et n'en fait pas varier la taille selon l'état.
       */}
      {/* LE PIED A LA HAUTEUR COMMUNE (`size="pied"`) ET DE L'AIR : un peu de
          marge dessus et dessous. LA ZONE SÛRE DU BAS N'EST PAS COMPTÉE ICI :
          le composeur vit dans le tiroir, qui la réserve déjà
          (`paddingBottom: var(--zone-sure-bas)`). La compter deux fois laissait
          un grand vide sous « Envoyer » sur iPhone. */}
      <div className="flex shrink-0 flex-col gap-1 py-2" data-pied-envoi>
        {envois.occupe ? (
          <span className="text-[11px] text-faint" data-envoi-en-cours>
            {t('Envoi en cours…')}
          </span>
        ) : null}
        <Button
          size="pied"
          onClick={envoyer}
          disabled={vide || envois.occupe}
          data-envoyer={repere}
        >
          <Send className="mr-1.5 h-3.5 w-3.5" />
          {t('Envoyer')}
        </Button>
      </div>
    </div>
  );
}

/** Le trombone posé DANS le coin du champ, jamais dans une colonne à côté. */
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
        variant="ghost"
        size="icon-sm"
        className="absolute right-1.5 top-1.5 z-10"
        onClick={() => champ.current?.click()}
        title={t('Joindre un fichier')}
        data-joindre-espace
      >
        <Paperclip className="h-4 w-4" />
      </Button>
    </>
  );
}
