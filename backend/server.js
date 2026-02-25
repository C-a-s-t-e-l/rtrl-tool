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

const { findBusinessOwnerWithAI } = require("./aiService");
const { sendResultsByEmail } = require("./emailService");
const { generateFileData, generateFilename } = require("./fileGenerator");
const { verifyEmail, getActiveKey } = require("./verifierService");
const XLSX = require('xlsx');
const JSZip = require('jszip');

puppeteer.use(StealthPlugin());

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://rtrl-prospector.vercel.app", 
  process.env.FRONTEND_URL                
].filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log(`[CORS] Request from unknown origin: ${origin}. Allowing temporarily for compatibility.`);
      callback(null, true);
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "ngrok-skip-browser-warning"],
  credentials: true
};

app.use(cors(corsOptions));

const io = new Server(server, {
  cors: corsOptions,
  transports: ['websocket', 'polling'],
  pingInterval: 25000, 
  pingTimeout: 240000, 
});

const PORT = process.env.PORT || 3000;
const GOOGLE_MAPS_API_KEY = process.env.MAPS_API_KEY;

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

const broadcastQueuePositions = () => {
  const usersInQueue = [...new Set(jobQueue.map(job => job.userId))];

  usersInQueue.forEach(userId => {
    const userJobs = jobQueue.map((job, index) => ({
      id: job.id,
      globalPosition: index + 1,
      title: job.title || "Waiting for slot...",
      isMine: job.userId === userId
    })).filter(item => item.isMine);

    if (userJobs.length > 0) {
      io.to(userId).emit("user_queue_update", userJobs);
    }
  });
};

const processQueue = async () => {
  if (isWorkerRunning || jobQueue.length === 0) return;
  
  isWorkerRunning = true;
  const nextJob = jobQueue[0]; // Look at the first item
  const jobId = nextJob.id;

  console.log(`[Worker] Starting job ${jobId}`);
  
  try {
    // Remove it from the queue array BEFORE starting the scrape 
    // so the waiting list UI updates instantly
    jobQueue.shift(); 
    broadcastQueuePositions();

    await runScrapeJob(jobId);
  } catch (error) {
    console.error(`[Worker] Error in job ${jobId}:`, error);
    await updateJobStatus(jobId, "failed");
  } finally {
    isWorkerRunning = false;
    // Always broadcast after a job cycle to keep UI in sync
    broadcastQueuePositions();
    process.nextTick(processQueue);
  }
};

const updateJobStatus = async (jobId, status) => {
  await supabase.from("jobs").update({ status }).eq("id", jobId);
  
  // If a job is no longer queued, ensure it's removed from the memory queue
  if (status !== 'queued') {
      jobQueue = jobQueue.filter(j => j.id !== jobId);
  }

  io.to(jobId).emit("job_update", { id: jobId, status });
  
  // Immediately tell all users to refresh their waiting lists
  broadcastQueuePositions();
};

const addLog = async (jobId, message) => {
  await supabase.rpc("append_log", { job_id: jobId, new_log: message });
  io.to(jobId).emit("job_log", message);
};

const saveQueues = {}; 

const appendJobResult = async (jobId, newResult) => {
  if (!saveQueues[jobId]) {
      saveQueues[jobId] = Promise.resolve();
  }

  saveQueues[jobId] = saveQueues[jobId].then(async () => {
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
        await addLog(jobId, `[Warning] Database save glitch. Item shown in UI but might not persist.`);
      }
  }).catch(err => {
      console.error("Critical error in save queue:", err);
  });

  return saveQueues[jobId];
};

