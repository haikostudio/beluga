---
name: instagram-sans-page-par-connexion-unifiee-meta
description: À utiliser dès qu'une application doit publier sur un compte Instagram professionnel qui n'est relié à AUCUNE page Facebook, ou quand l'ancienne connexion Meta ne rend pas un compte Instagram : « le compte n'apparaît pas après Relier », « associer la page est refusé », « la connexion Instagram n'est pas disponible pour les nouvelles applications », « config_id », « Facebook Login for Business », « assigned_instagram_accounts ». Donne la configuration Meta, l'URL de connexion, l'échange du code, la liste des comptes et les pièges du mode développement.
etat: active
themes: reseaux, instagram, meta, oauth
symptomes: compte Instagram absent après la connexion Meta, association à la page refusée, connexion Instagram indisponible pour les nouvelles applications, me/accounts vide, jeton système qui n'expire pas
---

# instagram-sans-page-par-connexion-unifiee-meta

## Symptôme

Un compte Instagram professionnel doit publier par l'API Graph, mais il n'est relié à aucune page Facebook : la connexion classique (Facebook Login + `me/accounts` → `instagram_business_account`) ne le rend jamais, et Meta refuse l'association à une page depuis le web.

## Cause

L'ancienne voie Instagram passe par la page à laquelle le compte est rattaché. Les applications Meta récentes n'offrent plus la connexion « Instagram seul » (graph.instagram.com) : le tableau de bord dit « pas disponible pour les nouvelles applications » et propose la CONNEXION UNIFIÉE — Facebook Login for Business avec une configuration (config_id), où la personne se connecte avec Facebook OU Instagram et confie le compte d'un portefeuille business. Aucune page n'est requise.

## Procédure

1. Tableau Meta → Cas d'utilisation Instagram (« Gérer les messages et le contenu sur Instagram ») → onglet « API setup with Unified login » → « Créer une nouvelle configuration » → « Créer à partir d'un modèle » : jeton utilisateur système, sans expiration, éléments « Comptes Instagram », droits instagram_basic, instagram_content_publish, instagram_manage_comments, instagram_manage_messages. Noter l'« ID de configuration ». Vérifier que l'URL de retour y est enregistrée.
2. Application non publiée (accès standard) : Rôles → Ajouter des personnes → « Testeur(se) Instagram » → nom du compte ; puis sur instagram.com connecté à CE compte : Paramètres → Applications et sites Web → Invitations à tester → Accepter.
3. URL de connexion : `https://www.facebook.com/v21.0/dialog/oauth?client_id=<APP_ID>&config_id=<CONFIG_ID>&redirect_uri=<RETOUR>&response_type=code&override_default_response_type=true&prompt=login&state=<ETAT>` — pas de `scope` (les droits viennent de la configuration). `prompt=login` affiche « Continuer avec Instagram » ; un compte hors de tout portefeuille n'apparaît QUE par cette voie, et Meta lui crée alors son portefeuille business.
4. Échange : `GET https://graph.facebook.com/v21.0/oauth/access_token?client_id&client_secret&redirect_uri&code` → `access_token` (jeton utilisateur système du portefeuille client). NE PAS l'échanger en jeton long.
5. Comptes : `GET /me/assigned_instagram_accounts?fields=id,username,profile_picture_url` (paginé). `/me?fields=client_business_id` donne le portefeuille (à garder). `/me/accounts` est vide pour un compte sans page.
6. Publication, commentaires, messages : sur `graph.facebook.com/<id-instagram>` avec ce jeton (`/media`, `/media_publish`, `/conversations?platform=instagram`, `/messages`) — l'id Instagram remplace la page partout.

## Vérification

`GET /debug_token?input_token=<jeton>&access_token=<APP_ID>|<SECRET>` → type SYSTEM_USER, expires_at 0, scopes attendus. `GET /<id-ig>?fields=username,followers_count` répond. `POST /<id-ig>/media` (image_url publique, caption) rend un id de conteneur SANS rien publier (il expire seul en 24 h) : preuve du droit de publier. Vérifié le 12/11/2026 sur @belugabuild (Beluga, carte c78d86).

## Pièges

- Le jeton système cesse si l'application est retirée du portefeuille ou si le compte change de portefeuille : arrêter de réessayer et redemander la connexion.
- `/me` rend l'utilisateur système, jamais le compte : ne pas s'en servir pour trouver l'id Instagram.
- En mode développement, sans le rôle « Testeur(se) Instagram » accepté, la connexion par Instagram échoue ; un « Testeur » Facebook ne suffit pas pour un compte qui se connecte par Instagram.
- Le code de retour est à usage unique et vit une dizaine de minutes : l'échanger aussitôt.
- La fenêtre Facebook Login for Business connectée en Facebook ne liste que les portefeuilles de cette personne : un compte isolé n'y est pas, passer par « Continuer avec Instagram ».

## Ce qui ne marche pas

Associer le compte à une page depuis le web (réglages de page, Business Suite, Espace Comptes) : « Association non disponible ». La connexion « Instagram seul » (Instagram Login, graph.instagram.com) : indisponible pour les applications créées récemment. Échanger le jeton de la connexion unifiée par `fb_exchange_token` : inutile et refusé pour un jeton système.
