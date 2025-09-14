# Use the official Puppeteer image. It includes Node.js and a compatible Chromium.
FROM ghcr.io/puppeteer/puppeteer:22.6.3

# The image's default working directory is /home/pptruser. We will put our app there.
WORKDIR /home/pptruser

# Set this environment variable to tell Puppeteer's install script
# NOT to download a browser, because one is already included in this image.
ENV PUPPETEER_SKIP_DOWNLOAD=true

# We only copy package.json first to leverage Docker cache for dependencies.
COPY --chown=pptruser:pptruser backend/package*.json ./

# --- THIS IS THE FINAL FIX ---
# Forcefully remove the pre-existing, corrupted npm cache directory from the base image.
# Then, run npm install in the same step.
RUN rm -rf /home/pptruser/.npm && npm install

# Copy the rest of our application code, also changing ownership.
COPY --chown=pptruser:pptruser backend/. .
COPY --chown=pptruser:pptruser public ./public

EXPOSE 3000

CMD [ "npm", "start" ]
