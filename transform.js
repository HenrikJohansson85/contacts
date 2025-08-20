document.addEventListener('DOMContentLoaded', () => {
    const fileInput1 = document.getElementById('fileInput1');
    const fileInput2 = document.getElementById('fileInput2');
    const downloadBtn = document.getElementById('downloadBtn');

    let contactsFile1 = null;
    let contactsFile2 = null;

    function checkFilesLoaded() {
        if (contactsFile1 && contactsFile2) {
            downloadBtn.disabled = false;
            downloadBtn.style.cursor = 'pointer';
        } else {
            downloadBtn.disabled = true;
            downloadBtn.style.cursor = 'not-allowed';
        }
    }

    fileInput1.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const text = await file.text();
        contactsFile1 = JSON.parse(text);
        checkFilesLoaded();
    });

    fileInput2.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const text = await file.text();
        contactsFile2 = JSON.parse(text);
        checkFilesLoaded();
    });

    downloadBtn.addEventListener('click', () => {
        if (!contactsFile1 || !contactsFile2) return;

        const mergedContacts = {};

        function processContacts(json) {
            json.contacts.forEach(contact => {
                let key, name, IP, Port, PublicKey, messages;

                if (Array.isArray(contact) && contact.length > 5) {
                    // Cas JSON déjà fusionné
                    key = contact[0].replace(" ", "_");
                    name = contact[0];
                    IP = contact[1] || '';
                    Port = contact[2] || '';
                    PublicKey = contact[3] || '';
                    messages = contact[4] || "//les messages seront stockés là mais vide pour l'instant";

                } else if (Array.isArray(contact)) {
                    // Cas JSON brut
                    const nom = contact[1];
                    const prenom = contact[2];
                    key = `${nom}_${prenom}`;
                    name = `${prenom} ${nom}`;

                    let IPtmp = '';
                    let Porttmp = '';
                    let PKtmp = '';
                    if (contact[11]) {
                        try {
                            const custom = JSON.parse(contact[11]);
                            IPtmp = custom["IP publique"] || '';
                            Porttmp = custom.Port ? parseInt(custom.Port) : '';
                            PKtmp = custom["Public key enchat"] || '';
                        } catch {
                            console.warn(`Impossible de parser customFields pour ${prenom} ${nom}`);
                        }
                    }

                    IP = IPtmp;
                    Port = Porttmp;
                    PublicKey = PKtmp;
                    messages = "";
                }

                // Remplacement (si le deuxième JSON contient le même contact, il écrase le premier)
                mergedContacts[key] = [
                    name,
                    IP,
                    Port,
                    PublicKey,
                    messages
                ];
            });
        }

        processContacts(contactsFile1);
        processContacts(contactsFile2);

        const output = { contacts: Object.values(mergedContacts) };
        const blob = new Blob([JSON.stringify(output, null, 4)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = 'merged_contacts.json';
        a.click();
        URL.revokeObjectURL(url);
    });
});