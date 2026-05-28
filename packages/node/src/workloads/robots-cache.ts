const ROBOTS_CACHE_DB = 'flaxia-robots-cache';
const ROBOTS_CACHE_EXPIRY = 24 * 60 * 60 * 1000;

interface RobotsCacheEntry {
  allowedPaths: string[];
  disallowedPaths: string[];
  crawlDelay: number;
  fetchedAt: number;
}

function openRobotsDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(ROBOTS_CACHE_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('cache')) {
        req.result.createObjectStore('cache', { keyPath: 'origin' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getRobotsCache(origin: string): Promise<RobotsCacheEntry | null> {
  const db = await openRobotsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('cache', 'readonly');
    const req = tx.objectStore('cache').get(origin);
    req.onsuccess = () => {
      const entry = req.result as RobotsCacheEntry | undefined;
      if (entry && Date.now() - entry.fetchedAt < ROBOTS_CACHE_EXPIRY) {
        resolve(entry);
      } else {
        resolve(null);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

async function setRobotsCache(origin: string, entry: RobotsCacheEntry): Promise<void> {
  const db = await openRobotsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('cache', 'readwrite');
    tx.objectStore('cache').put({ origin, ...entry });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function parseRobotsTxt(text: string): Omit<RobotsCacheEntry, 'fetchedAt'> {
  const lines = text.split('\n');
  const allowedPaths: string[] = [];
  const disallowedPaths: string[] = [];
  let crawlDelay = 0;
  let applicable = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('User-agent:')) {
      const ua = trimmed.split(':')[1]?.trim() || '';
      applicable = ua === '*' || ua.toLowerCase().includes('vectoria');
    } else if (applicable) {
      if (trimmed.startsWith('Disallow:')) {
        disallowedPaths.push(trimmed.split(':')[1]?.trim() || '');
      } else if (trimmed.startsWith('Allow:')) {
        allowedPaths.push(trimmed.split(':')[1]?.trim() || '');
      } else if (trimmed.startsWith('Crawl-Delay:')) {
        crawlDelay = parseInt(trimmed.split(':')[1]?.trim() || '0', 10);
      }
    }
  }

  return { allowedPaths, disallowedPaths, crawlDelay };
}

function isPathAllowed(path: string, entry: RobotsCacheEntry): boolean {
  for (const allowed of entry.allowedPaths) {
    if (path.startsWith(allowed)) return true;
  }
  for (const disallowed of entry.disallowedPaths) {
    if (disallowed === '' || disallowed === '/') return false;
    if (path.startsWith(disallowed)) return false;
  }
  return true;
}

export async function checkRobotsTxt(url: string): Promise<boolean> {
  const parsed = new URL(url);
  const origin = parsed.origin;
  const path = parsed.pathname + parsed.search;

  const cached = await getRobotsCache(origin);
  if (cached) {
    return isPathAllowed(path, cached);
  }

  try {
    const robotsUrl = `${origin}/robots.txt`;
    const res = await fetch(robotsUrl);
    if (res.status === 404) return true;

    const text = await res.text();
    const entry = parseRobotsTxt(text);
    await setRobotsCache(origin, { ...entry, fetchedAt: Date.now() });
    return isPathAllowed(path, { ...entry, fetchedAt: Date.now() });
  } catch {
    return true;
  }
}
