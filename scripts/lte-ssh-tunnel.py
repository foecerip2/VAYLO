#!/usr/bin/env python3
"""Persistent SSH forward to a Docker-only Postgres; re-resolve IP after failure."""
import json,subprocess,socket,struct,time,sys,signal,shlex

def probe(host,port):
    try:
        with socket.create_connection((host,port),timeout=3) as sock:
            sock.settimeout(3)
            sock.sendall(struct.pack('!II',8,80877103))
            return sock.recv(1) in (b'N',b'S')
    except OSError:
        return False

def options(cfg):
    return ['ssh','-p',str(cfg['ssh_port']),'-o','BatchMode=yes','-o','IdentityAgent=none','-o','ControlMaster=no','-o','ControlPath=none','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3']

def main():
    cfg=json.load(open(sys.argv[1]));args=options(cfg)
    code="import subprocess,json,sys;d=json.loads(subprocess.check_output(['docker','inspect',sys.argv[1]],stderr=subprocess.DEVNULL))[0];ips=[v.get('IPAddress') for v in d['NetworkSettings']['Networks'].values() if v.get('IPAddress')];print(ips[0] if d['State']['Running'] and ips else '')"
    command=shlex.join(['python3','-c',code,cfg['container']])
    remote=subprocess.run(args+[cfg['target'],command],capture_output=True,text=True,timeout=25)
    ip=remote.stdout.strip()
    import ipaddress
    try: ipaddress.IPv4Address(ip)
    except ValueError: raise SystemExit('Не удалось определить адрес работающей БД Remnawave через SSH')
    forward=f"{cfg['bind']}:{cfg['port']}:{ip}:5432"
    process=subprocess.Popen(args+['-o','ExitOnForwardFailure=yes','-N','-L',forward,cfg['target']])
    def stop(*_):
        process.terminate()
        try:process.wait(timeout=5)
        except subprocess.TimeoutExpired:process.kill()
        raise SystemExit(0)
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
    failures=0
    try:
        time.sleep(2)
        while process.poll() is None:
            failures=0 if probe(cfg['bind'],cfg['port']) else failures+1
            if failures>=3:break
            time.sleep(10)
    finally:
        if process.poll() is None:
            process.terminate()
            try:process.wait(timeout=5)
            except subprocess.TimeoutExpired:process.kill()
    raise SystemExit(1)
if __name__=='__main__':main()
