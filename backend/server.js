// backend/server.js

const express = require("express");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const { sendResultsByEmail } = require("./emailService");

puppeteer.use(StealthPlugin());

const app = express();
const server = http.createServer(app);

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const io = new Server(server, {
  cors: { origin: FRONTEND_URL, methods: ["GET", "POST"] },
  transports: ['websocket'], 
  pingInterval: 25000,
  pingTimeout: 60000,
});

const PORT = process.env.PORT || 3000;
const GOOGLE_MAPS_API_KEY = process.env.MAPS_API_KEY;
const PLACEHOLDER_KEY = "%%GOOGLE_MAPS_API_KEY%%";

if (!GOOGLE_MAPS_API_KEY) {
  console.error("ERROR: MAPS_API_KEY not found in .env file!");
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

let isWorkerRunning = false;
let jobQueue = [];

const processQueue = async () => {
  if (isWorkerRunning || jobQueue.length === 0) return;
  isWorkerRunning = true;
  const jobId = jobQueue.shift();
  console.log(`[Worker] Picked up job ${jobId}`);
  try {
    await runScrapeJob(jobId);
  } catch (error) {
    console.error(`[Worker] Critical unhandled error in job ${jobId}:`, error);
    await updateJobStatus(jobId, "failed");
    await addLog(
      jobId,
      `[FATAL_ERROR] Worker failed unexpectedly: ${error.message}`
    );
  } finally {
    isWorkerRunning = false;
    console.log(
      `[Worker] Finished processing job ${jobId}. Checking for more work.`
    );
    process.nextTick(processQueue);
  }
};

const updateJobStatus = async (jobId, status) => {
  await supabase.from("jobs").update({ status }).eq("id", jobId);
  io.to(jobId).emit("job_update", { status });
};

const addLog = async (jobId, message) => {
  await supabase.rpc("append_log", { job_id: jobId, new_log: message });
  io.to(jobId).emit("job_log", message);
};

const appendJobResult = async (jobId, newResult) => {
  try {
    const { data: currentJob, error: fetchError } = await supabase
      .from("jobs")
      .select("results")
      .eq("id", jobId)
      .single();

    if (fetchError) {
      throw new Error(`Failed to fetch current results: ${fetchError.message}`);
    }

    const existingResults = currentJob.results || [];
    const updatedResults = [...existingResults, newResult];

    const { error: updateError } = await supabase
      .from("jobs")
      .update({ results: updatedResults })
      .eq("id", jobId);

    if (updateError) {
      throw new Error(`Failed to save updated results: ${updateError.message}`);
    }
    io.to(jobId).emit("business_found", newResult);

  } catch (error) {
    console.error(`[appendJobResult Error] For job ${jobId}:`, error);
    io.to(jobId).emit("business_found", newResult);
    await addLog(jobId, `[ERROR] Failed to permanently save result: ${newResult.BusinessName}. It will be missing on reload.`);
  }
};

const runScrapeJob = async (jobId) => {
  await updateJobStatus(jobId, "running");
  const { data: job, error: fetchError } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .single();
  if (fetchError || !job) {
    console.error(`[Job: ${jobId}] Could not fetch job details. Aborting.`, fetchError);
    await updateJobStatus(jobId, "failed");
    return;
  }

  if (!job.parameters) {
        await addLog(jobId, "[FATAL_ERROR] Job started with no parameters. Aborting.", "error");
        await updateJobStatus(jobId, "failed");
        return;
    }

  const { parameters } = job;
  const {
    categoriesToLoop, location, postalCode, country, count, businessNames, anchorPoint, radiusKm, userEmail, searchParamsForEmail, exclusionList,
  } = parameters;

  let browser = null;
  let allProcessedBusinesses = job.results || [];
  const masterUrlMap = new Map(
    (job.collected_urls || []).map(item => [item.url, item.category])
  );

  try {
    const puppeteerArgs = [
      "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
      "--disable-gpu", "--no-zygote", "--lang=en-US,en",
      "--ignore-certificate-errors", "--window-size=1920,1080",
      "--disable-blink-features=AutomationControlled",
    ];
    const launchBrowser = async (logMessage) => {
      await addLog(jobId, logMessage);
      const userDataDir = path.join(__dirname, "puppeteer_temp", `user_data_${Date.now()}`);
      const launchArgs = [...puppeteerArgs, `--user-data-dir=${userDataDir}`, "--disable-extensions", "--disable-component-extensions-with-background-pages"];
      return await puppeteer.launch({ headless: true, args: launchArgs, protocolTimeout: 300000, userDataDir: userDataDir });
    };

    await addLog(jobId, `--- Starting URL Collection Phase ---`);
    if (masterUrlMap.size > 0) {
      await addLog(jobId, `[Resume] Loaded ${masterUrlMap.size} URLs from previous session. Continuing collection.`);
    }

    browser = await launchBrowser("[Browser Lifecycle] Launching new browser for URL collection...");
    let collectionPage = await browser.newPage();
    await addLog(jobId, "[Setup] Created a dedicated page for URL collection.");

    const isIndividualSearch = businessNames && businessNames.length > 0;
    const searchItems = isIndividualSearch ? businessNames : (categoriesToLoop && categoriesToLoop.length > 0 ? categoriesToLoop : []);

    for (const item of searchItems) {
      await addLog(jobId, isIndividualSearch ? `\n--- Searching for business: "${item}" ---` : `\n--- Searching for category: "${item}" ---`);
      
      let locationQueries = [];
      if (anchorPoint && radiusKm)
        locationQueries = await getSearchQueriesForRadius(anchorPoint, radiusKm, country, GOOGLE_MAPS_API_KEY, jobId);
      else {
        let searchAreas = [];
        if (postalCode && postalCode.length > 0) searchAreas = postalCode;
        else if (location) searchAreas = [location];
        if (searchAreas.length === 0) {
          await addLog(jobId, "No location/postcode provided, skipping item.", "error");
          continue;
        }
        for (const areaQuery of searchAreas) {
          const baseQuery = isIndividualSearch ? `${item}, ${areaQuery}, ${country}` : `${item} in ${areaQuery}, ${country}`;
          const queriesForArea = await getSearchQueriesForLocation(baseQuery, areaQuery, country, jobId, isIndividualSearch);
          locationQueries.push(...queriesForArea);
        }
      }

      for (const query of locationQueries) {
        const finalSearchQuery = isIndividualSearch || query.startsWith("near ") ? `${item} ${query}` : query;
        const discoveredUrlsForThisSubArea = new Set();
        await collectGoogleMapsUrlsContinuously(collectionPage, finalSearchQuery, jobId, discoveredUrlsForThisSubArea, country);
        let initialSize = masterUrlMap.size;
        discoveredUrlsForThisSubArea.forEach((url) => { if (!masterUrlMap.has(url)) masterUrlMap.set(url, item); });
        let newUrlsFound = masterUrlMap.size - initialSize;
        await addLog(jobId, `   -> Found ${newUrlsFound} new URLs in this area. Total unique URLs so far: ${masterUrlMap.size}`);
      }

      const currentUrlsToSave = Array.from(masterUrlMap, ([url, specificCategory]) => ({ url, category: specificCategory }));
      const { error: saveError } = await supabase
        .from("jobs")
        .update({ collected_urls: currentUrlsToSave })
        .eq("id", jobId);

      if (saveError) {
        await addLog(jobId, `[Warning] Failed to save URL collection progress: ${saveError.message}`, "error");
      } else {
        await addLog(jobId, `[Checkpoint] Saved ${currentUrlsToSave.length} total URLs to the database.`);
      }
    }

    if (collectionPage) try { await collectionPage.close(); } catch (e) {}
    if (browser) try { await browser.close(); } catch (e) {}
    browser = null; 

    const finalCollectedUrls = Array.from(masterUrlMap, ([url, specificCategory]) => ({ url, category: specificCategory }));
    await addLog(jobId, `\n--- URL Collection Complete. Found ${finalCollectedUrls.length} total unique businesses. ---`);
    
    await addLog(jobId, `--- Starting Data Processing Phase ---`);
    browser = await launchBrowser("[Browser Lifecycle] Launching new browser for data processing...");

    const finalCount = businessNames && businessNames.length > 0 ? -1 : parameters.count || -1;
    const isSearchAll = finalCount === -1;
    const targetCount = isSearchAll ? Infinity : finalCount;

    const processedUrls = new Set(allProcessedBusinesses.map((b) => b.GoogleMapsURL));
    const urlsToProcess = finalCollectedUrls.filter(item => !processedUrls.has(item.url));

    await addLog(jobId, `Total URLs to process: ${urlsToProcess.length}. Previously processed: ${processedUrls.size}.`);

    const addedBusinessKeys = new Set(allProcessedBusinesses.map((b) => {
      const name = b.BusinessName?.toLowerCase().trim() || "";
      const phone = normalizePhoneNumber(b.Phone);
      if (phone) return `phone::${name}::${phone}`;
      return `name_only::${name}`;
    }));

    const CONCURRENCY = 3;
    const BROWSER_RESTART_THRESHOLD = 50;
    let processedInThisSession = 0;

    for (let i = 0; i < urlsToProcess.length; i += CONCURRENCY) {
      if (allProcessedBusinesses.length >= targetCount) break;

      if (processedInThisSession > 0 && processedInThisSession % BROWSER_RESTART_THRESHOLD === 0) {
        await addLog(jobId, `[System] Browser has processed ${processedInThisSession} items. Restarting for stability...`);
        await browser.close();
        browser = await launchBrowser("[System] New browser instance is ready.");
      }

      const batch = urlsToProcess.slice(i, i + CONCURRENCY);
      const promises = batch.map(async (processItem) => {
          let detailPage = null;
          try {
              const scrapingTask = async () => {
                  detailPage = await browser.newPage();
                  await detailPage.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36");
                  await detailPage.setRequestInterception(true);
                  detailPage.on("request", (req) => {
                      if (["image", "stylesheet", "font", "media"].includes(req.resourceType())) req.abort();
                      else req.continue();
                  });
                  let googleData = await scrapeGoogleMapsDetails(detailPage, processItem.url, jobId, country);
                  if (!googleData || !googleData.BusinessName) return null;
                  let websiteData = {};
                  if (googleData.Website) websiteData = await scrapeWebsiteForGoldData(detailPage, googleData.Website, jobId);
                  const fullBusinessData = { ...googleData, ...websiteData };
                  fullBusinessData.Category = businessNames && businessNames.length > 0 ? googleData.ScrapedCategory || "N/A" : processItem.category || "N/A";
                  return fullBusinessData;
              };

              return await promiseWithRetry(scrapingTask, 3, 2000, jobId, processItem.url);

          } catch (err) {
              await addLog(jobId, `[FINAL_FAILURE] Skipped URL ${processItem.url} after all retries failed: ${err.message}`, "error");
              return null; 
          } finally {
              processedInThisSession++;
              if (detailPage) try { await detailPage.close(); } catch (e) {}
          }
      });

      const results = await Promise.all(promises);
      for (const businessData of results) {
        if (businessData && allProcessedBusinesses.length < targetCount) {
          if (exclusionList && exclusionList.length > 0) {
              const businessNameLower = businessData.BusinessName?.toLowerCase() || '';
              const isExcluded = exclusionList.some(excludedName => 
                  businessNameLower.includes(excludedName.toLowerCase())
              );
              if (isExcluded) {
                  await addLog(jobId, `-> SKIPPED (On exclusion list): ${businessData.BusinessName}`);
                  continue;
              }
          }
          const name = businessData.BusinessName?.toLowerCase().trim() || "";
          const phone = normalizePhoneNumber(businessData.Phone);
          const address = normalizeAddress(businessData.StreetAddress);
          const email = businessData.Email1?.toLowerCase().trim() || "";
          let uniqueIdentifier = "", reason = "";
          if (phone) { uniqueIdentifier = `phone::${name}::${phone}`; reason = `by Phone (${phone})`; }
          else if (address) { uniqueIdentifier = `address::${name}::${address}`; reason = `by Address (${businessData.StreetAddress})`; }
          else if (email) { uniqueIdentifier = `email::${name}::${email}`; reason = `by Email (${email})`; }
          else { uniqueIdentifier = `name_only::${name}`; reason = "by Name Only"; }

          if (addedBusinessKeys.has(uniqueIdentifier)) {
            await addLog(jobId, `-> SKIPPED (Duplicate ${reason}): ${businessData.BusinessName}`);
          } else {
            addedBusinessKeys.add(uniqueIdentifier);
            allProcessedBusinesses.push(businessData);
            await appendJobResult(jobId, businessData);
            const status = isSearchAll ? `(Total Added: ${allProcessedBusinesses.length})` : `(${allProcessedBusinesses.length}/${finalCount})`;
            await addLog(jobId, `-> ADDED: ${businessData.BusinessName}. ${status}`);
          }
        }
      }
      io.to(jobId).emit("progress_update", {
        processed: processedUrls.size + i + batch.length,
        discovered: finalCollectedUrls.length,
        added: allProcessedBusinesses.length,
        target: finalCount,
      });
    }

    await addLog(jobId, `Scraping completed. Found and processed a total of ${allProcessedBusinesses.length} businesses.`);
    
    await addLog(jobId, `[Deduplication] Starting deduplication process...`);
    const { uniqueBusinesses, duplicates } = deduplicateBusinesses(allProcessedBusinesses);
    await addLog(jobId, `[Deduplication] Process complete. Found ${uniqueBusinesses.length} unique businesses and ${duplicates.length} duplicates.`);
    
    if (userEmail && uniqueBusinesses.length > 0) {
      await addLog(jobId, `[Email] Preparing to send results to ${userEmail}...`);
      const mainSearchArea = searchParamsForEmail.area || "selected_area";
      
      const uniqueBusinessesForEmail = uniqueBusinesses.map((business) => ({
        ...business, SuburbArea: business.Suburb || mainSearchArea.replace(/_/g, " "),
      }));
      
      const duplicatesForEmail = duplicates.map((business) => ({
        ...business, SuburbArea: business.Suburb || mainSearchArea.replace(/_/g, " "),
      }));
      
      const emailParams = { ...searchParamsForEmail };
      if (parameters.radiusKm) {
        emailParams.radiusKm = parameters.radiusKm;
      }

      const emailStatus = await sendResultsByEmail(userEmail, uniqueBusinessesForEmail, emailParams, duplicatesForEmail);
      await addLog(jobId, `[Email] ${emailStatus}`);
    } else if (userEmail) {
        await addLog(jobId, `[Email] No unique businesses found after deduplication. Skipping email.`);
    }
    await updateJobStatus(jobId, "completed");
  } catch (error) {
    console.error(`[Job: ${jobId}] A critical error occurred during scraping:`, error);
    await addLog(jobId, `[ERROR] Critical failure: ${error.message.split("\n")[0]}`, "error");
    await updateJobStatus(jobId, "failed");
  } finally {
    if (browser) try { await browser.close(); } catch (e) {}
  }
};

const recoverStuckJobs = async () => {
  console.log(
    "[System] Checking for jobs that were running during a previous crash..."
  );
  const { data: stuckJobs, error } = await supabase
    .from("jobs")
    .select("id")
    .in("status", ["running", "queued"]);
  if (error) {
    console.error("[Recovery] Error fetching stuck jobs:", error);
    return;
  }
  if (stuckJobs && stuckJobs.length > 0) {
    const jobIds = stuckJobs.map((j) => j.id);
    console.log(
      `[Recovery] Found ${jobIds.length} stuck jobs. Re-queueing them.`
    );
    await supabase.from("jobs").update({ status: "queued" }).in("id", jobIds);
    jobQueue.push(...jobIds);
    processQueue();
  } else {
    console.log("[Recovery] No stuck jobs found.");
  }
};

io.on("connection", (socket) => {
console.log(`[${new Date().toLocaleString()}] [Connection] Client connected: ${socket.id}`);
  socket.on("start_scrape_job", async (payload) => {
    const { authToken, ...scrapeParams } = payload;
    if (!authToken)
      return socket.emit("job_error", { error: "Authentication required." });
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(authToken);
    if (error || !user)
      return socket.emit("job_error", { error: "Authentication failed." });
    try {
      const { data: newJob, error: insertError } = await supabase
        .from("jobs")
        .insert({
          user_id: user.id,
          parameters: scrapeParams,
          logs: [`Job created by ${user.email}`],
        })
        .select()
        .single();
      if (insertError) throw insertError;
      socket.emit("job_created", { jobId: newJob.id });
      jobQueue.push(newJob.id);
      processQueue();
    } catch (dbError) {
      console.error("Error creating job:", dbError);
      socket.emit("job_error", {
        error: "Failed to create job in the database.",
      });
    }
  });
  socket.on("subscribe_to_job", async ({ jobId, authToken }) => {
    if (!authToken) return;
    const {
      data: { user },
    } = await supabase.auth.getUser(authToken);
    if (!user) return;
    const { data: job, error } = await supabase
      .from("jobs")
      .select("id, user_id")
      .eq("id", jobId)
      .single();
    if (job && job.user_id === user.id) {
      socket.join(jobId);
      console.log(`User ${user.email} subscribed to updates for job ${jobId}`);
      const { data: fullJobState } = await supabase
        .from("jobs")
        .select("*")
        .eq("id", jobId)
        .single();
      socket.emit("job_state", fullJobState);
    } else {
      console.warn(
        `SECURITY: User ${user.email} failed to subscribe to job ${jobId}`
      );
    }
  });
 socket.on("disconnect", () => {
    console.log(`[${new Date().toLocaleString()}] [Disconnection] Client disconnected: ${socket.id}`);
  });
});

app.use(cors());
app.use(express.json());
app.get("/api/config", (req, res) =>
  res.json({ googleMapsApiKey: GOOGLE_MAPS_API_KEY })
);

// --- NEW EXCLUSION API ENDPOINTS ---
// GET endpoint to fetch the user's exclusion list
app.get("/api/exclusions", async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Authentication required.' });
        }
        const token = authHeader.split(' ')[1];

        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) {
            return res.status(401).json({ error: 'Authentication failed.' });
        }

        const { data, error } = await supabase
            .from('user_exclusions')
            .select('excluded_retailers')
            .eq('user_id', user.id)
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 means no rows found, which is fine
            throw error;
        }

        res.json({ exclusionList: data?.excluded_retailers || [] });
    } catch (dbError) {
        console.error("Error fetching exclusion list:", dbError);
        res.status(500).json({ error: 'Failed to fetch exclusion list.' });
    }
});

