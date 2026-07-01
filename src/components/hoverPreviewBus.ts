/**
 * Tiny pub/sub that connects grid cards to the single, app-wide centered
 * preview overlay. Cards call `open()` on hover (after a delay) with a snapshot
 * of the poster's on-screen rect + the item's data and action callbacks; the
 * overlay (registered once near the app root) flies a panel from that rect to
 * the center of the screen and plays the muted trailer.
 */

export interface HoverPreviewPayload {
    /** Poster rect at open time — the FLIP animation flies from here to center. */
    anchor: DOMRect
    type: 'movie' | 'series'
    title: string
    year?: string
    cover: string
    backdrop?: string
    rating?: string
    genres?: string[]
    /** Provider-supplied trailer (usually empty → overlay falls back to TMDB). */
    youtubeTrailer?: string
    isFavorite?: boolean
    onPlay: () => void
    onMoreInfo: () => void
    onToggleFavorite?: () => void
}

interface OverlayHandlers {
    open: (payload: HoverPreviewPayload) => void
    scheduleClose: () => void
    cancelClose: () => void
}

let handlers: OverlayHandlers | null = null

export const hoverPreviewBus = {
    /** The overlay registers itself once; returns an unsubscribe. */
    register(next: OverlayHandlers): () => void {
        handlers = next
        return () => {
            if (handlers === next) handlers = null
        }
    },
    open(payload: HoverPreviewPayload) {
        handlers?.open(payload)
    },
    scheduleClose() {
        handlers?.scheduleClose()
    },
    cancelClose() {
        handlers?.cancelClose()
    },
    /** True when an overlay is mounted (cards can skip work if not). */
    get active() {
        return handlers !== null
    },
}
