---
name: catalogue-de-modeles-fal-et-higgsfield-sans-cle
description: À utiliser dès qu'une application doit proposer ou commander les modèles d'image, de vidéo, de son ou de contrôle du mouvement de fal.ai ou de Higgsfield sans les écrire en dur : « récupère la liste des modèles du service », « utilise n'importe quel modèle fal », « motion control », « image de début et de fin d'une vidéo », « quel champ pour l'image de fin ». Dit où lire les deux catalogues gratuitement, comment en tirer le schéma d'entrée et comment construire la commande sans deviner les noms de champs.
etat: active
themes: medias, video, integrations
symptomes: liste de modèles codée en dur et périmée, GET /models de Higgsfield répond 401, champ d'image de fin refusé par le modèle, appel payant qui échoue sur une entrée obligatoire manquante
---

# catalogue-de-modeles-fal-et-higgsfield-sans-cle

## Symptôme

Une liste de modèles écrite à la main se périme en quelques semaines, et une commande construite « de mémoire » envoie un champ que le modèle ne connaît pas (image de fin, durée) ou oublie une entrée obligatoire : l'appel payant échoue, ou le réglage est ignoré sans bruit.

## Cause

Les deux services publient leur catalogue et le schéma d'entrée de chaque modèle, mais pas au même endroit : fal par une API publique, Higgsfield seulement dans sa documentation pour modèles de langage (sa liste par API exige la clé). Et une même famille de modèles change de noms de champs d'une version et d'un service à l'autre.

## Procédure

1. fal.ai, sans clé : `GET https://api.fal.ai/v1/models?category=<cat>&status=active&limit=100` (catégories utiles : text-to-image, image-to-image, image-to-video, text-to-video, video-to-video, text-to-speech, text-to-audio), page suivante par `cursor=<next_cursor>` tant que `has_more`. Garder `metadata.status === 'active'` et `metadata.kind === 'inference'`.
2. Schéma d'un modèle fal : `GET https://api.fal.ai/v1/models?endpoint_id=<id>&expand=openapi-3.0` → `openapi.paths['/<id>'].post.requestBody…schema.$ref` → `components.schemas[<Nom>Input]` (`required`, `properties` ; résoudre les `$ref` et les `anyOf [type, null]`).
3. Higgsfield, sans clé : sa liste `GET https://api.higgsfield.ai/models` exige la clé, mais `https://docs.higgsfield.ai/llms-full.txt` contient chaque modèle : découper aux titres « # … API », lire « **Endpoint ID:** `x` » puis le bloc « > **Complete JSON schema** » (lignes préfixées « > », à retirer avant `JSON.parse`).
4. Classer chaque modèle par capacité depuis sa catégorie et son identifiant (motion-control / motion-transfer → mouvement, image-to-video et first-last-frame → animation, /edit → retouche…).
5. Construire la commande DEPUIS LE SCHÉMA : poser les entrées connues seulement si le modèle les déclare (prompt|text ; start_image_url|image_url|first_frame_url ; end_image_url|last_image_url|tail_image_url|last_frame_url ; video_url ; duration ramenée à la valeur permise ; aspect_ratio s'il est dans l'énumération), vérifier les autres réglages contre `enum`/`minimum`/`maximum`, et refuser AVANT l'appel s'il manque une entrée obligatoire sans défaut.
6. Envoi : fal `POST https://queue.fal.run/<id>` (`Authorization: Key <clé>`), Higgsfield `POST https://api.higgsfield.ai/<id>` (`Authorization: Key <id>:<secret>`). Mettre les catalogues en cache quelques heures.

Voir aussi : pour envoyer un fichier local à fal, suivre une file jusqu'au résultat, la synchronisation labiale et les voix multilingues, « synchronisation-labiale-et-voix-chez-fal ».

## Vérification

Lire les deux catalogues réels et compter les modèles par capacité (au 24/10/2026 : 63 modèles Higgsfield servis sur 84 documentés, ~500 fal en première page par catégorie) ; lire le schéma de `fal-ai/kling-video/v3/pro/motion-control` et constater image_url*, video_url*, character_orientation* ; un test avec un faux réseau vérifie que le corps envoyé ne contient que des entrées du schéma et qu'une entrée obligatoire manquante refuse la commande sans appel payant. Preuve : Beluga, carte « Accordéon créatif en carrousel », commit b39c5f21.

## Pièges

- Le prix fal (`/v1/models/pricing?endpoint_id=…`) exige la clé ; Higgsfield ne publie pas de prix par API.
- `/v1/models` est public mais limité en débit (429 après une dizaine d'appels rapprochés) : paginer sans rafale et garder le cache.
- Le motion control Kling : la durée suit la vidéo de référence (3 à 30 s), ne pas envoyer de durée ; `character_orientation` est obligatoire chez fal (image|video), `keep_original_sound` est un booléen chez fal mais « yes »/« no » chez Higgsfield.
- Même famille, champs différents : Kling 3 fal = start_image_url/end_image_url, Kling 2.5 fal = image_url/tail_image_url, Kling 3 Higgsfield = image_url/last_image_url.
- Environ 20 entrées de la documentation Higgsfield sont des guides ou des outils sans capacité servie (édition vidéo, référence) : ne pas les proposer.

## Ce qui ne marche pas

Tenir une liste de modèles écrite à la main : elle se périme et propose des modèles retirés. Deviner le nom du champ d'image de fin d'après un autre modèle de la même famille : il change d'une version et d'un service à l'autre.
