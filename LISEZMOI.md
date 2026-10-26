# OFFIADS — projet complet (mode local)

## Lancer
Ouvrir via un serveur (pas en double-clic) : `npx serve .` puis http://localhost:3000 — ou déposer le dossier sur Vercel.

## Nouveautés de cette version
- **Géographie** (`js/geo.js`) : 69 wilayas, 5 régions (Centre, Est, Ouest, Sud-Est, Sud-Ouest), carte SVG interactive reprise de OFFIADS6.html. Les données déjà enregistrées dans le navigateur sont migrées automatiquement (comptes et campagnes conservés).
- **Nouveau logo** transparent (`assets/logo.png`) et symbole pour le favicon (`assets/symbol.png`).
- **Landing page** redessinée : écran publicitaire animé, carte cliquable (Algérie / région / wilaya), estimation du prix par zone, FAQ, menu mobile.
- **Assistant campagne** : carte cliquable pour choisir la wilaya ou la région.
- **Duplication de campagne** : bouton « Dupliquer » (paramètres copiés, il reste à ajouter le visuel).
- **Cartes de chaleur** par wilaya : tableau de bord, détail campagne, rapports (+ barres par région, CSV avec code et région).
- **Admin** : carte du réseau, pharmacies filtrables par région / wilaya / statut, clic sur la carte pour filtrer, export CSV, 5 coefficients de région dans la tarification.

## Pages
- `index.html` : site public (estimateur de prix, contact → Admin › Messages)
- `login.html` : connexion / inscription annonceur / mot de passe oublié
- `app.html` : espace annonceur (tableau de bord, assistant campagne, campagnes, rapports, factures, portefeuille, paramètres)
- `admin.html` : administration (validation des campagnes, annonceurs, pharmacies, tarification, transactions, messages, journal)
- `player.html?pharmacy=PH-0001` : lecteur publicitaire à intégrer dans le logiciel de pharmacie (compte affichages et clics)

## Comptes de démonstration
- Admin : admin@offiads.dz / Admin@2026
- Annonceur : demo@offiads.dz / Demo@2026 (120 000 DA)
(à supprimer avant production : voir `init()` dans js/core.js et le bloc #demo de login.html)

## Cycle réel d'une campagne
Création + paiement (frais fixe débité, budget réservé) → en attente → Admin approuve (ou rejette = remboursement) → diffusion via le lecteur (chaque affichage consomme CPM/1000) → fin automatique (durée ou budget) → reliquat libéré.
Tarification = rapport OFFIADS : impressions = pharmacies × fréquence/jour × jours ; CPM ajusté = CPM base × zone × format × réseau.

## Limites actuelles
Données dans le navigateur (localStorage/IndexedDB) : tout est dans `js/core.js`, c'est le seul fichier à brancher sur Supabase.
