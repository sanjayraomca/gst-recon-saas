exports.up = async function (knex) {
    // Add encrypted GSTIN password column to gstin_master table
    await knex.schema.alterTable('gstin_master', function (table) {
        table.text('gstin_pwd_encrypted').nullable().comment('Encrypted GSTIN portal password');
        table.timestamp('password_updated_at').nullable().comment('Last time password was updated');
    });
};

exports.down = async function (knex) {
    await knex.schema.alterTable('gstin_master', function (table) {
        table.dropColumn('gstin_pwd_encrypted');
        table.dropColumn('password_updated_at');
    });
};
