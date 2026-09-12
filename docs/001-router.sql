CREATE TABLE IF NOT EXISTS router_config (key varchar(80) PRIMARY KEY, value text NOT NULL, revision integer NOT NULL DEFAULT 1,
 _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 _created_by user_profile DEFAULT (CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile END),
 _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 _updated_by user_profile DEFAULT (CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile END));
ALTER TABLE router_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_bypass_policy ON router_config TO service_role USING (true);
CREATE POLICY "修改全部数据" ON router_config AS PERMISSIVE FOR ALL TO authenticated USING ('router_admin' = ANY(string_to_array(current_setting('app.role_ids', true), ',')));
CREATE POLICY "查看全部数据" ON router_config AS PERMISSIVE FOR SELECT TO authenticated, anon USING (false);
CREATE POLICY "修改本人数据" ON router_config AS PERMISSIVE FOR ALL TO authenticated USING (false);

CREATE TABLE IF NOT EXISTS router_event (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind varchar(30) NOT NULL, payload text NOT NULL,
 _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 _created_by user_profile DEFAULT (CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile END),
 _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 _updated_by user_profile DEFAULT (CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile END));
ALTER TABLE router_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_bypass_policy ON router_event TO service_role USING (true);
CREATE POLICY "修改全部数据" ON router_event AS PERMISSIVE FOR ALL TO authenticated USING ('router_admin' = ANY(string_to_array(current_setting('app.role_ids', true), ',')));
CREATE POLICY "查看全部数据" ON router_event AS PERMISSIVE FOR SELECT TO authenticated, anon USING (false);
CREATE POLICY "修改本人数据" ON router_event AS PERMISSIVE FOR ALL TO authenticated USING (false);

CREATE TABLE IF NOT EXISTS router_lease (slot integer PRIMARY KEY, lease_id uuid NOT NULL, expires_at timestamptz NOT NULL,
 _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 _created_by user_profile DEFAULT (CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile END),
 _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 _updated_by user_profile DEFAULT (CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile END));
ALTER TABLE router_lease ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_bypass_policy ON router_lease TO service_role USING (true);
CREATE POLICY "修改全部数据" ON router_lease AS PERMISSIVE FOR ALL TO authenticated USING ('router_admin' = ANY(string_to_array(current_setting('app.role_ids', true), ',')));
CREATE POLICY "查看全部数据" ON router_lease AS PERMISSIVE FOR SELECT TO authenticated, anon USING (false);
CREATE POLICY "修改本人数据" ON router_lease AS PERMISSIVE FOR ALL TO authenticated USING (false);

CREATE TABLE IF NOT EXISTS router_rate (key varchar(120) PRIMARY KEY, used integer NOT NULL DEFAULT 1,
 _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 _created_by user_profile DEFAULT (CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile END),
 _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 _updated_by user_profile DEFAULT (CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile END));
ALTER TABLE router_rate ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_bypass_policy ON router_rate TO service_role USING (true);
CREATE POLICY "修改全部数据" ON router_rate AS PERMISSIVE FOR ALL TO authenticated USING ('router_admin' = ANY(string_to_array(current_setting('app.role_ids', true), ',')));
CREATE POLICY "查看全部数据" ON router_rate AS PERMISSIVE FOR SELECT TO authenticated, anon USING (false);
CREATE POLICY "修改本人数据" ON router_rate AS PERMISSIVE FOR ALL TO authenticated USING (false);

CREATE INDEX idx_router_event_created ON router_event (_created_at DESC);
CREATE INDEX idx_router_lease_expires ON router_lease (expires_at);
