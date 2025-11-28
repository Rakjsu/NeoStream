# IPTV Streaming Platform

Modern IPTV streaming platform built with **Electron**, **React**, and **TypeScript**, featuring full **TMDB (The Movie Database)** integration for rich metadata display.

---

## 🎯 Features

### 🎬 VOD (Video on Demand)
- Browse and play movies from IPTV provider
- **TMDB Integration**:
  - Full release dates (DD/MM/YYYY format)
  - Accurate ratings (0-10 scale)
  - Genre information
  - Complete synopses
- Animated UI with loading states
- Grid view with poster images
- Fallback emoji icons for missing posters

### 📺 Series
- Browse and manage TV series
- **TMDB Integration**:
  - First air dates (DD/MM/YYYY format)
  - Accurate ratings (0-10 scale)
  - Genre information
  - Complete synopses
- Handles series with tags ([L], [D], [HD], etc.)
- Grid view with cover images
- Fallback emoji icons for missing covers

### 📡 Live TV
- Browse live TV channels
- EPG (Electronic Program Guide) integration
- Stream live television content

### ⚙️ Configuration
- Easy IPTV provider setup
- API credentials management
- Server configuration

---

## 🚀 Tech Stack

- **Framework**: Electron + React
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **API**: TMDB (The Movie Database)
- **Build Tool**: Vite
- **IPC**: Electron IPC for secure communication

---

## 📦 Installation

### Prerequisites
- Node.js 16+ and npm

### Setup
```bash
# Clone repository
git clone <repository-url>
cd IPTV

# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

---

## 🔑 Configuration

### TMDB API
The app uses TMDB API for movie and series metadata:
- API Key is embedded in `src/services/tmdb.ts`
- Searches use Portuguese (pt-BR) language
- Automatic name cleaning removes tags like [L], [D], [HD]

### IPTV Provider
Configure your IPTV provider in the Settings page with:
- Server URL
- Username
- Password

---

## 📁 Project Structure

```
IPTV/
├── src/
│   ├── main/              # Electron main process
│   ├── renderer/          # React frontend
│   ├── pages/             # Page components
│   │   ├── VOD.tsx       # Movies page with TMDB
│   │   ├── Series.tsx    # Series page with TMDB
│   │   ├── Live.tsx      # Live TV page
│   │   └── Settings.tsx  # Configuration page
│   ├── services/
│   │   └── tmdb.ts       # TMDB API service
│   └── types/            # TypeScript definitions
├── README.md
└── package.json
```

---

## 🎨 UI Features

### Animations
- **Pulsing rating badges** with rotating star icons
- **Slide-in effects** for action buttons
- **Smooth hover transitions** on poster tiles
- **Loading states** with skeleton screens

### Responsive Design
- **Grid layouts** optimized for large screens
- **Scrollable content** areas
- **Blurred background** images for selected content

---

## 🔧 TMDB Integration Details

### Data Fetched
- **Movies**: `release_date`, `vote_average`, `genres`, `overview`
- **Series**: `first_air_date`, `vote_average`, `genres`, `overview`

### Smart Search
1. Extracts year from title (e.g., "Inception (2010)")
2. Removes tags (e.g., "Series [L]" → "Series")
3. Searches TMDB with clean name
4. Falls back to year-agnostic search if no year provided

### Error Handling
- Graceful fallbacks when TMDB data unavailable
- Loading indicators during API calls
- No errors logged to console (production-ready)

---

## 📝 License

This project is for educational and personal use.

**TMDB Attribution**: This product uses the TMDB API but is not endorsed or certified by TMDB.

---

## 🤝 Contributing

Contributions welcome! Please ensure:
- Code follows TypeScript best practices
- UI changes match existing design patterns
- TMDB  API calls are efficient and cached where possible

---

## 📞 Support

For issues or questions, please open a GitHub issue.

---

**Built with ❤️ using React, Electron, and TMDB API**
