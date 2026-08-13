/* =========================================================
   CHRONOLOZIK — i18n
   One entry per key, with fr/en/it side by side so the three
   languages can never silently drift out of sync with each other.
   t(key, vars) looks up the current language, falls back to fr,
   then to the raw key. Values can be a function(vars) for anything
   that needs pluralization or other logic instead of a flat string.
   ========================================================= */

const LANG_KEY = 'chronolozik_lang';
const SUPPORTED_LANGS = ['fr', 'en', 'it'];

function detectBrowserLang() {
  const raw = (navigator.language || (navigator.languages && navigator.languages[0]) || 'fr');
  const short = raw.slice(0, 2).toLowerCase();
  return SUPPORTED_LANGS.includes(short) ? short : 'fr';
}
function loadLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && SUPPORTED_LANGS.includes(saved)) return saved;
  } catch (e) {}
  return detectBrowserLang();
}
let currentLang = loadLang();
function getLang() { return currentLang; }
function setLang(l) {
  if (!SUPPORTED_LANGS.includes(l)) return;
  currentLang = l;
  try { localStorage.setItem(LANG_KEY, l); } catch (e) {}
  document.documentElement.setAttribute('lang', l);
}
document.documentElement.setAttribute('lang', currentLang);

const DICT = {
  /* ---------- welcome screen ---------- */
  'welcome.rule1Title': { fr: 'Écoutez', en: 'Listen', it: 'Ascolta' },
  'welcome.rule1Text': { fr: "Un extrait de 30 secondes joue — pas de titre, pas d'artiste, juste le son.", en: 'A 30-second clip plays — no title, no artist, just the sound.', it: 'Parte una clip di 30 secondi — niente titolo, niente artista, solo il suono.' },
  'welcome.rule2Title': { fr: 'Placez', en: 'Place', it: 'Posiziona' },
  'welcome.rule2Text': { fr: 'Devinez si la chanson est avant, après, ou entre celles déjà sur votre frise.', en: 'Guess whether the song comes before, after, or between the ones already on your timeline.', it: 'Indovina se la canzone viene prima, dopo, o tra quelle già sulla tua timeline.' },
  'welcome.rule3Title': { fr: 'Défiez', en: 'Challenge', it: 'Sfida' },
  'welcome.rule3Text': { fr: "Les autres ont un délai pour parier qu'ils devinent mieux — et voler la carte.", en: 'The others have a window to bet they can guess better — and steal the card.', it: 'Gli altri hanno un po\' di tempo per scommettere di indovinare meglio — e rubare la carta.' },
  'welcome.rule4Title': { fr: 'Gagnez', en: 'Win', it: 'Vinci' },
  'welcome.rule4Text': { fr: (v) => `Le premier à ${v.count} chansons bien placées remporte la partie.`, en: (v) => `First to ${v.count} correctly placed songs wins the game.`, it: (v) => `Il primo a piazzare correttamente ${v.count} canzoni vince la partita.` },
  'welcome.subtitle': { fr: 'Le jeu qui teste ta mémoire musicale, entre amis.', en: 'The game that tests your musical memory, with friends.', it: 'Il gioco che mette alla prova la tua memoria musicale, tra amici.' },
  'welcome.continueBtn': { fr: "C'est parti 🚀", en: "Let's go 🚀", it: 'Si parte 🚀' },

  /* ---------- loading screen ---------- */
  'loading.subtitle': { fr: 'Chargement, veuillez patienter.', en: 'Loading, please wait.', it: 'Caricamento in corso, attendere.' },
  'loading.progress': { fr: (v) => `${v.checked} / ${v.total} chansons vérifiées`, en: (v) => `${v.checked} / ${v.total} songs checked`, it: (v) => `${v.checked} / ${v.total} canzoni verificate` },
  'loading.starting': { fr: 'Démarrage…', en: 'Starting…', it: 'Avvio…' },
  'loading.footerNote': { fr: 'Ça prend en général 1 à 2 minutes — le serveur reste volontairement lent pour respecter la limite de débit de Deezer.', en: 'This usually takes 1-2 minutes — the server deliberately paces itself to respect Deezer\'s rate limit.', it: 'Di solito ci vogliono 1-2 minuti — il server rallenta volutamente per rispettare il limite di richieste di Deezer.' },

  /* ---------- connection banner ---------- */
  'conn.reconnecting': { fr: '🔄 Reconnexion à ton salon…', en: '🔄 Reconnecting to your room…', it: '🔄 Riconnessione alla tua stanza…' },
  'conn.lost': { fr: '🔌 Connexion perdue — nouvelle tentative…', en: '🔌 Connection lost — retrying…', it: '🔌 Connessione persa — nuovo tentativo…' },

  /* ---------- home screen ---------- */
  'home.createTab': { fr: 'Créer un salon', en: 'Create a room', it: 'Crea una stanza' },
  'home.joinTab': { fr: 'Rejoindre', en: 'Join', it: 'Unisciti' },
  'home.yourName': { fr: 'Ton prénom', en: 'Your name', it: 'Il tuo nome' },
  'home.namePlaceholder': { fr: 'Ex. Léa', en: 'e.g. Mia', it: 'Es. Giulia' },
  'home.pickColorTitle': { fr: 'Choisir sa couleur', en: 'Choose your color', it: 'Scegli il tuo colore' },
  'home.visibility': { fr: 'Visibilité du salon', en: 'Room visibility', it: 'Visibilità della stanza' },
  'home.private': { fr: '🔒 Privé', en: '🔒 Private', it: '🔒 Privata' },
  'home.public': { fr: '🌐 Public', en: '🌐 Public', it: '🌐 Pubblica' },
  'home.visibilityPublicDesc': { fr: 'Visible par tout le monde dans la liste des salons publics.', en: 'Visible to everyone in the public rooms list.', it: 'Visibile a tutti nella lista delle stanze pubbliche.' },
  'home.visibilityPrivateDesc': { fr: 'Rejoignable seulement avec le code.', en: 'Joinable only with the code.', it: 'Si può accedere solo con il codice.' },
  'home.roomCode': { fr: 'Code du salon', en: 'Room code', it: 'Codice stanza' },
  'home.createBtn': { fr: 'Créer le salon', en: 'Create room', it: 'Crea stanza' },
  'home.joinBtn': { fr: 'Rejoindre', en: 'Join', it: 'Unisciti' },

  /* ---------- color picker modal ---------- */
  'colorPicker.title': { fr: 'Ta couleur', en: 'Your color', it: 'Il tuo colore' },
  'colorPicker.takenWarning': { fr: "Cette couleur est déjà prise dans ce salon. Couleurs indisponibles marquées d'une ✕ — choisis-en une autre.", en: 'This color is already taken in this room. Unavailable colors are marked with an ✕ — pick another one.', it: 'Questo colore è già occupato in questa stanza. I colori non disponibili sono segnati con una ✕ — scegline un altro.' },
  'colorPicker.taken': { fr: 'Déjà prise', en: 'Already taken', it: 'Già occupato' },

  /* ---------- public rooms list ---------- */
  'publicRooms.title': { fr: '🌐 Salons publics', en: '🌐 Public rooms', it: '🌐 Stanze pubbliche' },
  'publicRooms.loading': { fr: 'Chargement…', en: 'Loading…', it: 'Caricamento…' },
  'publicRooms.empty': { fr: 'Aucun salon public ouvert pour l\'instant.', en: 'No public room open right now.', it: 'Nessuna stanza pubblica aperta al momento.' },
  'publicRooms.playerCount': { fr: (v) => `(${v.count}${v.max ? '/' + v.max : ''} joueur${v.count > 1 ? 's' : ''})`, en: (v) => `(${v.count}${v.max ? '/' + v.max : ''} player${v.count > 1 ? 's' : ''})`, it: (v) => `(${v.count}${v.max ? '/' + v.max : ''} giocator${v.count > 1 ? 'i' : 'e'})` },
  'publicRooms.join': { fr: 'Rejoindre', en: 'Join', it: 'Unisciti' },

  /* ---------- lobby ---------- */
  'lobby.title': { fr: "Salon d'attente", en: 'Waiting room', it: "Stanza d'attesa" },
  'lobby.shareCode': { fr: (v) => `Partage le code ${v.code} avec tes amis, sur le même Wi-Fi.`, en: (v) => `Share the code ${v.code} with your friends, on the same Wi-Fi.`, it: (v) => `Condividi il codice ${v.code} con i tuoi amici, sulla stessa Wi-Fi.` },
  'lobby.copy': { fr: 'copier', en: 'copy', it: 'copia' },
  'lobby.players': { fr: 'Joueurs', en: 'Players', it: 'Giocatori' },
  'lobby.you': { fr: ' (toi)', en: ' (you)', it: ' (tu)' },
  'lobby.hostOnly': { fr: (v) => `👑 ${v.host} est l'hôte — seul·e à pouvoir changer les réglages et lancer la partie.`, en: (v) => `👑 ${v.host} is the host — only they can change settings and start the game.`, it: (v) => `👑 ${v.host} è l'host — solo lui/lei può cambiare le impostazioni e avviare la partita.` },
  'lobby.addBot': { fr: '🧪 Ajouter un bot pour tester seul', en: '🧪 Add a bot to test solo', it: '🧪 Aggiungi un bot per testare da solo' },
  'lobby.removeBot': { fr: 'Retirer le bot de test', en: 'Remove the test bot', it: 'Rimuovi il bot di prova' },
  'lobby.kickPlayer': { fr: 'Exclure ce joueur du salon ?', en: 'Remove this player from the room?', it: 'Rimuovere questo giocatore dalla stanza?' },
  'lobby.ready': { fr: '✅ Prêt(e) (active le son)', en: '✅ Ready (enables sound)', it: '✅ Pronto/a (attiva il suono)' },
  'lobby.notReady': { fr: '⏳ Se marquer non prêt(e)', en: '⏳ Mark as not ready', it: '⏳ Segnati come non pronto/a' },
  'lobby.optionsRecap': { fr: 'Résumé des options', en: 'Options summary', it: 'Riepilogo opzioni' },
  'lobby.gameOptions': { fr: '⚙️ Options de la partie', en: '⚙️ Game options', it: '⚙️ Opzioni della partita' },
  'lobby.waitingSecondPlayer': { fr: "En attente d'un 2e joueur…", en: 'Waiting for a 2nd player…', it: 'In attesa di un secondo giocatore…' },
  'lobby.startGame': { fr: (v) => `Lancer la partie (${v.ready}/${v.total} prêts)`, en: (v) => `Start game (${v.ready}/${v.total} ready)`, it: (v) => `Avvia partita (${v.ready}/${v.total} pronti)` },
  'lobby.waitingHostStart': { fr: "En attente que l'hôte lance la partie…", en: 'Waiting for the host to start the game…', it: "In attesa che l'host avvii la partita…" },
  'lobby.rules': { fr: 'Règles', en: 'Rules', it: 'Regole' },
  'lobby.library': { fr: (v) => `📚 Bibliothèque (${v.count})`, en: (v) => `📚 Library (${v.count})`, it: (v) => `📚 Libreria (${v.count})` },
  'lobby.previousGames': { fr: 'Parties précédentes dans ce salon', en: 'Previous games in this room', it: 'Partite precedenti in questa stanza' },
  'lobby.won': { fr: 'a gagné —', en: 'won —', it: 'ha vinto —' },

  /* ---------- lobby options recap chips ---------- */
  'recap.directBuy': { fr: 'Achat direct', en: 'Direct buy', it: 'Acquisto diretto' },
  'recap.partialBonus': { fr: 'Bonus partiel', en: 'Partial bonus', it: 'Bonus parziale' },
  'recap.public': { fr: 'Public', en: 'Public', it: 'Pubblica' },
  'recap.private': { fr: 'Privé', en: 'Private', it: 'Privata' },
  'recap.together': { fr: 'Ensemble', en: 'Together', it: 'Insieme' },
  'recap.solo': { fr: 'Solo', en: 'Solo', it: 'Da soli' },
  'recap.unlimited': { fr: '∞', en: '∞', it: '∞' },
  'recap.manual': { fr: 'Manuel', en: 'Manual', it: 'Manuale' },

  /* ---------- options modal ---------- */
  'options.title': { fr: 'Options de la partie', en: 'Game options', it: 'Opzioni della partita' },
  'options.tabModes': { fr: '🎮 Modes', en: '🎮 Modes', it: '🎮 Modalità' },
  'options.tabPartie': { fr: '⚙️ Partie', en: '⚙️ Game', it: '⚙️ Partita' },
  'options.tabEcoute': { fr: '🔊 Écoute', en: '🔊 Listening', it: '🔊 Ascolto' },
  'options.tabTemps': { fr: '⏱️ Temps', en: '⏱️ Timing', it: '⏱️ Tempi' },
  'options.tabChansons': { fr: '🎵 Chansons', en: '🎵 Songs', it: '🎵 Canzoni' },
  'options.close': { fr: 'Fermer', en: 'Close', it: 'Chiudi' },

  'modes.intro': { fr: "Des préréglages qui appliquent d'un coup une combinaison des réglages ci-contre — rien de nouveau, juste plus rapide à mettre en place.", en: 'Presets that apply a whole combination of the settings on the other tabs at once — nothing new, just faster to set up.', it: 'Preimpostazioni che applicano subito una combinazione delle altre impostazioni — niente di nuovo, solo più veloce da configurare.' },
  'modes.original.title': { fr: 'Original', en: 'Original', it: 'Originale' },
  'modes.original.desc': { fr: '10 cartes pour gagner, 2 jetons de départ, 15s pour révéler, 60s pour répondre. Les réglages par défaut.', en: '10 cards to win, 2 starting tokens, 15s to reveal, 60s to answer. The default settings.', it: '10 carte per vincere, 2 gettoni iniziali, 15s per rivelare, 60s per rispondere. Le impostazioni predefinite.' },
  'modes.hardcore.title': { fr: 'Hardcore', en: 'Hardcore', it: 'Hardcore' },
  'modes.hardcore.desc': { fr: '0 jeton de départ (donc pas moyen de passer au début), 5s seulement pour révéler, 15s pour répondre. En plus : chaque erreur fait perdre une carte au hasard de sa propre frise, remise dans la pioche.', en: "0 starting tokens (so no way to skip early on), only 5s to reveal, 15s to answer. Plus: every mistake costs you a random card from your own timeline, shuffled back into the deck.", it: '0 gettoni iniziali (quindi impossibile passare all\'inizio), solo 5s per rivelare, 15s per rispondere. In più: ogni errore fa perdere una carta a caso dalla propria timeline, rimessa nel mazzo.' },
  'modes.enemies.title': { fr: 'Fais-toi des ennemis', en: 'Make enemies', it: 'Fatti dei nemici' },
  'modes.enemies.desc': { fr: '12 cartes pour gagner, 4 jetons de départ, délai de révélation allongé à 20s — de quoi défier bien plus souvent avant que ça se referme.', en: '12 cards to win, 4 starting tokens, reveal delay stretched to 20s — plenty of time to challenge much more often before the window closes.', it: '12 carte per vincere, 4 gettoni iniziali, ritardo di rivelazione esteso a 20s — tempo per sfidare molto più spesso prima che si chiuda.' },
  'modes.hostOnly': { fr: 'Seul l\'hôte peut changer le mode.', en: 'Only the host can change the mode.', it: "Solo l'host può cambiare la modalità." },

  'partie.cardsToWinTitle': { fr: 'Cartes pour gagner', en: 'Cards to win', it: 'Carte per vincere' },
  'partie.cardsToWinDesc': { fr: 'Le premier à ce nombre de chansons bien placées remporte la partie.', en: 'The first to reach this many correctly placed songs wins the game.', it: 'Il primo a raggiungere questo numero di canzoni piazzate correttamente vince la partita.' },
  'partie.startTokensTitle': { fr: 'Jetons de départ', en: 'Starting tokens', it: 'Gettoni iniziali' },
  'partie.startTokensDesc': { fr: 'Le nombre de jetons que chaque joueur a au début de la partie.', en: 'The number of tokens each player has at the start of the game.', it: "Il numero di gettoni che ogni giocatore ha all'inizio della partita." },
  'partie.maxPlayersTitle': { fr: 'Nombre de joueurs maximum', en: 'Maximum number of players', it: 'Numero massimo di giocatori' },
  'partie.unlimited': { fr: 'Illimité', en: 'Unlimited', it: 'Illimitato' },
  'partie.maxPlayersSuffix': { fr: (v) => `${v.count} joueurs max`, en: (v) => `${v.count} players max`, it: (v) => `${v.count} giocatori max` },
  'partie.customPlaceholder': { fr: 'Personnalisé (2-20)', en: 'Custom (2-20)', it: 'Personalizzato (2-20)' },
  'partie.validate': { fr: 'Valider', en: 'Confirm', it: 'Conferma' },
  'partie.visibilityTitle': { fr: 'Visibilité', en: 'Visibility', it: 'Visibilità' },
  'partie.freeCardTitle': { fr: 'Achat direct de carte', en: 'Direct card purchase', it: 'Acquisto diretto della carta' },
  'partie.freeCardDesc': { fr: "Échanger 3 jetons pour poser une carte directement sur sa frise, sans l'écouter ni la deviner.", en: 'Spend 3 tokens to place a card directly on your timeline, without listening to it or guessing.', it: 'Spendi 3 gettoni per piazzare una carta direttamente sulla tua timeline, senza ascoltarla né indovinarla.' },
  'partie.disabled': { fr: '🚫 Désactivé', en: '🚫 Disabled', it: '🚫 Disattivato' },
  'partie.freeCardEnabled': { fr: '🛒 Activé', en: '🛒 Enabled', it: '🛒 Attivo' },
  'partie.partialBonusTitle': { fr: 'Bonus partiel titre/artiste', en: 'Partial title/artist bonus', it: 'Bonus parziale titolo/artista' },
  'partie.partialBonusDesc': { fr: "Trouver seulement le titre OU seulement l'artiste (pas les deux) rapporte quand même +0,5 jeton, au lieu de rien.", en: 'Guessing only the title OR only the artist (not both) still earns +0.5 token, instead of nothing.', it: 'Indovinare solo il titolo O solo l\'artista (non entrambi) fa comunque guadagnare +0,5 gettoni, invece di niente.' },
  'partie.partialBonusEnabled': { fr: '🎯 Activé', en: '🎯 Enabled', it: '🎯 Attivo' },

  'ecoute.whereTitle': { fr: 'Où êtes-vous ?', en: 'Where are you?', it: 'Dove siete?' },
  'ecoute.together': { fr: '🎉 Tous ensemble', en: '🎉 All together', it: '🎉 Tutti insieme' },
  'ecoute.remote': { fr: '🏠 Chacun chez soi', en: '🏠 Each at home', it: '🏠 Ognuno a casa propria' },
  'ecoute.togetherDesc': { fr: 'Un DJ unique diffuse la musique à voix haute pour toute la pièce.', en: 'A single DJ plays the music out loud for the whole room.', it: "Un unico DJ diffonde la musica ad alta voce per tutta la stanza." },
  'ecoute.remoteDesc': { fr: "Pas de DJ — chaque joueur entend l'extrait directement sur son propre téléphone.", en: 'No DJ — each player hears the clip directly on their own phone.', it: 'Nessun DJ — ogni giocatore sente la clip direttamente sul proprio telefono.' },
  'ecoute.currentDj': { fr: 'DJ actuel', en: 'Current DJ', it: 'DJ attuale' },
  'ecoute.change': { fr: 'Changer', en: 'Change', it: 'Cambia' },
  'ecoute.musicTitle': { fr: 'Musique', en: 'Music', it: 'Musica' },
  'ecoute.musicDesc': { fr: "L'extrait audio tourne en boucle, ou s'arrête après 30 secondes.", en: 'The audio clip loops, or stops after 30 seconds.', it: "La clip audio va in loop, oppure si ferma dopo 30 secondi." },
  'ecoute.loop': { fr: '🔁 En boucle', en: '🔁 Looping', it: '🔁 In loop' },
  'ecoute.once': { fr: '⏹️ 30 secondes', en: '⏹️ 30 seconds', it: '⏹️ 30 secondi' },

  'temps.revealDelayTitle': { fr: 'Délai avant de pouvoir révéler', en: 'Delay before you can reveal', it: 'Ritardo prima di poter rivelare' },
  'temps.revealDelayDesc': { fr: 'Le temps laissé aux autres pour défier avant que la carte puisse être révélée.', en: 'The time given to others to challenge before the card can be revealed.', it: 'Il tempo lasciato agli altri per sfidare prima che la carta possa essere rivelata.' },
  'temps.decisionTitle': { fr: 'Temps pour répondre à une carte', en: 'Time to respond to a card', it: 'Tempo per rispondere a una carta' },
  'temps.decisionDesc': { fr: 'Passé ce délai après la pioche, la chanson est défaussée et le tour passe automatiquement.', en: 'Once this delay elapses after drawing, the song is discarded and the turn passes automatically.', it: "Trascorso questo tempo dalla pescata, la canzone viene scartata e il turno passa automaticamente." },
  'temps.autoDrawTitle': { fr: 'Pioche automatique', en: 'Auto-draw', it: 'Pescata automatica' },
  'temps.autoDrawDesc': { fr: 'Si personne ne pioche, la prochaine chanson se lance seule après ce délai. "Désactivé" laisse le temps qu\'il faut.', en: 'If nobody draws, the next song starts on its own after this delay. "Disabled" leaves as much time as needed.', it: 'Se nessuno pesca, la prossima canzone parte da sola dopo questo ritardo. "Disattivato" lascia tutto il tempo necessario.' },
  'temps.disabled': { fr: 'Désactivé', en: 'Disabled', it: 'Disattivato' },

  'chansons.periodsTitle': { fr: 'Périodes', en: 'Periods', it: 'Periodi' },
  'chansons.available': { fr: (v) => `${v.count === null ? '…' : v.count} chanson${v.count === 1 ? '' : 's'} disponible${v.count === 1 ? '' : 's'} — rien coché = tout est inclus.`, en: (v) => `${v.count === null ? '…' : v.count} song${v.count === 1 ? '' : 's'} available — nothing checked = everything is included.`, it: (v) => `${v.count === null ? '…' : v.count} canzon${v.count === 1 ? 'e' : 'i'} disponibil${v.count === 1 ? 'e' : 'i'} — niente selezionato = tutto incluso.` },
  'chansons.reset': { fr: 'Réinitialiser', en: 'Reset', it: 'Ripristina' },

  /* ---------- game screen ---------- */
  'game.yourTurn': { fr: "C'est ton tour", en: "It's your turn", it: 'Tocca a te' },
  'game.turnOf': { fr: 'Tour de', en: "Turn:", it: 'Turno di' },
  'game.remoteMode': { fr: '🏠 chacun chez soi', en: '🏠 each at home', it: '🏠 ognuno a casa propria' },
  'game.changeDj': { fr: 'Changer le DJ', en: 'Change the DJ', it: 'Cambia DJ' },

  /* ---------- quick action FABs ---------- */
  'quickFab.place': { fr: 'Placer la carte', en: 'Place the card', it: 'Piazza la carta' },
  'quickFab.challenge': { fr: 'Défier', en: 'Challenge', it: 'Sfida' },

  /* ---------- turn action ---------- */
  'turnAction.botPlay': { fr: '🤖 Faire jouer le Bot', en: '🤖 Play as the Bot', it: '🤖 Fai giocare il Bot' },
  'turnAction.waitingDraw': { fr: (v) => `En attente que ${v.name} pioche une chanson…`, en: (v) => `Waiting for ${v.name} to draw a song…`, it: (v) => `In attesa che ${v.name} peschi una canzone…` },
  'turnAction.drawBtn': { fr: '🎵 Piocher et écouter', en: '🎵 Draw and listen', it: '🎵 Pesca e ascolta' },
  'turnAction.freeCardBtn': { fr: 'Échanger 3 🪙 contre une carte posée directement', en: 'Trade 3 🪙 for a card placed directly', it: 'Scambia 3 🪙 con una carta piazzata direttamente' },
  'turnAction.noPreview': { fr: '🔇 Aperçu audio indisponible pour cette chanson sur Deezer — devinez à partir du titre/artiste une fois révélé, ou passez-la.', en: "🔇 Audio preview unavailable for this song on Deezer — guess from the title/artist once revealed, or skip it.", it: "🔇 Anteprima audio non disponibile per questa canzone su Deezer — indovina dal titolo/artista una volta rivelata, oppure saltala." },
  'turnAction.tapForSound': { fr: '🔊 Appuie ici pour le son', en: '🔊 Tap here for sound', it: '🔊 Tocca qui per il suono' },
  'turnAction.tapIfNoSound': { fr: 'Appuyer si pas de son', en: 'Tap if no sound', it: 'Tocca se non senti niente' },
  'turnAction.placeCard': { fr: 'Placer la carte', en: 'Place the card', it: 'Piazza la carta' },
  'turnAction.skipCard': { fr: 'Passer (1 🪙)', en: 'Skip (1 🪙)', it: 'Salta (1 🪙)' },
  'turnAction.listeningOnDjDevice': { fr: (v) => `🔊 Écoute sur l'appareil du DJ (${v.dj}).`, en: (v) => `🔊 Listening on the DJ's device (${v.dj}).`, it: (v) => `🔊 In ascolto sul dispositivo del DJ (${v.dj}).` },
  'turnAction.songPlayingAt': { fr: (v) => `🔊 La chanson joue chez ${v.dj} — ${v.name} réfléchit à son placement…`, en: (v) => `🔊 The song is playing at ${v.dj}'s — ${v.name} is thinking about where to place it…`, it: (v) => `🔊 La canzone sta suonando da ${v.dj} — ${v.name} sta pensando a dove piazzarla…` },
  'turnAction.validateGuess': { fr: (v) => `Valider titre ${v.conj} artiste`, en: (v) => `Confirm title ${v.conj} artist`, it: (v) => `Conferma titolo ${v.conj} artista` },
  'turnAction.conjOr': { fr: 'ou', en: 'or', it: 'o' },
  'turnAction.conjAnd': { fr: 'et', en: 'and', it: 'e' },
  'turnAction.guessFull': { fr: '✔ Titre et artiste trouvés — jeton gagné.', en: '✔ Title and artist found — token earned.', it: '✔ Titolo e artista trovati — gettone guadagnato.' },
  'turnAction.guessPartial': { fr: "🟡 Un des deux trouvé — jeton partiel gagné, essaie encore pour le reste !", en: '🟡 One of the two found — partial token earned, try again for the rest!', it: '🟡 Uno dei due trovato — gettone parziale guadagnato, riprova per il resto!' },
  'turnAction.guessWrong': { fr: '✘ Pas trouvé cette fois — réessaie.', en: "✘ Not found this time — try again.", it: '✘ Non trovato questa volta — riprova.' },
  'turnAction.cardInPlay': { fr: 'Carte en jeu', en: 'Card in play', it: 'Carta in gioco' },
  'turnAction.placedQuestion': { fr: (v) => `${v.name} a placé sa carte. Quelqu'un pense que c'est faux ?`, en: (v) => `${v.name} placed their card. Does anyone think it's wrong?`, it: (v) => `${v.name} ha piazzato la sua carta. Qualcuno pensa che sia sbagliata?` },
  'turnAction.titlePlaceholder': { fr: 'Titre ?', en: 'Title?', it: 'Titolo?' },
  'turnAction.artistPlaceholder': { fr: 'Artiste ?', en: 'Artist?', it: 'Artista?' },

  /* ---------- decision timer (suffix text after the live tick-seconds span) ---------- */
  'decisionTimer.forYouSuffix': { fr: 's pour répondre', en: 's to respond', it: 's per rispondere' },
  'decisionTimer.forOtherSuffix': { fr: (v) => `s restantes pour ${v.name}`, en: (v) => `s left for ${v.name}`, it: (v) => `s rimanenti per ${v.name}` },

  /* ---------- pending / reveal ---------- */
  'pending.revealCard': { fr: 'Révéler la carte', en: 'Reveal the card', it: 'Rivela la carta' },
  'pending.revealForBot': { fr: '🤖 Révéler pour le Bot', en: '🤖 Reveal for the Bot', it: '🤖 Rivela per il Bot' },
  'pending.challengeBot': { fr: '🚨 Défier le Bot (1 🪙)', en: '🚨 Challenge the Bot (1 🪙)', it: '🚨 Sfida il Bot (1 🪙)' },
  'pending.challengedBot': { fr: (v) => `🚨 ${v.name} a défié le Bot.`, en: (v) => `🚨 ${v.name} challenged the Bot.`, it: (v) => `🚨 ${v.name} ha sfidato il Bot.` },
  'pending.challengedYouExcl': { fr: (v) => `🚨 ${v.challenger} a défié ${v.active} !`, en: (v) => `🚨 ${v.challenger} challenged ${v.active}!`, it: (v) => `🚨 ${v.challenger} ha sfidato ${v.active}!` },
  'pending.challengeBtn': { fr: '🚨 Défier (1 🪙)', en: '🚨 Challenge (1 🪙)', it: '🚨 Sfida (1 🪙)' },
  'pending.challenged': { fr: (v) => `🚨 ${v.challenger} a défié ${v.active}.`, en: (v) => `🚨 ${v.challenger} challenged ${v.active}.`, it: (v) => `🚨 ${v.challenger} ha sfidato ${v.active}.` },
  'pending.waitingOthers': { fr: (v) => `✅ En attente des autres (${v.ready}/${v.total})`, en: (v) => `✅ Waiting for others (${v.ready}/${v.total})`, it: (v) => `✅ In attesa degli altri (${v.ready}/${v.total})` },
  'pending.looksGood': { fr: '✅ Ça a l\'air bon', en: '✅ Looks good', it: '✅ Sembra giusto' },
  'pending.looksGoodWithCount': { fr: (v) => ` — encore ${v.remaining}/${v.total} joueur${v.remaining > 1 ? 's' : ''} pour révéler`, en: (v) => ` — ${v.remaining}/${v.total} more player${v.remaining > 1 ? 's' : ''} to reveal`, it: (v) => ` — ancora ${v.remaining}/${v.total} giocator${v.remaining > 1 ? 'i' : 'e'} per rivelare` },
  'pending.revealNow': { fr: ', révéler maintenant', en: ', reveal now', it: ', rivela ora' },

  /* ---------- reveal info timer (suffix text after the live tick-seconds span) ---------- */
  'revealInfo.beforeSuffix': { fr: (v) => `s avant que ${v.name} puisse révéler`, en: (v) => `s before ${v.name} can reveal`, it: (v) => `s prima che ${v.name} possa rivelare` },

  /* ---------- result popup ---------- */
  'result.wrong': { fr: '❌ Mal placée — carte défaussée.', en: '❌ Misplaced — card discarded.', it: '❌ Piazzata male — carta scartata.' },
  'result.stolen': { fr: (v) => `🎯 ${v.active} s'est trompé — ${v.extra} vole la carte !`, en: (v) => `🎯 ${v.active} got it wrong — ${v.extra} steals the card!`, it: (v) => `🎯 ${v.active} ha sbagliato — ${v.extra} ruba la carta!` },
  'result.correct': { fr: '✅ Bien placée !', en: '✅ Correctly placed!', it: '✅ Piazzata bene!' },
  'result.hardcorePenalty': { fr: (v) => `🩸 Hardcore : ${v.name} perd aussi "${v.title}" (${v.year}) de sa frise !`, en: (v) => `🩸 Hardcore: ${v.name} also loses "${v.title}" (${v.year}) from their timeline!`, it: (v) => `🩸 Hardcore: ${v.name} perde anche "${v.title}" (${v.year}) dalla sua timeline!` },

  /* ---------- timelines ---------- */
  'timeline.pending': { fr: 'En attente', en: 'Pending', it: 'In attesa' },
  'timeline.you': { fr: ' (toi)', en: ' (you)', it: ' (tu)' },
  'timeline.noCard': { fr: 'Pas encore de carte', en: 'No card yet', it: 'Ancora nessuna carta' },
  'timeline.here': { fr: 'Ici', en: 'Here', it: 'Qui' },
  'timeline.stolenFrom': { fr: (v) => `Volée à ${v.name}`, en: (v) => `Stolen from ${v.name}`, it: (v) => `Rubata a ${v.name}` },

  /* ---------- finished screen ---------- */
  'finished.wins': { fr: (v) => `🏆 ${v.name} gagne !`, en: (v) => `🏆 ${v.name} wins!`, it: (v) => `🏆 ${v.name} vince!` },
  'finished.cards': { fr: (v) => `${v.count} cartes`, en: (v) => `${v.count} cards`, it: (v) => `${v.count} carte` },
  'finished.hideTimelines': { fr: '▲ Masquer les frises', en: '▲ Hide timelines', it: '▲ Nascondi le timeline' },
  'finished.showTimelines': { fr: '📊 Revoir les frises de tout le monde', en: "📊 Review everyone's timelines", it: '📊 Rivedi le timeline di tutti' },
  'finished.playAgain': { fr: 'Rejouer dans ce salon', en: 'Play again in this room', it: 'Rigioca in questa stanza' },
  'finished.leave': { fr: 'Quitter', en: 'Leave', it: 'Esci' },

  /* ---------- placement modal ---------- */
  'placement.placedHere': { fr: 'a placé ici', en: 'placed here', it: 'ha piazzato qui' },
  'placement.challengeTitle': { fr: 'Où penses-tu que ça se place ?', en: 'Where do you think it goes?', it: 'Dove pensi che vada piazzata?' },
  'placement.placeTitle': { fr: 'Place ta carte', en: 'Place your card', it: 'Piazza la tua carta' },
  'placement.challengeDesc': { fr: 'la carte marquée "a placé ici" montre son choix — appuie sur un + ailleurs pour proposer un autre emplacement, puis valide.', en: 'the card marked "placed here" shows their choice — tap a + elsewhere to propose a different spot, then confirm.', it: 'la carta segnata "ha piazzato qui" mostra la sua scelta — tocca un + altrove per proporre una posizione diversa, poi conferma.' },
  'placement.placeDesc': { fr: "appuie sur un + pour choisir l'emplacement, puis valide.", en: 'tap a + to choose the spot, then confirm.', it: 'tocca un + per scegliere la posizione, poi conferma.' },
  'placement.onTimelineOf': { fr: (v) => `Sur la frise de ${v.name} —`, en: (v) => `On ${v.name}'s timeline —`, it: (v) => `Sulla timeline di ${v.name} —` },
  'placement.cancel': { fr: 'Annuler', en: 'Cancel', it: 'Annulla' },
  'placement.validate': { fr: 'Valider', en: 'Confirm', it: 'Conferma' },

  /* ---------- DJ modal ---------- */
  'dj.title': { fr: 'Qui est le DJ ?', en: 'Who is the DJ?', it: 'Chi è il DJ?' },
  'dj.desc': { fr: 'Le DJ fait jouer la musique sur son appareil pour toute la salle.', en: 'The DJ plays the music on their device for the whole room.', it: 'Il DJ riproduce la musica sul proprio dispositivo per tutta la stanza.' },
  'dj.nameDj': { fr: 'Nommer DJ', en: 'Make DJ', it: 'Nomina DJ' },

  /* ---------- library modal ---------- */
  'library.title': { fr: 'Bibliothèque de chansons', en: 'Song library', it: 'Libreria delle canzoni' },
  'library.desc': { fr: 'Stockée sur ce serveur — visible par tous ceux qui s\'y connectent.', en: 'Stored on this server — visible to everyone who connects to it.', it: 'Salvata su questo server — visibile a tutti quelli che vi si connettono.' },
  'library.addSong': { fr: 'Ajouter une chanson', en: 'Add a song', it: 'Aggiungi una canzone' },
  'library.titlePlaceholder': { fr: 'Titre', en: 'Title', it: 'Titolo' },
  'library.artistPlaceholder': { fr: 'Artiste', en: 'Artist', it: 'Artista' },
  'library.yearPlaceholder': { fr: 'Année (ex. 1999)', en: 'Year (e.g. 1999)', it: 'Anno (es. 1999)' },
  'library.searching': { fr: 'Recherche sur Deezer…', en: 'Searching Deezer…', it: 'Ricerca su Deezer…' },
  'library.addToLibrary': { fr: 'Ajouter à la bibliothèque', en: 'Add to library', it: 'Aggiungi alla libreria' },
  'library.songCount': { fr: (v) => `${v.count} chanson${v.count > 1 ? 's' : ''}`, en: (v) => `${v.count} song${v.count > 1 ? 's' : ''}`, it: (v) => `${v.count} canzon${v.count > 1 ? 'i' : 'e'}` },
  'library.export': { fr: '⬇ Exporter en JSON', en: '⬇ Export as JSON', it: '⬇ Esporta come JSON' },
  'library.import': { fr: '⬆ Importer un JSON', en: '⬆ Import a JSON', it: '⬆ Importa un JSON' },
  'library.merge': { fr: 'Fusionner dans la bibliothèque', en: 'Merge into the library', it: 'Unisci alla libreria' },
  'library.checkPreviewsTitle': { fr: 'Vérifier les extraits audio', en: 'Check audio previews', it: 'Verifica le anteprime audio' },
  'library.checkPreviewsDesc': { fr: (v) => `Interroge Deezer en direct pour chaque chanson — peut prendre une minute pour ${v.count} titres.`, en: (v) => `Queries Deezer live for every song — can take a minute for ${v.count} tracks.`, it: (v) => `Interroga Deezer in tempo reale per ogni canzone — può richiedere un minuto per ${v.count} brani.` },
  'library.checking': { fr: 'Vérification en cours…', en: 'Checking…', it: 'Verifica in corso…' },
  'library.checkLibraryBtn': { fr: '🔍 Vérifier la bibliothèque', en: '🔍 Check the library', it: '🔍 Verifica la libreria' },
  'library.checkAssocTitle': { fr: 'Vérifier les associations Deezer', en: 'Check Deezer matches', it: 'Verifica le associazioni Deezer' },
  'library.checkAssocDesc': { fr: 'Recontrôle que chaque chanson pointe bien vers la bonne piste sur Deezer (titre + artiste), pas juste qu\'elle a un extrait audio — corrige automatiquement les mauvaises associations trouvées.', en: 'Rechecks that every song really points to the right track on Deezer (title + artist), not just that it has an audio preview — automatically fixes any bad matches found.', it: 'Ricontrolla che ogni canzone punti davvero alla traccia giusta su Deezer (titolo + artista), non solo che abbia un\'anteprima audio — corregge automaticamente le associazioni sbagliate trovate.' },
  'library.checkingProgress': { fr: (v) => `Vérification en cours… (${v.checked}/${v.total})`, en: (v) => `Checking… (${v.checked}/${v.total})`, it: (v) => `Verifica in corso… (${v.checked}/${v.total})` },
  'library.checkAssocBtn': { fr: '🔎 Vérifier les associations', en: '🔎 Check matches', it: '🔎 Verifica le associazioni' },

  /* ---------- audit report ---------- */
  'audit.progress': { fr: (v) => `${v.checked}/${v.total} vérifiées…`, en: (v) => `${v.checked}/${v.total} checked…`, it: (v) => `${v.checked}/${v.total} verificate…` },
  'audit.noMismatch': { fr: (v) => `Aucun désaccord trouvé sur ${v.total} chansons vérifiées.`, en: (v) => `No mismatch found across ${v.total} songs checked.`, it: (v) => `Nessuna discrepanza trovata su ${v.total} canzoni verificate.` },
  'audit.mismatchFound': { fr: (v) => `${v.count} mauvaise${v.count > 1 ? 's' : ''} association${v.count > 1 ? 's' : ''} trouvée${v.count > 1 ? 's' : ''} et corrigée${v.count > 1 ? 's' : ''} (sur ${v.total}) — se re-résoudront au prochain démarrage.`, en: (v) => `${v.count} bad match${v.count > 1 ? 'es' : ''} found and fixed (out of ${v.total}) — will re-resolve on the next startup.`, it: (v) => `${v.count} associazion${v.count > 1 ? 'i' : 'e'} sbagliat${v.count > 1 ? 'e' : 'a'} trovat${v.count > 1 ? 'e' : 'a'} e corrett${v.count > 1 ? 'e' : 'a'} (su ${v.total}) — verranno ri-risolte al prossimo avvio.` },
  'audit.expected': { fr: 'Attendu :', en: 'Expected:', it: 'Atteso:' },
  'audit.deezerHad': { fr: 'Deezer avait :', en: 'Deezer had:', it: 'Deezer aveva:' },

  /* ---------- health report ---------- */
  'health.noMatchReason': { fr: 'Aucune correspondance Deezer', en: 'No Deezer match', it: 'Nessuna corrispondenza Deezer' },
  'health.noPreviewReason': { fr: "Pas d'extrait audio disponible", en: 'No audio preview available', it: 'Nessuna anteprima audio disponibile' },
  'health.summary': { fr: (v) => `${v.ok} / ${v.total} chansons ont un extrait audio confirmé jouable en ce moment.`, en: (v) => `${v.ok} / ${v.total} songs have a confirmed playable audio preview right now.`, it: (v) => `${v.ok} / ${v.total} canzoni hanno un'anteprima audio confermata riproducibile in questo momento.` },
  'health.allGood': { fr: 'Tout est bon, aucune chanson à corriger.', en: 'All good, no song needs fixing.', it: 'Tutto ok, nessuna canzone da correggere.' },
  'health.remove': { fr: 'Retirer', en: 'Remove', it: 'Rimuovi' },

  /* ---------- rules modal ---------- */
  'rules.title': { fr: 'Règles', en: 'Rules', it: 'Regole' },
  'rules.goal': { fr: (v) => `<b>But :</b> être le premier à placer correctement ${v.count} chansons sur sa frise chronologique.`, en: (v) => `<b>Goal:</b> be the first to correctly place ${v.count} songs on your timeline.`, it: (v) => `<b>Obiettivo:</b> essere il primo a piazzare correttamente ${v.count} canzoni sulla propria timeline.` },
  'rules.turn': { fr: "<b>Tour :</b> le joueur actif pioche une chanson, l'écoute (jouée par le DJ, pour toute la salle), puis la place sur sa propre frise en devinant si elle est avant, après ou entre les chansons déjà posées.", en: "<b>Turn:</b> the active player draws a song, listens to it (played by the DJ, for the whole room), then places it on their own timeline, guessing whether it comes before, after, or between the songs already placed.", it: "<b>Turno:</b> il giocatore attivo pesca una canzone, la ascolta (riprodotta dal DJ, per tutta la stanza), poi la piazza sulla propria timeline indovinando se viene prima, dopo o tra le canzoni già piazzate." },
  'rules.reveal': { fr: '<b>Révélation :</b> une fois la carte placée, elle est révélée. Bien placée → elle reste sur la frise. Mal placée → elle est défaussée.', en: '<b>Reveal:</b> once the card is placed, it gets revealed. Correctly placed → it stays on the timeline. Misplaced → it gets discarded.', it: '<b>Rivelazione:</b> una volta piazzata la carta, viene rivelata. Piazzata bene → resta sulla timeline. Piazzata male → viene scartata.' },
  'rules.challenge': { fr: "<b>Défi :</b> les autres joueurs peuvent parier 1 jeton qu'ils devinent mieux l'emplacement. S'ils ont raison, ils volent la carte.", en: "<b>Challenge:</b> other players can bet 1 token that they can guess the spot better. If they're right, they steal the card.", it: '<b>Sfida:</b> gli altri giocatori possono scommettere 1 gettone di poter indovinare meglio la posizione. Se hanno ragione, rubano la carta.' },
  'rules.skip': { fr: '<b>Passer :</b> 1 jeton pour changer de chanson sans la placer.', en: '<b>Skip:</b> 1 token to change songs without placing it.', it: '<b>Salta:</b> 1 gettone per cambiare canzone senza piazzarla.' },
  'rules.freeCard': { fr: '<b>Carte gratuite :</b> 3 jetons pour poser une carte directement, sans écouter ni deviner.', en: '<b>Free card:</b> 3 tokens to place a card directly, without listening or guessing.', it: '<b>Carta gratuita:</b> 3 gettoni per piazzare una carta direttamente, senza ascoltare né indovinare.' },
  'rules.earnToken': { fr: "<b>Gagner un jeton :</b> devine le titre ET l'artiste de la chanson en jeu, max 5 jetons.", en: '<b>Earn a token:</b> guess the title AND the artist of the song in play, max 5 tokens.', it: '<b>Guadagnare un gettone:</b> indovina il titolo E l\'artista della canzone in gioco, massimo 5 gettoni.' },

  /* ---------- common ---------- */
  'common.close': { fr: 'Fermer', en: 'Close', it: 'Chiudi' },

  /* ---------- client-only validation/status errors ---------- */
  'errors.enterName': { fr: 'Entre ton prénom.', en: 'Enter your name.', it: 'Inserisci il tuo nome.' },
  'errors.enterCode': { fr: 'Entre le code du salon (4 caractères).', en: 'Enter the room code (4 characters).', it: 'Inserisci il codice della stanza (4 caratteri).' },
  'errors.enterNameFirst': { fr: "Entre ton prénom d'abord.", en: 'Enter your name first.', it: 'Prima inserisci il tuo nome.' },
  'errors.enterNumberRange': { fr: 'Entre un nombre entre 2 et 20.', en: 'Enter a number between 2 and 20.', it: 'Inserisci un numero tra 2 e 20.' },
  'errors.notInRoom': { fr: "Tu ne fais plus partie de ce salon (exclu·e, ou le salon a été fermé).", en: "You're no longer part of this room (removed, or the room was closed).", it: 'Non fai più parte di questa stanza (rimosso/a, oppure la stanza è stata chiusa).' },
  'errors.kicked': { fr: "Tu as été exclu·e du salon par l'hôte.", en: "You've been removed from the room by the host.", it: "Sei stato/a rimosso/a dalla stanza dall'host." },
  'errors.connectionLost': { fr: 'Connexion au serveur perdue — vérifie que le serveur tourne et que tu es sur le même Wi-Fi.', en: "Connection to the server lost — check that the server is running and that you're on the same Wi-Fi.", it: 'Connessione al server persa — controlla che il server sia attivo e che tu sia sulla stessa Wi-Fi.' },
  'errors.generic': { fr: 'Erreur.', en: 'Error.', it: 'Errore.' },
  'errors.network': { fr: 'Erreur réseau.', en: 'Network error.', it: 'Errore di rete.' },

  /* ---------- language switcher ---------- */
  'lang.fr': { fr: 'Français', en: 'French', it: 'Francese' },
  'lang.en': { fr: 'Anglais', en: 'English', it: 'Inglese' },
  'lang.it': { fr: 'Italien', en: 'Italian', it: 'Italiano' },

  /* ---------- server error codes (see server.js emit('error-msg', msg, {code, params})) ---------- */
  'err.SERVER_NOT_READY': { fr: 'Le serveur vérifie encore la bibliothèque musicale, réessaie dans un instant.', en: 'The server is still checking the music library — try again in a moment.', it: 'Il server sta ancora controllando la libreria musicale, riprova tra un istante.' },
  'err.ENTER_NAME': { fr: 'Entre ton prénom.', en: 'Enter your name.', it: 'Inserisci il tuo nome.' },
  'err.ROOM_NOT_FOUND': { fr: 'Aucun salon avec ce code.', en: 'No room with that code.', it: 'Nessuna stanza con questo codice.' },
  'err.GAME_ALREADY_STARTED': { fr: 'La partie a déjà commencé. Ressaisis exactement le prénom utilisé pour reprendre ta place.', en: 'The game has already started. Re-enter the exact name you used to resume your spot.', it: 'La partita è già iniziata. Reinserisci esattamente il nome usato per riprendere il tuo posto.' },
  'err.ROOM_FULL': { fr: (v) => `Ce salon est complet (maximum ${v.max} joueurs).`, en: (v) => `This room is full (maximum ${v.max} players).`, it: (v) => `Questa stanza è al completo (massimo ${v.max} giocatori).` },
  'err.SERVER_ERROR': { fr: 'Erreur serveur.', en: 'Server error.', it: 'Errore del server.' },
  'err.HOST_ONLY_START': { fr: "Seul l'hôte du salon peut lancer la partie.", en: 'Only the room host can start the game.', it: "Solo l'host della stanza può avviare la partita." },
  'err.NEED_2_PLAYERS': { fr: 'Il faut au moins 2 joueurs.', en: 'At least 2 players are needed.', it: 'Servono almeno 2 giocatori.' },
  'err.NOT_ENOUGH_SONGS': { fr: (v) => `Seulement ${v.pool} chanson(s) jouables correspondent aux filtres actifs — il en faut au moins ${v.needed}. Élargis les filtres, ou attends que le serveur finisse d'associer le catalogue à Deezer (regarde les logs).`, en: (v) => `Only ${v.pool} playable song(s) match the active filters — at least ${v.needed} are needed. Widen the filters, or wait for the server to finish matching the catalog to Deezer (check the logs).`, it: (v) => `Solo ${v.pool} canzoni giocabili corrispondono ai filtri attivi — ne servono almeno ${v.needed}. Allarga i filtri, oppure aspetta che il server finisca di associare il catalogo a Deezer (controlla i log).` },
  'err.HOST_ONLY_FILTERS': { fr: "Seul l'hôte du salon peut changer les filtres.", en: 'Only the room host can change the filters.', it: "Solo l'host della stanza può cambiare i filtri." },
  'err.HOST_ONLY_LISTEN_MODE': { fr: "Seul l'hôte du salon peut changer le mode d'écoute.", en: 'Only the room host can change the listening mode.', it: "Solo l'host della stanza può cambiare la modalità di ascolto." },
  'err.HOST_ONLY_SETTING': { fr: "Seul l'hôte du salon peut changer ce réglage.", en: 'Only the room host can change this setting.', it: "Solo l'host della stanza può cambiare questa impostazione." },
  'err.REVEAL_DELAY_RANGE': { fr: 'Le délai doit être entre 3 et 60 secondes.', en: 'The delay must be between 3 and 60 seconds.', it: 'Il ritardo deve essere tra 3 e 60 secondi.' },
  'err.DECISION_TIME_RANGE': { fr: 'Le temps de décision doit être entre 15 et 180 secondes.', en: 'The decision time must be between 15 and 180 seconds.', it: 'Il tempo di decisione deve essere tra 15 e 180 secondi.' },
  'err.AUTO_DRAW_RANGE': { fr: 'Le délai doit être entre 0 (désactivé) et 30 secondes.', en: 'The delay must be between 0 (disabled) and 30 seconds.', it: 'Il ritardo deve essere tra 0 (disattivato) e 30 secondi.' },
  'err.MAX_PLAYERS_RANGE': { fr: 'Le nombre maximum doit être entre 2 et 20.', en: 'The maximum number must be between 2 and 20.', it: 'Il numero massimo deve essere tra 2 e 20.' },
  'err.MAX_PLAYERS_TOO_LOW': { fr: (v) => `Il y a déjà ${v.count} joueurs dans le salon — choisis un maximum plus grand.`, en: (v) => `There are already ${v.count} players in the room — choose a higher maximum.`, it: (v) => `Ci sono già ${v.count} giocatori nella stanza — scegli un massimo più alto.` },
  'err.CARDS_TO_WIN_RANGE': { fr: 'Le nombre de cartes pour gagner doit être entre 4 et 20.', en: 'The number of cards to win must be between 4 and 20.', it: 'Il numero di carte per vincere deve essere tra 4 e 20.' },
  'err.START_TOKENS_RANGE': { fr: 'Le nombre de jetons de départ doit être entre 0 et 10.', en: 'The number of starting tokens must be between 0 and 10.', it: 'Il numero di gettoni iniziali deve essere tra 0 e 10.' },
  'err.UNKNOWN_GAME_MODE': { fr: 'Mode de partie inconnu.', en: 'Unknown game mode.', it: 'Modalità di gioco sconosciuta.' },
  'err.HOST_ONLY_KICK': { fr: "Seul l'hôte du salon peut exclure un joueur.", en: 'Only the room host can remove a player.', it: "Solo l'host della stanza può rimuovere un giocatore." },
  'err.HOST_CANT_KICK_SELF': { fr: "L'hôte ne peut pas s'exclure lui-même.", en: "The host can't remove themselves.", it: "L'host non può rimuovere se stesso." },
  'err.DECK_EMPTY': { fr: 'Plus de chansons avec un aperçu audio jouable dans la pioche !', en: 'No more songs with a playable audio preview left in the deck!', it: 'Non ci sono più canzoni con anteprima audio riproducibile nel mazzo!' },
  'err.FREE_CARD_DISABLED': { fr: "L'achat direct de carte n'est pas activé pour cette partie.", en: 'Direct card purchase is not enabled for this game.', it: "L'acquisto diretto della carta non è attivo per questa partita." },
  'err.NO_SONGS_LEFT': { fr: 'Plus de chansons disponibles !', en: 'No more songs available!', it: 'Non ci sono più canzoni disponibili!' },
  'err.CHALLENGE_TOO_LATE': { fr: (v) => `Trop tard — ${v.name || 'quelqu\'un'} a défié en premier.`, en: (v) => `Too late — ${v.name || 'someone'} challenged first.`, it: (v) => `Troppo tardi — ${v.name || 'qualcuno'} ha sfidato per primo.` },
  'err.CHALLENGE_SAME_SPOT': { fr: 'Choisis un autre emplacement que celui déjà posé.', en: 'Choose a different spot than the one already placed.', it: 'Scegli una posizione diversa da quella già piazzata.' },
  'err.REVEAL_TOO_EARLY': { fr: (v) => `Attends encore ${v.seconds}s avant de pouvoir révéler — ça laisse une chance de défier.`, en: (v) => `Wait ${v.seconds}s more before you can reveal — that leaves a chance to challenge.`, it: (v) => `Aspetta ancora ${v.seconds}s prima di poter rivelare — questo lascia una possibilità di sfidare.` },
  'err.HOST_ONLY_DJ': { fr: "Seul l'hôte du salon peut changer le DJ.", en: 'Only the room host can change the DJ.', it: "Solo l'host della stanza può cambiare il DJ." },
  'err.SONG_TITLE_ARTIST_REQUIRED': { fr: 'Titre et artiste obligatoires.', en: 'Title and artist are required.', it: 'Titolo e artista obbligatori.' },
  'err.SONG_YEAR_INVALID': { fr: 'Année invalide.', en: 'Invalid year.', it: 'Anno non valido.' },
  'err.SONG_DUPLICATE': { fr: 'Cette chanson est déjà dans la bibliothèque.', en: 'This song is already in the library.', it: 'Questa canzone è già nella libreria.' },
  'err.SONG_DEEZER_UNREACHABLE': { fr: "Impossible de joindre Deezer pour l'instant, réessaie.", en: "Can't reach Deezer right now, try again.", it: 'Impossibile raggiungere Deezer al momento, riprova.' },
  'err.SONG_NOT_FOUND_DEEZER': { fr: "Introuvable sur Deezer — vérifie l'orthographe du titre et de l'artiste.", en: "Not found on Deezer — check the spelling of the title and artist.", it: "Non trovato su Deezer — controlla l'ortografia del titolo e dell'artista." },
  'err.IMPORT_INVALID_JSON': { fr: 'JSON invalide.', en: 'Invalid JSON.', it: 'JSON non valido.' },
  'err.SONG_NOT_FOUND': { fr: 'Chanson introuvable.', en: 'Song not found.', it: 'Canzone non trovata.' },
  'err.AUDIT_ALREADY_RUNNING': { fr: 'Un audit est déjà en cours.', en: 'An audit is already running.', it: 'Una verifica è già in corso.' }
};

