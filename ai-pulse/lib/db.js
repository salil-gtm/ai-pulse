// IndexedDB wrapper for AI Pulse
const DB_NAME = 'ai_pulse_db';
const DB_VERSION = 1;

const AIPulseDB = {
  _db: null,

  async open() {
    if (this._db) return this._db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Feed items store
        if (!db.objectStoreNames.contains('feed')) {
          const feedStore = db.createObjectStore('feed', { keyPath: 'id' });
          feedStore.createIndex('source', 'source', { unique: false });
          feedStore.createIndex('fetchedAt', 'fetchedAt', { unique: false });
          feedStore.createIndex('read', 'read', { unique: false });
          feedStore.createIndex('saved', 'saved', { unique: false });
        }

        // Fetch log — tracks last fetch time per source
        if (!db.objectStoreNames.contains('fetchLog')) {
          db.createObjectStore('fetchLog', { keyPath: 'source' });
        }

        // Settings store
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        this._db = event.target.result;
        resolve(this._db);
      };

      request.onerror = (event) => {
        console.error('AI Pulse: IndexedDB error', event.target.error);
        reject(event.target.error);
      };
    });
  },

  // ---------- Feed Items ----------

  async addItems(items) {
    const db = await this.open();
    const tx = db.transaction('feed', 'readwrite');
    const store = tx.objectStore('feed');

    for (const item of items) {
      try {
        store.put(item); // put = insert or update
      } catch (e) {
        console.error('AI Pulse: Error adding item', item.id, e);
      }
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  },

  async getAllItems() {
    const db = await this.open();
    const tx = db.transaction('feed', 'readonly');
    const store = tx.objectStore('feed');
    const request = store.getAll();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  },

  async getItemsBySource(source) {
    const db = await this.open();
    const tx = db.transaction('feed', 'readonly');
    const store = tx.objectStore('feed');
    const index = store.index('source');
    const request = index.getAll(source);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  },

  async markAsRead(itemId) {
    return this.setReadState(itemId, true);
  },

  async setReadState(itemId, readState) {
    const db = await this.open();
    const tx = db.transaction('feed', 'readwrite');
    const store = tx.objectStore('feed');
    const request = store.get(itemId);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const item = request.result;
        if (item) {
          item.read = readState;
          store.put(item);
        }
        tx.oncomplete = () => resolve(readState);
      };
      request.onerror = () => reject(request.error);
    });
  },

  async toggleSaved(itemId) {
    const db = await this.open();
    const tx = db.transaction('feed', 'readwrite');
    const store = tx.objectStore('feed');
    const request = store.get(itemId);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const item = request.result;
        if (item) {
          item.saved = !item.saved;
          store.put(item);
        }
        tx.oncomplete = () => resolve(item?.saved);
      };
      request.onerror = () => reject(request.error);
    });
  },

  // ---------- Purge old items ----------

  async purgeOlderThan(days) {
    const db = await this.open();
    const tx = db.transaction('feed', 'readwrite');
    const store = tx.objectStore('feed');
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const request = store.openCursor();
    return new Promise((resolve, reject) => {
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          if (cursor.value.fetchedAt < cutoff && !cursor.value.saved) {
            cursor.delete();
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  },

  // ---------- Clear All Data ----------

  async clearAll() {
    const db = await this.open();
    const tx = db.transaction(['feed', 'fetchLog'], 'readwrite');
    tx.objectStore('feed').clear();
    tx.objectStore('fetchLog').clear();

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        console.log('AI Pulse: All data cleared');
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  },

  // ---------- Fetch Log ----------

  async getLastFetch(source) {
    const db = await this.open();
    const tx = db.transaction('fetchLog', 'readonly');
    const store = tx.objectStore('fetchLog');
    const request = store.get(source);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result?.timestamp || null);
      request.onerror = () => reject(request.error);
    });
  },

  async setLastFetch(source) {
    const db = await this.open();
    const tx = db.transaction('fetchLog', 'readwrite');
    const store = tx.objectStore('fetchLog');
    store.put({ source, timestamp: new Date().toISOString() });

    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  },

  // ---------- Settings ----------

  async getSetting(key, defaultValue = null) {
    const db = await this.open();
    const tx = db.transaction('settings', 'readonly');
    const store = tx.objectStore('settings');
    const request = store.get(key);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result?.value ?? defaultValue);
      request.onerror = () => reject(request.error);
    });
  },

  async setSetting(key, value) {
    const db = await this.open();
    const tx = db.transaction('settings', 'readwrite');
    const store = tx.objectStore('settings');
    store.put({ key, value });

    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
};
