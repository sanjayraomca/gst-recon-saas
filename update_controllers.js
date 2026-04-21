const fs = require('fs');
const path = require('path');

const customerCtrl = path.join(__dirname, 'services/workspace-service/src/controllers/customerController.js');
let custContent = fs.readFileSync(customerCtrl, 'utf-8');
custContent = custContent.replace(
    'page: parseInt(req.query.page) || 1,\n            limit: parseInt(req.query.pageSize) || 10\n        };',
    `page: parseInt(req.query.page) || 1,
            limit: parseInt(req.query.pageSize) || 10,
            customer_gstin: req.query.customer_gstin,
            customer_name: req.query.customer_name,
            state_codes: req.query.state_codes,
            from_date: req.query.from_date,
            to_date: req.query.to_date,
            sort_by: req.query.sort_by,
            sort_order: req.query.sort_order
        };`
);
fs.writeFileSync(customerCtrl, custContent);

const supplierCtrl = path.join(__dirname, 'services/workspace-service/src/controllers/supplierController.js');
let suppContent = fs.readFileSync(supplierCtrl, 'utf-8');
suppContent = suppContent.replace(
    'page: parseInt(req.query.page) || 1,\n            limit: parseInt(req.query.pageSize) || 10\n        };',
    `page: parseInt(req.query.page) || 1,
            limit: parseInt(req.query.pageSize) || 10,
            supplier_gstin: req.query.supplier_gstin || req.query.customer_gstin,
            supplier_name: req.query.supplier_name || req.query.customer_name,
            state_codes: req.query.state_codes,
            from_date: req.query.from_date,
            to_date: req.query.to_date,
            sort_by: req.query.sort_by,
            sort_order: req.query.sort_order
        };`
);
suppContent = suppContent.replace(
    'page: parseInt(req.query.page) || 1,\n            limit: parseInt(req.query.limit) || parseInt(req.query.pageSize) || 10\n        };',
    `page: parseInt(req.query.page) || 1,
            limit: parseInt(req.query.limit) || parseInt(req.query.pageSize) || 10,
            supplier_gstin: req.query.supplier_gstin || req.query.customer_gstin,
            supplier_name: req.query.supplier_name || req.query.customer_name,
            state_codes: req.query.state_codes,
            from_date: req.query.from_date,
            to_date: req.query.to_date,
            sort_by: req.query.sort_by,
            sort_order: req.query.sort_order
        };`
);
fs.writeFileSync(supplierCtrl, suppContent);
