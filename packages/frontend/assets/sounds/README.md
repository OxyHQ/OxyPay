# Sounds

Drop these MP3 files here:

- `sent.mp3` — short chime, ~0.5–1.0s, played after a successful outgoing transaction
- `received.mp3` — distinct chime, ~0.5–1.5s, played when the wallet detects a new incoming transaction
- `unlocked.mp3` — soft confirmation tone, ~0.3–0.6s, played after successful PIN/biometric unlock

Recommended: 44.1 kHz mono, < 50 KB each, royalty-free or self-recorded.

These files are referenced via `require()` in `src/services/sounds.ts` and bundled with the app. They are also declared in the `expo-notifications` plugin's `sounds` array in `app.json` so Android can use them for notification channels.

If any file is missing, the audio service silently no-ops — the rest of the app keeps working.
