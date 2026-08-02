import { VoidedE2EEClient } from "./index";

// Import QR code functionality (will be bundled)
let QRCode: any = null;
try {
  QRCode = require("qrcode");
} catch {
  // QR code not available, will use fallback
}

export function escapeKeyUiHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function createUiElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
  component: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.className = className;
  element.setAttribute("data-voideddev-component", component);
  if (text !== undefined) element.textContent = text;
  return element;
}

function createActionButton(
  className: string,
  component: string,
  action: string,
  text: string,
  ariaLabel?: string
): HTMLButtonElement {
  const button = createUiElement("button", className, component, text);
  button.type = "button";
  button.setAttribute("data-voideddev-action", action);
  if (ariaLabel) button.setAttribute("aria-label", ariaLabel);
  return button;
}

function appendLabeledText(
  container: HTMLElement,
  label: string,
  value: string
): void {
  const strong = document.createElement("strong");
  strong.textContent = label;
  container.append(strong, document.createTextNode(` ${value}`));
}

function renderQrFallback(container: Element, headline: string): void {
  const fallback = createUiElement(
    "div",
    "voideddev-qr-fallback",
    "qr-fallback"
  );
  fallback.append(
    createUiElement(
      "div",
      "voideddev-qr-fallback-icon",
      "qr-fallback-icon",
      "📱"
    ),
    createUiElement(
      "div",
      "voideddev-qr-fallback-text",
      "qr-fallback-text",
      headline
    ),
    createUiElement(
      "div",
      "voideddev-qr-fallback-subtext",
      "qr-fallback-subtext",
      "Use text copy instead"
    )
  );
  container.replaceChildren(fallback);
}

const KEY_QR_PREFIX = "voideddev-KEY:";

export function parseKeyQrPayload(payload: string): string {
  if (!payload.startsWith(KEY_QR_PREFIX)) {
    throw new Error("QR code is not a Voided encryption key");
  }
  const key = payload.slice(KEY_QR_PREFIX.length).trim();
  if (!key) throw new Error("QR code contains an empty encryption key");
  return key;
}

interface DetectedBarcode {
  rawValue?: string;
}

interface QrBarcodeDetector {
  detect(source: ImageBitmap): Promise<DetectedBarcode[]>;
}

