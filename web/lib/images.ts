/**
 * Curated real imagery (Unsplash). Every id was verified to return a live
 * JPEG. No placeholders. Build sized URLs with img().
 */

const BASE = "https://images.unsplash.com/photo-"

export function img(id: string, w = 1600, q = 80): string {
  return `${BASE}${id}?q=${q}&w=${w}&auto=format&fit=crop`
}

/** Photographer credit page on Unsplash. Footer references only. */
export function unsplashCredit(id: string): string {
  return `https://unsplash.com/photos/${id}`
}

export const IMAGES = {
  // Soft sage-to-forest gradient. Hero background.
  hero: { id: "1603277578692-c699f37c67d3", credit: "Jei Lee" },
  // Circular bank-vault door. The reserve, made visible.
  vault: { id: "1582139329536-e7284fece509", credit: "Jason Dent" },
  // Two real cafe owners. Who it's for.
  merchants: { id: "1753351052617-62818ffc9173", credit: "Vitaly Gariev" },
  // Aerial green hills. Calm closing band.
  hills: { id: "1680237659901-29f8d39ff290", credit: "Tim Mossholder" },
  // Green bokeh, used only under a heavy forest overlay.
  texture: { id: "1548362851-ea052637ad64", credit: "Marvin van Beek" },
  // Artisan at work. Optional second merchant portrait.
  artisan: { id: "1687422809069-0fa3546b8471", credit: "Ali Mkumbwa" },
} as const
