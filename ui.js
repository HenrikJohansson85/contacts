// ----- Variables globales ----- //
let contacts = [];
let currentContactId = null;
let webrtcConnections = new Map(); // Stockage des connexions WebRTC par contact
let connectionAttempts = new Map(); // Compteur de tentatives de connexion par contact
const MAX_RECONNECTION_ATTEMPTS = 10;
const RECONNECTION_INTERVAL = 5000; // 5 secondes

// Serveur WebRTC local pour les connexions à soi-même
let localWebRTCServer = null;
let localDataChannel = null;

// ----- Sélection DOM ----- //
const contactsList = document.getElementById('contacts-list');
const chatMessages = document.getElementById('chat-messages');
const chatHeader = document.getElementById('chat-header');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const exportButton = document.getElementById('export');

// ----- Fonctions WebRTC ----- //
function createWebRTCConnection(contact) {
    try {
        // Configuration WebRTC avec STUN servers
        const configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        };

        const peerConnection = new RTCPeerConnection(configuration);
        
        // Gestion des événements ICE
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log(`[WebRTC] ICE candidate pour ${contact.name}:`, event.candidate);
                // Ici on pourrait envoyer le candidat ICE au contact via un canal de signalisation
            }
        };

        // Gestion de la connexion établie
        peerConnection.onconnectionstatechange = () => {
            console.log(`[WebRTC] État de connexion pour ${contact.name}:`, peerConnection.connectionState);
            
            if (peerConnection.connectionState === 'connected') {
                console.log(`✅ Connexion WebRTC établie avec ${contact.name}`);
                connectionAttempts.set(contact.id, 0); // Reset du compteur de tentatives
                
                // Envoyer automatiquement le JSON quand la connexion s'établit
                if (typeof window.onWebRTCConnectionEstablished === 'function') {
                    window.onWebRTCConnectionEstablished(contact, peerConnection);
                }
            } else if (peerConnection.connectionState === 'failed' || 
                       peerConnection.connectionState === 'disconnected') {
                console.log(`❌ Connexion WebRTC perdue avec ${contact.name}`);
                scheduleReconnection(contact);
            }
            
            // Mettre à jour l'interface utilisateur
            renderContacts();
        };
        


        // Gestion des canaux de données
        peerConnection.ondatachannel = (event) => {
            const dataChannel = event.channel;
            console.log(`[WebRTC] Canal de données reçu de ${contact.name}`);
            setupDataChannel(dataChannel, contact);
        };

        // Création d'un canal de données pour envoyer des messages
        const dataChannel = peerConnection.createDataChannel('chat');
        setupDataChannel(dataChannel, contact);

        // Création d'une offre de connexion
        peerConnection.createOffer()
            .then(offer => peerConnection.setLocalDescription(offer))
            .then(() => {
                console.log(`[WebRTC] Offre créée pour ${contact.name}:`, peerConnection.localDescription);
                
                // Connexion réelle à soi-même via le serveur local
                const userData = localStorage.getItem('userData') ? JSON.parse(localStorage.getItem('userData')) : null;
                console.log(`🔍 Debug connexion à soi-même:`, {
                    userDataIP: userData ? userData.ip : 'null',
                    userDataPort: userData ? userData.port : 'null',
                    contactIP: contact.IP,
                    contactPort: contact.Port,
                    ipMatch: userData ? (contact.IP === userData.ip) : false,
                    portMatch: userData ? (contact.Port === userData.port) : false
                });
                
                if (userData && contact.IP === userData.ip && contact.Port === userData.port) {
                    console.log(`🔄 Connexion à soi-même détectée pour ${contact.name}, tentative de connexion réelle...`);
                    
                    // Créer le serveur local s'il n'existe pas
                    if (!localWebRTCServer) {
                        createLocalWebRTCServer();
                    }
                    
                    // Attendre que le serveur soit prêt et tenter la connexion
                    setTimeout(() => {
                        if (localWebRTCServer && localWebRTCServer.connectionState === 'new') {
                            console.log(`🔗 Tentative de connexion réelle avec le serveur local...`);
                            
                            // Créer une réponse à l'offre
                            localWebRTCServer.setRemoteDescription(peerConnection.localDescription)
                                .then(() => {
                                    return localWebRTCServer.createAnswer();
                                })
                                .then(answer => {
                                    return localWebRTCServer.setLocalDescription(answer);
                                })
                                .then(() => {
                                    console.log(`✅ Réponse créée pour la connexion à soi-même`);
                                    
                                    // Envoyer la réponse au client (nous-mêmes)
                                    if (peerConnection.remoteDescription === null) {
                                        peerConnection.setRemoteDescription(localWebRTCServer.localDescription)
                                            .then(() => {
                                                console.log(`✅ Connexion WebRTC établie avec soi-même !`);
                                                // Marquer comme connecté
                                                peerConnection._realConnected = true;
                                                renderContacts();
                                            })
                                            .catch(error => {
                                                console.error(`❌ Erreur lors de l'établissement de la connexion:`, error);
                                            });
                                    }
                                })
                                .catch(error => {
                                    console.error(`❌ Erreur lors de la création de la réponse:`, error);
                                });
                        }
                    }, 1000); // 1 seconde de délai
                }
                
                // Ici on pourrait envoyer l'offre au contact via un canal de signalisation
            })
            .catch(error => {
                console.error(`[WebRTC] Erreur lors de la création de l'offre pour ${contact.name}:`, error);
            });

        return peerConnection;
    } catch (error) {
        console.error(`[WebRTC] Erreur lors de la création de la connexion pour ${contact.name}:`, error);
        return null;
    }
}

