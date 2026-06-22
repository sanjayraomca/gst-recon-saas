const fs = require('fs');
const path = require('path');

const custCtrlPath = path.join(__dirname, 'services/workspace-service/src/controllers/customerController.js');
let custContent = fs.readFileSync(custCtrlPath, 'utf8');
custContent = custContent.replace(
    'limit: parseInt(req.query.pageSize) || 10,',
    `limit: parseInt(req.query.page_size) || parseInt(req.query.pageSize) || 10,
            registration_status: req.query.registration_status,`
);
fs.writeFileSync(custCtrlPath, custContent);


const suppCtrlPath = path.join(__dirname, 'services/workspace-service/src/controllers/supplierController.js');
let suppContent = fs.readFileSync(suppCtrlPath, 'utf8');
suppContent = suppContent.replace(
    'limit: parseInt(req.query.pageSize) || 10,',
    `limit: parseInt(req.query.page_size) || parseInt(req.query.pageSize) || 10,
            registration_status: req.query.registration_status,`
).replace(
    'limit: parseInt(req.query.limit) || parseInt(req.query.pageSize) || 10,',
    `limit: parseInt(req.query.page_size) || parseInt(req.query.limit) || parseInt(req.query.pageSize) || 10,
            registration_status: req.query.registration_status,`
);
fs.writeFileSync(suppCtrlPath, suppContent);

