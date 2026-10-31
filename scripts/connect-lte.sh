#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../deploy"
python3 - <<'PY'
import subprocess,json,secrets,pathlib,urllib.parse
container='remnawave-db'
inspection=subprocess.run(['docker','inspect',container],capture_output=True,text=True)
if inspection.returncode:raise SystemExit('Локальная БД Remnawave не найдена. Если она на другом VPS, используйте scripts/connect-lte-remote.sh SSH_АДРЕС.')
info=json.loads(inspection.stdout)[0]
env=dict(x.split('=',1) for x in info['Config']['Env'] if '=' in x)
user='postgres';db='postgres';password=secrets.token_hex(32)
# The platform compose already joins remnawave-network. Do not publish the database port.
if 'remnawave-network' not in info['NetworkSettings']['Networks']:
 raise SystemExit('remnawave-db не подключён к remnawave-network. Подключите БД к внутренней сети и повторите.')
sql=f"""
CREATE TABLE IF NOT EXISTS vaylo_lte_extra(user_id bigint NOT NULL,bytes bigint NOT NULL CHECK(bytes>0),granted_on date NOT NULL DEFAULT CURRENT_DATE);
CREATE TABLE IF NOT EXISTS vaylo_lte_optout(user_id bigint PRIMARY KEY);
CREATE TABLE IF NOT EXISTS vaylo_lte_orders(payment_id uuid PRIMARY KEY,user_id bigint NOT NULL,bytes bigint NOT NULL,granted_on date NOT NULL);
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='vaylo_lte') THEN CREATE ROLE vaylo_lte LOGIN; END IF; END $$;
ALTER ROLE vaylo_lte PASSWORD '{password}';
GRANT CONNECT ON DATABASE "{db.replace('"','""')}" TO vaylo_lte;
GRANT USAGE ON SCHEMA public TO vaylo_lte;
GRANT SELECT(id,username,status) ON users TO vaylo_lte;
GRANT SELECT ON internal_squads,nodes_user_usage_history,vaylo_lte_optout,vaylo_lte_extra,vaylo_lte_orders,internal_squad_members TO vaylo_lte;
GRANT INSERT ON vaylo_lte_extra,vaylo_lte_orders,internal_squad_members TO vaylo_lte;
GRANT DELETE ON internal_squad_members TO vaylo_lte;
DO $$ DECLARE seq text; BEGIN
IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='vaylo_lte_extra' AND column_name='id') THEN
seq:=pg_get_serial_sequence('vaylo_lte_extra','id'); IF seq IS NOT NULL THEN EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE %s TO vaylo_lte',seq); END IF; END IF; END $$;
"""
r=subprocess.run(['docker','exec','-i',container,'psql','-U',user,'-d',db,'-v','ON_ERROR_STOP=1','-q'],input=sql,text=True,capture_output=True)
if r.returncode:raise SystemExit('Не удалось подготовить LTE-таблицы. Проверьте схему Remnawave и права владельца БД.')
url='postgres://vaylo_lte:'+password+'@remnawave-db:5432/'+urllib.parse.quote(db,safe='')
p=pathlib.Path('.env');lines=[s for s in p.read_text().splitlines() if not s.startswith(('LTE_DATABASE_URL=','LTE_NODE_ID='))];p.write_text('\n'.join(lines)+'\nLTE_DATABASE_URL='+url+'\nLTE_NODE_ID=2\n');p.chmod(0o600)
print('Учёт LTE подключён к БД через отдельную роль. Секрет сохранён в deploy/.env.')
PY
docker compose up -d --force-recreate api worker
