import * as React from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  ChevronDown,
  ChevronUp,
  Copy,
  Eraser,
  Eye,
  EyeOff,
  Italic,
  Layers,
  Magnet,
  Plus,
  RotateCw,
  Scan,
  Scissors,
  Strikethrough,
  Trash2,
  Underline,
  X,
} from 'lucide-react';
import {
  type Composition,
  type FormatStudio,
  type MediaStudio,
  type OperationStudio,
  type AncrePiece,
  type AlignementVertical,
  type CasseTexte,
  type Degrade,
  type ModeFusion,
  type OmbrePiece,
  type Retouche,
  type Segment,
  type SegmentDessin,
  dureeDeLaComposition,
  MODES_FUSION,
  OMBRES_MAX,
  piecesDuDessin,
  POLICES_STUDIO,
  RECETTES_ANIMATION,
  retouchesDuFormat,
  trouverSegment,
} from '@beluga/shared';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import { formatRegional, t } from '@/lib/langue';
import { Accordeons, ChampBascule, ChampBoutons, ChampChoix, ChampCouleur, ChampCurseur, ChampNombre, ChampPolice, ChampQuatre, ChampTexte, Ligne, Section } from './champs';
import { ApercuEnDirect, type BoiteDuCadre, type NaturePiece, alignementDe, enCouleur, lireCouleur } from './apercu';
import { libelleDuGenre, libelleEtatVoix, libelleRecette } from './libelles';
import { actionDEcoute, useEcouteDesVoix } from './panneaux';
import { iconeDeRecette } from './ligne-de-temps';

/**
 * L'INSPECTEUR : ce qui se règle sur ce qu'on a cliqué.
 *
 * LA PIÈCE OU LA SCÈNE, JAMAIS LES DEUX. Une pièce d'un DESSIN choisie (dans
 * l'aperçu ou les calques) : l'inspecteur ne montre QUE ses réglages, rangés
 * comme dans Figma et propres à ce qu'elle est (`RetouchesDeLaPiece`) — un
 * texte a son contenu sur plusieurs lignes et sa typographie, une image sa
 * source et son cadrage, toute pièce sa disposition, son calque, son
 * remplissage, son contour, ses marges, ses effets et les paramètres que
 * l'agent a posés sur elle. Rien de choisi : la SCÈNE (nom, temps, entrée,
 * sortie, puis les réglages de son genre — pour un dessin, les paramètres qui
 * ne visent aucune pièce). Hors dessin, le segment EST la pièce : sa place
 * s'ajoute à ses réglages.
 *
 * CHAQUE BLOC EST UN ACCORDÉON (`Accordeons`) : tous ouverts au départ, chacun
 * se replie sans toucher aux autres, et son état est gardé sur l'appareil.
 *
 * Chaque valeur part de ce que la page affiche (styles calculés envoyés par
 * l'aperçu), jamais d'un blanc par défaut ; une couleur se voit dans l'aperçu
 * PENDANT le choix (`ApercuEnDirect`). Une retouche est une donnée posée à côté
 * du dessin : elle survit à un redessin.
 */
export function Inspecteur({
  composition,
  segmentId,
  elementId,
  format,
  temps,
  medias,
  voixEssai,
  onOperation,
  onVoixEssai,
  onChoisirPiece,
  calquesAilleurs = false,
  piece = null,
}: {
  /** La pièce telle que l'aperçu la voit (nature, vraies couleurs, texte affiché). */
  piece?: BoiteDuCadre | null;
  composition: Composition;
  segmentId: string | null;
  elementId: string | null;
  /** Sur ORDINATEUR, les calques ont leur colonne à gauche de l'aperçu : l'inspecteur ne les redit pas. */
  calquesAilleurs?: boolean;
  /** Choisir une pièce du dessin depuis le panneau « Calques » (elle se sélectionne aussi dans l'aperçu). */
  onChoisirPiece: (elementId: string | null) => void;
  format: FormatStudio;
  temps: number;
  medias: MediaStudio[];
  voixEssai: { id: string; label: string }[];
  onOperation: (op: OperationStudio) => Promise<unknown> | void;
  onVoixEssai: (segmentId: string) => Promise<unknown>;
}) {
  const trouve = segmentId ? trouverSegment(composition, segmentId) : null;
  if (!trouve) {
    return (
      <div className="flex flex-col gap-2" data-studio-inspecteur="composition">
        <ReglagesDeComposition composition={composition} onOperation={onOperation} />
        <p className="px-1 text-[12.5px] text-faint">{t('Choisissez un segment dans la ligne de temps, ou une pièce dans l’aperçu, pour la régler.')}</p>
      </div>
    );
  }
  const s = trouve.segment;
  const prop = (valeurs: Record<string, unknown>) => onOperation({ op: 'proprietes', segmentId: s.id, valeurs });
  const fin = s.debut + s.duree;
  const peutCouper = temps > s.debut + 0.1 && temps < fin - 0.1 && s.genre !== 'voix' && s.genre !== 'sous-titres';

  // La boîte de l'aperçu ne compte que si elle parle de LA pièce réglée ici.
  const boite = piece && piece.segmentId === s.id && (piece.elementId ?? null) === elementId ? piece : null;
  const piecesDeLaScene = s.genre === 'dessin' ? piecesDuDessin(s.gabarit.html) : [];
  const parametresDeLaPiece = piecesDeLaScene.find((p) => p.id === elementId)?.parametres ?? [];
  // Un paramètre TEXTE posé sur la pièce est son contenu : il se règle dans le bloc « Texte » (sur plusieurs lignes).
  const estTexte = (id: string) => s.genre === 'dessin' && s.parametres.some((p) => p.id === id && p.type === 'texte');
  const parametresTexteDeLaPiece = boite?.nature === 'texte' ? parametresDeLaPiece.filter(estTexte) : [];
  const autresParametresDeLaPiece = parametresDeLaPiece.filter((id) => !parametresTexteDeLaPiece.includes(id));
  // Les paramètres posés sur une pièce vivent avec elle : la scène ne garde que les autres.
  const parametresDesPieces = piecesDeLaScene.flatMap((p) => p.parametres ?? []);
  const pieceVisee = !!elementId && s.genre !== 'audio' && s.genre !== 'voix';
  // Une pièce d'un DESSIN choisie : elle seule, la scène disparaît.
  const pieceSeule = pieceVisee && s.genre === 'dessin';

  const scene = (
    <>
      <Section
        titre={`${libelleDuGenre(s.genre)}${s.nom ? ` — ${s.nom}` : ''}`}
        cle="segment"
        data-studio-section-scene=""
        action={
          <span className="flex items-center">
            <Button
              size="icon"
              variant="ghost"
              aria-label="Couper au curseur"
              title={t('Couper au curseur')}
              disabled={!peutCouper}
              onClick={() => onOperation({ op: 'scinder', segmentId: s.id, a: temps })}
            >
              <Scissors className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Dupliquer"
              title={t('Dupliquer')}
              onClick={() => {
                const copie: Record<string, unknown> = JSON.parse(JSON.stringify(s));
                delete copie.id;
                copie.debut = fin;
                return onOperation({ op: 'inserer', pisteId: trouve.piste.id, segment: copie });
              }}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" aria-label="Supprimer le segment" title={t('Supprimer le segment')} onClick={() => onOperation({ op: 'supprimer', segmentId: s.id })} data-studio-supprimer>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </span>
        }
      >
        <Ligne libelle={t('Nom')}>
          <ChampTexte valeur={s.nom ?? ''} onValider={(v) => prop({ nom: v })} />
        </Ligne>
        <Ligne libelle={t('Début')}>
          <ChampNombre valeur={s.debut} unite="s" onValider={(v) => onOperation({ op: 'deplacer', segmentId: s.id, debut: v })} />
        </Ligne>
        <Ligne libelle={t('Durée')}>
          <ChampNombre valeur={s.duree} unite="s" onValider={(v) => onOperation({ op: 'rogner', segmentId: s.id, duree: v })} />
        </Ligne>
        {s.genre !== 'audio' && s.genre !== 'voix' && s.genre !== 'sous-titres' ? (
          <>
            <Ligne libelle={t('Entrée')}>
              <ChampChoix titre={t('Entrée')} valeur={s.entree ?? 'aucune'} options={RECETTES_ANIMATION.map((r) => ({ valeur: r, libelle: libelleRecette(r), icone: iconeDeRecette(r, 'h-3.5 w-3.5') }))} onValider={(v) => prop({ entree: v })} />
            </Ligne>
            <Ligne libelle={t('Sortie')}>
              <ChampChoix titre={t('Sortie')} valeur={s.sortie ?? 'aucune'} options={RECETTES_ANIMATION.map((r) => ({ valeur: r, libelle: libelleRecette(r), icone: iconeDeRecette(r, 'h-3.5 w-3.5') }))} onValider={(v) => prop({ sortie: v })} />
            </Ligne>
          </>
        ) : null}
      </Section>
      <ReglagesDuGenre segment={s} medias={medias} voixEssai={voixEssai} prop={prop} onOperation={onOperation} onVoixEssai={onVoixEssai} exclure={parametresDesPieces} />
    </>
  );

  return (
    <div className="flex flex-col gap-2" data-studio-inspecteur={s.genre} data-studio-vue={pieceSeule ? 'piece' : 'scene'}>
      {/* Sur téléphone, les calques restent ici, AU-DESSUS des accordéons : c'est d'eux qu'on choisit la pièce. */}
      {s.genre === 'dessin' && !calquesAilleurs ? (
        <Calques segment={s} elementId={elementId} format={format} formatDeBase={composition.format} onOperation={onOperation} onChoisirPiece={onChoisirPiece} />
      ) : null}

      {/* Chaque bloc s'ouvre et se ferme seul, et garde son état d'une pièce à l'autre (`Accordeons`). La clé remonte
          les champs quand la pièce change : une saisie en cours ne passe pas d'une pièce à l'autre. */}
      <Accordeons key={`${s.id}:${pieceVisee ? elementId : ''}`}>
        {pieceVisee ? (
          <RetouchesDeLaPiece
            segment={s}
            elementId={elementId!}
            format={format}
            formatDeBase={composition.format}
            medias={medias}
            onOperation={onOperation}
            boite={boite}
            // Le texte, les couleurs, la typographie et les effets ne se règlent que dans un dessin : ailleurs, le segment les porte déjà.
            reglagesDuContenu={s.genre === 'dessin'}
            parametresTexte={
              s.genre === 'dessin' && parametresTexteDeLaPiece.length ? (
                <ParametresDuDessin segment={s} medias={medias} onOperation={onOperation} ids={parametresTexteDeLaPiece} />
              ) : null
            }
            parametres={
              s.genre === 'dessin' && autresParametresDeLaPiece.length ? (
                <ParametresDuDessin segment={s} medias={medias} onOperation={onOperation} ids={autresParametresDeLaPiece} />
              ) : null
            }
          />
        ) : null}
        {pieceSeule ? null : scene}
      </Accordeons>
    </div>
  );
}

