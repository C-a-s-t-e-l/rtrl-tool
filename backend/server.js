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

const BRIGHTDATA_HOST = process.env.BRIGHTDATA_HOST;
const BRIGHTDATA_PORT = process.env.BRIGHTDATA_PORT;
const BRIGHTDATA_USERNAME = process.env.BRIGHTDATA_USERNAME;
const BRIGHTDATA_PASSWORD = process.env.BRIGHTDATA_PASSWORD;
const BRIGHTDATA_API_TOKEN = process.env.BRIGHTDATA_API_TOKEN;
const useProxy = BRIGHTDATA_HOST && BRIGHTDATA_USERNAME && BRIGHTDATA_PASSWORD;

if (!GOOGLE_MAPS_API_KEY || !BRIGHTDATA_API_TOKEN) {
    console.error("ERROR: MAPS_API_KEY or BRIGHTDATA_API_TOKEN not found in .env file!");
    process.exit(1);
}

app.use(cors());
app.use(express.json());
app.get('/api/config', (req, res) => res.json({ googleMapsApiKey: GOOGLE_MAPS_API_KEY }));

const containerPublicPath = path.join(__dirname, 'public');
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
    console.log(`Client connected: ${socket.id}`);
    socket.emit('log', `[Server] Connected to Real-time Scraper.`);

    socket.on('start_scrape', async ({ category, location, postalCode, country, count, businessName }) => {
        const isIndividualSearch = !!businessName;
        const finalCount = isIndividualSearch ? -1 : count;
        const isSearchAll = finalCount === -1;
        const targetCount = isSearchAll ? Infinity : finalCount;
        const areaQuery = [location, postalCode].filter(Boolean).join(' ');

        if (!areaQuery || !country) return socket.emit('scrape_error', { error: `Missing location or country data.` });
        
        const searchQuery = isIndividualSearch ? `${businessName}, ${areaQuery}, ${country}` : `${category} in ${areaQuery}, ${country}`;
        socket.emit('log', `[Server] Starting search for "${searchQuery}"`);
        
        let browser;
        try {
            const puppeteerArgs = [
                '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                '--disable-gpu', '--no-zygote', '--lang=en-US,en', '--ignore-certificate-errors'
            ];
            
            if (useProxy) {
                const proxyServer = `http://${BRIGHTDATA_HOST}:${BRIGHTDATA_PORT}`;
                puppeteerArgs.push(`--proxy-server=${proxyServer}`);
                socket.emit('log', `[Server] Using Bright Data proxy server for detail scraping.`);
            }

            // --- KEY CHANGE #1: Pointing to the pre-installed browser in the Docker image ---
            browser = await puppeteer.launch({ 
                headless: true, 
                args: puppeteerArgs, 
                protocolTimeout: 120000,
                executablePath: '/usr/bin/google-chrome'
            });
            
            const allProcessedBusinesses = [];
            let allDiscoveredUrls = new Set();

            socket.emit('log', `[Server] Starting URL collection phase via Puppeteer...`);
            // --- KEY CHANGE #2: Passing the browser instance to the collection function ---
            const newlyDiscoveredUrls = await collectGoogleMapsUrlsContinuously(browser, searchQuery, socket);
            
            allDiscoveredUrls = new Set(newlyDiscoveredUrls);

            socket.emit('log', `-> URL Collection complete. Discovered ${allDiscoveredUrls.size} unique listings. Now processing...`);
            
            if (allDiscoveredUrls.size === 0) {
                 socket.emit('log', 'No business URLs were found. The scrape cannot proceed. This might be due to a change in Google Maps page structure.', 'error');
            }

            let totalRawUrlsAttemptedDetails = 0;
            const urlList = Array.from(allDiscoveredUrls);
            const CONCURRENCY = 4;

            for (let i = 0; i < urlList.length; i += CONCURRENCY) {
                if (allProcessedBusinesses.length >= targetCount) break;
                const batch = urlList.slice(i, i + CONCURRENCY);
                const promises = batch.map(async (urlToProcess) => {
                    let detailPage;
                    try {
                        detailPage = await browser.newPage();
                        if (useProxy) {
                            await detailPage.authenticate({ username: BRIGHTDATA_USERNAME, password: BRIGHTDATA_PASSWORD });
                        }
                        await detailPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36');
                        await detailPage.setRequestInterception(true);
                        detailPage.on('request', (req) => { if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) req.abort(); else req.continue(); });

                        let googleData = await scrapeGoogleMapsDetails(detailPage, urlToProcess, socket, country);
                        if (!googleData || !googleData.BusinessName) return null;
                        let websiteData = {};
                        if (googleData.Website) {
                           websiteData = await scrapeWebsiteForGoldData(detailPage, googleData.Website, socket);
                        }
                        const fullBusinessData = { ...googleData, ...websiteData };
                        fullBusinessData.Category = isIndividualSearch ? (googleData.ScrapedCategory || 'N/A') : category;
                        return fullBusinessData;
                    } catch (detailError) {
                        socket.emit('log', `Error processing URL (${urlToProcess}): ${detailError.message.split('\n')[0]}. Skipping.`, 'error');
                        return null;
                    } finally {
                        if (detailPage) await detailPage.close();
                    }
                });

                const results = await Promise.all(promises);

                results.forEach(businessData => {
                    totalRawUrlsAttemptedDetails++;
                    if (businessData && allProcessedBusinesses.length < targetCount) {
                        allProcessedBusinesses.push(businessData);
                        socket.emit('log', `-> ADDED: ${businessData.BusinessName}.`);
                    }
                    socket.emit('progress_update', { processed: totalRawUrlsAttemptedDetails, discovered: allDiscoveredUrls.size, added: allProcessedBusinesses.length, target: finalCount });
                });
            }

            socket.emit('log', `Scraping completed. Found and processed a total of ${allProcessedBusinesses.length} businesses.`);
            socket.emit('scrape_complete', allProcessedBusinesses);

        } catch (error) {
            console.error('A critical error occurred:', error);
            socket.emit('scrape_error', { error: `Critical failure: ${error.message.split('\n')[0]}` });
        } finally {
            if (browser) await browser.close();
        }
    });

    socket.on('disconnect', () => console.log(`Client disconnected: ${socket.id}`));
});

