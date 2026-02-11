const jwt = require('jsonwebtoken');

const token = jwt.sign({
    sub: 'test-user',
    email: 'test@example.com',
    preferred_username: 'testuser',
    realm_access: { roles: ['gst_admin'] },
    resource_access: { account: { roles: ['manage-account'] } }
}, 'dummy-secret', { expiresIn: '1h' });

console.log(token);