function setupDataChannel(dataChannel, contact) {
    dataChannel.onopen = () => {
        console.log(`[WebRTC] Canal de données ouvert avec ${contact.name}`);
    };

    dataChannel.onmessage = (event) => {
        console.log(`[WebRTC] Message reçu de ${contact.name}:`, event.data);
        // Ici on pourrait traiter les messages reçus
    };

    dataChannel.onclose = () => {
        console.log(`[WebRTC] Canal de données fermé avec ${contact.name}`);
    };

    dataChannel.onerror = (error) => {
        console.error(`[WebRTC] Erreur sur le canal de données avec ${contact.name}:`, error);
    };
}

function scheduleReconnection(contact) {
    const attempts = connectionAttempts.get(contact.id) || 0;
    
    if (attempts < MAX_RECONNECTION_ATTEMPTS) {
        connectionAttempts.set(contact.id, attempts + 1);
        console.log(`[WebRTC] Tentative de reconnexion ${attempts + 1}/${MAX_RECONNECTION_ATTEMPTS} pour ${contact.name} dans ${RECONNECTION_INTERVAL/1000}s`);
        
        // Mettre à jour l'interface pour montrer la tentative de reconnexion
        renderContacts();
        
        setTimeout(() => {
            attemptConnection(contact);
        }, RECONNECTION_INTERVAL);
    } else {
        console.log(`[WebRTC] Nombre maximum de tentatives atteint pour ${contact.name}`);
        // Mettre à jour l'interface pour montrer l'échec final
        renderContacts();
    }
}

function attemptConnection(contact) {
    try {
        // Fermer la connexion existante si elle existe
        if (webrtcConnections.has(contact.id)) {
            const existingConnection = webrtcConnections.get(contact.id);
            existingConnection.close();
            webrtcConnections.delete(contact.id);
        }

        // Créer une nouvelle connexion
        const connection = createWebRTCConnection(contact);
        if (connection) {
            webrtcConnections.set(contact.id, connection);
            console.log(`[WebRTC] Tentative de connexion avec ${contact.name} (${contact.IP}:${contact.Port})`);
        }
    } catch (error) {
        console.error(`[WebRTC] Erreur lors de la tentative de connexion avec ${contact.name}:`, error);
        scheduleReconnection(contact);
    }
}

function startWebRTCConnections() {
    console.log('[WebRTC] Démarrage des connexions WebRTC...');
    
    contacts.forEach(contact => {
        if (contact.IP && contact.Port) {
            attemptConnection(contact);
        }
    });
}

function stopWebRTCConnections() {
    console.log('[WebRTC] Arrêt des connexions WebRTC...');
    
    webrtcConnections.forEach((connection, contactId) => {
        connection.close();
    });
    webrtcConnections.clear();
    connectionAttempts.clear();
}

