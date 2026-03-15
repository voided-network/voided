import { webcrypto } from 'node:crypto';

// Polyfill Web Crypto API for Node.js
if (!global.crypto) {
    global.crypto = webcrypto as any;
}

// Mock IndexedDB for Node.js environment
class MockIndexedDB {
    private data: Map<string, any> = new Map();

    open(name: string, version?: number): MockIDBRequest {
        return new MockIDBRequest(this.data);
    }
}

class MockIDBRequest {
    private data: Map<string, any>;
    public result: any;
    public error: any = null;
    public readyState: number = 1; // DONE
    public onsuccess?: (event: any) => void;
    public onerror?: (event: any) => void;

    constructor(data: Map<string, any>, result?: any) {
        this.data = data;
        this.result = result || {
            objectStoreNames: ['keys', 'migrations'],
            createObjectStore: (name: string) => new MockObjectStore(this.data),
            transaction: (storeNames: string[]) => new MockTransaction(this.data, storeNames)
        };

        // Simulate async behavior
        setTimeout(() => {
            if (this.onsuccess) {
                this.onsuccess({ target: this });
            }
        }, 0);
    }
}

class MockObjectStore {
    private data: Map<string, any>;

    constructor(data: Map<string, any>) {
        this.data = data;
    }

    put(value: any, key?: string): MockIDBRequest {
        if (key) {
            this.data.set(key, value);
        }
        const request = new MockIDBRequest(this.data, undefined);
        return request;
    }

    get(key: string): MockIDBRequest {
        const result = this.data.get(key) || null;
        const request = new MockIDBRequest(this.data, result);
        return request;
    }

    delete(key: string): MockIDBRequest {
        this.data.delete(key);
        const request = new MockIDBRequest(this.data, undefined);
        return request;
    }
}

class MockTransaction {
    private data: Map<string, any>;
    private storeNames: string[];

    constructor(data: Map<string, any>, storeNames: string[]) {
        this.data = data;
        this.storeNames = storeNames;
    }

    objectStore(name: string): MockObjectStore {
        return new MockObjectStore(this.data);
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