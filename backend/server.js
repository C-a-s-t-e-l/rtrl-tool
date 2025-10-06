const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
require('dotenv').config();
const { sendResultsByEmail } = require('./emailService'); 

puppeteer.use(StealthPlugin());

const app = express();
const server = http.createServer(app);

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

const io = new Server(server, {
    cors: { origin: FRONTEND_URL, methods: ["GET", "POST"] }
});

const activeBrowsers = new Map();

const PORT = process.env.PORT || 3000;
const GOOGLE_MAPS_API_KEY = process.env.MAPS_API_KEY;
const PLACEHOLDER_KEY = '%%GOOGLE_MAPS_API_KEY%%';

if (!GOOGLE_MAPS_API_KEY) {
    console.error("ERROR: MAPS_API_KEY not found in .env file!");
    process.exit(1);
}

const normalizeStringForKey = (str = '') => {
    if (!str) return '';
    return str.toLowerCase()
        .replace(/,.*$/, '') 
        .replace(/\b(cafe|pty|ltd|inc|llc|co|the)\b/g, '')
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()']/g, "")
        .replace(/\s+/g, '');
};

const normalizePhoneNumber = (phoneStr = '') => {
    if (!phoneStr) return '';
    return String(phoneStr).replace(/\D/g, '');
};

const normalizeAddress = (addressStr = '') => {
    if (!addressStr) return '';
    return String(addressStr).toLowerCase().trim().replace(/\s+/g, ' ');
};

const countryBoundingBoxes = {
    'australia': { minLat: -44.0, maxLat: -10.0, minLng: 112.0, maxLng: 154.0 },
    'philippines': { minLat: 4.0, maxLat: 21.0, minLng: 116.0, maxLng: 127.0 },
    'new zealand': { minLat: -47.3, maxLat: -34.4, minLng: 166.4, maxLng: 178.6 },
    'united states': { minLat: 24.4, maxLat: 49.4, minLng: -125.0, maxLng: -66.9 }, 
    'united kingdom': { minLat: 49.9, maxLat: 58.7, minLng: -7.5, maxLng: 1.8 },
    'canada': { minLat: 41.6, maxLat: 83.1, minLng: -141.0, maxLng: -52.6 }
};

function isUrlInBoundingBox(url, box) {
    const match = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)|@(-?\d+\.\d+),(-?\d+\.\d+)/);
    
    if (!match) return false;
    const lat = parseFloat(match[1] || match[3]);
    const lng = parseFloat(match[2] || match[4]);
    return lat >= box.minLat && lat <= box.maxLat && lng >= box.minLng && lng <= box.maxLng;
}

app.use(cors());
app.use(express.json());

app.get('/api/config', (req, res) => res.json({ googleMapsApiKey: GOOGLE_MAPS_API_KEY }));

