// FieldValet — Blob Storage helpers for chat photos.
//
// Photos are uploaded directly from the browser to Blob Storage using short-lived,
// single-blob SAS URLs — the Functions host never touches the image bytes (saves
// compute + egress). Reads are served with short-lived read SAS so the container can
// stay private; a CDN can later be layered in front by setting CHAT_CDN_BASE.
const {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
} = require("@azure/storage-blob");

const CONTAINER = "chat-media";

// Parse the standard STORAGE_CONNECTION string into the pieces the SAS signer needs.
function parseConnection() {
  const conn = process.env.STORAGE_CONNECTION;
  if (!conn) throw new Error("STORAGE_CONNECTION app setting is not configured.");
  const parts = {};
  conn.split(";").forEach((kv) => {
    const idx = kv.indexOf("=");
    if (idx > -1) parts[kv.slice(0, idx).trim()] = kv.slice(idx + 1).trim();
  });
  const account = parts.AccountName;
  const key = parts.AccountKey;
  if (!account || !key) throw new Error("STORAGE_CONNECTION is missing AccountName/AccountKey.");
  const suffix = parts.EndpointSuffix || "core.windows.net";
  const blobEndpoint = parts.BlobEndpoint || `https://${account}.blob.${suffix}`;
  return { account, key, blobEndpoint: blobEndpoint.replace(/\/$/, "") };
}

let _cred = null;
let _cfg = null;
function config() {
  if (!_cfg) {
    _cfg = parseConnection();
    _cred = new StorageSharedKeyCredential(_cfg.account, _cfg.key);
  }
  return _cfg;
}

// Read host — CDN if configured, otherwise the blob endpoint.
function readHost() {
  const cdn = (process.env.CHAT_CDN_BASE || "").replace(/\/$/, "");
  return cdn || config().blobEndpoint;
}

async function ensureContainer() {
  config();
  const svc = BlobServiceClient.fromConnectionString(process.env.STORAGE_CONNECTION);
  await svc.getContainerClient(CONTAINER).createIfNotExists(); // private by default
}

function sasUrl(blobName, permissionsStr, minutes, host) {
  config();
  const now = Date.now();
  const sas = generateBlobSASQueryParameters(
    {
      containerName: CONTAINER,
      blobName,
      permissions: BlobSASPermissions.parse(permissionsStr),
      startsOn: new Date(now - 5 * 60 * 1000), // 5-min clock-skew grace
      expiresOn: new Date(now + minutes * 60 * 1000),
      protocol: "https",
    },
    _cred
  );
  return `${host}/${CONTAINER}/${encodeURI(blobName)}?${sas.toString()}`;
}

// Write-only URL the browser PUTs a single blob to. 15-minute window.
function uploadSasUrl(blobName) {
  return sasUrl(blobName, "cw", 15, config().blobEndpoint);
}

// Read URL for displaying an image. 60-minute window (images reload on refresh).
function readSasUrl(blobName) {
  return sasUrl(blobName, "r", 60, readHost());
}

module.exports = {
  CONTAINER,
  ensureContainer,
  uploadSasUrl,
  readSasUrl,
};
