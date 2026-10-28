# OFFIADS — version avec connexion Supabase

Cette version conserve les pages, le thème, les logos et l'envoi des médias vers Cloudinary (cloud `e615lb8g`, preset unsigned `offiads_campaigns`).

## Configuration déjà intégrée

- Supabase URL : `https://hxmrvodbirqlihsjblgr.supabase.co`
- Publishable key : configurée dans `js/core.js` (clé publique uniquement, jamais une `service_role`).
- Authentification : Supabase Auth, profil et rôle lus depuis `public.profiles`.
- Campagnes : `create_campaign()` et `campaign_action()` côté PostgreSQL, avec contrôles serveur sur le portefeuille, le budget et les rôles.
- Recharges/crédits et tarification : fonctions RPC Supabase.
- Player : `pick_ad()` et `record_event()` côté PostgreSQL; le jeton propre à la pharmacie est obligatoire.

## Déploiement

1. Décompressez cette archive.
2. Publiez le contenu du dossier `offiads/` sur le même hébergement du site OFFIADS (remplacez les fichiers existants après sauvegarde).
3. Dans Supabase → Authentication → URL Configuration, ajoutez le domaine de production à `Site URL` / `Redirect URLs`.
4. Dans Authentication → Email, configurez l'envoi d'e-mails pour la confirmation et la réinitialisation de mot de passe.
5. Ouvrez `login.html`, connectez-vous avec le compte admin Supabase créé et testez les écrans.
6. Dans Administration → Pharmacies, utilisez le lien « Lecteur » généré par l'admin : il contient l'ID et le jeton privé de cette pharmacie. Ne publiez pas le jeton dans un endroit public.

## Vérifications recommandées après déploiement

- Connectez-vous avec `admin@gmail.com` (le mot de passe reste uniquement dans Supabase Auth).
- Créez un compte annonceur et confirmez l'e-mail si Supabase l'exige.
- Créditer le portefeuille test depuis Administration → Annonceurs.
- Créez une campagne image/video, vérifiez qu'elle apparaît en attente, puis approuvez-la.
- Ouvrez le lien Lecteur de la pharmacie cible et vérifiez l'affichage et les impressions.

## Notes importantes

- La connexion à Supabase nécessite Internet et le chargement du SDK Supabase JS depuis jsDelivr.
- Les changements de campagne, la facturation des impressions et les validations passent par les fonctions SQL sécurisées. Les pages d'analytique historiques et certaines fonctions secondaires (par ex. gestion avancée des messages et ajout/suppression de pharmacies) peuvent encore nécessiter un dernier passage de synchronisation selon les actions utilisées.
- Ne partagez jamais de `service_role` key, de mot de passe de compte, ni de mot de passe de base de données.


## Mise à jour : statistiques et approbation des annonceurs

Avant de publier cette version, exécutez une seule fois `SQL_APPROBATION_COMPTES.sql` dans Supabase → SQL Editor.
Cette migration fait passer les nouveaux comptes annonceurs à `pending`. Depuis Administration → Annonceurs, l'Admin peut approuver ou refuser la demande. Les comptes existants ne sont pas modifiés par défaut.

Le tableau de bord charge désormais les agrégats de `campaign_daily` et `campaign_wilaya`, qui alimentent le graphique des 14 derniers jours et la couverture par wilaya. Seuls les événements effectivement enregistrés par le Player apparaissent; aucune donnée historique n'est inventée.


## Correctif justificatifs PDF Cloudinary

Le code envoie maintenant les PDF vers `raw/upload` et les images vers `image/upload`. Si Cloudinary refuse encore le PDF avec `401 deny or ACL failure`, ouvrir Cloudinary Console > Settings > Upload > preset `offiads_campaigns` et vérifier que le preset unsigned autorise les fichiers PDF et les uploads de type Raw. Ne jamais mettre l'API Secret dans le code du navigateur.
