// Service Worker for 3D Scanner Pro
// Version: 2.0.0
// Cache Strategy: Cache First, Network Fallback with Background Sync

const APP_NAME = '3D Scanner Pro';
const APP_VERSION = '2.0.0';
const CACHE_NAME = `3d-scanner-cache-${APP_VERSION}`;

// Core app files to cache immediately
const CORE_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

// External dependencies to cache
const EXTERNAL_RESOURCES = [
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800&display=swap',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js'
];

// All files to cache
const FILES_TO_CACHE = [...CORE_FILES, ...EXTERNAL_RESOURCES];

// ===== INSTALL EVENT =====
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing version:', APP_VERSION);
  
  event.waitUntil(
    (async () => {
      try {
        // Open cache and add all core files
        const cache = await caches.open(CACHE_NAME);
        console.log('[Service Worker] Caching core files');
        
        // Cache core files first
        await cache.addAll(CORE_FILES);
        
        // Cache external resources with error handling
        for (const url of EXTERNAL_RESOURCES) {
          try {
            await cache.add(url);
            console.log('[Service Worker] Cached external:', url);
          } catch (err) {
            console.warn('[Service Worker] Failed to cache:', url, err);
          }
        }
        
        // Force immediate activation
        await self.skipWaiting();
        console.log('[Service Worker] Installation complete');
      } catch (error) {
        console.error('[Service Worker] Installation failed:', error);
      }
    })()
  );
});

// ===== ACTIVATE EVENT =====
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating version:', APP_VERSION);
  
  event.waitUntil(
    (async () => {
      try {
        // Clean up old caches
        const cacheKeys = await caches.keys();
        await Promise.all(
          cacheKeys.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log('[Service Worker] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
        
        // Take control of all clients immediately
        await self.clients.claim();
        
        // Send message to all clients about new version
        const clients = await self.clients.matchAll();
        clients.forEach((client) => {
          client.postMessage({
            type: 'SW_UPDATED',
            version: APP_VERSION
          });
        });
        
        console.log('[Service Worker] Activation complete');
      } catch (error) {
        console.error('[Service Worker] Activation failed:', error);
      }
    })()
  );
});

// ===== FETCH EVENT =====
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests and browser extensions
  if (event.request.method !== 'GET' || 
      event.request.url.startsWith('chrome-extension://') ||
      event.request.url.includes('browser-sync')) {
    return;
  }
  
  // Handle different types of requests
  const requestUrl = new URL(event.request.url);
  
  // API requests - Network First
  if (requestUrl.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstStrategy(event.request));
    return;
  }
  
  // Media files (images, videos) - Cache First, Stale while revalidate
  if (requestUrl.pathname.match(/\.(jpg|jpeg|png|gif|webp|mp4|webm|svg)$/i)) {
    event.respondWith(staleWhileRevalidateStrategy(event.request));
    return;
  }
  
  // External resources - Cache First
  if (EXTERNAL_RESOURCES.some(url => event.request.url.startsWith(url))) {
    event.respondWith(cacheFirstStrategy(event.request));
    return;
  }
  
  // HTML/CSS/JS - Cache First with Network Fallback
  if (requestUrl.pathname.match(/\.(html|css|js|json)$/i) || 
      requestUrl.pathname === '/') {
    event.respondWith(cacheFirstStrategy(event.request));
    return;
  }
  
  // Default: Network First
  event.respondWith(networkFirstStrategy(event.request));
});

// ===== CACHE STRATEGIES =====

