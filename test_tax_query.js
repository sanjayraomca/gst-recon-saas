const knex = require('./services/shared/src/db/connection');

async function testQuery() {
    const workspaceId = '0bfd15ee-e667-41bb-8c5b-83d6d3fe1e54';
    const runId = 'e4d3685c-cf7c-4835-8e2b-895f32cabedd';
    const fy = '2025-26';
    const quarter = '1';
    const month = '4';

    const filterYear = parseInt(fy.split('-')[0]);
    const m = parseInt(month);
    const yearForMonth = (m >= 1 && m <= 3) ? filterYear + 1 : filterYear;
    const exactPeriod = `${String(m).padStart(2, '0')}${yearForMonth}`;

    console.log(`Testing query for Workspace: ${workspaceId}, Run: ${runId}, Period: ${exactPeriod}`);

    try {
        const agg = await knex('reconciliation_results as rr')
            .leftJoin('purchase_vouchers as pi', 'rr.purchase_invoice_id', 'pi.id')
            .leftJoin('normalized_gstr2b_invoices as gi', 'rr.gstr2b_invoice_id', 'gi.id')
            .leftJoin('tax_periods as tp', 'pi.tax_period_id', 'tp.id')
            .where('rr.workspace_id', workspaceId)
            .where('rr.recon_run_id', runId)
            .where(function() {
                this.where('tp.period_code', exactPeriod)
                    .orWhere('gi.return_period', exactPeriod);
            })
            .select(
                knex.raw("COALESCE(tp.period_code, gi.return_period, '000000') as period"),
                knex.raw("UPPER(COALESCE(pi.source_section, gi.source_section, 'OTHER')) as category"),
                knex.raw("COUNT(pi.id) as books_count"),
                knex.raw("SUM(COALESCE(pi.total_igst_amount,0)) as books_igst"),
                knex.raw("COUNT(gi.id) as gstr2b_count")
            )
            .groupByRaw("COALESCE(tp.period_code, gi.return_period, '000000'), UPPER(COALESCE(pi.source_section, gi.source_section, 'OTHER'))");

        console.log('Query Result:');
        console.table(agg);

    } catch (err) {
        console.error('Query Failed:', err);
    } finally {
        knex.destroy();
    }
}

testQuery();
