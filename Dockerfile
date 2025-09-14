# Use the official Puppeteer image. It includes Node.js and a compatible Chromium.
FROM ghcr.io/puppeteer/puppeteer:22.6.3

# The image's default working directory is /home/pptruser. We will put our app there.
WORKDIR /home/pptruser

#
# --- THIS IS THE PERMISSION FIX ---
#
# When copying files, immediately change their ownership to the 'pptruser'.
# This allows the 'npm install' command (which runs as pptruser) to work correctly.
COPY --chown=pptruser:pptruser backend/package*.json ./

# This command will now succeed.
RUN npm install

# Copy the rest of our application code, also changing ownership.
COPY --chown=pptruser:pptruser backend/. .
COPY --chown=pptruser:pptruser public ./public

EXPOSE 3000

CMD [ "npm", "start" ]