const containerPublicPath = path.join(__dirname, '..', 'public');
app.use(express.static(containerPublicPath, { index: false }));
app.get(/(.*)/, (req, res) => {
    const indexPath = path.join(containerPublicPath, 'index.html');
    fs.readFile(indexPath, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading index.html:', err);
            return res.status(500).send('Error loading the application.');
        }
        res.send(data.replace(PLACEHOLDER_KEY, GOOGLE_MAPS_API_KEY));
    });
});
io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id} at ${new Date().toLocaleString()}`);
    socket.emit('log', `[Server] Connected to Real-time Scraper.`);

    socket.on('start_scrape', async ({ categoriesToLoop, location, postalCode, country, count, businessNames, anchorPoint, radiusKm, userEmail, searchParamsForEmail }) => {
        
        socket.scrapeProgress = {
            results: [],
            email: userEmail,
            searchParams: searchParamsForEmail,
            status: 'running'
        };

        const isIndividualSearch = businessNames && businessNames.length > 0;
        const searchItems = isIndividualSearch ? businessNames : (categoriesToLoop && categoriesToLoop.length > 0 ? categoriesToLoop : []);

        const finalCount = isIndividualSearch ? -1 : count;
        const isSearchAll = finalCount === -1;
        const targetCount = isSearchAll ? Infinity : finalCount;
        
        let browser = null;
        let collectionPage = null;

        try {
            const puppeteerArgs = [
                '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                '--disable-gpu', '--no-zygote', '--lang=en-US,en', '--ignore-certificate-errors',
                '--window-size=1920,1080', '--disable-blink-features=AutomationControlled'
            ];
            
const launchBrowser = async () => {
            console.log('[Browser Lifecycle] Launching new browser instance...');

            // Create a unique, temporary user data directory for each launch.
            // This is the key to preventing resource conflicts.
            const userDataDir = path.join(__dirname, 'puppeteer_temp', `user_data_${Date.now()}`);
            
            const launchArgs = [
                ...puppeteerArgs, // Your existing args
                `--user-data-dir=${userDataDir}`, // Force a fresh, isolated profile
                '--disable-extensions', // Disable any potentially interfering extensions
                '--disable-component-extensions-with-background-pages',
            ];

            const newBrowser = await puppeteer.launch({ 
                headless: true, 
                args: launchArgs, // Use the new, more aggressive args
                protocolTimeout: 120000,
                userDataDir: userDataDir // Also specify it here for some versions
            });
            activeBrowsers.set(socket.id, newBrowser);
            return newBrowser;
        };

            browser = await launchBrowser();
            collectionPage = await browser.newPage();
            socket.emit('log', '[Setup] Created a dedicated page for URL collection.');

            const allProcessedBusinesses = [];
            const addedBusinessKeys = new Set();
            const CONCURRENCY = 3;
            const masterUrlMap = new Map();
            socket.emit('log', `--- Starting URL Collection Phase ---`);

            for (const item of searchItems) {
                socket.emit('log', isIndividualSearch ? `\n--- Searching for business: "${item}" ---` : `\n--- Searching for category: "${item}" ---`);
                
                let locationQueries = [];
                if (anchorPoint && radiusKm) {
                    locationQueries = await getSearchQueriesForRadius(anchorPoint, radiusKm, country, GOOGLE_MAPS_API_KEY, socket);
                } else {
                    let searchAreas = [];
                    if (postalCode && postalCode.length > 0) searchAreas = postalCode;
                    else if (location) searchAreas = [location];
                    if (searchAreas.length === 0) {
                         socket.emit('log', 'No location/postcode provided, skipping item.', 'error');
                         continue;
                    }
                    for (const areaQuery of searchAreas) {
                        const baseQuery = isIndividualSearch ? `${item}, ${areaQuery}, ${country}` : `${item} in ${areaQuery}, ${country}`;
                        const queriesForArea = await getSearchQueriesForLocation(baseQuery, areaQuery, country, socket, isIndividualSearch);
                        locationQueries.push(...queriesForArea);
                    }
                }

                for (const query of locationQueries) {
                    const finalSearchQuery = (isIndividualSearch || query.startsWith('near ')) ? `${item} ${query}` : query;
                    const discoveredUrlsForThisSubArea = new Set();
                    
                    await collectGoogleMapsUrlsContinuously(collectionPage, finalSearchQuery, socket, discoveredUrlsForThisSubArea, country);
                    
                    let initialSize = masterUrlMap.size;
                    discoveredUrlsForThisSubArea.forEach(url => {
                        if (!masterUrlMap.has(url)) {
                            masterUrlMap.set(url, item);
                        }
                    });
                    let newUrlsFound = masterUrlMap.size - initialSize;
                    socket.emit('log', `   -> Found ${newUrlsFound} new URLs in this area. Total unique URLs so far: ${masterUrlMap.size}`);
                }
            }

            if (collectionPage) {
                 try { await collectionPage.close(); } catch (e) {}
            }

            socket.emit('log', `\n--- URL Collection Complete. Found ${masterUrlMap.size} total unique businesses. ---`);
            socket.emit('log', `[System] Restarting browser after URL collection for maximum stability...`);
            
            activeBrowsers.delete(socket.id);
            await browser.close();
            console.log('[System] Pausing for 2 seconds to ensure complete browser cleanup...');
            await new Promise(resolve => setTimeout(resolve, 2000));

            browser = await launchBrowser();
            
            socket.emit('log', `[System] New browser is ready for data processing.`);
            socket.emit('log', `--- Starting Data Processing Phase ---`);

            const urlsToProcess = Array.from(masterUrlMap, ([url, specificCategory]) => ({ url, category: specificCategory }));
            const totalDiscoveredUrls = urlsToProcess.length;

            let processedInThisBrowser = 0;
            const BROWSER_RESTART_THRESHOLD = 50;

            for (let i = 0; i < urlsToProcess.length; i += CONCURRENCY) {
                if (allProcessedBusinesses.length >= targetCount) break;

                if (processedInThisBrowser > 0 && processedInThisBrowser % BROWSER_RESTART_THRESHOLD === 0) {
                    socket.emit('log', `[System] Browser has processed ${processedInThisBrowser} items. Restarting for stability...`);
                    activeBrowsers.delete(socket.id);
                    await browser.close();
                    browser = await launchBrowser();
                    socket.emit('log', `[System] New browser instance is ready.`);
                }

                const batch = urlsToProcess.slice(i, i + CONCURRENCY);
                const promises = batch.map(async (processItem) => {
                    let detailPage = null; 
                    try {
                        const scrapingTask = async () => {
                            detailPage = await browser.newPage();
                            await detailPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36');
                            await detailPage.setRequestInterception(true);
                            detailPage.on('request', (req) => { if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) req.abort(); else req.continue(); });
                            let googleData = await scrapeGoogleMapsDetails(detailPage, processItem.url, socket, country);
                            if (!googleData || !googleData.BusinessName) return null;
                            let websiteData = {};
                            if (googleData.Website) websiteData = await scrapeWebsiteForGoldData(detailPage, googleData.Website, socket);
                            
                            const fullBusinessData = { ...googleData, ...websiteData };
                            
                            if (isIndividualSearch) {
                               fullBusinessData.Category = googleData.ScrapedCategory || 'N/A';
                            } else {
                               fullBusinessData.Category = processItem.category || 'N/A';
                            }
                            
                            return fullBusinessData;
                        };
                        return await promiseWithTimeout(scrapingTask(), 120000);
                    } catch (err) {
                        socket.emit('log', `A task for ${processItem.url} failed or timed out: ${err.message}. Skipping.`, 'error');
                        return null;
                    } finally {
                        processedInThisBrowser++;
                        if (detailPage) {
                            try { await detailPage.close(); } catch (detailPageCloseError) {}
                        }
                    }
                });

                const results = await Promise.all(promises);

                results.forEach(businessData => {
                    if (businessData && allProcessedBusinesses.length < targetCount) {
                        const name = businessData.BusinessName?.toLowerCase().trim() || '';
                        const phone = normalizePhoneNumber(businessData.Phone);
                        const address = normalizeAddress(businessData.StreetAddress);
                        const email = businessData.Email1?.toLowerCase().trim() || '';
                        let uniqueIdentifier = '';
                        let reason = '';
                        if (phone) {
                            uniqueIdentifier = `phone::${name}::${phone}`;
                            reason = `by Phone (${phone})`;
                        } else if (address) {
                            uniqueIdentifier = `address::${name}::${address}`;
                            reason = `by Address (${businessData.StreetAddress})`;
                        } else if (email) {
                            uniqueIdentifier = `email::${name}::${email}`;
                            reason = `by Email (${email})`;
                        } else {
                            uniqueIdentifier = `name_only::${name}`;
                            reason = 'by Name Only';
                        }
                        if (addedBusinessKeys.has(uniqueIdentifier)) {
                            socket.emit('log', `-> SKIPPED (Duplicate ${reason}): ${businessData.BusinessName}`);
                        } else {
                            addedBusinessKeys.add(uniqueIdentifier);
                            allProcessedBusinesses.push(businessData);
                            if (socket.scrapeProgress) {
                                socket.scrapeProgress.results.push(businessData);
                            }
                            const status = isSearchAll ? `(Total Added: ${allProcessedBusinesses.length})` : `(${allProcessedBusinesses.length}/${finalCount})`;
                            socket.emit('log', `-> ADDED: ${businessData.BusinessName}. ${status}`);
                            socket.emit('business_found', businessData);
                        }
                    }
                    socket.emit('progress_update', { processed: Math.min(i + batch.length, totalDiscoveredUrls), discovered: totalDiscoveredUrls, added: allProcessedBusinesses.length, target: finalCount });
                });
            }

            if (socket.scrapeProgress && socket.scrapeProgress.status !== 'running') {
                console.log('[Race Condition] Disconnect handler already processed this job. Aborting normal completion.');
                return; 
            }

            socket.emit('log', `Scraping completed. Found and processed a total of ${allProcessedBusinesses.length} businesses.`);
            
            if (socket.scrapeProgress) {
                socket.scrapeProgress.status = 'completing';
            }
            
            if (userEmail && allProcessedBusinesses.length > 0) {
                socket.emit('log', `[Email] Preparing to send results to ${userEmail}...`);
                
                const mainSearchArea = searchParamsForEmail.area || 'selected_area';
                
                const dataForEmail = allProcessedBusinesses.map(business => ({
                    ...business,
                    SuburbArea: business.Suburb || mainSearchArea.replace(/_/g, ' '),
                }));
                
                const emailStatus = await sendResultsByEmail(userEmail, dataForEmail, searchParamsForEmail);
                socket.emit('log', `[Email] ${emailStatus}`);
            }
            
            socket.emit('scrape_complete');

        } catch (error) {
            console.error('A critical error occurred:', error);
       
            if (socket.scrapeProgress && socket.scrapeProgress.status === 'running') {
                socket.emit('scrape_error', { error: `Critical failure: ${error.message.split('\n')[0]}` });
            }
        } finally {
            if (socket.scrapeProgress) {
                socket.scrapeProgress.status = 'finished';
            }
            activeBrowsers.delete(socket.id);
            if (browser) {
                try { await browser.close(); } catch (closeError) {}
            }
        }
    });

    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id} at ${new Date().toLocaleString()}`);
        
        if (socket.scrapeProgress && socket.scrapeProgress.status === 'running' && socket.scrapeProgress.results.length > 0) {
            console.log(`[Safety Net] Disconnect detected while running. Emailing ${socket.scrapeProgress.results.length} partial results.`);
            
            socket.scrapeProgress.status = 'completing';
            
            const mainSearchArea = socket.scrapeProgress.searchParams.area || 'selected_area';
            const partialDataForEmail = socket.scrapeProgress.results.map(business => ({
                ...business,
                SuburbArea: business.Suburb || mainSearchArea.replace(/_/g, ' '),
            }));
            
            const partialSearchParams = {
                ...socket.scrapeProgress.searchParams,
                subjectPrefix: '[INCOMPLETE] ',
                bodyPrefix: 'The research was interrupted. Here are the partial results found before disconnection:\n\n'
            };

            sendResultsByEmail(
                socket.scrapeProgress.email, 
                partialDataForEmail, 
                partialSearchParams
            );
        }
        
        if (activeBrowsers.has(socket.id)) {
            console.log(`[Cleanup] Found an orphaned browser for disconnected client ${socket.id}. Attempting to close it.`);
            const browserToClose = activeBrowsers.get(socket.id);
            try {
                if (browserToClose) { browserToClose.close(); }
            } catch (error) {} 
            finally {
                activeBrowsers.delete(socket.id);
            }
        }
    });
});


