class ContactManager {
    constructor() {
        this.db = null;
        this.editingId = null;
        this.customFields = [];
        this.init();
    }

    async init() {
        await this.initDatabase();
        this.initEventListeners();
        this.loadCustomFields();
        this.loadContacts();
    }

    async initDatabase() {
        const SQL = await initSqlJs({
            locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
        });

        // Essayer de charger la base de données depuis le stockage local
        const savedData = JSON.parse(localStorage.getItem('contactsDB') || 'null');
        
        if (savedData) {
            try {
                // Restaurer la base de données depuis le stockage local
                this.db = new SQL.Database(new Uint8Array(savedData));
                
                // Vérifier que les tables existent, sinon les créer
                const tables = this.db.exec("SELECT name FROM sqlite_master WHERE type='table'");
                const tableNames = tables.length > 0 ? tables[0].values.flat() : [];
                
                if (!tableNames.includes('contacts') || !tableNames.includes('custom_fields')) {
                    console.log('Tables manquantes, recréation...');
                    this.createTables();
                    this.addSampleData();
                    this.saveDatabase();
                }
            } catch (error) {
                console.error('Erreur lors de la restauration de la base:', error);
                // Si erreur, créer une nouvelle base
                this.createNewDatabase(SQL);
            }
        } else {
            // Créer une nouvelle base de données
            this.createNewDatabase(SQL);
        }
    }

    createNewDatabase(SQL) {
        this.db = new SQL.Database();
        this.createTables();
        this.addSampleData();
        this.saveDatabase();
    }

