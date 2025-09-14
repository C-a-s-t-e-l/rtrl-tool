# Use the official Puppeteer image. It includes Node.js and a compatible Chromium.
# This completely avoids all apt-get installation problems we've been fighting.
FROM ghcr.io/puppeteer/puppeteer:22.6.3

# The image's default working directory is /home/pptruser. We will put our app there.
# This is also more secure because it doesn't run as the root user.
WORKDIR /home/pptruser

# Copy package files first for better layer caching
COPY backend/package*.json ./
RUN npm install

# Copy the rest of our application code
COPY backend/. .
COPY public ./public

EXPOSE 3000

CMD [ "npm", "start" ]