function degToRad(degrees) {
    return degrees * Math.PI / 180;
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const x = degToRad(lon2 - lon1) * Math.cos(degToRad(lat1 + lat2) / 2);
    const y = degToRad(lat2 - lat1);
    return Math.sqrt(x * x + y * y) * R;
}

async function getSearchQueriesForRadius(anchorPoint, radiusKm, country, apiKey, socket) {
    const searchQueries = [];
    
    let centerLat, centerLng;
    
    if (anchorPoint.includes(',')) {
        const parts = anchorPoint.split(',');
        centerLat = parseFloat(parts[0]);
        centerLng = parseFloat(parts[1]);
        socket.emit('log', `   -> Using direct coordinates for anchor point: ${centerLat.toFixed(4)}, ${centerLng.toFixed(4)}`);
    } else {
        socket.emit('log', `   -> Geocoding anchor point: "${anchorPoint}"`);
        try {
            const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(`${anchorPoint}, ${country}`)}&key=${apiKey}`;
            const response = await axios.get(geocodeUrl);
            if (response.data.status !== 'OK') {
                socket.emit('log', `   -> Geocoding failed for anchor point: ${response.data.status}`, 'error');
                return [];
            }
            const location = response.data.results[0].geometry.location;
            centerLat = location.lat;
            centerLng = location.lng;
            socket.emit('log', `   -> Anchor point located at: ${centerLat.toFixed(4)}, ${centerLng.toFixed(4)}`);
        } catch (error) {
            socket.emit('log', `   -> Geocoding API call failed: ${error.message}`, 'error');
            return [];
        }
    }

    const GRID_SIZE = Math.max(3, Math.ceil(radiusKm / 2));
    socket.emit('log', `   -> Generating a ${GRID_SIZE}x${GRID_SIZE} grid to cover the ${radiusKm}km radius.`);

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

            if (calculateDistance(centerLat, centerLng, pointLat, pointLng) <= radiusKm * 1.05) {
                searchQueries.push(`near ${pointLat.toFixed(6)},${pointLng.toFixed(6)}`);
            }
        }
    }
    
    socket.emit('log', `   -> Generated ${searchQueries.length} valid search points within the radius.`);
    return searchQueries;
}

async function getSearchQueriesForLocation(searchQuery, areaQuery, country, socket, isIndividualSearch = false) {
    if (isIndividualSearch) {
        socket.emit('log', `   -> Specific name search detected. Forcing single, broad area search.`);
        return [searchQuery];
    }
    
    socket.emit('log', `   -> Geocoding "${areaQuery}, ${country}"...`);
    if (/^\d{4,}$/.test(areaQuery.trim())) {
        socket.emit('log', `   -> Postcode search detected. Forcing single search.`);
        return [searchQuery];
    }
    try {
        const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(`${areaQuery}, ${country}`)}&key=${GOOGLE_MAPS_API_KEY}`;
        const response = await axios.get(geocodeUrl);
        if (response.data.status !== 'OK') {
            socket.emit('log', `   -> Geocoding failed: ${response.data.status}. Using single search.`, 'error');
            return [searchQuery];
        }
        const { geometry } = response.data.results[0];
        if (geometry.location_type === "ROOFTOP" || geometry.viewport.northeast.lat === geometry.viewport.southwest.lat) {
             return [searchQuery];
        }
        const lat_dist = geometry.viewport.northeast.lat - geometry.viewport.southwest.lat;
        const lng_dist = geometry.viewport.northeast.lng - geometry.viewport.southwest.lng;
        if (Math.sqrt(lat_dist*lat_dist + lng_dist*lng_dist) < 0.2) {
            return [searchQuery];
        }
        const GRID_SIZE = 5, searchQueries = [];
        const categoryPart = searchQuery.split(' in ')[0];
        socket.emit('log', `   -> Location is large. Generating ${GRID_SIZE}x${GRID_SIZE} search grid.`);
        for (let i = 0; i < GRID_SIZE; i++) {
            for (let j = 0; j < GRID_SIZE; j++) {
                const point_lat = geometry.viewport.southwest.lat + lat_dist * (i / (GRID_SIZE - 1));
                const point_lng = geometry.viewport.southwest.lng + lng_dist * (j / (GRID_SIZE - 1));
                searchQueries.push(`${categoryPart} near ${point_lat.toFixed(6)},${point_lng.toFixed(6)}`);
            }
        }
        return searchQueries;
    } catch (error) {
        socket.emit('log', `   -> Geocoding API call failed: ${error.message}. Defaulting to single search.`, 'error');
        return [searchQuery];
    }
}
async function collectGoogleMapsUrlsContinuously(page, searchQuery, socket, discoveredUrlSet, country) {
    try {
        const countryNameToCode = {'australia': 'AU', 'new zealand': 'NZ', 'united states': 'US', 'united kingdom': 'GB', 'canada': 'CA', 'philippines': 'PH'};
        const countryCode = countryNameToCode[country.toLowerCase()];
        const countryParam = countryCode ? `?cr=country${countryCode}` : '';
        let searchUrl;
        
        if (searchQuery.includes(' near ')) {
            const parts = searchQuery.split(' near ');
            const searchFor = parts[0].split(',')[0].trim();
            searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchFor)}/@${parts[1]},12z${countryParam}`;
        } else {
            searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}${countryParam}`;
        }

        socket.emit('log', `   -> Navigating to: ${searchQuery}`);
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        const noResultsFound = await page.evaluate(() => {
            const noResultsElement = Array.from(document.querySelectorAll('div')).find(el => el.innerText.includes("Google Maps can't find"));
            return !!noResultsElement;
        });

        if (noResultsFound) {
            socket.emit('log', `   -> INFO: No results found on Google Maps for "${searchQuery}". Skipping this area.`);
            return;
        }
        
        try {
            await page.click('form[action^="https://consent.google.com"] button', { timeout: 10000 });
            socket.emit('log', '   -> Accepted Google consent dialog.');
        } catch (e) { 
            socket.emit('log', '   -> No Google consent dialog found, proceeding.');
        }

        const feedSelector = 'div[role="feed"]';
        try {
            await page.waitForSelector(feedSelector, { timeout: 15000 });
            socket.emit('log', `   -> Found results list. Scraping all items...`);
            
            const boundingBox = countryBoundingBoxes[country.toLowerCase()];
            if (boundingBox) {
                socket.emit('log', `   -> Filtering results to stay within ${country} borders.`);
            }
            
            let consecutiveNoProgressAttempts = 0;
            const MAX_NO_PROGRESS = 5;
            while (consecutiveNoProgressAttempts < MAX_NO_PROGRESS) {
                const previousSize = discoveredUrlSet.size;
                
                const visibleLinks = await page.$$eval('a[href*="/maps/place/"]', links => 
                    links.map(link => ({ href: link.href, text: link.innerText || '' }))
                );

                visibleLinks.forEach(link => {
                    const inBounds = boundingBox ? isUrlInBoundingBox(link.href, boundingBox) : true;
                    if (!inBounds) return;
                    discoveredUrlSet.add(link.href);
                });

                if (discoveredUrlSet.size > previousSize) {
                    consecutiveNoProgressAttempts = 0;
                } else {
                    consecutiveNoProgressAttempts++;
                }
                
                await page.evaluate(selector => document.querySelector(selector)?.scrollTo(0, 999999), feedSelector);
                await new Promise(r => setTimeout(r, 2000));
            }
        } catch (error) {
            socket.emit('log', `   -> No results list found. Checking for direct navigation...`);
            const currentUrl = page.url();
            if (currentUrl.includes('/maps/place/')) {
                socket.emit('log', `   -> Direct navigation detected. Capturing single URL.`);
                discoveredUrlSet.add(currentUrl);
            } else {
                socket.emit('log', `   -> No valid results list or direct place page found for this query.`, 'error');
            }
        }
    } catch (error) {
        socket.emit('log', `CRITICAL ERROR during URL collection for "${searchQuery}": ${error.message.split('\n')[0]}`, 'error');
        if (page) await page.screenshot({ path: `error_collection_${searchQuery.replace(/\W/g, '_')}_${Date.now()}.png` });
    }
}

