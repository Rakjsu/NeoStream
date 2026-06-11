import { useState } from 'react';

export function useSaveAnimation() {
    const [saveAnimation, setSaveAnimation] = useState<string | null>(null);

    const triggerSaveAnimation = (key: string) => {
        setSaveAnimation(key);
        setTimeout(() => setSaveAnimation(null), 1500);
    };

    return { saveAnimation, triggerSaveAnimation };
}
