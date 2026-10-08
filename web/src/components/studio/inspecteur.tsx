import * as React from 'react';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, ChevronDown, ChevronUp, Copy, Eraser, Eye, EyeOff, Layers, Magnet, Scissors, Trash2 } from 'lucide-react';
import {
  type Composition,
  type FormatStudio,
  type MediaStudio,
  type OperationStudio,
  type AncrePiece,
  type Retouche,
  type Segment,
  type SegmentDessin,
  dureeDeLaComposition,
  piecesDuDessin,
  RECETTES_ANIMATION,
  retouchesDuFormat,
  trouverSegment,
} from '@beluga/shared';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import { formatRegional, t } from '@/lib/langue';
import { BlocRepliable, ChampBascule, ChampChoix, ChampCouleur, ChampCurseur, ChampNombre, ChampPolice, ChampTexte, Ligne, Section } from './champs';
import { ApercuEnDirect, type BoiteDuCadre, type NaturePiece, alignementDe, enHexa } from './apercu';
import { libelleDuGenre, libelleEtatVoix, libelleRecette } from './libelles';
import { actionDEcoute, useEcouteDesVoix } from './panneaux';
import { iconeDeRecette } from './ligne-de-temps';

/**
 * L'INSPECTEUR : ce qui se règle sur ce qu'on a cliqué.
 *
 * UNE PIÈCE CHOISIE (dans l'aperçu ou les calques) passe EN TÊTE, avec ses
 * seuls vrais réglages : un texte a son texte (s'il n'est pas découpé en mots
 * animés), sa taille de lettres, sa couleur et son alignement ; toute pièce a
 * son cadre (largeur, hauteur). Viennent ensuite SES COULEURS — fond (ou
 * remplissage d'un SVG), contour, arrondi — puis toute la scène, DÉPLIÉE (nom,
 * temps, entrée, sortie, couleurs et autres paramètres du dessin). Chaque
 * valeur part de ce que la page affiche (styles calculés envoyés par
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
  const pieceDuDessin = s.genre === 'dessin' && elementId ? piecesDuDessin(s.gabarit.html).find((p) => p.id === elementId) : undefined;
  const parametresDeLaPiece = pieceDuDessin?.parametres ?? [];
  const pieceVisee = !!elementId && s.genre !== 'audio' && s.genre !== 'voix';
  // Un DESSIN dont une pièce est choisie : la scène entière se replie sous elle.
  const sceneRepliee = pieceVisee && s.genre === 'dessin';

  const scene = (
    <>
      <Section
        titre={`${libelleDuGenre(s.genre)}${s.nom ? ` — ${s.nom}` : ''}`}
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
      <ReglagesDuGenre segment={s} medias={medias} voixEssai={voixEssai} prop={prop} onOperation={onOperation} onVoixEssai={onVoixEssai} exclure={sceneRepliee ? parametresDeLaPiece : []} />
    </>
  );

  return (
    <div className="flex flex-col gap-2" data-studio-inspecteur={s.genre}>
      {pieceVisee ? (
        <RetouchesDeLaPiece
          segment={s}
          elementId={elementId!}
          format={format}
          formatDeBase={composition.format}
          onOperation={onOperation}
          boite={boite}
          // Le texte, la couleur et le cadre d'un texte, d'une forme ou d'un SVG ne se règlent que dans un dessin : ailleurs, le segment les porte déjà.
          reglagesDuContenu={s.genre === 'dessin'}
          parametres={
            s.genre === 'dessin' && parametresDeLaPiece.length ? (
              <ParametresDuDessin segment={s} medias={medias} onOperation={onOperation} ids={parametresDeLaPiece} />
            ) : null
          }
        />
      ) : null}

      {s.genre === 'dessin' && !calquesAilleurs ? (
        <Calques segment={s} elementId={elementId} format={format} formatDeBase={composition.format} onOperation={onOperation} onChoisirPiece={onChoisirPiece} />
      ) : null}

      {sceneRepliee ? (
        <BlocRepliable key={s.id} titre={t('Toute la scène « {nom} »', { nom: s.nom || libelleDuGenre(s.genre) })} ouvertParDefaut data-studio-scene="">
          {scene}
        </BlocRepliable>
      ) : (
        scene
      )}
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
                <ChampCouleur valeur={String(v)} onValider={poser} onApercu={direct ? (c) => direct({ segmentId: s.id, variable: p.id, valeur: c }) : undefined} data-studio-parametre={p.id} />
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
                <ChampTexte valeur={String(v)} onValider={poser} data-studio-parametre={p.id} />
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
  /** Les paramètres déjà montrés avec la pièce choisie. */
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
        <Section titre={exclure.length ? t('Autres réglages de la scène') : t('Réglages du dessin')}>
          <ParametresDuDessin segment={s} medias={medias} onOperation={onOperation} exclure={exclure} />
        </Section>
      );
    }
    case 'texte':
      return (
        <Section titre={t('Texte')}>
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
        <Section titre={s.genre === 'image' ? t('Image') : t('Vidéo')}>
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
        <Section titre={t('Son')}>
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
        <Section titre={t('Voix')} action={<span className="text-[12px] text-muted" data-studio-etat-voix={s.etat}>{libelleEtatVoix(s.etat)}</span>}>
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
        <Section titre={t('Sous-titres')}>
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

function RetouchesDeLaPiece({
  segment,
  elementId,
  format,
  formatDeBase,
  onOperation,
  boite,
  reglagesDuContenu,
  parametres,
}: {
  segment: Segment;
  elementId: string;
  format: FormatStudio;
  formatDeBase: FormatStudio;
  onOperation: (op: OperationStudio) => unknown;
  /** Ce que l'aperçu dit de la pièce : sa nature et ses styles réels (absent : pas encore reçu). */
  boite: BoiteDuCadre | null;
  /** Texte, couleur et cadre : seulement pour une pièce de dessin. */
  reglagesDuContenu: boolean;
  /** Les paramètres de l'agent posés sur cette pièce. */
  parametres: React.ReactNode;
}) {
  const r: Retouche = retouchesDuFormat(segment, format, formatDeBase)[elementId] ?? {};
  const poser = (retouche: Retouche) => onOperation({ op: 'retouche', segmentId: segment.id, elementId, retouche, format });
  const direct = React.useContext(ApercuEnDirect);
  /** Montrer une couleur dans l'aperçu PENDANT le choix ; elle ne part qu'une fois choisie. */
  const montrer = (retouche: Retouche) => direct?.({ segmentId: segment.id, elementId, retouche });
  const nature = boite?.nature;
  const st = boite?.styles ?? null;
  const contenu = reglagesDuContenu ? nature : undefined;
  const epaisseur = r.epaisseurContour ?? Math.round(st?.epaisseurContour ?? 0);
  return (
    <>
      <Section
        titre={t('{nature} « {nom} »', { nature: libelleDeNature(nature), nom: elementId })}
        data-studio-piece={elementId}
        data-studio-nature={nature ?? ''}
        action={
          <Button size="icon" variant="ghost" aria-label="Effacer la retouche" title={t('Remettre comme à l’origine')} onClick={() => onOperation({ op: 'effacer-retouche', segmentId: segment.id, elementId, format })}>
            <Eraser className="h-3.5 w-3.5" />
          </Button>
        }
      >
        {format !== formatDeBase ? <p className="text-[12px] text-faint">{t('Ces retouches ne valent que pour ce format.')}</p> : null}
        <Ligne libelle={t('Visible')}>
          <ChampBascule valeur={!r.masquee} onValider={(v) => poser({ masquee: !v })} />
        </Ligne>

        {contenu === 'texte' ? (
          <>
            {/* UNE PHRASE DÉCOUPÉE EN MOTS ANIMÉS ne se réécrit pas ici : l'écriture remplacerait ses mots par un seul texte. */}
            {boite?.ecrivable ? (
              <Ligne libelle={t('Texte')}>
                {/* Entrée va à la ligne : le retour est gardé tel quel, à l'aperçu comme à l'export. */}
                <ChampTexte long valeur={r.texte ?? boite?.contenu ?? ''} onValider={(v) => poser({ texte: v })} data-studio-retouche="texte" />
              </Ligne>
            ) : null}
            <Ligne libelle={t('Taille du texte')}>
              <ChampNombre valeur={r.taillePolice ?? Math.round(st?.taillePolice ?? 0)} pas={1} min={4} unite="px" onValider={(v) => poser({ taillePolice: v })} data-studio-retouche="taillePolice" />
            </Ligne>
            <Ligne libelle={t('Couleur du texte')}>
              <ChampCouleur
                valeur={r.couleur ?? enHexa(st?.couleur) ?? ''}
                onValider={(v) => poser({ couleur: v })}
                onApercu={direct ? (v) => montrer({ couleur: v }) : undefined}
                data-studio-retouche="couleur"
              />
            </Ligne>
            <Ligne libelle={t('Alignement')}>
              <ChampAlignement valeur={r.alignement ?? alignementDe(st?.alignement)} onValider={(v) => poser({ alignement: v })} />
            </Ligne>
          </>
        ) : null}

        {nature ? (
          <>
            <Ligne libelle={t('Largeur du cadre')}>
              <ChampNombre valeur={r.largeur ?? Math.round(st?.largeur ?? 0)} pas={1} min={4} unite="px" onValider={(v) => poser({ largeur: v })} data-studio-retouche="largeur" />
            </Ligne>
            <Ligne libelle={t('Hauteur du cadre')}>
              <ChampNombre valeur={r.hauteur ?? Math.round(st?.hauteur ?? 0)} pas={1} min={4} unite="px" onValider={(v) => poser({ hauteur: v })} data-studio-retouche="hauteur" />
            </Ligne>
          </>
        ) : null}

        {parametres}

        {r.ancre ? (
          <Ligne libelle={t('Collée à')}>
            <span className="flex min-w-0 items-center gap-1 text-[12.5px]" data-studio-ancre={`${r.ancre.h ?? ''}|${r.ancre.v ?? ''}`}>
              <Magnet className="h-3.5 w-3.5 shrink-0 text-accent" />
              <span className="min-w-0 truncate">{nomDeLAncre(r.ancre)}</span>
            </span>
          </Ligne>
        ) : null}
        {/* UNE POSITION TAPÉE est un placement libre, au pixel : l'axe touché quitte son repère. */}
        <Ligne libelle={t('Décalage gauche')}>
          <ChampNombre valeur={r.x ?? 0} pas={1} unite="px" onValider={(v) => poser({ x: v, ancre: sansAxe(r.ancre, 'h') })} data-studio-retouche="x" />
        </Ligne>
        <Ligne libelle={t('Décalage haut')}>
          <ChampNombre valeur={r.y ?? 0} pas={1} unite="px" onValider={(v) => poser({ y: v, ancre: sansAxe(r.ancre, 'v') })} data-studio-retouche="y" />
        </Ligne>
        <Ligne libelle={t('Échelle')}>
          <ChampCurseur valeur={r.echelle ?? 1} min={0.1} max={4} pas={0.05} onValider={(v) => poser({ echelle: v })} />
        </Ligne>
        <Ligne libelle={t('Rotation')}>
          <ChampCurseur valeur={r.rotation ?? 0} min={-180} max={180} pas={1} onValider={(v) => poser({ rotation: v })} />
        </Ligne>
        <Ligne libelle={t('Opacité')}>
          <ChampCurseur valeur={r.opacite ?? 1} min={0} max={1} pas={0.05} onValider={(v) => poser({ opacite: v })} />
        </Ligne>
      </Section>

      {/* SES COULEURS : fond (ou remplissage d'un SVG), contour et arrondi — sur toute pièce d'un dessin, logo et groupe compris. */}
      {contenu ? (
        <Section titre={t('Couleurs de la pièce')} data-studio-couleurs-piece={elementId}>
          {contenu === 'svg' ? (
            <Ligne libelle={t('Remplissage')}>
              <ChampCouleur
                valeur={r.couleur ?? enHexa(st?.remplissage) ?? enHexa(st?.couleur) ?? ''}
                onValider={(v) => poser({ couleur: v })}
                onApercu={direct ? (v) => montrer({ couleur: v }) : undefined}
                data-studio-retouche="couleur"
              />
            </Ligne>
          ) : (
            <Ligne libelle={t('Couleur de fond')}>
              <ChampCouleur
                valeur={r.fond ?? enHexa(st?.fond) ?? ''}
                onValider={(v) => poser({ fond: v })}
                onApercu={direct ? (v) => montrer({ fond: v }) : undefined}
                data-studio-retouche="fond"
              />
            </Ligne>
          )}
          <Ligne libelle={t('Contour')}>
            <ChampCouleur
              valeur={r.contour ?? enHexa(st?.contour) ?? '#000000'}
              onValider={(v) => poser({ contour: v, epaisseurContour: epaisseur || 4 })}
              onApercu={direct ? (v) => montrer({ contour: v, epaisseurContour: epaisseur || 4 }) : undefined}
              data-studio-retouche="contour"
            />
          </Ligne>
          <Ligne libelle={t('Épaisseur du contour')}>
            <ChampNombre valeur={epaisseur} pas={1} min={0} unite="px" onValider={(v) => poser({ epaisseurContour: v, contour: r.contour ?? enHexa(st?.contour) ?? '#000000' })} data-studio-retouche="epaisseurContour" />
          </Ligne>
          <Ligne libelle={t('Arrondi')}>
            <ChampNombre valeur={r.arrondi ?? Math.round(st?.arrondi ?? 0)} pas={1} min={0} unite="px" onValider={(v) => poser({ arrondi: v })} data-studio-retouche="arrondi" />
          </Ligne>
        </Section>
      ) : null}
    </>
  );
}

/** LES QUATRE ALIGNEMENTS d'un texte dans son cadre. */
function ChampAlignement({ valeur, onValider }: { valeur: NonNullable<Retouche['alignement']>; onValider: (v: NonNullable<Retouche['alignement']>) => void }) {
  const choix = [
    { cle: 'gauche', libelle: t('Aligner à gauche'), Icone: AlignLeft },
    { cle: 'centre', libelle: t('Centrer'), Icone: AlignCenter },
    { cle: 'droite', libelle: t('Aligner à droite'), Icone: AlignRight },
    { cle: 'justifie', libelle: t('Justifier'), Icone: AlignJustify },
  ] as const;
  return (
    <span className="flex items-center gap-0.5" data-studio-retouche="alignement" data-valeur={valeur}>
      {choix.map((c) => (
        <Button
          key={c.cle}
          size="icon"
          variant={valeur === c.cle ? 'subtle' : 'ghost'}
          aria-pressed={valeur === c.cle}
          aria-label={c.libelle}
          title={c.libelle}
          onClick={(e) => {
            e.preventDefault();
            onValider(c.cle);
          }}
          data-studio-alignement={c.cle}
        >
          <c.Icone className="h-3.5 w-3.5" />
        </Button>
      ))}
    </span>
  );
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