    createTables() {
        try {
            // Table des contacts avec gestion des erreurs
            this.db.run(`
                CREATE TABLE IF NOT EXISTS contacts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    nom TEXT NOT NULL,
                    prenom TEXT NOT NULL,
                    custom_data TEXT DEFAULT '{}',
                    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
                    date_modification DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Table des champs personnalisés
            this.db.run(`
                CREATE TABLE IF NOT EXISTS custom_fields (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE,
                    type TEXT NOT NULL DEFAULT 'text',
                    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Vérifier si la colonne custom_data existe, sinon l'ajouter
            const tableInfo = this.db.exec("PRAGMA table_info(contacts)");
            if (tableInfo.length > 0) {
                const columns = tableInfo[0].values.map(col => col[1]);
                if (!columns.includes('custom_data')) {
                    console.log('Ajout de la colonne custom_data manquante...');
                    this.db.run('ALTER TABLE contacts ADD COLUMN custom_data TEXT DEFAULT "{}"');
                }
            }

            console.log('✅ Tables créées/vérifiées avec succès');
        } catch (error) {
            console.error('❌ Erreur lors de la création des tables:', error);
            throw error;
        }
    }

    addSampleData() {
        try {
            // Vérifier si les tables existent avant d'ajouter des données
            const tables = this.db.exec("SELECT name FROM sqlite_master WHERE type='table'");
            const tableNames = tables.length > 0 ? tables[0].values.flat() : [];
            
            if (!tableNames.includes('contacts') || !tableNames.includes('custom_fields')) {
                console.log('Tables manquantes lors de l\'ajout des données d\'exemple');
                return;
            }

            const contacts = this.db.exec("SELECT COUNT(*) as count FROM contacts")[0];
            if (!contacts || contacts.values[0][0] === 0) {
                // Ajouter quelques champs personnalisés par défaut
                const defaultFields = [
                    ['Email', 'email'],
                    ['Telephone', 'tel'],
                    ['Entreprise', 'text'],
                    ['Adresse', 'text']
                ];

                defaultFields.forEach(field => {
                    try {
                        this.db.run(`
                            INSERT INTO custom_fields (name, type) VALUES (?, ?)
                        `, field);
                    } catch (fieldError) {
                        console.warn('Erreur lors de l\'ajout du champ par défaut:', field[0], fieldError);
                    }
                });

                // Ajouter quelques contacts d'exemple
                const sampleContacts = [];

                sampleContacts.forEach(contact => {
                    try {
                        this.db.run(`
                            INSERT INTO contacts (nom, prenom, custom_data)
                            VALUES (?, ?, ?)
                        `, [contact.nom, contact.prenom, JSON.stringify(contact.customData)]);
                    } catch (contactError) {
                        console.warn('Erreur lors de l\'ajout du contact d\'exemple:', contact.nom, contactError);
                    }
                });
            }
        } catch (error) {
            console.error('Erreur lors de l\'ajout des données d\'exemple:', error);
        }
    }

    saveDatabase() {
        const data = this.db.export();
        localStorage.setItem('contactsDB', JSON.stringify(Array.from(data)));
    }

    initEventListeners() {
        document.getElementById('contact-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveContact();
        });

        document.getElementById('search').addEventListener('input', (e) => {
            this.searchContacts(e.target.value);
        });

        document.getElementById('cancel-btn').addEventListener('click', () => {
            this.resetForm();
        });
    }

    loadCustomFields() {
        try {
            // Vérifier que la table existe
            const tables = this.db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='custom_fields'");
            if (tables.length === 0) {
                console.log('Table custom_fields manquante, recréation...');
                this.createTables();
            }

            const result = this.db.exec('SELECT * FROM custom_fields ORDER BY name');
            this.customFields = result.length > 0 ? result[0].values : [];
            this.renderCustomFields();
            
            console.log(`📋 ${this.customFields.length} champ(s) personnalisé(s) chargé(s)`);
        } catch (error) {
            console.error('Erreur lors du chargement des champs personnalisés:', error);
            // Essayer de recréer les tables
            try {
                this.createTables();
                this.customFields = [];
                this.renderCustomFields();
            } catch (recreateError) {
                console.error('Impossible de recréer les tables:', recreateError);
                alert('Erreur critique avec la base de données. Veuillez réinitialiser.');
            }
        }
    }

    renderCustomFields() {
        const container = document.getElementById('dynamic-fields');
        container.innerHTML = '';

        console.log(`🔄 Rendu de ${this.customFields.length} champ(s) personnalisé(s)`);

        this.customFields.forEach((field, index) => {
            const [id, name, type] = field;
            const fieldDiv = document.createElement('div');
            fieldDiv.className = 'form-group custom-field';
            
            // Créer le HTML du champ de façon sécurisée
            fieldDiv.innerHTML = `
                <button type="button" class="remove-field" title="Supprimer ce champ">×</button>
                <label for="field-${name}">${name}</label>
                <input 
                    type="${type}" 
                    id="field-${name}" 
                    name="field-${name}" 
                    data-field-name="${name}"
                    placeholder="Saisir ${name.toLowerCase()}..."
                >
            `;
            
            // Ajouter l'événement de suppression de façon sécurisée
            const removeBtn = fieldDiv.querySelector('.remove-field');
            removeBtn.addEventListener('click', () => {
                this.removeCustomField(name);
            });
            
            container.appendChild(fieldDiv);
            
            console.log(`🔹 Champ rendu: ${name} (type: ${type}, id: field-${name})`);
        });
        
        console.log('✅ Rendu des champs personnalisés terminé');
    }

    showAddField() {
        document.querySelector('.add-field-form').style.display = 'block';
        document.getElementById('add-field-btn').style.display = 'none';
        document.getElementById('new-field-name').focus();
    }

    cancelAddField() {
        document.querySelector('.add-field-form').style.display = 'none';
        document.getElementById('add-field-btn').style.display = 'block';
        document.getElementById('new-field-name').value = '';
    }

    addCustomField() {
        const name = document.getElementById('new-field-name').value.trim();
        const type = document.getElementById('new-field-type').value;

        if (!name) {
            alert('Veuillez entrer un nom pour le champ');
            return;
        }

        // Vérifier si le champ existe déjà 
        if (this.customFields.some(field => field[1].toLowerCase() === name.toLowerCase())) {
            alert('Un champ avec ce nom existe déjà');
            return;
        }

        try {
            // Vérifier que la table existe
            const tables = this.db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='custom_fields'");
            if (tables.length === 0) {
                console.log('Table custom_fields manquante, recréation...');
                this.createTables();
            }

            this.db.run(`
                INSERT INTO custom_fields (name, type) VALUES (?, ?)
            `, [name, type]);
            
            this.saveDatabase();
            this.loadCustomFields();
            this.cancelAddField();
            
            // Message de succès
            const successMsg = document.createElement('div');
            successMsg.style.cssText = `
                position: fixed; top: 20px; right: 20px; 
                background: #28a745; color: white; 
                padding: 15px 20px; border-radius: 8px;
                z-index: 1000; font-weight: 600;
            `;
            successMsg.textContent = `✅ Champ "${name}" ajouté avec succès !`;
            document.body.appendChild(successMsg);
            setTimeout(() => document.body.removeChild(successMsg), 3000);
            
        } catch (error) {
            console.error('Erreur lors de l\'ajout du champ:', error);
            alert('Erreur lors de l\'ajout du champ : ' + error.message + '\n\nEssayez de réinitialiser la base de données.');
        }
    }

    removeCustomField(fieldName) {
        if (confirm(`Êtes-vous sûr de vouloir supprimer le champ "${fieldName}" ?\n\nCela supprimera aussi les données de ce champ pour tous les contacts.`)) {
            try {
                // Vérifier que les tables existent
                const tables = this.db.exec("SELECT name FROM sqlite_master WHERE type='table'");
                const tableNames = tables.length > 0 ? tables[0].values.flat() : [];
                
                if (!tableNames.includes('custom_fields')) {
                    console.log('Table custom_fields manquante, recréation...');
                    this.createTables();
                    return;
                }

                // Supprimer le champ personnalisé
                this.db.run('DELETE FROM custom_fields WHERE name = ?', [fieldName]);
                
                // Vérifier si la table contacts existe et a la colonne custom_data
                if (tableNames.includes('contacts')) {
                    // Vérifier la structure de la table contacts
                    const tableInfo = this.db.exec("PRAGMA table_info(contacts)");
                    const columns = tableInfo.length > 0 ? tableInfo[0].values.map(col => col[1]) : [];
                    
                    if (columns.includes('custom_data')) {
                        // Supprimer les données de ce champ de tous les contacts
                        const contacts = this.db.exec('SELECT id, custom_data FROM contacts WHERE custom_data IS NOT NULL');
                        if (contacts.length > 0) {
                            contacts[0].values.forEach(contact => {
                                const [id, customDataStr] = contact;
                                if (customDataStr) {
                                    try {
                                        const customData = JSON.parse(customDataStr);
                                        if (customData.hasOwnProperty(fieldName)) {
                                            delete customData[fieldName];
                                            this.db.run('UPDATE contacts SET custom_data = ? WHERE id = ?', 
                                                [JSON.stringify(customData), id]);
                                        }
                                    } catch (jsonError) {
                                        console.warn('Données JSON corrompues pour le contact ID:', id);
                                        // Nettoyer les données corrompues
                                        this.db.run('UPDATE contacts SET custom_data = ? WHERE id = ?', 
                                            ['{}', id]);
                                    }
                                }
                            });
                        }
                    } else {
                        console.log('Colonne custom_data manquante, mise à jour de la table...');
                        // Ajouter la colonne manquante
                        try {
                            this.db.run('ALTER TABLE contacts ADD COLUMN custom_data TEXT');
                        } catch (alterError) {
                            console.warn('Impossible d\'ajouter la colonne custom_data:', alterError);
                        }
                    }
                }
                
                this.saveDatabase();
                this.loadCustomFields();
                this.loadContacts();
                
                // Message de succès
                const successMsg = document.createElement('div');
                successMsg.style.cssText = `
                    position: fixed; top: 20px; right: 20px; 
                    background: #dc3545; color: white; 
                    padding: 15px 20px; border-radius: 8px;
                    z-index: 1000; font-weight: 600;
                `;
                successMsg.textContent = `🗑️ Champ "${fieldName}" supprimé avec succès !`;
                document.body.appendChild(successMsg);
                setTimeout(() => document.body.removeChild(successMsg), 3000);
                
            } catch (error) {
                console.error('Erreur lors de la suppression du champ:', error);
                alert('Erreur lors de la suppression du champ : ' + error.message + '\n\nEssayez de réinitialiser la base de données si le problème persiste.');
            }
        }
    }

    saveContact() {
        const nom = document.getElementById('nom').value.trim();
        const prenom = document.getElementById('prenom').value.trim();

        if (!nom || !prenom) {
            alert('Le nom et le prénom sont obligatoires !');
            return;
        }

        // Collecter les données des champs personnalisés
        const customData = {};
        
        // Parcourir les champs connus depuis this.customFields
        this.customFields.forEach(field => {
            const [fieldId, fieldName, fieldType] = field;
            const input = document.getElementById(`field-${fieldName}`);
            
            if (input) {
                const fieldValue = input.value.trim();
                console.log(`🔹 Champ collecté: ${fieldName} = "${fieldValue}"`);
                customData[fieldName] = fieldValue;
            } else {
                console.warn(`⚠️ Input non trouvé pour le champ: field-${fieldName}`);
                customData[fieldName] = '';
            }
        });

        console.log('📦 Données personnalisées collectées:', customData);

        try {
            if (this.editingId) {
                // Modifier le contact existant
                console.log(`✏️ Modification du contact ID: ${this.editingId}`);
                this.db.run(`
                    UPDATE contacts 
                    SET nom=?, prenom=?, custom_data=?, date_modification=CURRENT_TIMESTAMP
                    WHERE id=?
                `, [nom, prenom, JSON.stringify(customData), this.editingId]);
            } else {
                // Ajouter un nouveau contact
                console.log('➕ Ajout d\'un nouveau contact');
                this.db.run(`
                    INSERT INTO contacts (nom, prenom, custom_data)
                    VALUES (?, ?, ?)
                `, [nom, prenom, JSON.stringify(customData)]);
            }

            this.saveDatabase();
            this.resetForm();
            this.loadContacts();
            
            // Message de succès
            const action = this.editingId ? 'modifié' : 'ajouté';
            console.log(`✅ Contact ${action} avec succès:`, { nom, prenom, customData });
            
            // Notification visuelle
            const successMsg = document.createElement('div');
            successMsg.style.cssText = `
                position: fixed; top: 20px; right: 20px; 
                background: #28a745; color: white; 
                padding: 15px 20px; border-radius: 8px;
                z-index: 1000; font-weight: 600;
            `;
            successMsg.textContent = `✅ Contact ${action} avec succès !`;
            document.body.appendChild(successMsg);
            setTimeout(() => {
                if (document.body.contains(successMsg)) {
                    document.body.removeChild(successMsg);
                }
            }, 3000);
            
        } catch (error) {
            console.error('❌ Erreur lors de la sauvegarde:', error);
            alert('Erreur lors de la sauvegarde : ' + error.message);
        }
    }

    loadContacts(searchTerm = '') {
        let query = 'SELECT * FROM contacts';
        let params = [];

        if (searchTerm) {
            query += ` WHERE nom LIKE ? OR prenom LIKE ? OR custom_data LIKE ?`;
            const term = `%${searchTerm}%`;
            params = [term, term, term];
        }

        query += ' ORDER BY nom, prenom';

        const result = this.db.exec(query, params);
        const contacts = result.length > 0 ? result[0].values : [];

        this.displayContacts(contacts);
        this.updateStats(contacts.length);
    }

    displayContacts(contacts) {
        const container = document.getElementById('contacts-list');

        if (contacts.length === 0) {
            container.innerHTML = `
                <div class="no-contacts">
                    ${document.getElementById('search').value ? 
                        'Aucun contact trouvé pour cette recherche.' : 
                        'Aucun contact pour le moment.<br>Utilisez le formulaire pour ajouter votre premier contact !'}
                </div>
            `;
            return;
        }

        container.innerHTML = contacts.map(contact => {
            const [id, nom, prenom, customDataStr] = contact;
            const customData = customDataStr ? JSON.parse(customDataStr) : {};

            const customFields = Object.entries(customData).map(([key, value]) => `
                <div class="contact-detail custom-field">
                    <strong>${key}:</strong> ${value || 'Non renseigné'}
                </div>
            `).join('');

            return `
                <div class="contact-card" data-id="${id}">
                    <div class="contact-name">${prenom} ${nom}</div>
                    <div class="contact-info">
                        ${customFields}
                    </div>
                    <div class="contact-actions">
                        <button class="btn btn-primary btn-sm" onclick="contactManager.editContact(${id})">
                            ✏️ Modifier
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="contactManager.deleteContact(${id})">
                            🗑️ Supprimer
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    editContact(id) {
        const result = this.db.exec('SELECT * FROM contacts WHERE id = ?', [id]);
        if (result.length === 0) return;

        const contact = result[0].values[0];
        const [contactId, nom, prenom, customDataStr] = contact;
        const customData = customDataStr ? JSON.parse(customDataStr) : {};

        this.editingId = id;

        // Remplir les champs obligatoires
        document.getElementById('nom').value = nom || '';
        document.getElementById('prenom').value = prenom || '';

        // Remplir les champs personnalisés
        this.customFields.forEach(field => {
            const [fieldId, fieldName] = field;
            const input = document.getElementById(`field-${fieldName}`);
            if (input) {
                input.value = customData[fieldName] || '';
            }
        });

        // Changer l'interface
        document.getElementById('form-title').textContent = 'Modifier le Contact';
        document.getElementById('submit-btn').innerHTML = '💾 Sauvegarder';
        document.getElementById('cancel-btn').style.display = 'inline-block';

        // Highlight le contact sélectionné
        document.querySelectorAll('.contact-card').forEach(card => card.classList.remove('selected'));
        document.querySelector(`[data-id="${id}"]`).classList.add('selected');
    }

    deleteContact(id) {
        if (confirm('Êtes-vous sûr de vouloir supprimer ce contact ?')) {
            this.db.run('DELETE FROM contacts WHERE id = ?', [id]);
            this.saveDatabase();
            this.loadContacts();
            if (this.editingId === id) {
                this.resetForm();
            }
        }
    }

    resetForm() {
        document.getElementById('contact-form').reset();
        this.editingId = null;

        document.getElementById('form-title').textContent = 'Ajouter un Contact';
        document.getElementById('submit-btn').innerHTML = '➕ Ajouter le Contact';
        document.getElementById('cancel-btn').style.display = 'none';

        document.querySelectorAll('.contact-card').forEach(card => card.classList.remove('selected'));
    }

    searchContacts(term) {
        this.loadContacts(term);
    }

    updateStats(count) {
        const fieldStats = this.customFields.length;
        let statsText = `📊 Total: ${count} contact(s) | Champs personnalisés: ${fieldStats}`;
        document.getElementById('stats').textContent = statsText;
    }

    resetDatabase() {
        if (confirm('Êtes-vous sûr de vouloir supprimer TOUS les contacts et champs personnalisés ?')) {
            try {
                localStorage.removeItem('contactsDB');
                location.reload();
            } catch (error) {
                alert('Erreur lors de la réinitialisation : ' + error.message);
            }
        }
    }

    exportData() {
        try {
            const contacts = this.db.exec('SELECT * FROM contacts ORDER BY nom, prenom');
            const customFields = this.db.exec('SELECT * FROM custom_fields ORDER BY name');
            
            const data = {
                contacts: contacts.length > 0 ? contacts[0].values : [],
                customFields: customFields.length > 0 ? customFields[0].values : []
            };
            
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `contacts-export-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            alert(`Export réussi !\n${data.contacts.length} contact(s) et ${data.customFields.length} champ(s) exporté(s).`);
        } catch (error) {
            console.error('Erreur lors de l\'export:', error);
            alert('Erreur lors de l\'export : ' + error.message);
        }
    }

    importData(input) {
        const file = input.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                
                if (confirm('Cela va remplacer toutes vos données actuelles. Continuer ?')) {
                    // Vider les tables existantes
                    this.db.run('DELETE FROM contacts');
                    this.db.run('DELETE FROM custom_fields');
                    
                    // Réinitialiser les compteurs auto-increment
                    this.db.run('DELETE FROM sqlite_sequence WHERE name IN ("contacts", "custom_fields")');
                    
                    // Importer les champs personnalisés
                    if (data.customFields && Array.isArray(data.customFields)) {
                        data.customFields.forEach(field => {
                            try {
                                this.db.run('INSERT INTO custom_fields (name, type) VALUES (?, ?)', 
                                    [field[1], field[2] || 'text']);
                            } catch (fieldError) {
                                console.warn('Erreur lors de l\'import du champ:', field, fieldError);
                            }
                        });
                    }
                    
                    // Importer les contacts
                    if (data.contacts && Array.isArray(data.contacts)) {
                        data.contacts.forEach(contact => {
                            try {
                                this.db.run('INSERT INTO contacts (nom, prenom, custom_data) VALUES (?, ?, ?)', 
                                    [contact[1] || '', contact[2] || '', contact[3] || '{}']);
                            } catch (contactError) {
                                console.warn('Erreur lors de l\'import du contact:', contact, contactError);
                            }
                        });
                    }
                    
                    this.saveDatabase();
                    this.loadCustomFields();
                    this.loadContacts();
                    alert(`Données importées avec succès !\n${data.contacts?.length || 0} contact(s) et ${data.customFields?.length || 0} champ(s) personnalisé(s) importé(s).`);
                }
            } catch (error) {
                alert('Erreur lors de l\'importation :\n' + error.message + '\n\nVérifiez que le fichier est un export valide.');
                console.error('Import error:', error);
            }
            
            input.value = '';
        };
        
        reader.readAsText(file);
    }
}

