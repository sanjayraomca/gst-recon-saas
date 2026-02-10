
exports.up = function (knex) {
    return knex.schema.raw(`
    ALTER TABLE workspace_users 
    DROP CONSTRAINT workspace_users_role_check;

    ALTER TABLE workspace_users 
    ADD CONSTRAINT workspace_users_role_check 
    CHECK (role IN ('SUPER_ADMIN', 'TENANT_ADMIN', 'WORKSPACE_ADMIN', 'ORG_ADMIN', 'ACCOUNTANT', 'AUDITOR', 'VIEWER', 'GST_PRACTITIONER'));
  `);
};

exports.down = function (knex) {
    // Irreversible safely without data loss if we use new roles, but for rollback we can try:
    // This might fail if data exists with new roles.
    return knex.schema.raw(`
    ALTER TABLE workspace_users 
    DROP CONSTRAINT workspace_users_role_check;

    ALTER TABLE workspace_users 
    ADD CONSTRAINT workspace_users_role_check 
    CHECK (role IN ('SUPER_ADMIN', 'WORKSPACE_ADMIN', 'ACCOUNTANT', 'AUDITOR', 'VIEWER', 'GST_PRACTITIONER'));
  `);
};