// POST endpoint to save the user's exclusion list
app.post("/api/exclusions", async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Authentication required.' });
        }
        const token = authHeader.split(' ')[1];

        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) {
            return res.status(401).json({ error: 'Authentication failed.' });
        }
        
        const { exclusionList } = req.body;
        if (!Array.isArray(exclusionList)) {
            return res.status(400).json({ error: 'Invalid data format.' });
        }

        const { error } = await supabase
            .from('user_exclusions')
            .upsert({
                user_id: user.id,
                excluded_retailers: exclusionList
            }, { onConflict: 'user_id' });

        if (error) throw error;

        res.status(200).json({ success: true, message: 'Exclusion list saved.' });
    } catch (dbError) {
        console.error("Error saving exclusion list:", dbError);
        res.status(500).json({ error: 'Failed to save exclusion list.' });
    }
});

// --- THIS MUST BE AFTER ALL API ROUTES ---
const containerPublicPath = path.join(__dirname, "..", "public");
app.use(express.static(containerPublicPath, { index: false }));
app.get(/(.*)/, (req, res) => {
  const indexPath = path.join(containerPublicPath, "index.html");
  fs.readFile(indexPath, "utf8", (err, data) => {
    if (err) {
      console.error("Error reading index.html:", err);
      return res.status(500).send("Error loading the application.");
    }
    res.send(data.replace(PLACEHOLDER_KEY, GOOGLE_MAPS_API_KEY));
  });
});

