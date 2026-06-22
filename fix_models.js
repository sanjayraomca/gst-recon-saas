const fs = require('fs');
const path = require('path');

const custModelPath = path.join(__dirname, 'services/workspace-service/src/models/customerModel.js');
let custContent = fs.readFileSync(custModelPath, 'utf8');
custContent = custContent.replace(
    'const { search, customer_gstin, customer_name, state_codes, from_date, to_date } = filters;',
    'const { search, customer_gstin, customer_name, state_codes, registration_status } = filters;'
);
const custRegBlock = `
        if (registration_status) {
            if (registration_status === 'registered') {
                query.whereRaw("COALESCE(cm.gstin, '') != '' AND cm.gstin NOT ILIKE '%UNREGISTERED%'");
            } else if (registration_status === 'unregistered') {
                query.whereRaw("COALESCE(cm.gstin, '') = '' OR cm.gstin ILIKE '%UNREGISTERED%'");
            }
        }
`;
custContent = custContent.replace(
    'return query;',
    custRegBlock + '\n        return query;'
);
fs.writeFileSync(custModelPath, custContent);


const suppModelPath = path.join(__dirname, 'services/workspace-service/src/models/supplierModel.js');
let suppContent = fs.readFileSync(suppModelPath, 'utf8');
suppContent = suppContent.replace(
    'const { search, supplier_gstin, supplier_name, state_codes, from_date, to_date } = filters;',
    'const { search, supplier_gstin, supplier_name, state_codes, registration_status } = filters;'
);
const suppRegBlock = `
        if (registration_status) {
            if (registration_status === 'registered') {
                query.whereRaw("COALESCE(sm.gstin, '') != '' AND sm.gstin NOT ILIKE '%UNREGISTERED%'");
            } else if (registration_status === 'unregistered') {
                query.whereRaw("COALESCE(sm.gstin, '') = '' OR sm.gstin ILIKE '%UNREGISTERED%'");
            }
        }
`;
suppContent = suppContent.replace(
    'return query;',
    suppRegBlock + '\n        return query;'
);
fs.writeFileSync(suppModelPath, suppContent);

