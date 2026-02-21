const db = require('../../../shared/src/db/connection');

/**
 * Model for gstr_import_master table
 * Handles all database operations for GSTR import tracking
 */

class GSTRImportModel {
    /**
     * Create a new import record
     * @param {object} importData - Import metadata
     * @returns {object} Created record with import_filing_id
     */
    static async createImportRecord(importData) {
        const {
            tenantUuid,
            gstinRecipient,
            returnPeriod,
            financialYear,
            generationDate,
            importType,
            originalFilename,
            uploadedFilepath,
            uploadedFileUrl,
            extraInfo = {},
            importedBy,
            userEmail,
            fileHash = null
        } = importData;

        const query = `
            INSERT INTO gstr_import_master (
                tenant_uuid,
                gstin_recipient,
                return_period,
                financial_year,
                generation_date,
                import_type,
                original_filename,
                uploaded_filepath,
                uploaded_file_url,
                extra_info,
                imported_by,
                user_email,
                status,
                total_record,
                file_hash
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING *
        `;

        const values = [
            tenantUuid,
            gstinRecipient,
            returnPeriod,
            financialYear,
            generationDate,
            importType,
            originalFilename,
            uploadedFilepath,
            uploadedFileUrl,
            JSON.stringify(extraInfo),
            importedBy,
            userEmail,
            'Pending',
            0,
            fileHash
        ];

        try {
            const result = await db.raw(query, values);
            return result.rows[0];
        } catch (error) {
            console.error('Error creating import record:', error);
            throw error;
        }
    }

    /**
     * Update import status and record count
     * @param {string} importFilingId - Import Filing UUID
     * @param {string} status - New status (Pending, InProcess, Completed, Failed)
     * @param {number} totalRecord - Total records processed
     * @param {object} extraInfo - Additional metadata
     */
    static async updateImportStatus(importFilingId, status, totalRecord = null, extraInfo = null) {
        let query = `
            UPDATE gstr_import_master 
            SET status = ?
        `;
        const values = [status];

        if (totalRecord !== null) {
            query += `, total_record = ?`;
            values.push(totalRecord);
        }

        if (extraInfo !== null) {
            query += `, extra_info = ?`;
            values.push(JSON.stringify(extraInfo));
        }

        query += ` WHERE import_filing_id = ? RETURNING *`;
        values.push(importFilingId);

        try {
            const result = await db.raw(query, values);
            return result.rows[0];
        } catch (error) {
            console.error('Error updating import status:', error);
            throw error;
        }
    }

    /**
     * Get import history for a tenant/workspace
     * @param {string} tenantUuid - Tenant UUID
     * @param {object} filters - Optional filters (gstinRecipient, importType, status)
     * @param {number} limit - Number of records to return
     * @returns {array} Import records
     */
    static async getImportHistory(tenantUuid, filters = {}, limit = 50) {
        let query = `
            SELECT 
                import_filing_id,
                tenant_uuid,
                gstin_recipient,
                return_period,
                financial_year,
                generation_date,
                upload_timestamp,
                import_type,
                original_filename,
                uploaded_filepath,
                uploaded_file_url,
                extra_info,
                total_record,
                status,
                imported_by,
                user_email,
                file_hash
            FROM gstr_import_master
            WHERE tenant_uuid = ?
        `;
        const values = [tenantUuid];

        if (filters.gstinRecipient) {
            query += ` AND gstin_recipient = ?`;
            values.push(filters.gstinRecipient);
        }

        if (filters.importType) {
            query += ` AND import_type = ?`;
            values.push(filters.importType);
        }

        if (filters.status) {
            query += ` AND status = ?`;
            values.push(filters.status);
        }

        query += ` ORDER BY upload_timestamp DESC LIMIT ?`;
        values.push(limit);

        try {
            const result = await db.raw(query, values);
            return result.rows;
        } catch (error) {
            console.error('Error fetching import history:', error);
            throw error;
        }
    }

    /**
     * Get import record by import filing ID
     * @param {string} importFilingId - Import Filing UUID
     * @returns {object} Import record
     */
    static async getImportById(importFilingId) {
        const query = `
            SELECT * FROM gstr_import_master
            WHERE import_filing_id = ?
        `;

        try {
            const result = await db.raw(query, [importFilingId]);
            return result.rows[0];
        } catch (error) {
            console.error('Error fetching import by ID:', error);
            throw error;
        }
    }