const cleanupTempDirs = () => {
    const tempDirPath = path.join(__dirname, "puppeteer_temp");
    if (fs.existsSync(tempDirPath)) {
        console.log("[System] Cleaning up old Puppeteer temporary directories...");
        fs.rm(tempDirPath, { recursive: true, force: true }, (err) => {
            if (err) {
                console.error("[System] Error cleaning up temp directories:", err);
            } else {
                console.log("[System] Temporary directory cleanup complete.");
            }
        });
    }
};

server.listen(PORT, () => {
  console.log(`Scraping server running on http://localhost:${PORT}`);
  recoverStuckJobs();
});

const countryBoundingBoxes = {
  australia: { minLat: -44.0, maxLat: -10.0, minLng: 112.0, maxLng: 154.0 },
  philippines: { minLat: 4.0, maxLat: 21.0, minLng: 116.0, maxLng: 127.0 },
  "new zealand": { minLat: -47.3, maxLat: -34.4, minLng: 166.4, maxLng: 178.6 },
  "united states": {
    minLat: 24.4,
    maxLat: 49.4,
    minLng: -125.0,
    maxLng: -66.9,
  },
  "united kingdom": { minLat: 49.9, maxLat: 58.7, minLng: -7.5, maxLng: 1.8 },
  canada: { minLat: 41.6, maxLat: 83.1, minLng: -141.0, maxLng: -52.6 },
};
function isUrlInBoundingBox(url, box) {
  const match = url.match(
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)|@(-?\d+\.\d+),(-?\d+\.\d+)/
  );
  if (!match) return false;
  const lat = parseFloat(match[1] || match[3]);
  const lng = parseFloat(match[2] || match[4]);
  return (
    lat >= box.minLat &&
    lat <= box.maxLat &&
    lng >= box.minLng &&
    lng <= box.maxLng
  );
}
function normalizeStringForKey(str = "") {
  if (!str) return "";
  return str
    .toLowerCase()
    .replace(/,.*$/, "")
    .replace(/\b(cafe|pty|ltd|inc|llc|co|the)\b/g, "")
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()']/g, "")
    .replace(/\s+/g, "");
}
function normalizePhoneNumber(phoneStr = "") {
  if (!phoneStr) return "";
  return String(phoneStr).replace(/\D/g, "");
}
function normalizeAddress(addressStr = "") {
  if (!addressStr) return "";
  return String(addressStr).toLowerCase().trim().replace(/\s+/g, " ");
}

