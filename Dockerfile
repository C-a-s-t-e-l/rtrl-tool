# Use the official Puppeteer image. It includes Node.js and a compatible Chromium.
FROM ghcr.io/puppeteer/puppeteer:22.6.3

# The image's default working directory is /home/pptruser. We will put our app there.
WORKDIR /home/pptruser

#
# --- THIS IS THE FIX ---
#
# Set this environment variable to tell Puppeteer's install script
# NOT to download a browser, because one is already included in this image.
ENV PUPPETEER_SKIP_DOWNLOAD=true
#
# --- END OF FIX ---
#

# When copying files, immediately change their ownership to the 'pptruser'.
COPY --chown=pptruser:pptruser backend/package*.json ./

# This command will now succeed because the problematic script is skipped.
RUN npm install

# Copy the rest of our application code, also changing ownership.
COPY --chown=pptruser:pptruser backend/. .
COPY --chown=pptruser:pptruser public ./public

EXPOSE 3000

CMD [ "npm", "start" ]
