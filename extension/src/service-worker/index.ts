// Reddit Marketing Agent - Service Worker (Manifest V3)
// Minimal placeholder for Spec 01

chrome.runtime.onInstalled.addListener(() => {
  // TODO: Spec 02 - Worker Auth & Token Lifecycle
  console.log('[RMA] Extension installed');
});

// TODO: Scanner spec — Add chrome.alarms for periodic scanning
// TODO: Scanner spec — Add chrome.notifications for lead alerts

export {};
