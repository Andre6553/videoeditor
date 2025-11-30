# AI Reel Editor

A powerful video editing application for creating professional reels with advanced features like color grading, slow motion, clip merging, and customizable templates.

## Features

- 🎬 Multi-track video editing with drag-and-drop timeline
- 🎨 WebGL-based real-time color grading (exposure, contrast, saturation, sharpness)
- 🎥 60fps conversion with smooth slow-motion effects
- 🔗 Clip merging and splitting
- 📐 Reframe tools (16:9, 9:16, 1:1)
- 🎭 Templates: Solo, Duet, Trio layouts
- 🎵 Audio waveform visualization
- ⚡ FFmpeg-powered video processing
- 💾 Export high-quality videos

## Prerequisites

Before setting up the app on any PC, ensure the following are installed:

### 1. Node.js (v16 or higher)
- **Download**: https://nodejs.org/
- **Check installation**: Open terminal/PowerShell and run:
  ```bash
  node --version
  npm --version
  ```
- Both commands should return version numbers if installed correctly

### 2. FFmpeg (Required for video processing)
- **Download**: https://ffmpeg.org/download.html
- **Windows Installation**:
  1. Download the latest FFmpeg build for Windows
  2. Extract the zip file to a location like `C:\ffmpeg`
  3. Add FFmpeg to system PATH:
     - Right-click "This PC" → Properties
     - Click "Advanced system settings"
     - Click "Environment Variables"
     - Under "System variables", find and select "Path"
     - Click "Edit" → "New"
     - Add the path to FFmpeg's `bin` folder (e.g., `C:\ffmpeg\bin`)
     - Click OK on all windows
  4. **Verify installation**: Open a NEW terminal/PowerShell and run:
     ```bash
     ffmpeg -version
     ```
     You should see FFmpeg version information

## Installation & Setup

### Setting Up on a New PC

1. **Copy the Project Folder**
   - Copy the entire project folder to any location on the new PC
   - The folder structure must remain intact
   - You can place it anywhere (Desktop, Documents, D:\ drive, etc.)

2. **Install Dependencies**
   - Open terminal/PowerShell in the project folder
   - Run:
     ```bash
     npm install
     ```
   - This installs all required packages (only needed once per machine)
   - A `node_modules` folder will be created automatically

3. **Ready to Run!**
   - Your app is now set up and ready to use

## Running the Application

You need to run **both** the backend server and the frontend:

### Option A: Using Two Terminals (Recommended)

**Terminal 1 - Backend Server:**
```bash
node server.js
```
You should see: `Server running on http://localhost:3001`

**Terminal 2 - Frontend Dev Server:**
```bash
npm run dev
```
You should see: `Local: http://localhost:3000/`

### Option B: Using a Single Command
You can also use:
```bash
npm start
```
This will attempt to run both servers simultaneously.

### Opening the App
- Once both servers are running, open your browser
- Go to: **http://localhost:3000**
- The app should load and be ready to use!

## Project Structure

```
ai-reel-editor/
├── components/          # React components
├── services/           # FFmpeg and video processing services
├── uploads/            # Temporary folder for video processing (created automatically)
├── server.js           # Backend server with FFmpeg integration
├── App.tsx             # Main application component
├── index.html          # Entry HTML file
├── package.json        # Dependencies and scripts
└── vite.config.ts      # Build configuration
```

## Important Notes

### Portability
✅ **The entire project folder is portable**
- You can copy/move it to any location
- Works on any Windows PC with the prerequisites installed
- No absolute paths are hardcoded

### What NOT to Copy
❌ Do **not** copy `node_modules` folder when transferring to another PC
- It will be recreated by `npm install`
- This saves significant time and space

### Data Storage
- Videos are processed in the `uploads/` folder (auto-created)
- Project data is stored in browser memory during use
- Exported videos are saved to your Downloads folder

## Troubleshooting

### "FFmpeg not found" Error
- Ensure FFmpeg is installed and added to system PATH
- Restart your terminal/PowerShell after adding to PATH
- Verify with `ffmpeg -version`

### Backend Won't Start (Port Already in Use)
- Another app might be using port 3001
- Stop other Node.js processes or change the port in `server.js`

### Frontend Won't Start (Port Already in Use)
- Another app might be using port 3000
- Stop other dev servers or change the port in `vite.config.ts`

### "Cannot find module" Error
- Run `npm install` again
- Delete `node_modules` and `package-lock.json`, then run `npm install`

### Videos Not Processing
- Check that both backend and frontend servers are running
- Check browser console (F12) for errors
- Ensure FFmpeg is properly installed

### Slow Performance
- Color grading uses WebGL - ensure GPU acceleration is enabled in browser
- Large video files may take longer to process
- Close other resource-intensive applications

## Browser Compatibility

Recommended browsers:
- ✅ Chrome (v90+)
- ✅ Edge (v90+)
- ✅ Firefox (v88+)
- ⚠️ Safari (limited WebGL support)

## Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Styling**: CSS with modern glassmorphism design
- **Video Processing**: FFmpeg (server-side)
- **Real-time Preview**: WebGL shaders
- **Backend**: Node.js + Express

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Verify all prerequisites are installed correctly
3. Ensure both servers are running

---

**Version**: 1.0  
**Last Updated**: November 2025

Enjoy creating amazing reels! 🎬✨
