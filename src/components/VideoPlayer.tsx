import { MediaPlayer, MediaProvider } from '@vidstack/react';
import { DefaultVideoLayout, defaultLayoutIcons } from '@vidstack/react/player/layouts/default';

interface VideoPlayerProps {
    src: string;
    title?: string;
    poster?: string;
}

export function VideoPlayer({ src, title, poster }: VideoPlayerProps) {
    return (
        <MediaPlayer title={title} src={src} poster={poster} className="w-full h-full aspect-video bg-black">
            <MediaProvider />
            <DefaultVideoLayout icons={defaultLayoutIcons} />
        </MediaPlayer>
    );
}