type QrBarcodeDetectorConstructor = new (options: {
  formats: string[];
}) => QrBarcodeDetector;

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
  /** Show the QR-scanning control. */
  showQRScan?: boolean;
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
      showShare: true,
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

    const header = createUiElement(
      "div",
      "voideddev-modal-header",
      "modal-header"
    );
    header.append(
      createUiElement(
        "h3",
        "voideddev-modal-title",
        "modal-title",
        this.options.title || "Backup Your Encryption Key"
      ),
      createActionButton(
        this.options.closeButtonClassName || "voideddev-close-button",
        "close-button",
        "close",
        "×",
        "Close modal"
      )
    );
    this.modal.append(header);

    const keyIdContainer = createUiElement(
      "div",
      this.options.keyIdClassName || "voideddev-key-id",
      "key-id"
    );
    const keyIdLabel = document.createElement("strong");
    keyIdLabel.textContent = "Key ID:";
    const keyIdValue = document.createElement("span");
    keyIdValue.setAttribute("data-voideddev-key-id", String(keyId));
    keyIdValue.textContent = String(keyId);
    keyIdContainer.append(
      keyIdLabel,
      document.createTextNode(" "),
      keyIdValue
    );
    this.modal.append(keyIdContainer);

    if (this.options.showQR) {
      const qrContainer = createUiElement(
        "div",
        this.options.qrContainerClassName || "voideddev-qr-container",
        "qr-container"
      );
      qrContainer.id = "qr-code";
      this.modal.append(qrContainer);
    }

    if (this.options.showText) {
      const keySection = createUiElement(
        "div",
        "voideddev-key-section",
        "key-section"
      );
      const keyLabel = createUiElement(
        "label",
        "voideddev-key-label",
        "key-label",
        "Encryption Key:"
      );
      const keyTextArea = createUiElement(
        "textarea",
        this.options.textAreaClassName || "voideddev-key-textarea",
        "key-textarea"
      );
      keyTextArea.readOnly = true;
      keyTextArea.value = key;
      keyTextArea.setAttribute("data-voideddev-action", "select-all");
      keyTextArea.setAttribute("aria-label", "Encryption key");
      keySection.append(keyLabel, keyTextArea);
      this.modal.append(keySection);

      const buttonGroup = createUiElement(
        "div",
        "voideddev-button-group",
        "button-group"
      );
      const baseButtonClass = this.options.buttonClassName || "voideddev-button";
      buttonGroup.append(
        createActionButton(
          `${baseButtonClass} ${
            this.options.copyButtonClassName || "voideddev-copy-button"
          }`,
          "copy-button",
          "copy",
          "Copy Key"
        ),
        createActionButton(
          `${baseButtonClass} ${
            this.options.downloadButtonClassName || "voideddev-download-button"
          }`,
          "download-button",
          "download",
          "Download Key"
        )
      );
      if (this.options.showShare) {
        buttonGroup.append(
          createActionButton(
            `${baseButtonClass} ${
              this.options.shareButtonClassName || "voideddev-share-button"
            }`,
            "share-button",
            "share",
            "📤 Share Key"
          )
        );
      }
      this.modal.append(buttonGroup);
    }

    const warning = createUiElement(
      "div",
      this.options.warningClassName || "voideddev-warning",
      "warning"
    );
    appendLabeledText(
      warning,
      "Important:",
      "Keep this key safe. Anyone with this key can decrypt your data."
    );
    this.modal.append(warning);

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

    const qrText = `${KEY_QR_PREFIX}${key}`;
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

        const wrapper = document.createElement("div");
        wrapper.className = "voideddev-qr-wrapper";
        wrapper.setAttribute("data-voideddev-component", "qr-wrapper");
        const image = document.createElement("img");
        image.src = qrDataUrl;
        image.alt = "QR Code";
        image.className = "voideddev-qr-image";
        image.setAttribute("data-voideddev-component", "qr-image");
        const caption = document.createElement("div");
        caption.className = "voideddev-qr-caption";
        caption.setAttribute("data-voideddev-component", "qr-caption");
        caption.textContent = "Scan with any QR code app";
        wrapper.append(image, caption);
        qrContainer.replaceChildren(wrapper);
      } else {
        renderQrFallback(qrContainer, "QR Code Unavailable");
      }
    } catch (error) {
      console.warn("Failed to generate QR code:", error);
      renderQrFallback(qrContainer, "QR Code Error");
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
      showQRScan: true,
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

    const header = createUiElement(
      "div",
      "voideddev-modal-header",
      "modal-header"
    );
    header.append(
      createUiElement(
        "h3",
        "voideddev-modal-title",
        "modal-title",
        this.options.title || "Import Encryption Key"
      ),
      createActionButton(
        this.options.closeButtonClassName || "voideddev-close-button",
        "close-button",
        "close",
        "×",
        "Close modal"
      )
    );

    const keySection = createUiElement(
      "div",
      "voideddev-key-section",
      "key-section"
    );
    const keyLabel = createUiElement(
      "label",
      "voideddev-key-label",
      "key-label",
      "Paste your encryption key:"
    );
    const keyInput = createUiElement(
      "textarea",
      this.options.textAreaClassName || "voideddev-key-textarea",
      "key-textarea"
    );
    keyInput.id = "key-input";
    keyInput.placeholder = "Paste your key here...";
    keyInput.setAttribute("aria-label", "Encryption key input");
    keySection.append(keyLabel, keyInput);

    const buttonGroup = createUiElement(
      "div",
      "voideddev-button-group",
      "button-group"
    );
    const baseButtonClass = this.options.buttonClassName || "voideddev-button";
    buttonGroup.append(
      createActionButton(
        `${baseButtonClass} ${
          this.options.importButtonClassName || "voideddev-import-button"
        }`,
        "import-button",
        "import",
        "Import Key"
      )
    );
    if (this.options.showQRScan) {
      buttonGroup.append(
        createActionButton(
          `${baseButtonClass} ${
            this.options.scanButtonClassName || "voideddev-scan-button"
          }`,
          "scan-button",
          "scan",
          "📷 Scan QR Code"
        )
      );
    }
    buttonGroup.append(
      createActionButton(
        `${baseButtonClass} ${
          this.options.cancelButtonClassName || "voideddev-cancel-button"
        }`,
        "cancel-button",
        "close",
        "Cancel"
      )
    );

    const warning = createUiElement(
      "div",
      this.options.warningClassName || "voideddev-warning",
      "warning"
    );
    appendLabeledText(
      warning,
      "Note:",
      "Importing a key will replace your current key. Make sure you have a backup of your current key."
    );
    this.modal.append(header, keySection, buttonGroup, warning);

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
    const detectorConstructor = (
      globalThis as typeof globalThis & {
        BarcodeDetector?: QrBarcodeDetectorConstructor;
      }
    ).BarcodeDetector;
    if (!detectorConstructor || typeof createImageBitmap !== "function") {
      alert(
        "QR scanning is not supported by this browser. Please paste the key manually."
      );
      return;
    }

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.setAttribute("capture", "environment");
    fileInput.hidden = true;
    document.body.appendChild(fileInput);

    const cleanup = (): void => fileInput.remove();
    fileInput.addEventListener("cancel", cleanup, { once: true });
    fileInput.addEventListener(
      "change",
      async () => {
        let image: ImageBitmap | undefined;
        try {
          const file = fileInput.files?.[0];
          if (!file) return;
          image = await createImageBitmap(file);
          const detector = new detectorConstructor({ formats: ["qr_code"] });
          const matches = await detector.detect(image);
          const payload = matches.find(
            (match) => typeof match.rawValue === "string"
          )?.rawValue;
          if (!payload) throw new Error("No QR code was found in that image");

          const key = parseKeyQrPayload(payload);
          const keyInput = this.modal?.querySelector(
            '[data-voideddev-component="key-textarea"]'
          ) as HTMLTextAreaElement | null;
          if (!keyInput) throw new Error("The key import field is unavailable");
          keyInput.value = key;
          keyInput.dispatchEvent(new Event("input", { bubbles: true }));
          keyInput.focus();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Failed to scan QR code";
          if (this.options.onError) this.options.onError(message);
          else alert(message);
        } finally {
          image?.close();
          cleanup();
        }
      },
      { once: true }
    );
    fileInput.click();
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
