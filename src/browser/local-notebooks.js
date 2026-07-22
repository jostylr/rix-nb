const DATABASE = "rix-notebook-web";
const STORE = "recent-single-files";

function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function withStore(mode, callback) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode); const result = callback(transaction.objectStore(STORE));
    transaction.oncomplete = () => { db.close(); resolve(result); }; transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}
export async function saveLocalNotebook(notebook) { return withStore("readwrite", (store) => store.put({ ...notebook, updatedAt: Date.now() })); }
export async function loadLocalNotebook(id) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
    request.onsuccess = () => { db.close(); resolve(request.result || null); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}
export async function removeLocalNotebook(id) { return withStore("readwrite", (store) => store.delete(id)); }
export async function listLocalNotebooks() {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    request.onsuccess = () => { db.close(); resolve(request.result.sort((left, right) => right.updatedAt - left.updatedAt)); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}
