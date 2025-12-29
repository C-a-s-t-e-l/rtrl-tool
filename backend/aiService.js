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
            if (addLog) await addLog(jobId, `AI Researching: ${businessName}...`);

            const prompt = `
            Task: Identify the Owner, Founder, or Principal of "${businessName}" in "${location}".
            Context Url: "${website || ""}"
            
            STRICT RULES:
            1. Search Google/LinkedIn/About Us pages.
            2. REJECT slogans (e.g. "I Am The", "With Our").
            3. REJECT generic roles (e.g. "The Team").
            4. FORMAT: "Name (Title)".
            5. If multiple, separate with semicolon.
            6. If NOT found, return: "NOT_FOUND".
            `;

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

            if (!text) return { ownerName: "", source: "AI_Empty" };

            const cleanResult = sanitizeOutput(text);

            if (cleanResult.isValid) {
                if (addLog) await addLog(jobId, `AI Found: ${cleanResult.name}`);
                return { ownerName: cleanResult.name, source: "AI_Search" };
            } else {
                if (addLog) await addLog(jobId, `[AI] Result rejected: "${text.substring(0,40)}..." (${cleanResult.reason})`);
                return { ownerName: "", source: "AI_Rejected" };
            }

        } catch (error) {
            if (addLog) await addLog(jobId, `[AI Error] ${error.message}`);
            return { ownerName: "", source: "AI_Failed" };
        }
    });

    requestQueue = task.catch(() => {});
    return task;
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

    if (clean.includes("NOT_FOUND") || clean.includes("unable to find")) {
        return { isValid: false, reason: "Not Found" };
    }

    const garbageWords = ["welcome", "about us", "contact", "menu", "home", "our team", "meet the", "i am the", "with our", "senior /"];
    if (garbageWords.some(word => clean.toLowerCase().startsWith(word))) {
        return { isValid: false, reason: "Detected Slogan/Header" };
    }

    const parts = clean.split(";").map(p => p.trim());
    const validParts = [];

    for (let part of parts) {
        if (part.includes("(") && !part.includes(")")) part += ")";

        if (part.length < 4 || part.length > 60) continue;
        
        if (!part.includes("(") || !part.includes(")")) {
            if (part.split(" ").length >= 2 && part.split(" ").length <= 4) {
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