/** LES PARAMÈTRES DÉCLARÉS PAR L'AGENT sur un dessin : tous, ceux d'une pièce (`ids`), ou tous sauf ceux-là (`exclure`). */
function ParametresDuDessin({
  segment: s,
  medias,
  onOperation,
  ids,
  exclure = [],
}: {
  segment: SegmentDessin;
  medias: MediaStudio[];
  onOperation: (op: OperationStudio) => unknown;
  ids?: string[];
  exclure?: string[];
}) {
  const choixMedias = medias.filter((m) => m.genre === 'image').map((m) => ({ valeur: m.id, libelle: m.nom }));
  const direct = React.useContext(ApercuEnDirect);
  return (
    <>
      {s.parametres
        .filter((p) => (ids ? ids.includes(p.id) : !exclure.includes(p.id)))
        .map((p) => {
          const v = s.valeurs[p.id] ?? p.defaut;
          const poser = (valeur: unknown) => onOperation({ op: 'parametre', segmentId: s.id, id: p.id, valeur });
          return (
            <Ligne key={p.id} libelle={p.libelle}>
              {p.type === 'couleur' ? (
                <ChampCouleur transparence valeur={String(v)} onValider={poser} onApercu={direct ? (c) => direct({ segmentId: s.id, variable: p.id, valeur: c }) : undefined} data-studio-parametre={p.id} />
              ) : p.type === 'nombre' ? (
                p.min !== undefined && p.max !== undefined ? (
                  <ChampCurseur valeur={Number(v)} min={p.min} max={p.max} pas={p.pas ?? 1} onValider={poser} />
                ) : (
                  <ChampNombre valeur={Number(v)} pas={p.pas ?? 1} unite={p.unite} onValider={poser} data-studio-parametre={p.id} />
                )
              ) : p.type === 'bascule' ? (
                <ChampBascule valeur={!!v} onValider={poser} />
              ) : p.type === 'choix' ? (
                <ChampChoix titre={p.libelle} valeur={String(v)} options={(p.options ?? []).map((o) => ({ valeur: o, libelle: o }))} onValider={poser} />
              ) : p.type === 'media' ? (
                <ChampChoix titre={p.libelle} valeur={String(v)} options={[{ valeur: '', libelle: t('Aucun') }, ...choixMedias]} onValider={poser} />
              ) : (
                // UN TEXTE DE PARAMÈTRE VA À LA LIGNE : Entrée y écrit un vrai retour, rendu à l'aperçu comme à l'export.
                <ChampTexte long valeur={String(v)} onValider={poser} data-studio-parametre={p.id} />
              )}
            </Ligne>
          );
        })}
    </>
  );
}

