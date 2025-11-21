# RTRL Property Prospector

**Live Application URL:** https://rtrl-prospector.vercel.app/

## Project Overview

RTRL Property Prospector is a full-stack web application designed to automate the process of client prospecting for commercial real estate. It replaces a cumbersome workflow that previously involved third-party scraping tools, manual data cleaning, and reformatting for outreach platforms.

The application performs large-scale, targeted searches for businesses based on criteria such as business category, custom keywords, suburb, multiple postcodes, or a geographic radius. It scrapes data from Google Maps and business websites, processes it, and generates ready-to-use export files (XLSX, CSV, TXT) compatible with Notifyre and macOS Contacts (including Smart Lists).


## Technology Stack

### Backend
- Runtime: Node.js  
- Framework: Express.js  
- Real-time Communication: Socket.IO  
- Web Scraping: Puppeteer & puppeteer-extra (Stealth Plugin)  
- Database & Auth: Supabase  
- Emailing: Nodemailer  
- File Handling: JSZip, SheetJS (xlsx)

### Frontend
- Framework: Vanilla JavaScript, HTML5, CSS3  
- Mapping: Leaflet.js  
- APIs: Google Maps Places API 

### Deployment & Infrastructure
- Frontend Hosting: Vercel  
- Backend Hosting: Render (or similar)  
- Containerization: Docker  


## Local Development Setup

These instructions explain how to run the backend and frontend locally.

### Prerequisites
- Node.js (v18+ recommended)  
- npm  
- Supabase credentials  
- Google Maps API key  
- Email service credentials  


## 1. Clone the Repository

    git clone https://github.com/C-a-s-t-e-l/rtrl-tool.git
    cd rtrl-prospector

## 2. Set Up the Backend

Navigate to the backend folder and install dependencies:

    cd backend
    npm install


## 3. Configure Environment Variables

Create a `.env` file under `/backend` and fill it with:

    # Supabase Credentials
    SUPABASE_URL=YOUR_SUPABASE_PROJECT_URL
    SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY

    # Google Maps API Key
    MAPS_API_KEY=YOUR_GOOGLE_MAPS_API_KEY

    # Email Sending (Nodemailer)
    EMAIL_USER=your_email@example.com
    EMAIL_PASS=your_generated_app_password

    # Server & Frontend Config
    FRONTEND_URL=http://localhost:3000
    PORT=3000

Replace placeholders with real values.


## 4. Run the Backend Server

Run the backend:

    npm start

Backend should now run on:

    http://localhost:3000


## 5. Run the Frontend

The frontend uses static HTML, CSS, and JS located in `/public`.

### Update the backend URL in the frontend
Edit `public/script.js`:

    const BACKEND_URL = "http://localhost:3000";

### Start a local dev server
Install `live-server` if needed:

    npm install -g live-server

Run it from the project root:

    live-server public

Your browser will automatically open the interface.


## Codebase Structure Overview

### `/backend`
- server.js — Initializes Express, Socket.IO, and job queue  
- emailService.js — Generates and sends email results  
- fileGenerator.js — Creates XLSX, CSV, and ZIP files  

### `/public`
- script.js — Client logic, WebSocket events, UI updates  
- event-handlers.js — DOM event listeners  
- ui-helpers.js — DOM rendering utilities  
- index.html — Main interface  
- style.css — Frontend styling  

### Root
- Dockerfile — Container configuration  

