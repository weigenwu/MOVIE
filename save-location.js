export const sharedHosting = /(^|\.)githack\.com$/.test(globalThis.location?.hostname || '');
// Directory handles (not path strings) survive reloads in IndexedDB.
// Access is still subject to the browser's native permission controls.
export async function folderSetting(action, handle) {
  // Shared hosting uses one origin for unrelated repositories; keep directory access in this page only.
  if (sharedHosting) {
    if (action === 'set' && handle) throw new Error('此免费入口只在当前页面记住保存文件夹');
    return;
  }
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('framecut-preferences', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('settings');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('保存位置暂时无法读取'));
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('settings', action === 'get' ? 'readonly' : 'readwrite'), store = tx.objectStore('settings');
      const request = action === 'get' ? store.get('output-folder') : handle ? store.put(handle, 'output-folder') : store.delete('output-folder');
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('保存位置未能记住'));
    });
  } finally { db.close(); }
}

export async function writeToFolder(folder, name, blob) {
  const write = async () => {
    const clean = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    const dot = clean.lastIndexOf('.'), stem = clean.slice(0, dot).slice(0, 200), ext = clean.slice(dot);
    for (let n = 1; n <= 10000; n++) {
      const candidate = `${stem}${n === 1 ? '' : ` (${n})`}${ext}`;
      try { await folder.getFileHandle(candidate); continue; }
      catch (error) { if (error.name === 'TypeMismatchError') continue; if (error.name !== 'NotFoundError') throw error; }
      const file = await folder.getFileHandle(candidate, { create:true });
      const writable = await file.createWritable();
      try { await writable.write(blob); await writable.close(); }
      catch (error) { try { await writable.abort(); } catch {} throw error; }
      return candidate;
    }
    throw new Error('同名文件过多，请更换保存文件夹');
  };
  // Serialise this app's exports across tabs so two tabs cannot claim one name.
  return navigator.locks ? navigator.locks.request('framecut-output-file', write) : write();
}