function ReglagesDuGenre({
  segment: s,
  medias,
  voixEssai,
  prop,
  onOperation,
  onVoixEssai,
  exclure = [],
}: {
  segment: Segment;
  medias: MediaStudio[];
  voixEssai: { id: string; label: string }[];
  prop: (v: Record<string, unknown>) => unknown;
  onOperation: (op: OperationStudio) => unknown;
  onVoixEssai: (segmentId: string) => Promise<unknown>;
  /** Les paramètres d'un dessin posés sur une pièce : ils se règlent avec elle, pas avec la scène. */
  exclure?: string[];
}) {
  const ecoute = useEcouteDesVoix();
  const choixMedias = (genre: MediaStudio['genre']) => medias.filter((m) => m.genre === genre).map((m) => ({ valeur: m.id, libelle: m.nom }));
  switch (s.genre) {
    case 'dessin': {
      if (!s.parametres.length) return <p className="px-1 text-[12.5px] text-faint">{t('Ce dessin n’a déclaré aucun réglage : demandez-en à l’agent, ou déplacez ses pièces dans l’aperçu.')}</p>;
      const restants = s.parametres.filter((p) => !exclure.includes(p.id));
      if (!restants.length) return null;
      return (
        <Section titre={t('Réglages du dessin')} cle="genre">
          <ParametresDuDessin segment={s} medias={medias} onOperation={onOperation} exclure={exclure} />
        </Section>
      );
    }
    case 'texte':
      return (
        <Section titre={t('Texte')} cle="genre">
          <Ligne libelle={t('Texte')}>
            <ChampTexte long valeur={s.texte} onValider={(v) => prop({ texte: v })} />
          </Ligne>
          <Ligne libelle={t('Taille')}>
            <ChampCurseur valeur={s.taille} min={16} max={300} pas={2} onValider={(v) => prop({ taille: v })} />
          </Ligne>
          <Ligne libelle={t('Couleur')}>
            <ChampCouleur valeur={s.couleur} onValider={(v) => prop({ couleur: v })} />
          </Ligne>
          <Ligne libelle={t('Police')}>
            <ChampPolice titre={t('Police')} valeur={s.police ?? ''} premiere={t('Celle de la marque')} onValider={(v) => prop({ police: v || undefined })} />
          </Ligne>
          <Ligne libelle={t('Gras')}>
            <ChampBascule valeur={!!s.gras} onValider={(v) => prop({ gras: v })} />
          </Ligne>
          <Ligne libelle={t('Position (gauche)')}>
            <ChampCurseur valeur={s.position.x} min={0} max={100} pas={1} onValider={(v) => prop({ position: { ...s.position, x: v } })} />
          </Ligne>
          <Ligne libelle={t('Position (haut)')}>
            <ChampCurseur valeur={s.position.y} min={0} max={100} pas={1} onValider={(v) => prop({ position: { ...s.position, y: v } })} />
          </Ligne>
        </Section>
      );
    case 'image':
    case 'video':
      return (
        <Section titre={s.genre === 'image' ? t('Image') : t('Vidéo')} cle="genre">
          <Ligne libelle={t('Fichier')}>
            <ChampChoix titre={t('Fichier')} valeur={s.mediaId} options={choixMedias(s.genre)} onValider={(v) => onOperation({ op: 'remplacer-media', segmentId: s.id, mediaId: v })} />
          </Ligne>
          <Ligne libelle={t('Cadrage')}>
            <ChampChoix titre={t('Cadrage')}
              valeur={s.ajustement}
              options={[
                { valeur: 'couvrir', libelle: t('Remplir le cadre') },
                { valeur: 'contenir', libelle: t('Tout montrer') },
              ]}
              onValider={(v) => prop({ ajustement: v })}
            />
          </Ligne>
          {s.genre === 'video' ? (
            <>
              <Ligne libelle={t('Volume')}>
                <ChampCurseur valeur={s.volume} min={0} max={2} pas={0.05} onValider={(v) => prop({ volume: v })} />
              </Ligne>
              <Ligne libelle={t('Vitesse')}>
                <ChampVitesse valeur={s.vitesse ?? 1} onValider={(v) => prop({ vitesse: v })} />
              </Ligne>
              <Ligne libelle={t('Fondu d’entrée')}>
                <ChampNombre valeur={s.fonduEntree ?? 0} unite="s" onValider={(v) => prop({ fonduEntree: v })} />
              </Ligne>
              <Ligne libelle={t('Fondu de sortie')}>
                <ChampNombre valeur={s.fonduSortie ?? 0} unite="s" onValider={(v) => prop({ fonduSortie: v })} />
              </Ligne>
              <Ligne libelle={t('Départ dans le fichier')}>
                <ChampNombre valeur={s.debutMedia} unite="s" onValider={(v) => prop({ debutMedia: v })} />
              </Ligne>
            </>
          ) : null}
        </Section>
      );
    case 'audio': {
      const m = medias.find((x) => x.id === s.mediaId);
      return (
        <Section titre={t('Son')} cle="genre">
          <Ligne libelle={t('Fichier')}>
            <ChampChoix titre={t('Fichier')} valeur={s.mediaId} options={choixMedias('audio')} onValider={(v) => onOperation({ op: 'remplacer-media', segmentId: s.id, mediaId: v })} />
          </Ligne>
          {m && !m.licence && m.provenance === 'import' ? (
            <p className="text-[12px] text-warning">{t('Aucune licence notée pour ce son : notez-la dans la bibliothèque avant de publier.')}</p>
          ) : null}
          <Ligne libelle={t('Volume')}>
            <ChampCurseur valeur={s.volume} min={0} max={2} pas={0.05} onValider={(v) => prop({ volume: v })} />
          </Ligne>
          <Ligne libelle={t('Vitesse')}>
            <ChampVitesse valeur={s.vitesse ?? 1} onValider={(v) => prop({ vitesse: v })} />
          </Ligne>
          <Ligne libelle={t('Fondu d’entrée')}>
            <ChampNombre valeur={s.fonduEntree ?? 0} unite="s" onValider={(v) => prop({ fonduEntree: v })} />
          </Ligne>
          <Ligne libelle={t('Fondu de sortie')}>
            <ChampNombre valeur={s.fonduSortie ?? 0} unite="s" onValider={(v) => prop({ fonduSortie: v })} />
          </Ligne>
          <Ligne libelle={t('Départ dans le fichier')}>
            <ChampNombre valeur={s.debutMedia} unite="s" onValider={(v) => prop({ debutMedia: v })} />
          </Ligne>
        </Section>
      );
    }
    case 'voix':
      return (
        <Section titre={t('Voix')} cle="genre" action={<span className="text-[12px] text-muted" data-studio-etat-voix={s.etat}>{libelleEtatVoix(s.etat)}</span>}>
          <Ligne libelle={t('Texte dit')}>
            <ChampTexte long valeur={s.texte} onValider={(v) => prop({ texte: v })} data-studio-texte-voix />
          </Ligne>
          <Ligne libelle={t('Voix d’essai')}>
            <ChampChoix
              titre={t('Voix d’essai')}
              valeur={s.voixEssai}
              data-studio-voix-essai-choix
              options={voixEssai.map((v) => ({ valeur: v.id, libelle: v.label, detail: t('Gratuite, fabriquée sur le serveur'), action: actionDEcoute(v.id, ecoute) }))}
              onValider={(v) => prop({ voixEssai: v })}
            />
          </Ligne>
          {/* UNE SEULE VOIX FINALE : celle du projet, choisie dans « Mettre en production » — plus aucun choix par phrase. */}
          <p className="text-[12px] text-muted" data-studio-voix-finale-du-projet>
            {t('La voix finale est celle du projet, choisie dans « Mettre en production » : la même pour toutes les phrases.')}
          </p>
          {s.etat === 'finale' || s.etat === 'a-revalider' ? (
            <p className="text-[12px] text-warning" data-studio-voix-a-revalider>
              {t('Changer ce texte repasse la voix « à revalider » : la nouvelle voix finale ne part que par votre clic sur « Valider la voix ».')}
            </p>
          ) : null}
          <Ligne libelle={t('Volume')}>
            <ChampCurseur valeur={s.volume} min={0} max={2} pas={0.05} onValider={(v) => prop({ volume: v })} />
          </Ligne>
          <Ligne libelle={t('Vitesse')}>
            <ChampVitesse valeur={s.vitesse ?? 1} onValider={(v) => prop({ vitesse: v })} />
          </Ligne>
          {s.mediaId ? (
            <Ligne libelle={t('Départ dans le son')}>
              <ChampNombre valeur={s.debutMedia ?? 0} unite="s" min={0} onValider={(v) => prop({ debutMedia: v })} />
            </Ligne>
          ) : null}
          {s.dureeAudio ? <p className="text-[12px] text-faint">{t('Durée réelle du son : {n} s', { n: s.dureeAudio.toFixed(2) })}</p> : null}
          {/* Dans la colonne des valeurs, sur toute sa largeur : le libellé va à la ligne au lieu de déborder sur la note du dessus. */}
          <Button size="sm" variant="outline" className="mt-1 h-auto min-h-8 w-full whitespace-normal py-1.5 leading-snug" onClick={() => onVoixEssai(s.id)} data-studio-voix-essai>
            {t('Fabriquer la voix d’essai (gratuite)')}
          </Button>
        </Section>
      );
    case 'sous-titres':
      return (
        <Section titre={t('Sous-titres')} cle="genre">
          <Ligne libelle={t('Suivent les voix')}>
            <ChampBascule valeur={s.auto} onValider={(v) => prop({ auto: v })} />
          </Ligne>
          <Ligne libelle={t('Mots à l’écran')}>
            <ChampChoix titre={t('Mots à l’écran')}
              valeur={String(s.motsParGroupe)}
              options={[
                { valeur: '1', libelle: '1' },
                { valeur: '2', libelle: '2' },
              ]}
              onValider={(v) => prop({ motsParGroupe: Number(v) })}
            />
          </Ligne>
          <Ligne libelle={t('Place')}>
            <ChampChoix titre={t('Place')}
              valeur={s.style.position}
              options={[
                { valeur: 'haut', libelle: t('En haut') },
                { valeur: 'milieu', libelle: t('Au milieu') },
                { valeur: 'bas', libelle: t('En bas') },
              ]}
              onValider={(v) => prop({ style: { ...s.style, position: v } })}
            />
          </Ligne>
          <Ligne libelle={t('Taille')}>
            <ChampCurseur valeur={s.style.taille} min={24} max={200} pas={2} onValider={(v) => prop({ style: { ...s.style, taille: v } })} />
          </Ligne>
          <Ligne libelle={t('Couleur')}>
            <ChampCouleur valeur={s.style.couleur} onValider={(v) => prop({ style: { ...s.style, couleur: v } })} />
          </Ligne>
          <Ligne libelle={t('Mot dit')}>
            <ChampCouleur valeur={s.style.accent} onValider={(v) => prop({ style: { ...s.style, accent: v } })} />
          </Ligne>
          <Ligne libelle={t('Lisibilité')}>
            <ChampChoix titre={t('Lisibilité')}
              valeur={s.style.fond}
              options={[
                { valeur: 'ombre', libelle: t('Ombre') },
                { valeur: 'bande', libelle: t('Bandeau') },
                { valeur: 'aucun', libelle: t('Aucune') },
              ]}
              onValider={(v) => prop({ style: { ...s.style, fond: v } })}
            />
          </Ligne>
          <p className="text-[12px] text-faint">{t('{n} mots calés sur la voix.', { n: s.mots.length })}</p>
        </Section>
      );
  }
}

/** Les vitesses proposées : du ralenti (×0,25) à l'accéléré (×4). Une vitesse posée par l'agent hors liste reste montrée. */
const VITESSES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

function ChampVitesse({ valeur, onValider }: { valeur: number; onValider: (v: number) => void }) {
  const liste = VITESSES.includes(valeur) ? VITESSES : [...VITESSES, valeur].sort((a, b) => a - b);
  return (
    <ChampChoix
      titre={t('Vitesse')}
      valeur={String(valeur)}
      data-studio-vitesse
      options={liste.map((v) => ({ valeur: String(v), libelle: v === 1 ? t('Normale') : `×${v.toLocaleString(formatRegional())}` }))}
      onValider={(v) => onValider(Number(v))}
    />
  );
}

