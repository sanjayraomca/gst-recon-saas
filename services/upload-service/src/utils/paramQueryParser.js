const { execSync } = require('child_process');
const fs = require('fs');

/**
 * Fallback parser for non-standard "ParamQuery" XLSX exports.
 * 
 * Some ERP systems export XLSX files where the worksheets are not in the
 * standard `xl/worksheets/` folder, but rather in the root of the ZIP
 * (e.g., `worksheet1.xml`), and strings are stored as inline CDATA rather 
 * than using the standard sharedStrings.xml.
 * 
 * The standard `xlsx` package fails to read these files (returns 0 sheets/rows).
 * This parser manually unzips and extracts the data using a simple regex.
 */
const parseParamQueryFallback = (filePath) => {
    try {
        // Attempt to extract worksheet1.xml from the ZIP archive
        const xml = execSync(`unzip -p "${filePath}" worksheet1.xml 2>/dev/null`).toString();
        
        if (!xml || xml.trim() === '') {
            return null; // Not a ParamQuery file or failed to extract
        }

        const rowRegex = /<row[^>]*>(.*?)<\/row>/g;
        // Match <c> elements and extract the text inside <t>. It handles CDATA automatically.
        const cellRegex = /<c[^>]*>.*?<t[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/t>.*?<\/c>/g;

        const rows = [];
        let match;
        
        while ((match = rowRegex.exec(xml)) !== null) {
            let rowXml = match[1];
            let cells = [];
            let cellMatch;
            
            // Note: This regex ignores empty cells that don't have a <t> tag, 
            // but in ParamQuery exports, empty cells usually have an empty CDATA.
            // If they are completely missing, column alignment might shift.
            // Let's use a more robust regex that just captures the <c> tag.
            // For ParamQuery, every column is explicitly outputted.
            
            // We use matchAll to iterate over <c> tags.
            const cTags = [...rowXml.matchAll(/<c[^>]*>(.*?)<\/c>/g)];
            
            for (const cTag of cTags) {
                const inner = cTag[1];
                
                // Text strings inside inlineStr CDATA
                const tMatch = /<t[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/t>/.exec(inner);
                if (tMatch) {
                    cells.push(tMatch[1]);
                    continue;
                }
                
                // Numeric or date values inside <v>
                const vMatch = /<v[^>]*>(.*?)<\/v>/.exec(inner);
                if (vMatch) {
                    // It could be a number or an excel date serial
                    let val = vMatch[1];
                    if (!isNaN(val)) {
                        val = Number(val);
                    }
                    cells.push(val);
                    continue;
                }
                
                cells.push(null);
            }
            rows.push(cells);
        }

        if (rows.length > 0) {
            console.log(`[ParamQueryParser] Successfully extracted ${rows.length} rows via fallback.`);
            return rows;
        }

        return null;
    } catch (e) {
        // Suppress errors, this is just a fallback
        console.error('[ParamQueryParser] Fallback failed:', e.message);
        return null;
    }
};

module.exports = {
    parseParamQueryFallback
};