const isValidEmail = (email) => {
    return email && email.includes('@') && email.includes('.');
};

const getCleanBusinessName = (name) => {
    if (!name) return '';
    let cleaned = name.toLowerCase()
        .replace(/\s(pizza|fast food|burger|cafe|restaurant|store|ltd|pty|inc|co)\.?\s*$/g, '')
        .replace(/\s\s+/g, ' ')
        .trim();
    return cleaned.substring(0, 15); 
};

function deduplicateBusinesses(businesses) {
    if (!businesses || businesses.length === 0) {
        return { uniqueBusinesses: [], duplicates: [] };
    }

    const getSocialIdentifier = (url) => {
        if (!url) return null;
        try {
            const path = new URL(url).pathname;
            const parts = path.split('/').filter(p => p && !['p', 'pages', 'groups', 'company'].includes(p.toLowerCase()));
            return parts.length > 0 ? parts[0].toLowerCase() : null;
        } catch (e) { return null; }
    };

    const groupedBusinesses = new Map();

    for (const business of businesses) {
        const facebookId = getSocialIdentifier(business.FacebookURL);
        const instagramId = getSocialIdentifier(business.InstagramURL);
        const cleanName = getCleanBusinessName(business.BusinessName);
        
        let signature = null;

        if (facebookId && instagramId) {
            signature = `SOCIAL_FB:${facebookId}_IG:${instagramId}`;
        } 
        else if (cleanName) {
            signature = `NAME:${cleanName}`;
        }
        else {
            signature = `UNIQUE_${business.GoogleMapsURL || Math.random()}`;
        }

        if (!groupedBusinesses.has(signature)) {
            groupedBusinesses.set(signature, []);
        }
        groupedBusinesses.get(signature).push(business);
    }

    const uniqueBusinesses = [];
    const duplicates = [];

    for (const group of groupedBusinesses.values()) {
        if (group.length === 1) {
            uniqueBusinesses.push(group[0]);
        } else {
            let bestEntry = group[0]; 
            
            const entryWithValidEmail = group.find(b => isValidEmail(b.Email1) || isValidEmail(b.Email2) || isValidEmail(b.Email3));
            
            const entryWithPhone = group.find(b => b.Phone && b.Phone.trim() !== '');

            if (entryWithValidEmail) {
                bestEntry = entryWithValidEmail;
            } else if (entryWithPhone) {
                bestEntry = entryWithPhone;
            } 

            const bestEntryIndex = group.indexOf(bestEntry);
            
            uniqueBusinesses.push(bestEntry);

            for (let i = 0; i < group.length; i++) {
                if (i !== bestEntryIndex) {
                    duplicates.push(group[i]);
                }
            }
        }
    }

    return { uniqueBusinesses, duplicates };
}