// Initialiser l'application quand le DOM est prêt
let contactManager;

window.addEventListener('DOMContentLoaded', async () => {
    try {
        // Afficher un indicateur de chargement
        const loadingDiv = document.createElement('div');
        loadingDiv.innerHTML = `
            <div style="
                position: fixed; 
                top: 0; left: 0; 
                width: 100%; height: 100%; 
                background: rgba(102, 126, 234, 0.9); 
                display: flex; 
                align-items: center; 
                justify-content: center; 
                color: white; 
                font-size: 1.5rem;
                z-index: 9999;
            ">
                <div style="text-align: center;">
                    <div>📞 Chargement du gestionnaire de contacts...</div>
                    <div style="font-size: 1rem; margin-top: 10px; opacity: 0.8;">
                        Initialisation de la base de données SQLite
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(loadingDiv);
        
        // Initialiser le gestionnaire de contacts
        contactManager = new ContactManager();
        
        // Attendre que l'initialisation soit terminée
        await new Promise(resolve => {
            const checkInit = () => {
                if (contactManager.db) {
                    resolve();
                } else {
                    setTimeout(checkInit, 100);
                }
            };
            checkInit();
        });
        
        // Supprimer l'indicateur de chargement
        document.body.removeChild(loadingDiv);
        
        console.log('📞 Gestionnaire de contacts initialisé avec succès !');
        
    } catch (error) {
        console.error('❌ Erreur lors de l\'initialisation:', error);
        alert('Erreur lors de l\'initialisation de l\'application. Veuillez recharger la page.');
    }
});

// Gestion des erreurs globales
window.addEventListener('error', (event) => {
    console.error('Erreur JavaScript:', event.error);
});

// Prévenir la fermeture accidentelle avec des données non sauvegardées
window.addEventListener('beforeunload', (event) => {
    if (contactManager && contactManager.editingId) {
        event.preventDefault();
        event.returnValue = 'Vous avez des modifications non sauvegardées. Êtes-vous sûr de vouloir quitter ?';
        return event.returnValue;
    }
});

// Gestion du mode hors-ligne (optionnel)
window.addEventListener('online', () => {
    console.log('📶 Connexion internet rétablie');
});

window.addEventListener('offline', () => {
    console.log('📵 Mode hors-ligne - Les données sont sauvegardées localement');
});
