# Use the rock-solid Long-Term Support version of Node 16 on the lightweight "slim" base
FROM node:16-slim

# Set the working directory
WORKDIR /usr/src/app

# --- SIMPLIFIED AND PROVEN INSTALLATION BLOCK ---
# Install the minimal set of dependencies required for the latest Puppeteer
RUN apt-get update \
    && apt-get install -y wget gnupg \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor > /etc/apt/trusted.gpg.d/google-archive.gpg \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y \
      google-chrome-stable \
      --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*
# --- END OF INSTALLATION BLOCK ---

# Copy package files (including the new axios)
COPY backend/package*.json ./

# Install app dependencies
RUN npm install

# Copy the rest of the backend code
COPY backend/. .

# Copy the frontend code
COPY public ./public

# Expose the application port
EXPOSE 3000

# Run the application
CMD [ "npm", "start" ]