function degToRad(degrees) {
  return (degrees * Math.PI) / 180;
}
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const x = degToRad(lon2 - lon1) * Math.cos(degToRad(lat1 + lat2) / 2);
  const y = degToRad(lat2 - lat1);
  return Math.sqrt(x * x + y * y) * R;
}
async function getSearchQueriesForRadius(
  anchorPoint,
  radiusKm,
  country,
  apiKey,
  jobId
) {
  const searchQueries = [];
  let centerLat, centerLng;
  if (anchorPoint.includes(",")) {
    const parts = anchorPoint.split(",");
    centerLat = parseFloat(parts[0]);
    centerLng = parseFloat(parts[1]);
    await addLog(
      jobId,
      `   -> Using direct coordinates for anchor point: ${centerLat.toFixed(
        4
      )}, ${centerLng.toFixed(4)}`
    );
  } else {
    await addLog(jobId, `   -> Geocoding anchor point: "${anchorPoint}"`);
    try {
      const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
        `${anchorPoint}, ${country}`
      )}&key=${apiKey}`;
      const response = await axios.get(geocodeUrl);
      if (response.data.status !== "OK") {
        await addLog(
          jobId,
          `   -> Geocoding failed for anchor point: ${response.data.status}`,
          "error"
        );
        return [];
      }
      const location = response.data.results[0].geometry.location;
      centerLat = location.lat;
      centerLng = location.lng;
      await addLog(
        jobId,
        `   -> Anchor point located at: ${centerLat.toFixed(
          4
        )}, ${centerLng.toFixed(4)}`
      );
    } catch (error) {
      await addLog(
        jobId,
        `   -> Geocoding API call failed: ${error.message}`,
        "error"
      );
      return [];
    }
  }
  const GRID_SIZE = Math.max(3, Math.ceil(radiusKm / 2));
  await addLog(
    jobId,
    `   -> Generating a ${GRID_SIZE}x${GRID_SIZE} grid to cover the ${radiusKm}km radius.`
  );
  const latOffset = radiusKm / 111.0;
  const lngOffset = radiusKm / (111.0 * Math.cos(degToRad(centerLat)));
  const minLat = centerLat - latOffset;
  const maxLat = centerLat + latOffset;
  const minLng = centerLng - lngOffset;
  const maxLng = centerLng + lngOffset;
  for (let i = 0; i < GRID_SIZE; i++) {
    for (let j = 0; j < GRID_SIZE; j++) {
      const pointLat = minLat + (maxLat - minLat) * (i / (GRID_SIZE - 1));
      const pointLng = minLng + (maxLng - minLng) * (j / (GRID_SIZE - 1));
      if (
        calculateDistance(centerLat, centerLng, pointLat, pointLng) <=
        radiusKm * 1.05
      ) {
        searchQueries.push(
          `near ${pointLat.toFixed(6)},${pointLng.toFixed(6)}`
        );
      }
    }
  }
  await addLog(
    jobId,
    `   -> Generated ${searchQueries.length} valid search points within the radius.`
  );
  return searchQueries;
}
async function getSearchQueriesForLocation(
  searchQuery,
  areaQuery,
  country,
  jobId,
  isIndividualSearch = false
) {
  if (isIndividualSearch) {
    await addLog(
      jobId,
      `   -> Specific name search detected. Forcing single, broad area search.`
    );
    return [searchQuery];
  }
  await addLog(jobId, `   -> Geocoding "${areaQuery}, ${country}"...`);
  if (/^\d{4,}$/.test(areaQuery.trim())) {
    await addLog(
      jobId,
      `   -> Postcode search detected. Forcing single search.`
    );
    return [searchQuery];
  }
  try {
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      `${areaQuery}, ${country}`
    )}&key=${GOOGLE_MAPS_API_KEY}`;
    const response = await axios.get(geocodeUrl);
    if (response.data.status !== "OK") {
      await addLog(
        jobId,
        `   -> Geocoding failed: ${response.data.status}. Using single search.`,
        "error"
      );
      return [searchQuery];
    }
    const { geometry } = response.data.results[0];
    if (
      geometry.location_type === "ROOFTOP" ||
      geometry.viewport.northeast.lat === geometry.viewport.southwest.lat
    )
      return [searchQuery];
    const lat_dist =
      geometry.viewport.northeast.lat - geometry.viewport.southwest.lat;
    const lng_dist =
      geometry.viewport.northeast.lng - geometry.viewport.southwest.lng;
    if (Math.sqrt(lat_dist * lat_dist + lng_dist * lng_dist) < 0.2)
      return [searchQuery];
    const GRID_SIZE = 5,
      searchQueries = [];
    const categoryPart = searchQuery.split(" in ")[0];
    await addLog(
      jobId,
      `   -> Location is large. Generating ${GRID_SIZE}x${GRID_SIZE} search grid.`
    );
    for (let i = 0; i < GRID_SIZE; i++) {
      for (let j = 0; j < GRID_SIZE; j++) {
        const point_lat =
          geometry.viewport.southwest.lat + lat_dist * (i / (GRID_SIZE - 1));
        const point_lng =
          geometry.viewport.southwest.lng + lng_dist * (j / (GRID_SIZE - 1));
        searchQueries.push(
          `${categoryPart} near ${point_lat.toFixed(6)},${point_lng.toFixed(6)}`
        );
      }
    }
    return searchQueries;
  } catch (error) {
    await addLog(
      jobId,
      `   -> Geocoding API call failed: ${error.message}. Defaulting to single search.`,
      "error"
    );
    return [searchQuery];
  }
}
async function collectGoogleMapsUrlsContinuously(
  page,
  searchQuery,
  jobId,
  discoveredUrlSet,
  country
) {
  try {
    const countryNameToCode = {
      australia: "AU",
      "new zealand": "NZ",
      "united states": "US",
      "united kingdom": "GB",
      canada: "CA",
      philippines: "PH",
    };
    const countryCode = countryNameToCode[country.toLowerCase()];
    const countryParam = countryCode ? `?cr=country${countryCode}` : "";
    let searchUrl;
    if (searchQuery.includes(" near ")) {
      const parts = searchQuery.split(" near ");
      const searchFor = parts[0].split(",")[0].trim();
      searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(
        searchFor
      )}/@${parts[1]},12z${countryParam}`;
    } else {
      searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(
        searchQuery
      )}${countryParam}`;
    }
    await addLog(jobId, `   -> Navigating to: ${searchQuery}`);
    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    const noResultsFound = await page.evaluate(
      () =>
        !!Array.from(document.querySelectorAll("div")).find((el) =>
          el.innerText.includes("Google Maps can't find")
        )
    );
    if (noResultsFound) {
      await addLog(
        jobId,
        `   -> INFO: No results found on Google Maps for "${searchQuery}". Skipping this area.`
      );
      return;
    }
    try {
      await page.click('form[action^="https://consent.google.com"] button', {
        timeout: 10000,
      });
      await addLog(jobId, "   -> Accepted Google consent dialog.");
    } catch (e) {
      await addLog(jobId, "   -> No Google consent dialog found, proceeding.");
    }
    const feedSelector = 'div[role="feed"]';
    try {
      await page.waitForSelector(feedSelector, { timeout: 15000 });
      await addLog(jobId, `   -> Found results list. Scraping all items...`);
      const boundingBox = countryBoundingBoxes[country.toLowerCase()];
      if (boundingBox)
        await addLog(
          jobId,
          `   -> Filtering results to stay within ${country} borders.`
        );
      let consecutiveNoProgressAttempts = 0;
      const MAX_NO_PROGRESS = 5;
      while (consecutiveNoProgressAttempts < MAX_NO_PROGRESS) {
        const previousSize = discoveredUrlSet.size;
        const visibleLinks = await page.$$eval(
          'a[href*="/maps/place/"]',
          (links) =>
            links.map((link) => ({
              href: link.href,
              text: link.innerText || "",
            }))
        );
        visibleLinks.forEach((link) => {
          if (boundingBox ? isUrlInBoundingBox(link.href, boundingBox) : true) {
            discoveredUrlSet.add(link.href);
          }
        });
        if (discoveredUrlSet.size > previousSize)
          consecutiveNoProgressAttempts = 0;
        else consecutiveNoProgressAttempts++;
        await page.evaluate(
          (selector) => document.querySelector(selector)?.scrollTo(0, 999999),
          feedSelector
        );
        await new Promise((r) => setTimeout(r, 2000));
      }
    } catch (error) {
      await addLog(
        jobId,
        `   -> No results list found. Checking for direct navigation...`
      );
      const currentUrl = page.url();
      if (currentUrl.includes("/maps/place/")) {
        await addLog(
          jobId,
          `   -> Direct navigation detected. Capturing single URL.`
        );
        discoveredUrlSet.add(currentUrl);
      } else {
        await addLog(
          jobId,
          `   -> No valid results list or direct place page found for this query.`,
          "error"
        );
      }
    }
  } catch (error) {
    await addLog(
      jobId,
      `CRITICAL ERROR during URL collection for "${searchQuery}": ${
        error.message.split("\n")[0]
      }`,
      "error"
    );
  }
}
async function scrapeGoogleMapsDetails(page, url, jobId, country) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector("h1", { timeout: 60000 });
  return page.evaluate((countryCode) => {
    const cleanText = (text) =>
      text
        ? String(text)
            .replace(/[\u200B-\u200D\uFEFF\u0000-\u001F\u007F-\u009F]/g, "")
            .replace(/^[^a-zA-Z0-9G]+/, "")
            .replace(/\s+/g, " ")
            .trim()
        : "";
    const cleanPhoneNumber = (num, country) => {
      if (!num) return "";
      let digits = String(num).replace(/\D/g, "");
      if (country?.toLowerCase() === "australia") {
        if (digits.startsWith("0")) digits = "61" + digits.substring(1);
        else if (!digits.startsWith("61") && digits.length >= 8)
          digits = "61" + digits;
      }
      return digits;
    };
    const categorySelectors = [
      'button[data-item-id="category"]',
      'button[jsaction*="pane.rating.category"]',
      'a[jsaction*="pane.rating.category"]',
      '[jsaction*="category"]',
    ];
    let categoryText = "";
    for (const selector of categorySelectors) {
      const element = document.querySelector(selector);
      if (element) {
        categoryText = element.innerText;
        break;
      }
    }
    const reviewElement = document.querySelector("div.F7nice");
    let starRating = "",
      reviewCount = "";
    if (reviewElement) {
      starRating = parseFloat(reviewElement.innerText.split(" ")[0]) || "";
      const reviewCountMatch = reviewElement.innerText.match(/\(([\d,]+)\)/);
      if (reviewCountMatch && reviewCountMatch[1])
        reviewCount = reviewCountMatch[1].replace(/,/g, "");
    }
    const data = {
      BusinessName: cleanText(document.querySelector("h1")?.innerText),
      ScrapedCategory: cleanText(categoryText),
      StreetAddress: cleanText(
        document.querySelector('button[data-item-id="address"]')?.innerText
      ),
      Website:
        document.querySelector('a[data-item-id="authority"]')?.href || "",
      Phone: cleanPhoneNumber(
        document.querySelector('button[data-item-id*="phone"]')?.innerText,
        countryCode
      ),
      GoogleMapsURL: window.location.href,
      Suburb: "",
      StarRating: String(starRating),
      ReviewCount: reviewCount,
    };
    if (data.StreetAddress) {
      const parts = data.StreetAddress.split(",");
      if (parts.length >= 3)
        data.Suburb = parts[parts.length - 2]
          .trim()
          .replace(/\s[A-Z]{2,3}\s\d{4,}/, "")
          .trim();
      else if (parts.length === 2) data.Suburb = parts[0].trim();
    }
    return data;
  }, country);
}
async function scrapePageContent(page) {
  const ownerTitleKeywords = [
    "owner",
    "founder",
    "director",
    "principal",
    "proprietor",
    "ceo",
    "manager",
  ];
  const pageText = await page.evaluate(() => document.body.innerText);
  const links = await page.$$eval("a", (as) => as.map((a) => a.href));
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const mailtoEmails = links
    .filter((href) => href.startsWith("mailto:"))
    .map((href) => href.replace("mailto:", "").split("?")[0]);
  const textEmails = pageText.match(emailRegex) || [];
  const emails = [...new Set([...mailtoEmails, ...textEmails])];
  let ownerName = "";
  const textLines = pageText.split(/[\n\r]+/).map((line) => line.trim());
  for (const line of textLines) {
    for (const title of ownerTitleKeywords) {
      if (line.toLowerCase().includes(title)) {
        let pName = line
          .split(new RegExp(title, "i"))[0]
          .trim()
          .replace(/,$/, "");
        const words = pName.split(" ").filter(Boolean);
        if (words.length >= 2 && words.length <= 4) {
          ownerName = words
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ");
          break;
        }
      }
    }
    if (ownerName) break;
  }
  return { emails, ownerName };
}
async function scrapeWebsiteForGoldData(page, websiteUrl, jobId) {
  const data = {
    OwnerName: "",
    InstagramURL: "",
    FacebookURL: "",
    Email1: "",
    Email2: "",
    Email3: "",
  };
  try {
    await page.goto(websiteUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    const initialLinks = await page.$$eval("a", (as) =>
      as.map((a) => ({ href: a.href, text: a.innerText }))
    );
    data.InstagramURL =
      initialLinks.find((l) => l.href.includes("instagram.com"))?.href || "";
    data.FacebookURL =
      initialLinks.find((l) => l.href.includes("facebook.com"))?.href || "";
    const allFoundEmails = new Set();
    let finalOwnerName = "";
    const landingPageData = await scrapePageContent(page);
    landingPageData.emails.forEach((e) => allFoundEmails.add(e.toLowerCase()));
    if (landingPageData.ownerName) finalOwnerName = landingPageData.ownerName;
    const pageKeywords = [
      "contact",
      "about",
      "team",
      "meet",
      "staff",
      "our-people",
    ];
    const keyPageLinks = initialLinks
      .filter((link) =>
        pageKeywords.some(
          (keyword) =>
            link.href.toLowerCase().includes(keyword) ||
            link.text.toLowerCase().includes(keyword)
        )
      )
      .map((link) => link.href);
    const uniqueKeyPages = [...new Set(keyPageLinks)].slice(0, 3);
    for (const linkUrl of uniqueKeyPages) {
      try {
        await page.goto(linkUrl, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
        const subsequentPageData = await scrapePageContent(page);
        subsequentPageData.emails.forEach((e) =>
          allFoundEmails.add(e.toLowerCase())
        );
        if (subsequentPageData.ownerName)
          finalOwnerName = subsequentPageData.ownerName;
      } catch (e) {}
    }
    data.OwnerName = finalOwnerName;
    const emailsArray = Array.from(allFoundEmails);
    if (emailsArray.length > 0) {
      const genericPrefixes = [
        "info@",
        "contact@",
        "support@",
        "sales@",
        "admin@",
        "hello@",
        "enquiries@",
      ];
      const nameMatch = [],
        personal = [],
        generic = [];
      if (finalOwnerName) {
        const fName = finalOwnerName.toLowerCase().split(" ")[0];
        emailsArray.forEach((e) => {
          if (e.toLowerCase().includes(fName)) nameMatch.push(e);
        });
      }
      emailsArray.forEach((e) => {
        if (!nameMatch.includes(e)) {
          if (genericPrefixes.some((p) => e.toLowerCase().startsWith(p)))
            generic.push(e);
          else personal.push(e);
        }
      });
      const ranked = [...new Set([...nameMatch, ...personal, ...generic])];
      data.Email1 = ranked[0] || "";
      data.Email2 = ranked[1] || "";
      data.Email3 = ranked[2] || "";
    }
  } catch (error) {
    await addLog(
      jobId,
      `   -> Minor error scraping website ${websiteUrl}: ${error.message}`
    );
  }
  return data;
}
function promiseWithTimeout(promise, ms) {
  let timeout = new Promise((_, reject) => {
    let id = setTimeout(() => {
      clearTimeout(id);
      reject(new Error(`Promise timed out after ${ms} ms`));
    }, ms);
  });
  return Promise.race([promise, timeout]);
}

async function promiseWithRetry(task, maxRetries = 3, delay = 2000, jobId, url) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await promiseWithTimeout(task(), 120000); 
        } catch (error) {
            const isLastAttempt = i === maxRetries - 1;
            if (isLastAttempt) {
                throw error;
            }
            await addLog(jobId, `   -> Task for ${url} failed (Attempt ${i + 1}/${maxRetries}): ${error.message}. Retrying in ${delay / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}