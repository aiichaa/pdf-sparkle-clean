import { getTool, type ToolSlug } from "./tools";

const SITE = "PDF Clarity";

/** <head> tags for a tool page. */
export function toolHead(slug: ToolSlug) {
  const t = getTool(slug);
  const title = `${t.title} — free & private | ${SITE}`;
  const description = `${t.description} Runs in your browser: your files are never uploaded. No ads, no sign-up.`;
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
    ],
    links: [{ rel: "canonical", href: `/${slug}` }],
  };
}