async function scrapeGoogleMapsDetails(page, url, socket, country) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForSelector('h1', {timeout: 60000});
    
    return page.evaluate((countryCode) => {
        const cleanText = (text) => {
            if (!text) return '';
            let cleaned = String(text);
            cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF\u0000-\u001F\u007F-\u009F]/g, '');
            cleaned = cleaned.replace(/^[^a-zA-Z0-9G]+/, '');
            return cleaned.replace(/\s+/g, ' ').trim();
        };

        const cleanPhoneNumber = (num, country) => {
            if (!num) return '';
            let digits = String(num).replace(/\D/g, ''); 
            if (country?.toLowerCase() === 'australia') {
                if (digits.startsWith('0')) {
                    digits = '61' + digits.substring(1);
                } else if (!digits.startsWith('61') && digits.length >= 8) {
                    digits = '61' + digits;
                }
            }
            return digits;
        };
        
        const categorySelectors = [
            'button[data-item-id="category"]',
            'button[jsaction*="pane.rating.category"]',
            'a[jsaction*="pane.rating.category"]',
            '[jsaction*="category"]'
        ];

        let categoryText = '';
        for (const selector of categorySelectors) {
            const element = document.querySelector(selector);
            if (element) {
                categoryText = element.innerText;
                break;
            }
        }
        
        const reviewElement = document.querySelector('div.F7nice');
        let starRating = '';
        let reviewCount = '';

        if (reviewElement) {
            const ratingText = reviewElement.innerText.split(' ')[0];
            starRating = parseFloat(ratingText) || '';
            
            const reviewCountMatch = reviewElement.innerText.match(/\(([\d,]+)\)/);
            if (reviewCountMatch && reviewCountMatch[1]) {
                reviewCount = reviewCountMatch[1].replace(/,/g, '');
            }
        }
        
        const data = {
            BusinessName: cleanText(document.querySelector('h1')?.innerText),
            ScrapedCategory: cleanText(categoryText),
            StreetAddress: cleanText(document.querySelector('button[data-item-id="address"]')?.innerText),
            Website: document.querySelector('a[data-item-id="authority"]')?.href || '',
            Phone: cleanPhoneNumber(document.querySelector('button[data-item-id*="phone"]')?.innerText, countryCode),
            GoogleMapsURL: window.location.href,
            Suburb: '',
            StarRating: String(starRating),
            ReviewCount: reviewCount
        };

        if (data.StreetAddress) {
            const parts = data.StreetAddress.split(',');
            if (parts.length >= 3) {
                const suburbPart = parts[parts.length - 2].trim();
                data.Suburb = suburbPart.replace(/\s[A-Z]{2,3}\s\d{4,}/, '').trim();
            } else if (parts.length === 2) {
                data.Suburb = parts[0].trim();
            }
        }
        return data;
    }, country);
}

