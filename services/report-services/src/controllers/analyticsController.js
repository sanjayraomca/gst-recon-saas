const { successResponse } = require('../../../shared/src/utils/responseHandler');

// 1. Compliance Scorecard
exports.getComplianceOverview = async (req, res) => {
    // Logic: In real implementation, this would aggregate data from recon_results and gstin operations.
    // For Phase 6 v1, we return a structured mock based on industry standards.
    const data = {
        period: "2024-01",
        score: {
            current: 87,
            trend: "UP",
            change: "+2.5%"
        },
        breakdown: {
            gstr1_filing: "ON_TIME",
            gstr3b_filing: "ON_TIME",
            reconciliation_matched: "92%",
            vendor_compliance: "85%"
        },
        invoices: {
            total: 1500,
            reconciled: 1380,
            mismatched: 120
        }
    };
    return successResponse(res, data, 'Compliance Scorecard fetched');
};

// 2. ITC Summary
exports.getITCSummary = async (req, res) => {
    // Logic: Aggregating 'itc_eligibility_status' from invoices
    const data = {
        period: "2024-01",
        total_available: 5000000, // 50L
        breakdown: {
            eligible: { count: 1200, amount: 4500000 },
            ineligible: { count: 50, amount: 200000 },
            blocked_17_5: { count: 20, amount: 100000 },
            pending_vendor_upload: { count: 230, amount: 200000 }
        },
        utilization: {
            claimed: 4200000,
            reversed: 0,
            closing_balance: 300000
        }
    };
    return successResponse(res, data, 'ITC Summary fetched');
};