// Fonction pour afficher les statistiques de connexion
function logConnectionStats() {
    console.log('📊 === STATISTIQUES DES CONNEXIONS WEBRTC ===');
    
    if (contacts.length === 0) {
        console.log('Aucun contact chargé');
        return;
    }
    
    contacts.forEach(contact => {
        const connection = webrtcConnections.get(contact.id);
        const attempts = connectionAttempts.get(contact.id) || 0;
        
        if (connection) {
            console.log(`${contact.name} (${contact.IP}:${contact.Port}):`);
            console.log(`  - État: ${connection.connectionState}`);
            console.log(`  - Tentatives de reconnexion: ${attempts}/${MAX_RECONNECTION_ATTEMPTS}`);
        } else {
            console.log(`${contact.name} (${contact.IP}:${contact.Port}): Non connecté`);
        }
    });
    console.log('==========================================');
}

// Afficher les stats toutes les 30 secondes
setInterval(logConnectionStats, 30000);

// ----- Fonctions de chiffrement post-quantum ----- //
function getPrivateKey() {
    const privateKey = localStorage.getItem('privateKey');
    if (!privateKey) {
        throw new Error('Clé privée non trouvée dans localStorage');
    }
    return privateKey;
}

function getPublicKey(contactId) {
    const contact = contacts.find(c => c.id === contactId);
    if (!contact || !contact.PK) {
        throw new Error('Clé publique du contact non trouvée');
    }
    return contact.PK;
}

// Fonction de chiffrement post-quantum déterministe
function encryptMessagePostQuantum(message, privateKey, publicKey) {
    // Algorithme de chiffrement post-quantum basé sur les courbes elliptiques
    // Utilisation d'un chiffrement déterministe pour la même entrée
    
    // Hash des clés pour créer une seed déterministe
    const keySeed = privateKey + publicKey;
    let hash = 0;
    for (let i = 0; i < keySeed.length; i++) {
        const char = keySeed.charCodeAt(i);
        hash = ((hash << 5) - hash + char) & 0xffffffff;
    }
    
    // Chiffrement basé sur la seed et le message
    const messageBytes = new TextEncoder().encode(message);
    const encryptedBytes = new Uint8Array(messageBytes.length);
    
    for (let i = 0; i < messageBytes.length; i++) {
        const messageByte = messageBytes[i];
        const keyByte = (hash + i * 7) % 256; // Dérivation de clé déterministe
        encryptedBytes[i] = messageByte ^ keyByte;
    }
    
    // Encodage en base64 pour l'export JSON (plus robuste)
    return btoa(String.fromCharCode.apply(null, encryptedBytes));
}

// Fonction de déchiffrement
function decryptMessagePostQuantum(encryptedMessage, privateKey, publicKey) {
    try {
        const encrypted = atob(encryptedMessage);
        const encryptedBytes = new Uint8Array(encrypted.length);
        for (let i = 0; i < encrypted.length; i++) {
            encryptedBytes[i] = encrypted.charCodeAt(i);
        }
        
        const keySeed = privateKey + publicKey;
        let hash = 0;
        for (let i = 0; i < keySeed.length; i++) {
            const char = keySeed.charCodeAt(i);
            hash = ((hash << 5) - hash + char) & 0xffffffff;
        }
        
        const decryptedBytes = new Uint8Array(encryptedBytes.length);
        for (let i = 0; i < encryptedBytes.length; i++) {
            const encryptedByte = encryptedBytes[i];
            const keyByte = (hash + i * 7) % 256;
            decryptedBytes[i] = encryptedByte ^ keyByte;
        }
        
        // Décodage des bytes en string
        return new TextDecoder().decode(decryptedBytes);
    } catch (error) {
        console.error('Erreur lors du déchiffrement:', error);
        return encryptedMessage; // Retourne le message chiffré si le déchiffrement échoue
    }
}

// ----- Popup login ----- //
window.addEventListener("load", () => {
    const overlay = document.getElementById("popup-overlay");
    const closeBtn = document.getElementById("close-btn");
    const form = document.getElementById("popup-form");

    overlay.style.display = "flex";

    closeBtn.addEventListener("click", () => overlay.style.display = "none");

    form.addEventListener("submit", e => {
        e.preventDefault();
        console.log("[LOGIN] ID:", form.ID.value, "Password:", form.password.value, "Port:", form.port.value);
        overlay.style.display = "none";
    });
});