async function cacheFirstStrategy(request) {
  try {
    // Try cache first
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      // Update cache in background
      updateCacheInBackground(request);
      return cachedResponse;
    }
    
    // If not in cache, fetch from network
    const networkResponse = await fetch(request);
    
    // Cache the new response for future use
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    // Network failed, return offline page or fallback
    console.warn('[Service Worker] Cache First failed:', error);
    
    // For HTML requests, return offline page
    if (request.headers.get('accept').includes('text/html')) {
      return getOfflinePage();
    }
    
    // For other requests, return a fallback
    return new Response('Network error', {
      status: 408,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

async function networkFirstStrategy(request) {
  try {
    // Try network first
    const networkResponse = await fetch(request);
    
    // Cache successful responses
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    // Network failed, try cache
    console.warn('[Service Worker] Network First failed, trying cache:', error);
    
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // No cache, return error
    return new Response('Network error and no cache available', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

async function staleWhileRevalidateStrategy(request) {
  try {
    // Try cache first for immediate response
    const cachedResponse = await caches.match(request);
    
    // Fetch from network in background to update cache
    const fetchPromise = fetch(request).then(async (networkResponse) => {
      if (networkResponse.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, networkResponse.clone());
      }
    }).catch(err => {
      console.warn('[Service Worker] Background fetch failed:', err);
    });
    
    // Return cached response if available, otherwise wait for network
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Wait for network if no cache
    await fetchPromise;
    const networkResponse = await fetch(request);
    return networkResponse;
  } catch (error) {
    console.warn('[Service Worker] Stale While Revalidate failed:', error);
    return new Response('Offline', {
      status: 408,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

async function updateCacheInBackground(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response);
    }
  } catch (error) {
    // Silent fail for background updates
    console.debug('[Service Worker] Background update failed:', error);
  }
}

async function getOfflinePage() {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match('/');
  
  if (cached) {
    return cached;
  }
  
  // Create a simple offline page
  return new Response(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>3D Scanner Pro - Offline</title>
      <style>
        body {
          font-family: sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          text-align: center;
          padding: 20px;
        }
        .container {
          max-width: 400px;
        }
        h1 { margin-bottom: 20px; }
        p { margin-bottom: 30px; opacity: 0.9; }
        .icon {
          font-size: 80px;
          margin-bottom: 30px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">📶</div>
        <h1>You're Offline</h1>
        <p>3D Scanner Pro needs an internet connection for some features.</p>
        <p>You can still view previously scanned models.</p>
      </div>
    </body>
    </html>
  `, {
    headers: { 'Content-Type': 'text/html' }
  });
}

// ===== BACKGROUND SYNC =====
self.addEventListener('sync', (event) => {
  console.log('[Service Worker] Background sync:', event.tag);
  
  if (event.tag === 'sync-scans') {
    event.waitUntil(syncPendingScans());
  }
  
  if (event.tag === 'sync-settings') {
    event.waitUntil(syncSettings());
  }
});

async function syncPendingScans() {
  try {
    // Get pending scans from IndexedDB
    const db = await openIndexedDB();
    const pendingScans = await getAllFromStore(db, 'pendingScans');
    
    if (pendingScans.length === 0) {
      console.log('[Service Worker] No pending scans to sync');
      return;
    }
    
    console.log(`[Service Worker] Syncing ${pendingScans.length} pending scans`);
    
    // Sync each scan
    const syncResults = await Promise.allSettled(
      pendingScans.map(scan => syncScanToServer(scan))
    );
    
    // Remove successfully synced scans
    const successfulSyncs = syncResults
      .map((result, index) => result.status === 'fulfilled' ? index : -1)
      .filter(index => index !== -1);
    
    if (successfulSyncs.length > 0) {
      await removeScansFromStore(db, 'pendingScans', successfulSyncs);
      console.log(`[Service Worker] Successfully synced ${successfulSyncs.length} scans`);
      
      // Show notification
      self.registration.showNotification('Sync Complete', {
        body: `Successfully synced ${successfulSyncs.length} scans`,
        icon: '/icons/icon-192x192.png',
        tag: 'sync-complete'
      });
    }
    
    if (successfulSyncs.length < pendingScans.length) {
      console.log('[Service Worker] Some scans failed to sync');
    }
    
  } catch (error) {
    console.error('[Service Worker] Background sync failed:', error);
  }
}

async function syncSettings() {
  try {
    // Sync user settings
    console.log('[Service Worker] Syncing settings...');
    // Implementation depends on your backend API
  } catch (error) {
    console.error('[Service Worker] Settings sync failed:', error);
  }
}

// ===== INDEXEDDB HELPERS =====
function openIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('3DScannerDB', 2);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // Create object stores if they don't exist
      if (!db.objectStoreNames.contains('pendingScans')) {
        db.createObjectStore('pendingScans', { keyPath: 'id', autoIncrement: true });
      }
      
      if (!db.objectStoreNames.contains('scans')) {
        const store = db.createObjectStore('scans', { keyPath: 'id' });
        store.createIndex('date', 'date', { unique: false });
      }
      
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
  });
}

function getAllFromStore(db, storeName) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function removeScansFromStore(db, storeName, ids) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    
    ids.forEach(id => store.delete(id));
    
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

// ===== PUSH NOTIFICATIONS =====
self.addEventListener('push', (event) => {
  console.log('[Service Worker] Push received');
  
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    console.warn('[Service Worker] Failed to parse push data:', error);
    data = {
      title: '3D Scanner Pro',
      body: 'New notification'
    };
  }
  
  const options = {
    body: data.body || 'Your scan is ready!',
    icon: data.icon || '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    image: data.image,
    vibrate: [100, 50, 100, 50, 100],
    data: {
      url: data.url || '/',
      timestamp: Date.now(),
      scanId: data.scanId,
      action: data.action || 'view'
    },
    actions: [
      {
        action: 'view',
        title: 'View Scan',
        icon: '/icons/view-72x72.png'
      },
      {
        action: 'dismiss',
        title: 'Dismiss',
        icon: '/icons/dismiss-72x72.png'
      }
    ],
    tag: data.tag || 'scan-notification',
    renotify: data.renotify || false,
    requireInteraction: data.requireInteraction || false,
    silent: data.silent || false
  };
  
  event.waitUntil(
    self.registration.showNotification(
      data.title || '3D Scanner Pro',
      options
    )
  );
});

self.addEventListener('notificationclick', (event) => {
  console.log('[Service Worker] Notification clicked:', event.notification.tag);
  
  event.notification.close();
  
  const notificationData = event.notification.data || {};
  
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true
      });
      
      // Check if there's already a window open
      for (const client of clients) {
        if (client.url.includes(notificationData.url) && 'focus' in client) {
          await client.focus();
          
          // Send message to the client about the notification click
          client.postMessage({
            type: 'NOTIFICATION_CLICKED',
            data: notificationData
          });
          
          return;
        }
      }
      
      // If no window is open, open a new one
      if (self.clients.openWindow) {
        await self.clients.openWindow(notificationData.url || '/');
      }
    })()
  );
});

self.addEventListener('notificationclose', (event) => {
  console.log('[Service Worker] Notification closed:', event.notification.tag);
});

// ===== MESSAGE HANDLING =====
self.addEventListener('message', (event) => {
  console.log('[Service Worker] Message received:', event.data);
  
  const { type, data } = event.data || {};
  
  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
      
    case 'GET_CACHE_INFO':
      event.ports[0].postMessage({
        cacheName: CACHE_NAME,
        version: APP_VERSION
      });
      break;
      
    case 'CLEAR_CACHE':
      clearCache();
      break;
      
    case 'SAVE_SCAN_OFFLINE':
      saveScanOffline(data);
      break;
      
    case 'SYNC_NOW':
      syncPendingScans();
      break;
  }
});

async function clearCache() {
  const cacheKeys = await caches.keys();
  await Promise.all(cacheKeys.map(key => caches.delete(key)));
  
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({
      type: 'CACHE_CLEARED'
    });
  });
}

async function saveScanOffline(scanData) {
  try {
    const db = await openIndexedDB();
    const transaction = db.transaction(['scans'], 'readwrite');
    const store = transaction.objectStore('scans');
    
    await store.add({
      ...scanData,
      date: new Date().toISOString(),
      offline: true
    });
    
    console.log('[Service Worker] Scan saved offline:', scanData.id);
    
    // Schedule background sync
    if ('sync' in self.registration) {
      await self.registration.sync.register('sync-scans');
    }
    
  } catch (error) {
    console.error('[Service Worker] Failed to save scan offline:', error);
  }
}

// ===== PERIODIC SYNC =====
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'update-content') {
    console.log('[Service Worker] Periodic sync for content updates');
    event.waitUntil(updateContent());
  }
});

async function updateContent() {
  // Update cached resources periodically
  console.log('[Service Worker] Updating cached content');
  
  try {
    const cache = await caches.open(CACHE_NAME);
    
    // Update core files
    for (const url of CORE_FILES) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          await cache.put(url, response);
        }
      } catch (error) {
        console.warn('[Service Worker] Failed to update:', url, error);
      }
    }
    
    console.log('[Service Worker] Content update complete');
  } catch (error) {
    console.error('[Service Worker] Periodic sync failed:', error);
  }
}

// ===== ERROR HANDLING =====
self.addEventListener('error', (event) => {
  console.error('[Service Worker] Error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('[Service Worker] Unhandled rejection:', event.reason);
});
