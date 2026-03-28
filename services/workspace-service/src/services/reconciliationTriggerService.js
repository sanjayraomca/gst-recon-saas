const { subscribeToSubject } = require('../../../shared/src/nats/client');
const ReconciliationModel = require('../models/reconciliationModel');

/**
 * Reconciliation Trigger Service
 * Listens for data import events and automatically initiates reconciliation runs.
 */
class ReconciliationTriggerService {
    static init() {
        console.log('[ReconciliationTrigger] Initializing automated reconciliation listeners...');

        // 1. Listen for GSTR Data Imports (JSON or Excel)
        subscribeToSubject('gstr-data-imported', async (data) => {
            console.log(`[ReconciliationTrigger] Received gstr-data-imported event:`, JSON.stringify(data));
            try {
                const { workspace_id, gstin_id, period, gstr_type } = data;
                
                // Only trigger for GSTR-2B (or 2A) as those are what we reconcile against
                if (['GSTR2B', 'GSTR-2B', 'GSTR2A', 'GSTR-2A'].includes(gstr_type?.toUpperCase())) {
                    console.log(`[ReconciliationTrigger] GSTR-2B/2A import detected for ${period}. Triggering auto-match...`);
                    
                    const runType = gstr_type.toUpperCase().includes('2A') ? 'PURCHASE_2A' : 'PURCHASE_2B';
                    
                    await ReconciliationModel.createRun(workspace_id, {
                        gstin_id,
                        period,
                        run_type: runType,
                        run_mode: 'AUTO_IMPORT'
                    });
                    
                    console.log(`[ReconciliationTrigger] Auto-match triggered successfully for ${period}`);
                }
            } catch (err) {
                console.error('[ReconciliationTrigger] Failed to trigger reconciliation after GSTR import:', err.message);
            }
        });

        // 2. Listen for Book Data Imports (Purchase Register via Excel or JSON)
        subscribeToSubject('book-data-imported', async (data) => {
            console.log(`[ReconciliationTrigger] Received book-data-imported event:`, JSON.stringify(data));
            try {
                const { workspace_id, gstin_id, period, type } = data;

                // Only trigger if a Purchase Register was imported
                if (type === 'PURCHASE' || type === 'PURCHASE_REGISTER') {
                    console.log(`[ReconciliationTrigger] Purchase Register import detected for ${period}. Triggering auto-match...`);
                    
                    await ReconciliationModel.createRun(workspace_id, {
                        gstin_id,
                        period,
                        run_type: 'PURCHASE_2B', // Default to 2B matching
                        run_mode: 'AUTO_IMPORT'
                    });
                    
                    console.log(`[ReconciliationTrigger] Auto-match triggered successfully for ${period}`);
                }
            } catch (err) {
                console.error('[ReconciliationTrigger] Failed to trigger reconciliation after Book Data import:', err.message);
            }
        });

        console.log('[ReconciliationTrigger] Service Initialized and listening for import events.');
    }
}

module.exports = ReconciliationTriggerService;
