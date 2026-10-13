import { publicSettings } from './settings.js';

export const CONFIG_PREFIX = 'duallens-config:v1:';
export const PBKDF2_ITERATIONS = 310000;
const MAX_BYTES = 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function checkedSecrets(input = {}) {
  const secrets = {};
  for (const [id, secret] of Object.entries(input)) {
    if (!id || ['__proto__', 'prototype', 'constructor'].includes(id) || typeof secret?.apiKey !== 'string') throw new Error('密钥配置无效');
    secrets[id] = { apiKey: secret.apiKey };
  }
  return secrets;
}
async function derive(password, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
function base64url(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unbase64url(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) throw new Error('配置格式无效');
  return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}

export async function exportConfig(settings, { password = '', secrets = {} } = {}) {
  const clean = publicSettings(settings);
  if (!password) return JSON.stringify(clean, null, 2);
  const plaintext = encoder.encode(JSON.stringify({ settings: clean, secrets: checkedSecrets(secrets) }));
  if (plaintext.length > MAX_BYTES) throw new Error('配置文件最大 1MB');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(password, salt);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv,
    additionalData: encoder.encode(CONFIG_PREFIX) }, key, plaintext));
  const bytes = new Uint8Array(salt.length + iv.length + encrypted.length);
  bytes.set(salt); bytes.set(iv, 16); bytes.set(encrypted, 28);
  return CONFIG_PREFIX + base64url(bytes);
}

export async function importConfig(text, password = '') {
  if (typeof text !== 'string' || text.length > MAX_BYTES * 2) throw new Error('配置文件过大或格式无效');
  if (!text.startsWith(CONFIG_PREFIX)) {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('配置格式无效');
    return { settings: publicSettings(data) }; // untrusted plaintext never imports secrets
  }
  if (!password) throw new Error('请输入导出时使用的口令');
  try {
    const bytes = unbase64url(text.slice(CONFIG_PREFIX.length));
    if (bytes.length < 45 || bytes.length > MAX_BYTES + 44) throw new Error('配置格式无效');
    const key = await derive(password, bytes.slice(0, 16));
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(16, 28),
      additionalData: encoder.encode(CONFIG_PREFIX) }, key, bytes.slice(28));
    const data = JSON.parse(decoder.decode(decrypted));
    if (!data?.settings || typeof data.settings !== 'object' || Array.isArray(data.settings)) throw new Error('配置格式无效');
    return { settings: publicSettings(data.settings), secrets: checkedSecrets(data.secrets) };
  } catch { throw new Error('口令错误或加密配置已损坏'); }
}
