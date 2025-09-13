const express = require('express');
const puppeteer = require('puppeteer-core'); // We use puppeteer-core for remote browsers
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// NOTE: We no longer need puppeteer-extra or the stealth plugin.
// Bright Data's service handles all of that for us.

const app = express();
const server = http.createServer(app);

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

const io = new Server(server, {
    cors: { origin: FRONTEND_URL, methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;
const GOOGLE_MAPS_API_KEY = process.env.MAPS_API_KEY;
const PLACEHOLDER_KEY = '%%GOOGLE_MAPS_API_KEY%%';

// --- BRIGHT DATA AUTH FOR SCRAPING BROWSER ---
// These are the same credentials as your ISP proxy zone
const BRIGHTDATA_USERNAME = process.env.BRIGHTDATA_USERNAME;
const BRIGHTDATA_PASSWORD = process.env.BRIGHTDATA_PASSWORD;
// This is the special WebSocket URL for the Scraping Browser
const SBR_WS_ENDPOINT = `wss://${BRIGHTDATA_USERNAME}:${BRIGHTDATA_PASSWORD}@brd.superproxy.io:9222`;

const useProxy = BRIGHTDATA_USERNAME && BRIGHTDATA_PASSWORD;

if (!GOOGLE_MAPS_API_KEY) {
    console.error("ERROR: MAPS_API_KEY not found in .env file!");
    process.exit(1);
}

app.use(cors());
app.use(express.json());

app.get('/api/config', (req, res) => {
    res.json({
        googleMapsApiKey: GOOGLE_MAPS_API_KEY
    });
});

const publicPath = path.join(__dirname, '..', 'public');
app.use(express.static(publicPath, { index: false }));

app.get(/(.*)/, (req, res) => {
    const indexPath = path.join(publicPath, 'index.html');
    fs.readFile(indexPath, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading index.html:', err);
            return res.status(500).send('Error loading the application.');
        }
        const modifiedHtml = data.replace(PLACEHOLDER_KEY, GOOGLE_MAPS_API_KEY);
        res.send(modifiedHtml);
    });
});

io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);
    socket.emit('log', `[Server] Connected to Real-time Scraper.`);

    socket.on('start_scrape', async ({ category, location, postalCode, country, count, businessName }) => {
        if (!useProxy) {
            return socket.emit('scrape_error', { error: `Bright Data credentials not configured in .env file.` });
        }

        const isIndividualSearch = !!businessName;
        const finalCount = isIndividualSearch ? -1 : count;
        const isSearchAll = finalCount === -1;
        const targetCount = isSearchAll ? Infinity : finalCount;
        const areaQuery = [location, postalCode].filter(Boolean).join(' ');

        if (!areaQuery || !country) {
            socket.emit('scrape_error', { error: `Missing location or country data.` });
            return;
        }

        let searchQuery = isIndividualSearch
            ? `${businessName}, ${areaQuery}, ${country}`
            : `${category} in ${areaQuery}, ${country}`;
        
        socket.emit('log', `[Server] Starting search for "${searchQuery}"`);

        let browser;
        try {
            // --- NEW CONNECTION LOGIC ---
            // Instead of launching a local browser, we connect to Bright Data's remote browser
            socket.emit('log', `[Server] Connecting to Bright Data's Scraping Browser...`);
            browser = await puppeteer.connect({
                browserWSEndpoint: SBR_WS_ENDPOINT,
            });
            socket.emit('log', `[Server] Connected!`);

            const allProcessedBusinesses = [];
            const allDiscoveredUrls = new Set();
            const MAX_URLS_TO_FIND = isSearchAll ? 750 : Math.max(count * 5, 50);

            // --- Phase 1: Collect URLs ---
            socket.emit('log', `[Server] Starting URL collection phase...`);
            const collectionPage = await browser.newPage();
            
            const newlyDiscoveredUrls = await collectGoogleMapsUrlsContinuously(collectionPage, searchQuery, socket, MAX_URLS_TO_FIND, new Set());
            newlyDiscoveredUrls.forEach(url => allDiscoveredUrls.add(url));
            
            await collectionPage.close();

            // --- Phase 2: Process URLs in parallel ---
            const urlList = Array.from(allDiscoveredUrls);
            socket.emit('log', `-> URL Collection complete. Found ${urlList.length} unique listings. Now processing...`);
            
            const CONCURRENCY = 4;
            let processedCount = 0;

            for (let i = 0; i < urlList.length; i += CONCURRENCY) {
                if (allProcessedBusinesses.length >= targetCount) break;

                const batch = urlList.slice(i, i + CONCURRENCY);
                
                const promises = batch.map(async (urlToProcess) => {
                    let detailPage;
                    try {
                        detailPage = await browser.newPage();
                        await detailPage.setRequestInterception(true);
                        detailPage.on('request', (req) => {
                            if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) req.abort();
                            else req.continue();
                        });

                        let googleData = await scrapeGoogleMapsDetails(detailPage, urlToProcess, socket, country);
                        if (!googleData || !googleData.BusinessName) return null;

                        let websiteData = {};
                        if (googleData.Website) {
                            websiteData = await scrapeWebsiteForGoldData(detailPage, googleData.Website, socket);
                        }

                        const fullBusinessData = { ...googleData, ...websiteData, Category: isIndividualSearch ? (googleData.ScrapedCategory || 'N/A') : category };
                        return fullBusinessData;
                    } catch (innerError) {
                        socket.emit('log', `Error processing URL (${urlToProcess}): ${innerError.message.split('\n')[0]}. Skipping.`, 'error');
                        return null;
                    } finally {
                        if (detailPage) await detailPage.close();
                    }
                });
                
                const results = await Promise.all(promises);

                results.forEach(businessData => {
                    processedCount++;
                     if (businessData && allProcessedBusinesses.length < targetCount) {
                        allProcessedBusinesses.push(businessData);
                        socket.emit('log', `-> ADDED: ${businessData.BusinessName}.`);
                    }
                    socket.emit('progress_update', {
                        processed: processedCount,
                        discovered: urlList.length,
                        added: allProcessedBusinesses.length,
                        target: finalCount
                    });
                });
            }

            socket.emit('log', `Scraping completed. Found and processed ${allProcessedBusinesses.length} businesses.`);
            socket.emit('scrape_complete', allProcessedBusinesses);

        } catch (error) {
            console.error('A critical error occurred:', error);
            socket.emit('scrape_error', { error: `Critical failure: ${error.message.split('\n')[0]}` });
        } finally {
            if (browser) await browser.disconnect(); // Use .disconnect() for remote browsers
        }
    });

    socket.on('disconnect', () => console.log(`Client disconnected: ${socket.id}`));
});

