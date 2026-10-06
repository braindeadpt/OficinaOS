// Shop identity safe to show to anonymous customers (tracking page,
// lookup response): what is printed on a receipt anyway, nothing private.

const DATA_URL_RE =
  /^data:(image\/(?:png|jpeg|webp|gif|svg\+xml));base64,(.+)$/;

export function parseImageDataUrl(
  value: string | null | undefined
): { data: Buffer; mime: string } | null {
  const match = value ? DATA_URL_RE.exec(value) : null;
  if (!(match?.[1] && match[2])) {
    return null;
  }
  return { data: Buffer.from(match[2], "base64"), mime: match[1] };
}

export function toPublicShop(s: {
  address: string | null;
  defaultWarrantyDays: number;
  logoPath: string | null;
  phone: string | null;
  shopName: string;
  storeLogoData: string | null;
}) {
  let logoUrl: string | null = null;
  if (s.logoPath) {
    logoUrl = s.logoPath;
  } else if (parseImageDataUrl(s.storeLogoData)) {
    logoUrl = "/api/public/shop/logo";
  }
  return {
    address: s.address?.trim() || null,
    logoUrl,
    name: s.shopName.trim() || null,
    phone: s.phone?.trim() || null,
    warrantyDays: s.defaultWarrantyDays,
  };
}
