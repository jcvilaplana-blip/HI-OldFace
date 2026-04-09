"""
Deploy rápido: sube SOLO server.js al backend Plesk y reinicia el proceso.
No toca la base de datos (data/).
"""
import paramiko, io, os, sys, time
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

HOST = '212.227.80.115'; USER = 'root'; PASS = 'h5RmC8Hi'
PLESK_BACKEND = '/var/www/vhosts/fullstark.es/oldface.fullstark.es/frontend/backend'
LOCAL_SERVER  = r'c:/Users/jcvil/Desktop/PROYECTOS/William CHAT/app/oldface-app-FINAL/oldface-app/frontend/backend/server.js'

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=30)

def run(cmd, show=True):
    _, out, err = ssh.exec_command(cmd)
    out.channel.recv_exit_status()
    result = out.read().decode('utf-8', 'replace').strip()
    if show and result:
        print('    ', result)
    return result

print('[1] Subiendo server.js...')
sftp = ssh.open_sftp()
sftp.put(LOCAL_SERVER, f'{PLESK_BACKEND}/server.js')
sftp.close()
size = os.path.getsize(LOCAL_SERVER)
print(f'     OK ({size // 1024} KB)')

print('[2] Reiniciando backend (kill puerto 3001)...')
pid = run("lsof -i :3001 -n 2>/dev/null | grep LISTEN | awk '{print $2}' | head -1", show=False)
if pid:
    run(f'kill {pid}', show=False)
    print(f'     Killed PID {pid}')
    time.sleep(4)
else:
    print('     Proceso no encontrado por puerto, buscando por path...')
    pid2 = run("pgrep -f 'oldface.fullstark.es' | head -1", show=False)
    if pid2:
        run(f'kill {pid2}', show=False)
        print(f'     Killed PID {pid2}')
        time.sleep(4)
    else:
        print('     No encontrado — posiblemente PM2 lo reiniciará solo')

print('[3] Verificando health...')
time.sleep(3)
health = run('curl -s http://127.0.0.1:3001/api/health 2>/dev/null', show=False)
print('     Health:', health or '(sin respuesta aún)')

ssh.close()
print('\nserver.js actualizado. BD intacta.')