    /**
     * Check if an identical file (same hash) was already imported for the same
     * tenant + gstin + period + type combination.
     * @param {string} tenantUuid
     * @param {string} gstinRecipient
     * @param {string} returnPeriod
     * @param {string} importType
     * @param {string} fileHash - MD5 hash of the uploaded file
     * @returns {{ exactDuplicate: boolean, previousImport: object|null }}
     */
    static async checkDuplicateByHash(tenantUuid, gstinRecipient, returnPeriod, importType, fileHash, originalFilename) {
        // Find the most recent previous import for same tenant+gstin+period+type
        const query = `
            SELECT import_filing_id, file_hash, original_filename, upload_timestamp, status, total_record
            FROM gstr_import_master
            WHERE tenant_uuid = ?
              AND gstin_recipient = ?
              AND return_period = ?
              AND import_type = ?
            ORDER BY upload_timestamp DESC
            LIMIT 1
        `;

        try {
            const result = await db.raw(query, [tenantUuid, gstinRecipient, returnPeriod, importType]);
            const previousImport = result.rows[0] || null;

            if (!previousImport) {
                return { exactDuplicate: false, previousImport: null };
            }

            let exactDuplicate = false;

            if (previousImport.file_hash) {
                // Normal case: compare hashes
                exactDuplicate = previousImport.file_hash === fileHash;
            } else {
                // Legacy record with no hash: fall back to filename comparison
                exactDuplicate = previousImport.original_filename === originalFilename;
            }

            return { exactDuplicate, previousImport };
        } catch (error) {
            console.error('Error checking duplicate by hash:', error);
            throw error;
        }
    }

    /**
     * Batch insert B2B invoices, skipping any that already exist
     * (ON CONFLICT DO NOTHING on the unique constraint: tenant_id + gstin_supplier + invoice_number + return_period)
     * @param {Array} invoices - Array of invoice objects
     * @returns {Promise<{ inserted: number }>} Count of actually inserted rows
     */
    static async batchInsertB2BInvoices(invoices) {
        return this.batchInsertToTable('gstr_2b_b2b_invoices', invoices, '(tenant_id, invoice_number, return_period)');
    }

    /**
     * Batch insert B2BA invoices (Amendments)
     * @param {Array} invoices 
     */
    static async batchInsertB2BAInvoices(invoices) {
        return this.batchInsertToTable('gstr_2b_b2ba_invoices', invoices, '(tenant_id, original_invoice_number, revised_invoice_number, return_period)');
    }

    /**
     * Batch insert CDNR (Credit/Debit Notes)
     * @param {Array} notes 
     */
    static async batchInsertCDNR(notes) {
        return this.batchInsertToTable('gstr_2b_cdnr', notes, '(tenant_id, note_number, return_period)');
    }

    /**
     * Batch insert CDNRA (Amended Credit/Debit Notes)
     * @param {Array} notes 
     */
    static async batchInsertCDNRA(notes) {
        return this.batchInsertToTable('gstr_2b_cdnra', notes, '(tenant_id, original_note_number, revised_note_number, return_period)');
    }

    /**
     * Batch insert IMPG (Imports of Goods)
     * @param {Array} imports 
     */
    static async batchInsertIMPG(imports) {
        return this.batchInsertToTable('gstr_2b_impg', imports, '(tenant_id, boe_number, port_code, return_period)');
    }

    /**
     * Batch insert ISD (Input Service Distributor)
     * @param {Array} records 
     */
    static async batchInsertISD(records) {
        return this.batchInsertToTable('gstr_2b_isd', records, '(tenant_id, gstin_isd, document_number, return_period)');
    }

    /**
     * Generic helper for batch insertions with ON CONFLICT DO NOTHING
     */
    static async batchInsertToTable(tableName, records, conflictTarget) {
        if (!records || records.length === 0) return { inserted: 0 };

        const batchSize = 500;
        let totalInserted = 0;

        for (let i = 0; i < records.length; i += batchSize) {
            const batch = records.slice(i, i + batchSize);
            const columns = Object.keys(batch[0]);
            const placeholders = batch.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
            const values = batch.flatMap(row => columns.map(col => row[col] ?? null));

            const query = `
                INSERT INTO ${tableName} (${columns.join(', ')})
                VALUES ${placeholders}
                ON CONFLICT ${conflictTarget}
                DO NOTHING
            `;

            try {
                const result = await db.raw(query, values);
                totalInserted += result.rowCount || 0;
            } catch (error) {
                console.error(`[MODEL] Error in batchInsertToTable for ${tableName}:`, error);
                throw error;
            }
        }

        return { inserted: totalInserted };
    }

    /**
     * Delete import record
     * @param {string} importFilingId - Import Filing UUID
     */
    static async deleteImport(importFilingId) {
        const query = `DELETE FROM gstr_import_master WHERE import_filing_id = ? RETURNING * `;

        try {
            const result = await db.raw(query, [importFilingId]);
            return result.rows[0];
        } catch (error) {
            console.error('Error deleting import:', error);
            throw error;
        }
    }
}

module.exports = GSTRImportModel;
