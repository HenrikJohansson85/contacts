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
                    ['Téléphone', 'tel'],
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
                const sampleContacts = [
                    {
                        nom: 'Dupont',
                        prenom: 'Jean',
                        customData: {
                            'Email': 'jean.dupont@email.com',
                            'Téléphone': '01 23 45 67 89',
                            'Entreprise': 'TechCorp',
                            'Adresse': '123 Rue de la Paix, Paris'
                        }
                    },
                    {
                        nom: 'Martin',
                        prenom: 'Marie',
                        customData: {
                            'Email': 'marie.martin@gmail.com',
                            'Téléphone': '06 12 34 56 78',
                            'Adresse': '45 Avenue des Champs, Lyon'
                        }
                    }
                ];

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

        this.customFields.forEach(field => {
            const [id, name, type] = field;
            const fieldDiv = document.createElement('div');
            fieldDiv.className = 'form-group custom-field';
            fieldDiv.innerHTML = `
                <button type="button" class="remove-field" onclick="contactManager.removeCustomField('${name}')" title="Supprimer ce champ">×</button>
                <label for="field-${name}">${name}</label>
                <input type="${type}" id="field-${name}" name="field-${name}" data-field-name="${name}">
            `;
            container.appendChild(fieldDiv);
        });
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
        this.customFields.forEach(field => {
            const [id, name] = field;
            const input = document.getElementById(`field-${name}`);
            if (input && input.value.trim()) {
                customData[name] = input.value.trim();
            }
        });

        try {
            if (this.editingId) {
                // Modifier le contact existant
                this.db.run(`
                    UPDATE contacts 
                    SET nom=?, prenom=?, custom_data=?, date_modification=CURRENT_TIMESTAMP
                    WHERE id=?
                `, [nom, prenom, JSON.stringify(customData), this.editingId]);
            } else {
                // Ajouter un nouveau contact
                this.db.run(`
                    INSERT INTO contacts (nom, prenom, custom_data)
                    VALUES (?, ?, ?)
                `, [nom, prenom, JSON.stringify(customData)]);
            }

            this.saveDatabase();
            this.resetForm();
            this.loadContacts();
        } catch (error) {
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

    // Méthode de diagnostic pour vérifier l'état de la base
    diagnoseDatabaseStructure() {
        try {
            console.log('🔍 Diagnostic de la base de données...');
            
            // Lister toutes les tables
            const tables = this.db.exec("SELECT name FROM sqlite_master WHERE type='table'");
            const tableNames = tables.length > 0 ? tables[0].values.flat() : [];
            console.log('📋 Tables existantes:', tableNames);
            
            // Vérifier la structure de chaque table
            tableNames.forEach(tableName => {
                const tableInfo = this.db.exec(`PRAGMA table_info(${tableName})`);
                if (tableInfo.length > 0) {
                    const columns = tableInfo[0].values.map(col => ({
                        name: col[1],
                        type: col[2],
                        notnull: col[3],
                        default_value: col[4],
                        primary_key: col[5]
                    }));
                    console.log(`🏗️ Structure de ${tableName}:`, columns);
                }
            });
            
            // Compter les données
            if (tableNames.includes('contacts')) {
                const contactCount = this.db.exec('SELECT COUNT(*) FROM contacts')[0].values[0][0];
                console.log('👥 Nombre de contacts:', contactCount);
            }
            
            if (tableNames.includes('custom_fields')) {
                const fieldCount = this.db.exec('SELECT COUNT(*) FROM custom_fields')[0].values[0][0];
                console.log('🏷️ Nombre de champs personnalisés:', fieldCount);
            }
            
            return {
                tables: tableNames,
                isHealthy: tableNames.includes('contacts') && tableNames.includes('custom_fields')
            };
            
        } catch (error) {
            console.error('❌ Erreur lors du diagnostic:', error);
            return { tables: [], isHealthy: false, error: error.message };
        }
    }

    exportData() {
        try {
            const contacts = this.db.exec('SELECT * FROM contacts ORDER BY nom, prenom');
            const customFields = this.db.exec('SELECT * FROM custom_fields ORDER BY name');
            
            // Générer le script SQL
            let sqlScript = `-- Export du Gestionnaire de Contacts
-- Date d'export: ${new Date().toLocaleString('fr-FR')}
-- Nombre de contacts: ${contacts.length > 0 ? contacts[0].values.length : 0}
-- Nombre de champs personnalisés: ${customFields.length > 0 ? customFields[0].values.length : 0}

-- ============================================
-- Structure des tables
-- ============================================

-- Supprimer les tables existantes si elles existent
DROP TABLE IF EXISTS contacts;
DROP TABLE IF EXISTS custom_fields;

-- Créer la table des champs personnalisés
CREATE TABLE custom_fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL DEFAULT 'text',
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Créer la table des contacts
CREATE TABLE contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,
    prenom TEXT NOT NULL,
    custom_data TEXT DEFAULT '{}',
    date_creation DATETIME DEFAULT CURRENT_TIMESTAMP,
    date_modification DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- Données des champs personnalisés
-- ============================================

`;

            // Exporter les champs personnalisés
            if (customFields.length > 0 && customFields[0].values.length > 0) {
                customFields[0].values.forEach(field => {
                    const [id, name, type, dateCreation] = field;
                    const escapedName = name.replace(/'/g, "''");
                    const escapedType = type.replace(/'/g, "''");
                    sqlScript += `INSERT INTO custom_fields (name, type, date_creation) VALUES ('${escapedName}', '${escapedType}', '${dateCreation}');\n`;
                });
            } else {
                sqlScript += `-- Aucun champ personnalisé à exporter\n`;
            }

            sqlScript += `\n-- ============================================
-- Données des contacts
-- ============================================

`;

            // Exporter les contacts
            if (contacts.length > 0 && contacts[0].values.length > 0) {
                contacts[0].values.forEach(contact => {
                    const [id, nom, prenom, customData, dateCreation, dateModification] = contact;
                    const escapedNom = (nom || '').replace(/'/g, "''");
                    const escapedPrenom = (prenom || '').replace(/'/g, "''");
                    const escapedCustomData = (customData || '{}').replace(/'/g, "''");
                    
                    sqlScript += `INSERT INTO contacts (nom, prenom, custom_data, date_creation, date_modification) VALUES ('${escapedNom}', '${escapedPrenom}', '${escapedCustomData}', '${dateCreation}', '${dateModification}');\n`;
                });
            } else {
                sqlScript += `-- Aucun contact à exporter\n`;
            }

            sqlScript += `\n-- ============================================
-- Index pour optimiser les performances
-- ============================================

CREATE INDEX IF NOT EXISTS idx_contacts_nom ON contacts(nom);
CREATE INDEX IF NOT EXISTS idx_contacts_prenom ON contacts(prenom);
CREATE INDEX IF NOT EXISTS idx_custom_fields_name ON custom_fields(name);

-- ============================================
-- Requêtes utiles pour consulter les données
-- ============================================

-- Lister tous les contacts avec leurs données personnalisées
-- SELECT 
--     id, nom, prenom, custom_data,
--     date_creation, date_modification 
-- FROM contacts 
-- ORDER BY nom, prenom;

-- Rechercher des contacts par nom ou prénom
-- SELECT * FROM contacts 
-- WHERE nom LIKE '%recherche%' OR prenom LIKE '%recherche%' 
-- ORDER BY nom, prenom;

-- Lister tous les champs personnalisés disponibles
-- SELECT name, type FROM custom_fields ORDER BY name;

-- Fin du script SQL
`;

            // Créer et télécharger le fichier SQL
            const blob = new Blob([sqlScript], { type: 'text/sql; charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `contacts-export-${new Date().toISOString().split('T')[0]}.sql`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            // Message de succès
            const successMsg = document.createElement('div');
            successMsg.style.cssText = `
                position: fixed; top: 20px; right: 20px; 
                background: #28a745; color: white; 
                padding: 15px 20px; border-radius: 8px;
                z-index: 1000; font-weight: 600;
                box-shadow: 0 5px 15px rgba(0,0,0,0.3);
            `;
            successMsg.innerHTML = `
                💾 Export SQL réussi !<br>
                <small>${contacts.length > 0 ? contacts[0].values.length : 0} contact(s) exporté(s)</small>
            `;
            document.body.appendChild(successMsg);
            setTimeout(() => document.body.removeChild(successMsg), 4000);

        } catch (error) {
            console.error('Erreur lors de l\'export SQL:', error);
            alert('Erreur lors de l\'export SQL : ' + error.message);
        }
    }

    importData(input) {
        const file = input.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const fileContent = e.target.result;
                const fileName = file.name.toLowerCase();
                
                if (fileName.endsWith('.sql')) {
                    this.importSQLData(fileContent);
                } else if (fileName.endsWith('.json')) {
                    this.importJSONData(JSON.parse(fileContent));
                } else {
                    alert('Format de fichier non supporté. Utilisez .sql ou .json');
                    return;
                }
                
            } catch (error) {
                alert('Erreur lors de l\'importation du fichier :\n' + error.message + '\n\nVérifiez que le fichier est un export valide.');
                console.error('Import error:', error);
            }
            
            // Reset l'input file pour permettre le re-import du même fichier
            input.value = '';
        };
        
        reader.onerror = () => {
            alert('Erreur lors de la lecture du fichier.');
        };
        
        reader.readAsText(file);
    }

    importSQLData(sqlContent) {
        if (confirm('Cela va remplacer toutes vos données actuelles par celles du fichier SQL. Continuer ?')) {
            try {
                // Créer une nouvelle base de données temporaire pour tester l'import
                const SQL = window.initSqlJs;
                if (!SQL) {
                    throw new Error('SQL.js non disponible');
                }

                // Créer une base temporaire et exécuter le script SQL
                const tempDb = new (SQL.Database)();
                
                // Diviser le script en commandes individuelles
                const commands = sqlContent
                    .split(';')
                    .map(cmd => cmd.trim())
                    .filter(cmd => cmd && !cmd.startsWith('--') && cmd !== '');

                let importStats = {
                    contacts: 0,
                    customFields: 0,
                    errors: []
                };

                commands.forEach((command, index) => {
                    try {
                        if (command.toLowerCase().includes('insert into contacts')) {
                            tempDb.run(command + ';');
                            importStats.contacts++;
                        } else if (command.toLowerCase().includes('insert into custom_fields')) {
                            tempDb.run(command + ';');
                            importStats.customFields++;
                        } else {
                            tempDb.run(command + ';');
                        }
                    } catch (cmdError) {
                        console.warn(`Erreur commande ${index + 1}:`, command.substring(0, 100) + '...', cmdError);
                        importStats.errors.push(`Commande ${index + 1}: ${cmdError.message}`);
                    }
                });

                // Si l'import temporaire réussit, remplacer la vraie base
                if (importStats.errors.length === 0 || importStats.errors.length < commands.length / 2) {
                    // Remplacer la base de données actuelle
                    this.db.close();
                    this.db = tempDb;
                    
                    this.saveDatabase();
                    this.loadCustomFields();
                    this.loadContacts();

                    let message = `✅ Import SQL réussi !\n\n`;
                    message += `📊 Statistiques :\n`;
                    message += `• ${importStats.contacts} contact(s) importé(s)\n`;
                    message += `• ${importStats.customFields} champ(s) personnalisé(s) importé(s)`;
                    
                    if (importStats.errors.length > 0) {
                        message += `\n\n⚠️ ${importStats.errors.length} erreur(s) ignorée(s)`;
                    }

                    alert(message);
                } else {
                    tempDb.close();
                    throw new Error(`Trop d'erreurs dans le fichier SQL (${importStats.errors.length}/${commands.length})`);
                }

            } catch (error) {
                console.error('Erreur lors de l\'import SQL:', error);
                alert('Erreur lors de l\'import SQL :\n' + error.message + '\n\nVérifiez que le fichier SQL est valide.');
            }
        }
    }

    importJSONData(data) {
        if (confirm('Cela va remplacer toutes vos données actuelles par celles du fichier JSON. Continuer ?')) {
            try {
                this.validateImportData(data);
                
                // Vider les tables existantes
                this.db.run('DELETE FROM contacts');
                this.db.run('DELETE FROM custom_fields');
                
                // Réinitialiser les compteurs auto-increment
                this.db.run('DELETE FROM sqlite_sequence WHERE name IN ("contacts", "custom_fields")');
                
                // Importer les champs personnalisés
                if (data.customFields && Array.isArray(data.customFields)) {
                    data.customFields.forEach(field => {
                        try {
                            // field format: [id, name, type, date_creation]
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
                            // contact format: [id, nom, prenom, custom_data, date_creation, date_modification]
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
                alert(`Données JSON importées avec succès !\n${data.contacts?.length || 0} contact(s) et ${data.customFields?.length || 0} champ(s) personnalisé(s) importé(s).`);
                
            } catch (error) {
                console.error('Erreur lors de l\'import JSON:', error);
                alert('Erreur lors de l\'import JSON :\n' + error.message);
            }
        }
    }

    // Méthode utilitaire pour valider les données avant import
    validateImportData(data) {
        if (!data || typeof data !== 'object') {
            throw new Error('Format de données invalide');
        }
        
        if (data.contacts && !Array.isArray(data.contacts)) {
            throw new Error('Les données de contacts doivent être un tableau');
        }
        
        if (data.customFields && !Array.isArray(data.customFields)) {
            throw new Error('Les données de champs personnalisés doivent être un tableau');
        }
        
        return true;
    }

    // Méthode pour nettoyer les données corrompues
    cleanDatabase() {
        if (confirm('Cette opération va nettoyer les données corrompues. Continuer ?')) {
            try {
                // Nettoyer les contacts avec des données JSON invalides
                const contacts = this.db.exec('SELECT id, custom_data FROM contacts');
                if (contacts.length > 0) {
                    contacts[0].values.forEach(contact => {
                        const [id, customDataStr] = contact;
                        if (customDataStr) {
                            try {
                                JSON.parse(customDataStr);
                            } catch {
                                // JSON invalide, remplacer par objet vide
                                this.db.run('UPDATE contacts SET custom_data = ? WHERE id = ?', 
                                    ['{}', id]);
                            }
                        }
                    });
                }
                
                this.saveDatabase();
                this.loadContacts();
                alert('Nettoyage terminé !');
            } catch (error) {
                alert('Erreur lors du nettoyage : ' + error.message);
            }
        }
    }

    // Méthode pour obtenir des statistiques détaillées
    getDetailedStats() {
        try {
            const contactCount = this.db.exec('SELECT COUNT(*) FROM contacts')[0].values[0][0];
            const fieldCount = this.db.exec('SELECT COUNT(*) FROM custom_fields')[0].values[0][0];
            
            // Statistiques sur l'utilisation des champs
            const fieldUsage = {};
            const contacts = this.db.exec('SELECT custom_data FROM contacts WHERE custom_data IS NOT NULL');
            
            if (contacts.length > 0) {
                contacts[0].values.forEach(contact => {
                    const customData = JSON.parse(contact[0] || '{}');
                    Object.keys(customData).forEach(fieldName => {
                        if (customData[fieldName] && customData[fieldName].trim() !== '') {
                            fieldUsage[fieldName] = (fieldUsage[fieldName] || 0) + 1;
                        }
                    });
                });
            }
            
            return {
                contacts: contactCount,
                fields: fieldCount,
                fieldUsage: fieldUsage
            };
        } catch (error) {
            console.error('Erreur lors du calcul des statistiques:', error);
            return { contacts: 0, fields: 0, fieldUsage: {} };
        }
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