/**
 * AI Matching Service — Google Gemini Integration
 * 
 * HOW TO DISABLE: Set AI_MATCHING_ENABLED=false in docker-compose.yml
 * HOW TO REMOVE:  Delete this file + revert the 3 lines added to reconciliationModel.js
 */
const https = require('https');

const AI_MATCHING_ENABLED = process.env.AI_MATCHING_ENABLED === 'true';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-1.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// How many unmatched pairs to send per Gemini API call (reduced for free tier)
const BATCH_SIZE = 5;

/**
 * Given a list of unmatched purchase invoices and all GSTR-2B invoices,
 * uses Gemini to try to find fuzzy matches.
 * 
 * @param {Array} unmatchedPurchases - purchase invoices with no exact GSTR-2B match
 * @param {Array} allGstr2bInvoices  - all GSTR-2B invoices from the run
 * @returns {Map} purchaseId => { gstr2b_invoice, confidence_score, reason }
 */
async function findAIMatches(unmatchedPurchases, allGstr2bInvoices) {
    if (!AI_MATCHING_ENABLED || !GEMINI_API_KEY || unmatchedPurchases.length === 0 || allGstr2bInvoices.length === 0) {
        return new Map();
    }

    console.log(`[AI Matching] Starting AI matching for ${unmatchedPurchases.length} unmatched purchase invoices...`);

    const aiMatchMap = new Map(); // purchaseId => match result

    // Process in batches to stay within token limits
    for (let i = 0; i < unmatchedPurchases.length; i += BATCH_SIZE) {
        const batch = unmatchedPurchases.slice(i, i + BATCH_SIZE);

        try {
            const batchResults = await matchBatchWithGemini(batch, allGstr2bInvoices);
            for (const [purchaseId, result] of batchResults) {
                aiMatchMap.set(purchaseId, result);
            }
        } catch (err) {
            console.error(`[AI Matching] Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, err.message);
            // Continue with next batch — don't fail the entire run
        }

        // Small delay to avoid hitting rate limits
        if (i + BATCH_SIZE < unmatchedPurchases.length) {
            await new Promise(r => setTimeout(r, 200));
        }
    }

    const matchCount = [...aiMatchMap.values()].filter(v => v.matched).length;
    console.log(`[AI Matching] Done. AI found ${matchCount} additional matches from ${unmatchedPurchases.length} unmatched invoices.`);

    return aiMatchMap;
}

/**
 * Send one batch of unmatched purchase invoices to Gemini for matching
 */
async function matchBatchWithGemini(purchaseBatch, allGstr2bInvoices) {
    const prompt = buildPrompt(purchaseBatch, allGstr2bInvoices);
    const responseText = await callGeminiAPI(prompt);
    return parseGeminiResponse(responseText, purchaseBatch);
}

/**
 * Build the Gemini prompt
 */
function buildPrompt(purchaseBatch, gstr2bInvoices) {
    const purchaseList = purchaseBatch.map((p, idx) =>
        `P${idx + 1}:
  ID: ${p.id}
  Supplier GSTIN: ${p.supplier_gstin || 'N/A'}
  Supplier Name: ${p.supplier_name || 'N/A'}
  Invoice No: ${p.supplier_invoice_no || 'N/A'}
  Invoice Date: ${p.supplier_invoice_date || 'N/A'}
  Amount: ${p.net_amount || 0}`
    ).join('\n\n');

    const gstr2bList = gstr2bInvoices.map((g, idx) =>
        `G${idx + 1}:
  ID: ${g.id}
  Supplier GSTIN: ${g.supplier_gstin || 'N/A'}
  Supplier Name: ${g.supplier_name || 'N/A'}
  Document No: ${g.document_number_clean || 'N/A'}
  Document Date: ${g.document_date || 'N/A'}
  Amount: ${g.document_value || 0}`
    ).join('\n\n');

    return `You are a GST reconciliation expert. Match each purchase invoice to the correct GSTR-2B invoice if they represent the same transaction.

Consider these as potentially the same:
- Invoice numbers with different separators (INV-001 = INV001 = INV/001)
- Supplier names with abbreviations (TATA MOTORS LTD = Tata Motors Limited)  
- Amounts within ₹1 difference (rounding)
- GSTIN must match exactly (after trimming/uppercase)

PURCHASE INVOICES (unmatched):
${purchaseList}

GSTR-2B INVOICES (candidates):
${gstr2bList}

For each purchase invoice, respond with a JSON object containing a "matches" array. 
Format:
{
  "matches": [
    {
      "purchase_id": "<exact ID from purchase invoice>",
      "gstr2b_id": "<exact ID from GSTR-2B invoice, or null if no match>",
      "confidence": <number 0-100>,
      "reason": "<short explanation>"
    }
  ]
}

Only return the JSON object. Do not add any conversational text.`;
}

/**
 * Call the Gemini API
 */
function callGeminiAPI(prompt) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.1, // Low temperature for consistent structured output
                maxOutputTokens: 2048
            }
        });

        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = https.request(GEMINI_URL, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    reject(new Error(`Gemini API error ${res.statusCode}: ${data}`));
                    return;
                }
                try {
                    const parsed = JSON.parse(data);
                    const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    resolve(text);
                } catch (e) {
                    reject(new Error('Failed to parse Gemini response: ' + e.message));
                }
            });
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

/**
 * Parse Gemini's JSON response into a Map of purchaseId => match result
 */
function parseGeminiResponse(responseText, purchaseBatch) {
    const resultMap = new Map();

    try {
        // Extract JSON from the response (handle markdown code fences ```json ... ```)
        let cleanJson = responseText.trim();
        if (cleanJson.startsWith('```')) {
            cleanJson = cleanJson.replace(/^```(json)?/, '').replace(/```$/, '').trim();
        }

        const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.warn('[AI Matching] No JSON object found in response text');
            return resultMap;
        }

        const parsed = JSON.parse(jsonMatch[0]);
        const matches = parsed?.matches || [];

        for (const match of matches) {
            const { purchase_id, gstr2b_id, confidence, reason } = match;

            // Validate that purchase_id exists in our batch
            const purchaseInv = purchaseBatch.find(p => p.id === purchase_id);
            if (!purchaseInv) continue;

            resultMap.set(purchase_id, {
                matched: !!(gstr2b_id && confidence >= 70), // Only trust high-confidence matches
                gstr2b_id: confidence >= 70 ? gstr2b_id : null,
                confidence_score: parseFloat(confidence) || 0,
                reason: reason || 'AI-assisted match'
            });
        }
    } catch (err) {
        console.error('[AI Matching] Failed to parse Gemini response:', err.message);
    }

    return resultMap;
}

module.exports = { findAIMatches, AI_MATCHING_ENABLED };
