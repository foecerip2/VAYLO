#!/usr/bin/env python3
"""Run on the VPN platform host as root. No remote DB port publication."""
import argparse,json,os,pathlib,re,secrets,shlex,socket,subprocess,sys,time,urllib.parse,tempfile
from importlib.machinery import SourceFileLoader

def run(args,**kwargs):
    return subprocess.run(args,check=True,**kwargs)

def prepare_source(root,password):
    local_source=(root/'scripts/connect-lte.sh').read_text().split("<<'PY'\n",1)[1].split('\nPY\n',1)[0]
    sql_source=local_source.split('sql=f"""',1)[1].split('"""',1)[0]
    remote_code="""import subprocess,json,sys
container,user,db=sys.argv[1:4]
password=PASSWORD
info=json.loads(subprocess.check_output(['docker','inspect',container],stderr=subprocess.DEVNULL))[0]
if not info['State']['Running']:raise SystemExit(2)
check=subprocess.run(['docker','exec',container,'psql','-U',user,'-d',db,'-Atqc',"SELECT to_regclass('public.users') IS NOT NULL AND to_regclass('public.internal_squads') IS NOT NULL AND to_regclass('public.nodes_user_usage_history') IS NOT NULL"],capture_output=True,text=True)
if check.returncode or check.stdout.strip()!='t':raise SystemExit(3)
password=password.replace("'","''")
sql=f\"\"\"SQL_SOURCE\"\"\"
r=subprocess.run(['docker','exec','-i',container,'psql','-U',user,'-d',db,'-v','ON_ERROR_STOP=1','-q'],input=sql,text=True,capture_output=True)
if r.returncode:raise SystemExit(4)
""".replace('PASSWORD',repr(password)).replace('SQL_SOURCE',sql_source)
    return remote_code

