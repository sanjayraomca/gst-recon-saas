process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '5435';
process.env.DB_USER = 'gstadmin';
process.env.DB_PASSWORD = 'GstAdmin123';
process.env.DB_NAME = 'gst_recon';

const knex = require('../services/shared/src/db/connection');

async function main() {
    try {
        console.log('Creating table tig_inbound_outbound_log...');
        
        await knex.raw(`
            CREATE TABLE IF NOT EXISTS tig_inbound_outbound_log (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                type varchar(255),
                request_type varchar(255),
                user_id varchar(255),
                tenant_id varchar(255),
                org_id varchar(255),
                access_key varchar(255),
                platform varchar(255),
                t_params jsonb,
                t_resp_headers jsonb,
                t_resp_body jsonb,
                ip_address varchar(255),
                created_at timestamp with time zone DEFAULT now(),
                updated_at timestamp with time zone DEFAULT now(),
                user_agent varchar(255),
                status varchar(255),
                extrainfo jsonb
            );
        `);
        
        console.log('Table tig_inbound_outbound_log created successfully!');
        
        // Describe table structure to verify
        const columns = await knex('information_schema.columns')
            .where({ table_name: 'tig_inbound_outbound_log' })
            .select('column_name', 'data_type');
            
        console.log('Columns:', columns);
    } catch (err) {
        console.error('Error creating table:', err);
    } finally {
        await knex.destroy();
    }
}

main();