/** Le nom de ce qu'est la pièce, en tête de son bloc. */
function libelleDeNature(n: NaturePiece | undefined): string {
  switch (n) {
    case 'texte':
      return t('Texte');
    case 'image':
      return t('Image');
    case 'svg':
      return t('Forme vectorielle');
    case 'groupe':
      return t('Groupe');
    case 'forme':
      return t('Forme');
    default:
      return t('Pièce');
  }
}

/** Les graisses d'une police, nommées comme dans Figma. */
function libellesGraisse(): Record<string, string> {
  return {
    '100': t('Fine'),
    '200': t('Extra-légère'),
    '300': t('Légère'),
    '400': t('Normale'),
    '500': t('Moyenne'),
    '600': t('Demi-grasse'),
    '700': t('Grasse'),
    '800': t('Extra-grasse'),
    '900': t('Noire'),
  };
}

/** La police embarquée qu'une `font-family` calculée nomme en premier (« 'Inter', sans-serif » → « Inter »), sinon vide. */
function policeDe(famille: string | undefined): string {
  const premiere = (famille ?? '').split(',')[0]?.trim().replace(/^['"]|['"]$/g, '') ?? '';
  return POLICES_STUDIO.some((p) => p.famille === premiere) ? premiere : '';
}

/** Quatre valeurs lues dans la page, sinon une seule répétée. */
function quatre(lues: number[] | undefined, repli = 0): [number, number, number, number] {
  return lues && lues.length === 4 ? (lues.map((v) => Math.round(v)) as [number, number, number, number]) : [repli, repli, repli, repli];
}

/** Une ombre neuve : celle des lettres pour un texte sans fond, portée sinon. */
function ombreNeuve(nature: NaturePiece | undefined, fond: string | null): OmbrePiece {
  const fondVisible = !!fond && (lireCouleur(fond)?.alpha ?? 0) > 0;
  return { genre: nature === 'texte' && !fondVisible ? 'texte' : 'portee', x: 0, y: 4, flou: 12, etalement: 0, couleur: '#00000040' };
}

/**
 * LES RÉGLAGES D'UNE PIÈCE, RANGÉS COMME DANS FIGMA, et seulement ceux qui ont un
 * sens pour ce qu'elle est (`boite.nature`, dite par la page) : Disposition
 * (position, taille, rotation, arrondi), Texte (contenu sur plusieurs lignes,
 * typographie, alignements), Image (source, cadrage), Calque (opacité, fusion,
 * rognage), Remplissage (uni ou dégradé, transparence comprise), Contour, Marges,
 * Effets (ombres, flous) et les réglages que l'agent a posés sur elle. Chaque
 * valeur montrée est la VRAIE (styles calculés par la page), chaque réglage part
 * en UNE retouche — une version, une annulation —, et une couleur se voit dans
 * l'aperçu pendant son choix.
 */
function RetouchesDeLaPiece({
  segment,
  elementId,
  format,
  formatDeBase,
  medias,
  onOperation,
  boite,
  reglagesDuContenu,
  parametresTexte,
  parametres,
}: {
  segment: Segment;
  elementId: string;
  format: FormatStudio;
  formatDeBase: FormatStudio;
  medias: MediaStudio[];
  onOperation: (op: OperationStudio) => unknown;
  /** Ce que l'aperçu dit de la pièce : sa nature et ses styles réels (absent : pas encore reçu). */
  boite: BoiteDuCadre | null;
  /** Texte, couleurs, typographie et effets : seulement pour une pièce de dessin. */
  reglagesDuContenu: boolean;
  /** Les paramètres TEXTE de l'agent posés sur cette pièce : son contenu se règle par eux. */
  parametresTexte: React.ReactNode;
  /** Ses autres paramètres (couleurs, nombres, médias…). */
  parametres: React.ReactNode;
}) {
  const r: Retouche = retouchesDuFormat(segment, format, formatDeBase)[elementId] ?? {};
  const poser = (retouche: Partial<Record<keyof Retouche, unknown>>) => onOperation({ op: 'retouche', segmentId: segment.id, elementId, retouche: retouche as Retouche, format });
  const direct = React.useContext(ApercuEnDirect);
  /** Montrer un réglage dans l'aperçu PENDANT le choix ; il ne part qu'une fois choisi. */
  const montrer = direct ? (retouche: Retouche) => direct({ segmentId: segment.id, elementId, retouche }) : undefined;
  const nature = boite?.nature;
  const st = boite?.styles ?? null;
  const contenu = reglagesDuContenu ? nature : undefined;
  const epaisseur = r.epaisseurContour ?? Math.round(st?.epaisseurContour ?? 0);
  const couleurContour = r.contour ?? enCouleur(st?.contour) ?? '#000000';
  const arrondiCoins = r.arrondiCoins ?? (r.arrondi !== undefined ? undefined : st?.arrondiCoins && new Set(st.arrondiCoins).size > 1 ? quatre(st.arrondiCoins) : undefined);
  const [coinsSepares, setCoinsSepares] = React.useState(!!arrondiCoins);
  const fond = r.fond ?? enCouleur(st?.fond) ?? '#ffffff00';
  const ombres = r.ombres ?? [];
  const graisses = libellesGraisse();
  const graisse = String(r.graisse ?? Math.round((st?.graisse ?? 400) / 100) * 100);
  const policeLue = r.police ?? policeDe(st?.police);
  const opacite = Math.round((r.opacite ?? 1) * 100);
  const poserOmbres = (liste: OmbrePiece[]) => poser({ ombres: liste });
  const imagesDuProjet = medias.filter((m) => m.genre === 'image').map((m) => ({ valeur: m.id, libelle: m.nom }));

  return (
    <>
      {/* DISPOSITION : la place et la taille en paires de cases, comme dans Figma. Plus de curseurs ni d'échelle :
          on agrandit en changeant la largeur et la hauteur (un texte se réenroule, ses lettres ne grossissent pas). */}
      <Section
        titre={t('{nature} « {nom} »', { nature: libelleDeNature(nature), nom: elementId })}
        cle="piece"
        data-studio-piece={elementId}
        data-studio-nature={nature ?? ''}
        action={
          <span className="flex items-center">
            <Button
              size="icon"
              variant="ghost"
              aria-label={r.masquee ? 'Afficher la pièce' : 'Masquer la pièce'}
              title={r.masquee ? t('Afficher la pièce') : t('Masquer la pièce')}
              aria-pressed={!!r.masquee}
              onClick={() => poser({ masquee: !r.masquee })}
              data-studio-retouche="visible"
            >
              {r.masquee ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </Button>
            <Button size="icon" variant="ghost" aria-label="Effacer la retouche" title={t('Remettre comme à l’origine')} onClick={() => onOperation({ op: 'effacer-retouche', segmentId: segment.id, elementId, format })}>
              <Eraser className="h-3.5 w-3.5" />
            </Button>
          </span>
        }
      >
        {format !== formatDeBase ? <p className="text-[12px] text-faint">{t('Ces retouches ne valent que pour ce format.')}</p> : null}
        {/* UNE POSITION TAPÉE est un placement libre, au pixel : l'axe touché quitte son repère. */}
        <Ligne libelle={t('Position')} className="gap-1">
          <ChampNombre valeur={r.x ?? 0} pas={1} prefixe="X" aria-label="Décalage horizontal" title={t('Décalage horizontal, en pixels')} onValider={(v) => poser({ x: v, ancre: sansAxe(r.ancre, 'h') })} data-studio-retouche="x" />
          <ChampNombre valeur={r.y ?? 0} pas={1} prefixe="Y" aria-label="Décalage vertical" title={t('Décalage vertical, en pixels')} onValider={(v) => poser({ y: v, ancre: sansAxe(r.ancre, 'v') })} data-studio-retouche="y" />
        </Ligne>
        {nature ? (
          <Ligne libelle={t('Taille')} className="gap-1">
            <ChampNombre valeur={r.largeur ?? Math.round(st?.largeur ?? 0)} pas={1} min={4} prefixe="L" aria-label="Largeur du cadre" title={t('Largeur du cadre, en pixels')} onValider={(v) => poser({ largeur: v })} data-studio-retouche="largeur" />
            <ChampNombre valeur={r.hauteur ?? Math.round(st?.hauteur ?? 0)} pas={1} min={4} prefixe="H" aria-label="Hauteur du cadre" title={t('Hauteur du cadre, en pixels')} onValider={(v) => poser({ hauteur: v })} data-studio-retouche="hauteur" />
          </Ligne>
        ) : null}
        <Ligne libelle={t('Rotation')}>
          <ChampNombre valeur={r.rotation ?? 0} pas={1} unite="°" prefixe={<RotateCw className="h-3 w-3" />} onValider={(v) => poser({ rotation: v })} data-studio-retouche="rotation" />
        </Ligne>
        {/* UNE ÉCHELLE DÉJÀ POSÉE (un coin tiré sur une forme, ou une retouche d'avant) reste lisible et s'efface d'un clic. */}
        {r.echelle !== undefined && r.echelle !== 1 ? (
          <Ligne libelle={t('Échelle')}>
            <span className="min-w-0 flex-1 text-[12.5px] tabular-nums text-muted" data-studio-retouche="echelle">
              {Math.round(r.echelle * 100)} %
            </span>
            <Button size="icon" variant="ghost" aria-label="Retirer l’échelle" title={t('Retirer l’échelle')} onClick={() => poser({ echelle: null })}>
              <Eraser className="h-3.5 w-3.5" />
            </Button>
          </Ligne>
        ) : null}
        {contenu ? (
          <Ligne libelle={t('Arrondi')} className="gap-1">
            {coinsSepares ? (
              <ChampQuatre
                valeurs={arrondiCoins ?? quatre(undefined, Math.round(r.arrondi ?? st?.arrondi ?? 0))}
                lettres={['↖', '↗', '↘', '↙']}
                libelles={[t('Coin haut gauche'), t('Coin haut droit'), t('Coin bas droit'), t('Coin bas gauche')]}
                min={0}
                onValider={(q) => poser({ arrondiCoins: q, arrondi: null })}
                data-studio-retouche="arrondiCoins"
              />
            ) : (
              <ChampNombre valeur={r.arrondi ?? Math.round(st?.arrondi ?? 0)} pas={1} min={0} unite="px" onValider={(v) => poser({ arrondi: v, arrondiCoins: null })} data-studio-retouche="arrondi" />
            )}
            <Button
              size="icon"
              variant={coinsSepares ? 'subtle' : 'ghost'}
              aria-pressed={coinsSepares}
              aria-label="Coins séparés"
              title={t('Un arrondi par coin')}
              onClick={() => setCoinsSepares((x) => !x)}
              data-studio-coins-separes=""
            >
              <Scan className="h-3.5 w-3.5" />
            </Button>
          </Ligne>
        ) : null}
        {r.ancre ? (
          <Ligne libelle={t('Collée à')}>
            <span className="flex min-w-0 items-center gap-1 text-[12.5px]" data-studio-ancre={`${r.ancre.h ?? ''}|${r.ancre.v ?? ''}`}>
              <Magnet className="h-3.5 w-3.5 shrink-0 text-accent" />
              <span className="min-w-0 truncate">{nomDeLAncre(r.ancre)}</span>
            </span>
          </Ligne>
        ) : null}
      </Section>

      {/* LE TEXTE : son contenu sur plusieurs lignes (Entrée va à la ligne, y compris pour une phrase animée mot par mot),
          puis sa typographie et ses alignements. */}
      {contenu === 'texte' ? (
        <Section titre={t('Texte')} cle="texte" data-studio-bloc-texte={elementId}>
          {parametresTexte ? (
            parametresTexte
          ) : (
            <Ligne libelle={t('Contenu')}>
              {/* Entrée va à la ligne : le retour est gardé tel quel, à l'aperçu comme à l'export. */}
              <ChampTexte long valeur={r.texte ?? (boite?.contenu ?? '').replace(/ *\n */g, '\n')} onValider={(v) => poser({ texte: v })} data-studio-retouche="texte" />
            </Ligne>
          )}
          <Ligne libelle={t('Police')}>
            <ChampPolice titre={t('Police')} valeur={policeLue} premiere={t('Celle du dessin')} onValider={(v) => poser({ police: v || null })} />
          </Ligne>
          <Ligne libelle={t('Graisse')}>
            <ChampChoix titre={t('Graisse')} valeur={graisse} options={Object.entries(graisses).map(([valeur, libelle]) => ({ valeur, libelle: `${libelle} · ${valeur}` }))} onValider={(v) => poser({ graisse: Number(v) })} data-studio-retouche="graisse" />
          </Ligne>
          <Ligne libelle={t('Taille')}>
            <ChampNombre valeur={r.taillePolice ?? Math.round(st?.taillePolice ?? 0)} pas={1} min={4} unite="px" onValider={(v) => poser({ taillePolice: v })} data-studio-retouche="taillePolice" />
          </Ligne>
          <Ligne libelle={t('Interligne')} className="gap-1">
            <ChampNombre valeur={r.interligne ?? st?.interligne ?? 1.2} pas={0.05} min={0.5} max={5} unite="×" aria-label="Interligne" title={t('Hauteur des lignes, en multiple de la taille des lettres')} onValider={(v) => poser({ interligne: v })} data-studio-retouche="interligne" />
            <ChampNombre valeur={r.espacementLettres ?? Math.round((st?.espacementLettres ?? 0) * 10) / 10} pas={0.5} unite="px" prefixe="↔" aria-label="Espacement des lettres" title={t('Espacement des lettres')} onValider={(v) => poser({ espacementLettres: v })} data-studio-retouche="espacementLettres" />
          </Ligne>
          <Ligne libelle={t('Style')} className="gap-0.5">
            <BoutonBascule
              actif={r.italique ?? !!st?.italique}
              libelle={t('Italique')}
              Icone={Italic}
              onBasculer={(v) => poser({ italique: v })}
              data-studio-retouche="italique"
            />
            <BoutonBascule
              actif={(r.decoration ?? (st?.decoration?.includes('underline') ? 'souligne' : '')) === 'souligne'}
              libelle={t('Souligné')}
              Icone={Underline}
              onBasculer={(v) => poser({ decoration: v ? 'souligne' : 'aucune' })}
              data-studio-retouche="souligne"
            />
            <BoutonBascule
              actif={(r.decoration ?? (st?.decoration?.includes('line-through') ? 'barre' : '')) === 'barre'}
              libelle={t('Barré')}
              Icone={Strikethrough}
              onBasculer={(v) => poser({ decoration: v ? 'barre' : 'aucune' })}
              data-studio-retouche="barre"
            />
            <span className="ml-1 min-w-0 flex-1">
              <ChampChoix
                titre={t('Casse')}
                valeur={r.casse ?? casseDe(st?.casse)}
                options={[
                  { valeur: 'aucune', libelle: t('Telle quelle') },
                  { valeur: 'majuscules', libelle: t('MAJUSCULES') },
                  { valeur: 'minuscules', libelle: t('minuscules') },
                  { valeur: 'capitales', libelle: t('Initiales En Capitale') },
                ]}
                onValider={(v) => poser({ casse: v })}
                data-studio-retouche="casse"
              />
            </span>
          </Ligne>
          <Ligne libelle={t('Alignement')} className="gap-1">
            <ChampBoutons
              valeur={r.alignement ?? alignementDe(st?.alignement)}
              options={[
                { valeur: 'gauche', libelle: t('Aligner à gauche'), Icone: AlignLeft },
                { valeur: 'centre', libelle: t('Centrer'), Icone: AlignCenter },
                { valeur: 'droite', libelle: t('Aligner à droite'), Icone: AlignRight },
                { valeur: 'justifie', libelle: t('Justifier'), Icone: AlignJustify },
              ]}
              onValider={(v) => poser({ alignement: v })}
              repere="studio-alignement"
              data-studio-retouche="alignement"
            />
            <span className="h-5 w-px shrink-0 bg-faint/30" aria-hidden />
            <ChampBoutons
              valeur={r.alignementVertical ?? verticalDe(st?.alignementVertical)}
              options={[
                { valeur: 'haut', libelle: t('En haut du cadre'), Icone: AlignVerticalJustifyStart },
                { valeur: 'milieu', libelle: t('Au milieu du cadre'), Icone: AlignVerticalJustifyCenter },
                { valeur: 'bas', libelle: t('En bas du cadre'), Icone: AlignVerticalJustifyEnd },
              ]}
              onValider={(v) => poser({ alignementVertical: v })}
              repere="studio-alignement-vertical"
              data-studio-retouche="alignementVertical"
            />
          </Ligne>
          <Ligne libelle={t('Couleur')}>
            <ChampCouleur transparence valeur={r.couleur ?? enCouleur(st?.couleur) ?? ''} onValider={(v) => poser({ couleur: v })} onApercu={montrer ? (v) => montrer({ couleur: v }) : undefined} data-studio-retouche="couleur" />
          </Ligne>
        </Section>
      ) : null}

      {/* UNE IMAGE : le média du projet qu'elle montre, et comment elle tient dans son cadre. */}
      {contenu === 'image' ? (
        <Section titre={t('Image')} cle="image" data-studio-bloc-image={elementId}>
          <Ligne libelle={t('Source')}>
            <ChampChoix titre={t('Source')} valeur={r.source ?? ''} options={[{ valeur: '', libelle: t('Celle du dessin') }, ...imagesDuProjet]} onValider={(v) => poser({ source: v || null })} data-studio-retouche="source" />
          </Ligne>
          <Ligne libelle={t('Cadrage')}>
            <ChampChoix
              titre={t('Cadrage')}
              valeur={r.cadrage ?? (st?.cadrage === 'contain' ? 'contenir' : 'couvrir')}
              options={[
                { valeur: 'couvrir', libelle: t('Remplir le cadre') },
                { valeur: 'contenir', libelle: t('Tout montrer') },
              ]}
              onValider={(v) => poser({ cadrage: v })}
              data-studio-retouche="cadrage"
            />
          </Ligne>
        </Section>
      ) : null}

      {/* LE CALQUE : son opacité, sa fusion avec ce qu'il y a dessous, et ce qui dépasse de son cadre. */}
      <Section titre={t('Calque')} cle="calque">
        <Ligne libelle={t('Opacité')}>
          <ChampNombre valeur={opacite} pas={1} min={0} max={100} unite="%" onValider={(v) => poser({ opacite: v / 100 })} data-studio-retouche="opacite" />
        </Ligne>
        {contenu ? (
          <>
            <Ligne libelle={t('Fusion')}>
              <ChampChoix titre={t('Mode de fusion')} valeur={r.fusion ?? (MODES_FUSION as readonly string[]).find((m) => m === st?.fusion) ?? 'normal'} options={MODES_FUSION.map((m) => ({ valeur: m, libelle: libelleFusion(m) }))} onValider={(v) => poser({ fusion: v })} data-studio-retouche="fusion" />
            </Ligne>
            <Ligne libelle={t('Rogner le contenu')}>
              <ChampBascule valeur={r.rogner ?? !!st?.rogner} onValider={(v) => poser({ rogner: v })} />
            </Ligne>
          </>
        ) : null}
      </Section>

      {/* LE REMPLISSAGE : couleur unie (transparence comprise, « aucune » possible) ou dégradé ; une forme SVG se remplit de sa couleur. */}
      {contenu ? (
        <Section titre={t('Remplissage')} cle="remplissage" data-studio-couleurs-piece={elementId}>
          {contenu === 'svg' ? (
            <Ligne libelle={t('Couleur')}>
              <ChampCouleur transparence valeur={r.couleur ?? enCouleur(st?.remplissage) ?? enCouleur(st?.couleur) ?? ''} onValider={(v) => poser({ couleur: v })} onApercu={montrer ? (v) => montrer({ couleur: v }) : undefined} data-studio-retouche="couleur" />
            </Ligne>
          ) : (
            <>
              <Ligne libelle={t('Couleur de fond')}>
                <ChampCouleur transparence valeur={fond} onValider={(v) => poser({ fond: v })} onApercu={montrer ? (v) => montrer({ fond: v }) : undefined} data-studio-retouche="fond" />
              </Ligne>
              <Ligne libelle={t('Dégradé')}>
                <ChampBascule
                  valeur={!!r.degrade}
                  onValider={(v) =>
                    poser({
                      degrade: v
                        ? { genre: 'lineaire', angle: 180, arrets: [{ couleur: lireCouleur(fond)?.alpha ? fond : '#ffffff', position: 0 }, { couleur: '#000000', position: 100 }] }
                        : null,
                    })
                  }
                />
              </Ligne>
              {r.degrade ? <ReglagesDuDegrade degrade={r.degrade} onValider={(d) => poser({ degrade: d })} onApercu={montrer ? (d) => montrer({ degrade: d }) : undefined} /> : null}
              {!r.degrade && st?.fondImage ? <p className="text-[12px] text-faint">{t('Le dessin pose déjà un dégradé : en régler un le remplace.')}</p> : null}
            </>
          )}
        </Section>
      ) : null}

      {/* LE CONTOUR : sa couleur, son épaisseur, où passe le trait (dedans, la pièce ne grossit pas) et son style. */}
      {contenu ? (
        <Section titre={t('Contour')} cle="contour">
          <Ligne libelle={t('Couleur')}>
            <ChampCouleur
              transparence
              valeur={couleurContour}
              onValider={(v) => poser({ contour: v, epaisseurContour: epaisseur || 4 })}
              onApercu={montrer ? (v) => montrer({ contour: v, epaisseurContour: epaisseur || 4 }) : undefined}
              data-studio-retouche="contour"
            />
          </Ligne>
          <Ligne libelle={t('Épaisseur')}>
            <ChampNombre valeur={epaisseur} pas={1} min={0} unite="px" onValider={(v) => poser({ epaisseurContour: v, contour: couleurContour })} data-studio-retouche="epaisseurContour" />
          </Ligne>
          <Ligne libelle={t('Position')}>
            <ChampChoix
              titre={t('Position du contour')}
              valeur={r.contourPosition ?? 'interieur'}
              options={[
                { valeur: 'interieur', libelle: t('Intérieur') },
                { valeur: 'centre', libelle: t('Centré') },
                { valeur: 'exterieur', libelle: t('Extérieur') },
              ]}
              onValider={(v) => poser({ contourPosition: v, epaisseurContour: epaisseur || 4, contour: couleurContour })}
              data-studio-retouche="contourPosition"
            />
          </Ligne>
          <Ligne libelle={t('Style')}>
            <ChampChoix
              titre={t('Style du contour')}
              valeur={r.contourStyle ?? (st?.contourStyle === 'dashed' ? 'tirets' : st?.contourStyle === 'dotted' ? 'pointilles' : 'plein')}
              options={[
                { valeur: 'plein', libelle: t('Plein') },
                { valeur: 'tirets', libelle: t('Tirets') },
                { valeur: 'pointilles', libelle: t('Pointillés') },
              ]}
              onValider={(v) => poser({ contourStyle: v, epaisseurContour: epaisseur || 4, contour: couleurContour })}
              data-studio-retouche="contourStyle"
            />
          </Ligne>
        </Section>
      ) : null}

      {/* LES MARGES : l'espace entre le cadre et son contenu (intérieures), et autour du cadre (extérieures). */}
      {contenu && contenu !== 'svg' ? (
        <Section titre={t('Marges')} cle="marges">
          <Ligne libelle={t('Intérieures')}>
            <ChampQuatre valeurs={r.marges ?? quatre(st?.marges)} lettres={['H', 'D', 'B', 'G']} libelles={[t('Marge du haut'), t('Marge de droite'), t('Marge du bas'), t('Marge de gauche')]} min={0} onValider={(q) => poser({ marges: q })} data-studio-retouche="marges" />
          </Ligne>
          <Ligne libelle={t('Extérieures')}>
            <ChampQuatre valeurs={r.margesExterieures ?? quatre(st?.margesExterieures)} lettres={['H', 'D', 'B', 'G']} libelles={[t('Marge du haut'), t('Marge de droite'), t('Marge du bas'), t('Marge de gauche')]} onValider={(q) => poser({ margesExterieures: q })} data-studio-retouche="margesExterieures" />
          </Ligne>
        </Section>
      ) : null}

      {/* LES EFFETS : autant d'ombres qu'on veut (portées, intérieures, ou celles des lettres), le flou de la pièce
          et celui de ce qu'il y a derrière elle. */}
      {contenu ? (
        <Section
          titre={t('Effets')}
          cle="effets"
          action={
            <Button
              size="icon"
              variant="ghost"
              aria-label="Ajouter une ombre"
              title={t('Ajouter une ombre')}
              disabled={ombres.length >= OMBRES_MAX}
              onClick={() => poserOmbres([...ombres, ombreNeuve(nature, fond)])}
              data-studio-ombre-ajouter=""
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          }
        >
          {!r.ombres && (st?.ombres || st?.ombresTexte) ? <p className="text-[12px] text-faint">{t('Le dessin pose déjà une ombre : en ajouter une la remplace.')}</p> : null}
          {ombres.map((o, i) => (
            <ReglagesDOmbre
              key={i}
              rang={i}
              ombre={o}
              texte={nature === 'texte'}
              onValider={(suivante) => poserOmbres(ombres.map((x, k) => (k === i ? suivante : x)))}
              onApercu={montrer ? (suivante) => montrer({ ombres: ombres.map((x, k) => (k === i ? suivante : x)) }) : undefined}
              onRetirer={() => poserOmbres(ombres.filter((_, k) => k !== i))}
            />
          ))}
          <Ligne libelle={t('Flou')}>
            <ChampNombre valeur={r.flou ?? 0} pas={1} min={0} unite="px" onValider={(v) => poser({ flou: v || null })} data-studio-retouche="flou" />
          </Ligne>
          <Ligne libelle={t('Flou derrière')}>
            <ChampNombre valeur={r.flouArrierePlan ?? 0} pas={1} min={0} unite="px" title={t('Floute ce qu’il y a derrière la pièce (verre dépoli) : à poser sur une pièce dont le fond est transparent.')} onValider={(v) => poser({ flouArrierePlan: v || null })} data-studio-retouche="flouArrierePlan" />
          </Ligne>
        </Section>
      ) : null}

      {parametres ? (
        <Section titre={t('Réglages de l’agent')} cle="parametres-piece">
          {parametres}
        </Section>
      ) : null}
    </>
  );
}

/** Un bouton qui s'enfonce (italique, souligné, barré). */
function BoutonBascule({
  actif,
  libelle,
  Icone,
  onBasculer,
  ...reste
}: {
  actif: boolean;
  libelle: string;
  Icone: React.ComponentType<{ className?: string }>;
  onBasculer: (v: boolean) => void;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <button
      type="button"
      aria-pressed={actif}
      aria-label={libelle}
      title={libelle}
      onClick={(e) => {
        e.preventDefault();
        onBasculer(!actif);
      }}
      className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted hover:bg-raised/60 hover:text-text', actif && 'bg-accent/15 text-text')}
      {...reste}
    >
      <Icone className="h-3.5 w-3.5" />
    </button>
  );
}

/** UNE OMBRE : son genre, son décalage, son flou, son étalement et sa couleur (transparence comprise). */
function ReglagesDOmbre({
  rang,
  ombre,
  texte,
  onValider,
  onApercu,
  onRetirer,
}: {
  rang: number;
  ombre: OmbrePiece;
  texte: boolean;
  onValider: (o: OmbrePiece) => void;
  onApercu?: (o: OmbrePiece) => void;
  onRetirer: () => void;
}) {
  const genres = [
    { valeur: 'portee', libelle: t('Ombre portée') },
    { valeur: 'interieure', libelle: t('Ombre intérieure') },
    ...(texte || ombre.genre === 'texte' ? [{ valeur: 'texte', libelle: t('Ombre des lettres') }] : []),
  ];
  return (
    <>
      <Ligne libelle={t('Ombre {n}', { n: rang + 1 })} className="gap-1">
        <span className="min-w-0 flex-1" data-studio-ombre={rang}>
          <ChampChoix titre={t('Genre d’ombre')} valeur={ombre.genre} options={genres} onValider={(v) => onValider({ ...ombre, genre: v as OmbrePiece['genre'] })} />
        </span>
        <Button size="icon" variant="ghost" aria-label="Retirer l’ombre" title={t('Retirer l’ombre')} onClick={onRetirer} data-studio-ombre-retirer={rang}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </Ligne>
      <ChampQuatre
        valeurs={[ombre.x, ombre.y, ombre.flou, ombre.etalement]}
        lettres={['X', 'Y', '◌', '±']}
        libelles={[t('Décalage horizontal'), t('Décalage vertical'), t('Flou'), t('Étalement')]}
        onValider={([x, y, flou, etalement]) => onValider({ ...ombre, x, y, flou: Math.max(0, flou), etalement })}
        data-studio-ombre-valeurs={String(rang)}
      />
      <ChampCouleur transparence valeur={ombre.couleur} onValider={(couleur) => onValider({ ...ombre, couleur })} onApercu={onApercu ? (couleur) => onApercu({ ...ombre, couleur }) : undefined} data-studio-ombre-couleur={rang} />
    </>
  );
}

/** UN DÉGRADÉ : linéaire (avec son angle) ou radial, et ses deux couleurs d'extrémité. */
function ReglagesDuDegrade({ degrade, onValider, onApercu }: { degrade: Degrade; onValider: (d: Degrade) => void; onApercu?: (d: Degrade) => void }) {
  const couleur = (i: number) => degrade.arrets[i === 0 ? 0 : degrade.arrets.length - 1]!;
  const avec = (i: number, c: string): Degrade => ({
    ...degrade,
    arrets: degrade.arrets.map((a, k) => (k === (i === 0 ? 0 : degrade.arrets.length - 1) ? { ...a, couleur: c } : a)),
  });
  return (
    <>
      <Ligne libelle={t('Genre')} className="gap-1">
        <span className="min-w-0 flex-1">
          <ChampChoix
            titre={t('Genre de dégradé')}
            valeur={degrade.genre}
            options={[
              { valeur: 'lineaire', libelle: t('Linéaire') },
              { valeur: 'radial', libelle: t('Radial') },
            ]}
            onValider={(v) => onValider({ ...degrade, genre: v === 'radial' ? 'radial' : 'lineaire' })}
            data-studio-degrade-genre=""
          />
        </span>
        {degrade.genre === 'lineaire' ? (
          <span className="w-[4.5rem] shrink-0">
            <ChampNombre valeur={degrade.angle} pas={15} unite="°" aria-label="Angle du dégradé" title={t('Angle du dégradé')} onValider={(angle) => onValider({ ...degrade, angle })} data-studio-degrade-angle="" />
          </span>
        ) : null}
      </Ligne>
      <Ligne libelle={t('Départ')}>
        <ChampCouleur transparence valeur={couleur(0).couleur} onValider={(c) => onValider(avec(0, c))} onApercu={onApercu ? (c) => onApercu(avec(0, c)) : undefined} data-studio-degrade-couleur="0" />
      </Ligne>
      <Ligne libelle={t('Arrivée')}>
        <ChampCouleur transparence valeur={couleur(1).couleur} onValider={(c) => onValider(avec(1, c))} onApercu={onApercu ? (c) => onApercu(avec(1, c)) : undefined} data-studio-degrade-couleur="1" />
      </Ligne>
    </>
  );
}

/** `align-content` calculé → l'alignement vertical de la retouche. */
function verticalDe(css: string | undefined): AlignementVertical {
  if (css === 'center') return 'milieu';
  if (css === 'end' || css === 'flex-end') return 'bas';
  return 'haut';
}

/** `text-transform` calculé → la casse de la retouche. */
function casseDe(css: string | undefined): CasseTexte {
  if (css === 'uppercase') return 'majuscules';
  if (css === 'lowercase') return 'minuscules';
  if (css === 'capitalize') return 'capitales';
  return 'aucune';
}

/** Les modes de fusion, nommés comme dans Figma. */
function libelleFusion(m: ModeFusion): string {
  const noms: Record<ModeFusion, string> = {
    normal: t('Normal'),
    multiply: t('Produit'),
    darken: t('Obscurcir'),
    'color-burn': t('Densité couleur +'),
    screen: t('Superposition claire'),
    lighten: t('Éclaircir'),
    'color-dodge': t('Densité couleur −'),
    overlay: t('Incrustation'),
    'soft-light': t('Lumière tamisée'),
    'hard-light': t('Lumière crue'),
    difference: t('Différence'),
    exclusion: t('Exclusion'),
    hue: t('Teinte'),
    saturation: t('Saturation'),
    color: t('Couleur'),
    luminosity: t('Luminosité'),
  };
  return noms[m];
}

/**
 * LES CALQUES D'UN DESSIN : chaque pièce composée par l'agent (`data-studio-id`),
 * du premier plan vers l'arrière, imbriquées sous leur pièce parente. Un clic la
 * choisit (dans l'aperçu aussi) et ouvre son détail ; l'œil la masque ; les
 * flèches la font avancer ou reculer d'un plan parmi ses voisines. Tout est une
 * RETOUCHE : la donnée survit au redessin tant que la pièce garde son nom.
 *
 * TOUTE LA SCÈNE RESTE LISTÉE, mais la pièce choisie (dans l'aperçu comme ici)
 * se voit d'un coup d'œil : surlignée, amenée dans la zone visible, ses parents
 * gardés nets et toutes les autres pièces atténuées.
 */
export function Calques({
  segment,
  elementId,
  format,
  formatDeBase,
  onOperation,
  onChoisirPiece,
  onOuvrirEditeur,
}: {
  segment: SegmentDessin;
  elementId: string | null;
  format: FormatStudio;
  formatDeBase: FormatStudio;
  onOperation: (op: OperationStudio) => unknown;
  onChoisirPiece: (elementId: string | null) => void;
  /** Le DOUBLE-CLIC sur une pièce : elle se choisit et la fenêtre d'édition s'ouvre sur elle. */
  onOuvrirEditeur?: (elementId: string) => void;
}) {
  const pieces = React.useMemo(() => piecesDuDessin(segment.gabarit.html), [segment.gabarit.html]);
  const retouches = retouchesDuFormat(segment, format, formatDeBase);
  const liste = React.useRef<HTMLElement | null>(null);
  // LA PIÈCE CHOISIE VIENT À L'ÉCRAN, d'où que vienne le choix (aperçu, calques, fenêtre d'édition).
  React.useEffect(() => {
    if (!elementId) return;
    const ligne = liste.current?.querySelector<HTMLElement>(`[data-studio-calque="${CSS.escape(elementId)}"]`);
    ligne?.scrollIntoView({ block: 'nearest' });
  }, [elementId, segment.id]);
  if (!pieces.length) return null;
  // La branche de la pièce choisie : elle et ses parents restent nets, le reste s'atténue.
  const branche = new Set<string>();
  for (let id: string | undefined = elementId ?? undefined; id; id = pieces.find((p) => p.id === id)?.parent) branche.add(id);
  const plan = (id: string) => retouches[id]?.plan ?? 0;
  // L'ordre RÉEL de peinture parmi des sœurs : le plan d'abord, puis l'ordre du dessin ; on montre l'avant en haut.
  const enfants = (parent: string | undefined) =>
    pieces.filter((p) => p.parent === parent).sort((a, b) => plan(b.id) - plan(a.id) || b.rang - a.rang);
  const lignes: { id: string; profondeur: number }[] = [];
  const parcourir = (parent: string | undefined, profondeur: number) => {
    for (const p of enfants(parent)) {
      lignes.push({ id: p.id, profondeur });
      parcourir(p.id, profondeur + 1);
    }
  };
  parcourir(undefined, 0);
  const poser = (id: string, r: Retouche) => onOperation({ op: 'retouche', segmentId: segment.id, elementId: id, retouche: r, format });
  return (
    <section ref={liste} className="flex flex-col gap-1 rounded-md bg-bloc px-2 py-2.5" data-studio-calques={segment.id}>
      <header className="flex items-center gap-2 px-1 pb-0.5">
        <Layers className="h-3.5 w-3.5 text-faint" />
        <h3 className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-text">{t('Calques')}</h3>
        <span className="text-[11.5px] text-faint">{pieces.length}</span>
      </header>
      {lignes.map(({ id, profondeur }) => {
        const piece = pieces.find((p) => p.id === id)!;
        const r = retouches[id] ?? {};
        const choisie = elementId === id;
        const attenuee = !!elementId && !branche.has(id);
        return (
          <div
            key={id}
            className={cn(
              'group flex min-h-8 items-center gap-1 rounded-md pr-1 text-[12.5px] transition-[background-color,opacity]',
              choisie ? 'bg-accent/15 text-text shadow-[inset_3px_0_0_hsl(var(--accent))]' : 'text-muted hover:bg-raised/60',
              attenuee && 'opacity-45 hover:opacity-100',
            )}
            style={{ paddingLeft: 6 + profondeur * 14 }}
            data-studio-calque={id}
            data-choisi={choisie ? 'oui' : attenuee ? 'attenue' : 'branche'}
            data-masque={r.masquee ? 'oui' : 'non'}
            aria-current={choisie ? 'true' : undefined}
          >
            <button
              type="button"
              aria-label={r.masquee ? `Afficher « ${id} »` : `Masquer « ${id} »`}
              title={r.masquee ? t('Afficher « {nom} »', { nom: id }) : t('Masquer « {nom} »', { nom: id })}
              onClick={() => poser(id, { masquee: !r.masquee })}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-faint hover:text-text"
              data-studio-calque-oeil={id}
            >
              {r.masquee ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={(e) => {
                // Le second clic d'un double-clic ne désélectionne pas la pièce qu'il ouvre.
                if (e.detail > 1) return;
                onChoisirPiece(choisie ? null : id);
              }}
              onDoubleClick={() => onOuvrirEditeur?.(id)}
              className={cn('min-w-0 flex-1 truncate text-left', r.masquee && 'line-through opacity-60')} data-studio-calque-choisir={id}>
              <span className={cn('text-text', choisie && 'font-semibold')}>{id}</span>
              <span className="text-faint">
                {' '}
                · {piece.balise}
                {piece.texte ? ` · « ${piece.texte} »` : ''}
              </span>
            </button>
            {plan(id) ? <span className="shrink-0 text-[11px] tabular-nums text-faint" title={t('Plan')}>{plan(id) > 0 ? `+${plan(id)}` : plan(id)}</span> : null}
            <button
              type="button"
              aria-label="Avancer d’un plan"
              title={t('Avancer d’un plan')}
              onClick={() => poser(id, { plan: plan(id) + 1 })}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-faint hover:text-text"
              data-studio-calque-avancer={id}
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="Reculer d’un plan"
              title={t('Reculer d’un plan')}
              onClick={() => poser(id, { plan: plan(id) - 1 })}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-faint hover:text-text"
              data-studio-calque-reculer={id}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </section>
  );
}

/** L'ancre sans l'axe qu'on vient de placer à la main (`null` : plus d'ancre du tout, effacée par l'opération). */
function sansAxe(ancre: AncrePiece | undefined, axe: 'h' | 'v'): AncrePiece {
  if (!ancre) return null as unknown as AncrePiece;
  const reste = { ...ancre };
  delete reste[axe];
  return (reste.h || reste.v ? reste : null) as AncrePiece;
}

/** Le repère où une pièce est collée, en mots : « coin haut droit », « centre », « marge du bas »… */
function nomDeLAncre(a: AncrePiece): string {
  const marge = a.h?.startsWith('marge') || a.v?.startsWith('marge');
  const h = a.h === 'gauche' || a.h === 'marge-gauche' ? 'g' : a.h === 'droite' || a.h === 'marge-droite' ? 'd' : a.h === 'centre' ? 'c' : '';
  const v = a.v === 'haut' || a.v === 'marge-haut' ? 'h' : a.v === 'bas' || a.v === 'marge-bas' ? 'b' : a.v === 'centre' ? 'c' : '';
  const nom =
    h === 'c' && v === 'c' ? t('centre')
    : h === 'g' && v === 'h' ? t('coin haut gauche')
    : h === 'd' && v === 'h' ? t('coin haut droit')
    : h === 'g' && v === 'b' ? t('coin bas gauche')
    : h === 'd' && v === 'b' ? t('coin bas droit')
    : h === 'c' && v === 'h' ? t('milieu du haut')
    : h === 'c' && v === 'b' ? t('milieu du bas')
    : h === 'g' && v === 'c' ? t('milieu de gauche')
    : h === 'd' && v === 'c' ? t('milieu de droite')
    : h === 'g' ? t('bord gauche')
    : h === 'd' ? t('bord droit')
    : h === 'c' ? t('centre (horizontal)')
    : v === 'h' ? t('bord du haut')
    : v === 'b' ? t('bord du bas')
    : t('centre (vertical)');
  return marge ? t('{repere}, marge de sécurité', { repere: nom }) : nom;
}

/**
 * LES RÉGLAGES DE LA CRÉATION ENTIÈRE — fond et durée voulue. Ils vivaient dans
 * le volet « Réglages » sans sélection ; le volet de droite ne portant plus que
 * la conversation, ils se tiennent aussi en tête du volet « Style ».
 */
export function ReglagesDeComposition({
  composition,
  onOperation,
}: {
  composition: Composition;
  onOperation: (op: OperationStudio) => unknown;
}) {
  return (
    <Section titre={t('Composition')}>
      <Ligne libelle={t('Fond')}>
        <ChampCouleur valeur={composition.fond} onValider={(v) => onOperation({ op: 'composition', fond: v })} />
      </Ligne>
      <Ligne libelle={t('Durée voulue')}>
        <ChampNombre
          valeur={composition.dureeVoulue ?? dureeDeLaComposition(composition)}
          unite="s"
          min={0.5}
          onValider={(v) => onOperation({ op: 'composition', dureeVoulue: v })}
          data-studio-duree-voulue
        />
      </Ligne>
      <p className="text-[12px] text-faint">{t('Le marqueur bleu de la ligne de temps : la vidéo s’arrête là, à l’aperçu comme à l’export.')}</p>
    </Section>
  );
}
