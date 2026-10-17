// Turns dropped / pasted / picked files into Claude content blocks.

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_SIDE = 1568; // larger images are downscaled server-side anyway; save the bytes
const MAX_IMAGE_BYTES = 3_700_000; // keeps base64 under the 5 MB per-image limit
const MAX_PDF_BYTES = 25_000_000;
const MAX_TEXT_BYTES = 1_000_000;
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonc|ya?ml|toml|ini|env|xml|html?|css|scss|less|js|jsx|mjs|cjs|ts|tsx|py|rb|go|rs|java|kt|kts|c|h|cpp|hpp|cc|cs|php|swift|lua|luau|sh|bash|zsh|ps1|bat|sql|graphql|proto|vue|svelte|dart|r|scala|log|diff|patch|gitignore|dockerfile)$/i;

let seq = 0;
const kb = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
export const formatSize = kb;

const readAs = (file, how) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error(`Could not read ${file.name}`));
    how === "text" ? r.readAsText(file) : how === "buffer" ? r.readAsArrayBuffer(file) : r.readAsDataURL(file);
  });

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Unsupported image"));
    img.src = src;
  });
}

async function prepareImage(file) {
  const dataUrl = await readAs(file);
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const keep = IMAGE_TYPES.includes(file.type) && scale === 1 && file.size <= MAX_IMAGE_BYTES;
  if (keep) return { mediaType: file.type, dataUrl, width: img.width, height: img.height };
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  const asPng = file.type === "image/png" && file.size < 2_000_000;
  const out = canvas.toDataURL(asPng ? "image/png" : "image/jpeg", 0.9);
  return { mediaType: asPng ? "image/png" : "image/jpeg", dataUrl: out, width: canvas.width, height: canvas.height };
}

async function looksLikeText(file) {
  if (file.type.startsWith("text/") || TEXT_EXT.test(file.name) || /^(application\/(json|xml|javascript|x-sh|sql))/.test(file.type)) return true;
  const head = new Uint8Array(await readAs(file.slice(0, 8192), "buffer"));
  return head.length > 0 && !head.includes(0);
}

/** Reads one File into an attachment; throws with a user-facing message if unsupported. */
export async function readAttachment(file) {
  const name = file.name || `pasted-${Date.now()}.png`;
  const id = `a${++seq}`;
  if (file.type.startsWith("image/")) {
    const img = await prepareImage(file);
    return { id, kind: "image", name, size: Math.round((img.dataUrl.length * 3) / 4), mediaType: img.mediaType, data: img.dataUrl.split(",")[1], preview: img.dataUrl };
  }
  if (file.type === "application/pdf" || /\.pdf$/i.test(name)) {
    if (file.size > MAX_PDF_BYTES) throw new Error(`${name} is larger than 25 MB`);
    const dataUrl = await readAs(file);
    return { id, kind: "pdf", name, size: file.size, mediaType: "application/pdf", data: dataUrl.split(",")[1] };
  }
  if (await looksLikeText(file)) {
    if (file.size > MAX_TEXT_BYTES) throw new Error(`${name} is larger than 1 MB — ask Fish to read it from the workspace instead`);
    return { id, kind: "text", name, size: file.size, data: await readAs(file, "text") };
  }
  throw new Error(`${name}: only images, PDFs and text/code files can be attached`);
}

/** Message content for the API: attachments first, then the prompt text. */
export function toContent(text, attachments) {
  if (!attachments.length) return text;
  const blocks = attachments.map((a) => {
    if (a.kind === "image") return { type: "image", source: { type: "base64", media_type: a.mediaType, data: a.data } };
    if (a.kind === "pdf") return { type: "document", title: a.name, source: { type: "base64", media_type: "application/pdf", data: a.data } };
    return { type: "document", title: a.name, source: { type: "text", media_type: "text/plain", data: a.data } };
  });
  blocks.push({ type: "text", text: text || (attachments.length === 1 ? "Take a look at the attached file." : "Take a look at the attached files.") });
  return blocks;
}
