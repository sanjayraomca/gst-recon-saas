-- Seed sample activity logs for testing
-- This script inserts sample activity data for the tenant

DO $$
DECLARE
    v_tenant_id uuid;
    v_user_id uuid;
    v_workspace_id uuid;
BEGIN
    -- Get the first tenant
    SELECT id INTO v_tenant_id FROM tenants LIMIT 1;
    
    -- Get the first workspace for this tenant
    SELECT id INTO v_workspace_id FROM workspaces WHERE tenant_id = v_tenant_id LIMIT 1;
    
    -- Get the first user from workspace_users
    SELECT user_id INTO v_user_id 
    FROM workspace_users 
    WHERE workspace_id = v_workspace_id 
    LIMIT 1;
    
    -- Insert sample activities if tenant, workspace and user exist
    IF v_tenant_id IS NOT NULL AND v_user_id IS NOT NULL AND v_workspace_id IS NOT NULL THEN
        -- Clear existing logs for fresh start
        DELETE FROM activity_logs WHERE tenant_id = v_tenant_id;

        -- User login activity
        INSERT INTO activity_logs (user_id, tenant_id, workspace_id, action_type, entity_type, entity_id, details, ip_address, created_at)
        VALUES 
            (v_user_id, v_tenant_id, v_workspace_id, 'user_created', 'user management', v_user_id, 
             '{"target_user_email": "priya.junior@taxcorp.com"}', '192.168.1.100', NOW() - INTERVAL '5 hours'),
            
            (v_user_id, v_tenant_id, v_workspace_id, 'settings_updated', 'settings', v_tenant_id, 
             '{"setting_name": "reconciliation"}', '192.168.1.100', NOW() - INTERVAL '4 hours'),
            
            (v_user_id, v_tenant_id, v_workspace_id, 'report_generated', 'reports', v_workspace_id, 
             '{"report_name": "compliance"}', '192.168.1.100', NOW() - INTERVAL '3 hours'),
            
            (v_user_id, v_tenant_id, v_workspace_id, 'import_data', 'data import', v_workspace_id, 
             '{"data_type": "purchase"}', '192.168.1.100', NOW() - INTERVAL '2 days'),
            
            (v_user_id, v_tenant_id, v_workspace_id, 'data_viewed', 'view', v_workspace_id, 
             '{"view_name": "GST filing status dashboard"}', '192.168.1.100', NOW() - INTERVAL '3 days'),
            
            (v_user_id, v_tenant_id, v_workspace_id, 'user_login', 'auth', v_user_id, 
             '{"description": "User logged in"}', '192.168.1.100', NOW() - INTERVAL '10 minutes');
        
        RAISE NOTICE 'Sample activity logs updated for tenant %, user %, workspace %', v_tenant_id, v_user_id, v_workspace_id;
    ELSE
        RAISE NOTICE 'Missing data: tenant=%, user=%, workspace=%', v_tenant_id, v_user_id, v_workspace_id;
    END IF;
END $$;
