import { VoidedE2EEClient } from "./index";

// Import QR code functionality (will be bundled)
let QRCode: any = null;
try {
  QRCode = require("qrcode");
} catch {
  // QR code not available, will use fallback
}

export interface KeyExportOptions {
  showQR?: boolean;
  showText?: boolean;
  showShare?: boolean; // Enable Web Share API
  title?: string;
  className?: string;
  overlayClassName?: string;
  modalClassName?: string;
  qrContainerClassName?: string;
  textAreaClassName?: string;
  buttonClassName?: string;
  copyButtonClassName?: string;
  downloadButtonClassName?: string;
  shareButtonClassName?: string;
  closeButtonClassName?: string;
  warningClassName?: string;
  keyIdClassName?: string;
  onClose?: () => void;
  onCopy?: () => void;
  onShare?: () => void;
  onDownload?: () => void;
}

export interface KeyImportOptions {
  title?: string;
  className?: string;
  overlayClassName?: string;
  modalClassName?: string;
  textAreaClassName?: string;
  buttonClassName?: string;
  importButtonClassName?: string;
  scanButtonClassName?: string;
  cancelButtonClassName?: string;
  closeButtonClassName?: string;
  warningClassName?: string;
  showQRScan?: boolean; // Enable QR code scanning
  onClose?: () => void;
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

/**
 * Vanilla JS Key Export UI Component
 * Displays encryption key as QR code and/or text for backup
 * Highly customizable via CSS classes
 */
export class VoidedKeyExport {
  private client: VoidedE2EEClient;
  private options: KeyExportOptions;
  private modal: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;

  constructor(client: VoidedE2EEClient, options: KeyExportOptions = {}) {
    this.client = client;
    this.options = {
      showQR: true,
      showText: true,
      showShare: true, // Enable Web Share API by default
      title: "Backup Your Encryption Key",
      className: "voideddev-key-export",
      overlayClassName: "voideddev-overlay",
      modalClassName: "voideddev-modal",
      qrContainerClassName: "voideddev-qr-container",
      textAreaClassName: "voideddev-key-textarea",
      buttonClassName: "voideddev-button",
      copyButtonClassName: "voideddev-copy-button",
      downloadButtonClassName: "voideddev-download-button",
      shareButtonClassName: "voideddev-share-button",
      closeButtonClassName: "voideddev-close-button",
      warningClassName: "voideddev-warning",
      keyIdClassName: "voideddev-key-id",
      ...options,
    };
  }

  /**
   * Show the key export modal
   */
  async show(): Promise<void> {
    try {
      const key = await this.client.exportKey();
      const keyId = await this.client.getCurrentKeyVersion();

      await this.createModal(key, keyId);
      this.showModal();
    } catch (error) {
      console.error("Failed to export key:", error);
      alert("Failed to export key. Please try again.");
    }
  }

  /**
   * Hide the key export modal
   */
  hide(): void {
    this.hideModal();
  }

  private async createModal(key: string, keyId: number): Promise<void> {
    // Create overlay
    this.overlay = document.createElement("div");
    this.overlay.className =
      this.options.overlayClassName || "voideddev-overlay";
    this.overlay.setAttribute("data-voideddev-component", "key-export-overlay");

    // Create modal
    this.modal = document.createElement("div");
    this.modal.className = this.options.modalClassName || "voideddev-modal";
    this.modal.setAttribute("data-voideddev-component", "key-export-modal");

    // Modal content with semantic structure and data attributes
    this.modal.innerHTML = `
            <div class="voideddev-modal-header" data-voideddev-component="modal-header">
                <h3 class="voideddev-modal-title" data-voideddev-component="modal-title">${
                  this.options.title
                }</h3>
                <button class="${
                  this.options.closeButtonClassName || "voideddev-close-button"
                }" 
                        data-voideddev-component="close-button"
                        data-voideddev-action="close"
                        aria-label="Close modal">×</button>
            </div>
            
            <div class="${
              this.options.keyIdClassName || "voideddev-key-id"
            }" data-voideddev-component="key-id">
                <strong>Key ID:</strong> <span data-voideddev-key-id="${keyId}">${keyId}</span>
            </div>
            
            ${
              this.options.showQR
                ? `
                <div class="${
                  this.options.qrContainerClassName || "voideddev-qr-container"
                }" 
                     data-voideddev-component="qr-container"
                     id="qr-code"></div>
            `
                : ""
            }
            
            ${
              this.options.showText
                ? `
                <div class="voideddev-key-section" data-voideddev-component="key-section">
                    <label class="voideddev-key-label" data-voideddev-component="key-label">Encryption Key:</label>
                    <textarea class="${
                      this.options.textAreaClassName || "voideddev-key-textarea"
                    }" 
                              data-voideddev-component="key-textarea"
                              readonly 
                              data-voideddev-action="select-all"
                              aria-label="Encryption key">${key}</textarea>
                </div>
                
