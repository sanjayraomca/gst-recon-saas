const SavedReportModel = require('../models/savedReportModel');
const { getNATS, sc } = require('../config/nats');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const REPORT_DIR = path.join(__dirname, '../../generated_reports');
if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
}

class ReportGenerator {
    constructor() {
        // Listener started manually
    }

    async start() {
        this.initializeListener();
    }

    async initializeListener() {
        try {
            const nc = getNATS();
            const sub = nc.subscribe('report.generate');
            console.log('Listening for report generation requests...');

            for await (const msg of sub) {
                const data = JSON.parse(sc.decode(msg.data));
                console.log('Received report request:', data);
                this.generateReport(data.reportId, data.workspaceId, data.type, data.filters);
            }
        } catch (error) {
            console.error('NATS listener error:', error);
        }
    }

    async generateReport(reportId, workspaceId, type, filters) {
        try {
            console.log(`Generating ${type} report for workspace ${workspaceId}...`);

            // Simulating generation time
            await new Promise(resolve => setTimeout(resolve, 2000));

            const workbook = new ExcelJS.Workbook();
            const sheet = workbook.addWorksheet('Report');

            sheet.columns = [
                { header: 'ID', key: 'id', width: 10 },
                { header: 'Reference', key: 'ref', width: 32 },
                { header: 'Date', key: 'date', width: 20 },
                { header: 'Status', key: 'status', width: 15 }
            ];

            // Fetch real data based on type
            const db = require('../../../shared/src/db/connection');

            if (type === 'MISMATCH_REPORT') {
                const results = await db('reconciliation_results as rr')
                    .leftJoin('purchase_vouchers as pi', 'rr.purchase_invoice_id', 'pi.id')
                    .select(
                        'rr.id',
                        'pi.invoice_number as ref',
                        'pi.invoice_date as date',
                        'rr.match_status as status'
                    )
                    .where('rr.workspace_id', workspaceId)
                    .whereNot('rr.match_status', 'EXACT')
                    .limit(1000);

                results.forEach(row => {
                    sheet.addRow({
                        id: row.id,
                        ref: row.ref || 'N/A',
                        date: row.date ? new Date(row.date).toISOString() : new Date().toISOString(),
                        status: row.status
                    });
                });
            } else {
                // Default Fallback
                sheet.addRow({ id: 0, ref: 'NO_DATA', date: new Date().toISOString(), status: 'UNKNOWN_TYPE' });
            }

            // Write to file system
            const fileName = `${type}_${reportId}.xlsx`;
            const filePath = path.join(REPORT_DIR, fileName);

            await workbook.xlsx.writeFile(filePath);
            console.log(`Report written to ${filePath}`);

            const fileUrl = fileName;

            await SavedReportModel.update(workspaceId, reportId, {
                status: 'COMPLETED',
                file_url: fileUrl
            });

            console.log(`Report ${reportId} completed.`);
        } catch (error) {
            console.error(`Report ${reportId} failed:`, error);
            await SavedReportModel.update(workspaceId, reportId, {
                status: 'FAILED',
                error_message: error.message
            });
        }
    }

    // Trigger async generation
    async queueReport(reportId, workspaceId, type, filters) {
        const nc = getNATS();
        const payload = JSON.stringify({ reportId, workspaceId, type, filters });
        nc.publish('report.generate', sc.encode(payload));
    }
}

module.exports = new ReportGenerator();
