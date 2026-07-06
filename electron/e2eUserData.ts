import { app } from 'electron'

// E2E test hook (Playwright suite only).
//
// When NEOSTREAM_E2E_USER_DATA is set, every piece of persisted state —
// electron-store's config.json, localStorage, IndexedDB, EPG cache — is
// redirected to the given temp directory so tests run isolated from the
// real user profile and from each other.
//
// This module MUST be the first import of electron/main.ts: electron-store
// resolves app.getPath('userData') at construction time (module load of
// electron/store.ts), so the path has to be overridden before any other
// module is evaluated.
const e2eUserData = process.env.NEOSTREAM_E2E_USER_DATA
if (e2eUserData) {
    app.setPath('userData', e2eUserData)
    // DVR writes to app.getPath('videos') — keep tests off the real folder.
    app.setPath('videos', `${e2eUserData}/videos`)
}
