const grid = document.querySelector("#product-grid");
const status = document.querySelector("#catalog-status");
const count = document.querySelector("#product-count");
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

function makeCard(product) {
  if (!product || typeof product.title !== "string" || typeof product.image !== "string" ||
      !isMercadoLibreUrl(product.url)) return null;

  const link = document.createElement("a");
  link.className = "product-card";
  link.href = product.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", product.title + ", " + formatPrice(product.price, product.currency) + ". Abrir en Mercado Libre.");

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
  const label = document.createElement("span");
  label.className = "buy-label";
  label.textContent = "Ver en Mercado Libre";
  info.append(title, price, label);
  link.append(imageWrap, info);
  return link;
}

try {
  const response = await fetch("/mercado-productos.json", { cache: "no-cache" });
  if (!response.ok) throw new Error("No se pudo cargar el catálogo.");
  const products = await response.json();
  if (!Array.isArray(products)) throw new Error("El formato del catálogo no es válido.");
  const cards = products.map(makeCard).filter(Boolean);
  grid.replaceChildren(...cards);
  count.textContent = cards.length ? cards.length + (cards.length === 1 ? " producto" : " productos") : "";
  status.textContent = cards.length
    ? ""
    : "Estamos preparando el catálogo. Los productos aparecerán aquí.";
} catch {
  status.textContent = "No pudimos cargar los productos en este momento. Vuelve a intentarlo más tarde.";
}
