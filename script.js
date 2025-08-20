// Fonction pour attendre le submit du formulaire et récupérer les données
function waitForFormSubmit() {
    return new Promise((resolve) => {
        const popupForm = document.getElementById('popup-form');
        const closeBtn = document.getElementById('close-btn');

        // Fermer le popup
        closeBtn.addEventListener('click', () => {
            document.getElementById('popup-overlay').style.display = 'none';
        });

        popupForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const userID = document.getElementById('ID').value;
            const password = document.getElementById('password').value;
            const port = document.getElementById('port').value;

            let ip;
            try {
                const response = await fetch('https://api.ipify.org?format=json');
                const data = await response.json();
                ip = data.ip;
            } catch {
                ip = "inconnue";
            }

            const userData = { id: userID, password, port, ip };
            localStorage.setItem("userData", JSON.stringify(userData));

            // Fermer le popup et vider le formulaire
            document.getElementById('popup-overlay').style.display = 'none';
            popupForm.reset();

            resolve(userData); // Résout la Promise avec les données
        });
    });
}

// === Code principal qui attend le submit ===
document.addEventListener('DOMContentLoaded', async () => {
    // Affiche le popup
    document.getElementById('popup-overlay').style.display = 'flex';

    // Attend que le formulaire soit soumis
    const userData = await waitForFormSubmit();

    console.log("Données après submit :", userData);

    // Exemple : générer un hash ID + password
    async function hashText(text) {
        const encoder = new TextEncoder();
        const data = encoder.encode(text);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    }

    const hash = await hashText(userData.id + userData.password);
    console.log("Hash ID+Password :", hash);

    // Fonctions utilitaires
    function hashStringToIntArray(str, size, mod) {
        // Convertit une chaîne en tableau d'entiers modulo `mod`
        let arr = new Array(size).fill(0);
        for (let i = 0; i < str.length; i++) {
            arr[i % size] = (arr[i % size] + str.charCodeAt(i)) % mod;
        }
        return arr;
    }

    // Paramètres du chiffrement post-quantum simplifié
    const N = 16;   // taille du polynôme
    const Q = 257;  // modulo pour coefficients
    const P = 3;    // petit modulo pour clé publique

    // Génération déterministe de la clé privée à partir de hash
    function generatePrivateKey(seed) {
        return hashStringToIntArray(seed, N, Q);
    }

    // Génération de la clé publique à partir de la clé privée
    function generatePublicKey(privateKey) {
        // Ici, simple formule : pub = (priv * P) mod Q
        return privateKey.map(coef => (coef * P) % Q);
    }

    // Génération des clés
    let privateKey = generatePrivateKey(hash);
    let publicKey  = generatePublicKey(privateKey);

    localStorage.setItem('publicKey', JSON.stringify(publicKey));
    localStorage.setItem('privateKey', JSON.stringify(privateKey));

    console.log("Clé privée:", privateKey);
    console.log("Clé publique:", publicKey);

    // Préparer le texte à copier avec la clé publique et l'IP
    const clipboardUserData = localStorage.getItem("userData") ? JSON.parse(localStorage.getItem("userData")) : null;
    const userIP = clipboardUserData ? clipboardUserData.ip : 'IP non disponible';
    const clipboardText = `Clé publique: ${JSON.stringify(publicKey)}\nIP publique: ${userIP}`;
    
    navigator.clipboard.writeText(clipboardText)
    .then(() => {
        console.log("Public Key et IP publique copiés dans le presse-papier !");
    })
    .catch(err => {
        console.error("Erreur lors de la copie : ", err);
    });
});

// ===== FONCTIONS WEBRTC ET ENVOI JSON ===== //

