import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, scryptSync, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

const kdf = { N: 262144, r: 8, p: 1, maxmem: 536870912 };
const limit = 64 * 1024 * 1024;
const mappedPath = name => name.replaceAll('\\', '/').replace(/^baidoo\/SK-s-QuickData-Plug\//, 'baidoo/quickdata-older-ui-copy/');

function derive(password, salt) { return scryptSync(password, salt, 32, kdf); }
function digest(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const input = fs.createReadStream(file);
    input.on('data', chunk => hash.update(chunk));
    input.on('error', reject);
    input.on('end', () => resolve(hash.digest('hex')));
  });
}
class Parts extends Writable {
  constructor(directory) { super(); this.directory = directory; this.parts = []; this.fd = undefined; }
  finishPart() {
    if (this.fd === undefined) return;
    fs.closeSync(this.fd);
    this.parts.push({ name: this.name, bytes: this.bytes, sha256: this.hash.digest('hex') });
    this.fd = undefined;
  }
  _write(chunk, encoding, callback) {
    try {
      while (chunk.length) {
        if (this.fd === undefined) {
          this.name = `projects-and-settings.enc.${String(this.parts.length + 1).padStart(3, '0')}`;
          this.fd = fs.openSync(path.join(this.directory, this.name), 'wx', 0o600);
          this.hash = createHash('sha256'); this.bytes = 0;
        }
        const size = Math.min(limit - this.bytes, chunk.length);
        const slice = chunk.subarray(0, size);
        let written = 0;
        while (written < size) written += fs.writeSync(this.fd, slice, written, size - written);
        this.hash.update(slice); this.bytes += size; chunk = chunk.subarray(size);
        if (this.bytes === limit) this.finishPart();
      }
      callback();
    } catch (error) { callback(error); }
  }
  _final(callback) { try { this.finishPart(); callback(); } catch (error) { callback(error); } }
  _destroy(error, callback) { if (this.fd !== undefined) fs.closeSync(this.fd); this.fd = undefined; callback(error); }
}
function metadata(directory) {
  const meta = JSON.parse(fs.readFileSync(path.join(directory, 'backup-format.json'), 'utf8'));
  if (meta.format !== 'baidoo-encrypted-backup-v1' || meta.cipher !== 'aes-256-gcm' || meta.kdf !== 'scrypt-N262144-r8-p1'
    || !Array.isArray(meta.parts) || !meta.parts.length
    || !/^[a-f0-9]{64}$/.test(meta.salt) || !/^[a-f0-9]{24}$/.test(meta.nonce) || !/^[a-f0-9]{32}$/.test(meta.tag)) throw new Error('Unsupported backup metadata');
  for (let i = 0; i < meta.parts.length; i++) {
    const part = meta.parts[i];
    if (part.name !== `projects-and-settings.enc.${String(i + 1).padStart(3, '0')}` || !Number.isSafeInteger(part.bytes)
      || part.bytes < 1 || part.bytes > limit || !/^[a-f0-9]{64}$/.test(part.sha256)) throw new Error('Invalid backup volume');
  }
  return meta;
}
async function* encryptedParts(directory, meta) {
  for (const part of meta.parts) yield* fs.createReadStream(path.join(directory, part.name));
}
async function checkParts(directory, meta) {
  for (const part of meta.parts) {
    const file = path.join(directory, part.name);
    if (fs.statSync(file).size !== part.bytes || await digest(file) !== part.sha256) throw new Error('Backup volume checksum failed');
  }
}
async function decrypt(directory, meta, key, output) {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(meta.nonce, 'hex'));
  decipher.setAuthTag(Buffer.from(meta.tag, 'hex'));
  await pipeline(Readable.from(encryptedParts(directory, meta)), decipher, output);
}
function childResult(child) {
  return new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error('Archive tool did not complete successfully'))); });
}
async function listArchive(directory, meta, key) {
  const tar = spawn(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-tzf', '-'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const result = childResult(tar);
  let listing = '';
  tar.stdout.setEncoding('utf8'); tar.stdout.on('data', chunk => { listing += chunk; });
  tar.stderr.resume();
  await Promise.all([decrypt(directory, meta, key, tar.stdin), result]);
  const names = listing.split(/\r?\n/).filter(Boolean);
  for (const name of names) if (name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').includes('..')) throw new Error('Unsafe path in backup');
  return names;
}
export async function createBackup({ password, desktop, fileList, output, expected, passwordSavedOffLaptop }) {
  if (typeof password !== 'string' || password.length < 20) throw new Error('Choose a password of at least 20 characters');
  if (passwordSavedOffLaptop !== true) throw new Error('Save the password outside this laptop before continuing');
  if (fs.existsSync(output) && fs.readdirSync(output).length) throw new Error('The backup output folder must be empty');
  fs.mkdirSync(output, { recursive: true });
  const salt = randomBytes(32), nonce = randomBytes(12), key = derive(password, salt);
  try {
    // Snapshot source files and give the older copy a distinct name for Windows restoration.
    const stage = fs.mkdtempSync(path.join(path.dirname(output), 'archive-overlay-'));
    const originals = fs.readFileSync(fileList, 'utf8').split(/\r?\n/).filter(Boolean);
    const stagedNames = [];
    for (const name of originals) {
      const mapped = mappedPath(name);
      const source = path.resolve(desktop, name), target = path.resolve(stage, mapped);
      if (!source.startsWith(path.resolve(desktop) + path.sep) || !target.startsWith(stage + path.sep)) throw new Error('Unexpected archive source path');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target); stagedNames.push(mapped);
    }
    const stagedList = path.join(stage, 'file-list.txt');
    fs.writeFileSync(stagedList, stagedNames.join('\n') + '\n');
    const tarArgs = ['-czf', '-', '--no-recursion', '-C', stage, '-T', stagedList];
    const tar = spawn('tar.exe', tarArgs, {
      cwd: desktop, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const result = childResult(tar); tar.stderr.resume();
    const cipher = createCipheriv('aes-256-gcm', key, nonce), parts = new Parts(output);
    await Promise.all([pipeline(tar.stdout, cipher, parts), result]);
    const meta = { format: 'baidoo-encrypted-backup-v1', cipher: 'aes-256-gcm', archive: 'tar.gz',
      kdf: 'scrypt-N262144-r8-p1', salt: salt.toString('hex'), nonce: nonce.toString('hex'), tag: cipher.getAuthTag().toString('hex'), parts: parts.parts };
    fs.writeFileSync(path.join(output, 'backup-format.json'), JSON.stringify(meta, null, 2));
    await checkParts(output, meta);
    const names = new Set(await listArchive(output, meta, key));
    const missing = expected.map(mappedPath).filter(name => !names.has(name));
    if (missing.length) throw new Error(`Archive verification found ${missing.length} missing files`);
    // Authenticate the same backup with an intentionally wrong password as well.
    let rejected = false;
    const wrongKey = derive(randomBytes(32).toString('hex'), salt);
    try { await decrypt(output, meta, wrongKey, new Writable({ write(chunk, encoding, next) { next(); } })); }
    catch { rejected = true; } finally { wrongKey.fill(0); }
    if (!rejected) throw new Error('Backup password rejection check failed');
    fs.writeFileSync(path.join(output, 'BACKUP-VERIFIED.json'), JSON.stringify({ format: meta.format,
      verifiedUtc: new Date().toISOString(), filesVerified: expected.length, wrongPasswordRejected: true,
      passwordSavedOffLaptop: true, originalFilesDeleted: false, Parts: meta.parts.map(p => ({ Name: p.name, Bytes: p.bytes, SHA256: p.sha256 })) }, null, 2));
    fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), meta.parts.map(p => `${p.sha256}  ${p.name}`).join('\n') + '\n');
    return { verified: true, files: expected.length, volumes: meta.parts.length, encryptedBytes: meta.parts.reduce((s, p) => s + p.bytes, 0) };
  } finally { key.fill(0); }
}
export async function restoreBackup({ password, directory, destination }) {
  const meta = metadata(directory); await checkParts(directory, meta);
  const key = derive(password, Buffer.from(meta.salt, 'hex'));
  try {
    await listArchive(directory, meta, key); // Authenticate and validate paths before extraction.
    if (fs.existsSync(destination)) throw new Error('Choose a new, nonexistent restore directory');
    fs.mkdirSync(destination, { recursive: true });
    const tarCommand = process.platform === 'win32' ? 'tar.exe' : 'tar';
    const tar = spawn(tarCommand, ['-xzf', '-', '-C', destination], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    tar.stderr.resume();
    await Promise.all([decrypt(directory, meta, key, tar.stdin), childResult(tar)]);
    return { restored: true, destination };
  } finally { key.fill(0); }
}
async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const request = JSON.parse(input); input = '';
  let answer;
  if (request.action === 'create') {
    const handover = request.handover, workspace = path.dirname(handover), desktop = path.dirname(workspace);
    const manifest = JSON.parse(fs.readFileSync(path.join(handover, 'private-manifest.json'), 'utf8'));
    const names = manifest.files.map(f => f.path);
    names.push('baidoo/.handover/private-manifest.json');
    const list = path.join(handover, 'encryption-file-list.txt');
    fs.writeFileSync(list, names.join('\n') + '\n');
    answer = await createBackup({ password: request.password, desktop, fileList: list, expected: names, passwordSavedOffLaptop: request.passwordSavedOffLaptop, output: path.join(handover, 'encrypted-backup-v2') });
  } else if (request.action === 'restore') answer = await restoreBackup(request);
  else throw new Error('Unsupported backup action');
  request.password = '';
  console.log(JSON.stringify(answer));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