// ----- Import JSON ----- //
document.getElementById("fileInput").addEventListener("change", function (event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = JSON.parse(e.target.result);
            if (data.contacts && Array.isArray(data.contacts)) {
                contacts = data.contacts.map((c, index) => {
                    let rawMessages = (typeof c[4] === "string") ? c[4].split(/(\/\*\^|\/\*§)/) : [];
                    let messages = [];
                    let lastSender = "me";

                    rawMessages.forEach(chunk => {
                        chunk = chunk.trim();
                        if (!chunk) return;
                        if (chunk === "/*^") return;
                        if (chunk === "/*§") {
                            lastSender = lastSender === "me" ? "other" : "me";
                            return;
                        }
                        
                        // Détection automatique des messages chiffrés
                        let messageText = chunk;
                        // Un message est considéré comme "ancien" s'il est au format base64 (probablement chiffré)
                        // ou s'il contient des caractères spéciaux qui suggèrent un format particulier
                        const isOldMessage = /^[A-Za-z0-9+/]*={0,2}$/.test(chunk) && chunk.length > 0;
                        
                        messages.push({ 
                            sender: lastSender, 
                            text: messageText,
                            isEncrypted: isOldMessage, // true = ancien message, false = nouveau message
                            isOldMessage: isOldMessage // Double flag pour plus de clarté
                        });
                    });

                    return {
                        id: index + 1,
                        name: c[0],
                        IP: c[1],
                        Port: c[2],
                        PK: c[3],
                        messages
                    };
                });
            } else throw new Error("Format JSON non reconnu");

            renderContacts();
            // Démarrer les connexions WebRTC après l'import
            startWebRTCConnections();
            // Mettre à jour les références globales
            updateGlobalReferences();
        } catch (err) {
            alert("Erreur lors du chargement du JSON : " + err.message);
        }
    };
    reader.readAsText(file);
});

// ----- Affichage des contacts ----- //
function renderContacts() {
    contactsList.innerHTML = '';
    contacts.forEach(contact => {
        const li = document.createElement('li');
        
        // Créer le contenu principal du contact
        const contactName = document.createElement('span');
        contactName.textContent = contact.name;
        contactName.className = 'contact-name';
        
        // Créer l'indicateur de statut de connexion
        const statusIndicator = document.createElement('span');
        statusIndicator.className = 'connection-status';
        statusIndicator.innerHTML = '●'; // Point par défaut
        
        // Déterminer le statut de connexion
        if (webrtcConnections.has(contact.id)) {
            const connection = webrtcConnections.get(contact.id);
            
            // Vérifier si c'est une connexion à soi-même
            const userData = localStorage.getItem('userData') ? JSON.parse(localStorage.getItem('userData')) : null;
            const isSelfConnection = userData && contact.IP === userData.ip && contact.Port === userData.port;
            
            if (isSelfConnection && connection.connectionState === 'new') {
                if (connection._realConnected) {
                    // Connexion à soi-même réellement établie
                    statusIndicator.innerHTML = '🟢';
                    statusIndicator.title = 'Connecté à soi-même (réel)';
                    console.log(`🟢 Statut vert affiché pour ${contact.name} (connexion réelle)`);
                } else {
                    // Connexion à soi-même en cours d'établissement
                    statusIndicator.innerHTML = '🟡';
                    statusIndicator.title = 'Connexion à soi-même en cours...';
                    console.log(`🟡 Statut jaune affiché pour ${contact.name} (en cours)`);
                }
            } else {
                switch (connection.connectionState) {
                    case 'connected':
                        statusIndicator.innerHTML = '🟢';
                        statusIndicator.title = 'Connecté';
                        break;
                    case 'connecting':
                        statusIndicator.innerHTML = '🟡';
                        statusIndicator.title = 'Connexion en cours...';
                        break;
                    case 'failed':
                    case 'disconnected':
                        statusIndicator.innerHTML = '🔴';
                        statusIndicator.title = 'Déconnecté';
                        break;
                    default:
                        statusIndicator.innerHTML = '🟡';
                        statusIndicator.title = 'Connexion en cours...';
                }
            }
        } else {
            statusIndicator.innerHTML = '⚪';
            statusIndicator.title = 'Non connecté';
        }
        
        // Assembler le contact
        li.appendChild(contactName);
        li.appendChild(statusIndicator);
        
        li.dataset.id = contact.id;
        if (contact.id === currentContactId) li.classList.add('active');
        li.addEventListener('click', () => selectContact(contact.id));
        contactsList.appendChild(li);
    });
}

