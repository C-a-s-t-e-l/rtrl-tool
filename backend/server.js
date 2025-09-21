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
    
    if (!match) {
        return false;
    }
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
        if (postalCode && postalCode.length > 0) {
            searchAreas = postalCode;
        } else if (location) {
            searchAreas = [location];
        }

        if (searchAreas.length === 0 || !country) {
            return socket.emit('scrape_error', { error: `Missing location/postcode or country data.` });
        }
        
        let browser;
        try {
            const puppeteerArgs = [
                '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                '--disable-gpu', '--no-zygote', '--lang=en-US,en', '--ignore-certificate-errors',
                '--window-size=1920,1080', '--disable-blink-features=AutomationControlled'
            ];
            
            browser = await puppeteer.launch({ 
                headless: true, 
                args: puppeteerArgs, 
                protocolTimeout: 120000,
            });
            
            const allProcessedBusinesses = [];
            const processedUrlSet = new Set();
            const CONCURRENCY = 4;
            let totalDiscoveredUrls = 0;

            const searchItems = isIndividualSearch ? businessNames : [category];

            for (const item of searchItems) {
                if (allProcessedBusinesses.length >= targetCount) break;
                
                if (isIndividualSearch) {
                    socket.emit('log', `\n--- Now searching for: "${item}" ---`);
                }

                // START FIX: Create one incognito context for this entire search item.
                const itemContext = await browser.createIncognitoBrowserContext();
                try {
                    for (const [areaIndex, areaQuery] of searchAreas.entries()) {
                         if (allProcessedBusinesses.length >= targetCount) break;

                        const baseSearchQuery = isIndividualSearch ? `${item}, ${areaQuery}, ${country}` : `${item} in ${areaQuery}, ${country}`;
                        if (!isIndividualSearch) {
                            socket.emit('log', `\n--- Starting search area ${areaIndex + 1} of ${searchAreas.length}: "${areaQuery}" ---`);
                        }
                    
                        const searchQueries = await getSearchQueriesForLocation(baseSearchQuery, areaQuery, country, socket);
                    
                        for (const [index, query] of searchQueries.entries()) {
                            if (allProcessedBusinesses.length >= targetCount) break;

                            socket.emit('log', `--- Scraping sub-area ${index + 1} of ${searchQueries.length}: "${query}" ---`);
                            
                            const discoveredUrlsForThisArea = new Set();
                            // Pass the context to the URL collector
                            await collectGoogleMapsUrlsContinuously(itemContext, query, socket, Infinity, discoveredUrlsForThisArea, country);
                            
                            let newUniqueUrls = Array.from(discoveredUrlsForThisArea).filter(url => !processedUrlSet.has(url));
                            
                            const boundingBox = countryBoundingBoxes[country.toLowerCase()];
                            if (boundingBox) {
                                newUniqueUrls = newUniqueUrls.filter(url => isUrlInBoundingBox(url, boundingBox));
                            }
                            
                            if (newUniqueUrls.length === 0) {
                                socket.emit('log', `   -> No new unique businesses found for this query. Moving to next.`);
                                continue;
                            }

                            newUniqueUrls.forEach(url => processedUrlSet.add(url));
                            totalDiscoveredUrls = processedUrlSet.size;

                            socket.emit('log', `   -> Discovered ${newUniqueUrls.length} new listings. Total unique: ${totalDiscoveredUrls}. Now processing details...`);

                            const urlList = newUniqueUrls;

                            for (let i = 0; i < urlList.length; i += CONCURRENCY) {
                                if (allProcessedBusinesses.length >= targetCount) break;
                                const batch = urlList.slice(i, i + CONCURRENCY);

                                const promises = batch.map(async (urlToProcess) => {
                                    if (allProcessedBusinesses.length >= targetCount) return null;
                                
                                    return promiseWithTimeout(
                                        (async () => {
                                            let detailPage;
                                            try {
                                                // Create pages from the shared item context
                                                detailPage = await itemContext.newPage();
                                                await detailPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36');
                                                await detailPage.setRequestInterception(true);
                                                detailPage.on('request', (req) => { if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) req.abort(); else req.continue(); });
                                                
                                                let googleData = await scrapeGoogleMapsDetails(detailPage, urlToProcess, socket, country);
                                                if (!googleData || !googleData.BusinessName) return null;
                                                
                                                let websiteData = {};
                                                if (googleData.Website) { websiteData = await scrapeWebsiteForGoldData(detailPage, googleData.Website, socket); }
                                                
                                                const fullBusinessData = { ...googleData, ...websiteData };
                                                fullBusinessData.Category = isIndividualSearch ? (googleData.ScrapedCategory || 'N/A') : category;
                                                return fullBusinessData;
                                            } finally {
                                                if (detailPage) await detailPage.close();
                                            }
                                        })(), 
                                        120000
                                    ).catch(err => {
                                        socket.emit('log', `A task for ${urlToProcess} failed or timed out: ${err.message}. Skipping.`, 'error');
                                        return null;
                                    });
                                });

                                const results = await Promise.all(promises);
                                results.forEach(businessData => {
                                    if (businessData && allProcessedBusinesses.length < targetCount) {
                                        allProcessedBusinesses.push(businessData);
                                        const status = isSearchAll 
                                            ? `(Total Added: ${allProcessedBusinesses.length})` 
                                            : `(${allProcessedBusinesses.length}/${finalCount})`;
                                        socket.emit('log', `-> ADDED: ${businessData.BusinessName}. ${status}`);
                                        socket.emit('business_found', businessData);
                                    }
                                    socket.emit('progress_update', { processed: allProcessedBusinesses.length, discovered: totalDiscoveredUrls, added: allProcessedBusinesses.length, target: finalCount });
                                });
                            }
                        }
                    }
                } finally {
                    await itemContext.close(); // Close the context when done with this item
                }
                // END FIX
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

    socket.on('disconnect', () => 
  console.log(`Client disconnected: ${socket.id} at ${new Date().toLocaleString()}`)
);

});

