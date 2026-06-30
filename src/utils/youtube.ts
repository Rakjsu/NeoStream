/**
 * Extracts an 11-character YouTube video id from a raw id or a YouTube URL.
 *
 * Providers vary: the value may already be a bare id ("dQw4w9WgXcQ"), or a
 * full URL in any of the common forms (watch?v=, youtu.be/, embed/). Returns
 * the id, or null when the input is empty or unrecognizable.
 */
export function extractYouTubeId(value: string | null | undefined): string | null {
    if (!value) return null;

    const trimmed = value.trim();
    if (!trimmed) return null;

    // Already a bare 11-char id.
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

    // Common URL forms: watch?v=ID, youtu.be/ID, embed/ID (and -nocookie).
    const match = trimmed.match(
        /(?:youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );
    return match ? match[1] : null;
}
