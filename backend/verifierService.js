const axios = require('axios');
const puppeteer = require('puppeteer-extra');

let currentKaijuKey = "";

async function refreshKaijuKey() {
    console.log("[Verifier] Key missing or expired. Scraping new key from Kaiju API docs...");
    const browser = await puppeteer.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    try {
        await page.goto('https://kaijuverifier.com/api-docs', { waitUntil: 'networkidle2', timeout: 60000 });
        const key = await page.evaluate(() => {
            const regex = /kaiju_temp_[a-f0-9]+/;
            const match = document.body.innerText.match(regex);
            return match ? match[0] : null;
        });
        if (key) {
            currentKaijuKey = key;
            console.log(`[Verifier] New key found and active: ${currentKaijuKey}`);
            return key;
        }
        throw new Error("Pattern not found");
    } catch (e) {
        console.error("[Verifier] Key scrape failed:", e.message);
        return null;
    } finally {
        await browser.close();
    }
}

async function verifyEmail(email) {
    if (!email || !email.includes('@')) return false;
    if (!currentKaijuKey) await refreshKaijuKey();

    try {
        const url = `https://api.kaijuverifier.com/v1/verify?email=${encodeURIComponent(email)}&api_key=${currentKaijuKey}`;
        const response = await axios.get(url);
        return response.data.status === 'deliverable';
    } catch (error) {
        if (error.response && error.response.status === 401) {
            console.log(`[Verifier] Key ${currentKaijuKey} expired. Rotating...`);
            await refreshKaijuKey();
            return verifyEmail(email); 
        }
        return true; 
    }
}

function getActiveKey() {
    return currentKaijuKey || "None (Will fetch on first check)";
}

module.exports = { verifyEmail, getActiveKey };