async function getSearchQueriesForLocation(searchQuery, areaQuery, country, socket) {
    socket.emit('log', `   -> Geocoding "${areaQuery}, ${country}" to determine search area...`);

    const isPostcodeSearch = /^\d{4}$/.test(areaQuery.trim());
    if (isPostcodeSearch) {
        socket.emit('log', `   -> Postcode search detected. Forcing a single, specific search.`);
        return [searchQuery];
    }

    try {
        const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(`${areaQuery}, ${country}`)}&key=${GOOGLE_MAPS_API_KEY}`;
        const response = await axios.get(geocodeUrl);
        
        if (response.data.status !== 'OK') {
            socket.emit('log', `   -> Geocoding failed: ${response.data.status}. Using a single search.`, 'error');
            if (response.data.error_message) {
                socket.emit('log', `   -> Google's reason: ${response.data.error_message}`, 'error');
            }
            return [searchQuery];
        }

        const { results } = response.data;
        const location = results[0];

        const isPostcodeResult = location.types.includes('postal_code');
        if (isPostcodeResult) {
            socket.emit('log', `   -> Search term resolved to a specific postcode. Forcing a single search.`);
            return [searchQuery];
        }

        const { northeast, southwest } = location.geometry.viewport;
        const lat_dist = northeast.lat - southwest.lat;
        const lng_dist = northeast.lng - southwest.lng;
        const diagonal_dist = Math.sqrt(lat_dist*lat_dist + lng_dist*lng_dist);

        if (diagonal_dist < 0.2) {
            socket.emit('log', `   -> Location is specific enough. Using a single search for "${areaQuery}".`);
            return [searchQuery];
        }

        const GRID_SIZE = 5;
        const searchQueries = [];
        const categoryPart = searchQuery.split(' in ')[0];
        socket.emit('log', `   -> Location is a large region. Generating a ${GRID_SIZE}x${GRID_SIZE} search grid.`);

        for (let i = 0; i < GRID_SIZE; i++) {
            for (let j = 0; j < GRID_SIZE; j++) {
                const point_lat = southwest.lat + lat_dist * (i / (GRID_SIZE - 1));
                const point_lng = southwest.lng + lng_dist * (j / (GRID_SIZE - 1));
                const newQuery = `${categoryPart} near ${point_lat.toFixed(6)},${point_lng.toFixed(6)}`;
                searchQueries.push(newQuery);
            }
        }
        
        socket.emit('log', `   -> Generated ${searchQueries.length} specific search queries to cover the area.`);
        return searchQueries;

    } catch (error) {
        socket.emit('log', `   -> Geocoding API call failed: ${error.message}. Defaulting to single search.`, 'error');
        return [searchQuery];
    }
}

