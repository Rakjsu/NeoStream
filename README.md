# NeoStream 📺

A sleek and modern IPTV streaming application built with **Electron**, **React**, and **TypeScript**. Stream live TV, movies, and series with a beautiful Netflix-inspired interface and intelligent TMDB integration.

---

## ✨ Features

### 🎬 VOD (Video on Demand)
- Browse and stream movies from your IPTV provider
- **TMDB Integration**:
  - Accurate release dates (DD/MM/YYYY format)
  - Ratings with animated star icons (0-10 scale)
  - Genre information
  - Complete synopses in Portuguese
- Beautiful grid layout with poster images
- Graceful fallback for missing images

### 📺 Series
- Browse TV series with season and episode management
- **Smart Episode Naming**:
  - Intelligent fallback to TMDB when IPTV names are inadequate
  - Automatic cleaning of episode titles (removes "Capítulo X", "Ep1", etc.)
  - Consistent format: "Episódio X - Episode Name"
  - Episode name caching for performance
- **TMDB Integration**:
  - First air dates (DD/MM/YYYY format)
  - Ratings with pulsing animations (0-10 scale)
  - Genre information
  - Complete synopses in Portuguese
- Background blur effect for selected series
- Grid view remains visible while viewing details

### 📡 Live TV
- Stream live television channels
- EPG (Electronic Program Guide) support
- Channel browsing and selection

### ⚙️ Settings
- Easy IPTV provider configuration
- Secure credential storage
- Xtream Codes API integration

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ and npm
- IPTV subscription with Xtream Codes API

### Installation

```bash
# Clone the repository
git clone https://github.com/Rakjsu/NeoStream.git
cd NeoStream

# Install dependencies
npm install

# Run development server
npm run dev
```

### Build for Production

```bash
# Build for Windows
npm run build:win

# Build for macOS
npm run build:mac

# Build for Linux
npm run build:linux
```

---

## 🛠️ Tech Stack

- **Framework**: Electron + React 18
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Video Streaming**: hls.js
- **Build Tool**: Vite
- **APIs**: TMDB API (The Movie Database), Xtream Codes API
- **IPC**: Electron IPC for secure communication

---

## 📁 Project Structure

```
NeoStream/
├── src/
│   ├── main/              # Electron main process
│   ├── components/        # Reusable React components
│   │   └── AsyncVideoPlayer.tsx
│   ├── pages/             # Page components
│   │   ├── VOD.tsx       # Movies with TMDB integration
│   │   ├── Series.tsx    # Series with smart episode naming
│   │   ├── Live.tsx      # Live TV channels
│   │   └── Settings.tsx  # Configuration
│   ├── services/
│   │   └── tmdb.ts       # TMDB API service
│   └── types/            # TypeScript definitions
├── electron/             # Electron configuration
├── README.md
└── package.json
```

---

## 🎨 UI Features

### Animations
- **Pulsing rating badges** with rotating star icons
- **Slide-in effects** for action buttons
- **Smooth hover transitions** on content tiles
- **Loading states** with elegant skeleton screens
- **Button click animations** with scale effects

### Responsive Design
- **7-column grid** layouts optimized for large screens
- **Scrollable content** areas with hidden scrollbars
- **Blurred background** images for selected content
- **Dynamic borders** highlighting selected items

---

## 🔧 TMDB Integration Details

### Episode Name Fallback System

NeoStream features an intelligent episode naming system that provides the best possible episode names:

1. **Validation**: Checks if IPTV episode name is meaningful
2. **Cleaning**: Removes common patterns like "S01E01", "Episódio X", "Capítulo X"
3. **Fallback**: If IPTV name is inadequate, fetches from TMDB
4. **Caching**: Stores TMDB results to minimize API calls
5. **Format**: Always displays as "Episódio X - Episode Name"

### Data Fetched
- **Movies**: `release_date`, `vote_average`, `genres`, `overview`
- **Series**: `first_air_date`, `vote_average`, `genres`, `overview`
- **Episodes**: `name`, `overview`, `air_date`

### Smart Search
1. Extracts year from title (e.g., "Inception (2010)")
2. Removes tags (e.g., "Movie [HD]" → "Movie")
3. Searches TMDB with clean name and year
4. Falls back to year-agnostic search if needed

---

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [TMDB](https://www.themoviedb.org/) for providing the comprehensive movie/TV database API
- [hls.js](https://github.com/video-dev/hls.js) for HLS streaming support
- Netflix for UI/UX design inspiration

---

## ⚠️ Disclaimer

This application is for personal use only. Ensure you have the rights to stream content through your IPTV provider. This product uses the TMDB API but is not endorsed or certified by TMDB.

---

**Built with ❤️ by [Rakjsu](https://github.com/Rakjsu)**