const runScrapeJob = async (jobId) => {
  await updateJobStatus(jobId, "running");
  const { data: job, error: fetchError } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (fetchError || !job) {
    console.error(`[Job: ${jobId}] Could not fetch job details.`, fetchError);
    await updateJobStatus(jobId, "failed");
    return;
  }

    const { data: settings } = await supabase
    .from('system_settings')
    .select('is_paused')
    .eq('id', 1)
    .single();

  if (settings && settings.is_paused) {
    await addLog(jobId, "[SYSTEM] Research is currently PAUSED by Admin. Job cancelled.");
    await updateJobStatus(jobId, "failed");
    return;
  }

    const { data: userProfile } = await supabase
    .from('profiles')
    .select('usage_today, daily_limit')
    .eq('id', job.user_id)
    .single();

  if (userProfile && userProfile.usage_today >= userProfile.daily_limit) {
    await addLog(jobId, `[QUOTA ERROR] Daily limit reached (${userProfile.usage_today}/${userProfile.daily_limit}). Contact Admin to increase credits.`);
    await updateJobStatus(jobId, "failed");
    return;
  }

  const { parameters } = job;
  const {
    categoriesToLoop, location, postalCode, country, count, businessNames, anchorPoint, radiusKm, userEmail, searchParamsForEmail, exclusionList, useAiEnrichment,
    clientLocalDate 
  } = parameters;

  let filterCenterLat = null, filterCenterLng = null;
  if (radiusKm && anchorPoint) {
    try {
      if (anchorPoint.includes(",")) {
        const parts = anchorPoint.split(",");
        filterCenterLat = parseFloat(parts[0]); filterCenterLng = parseFloat(parts[1]);
      } else {
        const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(`${anchorPoint}, ${country}`)}&key=${GOOGLE_MAPS_API_KEY}`;
        const response = await axios.get(geocodeUrl);
        if (response.data.status === "OK") {
          const loc = response.data.results[0].geometry.location;
          filterCenterLat = loc.lat; filterCenterLng = loc.lng;
        }
      }
    } catch (e) { console.error("Filter error", e); }
  }

  let browser = null;
  let allProcessedBusinesses = job.results || [];
  const masterUrlMap = new Map((job.collected_urls || []).map(item => [item.url, item.category]));

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
      return await puppeteer.launch({ headless: true, args: [...puppeteerArgs, `--user-data-dir=${userDataDir}`], protocolTimeout: 300000, userDataDir: userDataDir });
    };

    const isIndividualSearch = businessNames && businessNames.length > 0;
    const searchItems = isIndividualSearch ? businessNames : (categoriesToLoop && categoriesToLoop.length > 0 ? categoriesToLoop : []);
    const finalCount = businessNames && businessNames.length > 0 ? -1 : parameters.count || -1;

    if (masterUrlMap.size === 0 || allProcessedBusinesses.length < finalCount || finalCount === -1) {
    for (const item of searchItems) {
        try { 
            browser = await launchBrowser(`[Phase 1] Searching Maps for: "${item}"`);
            let collectionPage = await browser.newPage();
            
            let locationQueries = [];
            if (anchorPoint && radiusKm) locationQueries = await getSearchQueriesForRadius(anchorPoint, radiusKm, country, GOOGLE_MAPS_API_KEY, jobId);
            else {
                let searchAreas = postalCode && postalCode.length > 0 ? postalCode : [location];
                for (const areaQuery of searchAreas) {
                    const base = isIndividualSearch ? `${item}, ${areaQuery}, ${country}` : `${item} in ${areaQuery}, ${country}`;
                    locationQueries.push(...await getSearchQueriesForLocation(base, areaQuery, country, jobId, isIndividualSearch));
                }
            }

            for (const query of locationQueries) {
                const finalQ = isIndividualSearch || query.startsWith("near ") ? `${item} ${query}` : query;
                const discovered = new Set();
                await collectGoogleMapsUrlsContinuously(collectionPage, finalQ, jobId, discovered, country);
                
                let initialSize = masterUrlMap.size;
                discovered.forEach(url => {
                if (!masterUrlMap.has(url)) {
                    if (radiusKm && filterCenterLat) {
                        const c = extractCoordinatesFromUrl(url);
                        if (c && calculateDistance(filterCenterLat, filterCenterLng, c.lat, c.lng) > (parseFloat(radiusKm) + 0.2)) return;
                    }
                    masterUrlMap.set(url, item);
                }
                });

                const newUrlsFound = masterUrlMap.size - initialSize;
                if (newUrlsFound > 0) {
                    await supabase.from("jobs").update({ 
                        collected_urls: Array.from(masterUrlMap, ([url, cat]) => ({ url, category: cat })) 
                    }).eq("id", jobId);
                }
                
                io.to(jobId).emit("progress_update", { 
                    phase: 'discovery', 
                    discovered: masterUrlMap.size, 
                    processed: 0, 
                    added: allProcessedBusinesses.length 
                });
            }
        } catch (itemError) {
            await addLog(jobId, `[Warning] Search for "${item}" encountered an error: ${itemError.message}`);
        } finally {
            if (browser) {
                await browser.close();
                browser = null; 
            }
        }
    }
        await supabase.from("jobs").update({ collected_urls: Array.from(masterUrlMap, ([url, cat]) => ({ url, category: cat })) }).eq("id", jobId);
    }

    await addLog(jobId, `--- Starting Data Extraction & AI Analysis ---`);
    console.log(`[Worker] Job ${jobId} picked up. Using Email Verifier Key: ${getActiveKey()}`);
    browser = await launchBrowser("[System] Processing businesses...");

    const urlsToProcess = Array.from(masterUrlMap, ([url, cat]) => ({ url, category: cat }))
        .filter(item => !allProcessedBusinesses.some(b => b.GoogleMapsURL === item.url));

    const CONCURRENCY = 1; 
    let processedInSession = 0;

    for (let i = 0; i < urlsToProcess.length; i += CONCURRENCY) {
        if (finalCount !== -1 && allProcessedBusinesses.length >= finalCount) break;

        const batch = urlsToProcess.slice(i, i + CONCURRENCY);
        
        const promises = batch.map(async (processItem) => {
            let detailPage = null;
            try {
                const task = async () => {
                    detailPage = await browser.newPage();
                    await detailPage.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36");

                    let googleData = await scrapeGoogleMapsDetails(detailPage, processItem.url, jobId, country);
                    if (!googleData || !googleData.BusinessName) return null;

                    let websiteData = { foundEmails: [], foundPhones: [], OwnerName: "", InstagramURL: "", FacebookURL: "", rawText: "" };
                    if (googleData.Website) {
                        websiteData = await scrapeWebsiteForGoldData(detailPage, googleData.Website);
                    }

                    let aiResult = { ownerName: "", aiEmail: "", aiPhone: "" };
                    if (useAiEnrichment !== false) {
                        aiResult = await findBusinessOwnerWithAI(googleData.BusinessName, googleData.Suburb || country, googleData.Website, jobId);
                    }

                    const emailBucket = [...websiteData.foundEmails, aiResult.aiEmail]
                        .filter(e => e && e.includes('@') && !e.includes('wix') && !e.includes('example') && !e.includes('sentry'))
                        .map(e => e.toLowerCase().trim());
                    const uniqueEmails = Array.from(new Set(emailBucket));

                    const phoneBucket = [
                        aiResult.aiPhone,           
                        ...websiteData.foundPhones, 
                        googleData.Phone            
                    ].map(normalizePhoneTo61).filter(Boolean);

                    const uniquePhones = Array.from(new Set(phoneBucket));
                    
                    const finalPhone = uniquePhones.find(p => p.startsWith('614')) || uniquePhones[0] || "";

                    let finalOwner = "Private Owner";
                    if (aiResult.ownerName && aiResult.ownerName !== "Private Owner") {
                        finalOwner = aiResult.ownerName;
                    } else if (websiteData.OwnerName) {
                        finalOwner = websiteData.OwnerName;
                    }

                    const res = { 
                        ...googleData, 
                        OwnerName: finalOwner,
                        Email1: uniqueEmails[0] || "",
                        Email2: uniqueEmails[1] || "",
                        Email3: uniqueEmails[2] || "",
                        Phone: finalPhone,
                        InstagramURL: websiteData.InstagramURL || googleData.InstagramURL || "",
                        FacebookURL: websiteData.FacebookURL || googleData.FacebookURL || "",
                        rawText: websiteData.rawText || googleData.BusinessName
                    };

                    if (res.Email1) {
                        const isDeliverable = await verifyEmail(res.Email1);
                        if (!isDeliverable) {
                            await addLog(jobId, `[Verifier] Removing: ${res.Email1}`);
                            res.Email1 = res.Email2; res.Email2 = res.Email3; res.Email3 = "";
                        }
                    }

                    res.Category = (processItem.category || "N/A").replace(/"/g, "");
                    return res;
                };

                return await promiseWithRetry(task, 2, 5000, jobId, processItem.url);

            } catch (err) {
                return null; 
            } finally {
                if (detailPage) await detailPage.close();
            }
        });

        const results = await Promise.all(promises);

        for (const businessData of results) {
            if (businessData) {
                if (exclusionList && exclusionList.length > 0) {
                    const normName = normalizeForExclusionCheck(businessData.BusinessName);
                    if (exclusionList.some(ex => normName.includes(normalizeForExclusionCheck(ex)))) continue;
                }

                allProcessedBusinesses.push(businessData);
                await appendJobResult(jobId, businessData);
                const { error: rpcError } = await supabase.rpc('increment_usage', { 
                    user_id_param: job.user_id,
                    client_local_date_param: clientLocalDate
                });

                if (rpcError) {
                    console.error(`[QUOTA ERROR] User: ${job.user_id} | Error: ${rpcError.message}`);
                } else {
                    console.log(`[QUOTA SUCCESS] Incremented usage for ${job.user_id}`);
                }
                
            }
        }

        const enrichedCount = allProcessedBusinesses.filter(b => 
            b.OwnerName && 
            b.OwnerName !== "Private Owner" && 
            b.OwnerName.trim() !== ""
        ).length;

        io.to(jobId).emit("progress_update", {
            phase: 'scraping', 
            processed: processedInSession,
            discovered: masterUrlMap.size,
            added: allProcessedBusinesses.length,
            target: finalCount,
            
            enriched: enrichedCount, 
            aiTarget: finalCount === -1 ? masterUrlMap.size : finalCount, 
            aiProcessed: allProcessedBusinesses.length 
        });
        
        processedInSession++;
    }

    if (browser) await browser.close();

    await addLog(jobId, `[System] Finalizing and sending emails...`);
    const { uniqueBusinesses, duplicates } = deduplicateBusinesses(allProcessedBusinesses);

    if (userEmail && uniqueBusinesses.length > 0) {
        const emailParams = { ...searchParamsForEmail, radiusKm: parameters.radiusKm };
        const emailStatus = await sendResultsByEmail(userEmail, uniqueBusinesses, emailParams, duplicates);
        await addLog(jobId, `[Email] ${emailStatus}`);
    }

    await updateJobStatus(jobId, "completed");

  } catch (error) {
    console.error(`[Job: ${jobId}] Critical error:`, error);
    await addLog(jobId, `[ERROR] Critical failure: ${error.message}`, "error");
    await updateJobStatus(jobId, "failed");
  } finally {
    if (browser) try { await browser.close(); } catch (e) { }
    cleanupTempDirs();
  }
};

const recoverStuckJobs = async () => {
  console.log(
    "[System] Checking for jobs that were running during a previous crash..."
  );
  
  await supabase.from("jobs").update({ status: "queued" }).eq("status", "running");

  const { data: queueList, error } = await supabase
    .from("jobs")
    .select("id, user_id, parameters")
    .eq("status", "queued")
    .order('created_at', { ascending: true });

  if (error) {
    console.error("[Recovery] Error fetching stuck jobs:", error);
    return;
  }
  
  if (queueList && queueList.length > 0) {
    console.log(
      `[Recovery] Found ${queueList.length} stuck jobs. Re-queueing them.`
    );
    jobQueue = queueList.map(j => {
        const p = j.parameters?.searchParamsForEmail || {};
        const category = p.customCategory || p.primaryCategory || "Search";
        const area = p.area || "Unknown Area";
        return { id: j.id, userId: j.user_id, title: `${category} in ${area}` };
    });
    processQueue();
  } else {
    console.log("[Recovery] No stuck jobs found.");
  }
};

io.on("connection", (socket) => {
  
  socket.on("authenticate_socket", async (authToken) => {
    if (!authToken) return;
    try {
      const { data: { user }, error } = await supabase.auth.getUser(authToken);
      if (user && !error) {
        socket.user = user; 
        socket.join(user.id);
        console.log(`[${new Date().toLocaleString()}] [Auth] Client authenticated: ${user.email} (ID: ${socket.id})`);
        
        broadcastQueuePositions();
      }
    } catch (e) {
      console.log(`[Auth] Failed to authenticate socket ${socket.id}`);
    }
  });

socket.on("start_scrape_job", async (payload) => {
    const { authToken, clientLocalDate, ...scrapeParams } = payload;
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
          parameters: { ...scrapeParams, clientLocalDate },
          status: 'queued',
          logs: [`Job created by ${user.email}`],
        })
        .select()
        .single();
      if (insertError) throw insertError;
      
      socket.emit("job_created", { jobId: newJob.id });
      
      const p = scrapeParams.searchParamsForEmail || {};
      const category = p.customCategory || p.primaryCategory || "Search";
      const area = p.area || "Unknown Area";

      jobQueue.push({ id: newJob.id, userId: user.id, title: `${category} in ${area}` });
      
      broadcastQueuePositions();
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
    const { data: { user } } = await supabase.auth.getUser(authToken);
    if (!user) return;

    const { data: job, error } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (job && job.user_id === user.id) {
      socket.join(jobId);
      console.log(`User ${user.email} subscribed to updates for job ${jobId}`);
      
      socket.emit("job_state", job);
    }
  });

 socket.on("disconnect", () => {
    const userIdentifier = socket.user ? socket.user.email : socket.id;
    console.log(`[${new Date().toLocaleString()}] [Disconnection] Client disconnected: ${userIdentifier}`);
  });
});

app.use(express.json());
app.get("/api/config", (req, res) =>
  res.json({ googleMapsApiKey: GOOGLE_MAPS_API_KEY })
);

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

        if (error && error.code !== 'PGRST116') { 
            throw error;
        }

        res.json({ exclusionList: data?.excluded_retailers || [] });
    } catch (dbError) {
        console.error("Error fetching exclusion list:", dbError);
        res.status(500).json({ error: 'Failed to fetch exclusion list.' });
    }
});

app.post("/api/admin/invite", async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader.split(' ')[1];
        
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) return res.status(401).json({ error: "Unauthorized" });

        const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
        if (profile.role !== 'admin') return res.status(403).json({ error: "Forbidden: Admins only" });

        const { email } = req.body;
        if (!email) return res.status(400).json({ error: "Email is required" });

        const { data: existingUser } = await supabase.from('profiles').select('id').eq('email', email).single();
        if (existingUser) {
            return res.status(400).json({ error: "User already exists in the system." });
        }

        const { data, error } = await supabase.auth.admin.inviteUserByEmail(email);
        
        if (error) {
            console.error("Invite Error:", error.message);
            return res.status(400).json({ error: error.message });
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error("Server Error:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.delete("/api/admin/users/:id", async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader.split(' ')[1];
        const targetUserId = req.params.id;

        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) return res.status(401).json({ error: "Unauthorized" });

        const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
        if (profile.role !== 'admin') return res.status(403).json({ error: "Forbidden" });

        if (user.id === targetUserId) {
            return res.status(400).json({ error: "You cannot delete your own account." });
        }

        const { error: deleteError } = await supabase.auth.admin.deleteUser(targetUserId);
        
        if (deleteError) {
            const { error: profileError } = await supabase.from('profiles').delete().eq('id', targetUserId);
            if (profileError) return res.status(400).json({ error: profileError.message });
        }

        res.json({ success: true });
    } catch (err) {
        console.error("Delete Error:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});


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

app.get("/api/postcode-lists", async (req, res) => {
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
            .from('postcode_lists')
            .select('id, list_name, postcodes')
            .eq('user_id', user.id)
            .order('list_name');

        if (error) throw error;
        res.json(data || []);
    } catch (dbError) {
        console.error("Error fetching postcode lists:", dbError);
        res.status(500).json({ error: 'Failed to fetch postcode lists.' });
    }
});

app.post("/api/postcode-lists", async (req, res) => {
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
        
        const { list_name, postcodes } = req.body;
        if (!list_name || !Array.isArray(postcodes) || postcodes.length === 0) {
            return res.status(400).json({ error: 'Invalid data: list name and postcodes are required.' });
        }

        const { data, error } = await supabase
            .from('postcode_lists')
            .insert({
                user_id: user.id,
                list_name: list_name,
                postcodes: postcodes
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') { 
                 return res.status(409).json({ error: 'A list with this name already exists.' });
            }
            throw error;
        }
        res.status(201).json(data);
    } catch (dbError) {
        console.error("Error saving postcode list:", dbError);
        res.status(500).json({ error: 'Failed to save postcode list.' });
    }
});

app.delete("/api/postcode-lists/:id", async (req, res) => {
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

        const { id } = req.params;
        const { error } = await supabase
            .from('postcode_lists')
            .delete()
            .eq('user_id', user.id) 
            .eq('id', id);

        if (error) throw error;
        res.status(200).json({ success: true, message: 'List deleted successfully.' });
    } catch (dbError) {
        console.error("Error deleting postcode list:", dbError);
        res.status(500).json({ error: 'Failed to delete postcode list.' });
    }
});

app.get("/api/jobs/:jobId/download/:fileType", async (req, res) => {
    try {
        const { jobId, fileType } = req.params;
        const token = req.query.authToken;

        if (!token) return res.status(401).json({ error: 'Authentication token required.' });
        
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) return res.status(401).json({ error: 'Authentication failed.' });
        
        const { data: job, error: jobError } = await supabase.from('jobs').select('results, parameters, user_id, created_at').eq('id', jobId).single();

        if (jobError || !job) return res.status(404).send('Job not found.');
        if (job.user_id !== user.id) return res.status(403).send('Access denied.');

        const rawData = job.results || [];
        const { uniqueBusinesses, duplicates } = deduplicateBusinesses(rawData);
        
        const searchParams = job.parameters.searchParamsForEmail || {};
        if (job.parameters.radiusKm) searchParams.radiusKm = job.parameters.radiusKm;

        const allFiles = await generateFileData(uniqueBusinesses, searchParams, duplicates, job.created_at);
        
        let buffer, filename, contentType;

        switch(fileType) {
            case 'full_xlsx':
                if (allFiles.full.data.length === 0) return res.status(404).send('No unique business data to generate this file.');
                const wsFull = XLSX.utils.json_to_sheet(allFiles.full.data);
                const wbFull = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wbFull, wsFull, "Business List (Unique)");
                buffer = XLSX.write(wbFull, { bookType: 'xlsx', type: 'buffer' });
                filename = allFiles.full.filename;
                contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
                break;
            
            case 'duplicates_xlsx':
                if (allFiles.duplicates.data.length === 0) return res.status(404).send('No duplicate business data found.');
                const wsDup = XLSX.utils.json_to_sheet(allFiles.duplicates.data);
                const wbDup = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wbDup, wsDup, "Duplicates List");
                buffer = XLSX.write(wbDup, { bookType: 'xlsx', type: 'buffer' });
                filename = allFiles.duplicates.filename;
                contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
                break;

            case 'sms_csv':
                if (allFiles.sms.data.length === 0) return res.status(404).send('No SMS-compatible data found.');
                const wsSms = XLSX.utils.json_to_sheet(allFiles.sms.data, { header: allFiles.sms.headers });
                const wbSms = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wbSms, wsSms, "SMS List");
                buffer = XLSX.write(wbSms, { bookType: 'csv', type: 'buffer' });
                filename = allFiles.sms.filename;
                contentType = 'text/csv';
                break;
            
            case 'contacts_csv':
                if (allFiles.contacts.data.length === 0) return res.status(404).send('No primary contact data found.');
                const wsContacts = XLSX.utils.json_to_sheet(allFiles.contacts.data, { header: allFiles.contacts.headers });
                const wbContacts = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wbContacts, wsContacts, "Contacts List");
                buffer = XLSX.write(wbContacts, { bookType: 'csv', type: 'buffer' });
                filename = allFiles.contacts.filename;
                contentType = 'text/csv';
                break;

            case 'mobiles_zip':
                if (!allFiles.mobileSplits.data) return res.status(404).send('No mobile data found to generate splits.');
                buffer = allFiles.mobileSplits.data;
                filename = allFiles.mobileSplits.filename;
                contentType = 'application/zip';
                break;    

            case 'csv_zip':
                if (!allFiles.contactsSplits.data) return res.status(404).send('No contact data found to generate CSV splits.');
                buffer = allFiles.contactsSplits.data;
                filename = allFiles.contactsSplits.filename;
                contentType = 'application/zip';
                break;

            case 'txt_zip':
                if (!allFiles.contactsTxtSplits.data) return res.status(404).send('No contact data found to generate TXT splits.');
                buffer = allFiles.contactsTxtSplits.data;
                filename = allFiles.contactsTxtSplits.filename;
                contentType = 'application/zip';
                break;

            case 'all':
                const zip = new JSZip();
                if (allFiles.full.data.length > 0) {
                    const ws = XLSX.utils.json_to_sheet(allFiles.full.data);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, "Business List");
                    zip.file(allFiles.full.filename, XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }));
                }
                if (allFiles.duplicates.data.length > 0) {
                    const ws = XLSX.utils.json_to_sheet(allFiles.duplicates.data);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, "Duplicates List");
                    zip.file(allFiles.duplicates.filename, XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }));
                }
                if (allFiles.sms.data.length > 0) {
                     const ws = XLSX.utils.json_to_sheet(allFiles.sms.data, { header: allFiles.sms.headers });
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, "SMS List");
                    zip.file(allFiles.sms.filename, XLSX.write(wb, { bookType: 'csv', type: 'buffer' }));
                }
                if (allFiles.contacts.data.length > 0) {
                    const ws = XLSX.utils.json_to_sheet(allFiles.contacts.data, { header: allFiles.contacts.headers });
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, "Contacts List");
                    zip.file(allFiles.contacts.filename, XLSX.write(wb, { bookType: 'csv', type: 'buffer' }));
                }
                if (allFiles.mobileSplits.data) zip.file(allFiles.mobileSplits.filename, allFiles.mobileSplits.data);
                if (allFiles.contactsSplits.data) zip.file(allFiles.contactsSplits.filename, allFiles.contactsSplits.data);
                if (allFiles.contactsTxtSplits.data) zip.file(allFiles.contactsTxtSplits.filename, allFiles.contactsTxtSplits.data);

                buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
                filename = generateFilename(searchParams, 'all_files', 'zip', job.created_at);
                contentType = 'application/zip';
                break;

            default:
                return res.status(400).send('Invalid file type requested.');
        }

        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', contentType);
        res.send(buffer);

    } catch (error) {
        console.error(`[File Download Error] Job ${req.params.jobId}:`, error);
        res.status(500).send('Failed to generate or retrieve the file.');
    }
});

app.post("/api/jobs/:jobId/send-quick-body", async (req, res) => {
    try {
        const { jobId } = req.params;
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
        
        const token = authHeader.split(' ')[1];
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) return res.status(401).json({ error: 'Unauthorized' });

        const { data: job, error: jobError } = await supabase
            .from('jobs')
            .select('results, parameters')
            .eq('id', jobId)
            .single();

        if (jobError || !job) return res.status(404).json({ error: 'Job not found' });

        const results = job.results || [];
        const categoriesMap = {};

        results.forEach(item => {
            if (item.Phone) {
                let num = String(item.Phone).replace(/\D/g, '');
                if (num.startsWith('614')) {
                    num = '0' + num.substring(2);
                }
                
                if (num.startsWith('04')) {
                    const cat = item.Category || 'General';
                    if (!categoriesMap[cat]) {
                        categoriesMap[cat] = new Set();
                    }
                    categoriesMap[cat].add(num);
                }
            }
        });

        let emailBody = `Search: ${job.parameters.searchParamsForEmail.area}\n`;
        emailBody += `Total Mobile Leads: ${Object.values(categoriesMap).reduce((acc, set) => acc + set.size, 0)}\n`;
        emailBody += `___________________________________\n\n`;

        for (const [category, phones] of Object.entries(categoriesMap)) {
            emailBody += `CATEGORY: ${category.toUpperCase()}\n`;
            emailBody += Array.from(phones).join('\n');
            emailBody += `\n\n`;
        }

        emailBody += `___________________________________\n`;

        const mailOptions = {
            from: `"RTRL Prospector" <${process.env.EMAIL_USER}>`,
            to: job.parameters.userEmail,
            subject: `Mobile List: ${job.parameters.searchParamsForEmail.area}`,
            text: emailBody
        };

        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
        });

        await transporter.sendMail(mailOptions);
        res.status(200).json({ success: true });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post("/api/jobs/:jobId/resend-email", async (req, res) => {
    try {
        const { jobId } = req.params;
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required.' });
        
        const token = authHeader.split(' ')[1];
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) return res.status(401).json({ error: 'Authentication failed.' });

        const { data: job, error: jobError } = await supabase.from('jobs').select('results, parameters, user_id').eq('id', jobId).single();

        if (jobError || !job) return res.status(404).json({ error: 'Job not found.' });
        if (job.user_id !== user.id) return res.status(403).json({ error: 'Access denied.' });
        
        const recipientEmail = job.parameters?.userEmail;
        if (!recipientEmail) return res.status(400).json({ error: 'No recipient email found for this job.' });
        
        const rawData = job.results || [];
        const { uniqueBusinesses, duplicates } = deduplicateBusinesses(rawData);

        if (uniqueBusinesses.length === 0) return res.status(400).json({ error: 'No unique data to send.' });

        const emailParams = { ...job.parameters.searchParamsForEmail };
        if (job.parameters.radiusKm) emailParams.radiusKm = job.parameters.radiusKm;
        
        const emailStatus = await sendResultsByEmail(recipientEmail, uniqueBusinesses, emailParams, duplicates);
        
        res.status(200).json({ success: true, message: emailStatus });

    } catch (error) {
        console.error(`[Resend Email Error] Job ${req.params.jobId}:`, error);
        res.status(500).json({ error: 'Failed to resend email.' });
    }
});

app.get("/api/jobs/history", async (req, res) => {
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
            .from('jobs')
            .select('id, created_at, parameters, status, results')
            .eq('user_id', user.id)
            .neq('status', 'queued')
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) throw error;
        
        const jobs = data.map(job => ({
            ...job,
            results: job.results?.length || 0
        }));

        res.json(jobs || []);
    } catch (dbError) {
        console.error("Error fetching job history:", dbError);
        res.status(500).json({ error: 'Failed to fetch job history.' });
    }
});

const containerPublicPath = path.join(__dirname, "..", "public");
app.use(express.static(containerPublicPath, { index: false }));
app.get(/(.*)/, (req, res) => {
  const requestedPath = req.params[0];
  const fileName = (requestedPath === "/admin.html" || requestedPath === "admin.html") 
                   ? "admin.html" 
                   : "index.html";
                   
  const filePath = path.join(containerPublicPath, fileName);

  fs.readFile(filePath, "utf8", (err, data) => {
    if (err) {
      console.error("Error reading file:", err);
      return res.status(500).send("Error loading the application.");
    }

    const finalHtml = data
      .replace(/%%GOOGLE_MAPS_API_KEY%%/g, process.env.MAPS_API_KEY)
      .replace(/%%SUPABASE_URL%%/g, process.env.SUPABASE_URL)
      .replace(/%%SUPABASE_ANON_KEY%%/g, process.env.SUPABASE_ANON_KEY);

    res.send(finalHtml);
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

const initSupabaseRealtime = () => {
    supabase.channel('profiles_changes')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, payload => {
            const updatedProfile = payload.new;
            console.log('[Realtime] Profile updated:', updatedProfile.id);

            io.to(updatedProfile.id).emit('user_profile_updated'); 
        })
        .subscribe();

    console.log('[Supabase Realtime] Subscribed to profiles table changes.');
};

server.listen(PORT, () => {
  console.log(`Scraping server running on http://localhost:${PORT}`);
  recoverStuckJobs();
  initSupabaseRealtime();
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

function normalizePhoneTo61(num) {
    if (!num) return null;
    let digits = String(num).replace(/\D/g, ''); 
    if (digits.startsWith('0')) {
        digits = '61' + digits.substring(1);
    } else if (!digits.startsWith('61') && digits.length >= 8) {
        digits = '61' + digits;
    }
    return (digits.length >= 10 && digits.length <= 13) ? digits : null;
}
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

    const isMobilePhone = (phone) => {
        if (!phone) return false;
        const clean = String(phone).replace(/\D/g, "");
        return clean.startsWith('614'); 
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
            const entryWithValidEmail = group.find(b => isValidEmail(b.Email1) || isValidEmail(b.Email2) || isValidEmail(b.Email3));
            
            const entryWithMobile = group.find(b => b.Phone && String(b.Phone).startsWith('614'));

            const entryWithAnyPhone = group.find(b => b.Phone && String(b.Phone).length > 5);

            let bestEntry;
            if (entryWithValidEmail) {
                bestEntry = entryWithValidEmail;
            } else if (entryWithMobile) {
                bestEntry = entryWithMobile;
            } else if (entryWithAnyPhone) {
                bestEntry = entryWithAnyPhone;
            } else {
                bestEntry = group[0];
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
 
    if (Math.sqrt(lat_dist * lat_dist + lng_dist * lng_dist) < 0.5)
      return [searchQuery];
      
    const GRID_SIZE = 3,
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
    
    try {
      await page.waitForSelector('a[href*="/maps/place/"]', { timeout: 15000 });
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
          (selector) => {
             const feed = document.querySelector(selector);
             if(feed) feed.scrollTo(0, 999999);
          },
          'div[role="feed"]'
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
  const ownerTitleKeywords = ["owner", "founder", "director", "principal", "proprietor", "ceo", "manager"];
  const pageText = await page.evaluate(() => document.body.innerText);
  const links = await page.$$eval("a", (as) => as.map((a) => a.href));
  
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emails = [...new Set([
    ...links.filter(h => h.startsWith("mailto:")).map(h => h.replace("mailto:", "").split("?")[0]),
    ...(pageText.match(emailRegex) || [])
  ])];

  const phoneRegex = /(?:\+61|61|0)[2-478](?:[ -]?[0-9]){8,11}/g;
  const rawPhones = pageText.match(phoneRegex) || [];

  let ownerName = "";
  const textLines = pageText.split(/[\n\r]+/).map((line) => line.trim());
  for (const line of textLines) {
    for (const title of ownerTitleKeywords) {
      if (line.toLowerCase().includes(title)) {
        let pName = line.split(new RegExp(title, "i"))[0].trim().replace(/,$/, "");
        const words = pName.split(" ").filter(Boolean);
        if (words.length >= 2 && words.length <= 4) {
          ownerName = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
          break;
        }
      }
    }
    if (ownerName) break;
  }
  return { emails, ownerName, rawPhones, pageText };
}

async function scrapeWebsiteForGoldData(page, websiteUrl) {
  const data = { foundEmails: [], foundPhones: [], OwnerName: "", InstagramURL: "", FacebookURL: "", rawText: "" };
  try {
    await page.goto(websiteUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
    
    const initialLinks = await page.$$eval("a", (as) => as.map((a) => ({ href: a.href, text: a.innerText })));
    data.InstagramURL = initialLinks.find((l) => l.href.includes("instagram.com"))?.href || "";
    data.FacebookURL = initialLinks.find((l) => l.href.includes("facebook.com"))?.href || "";
    
    const landing = await scrapePageContent(page);
    data.foundEmails.push(...landing.emails);
    data.foundPhones.push(...landing.rawPhones);
    data.OwnerName = landing.ownerName;
    data.rawText = landing.pageText;

    const subPageLinks = await page.evaluate(() => {
        const keywords = /contact|about|team|staff|meet|connect|info/i;
        return Array.from(document.querySelectorAll('a'))
            .filter(link => link.href.startsWith('http') && (keywords.test(link.innerText) || keywords.test(link.href)))
            .map(link => link.href);
    });

    for (const link of [...new Set(subPageLinks)].slice(0, 2)) {
        try {
            await page.goto(link, { waitUntil: "domcontentloaded", timeout: 12000 });
            const subData = await scrapePageContent(page);
            data.foundEmails.push(...subData.emails);
            data.foundPhones.push(...subData.rawPhones);
            if (!data.OwnerName) data.OwnerName = subData.ownerName;
            data.rawText += `\n\n--- Subpage: ${link} ---\n` + subData.pageText;
        } catch (e) { continue; }
    }
  } catch (error) { }
  return data;
}

async function getABRContext(page, query) {
    try {
        await page.goto(`https://abr.business.gov.au/Search/Results?SearchText=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded' });
        return await page.evaluate(() => document.body.innerText);
    } catch (e) { return ""; }
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
            return await promiseWithTimeout(task(), 300000); 
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

function normalizeForExclusionCheck(str = "") {
  if (!str) return "";
  return str
    .toLowerCase()
    .replace(/['’`.,()&]/g, "") 
    .replace(/\s+/g, "");      
}

function extractCoordinatesFromUrl(url) {
  if (!url) return null;

  const pinMatch = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (pinMatch) {
    return { lat: parseFloat(pinMatch[1]), lng: parseFloat(pinMatch[2]) };
  }

  const viewMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (viewMatch) {
    return { lat: parseFloat(viewMatch[1]), lng: parseFloat(viewMatch[2]) };
  }

  return null;
}