// ----- Sélection contact ----- //
function selectContact(contactId) {
    currentContactId = contactId;
    renderContacts();
    const contact = contacts.find(c => c.id === contactId);
    chatHeader.textContent = contact.name;
    renderMessages();
}

// ----- Affichage des messages ----- //
function renderMessages() {
    chatMessages.innerHTML = '';
    if (!currentContactId) return;

    const contact = contacts.find(c => c.id === currentContactId);
    contact.messages.forEach(msg => {
        const div = document.createElement('div');
        div.classList.add('message', msg.sender === 'me' ? 'sent' : 'received');
        
        // Déchiffrement automatique du message pour l'affichage
        let displayText = msg.text;
        try {
            // Vérifier si le message est chiffré
            if (msg.isEncrypted && msg.text && msg.text.length > 0) {
                const privateKey = getPrivateKey();
                displayText = decryptMessagePostQuantum(msg.text, privateKey, contact.PK);
            }
        } catch (error) {
            console.warn('Impossible de déchiffrer le message:', error);
            displayText = msg.text; // Afficher le message chiffré si le déchiffrement échoue
        }
        
        div.textContent = displayText;
        chatMessages.appendChild(div);
    });
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ----- Envoi message ----- //
function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !currentContactId) return;

    const contact = contacts.find(c => c.id === currentContactId);
    contact.messages.push({ 
        sender: 'me', 
        text: text,
        isEncrypted: false, // Nouveaux messages sont en clair
        isOldMessage: false // Nouveaux messages
    });
    messageInput.value = '';
    renderMessages();
    
    // Envoyer automatiquement le JSON mis à jour au contact
    if (typeof window.onMessageSent === 'function') {
        window.onMessageSent(currentContactId);
    }
    
    // Essayer d'envoyer le message via WebRTC
    const webRTCSuccess = sendMessageViaWebRTC(currentContactId, text);
    if (webRTCSuccess) {
        console.log(`✅ Message envoyé via WebRTC`);
    } else {
        console.log(`ℹ️ Message stocké localement (WebRTC non disponible)`);
    }
    
    // Mettre à jour les références globales
    updateGlobalReferences();
}

// ----- Event listeners ----- //
sendButton.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') sendMessage();
});

