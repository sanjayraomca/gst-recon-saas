const { subscribeToSubject } = require('../../../shared/src/nats/client');
const ReconciliationModel = require('../models/reconciliationModel');

/**
 * Reconciliation Trigger Service
 * Listens for data import events and automatically initiates reconciliation runs.
 */
class ReconciliationTriggerService {
    static init() {
        console.log('[ReconciliationTrigger] Initializing automated reconciliation listeners...');

        // 1. Listen for GSTR data imports
        subscribeToSubject('gstr-data-imported', async (data) => {
            const { tenant_id, workspace_id, gstin_id, period, gstr_type } = data;
            console.log(`[ReconciliationTrigger] Received gstr-data-imported event for ${gstr_type} - Period: ${period}`);

            try {
                // Determine if we should trigger reconciliation based on GSTR type
                const normalizedGstrType = gstr_type?.toUpperCase()?.replace(/-/g, '');
                const supportedGstrTypes = ['GSTR2A', 'GSTR2B'];

                if (supportedGstrTypes.includes(normalizedGstrType)) {
                    const runType = normalizedGstrType === 'GSTR2A' ? 'PURCHASE_2A' : 'PURCHASE_2B';
                    console.log(`[ReconciliationTrigger] Auto-triggering ${runType} reconciliation for Workspace: ${workspace_id}`);
                    
                    await ReconciliationModel.createRun(workspace_id, {
                        gstin_id,
                        period,
                        run_type: runType,
                        initiated_by: 'SYSTEM_AUTO_TRIGGER'
                    });
                } else {
                    console.log(`[ReconciliationTrigger] Skipping auto-trigger for unsupported GSTR type: ${gstr_type}`);
                }
            } catch (error) {
                console.error('[ReconciliationTrigger] Error triggering auto-recon for GSTR:', error);
            }
        });

        // 2. Listen for Book data imports
        subscribeToSubject('book-data-imported', async (data) => {
            const { tenant_id, workspace_id, gstin_id, period, type } = data;
            console.log(`[ReconciliationTrigger] Received book-data-imported event for ${type} - Period: ${period}`);

            try {
                // Supported book types for Purchase Reconciliation
                const normalizedType = type?.toUpperCase();
                const purchaseTypes = ['PURCHASE', 'PURCHASE_REGISTER', 'PURCHASE_RETURN', 'DEBIT_NOTE'];

                if (purchaseTypes.includes(normalizedType)) {
                    console.log(`[ReconciliationTrigger] Auto-triggering PURCHASE_2B reconciliation for Workspace: ${workspace_id}`);
                    
                    await ReconciliationModel.createRun(workspace_id, {
                        gstin_id,
                        period,
                        run_type: 'PURCHASE_2B', // Default to 2B matching for book imports
                        initiated_by: 'SYSTEM_AUTO_TRIGGER'
                    });
                } else {
                    console.log(`[ReconciliationTrigger] Skipping auto-trigger for book type: ${type}. (Only Purchase related imports trigger auto-recon)`);
                }
            } catch (error) {
                console.error('[ReconciliationTrigger] Error triggering auto-recon for Book:', error);
            }
        });

        console.log('[ReconciliationTrigger] Service Initialized and listening for import events.');
    }
}

module.exports = ReconciliationTriggerService;
