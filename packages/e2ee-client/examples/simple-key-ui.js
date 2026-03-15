// Simple Key Export/Import Example
// Works in any framework: React, Vue, Svelte, vanilla JS, etc.

// Import the library (adjust path as needed)
import { VoidedE2EEClient, createKeyExport, createKeyImport } from '../dist/index.mjs';

// Initialize the E2EE client
const client = new VoidedE2EEClient({ keyId: 'user123' });

// Create UI components
const keyExport = createKeyExport(client, {
    title: 'Backup Your Encryption Key',
    showQR: true,
    showText: true,
    onCopy: () => {
        console.log('Key copied to clipboard!');
        // You can show a toast notification here
    },
    onClose: () => {
        console.log('Key export closed');
    }
});

const keyImport = createKeyImport(client, {
    title: 'Import Encryption Key',
    onSuccess: () => {
        console.log('Key imported successfully!');
        // You can show a success message here
    },
    onError: (error) => {
        console.error('Import failed:', error);
        // You can show an error message here
    },
    onClose: () => {
        console.log('Key import closed');
    }
});

// Example: Add buttons to your page
function addKeyButtons() {
    // Create export button
    const exportBtn = document.createElement('button');
    exportBtn.textContent = '📤 Export Key';
    exportBtn.style.cssText = `
        padding: 12px 24px;
        margin: 8px;
        background: #007bff;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 16px;
    `;
    exportBtn.onclick = () => keyExport.show();

    // Create import button
    const importBtn = document.createElement('button');
    importBtn.textContent = '📥 Import Key';
    importBtn.style.cssText = `
        padding: 12px 24px;
        margin: 8px;
        background: #28a745;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 16px;
    `;
    importBtn.onclick = () => keyImport.show();

    // Create rotate button
    const rotateBtn = document.createElement('button');
    rotateBtn.textContent = '🔄 Rotate Key';
    rotateBtn.style.cssText = `
        padding: 12px 24px;
        margin: 8px;
        background: #ffc107;
        color: #212529;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 16px;
    `;
    rotateBtn.onclick = async () => {
        try {
            await client.rotateKey();
            console.log('Key rotated successfully!');
        } catch (error) {
            console.error('Key rotation failed:', error);
        }
    };

    // Add buttons to page
    const container = document.createElement('div');
    container.style.cssText = `
        text-align: center;
        padding: 20px;
        background: white;
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        margin: 20px;
    `;

    container.appendChild(exportBtn);
    container.appendChild(importBtn);
    container.appendChild(rotateBtn);

    document.body.appendChild(container);
}

// Example: React component (if using React)
function ReactKeyButtons() {
    const handleExport = () => keyExport.show();
    const handleImport = () => keyImport.show();
    const handleRotate = async () => {
        try {
            await client.rotateKey();
            console.log('Key rotated successfully!');
        } catch (error) {
            console.error('Key rotation failed:', error);
        }
    };

    return (
        <div style={{ textAlign: 'center', padding: '20px' }}>
            <button onClick={handleExport} style={{ margin: '8px', padding: '12px 24px' }}>
                📤 Export Key
            </button>
            <button onClick={handleImport} style={{ margin: '8px', padding: '12px 24px' }}>
                📥 Import Key
            </button>
            <button onClick={handleRotate} style={{ margin: '8px', padding: '12px 24px' }}>
                🔄 Rotate Key
            </button>
        </div>
    );
}

// Example: Vue component (if using Vue)
const VueKeyButtons = {
    methods: {
        handleExport() {
            keyExport.show();
        },
        handleImport() {
            keyImport.show();
        },
        async handleRotate() {
            try {
                await client.rotateKey();
                console.log('Key rotated successfully!');
            } catch (error) {
                console.error('Key rotation failed:', error);
            }
        }
    },
    template: `
        <div style="text-align: center; padding: 20px;">
            <button @click="handleExport" style="margin: 8px; padding: 12px 24px;">
                📤 Export Key
            </button>
            <button @click="handleImport" style="margin: 8px; padding: 12px 24px;">
                📥 Import Key
            </button>
            <button @click="handleRotate" style="margin: 8px; padding: 12px 24px;">
                🔄 Rotate Key
            </button>
        </div>
    `
};

// Example: Svelte component (if using Svelte)
/*
<script>
    import { onMount } from 'svelte';
    
    let client, keyExport, keyImport;
    
    onMount(() => {
        // Initialize components
        client = new VoidedE2EEClient({ keyId: 'user123' });
        keyExport = createKeyExport(client);
        keyImport = createKeyImport(client);
    });
    
    function handleExport() {
        keyExport.show();
    }
    
    function handleImport() {
        keyImport.show();
    }
    
    async function handleRotate() {
        try {
            await client.rotateKey();
            console.log('Key rotated successfully!');
        } catch (error) {
            console.error('Key rotation failed:', error);
        }
    }
</script>

<div style="text-align: center; padding: 20px;">
    <button on:click={handleExport} style="margin: 8px; padding: 12px 24px;">
        📤 Export Key
    </button>
    <button on:click={handleImport} style="margin: 8px; padding: 12px 24px;">
        📥 Import Key
    </button>
    <button on:click={handleRotate} style="margin: 8px; padding: 12px 24px;">
        🔄 Rotate Key
    </button>
</div>
*/

// Auto-initialize if running in browser
if (typeof window !== 'undefined') {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', addKeyButtons);
    } else {
        addKeyButtons();
    }
}

// Export for use in other modules
export { client, keyExport, keyImport }; 