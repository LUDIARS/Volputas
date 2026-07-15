const crypto = require('node:crypto');

function encode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function formatTimestamp(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function hmac(key, value) {
  return crypto.createHmac('sha256', key).update(value).digest();
}

function signingKey(secret, date, region) {
  const day = date.slice(0, 8);
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), 's3'), 'aws4_request');
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalPath(endpoint, bucket, objectKey, forcePathStyle) {
  const objectPath = objectKey.split('/').map(encode).join('/');
  const basePath = endpoint.pathname.replace(/\/$/, '');
  return forcePathStyle
    ? `${basePath}/${encode(bucket)}/${objectPath}`
    : `${basePath}/${objectPath}`;
}

function objectUrl(config, objectKey) {
  const endpoint = new URL(config.endpoint);
  if (!config.forcePathStyle) endpoint.hostname = `${config.bucket}.${endpoint.hostname}`;
  endpoint.pathname = canonicalPath(endpoint, config.bucket, objectKey, config.forcePathStyle);
  return endpoint;
}

function presignPut(config, objectKey, sha256Hex, expiresSeconds, now = new Date()) {
  const url = objectUrl(config, objectKey);
  const timestamp = formatTimestamp(now);
  const date = timestamp.slice(0, 8);
  const credentialScope = `${date}/${config.region}/s3/aws4_request`;
  const checksum = Buffer.from(sha256Hex, 'hex').toString('base64');
  const headers = {
    host: url.host,
    'x-amz-checksum-sha256': checksum,
    'x-amz-meta-sha256': sha256Hex,
  };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers).sort().map((name) => `${name}:${headers[name]}\n`).join('');
  const query = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${config.accessKeyId}/${credentialScope}`,
    'X-Amz-Date': timestamp,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': signedHeaders,
  };
  const canonicalQuery = Object.entries(query)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${encode(name)}=${encode(value)}`)
    .join('&');
  const canonicalRequest = `PUT\n${url.pathname}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\nUNSIGNED-PAYLOAD`;
  const stringToSign = `AWS4-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${hash(canonicalRequest)}`;
  query['X-Amz-Signature'] = crypto.createHmac('sha256', signingKey(config.secretAccessKey, timestamp, config.region))
    .update(stringToSign)
    .digest('hex');
  url.search = Object.entries(query).map(([name, value]) => `${encode(name)}=${encode(value)}`).join('&');
  return { url: url.toString(), headers: { 'x-amz-checksum-sha256': checksum, 'x-amz-meta-sha256': sha256Hex } };
}

function presignGet(config, objectKey, expiresSeconds, now = new Date()) {
  const url = objectUrl(config, objectKey);
  const timestamp = formatTimestamp(now);
  const date = timestamp.slice(0, 8);
  const credentialScope = `${date}/${config.region}/s3/aws4_request`;
  const canonicalHeaders = `host:${url.host}\n`;
  const query = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${config.accessKeyId}/${credentialScope}`,
    'X-Amz-Date': timestamp,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuery = Object.entries(query)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${encode(name)}=${encode(value)}`)
    .join('&');
  const canonicalRequest = `GET\n${url.pathname}\n${canonicalQuery}\n${canonicalHeaders}\nhost\nUNSIGNED-PAYLOAD`;
  const stringToSign = `AWS4-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${hash(canonicalRequest)}`;
  query['X-Amz-Signature'] = crypto.createHmac('sha256', signingKey(config.secretAccessKey, timestamp, config.region))
    .update(stringToSign)
    .digest('hex');
  url.search = Object.entries(query).map(([name, value]) => `${encode(name)}=${encode(value)}`).join('&');
  return { url: url.toString(), expires_in_seconds: expiresSeconds };
}

function signRequest(config, method, objectKey, extraHeaders = {}, now = new Date()) {
  const url = objectUrl(config, objectKey);
  const timestamp = formatTimestamp(now);
  const date = timestamp.slice(0, 8);
  const credentialScope = `${date}/${config.region}/s3/aws4_request`;
  const headers = {
    host: url.host,
    'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
    'x-amz-date': timestamp,
    ...Object.fromEntries(Object.entries(extraHeaders).map(([name, value]) => [name.toLowerCase(), value])),
  };
  const names = Object.keys(headers).map((name) => name.toLowerCase()).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name].toString().trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = `${method}\n${url.pathname}\n\n${canonicalHeaders}\n${signedHeaders}\nUNSIGNED-PAYLOAD`;
  const stringToSign = `AWS4-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${hash(canonicalRequest)}`;
  const signature = crypto.createHmac('sha256', signingKey(config.secretAccessKey, timestamp, config.region))
    .update(stringToSign)
    .digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  delete headers.host;
  return { url: url.toString(), headers };
}

module.exports = { objectUrl, presignGet, presignPut, signRequest };
