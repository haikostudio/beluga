import * as THREE from 'three';
import type { AngleDeVue, DirectionDeLumiere } from '@beluga/shared';

/**
 * LA SCÈNE DU CUBE (« Autres angles » et « Changer la lumière », décision du
 * 26/10/2026, captures #129c et #8c9bf) — three.js seul, sans React.
 *
 * Un cube en arêtes fines, un mannequin au centre (tête, nez et yeux pour lire
 * où il regarde, buste, bras, jambes — des formes simples, aucun fichier 3D
 * tiers), vu par un observateur FIXE de trois quarts haut. Deux usages :
 *  - « angle » : une petite caméra (violette) tourne autour du mannequin et
 *    le vise ; les angles nommés sont des points gris posés dans le cube ;
 *  - « lumière » : une source (violette) éclaire et ombre le mannequin en
 *    direct, ombre portée au sol ; un modèle à directions fixes y marque ses
 *    directions.
 *
 * LE REPÈRE EST CELUI DES RÈGLES PARTAGÉES (`shared/src/retouches-de-media.ts`).
 * Le mannequin regarde +z, vers la caméra de l'image. Lumière : azimut 0 = de
 * face, 90 = de la DROITE DE L'IMAGE (+x), 180 = contre-jour ; élévation
 * positive = d'en haut. Angle : rotation 0 = de face, 90 = côté DROIT DU
 * SUJET (-x), hauteur positive = caméra haute.
 *
 * L'image se redessine À LA DEMANDE (un changement, une animation), jamais en
 * boucle : rien ne tourne quand on ne touche à rien. `liberer()` rend le
 * contexte graphique (le navigateur en limite le nombre).
 */

export type ModeDeLaScene = 'angle' | 'lumiere';

export interface CouleursDeLaScene {
  texte: THREE.ColorRepresentation;
  faible: THREE.ColorRepresentation;
  fond: THREE.ColorRepresentation;
  teinte: THREE.ColorRepresentation;
}

/** Le centre visé : la hauteur de la poitrine du mannequin. */
const CENTRE = new THREE.Vector3(0, 1.15, 0);
/** Le demi-côté du cube. */
const DEMI = 1.5;
/** Le rayon des points (angles nommés, directions) et de la caméra au cadrage moyen. */
const RAYON = 1.32;

const rad = (d: number) => (d * Math.PI) / 180;

/** La position d'une caméra d'angle : rayon selon le cadrage (0 = très large, 10 = très serré). */
export function positionDeLaCamera(a: AngleDeVue): THREE.Vector3 {
  const r = RAYON * (1.12 - (Math.min(10, Math.max(0, a.zoom)) / 10) * 0.5);
  const h = rad(a.horizontal);
  const v = rad(a.vertical);
  return new THREE.Vector3(-Math.sin(h) * Math.cos(v) * r, Math.sin(v) * r, Math.cos(h) * Math.cos(v) * r).add(CENTRE);
}

/** La position d'une source de lumière. */
export function positionDeLaLumiere(d: DirectionDeLumiere, rayon = RAYON): THREE.Vector3 {
  const a = rad(d.azimut);
  const e = rad(d.elevation);
  return new THREE.Vector3(Math.cos(e) * Math.sin(a) * rayon, Math.sin(e) * rayon, Math.cos(e) * Math.cos(a) * rayon).add(CENTRE);
}

export class SceneDuMannequin {
  private readonly rendu: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly observateur = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
  private readonly aJeter: { dispose: () => void }[] = [];
  private readonly matieres: { corps: THREE.MeshStandardMaterial; arete: THREE.LineBasicMaterial; point: THREE.MeshBasicMaterial; choisi: THREE.MeshBasicMaterial; trait: THREE.LineBasicMaterial; teinte: THREE.MeshStandardMaterial };
  private readonly points = new THREE.Group();
  private readonly camera = new THREE.Group();
  private readonly trait: THREE.Line;
  private readonly source?: THREE.Mesh;
  private readonly lumiere?: THREE.DirectionalLight;
  private image = 0;