async function scrapePageContent(page) {
    const ownerTitleKeywords = ['owner', 'founder', 'director', 'principal', 'proprietor', 'ceo', 'manager'];
    const pageText = await page.evaluate(() => document.body.innerText);
    const links = await page.$$eval('a', as => as.map(a => a.href));
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const mailtoEmails = links.filter(href => href.startsWith('mailto:')).map(href => href.replace('mailto:', '').split('?')[0]);
    const textEmails = pageText.match(emailRegex) || [];
    const emails = [...new Set([...mailtoEmails, ...textEmails])];
    let ownerName = '';
    const textLines = pageText.split(/[\n\r]+/).map(line => line.trim());
    for (const line of textLines) { for (const title of ownerTitleKeywords) { if (line.toLowerCase().includes(title)) { let pName = line.split(new RegExp(title, 'i'))[0].trim().replace(/,$/, ''); const words = pName.split(' ').filter(Boolean); if (words.length >= 2 && words.length <= 4) { ownerName = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '); break; } } } if (ownerName) break; }
    return { emails, ownerName };
}

async function scrapeWebsiteForGoldData(page, websiteUrl, socket) {
    const data = { OwnerName: '', InstagramURL: '', FacebookURL: '', Email1: '', Email2: '', Email3: '' };
    try {
        await page.goto(websiteUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        const initialLinks = await page.$$eval('a', as => as.map(a => ({ href: a.href, text: a.innerText })));
        data.InstagramURL = initialLinks.find(l => l.href.includes('instagram.com'))?.href || '';
        data.FacebookURL = initialLinks.find(l => l.href.includes('facebook.com'))?.href || '';
        const allFoundEmails = new Set();
        let finalOwnerName = '';
        const landingPageData = await scrapePageContent(page);
        landingPageData.emails.forEach(e => allFoundEmails.add(e.toLowerCase()));
        if (landingPageData.ownerName) finalOwnerName = landingPageData.ownerName;
        const pageKeywords = ['contact', 'about', 'team', 'meet', 'staff', 'our-people'];
        const keyPageLinks = initialLinks.filter(link => pageKeywords.some(keyword => link.href.toLowerCase().includes(keyword) || link.text.toLowerCase().includes(keyword))).map(link => link.href);
        const uniqueKeyPages = [...new Set(keyPageLinks)].slice(0, 3);
        for (const linkUrl of uniqueKeyPages) {
            try {
                await page.goto(linkUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
                const subsequentPageData = await scrapePageContent(page);
                subsequentPageData.emails.forEach(e => allFoundEmails.add(e.toLowerCase()));
                if (subsequentPageData.ownerName) finalOwnerName = subsequentPageData.ownerName;
            } catch (e) { }
        }
        data.OwnerName = finalOwnerName;
        const emailsArray = Array.from(allFoundEmails);
        if (emailsArray.length > 0) {
            const genericPrefixes = ['info@', 'contact@', 'support@', 'sales@', 'admin@', 'hello@', 'enquiries@'];
            const nameMatch = [], personal = [], generic = [];
            if (finalOwnerName) {
                const fName = finalOwnerName.toLowerCase().split(' ')[0];
                emailsArray.forEach(e => { if (e.toLowerCase().includes(fName)) nameMatch.push(e); });
            }
            emailsArray.forEach(e => {
                if (!nameMatch.includes(e)) {
                    if (genericPrefixes.some(p => e.toLowerCase().startsWith(p))) generic.push(e);
                    else personal.push(e);
                }
            });
            const ranked = [...new Set([...nameMatch, ...personal, ...generic])];
            data.Email1 = ranked[0] || ''; data.Email2 = ranked[1] || ''; data.Email3 = ranked[2] || '';
        }
    } catch (error) { }
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

server.listen(PORT, () => {
    console.log(`Scraping server running on http://localhost:${PORT}`);
});