function t(key, vars) {
  const entry = DICT[key];
  if (!entry) return key;
  let str = entry[currentLang];
  if (str === undefined) str = entry.fr;
  if (typeof str === 'function') return str(vars || {});
  return str === undefined ? key : str;
}

/* ---------- persistent language flag switcher ----------
   Rendered into its own overlay appended directly to <body>, same pattern
   as #fab-overlay in app.js — stays independent of #root's frequent
   innerHTML rebuilds, and is visible on every screen (welcome through game). */
const LANG_FLAGS = { fr: '🇫🇷', en: '🇬🇧', it: '🇮🇹' };
let langSwitcherEl = null;
function renderLangSwitcher(onChange) {
  if (!langSwitcherEl) {
    langSwitcherEl = document.createElement('div');
    langSwitcherEl.id = 'lang-switcher';
    document.body.appendChild(langSwitcherEl);
  }
  langSwitcherEl.innerHTML = SUPPORTED_LANGS.map(l =>
    `<button type="button" class="lang-flag-btn ${l === currentLang ? 'active' : ''}" data-lang="${l}" title="${t('lang.' + l)}" aria-label="${t('lang.' + l)}">${LANG_FLAGS[l]}</button>`
  ).join('');
  langSwitcherEl.querySelectorAll('[data-lang]').forEach(btn => {
    btn.onclick = () => {
      setLang(btn.getAttribute('data-lang'));
      renderLangSwitcher(onChange);
      onChange();
    };
  });
}