  constructor(
    private readonly toile: HTMLCanvasElement,
    private readonly mode: ModeDeLaScene,
    couleurs: CouleursDeLaScene,
  ) {
    this.rendu = new THREE.WebGLRenderer({ canvas: toile, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.rendu.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.rendu.shadowMap.enabled = mode === 'lumiere';
    this.rendu.shadowMap.type = THREE.PCFSoftShadowMap;

    this.matieres = {
      corps: this.garder(new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0 })),
      arete: this.garder(new THREE.LineBasicMaterial({ transparent: true, opacity: 0.55 })),
      point: this.garder(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.7 })),
      choisi: this.garder(new THREE.MeshBasicMaterial()),
      trait: this.garder(new THREE.LineBasicMaterial({ transparent: true, opacity: 0.6 })),
      teinte: this.garder(new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.1, emissiveIntensity: mode === 'lumiere' ? 1.4 : 0.25 })),
    };

    /* L'observateur, fixe, de trois quarts haut : on voit la caméra (ou la lumière) ET le mannequin. */
    this.observateur.position.set(3.9, 3.2, 5.5);
    this.observateur.lookAt(new THREE.Vector3(0, 1.4, 0));

    /* Le cube : ses arêtes seules. */
    const cube = this.garder(new THREE.EdgesGeometry(this.garder(new THREE.BoxGeometry(DEMI * 2, DEMI * 2, DEMI * 2))));
    const aretes = new THREE.LineSegments(cube, this.matieres.arete);
    aretes.position.set(0, DEMI, 0);
    this.scene.add(aretes);

    /* Le sol : il reçoit l'ombre en mode lumière, il pose le mannequin en mode angle. */
    const sol = new THREE.Mesh(
      this.garder(new THREE.PlaneGeometry(DEMI * 2, DEMI * 2)),
      this.garder(mode === 'lumiere' ? new THREE.ShadowMaterial({ opacity: 0.35 }) : new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.08 })),
    );
    sol.rotation.x = -Math.PI / 2;
    sol.receiveShadow = true;
    if (mode === 'angle') (sol.material as THREE.MeshBasicMaterial).color = new THREE.Color(couleurs.texte);
    this.scene.add(sol);

    this.scene.add(this.mannequin());
    this.scene.add(this.points);

    if (mode === 'angle') {
      /* Lumière douce et égale : la scène sert à lire l'angle, pas l'éclairage. */
      this.scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2.2));
      const cle = new THREE.DirectionalLight(0xffffff, 0.8);
      cle.position.set(2, 4, 3);
      this.scene.add(cle);
      this.scene.add(this.cameraStylisee());
    } else {
      this.scene.add(new THREE.AmbientLight(0xffffff, 0.18));
      this.lumiere = new THREE.DirectionalLight(0xffffff, 3.6);
      this.lumiere.castShadow = true;
      this.lumiere.shadow.mapSize.set(1024, 1024);
      const c = this.lumiere.shadow.camera as THREE.OrthographicCamera;
      c.left = -2;
      c.right = 2;
      c.top = 2;
      c.bottom = -2;
      c.near = 0.1;
      c.far = 8;
      this.lumiere.target.position.copy(CENTRE);
      this.scene.add(this.lumiere, this.lumiere.target);
      this.source = new THREE.Mesh(this.garder(new THREE.SphereGeometry(0.09, 24, 16)), this.matieres.teinte);
      this.scene.add(this.source);
    }

    /* Le trait qui relie la caméra (ou la lumière) au centre. */
    const geometrieDuTrait = this.garder(new THREE.BufferGeometry().setFromPoints([CENTRE.clone(), CENTRE.clone()]));
    this.trait = new THREE.Line(geometrieDuTrait, this.matieres.trait);
    this.scene.add(this.trait);

    this.couleurs(couleurs);
  }

  private garder<T extends { dispose: () => void }>(objet: T): T {
    this.aJeter.push(objet);
    return objet;
  }

  /** Le mannequin : des formes simples, assez pour lire où il regarde. */
  private mannequin(): THREE.Group {
    const g = new THREE.Group();
    const m = this.matieres.corps;
    const piece = (geo: THREE.BufferGeometry, x: number, y: number, z: number, rz = 0) => {
      const mesh = new THREE.Mesh(this.garder(geo), m);
      mesh.position.set(x, y, z);
      mesh.rotation.z = rz;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    piece(new THREE.CapsuleGeometry(0.1, 0.62, 6, 14), -0.12, 0.42, 0);
    piece(new THREE.CapsuleGeometry(0.1, 0.62, 6, 14), 0.12, 0.42, 0);
    piece(new THREE.CapsuleGeometry(0.24, 0.42, 8, 18), 0, 1.12, 0);
    piece(new THREE.CapsuleGeometry(0.07, 0.5, 6, 12), -0.34, 1.08, 0, 0.12);
    piece(new THREE.CapsuleGeometry(0.07, 0.5, 6, 12), 0.34, 1.08, 0, -0.12);
    piece(new THREE.CylinderGeometry(0.07, 0.08, 0.12, 14), 0, 1.5, 0);
    const tete = piece(new THREE.SphereGeometry(0.19, 28, 20), 0, 1.69, 0);
    tete.scale.set(0.92, 1.08, 0.98);
    /* Le nez et les yeux : le visage regarde +z, vers la caméra de l'image. */
    const nez = piece(new THREE.ConeGeometry(0.035, 0.09, 12), 0, 1.68, 0.2);
    nez.rotation.x = Math.PI / 2;
    for (const x of [-0.065, 0.065]) {
      const oeil = new THREE.Mesh(this.garder(new THREE.SphereGeometry(0.022, 12, 8)), this.matieres.choisi);
      oeil.position.set(x, 1.73, 0.17);
      g.add(oeil);
    }
    return g;
  }

  /** La petite caméra du mode angle : un boîtier et son objectif, tournés vers le mannequin. */
  private cameraStylisee(): THREE.Group {
    const boitier = new THREE.Mesh(this.garder(new THREE.BoxGeometry(0.24, 0.17, 0.15)), this.matieres.teinte);
    const objectif = new THREE.Mesh(this.garder(new THREE.CylinderGeometry(0.06, 0.075, 0.12, 18)), this.matieres.teinte);
    objectif.rotation.x = Math.PI / 2;
    objectif.position.z = -0.13;
    this.camera.add(boitier, objectif);
    return this.camera;
  }

  /** Les couleurs du thème (relues quand l'apparence change). */
  couleurs(c: CouleursDeLaScene): void {
    const corps = new THREE.Color(c.texte).lerp(new THREE.Color(c.fond), 0.35);
    this.matieres.corps.color = corps;
    this.matieres.arete.color = new THREE.Color(c.faible);
    this.matieres.point.color = new THREE.Color(c.faible);
    this.matieres.choisi.color = new THREE.Color(c.texte).lerp(new THREE.Color(c.fond), 0.85);
    this.matieres.trait.color = new THREE.Color(c.teinte);
    this.matieres.teinte.color = new THREE.Color(c.teinte);
    this.matieres.teinte.emissive = new THREE.Color(c.teinte);
    this.dessiner();
  }

  /** Les points nommés (angles, ou directions d'un modèle à directions fixes), le choisi en évidence. */
  reperes(positions: readonly { cle: string; position: THREE.Vector3 }[], choisi: string | null): void {
    for (const enfant of [...this.points.children]) this.points.remove(enfant);
    const geo = this.garder(new THREE.SphereGeometry(0.045, 14, 10));
    for (const p of positions) {
      const mesh = new THREE.Mesh(geo, p.cle === choisi ? this.matieres.teinte : this.matieres.point);
      mesh.position.copy(p.position);
      mesh.scale.setScalar(p.cle === choisi ? 1.5 : 1);
      this.points.add(mesh);
    }
    this.dessiner();
  }

  /** Pose la caméra (mode angle) ou la lumière (mode lumière) à cette position. */
  placer(position: THREE.Vector3): void {
    if (this.mode === 'angle') {
      this.camera.position.copy(position);
      this.camera.lookAt(CENTRE);
      this.camera.rotateY(Math.PI);
    } else if (this.lumiere && this.source) {
      this.lumiere.position.copy(position.clone().sub(CENTRE).multiplyScalar(3).add(CENTRE));
      this.source.position.copy(position);
    }
    const attr = this.trait.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.setXYZ(0, position.x, position.y, position.z);
    attr.setXYZ(1, CENTRE.x, CENTRE.y + (this.mode === 'angle' ? 0.45 : 0), CENTRE.z);
    attr.needsUpdate = true;
    this.dessiner();
  }

  taille(largeur: number, hauteur: number): void {
    this.rendu.setSize(largeur, hauteur, false);
    this.observateur.aspect = largeur / Math.max(1, hauteur);
    this.observateur.updateProjectionMatrix();
    this.dessiner();
  }

  /** Une image à la prochaine trame, jamais deux. */
  private dessiner(): void {
    if (this.image) return;
    this.image = requestAnimationFrame(() => {
      this.image = 0;
      this.rendu.render(this.scene, this.observateur);
    });
  }

  liberer(): void {
    if (this.image) cancelAnimationFrame(this.image);
    for (const objet of this.aJeter) objet.dispose();
    this.rendu.dispose();
    this.rendu.forceContextLoss();
  }
}

/** La 3D est-elle possible ici ? (sinon l'écran montre son repli) */
export function troisDPossible(): boolean {
  try {
    const essai = document.createElement('canvas');
    return !!(essai.getContext('webgl2') || essai.getContext('webgl'));
  } catch {
    return false;
  }
}