// Fonction pour envoyer le JSON modifié et chiffré à un contact spécifique
function sendJSONToContact(contact, webrtcConnection) {
    try {
        // Récupérer les contacts depuis ui.js (accessible globalement)
        if (typeof window.contacts === 'undefined' || !window.contacts.length) {
            console.warn('[JSON] Aucun contact disponible pour l\'envoi');
            return false;
        }

        // Récupérer la clé privée
        const privateKey = localStorage.getItem('privateKey');
        if (!privateKey) {
            console.error('[JSON] Clé privée non trouvée');
            return false;
        }

        // Récupérer les informations de l'expéditeur
        const userData = localStorage.getItem('userData') ? JSON.parse(localStorage.getItem('userData')) : null;
        const senderIP = userData ? userData.ip : 'unknown';
        const senderPort = userData ? userData.port : 'unknown';
        const senderPublicKey = localStorage.getItem('publicKey') ? JSON.parse(localStorage.getItem('publicKey')) : null;
        
        // Préparer les données d'export avec chiffrement - UNIQUEMENT pour le contact destinataire
        const exportData = {
            contacts: [{
                // Remplacer les informations du contact par celles de l'expéditeur
                name: '', // Nom vide comme demandé
                IP: senderIP, // IP de l'expéditeur
                Port: senderPort, // Port de l'expéditeur
                PK: senderPublicKey, // Clé publique de l'expéditeur
                messages: contact.messages.map(msg => {
                    let messageText = msg.text;
                    
                    // Chiffrer seulement les nouveaux messages (pas ceux importés)
                    if (!msg.isOldMessage) {
                        try {
                            // Utiliser la fonction de chiffrement de ui.js
                            if (typeof window.encryptMessagePostQuantum === 'function') {
                                messageText = window.encryptMessagePostQuantum(
                                    msg.text, 
                                    privateKey, 
                                    contact.PK
                                );
                            } else {
                                console.warn('[JSON] Fonction de chiffrement non disponible');
                                messageText = msg.text;
                            }
                        } catch (error) {
                            console.warn('[JSON] Erreur lors du chiffrement du message:', error);
                            messageText = msg.text;
                        }
                    }
                    
                    return {
                        sender: msg.sender,
                        text: messageText,
                        isEncrypted: msg.isOldMessage ? true : false,
                        isOldMessage: msg.isOldMessage
                    };
                })
            }]
        };

        // Convertir en JSON et chiffrer l'ensemble
        const jsonString = JSON.stringify(exportData, null, 2);
        
        // Log des données envoyées (pour debug)
        console.log(`📋 JSON à envoyer à ${contact.name}:`, {
            contactName: exportData.contacts[0].name,
            contactIP: exportData.contacts[0].IP,
            contactPort: exportData.contacts[0].Port,
            contactPK: exportData.contacts[0].PK ? 'Clé publique expéditeur' : 'Aucune clé',
            messageCount: exportData.contacts[0].messages.length,
            originalContactName: contact.name,
            originalContactIP: contact.IP,
            originalContactPort: contact.Port,
            originalContactPK: contact.PK ? 'Clé publique contact' : 'Aucune clé'
        });
        
        // Chiffrer le JSON complet avec la clé publique du contact
        let encryptedJSON;
        if (typeof window.encryptMessagePostQuantum === 'function') {
            encryptedJSON = window.encryptMessagePostQuantum(
                jsonString, 
                privateKey, 
                contact.PK
            );
        } else {
            encryptedJSON = jsonString; // Fallback si le chiffrement n'est pas disponible
        }

        // Préparer le message à envoyer
        const messageToSend = {
            type: 'json_update',
            timestamp: Date.now(),
            sender: localStorage.getItem('userData') ? JSON.parse(localStorage.getItem('userData')).id : 'unknown',
            data: encryptedJSON,
            checksum: generateChecksum(encryptedJSON)
        };

        // Envoyer via le canal de données WebRTC
        if (webrtcConnection && webrtcConnection.connectionState === 'connected') {
            const dataChannels = webrtcConnection.getDataChannels();
            if (dataChannels && dataChannels.length > 0) {
                dataChannels[0].send(JSON.stringify(messageToSend));
                console.log(`✅ JSON personnalisé envoyé à ${contact.name} via WebRTC (IP: ${senderIP}, Port: ${senderPort}, PK: expéditeur)`);
                return true;
            } else {
                console.warn(`[JSON] Aucun canal de données disponible pour ${contact.name}`);
                return false;
            }
        } else {
            console.warn(`[JSON] Connexion WebRTC non établie avec ${contact.name}`);
            return false;
        }

    } catch (error) {
        console.error(`[JSON] Erreur lors de l'envoi du JSON à ${contact.name}:`, error);
        return false;
    }
}

// Fonction pour envoyer le JSON à tous les contacts connectés
function sendJSONToAllConnectedContacts(webrtcConnections) {
    if (!webrtcConnections || webrtcConnections.size === 0) {
        console.log('[JSON] Aucune connexion WebRTC disponible');
        return;
    }

    let successCount = 0;
    let totalCount = webrtcConnections.size;

    webrtcConnections.forEach((connection, contactId) => {
        // Trouver le contact correspondant
        const contact = window.contacts.find(c => c.id == contactId);
        if (contact && connection.connectionState === 'connected') {
            console.log(`📤 Envoi du JSON personnalisé à ${contact.name}...`);
            if (sendJSONToContact(contact, connection)) {
                successCount++;
            }
        }
    });

    console.log(`📤 JSON personnalisé envoyé à ${successCount}/${totalCount} contacts connectés`);
}

// Fonction pour envoyer le JSON quand une connexion s'établit
function onWebRTCConnectionEstablished(contact, webrtcConnection) {
    console.log(`🔗 Connexion établie avec ${contact.name}, envoi du JSON...`);
    
    // Attendre un peu que la connexion soit stable
    setTimeout(() => {
        sendJSONToContact(contact, webrtcConnection);
    }, 1000);
}

// Fonction pour envoyer le JSON après l'envoi d'un message
function onMessageSent(contactId) {
    console.log(`💬 Message envoyé, mise à jour du JSON pour le contact ${contactId}...`);
    
    // Trouver la connexion WebRTC du contact
    if (window.webrtcConnections && window.webrtcConnections.has(contactId)) {
        const connection = window.webrtcConnections.get(contactId);
        const contact = window.contacts.find(c => c.id == contactId);
        
        if (contact && connection.connectionState === 'connected') {
            sendJSONToContact(contact, connection);
        }
    }
}

// Fonction utilitaire pour générer un checksum
function generateChecksum(data) {
    let hash = 0;
    if (data.length === 0) return hash.toString();
    
    for (let i = 0; i < data.length; i++) {
        const char = data.charCodeAt(i);
        hash = ((hash << 5) - hash + char) & 0xffffffff;
    }
    
    return hash.toString();
}

// Exposer les fonctions globalement pour ui.js
window.sendJSONToContact = sendJSONToContact;
window.sendJSONToAllConnectedContacts = sendJSONToAllConnectedContacts;
window.onWebRTCConnectionEstablished = onWebRTCConnectionEstablished;
window.onMessageSent = onMessageSent;
