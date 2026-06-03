const { execSync } = require('child_process');
const fs = require('fs');

/**
 * Helper to convert column letter (e.g. A, B, Z, AA) to 0-based column index.
 */
const colLetterToIndex = (colLetter) => {
    let index = 0;
    for (let i = 0; i < colLetter.length; i++) {
        index = index * 26 + (colLetter.charCodeAt(i) - 64);
    }
    return index - 1;
};

/**
 * Fallback parser for non-standard "ParamQuery" XLSX exports.
 * 
 * Some ERP systems export XLSX files where the worksheets are not in the
 * standard `xl/worksheets/` folder, but rather in the root of the ZIP
 * (e.g., `worksheet1.xml`), and strings are stored as inline CDATA rather 
 * than using the standard sharedStrings.xml.
 * 
 * The standard `xlsx` package fails to read these files (returns 0 sheets/rows).
 * This parser manually unzips and extracts the data using a robust cell-mapping regex.
 */
const parseParamQueryFallback = (filePath) => {
    try {
        // Attempt to extract worksheet1.xml from the ZIP archive
        const xml = execSync(`unzip -p "${filePath}" worksheet1.xml 2>/dev/null`, { maxBuffer: 10 * 1024 * 1024 }).toString();
        
        if (!xml || xml.trim() === '') {
            return null; // Not a ParamQuery file or failed to extract
        }

        const rowRegex = /<row[^>]*>(.*?)<\/row>/g;
        const rows = [];
        let match;
        
        while ((match = rowRegex.exec(xml)) !== null) {
            let rowXml = match[1];
            let cells = [];
            
            // Match cell tags: either <c attrs>content</c> or self-closing <c attrs />
            const cTags = [...rowXml.matchAll(/<c\s+([^>]*?)(?:>(.*?)<\/c>|\/>)/g)];
            
            let colIdx = -1;
            for (const cTag of cTags) {
                const attributes = cTag[1];
                const inner = cTag[2] || '';
                
                // Determine exact column index based on r="[ColumnLetter][RowNumber]"
                const rMatch = /r="([A-Z]+)\d+"/.exec(attributes);
                if (rMatch) {
                    colIdx = colLetterToIndex(rMatch[1]);
                } else {
                    colIdx++;
                }
                
                let val = null;
                
                // Text strings inside inlineStr CDATA
                const tMatch = /<t[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/t>/.exec(inner);
                if (tMatch) {
                    val = tMatch[1];
                } else {
                    // Numeric or date values inside <v>
                    const vMatch = /<v[^>]*>(.*?)<\/v>/.exec(inner);
                    if (vMatch) {
                        val = vMatch[1];
                        if (!isNaN(val) && val.trim() !== '') {
                            val = Number(val);
                        }
                    }
                }
                
                cells[colIdx] = val;
            }
            
            // Fill any skipped columns/holes with null
            for (let k = 0; k < cells.length; k++) {
                if (cells[k] === undefined) {
                    cells[k] = null;
                }
            }
            
            rows.push(cells);
        }

        if (rows.length > 0) {
            console.log(`[ParamQueryParser] Successfully extracted ${rows.length} rows via robust fallback.`);
            return rows;
        }

        return null;
    } catch (e) {
        console.error('[ParamQueryParser] Fallback failed:', e.message);
        return null;
    }
};

module.exports = {
    parseParamQueryFallback
};
