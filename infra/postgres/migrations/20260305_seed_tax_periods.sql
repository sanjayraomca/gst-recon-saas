DO $$
DECLARE
    fy_id_2425 UUID;
    fy_id_2526 UUID;
    fy_id_2627 UUID;
    m INT;
    y INT;
    q INT;
    period_str VARCHAR(6);
    start_d DATE;
    end_d DATE;
    fy_id UUID;
BEGIN
    -- Insert Financial Years
    INSERT INTO financial_years (fy_code, start_date, end_date, is_current) 
    VALUES ('2024-25', '2024-04-01', '2025-03-31', false) ON CONFLICT(fy_code) DO NOTHING;
    INSERT INTO financial_years (fy_code, start_date, end_date, is_current) 
    VALUES ('2025-26', '2025-04-01', '2026-03-31', true) ON CONFLICT(fy_code) DO NOTHING;
    INSERT INTO financial_years (fy_code, start_date, end_date, is_current) 
    VALUES ('2026-27', '2026-04-01', '2027-03-31', false) ON CONFLICT(fy_code) DO NOTHING;
    
    SELECT id INTO fy_id_2425 FROM financial_years WHERE fy_code = '2024-25';
    SELECT id INTO fy_id_2526 FROM financial_years WHERE fy_code = '2025-26';
    SELECT id INTO fy_id_2627 FROM financial_years WHERE fy_code = '2026-27';

    -- Seed Monthly periods from Apr 2024 to Mar 2027
    FOR y IN 2024..2027 LOOP
        FOR m IN 1..12 LOOP
            -- Skip months outside our FY boundaries
            IF y = 2024 AND m < 4 THEN CONTINUE; END IF;
            IF y = 2027 AND m > 3 THEN CONTINUE; END IF;
            
            period_str := LPAD(m::TEXT, 2, '0') || y::TEXT;
            start_d := MAKE_DATE(y, m, 1);
            end_d := (start_d + INTERVAL '1 month - 1 day')::DATE;
            q := EXTRACT(QUARTER FROM start_d);
            
            IF y = 2024 OR (y = 2025 AND m < 4) THEN fy_id := fy_id_2425;
            ELSIF y = 2025 OR (y = 2026 AND m < 4) THEN fy_id := fy_id_2526;
            ELSE fy_id := fy_id_2627;
            END IF;
            
            INSERT INTO tax_periods (fy_id, period_type, month, quarter, year, period_code, start_date, end_date)
            VALUES (fy_id, 'MONTHLY', m, q, y, period_str, start_d, end_d)
            ON CONFLICT (period_code) DO NOTHING;
        END LOOP;
    END LOOP;
END $$;
