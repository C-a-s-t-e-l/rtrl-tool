const { GoogleGenAI } = require("@google/genai");
require("dotenv").config();

const apiKey = process.env.GEMINI_API_KEY;
const aiClient = apiKey ? new GoogleGenAI({ apiKey: apiKey }) : null;
const MODEL_NAME = "gemini-2.5-flash";

async function findBusinessOwnerWithAI(businessName, location, website, jobId, addLog) {
    if (!aiClient) return { ownerName: "", source: "No_API_Key" };

    try {
        const prompt = `
        TASK: Extract decision-maker data for: "${businessName}" in "${location}".
        CONTEXT WEBSITE: "${website || "None"}"

        STRICT RULES:
        1. **NO SENTENCES.** Return ONLY the name/entity.
        2. **PRIORITY:**
           - Priority A: Human Owner/Founder Name (e.g. "John Smith").
           - Priority B: Legal Entity Name if human is hidden (e.g. "KGM IMPORT/EXPORT PTY LTD").
           - Priority C: If neither found, write "Private Owner".
        3. **DO NOT** use the text "Owner Name (Title)" in your output.
        4. **DO NOT** leave the name field blank.

        OUTPUT FORMAT (Pipe Separated):
        Name or Entity | Email | Phone | Correct Business Name

        EXAMPLES:
        Input: Cafe Azul
        Output: KGM IMPORT/EXPORT PTY LTD | info@cafeazul.com | 0399999999 | Cafe Azul

        Input: Axil Coffee
        Output: David Makin (Founder) | contact@axil.com | 0400000000 | Axil Coffee Roasters
        `;

        const response = await aiClient.models.generateContent({
            model: MODEL_NAME,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: {
                tools: [{ googleSearch: {} }],
                temperature: 0.1 
            }
        });

        let responseText = "";
        if (response.candidates && response.candidates[0] && response.candidates[0].content.parts[0]) {
            responseText = response.candidates[0].content.parts[0].text.trim();
        }

        responseText = responseText.replace(/The owner is /gi, "")
                                   .replace(/Located at /gi, "")
                                   .replace(/Owner Name \(Title\)/gi, "Private Owner");

        const parts = responseText.split('|').map(p => p.trim());
        
        let rawName = parts[0] || "Private Owner";
        if (rawName.length > 50 && !rawName.includes("PTY")) {
            rawName = "Private Owner"; 
        }

        return {
            ownerName: rawName,
            aiEmail: (!parts[1] || parts[1].includes("NOT_FOUND")) ? "" : parts[1],
            aiPhone: (!parts[2] || parts[2].includes("NOT_FOUND")) ? "" : parts[2],
            resolvedName: (!parts[3] || parts[3].includes("NOT_FOUND")) ? businessName : parts[3],
            source: "Google_Grounding_v2.5"
        };

    } catch (error) {
        return { ownerName: "Private Owner", source: "AI_Error" };
    }
}

module.exports = { findBusinessOwnerWithAI };