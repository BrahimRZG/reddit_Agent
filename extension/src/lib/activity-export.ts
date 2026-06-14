/**
 * Local export delivery for the Compliance Activity_Log (Spec 08-A).
 *
 * Both delivery paths are LOCAL and browser-native only. They make NO network
 * request, transmit nothing off the device, and NEVER use `chrome.downloads`
 * (Req 6.1–6.5, 11.4, 11.5):
 *
 *  - `clipboardExport`  → `navigator.clipboard.writeText` (Clipboard_Export)
 *  - `downloadExport`   → an in-page `Blob` object-URL anchor (`<a download>`)
 *                         download, with the object URL revoked afterward.
 *
 * Neither path requires any Chrome extension permission or API. This file
 * currently implements Task 5 only: the two export-delivery helpers.
 */

/**
 * Copy an Export_Document to the clipboard via `navigator.clipboard.writeText`
 * (Clipboard_Export, Req 6.1). Uses no Chrome extension permission or API.
 */
export function clipboardExport(doc: string): Promise<void> {
  return navigator.clipboard.writeText(doc);
}

/**
 * Trigger an in-page `Blob` object-URL anchor download of an Export_Document
 * (Download_Export, Req 6.1, 6.3) and revoke the object URL afterward. NEVER uses
 * `chrome.downloads`.
 *
 * Builds a `Blob` from `doc`, generates an object URL, binds it to an in-page
 * `<a download={filename}>` element, triggers a click, then revokes the object
 * URL and removes the anchor if it was appended to the document.
 */
export function downloadExport(doc: string, filename: string, mime: string): void {
  const blob = new Blob([doc], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;

  let appended = false;
  try {
    document.body.appendChild(anchor);
    appended = true;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
    if (appended) {
      anchor.remove();
    }
  }
}