def main():
    parser=argparse.ArgumentParser(description='Подключение LTE к Remnawave на другом VPS через SSH')
    parser.add_argument('target',help='SSH: root@адрес_Remnawave')
    parser.add_argument('--port',type=int,default=22)
    parser.add_argument('--container',default='remnawave-db')
    parser.add_argument('--database',default='postgres')
    parser.add_argument('--db-user',default='postgres')
    args=parser.parse_args()
    if os.geteuid()!=0:raise SystemExit('Запустите через sudo')
    if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.@-]{0,250}',args.target) or not 1<=args.port<=65535:raise SystemExit('Некорректный SSH-адрес или порт')
    for value in (args.container,args.database,args.db_user):
        if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,100}',value):raise SystemExit('Некорректное имя контейнера/БД/пользователя')
    root=pathlib.Path(__file__).resolve().parent.parent;deploy=root/'deploy'
    if not (deploy/'.env').is_file():raise SystemExit('Не найден deploy/.env установленной платформы')
    run(['systemctl','--version'],stdout=subprocess.DEVNULL)
    tunnel=SourceFileLoader('lte_tunnel',str(root/'scripts/lte-ssh-tunnel.py')).load_module()
    cfg={'target':args.target,'ssh_port':args.port,'container':args.container,'port':15432}
    ssh=tunnel.options(cfg)
    test=subprocess.run(ssh+[args.target,'true'],capture_output=True)
    if test.returncode:raise SystemExit('SSH-вход по ключу не работает. Сначала настройте ssh/ssh-copy-id и проверьте ключ сервера. Пароль в скрипте не сохраняется.')
    # Bind only to the private gateway used by the API's Docker network.
    info=json.loads(subprocess.check_output(['docker','inspect','vpn-api']))[0]
    networks=info['NetworkSettings']['Networks']
    network='vpn_default' if 'vpn_default' in networks else next((n for n in networks if n!='remnawave-network'),None)
    if not network:raise SystemExit('Не найдена внутренняя Docker-сеть API')
    data=json.loads(subprocess.check_output(['docker','network','inspect',network]))[0]
    cfg['bind']=next((v['Gateway'] for v in data['IPAM']['Config'] if ':' not in v.get('Gateway','')),None)
    if not cfg['bind']:raise SystemExit('Не найден IPv4 gateway Docker-сети')
    # Fail before changing a remote credential if another process owns this port.
    service='vaylo-lte-tunnel.service'
    active=subprocess.run(['systemctl','is-active','--quiet',service]).returncode==0
    if not active:
        with socket.socket() as sock:
            try:sock.bind((cfg['bind'],cfg['port']))
            except OSError:raise SystemExit('Порт 15432 Docker gateway занят. Изменения не выполнены.')
    env=deploy/'.env';text=env.read_text();old=dict(line.split('=',1) for line in text.splitlines() if '=' in line and not line.startswith('#'))
    existing=urllib.parse.urlsplit(old.get('LTE_DATABASE_URL',''))
    password=urllib.parse.unquote(existing.password) if existing.username=='vaylo_lte' and existing.password else secrets.token_hex(32)
    # The helper is our own code, sent over encrypted SSH stdin. Never print SQL/password.
    remote_code=prepare_source(root,password)
    command=shlex.join(['python3','-',args.container,args.db_user,args.database])
    result=subprocess.run(ssh+[args.target,command],input=remote_code,text=True,capture_output=True,timeout=45)
    if result.returncode:raise SystemExit('Не удалось подготовить LTE на VPS Remnawave: проверьте имя контейнера, пользователя, БД и схему. Данные подключения платформы не изменены.')
    config_path=pathlib.Path('/etc/vaylo-lte-tunnel.json')
    config_path.write_text(json.dumps(cfg));config_path.chmod(0o600)
    unit=pathlib.Path('/etc/systemd/system')/service
    python_path='/usr/bin/python3'
    executable=str(root/'scripts/lte-ssh-tunnel.py')
    # systemd quoted ExecStart arguments; installed paths must not contain literal newlines.
    if any(c in executable for c in ('\n','\r','%')):raise SystemExit('Неподдерживаемый путь установки')
    escaped=executable.replace('\\','\\\\').replace('"','\\"')
    unit.write_text('[Unit]\nDescription=VAYLO LTE PostgreSQL SSH tunnel\nAfter=network-online.target docker.service\nWants=network-online.target\n\n[Service]\nType=simple\nExecStart='+python_path+' "'+escaped+'" '+str(config_path)+'\nRestart=always\nRestartSec=5\nKillMode=control-group\nNoNewPrivileges=true\n\n[Install]\nWantedBy=multi-user.target\n')
    run(['systemctl','daemon-reload']);run(['systemctl','enable',service],stdout=subprocess.DEVNULL);run(['systemctl','restart',service])
    for _ in range(20):
        if tunnel.probe(cfg['bind'],cfg['port']):break
        time.sleep(1)
    else:raise SystemExit('Туннель не готов. Проверьте journalctl -u vaylo-lte-tunnel -n 40. LTE_DATABASE_URL не изменён.')
    url='postgres://vaylo_lte:'+urllib.parse.quote(password,safe='')+'@'+cfg['bind']+':'+str(cfg['port'])+'/'+urllib.parse.quote(args.database,safe='')
    lines=[s for s in text.splitlines() if not s.startswith(('LTE_DATABASE_URL=','LTE_NODE_ID='))]
    fd,temp_name=tempfile.mkstemp(prefix='.env.lte-',dir=deploy)
    temp=pathlib.Path(temp_name)
    with os.fdopen(fd,'w') as out:out.write('\n'.join(lines)+'\nLTE_DATABASE_URL='+url+'\nLTE_NODE_ID=2\n')
    os.replace(temp,env);env.chmod(0o600)
    run(['docker','compose','up','-d','--force-recreate','api','worker'],cwd=deploy)
    print('LTE подключён через SSH. Туннель запускается автоматически; порт БД в интернет не опубликован.')
if __name__=='__main__':
    try:main()
    except (subprocess.SubprocessError,OSError) as exc:raise SystemExit('Ошибка подключения. Проверьте Docker, systemd и SSH; секреты не выводятся.')
