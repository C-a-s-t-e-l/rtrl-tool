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

puppeteer.use(StealthPlugin());

const app = express();
const server = http.createServer(app);

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

const io = new Server(server, {
    cors: { origin: FRONTEND_URL, methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;
const GOOGLE_MAPS_API_KEY = process.env.MAPS_API_KEY;
const PLACEHOLDER_KEY = '%%GOOGLE_MAPS_API_KEY%%';

if (!GOOGLE_MAPS_API_KEY) {
    console.error("ERROR: MAPS_API_KEY not found in .env file!");
    process.exit(1);
}

// --- START: IMPROVED DE-DUPLICATION HELPER ---
// More aggressive cleaning for creating a reliable unique key.
const normalizeStringForKey = (str = '') => {
    if (!str) return '';
    // Removes common business suffixes, punctuation, and all spaces.
    // Also truncates address at the first comma to normalize (e.g., "123 Main St, Richmond" becomes "123 Main St").
    return str.toLowerCase()
        .replace(/,.*$/, '') 
        .replace(/\b(cafe|pty|ltd|inc|llc|co|the)\b/g, '')
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()']/g, "")
        .replace(/\s+/g, '');
};
// --- END: IMPROVED DE-DUPLICATION HELPER ---


const countryBoundingBoxes = {
    'australia': { minLat: -44.0, maxLat: -10.0, minLng: 112.0, maxLng: 154.0 },
    'philippines': { minLat: 4.0, maxLat: 21.0, minLng: 116.0, maxLng: 127.0 },
    'new zealand': { minLat: -47.3, maxLat: -34.4, minLng: 166.4, maxLng: 178.6 },
    'united states': { minLat: 24.4, maxLat: 49.4, minLng: -125.0, maxLng: -66.9 }, // Contiguous US
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

    socket.on('start_scrape', async ({ category, location, postalCode, country, count, businessNames }) => {
        const isIndividualSearch = businessNames && businessNames.length > 0;
        const finalCount = isIndividualSearch ? -1 : count;
        const isSearchAll = finalCount === -1;
        const targetCount = isSearchAll ? Infinity : finalCount;
        
        let searchAreas = [];
        if (postalCode && postalCode.length > 0) searchAreas = postalCode;
        else if (location) searchAreas = [location];

        if (searchAreas.length === 0 || !country) {
            return socket.emit('scrape_error', { error: `Missing location/postcode or country data.` });
        }
        
        let browser = null;
        try {
            const puppeteerArgs = [
                '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                '--disable-gpu', '--no-zygote', '--lang=en-US,en', '--ignore-certificate-errors',
                '--window-size=1920,1080', '--disable-blink-features=AutomationControlled'
            ];
            browser = await puppeteer.launch({ headless: true, args: puppeteerArgs });
            
            const allProcessedBusinesses = [];
            const processedUrlSet = new Set();
            const addedBusinessKeys = new Set();
            const CONCURRENCY = 4;
            let totalDiscoveredUrls = 0;
            
            const searchItems = isIndividualSearch ? businessNames : [category];

            for (const item of searchItems) {
                if (allProcessedBusinesses.length >= targetCount) break;
                if (isIndividualSearch) socket.emit('log', `\n--- Now searching for: "${item}" ---`);

                for (const areaQuery of searchAreas) {
                    if (allProcessedBusinesses.length >= targetCount) break;
                    const baseSearchQuery = isIndividualSearch ? `${item}, ${areaQuery}, ${country}` : `${item} in ${areaQuery}, ${country}`;
                    if (!isIndividualSearch) socket.emit('log', `\n--- Starting search area: "${areaQuery}" ---`);
                
                    const searchQueries = await getSearchQueriesForLocation(baseSearchQuery, areaQuery, country, socket);
                
                    for (const query of searchQueries) {
                        if (allProcessedBusinesses.length >= targetCount) break;
                        socket.emit('log', `--- Scraping sub-area: "${query}" ---`);
                        
                        const discoveredUrlsForThisArea = new Set();
                        // --- START: MODIFICATION - Pass isIndividualSearch flag ---
                        await collectGoogleMapsUrlsContinuously(browser, query, socket, discoveredUrlsForThisArea, country, isIndividualSearch);
                        // --- END: MODIFICATION ---
                        
                        let newUniqueUrls = Array.from(discoveredUrlsForThisArea).filter(url => !processedUrlSet.has(url));
                        
                        if (newUniqueUrls.length === 0) {
                            socket.emit('log', `   -> No new unique businesses found for this query.`);
                            continue;
                        }

                        newUniqueUrls.forEach(url => processedUrlSet.add(url));
                        totalDiscoveredUrls = processedUrlSet.size;
                        socket.emit('log', `   -> Discovered ${newUniqueUrls.length} new listings. Total unique: ${totalDiscoveredUrls}. Now processing details...`);

                        for (let i = 0; i < newUniqueUrls.length; i += CONCURRENCY) {
                            if (allProcessedBusinesses.length >= targetCount) break;
                            const batch = newUniqueUrls.slice(i, i + CONCURRENCY);

                            const promises = batch.map(async (urlToProcess) => {
                                if (allProcessedBusinesses.length >= targetCount) return null;
                            
                                return promiseWithTimeout(
                                    (async () => {
                                        let detailPage;
                                        try {
                                            detailPage = await browser.newPage();
                                            await detailPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36');
                                            await detailPage.setRequestInterception(true);
                                            detailPage.on('request', (req) => { if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) req.abort(); else req.continue(); });
                                            
                                            let googleData = await scrapeGoogleMapsDetails(detailPage, urlToProcess, socket, country);
                                            if (!googleData || !googleData.BusinessName) return null;
                                            
                                            let websiteData = {};
                                            if (googleData.Website) websiteData = await scrapeWebsiteForGoldData(detailPage, googleData.Website, socket);
                                            
                                            const fullBusinessData = { ...googleData, ...websiteData };
                                            // Assign the user's category search term, but keep the specific scraped one.
                                            fullBusinessData.Category = isIndividualSearch ? (googleData.ScrapedCategory || 'N/A') : category;
                                            return fullBusinessData;
                                        } finally {
                                            if (detailPage) await detailPage.close();
                                        }
                                    })(), 120000
                                ).catch(err => {
                                    socket.emit('log', `A task for ${urlToProcess} failed or timed out: ${err.message}. Skipping.`, 'error');
                                    return null;
                                });
                            });

                            const results = await Promise.all(promises);
                            results.forEach(businessData => {
                                if (businessData && allProcessedBusinesses.length < targetCount) {
                                    // Use the improved de-duplication key
                                    const businessKey = normalizeStringForKey(businessData.BusinessName) + normalizeStringForKey(businessData.StreetAddress);
                                    
                                    if (addedBusinessKeys.has(businessKey)) {
                                        socket.emit('log', `-> SKIPPED (Duplicate): ${businessData.BusinessName} at ${businessData.StreetAddress}`);
                                    } else {
                                        addedBusinessKeys.add(businessKey);
                                        allProcessedBusinesses.push(businessData);
                                        const status = isSearchAll ? `(Total Added: ${allProcessedBusinesses.length})` : `(${allProcessedBusinesses.length}/${finalCount})`;
                                        socket.emit('log', `-> ADDED: ${businessData.BusinessName}. ${status}`);
                                        socket.emit('business_found', businessData);
                                    }
                                }
                                socket.emit('progress_update', { processed: allProcessedBusinesses.length, discovered: totalDiscoveredUrls, added: allProcessedBusinesses.length, target: finalCount });
                            });
                        }
                    }
                }
            }

            socket.emit('log', `Scraping completed. Found and processed a total of ${allProcessedBusinesses.length} businesses.`);
            socket.emit('scrape_complete');

        } catch (error) {
            console.error('A critical error occurred:', error);
            socket.emit('scrape_error', { error: `Critical failure: ${error.message.split('\n')[0]}` });
        } finally {
            if (browser) await browser.close();
        }
    });

    socket.on('disconnect', () => console.log(`Client disconnected: ${socket.id} at ${new Date().toLocaleString()}`));
});

async function getSearchQueriesForLocation(searchQuery, areaQuery, country, socket) {
    socket.emit('log', `   -> Geocoding "${areaQuery}, ${country}"...`);
    if (/^\d{4}$/.test(areaQuery.trim())) {
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

// --- START: MODIFIED FUNCTION FOR STRICTER SEARCH ---
async function collectGoogleMapsUrlsContinuously(browser, searchQuery, socket, discoveredUrlSet, country, isIndividualSearch = false) {
    let page;
    try {
        const countryNameToCode = {'australia': 'AU', 'new zealand': 'NZ', 'united states': 'US', 'united kingdom': 'GB', 'canada': 'CA', 'philippines': 'PH'};
        const countryCode = countryNameToCode[country.toLowerCase()];
        const countryParam = countryCode ? `?cr=country${countryCode}` : '';
        let searchUrl;
        if (searchQuery.includes(' near ')) {
            const parts = searchQuery.split(' near ');
            searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(parts[0])}/@${parts[1]},12z${countryParam}`;
        } else {
            searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}${countryParam}`;
        }

        socket.emit('log', `   -> Navigating to: ${searchQuery}`);
        page = await browser.newPage();
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
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
            
            let consecutiveNoProgressAttempts = 0;
            const MAX_NO_PROGRESS = 5;
            while (consecutiveNoProgressAttempts < MAX_NO_PROGRESS) {
                const previousSize = discoveredUrlSet.size;
                
                const visibleLinks = await page.$$eval('a[href*="/maps/place/"]', links => 
                    links.map(link => ({ href: link.href, text: link.innerText || '' }))
                );

                let targetName = '';
                if (isIndividualSearch) {
                    targetName = searchQuery.split(',')[0].trim().toLowerCase();
                }

                visibleLinks.forEach(link => {
                    if (isIndividualSearch) {
                        // For individual name searches, only add links containing the target name.
                        if (link.text.toLowerCase().includes(targetName)) {
                            discoveredUrlSet.add(link.href);
                        }
                    } else {
                        // For category searches, add all results.
                        discoveredUrlSet.add(link.href);
                    }
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
                socket.emit('log', `   -> No valid results found on this page.`, 'error');
                await page.screenshot({ path: `error_no_results_${Date.now()}.png` });
            }
        }
    } catch (error) {
        socket.emit('log', `CRITICAL ERROR during URL collection: ${error.message.split('\n')[0]}`, 'error');
        if (page) await page.screenshot({ path: `error_collection_${Date.now()}.png` });
    } finally {
        if (page) await page.close();
    }
}
// --- END: MODIFIED FUNCTION ---

async function scrapeGoogleMapsDetails(page, url, socket, country) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForSelector('h1', {timeout: 60000});
    
    // --- START: MODIFIED EVALUATE TO GET ScrapedCategory ---
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
        
        const data = {
            BusinessName: cleanText(document.querySelector('h1')?.innerText),
            ScrapedCategory: cleanText(document.querySelector('[jsaction*="category"]')?.innerText), // <-- NEW
            StreetAddress: cleanText(document.querySelector('button[data-item-id="address"]')?.innerText),
            Website: document.querySelector('a[data-item-id="authority"]')?.href || '',
            Phone: cleanPhoneNumber(document.querySelector('button[data-item-id*="phone"]')?.innerText, countryCode),
            GoogleMapsURL: window.location.href,
            Suburb: ''
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
    // --- END: MODIFIED EVALUATE ---
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
            } catch (e) { /* ignore navigation errors */ }
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
    } catch (error) { /* ignore website scraping errors */ }
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