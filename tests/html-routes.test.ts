/**
 * HTML import route tests — Bun's frontend bundling compatibility.
 *
 * These tests are unique to bun-serve-compress and have no equivalent in other
 * compression libraries. They verify that our serve() wrapper does not interfere
 * with Bun's built-in HTML import feature, where `import page from './page.html'`
 * creates a special module object that Bun.serve() uses for automatic frontend
 * bundling (JS/CSS transpilation, asset pipeline, HMR in development).
 *
 * Reference: https://bun.sh/docs/bundler/html
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { serve } from "../src/serve";
import homepage from "./fixtures/index.html";

describe("HTML import routes", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;

  beforeAll(() => {
    server = serve({
      port: 0,
      compression: {
        algorithms: ["gzip", "br", "zstd"],
      },
      routes: {
        "/": homepage,
      },
      fetch(req) {
        return new Response("not found", { status: 404 });
      },
    });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  test("serves HTML import route without errors", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);

    const contentType = res.headers.get("content-type");
    expect(contentType).toInclude("text/html");
  });

  test("HTML response contains expected content", async () => {
    const res = await fetch(`${baseUrl}/`);
    const html = await res.text();

    expect(html).toInclude("bun-serve-compress test page");
    expect(html).toInclude("<script");
  });

  test("HTML import bundling pipeline is not broken", async () => {
    // Fetch the page and check that script/style references are present
    const res = await fetch(`${baseUrl}/`);
    const html = await res.text();

    // Bun should have bundled the assets and rewritten the references
    // The HTML should contain references to the bundled assets
    expect(html).toInclude("<script");

    // Check that CSS is either inlined or referenced
    expect(html.includes("style") || html.includes("<link")).toBe(true);
  });

  test("bundled JS assets are accessible", async () => {
    // First get the HTML to find the script URL
    const htmlRes = await fetch(`${baseUrl}/`);
    const html = await htmlRes.text();

    // Extract script src from the HTML
    const scriptMatch = html.match(/src="([^"]+\.js[^"]*)"/);
    if (scriptMatch) {
      const scriptUrl = scriptMatch[1].startsWith("http")
        ? scriptMatch[1]
        : `${baseUrl}${scriptMatch[1].startsWith("/") ? "" : "/"}${scriptMatch[1]}`;

      const jsRes = await fetch(scriptUrl);
      expect(jsRes.status).toBe(200);

      const contentType = jsRes.headers.get("content-type");
      expect(
        contentType?.includes("javascript") || contentType?.includes("text/javascript"),
      ).toBe(true);
    }
  });
});