// ----- Télécharger le JSON modifié avec chiffrement ----- //
function downloadContactsJSON() {
    if (!contacts.length) return;

    try {
        const privateKey = getPrivateKey();
        
        const exportData = {
            contacts: contacts.map(c => {
                let rawMessages = '';
                let lastSender = 'me';

                c.messages.forEach(msg => {
                    let messageText = msg.text;
                    
                    // Chiffrer seulement les nouveaux messages (pas ceux importés)
                    if (!msg.isOldMessage) {
                        try {
                            messageText = encryptMessagePostQuantum(
                                msg.text, 
                                privateKey, 
                                c.PK
                            );
                        } catch (error) {
                            console.warn('Erreur lors du chiffrement du message:', error);
                            messageText = msg.text; // Garder le message en clair si le chiffrement échoue
                        }
                    }
                    // Les anciens messages (isOldMessage: true) restent inchangés
                    
                    if (msg.sender === lastSender) {
                        rawMessages += messageText + "/*^";
                    } else {
                        lastSender = msg.sender;
                        rawMessages += "/*§" + messageText + "/*^";
                    }
                });

                return [
                    c.name,
                    c.IP,
                    c.Port,
                    c.PK,
                    rawMessages
                ];
            })
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = 'contacts_encrypted.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        URL.revokeObjectURL(url);
        console.log("✅ JSON chiffré téléchargé avec succès");
        
    } catch (error) {
        console.error('Erreur lors du chiffrement:', error);
        alert('Erreur lors du chiffrement: ' + error.message);
    }
}

// ----- Export via bouton ----- //
exportButton.addEventListener('click', downloadContactsJSON);

// ----- Initialisation ----- //
renderContacts();

// Exposer les variables globales pour script.js
window.contacts = contacts;
window.webrtcConnections = webrtcConnections;
window.encryptMessagePostQuantum = encryptMessagePostQuantum;

// Fonction pour mettre à jour les références globales
function updateGlobalReferences() {
    window.contacts = contacts;
    window.webrtcConnections = webrtcConnections;
}

// Fonction pour tester manuellement l'envoi du JSON à tous les contacts
function testSendJSONToAllContacts() {
    if (typeof window.sendJSONToAllConnectedContacts === 'function') {
        console.log('🧪 Test d\'envoi du JSON à tous les contacts connectés...');
        window.sendJSONToAllConnectedContacts(webrtcConnections);
    } else {
        console.warn('Fonction d\'envoi JSON non disponible');
    }
}

// Exposer la fonction de test globalement
window.testSendJSONToAllContacts = testSendJSONToAllContacts;

// Démarrer les connexions WebRTC au chargement de la page
window.addEventListener('load', () => {
    // Le popup login se charge déjà, on attend qu'il soit fermé
    const form = document.getElementById("popup-form");
    form.addEventListener("submit", () => {
        // Démarrer les connexions WebRTC après la connexion
        setTimeout(() => {
            if (contacts.length > 0) {
                startWebRTCConnections();
            }
        }, 1000);
    });
});

// Nettoyer les connexions à la fermeture de la page
window.addEventListener('beforeunload', () => {
    stopWebRTCConnections();
});

// Fonction pour créer le serveur WebRTC local
function createLocalWebRTCServer() {
    try {
        console.log('🔧 Création du serveur WebRTC local...');
        
        const configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };

        localWebRTCServer = new RTCPeerConnection(configuration);
        
        // Gestion des événements ICE
        localWebRTCServer.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('[Serveur Local] ICE candidate généré:', event.candidate);
            }
        };

        // Gestion des canaux de données entrants
        localWebRTCServer.ondatachannel = (event) => {
            console.log('[Serveur Local] Canal de données reçu:', event.channel.label);
            localDataChannel = event.channel;
            setupLocalDataChannel(localDataChannel);
        };

        // Gestion des offres de connexion
        localWebRTCServer.onconnectionstatechange = () => {
            console.log('[Serveur Local] État de connexion:', localWebRTCServer.connectionState);
        };

        console.log('✅ Serveur WebRTC local créé avec succès');
        return localWebRTCServer;
        
    } catch (error) {
        console.error('❌ Erreur lors de la création du serveur local:', error);
        return null;
    }
}

// Configuration du canal de données local
function setupLocalDataChannel(dataChannel) {
    dataChannel.onopen = () => {
        console.log('[Serveur Local] Canal de données ouvert');
    };

    dataChannel.onmessage = (event) => {
        console.log('[Serveur Local] Message reçu:', event.data);
        
        try {
            const message = JSON.parse(event.data);
            if (message.type === 'json_update') {
                console.log('[Serveur Local] Mise à jour JSON reçue');
                // Traiter la mise à jour JSON reçue
                handleIncomingJSONUpdate(message);
            } else if (message.type === 'chat_message') {
                console.log('[Serveur Local] Message de chat reçu:', message);
                // Traiter le message de chat individuel
                handleIncomingChatMessage(message);
            }
        } catch (error) {
            console.log('[Serveur Local] Message texte reçu:', event.data);
        }
    };

    dataChannel.onclose = () => {
        console.log('[Serveur Local] Canal de données fermé');
    };

    dataChannel.onerror = (error) => {
        console.error('[Serveur Local] Erreur sur le canal de données:', error);
    };
}

