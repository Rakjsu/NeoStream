# NeoStream IPTV v2.3.0 - Release Notes

## 🎉 What's New

### 🎬 Unified Video Player Experience
- **Fixed progress bar position** - Progress bar now appears correctly above controls on all pages (Home, VOD, Series, Favorites, Watch Later)
- **Resolved CSS class conflicts** - Renamed card progress bars to prevent interference with video player controls
- **Removed blur effect** - Backdrop blur removed from player controls for cleaner appearance

### 🔧 Bug Fixes
- **Movie progress saving** - Now correctly saves and resumes movie progress from all pages
- **Continue Watching updates** - Home page "Continue Watching" list now refreshes when player is closed
- **Progress bar handle** - Handle (white circle) now properly positioned and visible on hover

### 💅 UI/UX Improvements
- Consistent player controls across all pages
- Smooth progress bar animations
- Gradient purple-pink progress indicator

---

## 📦 Downloads

| Platform | File | Description |
|----------|------|-------------|
| Windows 64-bit | `NeoStream-IPTV-v2.3.0-win64.zip` | Portable version (extract and run) |
| Windows Installer | Coming soon | NSIS installer (.exe) |

---

## ⚙️ Installation

### Portable Version (Recommended)
1. Download `NeoStream-IPTV-v2.3.0-win64.zip`
2. Extract to your preferred location
3. Run `NeoStream IPTV.exe`

---

## 🔄 Upgrade Instructions
Simply replace your existing installation with the new version. Your settings and watch progress are preserved.

---

## 📝 Technical Changes
- Package version updated from 1.0.0 to 2.3.0
- Fixed `.progress-container` and `.progress-bar` CSS conflicts
- Renamed card-specific progress classes to `.card-progress-container` and `.card-progress-bar`
- Removed `backdrop-filter: blur(8px)` from video player controls
