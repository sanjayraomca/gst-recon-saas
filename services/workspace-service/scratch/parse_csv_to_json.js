const fs = require('fs');
const path = require('path');

const csvPath = '/home/tanvir/Desktop/gsttool_project/A1B_DATA/purchase/A1B-FY-25-26-Purchase-Data-24-2026.csv';
const jsonOutputPath = path.join(__dirname, '../src/connectors/mock-adesk-data.json');

// Helper to parse CSV lines while respecting quoted fields containing commas
function parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result;
}

function run() {
    try {
        console.log('Reading CSV file from:', csvPath);
        const data = fs.readFileSync(csvPath, 'utf8');
        const lines = data.split(/\r?\n/).filter(line => line.trim().length > 0);
        
        if (lines.length === 0) {
            console.error('CSV file is empty');
            return;
        }

        const headers = parseCsvLine(lines[0]);
        console.log(`Parsed ${headers.length} headers:`, headers);

        const records = [];
        for (let i = 1; i < lines.length; i++) {
            const values = parseCsvLine(lines[i]);
            if (values.length < headers.length) {
                // Skip malformed lines
                continue;
            }
            const record = {};
            headers.forEach((header, index) => {
                let value = values[index];
                // Strip surrounding quotes
                if (value.startsWith('"') && value.endsWith('"')) {
                    value = value.substring(1, value.length - 1);
                }
                record[header] = value;
            });
            records.push(record);
        }

        console.log(`Successfully parsed ${records.length} records.`);

        // Ensure target directory exists
        const dir = path.dirname(jsonOutputPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Write the records to the mock-adesk-data.json file
        fs.writeFileSync(jsonOutputPath, JSON.stringify(records, null, 2), 'utf8');
        console.log('Successfully wrote mock JSON data to:', jsonOutputPath);

    } catch (err) {
        console.error('Error parsing CSV to JSON:', err);
    }
}

run();
