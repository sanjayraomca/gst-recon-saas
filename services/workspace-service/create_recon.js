const knex = require('./src/db/connection');

async function createTables() {
    try {
        await knex.raw(`
            CREATE TABLE IF NOT EXISTS reconciliation_runs (
                id UUID PRIMARY KEY,
                workspace_id UUID NOT NULL REFERENCES workspaces(id),
                gstin_id UUID NOT NULL,
                period_id UUID NOT NULL REFERENCES tax_periods(id),
                run_type VARCHAR(50) NOT NULL,
                run_mode VARCHAR(50) NOT NULL,
                rule_set_version VARCHAR(20),
                rule_set_hash VARCHAR(100),
                status VARCHAR(20) NOT NULL,
                started_at TIMESTAMP,
                completed_at TIMESTAMP,
                total_invoices INTEGER DEFAULT 0,
                matched_count INTEGER DEFAULT 0,
                mismatched_count INTEGER DEFAULT 0,
                missing_count INTEGER DEFAULT 0,
                result_summary JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS reconciliation_results (
                id SERIAL PRIMARY KEY,
                recon_run_id UUID NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
                workspace_id UUID NOT NULL REFERENCES workspaces(id),
                purchase_invoice_id UUID REFERENCES purchase_invoices(id),
                gstr2b_invoice_id UUID REFERENCES gstr2b_invoices(id),
                
                match_status VARCHAR(50) NOT NULL,
                match_score DECIMAL(5,2),
                match_confidence VARCHAR(20),
                
                books_value DECIMAL(15,2),
                portal_value DECIMAL(15,2),
                variance_amount DECIMAL(15,2),
                
                itc_decision VARCHAR(50),
                decision_reason TEXT,
                
                action_required VARCHAR(50),
                action_priority VARCHAR(20),
                action_status VARCHAR(20),
                
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("Tables created successfully");
    } catch (error) {
        console.error("Error creating tables:", error);
    } finally {
        await knex.destroy();
    }
}

createTables();
