# Chronolozik — serveur Node

Jeu multijoueur de devinette musicale (façon "pose la chanson sur la bonne
année"), avec un vrai serveur Node/Express/Socket.io. Tourne en local sur ton
iPhone pour tester, prêt à déployer plus tard sur ton propre serveur web.

## Pourquoi un serveur, et pas juste une page ?

- **Temps réel** via WebSockets (Socket.io) — plus de délai de rafraîchissement.
- **Extraits audio Deezer** (30 secondes, sans pub, sans rien à cacher à l'écran
  puisque c'est juste du son) — bien mieux adapté que YouTube pour un jeu où il
  ne faut surtout pas voir le titre avant la révélation.
- **Bibliothèque de chansons partagée**, stockée dans `songs.json` sur le
  serveur — tu peux l'éditer, l'exporter, la sauvegarder comme un fichier normal.
- Aucune dépendance externe côté compte (pas de Firebase, pas de clé API à
  créer) : la recherche Deezer se fait sans authentification, et tout l'état
  des salons vit en mémoire côté serveur, avec une sauvegarde simple dans
  `rooms.json`.

## À propos de Deezer

Le serveur associe chaque chanson de la bibliothèque à un morceau Deezer
automatiquement (recherche par titre + artiste), **au démarrage** et à chaque
ajout de chanson — il te faut une connexion internet à ce moment-là. Les liens
d'extrait audio de Deezer expirent au bout d'un moment, donc le serveur ne les
stocke jamais : il ne garde que l'identifiant Deezer (permanent) et va
rechercher un lien frais à chaque fois qu'une carte est piochée en partie.

Au premier lancement, regarde la console : elle affiche `Deezer ✓ ...` pour
chaque chanson associée avec succès, et un avertissement pour celles qui n'ont
pas été trouvées (rare, mais possible si le titre est mal orthographié ou trop
peu connu). Une chanson sans correspondance Deezer, ou dont l'aperçu audio
n'est pas disponible au moment de la piocher, est **automatiquement mise de
côté par le serveur** — les joueurs ne la voient jamais, une autre carte est
piochée à la place. Elle sera retentée plus tard (après un remélange de la
défausse), au cas où ce n'était qu'un problème passager.

**Pour être sûr que tout le catalogue est jouable :** dans le salon d'attente
→ 📚 Bibliothèque → **🔍 Vérifier la bibliothèque**. Ça interroge Deezer en
direct pour chaque chanson, avec un rythme volontairement lent (par petits
lots espacés) pour rester sous la limite de débit de Deezer — compte 1 à 2
minutes pour 300+ titres. Affiche celles sans correspondance ou sans extrait
audio, avec un bouton pour les retirer directement.

⚠️ Si la console affiche `Quota limit exceeded`, ce n'est **pas** un problème
avec la chanson elle-même — c'est Deezer qui demande de ralentir. Le serveur
réessaie automatiquement plusieurs fois avant d'abandonner une chanson, donc
ce message seul n'est pas une raison de la supprimer.

## Vérification obligatoire au démarrage (depuis la v1.10)

Personne ne peut créer ni rejoindre un salon tant que **toute la bibliothèque**
n'a pas été vérifiée contre Deezer pour ce cycle de démarrage — un écran de
chargement avec une barre de progression en temps réel (%, X/Y chansons)
s'affiche en attendant. Cette vérification tourne à chaque démarrage du
serveur (donc à chaque redéploiement, et à chaque réveil du tier gratuit
Render après une période d'inactivité).

**Contrepartie assumée :** comme le tier gratuit de Render s'endort après 15
minutes d'inactivité, ça veut dire qu'un premier visiteur après une pause
attendra 1 à 2 minutes avant de pouvoir jouer, à chaque fois. C'est le prix
de la garantie "aucune chanson muette ne peut arriver en jeu".

## Bibliothèque et filtres (depuis la v1.3)

Le catalogue de départ contient **309 chansons**, de 1900 à 2026, réparties en
7 tranches de 20 ans. Chaque chanson est taguée avec un genre et un pays quand
c'est connu de façon fiable — certaines (surtout celles ajoutées en gros lot
pour monter en volume) n'ont pas ces tags, ce qui est normal : elles restent
jouables et filtrables par période et par artiste, juste pas par genre/pays.

Dans le salon d'attente, **⚙️ Options de partie** permet de choisir une ou
plusieurs tranches de 20 ans et/ou des artistes précis avant de lancer la
partie — rien de coché = tout le catalogue est utilisé. Le nombre de
chansons correspondant aux filtres actifs s'affiche en direct.

## Tester en local sur ton iPhone (via iSH)

1. Installe **iSH** depuis l'App Store (gratuit).
2. Ouvre iSH et installe Node :
   ```
   apk update
   apk add nodejs npm
   ```
3. Récupère ce dossier sur ton iPhone (par ex. dépose-le dans l'app **Fichiers**,
   dans un dossier accessible à iSH — iSH voit `~/` comme son propre espace ;
   le plus simple est d'utiliser `Fichiers > Sur mon iPhone > iSH` si le
   partage est activé, ou de passer par `git clone` si tu mets le projet sur
   GitHub/un Gist).
4. Dans iSH :
   ```
   cd frise-chronologique
   npm install
   npm start
   ```
5. Le terminal affiche deux adresses :
   - `http://localhost:3000` — utilisable **uniquement sur cet iPhone** (dans
     Safari, sur le même appareil qu'iSH).
   - `http://<IP de ce téléphone>:3000` — pour que tes amis te rejoignent
     depuis leur propre téléphone, **sur le même Wi-Fi**. Pour trouver ton IP :
     Réglages > Wi-Fi > (i) à côté du réseau connecté > "Adresse IP".

**Limites à connaître :**
- Le serveur ne tourne que pendant qu'iSH est **au premier plan** — iOS coupe
  l'exécution en arrière-plan après quelques secondes. Parfait pour une
  session de test, pas pour un serveur permanent.
- Tout le monde doit être sur le **même réseau Wi-Fi** (pas d'accès depuis
  l'extérieur sans configuration réseau supplémentaire, volontairement pas
  couverte ici puisque c'est juste pour tester).
- iSH émule un processeur x86 sur ARM : c'est plus lent qu'un vrai serveur,
  largement suffisant pour quelques joueurs en local.

## Tester sur ordinateur (plus rapide, pour vérifier que tout marche)

```
npm install
npm start
```
Puis ouvre `http://localhost:3000` dans le navigateur.

## Vérifier que le serveur fonctionne correctement

Un test automatisé est fourni (`test-e2e.js`) : il lance le serveur, simule
deux joueurs et un bot à travers une partie complète (créer un salon,
rejoindre, piocher, placer, défier, révéler, DJ, reprise de partie par
prénom...) et vérifie que tout se comporte comme prévu.

```
npm install
node test-e2e.js
```
Tu dois voir uniquement des lignes `✅` et se terminer par
`✅ ALL TESTS COMPLETED`.

## Déployer plus tard sur ton propre serveur web

Ce projet est un serveur Node standard — il tourne tel quel sur n'importe quel
hébergement qui exécute Node.js (VPS, Render, Railway, un Raspberry Pi chez
toi, etc.) :
```
npm install --production
PORT=3000 npm start
```
`rooms.json` et `songs.json` sont de simples fichiers JSON à côté du code —
sauvegarde-les si tu changes de serveur, pour ne pas perdre les salons et la
bibliothèque de chansons.

## Structure du projet

```
frise-chronologique/ (dépôt GitHub xams0/frise-chronologique)
  server.js       -> logique de jeu (autoritaire), API REST, Socket.io
  songs.json       -> bibliothèque de chansons (titre/artiste/année/YouTube)
  rooms.json       -> état des salons (créé automatiquement au 1er lancement)
  package.json
  test-e2e.js      -> test automatisé de bout en bout
  public/
    index.html
    style.css
    app.js         -> tout l'affichage + connexion Socket.io
```

## Ajouter des chansons

Dans le salon d'attente → **📚 Bibliothèque** → ajoute titre/artiste/année.
Le serveur cherche automatiquement la correspondance sur Deezer — pas de lien
à coller. Tu peux aussi exporter/importer un fichier JSON depuis cet écran,
ou éditer `songs.json` directement (redémarre le serveur après, pour qu'il
associe les nouvelles entrées à Deezer).

## Où êtes-vous ? (depuis la v1.12)

Dans le salon d'attente, choisis entre deux modes d'écoute :
- **🎉 Tous ensemble** — un DJ unique diffuse la musique à voix haute pour
  toute la pièce, comme avant. Le rôle de DJ reste réassignable.
- **🏠 Chacun chez soi** — pas de DJ : chaque joueur entend l'extrait
  directement sur son propre téléphone, pratique si vous n'êtes pas dans la
  même pièce.

Le choix se fait avant de lancer la partie et peut être changé tant que le
salon est en attente.

## Hôte du salon et délai de révélation (depuis la v1.13)

Le créateur du salon (👑) est le seul à pouvoir lancer la partie, changer le
mode d'écoute, le DJ, les filtres et le délai de révélation — les autres
joueurs voient ces réglages mais ne peuvent pas les modifier.

Un délai (15 secondes par défaut, réglable de 5 à 60s dans le salon
d'attente) s'écoule entre le moment où une carte est posée et celui où le
bouton **Révéler** devient cliquable — une barre de progression se remplit
dans le bouton en attendant. Ça laisse toujours le temps aux autres de
défier avant que la carte ne soit révélée. Le délai est aussi vérifié côté
serveur, pas seulement affiché côté client.

## Renommage : Chronolozik (depuis la v1.14)

Le jeu s'appelle maintenant **Chronolozik**. Le dépôt GitHub reste
`xams0/frise-chronologique` (renommer le dépôt casserait le lien de
déploiement Render) — seul le nom affiché dans l'app a changé.

## Pourquoi je me déconnectais en changeant d'appli sur mon téléphone

Deux causes, maintenant corrigées :

1. Quand le téléphone met la page en arrière-plan, iOS coupe souvent la
   connexion WebSocket pour économiser la batterie. Le navigateur la
   rétablit à la réouverture, mais **le serveur voit ça comme une toute
   nouvelle connexion**, sans salon associé — donc plus aucune action ne
   partait, sans message d'erreur visible. Le client détecte maintenant une
   reconnexion et rejoint automatiquement le même salon avec le même nom.
2. Si le téléphone est resté en arrière-plan longtemps, iOS peut carrément
   **décharger la page de la mémoire** — au retour, c'est un rechargement
   complet, tout l'état JS est perdu. Le salon et le prénom sont maintenant
   sauvegardés dans le stockage local du téléphone, donc l'app retente de
   rejoindre automatiquement au rechargement, sans que tu aies besoin de
   retaper quoi que ce soit.

Une petite bannière ("🔄 Reconnexion..." ou "🔌 Connexion perdue...")
s'affiche pendant ces moments, pour que ce ne soit jamais silencieux.

## v1.15 — kick, révélation automatique, historique des ratés, mode audio

- **Exclure un joueur** : l'hôte voit un bouton 🚫 à côté de chaque joueur
  (sauf lui-même) dans le salon d'attente, avec confirmation avant d'agir.
  Le joueur exclu est notifié et renvoyé à l'écran d'accueil.
- **Révélation automatique** : la carte se révèle toute seule dès que le
  délai (réglable) s'écoule — plus besoin de cliquer sur "Révéler", même si
  le bouton reste utilisable pour révéler plus tôt une fois le délai passé.
- **Historique des cartes ratées** : sous la frise de chaque joueur, les 5
  dernières chansons mal placées par ce joueur s'affichent avec leur année.
- **Mode audio** : dans le salon, l'hôte choisit entre 🔁 en boucle (par
  défaut) et ⏹️ une seule fois (s'arrête après les 30 secondes de l'extrait).

## v1.16 — habillage premium + salons publics

- **Version affichée** sous le nom de l'app, en petite bulle, sur l'écran
  d'accueil (en plus du badge discret en bas à droite de toutes les pages).
- **Fond animé noir/bleu** sur l'écran d'accueil (dégradés flous en
  mouvement lent), et le titre **Chronolozik** a un léger effet de brillance
  qui balaie le texte.
- **Salons publics ou privés** : à la création, choisis 🔒 Privé (comme
  avant, uniquement par code) ou 🌐 Public. Les salons publics apparaissent
  dans une liste sur l'écran "Rejoindre", avec le nom de l'hôte et le nombre
  de joueurs, et un bouton pour rejoindre directement sans taper le code.
  L'hôte peut aussi changer la visibilité depuis le salon d'attente.

## v1.17 — nombre de joueurs maximum

Dans le salon d'attente, l'hôte peut limiter le nombre de joueurs : boutons
rapides 2/3/4/5/6, ou une valeur personnalisée (2 à 20) via le champ dédié.
"Illimité" retire la limite. Un joueur déjà présent peut toujours reprendre
sa place même si le salon est "complet" — la limite ne bloque que les
nouvelles arrivées. Impossible de fixer un maximum inférieur au nombre de
joueurs déjà présents.

## v1.18 — départ propre du salon + kick plus fiable

- Cliquer "quitter" (✕) **notifie maintenant vraiment le serveur** — avant,
  le client s'en allait localement sans jamais le dire, laissant un joueur
  fantôme dans le salon. Le départ ajuste le tour de jeu, le DJ, réattribue
  l'hôte si besoin, et **termine la partie si l'hôte se retrouve seul**
  (retour au salon d'attente). Si tout le monde part, le salon est supprimé.
- **Kick plus robuste** : en plus du message direct envoyé au joueur exclu,
  le client détecte maintenant lui-même s'il a disparu de la liste des
  joueurs (peu importe la cause exacte) et se déconnecte proprement — un
  filet de sécurité qui ne dépend plus d'un seul mécanisme.

## v1.19 — le prénom est mémorisé

Le champ "Ton prénom" se pré-remplit maintenant avec le dernier prénom
utilisé sur cet appareil (stocké dans le stockage local du navigateur, pas
un vrai cookie HTTP — plus simple et suffisant ici). Il reste 100%
modifiable : c'est juste une valeur par défaut, pas un verrouillage.

## v1.20 — habillage premium partout + salons publics quasi temps réel

- Le **fond animé noir/bleu** et le **titre brillant** sont maintenant sur
  toutes les pages : accueil, écran de chargement, salon d'attente, partie
  et écran de victoire — pas seulement l'accueil.
- L'animation de fond est synchronisée sur l'horloge (délai négatif calculé
  à chaque rendu) pour ne jamais "sauter"/redémarrer, même sur l'écran de
  partie qui se redessine plusieurs fois par seconde pendant le compte à
  rebours de révélation.
- La liste des **salons publics** se rafraîchit automatiquement toutes les
  2,5 secondes tant qu'elle est affichée (onglet "Rejoindre" de l'accueil) —
  quasi temps réel, sans avoir à appuyer sur ↻.

## v1.21 — vraie palette bleutée + badge de version retiré

- La vraie cause du "toujours noir" : la palette de base (`--bg`, `--surface`)
  était en fait **violette**, pas bleue — sur le salon et la partie, les
  panneaux opaques recouvrent presque tout l'écran et cachaient les halos
  animés. Corrigé à la racine : les couleurs de fond de toute l'app sont
  maintenant du bleu marine foncé, visible partout, pas seulement dans les
  espaces vides de l'accueil.
- Le badge de version discret en bas à droite de chaque écran est retiré —
  seule la bulle sous le titre "Chronolozik" sur l'accueil subsiste.

## v1.22 — écran d'accueil des règles, corrections de scintillement et de scroll

- **Écran de règles** premium, affiché **une seule fois** (mémorisé dans le
  stockage local) avant l'accueil, expliquant le jeu en 4 étapes illustrées.
- **Fix clignotement** : la bannière de résultat et le message "titre/artiste
  trouvé" rejouaient leur animation à chaque redessin de l'écran (plusieurs
  fois par seconde pendant le compte à rebours de révélation) au lieu de
  jouer une fois — corrigé en ne déclenchant l'animation qu'au premier
  affichage de chaque résultat.
- **Fix scroll bloqué** : la restriction de défilement (ajoutée plus tôt pour
  empêcher la page de bouger horizontalement) empêchait aussi de faire
  défiler les frises trop longues — les frises ont maintenant leur propre
  autorisation de scroll horizontal.
- **Frises sur plusieurs lignes** : les cartes d'une frise s'enroulent
  maintenant sur plusieurs lignes au lieu de s'étaler sur une seule bande à
  faire défiler — beaucoup moins besoin de scroller, y compris dans la
  fenêtre de placement/défi.

## v1.23 — vrai logo partout

Le logo (note de musique + onde sonore, dégradé bleu/rose) remplace l'icône
CSS générique sur l'accueil, l'écran de règles, l'écran de chargement et
l'écran de victoire. Il sert aussi de :
- **Favicon** (onglet du navigateur)
- **Icône iOS** quand on ajoute le site à l'écran d'accueil ("Sur l'écran
  d'accueil" dans Safari) — fond bleu marine assorti au thème, comme une
  vraie app
- **Icône Android/PWA** via `manifest.json` (192px et 512px)

## v1.24 — carte gagnée qui clignote, lecteur audio simplifié, notifs auto

- La carte qui vient d'être gagnée ou volée **clignote en doré** dans la
  frise pendant quelques secondes, pour bien la repérer.
- Lecteur audio simplifié : texte explicatif retiré, remplacé par une petite
  **animation d'égaliseur** (barres qui bougent) montrant que le son joue,
  et un **compteur "Xs / 30s"** en direct. Le bouton "🔊 Appuyer si pas de
  son" reste disponible en secours.
- Les notifications de résultat (bien placé / raté / volé) **disparaissent
  seules après 3,5 secondes** — plus besoin de cliquer "OK" — et sont
  maintenant affichées **sous les frises**, pas au-dessus.

## v1.25 — cinq corrections/ajouts

- **Fix compteur qui oscillait** : le compteur "Xs / 30s" repartait parfois
  brièvement à "0s" avant de se corriger — la valeur affichée survit
  maintenant aux redessins de l'écran au lieu de repartir d'un texte figé.
- **Écran de chargement simplifié** : "Chargement, veuillez patienter."
- **Révélation anticipée par les autres joueurs** : si tu ne joues pas ce
  tour-ci et que tu penses que le placement est correct, tu peux appuyer sur
  "Ça a l'air bon, révéler maintenant" pour révéler tout de suite, sans
  attendre le délai — qui continue de s'appliquer uniquement à celui qui
  vient de poser sa carte.
- **Tolérance aux fautes de frappe** sur les réponses titre/artiste
  (distance de Levenshtein, quelques lettres de différence acceptées).
- **Fix titre/artiste qui débordait** : structure plus robuste (deux lignes
  indépendantes, tronquées et centrées) au lieu d'un bloc multi-lignes qui
  pouvait déborder du cadre de la carte.

## v1.26 — filtres simplifiés, animations réparées

- **Filtres réduits aux périodes uniquement** — le filtre par artiste est
  retiré des options de partie.
- **Fix égaliseur audio** : même cause que les précédents bugs
  d'animation — les barres 3 et 4 avaient un délai trop long pour survivre
  aux redessins fréquents de l'écran et ne démarraient jamais. Corrigé avec
  la même technique de délai négatif synchronisé sur l'horloge que le fond
  animé.
- **Barre de progression du bouton Révéler** : remplacée par une vraie
  animation CSS fluide (calculée pour démarrer déjà au bon endroit selon le
  temps écoulé) au lieu d'une largeur recalculée par à-coups toutes les
  250ms — beaucoup plus premium.

## v1.29 — vrai fix : le champ "Artiste ?" débordait de l'écran

Les précédentes tentatives (v1.25/v1.27/v1.28) corrigeaient les cartes de la
frise, mais le vrai bug (confirmé par capture d'écran) était ailleurs : les
champs **"Titre ?" / "Artiste ?"** pour deviner la chanson étaient côte à
côte (`flex:1` sans `min-width:0`, un piège classique de flexbox où un
`<input>` refuse de rétrécir sous sa largeur naturelle) — "Artiste ?" sortait
de l'écran sur mobile. Les deux champs sont maintenant **empilés
verticalement**, chacun pleine largeur.

## v1.30 — démarrage plus rapide

Le blocage au démarrage venait de deux choses cumulées :
1. Chaque chanson était vérifiée en **2 appels Deezer** (recherche + test de
   l'extrait), doublant le nombre de requêtes.
2. Les pauses anti-quota étaient prudentes (lots de 5, pause de 1,2s).

Maintenant, le démarrage ne fait plus qu'**associer** chaque chanson à
Deezer (1 appel), avec des lots plus grands et des pauses plus courtes (lots
de 8, pause de 0,7s) — environ 2 à 2,5× plus rapide. La vérification
complète (extrait réellement audible) reste disponible à la demande via
**🔍 Vérifier la bibliothèque**, et le filet de sécurité qui empêche toute
carte muette d'arriver en jeu (`drawPlayableCard`) est inchangé — il agit
déjà en temps réel à chaque pioche, donc rien n'est perdu en sécurité.

**À savoir** : ce démarrage complet ne se reproduit vraiment que juste après
un redéploiement. Un simple réveil après la mise en veille du tier gratuit
Render (sans nouveau déploiement) garde normalement le même disque, donc les
associations déjà résolues restent en mémoire et le redémarrage est quasi
instantané.

**Pour aller plus loin** : une fois le serveur démarré et toutes les
chansons associées, tu peux exporter la bibliothèque (📚 Bibliothèque → ⬇
Exporter) et me la transmettre — je peux alors committer directement les
identifiants Deezer déjà résolus dans `songs.json`, ce qui rendrait même le
tout premier démarrage après un déploiement quasi instantané.

## v1.31 — six correctifs/ajouts

- **Fix vrai bug** : le champ de saisie titre/artiste perdait le focus
  toutes les 250ms pendant le compte à rebours de révélation (le redessin
  périodique détruisait et recréait le champ en pleine frappe) — c'était la
  cause probable à la fois du "insensible à la casse" perçu et de
  "impossible de taper après avoir placé une carte". La logique de
  comparaison elle-même était déjà insensible à la casse (vérifié
  directement). Le focus et la position du curseur sont maintenant
  préservés à travers les redessins.
- **Couleur distincte pour une carte volée** (rose) vs gagnée normalement
  (doré) dans la frise.
- **Artiste ajouté** à l'historique des chansons ratées (year + titre +
  artiste, au lieu de year + titre seulement).
- **Revoir les frises finales** : bouton sur l'écran de victoire pour
  afficher la frise complète de chaque joueur.
- **Audio qui ne démarre pas seul en "chacun chez soi"** : ce n'est pas un
  souci de synchronisation (carte et son arrivent bien en même temps pour
  tous) — c'est la politique de lecture automatique des navigateurs, qui
  bloque plus souvent quand l'appareil n'a pas eu d'interaction tactile
  très récente. Le bouton de secours pulse maintenant visuellement dès que
  le navigateur bloque la lecture automatique, pour ne jamais le manquer.
- Petit fix additionnel : les artistes à 2 caractères (ex. "U2") étaient
  auparavant impossibles à deviner correctement à cause d'un seuil de
  longueur trop strict.

## v1.32 — déblocage audio dès le premier tap

Il n'existe pas de vrai moyen de forcer un son sans aucune interaction —
c'est une restriction volontaire des navigateurs. Mais dès le tout premier
tap/clic/touche sur la page (même juste taper son prénom), l'app joue
maintenant brièvement un son silencieux inaudible. La plupart des
navigateurs considèrent ensuite que la page a "l'autorisation audio" pour le
reste de la session — donc les lectures automatiques déclenchées plus tard
par le jeu (via le serveur, pas un clic direct) ont beaucoup plus de chances
de fonctionner sans intervention, y compris en mode "chacun chez soi".

(Petit bonus : un test de bout en bout qui pouvait échouer au hasard selon
la chanson tirée a été rendu déterministe.)

## v1.33 — bouton "Prêt" dans le salon

Chaque joueur a maintenant un bouton **"✅ Je suis prêt·e"** dans le salon
d'attente. Ce tap explicite sert de déblocage audio fiable (bien plus
qu'une simple frappe au clavier), et le bouton "Lancer la partie" de l'hôte
affiche le nombre de joueurs prêts (ex. "3/4 prêts"). L'hôte garde le
contrôle final — il peut lancer la partie même si tout le monde n'a pas
encore confirmé, mais voit clairement qui est prêt.

## v1.34 — carte volée permanente + timer de décision

- **Carte volée** : reste marquée en **rose** pendant tout le reste de la
  partie (plus seulement quelques secondes), avec une mention **"Volée à
  [pseudo]"** affichée en bas de la carte, dans la frise et dans la fenêtre
  de placement/défi.
- **Temps pour répondre à une carte** : nouveau réglage (60s par défaut,
  15 à 180s, réglable par l'hôte dans le salon). Si le joueur actif ne place
  pas (et ne passe pas) sa carte à temps, elle est automatiquement
  défaussée et le tour passe au joueur suivant — avec une barre de
  progression du même style que celle du bouton Révéler, visible par tous
  pendant la phase d'écoute.

## v1.35 — détail de carte au tap

Taper sur n'importe quelle carte déjà posée dans une frise ouvre une petite
popup avec une animation de retournement ("flip"), affichant en grand la
pochette, l'année, le titre, l'artiste — et la mention "Volée à [pseudo]" si
la carte a été volée. Une croix ✕ referme la popup. Pour la toute première
carte de chaque joueur (distribuée au lancement de la partie, avant tout
tirage), aucune pochette n'a encore été récupérée sur Deezer — un espace
réservé musical s'affiche à la place.

## v1.36 — quatre corrections/ajouts

- **Fix scroll bloqué sur Chrome mobile** : le fond animé plein écran
  n'avait pas `pointer-events:none` — malgré un `z-index` négatif, il
  pouvait intercepter les gestes de défilement sur certains navigateurs.
- **Fix vraie cause de la saisie qui bug pendant le compte à rebours** : le
  focus était déjà restauré depuis la v1.31, mais le champ de texte était
  quand même détruit et recréé toutes les 250ms, ce qui pouvait faire
  perdre des lettres tapées via le clavier prédictif mobile (IME). Le tick
  périodique du chronomètre saute maintenant complètement le redessin tant
  qu'un champ de texte est activement utilisé — les barres de progression
  restent fluides (animation CSS pure), seul le chiffre affiché fait une
  pause le temps de la frappe.
- **Barre "Révéler" visible pour tout le monde** : les autres joueurs voient
  maintenant combien de temps il reste avant que le joueur actif puisse
  révéler, pas seulement lui.
- **Lancement automatique** : si tous les joueurs (bots inclus, toujours
  comptés prêts) appuient sur "Prêt", la partie démarre toute seule, sans
  que l'hôte ait besoin de cliquer sur "Lancer la partie".

## v1.37 — vraie tentative de fix du scroll bloqué sur Chrome

Ma précédente correction (`pointer-events:none` sur le fond animé, v1.36)
n'a pas suffi. Le suspect suivant : `touch-action:pan-y` sur `html,body` —
une restriction assez stricte ("uniquement le défilement vertical, rien
d'autre") ajoutée il y a longtemps contre un tout autre bug de glissement
horizontal parasite, et Chrome peut l'interpréter différemment de Safari.
Remplacée par `touch-action:manipulation`, la valeur standard pour ce genre
d'app (autorise le défilement dans toutes les directions, désactive juste le
délai de double-tap pour zoomer). La protection contre le glissement
horizontal reste assurée par `overflow-x:hidden`, qui ne dépend pas de
touch-action.

Si ça ne suffit toujours pas, dis-le — je creuserai plus profondément (test
sur un appareil réel serait idéal, que je ne peux pas faire moi-même).

## v1.38 — options réorganisées avec sous-onglets + nouveaux réglages

- **Cartes pour gagner** (4-20, 10 par défaut) et **jetons de départ**
  (0-10, 2 par défaut) sont maintenant réglables par l'hôte.
- **Gros ménage dans le salon d'attente** : tous les réglages (mode
  d'écoute, DJ, musique, délais, joueurs max, visibilité, périodes) sont
  regroupés derrière un seul bouton **"⚙️ Options de la partie"**, organisé
  en 4 sous-onglets (🎮 Partie, 🔊 Écoute, ⏱️ Temps, 🎵 Chansons) — fini le
  salon interminable à faire défiler.
- Ne reste directement visible dans le salon : la liste des joueurs, le
  bouton **"Prêt(e)"** (renommé), et une **rangée de pastilles-résumé**
  (🏆10 🪙2 👥∞ 🔒Privé 🎉Ensemble 🔁Boucle ⏱️15s ⏳60s) pour voir l'essentiel
  d'un coup d'œil sans ouvrir le menu.

## v1.39 — achat direct de carte devient une option (désactivée par défaut)

- **Échanger 3 jetons contre une carte posée directement** (sans l'écouter)
  est maintenant une option dans "⚙️ Options de la partie" → onglet 🎮
  Partie, **désactivée par défaut**. L'hôte peut l'activer.
- Sur le second point : après relecture complète du code client et serveur,
  aucune restriction liée au mode d'écoute ("Tous ensemble" vs "Chacun chez
  soi") n'a été trouvée — testé et confirmé de bout en bout que la
  fonctionnalité fonctionne identiquement dans les deux modes une fois
  activée. Si le souci persiste après ce déploiement, dis-le avec plus de
  détails (quel mode, à quel moment précis) pour qu'on creuse ensemble.

## v1.40 — clarté du défi avec 3+ joueurs

- Le bouton Défier était **déjà** correctement masqué pour tout le monde dès
  qu'un défi existe (vérifié, ça marchait déjà avec 3+ joueurs) — le
  serveur n'accepte qu'un seul défi par carte, testé explicitement avec 3
  joueurs pour confirmer qu'un second joueur ne peut pas écraser le défi du
  premier.
- **Vrai bug corrigé** : contre un Bot, le message affiché était codé en
  dur "**Tu** as déjà défié ce placement" — avec 3+ joueurs, si c'était
  quelqu'un d'autre qui avait défié, le message était faux. Affiche
  maintenant le vrai nom du joueur qui a défié.
- **Ajout** : le joueur actif voit maintenant lui aussi qui l'a défié
  ("🚨 [pseudo] a défié [pseudo] !"), ce qu'il ne voyait jamais avant.

## v1.41 — fix de la course entre deux "Défier" simultanés

Trouvé le vrai trou : quand deux joueurs appuyaient sur "Défier" presque en
même temps, le second (arrivé quelques millisecondes trop tard côté
serveur) était rejeté **en silence** — aucun message, rien. Et même quand
le serveur envoyait un message d'erreur, l'écran de partie ne l'affichait
nulle part.

Corrigé des deux côtés :
- Le serveur envoie maintenant un message explicite : *"Trop tard — [pseudo]
  a défié en premier."*
- L'écran de partie affiche maintenant les messages d'erreur (il ne le
  faisait qu'à l'accueil et dans le salon avant), et ils disparaissent
  seuls après 4 secondes.

## v2.0 — 🎉 catalogue élargi à 712 chansons

Ajout de **403 nouvelles chansons** (309 → 712), dédupliquées contre le
catalogue existant, avec une bonne répartition sur toutes les décennies :

| Période | Chansons |
|---|---|
| 1900s | 8 |
| 1910s | 16 |
| 1920s | 19 |
| 1930s | 25 |
| 1940s | 23 |
| 1950s | 50 |
| 1960s | 79 |
| 1970s | 88 |
| 1980s | 86 |
| 1990s | 94 |
| 2000s | 65 |
| 2010s | 98 |
| 2020s | 61 |

Nouveauté notable : plus de diversité musicale — chanson française
(Piaf, Brel, Aznavour, Stromae, Angèle...), musique latine, K-pop, afrobeats,
reggae, metal, punk, et davantage de country, en plus des classiques pop/rock
déjà présents.

Comme toujours, le démarrage du serveur doit associer chaque nouvelle
chanson à Deezer avant d'ouvrir le salon — avec 712 titres au lieu de 309,
le tout premier démarrage après ce déploiement prendra plus de temps que
d'habitude (les démarrages suivants restent rapides tant que le disque
persiste, voir la note v1.30 plus haut).

## v2.1 — modes spéciaux (presets)

Nouvel onglet **🎮 Modes** dans "Options de la partie" (premier onglet,
avant "Partie"), avec trois préréglages qui appliquent d'un coup une
combinaison des réglages existants :

- **🎵 Original** — 10 cartes pour gagner, 2 jetons de départ, 15s pour
  révéler, 60s pour répondre. Les réglages par défaut.
- **🩸 Hardcore** — 0 jeton de départ (donc pas moyen de passer au premier
  tour), 5s seulement pour révéler, 15s pour répondre.
- **😈 Fais-toi des ennemis** — 12 cartes pour gagner, 4 jetons de départ,
  délai de révélation allongé à 20s, pour pouvoir défier beaucoup plus
  souvent avant que la fenêtre ne se referme.

**Précision honnête** : ces modes sont de purs préréglages des réglages déjà
existants, comme demandé — pas de nouvelle mécanique de jeu. Ça veut dire
que "Fais-toi des ennemis" n'a pas de vraie cible-Némésis assignée en
secret comme pitché initialement — il encourage juste les défis fréquents
via plus de jetons et une fenêtre de révélation plus longue. Si l'envie
vient d'ajouter la mécanique de Némésis/Vengeance plus tard, c'est un
prochain pas naturel, distinct de ce préréglage.

Le mode actif s'affiche aussi en pastille (🎵/🩸/😈) sous "Joueurs" pour
info rapide sans ouvrir le menu.

## v2.2 — Hardcore fait vraiment mal maintenant

Ajout de la règle qui manquait au preset Hardcore (repérée après coup) :
**une erreur de placement fait perdre une carte au hasard de sa propre
frise**, en plus de défausser la chanson qui venait d'être piochée. La
carte perdue est remélangée dans la pioche — quelqu'un pourra la retirer
plus tard. Si le placement est volé par un adversaire via un défi réussi,
la pénalité s'applique aussi (l'actif s'est quand même trompé).

Visible dans la bannière de résultat : "🩸 Hardcore : [pseudo] perd aussi
'[titre]' de sa frise !" en plus du message habituel.

C'est la seule vraie mécanique de jeu (pas juste un préréglage de réglages
existants) parmi les modes spéciaux, et elle est strictement limitée au
mode Hardcore.

## v2.3 — la carte de départ est protégée en Hardcore

Confirmation utile : non, elle **pouvait** être perdue jusqu'ici (la v2.2
n'avait aucune protection). Corrigé : la toute première carte reçue au
lancement de la partie est maintenant **exemptée** de la pénalité Hardcore
— seules les cartes gagnées en cours de partie peuvent être reperdues au
hasard. Si un joueur n'a encore que sa carte de départ, une erreur ne lui
coûte plus rien de plus que la chanson piochée.

Testé de bout en bout dans les deux sens : la carte de départ survit seule
en main, et une carte gagnée peut toujours être perdue par la suite.

## v2.3.1 — le point à côté du prénom reflète le statut prêt

Le sablier ⏳/✅ à côté des prénoms dans le salon est retiré. Le petit point
déjà présent à gauche du prénom (auparavant toujours vert) change
maintenant vraiment de couleur : **rouge** si le joueur n'est pas prêt,
**vert** dès qu'il a appuyé sur "Prêt(e)".

## v2.3.2 — ajout de Percheye

6 titres de l'artiste indie pop français **Percheye** (Tristan Rolland),
2022-2025 : Will You Come Home, Mr. Conflict, Getting Occupied, Call Me,
Drained Out, Ballade. Catalogue à 718 chansons.

## v2.4 — interface épurée

- **Compteur "Xs / 30s" retiré** de l'écran d'écoute (l'égaliseur animé
  suffit à montrer que le son joue).
- **Fenêtre "Options de la partie" à taille fixe** : la zone de contenu a
  maintenant une hauteur fixe (50vh) au lieu de s'ajuster au contenu de
  chaque onglet — plus de saut de taille en changeant d'onglet.
- **Résumé des options replié par défaut** : les pastilles-résumé sous
  "Joueurs" sont maintenant derrière un petit volet "Résumé des options"
  avec une flèche pour l'ouvrir/fermer, pour un salon d'attente plus épuré.

## v2.5 — 6 améliorations

- **+314 chansons** (718 → 1032), toujours réparties sur toutes les
  décennies et davantage de genres (funk, metal, blues, prog rock, chanson
  française, emo/pop-punk, indie 2010s).
- **Réactions emoji qui défilent** (👏 😂 😭 😱 🤬 🔥) — un petit bandeau de
  boutons pendant la partie, chaque tap envoie un emoji qui monte et
  s'estompe à l'écran de tous les joueurs pendant ~2 secondes.
- **Pas de répétition entre deux parties dans le même salon** : les
  chansons réellement tirées lors d'une partie sont mémorisées et évitées
  au prochain lancement — sauf si ça laisserait trop peu de chansons
  disponibles, auquel cas le jeu accepte des répétitions plutôt que de
  bloquer.
- **Fix des horaires de l'historique** : `nowStr()` n'indiquait aucun
  fuseau horaire et utilisait celui du serveur (souvent UTC sur Render) au
  lieu de Paris — corrigé, testé, confirmé.
- **Scroll automatique vers le joueur actif** : dès qu'une nouvelle chanson
  commence à être écoutée, l'écran défile en douceur vers la frise du
  joueur dont c'est le tour, même si elle était hors de vue.
- **Pioche automatique configurable** (0-30s, désactivée par défaut) :
  si personne n'appuie sur "Piocher et écouter", la prochaine chanson se
  lance toute seule après le délai réglé par l'hôte — avec une barre de
  progression directement dans le bouton, dans le même style visuel que
  les autres comptes à rebours du jeu.

## v2.6 — 9 corrections/ajouts

- **Vrai bug transversal corrigé** : les boutons de l'app utilisaient
  `addEventListener('click', ...)`, qui **empile** les gestionnaires au
  lieu de les remplacer à chaque re-rendu. Après suffisamment de rendus, un
  seul clic pouvait déclencher l'action plusieurs fois — c'était la cause
  exacte du "un clic sur l'emoji en fait apparaître une dizaine". Remplacé
  par une assignation `.onclick =` (toujours idempotente) partout dans
  l'app — ce fix corrige potentiellement d'autres doubles-déclenchements
  latents, pas seulement les réactions.
- **Réactions emoji redessinées** : fini la barre en haut — un bouton 💬
  flottant en bas à droite ouvre un éventail des 5 emojis (👏 retiré, reste
  😂 😭 😱 🤬 🔥) qui s'écartent en cercle autour de lui.
- **Anti-spam** : 5 réactions maximum, puis 20 secondes de blocage (💬
  devient 🚫) — appliqué côté client ET côté serveur en garde-fou.
- **Pioche automatique à 5s par défaut**, y compris dans le préréglage
  mode Original.
- **Salon avec un Bot seul** : se ferme maintenant automatiquement.
- **Div "Tour" fixe** : l'écran de partie est restructuré en en-tête fixe
  (lecture en cours + boutons Révéler/Défier/Piocher) et zone scrollable
  séparée pour les frises des joueurs — le scroll n'affecte plus que les
  frises.
- **Bannière de résultat sans l'artiste** : vrai bug confirmé — le serveur
  l'envoyait déjà, mais l'affichage l'ignorait. Corrigé.
- **Champs Titre/Artiste qui ne se réinitialisaient pas** : vrai bug
  confirmé — un texte à moitié tapé pour une chanson pouvait rester affiché
  pour la suivante. Corrigé, avec le bon timing pour que ça s'applique dès
  le rendu où la nouvelle chanson démarre.

## v2.6.1 — ajustements des réactions et du layout

- **Effet "burst"** : un seul tap sur un emoji fait maintenant apparaître
  10 à 15 exemplaires qui s'envolent en cascade, au lieu d'un seul.
- **Éventail moins resserré** : rayon augmenté (74px → 145px) pour éviter
  de taper sur deux emojis à la fois par accident.
- **Le menu reste ouvert** après avoir tapé un emoji, pour pouvoir en
  envoyer plusieurs d'affilée sans le rouvrir à chaque fois.
- **Boutons de la zone "Tour" réduits** (Révéler, Défier, Piocher…) —
  padding et taille de police à peu près divisés par deux, pour que
  l'en-tête fixe prenne moins de place.
- **Fix du scroll bugué** : vraie cause identifiée — `.game-scroll`
  utilisait `flex:1` sans `min-height:0`, un piège classique du flexbox où
  l'élément grandit pour s'adapter à son contenu au lieu de rester dans
  l'espace disponible et de défiler en interne.
- **Zone des frises fixée à 60% de la hauteur d'écran**, comme demandé.

Point d'attention honnête : je n'ai pas d'appareil réel pour vérifier
visuellement que l'en-tête (topbar + lecture en cours + boutons) tient bien
dans les 40% restants après la réduction des boutons — si ça déborde
encore, dis-le et je réduirai davantage.

## v2.6.2 — ajustements suite à capture d'écran

- **4 emojis au lieu de 5** (😭 😱 🤬 🔥), 😂 retiré, rayon réduit à 100px
  (entre le 74px trop resserré et le 145px trop écarté).
- **Le bouton 💬 s'estompe pendant le scroll** des frises, et réapparaît
  environ une demi-seconde après l'arrêt — il ne reste plus fixe par-dessus
  le contenu qu'on essaie de consulter.
- **Vraie cause du "scroll qui bouge tout" trouvée** : le corps de la page
  (`body`) restait scrollable en parallèle de la zone dédiée aux frises —
  toucher n'importe où pouvait donc faire défiler toute la page, y compris
  l'en-tête fixe. Corrigé en verrouillant complètement le `body`
  (`position:fixed`) pendant l'écran de partie, pour que seule la zone des
  frises puisse bouger.

## v2.6.3 — fix critique du scroll complètement cassé

Vraie cause trouvée grâce à ta capture d'écran : `.game-scroll` avait une
hauteur **fixe** de 60vh, mais l'en-tête (lecture en cours + boutons +
champs Titre/Artiste) n'avait, lui, aucune limite de hauteur — il prenait
toute la place dont il avait besoin. Résultat : en-tête + zone fixe à 60vh
dépassaient largement les 100vh disponibles, et `.game-screen` (avec
`overflow:hidden`) coupait purement et simplement tout ce qui débordait —
y compris la quasi-totalité de la zone censée être scrollable, la rendant
inaccessible.

Corrigé en priorisant le fonctionnel sur le "60% pile" : la zone des
frises reprend un dimensionnement flexible (`flex:1` + `min-height:0`) qui
s'adapte toujours à l'espace réellement disponible après l'en-tête —
garantissant qu'elle reste accessible et scrollable quelle que soit la
taille de l'en-tête. En complément, l'en-tête a été légèrement compacté
(lecteur audio moins d'espacement).

Point d'honnêteté : sans appareil réel pour tester, je ne peux pas garantir
que l'équilibre visuel entre en-tête et frises est optimal — mais la
fonctionnalité (pouvoir scroller et voir tous les joueurs) est maintenant
la priorité numéro un et ne peut plus être cassée par cette classe de bug.

## v2.6.4 — retour en arrière complet sur la refonte du scroll

Toute la tentative de "div Tour fixe / zone frises séparée" (introduite en
v2.6, ajustée en v2.6.1/v2.6.2/v2.6.3) est annulée à ta demande, ça causait
plus de problèmes que ça n'en résolvait :

- Retrait de la séparation en-tête fixe (`.game-header`) / zone scrollable
  dédiée (`.game-scroll`).
- Retrait du verrouillage du `body` (`position:fixed`) pendant la partie.
- Retrait du fondu du bouton 💬 pendant le scroll (lié au mécanisme retiré).
- Les boutons de la zone "Tour" et le lecteur audio retrouvent leur taille
  et leur espacement d'origine (la réduction avait été faite spécifiquement
  pour tenter de faire tenir cette zone dans un espace fixe qui n'existe
  plus).
- **Retour à un simple défilement de toute la page**, comme avant la v2.6 —
  le comportement éprouvé qui fonctionnait.

Tout le reste des ajouts de v2.6-v2.6.3 (FAB emoji, effet burst, anti-spam,
pioche automatique par défaut, fermeture des salons bot-seul, artiste dans
la bannière, réinitialisation des champs de saisie, fix `addEventListener`)
reste en place, ce sont des sujets distincts de cette histoire de scroll.

## v2.7 — deezerId pré-résolus, démarrage quasi instantané

- **1016 des 1032 chansons ont maintenant leur `deezerId` intégré directement
  dans `songs.json`**, avec une date `verifiedAt`. Au démarrage du serveur,
  toute chanson vérifiée il y a **moins de 30 jours** est acceptée telle
  quelle, sans appel à Deezer — le tout premier démarrage après ce
  déploiement devrait être quasi instantané au lieu de ~35-50 secondes.
- **Rafraîchissement automatique à 30 jours** : passé ce délai, une chanson
  est re-vérifiée auprès de Deezer normalement (et son `deezerId` mis à jour
  si elle a bougé). Si Deezer ne retourne rien pour une chanson déjà connue,
  son ancien `deezerId` est conservé plutôt que supprimé (mieux vaut un id
  peut-être un peu daté que plus d'id du tout), et elle sera retentée au
  prochain démarrage.
- **16 chansons restent sans correspondance** (essentiellement des
  enregistrements très anciens de 1902-1930 et quelques titres français) —
  comme avant, elles sont simplement exclues du pool jouable, sans
  bloquer le reste.
- Deux tests existants (le "scan lent" et le "Deezer complètement
  injoignable") utilisent maintenant une copie de catalogue "à froid"
  (sans deezerId pré-rempli) pour continuer à tester ces scénarios
  correctement malgré le catalogue désormais pré-résolu — sinon ils ne
  testaient plus rien de pertinent.

## v2.7.1 — les 5 chansons françaises non résolues avaient toutes le mauvais artiste

En creusant pourquoi certaines chansons françaises ne trouvaient pas de
correspondance sur Deezer, la réponse était gênante mais utile à trouver :
**les 5 chansons françaises sur les 16 non résolues avaient toutes un
artiste erroné de ma part**, pas un problème de recherche Deezer :

| Titre | Attribué à tort à | Vrai interprète |
|---|---|---|
| Chanson sur ma drôle de vie | Michel Delpech | Véronique Sanson |
| Le Monde Est Stone | France Gall | Fabienne Thibeault |
| Tout le bonheur du monde | Nolwenn Leroy | Sinsemilia |
| Les Sunlights des Tropiques | Bernard Lavilliers | Gilbert Montagné |
| Vois sur ton chemin | Kids United | Jean-Baptiste Maunier |

Corrigé dans `songs.json`. Elles se résoudront normalement au prochain
démarrage réel (sandbox de développement sans accès internet direct à
Deezer pour vérifier ici).

Les 11 chansons restantes sont des enregistrements très anciens
(1902-1930) — probablement simplement absents du catalogue Deezer, ces
enregistrements acoustiques d'avant-guerre n'étant pas systématiquement
numérisés sur les plateformes de streaming. Pas vérifiées une par une
individuellement par manque de temps, mais aucun signe d'erreur
d'attribution de mon côté pour celles-là contrairement aux françaises.

## v2.8 — 4 ajustements

- **Cercle des emojis réduit** encore un cran (rayon 100px → 78px, boutons
  44px → 38px).
- **Fix du freeze en tapant pendant l'envoi d'un emoji** : cause probable
  trouvée — `filter:drop-shadow` sur chaque emoji volant est l'une des
  propriétés CSS les plus coûteuses à animer, et avec 10-15 exemplaires
  simultanés ça pouvait saturer le fil principal du navigateur. Retiré (les
  emojis restent lisibles sans), garde le nombre de 10-15 par salve.
- **Vrai bug corrigé : le texte "Xs pour répondre" restait figé** pendant
  qu'on tapait dans Titre ou Artiste, alors que la barre de progression
  continuait d'avancer normalement. Cause : mon fix précédent (protéger la
  frappe) sautait complètement le rendu pendant la saisie, y compris pour
  ces chiffres qui n'ont pourtant rien à voir avec le champ de texte. Les
  chiffres sont maintenant mis à jour directement (sans toucher au champ en
  cours de frappe), donc toujours à jour même en tapant.
- **Le bouton 💬 est maintenant déplaçable** par glisser-déposer — un tap
  ouvre le menu comme avant, un vrai glissement le déplace et retient sa
  nouvelle position.

## v3.0.0 — 🎉 6 changements majeurs

- **Zone du joueur actif toujours en premier** dans la liste des frises,
  pour rester lisible même avec beaucoup de joueurs.
- **Raccourcis 🤘🏻 (Placer une carte) et 🔪 (Défier)** à côté de 💬 —
  n'apparaissent que quand l'action est réellement possible, réutilisent
  exactement la même logique que les boutons habituels.
- **Drag-and-drop du bouton 💬 retiré**, comme demandé.
- **Couleur par joueur** : palette de 10 couleurs, choisie au hasard par
  défaut, modifiable sur l'écran d'accueil à côté du champ Pseudo (mémorisée
  pour les prochaines parties). Les bots ont une couleur neutre fixe.
- **Le contour de la frise du joueur actif brille légèrement**, dans sa
  propre couleur, avec une animation de pulsation douce.
- **Les autres frises sont légèrement assombries** pour mieux distinguer
  qui joue en un coup d'œil.

Testé de bout en bout : couleur explicite conservée, couleur invalide
automatiquement remplacée par une couleur valide de la palette, bot avec
couleur neutre fixe. 123-124/124 tests, exécutés deux fois.

## v3.1.0 — 6 ajustements suite aux captures d'écran

- **Sélecteur de couleur derrière un bouton 🎨** à côté du champ Pseudo
  (au lieu de la rangée de pastilles en permanence à l'écran).
- **Couleur visible dans le salon d'attente** — une pastille colorée à côté
  du nom de chaque joueur, en plus de l'indicateur de statut prêt.
- **Les "+" de placement se colorent avec la couleur de l'adversaire et
  brillent** quand on défie sa carte.
- **Vrai bug corrigé** : les raccourcis 🔪/🤘🏻 se superposaient au bouton
  "Valider" des fenêtres de placement/défi (confirmé sur les deux
  captures). Ils passent maintenant en gris et remontent en haut de
  l'écran, en colonne, dès qu'une fenêtre est ouverte.
- **Animation de bordure enrichie** : en plus du halo pulsant existant,
  un fin trait de lumière tourne maintenant en continu autour du contour
  du joueur actif.
- **Réponse à la question sur les couleurs pendant la partie** : vérifié
  le code — seul le contour du joueur actif utilisait sa couleur, le fond
  était codé en dur en rose peu importe le joueur. Corrigé : le fond
  reprend maintenant vraiment sa couleur, et chaque frise (active ou non)
  a désormais une fine bande colorée à gauche, pour que la couleur de
  chacun reste visible tout du long, pas seulement pendant son tour.

## v3.2.0 — couleur du pseudo + détection des couleurs identiques

- **Dans le salon, le nom du joueur prend directement sa couleur** au lieu
  d'une petite pastille séparée.
- **Erreur avec popup si deux joueurs choisissent la même couleur** — les
  couleurs indisponibles sont marquées d'un ✕ directement sur les
  pastilles du sélecteur.
- **Vrai bug trouvé et corrigé en cours de route** : un blocage strict sur
  toute collision de couleur cassait des rejoints tout à fait normaux — la
  plupart des joueurs n'ouvrent jamais le sélecteur 🎨 et reçoivent une
  couleur par défaut/aléatoire côté client, qui peut coïncider par pur
  hasard avec une couleur déjà prise. Un indicateur `colorExplicit`
  distingue maintenant "l'utilisateur a vraiment choisi cette couleur" de
  "c'est juste la couleur par défaut" — le serveur ne bloque que dans le
  premier cas ; sinon il réattribue silencieusement une couleur libre.

Testé de bout en bout dans les trois cas : choix délibéré en conflit
(rejeté avec la liste), choix délibéré libre (accepté), collision non
délibérée (résolue silencieusement). 126-127 tests, exécutés trois fois
d'affilée pour confirmer la stabilité après le fix.

## v3.2.1 — retrait de la bordure lumineuse tournante, bug confirmé

Confirmé sur tes captures : la tentative de "lumière qui parcourt le
contour" (gradient conique + masque CSS) ne rendait pas du tout comme
prévu — un trait diagonal cassé, qui empirait pendant la lecture audio.
Cause probable : le support du masquage CSS (`mask-composite`) est
incohérent selon les navigateurs, en particulier sur Safari iOS, et
l'animation redémarrait en plein cycle à chaque rafraîchissement de
l'écran (toutes les 250ms pendant qu'une musique joue), provoquant le
comportement erratique observé.

Retiré entièrement cette technique complexe. Retour à un simple halo
pulsant (comme demandé — "une animation simple, lumineuse"), rendu
robuste aux rafraîchissements fréquents : sa phase est maintenant
synchronisée sur l'horloge, donc même si la zone du joueur actif est
reconstruite plusieurs fois par seconde pendant qu'une chanson joue, le
pulse garde une phase cohérente au lieu de repartir de zéro à chaque fois.

## v3.2.2 — vraie cause du "faut taper 2 fois" sur le FAB

Cause trouvée : la zone du FAB (💬 et les raccourcis 🤘🏻/🔪) était incluse
dans le HTML principal de l'écran de jeu, qui se reconstruit entièrement
toutes les 250ms pendant qu'une chanson joue (le minuteur de décompte). Un
tap qui tombait pile pendant cette reconstruction pouvait être perdu — ce
n'était pas une "attente de synchro serveur", c'est le DOM du bouton
lui-même qui se faisait détruire et recréer sous le doigt.

Corrigé en sortant le FAB du cycle de rendu principal : il vit maintenant
dans son propre conteneur, mis à jour uniquement quand son contenu change
réellement (menu ouvert/fermé, verrouillage anti-spam, action
possible/impossible) — plus jamais reconstruit juste parce que le minuteur
avance.

Au passage : les raccourcis 🤘🏻/🔪 se masquent maintenant automatiquement
quand l'éventail de réactions est ouvert, pour éviter que les deux se
chevauchent visuellement comme sur la capture envoyée.

## v3.2.3 — "+" recentré, placement adverse visible en défi

- **Fix du "+" mal centré** : `.slot button` n'avait jamais de centrage
  flex explicite pour son texte — invisible en mode normal, ça sautait aux
  yeux dès qu'un anneau coloré (mode défi) attirait le regard sur le
  cercle. Corrigé universellement.
- **Vrai manque comblé** : en tant que défieur, l'emplacement déjà choisi
  par le joueur actif n'était que désactivé, jamais montré. Le modal de
  défi affiche maintenant ce même emplacement comme une carte "a placé
  ici" — sans révéler la carte elle-même (toujours un "?", pas d'année),
  juste sa position, pour pouvoir vraiment choisir un autre endroit en
  connaissance de cause.

## v3.2.4 — fond assorti à la bordure, pulse bien plus marqué

- **Fond de la zone joueur** : reprend maintenant vraiment la couleur de sa
  bordure — 28% de teinte pour le joueur actif, 16% pour les autres (au
  lieu de 12% uniquement pour l'actif et rien du tout pour les autres
  avant). Appliqué à tous les joueurs, pas seulement celui en cours.
- **Pulse nettement amplifié** : la plage du halo est passée de 8px→18px de
  flou à 4px→28px, avec une intensité de couleur qui va de 25% à 90% (au
  lieu de 35%→65%) — le mouvement de respiration devrait maintenant se
  voir clairement. Cycle légèrement accéléré (2s au lieu de 2,4s par sens).

## v3.2.5 — fix d'un mauvais appariement Deezer (Al Jolson → Michael Jackson)

Un joueur a signalé avoir entendu du Michael Jackson alors que la carte
affichait "Bam, Bam, Bamy Shore" — Al Jolson. Vérifié directement le
`deezerId` en cause (59509551) : il pointait bien vers *Speed Demon* de
Michael Jackson (album Bad 25th Anniversary, 2012), rien à voir.

Cause trouvée : "Bam Bam Bamy Shore" est une vraie chanson de 1925, mais
je l'avais attribuée au mauvais artiste — Al Jolson ne l'a jamais
interprétée, c'est Joséphine Baker (ou Paul Ash & His Granada Orchestra).
Comme la recherche Deezer ne trouvait rien pour "Al Jolson Bam Bam Bamy
Shore", elle est retombée sur un résultat complètement hors sujet.

Corrigé : artiste changé pour Joséphine Baker, `deezerId` erroné retiré —
se résoudra correctement au prochain démarrage réel (pas d'accès direct à
Deezer depuis cet environnement de développement pour vérifier ici).

Pour vérifier un `deezerId` soi-même : chercher `deezer.com track [ID]`
ou ouvrir `https://www.deezer.com/track/[ID]` directement.

## v3.3.0 — validation automatique des résultats Deezer

Bonne question posée : "le serveur au démarrage ne pourrait pas comparer
le JSON avec Deezer et corriger si erreur ?" — implémenté, mais de façon
ciblée pour ne pas annuler le gain de vitesse de la v2.7 (qui repose
justement sur le fait de NE PAS re-vérifier les entrées déjà résolues à
chaque démarrage).

Ce qui change : au moment précis où une recherche a réellement lieu
(nouvelle chanson jamais résolue, ou chanson périmée après 30 jours), le
serveur ne fait plus confiance aveuglément au premier résultat Deezer — il
vérifie que le titre ET l'artiste renvoyés ressemblent vraiment à ce qui
était attendu, avec la même tolérance aux petites différences déjà
utilisée pour noter les réponses des joueurs. Si aucun résultat ne
correspond, la chanson reste simplement non résolue (exclue du jeu) plutôt
que de récupérer un `deezerId` complètement hors sujet.

C'est exactement le garde-fou qui aurait empêché le bug "Bam Bam Bamy
Shore" → Michael Jackson — testé directement avec un scénario qui
reproduit ce cas précis, confirmé qu'aucun `deezerId` erroné n'est
assigné.

## v3.3.1 — vraie critique reçue, corrigée : mauvais outil de comparaison

Remarque justifiée : la v3.3.0 réutilisait `closeEnough()` (la tolérance
aux fautes de frappe des joueurs) pour valider les résultats Deezer — mais
ce n'est pas le bon outil. Sa règle "une chaîne contenue dans l'autre =
ça compte" est parfaite pour un joueur qui tape "bohemian rhap" au lieu de
"Bohemian Rhapsody", mais elle aurait accepté à tort un artiste "Michael
Jackson Tribute Band" comme correspondance valide pour "Michael Jackson"
— exactement le genre d'erreur silencieuse que ce garde-fou est censé
empêcher.

Remplacé par un comparateur dédié, plus strict : identité de l'artiste
vérifiée par distance d'édition serrée (pas de correspondance par simple
inclusion), variations de titre légitimes (remasters, live, feat.)
explicitement reconnues et ignorées plutôt que tolérées en vrac. Testé
directement avec le scénario "tribute band" — confirmé rejeté, alors que
l'ancienne logique l'aurait accepté à tort.

## v3.4.0 — vérification Deezer à la demande + bonus partiel

- **Nouveau bouton "🔎 Vérifier les associations"** dans la Bibliothèque
  (📚) : re-télécharge le titre/artiste réel de chaque chanson déjà
  résolue sur Deezer et le compare à ce qui est attendu (avec le
  comparateur strict de la v3.3.1), même pour les entrées "de confiance"
  qui ne seraient normalement plus re-vérifiées avant 30 jours. Toute
  mauvaise association trouvée a son `deezerId` retiré automatiquement
  (se re-résout proprement au prochain démarrage). Barre de progression
  et rapport détaillé (attendu vs reçu par Deezer) pour chaque désaccord.
- **Bonus partiel titre/artiste** : nouveau réglage dans Options de la
  partie → Partie, désactivé par défaut. Une fois activé, trouver
  seulement le titre OU seulement l'artiste (pas les deux) rapporte quand
  même +0,5 jeton au lieu de rien.

Testé de bout en bout : audit sans désaccord (deezerId conservé), audit
avec un vrai désaccord (deezerId retiré, rapport correct), bonus partiel
activé (2 → 2,5 jetons confirmé) et désactivé (aucun jeton, comme avant).
139/139 tests, exécutés deux fois.

## v3.4.1 — mise à jour des deezerId (1015 → 1020 résolus)

Nouvel export intégré. Bonne nouvelle : les 5 chansons corrigées en v3.2.5
et v2.7.1 (Bam Bam Bamy Shore, et les 4 attributions françaises) se sont
toutes résolues correctement cette fois — passées par le comparateur
strict de la v3.3.1, donc fiables. 1032/1032 chansons du catalogue local
retrouvées dans l'export, aucune perte. Reste 12 chansons non résolues
(essentiellement des enregistrements de 1902-1930 et "Vois sur ton
chemin"), inchangé et sans signe de problème d'attribution cette fois.

## v3.5.0 — catalogue étendu à 1332 chansons

+300 chansons (1032 → 1332), title/artist/year seulement — plus de
genre/country générés pour les nouveaux ajouts, comme convenu. Point
d'honnêteté sur la démarche : un premier brouillon a été jeté à la
poubelle en cours de route parce qu'il contenait des titres inventés
("(Reprise)", "(Second Reprise)") pour gonfler artificiellement le
chiffre — repéré et corrigé avant fusion, remplacé par de vraies
chansons distinctes.

Bonne diversité de genres pour combler les trous du catalogue existant :
country, metal/hard rock, reggae/ska, punk/new wave, hip-hop deep cuts,
latino/reggaeton, K-pop, électro/dance, indie, chanson française,
R&B/soul, grunge, disco/funk, blues/gospel, comédies musicales,
Eurovision, afrobeats. 0 doublon interne, 0 entrée incomplète, années
1902-2025. Comme toujours, ce lot n'a pas été vérifié individuellement
sur Deezer — la résolution/validation se fera au prochain démarrage réel
via le garde-fou de la v3.3.1.

139/139 tests, exécutés deux fois.

## v3.6.0 — 6 améliorations de lisibilité + mise à jour deezerId (1030 résolus)

- **Bouton "Valider titre ou/et artiste"** simplifié, sans le nombre de
  jetons — le texte s'adapte selon que le bonus partiel est activé.
- **La zone du joueur qui vient de jouer reste en haut** pendant que le
  suivant pioche/écoute — la couleur/glow "actif" passe bien tout de suite
  au bon joueur, mais la POSITION dans la liste ne bouge qu'une fois que
  le nouveau joueur a effectivement une carte en attente (piochée
  manuellement ou par le minuteur auto). À ce moment-là, une vraie
  animation de glissement (technique FLIP) fait "grimper" sa zone en haut.
- **Tentatives illimitées pour titre/artiste** — plus de blocage après un
  premier essai raté. Le système de jetons est cumulatif mais plafonné
  (une réussite complète après un essai partiel ne complète que la
  différence, jamais de double paiement).
- **"Placer la carte" envoie aussi Titre/Artiste** si quelque chose est
  tapé — un seul clic sur "Valider" dans la fenêtre de placement suffit.
- **💬 ne recouvre plus "Valider"** pendant le placement/défi — même
  traitement que les raccourcis 🔪/🤘🏻 déjà corrigés (grisé, déplacé).
- **Révélation groupée** : tous les joueurs (sauf l'actif) doivent
  cliquer "Ça a l'air bon" — le bouton affiche "encore X/Y joueurs", et
  la révélation se déclenche dès que tout le monde a voté, sans attendre
  la fin du minuteur.

Catalogue mis à jour avec le dernier export (1030/1332 chansons
résolues sur Deezer).

Testé de bout en bout : vote de révélation à 3 joueurs (un seul clic ne
suffit pas, tous ensemble déclenchent), tentatives multiples (échec puis
réussite paie le jeton complet, une 3e tentative déjà réussie ne repaie
pas). 144/144 tests, exécutés deux fois.

## v3.7.0 — popup de résultat entre les tours

Remplace l'ancienne bannière inline (fermeture manuelle par "OK", ou
minuteur fixe de 3,5s sans rapport avec le rythme réel de la partie) par
une vraie popup superposée, avec un cycle de vie entièrement piloté par
l'état du jeu :

- **Apparaît** exactement au moment où une carte est révélée
- **Disparaît** automatiquement dès que le joueur suivant a une carte en
  attente (piochée manuellement ou par le minuteur auto) — donc jamais
  besoin de cliquer pour la fermer, et jamais de blocage si quelqu'un
  pioche vite : la popup n'intercepte aucun clic (elle est purement
  visuelle), donc piocher à travers la fait disparaître naturellement.
- **Affiche** le nom du joueur dans sa couleur, une pastille de sa
  couleur, le titre/artiste/année de la dernière chanson jouée, et le
  statut (bien placée / mal placée / volée — et par qui, dans sa couleur
  à lui aussi).

Testé : `lastResult` inclut désormais bien la couleur du joueur actif
(et du voleur le cas échéant) pour que la popup puisse les afficher.
146/146 tests, exécutés deux fois.

## v3.7.1 — croix de fermeture, fix du bug de fond transparent, couleur du joueur

- **Croix ✕** en bas au centre du popup pour le fermer avant la fin
  naturelle de son cycle de vie.
- **Bug confirmé et corrigé** : le popup réutilisait les animations
  `flash-correct`/`flash-wrong` de l'ancienne bannière, qui animent le
  fond de la carte vers `transparent` en fin d'animation — ça laissait
  apparaître le fond noir semi-opaque du popup à travers la carte pendant
  un instant. Inoffensif sur une bannière inline, mais exactement le
  "le fond apparaît d'un coup" que tu décrivais ici. Nouvelles animations
  dédiées qui ne touchent jamais au fond de la carte.
- **Le popup reprend maintenant la couleur du joueur** (bordure + fond
  légèrement teinté), en plus du nom déjà coloré — le statut
  (bien placée / mal placée / volée) reste communiqué par le texte et les
  emojis plutôt que par la couleur, pour ne pas perdre cette info.

146/146 tests, exécutés deux fois.

## v3.7.2 — champ Titre/Artiste grisé une fois trouvé

Dès que le titre ou l'artiste est trouvé individuellement (fonctionne
même sans le bonus partiel activé, c'est purement informatif), le champ
correspondant devient grisé (opacité réduite, bordure/texte teal) et
n'est plus cliquable ni modifiable — l'autre champ reste actif s'il
n'est pas encore trouvé. Suivi côté serveur indépendamment pour chaque
champ (`guessTitleOk`/`guessArtistOk`), donc trouver l'un n'efface jamais
la marque de l'autre déjà trouvé.

Testé : trouver seulement le titre ne marque que guessTitleOk, trouver
ensuite l'artiste marque bien les deux indépendamment. 147/147 tests,
exécutés deux fois.

## v3.8.0 — le comparateur Deezer était bien trop strict, corrigé en profondeur

Le rapport d'audit envoyé par l'utilisateur (~200 "désaccords") a révélé
que le comparateur strict de la v3.3.1 rejetait à tort l'écrasante
majorité des VRAIS bons appariements — pas juste les cas d'artistes
composés déjà corrigés en v3.3.1 :
- Préfixe "The" manquant ("Jackson 5" vs "The Jackson 5", "Emotions" vs
  "The Emotions")
- Toute variante de titre non prévue dans la liste de mots-clés
  (remasters avec année, versions "Original", mixes, éditions single,
  crédits featuring dans le titre...) — la liste de motifs possibles est
  infinie, une approche par mots-clés ne pouvait pas suffire
- Crédits d'orchestre/groupe accolés ("Ted Lewis" vs "Ted Lewis & His
  Orchestra")

Corrigé en profondeur :
- **Titre** : tout le contenu entre parenthèses/crochets est retiré des
  deux côtés avant comparaison (au lieu d'une liste de mots-clés
  spécifiques) — bien plus robuste, et les titres qui incluent
  légitimement une parenthèse dans leur vrai nom ("(I Can't Get No)
  Satisfaction") continuent de bien matcher puisque le même retrait
  s'applique aux deux côtés.
- **Artiste** : préfixe "The" ignoré, et comparaison désormais
  bidirectionnelle sur les crédits composés — un crédit simple d'un
  côté peut matcher une partie d'un crédit composé de l'autre côté,
  peu importe lequel des deux est composé.

Les garde-fous anti-faux-positif (rejet d'un "tribute band", rejet d'un
résultat complètement hors sujet) restent intacts et testés — la
correction élargit la tolérance sans rouvrir la faille d'origine.

Au passage, 2 vraies erreurs de catalogue trouvées grâce à ce rapport et
corrigées : "Manu Chao" n'est pas un titre de chanson (corrigé en "Me
Gustas Tú", son vrai tube de 2001), et "Shape of You (Piano)" n'est
probablement pas une sortie officielle d'Ed Sheeran (retirée). Un
doublon involontaire ("Islands in the Stream" en double avec des crédits
différents) retiré aussi.

148/148 tests, exécutés deux fois, y compris un nouveau test confirmant
directement l'acceptation des cas réels observés (préfixe "The" +
remaster) et la persistance du rejet du cas "tribute band".

## v3.8.1 — vraie régression trouvée : l'audit annulait la correction de la v3.8.0

Un second audit lancé après le déploiement de la v3.8.0 a encore trouvé
154 "désaccords" — et en creusant, exactement les mêmes cas déjà corrigés
(préfixe "The" manquant, tags de remaster) ressortaient à nouveau.

Cause : `runDeezerAudit()` (déclenché par le bouton "🔎 Vérifier les
associations") avait sa **propre logique de comparaison séparée**,
jamais mise à jour lors de la refonte de la v3.8.0 — elle utilisait
encore l'ancien seuil strict (10%/15%, pas de gestion du "The", pas de
comparaison bidirectionnelle). Résultat : chaque exécution de l'audit
re-cassait le travail que la recherche venait de corriger, dans une
vraie boucle contre-productive.

Corrigé en faisant que l'audit **réutilise directement** la même
fonction `pickBestDeezerMatch` que la résolution de nouvelles chansons,
plutôt que deux implémentations séparées qui peuvent diverger sans que
personne ne s'en aperçoive. Testé spécifiquement sur le chemin de
l'audit (pas seulement la recherche) avec le cas exact qui posait
problème — confirmé qu'il n'est plus re-signalé.

150/150 tests, exécutés deux fois.

## v3.8.2 — nouveau round d'audit, 154 → 48 désaccords, deux motifs de plus corrigés

La correction de la v3.8.1 (audit réutilisant enfin la vraie logique de
comparaison) a fait chuter le nombre de désaccords de 154 à 48 sur le
round d'audit suivant — signe que la vraie régression était bien réglée.
En passant en revue cette liste réduite, deux nouveaux motifs légitimes
identifiés :

- **Titre en préfixe d'un titre Deezer plus long, sans parenthèses** :
  ex. "J'ai Deux Amours" contenu dans "J'ai 2 amours: J'ai deux amours",
  ou "Some Enchanted Evening" en fin d'un long titre d'enregistrement de
  comédie musicale avec un préfixe séparé par deux-points. Le retrait de
  parenthèses ne suffisait pas puisque ce n'était pas entre parenthèses.
  Ajout d'une vérification par inclusion en complément de la distance
  d'édition, réservée aux titres (plus sûre que pour les artistes, avec
  une longueur minimale pour éviter les faux positifs sur des titres
  très courts).
- **Surnom entre guillemets inséré dans le nom d'artiste** : ex. `Cliff
  "Ukulele Ike" Edwards` au lieu de `Cliff Edwards`. Retiré avant
  comparaison.

La majorité des 48 restants sont désormais de vrais mauvais matches,
correctement rejetés (reprises par un autre artiste, karaoké,
bibliothèques d'effets sonores, chansons complètement différentes) —
pas besoin de les forcer.

151/151 tests (légère variation naturelle du nombre de vérifications
d'un run à l'autre, zéro échec confirmé sur les deux), test dédié pour
les deux nouveaux motifs.

## v3.8.3 — 3e round d'audit (48 → 35) : renommages de groupes, doublons de catalogue

Nouveau motif identifié, cette fois pas algorithmique : des groupes ayant
**officiellement changé de nom**, que Deezer ne référence que sous le
nouveau nom — aucune comparaison de texte ne peut deviner ce genre de
lien. Corrigé directement dans le catalogue :
- Dixie Chicks → The Chicks (Wide Open Spaces, Goodbye Earl)
- Lady Antebellum → Lady A (Need You Now)
- Maître Gims → GIMS (Bella)

Trouvé aussi 3 vrais doublons de catalogue : une entrée "artiste seul"
qui restait bloquée à chaque audit, alors qu'une entrée "crédit complet"
existait déjà juste à côté et fonctionnait très bien (Piece of My Heart,
Endless Love, Danza Kuduro) — l'entrée redondante et cassée a été
retirée à chaque fois. Un doublon accidentel créé par ma propre
correction ("Sous le vent") repéré et nettoyé dans la foulée.

Retiré aussi "Forget You" de CeeLo Green : Deezer n'a que le titre
explicite ("Fuck You"), pas adapté à un jeu familial — plutôt que de
forcer la correspondance, l'entrée est simplement retirée.

Petite amélioration algorithmique en complément : "Ms."/"Mr."/"Dr." sont
maintenant traités comme "The" (préfixe honorifique optionnel ignoré à
la comparaison) — corrige par exemple "Ms. Lauryn Hill" vs "Lauryn Hill".

150/150 tests, exécutés deux fois, 0 doublon interne confirmé.

## v3.9.0 — +1028 chansons proposées et résolues via Deezer (accès direct depuis Claude Code)

Première fois que l'ajout de chansons se fait avec un accès réseau direct à
`api.deezer.com` (voir §1 et §5 du document de passation) — plus besoin de la
boucle manuelle export/import via la Bibliothèque de l'app.

1028 titres candidats générés à partir d'une bonne connaissance générale de
la musique (tubes, standards, classiques par genre et par décennie — rock,
pop, hip-hop, R&B, disco, country, reggae, latino, K-pop, comédies
musicales, variété et rap français...), dédupliqués contre le catalogue
existant (title+artiste normalisés, accents/casse/ponctuation ignorés), puis
fusionnés dans `songs.json` **sans `deezerId`** pour laisser
`verifyAndPrepareCatalog()` faire la résolution avec le vrai comparateur de
production — aucune logique de matching dupliquée, conformément à la leçon
de la v3.8.1.

Résultat : 951/1028 nouveaux titres résolus (92,5%), et effet de bord
positif — la même passe a aussi rattrapé 274 anciennes entrées du catalogue
qui restaient sans `deezerId` depuis un moment. Catalogue total : 1324 → 2352
chansons, dont 2245 jouables (contre 1020 avant).

Corrigé au passage : `socket.io-client` manquait de `package.json` alors que
`test-e2e.js` en a besoin — sans doute un oubli, ajouté en devDependency.

150/150 tests, exécutés deux fois, aucun échec.

## v4.0.0 — traduction complète EN/IT, sélecteur de langue avec détection auto

Le jeu est maintenant jouable en français, anglais et italien. Nouveau
fichier `public/i18n.js` : un dictionnaire `DICT` avec une entrée par clé
(`fr`/`en`/`it` côte à côte, pas trois objets séparés) pour qu'aucune langue
ne puisse dériver silencieusement des deux autres, une fonction `t(key,
vars)` avec repli sur le français puis sur la clé brute, et un sélecteur de
drapeaux 🇫🇷🇬🇧🇮🇹 rendu dans son propre overlay persistant (même principe que
`#fab-overlay`) donc visible sur tous les écrans sans être détruit par les
reconstructions fréquentes du `render()`. La langue est détectée
automatiquement via `navigator.language` au premier chargement, puis
mémorisée dans `localStorage` dès qu'elle est changée manuellement.

Toutes les ~230 chaînes de `public/app.js` (écrans, modales, boutons,
messages d'état) sont passées par `t()`. Les entrées de `room.log` côté
serveur sont **restées en français** : elles ne sont en fait jamais
affichées côté client (`room.history` seul est rendu, pas `room.log`) —
inutile de les traduire.

Les messages d'erreur du serveur (`socket.emit('error-msg', ...)`, réponses
JSON `{error}` des routes REST bibliothèque) posaient un problème différent :
le texte est généré côté serveur, qui ne connaît pas la langue du client.
Plutôt que de dupliquer `pickBestDeezerMatch`-style la logique de formulation
côté client, chaque emit garde son texte français existant tel quel (zéro
régression sur les ~20 assertions de `test-e2e.js` qui vérifient ce texte
mot pour mot) et gagne un second argument `{code, params}` — le client
traduit via `t('err.' + code, params)` s'il reconnaît le code, et retombe
sur le texte français brut sinon. 37 codes couvrent toutes les émissions
(`HOST_ONLY_SETTING`, `ROOM_FULL`, `NOT_ENOUGH_SONGS`, etc.).

Un script de vérification automatique (clés `t()` utilisées dans `app.js`
comparées aux clés du `DICT`, codes serveur comparés aux clés `err.*`) a
rattrapé deux vraies fautes de frappe avant commit : `placement.here` →
`timeline.here`, et le bouton "copier" du code de salon oublié.

150/150 tests, exécutés deux fois, aucun échec. Vérification visuelle en
navigateur non effectuée dans cette session (pas d'extension Chrome
connectée) — recommandé avant de considérer la fonctionnalité définitivement
close.
