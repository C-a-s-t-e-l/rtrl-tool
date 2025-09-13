# RTRL Property Prospector

Intelligent Client Prospecting for Commercial Real Estate.

## Deployment

This project uses a split architecture for deployment:

-   **Frontend:** The `/public` directory contains all static assets and should be deployed to a service like Vercel.
-   **Backend:** The `/backend` directory contains the Node.js server with Express, Socket.IO, and Puppeteer. It should be deployed to a stateful hosting service like Render.

### Environment Variables

The following environment variables are required for the backend:

-   `MAPS_API_KEY`: Your Google Maps API key.
-   `FRONTEND_URL`: The public URL of your deployed frontend (e.g., `https://your-app.vercel.app`).
-   `PORT`: The port the server should run on (usually provided by the hosting service).

The frontend `script.js` must be updated with the public URL of the deployed backend.