# Use an official Node.js runtime as a parent image
FROM node:18-bullseye

# Set the working directory in the container
WORKDIR /usr/src/app

# Install dependencies required for Puppeteer and Chrome
# This block is for installing the Chrome browser inside the container
RUN apt-get update \
    && apt-get install -y wget gnupg \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
      --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# CORRECTED: Copy package.json and package-lock.json from the 'backend' subfolder
# The source path 'backend/' is relative to the build context (your project root)
COPY backend/package*.json ./

# Install app dependencies
RUN npm install

# CORRECTED: Copy the rest of the backend application source code
COPY backend/. .

# CORRECTED: Copy the public directory so the server can serve the frontend
COPY public ./public

# Make port 3000 available to the world outside this container
EXPOSE 3000

# Define the command to run the app
CMD [ "npm", "start" ]