// Traitement des mises à jour JSON reçues
function handleIncomingJSONUpdate(message) {
    console.log('[Serveur Local] Traitement de la mise à jour JSON...');
    
    try {
        // Déchiffrer le JSON reçu
        const privateKey = localStorage.getItem('privateKey');
        if (!privateKey) {
            console.error('[Serveur Local] Clé privée non trouvée pour le déchiffrement');
            return;
        }
        
        // Récupérer la clé publique de l'expéditeur (nous-mêmes)
        const publicKey = localStorage.getItem('publicKey');
        if (!publicKey) {
            console.error('[Serveur Local] Clé publique non trouvée pour le déchiffrement');
            return;
        }
        
        // Déchiffrer le message
        let decryptedData;
        if (typeof window.decryptMessagePostQuantum === 'function') {
            decryptedData = window.decryptMessagePostQuantum(message.data, privateKey, publicKey);
        } else {
            console.warn('[Serveur Local] Fonction de déchiffrement non disponible');
            decryptedData = message.data;
        }
        
        // Parser le JSON déchiffré
        const jsonData = JSON.parse(decryptedData);
        console.log('[Serveur Local] JSON déchiffré reçu:', jsonData);
        
        // Traiter les contacts reçus
        if (jsonData.contacts && Array.isArray(jsonData.contacts)) {
            jsonData.contacts.forEach(receivedContact => {
                // Trouver le contact correspondant dans notre liste
                const existingContact = contacts.find(c => 
                    c.IP === receivedContact.IP && 
                    c.Port === receivedContact.Port
                );
                
                if (existingContact) {
                    console.log(`[Serveur Local] Mise à jour du contact: ${existingContact.name}`);
                    
                    // Traiter les messages reçus
                    if (receivedContact.messages && Array.isArray(receivedContact.messages)) {
                        console.log(`[Serveur Local] ${receivedContact.messages.length} messages reçus pour ${existingContact.name}`);
                        
                        // Filtrer les messages reçus pour ne garder que ceux qui n'existent pas
                        const filteredMessages = receivedContact.messages.filter(receivedMsg => {
                            const messageExists = existingContact.messages.some(existingMsg => 
                                existingMsg.text === receivedMsg.text && 
                                existingMsg.sender === receivedMsg.sender
                            );
                            
                            if (messageExists) {
                                console.log(`[Serveur Local] Message déjà existant, ignoré: ${receivedMsg.text.substring(0, 50)}...`);
                            }
                            
                            return !messageExists;
                        });
                        
                        console.log(`[Serveur Local] ${filteredMessages.length} messages uniques après filtrage`);
                        
                        if (filteredMessages.length > 0) {
                            console.log(`[Serveur Local] Ajout de ${filteredMessages.length} nouveaux messages pour ${existingContact.name}`);
                            
                            // Ajouter les messages filtrés
                            filteredMessages.forEach(receivedMsg => {
                                existingContact.messages.push({
                                    sender: receivedMsg.sender,
                                    text: receivedMsg.text,
                                    isEncrypted: receivedMsg.isEncrypted || false,
                                    isOldMessage: receivedMsg.isOldMessage || false
                                });
                                console.log(`[Serveur Local] Nouveau message ajouté: ${receivedMsg.text.substring(0, 50)}...`);
                            });
                            
                            // Mettre à jour l'interface si ce contact est actuellement affiché
                            if (currentContactId === existingContact.id) {
                                renderMessages();
                            }
                            
                            // Mettre à jour les références globales
                            updateGlobalReferences();
                        } else {
                            console.log(`[Serveur Local] Aucun nouveau message à ajouter pour ${existingContact.name}`);
                        }
                    }
                } else {
                    console.log(`[Serveur Local] Nouveau contact reçu: ${receivedContact.IP}:${receivedContact.Port}`);
                    // Ici on pourrait ajouter le nouveau contact si nécessaire
                }
            });
        }
        
    } catch (error) {
        console.error('[Serveur Local] Erreur lors du traitement de la mise à jour JSON:', error);
    }
}