                <div class="voideddev-button-group" data-voideddev-component="button-group">
                    <button class="${
                      this.options.buttonClassName || "voideddev-button"
                    } ${
                    this.options.copyButtonClassName || "voideddev-copy-button"
                  }" 
                            data-voideddev-component="copy-button"
                            data-voideddev-action="copy">
                        Copy Key
                    </button>
                    <button class="${
                      this.options.buttonClassName || "voideddev-button"
                    } ${
                    this.options.downloadButtonClassName ||
                    "voideddev-download-button"
                  }" 
                            data-voideddev-component="download-button"
                            data-voideddev-action="download">
                        Download Key
                    </button>
                    ${
                      this.options.showShare
                        ? `
                        <button class="${
                          this.options.buttonClassName || "voideddev-button"
                        } ${
                            this.options.shareButtonClassName ||
                            "voideddev-share-button"
                          }" 
                                data-voideddev-component="share-button"
                                data-voideddev-action="share">
                            📤 Share Key
                        </button>
                    `
                        : ""
                    }
                </div>
            `
                : ""
            }
            
            <div class="${
              this.options.warningClassName || "voideddev-warning"
            }" data-voideddev-component="warning">
                <strong>Important:</strong> Keep this key safe. Anyone with this key can decrypt your data.
            </div>
        `;

    // Add event listeners
    this.modal.addEventListener("close", () => this.hide());
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) this.hide();
    });

    // Add action event listeners
    this.modal.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const action = target.getAttribute("data-voideddev-action");

      if (!action) return;

      switch (action) {
        case "close":
          this.hide();
          break;
        case "copy":
          this.copyKey(key);
          break;
        case "download":
          this.downloadKey(key, keyId);
          break;
        case "share":
          this.shareKey(key, keyId);
          break;
        case "select-all":
          (target as HTMLTextAreaElement).select();
          break;
      }
    });

    // Generate QR code if enabled
    if (this.options.showQR) {
      await this.generateQR(key);
    }

    this.overlay.appendChild(this.modal);
  }

  private showModal(): void {
    document.body.appendChild(this.overlay!);
    document.body.style.overflow = "hidden";
  }

  private hideModal(): void {
    if (this.overlay) {
      document.body.removeChild(this.overlay);
      document.body.style.overflow = "";
      this.overlay = null;
      this.modal = null;
    }
    if (this.options.onClose) {
      this.options.onClose();
    }
  }

  private async copyKey(key: string): Promise<void> {
    try {
      // log removed
      await navigator.clipboard.writeText(key);

      // log removed
      if (this.options.onCopy) {
        this.options.onCopy();
      } else {
        alert("📋 Key copied to clipboard!");
      }
    } catch (error) {
      console.error("Failed to copy key:", error);
      alert("❌ Failed to copy key to clipboard");
    }
  }

  private downloadKey(key: string, keyId: number): void {
    const blob = new Blob([key], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `voideddev-key-${keyId}-${
      new Date().toISOString().split("T")[0]
    }.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    if (this.options.onDownload) {
      this.options.onDownload();
    }
  }

  private async generateQR(key: string): Promise<void> {
    const qrContainer = this.modal?.querySelector(
      '[data-voideddev-component="qr-container"]'
    );
    if (!qrContainer) return;

    const qrText = `voideddev-KEY:${key}`;
    const qrSize = 200;

    try {
      if (QRCode) {
        // Generate real QR code
        const qrDataUrl = await QRCode.toDataURL(qrText, {
          width: qrSize,
          margin: 2,
          color: {
            dark: "#000000",
            light: "#FFFFFF",
          },
        });

        qrContainer.innerHTML = `
                    <div class="voideddev-qr-wrapper" data-voideddev-component="qr-wrapper">
                        <img src="${qrDataUrl}" alt="QR Code" class="voideddev-qr-image" data-voideddev-component="qr-image">
                        <div class="voideddev-qr-caption" data-voideddev-component="qr-caption">
                            Scan with any QR code app
                        </div>
                    </div>
                `;
      } else {
        // Fallback to text representation
        qrContainer.innerHTML = `
                    <div class="voideddev-qr-fallback" data-voideddev-component="qr-fallback">
                        <div class="voideddev-qr-fallback-icon" data-voideddev-component="qr-fallback-icon">📱</div>
                        <div class="voideddev-qr-fallback-text" data-voideddev-component="qr-fallback-text">QR Code Unavailable</div>
                        <div class="voideddev-qr-fallback-subtext" data-voideddev-component="qr-fallback-subtext">Use text copy instead</div>
                    </div>
                `;
      }
    } catch (error) {
      console.warn("Failed to generate QR code:", error);
      // Fallback to text representation
      qrContainer.innerHTML = `
                <div class="voideddev-qr-fallback" data-voideddev-component="qr-fallback">
                    <div class="voideddev-qr-fallback-icon" data-voideddev-component="qr-fallback-icon">📱</div>
                    <div class="voideddev-qr-fallback-text" data-voideddev-component="qr-fallback-text">QR Code Error</div>
                    <div class="voideddev-qr-fallback-subtext" data-voideddev-component="qr-fallback-subtext">Use text copy instead</div>
                </div>
            `;
    }
  }

  private async shareKey(key: string, keyId: number): Promise<void> {
    try {
      if (navigator.share) {
        // log removed
        await navigator.share({
          title: "voideddev Encryption Key",
          text: `My encryption key (ID: ${keyId}): ${key}`,
          url: `data:text/plain;base64,${btoa(key)}`,
        });

        // log removed
        if (this.options.onShare) {
          this.options.onShare();
        } else {
          alert("✅ Key shared successfully!");
        }
      } else {
        // log removed
        // Fallback: copy to clipboard
        await this.copyKey(key);
      }
    } catch (error) {
      console.error("Failed to share key:", error);
      if (
        error &&
        typeof error === "object" &&
        "name" in error &&
        error.name === "AbortError"
      ) {
        // User cancelled the share
        // log removed
        alert("❌ Sharing was cancelled");
      } else {
        // Other error, fallback to clipboard
        // log removed
        await this.copyKey(key);
      }
    }
  }
}

/**
 * Vanilla JS Key Import UI Component
 * Allows users to import encryption keys
 * Highly customizable via CSS classes
 */
export class VoidedKeyImport {
  private client: VoidedE2EEClient;
  private options: KeyImportOptions;
  private modal: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;

  constructor(client: VoidedE2EEClient, options: KeyImportOptions = {}) {
    this.client = client;
    this.options = {
      title: "Import Encryption Key",
      className: "voideddev-key-import",
      overlayClassName: "voideddev-overlay",
      modalClassName: "voideddev-modal",
      textAreaClassName: "voideddev-key-textarea",
      buttonClassName: "voideddev-button",
      importButtonClassName: "voideddev-import-button",
      scanButtonClassName: "voideddev-scan-button",
      cancelButtonClassName: "voideddev-cancel-button",
      closeButtonClassName: "voideddev-close-button",
      warningClassName: "voideddev-warning",
      showQRScan: true, // Enable QR scanning by default
      ...options,
    };
  }

  /**
   * Show the key import modal
   */
  show(): void {
    this.createModal();
    this.showModal();
  }

  /**
   * Hide the key import modal
   */
  hide(): void {
    this.hideModal();
  }

  private createModal(): void {
    // Create overlay
    this.overlay = document.createElement("div");
    this.overlay.className =
      this.options.overlayClassName || "voideddev-overlay";
    this.overlay.setAttribute("data-voideddev-component", "key-import-overlay");

    // Create modal
    this.modal = document.createElement("div");
    this.modal.className = this.options.modalClassName || "voideddev-modal";
    this.modal.setAttribute("data-voideddev-component", "key-import-modal");

    // Modal content with semantic structure and data attributes
    this.modal.innerHTML = `
            <div class="voideddev-modal-header" data-voideddev-component="modal-header">
                <h3 class="voideddev-modal-title" data-voideddev-component="modal-title">${
                  this.options.title
                }</h3>
                <button class="${
                  this.options.closeButtonClassName || "voideddev-close-button"
                }" 
                        data-voideddev-component="close-button"
                        data-voideddev-action="close"
                        aria-label="Close modal">×</button>
            </div>
            
            <div class="voideddev-key-section" data-voideddev-component="key-section">
                <label class="voideddev-key-label" data-voideddev-component="key-label">Paste your encryption key:</label>
                <textarea class="${
                  this.options.textAreaClassName || "voideddev-key-textarea"
                }" 
                          data-voideddev-component="key-textarea"
                          id="key-input" 
                          placeholder="Paste your key here..."
                          aria-label="Encryption key input"></textarea>
            </div>
            
            <div class="voideddev-button-group" data-voideddev-component="button-group">
                <button class="${
                  this.options.buttonClassName || "voideddev-button"
                } ${
      this.options.importButtonClassName || "voideddev-import-button"
    }" 
                        data-voideddev-component="import-button"
                        data-voideddev-action="import">
                    Import Key
                </button>
                ${
                  this.options.showQRScan
                    ? `
                    <button class="${
                      this.options.buttonClassName || "voideddev-button"
                    } ${
                        this.options.scanButtonClassName ||
                        "voideddev-scan-button"
                      }" 
                            data-voideddev-component="scan-button"
                            data-voideddev-action="scan">
                        📷 Scan QR Code
                    </button>
                `
                    : ""
                }
                <button class="${
                  this.options.buttonClassName || "voideddev-button"
                } ${
      this.options.cancelButtonClassName || "voideddev-cancel-button"
    }" 
                        data-voideddev-component="cancel-button"
                        data-voideddev-action="close">
                    Cancel
                </button>
            </div>
            
            <div class="${
              this.options.warningClassName || "voideddev-warning"
            }" data-voideddev-component="warning">
                <strong>Note:</strong> Importing a key will replace your current key. Make sure you have a backup of your current key.
            </div>
        `;

    // Add event listeners
    this.modal.addEventListener("close", () => this.hide());
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) this.hide();
    });

    // Add action event listeners
    this.modal.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const action = target.getAttribute("data-voideddev-action");

      if (!action) return;

      switch (action) {
        case "close":
          this.hide();
          break;
        case "import":
          this.importKey();
          break;
        case "scan":
          this.scanQRCode();
          break;
      }
    });

    this.overlay.appendChild(this.modal);
  }

  private showModal(): void {
    document.body.appendChild(this.overlay!);
    document.body.style.overflow = "hidden";
  }

  private hideModal(): void {
    if (this.overlay) {
      document.body.removeChild(this.overlay);
      document.body.style.overflow = "";
      this.overlay = null;
      this.modal = null;
    }
    if (this.options.onClose) {
      this.options.onClose();
    }
  }

  private async importKey(): Promise<void> {
    const keyInput = this.modal?.querySelector(
      '[data-voideddev-component="key-textarea"]'
    ) as HTMLTextAreaElement;
    const importBtn = this.modal?.querySelector(
      '[data-voideddev-component="import-button"]'
    ) as HTMLButtonElement;

    if (!keyInput || !importBtn) return;

    const key = keyInput.value.trim();

    if (!key) {
      alert("Please paste a valid key.");
      return;
    }

    try {
      // Disable button during import
      importBtn.disabled = true;
      importBtn.textContent = "Importing...";

      await this.client.importKey(key);

      if (this.options.onSuccess) {
        this.options.onSuccess();
      } else {
        alert("Key imported successfully!");
      }

      this.hide();
    } catch (error) {
      console.error("Failed to import key:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Failed to import key";

      if (this.options.onError) {
        this.options.onError(errorMessage);
      } else {
        alert(`Failed to import key: ${errorMessage}`);
      }
    } finally {
      // Re-enable button
      importBtn.disabled = false;
      importBtn.textContent = "Import Key";
    }
  }

  private async scanQRCode(): Promise<void> {
    // TODO: Implement QR code scanning
    // This would typically use a library like jsQR or similar
    alert(
      "QR code scanning not yet implemented. Please paste the key manually."
    );
  }
}

// Convenience functions
export function createKeyExport(
  client: VoidedE2EEClient,
  options?: KeyExportOptions
): VoidedKeyExport {
  return new VoidedKeyExport(client, options);
}

export function createKeyImport(
  client: VoidedE2EEClient,
  options?: KeyImportOptions
): VoidedKeyImport {
  return new VoidedKeyImport(client, options);
}
