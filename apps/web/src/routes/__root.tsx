import {
  HeadContent,
  Outlet,
  createRootRoute,
} from "@tanstack/react-router";

const title = "EasySymbols — SVG to SF Symbol";
const description =
  "Convert vector SVG artwork into an Xcode-ready custom SF Symbol, locally in your browser.";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      {
        property: "og:image",
        content: "/og.png",
      },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      {
        property: "og:image:alt",
        content: "EasySymbols converts SVG vector paths into a custom SF Symbol.",
      },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: "/og.png" },
    ],
  }),
  component: RootLayout,
  notFoundComponent: NotFound,
});

function RootLayout() {
  return (
    <>
      <HeadContent />
      <Outlet />
    </>
  );
}

function NotFound() {
  return (
    <main className="mx-auto my-20 w-[min(620px,calc(100%_-_40px))] rounded-[18px] border border-line bg-white p-9 text-center">
      <h1>Page not found</h1>
      <p>EasySymbols only has one route: the local SVG converter.</p>
      <a className="text-accent" href="/">
        Back to converter
      </a>
    </main>
  );
}
