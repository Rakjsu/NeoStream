export function Settings() {
    return (
        <div className="p-8">
            <h1 className="text-3xl font-bold text-white mb-6">Settings</h1>

            <div className="max-w-2xl space-y-6">
                <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
                    <h2 className="text-xl font-bold text-white mb-4">Appearance</h2>
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <span className="text-gray-300">Theme</span>
                            <select className="bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600">
                                <option>Dark</option>
                                <option>Light</option>
                            </select>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-gray-300">Language</span>
                            <select className="bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600">
                                <option>English</option>
                                <option>Português</option>
                                <option>Español</option>
                            </select>
                        </div>
                    </div>
                </div>

                <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
                    <h2 className="text-xl font-bold text-white mb-4">Player</h2>
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <span className="text-gray-300">Auto-play next</span>
                            <input type="checkbox" className="w-6 h-6" defaultChecked />
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-gray-300">Subtitles</span>
                            <input type="checkbox" className="w-6 h-6" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
