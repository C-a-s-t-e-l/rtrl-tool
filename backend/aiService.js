const { GoogleGenAI } = require("@google/genai");
require("dotenv").config();

const apiKey = process.env.GEMINI_API_KEY;
let aiClient = null;

if (apiKey) {
    aiClient = new GoogleGenAI({ apiKey: apiKey });
}

const MODEL_NAME = "gemini-2.5-flash"; 

let requestQueue = Promise.resolve();
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function findBusinessOwnerWithAI(businessName, location, website, jobId, addLog) {
    const task = requestQueue.then(async () => {
        if (!aiClient) return { ownerName: "", source: "" };

        await sleep(2000); 

        try {
            const result = await performAiSearch(businessName, location, website, false);
            
            if (result.isValid) {
                if (addLog) await addLog(jobId, `[AI] Found: ${result.name}`);
                return { ownerName: result.name, source: "AI_Search" };
            }
        } catch (error) {
            console.error("AI Attempt 1 failed:", error.message);
        }

        
        await sleep(3000); 
        
        try {
            const result = await performAiSearch(businessName, location, website, true); 
            
            if (result.isValid) {
                if (addLog) await addLog(jobId, `[AI] Found (Deep Search): ${result.name}`);
                return { ownerName: result.name, source: "AI_Retry" };
            }
        } catch (error) {
            console.error("AI Attempt 2 failed:", error.message);
        }

        return { ownerName: "", source: "AI_Not_Found" };
    });

    requestQueue = task.catch(() => {});
    return task;
}

async function performAiSearch(businessName, location, website, isAggressive) {
    const prompt = isAggressive 
        ? `
        Task: Find the Owner/Director/Principal of "${businessName}" in "${location}".
        Action: Search specifically for "LinkedIn ${businessName} ${location} owner" or "director".
        Rules:
        1. Return the name if you are reasonably confident.
        2. Format: "Name (Title)"
        3. If not found, return "NOT_FOUND".
        `
        : `
        Task: Identify the Owner, Founder, or Principal of "${businessName}" in "${location}".
        Context Url: "${website || ""}"
        Rules:
        1. Search Google/LinkedIn/About Us pages.
        2. REJECT generic headers (e.g. "Our Team", "Welcome").
        3. FORMAT: "Name (Title)".
        4. If NOT found, return: "NOT_FOUND".
        `;

    try {
        const response = await aiClient.models.generateContent({
            model: MODEL_NAME, 
            contents: prompt,
            config: {
                tools: [{ googleSearch: {} }], 
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
                ],
            },
        });

        let text = "";
        if (response.candidates?.[0]?.content?.parts) {
            text = response.candidates[0].content.parts
                .map(part => part.text || "")
                .join("")
                .trim();
        }

        if (!text) return { isValid: false, reason: "Empty Response" };

        return sanitizeOutput(text);

    } catch (err) {
        if (err.message && err.message.includes("429")) {
            console.warn("AI Rate Limit Hit. Backing off...");
            await sleep(5000);
        }
        throw err;
    }
}

function sanitizeOutput(rawText) {
    let clean = rawText
        .replace(/^FOUND:/i, "")
        .replace(/\*/g, "") 
        .trim();

    if (clean.length > 50 && !clean.includes(";")) {
        const sentenceMatch = clean.match(/^([A-Z][a-zA-Z'\-\s]+?) (is|was|has been) (the|identified as)/i);
        if (sentenceMatch && sentenceMatch[1].split(" ").length <= 4) {
            clean = `${sentenceMatch[1]} (Owner)`; 
        }
    }

    if (clean.includes("NOT_FOUND") || clean.includes("unable to find") || clean.length < 3) {
        return { isValid: false, reason: "Not Found" };
    }

    const garbageWords = ["welcome", "about us", "contact", "menu", "home", "our team", "meet the", "i am the", "with our", "senior /"];
    if (garbageWords.some(word => clean.toLowerCase().startsWith(word))) {
        return { isValid: false, reason: "Detected Slogan/Header" };
    }

    const parts = clean.split(";").map(p => p.trim());
    const validParts = [];

    for (let part of parts) {
        if (!part.includes("(") || !part.includes(")")) {
            const wordCount = part.split(" ").length;
            if (wordCount >= 2 && wordCount <= 4) {
                part = `${part} (Owner?)`; 
            } else {
                continue; 
            }
        }
        validParts.push(part);
    }

    if (validParts.length === 0) {
        return { isValid: false, reason: "Bad Format" };
    }

    return { isValid: true, name: validParts.join("; ") };
}

module.exports = { findBusinessOwnerWithAI };