// ===================================================================================
// == KEY CHANGE #3: THE DEFINITIVE SOLUTION USING PUPPETEER TO PARSE JAVASCRIPT    ==
// ===================================================================================
async function collectGoogleMapsUrlsContinuously(browser, searchQuery, socket) {
    socket.emit('log', '   -> Using a headless browser to collect URLs...');
    let page;
    try {
        const urlToScrape = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;
        
        page = await browser.newPage();
        
        // This page instance will inherit the proxy settings from the browser,
        // but we still need to authenticate for this specific page's requests.
        if (useProxy) {
            await page.authenticate({ username: BRIGHTDATA_USERNAME, password: BRIGHTDATA_PASSWORD });
        }
        
        await page.goto(urlToScrape, { waitUntil: 'domcontentloaded', timeout: 120000 });

        // Wait until the data object we need actually exists on the page.
        await page.waitForFunction('window.APP_INITIALIZATION_STATE', { timeout: 30000 });
        
        // Directly evaluate the JavaScript on the page and get the fully-formed object.
        const data = await page.evaluate(() => window.APP_INITIALIZATION_STATE);

        let searchResults = [];
        if (data?.[0]?.[1]) {
            for (const component of data[0][1]) {
                const potentialResults = component?.[14];
                if (potentialResults && Array.isArray(potentialResults) && potentialResults.some(r => r?.[6]?.[43])) {
                    searchResults = potentialResults;
                    break;
                }
            }
        }

        let foundUrls = [];
        if (searchResults.length > 0) {
            for (const result of searchResults) {
                const businessData = result?.[6];
                if (businessData) {
                    const placeName = businessData[11];
                    const partialUrl = businessData[43];
                    if (placeName && partialUrl && typeof partialUrl === 'string') {
                        const fullUrl = `https://www.google.com${partialUrl}`;
                        foundUrls.push(fullUrl);
                    }
                }
            }
        }

        const uniqueUrls = [...new Set(foundUrls)];
        socket.emit('log', `   -> Browser-based parser found ${uniqueUrls.length} unique URLs from embedded data.`);
        return uniqueUrls;

    } catch (error) {
        console.error('URL Collection via Puppeteer failed:', error);
        socket.emit('log', `CRITICAL ERROR: Failed to collect URLs with browser. Details: ${error.message.split('\n')[0]}`, 'error');
        return []; // Return an empty array on failure
    } finally {
        // IMPORTANT: Close the temporary page to free up memory.
        if (page) {
            await page.close();
        }
    }
}
// ===================================================================================
// == END OF DEFINITIVE SOLUTION                                                    ==
// ===================================================================================

async function scrapeGoogleMapsDetails(page, url, socket, country) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForSelector('h1', {timeout: 90000});
    
    return page.evaluate((countryCode) => {
        const cleanText = (text) => text?.replace(/^[^a-zA-Z0-9\s.,'#\-+/&_]+/u, '').replace(/\p{Z}/gu, ' ').replace(/[\u0000-\u001F\u007F-\u009F\uFEFF\n\r]/g, '').replace(/\s+/g, ' ').trim() || '';
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
        await page.goto(websiteUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const ownerTitleKeywords = ['owner', 'founder', 'director', 'principal', 'proprietor', 'ceo'];
        const pageText = await page.evaluate(() => document.body.innerText);
        const links = await page.$$eval('a', as => as.map(a => a.href));
        data.InstagramURL = links.find(href => href.includes('instagram.com')) || '';
        data.FacebookURL = links.find(href => href.includes('facebook.com')) || '';
        const mailto = links.find(href => href.startsWith('mailto:'));
        data.Email = mailto ? mailto.replace('mailto:', '').split('?')[0] : '';
        if (!data.Email) {
            const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
            const emails = pageText.match(emailRegex) || [];
            data.Email = emails[0] || '';
        }
        const textLines = pageText.split(/[\n\r]+/).map(line => line.trim());
        for (const line of textLines) {
            for (const title of ownerTitleKeywords) {
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
    //test57
});
