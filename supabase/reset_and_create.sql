-- ============================================================
-- СБРОС — удаляем всё старое
-- ============================================================
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
DROP TRIGGER IF EXISTS projects_updated_at ON projects;

DROP FUNCTION IF EXISTS handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS update_updated_at() CASCADE;
DROP FUNCTION IF EXISTS get_my_role() CASCADE;
DROP FUNCTION IF EXISTS get_my_client_id() CASCADE;

DROP TABLE IF EXISTS financial_records CASCADE;
DROP TABLE IF EXISTS schedule_entries CASCADE;
DROP TABLE IF EXISTS offers CASCADE;
DROP TABLE IF EXISTS files CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS clients CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;

DROP TYPE IF EXISTS user_role CASCADE;
DROP TYPE IF EXISTS session_status CASCADE;
DROP TYPE IF EXISTS project_status CASCADE;
DROP TYPE IF EXISTS file_type CASCADE;
DROP TYPE IF EXISTS offer_status CASCADE;
DROP TYPE IF EXISTS loyalty_tier CASCADE;
DROP TYPE IF EXISTS financial_record_type CASCADE;

-- ============================================================
-- ТИПЫ
-- ============================================================
CREATE TYPE user_role AS ENUM ('OWNER', 'MANAGER', 'STAFF', 'CLIENT');
CREATE TYPE session_status AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE project_status AS ENUM ('ACTIVE', 'COMPLETED', 'ARCHIVED');
CREATE TYPE file_type AS ENUM ('RECORDING', 'MIX', 'MASTER', 'OTHER');
CREATE TYPE offer_status AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED');
CREATE TYPE loyalty_tier AS ENUM ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM');
CREATE TYPE financial_record_type AS ENUM ('INVOICE', 'ACT', 'PAYMENT');

-- ============================================================
-- ПРОФИЛИ
-- ============================================================
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT,
  full_name TEXT,
  role user_role NOT NULL DEFAULT 'CLIENT',
  phone TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- КЛИЕНТЫ
-- ============================================================
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE UNIQUE NOT NULL,
  client_since TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  loyalty_tier loyalty_tier NOT NULL DEFAULT 'BRONZE',
  loyalty_points INTEGER NOT NULL DEFAULT 0,
  total_hours NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_sessions INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- СЕССИИ
-- ============================================================
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  staff_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_minutes INTEGER GENERATED ALWAYS AS (
    CASE WHEN ended_at IS NOT NULL
    THEN EXTRACT(EPOCH FROM (ended_at - started_at))::INTEGER / 60
    ELSE NULL END
  ) STORED,
  status session_status NOT NULL DEFAULT 'SCHEDULED',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ПРОЕКТЫ
-- ============================================================
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status project_status NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER projects_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ФАЙЛЫ
-- ============================================================
CREATE TABLE files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  file_type file_type NOT NULL DEFAULT 'RECORDING',
  yandex_disk_url TEXT,
  yandex_expires_at TIMESTAMPTZ,
  internal_url TEXT,
  size_mb NUMERIC(10,2),
  duration_seconds INTEGER,
  uploaded_by UUID REFERENCES profiles(id) ON DELETE SET NULL NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ОФФЕРЫ
-- ============================================================
CREATE TABLE offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  price NUMERIC(12,2),
  status offer_status NOT NULL DEFAULT 'PENDING',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- РАСПИСАНИЕ
-- ============================================================
CREATE TABLE schedule_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ФИНАНСЫ
-- ============================================================
CREATE TABLE financial_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  record_type financial_record_type NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  description TEXT,
  document_url TEXT,
  date DATE NOT NULL,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- БЕЗОПАСНОСТЬ (RLS)
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_records ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION get_my_role()
RETURNS user_role AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_my_client_id()
RETURNS UUID AS $$
  SELECT id FROM clients WHERE profile_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE POLICY "profiles_select" ON profiles FOR SELECT
  USING (id = auth.uid() OR get_my_role() IN ('OWNER','MANAGER','STAFF'));
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE
  USING (id = auth.uid());

CREATE POLICY "clients_select_own" ON clients FOR SELECT
  USING (profile_id = auth.uid() OR get_my_role() IN ('OWNER','MANAGER','STAFF'));
CREATE POLICY "clients_manage" ON clients FOR ALL
  USING (get_my_role() IN ('OWNER','MANAGER'));

CREATE POLICY "sessions_select" ON sessions FOR SELECT
  USING (client_id = get_my_client_id() OR get_my_role() IN ('OWNER','MANAGER','STAFF'));
CREATE POLICY "sessions_manage" ON sessions FOR ALL
  USING (get_my_role() IN ('OWNER','MANAGER','STAFF'));

CREATE POLICY "projects_select" ON projects FOR SELECT
  USING (client_id = get_my_client_id() OR get_my_role() IN ('OWNER','MANAGER','STAFF'));
CREATE POLICY "projects_manage" ON projects FOR ALL
  USING (get_my_role() IN ('OWNER','MANAGER'));

CREATE POLICY "files_select" ON files FOR SELECT
  USING (client_id = get_my_client_id() OR get_my_role() IN ('OWNER','MANAGER','STAFF'));
CREATE POLICY "files_manage" ON files FOR ALL
  USING (get_my_role() IN ('OWNER','MANAGER','STAFF'));

CREATE POLICY "offers_select" ON offers FOR SELECT
  USING (client_id = get_my_client_id() OR get_my_role() IN ('OWNER','MANAGER'));
CREATE POLICY "offers_manage" ON offers FOR ALL
  USING (get_my_role() IN ('OWNER','MANAGER'));
CREATE POLICY "offers_update_own" ON offers FOR UPDATE
  USING (client_id = get_my_client_id());

CREATE POLICY "schedule_select" ON schedule_entries FOR SELECT
  USING (staff_id = auth.uid() OR get_my_role() IN ('OWNER','MANAGER'));
CREATE POLICY "schedule_manage" ON schedule_entries FOR ALL
  USING (get_my_role() IN ('OWNER','MANAGER'));

CREATE POLICY "financial_select" ON financial_records FOR SELECT
  USING (get_my_role() IN ('OWNER','MANAGER'));
CREATE POLICY "financial_manage" ON financial_records FOR ALL
  USING (get_my_role() IN ('OWNER','MANAGER'));

-- ============================================================
-- ТРИГГЕР: автосоздание профиля
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(COALESCE(NEW.email,''), '@', 1), 'Пользователь'),
    'CLIENT'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- ИНДЕКСЫ
-- ============================================================
CREATE INDEX idx_clients_profile_id ON clients(profile_id);
CREATE INDEX idx_sessions_client_id ON sessions(client_id);
CREATE INDEX idx_sessions_staff_id ON sessions(staff_id);
CREATE INDEX idx_sessions_started_at ON sessions(started_at);
CREATE INDEX idx_files_client_id ON files(client_id);
CREATE INDEX idx_files_yandex_expires ON files(yandex_expires_at);
CREATE INDEX idx_offers_client_id ON offers(client_id);
CREATE INDEX idx_schedule_staff_date ON schedule_entries(staff_id, date);
CREATE INDEX idx_financial_date ON financial_records(date);
