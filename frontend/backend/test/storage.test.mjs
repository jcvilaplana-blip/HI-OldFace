// Copia de archivos en Supabase Storage (db/storage.js), contra el bucket real en una carpeta de prueba que se borra
// al terminar: subir, cambiar, borrar (nunca resucitar), archivos a medias y demasiado grandes, restaurar en un
// servidor nuevo y que el bucket es privado.
// Uso: npm test (sin DB_TEST_ENV solo lo básico) · DB_TEST_ENV=<archivo con STORAGE_URL, STORAGE_KEY…> node test/storage.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const createStorage = require('../db/storage.js');

let ok = 0, fail = 0;
const check = (name, cond, extra = '') => { cond ? ok++ : fail++; console.log(`${cond ? 'OK ' : 'FALLO'}  ${name}${cond ? '' : '  ' + extra}`); };
const quiet = { log() {}, warn() {}, error() {} };

check('sin STORAGE_KEY no hace nada', createStorage({ dataDir: os.tmpdir(), dirs: { backend: os.tmpdir() }, env: {} }).enabled === false);
check('STORAGE_MODE=off lo apaga', createStorage({ dataDir: os.tmpdir(), dirs: { backend: os.tmpdir() }, env: { STORAGE_URL: 'https://x', STORAGE_KEY: 'k', STORAGE_MODE: 'off' } }).enabled === false);

const envFile = process.env.DB_TEST_ENV;
if (!envFile) {
  console.log('\n(sin DB_TEST_ENV: se omite la prueba contra Supabase Storage)');
} else {
  const v = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  const PREFIX = `test_${crypto.randomBytes(4).toString('hex')}`;
  const env = { STORAGE_URL: v.STORAGE_URL, STORAGE_KEY: v.STORAGE_KEY, STORAGE_BUCKET: v.STORAGE_BUCKET, STORAGE_SETTLE_MS: '0', STORAGE_MAX_BYTES: '200000' };
  const H = { apikey: v.STORAGE_KEY, Authorization: `Bearer ${v.STORAGE_KEY}` };
  const remote = async () => (await (await fetch(`${v.STORAGE_URL}/storage/v1/object/list/${v.STORAGE_BUCKET}`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: `${PREFIX}/`, limit: 1000 }) })).json()).filter(o => o.id).map(o => o.name).sort();
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'oldface-storage-'));
  const dataA = tmp(), upA = tmp();
  const put = (dir, name, bytes) => { fs.writeFileSync(path.join(dir, name), crypto.randomBytes(bytes)); };

  try {
    put(upA, 'foto.jpg', 3000); put(upA, 'audio.mp3', 5000); put(upA, '.oculto', 10); put(upA, 'grande.mp4', 300000);
    fs.writeFileSync(path.join(upA, 'subiendo.tmp'), 'x');
    const s1 = createStorage({ dataDir: dataA, dirs: { [PREFIX]: upA }, env, log: quiet, autoStart: false });
    await s1.scan();
    check('sube los archivos nuevos', (await remote()).join() === 'audio.mp3,foto.jpg', (await remote()).join());
    check('no sube ocultos, temporales ni los de más del límite', !(await remote()).some(n => /oculto|tmp|grande/.test(n)));
    check('registro guardado en data/ (no en uploads/)', fs.existsSync(path.join(dataA, 'storage-manifest.json')) && !fs.readdirSync(upA).includes('storage-manifest.json'));

    const fotoV2 = crypto.randomBytes(4000);
    fs.writeFileSync(path.join(upA, 'foto.jpg'), fotoV2);
    await s1.scan();
    check('un archivo cambiado se vuelve a subir', s1.status().uploaded === 3, JSON.stringify(s1.status()));

    fs.rmSync(path.join(upA, 'audio.mp3'));
    await s1.scan();
    check('borrado en el servidor → borrado en Storage', (await remote()).join() === 'foto.jpg', (await remote()).join());

    const slow = createStorage({ dataDir: dataA, dirs: { [PREFIX]: upA }, env: { ...env, STORAGE_SETTLE_MS: '60000' }, log: quiet, autoStart: false });
    put(upA, 'directo.webm', 1000);
    await slow.scan();
    check('un archivo que aún se está escribiendo espera', !(await remote()).includes('directo.webm'));
    fs.rmSync(path.join(upA, 'directo.webm'));

    // Servidor nuevo: sin registro y sin archivos → se restaura lo que hay en Storage (y nada borrado vuelve)
    const dataB = tmp(), upB = tmp();
    const s2 = createStorage({ dataDir: dataB, dirs: { [PREFIX]: upB }, env, log: quiet, autoStart: false });
    await s2.scan();
    check('servidor nuevo: restaura el archivo', fs.existsSync(path.join(upB, 'foto.jpg')) && fs.readFileSync(path.join(upB, 'foto.jpg')).equals(fotoV2));
    check('… y no resucita el borrado', !fs.existsSync(path.join(upB, 'audio.mp3')));
    check('… sin volver a subir nada', s2.status().uploaded === 0 && s2.status().restored === 1, JSON.stringify(s2.status()));

    // Con registro: un archivo que falta se borró a propósito ("ver una vez", cuenta eliminada) → se borra, no se trae
    fs.rmSync(path.join(upB, 'foto.jpg'));
    const s3 = createStorage({ dataDir: dataB, dirs: { [PREFIX]: upB }, env, log: quiet, autoStart: false });
    await s3.scan();
    check('borrado a propósito con el servidor parado → se borra de Storage', (await remote()).length === 0);
    check('… y no vuelve al disco', !fs.existsSync(path.join(upB, 'foto.jpg')));

    // Privado: sin clave no se puede leer ni por la dirección pública
    put(upA, 'privada.jpg', 500);
    await s1.scan();
    const pub = await fetch(`${v.STORAGE_URL}/storage/v1/object/public/${v.STORAGE_BUCKET}/${PREFIX}/privada.jpg`);
    check('el bucket no es público', pub.status >= 400, pub.status);
    const anon = await fetch(`${v.STORAGE_URL}/storage/v1/object/${v.STORAGE_BUCKET}/${PREFIX}/privada.jpg`);
    check('sin clave no se puede bajar', anon.status >= 400, anon.status);
    const bad = createStorage({ dataDir: tmp(), dirs: { [PREFIX]: upA }, env: { ...env, STORAGE_KEY: 'sb_secret_mala' }, log: quiet, autoStart: false });
    await bad.scan();
    check('con una clave mala falla sin romper nada', bad.status().failures === 1 && fs.existsSync(path.join(upA, 'privada.jpg')));
  } finally {
    const left = await remote();
    if (left.length) await fetch(`${v.STORAGE_URL}/storage/v1/object/${v.STORAGE_BUCKET}`, { method: 'DELETE', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: left.map(n => `${PREFIX}/${n}`) }) });
  }
}

console.log(`\n${ok} OK · ${fail} fallos`);
process.exit(fail ? 1 : 0);
