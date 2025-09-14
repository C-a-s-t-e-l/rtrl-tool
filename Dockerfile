# Use the stable 'bullseye' version of Node.js 18
FROM node:18-bullseye

# Set the working directory in the container
WORKDIR /usr/src/app

#
# --- THIS IS THE CORRECTED, ROBUST INSTALLATION BLOCK ---
#
# Install all known dependencies for headless Chrome on Debian Bullseye
RUN apt-get update \
    && apt-get install -y wget gnupg \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor > /etc/apt/trusted.gpg.d/google-archive.gpg \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y \
      google-chrome-stable \
      fonts-ipafont-gothic \
      fonts-wqy-zenhei \
      fonts-thai-tlwg \
      fonts-kacst \
      fonts-freefont-ttf \
      libxss1 \
      --no-install-recommends \
    # Clean up apt caches to reduce image size
    && rm -rf /var/lib/apt/lists/*
#
# --- END OF CORRECTED BLOCK ---
#

# Copy package files from the backend directory
COPY backend/package*.json ./

# Install app dependencies, including axios
RUN npm install

# Copy the entire backend directory's contents into the container
COPY backend/. .

# Copy the public directory for serving the frontend
COPY public ./public

# Make port 3000 available
EXPOSE 3000

# Define the command to run the app
CMD [ "npm", "start" ]