// The scraping helper functions below remain largely the same, but are now more resilient.
// The selectors should now work because Bright Data will serve the correct page.
async function collectGoogleMapsUrlsContinuously(page, searchQuery, socket, maxUrlsToCollect, processedUrlSet) {
    await page.setViewport({ width: 1920, height: 1080 }); // Behave like a real desktop
    const newlyDiscoveredUrls = new Set();
    const resultsContainerSelector = 'div[role="feed"]';
    
    await page.goto('https://www.google.com/maps', { waitUntil: 'domcontentloaded', timeout: 60000 });
    try {
        await page.waitForSelector('form[action^="https://consent.google.com"] button', { timeout: 15000 });
        await page.click('form[action^="https://consent.google.com"] button');
        socket.emit('log', '   -> Accepted Google consent dialog.');
    } catch (e) { /* Consent dialog may not appear */ }

    await page.type('#searchboxinput', searchQuery);
    await page.click('#searchbox-searchbutton');

    try {
        await page.waitForSelector(resultsContainerSelector, { timeout: 60000 });
        socket.emit('log', `   -> Initial search results container loaded.`);
    } catch (error) {
        socket.emit('log', `Error: Google Maps results container not found after search.`, 'error');
        await page.screenshot({ path: 'debug_results_not_found.png' }); // Useful for debugging
        return [];
    }
    
    let lastScrollHeight = 0;
    let consecutiveNoProgressAttempts = 0;
    const MAX_CONSECUTIVE_NO_PROGRESS = 7; 

    while (newlyDiscoveredUrls.size < maxUrlsToCollect && consecutiveNoProgressAttempts < MAX_CONSECUTIVE_NO_PROGRESS) {
        const currentVisibleUrls = await page.$$eval(`${resultsContainerSelector} a[href*="https://www.google.com/maps/place/"]`, links => links.map(link => link.href));
        let newUrlsFoundInIteration = 0;
        currentVisibleUrls.forEach(url => {
            if (!processedUrlSet.has(url) && !newlyDiscoveredUrls.has(url)) {
                newlyDiscoveredUrls.add(url); 
                newUrlsFoundInIteration++;
            }
        });

        if (newUrlsFoundInIteration > 0) {
            socket.emit('log', `   -> Discovered ${newUrlsFoundInIteration} new URLs. Total found this session: ${newlyDiscoveredUrls.size}.`);
        }
        await page.evaluate(sel => document.querySelector(sel)?.scrollTo(0, document.querySelector(sel).scrollHeight), resultsContainerSelector);
        await new Promise(r => setTimeout(r, 3000));
        const newScrollHeight = await page.evaluate(sel => document.querySelector(sel)?.scrollHeight || 0, resultsContainerSelector);
        
        if (newScrollHeight > lastScrollHeight) {
            consecutiveNoProgressAttempts = 0; 
        } else {
            consecutiveNoProgressAttempts++;
            socket.emit('log', `   -> No scroll progress. Attempt ${consecutiveNoProgressAttempts}/${MAX_CONSECUTIVE_NO_PROGRESS}.`);
        }
        lastScrollHeight = newScrollHeight;
    }
    
    return Array.from(newlyDiscoveredUrls); 
}

