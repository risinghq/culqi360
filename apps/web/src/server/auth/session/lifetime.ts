// A session lives 30 days from issue and slides forward while in use. Each
// write is a store request, so activity is recorded at most every 5 minutes
// and the expiry moves only once fewer than 7 days remain.
export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
export const ACTIVITY_UPDATE_THRESHOLD_MS = 5 * 60 * 1000;
export const EXTENSION_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;