// START FIX: Function now accepts a browser context instead of a full browser instance
async function collectGoogleMapsUrlsContinuously(context, searchQuery, socket, targetCount, processedUrlSet, country) {
// END FIX
    let page;
    try {
        const countryNameToCode = {
            'australia': 'AU', 'new zealand': 'NZ', 'united states': 'US',
            'united kingdom': 'GB', 'canada': 'CA', 'germany': 'DE',
            'france': 'FR', 'spain': 'ES', 'italy': 'IT',
            'japan': 'JP', 'singapore': 'SG', 'hong kong': 'HK',
            'philippines': 'PH'
        };

        const countryCode = countryNameToCode[country.toLowerCase()];
        const countryParam = countryCode ? `?cr=country${countryCode}` : '';

        let searchUrl;
        if (searchQuery.includes(' near ')) {
            const parts = searchQuery.split(' near ');
            const categoryPart = parts[0];
            const coordsPart = parts[1];
            searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(categoryPart)}/@${coordsPart},12z${countryParam}`;
        } else {
            searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}${countryParam}`;
        }

        socket.emit('log', `   -> Navigating directly to search: ${searchQuery}`);
        
        page = await context.newPage();
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        try {
            const acceptButtonSelector = 'form[action^="https://consent.google.com"] button';
            await page.waitForSelector(acceptButtonSelector, { timeout: 10000 });
            await page.click(acceptButtonSelector);
            socket.emit('log', '   -> Accepted Google consent dialog.');
        } catch (e) { 
            socket.emit('log', '   -> No Google consent dialog found, proceeding.');
        }

        const feedSelector = 'div[role="feed"]';
        try {
            await page.waitForSelector(feedSelector, { timeout: 45000 });
            socket.emit('log', `   -> Initial search results loaded.`);
        } catch (error) {
            socket.emit('log', `   -> Could not find results list. Google may have blocked this search or found no results. Skipping.`, 'error');
            await page.screenshot({ path: `error_no_feed_${Date.now()}.png` }); // Take a screenshot for debugging
            return;
        }

        let consecutiveNoProgressAttempts = 0;
        const MAX_NO_PROGRESS = 5;
        const initialSize = processedUrlSet.size;

        while (processedUrlSet.size < targetCount && consecutiveNoProgressAttempts < MAX_NO_PROGRESS) {
            const previousSize = processedUrlSet.size;
            const visibleUrls = await page.$$eval('a[href*="/maps/place/"]', links => links.map(link => link.href));
            visibleUrls.forEach(url => processedUrlSet.add(url));

            if (processedUrlSet.size > previousSize) {
                consecutiveNoProgressAttempts = 0;
                socket.emit('log', `   -> Scrolled. Total unique discovered: ${processedUrlSet.size}`);
            } else {
                consecutiveNoProgressAttempts++;
                socket.emit('log', `   -> No new URLs found. Attempt ${consecutiveNoProgressAttempts}/${MAX_NO_PROGRESS}.`);
            }
            
            if (processedUrlSet.size >= targetCount && targetCount !== Infinity) break;
            
            await page.evaluate((selector) => {
                const feed = document.querySelector(selector);
                if (feed) feed.scrollTop = feed.scrollHeight;
            }, feedSelector);
            await new Promise(r => setTimeout(r, 2000));
        }
        socket.emit('log', `   -> Finished this area. Found ${processedUrlSet.size - initialSize} new listings.`);

    } catch (error) {
        console.error('URL Collection via scrolling failed:', error);
        socket.emit('log', `CRITICAL ERROR: URL Collection failed. Details: ${error.message.split('\n')[0]}`, 'error');
        if (page) await page.screenshot({ path: `error_${Date.now()}.png` });
    } finally {
        if (page) await page.close();
    }
}

// --- The rest of the file (scrapeGoogleMapsDetails, scrapePageContent, scrapeWebsiteForGoldData, etc.) remains unchanged. ---