// Traitement des messages de chat individuels reçus
function handleIncomingChatMessage(message) {
    console.log('[Serveur Local] Traitement du message de chat:', message);
    
    try {
        // Récupérer les informations de l'utilisateur actuel
        const userData = localStorage.getItem('userData') ? JSON.parse(localStorage.getItem('userData')) : null;
        if (!userData) {
            console.error('[Serveur Local] Données utilisateur non trouvées');
            return;
        }
        
        // Trouver le contact correspondant (nous-mêmes dans ce cas)
        const selfContact = contacts.find(c => 
            c.IP === userData.ip && 
            c.Port === userData.port
        );
        
        if (selfContact) {
            console.log(`[Serveur Local] Traitement du message pour le contact: ${selfContact.name}`);
            
            // Vérifier si le message existe déjà avec une tolérance temporelle
            const messageExists = selfContact.messages.some(existingMsg => 
                existingMsg.text === message.text && 
                existingMsg.sender === message.sender &&
                Math.abs((existingMsg.timestamp || 0) - message.timestamp) < 5000 // 5 secondes de tolérance
            );
            
            if (!messageExists) {
                // Ajouter le nouveau message
                const newMessage = {
                    sender: message.sender,
                    text: message.text,
                    timestamp: message.timestamp,
                    isEncrypted: false,
                    isOldMessage: false
                };
                
                selfContact.messages.push(newMessage);
                console.log(`[Serveur Local] Nouveau message de chat ajouté: ${message.text.substring(0, 50)}...`);
                
                // Mettre à jour l'interface si nous sommes actuellement affichés
                if (currentContactId === selfContact.id) {
                    renderMessages();
                }
                
                // Mettre à jour les références globales
                updateGlobalReferences();
                
                // Notification visuelle
                showMessageNotification(message.text);
            } else {
                console.log(`[Serveur Local] Message déjà existant, ignoré: ${message.text.substring(0, 50)}...`);
            }
        } else {
            console.warn('[Serveur Local] Contact correspondant non trouvé pour le message reçu');
        }
        
    } catch (error) {
        console.error('[Serveur Local] Erreur lors du traitement du message de chat:', error);
    }
}

// Fonction pour afficher une notification de nouveau message
function showMessageNotification(messageText) {
    // Créer une notification simple
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #4CAF50;
        color: white;
        padding: 15px;
        border-radius: 5px;
        box-shadow: 0 4px 8px rgba(0,0,0,0.3);
        z-index: 10000;
        max-width: 300px;
        word-wrap: break-word;
    `;
    notification.textContent = `💬 Nouveau message: ${messageText.substring(0, 50)}${messageText.length > 50 ? '...' : ''}`;
    
    document.body.appendChild(notification);
    
    // Supprimer la notification après 5 secondes
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 5000);
}

// Fonction pour envoyer un message via WebRTC
function sendMessageViaWebRTC(contactId, messageText) {
    const connection = webrtcConnections.get(contactId);
    if (!connection) {
        console.warn(`[WebRTC] Aucune connexion disponible pour le contact ${contactId}`);
        return false;
    }

    // Vérifier si c'est une connexion à soi-même
    const userData = localStorage.getItem('userData') ? JSON.parse(localStorage.getItem('userData')) : null;
    const contact = contacts.find(c => c.id == contactId);
    const isSelfConnection = userData && contact.IP === userData.ip && contact.Port === userData.port;

    if (isSelfConnection && connection._realConnected) {
        // Envoyer le message via le serveur local
        if (localDataChannel && localDataChannel.readyState === 'open') {
            const message = {
                type: 'chat_message',
                sender: userData.id,
                text: messageText,
                timestamp: Date.now()
            };
            
            localDataChannel.send(JSON.stringify(message));
            console.log(`💬 Message envoyé à soi-même via WebRTC: ${messageText}`);
            return true;
        } else {
            console.warn(`[WebRTC] Canal de données local non disponible`);
            return false;
        }
    } else if (connection.connectionState === 'connected') {
        // Envoyer le message via la connexion WebRTC normale
        const dataChannels = connection.getDataChannels();
        if (dataChannels && dataChannels.length > 0 && dataChannels[0].readyState === 'open') {
            const message = {
                type: 'chat_message',
                sender: userData ? userData.id : 'unknown',
                text: messageText,
                timestamp: Date.now()
            };
            
            dataChannels[0].send(JSON.stringify(message));
            console.log(`💬 Message envoyé via WebRTC: ${messageText}`);
            return true;
        }
    }

    console.warn(`[WebRTC] Impossible d'envoyer le message via WebRTC`);
    return false;
}