async function scrapeGoogleMapsDetails(page, url, socket, country) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForSelector('h1', {timeout: 60000});
    
    return page.evaluate((countryCode) => {
        const cleanText = text => text?.replace(/^[^a-zA-Z0-9\s.,'#\-+/&_]+/u, '').replace(/\p{Z}/gu, ' ').replace(/[\u0000-\u001F\u007F-\u009F\uFEFF\n\r]/g, '').replace(/\s+/g, ' ').trim() || '';
        const cleanPhoneNumber = (num, country) => {
            if (!num) return '';
            let cleaned = String(num).trim().replace(/\D/g, '');
            if (country?.toLowerCase() === 'australia') {
                if (cleaned.startsWith('0')) cleaned = '61' + cleaned.substring(1);
                else if (!cleaned.startsWith('61') && cleaned.length >= 8 && cleaned.length <= 10) cleaned = '61' + cleaned;
            }
            return cleaned.startsWith('+') ? cleaned.substring(1) : cleaned; 
        };
        return {
            BusinessName: cleanText(document.querySelector('h1')?.innerText),
            ScrapedCategory: cleanText(document.querySelector('[jsaction*="category"]')?.innerText),
            StreetAddress: cleanText(document.querySelector('button[data-item-id="address"]')?.innerText),
            Website: document.querySelector('a[data-item-id="authority"]')?.href || '',
            Phone: cleanPhoneNumber(document.querySelector('button[data-item-id*="phone"]')?.innerText, countryCode),
            GoogleMapsURL: window.location.href,
        };
    }, country);
}

async function scrapeWebsiteForGoldData(page, websiteUrl, socket) {
    const data = { Email: '', InstagramURL: '', FacebookURL: '', OwnerName: '' };
    try {
        await page.goto(websiteUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        const pageText = await page.evaluate(() => document.body.innerText);
        const links = await page.$$eval('a', as => as.map(a => a.href));
        
        data.InstagramURL = links.find(href => href.includes('instagram.com')) || '';
        data.FacebookURL = links.find(href => href.includes('facebook.com')) || '';

        const mailto = links.find(href => href.startsWith('mailto:'));
        data.Email = mailto ? mailto.replace('mailto:', '').split('?')[0] : '';
        if (!data.Email) {
            const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
            const emails = pageText.match(emailRegex) || [];
            const genericWords = ['support', 'admin', 'office', 'sales', 'info', 'hello', 'enquiries', 'email'];
            const personalEmail = emails.find(e => !genericWords.some(w => e.startsWith(w)) && !e.includes('wix') && !e.includes('squarespace'));
            data.Email = personalEmail || emails[0] || '';
        }

        const ownerKeywords = ['owner', 'founder', 'director', 'principal', 'proprietor', 'ceo'];
        const textLines = pageText.split(/[\n\r]+/).map(line => line.trim());
        for (const line of textLines) {
            for (const title of ownerKeywords) {
                if (line.toLowerCase().includes(title)) {
                    let potentialName = line.split(new RegExp(title, 'i'))[0].trim().replace(/,$/, '');
                    const words = potentialName.split(' ').filter(Boolean);
                    if (words.length >= 2 && words.length <= 4 && potentialName.length > 3) {
                        data.OwnerName = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                        break;
                    }
                }
            }
            if (data.OwnerName) break;
        }

    } catch (error) {
        socket.emit('log', `   -> Could not scrape ${websiteUrl}. Error: ${error.message.split('\n')[0]}`);
    }
    return data;
}

server.listen(PORT, () => {
    console.log(`Scraping server running on http://localhost:${PORT}`);
});