async function scrapeGoogleMapsDetails(page, url, socket, country) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForSelector('h1', {timeout: 60000});
    
    return page.evaluate((countryCode) => {
        const cleanText = (text) => {
            if (!text) return '';
            let cleaned = String(text).replace(/^[^a-zA-Z0-9\s]+/, '');
            return cleaned.replace(/[\u0000-\u001F\u007F-\u009F\uFEFF\n\r]/g, '').replace(/\s+/g, ' ').trim();
        };

        const cleanPhoneNumber = (num, country) => {
            if (!num) return '';
            let cleaned = String(num).trim().replace(/\D/g, '');
            if (country?.toLowerCase() === 'australia') {
                if (cleaned.startsWith('0')) cleaned = '61' + cleaned.substring(1);
                else if (!cleaned.startsWith('61') && cleaned.length >= 8 && cleaned.length <= 10) cleaned = '61' + cleaned;
            }
            return cleaned.startsWith('+') ? cleaned.substring(1) : cleaned; 
        };
        
        const data = {
            BusinessName: cleanText(document.querySelector('h1')?.innerText),
            ScrapedCategory: cleanText(document.querySelector('[jsaction*="category"]')?.innerText),
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
                const suburb = suburbPart.replace(/\s[A-Z]{2,3}\s\d{4,}/, '').trim();
                data.Suburb = suburb;
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
    for (const line of textLines) {
        for (const title of ownerTitleKeywords) {
            if (line.toLowerCase().includes(title)) {
                let potentialName = line.split(new RegExp(title, 'i'))[0].trim().replace(/,$/, '');
                const words = potentialName.split(' ').filter(Boolean);
                if (words.length >= 2 && words.length <= 4 && words.length > 0) {
                    ownerName = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                    break;
                }
            }
        }
        if (ownerName) break;
    }
    
    return { emails, ownerName };
}

async function scrapeWebsiteForGoldData(page, websiteUrl, socket) {
    const data = { 
        OwnerName: '', 
        InstagramURL: '', 
        FacebookURL: '',
        Email1: '',
        Email2: '',
        Email3: ''
    };
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
        const keyPageLinks = initialLinks.filter(link => 
            pageKeywords.some(keyword => link.href.toLowerCase().includes(keyword) || link.text.toLowerCase().includes(keyword))
        ).map(link => link.href);

        const uniqueKeyPages = [...new Set(keyPageLinks)].slice(0, 3);

        for (const linkUrl of uniqueKeyPages) {
            try {
                socket.emit('log', `   -> Checking sub-page: ${linkUrl.substring(0, 50)}...`);
                await page.goto(linkUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
                const subsequentPageData = await scrapePageContent(page);
                subsequentPageData.emails.forEach(e => allFoundEmails.add(e.toLowerCase()));
                if (subsequentPageData.ownerName) finalOwnerName = subsequentPageData.ownerName;
            } catch (e) {
                socket.emit('log', `   -> Could not load sub-page ${linkUrl.substring(0, 50)}. Skipping.`);
            }
        }

        data.OwnerName = finalOwnerName;
        const emailsArray = Array.from(allFoundEmails);
        
        if (emailsArray.length > 0) {
            const genericEmailPrefixes = ['info@', 'contact@', 'support@', 'sales@', 'admin@', 'hello@', 'enquiries@'];
            
            const nameMatchEmails = [];
            const personalEmails = [];
            const genericEmails = [];

            if (finalOwnerName) {
                const nameParts = finalOwnerName.toLowerCase().split(' ');
                const firstName = nameParts[0];
                emailsArray.forEach(email => {
                    if (email.toLowerCase().includes(firstName)) {
                        nameMatchEmails.push(email);
                    }
                });
            }

            emailsArray.forEach(email => {
                const isGeneric = genericEmailPrefixes.some(prefix => email.toLowerCase().startsWith(prefix));
                const isNameMatch = nameMatchEmails.includes(email);
                if (!isNameMatch && !isGeneric) {
                    personalEmails.push(email);
                } else if (!isNameMatch && isGeneric) {
                    genericEmails.push(email);
                }
            });

            const rankedEmails = [...new Set([...nameMatchEmails, ...personalEmails, ...genericEmails])];
            
            data.Email1 = rankedEmails[0] || '';
            data.Email2 = rankedEmails[1] || '';
            data.Email3 = rankedEmails[2] || '';
        }

    } catch (error) {
        socket.emit('log', `   -> Could not scrape ${websiteUrl}. Error: ${error.message.split('\n')[0]}`);
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

server.listen(PORT, () => {
    console.log(`Scraping server running on http://localhost:${PORT}`);
});