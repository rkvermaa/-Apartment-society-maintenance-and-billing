const MAX_BODY_SIZE_BYTES = 1024 * 1024;

class PayloadTooLargeError extends Error {
  constructor() {
    super('Request body exceeds the maximum allowed size');
    this.code = 'PAYLOAD_TOO_LARGE';
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE_BYTES) {
        if (!tooLarge) {
          tooLarge = true;
          reject(new PayloadTooLargeError());
        }
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      if (tooLarge) return;
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;
  for (const pair of header.split(';')) {
    const separatorIndex = pair.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();
    cookies[key] = value;
  }
  return cookies;
}

module.exports = { readJsonBody, parseCookies, PayloadTooLargeError };
