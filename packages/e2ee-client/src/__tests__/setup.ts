import { webcrypto } from 'node:crypto';

// Polyfill Web Crypto API for Node.js
if (!global.crypto) {
    global.crypto = webcrypto as any;
}

// Mock IndexedDB for Node.js environment
class MockIndexedDB {
    private data: Map<string, any> = new Map();

    open(_name: string, _version?: number): MockIDBRequest {
        return new MockIDBRequest(this.data, undefined, true);
    }
}

class MockIDBRequest {
    private data: Map<string, any>;
    public result: any;
    public error: any = null;
    public readyState: number = 1; // DONE
    public onsuccess?: (event: any) => void;
    public onerror?: (event: any) => void;
    public onupgradeneeded?: (event: any) => void;

    constructor(
        data: Map<string, any>,
        result?: any,
        isOpenRequest = false,
        onSettled?: () => void
    ) {
        this.data = data;
        this.result = isOpenRequest ? {
            objectStoreNames: {
                contains: (name: string) => ['keys', 'migrations', 'keyPairs'].includes(name)
            },
            createObjectStore: (_name: string) => new MockObjectStore(this.data),
            transaction: (storeNames: string[]) => new MockTransaction(this.data, storeNames),
            close: () => undefined
        } : result;

        // Simulate async behavior
        setTimeout(() => {
            if (this.onsuccess) {
                this.onsuccess({ target: this });
            }
            onSettled?.();
        }, 0);
    }
}

class MockObjectStore {
    private data: Map<string, any>;
    private complete: () => void;

    constructor(data: Map<string, any>, complete: () => void = () => undefined) {
        this.data = data;
        this.complete = complete;
    }

    put(value: any, key?: string): MockIDBRequest {
        this.data.set(key ?? value.id, value);
        const request = new MockIDBRequest(this.data, undefined, false, this.complete);
        return request;
    }

    get(key: string): MockIDBRequest {
        const result = this.data.get(key) || null;
        const request = new MockIDBRequest(this.data, result, false, this.complete);
        return request;
    }

    delete(key: string): MockIDBRequest {
        this.data.delete(key);
        const request = new MockIDBRequest(this.data, undefined, false, this.complete);
        return request;
    }
}

class MockTransaction {
    private data: Map<string, any>;
    public error: any = null;
    public db = { close: () => undefined };
    public oncomplete?: (event: any) => void;
    public onerror?: (event: any) => void;
    public onabort?: (event: any) => void;

    constructor(data: Map<string, any>, _storeNames: string[]) {
        this.data = data;
    }

    objectStore(_name: string): MockObjectStore {
        return new MockObjectStore(this.data, () => {
            setTimeout(() => this.oncomplete?.({ target: this }), 0);
        });
    }

    abort(): void {
        setTimeout(() => this.onabort?.({ target: this }), 0);
    }
}

// Mock global IndexedDB
if (typeof global !== 'undefined' && !global.indexedDB) {
    global.indexedDB = new MockIndexedDB() as any;
}

// Mock window object for browser APIs
if (typeof global !== 'undefined' && !global.window) {
    global.window = global as any;
}

// Mock btoa and atob for base64 encoding
if (typeof global !== 'undefined' && !global.btoa) {
    global.btoa = (str: string) => Buffer.from(str, 'binary').toString('base64');
}

if (typeof global !== 'undefined' && !global.atob) {
    global.atob = (str: string) => Buffer.from(str, 'base64').toString('binary');
}
