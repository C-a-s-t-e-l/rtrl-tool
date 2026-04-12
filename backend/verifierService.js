const axios = require('axios');
const puppeteer = require('puppeteer-extra');


//  TOGGLE THIS TO 'false' WHEN THE KAIJU SITE IS BACK UP

const MAINTENANCE_MODE = false; 

let currentKaijuKey = "";
let lastFailedAttempt = 0;
const THIRTY_MINUTES = 30 * 60 * 1000;

async function refreshKaijuKey() {
    
    if (MAINTENANCE_MODE) return null;

    const now = Date.now();
    if (now - lastFailedAttempt < THIRTY_MINUTES) return null;

    console.log("[Verifier] Key missing or expired. Attempting to scrape new key...");
    
    const browser = await puppeteer.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    
    const page = await browser.newPage();
    
    try {
        await page.goto('https://kaijuverifier.com/api-docs', { waitUntil: 'networkidle2', timeout: 20000 });
        
        const key = await page.evaluate(() => {
            const regex = /kaiju_temp_[a-f0-9]+/;
            const match = document.body.innerText.match(regex);
            return match ? match[0] : null;
        });

        if (key) {
            currentKaijuKey = key;
            lastFailedAttempt = 0;
            console.log(`[Verifier] New key found: ${currentKaijuKey}`);
            return key;
        }
        throw new Error("Pattern not found");
    } catch (e) {
        lastFailedAttempt = Date.now();
        console.error(`[Verifier] Key scrape failed. Site might be down`);
        return null;
    } finally {
        await browser.close();
    }
}


async function verifyEmail(email) {
    if (!email || !email.includes('@')) return false;

   
    if (MAINTENANCE_MODE) {
        return true; 
    }

    if (!currentKaijuKey) {
        await refreshKaijuKey();
    }

    if (!currentKaijuKey) {
        return true; 
    }

    try {
        const url = `https://api.kaijuverifier.com/v1/verify?email=${encodeURIComponent(email)}&api_key=${currentKaijuKey}`;
        const response = await axios.get(url, { timeout: 5000 });
        return response.data.status !== 'undeliverable';
    } catch (error) {
        if (error.response && error.response.status === 401) {
            currentKaijuKey = "";
        }
        return true; 
    }
}

function getActiveKey() {
    if (MAINTENANCE_MODE) return "Disabled (Maintenance Mode)";
    return currentKaijuKey || "None";
}

module.exports = { verifyEmail, getActiveKey };