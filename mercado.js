const grid = document.querySelector("#product-grid");
const status = document.querySelector("#catalog-status");
const feedback = document.querySelector("#share-feedback");
const mobilePhone = typeof navigator.userAgentData?.mobile === "boolean"
  ? navigator.userAgentData.mobile
  : /iPhone|iPod|Android.*Mobile/i.test(navigator.userAgent);
let feedbackTimer;
const approvedDomains = [
  "mercadolibre.cl", "mercadolibre.com", "mercadolibre.com.ar",
  "mercadolibre.com.mx", "mercadolibre.com.co", "mercadolibre.com.uy",
  "mercadolibre.com.pe", "mercadolibre.com.ec", "mercadolibre.com.ve",
  "mercadolivre.com.br"
];

function isMercadoLibreUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && approvedDomains.some(
      domain => url.hostname === domain || url.hostname.endsWith("." + domain)
    );
  } catch {
    return false;
  }
}

function formatPrice(price, currency) {
  const code = typeof currency === "string" && /^[A-Z]{3}$/.test(currency) ? currency : "CLP";
  const amount = Number(price);
  if (!Number.isFinite(amount)) return "Precio por confirmar";
  try {
    return new Intl.NumberFormat("es-CL", {
      style: "currency",
      currency: code,
      maximumFractionDigits: code === "CLP" ? 0 : 2
    }).format(amount);
  } catch {
    return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(amount);
  }
}

function showFeedback(message) {
  clearTimeout(feedbackTimer);
  feedback.textContent = message;
  feedbackTimer = setTimeout(() => { feedback.textContent = ""; }, 3000);
}

async function copyLink(url) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(url);
  } catch {
    const field = document.createElement("textarea");
    field.value = url;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    let copied = false;
    try { copied = document.execCommand("copy"); } catch {}
    field.remove();
    if (!copied) {
      showFeedback("No se pudo copiar el enlace");
      return;
    }
  }
  showFeedback("Enlace copiado");
}

function makeCard(product) {
  if (!product || typeof product.title !== "string" || typeof product.image !== "string" ||
      !isMercadoLibreUrl(product.url)) return null;

  const card = document.createElement("article");
  card.className = "product-card";
  const surface = document.createElement("div");
  surface.className = "product-surface";

  const imageWrap = document.createElement("div");
  imageWrap.className = "product-image-wrap";
  const image = document.createElement("img");
  image.className = "product-image";
  image.src = product.image;
  image.alt = product.title;
  image.loading = "lazy";
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  imageWrap.append(image);

  const info = document.createElement("div");
  info.className = "product-info";
  const title = document.createElement("h3");
  title.className = "product-title";
  title.textContent = product.title;
  const price = document.createElement("p");
  price.className = "product-price";
  price.textContent = formatPrice(product.price, product.currency);
  info.append(title, price);
  surface.append(imageWrap, info);

  const actions = document.createElement("div");
  actions.className = "product-actions";
  const view = document.createElement("a");
  view.className = "view-button";
  view.href = product.url;
  view.target = "_blank";
  view.rel = "noopener noreferrer";
  view.textContent = "Ver";
  view.setAttribute("aria-label", "Ver " + product.title + " en Mercado Libre");

  const share = document.createElement(mobilePhone ? "a" : "button");
  share.className = "share-button";
  share.title = mobilePhone ? "Compartir por WhatsApp" : "Copiar enlace";
  share.setAttribute("aria-label", share.title + " de " + product.title);
  share.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.7 10.6 6.6-4.1m-6.6 6.9 6.6 4.1"/></svg>';
  if (mobilePhone) {
    share.href = "https://wa.me/?text=" + encodeURIComponent(product.url);
    share.target = "_blank";
    share.rel = "noopener noreferrer";
  } else {
    share.type = "button";
    share.addEventListener("click", () => copyLink(product.url));
  }
  actions.append(view, share);
  card.append(surface, actions);
  return card;
}

try {
  const response = await fetch("/mercado-productos.json", { cache: "no-cache" });
  if (!response.ok) throw new Error("No se pudo cargar el catálogo.");
  const products = await response.json();
  if (!Array.isArray(products)) throw new Error("El formato del catálogo no es válido.");
  const cards = products.map(makeCard).filter(Boolean);
  grid.replaceChildren(...cards);
  status.textContent = cards.length
    ? ""
    : "Estamos preparando el catálogo. Los productos aparecerán aquí.";
} catch {
  status.textContent = "No pudimos cargar los productos en este momento. Vuelve a intentarlo más tarde.";
}
